/**
 * E06 we współpracy z domeną (kontrakt `src/domain/api.ts`): zgłoszenie (domena) → blokada
 * w IndexedDB → walidacja i import paczki (trwałość) → katalog i pula (domena).
 *
 * Dodatkowo odporność na nieaktualny fingerprint zapisany w banku (ARCHITEKTURA_APP §8.1:
 * generator liczy go z tekstu sprzed poprawek odstępów): treść porównywana jest po tekście
 * (znormalizowany stem + posortowane warianty), a nie wyłącznie po zapisanym odcisku.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCatalog, emptyUserState, poolFor, reportQuestion } from '../../src/domain/api';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { Block, Catalog, CommandContext, IdKind, PackImportPlan, RuntimeBank, RuntimeQuestion, UserState } from '../../src/domain/types';
import type { Repository } from '../../src/persistence/api';
import { parseAndValidatePack, validatePackFile } from '../../src/persistence/packs';
import type { PackFileMeta } from '../../src/persistence/packs';
import {
  BANK,
  bank10Pack,
  bankCatalogView,
  bankQuestionsWithValidFingerprint,
  derivedQuestion,
  freshRepository,
  runtimePack,
  sampleUserData,
} from './fixtures';

const NOW = '2026-10-22T11:00:00.000Z';
/** Odcisk niezgodny z treścią (symulacja wady generatora banku). */
const STALE = createHash('sha256').update('nieaktualny odcisk treści', 'utf8').digest('hex');

let commandCounter = 0;
function ctx(): CommandContext {
  commandCounter += 1;
  const prefix = `c${commandCounter}`;
  let n = 0;
  return {
    now: NOW,
    nextDayStart: '2026-10-22T22:00:00.000Z',
    commandId: `cmd-${prefix}`,
    newId: (kind: IdKind) => `${kind}-${prefix}-${(n += 1)}`,
  };
}

function meta(packId: string): PackFileMeta {
  return { fileName: `${packId}.json`, packId, now: NOW };
}

function catalogOf(bank: RuntimeBank, packs: Parameters<typeof buildCatalog>[1] = []): Catalog {
  const built = buildCatalog(bank, packs);
  if (!built.ok) throw new Error(built.error.code);
  return built.value;
}

async function loadState(repo: Repository): Promise<UserState> {
  const loaded = await repo.loadUserState();
  if (!loaded.ok) throw new Error(loaded.error.code);
  return loaded.value;
}

async function catalogFromRepo(repo: Repository, bank: RuntimeBank): Promise<Catalog> {
  const packs = await repo.listPacks();
  if (!packs.ok) throw new Error(packs.error.code);
  return catalogOf(bank, packs.value);
}

/** Zgłoszenie poza sesją (domena) i zapis changesetu w bazie. Zwraca stan wczytany z bazy. */
async function reportOutsideSession(repo: Repository, catalog: Catalog, questionId: string): Promise<{ state: UserState; block: Block }> {
  const before = await loadState(repo);
  const reported = reportQuestion(before, catalog, { sessionId: null, slotId: null, questionId, expectedRevision: null }, ctx());
  if (!reported.ok) throw new Error(reported.error.code);
  const saved = await repo.commit(reported.value.changeset);
  expect(saved.ok).toBe(true);
  const state = await loadState(repo);
  const block = Object.values(state.blocks).find((b) => b.questionId === questionId);
  if (!block) throw new Error('brak blokady w bazie');
  return { state, block };
}

/** Walidacja (z prawdziwym `Catalog` i `UserState`) i zapis paczki w bazie. */
async function importPackFile(repo: Repository, catalog: Catalog, state: UserState, pack: unknown, packId: string): Promise<PackImportPlan> {
  const plan = await parseAndValidatePack(JSON.stringify(pack), meta(packId), catalog, state);
  expect(plan.fatal).toEqual([]);
  const saved = await repo.importPack(plan.record);
  expect(saved.ok).toBe(true);
  return plan;
}

/** Ta sama treść w przebraniu: nowe ID i rodzina, odwrócona kolejność i inne ID wariantów, inne odstępy i wielkość liter. */
async function disguised(base: RuntimeQuestion, newId: string): Promise<RuntimeQuestion> {
  const ids = ['W', 'X', 'Y', 'Z'];
  const reversed = [...base.options].reverse();
  const keyIndex = reversed.findIndex((o) => o.id === base.correct_option_id);
  const question: RuntimeQuestion = {
    ...structuredClone(base),
    id: newId,
    family_id: `${newId}-F`,
    stem_pl: `  ${base.stem_pl.toUpperCase()}  `,
    options: reversed.map((o, i) => ({ id: ids[i] as string, text_pl: ` ${o.text_pl}  ` })),
    correct_option_id: ids[keyIndex] as string,
  };
  question.fingerprint = await fingerprintRuntimeQuestion(question);
  return question;
}

