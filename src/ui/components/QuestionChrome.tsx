/**
 * Elementy ramy ekranu pytania (PRZEKAZANIE §6):
 * - ProgressHeader — ✕ (przerwij) / ← (przegląd), środek „7/20” + pasek 4 px (Test) albo „Pytanie 27”
 *   (Free Flow), po prawej flaga 44 × 44 „Zgłoś błąd w pytaniu”. Bez procentu na żywo.
 * - BottomActionBar — w przepływie dokumentu; nad przyciskami StatusToast i błąd zapisu;
 *   [‹ poprzednie 52 × 52] + „Dalej” / „Pokaż wynik” albo podpowiedź przed odpowiedzią.
 * - StatusToast — ciemny, `role="status"`, opcjonalne „Cofnij”.
 */
import type { ReactNode } from 'react';
import type { ToastVM } from '../../app/viewModels';
import { toastText } from '../format';
import { Icon } from './Icon';

export interface ProgressHeaderProps {
  /** Lewy przycisk: zamknięcie (✕) albo powrót (←). */
  leading: { kind: 'close' | 'back'; label: string; onClick: () => void };
  /** Tekst środka („7/20”, „Pytanie 8”, „Pytanie 3 z 20”). */
  text: string;
  /** Pasek postępu Testu (ocenione ważne / N). */
  bar?: { value: number; max: number } | null;
  /** Flaga zgłoszenia — `null` = brak (zachowany odstęp). */
  onReport: (() => void) | null;
}

export function ProgressHeader({ leading, text, bar, onReport }: ProgressHeaderProps) {
  const pct = bar && bar.max > 0 ? Math.round((bar.value / bar.max) * 100) : 0;
  return (
    <header className="screen__header">
      <button type="button" className="icon-btn" aria-label={leading.label} onClick={leading.onClick}>
        <Icon name={leading.kind === 'close' ? 'close' : 'arrow_back'} size={24} />
      </button>
      <div className="progress-header__center">
        <span className="progress-header__text" aria-live="polite">
          {text}
        </span>
        {bar ? (
          <span
            className="progress-track progress-header__bar"
            role="progressbar"
            aria-label="Ocenione pytania"
            aria-valuemin={0}
            aria-valuemax={bar.max}
            aria-valuenow={bar.value}
            aria-valuetext={`${bar.value} z ${bar.max}`}
          >
            <span className="progress-track__fill" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
      </div>
      {onReport ? (
        <button type="button" className="icon-btn icon-btn--flag" aria-label="Zgłoś błąd w pytaniu" onClick={onReport}>
          <Icon name="outlined_flag" size={21} />
        </button>
      ) : (
        <span className="progress-header__spacer" aria-hidden="true" />
      )}
    </header>
  );
}

export interface StatusToastProps {
  toast: ToastVM;
  onUndo?: () => void;
  /** Ikona: w pytaniu „info”, poza nim „check_circle” (Design). */
  icon?: 'info' | 'check_circle';
}

export function StatusToast({ toast, onUndo, icon = 'info' }: StatusToastProps) {
  return (
    <>
      {toast.alertPl ? (
        // LOG-05: błąd innej akcji nie zabiera „Cofnij” — osobny komunikat role=alert nad toastem.
        <div className="banner banner--danger" role="alert">
          <div className="banner__row">
            <Icon name="error_outline" className="banner__icon" />
            <span className="banner__lead">{toast.alertPl}</span>
          </div>
        </div>
      ) : null}
      <div className="toast" role="status" aria-live="polite">
        <Icon name={icon} className="toast__icon" />
        <span className="toast__text">{toastText(toast)}</span>
        {toast.canUndo && onUndo ? (
          <button type="button" className="toast__action" onClick={onUndo}>
            Cofnij
          </button>
        ) : null}
      </div>
    </>
  );
}

export interface SaveErrorProps {
  text: string;
}

/** Błąd zapisu (S24f) — `role="alert"`, bez przejmowania fokusu. */
export function SaveErrorAlert({ text }: SaveErrorProps) {
  return (
    <div className="banner banner--danger" role="alert">
      <div className="banner__row">
        <Icon name="error_outline" className="banner__icon" />
        <span className="banner__lead">{text}</span>
      </div>
    </div>
  );
}

export interface BottomActionBarProps {
  /** StatusToast / błąd zapisu nad przyciskami. */
  status?: ReactNode;
  onPrevious?: (() => void) | null;
  /** Główna akcja; `null` + `hint` — podpowiedź zamiast przycisku. */
  primary?: { label: string; onClick: () => void; icon?: boolean; disabled?: boolean } | null;
  hint?: ReactNode;
}

export function BottomActionBar({ status, onPrevious, primary, hint }: BottomActionBarProps) {
  return (
    <>
      {/* Pusty region (bez toastu i błędu) jest ukryty przez `:empty`. */}
      <div className="action-status">{status}</div>
      <div className="action-row">
        {onPrevious ? (
          <button type="button" className="action-row__prev" aria-label="Poprzednie pytanie" onClick={onPrevious}>
            <Icon name="chevron_left" size={26} />
          </button>
        ) : null}
        {primary ? (
          <button type="button" className="btn btn--primary btn--lg action-row__main" onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
            {primary.icon !== false ? <Icon name="chevron_right" size={22} /> : null}
          </button>
        ) : (
          <div className="action-row__hint">{hint}</div>
        )}
      </div>
    </>
  );
}
