/**
 * Skrypt dodatku webinarowego (scripts/webinary-addendum.mjs) — czyste funkcje:
 * - adapter `dme-webinar-addendum` → rekordy `dme-runtime-bank` (pola dodatku 1:1 + pola adaptera, kolejność kluczy),
 * - lokalizator fragmentów (`source_locator_pl`) i tematy `WB-T-<Wxx>-<DOM>`,
 * - scalanie: baza bez zmian, WB dopisane, idempotencja, konflikt ID z listą pól, powtórzony ID w dodatku,
 * - raport par identycznej treści (nic nie jest usuwane),
 * - pliki towarzyszące (retired, profil, allowlista), wersja wydania, kontrola wejść z MANIFEST.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  adaptAddendum,
  buildAllowlist,
  buildProfile,
  buildRelease,
  buildRetired,
  identicalContentPairs,
  mergeBank,
  readInputs,
  releaseBankVersion,
  serializeJson,
  sourceLocator,
  staleDataFiles,
} from '../../scripts/webinary-addendum.mjs';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { RuntimeBank, RuntimeQuestion } from '../../src/domain/types';

/* ---------------- dane syntetyczne ---------------- */

const WEBINAR_KIND = 'user_supplied_webinar_transcript';

function src(id: string, title: string) {
  return { id, title, filename: `${title} (transcribed).txt`, sha256: createHash('sha256').update(title).digest('hex'), kind: WEBINAR_KIND, url: null, locator_type: 'source_unit', audio_verified: false };
}

/** Pytanie dodatku w kolejności kluczy jak w `bank_webinar_addendum.json`. */
function wb(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id,
    domain_id: 'DEV',
    stem_pl: `Pytanie ${id}: [webinar]`,
    options: [
      { id: 'A', text_pl: `Pierwsza ${id}` },
      { id: 'B', text_pl: `Druga ${id}` },
      { id: 'C', text_pl: `Trzecia ${id}` },
      { id: 'D', text_pl: `Czwarta ${id}` },
    ],
    correct_option_id: 'A',
    correct_explanation_pl: `Wyjaśnienie ${id}.`,
    source_id: 'W01',
    evidence_unit_ids: ['W01-U0001'],
    evidence_quote: `Cytat ${id}.`,
    source_note_pl: 'Klucz oparty na wypowiedzi w webinarze.',
    review_status: 'source_checked_AI_draft',
    source_ids: ['W01'],
    question_type: 'text',
    revision: 1,
    family_id: id,
    difficulty: 'basic',
    difficulty_is_technical_placeholder: true,
    origin: 'webinar',
    clinical_signoff: false,
  };
  return { ...base, ...over };
}

function addendum(questions: Record<string, unknown>[] = defaultQuestions()) {
  return {
    format: 'dme-webinar-addendum',
    schema_version: 1,
    bank_version: 'webinar-addendum-test-1',
    integration_mode: 'append',
    count: questions.length,
    clinical_signoff: false,
    official_exam_question_bank: false,
    difficulty_mode: 'ungraded',
    sources: { W01: src('W01', 'Webinar pierwszy'), W02: src('W02', 'Webinar drugi') },
    questions,
  };
}

function defaultQuestions(): Record<string, unknown>[] {
  return [
    wb('WB-A-001'),
    // subdomain występuje tylko w części pytań (np. LAW) — zachowane na swoim miejscu.
    wb('WB-A-002', { domain_id: 'SAFE', source_id: 'W02', source_ids: ['W02'], evidence_unit_ids: ['W02-U0007'], subdomain: 'LAW' }),
    // Dwa źródła; temat z `source_id` (W02), fragmenty w kolejności dodatku, grupy w kolejności `source_ids`.
    wb('WB-A-003', { source_id: 'W02', source_ids: ['W01', 'W02'], evidence_unit_ids: ['W02-U0003', 'W01-U0002'] }),
  ];
}