/** Bank z nieaktualnym zapisanym fingerprintem pytania `questionId`. */
function bankWithStaleFingerprint(questionId: string): RuntimeBank {
  const bank = structuredClone(BANK);
  const question = bank.questions.find((q) => q.id === questionId);
  if (!question) throw new Error('fixture');
  question.fingerprint = STALE;
  return bank;
}

async function validQuestion(skip: number): Promise<RuntimeQuestion> {
  const [question] = await bankQuestionsWithValidFingerprint(1, skip);
  if (!question) throw new Error('fixture');
  return question;
}

describe('E06 — domena + trwałość: zgłoszone pytanie nie wraca pod nowym ID', () => {
  it('zgłoszenie → blokada w bazie → ta sama treść pod nowym ID i w nowej rodzinie pominięta; katalog i pula bez niej', async () => {
    const { repo } = freshRepository();
    const reportedQuestion = await validQuestion(11);
    const catalog0 = catalogOf(BANK);
    const { state, block } = await reportOutsideSession(repo, catalog0, reportedQuestion.id);
    expect(block).toMatchObject({ questionId: reportedQuestion.id, fingerprint: reportedQuestion.fingerprint, familyId: reportedQuestion.family_id, revokedAt: null });

    const copy = await disguised(reportedQuestion, 'NEW-ID-1');
    expect(copy.fingerprint).toBe(block.fingerprint);
    const plan = await importPackFile(repo, catalog0, state, runtimePack([copy]), 'pack-runtime');
    expect(plan.skippedBlockedIds).toEqual(['NEW-ID-1']);
    expect(plan.addedIds).toEqual([]);
    expect(plan.record.questions).toEqual([]);

    // Schemat banku 1.0 (fingerprint liczy wyłącznie aplikacja) — ten sam wynik.
    const plan10 = await importPackFile(repo, catalog0, state, bank10Pack([await disguised(reportedQuestion, 'NEW-ID-2')]), 'pack-bank10');
    expect(plan10.skippedBlockedIds).toEqual(['NEW-ID-2']);

    const catalog1 = await catalogFromRepo(repo, BANK);
    expect(catalog1.questionsById['NEW-ID-1']).toBeUndefined();
    expect(catalog1.questionsById['NEW-ID-2']).toBeUndefined();
    const pool = poolFor(catalog1, state, 'ALL', 'mixed', NOW);
    expect(pool.questionIds).not.toContain(reportedQuestion.id);
    expect(pool.questionIds).not.toContain('NEW-ID-1');
    // Import nie zmienił blokad ani historii.
    expect(await loadState(repo)).toEqual(state);
    repo.close();
  });

  it('wariant rodziny zaimportowany wcześniej znika z puli po zgłoszeniu pytania z tej rodziny; ponowny import pominięty', async () => {
    const { repo } = freshRepository();
    const base = await validQuestion(13);
    const variant = await derivedQuestion(base, 'VARIANT-1');
    variant.family_id = base.family_id;

    const added = await importPackFile(repo, catalogOf(BANK), emptyUserState(), runtimePack([variant]), 'pack-variant');
    expect(added.addedIds).toEqual(['VARIANT-1']);
    const catalog1 = await catalogFromRepo(repo, BANK);
    expect(catalog1.questionsById['VARIANT-1']?.fingerprint).toBe(variant.fingerprint);
    expect(poolFor(catalog1, emptyUserState(), 'ALL', 'mixed', NOW).questionIds).toContain('VARIANT-1');

    const { state } = await reportOutsideSession(repo, catalog1, base.id);
    const pool = poolFor(await catalogFromRepo(repo, BANK), state, 'ALL', 'mixed', NOW);
    expect(pool.questionIds).not.toContain(base.id);
    expect(pool.questionIds).not.toContain('VARIANT-1');

    const variant2 = await derivedQuestion(base, 'VARIANT-2', ' (drugi wariant z paczki)');
    variant2.family_id = base.family_id;
    const again = await importPackFile(repo, catalog1, state, runtimePack([variant2]), 'pack-variant-2');
    expect(again.skippedBlockedIds).toEqual(['VARIANT-2']);
    repo.close();
  });
});

