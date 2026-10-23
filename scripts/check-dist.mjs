#!/usr/bin/env node
/**
 * Kontrola zbudowanego `dist` przed publikacją (G01, G04, A04).
 *
 *   node scripts/check-dist.mjs [--dist dist] [--base /doktor-monika-egzamin/] [--allow-missing-registration]
 *
 * `--base` domyślnie z BASE_PATH (albo `/`). Kod wyjścia 1, gdy którykolwiek warunek ma status FAIL.
 * Sprawdza:
 *  1. pliki: obecność index.html / manifestu / sw.js; tylko dozwolone typy; brak map źródeł, plików roboczych;
 *  2. index.html: każde src/href względne albo pod `base`, istniejący plik, brak hostów zewnętrznych;
 *  3. manifest: start_url/scope/id rozwiązane do `base`, ikony 192/512/maskable (+ apple-touch-icon 180) z wymiarami;
 *  4. sw.js: precache obejmuje shell, JS/CSS, woff2, PNG, SVG, JSON (w tym data/bank.json i każdą figurę
 *     z `bank.figures[*].file`); navigateFallback do
 *     index.html; brak clientsClaim i samoczynnego skipWaiting (tylko obsługa SKIP_WAITING); rejestracja SW w JS
 *     z adresem `${base}sw.js`;
 *  5. brak http(s):// do hostów zewnętrznych (poza URL źródeł w data/bank.json i nazwami przestrzeni XML),
 *     brak support.js, fonts.googleapis/gstatic, sekretów (sk-, api_key, Bearer…), słów anthropic/openai/claude.ai
 *     w JS/HTML, mocka kontrolera; SVG bez skryptów i zasobów zewnętrznych.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

/* ---------------- argumenty ---------------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const distDir = resolve(arg('--dist', 'dist'));
let base = arg('--base', process.env.BASE_PATH || '/');
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;
const allowMissingRegistration = process.argv.includes('--allow-missing-registration');

/** Limit pliku w precache (vite.config.ts PRECACHE_MAX_FILE_BYTES). */
const PRECACHE_MAX_FILE_BYTES = 16 * 1024 * 1024;
const ORIGIN = 'https://example.invalid';

/* ---------------- raport ---------------- */

const results = [];
const pass = (msg) => results.push({ level: 'PASS', msg });
const fail = (msg) => results.push({ level: 'FAIL', msg });
const warn = (msg) => results.push({ level: 'WARN', msg });
const check = (ok, okMsg, failMsg) => (ok ? pass(okMsg) : fail(failMsg ?? okMsg));

/* ---------------- pliki ---------------- */

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`FAIL brak katalogu ${distDir}`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(distDir).map((abs) => ({ abs, rel: relative(distDir, abs).split(sep).join('/') }));
const fileSet = new Set(files.map((f) => f.rel));
const read = (rel) => readFileSync(join(distDir, rel), 'utf8');
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);
const textFiles = files.filter((f) => TEXT_EXT.has(extname(f.rel)));
const BANK = 'data/bank.json';
const PRECACHE_INFO = 'pwa-precache.json';

console.log(`Kontrola dist: ${distDir}\nbase: ${base}\nplików: ${files.length}\n`);

for (const required of ['index.html', 'manifest.webmanifest', 'sw.js', BANK]) {
  check(fileSet.has(required), `jest ${required}`, `brak ${required}`);
}

const ALLOWED_EXT = new Set(['.html', '.js', '.css', '.woff2', '.svg', '.png', '.json', '.webmanifest']);
const disallowed = files.filter((f) => !ALLOWED_EXT.has(extname(f.rel)) && f.rel !== 'robots.txt');
check(disallowed.length === 0, 'tylko dozwolone typy plików (html, js, css, woff2, svg, png, json, webmanifest)', `niedozwolone pliki: ${disallowed.map((f) => f.rel).join(', ')}`);
const workPaths = files.filter((f) => /(^|\/)(_zrodla|redakcja|node_modules|src|tests|docs)(\/|$)/.test(f.rel) || /support\.js$/.test(f.rel));
check(workPaths.length === 0, 'brak katalogów roboczych (_zrodla, redakcja, src, tests, docs) i support.js', `pliki robocze w dist: ${workPaths.map((f) => f.rel).join(', ')}`);

