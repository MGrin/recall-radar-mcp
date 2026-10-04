# Recall Radar — an MCP server and voice front end for "has anything in my house been recalled?"

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that lets a voice
assistant answer household safety questions from **public government recall data**:

- US product recalls (CPSC) and home medical-device recalls (FDA),
- US food recalls (FDA),
- US medicine recalls (FDA) and EU medicine shortages (European Medicines Agency),
- EU dangerous-product alerts (EU Safety Gate, formerly RAPEX),
- and a **household watchlist** the assistant checks proactively: *"has anything I own been recalled since the summer?"*

Every answer carries a short `spoken` sentence for the voice reply, plus structured detail with the
**source URL and date** of every item. No API keys, no accounts, no LLM needed to run it.

Built for the Amazon Developer Hackathon, Alexa+ track. MCP spec **2025-11-25**, **Streamable HTTP**,
stateless, `@modelcontextprotocol/sdk` 1.30.1.

This is a **simulated** smart-display experience backed by a real MCP server; it has not been connected
to an Alexa+ device. See the [judge-run guide](JUDGE_GUIDE.md), the [verification record](EVIDENCE.md) and the
[friction log](FRICTION.md).

> **Not medical or safety advice.** Recall and shortage data can be incomplete or late. Always check
> the linked notice, and ask a pharmacist, doctor or the manufacturer before acting. Never stop a
> prescribed medicine on your own.

## Run it (one command)

Node 20 or newer. One process serves the MCP server at `/mcp`, the voice UI at `/` and the agent at
`POST /api/ask`:

```sh
npm ci && npm start
# recall-radar MCP server: http://127.0.0.1:3000/mcp (health: /healthz, ...)
# Recall Radar voice UI:   http://127.0.0.1:3000/  (agent: POST /api/ask, model: Scripted mode, no LLM)
```

**Judge path.**

1. **No key, scripted mode.** `npm start`, open <http://127.0.0.1:3000/>. The badge reads *Scripted mode,
   no LLM*: a fixed phrase-to-tool mapping stands in for the model, but the MCP calls and the recall data
   are real and live. Try the suggestion chips, or drive it from the URL:
   `http://127.0.0.1:3000/?q=Watch%20my%20crib%20mattress&q=Has%20anything%20in%20my%20house%20been%20recalled%3F`
2. **With a model.** Set `OPENAI_API_KEY` outside the repository and run `npm start`. The badge
   identifies the selected model (`gpt-6-luna` by default). This path was run live on 2026-10-02
   with that model; other models were not exercised ([EVIDENCE.md](EVIDENCE.md)).

Or Docker:

```sh
docker build -t recall-radar-mcp . && docker run --rm -p 3000:3000 recall-radar-mcp
docker run --rm -p 3000:3000 -e OPENAI_API_KEY recall-radar-mcp   # with a model
```

| env | default | meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | bind address |
| `WATCHLIST_PATH` | `./data/watchlist.json` | where the household watchlist is stored; CPSC's last good responses are saved beside it as `cpsc-cache.json` |
| `ALLOWED_ORIGINS` | *(none)* | extra browser `Origin`s allowed besides localhost (comma-separated, `*` for any) |
| `MODEL_PROVIDER` | `openai` if `OPENAI_API_KEY` is set, else `scripted` | `openai`, `ollama` or `scripted` |
| `OPENAI_API_KEY` | *(none)* | OpenAI key; never logged or sent to the browser |
| `OPENAI_MODEL` | `gpt-6-luna` | any Chat Completions model with function calling |
| `OPENAI_REASONING_EFFORT` | `none` | sent as `reasoning_effort`; GPT-6 models refuse function tools on Chat Completions without `none`. Set `omit` for a model that rejects the field |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | for an OpenAI-compatible gateway |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `llama3.1` | Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`) |
| `MCP_URL` | this process's own `/mcp` | point the agent at another Recall Radar MCP server |

Endpoints: `POST /mcp` (MCP Streamable HTTP, stateless: no session id, no GET stream), `GET /healthz`,
`GET /` (the UI), `POST /api/ask` (`{"q": "...", "history": [...]}`), `GET /api/config`, `GET /api/watchlist`.
A stdio entry is also included: `npm run start:stdio`.

The stdio entry is listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.MGrin/household-recall-watch` ([server.json](server.json)). Its package is an MCPB bundle
attached to the GitHub release; `npm run pack:mcpb` rebuilds it and prints the SHA-256 that
`server.json` must carry. The bundle keeps its watchlist at `~/.recall-radar/watchlist.json`.
Publishing is `.github/workflows/publish-mcp.yml`: on a `v*` tag (or `gh workflow run publish-mcp.yml
--ref vX.Y.Z`) it checks the release bundle against `server.json`, then publishes with GitHub OIDC.
Attach the bundle to the GitHub release before the workflow runs.

