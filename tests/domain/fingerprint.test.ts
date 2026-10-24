import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  fingerprintPayload,
  fingerprintQuestion,
  fingerprintRuntimeQuestion,
  normalizeText,
  sha256Hex,
} from '../../src/domain/fingerprint';
import type { RuntimeBank } from '../../src/domain/types';

const bankPath = fileURLToPath(new URL(`../../public/${CONTENT_RELEASE.bankFile}`, import.meta.url));
const bank = JSON.parse(readFileSync(bankPath, 'utf-8')) as RuntimeBank;

/** Wartości referencyjne policzone funkcją `normal()`/`fingerprint()` z redakcja/narzedzia (Python). */
const PYTHON_REFERENCE = [
  {
    stem: "  Kt\u00f3ra   odpowied\u017a\tjest\u00a0POPRAWNA?\n",
    options: ["Opcja A", "  opcja b ", "\ufb01broblasty", "Stra\u00dfe"],
    normalStem: "kt\u00f3ra odpowied\u017a jest poprawna?",
    normalOptions: ["opcja a", "opcja b", "fibroblasty", "strasse"],
    fingerprint: "b584424edad800f6e69e080ddf3083c0a22f638252624098242ad107c545d392",
  },
  {
    stem: "\u03a3 \u039f\u0394\u039f\u03a3 \u0085 test\u001c x \u2003 y",
    options: ["\u03c2", "\u03a3", "\u00b5g", "\u1e9e"],
    normalStem: "\u03c3 \u03bf\u03b4\u03bf\u03c3 test x y",
    normalOptions: ["\u03c3", "\u03c3", "\u03bcg", "ss"],
    fingerprint: "c91a13baf4722cbb733abc92f9c20fbdc054967db79fd8140de0a7abe4f5cd8a",
  },
  {
    stem: "\u017b\u00f3\u0142\u0107 \u0104\u0118 \u2014 \u201ecudzys\u0142\u00f3w\u201d \u00bd \u2460",
    options: ["zz", "ZZ ", "Z\u200aZ", "\u3000\u017a"],
    normalStem: "\u017c\u00f3\u0142\u0107 \u0105\u0119 \u2014 \u201ecudzys\u0142\u00f3w\u201d 1\u20442 1",
    normalOptions: ["zz", "zz", "z z", "\u017a"],
    fingerprint: "4c005b1e3f4b462f54522fe4e666137cc9bdfac41f99800eace9dc32c17c4909",
  },
] as const;

describe('normalizeText (zgodność z Pythonem: NFKC, strip, \\s+ → spacja, casefold)', () => {
  it.each(PYTHON_REFERENCE)('normalizuje stem i opcje jak generator: $normalStem', (ref) => {
    expect(normalizeText(ref.stem)).toBe(ref.normalStem);
    expect(ref.options.map(normalizeText)).toEqual(ref.normalOptions);
  });

  it('nie traktuje U+FEFF jako białego znaku (jak Python)', () => {
    const bom = String.fromCodePoint(0xfeff);
    expect(normalizeText(`${bom}a`)).toBe(`${bom}a`);
  });
});

describe('fingerprint', () => {
  it.each(PYTHON_REFERENCE)('daje ten sam SHA-256 co generator ($fingerprint)', async (ref) => {
    await expect(fingerprintQuestion({ stem: ref.stem, optionTexts: ref.options })).resolves.toBe(ref.fingerprint);
  });

  it('nie zależy od kolejności opcji', async () => {
    const a = await fingerprintQuestion({ stem: 'Pytanie', optionTexts: ['b', 'a', 'd', 'c'] });
    const b = await fingerprintQuestion({ stem: 'Pytanie', optionTexts: ['d', 'c', 'b', 'a'] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sortuje po punktach kodowych (jak sorted() w Pythonie)', () => {
    // U+FFFD (BMP) > U+1F600 w jednostkach UTF-16 (0xFFFD > 0xD83D), ale < w punktach kodowych.
    const replacement = String.fromCodePoint(0xfffd);
    const emoji = String.fromCodePoint(0x1f600);
    expect(compareCodePoints(replacement, emoji)).toBeLessThan(0);
    expect([emoji, replacement].sort()).toEqual([emoji, replacement]);
    expect(fingerprintPayload('s', [emoji, replacement])).toBe(`s\n${replacement}\n${emoji}`);
  });

  it('SHA-256 pustego tekstu ma znaną wartość', async () => {
    await expect(sha256Hex('')).resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it(`zgadza się z fingerprintem pytań banku V15 (${bank.questions.length})`, async () => {
    expect(bank.questions.length).toBeGreaterThan(0);
    const unexplained: string[] = [];
    for (const q of bank.questions) {
      if ((await fingerprintRuntimeQuestion(q)) === q.fingerprint) continue;
      // Znana wada generatora: fingerprint liczony z tekstu SPRZED poprawek odstępów (DISPLAY_FIXES).
      // Po cofnięciu tych poprawek wynik musi się zgadzać; każda inna rozbieżność = błąd.
      const original = revertDisplayFixes(q);
      if ((await fingerprintRuntimeQuestion(original)) !== q.fingerprint) unexplained.push(q.id);
    }
    expect(unexplained).toEqual([]);
  });
});

/**
 * Poprawki odstępów stosowane przez redakcja/narzedzia/zbuduj_runtime.py (DISPLAY_FIXES) PO policzeniu
 * fingerprintu. Do usunięcia, gdy generator zacznie liczyć fingerprint z tekstu runtime.
 */
const DISPLAY_FIXES: readonly (readonly [original: string, fixed: string])[] = [
  ['500 mikrogramów=0,5 mg', '500 mikrogramów = 0,5 mg'],
  ['głębokość2–3 cm', 'głębokość 2–3 cm'],
  ['głębokość5–6 cm', 'głębokość 5–6 cm'],
  ['po 18urodzinach', 'po 18 urodzinach'],
  ['art.48 ', 'art. 48 '],
];

function revertDisplayFixes(q: RuntimeBank['questions'][number]): RuntimeBank['questions'][number] {
  const revert = (text: string) => DISPLAY_FIXES.reduce((t, [original, fixed]) => t.split(fixed).join(original), text);
  return { ...q, stem_pl: revert(q.stem_pl), options: q.options.map((o) => ({ ...o, text_pl: revert(o.text_pl) })) };
}
