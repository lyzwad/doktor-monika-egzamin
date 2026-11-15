import type { RuntimeBank, RuntimeQuestion, RuntimeSource, RuntimeTopic } from '../src/domain/types';

export const RELEASE_PREFIX: string;
export const BUILT_ON: string;
export const ADDENDUM_FORMAT: 'dme-webinar-addendum';
export const WEBINAR_SOURCE_KIND: 'user_supplied_webinar_transcript';
export const ID_PREFIX: string;
export const ALLOWLIST_MODE: 'v18_plus_webinar_addendum';

export type InputKey = 'v18Manifest' | 'v18Bank' | 'v18Allowed' | 'v18Retired' | 'v18Profile' | 'addendumManifest' | 'addendum' | 'excluded';
export type ReleaseInputs = Record<InputKey, Uint8Array>;
export const INPUT_PATHS: Readonly<Record<InputKey, string>>;
export const OUTPUT_PATHS: Readonly<{ dataDir: string; allowlist: string; allowlistModule: string }>;

export interface WebinarAddendumEntry {
  format: 'dme-webinar-addendum';
  bank_version: string;
  sha256: string;
  count: number;
  id_prefix: string;
}

export interface AdaptedAddendum {
  entry: WebinarAddendumEntry;
  questions: RuntimeQuestion[];
  sources: Record<string, RuntimeSource>;
  topics: Record<string, RuntimeTopic>;
}

export type MergedBank = RuntimeBank & { addenda?: WebinarAddendumEntry[] };

export interface ReleaseResult {
  bankVersion: string;
  builtOn: string;
  /** Ścieżki względem `base` (`data/…`). */
  bankFile: string;
  retiredFile: string;
  profileFile: string;
  bankSha256: string;
  retiredSha256: string;
  profileSha256: string;
  allowedSha256: string;
  counts: Record<string, unknown>;
  webinarCount: number;
  retiredCount: number;
  identicalPairs: string[][];
  excluded: Record<string, string>;
  addendum: { bankVersion: string; sha256: string; count: number };
  texts: { status: string; pool: string };
  /** Ścieżka względem katalogu projektu → treść pliku. */
  files: Record<string, string>;
}

export function serializeJson(value: unknown): string;
export function sha256Hex(data: string | Uint8Array): string;
export function releaseBankVersion(v18Sha256: string, addendumSha256: string): string;
export function webinarTopicId(sourceId: string, domainId: string): string;
export function sourceLocator(question: { id: string; source_ids: readonly string[]; evidence_unit_ids: readonly string[] }): string;
export function adaptAddendum(addendum: unknown, options: { sha256: string }): Promise<AdaptedAddendum>;
export function webinarStatusSentence(count: number): string;
export function webinarPoolSentence(count: number): string;
export function mergeBank(base: RuntimeBank, adapted: AdaptedAddendum, options: { bankVersion: string; builtOn: string }): MergedBank;
export function identicalContentPairs(questions: readonly { id: string; fingerprint: string }[]): string[][];
export function buildRetired<T extends { bank_version: string; ids: string[] }>(base: T, bankVersion: string, bankIds: readonly string[]): T;
export function buildProfile<T extends { bank_version: string; groups: Record<string, string[]>; rules_pl?: string[] }>(
  base: T,
  bankVersion: string,
  added: readonly { id: string; domain_id: string }[],
  bankIds: readonly string[],
): T;
export function buildAllowlist(
  v18Allowed: { bank_version: string; ids: readonly string[]; [key: string]: unknown },
  bankVersion: string,
  wbIds: readonly string[],
): { bank_version: string; mode: 'v18_plus_webinar_addendum'; components: { V18: number; WB: number }; ids: string[] };
export function staleDataFiles(names: readonly string[], keep: readonly string[]): string[];
export function readInputs(root: string): ReleaseInputs;
export function buildRelease(inputs: ReleaseInputs): Promise<ReleaseResult>;
export function formatReport(result: ReleaseResult, removed?: readonly string[]): string;
