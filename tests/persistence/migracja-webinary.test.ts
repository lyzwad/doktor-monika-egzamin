/**
 * Migracja danych profili do wydania „V18 + webinary” (spec-webinary-247, historia 2): IndexedDB v4 → v5,
 * ta sama transformacja co v4 sparametryzowana wydaniem docelowym (`BankTarget`). Prawdziwe przejście
 * V18 → nowa wersja sprawdzamy na syntetycznym wydaniu „V18 + 2 WB” (`SYNTH_TARGET`), bo w tej gałęzi
 * `CONTENT_RELEASE` to jeszcze V18; domyślne parametry = bieżące wydanie + allowlista + poprzednik V18.
 *
 * Macierz: V18 → wydanie (wszystkie sesje aktywne), pusta sesja nie-poprzednika, niezgodny snapshot V18,
 * sesje `legacy` bez zmian, idempotencja, przerwanie (atomowość), v1/v3 → v5, kopia z V18, kopia z polami webinaru.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { answer, finishTest, nextFreeFlowSlot } from '../../src/domain/sessions';
import type { CommandContext, IdKind, QuestionStat, Session, UserState } from '../../src/domain/types';
import { APP_ID, BACKUP_FORMAT, DB_SCHEMA_VERSION } from '../../src/persistence/api';
import type { BackupData, Repository } from '../../src/persistence/api';
import {
  BANK_MIGRATION_ID,
  BANK_MIGRATION_ID_V18,
  CURRENT_BANK_TARGET,
  transformToCurrentBank,
  V18_BANK_VERSION as SRC_V18_BANK_VERSION,
} from '../../src/persistence/bankMigration';
import type { BankTarget } from '../../src/persistence/bankMigration';
import { createMigrations, createMigrationV5, MIGRATIONS } from '../../src/persistence/schema';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { RETIRED_IDS } from '../content';
import {
  alteredQuestion,
  BANK,
  freshRepository,
  OLD_MARKERS,
  PRE_V15_BANK_VERSION,
  profileData,
  retiredQuestion,
  seedChangeset,
  SYNTH_BANK_SHA256,
  SYNTH_BANK_VERSION,
  SYNTH_TARGET,
  SYNTH_WB_IDS,
  synthCatalog,
  V15_BANK_VERSION,
  V16_BANK_VERSION,
  V17_BANK_VERSION,
  V18_BANK_VERSION,
  V18_ROWS,
  v15ProfileData,
  v18LegacySessions,
  v18ProfileData,
  webinarProfileData,
} from './fixtures';

const MIGRATED_AT = '2026-11-15T21:00:00.000Z';

/* ========================================================================== */
/* Pomocnicze                                                                 */
/* ========================================================================== */

function transform(data: BackupData, target: BankTarget = SYNTH_TARGET, now = MIGRATED_AT) {
  return transformToCurrentBank(
    { sessions: data.sessions, attempts: data.attempts, questionStats: data.questionStats, blocks: data.blocks, events: data.events, packs: data.packs },
    now,
    target,
  );
}

const byId = <T extends { id: string }>(list: readonly T[]): Record<string, T> => Object.fromEntries(list.map((x) => [x.id, x]));
const sortById = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

function expectNoOldContent(value: unknown): void {
  const text = JSON.stringify(value);
  for (const marker of OLD_MARKERS) expect(text, marker).not.toContain(marker);
}

/** Snapshoty sesji bez wersji banku (treść pytań musi zostać bez zmian). */
const contentOf = (s: Session) => Object.values(s.slots).map((slot) => ({ ...slot, snapshot: { ...slot.snapshot, bankVersion: '' } }));

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

/** Rekordy `meta` zapisane w bazie v4 przez aplikację V18 (migracja `bank-v18`). */
const V18_CONTENT_META = {
  key: 'content',
  bankVersion: V18_BANK_VERSION,
  bankSha256: '5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6',
  updatedAt: '2026-11-09T21:00:00.000Z',
  appVersion: '0.1.0',
};
const V18_MIGRATION_META = {
  key: 'migration:bank-v18',
  migrationId: 'bank-v18',
  fromSchemaVersion: 3,
  toSchemaVersion: 4,
  appVersion: '0.1.0',
  report: { migrationId: 'bank-v18', contentBankVersion: V18_BANK_VERSION, at: '2026-11-09T21:00:00.000Z', sessionsCurrent: 0, sessionsRestamped: 0, sessionsLegacy: 2, sessionsInterrupted: 1, attemptsKept: 0, attemptsRemoved: 0, questionStatsKept: 0, questionStatsReset: 0, blocksKept: 0, blocksDeactivated: 0, packsRemoved: 0, backupsTransformed: 0, backupsRemoved: 0, malformedDropped: 0 },
};

/**
 * Baza profilu w wersji `schemaVersion` (4 = aplikacja V18, 3 = V15 z profilami, 1 = sprzed V15) z danymi
 * i automatyczną kopią bezpieczeństwa; baza v4 ma też rekordy `meta` migracji V18.
 */
