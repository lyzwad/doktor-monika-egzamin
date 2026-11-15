/**
 * Wydanie treści „V18 + webinary” (spec-webinary-247, kontrakt-danych.md).
 *
 * Źródła prawdy: `content/v18/` (bank V18 bajt w bajt, MANIFEST z SHA-256 czterech plików) i
 * `content/webinary-2026-11-15/` (dodatek `dme-webinar-addendum`, MANIFEST z SHA, liczbą i kolejnością ID).
 * Sprawdza: wersję i SHA wydania, 947 = 700 + 247, 700 rekordów V18 głęboko równych bazie, 247 WB 1:1 z dodatkiem,
 * `[webinar]`, źródła bez url/doi/pmid, tematy, profil, retired, allowlistę, 939 rodzin, Test N = 939, idempotencję
 * skryptu (bieżące wejścia → bajtowo te same pliki w repo).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRelease, readInputs } from '../../scripts/webinary-addendum.mjs';
import { capacityFor, CONTENT_RELEASE, CONTENT_RELEASE_LABEL, emptyUserState, poolFor, startTest } from '../../src/domain/api';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type { RuntimeBank } from '../../src/domain/types';
import { V18_ALLOWED, V18_ALLOWED_BANK_VERSION } from '../../src/persistence/v18Allowlist';
import { BANK, BANK_SHA256, currentCatalog, PROFILE, PROFILE_RAW, RETIRED_RAW } from '../content';
import { Clock, must, session } from './helpers';

const root = process.cwd();
const raw = (rel: string): Buffer => readFileSync(resolve(root, rel));
const json = <T>(rel: string): T => JSON.parse(raw(rel).toString('utf-8')) as T;
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const V18_MANIFEST = json<{ bank_version: string; files: Record<string, string> }>('content/v18/MANIFEST.json');
const V18_BANK = json<RuntimeBank>('content/v18/bank.json');
const V18_ALLOWED_IDS = json<{ ids: string[] }>('content/v18/allowed_question_ids.json').ids;
const V18_RETIRED = json<{ bank_version: string; ids: string[]; policy: string }>('content/v18/retired_question_ids.json');
const V18_PROFILE = json<{ weights: Record<string, number>; example_20_question_test: Record<string, number>; groups: Record<string, string[]>; rules_pl: string[] }>(
  'content/v18/training_profile.json',
);
const ADD_MANIFEST = json<{ bank_version: string; mode: string; question_count: number; bank_sha256: string; active_ids: string[] }>('content/webinary-2026-11-15/MANIFEST.json');
const ADDENDUM = json<{ bank_version: string; sources: Record<string, Record<string, unknown>>; questions: Record<string, unknown>[] }>(
  'content/webinary-2026-11-15/bank_webinar_addendum.json',
);
const EXCLUDED = json<Record<string, string>>('content/webinary-2026-11-15/Wykluczone_powtorzenia.json');
const ALLOWED_RAW = raw('content/v18-webinary/allowed_question_ids.json');
const ALLOWED = JSON.parse(ALLOWED_RAW.toString('utf-8')) as { bank_version: string; mode: string; components: Record<string, number>; ids: string[] };
const publicFile = (rel: string): Buffer => raw(`public/${rel}`);

const WB = BANK.questions.slice(700) as unknown as Record<string, unknown>[];
const catalog = currentCatalog();

describe('wydanie V18 + webinary — wersja, SHA, pliki', () => {
  it('CONTENT_RELEASE: wersja z SHA wejść, SHA trzech plików i allowlisty, nazwy z sumą, liczby, etykieta', () => {
    expect(CONTENT_RELEASE_LABEL).toBe('V18 + webinary');
    const h12 = sha(`${V18_MANIFEST.files['runtime/bank.json']}+${ADD_MANIFEST.bank_sha256}`).slice(0, 12);
    expect(CONTENT_RELEASE.bankVersion).toBe(`dme-v18-webinary-2026-11-15-${h12}`);
    expect(BANK_SHA256).toBe(CONTENT_RELEASE.bankSha256);
    expect(sha(publicFile(CONTENT_RELEASE.retiredFile))).toBe(CONTENT_RELEASE.retiredSha256);
    expect(sha(publicFile(CONTENT_RELEASE.profileFile))).toBe(CONTENT_RELEASE.profileSha256);
    expect(sha(ALLOWED_RAW)).toBe(CONTENT_RELEASE.allowedSha256);
    expect(CONTENT_RELEASE.bankFile).toBe(`data/bank-${CONTENT_RELEASE.bankSha256.slice(0, 12)}.json`);
    expect(CONTENT_RELEASE.retiredFile).toBe(`data/retired-question-ids-${CONTENT_RELEASE.retiredSha256.slice(0, 12)}.json`);
    expect(CONTENT_RELEASE.profileFile).toBe(`data/training-profile-${CONTENT_RELEASE.profileSha256.slice(0, 12)}.json`);
    expect({ ...CONTENT_RELEASE.counts }).toEqual({ questions: 947, basic: 647, intermediate: 200, advanced: 100, retired: 3120, webinar: 247 });
    for (const file of [BANK, RETIRED_RAW, PROFILE_RAW, ALLOWED]) expect(file.bank_version).toBe(CONTENT_RELEASE.bankVersion);
    expect(BANK.built_on).toBe('2026-11-15');
  });

  it('wejścia zgodne z MANIFEST: bank V18, allowlista, retired i profil V18 (przeniesione bajt w bajt), dodatek 247 w kolejności active_ids', () => {
    expect(sha(raw('content/v18/bank.json'))).toBe(V18_MANIFEST.files['runtime/bank.json']);
    expect(sha(raw('content/v18/allowed_question_ids.json'))).toBe(V18_MANIFEST.files['runtime/allowed_question_ids.json']);
    expect(sha(raw('content/v18/retired_question_ids.json'))).toBe(V18_MANIFEST.files['runtime/retired_question_ids.json']);
    expect(sha(raw('content/v18/training_profile.json'))).toBe(V18_MANIFEST.files['runtime/training_profile.json']);
    expect(sha(raw('content/webinary-2026-11-15/bank_webinar_addendum.json'))).toBe(ADD_MANIFEST.bank_sha256);
    expect(ADD_MANIFEST.mode).toBe('append');
    expect(ADD_MANIFEST.question_count).toBe(247);
    expect(ADDENDUM.questions.map((q) => q.id)).toEqual(ADD_MANIFEST.active_ids);
  });

  it('public/data: wyłącznie trzy pliki nowego wydania (bez plików V18 i starszych)', () => {
    const files = readdirSync(resolve(root, 'public/data')).sort();
    expect(files).toEqual([CONTENT_RELEASE.bankFile, CONTENT_RELEASE.profileFile, CONTENT_RELEASE.retiredFile].map((f) => f.replace('data/', '')).sort());
    for (const legacy of ['5db40505308f', '54a05ea91281', '2bdad504f50e', '37f3980a1129']) expect(files.some((f) => f.includes(legacy)), legacy).toBe(false);
    expect(files).not.toContain('bank.json');
  });

  it('idempotencja skryptu: wydanie z bieżących wejść = bajtowo pliki w repo (bank, retired, profil, allowlista, moduł allowlisty)', async () => {
    const result = await buildRelease(readInputs(root));
    expect(Object.keys(result.files).sort()).toEqual(
      [`public/${CONTENT_RELEASE.bankFile}`, `public/${CONTENT_RELEASE.retiredFile}`, `public/${CONTENT_RELEASE.profileFile}`, 'content/v18-webinary/allowed_question_ids.json', 'src/persistence/v18Allowlist.ts'].sort(),
    );
    for (const [rel, content] of Object.entries(result.files)) expect(raw(rel).toString('utf-8') === content, rel).toBe(true);
    expect([result.bankVersion, result.bankSha256, result.retiredSha256, result.profileSha256, result.allowedSha256]).toEqual([
      CONTENT_RELEASE.bankVersion,
      CONTENT_RELEASE.bankSha256,
      CONTENT_RELEASE.retiredSha256,
      CONTENT_RELEASE.profileSha256,
      CONTENT_RELEASE.allowedSha256,
    ]);
    expect(result.identicalPairs).toEqual([]);
  });
});

describe('947 = 700 V18 (bez zmian) + 247 WB (1:1 z dodatkiem)', () => {
  it('700 rekordów V18 głęboko równych content/v18/bank.json (kolejność i obiekty), potem 247 WB w kolejności dodatku', () => {
    expect(BANK.questions).toHaveLength(947);
    expect(BANK.questions.slice(0, 700)).toEqual(V18_BANK.questions);
    expect(JSON.stringify(BANK.questions.slice(0, 700))).toBe(JSON.stringify(V18_BANK.questions));
    expect(WB.map((q) => q.id)).toEqual(ADD_MANIFEST.active_ids);
  });

  it('pola najwyższego poziomu V18 bez zmian (poza wersją, datą, liczbami, opisami stanu, tematami, źródłami); addenda przed domains', () => {
    const v18 = V18_BANK as unknown as Record<string, unknown>;
    const merged = BANK as unknown as Record<string, unknown>;
    const v18Keys = Object.keys(v18);
    const at = v18Keys.indexOf('domains');
    expect(Object.keys(merged)).toEqual([...v18Keys.slice(0, at), 'addenda', ...v18Keys.slice(at)]);
    const changed = new Set(['bank_version', 'built_on', 'counts', 'status_pl', 'pool_note_pl', 'topics', 'sources', 'questions']);
    for (const key of v18Keys.filter((k) => !changed.has(k))) expect(merged[key], key).toEqual(v18[key]);
    expect(BANK.status_pl).toBe(
      `${V18_BANK.status_pl} 247 pytań z transkrypcji webinarów (napisy automatyczne): klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.`,
    );
    expect(BANK.pool_note_pl).toBe(
      `${V18_BANK.pool_note_pl ?? ''} Dodano 247 pytań z transkrypcji webinarów (napisy automatyczne); klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.`,
    );
    expect(merged.addenda).toEqual([{ format: 'dme-webinar-addendum', bank_version: ADDENDUM.bank_version, sha256: ADD_MANIFEST.bank_sha256, count: 247, id_prefix: 'WB-' }]);
  });

  it('counts: 947 pytań, 939 rodzin, działy, trudność, statusy kontroli (600 / 100 / 247)', () => {
    expect(JSON.stringify(BANK.counts)).toBe(
      JSON.stringify({
        questions: 947,
        families: 939,
        by_domain: { ANAT: 147, SKIN: 196, DEV: 263, INJ: 186, THER: 72, SAFE: 83 },
        by_difficulty: { basic: 647, intermediate: 200, advanced: 100 },
        schematic: 0,
        independently_checked_draft: 600,
        author_checked_draft: 100,
        source_checked_AI_draft: 247,
      }),
    );
  });

  it('każde pytanie WB: pola dodatku 1:1 (review_status → content_check_status), pola adaptera z kontraktu', () => {
    const byId = new Map(ADDENDUM.questions.map((q) => [q.id as string, q]));
    for (const out of WB) {
      const id = out.id as string;
      const src = byId.get(id)!;
      for (const [key, value] of Object.entries(src)) {
        if (key === 'review_status') continue;
        expect(out[key], `${id}.${key}`).toEqual(value);
      }
      expect(src.review_status, id).toBe('source_checked_AI_draft');
      expect(out, id).toMatchObject({
        origin: 'webinar',
        topic_ids: [`WB-T-${String(src.source_id)}-${String(src.domain_id)}`],
        figure_id: null,
        explanation_figure_id: null,
        review_status: 'draft_pending_clinical_review',
        approved_for_question_key: false,
        content_check_status: 'source_checked_AI_draft',
        cognitive_level: null,
        clinical_signoff: false,
      });
      expect(out.stem_pl as string, id).toMatch(/\[webinar\]$/);
    }
    // Przykład ze story: temat z `source_id` (W16) i działu pytania — WB-USGTR-017 ma w dodatku `domain_id: INJ`
    // (story podaje „WB-T-W16-DEV”, co przeczy regule WB-T-<source_id>-<domain_id> i danym).
    const usg = WB.find((q) => q.id === 'WB-USGTR-017')!;
    expect(usg.domain_id).toBe('INJ');
    expect([usg.source_locator_pl, usg.topic_ids]).toEqual(['W11: W11-U0033; W16: W16-U0010', ['WB-T-W16-INJ']]);
    expect(WB.find((q) => q.id === 'WB-LIGHT-001')!.source_locator_pl).toBe('W13: W13-U0022');
  });

  it('fingerprint każdego z 947 pytań przeliczony algorytmem aplikacji = zapisany', async () => {
    for (const q of BANK.questions) expect(await fingerprintRuntimeQuestion(q), q.id).toBe(q.fingerprint);
  });

  it('źródła: 391 V18 bez zmian + W01…W17 z dodatku (url/doi/pmid null, transkrypcja webinaru, plik i SHA z dodatku)', () => {
    const ids = Object.keys(BANK.sources);
    expect(ids).toHaveLength(391 + 17);
    expect(ids.slice(0, 391)).toEqual(Object.keys(V18_BANK.sources));
    for (const id of ids.slice(0, 391)) expect(BANK.sources[id], id).toEqual(V18_BANK.sources[id]);
    expect(ids.slice(391)).toEqual(Object.keys(ADDENDUM.sources));
    for (const id of ids.slice(391)) {
      const s = ADDENDUM.sources[id]!;
      expect(BANK.sources[id], id).toEqual({
        id,
        title: s.title,
        url: null,
        doi: null,
        pmid: null,
        kind: 'user_supplied_webinar_transcript',
        kind_pl: 'transkrypcja webinaru',
        access: 'source_unit',
        access_pl: 'fragmenty automatycznych napisów',
        checked_on: null,
        filename: s.filename,
        sha256: s.sha256,
        locator_type: 'source_unit',
        audio_verified: false,
      });
    }
    for (const q of WB) for (const sid of q.source_ids as string[]) expect(sid, String(q.id)).toMatch(/^W\d\d$/);
  });

  it('tematy: V18 bez zmian + jeden WB-T-<Wxx>-<DOM> na parę (webinar, dział), tytuł webinaru, posortowane po ID', () => {
    const ids = Object.keys(BANK.topics);
    const v18Ids = Object.keys(V18_BANK.topics);
    expect(ids.slice(0, v18Ids.length)).toEqual(v18Ids);
    for (const id of v18Ids) expect(BANK.topics[id], id).toEqual(V18_BANK.topics[id]);
    const pairs = [...new Set(ADDENDUM.questions.map((q) => `WB-T-${String(q.source_id)}-${String(q.domain_id)}`))].sort();
    expect(ids.slice(v18Ids.length)).toEqual(pairs);
    expect(pairs).toHaveLength(25);
    expect(BANK.topics['WB-T-W16-DEV']).toEqual({ id: 'WB-T-W16-DEV', title_pl: ADDENDUM.sources.W16!.title, domain_id: 'DEV', learning_objective_pl: null, clinical_pearls_pl: [] });
  });

  it('3 ID wykluczone przez redakcję nie występują w banku', () => {
    expect(Object.keys(EXCLUDED)).toHaveLength(3);
    const ids = new Set(BANK.questions.map((q) => q.id));
    for (const id of Object.keys(EXCLUDED)) expect(ids.has(id), id).toBe(false);
  });
});

describe('pliki towarzyszące wydania', () => {
  it('retired: te same 3120 ID co V18 i ta sama policy, nowa wersja; żadne ID nie występuje w banku', () => {
    const r = RETIRED_RAW as unknown as { bank_version: string; ids: string[]; policy: string };
    expect(Object.keys(r)).toEqual(Object.keys(V18_RETIRED));
    expect(r.ids).toEqual(V18_RETIRED.ids);
    expect(r.policy).toBe(V18_RETIRED.policy);
    const inBank = new Set(BANK.questions.map((q) => q.id));
    expect(r.ids.filter((id) => inBank.has(id))).toEqual([]);
  });

  it('profil: wagi i przykład V18, grupy V18 + WB wg działu, każde ID banku dokładnie raz, rules_pl z 947 zamiast 700', () => {
    const p = PROFILE_RAW as unknown as typeof V18_PROFILE;
    expect(p.weights).toEqual(V18_PROFILE.weights);
    expect(p.example_20_question_test).toEqual(V18_PROFILE.example_20_question_test);
    const group = (d: string): string => (d === 'SKIN' ? 'skin' : d === 'ANAT' ? 'facial_anatomy' : 'other');
    for (const [g, ids] of Object.entries(V18_PROFILE.groups)) {
      const wb = WB.filter((q) => group(q.domain_id as string) === g).map((q) => q.id as string);
      expect(p.groups[g], g).toEqual([...ids, ...wb]);
    }
    expect(Object.keys(PROFILE.groupOf).sort()).toEqual(BANK.questions.map((q) => q.id).sort());
    expect(p.rules_pl).toEqual(V18_PROFILE.rules_pl.map((r) => r.replace(/\b700\b/g, '947')));
    expect(p.rules_pl.join(' ')).not.toMatch(/\b700\b/);
    expect(p.rules_pl.join(' ')).toMatch(/\b947\b/);
  });

  it('allowlista content/v18-webinary: tryb, składniki 700 + 247, ID V18 w kolejności V18, potem WB w kolejności dodatku', () => {
    expect(Object.keys(ALLOWED)).toEqual(['bank_version', 'mode', 'components', 'ids']);
    expect(ALLOWED.mode).toBe('v18_plus_webinar_addendum');
    expect(ALLOWED.components).toEqual({ V18: 700, WB: 247 });
    expect(ALLOWED.ids).toEqual([...V18_ALLOWED_IDS, ...ADD_MANIFEST.active_ids]);
  });

  it('src/persistence/v18Allowlist.ts: 947 wierszy z revision, fingerprint, kluczem, rodziną i dziedziną banku; nowa wersja', () => {
    expect(V18_ALLOWED_BANK_VERSION).toBe(CONTENT_RELEASE.bankVersion);
    expect(V18_ALLOWED).toHaveLength(947);
    expect(V18_ALLOWED.map(([id]) => id)).toEqual([...ALLOWED.ids].sort());
    const byId = new Map(BANK.questions.map((q) => [q.id, q]));
    for (const [id, revision, fingerprint, correct, family, domain] of V18_ALLOWED) {
      const q = byId.get(id)!;
      expect([revision, fingerprint, correct, family, domain], id).toEqual([q.revision, q.fingerprint, q.correct_option_id, q.family_id, q.domain_id]);
    }
  });
});

describe('katalog przy starcie i pula', () => {
  it('katalog bez issues; ID = allowlista 947; 247 pytań z dowodem webinaru', () => {
    expect(catalog.issues).toEqual([]);
    expect(catalog.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(catalog.questions.map((q) => q.id).sort()).toEqual([...ALLOWED.ids].sort());
    expect(catalog.questions.filter((q) => q.webinarEvidence !== null)).toHaveLength(CONTENT_RELEASE.counts.webinar);
    expect(catalog.bankSummary).toMatchObject({ questions: 947, families: 939, declaredCountsMatch: true, independentlyChecked: 600 });
  });

  it('źródła webinaru w katalogu: bez url/doi/pmid, z nazwą pliku i znacznikiem webinaru; źródła V18 bez nazwy pliku', () => {
    for (const id of Object.keys(ADDENDUM.sources)) {
      expect(catalog.sources[id], id).toMatchObject({ url: null, doi: null, pmid: null, webinar: true, fileName: ADDENDUM.sources[id]!.filename });
    }
    expect(catalog.sources['V16-ANAT-S01']).toMatchObject({ webinar: false, fileName: null });
  });

  it('pula „wszystko” = 947 pytań; pojemność (Test N max) = 939 rodzin', () => {
    expect(poolFor(catalog, emptyUserState(), 'ALL', 'mixed', '2026-11-15T10:00:00.000Z').questionIds).toHaveLength(947);
    expect(capacityFor(catalog, emptyUserState(), 'ALL', 'mixed')).toBe(939);
  });

  it('Test 939/mixed/ALL: każda rodzina dokładnie raz, w tym wszystkie 247 pytań WB', () => {
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 939, myErrorsPriority: false }, seed: 15 }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    const ids = s.plan.map((slot) => s.slots[slot]!.questionId);
    expect(ids).toHaveLength(939);
    expect(new Set(ids.map((id) => catalog.questionsById[id]!.familyId)).size).toBe(939);
    expect(ids.filter((id) => id.startsWith('WB-'))).toHaveLength(247);
  });
});
