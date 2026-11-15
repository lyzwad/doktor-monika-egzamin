/**
 * Rzeczywisty kontroler bieżącego wydania na bazie profilu z aplikacji V18 (IndexedDB v4, produkcja `39d9d46`):
 * migracja 4 → 5 przy starcie w jednej aktualizacji, sesje V18 aktywne i wznawialne w bieżącej wersji treści,
 * „Moje błędy” i wykluczone pytania zostają, podsumowania V15 bez zmian, dalsza nauka zapisuje się,
 * błąd migracji → ekran błędu i ponowienie. Profil V18 ma jawną wersję V18 — po podmianie `CONTENT_RELEASE`
 * na nowe wydanie (historia 1) ten sam test sprawdza prawdziwe przeniesienie V18 → nowa wersja.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import type { BackupData, Repository } from '../../src/persistence/api';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import { createMigrations, MIGRATIONS } from '../../src/persistence/schema';
import { seedChangeset, V18_BANK_VERSION, v18LegacySessions, v18ProfileData } from '../persistence/fixtures';
import { keyOf, question, settle, startHarness, userState } from './harness';

let counter = 0;

/** Baza profilu zapisana przez aplikację V18: schemat 4 z rekordami `meta` migracji `bank-v18`. */
async function v4ProfileDb(data: BackupData): Promise<{ factory: IDBFactory; dbName: string }> {
  const factory = new IDBFactory();
  const dbName = `dme-app-webinary-${++counter}`;
  const old = createIndexedDbRepository({ indexedDB: factory, dbName, schemaVersion: 4, migrations: MIGRATIONS.slice(0, 4), contentBankVersion: V18_BANK_VERSION, storageManager: null });
  const r = await old.commit(seedChangeset(data));
  if (!r.ok) throw new Error(r.error.code);
  old.close();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['meta'], 'readwrite');
    tx.objectStore('meta').put({ key: 'content', bankVersion: V18_BANK_VERSION, bankSha256: '5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6', updatedAt: '2026-11-09T21:00:00.000Z', appVersion: '0.1.0' });
    tx.objectStore('meta').put({ key: 'migration:bank-v18', migrationId: 'bank-v18', fromSchemaVersion: 3, toSchemaVersion: 4, appVersion: '0.1.0', report: {} });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { factory, dbName };
}