async function profileDb(
  data: BackupData & { packs?: unknown[] },
  options: { schemaVersion?: number; contentBankVersion?: string; factory?: IDBFactory; dbName?: string } = {},
): Promise<{ factory: IDBFactory; dbName: string }> {
  const schemaVersion = options.schemaVersion ?? 4;
  const env = freshRepository({
    indexedDB: options.factory,
    dbName: options.dbName,
    schemaVersion,
    migrations: MIGRATIONS.slice(0, schemaVersion),
    contentBankVersion: options.contentBankVersion ?? V18_BANK_VERSION,
  });
  const r = await env.repo.commit(seedChangeset(data));
  if (!r.ok) throw new Error(`seed: ${r.error.code}`);
  env.repo.close();
  const db = await rawOpen(env.factory, env.dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['packs', 'backups', 'meta'], 'readwrite');
    for (const p of data.packs ?? []) tx.objectStore('packs').put(p);
    tx.objectStore('backups').put({
      id: 'safety-old',
      createdAt: '2026-11-13T19:00:00.000Z',
      reason: 'before_restore',
      fileName: 'dme-przed-wczytaniem-2026-11-13.json',
      sizeBytes: 10,
      json: JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 2, appId: APP_ID, exportedAt: '2026-11-13T19:00:00.000Z', appVersion: '0.1.0', bankVersions: [data.sessions.find((s) => !s.legacy)?.bankVersion ?? V18_BANK_VERSION], profileEmail: null, data }),
    });
    if (schemaVersion === 4) {
      tx.objectStore('meta').put(V18_CONTENT_META);
      tx.objectStore('meta').put(V18_MIGRATION_META);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { factory: env.factory, dbName: env.dbName };
}

let commandCounter = 0;
function ctx(now: string): CommandContext {
  const n = ++commandCounter;
  let ids = 0;
  return { now, nextDayStart: '2026-11-16T23:00:00.000Z', commandId: `cmd-po-migracji-${n}`, newId: (kind: IdKind) => `${kind}-po-migracji-${n}-${++ids}` };
}

const nonLegacy = (data: BackupData): Session[] => data.sessions.filter((s) => !s.legacy);

/** Statystyka samego wyświetlenia (bez odpowiedzi) pytania z allowlisty — 5. pytanie banku (slot s2-c rundy błędów). */
function shownOnlyStat(): QuestionStat {
  const q = BANK.questions[4]!;
  return {
    questionId: q.id,
    familyId: q.family_id,
    domainId: q.domain_id,
    seenCount: 1,
    firstSeenAt: '2026-10-21T18:03:00.000Z',
    lastSeenAt: '2026-10-21T18:03:00.000Z',
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastAnsweredAt: null,
    activeError: false,
    streak: 0,
    dueAt: null,
    lastWrongAt: null,
    lastWrongSessionId: null,
    streakSessionId: null,
    resolvedAt: null,
  };
}

/**
 * Profil V16: otwarta runda błędów (sess-2) zawiera pytanie spoza allowlisty (s2-b), więc staje się podsumowaniem;
 * jej slot s2-c (pytanie z allowlisty) był tylko pokazany — jedyny ślad to statystyka wyświetlenia.
 */
function v16ShownOnlyProfile(): BackupData {
  const data = profileData(V16_BANK_VERSION, (i, q) => (i === 3 ? retiredQuestion('XX-OBCE-4') : q));
  return { ...data, questionStats: [...data.questionStats, shownOnlyStat()] };
}

/* ========================================================================== */
/* Transformacja                                                              */
/* ========================================================================== */

