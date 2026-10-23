/**
 * Hooki UI: łagodne przewinięcie (≤ 260 px, bez animacji przy reduced motion), pułapka fokusu
 * (Tab krąży w dialogu, Escape zamyka, fokus wraca do wywołującego elementu).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gentleScrollTo, useFocusTrap } from '../../src/ui/hooks';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function scroller(top: number, clientHeight: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
  const scrollBy = vi.fn();
  (el as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
  return { el, scrollBy };
}

function target(top: number) {
  const el = document.createElement('section');
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
  return el;
}

describe('gentleScrollTo', () => {
  it('przewija maksymalnie 260 px, płynnie', () => {
    const s = scroller(56, 700);
    gentleScrollTo(s.el, target(1400));
    expect(s.scrollBy).toHaveBeenCalledWith({ top: 260, behavior: 'smooth' });
  });

  it('krótszy dystans: wyjaśnienie na ok. 55% wysokości', () => {
    const s = scroller(0, 600);
    gentleScrollTo(s.el, target(400));
    expect(s.scrollBy).toHaveBeenCalledWith({ top: 70, behavior: 'smooth' });
  });

  it('wyjaśnienie już widoczne — bez przewijania', () => {
    const s = scroller(0, 800);
    gentleScrollTo(s.el, target(300));
    expect(s.scrollBy).not.toHaveBeenCalled();
  });

  it('prefers-reduced-motion: bez animacji', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const s = scroller(0, 600);
    gentleScrollTo(s.el, target(2000));
    expect(s.scrollBy).toHaveBeenCalledWith({ top: 260, behavior: 'auto' });
  });
});

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { onEscape: onClose });
  return (
    <div ref={ref} role="dialog" aria-label="Test" tabIndex={-1}>
      <button type="button">Pierwszy</button>
      <button type="button">Drugi</button>
      <button type="button" onClick={onClose}>
        Zamknij
      </button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Otwórz
      </button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

describe('useFocusTrap', () => {
  it('fokus na pierwszym elemencie, Tab krąży, Escape zamyka i przywraca fokus', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Otwórz' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement?.textContent).toBe('Pierwszy');
    screen.getByRole('button', { name: 'Zamknij' }).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Pierwszy');
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Zamknij');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

/**
 * UI-02 (WebKit): Safari domyślnie pomija przyciski przy Tab, więc pułapka musi przenosić fokus
 * sama przy KAŻDYM Tab (nie tylko na krańcach), a Escape i powrót fokusu działać także wtedy,
 * gdy fokus opuścił dialog. jsdom — jak WebKit — nie wykonuje domyślnej nawigacji Tab.
 */
describe('useFocusTrap — ręczna nawigacja Tab i nasłuch na dokumencie (WebKit)', () => {
  function Page() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Otwórz
        </button>
        <input aria-label="Pole w tle" />
        {open ? <Dialog onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  it('Tab ze środkowego elementu przechodzi do następnego w dialogu (bez domyślnej nawigacji)', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
    expect(document.activeElement?.textContent).toBe('Pierwszy');
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    (document.activeElement as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('Drugi');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Zamknij');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Drugi');
  });

  it('fokus przeniesiony do tła wraca do dialogu; Escape zamyka także z tła i oddaje fokus', () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Otwórz' });
    opener.focus();
    fireEvent.click(opener);
    const background = screen.getByRole('textbox', { name: 'Pole w tle' });
    background.focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('zagnieżdżone pułapki: klawisze obsługuje tylko najwyższa, po jej zamknięciu wraca niższa', () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      const outerRef = useRef<HTMLDivElement>(null);
      useFocusTrap(outerRef, { onEscape: () => setOuter(false) });
      return outer ? (
        <div ref={outerRef} role="dialog" aria-label="Zewnętrzny" tabIndex={-1}>
          <button type="button" onClick={() => setInner(true)}>
            Powiększ
          </button>
          <button type="button">Dalej w arkuszu</button>
          {inner ? <InnerDialog onClose={() => setInner(false)} /> : null}
        </div>
      ) : null;
    }
    function InnerDialog({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, { onEscape: onClose });
      return (
        <div ref={ref} role="dialog" aria-label="Wewnętrzny" tabIndex={-1}>
          <button type="button">Zamknij powiększenie</button>
        </div>
      );
    }
    render(<Nested />);
    const zoom = screen.getByRole('button', { name: 'Powiększ' });
    expect(document.activeElement).toBe(zoom);
    fireEvent.click(zoom);
    expect(document.activeElement?.textContent).toBe('Zamknij powiększenie');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Zamknij powiększenie');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Wewnętrzny' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Zewnętrzny' })).toBeTruthy();
    expect(document.activeElement).toBe(zoom);
    fireEvent.keyDown(zoom, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Zewnętrzny' })).toBeNull();
  });
});
