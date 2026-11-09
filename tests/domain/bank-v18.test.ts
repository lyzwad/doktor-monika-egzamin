/**
 * Bank V18 (komplet 700 pytań: 600 V16 + 100 V17) — docs/MIGRACJA_V18.md.
 *
 * Źródło prawdy: paczka redakcji (`content/v18/MANIFEST.json`, `content/v18/allowed_question_ids.json`).
 * Sprawdza: A — dokładnie 700 aktywnych ID z allowlisty (600 V16 + 100 V17), bez pominięć i bez ID spoza listy;
 * B — treść, cztery opcje, klucze, wyjaśnienia, źródła, revision i fingerprint 1:1 z plikiem paczki
 * (bank bajt w bajt, SHA-256 z MANIFEST); pliki towarzyszące i allowlista w kodzie migracji.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capacityFor, CONTENT_RELEASE, CONTENT_RELEASE_LABEL, emptyUserState, poolFor } from '../../src/domain/api';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import { V18_ALLOWED, V18_ALLOWED_BANK_VERSION } from '../../src/persistence/v18Allowlist';
import { BANK, BANK_SHA256, currentCatalog, PROFILE, RETIRED_IDS } from '../content';

const MANIFEST = JSON.parse(readFileSync(resolve(process.cwd(), 'content/v18/MANIFEST.json'), 'utf-8')) as {
  bank_version: string;
  active_question_count: number;
  component_counts: { V16: number; V17: number };
  counts: { by_difficulty: Record<string, number>; families: number };
  files: Record<string, string>;
};
const ALLOWED_RAW = readFileSync(resolve(process.cwd(), 'content/v18/allowed_question_ids.json'));
const ALLOWED = JSON.parse(ALLOWED_RAW.toString('utf-8')) as { bank_version: string; ids: string[] };
const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const publicFile = (rel: string): Buffer => readFileSync(resolve(process.cwd(), 'public', rel));

const catalog = currentCatalog();

describe('bank V18 — wydanie i pliki', () => {
  it('CONTENT_RELEASE = V18 z MANIFEST (wersja, SHA-256 trzech plików, liczby 700 / 400 / 200 / 100)', () => {
    expect(CONTENT_RELEASE_LABEL).toBe('V18');
    expect(CONTENT_RELEASE.bankVersion).toBe(MANIFEST.bank_version);
    expect(CONTENT_RELEASE.bankSha256).toBe(MANIFEST.files['runtime/bank.json']);
    expect(CONTENT_RELEASE.retiredSha256).toBe(MANIFEST.files['runtime/retired_question_ids.json']);
    expect(CONTENT_RELEASE.profileSha256).toBe(MANIFEST.files['runtime/training_profile.json']);
    expect(CONTENT_RELEASE.allowedSha256).toBe(MANIFEST.files['runtime/allowed_question_ids.json']);
    expect(sha(ALLOWED_RAW)).toBe(MANIFEST.files['runtime/allowed_question_ids.json']);
    expect(CONTENT_RELEASE.counts).toMatchObject({ questions: 700, basic: 400, intermediate: 200, advanced: 100 });
    expect(MANIFEST.active_question_count).toBe(700);
  });

  it('public/data: wyłącznie trzy pliki V18, bajt w bajt z paczką; brak plików V15 i starszych', () => {
    const files = readdirSync(resolve(process.cwd(), 'public/data')).sort();
    expect(files).toEqual([CONTENT_RELEASE.bankFile, CONTENT_RELEASE.profileFile, CONTENT_RELEASE.retiredFile].map((f) => f.replace('data/', '')).sort());
    expect(BANK_SHA256).toBe(MANIFEST.files['runtime/bank.json']);
    expect(sha(publicFile(CONTENT_RELEASE.retiredFile))).toBe(CONTENT_RELEASE.retiredSha256);
    expect(sha(publicFile(CONTENT_RELEASE.profileFile))).toBe(CONTENT_RELEASE.profileSha256);
    expect(files.some((f) => f.includes('37f3980a1129') || f === 'bank.json')).toBe(false);
  });

  it('bez figur V15: bank V18 nie ma schematów, katalog public/figures nie istnieje', () => {
    expect(Object.keys(BANK.figures)).toEqual([]);
    expect(() => readdirSync(resolve(process.cwd(), 'public/figures'))).toThrow();
  });
});

describe('A — dokładnie 700 aktywnych ID z allowlisty', () => {
  it('allowlista: 700 unikalnych ID = 600 V16 + 100 V17 (V17-001…V17-100)', () => {
    expect(ALLOWED.bank_version).toBe(CONTENT_RELEASE.bankVersion);
    expect(ALLOWED.ids).toHaveLength(700);
    expect(new Set(ALLOWED.ids).size).toBe(700);
    expect(ALLOWED.ids.filter((id) => id.startsWith('V16-'))).toHaveLength(MANIFEST.component_counts.V16);
    const v17 = ALLOWED.ids.filter((id) => id.startsWith('V17-')).sort();
    expect(v17).toEqual(Array.from({ length: 100 }, (_, i) => `V17-${String(i + 1).padStart(3, '0')}`));
  });

  it('katalog aplikacji = dokładnie allowlista (bez pominięć, bez ID spoza listy)', () => {
    expect(catalog.issues).toEqual([]);
    expect(catalog.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(catalog.questions).toHaveLength(700);
    expect([...catalog.questions.map((q) => q.id)].sort()).toEqual([...ALLOWED.ids].sort());
  });

  it('pula „wszystko” dla czystego profilu = 700 pytań (żadnego limitu 100, żadnego filtra trudności)', () => {
    const info = poolFor(catalog, emptyUserState(), 'ALL', 'mixed', '2026-11-09T10:00:00.000Z');
    expect(info.questionIds).toHaveLength(700);
    expect(capacityFor(catalog, emptyUserState(), 'ALL', 'mixed')).toBe(MANIFEST.counts.families);
  });

  it('lista wycofanych nie zawiera żadnego aktywnego ID (V16 i V17 nie są blokowane)', () => {
    const allowed = new Set(ALLOWED.ids);
    expect(RETIRED_IDS.filter((id) => allowed.has(id))).toEqual([]);
    expect(catalog.retiredQuestionIds.filter((id) => allowed.has(id))).toEqual([]);
  });

  it('profil treningowy obejmuje każde z 700 pytań dokładnie raz', () => {
    const grouped = Object.keys(PROFILE.groupOf).sort();
    expect(grouped).toEqual([...ALLOWED.ids].sort());
  });

  it('allowlista migracji (src/persistence/v18Allowlist.ts) = 700 ID z revision, fingerprint, kluczem, rodziną i dziedziną banku', () => {
    expect(V18_ALLOWED_BANK_VERSION).toBe(CONTENT_RELEASE.bankVersion);
    expect(V18_ALLOWED.map(([id]) => id).sort()).toEqual([...ALLOWED.ids].sort());
    const byId = new Map(BANK.questions.map((q) => [q.id, q]));
    for (const [id, revision, fingerprint, correct, family, domain] of V18_ALLOWED) {
      const q = byId.get(id);
      expect(q, id).toBeDefined();
      expect([revision, fingerprint, correct, family, domain]).toEqual([q!.revision, q!.fingerprint, q!.correct_option_id, q!.family_id, q!.domain_id]);
    }
  });
});

describe('B — treść 1:1 z paczką', () => {
  it('każdy rekord: ID, revision, fingerprint, treść, 4 opcje, klucz, wyjaśnienie, źródła, metadane', () => {
    for (const raw of BANK.questions) {
      const c = catalog.questionsById[raw.id];
      expect(c, raw.id).toBeDefined();
      if (!c) continue;
      expect(c.options).toHaveLength(4);
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
      for (const sid of raw.source_ids) expect(catalog.sources[sid]?.url, sid).toBe(BANK.sources[sid]?.url);
    }
  });

  it('fingerprint każdego z 700 pytań przeliczony w aplikacji = fingerprint z paczki', async () => {
    for (const raw of BANK.questions) {
      expect(await fingerprintRuntimeQuestion(raw), raw.id).toBe(raw.fingerprint);
    }
  });

  it('metadane trudności bez reklasyfikacji: V16 300/200/100, V17 placeholder basic', () => {
    const by = (prefix: string) => {
      const out: Record<string, number> = {};
      for (const q of catalog.questions) if (q.id.startsWith(prefix)) out[q.difficulty] = (out[q.difficulty] ?? 0) + 1;
      return out;
    };
    expect(by('V16-')).toEqual({ basic: 300, intermediate: 200, advanced: 100 });
    expect(by('V17-')).toEqual({ basic: 100 });
    expect(catalog.bankSummary).toMatchObject({ questions: 700, byDifficulty: MANIFEST.counts.by_difficulty, declaredCountsMatch: true });
  });
});
