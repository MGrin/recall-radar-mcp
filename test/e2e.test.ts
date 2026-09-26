import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { makeDeps } from '../src/server.js';
import { fixtureFetch, NOW, tmpWatchlist } from './helpers.js';

type Structured = Record<string, any>;

async function start(fetchOpts: Parameters<typeof fixtureFetch>[0] = {}) {
    const f = fixtureFetch(fetchOpts);
    const app = createApp(makeDeps({ fetchImpl: f.impl, watchlistPath: tmpWatchlist(), now: NOW }));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    return { app, base, calls: f.calls };
}

async function connect(base: string) {
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return client;
}

const close = (app: Server) => new Promise<void>((r) => app.close(() => r()));

describe('HTTP server (fixtures)', () => {
    let app: Server;
    let base: string;
    let calls: string[];
    let client: Client;

    beforeAll(async () => {
        ({ app, base, calls } = await start());
        client = await connect(base);
    });
    afterAll(async () => {
        await client.close();
        await close(app);
    });

    it('negotiates MCP protocol 2025-11-25 over Streamable HTTP', async () => {
        const res = await fetch(`${base}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'initialize',
                params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
            }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('mcp-session-id')).toBeNull(); // stateless
        const text = await res.text();
        const data = JSON.parse(text.split('\n').find((l) => l.startsWith('data: '))!.slice(6));
        expect(data.result.protocolVersion).toBe('2025-11-25');
        expect(data.result.serverInfo.name).toBe('recall-radar');
        expect(data.result.capabilities.tools).toBeDefined();
    });

    it('serves /healthz and refuses GET /mcp and foreign origins', async () => {
        expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true, protocol: '2025-11-25' });
        expect((await fetch(`${base}/mcp`)).status).toBe(405);
        const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
        expect(bad.status).toBe(403);
    });

    it('lists the seven tools, each with an input and output schema', async () => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([
            'check_my_household', 'search_food_recalls', 'search_medicine_alerts', 'search_product_recalls',
            'watchlist_add', 'watchlist_list', 'watchlist_remove',
        ]);
        for (const t of tools) {
            expect(t.description!.length).toBeGreaterThan(40);
            expect(t.inputSchema.type).toBe('object');
            expect(t.outputSchema?.type).toBe('object');
        }
    });

    it('search_product_recalls merges CPSC and openFDA devices, newest first', async () => {
        const r = await client.callTool({ name: 'search_product_recalls', arguments: { query: 'crib', limit: 5 } });
        expect(r.isError).toBeFalsy();
        const s = r.structuredContent as Structured;
        expect(s.since).toBe('2025-09-26');
        expect(s.results.map((x: Structured) => x.source)).toEqual(['cpsc', 'openfda-device', 'openfda-device']);
        expect(s.spoken).toMatch(/^I found 3 product recalls for "crib" since 2025-09-26\. The most recent: Voomf/);
        for (const x of s.results) {
            expect(x.url).toMatch(/^https:\/\//);
            expect(x.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(calls.some((c) => c.includes('saferproducts.gov') && c.includes('ProductName=crib'))).toBe(true);
    });

    it('search_food_recalls', async () => {
        const r = await client.callTool({ name: 'search_food_recalls', arguments: { query: 'peanut', limit: 2 } });
        const s = r.structuredContent as Structured;
        expect(s.count).toBe(2);
        expect(s.results[0].source).toBe('openfda-food');
        expect(s.spoken).toMatch(/food recalls for "peanut"/);
    });

    it('search_medicine_alerts covers US recalls and EU shortages', async () => {
        const us = (await client.callTool({ name: 'search_medicine_alerts', arguments: { query: 'ibuprofen', region: 'us' } })).structuredContent as Structured;
        expect(us.results.every((x: Structured) => x.source === 'openfda-drug')).toBe(true);
        const eu = (await client.callTool({ name: 'search_medicine_alerts', arguments: { query: 'semaglutide', region: 'eu' } })).structuredContent as Structured;
        expect(eu.results).toHaveLength(1);
        expect(eu.results[0]).toMatchObject({ source: 'ema-shortages', title: 'Ozempic' });
        expect(eu.spoken).toMatch(/Ozempic/);
    });

    it('watchlist add / list / remove and check_my_household', async () => {
        const empty = (await client.callTool({ name: 'check_my_household', arguments: {} })).structuredContent as Structured;
        expect(empty.spoken).toMatch(/watchlist is empty/);

        let s = (await client.callTool({ name: 'watchlist_add', arguments: { name: 'crib mattress', kind: 'product' } })).structuredContent as Structured;
        expect(s.added).toBe(true);
        await client.callTool({ name: 'watchlist_add', arguments: { name: 'Ozempic', kind: 'medicine' } });
        await client.callTool({ name: 'watchlist_add', arguments: { name: 'peanut butter', kind: 'food' } });
        s = (await client.callTool({ name: 'watchlist_list', arguments: {} })).structuredContent as Structured;
        expect(s.items.map((i: Structured) => i.name)).toEqual(['crib mattress', 'Ozempic', 'peanut butter']);

        const h = (await client.callTool({ name: 'check_my_household', arguments: { since: '2026-01-01' } })).structuredContent as Structured;
        expect(h.watched).toHaveLength(3);
        const about = (src: string) => h.matches.find((m: Structured) => m.source === src);
        expect(about('cpsc').matchedItems).toEqual(['crib mattress']);
        expect(about('openfda-food').matchedItems).toEqual(['peanut butter']);
        expect(about('ema-shortages')).toMatchObject({ title: 'Ozempic', matchedItems: ['Ozempic'] });
        expect(h.spoken).toMatch(/alerts since 2026-01-01/);
        // One openFDA request per category, not per item.
        const foodQs = calls.filter((c) => c.includes('/food/enforcement.json')).map((c) => new URL(c).searchParams.get('search'));
        expect(foodQs).toContain('report_date:[20260101 TO 20260926] AND (product_description:"peanut butter")');

        s = (await client.callTool({ name: 'watchlist_remove', arguments: { name: 'OZEMPIC' } })).structuredContent as Structured;
        expect(s).toMatchObject({ removed: true });
        expect(s.items).toHaveLength(2);
        s = (await client.callTool({ name: 'watchlist_remove', arguments: { name: 'nope' } })).structuredContent as Structured;
        expect(s.removed).toBe(false);
    });

    it('rejects invalid input with a tool error, not a crash', async () => {
        const r = await client.callTool({ name: 'search_product_recalls', arguments: { query: 'crib', since: 'last week' } });
        expect(r.isError).toBe(true);
    });
});

describe('HTTP server (upstream failures)', () => {
    it('one source down: answers from the rest with a warning', async () => {
        const { app, base } = await start({ fail: { cpsc: 'network' } });
        const client = await connect(base);
        const s = (await client.callTool({ name: 'search_product_recalls', arguments: { query: 'crib' } })).structuredContent as Structured;
        expect(s.warnings).toEqual(['US CPSC unavailable: CPSC request failed: fetch failed']);
        expect(s.results.length).toBeGreaterThan(0);
        expect(s.spoken).toMatch(/may be incomplete/);
        await client.close();
        await close(app);
    });

    it('every source down: a clean tool error; the server keeps serving', async () => {
        const { app, base } = await start({ fail: { fda: 'http500', ema: 'http500' } });
        const client = await connect(base);
        const r = await client.callTool({ name: 'search_medicine_alerts', arguments: { query: 'insulin' } });
        expect(r.isError).toBe(true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/^Sorry, I could not check that right now\. Every source failed/);
        expect((await fetch(`${base}/healthz`)).status).toBe(200);
        await client.close();
        await close(app);
    });
});
