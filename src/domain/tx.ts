/**
 * Budowniczy zmian jednej komendy: zbiera nowe rekordy, a na końcu tworzy NOWY stan,
 * changeset (jedna transakcja zapisu, DECYZJE §1) i listę zdarzeń. Stan wejściowy nie jest mutowany.
 *
 * Rewizje sesji (DECYZJE §4) nadaje `commit`: każda zapisywana sesja dostaje `revision = poprzednia + 1`
 * (nowa: 1), a `mutationSeq` rośnie o 1 tylko dla sesji oznaczonych jako mutacja punktowa.
 * Dla każdej zapisywanej sesji powstaje strażnik `expectedRevision` (nowa sesja: `null`).
 */
import type {
  Attempt,
  Block,
  BlockId,
  Changeset,
  CommandContext,
  CommandId,
  DmeEvent,
  DomainOutcome,
  QuestionId,
  QuestionStat,
  Session,
  SessionId,
  Settings,
  UserState,
} from './types';

export class Tx {
  readonly base: UserState;
  readonly ctx: CommandContext;
  private readonly sessionPuts = new Map<SessionId, Session>();
  private readonly scoring = new Set<SessionId>();
  private readonly attemptPuts = new Map<CommandId, Attempt>();
  private readonly statPuts = new Map<QuestionId, QuestionStat>();
  private readonly statDeletes = new Set<QuestionId>();
  private readonly blockPuts = new Map<BlockId, Block>();
  private readonly blockDeletes = new Set<BlockId>();
  private readonly eventList: DmeEvent[] = [];
  private settingsPut: Settings | null = null;

  constructor(base: UserState, ctx: CommandContext) {
    this.base = base;
    this.ctx = ctx;
  }

  /** Bieżący widok sesji (zmieniona w tej komendzie albo z bazy). */
  session(id: SessionId): Session | undefined {
    return this.sessionPuts.get(id) ?? this.base.sessions[id];
  }

  /** Zapis sesji. `scoring` = mutacja punktowa (podnosi `mutationSeq`). */
  putSession(session: Session, scoring: boolean): void {
    this.sessionPuts.set(session.id, session);
    if (scoring) this.scoring.add(session.id);
  }

  stat(questionId: QuestionId): QuestionStat | undefined {
    if (this.statDeletes.has(questionId)) return undefined;
    return this.statPuts.get(questionId) ?? this.base.questionStats[questionId];
  }

  /** Wszystkie statystyki z uwzględnieniem zmian tej komendy. */
  stats(): Readonly<Record<QuestionId, QuestionStat>> {
    if (this.statPuts.size === 0 && this.statDeletes.size === 0) return this.base.questionStats;
    const out: Record<QuestionId, QuestionStat> = { ...this.base.questionStats };
    for (const [id, s] of this.statPuts) out[id] = s;
    for (const id of this.statDeletes) delete out[id];
    return out;
  }

  putStat(stat: QuestionStat): void {
    this.statDeletes.delete(stat.questionId);
    this.statPuts.set(stat.questionId, stat);
  }

  deleteStat(questionId: QuestionId): void {
    this.statPuts.delete(questionId);
    if (this.base.questionStats[questionId] !== undefined) this.statDeletes.add(questionId);
  }

  attempt(id: CommandId): Attempt | undefined {
    return this.attemptPuts.get(id) ?? this.base.attempts[id];
  }

  putAttempt(attempt: Attempt): void {
    this.attemptPuts.set(attempt.id, attempt);
  }

  /** Wszystkie próby z uwzględnieniem zmian tej komendy. */
  attempts(): Attempt[] {
    if (this.attemptPuts.size === 0) return Object.values(this.base.attempts);
    const out: Record<CommandId, Attempt> = { ...this.base.attempts };
    for (const [id, a] of this.attemptPuts) out[id] = a;
    return Object.values(out);
  }

