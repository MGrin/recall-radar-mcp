import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, MAX_STEPS } from '../src/agent/agent.js';
import { adapterFromEnv } from '../src/agent/providers.js';
import { extractSubject, route, ScriptedAdapter } from '../src/agent/scripted.js';
import type { ModelAdapter } from '../src/agent/types.js';
import { createApp } from '../src/app.js';
import { makeDeps } from '../src/server.js';
import { fixtureFetch, NOW, tmpWatchlist } from './helpers.js';

async function start(adapter: ModelAdapter = new ScriptedAdapter()) {
    const f = fixtureFetch();
    const app = createApp(makeDeps({ fetchImpl: f.impl, watchlistPath: tmpWatchlist(), now: NOW }), { web: { adapter, now: NOW } });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    return { app, base, mcpUrl: `${base}/mcp`, calls: f.calls };
}
const close = (app: Server) => new Promise<void>((r) => app.close(() => r()));

describe('scripted adapter routing', () => {
    it.each([
        ['Has anything in my house been recalled?', 'check_my_household', {}],
        ['Has my space heater been recalled?', 'search_product_recalls', { query: 'space heater', limit: 5 }],
        ['Is there a recall on peanut butter?', 'search_food_recalls', { query: 'peanut butter', limit: 5 }],
        ['Is ibuprofen recalled or short?', 'search_medicine_alerts', { query: 'ibuprofen', limit: 5 }],
        ['Watch my crib mattress', 'watchlist_add', { name: 'crib mattress', kind: 'product' }],
        ['Keep an eye on Ozempic', 'watchlist_add', { name: 'Ozempic', kind: 'medicine' }],
        ['What am I watching?', 'watchlist_list', {}],
        ['Stop watching the crib mattress', 'watchlist_remove', { name: 'crib mattress' }],
    ])('%s -> %s', (u, name, args) => {
        expect(route(u)).toEqual({ name, args });
    });

    it('says what it understands when it does not match', () => {
        expect(route('what is the weather')).toBeNull();
        expect(extractSubject('any recalls for Graco strollers?')).toBe('Graco strollers');
    });
});

