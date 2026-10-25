/**
 * Migracja danych lokalnych do banku V15 (docs/MIGRACJA_V15.md): IndexedDB v1 (dane STAREJ aplikacji,
 * bank `release-2026-10-23c`) → v2 w jednej transakcji `versionchange`.
 *
 * Dane: realistyczne rekordy starej aplikacji (`legacyUserData`: ukończony test, otwarta runda powtórki ze
 * zgłoszeniem i zastępstwem, zakończony Free Flow, stan powtórek, blokady, zdarzenia, paczka pytań,
 * automatyczna kopia bezpieczeństwa ze starą treścią). Sprawdzane: brak starej treści, zachowane podsumowania,
 * przerwane sesje, powtórki/blokady tylko dla niezmienionych pytań, idempotencja, przerwanie w środku
 * (abort → baza zostaje w v1, ponowienie działa), import starej kopii, ochrona przed opóźnionym zapisem.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { chartPoints, summarizeHistory } from '../../src/domain/selectors';
import type { Session, UserState } from '../../src/domain/types';
import { APP_ID, BACKUP_FORMAT, DB_SCHEMA_VERSION } from '../../src/persistence/api';
import type { BackupData, Repository } from '../../src/persistence/api';
import { MSG_STALE_CONTENT_WRITE } from '../../src/persistence/repository';
import { createMigrationV2, MIGRATIONS } from '../../src/persistence/schema';
import { transformToV15 } from '../../src/persistence/v15Migration';
import { V15_COMPARISON, V15_UNCHANGED } from '../../src/persistence/v15Carryover';
import { BANK } from '../content';
import { freshRepository, legacyUserData, OLD_BANK_VERSION, seedChangeset, UNCHANGED_ID, UNCHANGED_ID_2 } from './fixtures';

const MIGRATED_AT = '2026-10-24T12:00:00.000Z';
const OLD_MARKERS = ['[STARA TREŚĆ', '[STARE WYJAŚNIENIE', '[STARA OPCJA', 'PACK-Q1'];

/** Baza w wersji 1 (stara aplikacja) z danymi starego banku, paczką i kopią bezpieczeństwa. */
async function legacyDb(data: BackupData & { packs: unknown[] } = legacyUserData()): Promise<{ factory: IDBFactory; dbName: string; data: BackupData & { packs: unknown[] } }> {
  const { repo, factory, dbName } = freshRepository({ schemaVersion: 1, migrations: MIGRATIONS.slice(0, 1), contentBankVersion: OLD_BANK_VERSION });
  const r = await repo.commit(seedChangeset(data));
  if (!r.ok) throw new Error(`seed: ${r.error.code}`);
  repo.close();
  const db = await rawOpen(factory, dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['packs', 'backups'], 'readwrite');
    for (const p of data.packs) tx.objectStore('packs').put(p);
    tx.objectStore('backups').put({
      id: 'safety-old',
      createdAt: '2026-10-21T19:00:00.000Z',
      reason: 'before_restore',
      fileName: 'dme-przed-wczytaniem-2026-10-21.json',
      sizeBytes: 10,
      json: JSON.stringify({ format: 'dme-backup', data: { sessions: data.sessions } }),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { factory, dbName, data };
}

function rawOpen(factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dumpAll(factory: IDBFactory, dbName: string): Promise<{ version: number; stores: Record<string, unknown[]> }> {
  const db = await rawOpen(factory, dbName);
  const names = [...db.objectStoreNames];
  const stores: Record<string, unknown[]> = {};
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(names, 'readonly');
    for (const n of names) {
      const req = tx.objectStore(n).getAll();
      req.onsuccess = () => {
        stores[n] = req.result as unknown[];
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const version = db.version;
  db.close();
  return { version, stores };
}

async function load(repo: Repository): Promise<UserState> {
  const r = await repo.loadUserState();
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

function expectNoOldContent(value: unknown): void {
  const text = JSON.stringify(value);
  for (const marker of OLD_MARKERS) expect(text, marker).not.toContain(marker);
}

describe('lista niezmienionych pytań (scripts/v15-carryover.mjs)', () => {
  it('332 z 1001 wspólnych ID; każde ID istnieje w V15 z tym samym fingerprintem i rewizją; bez treści', () => {
    expect(V15_COMPARISON).toEqual({ oldQuestions: 1097, newQuestions: 2987, commonIds: 1001, unchanged: 332, changedSameId: 669 });
    expect(V15_UNCHANGED).toHaveLength(332);
    const byId = new Map(BANK.questions.map((q) => [q.id, q]));
    for (const [id, revision, fingerprint] of V15_UNCHANGED) {
      expect(byId.get(id)?.fingerprint, id).toBe(fingerprint);
      expect(byId.get(id)?.revision, id).toBe(revision);
    }
  });
});

describe('migracja IndexedDB v1 → v2 (bank V15)', () => {
  it('sesje: ukończone i zakończone → legacy bez treści z niezmienionymi liczbami; otwarta → interrupted_by_update', async () => {
    const { factory, dbName, data } = await legacyDb();
    const before: UserState = {
      settings: data.settings[0]!,
      sessions: Object.fromEntries(data.sessions.map((s) => [s.id, s])),
      attempts: {},
      questionStats: {},
      blocks: {},
      events: {},
    };
    const historyBefore = summarizeHistory(before);
    const chartBefore = chartPoints(before, { kind: 'all' });

    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    const info = await repo.open();
    expect(info).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: 1, created: false } });
    const state = await load(repo);
    const s1 = state.sessions['sess-1'] as Session;
    const s2 = state.sessions['sess-2'] as Session;
    const s3 = state.sessions['sess-3'] as Session;

    // Ukończony test: wynik bez zmian, daty, konfiguracja, łańcuch rund — treść usunięta.
    expect(s1).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 3, passed: true, percent: 66.6 }, createdAt: '2026-10-20T08:00:00.000Z', closedAt: '2026-10-20T08:04:00.000Z', plan: [], slots: {} });
    expect(s1.legacy).toEqual({
      reason: 'bank_v15_update',
      previousBankVersion: OLD_BANK_VERSION,
      contentBankVersion: CONTENT_RELEASE.bankVersion,
      migratedAt: MIGRATED_AT,
      previousStatus: 'completed',
      answeredValid: 3,
      correct: 2,
      excluded: 0,
      planLength: 3,
    });
    // Otwarta runda powtórki: przerwana, bez wyniku, powiązanie z rodzicem zachowane.
    expect(s2).toMatchObject({ status: 'interrupted_by_update', result: null, retry: { sourceSessionId: 'sess-1', roundIndex: 2, repeatedCount: 1 }, plan: [], slots: {} });
    const oldS2 = data.sessions.find((s) => s.id === 'sess-2')!;
    const s2Correct = oldS2.slots['s2-a']?.attempt?.correct ? 1 : 0;
    expect(s2Correct).toBe(1);
    expect(s2.legacy).toMatchObject({ previousStatus: 'open', answeredValid: 1, correct: s2Correct, excluded: 1, planLength: 2 });
    expect(s2.revision).toBe(data.sessions.find((s) => s.id === 'sess-2')!.revision + 1);
    // Free Flow zakończony: podsumowanie 2 / 1.
    expect(s3).toMatchObject({ kind: 'freeflow', status: 'ended', plan: [], slots: {} });
    expect(s3.legacy).toMatchObject({ answeredValid: 2, correct: 1 });

    // Historia i wykres: te same liczby; przerwany test na liście, poza wykresem.
    const historyAfter = summarizeHistory(state);
    expect(chartPoints(state, { kind: 'all' })).toEqual(chartBefore);
    const pick = (h: typeof historyBefore) => [...h.tests, ...h.freeFlow].map((x) => ({ id: x.sessionId, answered: x.answeredValid, correct: x.correct, percent: x.percent, passed: x.passed }));
    const beforeRows = pick(historyBefore);
    const afterRows = pick(historyAfter).filter((r) => r.id !== 'sess-2');
    expect(afterRows).toEqual(beforeRows);
    expect(historyAfter.tests.find((t) => t.sessionId === 'sess-2')).toMatchObject({ status: 'interrupted_by_update', passed: null });
    repo.close();
  });

  it('brak starej treści w CAŁEJ bazie; paczki i kopie bezpieczeństwa wyczyszczone; ustawienia bez zmian; meta = V15', async () => {
    const { factory, dbName, data } = await legacyDb();
    const dumpBefore = await dumpAll(factory, dbName);
    expect(JSON.stringify(dumpBefore.stores)).toContain('[STARA TREŚĆ');
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT, appVersion: '0.2.0' });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    const dump = await dumpAll(factory, dbName);
    expect(dump.version).toBe(DB_SCHEMA_VERSION);
    expectNoOldContent(dump.stores);
    expect(dump.stores.packs).toEqual([]);
    expect(dump.stores.backups).toEqual([]);
    expect(dump.stores.settings).toEqual(data.settings);
    const meta = dump.stores.meta as { key: string }[];
    expect(meta.find((m) => m.key === 'content')).toEqual({ key: 'content', bankVersion: CONTENT_RELEASE.bankVersion, bankSha256: CONTENT_RELEASE.bankSha256, updatedAt: MIGRATED_AT, appVersion: '0.2.0' });
    expect(meta.find((m) => m.key === 'migration:bank-v15')).toMatchObject({
      migrationId: 'bank-v15',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      report: { sessionsLegacy: 3, sessionsV15: 0, sessionsInterrupted: 1, packsRemoved: 1, blocksKept: 1, blocksDeactivated: 1 },
    });
    // Żadna sesja nie ma slotów ani snapshotów.
    for (const s of dump.stores.sessions as Session[]) {
      expect(s.slots).toEqual({});
      expect(s.plan).toEqual([]);
    }
  });

  it('powtórki i dziennik prób tylko dla pytań niezmienionych; blokady: niezmienione aktywne, zmienione nieaktywne bez treści', async () => {
    const { factory, dbName } = await legacyDb();
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    const state = await load(repo);
    expect(Object.keys(state.questionStats).sort()).toEqual([UNCHANGED_ID, UNCHANGED_ID_2].sort());
    // Aktywny błąd pytania niezmienionego zostaje (Moje błędy), zmienionego — usunięty.
    expect(state.questionStats[UNCHANGED_ID_2]).toMatchObject({ activeError: true, streak: 1, lastWrongSessionId: 'sess-1' });
    expect(Object.values(state.attempts).every((a) => a.questionId === UNCHANGED_ID || a.questionId === UNCHANGED_ID_2)).toBe(true);
    expect(Object.values(state.attempts)).toHaveLength(3);
    const blocks = Object.values(state.blocks);
    const keep = blocks.find((b) => b.id === 'block-keep');
    const changed = blocks.find((b) => b.id === 'block-1');
    expect(keep).toMatchObject({ questionId: UNCHANGED_ID, revokedAt: null });
    expect(keep?.inactiveReason ?? null).toBeNull();
    expect(changed).toMatchObject({ stemPreview: '', revokedAt: MIGRATED_AT, inactiveReason: 'bank_version_changed' });
    // Zdarzenia (bez treści) zachowane.
    expect(Object.keys(state.events).length).toBeGreaterThan(0);
    repo.close();
  });

  it('otwarty Free Flow → interrupted_by_update', async () => {
    const data = legacyUserData();
    data.sessions = data.sessions.map((s) =>
      s.id === 'sess-2' ? { ...s, status: 'unfinished', closedAt: s.updatedAt } : s.id === 'sess-3' ? { ...s, status: 'open', closedAt: null } : s,
    );
    const { factory, dbName } = await legacyDb(data);
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    const state = await load(repo);
    expect(state.sessions['sess-3']).toMatchObject({ kind: 'freeflow', status: 'interrupted_by_update', result: null, plan: [], slots: {} });
    expect(state.sessions['sess-2']).toMatchObject({ status: 'unfinished', plan: [] });
    expect(Object.values(state.sessions).some((s) => s.status === 'open')).toBe(false);
    repo.close();
  });

  it('idempotencja: ponowne otwarcie i ponowna transformacja nie zmieniają wyniku', async () => {
    const { factory, dbName } = await legacyDb();
    const first = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT }).repo;
    const a = await load(first);
    first.close();
    const second = freshRepository({ indexedDB: factory, dbName, now: () => '2026-12-01T00:00:00.000Z' }).repo;
    expect(await second.open()).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: null, created: false } });
    const b = await load(second);
    expect(b).toEqual(a);
    second.close();
    const again = transformToV15(
      { sessions: Object.values(a.sessions), attempts: Object.values(a.attempts), questionStats: Object.values(a.questionStats), blocks: Object.values(a.blocks), events: Object.values(a.events) },
      '2026-12-02T00:00:00.000Z',
    );
    expect(Object.fromEntries(again.sessions.map((s) => [s.id, s]))).toEqual(a.sessions);
    expect(Object.fromEntries(again.questionStats.map((s) => [s.questionId, s]))).toEqual(a.questionStats);
    expect(Object.fromEntries(again.blocks.map((s) => [s.id, s]))).toEqual(a.blocks);
    expect(Object.fromEntries(again.attempts.map((s) => [s.id, s]))).toEqual(a.attempts);
  });

  it.each(['sessions', 'attempts', 'questionStats', 'blocks'] as const)('przerwanie w środku (po magazynie %s) → MigrationFailed, baza zostaje w v1 bez zmian; ponowienie działa', async (store) => {
    const { factory, dbName } = await legacyDb();
    const before = await dumpAll(factory, dbName);
    const { repo: failing } = freshRepository({ indexedDB: factory, dbName, migrations: [MIGRATIONS[0]!, createMigrationV2({ faultAfterStore: store })] });
    const info = await failing.open();
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.error.code).toBe('MigrationFailed');
    failing.close();
    const after = await dumpAll(factory, dbName);
    expect(after.version).toBe(1);
    expect(after.stores).toEqual(before.stores);
    // Ponowienie (zwykła migracja) kończy aktualizację.
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    const done = await dumpAll(factory, dbName);
    expect(done.version).toBe(DB_SCHEMA_VERSION);
    expectNoOldContent(done.stores);
  });

  it('nowa baza (pierwsze uruchomienie): v0 → bieżąca wersja, rekord treści V15', async () => {
    const { repo, factory, dbName } = freshRepository({ now: () => MIGRATED_AT });
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: null, created: true } });
    const meta = await repo.readContentMeta();
    expect(meta.ok && meta.value.content?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    repo.close();
    expect((await dumpAll(factory, dbName)).version).toBe(DB_SCHEMA_VERSION);
  });
});

