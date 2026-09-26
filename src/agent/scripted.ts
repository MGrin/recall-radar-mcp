/**
 * A deterministic stand-in for a model: a few utterance patterns map to one MCP tool call,
 * and the answer is the tool's own `spoken` sentence. No LLM, no key. Used in tests and as the
 * judge demo mode, and labelled as such in the UI.
 */
import type { ChatMessage, ModelAdapter, ModelRequest, ModelTurn } from './types.js';

const FOOD = /\b(food|peanut|butter|milk|cheese|egg|eggs|lettuce|romaine|spinach|salad|ice cream|cereal|flour|chocolate|cookie|snack|meat|beef|chicken|pork|fish|seafood|fruit|juice|baby formula|formula|listeria|salmonella|e\.? ?coli|allergen)\b/i;
const MEDICINE = /\b(medicine|medication|drug|pill|pills|tablet|tablets|capsule|syrup|insulin|ibuprofen|paracetamol|acetaminophen|tylenol|advil|aspirin|ozempic|semaglutide|metformin|amoxicillin|antibiotic|inhaler|vaccine|shortage|shortages)\b/i;

type Kind = 'product' | 'food' | 'medicine';
export function guessKind(text: string): Kind {
    if (MEDICINE.test(text)) return 'medicine';
    if (FOOD.test(text)) return 'food';
    return 'product';
}

const clean = (s: string) => s.replace(/[?.!,]+$/g, '').replace(/^(my|the|our|a|an|any|some)\s+/i, '').trim();

/** Pull the thing being asked about out of "has my X been recalled", "any recalls on X", ... */
export function extractSubject(text: string): string {
    const t = text.trim().replace(/[?.!]+$/, '');
    const patterns = [
        /\brecalls?\s+(?:on|for|of|about|with|involving)\s+(.+)$/i,
        /\b(?:has|have|is|are|was|were)\s+(?:(?:my|the|our|any)\s+)?(.+?)\s+(?:been\s+)?recall(?:ed|s)?\b/i,
        /\b(?:shortages?|alerts?)\s+(?:on|for|of|about)\s+(.+)$/i,
        /\b(?:check|search|look\s+up|find)\s+(?:recalls?\s+(?:on|for)\s+)?(.+)$/i,
        /\bis\s+(?:(?:my|the|our)\s+)?(.+?)\s+(?:safe|short|in\s+shortage|available)\b/i,
    ];
    for (const p of patterns) {
        const m = p.exec(t);
        if (m?.[1]) return clean(m[1]);
    }
    return clean(t.replace(/\b(recall(?:ed|s)?|please|alexa|any|there|is|a|on)\b/gi, ' ').replace(/\s+/g, ' '));
}

export interface ScriptedCall {
    name: string;
    args: Record<string, unknown>;
}

/** The whole "model": one utterance in, at most one tool call out. Exported for tests. */
export function route(utterance: string): ScriptedCall | null {
    const u = utterance.trim();
    let m: RegExpExecArray | null;
    if (/\b(anything|something|what)\b.*\b(house|home|household)\b.*\brecall/i.test(u) || /\bcheck\s+(my\s+)?(house|home|household)\b/i.test(u)) {
        return { name: 'check_my_household', args: {} };
    }
    if ((m = /\b(?:stop\s+watching|remove|forget|unwatch)\s+(.+)$/i.exec(u))) {
        return { name: 'watchlist_remove', args: { name: clean(m[1].replace(/\s+from\s+(?:my\s+)?watch\s*list$/i, '')) } };
    }
    if (/\bwhat\s+(?:am\s+i|are\s+we|is\s+on\s+my)\b.*\bwatch/i.test(u) || /\b(?:show|list|read)\s+(?:me\s+)?(?:my\s+)?watch\s*list\b/i.test(u)) {
        return { name: 'watchlist_list', args: {} };
    }
    if ((m = /\b(?:watch|keep\s+an\s+eye\s+on|track|monitor|add)\s+(.+?)(?:\s+(?:to|on)\s+(?:my\s+)?watch\s*list)?$/i.exec(u))) {
        const name = clean(m[1]);
        if (name.length >= 2) return { name: 'watchlist_add', args: { name, kind: guessKind(name) } };
    }
    if (!/\brecall|shortage|alert|safe\b/i.test(u)) return null;
    const query = extractSubject(u);
    if (query.length < 2) return null;
    const kind = guessKind(u);
    const name = kind === 'medicine' ? 'search_medicine_alerts' : kind === 'food' ? 'search_food_recalls' : 'search_product_recalls';
    return { name, args: { query: query.slice(0, 80), limit: 5 } };
}

const HELP =
    'In scripted mode I understand a few phrasings: "has anything in my house been recalled", ' +
    '"is there a recall on peanut butter", "has my stroller been recalled", "watch my crib mattress", ' +
    '"what am I watching", and "stop watching the crib mattress".';

/** Voice-first: keep the headline and the most recent item, drop the "Next: ..." second item. */
function short(spoken: string): string {
    const [head, rest] = spoken.split(' Next: ');
    if (rest === undefined) return spoken;
    const note = / Note: [^]*$/.exec(rest)?.[0] ?? '';
    return head + note;
}

/** The spoken line out of a tool result the agent fed back (JSON with `spoken`, or error text). */
function spokenOf(content: string): string {
    try {
        const v = JSON.parse(content) as { spoken?: unknown };
        if (typeof v.spoken === 'string') return short(v.spoken);
    } catch {
        /* not JSON: an error text */
    }
    return content;
}

export class ScriptedAdapter implements ModelAdapter {
    readonly id = 'scripted' as const;
    readonly label = 'Scripted mode, no LLM';
    readonly model = null;
    private n = 0;

    async next(req: ModelRequest): Promise<ModelTurn> {
        const msgs = req.messages;
        const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
        const after = msgs.slice(lastUser + 1).filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool');
        if (after.length) return { type: 'text', text: after.map((m) => spokenOf(m.content)).join(' ') };
        const utterance = lastUser >= 0 ? (msgs[lastUser] as { content: string }).content : '';
        const call = route(utterance);
        if (!call || !req.tools.some((t) => t.name === call.name)) return { type: 'text', text: `Sorry, I did not catch that. ${HELP}` };
        return { type: 'tool_calls', calls: [{ id: `scripted_${++this.n}`, name: call.name, arguments: JSON.stringify(call.args) }] };
    }
}
