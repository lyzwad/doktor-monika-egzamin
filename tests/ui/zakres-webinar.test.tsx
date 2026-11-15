/**
 * Zakres „Webinar” (CAP-8, teksty-ui.md) w arkuszu „Zakres” (Test i Free Flow): ostatnia pozycja `Webinar` z liczbą
 * w istniejącym formacie (`247 różnych zadań (rodzin)`), wybór zamyka arkusz i ustawia tytuł zakresu.
 * Bez nowych tekstów poza `Webinar`.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { familiesCount } from '../../src/ui/format';
import { openSession, renderApp, startedMock } from './helpers';

afterEach(() => cleanup());

describe('arkusz „Zakres” — opcja Webinar', () => {
  it.each(['test', 'freeflow'] as const)('%s: ostatnie radio to „Webinar” z liczbą 247; wybór zamyka arkusz i ustawia tytuł zakresu', async (mode) => {
    const c = await startedMock();
    c.openConfig(mode);
    await renderApp(c);
    fireEvent.click(screen.getByRole('button', { name: /Cały zakres/ }));
    const sheet = screen.getByRole('dialog', { name: 'Zakres' });
    const radios = within(sheet).getAllByRole('radio');
    const last = radios[radios.length - 1] as HTMLElement;
    expect(last.querySelector('.radio-row__label')?.textContent).toBe('Webinar');
    expect(last.querySelector('.radio-row__count')?.textContent).toBe(familiesCount(247));
    expect(familiesCount(247)).toBe('247 różnych zadań (rodzin)');
    expect(last.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(last);
    expect(screen.queryByRole('dialog')).toBeNull();
    const scopeButton = screen.getByRole('button', { name: /Webinar/ });
    expect(scopeButton.querySelector('.select-row__value')?.textContent).toBe('Webinar');
    expect(scopeButton.querySelector('.select-row__meta')?.textContent).toBe(familiesCount(247));
    fireEvent.click(scopeButton);
    const reopened = screen.getByRole('dialog', { name: 'Zakres' });
    expect(within(reopened).getByRole('radio', { name: /Webinar/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('atrapa: Test w zakresie Webinar losuje wyłącznie pytania WB', async () => {
    const c = await startedMock();
    c.openConfig('test');
    c.updateConfigDraft({ scope: 'WEBINAR', nText: '10' });
    await c.startTest();
    const s = openSession(c);
    expect(s.config.scope).toBe('WEBINAR');
    expect(s.plan).toHaveLength(10);
    expect(s.plan.every((id) => s.slots[id]?.questionId.startsWith('WB-'))).toBe(true);
  });
});
