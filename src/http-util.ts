import type { FetchLike } from './types.js';

export const FETCH_TIMEOUT_MS = 10_000;
export const USER_AGENT = 'recall-radar-mcp/0.2 (+https://github.com/MGrin/recall-radar-mcp)';

export class UpstreamError extends Error {
    constructor(message: string, readonly source: string, readonly status: number | null = null) {
        super(message);
        this.name = 'UpstreamError';
    }
}

/**
 * One GET with a hard timeout. Returns parsed JSON, or `notFound` when the caller
 * says a given status means "no results" (openFDA answers 404 to an empty search).
 */
export async function getJson(
    fetchImpl: FetchLike,
    url: string,
    source: string,
    opts: { emptyOnStatus?: number; timeoutMs?: number } = {},
): Promise<unknown> {
    let res: Response;
    try {
        res = await fetchImpl(url, {
            headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
        });
    } catch (err) {
        const e = err as Error;
        const why = e?.name === 'TimeoutError' || e?.name === 'AbortError'
            ? `timed out after ${(opts.timeoutMs ?? FETCH_TIMEOUT_MS) / 1000} seconds`
            : [e?.message ?? String(err), (e?.cause as { code?: string } | undefined)?.code].filter(Boolean).join(': ');
        throw new UpstreamError(`${source} request failed: ${why}`, source);
    }
    if (opts.emptyOnStatus !== undefined && res.status === opts.emptyOnStatus) return null;
    if (!res.ok) throw new UpstreamError(`${source} answered HTTP ${res.status}`, source, res.status);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new UpstreamError(`${source} did not answer with JSON`, source, res.status);
    }
}

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** First sentence of a long upstream paragraph, capped, for reading aloud. */
export function firstSentence(text: string, max = 180): string {
    const t = text.replace(/\s+/g, ' ').trim();
    const m = /^(.+?[.!?])(\s|$)/.exec(t);
    const s = m ? m[1] : t;
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function isoDaysAgo(days: number, now = new Date()): string {
    return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Ensure text ends like a sentence, so concatenated summaries read aloud cleanly. */
export const sentence = (t: string): string => (/[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
