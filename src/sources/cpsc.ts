/** US Consumer Product Safety Commission recalls (saferproducts.gov). Public domain, keyless. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { firstSentence, getJson, sentence, str, UpstreamError } from '../http-util.js';
import type { FetchLike, Recall } from '../types.js';

export const CPSC_ENDPOINT = 'https://www.saferproducts.gov/RestWebServices/Recall';

const names = (v: unknown, key = 'Name'): string[] =>
    Array.isArray(v) ? v.map((x) => str((x as Record<string, unknown>)?.[key])).filter(Boolean) : [];

export function cpscUrl(q: { productName?: string; since: string }): string {
    const u = new URL(CPSC_ENDPOINT);
    u.searchParams.set('format', 'json');
    u.searchParams.set('RecallDateStart', q.since);
    if (q.productName) u.searchParams.set('ProductName', q.productName);
    return u.toString();
}

export function normaliseCpsc(row: Record<string, unknown>): Recall {
    const products = names(row.Products);
    const hazard = names(row.Hazards)[0] ?? '';
    const remedyText = names(row.Remedies)[0] ?? '';
    const options = names(row.RemedyOptions, 'Option');
    const date = str(row.RecallDate).slice(0, 10);
    const title = str(row.Title) || products[0] || 'Product recall';
    const what = products[0] || title;
    const remedy = remedyText || (options.length ? `Remedy offered: ${options.join(', ')}.` : 'Stop using the product and contact the firm.');
    return {
        source: 'cpsc',
        id: str(row.RecallNumber) || String(row.RecallID ?? ''),
        title,
        hazard,
        remedy,
        date,
        products,
        url: str(row.URL) || 'https://www.cpsc.gov/Recalls',
        summary: `${what} was recalled on ${date}${options.length ? `; remedy: ${options.join(' or ').toLowerCase()}` : ''}. ${sentence(firstSentence(hazard || title))}`,
    };
}

/** Every word of the query must appear in the title, a product name or the description. */
function matchesLocally(row: Record<string, unknown>, productName: string): boolean {
    const hay = [str(row.Title), str(row.Description), ...names(row.Products)].join(' ').toLowerCase();
    return productName.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

type Row = Record<string, unknown>;
type Query = { productName?: string; since: string };

/** What one CPSC read produced, and how: `note` when another URL served it, `warning` when only a saved copy did. */
export interface CpscOutcome {
    results: Recall[];
    note?: string;
    warning?: string;
}

/** Start dates that answered while other URLs answered 503 (2026-10-02 and 2026-10-04). Used only when earlier than the window. */
export const CPSC_KNOWN_STARTS = ['2026-04-01', '2026-01-01'];
/** At most this many CPSC requests per search, inside this much time. */
export const CPSC_MAX_ATTEMPTS = 6;
export const CPSC_BUDGET_MS = 20_000;
const ATTEMPT_TIMEOUT_MS = 8_000;
/** An alternate start more than this far before the window is not tried: too much to download for a few rows. */
const MAX_WIDEN_DAYS = 400;
const CACHE_ENTRIES = 8;
/** Successful responses are shared between the searches of one household check, and reused briefly. */
const MEMO_MS = 5 * 60 * 1000;

const firstOfMonth = (y: number, m: number) => `${m < 1 ? y - 1 : y}-${String(m < 1 ? 12 : m).padStart(2, '0')}-01`;

/** Earlier start dates to try when the window's own URL fails, nearest first. */
export function fallbackStarts(since: string): string[] {
    const [y, m] = since.split('-').map(Number);
    const floor = new Date(Date.parse(since) - MAX_WIDEN_DAYS * 86_400_000).toISOString().slice(0, 10);
    const all = [firstOfMonth(y, m), firstOfMonth(y, m - 1), ...CPSC_KNOWN_STARTS].filter((d) => d < since && d >= floor);
    return [...new Set(all)];
}

const isErrorRow = (r: Row) => !r?.RecallNumber && /^Error retrieving/i.test(str(r?.Title));

interface CacheEntry {
    url: string;
    since: string;
    productName?: string;
    fetchedAt: string;
    rows: Row[];
}

/**
 * CPSC's API answered some URLs and 503'd others, consistently per URL, for days (2026-10-02
 * onwards). So a read tries the window's own URL, then the same window without the product
 * filter, then a few EARLIER start dates, filtering locally to the window. If every live
 * attempt fails, it serves the last good response saved on disk, labelled as a saved copy.
 */
export class CpscClient {
    private entries: CacheEntry[] | null = null;
    private writing: Promise<void> = Promise.resolve();
    private readonly memo = new Map<string, { at: number; rows: Promise<Row[]> }>();

    constructor(
        private readonly fetchImpl: FetchLike,
        private readonly opts: { cachePath?: string; now?: () => Date; budgetMs?: number } = {},
    ) {}

    private now(): Date {
        return this.opts.now?.() ?? new Date();
    }

    async search(q: Query): Promise<CpscOutcome> {
        const attempts: Query[] = [];
        if (q.productName) attempts.push(q);
        attempts.push({ since: q.since }, ...fallbackStarts(q.since).map((since) => ({ since })));
        const deadline = Date.now() + (this.opts.budgetMs ?? CPSC_BUDGET_MS);
        const failed: string[] = [];
        for (const a of attempts.slice(0, CPSC_MAX_ATTEMPTS)) {
            const left = deadline - Date.now();
            if (left <= 0) break;
            const url = cpscUrl(a);
            let rows: Row[];
            try {
                rows = await this.read(url, a, Math.min(left, ATTEMPT_TIMEOUT_MS));
            } catch (err) {
                if (!(err instanceof UpstreamError)) throw err;
                failed.push(`${a.since}${a.productName ? ' with product filter' : ''}: ${err.message}`);
                continue;
            }
            const results = this.select(rows, q, a);
            if (a === attempts[0]) return { results };
            return { results, note: `US CPSC: the requested query failed (${failed.join('; ')}); served by ${url}, filtered here to ${q.productName ? `"${q.productName}" ` : ''}on or after ${q.since}.` };
        }
        const why = `${failed.length} live CPSC ${failed.length === 1 ? 'attempt' : 'attempts'} failed (${failed.join('; ')})`;
        const saved = this.fromCache(q);
        if (!saved) throw new UpstreamError(`${why}; no saved copy to fall back on`, 'CPSC');
        const day = saved.fetchedAt.slice(0, 10);
        const results = this.select(saved.rows, q, saved).map((r) => ({
            ...r,
            summary: `${r.summary} (From a saved copy of CPSC data fetched ${day}; CPSC could not be reached live.)`,
        }));
        return {
            results,
            warning: `US CPSC unavailable live: ${why}. Showing a STALE saved copy fetched ${saved.fetchedAt} from ${saved.url}${saved.since > q.since ? `, which covers only from ${saved.since}` : ''}: ${results.length} matching ${results.length === 1 ? 'row' : 'rows'}.`,
        };
    }

    /** Rows from a response, narrowed here to the query unless CPSC already filtered them by product and window. */
    private select(rows: Row[], q: Query, served: Query): Recall[] {
        const product = (r: Row) => !q.productName || Boolean(served.productName) || matchesLocally(r, q.productName);
        const window = (r: Row) => served.since === q.since || str(r.RecallDate).slice(0, 10) >= q.since;
        return rows
            .filter((r) => product(r) && window(r))
            .map(normaliseCpsc)
            .filter((r) => r.id);
    }

    private read(url: string, q: Query, timeoutMs: number): Promise<Row[]> {
        const hit = this.memo.get(url);
        if (hit && Date.now() - hit.at < MEMO_MS) return hit.rows;
        const rows = (async () => {
            const body = await getJson(this.fetchImpl, url, 'CPSC', { timeoutMs });
            if (!Array.isArray(body)) throw new UpstreamError('CPSC answered with something other than a list of recalls', 'CPSC');
            // CPSC can answer HTTP 200 with one placeholder row whose Title is its own error text.
            if (body.some((r) => isErrorRow(r as Row))) throw new UpstreamError('CPSC answered with an error row instead of recalls', 'CPSC');
            await this.save({ url, since: q.since, productName: q.productName, fetchedAt: this.now().toISOString(), rows: body as Row[] });
            return body as Row[];
        })();
        this.memo.set(url, { at: Date.now(), rows });
        rows.catch(() => this.memo.delete(url));
        return rows;
    }

    private load(): CacheEntry[] {
        if (this.entries) return this.entries;
        let entries: CacheEntry[] = [];
        try {
            const data = this.opts.cachePath ? JSON.parse(readFileSync(this.opts.cachePath, 'utf8')) : null;
            if (Array.isArray(data?.entries)) entries = data.entries;
        } catch {
            // No cache yet, or an unreadable one: start empty.
        }
        return (this.entries = entries);
    }

    private save(e: CacheEntry): Promise<void> {
        const entries = this.load().filter((x) => x.url !== e.url);
        entries.unshift(e);
        this.entries = entries.slice(0, CACHE_ENTRIES);
        const path = this.opts.cachePath;
        if (!path) return Promise.resolve();
        const snapshot = JSON.stringify({ entries: this.entries });
        // Writes are serialised and atomic; a failed write never fails the read that triggered it.
        this.writing = this.writing.then(() => {
            try {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(`${path}.tmp`, snapshot);
                renameSync(`${path}.tmp`, path);
            } catch {
                // Best effort.
            }
        });
        return this.writing;
    }

    /** The freshest saved response that can answer this query: same product filter or none; one covering the window first. */
    private fromCache(q: Query): CacheEntry | undefined {
        const usable = this.load()
            .filter((e) => !e.productName || e.productName.toLowerCase() === q.productName?.toLowerCase())
            .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
        return usable.find((e) => e.since <= q.since) ?? usable[0];
    }
}
