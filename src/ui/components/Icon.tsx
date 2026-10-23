import type { CSSProperties } from 'react';
import { ICONS, type IconName } from '../icons';

export interface IconProps {
  name: IconName;
  /** Rozmiar rysunku w px (projekt: 18–22). Pole dotyku (≥ 44 × 44) zapewnia przycisk-rodzic. */
  size?: number;
  /**
   * Etykieta dostępności. Bez niej ikona jest dekoracyjna (`aria-hidden`) — znaczenie niesie tekst
   * obok albo `aria-label` przycisku.
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Ikona inline SVG (fill: currentColor) — bez fontu ikon i bez pobierania z sieci. */
export function Icon({ name, size = 20, label, className, style }: IconProps) {
  const icon = ICONS[name];
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="currentColor"
      focusable="false"
      className={className}
      style={{ flex: 'none', ...style }}
      {...a11y}
    >
      <path d={icon.d} />
    </svg>
  );
}
