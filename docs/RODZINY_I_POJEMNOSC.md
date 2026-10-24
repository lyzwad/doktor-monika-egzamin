# Rodziny pytań — uzasadnienia zmian i pojemność testu

Rodzina = bliskie warianty jednego zadania (ten sam lub bardzo bliski rozstrzygający warunek albo treść jednego pytania zdradza klucz drugiego). Wspólna choroba, źródło lub łańcuch luźnych podobieństw nie wystarczają.

> **Uwaga (24.10.2026):** sekcje „Przebieg” i „Podziały” dokumentują pracę nad rodzinami banku `release-2026-10-23c`, który usunięto z aplikacji (docs/MIGRACJA_V15.md). Rodziny banku V15 pochodzą z paczki redakcji V15 bez zmian w aplikacji.

## Przebieg

1. Deduplikacja: grupy rodzin z ocen par i list domen; pierwotnie domknięcie przechodnie (union-find) dało zbyt szerokie grupy (np. AK: leczenie pola + krioterapia + PDT) — zastąpione grupowaniem bez łańcuchów.
2. Niezależny przegląd każdej z 226 rodzin wielopozycyjnych (3 recenzentów AI, 2026-10-23): podział rodzin opartych na wspólnym temacie zamiast jednego rozstrzygnięcia.
3. Zastosowano 72 podziałów (198 pytań z nową rodziną; 10 cofniętych scaleń rodzin seed w runtime).
4. Pary z przeciekiem klucza pozostawione w jednej rodzinie (wbrew podziałowi recenzenta), aby nie trafiły do jednego testu: części 3 — R158, R165, R197, R209, R221; pary: DEV-G30-003+DEV-P30-006; SAFE-G18-003+SAFE-P18-019; SKIN-G13-001+SKIN-P13-006; SAFE-P16-003+SAFE-Q008; SAFE-G16-004+SAFE-Q008.

## Pojemność testu — bank V15 (liczba różnych rodzin po filtrach, bez blokad użytkowniczki)

Bank `chatgpt-editorial-v15-2026-10-24-f020a0440df8` (2987 pytań, 2501 rodzin; policzone z `public/data/bank-37f3980a1129.json`, 24.10.2026). Dla całego zakresu kwoty dzieli profil treningowy (DECYZJE §6a); pojemność to nadal liczba rodzin.

| zakres | mieszany | łatwy | średni | trudny |
|---|---|---|---|---|
| ALL | 2501 | 981 | 1221 | 519 |
| ANAT | 449 | 213 | 186 | 85 |
| INJ | 256 | 129 | 103 | 45 |
| SKIN | 529 | 176 | 277 | 117 |
| THER | 234 | 108 | 108 | 46 |
| DEV | 790 | 251 | 442 | 159 |
| SAFE | 263 | 109 | 110 | 68 |

Blokady (zgłoszenia) zmniejszają pojemność w aplikacji dynamicznie — maksimum N liczone jest w chwili konfiguracji testu.

## Podziały (rodzina → grupy; uzasadnienie recenzenta)

