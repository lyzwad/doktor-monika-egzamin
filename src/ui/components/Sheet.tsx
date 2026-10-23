/**
 * Sheet (arkusz od dołu) i AlertDialog (potwierdzenie) — PRZEKAZANIE §6, §13:
 * scrim zamyka, uchwyt, `role="dialog"`/`"alertdialog"`, `aria-modal`, pułapka fokusu
 * i powrót fokusu do wywołującego przycisku, Escape zamyka.
 */
import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../hooks';

export interface SheetProps {
  title: ReactNode;
  /** Etykieta dialogu, gdy tytuł nie jest prostym tekstem. */
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
  /** Opis pod tytułem (np. konfiguracja sesji). */
  meta?: ReactNode;
}

export function Sheet({ title, ariaLabel, onClose, children, meta }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, { onEscape: onClose });
  return (
    <div className="overlay">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <span className="sheet__handle" aria-hidden="true" />
        <div>
          <h2 className="sheet__title" id={titleId}>
            {title}
          </h2>
          {meta ? <div className="sheet__meta">{meta}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export interface AlertDialogProps {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}

export function AlertDialog({ title, children, actions, onClose }: AlertDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, { onEscape: onClose });
  return (
    <div className="overlay overlay--center">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={ref} className="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1}>
        <h2 className="alert-dialog__title" id={titleId}>
          {title}
        </h2>
        <div id={descId} className="sheet__text">
          {children}
        </div>
        <div className="alert-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  count?: string;
}

/** Lista wyboru w arkuszu (zakres, filtr konfiguracji historii). */
export function RadioList<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: RadioOption<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="radio-list">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="radio-row" onClick={() => onSelect(o.value)}>
          <span className="radio-row__dot" aria-hidden="true" />
          {/* Przy dużym tekście liczba przechodzi pod etykietę zamiast łamać słowa etykiety. */}
          <span className="radio-row__body">
            <span className="radio-row__label">{o.label}</span>
            {o.count ? <span className="radio-row__count">{o.count}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