If your machine reaches the internet only through an HTTP proxy, Node's built-in `fetch` ignores
`HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1` (Node 24+). That applies to the OpenAI calls too.

## The voice front end (a simulated smart display)

The track allows *"a simulated Alexa+ experience in a web app"*; this is ours, named Recall Radar and
using no third-party marks.

- **Push to talk**: hold the mic button (or the space bar) and speak; it uses the browser's Web Speech
  API (`SpeechRecognition`). Where that is missing the mic is disabled and the text box does the same job.
  Microphone behavior still needs a real-device check.
- **Spoken reply** through `speechSynthesis`, with a mute toggle; a light bar along the bottom edge shows
  listening, thinking and speaking. Speaker output still needs a real-device check.
- **Tool trace**: a chip for every MCP tool the agent called, with its argument and latency, so a viewer
  can see the answer came from the MCP server.
- **Recall cards**: source, date, title, hazard, remedy, the watchlist item it matched, and a link to the
  official notice.
- **Household watchlist** panel (add with the + box or by voice, remove with ×; both go through the agent),
  and a transcript.
- `?q=...` asks on load; repeat it (`?q=a&q=b`) for a scripted walkthrough, and add `mute=1` for silent
  capture.

### The agent (`src/agent/`)

`agent.ts` is a real MCP client (SDK `Client` + `StreamableHTTPClientTransport`): per question it
connects to `/mcp`, lists the tools, maps them to the model's function format and runs the tool-call
loop, capped at **6 model steps**. Tool results go back to the model as the tool's `structuredContent`.
A `ModelAdapter` (`types.ts`) is one method: messages + tools in, text or tool calls out.

| adapter | status |
|---|---|
| `openai` (`openai.ts`) | OpenAI Chat Completions with tools over plain `fetch`, no SDK. Unit-tested against recorded-shape responses, including a 3-step tool loop. Run against the live API with `gpt-6-luna` on 2026-10-02 ([EVIDENCE.md](EVIDENCE.md)). |
| `ollama` | The same class pointed at Ollama's OpenAI-compatible endpoint. **Untested**: Ollama was not installed on the build machine. |
| `scripted` (`scripted.ts`) | Deterministic: a few phrasings map to one tool call, and the reply is the tool's own `spoken` sentence (first item only). Used by the tests and the no-key demo. |

The system prompt (`prompt.ts`) keeps answers voice-first (two or three sentences: hazard, official
remedy, what to do now), grounds every claim in a tool result, and forbids medical advice beyond the
official remedy text.

## Try it

**MCP Inspector** (no LLM key needed):

```sh
npx @modelcontextprotocol/inspector
```

In the Inspector UI choose transport **Streamable HTTP**, URL `http://127.0.0.1:3000/mcp`, Connect,
then *Tools → List Tools* and call any tool.

**From the terminal**, with the bundled SDK client:

```sh
npm run call                                                   # list tools
npm run call -- search_product_recalls '{"query":"stroller","limit":3}'
npm run call -- watchlist_add '{"name":"crib mattress","kind":"product"}'
npm run call -- check_my_household '{}'
```

## Tools

Eight tools. `search_eu_product_recalls` was added in v0.2.0, after the demo video was recorded; the
video shows and says seven.

| tool | what it answers | sources |
|---|---|---|
| `search_product_recalls` | "Has my stroller / space heater / crib been recalled?" | CPSC, openFDA device |
| `search_food_recalls` | "Is there a recall on peanut butter?" "Any listeria recalls?" | openFDA food |
| `search_medicine_alerts` | "Is my insulin recalled or short?" (`region`: `us`, `eu`, `all`) | openFDA drug, EMA shortages |
| `watchlist_add` | "Keep an eye on my Graco stroller." (`kind`: product, food, medicine, any) | local file |
| `watchlist_list` | "What am I watching?" | local file |
| `watchlist_remove` | "Stop watching the stroller." | local file |
| `search_eu_product_recalls` (v0.2.0) | "Was my USB charger recalled in the EU?" By product, brand, model or barcode (default: last 28 days, at most the 12 latest weekly reports) | EU Safety Gate |
| `check_my_household` | "Has anything in my house been recalled?" (default: last 180 days) | CPSC, openFDA, EMA, by item kind (not Safety Gate) |

Each tool declares a zod input schema and an `outputSchema`; results come back as `structuredContent`
(validated by the SDK) and as text. Each recall is normalised to:

```ts
{ source, id, title, hazard, remedy, date /* YYYY-MM-DD */, products[], url, summary /* one spoken sentence */ }
```

