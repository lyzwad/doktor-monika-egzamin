/**
 * Regresje zgłoszeń niezależnych weryfikatorów (rzeczywisty kontroler + IndexedDB + prawdziwy bank):
 * - E03-SLEPY-ZAULEK-UI / LOG-03: oczekiwanie na zastępstwo na wcześniejszej pozycji nie zostawia
 *   ostatniej pozycji bez akcji; liczba oczekujących na karcie „Kontynuuj”;
 * - LOG-01: import puli i wczytanie kopii nie zapisują nic, gdy czeka niezapisana zmiana;
 * - LOG-02: nowy bank (aktualizacja aplikacji) uzupełnia pozycje czekające na zastępstwo po starcie;
 * - F03: automatyczne kopie bezpieczeństwa dostępne także po zamknięciu banera sukcesu.
 */
import { describe, expect, it } from 'vitest';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { RuntimeBank } from '../../src/domain/types';
import { BANK, failingRepository, keyOf, openSession, question, settle, startHarness, userState, type Harness } from './harness';

/** Test w najmniejszym koszyku banku z N = pojemność — zgłoszenie nie ma zastępstwa. */
async function startFullCapacityTest(h: Harness): Promise<number> {
  const c = h.controller;
  c.openConfig('test');
  c.updateConfigDraft({ scope: 'INJ', difficulty: 'advanced', nText: '1', myErrorsPriority: false });
  const cfg = c.getState().screen;
  if (cfg?.name !== 'config') throw new Error('oczekiwano konfiguracji');
  const n = cfg.capacity;
  expect(n).toBeGreaterThanOrEqual(3);
  c.updateConfigDraft({ nText: String(n) });
  expect(await c.startTest()).toEqual({ ok: true });
  await settle();
  return n;
}

async function answerCorrect(h: Harness): Promise<void> {
  expect(await h.controller.answer(keyOf(h.controller))).toEqual({ ok: true });
  await settle();
}

describe('E03 / LOG-03 — pozycja czekająca na zastępstwo nie blokuje ekranu', () => {
  it('zgłoszenie wcześniejszej pozycji bez zastępstwa → na ostatniej „Przejdź do pytania 1” z banerem; po wznowieniu to samo', async () => {
    const h = await startHarness();
    const c = h.controller;
    const n = await startFullCapacityTest(h);
    await answerCorrect(h);
    expect(await c.next()).toEqual({ ok: true });
    await settle();
    c.showPrevious();
    expect(question(c).position).toBe(0);
    expect(await c.report()).toEqual({ ok: true });
    await settle();
    expect(openSession(c).awaitingReplacement).toHaveLength(1);
    expect(c.getState().toast?.kind).toBe('reported_awaiting');
    c.backToCurrent();
    for (let i = 1; i < n; i++) {
      await settle();
      expect(question(c).position).toBe(i);
      // Na każdej pozycji przed ostatnią zwykłe „Dalej”; informacja o oczekującej pozycji w modelu.
      expect(question(c).awaitingElsewhere).toEqual({ position: 0, count: 1 });
      await answerCorrect(h);
      if (i < n - 1) expect(await c.next()).toEqual({ ok: true });
    }
    await settle();
    const last = question(c);
    expect(last.position).toBe(n - 1);
    expect(last.progress).toEqual({ kind: 'test', answeredValid: n - 1, targetN: n });
    expect(last.primaryAction).toBe('go-awaiting');
    expect(last.awaitingElsewhere).toEqual({ position: 0, count: 1 });
    // Wynik nadal niedostępny (spójny stan oczekujący, nie ukończenie N−1).
    expect(await c.showResult()).toMatchObject({ ok: false, code: 'AWAITING_REPLACEMENT' });
    expect(openSession(c).status).toBe('open');
    // „Przejdź do pytania 1” → pozycja oczekująca z banerem S24g (akcje: zamknij / wróć do startu).
    expect(await c.next()).toEqual({ ok: true });
    const awaitingView = question(c);
    expect(awaitingView.position).toBe(0);
    expect(awaitingView.awaitingReplacement).toBe(true);
    expect(awaitingView.awaitingElsewhere).toBeNull();
    // Przerwanie i wznowienie: ta sama ostatnia pozycja z akcją, karta „Kontynuuj” z liczbą oczekujących.
    c.pauseSession();
    expect(c.getState().resume).toMatchObject({ awaitingReplacement: true, awaitingCount: 1 });
    c.resume();
    await settle();
    expect(question(c).position).toBe(n - 1);
    expect(question(c).primaryAction).toBe('go-awaiting');
  });

  it('zgłoszenie bieżącej pozycji (nie ostatniej) bez zastępstwa → „Dalej” pozwala rozwiązywać kolejne; dwie oczekujące liczone osobno', async () => {
    const h = await startHarness();
    const c = h.controller;
    const n = await startFullCapacityTest(h);
    // Pozycja 0: zgłoszenie przed odpowiedzią — brak zastępstwa, ale test można kontynuować.
    expect(await c.report()).toEqual({ ok: true });
    await settle();
    const q0 = question(c);
    expect(q0.awaitingReplacement).toBe(true);
    expect(q0.primaryAction).toBe('next');
    expect(await c.next()).toEqual({ ok: true });
    await settle();
    expect(question(c).position).toBe(1);
    // Pozycja 1: odpowiedź, potem zgłoszenie po odpowiedzi — druga oczekująca.
    await answerCorrect(h);
    expect(await c.report()).toEqual({ ok: true });
    await settle();
    expect(openSession(c).awaitingReplacement).toHaveLength(2);
    expect(question(c).awaitingElsewhere).toBeNull();
    expect(await c.next()).toEqual({ ok: true });
    await settle();
    for (let i = 2; i < n; i++) {
      await settle();
      expect(question(c).awaitingElsewhere).toEqual({ position: 0, count: 2 });
      await answerCorrect(h);
      if (i < n - 1) expect(await c.next()).toEqual({ ok: true });
    }
    await settle();
    expect(question(c).primaryAction).toBe('go-awaiting');
    c.pauseSession();
    expect(c.getState().resume).toMatchObject({ awaitingCount: 2 });
  });
});

