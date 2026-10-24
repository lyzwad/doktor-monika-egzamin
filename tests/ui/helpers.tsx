/**
 * Pomocnicze dla testów UI: mock kontrolera na prawdziwym banku (bez danych demonstracyjnych)
 * i render aplikacji w kontekście kontrolera.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { act, render } from '@testing-library/react';
import { createMockController, type MockController, type MockControllerOptions } from '../../src/app/mockController';
import type { QuestionVM } from '../../src/app/viewModels';
import type { RuntimeBank, Session } from '../../src/domain/types';
import { AppRoot } from '../../src/ui/App';

// Środowisko jsdom: import.meta.url nie jest adresem file:, więc ścieżka względem katalogu projektu.
export const bank = JSON.parse(readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.bankFile), 'utf-8')) as RuntimeBank;

export async function startedMock(options: Partial<MockControllerOptions> = {}): Promise<MockController> {
  let t = Date.parse('2026-10-22T08:00:00.000Z');
  const c = createMockController({ bank, seed: 7, now: () => new Date((t += 1000)), ...options });
  await c.start();
  return c;
}

export async function renderApp(controller: MockController) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<AppRoot controller={controller} />);
  });
  return result as ReturnType<typeof render>;
}

export function questionVM(c: MockController): QuestionVM {
  const screen = c.getState().screen;
  if (screen?.name !== 'question') throw new Error(`oczekiwano ekranu pytania, jest ${screen?.name}`);
  return screen;
}

export function openSession(c: MockController): Session {
  const s = Object.values(c.getState().userState?.sessions ?? {}).find((x) => x.status === 'open');
  if (!s) throw new Error('brak otwartej sesji');
  return s;
}

/** Klucz bieżącego pytania — tylko do sterowania testem (z danych sesji, nie z UI). */
export function correctOptionId(c: MockController): string {
  const q = questionVM(c);
  const slot = openSession(c).slots[q.slotId];
  if (!slot) throw new Error('brak slotu');
  return slot.snapshot.correctOptionId;
}

export function currentSnapshot(c: MockController) {
  const q = questionVM(c);
  const slot = openSession(c).slots[q.slotId];
  if (!slot) throw new Error('brak slotu');
  return slot.snapshot;
}

/** Wszystkie teksty i atrybuty w DOM (wyszukiwanie śladów klucza, także w alt/title/aria). */
export function domDump(root: ParentNode): string {
  const parts: string[] = [];
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) parts.push(`${attr.name}=${attr.value}`);
  });
  parts.push((root as Element).textContent ?? '');
  return parts.join('\n');
}
