/**
 * Punkt wejścia: rzeczywisty kontroler (src/app/appController.ts) na IndexedDB (src/persistence),
 * silniku domeny (src/domain) i Service Workerze (src/pwa), renderowany przez `AppRoot` (src/ui/App.tsx).
 *
 * Tryb deweloperski z mockiem (tylko `npm run dev`): adres z `?mock=1` (opcjonalnie `&latency=300`
 * — opóźnienie zapisu). Mock jest dostępny w konsoli jako `window.__dmeMock`; hash synchronizuje
 * `bindHashRouting` (src/ui/router.ts). Gałąź pod `import.meta.env.DEV` (z dynamicznymi importami mocka)
 * jest wycinana z buildu produkcyjnego — sprawdza to scripts/check-dist.mjs.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles/fonts.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import { createAppController } from './app/appController';
import { APP_VERSION } from './app/appVersion';
import type { AppController } from './app/controller';
import { createBrowserPlatform } from './app/platform';
import type { RuntimeBank } from './domain/types';
import { createRepository } from './persistence/repository';
import { createServiceWorkerPwa, isUpdateSafe } from './pwa/registerSW';
import { AppRoot } from './ui/App';
import { LoadingScreen } from './ui/screens/LoadingScreen';

const container = document.getElementById('root');
if (!container) throw new Error('Brak elementu #root');
const root = createRoot(container);

/** `data/bank.json` względem `base` (z precache Service Workera, gdy offline). */
async function loadBank(): Promise<RuntimeBank> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/bank.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as RuntimeBank;
}

function startApp(): void {
  let controller: AppController | null = null;
  const pwa = createServiceWorkerPwa({
    // Aktualizacja tylko poza ekranem pytania i po zapisie (DECYZJE §11, G03).
    confirmUpdateSafe: () => controller !== null && isUpdateSafe(controller.getState()),
  });
  const platform = createBrowserPlatform(window);
  const repository = createRepository({ appVersion: APP_VERSION, now: platform.nowIso });
  controller = createAppController({ repository, loadBank, platform, pwa, appVersion: APP_VERSION });
  root.render(
    <StrictMode>
      <AppRoot controller={controller} />
    </StrictMode>,
  );
  void controller.start();
}

const useMock = import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1';

if (import.meta.env.DEV && useMock) {
  root.render(
    <StrictMode>
      <LoadingScreen />
    </StrictMode>,
  );
  void (async () => {
    const params = new URLSearchParams(window.location.search);
    const [{ createMockController }, { bindHashRouting }, bank] = await Promise.all([
      import('./app/mockController'),
      import('./ui/router'),
      fetch(`${import.meta.env.BASE_URL}data/bank.json`).then((r) => r.json() as Promise<RuntimeBank>),
    ]);
    const latency = Number(params.get('latency') ?? '0');
    const mock = createMockController({ bank, latencyMs: Number.isFinite(latency) ? latency : 0 });
    root.render(
      <StrictMode>
        <AppRoot controller={mock} />
      </StrictMode>,
    );
    await mock.start();
    bindHashRouting(mock);
    (window as unknown as { __dmeMock: unknown }).__dmeMock = mock;
    console.info('[DME] Mock kontrolera gotowy: window.__dmeMock');
  })();
} else {
  startApp();
}
