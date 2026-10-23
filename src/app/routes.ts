/**
 * Trasy aplikacji i routing hash (`#/…`, DECYZJE §11): odświeżenie dowolnego ekranu na
 * GitHub Pages nie daje 404. Nawigacja wg PRZEKAZANIE §7.
 */
import type { SessionId, SessionKind, SlotId } from '../domain/types';

export type ReviewFilter = 'all' | 'wrong';
export type HistoryTab = 'tests' | 'freeflow';
/** Skąd otwarto wynik/podsumowanie: zaraz po zakończeniu sesji czy z historii (inne „Wstecz”). */
export type ResultOrigin = 'session' | 'history';

export type Route =
  /** S01–S02 */
  | { name: 'home' }
  /** S03–S05 */
  | { name: 'config'; mode: SessionKind }
  /** S06–S15, S24 — otwarta sesja (pozycję pokazywaną trzyma kontroler). */
  | { name: 'question'; sessionId: SessionId }
  /** S16 */
  | { name: 'result'; sessionId: SessionId; origin: ResultOrigin }
  /** S17 lista */
  | { name: 'review'; sessionId: SessionId; filter: ReviewFilter }
  /** S17 szczegół (tylko do odczytu; zgłoszenie = „Wykluczone później”). */
  | { name: 'reviewItem'; sessionId: SessionId; slotId: SlotId; filter: ReviewFilter }
  /** S19 */
  | { name: 'freeflowSummary'; sessionId: SessionId; origin: ResultOrigin }
  /** S20 */
  | { name: 'history'; tab: HistoryTab }
  /** S21a */
  | { name: 'settings' }
  /** S22 kopia */
  | { name: 'backup' }
  /** S22 import puli */
  | { name: 'poolImport' }
  /** S23 */
  | { name: 'excluded' }
  /** S21b */
  | { name: 'about' };

export type RouteName = Route['name'];

export const HOME_ROUTE: Route = { name: 'home' };

const enc = encodeURIComponent;

function withQuery(path: string, query: Record<string, string | null>): string {
  const parts = Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([k, v]) => `${enc(k)}=${enc(v)}`);
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

/** Trasa → hash (z `#`). */
export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'config':
      return route.mode === 'test' ? '#/test' : '#/free-flow';
    case 'question':
      return `#/sesja/${enc(route.sessionId)}`;
    case 'result':
      return withQuery(`#/wynik/${enc(route.sessionId)}`, { z: route.origin === 'history' ? 'historia' : null });
    case 'review':
      return withQuery(`#/przeglad/${enc(route.sessionId)}`, { filtr: route.filter === 'wrong' ? 'bledy' : null });
    case 'reviewItem':
      return withQuery(`#/przeglad/${enc(route.sessionId)}/${enc(route.slotId)}`, {
        filtr: route.filter === 'wrong' ? 'bledy' : null,
      });
    case 'freeflowSummary':
      return withQuery(`#/podsumowanie/${enc(route.sessionId)}`, { z: route.origin === 'history' ? 'historia' : null });
    case 'history':
      return route.tab === 'freeflow' ? '#/historia/free-flow' : '#/historia';
    case 'settings':
      return '#/ustawienia';
    case 'backup':
      return '#/ustawienia/kopia';
    case 'poolImport':
      return '#/ustawienia/import-puli';
    case 'excluded':
      return '#/ustawienia/wykluczone';
    case 'about':
      return '#/ustawienia/o-bazie';
  }
}

function safeDecode(part: string): string | null {
  try {
    const value = decodeURIComponent(part);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Hash → trasa. Nieznany lub uszkodzony hash → ekran startowy. */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  const query = new Map<string, string>();
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const [k = '', v = ''] = pair.split('=', 2);
    const key = safeDecode(k);
    const value = safeDecode(v);
    if (key !== null && value !== null) query.set(key, value);
  }
  const segments = pathPart.split('/').filter((s) => s.length > 0);
  const [head, a, b] = segments;
  const origin = query.get('z') === 'historia' ? 'history' : 'session';
  const filter: ReviewFilter = query.get('filtr') === 'bledy' ? 'wrong' : 'all';

  switch (head) {
    case undefined:
      return HOME_ROUTE;
    case 'test':
      return segments.length === 1 ? { name: 'config', mode: 'test' } : HOME_ROUTE;
    case 'free-flow':
      return segments.length === 1 ? { name: 'config', mode: 'freeflow' } : HOME_ROUTE;
    case 'sesja': {
      const id = a ? safeDecode(a) : null;
      return id && segments.length === 2 ? { name: 'question', sessionId: id } : HOME_ROUTE;
    }
    case 'wynik': {
      const id = a ? safeDecode(a) : null;
      return id && segments.length === 2 ? { name: 'result', sessionId: id, origin } : HOME_ROUTE;
    }
    case 'podsumowanie': {
      const id = a ? safeDecode(a) : null;
      return id && segments.length === 2 ? { name: 'freeflowSummary', sessionId: id, origin } : HOME_ROUTE;
    }
    case 'przeglad': {
      const id = a ? safeDecode(a) : null;
      if (!id) return HOME_ROUTE;
      if (segments.length === 2) return { name: 'review', sessionId: id, filter };
      const slotId = b ? safeDecode(b) : null;
      return slotId && segments.length === 3 ? { name: 'reviewItem', sessionId: id, slotId, filter } : HOME_ROUTE;
    }
    case 'historia':
      if (segments.length === 1) return { name: 'history', tab: 'tests' };
      return a === 'free-flow' && segments.length === 2 ? { name: 'history', tab: 'freeflow' } : HOME_ROUTE;
    case 'ustawienia':
      if (segments.length === 1) return { name: 'settings' };
      if (segments.length !== 2) return HOME_ROUTE;
      switch (a) {
        case 'kopia':
          return { name: 'backup' };
        case 'import-puli':
          return { name: 'poolImport' };
        case 'wykluczone':
          return { name: 'excluded' };
        case 'o-bazie':
          return { name: 'about' };
        default:
          return HOME_ROUTE;
      }
    default:
      return HOME_ROUTE;
  }
}

/** Porównanie tras (np. aby nie dublować wpisów historii przeglądarki). */
export function sameRoute(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}
