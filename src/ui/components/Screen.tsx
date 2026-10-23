/**
 * Układ ekranu (Design): stały nagłówek 56 px z „Wstecz”, przewijana kolumna treści (maks. 560 px,
 * margines 16/20 px) i opcjonalny dolny pasek w przepływie dokumentu (nie nachodzi na treść).
 */
import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { Icon } from './Icon';
import type { IconName } from '../icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface ScreenProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Kontener przewijania (np. łagodne przewinięcie do wyjaśnienia). */
  scrollRef?: Ref<HTMLDivElement>;
  contentClassName?: string;
  /** Etykieta regionu głównego (gdy brak widocznego nagłówka h1). */
  label?: string;
  /** Zmiana klucza przewija treść na górę (nowy ekran / nowe pytanie). */
  scrollKey?: string;
}

export function Screen({ header, footer, children, scrollRef, contentClassName, label, scrollKey }: ScreenProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (typeof scrollRef === 'function') scrollRef(el);
    else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = el;
  };
  useEffect(() => {
    if (innerRef.current) innerRef.current.scrollTop = 0;
  }, [scrollKey]);
  return (
    <div className="screen">
      {header}
      <main className="screen__scroll" ref={setRef} aria-label={label}>
        <div className={cx('screen__content', footer ? 'screen__content--with-footer' : null, contentClassName)}>{children}</div>
      </main>
      {footer ? <div className="screen__footer">{footer}</div> : null}
    </div>
  );
}

export interface ScreenHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  backIcon?: IconName;
  right?: ReactNode;
  /** Fokus na tytule po wejściu na ekran (czytniki ekranu). */
  autoFocusTitle?: boolean;
}

export function ScreenHeader({ title, onBack, backLabel = 'Wstecz', backIcon = 'arrow_back', right, autoFocusTitle = true }: ScreenHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocusTitle && document.activeElement === document.body) titleRef.current?.focus({ preventScroll: true });
  }, [autoFocusTitle]);
  return (
    <header className="screen__header">
      {onBack ? (
        <button type="button" className="icon-btn" aria-label={backLabel} onClick={onBack}>
          <Icon name={backIcon} size={24} />
        </button>
      ) : (
        <span className="progress-header__spacer" aria-hidden="true" />
      )}
      <h1 className="screen__title" ref={titleRef} tabIndex={-1}>
        {title}
      </h1>
      {right}
    </header>
  );
}
