/**
 * FREE_FLOW_POLICY_V2 — dobór kolejnego pytania Free Flow (DECYZJE §7; SPECYFIKACJA §4; 03_ARCHITEKTURA §4).
 *
 * Wagi: ALL — DEV 0,40, pozostałe po 0,12 (renormalizacja przy braku podaży); domena solo — 100%.
 * Adaptacja: domena z ≥ 10 ważnymi próbami w historii, `err_d` = odsetek błędów w ostatnich 30 próbach,
 * `w_d = base_d × clamp(1 + 0,5 × (err_d − średnia_err), 0,5, 1,5)`, podłoga 0,05, renormalizacja.
 * Domena: maksymalny deficyt `w_d × (n + 1) − liczba_d_w_sesji`; remis — kolejność rotacyjna.
 * W domenie: należne aktywne błędy → niewidziane → najdawniej widziane.
 * Wykluczenia: poprzednie pytanie, pytania z ostatnich 10 slotów, rodziny z ostatnich 5 slotów.
 *
 * Małe pule (V2, DECYZJE §7 — zmiana względem V1, w którym luzowanie nie było zapisane w DECYZJE, a odstęp
 * błędnych omijała ścieżka „najdawniej widziane”): gdy przy pełnych wykluczeniach nie ma kandydata, reguły
 * są luzowane stopniami, zawsze do pierwszego stopnia z kandydatem:
 *   1. pełne okna (ostatnie 10 pytań, rodziny ostatnich 5) + odstęp błędnych w sesji (≥ 8 innych pytań),
 *   2. tylko inna rodzina niż poprzednie pytanie + odstęp błędnych,
 *   3. tylko inna rodzina niż poprzednie pytanie,
 *   4. tylko odstęp błędnych,
 *   5. dowolne pytanie poza poprzednim.
 * Odstęp błędnych obowiązuje więc na każdej ścieżce (należne błędy, niewidziane, najdawniej widziane),
 * dopóki istnieje inny kandydat. Poprzednie pytanie nie wraca nigdy bezpośrednio. Brak kandydata → `null`
 * (stan `empty`).
 */
import { FREE_FLOW_ADAPTATION, FREE_FLOW_BASE_WEIGHTS, FREE_FLOW_SPACING } from './policies';
import { compareByDue, isDue } from './review';
import { rngFor, shuffle } from './rng';
import { isFamilySeen, type SeenIndex } from './seen';
import { DOMAIN_IDS, type Attempt, type CatalogQuestion, type DomainId, type IsoDateTime, type QuestionId, type Scope, type Slot, type TrainingProfile } from './types';
import { compareIsoNullFirst, compareStrings, rotate } from './util';
import { sortAttempts } from './review';

export type DomainWeights = Partial<Record<DomainId, number>>;

function normalize<K>(weights: Map<K, number>): Map<K, number> {
  let total = 0;
  for (const w of weights.values()) total += w;
  if (total <= 0) {
    const eq = weights.size > 0 ? 1 / weights.size : 0;
    return new Map([...weights.keys()].map((d) => [d, eq]));
  }
  return new Map([...weights].map(([d, w]) => [d, w / total]));
}

/** Podłoga ekspozycji: każda dostępna domena ≥ `floor`, reszta proporcjonalnie (iteracyjnie). */
function applyFloor<K>(weights: Map<K, number>, floor: number): Map<K, number> {
  const n = weights.size;
  if (n === 0) return weights;
  if (floor * n >= 1) return new Map([...weights.keys()].map((d) => [d, 1 / n]));
  const fixed = new Set<K>();
  let current = normalize(weights);
  for (let iter = 0; iter < n; iter++) {
    const below = [...current].filter(([d, w]) => !fixed.has(d) && w < floor).map(([d]) => d);
    if (below.length === 0) break;
    for (const d of below) fixed.add(d);
    const remaining = 1 - floor * fixed.size;
    let freeTotal = 0;
    for (const [d, w] of current) if (!fixed.has(d)) freeTotal += w;
    const next = new Map<K, number>();
    for (const [d, w] of current) {
      next.set(d, fixed.has(d) ? floor : freeTotal > 0 ? (w / freeTotal) * remaining : remaining / (n - fixed.size));
    }
    current = next;
  }
  return current;
}

