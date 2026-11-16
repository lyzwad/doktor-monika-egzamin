/**
 * Zakres „Webinar” (CAP-8) w prawdziwym kontrolerze (silnik domeny + IndexedDB, bieżące wydanie „V18 + webinary”):
 * opcja na końcu listy „Zakres” (Test i Free Flow), sesje wyłącznie z pytań WB, ostatnia konfiguracja i historia
 * po ponownym uruchomieniu aplikacji (ta sama baza), karta przerwanej sesji.
 */
import { describe, expect, it } from 'vitest';
import { scopeListOf } from '../../src/app/screenModels';
import type { ConfigVM, HistoryVM, HomeVM } from '../../src/app/viewModels';
import { currentCatalog } from '../content';
import { catalogOf, grid } from '../domain/helpers';
import { keyOf, openSession, question, settle, startHarness, userState, type Harness } from './harness';

const WEBINAR_OPTION = { scope: 'WEBINAR', title: 'Webinar', capacity: 247, questionCount: 247 };

function configScreen(h: Harness): ConfigVM {
  const s = h.controller.getState().screen;
  if (s?.name !== 'config') throw new Error(`oczekiwano konfiguracji, jest ${s?.name ?? 'null'}`);
  return s;
}

function historyScreen(h: Harness): HistoryVM {
  const s = h.controller.getState().screen;
  if (s?.name !== 'history') throw new Error(`oczekiwano historii, jest ${s?.name ?? 'null'}`);
  return s;
}

/** Odpowiada poprawnie na bieżące pytanie; sprawdza, że to pytanie WB z dowodem webinaru po odpowiedzi. */
async function answerWebinarQuestion(h: Harness): Promise<void> {
  const q = question(h.controller);
  const slot = openSession(h.controller).slots[q.slotId];
  expect(slot?.questionId).toMatch(/^WB-/);
  expect(q.stem.trimEnd().endsWith('[webinar]')).toBe(true);
  expect(await h.controller.answer(keyOf(h.controller))).toEqual({ ok: true });
  expect(question(h.controller).explanation?.webinarEvidence).not.toBeNull();
}

describe('zakres „Webinar” — lista „Zakres”', () => {
  it('opcja Webinar tylko dla katalogu z pytaniami z webinarów (katalog wydania — na końcu; katalog bez WB — brak)', () => {
    const release = scopeListOf(currentCatalog());
    expect(release.at(-1)).toBe('WEBINAR');
    expect(release.filter((s) => s === 'WEBINAR')).toHaveLength(1);
    const noWb = scopeListOf(catalogOf(grid(2)));
    expect(noWb).not.toContain('WEBINAR');
    expect(noWb).toEqual(['ALL', 'ANAT', 'INJ', 'SKIN', 'THER', 'DEV', 'SAFE']);
  });

  it.each(['test', 'freeflow'] as const)('%s: ostatnia opcja to Webinar (247 rodzin, 247 pytań); wybór ustawia tytuł zakresu', async (mode) => {
    const h = await startHarness();
    h.controller.openConfig(mode);
    const cfg = configScreen(h);
    const catalog = h.controller.getState().catalog;
    expect(cfg.scopeOptions.map((o) => o.scope)).toEqual(['ALL', ...(catalog?.domains.map((d) => d.id) ?? []), 'WEBINAR']);
    expect(cfg.scopeOptions.at(-1)).toEqual(WEBINAR_OPTION);
    h.controller.updateConfigDraft({ scope: 'WEBINAR' });
    expect(configScreen(h)).toMatchObject({ draft: { scope: 'WEBINAR' }, scopeTitle: 'Webinar', capacity: 247, questionCount: 247, unseenFamilies: 247 });
  });
});

