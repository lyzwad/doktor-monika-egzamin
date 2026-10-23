/**
 * Wydajność na finalnym banku (public/data/bank.json, ~1,9 MB; liczba pytań z `bank.counts`): czas wczytania i budowy
 * katalogu, startu testu 60 / mieszany / cały zakres, modelu widoku konfiguracji (8 pul) oraz pierwszego
 * ekranu pytania. Cel z zadania: ≤ ~200 ms na laptopie.
 *
 * Mierzymy czas ściany i czas CPU procesu (`process.cpuUsage`) — MINIMUM z kilku powtórzeń. Na mocno
 * obciążonej maszynie (load ≫ liczba rdzeni, swap) czas ściany obejmuje czekanie na procesor, więc
 * asercja dotyczy czasu CPU (z zapasem), a oba czasy trafiają do logu.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScreen, draftFromConfig, type ViewInput } from '../../src/app/screenModels';
import { buildCatalog, defaultSettings, emptyUserState, initialFreeFlowConfig, initialTestConfig, parseRuntimeBank, startTest, type Catalog, type CommandContext } from '../../src/domain/api';

const RAW = readFileSync(resolve(process.cwd(), 'public/data/bank.json'), 'utf-8');
/** Budżet z zadania (laptop). */
const TARGET_MS = 200;
/** Asercja (czas CPU) z zapasem na obciążoną maszynę — regresja rzędu wielkości nadal wyłapana. */
const HARD_LIMIT_MS = 2000;
const RUNS = 5;

interface Timing {
  wall: number;
  cpu: number;
}

function once(fn: () => void): Timing {
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  fn();
  const wall = performance.now() - t0;
  const c = process.cpuUsage(c0);
  return { wall, cpu: (c.user + c.system) / 1000 };
}

function best(fn: () => void, runs = RUNS): Timing {
  let wall = Number.POSITIVE_INFINITY;
  let cpu = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t = once(fn);
    wall = Math.min(wall, t.wall);
    cpu = Math.min(cpu, t.cpu);
  }
  return { wall, cpu };
}

const fmt = (t: Timing): string => `${t.wall.toFixed(1)} ms (CPU ${t.cpu.toFixed(1)} ms)`;

function ctx(): CommandContext {
  let n = 0;
  return { now: '2026-10-23T08:00:00.000Z', nextDayStart: '2026-10-23T22:00:00.000Z', commandId: 'perf', newId: () => `id-${++n}` };
}

function catalogOrThrow(): Catalog {
  const parsed = parseRuntimeBank(JSON.parse(RAW));
  if (!parsed.ok) throw new Error(parsed.error.messagePl);
  const built = buildCatalog(parsed.value, []);
  if (!built.ok) throw new Error(built.error.messagePl);
  return built.value;
}

const report: string[] = [];

describe('wydajność na finalnym banku', () => {
  it('bank ma rozmiar finalnej puli (kontrola, że mierzymy właściwy plik); pierwszy, „zimny” przebieg', () => {
    let catalog: Catalog | null = null;
    const cold = once(() => {
      catalog = catalogOrThrow();
    });
    const c = catalog as unknown as Catalog;
    let ok = false;
    const coldStart = once(() => {
      ok = startTest(emptyUserState(), c, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 60, myErrorsPriority: false }, seed: 1 }, ctx()).ok;
    });
    expect(ok).toBe(true);
    report.push(`zimny start: katalog ${fmt(cold)}, startTest 60 ${fmt(coldStart)}`);
    expect(cold.cpu).toBeLessThan(HARD_LIMIT_MS);
    expect(RAW.length).toBeGreaterThan(1_500_000);
    expect(c.questions).toHaveLength((JSON.parse(RAW) as { counts: { questions: number } }).counts.questions);
    expect(c.issues).toEqual([]);
  });

  it(`JSON.parse + parseRuntimeBank + buildCatalog — min z ${RUNS}, CPU ≤ ${HARD_LIMIT_MS} ms (cel ${TARGET_MS} ms)`, () => {
    const parseOnly = best(() => JSON.parse(RAW));
    const full = best(() => catalogOrThrow());
    report.push(`JSON.parse ${fmt(parseOnly)}; parse+walidacja+katalog ${fmt(full)}`);
    expect(full.cpu).toBeLessThan(HARD_LIMIT_MS);
  });

  it(`startTest 60 / mixed / ALL na pustym stanie — min z ${RUNS}, CPU ≤ ${HARD_LIMIT_MS} ms (cel ${TARGET_MS} ms)`, () => {
    const catalog = catalogOrThrow();
    const state = emptyUserState();
    let slots = 0;
    const t = best(() => {
      const r = startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 60, myErrorsPriority: false }, seed: 12345 }, ctx());
      if (!r.ok) throw new Error(r.error.messagePl);
      slots = r.value.state.sessions[r.value.value.sessionId]?.plan.length ?? 0;
    });
    expect(slots).toBe(60);
    report.push(`startTest 60/mixed/ALL ${fmt(t)}`);
    expect(t.cpu).toBeLessThan(HARD_LIMIT_MS);
  });

  it(`modele widoku: konfiguracja testu (8 pul) i pierwsze pytanie testu 60 — min z ${RUNS}, CPU ≤ ${HARD_LIMIT_MS} ms`, () => {
    const catalog = catalogOrThrow();
    const user = emptyUserState();
    const base: ViewInput = {
      catalog,
      user,
      packs: [],
      now: '2026-10-23T08:00:00.000Z',
      route: { name: 'config', mode: 'test' },
      viewPosition: 0,
      drafts: {
        test: draftFromConfig(initialTestConfig(defaultSettings()), 60),
        freeflow: draftFromConfig(initialFreeFlowConfig(defaultSettings()), 20),
      },
      starting: false,
      pendingAnswer: null,
      ffNotice: null,
      historyFilter: { kind: 'all' },
      selectedPoint: null,
      backupFlow: { step: 'idle', lastSavedFileName: null },
      safetyBackups: null,
      poolFlow: { step: 'idle' },
      appVersion: 'perf',
      installHint: false,
    };
    const tConfig = best(() => {
      const s = buildScreen(base);
      if (s?.name !== 'config') throw new Error('oczekiwano konfiguracji');
    });
    const started = startTest(user, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 60, myErrorsPriority: false }, seed: 7 }, ctx());
    if (!started.ok) throw new Error(started.error.messagePl);
    const qInput: ViewInput = { ...base, user: started.value.state, route: { name: 'question', sessionId: started.value.value.sessionId } };
    const tQuestion = best(() => {
      const s = buildScreen(qInput);
      if (s?.name !== 'question') throw new Error('oczekiwano pytania');
    });
    report.push(`VM konfiguracji ${fmt(tConfig)}; VM pytania (test 60) ${fmt(tQuestion)}`);
    expect(tConfig.cpu).toBeLessThan(HARD_LIMIT_MS);
    expect(tQuestion.cpu).toBeLessThan(HARD_LIMIT_MS);
    console.info(`[wydajność] ${report.join(' | ')} (cel ≤ ${TARGET_MS} ms na laptopie)`);
  });
});