/**
 * Wagi domen po adaptacji (suma = 1) dla dostępnych domen zakresu.
 * @param attempts dziennik prób (wykluczone są pomijane)
 * @param available domeny z podażą w puli
 */
export function computeFreeFlowWeights(attempts: readonly Attempt[], scope: Scope, available: readonly DomainId[]): DomainWeights {
  const domains = DOMAIN_IDS.filter((d) => available.includes(d) && (scope === 'ALL' || d === scope));
  if (domains.length === 0) return {};
  if (scope !== 'ALL') return { [scope]: 1 };

  const byDomain = new Map<DomainId, Attempt[]>();
  for (const a of sortAttempts(attempts.filter((x) => !x.excluded))) {
    const list = byDomain.get(a.domainId);
    if (list) list.push(a);
    else byDomain.set(a.domainId, [a]);
  }
  const err = new Map<DomainId, number>();
  for (const d of domains) {
    const list = byDomain.get(d) ?? [];
    if (list.length < FREE_FLOW_ADAPTATION.minAttempts) continue;
    const recent = list.slice(-FREE_FLOW_ADAPTATION.recentWindow);
    err.set(d, recent.filter((a) => !a.correct).length / recent.length);
  }
  let mean = 0;
  for (const e of err.values()) mean += e;
  mean = err.size > 0 ? mean / err.size : 0;

  const raw = new Map<DomainId, number>();
  for (const d of domains) {
    const e = err.get(d);
    const factor =
      e === undefined
        ? 1
        : Math.min(FREE_FLOW_ADAPTATION.clampMax, Math.max(FREE_FLOW_ADAPTATION.clampMin, 1 + FREE_FLOW_ADAPTATION.gain * (e - mean)));
    raw.set(d, FREE_FLOW_BASE_WEIGHTS[d] * factor);
  }
  const final = applyFloor(normalize(raw), FREE_FLOW_ADAPTATION.floorWeight);
  const out: DomainWeights = {};
  for (const d of domains) out[d] = final.get(d) ?? 0;
  return out;
}

/**
 * FREE_FLOW_POLICY_V3 (DECYZJE §7a): wagi GRUP profilu treningowego V15 dla całego zakresu (zamiast dawnego
 * DEV 0,40) z tą samą adaptacją co V2 — grupa z ≥ 10 ważnymi próbami, `err_g` z ostatnich 30 prób grupy,
 * `w_g = base_g × clamp(1 + 0,5 × (err_g − średnia), 0,5, 1,5)`, podłoga 0,05, renormalizacja.
 * Próby pytań spoza profilu (np. poprzednia wersja banku, pytania wyłączone) nie liczą się do adaptacji.
 */
export function computeProfileWeights(attempts: readonly Attempt[], profile: TrainingProfile, available: readonly string[]): Record<string, number> {
  const groups = profile.groupOrder.filter((g) => available.includes(g));
  if (groups.length === 0) return {};
  const byGroup = new Map<string, Attempt[]>();
  for (const a of sortAttempts(attempts.filter((x) => !x.excluded))) {
    const g = profile.groupOf[a.questionId];
    if (g === undefined) continue;
    const list = byGroup.get(g);
    if (list) list.push(a);
    else byGroup.set(g, [a]);
  }
  const err = new Map<string, number>();
  for (const g of groups) {
    const list = byGroup.get(g) ?? [];
    if (list.length < FREE_FLOW_ADAPTATION.minAttempts) continue;
    const recent = list.slice(-FREE_FLOW_ADAPTATION.recentWindow);
    err.set(g, recent.filter((a) => !a.correct).length / recent.length);
  }
  let mean = 0;
  for (const e of err.values()) mean += e;
  mean = err.size > 0 ? mean / err.size : 0;
  const raw = new Map<string, number>();
  for (const g of groups) {
    const e = err.get(g);
    const factor =
      e === undefined
        ? 1
        : Math.min(FREE_FLOW_ADAPTATION.clampMax, Math.max(FREE_FLOW_ADAPTATION.clampMin, 1 + FREE_FLOW_ADAPTATION.gain * (e - mean)));
    raw.set(g, ((profile.weightsBp[g] ?? 0) / 10000) * factor);
  }
  const final = applyFloor(normalize(raw), FREE_FLOW_ADAPTATION.floorWeight);
  const out: Record<string, number> = {};
  for (const g of groups) out[g] = final.get(g) ?? 0;
  return out;
}

