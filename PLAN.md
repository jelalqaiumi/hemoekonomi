# Plan: Del 9. Temat följer färgerna i del 8:s nya logga, och grönt tas bort helt ur temat

Användarens ord (2026-10-14): "ja, ta bort grönt och följ loggans färger".

Det här är ett temabyte. Inga nya funktioner, ingen ny text mot användaren
utöver det som färgbytet kräver och inga nya beroenden.

**Underlag som projektledaren har fått (räknat med
`grep -oiE "#[0-9a-f]{6}" <fil> | sort | uniq -c`, ska köras om av arkitekten):**

- `src/web/bilder/hem-ekonomi-logga.svg`: `#4a5875` ×21 (gråblå), `#0b2c63` ×12
  (mörkblå), `#ffffff` ×2, `#e3a21a` ×1 (guld).
- `src/web/bilder/hem-ekonomi-logga-vit.svg`: `#d6deec` ×21, `#ffffff` ×12,
  `#0b2c63` ×2, `#e3a21a` ×1.
- Dagens `src/web/tema.css` har tio "loggans toner" som mättes ur den png-logga
  som togs bort i del 8 (tre gröna, fyra blå och tre guld), plus de valda tonerna
  `--positiv` (`#1e9e5a`, grön, för inkomster), `--negativ` och `--fel-text`.
- Grönt används i dag på fler ställen än i tokenerna `--gron-*`: `--ikon-gron`,
  `--ikon-gron-pa-mork`, `--ikon-gron-ljus-pa-mork`, `--positiv` (ljust och
  mörkt läge) och `--yta-mjuk` (`#edf3ec`, den "svaga gröna tonen" i varannan
  sektion). Tokenerna läses av `landning.css`, `style.css` (där bland annat
  staplarna för nådda mål och `.left-positive` använder dem),
  `demo/banner.css` och klassnamnen `sv-fyll-gron`, `sv-linje-gron` och
  liknande i `landning.html`.

## Lärdomar som gäller här

- **2026-10-14 (kaskadspärren och kommentarborttagningen), 2026-10-13 (`url()`
  med en stavning), 2026-09-12 (markörer förankrade i typografi):** en spärr som
  bara känner igen de stavningar den skrevs för släpper igenom resten. Kravet
  "inget grönt" ska därför kontrolleras på **färgens nyans** för varje färgvärde
  i `tema.css`, i båda lägena. En lista över förbjudna tokennamn räcker inte.
  Mutationerna ska ha minst en grön ton som inte står i dag och skrivs i en annan
  stavning: versaler, tresiffrig hexkod och en hexkod med alfa.
- **2026-10-13 (`--gron-djup` blev en token utan användare):** när en token tas
  bort ska varje `var(--x)` den läste och varje `var()` som läste den sökas upp
  efteråt. I paket 3 blir detta ett test: varje `var(--namn)` i `src/web/**/*.css`
  ska vara definierat i `tema.css`.
- **2026-08-18 (testkommandot), 2026-09-02 (påståenden om exakthet), 2026-09-14
  och 2026-10-13 (antal och mätningar utan kommando):** varje kontrasttal i
  `ARKITEKTUR.md`, i `tema.css` och i `style.css` ska komma från en körning, och
  kommandot och utdatan ska klistras in. Det gäller också de tal som redan står i
  kommentarerna. Till exempel har tabellen i `style.css` rad 27–29 tal för
  `--ikon-gron` och `--positiv`, och de blir fel när värdena byts.
- **2026-09-22 (klassnamnet är ett kontrakt mellan två filer):** byts
  klassnamnen `sv-*-gron` i `landning.html` och `landning.css` ska namnet sökas i
  `src/web` och i `tests`, både före och efter bytet.
- **2026-10-12 (landningssidan lovar det som inte finns), 2026-10-13 (del 7
  beskriver den tillfälliga bilden i presens), 2026-09-04 och 2026-10-11
  (åldrade markörer):** när beslutet är fattat ska varje mening om grönt läsas om.
  Det gäller `ARKITEKTUR.md` ("svag grön ton", "grön stapel", "Ur loggan" med
  png-histogrammet), kommentarerna i `tema.css` och `style.css`, den synliga
  texten på landningssidan och `README.md`. Sökningen ska ha med böjningsformer:
  `grön`, `gröna`, `grönt`, `gron`.
- **2026-10-13 (E-10 utan ankare), 2026-10-13 (H12/H13 och kaskaden):** varje
  mutationsrad ska ge exakt en träff. En spärr som läser CSS ska kräva att det är
  just den deklarationen som gäller, inte bara att den finns någonstans.
- **2026-09-07 (paket startade under granskningen), 2026-09-10 (`git checkout --`
  kastade arbete), 2026-09-07 (felsökningsutskrifter kvar i `src`):** paketen körs
  ett i taget. Granskaren mäter `sha256sum` före och efter granskningen.
  Mutationer och mätskript körs i en kopia i scratchpad och aldrig i `src/`.
