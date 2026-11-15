/**
 * Źródło webinaru w wyjaśnieniu (SPEC-webinary-247, CAP-5; teksty-ui.md):
 * - wiersz źródła WB: tytuł, „transkrypcja webinaru · fragmenty automatycznych napisów”, po rozwinięciu
 *   „Gdzie w źródle: ” z fragmentami TEGO źródła i przycisk „Źródło webinaru” (zamiast „Otwórz publikację”);
 * - panel wewnętrzny: „Plik: …”, zdanie o automatycznych napisach, cytat (blockquote), nota pytania,
 *   zdanie o źródle egzaminacyjnym — w tej kolejności; bez żadnego `<a>`, także offline i przy niepustym `url`;
 * - `explanationOf`: wyjaśnienie wyłącznie ze snapshotu slotu; stary snapshot V18 bez nowych pól działa jak dotąd;
 * - przegląd (tryb `review`) czyta dane webinaru ze snapshotu, nie z bieżącego katalogu.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { draftFromConfig, explanationOf, questionVMOf, type ViewInput } from '../../src/app/screenModels';
import type { ExplanationVM, SourceVM } from '../../src/app/viewModels';
import { DEFAULT_FREE_FLOW_CONFIG, DEFAULT_TEST_CONFIG } from '../../src/domain/policies';
import type { QuestionSnapshot } from '../../src/domain/types';
import { ExplanationPanel } from '../../src/ui/components/ExplanationPanel';
import { correctOptionId, openSession, startedMock } from './helpers';

afterEach(cleanup);

const NAPISY = 'Fragment automatycznych napisów — może zawierać błędy rozpoznawania mowy';
const EGZAMIN = 'Źródło egzaminacyjne z wykładu, nie zweryfikowane aktualne wytyczne.';
const QUOTE = 'toksyna działa przez blokowanie uwalniania acetylocholiny w złączu nerwowo-mięśniowym';
const NOTE = 'Klucz sprawdzony względem transkrypcji wykładu.';

function wbSource(id: string, over: Partial<SourceVM> = {}): SourceVM {
  return {
    id,
    title: `Webinar ${id} — toksyna botulinowa`,
    kindPl: 'transkrypcja webinaru',
    accessPl: 'fragmenty automatycznych napisów',
    url: null,
    doi: null,
    pmid: null,
    webinar: true,
    fileName: `${id}.txt`,
    ...over,
  };
}

function wbExplanation(over: Partial<ExplanationVM> = {}): ExplanationVM {
  return {
    text: 'Toksyna blokuje uwalnianie acetylocholiny.',
    figure: null,
    context: null,
    sources: [wbSource('W13')],
    sourceLocator: 'W13: W13-U0022, W13-U0029',
    webinarEvidence: { quote: QUOTE, unitIds: ['W13-U0022', 'W13-U0029'], note: NOTE },
    ...over,
  };
}

function rowOf(title: RegExp): HTMLElement {
  const toggle = screen.getByRole('button', { name: title });
  const li = toggle.closest('li');
  if (!li) throw new Error('brak wiersza źródła');
  return li;
}

function expandRow(title: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: title }));
  return rowOf(title);
}

function panelOf(button: HTMLElement): HTMLElement {
  const id = button.getAttribute('aria-controls');
  if (!id) throw new Error('przycisk bez aria-controls');
  const panel = document.getElementById(id);
  if (!panel) throw new Error(`brak panelu #${id}`);
  return panel;
}

/** Teksty występują w panelu w podanej kolejności. */
function expectInOrder(text: string, parts: string[]) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    expect(at, `„${part}” po pozycji ${from}`).toBeGreaterThanOrEqual(0);
    from = at + part.length;
  }
}

