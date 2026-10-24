/**
 * Rzeczywisty kontroler na bazie STAREJ aplikacji (IndexedDB v1, bank sprzed V15): migracja przy starcie,
 * komunikat „Aktualizacja banku pytań…”, historia z podsumowaniami bez treści, sesje legacy (wynik, przegląd,
 * runda błędów), przerwana sesja niewznawialna, nowe sesje wyłącznie z V15, błąd migracji → ekran błędu
 * bez pytań i ponowienie.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import type { Repository } from '../../src/persistence/api';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import { createMigrationV2, MIGRATIONS } from '../../src/persistence/schema';
import { legacyUserData, OLD_BANK_VERSION, seedChangeset, UNCHANGED_ID, UNCHANGED_ID_2 } from '../persistence/fixtures';
import { RETIRED_IDS } from '../content';
import { openSession, settle, startHarness, userState } from './harness';

let counter = 0;
async function oldAppDb(): Promise<{ factory: IDBFactory; dbName: string }> {
  const factory = new IDBFactory();
  const dbName = `dme-app-migracja-${++counter}`;
  const old = createIndexedDbRepository({ indexedDB: factory, dbName, schemaVersion: 1, migrations: MIGRATIONS.slice(0, 1), contentBankVersion: OLD_BANK_VERSION, storageManager: null });
  const r = await old.commit(seedChangeset(legacyUserData()));
  if (!r.ok) throw new Error(r.error.code);
  old.close();
  return { factory, dbName };
}

describe('kontroler: pierwsze uruchomienie V15 na danych starej aplikacji', () => {
  it('migracja przy starcie („Aktualizacja banku pytań…”), potem historia z podsumowaniami bez treści', async () => {
    const { factory, dbName } = await oldAppDb();
    const stages: string[] = [];
    const repo = createIndexedDbRepository({ indexedDB: factory, dbName, storageManager: null });
    const h = await startHarness({
      factory,
      dbName,
      wrapRepository: () => {
        const wrapped = Object.create(repo) as Repository;
        wrapped.setUpgradeListener = (l) => repo.setUpgradeListener(l ? (info) => { stages.push(`upgrade:${info.from}->${info.to}`); l(info); } : null);
        return wrapped;
      },
      repository: repo,
    });
    const c = h.controller;
    expect(stages).toEqual(['upgrade:1->2']);
    expect(c.getState().boot).toEqual({ phase: 'ready' });
    // Brak otwartej sesji (stara runda przerwana aktualizacją).
    expect(c.getState().resume).toBeNull();
    c.openHistory('tests');
    const hist = c.getState().screen;
    if (hist?.name !== 'history') throw new Error('historia');
    expect(hist.tests.map((t) => [t.sessionId, t.status, t.legacy])).toEqual(
      expect.arrayContaining([
        ['sess-1', 'completed', true],
        ['sess-2', 'interrupted', true],
      ]),
    );
    expect(hist.chart.map((p) => [p.sessionId, p.percent, p.passed])).toEqual([['sess-1', 66.6, true]]);
    c.setHistoryTab('freeflow');
    const ff = c.getState().screen;
    if (ff?.name !== 'history') throw new Error('historia FF');
    expect(ff.freeFlow).toEqual([expect.objectContaining({ sessionId: 'sess-3', answeredValid: 2, correct: 1, legacy: true, interrupted: false })]);

    // Wynik testu legacy: tylko podsumowanie, bez rundy błędów.
    c.openHistoryEntry('sess-1');
    const result = c.getState().screen;
    expect(result).toMatchObject({ name: 'result', legacy: true, status: 'passed', correct: 2, targetN: 3, percentText: '66,6%', canStartRetry: false, retryPreview: null });
    expect(await c.startRetryRound('sess-1')).toMatchObject({ ok: false, code: 'LEGACY_SESSION' });
    // Przegląd: brak listy pytań (treść niedostępna).
    c.openReview('sess-1', 'all');
    expect(c.getState().screen).toMatchObject({ name: 'review', legacy: true, items: [], counts: { all: 0, wrong: 0 }, canStartRetry: false });
    c.openReview('sess-1', 'wrong');
    expect(c.getState().screen).toMatchObject({ name: 'review', legacy: true, items: [] });
    // Szczegół pozycji legacy nie istnieje → start.
    c.navigate({ name: 'reviewItem', sessionId: 'sess-1', slotId: 's1-a', filter: 'all' });
    expect(c.getState().route).toEqual({ name: 'home' });

    // Przerwana sesja: wynik „przerwany”, niewznawialna.
    c.openHistoryEntry('sess-2');
    expect(c.getState().screen).toMatchObject({ name: 'result', status: 'interrupted', legacy: true, canStartRetry: false });
    c.navigate({ name: 'question', sessionId: 'sess-2' });
    expect(c.getState().route).toEqual({ name: 'home' });
    expect(await c.closeUnfinished('sess-2')).toMatchObject({ ok: false });
    expect(await c.endFreeFlow('sess-2')).toMatchObject({ ok: false });

    // Brak starej treści w stanie kontrolera.
    const text = JSON.stringify(userState(c));
    expect(text).not.toContain('[STARA');

    // Nowy test 20 / ALL z „Moje błędy”: wyłącznie V15; zachowany aktywny błąd pytania niezmienionego.
    c.openConfig('test');
    c.updateConfigDraft({ nText: '20', scope: 'ALL', difficulty: 'mixed', myErrorsPriority: true });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    const s = openSession(c);
    expect(s.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(s.allocation.policy).toBe('TEST_POLICY_V3');
    const qids = s.plan.map((id) => s.slots[id]!.questionId);
    expect(qids).toContain(UNCHANGED_ID_2);
    expect(qids.some((id) => RETIRED_IDS.includes(id))).toBe(false);
    expect(Object.values(s.slots).every((slot) => slot.snapshot.bankVersion === CONTENT_RELEASE.bankVersion)).toBe(true);

    // Wykluczone pytania: aktywna tylko blokada pytania niezmienionego.
    c.pauseSession();
    c.openSettings();
    c.openExcluded();
    const ex = c.getState().screen;
    if (ex?.name !== 'excluded') throw new Error('wykluczone');
    expect(ex.items.map((i) => i.questionId)).toEqual([UNCHANGED_ID]);

    // Meta: wersja treści V15.
    const meta = await h.repository.readContentMeta();
    expect(meta.ok && meta.value.content?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(meta.ok && meta.value.migration?.report.sessionsInterrupted).toBe(1);
  });

  it('błąd migracji → ekran „Aktualizacja danych nie powiodła się” bez pytań; „Spróbuj ponownie” kończy migrację', async () => {
    const { factory, dbName } = await oldAppDb();
    const broken = createIndexedDbRepository({ indexedDB: factory, dbName, storageManager: null, migrations: [MIGRATIONS[0]!, createMigrationV2({ faultAfterStore: 'questionStats' })] });
    const good = createIndexedDbRepository({ indexedDB: factory, dbName, storageManager: null });
    let useGood = false;
    const proxy = new Proxy(good, {
      get(target, prop, receiver) {
        const source = useGood ? target : broken;
        const v = Reflect.get(source, prop, receiver === proxy ? source : receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(source) : v;
      },
    }) as Repository;
    const h = await startHarness({ factory, dbName, repository: proxy });
    const boot = h.controller.getState().boot;
    expect(boot).toMatchObject({ phase: 'fatal', code: 'MIGRATION_FAILED', canRetry: true });
    if (boot.phase === 'fatal') expect(boot.messagePl).toMatch(/Aktualizacja danych nie powiodła się/);
    expect(h.controller.getState().screen).toBeNull();
    expect(h.controller.getState().catalog).toBeNull();
    expect(await h.controller.startTest()).toMatchObject({ ok: false });
    useGood = true;
    await h.controller.retryBoot();
    expect(h.controller.getState().boot).toEqual({ phase: 'ready' });
    expect(userState(h.controller).sessions['sess-2']?.status).toBe('interrupted_by_update');
  });
});
