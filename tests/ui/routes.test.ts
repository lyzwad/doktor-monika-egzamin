import { describe, expect, it } from 'vitest';
import { parseHash, routeToHash, type Route } from '../../src/app/routes';

const ROUTES: Route[] = [
  { name: 'home' },
  { name: 'config', mode: 'test' },
  { name: 'config', mode: 'freeflow' },
  { name: 'question', sessionId: 'a1b2-c3' },
  { name: 'result', sessionId: 's1', origin: 'session' },
  { name: 'result', sessionId: 's1', origin: 'history' },
  { name: 'review', sessionId: 's1', filter: 'all' },
  { name: 'review', sessionId: 's1', filter: 'wrong' },
  { name: 'reviewItem', sessionId: 's1', slotId: 'slot/1 ż', filter: 'wrong' },
  { name: 'freeflowSummary', sessionId: 'f1', origin: 'history' },
  { name: 'history', tab: 'tests' },
  { name: 'history', tab: 'freeflow' },
  { name: 'settings' },
  { name: 'backup' },
  { name: 'poolImport' },
  { name: 'excluded' },
  { name: 'about' },
];

describe('routing hash', () => {
  it.each(ROUTES.map((r) => [routeToHash(r), r] as const))('%s ↔ trasa', (hash, route) => {
    expect(hash.startsWith('#/')).toBe(true);
    expect(parseHash(hash)).toEqual(route);
  });

  it.each(['', '#', '#/', '#/nieznane', '#/sesja', '#/sesja/', '#/ustawienia/x', '#/przeglad/%E0%A4%A', '#/historia/x/y'])(
    'nieznany lub uszkodzony hash %s → start',
    (hash) => {
      expect(parseHash(hash)).toEqual({ name: 'home' });
    },
  );
});
