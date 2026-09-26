/** The voice UI's HTTP surface: static files from web/, POST /api/ask, GET /api/config and /api/watchlist. */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, withMcp, type HistoryTurn } from './agent/agent.js';
import type { ModelAdapter } from './agent/types.js';
import { originAllowed, readBody } from './app.js';

export interface WebOptions {
    adapter: ModelAdapter;
    /** The MCP endpoint the agent connects to. Default: this same server's /mcp. */
    mcpUrl?: string;
    /** Directory of the static front end. Default: <package>/web. */
    webDir?: string;
    now?: () => Date;
}

export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const MAX_UTTERANCE = 300;

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
};

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
};

function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS }).end(JSON.stringify(body));
}

/** The UI is same-origin; accept it on whatever host it is served from, plus the MCP rule. */
function apiOriginOk(req: IncomingMessage, allowed: string[]): boolean {
    const origin = req.headers.origin;
    if (originAllowed(origin, allowed)) return true;
    try {
        return new URL(origin!).host === req.headers.host;
    } catch {
        return false;
    }
}

function parseHistory(v: unknown): HistoryTurn[] {
    if (!Array.isArray(v)) return [];
    return v
        .filter((h): h is HistoryTurn => !!h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .slice(-6)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 1000) }));
}

async function serveStatic(res: ServerResponse, dir: string, pathname: string) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const root = normalize(dir.endsWith(sep) ? dir : dir + sep);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root) || !TYPES[extname(file)]) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found.');
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-cache', ...SECURITY_HEADERS }).end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found.');
    }
}

export async function handleWeb(req: IncomingMessage, res: ServerResponse, url: URL, o: WebOptions & { mcpUrl: string }, allowed: string[]) {
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET' }).end();
            return;
        }
        await serveStatic(res, o.webDir ?? DEFAULT_WEB_DIR, pathname);
        return;
    }
    if (!apiOriginOk(req, allowed)) return json(res, 403, { error: 'Origin not allowed' });

    if (pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, { provider: { id: o.adapter.id, label: o.adapter.label, model: o.adapter.model } });
    }
    if (pathname === '/api/watchlist' && req.method === 'GET') {
        try {
            const items = await withMcp(o.mcpUrl, async (c) => {
                const r = await c.callTool({ name: 'watchlist_list', arguments: {} });
                return (r.structuredContent as { items?: unknown[] } | undefined)?.items ?? [];
            });
            return json(res, 200, { items });
        } catch (e) {
            return json(res, 502, { error: `Could not read the watchlist: ${(e as Error).message}` });
        }
    }
    if (pathname === '/api/ask') {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return json(res, 405, { error: 'Use POST /api/ask with {"q": "..."}' });
        }
        let body: { q?: unknown; history?: unknown };
        try {
            body = (await readBody(req)) as typeof body;
        } catch (e) {
            return json(res, 400, { error: (e as Error).message });
        }
        const q = typeof body?.q === 'string' ? body.q.trim() : '';
        if (!q || q.length > MAX_UTTERANCE) return json(res, 400, { error: `"q" must be a question of 1 to ${MAX_UTTERANCE} characters` });
        try {
            const result = await ask({ adapter: o.adapter, mcpUrl: o.mcpUrl, utterance: q, history: parseHistory(body.history), now: o.now });
            return json(res, 200, result);
        } catch (e) {
            console.error(`ask failed: ${(e as Error).message}`);
            return json(res, 502, { error: `The assistant could not answer: ${(e as Error).message}` });
        }
    }
    return json(res, 404, { error: 'Unknown API route' });
}
