/**
 * ExplanationPanel (PRZEKAZANIE §6, kryterium B06): „Dlaczego ta odpowiedź jest poprawna”, tylko
 * poprawny wariant, bez odwołań do liter A–D (litery są pozycyjne), szerszy kontekst tematu,
 * źródła z rejestru (link tylko https, `rel="noopener noreferrer"`), zachowanie offline.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExplanationVM } from '../../src/app/viewModels';
import type { RuntimeBank } from '../../src/domain/types';
import { ExplanationPanel } from '../../src/ui/components/ExplanationPanel';
import { locatorForSource } from '../../src/ui/format';

afterEach(cleanup);

const bank = JSON.parse(readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.bankFile), 'utf-8')) as RuntimeBank;

/** Odwołania do liter wariantów („odpowiedź B”, „(C)”, „D)”, „wariant A”). */
const LETTER_REF = /(?:[Oo]dpowied|[Ww]ariant|[Oo]pcj|[Ll]iter)\S*\s+[A-D](?![\p{L}\p{N}])|\([A-D]\)|(?:^|\s)[A-D]\)/u;

function explanation(over: Partial<ExplanationVM> = {}): ExplanationVM {
  return {
    text: 'SMAS i sąsiednie przestrzenie zmieniają relacje regionalnie.',
    figure: null,
    context: { topicTitle: 'Warstwy twarzy', learningObjective: 'Przełożyć model warstw na relacje końcówki narzędzia.', pearls: ['SMAS ma regionalnie różną budowę.', 'Przestrzeń potencjalna nie jest pustą jamą.'] },
    sources: [
      { id: 'A01', title: 'Anatomy of the Facial Glideplanes', kindPl: 'badanie oryginalne', accessPl: 'abstrakt', url: 'https://pubmed.ncbi.nlm.nih.gov/37747400/', doi: '10.1097/PRS.0000000000011078', pmid: '37747400' },
      { id: 'A30', title: 'Facial layers review', kindPl: 'przegląd', accessPl: 'pełny tekst', url: 'javascript:alert(1)', doi: null, pmid: null },
    ],
    sourceLocator: 'A30: indeksowany fragment o pięciu warstwach; A01: abstrakt.',
    ...over,
  };
}

describe('ExplanationPanel', () => {
  it('nagłówek i treść wyjaśnienia; UI nie dodaje odwołań do liter A–D', () => {
    const { container } = render(<ExplanationPanel explanation={explanation()} online />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Dlaczego ta odpowiedź jest poprawna');
    expect(screen.getByRole('region', { name: 'Wyjaśnienie poprawnej odpowiedzi' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Rozwiń szerszy kontekst/ }));
    for (const b of screen.getAllByRole('button', { expanded: false })) fireEvent.click(b);
    expect(container.textContent ?? '').not.toMatch(LETTER_REF);
  });

  it('wyjaśnienia i perełki w banku nie odwołują się do liter wariantów', () => {
    const offenders = bank.questions.filter((q) => LETTER_REF.test(q.correct_explanation_pl)).map((q) => q.id);
    expect(offenders).toEqual([]);
    const pearlOffenders = Object.values(bank.topics).filter((t) => t.clinical_pearls_pl.some((p) => LETTER_REF.test(p)));
    expect(pearlOffenders).toEqual([]);
  });

  it('„Rozwiń szerszy kontekst” — kontekst tematu, aria-expanded', () => {
    render(<ExplanationPanel explanation={explanation()} online />);
    const toggle = screen.getByRole('button', { name: /Rozwiń szerszy kontekst/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('SMAS ma regionalnie różną budowę.')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Zwiń szerszy kontekst/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Szerszy kontekst tematu: Warstwy twarzy')).toBeTruthy();
    expect(screen.getByText('SMAS ma regionalnie różną budowę.')).toBeTruthy();
  });

  it('bez kontekstu tematu brak przycisku rozwinięcia', () => {
    render(<ExplanationPanel explanation={explanation({ context: null })} online />);
    expect(screen.queryByRole('button', { name: /szerszy kontekst/ })).toBeNull();
  });

  it('SourceRow: tytuł, rodzaj · zakres; po rozwinięciu „Gdzie w źródle”, DOI, PMID i link https', () => {
    render(<ExplanationPanel explanation={explanation({ context: null })} online />);
    const toggle = screen.getByRole('button', { name: /Anatomy of the Facial Glideplanes/ });
    expect(toggle.textContent).toContain('badanie oryginalne · abstrakt');
    fireEvent.click(toggle);
    expect(screen.getByText('abstrakt', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('10.1097/PRS.0000000000011078')).toBeTruthy();
    expect(screen.getByText('37747400', { selector: 'div' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /Otwórz publikację/ });
    expect(link.getAttribute('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/37747400/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adres spoza https nie staje się linkiem', () => {
    render(<ExplanationPanel explanation={explanation({ context: null })} online />);
    fireEvent.click(screen.getByRole('button', { name: /Facial layers review/ }));
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('indeksowany fragment o pięciu warstwach')).toBeTruthy();
  });

  it('offline: przycisk pokazuje komunikat, treść pozostaje dostępna', () => {
    render(<ExplanationPanel explanation={explanation({ context: null })} online={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Anatomy of the Facial Glideplanes/ }));
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Otwórz publikację/ }));
    expect(screen.getByRole('status').textContent).toContain('Publikacji nie można teraz otworzyć — brak połączenia.');
    expect(screen.getByText('10.1097/PRS.0000000000011078')).toBeTruthy();
  });

  it('lokator źródła: podział po identyfikatorach albo cały tekst', () => {
    expect(locatorForSource('A30: fragment; A01: abstrakt.', 'A01')).toBe('abstrakt');
    expect(locatorForSource('A30/A31: rozdział 2', 'A31')).toBe('rozdział 2');
    expect(locatorForSource('Rozdział 3, tabela 2.', 'X1')).toBe('Rozdział 3, tabela 2.');
    expect(locatorForSource('A30: fragment', 'A99')).toBe('');
  });
});
