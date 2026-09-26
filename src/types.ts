import { z } from 'zod';

export const SOURCES = ['cpsc', 'openfda-food', 'openfda-drug', 'openfda-device', 'ema-shortages'] as const;
export type SourceId = (typeof SOURCES)[number];

/** One recall or medicine alert, normalised across every upstream. */
export const RecallSchema = z.object({
    source: z.enum(SOURCES).describe('Which public data source this came from.'),
    id: z.string().describe('The upstream identifier (CPSC recall number, FDA recall number, EMA shortage URL).'),
    title: z.string(),
    hazard: z.string().describe('What is wrong, as the source states it.'),
    remedy: z.string().describe('What to do, as the source states it, or a safe default when the source gives none.'),
    date: z.string().describe('ISO date (YYYY-MM-DD) the source published or last updated this item.'),
    products: z.array(z.string()),
    url: z.string().describe('A public URL where this item can be checked.'),
    summary: z.string().describe('One sentence, written to be read aloud.'),
});
export type Recall = z.infer<typeof RecallSchema>;

/** Swappable for tests; the real one is globalThis.fetch. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
