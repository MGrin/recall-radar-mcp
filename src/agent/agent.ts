/**
 * The agent loop. It is a real MCP client: it connects to the Recall Radar server over Streamable
 * HTTP, lists the tools, hands them to whichever model adapter is configured, and runs the
 * tool-call loop (at most MAX_STEPS model calls per question).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Recall } from '../types.js';
import { systemPrompt } from './prompt.js';
import type { ChatMessage, ModelAdapter, ToolSpec } from './types.js';

export const MAX_STEPS = 6;
const MAX_RECALLS = 8;

export interface TraceEntry {
    tool: string;
    args: Record<string, unknown>;
    ok: boolean;
    ms: number;
}

export type RecallCard = Recall & { matchedItems?: string[] };

export interface AskResult {
    reply: string;
    provider: { id: string; label: string; model: string | null };
    trace: TraceEntry[];
    recalls: RecallCard[];
    steps: number;
    capped: boolean;
}

/** A prior turn the UI sends back so follow-ups ("watch it") have context. Text only. */
export interface HistoryTurn {
    role: 'user' | 'assistant';
    content: string;
}

export async function withMcp<T>(mcpUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: 'recall-radar-agent', version: '0.2.1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

/** What the model reads back from a tool: the structured result as JSON, or the error text. */
function toolContent(r: CallResult): string {
    if (!r.isError && r.structuredContent) return JSON.stringify(r.structuredContent);
    const text = (r.content as { type: string; text?: string }[] | undefined)?.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return text || (r.isError ? 'The tool failed without a message.' : 'OK');
}

function collectRecalls(r: CallResult, into: Map<string, RecallCard>) {
    const s = r.structuredContent as { results?: RecallCard[]; matches?: RecallCard[] } | undefined;
    for (const x of [...(s?.results ?? []), ...(s?.matches ?? [])]) {
        const key = `${x.source}:${x.id}`;
        if (!into.has(key)) into.set(key, x);
    }
}

function parseArgs(raw: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(raw || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
        return null;
    }
}

export async function ask(opts: {
    adapter: ModelAdapter;
    mcpUrl: string;
    utterance: string;
    history?: HistoryTurn[];
    now?: () => Date;
}): Promise<AskResult> {
    const { adapter } = opts;
    const provider = { id: adapter.id, label: adapter.label, model: adapter.model };
    return withMcp(opts.mcpUrl, async (client) => {
        const { tools } = await client.listTools();
        const specs: ToolSpec[] = tools.map((t) => ({ name: t.name, description: t.description ?? t.title ?? t.name, parameters: t.inputSchema as Record<string, unknown> }));
        const known = new Set(specs.map((s) => s.name));
        const messages: ChatMessage[] = [
            ...(opts.history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
            { role: 'user', content: opts.utterance },
        ];
        const system = systemPrompt((opts.now ?? (() => new Date()))());
        const trace: TraceEntry[] = [];
        const recalls = new Map<string, RecallCard>();
        let lastSpoken = '';

        for (let step = 1; step <= MAX_STEPS; step++) {
            const turn = await adapter.next({ system, messages, tools: specs });
            if (turn.type === 'text') {
                return { reply: turn.text || lastSpoken || 'Sorry, I have no answer for that.', provider, trace, recalls: [...recalls.values()].slice(0, MAX_RECALLS), steps: step, capped: false };
            }
            messages.push({
                role: 'assistant',
                content: turn.text ?? null,
                tool_calls: turn.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
            });
            for (const call of turn.calls) {
                const args = parseArgs(call.arguments);
                const t0 = Date.now();
                let content: string;
                let ok = false;
                if (!known.has(call.name)) content = `Unknown tool ${call.name}. Available: ${[...known].join(', ')}.`;
                else if (!args) content = `The arguments for ${call.name} were not valid JSON.`;
                else {
                    try {
                        const r = await client.callTool({ name: call.name, arguments: args });
                        ok = !r.isError;
                        content = toolContent(r);
                        collectRecalls(r, recalls);
                        const spoken = (r.structuredContent as { spoken?: unknown } | undefined)?.spoken;
                        if (typeof spoken === 'string') lastSpoken = spoken;
                    } catch (e) {
                        content = `The tool call failed: ${(e as Error).message}`;
                    }
                }
                trace.push({ tool: call.name, args: args ?? {}, ok, ms: Date.now() - t0 });
                messages.push({ role: 'tool', tool_call_id: call.id, content });
            }
        }
        const reply = lastSpoken || 'Sorry, that took too many steps. Please ask again more simply.';
        return { reply, provider, trace, recalls: [...recalls.values()].slice(0, MAX_RECALLS), steps: MAX_STEPS, capped: true };
    });
}
