/**
 * App z mockiem kontrolera: start (S01/S02), konfiguracja i walidacja N (S04/S05), historia pusta
 * i z wykresem (S20), ustawienia i „O bazie” z liczbami z banku (S21), wykluczone (S23), kopia (S22),
 * fazy uruchomienia i przygotowanie (S24a).
 */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppController, AppState } from '../../src/app/controller';
import { AppRoot } from '../../src/ui/App';
import { render } from '@testing-library/react';
import { bank, correctOptionId, renderApp, startedMock } from './helpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Start (S01–S02)', () => {
  it('nazwa, dwa tryby, Historia i Ustawienia; wskazówka instalacji zamykana', async () => {
    const c = await startedMock();
    await renderApp(c);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Doktor Monika Egzamin');
    expect(screen.getByRole('button', { name: /Free Flow/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Test/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Historia' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ustawienia' })).toBeTruthy();
    expect(screen.queryByText('Kontynuuj')).toBeNull();
    const hint = screen.getByRole('region', { name: 'Wskazówka instalacji' });
    await act(async () => {
      fireEvent.click(within(hint).getByRole('button', { name: 'Zamknij wskazówkę' }));
    });
    expect(screen.queryByRole('region', { name: 'Wskazówka instalacji' })).toBeNull();
  });

  it('przerwany test: karta „Kontynuuj test” z postępem; ⋮ → „Zamknij test bez wyniku” z potwierdzeniem', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await c.answer(correctOptionId(c));
    c.pauseSession();
    await renderApp(c);
    const card = screen.getByRole('region', { name: 'Przerwana sesja' });
    expect(within(card).getByText('Kontynuuj test')).toBeTruthy();
    expect(within(card).getByText('1/20 pytań')).toBeTruthy();
    expect(within(card).getByText('Cały zakres · Mieszany')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Więcej opcji sesji' }));
    const sheet = screen.getByRole('dialog', { name: 'Test · 1/20' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij test bez wyniku' }));
    const alert = screen.getByRole('alertdialog', { name: 'Zamknąć test bez wyniku?' });
    expect(alert.textContent).toContain('Zapisane odpowiedzi (1) trafią do historii jako test niedokończony');
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Zamknij test' }));
    });
    expect(screen.queryByRole('region', { name: 'Przerwana sesja' })).toBeNull();
  });

  it('„Kontynuuj” otwiera to samo pytanie', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    const stem = (c.getState().screen as { stem: string }).stem;
    c.pauseSession();
    await renderApp(c);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    });
    expect(screen.getByText(stem)).toBeTruthy();
  });

  it('aktualizacja: baner z „Uruchom ponownie” tylko poza pytaniem', async () => {
    const c = await startedMock();
    c.simulate({ updateAvailable: true });
    await renderApp(c);
    expect(screen.getByText('Nowa wersja aplikacji jest gotowa.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Uruchom ponownie' }));
    });
    expect(screen.getByText('Aplikacja zaktualizowana. Przerwana sesja została zachowana.')).toBeTruthy();
  });
});