function v18Question(id: string, domain: string, difficulty: string, status: string, stem: string): RuntimeQuestion {
  return {
    id,
    domain_id: domain,
    topic_ids: ['V-T1'],
    family_id: id,
    revision: 1,
    difficulty,
    question_type: 'text',
    figure_id: null,
    explanation_figure_id: null,
    stem_pl: stem,
    options: [
      { id: 'A', text_pl: 'a' },
      { id: 'B', text_pl: 'b' },
      { id: 'C', text_pl: 'c' },
      { id: 'D', text_pl: 'd' },
    ],
    correct_option_id: 'A',
    correct_explanation_pl: 'Wyjaśnienie.',
    source_ids: ['V-S1'],
    source_locator_pl: 'Abstrakt',
    review_status: 'draft_pending_clinical_review',
    approved_for_question_key: false,
    content_check_status: status,
    cognitive_level: null,
    fingerprint: createHash('sha256').update(id).digest('hex'),
  } as unknown as RuntimeQuestion;
}

function baseBank(): RuntimeBank {
  return {
    format: 'dme-runtime-bank',
    format_version: 1,
    schema_version: '1.0',
    bank_version: 'v18-test',
    built_on: '2026-11-09',
    clinical_signoff: false,
    official_exam_question_bank: false,
    status_pl: 'Pula bazowa.',
    counts: {
      questions: 2,
      families: 2,
      by_domain: { ANAT: 1, DEV: 1 },
      by_difficulty: { intermediate: 1, basic: 1 },
      schematic: 0,
      independently_checked_draft: 1,
      author_checked_draft: 1,
    },
    pool_note_pl: 'Notatka puli.',
    family_merges_note_pl: 'Rodziny bez zmian.',
    domains: [
      { id: 'ANAT', title_pl: 'Anatomia', description_pl: '' },
      { id: 'DEV', title_pl: 'Urządzenia', description_pl: '' },
      { id: 'SAFE', title_pl: 'Bezpieczeństwo', description_pl: '' },
    ],
    topics: { 'V-T1': { id: 'V-T1', title_pl: 'Temat', domain_id: 'ANAT', learning_objective_pl: 'Cel.', clinical_pearls_pl: [] } },
    sources: {
      'V-S1': { id: 'V-S1', title: 'Publikacja', url: 'https://example.org/p', doi: null, pmid: null, kind: 'review', kind_pl: 'przegląd', access: 'abstract', access_pl: 'abstrakt', checked_on: '2026-11-09' },
    },
    figures: {},
    questions: [
      v18Question('V-001', 'ANAT', 'intermediate', 'independently_checked_draft', 'Pierwsze pytanie V18?'),
      v18Question('V-002', 'DEV', 'basic', 'author_checked_draft', 'Drugie pytanie V18?'),
    ],
    difficulty_mode: 'ungraded_ui_preserve_source_metadata',
  } as unknown as RuntimeBank;
}

const SHA = 'a'.repeat(64);
const OPTS = { bankVersion: 'dme-v18-webinary-test', builtOn: '2026-11-15' };

/* ---------------- wersja wydania i serializacja ---------------- */

describe('wersja wydania i serializacja', () => {
  it('bank_version = prefiks + 12 znaków SHA-256 z „<sha V18>+<sha dodatku>”', () => {
    const v18 = '5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6';
    const add = 'ae7a7321f163a5c7bb4fd06529921a4ef5e8c12e2df2c7c52600a37f08aed40c';
    const h12 = createHash('sha256').update(`${v18}+${add}`, 'utf8').digest('hex').slice(0, 12);
    expect(releaseBankVersion(v18, add)).toBe(`dme-v18-webinary-2026-11-15-${h12}`);
  });

  it('serializacja: JSON z wcięciem 2 i końcowym znakiem nowej linii', () => {
    expect(serializeJson({ a: [1, { b: null }] })).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}\n');
  });
});

/* ---------------- lokalizator ---------------- */

describe('sourceLocator — grupy fragmentów wg prefiksu źródła', () => {
  it('kolejność grup = `source_ids`, fragmenty w kolejności dodatku (przykład z kontraktu)', () => {
    expect(sourceLocator({ id: 'X', source_ids: ['W13', 'W16'], evidence_unit_ids: ['W13-U0022', 'W16-U0010', 'W13-U0029'] })).toBe('W13: W13-U0022, W13-U0029; W16: W16-U0010');
  });

  it('WB-USGTR-017: source_ids [W11, W16], fragmenty [W16-U0010, W11-U0033]', () => {
    expect(sourceLocator({ id: 'WB-USGTR-017', source_ids: ['W11', 'W16'], evidence_unit_ids: ['W16-U0010', 'W11-U0033'] })).toBe('W11: W11-U0033; W16: W16-U0010');
  });

  it('źródło bez fragmentów — grupa pominięta', () => {
    expect(sourceLocator({ id: 'X', source_ids: ['W01', 'W02'], evidence_unit_ids: ['W02-U0001'] })).toBe('W02: W02-U0001');
  });

  it('fragment z prefiksem spoza `source_ids` → błąd z ID pytania', () => {
    expect(() => sourceLocator({ id: 'WB-X-1', source_ids: ['W01'], evidence_unit_ids: ['W02-U0001'] })).toThrow(/WB-X-1.*W02-U0001/);
  });
});

