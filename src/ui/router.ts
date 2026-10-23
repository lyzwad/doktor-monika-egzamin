/**
 * Routing hash (DECYZJE §11): `#/…` — odświeżenie dowolnego ekranu na GitHub Pages nie daje 404.
 * Format tras: src/app/routes.ts (`parseHash` / `routeToHash`).
 *
 * `bindHashRouting` synchronizuje `location.hash` z trasą kontrolera w obie strony:
 * - zmiana trasy w kontrolerze → nowy wpis historii przeglądarki (`pushState`, bez `hashchange`),
 *   przekierowanie po wejściu z adresu (np. nieistniejąca sesja → start) → `replaceState`;
 * - `hashchange` (Wstecz/Dalej przeglądarki, ręczna zmiana adresu) → `controller.navigate(route)`.
 *
 * Używać dla kontrolera, który sam nie obsługuje hasha (mock w trybie deweloperskim). Kontroler
 * rzeczywisty synchronizuje hash przez `Platform` (src/app/controller.ts) — wtedy nie wiązać drugi raz.
 * Wywołać po `controller.start()`.
 */
import type { AppController } from '../app/controller';
import { parseHash, routeToHash, sameRoute, type Route } from '../app/routes';

export interface HashWindow {
  location: { hash: string };
  history: Pick<History, 'pushState' | 'replaceState'>;
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

export function bindHashRouting(controller: AppController, win: HashWindow = window): () => void {
  let lastRoute: Route = controller.getState().route;
  let fromHash = false;

  const write = (route: Route, mode: 'push' | 'replace') => {
    const hash = routeToHash(route);
    if (win.location.hash === hash) return;
    if (mode === 'push') win.history.pushState(null, '', hash);
    else win.history.replaceState(null, '', hash);
  };

  const onState = () => {
    const route = controller.getState().route;
    if (route === lastRoute || sameRoute(route, lastRoute)) {
      lastRoute = route;
      return;
    }
    lastRoute = route;
    write(route, fromHash ? 'replace' : 'push');
  };

  const applyHash = () => {
    const target = parseHash(win.location.hash);
    if (sameRoute(target, controller.getState().route)) return;
    fromHash = true;
    try {
      controller.navigate(target);
    } finally {
      fromHash = false;
    }
    // Kontroler mógł przekierować (np. trasa do zamkniętej sesji → start): adres = rzeczywista trasa.
    const actual = controller.getState().route;
    lastRoute = actual;
    if (!sameRoute(actual, target)) write(actual, 'replace');
  };

  const unsubscribe = controller.subscribe(onState);
  win.addEventListener('hashchange', applyHash);

  // Wejście: adres z hashem (np. odświeżenie ekranu pomocniczego) albo zapis trasy startowej.
  if (win.location.hash && win.location.hash !== '#' && win.location.hash !== '#/') applyHash();
  else write(controller.getState().route, 'replace');

  return () => {
    unsubscribe();
    win.removeEventListener('hashchange', applyHash);
  };
}
