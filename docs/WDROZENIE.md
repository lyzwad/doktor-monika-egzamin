# Doktor Monika Egzamin — wdrożenie, PWA i praca offline

Stan: 25.10.2026. **Adres produkcyjny: https://wiedza.doktormonika.pl/** — GitHub Pages z własną domeną, build pod `/`, Enforce HTTPS (§12 niżej; kontrola: `docs/RAPORT_KONTROLI.md` §7). Historia: 23.10.2026 **opublikowano** pod https://lyzwad.github.io/doktor-monika-egzamin/ (repozytorium https://github.com/lyzwad/doktor-monika-egzamin, run 39954751951). Wynik kontroli po wdrożeniu: `docs/RAPORT_KONTROLI.md` §7.

## 1. Co sprawdzono w dokumentacji i kiedy

Wszystkie pozycje sprawdzono 22.10.2026 (strony pobrane tego dnia; zachowanie bibliotek dodatkowo w zainstalowanym kodzie z `package-lock.json`). Ponowna weryfikacja tego samego dnia (etap integracji): Vite *Deploying a Static Site*, vite-pwa *Prompt for new content*, WebKit *Updates to Storage Policy*, MDN manifest `id` i *Storage quotas*, strona Apple (PL i EN), `action.yml` akcji `configure-pages` w przypiętym commicie oraz tagi akcji — bez zmian poza nazwą pierwszego przycisku w Safari (poprawione niżej).