/* ---------------- index.html ---------------- */

/** Sprawdza odwołanie z index.html/manifestu; zwraca ścieżkę w dist albo null. */
function resolveRef(value, from) {
  if (value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:')) return { kind: 'inline' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return { kind: 'external' };
  const url = new URL(value, `${ORIGIN}${from}`);
  if (!url.pathname.startsWith(base)) return { kind: 'outside', path: url.pathname };
  return { kind: 'local', path: decodeURIComponent(url.pathname.slice(base.length)) || 'index.html' };
}

let html = '';
if (fileSet.has('index.html')) {
  html = read('index.html');
  const refs = [...html.matchAll(/\s(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? '');
  const bad = [];
  for (const ref of refs) {
    const r = resolveRef(ref, base);
    if (r.kind === 'external') bad.push(`${ref} (host zewnętrzny)`);
    else if (r.kind === 'outside') bad.push(`${ref} (poza ${base})`);
    else if (r.kind === 'local' && !fileSet.has(r.path)) bad.push(`${ref} (brak pliku ${r.path})`);
  }
  check(bad.length === 0, `index.html: ${refs.length} odwołań — wszystkie pod ${base} i istnieją`, `index.html: złe odwołania: ${bad.join('; ')}`);
  const manifestLink = html.match(/<link[^>]+rel=["']manifest["'][^>]*>/i)?.[0] ?? '';
  const manifestHref = manifestLink.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
  const mRef = manifestHref ? resolveRef(manifestHref, base) : { kind: 'missing' };
  check(mRef.kind === 'local' && mRef.path === 'manifest.webmanifest', `<link rel="manifest"> → ${manifestHref}`, `brak lub zły <link rel="manifest"> (${manifestHref || 'brak'})`);
  const apple = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/i)?.[0] ?? '';
  const appleHref = apple.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
  const aRef = appleHref ? resolveRef(appleHref, base) : { kind: 'missing' };
  if (aRef.kind === 'local' && fileSet.has(aRef.path)) {
    const dim = pngDims(aRef.path);
    check(dim?.w === 180 && dim?.h === 180, `apple-touch-icon ${aRef.path} 180×180`, `apple-touch-icon ${aRef.path}: ${dim ? `${dim.w}×${dim.h}` : 'nie PNG'}, oczekiwano 180×180`);
  } else {
    fail(`brak <link rel="apple-touch-icon"> do istniejącego pliku (${appleHref || 'brak'})`);
  }
  check(/lang=["']pl["']/i.test(html), 'index.html: lang="pl"', 'index.html: brak lang="pl"');
  // A02 / USTALENIA pkt 33: nazwa na ekranie głównym iOS dokładnie „Doktor Monika Egzamin” (bez skrótu).
  const appleTitle = html.match(/<meta[^>]+name=["']apple-mobile-web-app-title["'][^>]*>/i)?.[0]?.match(/content=["']([^"']*)["']/i)?.[1] ?? '';
  check(appleTitle === 'Doktor Monika Egzamin', 'apple-mobile-web-app-title „Doktor Monika Egzamin”', `apple-mobile-web-app-title = „${appleTitle}”`);
  check(!/maximum-scale|user-scalable\s*=\s*no/i.test(html), 'viewport bez blokady powiększania', 'viewport blokuje powiększanie');
}

function pngDims(rel) {
  const buf = readFileSync(join(distDir, rel));
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---------------- manifest ---------------- */

if (fileSet.has('manifest.webmanifest')) {
  let manifest = null;
  try {
    manifest = JSON.parse(read('manifest.webmanifest'));
    pass('manifest.webmanifest: poprawny JSON');
  } catch (e) {
    fail(`manifest.webmanifest: niepoprawny JSON (${e.message})`);
  }
  if (manifest) {
    const manifestUrl = `${ORIGIN}${base}manifest.webmanifest`;
    check(manifest.name === 'Doktor Monika Egzamin', 'manifest: name „Doktor Monika Egzamin”', `manifest: name = ${manifest.name}`);
    check(manifest.short_name === 'Doktor Monika Egzamin', 'manifest: short_name „Doktor Monika Egzamin”', `manifest: short_name = ${manifest.short_name}`);
    check(manifest.lang === 'pl' && manifest.display === 'standalone', 'manifest: lang pl, display standalone', 'manifest: lang/display niezgodne');
    const start = new URL(manifest.start_url ?? '.', manifestUrl);
    check(start.origin === ORIGIN && start.pathname.startsWith(base), `manifest: start_url „${manifest.start_url}” → ${start.pathname}`, `manifest: start_url „${manifest.start_url}” poza ${base}`);
    const scope = new URL(manifest.scope ?? '.', manifestUrl);
    check(scope.origin === ORIGIN && scope.pathname === base, `manifest: scope „${manifest.scope}” → ${scope.pathname}`, `manifest: scope „${manifest.scope}” → ${scope.pathname}, oczekiwano ${base}`);
    if (typeof manifest.id === 'string') {
      // MDN: względne id rozwiązywane względem ORIGINU start_url.
      const id = new URL(manifest.id, start.origin);
      check(id.pathname === base, `manifest: id „${manifest.id}” → ${id.pathname}`, `manifest: id „${manifest.id}” → ${id.pathname}, oczekiwano ${base}`);
    } else {
      warn('manifest: brak id (przeglądarka użyje start_url)');
    }
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const iconProblems = [];
    const have = new Set();
    for (const icon of icons) {
      const r = resolveRef(String(icon.src ?? ''), `${base}manifest.webmanifest`);
      if (r.kind !== 'local' || !fileSet.has(r.path)) {
        iconProblems.push(`${icon.src} (poza base albo brak pliku)`);
        continue;
      }
      const dim = pngDims(r.path);
      const [w, h] = String(icon.sizes ?? '').split('x').map(Number);
      if (!dim || dim.w !== w || dim.h !== h) iconProblems.push(`${icon.src}: ${dim ? `${dim.w}×${dim.h}` : 'nie PNG'} ≠ ${icon.sizes}`);
      for (const purpose of String(icon.purpose ?? 'any').split(/\s+/)) have.add(`${icon.sizes}:${purpose}`);
    }
    check(iconProblems.length === 0, `manifest: ${icons.length} ikon — pliki istnieją, wymiary zgodne`, `manifest: ikony: ${iconProblems.join('; ')}`);
    const needed = ['192x192:any', '512x512:any', '512x512:maskable'];
    const missing = needed.filter((n) => !have.has(n));
    check(missing.length === 0, 'manifest: ikony 192 any, 512 any, 512 maskable', `manifest: brak ikon ${missing.join(', ')}`);
  }
}

/* ---------------- Service Worker ---------------- */

let precacheUrls = [];
if (fileSet.has('sw.js')) {
  const sw = read('sw.js');
  const swPrecache = new Map([...sw.matchAll(/url:\s*"([^"]+)"\s*,\s*revision:\s*(?:null|"([^"]*)")/g)].map((m) => [m[1], m[2] ?? null]));
  precacheUrls = [...swPrecache.keys()];
  check(precacheUrls.length > 0, `sw.js: precache ${precacheUrls.length} wpisów`, 'sw.js: nie znaleziono listy precache');
  const precacheSet = new Set(precacheUrls);
  const notInDist = precacheUrls.filter((u) => !fileSet.has(u));
  check(notInDist.length === 0, 'sw.js: każdy wpis precache istnieje w dist', `sw.js: wpisy precache bez pliku: ${notInDist.join(', ')}`);
  const PRECACHE_EXT = new Set(['.html', '.js', '.css', '.woff2', '.svg', '.png', '.json', '.webmanifest']);
  const runtime = new Set(['sw.js', PRECACHE_INFO]);
  const shouldBeCached = files
    .map((f) => f.rel)
    .filter((rel) => PRECACHE_EXT.has(extname(rel)) && !runtime.has(rel) && !/^workbox-[\w-]+\.js$/.test(rel));
  const notCached = shouldBeCached.filter((rel) => !precacheSet.has(rel));
  check(notCached.length === 0, `sw.js: precache obejmuje wszystkie ${shouldBeCached.length} pliki aplikacji (shell, JS/CSS, woff2, PNG, SVG, JSON)`, `sw.js: poza precache (nie zadziałają offline): ${notCached.join(', ')}`);
  for (const must of ['index.html', BANK, 'manifest.webmanifest']) {
    check(precacheSet.has(must), `sw.js: precache zawiera ${must}`, `sw.js: brak ${must} w precache`);
  }
  check(precacheUrls.some((u) => u.endsWith('.woff2')), 'sw.js: precache zawiera lokalne fonty woff2', 'sw.js: brak fontów woff2 w precache');
  // Schematy z banku (figures[*].file): każdy plik w dist i w precache — dostępny offline (pytanie i objaśnienie).
  if (fileSet.has(BANK)) {
    let bankFigures = [];
    try {
      const parsed = JSON.parse(read(BANK));
      bankFigures = Object.values(parsed.figures ?? {}).map((f) => String(f?.file ?? ''));
    } catch (e) {
      fail(`${BANK}: niepoprawny JSON (${e.message})`);
    }
    const missingFig = bankFigures.filter((f) => !fileSet.has(f));
    const uncachedFig = bankFigures.filter((f) => fileSet.has(f) && !precacheSet.has(f));
    check(
      missingFig.length === 0 && uncachedFig.length === 0,
      `figury z banku (${bankFigures.length}): wszystkie w dist i w precache — ${bankFigures.join(', ') || 'brak'}`,
      `figury z banku: brak w dist: ${missingFig.join(', ') || '—'}; poza precache: ${uncachedFig.join(', ') || '—'}`,
    );
  }
  check(/NavigationRoute\([^)]*createHandlerBoundToURL\(\s*"index\.html"\s*\)/.test(sw), 'sw.js: navigateFallback → index.html (w obrębie scope)', 'sw.js: brak navigateFallback do index.html');
  check(!/clientsClaim/.test(sw), 'sw.js: bez clientsClaim', 'sw.js: zawiera clientsClaim');
  const skipIdx = [...sw.matchAll(/skipWaiting\(\)/g)].map((m) => m.index ?? 0);
  const autoSkip = skipIdx.filter((i) => !sw.slice(Math.max(0, i - 100), i).includes('SKIP_WAITING'));
  check(skipIdx.length > 0 && autoSkip.length === 0, 'sw.js: skipWaiting tylko po komunikacie SKIP_WAITING (aktualizacja na żądanie)', 'sw.js: samoczynny skipWaiting albo brak obsługi SKIP_WAITING');
  check(/cleanupOutdatedCaches\(\)/.test(sw), 'sw.js: cleanupOutdatedCaches', 'sw.js: brak cleanupOutdatedCaches');
  const runtimeRef = sw.match(/define\(\["\.\/(workbox-[\w-]+)"\]/)?.[1];
  check(Boolean(runtimeRef && fileSet.has(`${runtimeRef}.js`)), `sw.js: runtime ${runtimeRef}.js obecny`, 'sw.js: brak pliku runtime Workbox');

  // Lista precache dla postępu przygotowania (src/pwa).
  if (fileSet.has(PRECACHE_INFO)) {
    try {
      const info = JSON.parse(read(PRECACHE_INFO));
      const infoKeys = new Set((info.entries ?? []).map((e) => `${e.url}|${e.revision ?? ''}`));
      const swKeys = [...swPrecache].map(([u, r]) => `${u}|${r ?? ''}`);
      const diff = swKeys.filter((k) => !infoKeys.has(k)).concat([...infoKeys].filter((k) => !swKeys.includes(k)));
      check(info.format === 'dme-precache-info' && diff.length === 0, `${PRECACHE_INFO}: zgodny z precache (url + rewizja, ${infoKeys.size} wpisów)`, `${PRECACHE_INFO}: niezgodny z sw.js (${diff.join(', ')})`);
      check(!precacheSet.has(PRECACHE_INFO), `${PRECACHE_INFO} poza precache`, `${PRECACHE_INFO} w precache`);
    } catch (e) {
      fail(`${PRECACHE_INFO}: niepoprawny JSON (${e.message})`);
    }
  } else {
    warn(`brak ${PRECACHE_INFO} — postęp przygotowania offline będzie nieokreślony`);
  }
}

// Rejestracja SW w kodzie aplikacji (virtual:pwa-register wstawia adres `${base}sw.js` i scope `${base}`;
// minifikator może zamienić cudzysłowy na `…`).
const jsFiles = textFiles.filter((f) => f.rel.endsWith('.js') && f.rel !== 'sw.js' && !/^workbox-[\w-]+\.js$/.test(f.rel));
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const quoted = (t) => new RegExp(`["'\`]${escapeRe(t)}["'\`]`);
const swLiteral = `${base}sw.js`;
const registers = jsFiles.filter((f) => quoted(swLiteral).test(read(f.rel)));
if (registers.length > 0) {
  pass(`rejestracja SW w ${registers.map((f) => f.rel).join(', ')} z adresem ${swLiteral}`);
  const scopeRe = new RegExp(`scope:\\s*["'\`]${escapeRe(base)}["'\`]`);
  check(registers.some((f) => scopeRe.test(read(f.rel))), `rejestracja SW: scope ${base}`, `rejestracja SW: nie znaleziono scope ${base}`);
} else if (allowMissingRegistration) {
  warn(`brak rejestracji SW w JS (${swLiteral}) — dopuszczone flagą --allow-missing-registration (integracja src/pwa w main.tsx w toku)`);
} else {
  fail(`brak rejestracji SW w JS (${swLiteral}) — aplikacja nie będzie działać offline`);
}
if (base !== '/') {
  const rootSw = jsFiles.filter((f) => quoted('/sw.js').test(read(f.rel)));
  check(rootSw.length === 0, 'brak rejestracji /sw.js poza base', `rejestracja /sw.js poza base w: ${rootSw.map((f) => f.rel).join(', ')}`);
}

/* ---------------- treść: hosty zewnętrzne, zakazane ciągi, sekrety ---------------- */

/**
 * Ciągi, które nie są żądaniami sieciowymi: przestrzenie nazw XML (React DOM), link w treści błędu
 * produkcyjnego React, link w treści ostrzeżenia konsoli Workboxa (precache bez rewizji).
 */
const NON_REQUEST_URLS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
  'https://react.dev/errors/',
  'https://bit.ly/wb-precache',
];
const externalFindings = [];
const allowedFindings = new Map();
for (const f of textFiles) {
  if (f.rel === BANK) continue;
  const text = read(f.rel);
  for (const m of text.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)) {
    const url = m[0];
    const allowed = NON_REQUEST_URLS.find((p) => url === p || url.startsWith(p));
    if (allowed) allowedFindings.set(allowed, (allowedFindings.get(allowed) ?? 0) + 1);
    else externalFindings.push(`${f.rel}: ${url}`);
  }
}
check(externalFindings.length === 0, 'brak http(s):// do hostów zewnętrznych w kodzie i zasobach', `adresy zewnętrzne: ${externalFindings.slice(0, 20).join('; ')}`);
if (allowedFindings.size > 0) {
  pass(`dopuszczone identyfikatory (nie są żądaniami): ${[...allowedFindings].map(([u, n]) => `${u} ×${n}`).join(', ')}`);
}
if (fileSet.has(BANK)) {
  const bankText = read(BANK);
  const urls = [...bankText.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map((m) => m[0]);
  const insecure = urls.filter((u) => u.startsWith('http://'));
  pass(`${BANK}: ${urls.length} adresów źródeł (tekst danych, otwierane tylko przez użytkowniczkę)`);
  if (insecure.length > 0) warn(`${BANK}: ${insecure.length} adresów http:// (nie https)`);
  if (/(?:javascript|vbscript):/i.test(bankText)) fail(`${BANK}: zawiera schemat javascript:/vbscript:`);
  const size = statSync(join(distDir, BANK)).size;
  const pct = ((100 * size) / PRECACHE_MAX_FILE_BYTES).toFixed(1);
  if (size > 0.75 * PRECACHE_MAX_FILE_BYTES) warn(`${BANK}: ${size} B = ${pct}% limitu precache — rozważ podniesienie limitu`);
  else pass(`${BANK}: ${size} B (${pct}% limitu precache ${PRECACHE_MAX_FILE_BYTES} B)`);
}

function scan(name, pattern, which) {
  const hits = [];
  for (const f of which) {
    const text = read(f.rel);
    const m = text.match(pattern);
    if (m) hits.push(`${f.rel}: „${m[0].slice(0, 40)}”`);
  }
  check(hits.length === 0, `brak: ${name}`, `znaleziono ${name}: ${hits.join('; ')}`);
}
const codeFiles = textFiles.filter((f) => /\.(js|html|css|webmanifest)$/.test(f.rel));
scan('support.js', /support\.js/i, textFiles);
scan('fonts.googleapis / fonts.gstatic (CDN fontów)', /fonts\.(googleapis|gstatic)\.com/i, textFiles);
scan('klucz w stylu sk-…', /\bsk-[A-Za-z0-9_-]{12,}/, textFiles);
scan('api_key / apikey', /api[_-]?key/i, textFiles);
scan('nagłówek Bearer', /\bBearer\b/, textFiles);
scan('klucz prywatny / tokeny (AKIA, ghp_, PRIVATE KEY)', /AKIA[0-9A-Z]{16}|\bgh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/, textFiles);
scan('anthropic / openai / claude.ai w kodzie', /anthropic|openai|claude\.ai/i, codeFiles);
scan('mock kontrolera w buildzie (__dmeMock, createMockController)', /__dmeMock|createMockController/, codeFiles);
scan('mapy źródeł (sourceMappingURL)', /sourceMappingURL=/, codeFiles);

// Figury i inne SVG: bez skryptów, zdarzeń, foreignObject i zasobów zewnętrznych (G04).
const svgs = textFiles.filter((f) => f.rel.endsWith('.svg'));
const badSvg = svgs.filter((f) => /<script|foreignObject|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/|javascript:|data:text)/i.test(read(f.rel)));
check(badSvg.length === 0, `SVG (${svgs.length}): bez skryptów, zdarzeń i zasobów zewnętrznych`, `SVG z niedozwoloną treścią: ${badSvg.map((f) => f.rel).join(', ')}`);

/* ---------------- podsumowanie ---------------- */

const totalBytes = files.reduce((s, f) => s + statSync(f.abs).size, 0);
for (const r of results) console.log(`${r.level.padEnd(4)} ${r.msg}`);
const failures = results.filter((r) => r.level === 'FAIL').length;
const warnings = results.filter((r) => r.level === 'WARN').length;
console.log(`\nRazem: ${results.length} kontroli, FAIL ${failures}, WARN ${warnings}; rozmiar dist ${totalBytes} B.`);
process.exit(failures > 0 ? 1 : 0);
