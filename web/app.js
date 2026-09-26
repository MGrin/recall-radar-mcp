// Recall Radar: a simulated smart-display voice front end. It speaks to POST /api/ask, where an
// agent loop drives the Recall Radar MCP server. No framework; one file.

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null) n.append(k);
    return n;
};

const params = new URLSearchParams(location.search);
const state = {
    history: [],
    busy: false,
    muted: params.get('mute') === '1' || localStorage.getItem('rr-muted') === '1',
    lastHits: new Set(),
};

const SUGGESTIONS = [
    'Has anything in my house been recalled?',
    'Has my stroller been recalled?',
    'Is there a recall on peanut butter?',
    'Is ibuprofen recalled or short?',
    'Watch my crib mattress',
    'What am I watching?',
];

const SOURCE_LABEL = {
    cpsc: ['CPSC', 'cpsc'],
    'openfda-food': ['FDA food', 'food'],
    'openfda-drug': ['FDA drug', 'drug'],
    'openfda-device': ['FDA device', 'device'],
    'ema-shortages': ['EMA shortage', 'ema'],
};

function setState(s, status) {
    document.body.dataset.state = s;
    $('status').textContent = status ?? { idle: 'Ready', listening: 'Listening…', thinking: 'Checking recall sources…', speaking: 'Speaking' }[s];
}

// ---------- clock ----------
function tick() {
    $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
tick();
setInterval(tick, 15_000);

// ---------- speech out ----------
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
function renderMute() {
    $('mute').setAttribute('aria-pressed', String(state.muted));
    $('mute').title = state.muted ? 'Unmute spoken replies' : 'Mute spoken replies';
}
$('mute').addEventListener('click', () => {
    state.muted = !state.muted;
    localStorage.setItem('rr-muted', state.muted ? '1' : '0');
    if (state.muted) synth?.cancel();
    renderMute();
});
renderMute();

function speak(text) {
    return new Promise((resolve) => {
        if (!synth || state.muted || !text) return resolve();
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 1.02;
        const voice = synth.getVoices().find((v) => v.lang === 'en-US' && /natural|premium|enhanced|samantha|google us/i.test(v.name));
        if (voice) u.voice = voice;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        u.onend = finish;
        u.onerror = finish;
        setState('speaking');
        synth.speak(u);
        // Some engines never fire onend (e.g. no voices installed); do not hang the UI.
        setTimeout(finish, Math.min(60_000, 2_000 + text.length * 90));
    });
}

// ---------- speech in (push to talk) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('mic');
let recog = null;
let heardText = '';
if (!SR) {
    mic.disabled = true;
    mic.title = 'Voice input is not available in this browser. Type your question instead.';
    $('q').placeholder = 'Type a question (voice input needs Chrome, Edge or Safari)';
} else {
    mic.title = 'Hold to talk (or press and hold the space bar)';
    const start = () => {
        if (state.busy || recog) return;
        synth?.cancel();
        heardText = '';
        recog = new SR();
        recog.lang = 'en-US';
        recog.interimResults = true;
        recog.continuous = true;
        recog.onresult = (e) => {
            heardText = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
            showHeard(heardText, true);
        };
        recog.onerror = (e) => {
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setState('idle', 'Microphone permission was refused. Type instead.');
        };
        recog.onend = () => {
            recog = null;
            if (heardText) ask(heardText);
            else if (document.body.dataset.state === 'listening') setState('idle');
        };
        try {
            recog.start();
            setState('listening');
            showHeard('Listening…', true);
        } catch {
            recog = null;
        }
    };
    const stop = () => recog?.stop();
    mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture?.(e.pointerId); start(); });
    mic.addEventListener('pointerup', stop);
    mic.addEventListener('pointercancel', stop);
    let spaceDown = false;
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || e.repeat || e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        spaceDown = true;
        start();
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && spaceDown) { spaceDown = false; stop(); }
    });
}

// ---------- rendering ----------
function showHeard(text, live = false) {
    const h = $('heard');
    h.classList.toggle('live', live);
    h.replaceChildren(live ? text : el('q', { textContent: text }));
}

function argSummary(args) {
    const v = args.query ?? args.name;
    if (typeof v === 'string') return `"${v}"`;
    return '';
}

function renderTrace(trace) {
    const t = $('trace');
    t.replaceChildren();
    if (!trace.length) return;
    t.append(el('span', { className: 'trace-label', textContent: 'MCP' }));
    for (const c of trace) {
        const chip = el('span', { className: `chip${c.ok ? '' : ' fail'}`, title: JSON.stringify(c.args) });
        chip.append(`${c.tool}(${argSummary(c.args)})`, el('span', { className: 'ms', textContent: `${c.ms} ms` }));
        t.append(chip);
    }
}

