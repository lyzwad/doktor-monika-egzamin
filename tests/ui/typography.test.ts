/**
 * Typografia (kryterium G06 „Tekst minimum 16px”, PRZEKAZANIE §5; rozstrzygnięcie w DECYZJE §12):
 * KAŻDY tekst co najmniej 16 px — także metadane (Design: 14–15 px); jedyny wyjątek 13 px to etykiety
 * osi i daty wykresu (`aria-hidden`). Rozmiary wyłącznie przez tokeny w `rem` (Dynamic Type).
 * Test czyta arkusze stylów i pilnuje, by mniejszy stopień nie trafił poza oś wykresu.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const tokensCss = read('src/ui/styles/tokens.css');
const componentsCss = read('src/ui/styles/components.css');

/** Rozmiar tokenu `--fs-*` w px przy domyślnym rozmiarze tekstu (1rem = 17 px). */
function tokenSizes(css: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const m of css.matchAll(/(--fs-[a-z-]+):\s*([^;]+);/g)) {
    const [, name = '', value = ''] = m;
    const calc = /^calc\((\d+(?:\.\d+)?)rem\s*\/\s*17\)$/.exec(value.trim());
    if (calc?.[1]) sizes.set(name, Number(calc[1]));
    else if (value.trim() === '1rem') sizes.set(name, 17);
    else throw new Error(`Nieobsługiwana wartość tokenu ${name}: ${value}`);
  }
  return sizes;
}

/** Reguły `selektor { … font-size: … }` (bez zagnieżdżeń — arkusz ich nie używa). */
function fontSizeRules(css: string): { selector: string; value: string }[] {
  const rules: { selector: string; value: string }[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    const size = /font-size:\s*([^;]+);/.exec(m[2] ?? '');
    if (size?.[1]) rules.push({ selector, value: size[1].trim() });
  }
  return rules;
}

/** Metadane (§5): domena/poziom, podtytuły i liczniki wierszy, daty, oznaczenia, szczegóły wyniku. */
const METADATA = new Set([
  '.meta',
  '.btn__sub',
  '.list-row__subtitle',
  '.kv',
  '.tag',
  '.q-meta__domain',
  '.q-meta__level',
  '.resume__config',
  '.stepper__unit',
  '.select-row__meta',
  '.answer-card__letter',
  '.source-row__meta',
  '.zoom__desc-title',
  '.sheet__meta',
  '.radio-row__count',
  '.review-row__num',
  '.review-row__status',
  '.review-row__domain',
  '.history-row__status',
  '.filter-btn__label',
  '.chart__legend',
  '.chart__selected-body',
  '.about__versions',
  '.prep__pct',
]);
const AXIS = new Set(['.chart__axis-label', '.chart__dates']);

describe('typografia (G06)', () => {
  const sizes = tokenSizes(tokensCss);

  it('tokeny w rem względem 17 px: treść 17, przyciski/komunikaty/metadane 16, wyłącznie oś 13', () => {
    expect(sizes.get('--fs-body')).toBe(17);
    expect(sizes.get('--fs-label')).toBe(16);
    expect(sizes.get('--fs-meta')).toBe(16);
    expect(sizes.get('--fs-tag')).toBe(16);
    expect(sizes.get('--fs-min')).toBe(16);
    expect(sizes.get('--fs-axis')).toBe(13);
    const below16 = [...sizes].filter(([, px]) => px < 16).map(([name]) => name);
    expect(below16).toEqual(['--fs-axis']);
  });

  it('arkusz komponentów używa wyłącznie tokenów (bez px), żeby działał Dynamic Type', () => {
    for (const { selector, value } of fontSizeRules(componentsCss)) {
      expect(value, selector).toMatch(/^var\(--fs-[a-z-]+\)$/);
    }
  });

  it('poniżej 16 px wyłącznie oś wykresu (13 px); metadane — co najmniej 16 px (G06)', () => {
    const offenders: string[] = [];
    const metadata: string[] = [];
    for (const { selector, value } of fontSizeRules(componentsCss)) {
      const token = /^var\((--fs-[a-z-]+)\)$/.exec(value)?.[1];
      const px = token ? sizes.get(token) : undefined;
      if (METADATA.has(selector)) metadata.push(`${selector}: ${px ?? '?'} px`);
      if (px === undefined || px >= 16) continue;
      if (!AXIS.has(selector)) offenders.push(`${selector}: ${value} (${px} px)`);
    }
    expect(offenders).toEqual([]);
    expect(metadata.filter((m) => !/: (1[6-9]|[2-9]\d) px$/.test(m))).toEqual([]);
  });

  it('podpisy kart odpowiedzi, toast, banery, przyciski pomocnicze i podpowiedź mają co najmniej 16 px', () => {
    const rules = new Map(fontSizeRules(componentsCss).map((r) => [r.selector, r.value]));
    for (const selector of ['.answer-card__caption', '.toast', '.banner', '.btn--sm', '.action-row__hint', '.preview-bar__text', '.source-row__details']) {
      const token = /^var\((--fs-[a-z-]+)\)$/.exec(rules.get(selector) ?? '')?.[1];
      expect(token, selector).toBeTruthy();
      expect(sizes.get(token as string), selector).toBeGreaterThanOrEqual(16);
    }
  });
});
