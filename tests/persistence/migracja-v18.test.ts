/**
 * Migracja danych lokalnych do banku V18 (docs/MIGRACJA_V18.md): allowlista paczki (700 ID: 600 V16 + 100 V17)
 * jest jedyną podstawą decyzji. Każdy profil ma własną bazę IndexedDB; migracja v3 → v4 w jednej transakcji
 * `versionchange` (także v1 → v4 dla danych sprzed V15).
 *
 * D — profile z V15/starszymi ID, z V16, z V17 i dane mieszane: V16/V17 zgodne z paczką zostają aktywne,
 *     dawne treści nie wracają; E — rozdzielenie profili, import kopii, zachowanie wyników liczbowych.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { chartPoints, summarizeHistory } from '../../src/domain/selectors';
import type { Session, UserState } from '../../src/domain/types';
import { APP_ID, BACKUP_FORMAT, DB_SCHEMA_VERSION } from '../../src/persistence/api';
import type { BackupData, Repository } from '../../src/persistence/api';
import { BANK_MIGRATION_ID, transformToCurrentBank } from '../../src/persistence/bankMigration';
import { MSG_STALE_CONTENT_WRITE } from '../../src/persistence/repository';
import { createMigrationV4, MIGRATIONS } from '../../src/persistence/schema';
import { RETIRED_IDS } from '../content';
import {
  alteredQuestion,
  bankQuestion,
  freshRepository,
  OLD_MARKERS,
  PRE_V15_BANK_VERSION,
  profileData,
  retiredQuestion,
  seedChangeset,
  V15_BANK_VERSION,
  V16_BANK_VERSION,
  V17_BANK_VERSION,
  v15Ids,
  v15ProfileData,
} from './fixtures';

const MIGRATED_AT = '2026-11-09T21:00:00.000Z';
const V18 = CONTENT_RELEASE.bankVersion;

function expectNoOldContent(value: unknown): void {
  const text = JSON.stringify(value);
  for (const marker of OLD_MARKERS) expect(text, marker).not.toContain(marker);
}

function transform(data: BackupData) {
  return transformToCurrentBank(
    { sessions: data.sessions, attempts: data.attempts, questionStats: data.questionStats, blocks: data.blocks, events: data.events, packs: data.packs },
    MIGRATED_AT,
  );
}

const byId = <T extends { id: string }>(list: readonly T[]): Record<string, T> => Object.fromEntries(list.map((x) => [x.id, x]));

function stateOf(data: BackupData): UserState {
  return {
    settings: data.settings[0]!,
    sessions: byId(data.sessions),
    attempts: byId(data.attempts),
    questionStats: Object.fromEntries(data.questionStats.map((s) => [s.questionId, s])),
    blocks: byId(data.blocks),
    events: byId(data.events),
  };
}

/** Baza profilu w wersji `schemaVersion` (3 = aplikacja V15 z profilami, 1 = sprzed V15) z danymi i kopią bezpieczeństwa. */
async function profileDb(
  data: BackupData & { packs?: unknown[] },
  options: { schemaVersion?: number; contentBankVersion?: string; factory?: IDBFactory; dbName?: string } = {},
): Promise<{ factory: IDBFactory; dbName: string }> {
  const schemaVersion = options.schemaVersion ?? 3;
  const env = freshRepository({
    indexedDB: options.factory,
    dbName: options.dbName,
    schemaVersion,
    migrations: MIGRATIONS.slice(0, schemaVersion),
    contentBankVersion: options.contentBankVersion ?? data.sessions[0]?.bankVersion ?? V15_BANK_VERSION,
  });
  const r = await env.repo.commit(seedChangeset(data));
  if (!r.ok) throw new Error(`seed: ${r.error.code}`);
  env.repo.close();
  const db = await rawOpen(env.factory, env.dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['packs', 'backups'], 'readwrite');
    for (const p of data.packs ?? []) tx.objectStore('packs').put(p);
    tx.objectStore('backups').put({
      id: 'safety-old',
      createdAt: '2026-11-01T19:00:00.000Z',
      reason: 'before_restore',
      fileName: 'dme-przed-wczytaniem-2026-11-01.json',
      sizeBytes: 10,
      json: JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 2, appId: APP_ID, exportedAt: '2026-11-01T19:00:00.000Z', appVersion: '0.1.0', bankVersions: [V15_BANK_VERSION], profileEmail: null, data }),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { factory: env.factory, dbName: env.dbName };
}

function rawOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
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

const v15Profile = () => v15ProfileData(RETIRED_IDS);
const v16Profile = () => profileData(V16_BANK_VERSION, (_i, q) => q);
const v17Profile = () => profileData(V17_BANK_VERSION, (i) => bankQuestion(`V17-00${i + 1}`));
/** Sesje mieszane: q2, q4 i q7 to pytania spoza allowlisty (V15), reszta V16 zgodna z paczką. */
const MIXED_RETIRED = new Set([1, 3, 6]);
const mixedProfile = () => {
  const ids = v15Ids(RETIRED_IDS);
  return profileData(V16_BANK_VERSION, (i, q) => (MIXED_RETIRED.has(i) ? retiredQuestion(ids[i]!) : q));
};

describe('D — transformacja profilu do banku V18 (allowlista paczki)', () => {
  it('profil V15: zostają daty i wyniki liczbowe; treść, próby, powtórki i aktywne blokady pytań spoza allowlisty — usunięte', () => {
    const data = v15Profile();
    const before = stateOf(data);
    const t = transform(data);
    const s = byId(t.sessions);
    expect(s['sess-1']).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 3, passed: true, percent: 66.6 }, createdAt: '2026-10-20T08:00:00.000Z', plan: [], slots: {} });
    expect(s['sess-1']!.legacy).toEqual({
      reason: 'bank_v18_update',
      previousBankVersion: V15_BANK_VERSION,
      contentBankVersion: V18,
      migratedAt: MIGRATED_AT,
      previousStatus: 'completed',
      answeredValid: 3,
      correct: 2,
      excluded: 0,
      planLength: 3,
    });
    // Otwarta sesja z wycofanymi pytaniami: nie da się jej wznowić z dawną treścią.
    expect(s['sess-2']).toMatchObject({ status: 'interrupted_by_update', result: null, plan: [], slots: {}, retry: { sourceSessionId: 'sess-1' } });
    expect(s['sess-3']!.legacy).toMatchObject({ answeredValid: 2, correct: 1 });
    expect(t.attempts).toEqual([]);
    expect(t.questionStats).toEqual([]);
    expect(t.blocks.every((b) => b.revokedAt !== null && b.inactiveReason === 'bank_version_changed' && b.stemPreview === '')).toBe(true);
    expect(t.events).toHaveLength(data.events.length);
    expectNoOldContent(t);
    // Historia i wykres: te same liczby ukończonych sesji.
    const after: UserState = { ...before, sessions: byId(t.sessions), attempts: {}, questionStats: {}, blocks: byId(t.blocks) };
    expect(chartPoints(after, { kind: 'all' })).toEqual(chartPoints(before, { kind: 'all' }));
    const rows = (st: UserState) => [...summarizeHistory(st).tests, ...summarizeHistory(st).freeFlow].filter((r) => r.sessionId !== 'sess-2').map((r) => [r.sessionId, r.answeredValid, r.correct, r.percent, r.passed]);
    expect(rows(after)).toEqual(rows(before));
    expect(t.report).toMatchObject({ migrationId: BANK_MIGRATION_ID, contentBankVersion: V18, sessionsCurrent: 0, sessionsLegacy: 3, sessionsInterrupted: 1, attemptsKept: 0, questionStatsKept: 0, blocksKept: 0, packsRemoved: 1 });
  });

  it.each([
    ['V16', v16Profile, V16_BANK_VERSION],
    ['V17', v17Profile, V17_BANK_VERSION],
  ] as const)('profil %s zgodny z paczką: sesje, odpowiedzi, powtórki i zgłoszenia zostają (otwarta sesja dalej wznawialna)', (_label, make, version) => {
    const data = make();
    expect(data.sessions.every((x) => x.bankVersion === version)).toBe(true);
    const t = transform(data);
    const s = byId(t.sessions);
    for (const original of data.sessions) {
      const migrated = s[original.id]!;
      expect(migrated.legacy ?? null).toBeNull();
      expect(migrated.status).toBe(original.status);
      expect(migrated.bankVersion).toBe(V18);
      expect(migrated.plan).toEqual(original.plan);
      expect(Object.values(migrated.slots).every((slot) => slot.snapshot.bankVersion === V18)).toBe(true);
      // Treść snapshotów bez zmian (tylko wersja banku).
      const strip = (x: Session) => Object.values(x.slots).map((slot) => ({ ...slot, snapshot: { ...slot.snapshot, bankVersion: '' } }));
      expect(strip(migrated)).toEqual(strip(original));
      expect(migrated.result).toEqual(original.result);
      expect(migrated.revision).toBe(original.revision + 1);
    }
    expect(s['sess-2']!.status).toBe('open');
    expect(t.attempts).toHaveLength(data.attempts.length);
    expect(t.questionStats).toEqual(data.questionStats);
    expect(t.blocks).toEqual(data.blocks);
    expect(t.report).toMatchObject({ sessionsCurrent: 3, sessionsRestamped: 3, sessionsLegacy: 0, attemptsRemoved: 0, questionStatsReset: 0, blocksDeactivated: 0 });
  });

  it('sesje mieszane (V16 + V15): wynik liczbowy zostaje, sesji nie wznawiamy; postępy V16 zachowane, V15 usunięte', () => {
    const data = mixedProfile();
    const t = transform(data);
    const s = byId(t.sessions);
    expect(s['sess-1']).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 3 }, plan: [], slots: {} });
    expect(s['sess-1']!.legacy).toMatchObject({ reason: 'bank_v18_update', previousBankVersion: V16_BANK_VERSION, answeredValid: 3, correct: 2 });
    expect(s['sess-2']!.status).toBe('interrupted_by_update');
    expect(s['sess-3']!.legacy).toMatchObject({ answeredValid: 2, correct: 1 });
    const allowedIds = ['V16-ANAT-001', 'V16-ANAT-003', 'V16-ANAT-006'];
    expect(t.questionStats.map((x) => x.questionId).sort()).toEqual(allowedIds);
    expect([...new Set(t.attempts.map((a) => a.questionId))].sort()).toEqual(allowedIds);
    expect(t.attempts).toHaveLength(3);
    // Zgłoszenie pytania spoza allowlisty (q4) — nieaktywne i bez treści.
    expect(t.blocks[0]).toMatchObject({ id: 'block-1', stemPreview: '', inactiveReason: 'bank_version_changed' });
    expectNoOldContent(t);
  });

  it('ID z allowlisty, ale inna treść/rewizja niż w paczce: bez przenoszenia postępów (nie zgadujemy po podobieństwie)', () => {
    const data = profileData(V16_BANK_VERSION, (i, q) => (i === 0 ? alteredQuestion(q.id) : q));
    const t = transform(data);
    const s = byId(t.sessions);
    expect(s['sess-1']!.legacy).toMatchObject({ answeredValid: 3, correct: 2 });
    expect(t.questionStats.some((x) => x.questionId === 'V16-ANAT-001')).toBe(false);
    expect(t.attempts.some((a) => a.questionId === 'V16-ANAT-001')).toBe(false);
    // Sesja Free Flow bez zmienionego pytania zostaje aktywna.
    expect(s['sess-3']!.legacy ?? null).toBeNull();
    expect(s['sess-3']!.bankVersion).toBe(V18);
    expectNoOldContent(t);
  });

  it('ID nieznane (ani w allowliście, ani na liście wycofanych) traktowane jak niedozwolone', () => {
    const unknown = ['XX-NIEZNANE-1', 'XX-NIEZNANE-2', 'XX-NIEZNANE-3', 'XX-NIEZNANE-4', 'XX-NIEZNANE-5', 'XX-NIEZNANE-6', 'XX-NIEZNANE-7'];
    expect(unknown.some((id) => RETIRED_IDS.includes(id))).toBe(false);
    const t = transform(profileData(V16_BANK_VERSION, (i) => retiredQuestion(unknown[i]!)));
    expect(t.sessions.every((x) => x.legacy)).toBe(true);
    expect(t.attempts).toEqual([]);
    expect(t.questionStats).toEqual([]);
    expectNoOldContent(t);
  });

  it('idempotencja: ponowna transformacja wyniku nic nie zmienia (V15, V16, mieszane); sesje legacy V15 zostają', () => {
    for (const data of [v15Profile(), v16Profile(), mixedProfile()]) {
      const a = transform(data);
      const b = transformToCurrentBank({ sessions: a.sessions, attempts: a.attempts, questionStats: a.questionStats, blocks: a.blocks, events: a.events }, '2026-12-01T00:00:00.000Z');
      expect(b.sessions).toEqual(a.sessions);
      expect(b.attempts).toEqual(a.attempts);
      expect(b.questionStats).toEqual(a.questionStats);
      expect(b.blocks).toEqual(a.blocks);
    }
    const legacyV15 = { ...v15Profile().sessions[0]!, plan: [], slots: {}, reached: 0, awaitingReplacement: [], legacy: { reason: 'bank_v15_update', previousBankVersion: PRE_V15_BANK_VERSION, contentBankVersion: V15_BANK_VERSION, migratedAt: '2026-10-24T12:00:00.000Z', previousStatus: 'completed', answeredValid: 3, correct: 2, excluded: 0, planLength: 3 } } as Session;
    const t = transformToCurrentBank({ sessions: [legacyV15], attempts: [], questionStats: [], blocks: [], events: [] }, MIGRATED_AT);
    expect(t.sessions).toEqual([legacyV15]);
  });
});

