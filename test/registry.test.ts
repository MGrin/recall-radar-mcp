import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/server.js';

const json = (p: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

describe('MCP Registry entry', () => {
    const entry = json('server.json');
    const manifest = json('mcpb/manifest.json');
    const pkg = entry.packages[0];

    it('carries one version across server.json, the bundle manifest, package.json and the server', () => {
        expect(new Set([entry.version, manifest.version, json('package.json').version, SERVER_VERSION]).size).toBe(1);
        expect(pkg.identifier).toContain(`/releases/download/v${entry.version}/`);
    });

    it('stays inside the registry limits and points at a stdio bundle with a hash', () => {
        expect(entry.name).toMatch(/^io\.github\.MGrin\/[a-zA-Z0-9._-]+$/);
        expect(entry.description.length).toBeLessThanOrEqual(100);
        expect(pkg).toMatchObject({ registryType: 'mcpb', transport: { type: 'stdio' } });
        expect(pkg.fileSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(manifest.server.entry_point).toBe('dist/stdio.js');
    });
});
