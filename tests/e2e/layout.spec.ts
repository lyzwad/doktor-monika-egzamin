/**
 * G06: brak poziomego przewijania przy 320 px i przy powiększonym tekście (200%), tekst ≥ 16 px
 * (każdy widoczny tekst, także metadane — wyjątek: etykiety osi i daty wykresu, `aria-hidden`),
 * touch-targety ≥ 44 px dla kluczowych kontrolek (start, konfiguracja, pytanie, wynik, historia).
 * PRZEKAZANIE §9: przy 150–200% tekstu nic nie jest ucinane — wiersze Ustawień i Kopii danych nie
 * łamią słów w środku (UI-01). Powiększenie tekstu symulowane przez rozmiar fontu `html` (na iPhonie:
 * Dynamic Type przez `-apple-system-body` — do sprawdzenia na urządzeniu, G05).
 */
import { expect, test, type Page } from '@playwright/test';
import { answer, next, openFresh, startTest } from './helpers';

async function horizontalOverflow(page: Page): Promise<{ doc: number; scrollers: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    let scrollers = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.screen__scroll, main'))) {
      scrollers = Math.max(scrollers, el.scrollWidth - el.clientWidth);
    }
    return { doc, scrollers };
  });
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await horizontalOverflow(page);
  expect(o.doc, `${where}: dokument szerszy niż ekran`).toBeLessThanOrEqual(1);
  expect(o.scrollers, `${where}: przewijany obszar szerszy niż ekran`).toBeLessThanOrEqual(1);
}

async function expectTarget(page: Page, locator: ReturnType<Page['locator']>, name: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${name}: brak elementu`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${name}: szerokość`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${name}: wysokość`).toBeGreaterThanOrEqual(44);
}

async function setTextScale(page: Page, percent: number): Promise<void> {
  await page.evaluate((p) => {
    let style = document.getElementById('e2e-text-scale');
    if (!style) {
      style = document.createElement('style');
      style.id = 'e2e-text-scale';
      document.head.appendChild(style);
    }
    style.textContent = p === 100 ? '' : `html { font-size: ${(17 * p) / 100}px !important; }`;
  }, percent);
}

/** Przechodzi przez ekrany: start → konfiguracja → pytanie (przed i po odpowiedzi) → wynik → historia. */
async function walkScreens(page: Page, check: (where: string) => Promise<void>): Promise<void> {
  await check('start');
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('textbox', { name: 'Liczba pytań' })).toBeVisible();
  await check('konfiguracja');
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('2');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toBeVisible();
  await check('pytanie przed odpowiedzią');
  await answer(page, false);
  await check('pytanie z wyjaśnieniem');
  await next(page);
  await answer(page, true);
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.getByRole('heading', { name: 'Wynik testu' })).toBeVisible();
  await check('wynik');
  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
  await page.getByRole('button', { name: 'Historia' }).click();
  await expect(page.locator('.chart__point')).toHaveCount(1);
  await check('historia');
}

for (const width of [320, 393]) {
  for (const scale of [100, 200]) {
    test(`G06: ${width} px, tekst ${scale}% — brak poziomego przewijania`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      await openFresh(page);
      await setTextScale(page, scale);
      await walkScreens(page, async (where) => {
        await setTextScale(page, scale);
        await expectNoHorizontalScroll(page, `${where} (${width} px, ${scale}%)`);
      });
    });
  }
}

test('G06: tekst treści ≥ 16 px i touch-targety ≥ 44 px', async ({ page }) => {
  await openFresh(page);
  await expectTarget(page, page.locator('.mode-card').first(), 'karta Free Flow');
  await expectTarget(page, page.locator('.mode-card').nth(1), 'karta Test');
  await expectTarget(page, page.getByRole('button', { name: 'Historia' }), 'Historia');
  await expectTarget(page, page.getByRole('button', { name: 'Ustawienia' }), 'Ustawienia');
  await expectTarget(page, page.getByRole('button', { name: 'Zamknij wskazówkę' }), 'zamknięcie wskazówki');

  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expectTarget(page, page.getByRole('button', { name: 'Wstecz' }), 'Wstecz');
  await expectTarget(page, page.getByRole('button', { name: 'Zmniejsz o 10' }), 'Zmniejsz o 10');
  await expectTarget(page, page.getByRole('button', { name: 'Zwiększ o 10' }), 'Zwiększ o 10');
  await expectTarget(page, page.locator('.stepper__field'), 'pole liczby pytań (etykieta z polem)');
  await expectTarget(page, page.getByRole('group', { name: 'Szybki wybór' }).getByRole('button').first(), 'szybka wartość');
  await expectTarget(page, page.getByRole('button', { name: 'Rozpocznij test' }), 'Rozpocznij test');

  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('3');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toBeVisible();
  const sizes = await page.evaluate(() => ({
    stem: parseFloat(getComputedStyle(document.querySelector('p.stem') as Element).fontSize),
    option: parseFloat(getComputedStyle(document.querySelector('ul.answers .answer-card__body') as Element).fontSize),
  }));
  expect(sizes.stem).toBeGreaterThanOrEqual(16);
  expect(sizes.option).toBeGreaterThanOrEqual(16);
  await expectTarget(page, page.getByRole('button', { name: 'Przerwij test' }), 'Przerwij test');
  await expectTarget(page, page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }), 'flaga zgłoszenia');
  const cards = page.locator('ul.answers button.answer-card');
  for (let i = 0; i < 4; i++) await expectTarget(page, cards.nth(i), `wariant ${i + 1}`);
  await answer(page, true);
  const expl = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.expl__text') as Element).fontSize));
  expect(expl).toBeGreaterThanOrEqual(16);
  await expectTarget(page, page.getByRole('button', { name: 'Dalej' }), 'Dalej');
  await next(page);
  await expectTarget(page, page.getByRole('button', { name: 'Poprzednie pytanie' }), 'Poprzednie pytanie');
});

test('kotwica bez hasha i odświeżenie ekranu pomocniczego pod podścieżką (G01)', async ({ page }) => {
  await openFresh(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(page).toHaveURL(/#\/ustawienia$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await page.goto('./#/historia/free-flow');
  await expect(page.getByRole('tab', { name: 'Free Flow' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await startTestFromHome(page);
});

async function startTestFromHome(page: Page): Promise<void> {
  await page.goto('./#/');
  await startTest(page, 1);
  await expect(page).toHaveURL(/#\/sesja\/[0-9a-f-]+$/);
}

/** Widoczne teksty mniejsze niż 16 px (bez osi/dat wykresu i tekstów tylko dla czytników ekranu). */
async function smallTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest('.chart__axis-label, .chart__dates, .visually-hidden, [hidden], script, style')) continue;
      if (el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.95) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${px}px „${text.slice(0, 40)}”`);
    }
    return out;
  });
}

