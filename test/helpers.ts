import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '../src/types.js';

export const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

export const tmpWatchlist = (): string => join(mkdtempSync(join(tmpdir(), 'rr-')), 'watchlist.json');

/** Routes upstream URLs to recorded fixtures. `fail` makes a named host misbehave. */
export function fixtureFetch(opts: {
    fail?: Partial<Record<'cpsc' | 'fda' | 'ema' | 'sg', 'http500' | 'network' | 'timeout'>>;
    empty?: boolean;
    /** CPSC answers only the URLs this accepts; the rest get 503 "Under Construction", as seen 2026-10-02..04. */
    cpscAnswers?: (u: URL) => boolean;
} = {}) {
    const calls: string[] = [];
    const impl: FetchLike = async (url, init) => {
        calls.push(url);
        const u = new URL(url);
        const key = u.hostname.includes('saferproducts') ? 'cpsc' : u.hostname === 'api.fda.gov' ? 'fda' : u.hostname.includes('ema.europa.eu') ? 'ema'
            : u.hostname === 'ec.europa.eu' && u.pathname.startsWith('/safety-gate-alerts/') ? 'sg' : null;
        if (!key) throw new Error(`unexpected upstream in test: ${url}`);
        const mode = opts.fail?.[key];
        if (mode === 'network') throw new TypeError('fetch failed');
        if (mode === 'timeout') {
            return new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
            });
        }
        if (mode === 'http500') return new Response('oops', { status: 500 });
        const json = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'application/json' } });
        if (key === 'cpsc' && opts.cpscAnswers && !opts.cpscAnswers(u)) return new Response('Under Construction', { status: 503 });
        if (key === 'cpsc') return json(opts.empty ? '[]' : fixture('cpsc-crib.json'));
        if (key === 'ema') return json(fixture('ema-shortages.json'));
        if (key === 'sg') {
            const xml = (name: string) => new Response(fixture(name), { status: 200, headers: { 'Content-Type': 'application/xml' } });
            if (u.pathname.endsWith('/weeklyReport/list/xml/en')) return xml('safetygate-list.xml');
            const id = /\/weeklyReport\/detail\/xml\/(\d+)$/.exec(u.pathname)?.[1];
            if (id && existsSync(join(import.meta.dirname, 'fixtures', `safetygate-report-${id}.xml`))) return xml(`safetygate-report-${id}.xml`);
            return new Response('not found', { status: 404 });
        }
        if (opts.empty) return json(fixture('openfda-not-found.json'), 404);
        if (u.pathname.startsWith('/food/')) return json(fixture('openfda-food-peanut.json'));
        if (u.pathname.startsWith('/drug/')) return json(fixture('openfda-drug-ibuprofen.json'));
        if (u.pathname.startsWith('/device/')) return json(fixture('openfda-device-thermometer.json'));
        return json(fixture('openfda-not-found.json'), 404);
    };
    return { impl, calls };
}

/** A fixed clock so default date windows are deterministic. */
export const NOW = () => new Date('2026-09-26T12:00:00Z');
