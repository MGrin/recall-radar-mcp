# Recall Radar — an MCP server for "Alexa, has anything in my house been recalled?"

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that lets a voice
assistant answer household safety questions from **public government recall data**:

- US product recalls (CPSC) and home medical-device recalls (FDA),
- US food recalls (FDA),
- US medicine recalls (FDA) and EU medicine shortages (European Medicines Agency),
- and a **household watchlist** the assistant checks proactively: *"has anything I own been recalled since the summer?"*

Every answer carries a short `spoken` sentence for the voice reply, plus structured detail with the
**source URL and date** of every item. No API keys, no accounts, no LLM needed to run it.

Built for the Amazon Developer Hackathon, Alexa+ track. MCP spec **2025-11-25**, **Streamable HTTP**,
stateless, `@modelcontextprotocol/sdk` 1.30.1.

> **Not medical or safety advice.** Recall and shortage data can be incomplete or late. Always check
> the linked notice, and ask a pharmacist, doctor or the manufacturer before acting. Never stop a
> prescribed medicine on your own.

## Run it (one command)

Node 20 or newer:

```sh
npm ci && npm start
# recall-radar MCP server: http://127.0.0.1:3000/mcp (health: /healthz, ...)
```

Or Docker:

```sh
docker build -t recall-radar-mcp . && docker run --rm -p 3000:3000 recall-radar-mcp
```

| env | default | meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | bind address |
| `WATCHLIST_PATH` | `./data/watchlist.json` | where the household watchlist is stored |
| `ALLOWED_ORIGINS` | *(none)* | extra browser `Origin`s allowed besides localhost (comma-separated, `*` for any) |

Endpoints: `POST /mcp` (MCP Streamable HTTP, stateless: no session id, no GET stream) and `GET /healthz`.
A stdio entry is also included: `npm run start:stdio`.

If your machine reaches the internet only through an HTTP proxy, Node's built-in `fetch` ignores
`HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1` (Node 24+).

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

| tool | what it answers | sources |
|---|---|---|
| `search_product_recalls` | "Has my stroller / space heater / crib been recalled?" | CPSC, openFDA device |
| `search_food_recalls` | "Is there a recall on peanut butter?" "Any listeria recalls?" | openFDA food |
| `search_medicine_alerts` | "Is my insulin recalled or short?" (`region`: `us`, `eu`, `all`) | openFDA drug, EMA shortages |
| `watchlist_add` | "Keep an eye on my Graco stroller." (`kind`: product, food, medicine, any) | local file |
| `watchlist_list` | "What am I watching?" | local file |
| `watchlist_remove` | "Stop watching the stroller." | local file |
| `check_my_household` | "Has anything in my house been recalled?" (default: last 90 days) | all of the above, by item kind |

Each tool declares a zod input schema and an `outputSchema`; results come back as `structuredContent`
(validated by the SDK) and as text. Each recall is normalised to:

```ts
{ source, id, title, hazard, remedy, date /* YYYY-MM-DD */, products[], url, summary /* one spoken sentence */ }
```

If one upstream is down, the others still answer and the result lists a warning; if every source for
a question is down, the tool returns a clean MCP tool error (`isError: true`). Every upstream request
has a 10-second timeout. The EMA file is cached for an hour in memory, because EMA rate-limits
repeated downloads.

## Data sources and terms

| source | endpoint | terms |
|---|---|---|
| US Consumer Product Safety Commission | `saferproducts.gov/RestWebServices/Recall` | US government work, public domain |
| openFDA enforcement reports (food, drug, device) | `api.fda.gov/{food,drug,device}/enforcement.json` | public domain / CC0 per [open.fda.gov/license](https://open.fda.gov/license/); openFDA's own disclaimer: do not rely on it for medical-care decisions. Keyless use is rate-limited ([terms](https://open.fda.gov/terms/)). |
| European Medicines Agency, medicine shortages catalogue | `ema.europa.eu/en/documents/report/shortages-output-json-report_en.json` | reuse permitted with EMA acknowledged as the source ([legal notice](https://www.ema.europa.eu/en/about-us/about-website/legal-notice)); every EMA item carries its EMA URL |

openFDA has no per-recall web page, so an FDA item's `url` is the openFDA API query that returns exactly
that recall (`search=recall_number:"…"`).

TODO: EU Safety Gate (non-food consumer products) is not included yet; its download endpoint was not
reachable from the development machine.

### Pre-existing code adapted

`src/sources/ema.ts` adapts our own earlier code from the `ema-medicines-watch` Apify Actor (same
author): the EMA dd/mm/yyyy date parser, the `{meta, data[]}` shape check and the truncated-file guard.
Everything else was written for this entry.

## Development

```sh
npm run build        # tsc -> dist/
npm test             # vitest, against recorded fixtures in test/fixtures (no network)
LIVE=1 npm test      # also runs test/live.test.ts against the real APIs
```

The end-to-end test starts the HTTP server, connects with the SDK `Client` over
`StreamableHTTPClientTransport`, checks that protocol `2025-11-25` is negotiated, lists the tools and
calls every one, with upstream `fetch` routed to fixtures.

## Licence

MIT, © 2026 Nikita Grishin Limited. See [LICENSE](LICENSE). Friction log: [FRICTION.md](FRICTION.md).
