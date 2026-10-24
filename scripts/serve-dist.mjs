#!/usr/bin/env node
/**
 * Lokalny serwer statyczny naśladujący GitHub Pages dla podglądu i kontroli offline:
 * pliki z `dist` wyłącznie pod podścieżką `base`, `Cache-Control: max-age=600` (jak Pages),
 * 404 dla brakujących plików (bez przepisywania ścieżek na index.html — routing aplikacji jest hashowy).
 *
 *   node scripts/serve-dist.mjs [--dist dist] [--base /doktor-monika-egzamin/] [--port 4174]
 *
 * Adres http://127.0.0.1:<port><base> (jak localhost) jest bezpiecznym kontekstem — Service Worker działa.
 * To narzędzie lokalne, nie serwer produkcyjny.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {{ dist: string, base: string, port?: number, host?: string }} options
 * Zwraca serwer z hakami do kontroli: `hooks.transformSw(text)`, `hooks.fail(pathRel) → status|null`,
 * `hooks.offline` (zrywa połączenia — brak sieci), `hooks.dist` (inny katalog buildu — „wdrożenie”
 * nowej wersji pod tym samym adresem), `hooks.delay(pathRel) → ms|null` (opóźnienie odpowiedzi — np. przerwanie
 * pobierania aktualizacji), `requests` (lista ścieżek względem base).
 */
export async function startDistServer({ dist, base, port = 0, host = '127.0.0.1' }) {
  const initialRoot = resolve(dist);
  let normalizedBase = base.startsWith('/') ? base : `/${base}`;
  if (!normalizedBase.endsWith('/')) normalizedBase += '/';
  const hooks = { transformSw: null, fail: null, offline: false, dist: null, delay: null };
  const requests = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(normalizedBase)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(normalizedBase.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    // Symulacja braku sieci po stronie serwera (zerwane połączenie).
    if (hooks.offline) {
      req.socket.destroy();
      return;
    }
    requests.push(rel);
    const wait = hooks.delay?.(rel);
    if (wait) await new Promise((ok) => setTimeout(ok, wait));
    const forced = hooks.fail?.(rel);
    if (forced) {
      res.writeHead(forced, { 'content-type': 'text/plain; charset=utf-8' }).end(String(forced));
      return;
    }
    const root = hooks.dist ? resolve(hooks.dist) : initialRoot;
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      let body = await readFile(file);
      if (rel === 'sw.js' && hooks.transformSw) body = Buffer.from(hooks.transformSw(body.toString('utf8')), 'utf8');
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'max-age=600',
        'content-length': body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
    }
  });

  await new Promise((ok) => server.listen(port, host, ok));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}${normalizedBase}`,
    port: actualPort,
    base: normalizedBase,
    hooks,
    requests,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const server = await startDistServer({
    dist: arg('--dist', 'dist'),
    base: arg('--base', process.env.BASE_PATH || '/'),
    port: Number(arg('--port', '4174')),
  });
  console.log(`Podgląd dist (jak GitHub Pages): ${server.url}  — Ctrl+C kończy`);
}