If one upstream is down, the others still answer and the result lists a warning; if every source for
a question is down, the tool returns a clean MCP tool error (`isError: true`).

CPSC's API has answered some URLs and 503'd others, consistently per URL, for days at a time (seen
2026-10-02 to 10-04). So a CPSC read tries the window's own URL, then the same window without the
product filter, then up to three EARLIER start dates (the 1st of the month, the 1st of the month
before, a few dates that answered during the outage), and filters the rows here to the requested
window: at most 6 requests in 20 seconds. When an earlier URL served the answer, the result says so
in `notes`, naming that URL. Every good CPSC response is also saved beside the watchlist
(`cpsc-cache.json`, the last 8 URLs, each with its fetch time). If every live attempt fails, the
rows of the freshest saved copy that fall inside the window are served, each summary ending
"From a saved copy of CPSC data fetched <date>; CPSC could not be reached live", and a warning
names the fetch time; with no saved copy, CPSC is reported unavailable. Nothing else is invented.

Every upstream request
has a 10-second timeout (20 seconds for Safety Gate). The EMA file is cached for an hour in memory,
because EMA rate-limits repeated downloads. Safety Gate publishes one weekly report every Friday, each
about 200-300 KB and 3-6 seconds to serve (2026-10-02): a search reads at most 12 reports, four at a
time, caches the index for an hour and each published report for the life of the process. A cold
four-week search took about 5 seconds; a repeat answers from the cache. When the window holds more
than 12 reports, `since` in the answer is the oldest report actually read.

## Data sources and terms

| source | endpoint | terms |
|---|---|---|
| US Consumer Product Safety Commission | `saferproducts.gov/RestWebServices/Recall` | US government work, public domain |
| openFDA enforcement reports (food, drug, device) | `api.fda.gov/{food,drug,device}/enforcement.json` | public domain / CC0 per [open.fda.gov/license](https://open.fda.gov/license/); openFDA's own disclaimer: do not rely on it for medical-care decisions. Keyless use is rate-limited ([terms](https://open.fda.gov/terms/)). |
| European Medicines Agency, medicine shortages catalogue | `ema.europa.eu/en/documents/report/shortages-output-json-report_en.json` | reuse permitted with EMA acknowledged as the source ([legal notice](https://www.ema.europa.eu/en/about-us/about-website/legal-notice)); every EMA item carries its EMA URL |
| European Commission, EU Safety Gate weekly reports | `ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/{list,detail}/xml/…` | reuse authorised if the alerts' meaning is not distorted and the source is acknowledged in the Commission's exact words ([disclaimer](https://api.tech.ec.europa.eu/justools-content/buckets/saga/folder/menu/filename/New_disclaimer_EN.pdf), "Reuse of alerts", current revision 2026-06-11). Every answer carries that sentence as `attribution` and in its text; every item links its official alert |

openFDA has no per-recall web page, so an FDA item's `url` is the openFDA API query that returns exactly
that recall (`search=recall_number:"…"`).

The Safety Gate attribution, verbatim: *"Alerts from the Rapid Alert System for dangerous non-food
products, published free of charge on the Safety Gate website (https://ec.europa.eu/safety-gate-alerts)
© European Union, 2005 – 2026"*. The Commission also notes that brands in the alerts may have been used
by the economic operators without the owner's permission.

### Pre-existing code adapted

`src/sources/ema.ts` adapts our own earlier code from the `ema-medicines-watch` Apify Actor (same
author): the EMA dd/mm/yyyy date parser, the `{meta, data[]}` shape check and the truncated-file guard.
`src/sources/safetygate.ts` adapts the `eu-recall-watchlist` Apify Actor (same author): the Safety Gate
XML parser settings, CDATA handling, the run-together `measures` field and the verbatim attribution.
Everything else was written for this entry.

## Development

```sh
npm run build        # tsc -> dist/
npm test             # vitest, against recorded fixtures in test/fixtures (no network)
LIVE=1 npm test      # also runs test/live.test.ts against the real APIs
```

`test/agent.test.ts` runs the agent loop with the scripted adapter against the real MCP server over HTTP
(upstreams mocked to fixtures), plus the `/api/*` routes and the static UI. `test/openai.test.ts` runs the
OpenAI adapter against a mocked Chat Completions endpoint, alone and inside a multi-step agent loop.

The end-to-end test starts the HTTP server, connects with the SDK `Client` over
`StreamableHTTPClientTransport`, checks that protocol `2025-11-25` is negotiated, lists the tools and
calls every one, with upstream `fetch` routed to fixtures.

## Licence

MIT, © 2026 Nikita Grishin Limited. See [LICENSE](LICENSE). Friction log: [FRICTION.md](FRICTION.md).
