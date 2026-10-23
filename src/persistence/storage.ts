/**
 * Opakowanie `navigator.storage` (DECYZJE §10): prośba o trwałe przechowywanie i szacunek miejsca.
 * Persystencja to prośba, nie gwarancja — brak API albo odmowa nie są błędem aplikacji.
 */
import type { PersistRequestResult, StorageApi, StorageEstimateInfo } from './api';

/** `navigator.storage` bieżącego środowiska albo `null`. */
export function defaultStorageManager(): StorageManager | null {
  const nav = (globalThis as { navigator?: { storage?: StorageManager } }).navigator;
  return nav?.storage ?? null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createStorageApi(manager: StorageManager | null): StorageApi {
  return {
    async persisted(): Promise<boolean | null> {
      if (!manager || typeof manager.persisted !== 'function') return null;
      try {
        return await manager.persisted();
      } catch {
        return null;
      }
    },
    async requestPersist(): Promise<PersistRequestResult> {
      if (!manager || typeof manager.persist !== 'function') return 'unsupported';
      try {
        return (await manager.persist()) ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },
    async estimate(): Promise<StorageEstimateInfo | null> {
      if (!manager || typeof manager.estimate !== 'function') return null;
      try {
        const estimate = await manager.estimate();
        return { usageBytes: finiteOrNull(estimate.usage), quotaBytes: finiteOrNull(estimate.quota) };
      } catch {
        return null;
      }
    },
  };
}