- **FAMILY-HA-INFECTED-NODULE-01** → [INJ-Q037, SAFE-Q019, INJ-P06-027, SAFE-P17-011] / [INJ-P06-025, SAFE-P16-013, SAFE-P16-017] / [INJ-Q038] / [INJ-P06-028] / [SAFE-G16-010] / [SAFE-P14-021] — Rodzina łączy cały temat późnego guzka po HA. Rdzeń: bolesny guzek → ocena zakażenia przed sterydem/immunosupresją; osobno: szeroka diagnostyka różnicowa (wygląd/czas nie rozstrzygają); USG a biofilm, leczenie ropnia, karta zaleceń i zalecenia wczesne po iniekcji to odrębne rozstrzygnięcia.
- **INJ-Q025** → [INJ-Q025, INJ-G05-001, INJ-G06-006, INJ-G16-007] / [INJ-G05-002] / [SAFE-Q005] — Wspólne rozstrzygnięcie: nieudokumentowany wcześniejszy wypełniacz traktować jako niepotwierdzony i nie zakładać jego tożsamości ani rozpuszczalności. Ograniczenia ujemnego USG oraz hialuronidaza wobec znanego hybrydu HA/CaHA to inne warunki.
- **INJ-Q026** → [INJ-Q026, ANAT-P01-021] / [INJ-Q041, ANAT-P01-020, ANAT-G01-004] / [INJ-P05-027] — Kaniula nie znosi ryzyka (Q026, P01-021) to inny warunek niż ujemna aspiracja/Doppler przed iniekcją, które nie wykluczają naczynia; brak strefy zerowego ryzyka (regiony) jest osobnym zagadnieniem.
- **SAFE-Q003** → [SAFE-Q003, SAFE-G15-008, SAFE-P15-011, SAFE-P15-013] / [SAFE-Q015] / [SAFE-P15-012] — Rdzeń: nagłe zaburzenie widzenia przy iniekcji → przerwać i pilna ścieżka okulistyczna. Chlorheksydyna w oku (płukanie) oraz dokumentacja czasu i objawów neurologicznych to odrębne rozstrzygnięcia.
- **ANAT-G02-005** → [ANAT-G02-005, ANAT-G03-006, ANAT-P02-007] / [ANAT-G02-006, ANAT-P02-003] / [ANAT-G01-006] — Połączenia gałęzi nadoczodołowych/nadbloczkowych z krążeniem ocznym (czoło, gładzizna) i ryzyko oczne w nosie (t. grzbietowa nosa) to dwa różne warunki; zakres mapowania nerwu podoczodołowego w USG nie dotyczy ryzyka naczyniowego.
- **INJ-Q001** → [INJ-Q001, INJ-P04-001, INJ-P05-002] / [INJ-Q003, SKIN-P11-031] — Dobór klasy iniekcji do problemu dynamicznego vs objętościowego (Q001, P04-001, P05-002) to inny sprawdzian niż mechanizm molekularny BoNT-A (SNAP-25/ACh, także w nadpotliwości).
- **SKIN-Q025** → [SKIN-Q025, SKIN-P12-028, SKIN-P12-031] / [SKIN-Q026] / [SKIN-P12-029] — Preferencja pełnościennego wycięcia i jej uzasadnienie (Breslow, ryzyko zaniżenia przy ścięciu) to jedno rozstrzygnięcie; wyjątek dla dużej zmiany (biopsja częściowa) i diagnostyczny charakter wycięcia to odrębne warunki.
- **THER-Q003** → [THER-Q003, THER-Q004, THER-G07-003] / [THER-P07-013, THER-P07-014] — rpm/RCF i miejsce odniesienia RCF (geometria wirnika) to jedno rozstrzygnięcie; to, że inne elementy protokołu (probówka, kąt, pobrana frakcja) zmieniają materiał, to drugie.
- **THER-Q008** → [THER-Q008, THER-G09-005] / [THER-G07-011, THER-P07-016, THER-P10-025] — Przypisanie efektu PRP wymaga komparatora (Q008, G09-005); określenie punktu końcowego i dokumentacji wyjściowej przed serią to inne rozstrzygnięcie.
- **THER-Q011** → [THER-Q011, THER-P07-026, THER-G07-010] / [THER-P07-024, THER-P07-025] — Wyniki RCT PN vs HA nie dowodzą przewagi PN/kategorii to jedno rozstrzygnięcie; układ z aktywnym komparatorem (split-face) i jego ograniczenie wobec samych wkłuć to drugie.
- **DEV-Q018** → [DEV-Q018] / [DEV-G25-001] / [DEV-G29-003, DEV-P29-003] / [DEV-G29-002] — Siła zaleceń AAD dla kriochirurgii/PDT i dla leków miejscowych to różne fakty; nadwrażliwość na zimno w kwalifikacji do krioterapii to osobna rodzina; zmiana metody na elektrochirurgię wymaga innej kwalifikacji.
- **DEV-Q021** → [DEV-Q021, DEV-G26-002] / [DEV-P26-005, DEV-P26-008, DEV-P26-011] — Geometria elektrody i strefa grzania (Q021, G26-002) to inny warunek niż profil ryzyka MNRF (oparzenia, blizny, utrata tłuszczu), którego nie usuwa izolacja ani feedback.
- **INJ-P06-008** → [INJ-P06-008, INJ-P06-007, INJ-P06-003] / [INJ-G06-009] / [INJ-P06-033] — Przygotowanie wyłącznie wg aktualnej instrukcji konkretnego produktu (bez przenoszenia schematów między PLLA/PDLLA/biostymulatorami) to rdzeń; dokumentacja rekonstytucji i ogólny zakres dokumentacji wypełniacza to inne klucze.
- **SKIN-P24-028** → [SKIN-P24-028, SKIN-G24-001, SKIN-P24-027] / [DEV-G24-002] / [SKIN-G24-003] — Zalecenia przeglądu dla izotretynoiny (pełna ablacja/ablacyjna RF nie, brak rutynowego odraczania) to jedno rozstrzygnięcie; ustalenie, czy 'frakcja' jest ablacyjna, oraz ocena aktywnej choroby i gojenia to odrębne warunki.
- **DEV-P30-006** → [DEV-P30-006, DEV-G30-003, THER-P10-007] / [INJ-P05-006, INJ-P06-022] — Obca decyzja regulacyjna nie ustala statusu w Polsce (G30-003, P10-007) różni się od daty wersji komunikatu Health Canada oraz od granic danych/etykiety CaHA dla ust i powiek. Uwaga: rdzeń G30-003 podaje klucz P30-006.
- **ANAT-Q015** → [ANAT-Q015, ANAT-G02-003] / [ANAT-Q040] / [ANAT-P02-021] — Głęboka tętnica skroniowa przy kości (kontakt z kością/brak przepływu nie wyklucza) to rdzeń; płytka płaszczyzna również nieuniwersalna i ogólna fizyka częstotliwości głowicy to inne rozstrzygnięcia.
- **SKIN-Q015** → [SKIN-Q015, SKIN-P12-007, SKIN-P23-019] / [SKIN-G23-008] — Rozdzielenie komponentu naczyniowego i zapalnego w rosacea to jedno rozstrzygnięcie; rozróżnienie w obrębie naczyniowego (teleangiektazje vs flushing) to inne.
- **THER-Q001** → [THER-Q001, THER-P07-009] / [THER-G07-007, THER-P07-010] — Całkowita liczba podanych płytek (stężenie × objętość) i wydajność odzysku płytek to dwa różne parametry/obliczenia.
- **THER-Q002** → [THER-Q002, THER-P07-011] / [THER-G07-001] / [THER-P07-008] — Elementy klasyfikacji DEPA (i czego ona nie ustala) to rdzeń; niewypełnianie brakujących danych wartościami z materiałów handlowych oraz zakres dokumentacji zabiegu PRP to odrębne warunki.
- **THER-Q035** → [THER-Q035, THER-P10-018] / [SAFE-P07-002, SAFE-P17-007] — Autologiczny tłuszcz nie wyklucza powikłań (zator, martwica) to inne rozstrzygnięcie niż bezpieczeństwo procesu PRP i identyfikacja próbek przy kilku pacjentach.
- **DEV-Q003** → [DEV-Q003, DEV-G21-003] / [DEV-Q044] / [DEV-P23-015] — Zalecenie długiej fali + długiego impulsu + chłodzenia w ciemnej skórze (Q003, G21-003) to rdzeń; ogólna różnica Q-switch vs długi impuls i to, że wyposażenie nie zastępuje kwalifikacji, to odrębne sprawdziany. G21-003 częściowo pokrywa też Q044.
- **DEV-Q017** → [DEV-Q017, DEV-P25-026] / [DEV-Q029, DEV-G28-004] — Skala leczenia AK (pole vs pojedyncza zmiana) i różnica PDT vs samo czerwone światło to dwa różne rozstrzygnięcia (wzorcowy przykład zbyt szerokiej rodziny).
- **INJ-P06-006** → [INJ-P06-006, INJ-G04-002, INJ-P06-005] / [INJ-G06-002] — Pewność dowodów przeglądu PLLA 2024 (niższa dla jakości skóry, przewaga badań nierandomizowanych) to rdzeń; nieprzenoszenie wyników na każdą formulację, rekonstytucję i okolicę to inny warunek.
- **SAFE-P12-035** → [SAFE-P12-035, SAFE-P24-012, SAFE-P31-001] / [SAFE-G12-008] — Rozróżnianie kategorii ograniczeń (formalne przeciwwskazanie, ostrożność, brak danych) to rdzeń; indywidualna ocena aktywności choroby autoimmunologicznej to inny warunek.
- **DEV-P24-018** → [DEV-P24-018, SAFE-P18-020] / [SAFE-P18-019, SAFE-G18-003] — RR jako miara względna, nie ryzyko bezwzględne (P24-018, P18-020) to rdzeń; obliczenie RR i RD oraz niedopuszczalność RR przy różnych okresach obserwacji to inne sprawdziany. Uwaga: rdzeń G18-003 podaje RR=5 z P18-019.
- **DEV-P20-014** → [DEV-P20-014, DEV-G20-005, DEV-P21-012] / [DEV-P31-010] — IPL jako szerokie widmo kształtowane filtrem (nie jedna fala) to rdzeń; dobór okularów do każdego lasera osobno to inny warunek.
- **DEV-P23-004** → [DEV-P23-004] / [DEV-P20-023, DEV-P23-011] / [DEV-G23-003] — Nowe odbarwienia → wstrzymać serię to inne rozstrzygnięcie niż nietrwałość wczesnego efektu 1927 nm w melasmie; brak bezpieczeństwa i podstaw do bezterminowego toningu to trzecie.
- **DEV-P26-017** → [DEV-P26-017, DEV-P26-019, DEV-P27-012] / [DEV-G26-003] — Kwalifikacja szczupłej pacjentki z deficytem objętości do MNRF (ryzyko utraty tłuszczu, dobór metody do problemu) to rdzeń; ocena nowego zagłębienia jako powikłania przed kolejną sesją to inne rozstrzygnięcie.
- **SKIN-P11-029** → [SKIN-P11-029, SKIN-P14-002] / [SKIN-P11-030, SKIN-P14-016] — Głębokość urazu wyznacza gojenie i ryzyko (P11-029, P14-002) to inny warunek niż cel kontroli pozabiegowej (bariera, zakażenie, zaburzone gojenie).
- **DEV-P19-005** → [DEV-P19-005, DEV-P28-001, DEV-P28-011] / [DEV-P28-004] — Przeniesienie wyniku badania LED wymaga zgodności parametrów ekspozycji to rdzeń; moc elektryczna ≠ natężenie napromienienia to osobne zagadnienie fizyczne.
- **DEV-P20-007** → [DEV-P20-007] / [DEV-P20-013, DEV-P21-003, DEV-P21-011] — 'Pico' ≠ brak efektów termicznych to inne rozstrzygnięcie niż znaczenie nazw Q-switch/pico jako reżimu impulsu bez informacji o fali i zastosowaniu.
- **ANAT-Q023** → [ANAT-Q023, ANAT-G03-003] / [ANAT-G03-001] — Mechanizm limfatyczno-żylny obrzęku jarzmowego to rdzeń; lokalizacja okolicy wrażliwego odpływu między więzadłami to odrębny fakt anatomiczny.
- **ANAT-Q030** → [ANAT-Q030, ANAT-Q033] / [ANAT-P03-018] — Znaczenie otworu bródkowego i nerw bródkowy dla czucia wargi dolnej/bródki to jedno rozstrzygnięcie; kontakt z kością nie oznacza ominięcia pęczka to inny warunek.
- **INJ-Q027** → [INJ-Q027] / [INJ-G05-007, INJ-P05-029] — Obrzęk z wcześniejszym depozytem (HA może nasilić retencję) to inny warunek niż rozróżnienie przyczyn cienia (pigment, przepuklina vs ubytek podpory).
- **INJ-Q035** → [INJ-Q035] / [INJ-G06-007, INJ-P06-002] — Ograniczenie wyniku RCT do badanych produktów/okolicy to inne rozstrzygnięcie niż to, że skuteczność/mała liczba SAE nie dowodzi bezpieczeństwa w rzadkich zdarzeniach.
- **INJ-Q040** → [INJ-Q040] / [SAFE-Q011, SAFE-G16-005] — Sumowanie ekspozycji na anestetyk (zasada profilaktyczna) to inny warunek niż rozpoznanie i opisanie LAST przy drgawkach i arytmii.
- **INJ-Q042** → [INJ-Q042, INJ-G06-011] / [INJ-P06-035] — Efekt Tyndalla odrębny od nadkorekcji (Q042, G06-011) to inne rozstrzygnięcie niż niebieskawe zabarwienie z bólem i zaburzeniem perfuzji (niedokrwienie).
- **SKIN-Q010** → [SKIN-Q010] / [SKIN-G11-002, SKIN-P12-010] — Aktualna pigmentacja/opalenizna obok fototypu to inny warunek niż PIH występujące w każdym fototypie.
- **SKIN-Q030** → [SKIN-Q030, SKIN-P31-028] / [SKIN-G31-005] — Narastające objawy zakażenia/powikłania po zabiegu → pilna ocena to rdzeń; opóźniona epitelializacja bez objawów zakażenia wymagająca wcześniejszej oceny to inny warunek.
- **THER-Q016** → [THER-Q016, THER-P08-003] / [THER-G08-005] — Ocena konkretnego składnika (tożsamość, formulacja, droga, dowody) przed dodaniem do koktajlu to rdzeń; kwalifikacja pacjenta pod kątem przeciwwskazań i interakcji leku to inne rozstrzygnięcie.
- **THER-Q019** → [THER-Q019, THER-P08-012] / [THER-P08-014] — Brak uogólnienia RCT jednego produktu kolagenowego to rdzeń; konstrukcja ramienia kontrolnego z wkłuciami to inny sprawdzian (częściowo podpowiadany kluczem Q019).
- **THER-Q025** → [THER-Q025] / [THER-P09-015, THER-P09-027] — Rozpoznanie powikłania ślinianki po niciach to inne rozstrzygnięcie niż to, że kontrola USG zmniejsza, ale nie eliminuje ryzyka.
- **THER-Q037** → [THER-Q037, THER-G10-001] / [THER-P10-001] — Detergentowy, nieselektywny mechanizm deoksycholanu to rdzeń; to, że mechanizm przedkliniczny nie dowodzi skuteczności i bezpiecznego schematu, to inne rozstrzygnięcie.
- **THER-Q041** → [THER-Q041, THER-P09-025] / [THER-G09-008] — Hialuronidaza nie jest antidotum przy zatorze materiałem innym niż HA (tłuszcz, sklerozant) to rdzeń; poziom dowodów konsensusu nie uzasadnia zwłoki to inny warunek.
- **DEV-Q006** → [DEV-Q006] / [DEV-P20-022, DEV-P21-018] — Wpływ średnicy plamki na straty rozproszeniowe to inny fakt niż to, że sama długość fali nie wyznacza ośrodka ani głębokości działania.
- **DEV-Q030** → [DEV-Q030, DEV-G25-003] / [DEV-P28-018] — Porfiria jako przeciwwskazanie Ameluz (i wybór innej metody pola) to rdzeń; dermatoza nasilana światłem przy wykluczonej porfirii to inny warunek.
- **DEV-Q038** → [DEV-Q038] / [DEV-G30-004] / [DEV-P30-011] — Przeciwwskazanie zimnozależne, dodatkowa ocena przy nowej okolicy/urządzeniu i informowanie o późnym PAH to trzy różne rozstrzygnięcia.
- **DEV-Q049** → [DEV-Q049, DEV-P25-022] / [DEV-P25-023] — Excimer 308 nm służy repigmentacji w bielactwie (nie melasmie) to rdzeń; nieprzenoszenie dokładnych dawek z heterogenicznej metaanalizy to inny warunek.
- **THER-P09-006** → [THER-P09-006, INJ-P06-016] / [THER-G09-002] — Oszacowanie zbiorcze nie jest indywidualną prognozą (P09-006, P06-016) to rdzeń; ocena pewności danych przy heterogeniczności to inny sprawdzian.
- **DEV-P22-013** → [DEV-P22-013] / [DEV-G22-002, DEV-P19-022] — P22-013 sprawdza, że modelowa fluencja nie prognozuje głębokości/bezpieczeństwa; G22-002 i P19-022 sprawdzają to samo: energia padająca/osłabienie wiązki ≠ energia pochłonięta przez cel.
- **DEV-P28-007** → [DEV-P28-007, DEV-G28-002] / [DEV-P28-008] — Klucz G28-002 (zróżnicowanie protokołów, brak uogólnienia poza zbadane urządzenia) eliminuje dystraktory P28-007; P28-008 sprawdza odrębny warunek — ograniczoną reprezentację fototypów.
- **THER-P07-005** → [THER-P07-005, THER-P07-006] / [THER-P07-003] — Trzon P07-006 podaje wprost klucz P07-005 (dowody niewystarczające do mocnego wniosku); P07-003 sprawdza inny warunek — nakładanie się przeglądów (13 przeglądów = 28 badań).
- **ANAT-Q026** → [ANAT-Q026] / [ANAT-P03-011] — Q026 dotyczy rozbieżności między własną serią a syntezą i sposobu ich nauczania; P03-011 — ograniczeń samej syntezy (mało prac, heterogeniczność). Wspólne jest tylko źródło i słowo „heterogeniczność”.
- **INJ-Q012** → [INJ-Q012] / [INJ-P04-017] — Q012: krople na mięsień Müllera nie leczą opadania brwi (zły mechanizm); P04-017: odpowiedź powieki na krople nie zastępuje rozpoznania. Ten sam lek, inne rozstrzygnięcia.
- **SKIN-Q039** → [SKIN-Q039] / [SKIN-P14-012] — Q039: brak wywiadu nie wyklucza reaktywacji HSV; P14-012: który element wywiadu (nawroty, wcześniejsza reaktywacja) wpływa na profilaktykę. Wspólny temat, odrębne rozstrzygnięcia; klucz jednego nie podpowiada drugiego.
- **THER-Q029** → [THER-Q029] / [THER-P09-022] — Dwa różne przeciwwskazania bezwzględne do skleroterapii (ostra VTE vs nadwrażliwość na sklerozant); znajomość jednego nie podpowiada drugiego.
- **SAFE-Q025** → [SAFE-Q025] / [SAFE-P17-018] — Q025 dotyczy sprzeciwu małoletniego mimo zgody rodzica; P17-018 braku zgody przedstawiciela i braku wyjątku ratunkowego — różne warunki.
- **SAFE-Q030** → [SAFE-Q030] / [SAFE-G17-004] — Q030 sprawdza zasadę off-label (uzasadnienie + zgoda, popularność ≠ rejestracja); G17-004 ocenę adekwatności dowodu — różne rozstrzygnięcia.
- **ANAT-P03-014** → [ANAT-P03-014] / [ANAT-G03-009] — P03-014: modiolus — wiele mięśni wpływa na kącik; G03-009: rozdzielenie map mięśni, nerwów i zmian po porażeniu VII — różne warunki.
- **INJ-P06-012** → [INJ-P06-012] / [INJ-G06-003] — G06-003 pyta o PICO przy przenoszeniu wyniku RCT; P06-012 o brak wspólnej miary w syntezie jakościowej — różne rozstrzygnięcia.
- **THER-P08-008** → [THER-P08-008] / [THER-G08-002] — To samo badanie, ale G08-002 sprawdza niską pewność/zawężenie do mieszaniny, a P08-008 treść wyniku (brak zmian zmarszczek).
- **THER-P09-001** → [THER-P09-001] / [THER-G09-001] — G09-001: płaszczyzna umieszczenia zmienia efekt; P09-001: geometria/zaczepy przy tym samym polimerze — różne czynniki rozstrzygające.
- **SKIN-P13-020** → [SKIN-P13-020] / [SKIN-G13-007] — G13-007: przewaga połączenia nie ustala efektu samego 5-FU; P13-020: brak jednego schematu dla każdej blizny — różne błędy wnioskowania.
- **DEV-P22-009** → [DEV-G22-007] / [DEV-P22-010] — G22-007: równa dawka przy innym natężeniu i czasie ≠ zgodność protokołu; P22-010: potrzeba potwierdzenia wartości uśrednionej — różne warunki.
- **SKIN-P23-020** → [SKIN-P23-020] / [SKIN-G23-009] — G23-009: laser 577 nm nie jest PDL; P23-020: niska pewność, brak jednego zwycięzcy — ta sama metaanaliza, inne rozstrzygnięcia.
- **DEV-P24-006** → [DEV-P24-006] / [DEV-G28-003] — G28-003: zamiana źródła światła wymaga sprawdzenia dokumentacji produktu; P24-006: jakie dane odróżniają PDT od samego LED — różne rozstrzygnięcia.
- **DEV-P30-014** → [DEV-P30-014] / [DEV-G30-002] — G30-002: badanie bólu zabiegowego nie dowodzi skuteczności; P30-014: liczba publikacji ≠ liczba dobrych RCT — różne błędy.
- **DEV-P30-018** → [DEV-P30-018] / [DEV-G30-008] — G30-008: cellulit i miejscowy nadmiar tłuszczu to inne wskazania; P30-018: mała populacja RCT → niska pewność trwałości.
- **DEV-P10-028** → [DEV-P10-028] / [DEV-G31-004] — G31-004: brak RCT nie dowodzi bezpieczeństwa pominięcia osłony; P10-028: zaciśnięte powieki nie zastępują osłony — różne warunki.
- **SAFE-P18-014** → [SAFE-P18-014] / [THER-P07-004] — P07-004: co ocenia AMSTAR 2 (metodologię przeglądów); P18-014: popularność i liczba przeglądów ≠ jakość — ten sam wynik, inne rozstrzygnięcia.
- **THER-P10-019** → [THER-P10-019] / [THER-P10-020] — P10-019: określenie celu przed lipotransferem; P10-020: ocena wyniku względem stanu wyjściowego, nie dnia zabiegu — różne warunki.
- **DEV-P19-025** → [DEV-P19-025] / [DEV-P21-019] — P21-019: obliczenie zmiany fluencji z plamką; P19-025: średnia fluencja nie przekłada się proporcjonalnie na efekt w tkance rozpraszającej.