| Źródło | Co z niego wynika dla projektu |
|---|---|
| Vite, *Deploying a Static Site* — https://vite.dev/guide/static-deploy.html (oraz plik przykładu `docs/guide/static-deploy-github-pages.yaml` w repozytorium vitejs/vite) | Dla adresu `https://<użytkownik>.github.io/<repozytorium>/` ustawić `base: '/<repozytorium>/'`. W repozytorium: Settings → Pages → Build and deployment → Source: **GitHub Actions**. Przykładowy workflow: `npm ci`, `npm run build`, publikacja katalogu `./dist` akcjami `actions/checkout` v7, `actions/setup-node` v7, `actions/configure-pages` v6, `actions/upload-pages-artifact` v5, `actions/deploy-pages` v5. `vite preview` służy do lokalnego podglądu, nie jest serwerem produkcyjnym. |
| Tagi akcji GitHub (`git ls-remote --tags`) | Przypięte commity w `.github/workflows/pages.yml`: checkout v7.0.1 `3d3c42e5…`, setup-node v7.1.0 `949feb24…`, configure-pages v6.0.0 `45bfe019…`, upload-pages-artifact v5.0.0 `fc324d35…`, deploy-pages v5.0.1 `368f8252…` (te same commity co w przykładzie Vite; przy ponownym sprawdzeniu nadal najnowsze wydania). |
| `actions/configure-pages` v6.0.0 `action.yml` | Wyjście `base_path`: „/my-repo” albo „” (strona użytkownika, własna domena). Workflow liczy `BASE_PATH` z nazwy repozytorium i porównuje z tym wyjściem; przy rozbieżności (własna domena) obowiązuje ścieżka Pages. |
| `actions/upload-pages-artifact` v5.0.0 `action.yml` | Archiwizuje wskazany katalog; domyślnie pomija pliki ukryte oraz `.git`, `.github`. |
| GitHub Docs: *What is GitHub Pages?*, *GitHub Pages limits*, *Configuring a publishing source* (źródła w repozytorium github/docs) | Pages dostępne w repozytoriach publicznych w planie GitHub Free. Strona Pages jest publiczna w internecie (nawet przy repozytorium prywatnym w planach, które na to pozwalają). Limity: opublikowana strona ≤ 1 GB, miękki limit transferu 100 GB/mies., miękki limit 10 buildów/h nie dotyczy własnego workflow Actions. Pages nie służą do wrażliwych transakcji. Adres projektu: `https://<właściciel>.github.io/<repozytorium>`. Odwiedziny są logowane przez GitHub (adres IP) — to nie jest telemetria aplikacji. |
| Nagłówki odpowiedzi GitHub Pages (`curl -I https://pages.github.com/`) | `cache-control: max-age=600` — nowa wersja może być widoczna z opóźnieniem do ok. 10 minut. |
| vite-pwa: *Prompt for new content*, *Register Service Worker*, *Service Worker Precache*, *Deploy* — https://vite-pwa-org.netlify.app/ | `registerType: 'prompt'` (domyślny) — `onNeedRefresh` do pokazania banera, `onOfflineReady` po pierwszym zapisie offline; nie wyłączać `cleanupOutdatedCaches`; domyślny precache obejmuje tylko css/js/html — inne typy dopisać w `globPatterns`; `sw.js`, `index.html` i manifestu nie podawać z `immutable`, manifest jako `application/manifest+json`. |
| Kod `vite-plugin-pwa` 2.0.0 (node_modules) | `updateServiceWorker()` wysyła `SKIP_WAITING` (workbox-window `messageSkipWaiting`); po przejęciu strony przeładowuje ją albo wywołuje `onNeedReload`. `injectRegister: false` — brak skryptu w HTML (rejestracja w `src/pwa`). Scope SW = `base`, adres SW = `${base}sw.js`, link manifestu = `${base}manifest.webmanifest`. Domyślnie `navigateFallback: 'index.html'`. `skipWaiting`/`clientsClaim` są wymuszane tylko dla `autoUpdate` — tu jawnie `false`. W trybie dev `virtual:pwa-register` nic nie rejestruje. |
| Kod Workbox 7.4.1 (workbox-precaching, workbox-core) | Instalacja zapisuje pliki po kolei; plik już obecny w cache (ten sam klucz z rewizją) nie jest pobierany ponownie; wpisy z rewizją pobierane z `cache: 'reload'`; stare wpisy usuwane dopiero przy aktywacji nowej wersji — nieudane pobranie aktualizacji zostawia działającą starą wersję. Nazwa cache: `workbox-precache-v2-<scope>`. |
| MDN: *Using Service Workers*, `ServiceWorkerContainer.register()`, `ServiceWorkerRegistration.update()`, *Offline and background operation* — https://developer.mozilla.org/ | SW wymaga bezpiecznego kontekstu (HTTPS albo localhost). Domyślny i maksymalny scope = katalog skryptu SW. Nowa wersja czeka, aż strony starej wersji zostaną zamknięte, chyba że wywoła `skipWaiting()`. Pierwszy SW aktywuje się od razu, ale otwarta strona jest kontrolowana dopiero po ponownym otwarciu (bez `clients.claim()`). Nieudana instalacja = worker nieużywany. `updateViaCache: 'imports'` — główny skrypt SW zawsze z sieci. `update()` instaluje nowy worker, gdy skrypt różni się bajtowo. |
| MDN: manifest `id` — https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/id | Względne `id` jest rozwiązywane względem **originu** `start_url`; bez `id` używany jest `start_url`. Dlatego `id` = ścieżka bazowa (np. `/doktor-monika-egzamin/`), a nie `.` (co dałoby korzeń `github.io`, wspólny dla wszystkich projektów użytkownika). |
| MDN: *Storage quotas and eviction criteria* | Safari (iOS 17+): origin do ok. 60% dysku, także aplikacja z ekranu głównego; łącznie 80%. Przy włączonej ochronie przed śledzeniem Safari usuwa dane utworzone skryptem po 7 dniach używania przeglądarki bez interakcji z witryną. `persist()` — decyzja automatyczna, bez pytania. Przekroczenie limitu: `QuotaExceededError`. |
| WebKit, *Updates to Storage Policy* (10.08.2023) — https://webkit.org/blog/14403/updates-to-storage-policy/ | Safari 17 / iOS 17: domyślny tryb „best-effort” (dane mogą być usunięte, kolejność LRU per origin); `persist()` prosi o tryb trwały, przyznawany heurystycznie (m.in. gdy witryna działa jako aplikacja z ekranu głównego); `estimate()` dostępne; limit to górna granica, nie gwarancja. |
| WebKit, *Full Third-Party Cookie Blocking and More* (24.03.2020) — https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ | Limit 7 dni dla danych skryptów (IndexedDB, rejestracje SW i cache) liczy się w Safari; aplikacje z ekranu głównego mają własny licznik dni faktycznego użycia — WebKit nie przewiduje usuwania ich danych tym mechanizmem. To deklaracja producenta, nie gwarancja. |
| Apple, *Używanie witryny jako aplikacji w Safari na iPhonie* — https://support.apple.com/pl-pl/guide/iphone/iphea86e5236/ios (wersje iOS 27 i iOS 26; wersja angielska: https://support.apple.com/en-us/guide/iphone/iphea86e5236/ios) | Safari → **przycisk Menu strony** (ang. *Page Menu button*; ikona bez podpisu) → **Udostępnij** (w układzie kart „Na dole”/„Na górze” od razu **przycisk udostępniania**) → przewiń → **Do ekranu głównego** (gdy brak: **Edytuj czynności**) → włącz **Otwórz jako aplikację www** → **Dodaj**. Wcześniejszy opis „przycisk Więcej” poprawiono wg tekstu alternatywnego ikon na stronie Apple. Szczegóły: `docs/INSTALACJA_IPHONE.md`. |

