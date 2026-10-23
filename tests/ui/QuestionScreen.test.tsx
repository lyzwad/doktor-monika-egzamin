/**
 * Ekran pytania z mockiem kontrolera (B03–B06, C03, E02, E05, S14, S15, S24f):
 * brak klucza przed odpowiedzią (DOM, alt, title, aria), jedno wywołanie kontrolera przy podwójnym
 * dotknięciu, stany po ocenie, ręczne „Dalej”, brak procentu na żywo, podgląd tylko do odczytu,
 * wyjście przez arkusz, zgłoszenie z „Cofnij”, błąd zapisu z ponowieniem.
 */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correctOptionId, currentSnapshot, domDump, questionVM, renderApp, startedMock } from './helpers';

afterEach(cleanup);

async function startTest() {
  const c = await startedMock();
  c.openConfig('test');
  await c.startTest();
  return c;
}

function answerButtons() {
  return within(screen.getByRole('list', { name: 'Warianty odpowiedzi' })).queryAllByRole('button');
}

describe('QuestionScreen — przed odpowiedzią', () => {
  it('brak klucza, wyjaśnienia i źródeł w DOM oraz atrybutach; nagłówek 0/20 bez procentu', async () => {
    const c = await startTest();
    const snap = currentSnapshot(c);
    const { container } = await renderApp(c);
    const dump = domDump(container);
    expect(dump).not.toContain(snap.explanation);
    for (const s of snap.sources) expect(dump).not.toContain(s.title);
    expect(dump).not.toMatch(/Poprawna odpowiedź|Twoja odpowiedź|Dlaczego ta odpowiedź|Źródła/);
    expect(dump).not.toMatch(/correct|poprawn/i);
    expect(screen.queryByRole('region', { name: 'Wyjaśnienie poprawnej odpowiedzi' })).toBeNull();
    // Postęp bez procentu na żywo.
    expect(screen.getByText('0/20')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Ocenione pytania' }).getAttribute('aria-valuenow')).toBe('0');
    expect(container.textContent ?? '').not.toMatch(/\d+\s?%/);
    // Flaga 44×44 z etykietą i podpowiedź zamiast „Dalej”.
    expect(screen.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).className).toContain('icon-btn');
    expect(screen.getByText('Dotknij odpowiedzi, aby ją zatwierdzić.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Dalej/ })).toBeNull();
    expect(answerButtons()).toHaveLength(4);
    expect(screen.getByText(snap.stem)).toBeTruthy();
  });

  it('podwójne dotknięcie: kontroler wywołany raz; po ocenie karty nie są przyciskami', async () => {
    const c = await startTest();
    const spy = vi.spyOn(c, 'answer');
    await renderApp(c);
    const correct = correctOptionId(c);
    const vm = questionVM(c);
    const wrongIndex = vm.answers.findIndex((a) => a.optionId !== correct);
    const buttons = answerButtons();
    await act(async () => {
      fireEvent.click(buttons[wrongIndex] as HTMLElement);
      fireEvent.click(buttons[wrongIndex] as HTMLElement);
      fireEvent.click(buttons[(wrongIndex + 1) % 4] as HTMLElement);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(answerButtons()).toHaveLength(0);
    expect(screen.getByText('Twoja odpowiedź — błędna')).toBeTruthy();
    expect(screen.getByText('Poprawna odpowiedź')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Wyjaśnienie poprawnej odpowiedzi' })).toBeTruthy();
    expect(screen.getByText('Dlaczego ta odpowiedź jest poprawna')).toBeTruthy();
    expect(screen.getByText('1/20')).toBeTruthy();
    // Komunikat poprawności przez role=status (bez przejmowania fokusu).
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Odpowiedź błędna.'))).toBe(true);
    // Wynik nie zmienia się po kolejnym dotknięciu.
    fireEvent.click(screen.getByText(vm.answers[(wrongIndex + 1) % 4]?.text ?? ''));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(questionVM(c).correct).toBe(false);
  });

  it('„Dalej” ręczne → kolejne pytanie; „‹” → podgląd tylko do odczytu z „Do bieżącego”', async () => {
    const c = await startTest();
    await renderApp(c);
    await act(async () => {
      fireEvent.click(answerButtons()[0] as HTMLElement);
    });
    const first = questionVM(c).slotId;
    expect(questionVM(c).slotId).toBe(first);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Dalej/ }));
    });
    expect(questionVM(c).slotId).not.toBe(first);
    expect(questionVM(c).position).toBe(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Poprzednie pytanie' }));
    });
    expect(questionVM(c).mode).toBe('preview');
    expect(screen.getByText('Podgląd odpowiedzi')).toBeTruthy();
    expect(screen.getByText(/Pytanie 1 z 20 · zapisany wybór/)).toBeTruthy();
    expect(answerButtons()).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Do bieżącego' }));
    });
    expect(questionVM(c).mode).toBe('live');
    expect(questionVM(c).position).toBe(1);
  });

  it('ostatnie pytanie: „Pokaż wynik” zamiast „Dalej”, wynik dopiero po naciśnięciu', async () => {
    const c = await startTest();
    for (let i = 0; i < 19; i++) {
      await c.answer(correctOptionId(c));
      await c.next();
    }
    await renderApp(c);
    await act(async () => {
      fireEvent.click(answerButtons()[0] as HTMLElement);
    });
    expect(screen.queryByRole('button', { name: /Dalej/ })).toBeNull();
    expect(screen.getByText('Dlaczego ta odpowiedź jest poprawna')).toBeTruthy();
    expect(c.getState().screen?.name).toBe('question');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Pokaż wynik/ }));
    });
    expect(c.getState().screen?.name).toBe('result');
    expect(screen.getByRole('heading', { name: 'Wynik testu' })).toBeTruthy();
    expect(screen.getByText(/65% — co najmniej 13 z 20/)).toBeTruthy();
  });
});

