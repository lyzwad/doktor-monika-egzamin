/**
 * Bank V18 (komplet 700 pytań: 600 V16 + 100 V17) WEWNĄTRZ wydania „V18 + webinary” — docs/MIGRACJA_V18.md,
 * spec-webinary-247.
 *
 * Źródło prawdy: paczka redakcji w `content/v18/` (MANIFEST.json z SHA-256 banku, allowlisty, retired i profilu).
 * Sprawdza: A — 700 ID z allowlisty V18 są w katalogu wydania (bez pominięć), nie są wyłączone, mają te same grupy
 * profilu co w V18 i wiersze allowlisty migracji; B — treść, cztery opcje, klucze, wyjaśnienia, źródła, revision
 * i fingerprint każdego rekordu V18 1:1 z plikiem paczki (bank wydania zawiera rekordy V18 bez zmian).
 * Całe wydanie (947, WB, pliki, wersja) — tests/domain/bank-webinary.test.ts.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_RELEASE, emptyUserState, poolFor } from '../../src/domain/api';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { RuntimeBank } from '../../src/domain/types';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { BANK, currentCatalog, PROFILE, RETIRED_IDS } from '../content';

const read = (rel: string): Buffer => readFileSync(resolve(process.cwd(), rel));
const MANIFEST = JSON.parse(read('content/v18/MANIFEST.json').toString('utf-8')) as {
  bank_version: string;
  active_question_count: number;
  component_counts: { V16: number; V17: number };
  counts: { by_difficulty: Record<string, number>; families: number };
  files: Record<string, string>;
};
const V18_BANK = JSON.parse(read('content/v18/bank.json').toString('utf-8')) as RuntimeBank;
const ALLOWED = JSON.parse(read('content/v18/allowed_question_ids.json').toString('utf-8')) as { bank_version: string; ids: string[] };
const V18_PROFILE = JSON.parse(read('content/v18/training_profile.json').toString('utf-8')) as { groups: Record<string, string[]> };
const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

const catalog = currentCatalog();

describe('paczka V18 (content/v18) — wejście wydania', () => {
  it('SHA-256 banku, allowlisty, retired i profilu = MANIFEST; 700 pytań = 600 V16 + 100 V17', () => {
    expect(sha(read('content/v18/bank.json'))).toBe(MANIFEST.files['runtime/bank.json']);
    expect(sha(read('content/v18/allowed_question_ids.json'))).toBe(MANIFEST.files['runtime/allowed_question_ids.json']);
    expect(sha(read('content/v18/retired_question_ids.json'))).toBe(MANIFEST.files['runtime/retired_question_ids.json']);
    expect(sha(read('content/v18/training_profile.json'))).toBe(MANIFEST.files['runtime/training_profile.json']);
    expect(V18_BANK.bank_version).toBe(MANIFEST.bank_version);
    expect(MANIFEST.active_question_count).toBe(700);
    expect(V18_BANK.questions).toHaveLength(700);
  });

  it('pliki V18 nie są publikowane (public/data bez bank-5db40505308f i plików towarzyszących V18); bez figur', () => {
    const files = readdirSync(resolve(process.cwd(), 'public/data'));
    for (const v18 of ['5db40505308f', '54a05ea91281', '2bdad504f50e']) expect(files.some((f) => f.includes(v18)), v18).toBe(false);
    expect(Object.keys(BANK.figures)).toEqual([]);
    expect(() => readdirSync(resolve(process.cwd(), 'public/figures'))).toThrow();
  });
});

describe('A — 700 aktywnych ID V18 w wydaniu', () => {
  it('allowlista V18: 700 unikalnych ID = 600 V16 + 100 V17 (V17-001…V17-100)', () => {
    expect(ALLOWED.bank_version).toBe(MANIFEST.bank_version);
    expect(ALLOWED.ids).toHaveLength(700);
    expect(new Set(ALLOWED.ids).size).toBe(700);
    expect(ALLOWED.ids.filter((id) => id.startsWith('V16-'))).toHaveLength(MANIFEST.component_counts.V16);
    const v17 = ALLOWED.ids.filter((id) => id.startsWith('V17-')).sort();
    expect(v17).toEqual(Array.from({ length: 100 }, (_, i) => `V17-${String(i + 1).padStart(3, '0')}`));
  });

  it('katalog wydania zawiera każde z 700 ID V18 (pytania spoza V18 to wyłącznie WB-)', () => {
    expect(catalog.issues).toEqual([]);
    const ids = new Set(catalog.questions.map((q) => q.id));
    expect(ALLOWED.ids.filter((id) => !ids.has(id))).toEqual([]);
    const v18 = new Set(ALLOWED.ids);
    expect(catalog.questions.filter((q) => !v18.has(q.id)).every((q) => q.id.startsWith('WB-'))).toBe(true);
  });

  it('pula „wszystko” dla czystego profilu obejmuje wszystkie 700 pytań V18 (żadnego filtra trudności)', () => {
    const pool = new Set(poolFor(catalog, emptyUserState(), 'ALL', 'mixed', '2026-11-15T10:00:00.000Z').questionIds);
    expect(ALLOWED.ids.filter((id) => !pool.has(id))).toEqual([]);
  });

  it('lista wycofanych nie zawiera żadnego aktywnego ID V18', () => {
    const allowed = new Set(ALLOWED.ids);
    expect(RETIRED_IDS.filter((id) => allowed.has(id))).toEqual([]);
    expect(catalog.retiredQuestionIds.filter((id) => allowed.has(id))).toEqual([]);
  });

  it('profil treningowy: każde z 700 pytań V18 w tej samej grupie co w profilu V18', () => {
    for (const [group, ids] of Object.entries(V18_PROFILE.groups)) {
      for (const id of ids) expect(PROFILE.groupOf[id], id).toBe(group);
    }
  });

  it('allowlista migracji (src/persistence/v18Allowlist.ts): 700 wierszy V18 = revision, fingerprint, klucz, rodzina i dziedzina z paczki', () => {
    const rows = new Map(V18_ALLOWED.map((row) => [row[0], row]));
    for (const q of V18_BANK.questions) {
      const row = rows.get(q.id);
      expect(row, q.id).toBeDefined();
      expect(row!.slice(1), q.id).toEqual([q.revision, q.fingerprint, q.correct_option_id, q.family_id, q.domain_id]);
    }
  });
});

describe('B — treść V18 1:1 z paczką', () => {
  it('bank wydania: pierwsze 700 rekordów = rekordy content/v18/bank.json (kolejność i obiekty)', () => {
    expect(BANK.questions.slice(0, 700)).toEqual(V18_BANK.questions);
  });

  it('każdy rekord V18 w katalogu: ID, revision, fingerprint, treść, 4 opcje, klucz, wyjaśnienie, źródła, metadane; bez dowodu webinaru', () => {
    for (const raw of V18_BANK.questions) {
      const c = catalog.questionsById[raw.id];
      expect(c, raw.id).toBeDefined();
      if (!c) continue;
      expect(c.options).toHaveLength(4);
      expect(c.webinarEvidence).toBeNull();
      expect({
        id: c.id,
        revision: c.revision,
        family_id: c.familyId,
        fingerprint: c.fingerprint,
        domain_id: c.domainId,
        topic_ids: c.topicIds,
        difficulty: c.difficulty,
        stem_pl: c.stem,
        options: c.options.map((o) => ({ id: o.id, text_pl: o.text })),
        correct_option_id: c.correctOptionId,
        correct_explanation_pl: c.explanation,
        source_ids: c.sourceIds,
        source_locator_pl: c.sourceLocator,
        question_type: c.questionType,
        figure_id: c.figureId,
        explanation_figure_id: c.explanationFigureId,
        review_status: c.reviewStatus,
        approved_for_question_key: c.approvedForQuestionKey,
        content_check_status: c.contentCheckStatus,
        cognitive_level: c.cognitiveLevel,
      }).toEqual({
        id: raw.id,
        revision: raw.revision,
        family_id: raw.family_id,
        fingerprint: raw.fingerprint,
        domain_id: raw.domain_id,
        topic_ids: raw.topic_ids,
        difficulty: raw.difficulty,
        stem_pl: raw.stem_pl,
        options: raw.options,
        correct_option_id: raw.correct_option_id,
        correct_explanation_pl: raw.correct_explanation_pl,
        source_ids: raw.source_ids,
        source_locator_pl: raw.source_locator_pl,
        question_type: raw.question_type,
        figure_id: raw.figure_id,
        explanation_figure_id: raw.explanation_figure_id,
        review_status: raw.review_status,
        approved_for_question_key: raw.approved_for_question_key,
        content_check_status: raw.content_check_status,
        cognitive_level: raw.cognitive_level ?? null,
      });
      // Klucz wskazuje ten sam tekst odpowiedzi co w pliku.
      const keyText = raw.options.find((o) => o.id === raw.correct_option_id)?.text_pl;
      expect(c.options.find((o) => o.id === c.correctOptionId)?.text).toBe(keyText);
      for (const sid of raw.source_ids) {
        expect(catalog.sources[sid]?.url, sid).toBe(V18_BANK.sources[sid]?.url);
        expect(catalog.sources[sid]?.webinar, sid).toBe(false);
      }
    }
  });

  it('fingerprint każdego z 700 pytań V18 przeliczony w aplikacji = fingerprint z paczki', async () => {
    for (const raw of V18_BANK.questions) {
      expect(await fingerprintRuntimeQuestion(raw), raw.id).toBe(raw.fingerprint);
    }
  });

  it('metadane trudności bez reklasyfikacji: V16 300/200/100, V17 i WB — placeholder basic', () => {
    const by = (prefix: string) => {
      const out: Record<string, number> = {};
      for (const q of catalog.questions) if (q.id.startsWith(prefix)) out[q.difficulty] = (out[q.difficulty] ?? 0) + 1;
      return out;
    };
    expect(by('V16-')).toEqual({ basic: 300, intermediate: 200, advanced: 100 });
    expect(by('V17-')).toEqual({ basic: 100 });
    expect(by('WB-')).toEqual({ basic: CONTENT_RELEASE.counts.webinar });
    expect(catalog.bankSummary).toMatchObject({
      questions: CONTENT_RELEASE.counts.questions,
      byDifficulty: { basic: CONTENT_RELEASE.counts.basic, intermediate: CONTENT_RELEASE.counts.intermediate, advanced: CONTENT_RELEASE.counts.advanced },
      declaredCountsMatch: true,
    });
  });
});
