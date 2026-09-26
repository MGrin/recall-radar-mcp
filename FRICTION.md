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
