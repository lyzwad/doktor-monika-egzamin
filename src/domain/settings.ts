/**
 * Zmiana ustawień (jeden rekord `settings`).
 */
import type { DomainCommandResult } from './api';
import { Tx } from './tx';
import type { CommandContext, Settings, UserState } from './types';
import { copyConfig, fail, isValidConfigShape, ok } from './util';

type SettingsPatch = Partial<Omit<Settings, 'id' | 'updatedAt'>>;

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

/** Zmiana ustawień (np. zamknięcie wskazówki instalacji, `persistRequestedAt`, ostatnie konfiguracje). */
export function updateSettings(state: UserState, patch: SettingsPatch, ctx: CommandContext): DomainCommandResult<Settings> {
  const next: Settings = { ...state.settings };
  if (patch.lastTestConfig !== undefined) {
    const c = patch.lastTestConfig;
    if (c !== null && (!isValidConfigShape(c) || typeof c.targetN !== 'number')) return fail('INVALID_CONFIG', 'Nieprawidłowa konfiguracja testu.');
    next.lastTestConfig = c === null ? null : copyConfig(c, c.targetN);
  }
  if (patch.lastFreeFlowConfig !== undefined) {
    const c = patch.lastFreeFlowConfig;
    if (c !== null && !isValidConfigShape(c)) return fail('INVALID_CONFIG', 'Nieprawidłowa konfiguracja Free Flow.');
    next.lastFreeFlowConfig = c === null ? null : copyConfig(c, null);
  }
  if (patch.installHintDismissedAt !== undefined) {
    if (!isIsoOrNull(patch.installHintDismissedAt)) return fail('INVALID_CONFIG', 'Nieprawidłowa data.');
    next.installHintDismissedAt = patch.installHintDismissedAt;
  }
  if (patch.persistRequestedAt !== undefined) {
    if (!isIsoOrNull(patch.persistRequestedAt)) return fail('INVALID_CONFIG', 'Nieprawidłowa data.');
    next.persistRequestedAt = patch.persistRequestedAt;
  }
  next.updatedAt = ctx.now;
  const tx = new Tx(state, ctx);
  tx.putSettings(next);
  return ok(tx.commit(next));
}
