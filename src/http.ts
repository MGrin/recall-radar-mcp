#!/usr/bin/env node
import { createApp } from './app.js';
import { config } from './config.js';
import { makeDeps } from './server.js';

const c = config();
const app = createApp(makeDeps({ watchlistPath: c.watchlistPath }), { allowedOrigins: c.allowedOrigins });
app.listen(c.port, c.host, () => {
    console.log(`recall-radar MCP server: http://${c.host}:${c.port}/mcp (health: /healthz, watchlist: ${c.watchlistPath})`);
});
const stop = () => app.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