## 2. Wymagania

- Node.js zgodny z `package.json` (`engines`: `^22.22.2 || >=24.15.0`; `.nvmrc`: 24), npm.
- Zależności wyłącznie z `package-lock.json` (`npm ci`). Brak kluczy API, sekretów i usług zewnętrznych.

## 3. Uruchomienie lokalne

```bash
npm ci
npm run dev            # http://localhost:5173/ — Service Worker wyłączony w trybie dev
# ?mock=1 — kontroler w pamięci (tylko dev), np. http://localhost:5173/?mock=1
```

Test na telefonie przez `http://<IP-komputera>:5173` **nie** sprawdzi pracy offline ani zapisu: Service Worker, `crypto.subtle` i `crypto.randomUUID()` wymagają HTTPS albo localhost. Do testu na iPhonie potrzebny jest adres HTTPS (wdrożenie).

## 4. Build

```bash
npm run build                                   # typecheck + vite build → dist/ (base = /)
BASE_PATH=/ npm run build  # katalog główny domeny wiedza.doktormonika.pl
# opcjonalnie APP_BUILD_ID=<skrót commita> — wersja „0.1.0+<skrót>” w Ustawieniach i w kopii (ustawia workflow)
```

Build tworzy w `dist/`: `index.html`, `assets/` (JS, CSS, fonty woff2), `data/bank-<sha12>.json`, `data/retired-question-ids-<sha12>.json`, `data/training-profile-<sha12>.json`, `figures/`, `icons/`, `manifest.webmanifest`, `sw.js`, `workbox-*.js`, `dme-sw-takeover-<sha12>.js`, `pwa-precache.json`, `dme-release.json` (poza precache).

Konfiguracja PWA (`vite.config.ts`, sekcja PWA):

- `registerType: 'prompt'`, `injectRegister: false` (rejestracja w `src/pwa/registerSW.ts`), `skipWaiting: false`, `clientsClaim: false`, `cleanupOutdatedCaches: true`, `navigateFallback: 'index.html'` (nawigacja w obrębie scope, routing aplikacji jest hashowy).
- Precache: `**/*.{html,js,css,woff2,svg,png,json}` — shell, JS/CSS, lokalne fonty, ikony, figury SVG i trzy pliki banku V15; plus manifest (bez `pwa-precache.json` i `dme-release.json`). Limit pojedynczego pliku: **16 MB** (`maximumFileSizeToCacheInBytes`). Sprawdzono build z bankiem 9,4 MB (w precache). Jeżeli `index.html` albo któryś plik banku V15 nie zmieści się w precache, **build kończy się błędem** (zamiast cicho wyłączyć naukę offline).
- Manifest: nazwa „Doktor Monika Egzamin”, `short_name` także „Doktor Monika Egzamin” (USTALENIA pkt 33; iOS sam skraca etykietę), `lang: pl`, `display: standalone`, `orientation: portrait`, kolory `#FAFBFC`, `start_url` i `scope` = `.` (względem adresu manifestu = `base`), `id` = `base`, ikony 192/512 (`any`) i 512 (`maskable`); `apple-touch-icon` 180 w `index.html`.
- `pwa-precache.json` (poza precache): lista plików precache z rozmiarami — do paska postępu „Przygotowanie materiałów do nauki”.

