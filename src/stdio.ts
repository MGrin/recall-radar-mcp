#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { createServer, makeDeps } from './server.js';

const c = config();
await createServer(makeDeps({ watchlistPath: c.watchlistPath })).connect(new StdioServerTransport());
