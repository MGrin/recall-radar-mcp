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
