/**
 * Kopia danych: eksport, walidacja, podsumowanie, zamiana z automatyczną kopią bezpieczeństwa
 * (DECYZJE §10; kryteria F02, F03; ekrany S22a–S22g, S24e).
 */
import { IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { BackupFileV1, PersistenceError, Repository, ValidatedBackup } from '../../src/persistence/api';
import { APP_ID, BACKUP_FORMAT, BACKUP_MAX_BYTES } from '../../src/persistence/api';
import { backupFileName, summarizeBackup } from '../../src/persistence/backup';
import { SAFETY_BACKUPS_KEPT } from '../../src/persistence/repository';
import { freshRepository, sampleUserData, seedChangeset, seededRepository } from './fixtures';

const NOW = '2026-10-22T10:00:00.000Z';
const EXPORT_INPUT = { now: NOW, appVersion: '1.0.0', bankVersions: ['seed-2026-10-22'] };

async function exportText(repo: Repository, now = NOW): Promise<string> {
  const exported = await repo.exportBackup({ ...EXPORT_INPUT, now });
  if (!exported.ok) throw new Error(exported.error.code);
  return exported.value.text;
}

async function validated(repo: Repository, text: string, fileName = 'dme-kopia-2026-10-22.json'): Promise<ValidatedBackup> {
  const parsed = await repo.parseAndValidateBackup(text, fileName);
  if (!parsed.ok) throw new Error(`${parsed.error.code}: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function mutate(text: string, fn: (file: BackupFileV1 & Record<string, unknown>) => void): string {
  const file = JSON.parse(text) as BackupFileV1 & Record<string, unknown>;
  fn(file);
  return JSON.stringify(file);
}

async function expectRejected(repo: Repository, input: string | Blob, code: PersistenceError['code'], reason?: RegExp): Promise<PersistenceError> {
  const before = await repo.loadUserState();
  const parsed = await repo.parseAndValidateBackup(input, 'plik.json');
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error('oczekiwano odrzucenia');
  expect(parsed.error.code).toBe(code);
  if (reason && parsed.error.code === 'InvalidBackup') {
    expect(parsed.error.reasonsPl.join('\n')).toMatch(reason);
  }
  // Walidacja nie zmienia danych ani nie tworzy kopii bezpieczeństwa.
  expect(await repo.loadUserState()).toEqual(before);
  const backups = await repo.listBackups();
  expect(backups.ok && backups.value).toEqual([]);
  return parsed.error;
}

describe('eksport kopii', () => {
  it('buduje plik dme-backup v1 ze wszystkimi danymi użytkownika, z nazwą z datą', async () => {
    const { repo, data } = await seededRepository();
    const exported = await repo.exportBackup(EXPORT_INPUT);
    if (!exported.ok) throw new Error(exported.error.code);
    const file = exported.value;
    expect(file.fileName).toBe('dme-kopia-2026-10-22.json');
    expect(file.mimeType).toBe('application/json');
    expect(file.sizeBytes).toBe(Buffer.byteLength(file.text, 'utf8'));
    const parsed = JSON.parse(file.text) as BackupFileV1;
    expect(parsed).toMatchObject({
      format: BACKUP_FORMAT,
      formatVersion: 1,
      appId: APP_ID,
      exportedAt: NOW,
      appVersion: '1.0.0',
      bankVersions: ['seed-2026-10-22'],
    });
    expect(Object.keys(parsed.data).sort()).toEqual(['attempts', 'blocks', 'events', 'packs', 'questionStats', 'sessions', 'settings']);
    expect(parsed.data.sessions.map((s) => s.id).sort()).toEqual(data.sessions.map((s) => s.id).sort());
    expect(parsed.data.attempts).toHaveLength(data.attempts.length);
    expect(parsed.data.events).toHaveLength(data.events.length);
    expect(parsed.data.blocks).toEqual(data.blocks);
    expect(parsed.data.settings).toEqual(data.settings);
    // Snapshoty i otwarta sesja w kopii.
    expect(parsed.data.sessions.find((s) => s.id === 'sess-2')?.status).toBe('open');
    expect(parsed.data.sessions.find((s) => s.id === 'sess-1')?.slots['s1-b']?.snapshot.stem).toBe(data.sessions[0]?.slots['s1-b']?.snapshot.stem);
    repo.close();
  });

  it('nazwa pliku używa daty w strefie Europe/Warsaw', () => {
    expect(backupFileName('dme-kopia', '2026-10-22T21:59:00.000Z')).toBe('dme-kopia-2026-10-22.json');
    expect(backupFileName('dme-kopia', '2026-10-22T22:30:00.000Z')).toBe('dme-kopia-2026-10-23.json');
    expect(backupFileName('dme-przed-wczytaniem', '2026-12-31T23:30:00.000Z')).toBe('dme-przed-wczytaniem-2027-01-01.json');
  });

  it('pusta baza → poprawna kopia bez rekordów', async () => {
    const { repo } = freshRepository();
    const text = await exportText(repo);
    const v = await validated(repo, text);
    expect(v.summary).toMatchObject({ completedTests: 0, totalSessions: 0, attempts: 0, firstActivityAt: null, lastActivityAt: null });
    repo.close();
  });
});

describe('podsumowanie kopii (ekran decyzji)', () => {
  it('liczy sesje, testy, próby, blokady i zakres dat', async () => {
    const { repo } = await seededRepository();
    const v = await validated(repo, await exportText(repo));
    expect(v.summary).toEqual({
      exportedAt: NOW,
      formatVersion: 1,
      appVersion: '1.0.0',
      completedTests: 1,
      unfinishedTests: 0,
      freeFlowSessions: 1,
      openSessions: 1,
      openSessionKind: 'test',
      activeBlocks: 1,
      attempts: 7,
      questionStats: 5,
      packs: 0,
      totalSessions: 3,
      firstActivityAt: '2026-10-19T07:00:00.000Z',
      lastActivityAt: '2026-10-21T18:03:00.000Z',
      legacySessions: 0,
      interruptedSessions: 0,
      packsDropped: 0,
    });
    expect(v.fileName).toBe('dme-kopia-2026-10-22.json');
    expect(v.kind).toBe('validated-backup');
    expect({ ...summarizeBackup(v.backup), packsDropped: 0 }).toEqual(v.summary);
    repo.close();
  });

  it('dla File bez podanej nazwy używa file.name', async () => {
    const { repo } = await seededRepository();
    const file = new File([await exportText(repo)], 'moja-kopia.json', { type: 'application/json' });
    const parsed = await repo.parseAndValidateBackup(file);
    expect(parsed.ok && parsed.value.fileName).toBe('moja-kopia.json');
    repo.close();
  });
});

describe('F02 — round-trip eksport → import', () => {
  it('daje równoważne dane w nowej bazie (historia, otwarta sesja, snapshoty, kolejka, ustawienia, blokady, zgłoszenia)', async () => {
    const { repo: source } = await seededRepository();
    const text = await exportText(source);
    const sourceState = await source.loadUserState();

    const { repo: target } = freshRepository();
    const replaced = await target.replaceAllFromBackup(await validated(target, text), { ...EXPORT_INPUT, safetyBackupId: 'safety-1' });
    expect(replaced.ok).toBe(true);
    expect(await target.loadUserState()).toEqual(sourceState);
    const reExported = JSON.parse(await exportText(target)) as BackupFileV1;
    expect(reExported.data).toEqual((JSON.parse(text) as BackupFileV1).data);
    source.close();
    target.close();
  });

  it('import do tej samej bazy nie podwaja zdarzeń ani prób', async () => {
    const { repo, data } = await seededRepository();
    const text = await exportText(repo);
    const before = await repo.loadUserState();
    const result = await repo.replaceAllFromBackup(await validated(repo, text), { ...EXPORT_INPUT, safetyBackupId: 'safety-1' });
    expect(result.ok).toBe(true);
    const after = await repo.loadUserState();
    expect(after).toEqual(before);
    if (!after.ok) throw new Error('load');
    expect(Object.keys(after.value.events)).toHaveLength(data.events.length);
    expect(Object.keys(after.value.attempts)).toHaveLength(data.attempts.length);
    repo.close();
  });

  it('zastępuje WSZYSTKIE dane (rekordy spoza kopii znikają), zachowując kopię bezpieczeństwa poprzedniego stanu', async () => {
    const { repo: source } = await seededRepository();
    const text = await exportText(source);

    // Docelowa baza ma inne dane: tylko jedną sesję Free Flow + paczkę.
    const { repo: target } = freshRepository();
    const other = sampleUserData();
    const onlyFreeFlow = {
      ...other,
      sessions: other.sessions.filter((s) => s.id === 'sess-3').map((s) => ({ ...s, id: 'sess-local' })),
      attempts: [],
      questionStats: [],
      blocks: [],
      events: [],
    };
    for (const s of onlyFreeFlow.sessions) s.events = s.events.map((e) => ({ ...e, sessionId: 'sess-local' }) as typeof e);
    expect((await target.commit(seedChangeset(onlyFreeFlow))).ok).toBe(true);
    const targetBefore = await target.loadUserState();

    const v = await validated(target, text);
    const replaced = await target.replaceAllFromBackup(v, { now: '2026-10-22T12:00:00.000Z', appVersion: '1.0.0', bankVersions: [], safetyBackupId: 'safety-A' });
    if (!replaced.ok) throw new Error(replaced.error.code);
    expect(replaced.value.summary).toEqual(v.summary);
    expect(replaced.value.safetyBackup).toMatchObject({
      id: 'safety-A',
      createdAt: '2026-10-22T12:00:00.000Z',
      reason: 'before_restore',
      fileName: 'dme-przed-wczytaniem-2026-10-22.json',
    });
    const after = await target.loadUserState();
    if (!after.ok) throw new Error('load');
    expect(after.value.sessions['sess-local']).toBeUndefined();
    expect(Object.keys(after.value.sessions).sort()).toEqual(['sess-1', 'sess-2', 'sess-3']);

    // Kopia sprzed zamiany: dostępna na liście, do pobrania i do przywrócenia.
    const list = await target.listBackups();
    expect(list.ok && list.value.map((b) => b.id)).toEqual(['safety-A']);
    const file = await target.getBackupFile('safety-A');
    if (!file.ok) throw new Error(file.error.code);
    expect(file.value.fileName).toBe('dme-przed-wczytaniem-2026-10-22.json');
    expect(file.value.sizeBytes).toBe(Buffer.byteLength(file.value.text, 'utf8'));
    const restored = await target.replaceAllFromBackup(await validated(target, file.value.text, file.value.fileName), {
      now: '2026-10-22T12:05:00.000Z',
      appVersion: '1.0.0',
      bankVersions: [],
      safetyBackupId: 'safety-B',
    });
    expect(restored.ok).toBe(true);
    expect(await target.loadUserState()).toEqual(targetBefore);
    const list2 = await target.listBackups();
    expect(list2.ok && list2.value.map((b) => b.id)).toEqual(['safety-B', 'safety-A']);
    source.close();
    target.close();
  });

  it(`przechowuje najwyżej ${SAFETY_BACKUPS_KEPT} automatycznych kopii (najstarsze usuwane)`, async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    for (let i = 0; i < SAFETY_BACKUPS_KEPT + 2; i += 1) {
      const now = `2026-10-22T1${i}:00:00.000Z`;
      const result = await repo.replaceAllFromBackup(await validated(repo, text), { now, appVersion: '1', bankVersions: [], safetyBackupId: `safety-${i}` });
      expect(result.ok).toBe(true);
    }
    const list = await repo.listBackups();
    expect(list.ok && list.value.map((b) => b.id)).toEqual(['safety-6', 'safety-5', 'safety-4', 'safety-3', 'safety-2']);
    const missing = await repo.getBackupFile('safety-0');
    expect(!missing.ok && missing.error.code).toBe('NotFound');
    repo.close();
  });
});

describe('F03 — błędny plik nie zmienia danych', () => {
  it('uszkodzony JSON', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const error = await expectRejected(repo, text.slice(0, text.length / 2), 'InvalidBackup', /JSON/);
    expect(error.messagePl).toMatch(/Dane na tym urządzeniu nie zostały zmienione/);
    expect(error.messagePl).toMatch(/„plik\.json”/);
    repo.close();
  });

  it('JSON, który nie jest kopią tej aplikacji (inny format, appId, plik puli)', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    await expectRejected(repo, '[]', 'InvalidBackup');
    await expectRejected(repo, mutate(text, (f) => { f.format = 'inna-kopia' as never; }), 'InvalidBackup', /dme-backup/);
    await expectRejected(repo, mutate(text, (f) => { f.appId = 'inna-aplikacja' as never; }), 'InvalidBackup');
    await expectRejected(repo, JSON.stringify({ format: 'dme-runtime-bank', format_version: 1, questions: [] }), 'InvalidBackup', /Import puli pytań/);
    repo.close();
  });

  it('nieznana (nowsza) wersja formatu → UnsupportedBackupVersion (S24e)', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const error = await expectRejected(repo, mutate(text, (f) => { f.formatVersion = 2 as never; }), 'UnsupportedBackupVersion');
    expect(error).toMatchObject({ foundVersion: 2, supportedVersion: 1 });
    expect(error.messagePl).toMatch(/format 2/);
    expect(error.messagePl).toMatch(/nowszej wersji aplikacji/);
    await expectRejected(repo, mutate(text, (f) => { f.formatVersion = '1' as never; }), 'InvalidBackup', /formatVersion/);
    repo.close();
  });

  it('za duży plik (> 25 MB) — tekst i Blob, bez czytania treści', async () => {
    const { repo } = await seededRepository();
    const error = await expectRejected(repo, 'x'.repeat(BACKUP_MAX_BYTES + 1), 'BackupTooLarge');
    expect(error).toMatchObject({ sizeBytes: BACKUP_MAX_BYTES + 1, maxBytes: BACKUP_MAX_BYTES });
    expect(error.messagePl).toMatch(/limit 25 MB/);
    const blob = new Blob([new Uint8Array(BACKUP_MAX_BYTES + 10)]);
    const textSpy = vi.spyOn(blob, 'text');
    await expectRejected(repo, blob, 'BackupTooLarge');
    expect(textSpy).not.toHaveBeenCalled();
    repo.close();
  });

  it('brakujące referencje: próba→sesja/slot, plan→slot, blokada→zdarzenie, powtórka→rodzic, statystyka→sesja', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const cases: [string, (f: BackupFileV1) => void, RegExp][] = [
      ['próba→sesja', (f) => { (f.data.attempts[0] as { sessionId: string }).sessionId = 'brak-sesji'; }, /nieistniejącą sesję „brak-sesji”/],
      ['próba→slot', (f) => { (f.data.attempts[0] as { slotId: string }).slotId = 'brak-slotu'; }, /nieistniejący slot „brak-slotu”/],
      ['plan→slot', (f) => { f.data.sessions[0]?.plan.push('slot-widmo'); }, /plan wskazuje nieistniejący slot „slot-widmo”/],
      ['blokada→zdarzenie', (f) => { (f.data.blocks[0] as { eventId: string }).eventId = 'ev-widmo'; }, /nieistniejące zdarzenie zgłoszenia „ev-widmo”/],
      ['blokada→sesja', (f) => { (f.data.blocks[0] as { sessionId: string }).sessionId = 'sess-widmo'; }, /Blokada „block-1”: wskazuje nieistniejącą sesję/],
      ['powtórka→rodzic', (f) => {
        const s2 = f.data.sessions.find((s) => s.id === 'sess-2');
        if (s2?.retry) s2.retry.sourceSessionId = 'rodzic-widmo';
      }, /powtórka wskazuje nieistniejącą sesję „rodzic-widmo”/],
      ['statystyka→sesja', (f) => { (f.data.questionStats.find((s) => s.lastWrongSessionId !== null) as { lastWrongSessionId: string }).lastWrongSessionId = 'sess-widmo'; }, /lastWrongSessionId/],
      ['zdarzenie→sesja', (f) => { (f.data.events[0] as { sessionId: string }).sessionId = 'sess-widmo'; }, /Zdarzenie „.+”: wskazuje nieistniejącą sesję/],
      ['wykluczenie→zdarzenie', (f) => {
        const slot = f.data.sessions.find((s) => s.id === 'sess-2')?.slots['s2-b'];
        if (slot?.excluded) slot.excluded.eventId = 'ev-nieznane';
      }, /wykluczenie wskazuje nieistniejące zdarzenie/],
    ];
    for (const [name, fn, reason] of cases) {
      const error = await expectRejected(repo, mutate(text, (f) => fn(f)), 'InvalidBackup', reason);
      expect(error.code, name).toBe('InvalidBackup');
    }
    repo.close();
  });

  it('błędne enumy i daty', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const cases: [(f: BackupFileV1) => void, RegExp][] = [
      [(f) => { (f.data.sessions[0] as { status: string }).status = 'done'; }, /pole „status” — niedozwolona wartość/],
      [(f) => { (f.data.sessions[0] as { kind: string }).kind = 'exam'; }, /pole „kind”/],
      [(f) => { (f.data.attempts[0] as { domainId: string }).domainId = 'XYZ'; }, /pole „domainId”/],
      [(f) => { (f.data.sessions[0]?.slots['s1-a'] as { origin: string }).origin = 'random'; }, /pole „origin”/],
      [(f) => { (f.data.sessions[0]?.config as { difficulty: string }).difficulty = 'hard'; }, /pole „difficulty”/],
      [(f) => { (f.data.questionStats[0] as { streak: number }).streak = 2; }, /pole „streak”/],
      [(f) => { (f.data.events[0] as { type: string }).type = 'hacked'; }, /nieznany typ zdarzenia/],
      [(f) => { (f.data.attempts[0] as { answeredAt: string }).answeredAt = '2026-02-30T10:00:00.000Z'; }, /pole „answeredAt” — oczekiwano daty ISO/],
      [(f) => { (f.data.sessions[0] as { createdAt: string }).createdAt = '22.10.2026'; }, /pole „createdAt”/],
      [(f) => { (f.data.blocks[0] as { createdAt: string }).createdAt = '2026-10-21T18:03:00'; }, /pole „createdAt”/],
      [(f) => { f.exportedAt = 'wczoraj'; }, /exportedAt/],
      [(f) => { (f.data.sessions[0] as { seed: number }).seed = 2 ** 32; }, /pole „seed”/],
      [(f) => { (f.data.sessions[0] as { seed: number }).seed = 1.5; }, /pole „seed”/],
      [(f) => { delete (f.data as Partial<BackupFileV1['data']>).packs; }, /Brak listy „packs”/],
      [(f) => { Object.assign(f.data.attempts[0] as object, { id: '__proto__', commandId: '__proto__' }); }, /pole „id” — oczekiwano niepustego identyfikatora/],
    ];
    for (const [fn, reason] of cases) await expectRejected(repo, mutate(text, (f) => fn(f)), 'InvalidBackup', reason);
    repo.close();
  });

  it('niespójne snapshoty i sesje', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const cases: [(f: BackupFileV1) => void, RegExp][] = [
      [(f) => { (f.data.sessions[0]?.slots['s1-a']?.snapshot as { correctOptionId: string }).correctOptionId = 'Z'; }, /klucz .*nie wskazuje wariantu/],
      [(f) => { f.data.sessions[0]?.slots['s1-a']?.snapshot.options.pop(); }, /dokładnie 4 warianty/],
      [(f) => {
        const att = f.data.sessions[0]?.slots['s1-a']?.attempt;
        if (att) att.correct = !att.correct;
      }, /ocena odpowiedzi nie zgadza się z kluczem/],
      [(f) => { (f.data.sessions[0]?.slots['s1-a'] as { questionId: string }).questionId = 'INNE-Q1'; }, /snapshot dotyczy innego pytania/],
      [(f) => { (f.data.sessions[0]?.slots['s1-a']?.snapshot.sources[0] as { url: string }).url = 'javascript:alert(1)'; }, /https/],
      [(f) => { (f.data.sessions[0] as { result: unknown }).result = null; }, /wynik może \(i musi\) mieć wyłącznie ukończony test/],
      [(f) => { (f.data.sessions[2] as { status: string }).status = 'open'; }, /najwyżej jedna/],
      [(f) => { f.data.attempts.push({ ...(f.data.attempts[0] as BackupFileV1['data']['attempts'][number]) }); }, /więcej niż raz/],
      [(f) => { (f.data.attempts[0] as { optionId: string }).optionId = 'Q'; }, /wariant spoza snapshotu/],
      [(f) => { f.data.settings.push({ ...(f.data.settings[0] as BackupFileV1['data']['settings'][number]) }); }, /więcej niż jeden rekord ustawień/],
    ];
    for (const [fn, reason] of cases) await expectRejected(repo, mutate(text, (f) => fn(f)), 'InvalidBackup', reason);
    repo.close();
  });

  it('paczka pytań w kopii (także z HTML/skryptem) → odrzucona przy wczytaniu, dane bez paczek', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const base = sampleUserData().sessions[0]?.slots['s1-a']?.snapshot;
    if (!base) throw new Error('fixture');
    const pack = {
      id: 'pack-1',
      importedAt: '2026-10-21T10:00:00.000Z',
      fileName: 'pula.json',
      bankVersion: 'p1',
      sourceFormat: 'runtime-v1',
      questions: [
        {
          id: 'P-Q1',
          revision: 1,
          family_id: 'P-F1',
          fingerprint: 'a'.repeat(64),
          domain_id: 'ANAT',
          topic_ids: ['ANAT-T01'],
          difficulty: 'basic',
          stem_pl: 'Pytanie <img src=x onerror=alert(1)>',
          options: [
            { id: 'A', text_pl: 'a' },
            { id: 'B', text_pl: 'b' },
            { id: 'C', text_pl: 'c' },
            { id: 'D', text_pl: 'd' },
          ],
          correct_option_id: 'A',
          correct_explanation_pl: 'Wyjaśnienie.',
          source_ids: ['A01'],
          source_locator_pl: 'abstrakt',
          question_type: 'text',
          figure_id: null,
          explanation_figure_id: null,
          review_status: 'draft',
          approved_for_question_key: false,
          content_check_status: 'seed_draft_not_rechecked',
          cognitive_level: null,
        },
      ],
      sources: { A01: { id: 'A01', title: 'Źródło', url: 'https://example.org/a', doi: null, pmid: null, kind: null, kind_pl: 'przegląd', access: null, access_pl: '', checked_on: null } },
      topics: {},
      figures: {},
      summary: { added: 1, updated: 0, skippedSame: 0, skippedBlocked: 0, rejected: 0 },
    };
    // Od V15 zaimportowane pule w kopii są ODRZUCANE w całości (nie sprawdzane i nie przywracane) — także złośliwe.
    const parsed = await repo.parseAndValidateBackup(mutate(text, (f) => { f.data.packs = [pack] as never; }), 'plik.json');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.backup.data.packs).toEqual([]);
    expect(parsed.value.summary.packsDropped).toBe(1);
    expect(JSON.stringify(parsed.value.backup)).not.toContain('P-Q1');
    repo.close();
  });

  it('błąd zapisu podczas zamiany (QuotaExceeded) → stary stan nietknięty, brak kopii bezpieczeństwa', async () => {
    const { repo: source } = await seededRepository();
    const text = await exportText(source);
    const { repo: target } = freshRepository();
    const local = sampleUserData();
    local.sessions = local.sessions.filter((s) => s.id === 'sess-1');
    local.attempts = local.attempts.filter((a) => a.sessionId === 'sess-1');
    local.events = local.events.filter((e) => 'sessionId' in e && e.sessionId === 'sess-1');
    local.blocks = [];
    local.questionStats = [];
    expect((await target.commit(seedChangeset(local))).ok).toBe(true);
    const before = await target.loadUserState();
    const v = await validated(target, text);

    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'events') (this.transaction as unknown as { _abort(name: string): void })._abort('QuotaExceededError');
      return request;
    });
    const result = await target.replaceAllFromBackup(v, { ...EXPORT_INPUT, safetyBackupId: 'safety-x' });
    vi.restoreAllMocks();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QuotaExceeded');
    expect(await target.loadUserState()).toEqual(before);
    const list = await target.listBackups();
    expect(list.ok && list.value).toEqual([]);
    // Ponowienie po zwolnieniu miejsca działa.
    const retry = await target.replaceAllFromBackup(v, { ...EXPORT_INPUT, safetyBackupId: 'safety-x' });
    expect(retry.ok).toBe(true);
    source.close();
    target.close();
  });

  it('obiekt kopii spoza parseAndValidateBackup jest walidowany ponownie przed zamianą', async () => {
    const { repo } = await seededRepository();
    const text = await exportText(repo);
    const before = await repo.loadUserState();
    const v = await validated(repo, text);
    const tampered: ValidatedBackup = structuredClone(v);
    (tampered.backup.data.attempts[0] as { sessionId: string }).sessionId = 'sess-widmo';
    const rejected = await repo.replaceAllFromBackup(tampered, { ...EXPORT_INPUT, safetyBackupId: 's1' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('InvalidBackup');
    expect(await repo.loadUserState()).toEqual(before);
    const cloned = await repo.replaceAllFromBackup(structuredClone(v), { ...EXPORT_INPUT, safetyBackupId: 's2' });
    expect(cloned.ok).toBe(true);
    repo.close();
  });

  it('getBackupFile dla nieistniejącej kopii → NotFound', async () => {
    const { repo } = freshRepository();
    const result = await repo.getBackupFile('brak');
    expect(!result.ok && result.error.code).toBe('NotFound');
    repo.close();
  });
});
