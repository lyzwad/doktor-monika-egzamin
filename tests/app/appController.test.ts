/**
 * Testy integracyjne rzeczywistego kontrolera (src/app/appController.ts): domena + IndexedDB
 * (fake-indexeddb) + prawdziwy bank. Sprawdzają przepływ komendy z DECYZJE §1 (zapis przed publikacją,
 * błąd zapisu z ponowieniem tej samej komendy, konflikt), wznowienie po „ponownym uruchomieniu”
 * (nowy kontroler na tej samej bazie), „Cofnij”, kopię, import puli, trasy i PWA.
 */
import { describe, expect, it } from 'vitest';
import { nextDayStartInZone } from '../../src/app/platform';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import {
  BANK,
  failingRepository,
  keyOf,
  openSession,
  question,
  settle,
  startHarness,
  userState,
  wrongOf,
  type Harness,
} from './harness';

async function startTestN(h: Harness, n: number, extra: { myErrorsPriority?: boolean } = {}): Promise<void> {
  h.controller.openConfig('test');
  h.controller.updateConfigDraft({ nText: String(n), ...extra });
  const r = await h.controller.startTest();
  expect(r).toEqual({ ok: true });
  await settle();
}

/** Odpowiada na bieżące pytanie (poprawnie albo błędnie) i — jeśli to nie ostatnie — przechodzi dalej. */
async function answerAndNext(h: Harness, correct: boolean): Promise<void> {
  const opt = correct ? keyOf(h.controller) : wrongOf(h.controller);
  expect(await h.controller.answer(opt)).toEqual({ ok: true });
  const q = question(h.controller);
  if (q.primaryAction === 'next') expect(await h.controller.next()).toEqual({ ok: true });
  await settle();
}

describe('nextDayStartInZone (Europe/Warsaw, zmiana czasu)', () => {
  it('CEST: północ następnego dnia = 22:00 UTC', () => {
    expect(nextDayStartInZone('2026-10-22T08:00:00.000Z')).toBe('2026-10-22T22:00:00.000Z');
    expect(nextDayStartInZone('2026-10-22T21:59:59.000Z')).toBe('2026-10-22T22:00:00.000Z');
    expect(nextDayStartInZone('2026-10-22T22:00:00.000Z')).toBe('2026-10-23T22:00:00.000Z');
  });
  it('dni zmiany czasu (25.10.2026 na zimowy, 29.03.2026 na letni)', () => {
    expect(nextDayStartInZone('2026-10-24T23:30:00.000Z')).toBe('2026-10-25T23:00:00.000Z');
    expect(nextDayStartInZone('2026-10-24T10:00:00.000Z')).toBe('2026-10-24T22:00:00.000Z');
    expect(nextDayStartInZone('2026-03-28T11:00:00.000Z')).toBe('2026-03-28T23:00:00.000Z');
    expect(nextDayStartInZone('2026-03-29T10:00:00.000Z')).toBe('2026-03-29T22:00:00.000Z');
  });
});

