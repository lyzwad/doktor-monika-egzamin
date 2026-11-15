/**
 * Teksty z liczbą pytań i nazwą wydania (SPEC-webinary-247, CAP-6; teksty-ui.md): opis kopii i ekran puli
 * biorą etykietę z `CONTENT_RELEASE_LABEL` i liczbę z `CONTENT_RELEASE.counts.questions` — nie na sztywno.
 * Wydanie podstawione przez `vi.mock` (etykieta „V18 + webinary”, 947 pytań, reszta bez zmian).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerProvider } from '../../src/app/ControllerContext';
import type { AppController } from '../../src/app/controller';
import { MSG_PACKS_DISABLED } from '../../src/app/appController';
import { BACKUP_CONTENTS_TEXT, PoolImportScreen } from '../../src/ui/screens/DataScreens';
import { renderApp, startedMock } from './helpers';

vi.mock('../../src/domain/contentRelease', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/domain/contentRelease')>();
  return {
    ...original,
    CONTENT_RELEASE: Object.freeze({ ...original.CONTENT_RELEASE, counts: Object.freeze({ ...original.CONTENT_RELEASE.counts, questions: 947 }) }),
    CONTENT_RELEASE_LABEL: 'V18 + webinary',
  };
});

afterEach(cleanup);

describe('teksty z wydania treści', () => {
  it('opis zawartości kopii: „(V18 + webinary, 947 pytań)”, bez „700”', () => {
    expect(BACKUP_CONTENTS_TEXT).toContain('treść pytań aktualnego banku (V18 + webinary, 947 pytań) z Twoich sesji');
    expect(BACKUP_CONTENTS_TEXT).not.toContain('700');
  });

  it('ekran „Pula pytań”: tytuł z etykietą i liczbą wydania, „banku 947 pytań”, bez „700”', async () => {
    const controller = { goBack: () => undefined } as unknown as AppController;
    await act(async () => {
      render(
        <ControllerProvider controller={controller}>
          <PoolImportScreen vm={{ name: 'poolImport', flow: { step: 'idle' } }} />
        </ControllerProvider>,
      );
    });
    expect(screen.getByText('Aplikacja używa wyłącznie wbudowanego banku pytań (V18 + webinary, 947 pytań)')).toBeTruthy();
    const body = document.body.textContent ?? '';
    expect(body).toContain('korzystają tylko z wbudowanego banku 947 pytań.');
    expect(body).not.toContain('700');
  });

  it('Ustawienia: podtytuł „Pula pytań” z etykietą wydania („Wyłącznie wbudowany bank V18 + webinary — import pul wyłączony”)', async () => {
    const c = await startedMock();
    c.openSettings();
    await renderApp(c);
    expect(screen.getByText('Wyłącznie wbudowany bank V18 + webinary — import pul wyłączony')).toBeTruthy();
    expect(document.body.textContent).not.toContain('bank V18 —');
  });

  it('mock: komunikat wyłączonego importu puli taki sam jak w kontrolerze („V18 + webinary (947 pytań)”)', async () => {
    const c = await startedMock();
    c.openPoolImport();
    await c.importPackFile(new Blob(['{}'], { type: 'application/json' }), 'pula.json');
    const vm = c.getState().screen;
    if (vm?.name !== 'poolImport') throw new Error('oczekiwano ekranu puli');
    expect(vm.flow).toMatchObject({ step: 'error', messagePl: MSG_PACKS_DISABLED });
    expect(MSG_PACKS_DISABLED).toContain('wbudowanego banku pytań V18 + webinary (947 pytań)');
  });
});