/* ---------------- adapter ---------------- */

describe('adaptAddendum — rekordy runtime', () => {
  it('pytanie: pola dodatku bez zmian + pola adaptera, kolejność kluczy, fingerprint algorytmem aplikacji', async () => {
    const input = addendum();
    const adapted = await adaptAddendum(structuredClone(input), { sha256: SHA });
    expect(adapted.questions.map((q) => q.id)).toEqual(['WB-A-001', 'WB-A-002', 'WB-A-003']);
    const [first, second, third] = adapted.questions as unknown as Record<string, unknown>[];
    expect(Object.keys(first!)).toEqual([
      'id',
      'domain_id',
      'topic_ids',
      'family_id',
      'revision',
      'difficulty',
      'difficulty_is_technical_placeholder',
      'question_type',
      'figure_id',
      'explanation_figure_id',
      'stem_pl',
      'options',
      'correct_option_id',
      'correct_explanation_pl',
      'source_ids',
      'source_locator_pl',
      'review_status',
      'approved_for_question_key',
      'content_check_status',
      'cognitive_level',
      'fingerprint',
      'origin',
      'source_id',
      'evidence_unit_ids',
      'evidence_quote',
      'source_note_pl',
      'clinical_signoff',
    ]);
    // subdomain tylko tam, gdzie był, zaraz po source_id.
    expect(Object.keys(second!).slice(21, 24)).toEqual(['origin', 'source_id', 'subdomain']);
    expect(second!.subdomain).toBe('LAW');
    expect('subdomain' in first!).toBe(false);

    for (const [i, raw] of input.questions.entries()) {
      const out = adapted.questions[i] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(raw)) {
        if (key === 'review_status') continue;
        expect(out[key], `${String(raw.id)}.${key}`).toEqual(value);
      }
      expect(out).toMatchObject({
        origin: 'webinar',
        topic_ids: [`WB-T-${String(raw.source_id)}-${String(raw.domain_id)}`],
        figure_id: null,
        explanation_figure_id: null,
        review_status: 'draft_pending_clinical_review',
        approved_for_question_key: false,
        content_check_status: 'source_checked_AI_draft',
        cognitive_level: null,
        clinical_signoff: false,
      });
      expect(out.fingerprint).toBe(await fingerprintRuntimeQuestion(raw as never));
    }
    expect(first!.source_locator_pl).toBe('W01: W01-U0001');
    expect(third!.source_locator_pl).toBe('W01: W01-U0002; W02: W02-U0003');
    expect(third!.topic_ids).toEqual(['WB-T-W02-DEV']);
  });

  it('źródła webinaru: kształt i kolejność kluczy z kontraktu, url/doi/pmid = null', async () => {
    const adapted = await adaptAddendum(addendum(), { sha256: SHA });
    expect(Object.keys(adapted.sources)).toEqual(['W01', 'W02']);
    const w02 = adapted.sources.W02 as unknown as Record<string, unknown>;
    expect(Object.keys(w02)).toEqual(['id', 'title', 'url', 'doi', 'pmid', 'kind', 'kind_pl', 'access', 'access_pl', 'checked_on', 'filename', 'sha256', 'locator_type', 'audio_verified']);
    expect(w02).toEqual({
      id: 'W02',
      title: 'Webinar drugi',
      url: null,
      doi: null,
      pmid: null,
      kind: WEBINAR_KIND,
      kind_pl: 'transkrypcja webinaru',
      access: 'source_unit',
      access_pl: 'fragmenty automatycznych napisów',
      checked_on: null,
      filename: 'Webinar drugi (transcribed).txt',
      sha256: createHash('sha256').update('Webinar drugi').digest('hex'),
      locator_type: 'source_unit',
      audio_verified: false,
    });
  });

  it('tematy: jeden na parę (webinar z `source_id`, dział), posortowane po ID, tytuł webinaru', async () => {
    const adapted = await adaptAddendum(addendum(), { sha256: SHA });
    expect(Object.keys(adapted.topics)).toEqual(['WB-T-W01-DEV', 'WB-T-W02-DEV', 'WB-T-W02-SAFE']);
    const t = adapted.topics['WB-T-W02-SAFE'] as unknown as Record<string, unknown>;
    expect(Object.keys(t)).toEqual(['id', 'title_pl', 'domain_id', 'learning_objective_pl', 'clinical_pearls_pl']);
    expect(t).toEqual({ id: 'WB-T-W02-SAFE', title_pl: 'Webinar drugi', domain_id: 'SAFE', learning_objective_pl: null, clinical_pearls_pl: [] });
  });

  it('wpis `addenda`: format, wersja dodatku, SHA, liczba, prefiks ID', async () => {
    const adapted = await adaptAddendum(addendum(), { sha256: SHA });
    expect(adapted.entry).toEqual({ format: 'dme-webinar-addendum', bank_version: 'webinar-addendum-test-1', sha256: SHA, count: 3, id_prefix: 'WB-' });
  });

  it.each([
    ['inny review_status', [wb('WB-A-001', { review_status: 'approved' })], {}, /WB-A-001.*review_status/],
    ['inny origin', [wb('WB-A-001', { origin: 'v18' })], {}, /WB-A-001.*origin/],
    ['nieznane pole pytania', [wb('WB-A-001', { extra_pl: 'x' })], {}, /WB-A-001.*extra_pl/],
    ['fragment spoza source_ids', [wb('WB-A-001', { evidence_unit_ids: ['W02-U0001'] })], {}, /WB-A-001.*W02-U0001/],
    ['source_id spoza source_ids', [wb('WB-A-001', { source_id: 'W02' })], {}, /WB-A-001.*source_id/],
    ['ID bez prefiksu WB-', [wb('X-001')], {}, /X-001/],
    ['treść bez [webinar] na końcu', [wb('WB-A-001', { stem_pl: 'Pytanie bez znacznika?' })], {}, /WB-A-001.*\[webinar\]/],
    ['źródło z URL', defaultQuestions(), { url: 'https://example.org' }, /W01.*url/],
    ['źródło innego rodzaju', defaultQuestions(), { kind: 'official_reference' }, /W01.*kind/],
    ['źródło z locator_type', defaultQuestions(), { locator_type: 'page' }, /W01.*locator_type/],
    ['źródło z audio_verified', defaultQuestions(), { audio_verified: true }, /W01.*audio_verified/],
  ])('błąd wejścia: %s', async (_label, questions, sourcePatch, message) => {
    const input = addendum(questions as Record<string, unknown>[]);
    Object.assign(input.sources.W01, sourcePatch);
    await expect(adaptAddendum(input, { sha256: SHA })).rejects.toThrow(message);
  });

  // Te same warunki co validate_addendum.py z paczki: tryb append, wersja schematu, brak podpisu klinicznego.
  it.each([
    ['integration_mode inny niż append', { integration_mode: 'replace' }, /integration_mode/],
    ['schema_version inna niż 1', { schema_version: 2 }, /schema_version/],
    ['clinical_signoff = true', { clinical_signoff: true }, /clinical_signoff/],
    ['official_exam_question_bank = true', { official_exam_question_bank: true }, /official_exam_question_bank/],
  ])('błąd wejścia (cały dodatek): %s', async (_label, patch, message) => {
    await expect(adaptAddendum({ ...addendum(), ...patch }, { sha256: SHA })).rejects.toThrow(message);
  });
});

