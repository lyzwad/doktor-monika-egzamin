/**
 * Profile lokalne (DECYZJE §16) na rzeczywistym kontrolerze, repozytorium IndexedDB (fake-indexeddb) i banku V15:
 * wybór i zapamiętanie profilu, oddzielne postępy, zmiana profilu w trakcie zapisu, równoległe karty,
 * przypisanie historii bez profilu (także po przerwaniu i z innej karty), kopia danych między profilami.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createAppController } from '../../src/app/appController';
import type { AppController } from '../../src/app/controller';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import type { Repository, RepositoryOptions } from '../../src/persistence/api';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import { createProfileShell, MSG_ASSIGN_OTHER } from '../../src/profiles/profileShell';
import type { ProfileShell, ShellChannel, ShellMessage } from '../../src/profiles/profileShell';
import { LEGACY_DB_NAME, profileDbName } from '../../src/profiles/profiles';
import type { ProfileEmail } from '../../src/profiles/profiles';
import { createProfileRegistry } from '../../src/profiles/registry';
import { contentBundle, fakePlatform, fakePwa, keyOf, openSession, question, settle, startHarness, wrongOf, type FakePlatform } from './harness';

const MONIKA = 'monika@doktormonika.pl' as ProfileEmail;
const IZA = 'iza@doktormonika.pl' as ProfileEmail;
const OLA = 'ola@doktormonika.pl' as ProfileEmail;

/** Platforma z prefiksem identyfikatorów (różne „urządzenia/karty” nie generują tych samych id). */
function platformWithPrefix(prefix: string): FakePlatform {
  const p = fakePlatform();
  const base = p.randomId;
  p.randomId = () => `${prefix}-${base()}`;
  return p;
}

/** Kanał między kartami w pamięci (jak BroadcastChannel: nadawca nie dostaje własnych wiadomości). */
function channelHub() {
  const endpoints = new Set<{ listeners: Set<(m: ShellMessage) => void> }>();
  return {
    endpoint(): ShellChannel {
      const self = { listeners: new Set<(m: ShellMessage) => void>() };
      endpoints.add(self);
      return {
        post(message) {
          for (const e of endpoints) if (e !== self) for (const l of e.listeners) l(message);
        },
        onMessage(listener) {
          self.listeners.add(listener);
          return () => self.listeners.delete(listener);
        },
      };
    },
  };
}

interface Tab {
  shell: ProfileShell;
  platform: FakePlatform;
  tabProfile: { value: string | null };
}

function openTab(
  factory: IDBFactory,
  options: { prefix?: string; tabProfile?: string | null; channel?: ShellChannel; wrapRepository?: (repo: Repository, opts: RepositoryOptions) => Repository } = {},
): Tab {
  const platform = platformWithPrefix(options.prefix ?? 'T');
  const pwa = fakePwa();
  const tabProfile = { value: options.tabProfile ?? null };
  const now = () => new Date(platform.nowMs).toISOString();
  const shell = createProfileShell({
    registry: createProfileRegistry(factory),
    createRepository: (opts) => {
      const repo = createIndexedDbRepository({ ...opts, indexedDB: factory, storageManager: null, now });
      return options.wrapRepository ? options.wrapRepository(repo, opts) : repo;
    },
    createController: ({ repository, profile }) =>
      createAppController({ repository, loadBank: async () => contentBundle(), platform, pwa, appVersion: 'test-1', profile }),
    legacyDatabaseExists: async () => null,
    now,
    randomId: () => platform.randomId(),
    appVersion: 'test-1',
    bankVersions: [CONTENT_RELEASE.bankVersion],
    tabProfile: { get: () => tabProfile.value, set: (e) => (tabProfile.value = e) },
    channel: options.channel,
    resetRoute: () => (platform.hash = ''),
  });
  return { shell, platform, tabProfile };
}

function app(shell: ProfileShell): AppController {
  const s = shell.getState();
  if (s.phase !== 'app') throw new Error(`oczekiwano aplikacji, jest ${s.phase}`);
  return s.controller;
}

