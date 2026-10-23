/**
 * Teksty interfejsu (po polsku, z Claude Design) i formatowanie wyświetlania.
 * Wyłącznie prezentacja: brak logiki punktacji/doboru (ta jest w src/domain, a liczby niesie VM).
 */
import type { ConfigDraft, ConfigLabelVM, SaveStatus, ToastVM } from '../app/viewModels';
import { pluralPl } from '../domain/scoring';
import type { Difficulty, DifficultyChoice, IsoDateTime, NValidation } from '../domain/types';

export { pluralPl };

/** „1 pytanie”, „3 pytania”, „20 pytań”. */
export function questionsCount(n: number): string {
  return `${n} ${pluralPl(n, 'pytanie', 'pytania', 'pytań')}`;
}

/**
 * Pojemność zakresu = liczba RODZIN (bliskich wariantów jednego zadania), nie liczba pytań (C01):
 * „1 różne zadanie (rodzina)”, „3 różne zadania (rodziny)”, „25 różnych zadań (rodzin)” (przykładowe liczby).
 * Test losuje najwyżej jedno pytanie z rodziny, więc to maksimum N.
 */
export function familiesCount(n: number): string {
  return `${n} ${pluralPl(n, 'różne zadanie', 'różne zadania', 'różnych zadań')} (${pluralPl(n, 'rodzina', 'rodziny', 'rodzin')})`;
}

/** Pojemność z liczbą pytań, gdy się różnią, np. „25 różnych zadań (rodzin) · 40 pytań” (liczby przykładowe). */
export function capacityLabel(families: number, questions: number): string {
  return families === questions ? familiesCount(families) : `${familiesCount(families)} · ${questionsCount(questions)}`;
}

/** Linia pod polem N (S04): pojemność jako maksimum N, obie liczby, gdy rodziny ≠ pytania. */
export function capacityHelp(families: number, questions: number): string {
  const lead =
    families === questions
      ? `Dostępne w tym zakresie: ${familiesCount(families)}.`
      : `Dostępne w tym zakresie: ${familiesCount(families)}, łącznie ${questionsCount(questions)} — test bierze najwyżej jedno pytanie z rodziny.`;
  return `${lead} Kolejność pytań zostanie wylosowana.`;
}

export const DIFFICULTY_LABELS: Readonly<Record<DifficultyChoice, string>> = {
  mixed: 'Mieszany',
  basic: 'Łatwy',
  intermediate: 'Średni',
  advanced: 'Trudny',
};

export function difficultyLabel(d: DifficultyChoice | Difficulty): string {
  return DIFFICULTY_LABELS[d];
}

/**
 * Etykieta konfiguracji: „Cały zakres · Mieszany”, opcjonalnie „· 20 pytań” i „· Moje błędy”.
 */
export function configLabel(c: ConfigLabelVM, opts: { withN?: boolean; withMyErrors?: boolean } = {}): string {
  const parts = [c.scopeTitle, difficultyLabel(c.difficulty)];
  if (opts.withN && c.targetN !== null) parts.push(questionsCount(c.targetN));
  if ((opts.withMyErrors ?? true) && c.myErrorsPriority) parts.push('Moje błędy');
  return parts.join(' · ');
}

const DATE_FMT = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Warsaw',
});
const SHORT_DATE_FMT = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Warsaw' });
const TIME_FMT = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

function parseIso(iso: IsoDateTime): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** „22.10.2026”. */
export function formatDate(iso: IsoDateTime): string {
  const d = parseIso(iso);
  return d ? DATE_FMT.format(d) : '';
}

/** „22.10”. */
export function formatShortDate(iso: IsoDateTime): string {
  const d = parseIso(iso);
  return d ? SHORT_DATE_FMT.format(d) : '';
}

/** „20.10.2026, 18:42”. */
export function formatDateTime(iso: IsoDateTime): string {
  const d = parseIso(iso);
  return d ? `${DATE_FMT.format(d)}, ${TIME_FMT.format(d)}` : '';
}

/** Procent z wykresu (już obcięty do 0,1 przez domenę) → „64,9%”. */
export function formatPercentValue(percent: number): string {
  const tenths = Math.round(percent * 10);
  const whole = Math.trunc(tenths / 10);
  const fraction = Math.abs(tenths % 10);
  return fraction === 0 ? `${whole}%` : `${whole},${fraction}%`;
}

