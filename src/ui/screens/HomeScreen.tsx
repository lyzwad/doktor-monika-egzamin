/**
 * S01–S02 Start: nazwa, dwa główne wejścia (Free Flow, Test), dyskretnie Historia i Ustawienia.
 * Przerwana sesja → karta „Kontynuuj” (tryb, postęp) z menu ⋮ („Zamknij test bez wyniku” z potwierdzeniem,
 * dla Free Flow „Zakończ sesję”). Wskazówka instalacji przy pierwszym otwarciu w Safari (zamykana).
 * Baner aktualizacji (tylko tu, poza ekranem pytania) i baner braku internetu.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppState, useController } from '../../app/ControllerContext';
import type { HomeVM, ResumeVM } from '../../app/viewModels';
import { Banner, OfflineBanner } from '../components/Banner';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { AlertDialog, Sheet } from '../components/Sheet';
import { configLabel, pluralPl } from '../format';
import { isStandaloneDisplay } from '../hooks';

type Overlay = null | 'menu' | 'confirm';

function resumeTitle(r: ResumeVM): string {
  if (r.kind === 'freeflow') return 'Kontynuuj Free Flow';
  return r.retryRoundIndex !== null ? 'Kontynuuj test · Powtórka' : 'Kontynuuj test';
}

/** Liczba pozycji czekających na zastępstwo (S24g) — z odmianą. */
export function awaitingText(count: number): string {
  if (count === 1) return 'Jedno pytanie czeka na zastępstwo.';
  return `${count} ${pluralPl(count, 'pytanie czeka', 'pytania czekają', 'pytań czeka')} na zastępstwo.`;
}

function resumeProgress(r: ResumeVM): string {
  if (r.kind === 'freeflow') return `Ostatnie: Pytanie ${r.questionNumber}`;
  const n = r.targetN ?? 0;
  return `${r.answeredValid}/${n} ${pluralPl(n, 'pytanie', 'pytania', 'pytań')}`;
}

