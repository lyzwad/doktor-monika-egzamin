/**
 * Import dodatkowej puli pytań (DECYZJE §10; kryteria B01, E06, G04; ekrany S22h–S22i).
 */
import { describe, expect, it } from 'vitest';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { Block, Catalog, PackImportPlan, RuntimeQuestion, UserState } from '../../src/domain/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IMPORTED_UNREVIEWED_STATUS, PACK_MAX_BYTES, parseAndValidatePack, validatePackFile } from '../../src/persistence/packs';
import type { PackCatalogView, PackFileMeta, PackStateView } from '../../src/persistence/packs';
import {
  BANK,
  bank10Pack,
  bankCatalogView,
  bankQuestion,
  bankQuestionsWithValidFingerprint,
  derivedQuestion,
  runtimePack,
  seededRepository,
} from './fixtures';

const META: PackFileMeta = { fileName: 'pula-test.json', packId: 'pack-1', now: '2026-10-22T11:00:00.000Z' };
const NO_BLOCKS = { blocks: {} };

function codes(plan: PackImportPlan): string[] {
  return plan.fatal.map((i) => i.code);
}

function blockFor(question: RuntimeQuestion, patch: Partial<Block> = {}): Block {
  return {
    id: `block-${question.id}`,
    questionId: question.id,
    revision: question.revision,
    fingerprint: question.fingerprint,
    familyId: question.family_id,
    domainId: question.domain_id,
    stemPreview: question.stem_pl,
    reason: 'reported',
    createdAt: '2026-10-21T10:00:00.000Z',
    sessionId: null,
    slotId: null,
    eventId: 'ev-x',
    revokedAt: null,
    ...patch,
  };
}

async function newQuestions(n: number): Promise<RuntimeQuestion[]> {
  const bases = await bankQuestionsWithValidFingerprint(n);
  return Promise.all(bases.map((q, i) => derivedQuestion(q, `PACK-Q${String(i + 1).padStart(3, '0')}`)));
}

describe('kontrakt importu', () => {
  it('Catalog i UserState z domeny spełniają widoki PackCatalogView/PackStateView (kontrola typów)', () => {
    const catalogView = (catalog: Catalog): PackCatalogView => catalog;
    const stateView = (state: UserState): PackStateView => state;
    expect(typeof catalogView).toBe('function');
    expect(typeof stateView).toBe('function');
  });
});