- **2026-09-15 och 2026-10-12 (opålitliga processtester):** en röd körning av
  låstestet eller SIGKILL-testet med det kända timeoutmeddelandet räknas inte som
  ett resultat av temabytet. Varje byggpaket redovisas med tre `npm test` i rad,
  med `ℹ fail` och `EXIT=` inklistrade.

## Arbetspaket

Ordningen är bindande. Ett paket startar först när granskaren har gett ett
skriftligt besked om det föregående.

| # | Uppgift | Agent | Klar när |
|---|---------|-------|----------|
| 1 | **Spec för del 9 i `ARKITEKTUR.md`.** Mät loggans färger ur de två svg-filerna (kör kommandot och klistra in utdatan). Bestäm den nya paletten: vilka av loggans toner som blir tokener, vilka valda toner som behövs och deras värden i ljust och mörkt läge. Skriv en tabell som för varje token som läser grönt i dag anger vad den ersätts med eller att den tas bort, och för varje användare (fil:rad) vad den läser efter bytet. Skriv kontrasttabellen för varje kombination som bär text, och för grafik mot 3:1, i båda lägena. Varje tal ska komma från en körning, med kommandot inklistrat. Skriv om "Färgpaletten (bindande)" och de meningar som beskriver grönt. Skriv kravlistan för testerna i paket 2 och 3, med mutationer. | arkitekt | `ARKITEKTUR.md` har avsnittet "Del 9". Avsnittet har en ny palettabell, mappningen gammal → ny för varje grön token och dess användare, och en kontrasttabell där varje rad har ett tal ur en inklistrad körning. Där står regeln för vad som räknas som "grönt", uttryckt som ett nyansintervall och inte som namn. Kravlistan har mutationer, och varje mutation ger exakt en träff med `grep -c -F`. De beslut som listas under "Beslut för arkitekten" nedan är fattade och skrivna. `grep -niE "grön\|gröna\|grönt\|gron"` mot `ARKITEKTUR.md` har körts, och för varje träff står det att den är omskriven eller att den beskriver historik i dåtid. |
| 2 | **Nya värden i `tema.css` och ett test som mäter kontrasten.** Byt värdena enligt paket 1, i ljust och mörkt läge. Skriv om filens kommentarer om kontrast och om var tonerna kommer ifrån. Skriv det kontrasttest som kravlistan anger. Det räknar ut kvoten ur `tema.css` för varje rad i kontrasttabellen, på samma sätt som (H11) räknar hero. Komponenternas tokennamn ändras bara om paket 1 säger det. | byggare | Kontrasttestet finns och passerar. Varje mutation i paket 1:s lista för testet ger `EXIT=1` och kryssraden är inklistrad. `npm test` ger `fail 0` och `EXIT=0` tre gånger i rad. Varje kontrasttal i kommentarerna i `tema.css` stämmer med testets tabell, vilket (FA1)(b) prövar. Talen i `style.css` och `landning.css` skrivs om i paket 3 (ARKITEKTUR.md del 9, "Byggarens instruktioner"). `git diff HEAD -- src` innehåller inga felsökningsutskrifter. |
| 3 | **Användarna läser de nya tokenerna, och de gröna tokenerna tas bort.** Uppdatera `landning.css`, `style.css`, `demo/banner.css` och `landning.html` (klassnamnen) enligt mappningen i paket 1. Ta sedan bort de gröna tokenerna ur `tema.css`. Skriv de test som kravlistan i ARKITEKTUR.md del 9 anger för paket 3, alltså (FA2)–(FA8). Bland dem finns testet att ingen färg som kan nå sidan är grön, i `tema.css`, i de andra stilmallarna och i sidorna. Ett annat test kräver att varje `var(--namn)` i `src/web` är deklarerat i det ljusa `:root` i `tema.css` eller i samma fil. | byggare | `grep -rniE "gron\|grön"` mot `src` och `tests` ger bara de träffar paket 1 uttryckligen tillåter, och utdatan är inklistrad före och efter. (FA2)–(FA8) i ARKITEKTUR.md del 9 passerar. Varje mutation i kravlistan ger `EXIT=1`, också en grön ton i versaler, en i tresiffrig form och en med alfa, och en `var()` till en token som inte finns. Varje kontrasttal i kommentarerna i `style.css` och `landning.css` stämmer med testets tabell, vilket (FA8) prövar. `npm test` ger `fail 0` och `EXIT=0` tre gånger i rad. |
| 4 | **Slutgranskning av del 9.** Hela kedjan: palett, kontrast, inget grönt kvar och inga åldrade meningar. | granskare | Granskarens beskedet är skrivet, med `sha256sum` före och efter. Sökningarna efter `grön`, `gron`, `Kvar i`, `Byggaren ska` och `inte kört` i del 9 är körda och har klistrats in. Nya fel är skrivna i `LARDOMAR.md`. |
| 5 | **README.** Läs `README.md` mot det nya temat och rätta det som beskriver färger, om något gör det. | dokumentator | `grep -niE "grön\|gron\|färg"` mot `README.md` har körts, och för varje träff står det om den har rättats eller varför den står kvar. |

