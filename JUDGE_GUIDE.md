# Run Recall Radar as a judge

Recall Radar is a self-hosted MCP server (protocol `2025-11-25`, Streamable HTTP) with a **simulated** smart-display front end. It has not been attached to an Alexa+ device. The local, keyless demo uses a labelled scripted phrase-to-tool mapper; that mapper is not an LLM. The MCP tools and public recall queries are real in both modes.

## Clean start (Node 20+)

```sh
git clone https://github.com/MGrin/recall-radar-mcp.git
cd recall-radar-mcp
npm ci
MODEL_PROVIDER=scripted npm start
```

Open <http://127.0.0.1:3000/>. The badge must read **Scripted mode, no LLM**. For a fresh watchlist, set `WATCHLIST_PATH` to a new writable file path before starting. The default is `./data/watchlist.json`. No account or API key is needed for CPSC, openFDA or EMA. If Node runs behind an HTTP proxy, Node 24+ needs `NODE_USE_ENV_PROXY=1` for its built-in `fetch`; the browser and `curl` can work while Node cannot.

### Two-minute walkthrough

1. Click **Watch my crib mattress**. The right panel should show the item and the trace should show `watchlist_add`.
2. Click **Has anything in my house been recalled?** The trace should show `check_my_household`; any matching cards show a date, official source link, hazard and remedy. On 2026-09-27, this found the 2026-08-06 CPSC Voomf crib-mattress recall. Live results and the default 90-day window change with time.
3. Click **Is there a recall on peanut butter?** to see FDA food records, or **Is ibuprofen recalled or short?** for FDA drug recalls and EMA shortages. FDA record links open the exact openFDA API record.
4. Click **What am I watching?**, then remove the item with ×. The transcript and MCP trace show the path taken.

The same first two actions can be replayed with [this demo URL](http://127.0.0.1:3000/?mute=1&q=Watch%20my%20crib%20mattress&q=Has%20anything%20in%20my%20house%20been%20recalled%3F). `mute=1` avoids automatic browser speech during silent inspection. Scripted mode recognizes only the examples shown in the UI; use model mode for free-form phrasing after its key has been verified.

### Inspect the MCP surface

With the server running:

```sh
curl -fsS http://127.0.0.1:3000/healthz
npm run call  # lists all seven tools through the bundled Streamable HTTP SDK client
npm run call -- search_product_recalls '{"query":"crib","limit":3}'
npm run call -- watchlist_list '{}'
```

For MCP Inspector, run `npx @modelcontextprotocol/inspector`, select **Streamable HTTP**, connect to `http://127.0.0.1:3000/mcp`, then list and call tools. `/mcp` is a stateless POST endpoint; a browser GET returns 405. A raw `initialize` response may be SSE rather than plain JSON.

### Docker alternative

```sh
docker build -t recall-radar-mcp .
docker run --rm -p 127.0.0.1:3000:3000 recall-radar-mcp
```

The UI is at `http://127.0.0.1:3000/`, MCP at `/mcp`, and health at `/healthz`. Docker keeps its watchlist inside the container unless a writable path is mounted. The supplied Docker image sets `HOST=0.0.0.0` inside the container.

## Interpretation and limits

- A watchlist check is **on demand**. This version does not schedule alerts or know what is actually in a household until someone adds an item.
- Results may be incomplete or delayed. The UI shows source warnings where one upstream fails. Confirm the product and lot against the linked notice; ask a pharmacist or doctor before changing medicine use.
- The browser has push-to-talk and spoken-reply code, with typed input as fallback. Microphone permission, speech recognition and speaker output still need a real-device check. The OpenAI adapter has fixture coverage but no successful live model call as of 2026-09-27.
- The repository is currently private. Review access and public video requirements are listed in [SUBMISSION_DRAFT.md](SUBMISSION_DRAFT.md); access must be arranged before judging.
