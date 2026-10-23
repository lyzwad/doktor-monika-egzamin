/**
 * Ekran ładowania (start aplikacji: otwarcie bazy, wczytanie banku i danych).
 * Bez fikcyjnych liczników i postępu — tylko nazwa aplikacji i status.
 */
export interface LoadingScreenProps {
  /** Komunikat statusu (domyślnie „Wczytywanie…”). */
  message?: string;
}

export function LoadingScreen({ message = 'Wczytywanie…' }: LoadingScreenProps) {
  return (
    <main className="screen-column screen-top screen-bottom" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h1
        style={{
          margin: '20px 0 4px',
          fontSize: 'var(--fs-app-title)',
          lineHeight: 'var(--lh-tight)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          textWrap: 'balance',
        }}
      >
        Doktor Monika Egzamin
      </h1>
      <p role="status" aria-live="polite" style={{ fontSize: 'var(--fs-meta)', lineHeight: 'var(--lh-meta)', color: 'var(--text-2)' }}>
        {message}
      </p>
    </main>
  );
}
