/**
 * Parametry wersjonowanych polityk (docs/DECYZJE_ARCHITEKTURY.md §4–§8).
 * Wartości są decyzjami redakcyjnymi/osobistymi, nie statystyką egzaminu.
 * Zmiana wartości = nowa wersja polityki (np. TEST_POLICY_V2) i wpis w DECYZJE.
 */
import { DOMAIN_IDS, type DomainId, type SessionConfig } from './types';

/** Próg zaliczenia treningowego testu w procentach (całkowitoliczbowo, §4). */
export const PASS_PERCENT = 65;

/** Domyślna liczba pytań testu i wartości szybkie (S04). */
export const DEFAULT_TEST_N = 20;
export const QUICK_N_VALUES = [20, 30, 40, 50, 60] as const;
export const N_STEP = 10;

/** Pierwsze uruchomienie: cały zakres, mieszany, Test 20, bez „Moje błędy”. */
export const DEFAULT_TEST_CONFIG: Readonly<SessionConfig> = Object.freeze({
  scope: 'ALL',
  difficulty: 'mixed',
  targetN: DEFAULT_TEST_N,
  myErrorsPriority: false,
});

/** Pierwsze uruchomienie Free Flow: cały zakres, mieszany, bez N. */
export const DEFAULT_FREE_FLOW_CONFIG: Readonly<SessionConfig> = Object.freeze({
  scope: 'ALL',
  difficulty: 'mixed',
  targetN: null,
  myErrorsPriority: false,
});

/** TEST_POLICY_V2 (§6, bez zmian względem V1): rotacja reszty z dzielenia N przez 6, od przesunięcia `testy mod 6`. */
export const TEST_DOMAIN_ROTATION: readonly DomainId[] = DOMAIN_IDS;

/** FREE_FLOW_POLICY_V2 (§7, bez zmian względem V1): wagi bazowe dla zakresu ALL (renormalizacja przy braku podaży). */
export const FREE_FLOW_BASE_WEIGHTS: Readonly<Record<DomainId, number>> = Object.freeze({
  ANAT: 0.12,
  INJ: 0.12,
  SKIN: 0.12,
  THER: 0.12,
  DEV: 0.4,
  SAFE: 0.12,
});

/**
 * FREE_FLOW_POLICY_V2 (§7, bez zmian względem V1): adaptacja deterministyczna
 * `w_d = base_d × clamp(1 + gain × (err_d − średnia_err), clampMin, clampMax)`, podłoga `floorWeight`.
 */
export const FREE_FLOW_ADAPTATION = Object.freeze({
  /** Minimalna liczba ocenionych prób domeny w historii, by ją adaptować. */
  minAttempts: 10,
  /** Okno ostatnich prób domeny do `err_d`. */
  recentWindow: 30,
  gain: 0.5,
  clampMin: 0.5,
  clampMax: 1.5,
  floorWeight: 0.05,
});

/** FREE_FLOW_POLICY_V2 (§7): odstępy powtórzeń w sesji (wartości jak w V1; V2 — stopnie luzowania w freeFlowPolicy.ts). */
export const FREE_FLOW_SPACING = Object.freeze({
  /** Błędne w tej sesji wracają najwcześniej po tylu innych pytaniach. */
  wrongReturnAfter: 8,
  /** Wyklucz pytania pokazane w ostatnich N slotach. */
  recentQuestionWindow: 10,
  /** Wyklucz rodziny z ostatnich N slotów. */
  recentFamilyWindow: 5,
});

/** REVIEW_POLICY_V1 (§8): strefa czasowa „następnego dnia kalendarzowego” (liczy kontroler). */
export const REVIEW_TIME_ZONE = 'Europe/Warsaw';
