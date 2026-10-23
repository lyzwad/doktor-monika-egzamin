/**
 * Narzędzia trwałości: `navigator.storage`, daty ISO, bezpieczne URL/ścieżki, wykrywanie znaczników,
 * rozmiar UTF-8, mapowanie błędów.
 */
import { describe, expect, it } from 'vitest';
import { mapOpenError, mapWriteError } from '../../src/persistence/errors';
import { createStorageApi } from '../../src/persistence/storage';
import { containsUnsafeMarkup, findUnsafeStrings, isIsoDate, isIsoDateTime, isSafeHttpsUrl, isSafeRelativeMediaPath, utf8ByteLength } from '../../src/persistence/validation';
import { freshRepository } from './fixtures';

describe('StorageApi (navigator.storage)', () => {
  it('brak API → null/unsupported, bez wyjątków', async () => {
    const api = createStorageApi(null);
    expect(await api.persisted()).toBeNull();
    expect(await api.requestPersist()).toBe('unsupported');
    expect(await api.estimate()).toBeNull();
  });

  it('prośba o trwałość: granted/denied, szacunek miejsca', async () => {
    let granted = false;
    const manager = {
      persisted: async () => granted,
      persist: async () => {
        granted = true;
        return true;
      },
      estimate: async () => ({ usage: 1234, quota: 5_000_000 }),
    } as unknown as StorageManager;
    const api = createStorageApi(manager);
    expect(await api.persisted()).toBe(false);
    expect(await api.requestPersist()).toBe('granted');
    expect(await api.persisted()).toBe(true);
    expect(await api.estimate()).toEqual({ usageBytes: 1234, quotaBytes: 5_000_000 });

    const denying = createStorageApi({ persist: async () => false, estimate: async () => ({}) } as unknown as StorageManager);
    expect(await denying.requestPersist()).toBe('denied');
    expect(await denying.estimate()).toEqual({ usageBytes: null, quotaBytes: null });
    const throwing = createStorageApi({ persist: async () => Promise.reject(new Error('x')), persisted: async () => Promise.reject(new Error('x')) } as unknown as StorageManager);
    expect(await throwing.requestPersist()).toBe('denied');
    expect(await throwing.persisted()).toBeNull();
  });

  it('repozytorium udostępnia storage z opcji', async () => {
    const manager = { persist: async () => true } as unknown as StorageManager;
    const { repo } = freshRepository({ storageManager: manager });
    expect(await repo.storage.requestPersist()).toBe('granted');
    repo.close();
  });
});

describe('walidacja pól', () => {
  it('daty ISO 8601 z kontrolą kalendarza', () => {
    for (const ok of ['2026-10-22T18:42:00.000Z', '2026-10-22T18:42:00Z', '2026-10-22T18:42Z', '2024-02-29T00:00:00+01:00']) expect(isIsoDateTime(ok), ok).toBe(true);
    for (const bad of ['2026-02-30T10:00:00Z', '2025-02-29T00:00:00Z', '2026-10-22T24:00:00Z', '2026-10-22T18:42:00', '22.10.2026', '2026-10-22', '', 20261022, null]) {
      expect(isIsoDateTime(bad), String(bad)).toBe(false);
    }
    expect(isIsoDate('2026-10-22')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('URL źródła tylko https', () => {
    expect(isSafeHttpsUrl('https://pubmed.ncbi.nlm.nih.gov/37747400/')).toBe(true);
    for (const bad of ['http://x.org', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'https://', 'https://a b.org', 'https://u:p@x.org', ' https://x.org', 'https://x.org/"onmouseover=', 42]) {
      expect(isSafeHttpsUrl(bad), String(bad)).toBe(false);
    }
  });

  it('ścieżki mediów względne, wewnątrz paczki', () => {
    expect(isSafeRelativeMediaPath('figures/PLAN-FIG-01-pytanie.svg')).toBe(true);
    for (const bad of ['../x.svg', 'figures/../../x.svg', '/abs.svg', 'C:\\x.svg', 'https://x.org/a.svg', 'figures//a.svg', '.hidden', 'a.svg?x=1', '']) {
      expect(isSafeRelativeMediaPath(bad), bad).toBe(false);
    }
  });

  it('wykrywanie znaczników HTML i skryptów', () => {
    for (const bad of ['<b>x</b>', '</p>', '<br/>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<script', 'javascript:void(0)', 'VBScript:x', 'data:text/html;base64,xx', '<!-- x -->']) {
      expect(containsUnsafeMarkup(bad), bad).toBe(true);
    }
    for (const ok of ['stężenie < 5 mg', 'a <1 mm i > 2 mm', '2 < 3 > 1', 'Zakres 1–2 cm „cudzysłów”', 'e-mail: test@example.org']) {
      expect(containsUnsafeMarkup(ok), ok).toBe(false);
    }
    expect(findUnsafeStrings({ a: ['ok', { b: '<i>x</i>' }], c: 'javascript:1' }).sort()).toEqual(['a[1].b', 'c']);
  });

  it('rozmiar UTF-8 jak TextEncoder', () => {
    for (const text of ['', 'abc', 'Zażółć gęślą jaźń', '„cytat” — 50 µg', '😀 emoji', '\ud800 samotny surogat']) {
      expect(utf8ByteLength(text), text).toBe(new TextEncoder().encode(text).length);
    }
  });
});

describe('mapowanie błędów IndexedDB', () => {
  it('QuotaExceededError → QuotaExceeded; inne → WriteFailed z przyczyną; VersionError → Unavailable', () => {
    expect(mapWriteError(new DOMException('x', 'QuotaExceededError')).code).toBe('QuotaExceeded');
    const write = mapWriteError(new DOMException('zła wartość', 'DataError'));
    expect(write).toMatchObject({ code: 'WriteFailed', cause: 'DataError: zła wartość' });
    expect(mapWriteError(new DOMException('x', 'AbortError')).code).toBe('WriteFailed');
    expect(mapOpenError(new DOMException('x', 'VersionError')).messagePl).toMatch(/nowsza wersja aplikacji/);
    expect(mapOpenError(new DOMException('x', 'SecurityError')).code).toBe('Unavailable');
  });
});
