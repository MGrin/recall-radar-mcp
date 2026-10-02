# Friction log

Factual notes on what got in the way while building this server with the MCP TypeScript SDK
(`@modelcontextprotocol/sdk` 1.30.1) and the MCP spec 2025-11-25. Newest last. Each entry says what
happened and what we did; nothing here is guessed.

## 2026-09-26 — M1, first build of the server

1. **No way to read the negotiated protocol version from `Client`.** We wanted a test asserting the
   server negotiates `2025-11-25`. `Client` (client/index.d.ts) exposes `getServerVersion()` and
   `getServerCapabilities()` but no getter for the protocol version it agreed; the value is only passed
   to `transport.setProtocolVersion()` internally. We tested it with a raw `initialize` POST instead.

2. **A stateless `initialize` answers as an SSE stream, not JSON.** With
   `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` and a client `Accept` of
   `application/json, text/event-stream`, the response is `text/event-stream` with the JSON-RPC result
   on a `data:` line, unless `enableJsonResponse: true` is set. Correct per spec, but it means a plain
   `fetch(...).json()` in a test fails; we parse the `data:` line.

3. **DNS-rebinding protection moved out of the transport, and the replacement is Express-only.** The
   transport options `allowedHosts`, `allowedOrigins` and `enableDnsRebindingProtection` are marked
   `@deprecated Use external middleware`. The SDK's middleware (`server/middleware/hostHeaderValidation`,
   `createMcpExpressApp`) takes Express `RequestHandler`s. With a plain `node:http` server there is no
   ready-made equivalent, so we wrote our own `Origin` check (the spec says servers MUST validate
   `Origin`): no Origin or a localhost Origin passes, anything else gets 403 unless listed in
   `ALLOWED_ORIGINS`.

4. **Stateless mode means a new `McpServer` per request.** Tools are registered on the server instance,
   so the stateless pattern is: build the server, register seven tools, connect a fresh transport,
   handle one POST, close both on `res.close`. It works; the cost is re-registering (and re-converting
   zod schemas to JSON Schema) on every request.

5. **`GET /mcp` and `DELETE /mcp` have no meaning in stateless mode.** We answer both with HTTP 405 and a
   JSON-RPC error body, and document it; the SDK does not do this for you when you route by hand.

## Tooling, not SDK (recorded for completeness)

6. **`vitest` 5 requires Node `^22.12 || ^24 || >=26`.** We target Node >= 20, so we pinned vitest 3.2.7
   (engines `^18 || ^20 || >=22`) and `@types/node` 22. `npm i -D vitest@latest @types/node@20` failed
   with an ERESOLVE peer conflict on `@types/node`.

7. **Node's built-in `fetch` ignores `HTTPS_PROXY`.** On a machine whose egress goes through an HTTP
   proxy, every upstream call failed with `fetch failed` (`getaddrinfo ENOTFOUND api.fda.gov`) while
   `curl` succeeded. `NODE_USE_ENV_PROXY=1` fixed it (Node 26 here). We now include the error `cause`
   code in the tool error message, because the bare `fetch failed` said nothing.

8. **openFDA answers an empty search with HTTP 404** (`{"error":{"code":"NOT_FOUND","message":"No matches found!"}}`),
   not an empty list. CPSC answers an empty search with `[]` and HTTP 200. We treat openFDA's 404 as
   "no results".

9. **openFDA food search on `product_description` alone missed hazard words.** A live
   `search_food_recalls` for "listeria" returned nothing because the organism is named in
   `reason_for_recall`, not the product name. The food tool now matches both fields.

## 2026-09-26 — M2, agent loop and voice front end

10. **Tool `inputSchema`s from `listTools()` carry `$schema`.** Every schema the SDK lists (zod converted
    to JSON Schema) includes `"$schema": "http://json-schema.org/draft-07/schema#"`, even for a tool with
    no inputs (`{"type":"object","properties":{},"$schema":...}`). Function-calling APIs take a bare JSON
    Schema object, so the OpenAI adapter strips `$schema` before sending. We did not test whether OpenAI
    rejects it (no key yet); we strip it to be safe.

