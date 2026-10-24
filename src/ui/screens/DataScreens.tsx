/**
 * S22 Kopia danych (zapis, wybór pliku, sprawdzanie, decyzja, sukces, błąd; S24e niezgodna wersja)
 * i import puli pytań (S22h sukces, S22i niezgodności). Wybór pliku — systemowy `<input type="file">`.
 * Wszystkie liczby w podsumowaniach pochodzą z walidacji pliku (kontroler/trwałość), nie z prototypu.
 * F03: lista automatycznych kopii bezpieczeństwa sprzed „Wczytaj kopię” (magazyn `backups`) z „Pobierz”
 * i „Przywróć” — dostępna także po zamknięciu banera sukcesu i po wyjściu z ekranu.
 */
import { useRef, type ChangeEvent } from 'react';
import { useController } from '../../app/ControllerContext';
import type { BackupVM, PoolImportVM, SafetyBackupVM } from '../../app/viewModels';
import type { BackupSummary } from '../../persistence/api';
import { Banner } from '../components/Banner';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';
import { backupErrorDetail, formatBytes, formatDateTime, pluralPl } from '../format';

/**
 * Opis zawartości pliku kopii (F02). Kopia zawiera magazyny `BACKUP_DATA_STORES` (persistence/backup.ts):
 * ustawienia, sesje ZE SNAPSHOTAMI PYTAŃ (treść, warianty, klucz, wyjaśnienie — do przeglądu odpowiedzi),
 * próby, stan powtórek, blokady (z początkiem treści pytania), zdarzenia — wyłącznie treść banku V15.
 * Nie zawiera wbudowanej puli, zaimportowanych pul ani danych pacjentów (aplikacja ich nie przetwarza).
 */
export const BACKUP_CONTENTS_TEXT =
  'Plik zawiera wyniki, przerwane sesje, ustawienia, stan powtórek i wykluczone pytania, a także treść pytań banku V15 z Twoich sesji (do przeglądu odpowiedzi). Sesje sprzed aktualizacji banku do V15 mają tylko podsumowanie, bez treści pytań. Nie zawiera wbudowanej puli pytań, zaimportowanych pul ani danych pacjentów.';

function FilePicker({ label, accept, onFile, primary = false }: { label: string; accept: string; onFile: (file: File) => void; primary?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  };
  return (
    <>
      <button
        type="button"
        className={primary ? 'btn btn--primary btn--lg btn--block' : 'btn btn--secondary btn--block'}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="file_upload" style={primary ? undefined : { color: 'var(--text-2)' }} />
        {label}
      </button>
      <input ref={inputRef} type="file" accept={accept} className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={onChange} />
    </>
  );
}

function summaryLines(s: BackupSummary): string[] {
  return [
    `${s.completedTests} ${pluralPl(s.completedTests, 'ukończony test', 'ukończone testy', 'ukończonych testów')} i ${s.unfinishedTests} ${pluralPl(s.unfinishedTests, 'niedokończony', 'niedokończone', 'niedokończonych')}`,
    `${s.freeFlowSessions} ${pluralPl(s.freeFlowSessions, 'sesja', 'sesje', 'sesji')} Free Flow · ${s.openSessions} ${pluralPl(s.openSessions, 'przerwana sesja', 'przerwane sesje', 'przerwanych sesji')}`,
    `${s.activeBlocks} ${pluralPl(s.activeBlocks, 'wykluczone pytanie', 'wykluczone pytania', 'wykluczonych pytań')} · ustawienia i stan powtórek`,
  ];
}

