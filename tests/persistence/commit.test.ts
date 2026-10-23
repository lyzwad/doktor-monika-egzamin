/**
 * `commit(changeset)` — JEDNA transakcja readwrite, guards rewizji, atomowość i mapowanie błędów
 * (DECYZJE §1, §10; kryteria F01, F03, G03 „symulacja braku miejsca nie zgłasza fikcyjnego sukcesu”).
 */
import { IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Changeset, DmeEvent, QuestionStat, Session } from '../../src/domain/types';
import { seededRepository, freshRepository } from './fixtures';

function sessionOf(data: { sessions: Session[] }, id: string): Session {
  const s = data.sessions.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
}

/** Changeset jak z domeny: odpowiedź w otwartej sesji `sess-2` (slot s2-c) — sesja + próba + statystyka + zdarzenie. */
function answerChangeset(session: Session, commandId = 'cmd-answer-1'): Changeset {
  const slot = session.slots['s2-c'];
  if (!slot) throw new Error('slot');
  const optionId = slot.snapshot.correctOptionId;
  const answeredAt = '2026-10-22T09:00:00.000Z';
  const updated: Session = {
    ...session,
    revision: session.revision + 1,
    mutationSeq: session.mutationSeq + 1,
    updatedAt: answeredAt,
    slots: { ...session.slots, 's2-c': { ...slot, attempt: { commandId, optionId, correct: true, answeredAt } } },
  };
  const stat: QuestionStat = {
    questionId: slot.questionId,
    familyId: slot.snapshot.familyId,
    domainId: slot.snapshot.domainId,
    seenCount: 1,
    firstSeenAt: answeredAt,
    lastSeenAt: answeredAt,
    answeredCount: 1,
    correctCount: 1,
    wrongCount: 0,
    lastAnsweredAt: answeredAt,
    activeError: false,
    streak: 0,
    dueAt: null,
    lastWrongAt: null,
    lastWrongSessionId: null,
    streakSessionId: null,
    resolvedAt: null,
  };
  const event: DmeEvent = { id: `ev-${commandId}`, at: answeredAt, commandId, type: 'my_errors_exhausted', sessionId: session.id };
  return {
    commandId,
    guards: [{ sessionId: session.id, expectedRevision: session.revision }],
    stores: {
      sessions: { put: [updated], delete: [] },
      attempts: {
        put: [
          {
            id: commandId,
            commandId,
            sessionId: session.id,
            sessionKind: session.kind,
            slotId: 's2-c',
            questionId: slot.questionId,
            questionRevision: slot.snapshot.revision,
            domainId: slot.snapshot.domainId,
            difficulty: slot.snapshot.difficulty,
            optionId,
            optionOrder: slot.optionOrder,
            correct: true,
            answeredAt,
            excluded: false,
            excludedReason: null,
            excludedAt: null,
          },
        ],
        delete: [],
      },
      questionStats: { put: [stat], delete: [] },
      events: { put: [event], delete: [] },
    },
  };
}