/** Rozmiar pliku do opisu („48 KB”, „1,2 MB”). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/* -------------------------------------------------------------------------- */
/* Komunikaty statusu (StatusToast)                                            */
/* -------------------------------------------------------------------------- */

export function toastText(toast: ToastVM): string {
  switch (toast.kind) {
    case 'reported_replaced':
      return 'Pytanie wykluczone. Zastąpiliśmy je innym.';
    case 'reported_awaiting':
      return 'Pytanie wykluczone. W tym zakresie nie ma pytania zastępczego.';
    case 'reported_closed':
      return 'Pytanie wykluczone z przyszłej nauki. Wynik tego testu się nie zmienia.';
    case 'reported_excluded':
      return 'Pytanie wykluczone z przyszłej nauki.';
    case 'action_failed': {
      const msg = toast.params['messagePl'];
      return typeof msg === 'string' && msg ? msg : 'Nie udało się wykonać tej czynności. Spróbuj ponownie.';
    }
    case 'report_undone':
      return 'Zgłoszenie cofnięte. Przywrócono poprzedni stan pytania.';
    case 'block_restored':
      return 'Pytanie przywrócone do przyszłych losowań. Wcześniejsze wyniki pozostają bez zmian.';
    case 'block_restored_open_test':
      return 'Pytanie przywrócone do przyszłych losowań. Trwający test i wcześniejsze wyniki pozostają bez zmian.';
    case 'test_closed_unfinished':
      return 'Test zamknięty bez wyniku. W historii oznaczono go jako niedokończony.';
    case 'freeflow_saved':
      return 'Sesja Free Flow zapisana w historii.';
    case 'app_updated':
      return 'Aplikacja zaktualizowana. Przerwana sesja została zachowana.';
    case 'backup_saved': {
      // LOG-08: aplikacja wie tylko, że przekazała plik do pobrania — nie, że zapis się udał
      // (na iPhonie arkusz pobierania można anulować). Bez „Zapisano”.
      const name = toast.params['fileName'];
      return typeof name === 'string' && name
        ? `Przygotowano plik kopii ${name} — sprawdź, czy zapisał się w Plikach (Pobrane).`
        : 'Przygotowano plik kopii — sprawdź, czy zapisał się w Plikach (Pobrane).';
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Błąd zapisu (S24f)                                                          */
/* -------------------------------------------------------------------------- */

/** Treść komunikatu „niezapisane” — nigdy nie sugeruje udanego zapisu. */
export function saveErrorText(save: Extract<SaveStatus, { status: 'error' }>): string {
  if (save.failures >= 2) {
    return save.action === 'answer'
      ? 'Zapis nadal się nie powiódł. Odpowiedź pozostaje niezapisana. Spróbuj ponownie lub zapisz kopię danych w ustawieniach.'
      : 'Zapis nadal się nie powiódł. Zmiana pozostaje niezapisana. Spróbuj ponownie lub zapisz kopię danych w ustawieniach.';
  }
  const subject = save.action === 'answer' ? 'Odpowiedź nie została zapisana.' : 'Zmiana nie została zapisana.';
  if (save.code === 'QuotaExceeded') {
    return `${subject} Brakuje miejsca na urządzeniu albo przeglądarka odrzuciła zapis. Spróbuj ponownie lub zapisz kopię danych w ustawieniach.`;
  }
  const detail = save.messagePl.trim();
  return detail ? `${subject} ${detail}` : `${subject} Spróbuj ponownie lub zapisz kopię danych w ustawieniach.`;
}

/* -------------------------------------------------------------------------- */
/* Walidacja liczby pytań (S05) — tekst i działania naprawcze                  */
/* -------------------------------------------------------------------------- */

export interface ConfigFix {
  label: string;
  patch: Partial<ConfigDraft>;
}

export interface NValidationMessage {
  text: string;
  fixes: ConfigFix[];
}

/** Domyślna liczba do naprawy: 20 albo pojemność, jeśli mniejsza. */
function defaultFixN(capacity: number): number {
  return Math.min(20, capacity);
}

function widenFixes(draft: ConfigDraft): ConfigFix[] {
  const fixes: ConfigFix[] = [];
  if (draft.scope !== 'ALL') fixes.push({ label: 'Wybierz Cały zakres', patch: { scope: 'ALL' } });
  if (draft.difficulty !== 'mixed') fixes.push({ label: 'Poziom Mieszany', patch: { difficulty: 'mixed' } });
  return fixes;
}

/** Komunikat błędu pola N z działaniami naprawczymi (kody z domeny, tekst z Design). */
export function nValidationMessage(v: NValidation, draft: ConfigDraft): NValidationMessage | null {
  if (v.ok) return null;
  const cap = v.capacity;
  const setN = (n: number): ConfigFix[] => (n > 0 ? [{ label: `Ustaw ${n}`, patch: { nText: String(n) } }] : []);
  switch (v.code) {
    case 'EMPTY':
      return { text: 'Wpisz liczbę pytań.', fixes: setN(defaultFixN(cap)) };
    case 'TOO_SMALL':
      return { text: 'Liczba pytań musi być większa od zera.', fixes: setN(defaultFixN(cap)) };
    case 'NOT_INTEGER': {
      const lead = /^\s*(\d+)/.exec(draft.nText);
      const k = lead?.[1] ? Number.parseInt(lead[1], 10) : 0;
      const n = k > 0 ? Math.min(k, cap) : defaultFixN(cap);
      return { text: 'Wpisz liczbę całkowitą, np. 25.', fixes: setN(n) };
    }
    case 'EXCEEDS_CAPACITY':
      return {
        // C01: maksimum N = liczba rodzin, nazwana tak samo jak w opisie zakresu.
        text: `W tym zakresie dostępnych jest mniej różnych zadań (${cap}). Zmniejsz liczbę lub wybierz szerszy zakres.`,
        fixes: [...setN(cap), ...widenFixes(draft)],
      };
    case 'EMPTY_POOL':
      return {
        text: 'W tym zakresie nie ma dostępnych pytań. Wybierz inny poziom lub szerszy zakres.',
        fixes: widenFixes(draft),
      };
  }
}

/** Free Flow: pusta pula w konfiguracji. */
export function emptyPoolFixes(draft: ConfigDraft): ConfigFix[] {
  return widenFixes(draft);
}

/** Czy adres może zostać otwarty jako link źródła (tylko https). */
export function isSafeHttpsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * „Gdzie w źródle”: lokator banku bywa wspólny dla kilku źródeł („A30: …; A01: abstrakt.”).
 * Zwraca lokator dla danego źródła; gdy lokator nie jest podzielony na źródła — cały tekst.
 */
export function locatorForSource(locator: string, sourceId: string): string {
  const parts = locator.split(/;\s*/);
  const map = new Map<string, string>();
  let structured = false;
  for (const part of parts) {
    const m = /^([A-Z]+\d+(?:\/[A-Z]+\d+)*)\s*:?\s+(.*)$/.exec(part.trim());
    if (m?.[1] && m[2] !== undefined) {
      structured = true;
      const text = m[2].replace(/\.$/, '');
      for (const id of m[1].split('/')) map.set(id, text);
    }
  }
  if (!structured) return locator.trim();
  return map.get(sourceId) ?? '';
}

/* -------------------------------------------------------------------------- */
/* Błąd wczytania kopii (S22g)                                                 */
/* -------------------------------------------------------------------------- */

const UNCHANGED_SENTENCE = 'Dane na tym urządzeniu nie zostały zmienione.';

/**
 * Szczegół błędu kopii pod tytułem banera: bez powtórzenia tytułu („Nie można wczytać pliku „x”.”)
 * i bez zdania o niezmienionych danych (baner pokazuje je osobno). Pusty tekst → `null`.
 */
export function backupErrorDetail(messagePl: string, fileName: string | null): string | null {
  let text = messagePl.trim();
  const lead = fileName ? `Nie można wczytać pliku „${fileName}”.` : 'Nie można wczytać pliku.';
  if (text.startsWith(lead)) text = text.slice(lead.length).trim();
  if (text.endsWith(UNCHANGED_SENTENCE)) text = text.slice(0, -UNCHANGED_SENTENCE.length).trim();
  return text.length > 0 ? text : null;
}