async function startTestN(c: AppController, n: number): Promise<void> {
  c.openConfig('test');
  c.updateConfigDraft({ nText: String(n) });
  expect(await c.startTest()).toEqual({ ok: true });
  await settle();
}

async function finishTest(c: AppController, correct: (i: number) => boolean): Promise<string> {
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
  c.goHome();
  return sessionId;
}

/** Stan danych profilu wprost z jego bazy (niezależnie od kontrolera). */
async function dataOf(factory: IDBFactory, email: ProfileEmail | null) {
  const repo = createIndexedDbRepository({ indexedDB: factory, dbName: email ? profileDbName(email) : LEGACY_DB_NAME, storageManager: null, ...(email ? { owner: email } : {}) });
  const r = await repo.loadUserState();
  repo.close();
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

const completed = (u: Awaited<ReturnType<typeof dataOf>>) => Object.values(u.sessions).filter((s) => s.status === 'completed').length;

describe('wybór profilu i zapamiętanie', () => {
  it('pierwsze uruchomienie: ekran wyboru; adres normalizowany; aktywny mail w stanie aplikacji', async () => {
    const factory = new IDBFactory();
    const t = openTab(factory);
    await t.shell.start();
    expect(t.shell.getState()).toMatchObject({ phase: 'picker', last: null, unassigned: null });
    await t.shell.choose('  Monika@DoktorMonika.pl ');
    const c = app(t.shell);
    expect(c.getState().boot).toEqual({ phase: 'ready' });
    expect(c.getState().profile).toEqual({ email: MONIKA, unassigned: null });
    // Adres spoza listy nie tworzy profilu.
    await t.shell.openPicker();
    await t.shell.choose('ktos@example.com');
    expect(t.shell.getState().phase).toBe('picker');
    t.shell.dispose();
  });

  it('ponowne uruchomienie otwiera ostatni profil; odświeżenie karty zostaje przy profilu tej karty', async () => {
    const factory = new IDBFactory();
    const a = openTab(factory);
    await a.shell.start();
    await a.shell.choose(IZA);
    a.shell.dispose();
    const relaunch = openTab(factory);
    await relaunch.shell.start();
    expect(app(relaunch.shell).getState().profile?.email).toBe(IZA);
    relaunch.shell.dispose();
    const tabWithOwnProfile = openTab(factory, { tabProfile: MONIKA });
    await tabWithOwnProfile.shell.start();
    expect(app(tabWithOwnProfile.shell).getState().profile?.email).toBe(MONIKA);
    tabWithOwnProfile.shell.dispose();
  });
});

describe('osobne postępy profili', () => {
  it('profil A → test → profil B z pustą historią → powrót do A z zachowanym wynikiem', async () => {
    const factory = new IDBFactory();
    const t = openTab(factory);
    await t.shell.start();
    await t.shell.choose(MONIKA);
    await startTestN(app(t.shell), 3);
    const sessionId = await finishTest(app(t.shell), (i) => i !== 1);
    const result = app(t.shell).getState().userState?.sessions[sessionId]?.result;
    expect(result).toMatchObject({ correct: 2, targetN: 3 });

    await t.shell.openPicker();
    await t.shell.choose(IZA);
    expect(Object.keys(app(t.shell).getState().userState?.sessions ?? {})).toHaveLength(0);
    expect(app(t.shell).getState().resume).toBeNull();

    await t.shell.openPicker();
    await t.shell.choose(MONIKA);
    expect(app(t.shell).getState().userState?.sessions[sessionId]?.result).toEqual(result);
    t.shell.dispose();
  });

  it('osobne rozpoczęte sesje, powtórki, wykluczenia i ustawienia; zmiana profilu nie kończy sesji', async () => {
    const factory = new IDBFactory();
    const t = openTab(factory);
    await t.shell.start();
    await t.shell.choose(MONIKA);
    let c = app(t.shell);
    // Monika: test z błędem → runda błędów rozpoczęta (otwarta); zgłoszenie (wykluczenie) w rundzie.
    await startTestN(c, 2);
    const parent = await finishTest(c, () => false);
    expect(await c.startRetryRound(parent)).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    expect(await c.report()).toEqual({ ok: true });
    await settle();
    c.pauseSession();
    const monikaRound = openSession(c);
    expect(monikaRound.retry).toMatchObject({ sourceSessionId: parent });
    const monikaBlocks = Object.keys(c.getState().userState?.blocks ?? {}).length;
    expect(monikaBlocks).toBe(1);

    // Iza: pusta; własny Free Flow otwarty.
    await t.shell.openPicker();
    await t.shell.choose(IZA);
    c = app(t.shell);
    expect(c.getState().resume).toBeNull();
    expect(Object.keys(c.getState().userState?.blocks ?? {})).toHaveLength(0);
    c.openConfig('freeflow');
    expect(await c.startFreeFlow()).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    c.pauseSession();
    expect(c.getState().resume?.kind).toBe('freeflow');

    // Powrót do Moniki: jej runda błędów nadal otwarta (ta sama sesja), wykluczenie zostaje.
    await t.shell.openPicker();
    await t.shell.choose(MONIKA);
    c = app(t.shell);
    expect(c.getState().resume).toMatchObject({ sessionId: monikaRound.id, kind: 'test' });
    expect(Object.keys(c.getState().userState?.blocks ?? {})).toHaveLength(monikaBlocks);
    // I z powrotem: Free Flow Izy nadal otwarty.
    await t.shell.openPicker();
    await t.shell.choose(IZA);
    expect(app(t.shell).getState().resume?.kind).toBe('freeflow');
    t.shell.dispose();
  });
});

describe('zapis zawsze w bazie właściciela', () => {
  it('zmiana profilu podczas zapisu: zmiana czeka na zapis, a odpowiedź trafia do profilu, który ją wywołał', async () => {
    const factory = new IDBFactory();
    let gate: (() => void) | null = null;
    const order: string[] = [];
    const t = openTab(factory, {
      wrapRepository: (repo, opts) => ({
        ...repo,
        async commit(changeset) {
          const hasAttempt = (changeset.stores.attempts?.put.length ?? 0) > 0;
          if (hasAttempt && opts.owner === MONIKA && gate === null) {
            await new Promise<void>((resolve) => (gate = resolve));
          }
          const r = await repo.commit(changeset);
          if (hasAttempt) order.push(`commit:${opts.owner}`);
          return r;
        },
      }),
    });
    await t.shell.start();
    await t.shell.choose(MONIKA);
    const c = app(t.shell);
    await startTestN(c, 2);
    const answering = c.answer(keyOf(c));
    await settle();
    const switching = t.shell.openPicker().then(() => order.push('picker'));
    await settle();
    expect(order).toEqual([]);
    expect(t.shell.getState().phase).toBe('loading');
    (gate as unknown as () => void)();
    await answering;
    await switching;
    expect(order).toEqual([`commit:${MONIKA}`, 'picker']);
    await t.shell.choose(IZA);
    expect(Object.values((await dataOf(factory, MONIKA)).attempts)).toHaveLength(1);
    expect(Object.values((await dataOf(factory, IZA)).attempts)).toHaveLength(0);
    t.shell.dispose();
  });

  it('dwie karty: karta A pisze do profilu A, choć karta B wybrała profil B; nowa karta otwiera ostatni (B)', async () => {
    const factory = new IDBFactory();
    const hub = channelHub();
    const tabA = openTab(factory, { prefix: 'A', channel: hub.endpoint() });
    await tabA.shell.start();
    await tabA.shell.choose(MONIKA);
    const tabB = openTab(factory, { prefix: 'B', channel: hub.endpoint() });
    await tabB.shell.start();
    expect(app(tabB.shell).getState().profile?.email).toBe(MONIKA);
    await tabB.shell.openPicker();
    await tabB.shell.choose(IZA);
    await startTestN(app(tabB.shell), 2);
    await finishTest(app(tabB.shell), () => true);

    const c = app(tabA.shell);
    expect(c.getState().profile?.email).toBe(MONIKA);
    await startTestN(c, 2);
    await finishTest(c, () => false);
    expect(completed(await dataOf(factory, MONIKA))).toBe(1);
    expect(completed(await dataOf(factory, IZA))).toBe(1);
    expect(Object.values((await dataOf(factory, MONIKA)).sessions).every((s) => s.id.startsWith('A-'))).toBe(true);
    expect(Object.values((await dataOf(factory, IZA)).sessions).every((s) => s.id.startsWith('B-'))).toBe(true);

    const tabC = openTab(factory, { prefix: 'C' });
    await tabC.shell.start();
    expect(app(tabC.shell).getState().profile?.email).toBe(IZA);
    for (const t of [tabA, tabB, tabC]) t.shell.dispose();
  });

  it('repozytorium profilu nie otworzy ani nie zapisze bazy innego profilu', async () => {
    const factory = new IDBFactory();
    const monika = createIndexedDbRepository({ indexedDB: factory, dbName: profileDbName(MONIKA), owner: MONIKA, storageManager: null });
    expect((await monika.open()).ok).toBe(true);
    monika.close();
    const wrong = createIndexedDbRepository({ indexedDB: factory, dbName: profileDbName(MONIKA), owner: IZA, storageManager: null });
    const opened = await wrong.open();
    expect(opened).toMatchObject({ ok: false, error: { code: 'OwnerMismatch', expected: IZA, found: MONIKA } });
    const write = await wrong.commit({ commandId: 'x', guards: [], stores: { settings: { put: [{ id: 'settings', lastTestConfig: null, lastFreeFlowConfig: null, installHintDismissedAt: '2026-10-25T08:00:00.000Z', persistRequestedAt: null, updatedAt: null }], delete: [] } } });
    expect(write.ok).toBe(false);
    expect((await dataOf(factory, MONIKA)).settings.installHintDismissedAt).toBeNull();
  });
});

/** Historia sprzed profili: rzeczywisty kontroler bez profilu na bazie `doktor-monika-egzamin`. */
async function seedLegacy(factory: IDBFactory): Promise<{ completedId: string; openId: string }> {
  const platform = platformWithPrefix('L');
  const h = await startHarness({ factory, dbName: LEGACY_DB_NAME, platform });
  const c = h.controller;
  await startTestN(c, 2);
  const completedId = await finishTest(c, (i) => i === 0);
  await startTestN(c, 3);
  expect(await c.answer(keyOf(c))).toEqual({ ok: true });
  await settle();
  c.pauseSession();
  const openId = openSession(c).id;
  await c.whenIdle();
  c.dispose();
  h.repository.close();
  return { completedId, openId };
}

describe('dotychczasowa historia bez profilu', () => {
  it('ekran wyboru pokazuje historię; „Nie teraz” zostawia ją bez profilu; przypisanie przenosi wynik i wznawialną sesję V15', async () => {
    const factory = new IDBFactory();
    const legacy = await seedLegacy(factory);
    const before = await dataOf(factory, null);

    const t = openTab(factory);
    await t.shell.start();
    const picker = t.shell.getState();
    expect(picker).toMatchObject({ phase: 'picker', unassigned: { completedTests: 1, openSessions: 1 } });
    // Nie przypisuje automatycznie (ani Monice, ani pierwszej osobie z listy).
    expect(completed(await dataOf(factory, MONIKA))).toBe(0);
    expect(completed(await dataOf(factory, 'recepcja@doktormonika.pl' as ProfileEmail))).toBe(0);

    await t.shell.choose(MONIKA);
    expect(t.shell.getState()).toMatchObject({ phase: 'assign', email: MONIKA });
    await t.shell.deferUnassigned();
    expect(app(t.shell).getState().profile).toMatchObject({ email: MONIKA, unassigned: { completedTests: 1 } });
    expect(Object.keys(app(t.shell).getState().userState?.sessions ?? {})).toHaveLength(0);

    // Przypisanie z Ustawień aktywnego profilu (Iza).
    await t.shell.openPicker();
    await t.shell.choose(IZA);
    expect(t.shell.getState().phase).toBe('assign');
    await t.shell.assignUnassigned(IZA);
    const c = app(t.shell);
    expect(c.getState().profile).toEqual({ email: IZA, unassigned: null });
    expect(c.getState().userState?.sessions[legacy.completedId]?.status).toBe('completed');
    expect(c.getState().resume).toMatchObject({ sessionId: legacy.openId, kind: 'test' });
    // Sesja V15 wznawialna: kolejna odpowiedź w profilu Izy.
    c.resume();
    expect(await c.next()).toEqual({ ok: true });
    await settle();
    expect(await c.answer(keyOf(c))).toEqual({ ok: true });
    await settle();
    expect(Object.keys((await dataOf(factory, IZA)).attempts).length).toBe(Object.keys(before.attempts).length + 1);
    // Źródło zostaje nietknięte (zabezpieczenie); Monika bez cudzej historii.
    expect(await dataOf(factory, null)).toEqual(before);
    expect(completed(await dataOf(factory, MONIKA))).toBe(0);
    t.shell.dispose();

    // Kolejne uruchomienie: historia przypisana — bez ponownej propozycji, bez duplikatów.
    const relaunch = openTab(factory);
    await relaunch.shell.start();
    expect(app(relaunch.shell).getState().profile).toEqual({ email: IZA, unassigned: null });
    expect(completed(await dataOf(factory, IZA))).toBe(1);
    relaunch.shell.dispose();
  });

  it('przypisanie do profilu z własną historią: wyniki obu zachowane, statystyki z połączonego dziennika, kopia bezpieczeństwa', async () => {
    const factory = new IDBFactory();
    await seedLegacy(factory);
    const t = openTab(factory, { prefix: 'M' });
    await t.shell.start();
    await t.shell.choose(MONIKA);
    await t.shell.deferUnassigned();
    await startTestN(app(t.shell), 2);
    await finishTest(app(t.shell), () => true);
    const own = await dataOf(factory, MONIKA);
    const legacy = await dataOf(factory, null);

    await t.shell.assignUnassigned(MONIKA);
    const merged = await dataOf(factory, MONIKA);
    expect(completed(merged)).toBe(2);
    expect(Object.keys(merged.attempts).length).toBe(Object.keys(own.attempts).length + Object.keys(legacy.attempts).length);
    for (const stat of Object.values(merged.questionStats)) {
      const attempts = Object.values(merged.attempts).filter((a) => a.questionId === stat.questionId && !a.excluded);
      expect(stat.answeredCount).toBe(attempts.length);
    }
    const repo = createIndexedDbRepository({ indexedDB: factory, dbName: profileDbName(MONIKA), owner: MONIKA, storageManager: null });
    const backups = await repo.listBackups();
    expect(backups.ok && backups.value.map((b) => b.reason)).toEqual(['before_assign']);
    repo.close();
    t.shell.dispose();
  });

  it('przerwane przypisanie (po zapisie w profilu albo przed nim) kończy się przy kolejnym uruchomieniu bez duplikatów', async () => {
    for (const crashAfterMerge of [true, false]) {
      const factory = new IDBFactory();
      await seedLegacy(factory);
      const t = openTab(factory);
      await t.shell.start();
      t.shell.dispose();
      // Symulacja przerwania: rejestr „assigning”, (opcjonalnie) zapis w profilu, bez potwierdzenia w rejestrze.
      const registry = createProfileRegistry(factory);
      const begun = await registry.beginAssign(OLA, 'merge-1', '2026-10-25T08:00:00.000Z');
      expect(begun.started).toBe(true);
      if (crashAfterMerge) {
        const source = await dataOf(factory, null);
        const target = createIndexedDbRepository({ indexedDB: factory, dbName: profileDbName(OLA), owner: OLA, storageManager: null });
        const r = await target.mergeUnassignedHistory(source, { now: '2026-10-25T08:00:01.000Z', mergeId: 'merge-1', sourceDb: LEGACY_DB_NAME, safetyBackupId: 'b-1', appVersion: 't', bankVersions: [] });
        expect(r).toMatchObject({ ok: true, value: { alreadyMerged: false } });
        target.close();
      }
      registry.close();
      const relaunch = openTab(factory);
      await relaunch.shell.start();
      const legacy = await dataOf(factory, null);
      const ola = await dataOf(factory, OLA);
      expect(Object.keys(ola.sessions).sort()).toEqual(Object.keys(legacy.sessions).sort());
      expect(Object.keys(ola.attempts)).toHaveLength(Object.keys(legacy.attempts).length);
      const snapshot = await createProfileRegistry(factory).read();
      expect(snapshot.unassigned).toMatchObject({ status: 'assigned', email: OLA });
      relaunch.shell.dispose();
    }
  });

  it('druga karta nie przypisze tej samej historii innemu profilowi', async () => {
    const factory = new IDBFactory();
    await seedLegacy(factory);
    const t = openTab(factory);
    await t.shell.start();
    const other = createProfileRegistry(factory);
    expect((await other.beginAssign(OLA, 'merge-x', '2026-10-25T08:00:00.000Z')).started).toBe(true);
    await t.shell.choose(MONIKA);
    await t.shell.assignUnassigned(MONIKA);
    expect(t.shell.getState()).toMatchObject({ phase: 'picker', messagePl: MSG_ASSIGN_OTHER });
    expect(completed(await dataOf(factory, MONIKA))).toBe(0);
    other.close();
    t.shell.dispose();
  });
});

describe('kopia danych a profile', () => {
  it('eksport zawiera mail aktywnego profilu; import do wskazanego profilu nie zmienia pozostałych', async () => {
    const factory = new IDBFactory();
    const t = openTab(factory);
    await t.shell.start();
    await t.shell.choose(MONIKA);
    await startTestN(app(t.shell), 2);
    await finishTest(app(t.shell), () => true);
    expect(await app(t.shell).exportBackup()).toEqual({ ok: true });
    const file = t.platform.files.at(-1)!;
    const parsed = JSON.parse(file.text) as { formatVersion: number; profileEmail: string };
    expect(parsed).toMatchObject({ formatVersion: 2, profileEmail: MONIKA });

    // Iza: własny test.
    await t.shell.openPicker();
    await t.shell.choose(IZA);
    let c = app(t.shell);
    await startTestN(c, 3);
    await finishTest(c, () => false);
    const izaBefore = await dataOf(factory, IZA);

    // Kopia Moniki wczytana w profilu Izy: źródło i cel = Monika (domyślnie), dane Izy bez zmian.
    c.openBackup();
    expect(await c.selectBackupFile(new Blob([file.text]), file.fileName)).toEqual({ ok: true });
    expect(c.getState().screen).toMatchObject({ flow: { step: 'confirm', sourceEmail: MONIKA, targetEmail: MONIKA, activeEmail: IZA } });
    expect(await c.confirmBackupReplace()).toEqual({ ok: true });
    expect(c.getState().screen).toMatchObject({ flow: { step: 'done', targetEmail: MONIKA, activeEmail: IZA } });
    expect(await dataOf(factory, IZA)).toEqual(izaBefore);
    expect(completed(await dataOf(factory, MONIKA))).toBe(1);

    // Kopia starszego formatu (bez maila): wymaga wskazania profilu; trafia wyłącznie do Oli.
    const v1 = JSON.stringify({ ...JSON.parse(file.text), formatVersion: 1, profileEmail: undefined });
    c = app(t.shell);
    c.resetBackupFlow();
    c.openBackup();
    expect(await c.selectBackupFile(new Blob([v1]), 'stara.json')).toEqual({ ok: true });
    expect(c.getState().screen).toMatchObject({ flow: { step: 'confirm', sourceEmail: null, targetEmail: null } });
    expect(await c.confirmBackupReplace()).toMatchObject({ ok: false, code: 'NO_TARGET' });
    c.setBackupTarget('Ola@doktormonika.pl');
    expect(await c.confirmBackupReplace()).toEqual({ ok: true });
    expect(completed(await dataOf(factory, OLA))).toBe(1);
    expect(await dataOf(factory, IZA)).toEqual(izaBefore);
    expect(completed(await dataOf(factory, MONIKA))).toBe(1);
    // Kopia bezpieczeństwa wczytania do innego profilu pobiera się z jego bazy.
    expect(await c.downloadSafetyBackup()).toEqual({ ok: true });
    expect(JSON.parse(t.platform.files.at(-1)!.text)).toMatchObject({ formatVersion: 2, profileEmail: OLA });
    t.shell.dispose();
  });
});
