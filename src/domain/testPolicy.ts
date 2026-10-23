/**
 * TEST_POLICY_V2 — dobór zamrożonego planu testu (DECYZJE §6; SPECYFIKACJA §5–§7; 03_ARCHITEKTURA §4).
 *
 * 1. Pozycje obowiązkowe (runda „Uwzględnij błędy”, „Moje błędy”) — przekazywane z zewnątrz.
 * 2. Kwoty domen (ALL): `floor(N/6)` każdej, reszta po jednej rotacyjnie `[ANAT, INJ, SKIN, THER, DEV, SAFE]`
 *    od przesunięcia `testy mod 6`. Obowiązkowe zaliczają się do kwoty swojej domeny (kwota ≥ 0);
 *    nadwyżkę pokrywa zmniejszenie kwot innych domen (najpierw największa wolna kwota, remis —
 *    domena późniejsza w rotacji).
 * 3. `mixed`: w kwocie domeny równy podział basic/intermediate/advanced (reszta rotacyjnie od
 *    `(przesunięcie + indeks domeny) mod 3`); obowiązkowe zaliczają się do swojej komórki.
 *    Niedobór poziomu → inne poziomy tej domeny (rotacyjnie), potem inne domeny (rotacyjnie).
 *    Każde przesunięcie zapisane w `allocation.redistributed`.
 * 4. W komórce: rodziny nieużyte w sesji i niebędące rodzinami obowiązkowych; nigdy niewidziane
 *    (losowo seedem) → widziane wg `lastSeenAt`, potem `seenCount`. Jedno pytanie na rodzinę.
 *    V2 (zmiana względem V1): „najpierw niewidziane” obowiązuje w CAŁYM wybranym zakresie
 *    (SPECYFIKACJA §6, kryterium D04). Dobór idzie dwoma przebiegami: (A) wyłącznie rodziny
 *    nigdy niewidziane — komórka, potem inne poziomy tej domeny, potem inne domeny (przesunięcia
 *    z `reason: 'unseen'`, gdy w komórce zostały jeszcze rodziny widziane); (B) pozostałe miejsca
 *    rodzinami widzianymi (najdawniej widziane) — znów od własnej komórki, jak w V1.
 *    Gdy wszystkie rodziny zakresu są niewidziane albo wszystkie widziane, wynik jest identyczny z V1.
 */
import { rngFor } from './rng';
import { chooseRepresentative, isFamilySeen, orderFamilies, type SeenIndex } from './seen';
import {
  DOMAIN_IDS,
  type Allocation,
  type AllocationCell,
  type CatalogQuestion,
  type Difficulty,
  type DifficultyChoice,
  type DomainId,
  type FamilyId,
  type QuestionId,
  type QuestionSnapshot,
  type Redistribution,
  type Scope,
  type SlotOrigin,
} from './types';
import { choiceLevels, rotate } from './util';

export interface MandatoryItem {
  origin: 'repeated_wrong' | 'my_errors';
  questionId: QuestionId;
  familyId: FamilyId;
  domainId: DomainId;
  difficulty: Difficulty;
  /** Bieżąca rewizja z katalogu albo `null`, gdy pytania nie ma (wtedy `fallback`). */
  question: CatalogQuestion | null;
  fallback: QuestionSnapshot | null;
}

export interface PlannedPick {
  origin: SlotOrigin;
  question: CatalogQuestion | null;
  fallback: QuestionSnapshot | null;
  /** Rodzina była wcześniej wyświetlona („z wcześniejszej nauki”). */
  familySeen: boolean;
}

export interface TestPlanInput {
  pool: readonly CatalogQuestion[];
  scope: Scope;
  difficulty: DifficultyChoice;
  n: number;
  mandatory: readonly MandatoryItem[];
  rotationOffset: number;
  seed: number;
  seen: SeenIndex;
  /** `planned` dla niezależnego testu, `filler` dla rundy „Uwzględnij błędy”/„Nowa runda”. */
  fillerOrigin: 'planned' | 'filler';
  capacityAtStart: number;
}

export type TestPlanResult = { ok: true; picks: PlannedPick[]; allocation: Allocation } | { ok: false; available: number };

