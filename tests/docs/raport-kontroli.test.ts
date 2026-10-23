/**
 * G07 — końcowy raport kontroli `docs/RAPORT_KONTROLI.md`.
 *
 * Kryterium (05_KONTROLA/01_KRYTERIA_ODBIORU.txt): raport osobno podaje stan kodu/builda, stan testów, rzeczywistą
 * pulę, status recenzji treści, wykonane i niewykonane testy oraz link do wdrożenia tylko wtedy, gdy wdrożenie istnieje;
 * nie przedstawia paczki projektowej jako zainstalowanej aplikacji.
 *
 * Test pilnuje, żeby raport nie rozjechał się z repozytorium:
 * - wymagane sekcje i pełna macierz A01–G07 z dozwolonymi wynikami;
 * - G05 = NOT RUN, dopóki protokół z fizycznego iPhone'a (docs/INSTALACJA_IPHONE.md §6) ma status NOT RUN;
 * - liczby puli i statusy treści zgodne z `public/data/bank.json` (wersja, SHA-256, `counts`, statusy pytań);
 * - każde pominięcie (`test.skip`) w testach e2e opisane w sekcji testów niewykonanych;
 * - brak adresu wdrożenia w dokumentacji, jeśli raport mówi, że wdrożenia nie ma (i odwrotnie);
 * - README odsyła do raportu.
 * Wyniki liczbowe przebiegów (np. liczba testów Vitest) nie są tu sprawdzane — zmieniają się z kodem; raport podaje
 * je z datą przebiegu.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string): string => readFileSync(resolve(root, path), 'utf-8');

const REPORT_PATH = 'docs/RAPORT_KONTROLI.md';
const report = read(REPORT_PATH);
const bankRaw = readFileSync(resolve(root, 'public/data/bank.json'));

interface BankFile {
  bank_version: string;
  clinical_signoff: boolean;
  official_exam_question_bank: boolean;
  counts: {
    questions: number;
    families: number;
    by_domain: Record<string, number>;
    by_difficulty: Record<string, number>;
    schematic: number;
    independently_checked_draft: number;
  };
  questions: { content_check_status: string; review_status: string; approved_for_question_key: boolean; figure_id: string | null }[];
}
const bank = JSON.parse(bankRaw.toString('utf-8')) as BankFile;

/** Kryteria odbioru A01–G07 (05_KONTROLA/01_KRYTERIA_ODBIORU.txt). */
const CRITERIA: readonly string[] = [
  ...['A01', 'A02', 'A03', 'A04'],
  ...['B01', 'B02', 'B03', 'B04', 'B05', 'B06'],
  ...['C01', 'C02', 'C03', 'C04', 'C05'],
  ...['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07'],
  ...['E01', 'E02', 'E03', 'E04', 'E05', 'E06'],
  ...['F01', 'F02', 'F03', 'F04', 'F05'],
  ...['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07'],
];
const STATUSES: readonly string[] = ['PASS', 'PARTIAL', 'FAIL', 'NOT RUN'];

/** Treść sekcji `## …<tytuł>…` do następnego nagłówka `## `. */
function section(title: string): string {
  const lines = report.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.toLowerCase().includes(title.toLowerCase()));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wiersz tabeli: komórka z `` `klucz` `` (plus ewentualny opis), a w następnej komórce dokładnie wartość. */
