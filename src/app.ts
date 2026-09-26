/**
 * Stateless Streamable HTTP: one McpServer + transport per POST /mcp, plus GET /healthz.
 * With `web` set, the same process also serves the simulated voice UI at / and the agent at /api/*.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleWeb, type WebOptions } from './web.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createServer, SERVER_NAME, SERVER_VERSION, type Deps } from './server.js';

const MAX_BODY = 1_000_000;

export function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new Error('body too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(new Error('invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string) {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/**
 * The spec says servers MUST validate Origin to stop DNS rebinding. Browsers send it;
 * server-side clients do not. Allowed: no Origin, localhost origins, or ALLOWED_ORIGINS.
 */
export function originAllowed(origin: string | undefined, extra: string[]): boolean {
    if (!origin) return true;
    if (extra.includes('*') || extra.includes(origin)) return true;
    try {
        const h = new URL(origin).hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    } catch {
        return false;
    }
}

export function createApp(deps: Deps, opts: { allowedOrigins?: string[]; web?: WebOptions } = {}): Server {
    const allowed = opts.allowedOrigins ?? [];
    const app: Server = createHttpServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/healthz' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ ok: true, name: SERVER_NAME, version: SERVER_VERSION, protocol: LATEST_PROTOCOL_VERSION }));
            return;
        }
        if (opts.web && url.pathname !== '/mcp') {
            const selfMcp = `http://127.0.0.1:${(app.address() as AddressInfo).port}/mcp`;
            await handleWeb(req, res, url, { ...opts.web, mcpUrl: opts.web.mcpUrl ?? selfMcp }, allowed);
            return;
        }
        if (url.pathname !== '/mcp') {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found. The MCP endpoint is POST /mcp.');
            return;
        }
        if (!originAllowed(req.headers.origin, allowed)) {
            jsonRpcError(res, 403, -32000, 'Origin not allowed');
            return;
        }
        if (req.method !== 'POST') {
            // Stateless: no server-initiated SSE stream and no sessions to delete.
            res.setHeader('Allow', 'POST');
            jsonRpcError(res, 405, -32000, 'Method not allowed: this server is stateless, use POST /mcp.');
            return;
        }
        let body: unknown;
        try {
            body = await readBody(req);
        } catch (e) {
            jsonRpcError(res, 400, -32700, `Parse error: ${(e as Error).message}`);
            return;
        }
        const server = createServer(deps);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (e) {
            if (!res.headersSent) jsonRpcError(res, 500, -32603, `Internal error: ${(e as Error).message}`);
        }
    });
    return app;
}
