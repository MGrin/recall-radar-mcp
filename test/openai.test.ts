/**
 * The OpenAI adapter against a mocked Chat Completions endpoint. Response bodies follow the
 * documented Chat Completions shape (choices[0].message.tool_calls[].function.{name,arguments},
 * with arguments as a JSON string). No live call: there is no key on the build machine.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask } from '../src/agent/agent.js';
import { OpenAICompatAdapter } from '../src/agent/openai.js';
import { createApp } from '../src/app.js';
import { makeDeps } from '../src/server.js';
import type { FetchLike } from '../src/types.js';
import { fixtureFetch, NOW, tmpWatchlist } from './helpers.js';

const KEY = 'sk-proj-TESTKEY0000000000';

const completion = (message: Record<string, unknown>, finish = 'stop') => ({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1790000000,
    model: 'gpt-6-luna',
    choices: [{ index: 0, message: { role: 'assistant', refusal: null, ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
});
const toolCall = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

/** A fake OpenAI: returns the queued responses in order and records every request. */
function fakeOpenAI(responses: { status?: number; body: unknown }[]) {
    const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
    const impl: FetchLike = async (url, init) => {
        requests.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
        const next = responses.shift();
        if (!next) throw new Error('fake OpenAI: no more responses queued');
        return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { impl, requests };
}

const adapter = (impl: FetchLike) => new OpenAICompatAdapter({ id: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', apiKey: KEY, fetchImpl: impl });

describe('OpenAI adapter, unit', () => {
    it('sends a Chat Completions request with tools and parses tool_calls', async () => {
        const f = fakeOpenAI([{ body: completion({ content: null, tool_calls: [toolCall('call_1', 'search_food_recalls', { query: 'peanut butter', limit: 3 })] }, 'tool_calls') }]);
        const turn = await adapter(f.impl).next({
            system: 'sys',
            messages: [{ role: 'user', content: 'peanut butter?' }],
            tools: [{ name: 'search_food_recalls', description: 'd', parameters: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { query: { type: 'string' } } } }],
        });
        expect(turn).toEqual({ type: 'tool_calls', calls: [{ id: 'call_1', name: 'search_food_recalls', arguments: '{"query":"peanut butter","limit":3}' }], text: undefined });
        const [req] = f.requests;
        expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(req.headers.Authorization).toBe(`Bearer ${KEY}`);
        expect(req.body.model).toBe('gpt-6-luna');
        expect(req.body.messages[0]).toEqual({ role: 'system', content: 'sys' });
        expect(req.body.tools[0]).toEqual({ type: 'function', function: { name: 'search_food_recalls', description: 'd', parameters: { type: 'object', properties: { query: { type: 'string' } } } } });
        expect(req.body.tool_choice).toBe('auto');
    });

    it('returns plain text answers', async () => {
        const f = fakeOpenAI([{ body: completion({ content: '  Nothing found.  ' }) }]);
        expect(await adapter(f.impl).next({ system: 's', messages: [], tools: [] })).toEqual({ type: 'text', text: 'Nothing found.' });
    });

    it('turns an HTTP error into a message without the key', async () => {
        const f = fakeOpenAI([{ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`, type: 'invalid_request_error', code: 'invalid_api_key' } } }]);
        const err = await adapter(f.impl).next({ system: 's', messages: [], tools: [] }).catch((e: Error) => e);
        expect((err as Error).message).toMatch(/^openai answered HTTP 401: Incorrect API key provided: sk-\[redacted\]/);
        expect((err as Error).message).not.toContain('TESTKEY');
    });
});

describe('OpenAI adapter in the agent loop, real MCP server (fixtures upstream)', () => {
    let app: Server;
    let mcpUrl: string;
    beforeAll(async () => {
        app = createApp(makeDeps({ fetchImpl: fixtureFetch().impl, watchlistPath: tmpWatchlist(), now: NOW }));
        await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
        mcpUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}/mcp`;
    });
    afterAll(() => new Promise<void>((r) => app.close(() => r())));

    it('runs a multi-step tool loop: add to watchlist, check the household, then answer', async () => {
        const f = fakeOpenAI([
            { body: completion({ content: null, tool_calls: [toolCall('call_a', 'watchlist_add', { name: 'crib mattress', kind: 'product' })] }, 'tool_calls') },
            { body: completion({ content: null, tool_calls: [toolCall('call_b', 'check_my_household', { since: '2025-01-01' }), toolCall('call_c', 'search_product_recalls', { query: 'crib', limit: 2 })] }, 'tool_calls') },
            { body: completion({ content: 'Yes. A crib mattress on your list was recalled for a suffocation hazard. Stop using it and follow the remedy on screen.' }) },
        ]);
        const r = await ask({ adapter: adapter(f.impl), mcpUrl, utterance: 'Watch my crib mattress and tell me if it was recalled', now: NOW });

        expect(r.reply).toMatch(/^Yes\. A crib mattress/);
        expect(r.steps).toBe(3);
        expect(r.trace.map((t) => [t.tool, t.ok])).toEqual([['watchlist_add', true], ['check_my_household', true], ['search_product_recalls', true]]);
        expect(r.recalls.length).toBeGreaterThan(0);
        expect(r.provider).toEqual({ id: 'openai', label: 'OpenAI · gpt-6-luna', model: 'gpt-6-luna' });

        // Every MCP tool was offered, in OpenAI function format.
        expect(f.requests[0].body.tools.map((t: any) => t.function.name).sort()).toEqual([
            'check_my_household', 'search_food_recalls', 'search_medicine_alerts', 'search_product_recalls',
            'watchlist_add', 'watchlist_list', 'watchlist_remove',
        ]);
        // Step 2 saw the assistant tool_calls message and the tool result, linked by id.
        const m2 = f.requests[1].body.messages;
        expect(m2[0].role).toBe('system');
        expect(m2.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'watchlist_add' } }] });
        expect(m2.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_a' });
        expect(JSON.parse(m2.at(-1).content)).toMatchObject({ added: true, spoken: expect.stringMatching(/Added crib mattress/) });
        // Step 3 saw both parallel tool results.
        const m3 = f.requests[2].body.messages;
        expect(m3.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id)).toEqual(['call_a', 'call_b', 'call_c']);
        const household = JSON.parse(m3.find((m: any) => m.tool_call_id === 'call_b').content);
        expect(household.matches[0].matchedItems).toEqual(['crib mattress']);
    });
});