describe('D/E — migracja IndexedDB v3 → v4 (każdy profil osobno)', () => {
  it('profil V15: brak dawnej treści w CAŁEJ bazie (także w kopiach bezpieczeństwa); wyniki liczbowe zostają; meta = V18', async () => {
    const data = v15Profile();
    data.settings = [{ ...data.settings[0]!, lastTestConfig: { scope: 'SKIN', difficulty: 'advanced', targetN: 30, myErrorsPriority: false }, lastFreeFlowConfig: { scope: 'ALL', difficulty: 'basic', targetN: null, myErrorsPriority: true } }];
    const { factory, dbName } = await profileDb(data);
    expect(JSON.stringify((await dumpAll(factory, dbName)).stores)).toContain('[DAWNA TREŚĆ');
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT, appVersion: '0.2.0' });
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: 3, created: false } });
    const state = await load(repo);
    repo.close();
    expect(DB_SCHEMA_VERSION).toBe(4);
    expect(state.sessions['sess-1']).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 3, passed: true } });
    const dump = await dumpAll(factory, dbName);
    expect(dump.version).toBe(4);
    expectNoOldContent(dump.stores);
    expect(dump.stores.packs).toEqual([]);
    // Kopia bezpieczeństwa zostaje, ale jej dane przeszły tę samą transformację (liczby bez treści).
    const backups = dump.stores.backups as { id: string; json: string }[];
    expect(backups.map((b) => b.id)).toEqual(['safety-old']);
    const inner = JSON.parse(backups[0]!.json) as { data: BackupData };
    expect(inner.data.sessions.find((x) => x.id === 'sess-1')).toMatchObject({ result: { correct: 2, targetN: 3 }, legacy: { reason: 'bank_v18_update' } });
    // Stare filtry trudności wyczyszczone (cała pula); zakres i pozostałe ustawienia bez zmian.
    expect(dump.stores.settings).toEqual([{ ...data.settings[0]!, lastTestConfig: { scope: 'SKIN', difficulty: 'mixed', targetN: 30, myErrorsPriority: false }, lastFreeFlowConfig: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: true } }]);
    const meta = dump.stores.meta as { key: string }[];
    expect(meta.find((m) => m.key === 'content')).toEqual({ key: 'content', bankVersion: V18, bankSha256: CONTENT_RELEASE.bankSha256, updatedAt: MIGRATED_AT, appVersion: '0.2.0' });
    expect(meta.find((m) => m.key === `migration:${BANK_MIGRATION_ID}`)).toMatchObject({ migrationId: 'bank-v18', fromSchemaVersion: 3, toSchemaVersion: 4, report: { sessionsLegacy: 3, backupsTransformed: 1 } });
  });

  it('dane sprzed V15 (schemat 1) → v4 w jednej aktualizacji, bez dawnej treści', async () => {
    const data = profileData(PRE_V15_BANK_VERSION, (i) => retiredQuestion(`ANAT-Q00${i + 1}`));
    const { factory, dbName } = await profileDb({ ...data, packs: [] }, { schemaVersion: 1, contentBankVersion: PRE_V15_BANK_VERSION });
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: 4, migratedFrom: 1, created: false } });
    const state = await load(repo);
    repo.close();
    expect(state.sessions['sess-1']).toMatchObject({ result: { correct: 2, targetN: 3 }, legacy: { previousBankVersion: PRE_V15_BANK_VERSION } });
    expectNoOldContent((await dumpAll(factory, dbName)).stores);
  });

  it('profil V16 i V17: po migracji można dokończyć otwartą sesję i zapisać nowy postęp (wersja V18)', async () => {
    for (const make of [v16Profile, v17Profile]) {
      const { factory, dbName } = await profileDb(make());
      const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
      const state = await load(repo);
      const open = state.sessions['sess-2']!;
      expect(open).toMatchObject({ status: 'open', bankVersion: V18 });
      expect(Object.keys(state.questionStats)).toHaveLength(5);
      const write = await repo.commit({ commandId: 'after', guards: [], stores: { sessions: { put: [{ ...open, revision: open.revision + 1, updatedAt: MIGRATED_AT }], delete: [] } } });
      expect(write.ok).toBe(true);
      repo.close();
    }
  });

  it.each(['sessions', 'attempts', 'questionStats', 'blocks'] as const)('przerwanie migracji (po magazynie %s) → baza zostaje w v3 bez zmian; ponowienie działa', async (store) => {
    const { factory, dbName } = await profileDb(v15Profile());
    const before = await dumpAll(factory, dbName);
    const { repo: failing } = freshRepository({ indexedDB: factory, dbName, migrations: [...MIGRATIONS.slice(0, 3), createMigrationV4({ faultAfterStore: store })] });
    const info = await failing.open();
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.error.code).toBe('MigrationFailed');
    failing.close();
    const after = await dumpAll(factory, dbName);
    expect(after.version).toBe(3);
    expect(after.stores).toEqual(before.stores);
    const { repo } = freshRepository({ indexedDB: factory, dbName, now: () => MIGRATED_AT });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    expectNoOldContent((await dumpAll(factory, dbName)).stores);
  });

  it('E — dwa profile: migracja jednego nie zmienia drugiego; dane się nie mieszają', async () => {
    const a = await profileDb(v15Profile(), { dbName: 'dme-profil-a' });
    const b = await profileDb(v16Profile(), { factory: a.factory, dbName: 'dme-profil-b' });
    const bBefore = await dumpAll(b.factory, b.dbName);
    const { repo: ra } = freshRepository({ indexedDB: a.factory, dbName: a.dbName, now: () => MIGRATED_AT });
    const stateA = await load(ra);
    ra.close();
    // Profil B nietknięty do chwili własnego otwarcia.
    expect(await dumpAll(b.factory, b.dbName)).toEqual(bBefore);
    const { repo: rb } = freshRepository({ indexedDB: b.factory, dbName: b.dbName, now: () => MIGRATED_AT });
    const stateB = await load(rb);
    rb.close();
    expect(Object.keys(stateA.questionStats)).toEqual([]);
    expect(Object.keys(stateB.questionStats)).toHaveLength(5);
    expect(Object.values(stateA.sessions).every((s) => s.legacy)).toBe(true);
    expect(Object.values(stateB.sessions).every((s) => !s.legacy)).toBe(true);
    expect(JSON.stringify(stateA)).not.toContain('V16-ANAT-001');
  });

  it('opóźniony zapis karty ze starym kodem (sesja innej wersji banku) jest odrzucany', async () => {
    const { repo } = freshRepository();
    const old = v15Profile().sessions[1] as Session;
    const r = await repo.commit({ commandId: 'late', guards: [], stores: { sessions: { put: [old], delete: [] } } });
    expect(r).toMatchObject({ ok: false, error: { code: 'WriteFailed', messagePl: MSG_STALE_CONTENT_WRITE } });
    repo.close();
  });
});