describe('uruchomienie', () => {
  it('ładuje bank i pusty stan; start bez sesji; katalog = liczba pytań z pliku', async () => {
    const h = await startHarness();
    const s = h.controller.getState();
    expect(s.boot).toEqual({ phase: 'ready' });
    expect(s.screen?.name).toBe('home');
    expect(s.catalog?.questions.length).toBe(BANK.questions.length);
    expect(s.resume).toBeNull();
    expect(s.appVersion).toBe('test-1');
    await settle();
    expect(h.controller.getState().storage).toEqual({ persisted: false, usageBytes: 2048, quotaBytes: 1024 * 1024 * 1024 });
  });

  it('brak IndexedDB → ekran błędu z wyjaśnieniem, że nauka bez zapisu nie jest możliwa', async () => {
    const repo = createIndexedDbRepository({ dbName: 'brak', storageManager: null });
    const noIdb = Object.create(repo) as typeof repo;
    noIdb.open = async () => ({ ok: false, error: { code: 'Unavailable', messagePl: 'Ta przeglądarka nie udostępnia lokalnej bazy danych (IndexedDB).' } });
    const h = await startHarness({ repository: noIdb });
    const boot = h.controller.getState().boot;
    expect(boot).toMatchObject({ phase: 'fatal', code: 'STORAGE_UNAVAILABLE', canRetry: true });
    if (boot.phase === 'fatal') expect(boot.messagePl).toContain('nauka nie jest możliwa');
    expect(h.controller.getState().screen).toBeNull();
    expect(await h.controller.startTest()).toMatchObject({ ok: false });
  });

  it('niedostępny bank → BANK_UNAVAILABLE; „Spróbuj ponownie” uruchamia aplikację', async () => {
    let fail = true;
    const h = await startHarness({
      loadBank: async () => {
        if (fail) throw new Error('offline');
        return structuredClone(BANK);
      },
    });
    expect(h.controller.getState().boot).toMatchObject({ phase: 'fatal', code: 'BANK_UNAVAILABLE' });
    fail = false;
    await h.controller.retryBoot();
    expect(h.controller.getState().boot).toEqual({ phase: 'ready' });
  });

  it('uszkodzony bank → BANK_INVALID', async () => {
    const h = await startHarness({ loadBank: async () => ({ format: 'inny' }) as never });
    expect(h.controller.getState().boot).toMatchObject({ phase: 'fatal', code: 'BANK_INVALID' });
  });
});