const safeUrl = (u) => (/^https:\/\//.test(u) ? u : null);

function card(r) {
    const [label, cls] = SOURCE_LABEL[r.source] ?? [r.source, ''];
    const url = safeUrl(r.url);
    const dl = el('dl');
    if (r.hazard) dl.append(el('dt', { textContent: 'Hazard' }), el('dd', { className: 'hazard clamp', textContent: r.hazard, title: r.hazard }));
    if (r.remedy) dl.append(el('dt', { textContent: 'Remedy' }), el('dd', { className: 'clamp', textContent: r.remedy, title: r.remedy }));
    return el('article', { className: 'card' },
        el('div', { className: 'card-top' },
            el('span', { className: `src ${cls}`, textContent: label }),
            el('span', { className: 'date', textContent: r.date })),
        el('h3', { className: 'clamp', textContent: r.title, title: r.title }),
        r.matchedItems?.length ? el('span', { className: 'matched', textContent: `Matches your ${r.matchedItems.join(', ')}` }) : null,
        dl,
        url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: r.source.startsWith('openfda') ? 'View FDA record ↗' : 'View official notice ↗' }) : null,
    );
}

function renderCards(recalls) {
    $('cards').replaceChildren(...recalls.map(card));
}

function addTranscript(role, text, extra = '') {
    const list = $('transcript');
    list.querySelector('.empty')?.remove();
    const li = el('li', { className: `${role} ${extra}`.trim(), textContent: text });
    list.append(li);
    li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

const KIND_GLYPH = { product: 'P', food: 'F', medicine: 'Rx', any: '∗' };

async function loadWatchlist() {
    try {
        const r = await fetch('api/watchlist');
        const { items = [] } = await r.json();
        renderWatchlist(items);
    } catch {
        renderWatchlist([]);
    }
}

function renderWatchlist(items) {
    const ul = $('watchlist');
    $('watch-count').textContent = items.length ? String(items.length) : '';
    if (!items.length) {
        ul.replaceChildren(el('li', { className: 'empty', textContent: 'Nothing yet. Say "watch my stroller".' }));
        return;
    }
    ul.replaceChildren(...items.map((i) => {
        const rm = el('button', { className: 'rm', type: 'button', textContent: '×', title: `Stop watching ${i.name}` });
        rm.addEventListener('click', () => ask(`Stop watching ${i.name}`));
        return el('li', { className: state.lastHits.has(i.name) ? 'hit' : '' },
            el('span', { className: `kind ${i.kind}`, textContent: KIND_GLYPH[i.kind] ?? '?', title: i.kind }),
            el('span', { className: 'name', textContent: i.name, title: i.name }),
            rm);
    }));
}

// ---------- ask ----------
async function ask(q) {
    q = q.trim();
    if (!q || state.busy) return;
    state.busy = true;
    $('ask-form').querySelector('.send').disabled = true;
    showHeard(q);
    addTranscript('user', q);
    setState('thinking');
    let reply;
    try {
        const res = await fetch('api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q, history: state.history.slice(-6) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        reply = data.reply;
        document.body.classList.add('has-answer');
        $('reply').textContent = reply;
        $('reply').classList.toggle('long', reply.length > 220);
        renderTrace(data.trace);
        renderCards(data.recalls);
        state.lastHits = new Set(data.recalls.flatMap((r) => r.matchedItems ?? []));
        addTranscript('assistant', reply);
        state.history.push({ role: 'user', content: q }, { role: 'assistant', content: reply });
        if (data.trace.some((t) => t.tool.startsWith('watchlist_') || t.tool === 'check_my_household')) await loadWatchlist();
    } catch (e) {
        reply = 'Sorry, I could not reach the recall service. Please try again.';
        $('reply').textContent = reply;
        renderTrace([]);
        renderCards([]);
        addTranscript('assistant', `${reply} (${e.message})`, 'error');
    } finally {
        state.busy = false;
        $('ask-form').querySelector('.send').disabled = false;
    }
    setState('idle');
    await speak(reply);
    setState('idle');
}

$('ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value;
    $('q').value = '';
    ask(q);
});
$('watch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('watch-input').value.trim();
    $('watch-input').value = '';
    if (name) ask(`Watch ${name}`);
});
$('suggestions').append(...SUGGESTIONS.map((s) => {
    const b = el('button', { type: 'button', textContent: s });
    b.addEventListener('click', () => ask(s));
    return b;
}));
$('transcript').append(el('li', { className: 'empty', textContent: 'Your conversation appears here.' }));

// ---------- boot ----------
async function boot() {
    try {
        const { provider } = await (await fetch('api/config')).json();
        const m = $('mode');
        m.textContent = provider.label;
        m.classList.toggle('scripted', provider.id === 'scripted');
        m.title = provider.id === 'scripted'
            ? 'Scripted mode: a fixed phrase-to-tool mapping answers, no language model. The MCP tools and data are real.'
            : `Answers come from ${provider.label}, calling the Recall Radar MCP tools.`;
    } catch {
        $('mode').textContent = 'offline';
    }
    await loadWatchlist();
    // ?q=...&q=... asks each question in turn: a scripted walkthrough for demos and video.
    for (const q of params.getAll('q')) {
        await ask(q);
        await new Promise((r) => setTimeout(r, 400));
    }
    document.body.dataset.ready = '1';
}
boot();
