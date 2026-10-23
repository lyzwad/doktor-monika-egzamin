/**
 * Regresje UI zgłoszeń weryfikatorów:
 * - E03 / LOG-03: ostatnia pozycja z oczekującym zastępstwem ma przycisk „Przejdź do pytania k”
 *   i baner z wyjaśnieniem; karta „Kontynuuj” podaje liczbę oczekujących z odmianą;
 * - F03: lista automatycznych kopii bezpieczeństwa z „Pobierz” i „Przywróć”;
 * - F05: test z filtrem „Moje błędy” odróżniony na wykresie (znacznik, legenda, etykieta).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerProvider } from '../../src/app/ControllerContext';
import type { BackupVM, QuestionVM } from '../../src/app/viewModels';
import type { ChartPoint } from '../../src/domain/types';
import { HistoryChart, pointLabel } from '../../src/ui/components/HistoryChart';
import { BackupScreen } from '../../src/ui/screens/DataScreens';
import { awaitingText } from '../../src/ui/screens/HomeScreen';
import { QuestionScreen } from '../../src/ui/screens/QuestionScreen';
import { correctOptionId, questionVM, startedMock } from './helpers';

afterEach(cleanup);

describe('E03 — ostatnia pozycja, gdy wcześniejsza czeka na zastępstwo', () => {
  async function lastAnsweredVM() {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await c.answer(correctOptionId(c));
    const vm: QuestionVM = { ...questionVM(c), primaryAction: 'go-awaiting', awaitingElsewhere: { position: 0, count: 1 } };
    return { c, vm };
  }

  it('przycisk „Przejdź do pytania 1” wywołuje „Dalej”; baner wyjaśnia brak wyniku i pozwala zamknąć test', async () => {
    const { c, vm } = await lastAnsweredVM();
    const next = vi.spyOn(c, 'next').mockResolvedValue({ ok: true });
    await act(async () => {
      render(
        <ControllerProvider controller={c}>
          <QuestionScreen vm={vm} />
        </ControllerProvider>,
      );
    });
    expect(screen.getByText('Wynik jeszcze niedostępny')).toBeTruthy();
    expect(screen.getByText(/Pytanie 1 zostało wykluczone i czeka na pytanie zastępcze/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pokaż wynik' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Przejdź do pytania 1/ }));
    expect(next).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij test jako niedokończony' }));
    expect(screen.getByRole('alertdialog', { name: 'Zamknąć test bez wyniku?' })).toBeTruthy();
  });

  it('kilka oczekujących pozycji — liczba z odmianą w banerze', async () => {
    const { c, vm } = await lastAnsweredVM();
    await act(async () => {
      render(
        <ControllerProvider controller={c}>
          <QuestionScreen vm={{ ...vm, awaitingElsewhere: { position: 2, count: 3 } }} />
        </ControllerProvider>,
      );
    });
    expect(screen.getByText(/3 pytania czekają na pytania zastępcze \(pierwsze: pytanie 3\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Przejdź do pytania 3/ })).toBeTruthy();
  });

  it('karta „Kontynuuj”: liczba oczekujących zamiast stałego „Jedno pytanie”', () => {
    expect(awaitingText(1)).toBe('Jedno pytanie czeka na zastępstwo.');
    expect(awaitingText(2)).toBe('2 pytania czekają na zastępstwo.');
    expect(awaitingText(5)).toBe('5 pytań czeka na zastępstwo.');
    expect(awaitingText(22)).toBe('22 pytania czekają na zastępstwo.');
  });
});

describe('F03 — automatyczne kopie bezpieczeństwa na ekranie „Kopia danych”', () => {
  const safety = [
    { id: 'b2', createdAt: '2026-10-22T10:30:00.000Z', fileName: 'dme-przed-wczytaniem-2026-10-22.json', sizeBytes: 2048 },
    { id: 'b1', createdAt: '2026-10-21T08:00:00.000Z', fileName: 'dme-przed-wczytaniem-2026-10-21.json', sizeBytes: 512 },
  ];

  async function renderBackup(vm: BackupVM) {
    const c = await startedMock();
    const download = vi.spyOn(c, 'downloadSafetyBackup').mockResolvedValue({ ok: true });
    const restore = vi.spyOn(c, 'restoreSafetyBackup').mockResolvedValue({ ok: true });
    await act(async () => {
      render(
        <ControllerProvider controller={c}>
          <BackupScreen vm={vm} />
        </ControllerProvider>,
      );
    });
    return { download, restore };
  }

  it('lista z „Pobierz” i „Przywróć” dla każdej kopii (także bez banera sukcesu)', async () => {
    const { download, restore } = await renderBackup({ name: 'backup', flow: { step: 'idle', lastSavedFileName: null }, safetyBackups: safety });
    const list = screen.getByRole('list', { name: 'Automatyczne kopie bezpieczeństwa' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('dme-przed-wczytaniem-2026-10-22.json');
    expect(list.textContent).toContain('2 KB');
    const downloads = screen.getAllByRole('button', { name: /^Pobierz kopię sprzed wczytania/ });
    const restores = screen.getAllByRole('button', { name: /^Przywróć kopię sprzed wczytania/ });
    fireEvent.click(downloads[1] as HTMLElement);
    expect(download).toHaveBeenCalledWith('b1');
    fireEvent.click(restores[0] as HTMLElement);
    expect(restore).toHaveBeenCalledWith('b2');
  });

  it('brak kopii albo przepływ w toku — bez listy', async () => {
    await renderBackup({ name: 'backup', flow: { step: 'idle', lastSavedFileName: null }, safetyBackups: [] });
    expect(screen.queryByRole('list', { name: 'Automatyczne kopie bezpieczeństwa' })).toBeNull();
    cleanup();
    await renderBackup({ name: 'backup', flow: { step: 'checking', fileName: 'x.json' }, safetyBackups: safety });
    expect(screen.queryByRole('list', { name: 'Automatyczne kopie bezpieczeństwa' })).toBeNull();
  });
});

describe('F05 — testy z filtrem „Moje błędy” odróżnione na wykresie', () => {
  function point(over: Partial<ChartPoint>): ChartPoint {
    return {
      sessionId: 's1',
      at: '2026-10-20T10:00:00.000Z',
      percent: 70,
      passed: true,
      isRetry: false,
      roundIndex: null,
      myErrorsPriority: false,
      configKey: 'ALL|mixed|20|-',
      ...over,
    };
  }

  it('znacznik pusty w środku, pozycja legendy i dopisek w etykiecie dostępności', () => {
    const points = [point({ sessionId: 'a' }), point({ sessionId: 'b', at: '2026-10-21T10:00:00.000Z', myErrorsPriority: true }), point({ sessionId: 'c', at: '2026-10-22T10:00:00.000Z', myErrorsPriority: true, isRetry: true, roundIndex: 2 })];
    render(<HistoryChart points={points} selectedId={null} onSelect={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.getAttribute('data-my-errors')).toBeNull();
    expect(buttons[0]?.querySelector('.chart__marker--hollow')).toBeNull();
    expect(buttons[1]?.getAttribute('data-my-errors')).toBe('true');
    expect(buttons[1]?.querySelector('.chart__marker--circle.chart__marker--hollow')).not.toBeNull();
    expect(buttons[2]?.querySelector('.chart__marker--diamond.chart__marker--hollow')).not.toBeNull();
    expect(buttons[1]?.getAttribute('aria-label')).toBe('21.10.2026, test z filtrem Moje błędy: 70%, zaliczony');
    expect(buttons[2]?.getAttribute('aria-label')).toBe('22.10.2026, powtórka, runda 2 z filtrem Moje błędy: 70%, zaliczony');
    const legend = screen.getByRole('list', { name: 'Legenda' });
    expect(legend.textContent).toContain('Moje błędy');
    expect(legend.querySelector('.legend-hollow')).not.toBeNull();
  });

  it('bez testów z filtrem — legenda bez pozycji „Moje błędy”, etykieta bez dopisku', () => {
    render(<HistoryChart points={[point({})]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole('list', { name: 'Legenda' }).textContent).not.toContain('Moje błędy');
    expect(pointLabel(point({}))).toBe('20.10.2026, test: 70%, zaliczony');
  });
});
