import { describe, expect, it } from 'vitest';
import { Watchlist } from '../src/watchlist.js';
import { tmpWatchlist } from './helpers.js';

describe('Watchlist', () => {
    it('adds, dedupes case-insensitively, lists and removes; persists to disk', async () => {
        const path = tmpWatchlist();
        const w = new Watchlist(path);
        expect(await w.list()).toEqual([]);
        expect((await w.add('Crib  Mattress', 'product')).added).toBe(true);
        expect((await w.add('crib mattress', 'any')).added).toBe(false);
        await w.add('ibuprofen', 'medicine');
        expect((await new Watchlist(path).list()).map((i) => i.name)).toEqual(['Crib Mattress', 'ibuprofen']);
        expect((await w.remove('CRIB MATTRESS'))?.name).toBe('Crib Mattress');
        expect(await w.remove('nothing')).toBeNull();
        expect((await w.list()).map((i) => i.name)).toEqual(['ibuprofen']);
    });
    it('does not lose concurrent writes', async () => {
        const w = new Watchlist(tmpWatchlist());
        await Promise.all(Array.from({ length: 10 }, (_, i) => w.add(`item ${i}`, 'any')));
        expect(await w.list()).toHaveLength(10);
    });
});