describe('E — import kopii stosuje tę samą allowlistę', () => {
  const backupText = (data: BackupData & { packs?: unknown[] }) =>
    JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, appId: APP_ID, exportedAt: '2026-11-08T20:00:00.000Z', appVersion: '0.1.0', bankVersions: [data.sessions[0]!.bankVersion], data: { ...data, packs: data.packs ?? [] } });

  it('kopia V15: bez dawnej treści, wyniki liczbowe zostają, paczki odrzucone; eksport też bez dawnej treści', async () => {
    const { repo } = freshRepository({ now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(v15Profile()), 'dme-kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expectNoOldContent(parsed.value.backup);
    expect(parsed.value.summary).toMatchObject({ completedTests: 1, legacySessions: 3, interruptedSessions: 1, packsDropped: 1 });
    expect((await repo.replaceAllFromBackup(parsed.value, { now: MIGRATED_AT, safetyBackupId: 'safety-1', appVersion: 'test', bankVersions: [V18] })).ok).toBe(true);
    const state = await load(repo);
    expect(state.sessions['sess-1']).toMatchObject({ result: { correct: 2, targetN: 3, passed: true } });
    expectNoOldContent(state);
    const exported = await repo.exportBackup({ now: MIGRATED_AT, appVersion: 'test', bankVersions: [V18] });
    if (!exported.ok) throw new Error(exported.error.code);
    expectNoOldContent(JSON.parse(exported.value.text));
    repo.close();
  });

  it('kopia mieszana: zgodne V16 zostają aktywne, niedozwolone ID tracą treść', async () => {
    const { repo } = freshRepository({ now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(mixedProfile()), 'dme-kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expectNoOldContent(parsed.value.backup);
    expect(parsed.value.backup.data.questionStats.map((s) => s.questionId).sort()).toEqual(['V16-ANAT-001', 'V16-ANAT-003', 'V16-ANAT-006']);
    repo.close();
  });

  it('kopia V17 zgodna z paczką: sesje aktywne w wersji V18; ponowne wczytanie eksportu bez zmian', async () => {
    const { repo } = freshRepository({ now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(v17Profile()), 'dme-kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.value.backup.data.sessions.every((s) => s.bankVersion === V18 && !s.legacy)).toBe(true);
    expect((await repo.replaceAllFromBackup(parsed.value, { now: MIGRATED_AT, safetyBackupId: 's1', appVersion: 't', bankVersions: [V18] })).ok).toBe(true);
    const state = await load(repo);
    const exported = await repo.exportBackup({ now: MIGRATED_AT, appVersion: 't', bankVersions: [V18] });
    if (!exported.ok) throw new Error(exported.error.code);
    const { repo: other } = freshRepository({ now: () => '2026-12-01T00:00:00.000Z' });
    const again = await other.parseAndValidateBackup(exported.value.text, 'kopia.json');
    if (!again.ok) throw new Error(JSON.stringify(again.error));
    expect((await other.replaceAllFromBackup(again.value, { now: '2026-12-01T00:00:00.000Z', safetyBackupId: 's2', appVersion: 't', bankVersions: [] })).ok).toBe(true);
    expect(await load(other)).toEqual(state);
    repo.close();
    other.close();
  });
});
