/** The household watchlist: a small JSON file, written atomically, one writer at a time. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const KINDS = ['product', 'food', 'medicine', 'any'] as const;
export type Kind = (typeof KINDS)[number];
export const MAX_ITEMS = 50;

export const WatchItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(KINDS),
    addedAt: z.string(),
});
export type WatchItem = z.infer<typeof WatchItemSchema>;

const FileSchema = z.object({ version: z.literal(1), items: z.array(WatchItemSchema) });

export class Watchlist {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(readonly path: string) {}

    async list(): Promise<WatchItem[]> {
        let raw: string;
        try {
            raw = await readFile(this.path, 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw e;
        }
        const parsed = FileSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw new Error(`Watchlist file ${this.path} is not in the expected format`);
        return parsed.data.items;
    }

    private async save(items: WatchItem[]): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify({ version: 1, items }, null, 2) + '\n');
        await rename(tmp, this.path);
    }

    /** Serialise read-modify-write so concurrent requests cannot lose an update. */
    private locked<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.queue.then(fn, fn);
        this.queue = run.catch(() => undefined);
        return run;
    }

    add(name: string, kind: Kind): Promise<{ item: WatchItem; added: boolean }> {
        return this.locked(async () => {
            const items = await this.list();
            const clean = name.replace(/\s+/g, ' ').trim();
            const existing = items.find((i) => i.name.toLowerCase() === clean.toLowerCase());
            if (existing) return { item: existing, added: false };
            if (items.length >= MAX_ITEMS) throw new Error(`The watchlist is full (${MAX_ITEMS} items). Remove something first.`);
            const item: WatchItem = { id: randomUUID().slice(0, 8), name: clean, kind, addedAt: new Date().toISOString() };
            await this.save([...items, item]);
            return { item, added: true };
        });
    }

    /** Remove by id or by case-insensitive name. */
    remove(nameOrId: string): Promise<WatchItem | null> {
        return this.locked(async () => {
            const items = await this.list();
            const key = nameOrId.trim().toLowerCase();
            const hit = items.find((i) => i.id === nameOrId.trim() || i.name.toLowerCase() === key);
            if (!hit) return null;
            await this.save(items.filter((i) => i !== hit));
            return hit;
        });
    }
}
