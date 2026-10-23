/**
 * Runtime bank i katalog (DECYZJE §2, §5; kryterium B01): kontrola formatu, walidacja rekordów,
 * najnowsza rewizja, rejestr źródeł, bezpieczne URL i treść bez HTML.
 */
import { describe, expect, it } from 'vitest';
import { buildCatalog, parseRuntimeBank, type PackRecord, type RuntimeQuestion } from '../../src/domain/api';
import { bank, catalogOf, q } from './helpers';

function pack(id: string, questions: RuntimeQuestion[], importedAt = '2026-10-23T10:00:00.000Z'): PackRecord {
  return {
    id,
    importedAt,
    fileName: `${id}.json`,
    bankVersion: `pack-${id}`,
    sourceFormat: 'runtime-v1',
    questions,
    sources: {},
    topics: {},
    figures: {},
    summary: { added: questions.length, updated: 0, skippedSame: 0, skippedBlocked: 0, rejected: 0 },
  };
}

describe('parseRuntimeBank', () => {
  it('przyjmuje poprawny plik bez zakładania liczby pytań', () => {
    for (const n of [0, 1, 7]) {
      const r = parseRuntimeBank(JSON.parse(JSON.stringify(bank(Array.from({ length: n }, (_, i) => q({ id: `Q${i}` }))))));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.questions).toHaveLength(n);
    }
  });

  it.each([
    ['nie obiekt', 'tekst'],
    ['null', null],
    ['tablica', []],
    ['nieznany format', { ...bank([]), format: 'inny' }],
    ['nieznana wersja', { ...bank([]), format_version: 2 }],
    ['brak pytań', { ...bank([]), questions: undefined }],
    ['brak wersji banku', { ...bank([]), bank_version: '' }],
    ['brak źródeł', { ...bank([]), sources: undefined }],
    ['oficjalny bank', { ...bank([]), official_exam_question_bank: true }],
    ['część ustna', { ...bank([]), oral_cases: [] }],
  ])('odrzuca: %s → INVALID_BANK', (_label, input) => {
    const r = parseRuntimeBank(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_BANK');
      expect(r.error.messagePl.length).toBeGreaterThan(0);
    }
  });
});

