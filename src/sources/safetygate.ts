/**
 * EU Safety Gate (formerly RAPEX): the European Commission's weekly alerts on dangerous
 * non-food products, read from the portal's own XML export.
 *
 * Adapted from our own pre-existing code, the `eu-recall-watchlist` Apify Actor: the XML
 * parser settings, the CDATA unwrapping, the dd/mm/yyyy parser, the run-together `measures`
 * field and the verbatim attribution.
 *
 * Reuse terms (Safety Gate disclaimer, "REUSE OF ALERTS", read 2026-09-11 and its revision
 * chain re-checked 2026-10-02): reuse is authorised provided the meaning of the alerts is not
 * distorted and the source is acknowledged in exactly the words of SAFETY_GATE_ATTRIBUTION.
 * So every answer carries that sentence, and every record links the official alert.
 *
 * The feed is weekly (Fridays). The index lists every report since 2005; one report is about
 * 200-300 KB and took 3-6 seconds to serve on 2026-10-02, so a search reads at most
 * MAX_REPORTS of them, a few at a time, and the service caches what it read.
 */
import { XMLParser } from 'fast-xml-parser';
import { firstSentence, sentence, UpstreamError, USER_AGENT } from '../http-util.js';
import type { FetchLike, Recall } from '../types.js';

export const SG_LIST_URL = 'https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en';
export const reportUrl = (id: string): string =>
    `https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/detail/xml/${id}?language=en&search=WEB_REPORT%7C:%7C${id},`;

/** Required verbatim by the Commission's Safety Gate disclaimer. Do not paraphrase: the wording is the licence condition. */
export const SAFETY_GATE_ATTRIBUTION =
    'Alerts from the Rapid Alert System for dangerous non-food products, published free ' +
    'of charge on the Safety Gate website (https://ec.europa.eu/safety-gate-alerts) ' +
    '© European Union, 2005 – 2026';

/** About three months of weekly reports. */
export const MAX_REPORTS = 12;
export const SG_TIMEOUT_MS = 20_000;

export interface ReportRef {
    reference: string;
    /** ISO publication date. */
    date: string;
    id: string;
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    cdataPropName: '#cdata',
    trimValues: true,
    parseTagValue: false,
    isArray: (name) => name === 'weeklyReport' || name === 'notifications',
});

/** The feed wraps most text in CDATA; an empty element arrives as an attributes-only object. */
function text(node: unknown): string {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return node.replace(/\s+/g, ' ').trim();
    if (typeof node === 'number' || typeof node === 'boolean') return String(node);
    if (typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if ('#cdata' in o) return text(o['#cdata']);
        if ('#text' in o) return text(o['#text']);
    }
    return '';
}

/** dd/mm/yyyy → YYYY-MM-DD; '' for "Unknown" or anything impossible, never a guess. */
export function parseEuDate(raw: string): string {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
    if (!m) return '';
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return dt.toISOString().slice(0, 10);
}

function root(xml: string): Record<string, unknown> {
    const doc = parser.parse(xml) as Record<string, unknown>;
    const r = doc['Safety-Gate'];
    if (!r || typeof r !== 'object') throw new UpstreamError('EU Safety Gate answered without a <Safety-Gate> document; its shape changed', 'EU Safety Gate');
    return r as Record<string, unknown>;
}

/** The index of every weekly report, as published. */
export function parseReportList(xml: string): ReportRef[] {
    const rows = (root(xml).weeklyReport ?? []) as Record<string, unknown>[];
    return rows.map((r) => ({
        reference: text(r.reference),
        date: parseEuDate(text(r.publicationDate)),
        id: /\/xml\/(\d+)/.exec(text(r.URL))?.[1] ?? '',
    })).filter((r) => r.reference && r.date && r.id);
}

/** Reports published in [since, today], newest first, at most MAX_REPORTS. */
export function selectReports(list: ReportRef[], since: string, today: string): { reports: ReportRef[]; truncated: boolean } {
    const inWindow = list.filter((r) => r.date >= since && r.date <= today).sort((a, b) => b.date.localeCompare(a.date));
    return { reports: inWindow.slice(0, MAX_REPORTS), truncated: inWindow.length > MAX_REPORTS };
}