const cellKey = (d: DomainId, l: Difficulty): string => `${d}|${l}`;

function inc<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * Wolne miejsca kubełków: `max(0, cel − obowiązkowe)`, następnie redukcja do sumy `total`
 * (zawsze z kubełka o największej wolnej kwocie; remis — kubełek późniejszy w `order`).
 */
export function reduceToTotal<K>(order: readonly K[], targets: ReadonlyMap<K, number>, mandatory: ReadonlyMap<K, number>, total: number): Map<K, number> {
  const free = order.map((k) => Math.max(0, (targets.get(k) ?? 0) - (mandatory.get(k) ?? 0)));
  let diff = free.reduce((a, b) => a + b, 0) - total;
  while (diff > 0) {
    let best = -1;
    for (let i = 0; i < free.length; i++) {
      if ((free[i] ?? 0) > 0 && (best < 0 || (free[i] ?? 0) >= (free[best] ?? 0))) best = i;
    }
    if (best < 0) break;
    free[best] = (free[best] ?? 0) - 1;
    diff--;
  }
  // Zabezpieczenie (matematycznie nieosiągalne): brakujące miejsca rotacyjnie od początku.
  for (let i = 0; diff < 0 && order.length > 0; i = (i + 1) % order.length) {
    free[i] = (free[i] ?? 0) + 1;
    diff++;
  }
  return new Map(order.map((k, i) => [k, free[i] ?? 0]));
}

/** Równy podział `total` na kubełki w kolejności `order` (reszta po jednej od początku). */
export function splitEvenly<K>(order: readonly K[], total: number): Map<K, number> {
  const base = order.length > 0 ? Math.floor(total / order.length) : 0;
  const rem = order.length > 0 ? total % order.length : 0;
  return new Map(order.map((k, i) => [k, base + (i < rem ? 1 : 0)]));
}

/** Kolejność rotacji domen dla zakresu. */
export function domainRotation(scope: Scope, rotationOffset: number): DomainId[] {
  return rotate(DOMAIN_IDS, rotationOffset).filter((d) => scope === 'ALL' || d === scope);
}

/** Kolejność poziomów w domenie (reszta podziału rotacyjnie, różnie dla kolejnych domen). */
export function levelRotation(domainId: DomainId, levels: readonly Difficulty[], rotationOffset: number): Difficulty[] {
  return rotate(levels, (rotationOffset + DOMAIN_IDS.indexOf(domainId)) % Math.max(1, levels.length));
}

/** Cele kwot domen wg TEST_POLICY_V2 (bez zmian względem V1). */
export function domainQuotas(scope: Scope, n: number, rotationOffset: number): Map<DomainId, number> {
  if (scope !== 'ALL') return new Map([[scope, n]]);
  return splitEvenly(domainRotation('ALL', rotationOffset), n);
}