export interface FreeFlowPickInput {
  /** Pula (zakres, trudność, blokady). */
  pool: readonly CatalogQuestion[];
  scope: Scope;
  seen: SeenIndex;
  attempts: readonly Attempt[];
  /** Sloty planu w kolejności pokazywania (bez slotu właśnie zastępowanego). */
  history: readonly Slot[];
  /** Wszystkie sloty sesji (do „rozwiązane poprawnie w tej sesji”). */
  sessionSlots: readonly Slot[];
  now: IsoDateTime;
  seed: number;
  /** Licznik doborów sesji (sól seeda, rotacja remisów). */
  pickIndex: number;
  myErrorsPriority: boolean;
  /** Profil treningowy (V15): zakres `ALL` → FREE_FLOW_POLICY_V3 (wagi grup). */
  profile?: TrainingProfile | null;
}

export interface FreeFlowPickResult {
  question: CatalogQuestion | null;
  origin: 'freeflow' | 'my_errors';
  familySeen: boolean;
  weights: DomainWeights;
  /** FREE_FLOW_POLICY_V3: wagi grup profilu po adaptacji (suma = 1); bez profilu — `null`. */
  groupWeights: Record<string, number> | null;
  /** „Moje błędy”: czy w zakresie pozostały aktywne błędy nierozwiązane poprawnie w tej sesji. */
  myErrorsRemaining: boolean;
}

/** Stopnie luzowania wykluczeń (opis w nagłówku pliku). */
type Tier = 1 | 2 | 3 | 4 | 5;
const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];

