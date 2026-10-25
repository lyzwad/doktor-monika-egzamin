import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_EMAILS } from '../../src/profiles/profiles';
import { AssignUnassignedScreen, ProfilePickerScreen, unassignedText } from '../../src/ui/screens/ProfileScreens';

afterEach(cleanup);

const SUMMARY = { completedTests: 3, unfinishedTests: 0, freeFlowSessions: 1, openSessions: 1, attempts: 40, lastActivityAt: '2026-10-24T18:00:00.000Z' };

describe('Wybierz profil', () => {
  it('9 adresów w kolejności z listy, ostatni oznaczony; dotknięcie wybiera profil; bez logowania i hasła', () => {
    const onChoose = vi.fn();
    render(<ProfilePickerScreen profiles={PROFILE_EMAILS} last="iza@doktormonika.pl" unassigned={null} busy={false} messagePl={null} onChoose={onChoose} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeTruthy();
    const rows = screen.getAllByRole('button');
    expect(rows.map((b) => b.textContent?.replace('ostatnio', ''))).toEqual([...PROFILE_EMAILS]);
    expect(rows[2]!.textContent).toContain('ostatnio');
    fireEvent.click(rows[1]!);
    expect(onChoose).toHaveBeenCalledWith('monika@doktormonika.pl');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/To nie jest logowanie/);
    expect(text).not.toMatch(/zaloguj|hasło:|rejestr|weryfik/i);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('historia bez profilu: podsumowanie bez treści pytań i informacja o decyzji', () => {
    render(<ProfilePickerScreen profiles={PROFILE_EMAILS} last={null} unassigned={SUMMARY} busy={false} messagePl={null} onChoose={() => undefined} />);
    expect(screen.getByRole('note').textContent).toContain('3 ukończone testy, 1 sesja Free Flow, 1 rozpoczęta sesja; ostatnio');
    expect(unassignedText({ ...SUMMARY, completedTests: 0, freeFlowSessions: 0, openSessions: 0 })).toBe('40 odpowiedzi; ostatnio 24.10.2026');
  });

  it('decyzja: „Przypisz do tego profilu” i „Nie teraz” (bez usuwania historii)', () => {
    const onAssign = vi.fn();
    const onDefer = vi.fn();
    render(<AssignUnassignedScreen email="ola@doktormonika.pl" unassigned={SUMMARY} busy={false} messagePl={null} onAssign={onAssign} onDefer={onDefer} onBack={() => undefined} />);
    expect(document.body.textContent).toContain('ola@doktormonika.pl');
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz do tego profilu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nie teraz — zostaw bez profilu' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('nie usuwa tej historii');
  });
});
