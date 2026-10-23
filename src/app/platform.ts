/**
 * Usługi platformy dla kontrolera (DECYZJE §3): zegar, identyfikatory, seed, zapis pliku,
 * stan sieci i `location.hash`. Jedyne miejsce w aplikacji, które czyta zegar i losowość.
 *
 * `nextDayStartInZone` — początek następnego dnia kalendarzowego w strefie (domyślnie Europe/Warsaw)
 * z obsługą zmiany czasu (CET/CEST), bez bibliotek: przesunięcie strefy liczone przez `Intl`.
 */
import type { IsoDateTime } from '../domain/types';
import { REVIEW_TIME_ZONE } from '../domain/policies';
import type { ExportedFile } from '../persistence/api';
import type { Platform } from './controller';

/* ========================================================================== */
/* Strefa czasowa                                                             */
/* ========================================================================== */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    // Niektóre silniki zwracają „24” dla północy mimo h23.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Przesunięcie strefy względem UTC w ms w danej chwili (np. +7 200 000 dla CEST). */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * Początek następnego dnia kalendarzowego w strefie `timeZone` względem `nowIso`, jako ISO UTC.
 * Np. 22.10.2026 20:00 UTC (22:00 CEST) → `2026-10-22T22:00:00.000Z` (23.10 00:00 CEST);
 * 24.10.2026 23:30 UTC (25.10 01:30 CEST, przed zmianą czasu) → `2026-10-25T23:00:00.000Z` (26.10 00:00 CET).
 */
export function nextDayStartInZone(nowIso: IsoDateTime, timeZone: string = REVIEW_TIME_ZONE): IsoDateTime {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) throw new RangeError(`Niepoprawna data: ${nowIso}`);
  const local = zonedParts(nowMs, timeZone);
  // Północ następnego dnia „jak w UTC”, potem korekta o przesunięcie strefy w tej chwili (dwie iteracje
  // wystarczają: zmiana czasu w Polsce nie wypada o północy).
  const target = Date.UTC(local.year, local.month - 1, local.day + 1, 0, 0, 0);
  let guess = target - zoneOffsetMs(target, timeZone);
  guess = target - zoneOffsetMs(guess, timeZone);
  return new Date(guess).toISOString();
}

/* ========================================================================== */
/* Platforma przeglądarki                                                     */
/* ========================================================================== */

function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Kontekst niebezpieczny (http poza localhost) — identyfikator z getRandomValues (RFC 4122 v4).
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Zapis pliku przez pobranie (`<a download>` z adresem `blob:`). W Safari na iPhonie pojawia się
 * arkusz pobierania; plik trafia do „Pliki → Pobrane”. Działanie na fizycznym urządzeniu: G05.
 */
async function downloadFile(file: ExportedFile, doc: Document): Promise<void> {
  const blob = new Blob([file.text], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = doc.createElement('a');
    a.href = url;
    a.download = file.fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Zwolnienie adresu po chwili — Safari potrzebuje go jeszcze po `click()`.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function createBrowserPlatform(win: Window = window): Platform {
  return {
    nowIso: () => new Date().toISOString(),
    nextDayStartIso: (nowIso) => nextDayStartInZone(nowIso, REVIEW_TIME_ZONE),
    randomId: randomUuid,
    randomSeed: () => {
      const buf = new Uint32Array(1);
      win.crypto.getRandomValues(buf);
      return buf[0] ?? 0;
    },
    saveFile: (file) => downloadFile(file, win.document),
    isOnline: () => win.navigator.onLine !== false,
    onOnlineChange(listener) {
      const on = (): void => listener(true);
      const off = (): void => listener(false);
      win.addEventListener('online', on);
      win.addEventListener('offline', off);
      return () => {
        win.removeEventListener('online', on);
        win.removeEventListener('offline', off);
      };
    },
    getHash: () => win.location.hash,
    setHash(hash, mode) {
      if (win.location.hash === hash) return;
      if (mode === 'push') win.history.pushState(null, '', hash);
      else win.history.replaceState(null, '', hash);
    },
    onHashChange(listener) {
      const handler = (): void => listener(win.location.hash);
      win.addEventListener('hashchange', handler);
      return () => win.removeEventListener('hashchange', handler);
    },
  };
}
