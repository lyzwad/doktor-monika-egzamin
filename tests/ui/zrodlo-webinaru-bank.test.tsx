/**
 * Źródło webinaru na PRAWDZIWYM wydaniu „V18 + webinary” (SPEC-webinary-247, CAP-5; teksty-ui.md):
 * - pytanie WB rozwiązane w aplikacji (mock z prawdziwym bankiem) pokazuje po odpowiedzi przycisk „Źródło webinaru”
 *   i panel z nazwą pliku, cytatem i notą z pliku banku — bez żadnego `<a>`;
 * - katalog → `buildSnapshot` → `explanationOf` → panel: WB-USGTR-017 (dwa źródła, W11 i W16) pokazuje przy każdym
 *   źródle właściwe fragmenty i plik, a cytat pytania w panelu każdego źródła;
 * - dla KAŻDEGO pytania WB „Gdzie w źródle” danego źródła = jego ID fragmentów (format `source_locator_pl` z adaptera).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { explanationOf } from '../../src/app/screenModels';
import { buildSnapshot } from '../../src/domain/snapshot';
import type { CatalogQuestion } from '../../src/domain/types';
import { ExplanationPanel } from '../../src/ui/components/ExplanationPanel';
import { locatorForSource } from '../../src/ui/format';
import { currentCatalog } from '../content';
import { bank, correctOptionId, currentSnapshot, renderApp, startedMock } from './helpers';

afterEach(cleanup);

const NAPISY = 'Fragment automatycznych napisów — może zawierać błędy rozpoznawania mowy';
const EGZAMIN = 'Źródło egzaminacyjne z wykładu, nie zweryfikowane aktualne wytyczne.';

const catalog = currentCatalog();
const wbQuestions = catalog.questions.filter((q) => q.webinarEvidence !== null);

function rawQuestion(id: string) {
  const q = bank.questions.find((x) => x.id === id);
  if (!q) throw new Error(`brak ${id} w banku`);
  return q;
}

function fileNameOf(sourceId: string): string {
  const name = bank.sources[sourceId]?.filename;
  if (!name) throw new Error(`brak nazwy pliku źródła ${sourceId}`);
  return name;
}

function renderExplanation(q: CatalogQuestion) {
  const snapshot = buildSnapshot(catalog, q, q.options.map((o) => o.id));
  return render(<ExplanationPanel explanation={explanationOf(snapshot)} online />);
}

describe('źródło webinaru na prawdziwym banku', () => {
  it('wydanie ma 247 pytań WB w katalogu; każde ze źródłami webinaru bez adresu', () => {
    expect(wbQuestions).toHaveLength(247);
    for (const q of wbQuestions) {
      expect(q.sourceIds.length).toBeGreaterThan(0);
      for (const id of q.sourceIds) {
        expect(catalog.sources[id]?.webinar, `${q.id} ${id}`).toBe(true);
        expect(catalog.sources[id]?.url, `${q.id} ${id}`).toBeNull();
      }
    }
  });

  it('dla każdego pytania WB „Gdzie w źródle” danego źródła = ID fragmentów z prefiksem tego źródła', () => {
    for (const q of wbQuestions) {
      const units = q.webinarEvidence?.unitIds ?? [];
      for (const id of q.sourceIds) {
        const expected = units.filter((u) => u.startsWith(`${id}-`)).join(', ');
        expect(locatorForSource(q.sourceLocator, id), `${q.id} ${id}`).toBe(expected);
      }
    }
  });

  it('WB-USGTR-017 (W11, W16): przy każdym źródle właściwe fragmenty i plik, cytat pytania w obu panelach, bez <a>', () => {
    const q = catalog.questionsById['WB-USGTR-017'];
    if (!q) throw new Error('brak WB-USGTR-017 w katalogu');
    expect(q.sourceIds).toEqual(['W11', 'W16']);
    const raw = rawQuestion('WB-USGTR-017');
    const { container } = renderExplanation(q);
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('source-row'));
    expect(rows).toHaveLength(2);
    const expected: Record<string, string> = { W11: 'W11-U0033', W16: 'W16-U0010' };
    rows.forEach((row, i) => {
      const sourceId = q.sourceIds[i] ?? '';
      const title = bank.sources[sourceId]?.title ?? '';
      const toggle = within(row).getByRole('button', { name: new RegExp(title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      expect(toggle.textContent).toContain('transkrypcja webinaru · fragmenty automatycznych napisów');
      fireEvent.click(toggle);
      expect(within(row).getByText('Gdzie w źródle:').parentElement?.textContent).toBe(`Gdzie w źródle: ${expected[sourceId]}`);
      const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
      fireEvent.click(button);
      const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
      if (!panel) throw new Error('brak panelu');
      expect(panel.textContent).toContain(`Plik: ${fileNameOf(sourceId)}`);
      expect(panel.textContent).toContain(NAPISY);
      expect(panel.querySelector('blockquote')?.textContent).toBe(raw.evidence_quote);
      expect(panel.textContent).toContain(raw.source_note_pl ?? '');
      expect(panel.textContent).toContain(EGZAMIN);
    });
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('pytanie WB rozwiązane w aplikacji: po odpowiedzi „Źródło webinaru” otwiera panel z danymi z pliku banku', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    let snap = currentSnapshot(c);
    for (let i = 0; i < 19 && !snap.stem.endsWith('[webinar]'); i++) {
      await c.answer(correctOptionId(c));
      await c.next();
      snap = currentSnapshot(c);
    }
    expect(snap.stem.endsWith('[webinar]'), 'w teście 20 pytań powinno być pytanie WB').toBe(true);
    const raw = rawQuestion(snap.questionId);
    await c.answer(correctOptionId(c));
    await renderApp(c);
    const region = screen.getByRole('region', { name: 'Wyjaśnienie poprawnej odpowiedzi' });
    const sourceId = raw.source_ids[0] ?? '';
    const row = within(region)
      .getAllByRole('listitem')
      .find((li) => li.classList.contains('source-row') && (li.textContent ?? '').includes(bank.sources[sourceId]?.title ?? '§'));
    if (!row) throw new Error('brak wiersza źródła webinaru');
    await act(async () => {
      fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement);
    });
    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('brak panelu');
    expect(panel.textContent).toContain(`Plik: ${fileNameOf(sourceId)}`);
    expect(panel.querySelector('blockquote')?.textContent).toBe(raw.evidence_quote);
    expect(panel.textContent).toContain(raw.source_note_pl ?? '');
    expect(region.querySelectorAll('a')).toHaveLength(0);
  });
});