describe('commit — zapis w jednej transakcji', () => {
  it('zapisuje put/delete w wielu magazynach i zwraca liczniki dopiero po zakończeniu transakcji', async () => {
    const { repo, data } = await seededRepository();
    const s2 = sessionOf(data, 'sess-2');
    const changeset = answerChangeset(s2);
    changeset.stores.blocks = { put: [], delete: ['block-1'] };
    const result = await repo.commit(changeset);
    expect(result).toEqual({ ok: true, value: { written: 4, deleted: 1 } });
    const state = await repo.loadUserState();
    if (!state.ok) throw new Error('load');
    expect(state.value.sessions['sess-2']?.revision).toBe(s2.revision + 1);
    expect(state.value.sessions['sess-2']?.slots['s2-c']?.attempt?.commandId).toBe('cmd-answer-1');
    expect(state.value.attempts['cmd-answer-1']?.correct).toBe(true);
    expect(state.value.blocks['block-1']).toBeUndefined();
    repo.close();
  });

  it('pusty changeset → sukces bez transakcji', async () => {
    const { repo } = freshRepository();
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await repo.commit({ commandId: 'x', guards: [], stores: {} })).toEqual({ ok: true, value: { written: 0, deleted: 0 } });
    expect(await repo.commit({ commandId: 'x', guards: [], stores: { sessions: { put: [], delete: [] } } })).toEqual({ ok: true, value: { written: 0, deleted: 0 } });
    expect(spy).not.toHaveBeenCalled();
    repo.close();
  });

  it('guard rewizji: nieaktualna rewizja → Conflict, nic nie zapisane', async () => {
    const { repo, data } = await seededRepository();
    const s2 = sessionOf(data, 'sess-2');
    const before = await repo.loadUserState();
    const stale = answerChangeset({ ...s2, revision: s2.revision - 1 });
    const result = await repo.commit(stale);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'Conflict', sessionId: 'sess-2' });
    expect(result.error.messagePl).toMatch(/nie zostały zapisane/);
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('guard nowej sesji (expectedRevision null): istniejący rekord → Conflict', async () => {
    const { repo, data } = await seededRepository();
    const s1 = sessionOf(data, 'sess-1');
    const result = await repo.commit({
      commandId: 'start-again',
      guards: [{ sessionId: 'sess-1', expectedRevision: null }],
      stores: { sessions: { put: [{ ...s1, revision: 99 }], delete: [] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('Conflict');
    const state = await repo.loadUserState();
    if (state.ok) expect(state.value.sessions['sess-1']?.revision).toBe(s1.revision);
    repo.close();
  });

  it('guard nowej sesji (expectedRevision null) przy braku rekordu → zapis', async () => {
    const { repo, data } = await seededRepository();
    const s1 = sessionOf(data, 'sess-1');
    const result = await repo.commit({
      commandId: 'start-new',
      guards: [{ sessionId: 'sess-new', expectedRevision: null }],
      stores: { sessions: { put: [{ ...s1, id: 'sess-new', revision: 1 }], delete: [] } },
    });
    expect(result.ok).toBe(true);
    repo.close();
  });

  it('E06: dwie równoczesne komendy na tej samej rewizji sesji → dokładnie jedna zapisana, druga Conflict', async () => {
    const { repo, data } = await seededRepository();
    const s2 = sessionOf(data, 'sess-2');
    const [first, second] = await Promise.all([repo.commit(answerChangeset(s2, 'cmd-a')), repo.commit(answerChangeset(s2, 'cmd-b'))]);
    expect([first.ok, second.ok]).toEqual([true, false]);
    if (!second.ok) expect(second.error.code).toBe('Conflict');
    const state = await repo.loadUserState();
    if (!state.ok) throw new Error('load');
    expect(state.value.attempts['cmd-a']).toBeDefined();
    expect(state.value.attempts['cmd-b']).toBeUndefined();
    expect(state.value.events['ev-cmd-b']).toBeUndefined();
    expect(state.value.sessions['sess-2']?.revision).toBe(s2.revision + 1);
    repo.close();
  });

  it('błąd w połowie changesetu (rekord bez klucza w 3. magazynie) → brak częściowego zapisu', async () => {
    const { repo, data } = await seededRepository();
    const before = await repo.loadUserState();
    const changeset = answerChangeset(sessionOf(data, 'sess-2'));
    // questionStats jest zapisywany po sessions i attempts — rekord bez `questionId` rzuca DataError.
    changeset.stores.questionStats = { put: [{ seenCount: 1 } as unknown as QuestionStat], delete: [] };
    const result = await repo.commit(changeset);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WriteFailed');
    expect(result.error.messagePl).toMatch(/pozostały bez zmian/);
    expect('cause' in result.error && result.error.cause).toMatch(/DataError/);
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('błąd asynchroniczny żądania w połowie (ConstraintError) → przerwanie całej transakcji', async () => {
    const { repo, data } = await seededRepository();
    const before = await repo.loadUserState();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'questionStats') {
        // Wstawienie przez `add` istniejącego klucza → błąd żądania (ConstraintError) po fakcie.
        return this.add({ ...(value as object), questionId: (data.questionStats[0] as QuestionStat).questionId }, key);
      }
      return original.call(this, value, key);
    });
    const result = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    vi.restoreAllMocks();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WriteFailed');
      expect('cause' in result.error && result.error.cause).toMatch(/ConstraintError/);
    }
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('rekord niemożliwy do sklonowania (funkcja) → WriteFailed, stan bez zmian', async () => {
    const { repo, data } = await seededRepository();
    const before = await repo.loadUserState();
    const changeset = answerChangeset(sessionOf(data, 'sess-2'));
    (changeset.stores.events?.put[0] as unknown as Record<string, unknown>).callback = () => 1;
    const result = await repo.commit(changeset);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WriteFailed');
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('QuotaExceededError (przerwanie transakcji przez przeglądarkę) → QuotaExceeded, stan bez zmian, nigdy sukces', async () => {
    const { repo, data } = await seededRepository();
    const before = await repo.loadUserState();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'attempts') {
        // Jak przeglądarka przy braku miejsca: transakcja przerwana z błędem QuotaExceededError.
        (this.transaction as unknown as { _abort(name: string): void })._abort('QuotaExceededError');
      }
      return request;
    });
    const result = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('QuotaExceeded');
    expect(result.error.messagePl).toMatch(/brakuje miejsca/);
    expect(await repo.loadUserState()).toEqual(before);

    // Ponowienie tej samej komendy (ten sam changeset/commandId) po zwolnieniu miejsca → zapis jednokrotny.
    const retry = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    expect(retry.ok).toBe(true);
    const after = await repo.loadUserState();
    if (!after.ok) throw new Error('load');
    expect(Object.keys(after.value.attempts).filter((k) => k === 'cmd-answer-1')).toHaveLength(1);
    // Powtórzenie po sukcesie z tą samą (już nieaktualną) rewizją → Conflict, bez drugiego zapisu.
    const duplicate = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('Conflict');
    repo.close();
  });

  it('QuotaExceededError rzucony synchronicznie przez put → QuotaExceeded', async () => {
    const { repo, data } = await seededRepository();
    const before = await repo.loadUserState();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'events') throw new DOMException('Brak miejsca', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    const result = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QuotaExceeded');
    vi.restoreAllMocks();
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('utrata połączenia w trakcie zapisu (UnknownError) → WriteFailed; ponowienie otwiera bazę od nowa i zapisuje', async () => {
    const { repo, data, factory } = await seededRepository();
    const before = await repo.loadUserState();
    const openSpy = vi.spyOn(factory, 'open');
    const original = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'sessions') (this.transaction as unknown as { _abort(name: string): void })._abort('UnknownError');
      return request;
    });
    const failed = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    putSpy.mockRestore();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('WriteFailed');
    expect(await repo.loadUserState()).toEqual(before);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const retry = await repo.commit(answerChangeset(sessionOf(data, 'sess-2')));
    expect(retry.ok).toBe(true);
    repo.close();
  });

  it('changeset z magazynem spoza danych użytkownika → WriteFailed bez zapisu', async () => {
    const { repo } = await seededRepository();
    const before = await repo.loadUserState();
    const result = await repo.commit({
      commandId: 'x',
      guards: [],
      stores: { packs: { put: [{ id: 'p' }], delete: [] } } as unknown as Changeset['stores'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WriteFailed');
    expect(await repo.loadUserState()).toEqual(before);
    repo.close();
  });

  it('zapis trwały: dane widoczne po zamknięciu i ponownym otwarciu (F01)', async () => {
    const { repo, data, factory, dbName } = await seededRepository();
    expect((await repo.commit(answerChangeset(sessionOf(data, 'sess-2')))).ok).toBe(true);
    const before = await repo.loadUserState();
    repo.close();
    const { repo: reopened } = freshRepository({ indexedDB: factory, dbName });
    expect(await reopened.loadUserState()).toEqual(before);
    reopened.close();
  });
});
