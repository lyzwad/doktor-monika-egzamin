/**
 * „O bazie pytań” — licznik pytań z webinarów (SPEC-webinary-247, CAP-6; teksty-ui.md):
 * wiersz „Pytania z webinarów” w liście „Kontrola treści” zaraz po wierszu przeglądu AI, z liczbą z katalogu
 * (pytania z dowodem webinaru); licznik przeglądu AI bez zmian; bez deklaracji zatwierdzenia klinicznego.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ControllerProvider } from '../../src/app/ControllerContext';
import { bankInfoOf } from '../../src/app/screenModels';
import type { AboutVM } from '../../src/app/viewModels';
import type { Catalog } from '../../src/domain/types';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { familiesCount } from '../../src/ui/format';
import { AboutScreen } from '../../src/ui/screens/SettingsScreens';
import { currentCatalog } from '../content';
import { bank, renderApp, startedMock } from './helpers';

afterEach(cleanup);

/** Pytania banku z `origin === 'webinar'` (teksty-ui.md: wiersz = liczba takich pytań). */
const webinarInBank = bank.questions.filter((q) => q.origin === 'webinar').length;

function rowsOf(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole('listitem');
}

describe('„O bazie pytań” — pytania z webinarów', () => {
  it('wiersz „Pytania z webinarów” zaraz po przeglądzie AI, liczba z katalogu; licznik AI bez zmian; bez „zatwierdzon”', async () => {
    const c = await startedMock();
    c.openSettings();
    c.openAbout();
    await renderApp(c);
    const checks = screen.getByRole('list', { name: 'Kontrola treści' });
    const rows = rowsOf(checks);
    const ai = rows.findIndex((r) => /Sprawdzone odrębnym przeglądem AI/.test(r.textContent ?? ''));
    const wb = rows.findIndex((r) => (r.textContent ?? '').startsWith('Pytania z webinarów'));
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(wb).toBe(ai + 1);
    expect(within(checks).getByText('Pytania z webinarów').nextSibling?.textContent).toBe(String(webinarInBank));
    expect(within(checks).getByText(/Sprawdzone odrębnym przeglądem AI/).nextSibling?.textContent).toBe(String(bank.counts.independently_checked_draft));
    expect((document.body.textContent ?? '').toLowerCase()).not.toContain('zatwierdzon');
  });

  it('liczba w wierszu pochodzi z modelu widoku (np. 247)', async () => {
    const c = await startedMock();
    c.openSettings();
    c.openAbout();
    const vm = c.getState().screen;
    if (vm?.name !== 'about') throw new Error('oczekiwano „O bazie”');
    const about: AboutVM = { ...vm, bank: { ...vm.bank, webinarQuestionCount: 247 } };
    await act(async () => {
      render(
        <ControllerProvider controller={c}>
          <AboutScreen vm={about} />
        </ControllerProvider>,
      );
    });
    const checks = screen.getByRole('list', { name: 'Kontrola treści' });
    expect(within(checks).getByText('Pytania z webinarów').nextSibling?.textContent).toBe('247');
  });

  it('bankInfoOf: webinarQuestionCount = pytania katalogu z dowodem webinaru (mock i katalog produkcyjny)', async () => {
    const c = await startedMock();
    const catalog = c.getState().catalog;
    if (!catalog) throw new Error('brak katalogu');
    expect(bankInfoOf(catalog).webinarQuestionCount).toBe(CONTENT_RELEASE.counts.webinar);
    expect(bankInfoOf(currentCatalog()).webinarQuestionCount).toBe(CONTENT_RELEASE.counts.webinar);
    // 3 pytania V18 z dowodem, 2 pytania WB bez dowodu → 247 + 3 − 2.
    const evidence = { quote: 'cytat', unitIds: ['W13-U0022'], note: 'nota' };
    const v18 = catalog.questions.filter((q) => q.webinarEvidence === null).slice(0, 3).map((q) => q.id);
    const wb = catalog.questions.filter((q) => q.webinarEvidence !== null).slice(0, 2).map((q) => q.id);
    const questions = catalog.questions.map((q) => (v18.includes(q.id) ? { ...q, webinarEvidence: evidence } : wb.includes(q.id) ? { ...q, webinarEvidence: null } : q));
    const changed: Catalog = { ...catalog, questions };
    expect(bankInfoOf(changed).webinarQuestionCount).toBe(CONTENT_RELEASE.counts.webinar + 1);
    expect(bankInfoOf(changed).independentlyCheckedCount).toBe(bankInfoOf(catalog).independentlyCheckedCount);
  });

  it('wydanie „V18 + webinary”: „O bazie” pokazuje 947 pytań, 939 rodzin, 247 z webinarów i 600 po przeglądzie AI', async () => {
    expect([CONTENT_RELEASE.counts.questions, bank.counts.families, CONTENT_RELEASE.counts.webinar, bank.counts.independently_checked_draft]).toEqual([947, 939, 247, 600]);
    expect(webinarInBank).toBe(247);
    const c = await startedMock();
    c.openSettings();
    c.openAbout();
    await renderApp(c);
    const body = document.body.textContent ?? '';
    expect(body).toContain('Wbudowana pula zawiera 947 pytań jednokrotnego wyboru');
    expect(body).toContain(`w puli jest ${familiesCount(939)}`);
    const checks = screen.getByRole('list', { name: 'Kontrola treści' });
    expect(within(checks).getByText('Pytania z webinarów').nextSibling?.textContent).toBe('247');
    expect(within(checks).getByText(/Sprawdzone odrębnym przeglądem AI/).nextSibling?.textContent).toBe('600');
    expect(body.toLowerCase()).not.toContain('zatwierdzon');
  });
});
