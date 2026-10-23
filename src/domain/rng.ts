/**
 * Deterministyczna losowość domeny (DECYZJE §3): PRNG mulberry32 z 32-bitowym seedem.
 * Domena nigdy nie używa `Math.random()` — seed sesji pochodzi z kontrolera
 * (`crypto.getRandomValues`) i jest zapisany w sesji, więc dobór da się odtworzyć.
 */

/** Generator liczb z przedziału [0, 1). */
export type Rng = () => number;

/** Sprowadza dowolną liczbę do 32-bitowej liczby całkowitej bez znaku. */
export function toUint32(value: number): number {
  return value >>> 0;
}

/**
 * PRNG mulberry32. Ten sam seed → ta sama sekwencja (na każdej platformie).
 * @param seed dowolna liczba; używane są jej młodsze 32 bity
 */
export function mulberry32(seed: number): Rng {
  let a = toUint32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Losowa liczba całkowita z przedziału [0, maxExclusive). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`randomInt: maxExclusive musi być dodatnią liczbą całkowitą (otrzymano ${maxExclusive})`);
  }
  return Math.floor(rng() * maxExclusive);
}

/**
 * Tasowanie Fishera–Yatesa. Zwraca NOWĄ tablicę; wejście pozostaje niezmienione.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** 32-bitowy hash FNV-1a tekstu (po jednostkach UTF-16). Deterministyczny, nie kryptograficzny. */
export function hashString32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pochodny seed dla podzadania (np. zastępstwo, kolejny slot Free Flow, kolejność opcji),
 * aby różne decyzje w tej samej sesji nie współdzieliły jednej sekwencji.
 * @param seed seed sesji
 * @param salt etykieta podzadania, np. `replacement:3` albo `options:<slotId>`
 */
export function deriveSeed(seed: number, salt: string | number): number {
  const s = hashString32(`${toUint32(seed)}:${salt}`);
  // Jedno przejście mulberry32 rozprasza bity hasha.
  return toUint32(Math.floor(mulberry32(s)() * 4294967296));
}

/** Wygodny skrót: generator dla seeda sesji i soli podzadania. */
export function rngFor(seed: number, salt: string | number): Rng {
  return mulberry32(deriveSeed(seed, salt));
}
