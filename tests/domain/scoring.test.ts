import { describe, expect, it } from 'vitest';
import { formatPercentPl, isPassed, passThreshold, percentTenths, pluralPl, truncatedPercent } from '../../src/domain/scoring';

describe('passThreshold = ceil(65 × N / 100)', () => {
  it.each([
    [20, 13],
    [30, 20],
    [40, 26],
    [50, 33],
    [60, 39],
    [3, 2],
    [1, 1],
    [100, 65],
    [7, 5],
  ])('N=%i → %i', (n, expected) => {
    expect(passThreshold(n)).toBe(expected);
  });

  it('zgadza się z Math.ceil dla N = 1…3000', () => {
    for (let n = 1; n <= 3000; n++) {
      expect(passThreshold(n)).toBe(Math.ceil((65 * n) / 100));
      expect(isPassed(passThreshold(n), n)).toBe(true);
      expect(isPassed(passThreshold(n) - 1, n)).toBe(false);
    }
  });

  it('odrzuca N < 1 i ułamki', () => {
    expect(() => passThreshold(0)).toThrow(RangeError);
    expect(() => passThreshold(-5)).toThrow(RangeError);
    expect(() => passThreshold(2.5)).toThrow(RangeError);
    expect(() => passThreshold(Number.NaN)).toThrow(RangeError);
  });
});

describe('isPassed — granice C04 (całkowitoliczbowo, bez zaokrąglonego procentu)', () => {
  it.each([
    [12, 20, false],
    [13, 20, true],
    [19, 30, false],
    [20, 30, true],
    [25, 40, false],
    [26, 40, true],
    [32, 50, false],
    [33, 50, true],
    [38, 60, false],
    [39, 60, true],
    [1, 1, true],
    [0, 1, false],
    [1, 3, false],
    [2, 3, true],
  ])('%i/%i → %s', (correct, n, expected) => {
    expect(isPassed(correct, n)).toBe(expected);
  });

  it('odrzuca niespójne dane', () => {
    expect(() => isPassed(21, 20)).toThrow(RangeError);
    expect(() => isPassed(-1, 20)).toThrow(RangeError);
    expect(() => isPassed(1.5, 20)).toThrow(RangeError);
  });
});

describe('formatPercentPl — obcięcie do 0,1, przecinek dziesiętny', () => {
  it.each([
    [13, 20, '65%'],
    [12, 20, '60%'],
    [20, 20, '100%'],
    [0, 20, '0%'],
    [1299, 2000, '64,9%'],
    [2, 3, '66,6%'],
    [1, 3, '33,3%'],
    [19, 30, '63,3%'],
    [1, 7, '14,2%'],
  ])('%i/%i → %s', (correct, total, expected) => {
    expect(formatPercentPl(correct, total)).toBe(expected);
  });

  it('0 ocenionych → null (bez dzielenia przez zero i bez „0%”)', () => {
    expect(formatPercentPl(0, 0)).toBeNull();
    expect(percentTenths(0, 0)).toBeNull();
    expect(truncatedPercent(0, 0)).toBeNull();
  });

  it('percentTenths i truncatedPercent obcinają w dół', () => {
    expect(percentTenths(2, 3)).toBe(666);
    expect(truncatedPercent(2, 3)).toBe(66.6);
    expect(truncatedPercent(1299, 2000)).toBe(64.9);
  });

  it('odrzuca correct > total', () => {
    expect(() => formatPercentPl(3, 2)).toThrow(RangeError);
  });
});

describe('pluralPl', () => {
  it.each([
    [1, 'pytanie'],
    [2, 'pytania'],
    [4, 'pytania'],
    [5, 'pytań'],
    [12, 'pytań'],
    [14, 'pytań'],
    [22, 'pytania'],
    [25, 'pytań'],
    [0, 'pytań'],
    [112, 'pytań'],
    [122, 'pytania'],
  ])('%i → %s', (n, expected) => {
    expect(pluralPl(n, 'pytanie', 'pytania', 'pytań')).toBe(expected);
  });
});
