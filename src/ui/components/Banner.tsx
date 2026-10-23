/**
 * Banner (Design): info / offline / sukces / ostrzeżenie / błąd. Znaczenie zawsze ikoną + tekstem,
 * nie samym kolorem. `role="status"` dla informacji, `role="alert"` dla błędów — bez przejmowania fokusu.
 */
import type { ReactNode } from 'react';
import type { IconName } from '../icons';
import { Icon } from './Icon';
import { cx } from './Screen';

export type BannerTone = 'info' | 'neutral' | 'plain' | 'success' | 'warn' | 'danger';

const DEFAULT_ICON: Record<BannerTone, IconName | null> = {
  info: 'info',
  neutral: 'wifi_off',
  plain: null,
  success: 'check_circle',
  warn: 'warning_amber',
  danger: 'error_outline',
};

export interface BannerProps {
  tone: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: IconName | null;
  role?: 'status' | 'alert' | 'note' | undefined;
  className?: string;
}

export function Banner({ tone, title, children, actions, icon, role, className }: BannerProps) {
  const iconName = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <div className={cx('banner', `banner--${tone}`, className)} role={role}>
      <div className="banner__row">
        {iconName ? <Icon name={iconName} className="banner__icon" /> : null}
        <div className="banner__body">
          {title ? <span className="banner__title">{title}</span> : null}
          {children}
        </div>
      </div>
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}

/** Baner braku internetu — nauka działa offline (S24b). */
export function OfflineBanner({ variant = 'home' }: { variant?: 'home' | 'question' }) {
  return (
    <Banner tone="neutral" role="status">
      {variant === 'question'
        ? 'Brak internetu. Pytania, objaśnienia i schematy działają; publikację zewnętrzną otworzysz po połączeniu.'
        : 'Brak internetu. Nauka działa normalnie; publikacje zewnętrzne otworzysz po połączeniu.'}
    </Banner>
  );
}
