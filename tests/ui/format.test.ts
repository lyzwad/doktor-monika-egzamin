/**
 * Teksty interfejsu (Design): liczebniki, etykiety konfiguracji, komunikaty S05, toasty, błąd zapisu.
 */
import { describe, expect, it } from 'vitest';
import type { ConfigDraft, ToastKind } from '../../src/app/viewModels';
import {
  backupErrorDetail,
  capacityHelp,
  capacityLabel,
  configLabel,
  familiesCount,
  formatDate,
  formatPercentValue,
  isSafeHttpsUrl,
  nValidationMessage,
  questionsCount,
  saveErrorText,
  toastText,
} from '../../src/ui/format';

const draft: ConfigDraft = { scope: 'ANAT', difficulty: 'advanced', nText: '20', myErrorsPriority: false };

describe('format', () => {
  it('liczebniki pytań', () => {
    expect(questionsCount(1)).toBe('1 pytanie');
    expect(questionsCount(3)).toBe('3 pytania');
    expect(questionsCount(12)).toBe('12 pytań');
    expect(questionsCount(22)).toBe('22 pytania');
    expect(questionsCount(248)).toBe('248 pytań');
  });

  it('C01: pojemność nazywana „różnymi zadaniami (rodzinami)”, z liczbą pytań, gdy się różni', () => {
    expect(familiesCount(1)).toBe('1 różne zadanie (rodzina)');
    expect(familiesCount(3)).toBe('3 różne zadania (rodziny)');
    expect(familiesCount(717)).toBe('717 różnych zadań (rodzin)');
    expect(capacityLabel(717, 1099)).toBe('717 różnych zadań (rodzin) · 1099 pytań');
    expect(capacityLabel(37, 37)).toBe('37 różnych zadań (rodzin)');
    expect(capacityHelp(717, 1099)).toBe(
      'Dostępne w tym zakresie: 717 różnych zadań (rodzin), łącznie 1099 pytań — test bierze najwyżej jedno pytanie z rodziny. Kolejność pytań zostanie wylosowana.',
    );
    expect(capacityHelp(22, 22)).toBe('Dostępne w tym zakresie: 22 różne zadania (rodziny). Kolejność pytań zostanie wylosowana.');
    // Pojemność nigdy nie jest podpisana jako „N pytań”.
    expect(capacityLabel(717, 1099)).not.toMatch(/^717 pytań/);
  });

  it('etykieta konfiguracji', () => {
    const c = { scope: 'ALL' as const, scopeTitle: 'Cały zakres', difficulty: 'mixed' as const, targetN: 20, myErrorsPriority: true };
    expect(configLabel(c)).toBe('Cały zakres · Mieszany · Moje błędy');
    expect(configLabel(c, { withN: true })).toBe('Cały zakres · Mieszany · 20 pytań · Moje błędy');
    expect(configLabel({ ...c, myErrorsPriority: false, difficulty: 'basic' })).toBe('Cały zakres · Łatwy');
  });

  it('komunikaty S05 z działaniami naprawczymi', () => {
    expect(nValidationMessage({ ok: true, n: 20 }, draft)).toBeNull();
    expect(nValidationMessage({ ok: false, code: 'EMPTY', capacity: 246 }, draft)).toEqual({
      text: 'Wpisz liczbę pytań.',
      fixes: [{ label: 'Ustaw 20', patch: { nText: '20' } }],
    });
    expect(nValidationMessage({ ok: false, code: 'TOO_SMALL', capacity: 8 }, draft)?.fixes).toEqual([{ label: 'Ustaw 8', patch: { nText: '8' } }]);
    expect(nValidationMessage({ ok: false, code: 'NOT_INTEGER', capacity: 246 }, { ...draft, nText: '12,5' })?.fixes[0]?.label).toBe('Ustaw 12');
    const exceeds = nValidationMessage({ ok: false, code: 'EXCEEDS_CAPACITY', capacity: 7 }, draft);
    expect(exceeds?.text).toBe('W tym zakresie dostępnych jest mniej różnych zadań (7). Zmniejsz liczbę lub wybierz szerszy zakres.');
    expect(exceeds?.fixes.map((f) => f.label)).toEqual(['Ustaw 7', 'Wybierz Cały zakres', 'Poziom Mieszany']);
    expect(nValidationMessage({ ok: false, code: 'EMPTY_POOL', capacity: 0 }, draft)?.fixes.map((f) => f.label)).toEqual(['Wybierz Cały zakres', 'Poziom Mieszany']);
  });

  it('każdy rodzaj toastu ma tekst PL', () => {
    const kinds: ToastKind[] = [
      'reported_replaced',
      'reported_awaiting',
      'reported_closed',
      'report_undone',
      'block_restored',
      'block_restored_open_test',
      'test_closed_unfinished',
      'freeflow_saved',
      'app_updated',
      'backup_saved',
      'reported_excluded',
      'action_failed',
    ];
    for (const kind of kinds) {
      expect(toastText({ id: 't', kind, canUndo: false, autoHideMs: 4500, params: { fileName: 'dme-kopia.json' } }).length).toBeGreaterThan(10);
    }
    // LOG-08: bez „Zapisano” — aplikacja zna tylko wywołanie pobierania.
    expect(toastText({ id: 't', kind: 'backup_saved', canUndo: false, autoHideMs: 4500, params: { fileName: 'dme-kopia.json' } })).toBe(
      'Przygotowano plik kopii dme-kopia.json — sprawdź, czy zapisał się w Plikach (Pobrane).',
    );
    expect(toastText({ id: 't', kind: 'backup_saved', canUndo: false, autoHideMs: 4500, params: {} })).not.toMatch(/Zapisano/);
    expect(toastText({ id: 't', kind: 'action_failed', canUndo: false, autoHideMs: 4500, params: { messagePl: 'Za mało pytań.' } })).toBe('Za mało pytań.');
  });

  it('błąd kopii: szczegół bez powtórzenia tytułu i zdania o niezmienionych danych (regresja e2e F)', () => {
    const msg =
      'Nie można wczytać pliku „uszkodzona.json”. Plik jest uszkodzony albo nie jest kopią tej aplikacji. Dane na tym urządzeniu nie zostały zmienione.';
    expect(backupErrorDetail(msg, 'uszkodzona.json')).toBe('Plik jest uszkodzony albo nie jest kopią tej aplikacji.');
    expect(backupErrorDetail('Nie można wczytać pliku „a.json”. Dane na tym urządzeniu nie zostały zmienione.', 'a.json')).toBeNull();
    expect(backupErrorDetail('Plik „x.json” ma 30 MB — więcej niż limit 25 MB dla kopii. Dane na tym urządzeniu nie zostały zmienione.', 'x.json')).toBe(
      'Plik „x.json” ma 30 MB — więcej niż limit 25 MB dla kopii.',
    );
  });

  it('błąd zapisu nigdy nie sugeruje sukcesu', () => {
    const first = saveErrorText({ status: 'error', commandId: 'c', action: 'answer', code: 'QuotaExceeded', messagePl: 'x', failures: 1 });
    expect(first).toContain('Odpowiedź nie została zapisana.');
    const again = saveErrorText({ status: 'error', commandId: 'c', action: 'answer', code: 'WriteFailed', messagePl: 'x', failures: 2 });
    expect(again).toContain('Zapis nadal się nie powiódł');
    expect(saveErrorText({ status: 'error', commandId: 'c', action: 'report', code: 'WriteFailed', messagePl: 'Przerwana transakcja.', failures: 1 })).toBe(
      'Zmiana nie została zapisana. Przerwana transakcja.',
    );
  });

  it('procent, data, adres https', () => {
    expect(formatPercentValue(65)).toBe('65%');
    expect(formatPercentValue(64.9)).toBe('64,9%');
    expect(formatPercentValue(100)).toBe('100%');
    expect(formatDate('2026-10-21T23:30:00.000Z')).toBe('22.10.2026');
    expect(isSafeHttpsUrl('https://pubmed.ncbi.nlm.nih.gov/1/')).toBe(true);
    expect(isSafeHttpsUrl('http://example.org')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpsUrl(null)).toBe(false);
  });
});
