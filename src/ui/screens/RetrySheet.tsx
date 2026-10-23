/**
 * S18 — arkusz „Nowa runda” / „Nowa runda: Powtórka”: skład rundy (do poprawy + nowe + z wcześniejszej
 * nauki), konfiguracja dziedziczona, informacja o uzupełnieniu, blokada przy zbyt małej puli.
 * Liczby pochodzą z `RetryPreviewVM` (domena).
 */
import { useAppState, useController } from '../../app/ControllerContext';
import type { RetryPreviewVM } from '../../app/viewModels';
import { Banner } from '../components/Banner';
import { Sheet } from '../components/Sheet';
import { configLabel, pluralPl, questionsCount } from '../format';

function joinPl(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} i ${parts[parts.length - 1]}`;
}

/** „7 do poprawy”, „13 nowych”, „2 z wcześniejszej nauki”. */
export function retryParts(p: Pick<RetryPreviewVM, 'repeatedWrong' | 'fillersUnseen' | 'fillersSeen'>): string[] {
  const parts: string[] = [];
  if (p.repeatedWrong) parts.push(`${p.repeatedWrong} do poprawy`);
  if (p.fillersUnseen) parts.push(`${p.fillersUnseen} ${pluralPl(p.fillersUnseen, 'nowe', 'nowe', 'nowych')}`);
  if (p.fillersSeen) parts.push(`${p.fillersSeen} z wcześniejszej nauki`);
  return parts;
}

export function RetrySheet({ sessionId, preview, onClose }: { sessionId: string; preview: RetryPreviewVM; onClose: () => void }) {
  const controller = useController();
  const state = useAppState();
  const parts = retryParts(preview);
  const title = preview.isRetry ? 'Nowa runda: Powtórka' : 'Nowa runda';
  const open = state.resume;
  const blocked = preview.insufficientCapacity !== null;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sheet__lead">
        {questionsCount(preview.targetN)}
        {parts.length ? `: ${joinPl(parts)}` : ''}
      </div>
      <div className="meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span>{configLabel(preview.config, { withMyErrors: true })} — jak w poprzedniej rundzie</span>
        <span>
          {preview.isRetry
            ? 'Pytania do poprawy zostaną wymieszane z pozostałymi. Kolejność odpowiedzi może się zmienić.'
            : 'Kolejność pytań i odpowiedzi zostanie wylosowana.'}
        </span>
      </div>
      {preview.fillersSeen > 0 ? (
        <Banner tone="info" role="status" icon={null}>
          Niewidzianych pytań w tym zakresie: {preview.fillersUnseen}. Brakujące {preview.fillersSeen} uzupełnimy pytaniami z wcześniejszej nauki — najdawniej widzianymi.
        </Banner>
      ) : null}
      {blocked ? (
        <Banner tone="warn" role="alert" icon="warning_amber">
          Za mało dostępnych pytań, aby uzupełnić rundę do {preview.targetN} (dostępne: {preview.insufficientCapacity}). Zmień konfigurację albo zaimportuj pulę pytań.
        </Banner>
      ) : null}
      {open && !blocked ? (
        <Banner tone="plain" icon={null}>
          {open.kind === 'test'
            ? `Masz przerwany test (${open.answeredValid}/${open.targetN ?? 0}). Rozpoczęcie rundy zapisze go w historii jako niedokończony.`
            : 'Masz przerwaną sesję Free Flow. Rozpoczęcie rundy zapisze ją w historii.'}
        </Banner>
      ) : null}
      {!blocked ? (
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={() => {
            onClose();
            void controller.startRetryRound(sessionId);
          }}
        >
          Rozpocznij rundę
        </button>
      ) : null}
      <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
        Anuluj
      </button>
    </Sheet>
  );
}
