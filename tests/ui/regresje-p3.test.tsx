/**
 * Regresje UI zgłoszeń P3 niezależnej weryfikacji i stanu puli:
 * - UI-03: po wyborze odpowiedzi klawiaturą fokus trafia na nagłówek wyjaśnienia (nie na <body>);
 *   przy dotknięciu fokus nie jest przejmowany;
 * - UI-04: tekst pomocniczy Free Flow dosłownie z Design;
 * - F02: opis zawartości kopii zgodny z faktyczną zawartością pliku;
 * - LOG-08: po eksporcie „Przygotowano plik …”, bez „Zapisano”;
 * - LOG-05: błąd przy ważnym „Cofnij” w osobnym role=alert, „Cofnij” zostaje;
 * - stan puli: „O bazie” i ustawienia z liczbami z bank.counts, pool_note_pl, status_pl, zastrzeżeniem o wyniku.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ControllerProvider } from '../../src/app/ControllerContext';
import type { BackupVM, ToastVM } from '../../src/app/viewModels';
import { StatusToast } from '../../src/ui/components/QuestionChrome';
import { FREE_FLOW_HELP } from '../../src/ui/screens/ConfigScreen';
import { BACKUP_CONTENTS_TEXT, BackupScreen } from '../../src/ui/screens/DataScreens';
import { RESULT_DISCLAIMER } from '../../src/ui/screens/SettingsScreens';
import { bank, correctOptionId, renderApp, startedMock } from './helpers';

afterEach(cleanup);

function answerButtons(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Warianty odpowiedzi' })).queryAllByRole('button');
}

describe('UI-03 — fokus po odpowiedzi wybranej klawiaturą', () => {
  it('Enter na karcie (detail 0, fokus na przycisku) → fokus na nagłówku wyjaśnienia, nie na <body>', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await renderApp(c);
    const button = answerButtons()[0] as HTMLElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => {
      fireEvent.click(button, { detail: 0 });
    });
    const heading = screen.getByRole('heading', { name: 'Dlaczego ta odpowiedź jest poprawna' });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
    // Nagłówek nie wchodzi do kolejności Tab (tabIndex −1), a komunikat wyniku nadal idzie przez role=status.
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getAllByRole('status').some((el) => /Odpowiedź (poprawna|błędna)/.test(el.textContent ?? ''))).toBe(true);
  });

  it('dotknięcie (detail 1, przycisk bez fokusu) → fokus nie jest przejmowany', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await renderApp(c);
    (document.activeElement as HTMLElement | null)?.blur();
    const before = document.activeElement;
    const key = correctOptionId(c);
    const index = c.getState().screen?.name === 'question' ? (c.getState().screen as { answers: { optionId: string }[] }).answers.findIndex((a) => a.optionId === key) : 0;
    await act(async () => {
      fireEvent.click(answerButtons()[index] as HTMLElement, { detail: 1 });
    });
    expect(screen.getByRole('heading', { name: 'Dlaczego ta odpowiedź jest poprawna' })).toBeTruthy();
    expect(document.activeElement).toBe(before);
  });
});

describe('UI-04 — tekst pomocniczy Free Flow z Design', () => {
  it('konfiguracja Free Flow pokazuje brzmienie z DME-Aplikacja.dc.html (cfg.ffHelp)', async () => {
    expect(FREE_FLOW_HELP).toBe('Bez liczby pytań i limitu czasu. Kolejne pytania dobierane są z zakresu, z pierwszeństwem powtórek.');
    const c = await startedMock();
    c.openConfig('freeflow');
    await renderApp(c);
    expect(screen.getByText(FREE_FLOW_HELP)).toBeTruthy();
    expect(screen.queryByText(/Sesję kończysz sam\(a\)/)).toBeNull();
  });
});

describe('F02 / LOG-08 — ekran kopii danych', () => {
  async function renderBackup(vm: BackupVM) {
    const c = await startedMock();
    await act(async () => {
      render(
        <ControllerProvider controller={c}>
          <BackupScreen vm={vm} />
        </ControllerProvider>,
      );
    });
  }

  it('F02: opis zawartości mówi o treści pytań banku V15 z sesji, bez zaimportowanych pul (bez „Nie zawiera pytań”)', async () => {
    await renderBackup({ name: 'backup', flow: { step: 'idle', lastSavedFileName: null }, safetyBackups: [] });
    expect(screen.getByText(BACKUP_CONTENTS_TEXT)).toBeTruthy();
    expect(BACKUP_CONTENTS_TEXT).toContain('treść pytań banku V15 z Twoich sesji');
    expect(BACKUP_CONTENTS_TEXT).toContain('Nie zawiera wbudowanej puli pytań, zaimportowanych pul');
    expect(document.body.textContent).not.toContain('Nie zawiera pytań');
  });

  it('LOG-08: po eksporcie „Przygotowano plik kopii …” z prośbą o sprawdzenie Plików, bez „Zapisano”', async () => {
    await renderBackup({ name: 'backup', flow: { step: 'idle', lastSavedFileName: 'dme-kopia-2026-10-23.json' }, safetyBackups: [] });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Przygotowano plik kopii dme-kopia-2026-10-23.json.');
    expect(status.textContent).toContain('Pliki (folder Pobrane)');
    expect(document.body.textContent).not.toMatch(/Zapisano plik/);
  });
});

describe('LOG-05 — błąd obok toastu z „Cofnij”', () => {
  it('alertPl → osobny role=alert; toast role=status z „Cofnij” zostaje', () => {
    const toast: ToastVM = { id: 't1', kind: 'reported_replaced', canUndo: true, autoHideMs: null, params: {}, alertPl: 'Nie znaleziono wykluczonego pytania.' };
    let undone = 0;
    render(<StatusToast toast={toast} onUndo={() => (undone += 1)} />);
    expect(screen.getByRole('alert').textContent).toContain('Nie znaleziono wykluczonego pytania.');
    expect(screen.getByRole('status').textContent).toContain('Pytanie wykluczone. Zastąpiliśmy je innym.');
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(undone).toBe(1);
  });

  it('bez alertPl — tylko toast (bez role=alert)', () => {
    render(<StatusToast toast={{ id: 't2', kind: 'report_undone', canUndo: false, autoHideMs: 4500, params: {} }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Stan puli — „O bazie” i ustawienia', () => {
  it('ustawienia: liczby pytań i rodzin, przegląd AI, pool_note_pl, status_pl i zastrzeżenie o wyniku', async () => {
    const c = await startedMock({ appVersion: '0.1.0' });
    c.openSettings();
    await renderApp(c);
    const counts = bank.counts;
    expect(screen.getByText(`${counts.questions} pytań · ${counts.families} różnych zadań (rodzin) · wersja ${bank.bank_version}`)).toBeTruthy();
    const note = screen.getByRole('note', { name: 'Stan puli pytań' });
    expect(note.textContent).toContain(`${counts.independently_checked_draft} z ${counts.questions} pytań sprawdzono odrębnym przeglądem AI (to nie jest recenzja lekarska).`);
    expect(note.textContent).toContain((bank as unknown as { pool_note_pl: string }).pool_note_pl);
    expect(note.textContent).toContain(bank.status_pl);
    expect(note.textContent).toContain(RESULT_DISCLAIMER);
  });

  it('„O bazie”: pytania, rodziny, domeny, poziomy, przegląd AI, schematy, stan puli i status — z bank.counts', async () => {
    const c = await startedMock();
    c.openSettings();
    c.openAbout();
    await renderApp(c);
    const counts = bank.counts;
    const body = document.body.textContent ?? '';
    expect(body).toContain(`Wbudowana pula zawiera ${counts.questions} pytań jednokrotnego wyboru w 6 dziedzinach.`);
    expect(body).toContain(`w puli jest ${counts.families} różnych zadań (rodzin)`);
    const levels = screen.getByRole('list', { name: 'Liczba pytań według poziomu trudności' });
    expect(within(levels).getByText('Łatwy').nextSibling?.textContent).toBe(String(counts.by_difficulty.basic));
    expect(within(levels).getByText('Średni').nextSibling?.textContent).toBe(String(counts.by_difficulty.intermediate));
    expect(within(levels).getByText('Trudny').nextSibling?.textContent).toBe(String(counts.by_difficulty.advanced));
    const checks = screen.getByRole('list', { name: 'Kontrola treści' });
    expect(within(checks).getByText(/Sprawdzone odrębnym przeglądem AI/).nextSibling?.textContent).toBe(String(counts.independently_checked_draft));
    expect(within(checks).getByText('Pytania ze schematem').nextSibling?.textContent).toBe(String(counts.schematic));
    const poolNote = (bank as unknown as { pool_note_pl: string }).pool_note_pl;
    expect(screen.getByText(poolNote)).toBeTruthy();
    expect(poolNote).toMatch(/Bank zamknięty/);
    expect(screen.getByText(bank.status_pl)).toBeTruthy();
    expect(screen.getByText(RESULT_DISCLAIMER)).toBeTruthy();
    expect(body).toContain('Nie jest oficjalnym bankiem pytań PTMEiAA.');
  });
});