describe('provider selection', () => {
    it('defaults to scripted without a key, openai with one, ', () => {
        expect(adapterFromEnv({}).id).toBe('scripted');
        const a = adapterFromEnv({ OPENAI_API_KEY: 'sk-test-123' });
        expect(a.id).toBe('openai');
        expect(a.model).toBe('gpt-6-luna');
        expect(a.label).toBe('OpenAI · gpt-6-luna');
        expect(adapterFromEnv({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-6-sol' }).model).toBe('gpt-6-sol');
        expect(adapterFromEnv({ MODEL_PROVIDER: 'ollama' })).toMatchObject({ id: 'ollama', model: 'llama3.1' });
        expect(adapterFromEnv({ MODEL_PROVIDER: 'scripted', OPENAI_API_KEY: 'k' }).id).toBe('scripted');
        expect(() => adapterFromEnv({ MODEL_PROVIDER: 'openai' })).toThrow(/needs OPENAI_API_KEY/);
    });
});

describe('agent loop, scripted adapter, real MCP server over HTTP (fixtures upstream)', () => {
    let app: Server;
    let mcpUrl: string;
    let calls: string[];
    const adapter = new ScriptedAdapter();

    beforeAll(async () => {
        ({ app, mcpUrl, calls } = await start());
    });
    afterAll(() => close(app));

    it('product question: one MCP tool call, spoken answer, recall cards with links', async () => {
        const r = await ask({ adapter, mcpUrl, utterance: 'Has my crib been recalled?', now: NOW });
        expect(r.trace).toMatchObject([{ tool: 'search_product_recalls', args: { query: 'crib' }, ok: true }]);
        expect(r.reply).toMatch(/^I found 3 product recalls for "crib"/);
        expect(r.recalls).toHaveLength(3);
        expect(r.recalls[0]).toMatchObject({ source: 'cpsc' });
        for (const c of r.recalls) expect(c.url).toMatch(/^https:\/\//);
        expect(r).toMatchObject({ steps: 2, capped: false, provider: { id: 'scripted', label: 'Scripted mode, no LLM' } });
        expect(calls.some((c) => c.includes('saferproducts.gov'))).toBe(true);
    });

    it('watch, then "has anything in my house been recalled"', async () => {
        const w = await ask({ adapter, mcpUrl, utterance: 'Watch my crib mattress', now: NOW });
        expect(w.trace[0]).toMatchObject({ tool: 'watchlist_add', ok: true });
        expect(w.reply).toMatch(/Added crib mattress to your watchlist/);
        await ask({ adapter, mcpUrl, utterance: 'Keep an eye on peanut butter', now: NOW });

        const h = await ask({ adapter, mcpUrl, utterance: 'Has anything in my house been recalled?', now: NOW });
        expect(h.trace).toMatchObject([{ tool: 'check_my_household', ok: true }]);
        expect(h.reply.length).toBeGreaterThan(20);
        expect(h.reply).toMatch(/alerts since 2026-06-28, about crib mattress, peanut butter/);
        expect(h.recalls.find((m) => m.source === 'cpsc')?.matchedItems).toEqual(['crib mattress']);
        expect(h.recalls.find((m) => m.source === 'openfda-food')?.matchedItems).toEqual(['peanut butter']);

        const l = await ask({ adapter, mcpUrl, utterance: 'What am I watching?', now: NOW });
        expect(l.reply).toBe('You are watching 2 items: crib mattress, peanut butter.');
        const rm = await ask({ adapter, mcpUrl, utterance: 'Stop watching the crib mattress', now: NOW });
        expect(rm.reply).toBe('Removed crib mattress from your watchlist.');
    });

    it('unmatched utterance: no tool call, a help answer', async () => {
        const r = await ask({ adapter, mcpUrl, utterance: 'tell me a joke', now: NOW });
        expect(r.trace).toEqual([]);
        expect(r.reply).toMatch(/^Sorry, I did not catch that/);
    });

    it(`caps the loop at ${MAX_STEPS} model steps`, async () => {
        let n = 0;
        const looping: ModelAdapter = {
            id: 'scripted', label: 'loop', model: null,
            next: async () => ({ type: 'tool_calls', calls: [{ id: `c${++n}`, name: 'watchlist_list', arguments: '{}' }] }),
        };
        const r = await ask({ adapter: looping, mcpUrl, utterance: 'x', now: NOW });
        expect(n).toBe(MAX_STEPS);
        expect(r).toMatchObject({ capped: true, steps: MAX_STEPS });
        expect(r.trace).toHaveLength(MAX_STEPS);
        expect(r.reply).toMatch(/^You are watching/); // falls back to the last spoken tool result
    });

    it('bad tool name or bad JSON arguments go back to the model as tool errors', async () => {
        const seen: string[] = [];
        let step = 0;
        const model: ModelAdapter = {
            id: 'scripted', label: 't', model: null,
            next: async (req) => {
                step++;
                if (step === 1) return { type: 'tool_calls', calls: [{ id: 'a', name: 'nope', arguments: '{}' }, { id: 'b', name: 'watchlist_list', arguments: '{not json' }] };
                for (const m of req.messages) if (m.role === 'tool') seen.push(m.content);
                return { type: 'text', text: 'done' };
            },
        };
        const r = await ask({ adapter: model, mcpUrl, utterance: 'x', now: NOW });
        expect(r.reply).toBe('done');
        expect(seen[0]).toMatch(/^Unknown tool nope/);
        expect(seen[1]).toMatch(/not valid JSON/);
        expect(r.trace.map((t) => t.ok)).toEqual([false, false]);
    });
});

describe('HTTP: /api/ask, /api/config, /api/watchlist and the static UI', () => {
    let app: Server;
    let base: string;
    beforeAll(async () => {
        ({ app, base } = await start());
    });
    afterAll(() => close(app));

    const post = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

    it('POST /api/ask answers through the agent and the MCP server', async () => {
        const res = await post({ q: 'Is there a recall on peanut butter?' }, { Origin: base });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.trace).toMatchObject([{ tool: 'search_food_recalls', ok: true }]);
        expect(data.reply).toMatch(/food recalls for "peanut butter"/);
        expect(data.recalls[0].source).toBe('openfda-food');
        expect(data.provider.label).toBe('Scripted mode, no LLM');
    });

    it('rejects bad input, wrong methods and foreign origins', async () => {
        expect((await post({})).status).toBe(400);
        expect((await post('{nope')).status).toBe(400);
        expect((await post({ q: 'x'.repeat(301) })).status).toBe(400);
        expect((await fetch(`${base}/api/ask`)).status).toBe(405);
        expect((await post({ q: 'hi' }, { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    });

    it('serves config, the watchlist and the UI files; no path traversal', async () => {
        expect(await (await fetch(`${base}/api/config`)).json()).toEqual({ provider: { id: 'scripted', label: 'Scripted mode, no LLM', model: null } });
        await post({ q: 'watch my stroller' });
        expect((await (await fetch(`${base}/api/watchlist`)).json()).items.map((i: { name: string }) => i.name)).toEqual(['stroller']);
        const page = await fetch(`${base}/`);
        expect(page.headers.get('content-type')).toMatch(/text\/html/);
        expect(page.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
        const html = await page.text();
        expect(html).toContain('<title>Recall Radar</title>');
        expect(html).not.toMatch(/alexa/i);
        expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toMatch(/javascript/);
        expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
        expect((await fetch(`${base}/%2e%2e/src/app.ts`)).status).toBe(404);
        // MCP and health still work in the same process
        expect((await fetch(`${base}/healthz`)).status).toBe(200);
        expect((await fetch(`${base}/mcp`)).status).toBe(405);
    });
});
