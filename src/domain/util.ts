/**
 * Drobne czyste narzędzia silnika (bez zegara i losowości).
 */
import { domainError } from './state';
import {
  DIFFICULTIES,
  DIFFICULTY_CHOICES,
  DOMAIN_IDS,
  type CommandResult,
  type Difficulty,
  type DifficultyChoice,
  type DomainErrorCode,
  type DomainId,
  type IsoDateTime,
  type Scope,
  type SessionConfig,
} from './types';

export function ok<T>(value: T): CommandResult<T> {
  return { ok: true, value };
}

export function fail<T>(
  code: DomainErrorCode,
  messagePl: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): CommandResult<T> {
  return { ok: false, error: domainError(code, messagePl, details) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && (DOMAIN_IDS as readonly string[]).includes(value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

export function isDifficultyChoice(value: unknown): value is DifficultyChoice {
  return typeof value === 'string' && (DIFFICULTY_CHOICES as readonly string[]).includes(value);
}

export function isScope(value: unknown): value is Scope {
  return value === 'ALL' || isDomainId(value);
}

/** Domeny objęte zakresem w kolejności kanonicznej. */
export function scopeDomains(scope: Scope): DomainId[] {
  return scope === 'ALL' ? [...DOMAIN_IDS] : [scope];
}

/** Poziomy objęte wyborem trudności w kolejności kanonicznej. */
export function choiceLevels(choice: DifficultyChoice): Difficulty[] {
  return choice === 'mixed' ? [...DIFFICULTIES] : [choice];
}

/** Przesunięcie cykliczne: `rotate([a,b,c], 1)` → `[b,c,a]`. */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  const n = items.length;
  if (n === 0) return [];
  const k = ((offset % n) + n) % n;
  return [...items.slice(k), ...items.slice(0, k)];
}

/** Milisekundy znacznika ISO (Date.parse — bez odczytu zegara). */
export function timeMs(iso: IsoDateTime): number {
  return Date.parse(iso);
}

/** `a ≥ b` dla znaczników ISO; przy nieczytelnej dacie porównanie tekstowe. */
export function isAtOrAfter(a: IsoDateTime, b: IsoDateTime): boolean {
  const ta = timeMs(a);
  const tb = timeMs(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a >= b;
  return ta >= tb;
}

/** Porównanie znaczników ISO rosnąco; `null` (nigdy) przed każdą datą. */
export function compareIsoNullFirst(a: IsoDateTime | null, b: IsoDateTime | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const ta = timeMs(a);
  const tb = timeMs(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a < b ? -1 : 1;
  return ta - tb;
}

/** Porównanie tekstów po jednostkach kodu (deterministyczne, niezależne od locale). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Walidacja kształtu zamrażanej konfiguracji. */
export function isValidConfigShape(config: unknown): config is SessionConfig {
  if (!isRecord(config)) return false;
  return (
    isScope(config.scope) &&
    isDifficultyChoice(config.difficulty) &&
    typeof config.myErrorsPriority === 'boolean' &&
    (config.targetN === null || typeof config.targetN === 'number')
  );
}

/** Kopia konfiguracji (zamrożenie przez wartość, bez współdzielenia referencji). */
export function copyConfig(config: SessionConfig, targetN: number | null): SessionConfig {
  return { scope: config.scope, difficulty: config.difficulty, targetN, myErrorsPriority: config.myErrorsPriority };
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
