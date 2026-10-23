# Doktor Monika Egzamin — instalacja na iPhonie

Stan: 23.10.2026. Aplikacja jest opublikowana pod adresem https://lyzwad.github.io/doktor-monika-egzamin/ (GitHub Pages). Test na fizycznym iPhonie: NOT RUN — wyniki wpisuje użytkowniczka w §6.

## 1. Dodanie do ekranu głównego

1. Otwórz **Safari** na iPhonie i przejdź pod adres aplikacji https://lyzwad.github.io/doktor-monika-egzamin/. Inna przeglądarka nie jest potrzebna.
2. Stuknij **przycisk Menu strony** (tak nazywa go Apple; ikona bez podpisu na pasku Safari), a następnie **Udostępnij**. Jeśli w Safari używasz układu kart „Na dole” lub „Na górze”, stuknij od razu **przycisk udostępniania** (kwadrat ze strzałką w górę).
3. Przewiń listę opcji w dół i stuknij **Do ekranu głównego**. Jeśli tej opcji nie ma: przewiń na dół listy, stuknij **Edytuj czynności** i dodaj **Do ekranu głównego**.
4. Upewnij się, że jest włączone **Otwórz jako aplikację www**, i stuknij **Dodaj**.
5. Na ekranie głównym pojawi się ikona **Doktor Monika Egzamin** (litery „DM” na jasnym tle; iOS może skrócić długą etykietę pod ikoną).

Uwaga dla UI: wskazówka instalacji w projekcie Design (i obecnie w aplikacji, `HomeScreen`) mówi „Udostępnij → Do ekranu początkowego”, a aktualna polska dokumentacja Apple (iOS 26 i 27, sprawdzone ponownie 22.10.2026) używa nazwy **„Do ekranu głównego”**, przełącznika **„Otwórz jako aplikację www”** i (w domyślnym układzie Safari) kroku **przycisk Menu strony → Udostępnij**. Tekst wskazówki do uzgodnienia (właściciel: UI).

## 2. Pierwsze uruchomienie — z internetem

1. Uruchom aplikację **z ikony na ekranie głównym** (nie z karty Safari), przy działającym Wi-Fi lub sieci komórkowej.
2. Poczekaj na koniec ekranu „Przygotowanie materiałów do nauki” — aplikacja zapisuje na telefonie pytania, objaśnienia, schematy, fonty i ikony. Nie zamykaj jej w tym czasie.
3. Jeśli pojawi się „Nie udało się zapisać wszystkich materiałów”, wróć do zasięgu i stuknij **Spróbuj ponownie**.
4. Zamknij aplikację (przesuń w górę w przełączniku aplikacji) i otwórz ją ponownie z ikony — od tego momentu działa bez internetu.

Dane nauki aplikacji z ekranu głównego mogą być przechowywane oddzielnie od danych tej samej strony otwartej w karcie Safari. Ucz się w aplikacji z ikony; do przeniesienia postępu służy kopia (p. 4).

## 3. Test trybu samolotowego

1. Po pierwszym uruchomieniu (p. 2) włącz **tryb samolotowy** (i wyłącz Wi-Fi, jeśli zostało włączone).
2. Uruchom aplikację z ikony: start, Free Flow i Test, odpowiedź, „Dalej”, wyjaśnienie, schemat (powiększenie), historia i ustawienia mają działać.
3. Zamknij aplikację w trakcie testu i otwórz ponownie — „Kontynuuj” wraca do tego samego pytania.
4. „Otwórz publikację” przy źródle wymaga internetu — offline aplikacja pokazuje komunikat, a opis źródła i lokator pozostają widoczne.
5. Wyłącz tryb samolotowy.

## 4. Kopia danych

Postęp jest zapisany tylko na tym telefonie. Może zniknąć po usunięciu ikony aplikacji, wyczyszczeniu danych witryn Safari, przy braku miejsca albo po zmianie adresu aplikacji — prośba o trwałe przechowywanie nie daje gwarancji.

- **Zapis kopii:** Ustawienia → Kopia → **Zapisz kopię** → zapisz plik w aplikacji **Pliki** (np. iCloud Drive). Rób to regularnie, np. raz w tygodniu i przed aktualizacją iOS.
- **Przywrócenie:** Ustawienia → Kopia → **Wybierz plik kopii** → sprawdź podsumowanie → **Zabezpiecz bieżące dane i zastąp**. Bieżące dane są najpierw zachowywane jako kopia bezpieczeństwa.
- Kopia zawiera historię, otwarte sesje, kolejkę błędów, ustawienia i wykluczenia. Nie wysyłaj jej nigdzie publicznie.