describe('test: komenda → domena → zapis → publikacja', () => {
  it('pełny test 3 pytań: B04, markShown, Dalej, Pokaż wynik, historia; bez procentu przed końcem', async () => {
    const h = await startHarness();
    await startTestN(h, 3);
    const q0 = question(h.controller);
    expect(q0.mode).toBe('live');
    expect(q0.progress).toEqual({ kind: 'test', answeredValid: 0, targetN: 3 });
    // B04: przed odpowiedzią brak wyjaśnienia, źródeł, stanu poprawności.
    expect(q0.explanation).toBeNull();
    expect(q0.correct).toBeNull();
    expect(JSON.stringify(q0)).not.toContain('correctOptionId');
    expect(q0.answers.every((a) => a.state === 'neutral' && a.interactive)).toBe(true);
    // markShown zapisany w tle (slot.shownAt, seenCount).
    const s0 = openSession(h.controller);
    expect(s0.slots[q0.slotId]?.shownAt).not.toBeNull();
    expect(userState(h.controller).questionStats[s0.slots[q0.slotId]!.questionId]?.seenCount).toBe(1);

    expect(await h.controller.answer(wrongOf(h.controller))).toEqual({ ok: true });
    const q0a = question(h.controller);
    expect(q0a.answered).toBe(true);
    expect(q0a.correct).toBe(false);
    expect(q0a.explanation?.text.length).toBeGreaterThan(0);
    expect(q0a.answers.filter((a) => a.state === 'selected-wrong')).toHaveLength(1);
    expect(q0a.answers.filter((a) => a.state === 'correct-unselected')).toHaveLength(1);
    expect(q0a.primaryAction).toBe('next');
    expect(q0a.progress).toEqual({ kind: 'test', answeredValid: 1, targetN: 3 });

    expect(await h.controller.next()).toEqual({ ok: true });
    await answerAndNext(h, true);
    await answerAndNext(h, true);
    const last = question(h.controller);
    expect(last.primaryAction).toBe('show-result');
    expect(await h.controller.showResult()).toEqual({ ok: true });
    const result = h.controller.getState().screen;
    expect(result).toMatchObject({ name: 'result', status: 'passed', correct: 2, targetN: 3, percentText: '66,6%', thresholdCorrect: 2, wrongCount: 1 });
    expect(h.controller.getState().route).toMatchObject({ name: 'result', origin: 'session' });

    h.controller.openHistory('tests');
    const hist = h.controller.getState().screen;
    expect(hist?.name).toBe('history');
    if (hist?.name !== 'history') return;
    expect(hist.chart).toHaveLength(1);
    expect(hist.tests[0]).toMatchObject({ status: 'completed', correct: 2, targetN: 3, percentText: '66,6%' });
  });

  it('B03: drugie dotknięcie i ta sama komenda nie zmieniają wyboru ani licznika', async () => {
    const h = await startHarness();
    await startTestN(h, 2);
    const wrong = wrongOf(h.controller);
    const key = keyOf(h.controller);
    const [a, b] = await Promise.all([h.controller.answer(wrong), h.controller.answer(key)]);
    expect(a).toEqual({ ok: true });
    expect(b.ok).toBe(false);
    await settle();
    const q = question(h.controller);
    expect(q.correct).toBe(false);
    expect(q.progress).toEqual({ kind: 'test', answeredValid: 1, targetN: 2 });
    expect(Object.keys(userState(h.controller).attempts)).toHaveLength(1);
    expect(await h.controller.answer(key)).toMatchObject({ ok: false });
    expect(Object.keys(userState(h.controller).attempts)).toHaveLength(1);
  });

  it('podwójne „Dalej” w trakcie zapisu przesuwa tylko o jedną pozycję, bez komunikatu błędu', async () => {
    const h = await startHarness();
    await startTestN(h, 4);
    expect(await h.controller.answer(keyOf(h.controller))).toEqual({ ok: true });
    const first = h.controller.next();
    const second = await h.controller.next();
    expect(second).toMatchObject({ ok: false, code: 'BUSY' });
    expect(await first).toEqual({ ok: true });
    await settle();
    expect(question(h.controller).position).toBe(1);
    expect(openSession(h.controller).reached).toBe(1);
    expect(h.controller.getState().toast).toBeNull();
  });

  it('C01: niepoprawne N nie uruchamia testu (puste, 0, ujemne, ułamek, ponad pojemność)', async () => {
    const h = await startHarness();
    h.controller.openConfig('test');
    const cfg = () => h.controller.getState().screen;
    expect(cfg()).toMatchObject({ name: 'config', draft: { nText: '20', scope: 'ALL', difficulty: 'mixed', myErrorsPriority: false } });
    for (const bad of ['', '0', '-5', '2,5', '1.5', 'abc', String(10_000)]) {
      h.controller.updateConfigDraft({ nText: bad });
      const vm = cfg();
      expect(vm?.name === 'config' && vm.canStart).toBe(false);
      expect(await h.controller.startTest()).toMatchObject({ ok: false });
    }
    expect(Object.keys(userState(h.controller).sessions)).toHaveLength(0);
  });

  it('błąd zapisu odpowiedzi: brak fałszywego sukcesu, ponowienie TEJ SAMEJ komendy (ten sam commandId)', async () => {
    let wrapped: ReturnType<typeof failingRepository> | null = null;
    const h = await startHarness({ wrapRepository: (r) => (wrapped = failingRepository(r)) });
    const repo = wrapped as unknown as ReturnType<typeof failingRepository>;
    await startTestN(h, 2);
    repo.failNext('QuotaExceeded', 2);
    const opt = keyOf(h.controller);
    const r1 = await h.controller.answer(opt);
    expect(r1).toMatchObject({ ok: false, code: 'QuotaExceeded' });
    const s1 = h.controller.getState();
    expect(s1.save).toMatchObject({ status: 'error', action: 'answer', code: 'QuotaExceeded', failures: 1 });
    // Stan trwały bez próby; karta „pending” (niezapisana), bez wyjaśnienia.
    expect(Object.keys(userState(h.controller).attempts)).toHaveLength(0);
    const q1 = question(h.controller);
    expect(q1.answered).toBe(false);
    expect(q1.explanation).toBeNull();
    expect(q1.answers.find((a) => a.optionId === opt)?.state).toBe('pending');
    // Inne komendy zapisujące są wstrzymane do czasu zapisu.
    expect(await h.controller.report()).toMatchObject({ ok: false, code: 'UNSAVED_PENDING' });
    // Aktualizacja niedozwolona przy niezapisanej zmianie.
    const failedCommand = s1.save.status === 'error' ? s1.save.commandId : '';
    expect(await h.controller.retrySave()).toMatchObject({ ok: false });
    expect(h.controller.getState().save).toMatchObject({ status: 'error', failures: 2, commandId: failedCommand });
    expect(await h.controller.retrySave()).toEqual({ ok: true });
    expect(h.controller.getState().save).toEqual({ status: 'idle' });
    const attempts = Object.values(userState(h.controller).attempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.commandId).toBe(failedCommand);
    expect(repo.commits.filter((c) => c === failedCommand)).toHaveLength(3);
    expect(question(h.controller).correct).toBe(true);
    // Zapis trwały: nowy kontroler na tej samej bazie widzi tę samą próbę.
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(Object.values(userState(h2.controller).attempts).map((a) => a.commandId)).toEqual([failedCommand]);
  });

  it('konflikt zapisu (inna karta) → ponowne wczytanie z bazy i komunikat, bez fałszywego sukcesu', async () => {
    let wrapped: ReturnType<typeof failingRepository> | null = null;
    const h = await startHarness({ wrapRepository: (r) => (wrapped = failingRepository(r)) });
    const repo = wrapped as unknown as ReturnType<typeof failingRepository>;
    await startTestN(h, 2);
    repo.failNext('Conflict');
    expect(await h.controller.answer(keyOf(h.controller))).toMatchObject({ ok: false, code: 'Conflict' });
    const s = h.controller.getState();
    expect(s.save).toEqual({ status: 'idle' });
    expect(s.toast).toMatchObject({ kind: 'action_failed' });
    expect(Object.keys(userState(h.controller).attempts)).toHaveLength(0);
    expect(question(h.controller).answers.every((a) => a.state === 'neutral')).toBe(true);
    // Po odświeżeniu stanu można odpowiedzieć.
    expect(await h.controller.answer(keyOf(h.controller))).toEqual({ ok: true });
  });

  it('prośba o trwałe przechowywanie po pierwszej zapisanej odpowiedzi (raz)', async () => {
    const h = await startHarness();
    await startTestN(h, 3);
    expect(h.storage.persistCalls).toBe(0);
    await answerAndNext(h, true);
    await settle();
    expect(h.storage.persistCalls).toBe(1);
    expect(userState(h.controller).settings.persistRequestedAt).not.toBeNull();
    expect(h.controller.getState().storage.persisted).toBe(true);
    await answerAndNext(h, true);
    await settle();
    expect(h.storage.persistCalls).toBe(1);
  });
});