describe('import starszej kopii danych (dme-backup v1 sprzed migracji / ze starej aplikacji)', () => {
  function oldBackupText(): string {
    const data = legacyUserData();
    return JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, appId: APP_ID, exportedAt: '2026-10-22T20:00:00.000Z', appVersion: '0.1.0', bankVersions: [OLD_BANK_VERSION, 'pula-stara-1'], data });
  }

  it('walidacja przekształca kopię: bez starej treści, sesja otwarta → przerwana, paczki odrzucone', async () => {
    const { repo } = freshRepository({ now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(oldBackupText(), 'dme-kopia-2026-10-22.json');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expectNoOldContent(parsed.value.backup);
    expect(parsed.value.backup.data.packs).toEqual([]);
    expect(parsed.value.summary).toMatchObject({ completedTests: 1, openSessions: 0, legacySessions: 3, interruptedSessions: 1, packsDropped: 1, packs: 0 });
    // Zamiana danych: baza bez starej treści; ponowny eksport również.
    const replaced = await repo.replaceAllFromBackup(parsed.value, { now: MIGRATED_AT, safetyBackupId: 'safety-1', appVersion: 'test', bankVersions: [CONTENT_RELEASE.bankVersion] });
    expect(replaced.ok).toBe(true);
    const state = await load(repo);
    expectNoOldContent(state);
    expect(state.sessions['sess-2']?.status).toBe('interrupted_by_update');
    const exported = await repo.exportBackup({ now: MIGRATED_AT, appVersion: 'test', bankVersions: [CONTENT_RELEASE.bankVersion] });
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expectNoOldContent(JSON.parse(exported.value.text));
      expect((JSON.parse(exported.value.text) as { data: { packs: unknown[] } }).data.packs).toEqual([]);
    }
    repo.close();
  });

  it('kopia zapisana po migracji wczytuje się bez zmian (idempotencja)', async () => {
    const { factory, dbName } = await legacyDb();
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    const state = await load(repo);
    const exported = await repo.exportBackup({ now: MIGRATED_AT, appVersion: 'test', bankVersions: [CONTENT_RELEASE.bankVersion] });
    if (!exported.ok) throw new Error(exported.error.code);
    const { repo: other } = freshRepository({ now: () => '2026-12-01T00:00:00.000Z' });
    const parsed = await other.parseAndValidateBackup(exported.value.text, 'kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect((await other.replaceAllFromBackup(parsed.value, { now: '2026-12-01T00:00:00.000Z', safetyBackupId: 's', appVersion: 't', bankVersions: [] })).ok).toBe(true);
    expect(await load(other)).toEqual(state);
    repo.close();
    other.close();
  });
});

