/**
 * AnswerCard / AnswerList (PRZEKAZANIE §6, kryteria B03–B05):
 * - przed odpowiedzią brak jakiegokolwiek wskazania klucza w DOM i atrybutach dostępności,
 * - stany po ocenie: kolor + ikona + tekst, karta przestaje być przyciskiem,
 * - drugie (i szybkie podwójne) dotknięcie nie wywołuje ponownie akcji.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerCardVM } from '../../src/app/viewModels';
import { AnswerCard, AnswerList } from '../../src/ui/components/AnswerCard';

afterEach(cleanup);

const TEXTS = ['Pierwszy wariant', 'Drugi wariant', 'Trzeci wariant', 'Czwarty wariant'];
const IDS = ['C', 'A', 'D', 'B'];
const LETTERS = ['A', 'B', 'C', 'D'] as const;

function neutral(): AnswerCardVM[] {
  return IDS.map((optionId, i) => ({ optionId, letter: LETTERS[i] ?? 'A', text: TEXTS[i] ?? '', state: 'neutral', interactive: true }));
}

function evaluated(states: AnswerCardVM['state'][]): AnswerCardVM[] {
  return IDS.map((optionId, i) => ({ optionId, letter: LETTERS[i] ?? 'A', text: TEXTS[i] ?? '', state: states[i] ?? 'rest-after-eval', interactive: false }));
}

/** Wszystkie atrybuty i teksty w DOM (do wyszukiwania śladów klucza). */
function domDump(container: HTMLElement): string {
  const parts: string[] = [container.textContent ?? ''];
  container.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) parts.push(`${attr.name}=${attr.value}`);
  });
  return parts.join('\n');
}

describe('AnswerList — przed odpowiedzią', () => {
  it('cztery karty-przyciski z literą pozycyjną i pełnym tekstem, bez śladów klucza', () => {
    const { container } = render(<AnswerList slotId="s1" answers={neutral()} mode="live" onAnswer={() => true} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.textContent)).toEqual(TEXTS.map((t, i) => `${LETTERS[i]}${LETTERS[i]}. ${t}`));
    const dump = domDump(container);
    expect(dump).not.toMatch(/poprawn|błędn|correct|wrong|selected|klucz/i);
    // Identyfikatory opcji z banku nie trafiają do DOM (ani jako data-*, ani aria).
    expect(container.querySelector('[data-option-id], [aria-checked], [aria-pressed], [aria-selected]')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('pierwsze dotknięcie wywołuje akcję raz; drugie i szybkie podwójne są ignorowane', async () => {
    const onAnswer = vi.fn(() => new Promise<boolean>(() => undefined));
    render(<AnswerList slotId="s1" answers={neutral()} mode="live" onAnswer={onAnswer} />);
    const [first, second] = screen.getAllByRole('button');
    await act(async () => {
      fireEvent.click(first as HTMLElement);
      fireEvent.click(first as HTMLElement);
      fireEvent.click(second as HTMLElement);
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // fireEvent.click ma `detail = 0` jak aktywacja klawiszem → wybór „z fokusem” (UI-03).
    expect(onAnswer).toHaveBeenCalledWith('C', true);
  });

  it('UI-03: dotknięcie (detail ≥ 1, przycisk bez fokusu) nie żąda przeniesienia fokusu; klawiatura żąda', async () => {
    const onAnswer = vi.fn(() => new Promise<boolean>(() => undefined));
    const { rerender } = render(<AnswerList slotId="s1" answers={neutral()} mode="live" onAnswer={onAnswer} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[1] as HTMLElement, { detail: 1 });
    });
    expect(onAnswer).toHaveBeenLastCalledWith('A', false);
    rerender(<AnswerList slotId="s2" answers={neutral()} mode="live" onAnswer={onAnswer} />);
    const button = screen.getAllByRole('button')[2] as HTMLElement;
    button.focus();
    await act(async () => {
      fireEvent.click(button, { detail: 1 });
    });
    expect(onAnswer).toHaveBeenLastCalledWith('D', true);
  });

  it('odrzucona akcja bez zapisu (false) zwalnia blokadę; nowa pozycja ma własną blokadę', async () => {
    let accept = false;
    const onAnswer = vi.fn(async () => accept);
    const { rerender } = render(<AnswerList slotId="s1" answers={neutral()} mode="live" onAnswer={onAnswer} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    });
    accept = true;
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[1] as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[2] as HTMLElement);
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    rerender(<AnswerList slotId="s2" answers={neutral()} mode="live" onAnswer={onAnswer} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    });
    expect(onAnswer).toHaveBeenCalledTimes(3);
  });
});

describe('AnswerCard — stany po ocenie', () => {
  it('błędna odpowiedź: czerwona wybrana z „Twoja odpowiedź — błędna”, zielona poprawna z „Poprawna odpowiedź”, ikony', () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <AnswerList slotId="s1" answers={evaluated(['selected-wrong', 'rest-after-eval', 'correct-unselected', 'rest-after-eval'])} mode="live" onAnswer={onAnswer} />,
    );
    // Po ocenie karty nie są przyciskami — dotknięcie nic nie robi.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(screen.getByText(TEXTS[0] as string));
    expect(onAnswer).not.toHaveBeenCalled();

    const wrong = container.querySelector('.answer-card--selected-wrong');
    const correct = container.querySelector('.answer-card--correct-unselected');
    expect(wrong?.textContent).toContain('Twoja odpowiedź — błędna');
    expect(correct?.textContent).toContain('Poprawna odpowiedź');
    expect(wrong?.querySelectorAll('svg')).toHaveLength(1);
    expect(correct?.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('.answer-card--rest-after-eval')).toHaveLength(2);
    for (const rest of Array.from(container.querySelectorAll('.answer-card--rest-after-eval'))) {
      expect(rest.textContent).not.toMatch(/poprawn|błędn/i);
    }
  });

  it('poprawna odpowiedź w trybie live: „Poprawna odpowiedź” + informacja dla czytnika, że to wybór', () => {
    render(<AnswerCard vm={{ optionId: 'B', letter: 'D', text: 'Tekst', state: 'selected-correct', interactive: false }} mode="live" />);
    expect(screen.getByText('Poprawna odpowiedź')).toBeTruthy();
    expect(screen.getByText('(Twój wybór)', { exact: false }).className).toBe('visually-hidden');
  });

  it('podgląd historyczny: „Twoja odpowiedź — poprawna”', () => {
    render(<AnswerCard vm={{ optionId: 'B', letter: 'A', text: 'Tekst', state: 'selected-correct', interactive: false }} mode="preview" />);
    expect(screen.getByText('Twoja odpowiedź — poprawna')).toBeTruthy();
  });

  it('pending: wybrana, bez oceny i bez przycisku', () => {
    const { container, rerender } = render(<AnswerCard vm={{ optionId: 'B', letter: 'A', text: 'Tekst', state: 'pending', interactive: false }} mode="live" onSelect={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toContain('Wybrana — zapisywanie…');
    expect(container.textContent).not.toMatch(/poprawn|błędn/i);
    rerender(<AnswerCard vm={{ optionId: 'B', letter: 'A', text: 'Tekst', state: 'pending', interactive: false }} mode="live" saveFailed />);
    expect(container.textContent).toContain('Wybrana — niezapisana');
  });

  it('w trybie podglądu/przeglądu nawet neutralna karta nie jest przyciskiem', () => {
    render(<AnswerList slotId="s1" answers={neutral()} mode="review" onAnswer={() => true} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
