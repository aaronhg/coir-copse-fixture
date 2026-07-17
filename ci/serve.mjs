#!/usr/bin/env node
// Zero-dep static server for the built game. (House style: no runtime deps.)
// Usage: node serve.mjs [port]   — serves ../build/web-mobile  (commit that build;
// this repo intentionally ships the pre-built target so CI never runs the editor).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../build/web-mobile/', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8899);

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/') p = '/index.html';
        // contain traversal: normalized path must stay under ROOT
        const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

server.listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} → http://127.0.0.1:${PORT}/`));
