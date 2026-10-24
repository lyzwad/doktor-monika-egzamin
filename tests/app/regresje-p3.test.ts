/**
 * Regresje zgłoszeń P3 niezależnej weryfikacji (rzeczywisty kontroler + IndexedDB + finalny bank):
 * - D02: „Nowa runda” po bezbłędnym rodzicu zapisuje parent/łańcuch/numer rundy, bez oznaczenia Powtórka;
 * - LOG-05: równoczesne zgłoszenie i odpowiedź — błąd nie zabiera ważnego „Cofnij”;
 * - LOG-06: podwójne startRetryRound / endFreeFlow / closeUnfinished bez fantomowej rundy i fałszywego błędu;
 * - LOG-08: eksport kopii nie twierdzi, że plik zapisano;
 * - C01 / stan puli: liczby w konfiguracji i „O bazie” z jednego źródła (rodziny vs pytania).
 */
import { describe, expect, it } from 'vitest';
import type { ConfigVM } from '../../src/app/viewModels';
import { BANK, keyOf, openSession, question, settle, startHarness, userState, wrongOf, type Harness } from './harness';

async function startTestN(h: Harness, n: number): Promise<void> {
  h.controller.openConfig('test');
  h.controller.updateConfigDraft({ nText: String(n) });
  expect(await h.controller.startTest()).toEqual({ ok: true });
  await settle();
}

/** Odpowiada na wszystkie pozycje (poprawnie wg `correct`) i pokazuje wynik; zwraca id sesji. */
async function finishTest(h: Harness, correct: (i: number) => boolean): Promise<string> {
  const c = h.controller;
  const sessionId = openSession(c).id;
  for (let i = 0; ; i++) {
    expect(await c.answer(correct(i) ? keyOf(c) : wrongOf(c))).toEqual({ ok: true });
    await settle();
    if (question(c).primaryAction === 'show-result') break;
    expect(await c.next()).toEqual({ ok: true });
    await settle();
  }
  expect(await c.showResult()).toEqual({ ok: true });
  await settle();
  return sessionId;
}

describe('D02 — nowa runda po bezbłędnym rodzicu ma powiązanie z rodzicem, bez oznaczenia Powtórka', () => {
  it('retry {sourceSessionId, retryChainId, roundIndex: 2, repeatedCount: 0}; bez „Powtórka” w pytaniu i ◆ na wykresie; wynik „Runda 2”', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 2);
    const parentId = await finishTest(h, () => true);
    const result = c.getState().screen;
    expect(result).toMatchObject({ name: 'result', retryPreview: { repeatedWrong: 0, isRetry: false, nextRoundIndex: 2 } });

    expect(await c.startRetryRound(parentId)).toEqual({ ok: true });
    await settle();
    const round = openSession(c);
    expect(round.id).not.toBe(parentId);
    expect(round.retry).toEqual({ sourceSessionId: parentId, retryChainId: parentId, roundIndex: 2, repeatedCount: 0 });
    // Ekran pytania: bez tagu „Powtórka · runda N” i bez „Z poprzedniej rundy”.
    expect(question(c).retryRoundIndex).toBeNull();
    expect(question(c).originTag).not.toBe('repeated_wrong');

    const roundId = await finishTest(h, () => true);
    const res = c.getState().screen;
    expect(res).toMatchObject({ name: 'result', sessionId: roundId, retry: { roundIndex: 2, repeatedCount: 0 } });
    c.openHistory('tests');
    const hist = c.getState().screen;
    if (hist?.name !== 'history') throw new Error('oczekiwano historii');
    // Wykres: obie sesje bez ◆ (isRetry=false); lista: druga runda nie jest „Powtórką”.
    expect(hist.chart.map((p) => [p.sessionId, p.isRetry])).toEqual([
      [parentId, false],
      [roundId, false],
    ]);
    expect(hist.tests.find((t) => t.sessionId === roundId)).toMatchObject({ isRetry: false, roundIndex: 2 });
    // Zapis trwały: powiązanie przetrwało w IndexedDB.
    const reloaded = await h.repository.loadUserState();
    expect(reloaded.ok && reloaded.value.sessions[roundId]?.retry).toEqual({ sourceSessionId: parentId, retryChainId: parentId, roundIndex: 2, repeatedCount: 0 });
  });
});

