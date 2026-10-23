/**
 * ExplanationPanel (PRZEKAZANIE §6) — tylko po odpowiedzi:
 * „Dlaczego ta odpowiedź jest poprawna”, akapit z banku (wyłącznie poprawny wariant, bez odwołań
 * do liter A–D — litery są pozycyjne i zmieniają się z kolejnością), opcjonalny schemat objaśniający,
 * „Rozwiń szerszy kontekst” (kontekst TEMATU pytania z bank.topics, opisany jako taki) i źródła.
 *
 * SourceRow: tytuł z rejestru, rodzaj i zakres odczytu; po rozwinięciu „Gdzie w źródle”, DOI, PMID
 * i „Otwórz publikację” (link `target="_blank"` `rel="noopener noreferrer"`, wyłącznie https z rejestru).
 * Offline: komunikat; treść pozostaje dostępna lokalnie.
 */
import { forwardRef, useId, useState } from 'react';
import type { ExplanationVM, FigureVM, SourceVM } from '../../app/viewModels';
import { isSafeHttpsUrl, locatorForSource } from '../format';
import { Icon } from './Icon';
import { FigureBlock } from './Figure';

export interface SourceRowProps {
  source: SourceVM;
  locator: string;
  online: boolean;
}

export function SourceRow({ source, locator, online }: SourceRowProps) {
  const [open, setOpen] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const detailsId = useId();
  const url = isSafeHttpsUrl(source.url) ? source.url : null;
  const meta = [source.kindPl, source.accessPl].filter((x) => x && x.trim()).join(' · ');
  return (
    <li className="source-row">
      <button
        type="button"
        className="source-row__toggle"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => {
          setOpen((v) => !v);
          setOfflineNotice(false);
        }}
      >
        <Icon name="description" className="source-row__icon" />
        <span className="source-row__body">
          <span className="source-row__title">{source.title}</span>
          {meta ? <span className="source-row__meta">{meta}</span> : null}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={22} className="source-row__icon" />
      </button>
      {open ? (
        <div className="source-row__details" id={detailsId}>
          {locator ? (
            <div>
              <span className="source-row__label">Gdzie w źródle: </span>
              {locator}
            </div>
          ) : null}
          {source.doi ? (
            <div>
              <span className="source-row__label">DOI: </span>
              {source.doi}
            </div>
          ) : null}
          {source.pmid ? (
            <div>
              <span className="source-row__label">PMID: </span>
              {source.pmid}
            </div>
          ) : null}
          {url && online ? (
            <a className="btn btn--secondary source-row__open" href={url} target="_blank" rel="noopener noreferrer">
              Otwórz publikację
              <Icon name="open_in_new" size={18} />
            </a>
          ) : null}
          {url && !online ? (
            <button type="button" className="btn btn--secondary source-row__open" onClick={() => setOfflineNotice(true)}>
              Otwórz publikację
              <Icon name="open_in_new" size={18} />
            </button>
          ) : null}
          {url && !online && offlineNotice ? (
            <div className="banner banner--plain" role="status">
              <div className="banner__row">
                <Icon name="wifi_off" size={18} className="banner__icon" />
                <span>Publikacji nie można teraz otworzyć — brak połączenia. Tytuł, identyfikator i objaśnienie pozostają dostępne offline.</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export interface ExplanationPanelProps {
  explanation: ExplanationVM;
  online: boolean;
  onZoomFigure?: (figure: FigureVM) => void;
}

export const ExplanationPanel = forwardRef<HTMLElement, ExplanationPanelProps>(function ExplanationPanel({ explanation, online, onZoomFigure }, ref) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const context = explanation.context;
  const hasContext = context !== null && (context.pearls.length > 0 || (context.learningObjective ?? '').trim() !== '');
  return (
    <section ref={ref} className="expl" aria-label="Wyjaśnienie poprawnej odpowiedzi">
      {/* tabIndex −1: cel fokusu po odpowiedzi wybranej klawiaturą (UI-03), poza kolejnością Tab. */}
      <h2 className="expl__title" tabIndex={-1}>
        Dlaczego ta odpowiedź jest poprawna
      </h2>
      <p className="expl__text">{explanation.text}</p>
      {explanation.figure ? (
        <FigureBlock figure={explanation.figure} zoomLabel="Powiększ schemat objaśniający" onZoom={() => explanation.figure && onZoomFigure?.(explanation.figure)} />
      ) : null}
      {hasContext && context ? (
        <div className="expl__more">
          <button type="button" className="expl__more-toggle" aria-expanded={moreOpen} aria-controls={moreOpen ? moreId : undefined} onClick={() => setMoreOpen((v) => !v)}>
            <Icon name={moreOpen ? 'expand_less' : 'expand_more'} size={22} />
            {moreOpen ? 'Zwiń szerszy kontekst' : 'Rozwiń szerszy kontekst'}
          </button>
          {moreOpen ? (
            <div className="expl__more-body" id={moreId}>
              <div className="expl__more-title">Szerszy kontekst tematu: {context.topicTitle}</div>
              {context.learningObjective ? <p className="expl__more-objective">{context.learningObjective}</p> : null}
              {context.pearls.length > 0 ? (
                <ul className="expl__more-list">
                  {context.pearls.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {explanation.sources.length > 0 ? (
        <div className="expl__sources">
          <h3 className="expl__sources-title">Źródła</h3>
          <ul className="source-list" role="list">
            {explanation.sources.map((s) => (
              <SourceRow key={s.id} source={s} locator={locatorForSource(explanation.sourceLocator, s.id)} online={online} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
});
