/**
 * Punkt wejścia: powłoka profili (src/profiles/profileShell.ts, DECYZJE §16) z ekranem „Wybierz profil”,
 * a dla wybranego profilu — rzeczywisty kontroler (src/app/appController.ts) na jego bazie IndexedDB
 * (src/persistence), silniku domeny (src/domain) i Service Workerze (src/pwa), renderowany przez `ProfileRoot`.
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
import { loadContentBundle } from './app/contentLoader';
import { APP_VERSION } from './app/appVersion';
import type { ContentBundle } from './app/controller';
import { createBrowserPlatform } from './app/platform';
import { CONTENT_RELEASE } from './domain/contentRelease';
import type { RuntimeBank } from './domain/types';
import { createRepository } from './persistence/repository';
import { createProfileShell } from './profiles/profileShell';
import type { ProfileShell, ShellChannel, ShellMessage } from './profiles/profileShell';
import { LEGACY_DB_NAME } from './profiles/profiles';
import { createProfileRegistry } from './profiles/registry';
import { createServiceWorkerPwa, isUpdateSafe } from './pwa/registerSW';
import { AppRoot } from './ui/App';
import { ProfileRoot } from './ui/ProfileRoot';
import { LoadingScreen } from './ui/screens/LoadingScreen';

const container = document.getElementById('root');
if (!container) throw new Error('Brak elementu #root');
const root = createRoot(container);

/** Bank V15 (wersjonowane pliki z `CONTENT_RELEASE`) względem `base` — z precache Service Workera, gdy offline. */
const loadBank = () => loadContentBundle(import.meta.env.BASE_URL);

/** Profil tej karty: odświeżenie karty zostaje przy jej profilu, nawet gdy inna karta wybrała inny. */
const TAB_PROFILE_KEY = 'dme-profil-karty';

/** Powiadomienia między kartami (dane profilu zastąpione, historia bez profilu przypisana). */
function browserChannel(): ShellChannel | undefined {
  if (typeof BroadcastChannel !== 'function') return undefined;
  const channel = new BroadcastChannel('dme-profile');
  return {
    post: (message) => channel.postMessage(message),
    onMessage(listener) {
      const handler = (event: MessageEvent) => listener(event.data as ShellMessage);
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}

function startApp(): void {
  let shell: ProfileShell | null = null;
  const pwa = createServiceWorkerPwa({
    // Aktualizacja tylko poza ekranem pytania i po zapisie (DECYZJE §11, G03); na ekranie wyboru profilu — zawsze.
    confirmUpdateSafe: () => {
      const s = shell?.getState();
      return s !== undefined && (s.phase !== 'app' || isUpdateSafe(s.controller.getState()));
    },
  });
  const platform = createBrowserPlatform(window);
  // Bank V15 wczytany raz — wspólny dla wszystkich profili (zmiana profilu bez ponownego pobierania).
  let bundle: Promise<ContentBundle> | null = null;
  const loadBankOnce = (): Promise<ContentBundle> => {
    bundle ??= loadBank().catch((error: unknown) => {
      bundle = null;
      throw error;
    });
    return bundle;
  };
  shell = createProfileShell({
    registry: createProfileRegistry(window.indexedDB),
    createRepository: (options) => createRepository(options),
    createController: ({ repository, profile }) => createAppController({ repository, loadBank: loadBankOnce, platform, pwa, appVersion: APP_VERSION, profile }),
    async legacyDatabaseExists() {
      if (typeof window.indexedDB.databases !== 'function') return null;
      try {
        return (await window.indexedDB.databases()).some((d) => d.name === LEGACY_DB_NAME);
      } catch {
        return null;
      }
    },
    now: platform.nowIso,
    randomId: platform.randomId,
    appVersion: APP_VERSION,
    bankVersions: [CONTENT_RELEASE.bankVersion],
    tabProfile: {
      get: () => {
        try {
          return window.sessionStorage.getItem(TAB_PROFILE_KEY);
        } catch {
          return null;
        }
      },
      set: (email) => {
        try {
          window.sessionStorage.setItem(TAB_PROFILE_KEY, email);
        } catch {
          /* bez pamięci karty — zostaje ostatni profil urządzenia */
        }
      },
    },
    channel: browserChannel(),
    resetRoute: () => window.history.replaceState(null, '', window.location.pathname + window.location.search),
  });
  root.render(
    <StrictMode>
      <ProfileRoot shell={shell} />
    </StrictMode>,
  );
  void shell.start();
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
    const [{ createMockController }, { bindHashRouting }, content] = await Promise.all([
      import('./app/mockController'),
      import('./ui/router'),
      loadContentBundle(import.meta.env.BASE_URL),
    ]);
    const latency = Number(params.get('latency') ?? '0');
    const retired = (content.retired as { ids?: string[] }).ids ?? [];
    const mock = createMockController({ bank: content.bank as RuntimeBank, retiredIds: retired, latencyMs: Number.isFinite(latency) ? latency : 0 });
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
