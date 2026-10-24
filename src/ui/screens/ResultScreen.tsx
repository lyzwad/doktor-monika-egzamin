/**
 * S16 Wynik testu: status (zaliczony / próg nieosiągnięty / niedokończony — ikona + tekst),
 * „13 z 20” i procent (tylko ukończony), próg, konfiguracja, skład rundy, data.
 * Akcje: „Uwzględnij błędy” / „Nowa runda” (arkusz S18), „Przejrzyj odpowiedzi”, „Przejrzyj błędy”,
 * „Wróć do startu”. Z historii „Wstecz” wraca do historii.
 */
import { useState } from 'react';
import { useController } from '../../app/ControllerContext';
import type { ResultVM } from '../../app/viewModels';
import { Tag } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader, cx } from '../components/Screen';
import { configLabel, formatDateTime, pluralPl, questionsCount } from '../format';
import { RetrySheet, retryParts } from './RetrySheet';

export function ResultScreen({ vm }: { vm: ResultVM }) {
  const controller = useController();
  const [retryOpen, setRetryOpen] = useState(false);
  const completed = vm.status === 'passed' || vm.status === 'failed';
  const statusText =
    vm.status === 'passed'
      ? 'Test zaliczony'
      : vm.status === 'failed'
        ? 'Próg nieosiągnięty'
        : vm.status === 'interrupted'
          ? 'Przerwany aktualizacją banku pytań'
          : 'Test niedokończony';
  const statusIcon = vm.status === 'passed' ? 'check_circle' : vm.status === 'failed' ? 'info' : 'pause';
  const isRetryRound = vm.retry !== null && vm.retry.repeatedCount > 0;
  const preview = vm.retryPreview;
  const composition = vm.composition;
  const compositionText =
    vm.retry && composition
      ? [
          composition.repeatedWrong ? `${composition.repeatedWrong} z poprzedniej rundy` : '',
          composition.myErrors ? `${composition.myErrors} z „Moich błędów”` : '',
          composition.fillersUnseen ? `${composition.fillersUnseen} ${pluralPl(composition.fillersUnseen, 'nowe', 'nowe', 'nowych')}` : '',
          composition.fillersSeen ? `${composition.fillersSeen} z wcześniejszej nauki` : '',
        ]
          .filter(Boolean)
          .join(' + ')
      : '';
  const retryLabel = preview && preview.repeatedWrong > 0 ? 'Uwzględnij błędy' : 'Nowa runda';
  const retrySub = preview
    ? preview.repeatedWrong > 0
      ? retryParts(preview).map((p, i) => (i === 0 ? p.replace(' do poprawy', ` ${pluralPl(preview.repeatedWrong, 'pytanie', 'pytania', 'pytań')} do poprawy`) : p)).join(' + ')
      : `${questionsCount(preview.targetN)} · ta sama konfiguracja`
    : '';
  const fromHistory = vm.origin === 'history';

  return (
    <>
      <Screen
        header={
          <ScreenHeader
            title="Wynik testu"
            onBack={fromHistory ? () => controller.goBack() : () => controller.goHome()}
            backLabel={fromHistory ? 'Wstecz' : 'Zamknij i wróć do startu'}
            backIcon={fromHistory ? 'arrow_back' : 'close'}
          />
        }
      >
        <section className="card card--pad-lg result-card" aria-label="Wynik">
          <div className="result-card__tags">
            <span className={cx('status-pill', vm.status === 'passed' && 'status-pill--pass')}>
              <Icon name={statusIcon} />
              {statusText}
            </span>
            {vm.retry ? <Tag retry={isRetryRound}>{isRetryRound ? `Powtórka · runda ${vm.retry.roundIndex}` : `Runda ${vm.retry.roundIndex}`}</Tag> : null}
          </div>
          <div className="result-card__score">
            <span className="score">
              {completed ? vm.correct : vm.answeredValid} z {vm.targetN}
            </span>
            {completed && vm.percentText ? <span className="score-pct">{vm.percentText}</span> : null}
          </div>
          <div className="result-card__sub">
            {completed ? pluralPl(vm.correct, 'poprawna odpowiedź', 'poprawne odpowiedzi', 'poprawnych odpowiedzi') : 'ocenionych pytań, bez wyniku zaliczenia'}
          </div>
          <div className="kv">
            <div className="kv__row">
              <span className="kv__key">Próg zaliczenia</span>
              <span className="kv__value tabular-nums">
                65% — co najmniej {vm.thresholdCorrect} z {vm.targetN}
              </span>
            </div>
            <div className="kv__row">
              <span className="kv__key">Konfiguracja</span>
              <span className="kv__value">{configLabel(vm.config, { withN: true })}</span>
            </div>
            {compositionText ? (
              <div className="kv__row">
                <span className="kv__key">Skład rundy</span>
                <span className="kv__value">{compositionText}</span>
              </div>
            ) : null}
            <div className="kv__row">
              <span className="kv__key">Data</span>
              <span className="kv__value tabular-nums">{formatDateTime(vm.closedAt ?? vm.createdAt)}</span>
            </div>
          </div>
        </section>
        {vm.legacy ? <LegacyNotice /> : null}
        <p className="meta">
          {completed
            ? 'Wynik dotyczy tego treningu. Nie jest oceną komisji ani prognozą wyniku egzaminu.'
            : vm.status === 'interrupted'
              ? 'Test przerwany aktualizacją banku pytań nie otrzymuje wyniku, nie trafia na wykres i nie można go wznowić.'
              : 'Niedokończony test nie otrzymuje wyniku zaliczenia i nie trafia na wykres.'}
        </p>
        <div className="btn-stack" style={{ marginTop: 4 }}>
          {vm.canStartRetry && preview ? (
            <button type="button" className="btn btn--primary btn--block" style={{ minHeight: 60 }} aria-haspopup="dialog" onClick={() => setRetryOpen(true)}>
              <span className="btn__stack">
                <span style={{ fontSize: 'var(--fs-body)' }}>{retryLabel}</span>
                <span className="btn__sub">{retrySub}</span>
              </span>
            </button>
          ) : null}
          {vm.legacy ? null : (
            <button type="button" className="btn btn--secondary btn--lg btn--block" onClick={() => controller.openReview(vm.sessionId, 'all')}>
              Przejrzyj odpowiedzi
            </button>
          )}
          {vm.wrongCount > 0 && !vm.legacy ? (
            <button type="button" className="btn btn--secondary btn--lg btn--block" onClick={() => controller.openReview(vm.sessionId, 'wrong')}>
              Przejrzyj błędy ({vm.wrongCount})
            </button>
          ) : null}
          <button type="button" className="btn btn--text btn--block" onClick={() => controller.goHome()}>
            Wróć do startu
          </button>
        </div>
      </Screen>
      {retryOpen && preview ? <RetrySheet sessionId={vm.sessionId} preview={preview} onClose={() => setRetryOpen(false)} /> : null}
    </>
  );
}

/** Sesja z poprzedniej wersji banku: tylko podsumowanie (docs/MIGRACJA_V15.md). */
export function LegacyNotice() {
  return (
    <div className="banner banner--info" role="note">
      <div className="banner__row">
        <Icon name="info" className="banner__icon" />
        <span className="banner__lead">Treść pytań poprzedniej wersji banku nie jest dostępna</span>
      </div>
      <span className="banner__text">
        Ta sesja pochodzi sprzed aktualizacji banku pytań do wersji V15. Zachowano podsumowanie wyniku; przegląd odpowiedzi i runda błędów nie są dostępne.
      </span>
    </div>
  );
}