describe('transformacja profilu V18 do wydania „V18 + webinary” (wydanie docelowe jako parametr)', () => {
  it('V18 → wydanie: każda sesja aktywna (ukończony test, otwarta runda błędów ze zgłoszeniem i zastępstwem, otwarty Free Flow, pusta otwarta); status, plan i wynik bez zmian; nowa bankVersion; revision + 1', () => {
    const data = v18ProfileData();
    const t = transform(data);
    const s = byId(t.sessions);
    expect(nonLegacy(data).map((x) => [x.id, x.status])).toEqual([
      ['sess-1', 'completed'],
      ['sess-2', 'open'],
      ['sess-3', 'ended'],
      ['sess-4', 'open'],
      ['sess-5', 'open'],
    ]);
    for (const original of nonLegacy(data)) {
      const migrated = s[original.id]!;
      expect(migrated.legacy ?? null).toBeNull();
      expect(migrated.status).toBe(original.status);
      expect(migrated.plan).toEqual(original.plan);
      expect(migrated.result).toEqual(original.result);
      expect(migrated.reached).toBe(original.reached);
      expect(migrated.config).toEqual(original.config);
      expect(migrated.retry).toEqual(original.retry);
      expect(migrated.bankVersion).toBe(SYNTH_BANK_VERSION);
      expect(Object.values(migrated.slots).every((slot) => slot.snapshot.bankVersion === SYNTH_BANK_VERSION)).toBe(true);
      expect(contentOf(migrated)).toEqual(contentOf(original));
      expect(migrated.revision).toBe(original.revision + 1);
    }
    // Pusta otwarta sesja V18 (bez slotów) — zostaje do wznowienia.
    expect(s['sess-5']).toMatchObject({ status: 'open', plan: [], slots: {}, bankVersion: SYNTH_BANK_VERSION, freeFlow: { empty: true } });
    // Próby, stan powtórek („Moje błędy”), zgłoszenia i zdarzenia — bez zmian.
    expect(sortById(t.attempts)).toEqual(sortById(data.attempts));
    expect(t.questionStats).toEqual(data.questionStats);
    expect(t.blocks).toEqual(data.blocks);
    expect(t.events).toEqual(data.events);
    expect(t.report).toMatchObject({
      migrationId: BANK_MIGRATION_ID,
      contentBankVersion: SYNTH_BANK_VERSION,
      sessionsCurrent: 5,
      sessionsRestamped: 5,
      sessionsLegacy: 2,
      sessionsInterrupted: 0,
      attemptsRemoved: 0,
      questionStatsReset: 0,
      blocksDeactivated: 0,
    });
  });

  it.each([
    ['V15', V15_BANK_VERSION],
    ['V16', V16_BANK_VERSION],
    ['V17', V17_BANK_VERSION],
  ] as const)('pusta otwarta sesja nie-poprzednika (%s) → przerwana aktualizacją (jak dotąd)', (_label, version) => {
    const empty = { ...v18ProfileData().sessions.find((x) => x.id === 'sess-5')!, bankVersion: version };
    const t = transformToCurrentBank({ sessions: [empty], attempts: [], questionStats: [], blocks: [], events: [] }, MIGRATED_AT, SYNTH_TARGET);
    expect(t.sessions[0]).toMatchObject({ status: 'interrupted_by_update', legacy: { reason: 'bank_v18_update', previousBankVersion: version, contentBankVersion: SYNTH_BANK_VERSION } });
    expect(t.report.sessionsRestamped).toBe(0);
  });

  it('sesja V18 bez slotów, ale z planem wskazującym nieistniejące pozycje → podsumowanie (reguła pustej sesji poprzednika jej nie przenosi)', () => {
    const broken = { ...v18ProfileData().sessions.find((x) => x.id === 'sess-5')!, plan: ['s5-brak'] };
    const t = transformToCurrentBank({ sessions: [broken], attempts: [], questionStats: [], blocks: [], events: [] }, MIGRATED_AT, SYNTH_TARGET);
    expect(t.sessions[0]).toMatchObject({ status: 'interrupted_by_update', plan: [], legacy: { reason: 'bank_v18_update', previousBankVersion: V18_BANK_VERSION } });
    expect(t.report.sessionsRestamped).toBe(0);
  });

  it('niezgodny snapshot V18 (ID z allowlisty, inna treść) → podsumowanie `legacy` (bank_v18_update); bez przenoszenia postępów tego pytania', () => {
    const data = profileData(V18_BANK_VERSION, (i, q) => (i === 0 ? alteredQuestion(q.id) : q));
    const t = transform(data);
    const s = byId(t.sessions);
    expect(s['sess-1']).toMatchObject({ status: 'completed', plan: [], slots: {}, result: { correct: 2, targetN: 3 } });
    expect(s['sess-1']!.legacy).toMatchObject({ reason: 'bank_v18_update', previousBankVersion: V18_BANK_VERSION, contentBankVersion: SYNTH_BANK_VERSION, migratedAt: MIGRATED_AT });
    const altered = BANK.questions[0]!.id;
    expect(t.attempts.some((a) => a.questionId === altered)).toBe(false);
    expect(t.questionStats.some((x) => x.questionId === altered)).toBe(false);
    // Sesje bez zmienionego pytania zostają aktywne.
    expect(s['sess-3']).toMatchObject({ status: 'ended', bankVersion: SYNTH_BANK_VERSION });
    expect(s['sess-3']!.legacy ?? null).toBeNull();
    expectNoOldContent(t);
  });

  it('sesje `legacy` z migracji v4 są głęboko równe przed i po', () => {
    const data = v18ProfileData();
    const t = transform(data);
    const before = v18LegacySessions();
    expect(t.sessions.filter((x) => x.legacy)).toEqual(before);
  });

  it('idempotencja: transformacja wyniku daje ten sam wynik (profil V18, V15, mieszany, pytanie tylko pokazane w sesji, która staje się podsumowaniem)', () => {
    const v15 = v15ProfileData(RETIRED_IDS);
    const shownOnly = v16ShownOnlyProfile();
    // Przypadek ma sens: pierwsze przekształcenie zachowuje statystykę samego wyświetlenia.
    expect(transform(shownOnly).questionStats).toContainEqual(shownOnlyStat());
    for (const data of [v18ProfileData(), v15, profileData(V18_BANK_VERSION, (i, q) => (i === 2 ? retiredQuestion('XX-OBCE') : q)), shownOnly]) {
      const a = transform(data);
      const b = transformToCurrentBank({ sessions: a.sessions, attempts: a.attempts, questionStats: a.questionStats, blocks: a.blocks, events: a.events }, '2026-12-01T00:00:00.000Z', SYNTH_TARGET);
      expect(b.sessions).toEqual(a.sessions);
      expect(b.attempts).toEqual(a.attempts);
      expect(b.questionStats).toEqual(a.questionStats);
      expect(b.blocks).toEqual(a.blocks);
      expect(b.events).toEqual(a.events);
      expectNoOldContent(a);
    }
  });

  it('statystyka samego wyświetlenia bez dowodu zostaje tylko dla pytania z allowlisty, bez sprzecznej treści, z tą samą rodziną i dziedziną', () => {
    const seen = shownOnlyStat();
    const keep = (stats: QuestionStat[], sessions: Session[] = []) =>
      transformToCurrentBank({ sessions, attempts: [], questionStats: stats, blocks: [], events: [] }, MIGRATED_AT, SYNTH_TARGET).questionStats;
    expect(keep([seen])).toEqual([seen]);
    expect(keep([{ ...seen, questionId: 'XX-SPOZA-ALLOWLISTY' }])).toEqual([]);
    expect(keep([{ ...seen, familyId: 'OBCA-RODZINA' }])).toEqual([]);
    // Sprzeczna treść tego ID w danych (inna rewizja i fingerprint) → bez przenoszenia.
    const contradicting = profileData(V18_BANK_VERSION, (i, q) => (i === 4 ? alteredQuestion(q.id) : q)).sessions;
    expect(keep([seen], contradicting)).toEqual([]);
    // Statystyka z odpowiedzią albo z terminem powtórki nadal wymaga dowodu.
    expect(keep([{ ...seen, answeredCount: 1, correctCount: 1 }])).toEqual([]);
    expect(keep([{ ...seen, dueAt: '2026-11-16T23:00:00.000Z' }])).toEqual([]);
  });

  it('pytania WB nowego wydania są zgodne (sesja wydania z polami webinaru zostaje bez zmian)', () => {
    const data = webinarProfileData();
    const t = transform(data);
    expect(t.sessions).toEqual(data.sessions);
    expect(t.attempts).toEqual(data.attempts);
    expect(t.questionStats).toEqual(data.questionStats);
    expect(t.report).toMatchObject({ sessionsCurrent: 1, sessionsRestamped: 0, sessionsLegacy: 0 });
  });

  it('domyślne parametry = bieżące wydanie (`CONTENT_RELEASE` + allowlista), poprzednik V18', () => {
    expect(SRC_V18_BANK_VERSION).toBe(V18_BANK_VERSION);
    expect(BANK_MIGRATION_ID).toBe('bank-v18-webinary');
    expect(BANK_MIGRATION_ID_V18).toBe('bank-v18');
    expect(CURRENT_BANK_TARGET.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(CURRENT_BANK_TARGET.bankSha256).toBe(CONTENT_RELEASE.bankSha256);
    expect(CURRENT_BANK_TARGET.allowed).toBe(V18_ALLOWED);
    expect(CURRENT_BANK_TARGET.predecessorBankVersions).toContain(V18_BANK_VERSION);
    const data = v18ProfileData();
    const input = { sessions: data.sessions, attempts: data.attempts, questionStats: data.questionStats, blocks: data.blocks, events: data.events, packs: data.packs };
    const t = transformToCurrentBank(input, MIGRATED_AT);
    expect(t).toEqual(transformToCurrentBank(input, MIGRATED_AT, CURRENT_BANK_TARGET));
    // Profil V18 z domyślnymi parametrami: każda sesja aktywna w bieżącej wersji treści.
    for (const original of nonLegacy(data)) {
      const migrated = t.sessions.find((x) => x.id === original.id)!;
      expect(migrated).toMatchObject({ status: original.status, bankVersion: CONTENT_RELEASE.bankVersion });
      expect(migrated.legacy ?? null).toBeNull();
    }
  });
});

/* ========================================================================== */
/* IndexedDB v4 → v5                                                          */
/* ========================================================================== */

describe('IndexedDB v4 → v5 (każdy profil osobno, jedna transakcja `versionchange`)', () => {
  it('schemat: wersja 5, migracje 1…5, v4 historyczna (bez zmian danych)', async () => {
    expect(DB_SCHEMA_VERSION).toBe(5);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
    expect(createMigrations({ target: SYNTH_TARGET }).map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
    // Baza v3 z danymi V15 → v4: dane bez zmian (przekształcenie wykonuje dopiero v5).
    const { factory, dbName } = await profileDb(v15ProfileData(RETIRED_IDS), { schemaVersion: 3, contentBankVersion: V15_BANK_VERSION });
    const before = await dumpAll(factory, dbName);
    const { repo } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 4, migrations: MIGRATIONS.slice(0, 4), contentBankVersion: V15_BANK_VERSION });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    const after = await dumpAll(factory, dbName);
    expect(after.version).toBe(4);
    for (const name of ['settings', 'sessions', 'attempts', 'questionStats', 'blocks', 'events', 'packs', 'backups']) expect(after.stores[name], name).toEqual(before.stores[name]);
  });

  it('profil V18 (baza v4): jedna aktualizacja 4 → 5; sesje aktywne w nowej wersji; meta wydania; rekord `migration:bank-v18` zostaje; kopie bezpieczeństwa przekształcone', async () => {
    const data = v18ProfileData();
    const { factory, dbName } = await profileDb(data);
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT, appVersion: '0.3.0' });
    const upgrades: { from: number; to: number }[] = [];
    repo.setUpgradeListener((info) => upgrades.push(info));
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: 5, migratedFrom: 4, created: false } });
    expect(upgrades).toEqual([{ from: 4, to: 5 }]);
    const state = await load(repo);
    repo.close();
    for (const original of nonLegacy(data)) {
      const migrated = state.sessions[original.id]!;
      expect(migrated).toMatchObject({ status: original.status, plan: original.plan, result: original.result, bankVersion: SYNTH_BANK_VERSION, revision: original.revision + 1 });
      expect(Object.values(migrated.slots).every((slot) => slot.snapshot.bankVersion === SYNTH_BANK_VERSION)).toBe(true);
    }
    for (const legacy of v18LegacySessions()) expect(state.sessions[legacy.id]).toEqual(legacy);
    expect(Object.values(state.attempts).sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(sortById(data.attempts));
    expect(state.questionStats).toEqual(Object.fromEntries(data.questionStats.map((x) => [x.questionId, x])));
    expect(state.blocks).toEqual(byId(data.blocks));
    expect(state.settings).toEqual(data.settings[0]);

    const dump = await dumpAll(factory, dbName);
    expect(dump.version).toBe(5);
    const meta = dump.stores.meta as { key: string }[];
    expect(meta.find((m) => m.key === 'content')).toEqual({ key: 'content', bankVersion: SYNTH_BANK_VERSION, bankSha256: SYNTH_BANK_SHA256, updatedAt: MIGRATED_AT, appVersion: '0.3.0' });
    expect(meta.find((m) => m.key === `migration:${BANK_MIGRATION_ID}`)).toMatchObject({
      migrationId: 'bank-v18-webinary',
      fromSchemaVersion: 4,
      toSchemaVersion: 5,
      appVersion: '0.3.0',
      report: { contentBankVersion: SYNTH_BANK_VERSION, sessionsCurrent: 5, sessionsRestamped: 5, sessionsLegacy: 2, sessionsInterrupted: 0, backupsTransformed: 1, backupsRemoved: 0 },
    });
    expect(meta.find((m) => m.key === 'migration:bank-v18')).toEqual(V18_MIGRATION_META);
    const backups = dump.stores.backups as { id: string; json: string }[];
    expect(backups.map((b) => b.id)).toEqual(['safety-old']);
    const inner = JSON.parse(backups[0]!.json) as { data: BackupData };
    expect(inner.data.sessions.filter((x) => !x.legacy).every((x) => x.bankVersion === SYNTH_BANK_VERSION)).toBe(true);
    expect(inner.data.questionStats).toEqual(data.questionStats);

    // readContentMeta czyta rekord tej migracji.
    const { repo: again } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET });
    const read = await again.readContentMeta();
    again.close();
    expect(read.ok && read.value.content?.bankVersion).toBe(SYNTH_BANK_VERSION);
    expect(read.ok && read.value.migration?.migrationId).toBe('bank-v18-webinary');
  });

  it('po migracji: dalsza odpowiedź w otwartej rundzie błędów, kolejne pytanie Free Flow (także w pustej sesji) i zapis działają', async () => {
    const { factory, dbName } = await profileDb(v18ProfileData());
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const catalog = synthCatalog();
    expect(catalog.questions).toHaveLength(702);
    expect(SYNTH_WB_IDS.every((id) => catalog.questionsById[id] !== undefined)).toBe(true);
    let state = await load(repo);

    // Runda błędów (zastępstwo s2-c): odpowiedź i zapis.
    const s2 = state.sessions['sess-2']!;
    const answered = answer(state, { sessionId: 'sess-2', expectedRevision: s2.revision, slotId: 's2-c', optionId: s2.slots['s2-c']!.snapshot.correctOptionId }, ctx('2026-11-15T21:05:00.000Z'));
    if (!answered.ok) throw new Error(answered.error.messagePl);
    expect(await repo.commit(answered.value.changeset)).toMatchObject({ ok: true });
    state = answered.value.state;

    // Otwarty Free Flow: kolejne pytanie z wydania, zapis w nowej wersji.
    const s4 = state.sessions['sess-4']!;
    const next = nextFreeFlowSlot(state, catalog, { sessionId: 'sess-4', expectedRevision: s4.revision }, ctx('2026-11-15T21:06:00.000Z'));
    if (!next.ok) throw new Error(next.error.messagePl);
    expect(next.value.value.slotId).not.toBeNull();
    expect(await repo.commit(next.value.changeset)).toMatchObject({ ok: true });
    state = next.value.state;

    // Pusta otwarta sesja: pierwsze pytanie i zapis.
    const s5 = state.sessions['sess-5']!;
    const first = nextFreeFlowSlot(state, catalog, { sessionId: 'sess-5', expectedRevision: s5.revision }, ctx('2026-11-15T21:07:00.000Z'));
    if (!first.ok) throw new Error(first.error.messagePl);
    expect(first.value.value.slotId).not.toBeNull();
    expect(await repo.commit(first.value.changeset)).toMatchObject({ ok: true });

    const saved = await load(repo);
    repo.close();
    expect(saved.sessions['sess-2']!.slots['s2-c']!.attempt).toMatchObject({ correct: true });
    expect(saved.sessions['sess-4']!.plan).toHaveLength(2);
    expect(saved.sessions['sess-5']!.plan).toHaveLength(1);
    for (const id of ['sess-2', 'sess-4', 'sess-5']) {
      const s = saved.sessions[id]!;
      expect(s.bankVersion).toBe(SYNTH_BANK_VERSION);
      expect(Object.values(s.slots).every((slot) => slot.snapshot.bankVersion === SYNTH_BANK_VERSION)).toBe(true);
    }
  });

  it('otwarty zwykły test V18 (bez rundy błędów) → po migracji aktywny; pokazanie wyniku i zapis działają', async () => {
    const base = profileData(V18_BANK_VERSION, (_i, q) => q);
    const data: BackupData = {
      ...base,
      sessions: base.sessions.map((s) => {
        if (s.id === 'sess-1') return { ...s, status: 'open', closedAt: null, result: null, events: s.events.filter((e) => e.type !== 'session_completed') };
        if (s.id === 'sess-2') return { ...s, status: 'unfinished', closedAt: s.updatedAt };
        return s;
      }),
    };
    const { factory, dbName } = await profileDb(data);
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const state = await load(repo);
    const s1 = state.sessions['sess-1']!;
    expect(s1).toMatchObject({ status: 'open', retry: null, bankVersion: SYNTH_BANK_VERSION });
    const finished = finishTest(state, { sessionId: 'sess-1', expectedRevision: s1.revision }, ctx('2026-11-15T21:08:00.000Z'));
    if (!finished.ok) throw new Error(finished.error.messagePl);
    expect(await repo.commit(finished.value.changeset)).toMatchObject({ ok: true });
    const saved = await load(repo);
    repo.close();
    expect(saved.sessions['sess-1']).toMatchObject({ status: 'completed', bankVersion: SYNTH_BANK_VERSION, result: { correct: 2, targetN: 3, passed: true } });
  });

  it('dwa profile V18: otwarcie jednego nie zmienia bazy drugiego; po otwarciu każdy ma wyłącznie własne dane', async () => {
    const dataA = v18ProfileData();
    const dataB = profileData(V18_BANK_VERSION, (i) => BANK.questions[20 + i]!);
    const a = await profileDb(dataA, { dbName: 'dme-profil-a-v18' });
    const b = await profileDb(dataB, { factory: a.factory, dbName: 'dme-profil-b-v18' });
    const bBefore = await dumpAll(b.factory, b.dbName);
    expect(bBefore.version).toBe(4);
    const { repo: ra } = freshRepository({ indexedDB: a.factory, dbName: a.dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const stateA = await load(ra);
    ra.close();
    expect(await dumpAll(b.factory, b.dbName)).toEqual(bBefore);
    const { repo: rb } = freshRepository({ indexedDB: b.factory, dbName: b.dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const stateB = await load(rb);
    rb.close();
    expect((await dumpAll(a.factory, a.dbName)).version).toBe(5);
    expect((await dumpAll(b.factory, b.dbName)).version).toBe(5);
    const idsOf = (data: BackupData) => new Set(data.attempts.map((x) => x.questionId));
    const idsIn = (state: UserState) => new Set([...Object.values(state.attempts).map((x) => x.questionId), ...Object.keys(state.questionStats)]);
    expect([...idsIn(stateA)].sort()).toEqual([...idsOf(dataA)].sort());
    expect([...idsIn(stateB)].sort()).toEqual([...idsOf(dataB)].sort());
    expect([...idsIn(stateA)].some((id) => idsOf(dataB).has(id))).toBe(false);
    expect(Object.keys(stateA.sessions).sort()).toEqual(dataA.sessions.map((s) => s.id).sort());
    expect(Object.keys(stateB.sessions).sort()).toEqual(dataB.sessions.map((s) => s.id).sort());
    expect(Object.values(stateB.sessions).every((s) => s.bankVersion === SYNTH_BANK_VERSION && !s.legacy)).toBe(true);
  });

  it('idempotencja: drugie wykonanie kroku v5 nie zmienia danych', async () => {
    const { factory, dbName } = await profileDb(v18ProfileData());
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    expect((await repo.open()).ok).toBe(true);
    repo.close();
    const first = await dumpAll(factory, dbName);
    const again = { ...createMigrationV5({ target: SYNTH_TARGET }), version: 6 };
    const { repo: rerun } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 6, migrations: [...createMigrations({ target: SYNTH_TARGET }), again], bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    expect((await rerun.open()).ok).toBe(true);
    rerun.close();
    const second = await dumpAll(factory, dbName);
    expect(second.version).toBe(6);
    for (const name of ['settings', 'sessions', 'attempts', 'questionStats', 'blocks', 'events', 'packs', 'backups']) expect(second.stores[name], name).toEqual(first.stores[name]);
    const content = (d: typeof first) => (d.stores.meta as { key: string }[]).find((m) => m.key === 'content');
    expect(content(second)).toEqual(content(first));
  });

  it('baza v4 po dawnej migracji V18 (sesja V16 już jako podsumowanie, pytanie tylko pokazane): v5 zachowuje statystykę wyświetlenia', async () => {
    const v18Only: BankTarget = { bankVersion: V18_BANK_VERSION, bankSha256: '5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6', allowed: V18_ROWS, predecessorBankVersions: [] };
    const atV4 = transform(v16ShownOnlyProfile(), v18Only, '2026-11-09T21:00:00.000Z');
    expect(atV4.sessions.find((s) => s.id === 'sess-2')?.legacy).toBeTruthy();
    expect(atV4.questionStats).toContainEqual(shownOnlyStat());
    const { factory, dbName } = await profileDb({ settings: v16ShownOnlyProfile().settings, sessions: atV4.sessions, attempts: atV4.attempts, questionStats: atV4.questionStats, blocks: atV4.blocks, events: atV4.events, packs: [] });
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const state = await load(repo);
    repo.close();
    expect(state.questionStats).toEqual(Object.fromEntries(atV4.questionStats.map((x) => [x.questionId, x])));
  });

  it.each(['sessions', 'attempts', 'questionStats', 'blocks'] as const)('przerwanie migracji po magazynie %s → `MigrationFailed`, baza zostaje w v4 bez zmian; ponowienie kończy migrację', async (store) => {
    const { factory, dbName } = await profileDb(v18ProfileData());
    const before = await dumpAll(factory, dbName);
    const { repo: failing } = freshRepository({ indexedDB: factory, dbName, migrations: createMigrations({ faultAfterStore: store, target: SYNTH_TARGET }), bankTarget: SYNTH_TARGET });
    const info = await failing.open();
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.error.code).toBe('MigrationFailed');
    failing.close();
    const after = await dumpAll(factory, dbName);
    expect(after.version).toBe(4);
    expect(after.stores).toEqual(before.stores);
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: 5, migratedFrom: 4, created: false } });
    const state = await load(repo);
    repo.close();
    expect(Object.values(state.sessions).filter((s) => !s.legacy).every((s) => s.bankVersion === SYNTH_BANK_VERSION)).toBe(true);
  });

  it('przerwanie migracji z bazy v3 → baza zostaje w v3 bez zmian', async () => {
    const { factory, dbName } = await profileDb(v15ProfileData(RETIRED_IDS), { schemaVersion: 3, contentBankVersion: V15_BANK_VERSION });
    const before = await dumpAll(factory, dbName);
    const { repo: failing } = freshRepository({ indexedDB: factory, dbName, migrations: createMigrations({ faultAfterStore: 'blocks', target: SYNTH_TARGET }) });
    const info = await failing.open();
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.error.code).toBe('MigrationFailed');
    failing.close();
    const after = await dumpAll(factory, dbName);
    expect(after.version).toBe(3);
    expect(after.stores).toEqual(before.stores);
  });

  it.each([
    [1, () => ({ ...profileData(PRE_V15_BANK_VERSION, (i) => retiredQuestion(`ANAT-Q00${i + 1}`)), packs: [] }), PRE_V15_BANK_VERSION],
    [3, () => v15ProfileData(RETIRED_IDS), V15_BANK_VERSION],
  ] as const)('baza v%i → v5 w jednej aktualizacji: podsumowania bez treści, meta wydania', async (schemaVersion, make, version) => {
    const { factory, dbName } = await profileDb(make(), { schemaVersion, contentBankVersion: version });
    const { repo } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const upgrades: { from: number; to: number }[] = [];
    repo.setUpgradeListener((info) => upgrades.push(info));
    expect(await repo.open()).toEqual({ ok: true, value: { schemaVersion: 5, migratedFrom: schemaVersion, created: false } });
    expect(upgrades).toEqual([{ from: schemaVersion, to: 5 }]);
    const state = await load(repo);
    repo.close();
    expect(Object.values(state.sessions).every((s) => s.legacy?.reason === 'bank_v18_update' && s.legacy.previousBankVersion === version && s.legacy.contentBankVersion === SYNTH_BANK_VERSION)).toBe(true);
    expect(state.sessions['sess-1']).toMatchObject({ status: 'completed', result: { correct: 2, targetN: 3, passed: true }, plan: [], slots: {} });
    expect(state.sessions['sess-2']!.status).toBe('interrupted_by_update');
    const dump = await dumpAll(factory, dbName);
    expectNoOldContent(dump.stores);
    expect(dump.stores.packs).toEqual([]);
    const meta = dump.stores.meta as { key: string }[];
    expect(meta.find((m) => m.key === `migration:${BANK_MIGRATION_ID}`)).toMatchObject({ fromSchemaVersion: schemaVersion, toSchemaVersion: 5, report: { sessionsLegacy: 3, sessionsInterrupted: 1 } });
  });
});

