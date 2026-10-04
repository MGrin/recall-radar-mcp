import { describe, expect, it } from 'vitest';
import { RecallSchema } from '../src/types.js';
import { getJson, firstSentence, UpstreamError } from '../src/http-util.js';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CPSC_MAX_ATTEMPTS, CpscClient, cpscUrl, fallbackStarts, normaliseCpsc } from '../src/sources/cpsc.js';
import { cleanTerm, openFdaUrl, searchOpenFda } from '../src/sources/openfda.js';
import { fetchEmaShortages, matchesMedicine, parseEuDate } from '../src/sources/ema.js';
import { fixture, fixtureFetch } from './helpers.js';

describe('CPSC', () => {
    it('builds the query URL', () => {
        const u = new URL(cpscUrl({ productName: 'crib', since: '2026-08-01' }));
        expect(u.searchParams.get('format')).toBe('json');
        expect(u.searchParams.get('RecallDateStart')).toBe('2026-08-01');
        expect(u.searchParams.get('ProductName')).toBe('crib');
    });
    it('normalises a recorded recall', () => {
        const r = normaliseCpsc(JSON.parse(fixture('cpsc-crib.json'))[0]);
        expect(RecallSchema.parse(r)).toBeTruthy();
        expect(r).toMatchObject({ source: 'cpsc', id: '26669', date: '2026-08-06' });
        expect(r.url).toMatch(/^https:\/\/www\.cpsc\.gov\/Recalls\/2026\//);
        expect(r.hazard).toMatch(/entrapment/);
        expect(r.remedy).toMatch(/refund/i);
        expect(r.summary).toMatch(/^Voomf Play Yard and Crib Mattresses was recalled on 2026-08-06; remedy: refund\./);
    });
    it('treats an empty list as no results', async () => {
        expect(await new CpscClient(fixtureFetch({ empty: true }).impl).search({ productName: 'x', since: '2026-01-01' })).toEqual({ results: [] });
    });

    it('treats a 200 carrying CPSC\'s own error row as an upstream failure, not a recall', async () => {
        const row = [{ RecallID: 0, RecallNumber: null, RecallDate: null, Title: 'Error retrieving Recalls: The underlying provider failed on Open.', Products: [] }];
        const impl = async () => new Response(JSON.stringify(row), { status: 200, headers: { 'Content-Type': 'application/json' } });
        await expect(new CpscClient(impl as never).search({ since: '2026-04-04' })).rejects.toThrow(/error row.*no saved copy/);
    });

    it('lists earlier start dates to fall back on, nearest first, never later than the window', () => {
        expect(fallbackStarts('2026-04-06')).toEqual(['2026-04-01', '2026-03-01', '2026-01-01']);
        expect(fallbackStarts('2026-04-01')).toEqual(['2026-03-01', '2026-01-01']);
        expect(fallbackStarts('2026-01-15')).toEqual(['2026-01-01', '2025-12-01']);
        // A known date more than 400 days before the window is not tried.
        expect(fallbackStarts('2027-06-10')).toEqual(['2027-06-01', '2027-05-01']);
    });
});

/** A CPSC that answers only the URLs `answers` accepts; every other URL gets 503 "Under Construction". */
function flakyCpsc(answers: (u: URL) => boolean, body = () => fixture('cpsc-crib.json')) {
    const calls: string[] = [];
    const impl = async (url: string) => {
        calls.push(url);
        return answers(new URL(url))
            ? new Response(body(), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : new Response('Under Construction', { status: 503 });
    };
    return { impl: impl as never, calls };
}
const start = (u: URL) => u.searchParams.get('RecallDateStart');
const cacheFile = () => join(mkdtempSync(join(tmpdir(), 'rr-cpsc-')), 'cpsc-cache.json');

describe('CPSC resilient read', () => {
    it('exact window answers: one request, no note, no warning', async () => {
        const f = flakyCpsc(() => true);
        const out = await new CpscClient(f.impl).search({ productName: 'crib mattress', since: '2026-04-06' });
        expect(f.calls).toHaveLength(1);
        expect(out.results.map((r) => r.id)).toContain('26669');
        expect(out.note).toBeUndefined();
        expect(out.warning).toBeUndefined();
    });

    it('window URL 503s: falls back to an earlier start date, filters locally, and names the URL that served it', async () => {
        // The 2026-10-04 shape: 2026-04-06 and 2026-03-01 answer 503, 2026-04-01 answers.
        const f = flakyCpsc((u) => start(u) === '2026-04-01' && !u.searchParams.has('ProductName'));
        const out = await new CpscClient(f.impl).search({ productName: 'crib mattress', since: '2026-04-06' });
        expect(f.calls.map((c) => [start(new URL(c)), new URL(c).searchParams.has('ProductName')])).toEqual([
            ['2026-04-06', true], ['2026-04-06', false], ['2026-04-01', false],
        ]);
        expect(out.results.map((r) => r.id)).toEqual(['26669']);
        expect(out.note).toMatch(/requested query failed \(2026-04-06 with product filter: CPSC answered HTTP 503; 2026-04-06: CPSC answered HTTP 503\)/);
        expect(out.note).toContain('served by https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-04-01');
        expect(out.warning).toBeUndefined();
        expect(out.results[0].summary).not.toMatch(/saved copy/);
        expect(await new CpscClient(f.impl).search({ productName: 'zzz-no-such-thing', since: '2026-04-06' })).toMatchObject({ results: [] });
    });

    it('drops rows earlier than the window when a wider window served them', async () => {
        const [row] = JSON.parse(fixture('cpsc-crib.json'));
        const older = { ...row, RecallNumber: '26001', RecallID: 1, RecallDate: '2026-04-20T00:00:00' };
        const f = flakyCpsc((u) => start(u) === '2026-04-01', () => JSON.stringify([row, older]));
        const out = await new CpscClient(f.impl).search({ productName: 'crib mattress', since: '2026-05-02' });
        expect(f.calls.map((c) => start(new URL(c)))).toEqual(['2026-05-02', '2026-05-02', '2026-05-01', '2026-04-01']);
        expect(out.results.map((r) => r.id)).toEqual(['26669']);
    });

    it('bounds the attempts', async () => {
        const f = flakyCpsc(() => false);
        await expect(new CpscClient(f.impl).search({ productName: 'crib', since: '2026-04-06' })).rejects.toThrow(/5 live CPSC attempts failed/);
        expect(f.calls.length).toBeLessThanOrEqual(CPSC_MAX_ATTEMPTS);
    });

    it('every live attempt fails, a saved copy exists: serves it labelled STALE with its fetch time', async () => {
        const path = cacheFile();
        const t0 = new Date('2026-10-03T09:00:00Z');
        const good = flakyCpsc(() => true);
        await new CpscClient(good.impl, { cachePath: path, now: () => t0 }).search({ productName: 'crib mattress', since: '2026-04-01' });
        expect(existsSync(path)).toBe(true);

        // A new process (fresh client, cache read from disk), and CPSC is down everywhere.
        const down = flakyCpsc(() => false);
        const out = await new CpscClient(down.impl, { cachePath: path }).search({ productName: 'crib mattress', since: '2026-04-06' });
        expect(down.calls.length).toBeGreaterThan(0);
        expect(out.results.map((r) => r.id)).toEqual(['26669']);
        expect(out.warning).toMatch(/^US CPSC unavailable live: \d live CPSC attempts failed .*Showing a STALE saved copy fetched 2026-10-03T09:00:00.000Z from .*RecallDateStart=2026-04-01.*: 1 matching row\.$/);
        expect(out.results[0].summary).toMatch(/\(From a saved copy of CPSC data fetched 2026-10-03; CPSC could not be reached live\.\)$/);
        expect(out.note).toBeUndefined();
    });

    it('a saved copy for a different product is not used for this one; a date-only copy is, filtered', async () => {
        const path = cacheFile();
        await new CpscClient(flakyCpsc(() => true).impl, { cachePath: path }).search({ productName: 'stroller', since: '2026-01-01' });
        const down = flakyCpsc(() => false);
        await expect(new CpscClient(down.impl, { cachePath: path }).search({ productName: 'crib mattress', since: '2026-04-06' }))
            .rejects.toThrow(/no saved copy/);
        await new CpscClient(flakyCpsc(() => true).impl, { cachePath: path }).search({ since: '2026-01-01' });
        const out = await new CpscClient(down.impl, { cachePath: path }).search({ productName: 'crib mattress', since: '2026-04-06' });
        expect(out.results.map((r) => r.id)).toEqual(['26669']);
        expect(out.warning).toMatch(/STALE/);
    });

    it('every live attempt fails and there is no saved copy: a source failure, nothing invented', async () => {
        const f = flakyCpsc(() => false);
        await expect(new CpscClient(f.impl, { cachePath: cacheFile() }).search({ productName: 'crib mattress', since: '2026-04-06' }))
            .rejects.toThrow(/live CPSC attempts failed .*no saved copy to fall back on/);
    });
});

describe('openFDA', () => {
    it('builds a date-ranged OR search with sanitised phrases', () => {
        const u = new URL(openFdaUrl('food', { terms: ['peanut "butter"', 'crib:'], since: '2026-06-01', until: '2026-09-26', limit: 5 }));
        expect(u.pathname).toBe('/food/enforcement.json');
        expect(u.searchParams.get('search')).toBe('report_date:[20260601 TO 20260926] AND (product_description:"peanut butter" OR product_description:"crib")');
        expect(u.searchParams.get('sort')).toBe('report_date:desc');
        expect(cleanTerm('a"b\\c')).toBe('a b c');
        const both = new URL(openFdaUrl('food', { terms: ['listeria'], since: '2026-01-01', until: '2026-01-02', limit: 1, fields: ['product_description', 'reason_for_recall'] }));
        expect(both.searchParams.get('search')).toBe('report_date:[20260101 TO 20260102] AND (product_description:"listeria" OR reason_for_recall:"listeria")');
    });
    it('normalises recorded drug recalls', async () => {
        const rs = await searchOpenFda(fixtureFetch().impl, 'drug', { terms: ['ibuprofen'], since: '2025-01-01', limit: 3 });
        expect(rs).toHaveLength(3);
        for (const r of rs) RecallSchema.parse(r);
        expect(rs[0]).toMatchObject({ source: 'openfda-drug', date: '2026-09-02' });
        expect(rs[0].url).toContain('recall_number');
        expect(rs[0].hazard).toMatch(/Cross Contamination/);
        expect(rs[0].remedy).toMatch(/Do not stop or change a medicine on your own; ask a pharmacist or doctor/);
        expect(rs[0].remedy).not.toMatch(/if in doubt, stop using it/i);
    });
    it('does not tell someone to stop using a recalled medical device by default', async () => {
        const rs = await searchOpenFda(fixtureFetch().impl, 'device', { terms: ['thermometer'], since: '2025-01-01', limit: 3 });
        expect(rs[0].source).toBe('openfda-device');
        expect(rs[0].remedy).toMatch(/ask your health care provider/);
        expect(rs[0].remedy).not.toMatch(/if in doubt, stop using it/i);
    });
    it('reads openFDA 404 "No matches found" as an empty result', async () => {
        expect(await searchOpenFda(fixtureFetch({ empty: true }).impl, 'food', { terms: ['zz'], since: '2026-01-01', limit: 3 })).toEqual([]);
    });
    it('turns HTTP 500 into an UpstreamError', async () => {
        await expect(searchOpenFda(fixtureFetch({ fail: { fda: 'http500' } }).impl, 'food', { terms: ['x'], since: '2026-01-01', limit: 1 }))
            .rejects.toThrow(/HTTP 500/);
    });
});

describe('EMA shortages', () => {
    it('parses EU dates strictly', () => {
        expect(parseEuDate('22/09/2026')).toBe('2026-09-22');
        expect(parseEuDate('31/02/2026')).toBe('');
        expect(parseEuDate('')).toBe('');
    });
    it('normalises the recorded file and matches by name or INN', async () => {
        const rs = await fetchEmaShortages(fixtureFetch().impl);
        expect(rs).toHaveLength(6);
        for (const r of rs) RecallSchema.parse(r);
        const oz = rs.find((r) => r.title === 'Ozempic')!;
        expect(oz.date).toBe('2026-01-13');
        expect(oz.url).toMatch(/^https:\/\/www\.ema\.europa\.eu\//);
        expect(matchesMedicine(oz, 'semaglutide')).toBe(true);
        expect(oz.summary).toMatch(/^In the EU, Ozempic \(semaglutide\): shortage resolved/);
    });
    it('rejects a truncated file', async () => {
        const f = JSON.parse(fixture('ema-shortages.json'));
        f.meta.total_records = 99;
        const impl = async () => new Response(JSON.stringify(f), { status: 200 });
        await expect(fetchEmaShortages(impl)).rejects.toThrow(/truncated/);
    });
});

describe('getJson', () => {
    it('times out cleanly', async () => {
        const err = await getJson(fixtureFetch({ fail: { cpsc: 'timeout' } }).impl, 'https://www.saferproducts.gov/x', 'CPSC', { timeoutMs: 50 })
            .catch((e) => e);
        expect(err).toBeInstanceOf(UpstreamError);
        expect(err.message).toMatch(/timed out/);
    });
    it('reports non-JSON', async () => {
        await expect(getJson(async () => new Response('<html>'), 'https://x', 'X')).rejects.toThrow(/not answer with JSON/);
    });
    it('firstSentence caps and cuts', () => {
        expect(firstSentence('One two. Three.')).toBe('One two.');
        expect(firstSentence('x'.repeat(300), 10)).toHaveLength(10);
    });
});
