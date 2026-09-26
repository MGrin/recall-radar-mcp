/** Picks the model adapter from the environment. Default: OpenAI if a key is set, else scripted. */
import type { FetchLike } from '../types.js';
import { OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL, OpenAICompatAdapter } from './openai.js';
import { ScriptedAdapter } from './scripted.js';
import type { ModelAdapter } from './types.js';

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.1';

export function adapterFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): ModelAdapter {
    const key = env.OPENAI_API_KEY?.trim();
    const provider = (env.MODEL_PROVIDER?.trim().toLowerCase() || (key ? 'openai' : 'scripted')) as string;
    switch (provider) {
        case 'openai':
            if (!key) throw new Error('MODEL_PROVIDER=openai needs OPENAI_API_KEY. Unset MODEL_PROVIDER to run in scripted mode.');
            return new OpenAICompatAdapter({
                id: 'openai',
                baseUrl: env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL,
                model: env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL,
                apiKey: key,
                fetchImpl,
            });
        case 'ollama':
            return new OpenAICompatAdapter({
                id: 'ollama',
                baseUrl: `${(env.OLLAMA_URL?.trim() || OLLAMA_DEFAULT_URL).replace(/\/+$/, '')}/v1`,
                model: env.OLLAMA_MODEL?.trim() || OLLAMA_DEFAULT_MODEL,
                fetchImpl,
            });
        case 'scripted':
            return new ScriptedAdapter();
        default:
            throw new Error(`Unknown MODEL_PROVIDER "${provider}". Use openai, ollama or scripted.`);
    }
}
