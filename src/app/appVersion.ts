/**
 * Wersja aplikacji (pokazywana w Ustawieniach i zapisywana w kopii danych).
 * Wartość `__APP_VERSION__` wstawia Vite (`define` w vite.config.ts: wersja z package.json,
 * opcjonalnie z sufiksem `APP_BUILD_ID`). Poza buildem (testy) — `0.0.0-dev`.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '0.0.0-dev';
