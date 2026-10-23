/**
 * S03–S05 Konfiguracja (Free Flow | Test): liczba pytań (NumberStepper, tylko Test), zakres (arkusz),
 * trudność (Segmented), „Moje błędy” (Switch), informacja o przerwanej sesji, przycisk startu w dolnym pasku.
 * Walidacja N i pojemność pochodzą z modelu widoku (domena); UI pokazuje komunikaty S05 z działaniami.
 */
import { useState } from 'react';
import { useController } from '../../app/ControllerContext';
import type { ConfigVM } from '../../app/viewModels';
import type { DifficultyChoice, Scope } from '../../domain/types';
import { Banner } from '../components/Banner';
import { Segmented, SwitchRow } from '../components/Controls';
import { Icon } from '../components/Icon';
import { NumberStepper } from '../components/NumberStepper';
import { Screen, ScreenHeader } from '../components/Screen';
import { RadioList, Sheet } from '../components/Sheet';
import { capacityHelp, capacityLabel, DIFFICULTY_LABELS, emptyPoolFixes, nValidationMessage, questionsCount } from '../format';

const DIFFICULTY_ORDER: DifficultyChoice[] = ['mixed', 'basic', 'intermediate', 'advanced'];

/**
 * UI-04: tekst pomocniczy Free Flow dosłownie z Design (DME-Aplikacja.dc.html, `cfg.ffHelp`). Zgodny
 * z FREE_FLOW_POLICY_V2: w domenie najpierw należne aktywne błędy (powtórki), potem niewidziane.
 */
export const FREE_FLOW_HELP = 'Bez liczby pytań i limitu czasu. Kolejne pytania dobierane są z zakresu, z pierwszeństwem powtórek.';

export function ConfigScreen({ vm }: { vm: ConfigVM }) {
  const controller = useController();
  const [scopeOpen, setScopeOpen] = useState(false);
  const isTest = vm.mode === 'test';
  const draft = vm.draft;
  const nMessage = isTest && vm.nValidation ? nValidationMessage(vm.nValidation, draft) : null;
  const ffEmpty = !isTest && vm.capacity === 0;
  const errs = vm.activeErrorsInScope;

  const myErrorsDescription =
    draft.myErrorsPriority && errs > 0
      ? `Najpierw ${questionsCount(errs)} z wcześniejszymi błędami${isTest ? ', resztę uzupełnią inne pytania z zakresu.' : ', potem zwykły zakres.'}`
      : 'Najpierw pytania z wcześniejszymi błędnymi odpowiedziami.';

  const openSessionText = vm.openSession
    ? vm.openSession.kind === 'test'
      ? `Masz przerwany test (${vm.openSession.answeredValid}/${vm.openSession.targetN ?? 0}). Rozpoczęcie nowej sesji zapisze go w historii jako niedokończony.`
      : 'Masz przerwaną sesję Free Flow. Rozpoczęcie nowej sesji zapisze ją w historii.'
    : null;

  const start = () => {
    if (!vm.canStart || vm.starting) return;
    void (isTest ? controller.startTest() : controller.startFreeFlow());
  };

  return (
    <>
      <Screen
        header={<ScreenHeader title={isTest ? 'Test' : 'Free Flow'} onBack={() => controller.goBack()} />}
        footer={
          <button type="button" className="btn btn--primary btn--lg btn--block" disabled={!vm.canStart || vm.starting} aria-busy={vm.starting || undefined} onClick={start}>
            {isTest ? 'Rozpocznij test' : 'Rozpocznij'}
          </button>
        }
        contentClassName="config"
      >
        {isTest ? (
          <section className="section">
            <h2 className="section__title">Liczba pytań</h2>
            <NumberStepper
              value={draft.nText}
              capacity={vm.capacity}
              onChange={(nText) => controller.updateConfigDraft({ nText })}
              error={nMessage?.text ?? null}
              fixes={(nMessage?.fixes ?? []).map((f) => ({ label: f.label, onClick: () => controller.updateConfigDraft(f.patch) }))}
              canDecrement={vm.canDecrement}
              canIncrement={vm.canIncrement}
              quickValues={vm.quickValues}
            />
            {!nMessage ? <p className="meta">{capacityHelp(vm.capacity, vm.questionCount)}</p> : null}
          </section>
        ) : null}

        <section className="section">
          <h2 className="section__title" id="cfg-scope">
            Zakres
          </h2>
          <button type="button" className="select-row" aria-haspopup="dialog" aria-describedby="cfg-scope" onClick={() => setScopeOpen(true)}>
            <span className="select-row__body">
              <span className="select-row__value">{vm.scopeTitle}</span>
              <span className="select-row__meta">{capacityLabel(vm.capacity, vm.questionCount)}</span>
            </span>
            <Icon name="chevron_right" size={22} className="select-row__chevron" />
          </button>
        </section>

        <section className="section">
          <h2 className="section__title">Trudność</h2>
          <Segmented
            label="Trudność"
            options={DIFFICULTY_ORDER.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
            value={draft.difficulty}
            onChange={(difficulty) => controller.updateConfigDraft({ difficulty })}
          />
          <p className="meta">Łatwy to autorski trening w stylu egzaminacyjnym. Wyższe poziomy wymagają więcej rozumowania w tym samym zakresie.</p>
        </section>

        <section className="section">
          <SwitchRow
            title="Moje błędy"
            description={myErrorsDescription}
            checked={draft.myErrorsPriority}
            onChange={(myErrorsPriority) => controller.updateConfigDraft({ myErrorsPriority })}
          />
          {draft.myErrorsPriority && errs === 0 ? (
            <Banner
              tone="info"
              role="status"
              actions={
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => controller.updateConfigDraft({ myErrorsPriority: false })}>
                  Przejdź do zwykłego zakresu
                </button>
              }
            >
              W tym zakresie nie ma jeszcze zapisanych błędnych odpowiedzi. Filtr zadziała po pierwszych pomyłkach; sesja będzie zwykłym losowaniem z zakresu.
            </Banner>
          ) : null}
        </section>

        {ffEmpty ? (
          <Banner
            tone="danger"
            role="alert"
            actions={emptyPoolFixes(draft).map((f) => (
              <button key={f.label} type="button" className="btn btn--secondary btn--sm" onClick={() => controller.updateConfigDraft(f.patch)}>
                {f.label}
              </button>
            ))}
          >
            <span className="banner__lead">Brak dostępnych pytań dla tej konfiguracji.</span>
          </Banner>
        ) : null}

        {!isTest && !ffEmpty ? (
          <p className="meta">{FREE_FLOW_HELP}</p>
        ) : null}

        {openSessionText ? (
          <Banner tone="plain" icon={null}>
            {openSessionText}
          </Banner>
        ) : null}
      </Screen>

      {scopeOpen ? (
        <Sheet title="Zakres" onClose={() => setScopeOpen(false)}>
          <RadioList<Scope>
            label="Zakres"
            options={vm.scopeOptions.map((o) => ({ value: o.scope, label: o.title, count: capacityLabel(o.capacity, o.questionCount) }))}
            value={draft.scope}
            onSelect={(scope) => {
              controller.updateConfigDraft({ scope });
              setScopeOpen(false);
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}
