/**
 * HistoryChart (S20, kryterium F05): pusta historia bez wykresu-zera, ● testy i ◆ powtórki
 * (kształt + legenda + etykieta), linia progu 65%, wybór punktu.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartPoint } from '../../src/domain/types';
import { HistoryChart, chartX, chartY, pointLabel } from '../../src/ui/components/HistoryChart';

afterEach(cleanup);

function point(over: Partial<ChartPoint>): ChartPoint {
  return {
    sessionId: 's1',
    at: '2026-10-20T10:00:00.000Z',
    percent: 65,
    passed: true,
    isRetry: false,
    roundIndex: null,
    myErrorsPriority: false,
    configKey: 'ALL|mixed|20|-',
    ...over,
  };
}

describe('HistoryChart', () => {
  it('pusta historia: brak wykresu, osi i „0%”', () => {
    const { container } = render(<HistoryChart points={[]} selectedId={null} onSelect={() => undefined} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('test jako ●, powtórka jako ◆; legenda „Test”, „Powtórka”, „Próg 65%”', () => {
    const points = [
      point({ sessionId: 'a', percent: 55, passed: false }),
      point({ sessionId: 'b', at: '2026-10-21T10:00:00.000Z', percent: 75, isRetry: true, roundIndex: 2 }),
    ];
    const { container } = render(<HistoryChart points={points} selectedId={null} onSelect={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('data-shape')).toBe('circle');
    expect(buttons[1]?.getAttribute('data-shape')).toBe('diamond');
    expect(buttons[1]?.querySelector('.chart__marker--diamond')).not.toBeNull();
    expect(buttons[0]?.querySelector('.chart__marker--circle')).not.toBeNull();
    expect(buttons[1]?.getAttribute('aria-label')).toBe('21.10.2026, powtórka, runda 2: 75%, zaliczony');
    expect(buttons[0]?.getAttribute('aria-label')).toBe('20.10.2026, test: 55%, próg nieosiągnięty');
    const legend = screen.getByRole('list', { name: 'Legenda' });
    expect(legend.textContent).toContain('Test');
    expect(legend.textContent).toContain('Powtórka');
    expect(legend.textContent).toContain('Próg 65%');
    expect(legend.querySelector('.legend-diamond')).not.toBeNull();
    // Linia progu na 65% (y = 35 w układzie 0–100 od góry), polilinia przez punkty.
    expect(container.querySelector('[data-testid="chart-threshold"]')?.getAttribute('y1')).toBe('35');
    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('6.00,45.00 94.00,25.00');
    // Oś 0–100% z etykietami.
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('pojedynczy punkt na środku, bez polilinii', () => {
    const { container } = render(<HistoryChart points={[point({})]} selectedId={null} onSelect={() => undefined} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect((screen.getByRole('button') as HTMLElement).style.left).toBe('50%');
  });

  it('wybór punktu: aria-pressed, ponowne dotknięcie odznacza', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<HistoryChart points={[point({ sessionId: 'x' })]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenLastCalledWith('x');
    rerender(<HistoryChart points={[point({ sessionId: 'x' })]} selectedId="x" onSelect={onSelect} footer={<p>Szczegóły punktu</p>} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Szczegóły punktu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('współrzędne: 0–100% przycięte, równe odstępy', () => {
    expect(chartY(0)).toBe(100);
    expect(chartY(100)).toBe(0);
    expect(chartY(130)).toBe(0);
    expect(chartY(-5)).toBe(100);
    expect(chartX(0, 3)).toBe(6);
    expect(chartX(2, 3)).toBe(94);
    expect(chartX(0, 1)).toBe(50);
    expect(pointLabel(point({ percent: 64.9, passed: false }))).toContain('64,9%');
  });
});
