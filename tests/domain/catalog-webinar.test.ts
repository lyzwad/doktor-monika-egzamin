/**
 * Pytania i źródła webinarowe w katalogu (spec-webinary-247, kontrakt-danych.md „Typy aplikacji”):
 * - pytanie WB (`origin: 'webinar'`) wymaga niepustego cytatu, ≥ 1 fragmentu `Wxx-Unnnn` z prefiksem z `source_ids`,
 *   treści zakończonej `[webinar]` i wyłącznie źródeł webinarowych; inne `origin` → poza pulą;
 * - źródło webinarowe z url/doi/pmid → `INVALID_SOURCE` (pytania z nim poza pulą);
 * - mapowanie: `webinarEvidence`, `fileName`, `webinar`; snapshot przenosi dowód i pola źródła.
 */
import { describe, expect, it } from 'vitest';
import { buildCatalog, type Catalog, type RuntimeBank, type RuntimeQuestion, type RuntimeSource } from '../../src/domain/api';
import { buildSnapshot, reorderSnapshot } from '../../src/domain/snapshot';
import { bank, q } from './helpers';

function webinarSource(id = 'W01', over: Partial<RuntimeSource> & Record<string, unknown> = {}): RuntimeSource {
  return {
    id,
    title: `Webinar ${id}`,
    url: null,
    doi: null,
    pmid: null,
    kind: 'user_supplied_webinar_transcript',
    kind_pl: 'transkrypcja webinaru',
    access: 'source_unit',
    access_pl: 'fragmenty automatycznych napisów',
    checked_on: null,
    filename: `Webinar-${id} (transcribed).txt`,
    sha256: 'a'.repeat(64),
    locator_type: 'source_unit',
    audio_verified: false,
    ...over,
  } as RuntimeSource;
}

function wbq(id: string, over: Record<string, unknown> = {}): RuntimeQuestion {
  return {
    ...q({ id, domain: 'DEV', stem: `Pytanie ${id}: [webinar]` }),
    source_ids: ['W01'],
    source_locator_pl: 'W01: W01-U0001, W01-U0002',
    content_check_status: 'source_checked_AI_draft',
    origin: 'webinar',
    evidence_quote: `Cytat z wykładu dla ${id}.`,
    evidence_unit_ids: ['W01-U0001', 'W01-U0002'],
    source_note_pl: 'Klucz oparty na wypowiedzi w webinarze.',
    ...over,
  } as RuntimeQuestion;
}

function webinarBank(questions: RuntimeQuestion[], sources: Record<string, RuntimeSource> = { W01: webinarSource('W01'), W02: webinarSource('W02') }): RuntimeBank {
  const b = bank(questions);
  b.sources = { ...b.sources, ...sources };
  return b;
}

function catalogOf(questions: RuntimeQuestion[], sources?: Record<string, RuntimeSource>): Catalog {
  const r = buildCatalog(webinarBank(questions, sources));
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
}

const codesFor = (c: Catalog, id: string): string[] => c.issues.filter((i) => i.questionId === id).map((i) => i.code);

