/**
 * Narzędzia walidacji danych z plików (kopia, paczka pytań): typy, daty ISO, enumy, bezpieczne
 * URL i ścieżki mediów, wykrywanie znaczników HTML/skryptów, lista przyczyn po polsku.
 * Bez efektów ubocznych i bez IndexedDB.
 */
import { pluralPl } from '../domain/scoring';

/* ========================================================================== */
/* Lista przyczyn                                                             */
/* ========================================================================== */

/** Lista przyczyn odrzucenia z limitem (resztę podsumowuje jedna pozycja). */
export class ReasonList {
  readonly max: number;
  private readonly items: string[] = [];
  private overflow = 0;

  constructor(max = 50) {
    this.max = max;
  }

  add(message: string): void {
    if (this.items.length < this.max) this.items.push(message);
    else this.overflow += 1;
  }

  get count(): number {
    return this.items.length + this.overflow;
  }

  get empty(): boolean {
    return this.count === 0;
  }

  toArray(): string[] {
    if (this.overflow === 0) return [...this.items];
    return [...this.items, `…oraz ${this.overflow} ${pluralPl(this.overflow, 'kolejna niezgodność', 'kolejne niezgodności', 'kolejnych niezgodności')}.`];
  }
}

/* ========================================================================== */
/* Typy podstawowe                                                            */
/* ========================================================================== */

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isInt(value: unknown, min = Number.MIN_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Klucze, które jako nazwy pól zmieniłyby prototyp obiektu (`out[id] = …`). */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Identyfikator rekordu: niepusty tekst, nie będący zarezerwowaną nazwą właściwości. */
export function isSafeId(value: unknown): value is string {
  return isNonEmptyString(value) && !RESERVED_KEYS.has(value);
}

export function isIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isSafeId(item));
}

/** Skrócona prezentacja wartości w komunikacie. */
export function show(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

/* ========================================================================== */
/* Daty                                                                       */
/* ========================================================================== */

const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

/** Data i czas ISO 8601 ze strefą (`Z` albo `±hh:mm`), z kontrolą kalendarza. */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATETIME_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi, s, oh, om] = m;
  if (!validCalendarDate(Number(y), Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59 || (s !== undefined && Number(s) > 59)) return false;
  if (oh !== undefined && (Number(oh) > 23 || Number(om) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Data kalendarzowa `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value);
  return m !== null && validCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Porównanie dat ISO po czasie (nie po tekście — strefy mogą się różnić). */
export function isoTime(value: string): number {
  return Date.parse(value);
}

/* ========================================================================== */
/* Bezpieczeństwo treści, URL i ścieżek                                       */
/* ========================================================================== */

const UNSAFE_TEXT_PATTERNS: readonly RegExp[] = [
  // Znaczniki HTML/XML (np. <b>, </p>, <img src=x onerror=…>, <svg/onload=…>).
  /<\/?[a-z][a-z0-9:-]*(?:[\s/][^<>]*)?>/i,
  // Komentarze, deklaracje, CDATA.
  /<!(?:--|\[cdata\[|doctype)/i,
  // Otwarcie skryptu bez domknięcia znacznika.
  /<\s*script\b/i,
  // Schematy URL wykonujące kod.
  /\bjavascript\s*:/i,
  /\bvbscript\s*:/i,
  /\bdata\s*:\s*text\/html/i,
];

/** Czy tekst zawiera znacznik HTML, skrypt albo schemat URL wykonujący kod. */
export function containsUnsafeMarkup(text: string): boolean {
  return UNSAFE_TEXT_PATTERNS.some((re) => re.test(text));
}

/**
 * Przechodzi całą strukturę JSON (iteracyjnie, bez rekursji) i zwraca ścieżki tekstów
 * z niebezpieczną treścią (np. `questions[3].stem_pl`).
 */
export function findUnsafeStrings(root: unknown, rootPath = ''): string[] {
  const hits: string[] = [];
  const stack: [unknown, string][] = [[root, rootPath]];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const [value, path] = entry;
    if (typeof value === 'string') {
      if (containsUnsafeMarkup(value)) hits.push(path);
    } else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push([value[i], `${path}[${i}]`]);
    } else if (isObject(value)) {
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const key = keys[i] as string;
        stack.push([value[key], path ? `${path}.${key}` : key]);
      }
    }
  }
  return hits;
}

/**
 * URL źródła dopuszczony do pokazania jako link: wyłącznie `https:`, poprawny składniowo,
 * bez białych znaków, cudzysłowów i nawiasów kątowych, bez danych logowania w adresie.
 */
export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https:\/\/[^\s<>"'`\\]+$/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * Ścieżka mediów względna do paczki/aplikacji: bez schematu URL, bez ścieżki absolutnej,
 * bez `..`, bez ukośnika wstecznego, zapytań i fragmentów (np. `figures/PLAN-FIG-01-pytanie.svg`).
 */
export function isSafeRelativeMediaPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('.')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

/** Porównanie tekstów po punktach kodowych (stabilne sortowanie kluczy). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ========================================================================== */
/* Odczyt plików                                                              */
/* ========================================================================== */

/** Rozmiar tekstu w bajtach UTF-8 (bez alokacji bufora). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Czyta plik (Blob/File albo tekst) z limitem rozmiaru i parsuje JSON (bez wykonywania kodu).
 * Wspólne dla puli i kopii.
 */
export async function readJsonInput(
  input: Blob | string,
  maxBytes: number,
): Promise<{ ok: true; json: unknown; sizeBytes: number } | { ok: false; reason: 'too_large' | 'unreadable' | 'invalid_json'; sizeBytes: number; detail?: string }> {
  let text: string;
  let sizeBytes: number;
  if (typeof input === 'string') {
    sizeBytes = utf8ByteLength(input);
    if (sizeBytes > maxBytes) return { ok: false, reason: 'too_large', sizeBytes };
    text = input;
  } else {
    sizeBytes = input.size;
    if (sizeBytes > maxBytes) return { ok: false, reason: 'too_large', sizeBytes };
    try {
      text = await input.text();
    } catch (error) {
      return { ok: false, reason: 'unreadable', sizeBytes, detail: error instanceof Error ? error.message : undefined };
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return { ok: true, json: JSON.parse(text) as unknown, sizeBytes };
  } catch (error) {
    return { ok: false, reason: 'invalid_json', sizeBytes, detail: error instanceof Error ? error.message : undefined };
  }
}