  /** Aktywne i odwołane blokady z uwzględnieniem zmian tej komendy. */
  blocks(): Readonly<Record<BlockId, Block>> {
    if (this.blockPuts.size === 0 && this.blockDeletes.size === 0) return this.base.blocks;
    const out: Record<BlockId, Block> = { ...this.base.blocks };
    for (const [id, b] of this.blockPuts) out[id] = b;
    for (const id of this.blockDeletes) delete out[id];
    return out;
  }

  putBlock(block: Block): void {
    this.blockDeletes.delete(block.id);
    this.blockPuts.set(block.id, block);
  }

  deleteBlock(id: BlockId): void {
    this.blockPuts.delete(id);
    if (this.base.blocks[id] !== undefined) this.blockDeletes.add(id);
  }

  addEvent(event: DmeEvent): void {
    this.eventList.push(event);
  }

  putSettings(settings: Settings): void {
    this.settingsPut = settings;
  }

  /** Nowa wartość `mutationSeq`, jaką sesja dostanie przy zapisie jako mutacja punktowa. */
  nextMutationSeq(sessionId: SessionId): number {
    const prev = this.base.sessions[sessionId];
    return prev ? prev.mutationSeq + 1 : 1;
  }

  /** Nowa wartość `revision`, jaką sesja dostanie przy zapisie. */
  nextRevision(sessionId: SessionId): number {
    const prev = this.base.sessions[sessionId];
    return prev ? prev.revision + 1 : 1;
  }

  commit<V>(value: V): DomainOutcome<V> {
    const now = this.ctx.now;
    const changeset: Changeset = { commandId: this.ctx.commandId, guards: [], stores: {} };

    const sessions: Record<SessionId, Session> = { ...this.base.sessions };
    const sessionList: Session[] = [];
    for (const [id, draft] of this.sessionPuts) {
      const prev = this.base.sessions[id];
      const finalSession: Session = {
        ...draft,
        revision: prev ? prev.revision + 1 : 1,
        mutationSeq: prev ? prev.mutationSeq + (this.scoring.has(id) ? 1 : 0) : 0,
        updatedAt: now,
      };
      sessions[id] = finalSession;
      sessionList.push(finalSession);
      changeset.guards.push({ sessionId: id, expectedRevision: prev ? prev.revision : null });
    }
    if (sessionList.length > 0) changeset.stores.sessions = { put: sessionList, delete: [] };

    let attempts = this.base.attempts;
    if (this.attemptPuts.size > 0) {
      const next: Record<CommandId, Attempt> = { ...this.base.attempts };
      for (const [id, a] of this.attemptPuts) next[id] = a;
      attempts = next;
      changeset.stores.attempts = { put: [...this.attemptPuts.values()], delete: [] };
    }

    let questionStats = this.base.questionStats;
    if (this.statPuts.size > 0 || this.statDeletes.size > 0) {
      questionStats = this.stats();
      changeset.stores.questionStats = { put: [...this.statPuts.values()], delete: [...this.statDeletes] };
    }

    let blocks = this.base.blocks;
    if (this.blockPuts.size > 0 || this.blockDeletes.size > 0) {
      blocks = this.blocks();
      changeset.stores.blocks = { put: [...this.blockPuts.values()], delete: [...this.blockDeletes] };
    }

    let events = this.base.events;
    if (this.eventList.length > 0) {
      const next = { ...this.base.events };
      for (const e of this.eventList) next[e.id] = e;
      events = next;
      changeset.stores.events = { put: [...this.eventList], delete: [] };
    }

    let settings = this.base.settings;
    if (this.settingsPut !== null) {
      settings = this.settingsPut;
      changeset.stores.settings = { put: [this.settingsPut], delete: [] };
    }

    const state: UserState = { settings, sessions, attempts, questionStats, blocks, events };
    return { state, changeset, events: [...this.eventList], value };
  }
}

/** Wynik komendy bez zmian (np. idempotentne powtórzenie): ten sam stan, pusty changeset. */
export function unchanged<V>(state: UserState, ctx: CommandContext, value: V): DomainOutcome<V> {
  return { state, changeset: { commandId: ctx.commandId, guards: [], stores: {} }, events: [], value };
}
