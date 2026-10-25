/**
 * Profile (DECYZJE §16): „Wybierz profil” (9 adresów, bez hasła) i decyzja o historii bez profilu.
 * Profil oddziela dane nauki osób na tym urządzeniu — to nie jest logowanie ani weryfikacja maila.
 */
import { useEffect, useRef } from 'react';
import type { ProfileEmail } from '../../profiles/profiles';
import type { UnassignedSummary } from '../../profiles/registry';
import { Banner } from '../components/Banner';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { formatDate, pluralPl } from '../format';

/** Adres z miejscem łamania po „@” (wąski ekran, duży tekst) — bez znaków dodanych do kopiowanego tekstu. */
export function EmailText({ email }: { email: string }) {
  const at = email.indexOf('@');
  if (at < 0) return <span className="profile-email">{email}</span>;
  return (
    <span className="profile-email">
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </span>
  );
}

export const PROFILE_NOTE =
  'Profil oddziela historię i postępy osób, które uczą się na tym urządzeniu. To nie jest logowanie: nie ma hasła, a dane zostają tylko na tym urządzeniu.';

/** „3 ukończone testy, 1 sesja Free Flow, ostatnio 24.10.2026”. */
export function unassignedText(s: UnassignedSummary): string {
  const parts: string[] = [];
  if (s.completedTests > 0) parts.push(`${s.completedTests} ${pluralPl(s.completedTests, 'ukończony test', 'ukończone testy', 'ukończonych testów')}`);
  if (s.unfinishedTests > 0) parts.push(`${s.unfinishedTests} ${pluralPl(s.unfinishedTests, 'test niedokończony', 'testy niedokończone', 'testów niedokończonych')}`);
  if (s.freeFlowSessions > 0) parts.push(`${s.freeFlowSessions} ${pluralPl(s.freeFlowSessions, 'sesja Free Flow', 'sesje Free Flow', 'sesji Free Flow')}`);
  if (s.openSessions > 0) parts.push(`${s.openSessions} ${pluralPl(s.openSessions, 'rozpoczęta sesja', 'rozpoczęte sesje', 'rozpoczętych sesji')}`);
  if (parts.length === 0) parts.push(`${s.attempts} ${pluralPl(s.attempts, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}`);
  return parts.join(', ') + (s.lastActivityAt ? `; ostatnio ${formatDate(s.lastActivityAt)}` : '');
}

export function ProfilePickerScreen({
  profiles,
  last,
  unassigned,
  busy,
  messagePl,
  onChoose,
}: {
  profiles: readonly ProfileEmail[];
  last: ProfileEmail | null;
  unassigned: UnassignedSummary | null;
  busy: boolean;
  messagePl: string | null;
  onChoose: (email: ProfileEmail) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Screen contentClassName="screen__content--home" label="Wybierz profil">
      <p className="app-kicker">Doktor Monika Egzamin</p>
      <h1 className="app-title" ref={titleRef} tabIndex={-1}>
        Wybierz profil
      </h1>
      <p className="meta">{PROFILE_NOTE}</p>
      {messagePl ? (
        <Banner tone="danger" role="alert">
          <span className="banner__text">{messagePl}</span>
        </Banner>
      ) : null}
      {unassigned ? (
        <Banner tone="info" role="note" title="Na tym urządzeniu jest historia bez profilu">
          <span className="banner__text">
            {unassignedText(unassigned)}. Wybierz swój adres — zapytamy, czy przypisać ją do Twojego profilu. Możesz też zdecydować później.
          </span>
        </Banner>
      ) : null}
      <ul className="list" role="list" aria-label="Profile">
        {profiles.map((email) => (
          <li key={email}>
            <button type="button" className="list-row" disabled={busy} onClick={() => onChoose(email)}>
              <Icon name="person" size={22} className="list-row__icon" />
              <span className="list-row__main">
                <span className="list-row__body">
                  <span className="list-row__title">
                    <EmailText email={email} />
                  </span>
                </span>
                {email === last ? <span className="list-row__value">ostatnio</span> : null}
              </span>
              <Icon name="chevron_right" size={22} className="list-row__chevron" />
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

export function AssignUnassignedScreen({
  email,
  unassigned,
  busy,
  messagePl,
  onAssign,
  onDefer,
  onBack,
}: {
  email: ProfileEmail;
  unassigned: UnassignedSummary;
  busy: boolean;
  messagePl: string | null;
  onAssign: () => void;
  onDefer: () => void;
  onBack: () => void;
}) {
  return (
    <Screen header={<ScreenHeader title="Historia bez profilu" onBack={busy ? undefined : onBack} backLabel="Wróć do wyboru profilu" />}>
      <section className="card card--pad section" style={{ gap: 10 }}>
        <h2 className="card__title">Przypisać dotychczasową historię?</h2>
        <p className="meta">Na tym urządzeniu są wyniki zapisane przed wprowadzeniem profili: {unassignedText(unassigned)}.</p>
        <p>
          Profil:{' '}
          <b>
            <EmailText email={email} />
          </b>
        </p>
        <p className="meta">
          Przypisanie jest jednorazowe: historia dołączy do tego profilu (z wykresem, błędami do powtórki i wykluczonymi pytaniami). Jeśli profil ma już
          własne wyniki, zostaną zachowane, a ich kopia bezpieczeństwa trafi do „Kopii danych”. Rozpoczęte sesje z banku V15 będzie można kontynuować.
        </p>
        {messagePl ? (
          <Banner tone="danger" role="alert">
            <span className="banner__text">{messagePl}</span>
          </Banner>
        ) : null}
        {busy ? (
          <div className="banner banner--plain" role="status">
            <span>
              <b>Przypisywanie historii…</b>
            </span>
            <span className="indeterminate" aria-hidden="true" />
          </div>
        ) : (
          <div className="btn-stack" style={{ gap: 8 }}>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onAssign}>
              Przypisz do tego profilu
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={onDefer}>
              Nie teraz — zostaw bez profilu
            </button>
          </div>
        )}
        <p className="meta">„Nie teraz” nie usuwa tej historii. Przypisać ją można później w Ustawieniach wybranego profilu.</p>
      </section>
    </Screen>
  );
}