/* ---------------- scalanie ---------------- */

/** Dodatek przeliczony raz (dla testów konfliktów). */
const adaptedSync = await adaptAddendum(addendum(), { sha256: SHA });

describe('mergeBank — baza bez zmian, WB dopisane, idempotencja, konflikty', () => {
  it('pierwsze scalenie: pytania bazy bez zmian, WB w kolejności dodatku, źródła, tematy, addenda przed domains', async () => {
    const base = baseBank();
    const adapted = await adaptAddendum(addendum(), { sha256: SHA });
    const merged = mergeBank(structuredClone(base), adapted, OPTS) as unknown as Record<string, unknown> & RuntimeBank;
    expect(merged.questions.slice(0, 2)).toEqual(base.questions);
    expect(merged.questions.map((q) => q.id)).toEqual(['V-001', 'V-002', 'WB-A-001', 'WB-A-002', 'WB-A-003']);
    expect(merged.questions.slice(2)).toEqual(adapted.questions);
    expect(Object.keys(merged.sources)).toEqual(['V-S1', 'W01', 'W02']);
    expect(Object.keys(merged.topics)).toEqual(['V-T1', 'WB-T-W01-DEV', 'WB-T-W02-DEV', 'WB-T-W02-SAFE']);
    const baseKeys = Object.keys(base);
    const at = baseKeys.indexOf('domains');
    expect(Object.keys(merged)).toEqual([...baseKeys.slice(0, at), 'addenda', ...baseKeys.slice(at)]);
    expect(merged.addenda).toEqual([adapted.entry]);
    expect(merged.bank_version).toBe(OPTS.bankVersion);
    expect(merged.built_on).toBe(OPTS.builtOn);
    expect(merged.family_merges_note_pl).toBe(base.family_merges_note_pl);
    expect(merged.difficulty_mode).toBe('ungraded_ui_preserve_source_metadata');
  });

  it('counts: przeliczone; kolejność kluczy bazy, nowe na końcu; statusy kontroli w kolejności pierwszego wystąpienia', async () => {
    const merged = mergeBank(baseBank(), await adaptAddendum(addendum(), { sha256: SHA }), OPTS);
    expect(JSON.stringify(merged.counts)).toBe(
      JSON.stringify({
        questions: 5,
        families: 5,
        by_domain: { ANAT: 1, DEV: 3, SAFE: 1 },
        by_difficulty: { intermediate: 1, basic: 4 },
        schematic: 0,
        independently_checked_draft: 1,
        author_checked_draft: 1,
        source_checked_AI_draft: 3,
      }),
    );
  });

  it('status_pl i pool_note_pl: dopisane zdania o pytaniach z webinarów (liczba = pytania dodatku)', async () => {
    const merged = mergeBank(baseBank(), await adaptAddendum(addendum(), { sha256: SHA }), OPTS);
    expect(merged.status_pl).toBe('Pula bazowa. 3 pytań z transkrypcji webinarów (napisy automatyczne): klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.');
    expect(merged.pool_note_pl).toBe('Notatka puli. Dodano 3 pytań z transkrypcji webinarów (napisy automatyczne); klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.');
  });

  it('ponowne scalenie wyniku z tym samym dodatkiem → bajtowo ten sam bank, bez duplikatów', async () => {
    const adapted = await adaptAddendum(addendum(), { sha256: SHA });
    const once = mergeBank(baseBank(), adapted, OPTS);
    const twice = mergeBank(structuredClone(once), await adaptAddendum(addendum(), { sha256: SHA }), OPTS);
    expect(serializeJson(twice)).toBe(serializeJson(once));
    expect(twice.questions).toHaveLength(5);
  });

  it('nie zmienia obiektu bazy (czysta funkcja)', async () => {
    const base = baseBank();
    const before = serializeJson(base);
    mergeBank(base, await adaptAddendum(addendum(), { sha256: SHA }), OPTS);
    expect(serializeJson(base)).toBe(before);
  });

  it('ten sam ID z inną treścią → błąd z ID i listą różniących się pól', async () => {
    const once = mergeBank(baseBank(), await adaptAddendum(addendum(), { sha256: SHA }), OPTS);
    const changed = await adaptAddendum(addendum([wb('WB-A-001', { stem_pl: 'Zmieniona treść [webinar]' })]), { sha256: SHA });
    expect(() => mergeBank(once, changed, OPTS)).toThrow(/WB-A-001: inna treść niż w banku — pola: .*stem_pl/);
  });

  it('ID pytania dodatku równe ID z bazy, inna treść → błąd', async () => {
    const base = baseBank();
    base.questions[0]!.id = 'WB-A-001';
    expect(() => mergeBank(base, adaptedSync, OPTS)).toThrow(/WB-A-001: inna treść niż w banku — pola: /);
  });

  it('powtórzony ID w samym dodatku → błąd', async () => {
    const adapted = await adaptAddendum(addendum([wb('WB-A-001'), wb('WB-A-001')]), { sha256: SHA });
    expect(() => mergeBank(baseBank(), adapted, OPTS)).toThrow(/WB-A-001: powtórzony identyfikator w dodatku/);
  });

  it('źródło o tym samym ID z inną treścią → błąd z polami', async () => {
    const base = baseBank();
    (base.sources as Record<string, unknown>).W01 = { ...src('W01', 'Inny tytuł') };
    expect(() => mergeBank(base, adaptedSync, OPTS)).toThrow(/W01: inna treść niż w banku — pola: .*title/);
  });

  it('temat o tym samym ID z inną treścią → błąd', async () => {
    const base = baseBank();
    (base.topics as Record<string, unknown>)['WB-T-W01-DEV'] = { id: 'WB-T-W01-DEV', title_pl: 'Inny', domain_id: 'DEV', learning_objective_pl: null, clinical_pearls_pl: [] };
    expect(() => mergeBank(base, adaptedSync, OPTS)).toThrow(/WB-T-W01-DEV: inna treść niż w banku — pola: .*title_pl/);
  });

  it('wpis addenda tej samej wersji dodatku z innym SHA → błąd', async () => {
    const once = mergeBank(baseBank(), adaptedSync, OPTS);
    const other = { ...adaptedSync, entry: { ...adaptedSync.entry, sha256: 'b'.repeat(64) } };
    expect(() => mergeBank(once, other, OPTS)).toThrow(/webinar-addendum-test-1: inna treść niż w banku — pola: .*sha256/);
  });
});