describe('kontroler: pierwsze uruchomienie bieżącego wydania na profilu z aplikacji V18', () => {
  it('migracja 4 → 5 przy starcie; sesje V18 aktywne; „Moje błędy” i wykluczone pytania zostają; Free Flow i runda błędów działają dalej', async () => {
    const data = v18ProfileData();
    const { factory, dbName } = await v4ProfileDb(data);
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
    expect(stages).toEqual(['upgrade:4->5']);
    expect(c.getState().boot).toEqual({ phase: 'ready' });

    // Każda sesja V18 aktywna w bieżącej wersji treści, z tym samym statusem, planem i wynikiem.
    // Bieżące wydanie inne niż V18 (po historii 1) → sesje przeniesione (`revision + 1`); V18 → bez zmian.
    const restamped = CONTENT_RELEASE.bankVersion !== V18_BANK_VERSION;
    const state = userState(c);
    for (const original of data.sessions.filter((s) => !s.legacy)) {
      const migrated = state.sessions[original.id]!;
      expect(migrated).toMatchObject({ status: original.status, plan: original.plan, result: original.result, bankVersion: CONTENT_RELEASE.bankVersion, revision: original.revision + (restamped ? 1 : 0) });
      expect(migrated.legacy ?? null).toBeNull();
      expect(Object.values(migrated.slots).every((slot) => slot.snapshot.bankVersion === CONTENT_RELEASE.bankVersion)).toBe(true);
    }
    for (const legacy of v18LegacySessions()) expect(state.sessions[legacy.id]).toEqual(legacy);
    // „Moje błędy” (aktywne błędy) i wykluczone pytania V18 — bez zmian.
    const activeErrors = (ids: { questionId: string; activeError: boolean }[]) => ids.filter((s) => s.activeError).map((s) => s.questionId).sort();
    expect(activeErrors(Object.values(state.questionStats))).toEqual(activeErrors(data.questionStats));
    expect(Object.keys(state.attempts).sort()).toEqual(data.attempts.map((a) => a.id).sort());
    c.openSettings();
    c.openExcluded();
    const ex = c.getState().screen;
    if (ex?.name !== 'excluded') throw new Error('wykluczone');
    expect(ex.items.map((i) => i.questionId)).toEqual(data.blocks.map((b) => b.questionId));

    // Wznowienie: najnowsza otwarta sesja (Free Flow) — kolejne pytanie z bieżącej puli i odpowiedź.
    c.goHome();
    expect(c.getState().resume).toMatchObject({ sessionId: 'sess-4', kind: 'freeflow' });
    c.resume();
    expect(question(c).sessionId).toBe('sess-4');
    expect(await c.next()).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    const ff = userState(c).sessions['sess-4']!;
    expect(ff.plan).toHaveLength(2);
    expect(ff.slots[ff.plan[1]!]!.snapshot.bankVersion).toBe(CONTENT_RELEASE.bankVersion);

    // Otwarta runda błędów (zastępstwo po zgłoszeniu): odpowiedź i wynik.
    c.navigate({ name: 'question', sessionId: 'sess-2' });
    expect(question(c).sessionId).toBe('sess-2');
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    expect(await c.showResult()).toEqual({ ok: true });
    await settle();
    expect(userState(c).sessions['sess-2']).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 2, passed: true } });

    const meta = await h.repository.readContentMeta();
    if (!meta.ok) throw new Error(meta.error.code);
    expect(meta.value.content).toMatchObject({ bankVersion: CONTENT_RELEASE.bankVersion, bankSha256: CONTENT_RELEASE.bankSha256 });
    expect(meta.value.migration).toMatchObject({ migrationId: 'bank-v18-webinary', fromSchemaVersion: 4, toSchemaVersion: 5, report: { sessionsCurrent: 5, sessionsRestamped: restamped ? 5 : 0, sessionsLegacy: 2, sessionsInterrupted: 0 } });
  });

  it('kopia danych z sesją utworzoną przez kontroler (snapshoty z kodu domeny): eksport → wczytanie daje te same sesje', async () => {
    const h = await startHarness();
    const c = h.controller;
    c.openConfig('test');
    c.updateConfigDraft({ nText: '50', scope: 'ALL', myErrorsPriority: false });
    expect(await c.startTest()).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    const before = userState(c);
    const open = Object.values(before.sessions).find((s) => s.status === 'open')!;
    expect(open.plan).toHaveLength(50);
    // Po scaleniu historii 1 pula obejmuje pytania WB — kopia przenosi wtedy prawdziwe snapshoty z dowodem z webinaru.
    const wbSlots = Object.values(open.slots).filter((slot) => slot.questionId.startsWith('WB-'));
    if (CONTENT_RELEASE.counts.questions > 700) expect(wbSlots.length).toBeGreaterThan(0);
    const exported = await h.repository.exportBackup({ now: '2026-11-15T21:00:00.000Z', appVersion: 'test', bankVersions: [CONTENT_RELEASE.bankVersion] });
    if (!exported.ok) throw new Error(exported.error.code);
    const other = createIndexedDbRepository({ indexedDB: new IDBFactory(), dbName: 'dme-app-webinary-kopia', storageManager: null, now: () => '2026-11-15T21:01:00.000Z' });
    const parsed = await other.parseAndValidateBackup(exported.value.text, 'dme-kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect((await other.replaceAllFromBackup(parsed.value, { now: '2026-11-15T21:01:00.000Z', safetyBackupId: 'safety-kopia', appVersion: 'test', bankVersions: [CONTENT_RELEASE.bankVersion] })).ok).toBe(true);
    const restored = await other.loadUserState();
    other.close();
    if (!restored.ok) throw new Error(restored.error.code);
    expect(restored.value.sessions).toEqual(before.sessions);
    expect(restored.value.attempts).toEqual(before.attempts);
  });

  it('błąd migracji 4 → 5 → ekran „Aktualizacja danych nie powiodła się” bez pytań; „Spróbuj ponownie” kończy migrację', async () => {
    const { factory, dbName } = await v4ProfileDb(v18ProfileData());
    const broken = createIndexedDbRepository({ indexedDB: factory, dbName, storageManager: null, migrations: createMigrations({ faultAfterStore: 'questionStats' }) });
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
    expect(h.controller.getState().boot).toMatchObject({ phase: 'fatal', code: 'MIGRATION_FAILED', canRetry: true });
    expect(h.controller.getState().catalog).toBeNull();
    useGood = true;
    await h.controller.retryBoot();
    expect(h.controller.getState().boot).toEqual({ phase: 'ready' });
    expect(userState(h.controller).sessions['sess-2']).toMatchObject({ status: 'open', bankVersion: CONTENT_RELEASE.bankVersion });
    expect(h.controller.getState().resume).toMatchObject({ sessionId: 'sess-4' });
  });
});
