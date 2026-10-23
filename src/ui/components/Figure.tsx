/**
 * FigureBlock + ZoomViewer (PRZEKAZANIE §6, §10; S10–S11).
 * - Wersja pytania nie ujawnia klucza: alt i podpis pochodzą z `FigureVM` wersji pytania;
 *   wersja objaśnienia trafia do UI dopiero po odpowiedzi (model widoku jej wcześniej nie zawiera).
 * - Bez atrybutu `title` na obrazie (nie dubluje treści i nie zdradza nazwy pliku).
 * - Powiększenie 100–300% (krok 50%), „Dopasuj”, przewijanie w obu osiach, „Opis tekstowy”.
 */
import { useRef, useState } from 'react';
import type { FigureVM } from '../../app/viewModels';
import { useFocusTrap } from '../hooks';
import { Icon } from './Icon';

/** Adres pliku figury względem `base` aplikacji (GitHub Pages pod podścieżką). */
export function figureUrl(src: string): string {
  if (/^(data:|blob:)/.test(src)) return src;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.replace(/\/?$/, '/')}${src.replace(/^\.?\//, '')}`;
}

export interface FigureBlockProps {
  figure: FigureVM;
  /** Etykieta przycisku powiększenia (pytanie / objaśnienie — §13). */
  zoomLabel: string;
  onZoom: () => void;
}

export function FigureBlock({ figure, zoomLabel, onZoom }: FigureBlockProps) {
  return (
    <figure className="figure">
      <img className="figure__img" src={figureUrl(figure.src)} alt={figure.alt} loading="lazy" decoding="async" />
      <figcaption className="figure__caption">
        <span className="figure__caption-text">{figure.caption}</span>
        <button type="button" className="btn btn--secondary figure__zoom" aria-label={zoomLabel} onClick={onZoom}>
          <Icon name="zoom_in" />
          Powiększ
        </button>
      </figcaption>
    </figure>
  );
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.5;

export interface ZoomViewerProps {
  figure: FigureVM;
  onClose: () => void;
}

export function ZoomViewer({ figure, onClose }: ZoomViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [showDesc, setShowDesc] = useState(false);
  useFocusTrap(ref, { onEscape: onClose });
  const pct = Math.round(zoom * 100);
  return (
    <div ref={ref} className="zoom" role="dialog" aria-modal="true" aria-label="Powiększony schemat" tabIndex={-1}>
      <div className="zoom__header">
        <h2 className="zoom__title">{figure.caption}</h2>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
          <Icon name="close" />
          Zamknij
        </button>
      </div>
      <div className="zoom__stage">
        <div className="zoom__canvas" style={{ width: `${pct}%` }}>
          <img src={figureUrl(figure.src)} alt={figure.alt} decoding="async" />
        </div>
      </div>
      {showDesc ? (
        <div className="zoom__desc" id="zoom-desc">
          <h3 className="zoom__desc-title">Opis tekstowy schematu</h3>
          {figure.alt}
        </div>
      ) : null}
      <div className="zoom__controls">
        <button
          type="button"
          className="zoom__step"
          aria-label="Pomniejsz"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        >
          <Icon name="remove" size={22} />
        </button>
        <span className="zoom__pct" aria-live="polite">
          {pct}%
        </span>
        <button
          type="button"
          className="zoom__step"
          aria-label="Powiększ"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        >
          <Icon name="add" size={22} />
        </button>
        <button type="button" className="btn btn--text btn--sm" onClick={() => setZoom(ZOOM_MIN)}>
          Dopasuj
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm zoom__desc-toggle"
          aria-expanded={showDesc}
          aria-controls={showDesc ? 'zoom-desc' : undefined}
          onClick={() => setShowDesc((v) => !v)}
        >
          {showDesc ? 'Ukryj opis' : 'Opis tekstowy'}
        </button>
      </div>
    </div>
  );
}