11. **A stateless server means a new MCP session per question.** The agent connects, runs `initialize`,
    `tools/list`, then each `tools/call`, each a separate POST, and closes. Measured locally: connect plus
    list took 69 ms. Fine for a demo; a long-lived agent would cache the tool list.

12. **The M1 `spoken` field is too long to read aloud.** For a search it names the first *and* second
    result, each with a long hazard sentence; in the UI that was over 400 characters and pushed the cards
    below the fold. The scripted adapter now speaks the headline and the first item only; the LLM
    adapters are told to answer in two or three sentences.

13. **The fixture router returns the same device fixture for any device query.** So in tests
    `check_my_household` reports thermometer recalls with an empty `matchedItems` for a watched "crib
    mattress". Live, openFDA filters by the query and this did not happen in our checks. The tests assert
    on the matched sources only.

14. **OpenAI's default model had to be read off the docs, not assumed.** The models page (read
    2026-09-26) lists GPT-6 Astra, Sol and Luna; `gpt-6-luna` is the low-cost one, and its model page lists
    Chat Completions and function calling. We default to it; `OPENAI_MODEL` overrides. Not verified with a
    live call.

15. **Headless Chromium cannot exercise speech.** `webkitSpeechRecognition` exists in the headless shell
    (the mic button stayed enabled) but there is no microphone and no voices, so push-to-talk and
    `speechSynthesis` were checked by code review only; screenshots were driven with `?q=` and the text box.

## 2026-09-27 — judge preparation, submission-ready entries

These entries describe developer-tool friction with the fields requested by the hackathon. They are
reproducible observations, not claims that the SDK or public APIs are defective.

| Task and steps | Expected / actual | Severity | Workaround | Actionable suggestion |
|---|---|---|---|---|
| Assert MCP `2025-11-25` negotiation: connect `Client` through `StreamableHTTPClientTransport` and inspect its public getters. | Expected a negotiated-version getter; actual public client getters exposed server version and capabilities but not the agreed protocol version. | Low — test observability. | Send a raw `initialize` POST and assert `result.protocolVersion`. | Expose the negotiated protocol version read-only on `Client`, or document the intended assertion path. |
| Read a stateless `initialize` with plain `fetch`: send `Accept: application/json, text/event-stream` and call `.json()`. | Expected a JSON body; actual response was an SSE `event: message` with a `data:` JSON-RPC line (valid protocol behavior). | Low — onboarding surprise. | Parse SSE in the test, or enable JSON response mode. | Include a stateless `node:http` example showing the response format and both client `Accept` variants. |
| Search openFDA for a phrase with no matching food record. | Expected HTTP 200 with `results: []`; actual response was HTTP 404 with `NOT_FOUND` and “No matches found!” | Medium — an unhandled response would mark an empty search as source failure. | Treat this specific 404 as an empty list while preserving other HTTP errors. | Document the no-results status beside the enforcement search example. |

During the same preparation pass, our own app had a generic stop-using phrase on FDA drug and
medical-device cards, and at 800×519 the responsive footer covered a watchlist remove button.
Both were repaired and exercised; they are product defects, not SDK/API friction, and are recorded in
[EVIDENCE.md](EVIDENCE.md) rather than offered as bonus friction entries.

## 2026-10-02 — first live model run

| Task and steps | Expected / actual | Severity | Workaround | Actionable suggestion |
|---|---|---|---|---|
| Run the agent loop against OpenAI Chat Completions with `gpt-6-luna` and seven function tools, no `reasoning_effort` set. | Expected tool calls, as our fixture-shaped tests returned; actual HTTP 400, *"Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions"*. | Blocking until found: every question failed. | Send `reasoning_effort: "none"` (now the adapter default, `OPENAI_REASONING_EFFORT` to change). | A recorded-shape fixture cannot catch a per-model parameter rule; keep one live smoke run per provider before a demo. |
| Call the CPSC Recall API with `ProductName=crib` plus a date. | Expected a filtered list; actual HTTP 503 "Under Construction" for every filtered query on 2026-10-02, while the date-only query answered 200. | High for a product demo: the main source vanished. | On a failed filtered query, fetch by date and filter locally. | Treat upstream filters as optional; the tool already reported the missing source in its answer, which is how we noticed. |
