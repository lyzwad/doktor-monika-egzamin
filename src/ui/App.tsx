/**
 * Komponent główny UI: renderuje ekran z `AppState.screen` (S01–S24) na podstawie modelu widoku
 * z kontrolera (src/app/controller.ts). Logika domeny i zapisu jest w kontrolerze; UI trzyma tylko
 * stan lokalny (otwarte arkusze, powiększenie, rozwinięcia).
 *
 * Globalnie: faza uruchomienia (ładowanie / błąd krytyczny), pierwsze przygotowanie materiałów,
 * pływający StatusToast i błąd zapisu poza ekranem pytania (w pytaniu — w dolnym pasku),
 * automatyczne ukrycie toastu bez akcji (4,5 s; z „Cofnij” — bez limitu).
 */
import { useEffect } from 'react';
import type { AppController } from '../app/controller';
import { ControllerProvider, useAppState, useController } from '../app/ControllerContext';
import type { ScreenVM } from '../app/viewModels';
import { Icon } from './components/Icon';
import { StatusToast } from './components/QuestionChrome';
import { saveErrorText } from './format';
import { ConfigScreen } from './screens/ConfigScreen';
import { BackupScreen, PoolImportScreen } from './screens/DataScreens';
import { FreeFlowSummaryScreen } from './screens/FreeFlowSummaryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { ResultScreen } from './screens/ResultScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { AboutScreen, ExcludedScreen, SettingsScreen } from './screens/SettingsScreens';
import { BOOT_STAGE_TEXT, FatalScreen, PreparationScreen } from './screens/SystemScreens';
import './styles/components.css';

function ScreenSwitch({ screen }: { screen: ScreenVM }) {
  switch (screen.name) {
    case 'home':
      return <HomeScreen vm={screen} />;
    case 'config':
      return <ConfigScreen key={screen.mode} vm={screen} />;
    case 'question':
      return <QuestionScreen key={screen.sessionId} vm={screen} />;
    case 'result':
      return <ResultScreen key={screen.sessionId} vm={screen} />;
    case 'review':
      return <ReviewScreen key={screen.sessionId} vm={screen} />;
    case 'freeflowSummary':
      return <FreeFlowSummaryScreen key={screen.sessionId} vm={screen} />;
    case 'history':
      return <HistoryScreen vm={screen} />;
    case 'settings':
      return <SettingsScreen vm={screen} />;
    case 'about':
      return <AboutScreen vm={screen} />;
    case 'backup':
      return <BackupScreen vm={screen} />;
    case 'poolImport':
      return <PoolImportScreen vm={screen} />;
    case 'excluded':
      return <ExcludedScreen vm={screen} />;
  }
}

/** Toast i błąd zapisu poza ekranem pytania — pływające nad strefą gestu, bez przejmowania fokusu. */
function FloatingStatus() {
  const controller = useController();
  const state = useAppState();
  const toast = state.toast;
  const save = state.save;
  if (!toast && save.status !== 'error') return null;
  return (
    <div className="floating-status">
      <div className="floating-status__inner">
        {save.status === 'error' ? (
          <div className="banner banner--danger" role="alert">
            <div className="banner__row">
              <Icon name="error_outline" className="banner__icon" />
              <span className="banner__lead">{saveErrorText(save)}</span>
            </div>
            <button type="button" className="btn btn--primary btn--sm btn--start" onClick={() => void controller.retrySave()}>
              Spróbuj zapisać ponownie
            </button>
          </div>
        ) : null}
        {toast ? (
          <StatusToast
            toast={toast}
            icon={toast.kind === 'action_failed' ? 'info' : 'check_circle'}
            onUndo={save.status === 'idle' ? () => void controller.undoReport() : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

export function App() {
  const controller = useController();
  const state = useAppState();
  const toast = state.toast;

  // Toast bez akcji znika po `autoHideMs`; z „Cofnij” trwa do następnej mutacji sesji.
  useEffect(() => {
    if (!toast || toast.autoHideMs === null) return undefined;
    const id = toast.id;
    const timer = setTimeout(() => {
      if (controller.getState().toast?.id === id) controller.dismissToast();
    }, toast.autoHideMs);
    return () => clearTimeout(timer);
  }, [toast, controller]);

  // iOS Safari stosuje `:active` (stan „naciśnięty” karty odpowiedzi, przycisków) tylko przy
  // zarejestrowanym nasłuchu dotyku — pusty, pasywny nasłuch nie wpływa na przewijanie.
  useEffect(() => {
    const noop = () => undefined;
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

  const boot = state.boot;
  let content;
  if (boot.phase === 'fatal') content = <FatalScreen boot={boot} />;
  else if (boot.phase === 'loading') content = <LoadingScreen message={BOOT_STAGE_TEXT[boot.stage]} />;
  else if (state.preparation) content = <PreparationScreen preparation={state.preparation} />;
  else if (!state.screen) content = <LoadingScreen />;
  else content = <ScreenSwitch screen={state.screen} />;

  const onQuestion = boot.phase === 'ready' && !state.preparation && state.screen?.name === 'question';
  return (
    <div className="app-root" lang="pl">
      {content}
      {boot.phase === 'ready' && !onQuestion ? <FloatingStatus /> : null}
    </div>
  );
}

/** Aplikacja z kontrolerem w kontekście (rzeczywistym albo mockiem w trybie deweloperskim). */
export function AppRoot({ controller }: { controller: AppController }) {
  return (
    <ControllerProvider controller={controller}>
      <App />
    </ControllerProvider>
  );
}