describe('wznowienie (F01) i trasy', () => {
  it('po „ponownym uruchomieniu” to samo pytanie, kolejność opcji, wybór i komentarz; Kontynuuj na starcie', async () => {
    const h = await startHarness();
    await startTestN(h, 5);
    await answerAndNext(h, false);
    await answerAndNext(h, true);
    expect(await h.controller.answer(wrongOf(h.controller))).toEqual({ ok: true });
    const before = question(h.controller);
    const hashBefore = h.platform.hash;
    expect(hashBefore).toBe(`#/sesja/${before.sessionId}`);

    // Nowy kontroler na tej samej bazie, z adresem ekranu pytania (odświeżenie strony).
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName, hash: hashBefore });
    const after = question(h2.controller);
    expect(after.slotId).toBe(before.slotId);
    expect(after.answers.map((a) => a.optionId)).toEqual(before.answers.map((a) => a.optionId));
    expect(after.answered).toBe(true);
    expect(after.correct).toBe(false);
    expect(after.explanation?.text).toBe(before.explanation?.text);
    expect(after.progress).toEqual({ kind: 'test', answeredValid: 3, targetN: 5 });

    // Start bez hasha → karta „Kontynuuj” → to samo pytanie.
    const h3 = await startHarness({ factory: h.factory, dbName: h.dbName, hash: '' });
    expect(h3.controller.getState().resume).toMatchObject({ kind: 'test', answeredValid: 3, targetN: 5 });
    h3.controller.resume();
    expect(question(h3.controller).slotId).toBe(before.slotId);
  });

  it('podgląd wcześniejszej odpowiedzi tylko do odczytu i „Do bieżącego”', async () => {
    const h = await startHarness();
    await startTestN(h, 4);
    await answerAndNext(h, true);
    await answerAndNext(h, false);
    const current = question(h.controller);
    h.controller.showPrevious();
    const prev = question(h.controller);
    expect(prev.mode).toBe('preview');
    expect(prev.answers.every((a) => !a.interactive)).toBe(true);
    expect(prev.canJumpToCurrent).toBe(true);
    expect(await h.controller.answer(prev.answers[0]!.optionId)).toMatchObject({ ok: false });
    h.controller.backToCurrent();
    expect(question(h.controller).slotId).toBe(current.slotId);
  });

  it('nieznany hash i trasa do zamkniętej sesji → start (replace); Wstecz przeglądarki zmienia ekran', async () => {
    const h = await startHarness({ hash: '#/nie-ma-takiej' });
    expect(h.controller.getState().route).toEqual({ name: 'home' });
    h.controller.openSettings();
    expect(h.platform.hash).toBe('#/ustawienia');
    expect(h.platform.hashWrites.at(-1)).toEqual({ hash: '#/ustawienia', mode: 'push' });
    h.platform.browserHash('#/historia/free-flow');
    expect(h.controller.getState().route).toEqual({ name: 'history', tab: 'freeflow' });
    h.platform.browserHash('#/sesja/nie-istnieje');
    expect(h.controller.getState().route).toEqual({ name: 'home' });
    expect(h.platform.hashWrites.at(-1)).toEqual({ hash: '#/', mode: 'replace' });
  });

  it('zamknięcie bez wyniku → historia „niedokończony”, poza wykresem, bez passed', async () => {
    const h = await startHarness();
    await startTestN(h, 5);
    await answerAndNext(h, true);
    h.controller.pauseSession();
    expect(h.controller.getState().resume).toMatchObject({ answeredValid: 1, targetN: 5 });
    expect(await h.controller.closeUnfinished()).toEqual({ ok: true });
    expect(h.controller.getState().resume).toBeNull();
    expect(h.controller.getState().toast?.kind).toBe('test_closed_unfinished');
    h.controller.openHistory('tests');
    const hist = h.controller.getState().screen;
    if (hist?.name !== 'history') throw new Error('historia');
    expect(hist.chart).toHaveLength(0);
    expect(hist.tests[0]).toMatchObject({ status: 'unfinished', passed: null, percentText: null, answeredValid: 1 });
  });
});