describe('LOG-01 — niezapisana zmiana blokuje import puli i wczytanie kopii', () => {
  async function packBlob(id: string): Promise<Blob> {
    const src = BANK.questions[0]!;
    const fresh = { ...structuredClone(src), id, family_id: `FAM-${id}`, stem_pl: `${src.stem_pl} (${id})` };
    fresh.fingerprint = await fingerprintRuntimeQuestion(fresh);
    return new Blob([JSON.stringify({ ...structuredClone(BANK), bank_version: `pack-${id}`, questions: [fresh] })]);
  }

  it('import przy niezapisanej odpowiedzi jest odrzucony; „Spróbuj zapisać ponownie” zapisuje tę samą odpowiedź', async () => {
    let wrapped: ReturnType<typeof failingRepository> | null = null;
    const h = await startHarness({ wrapRepository: (r) => (wrapped = failingRepository(r)) });
    const repo = wrapped as unknown as ReturnType<typeof failingRepository>;
    const c = h.controller;
    c.openConfig('test');
    c.updateConfigDraft({ nText: '3' });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    repo.failNext('QuotaExceeded', 1);
    expect(await c.answer(keyOf(c))).toMatchObject({ ok: false, code: 'QuotaExceeded' });
    const failed = c.getState().save;
    expect(failed).toMatchObject({ status: 'error', action: 'answer' });
    const catalogSize = c.getState().catalog?.questions.length;

    c.pauseSession();
    c.openSettings();
    c.openPoolImport();
    expect(await c.importPackFile(await packBlob('ANAT-Q901'), 'pula.json')).toMatchObject({ ok: false, code: 'UNSAVED_PENDING' });
    expect(c.getState().screen).toMatchObject({ name: 'poolImport', flow: { step: 'error', fileName: 'pula.json' } });
    expect(c.getState().catalog?.questions.length).toBe(catalogSize);
    expect((await h.repository.listPacks()).ok && (await h.repository.listPacks())).toMatchObject({ value: [] });

    // Ponowienie TEJ SAMEJ komendy nadal możliwe i skuteczne.
    expect(await c.retrySave()).toEqual({ ok: true });
    const attempts = Object.values(userState(c).attempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.commandId).toBe(failed.status === 'error' ? failed.commandId : '');
    // Po zapisie import działa.
    c.resetPoolImportFlow();
    expect(await c.importPackFile(await packBlob('ANAT-Q902'), 'pula.json')).toEqual({ ok: true });
    expect(c.getState().catalog?.questions.length).toBe((catalogSize ?? 0) + 1);
  });

  it('wczytanie kopii przy niezapisanej odpowiedzi jest odrzucone bez zmiany danych', async () => {
    let wrapped: ReturnType<typeof failingRepository> | null = null;
    const h = await startHarness({ wrapRepository: (r) => (wrapped = failingRepository(r)) });
    const repo = wrapped as unknown as ReturnType<typeof failingRepository>;
    const c = h.controller;
    // Kopia z innej instalacji (pusta).
    const other = await startHarness();
    other.controller.openSettings();
    other.controller.openBackup();
    expect(await other.controller.exportBackup()).toEqual({ ok: true });
    const file = other.platform.files.at(-1)!;

    c.openConfig('test');
    c.updateConfigDraft({ nText: '2' });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    c.pauseSession();
    c.openSettings();
    c.openBackup();
    expect(await c.selectBackupFile(new Blob([file.text]), file.fileName)).toEqual({ ok: true });
    // Niezapisana zmiana (np. zapis ustawień w tle nie liczy się — używamy komendy użytkowniczki).
    repo.failNext('QuotaExceeded', 1);
    expect(await c.dismissInstallHint()).toMatchObject({ ok: false, code: 'QuotaExceeded' });
    expect(c.getState().save).toMatchObject({ status: 'error' });
    const before = JSON.stringify(userState(c).sessions);
    expect(await c.confirmBackupReplace()).toMatchObject({ ok: false, code: 'UNSAVED_PENDING' });
    expect(c.getState().screen).toMatchObject({ name: 'backup', flow: { step: 'confirm' } });
    expect(JSON.stringify(userState(c).sessions)).toBe(before);
    expect((await h.repository.listBackups()).ok && (await h.repository.listBackups())).toMatchObject({ value: [] });
    // Po zapisie zamiana jest możliwa.
    expect(await c.retrySave()).toEqual({ ok: true });
    expect(await c.confirmBackupReplace()).toEqual({ ok: true });
  });
});

