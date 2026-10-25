/**
 * Lokalne profile (DECYZJE §16): stała lista 9 adresów, wybór bez hasła i bez weryfikacji maila.
 * Profil to wyłącznie oddzielenie danych nauki na tym urządzeniu — każdy profil ma własną bazę IndexedDB
 * (`profileDbName`), a bank V15 i zasoby aplikacji są wspólne. Nie ma rejestracji, haseł ani wysyłki wiadomości.
 */
import { DB_NAME } from '../persistence/api';

export const PROFILE_EMAILS = [
  'recepcja@doktormonika.pl',
  'monika@doktormonika.pl',
  'iza@doktormonika.pl',
  'andrea@doktormonika.pl',
  'mariola@doktormonika.pl',
  'magda@doktormonika.pl',
  'angelika@doktormonika.pl',
  'ola@doktormonika.pl',
  'marta@doktormonika.pl',
] as const;

export type ProfileEmail = (typeof PROFILE_EMAILS)[number];

/** `Monika@doktormonika.pl ` i `monika@doktormonika.pl` to ten sam profil. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Adres z listy profili po normalizacji albo `null` (adres spoza listy nie tworzy profilu). */
export function knownProfile(value: unknown): ProfileEmail | null {
  if (typeof value !== 'string') return null;
  const email = normalizeEmail(value);
  return (PROFILE_EMAILS as readonly string[]).includes(email) ? (email as ProfileEmail) : null;
}

/** Baza dotychczasowych danych (sprzed profili) — „historia bez profilu”. */
export const LEGACY_DB_NAME = DB_NAME;

/** Baza danych nauki profilu (osobna na profil; właściciel zapisany w `meta`). */
export function profileDbName(email: ProfileEmail): string {
  return `${DB_NAME}:profil:${email}`;
}