export function HomeScreen({ vm }: { vm: HomeVM }) {
  const controller = useController();
  const state = useAppState();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resume = vm.resume;
  const showHint = vm.showInstallHint && !isStandaloneDisplay();
  const update = state.update;

  useEffect(() => {
    if (document.activeElement === document.body) titleRef.current?.focus({ preventScroll: true });
  }, []);

  // Sesja zamknięta gdzie indziej (np. inna karta) — zamknij nieaktualne menu.
  useEffect(() => {
    if (!resume) setOverlay(null);
  }, [resume]);

  return (
    <>
      <Screen contentClassName="screen__content--home" label="Start">
        {update.available && update.canApplyNow ? (
          <Banner
            tone="info"
            icon="update"
            role="status"
            actions={
              <button type="button" className="btn btn--secondary btn--sm" disabled={update.applying} onClick={() => void controller.applyUpdate()}>
                Uruchom ponownie
              </button>
            }
          >
            {resume
              ? 'Nowa wersja aplikacji jest gotowa. Po ponownym uruchomieniu przerwana sesja zostanie zachowana.'
              : 'Nowa wersja aplikacji jest gotowa.'}
          </Banner>
        ) : null}
        {!state.online ? <OfflineBanner /> : null}
        <h1 className="app-title" ref={titleRef} tabIndex={-1}>
          Doktor Monika Egzamin
        </h1>
        {showHint ? (
          <section className="hint" aria-label="Wskazówka instalacji">
            <Icon name="ios_share" size={22} className="hint__icon" />
            <div className="hint__text">
              <div className="hint__title">Dodaj do ekranu początkowego</div>
              W Safari dotknij „Udostępnij”, a potem „Do ekranu początkowego”. Aplikacja otworzy się w osobnym oknie i będzie działać bez internetu.
            </div>
            <button type="button" className="icon-btn hint__close" aria-label="Zamknij wskazówkę" onClick={() => void controller.dismissInstallHint()}>
              <Icon name="close" />
            </button>
          </section>
        ) : null}
        {resume ? (
          <section className="resume" aria-label="Przerwana sesja">
            <div className="resume__head">
              <div className="resume__info">
                <div className="resume__title">{resumeTitle(resume)}</div>
                <div className="resume__progress">{resumeProgress(resume)}</div>
                <div className="resume__config">{configLabel(resume.config)}</div>
                {resume.awaitingCount > 0 ? <div className="resume__config">{awaitingText(resume.awaitingCount)}</div> : null}
              </div>
              <button type="button" className="icon-btn icon-btn--muted" aria-label="Więcej opcji sesji" aria-haspopup="dialog" onClick={() => setOverlay('menu')}>
                <Icon name="more_vert" size={22} />
              </button>
            </div>
            {resume.kind === 'test' && resume.targetN ? (
              <span className="progress-track resume__bar" aria-hidden="true">
                <span className="progress-track__fill" style={{ width: `${Math.round((resume.answeredValid / resume.targetN) * 100)}%` }} />
              </span>
            ) : null}
            <button type="button" className="btn btn--primary btn--lg resume__action" onClick={() => controller.resume()}>
              Kontynuuj
            </button>
          </section>
        ) : null}
        <div className="mode-cards">
          <button type="button" className="mode-card" onClick={() => controller.openConfig('freeflow')}>
            <span className="mode-card__icon mode-card__icon--ff" aria-hidden="true">
              <Icon name="all_inclusive" size={28} />
            </span>
            <span className="mode-card__body">
              <span className="mode-card__title">Free Flow</span>
              <span className="mode-card__text">Pytania i powtórki we własnym tempie</span>
            </span>
            <Icon name="chevron_right" size={24} className="list-row__chevron" />
          </button>
          <button type="button" className="mode-card" onClick={() => controller.openConfig('test')}>
            <span className="mode-card__icon mode-card__icon--test" aria-hidden="true">
              <Icon name="checklist" size={28} />
            </span>
            <span className="mode-card__body">
              <span className="mode-card__title">Test</span>
              <span className="mode-card__text">Wybierz liczbę pytań i sprawdź wynik</span>
            </span>
            <Icon name="chevron_right" size={24} className="list-row__chevron" />
          </button>
        </div>
        <nav className="home-nav" aria-label="Widoki pomocnicze">
          <button type="button" className="btn btn--outline" onClick={() => controller.openHistory('tests')}>
            <Icon name="history" />
            Historia
          </button>
          <button type="button" className="btn btn--outline" onClick={() => controller.openSettings()}>
            <Icon name="settings" />
            Ustawienia
          </button>
        </nav>
      </Screen>

      {overlay === 'menu' && resume ? (
        <Sheet
          title={resume.kind === 'test' ? `Test · ${resume.answeredValid}/${resume.targetN ?? 0}` : `Free Flow · Pytanie ${resume.questionNumber}`}
          meta={configLabel(resume.config)}
          onClose={() => setOverlay(null)}
        >
          {resume.kind === 'test' ? (
            <button type="button" className="btn btn--danger-outline btn--lg btn--block" onClick={() => setOverlay('confirm')}>
              Zamknij test bez wyniku
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--danger-outline btn--lg btn--block"
              onClick={() => {
                setOverlay(null);
                void controller.endFreeFlow(resume.sessionId);
              }}
            >
              Zakończ sesję
            </button>
          )}
          <button type="button" className="btn btn--text btn--block" onClick={() => setOverlay(null)}>
            Anuluj
          </button>
        </Sheet>
      ) : null}

      {overlay === 'confirm' && resume ? (
        <AlertDialog
          title="Zamknąć test bez wyniku?"
          onClose={() => setOverlay(null)}
          actions={
            <>
              <button
                type="button"
                className="btn btn--danger-soft btn--block"
                onClick={() => {
                  setOverlay(null);
                  void controller.closeUnfinished(resume.sessionId);
                }}
              >
                Zamknij test
              </button>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => setOverlay(null)}>
                Anuluj
              </button>
            </>
          }
        >
          Zapisane odpowiedzi ({resume.answeredValid}) trafią do historii jako test niedokończony, bez oznaczenia zaliczenia. Nie będzie można go kontynuować.
        </AlertDialog>
      ) : null}
    </>
  );
}