## 5. Aktualizacje

Gdy jest nowa wersja, poza ekranem pytania pojawia się baner „Nowa wersja aplikacji jest gotowa” z przyciskiem **Uruchom ponownie**. Aplikacja nie przeładuje się sama w trakcie pytania. Nowa wersja uruchomi się też po zamknięciu i ponownym otwarciu aplikacji. Dane nauki zostają.

## 6. Lista kontroli G05 — fizyczny iPhone 15

Status: **NOT RUN** (brak urządzenia w środowisku wykonawczym). Wypełnić przy teście; test w przeglądarce na komputerze nie zastępuje tej listy.

- Data testu: …………  Model: iPhone 15  Wersja iOS (Ustawienia → Ogólne → To urządzenie): …………
- Adres aplikacji: …………  Wersja aplikacji / banku (Ustawienia → O bazie): …………
- Ustawienie rozmiaru tekstu (Ustawienia → Ekran i jasność → Rozmiar tekstu): …………

| # | Krok | Oczekiwany wynik | Wynik | Uwagi |
|---|---|---|---|---|
| 1 | Safari: otwarcie adresu, pierwszy start | Ekran startowy po polsku, jasny motyw, wskazówka instalacji | NOT RUN | |
| 2 | Do ekranu głównego (p. 1) | Ikona „Doktor Monika Egzamin”, start bez paska Safari (tryb aplikacji) | NOT RUN | |
| 3 | Pierwsze uruchomienie z ikony (p. 2) | Przygotowanie materiałów kończy się; brak błędów | NOT RUN | |
| 4 | Safe area | Treść i przyciski nie wchodzą pod wyspę Dynamic Island ani pasek gestów | NOT RUN | |
| 5 | Klawiatura przy własnym N | Pole N widoczne nad klawiaturą, walidacja, „Rozpocznij test” dostępne | NOT RUN | |
| 6 | Tap odpowiedzi | Pierwszy tap ocenia; drugi tap nic nie zmienia; kolor + ikona + tekst | NOT RUN | |
| 7 | Przewijanie komentarza | Wyjaśnienie przewija się płynnie, „Dalej” nie zasłania treści | NOT RUN | |
| 8 | Powiększenie schematu | Schemat da się powiększyć i zamknąć | NOT RUN | |
| 9 | Podgląd poprzedniego pytania („‹”) | Tylko do odczytu, „Do bieżącego” wraca | NOT RUN | |
| 10 | Wznowienie | Zamknięcie aplikacji w teście → „Kontynuuj” na tym samym pytaniu | NOT RUN | |
| 11 | Pobranie kopii | Plik zapisany w Pliki, da się go otworzyć | NOT RUN | |
| 12 | Wybranie pliku do importu | Systemowy wybór pliku, podsumowanie, zamiana danych | NOT RUN | |
| 13 | Tryb samolotowy (p. 3) | Pełna nauka offline, zapis sesji | NOT RUN | |
| 14 | Aktualizacja (po wdrożeniu nowej wersji) | Baner poza pytaniem; brak przeładowania w trakcie pytania; po „Uruchom ponownie” historia zachowana | NOT RUN | |
| 15 | Przerwane pierwsze przygotowanie (wyłączenie sieci w trakcie p. 2 na świeżej instalacji) | Komunikat z „Spróbuj ponownie” (odnotować pokazany %); po ponowieniu — oraz osobno po zamknięciu i ponownym otwarciu zamiast ponowienia — aplikacja startuje w trybie samolotowym (sprawdza obejście błędu WebKit, `docs/WDROZENIE.md` p. 8) | NOT RUN | |
| 16 | Większy tekst (Dynamic Type) | Tekst rośnie, brak ucinania i poziomego przewijania | NOT RUN | |
| 17 | Dane Safari vs aplikacja | Odnotować, czy postęp z karty Safari jest widoczny w aplikacji z ikony | NOT RUN | |
| 18 | Ustawienia → trwałe przechowywanie | Odnotować pokazany status (przyznane / nie) | NOT RUN | |