function SafetyBackupList({ items }: { items: SafetyBackupVM[] }) {
  const controller = useController();
  return (
    <div className="section" style={{ gap: 8 }}>
      <h3 className="section__title">Automatyczne kopie bezpieczeństwa</h3>
      <p className="meta">
        Stan danych zapisany automatycznie przed wczytaniem kopii (przechowywane są najnowsze). Możesz go pobrać jako plik albo przywrócić — przed przywróceniem bieżące dane
        również zostaną zabezpieczone.
      </p>
      <ul className="list" role="list" aria-label="Automatyczne kopie bezpieczeństwa">
        {items.map((b) => {
          const when = formatDateTime(b.createdAt);
          return (
            <li key={b.id} className="safety-row">
              <div className="safety-row__body">
                <span className="safety-row__title">Sprzed wczytania · {when}</span>
                <span className="list-row__subtitle">
                  {b.fileName} · {formatBytes(b.sizeBytes)}
                </span>
              </div>
              <div className="safety-row__actions">
                <button type="button" className="btn btn--secondary" aria-label={`Pobierz kopię sprzed wczytania z ${when}`} onClick={() => void controller.downloadSafetyBackup(b.id)}>
                  <Icon name="file_download" size={18} />
                  Pobierz
                </button>
                <button type="button" className="btn btn--secondary" aria-label={`Przywróć kopię sprzed wczytania z ${when}`} onClick={() => void controller.restoreSafetyBackup(b.id)}>
                  <Icon name="undo" size={18} />
                  Przywróć
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BackupScreen({ vm }: { vm: BackupVM }) {
  const controller = useController();
  const flow = vm.flow;
  const pick = (file: File) => void controller.selectBackupFile(file, file.name);
  return (
    <Screen header={<ScreenHeader title="Kopia danych" onBack={() => controller.goBack()} />}>
      <section className="card card--pad section" style={{ gap: 10 }}>
        <h2 className="card__title">Zapisz kopię</h2>
        <p className="meta">{BACKUP_CONTENTS_TEXT}</p>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={flow.step === 'saving'}
          aria-busy={flow.step === 'saving' || undefined}
          onClick={() => void controller.exportBackup()}
        >
          <Icon name="file_download" style={{ color: 'var(--text-2)' }} />
          {flow.step === 'saving' ? 'Przygotowywanie pliku…' : 'Zapisz kopię'}
        </button>
        {flow.step === 'idle' && flow.lastSavedFileName ? (
          <Banner tone="info" role="status">
            <span>
              <b>Przygotowano plik kopii {flow.lastSavedFileName}.</b>{' '}
              <span className="banner__text">
                Sprawdź, czy zapisał się w aplikacji Pliki (folder Pobrane) — jeśli okno pobierania zostało zamknięte, użyj „Zapisz kopię” ponownie. Przechowuj plik poza
                przeglądarką.
              </span>
            </span>
          </Banner>
        ) : null}
      </section>

      <section className="card card--pad section" style={{ gap: 10 }}>
        <h2 className="card__title">Wczytaj kopię</h2>
        <p className="meta">Zastępuje dane na tym urządzeniu danymi z pliku kopii. Przed zastąpieniem bieżące dane zostaną zachowane jako kopia bezpieczeństwa.</p>

        {flow.step === 'idle' || flow.step === 'saving' ? <FilePicker label="Wybierz plik kopii" accept="application/json,.json" onFile={pick} /> : null}

        {(flow.step === 'idle' || flow.step === 'saving') && vm.safetyBackups && vm.safetyBackups.length > 0 ? <SafetyBackupList items={vm.safetyBackups} /> : null}

        {flow.step === 'checking' ? (
          <div className="banner banner--plain" role="status">
            <span>
              <b>Sprawdzanie pliku…</b> {flow.fileName}
            </span>
            <span className="indeterminate" aria-hidden="true" />
            <span className="muted">Struktura, wersja formatu i spójność danych. Dane na urządzeniu nie są jeszcze zmieniane.</span>
          </div>
        ) : null}

        {flow.step === 'confirm' ? (
          <div className="section" style={{ gap: 12 }}>
            <div className="banner banner--plain" style={{ lineHeight: 1.5 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{flow.fileName} — plik poprawny</div>
                <div>
                  Utworzona {formatDateTime(flow.summary.exportedAt)} · format kopii {flow.summary.formatVersion}
                </div>
                {summaryLines(flow.summary).map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>
            </div>
            <Banner tone="warn" role="alert">
              <span>
                Wczytanie <b>zastąpi wszystkie dane nauki</b> na tym urządzeniu. Bieżące dane zapiszemy najpierw jako kopię bezpieczeństwa.
              </span>
            </Banner>
            <div className="btn-stack" style={{ gap: 8 }}>
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => void controller.confirmBackupReplace()}>
                Zabezpiecz bieżące dane i zastąp
              </button>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => controller.cancelBackupReplace()}>
                Anuluj — zostaw obecne dane
              </button>
            </div>
          </div>
        ) : null}

        {flow.step === 'replacing' ? (
          <div className="banner banner--plain" role="status">
            <span>
              <b>Zabezpieczanie bieżących danych i wczytywanie kopii…</b> {flow.fileName}
            </span>
            <span className="indeterminate" aria-hidden="true" />
          </div>
        ) : null}

        {flow.step === 'done' ? (
          <Banner
            tone="success"
            role="status"
            title="Dane wczytane z kopii."
            actions={
              <>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void controller.downloadSafetyBackup()}>
                  <Icon name="file_download" style={{ color: 'var(--text-2)' }} />
                  Pobierz kopię sprzed wczytania
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => controller.resetBackupFlow()}>
                  Gotowe
                </button>
              </>
            }
          >
            <span className="banner__text">
              {summaryLines(flow.summary).join('. ')}. Poprzedni stan zapisano jako {flow.safetyFileName}.
            </span>
          </Banner>
        ) : null}

        {flow.step === 'error' && flow.error.code === 'UnsupportedBackupVersion' ? (
          <Banner tone="warn" role="alert" title="Ta kopia pochodzi z nowszej wersji aplikacji." actions={<FilePicker label="Wybierz inny plik" accept="application/json,.json" onFile={pick} />}>
            <span>
              Plik „{flow.fileName ?? 'kopia'}” ma format {flow.error.foundVersion ?? 'nieznany'}, a ta wersja obsługuje format 1. Zaktualizuj aplikację, a potem wczytaj kopię
              ponownie. Dane na tym urządzeniu nie zostały zmienione.
            </span>
          </Banner>
        ) : null}

        {flow.step === 'error' && flow.error.code !== 'UnsupportedBackupVersion' ? (
          <Banner
            tone="danger"
            role="alert"
            title={`Nie można wczytać pliku${flow.fileName ? ` „${flow.fileName}”` : ''}.`}
            actions={<FilePicker label="Wybierz inny plik" accept="application/json,.json" onFile={pick} />}
          >
            {backupErrorDetail(flow.error.messagePl, flow.fileName) ? (
              <span className="banner__text">{backupErrorDetail(flow.error.messagePl, flow.fileName)}</span>
            ) : null}
            {flow.error.reasonsPl.length > 0 ? (
              <ul className="banner__list">
                {flow.error.reasonsPl.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <span className="banner__text">Dane na tym urządzeniu nie zostały zmienione.</span>
          </Banner>
        ) : null}
      </section>
    </Screen>
  );
}

/**
 * Import dodatkowych pul pytań — WYŁĄCZONY od banku V15 (docs/MIGRACJA_V15.md): aplikacja udostępnia
 * wyłącznie wbudowany bank V15. Ekran zostaje pod dotychczasowym adresem z wyjaśnieniem, bez wyboru pliku.
 */
export function PoolImportScreen({ vm }: { vm: PoolImportVM }) {
  const controller = useController();
  void vm;
  return (
    <Screen header={<ScreenHeader title="Pula pytań" onBack={() => controller.goBack()} />}>
      <Banner tone="info" role="note" title="Aplikacja używa wyłącznie banku pytań V15">
        <span className="banner__text">
          Import dodatkowych pul pytań jest wyłączony. Wszystkie tryby (Test, Free Flow, runda błędów, „Moje błędy”) korzystają tylko z wbudowanego banku V15. Liczby
          pytań i status materiału są w „O bazie pytań”.
        </span>
      </Banner>
    </Screen>
  );
}
