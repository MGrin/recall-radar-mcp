/** US Consumer Product Safety Commission recalls (saferproducts.gov). Public domain, keyless. */
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

export async function searchCpsc(fetchImpl: FetchLike, q: { productName?: string; since: string }): Promise<Recall[]> {
    let body: unknown;
    try {
        body = await getJson(fetchImpl, cpscUrl(q), 'CPSC');
    } catch (err) {
        // CPSC answered 503 "Under Construction" for some URLs and 200 for others on 2026-10-02.
        // A second, date-only URL sometimes still answers; filter it here rather than lose the source.
        if (!q.productName || !(err instanceof UpstreamError)) throw err;
        const all = await getJson(fetchImpl, cpscUrl({ since: q.since }), 'CPSC');
        body = Array.isArray(all) ? all.filter((r) => matchesLocally(r as Record<string, unknown>, q.productName!)) : all;
    }
    if (!Array.isArray(body)) throw new UpstreamError('CPSC answered with something other than a list of recalls', 'CPSC');
    return body.map((r) => normaliseCpsc(r as Record<string, unknown>)).filter((r) => r.id);
}