export function planTest(input: TestPlanInput): TestPlanResult {
  const { pool, scope, difficulty, n, mandatory, rotationOffset, seed, seen } = input;
  const levels = choiceLevels(difficulty);
  const rotation = domainRotation(scope, rotationOffset);
  const usedFamilies = new Set<FamilyId>(mandatory.map((m) => m.familyId));
  const fillTotal = n - mandatory.length;

  const inScope = pool.filter((q) => rotation.includes(q.domainId) && levels.includes(q.difficulty));
  const freeFamilies = new Set(inScope.filter((q) => !usedFamilies.has(q.familyId)).map((q) => q.familyId));
  if (fillTotal < 0 || freeFamilies.size < fillTotal) return { ok: false, available: mandatory.length + freeFamilies.size };

  // 2. Kwoty domen i wolne miejsca po obowiązkowych.
  const domainTargets = domainQuotas(scope, n, rotationOffset);
  const mDomain = new Map<DomainId, number>();
  const mCell = new Map<string, number>();
  for (const m of mandatory) {
    inc(mDomain, m.domainId);
    inc(mCell, cellKey(m.domainId, m.difficulty));
  }
  const domainFree = reduceToTotal(rotation, domainTargets, mDomain, fillTotal);

  // 3. Komórki domena × poziom.
  const levelOrder = new Map<DomainId, Difficulty[]>(rotation.map((d) => [d, levelRotation(d, levels, rotationOffset)]));
  const cellTargets = new Map<string, number>();
  const cellFree = new Map<string, number>();
  for (const d of rotation) {
    const lo = levelOrder.get(d) ?? levels;
    const targets = splitEvenly(lo, domainTargets.get(d) ?? 0);
    const mand = new Map<Difficulty, number>(lo.map((l) => [l, mCell.get(cellKey(d, l)) ?? 0]));
    const free = reduceToTotal(lo, targets, mand, domainFree.get(d) ?? 0);
    for (const l of lo) {
      cellTargets.set(cellKey(d, l), targets.get(l) ?? 0);
      cellFree.set(cellKey(d, l), free.get(l) ?? 0);
    }
  }

  // 4. Koszyki komórek (rodziny w kolejności preferencji).
  const cellFamilies = new Map<string, Set<FamilyId>>();
  const familyQuestions = new Map<string, CatalogQuestion[]>();
  for (const q of inScope) {
    const k = cellKey(q.domainId, q.difficulty);
    let fams = cellFamilies.get(k);
    if (!fams) cellFamilies.set(k, (fams = new Set()));
    fams.add(q.familyId);
    const fk = `${k}#${q.familyId}`;
    const list = familyQuestions.get(fk);
    if (list) list.push(q);
    else familyQuestions.set(fk, [q]);
  }
  const ordered = new Map<string, FamilyId[]>();
  const pointers = new Map<string, number>();
  const orderedFor = (k: string): FamilyId[] => {
    let list = ordered.get(k);
    if (!list) {
      list = orderFamilies(cellFamilies.get(k) ?? [], seen, rngFor(seed, `cell:${k}`));
      ordered.set(k, list);
    }
    return list;
  };
  /**
   * Następna nieużyta rodzina komórki w kolejności preferencji. `unseenOnly` — tylko nigdy
   * niewidziana (lista jest uporządkowana „niewidziane → widziane”, więc wystarczy sprawdzić czoło).
   */
  const nextFamily = (k: string, unseenOnly: boolean): FamilyId | null => {
    const list = orderedFor(k);
    let p = pointers.get(k) ?? 0;
    while (p < list.length && usedFamilies.has(list[p] as FamilyId)) p++;
    pointers.set(k, p);
    const fam = list[p];
    if (fam === undefined) return null;
    if (unseenOnly && isFamilySeen(seen, fam)) return null;
    return fam;
  };
  const fillerPicks: PlannedPick[] = [];
  const pickCells: string[] = [];
  const take = (k: string, unseenOnly: boolean): boolean => {
    const fam = nextFamily(k, unseenOnly);
    if (fam === null) return false;
    usedFamilies.add(fam);
    const question = chooseRepresentative(familyQuestions.get(`${k}#${fam}`) ?? [], seen, rngFor(seed, `rep:${k}:${fam}`));
    if (!question) return false;
    fillerPicks.push({ origin: input.fillerOrigin, question, fallback: null, familySeen: isFamilySeen(seen, fam) });
    pickCells.push(k);
    return true;
  };

  const redistributions = new Map<string, Redistribution>();
  const record = (
    kind: Redistribution['kind'],
    fromD: DomainId,
    fromL: Difficulty | null,
    toD: DomainId,
    toL: Difficulty | null,
    reason: NonNullable<Redistribution['reason']>,
  ): void => {
    const key = `${kind}|${fromD}|${fromL ?? ''}|${toD}|${toL ?? ''}|${reason}`;
    const prev = redistributions.get(key);
    if (prev) prev.count++;
    else redistributions.set(key, { kind, fromDomainId: fromD, fromDifficulty: fromL, toDomainId: toD, toDifficulty: toL, count: 1, reason });
  };

  /** Pozostałe (jeszcze nieobsadzone) miejsca każdej komórki — przechodzą z przebiegu A do B. */
  const remaining = new Map<string, number>();
  for (const d of rotation) for (const l of levelOrder.get(d) ?? levels) remaining.set(cellKey(d, l), cellFree.get(cellKey(d, l)) ?? 0);

  /** Czy w komórce zostały jakiekolwiek nieużyte rodziny (przyczyna przesunięcia w przebiegu A). */
  const hasAny = (k: string): boolean => nextFamily(k, false) !== null;

  const runPass = (unseenOnly: boolean): void => {
    // (1) Własna komórka.
    for (const d of rotation) {
      for (const l of levelOrder.get(d) ?? levels) {
        const k = cellKey(d, l);
        let need = remaining.get(k) ?? 0;
        while (need > 0 && take(k, unseenOnly)) need--;
        remaining.set(k, need);
      }
    }
    // (2) Niedobór poziomu → inne poziomy tej samej domeny (rotacyjnie).
    for (const d of rotation) {
      const lo = levelOrder.get(d) ?? levels;
      let levelPtr = 0;
      lo.forEach((l, li) => {
        const k = cellKey(d, l);
        let s = remaining.get(k) ?? 0;
        if (levelPtr <= li) levelPtr = li + 1;
        while (s > 0) {
          let given = false;
          for (let j = 0; j < lo.length; j++) {
            const idx = (levelPtr + j) % lo.length;
            const l2 = lo[idx] as Difficulty;
            if (l2 === l) continue;
            if (take(cellKey(d, l2), unseenOnly)) {
              record('difficulty', d, l, d, l2, unseenOnly && hasAny(k) ? 'unseen' : 'supply');
              levelPtr = idx + 1;
              given = true;
              break;
            }
          }
          if (!given) break;
          s--;
        }
        remaining.set(k, s);
      });
    }
    // (3) Niedobór domeny → domeny z wolną podażą (rotacyjnie).
    let domainPtr = 0;
    const levelPtrOf = new Map<DomainId, number>();
    for (const d of rotation) {
      const lo = levelOrder.get(d) ?? levels;
      for (const l of lo) {
        const k = cellKey(d, l);
        let s = remaining.get(k) ?? 0;
        while (s > 0) {
          let given = false;
          for (let j = 0; j < rotation.length && !given; j++) {
            const di = (domainPtr + j) % rotation.length;
            const d2 = rotation[di] as DomainId;
            if (d2 === d) continue;
            const lo2 = levelOrder.get(d2) ?? levels;
            const lp = levelPtrOf.get(d2) ?? 0;
            for (let m = 0; m < lo2.length; m++) {
              const li = (lp + m) % lo2.length;
              const l2 = lo2[li] as Difficulty;
              if (take(cellKey(d2, l2), unseenOnly)) {
                record('domain', d, null, d2, null, unseenOnly && lo.some((x) => hasAny(cellKey(d, x))) ? 'unseen' : 'supply');
                levelPtrOf.set(d2, li + 1);
                domainPtr = di + 1;
                given = true;
                break;
              }
            }
          }
          if (!given) break;
          s--;
        }
        remaining.set(k, s);
      }
    }
  };

  // (A) Najpierw rodziny nigdy niewidziane w całym zakresie, (B) potem najdawniej widziane.
  runPass(true);
  if ([...remaining.values()].some((v) => v > 0)) runPass(false);
  if ([...remaining.values()].some((v) => v > 0)) return { ok: false, available: mandatory.length + fillerPicks.length };

  if (fillerPicks.length !== fillTotal) return { ok: false, available: mandatory.length + fillerPicks.length };

  // Przydział faktyczny.
  const mandatoryPicks: PlannedPick[] = mandatory.map((m) => ({
    origin: m.origin,
    question: m.question,
    fallback: m.fallback,
    familySeen: isFamilySeen(seen, m.familyId),
  }));
  const domainActual: Partial<Record<DomainId, number>> = {};
  const cellActual = new Map<string, number>();
  for (const m of mandatory) {
    domainActual[m.domainId] = (domainActual[m.domainId] ?? 0) + 1;
    inc(cellActual, cellKey(m.domainId, m.difficulty));
  }
  for (const k of pickCells) {
    const d = k.split('|')[0] as DomainId;
    domainActual[d] = (domainActual[d] ?? 0) + 1;
    inc(cellActual, k);
  }
  const cells: AllocationCell[] = [];
  const cellDomains = [...rotation, ...DOMAIN_IDS.filter((d) => !rotation.includes(d) && (domainActual[d] ?? 0) > 0)];
  for (const d of cellDomains) {
    for (const l of levelOrder.get(d) ?? choiceLevels('mixed')) {
      const k = cellKey(d, l);
      const target = cellTargets.get(k) ?? 0;
      const actual = cellActual.get(k) ?? 0;
      if (target > 0 || actual > 0) cells.push({ domainId: d, difficulty: l, target, actual });
    }
  }
  const domainTargetsRecord: Partial<Record<DomainId, number>> = {};
  for (const [d, t] of domainTargets) domainTargetsRecord[d] = t;

  const allocation: Allocation = {
    policy: 'TEST_POLICY_V2',
    rotationOffset,
    capacityAtStart: input.capacityAtStart,
    domainTargets: domainTargetsRecord,
    domainActual,
    cells,
    mandatoryRepeated: mandatory.filter((m) => m.origin === 'repeated_wrong').length,
    mandatoryMyErrors: mandatory.filter((m) => m.origin === 'my_errors').length,
    fillersUnseen: fillerPicks.filter((p) => !p.familySeen).length,
    fillersSeen: fillerPicks.filter((p) => p.familySeen).length,
    redistributed: [...redistributions.values()],
    freeFlowWeights: null,
  };
  return { ok: true, picks: [...mandatoryPicks, ...fillerPicks], allocation };
}

