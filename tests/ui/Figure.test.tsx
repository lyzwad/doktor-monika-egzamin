/**
 * FigureBlock + ZoomViewer (S10–S11, B04): wersja pytania bez podpisów zdradzających klucz
 * (alt i podpis tylko z wersji pytania), wersja objaśnienia dopiero po odpowiedzi; powiększenie
 * 100–300%, „Dopasuj”, „Opis tekstowy”, dialog z pułapką fokusu i powrotem fokusu.
 * Bank startowy nie ma jeszcze figur — dane figur są tu wyłącznie fiksturą testową.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppController, AppState } from '../../src/app/controller';
import type { FigureVM, QuestionVM } from '../../src/app/viewModels';
import { AppRoot } from '../../src/ui/App';
import { FigureBlock, ZoomViewer, figureUrl } from '../../src/ui/components/Figure';
import { domDump, startedMock } from './helpers';

afterEach(cleanup);

const FIG_Q: FigureVM = { figureId: 'FIG-T1', src: 'figures/fig-t1-pytanie.svg', alt: 'Schemat pięciu warstw twarzy bez oznaczenia głębokości.', caption: 'Schemat warstw (wersja pytania)' };
const FIG_E: FigureVM = { figureId: 'FIG-T1E', src: 'figures/fig-t1-objasnienie.svg', alt: 'Depozyt zaznaczony w warstwie podokostnowej.', caption: 'Właściwa warstwa zaznaczona na schemacie' };

describe('FigureBlock / ZoomViewer', () => {
  it('obraz z alt wersji pytania, bez title; przycisk „Powiększ” 44 px z etykietą', () => {
    const { container } = render(<FigureBlock figure={FIG_Q} zoomLabel="Powiększ schemat" onZoom={() => undefined} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe(FIG_Q.alt);
    expect(img.getAttribute('title')).toBeNull();
    expect(img.getAttribute('src')).toBe('/figures/fig-t1-pytanie.svg');
    expect(screen.getByRole('button', { name: 'Powiększ schemat' }).textContent).toContain('Powiększ');
    expect(container.textContent).toContain(FIG_Q.caption);
  });

  it('figureUrl respektuje base i nie zmienia data:', () => {
    expect(figureUrl('figures/a.svg')).toBe('/figures/a.svg');
    expect(figureUrl('./figures/a.svg')).toBe('/figures/a.svg');
    expect(figureUrl('data:image/svg+xml,%3Csvg%3E')).toBe('data:image/svg+xml,%3Csvg%3E');
  });

  it('powiększenie 100–300% krokiem 50%, „Dopasuj”, „Opis tekstowy”, Escape zamyka', () => {
    let closed = 0;
    render(<ZoomViewer figure={FIG_Q} onClose={() => (closed += 1)} />);
    const dialog = screen.getByRole('dialog', { name: 'Powiększony schemat' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const minus = screen.getByRole('button', { name: 'Pomniejsz' }) as HTMLButtonElement;
    const plus = screen.getByRole('button', { name: 'Powiększ' }) as HTMLButtonElement;
    expect(screen.getByText('100%')).toBeTruthy();
    expect(minus.disabled).toBe(true);
    for (let i = 0; i < 6; i++) fireEvent.click(plus);
    expect(screen.getByText('300%')).toBeTruthy();
    expect(plus.disabled).toBe(true);
    expect((dialog.querySelector('.zoom__canvas') as HTMLElement).style.width).toBe('300%');
    fireEvent.click(minus);
    expect(screen.getByText('250%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dopasuj' }));
    expect(screen.getByText('100%')).toBeTruthy();
    const desc = screen.getByRole('button', { name: 'Opis tekstowy' });
    expect(desc.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(desc);
    expect(screen.getByText('Opis tekstowy schematu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ukryj opis' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(closed).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Zamknij/ }));
    expect(closed).toBe(2);
  });
});

describe('Figury na ekranie pytania (B04)', () => {
  /** Kontroler testowy: ekran pytania z mocka + figury z fikstur. */
  async function controllerWithFigures() {
    const mock = await startedMock();
    mock.openConfig('test');
    await mock.startTest();
    const withFigures = (s: AppState): AppState => {
      const q = s.screen as QuestionVM;
      if (q?.name !== 'question') return s;
      return { ...s, screen: { ...q, figure: FIG_Q, explanation: q.explanation ? { ...q.explanation, figure: FIG_E } : null } };
    };
    let cachedFrom: AppState | null = null;
    let cached: AppState | null = null;
    const controller: AppController = {
      ...mock,
      getState: () => {
        const s = mock.getState();
        if (s !== cachedFrom) {
          cachedFrom = s;
          cached = withFigures(s);
        }
        return cached as AppState;
      },
    };
    return { mock, controller };
  }

  it('przed odpowiedzią tylko wersja pytania; po odpowiedzi wersja objaśnienia w wyjaśnieniu', async () => {
    const { controller } = await controllerWithFigures();
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<AppRoot controller={controller} />);
    });
    const container = (view as ReturnType<typeof render>).container;
    const before = domDump(container);
    expect(before).toContain(FIG_Q.alt);
    expect(before).not.toContain(FIG_E.alt);
    expect(before).not.toContain(FIG_E.caption);
    expect(before).not.toContain('objasnienie');

    // Powiększenie wersji pytania i powrót fokusu do przycisku.
    const zoomBtn = screen.getByRole('button', { name: 'Powiększ schemat' });
    zoomBtn.focus();
    fireEvent.click(zoomBtn);
    const dialog = screen.getByRole('dialog', { name: 'Powiększony schemat' });
    expect(within(dialog).getByRole('img').getAttribute('alt')).toBe(FIG_Q.alt);
    fireEvent.click(within(dialog).getByRole('button', { name: /Zamknij/ }));
    expect(document.activeElement).toBe(zoomBtn);

    const first = within(screen.getByRole('list', { name: 'Warianty odpowiedzi' })).getAllByRole('button')[0] as HTMLElement;
    await act(async () => {
      fireEvent.click(first);
    });
    const expl = screen.getByRole('region', { name: 'Wyjaśnienie poprawnej odpowiedzi' });
    expect(within(expl).getByRole('img').getAttribute('alt')).toBe(FIG_E.alt);
    expect(within(expl).getByText(FIG_E.caption)).toBeTruthy();
    fireEvent.click(within(expl).getByRole('button', { name: 'Powiększ schemat objaśniający' }));
    expect(within(screen.getByRole('dialog', { name: 'Powiększony schemat' })).getByRole('img').getAttribute('alt')).toBe(FIG_E.alt);
  });
});
