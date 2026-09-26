/** Cross-source search. The only layer the MCP tools talk to. */
import { isoDaysAgo, UpstreamError } from './http-util.js';
import { searchCpsc } from './sources/cpsc.js';
import { fetchEmaShortages, matchesMedicine } from './sources/ema.js';
import { searchOpenFda, type FdaCategory } from './sources/openfda.js';
import type { FetchLike, Recall } from './types.js';
import type { WatchItem } from './watchlist.js';

export interface SearchResult {
    results: Recall[];
    /** One line per source that failed; the others still answered. */
    warnings: string[];
}

export const EMA_CACHE_MS = 60 * 60 * 1000;

const byDateDesc = (a: Recall, b: Recall) => b.date.localeCompare(a.date);

export class RecallService {
    private emaCache: { at: number; rows: Recall[] } | null = null;
    constructor(private readonly fetchImpl: FetchLike, private readonly now: () => Date = () => new Date()) {}

    today(): string {
        return this.now().toISOString().slice(0, 10);
    }
    daysAgo(n: number): string {
        return isoDaysAgo(n, this.now());
    }

    /**
     * EMA rate-limits hard (HTTP 429 on the third file request inside a minute, seen
     * 2026-09-14), and the file changes at most daily, so it is read at most hourly.
     */
    async emaShortages(): Promise<Recall[]> {
        const t = this.now().getTime();
        if (this.emaCache && t - this.emaCache.at < EMA_CACHE_MS) return this.emaCache.rows;
        const rows = await fetchEmaShortages(this.fetchImpl);
        this.emaCache = { at: t, rows };
        return rows;
    }

    /** Run named lookups in parallel; keep what succeeded, turn failures into warnings. */
    private async gather(jobs: Record<string, () => Promise<Recall[]>>): Promise<SearchResult> {
        const names = Object.keys(jobs);
        const settled = await Promise.allSettled(names.map((n) => jobs[n]()));
        const results: Recall[] = [];
        const warnings: string[] = [];
        settled.forEach((s, i) => {
            if (s.status === 'fulfilled') results.push(...s.value);
            else warnings.push(`${names[i]} unavailable: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
        });
        if (names.length > 0 && warnings.length === names.length) {
            throw new UpstreamError(`Every source failed. ${warnings.join('; ')}`, 'all');
        }
        return { results: dedupe(results).sort(byDateDesc), warnings };
    }

    async products(q: { query: string; since: string; limit: number }): Promise<SearchResult> {
        const r = await this.gather({
            'US CPSC': () => searchCpsc(this.fetchImpl, { productName: q.query, since: q.since }),
            'openFDA devices': () => searchOpenFda(this.fetchImpl, 'device', { terms: [q.query], since: q.since, until: this.today(), limit: q.limit }),
        });
        return { ...r, results: r.results.slice(0, q.limit) };
    }

    async food(q: { query: string; since: string; limit: number }): Promise<SearchResult> {
        const r = await this.gather({
            'openFDA food': () =>
                searchOpenFda(this.fetchImpl, 'food', {
                    terms: [q.query], since: q.since, until: this.today(), limit: q.limit,
                    // "listeria" or "undeclared peanut" live in the reason, not the product name.
                    fields: ['product_description', 'reason_for_recall'],
                }),
        });
        return { ...r, results: r.results.slice(0, q.limit) };
    }

    async medicines(q: { query: string; since: string; limit: number; region: 'us' | 'eu' | 'all' }): Promise<SearchResult> {
        const jobs: Record<string, () => Promise<Recall[]>> = {};
        if (q.region !== 'eu') {
            jobs['openFDA drugs'] = () => searchOpenFda(this.fetchImpl, 'drug', { terms: [q.query], since: q.since, until: this.today(), limit: q.limit });
        }
        if (q.region !== 'us') {
            jobs['EMA shortages'] = async () =>
                (await this.emaShortages()).filter((r) => matchesMedicine(r, q.query) && (!r.date || r.date >= q.since));
        }
        const r = await this.gather(jobs);
        return { ...r, results: r.results.slice(0, q.limit) };
    }

    /**
     * Every watchlist item against the sources its kind points at, since a date.
     * CPSC takes one product name per request; openFDA takes an OR of phrases,
     * so each FDA category is one request whatever the watchlist size.
     */
    async household(items: WatchItem[], since: string): Promise<SearchResult & { matches: Array<Recall & { matchedItems: string[] }> }> {
        const want = (k: WatchItem['kind']) => items.filter((i) => i.kind === k || i.kind === 'any').map((i) => i.name);
        const products = want('product');
        const food = want('food');
        const meds = want('medicine');
        const jobs: Record<string, () => Promise<Recall[]>> = {};
        if (products.length) {
            jobs['US CPSC'] = async () =>
                (await Promise.all(products.map((p) => searchCpsc(this.fetchImpl, { productName: p, since })))).flat();
            jobs['openFDA devices'] = () => searchOpenFda(this.fetchImpl, 'device', { terms: products, since, until: this.today(), limit: 100 });
        }
        if (food.length) jobs['openFDA food'] = () => searchOpenFda(this.fetchImpl, 'food', { terms: food, since, until: this.today(), limit: 100 });
        if (meds.length) {
            jobs['openFDA drugs'] = () => searchOpenFda(this.fetchImpl, 'drug', { terms: meds, since, until: this.today(), limit: 100 });
            jobs['EMA shortages'] = async () =>
                (await this.emaShortages()).filter((r) => (!r.date || r.date >= since) && meds.some((m) => matchesMedicine(r, m)));
        }
        const r = await this.gather(jobs);
        const matches = r.results.map((rec) => ({ ...rec, matchedItems: matchedItems(rec, items) }));
        return { ...r, matches };
    }
}

function dedupe(rows: Recall[]): Recall[] {
    const seen = new Set<string>();
    return rows.filter((r) => {
        const k = `${r.source}|${r.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** Which watchlist items a record is about: every word of the item appears in the record's text. */
export function matchedItems(rec: Recall, items: WatchItem[]): string[] {
    const hay = `${rec.title} ${rec.products.join(' ')} ${rec.summary}`.toLowerCase();
    const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const full = items.filter((i) => words(i.name).every((w) => hay.includes(w))).map((i) => i.name);
    if (full.length) return full;
    // openFDA stems words ("mattresses" for "mattress"); fall back to any word.
    return items.filter((i) => words(i.name).some((w) => hay.includes(w.replace(/e?s$/, '')))).map((i) => i.name);
}