Ikony: `node scripts/generate-icons.mjs` rasteryzuje autorski znak `scripts/icons/znak-dm.svg` (litery „DM” w `--primary` #3C5C7C na `--bg` #FAFBFC, akcent `--teal`; krój Hanken Grotesk 700 z `@fontsource`, OFL) do `public/icons/` przez Chromium z lokalnego cache Playwright. PNG są nieprzezroczyste (RGB), iOS sam zaokrągla rogi.

## 5. Podgląd lokalny (jak na GitHub Pages)

```bash
BASE_PATH=/ npm run build
node scripts/serve-dist.mjs --dist dist --base / --port 4174
# → http://127.0.0.1:4174/
```

`scripts/serve-dist.mjs` podaje pliki tylko pod podścieżką, z `Cache-Control: max-age=600` i 404 dla braków — tak jak Pages. Alternatywnie `BASE_PATH=/doktor-monika-egzamin/ npx vite preview` (też tylko podgląd lokalny).

## 6. Kontrole przed publikacją

```bash
# 1. Statyczna kontrola dist (kod wyjścia 1 = błąd):
node scripts/check-dist.mjs --dist dist --base /
# 2. Service Worker w przeglądarkach (Chromium i WebKit z cache Playwright):
node scripts/check-offline.mjs --dist dist --base /
# 3. Testy logiki PWA (atrapy SW, bez przeglądarki) — także w `npm test` (projekt `pwa`):
npx vitest run tests/pwa
# 4. Testy e2e przepływów A–F, offline, aktualizacji i układu na buildzie pod podścieżką
#    (WebKit „iPhone 15” 393×852 i Chromium mobile; przeglądarki z cache Playwright):
npm run test:e2e
```

`check-dist.mjs` sprawdza: odwołania w `index.html` i manifeście (tylko pod `base`, pliki istnieją), `start_url`/`scope`/`id`, ikony i ich wymiary (w tym apple-touch-icon 180), komplet precache (żaden plik aplikacji poza precache, trzy pliki banku V15 w środku), treść V15 (SHA-256, `bank_version`, liczby 2987/1048/1366/573, 133 wyłączone ID, brak `data/bank.json`), skrypt przejęcia, `navigateFallback`, brak `clientsClaim` i samoczynnego `skipWaiting`, rejestrację SW w JS z adresem `${base}sw.js` i scope `${base}`, brak adresów `http(s)://` do hostów zewnętrznych (poza adresami źródeł w pliku banku oraz identyfikatorami, które nie są żądaniami: przestrzenie nazw XML, link w treści błędu React, link w ostrzeżeniu konsoli Workbox), brak `support.js`, `fonts.googleapis`/`gstatic`, wzorców sekretów (`sk-…`, `api_key`, `Bearer`, AWS/GitHub, klucze prywatne), słów `anthropic`/`openai`/`claude.ai` w kodzie, mocka kontrolera, map źródeł, katalogów roboczych; SVG bez skryptów i zasobów zewnętrznych.

`check-offline.mjs` uruchamia serwer jak w p. 5 i sprawdza w Chromium i WebKit: rejestrację i scope, komplet precache, brak przejęcia strony przy pierwszej instalacji, start offline (aplikacja, bank, fonty, trasa `#/historia`, nawigacja w scope → `index.html`), aktualizację (nowa wersja czeka, brak przeładowania, aktywacja dopiero po `SKIP_WAITING`), nieudane pobranie aktualizacji (stara wersja działa offline), przerwane pierwsze przygotowanie i surowe ponowienie samego SW (z kompletem cache po ponowieniu) oraz **S24a w zintegrowanej aplikacji**: ekran „Nie udało się zapisać wszystkich materiałów” → „Spróbuj ponownie” albo zamknięcie i ponowne otwarcie → komplet precache, strona kontrolowana po przeładowaniu, start bez sieci pod adresem spoza cache HTTP. **Nie zastępuje testu na fizycznym iPhonie (G05).**

## 7. Publikacja na GitHub Pages — krok po kroku

Nic z tego nie zostało jeszcze wykonane.

1. **Repozytorium publiczne tylko z kodem aplikacji.** Utwórz na GitHubie nowe, publiczne repozytorium (np. `doktor-monika-egzamin`). Wypchnij do niego **wyłącznie zawartość katalogu aplikacji** `doktor-monika-egzamin/` — bez katalogów `_zrodla/` i `redakcja/` (leżą obok, poza repozytorium aplikacji i nie mogą do niego trafić), bez `dist/`, `node_modules/`, kopii danych (`*.json` z eksportu), zgłoszeń i notatek roboczych. Przed pierwszym `git push` sprawdź listę plików:
   ```bash
   cd doktor-monika-egzamin
   git status --short          # tylko: .github/ docs/ index.html package*.json public/ scripts/ src/ tests/ tsconfig*.json vite/vitest/playwright config, README.md, .gitignore, .nvmrc
   git ls-files | grep -Ei '_zrodla|redakcja|backup|kopia|\.env' || echo "OK — brak plików roboczych"
   ```
   Wszystko, co trafi do repozytorium i do `dist`, jest publiczne (kod i pytania banku V15 z `public/data/`). Historia nauki, kopie i zgłoszenia pozostają wyłącznie na telefonie.
2. **Źródło publikacji.** W repozytorium: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. **Workflow.** Plik `.github/workflows/pages.yml` uruchamia się przy `push` do `main` albo ręcznie (Actions → „Publikacja na GitHub Pages” → Run workflow). Kroki: `npm ci` → `configure-pages` → `BASE_PATH=/<nazwa-repozytorium>/` (z nazwy repozytorium; repozytorium `<właściciel>.github.io` → `/`; przy rozbieżności z adresem Pages, np. własna domena, obowiązuje ścieżka Pages i ostrzeżenie w logu) oraz `APP_BUILD_ID` = skrót commita → `npm test` (domain, persistence, app, pwa, ui) → `npm run build` (typecheck + build) → `check-dist.mjs` → artefakt **tylko z `dist`** → `deploy-pages`. Błąd testów albo kontroli `dist` zatrzymuje publikację. Testy e2e (Playwright) nie są uruchamiane w CI — wymagają przeglądarek; uruchamiać lokalnie przed wypchnięciem (`npm run test:e2e`, `check-offline.mjs`).
4. **Adres.** Po udanym wdrożeniu adres widać w podsumowaniu zadania `deploy` i w Settings → Pages: `https://<użytkownik>.github.io/<nazwa-repozytorium>/`. Otwórz go w Safari na iPhonie i postępuj wg `docs/INSTALACJA_IPHONE.md`.
5. **Kontrola po wdrożeniu.** Na komputerze: adres otwiera się, odświeżenie dowolnego ekranu (`#/historia`, `#/ustawienia`) działa, `…/manifest.webmanifest` i `…/sw.js` odpowiadają 200; w narzędziach przeglądarki brak żądań do innych hostów.
6. **Nie zmieniaj nazwy repozytorium ani domeny po instalacji.** Inna ścieżka/origin = inna aplikacja: dane z IndexedDB nie przejdą same. Przed taką zmianą zapisz kopię (Ustawienia → Kopia) i wczytaj ją w nowej instalacji.

`robots.txt` nie jest dodawany: dla strony projektu (`/<repozytorium>/`) roboty czytają `robots.txt` tylko z korzenia domeny `github.io`, więc plik w podścieżce nic by nie zmienił.

## 8. Service Worker, przygotowanie offline i aktualizacje

**Pierwsze uruchomienie (S24a).** Po wczytaniu strony rejestrowany jest `sw.js` (scope = `base`). SW zapisuje w Cache Storage wszystkie pliki precache (shell, JS/CSS, fonty, ikony, figury, bank). `src/pwa` mierzy postęp (bajty plików z `pwa-precache.json` obecne w cache) i zgłasza `offlineReady` dopiero wtedy, gdy instalacja się zakończyła **i** w cache jest komplet plików z listy. Przerwanie (np. utrata sieci) → stan `failed` z ponowieniem (`checkForUpdate()`, w UI „Spróbuj ponownie”); Workbox pomija pliki już zapisane, ale **w WebKit (Playwright, silnik Safari) po nieudanej pierwszej instalacji częściowy zapis nie jest zachowany** i ponowienie pobiera wszystko od nowa (zob. p. 10). Pierwsza instalacja nie przejmuje otwartej strony; nauka działa od razu online, a offline — od następnego otwarcia.

**Obejście błędu WebKit (zmierzone 22.10.2026, Playwright WebKit 2359).** Po nieudanej pierwszej instalacji cache `workbox-precache-v2-<scope>` zostaje pusty, a przy ponownej instalacji zapis tych samych kluczy do tego cache ginie: SW staje się aktywny z 1/18 plików i aplikacja nie startuje offline (`FetchEvent.respondWith … Load failed`), choć zgłosiłaby gotowość. `src/pwa` dlatego:
- przed każdą rejestracją bez działającej instalacji (pierwsze uruchomienie, „Spróbuj ponownie”, ponowne otwarcie po przerwaniu) usuwa **pusty** cache precache tej aplikacji (dokładna nazwa z pełnym scope — cache innych aplikacji tego samego originu, np. innych stron projektów na `github.io`, nie są ruszane; niepusty cache zostaje, więc Chromium dalej dociąga tylko braki);
- po pierwszej instalacji sprawdza komplet plików; gdy czegoś brakuje — nie zgłasza gotowości, wyrejestrowuje tę instalację (strona nie jest nią kontrolowana), czyści cache i pokazuje stan „przerwane” z ponowieniem.
Sprawdzone w Chromium i WebKit (`check-offline.mjs`, scenariusz 6). Czy ten sam błąd występuje w Safari na iOS — do obserwacji w G05 (lista, p. 15).

**Aktualizacja.** Nowy build = nowy `sw.js` (zmiana rewizji plików). Przeglądarka sprawdza go przy otwarciu aplikacji, a `src/pwa` dodatkowo przy powrocie do aplikacji (najwyżej co godzinę, tylko online). Nowa wersja pobiera się w tle do tego samego cache i **czeka** (`waiting`); otwarte pytanie nie jest przeładowywane. Baner „Uruchom ponownie” pokazuje UI poza ekranem pytania. `applyUpdate()` działa tylko po potwierdzeniu kontrolera (`confirmUpdateSafe` → `isUpdateSafe`: brak ekranu pytania, brak zapisu w toku/niezapisanych zmian, aplikacja uruchomiona); wtedy wysyła `SKIP_WAITING`, a po przejęciu przez nową wersję przeładowuje stronę i ustawia flagę dla toastu „Aplikacja zaktualizowana…”. Zamknięcie aplikacji (przesunięcie w przełączniku aplikacji) i ponowne otwarcie także uruchamia nową wersję — bez utraty danych w IndexedDB. Nieudane pobranie nowej wersji zostawia starą (sprawdzone w Chromium i WebKit).

**Zmiana wersji TREŚCI (banku pytań) — przejęcie bez banera (od V15, 24.10.2026).** Skrypt `dme-sw-takeover-<sha12>.js` (źródło `scripts/sw-takeover.mjs`, `importScripts` w `sw.js`) przy aktualizacji, w której znacznik wersji treści w Cache Storage różni się od wersji buildu, wywołuje `skipWaiting()`, a przy aktywacji `clients.claim()`, wysyła do okien `DME_CONTENT_UPDATE` i wywołuje `client.navigate(client.url)` — przeładowuje także karty i aplikację z ikony ze starym kodem; dawna ścieżka `data/bank.json` w scope → 404. Wsparcie (MDN / `@mdn/browser-compat-data` 8.1.7, 24.10.2026): `skipWaiting`, `Clients.claim` — Safari 11.1 / iOS 11.3; `WindowClient.navigate` — Safari / iOS 16 (wcześniej `NotSupportedError`). Fallback w nowej aplikacji: `dme-release.json` (poza precache, bez cache) przy starcie i po powrocie z tła → przeładowanie przed pokazaniem pytań. Zwykłe aktualizacje aplikacji (ta sama wersja treści) działają jak wyżej (baner na żądanie). Opis i ograniczenia: `docs/MIGRACJA_V15.md` §3.

**Podłączenie w kodzie (wykonane w `src/main.tsx`; kontroler: `src/app/appController.ts`):**

```ts
import { createServiceWorkerPwa, isUpdateSafe } from './pwa/registerSW';

let controller: AppController | null = null;
const pwa = createServiceWorkerPwa({
  confirmUpdateSafe: () => controller !== null && isUpdateSafe(controller.getState()),
});
controller = createAppController({ repository, loadBank, platform, pwa, appVersion });
const justUpdated = pwa.consumeUpdatedFlag(); // → toast 'app_updated'
// pwa.getStatus()/subscribe(): registration, errorCode, offlineReady, needRefresh, preparation {status, done, total (bajty; 0 = nieznany)}, applying
```

`createServiceWorkerPwa` zwraca `PwaPort` (kontrakt z `src/pwa/api.ts`) rozszerzony o `getStatus`, `subscribe`, `consumeUpdatedFlag`, `dispose`. Słuchacze `onNeedRefresh`, `onOfflineReady`, `onPreparationProgress`, `onPreparationError` zarejestrowani później dostają bieżący stan. Brak Service Workera (tryb dev, przeglądarka bez obsługi, `http` poza localhost) → stan `unsupported`, nauka działa online, bez ekranu przygotowania. Start offline (rejestracja odrzucona, bo `sw.js` nie da się pobrać) nie jest błędem, gdy istnieje aktywna rejestracja.

## 9. Aktualizacja pytań (bank)

Od 24.10.2026 aplikacja używa wyłącznie banku V15 (`public/data/bank-37f3980a1129.json` + `retired-question-ids-…json` + `training-profile-…json`; wersja i sumy: `src/domain/contentRelease.ts`). Nowa wersja treści = nowe pliki pod NOWYMI nazwami (prefiks SHA-256), aktualizacja `CONTENT_RELEASE` (wersja, sumy, liczby), nowa migracja IndexedDB, jeśli dane użytkowniczki trzeba dostosować (wzór: `docs/MIGRACJA_V15.md`) → workflow → nowy SW przejmuje strony sam (skrypt przejęcia). Build i `check-dist` odrzucają pliki o innej sumie kontrolnej. Bank do 16 MB mieści się w precache; większy plik przerwie build z komunikatem (wtedy podnieść `PRECACHE_MAX_FILE_BYTES` w `vite.config.ts` i stałą w `scripts/check-dist.mjs`, pamiętając o pamięci telefonu).

## 10. Ograniczenia

- **Trwałość danych nie jest gwarantowana.** Postęp jest tylko w IndexedDB telefonu. `navigator.storage.persist()` to prośba, którą Safari rozpatruje heurystycznie. Dane mogą zniknąć po usunięciu ikony/aplikacji z ekranu głównego, wyczyszczeniu danych witryn w ustawieniach Safari, przy braku miejsca albo zmianie adresu aplikacji. **Jedyne zabezpieczenie: regularny eksport kopii** (Ustawienia → Kopia → „Zapisz kopię”, plik w aplikacji Pliki/iCloud Drive) i import po utracie danych lub zmianie telefonu.
- Dane Safari i aplikacji z ekranu głównego mogą być przechowywane oddzielnie (do potwierdzenia na urządzeniu — G05): uczyć się w jednym miejscu (aplikacja z ekranu głównego), a dane przenosić kopią.
- Pierwsze pobranie wymaga internetu i otwarcia aplikacji do końca przygotowania; offline działa dopiero po nim. Linki „Otwórz publikację” wymagają internetu (opis źródła i lokator są lokalnie).
- WebKit: po przerwanym **pierwszym** przygotowaniu ponowienie pobiera wszystkie pliki od nowa (zmierzone w Playwright WebKit 2359: zachowane 0/18; Chromium dociąga tylko braki), a ekran błędu pokazuje wtedy 0%. Tekst Design „Zapisane części zostaną zachowane; brakujące pobierzemy przy ponownej próbie” jest więc pewny tylko w Chromium — do decyzji UI/Design i weryfikacji na iPhonie. Błąd zapisu kluczy przy ponowieniu (p. 8) jest obchodzony w `src/pwa`.
- Ekran przygotowania (także stan „przerwane”) zastępuje całą aplikację, dopóki przygotowanie się nie zakończy (decyzja UI/kontrolera). Przy braku sieci przy pierwszym uruchomieniu nauka jest więc możliwa dopiero po udanym ponowieniu.
- GitHub Pages buforuje pliki do 10 minut — nowa wersja może pojawić się z opóźnieniem.
- Wszystko w `dist` jest publiczne. Aplikacja nie wysyła danych, nie ma telemetrii ani zewnętrznych żądań w czasie nauki; GitHub loguje adresy IP odwiedzających serwer Pages.
- Testy w Chromium/WebKit na komputerze nie zastępują testu na iPhonie 15 — G05: **NOT RUN** (lista kontrolna w `docs/INSTALACJA_IPHONE.md`).

## 11. Wyniki kontroli (22.10.2026, macOS, Node 24.18.1, stan po integracji)

Build do katalogu tymczasowego (nie do `dist`), z rejestracją SW wywoływaną przez aplikację (`src/main.tsx`).

| Kontrola | Wynik |
|---|---|
| `npm run typecheck` | OK |
| `npx vitest run tests/pwa` | 25/25 PASS (w tym: komplet cache przed `offlineReady`, niekompletna instalacja → wyrejestrowanie i ponowienie, usuwanie wyłącznie pustego cache tej aplikacji, brak sprzątania przy stronie kontrolowanej) |
| `BASE_PATH=/doktor-monika-egzamin/ npx vite build --outDir <tymczasowy>` | build OK, precache 18 wpisów (ok. 1 MB, bank 405 KB — 248 pytań) |
| `check-dist.mjs --base /doktor-monika-egzamin/` | 50 kontroli, 0 FAIL, 0 WARN (rejestracja SW w JS z `/doktor-monika-egzamin/sw.js` i scope `/doktor-monika-egzamin/`) |
| To samo z `APP_BUILD_ID=abc1234` (jak w CI) | 50 kontroli, 0 FAIL; wersja `0.1.0+abc1234` w kodzie |
| Build i `check-dist.mjs` z `base = /` | 49 kontroli, 0 FAIL, 0 WARN |
| `check-offline.mjs` (Chromium 1243, WebKit 2359) | 54 kontrole, 0 FAIL, 2 WARN — oba WebKit, surowe zachowanie silnika bez aplikacji: po przerwanej pierwszej instalacji zachowane 0/18 plików, a surowe ponowienie kończy się 1/18 w cache (p. 8). S24a w aplikacji („Spróbuj ponownie” i ponowne otwarcie): komplet 18/18, strona kontrolowana po przeładowaniu, start bez sieci — PASS w obu przeglądarkach. Przed obejściem ten sam scenariusz w WebKit kończył się błędem startu offline (`FetchEvent.respondWith … Load failed`) |
| Pełny zestaw e2e (`npx playwright test`, WebKit „iPhone 15” + Chromium mobile) na tym buildzie (kopia robocza z buildem jako `dist`, `E2E_SKIP_BUILD=1`) | 39 PASS, 1 SKIP (WebKit + `context.setOffline` — ograniczenie Playwright, zastąpione testem „serwer niedostępny”); w tym PWA: offline po pierwszym pobraniu, odpowiedzi i zapis bez sieci, brak żądań zewnętrznych, aktualizacja bez przeładowania pytania, baner poza pytaniem, sesja zachowana |
| Bank 9,4 MB / 17,4 MB (syntetyczne wypełnienie w kopii roboczej) | 9,4 MB w precache (58,8% limitu), `check-dist` OK; 17,4 MB → build przerwany komunikatem `[PWA] Brak w precache: data/bank.json …` |
| Workflow `pages.yml` | YAML poprawny (parser), logika `BASE_PATH` sprawdzona lokalnie dla: strona projektu, `<właściciel>.github.io`, własna domena (ostrzeżenie + ścieżka Pages), wielkie litery w nazwie. **Nie uruchomiono na GitHubie** (brak repozytorium) |
| Publikacja na GitHub Pages | **wykonano 23.10.2026** — https://lyzwad.github.io/doktor-monika-egzamin/ (run 39954751951; kontrola po wdrożeniu w `docs/RAPORT_KONTROLI.md` §7) |
| Później, etap integracji: `npm run test:e2e` (build pod `/doktor-monika-egzamin/` + 26 scenariuszy × WebKit „iPhone 15” i Chromium mobile, w tym G03 na dwóch rzeczywistych buildach i błąd zapisu w IndexedDB) | 51 PASS, 1 SKIP (WebKit + `context.setOffline`); pełny zestaw ×3 (`--repeat-each=3`): 153 PASS, 3 SKIP; `check-offline.mjs`: 54 kontrole, 0 FAIL, 2 WARN (jak wyżej). Opis pokrycia: `docs/ARCHITEKTURA_APP.md` §7.1 |
| Test na fizycznym iPhonie 15 (G05) | **NOT RUN** |

## 12. Własna domena wiedza.doktormonika.pl (25.10.2026)

1. DNS w Cloudflare (strefa `doktormonika.pl`), wyłącznie jeden rekord: Type `CNAME`, Name `wiedza`, Target `lyzwad.github.io` (bez `https://` i bez nazwy repozytorium), Proxy status **DNS only** (szara chmurka), TTL Auto. Pozostałe rekordy (strona główna, poczta) bez zmian.
2. GitHub → repozytorium → Settings → Pages → Custom domain: `wiedza.doktormonika.pl` (albo `gh api -X PUT repos/lyzwad/doktor-monika-egzamin/pages -f cname=wiedza.doktormonika.pl`). Po wydaniu certyfikatu: **Enforce HTTPS** (`-F https_enforced=true`).
3. Workflow `.github/workflows/pages.yml` buduje z `BASE_PATH=/` i zatrzymuje wdrożenie, gdy `configure-pages` nie zgłasza hosta `wiedza.doktormonika.pl` (zmienna `EXPECTED_HOST`) i pustego `base_path` — usunięcie domeny w ustawieniach nie opublikuje buildu pod `/` na adresie z prefiksem.
4. Dawny adres https://lyzwad.github.io/doktor-monika-egzamin/ odpowiada 301 na nowy. Dane przeglądarki należą do originu: postępy przenosi plik kopii (`docs/PRZENIESIENIE_NA_WIEDZA.md`).
5. Plik `CNAME` w `dist` nie jest potrzebny: przy publikacji przez GitHub Actions domenę przechowują ustawienia Pages.
