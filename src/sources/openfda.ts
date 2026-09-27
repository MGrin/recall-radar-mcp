/**
 * openFDA enforcement reports (food, drug, device). US government data, public domain (CC0).
 * openFDA's own disclaimer: do not rely on it to make decisions regarding medical care.
 */
import { firstSentence, getJson, sentence, str, UpstreamError } from '../http-util.js';
import type { FetchLike, Recall, SourceId } from '../types.js';

export type FdaCategory = 'food' | 'drug' | 'device';
export interface OpenFdaQuery {
    terms: string[];
    since: string;
    until?: string;
    limit: number;
    /** Fields each term is matched against (OR). Default: product_description. */
    fields?: Array<'product_description' | 'reason_for_recall' | 'recalling_firm'>;
}
export const OPENFDA_BASE = 'https://api.fda.gov';

/** Keep only characters safe inside an openFDA quoted phrase. */
export const cleanTerm = (t: string): string => t.replace(/["\\:()[\]{}+^~*?!]/g, ' ').replace(/\s+/g, ' ').trim();
const ymd = (iso: string): string => iso.replaceAll('-', '');
const isoOf = (d: string): string => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');

export function openFdaUrl(category: FdaCategory, q: OpenFdaQuery): string {
    const until = q.until ?? new Date().toISOString().slice(0, 10);
    const fields = q.fields ?? ['product_description'];
    const phrases = q.terms.map(cleanTerm).filter(Boolean).flatMap((t) => fields.map((f) => `${f}:"${t}"`));
    const search = `report_date:[${ymd(q.since)} TO ${ymd(until)}]${phrases.length ? ` AND (${phrases.join(' OR ')})` : ''}`;
    const u = new URL(`${OPENFDA_BASE}/${category}/enforcement.json`);
    u.searchParams.set('search', search);
    u.searchParams.set('limit', String(q.limit));
    u.searchParams.set('sort', 'report_date:desc');
    return u.toString();
}

/** A stable public URL that returns exactly this record. openFDA has no per-recall web page. */
export const recordUrl = (category: FdaCategory, recallNumber: string): string =>
    `${OPENFDA_BASE}/${category}/enforcement.json?search=recall_number:"${encodeURIComponent(recallNumber)}"`;

export function normaliseOpenFda(category: FdaCategory, row: Record<string, unknown>): Recall {
    const desc = str(row.product_description).replace(/\s+/g, ' ');
    const firm = str(row.recalling_firm);
    const cls = str(row.classification);
    const status = str(row.status);
    const reason = str(row.reason_for_recall);
    const date = isoOf(str(row.report_date));
    const shortName = desc.length > 90 ? `${desc.slice(0, 89).trimEnd()}…` : desc;
    const recallNumber = str(row.recall_number);
    const safetyNote = category === 'drug'
        ? 'Do not stop or change a medicine on your own; ask a pharmacist or doctor.'
        : category === 'device'
            ? 'For medical devices, ask your health care provider before changing use.'
            : 'If in doubt, stop using it.';
    return {
        source: `openfda-${category}` as SourceId,
        id: recallNumber,
        title: shortName || `${category} recall by ${firm}`,
        hazard: reason,
        remedy: `${cls ? `${cls} recall, status ${status.toLowerCase() || 'unknown'}. ` : ''}Check the lot or code on your package (${firstSentence(str(row.code_info) || 'see the recall notice', 120)}) and follow ${firm || 'the recalling firm'}'s instructions. ${safetyNote}`,
        date,
        products: desc ? [desc] : [],
        url: recallNumber ? recordUrl(category, recallNumber) : `${OPENFDA_BASE}/${category}/enforcement.json`,
        summary: `${firm || 'A firm'} recalled ${shortName || `a ${category} product`}, reported ${date}: ${sentence(firstSentence(reason, 140))}`,
    };
}

export async function searchOpenFda(
    fetchImpl: FetchLike,
    category: FdaCategory,
    q: OpenFdaQuery,
): Promise<Recall[]> {
    const body = await getJson(fetchImpl, openFdaUrl(category, q), `openFDA ${category}`, { emptyOnStatus: 404 });
    if (body === null) return [];
    const results = (body as { results?: unknown }).results;
    if (!Array.isArray(results)) throw new UpstreamError(`openFDA ${category} answered without a results list`, `openFDA ${category}`);
    return results.map((r) => normaliseOpenFda(category, r as Record<string, unknown>));
}
