/**
 * S21a Ustawienia, S21b O bazie pytań, S23 Wykluczone pytania.
 * Liczby (pytania, rodziny, domeny, poziomy, przegląd AI, blokady) pochodzą z modeli widoku — policzone
 * z katalogu (`Catalog.bankSummary`, zgodne z `bank.counts`), bez stałych w kodzie. Stan puli
 * (`pool_note_pl`) i status bazy (`status_pl`) — teksty z banku, bez udawania certyfikacji.
 */
import { useAppState, useController } from '../../app/ControllerContext';
import type { AboutVM, BankInfoVM, ExcludedVM, SettingsVM } from '../../app/viewModels';
import { Banner } from '../components/Banner';
import { ListRow } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { EmailText, unassignedText } from './ProfileScreens';
import { DIFFICULTY_LABELS, familiesCount, formatBytes, formatDate, pluralPl, questionsCount } from '../format';

/** Zdanie o charakterze wyniku (task: „wynik nie jest oceną komisji”) — wspólne dla ustawień i „O bazie”. */
export const RESULT_DISCLAIMER =
  'Wynik testu w aplikacji służy tylko do nauki — nie jest oceną komisji egzaminacyjnej ani prognozą wyniku egzaminu.';

/** Np. „40 z 50 pytań sprawdzono odrębnym przeglądem AI (to nie jest recenzja lekarska).” — liczby z VM banku (przykład ilustracyjny). */
export function aiCheckedText(bank: BankInfoVM): string {
  return `${bank.independentlyCheckedCount} z ${questionsCount(bank.questionCount)} sprawdzono odrębnym przeglądem AI (to nie jest recenzja lekarska).`;
}

function persistedText(persisted: boolean | null): string {
  if (persisted === true) return 'Włączone';
  if (persisted === false) return 'Niepotwierdzone';
  return 'Nieznane';
}

export function SettingsScreen({ vm }: { vm: SettingsVM }) {
  const controller = useController();
  const state = useAppState();
  const storage = state.storage;
  const update = state.update;
  return (
    <Screen header={<ScreenHeader title="Ustawienia" onBack={() => controller.goBack()} />} contentClassName="settings">
      {update.available && update.canApplyNow ? (
        <Banner
          tone="info"
          icon="update"
          role="status"
          actions={
            <button type="button" className="btn btn--secondary btn--sm" disabled={update.applying} onClick={() => void controller.applyUpdate()}>
              Uruchom ponownie
            </button>
          }
        >
          Nowa wersja aplikacji jest gotowa.
        </Banner>
      ) : null}
      {state.profile ? (
        <section className="section" aria-label="Profil">
          <h2 className="section__title">Profil</h2>
          <ul className="list" role="list">
            <li>
              <ListRow icon="person" title="Aktywny profil" subtitle={<EmailText email={state.profile.email} />} />
            </li>
          </ul>
          <button type="button" className="btn btn--secondary btn--sm btn--start" onClick={() => controller.switchProfile()}>
            Zmień profil
          </button>
          {state.profile.unassigned ? (
            <Banner
              tone="info"
              role="note"
              title="Historia bez profilu"
              actions={
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => controller.assignUnassignedHistory()}>
                  Przypisz do tego profilu
                </button>
              }
            >
              <span className="banner__text">
                Na tym urządzeniu są wyniki sprzed wprowadzenia profili ({unassignedText(state.profile.unassigned)}). Możesz jednorazowo przypisać je do tego profilu.
              </span>
            </Banner>
          ) : null}
        </section>
      ) : null}
      <section className="section">
        <h2 className="section__title">Dane na tym urządzeniu</h2>
        <ul className="list" role="list">
          <li>
            <ListRow icon="save" title="Kopia danych" subtitle="Zapisz lub wczytaj plik kopii" onClick={() => controller.openBackup()} />
          </li>
          <li>
            <ListRow icon="library_add" title="Pula pytań" subtitle="Wyłącznie bank V15 — import pul wyłączony" onClick={() => controller.openPoolImport()} />
          </li>
          <li>
            <ListRow
              icon="outlined_flag"
              title="Wykluczone pytania"
              subtitle="Zgłoszone flagą, z możliwością przywrócenia"
              value={vm.activeBlocksCount}
              onClick={() => controller.openExcluded()}
            />
          </li>
          <li>
            <ListRow
              title="Trwałe przechowywanie"
              subtitle={
                storage.usageBytes !== null && storage.quotaBytes !== null
                  ? `Zajęte ${formatBytes(storage.usageBytes)} z ${formatBytes(storage.quotaBytes)} dostępnych dla aplikacji`
                  : 'Przeglądarka może usunąć dane przy braku miejsca, jeśli nie jest włączone.'
              }
              value={persistedText(storage.persisted)}
            />
          </li>
        </ul>
        {storage.persisted !== true ? (
          <button type="button" className="btn btn--secondary btn--sm btn--start" onClick={() => void controller.requestPersistentStorage()}>
            Poproś o trwałe przechowywanie
          </button>
        ) : null}
        <p className="meta">
          Wyniki i ustawienia są zapisane tylko na tym urządzeniu. Kopia pozwala je odtworzyć po zmianie telefonu lub wyczyszczeniu danych przeglądarki.
        </p>
      </section>
      <section className="section">
        <h2 className="section__title">Informacje</h2>
        <ul className="list" role="list">
          <li>
            <ListRow
              icon="info"
              title="O bazie pytań"
              subtitle={`${questionsCount(vm.bank.questionCount)} · ${familiesCount(vm.bank.familyCount)} · wersja ${vm.bank.bankVersion}`}
              onClick={() => controller.openAbout()}
            />
          </li>
          <li>
            <ListRow title="Wersja aplikacji" value={vm.appVersion} />
          </li>
        </ul>
        <div className="pool-status" role="note" aria-label="Stan puli pytań">
          <p className="meta">{aiCheckedText(vm.bank)}</p>
          {vm.bank.poolNotePl ? <p className="meta">{vm.bank.poolNotePl}</p> : null}
          {vm.bank.statusPl ? <p className="meta">{vm.bank.statusPl}</p> : null}
          {!vm.bank.clinicalSignoff ? <p className="meta">Materiał roboczy: klucze odpowiedzi nie mają podpisanej recenzji lekarskiej.</p> : null}
          <p className="meta">{RESULT_DISCLAIMER}</p>
        </div>
      </section>
    </Screen>
  );
}