describe('zgłoszenie i „Cofnij” (E02, E05)', () => {
  it('zgłoszenie z zastępstwem, Cofnij przywraca stan; po odpowiedzi Cofnij wygasa; Przywróć w ustawieniach', async () => {
    const h = await startHarness();
    await startTestN(h, 5);
    await answerAndNext(h, true);
    const reported = question(h.controller);
    expect(await h.controller.report()).toEqual({ ok: true });
    await settle();
    let s = h.controller.getState();
    expect(s.toast).toMatchObject({ kind: 'reported_replaced', canUndo: true, autoHideMs: null });
    const repl = question(h.controller);
    expect(repl.slotId).not.toBe(reported.slotId);
    expect(repl.position).toBe(reported.position);
    expect(Object.values(userState(h.controller).blocks).filter((b) => b.revokedAt === null)).toHaveLength(1);

    expect(await h.controller.undoReport()).toEqual({ ok: true });
    s = h.controller.getState();
    expect(s.toast?.kind).toBe('report_undone');
    expect(question(h.controller).slotId).toBe(reported.slotId);
    expect(Object.keys(userState(h.controller).blocks)).toHaveLength(0);

    // Zgłoszenie po odpowiedzi → odpowiedź na zastępstwo → Cofnij znika.
    expect(await h.controller.report()).toEqual({ ok: true });
    await settle();
    expect(h.controller.getState().toast?.canUndo).toBe(true);
    expect(await h.controller.answer(keyOf(h.controller))).toEqual({ ok: true });
    expect(h.controller.getState().toast).toBeNull();
    expect(await h.controller.undoReport()).toMatchObject({ ok: false, code: 'UNDO_EXPIRED' });
    const answeredReplacement = question(h.controller);
    expect(answeredReplacement.answered).toBe(true);

    // Przywróć w ustawieniach: tylko przyszłe losowania, odpowiedź na zastępstwo zostaje.
    h.controller.pauseSession();
    h.controller.openSettings();
    h.controller.openExcluded();
    const ex = h.controller.getState().screen;
    if (ex?.name !== 'excluded') throw new Error('wykluczone');
    expect(ex.items).toHaveLength(1);
    expect(ex.hasOpenTest).toBe(true);
    expect(await h.controller.restoreBlock(ex.items[0]!.blockId)).toEqual({ ok: true });
    expect(h.controller.getState().toast?.kind).toBe('block_restored_open_test');
    const ex2 = h.controller.getState().screen;
    expect(ex2?.name === 'excluded' && ex2.items.length).toBe(0);
    h.controller.resume();
    expect(question(h.controller).slotId).toBe(answeredReplacement.slotId);
    expect(question(h.controller).answered).toBe(true);
  });

  it('„Kontynuuj później” unieważnia Cofnij (PRZEKAZANIE §8)', async () => {
    const h = await startHarness();
    await startTestN(h, 3);
    expect(await h.controller.report()).toEqual({ ok: true });
    expect(h.controller.getState().toast?.canUndo).toBe(true);
    h.controller.pauseSession();
    expect(h.controller.getState().toast).toBeNull();
    expect(await h.controller.undoReport()).toMatchObject({ ok: false, code: 'UNDO_EXPIRED' });
  });
});

