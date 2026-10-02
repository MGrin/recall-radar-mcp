import { describe, expect, it } from 'vitest';
import { RecallSchema } from '../src/types.js';
import { getJson, firstSentence, UpstreamError } from '../src/http-util.js';
import { cpscUrl, normaliseCpsc, searchCpsc } from '../src/sources/cpsc.js';
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
        expect(await searchCpsc(fixtureFetch({ empty: true }).impl, { productName: 'x', since: '2026-01-01' })).toEqual([]);
    });

    it('falls back to a date-only fetch and filters locally when the filtered query fails', async () => {
        const calls: string[] = [];
        const impl = async (url: string) => {
            calls.push(url);
            if (new URL(url).searchParams.has('ProductName')) return new Response('Under Construction', { status: 503 });
            return new Response(fixture('cpsc-crib.json'), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const hit = await searchCpsc(impl as never, { productName: 'crib mattress', since: '2026-07-01' });
        expect(calls).toHaveLength(2);
        expect(hit.length).toBeGreaterThan(0);
        expect(hit[0].id).toBe('26669');
        expect(await searchCpsc(impl as never, { productName: 'zzz-no-such-thing', since: '2026-07-01' })).toEqual([]);
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
