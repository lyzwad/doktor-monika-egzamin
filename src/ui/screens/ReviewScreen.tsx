/**
 * S17 Przegląd odpowiedzi (lista): filtr „Wszystkie / Tylko błędy” (Segmented), wiersze z numerem,
 * statusem (ikona + tekst), domeną, adnotacją „Wykluczone później” i skrótem treści.
 * Brak błędów → komunikat i „Nowa runda”. Szczegół pozycji = ekran pytania w trybie `review`.
 */
import { useState } from 'react';
import { useController } from '../../app/ControllerContext';
import type { ReviewItemVM, ReviewVM } from '../../app/viewModels';
import type { ReviewFilter } from '../../app/routes';
import { Segmented, Tag } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader, cx } from '../components/Screen';
import { configLabel, formatDate } from '../format';
import { RetrySheet } from './RetrySheet';

const STATUS_TEXT: Record<ReviewItemVM['status'], string> = {
  correct: 'Poprawna',
  wrong: 'Błędna',
  excluded: 'Wykluczone',
  unanswered: 'Bez odpowiedzi',
};

export function ReviewScreen({ vm }: { vm: ReviewVM }) {
  const controller = useController();
  const [retryOpen, setRetryOpen] = useState(false);
  const subtitle = [vm.createdAt ? `${vm.kind === 'test' ? 'Test' : 'Sesja Free Flow'} z ${formatDate(vm.createdAt)}` : null, vm.config ? configLabel(vm.config) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Screen
        header={<ScreenHeader title="Przegląd odpowiedzi" onBack={() => controller.goBack()} backLabel={vm.kind === 'test' ? 'Wróć do wyniku' : 'Wstecz'} />}
        contentClassName="screen__content--tight"
      >
        {subtitle ? <p className="meta">{subtitle}</p> : null}
        <Segmented<ReviewFilter>
          label="Filtr przeglądu"
          minItemWidth="7.6rem"
          options={[
            { value: 'all', label: `Wszystkie · ${vm.counts.all}` },
            { value: 'wrong', label: `Tylko błędy · ${vm.counts.wrong}` },
          ]}
          value={vm.filter}
          onChange={(f) => controller.setReviewFilter(f)}
        />
        {vm.filter === 'wrong' && vm.counts.wrong === 0 ? (
          <div className="empty-state">
            <Icon name="check_circle" size={30} style={{ color: 'var(--ok)' }} />
            <div className="empty-state__title">W tej rundzie nie było błędnych odpowiedzi</div>
            {vm.canStartRetry && vm.retryPreview ? (
              <button type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={() => setRetryOpen(true)}>
                Nowa runda
              </button>
            ) : null}
          </div>
        ) : null}
        {vm.items.length > 0 ? (
          <ul className="list" role="list" aria-label="Pozycje przeglądu">
            {vm.items.map((item) => (
              <li key={item.slotId}>
                <button type="button" className="review-row" onClick={() => controller.openReviewItem(item.slotId)}>
                  <span className="review-row__num">{item.number}</span>
                  <span className="review-row__body">
                    <span className="review-row__meta">
                      <span className={cx('review-row__status', item.status === 'correct' && 'review-row__status--correct', item.status === 'wrong' && 'review-row__status--wrong')}>
                        {item.status === 'correct' ? <Icon name="check_circle" size={18} /> : null}
                        {item.status === 'wrong' ? <Icon name="cancel" size={18} /> : null}
                        {item.status === 'excluded' ? <Icon name="outlined_flag" size={18} /> : null}
                        {STATUS_TEXT[item.status]}
                      </span>
                      <span className="review-row__domain">{item.domainTitle}</span>
                      {item.reportedLater ? <Tag small>Wykluczone później</Tag> : null}
                    </span>
                    <span className="review-row__stem clamp-2">{item.stem}</span>
                  </span>
                  <Icon name="chevron_right" size={22} className="review-row__chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Screen>
      {retryOpen && vm.retryPreview ? <RetrySheet sessionId={vm.sessionId} preview={vm.retryPreview} onClose={() => setRetryOpen(false)} /> : null}
    </>
  );
}
