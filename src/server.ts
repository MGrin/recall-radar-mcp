/** The MCP server: eight tools, voice-shaped output, structured content on every result. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RecallService, type SearchResult } from './service.js';
import { RecallSchema, type FetchLike, type Recall } from './types.js';
import { SAFETY_GATE_ATTRIBUTION } from './sources/safetygate.js';
import { KINDS, Watchlist, WatchItemSchema } from './watchlist.js';

export const SERVER_NAME = 'recall-radar';
export const SERVER_VERSION = '0.2.0';
export const DISCLAIMER = 'Not medical or safety advice: always check the linked notice and ask a pharmacist, doctor or the manufacturer.';

export interface Deps {
    service: RecallService;
    watchlist: Watchlist;
}

/** Default look-back of check_my_household. Half a year: a recall stays findable long after the week it was news. */
export const HOUSEHOLD_DEFAULT_DAYS = 180;

/** Default look-back of search_eu_product_recalls: four weekly Safety Gate reports. */
export const EU_DEFAULT_DAYS = 28;

export function makeDeps(opts: { fetchImpl?: FetchLike; watchlistPath: string; now?: () => Date }): Deps {
    return {
        service: new RecallService(opts.fetchImpl ?? ((u, i) => fetch(u, i)), opts.now),
        watchlist: new Watchlist(opts.watchlistPath),
    };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const limit = z.number().int().min(1).max(20).default(5).describe('How many results to return, newest first. Keep it small for voice: 3 to 5.');

const searchOutput = {
    spoken: z.string().describe('A short answer to read aloud.'),
    query: z.string(),
    since: z.string(),
    count: z.number().int(),
    results: z.array(RecallSchema),
    warnings: z.array(z.string()).describe('Sources that could not be reached; the rest still answered.'),
    disclaimer: z.string(),
};

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function spokenFor(kind: string, query: string, since: string, r: SearchResult): string {
    const head = r.results.length === 0
        ? `I found no ${kind} for "${query}" since ${since}.`
        : `I found ${plural(r.results.length, kind.replace(/s$/, ''))} for "${query}" since ${since}. The most recent: ${r.results[0].summary}`;
    const more = r.results.length > 1 ? ` Next: ${r.results[1].summary}` : '';
    const warn = r.warnings.length ? ` Note: ${r.warnings.length === 1 ? 'one source was' : 'some sources were'} unavailable, so this may be incomplete.` : '';
    return head + more + warn;
}

function ok(structured: Record<string, unknown> & { spoken: string }, extraText?: string): CallToolResult {
    return {
        content: [{ type: 'text', text: extraText ? `${structured.spoken}\n\n${extraText}` : structured.spoken }],
        structuredContent: structured,
    };
}

function fail(err: unknown): CallToolResult {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text', text: `Sorry, I could not check that right now. ${msg}` }] };
}

/** Wrap a handler so an upstream failure becomes a tool error, never a crash. */
function safe<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
    return async (args: A) => {
        try {
            return await fn(args);
        } catch (err) {
            return fail(err);
        }
    };
}

const sourcesLine = (rs: Recall[]) => rs.map((r) => `- [${r.source}] ${r.date} ${r.title} — ${r.url}`).join('\n');

