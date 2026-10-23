import { describe, expect, it } from 'vitest';
import { DEFAULT_FREE_FLOW_CONFIG, DEFAULT_TEST_CONFIG, FREE_FLOW_BASE_WEIGHTS, TEST_DOMAIN_ROTATION } from '../../src/domain/policies';
import { domainError, emptyChangeset, emptyUserState, isChangesetEmpty } from '../../src/domain/state';
import { DOMAIN_IDS } from '../../src/domain/types';

describe('stan początkowy i changeset', () => {
  it('pusty stan jest zgodny z pierwszym uruchomieniem', () => {
    const s = emptyUserState();
    expect(s.settings).toMatchObject({ id: 'settings', lastTestConfig: null, lastFreeFlowConfig: null });
    expect(Object.keys(s.sessions)).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('isChangesetEmpty rozpoznaje brak zmian', () => {
    const c = emptyChangeset('cmd-1');
    expect(isChangesetEmpty(c)).toBe(true);
    expect(isChangesetEmpty({ ...c, stores: { sessions: { put: [], delete: [] } } })).toBe(true);
    expect(isChangesetEmpty({ ...c, stores: { blocks: { put: [], delete: ['b1'] } } })).toBe(false);
  });

  it('domainError niesie kod i komunikat PL', () => {
    expect(domainError('INVALID_N', 'Wpisz liczbę pytań.')).toEqual({ code: 'INVALID_N', messagePl: 'Wpisz liczbę pytań.' });
  });
});

describe('parametry polityk (DECYZJE §6–§7)', () => {
  it('domyślna konfiguracja: cały zakres, mieszany, Test 20', () => {
    expect(DEFAULT_TEST_CONFIG).toEqual({ scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false });
    expect(DEFAULT_FREE_FLOW_CONFIG.targetN).toBeNull();
  });

  it('rotacja domen testu: ANAT, INJ, SKIN, THER, DEV, SAFE', () => {
    expect(TEST_DOMAIN_ROTATION).toEqual(['ANAT', 'INJ', 'SKIN', 'THER', 'DEV', 'SAFE']);
  });

  it('wagi Free Flow: DEV 0,40, pozostałe po 0,12, suma 1', () => {
    expect(FREE_FLOW_BASE_WEIGHTS.DEV).toBe(0.4);
    const sum = DOMAIN_IDS.reduce((acc, d) => acc + FREE_FLOW_BASE_WEIGHTS[d], 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