test('G06: każdy widoczny tekst ≥ 16 px na głównych ekranach (także metadane wyniku, historii i pytania)', async ({ page }) => {
  await openFresh(page);
  const check = async (where: string) => expect(await smallTexts(page), where).toEqual([]);
  await check('start');
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await check('konfiguracja testu');
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('2');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toBeVisible();
  await check('pytanie (domena, poziom, litery A–D)');
  await answer(page, false);
  await check('pytanie z wyjaśnieniem i źródłami');
  await next(page);
  await answer(page, true);
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.getByRole('heading', { name: 'Wynik testu' })).toBeVisible();
  await check('wynik (próg, konfiguracja, data, nota)');
  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
  await page.getByRole('button', { name: 'Historia' }).click();
  await expect(page.locator('.chart__point')).toHaveCount(1);
  await check('historia (lista, status, legenda)');
  await page.locator('.chart__point').first().click();
  await check('historia — wybrany punkt');
  await page.goto('./#/ustawienia');
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await check('ustawienia');
  await page.getByRole('button', { name: /Kopia danych/ }).click();
  await expect(page.getByRole('heading', { name: 'Kopia danych' })).toBeVisible();
  await check('kopia danych');
});

/** Słowa dłuższe niż szerokość swojego elementu (łamanie w środku słowa) w wierszach list. */
async function brokenWords(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return ['brak canvas'];
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const width = el.getBoundingClientRect().width;
      for (const word of (el.textContent ?? '').split(/\s+/).filter(Boolean)) {
        const w = ctx.measureText(word).width;
        if (w > width + 1) out.push(`„${word}” ${Math.round(w)}px > ${Math.round(width)}px (${el.className})`);
      }
    }
    return out;
  }, selector);
}

for (const width of [320, 393, 430]) {
  for (const scale of [150, 200]) {
    test(`UI-01: Ustawienia i Kopia danych — ${width} px, tekst ${scale}%: bez łamania słów i poziomego przewijania`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await openFresh(page);
      await page.getByRole('button', { name: 'Ustawienia' }).click();
      await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
      await setTextScale(page, scale);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.list-row__value', { hasText: /Włączone|Niepotwierdzone|Nieznane/ })).toBeVisible();
      await expectNoHorizontalScroll(page, `ustawienia (${width} px, ${scale}%)`);
      expect(await brokenWords(page, '.list-row__title, .list-row__value, .section__title'), `ustawienia (${width} px, ${scale}%)`).toEqual([]);
      await page.getByRole('button', { name: /Kopia danych/ }).click();
      await expect(page.getByRole('heading', { name: 'Kopia danych' })).toBeVisible();
      await expectNoHorizontalScroll(page, `kopia danych (${width} px, ${scale}%)`);
      expect(await brokenWords(page, '.card__title, .btn'), `kopia danych (${width} px, ${scale}%)`).toEqual([]);
    });
  }
}

