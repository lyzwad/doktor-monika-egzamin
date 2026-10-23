/**
 * Próg zaliczenia i prezentacja procentu (DECYZJE §4; 03_ARCHITEKTURA §3; kryterium C04).
 *
 * Decyzja o zaliczeniu jest CAŁKOWITOLICZBOWA: `100 × correct ≥ 65 × N`.
 * Procent ekranowy (obcięty do 0,1, przecinek dziesiętny) jest pochodną i nie bierze udziału w decyzji.
 */
import { PASS_PERCENT } from './policies';

function assertCount(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} musi być liczbą całkowitą ≥ ${min} (otrzymano ${value})`);
  }
}

/**
 * Minimalna liczba poprawnych odpowiedzi do zaliczenia testu N pytań:
 * `ceil(65 × N / 100)` = `floor((65 × N + 99) / 100)`.
 * Przykłady: 20→13, 30→20, 40→26, 50→33, 60→39, 3→2, 1→1.
 */
export function passThreshold(targetN: number): number {
  assertCount('targetN', targetN, 1);
  return Math.floor((PASS_PERCENT * targetN + 99) / 100);
}

/**
 * Czy wynik zalicza test treningowy: `100 × correct ≥ 65 × targetN`.
 * Nie porównuje zaokrąglonego procentu.
 */
export function isPassed(correct: number, targetN: number): boolean {
  assertCount('targetN', targetN, 1);
  assertCount('correct', correct, 0);
  if (correct > targetN) throw new RangeError(`correct (${correct}) nie może przekraczać targetN (${targetN})`);
  return 100 * correct >= PASS_PERCENT * targetN;
}

/**
 * Procent w dziesiątych częściach, obcięty w dół: `floor(1000 × correct / total)`.
 * Zwraca `null`, gdy `total = 0` (brak ocenionych pytań — bez dzielenia przez zero).
 */
export function percentTenths(correct: number, total: number): number | null {
  assertCount('total', total, 0);
  assertCount('correct', correct, 0);
  if (correct > total) throw new RangeError(`correct (${correct}) nie może przekraczać total (${total})`);
  if (total === 0) return null;
  return Math.floor((1000 * correct) / total);
}

/** Procent obcięty do 0,1 jako liczba (np. 64.9) albo `null` przy 0 ocenionych. */
export function truncatedPercent(correct: number, total: number): number | null {
  const tenths = percentTenths(correct, total);
  return tenths === null ? null : tenths / 10;
}

/**
 * Procent do wyświetlenia po polsku: obcięty do 0,1, przecinek dziesiętny, bez zbędnego „,0”.
 * Przykłady: 13/20 → „65%”, 1299/2000 → „64,9%”, 2/3 → „66,6%”, 0/0 → `null`.
 */
export function formatPercentPl(correct: number, total: number): string | null {
  const tenths = percentTenths(correct, total);
  if (tenths === null) return null;
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  return fraction === 0 ? `${whole}%` : `${whole},${fraction}%`;
}

/**
 * Polska forma liczebnika: 1 → `one`, 2–4 (poza 12–14) → `few`, pozostałe → `many`.
 * Np. `pluralPl(5, 'pytanie', 'pytania', 'pytań')` → „pytań”.
 */
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
