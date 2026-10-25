/**
 * Korzeń UI z profilami (DECYZJE §16): ekran wyboru profilu i decyzji o historii bez profilu z powłoki
 * (src/profiles/profileShell.ts), a po wyborze — aplikacja z kontrolerem tego profilu. Nowy kontroler
 * (inny profil albo dane wczytane od nowa) = nowe drzewo React (`key`), bez stanu poprzedniego profilu.
 */
import { useSyncExternalStore } from 'react';
import type { ProfileShell } from '../profiles/profileShell';
import { PROFILE_EMAILS } from '../profiles/profiles';
import { AppRoot } from './App';
import { Banner } from './components/Banner';
import { LoadingScreen } from './screens/LoadingScreen';
import { AssignUnassignedScreen, ProfilePickerScreen } from './screens/ProfileScreens';
import './styles/components.css';

export function ProfileRoot({ shell }: { shell: ProfileShell }) {
  const state = useSyncExternalStore(shell.subscribe, shell.getState);
  switch (state.phase) {
    case 'app':
      return <AppRoot key={state.generation} controller={state.controller} />;
    case 'picker':
      return (
        <div className="app-root" lang="pl">
          <ProfilePickerScreen
            profiles={PROFILE_EMAILS}
            last={state.last}
            unassigned={state.unassigned}
            busy={state.busy}
            messagePl={state.messagePl}
            onChoose={(email) => void shell.choose(email)}
          />
        </div>
      );
    case 'assign':
      return (
        <div className="app-root" lang="pl">
          <AssignUnassignedScreen
            email={state.email}
            unassigned={state.unassigned}
            busy={state.busy}
            messagePl={state.messagePl}
            onAssign={() => void shell.assignUnassigned(state.email)}
            onDefer={() => void shell.deferUnassigned()}
            onBack={() => void shell.openPicker()}
          />
        </div>
      );
    case 'fatal':
      return (
        <div className="app-root" lang="pl">
          <main className="center-screen" aria-label="Błąd uruchomienia">
            <h1 className="app-title" style={{ margin: 0 }}>
              Doktor Monika Egzamin
            </h1>
            <Banner
              tone="danger"
              role="alert"
              title="Nie można uruchomić aplikacji"
              actions={
                state.canRetry ? (
                  <button type="button" className="btn btn--primary" onClick={() => void shell.retry()}>
                    Spróbuj ponownie
                  </button>
                ) : null
              }
            >
              <span className="banner__text">{state.messagePl}</span>
              <span className="banner__text">Zapisane dane nauki nie zostały usunięte.</span>
            </Banner>
          </main>
        </div>
      );
    default:
      return (
        <div className="app-root" lang="pl">
          <LoadingScreen message={state.messagePl} />
        </div>
      );
  }
}
