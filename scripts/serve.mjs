// Zero-dependency static file server:  node scripts/serve.mjs [port] [dir]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[3] || join(fileURLToPath(import.meta.url), '..', '..'));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.ico': 'image/x-icon' };

export function startServer({ port: p = port, dir = root, quiet = false } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(dir, path));
      if (!file.startsWith(dir)) { res.writeHead(403).end('Forbidden'); return; }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((ok) => server.listen(p, () => { if (!quiet) console.log(`L7N Fantasy Lab → http://localhost:${server.address().port}/  (serving ${dir})\nPress Ctrl+C to stop.`); ok(server); }));
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('serve.mjs')) startServer();
