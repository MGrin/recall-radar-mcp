import { describe, expect, it } from 'vitest';
import { RecallSchema } from '../src/types.js';
import { RecallService } from '../src/service.js';
import {
    MAX_REPORTS, matchesEuQuery, parseReport, parseReportList, SAFETY_GATE_ATTRIBUTION, selectReports,
} from '../src/sources/safetygate.js';
import { fixture, fixtureFetch, NOW } from './helpers.js';

describe('EU Safety Gate: parsing', () => {
    it('reads the weekly-report index with ISO dates and report ids', () => {
        const list = parseReportList(fixture('safetygate-list.xml'));
        expect(list.map((r) => [r.reference, r.date, r.id])).toEqual([
            ['Report-2026-39', '2026-10-02', '10000325'],
            ['Report-2026-38', '2026-09-25', '10000324'],
            ['Report-2026-37', '2026-09-18', '10000323'],
            ['Report-2026-29', '2026-07-24', '10000315'],
        ]);
    });

    it('normalises an alert into the shared recall shape', () => {
        const rows = parseReport(fixture('safetygate-report-10000324.xml'));
        expect(rows).toHaveLength(4);
        rows.forEach((r) => RecallSchema.parse(r));
        const blocks = rows.find((r) => r.id === 'SR/02546/26')!;
        expect(blocks).toMatchObject({ source: 'eu-safety-gate', date: '2026-09-25', title: 'Tickit Sensory Blocks Set of 16' });
        expect(blocks.url).toMatch(/^https:\/\/ec\.europa\.eu\/safety-gate-alerts\/screen\/webReport\/alertDetail\/\d+$/);
        expect(blocks.products).toEqual(expect.arrayContaining(['Sand-filled toy', 'Tickit']));
        expect(blocks.summary).toMatch(/^In the EU, Safety Gate flagged Tickit Sensory Blocks Set of 16 \(toys\) on 2026-09-25/);
        expect(blocks.remedy).toMatch(/notice/);
    });

    it('drops the literal brand "None" rather than reading it as a brand', () => {
        const kettle = parseReport(fixture('safetygate-report-10000323.xml')).find((r) => r.id === 'SR/02499/26')!;
        expect(kettle.title).toBe('Stainless Steel Travel Electric Kettle');
        expect(kettle.products).not.toContain('None');
        expect(kettle.hazard).toMatch(/^Burns, Electric shock/);
    });

    it('states the measure taken, as the source states it', () => {
        const all = [...parseReport(fixture('safetygate-report-10000324.xml')), ...parseReport(fixture('safetygate-report-10000323.xml'))];
        expect(all.every((r) => r.remedy.length > 20)).toBe(true);
        expect(all.some((r) => /Recall of the product from end users|Withdrawal of the product from the market/i.test(r.remedy))).toBe(true);
    });

    it('refuses a body that is not a Safety Gate document', () => {
        expect(() => parseReportList('<html>maintenance</html>')).toThrow(/Safety Gate/);
    });
});

describe('EU Safety Gate: selection and matching', () => {
    const list = parseReportList(fixture('safetygate-list.xml'));

    it('keeps reports published in the window, newest first, never one dated after today', () => {
        expect(selectReports(list, '2026-09-01', '2026-09-26').reports.map((r) => r.reference)).toEqual(['Report-2026-38', 'Report-2026-37']);
        expect(selectReports(list, '2026-09-19', '2026-10-02').reports.map((r) => r.reference)).toEqual(['Report-2026-39', 'Report-2026-38']);
    });

    it('reads at most MAX_REPORTS weekly reports and says so', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ reference: `R${i}`, date: `2026-0${1 + Math.floor(i / 10)}-${String(10 + (i % 10)).padStart(2, '0')}`, id: String(i) }));
        const r = selectReports(many, '2025-01-01', '2026-09-26');
        expect(r.reports).toHaveLength(MAX_REPORTS);
        expect(r.truncated).toBe(true);
    });

    it('matches every word of the query, or a barcode exactly', () => {
        const rows = parseReport(fixture('safetygate-report-10000324.xml'));
        expect(rows.filter((r) => matchesEuQuery(r, 'usb charger')).map((r) => r.id)).toEqual(['SR/02540/26']);
        expect(rows.filter((r) => matchesEuQuery(r, 'HYUNDAI ioniq6')).map((r) => r.id)).toEqual(['SR/02583/26']);
        expect(rows.filter((r) => matchesEuQuery(r, 'charger kettle'))).toEqual([]);
        const withBarcode = rows.find((r) => r.products.some((p) => /^\d{8,14}$/.test(p)));
        if (withBarcode) {
            const code = withBarcode.products.find((p) => /^\d{8,14}$/.test(p))!;
            expect(rows.filter((r) => matchesEuQuery(r, code)).map((r) => r.id)).toEqual([withBarcode.id]);
        }
    });

    it('carries the Commission-mandated attribution verbatim', () => {
        expect(SAFETY_GATE_ATTRIBUTION).toBe(
            'Alerts from the Rapid Alert System for dangerous non-food products, published free of charge on the Safety Gate website (https://ec.europa.eu/safety-gate-alerts) © European Union, 2005 – 2026',
        );
    });
});

describe('EU Safety Gate: service', () => {
    it('searches the window, reads each weekly report once, and caches it', async () => {
        const f = fixtureFetch();
        const svc = new RecallService(f.impl, NOW);
        const r = await svc.euProducts({ query: 'charger', since: '2026-09-01', limit: 5 });
        expect(r.warnings).toEqual([]);
        expect(r.results.map((x) => x.source)).toEqual(['eu-safety-gate']);
        expect(r.results[0].date).toBe('2026-09-25');
        const details = () => f.calls.filter((c) => c.includes('/weeklyReport/detail/')).length;
        expect(details()).toBe(2);
        const again = await svc.euProducts({ query: 'kettle', since: '2026-09-01', limit: 5 });
        expect(again.results.map((x) => x.id)).toEqual(['SR/02499/26']);
        expect(details()).toBe(2);
        expect(f.calls.filter((c) => c.endsWith('/weeklyReport/list/xml/en'))).toHaveLength(1);
    });

    it('a weekly report that fails becomes a warning; the rest still answer', async () => {
        const f = fixtureFetch();
        const svc = new RecallService(f.impl, () => new Date('2026-10-02T12:00:00Z'));
        const r = await svc.euProducts({ query: 'charger', since: '2026-09-15', limit: 5 });
        expect(r.warnings).toEqual([expect.stringMatching(/^EU Safety Gate Report-2026-39 unavailable: .*HTTP 404/)]);
        expect(r.results.map((x) => x.id)).toEqual(['SR/02540/26']);
    });

    it('Safety Gate down: the search fails cleanly', async () => {
        const svc = new RecallService(fixtureFetch({ fail: { sg: 'http500' } }).impl, NOW);
        await expect(svc.euProducts({ query: 'charger', since: '2026-09-01', limit: 5 })).rejects.toThrow(/Every source failed/);
    });

    it('the household check does not read Safety Gate (its US default is unchanged)', async () => {
        const f = fixtureFetch();
        const svc = new RecallService(f.impl, NOW);
        await svc.household([{ id: '1', name: 'usb charger', kind: 'any', addedAt: '2026-09-01T00:00:00Z' }], '2026-03-30');
        expect(f.calls.some((c) => c.includes('ec.europa.eu'))).toBe(false);
    });
});
