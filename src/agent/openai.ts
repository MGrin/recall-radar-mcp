/**
 * OpenAI Chat Completions with tools, over plain fetch. The same wire format serves Ollama's
 * OpenAI-compatible endpoint (`<OLLAMA_URL>/v1/chat/completions`), so one class covers both.
 */
import type { FetchLike } from '../types.js';
import type { ModelAdapter, ModelRequest, ModelTurn } from './types.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 45_000;

interface Options {
    id: 'openai' | 'ollama';
    baseUrl: string;
    model: string;
    apiKey?: string;
    label?: string;
    fetchImpl?: FetchLike;
}

interface WireToolCall { id?: string; type?: string; function?: { name?: string; arguments?: string | object } }
interface WireResponse {
    choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[];
    error?: { message?: string };
}

/** MCP input schemas carry a `$schema` key that some OpenAI-compatible servers reject. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const { $schema: _drop, ...rest } = schema;
    return rest.type ? rest : { type: 'object', properties: {}, ...rest };
}

const redact = (s: string) => s.replace(/\b(sk|rk)-[A-Za-z0-9_*.\-]{4,}/g, '$1-[redacted]');

export class OpenAICompatAdapter implements ModelAdapter {
    readonly id: 'openai' | 'ollama';
    readonly label: string;
    readonly model: string;
    private readonly baseUrl: string;
    private readonly apiKey?: string;
    private readonly fetchImpl: FetchLike;

    constructor(o: Options) {
        this.id = o.id;
        this.model = o.model;
        this.baseUrl = o.baseUrl.replace(/\/+$/, '');
        this.apiKey = o.apiKey;
        this.label = o.label ?? `${o.id === 'openai' ? 'OpenAI' : 'Ollama'} · ${o.model}`;
        this.fetchImpl = o.fetchImpl ?? ((u, i) => fetch(u, i));
    }

    async next(req: ModelRequest): Promise<ModelTurn> {
        const body = {
            model: this.model,
            messages: [{ role: 'system', content: req.system }, ...req.messages],
            tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) } })),
            tool_choice: 'auto',
        };
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        let res: Response;
        try {
            res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            const e = err as Error;
            const code = (e?.cause as { code?: string } | undefined)?.code;
            throw new Error(`${this.id} request failed: ${[e?.message, code].filter(Boolean).join(': ')}`);
        }
        const text = await res.text();
        let data: WireResponse;
        try {
            data = JSON.parse(text) as WireResponse;
        } catch {
            throw new Error(`${this.id} answered HTTP ${res.status} without JSON`);
        }
        // OpenAI's 401 message echoes a masked key; mask anything key-shaped again before it reaches a log.
        if (!res.ok) throw new Error(`${this.id} answered HTTP ${res.status}: ${redact(data.error?.message ?? 'no message')}`);
        const msg = data.choices?.[0]?.message;
        if (!msg) throw new Error(`${this.id} returned no choices`);
        const calls = (msg.tool_calls ?? [])
            .filter((c) => c.function?.name)
            .map((c, i) => ({
                id: c.id || `call_${i}`,
                name: c.function!.name!,
                // Defensive: accept arguments as an object too, in case a compatible server sends one.
                arguments: typeof c.function!.arguments === 'string' ? c.function!.arguments : JSON.stringify(c.function!.arguments ?? {}),
            }));
        if (calls.length) return { type: 'tool_calls', calls, text: msg.content ?? undefined };
        return { type: 'text', text: (msg.content ?? '').trim() };
    }
}
