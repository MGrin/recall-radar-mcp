import { resolve } from 'node:path';

export const config = () => ({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '127.0.0.1',
    watchlistPath: resolve(process.env.WATCHLIST_PATH ?? './data/watchlist.json'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