describe('LOG-05 — równoczesne zgłoszenie i odpowiedź', () => {
  it('odpowiedź w trakcie zapisu zgłoszenia jest ignorowana (BUSY); toast „Cofnij” zostaje i cofnięcie działa', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 5);
    const before = question(c);
    const key = keyOf(c);
    const [reported, answered] = await Promise.all([c.report(), c.answer(key)]);
    await settle();
    expect(reported).toEqual({ ok: true });
    expect(answered).toMatchObject({ ok: false, code: 'BUSY' });
    expect(Object.keys(userState(c).attempts)).toHaveLength(0);
    const toast = c.getState().toast;
    expect(toast).toMatchObject({ kind: 'reported_replaced', canUndo: true });
    expect(toast?.alertPl).toBeUndefined();
    expect(await c.undoReport()).toEqual({ ok: true });
    await settle();
    expect(question(c).slotId).toBe(before.slotId);
    expect(c.getState().toast?.kind).toBe('report_undone');
  });

  it('błąd innej akcji przy ważnym „Cofnij” nie zastępuje toastu — idzie osobnym kanałem (alertPl)', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 5);
    expect(await c.report()).toEqual({ ok: true });
    await settle();
    expect(c.getState().toast).toMatchObject({ kind: 'reported_replaced', canUndo: true });
    // Akcja odrzucona przez domenę (nieistniejąca blokada) — bez zmiany sesji, więc „Cofnij” nadal ważne.
    const failed = await c.restoreBlock('brak-takiej-blokady');
    expect(failed.ok).toBe(false);
    await settle();
    const toast = c.getState().toast;
    expect(toast).toMatchObject({ kind: 'reported_replaced', canUndo: true });
    expect(typeof toast?.alertPl).toBe('string');
    expect(toast?.alertPl).toBe(failed.ok ? '' : failed.messagePl);
    expect(await c.undoReport()).toEqual({ ok: true });
  });

  it('bez ważnego „Cofnij” błąd jest zwykłym toastem action_failed', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 3);
    const failed = await c.restoreBlock('brak-takiej-blokady');
    expect(failed.ok).toBe(false);
    expect(c.getState().toast).toMatchObject({ kind: 'action_failed', canUndo: false });
    expect(c.getState().toast?.alertPl).toBeUndefined();
  });
});

describe('LOG-06 — blokada podwójnego wywołania', () => {
  it('dwa równoległe startRetryRound → jedna nowa runda (bez fantomowej „Niedokończony”)', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 2);
    const parentId = await finishTest(h, () => false);
    const [a, b] = await Promise.all([c.startRetryRound(parentId), c.startRetryRound(parentId)]);
    await settle();
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    const sessions = Object.values(userState(c).sessions);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.status === 'unfinished')).toHaveLength(0);
    expect(sessions.filter((s) => s.status === 'open')).toHaveLength(1);
    expect(openSession(c).retry).toMatchObject({ sourceSessionId: parentId, roundIndex: 2, repeatedCount: 2 });
  });

  it('dwa równoległe endFreeFlow → jedno zakończenie, toast „zapisana”, bez błędu „sesja zamknięta”', async () => {
    const h = await startHarness();
    const c = h.controller;
    c.openConfig('freeflow');
    expect(await c.startFreeFlow()).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    const [a, b] = await Promise.all([c.endFreeFlow(), c.endFreeFlow()]);
    await settle();
    expect(a).toEqual({ ok: true });
    expect(b).toMatchObject({ ok: false, code: 'BUSY' });
    expect(c.getState().route.name).toBe('freeflowSummary');
    expect(c.getState().toast?.kind).toBe('freeflow_saved');
    expect(Object.values(userState(c).events).filter((e) => e.type === 'freeflow_ended')).toHaveLength(1);
  });

  it('dwa równoległe closeUnfinished → jedno zamknięcie, toast o niedokończonym teście', async () => {
    const h = await startHarness();
    const c = h.controller;
    await startTestN(h, 3);
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    const id = openSession(c).id;
    const [a, b] = await Promise.all([c.closeUnfinished(id), c.closeUnfinished(id)]);
    await settle();
    expect(a).toEqual({ ok: true });
    expect(b).toMatchObject({ ok: false, code: 'BUSY' });
    expect(userState(c).sessions[id]?.status).toBe('unfinished');
    expect(Object.values(userState(c).events).filter((e) => e.type === 'session_unfinished')).toHaveLength(1);
    expect(c.getState().toast?.kind).toBe('test_closed_unfinished');
  });
});