describe('buildCatalog — walidacja rekordów (B01)', () => {
  const good = q({ id: 'OK-1' });

  const bad: [string, RuntimeQuestion, string][] = [
    ['3 opcje', { ...q({ id: 'B-3' }), options: q({ id: 'B-3' }).options.slice(0, 3) }, 'OPTIONS_NOT_4'],
    ['powtórzone ID opcji', { ...q({ id: 'B-ID' }), options: q({ id: 'B-ID' }).options.map((o) => ({ ...o, id: 'A' })) }, 'OPTION_IDS'],
    [
      'duplikat tekstu opcji',
      { ...q({ id: 'B-DUP', options: ['Ten sam', ' ten  SAM ', 'Inny', 'Jeszcze inny'] }) },
      'OPTION_TEXTS',
    ],
    ['klucz spoza opcji', { ...q({ id: 'B-KEY' }), correct_option_id: 'E' }, 'KEY_NOT_IN_OPTIONS'],
    ['brak źródła', { ...q({ id: 'B-SRC' }), source_ids: [] }, 'SOURCE_REFERENCES'],
    ['źródło spoza rejestru', { ...q({ id: 'B-REG' }), source_ids: ['NIEZNANE'] }, 'SOURCE_NOT_IN_REGISTRY'],
    ['HTML w treści', q({ id: 'B-HTML', stem: 'Pytanie <img src=x onerror=alert(1)> ?' }), 'UNSAFE_CONTENT'],
    ['skrypt w opcji', q({ id: 'B-JS', options: ['javascript:alert(1)', 'b', 'c', 'd'] }), 'UNSAFE_CONTENT'],
    ['uzasadnienia błędnych opcji', { ...q({ id: 'B-RAT' }), option_rationales_pl: {} } as unknown as RuntimeQuestion, 'OUT_OF_SCOPE'],
    ['nieznana figura', { ...q({ id: 'B-FIG' }), figure_id: 'FIG-X' }, 'UNKNOWN_FIGURE'],
    ['schemat bez figury', { ...q({ id: 'B-SCH' }), question_type: 'schematic' }, 'FIGURE_REFERENCE'],
    ['nieznana domena', { ...q({ id: 'B-DOM' }), domain_id: 'XYZ' as never }, 'DOMAIN'],
    ['zła rewizja', { ...q({ id: 'B-REV' }), revision: 0 }, 'REVISION'],
  ];

  it.each(bad)('%s → issue %s, poza pulą', (_label, record, code) => {
    const r = buildCatalog(bank([good, record]), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions.map((x) => x.id)).toEqual(['OK-1']);
    expect(r.value.issues.map((i) => i.code)).toContain(code);
    expect(r.value.questionsById[record.id]).toBeUndefined();
  });

  it('mapuje rekordy na camelCase, zachowuje status recenzji i kolejność kanoniczną opcji', () => {
    const c = catalogOf([good]);
    const cq = c.questionsById['OK-1'];
    expect(cq).toMatchObject({
      id: 'OK-1',
      familyId: 'OK-1',
      domainId: 'ANAT',
      correctOptionId: 'B',
      reviewStatus: 'draft_pending_clinical_review',
      approvedForQuestionKey: false,
      origin: { kind: 'bank', bankVersion: 'test-bank-1' },
    });
    expect(cq?.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(c.clinicalSignoff).toBe(false);
  });

  it('niebezpieczny URL źródła → url = null (bez javascript:/http:)', () => {
    const b = bank([good]);
    b.sources.S1 = { ...b.sources.S1!, url: 'javascript:alert(1)' };
    b.sources.S2 = { ...b.sources.S1!, id: 'S2', url: 'http://example.org' };
    const r = buildCatalog(b, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sources.S1?.url).toBeNull();
    expect(r.value.sources.S2?.url).toBeNull();
    expect(r.value.issues.filter((i) => i.code === 'UNSAFE_URL')).toHaveLength(2);
  });

  it('paczka z wyższą rewizją zastępuje pytanie, z tą samą rewizją i inną treścią — odrzucona', () => {
    const rev2 = q({ id: 'OK-1', revision: 2, stem: 'Poprawiona treść OK-1?' });
    const conflict = q({ id: 'OK-1', revision: 1, stem: 'Inna treść bez wyższej wersji?' });
    const c = catalogOf([good], [pack('p1', [rev2])]);
    expect(c.questionsById['OK-1']?.revision).toBe(2);
    expect(c.questionsById['OK-1']?.origin).toEqual({ kind: 'pack', packId: 'p1', bankVersion: 'pack-p1' });
    expect(c.bankVersions).toEqual(['test-bank-1', 'pack-p1']);
    const c2 = catalogOf([good], [pack('p2', [conflict])]);
    expect(c2.questionsById['OK-1']?.stem).toBe(good.stem_pl);
    expect(c2.issues.map((i) => i.code)).toContain('REVISION_CONFLICT');
  });

  it('ta sama treść pod nowym ID → DUPLICATE_FINGERPRINT (zostaje pierwsze wystąpienie)', () => {
    const copy = q({ id: 'NOWE-ID', stem: good.stem_pl, options: good.options.map((o) => o.text_pl) as [string, string, string, string], family: 'INNA-RODZINA' });
    const c = catalogOf([good], [pack('p1', [copy])]);
    expect(c.questions.map((x) => x.id)).toEqual(['OK-1']);
    expect(c.issues.map((i) => i.code)).toContain('DUPLICATE_FINGERPRINT');
  });

  it('powtórzone ID w tym samym pliku → DUPLICATE_ID', () => {
    const c = catalogOf([good, q({ id: 'OK-1', stem: 'Druga kopia?' })]);
    expect(c.questions).toHaveLength(1);
    expect(c.issues.map((i) => i.code)).toContain('DUPLICATE_ID');
  });
});