describe('QuestionScreen — wyjście, zgłoszenie, błąd zapisu', () => {
  it('✕ otwiera arkusz (role=dialog) z „Kontynuuj później”; fokus wraca do ✕ po zamknięciu', async () => {
    const c = await startTest();
    await renderApp(c);
    const close = screen.getByRole('button', { name: 'Przerwij test' });
    close.focus();
    fireEvent.click(close);
    const dialog = screen.getByRole('dialog', { name: 'Przerwać test?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć do pytania' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(close);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj później' }));
    });
    expect(c.getState().screen?.name).toBe('home');
    expect(screen.getByText('Kontynuuj test')).toBeTruthy();
    expect(screen.getByText('0/20 pytań')).toBeTruthy();
  });

  it('„Zamknij test bez wyniku” wymaga potwierdzenia (alertdialog)', async () => {
    const c = await startTest();
    await renderApp(c);
    fireEvent.click(screen.getByRole('button', { name: 'Przerwij test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij test bez wyniku' }));
    const alert = screen.getByRole('alertdialog', { name: 'Zamknąć test bez wyniku?' });
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Zamknij test' }));
    });
    expect(c.getState().screen?.name).toBe('home');
    expect(screen.getByRole('status').textContent).toContain('Test zamknięty bez wyniku');
  });

  it('zgłoszenie: toast z „Cofnij” w dolnym pasku (role=status); „Cofnij” przywraca pytanie', async () => {
    const c = await startTest();
    await renderApp(c);
    const original = questionVM(c).slotId;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }));
    });
    expect(questionVM(c).slotId).not.toBe(original);
    const toast = screen.getAllByRole('status').find((el) => el.textContent?.includes('Pytanie wykluczone. Zastąpiliśmy je innym.'));
    expect(toast).toBeTruthy();
    expect(screen.getByText('0/20')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(toast as HTMLElement).getByRole('button', { name: 'Cofnij' }));
    });
    expect(questionVM(c).slotId).toBe(original);
    expect(screen.getByText('Zgłoszenie cofnięte. Przywrócono poprzedni stan pytania.')).toBeTruthy();
  });

  it('błąd zapisu odpowiedzi: role=alert, karta „niezapisana”, „Spróbuj zapisać ponownie” ponawia', async () => {
    const c = await startTest();
    await renderApp(c);
    act(() => c.simulate({ saveFailure: true }));
    await act(async () => {
      fireEvent.click(answerButtons()[0] as HTMLElement);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Odpowiedź nie została zapisana.');
    expect(screen.getByText('Wybrana — niezapisana')).toBeTruthy();
    expect(screen.queryByText('Dlaczego ta odpowiedź jest poprawna')).toBeNull();
    act(() => c.simulate({ saveFailure: false }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Spróbuj zapisać ponownie' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Dlaczego ta odpowiedź jest poprawna')).toBeTruthy();
    expect(screen.getByText('1/20')).toBeTruthy();
  });

  it('niezapisana odpowiedź po zgłoszeniu: „Cofnij” znika (nie da się cofnąć przed dokończeniem zapisu)', async () => {
    const c = await startTest();
    await renderApp(c);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }));
    });
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeTruthy();
    act(() => c.simulate({ saveFailure: true }));
    await act(async () => {
      fireEvent.click(answerButtons()[0] as HTMLElement);
    });
    expect(screen.getByRole('alert').textContent).toContain('Odpowiedź nie została zapisana.');
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Spróbuj zapisać ponownie' })).toBeTruthy();
  });

  it('offline: baner w pytaniu, nauka działa', async () => {
    const c = await startTest();
    c.simulate({ offline: true });
    await renderApp(c);
    expect(screen.getByText(/Brak internetu. Pytania, objaśnienia i schematy działają/)).toBeTruthy();
    expect(answerButtons()).toHaveLength(4);
  });
});

