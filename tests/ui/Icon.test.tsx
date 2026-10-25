import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from '../../src/ui/components/Icon';
import { ICON_NAMES, ICONS } from '../../src/ui/icons';

afterEach(cleanup);

describe('Icon', () => {
  it('zawiera 33 ikony z projektu Design i ikonę profilu (Material Icons „person”), każda z viewBox i ścieżką', () => {
    expect(ICON_NAMES).toHaveLength(34);
    expect(ICON_NAMES).toContain('person');
    for (const name of ICON_NAMES) {
      expect(ICONS[name].viewBox).toBe('0 0 24 24');
      expect(ICONS[name].d.length).toBeGreaterThan(0);
    }
  });

  it('domyślnie jest dekoracyjna (aria-hidden) i używa currentColor', () => {
    const { container } = render(<Icon name="outlined_flag" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(ICONS.outlined_flag.d);
  });

  it('z etykietą ma role="img" i aria-label', () => {
    const { getByRole } = render(<Icon name="close" label="Zamknij" size={22} />);
    const img = getByRole('img', { name: 'Zamknij' });
    expect(img.getAttribute('width')).toBe('22');
  });
});
