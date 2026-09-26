#!/usr/bin/env node
// Minimal MCP client over Streamable HTTP, for trying the server without an LLM.
//   node scripts/call.mjs                       -> list tools
//   node scripts/call.mjs <tool> '<json args>'  -> call a tool
// MCP_URL overrides the endpoint (default http://127.0.0.1:3000/mcp).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const [tool, args = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'recall-radar-cli', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(url));
try {
    if (!tool) {
        const { tools } = await client.listTools();
        for (const t of tools) console.log(`${t.name}: ${t.description}`);
    } else {
        const r = await client.callTool({ name: tool, arguments: JSON.parse(args) });
        console.log(JSON.stringify(r, null, 2));
    }
} finally {
    await client.close();
}