/* ========================================================================== */
/* Zastępstwo w teście (DECYZJE §9)                                           */
/* ========================================================================== */

export interface ReplacementInput {
  pool: readonly CatalogQuestion[];
  scope: Scope;
  difficulty: DifficultyChoice;
  /** Rodziny wszystkich slotów sesji (także wykluczonych). */
  excludedFamilies: ReadonlySet<FamilyId>;
  excludedQuestionIds: ReadonlySet<QuestionId>;
  /** Koszyk wykluczonego slotu. */
  preferDomain: DomainId;
  preferDifficulty: Difficulty;
  seen: SeenIndex;
  seed: number;
  salt: string;
}

/**
 * Zastępstwo spoza planu i rodzin planu, z tej samej konfiguracji: najpierw ten sam koszyk
 * (domena × poziom), potem inne poziomy tej domeny, potem inne domeny zakresu. TEST_POLICY_V2:
 * „najpierw niewidziane” w całym zakresie — przebieg (A) przechodzi te kroki wyłącznie z rodzinami
 * nigdy niewidzianymi, przebieg (B) dopuszcza widziane (najdawniej widziane).
 */
export function findTestReplacement(input: ReplacementInput): { question: CatalogQuestion; familySeen: boolean } | null {
  const levels = choiceLevels(input.difficulty);
  const candidates = input.pool.filter(
    (q) =>
      (input.scope === 'ALL' || q.domainId === input.scope) &&
      levels.includes(q.difficulty) &&
      !input.excludedFamilies.has(q.familyId) &&
      !input.excludedQuestionIds.has(q.id),
  );
  const tiers: ((q: CatalogQuestion) => boolean)[] = [
    (q) => q.domainId === input.preferDomain && q.difficulty === input.preferDifficulty,
    (q) => q.domainId === input.preferDomain,
    () => true,
  ];
  for (const unseenOnly of [true, false]) {
    for (let t = 0; t < tiers.length; t++) {
      const tier = tiers[t] as (q: CatalogQuestion) => boolean;
      const qs = candidates.filter(tier);
      if (qs.length === 0) continue;
      // Kolejność całego koszyka (niewidziane → widziane), jak w V1; przebieg A bierze tylko niewidzianą.
      const ordered = orderFamilies(
        qs.map((q) => q.familyId),
        input.seen,
        rngFor(input.seed, `${input.salt}:tier${t}`),
      );
      const fam = unseenOnly ? ordered.find((f) => !isFamilySeen(input.seen, f)) : ordered[0];
      if (fam === undefined) continue;
      const question = chooseRepresentative(
        qs.filter((q) => q.familyId === fam),
        input.seen,
        rngFor(input.seed, `${input.salt}:rep`),
      );
      if (question) return { question, familySeen: isFamilySeen(input.seen, fam) };
    }
  }
  return null;
}
