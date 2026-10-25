# Profile lokalne

Stan: 25.10.2026. Adres: https://wiedza.doktormonika.pl/. Decyzja: `docs/DECYZJE_ARCHITEKTURY.md` §16.

## Dla użytkowniczek

**Wybór profilu.** Przy pierwszym otwarciu aplikacja pokazuje ekran „Wybierz profil” z 9 adresami:
recepcja@, monika@, iza@, andrea@, mariola@, magda@, angelika@, ola@ i marta@doktormonika.pl. Wystarczy dotknąć swojego adresu.
Nie ma hasła ani rejestracji, a aplikacja nie wysyła żadnych wiadomości. Profil oddziela tylko dane osób, które uczą się na tym samym urządzeniu. Nie jest logowaniem i nie potwierdza, że adres należy do tej osoby.

**Aktywny profil i zmiana.** Adres aktywnego profilu widać na ekranie startowym pod nazwą aplikacji. Obok jest przycisk **Zmień profil**, który jest też w Ustawieniach (sekcja „Profil”). Aplikacja pamięta ostatni profil po zamknięciu i ponownym otwarciu. Zmiana profilu niczego nie usuwa i nie kończy rozpoczętych sesji. Po powrocie do profilu wszystko jest tak, jak było.

**Co jest osobne dla każdego profilu:** historia testów, wyniki i wykres, rozpoczęte sesje Test i Free Flow, błędy, rundy powtórkowe i stan powtórek, zgłoszone i wykluczone pytania oraz ustawienia nauki. Wspólne są bank pytań V15, źródła, schematy i sama aplikacja.

**Dotychczasowa historia.** Jeśli na urządzeniu są wyniki sprzed wprowadzenia profili, ekran wyboru pokazuje ramkę „Na tym urządzeniu jest historia bez profilu” z liczbą testów i datą.

1. Dotknij **swojego** adresu.
2. Aplikacja zapyta: „Przypisać dotychczasową historię?”.
   - **Przypisz do tego profilu** dołącza historię do profilu jednorazowo. Trafiają do niego wyniki, wykres, błędy do powtórki, wykluczenia i rozpoczęte sesje z bankiem V15. Jeśli profil miał już własne wyniki, zostają, a ich kopia bezpieczeństwa trafia do „Kopii danych”.
   - **Nie teraz** zostawia historię bez profilu i niczego nie usuwa. Przypisać ją można później w **Ustawienia → Profil → Przypisz do tego profilu**.
3. Historii nie przypisuje się automatycznie nikomu, także Monice ani pierwszej osobie z listy. Przypisać ją można tylko raz, do jednego profilu.

**Kopia danych.** **Zapisz kopię** zapisuje tylko aktywny profil, a plik zawiera jego adres. Przy **Wczytaj kopię** widać profil z pliku i profil docelowy. Starsza kopia bez adresu wymaga wskazania profilu. Wczytanie zastępuje dane wyłącznie wskazanego profilu, a pozostałe profile się nie zmieniają.

## Technicznie

- Dane nauki każdego profilu leżą w osobnej bazie IndexedDB `doktor-monika-egzamin:profil:<mail>`. Rekord `meta.owner` zapisuje się przy pierwszym otwarciu. Każda transakcja zapisu sprawdza właściciela w tej samej transakcji, więc opóźniony zapis, zapis z innej karty albo z repozytorium innego profilu jest odrzucany (`OwnerMismatch`) i nie trafia do cudzych danych.
- Rejestr profili (`doktor-monika-egzamin:profile`) przechowuje ostatni profil i stan historii bez profilu: `none`, `unassigned`, `assigning` albo `assigned`. Zmiana `unassigned → assigning` jest warunkowa, więc dwie karty nie przypiszą tej samej historii dwóm osobom. Profil karty jest w sessionStorage, dlatego odświeżenie karty zostaje przy jej profilu.
- Zmiana profilu czeka na zakończenie zapisów z kolejki bieżącego profilu (`whenIdle`), dopiero potem zamyka jego bazę.
- Przypisanie historii dzieje się w jednej transakcji w bazie profilu:
  - zapisuje kopię bezpieczeństwa (`before_assign`), jeśli profil ma dane;
  - dodaje sumę sesji, prób, zdarzeń i blokad (rekordy już obecne zostają);
  - dla pytań obecnych w obu źródłach statystyki są odtwarzane z połączonego dziennika prób (`recomputeStat`);
  - zapisuje rekord `merge:unassigned`.

  Ponowienie po przerwaniu (rejestr `assigning`) niczego nie duplikuje. Baza sprzed profili `doktor-monika-egzamin` zostaje nietknięta jako zabezpieczenie. Migracja V15 (schemat 2) działa dla niej tak jak wcześniej.
- Schemat IndexedDB jest w wersji 3, bez zmian danych. Kod sprzed profili nie otworzy takiej bazy, a jego otwarte połączenie zostaje zamknięte. Skrypt przejęcia Service Workera ma epokę danych `profile-1` (`dme-sw-takeover-<sha12>-profile-1.js`), więc po wdrożeniu otwarte karty i aplikacja z ikony przeładowują się jednorazowo na nową wersję.
- Kopia ma format 2 i pole `profileEmail` (adres z listy, znormalizowany przez `trim().toLowerCase()`). Format 1 nadal się wczytuje, z wyborem profilu docelowego. Zasady V15 przy imporcie są bez zmian.
- Nie ma backendu, logowania, Supabase ani synchronizacji. Wszystko działa offline po pełnym pobraniu aplikacji.

Testy: `tests/app/profile.test.ts`, `tests/persistence/profile.test.ts`, `tests/ui/ProfileScreens.test.tsx` oraz e2e `tests/e2e/profile.spec.ts`. Ten ostatni obejmuje aktualizację z wersji bez profili (`b50eb19`), profile A/B, dwie karty i działanie offline.