/* ---------------- raport par identycznej treści ---------------- */

describe('identicalContentPairs — raport, bez usuwania', () => {
  it('grupy ID o tym samym fingerprincie (różne ID); brak par → pusta lista', () => {
    expect(identicalContentPairs([{ id: 'A', fingerprint: 'f1' }, { id: 'B', fingerprint: 'f2' }])).toEqual([]);
    expect(identicalContentPairs([{ id: 'A', fingerprint: 'f1' }, { id: 'B', fingerprint: 'f2' }, { id: 'C', fingerprint: 'f1' }, { id: 'D', fingerprint: 'f1' }])).toEqual([['A', 'C', 'D']]);
  });

  it('pytanie WB o treści identycznej z pytaniem bazy zostaje w banku i trafia do raportu', async () => {
    const base = baseBank();
    const twin = wb('WB-A-009', { stem_pl: 'Bliźniak [webinar]' });
    const adapted = await adaptAddendum(addendum([twin]), { sha256: SHA });
    base.questions[1]!.fingerprint = adapted.questions[0]!.fingerprint;
    const merged = mergeBank(base, adapted, OPTS);
    expect(merged.questions.map((q) => q.id)).toEqual(['V-001', 'V-002', 'WB-A-009']);
    expect(identicalContentPairs(merged.questions)).toEqual([['V-002', 'WB-A-009']]);
  });
});

