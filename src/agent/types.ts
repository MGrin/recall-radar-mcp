/** The model-agnostic seam: every model speaks OpenAI-style chat messages with tools. */

export interface ToolCall {
    id: string;
    name: string;
    /** Raw JSON text of the arguments, as the model produced it. */
    arguments: string;
}

export type ChatMessage =
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
    | { role: 'tool'; tool_call_id: string; content: string };

/** A tool as the model sees it: name, description and a JSON Schema for the arguments. */
export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** One model step: either a final answer, or tool calls to run before asking again. */
export type ModelTurn = { type: 'text'; text: string } | { type: 'tool_calls'; calls: ToolCall[]; text?: string };

export interface ModelRequest {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
}

export interface ModelAdapter {
    readonly id: 'openai' | 'ollama' | 'scripted';
    /** What the UI shows, e.g. "OpenAI · gpt-6-luna" or "Scripted mode, no LLM". */
    readonly label: string;
    readonly model: string | null;
    next(req: ModelRequest): Promise<ModelTurn>;
}
