/**
 * Mock kontrolera (tylko dev/testy UI): sprawdza, że realizuje kontrakt AppController na prawdziwym banku
 * i że modele widoku nie ujawniają klucza przed odpowiedzią (B04).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockController, type MockController } from '../../src/app/mockController';
import type { QuestionVM } from '../../src/app/viewModels';
import type { RuntimeBank, Session } from '../../src/domain/types';

// Środowisko jsdom: import.meta.url nie jest adresem file:, więc ścieżka względem katalogu projektu.
const bank = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/bank.json'), 'utf-8')) as RuntimeBank;

async function started(): Promise<MockController> {
  let t = Date.parse('2026-10-22T08:00:00.000Z');
  const c = createMockController({ bank, seed: 7, now: () => new Date((t += 1000)) });
  await c.start();
  return c;
}

function question(c: MockController): QuestionVM {
  const screen = c.getState().screen;
  if (screen?.name !== 'question') throw new Error(`oczekiwano ekranu pytania, jest ${screen?.name}`);
  return screen;
}

function openSession(c: MockController): Session {
  const s = Object.values(c.getState().userState?.sessions ?? {}).find((x) => x.status === 'open');
  if (!s) throw new Error('brak otwartej sesji');
  return s;
}

function correctOption(c: MockController): string {
  const q = question(c);
  const slot = openSession(c).slots[q.slotId];
  if (!slot) throw new Error('brak slotu');
  return slot.snapshot.correctOptionId;
}

describe('mock kontrolera', () => {
  it('startuje bez danych demonstracyjnych', async () => {
    const c = await started();
    const s = c.getState();
    expect(s.boot).toEqual({ phase: 'ready' });
    expect(s.screen).toMatchObject({ name: 'home', resume: null });
    expect(Object.keys(s.userState?.sessions ?? {})).toHaveLength(0);
  });

  it('konfiguracja testu: domyślnie 20, pojemność = liczba rodzin z banku', async () => {
    const c = await started();
    c.openConfig('test');
    const screen = c.getState().screen;
    if (screen?.name !== 'config') throw new Error('brak konfiguracji');
    expect(screen.draft).toEqual({ scope: 'ALL', difficulty: 'mixed', nText: '20', myErrorsPriority: false });
    expect(screen.capacity).toBe(new Set(bank.questions.map((q) => q.family_id)).size);
    expect(screen.nValidation).toEqual({ ok: true, n: 20 });
    c.updateConfigDraft({ nText: '2,5' });
    const after = c.getState().screen;
    expect(after?.name === 'config' && after.nValidation).toMatchObject({ ok: false, code: 'NOT_INTEGER' });
  });

  it('przed odpowiedzią VM nie zawiera klucza ani wyjaśnienia; po odpowiedzi — tak', async () => {
    const c = await started();
    c.openConfig('test');
    await c.startTest();
    const before = question(c);
    expect(before.mode).toBe('live');
    expect(before.progress).toEqual({ kind: 'test', answeredValid: 0, targetN: 20 });
    expect(before.explanation).toBeNull();
    expect(before.answers.map((a) => a.state)).toEqual(['neutral', 'neutral', 'neutral', 'neutral']);
    expect(JSON.stringify(before)).not.toContain('correctOptionId');
    expect(before.primaryAction).toBe('hint');

    const wrong = before.answers.find((a) => a.optionId !== correctOption(c));
    await c.answer(wrong?.optionId ?? '');
    const after = question(c);
    expect(after.answered).toBe(true);
    expect(after.correct).toBe(false);
    expect(after.answers.filter((a) => a.state === 'selected-wrong')).toHaveLength(1);
    expect(after.answers.filter((a) => a.state === 'correct-unselected')).toHaveLength(1);
    expect(after.explanation?.text.length).toBeGreaterThan(0);
    expect(after.progress).toEqual({ kind: 'test', answeredValid: 1, targetN: 20 });
    expect(after.primaryAction).toBe('next');

    // Drugie dotknięcie nie zmienia wyniku.
    await c.answer(correctOption(c));
    expect(question(c).correct).toBe(false);
  });

  it('pełny test 20/20 → wynik zaliczony 100%, punkt na wykresie', async () => {
    const c = await started();
    c.openConfig('test');
    await c.startTest();
    for (let i = 0; i < 20; i++) {
      await c.answer(correctOption(c));
      if (i < 19) await c.next();
    }
    expect(question(c).primaryAction).toBe('show-result');
    await c.showResult();
    const result = c.getState().screen;
    expect(result).toMatchObject({ name: 'result', status: 'passed', correct: 20, targetN: 20, percentText: '100%', thresholdCorrect: 13 });
    c.openHistory();
    const history = c.getState().screen;
    expect(history?.name === 'history' && history.chart).toHaveLength(1);
  });

  it('zgłoszenie podmienia pytanie (N bez zmian), „Cofnij” przywraca stan', async () => {
    const c = await started();
    c.openConfig('test');
    await c.startTest();
    const original = question(c).slotId;
    await c.report();
    const replaced = question(c);
    expect(replaced.slotId).not.toBe(original);
    expect(replaced.progress).toEqual({ kind: 'test', answeredValid: 0, targetN: 20 });
    expect(c.getState().toast).toMatchObject({ kind: 'reported_replaced', canUndo: true });
    await c.undoReport();
    expect(question(c).slotId).toBe(original);
    expect(c.getState().toast?.kind).toBe('report_undone');
  });

  it('błąd zapisu: stan „niezapisane” i ponowienie tej samej komendy', async () => {
    const c = await started();
    c.openConfig('test');
    await c.startTest();
    c.simulate({ saveFailure: true });
    const option = correctOption(c);
    const r = await c.answer(option);
    expect(r.ok).toBe(false);
    const failed = c.getState().save;
    expect(failed).toMatchObject({ status: 'error', action: 'answer', failures: 1 });
    expect(question(c).answers.find((a) => a.optionId === option)?.state).toBe('pending');
    expect(question(c).answered).toBe(false);
    c.simulate({ saveFailure: false });
    await c.retrySave();
    expect(c.getState().save).toEqual({ status: 'idle' });
    expect(question(c).correct).toBe(true);
  });

  it('Free Flow: numer pytania, „Dalej” dobiera kolejne, zakończenie → podsumowanie', async () => {
    const c = await started();
    c.openConfig('freeflow');
    await c.startFreeFlow();
    expect(question(c).progress).toEqual({ kind: 'freeflow', questionNumber: 1 });
    await c.answer(correctOption(c));
    await c.next();
    expect(question(c).progress).toEqual({ kind: 'freeflow', questionNumber: 2 });
    await c.endFreeFlow();
    expect(c.getState().screen).toMatchObject({ name: 'freeflowSummary', answeredValid: 1, correct: 1, percentText: '100%' });
  });
});