/* ---------------- pliki towarzyszące ---------------- */

describe('pliki towarzyszące', () => {
  it('retired: obiekt bazy z nową wersją (ID i policy bez zmian); ID z banku → błąd', () => {
    const base = { bank_version: 'v18-test', ids: ['X-1', 'X-2'], policy: 'Allowlista wiąże.' };
    const out = buildRetired(base, 'nowa', ['V-001', 'WB-A-001']);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ bank_version: 'nowa', ids: ['X-1', 'X-2'], policy: 'Allowlista wiąże.' }));
    expect(() => buildRetired(base, 'nowa', ['X-2'])).toThrow(/X-2/);
  });

  it('profil: grupy bazy + ID WB wg działu (SKIN→skin, ANAT→facial_anatomy, reszta→other), liczba w rules_pl', () => {
    const base = {
      bank_version: 'v18-test',
      weights: { skin: 0.35, facial_anatomy: 0.25, other: 0.4 },
      groups: { skin: ['V-S'], facial_anatomy: ['V-A'], other: ['V-O'] },
      rules_pl: ['Domyślnie wszystkie 3 pytania.', 'Bez zmian 30 i 13.'],
      difficulty_mode: 'x',
    };
    const added = [
      { id: 'WB-1', domain_id: 'SKIN' },
      { id: 'WB-2', domain_id: 'DEV' },
      { id: 'WB-3', domain_id: 'ANAT' },
      { id: 'WB-4', domain_id: 'SAFE' },
    ];
    const bankIds = ['V-S', 'V-A', 'V-O', 'WB-1', 'WB-2', 'WB-3', 'WB-4'];
    const out = buildProfile(base, 'nowa', added, bankIds);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({
        bank_version: 'nowa',
        weights: base.weights,
        groups: { skin: ['V-S', 'WB-1'], facial_anatomy: ['V-A', 'WB-3'], other: ['V-O', 'WB-2', 'WB-4'] },
        rules_pl: ['Domyślnie wszystkie 7 pytania.', 'Bez zmian 30 i 13.'],
        difficulty_mode: 'x',
      }),
    );
    expect(base.groups.skin).toEqual(['V-S']);
    expect(() => buildProfile({ ...base, rules_pl: ['Bez liczby.'] }, 'nowa', added, bankIds)).toThrow(/rules_pl/);
    expect(() => buildProfile(base, 'nowa', added, [...bankIds, 'WB-5'])).toThrow(/WB-5/);
  });

  it('allowlista: wersja, tryb, składniki, ID V18 w kolejności allowlisty V18, potem WB', () => {
    const out = buildAllowlist({ bank_version: 'v18-test', replacement_mode: 'x', ids: ['V-2', 'V-1'] }, 'nowa', ['WB-1', 'WB-2', 'WB-3']);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ bank_version: 'nowa', mode: 'v18_plus_webinar_addendum', components: { V18: 2, WB: 3 }, ids: ['V-2', 'V-1', 'WB-1', 'WB-2', 'WB-3'] }));
  });

  it('public/data: do usunięcia każdy plik banku/retired/profilu poza trzema bieżącymi', () => {
    const current = ['bank-111111111111.json', 'retired-question-ids-222222222222.json', 'training-profile-333333333333.json'];
    expect(
      staleDataFiles(['bank-5db40505308f.json', 'retired-question-ids-54a05ea91281.json', 'training-profile-2bdad504f50e.json', 'bank.json', ...current, 'inne.json'], current).sort(),
    ).toEqual(['bank-5db40505308f.json', 'retired-question-ids-54a05ea91281.json', 'training-profile-2bdad504f50e.json'].sort());
  });
});