describe('QuestionScreen — Free Flow i przegląd', () => {
  it('Free Flow: „Pytanie 1”, bez paska postępu; wyjście przez arkusz „Wyjść z Free Flow?” → podsumowanie', async () => {
    const c = await startedMock();
    c.openConfig('freeflow');
    await c.startFreeFlow();
    await renderApp(c);
    expect(screen.getByText('Pytanie 1')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await act(async () => {
      fireEvent.click(answerButtons()[0] as HTMLElement);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }));
    const dialog = screen.getByRole('dialog', { name: 'Wyjść z Free Flow?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Zakończ sesję' }));
    });
    expect(screen.getByText('Sesja zakończona')).toBeTruthy();
    expect(screen.getByText(/Poprawne: \d z 1/)).toBeTruthy();
    expect(screen.queryByText(/Próg/)).toBeNull();
  });

  it('przegląd ukończonego testu: szczegół tylko do odczytu, „Następne” i „Wróć do listy”', async () => {
    const c = await startTest();
    for (let i = 0; i < 20; i++) {
      await c.answer(correctOptionId(c));
      if (i < 19) await c.next();
    }
    await c.showResult();
    await renderApp(c);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Przejrzyj odpowiedzi' }));
    });
    expect(screen.getByRole('heading', { name: 'Przegląd odpowiedzi' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Wszystkie · 20' }).getAttribute('aria-checked')).toBe('true');
    const rows = within(screen.getByRole('list', { name: 'Pozycje przeglądu' })).getAllByRole('button');
    expect(rows).toHaveLength(20);
    await act(async () => {
      fireEvent.click(rows[0] as HTMLElement);
    });
    expect(questionVM(c).mode).toBe('review');
    expect(screen.getByText('Pytanie 1 z 20')).toBeTruthy();
    expect(screen.getByText(/Test z \d{2}\.\d{2}\.\d{4} · tylko do odczytu/)).toBeTruthy();
    expect(answerButtons()).toHaveLength(0);
    expect(screen.getByText('Twoja odpowiedź — poprawna')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Następne/ }));
    });
    expect(screen.getByText('Pytanie 2 z 20')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Poprzednie pytanie' }));
    });
    expect(screen.getByText('Pytanie 1 z 20')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Wróć do listy' }));
    });
    expect(screen.getByRole('heading', { name: 'Przegląd odpowiedzi' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Tylko błędy · 0' }));
    });
    expect(screen.getByText('W tej rundzie nie było błędnych odpowiedzi')).toBeTruthy();
  });
});