describe('katalog — pytanie i źródło webinaru', () => {
  it('poprawne pytanie WB: w puli, `webinarEvidence` z cytatem, fragmentami i notatką; źródło z nazwą pliku i znacznikiem', () => {
    const c = catalogOf([wbq('WB-T-001'), q({ id: 'V-001' })]);
    expect(c.questions.map((x) => x.id)).toEqual(['WB-T-001', 'V-001']);
    expect(codesFor(c, 'WB-T-001')).toEqual([]);
    expect(c.questionsById['WB-T-001']!.webinarEvidence).toEqual({
      quote: 'Cytat z wykładu dla WB-T-001.',
      unitIds: ['W01-U0001', 'W01-U0002'],
      note: 'Klucz oparty na wypowiedzi w webinarze.',
    });
    expect(c.questionsById['V-001']!.webinarEvidence).toBeNull();
    expect(c.sources.W01).toMatchObject({ title: 'Webinar W01', url: null, doi: null, pmid: null, kindPl: 'transkrypcja webinaru', accessPl: 'fragmenty automatycznych napisów', fileName: 'Webinar-W01 (transcribed).txt', webinar: true });
    expect(c.sources.S1).toMatchObject({ url: 'https://example.org/zrodlo', fileName: null, webinar: false });
  });

  it('brak notatki → pusta notatka; dwa źródła webinarowe i fragmenty obu', () => {
    const { source_note_pl: _drop, ...noNote } = wbq('WB-T-002', { source_ids: ['W01', 'W02'], evidence_unit_ids: ['W02-U0010', 'W01-U0033'] }) as unknown as Record<string, unknown>;
    const c = catalogOf([noNote as unknown as RuntimeQuestion]);
    expect(c.questionsById['WB-T-002']!.webinarEvidence).toEqual({ quote: 'Cytat z wykładu dla WB-T-002.', unitIds: ['W02-U0010', 'W01-U0033'], note: '' });
  });

  it.each<[string, string, Record<string, unknown>]>([
    ['brak cytatu', 'WEBINAR_EVIDENCE', { evidence_quote: undefined }],
    ['pusty cytat', 'WEBINAR_EVIDENCE', { evidence_quote: '' }],
    ['brak fragmentów', 'WEBINAR_EVIDENCE', { evidence_unit_ids: [] }],
    ['fragmenty nie są listą', 'WEBINAR_EVIDENCE', { evidence_unit_ids: 'W01-U0001' }],
    ['zły format fragmentu', 'WEBINAR_EVIDENCE', { evidence_unit_ids: ['W1-U01'] }],
    ['fragment z prefiksem spoza source_ids', 'WEBINAR_EVIDENCE', { evidence_unit_ids: ['W02-U0001'] }],
    ['treść bez [webinar] na końcu', 'WEBINAR_MARKER', { stem_pl: 'Pytanie bez znacznika?' }],
    ['źródło niewebinarowe', 'WEBINAR_SOURCE', { source_ids: ['W01', 'S1'] }],
    ['nieznane origin', 'ORIGIN', { origin: 'v18' }],
    ['HTML w cytacie', 'UNSAFE_CONTENT', { evidence_quote: 'Cytat <img src=x onerror=alert(1)>' }],
    ['skrypt w notatce', 'UNSAFE_CONTENT', { source_note_pl: 'javascript:alert(1)' }],
    ['notatka nie jest tekstem', 'WEBINAR_EVIDENCE', { source_note_pl: 42 }],
  ])('pytanie WB bez dowodu albo z błędem (%s) → poza pulą, kod %s', (_label, code, over) => {
    const c = catalogOf([wbq('WB-T-003', over), q({ id: 'V-001' })]);
    expect(c.questions.map((x) => x.id)).toEqual(['V-001']);
    expect(codesFor(c, 'WB-T-003')).toContain(code);
  });

  it.each([
    ['url', { url: 'https://example.org/nagranie' }],
    ['doi', { doi: '10.1000/xyz' }],
    ['pmid', { pmid: '123456' }],
  ])('źródło webinarowe z niepustym %s → INVALID_SOURCE; pytanie z tym źródłem poza pulą', (_label, over) => {
    const c = catalogOf([wbq('WB-T-004'), q({ id: 'V-001' })], { W01: webinarSource('W01', over), W02: webinarSource('W02') });
    expect(c.sources.W01).toBeUndefined();
    expect(c.issues.some((i) => i.questionId === null && i.code === 'INVALID_SOURCE' && i.messagePl.includes('W01'))).toBe(true);
    expect(c.questions.map((x) => x.id)).toEqual(['V-001']);
    expect(codesFor(c, 'WB-T-004')).toContain('SOURCE_NOT_IN_REGISTRY');
  });

  it('źródło z HTML w nazwie pliku → INVALID_SOURCE; pytanie z tym źródłem poza pulą', () => {
    const c = catalogOf([wbq('WB-T-005'), q({ id: 'V-001' })], { W01: webinarSource('W01', { filename: '<img src=x onerror=alert(1)>.txt' }), W02: webinarSource('W02') });
    expect(c.sources.W01).toBeUndefined();
    expect(c.issues.some((i) => i.questionId === null && i.code === 'INVALID_SOURCE' && i.messagePl.includes('W01'))).toBe(true);
    expect(c.questions.map((x) => x.id)).toEqual(['V-001']);
    expect(codesFor(c, 'WB-T-005')).toContain('SOURCE_NOT_IN_REGISTRY');
  });

  it('pytanie bez origin (V18) ze źródłem webinarowym nie jest traktowane jako WB (brak dowodu = null)', () => {
    const c = catalogOf([{ ...q({ id: 'V-002' }), source_ids: ['W01'] }]);
    expect(c.questionsById['V-002']!.webinarEvidence).toBeNull();
  });
});

describe('snapshot — dowód webinaru i pola źródła', () => {
  const c = catalogOf([wbq('WB-T-010', { source_ids: ['W01', 'W02'], evidence_unit_ids: ['W02-U0001', 'W01-U0002'] }), q({ id: 'V-010' })]);

  it('pytanie WB: snapshot ma `webinarEvidence` (kopię) i źródła z nazwą pliku i znacznikiem webinaru', () => {
    const question = c.questionsById['WB-T-010']!;
    const snap = buildSnapshot(c, question, ['D', 'C', 'B', 'A']);
    expect(snap.webinarEvidence).toEqual(question.webinarEvidence);
    expect(snap.webinarEvidence).not.toBe(question.webinarEvidence);
    expect(snap.sources).toEqual([
      { id: 'W01', title: 'Webinar W01', url: null, doi: null, pmid: null, kindPl: 'transkrypcja webinaru', accessPl: 'fragmenty automatycznych napisów', fileName: 'Webinar-W01 (transcribed).txt', webinar: true },
      { id: 'W02', title: 'Webinar W02', url: null, doi: null, pmid: null, kindPl: 'transkrypcja webinaru', accessPl: 'fragmenty automatycznych napisów', fileName: 'Webinar-W02 (transcribed).txt', webinar: true },
    ]);
  });

  it('pytanie V18: snapshot z `webinarEvidence: null` i źródłem bez pliku', () => {
    const snap = buildSnapshot(c, c.questionsById['V-010']!, ['A', 'B', 'C', 'D']);
    expect(snap.webinarEvidence).toBeNull();
    expect(snap.sources[0]).toMatchObject({ id: 'S1', fileName: null, webinar: false });
  });

  it('reorderSnapshot zachowuje dowód (kopia) i pola źródła; stary snapshot bez pola zostaje bez pola', () => {
    const snap = buildSnapshot(c, c.questionsById['WB-T-010']!, ['A', 'B', 'C', 'D']);
    const re = reorderSnapshot(snap, ['B', 'A', 'D', 'C']);
    expect(re.webinarEvidence).toEqual(snap.webinarEvidence);
    expect(re.webinarEvidence!.unitIds).not.toBe(snap.webinarEvidence!.unitIds);
    expect(re.sources).toEqual(snap.sources);
    const { webinarEvidence: _old, ...legacy } = buildSnapshot(c, c.questionsById['V-010']!, ['A', 'B', 'C', 'D']);
    expect('webinarEvidence' in reorderSnapshot(legacy, ['A', 'B', 'C', 'D'])).toBe(false);
  });
});