function hasRow(text: string, key: string, value: string | number): boolean {
  const re = new RegExp('`' + escapeRe(key) + '`[^\\n|]*\\|\\s*`?' + escapeRe(String(value)) + '`?\\s*\\|');
  return re.test(text);
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

describe('G07 — raport kontroli: struktura', () => {
  it.each([
    'Stan kodu i buildu',
    'Stan testów',
    'Pula pytań',
    'Status recenzji treści',
    'Testy niewykonane',
    'Wdrożenie',
    'Macierz kryteriów',
  ])('ma osobną sekcję „%s”', (title) => {
    expect(section(title).trim().length).toBeGreaterThan(0);
  });

  it('macierz zawiera każde kryterium A01–G07 dokładnie raz, z wynikiem PASS / PARTIAL / FAIL / NOT RUN', () => {
    const matrix = section('Macierz kryteriów');
    const rows = [...matrix.matchAll(/^\|\s*([A-G]\d{2})\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({ id: m[1] ?? '', status: m[2] ?? '' }));
    expect(rows.map((r) => r.id).sort()).toEqual([...CRITERIA].sort());
    for (const row of rows) expect(STATUSES, `${row.id}: „${row.status}”`).toContain(row.status);
  });

  it('G05 nie jest PASS bez protokołu z fizycznego iPhone 15', () => {
    const matrix = section('Macierz kryteriów');
    const g05 = /^\|\s*G05\s*\|\s*([^|]+?)\s*\|/m.exec(matrix)?.[1];
    const deviceProtocolNotRun = /Status: \*\*NOT RUN\*\*/.test(read('docs/INSTALACJA_IPHONE.md'));
    if (deviceProtocolNotRun) expect(g05).toBe('NOT RUN');
    else expect(g05).not.toBe('PASS');
    expect(section('Testy niewykonane')).toContain('G05');
  });

  it('sekcja testów podaje komendy i wyniki: typecheck, Vitest, e2e, build z BASE_PATH, check-dist, check-offline', () => {
    const tests = section('Stan testów') + section('Stan kodu i buildu');
    for (const needle of ['npm run typecheck', 'vitest run', 'playwright test', 'BASE_PATH=/doktor-monika-egzamin/', 'check-dist.mjs', 'check-offline.mjs']) {
      expect(tests, needle).toContain(needle);
    }
  });

  it('każde pominięcie w testach e2e (test.skip) ma własny wiersz w sekcji testów niewykonanych', () => {
    // Pierwsza komórka wiersza musi wskazać plik i test (tytuł do pierwszego „:”), np. „`pwa.spec.ts`: „G02 + A04…”.
    const firstCells = section('Testy niewykonane')
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .map((l) => l.split('|')[1] ?? '');
    const specs = readdirSync(resolve(root, 'tests/e2e')).filter((f) => f.endsWith('.spec.ts'));
    const skips = specs.flatMap((spec) => {
      const source = read(`tests/e2e/${spec}`);
      return [...source.matchAll(/test\.skip\(/g)].map((m) => {
        const before = source.slice(0, m.index);
        const title = [...before.matchAll(/test\(\s*'([^']+)'/g)].at(-1)?.[1] ?? '';
        return { spec, prefix: title.split(':')[0] ?? '' };
      });
    });
    expect(skips.length).toBeGreaterThan(0);
    for (const { spec, prefix } of skips) {
      expect(prefix.length, spec).toBeGreaterThan(0);
      expect(firstCells.some((cell) => cell.includes(spec) && cell.includes(prefix)), `${spec} › ${prefix}`).toBe(true);
    }
  });
});

describe('G07 — raport kontroli: zgodność z rzeczywistą pulą', () => {
  const pool = section('Pula pytań');
  const review = section('Status recenzji treści');

  it('wersja i suma SHA-256 banku zgodne z public/data/bank.json', () => {
    const sha = createHash('sha256').update(bankRaw).digest('hex');
    expect(hasRow(pool, 'bank_version', bank.bank_version)).toBe(true);
    expect(pool).toContain(sha);
  });

  it('liczebności zgodne z bank.counts (pytania, rodziny, domeny, poziomy, schematy)', () => {
    const c = bank.counts;
    expect(c.questions).toBe(bank.questions.length);
    expect(hasRow(pool, 'counts.questions', c.questions)).toBe(true);
    expect(hasRow(pool, 'counts.families', c.families)).toBe(true);
    expect(hasRow(pool, 'counts.schematic', c.schematic)).toBe(true);
    for (const [d, n] of Object.entries(c.by_domain)) expect(hasRow(pool, `counts.by_domain.${d}`, n), d).toBe(true);
    for (const [k, n] of Object.entries(c.by_difficulty)) expect(hasRow(pool, `counts.by_difficulty.${k}`, n), k).toBe(true);
  });

  it('pula poniżej celu 2000 jest nazwana wprost (bez udawania osiągniętego celu)', () => {
    if (bank.counts.questions < 2000) {
      expect(pool).toMatch(/nie został osiągnięty/);
      expect(pool).toContain(String(2000 - bank.counts.questions));
    }
  });

  it('status recenzji treści zgodny z polami pytań i banku (bez podpisu klinicznego)', () => {
    expect(hasRow(review, 'clinical_signoff', String(bank.clinical_signoff))).toBe(true);
    expect(hasRow(review, 'official_exam_question_bank', String(bank.official_exam_question_bank))).toBe(true);
    for (const [status, n] of countBy(bank.questions, (q) => q.content_check_status)) {
      expect(hasRow(review, `content_check_status: ${status}`, n), status).toBe(true);
    }
    for (const [status, n] of countBy(bank.questions, (q) => q.review_status)) {
      expect(hasRow(review, `review_status: ${status}`, n), status).toBe(true);
    }
    const approved = bank.questions.filter((q) => q.approved_for_question_key).length;
    expect(hasRow(review, 'approved_for_question_key: true', approved)).toBe(true);
    expect(hasRow(review, 'counts.independently_checked_draft', bank.counts.independently_checked_draft)).toBe(true);
  });
});

describe('G07 — raport kontroli: wdrożenie i odesłania', () => {
  const deploy = section('Wdrożenie');
  /** Konkretne adresy GitHub Pages (bez szablonów w rodzaju `<użytkownik>.github.io`). */
  const pagesUrl = /https?:\/\/[a-z0-9-]+\.github\.io[^\s)`'"\]>]*/gi;
  const docs = ['README.md', ...readdirSync(resolve(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  // Końcowa interpunkcja zdania (np. „…/doktor-monika-egzamin/.”) nie jest częścią adresu.
  const urls = docs.flatMap((f) => [...read(f).matchAll(pagesUrl)].map((m) => `${f}: ${m[0].replace(/[.,;:]+$/, '')}`));

  it('adres wdrożenia tylko wtedy, gdy wdrożenie istnieje', () => {
    if (/Adres wdrożenia: \*\*brak\*\*/.test(deploy)) {
      expect(urls).toEqual([]);
    } else {
      expect(urls.length).toBeGreaterThan(0);
      for (const entry of urls) expect(deploy).toContain(entry.slice(entry.indexOf(': ') + 2));
    }
  });

  it('README odsyła do raportu kontroli', () => {
    expect(read('README.md')).toContain(REPORT_PATH);
  });
});