**Stående regel:** granskaren körs efter varje paket, alltså efter paket 1, 2 och
3 och inte bara som paket 4.

## Beslut för arkitekten (paket 1)

1. **Inkomsternas färg (`--positiv`).** Den är grön i dag och ska bytas. Den nya
   färgen ska gå att skilja från `--negativ` (röd) och från guld, och den ska
   klara 3:1 som stor text på raden *Kvar att leva på* och 3:1 som grafik i
   översiktens staplar, i båda lägena. Loggan har bara blått, gråblått, vitt och
   guld, så färgen blir antingen en blå ton ur loggan eller en vald ton med ett
   utskrivet skäl. Arkitekten avgör också om något mer än färgen ska skilja
   positivt från negativt. I dag skiljer bara färgen.
2. **Ersättare för varje annan grön användare.** Det gäller ikonerna på
   landningssidan (`--ikon-gron` och varianterna `-pa-mork` och `-ljus`),
   stapeln för ett nått sparmål, märket i `style.css` rad 515–518 och ramen i
   `landning.css` rad 810. För varje användare ska det stå vilken token den läser
   efter bytet.
3. **Guld.** Ska `--guld` bytas mot loggans `#e3a21a`, och vad händer i så fall
   med `--guld-mork`, `--guld-ljus`, guldknappen (i dag 4,71:1) och myntets K?
   Det ska avgöras med uppmätt kontrast.
4. **De blå tonerna.** Ska `--bla-marin` bytas mot loggans `#0b2c63`, och ska
   `#4a5875` och `#d6deec` bli tokener? `--bla-marin` är bakgrund i det mörka
   läget och text i hero. (H11) i `tests/hero.test.js` räknar hero-kontrasten ur
   `tema.css` och påverkas alltså av bytet.
5. **`--yta-mjuk` (`#edf3ec`).** Tonen är svagt grön. Arkitekten avgör om den
   faller inom "grönt ska bort helt", och regeln för grönt ska skrivas så att
   svaret följer av regeln, alltså med ett nyansintervall och en undre gräns för
   mättnad.
6. **Namnen.** Ska tokener och klasser med `gron` i namnet döpas om eller tas
   bort, i stället för att få ett värde som inte är grönt? Ett namn som säger fel
   färg är ett felaktigt påstående om koden. Valet styr hur stort paket 3 blir.
7. **Vad målet omfattar.** Gäller "grönt ska bort" temats färger (`tema.css` och
   allt som läser det), och inte användarens egna bilder i `src/web/bilder/`,
   som hero-fotot? Det står i dag utanför hexkodsregeln. Om arkitekten inte kan
   avgöra det ur användarens ord ska det bli en fråga till användaren innan
   paket 1 lämnas, inte en gissning.

## Risker

- **Ingen agent kan se sidan.** Kontrasten går att mäta, men inte om sidan ser
  bra ut. Det märks först när användaren öppnar `/` och `/app`. Användaren ska
  därför titta på båda sidorna i ljust och mörkt läge efter paket 3, innan del 9
  räknas som godkänd.
- **Kontrasten faller med en ny ton.** Loggans guld (`#e3a21a`) är ljusare än
  dagens `--guld` och ger lägre kontrast mot ljus bakgrund. En blå inkomstfärg
  kan bli för lik länkarna eller för mörk i mörkt läge. Det märks i paket 2,
  eftersom kontrasttestet räknar varje rad i tabellen.
- **En borttagen token lämnar en `var()` utan värde.** CSS säger ingenting om
  det, och felet syns bara som en färg som saknas. Testet i paket 3 som kräver
  att varje `var()` är definierad fångar det. Därför ska det testet vara skrivet
  och passera innan tokenerna tas bort.
- **Befintliga test bygger på dagens värden.** (H11) i `tests/hero.test.js`,
  `--logga-platta: #f7f5ef;` i `tests/logga.test.js` och kontrastkraven för
  kaskaden kan falla när värdena byts. Det märks i paket 2. Ett test som faller
  ska rättas genom att `ARKITEKTUR.md` ändras först, aldrig genom att assertionen
  bara justeras.
- **Åldrade meningar om grönt finns kvar.** Det gäller till exempel "Varannan
  sektion har en svag grön ton", "Ett nått mål: grön stapel" och tema.css-texten
  om att tonerna mättes ur png-loggan. Det märks på sökningen i paket 1 och 4.
  Den ska täcka böjningsformerna och filerna `ARKITEKTUR.md`, `README.md`, `src`
  och `tests`.