/* ========================================================================== */
/* Kopia danych                                                               */
/* ========================================================================== */

describe('kopia danych: ta sama transformacja, pola webinaru zachowane', () => {
  const backupText = (data: BackupData, bankVersions: string[]) =>
    JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 2, appId: APP_ID, exportedAt: '2026-11-14T20:00:00.000Z', appVersion: '0.1.0', bankVersions, profileEmail: null, data });

  /** Plik z aplikacji ma najwyżej jedną otwartą sesję: pozostałe zamknięte (test → unfinished, Free Flow → ended). */
  const withOnlyOpen = (data: BackupData, openId: string): BackupData => ({
    ...data,
    sessions: data.sessions.map((s) => (s.status !== 'open' || s.id === openId ? s : { ...s, status: s.kind === 'test' ? 'unfinished' : 'ended', closedAt: s.updatedAt })),
  });

  it.each([
    ['otwarta runda błędów', 'sess-2'],
    ['otwarty Free Flow', 'sess-4'],
    ['pusta otwarta sesja', 'sess-5'],
  ] as const)('kopia z aplikacji V18 (%s, snapshoty bez pól webinaru): wczytanie = ten sam stan co migracja bazy', async (_label, openId) => {
    const data = withOnlyOpen(v18ProfileData(), openId);
    const { factory, dbName } = await profileDb(data);
    const { repo: migrated } = freshRepository({ indexedDB: factory, dbName, bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const viaDb = await load(migrated);
    migrated.close();
    expect(viaDb.sessions[openId]).toMatchObject({ status: 'open', bankVersion: SYNTH_BANK_VERSION });
    const { repo } = freshRepository({ bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(data, [V18_BANK_VERSION]), 'dme-kopia-2026-11-14.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.value.summary).toMatchObject({ legacySessions: 2, interruptedSessions: 1, openSessions: 1, openSessionKind: data.sessions.find((s) => s.id === openId)!.kind });
    expect((await repo.replaceAllFromBackup(parsed.value, { now: MIGRATED_AT, safetyBackupId: 'safety-1', appVersion: 'test', bankVersions: [SYNTH_BANK_VERSION] })).ok).toBe(true);
    expect(await load(repo)).toEqual(viaDb);
    repo.close();
  });

  it('kopia z polami webinaru (`webinarEvidence`, `sources[].fileName`, `sources[].webinar`): pola zachowane w imporcie i eksporcie', async () => {
    const data = webinarProfileData();
    const original = data.sessions[0]!;
    const { repo } = freshRepository({ bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(data, [SYNTH_BANK_VERSION]), 'dme-kopia.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.value.backup.data.sessions).toEqual([original]);
    expect((await repo.replaceAllFromBackup(parsed.value, { now: MIGRATED_AT, safetyBackupId: 'safety-1', appVersion: 'test', bankVersions: [SYNTH_BANK_VERSION] })).ok).toBe(true);
    const state = await load(repo);
    expect(state.sessions['sess-wb']).toEqual(original);
    const snap = state.sessions['sess-wb']!.slots['wb-a']!.snapshot as unknown as { webinarEvidence: { quote: string; unitIds: string[] }; sources: { fileName: string; webinar: boolean }[] };
    expect(snap.webinarEvidence.unitIds).toEqual(['W13-U0022']);
    expect(snap.webinarEvidence.quote.length).toBeGreaterThan(0);
    expect(snap.sources[0]).toMatchObject({ webinar: true, url: null });
    expect(snap.sources[0]!.fileName).toMatch(/\.txt$/);

    const exported = await repo.exportBackup({ now: MIGRATED_AT, appVersion: 'test', bankVersions: [SYNTH_BANK_VERSION] });
    if (!exported.ok) throw new Error(exported.error.code);
    repo.close();
    const file = JSON.parse(exported.value.text) as { data: BackupData };
    expect(file.data.sessions).toEqual([original]);

    const { repo: other } = freshRepository({ bankTarget: SYNTH_TARGET, now: () => '2026-12-01T00:00:00.000Z' });
    const again = await other.parseAndValidateBackup(exported.value.text, 'kopia.json');
    if (!again.ok) throw new Error(JSON.stringify(again.error));
    expect((await other.replaceAllFromBackup(again.value, { now: '2026-12-01T00:00:00.000Z', safetyBackupId: 's2', appVersion: 't', bankVersions: [] })).ok).toBe(true);
    expect(await load(other)).toEqual(state);
    other.close();
  });

  it('kopia z wartościami `null` pól webinaru jest przyjmowana', async () => {
    const data = webinarProfileData();
    const slot = data.sessions[0]!.slots['wb-a']!;
    const snap = slot.snapshot as unknown as Record<string, unknown> & { sources: Record<string, unknown>[] };
    snap.webinarEvidence = null;
    snap.sources[0]!.fileName = null;
    const { repo } = freshRepository({ bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(data, [SYNTH_BANK_VERSION]), 'dme-kopia.json');
    repo.close();
    expect(parsed.ok).toBe(true);
  });

  type SnapPatch = (snap: Record<string, unknown> & { webinarEvidence: Record<string, unknown>; sources: Record<string, unknown>[] }) => void;
  it.each([
    ['webinarEvidence jako tekst', 'webinarEvidence', ((s) => (s.webinarEvidence = 'cytat' as unknown as Record<string, unknown>)) as SnapPatch],
    ['webinarEvidence.quote jako liczba', 'quote', ((s) => (s.webinarEvidence.quote = 5)) as SnapPatch],
    ['webinarEvidence.unitIds jako tekst', 'unitIds', ((s) => (s.webinarEvidence.unitIds = 'W13-U0022')) as SnapPatch],
    ['webinarEvidence bez pola note', 'note', ((s) => delete s.webinarEvidence.note) as SnapPatch],
    ['sources[].fileName jako liczba', 'fileName', ((s) => (s.sources[0]!.fileName = 42)) as SnapPatch],
    ['sources[].webinar jako tekst', 'webinar', ((s) => (s.sources[0]!.webinar = 'tak')) as SnapPatch],
  ] as const)('niepoprawny typ pola webinaru (%s) → `InvalidBackup`', async (_label, field, patch) => {
    const data = webinarProfileData();
    patch(data.sessions[0]!.slots['wb-a']!.snapshot as unknown as Parameters<SnapPatch>[0]);
    const { repo } = freshRepository({ bankTarget: SYNTH_TARGET, now: () => MIGRATED_AT });
    const parsed = await repo.parseAndValidateBackup(backupText(data, [SYNTH_BANK_VERSION]), 'dme-kopia.json');
    repo.close();
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('InvalidBackup');
    if (parsed.error.code === 'InvalidBackup') expect(parsed.error.reasonsPl.some((r) => r.includes(`„${field}”`))).toBe(true);
  });
});
