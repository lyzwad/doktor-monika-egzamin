/**
 * Kontrolki z Design: Segmented (trudność, filtr przeglądu, zakładki historii), Switch („Moje błędy”),
 * ListRow (ustawienia, listy), Tag (oznaczenia pozycji i Powtórki).
 */
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { IconName } from '../icons';
import { Icon } from './Icon';
import { cx } from './Screen';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented — `radiogroup` (wybór) albo `tablist` (zakładki). Strzałki zmieniają wybór,
 * tylko wybrany element jest w kolejności Tab (roving tabindex).
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  kind = 'radiogroup',
  minItemWidth,
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  kind?: 'radiogroup' | 'tablist';
  /** Minimalna szerokość elementu (np. `'7.6rem'`) — przy dużym tekście elementy łamią się w wiersze. */
  minItemWidth?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  const style = minItemWidth ? ({ '--seg-min': minItemWidth } as CSSProperties) : undefined;
  return (
    <div role={kind} aria-label={label} className="segmented" style={style}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const a11y = kind === 'tablist' ? { role: 'tab' as const, 'aria-selected': selected } : { role: 'radio' as const, 'aria-checked': selected };
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className="segmented__item"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            {...a11y}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Switch — cały wiersz jest przełącznikiem (`role="switch"`), stan także tekstem opisu. */
export function SwitchRow({ title, description, checked, onChange }: { title: string; description: ReactNode; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span className="switch-row__body">
        <span className="switch-row__title">{title}</span>
        <span className="switch-row__desc">{description}</span>
      </span>
      <span className={cx('switch', checked && 'switch--on')} aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}

/** Wiersz listy z ikoną, tytułem, podtytułem, wartością i strzałką. */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  onClick,
  chevron = true,
}: {
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const body = (
    <span className="list-row__body">
      <span className="list-row__title">{title}</span>
      {subtitle ? <span className="list-row__subtitle">{subtitle}</span> : null}
    </span>
  );
  // Z wartością po prawej: treść i wartość zawijają się razem (`list-row__main`) — przy dużym tekście
  // wartość przechodzi pod tytuł zamiast ściskać go do kilku pikseli (PRZEKAZANIE §9, G06).
  const content = (
    <>
      {icon ? <Icon name={icon} size={22} className="list-row__icon" /> : null}
      {value !== undefined ? (
        <span className="list-row__main">
          {body}
          <span className="list-row__value">{value}</span>
        </span>
      ) : (
        body
      )}
      {onClick && chevron ? <Icon name="chevron_right" size={22} className="list-row__chevron" /> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="list-row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="list-row list-row--static">{content}</div>
  );
}

/** Oznaczenie (pigułka). `retry` — Powtórka z rombem (kształt + tekst, nie sam kolor). */
export function Tag({ children, retry = false, small = false }: { children: ReactNode; retry?: boolean; small?: boolean }) {
  return (
    <span className={cx('tag', retry && 'tag--retry', small && 'tag--sm')}>
      {retry ? <span className="diamond" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
