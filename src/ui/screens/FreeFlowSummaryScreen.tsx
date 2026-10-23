/**
 * S19 Podsumowanie Free Flow: liczba ocenionych pytań i poprawnych, bez progu zaliczenia.
 * Zero odpowiedzi → „Nie udzielono jeszcze odpowiedzi” (bez procentu, bez dzielenia przez zero).
 */
import { useController } from '../../app/ControllerContext';
import type { FreeFlowSummaryVM } from '../../app/viewModels';
import { Screen, ScreenHeader } from '../components/Screen';
import { configLabel, formatDateTime, pluralPl } from '../format';

export function FreeFlowSummaryScreen({ vm }: { vm: FreeFlowSummaryVM }) {
  const controller = useController();
  const fresh = vm.origin === 'session';
  const hasAnswers = vm.answeredValid > 0;
  return (
    <Screen header={<ScreenHeader title="Free Flow" onBack={() => controller.goBack()} />}>
      <section className="card card--pad-lg result-card" aria-label="Podsumowanie sesji">
        <div className="card__title">{fresh ? 'Sesja zakończona' : 'Sesja Free Flow'}</div>
        {hasAnswers ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="result-card__score" style={{ gap: '4px 10px' }}>
              <span className="score">{vm.answeredValid}</span>
              <span style={{ fontSize: 'var(--fs-body)' }}>{pluralPl(vm.answeredValid, 'ocenione pytanie', 'ocenione pytania', 'ocenionych pytań')}</span>
            </div>
            <div className="tabular-nums" style={{ fontSize: 'var(--fs-body)' }}>
              Poprawne: {vm.correct} z {vm.answeredValid}
              {vm.percentText ? ` · ${vm.percentText}` : ''}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>Nie udzielono jeszcze odpowiedzi</div>
            <div className="meta">Sesja bez ocenionych pytań nie ma wyniku procentowego.</div>
          </div>
        )}
        <div className="kv" style={{ paddingTop: 12 }}>
          <div className="kv__row">
            <span className="kv__key">Konfiguracja</span>
            <span className="kv__value">{configLabel(vm.config)}</span>
          </div>
          <div className="kv__row">
            <span className="kv__key">Data</span>
            <span className="kv__value tabular-nums">{formatDateTime(vm.closedAt ?? vm.createdAt)}</span>
          </div>
        </div>
      </section>
      <p className="meta">Free Flow nie ma progu zaliczenia. Sesja jest zapisana w historii Free Flow, osobno od testów.</p>
      <div className="btn-stack">
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => controller.goHome()}>
          Wróć do startu
        </button>
        {fresh ? (
          <button type="button" className="btn btn--secondary btn--lg btn--block" onClick={() => controller.openHistory('freeflow')}>
            Zobacz historię Free Flow
          </button>
        ) : null}
      </div>
    </Screen>
  );
}