/**
 * The `measures` field runs label/value pairs together with no separator, e.g.
 * "Type of economic operator taking notified measure(s): RetailerCategory of measure(s): Withdrawal of the product from the marketDate of entry into force: Unknown".
 * Only the categories are spoken; the raw text stays on the official alert.
 */
export function measureCategories(raw: string): string[] {
    const out: string[] = [];
    const re = /Category of measure\(s\):\s*(.*?)(?=Date of entry into force:|Type of economic operator|$)/g;
    for (const m of raw.matchAll(re)) {
        const c = m[1].trim();
        if (c && !out.includes(c)) out.push(c);
    }
    return out;
}

/** "None" and "Unknown" are what the feed prints for "not stated". */
const stated = (s: string) => (/^(none|unknown|n\/a|-)$/i.test(s) ? '' : s);

export function normaliseAlert(n: Record<string, unknown>, reportDate: string): Recall {
    const brand = stated(text(n.brand));
    const name = stated(text(n.name));
    const product = stated(text(n.product));
    const category = stated(text(n.category));
    const model = stated(text(n.type_numberOfModel));
    const barcode = text(n.barcode).replace(/\D+/g, '');
    const risk = stated(text(n.riskType)) || 'Risk type not stated';
    const level = stated(text(n.level));
    const danger = text(n.danger);
    const measures = measureCategories(text(n.measures));
    const label = name || product || 'An unnamed product';
    const title = brand && !label.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${label}` : label;
    const caseNumber = text(n.caseNumber);
    return {
        source: 'eu-safety-gate',
        id: caseNumber,
        title,
        hazard: `${risk}${level ? ` (${level.toLowerCase()})` : ''}. ${danger ? firstSentence(danger, 240) : 'The alert gives no further detail.'}`,
        remedy: `${measures.length ? `${measures.map(sentence).join(' ')} ` : ''}Stop using the product and check the official Safety Gate notice (case ${caseNumber}) for the batch and model affected.`,
        date: reportDate,
        products: [label, product, brand, model, barcode, category].filter((v, i, a) => v && a.indexOf(v) === i),
        url: text(n.reference),
        summary: `In the EU, Safety Gate flagged ${title}${category ? ` (${category.toLowerCase()})` : ''} on ${reportDate} for ${risk.toLowerCase()} risk${measures.length ? `; measure: ${measures[0].toLowerCase()}` : ''}.`,
    };
}

/** Every alert of one weekly report. */
export function parseReport(xml: string): Recall[] {
    const r = root(xml);
    const date = parseEuDate(text(r.report_date));
    const rows = (r.notifications ?? []) as Record<string, unknown>[];
    return rows.map((n) => normaliseAlert(n, date)).filter((x) => x.id && x.url);
}

/** A barcode (8-14 digits) matches exactly; otherwise every word of the query must appear. */
export function matchesEuQuery(r: Recall, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (/^\d{8,14}$/.test(q)) return r.products.includes(q);
    const hay = `${r.title} ${r.products.join(' ')} ${r.hazard}`.toLowerCase();
    const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
    return words.length > 0 && words.every((w) => hay.includes(w));
}

/** One polite GET: a self-identifying User-Agent, a timeout, no retries. */
export async function getSafetyGateXml(fetchImpl: FetchLike, url: string): Promise<string> {
    let res: Response;
    try {
        res = await fetchImpl(url, {
            headers: { Accept: 'application/xml,text/xml', 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(SG_TIMEOUT_MS),
        });
    } catch (err) {
        const e = err as Error;
        const why = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `timed out after ${SG_TIMEOUT_MS / 1000} seconds` : e?.message ?? String(err);
        throw new UpstreamError(`EU Safety Gate request failed: ${why}`, 'EU Safety Gate');
    }
    if (!res.ok) throw new UpstreamError(`EU Safety Gate answered HTTP ${res.status}`, 'EU Safety Gate', res.status);
    return res.text();
}