describe('runda „Uwzględnij błędy” i Free Flow', () => {
  it('runda 2 zawiera błędne pozycje rodzica oznaczone jako powtórka; wykres oznacza powtórkę', async () => {
    const h = await startHarness();
    await startTestN(h, 4);
    await answerAndNext(h, false);
    await answerAndNext(h, false);
    await answerAndNext(h, true);
    await answerAndNext(h, true);
    expect(await h.controller.showResult()).toEqual({ ok: true });
    const res = h.controller.getState().screen;
    if (res?.name !== 'result') throw new Error('wynik');
    expect(res.retryPreview).toMatchObject({ targetN: 4, repeatedWrong: 2, isRetry: true, nextRoundIndex: 2, insufficientCapacity: null });
    expect(await h.controller.startRetryRound(res.sessionId)).toEqual({ ok: true });
    await settle();
    const s = openSession(h.controller);
    expect(s.retry).toMatchObject({ sourceSessionId: res.sessionId, roundIndex: 2, repeatedCount: 2 });
    expect(Object.values(s.slots).filter((x) => x.origin === 'repeated_wrong')).toHaveLength(2);
    expect(question(h.controller).retryRoundIndex).toBe(2);
    for (let i = 0; i < 4; i++) await answerAndNext(h, true);
    expect(await h.controller.showResult()).toEqual({ ok: true });
    h.controller.openHistory('tests');
    const hist = h.controller.getState().screen;
    if (hist?.name !== 'history') throw new Error('historia');
    expect(hist.chart.map((p) => p.isRetry)).toEqual([false, true]);
    expect(hist.tests[0]).toMatchObject({ isRetry: true, roundIndex: 2 });
  });

  it('Free Flow: numer pytania, Dalej dobiera kolejne, zakończenie → podsumowanie bez progu', async () => {
    const h = await startHarness();
    h.controller.openConfig('freeflow');
    expect(await h.controller.startFreeFlow()).toEqual({ ok: true });
    await settle();
    expect(question(h.controller).progress).toEqual({ kind: 'freeflow', questionNumber: 1 });
    await answerAndNext(h, true);
    expect(question(h.controller).progress).toEqual({ kind: 'freeflow', questionNumber: 2 });
    await answerAndNext(h, false);
    expect(await h.controller.endFreeFlow()).toEqual({ ok: true });
    const sum = h.controller.getState().screen;
    expect(sum).toMatchObject({ name: 'freeflowSummary', answeredValid: 2, correct: 1, percentText: '50%', origin: 'session' });
    expect(h.controller.getState().toast?.kind).toBe('freeflow_saved');
  });
});