/** Nazwy grup profilu treningowego V15 (klucze z training_profile.json). */
const PROFILE_GROUP_LABELS: Readonly<Record<string, string>> = {
  skin: 'skóra i dermatologia',
  facial_anatomy: 'anatomia twarzy',
  other: 'pozostałe',
};

export function AboutScreen({ vm }: { vm: AboutVM }) {
  const controller = useController();
  const domains = vm.byDomain.length;
  const hasPacks = vm.packs.length > 0;
  const bank = vm.bank;
  return (
    <Screen header={<ScreenHeader title="O bazie pytań" onBack={() => controller.goBack()} />} contentClassName="about">
      <p>
        Wbudowana pula zawiera {questionsCount(bank.questionCount)} jednokrotnego wyboru w {domains} {pluralPl(domains, 'dziedzinie', 'dziedzinach', 'dziedzinach')}. Bliskie
        warianty jednego zadania tworzą rodzinę: w puli jest {familiesCount(bank.familyCount)}, a test bierze najwyżej jedno pytanie z rodziny.
      </p>
      {bank.poolNotePl ? (
        <Banner tone="warn" role="note" icon="warning_amber" title="Stan puli">
          <span>{bank.poolNotePl}</span>
        </Banner>
      ) : null}
      <ul className="about-table" role="list" aria-label="Liczba pytań w dziedzinach">
        {vm.byDomain.map((d) => (
          <li key={d.domainId}>
            <span>{d.title}</span>
            <span className="about-table__count">{d.count}</span>
          </li>
        ))}
      </ul>
      <ul className="about-table" role="list" aria-label="Liczba pytań według poziomu trudności">
        {bank.byDifficulty.map((d) => (
          <li key={d.difficulty}>
            <span>{DIFFICULTY_LABELS[d.difficulty]}</span>
            <span className="about-table__count">{d.count}</span>
          </li>
        ))}
      </ul>
      {bank.profileShares ? (
        <p>
          Profil treningowy całego zakresu (Test i Free Flow):{' '}
          {bank.profileShares.map((p) => `${PROFILE_GROUP_LABELS[p.group] ?? p.group} ${String(p.percent).replace('.', ',')}%`).join(', ')}. To redakcyjna proporcja treningu, nie
          oficjalny rozkład egzaminu. Zakres jednej dziedziny działa bez profilu.
        </p>
      ) : null}
      <ul className="about-table" role="list" aria-label="Kontrola treści">
        <li>
          <span>Sprawdzone odrębnym przeglądem AI (nie recenzja lekarska)</span>
          <span className="about-table__count">{bank.independentlyCheckedCount}</span>
        </li>
        <li>
          <span>Pytania ze schematem</span>
          <span className="about-table__count">{bank.schematicCount}</span>
        </li>
        <li>
          <span>Wyłączone z aktywnej puli (nie pojawiają się w żadnym trybie)</span>
          <span className="about-table__count">{bank.retiredCount}</span>
        </li>
      </ul>
      <Banner tone={bank.clinicalSignoff ? 'info' : 'warn'} role="note" icon={bank.clinicalSignoff ? 'info' : 'warning_amber'} title="Status bazy">
        <span>{bank.statusPl}</span>
      </Banner>
      <p>To autorski materiał treningowy przygotowany na podstawie zamkniętej bazy źródeł. Nie jest oficjalnym bankiem pytań PTMEiAA.</p>
      <p>{RESULT_DISCLAIMER}</p>
      {!vm.bank.clinicalSignoff ? (
        <p>
          Klucze odpowiedzi są robocze i nie przeszły podpisanej recenzji klinicznej. Dostęp do pełnych tekstów części źródeł był ograniczony — zakres odczytu widać przy każdym
          źródle po odpowiedzi.
        </p>
      ) : null}
      <p>Poziomy trudności są autorskie i nie odzwierciedlają znanej trudności pytań egzaminacyjnych.</p>
      <p>Zgłoszenia flagą zapisują się tylko na tym urządzeniu. Wykluczają pytanie z kolejnych losowań, ale nie zmieniają klucza odpowiedzi.</p>
      {hasPacks ? (
        <section className="section">
          <h2 className="section__title">Zaimportowane pule</h2>
          <p className="meta">
            Razem z zaimportowanymi pulami: {questionsCount(bank.catalogQuestionCount)}, {familiesCount(bank.catalogFamilyCount)}.
          </p>
          <ul className="about-table" role="list">
            {vm.packs.map((p) => (
              <li key={p.packId}>
                <span>
                  {p.fileName}
                  <span className="muted"> · {formatDate(p.importedAt)}</span>
                </span>
                <span className="about-table__count">{p.questionCount}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="about__versions">
        <span>
          Wersja puli: {vm.bank.bankVersion} · zbudowana {vm.bank.builtOn}
        </span>
        <span>Wersja aplikacji: {vm.appVersion}</span>
      </div>
    </Screen>
  );
}

export function ExcludedScreen({ vm }: { vm: ExcludedVM }) {
  const controller = useController();
  return (
    <Screen header={<ScreenHeader title="Wykluczone pytania" onBack={() => controller.goBack()} />} contentClassName="screen__content--tight">
      <p className="meta">
        Pytania zgłoszone flagą nie pojawiają się w kolejnych losowaniach. Przywrócenie dotyczy tylko przyszłych sesji; wcześniejsze wyniki i trwające sesje pozostają bez zmian.
      </p>
      {vm.items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__title">Brak wykluczonych pytań</div>
          <div className="empty-state__text">Pytania zgłoszone flagą pojawią się tutaj.</div>
        </div>
      ) : (
        <ul className="list" role="list" aria-label="Wykluczone pytania">
          {vm.items.map((x) => (
            <li key={x.blockId} className="excluded-row">
              <div className="excluded-row__body">
                <span className="excluded-row__stem clamp-2">{x.stem}</span>
                <span className="list-row__subtitle">
                  {x.domainTitle} · wykluczone {formatDate(x.createdAt)}
                </span>
              </div>
              <button type="button" className="btn btn--secondary" onClick={() => void controller.restoreBlock(x.blockId)}>
                <Icon name="undo" size={18} />
                Przywróć
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
