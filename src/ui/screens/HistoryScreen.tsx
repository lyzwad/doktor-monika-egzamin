/**
 * S20 Historia: zakładki „Testy | Free Flow”. Testy: filtr konfiguracji („Porównuj podobne testy”),
 * wykres TYLKO ukończonych testów (● test, ◆ powtórka, próg 65%), wybrany punkt ze szczegółami,
 * lista testów (także niedokończonych — tylko na liście). Free Flow: osobna lista, bez progu.
 * Pusta historia: komunikat z wejściem do trybów, bez wykresu-zera.
 */
import { useState } from 'react';
import { useController } from '../../app/ControllerContext';
import type { HistoryTab } from '../../app/routes';
import type { HistoryTestItemVM, HistoryVM } from '../../app/viewModels';
import { Segmented, Tag } from '../components/Controls';
import { HistoryChart } from '../components/HistoryChart';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader, cx } from '../components/Screen';
import { RadioList, Sheet } from '../components/Sheet';
import { configLabel, formatDate, formatPercentValue, pluralPl } from '../format';

const ALL_KEY = '__all__';

function testMain(t: HistoryTestItemVM): string {
  if (t.status === 'completed') return `${t.correct} z ${t.targetN}${t.percentText ? ` · ${t.percentText}` : ''}`;
  return `${t.answeredValid} z ${t.targetN} ocenionych`;
}

function testStatus(t: HistoryTestItemVM): string {
  if (t.status === 'interrupted') return 'Przerwany aktualizacją banku pytań';
  if (t.status !== 'completed') return 'Niedokończony';
  return t.passed ? 'Zaliczony' : 'Próg nieosiągnięty';
}