describe('aktualizacja i przygotowanie (PWA)', () => {
  it('baner aktualizacji niedostępny na ekranie pytania i przy niezapisanej zmianie; dostępny na starcie', async () => {
    const h = await startHarness();
    await startTestN(h, 3);
    h.pwa.needRefresh();
    expect(h.controller.getState().update).toEqual({ available: true, canApplyNow: false, applying: false });
    expect(await h.controller.applyUpdate()).toMatchObject({ ok: false });
    expect(h.pwa.applied).toBe(0);
    h.controller.pauseSession();
    expect(h.controller.getState().update.canApplyNow).toBe(true);
    expect(await h.controller.applyUpdate()).toEqual({ ok: true });
    expect(h.pwa.applied).toBe(1);
  });

  it('pierwsze przygotowanie: postęp, przerwanie z ponowieniem, gotowość offline', async () => {
    const h = await startHarness();
    h.pwa.progress({ done: 10, total: 100 });
    expect(h.controller.getState().preparation).toEqual({ status: 'running', done: 10, total: 100 });
    h.pwa.error({ done: 40, total: 100 });
    expect(h.controller.getState().preparation).toEqual({ status: 'failed', done: 40, total: 100 });
    await h.controller.retryPreparation();
    expect(h.pwa.checks).toBe(1);
    h.pwa.offlineReady();
    expect(h.controller.getState().preparation).toBeNull();
  });
});

describe('kopia danych (F02, F03)', () => {
  it('eksport → import: podsumowanie, zamiana z kopią bezpieczeństwa, równoważne dane', async () => {
    const h = await startHarness();
    await startTestN(h, 2);
    await answerAndNext(h, false);
    await answerAndNext(h, true);
    expect(await h.controller.showResult()).toEqual({ ok: true });
    const before = userState(h.controller);
    h.controller.openSettings();
    h.controller.openBackup();
    expect(await h.controller.exportBackup()).toEqual({ ok: true });
    const file = h.platform.files.at(-1);
    expect(file?.fileName).toMatch(/^dme-kopia-\d{4}-\d{2}-\d{2}\.json$/);
    expect(h.controller.getState().screen).toMatchObject({ name: 'backup', flow: { step: 'idle', lastSavedFileName: file?.fileName } });

    // Inna instalacja (pusta baza) wczytuje kopię.
    const other = await startHarness();
    other.controller.openSettings();
    other.controller.openBackup();
    expect(await other.controller.selectBackupFile(new Blob([file!.text]), file!.fileName)).toEqual({ ok: true });
    const confirm = other.controller.getState().screen;
    expect(confirm).toMatchObject({ name: 'backup', flow: { step: 'confirm', summary: { completedTests: 1, attempts: 2 } } });
    expect(Object.keys(userState(other.controller).sessions)).toHaveLength(0);
    expect(await other.controller.confirmBackupReplace()).toEqual({ ok: true });
    const done = other.controller.getState().screen;
    expect(done).toMatchObject({ name: 'backup', flow: { step: 'done' } });
    const after = userState(other.controller);
    expect(Object.keys(after.sessions).sort()).toEqual(Object.keys(before.sessions).sort());
    expect(Object.keys(after.attempts).sort()).toEqual(Object.keys(before.attempts).sort());
    expect(Object.keys(after.events).length).toBe(Object.keys(before.events).length);
    expect(await other.controller.downloadSafetyBackup()).toEqual({ ok: true });
    expect(other.platform.files.at(-1)?.fileName).toMatch(/^dme-przed-wczytaniem-/);
  });

  it('uszkodzony plik → błąd z przyczynami, dane bez zmian', async () => {
    const h = await startHarness();
    await startTestN(h, 2);
    await answerAndNext(h, true);
    const before = JSON.stringify(userState(h.controller));
    h.controller.pauseSession();
    h.controller.openSettings();
    h.controller.openBackup();
    expect(await h.controller.selectBackupFile(new Blob(['{"format":"dme-backup", uszkodzony']), 'zly.json')).toMatchObject({ ok: false, code: 'InvalidBackup' });
    expect(h.controller.getState().screen).toMatchObject({ name: 'backup', flow: { step: 'error', fileName: 'zly.json', error: { code: 'InvalidBackup' } } });
    expect(JSON.stringify(userState(h.controller))).toBe(before);
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(Object.keys(userState(h2.controller).attempts)).toHaveLength(1);
  });

  it('kopia z nowszego formatu → UnsupportedBackupVersion', async () => {
    const h = await startHarness();
    h.controller.openSettings();
    h.controller.openBackup();
    const text = JSON.stringify({ format: 'dme-backup', formatVersion: 2, appId: 'doktor-monika-egzamin', exportedAt: '2026-10-22T08:00:00.000Z', appVersion: 'x', bankVersions: [], data: {} });
    expect(await h.controller.selectBackupFile(new Blob([text]), 'nowa.json')).toMatchObject({ ok: false, code: 'UnsupportedBackupVersion' });
    expect(h.controller.getState().screen).toMatchObject({ flow: { step: 'error', error: { code: 'UnsupportedBackupVersion', foundVersion: 2 } } });
  });
});

