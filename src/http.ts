#!/usr/bin/env node
import { adapterFromEnv } from './agent/providers.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { makeDeps } from './server.js';

const c = config();
const adapter = adapterFromEnv();
const app = createApp(makeDeps({ watchlistPath: c.watchlistPath }), {
    allowedOrigins: c.allowedOrigins,
    web: { adapter, mcpUrl: process.env.MCP_URL?.trim() || undefined },
});
app.listen(c.port, c.host, () => {
    const base = `http://${c.host}:${c.port}`;
    console.log(`recall-radar MCP server: ${base}/mcp (health: /healthz, watchlist: ${c.watchlistPath})`);
    console.log(`Recall Radar voice UI:   ${base}/  (agent: POST /api/ask, model: ${adapter.label})`);
});
const stop = () => {
    app.close(() => process.exit(0));
    app.closeAllConnections();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