describe('Konfiguracja (S03–S05)', () => {
  it('Test: domyślnie 20, pojemność z banku, ±10, komunikaty S05 i działania naprawcze', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await renderApp(c);
    const capacity = new Set(bank.questions.map((q) => q.family_id)).size;
    const input = screen.getByRole('textbox', { name: 'Liczba pytań' }) as HTMLInputElement;
    expect(input.value).toBe('20');
    // C01: pojemność = różne zadania (rodziny), obok liczba pytań (ta sama co w „O bazie”).
    expect(
      screen.getByText(
        `Dostępne w tym zakresie: ${capacity} różnych zadań (rodzin), łącznie ${bank.questions.length} pytań — test bierze najwyżej jedno pytanie z rodziny. Kolejność pytań zostanie wylosowana.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cały zakres/ }).textContent).toContain(`${capacity} różnych zadań (rodzin) · ${bank.questions.length} pytań`);
    fireEvent.click(screen.getByRole('button', { name: 'Zwiększ o 10' }));
    expect(input.value).toBe('30');

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('Wpisz liczbę pytań.');
    expect((screen.getByRole('button', { name: 'Rozpocznij test' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toContain('Liczba pytań musi być większa od zera.');
    fireEvent.change(input, { target: { value: '12,5' } });
    expect(screen.getByRole('alert').textContent).toContain('Wpisz liczbę całkowitą, np. 25.');
    fireEvent.click(screen.getByRole('button', { name: 'Ustaw 12' }));
    expect(input.value).toBe('12');
    fireEvent.change(input, { target: { value: String(capacity + 1) } });
    expect(screen.getByRole('alert').textContent).toContain(`W tym zakresie dostępnych jest mniej różnych zadań (${capacity}).`);
    fireEvent.click(screen.getByRole('button', { name: `Ustaw ${capacity}` }));
    expect(input.value).toBe(String(capacity));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Zwiększ o 10' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('zakres w arkuszu (radio) i trudność (Segmented) zmieniają pojemność', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await renderApp(c);
    fireEvent.click(screen.getByRole('button', { name: /Cały zakres/ }));
    const sheet = screen.getByRole('dialog', { name: 'Zakres' });
    const anatomyCount = new Set(bank.questions.filter((q) => q.domain_id === 'ANAT').map((q) => q.family_id)).size;
    fireEvent.click(within(sheet).getByRole('radio', { name: new RegExp(`Anatomia.*${anatomyCount}`) }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Anatomia/ }).textContent).toContain(`${anatomyCount} różnych zadań (rodzin)`);
    fireEvent.click(screen.getByRole('radio', { name: 'Trudny' }));
    expect(screen.getByRole('radio', { name: 'Trudny' }).getAttribute('aria-checked')).toBe('true');
    const hard = new Set(bank.questions.filter((q) => q.domain_id === 'ANAT' && q.difficulty === 'advanced').map((q) => q.family_id)).size;
    if (hard < 20) {
      expect(screen.getByRole('alert').textContent).toContain(`W tym zakresie dostępnych jest mniej różnych zadań (${hard}).`);
      expect(screen.getByRole('button', { name: 'Wybierz Cały zakres' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Poziom Mieszany' })).toBeTruthy();
    }
  });

  it('„Moje błędy” bez błędów: komunikat i „Przejdź do zwykłego zakresu”', async () => {
    const c = await startedMock();
    c.openConfig('freeflow');
    await renderApp(c);
    expect(screen.queryByRole('textbox')).toBeNull();
    const sw = screen.getByRole('switch', { name: /Moje błędy/ });
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/W tym zakresie nie ma jeszcze zapisanych błędnych odpowiedzi/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Przejdź do zwykłego zakresu' }));
    expect(screen.getByRole('switch', { name: /Moje błędy/ }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('Historia (S20)', () => {
  it('pusta historia: komunikat, bez wykresu i bez „0%”', async () => {
    const c = await startedMock();
    c.openHistory('tests');
    await renderApp(c);
    expect(screen.getByText('Brak ukończonych testów')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Wykres wyników ukończonych testów' })).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Free Flow' }));
    expect(screen.getByText('Brak sesji Free Flow')).toBeTruthy();
  });

  it('ukończony test na wykresie (●), niedokończony tylko na liście; punkt → szczegóły', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    for (let i = 0; i < 20; i++) {
      await c.answer(correctOptionId(c));
      if (i < 19) await c.next();
    }
    await c.showResult();
    c.openConfig('test');
    await c.startTest();
    await c.closeUnfinished();
    c.openHistory('tests');
    await renderApp(c);
    const chart = screen.getByRole('region', { name: 'Wykres wyników ukończonych testów' });
    const points = within(chart).getAllByRole('button');
    expect(points).toHaveLength(1);
    expect(points[0]?.getAttribute('data-shape')).toBe('circle');
    const list = screen.getByRole('list', { name: 'Lista testów' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(list.textContent).toContain('Niedokończony');
    expect(list.textContent).toContain('20 z 20 · 100%');
    await act(async () => {
      fireEvent.click(points[0] as HTMLElement);
    });
    expect(screen.getByText(/100% · zaliczony/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Szczegóły' }));
    });
    expect(screen.getByRole('heading', { name: 'Wynik testu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wstecz' })).toBeTruthy();
  });
});

describe('Ustawienia (S21–S23)', () => {
  it('liczby z banku, status roboczy bazy, wersja aplikacji', async () => {
    const c = await startedMock({ appVersion: '0.1.0' });
    c.openSettings();
    await renderApp(c);
    expect(screen.getByText(`${bank.counts.questions} pytań · ${bank.counts.families} różnych zadań (rodzin) · wersja ${bank.bank_version}`)).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /O bazie pytań/ }));
    });
    expect(screen.getByText(bank.status_pl)).toBeTruthy();
    const table = screen.getByRole('list', { name: 'Liczba pytań w dziedzinach' });
    for (const d of bank.domains) {
      expect(within(table).getByText(d.title_pl).nextSibling?.textContent).toBe(String(bank.counts.by_domain[d.id]));
    }
    expect(screen.getByText(new RegExp(`zawiera ${bank.counts.questions} pytań`))).toBeTruthy();
    expect(screen.getByText(/Klucze odpowiedzi są robocze/)).toBeTruthy();
  });

  it('wykluczone: pusta lista, potem zgłoszone pytanie z „Przywróć”', async () => {
    const c = await startedMock();
    c.openExcluded();
    const { unmount } = await renderApp(c);
    expect(screen.getByText('Brak wykluczonych pytań')).toBeTruthy();
    unmount();
    c.openConfig('test');
    await c.startTest();
    const stem = (c.getState().screen as { stem: string }).stem;
    await c.report();
    c.pauseSession();
    c.openExcluded();
    await renderApp(c);
    expect(screen.getByText(stem)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Przywróć' }));
    });
    expect(screen.getByText('Brak wykluczonych pytań')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Pytanie przywrócone do przyszłych losowań');
  });

  it('kopia: błędny plik → komunikat i „Wybierz inny plik”, dane bez zmian', async () => {
    const c = await startedMock();
    c.openBackup();
    await renderApp(c);
    await act(async () => {
      await c.selectBackupFile(new Blob(['{nie json'], { type: 'application/json' }), 'dme-kopia-uszkodzona.json');
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nie można wczytać pliku „dme-kopia-uszkodzona.json”.');
    expect(alert.textContent).toContain('Dane na tym urządzeniu nie zostały zmienione.');
    expect(within(alert).getByRole('button', { name: /Wybierz inny plik/ })).toBeTruthy();
  });
});

describe('Fazy uruchomienia', () => {
  it('ładowanie, błąd krytyczny z ponowieniem i przygotowanie materiałów z rzeczywistym postępem', async () => {
    const base = await startedMock();
    let state: AppState = { ...base.getState(), boot: { phase: 'loading', stage: 'loading-bank' }, screen: null };
    const listeners = new Set<() => void>();
    const retryBoot = vi.fn(async () => undefined);
    const retryPreparation = vi.fn(async () => ({ ok: true as const }));
    const controller: AppController = {
      ...base,
      getState: () => state,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      retryBoot,
      retryPreparation,
    };
    const set = (next: AppState) => {
      state = next;
      for (const l of listeners) l();
    };
    render(<AppRoot controller={controller} />);
    expect(screen.getByRole('status').textContent).toBe('Wczytywanie pytań…');
    act(() => set({ ...state, boot: { phase: 'fatal', code: 'STORAGE_UNAVAILABLE', messagePl: 'Przeglądarka nie pozwala zapisać danych.', canRetry: true } }));
    expect(screen.getByRole('alert').textContent).toContain('Przeglądarka nie pozwala zapisać danych.');
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(retryBoot).toHaveBeenCalledTimes(1);
    act(() => set({ ...base.getState(), preparation: { status: 'running', done: 31, total: 50 } }));
    expect(screen.getByText('Przygotowanie materiałów do nauki')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
    act(() => set({ ...base.getState(), preparation: { status: 'failed', done: 31, total: 50 } }));
    expect(screen.getByRole('alert').textContent).toContain('Połączenie zostało przerwane przy 62%.');
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(retryPreparation).toHaveBeenCalledTimes(1);
  });

  it('toast bez akcji znika po czasie z VM (4,5 s)', async () => {
    vi.useFakeTimers();
    const c = await startedMock();
    c.openConfig('freeflow');
    await c.startFreeFlow();
    await c.endFreeFlow();
    render(<AppRoot controller={c} />);
    expect(screen.getByText('Sesja Free Flow zapisana w historii.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4600);
    });
    expect(screen.queryByText('Sesja Free Flow zapisana w historii.')).toBeNull();
  });
});
