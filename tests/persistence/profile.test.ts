/**
 * Trwałość profili (DECYZJE §16): właściciel bazy, kopia formatu 2 z mailem, scalenie historii bez profilu
 * w jednej transakcji (atomowe, bez duplikatów przy ponowieniu).
 */
import { describe, expect, it } from 'vitest';
import type { UserState } from '../../src/domain/types';
import { profileDbName } from '../../src/profiles/profiles';
import { freshRepository, sampleUserData, seededRepository } from './fixtures';

const MONIKA = 'monika@doktormonika.pl';

function toUserState(data: ReturnType<typeof sampleUserData>): UserState {
  const by = <T>(rs: T[], k: (r: T) => string) => Object.fromEntries(rs.map((r) => [k(r), r]));
  return {
    settings: data.settings[0]!,
    sessions: by(data.sessions, (s) => s.id),
    attempts: by(data.attempts, (a) => a.id),
    questionStats: by(data.questionStats, (s) => s.questionId),
    blocks: by(data.blocks, (b) => b.id),
    events: by(data.events, (e) => e.id),
  };
}

const INPUT = { now: '2026-10-25T08:00:00.000Z', mergeId: 'm-1', sourceDb: 'doktor-monika-egzamin', safetyBackupId: 'safety-1', appVersion: 't', bankVersions: [] };

describe('kopia formatu 2 (mail profilu)', () => {
  it('eksport z bazy profilu zawiera właściciela; podsumowanie pokazuje profil źródłowy', async () => {
    const { repo } = await seededRepository({ dbName: profileDbName(MONIKA as never), owner: MONIKA });
    const exported = await repo.exportBackup({ now: INPUT.now, appVersion: 't', bankVersions: [] });
    if (!exported.ok) throw new Error(exported.error.code);
    expect(JSON.parse(exported.value.text)).toMatchObject({ formatVersion: 2, profileEmail: MONIKA });
    const parsed = await repo.parseAndValidateBackup(exported.value.text, 'k.json');
    expect(parsed.ok && parsed.value.summary.profileEmail).toBe(MONIKA);
    repo.close();
  });

  it('mail normalizowany (wielkość liter, spacje); adres spoza listy i brak pola w formacie 2 → odrzucenie bez zmian', async () => {
    const { repo } = await seededRepository();
    const exported = await repo.exportBackup({ now: INPUT.now, appVersion: 't', bankVersions: [] });
    if (!exported.ok) throw new Error(exported.error.code);
    const file = JSON.parse(exported.value.text) as Record<string, unknown>;
    const parse = (patch: Record<string, unknown>) => repo.parseAndValidateBackup(JSON.stringify({ ...file, ...patch }), 'k.json');
    const upper = await parse({ profileEmail: '  Monika@DoktorMonika.PL ' });
    expect(upper.ok && upper.value.summary.profileEmail).toBe(MONIKA);
    expect(await parse({ profileEmail: 'obcy@example.com' })).toMatchObject({ ok: false, error: { code: 'InvalidBackup' } });
    expect(await parse({ profileEmail: undefined })).toMatchObject({ ok: false, error: { code: 'InvalidBackup' } });
    const v1 = await parse({ formatVersion: 1, profileEmail: undefined });
    expect(v1.ok && v1.value.summary.profileEmail).toBeNull();
    repo.close();
  });
});

describe('scalenie historii bez profilu', () => {
  it('do pustego profilu: wszystkie rekordy, rekord przypisania; ponowienie z tym samym id nic nie duplikuje', async () => {
    const source = toUserState(sampleUserData());
    const { repo } = freshRepository({ owner: MONIKA });
    const first = await repo.mergeUnassignedHistory(source, INPUT);
    expect(first).toMatchObject({ ok: true, value: { alreadyMerged: false, counts: { sessions: Object.keys(source.sessions).length } } });
    const again = await repo.mergeUnassignedHistory(source, { ...INPUT, safetyBackupId: 'safety-2' });
    expect(again).toMatchObject({ ok: true, value: { alreadyMerged: true } });
    const loaded = await repo.loadUserState();
    if (!loaded.ok) throw new Error(loaded.error.code);
    expect(loaded.value).toEqual(source);
    // Pusty profil — bez kopii bezpieczeństwa (nie było czego zabezpieczać).
    expect(await repo.listBackups()).toEqual({ ok: true, value: [] });
    expect(await repo.readOwner()).toEqual({ ok: true, value: MONIKA });
    repo.close();
  });

  it('przerwanie w trakcie transakcji (błędny rekord) → profil bez zmian, bez rekordu przypisania; ponowienie działa', async () => {
    const source = toUserState(sampleUserData());
    const broken: UserState = { ...source, events: { ...source.events, zly: { id: undefined } as never } };
    const { repo } = await seededRepository({ owner: MONIKA, dbName: 'dme-test-profil-przerwanie' });
    const before = await repo.loadUserState();
    const failed = await repo.mergeUnassignedHistory(broken, INPUT);
    expect(failed.ok).toBe(false);
    expect(await repo.loadUserState()).toEqual(before);
    expect(await repo.listBackups()).toEqual({ ok: true, value: [] });
    const retried = await repo.mergeUnassignedHistory(source, INPUT);
    expect(retried).toMatchObject({ ok: true, value: { alreadyMerged: false } });
    repo.close();
  });
});
