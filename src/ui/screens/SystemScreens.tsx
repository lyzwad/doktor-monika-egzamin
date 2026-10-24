/**
 * S24a/S24a2 — pierwsze przygotowanie materiałów offline (postęp z precache, nie symulowany)
 * oraz ekran błędu krytycznego uruchomienia (np. brak IndexedDB, uszkodzony bank).
 */
import { useController } from '../../app/ControllerContext';
import type { BootState, PreparationState } from '../../app/viewModels';
import { Banner } from '../components/Banner';

export function PreparationScreen({ preparation }: { preparation: PreparationState }) {
  const controller = useController();
  const pct = preparation.total > 0 ? Math.min(100, Math.floor((preparation.done / preparation.total) * 100)) : 0;
  return (
    <main className="center-screen" aria-label="Przygotowanie materiałów">
      <h1 className="app-title" style={{ margin: 0 }}>
        Doktor Monika Egzamin
      </h1>
      {preparation.status === 'running' ? (
        <div role="status" aria-live="polite" className="section" style={{ gap: 10 }}>
          <div className="prep__title">Przygotowanie materiałów do nauki</div>
          <p className="body-text muted">
            Zapisujemy pytania, objaśnienia i schematy na tym urządzeniu, aby nauka działała także bez internetu. To jednorazowe przy pierwszym uruchomieniu.
          </p>
          <div className="prep__row">
            <span
              className="progress-track prep__track"
              role="progressbar"
              aria-label="Przygotowanie materiałów"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span className="progress-track__fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="prep__pct">{pct}%</span>
          </div>
        </div>
      ) : (
        <Banner
          tone="warn"
          role="alert"
          icon={null}
          title="Nie udało się zapisać wszystkich materiałów"
          actions={
            <button type="button" className="btn btn--primary" onClick={() => void controller.retryPreparation()}>
              Spróbuj ponownie
            </button>
          }
        >
          <span>Połączenie zostało przerwane przy {pct}%. Zapisane części zostaną zachowane; brakujące pobierzemy przy ponownej próbie.</span>
        </Banner>
      )}
    </main>
  );
}

export function FatalScreen({ boot }: { boot: Extract<BootState, { phase: 'fatal' }> }) {
  const controller = useController();
  return (
    <main className="center-screen" aria-label="Błąd uruchomienia">
      <h1 className="app-title" style={{ margin: 0 }}>
        Doktor Monika Egzamin
      </h1>
      <Banner
        tone="danger"
        role="alert"
        title={
          boot.code === 'MIGRATION_BLOCKED'
            ? 'Aktualizacja danych czeka'
            : boot.code === 'MIGRATION_FAILED' || boot.code === 'CONTENT_UPDATE_FAILED'
              ? 'Aktualizacja danych nie powiodła się'
              : 'Nie można uruchomić aplikacji'
        }
        actions={
          boot.canRetry ? (
            <button type="button" className="btn btn--primary" onClick={() => void controller.retryBoot()}>
              Spróbuj ponownie
            </button>
          ) : null
        }
      >
        <span className="banner__text">{boot.messagePl}</span>
        <span className="banner__text">Zapisane dane nauki nie zostały usunięte.</span>
      </Banner>
    </main>
  );
}

export const BOOT_STAGE_TEXT: Record<Extract<BootState, { phase: 'loading' }>['stage'], string> = {
  'opening-storage': 'Otwieranie danych na urządzeniu…',
  migrating: 'Aktualizacja banku pytań…',
  'content-update': 'Aktualizacja banku pytań…',
  'loading-bank': 'Wczytywanie pytań…',
  'loading-user-data': 'Wczytywanie postępów…',
};
