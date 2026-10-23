import { describe, expect, it } from 'vitest';
import { deriveSeed, hashString32, mulberry32, randomInt, rngFor, shuffle } from '../../src/domain/rng';

describe('mulberry32', () => {
  it('jest deterministyczny dla tego samego seeda', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('ma stabilną sekwencję referencyjną (zmiana algorytmu = zmiana doboru zapisanych sesji)', () => {
    const r = mulberry32(1);
    const first = Array.from({ length: 3 }, () => r());
    expect(first).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it('zwraca wartości z [0, 1) i różne sekwencje dla różnych seedów', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('używa młodszych 32 bitów seeda', () => {
    expect(mulberry32(2 ** 32 + 7)()).toBe(mulberry32(7)());
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)());
  });
});

describe('shuffle', () => {
  it('zwraca permutację bez mutowania wejścia', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const copy = input.slice();
    const out = shuffle(input, mulberry32(7));
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
    expect([...out].sort((x, y) => x - y)).toEqual(copy);
  });

  it('jest deterministyczne dla seeda i obsługuje puste/jednoelementowe tablice', () => {
    expect(shuffle([1, 2, 3, 4], mulberry32(9))).toEqual(shuffle([1, 2, 3, 4], mulberry32(9)));
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(['a'], mulberry32(1))).toEqual(['a']);
  });

  it('daje wszystkie 24 permutacje 4 opcji przy różnych seedach (bez skrzywienia do jednej)', () => {
    const seen = new Map<string, number>();
    for (let seed = 0; seed < 24_000; seed++) {
      const key = shuffle(['A', 'B', 'C', 'D'], mulberry32(seed)).join('');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(seen.size).toBe(24);
    for (const count of seen.values()) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});

describe('randomInt, hashString32, deriveSeed', () => {
  it('randomInt mieści się w zakresie i odrzuca złe argumenty', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = randomInt(r, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(() => randomInt(r, 0)).toThrow(RangeError);
    expect(() => randomInt(r, 2.5)).toThrow(RangeError);
  });

  it('hashString32 to FNV-1a (wartości referencyjne)', () => {
    expect(hashString32('')).toBe(0x811c9dc5);
    expect(hashString32('a')).toBe(0xe40c292c);
  });

  it('deriveSeed jest deterministyczny i rozróżnia sole', () => {
    expect(deriveSeed(123, 'replacement:1')).toBe(deriveSeed(123, 'replacement:1'));
    expect(deriveSeed(123, 'replacement:1')).not.toBe(deriveSeed(123, 'replacement:2'));
    expect(deriveSeed(123, 'x')).not.toBe(deriveSeed(124, 'x'));
    const s = deriveSeed(0, 0);
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    expect(rngFor(5, 'a')()).toBe(mulberry32(deriveSeed(5, 'a'))());
  });
});
