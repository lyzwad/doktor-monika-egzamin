/**
 * AnswerCard (PRZEKAZANIE §6) — cała karta jest przyciskiem tylko przed odpowiedzią (tryb `live`).
 * Stany: neutral, pressed (`:active`), pending, selected-correct, selected-wrong, correct-unselected,
 * rest-after-eval oraz podgląd historyczny (podpisy „Twoja odpowiedź — poprawna/błędna”).
 * Po ocenie karta przestaje być przyciskiem: drugie dotknięcie nic nie robi i nie animuje.
 *
 * Ochrona przed podpowiedzią (B04): przed oceną karta nie ma żadnych atrybutów ani tekstów
 * wskazujących poprawność (model widoku nie zawiera klucza).
 */
import { useRef } from 'react';
import type { AnswerCardVM, QuestionMode } from '../../app/viewModels';
import type { OptionId, SlotId } from '../../domain/types';
import type { IconName } from '../icons';
import { Icon } from './Icon';
import { cx } from './Screen';

interface Caption {
  icon: IconName | null;
  text: string;
  /** Dopowiedzenie tylko dla czytników ekranu. */
  srSuffix?: string;
}

function captionFor(state: AnswerCardVM['state'], mode: QuestionMode, saveFailed: boolean): Caption | null {
  const history = mode !== 'live';
  switch (state) {
    case 'neutral':
    case 'rest-after-eval':
      return null;
    case 'pending':
      return { icon: null, text: saveFailed ? 'Wybrana — niezapisana' : 'Wybrana — zapisywanie…' };
    case 'selected-correct':
      return history
        ? { icon: 'check_circle', text: 'Twoja odpowiedź — poprawna' }
        : { icon: 'check_circle', text: 'Poprawna odpowiedź', srSuffix: ' (Twój wybór)' };
    case 'correct-unselected':
      return { icon: 'check_circle', text: 'Poprawna odpowiedź' };
    case 'selected-wrong':
      return { icon: 'cancel', text: 'Twoja odpowiedź — błędna' };
  }
}

export interface AnswerCardProps {
  vm: AnswerCardVM;
  mode: QuestionMode;
  /**
   * Wywoływane przy dotknięciu karty-przycisku (blokadę podwójnego dotknięcia trzyma `AnswerList`).
   * `withFocus` — wybór klawiaturą/technologią asystującą albo przycisk miał fokus: po ocenie fokus
   * trzeba przenieść (karta przestaje być przyciskiem — UI-03), przy zwykłym dotknięciu nie.
   */
  onSelect?: (optionId: OptionId, withFocus: boolean) => void;
  saveFailed?: boolean;
}

export function AnswerCard({ vm, mode, onSelect, saveFailed = false }: AnswerCardProps) {
  const isButton = vm.interactive && vm.state === 'neutral' && mode === 'live' && onSelect !== undefined;
  const letter = (
    <span className="answer-card__letter" aria-hidden="true">
      {vm.letter}
    </span>
  );
  if (isButton) {
    return (
      <button
        type="button"
        className="answer-card answer-card--neutral"
        // `detail === 0` — aktywacja klawiszem (Enter/Spacja) albo przez czytnik ekranu.
        onClick={(e) => onSelect(vm.optionId, e.detail === 0 || document.activeElement === e.currentTarget)}
      >
        {letter}
        <span className="answer-card__body">
          <span className="visually-hidden">{`${vm.letter}. `}</span>
          <span>{vm.text}</span>
        </span>
      </button>
    );
  }
  const caption = captionFor(vm.state, mode, saveFailed);
  return (
    // tabIndex −1: cel programowego fokusu, gdy przycisk zniknął w trakcie zapisu (UI-03); poza kolejnością Tab.
    <div className={cx('answer-card', `answer-card--${vm.state}`)} tabIndex={-1}>
      {letter}
      <span className="answer-card__body">
        <span className="visually-hidden">{`${vm.letter}. `}</span>
        <span>{vm.text}</span>
        {caption ? (
          <span className="answer-card__caption">
            {caption.icon ? <Icon name={caption.icon} /> : null}
            <span>
              {caption.text}
              {caption.srSuffix ? <span className="visually-hidden">{caption.srSuffix}</span> : null}
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface AnswerListProps {
  slotId: SlotId;
  answers: AnswerCardVM[];
  mode: QuestionMode;
  saveFailed?: boolean;
  /**
   * Pierwsze dotknięcie odpowiedzi. Zwraca `false`, gdy akcja nie została przyjęta i można dotknąć
   * ponownie (np. odrzucona bez zapisu); w pozostałych przypadkach blokada trwa do zmiany pozycji.
   * `withFocus` — patrz `AnswerCardProps.onSelect`.
   */
  onAnswer: (optionId: OptionId, withFocus: boolean) => Promise<boolean> | boolean | void;
}

/**
 * Lista wariantów. Blokada podwójnego dotknięcia: kontroler jest wywoływany raz na pozycję —
 * kolejne dotknięcia (także szybki dwuklik przed odświeżeniem modelu widoku) są ignorowane.
 */
export function AnswerList({ slotId, answers, mode, saveFailed, onAnswer }: AnswerListProps) {
  const lockRef = useRef<SlotId | null>(null);
  const handleSelect = (optionId: OptionId, withFocus: boolean) => {
    if (lockRef.current === slotId) return;
    lockRef.current = slotId;
    void Promise.resolve(onAnswer(optionId, withFocus)).then((accepted) => {
      if (accepted === false && lockRef.current === slotId) lockRef.current = null;
    });
  };
  return (
    <ul className="answers" role="list" aria-label="Warianty odpowiedzi">
      {answers.map((a) => (
        <li key={a.optionId}>
          <AnswerCard vm={a} mode={mode} onSelect={mode === 'live' ? handleSelect : undefined} saveFailed={saveFailed} />
        </li>
      ))}
    </ul>
  );
}