describe('LOG-08 — eksport kopii', () => {
  it('po przekazaniu pliku do pobrania toast „backup_saved” niesie nazwę; tekst UI nie twierdzi „Zapisano”', async () => {
    const { toastText } = await import('../../src/ui/format');
    const h = await startHarness();
    const c = h.controller;
    c.openSettings();
    c.openBackup();
    expect(await c.exportBackup()).toEqual({ ok: true });
    const file = h.platform.files[0];
    expect(file?.fileName).toMatch(/^dme-kopia-/);
    const toast = c.getState().toast;
    expect(toast).toMatchObject({ kind: 'backup_saved', params: { fileName: file?.fileName } });
    const text = toastText(toast!);
    expect(text).not.toMatch(/Zapisano/);
    expect(text).toContain(`Przygotowano plik kopii ${file?.fileName}`);
  });
});

describe('C01 / stan puli — spójne liczby z finalnego banku', () => {
  it('konfiguracja: pojemność = rodziny (maksimum N), obok liczba pytań; „O bazie” i ustawienia: liczby z bank.counts', async () => {
    const h = await startHarness();
    const c = h.controller;
    c.openConfig('test');
    const cfg = c.getState().screen as ConfigVM;
    expect(cfg.capacity).toBe(BANK.counts.families);
    expect(cfg.questionCount).toBe(BANK.counts.questions);
    expect(cfg.scopeOptions.find((o) => o.scope === 'ALL')).toMatchObject({ capacity: BANK.counts.families, questionCount: BANK.counts.questions });
    for (const o of cfg.scopeOptions.filter((x) => x.scope !== 'ALL')) {
      const qs = BANK.questions.filter((q) => q.domain_id === o.scope);
      expect(o.questionCount).toBe(qs.length);
      expect(o.capacity).toBe(new Set(qs.map((q) => q.family_id)).size);
    }
    // Maksimum N = liczba rodzin (logika bez zmian).
    c.updateConfigDraft({ nText: String(BANK.counts.families + 1) });
    expect((c.getState().screen as ConfigVM).nValidation).toMatchObject({ ok: false, code: 'EXCEEDS_CAPACITY', capacity: BANK.counts.families });

    c.openSettings();
    c.openAbout();
    const about = c.getState().screen;
    if (about?.name !== 'about') throw new Error('oczekiwano „O bazie”');
    expect(about.bank).toMatchObject({
      questionCount: BANK.counts.questions,
      familyCount: BANK.counts.families,
      independentlyCheckedCount: BANK.counts.independently_checked_draft,
      schematicCount: BANK.counts.schematic,
      catalogQuestionCount: BANK.counts.questions,
      statusPl: BANK.status_pl,
      clinicalSignoff: false,
    });
    expect(about.bank.poolNotePl).toBe((BANK as unknown as { pool_note_pl: string }).pool_note_pl);
    expect(about.bank.poolNotePl).toMatch(/Bank zamknięty/);
    expect(Object.fromEntries(about.bank.byDifficulty.map((d) => [d.difficulty, d.count]))).toEqual(BANK.counts.by_difficulty);
    expect(Object.fromEntries(about.byDomain.map((d) => [d.domainId, d.count]))).toEqual(BANK.counts.by_domain);
    const settings = (c.openSettings(), c.getState().screen);
    expect(settings).toMatchObject({ name: 'settings', bank: { questionCount: BANK.counts.questions, familyCount: BANK.counts.families } });
  });
});