describe('ochrona przed opóźnionymi zapisami (sesja innej wersji treści)', () => {
  it('zapis sesji starego banku (nie-legacy) jest odrzucany; sesja legacy z treścią albo otwarta — też', async () => {
    const { repo } = freshRepository();
    const old = legacyUserData().sessions[0] as Session;
    const r1 = await repo.commit({ commandId: 'late', guards: [], stores: { sessions: { put: [old], delete: [] } } });
    expect(r1).toMatchObject({ ok: false, error: { code: 'WriteFailed', messagePl: MSG_STALE_CONTENT_WRITE } });
    const legacyWithContent = { ...old, legacy: { reason: 'bank_v15_update', previousBankVersion: OLD_BANK_VERSION, contentBankVersion: CONTENT_RELEASE.bankVersion, migratedAt: MIGRATED_AT, previousStatus: 'completed', answeredValid: 0, correct: 0, excluded: 0, planLength: 0 } } as Session;
    expect((await repo.commit({ commandId: 'late2', guards: [], stores: { sessions: { put: [legacyWithContent], delete: [] } } })).ok).toBe(false);
    const v15 = { ...old, bankVersion: CONTENT_RELEASE.bankVersion };
    // Sesja z wersją V15, ale snapshotem starej treści — też odrzucona.
    expect((await repo.commit({ commandId: 'late3', guards: [], stores: { sessions: { put: [v15], delete: [] } } })).ok).toBe(false);
    expect(Object.keys((await load(repo)).sessions)).toEqual([]);
    repo.close();
  });

  it('stara aplikacja (schemat v1) po migracji nie otworzy bazy (VersionError → komunikat o nowszej wersji)', async () => {
    const { factory, dbName } = await legacyDb();
    const { repo } = freshRepository({ indexedDB: factory, dbName });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    const { repo: oldApp } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 1, migrations: MIGRATIONS.slice(0, 1), contentBankVersion: OLD_BANK_VERSION });
    const opened = await oldApp.open();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe('Unavailable');
  });

  it('otwarte połączenie starej karty dostaje versionchange i jest zamykane — jego kolejne zapisy nie trafiają do bazy', async () => {
    const { factory, dbName, data } = await legacyDb();
    const { repo: oldTab } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 1, migrations: MIGRATIONS.slice(0, 1), contentBankVersion: OLD_BANK_VERSION });
    expect((await oldTab.open()).ok).toBe(true);
    const { repo: fresh } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    expect((await fresh.open()).ok).toBe(true);
    // Opóźniony zapis starej karty (otwarta sesja ze starą treścią).
    const late = await oldTab.commit({ commandId: 'late', guards: [], stores: { sessions: { put: [data.sessions[1] as Session], delete: [] } } });
    expect(late.ok).toBe(false);
    const state = await load(fresh);
    expect(state.sessions['sess-2']?.status).toBe('interrupted_by_update');
    expectNoOldContent(state);
    fresh.close();
  });
});