export function pickFreeFlow(input: FreeFlowPickInput): FreeFlowPickResult {
  const { pool, seen, history, now } = input;
  const stats = seen.stats;
  const profile = input.scope === 'ALL' ? (input.profile ?? null) : null;
  // Kubełek doboru: grupa profilu (V3, cały zakres) albo domena (V2 / zakres jednej domeny).
  const bucketOf = (questionId: QuestionId, domainId: DomainId): string => (profile ? (profile.groupOf[questionId] ?? '') : domainId);
  const bucketOrder: readonly string[] = profile ? profile.groupOrder : DOMAIN_IDS;
  const available = bucketOrder.filter((b) => pool.some((q) => bucketOf(q.id, q.domainId) === b));
  const weights: DomainWeights = profile ? {} : computeFreeFlowWeights(input.attempts, input.scope, available as DomainId[]);
  const groupWeights = profile ? computeProfileWeights(input.attempts, profile, available) : null;
  const bucketWeights: Readonly<Record<string, number>> = groupWeights ?? (weights as Record<string, number>);

  // Kontekst sesji.
  const correctInSession = new Set<QuestionId>();
  const wrongInSession = new Set<QuestionId>();
  for (const s of input.sessionSlots) {
    if (!s.attempt || s.excluded) continue;
    (s.attempt.correct ? correctInSession : wrongInSession).add(s.questionId);
  }
  const lastIndex = new Map<QuestionId, number>();
  history.forEach((s, i) => lastIndex.set(s.questionId, i));
  const prev = history[history.length - 1];
  const prevQ = prev?.questionId ?? null;
  const prevFam = prev?.snapshot.familyId ?? null;
  const recentQ = new Set(history.slice(-FREE_FLOW_SPACING.recentQuestionWindow).map((s) => s.questionId));
  const recentF = new Set(history.slice(-FREE_FLOW_SPACING.recentFamilyWindow).map((s) => s.snapshot.familyId));
  const gapOk = (q: CatalogQuestion): boolean => {
    if (!wrongInSession.has(q.id)) return true;
    const li = lastIndex.get(q.id);
    return li === undefined || history.length - 1 - li >= FREE_FLOW_SPACING.wrongReturnAfter;
  };
  const allowed = (q: CatalogQuestion, tier: Tier): boolean => {
    if (q.id === prevQ) return false;
    switch (tier) {
      case 1:
        return !recentQ.has(q.id) && !recentF.has(q.familyId) && gapOk(q);
      case 2:
        return q.familyId !== prevFam && gapOk(q);
      case 3:
        return q.familyId !== prevFam;
      case 4:
        return gapOk(q);
      default:
        return true;
    }
  };
  const result = (question: CatalogQuestion | null, origin: 'freeflow' | 'my_errors', myErrorsRemaining: boolean): FreeFlowPickResult => ({
    question,
    origin,
    familySeen: question ? isFamilySeen(seen, question.familyId) : false,
    weights,
    groupWeights,
    myErrorsRemaining,
  });

  // „Moje błędy”: najpierw aktywne błędy z całego zakresu (należne najpierw).
  let myErrorsRemaining = false;
  if (input.myErrorsPriority) {
    const errors = pool.filter((q) => stats[q.id]?.activeError === true && !correctInSession.has(q.id));
    myErrorsRemaining = errors.length > 0;
    const eligible = errors.filter((q) => allowed(q, 1));
    if (eligible.length > 0) {
      eligible.sort((a, b) => {
        const sa = stats[a.id];
        const sb = stats[b.id];
        if (!sa || !sb) return compareStrings(a.id, b.id);
        const da = isDue(sa, now) ? 0 : 1;
        const db = isDue(sb, now) ? 0 : 1;
        return da - db || compareByDue(sa, sb);
      });
      return result(eligible[0] ?? null, 'my_errors', true);
    }
  }

  // Zwykła polityka: kubełek (domena albo grupa profilu) o największym deficycie, w nim należne błędy →
  // niewidziane → najdawniej widziane.
  const counts = new Map<string, number>();
  let n = 0;
  for (const s of history) {
    if (s.excluded) continue;
    const b = bucketOf(s.questionId, s.snapshot.domainId);
    counts.set(b, (counts.get(b) ?? 0) + 1);
    n++;
  }
  const rotation = rotate(bucketOrder, input.pickIndex);
  const rng = rngFor(input.seed, `ff:${input.pickIndex}`);
  for (const tier of TIERS) {
    const byDomain = new Map<string, CatalogQuestion[]>();
    for (const q of pool) {
      if (!allowed(q, tier)) continue;
      const b = bucketOf(q.id, q.domainId);
      const list = byDomain.get(b);
      if (list) list.push(q);
      else byDomain.set(b, [q]);
    }
    const candidatesDomains = rotation.filter((d) => (byDomain.get(d)?.length ?? 0) > 0 && (bucketWeights[d] ?? 0) > 0);
    if (candidatesDomains.length === 0) continue;
    const deficit = (d: string): number => (bucketWeights[d] ?? 0) * (n + 1) - (counts.get(d) ?? 0);
    let best = candidatesDomains[0] as string;
    for (const d of candidatesDomains) if (deficit(d) > deficit(best) + 1e-12) best = d;
    const cands = byDomain.get(best) ?? [];

    const dueErrors = cands.filter((q) => isDue(stats[q.id], now) && !correctInSession.has(q.id));
    if (dueErrors.length > 0) {
      dueErrors.sort((a, b) => {
        const sa = stats[a.id];
        const sb = stats[b.id];
        return sa && sb ? compareByDue(sa, sb) : compareStrings(a.id, b.id);
      });
      return result(dueErrors[0] ?? null, 'freeflow', myErrorsRemaining);
    }
    const ordered = shuffle(
      [...cands].sort((a, b) => compareStrings(a.id, b.id)),
      rng,
    ).sort((a, b) => {
      const fa = isFamilySeen(seen, a.familyId) ? 1 : 0;
      const fb = isFamilySeen(seen, b.familyId) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      const sa = stats[a.id];
      const sb = stats[b.id];
      return compareIsoNullFirst(sa?.lastSeenAt ?? null, sb?.lastSeenAt ?? null) || (sa?.seenCount ?? 0) - (sb?.seenCount ?? 0);
    });
    return result(ordered[0] ?? null, 'freeflow', myErrorsRemaining);
  }
  return result(null, 'freeflow', myErrorsRemaining);
}