describe('walidacja paczki — poprawne pliki', () => {
  it('runtime v1: nowe pytania przyjęte, fingerprint przeliczony, rejestry ograniczone do użytych', async () => {
    const questions = await newQuestions(3);
    const plan = await validatePackFile(runtimePack(questions), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.rejected).toEqual([]);
    expect(plan.addedIds).toEqual(['PACK-Q001', 'PACK-Q002', 'PACK-Q003']);
    expect(plan.record).toMatchObject({
      id: 'pack-1',
      importedAt: META.now,
      fileName: 'pula-test.json',
      bankVersion: 'paczka-test-2026-10-22',
      sourceFormat: 'runtime-v1',
      summary: { added: 3, updated: 0, skippedSame: 0, skippedBlocked: 0, rejected: 0 },
    });
    expect(plan.record.questions.map((q) => q.fingerprint)).toEqual(questions.map((q) => q.fingerprint));
    expect(Object.keys(plan.record.sources).sort()).toEqual([...new Set(questions.flatMap((q) => q.source_ids))].sort());
    for (const source of Object.values(plan.record.sources)) expect(source.url === null || source.url.startsWith('https://')).toBe(true);
  });

  it('schemat banku 1.0: fingerprint liczony przez aplikację, rejestr źródeł z pliku, tematy z katalogu', async () => {
    const questions = await newQuestions(2);
    const plan = await validatePackFile(bank10Pack(questions), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.record.sourceFormat).toBe('bank-1.0');
    expect(plan.addedIds).toEqual(['PACK-Q001', 'PACK-Q002']);
    for (const [i, q] of plan.record.questions.entries()) {
      expect(q.fingerprint).toBe(await fingerprintRuntimeQuestion(questions[i] as RuntimeQuestion));
      // LOG-07: bez proweniencji — jawnie „zaimportowane, nieprzejrzane”, nie status seedbanku.
      expect(q.content_check_status).toBe(IMPORTED_UNREVIEWED_STATUS);
      expect(q.content_check_status).not.toBe('seed_draft_not_rechecked');
    }
  });

  it('LOG-07: status z deklarowanej proweniencji (bank 1.0) i z pola runtime przenoszony bez zmian', async () => {
    const questions = await newQuestions(2);
    const pack = bank10Pack(questions);
    const raw = pack.questions as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>).provenance = { content_check_status: 'independently_checked_draft' };
    const plan = await validatePackFile(pack, META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.record.questions.map((q) => q.content_check_status)).toEqual(['independently_checked_draft', IMPORTED_UNREVIEWED_STATUS]);
    const runtime = await validatePackFile(runtimePack(questions), META, bankCatalogView(), NO_BLOCKS);
    expect(runtime.record.questions.map((q) => q.content_check_status)).toEqual(questions.map((q) => q.content_check_status));
  });

  it('LOG-07: jedno źródło reguł importu — domena nie ma drugiego walidatora paczek', async () => {
    const domainApi: Record<string, unknown> = await import('../../src/domain/api');
    expect('validatePack' in domainApi).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/domain/pack.ts'))).toBe(false);
    // Kontroler importuje paczki wyłącznie przez walidator trwałości.
    const controllerSource = readFileSync(resolve(process.cwd(), 'src/app/appController.ts'), 'utf-8');
    expect(controllerSource).toContain("from '../persistence/packs'");
  });

  it('ta sama treść pod istniejącym ID → pominięta; wyższa rewizja → nowa rewizja; inna treść bez wyższej rewizji → odrzucona pozycja', async () => {
    const [same, base2, base3] = await bankQuestionsWithValidFingerprint(3);
    if (!same || !base2 || !base3) throw new Error('fixture');
    const revised: RuntimeQuestion = { ...structuredClone(base2), revision: base2.revision + 1, stem_pl: `${base2.stem_pl} (poprawione)` };
    revised.fingerprint = await fingerprintRuntimeQuestion(revised);
    const conflicting: RuntimeQuestion = { ...structuredClone(base3), stem_pl: `${base3.stem_pl} (inna treść)` };
    conflicting.fingerprint = await fingerprintRuntimeQuestion(conflicting);
    const [fresh] = await newQuestions(1);
    const plan = await validatePackFile(runtimePack([same, revised, conflicting, fresh as RuntimeQuestion]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.skippedSameIds).toEqual([same.id]);
    expect(plan.updatedIds).toEqual([base2.id]);
    expect(plan.addedIds).toEqual(['PACK-Q001']);
    expect(plan.rejected.map((i) => [i.questionId, i.code])).toEqual([[base3.id, 'ID_CONFLICT']]);
    expect(plan.rejected[0]?.messagePl).toMatch(/bez wyższej rewizji/);
    expect(plan.record.questions.map((q) => q.id)).toEqual([base2.id, 'PACK-Q001']);
    expect(plan.record.summary).toEqual({ added: 1, updated: 1, skippedSame: 1, skippedBlocked: 0, rejected: 1 });
  });

  it('duplikat treści istniejącego pytania pod nowym ID → pominięty (bez podwójnego pytania)', async () => {
    const [base] = await bankQuestionsWithValidFingerprint(1);
    if (!base) throw new Error('fixture');
    const copy: RuntimeQuestion = { ...structuredClone(base), id: 'PACK-COPY', family_id: 'PACK-COPY-F' };
    const plan = await validatePackFile(runtimePack([copy]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.skippedSameIds).toEqual(['PACK-COPY']);
    expect(plan.record.questions).toEqual([]);
  });

  it('to samo ID i rewizja, te same warianty, ale inny klucz albo wyjaśnienie → odrzucona pozycja (nie „pominięty duplikat”)', async () => {
    const [base, base2] = await bankQuestionsWithValidFingerprint(2, 3);
    if (!base || !base2) throw new Error('fixture');
    const otherKey = base.options.find((o) => o.id !== base.correct_option_id)?.id as string;
    const keyChanged: RuntimeQuestion = { ...structuredClone(base), correct_option_id: otherKey };
    const explanationChanged: RuntimeQuestion = { ...structuredClone(base2), correct_explanation_pl: `${base2.correct_explanation_pl} Inne uzasadnienie.` };
    // Ta sama treść z innymi ID wariantów (klucz wskazuje ten sam tekst) → nadal to samo pytanie.
    const [base3] = await bankQuestionsWithValidFingerprint(1, 9);
    if (!base3) throw new Error('fixture');
    const renamed: RuntimeQuestion = {
      ...structuredClone(base3),
      options: base3.options.map((o, i) => ({ id: `R${i}`, text_pl: o.text_pl })),
      correct_option_id: `R${base3.options.findIndex((o) => o.id === base3.correct_option_id)}`,
    };
    const plan = await validatePackFile(runtimePack([keyChanged, explanationChanged, renamed]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.rejected.map((i) => [i.questionId, i.code])).toEqual([
      [base.id, 'ID_CONFLICT'],
      [base2.id, 'ID_CONFLICT'],
    ]);
    expect(plan.skippedSameIds).toEqual([base3.id]);
    expect(plan.record.questions).toEqual([]);
  });

  it('wyższa rewizja powtarzająca treść innego pytania → odrzucona pozycja (bez dwóch ID z tą samą treścią)', async () => {
    const [target, other] = await bankQuestionsWithValidFingerprint(2, 21);
    if (!target || !other) throw new Error('fixture');
    const clash: RuntimeQuestion = { ...structuredClone(target), revision: target.revision + 1, stem_pl: other.stem_pl, options: structuredClone(other.options), correct_option_id: other.correct_option_id };
    clash.fingerprint = await fingerprintRuntimeQuestion(clash);
    const plan = await validatePackFile(runtimePack([clash]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.updatedIds).toEqual([]);
    expect(plan.rejected.map((i) => [i.questionId, i.code])).toEqual([[target.id, 'DUPLICATE_CONTENT']]);
    expect(plan.rejected[0]?.messagePl).toContain(other.id);
  });
});

describe('E06 — blokady obowiązują pod nowym ID', () => {
  it('ta sama treść pod nowym ID i w nowej rodzinie → pominięta jako zablokowana (fingerprint paczki = fingerprint blokady)', async () => {
    const [blocked] = await bankQuestionsWithValidFingerprint(1, 5);
    if (!blocked) throw new Error('fixture');
    const block = blockFor(blocked);
    // Ta sama treść: inna kolejność i ID wariantów, inne odstępy i wielkość liter.
    const disguised: RuntimeQuestion = {
      ...structuredClone(blocked),
      id: 'NEW-ID-777',
      family_id: 'NEW-FAMILY-777',
      stem_pl: `  ${blocked.stem_pl.toUpperCase()}  `,
      options: [...blocked.options].reverse().map((o, i) => ({ id: ['W', 'X', 'Y', 'Z'][i] as string, text_pl: `${o.text_pl} ` })),
      correct_option_id: 'Z',
    };
    disguised.fingerprint = await fingerprintRuntimeQuestion(disguised);
    expect(disguised.fingerprint).toBe(block.fingerprint);

    const plan = await validatePackFile(runtimePack([disguised]), META, bankCatalogView(), { blocks: { [block.id]: block } });
    expect(plan.fatal).toEqual([]);
    expect(plan.skippedBlockedIds).toEqual(['NEW-ID-777']);
    expect(plan.record.questions).toEqual([]);
    expect(plan.record.summary.skippedBlocked).toBe(1);

    // To samo w schemacie banku 1.0 (fingerprint liczony wyłącznie przez aplikację).
    const plan10 = await validatePackFile(bank10Pack([disguised]), META, bankCatalogView(), { blocks: { [block.id]: block } });
    expect(plan10.skippedBlockedIds).toEqual(['NEW-ID-777']);
  });

  it('blokada rodziny obejmuje nowy wariant tej rodziny; odwołana blokada nie blokuje', async () => {
    const [base] = await bankQuestionsWithValidFingerprint(1, 7);
    if (!base) throw new Error('fixture');
    const variant = await derivedQuestion(base, 'VARIANT-1');
    variant.family_id = base.family_id;
    const block = blockFor(base);
    const blockedPlan = await validatePackFile(runtimePack([variant]), META, bankCatalogView(), { blocks: { [block.id]: block } });
    expect(blockedPlan.skippedBlockedIds).toEqual(['VARIANT-1']);
    const revoked = { ...block, revokedAt: '2026-10-22T08:00:00.000Z' };
    const openPlan = await validatePackFile(runtimePack([variant]), META, bankCatalogView(), { blocks: { [block.id]: revoked } });
    expect(openPlan.addedIds).toEqual(['VARIANT-1']);
  });

  it('import zablokowanej treści nie zmienia blokad ani historii w bazie', async () => {
    const { repo, data } = await seededRepository();
    const state = await repo.loadUserState();
    if (!state.ok) throw new Error('load');
    const block = data.blocks[0] as Block;
    const reported = bankQuestion(block.questionId);
    const sameContent: RuntimeQuestion = { ...structuredClone(reported), id: 'REIMPORT-1', family_id: 'REIMPORT-F' };
    sameContent.fingerprint = await fingerprintRuntimeQuestion(sameContent);
    expect(sameContent.fingerprint).toBe(block.fingerprint);
    const plan = await parseAndValidatePack(JSON.stringify(runtimePack([sameContent])), META, bankCatalogView(), state.value);
    expect(plan.skippedBlockedIds).toEqual(['REIMPORT-1']);
    expect((await repo.importPack(plan.record)).ok).toBe(true);
    const after = await repo.loadUserState();
    expect(after).toEqual(state);
    repo.close();
  });
});

describe('walidacja paczki — odrzucenie całego pliku (pula bez zmian)', () => {
  async function fatalFor(mutateQuestion: (q: Record<string, unknown>) => void, format: 'runtime' | 'bank' = 'runtime'): Promise<PackImportPlan> {
    const questions = await newQuestions(2);
    const pack = format === 'runtime' ? runtimePack(questions) : bank10Pack(questions);
    mutateQuestion((pack.questions as Record<string, unknown>[])[0] as Record<string, unknown>);
    const plan = await validatePackFile(pack, META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal.length).toBeGreaterThan(0);
    expect(plan.record.questions).toEqual([]);
    expect(plan.addedIds).toEqual([]);
    return plan;
  }

  it('znaczniki HTML i skrypty w treściach', async () => {
    for (const payload of ['<b>pogrubienie</b>', '<script>alert(1)</script>', 'tekst <img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', 'zobacz javascript:alert(1)', '<!-- komentarz -->']) {
      const plan = await fatalFor((q) => {
        q.stem_pl = `Pytanie ${payload}`;
      });
      expect(codes(plan)).toContain('UNSAFE_CONTENT');
      expect(plan.fatal.find((i) => i.code === 'UNSAFE_CONTENT')?.messagePl).toMatch(/PACK-Q001: treść zawiera znaczniki HTML/);
    }
    const inOption = await fatalFor((q) => {
      (q.options as { text_pl: string }[])[2] = { ...(q.options as { id: string; text_pl: string }[])[2] as { id: string; text_pl: string }, text_pl: '<a href="x">link</a>' };
    });
    expect(codes(inOption)).toContain('UNSAFE_CONTENT');
    // Zwykłe znaki porównania nie są znacznikami.
    const ok = await newQuestions(1);
    (ok[0] as RuntimeQuestion).stem_pl = 'Gdy stężenie < 5 mg i > 2 mg, a odległość <1 cm';
    (ok[0] as RuntimeQuestion).fingerprint = await fingerprintRuntimeQuestion(ok[0] as RuntimeQuestion);
    const okPlan = await validatePackFile(runtimePack(ok), META, bankCatalogView(), NO_BLOCKS);
    expect(okPlan.fatal).toEqual([]);
  });

  it('niebezpieczny lub nie-https URL źródła', async () => {
    for (const url of ['javascript:alert(1)', 'http://example.org/a', 'data:text/html,<b>x</b>', 'https://user:pass@example.org/', 'ftp://example.org']) {
      const questions = await newQuestions(1);
      const pack = runtimePack(questions);
      const sid = (questions[0] as RuntimeQuestion).source_ids[0] as string;
      (pack.sources as Record<string, Record<string, unknown>>)[sid] = { ...(pack.sources as Record<string, Record<string, unknown>>)[sid], url };
      const plan = await validatePackFile(pack, META, bankCatalogView(), NO_BLOCKS);
      expect(codes(plan)).toContain('UNSAFE_URL');
    }
    // Brak URL jest dopuszczalny.
    const questions = await newQuestions(1);
    const pack = runtimePack(questions);
    const sid = (questions[0] as RuntimeQuestion).source_ids[0] as string;
    (pack.sources as Record<string, Record<string, unknown>>)[sid] = { ...(pack.sources as Record<string, Record<string, unknown>>)[sid], url: null };
    expect((await validatePackFile(pack, META, bankCatalogView(), NO_BLOCKS)).fatal).toEqual([]);
  });

  it('zakazane pola: option_rationales_pl, oral_case, expected_reasoning_pl, część ustna', async () => {
    for (const key of ['option_rationales_pl', 'oral_case', 'expected_reasoning_pl']) {
      const plan = await fatalFor((q) => {
        q[key] = { A: 'uzasadnienie' };
      });
      expect(codes(plan)).toContain('OUT_OF_SCOPE');
    }
    const questions = await newQuestions(1);
    const plan = await validatePackFile(runtimePack(questions, { oral_cases: [] }), META, bankCatalogView(), NO_BLOCKS);
    expect(codes(plan)).toContain('OUT_OF_SCOPE');
  });

  it('B01: nie 4 warianty, powtórzone warianty, klucz spoza wariantów, lista kluczy, duplikat ID', async () => {
    const three = await fatalFor((q) => {
      (q.options as unknown[]).pop();
    });
    expect(three.fatal.find((i) => i.code === 'OPTIONS_NOT_4')?.messagePl).toBe('PACK-Q001: 3 warianty odpowiedzi zamiast 4');
    const dupText = await fatalFor((q) => {
      const options = q.options as { id: string; text_pl: string }[];
      options[1] = { id: options[1]?.id as string, text_pl: ` ${(options[0] as { text_pl: string }).text_pl.toUpperCase()}` };
    });
    expect(codes(dupText)).toContain('OPTION_TEXTS');
    const dupIds = await fatalFor((q) => {
      const options = q.options as { id: string; text_pl: string }[];
      (options[1] as { id: string }).id = (options[0] as { id: string }).id;
    });
    expect(codes(dupIds)).toContain('OPTION_IDS');
    const badKey = await fatalFor((q) => {
      q.correct_option_id = 'E';
    });
    expect(badKey.fatal.find((i) => i.code === 'KEY_NOT_IN_OPTIONS')?.messagePl).toMatch(/klucz „E” nie wskazuje/);
    const twoKeys = await fatalFor((q) => {
      q.correct_option_id = ['A', 'B'];
    });
    expect(twoKeys.fatal.find((i) => i.code === 'KEY_NOT_IN_OPTIONS')?.messagePl).toMatch(/dokładnie jeden wariant/);

    const questions = await newQuestions(2);
    (questions[1] as RuntimeQuestion).id = (questions[0] as RuntimeQuestion).id;
    const dupId = await validatePackFile(runtimePack(questions), META, bankCatalogView(), NO_BLOCKS);
    expect(codes(dupId)).toContain('DUPLICATE_ID');
  });

  it('źródło spoza rejestru paczki, brak źródeł, nieznany temat, enumy', async () => {
    expect(codes(await fatalFor((q) => { q.source_ids = ['NIEZNANE-99']; }))).toContain('SOURCE_NOT_IN_REGISTRY');
    expect(codes(await fatalFor((q) => { q.source_ids = []; }))).toContain('SOURCE_REFERENCES');
    expect(codes(await fatalFor((q) => { q.topic_ids = ['TEMAT-WIDMO']; }))).toContain('TOPIC_REFERENCE');
    expect(codes(await fatalFor((q) => { q.domain_id = 'XYZ'; }))).toContain('DOMAIN');
    expect(codes(await fatalFor((q) => { q.difficulty = 'easy'; }))).toContain('DIFFICULTY');
    expect(codes(await fatalFor((q) => { q.revision = 0; }))).toContain('REVISION');
    expect(codes(await fatalFor((q) => { q.question_type = 'video'; }))).toContain('QUESTION_TYPE');
    expect(codes(await fatalFor((q) => { q.approved_for_question_key = 'tak'; }))).toContain('APPROVAL_FIELD');
    expect(codes(await fatalFor((q) => { q.approved_for_question_key = true; }, 'bank'))).toContain('APPROVAL_WITHOUT_REVIEW');
    expect(codes(await fatalFor((q) => { q.stem_pl = '   '; }))).toContain('TEXT_FIELD');
    expect(codes(await fatalFor((q) => { q.id = '__proto__'; }))).toContain('QUESTION_ID');
  });

  it('niezgodny fingerprint (runtime) i duplikat treści w pliku', async () => {
    expect(codes(await fatalFor((q) => { q.fingerprint = 'b'.repeat(64); }))).toContain('FINGERPRINT_MISMATCH');
    expect(codes(await fatalFor((q) => { q.fingerprint = 'nie-hex'; }))).toContain('FINGERPRINT_FORMAT');
    const questions = await newQuestions(1);
    const twin: RuntimeQuestion = { ...structuredClone(questions[0] as RuntimeQuestion), id: 'PACK-TWIN', family_id: 'PACK-TWIN-F' };
    const plan = await validatePackFile(runtimePack([questions[0] as RuntimeQuestion, twin]), META, bankCatalogView(), NO_BLOCKS);
    expect(codes(plan)).toContain('EXACT_DUPLICATE');
  });

  it('ścieżki mediów spoza paczki są odrzucane', async () => {
    for (const file of ['../../etc/passwd', '/figures/x.svg', 'https://example.org/x.svg', 'figures\\x.svg', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)']) {
      const questions = await newQuestions(1);
      const plan = await validatePackFile(
        runtimePack(questions, { figures: { F1: { id: 'F1', file, alt_pl: 'a', caption_pl: '', variant: 'question', source_ids: [], review_status: 'x', scope_notes_pl: '' } } }),
        META,
        bankCatalogView(),
        NO_BLOCKS,
      );
      expect(codes(plan).some((c) => c === 'UNSAFE_MEDIA_PATH' || c === 'UNSAFE_CONTENT')).toBe(true);
    }
  });

  it('pola pliku: wersja, status oficjalny, puste pytania, format nieznany, plik kopii zamiast puli', async () => {
    const questions = await newQuestions(1);
    expect(codes(await validatePackFile(runtimePack(questions, { format_version: 2 }), META, bankCatalogView(), NO_BLOCKS))).toEqual(['UNSUPPORTED_VERSION']);
    expect(codes(await validatePackFile(bank10Pack(questions, { schema_version: '2.0' }), META, bankCatalogView(), NO_BLOCKS))).toEqual(['UNSUPPORTED_VERSION']);
    expect(codes(await validatePackFile(runtimePack(questions, { official_exam_question_bank: true }), META, bankCatalogView(), NO_BLOCKS))).toContain('OFFICIAL_BANK');
    expect(codes(await validatePackFile(runtimePack([], {}), META, bankCatalogView(), NO_BLOCKS))).toContain('EMPTY_PACK');
    expect(codes(await validatePackFile({ questions }, META, bankCatalogView(), NO_BLOCKS))).toEqual(['UNKNOWN_FORMAT']);
    expect(codes(await validatePackFile({ format: 'dme-backup', formatVersion: 1 }, META, bankCatalogView(), NO_BLOCKS))).toEqual(['WRONG_FILE']);
    expect(codes(await validatePackFile([1, 2], META, bankCatalogView(), NO_BLOCKS))).toEqual(['NOT_OBJECT']);
  });

  it('uszkodzony JSON i za duży plik', async () => {
    const broken = await parseAndValidatePack('{"questions": [', META, bankCatalogView(), NO_BLOCKS);
    expect(codes(broken)).toEqual(['INVALID_JSON']);
    const huge = await parseAndValidatePack(new Blob([new Uint8Array(PACK_MAX_BYTES + 1)]), META, bankCatalogView(), NO_BLOCKS);
    expect(codes(huge)).toEqual(['FILE_TOO_LARGE']);
    expect(huge.fatal[0]?.messagePl).toMatch(/limit 25 MB/);
  });

  it('lista niezgodności jest ograniczona (resztę podsumowuje jedna pozycja)', async () => {
    const questions = await newQuestions(1);
    const many = Array.from({ length: 150 }, (_, i) => ({ ...structuredClone(questions[0] as RuntimeQuestion), id: `BAD-${i}`, options: [] }));
    const plan = await validatePackFile(runtimePack(many as RuntimeQuestion[]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal.length).toBe(101);
    expect(plan.fatal[100]?.code).toBe('MORE_ISSUES');
  });
});

describe('walidacja paczki — pozycje odrzucone pojedynczo', () => {
  it('pytanie ze schematem bez dostarczonej ilustracji → pozycja odrzucona, reszta przyjęta', async () => {
    const questions = await newQuestions(2);
    // explanation_figure_id: null — bazowe pytanie banku może mieć własny schemat objaśniający (np. ANAT-Q001 rev. 2).
    const schematic = { ...(questions[0] as RuntimeQuestion), question_type: 'schematic' as const, figure_id: 'FIG-BRAK', explanation_figure_id: null };
    const plan = await validatePackFile(runtimePack([schematic, questions[1] as RuntimeQuestion]), META, bankCatalogView(), NO_BLOCKS);
    expect(plan.fatal).toEqual([]);
    expect(plan.rejected.map((i) => [i.questionId, i.code])).toEqual([['PACK-Q001', 'FIGURE_NOT_DELIVERED']]);
    expect(plan.addedIds).toEqual(['PACK-Q002']);

    // Ilustracja obecna w aplikacji → przyjęte.
    const catalog: PackCatalogView = { ...bankCatalogView(), figures: { 'FIG-BRAK': { id: 'FIG-BRAK' } } };
    const withFigure = await validatePackFile(runtimePack([schematic]), META, catalog, NO_BLOCKS);
    expect(withFigure.addedIds).toEqual(['PACK-Q001']);
  });

  it('pytanie ze schematem bez figure_id → odrzucenie pliku', async () => {
    const questions = await newQuestions(1);
    const plan = await validatePackFile(runtimePack([{ ...(questions[0] as RuntimeQuestion), question_type: 'schematic', figure_id: null }]), META, bankCatalogView(), NO_BLOCKS);
    expect(codes(plan)).toContain('FIGURE_REFERENCE');
  });
});

describe('importPack — zapis w magazynie packs', () => {
  it('zapisuje paczkę i zdarzenie w jednej transakcji; nie rusza historii, blokad ani otwartej sesji', async () => {
    const { repo } = await seededRepository();
    const before = await repo.loadUserState();
    if (!before.ok) throw new Error('load');
    const plan = await validatePackFile(runtimePack(await newQuestions(2)), META, bankCatalogView(), before.value);
    expect(plan.fatal).toEqual([]);
    const result = await repo.importPack(plan.record, {
      commandId: 'cmd-import-1',
      guards: [],
      stores: {
        events: {
          put: [{ id: 'ev-pack-1', at: META.now, commandId: 'cmd-import-1', type: 'pack_imported', packId: 'pack-1', added: 2, updated: 0, skipped: 0 }],
          delete: [],
        },
      },
    });
    expect(result).toEqual({ ok: true, value: undefined });
    const after = await repo.loadUserState();
    if (!after.ok) throw new Error('load');
    expect(after.value.sessions).toEqual(before.value.sessions);
    expect(after.value.blocks).toEqual(before.value.blocks);
    expect(after.value.attempts).toEqual(before.value.attempts);
    expect(after.value.events['ev-pack-1']).toBeDefined();
    const packs = await repo.listPacks();
    expect(packs.ok && packs.value.map((p) => p.id)).toEqual(['pack-1']);
    expect(packs.ok && packs.value[0]?.questions.length).toBe(2);

    // Paczka trafia do kopii i wraca z nią (round-trip).
    const exported = await repo.exportBackup({ now: META.now, appVersion: '1', bankVersions: [BANK.bank_version, 'paczka-test-2026-10-22'] });
    if (!exported.ok) throw new Error('export');
    const parsed = await repo.parseAndValidateBackup(exported.value.text, exported.value.fileName);
    expect(parsed.ok && parsed.value.summary.packs).toBe(1);
    repo.close();
  });

  it('importPack nie przyjmuje usuwania danych w changesecie i nie zapisuje niczego przy błędzie', async () => {
    const { repo } = await seededRepository();
    const before = await repo.loadUserState();
    const plan = await validatePackFile(runtimePack(await newQuestions(1)), META, bankCatalogView(), NO_BLOCKS);
    const result = await repo.importPack(plan.record, { commandId: 'x', guards: [], stores: { blocks: { put: [], delete: ['block-1'] } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WriteFailed');
    expect(await repo.loadUserState()).toEqual(before);
    const packs = await repo.listPacks();
    expect(packs.ok && packs.value).toEqual([]);
    repo.close();
  });

  it('listPacks zwraca paczki w kolejności importu', async () => {
    const { repo } = await seededRepository();
    const questions = await newQuestions(2);
    const later = await validatePackFile(runtimePack([questions[0] as RuntimeQuestion]), { ...META, packId: 'p-later', now: '2026-10-22T12:00:00.000Z' }, bankCatalogView(), NO_BLOCKS);
    const earlier = await validatePackFile(runtimePack([questions[1] as RuntimeQuestion]), { ...META, packId: 'p-earlier', now: '2026-10-22T09:00:00.000Z' }, bankCatalogView(), NO_BLOCKS);
    expect((await repo.importPack(later.record)).ok).toBe(true);
    expect((await repo.importPack(earlier.record)).ok).toBe(true);
    const packs = await repo.listPacks();
    expect(packs.ok && packs.value.map((p) => p.id)).toEqual(['p-earlier', 'p-later']);
    repo.close();
  });
});