describe('nieaktualny fingerprint zapisany w banku (ARCHITEKTURA_APP §8.1)', () => {
  it('blokada z nieaktualnym odciskiem nadal obejmuje tę samą treść pod nowym ID i w nowej rodzinie', async () => {
    const { repo } = freshRepository();
    const original = await validQuestion(17);
    const staleBank = bankWithStaleFingerprint(original.id);
    const catalog0 = catalogOf(staleBank);
    expect(catalog0.questionsById[original.id]?.fingerprint).toBe(STALE);

    const { state, block } = await reportOutsideSession(repo, catalog0, original.id);
    expect(block.fingerprint).toBe(STALE);
    const copy = await disguised(original, 'NEW-STALE-1');
    expect(copy.fingerprint).not.toBe(block.fingerprint);

    const plan = await importPackFile(repo, catalog0, state, runtimePack([copy]), 'pack-stale');
    expect(plan.skippedBlockedIds).toEqual(['NEW-STALE-1']);
    expect(plan.record.questions).toEqual([]);
    const pool = poolFor(await catalogFromRepo(repo, staleBank), state, 'ALL', 'mixed', NOW);
    expect(pool.questionIds).not.toContain('NEW-STALE-1');
    repo.close();
  });

  it('bez blokady: ta sama treść pod nowym ID to duplikat, a pod tym samym ID i rewizją — pominięta (nie konflikt)', async () => {
    const original = await validQuestion(19);
    const catalog = catalogOf(bankWithStaleFingerprint(original.id));
    // Ta sama treść pod nowym ID (osobny plik — w jednym pliku byłby to duplikat w pliku).
    const copyPlan = await validatePackFile(runtimePack([await disguised(original, 'NEW-STALE-2')]), meta('pack-dup'), catalog, emptyUserState());
    expect(copyPlan.fatal).toEqual([]);
    expect(copyPlan.addedIds).toEqual([]);
    expect(copyPlan.skippedSameIds).toEqual(['NEW-STALE-2']);
    expect(copyPlan.record.questions).toEqual([]);
    // To samo ID i rewizja, ta sama treść (fingerprint w pliku zgodny z treścią, w banku nieaktualny).
    const samePlan = await validatePackFile(runtimePack([structuredClone(original)]), meta('pack-same'), catalog, emptyUserState());
    expect(samePlan.fatal).toEqual([]);
    expect(samePlan.rejected).toEqual([]);
    expect(samePlan.skippedSameIds).toEqual([original.id]);
  });

  it('prawdziwy bank: pytania z nieaktualnym odciskiem po zgłoszeniu nie wracają pod nowym ID', async () => {
    const stale: RuntimeQuestion[] = [];
    for (const question of BANK.questions) if ((await fingerprintRuntimeQuestion(question)) !== question.fingerprint) stale.push(question);
    const catalog = catalogOf(BANK);
    for (const question of stale) {
      const { repo } = freshRepository();
      const { state } = await reportOutsideSession(repo, catalog, question.id);
      const plan = await validatePackFile(runtimePack([await disguised(question, `NEW-${question.id}`)]), meta(`pack-${question.id}`), catalog, state);
      expect(plan.fatal, question.id).toEqual([]);
      expect(plan.skippedBlockedIds, question.id).toEqual([`NEW-${question.id}`]);
      repo.close();
    }
  });

  it('pytania nie ma już w katalogu: blokada rozpoznaje treść ze snapshotu w historii', async () => {
    const data = sampleUserData();
    const block = data.blocks[0] as Block;
    const sessions = Object.fromEntries(data.sessions.map((s) => [s.id, s]));
    const snapshot = sessions[block.sessionId as string]?.slots[block.slotId as string]?.snapshot;
    if (!snapshot) throw new Error('fixture');
    const withdrawn = BANK.questions.find((q) => q.id === block.questionId) as RuntimeQuestion;
    const view = bankCatalogView();
    const questionsById = { ...view.questionsById };
    delete questionsById[block.questionId];
    const copy = await disguised(withdrawn, 'NEW-FROM-SNAPSHOT');

    const state = { blocks: { [block.id]: { ...block, fingerprint: STALE } }, sessions };
    const plan = await validatePackFile(runtimePack([copy]), meta('pack-snap'), { ...view, questionsById }, state);
    expect(plan.skippedBlockedIds).toEqual(['NEW-FROM-SNAPSHOT']);
    // Bez historii (tylko blokada z nieaktualnym odciskiem, nowa rodzina) nie ma czego dopasować.
    const blind = await validatePackFile(runtimePack([copy]), meta('pack-snap-2'), { ...view, questionsById }, { blocks: state.blocks });
    expect(blind.addedIds).toEqual(['NEW-FROM-SNAPSHOT']);
  });
});
