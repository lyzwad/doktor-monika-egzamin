/**
 * S06–S15, S17d, S24 — ekran pytania (tryby: `live`, `preview` tylko do odczytu, `review` szczegół przeglądu).
 *
 * Zachowania (PRZEKAZANIE §8, specyfikacja §3):
 * - pierwsze dotknięcie wariantu wywołuje kontroler RAZ (blokada w AnswerList), bez „Sprawdź”;
 * - przed odpowiedzią brak klucza/wyjaśnienia/źródeł/podpisanej figury (VM ich nie zawiera);
 * - po zapisie łagodne przewinięcie do wyjaśnienia (≤ 260 px, bez animacji przy reduced motion);
 * - „Dalej” ręczne, „Pokaż wynik” po ostatniej ocenionej pozycji; bez procentu na żywo;
 * - podgląd wcześniejszej odpowiedzi z paskiem „Podgląd odpowiedzi” i „Do bieżącego”;
 * - wyjście z pytania zawsze przez arkusz; toast z „Cofnij” i błąd zapisu w dolnym pasku.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppState, useController } from '../../app/ControllerContext';
import type { FigureVM, QuestionVM } from '../../app/viewModels';
import type { OptionId } from '../../domain/types';
import { AnswerList } from '../components/AnswerCard';
import { Banner, OfflineBanner } from '../components/Banner';
import { Tag } from '../components/Controls';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { FigureBlock, ZoomViewer } from '../components/Figure';
import { Icon } from '../components/Icon';
import { BottomActionBar, ProgressHeader, SaveErrorAlert, StatusToast } from '../components/QuestionChrome';
import { Screen } from '../components/Screen';
import { AlertDialog, Sheet } from '../components/Sheet';
import { configLabel, difficultyLabel, formatDate, pluralPl, questionsCount, saveErrorText } from '../format';
import { gentleScrollTo } from '../hooks';

type Overlay = null | 'exit' | 'confirm-close';

function progressText(vm: QuestionVM): string {
  if (vm.mode === 'review') {
    return vm.progress.kind === 'test' ? `Pytanie ${vm.position + 1} z ${vm.progress.targetN}` : `Pytanie ${vm.position + 1}`;
  }
  return vm.progress.kind === 'test' ? `${vm.progress.answeredValid}/${vm.progress.targetN}` : `Pytanie ${vm.progress.questionNumber}`;
}

function previewText(vm: QuestionVM): string {
  if (vm.mode === 'review') {
    const date = vm.reviewNav ? formatDate(vm.reviewNav.sessionDate) : '';
    const kind = vm.kind === 'test' ? 'Test' : 'Sesja Free Flow';
    return date ? `${kind} z ${date} · tylko do odczytu` : `${kind} · tylko do odczytu`;
  }
  const n = vm.progress.kind === 'test' ? ` z ${vm.progress.targetN}` : '';
  return `Pytanie ${vm.position + 1}${n} · zapisany wybór`;
}

export function QuestionScreen({ vm }: { vm: QuestionVM }) {
  const controller = useController();
  const state = useAppState();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [zoom, setZoom] = useState<FigureVM | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const explRef = useRef<HTMLElement | null>(null);
  const stemRef = useRef<HTMLParagraphElement | null>(null);
  const prevRef = useRef<{ slotId: string; answered: boolean } | null>(null);
  /**
   * UI-03: slot, w którym odpowiedź wybrano z fokusem na karcie (klawiatura, czytnik ekranu). Karta-przycisk
   * znika po wyborze, więc fokus trzeba przenieść — najpierw na wybraną kartę (zapis w toku), po ocenie
   * na nagłówek wyjaśnienia. Przy zwykłym dotknięciu fokus nie jest przejmowany (PRZEKAZANIE §13).
   */
  const focusAfterAnswerRef = useRef<{ slotId: string; placed: HTMLElement | null } | null>(null);

  const save = state.save;
  const saveError = save.status === 'error' ? save : null;
  const toast = state.toast;
  const isReview = vm.mode === 'review';
  const awaiting = vm.awaitingReplacement;
  const showQuestion = !awaiting;
  const [announcement, setAnnouncement] = useState('');

  // Nowa pozycja: zamknij powiększenie, fokus na treść pytania (czytniki ekranu).
  useEffect(() => {
    setZoom(null);
    const prev = prevRef.current;
    // Tylko gdy fokus przepadł (np. zniknął przycisk „Dalej”) — „‹” w podglądzie zachowuje fokus.
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (prev && prev.slotId !== vm.slotId && lost && stemRef.current) stemRef.current.focus({ preventScroll: true });
    setAnnouncement('');
  }, [vm.slotId]);

  // Po zapisanej odpowiedzi: komunikat poprawności (role=status) i łagodne przewinięcie do wyjaśnienia.
  useEffect(() => {
    const prev = prevRef.current;
    const justAnswered = prev !== null && prev.slotId === vm.slotId && !prev.answered && vm.answered && vm.mode === 'live';
    prevRef.current = { slotId: vm.slotId, answered: vm.answered };
    if (!justAnswered) return;
    setAnnouncement(vm.correct ? 'Odpowiedź poprawna.' : 'Odpowiedź błędna. Poprawna odpowiedź jest oznaczona na liście.');
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
    raf(() => gentleScrollTo(scrollRef.current, explRef.current));
  }, [vm.slotId, vm.answered, vm.correct, vm.mode]);

  // UI-03: przeniesienie fokusu po wyborze klawiaturą — tylko gdy fokus przepadł (np. na <body>)
  // albo stoi na karcie, na którą przenieśliśmy go w trakcie zapisu. Bez przewijania (preventScroll):
  // przewija łagodnie `gentleScrollTo`, z poszanowaniem prefers-reduced-motion.
  useEffect(() => {
    const pending = focusAfterAnswerRef.current;
    if (!pending) return;
    if (pending.slotId !== vm.slotId || vm.mode !== 'live') {
      focusAfterAnswerRef.current = null;
      return;
    }
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    const heading = vm.answered ? (explRef.current?.querySelector<HTMLElement>('.expl__title') ?? null) : null;
    if (heading) {
      if (lost || active === pending.placed) heading.focus({ preventScroll: true });
      focusAfterAnswerRef.current = null;
      return;
    }
    if (lost) {
      const card = scrollRef.current?.querySelector<HTMLElement>('.answer-card--pending, .answer-card--selected-correct, .answer-card--selected-wrong') ?? null;
      if (card) {
        card.focus({ preventScroll: true });
        pending.placed = card;
      }
    }
  });

  const onAnswer = async (optionId: OptionId, withFocus: boolean): Promise<boolean> => {
    if (withFocus) focusAfterAnswerRef.current = { slotId: vm.slotId, placed: null };
    const result = await controller.answer(optionId);
    if (result.ok) return true;
    const s = controller.getState().save.status;
    // Odrzucona bez zapisu (np. nieaktualny stan) — pozwól dotknąć ponownie; błąd zapisu ponawia się przyciskiem.
    const keepLock = s === 'error' || s === 'saving';
    // Karta-przycisk zostaje (nic nie czeka na zapis) — nie przenosić fokusu przy kolejnym, np. dotykowym wyborze.
    if (!keepLock) focusAfterAnswerRef.current = null;
    return keepLock;
  };

  const leading = isReview
    ? { kind: 'back' as const, label: 'Wróć do listy', onClick: () => controller.goBack() }
    : {
        kind: 'close' as const,
        label: vm.kind === 'freeflow' ? 'Przerwij lub zakończ Free Flow' : 'Przerwij test',
        onClick: () => setOverlay('exit'),
      };

  // Dolny pasek
  let primary: { label: string; onClick: () => void; icon?: boolean } | null = null;
  let hint: string | null = null;
  if (saveError) {
    primary = { label: 'Spróbuj zapisać ponownie', onClick: () => void controller.retrySave(), icon: false };
  } else if (isReview) {
    const nav = vm.reviewNav;
    primary = nav?.nextSlotId
      ? { label: 'Następne', onClick: () => nav.nextSlotId && controller.navigate({ name: 'reviewItem', sessionId: vm.sessionId, slotId: nav.nextSlotId, filter: nav.filter }) }
      : { label: 'Wróć do listy', onClick: () => controller.goBack() };
  } else if (vm.primaryAction === 'next') {
    primary = { label: 'Dalej', onClick: () => void controller.next() };
  } else if (vm.primaryAction === 'show-result') {
    primary = { label: 'Pokaż wynik', onClick: () => void controller.showResult() };
  } else if (vm.primaryAction === 'go-awaiting' && vm.awaitingElsewhere) {
    // S24g/E03: wszystko ocenione, ale wcześniejsza pozycja czeka na zastępstwo — prowadzi do niej (baner z akcjami).
    primary = { label: `Przejdź do pytania ${vm.awaitingElsewhere.position + 1}`, onClick: () => void controller.next() };
  } else if (vm.primaryAction === 'hint' && !vm.freeFlowEmpty) {
    hint = 'Dotknij odpowiedzi, aby ją zatwierdzić.';
  } else if (vm.savingAnswer) {
    hint = 'Zapisywanie odpowiedzi…';
  }

  const onPrevious = isReview
    ? vm.reviewNav?.prevSlotId
      ? () => {
          const nav = vm.reviewNav;
          if (nav?.prevSlotId) controller.navigate({ name: 'reviewItem', sessionId: vm.sessionId, slotId: nav.prevSlotId, filter: nav.filter });
        }
      : null
    : vm.canGoPrevious
      ? () => controller.showPrevious()
      : null;

  // „Cofnij” tylko, gdy nic nie czeka na zapis — przy zapisie w toku/nieudanym kontroler i tak odrzuci
  // cofnięcie (najpierw trzeba dokończyć zapis), więc nie pokazujemy martwego przycisku.
  const canUndoNow = save.status === 'idle';
  const toastNode = toast ? <StatusToast toast={toast} onUndo={canUndoNow ? () => void controller.undoReport() : undefined} /> : null;
  const status = (
    <>
      {toastNode}
      {saveError ? <SaveErrorAlert text={saveErrorText(saveError)} /> : null}
    </>
  );

  const resumeConfig = state.resume && state.resume.sessionId === vm.sessionId ? state.resume.config : null;
  const answeredCount = vm.progress.kind === 'test' ? vm.progress.answeredValid : 0;

  return (
    <>
      <Screen
        header={
          <ProgressHeader
            leading={leading}
            text={progressText(vm)}
            bar={!isReview && vm.progress.kind === 'test' ? { value: vm.progress.answeredValid, max: vm.progress.targetN } : null}
            onReport={vm.canReport && !awaiting ? () => void controller.report() : null}
          />
        }
        footer={<BottomActionBar status={status} onPrevious={onPrevious} primary={primary} hint={hint} />}
        scrollRef={scrollRef}
        scrollKey={`${vm.slotId}:${vm.position}`}
        contentClassName="screen__content--tight"
        label="Pytanie"
      >
        {!state.online ? <OfflineBanner variant="question" /> : null}

        {vm.mode !== 'live' ? (
          <div className="preview-bar">
            <Icon name="visibility" className="preview-bar__icon" />
            <span className="preview-bar__text">
              <b>Podgląd odpowiedzi</b> · {previewText(vm)}
            </span>
            {vm.canJumpToCurrent ? (
              <button type="button" className="btn btn--text" onClick={() => controller.backToCurrent()}>
                Do bieżącego
              </button>
            ) : null}
          </div>
        ) : null}

        {vm.primaryAction === 'go-awaiting' && vm.awaitingElsewhere ? (
          <Banner
            tone="warn"
            role="status"
            title="Wynik jeszcze niedostępny"
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOverlay('confirm-close')}>
                Zamknij test jako niedokończony
              </button>
            }
          >
            <span>
              {vm.awaitingElsewhere.count === 1
                ? `Pytanie ${vm.awaitingElsewhere.position + 1} zostało wykluczone i czeka na pytanie zastępcze — w tym zakresie nie ma już innych dostępnych pytań.`
                : `${vm.awaitingElsewhere.count} ${pluralPl(vm.awaitingElsewhere.count, 'pytanie czeka', 'pytania czekają', 'pytań czeka')} na pytania zastępcze (pierwsze: pytanie ${vm.awaitingElsewhere.position + 1}) — w tym zakresie nie ma już innych dostępnych pytań.`}{' '}
              Test wymaga {vm.progress.kind === 'test' ? questionsCount(vm.progress.targetN) : 'wszystkich pytań'} ocenionych: możesz go dokończyć po imporcie nowych pytań albo zamknąć
              jako niedokończony.
            </span>
          </Banner>
        ) : null}

        {vm.myErrorsExhaustedNotice ? (
          <Banner tone="info" role="status" icon={null}>
            Brak aktywnych błędów w tym zakresie — kontynuujesz zwykłe pytania.
          </Banner>
        ) : null}

        {showQuestion ? (
          <div className="stem-block">
            <div className="q-meta">
              <span className="q-meta__domain">{vm.domainTitle}</span>
              <span className="q-meta__level">{difficultyLabel(vm.difficulty)}</span>
              {vm.retryRoundIndex !== null && !isReview ? <Tag retry>Powtórka · runda {vm.retryRoundIndex}</Tag> : null}
              {vm.originTag === 'repeated_wrong' && !isReview ? <Tag>Z poprzedniej rundy</Tag> : null}
              {vm.originTag === 'seen_filler' && !isReview ? <Tag>Z wcześniejszej nauki</Tag> : null}
              {vm.originTag === 'my_errors' && !isReview ? <Tag>Moje błędy</Tag> : null}
              {vm.excluded && vm.mode !== 'live' ? <Tag>Wykluczone z przyszłej nauki</Tag> : null}
              {vm.reportedLater ? <Tag>Wykluczone później</Tag> : null}
            </div>
            <p className="stem" ref={stemRef} tabIndex={-1}>
              {vm.stem}
            </p>
          </div>
        ) : null}

        {showQuestion && vm.figure ? <FigureBlock figure={vm.figure} zoomLabel="Powiększ schemat" onZoom={() => vm.figure && setZoom(vm.figure)} /> : null}

        {showQuestion ? (
          <AnswerList slotId={vm.slotId} answers={vm.answers} mode={vm.mode} saveFailed={saveError !== null && saveError.action === 'answer'} onAnswer={onAnswer} />
        ) : null}

        {awaiting ? (
          <Banner
            tone="warn"
            role="alert"
            title="Brak pytania zastępczego"
            actions={null}
          >
            <span>
              Pytanie zostało wykluczone, ale w zakresie „{resumeConfig ? configLabel(resumeConfig, { withMyErrors: false }) : 'tej konfiguracji'}” nie ma już innych dostępnych pytań. Test wymaga{' '}
              {vm.progress.kind === 'test' ? questionsCount(vm.progress.targetN) : 'wszystkich pytań'} ocenionych. Możesz go dokończyć po imporcie nowych pytań albo zamknąć jako niedokończony.
            </span>
            <div className="btn-stack" style={{ marginTop: 8 }}>
              {toast?.canUndo && canUndoNow ? (
                <button type="button" className="btn btn--secondary" onClick={() => void controller.undoReport()}>
                  Cofnij zgłoszenie
                </button>
              ) : null}
              <button type="button" className="btn btn--secondary" onClick={() => setOverlay('confirm-close')}>
                Zamknij test jako niedokończony
              </button>
              <button type="button" className="btn btn--text" onClick={() => controller.pauseSession()}>
                Wróć do startu — test zostanie zachowany
              </button>
            </div>
          </Banner>
        ) : null}

        {vm.freeFlowEmpty ? (
          <Banner tone="warn" role="alert" title="W tym zakresie nie ma już dostępnych pytań" icon={null}>
            <span>
              Wszystkie pytania z zakresu zostały wykluczone albo wykorzystane w tej sesji. Zakończ sesję i wybierz szerszy zakres lub przywróć wykluczone pytania w ustawieniach.
            </span>
            <button type="button" className="btn btn--primary" style={{ marginTop: 8 }} onClick={() => void controller.endFreeFlow(vm.sessionId)}>
              Zakończ sesję
            </button>
          </Banner>
        ) : null}

        {showQuestion && vm.answered && vm.explanation ? (
          <ExplanationPanel ref={explRef} explanation={vm.explanation} online={state.online} onZoomFigure={setZoom} />
        ) : null}

        <div className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>
      </Screen>

      {overlay === 'exit' && vm.kind === 'test' ? (
        <Sheet title="Przerwać test?" onClose={() => setOverlay(null)}>
          <p className="sheet__text">Postęp jest zapisany. Wrócisz do tego samego pytania z ekranu startowego — z tą samą kolejnością odpowiedzi.</p>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => controller.pauseSession()}>
            Kontynuuj później
          </button>
          <button type="button" className="btn btn--secondary btn--lg btn--block" onClick={() => setOverlay(null)}>
            Wróć do pytania
          </button>
          <button type="button" className="btn btn--danger-text btn--block" onClick={() => setOverlay('confirm-close')}>
            Zamknij test bez wyniku
          </button>
        </Sheet>
      ) : null}

      {overlay === 'exit' && vm.kind === 'freeflow' ? (
        <Sheet title="Wyjść z Free Flow?" onClose={() => setOverlay(null)}>
          <p className="sheet__text">Możesz wrócić do sesji później albo ją zakończyć i zobaczyć podsumowanie.</p>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => controller.pauseSession()}>
            Kontynuuj później
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--lg btn--block"
            onClick={() => {
              setOverlay(null);
              void controller.endFreeFlow(vm.sessionId);
            }}
          >
            Zakończ sesję
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={() => setOverlay(null)}>
            Wróć do pytania
          </button>
        </Sheet>
      ) : null}

      {overlay === 'confirm-close' ? (
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
                  void controller.closeUnfinished(vm.sessionId);
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
          Zapisane odpowiedzi ({answeredCount}) trafią do historii jako test niedokończony, bez oznaczenia zaliczenia. Nie będzie można go kontynuować.
        </AlertDialog>
      ) : null}

      {zoom ? <ZoomViewer figure={zoom} onClose={() => setZoom(null)} /> : null}
    </>
  );
}