describe('LOG-02 — nowe pytania z aktualizacji banku uzupełniają oczekujące pozycje', () => {
  it('restart na tej samej bazie z pełnym bankiem obsadza pozycję czekającą na zastępstwo', async () => {
    const anat = BANK.questions.filter((q) => q.domain_id === 'ANAT');
    const keep = new Set([...new Set(anat.map((q) => q.family_id))].slice(0, 3));
    const small: RuntimeBank = { ...structuredClone(BANK), bank_version: 'small', questions: BANK.questions.filter((q) => q.domain_id !== 'ANAT' || keep.has(q.family_id)) };
    const h = await startHarness({ loadBank: async () => structuredClone(small) });
    h.controller.openConfig('test');
    h.controller.updateConfigDraft({ nText: '3', scope: 'ANAT', difficulty: 'mixed', myErrorsPriority: false });
    expect(await h.controller.startTest()).toEqual({ ok: true });
    await settle();
    expect(await h.controller.report()).toEqual({ ok: true });
    await settle();
    const before = openSession(h.controller);
    expect(before.awaitingReplacement).toHaveLength(1);
    const awaitingSlot = before.awaitingReplacement[0];

    // „Aktualizacja aplikacji”: ta sama baza, pełny bank.
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    await settle();
    const after = openSession(h2.controller);
    expect(after.id).toBe(before.id);
    expect(after.awaitingReplacement).toEqual([]);
    const replacement = after.slots[after.plan[0] ?? ''];
    expect(replacement?.origin).toBe('replacement');
    expect(replacement?.replacesSlotId).toBe(awaitingSlot);
    expect(keep.has(replacement?.snapshot.familyId ?? '')).toBe(false);
    expect(h2.controller.getState().save).toEqual({ status: 'idle' });
    // Zapis trwały.
    const h3 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(openSession(h3.controller).awaitingReplacement).toEqual([]);
  });

  it('bez nowych pytań start niczego nie zapisuje (stan oczekujący bez zmian)', async () => {
    const anat = BANK.questions.filter((q) => q.domain_id === 'ANAT');
    const keep = new Set([...new Set(anat.map((q) => q.family_id))].slice(0, 3));
    const small: RuntimeBank = { ...structuredClone(BANK), bank_version: 'small', questions: BANK.questions.filter((q) => q.domain_id !== 'ANAT' || keep.has(q.family_id)) };
    const h = await startHarness({ loadBank: async () => structuredClone(small) });
    h.controller.openConfig('test');
    h.controller.updateConfigDraft({ nText: '3', scope: 'ANAT', difficulty: 'mixed', myErrorsPriority: false });
    expect(await h.controller.startTest()).toEqual({ ok: true });
    await settle();
    expect(await h.controller.report()).toEqual({ ok: true });
    await settle();
    const revision = openSession(h.controller).revision;
    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName, loadBank: async () => structuredClone(small) });
    h2.controller.resume();
    await settle();
    expect(openSession(h2.controller).awaitingReplacement).toHaveLength(1);
    expect(openSession(h2.controller).revision).toBe(revision);
    expect(h2.controller.getState().save).toEqual({ status: 'idle' });
  });
});

