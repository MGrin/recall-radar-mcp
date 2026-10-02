/**
 * European Medicines Agency: medicine shortages catalogue (JSON report).
 *
 * Adapted from our own pre-existing code, the `ema-medicines-watch` Apify Actor: the
 * dd/mm/yyyy parser, the {meta, data[]} shape check and the truncation guard.
 *
 * EMA's legal notice permits reuse provided EMA is acknowledged as the source,
 * so every record carries EMA's URL.
 */
import { getJson, str, UpstreamError } from '../http-util.js';
import type { FetchLike, Recall } from '../types.js';

export const EMA_SHORTAGES_URL = 'https://www.ema.europa.eu/en/documents/report/shortages-output-json-report_en.json';

/** dd/mm/yyyy → YYYY-MM-DD; '' rather than a plausible wrong date. */
export function parseEuDate(v: unknown): string {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(v));
    if (!m) return '';
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return dt.toISOString().slice(0, 10);
}

export function normaliseEma(r: Record<string, unknown>): Recall {
    const name = str(r.medicine_affected);
    const inn = str(r.international_non_proprietary_name_inn_or_common_name);
    const status = str(r.supply_shortage_status) || 'Shortage status not stated';
    const alternatives = str(r.availability_of_alternatives);
    const forms = str(r.pharmaceutical_forms_affected);
    const expected = parseEuDate(r.expected_resolution_date) || str(r.expected_resolution);
    const date = parseEuDate(r.last_updated_date) || parseEuDate(r.first_published_date);
    const alt = alternatives.toLowerCase();
    const remedy = alt.startsWith('yes')
        ? `EMA says alternatives are available (${alternatives}). Do not stop a medicine on your own; ask your pharmacist or doctor.`
        : `EMA lists alternatives as: ${alternatives || 'not stated'}. Do not stop a medicine on your own; ask your pharmacist or doctor.`;
    return {
        source: 'ema-shortages',
        id: str(r.shortage_url),
        title: name,
        hazard: `${status}${forms ? ` (${forms})` : ''}${expected ? `; expected resolution: ${expected}` : ''}.`,
        remedy,
        date,
        products: [name, ...inn.split(';').map((s) => s.trim()).filter(Boolean)].filter((v, i, a) => v && a.indexOf(v) === i),
        url: str(r.shortage_url),
        summary: `In the EU, ${name}${inn && inn.toLowerCase() !== name.toLowerCase() ? ` (${inn.replaceAll(';', ', ')})` : ''}: ${status.toLowerCase()}${expected && !/resolved|discontinued/i.test(status) ? `, expected to resolve ${expected}` : ''}, per EMA, updated ${date || 'on an unstated date'}.`,
    };
}

export async function fetchEmaShortages(fetchImpl: FetchLike): Promise<Recall[]> {
    const body = (await getJson(fetchImpl, EMA_SHORTAGES_URL, 'EMA', { timeoutMs: 10_000 })) as
        | { meta?: { total_records?: number }; data?: unknown[] }
        | null;
    if (!body || !Array.isArray(body.data) || typeof body.meta !== 'object') {
        throw new UpstreamError('EMA shortages file has no {meta, data[]}; its shape changed', 'EMA');
    }
    if (typeof body.meta?.total_records === 'number' && body.meta.total_records !== body.data.length) {
        throw new UpstreamError(`EMA shortages file looks truncated (${body.data.length} of ${body.meta.total_records} rows)`, 'EMA');
    }
    return body.data.map((r) => normaliseEma(r as Record<string, unknown>)).filter((r) => r.id);
}

/** Case-insensitive match on the medicine name or any INN. */
export function matchesMedicine(r: Recall, term: string): boolean {
    const t = term.toLowerCase().trim();
    return t !== '' && [r.title, ...r.products].some((p) => p.toLowerCase().includes(t));
}