export function createServer(deps: Deps): McpServer {
    const { service, watchlist } = deps;
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION, title: 'Recall Radar' },
        {
            instructions:
                'Household safety assistant over public recall data: US CPSC product recalls, openFDA food/drug/device enforcement reports, EMA (EU) medicine shortages and EU Safety Gate product alerts. ' +
                'Read the `spoken` field aloud; always offer the source URL and date. Never tell a user to stop a prescribed medicine; tell them to ask a pharmacist or doctor.',
        },
    );

    const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

    server.registerTool(
        'search_product_recalls',
        {
            title: 'Search product recalls',
            description:
                'Find recalls of household products (cribs, strollers, heaters, toys, appliances, e-bikes) and home medical devices by product name. ' +
                'Use when someone asks "has my <product> been recalled?". Searches US CPSC recalls and openFDA device recalls. Returns the hazard, the remedy, the date and a link.',
            inputSchema: {
                query: z.string().min(2).max(80).describe('Product name or type as the user said it, e.g. "crib mattress", "space heater".'),
                since: isoDate.optional().describe('Only recalls on or after this date (YYYY-MM-DD). Default: one year ago.'),
                limit,
            },
            outputSchema: searchOutput,
            annotations: readOnly,
        },
        safe(async ({ query, since, limit }) => {
            const from = since ?? service.daysAgo(365);
            const r = await service.products({ query, since: from, limit });
            const s = { spoken: spokenFor('product recalls', query, from, r), query, since: from, count: r.results.length, ...r, disclaimer: DISCLAIMER };
            return ok(s, sourcesLine(r.results));
        }),
    );

    server.registerTool(
        'search_food_recalls',
        {
            title: 'Search food recalls',
            description:
                'Find US food recalls (undeclared allergens, contamination such as Listeria or Salmonella, foreign objects) by food or brand name. ' +
                'Use when someone asks whether a food they bought is recalled. Source: openFDA food enforcement reports.',
            inputSchema: {
                query: z.string().min(2).max(80).describe('Food, ingredient or brand, e.g. "peanut butter", "romaine", "ice cream".'),
                since: isoDate.optional().describe('Only reports on or after this date (YYYY-MM-DD). Default: one year ago.'),
                limit,
            },
            outputSchema: searchOutput,
            annotations: readOnly,
        },
        safe(async ({ query, since, limit }) => {
            const from = since ?? service.daysAgo(365);
            const r = await service.food({ query, since: from, limit });
            return ok({ spoken: spokenFor('food recalls', query, from, r), query, since: from, count: r.results.length, ...r, disclaimer: DISCLAIMER }, sourcesLine(r.results));
        }),
    );

    server.registerTool(
        'search_medicine_alerts',
        {
            title: 'Search medicine recalls and shortages',
            description:
                'Find medicine recalls (US, openFDA drug enforcement) and medicine shortages (EU, European Medicines Agency) by brand or active ingredient. ' +
                'Use when someone asks whether their medicine is recalled or hard to get. Never advise stopping a medicine: the answer points to a pharmacist or doctor.',
            inputSchema: {
                query: z.string().min(2).max(80).describe('Medicine brand or active ingredient, e.g. "ibuprofen", "Ozempic", "insulin".'),
                region: z.enum(['us', 'eu', 'all']).default('all').describe('"us" for FDA recalls only, "eu" for EMA shortages only, "all" for both.'),
                since: isoDate.optional().describe('Only items on or after this date (YYYY-MM-DD). Default: one year ago.'),
                limit,
            },
            outputSchema: searchOutput,
            annotations: readOnly,
        },
        safe(async ({ query, region, since, limit }) => {
            const from = since ?? service.daysAgo(365);
            const r = await service.medicines({ query, region, since: from, limit });
            return ok({ spoken: spokenFor('medicine alerts', query, from, r), query, since: from, count: r.results.length, ...r, disclaimer: DISCLAIMER }, sourcesLine(r.results));
        }),
    );

    server.registerTool(
        'search_eu_product_recalls',
        {
            title: 'Search EU product recalls',
            description:
                'Find products flagged as dangerous in the European Union (toys, chargers, cosmetics, appliances, e-bikes, cars) by product, brand, model or barcode. ' +
                'Use when someone in Europe asks whether a product they bought was recalled or withdrawn. Source: EU Safety Gate weekly alerts (formerly RAPEX), up to the last 12 weekly reports. Returns the risk, the measure taken, the date and the official alert link.',
            inputSchema: {
                query: z.string().min(2).max(80).describe('Product, brand, model or barcode as the user said it, e.g. "usb charger", "Hyundai Ioniq 6", "4006381333931".'),
                since: isoDate.optional().describe(`Only alerts in weekly reports published on or after this date (YYYY-MM-DD). Default: ${EU_DEFAULT_DAYS} days ago. At most the 12 most recent weekly reports are read.`),
                limit,
            },
            outputSchema: { ...searchOutput, attribution: z.string().describe('The source credit the European Commission requires on any reuse of Safety Gate alerts.') },
            annotations: readOnly,
        },
        safe(async ({ query, since, limit }) => {
            const r = await service.euProducts({ query, since: since ?? service.daysAgo(EU_DEFAULT_DAYS), limit });
            const { since: from, ...rest } = r;
            const s = { spoken: spokenFor('EU product recalls', query, from, r), query, since: from, count: r.results.length, ...rest, disclaimer: DISCLAIMER, attribution: SAFETY_GATE_ATTRIBUTION };
            return ok(s, `${sourcesLine(r.results)}${r.results.length ? '\n' : ''}${SAFETY_GATE_ATTRIBUTION}`);
        }),
    );

    const listOutput = { spoken: z.string(), items: z.array(WatchItemSchema) };

    server.registerTool(
        'watchlist_add',
        {
            title: 'Add to household watchlist',
            description:
                'Remember a product, food or medicine the household owns, so check_my_household can watch it for recalls. ' +
                'Use when someone says "keep an eye on my <thing>". Pick the kind if it is clear; otherwise use "any".',
            inputSchema: {
                name: z.string().min(2).max(80).describe('What to watch, as a short product/food/medicine name, e.g. "Graco stroller", "Tylenol".'),
                kind: z.enum(KINDS).default('any').describe('"product" for household goods and devices, "food", "medicine", or "any" to check every source.'),
            },
            outputSchema: { ...listOutput, added: z.boolean() },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        safe(async ({ name, kind }) => {
            const { item, added } = await watchlist.add(name, kind);
            const items = await watchlist.list();
            const spoken = added
                ? `Added ${item.name} to your watchlist. You are watching ${plural(items.length, 'item')}.`
                : `${item.name} is already on your watchlist.`;
            return ok({ spoken, added, items });
        }),
    );

    server.registerTool(
        'watchlist_list',
        {
            title: 'List household watchlist',
            description: 'Say what is on the household watchlist. Use when someone asks "what am I watching?".',
            inputSchema: {},
            outputSchema: listOutput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        safe(async () => {
            const items = await watchlist.list();
            const spoken = items.length
                ? `You are watching ${plural(items.length, 'item')}: ${items.map((i) => i.name).join(', ')}.`
                : 'Your watchlist is empty. Say, for example, "watch my crib mattress".';
            return ok({ spoken, items });
        }),
    );

    server.registerTool(
        'watchlist_remove',
        {
            title: 'Remove from household watchlist',
            description: 'Stop watching an item. Use when someone says "stop watching <thing>". Matches the name (case-insensitive) or the item id.',
            inputSchema: { name: z.string().min(1).max(80).describe('The item name as on the watchlist, or its id.') },
            outputSchema: { ...listOutput, removed: z.boolean() },
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        },
        safe(async ({ name }) => {
            const hit = await watchlist.remove(name);
            const items = await watchlist.list();
            const spoken = hit ? `Removed ${hit.name} from your watchlist.` : `${name} was not on your watchlist.`;
            return ok({ spoken, removed: Boolean(hit), items });
        }),
    );

    server.registerTool(
        'check_my_household',
        {
            title: 'Check my household for recalls',
            description:
                'Check every item on the household watchlist against recent recalls and medicine shortages from all sources (CPSC, openFDA food/drug/device, EMA). ' +
                'Use when someone asks "has anything in my house been recalled?". Default window: the last 180 days.',
            inputSchema: {
                since: isoDate.optional().describe('Only recalls on or after this date (YYYY-MM-DD). Default: 180 days ago.'),
                limit: z.number().int().min(1).max(50).default(10).describe('Maximum matches to return, newest first.'),
            },
            outputSchema: {
                spoken: z.string(),
                since: z.string(),
                watched: z.array(z.string()),
                count: z.number().int(),
                matches: z.array(RecallSchema.extend({ matchedItems: z.array(z.string()) })),
                warnings: z.array(z.string()),
                disclaimer: z.string(),
            },
            annotations: readOnly,
        },
        safe(async ({ since, limit }) => {
            const from = since ?? service.daysAgo(HOUSEHOLD_DEFAULT_DAYS);
            const items = await watchlist.list();
            const watched = items.map((i) => i.name);
            if (!items.length) {
                return ok({ spoken: 'Your watchlist is empty, so there is nothing to check yet. Tell me what to watch, for example "watch my space heater".', since: from, watched, count: 0, matches: [], warnings: [], disclaimer: DISCLAIMER });
            }
            const r = await service.household(items, from);
            const matches = r.matches.slice(0, limit);
            const hitItems = [...new Set(matches.flatMap((m) => m.matchedItems))];
            let spoken = matches.length === 0
                ? `Good news: none of your ${plural(items.length, 'watched item')} matched a recall or shortage since ${from}.`
                : `${plural(matches.length, 'alert')} since ${from}${hitItems.length ? `, about ${hitItems.join(', ')}` : ''}. The most recent: ${matches[0].summary}`;
            if (r.warnings.length) spoken += ' Some sources were unavailable, so this may be incomplete.';
            return ok({ spoken, since: from, watched, count: matches.length, matches, warnings: r.warnings, disclaimer: DISCLAIMER }, sourcesLine(matches));
        }),
    );

    return server;
}
