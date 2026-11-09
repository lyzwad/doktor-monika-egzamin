/**
 * Rzeczywisty kontroler na bazie profilu z wdrożonej aplikacji V15 (IndexedDB v3) i z danymi V16:
 * migracja przy starcie („Aktualizacja banku pytań…”), historia z podsumowaniami bez treści, sesje legacy
 * (wynik, przegląd, runda błędów), przerwana sesja niewznawialna, nowe sesje wyłącznie z 700 pytań V18,
 * sesja V16 zgodna z paczką dalej wznawialna, błąd migracji → ekran błędu bez pytań i ponowienie.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import type { Repository } from '../../src/persistence/api';
import type { BackupData } from '../../src/persistence/api';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import { createMigrationV4, MIGRATIONS } from '../../src/persistence/schema';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { profileData, seedChangeset, V15_BANK_VERSION, V16_BANK_VERSION, v15ProfileData } from '../persistence/fixtures';
import { RETIRED_IDS } from '../content';
import { openSession, settle, startHarness, userState } from './harness';

const ALLOWED = new Set(V18_ALLOWED.map(([id]) => id));

let counter = 0;
async function v3ProfileDb(data: BackupData, contentBankVersion: string): Promise<{ factory: IDBFactory; dbName: string }> {
  const factory = new IDBFactory();
  const dbName = `dme-app-migracja-${++counter}`;
  const old = createIndexedDbRepository({ indexedDB: factory, dbName, schemaVersion: 3, migrations: MIGRATIONS.slice(0, 3), contentBankVersion, storageManager: null });
  const r = await old.commit(seedChangeset(data));
  if (!r.ok) throw new Error(r.error.code);
  old.close();
  return { factory, dbName };
}

describe('kontroler: pierwsze uruchomienie V18 na profilu z aplikacji V15', () => {
  it('migracja przy starcie, historia z podsumowaniami bez treści, nowe sesje wyłącznie z puli 700', async () => {
    const { factory, dbName } = await v3ProfileDb(v15ProfileData(RETIRED_IDS), V15_BANK_VERSION);
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
    expect(stages).toEqual(['upgrade:3->4']);
    expect(c.getState().boot).toEqual({ phase: 'ready' });
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

    c.openHistoryEntry('sess-1');
    expect(c.getState().screen).toMatchObject({ name: 'result', legacy: true, status: 'passed', correct: 2, targetN: 3, percentText: '66,6%', canStartRetry: false });
    expect(await c.startRetryRound('sess-1')).toMatchObject({ ok: false, code: 'LEGACY_SESSION' });
    c.openReview('sess-1', 'all');
    expect(c.getState().screen).toMatchObject({ name: 'review', legacy: true, items: [] });
    c.navigate({ name: 'question', sessionId: 'sess-2' });
    expect(c.getState().route).toEqual({ name: 'home' });

    expect(JSON.stringify(userState(c))).not.toContain('[DAWNA');

    // Nowy test 20 / ALL: wyłącznie ID z allowlisty V18, bez powtórzeń ID.
    c.openConfig('test');
    c.updateConfigDraft({ nText: '20', scope: 'ALL', myErrorsPriority: false });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    const s = openSession(c);
    expect(s.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(s.config.difficulty).toBe('mixed');
    const qids = s.plan.map((id) => s.slots[id]!.questionId);
    expect(qids).toHaveLength(20);
    expect(new Set(qids).size).toBe(20);
    expect(qids.every((id) => ALLOWED.has(id))).toBe(true);

    // Dawne zgłoszenie pytania spoza allowlisty — nieaktywne (nie ma go na liście wykluczonych).
    c.pauseSession();
    c.openSettings();
    c.openExcluded();
    const ex = c.getState().screen;
    if (ex?.name !== 'excluded') throw new Error('wykluczone');
    expect(ex.items).toEqual([]);

    const meta = await h.repository.readContentMeta();
    expect(meta.ok && meta.value.content?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(meta.ok && meta.value.migration?.report.sessionsInterrupted).toBe(1);
  });

  it('profil V16 zgodny z paczką: otwarta sesja dalej do dokończenia, błąd i zgłoszenie zachowane', async () => {
    const { factory, dbName } = await v3ProfileDb(profileData(V16_BANK_VERSION, (_i, q) => q), V16_BANK_VERSION);
    const h = await startHarness({ factory, dbName });
    const c = h.controller;
    expect(c.getState().boot).toEqual({ phase: 'ready' });
    expect(c.getState().resume).toMatchObject({ sessionId: 'sess-2' });
    const state = userState(c);
    expect(state.sessions['sess-2']).toMatchObject({ status: 'open', bankVersion: CONTENT_RELEASE.bankVersion });
    expect(state.questionStats['V16-ANAT-002']).toMatchObject({ activeError: true });
    c.openSettings();
    c.openExcluded();
    const ex = c.getState().screen;
    if (ex?.name !== 'excluded') throw new Error('wykluczone');
    expect(ex.items.map((i) => i.questionId)).toEqual(['V16-ANAT-004']);
  });

  it('błąd migracji → ekran „Aktualizacja danych nie powiodła się” bez pytań; „Spróbuj ponownie” kończy migrację', async () => {
    const { factory, dbName } = await v3ProfileDb(v15ProfileData(RETIRED_IDS), V15_BANK_VERSION);
    const broken = createIndexedDbRepository({ indexedDB: factory, dbName, storageManager: null, migrations: [...MIGRATIONS.slice(0, 3), createMigrationV4({ faultAfterStore: 'questionStats' })] });
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
    expect(h.controller.getState().catalog).toBeNull();
    useGood = true;
    await h.controller.retryBoot();
    expect(h.controller.getState().boot).toEqual({ phase: 'ready' });
    expect(userState(h.controller).sessions['sess-2']?.status).toBe('interrupted_by_update');
  });
});
