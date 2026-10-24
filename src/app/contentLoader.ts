/**
 * Wczytanie treści banku V15 w przeglądarce (DECYZJE §2, docs/MIGRACJA_V15.md): trzy pliki z
 * `CONTENT_RELEASE` (wersjonowane nazwy, z precache Service Workera offline) i SHA-256 bajtów pliku banku
 * (Web Crypto). JEDYNE źródło pytań aplikacji — bez awaryjnego ładowania innego banku (także w trybie dev).
 */
import { CONTENT_RELEASE } from '../domain/contentRelease';
import type { ContentBundle } from './controller';

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(base: string, path: string): Promise<ArrayBuffer> {
  const response = await fetch(`${base}${path}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.arrayBuffer();
}

export async function loadContentBundle(base: string): Promise<ContentBundle> {
  const [bankBytes, retiredBytes, profileBytes] = await Promise.all([
    fetchBytes(base, CONTENT_RELEASE.bankFile),
    fetchBytes(base, CONTENT_RELEASE.retiredFile),
    fetchBytes(base, CONTENT_RELEASE.profileFile),
  ]);
  const decoder = new TextDecoder('utf-8');
  const bankSha256 = typeof crypto !== 'undefined' && crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', bankBytes)) : null;
  return {
    bank: JSON.parse(decoder.decode(bankBytes)) as unknown,
    retired: JSON.parse(decoder.decode(retiredBytes)) as unknown,
    profile: JSON.parse(decoder.decode(profileBytes)) as unknown,
    bankSha256,
  };
}
