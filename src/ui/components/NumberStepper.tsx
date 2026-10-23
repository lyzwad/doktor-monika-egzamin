/**
 * NumberStepper (Design S04/S05): jedna kontrolka „−10 | pole liczby | +10” i skróty 20/30/40/50/60.
 * −10 nieaktywne, gdy wynik < 1; +10 i skróty nieaktywne powyżej pojemności zakresu.
 * Przyciski nigdy nie ustawiają wartości spoza 1…pojemność. Błąd przy polu z działaniami naprawczymi.
 * Walidację wpisanej wartości (kody S05) wykonuje domena — komponent tylko ją pokazuje.
 */
import { useId } from 'react';
import { pluralPl } from '../format';
import { Icon } from './Icon';
import { cx } from './Screen';

export const STEP = 10;
export const QUICK_VALUES: readonly number[] = [20, 30, 40, 50, 60];

/** Liczba całkowita z pola (tylko cyfry); inaczej `null`. */
export function parseWholeNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export interface StepperFix {
  label: string;
  onClick: () => void;
}

export interface NumberStepperProps {
  /** Tekst pola (może być niepoprawny — S05). */
  value: string;
  /** Pojemność puli (maksimum N). */
  capacity: number;
  onChange: (text: string) => void;
  /** Komunikat błędu (S05) albo `null`. */
  error: string | null;
  fixes?: StepperFix[];
  /** Dodatkowe blokady z modelu widoku (logiczne AND z granicami liczonymi lokalnie). */
  canDecrement?: boolean;
  canIncrement?: boolean;
  /** Skróty: wartości i dostępność z modelu widoku (domyślnie 20–60 względem pojemności). */
  quickValues?: { n: number; enabled: boolean }[];
}

export function NumberStepper({ value, capacity, onChange, error, fixes = [], canDecrement = true, canIncrement = true, quickValues }: NumberStepperProps) {
  const errorId = useId();
  const n = parseWholeNumber(value);
  const decTarget = n !== null ? n - STEP : null;
  const incTarget = (n ?? 0) + STEP;
  const decEnabled = canDecrement && decTarget !== null && decTarget >= 1 && decTarget <= capacity;
  const incEnabled = canIncrement && incTarget >= 1 && incTarget <= capacity;
  const chips = (quickValues ?? QUICK_VALUES.map((q) => ({ n: q, enabled: true }))).map((q) => ({
    n: q.n,
    enabled: q.enabled && q.n >= 1 && q.n <= capacity,
  }));
  const unit = n !== null && n > 0 ? pluralPl(n, 'pytanie', 'pytania', 'pytań') : 'pytań';

  return (
    <>
      <div role="group" aria-label="Liczba pytań" className={cx('stepper', error && 'stepper--invalid')}>
        <div className="stepper__row">
          <button
            type="button"
            className="stepper__step"
            aria-label="Zmniejsz o 10"
            disabled={!decEnabled}
            onClick={() => {
              if (decEnabled && decTarget !== null) onChange(String(decTarget));
            }}
          >
            −10
          </button>
          <label className="stepper__field">
            <input
              className="stepper__input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              maxLength={6}
              aria-label="Liczba pytań"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value.slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <span className="stepper__unit" aria-hidden="true">
              {unit}
            </span>
          </label>
          <button
            type="button"
            className="stepper__step"
            aria-label="Zwiększ o 10"
            disabled={!incEnabled}
            onClick={() => {
              if (incEnabled) onChange(String(incTarget));
            }}
          >
            +10
          </button>
        </div>
        <div role="group" aria-label="Szybki wybór" className="stepper__chips">
          {chips.map((c) => (
            <button
              key={c.n}
              type="button"
              className="chip"
              aria-pressed={!error && n === c.n}
              disabled={!c.enabled}
              onClick={() => {
                if (c.enabled) onChange(String(c.n));
              }}
            >
              {c.n}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="banner banner--danger" role="alert" id={errorId}>
          <div className="banner__row">
            <Icon name="error_outline" className="banner__icon" />
            <span className="banner__lead">{error}</span>
          </div>
          {fixes.length > 0 ? (
            <div className="btn-row">
              {fixes.map((f) => (
                <button key={f.label} type="button" className="btn btn--secondary btn--sm" onClick={f.onClick}>
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
