/**
 * HistoryChart (PRZEKAZANIE §8; S20): wyniki WYŁĄCZNIE ukończonych testów, oś 0–100%, przerywana
 * linia progu 65%, testy jako ● i powtórki jako ◆ (kształt + legenda, nie sam kolor), wybrany punkt.
 * Testy z filtrem „Moje błędy” (F05, SPECYFIKACJA §7 — nie łączyć bez rozróżnienia z niezależnymi
 * testami) mają znacznik pusty w środku (obrys; ○ / ◇), pozycję legendy i dopisek w etykiecie.
 * Pusta lista punktów → brak wykresu (żadnego udawanego 0%).
 *
 * Linie rysuje SVG (viewBox 0–100, bez zniekształcenia grubości), znaczniki są przyciskami 44 × 44
 * z etykietą dostępności (data, rodzaj, procent, wynik).
 */
import type { ReactNode } from 'react';
import type { ChartPoint } from '../../domain/types';
import { formatPercentValue, formatShortDate, formatDate } from '../format';
import { PASS_PERCENT } from '../../domain/policies';

export interface HistoryChartProps {
  points: ChartPoint[];
  selectedId: string | null;
  onSelect: (sessionId: string | null) => void;
  /** Szczegóły wybranego punktu (pod legendą). */
  footer?: ReactNode;
}

/** Pozycja X (procent szerokości) dla i-tego z k punktów — margines 6% po bokach. */
export function chartX(i: number, k: number): number {
  return k <= 1 ? 50 : 6 + (i * 88) / (k - 1);
}

/** Pozycja Y (procent wysokości, 0 = góra) dla wyniku w procentach. */
export function chartY(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  return 100 - p;
}

export function pointLabel(p: ChartPoint): string {
  const kind = p.isRetry ? `powtórka${p.roundIndex ? `, runda ${p.roundIndex}` : ''}` : 'test';
  const filter = p.myErrorsPriority ? ' z filtrem Moje błędy' : '';
  return `${formatDate(p.at)}, ${kind}${filter}: ${formatPercentValue(p.percent)}, ${p.passed ? 'zaliczony' : 'próg nieosiągnięty'}`;
}

export function HistoryChart({ points, selectedId, onSelect, footer }: HistoryChartProps) {
  if (points.length === 0) return null;
  const k = points.length;
  const coords = points.map((p, i) => ({ p, x: chartX(i, k), y: chartY(p.percent) }));
  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const thresholdY = chartY(PASS_PERCENT);
  const anyMyErrors = points.some((p) => p.myErrorsPriority);
  return (
    <section className="card chart" aria-label="Wykres wyników ukończonych testów">
      <h2 className="chart__title">Wynik ukończonych testów</h2>
      <div className="chart__plot">
        <svg className="chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line x1="0" y1="0" x2="100" y2="0" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="100" x2="100" y2="100" stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line
            data-testid="chart-threshold"
            x1="0"
            y1={thresholdY}
            x2="100"
            y2={thresholdY}
            stroke="var(--warn)"
            strokeWidth="2"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          {k > 1 ? (
            <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ) : null}
        </svg>
        <span className="chart__axis-label" style={{ top: '0%' }} aria-hidden="true">
          100%
        </span>
        <span className="chart__axis-label chart__axis-label--threshold" style={{ top: `${thresholdY}%` }} aria-hidden="true">
          {PASS_PERCENT}%
        </span>
        <span className="chart__axis-label" style={{ top: '100%' }} aria-hidden="true">
          0%
        </span>
        {coords.map(({ p, x, y }) => {
          const selected = p.sessionId === selectedId;
          return (
            <button
              key={p.sessionId}
              type="button"
              className="chart__point"
              data-shape={p.isRetry ? 'diamond' : 'circle'}
              data-my-errors={p.myErrorsPriority ? 'true' : undefined}
              aria-label={pointLabel(p)}
              aria-pressed={selected}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => onSelect(selected ? null : p.sessionId)}
            >
              <span
                className={`chart__marker chart__marker--${p.isRetry ? 'diamond' : 'circle'}${p.myErrorsPriority ? ' chart__marker--hollow' : ''}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {k <= 8 ? (
        <div className="chart__dates" aria-hidden="true">
          {coords.map(({ p, x }) => (
            <span key={p.sessionId} className="chart__date" style={{ left: `${x}%` }}>
              {formatShortDate(p.at)}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="chart__legend" role="list" aria-label="Legenda">
        <li>
          <span className="legend-circle" aria-hidden="true" />
          Test
        </li>
        <li>
          <span className="legend-diamond" aria-hidden="true" />
          Powtórka
        </li>
        {anyMyErrors ? (
          <li>
            <span className="legend-hollow" aria-hidden="true" />
            Moje błędy
          </li>
        ) : null}
        <li>
          <span className="legend-threshold" aria-hidden="true" />
          Próg {PASS_PERCENT}%
        </li>
      </ul>
      {footer}
    </section>
  );
}