describe('zakres „Webinar” — sesje, ustawienia i historia po ponownym uruchomieniu', () => {
  it('Test: wyłącznie pytania WB; historia i szkic po restarcie mają zakres Webinar', async () => {
    const h = await startHarness();
    h.controller.openConfig('test');
    h.controller.updateConfigDraft({ scope: 'WEBINAR', nText: '3' });
    expect(await h.controller.startTest()).toEqual({ ok: true });
    await settle();
    expect(openSession(h.controller).config).toMatchObject({ scope: 'WEBINAR', targetN: 3 });
    for (let i = 0; i < 3; i++) {
      await answerWebinarQuestion(h);
      if (question(h.controller).primaryAction === 'next') expect(await h.controller.next()).toEqual({ ok: true });
      await settle();
    }
    expect(await h.controller.showResult()).toEqual({ ok: true });
    h.controller.openHistory('tests');
    expect(historyScreen(h).tests[0]?.config).toMatchObject({ scope: 'WEBINAR', scopeTitle: 'Webinar' });

    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(userState(h2.controller).settings.lastTestConfig).toMatchObject({ scope: 'WEBINAR', targetN: 3 });
    h2.controller.openConfig('test');
    expect(configScreen(h2)).toMatchObject({ draft: { scope: 'WEBINAR', nText: '3' }, scopeTitle: 'Webinar', capacity: 247 });
    h2.controller.openHistory('tests');
    const hist = historyScreen(h2);
    expect(hist.tests[0]?.config).toMatchObject({ scope: 'WEBINAR', scopeTitle: 'Webinar' });
    expect(hist.configOptions.map((o) => o.config.scopeTitle)).toContain('Webinar');
  });

  it('kopia danych: ukończony test „Webinar” po eksporcie i wczytaniu na innej instalacji — historia i ostatnia konfiguracja z zakresem Webinar', async () => {
    const h = await startHarness();
    h.controller.openConfig('test');
    h.controller.updateConfigDraft({ scope: 'WEBINAR', nText: '2' });
    expect(await h.controller.startTest()).toEqual({ ok: true });
    await settle();
    for (let i = 0; i < 2; i++) {
      await answerWebinarQuestion(h);
      if (question(h.controller).primaryAction === 'next') expect(await h.controller.next()).toEqual({ ok: true });
      await settle();
    }
    expect(await h.controller.showResult()).toEqual({ ok: true });
    h.controller.openSettings();
    h.controller.openBackup();
    expect(await h.controller.exportBackup()).toEqual({ ok: true });
    const file = h.platform.files.at(-1);
    if (!file) throw new Error('brak pliku kopii');

    const other = await startHarness();
    other.controller.openSettings();
    other.controller.openBackup();
    expect(await other.controller.selectBackupFile(new Blob([file.text]), file.fileName)).toEqual({ ok: true });
    expect(await other.controller.confirmBackupReplace()).toEqual({ ok: true });
    expect(userState(other.controller).settings.lastTestConfig).toMatchObject({ scope: 'WEBINAR', targetN: 2 });
    other.controller.openHistory('tests');
    expect(historyScreen(other).tests[0]?.config).toMatchObject({ scope: 'WEBINAR', scopeTitle: 'Webinar' });
    other.controller.openConfig('test');
    expect(configScreen(other)).toMatchObject({ draft: { scope: 'WEBINAR' }, scopeTitle: 'Webinar' });
  });

  it('Free Flow: wyłącznie pytania WB; karta przerwanej sesji, historia i szkic po restarcie mają zakres Webinar', async () => {
    const h = await startHarness();
    h.controller.openConfig('freeflow');
    h.controller.updateConfigDraft({ scope: 'WEBINAR' });
    expect(await h.controller.startFreeFlow()).toEqual({ ok: true });
    await settle();
    for (let i = 0; i < 4; i++) {
      await answerWebinarQuestion(h);
      expect(await h.controller.next()).toEqual({ ok: true });
      await settle();
    }
    h.controller.pauseSession();
    const home = h.controller.getState().screen as HomeVM;
    expect(home.name).toBe('home');
    expect(home.resume?.config).toMatchObject({ scope: 'WEBINAR', scopeTitle: 'Webinar' });

    const h2 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect((h2.controller.getState().screen as HomeVM).resume?.config.scopeTitle).toBe('Webinar');
    expect(await h2.controller.endFreeFlow()).toEqual({ ok: true });
    h2.controller.openHistory('freeflow');
    expect(historyScreen(h2).freeFlow[0]?.config).toMatchObject({ scope: 'WEBINAR', scopeTitle: 'Webinar' });

    const h3 = await startHarness({ factory: h.factory, dbName: h.dbName });
    expect(userState(h3.controller).settings.lastFreeFlowConfig).toMatchObject({ scope: 'WEBINAR' });
    h3.controller.openConfig('freeflow');
    expect(configScreen(h3)).toMatchObject({ draft: { scope: 'WEBINAR' }, scopeTitle: 'Webinar' });
  });
});