describe('F03 — kopie bezpieczeństwa dostępne po zamknięciu banera sukcesu', () => {
  it('lista kopii po „Gotowe” i po ponownym wejściu; „Pobierz” i „Przywróć” wracają do stanu sprzed wczytania', async () => {
    const h = await startHarness();
    const c = h.controller;
    // Stan A: ukończony test.
    c.openConfig('test');
    c.updateConfigDraft({ nText: '1' });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    await answerCorrect(h);
    expect(await c.showResult()).toEqual({ ok: true });
    const stateA = Object.keys(userState(c).sessions).sort();
    expect(stateA).toHaveLength(1);

    // Kopia pustej instalacji wczytana na stan A.
    const other = await startHarness();
    other.controller.openSettings();
    other.controller.openBackup();
    expect(await other.controller.exportBackup()).toEqual({ ok: true });
    const emptyFile = other.platform.files.at(-1)!;
    c.openSettings();
    c.openBackup();
    await settle();
    expect(c.getState().screen).toMatchObject({ name: 'backup', safetyBackups: [] });
    expect(await c.selectBackupFile(new Blob([emptyFile.text]), emptyFile.fileName)).toEqual({ ok: true });
    expect(await c.confirmBackupReplace()).toEqual({ ok: true });
    expect(Object.keys(userState(c).sessions)).toHaveLength(0);

    // Baner sukcesu zamknięty i wyjście z ekranu — kopia nadal dostępna w UI.
    c.resetBackupFlow();
    c.goBack();
    c.openBackup();
    await settle();
    const screen = c.getState().screen;
    if (screen?.name !== 'backup') throw new Error('oczekiwano ekranu kopii');
    expect(screen.flow.step).toBe('idle');
    expect(screen.safetyBackups).toHaveLength(1);
    const safety = screen.safetyBackups![0]!;
    expect(safety.fileName).toMatch(/^dme-przed-wczytaniem-/);

    expect(await c.downloadSafetyBackup(safety.id)).toEqual({ ok: true });
    expect(h.platform.files.at(-1)?.fileName).toBe(safety.fileName);

    // „Przywróć” → to samo podsumowanie do decyzji → zamiana z nową kopią bezpieczeństwa.
    expect(await c.restoreSafetyBackup(safety.id)).toEqual({ ok: true });
    expect(c.getState().screen).toMatchObject({ name: 'backup', flow: { step: 'confirm', fileName: safety.fileName, summary: { completedTests: 1 } } });
    expect(Object.keys(userState(c).sessions)).toHaveLength(0);
    expect(await c.confirmBackupReplace()).toEqual({ ok: true });
    expect(Object.keys(userState(c).sessions).sort()).toEqual(stateA);
    const done = c.getState().screen;
    if (done?.name !== 'backup') throw new Error('oczekiwano ekranu kopii');
    expect(done.safetyBackups).toHaveLength(2);

    // Nieistniejąca kopia → komunikat, bez zmian.
    expect(await c.restoreSafetyBackup('brak')).toMatchObject({ ok: false, code: 'NotFound' });
  });
});
