/**
 * Ekran „Pula pytań” — liczba pytań w dopełniaczu („z wbudowanego banku N pytań”) dla dowolnej liczby wydania.
 * Wydanie podstawione przez `vi.mock` z liczbą kończącą się na 2 (942): w nawiasie tytułu mianownik („942 pytania”),
 * po „banku” dopełniacz („942 pytań”). Dla bieżącego wydania (947) brzmienie bez zmian (tests/ui/teksty-wydania.test.tsx).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerProvider } from '../../src/app/ControllerContext';
import type { AppController } from '../../src/app/controller';
import { PoolImportScreen } from '../../src/ui/screens/DataScreens';

vi.mock('../../src/domain/contentRelease', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/domain/contentRelease')>();
  return {
    ...original,
    CONTENT_RELEASE: Object.freeze({ ...original.CONTENT_RELEASE, counts: Object.freeze({ ...original.CONTENT_RELEASE.counts, questions: 942 }) }),
    CONTENT_RELEASE_LABEL: 'V18 + webinary',
  };
});

afterEach(cleanup);

describe('„Pula pytań” — odmiana liczby pytań', () => {
  it('942: tytuł „(V18 + webinary, 942 pytania)”, treść „z wbudowanego banku 942 pytań”', async () => {
    const controller = { goBack: () => undefined } as unknown as AppController;
    await act(async () => {
      render(
        <ControllerProvider controller={controller}>
          <PoolImportScreen vm={{ name: 'poolImport', flow: { step: 'idle' } }} />
        </ControllerProvider>,
      );
    });
    expect(screen.getByText('Aplikacja używa wyłącznie wbudowanego banku pytań (V18 + webinary, 942 pytania)')).toBeTruthy();
    const body = document.body.textContent ?? '';
    expect(body).toContain('korzystają tylko z wbudowanego banku 942 pytań.');
    expect(body).not.toContain('banku 942 pytania');
  });
});