describe('import puli', () => {
  it('paczka z nowym pytaniem (runtime v1) → katalog rośnie; ponowny import = bez zmian; kopia danych to nie pula', async () => {
    const h = await startHarness();
    const src = BANK.questions[0]!;
    const fresh = {
      ...structuredClone(src),
      id: 'ANAT-Q900',
      family_id: 'FAM-ANAT-Q900',
      stem_pl: `${src.stem_pl} (wariant testowy importu)`,
    };
    const { fingerprintRuntimeQuestion } = await import('../../src/domain/fingerprint');
    fresh.fingerprint = await fingerprintRuntimeQuestion(fresh);
    const pack = {
      ...structuredClone(BANK),
      bank_version: 'pack-test-1',
      questions: [fresh],
    };
    h.controller.openSettings();
    h.controller.openPoolImport();
    expect(await h.controller.importPackFile(new Blob([JSON.stringify(pack)]), 'pula.json')).toEqual({ ok: true });
    expect(h.controller.getState().screen).toMatchObject({ name: 'poolImport', flow: { step: 'done', added: 1, updated: 0 } });
    expect(h.controller.getState().catalog?.questions.length).toBe(BANK.questions.length + 1);
    h.controller.resetPoolImportFlow();
    expect(await h.controller.importPackFile(new Blob([JSON.stringify(pack)]), 'pula.json')).toEqual({ ok: true });
    expect(h.controller.getState().screen).toMatchObject({ flow: { step: 'done', added: 0 } });
    expect(h.controller.getState().catalog?.questions.length).toBe(BANK.questions.length + 1);
    // Po ponownym uruchomieniu paczka nadal w katalogu.
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(h2.controller.getState().catalog?.questions.length).toBe(BANK.questions.length + 1);
    h2.controller.openSettings();
    h2.controller.openPoolImport();
    const backupLike = JSON.stringify({ format: 'dme-backup', formatVersion: 1 });
    expect(await h2.controller.importPackFile(new Blob([backupLike]), 'kopia.json')).toMatchObject({ ok: false });
    expect(h2.controller.getState().screen).toMatchObject({ flow: { step: 'error' } });
  });
});
