/**
 * Bank V18 w interfejsie: jedna pula wszystkich 700 pytań, bez selektora i etykiet trudności (docs/MIGRACJA_V18.md).
 * Metadane trudności zostają w pliku, ale aplikacja nie nazywa pytań łatwymi/trudnymi i nie filtruje po poziomie.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { configLabel } from '../../src/ui/format';
import { correctOptionId, renderApp, startedMock } from './helpers';

afterEach(() => cleanup());

const LEVEL_WORDS = /\b(Łatwy|Średni|Trudny|Mieszany)\b/;

describe('jedna pula 700 pytań — bez poziomów trudności', () => {
  it.each(['test', 'freeflow'] as const)('konfiguracja %s: brak sekcji „Trudność” i przełącznika poziomu; zakres pokazuje całą pulę', async (mode) => {
    const c = await startedMock();
    c.openConfig(mode);
    await renderApp(c);
    expect(screen.queryByRole('heading', { name: 'Trudność' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Trudność' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Łatwy' })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(LEVEL_WORDS);
    fireEvent.click(screen.getByRole('button', { name: /Cały zakres/ }));
    const sheet = screen.getByRole('dialog', { name: 'Zakres' });
    expect(within(sheet).getByRole('radio', { name: /Cały zakres/ }).textContent).toContain('700');
  });

  it('próba ustawienia poziomu (np. z dawnej konfiguracji) nie zawęża puli', async () => {
    const c = await startedMock();
    c.openConfig('test');
    c.updateConfigDraft({ difficulty: 'advanced' });
    const s = c.getState().screen;
    if (s?.name !== 'config') throw new Error('config');
    expect(s.draft.difficulty).toBe('mixed');
  });

  it('ekran pytania i karta przerwanej sesji bez etykiety poziomu', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await renderApp(c);
    expect(document.querySelector('.q-meta__level')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(LEVEL_WORDS);
    await c.answer(correctOptionId(c));
    c.pauseSession();
    cleanup();
    await renderApp(c);
    const card = screen.getByRole('region', { name: 'Przerwana sesja' });
    expect(within(card).getByText('Cały zakres')).toBeTruthy();
    expect(card.textContent ?? '').not.toMatch(LEVEL_WORDS);
  });

  it('„O bazie pytań”: 700 pytań, bez listy poziomów trudności', async () => {
    const c = await startedMock();
    c.openSettings();
    c.openAbout();
    await renderApp(c);
    expect(screen.queryByRole('list', { name: 'Liczba pytań według poziomu trudności' })).toBeNull();
    expect(document.body.textContent ?? '').toContain('700 pytań');
    expect(document.body.textContent ?? '').not.toMatch(LEVEL_WORDS);
  });

  it('etykieta konfiguracji: dla całej puli bez poziomu; dawne sesje z poziomem nadal opisane zgodnie z historią', () => {
    expect(configLabel({ scope: 'ALL', scopeTitle: 'Cały zakres', difficulty: 'mixed', targetN: 20, myErrorsPriority: false })).toBe('Cały zakres');
    expect(configLabel({ scope: 'ANAT', scopeTitle: 'Anatomia', difficulty: 'advanced', targetN: 20, myErrorsPriority: false })).toBe('Anatomia · Trudny');
  });
});
