/**
 * Hooki interfejsu: pułapka fokusu z powrotem do wywołującego elementu (arkusze, okna dialogowe,
 * powiększenie schematu — PRZEKAZANIE §13), preferencja ograniczenia ruchu, łagodne przewinięcie.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert], [hidden]') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Aktywne pułapki fokusu (najnowsza na końcu) — klawisze i fokus obsługuje tylko najwyższa. */
const trapStack: HTMLElement[] = [];

/**
 * Pułapka fokusu (PRZEKAZANIE §13): po otwarciu fokus trafia do pierwszego elementu (albo
 * `initialFocus`), Tab/Shift+Tab krąży w kontenerze, Escape wywołuje `onEscape`, a po zamknięciu
 * fokus wraca do elementu aktywnego przed otwarciem.
 *
 * Każde Tab jest obsługiwane ręcznie (`preventDefault` + następny element z listy, z zawijaniem):
 * WebKit/Safari domyślnie pomija przyciski przy Tab, więc poleganie na domyślnej nawigacji
 * wyprowadzało fokus do tła. Nasłuch `keydown` i `focusin` jest na `document` (faza capture), więc
 * Escape działa także wtedy, gdy fokus jakoś opuścił dialog, a fokus przeniesiony poza dialog wraca do niego.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: { onEscape?: () => void; initialFocus?: RefObject<HTMLElement | null> } = {},
): void {
  const onEscapeRef = useRef(options.onEscape);
  onEscapeRef.current = options.onEscape;
  const initialFocus = options.initialFocus;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Na stos PRZED przeniesieniem fokusu — inaczej pułapka niżej uznałaby fokus za ucieczkę.
    trapStack.push(container);
    const isTop = (): boolean => trapStack[trapStack.length - 1] === container;
    const first = initialFocus?.current ?? focusableIn(container)[0] ?? container;
    first.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const items = focusableIn(container);
      if (items.length === 0) {
        container.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next =
        index < 0
          ? event.shiftKey
            ? items.length - 1
            : 0
          : event.shiftKey
            ? (index - 1 + items.length) % items.length
            : (index + 1) % items.length;
      (items[next] as HTMLElement).focus();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop()) return;
      const target = event.target;
      if (target instanceof Node && !container.contains(target)) {
        (focusableIn(container)[0] ?? container).focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      const i = trapStack.lastIndexOf(container);
      if (i >= 0) trapStack.splice(i, 1);
      if (returnTo && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [containerRef, initialFocus]);
}

/** `prefers-reduced-motion: reduce` (bez matchMedia — np. w testach — przyjmuje brak preferencji). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * Łagodne przewinięcie do wyjaśnienia po odpowiedzi (PRZEKAZANIE §8): maks. ~260 px,
 * bez animacji przy `prefers-reduced-motion`. Nie przewija, gdy wyjaśnienie jest już widoczne.
 */
export function gentleScrollTo(scroller: HTMLElement | null, target: HTMLElement | null, maxPx = 260): void {
  if (!scroller || !target) return;
  const distance = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const delta = Math.min(distance - scroller.clientHeight * 0.55, maxPx);
  if (!(delta > 8)) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: delta, behavior });
  else scroller.scrollTop += delta;
}

/** Czy aplikacja działa jako zainstalowana PWA (wtedy wskazówka instalacji nie ma sensu). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}