describe('SourceRow — źródło webinaru', () => {
  it('jedno źródło: tytuł i podpis; po rozwinięciu fragmenty i przycisk „Źródło webinaru”; panel z treściami w kolejności z teksty-ui.md; bez <a>', () => {
    const { container } = render(<ExplanationPanel explanation={wbExplanation()} online />);
    const toggle = screen.getByRole('button', { name: /Webinar W13/ });
    expect(toggle.textContent).toContain('Webinar W13 — toksyna botulinowa');
    expect(toggle.textContent).toContain('transkrypcja webinaru · fragmenty automatycznych napisów');

    const row = expandRow(/Webinar W13/);
    expect(within(row).getByText('Gdzie w źródle:').parentElement?.textContent).toBe('Gdzie w źródle: W13-U0022, W13-U0029');
    expect(within(row).queryByText(/Otwórz publikację/)).toBeNull();

    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    expect(within(row).queryByText(QUOTE)).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = panelOf(button);
    expect(row.contains(panel)).toBe(true);
    expect(within(panel).getByText('W13.txt', { exact: false }).textContent).toBe('Plik: W13.txt');
    expect(within(panel).getByText(NAPISY)).toBeTruthy();
    const quote = panel.querySelector('blockquote');
    expect(quote?.textContent).toBe(QUOTE);
    expect(within(panel).getByText(NOTE)).toBeTruthy();
    expect(within(panel).getByText(EGZAMIN)).toBeTruthy();
    expectInOrder(panel.textContent ?? '', ['Plik: W13.txt', NAPISY, QUOTE, NOTE, EGZAMIN]);

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    expect(within(row).queryByText(QUOTE)).toBeNull();
  });

  it('dwa źródła: każdy wiersz pokazuje tylko swoje fragmenty i własny plik; ten sam cytat i nota pytania', () => {
    render(
      <ExplanationPanel
        explanation={wbExplanation({
          sources: [wbSource('W13'), wbSource('W16', { title: 'Webinar W16 — wypełniacze' })],
          sourceLocator: 'W13: W13-U0022, W13-U0029; W16: W16-U0010',
          webinarEvidence: { quote: QUOTE, unitIds: ['W13-U0022', 'W13-U0029', 'W16-U0010'], note: NOTE },
        })}
        online
      />,
    );
    const w13 = expandRow(/Webinar W13/);
    const w16 = expandRow(/Webinar W16/);
    expect(within(w13).getByText('Gdzie w źródle:').parentElement?.textContent).toBe('Gdzie w źródle: W13-U0022, W13-U0029');
    expect(within(w16).getByText('Gdzie w źródle:').parentElement?.textContent).toBe('Gdzie w źródle: W16-U0010');
    expect(w13.textContent).not.toContain('W16-U0010');
    expect(w16.textContent).not.toContain('W13-U0022');

    const b13 = within(w13).getByRole('button', { name: /Źródło webinaru/ });
    const b16 = within(w16).getByRole('button', { name: /Źródło webinaru/ });
    fireEvent.click(b13);
    fireEvent.click(b16);
    const p13 = panelOf(b13);
    const p16 = panelOf(b16);
    expect(p13.id).not.toBe(p16.id);
    expect(p13.textContent).toContain('Plik: W13.txt');
    expect(p13.textContent).not.toContain('W16.txt');
    expect(p16.textContent).toContain('Plik: W16.txt');
    expect(p16.textContent).not.toContain('W13.txt');
    for (const p of [p13, p16]) {
      expect(p.querySelector('blockquote')?.textContent).toBe(QUOTE);
      expect(p.textContent).toContain(NOTE);
    }
  });

  it('offline: panel otwiera się z tymi samymi treściami; brak <a> i komunikatu o publikacji', () => {
    const { container } = render(<ExplanationPanel explanation={wbExplanation()} online={false} />);
    const row = expandRow(/Webinar W13/);
    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    fireEvent.click(button);
    const panel = panelOf(button);
    expectInOrder(panel.textContent ?? '', ['Plik: W13.txt', NAPISY, QUOTE, NOTE, EGZAMIN]);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryByText(/Otwórz publikację/)).toBeNull();
    expect(document.body.textContent).not.toContain('Publikacji nie można teraz otworzyć');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('źródło webinaru z niepustym url: nadal bez <a> i bez „Otwórz publikację”', () => {
    for (const online of [true, false]) {
      const { container, unmount } = render(<ExplanationPanel explanation={wbExplanation({ sources: [wbSource('W13', { url: 'https://example.org/w13' })] })} online={online} />);
      const row = expandRow(/Webinar W13/);
      fireEvent.click(within(row).getByRole('button', { name: /Źródło webinaru/ }));
      expect(container.querySelectorAll('a')).toHaveLength(0);
      expect(screen.queryByText(/Otwórz publikację/)).toBeNull();
      unmount();
    }
  });

  it('brak dowodu w snapshocie: plik, zdanie o napisach i o źródle egzaminacyjnym, bez cytatu i noty', () => {
    render(<ExplanationPanel explanation={wbExplanation({ webinarEvidence: null })} online />);
    const row = expandRow(/Webinar W13/);
    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    fireEvent.click(button);
    const panel = panelOf(button);
    expectInOrder(panel.textContent ?? '', ['Plik: W13.txt', NAPISY, EGZAMIN]);
    expect(panel.querySelector('blockquote')).toBeNull();
    expect(panel.textContent).not.toContain(NOTE);
  });

  it('brak nazwy pliku: bez wiersza „Plik: ”', () => {
    render(<ExplanationPanel explanation={wbExplanation({ sources: [wbSource('W13', { fileName: null })] })} online />);
    const row = expandRow(/Webinar W13/);
    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    fireEvent.click(button);
    const panel = panelOf(button);
    expect(panel.textContent).not.toContain('Plik:');
    expectInOrder(panel.textContent ?? '', [NAPISY, QUOTE, NOTE, EGZAMIN]);
  });

  it('fokus zostaje na przycisku „Źródło webinaru” po otwarciu i zamknięciu panelu; aria-controls wskazuje panel', () => {
    render(<ExplanationPanel explanation={wbExplanation()} online />);
    const row = expandRow(/Webinar W13/);
    const button = within(row).getByRole('button', { name: /Źródło webinaru/ });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(panelOf(button).id).toBe(button.getAttribute('aria-controls'));
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
  });

  it('wiersz V18 obok wiersza webinaru działa jak dotąd (link https)', () => {
    const v18: SourceVM = {
      id: 'A01',
      title: 'Anatomy of the Facial Glideplanes',
      kindPl: 'badanie oryginalne',
      accessPl: 'abstrakt',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37747400/',
      doi: null,
      pmid: null,
      webinar: false,
      fileName: null,
    };
    render(<ExplanationPanel explanation={wbExplanation({ sources: [v18, wbSource('W13')], sourceLocator: 'A01: abstrakt; W13: W13-U0022' })} online />);
    const row = expandRow(/Anatomy of the Facial Glideplanes/);
    expect(within(row).getByRole('link', { name: /Otwórz publikację/ }).getAttribute('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/37747400/');
    expect(within(row).queryByRole('button', { name: /Źródło webinaru/ })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* explanationOf — wyłącznie ze snapshotu                                      */
/* -------------------------------------------------------------------------- */

const V18_SNAPSHOT: QuestionSnapshot = {
  questionId: 'Q-A01',
  revision: 1,
  bankVersion: 'chatgpt-combined-v18-2026-11-09-1fb7f7546332',
  familyId: 'F-A01',
  fingerprint: 'fp',
  domainId: 'ANAT',
  domainTitle: 'Anatomia',
  topicIds: ['T1'],
  topics: [{ id: 'T1', title: 'Warstwy twarzy', learningObjective: 'Cel', pearls: ['Perełka'] }],
  difficulty: 'basic',
  stem: 'Pytanie?',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ],
  correctOptionId: 'a',
  explanation: 'Wyjaśnienie V18.',
  sources: [{ id: 'A01', title: 'Publikacja', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', doi: '10.1/x', pmid: '1', kindPl: 'przegląd', accessPl: 'abstrakt' }],
  sourceLocator: 'A01: abstrakt.',
  figure: null,
  explanationFigure: null,
  reviewStatus: 'draft',
  approvedForQuestionKey: false,
};

const WB_SNAPSHOT = {
  ...V18_SNAPSHOT,
  questionId: 'WB-W13-001',
  explanation: 'Wyjaśnienie z webinaru.',
  sources: [
    { id: 'W13', title: 'Webinar W13', url: null, doi: null, pmid: null, kindPl: 'transkrypcja webinaru', accessPl: 'fragmenty automatycznych napisów', fileName: 'W13.txt', webinar: true },
    { id: 'W16', title: 'Webinar W16', url: null, doi: null, pmid: null, kindPl: 'transkrypcja webinaru', accessPl: 'fragmenty automatycznych napisów', fileName: 'W16.txt', webinar: true },
  ],
  sourceLocator: 'W13: W13-U0022, W13-U0029; W16: W16-U0010',
  webinarEvidence: { quote: QUOTE, unitIds: ['W13-U0022', 'W13-U0029', 'W16-U0010'], note: NOTE },
};

describe('explanationOf', () => {
  it('stary snapshot V18 bez nowych pól: webinar false, fileName null, webinarEvidence null; reszta jak dotąd', () => {
    const vm = explanationOf(V18_SNAPSHOT);
    expect(vm).toEqual({
      text: 'Wyjaśnienie V18.',
      figure: null,
      context: { topicTitle: 'Warstwy twarzy', learningObjective: 'Cel', pearls: ['Perełka'] },
      sources: [{ id: 'A01', title: 'Publikacja', kindPl: 'przegląd', accessPl: 'abstrakt', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', doi: '10.1/x', pmid: '1', webinar: false, fileName: null }],
      sourceLocator: 'A01: abstrakt.',
      webinarEvidence: null,
    });
  });

  it('snapshot WB: pola webinaru źródeł i dowód pytania; tablice skopiowane', () => {
    const vm = explanationOf(WB_SNAPSHOT);
    expect(vm.sources.map((s) => [s.id, s.webinar, s.fileName, s.url])).toEqual([
      ['W13', true, 'W13.txt', null],
      ['W16', true, 'W16.txt', null],
    ]);
    expect(vm.webinarEvidence).toEqual({ quote: QUOTE, unitIds: ['W13-U0022', 'W13-U0029', 'W16-U0010'], note: NOTE });
    expect(vm.webinarEvidence?.unitIds).not.toBe(WB_SNAPSHOT.webinarEvidence.unitIds);
    expect(vm.context?.pearls).not.toBe(V18_SNAPSHOT.topics[0]?.pearls);
    expect(vm.sourceLocator).toBe('W13: W13-U0022, W13-U0029; W16: W16-U0010');
  });

  it('webinarEvidence null w snapshocie → null', () => {
    const withoutEvidence = { ...WB_SNAPSHOT, webinarEvidence: null };
    expect(explanationOf(withoutEvidence).webinarEvidence).toBeNull();
  });
});

describe('przegląd (tryb review) — dane webinaru ze snapshotu slotu, nie z katalogu', () => {
  it('slot ze snapshotem WB pokazuje dowód i pola źródeł ze snapshotu, choć katalog ma dla W13/W16 inne dane', async () => {
    const c = await startedMock();
    c.openConfig('test');
    await c.startTest();
    await c.answer(correctOptionId(c));
    const state = c.getState();
    const catalog = state.catalog;
    const user = state.userState;
    if (!catalog || !user) throw new Error('brak katalogu albo stanu');
    const session = openSession(c);
    const slotId = session.plan[0];
    const slot = slotId ? session.slots[slotId] : undefined;
    if (!slotId || !slot) throw new Error('brak slotu');
    const snapshot = { ...WB_SNAPSHOT, questionId: slot.snapshot.questionId, options: slot.snapshot.options, correctOptionId: slot.snapshot.correctOptionId };
    const withWb = { ...session, slots: { ...session.slots, [slotId]: { ...slot, snapshot } } };
    const input: ViewInput = {
      catalog,
      user: { ...user, sessions: { ...user.sessions, [session.id]: withWb } },
      now: '2026-10-22T09:00:00.000Z',
      route: { name: 'review', sessionId: session.id, filter: 'all' },
      viewPosition: 0,
      drafts: { test: draftFromConfig(DEFAULT_TEST_CONFIG, 20), freeflow: draftFromConfig(DEFAULT_FREE_FLOW_CONFIG, 20) },
      starting: false,
      pendingAnswer: null,
      ffNotice: null,
      historyFilter: { kind: 'all' },
      selectedPoint: null,
      backupFlow: { step: 'idle', lastSavedFileName: null },
      safetyBackups: null,
      poolFlow: { step: 'idle' },
      appVersion: 'test',
      installHint: false,
    };
    const vm = questionVMOf(input, withWb, 0, 'review', false);
    expect(vm?.explanation?.webinarEvidence).toEqual(WB_SNAPSHOT.webinarEvidence);
    expect(vm?.explanation?.sources.map((s) => [s.id, s.webinar, s.fileName])).toEqual([
      ['W13', true, 'W13.txt'],
      ['W16', true, 'W16.txt'],
    ]);
    // Katalog bieżącego wydania ma W13/W16 z inną nazwą pliku — wygrywa snapshot slotu.
    expect(catalog.sources['W13']?.fileName).toBeTruthy();
    expect(catalog.sources['W13']?.fileName).not.toBe('W13.txt');
    expect(catalog.sources['W16']?.fileName).not.toBe('W16.txt');
  });
});
