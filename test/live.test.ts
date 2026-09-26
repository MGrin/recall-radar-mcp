/** Opt-in: LIVE=1 npm test. Hits the real public APIs once each. */
import { describe, expect, it } from 'vitest';
import { RecallService } from '../src/service.js';
import { RecallSchema } from '../src/types.js';

const live = process.env.LIVE === '1';

describe.skipIf(!live)('live upstreams', () => {
    const svc = new RecallService((u, i) => fetch(u, i));
    const since = svc.daysAgo(3650);
    it('CPSC + openFDA device', async () => {
        const r = await svc.products({ query: 'stroller', since, limit: 3 });
        expect(r.warnings).toEqual([]);
        expect(r.results.length).toBeGreaterThan(0);
        r.results.forEach((x) => RecallSchema.parse(x));
    }, 30_000);
    it('openFDA food', async () => {
        const r = await svc.food({ query: 'peanut', since, limit: 3 });
        expect(r.warnings).toEqual([]);
        expect(r.results.length).toBeGreaterThan(0);
    }, 30_000);
    it('openFDA drug + EMA shortages', async () => {
        const r = await svc.medicines({ query: 'insulin', since, limit: 10, region: 'all' });
        expect(r.warnings).toEqual([]);
        expect(r.results.some((x) => x.source === 'ema-shortages')).toBe(true);
    }, 30_000);
});
