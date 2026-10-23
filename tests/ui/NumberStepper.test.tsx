/**
 * NumberStepper (S04/S05, kryterium C01): ±10 i skróty nie ustawiają wartości spoza 1…pojemność;
 * błąd przy polu z działaniami naprawczymi; pole `inputmode="numeric"`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberStepper, parseWholeNumber } from '../../src/ui/components/NumberStepper';

afterEach(cleanup);

function setup(value: string, capacity: number, extra: Partial<Parameters<typeof NumberStepper>[0]> = {}) {
  const onChange = vi.fn();
  render(<NumberStepper value={value} capacity={capacity} onChange={onChange} error={null} {...extra} />);
  return {
    onChange,
    minus: screen.getByRole('button', { name: 'Zmniejsz o 10' }) as HTMLButtonElement,
    plus: screen.getByRole('button', { name: 'Zwiększ o 10' }) as HTMLButtonElement,
    chip: (n: number) => screen.getByRole('button', { name: String(n) }) as HTMLButtonElement,
    input: screen.getByRole('textbox', { name: 'Liczba pytań' }) as HTMLInputElement,
  };
}

describe('NumberStepper — granice', () => {
  it('20 przy pojemności 246: −10 → 10, +10 → 30, skróty 20–60 aktywne', () => {
    const s = setup('20', 246);
    expect(s.minus.disabled).toBe(false);
    expect(s.plus.disabled).toBe(false);
    fireEvent.click(s.minus);
    fireEvent.click(s.plus);
    expect(s.onChange.mock.calls).toEqual([['10'], ['30']]);
    for (const n of [20, 30, 40, 50, 60]) expect(s.chip(n).disabled).toBe(false);
    expect(s.chip(20).getAttribute('aria-pressed')).toBe('true');
    expect(s.input.getAttribute('inputmode')).toBe('numeric');
  });

  it('−10 nieaktywne, gdy wynik < 1 (wartości 1…10)', () => {
    for (const v of ['1', '5', '10']) {
      const s = setup(v, 246);
      expect(s.minus.disabled).toBe(true);
      fireEvent.click(s.minus);
      expect(s.onChange).not.toHaveBeenCalled();
      cleanup();
    }
    const s = setup('11', 246);
    expect(s.minus.disabled).toBe(false);
    fireEvent.click(s.minus);
    expect(s.onChange).toHaveBeenCalledWith('1');
  });

  it('+10 i skróty nieaktywne powyżej pojemności', () => {
    const s = setup('20', 25);
    expect(s.plus.disabled).toBe(true);
    fireEvent.click(s.plus);
    expect(s.onChange).not.toHaveBeenCalled();
    expect(s.chip(20).disabled).toBe(false);
    for (const n of [30, 40, 50, 60]) {
      expect(s.chip(n).disabled).toBe(true);
      fireEvent.click(s.chip(n));
    }
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it('+10 dokładnie do pojemności jest dozwolone (15 → 25 przy 25)', () => {
    const s = setup('15', 25);
    expect(s.plus.disabled).toBe(false);
    fireEvent.click(s.plus);
    expect(s.onChange).toHaveBeenCalledWith('25');
  });

  it('niepoprawny tekst: −10 nieaktywne; +10 liczy od 0 i nie przekracza pojemności', () => {
    const s = setup('12,5', 246);
    expect(s.minus.disabled).toBe(true);
    fireEvent.click(s.plus);
    expect(s.onChange).toHaveBeenCalledWith('10');
    cleanup();
    const t = setup('', 5);
    expect(t.plus.disabled).toBe(true);
  });

  it('blokady z modelu widoku (AND) i pusta pula', () => {
    const s = setup('20', 246, { canIncrement: false, canDecrement: false });
    expect(s.plus.disabled).toBe(true);
    expect(s.minus.disabled).toBe(true);
    cleanup();
    const e = setup('20', 0);
    expect(e.plus.disabled).toBe(true);
    expect(e.minus.disabled).toBe(true);
    for (const n of [20, 30, 40, 50, 60]) expect(e.chip(n).disabled).toBe(true);
  });

  it('wpis z klawiatury przekazuje tekst (maks. 6 znaków)', () => {
    const s = setup('20', 246);
    fireEvent.change(s.input, { target: { value: '1234567' } });
    expect(s.onChange).toHaveBeenCalledWith('123456');
  });

  it('błąd przy polu: role="alert", aria-invalid, działania naprawcze', () => {
    const fix = vi.fn();
    render(<NumberStepper value="0" capacity={246} onChange={() => undefined} error="Liczba pytań musi być większa od zera." fixes={[{ label: 'Ustaw 20', onClick: fix }]} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Liczba pytań musi być większa od zera.');
    const input = screen.getByRole('textbox', { name: 'Liczba pytań' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    fireEvent.click(screen.getByRole('button', { name: 'Ustaw 20' }));
    expect(fix).toHaveBeenCalledTimes(1);
    // Przy błędzie żaden skrót nie jest oznaczony jako wybrany.
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('parseWholeNumber akceptuje tylko cyfry', () => {
    expect(parseWholeNumber('25')).toBe(25);
    expect(parseWholeNumber(' 7 ')).toBe(7);
    expect(parseWholeNumber('12,5')).toBeNull();
    expect(parseWholeNumber('-5')).toBeNull();
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('abc')).toBeNull();
  });
});
