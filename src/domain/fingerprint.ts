/**
 * Normalizacja tekstu i fingerprint treści pytania (DECYZJE §2).
 *
 * Musi dawać wynik identyczny z `redakcja/narzedzia/zbuduj_runtime.py`:
 *   normal(t) = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', t).strip()).casefold()
 *   fingerprint = sha256(normal(stem) + '\n' + '\n'.join(sorted(normal(o) for o in options)))
 * Test zgodności: tests/domain/fingerprint.test.ts (wszystkie pytania z public/data/bank.json).
 *
 * SHA-256 liczy Web Crypto (`globalThis.crypto.subtle`) — dostępne w przeglądarce
 * w bezpiecznym kontekście (https/localhost) i w Node ≥ 20. Domena kompiluje się bez lib DOM,
 * stąd lokalne minimalne typy poniżej.
 */
import type { Fingerprint } from './types';

interface SubtleCryptoLike {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
interface CryptoLike {
  readonly subtle?: SubtleCryptoLike;
}
interface TextEncoderLike {
  encode(input: string): Uint8Array;
}
interface WebCryptoGlobals {
  readonly crypto?: CryptoLike;
  readonly TextEncoder?: new () => TextEncoderLike;
}

/**
 * Białe znaki zgodne z Pythonem (`str.isspace()` / `\s` dla str): ASCII \t\n\v\f\r i \x1c–\x1f,
 * spacja, \x85, NBSP, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
 * (JS-owe `\s` różni się: nie obejmuje \x1c–\x1f i \x85, za to obejmuje U+FEFF.)
 */
const PY_WHITESPACE = '\\t\\n\\x0B\\f\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const WS_RUN = new RegExp(`[${PY_WHITESPACE}]+`, 'g');
const WS_EDGES = new RegExp(`^[${PY_WHITESPACE}]+|[${PY_WHITESPACE}]+$`, 'g');

/**
 * Przybliżenie Pythonowego `str.casefold()` (pełne składanie wielkości liter) dla tekstu po NFKC:
 * `toLowerCase()` + mapowania, w których casefold różni się od lower-case
 * (ß/ẞ → ss, końcowa sigma ς → σ). Pozostałe różnice dotyczą znaków rozkładanych już przez NFKC
 * (ligatury, ſ, µ) albo rzadkich znaków greckich z diakrytykami.
 */
export function caseFold(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

/**
 * Normalizacja do porównań treści: NFKC → przycięcie → zwinięcie białych znaków do spacji → casefold.
 */
export function normalizeText(text: string): string {
  return caseFold(text.normalize('NFKC').replace(WS_EDGES, '').replace(WS_RUN, ' '));
}

/** Porównanie po punktach kodowych (jak `sorted()` w Pythonie), nie po jednostkach UTF-16. */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done || nb.done) {
      if (na.done && nb.done) return 0;
      return na.done ? -1 : 1;
    }
    const ca = (na.value as string).codePointAt(0) ?? 0;
    const cb = (nb.value as string).codePointAt(0) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/**
 * Kanoniczny tekst do fingerprintu: znormalizowany stem + `\n` + znormalizowane opcje
 * posortowane (niezależnie od kolejności i identyfikatorów opcji).
 */
export function fingerprintPayload(stem: string, optionTexts: readonly string[]): string {
  const options = optionTexts.map(normalizeText).sort(compareCodePoints);
  return `${normalizeText(stem)}\n${options.join('\n')}`;
}

function webCrypto(): { subtle: SubtleCryptoLike; encoder: TextEncoderLike } {
  const g = globalThis as unknown as WebCryptoGlobals;
  const subtle = g.crypto?.subtle;
  const Encoder = g.TextEncoder;
  if (!subtle || !Encoder) {
    throw new Error(
      'Web Crypto (crypto.subtle) jest niedostępne. Aplikacja wymaga bezpiecznego kontekstu (https albo localhost).',
    );
  }
  return { subtle, encoder: new Encoder() };
}

/** SHA-256 tekstu (UTF-8) jako hex małymi literami. */
export async function sha256Hex(text: string): Promise<string> {
  const { subtle, encoder } = webCrypto();
  const digest = await subtle.digest('SHA-256', encoder.encode(text));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Fingerprint treści pytania (stem + teksty opcji). */
export async function fingerprintQuestion(question: {
  readonly stem: string;
  readonly optionTexts: readonly string[];
}): Promise<Fingerprint> {
  return sha256Hex(fingerprintPayload(question.stem, question.optionTexts));
}

/** Fingerprint pytania w formacie runtime/banku (`stem_pl`, `options[].text_pl`). */
export async function fingerprintRuntimeQuestion(question: {
  readonly stem_pl: string;
  readonly options: readonly { readonly text_pl: string }[];
}): Promise<Fingerprint> {
  return fingerprintQuestion({ stem: question.stem_pl, optionTexts: question.options.map((o) => o.text_pl) });
}