export function HistoryScreen({ vm }: { vm: HistoryVM }) {
  const controller = useController();
  const [filterOpen, setFilterOpen] = useState(false);
  const filterKey = vm.filter.kind === 'all' ? ALL_KEY : vm.filter.key;
  const filterOptions = [
    { value: ALL_KEY, label: 'Wszystkie konfiguracje' },
    ...vm.configOptions.map((o) => ({ value: o.key, label: configLabel(o.config, { withN: true }) })),
  ];
  const filterLabel = filterOptions.find((o) => o.value === filterKey)?.label ?? 'Wszystkie konfiguracje';
  const hasAnyTests = vm.tests.length > 0 || vm.chart.length > 0 || vm.filter.kind !== 'all';
  const selected = vm.selectedPoint;
  const selectedItem = selected ? vm.tests.find((t) => t.sessionId === selected.sessionId) ?? null : null;

  return (
    <>
      <Screen header={<ScreenHeader title="Historia" onBack={() => controller.goBack()} />} contentClassName="screen__content--tight">
        <Segmented<HistoryTab>
          kind="tablist"
          label="Rodzaj historii"
          options={[
            { value: 'tests', label: 'Testy' },
            { value: 'freeflow', label: 'Free Flow' },
          ]}
          value={vm.tab}
          onChange={(tab) => controller.setHistoryTab(tab)}
        />

        {vm.tab === 'tests' ? (
          <div role="tabpanel" aria-label="Testy" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!hasAnyTests ? (
              <div className="empty-state">
                <Icon name="history" size={30} style={{ color: 'var(--text-3)' }} />
                <div className="empty-state__title">Brak ukończonych testów</div>
                <div className="empty-state__text">Tu pojawią się wyniki testów i prosty wykres. Sesje Free Flow mają osobną listę.</div>
                <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>
                  <button type="button" className="btn btn--primary" onClick={() => controller.openConfig('test')}>
                    Rozpocznij test
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => controller.openConfig('freeflow')}>
                    Free Flow
                  </button>
                </div>
              </div>
            ) : (
              <>
                {vm.configOptions.length > 0 ? (
                  <button type="button" className="filter-btn" aria-haspopup="dialog" onClick={() => setFilterOpen(true)}>
                    <Icon name="tune" style={{ color: 'var(--text-2)' }} />
                    <span className="filter-btn__body">
                      <span className="filter-btn__label">Konfiguracja</span>
                      <span className="filter-btn__value">{filterLabel}</span>
                    </span>
                    <Icon name="expand_more" size={22} style={{ color: 'var(--text-3)' }} />
                  </button>
                ) : null}
                <HistoryChart
                  points={vm.chart}
                  selectedId={selected?.sessionId ?? null}
                  onSelect={(id) => controller.selectChartPoint(id)}
                  footer={
                    selected ? (
                      <div className="chart__selected" role="status">
                        <div className="chart__selected-body">
                          <span className="chart__selected-title">
                            {formatDate(selected.at)} · {selected.isRetry ? `Powtórka${selected.roundIndex ? ` · runda ${selected.roundIndex}` : ''}` : 'Test'}
                          </span>
                          <span className="tabular-nums">
                            {selectedItem ? `${selectedItem.correct} z ${selectedItem.targetN} · ` : ''}
                            {formatPercentValue(selected.percent)} · {selected.passed ? 'zaliczony' : 'próg nieosiągnięty'}
                          </span>
                          {selectedItem ? <span className="muted">{configLabel(selectedItem.config, { withN: true })}</span> : null}
                        </div>
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => controller.openHistoryEntry(selected.sessionId)}>
                          Szczegóły
                        </button>
                      </div>
                    ) : null
                  }
                />
                {vm.chart.length === 0 && vm.tests.length > 0 ? (
                  <p className="meta">Wykres pokazuje tylko ukończone testy. Niedokończone są wyłącznie na liście.</p>
                ) : null}
                {vm.tests.length > 0 ? (
                  <ul className="list" role="list" aria-label="Lista testów">
                    {vm.tests.map((t) => (
                      <li key={t.sessionId}>
                        <button type="button" className="list-row" style={{ gap: 10, paddingLeft: 14 }} onClick={() => controller.openHistoryEntry(t.sessionId)}>
                          <span className="list-row__body" style={{ gap: 3 }}>
                            <span className="review-row__meta">
                              <span className="history-row__main">{testMain(t)}</span>
                              <span className={cx('history-row__status', t.passed === true && 'history-row__status--pass')}>{testStatus(t)}</span>
                              {t.isRetry ? (
                                <Tag retry small>
                                  Powtórka
                                </Tag>
                              ) : null}
                            </span>
                            <span className="list-row__subtitle">
                              {formatDate(t.closedAt ?? t.createdAt)} · {configLabel(t.config, { withN: true })}
                              {t.legacy ? ' · poprzednia wersja banku' : ''}
                            </span>
                          </span>
                          <Icon name="chevron_right" size={22} className="list-row__chevron" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state__title">Brak testów w tej konfiguracji</div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div role="tabpanel" aria-label="Free Flow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {vm.freeFlow.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__title">Brak sesji Free Flow</div>
                <div className="empty-state__text">Po zakończeniu sesji Free Flow zobaczysz tu liczbę ocenionych pytań i odsetek poprawnych.</div>
                <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>
                  <button type="button" className="btn btn--primary" onClick={() => controller.openConfig('freeflow')}>
                    Rozpocznij Free Flow
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => controller.openConfig('test')}>
                    Test
                  </button>
                </div>
              </div>
            ) : (
              <ul className="list" role="list" aria-label="Lista sesji Free Flow">
                {vm.freeFlow.map((f) => (
                  <li key={f.sessionId}>
                    <button type="button" className="list-row" style={{ gap: 10, paddingLeft: 14 }} onClick={() => controller.openHistoryEntry(f.sessionId)}>
                      <span className="list-row__body" style={{ gap: 3 }}>
                        <span className="history-row__main">
                          {f.answeredValid > 0
                            ? `${f.answeredValid} ${pluralPl(f.answeredValid, 'ocenione pytanie', 'ocenione pytania', 'ocenionych pytań')}${f.percentText ? ` · ${f.percentText} poprawnych` : ''}`
                            : 'Brak ocenionych pytań'}
                        </span>
                        {f.interrupted ? <span className="history-row__status">Przerwany aktualizacją banku pytań</span> : null}
                        <span className="list-row__subtitle">
                          {formatDate(f.closedAt ?? f.createdAt)} · {configLabel(f.config)}
                          {f.legacy ? ' · poprzednia wersja banku' : ''}
                        </span>
                      </span>
                      <Icon name="chevron_right" size={22} className="list-row__chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Screen>

      {filterOpen ? (
        <Sheet title="Porównuj podobne testy" onClose={() => setFilterOpen(false)}>
          <p className="meta">Wykres i lista pokażą tylko testy z wybraną konfiguracją.</p>
          <RadioList<string>
            label="Konfiguracja"
            options={filterOptions}
            value={filterKey}
            onSelect={(key) => {
              controller.setHistoryFilter(key === ALL_KEY ? { kind: 'all' } : { kind: 'config', key });
              setFilterOpen(false);
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}
