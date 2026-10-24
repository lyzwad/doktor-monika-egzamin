/**
 * Treść banku V15 dla testów (Node): te same pliki i ścieżki co aplikacja (`CONTENT_RELEASE`).
 * Stara ścieżka `public/data/bank.json` nie istnieje — testy nie mają dostępu do innego banku.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContentBundle } from '../src/app/controller';
import { buildCatalog, parseRetiredIds, parseTrainingProfile } from '../src/domain/catalog';
import { CONTENT_RELEASE } from '../src/domain/contentRelease';
import type { Catalog, RuntimeBank, TrainingProfile } from '../src/domain/types';

export const BANK_PATH = resolve(process.cwd(), 'public', CONTENT_RELEASE.bankFile);
export const RETIRED_PATH = resolve(process.cwd(), 'public', CONTENT_RELEASE.retiredFile);
export const PROFILE_PATH = resolve(process.cwd(), 'public', CONTENT_RELEASE.profileFile);

export const BANK_BYTES = readFileSync(BANK_PATH);
export const BANK_TEXT = BANK_BYTES.toString('utf-8');
export const BANK = JSON.parse(BANK_TEXT) as RuntimeBank;
export const RETIRED_RAW = JSON.parse(readFileSync(RETIRED_PATH, 'utf-8')) as { bank_version: string; ids: string[] };
export const PROFILE_RAW = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')) as { bank_version: string; weights: Record<string, number>; groups: Record<string, string[]> };
export const BANK_SHA256 = createHash('sha256').update(BANK_BYTES).digest('hex');

export const RETIRED_IDS: string[] = (() => {
  const r = parseRetiredIds(RETIRED_RAW, CONTENT_RELEASE.bankVersion);
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
})();

export const PROFILE: TrainingProfile = (() => {
  const r = parseTrainingProfile(PROFILE_RAW, CONTENT_RELEASE.bankVersion);
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
})();

/** Pakiet treści jak z `loadContentBundle` (SHA-256 policzony z bajtów pliku). */
export function contentBundle(bank: unknown = structuredClone(BANK)): ContentBundle {
  return { bank, retired: structuredClone(RETIRED_RAW), profile: structuredClone(PROFILE_RAW), bankSha256: BANK_SHA256 };
}

/** Katalog V15 dokładnie jak w aplikacji (wyłączone ID, profil, asercja wersji). */
export function v15Catalog(): Catalog {
  const r = buildCatalog(structuredClone(BANK), { retiredQuestionIds: RETIRED_IDS, profile: PROFILE, requiredBankVersion: CONTENT_RELEASE.bankVersion });
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
}
