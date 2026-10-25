# Przeniesienie postępów na https://wiedza.doktormonika.pl

Stan: 25.10.2026 — przełączenie wykonane (dawny adres przekierowuje na nowy). Aplikacja przeszła z adresu https://lyzwad.github.io/doktor-monika-egzamin/ na https://wiedza.doktormonika.pl/ (ten sam hosting GitHub Pages, ta sama aplikacja z bankiem V15, bez logowania i bez serwera).

## Dlaczego trzeba zapisać kopię

Historia, wyniki i ustawienia są zapisane w przeglądarce (IndexedDB) i należą do adresu, pod którym aplikacja była otwierana. Nowy adres startuje **pusty** — nie odziedziczy danych automatycznie. Po ustawieniu własnej domeny GitHub przekierowuje stary adres na nowy, więc stara aplikacja może przestać się otwierać (zostaje najwyżej wersja z pamięci podręcznej, na której nie należy polegać). **Kopię trzeba zapisać przed zmianą domeny**, na każdym urządzeniu, na którym ktoś się uczył.

## Krok 1 — na starym adresie (przed zmianą domeny)

1. Otwórz aplikację tak jak zwykle (ikona na ekranie głównym albo https://lyzwad.github.io/doktor-monika-egzamin/), przy włączonym internecie. Jeśli pojawi się „Aktualizacja banku pytań…”, poczekaj, aż aplikacja się przeładuje.
2. Na dole: **Ustawienia** → **Kopia danych** → **Zapisz kopię**.
3. iPhone: w oknie pobierania wybierz zapis; plik `dme-kopia-RRRR-MM-DD.json` trafia do aplikacji **Pliki** → **Pobrane** (w aplikacji z ikony może pojawić się podgląd — wtedy **Udostępnij** → **Zachowaj w Plikach**). Komputer: plik trafia do folderu Pobrane.
4. Sprawdź w aplikacji Pliki, że plik istnieje. Nie usuwaj jeszcze starej ikony.

## Krok 2 — na nowym adresie (po uruchomieniu domeny)

1. W Safari otwórz https://wiedza.doktormonika.pl/ i poczekaj na ekran startowy.
2. **Ustawienia** → **Kopia danych** → **Wybierz plik kopii** → wskaż plik z kroku 1 (Pliki → Pobrane).
3. Po komunikacie „plik poprawny” wybierz **Zabezpiecz bieżące dane i zastąp**, potem **Gotowe**.
4. Sprawdź **Historię** (lista testów i wykres).
5. iPhone: **Udostępnij** → **Do ekranu głównego** (nowa ikona). Starą ikonę usuń dopiero, gdy historia na nowym adresie się zgadza.

## Co przenosi kopia (zasady V15)

- Wyniki i podsumowania historyczne (liczba pytań, wynik, daty, tryb) — bez zmian liczb.
- Stara treść pytań nie jest przenoszona: wczytanie usuwa z kopii treść sprzed V15; sesje niedokończone sprzed V15 stają się „przerwane aktualizacją” i nie da się ich wznowić; stan powtórek zostaje tylko dla 332 pytań identycznych w V15 (`docs/MIGRACJA_V15.md`).
- Kopia zapisana w wersji z V15 wczytuje się bez zmian (wraz z rundą błędów zakończonych testów V15).

Test automatyczny tej ścieżki (dwa różne originy, czysty profil): `tests/e2e/przenosiny-domeny.spec.ts`. Nie zastępuje próby na fizycznym iPhonie.
