/**
 * Routing hash (DECYZJE §11): synchronizacja `location.hash` ↔ trasa kontrolera (mock).
 */
import { describe, expect, it } from 'vitest';
import { bindHashRouting, type HashWindow } from '../../src/ui/router';
import { correctOptionId, startedMock } from './helpers';

function fakeWindow(initialHash: string) {
  const listeners = new Set<() => void>();
  const log: Array<{ mode: 'push' | 'replace'; hash: string }> = [];
  const win: HashWindow & { log: typeof log; go: (hash: string) => void } = {
    location: { hash: initialHash },
    history: {
      pushState: (_d: unknown, _t: string, url?: string | URL | null) => {
        win.location.hash = String(url);
        log.push({ mode: 'push', hash: String(url) });
      },
      replaceState: (_d: unknown, _t: string, url?: string | URL | null) => {
        win.location.hash = String(url);
        log.push({ mode: 'replace', hash: String(url) });
      },
    },
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    log,
    go: (hash: string) => {
      win.location.hash = hash;
      for (const l of [...listeners]) l();
    },
  };
  return win;
}

describe('bindHashRouting', () => {
  it('bez hasha zapisuje trasę startową (replace); akcje dodają wpisy historii (push)', async () => {
    const c = await startedMock();
    const win = fakeWindow('');
    const unbind = bindHashRouting(c, win);
    expect(win.log).toEqual([{ mode: 'replace', hash: '#/' }]);
    c.openSettings();
    c.openAbout();
    expect(win.log.slice(1)).toEqual([
      { mode: 'push', hash: '#/ustawienia' },
      { mode: 'push', hash: '#/ustawienia/o-bazie' },
    ]);
    unbind();
    c.goHome();
    expect(win.log).toHaveLength(3);
  });

  it('odświeżenie ekranu pomocniczego: hash → trasa kontrolera', async () => {
    const c = await startedMock();
    const win = fakeWindow('#/historia/free-flow');
    bindHashRouting(c, win);
    expect(c.getState().route).toEqual({ name: 'history', tab: 'freeflow' });
    expect(win.log).toEqual([]);
  });

  it('Wstecz przeglądarki (hashchange) nawiguje; przekierowanie kontrolera zapisuje rzeczywistą trasę (replace)', async () => {
    const c = await startedMock();
    const win = fakeWindow('');
    bindHashRouting(c, win);
    c.openConfig('test');
    await c.startTest();
    await c.answer(correctOptionId(c));
    const sessionHash = win.location.hash;
    expect(sessionHash.startsWith('#/sesja/')).toBe(true);
    win.go('#/test');
    expect(c.getState().route).toEqual({ name: 'config', mode: 'test' });
    win.go('#/sesja/nie-istnieje');
    expect(c.getState().route).toEqual({ name: 'home' });
    expect(win.log.at(-1)).toEqual({ mode: 'replace', hash: '#/' });
    win.go('#/nieznany/adres');
    expect(c.getState().route).toEqual({ name: 'home' });
  });
});