/* ---------------- kontrola wejść (prawdziwe pliki) ---------------- */

describe('buildRelease — kontrola wejść z MANIFEST', () => {
  const inputs = readInputs(process.cwd());
  const json = (buf: Uint8Array): Record<string, unknown> => JSON.parse(Buffer.from(buf).toString('utf-8')) as Record<string, unknown>;
  const asBuf = (value: unknown): Buffer => Buffer.from(serializeJson(value), 'utf-8');

  it('SHA dodatku ≠ MANIFEST → przerwanie', async () => {
    const addendumBytes = Buffer.concat([Buffer.from(inputs.addendum), Buffer.from(' ')]);
    await expect(buildRelease({ ...inputs, addendum: addendumBytes })).rejects.toThrow(/SHA-256/);
  });

  it('liczba pytań ≠ MANIFEST → przerwanie', async () => {
    const m = json(inputs.addendumManifest);
    await expect(buildRelease({ ...inputs, addendumManifest: asBuf({ ...m, question_count: 246 }) })).rejects.toThrow(/question_count/);
  });

  it('active_ids w innej kolejności → przerwanie', async () => {
    const m = json(inputs.addendumManifest);
    const ids = [...(m.active_ids as string[])];
    [ids[0], ids[1]] = [ids[1]!, ids[0]!];
    await expect(buildRelease({ ...inputs, addendumManifest: asBuf({ ...m, active_ids: ids }) })).rejects.toThrow(/active_ids/);
  });

  it('tryb inny niż append → przerwanie', async () => {
    const m = json(inputs.addendumManifest);
    await expect(buildRelease({ ...inputs, addendumManifest: asBuf({ ...m, mode: 'replace' }) })).rejects.toThrow(/mode/);
  });

  it.each(['v18Bank', 'v18Allowed', 'v18Retired', 'v18Profile'] as const)('plik V18 %s ≠ SHA z V18 MANIFEST → przerwanie', async (key) => {
    const tampered = Buffer.concat([Buffer.from(inputs[key]), Buffer.from('\n')]);
    await expect(buildRelease({ ...inputs, [key]: tampered })).rejects.toThrow(/SHA-256/);
  });

  it('wykluczone ID obecne w dodatku → przerwanie', async () => {
    await expect(buildRelease({ ...inputs, excluded: asBuf({ 'WB-LIGHT-001': 'test' }) })).rejects.toThrow(/WB-LIGHT-001/);
  });
});
