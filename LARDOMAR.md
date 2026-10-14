# Lärdomar

Teamets minne. Varje fel som gjorts i det här projektet står här, tillsammans
med en regel som ska hindra att det görs om.

**Regler för filen**

- Bara fel som faktiskt inträffat. Inget tyckande, inga gissningar.
- Radera aldrig en post. Slå ihop dubbletter om det blir rörigt.
- "Regel framåt" måste gå att följa bokstavligt av någon som inte var med.
- Har samma fel dykt upp 3 gånger — gör om det till ett automatiskt test
  och skriv `LÖST MED TEST` i posten.

**Mall**

```
### YYYY-MM-DD — <område>: <kort titel>
**Vad gick fel:** <konkret, en mening>
**Varför:** <grundorsaken, inte symtomet>
**Regel framåt:** <handlingsbar instruktion>
```

---

## Poster

<!-- Nya lärdomar läggs till här nedanför, nyast sist. -->

### 0000-00-00 — exempel: så här ser en post ut
**Vad gick fel:** Appen kraschade när användaren lämnade sökfältet tomt.
**Varför:** Ingen validering av tom input innan värdet skickades vidare.
**Regel framåt:** Validera alltid användarinput innan den används — tom sträng,
för lång sträng och fel typ ska hanteras explicit och testas.

<!-- Radera exempelposten ovan när du fått din första riktiga lärdom. -->

### 2026-08-18 — validering: beloppsgränsen går inte att nå från formuläret
**Vad gick fel:** `checkAmountSek` i `src/core/entry.js` ger "Beloppet måste vara
ett tal." för strängen `"10000000"`, trots att `ARKITEKTUR.md` säger att belopp
över 9 999 999,99 ska ge "Beloppet får vara högst 9 999 999,99 kr."; raderna
181–183 och 187–189 kan aldrig köras eftersom regexen `^\d{1,7}([.,]\d{1,3})?$`
redan har begränsat strängen till högst 9999999.99.
**Varför:** Två oberoende regler (formatregex och maxgräns) kontrollerar samma
sak, och regexen råkar vara den strängare — då blir maxregeln död kod och
användaren får fel felmeddelande. Testet på rad 143 skickade in talet `10000000`
men aldrig strängen, så bortfallet syntes inte.
**Regel framåt:** När ett fält valideras i två vägar (sträng från formulär och
tal från kod) ska varje rad i felmeddelandetabellen ha ett test för *båda*
vägarna. Formatkontroll får aldrig ensam avgöra ett värdeintervall — kontrollera
intervallet på det parsade värdet och låt formatregexen vara tillåtande nog att
värdet når intervallkontrollen.

### 2026-08-18 — datamodell: `isEntry` släpper igenom fält för bortvalda funktioner
**Vad gick fel:** `isEntry({ ...giltigPost, income: 5000, history: [], nextDueDate: '2026-02-28' })`
returnerar `true` i `src/core/entry.js` rad 124–138, trots att `PLAN.md` beslut
1–4 och `ARKITEKTUR.md` rad 115–117 säger att posten har exakt sex fält och att
inkomst, historik och "nästa dragning" inte får finnas.
**Varför:** `isEntry` kontrollerar bara att de sex kända fälten finns och är rätt
typ, aldrig att okända fält saknas. Eftersom `isEntry` är den enda spärren när
`storage.js` läser filen från disk kan bortvalda fält ta sig in i datamodellen
utan att någon kod avvisar dem.
**Regel framåt:** En typvakt som `isEntry` ska både kontrollera de tillåtna
fälten och avvisa okända: jämför `Object.keys(value).sort()` mot den fastställda
fältlistan och returnera `false` vid avvikelse. Skriv ett test som skickar in en
post med ett extra fält och förväntar `false`.

### 2026-08-18 — test: ny modul i src/core levererades utan egen testfil
**Vad gick fel:** `src/core/dates.js` byggdes i paket 2 men `tests/dates.test.js`
skapades inte, trots att `ARKITEKTUR.md` rad 401–403 kräver automatiska
enhetstester för `dates`; `daysInMonth(2000, 2)` (400-årsregeln) och
`daysInMonth(2026, 13)` (returnerar `0` i stället för att kasta) körs av ingen
test.
**Varför:** Modulen sågs som ett hjälpmedel åt `entry.js` och ansågs täckt av
entry-testerna, men de testerna når bara de datum som råkar gå genom
valideringen — resten av modulens beteende är otestad kod som nästa paket bygger
vidare på.
**Regel framåt:** Varje fil under `src/core/` ska ha en `tests/<modul>.test.js`
som testar modulens egna exporter direkt, i samma paket som filen skapas. En
modul får inte lämnas vidare med enbart indirekt täckning via en annan moduls
tester.

### 2026-08-18 — datamodell: createEntry litar blint på det injicerade id:t
**Vad gick fel:** `createEntry(draft, () => 42)` och `createEntry(draft, () => '')`
i `src/core/entry.js` rad 106–122 returnerar `{ ok: true, value: … }` med
`id: 42` respektive `id: ''` — poster som `isEntry` i samma fil därefter
underkänner.
**Varför:** `makeId` är en injicerbar parameter men resultatet valideras aldrig,
så modulen kan producera ett värde som dess egen typvakt förkastar. Felet blir
synligt först i paket 4 när posten skrivs till disk och inte kan läsas tillbaka.
**Regel framåt:** Validera värden som kommer från en injicerad funktion på samma
sätt som användarinput. `createEntry` ska kontrollera att `makeId()` gav en
icke-tom sträng och annars returnera `{ ok: false, errors: [...] }`. Invarianten
"allt som `createEntry` returnerar med `ok: true` godkänns av `isEntry`" ska
finnas som test.

### 2026-08-18 — validering: namnlängd mäts i kodenheter, inte tecken
**Vad gick fel:** Ett namn på 31 emoji-tecken avvisas med "Namnet får vara högst
60 tecken." av `src/core/entry.js` rad 148, eftersom `.length` ger 62 för de 31
tecknen, medan `ARKITEKTUR.md` rad 122 säger "1–60 tecken".
**Varför:** JavaScripts `String.prototype.length` räknar UTF-16-kodenheter, och
tecken utanför BMP (emoji) samt vissa kombinerade tecken räknas som två. Felet
är osynligt i tester som bara använder ASCII — `'a'.repeat(61)` på rad 111 ger
samma svar med båda mätsätten.
**Regel framåt:** Mät användarsynlig textlängd med `[...text].length`, aldrig
`text.length`. Varje test av en längdgräns ska innehålla minst ett fall med ett
tecken utanför BMP (t.ex. en emoji) utöver ASCII-fallet.

### 2026-08-18 — validering: felordningen för amountSek skiljer sig mellan sträng och tal
**Vad gick fel:** `amountSek: '0,000'` ger "Beloppet får ha högst två decimaler."
medan `amountSek: 0` ger "Beloppet måste vara större än 0 kr.", trots att
`ARKITEKTUR.md` rad 155–158 säger att den första regeln i tabellordningen vinner
och att ≤ 0 står före decimalregeln.
**Varför:** Strängvägen (`src/core/entry.js` rad 173–186) kontrollerar decimaler
före nollkontrollen, tal-vägen (rad 155–168) gör tvärtom. Två kodvägar för samma
fält skrevs var för sig utan ett gemensamt facit för regelordningen.
**Regel framåt:** När ett fält kan komma i flera typer ska värdet först
normaliseras till en enda typ, och därefter ska alla regler köras i en enda
ordnad kedja som är gemensam för alla ingångstyper. Skriv ett test som ger samma
värde i varje ingångstyp och kräver identiskt felmeddelande.

### 2026-08-18 — miljö: testkommandot i ARKITEKTUR.md skrevs ned utan att köras
**Vad gick fel:** `ARKITEKTUR.md` rad 17, 395 och `package.json` rad 10 anger
`node --test tests/` som projektets enda giltiga testkommando, men på den
installerade Node-versionen (v24.19.0) tolkas `tests/` som ett glob-mönster och
kommandot avslutas med `MODULE_NOT_FOUND` — testerna går bara att köra med
`node --test "tests/**/*.test.js"`. Samma sak gäller `npm start`, som
`ARKITEKTUR.md` rad 28–29 kräver ska köras innan paket 2 påbörjas trots att
`src/server/server.js` skapas först i ett senare paket.
**Varför:** Kommandona härleddes ur dokumentation och versionsantaganden
("stabilt från Node 20") i stället för att köras i den faktiska miljön, och
skrevs sedan ned som bindande. Antagandet om Node-versionen kontrollerades
aldrig med `node --version`.
**Regel framåt:** Ett kommando får skrivas in i `ARKITEKTUR.md`, `CLAUDE.md`,
`README.md` eller `package.json` först efter att det har körts i den här miljön
och avslutats med exitkod 0. Klistra in den faktiska utdatan i paketets
redovisning. Kommandon som förutsätter filer ett senare paket skapar ska inte
skrivas som förkrav för ett tidigare paket.

### 2026-08-19 — validering: belopp under decimaltoleransen godkänns och lagras som 0
**Vad gick fel:** `createEntry({ …, amountSek: '0,000000001' })` (och talet `1e-9`)
returnerar `ok: true` med `value.amountSek: 0` i `src/core/entry.js` rad 207–218 —
en post som bryter regeln "> 0", som `isEntry` i samma fil därefter underkänner
(invarianten "allt `createEntry` returnerar med `ok: true` godkänns av `isEntry`"
är alltså falsk), och som i paket 4 skrivs till disk men inte kan läsas tillbaka.
Alla värden `0 < v < 1e-8` beter sig så; `isEntry` säger dessutom `true` om ett
sådant värde (t.ex. `1e-15`) redan står i datafilen.
**Varför:** Regel 1 (`v <= 0`) prövas på det inkommande talet, men det som lagras
är `Math.round(v * 100) / 100`. Decimalregelns tolerans `1e-6` släpper igenom
varje `v` vars `v * 100` avrundas till `0`, och då hamnar gränsvillkoret och det
lagrade värdet på var sin sida om avrundningen. Hålet blev nåbart från formuläret
när `AMOUNT_PATTERN` gjordes tillåtande (upp till 15 decimaler) — det gamla
mönstret stoppade fler än 3 decimaler innan kedjan nåddes.
**Regel framåt:** När ett validerat värde lagras i en annan form än det prövades
i (avrundning, trunkering, normalisering) ska värdegränserna prövas om på det
lagrade värdet innan `ok: true` returneras — för `amountSek` betyder det att
`Math.round(v * 100)` måste vara minst `1`. Varje toleransjämförelse ska ha
testfall på båda sidor om sin gräns (här `1e-8` respektive `9.9e-9`, som sträng
och som tal), och invarianttestet "allt som `createEntry` returnerar med
`ok: true` godkänns av `isEntry`" ska köras med värden från just de gränserna,
inte bara med typiska belopp.

### 2026-08-23 — dokumentation: gränsvärdespåstående om flyttal skrevs ned utan att köras
**Vad gick fel:** `ARKITEKTUR.md` rad 376, 391 och 1085 påstår att "varje `v` där
`0 < v < 1e-8`" ryms under regel 3:s tolerans och att "allt strikt under `1e-8`
ger regel 4", men `validateEntryDraft({ …, amountSek: 9.999999999999999e-9 })`
— största dubbeln under `1e-8` — ger `Beloppet får ha högst två decimaler.`,
alltså regel 3, eftersom `9.999999999999999e-9 * 100` avrundas till exakt samma
dubbel som `1e-6`.
**Varför:** Gränsen härleddes i decimalräkning ("1e-8 * 100 = 1e-6") och skrevs
in som ett allmängiltigt påstående i ett bindande dokument utan att värdena runt
gränsen kördes; i binär flyttalsaritmetik ligger brytpunkten en ulp under `1e-8`.
Samma grundorsak som posten 2026-08-18 (miljö: testkommandot skrevs ned utan att
köras): ett påstående härlett ur resonemang i stället för ur en körning.
**Regel framåt:** Ett allmängiltigt påstående om flyttal ("allt under X", "exakt
Y", "gränsen går mellan A och B") får skrivas in i `ARKITEKTUR.md` först efter
att X, närmast lägre dubbel och närmast högre dubbel har körts genom koden och
utdatan klistrats in i redovisningen. Går påståendet inte att verifiera för alla
värden ska det formuleras om till att gälla just de körda värdena.

### 2026-08-23 — validering: namnlängden räknas genom att hela strängen materialiseras
**Vad gick fel:** `checkName` i `src/core/entry.js` rad 201 kör
`[...trimmed].length` på hela namnet innan det jämförs med 60; ett namn på
50 000 000 tecken tar 2,8 sekunder och 1,7 GB heap för att svara "Namnet får
vara högst 60 tecken." (uppmätt med `node --max-old-space-size=4096`; 10 000 000
tecken tar 98 ms och 95 MB). Samma indatastorlek i `amountSek`, `startDate`,
`interval` och `category` avvisas på under 60 ms.
**Varför:** Rättningen av lärdomen 2026-08-18 (namnlängd i kodenheter) bytte
mätsätt men inte arbetsmängd: spridningen bygger en array med ett element per
tecken i hela strängen, fast svaret är avgjort efter 61 tecken. Varken
`checkName` eller `ARKITEKTUR.md` sätter någon övre gräns för indatastorleken,
och testerna använder som mest 61 tecken, så kostnaden syns inte.
**Regel framåt:** Räkna aldrig längden på hela indata när frågan bara är om en
gräns överskrids. Avvisa först på `trimmed.length > 2 * NAME_MAX_LENGTH` — en
kodpunkt är högst två kodenheter, så fler än 120 kodenheter betyder alltid fler
än 60 tecken — och räkna tecken med `[...trimmed].length` först därefter. Varje
längdgräns ska ha ett testfall med minst 1 000 000 tecken som ger felmeddelandet
utan mätbar fördröjning.

### 2026-08-23 — datamodell: isEntry godkänner belopp som appen räknar om till ett annat tal
**Vad gick fel:** `isEntry({ …, amountSek: 199.999999999 })` returnerar `true`
(`src/core/entry.js` rad 164–189), medan `validateEntryDraft` för exakt samma
värde lagrar `200` — en datafil kan alltså innehålla ett belopp som passerar
spärren vid inläsning men som appen sedan visar och räknar med som ett annat
tal, trots att datamodelltabellen i `ARKITEKTUR.md` rad 183 kräver högst två
decimaler.
**Varför:** `isEntry` ärver regelkedjan, och regel 3 är en toleransjämförelse
(`>= 1e-6` öre) som släpper igenom allt inom `1e-8` kr från ett helt öre. Regel 4
stängde hålet nedåt (värden som avrundas till noll öre), men ingen kontroll
kräver att det inlästa värdet redan **är** den kanoniska form skrivvägen
producerar, `Math.round(v * 100) / 100`.
**Regel framåt:** En typvakt som godkänner data från disk ska kräva att värdet är
identiskt med den kanoniska form skrivvägen producerar, inte bara att det ligger
inom en tolerans: `isEntry` ska returnera `false` om
`value.amountSek !== Math.round(value.amountSek * 100) / 100`. Testfall:
`199.999999999` och `199.000000001` → `false`; `0.01`, `199.5` och `9999999.99`
→ `true`.

### 2026-08-23 — dokumentation: två facit i samma fil ger olika svar för samma belopp
**Vad gick fel:** `ARKITEKTUR.md` rad 258–261 slår fast att felmeddelandetabellen
är "det enda facit som gäller för regelordningen inom ett fält" och att ingen
annan del av filen får ange en avvikande ordning, men efter tillägget av regel 4
ger den tabellen fel svar för `1e-9`: raden "fler än 2 decimaler" är sann för
värdet och skulle ge `Beloppet får ha högst två decimaler.`, medan koden och
facittabellen på rad 417 ger `Beloppet måste vara större än 0 kr.`
**Varför:** Regel 4 fördes in i Steg 2-tabellen (rad 359) och i noten på rad
285–290, men undantaget skrevs inte in där absolutkravet står. Motiveringen
"regel 4 ger ingen ny felsträng" gäller strängarna, inte ordningen: regel 4
ändrar vilken rad som vinner för alla `0 < v < 1e-8`.
**Regel framåt:** Ett dokument får ha exakt ett facit per fråga. Läggs ett steg
till i en regelkedja ska antingen steget in som en egen rad i
felmeddelandetabellen med villkoret skrivet exakt som i koden, eller så ska
meningen "detta är det enda facit" skrivas om till att peka ut Steg 2-tabellen
som facit för ordningen. Efter varje tillägg: kör varje värde i facittabellen
mot båda tabellerna och kräv samma svar.

### 2026-08-23 — dokumentation: ARKITEKTUR.md beskriver kod som inte längre ser ut så
**Vad gick fel:** Rad 229–232 påstår att "I dagens `src/core/entry.js` står
villkoret skrivet för hand på båda ställena" och att "de två raderna ska ersättas
av två anrop till `isValidEntryId`", fast koden redan anropar `isValidEntryId` på
rad 140 och 179; på samma sätt visar importraden i gränssnittsblocket (rad 842)
bara `{ ISO_DATE_PATTERN, parseIsoDate }` medan `entry.js` rad 5 importerar även
`isValidIsoDate` — den import som samma dokument på rad 825–828 kräver.
**Varför:** Avsnitten skrevs som instruktioner till byggaren i presens och
lämnades kvar oförändrade när byggaren utfört dem. I det här paketet uppdaterades
bara de avsnitt som rörde regel 4; övriga påståenden om hur koden ser ut lästes
aldrig om mot koden.
**Regel framåt:** Instruktioner till byggaren skrivs i beslutsloggen, aldrig som
påståenden om hur koden ser ut i dag. Innan ett paket lämnas vidare ska varje
mening i `ARKITEKTUR.md` som beskriver aktuell kod ("i dagens fil", "ska
ersättas", import- och signaturrader i kodblock) läsas om mot filen den beskriver
och antingen skrivas om i dåtid eller strykas.

### 2026-08-23 — test: kontrollen av antalet fält i isEntry skyddas inte av något test
**Vad gick fel:** Tas raderna 171–173 i `src/core/entry.js`
(`if (keys.length !== ENTRY_FIELDS.length) { return false; }`) bort ger
`npm test` fortfarande `tests 48, pass 48, fail 0` och exit 0, och 576
genererade postformer (alla 64 delmängder av de sex fälten × nio varianter av
extrafält) ger identiskt svar med och utan raderna.
**Varför:** `keys.some((key, index) => key !== ENTRY_FIELDS[index])` fångar redan
varje extra fält (jämförelsen sker mot `ENTRY_FIELDS[6]`, som är `undefined`),
och den enda delmängd som är ett prefix av fältlistan saknar `startDate` och
faller i stället på `validateEntryDraft`. Testet på rad 540–543 i
`tests/entry.test.js` påstår i kommentaren "Ett saknat fält är också fel antal
fält" men passerar via en annan kodväg än den kommentaren namnger.
**Regel framåt:** Verifiera varje spärr med mutation innan paketet lämnas vidare:
ta bort raden, kör `npm test` och kräv minst ett fallerande test och exit 1.
Överlever mutationen ska antingen raden tas bort eller ett test skrivas som bara
den raden kan få att passera. En testkommentar får inte namnge vilken kontroll
som fångar ett fall förrän mutationen har visat att det stämmer.

### 2026-08-23 — dokumentation: oombedd språkändring gjorde en korrekt mening felaktig
**Vad gick fel:** Rad 117 i `ARKITEKTUR.md` ändrades från "var sin handskrivna
kopia" till "var sin handskriven kopia" i ett paket vars uppdrag bara gällde
regel 4 i `amountSek`-kedjan; efter ett possessivt bestämningsord (`sin`) står
adjektivet i bestämd form, så den tidigare lydelsen var den rätta.
**Varför:** Formuleringen harmoniserades mot rad 228 ("en egen handskriven
kopia"), där obestämd artikel kräver obestämd form. Ändringen låg utanför
uppdraget, i en fil som är bindande för alla följande paket, och varken en
körning eller ett test kan fånga den.
**Regel framåt:** Ändra bara de avsnitt uppdraget gäller. En språkändring i
`ARKITEKTUR.md`, `CLAUDE.md` eller `LARDOMAR.md` som ingen bett om ska inte
göras. Krävs den ändå för att texten ska bli begriplig: redovisa den som en egen
rad i paketets redovisning tillsammans med den språkregel som motiverar den, så
att den går att granska.

### 2026-08-24 — test: mutationskravet tillämpades bara på den spärr lärdomen nämnde
**Vad gick fel:** Paketet skrev in mutationsverifiering av *varje delvillkor* som
bindande krav i `ARKITEKTUR.md` (teststrategin) och körde sedan mutation bara på
fältkontrollen i `isEntry`; delvillkoret `typeof value.amountSek !== 'number'` i
samma funktion överlevde mutation med `tests 52, pass 52, fail 0` och exit 0,
eftersom inget test använde ett `amountSek` av typen `BigInt` eller `Symbol` —
just de värden där `canonicalAmountSek` kastar
`TypeError: Cannot mix BigInt and other types` i stället för att `isEntry`
returnerar `false`.
**Varför:** Mutationskörningen riktades mot det exempel lärdomen 2026-08-23
råkade namnge (fältantalskontrollen) i stället för mot varje villkor paketet
självt lade till. Att villkoret var nytt gjorde det inte prövat: den nya
likhetskontrollen mot kanonisk form ser ut att ensam avvisa allt som inte är ett
tal, och det gör den också — för varje typ där `Math.round(v * 100)` går att
beräkna. `BigInt` och `Symbol` är de två typer där uttrycket kastar i stället,
och de saknades i testdatan, som bara innehöll strängar, `null` och objekt. Detta
är andra gången ett delvillkor i `isEntry` visar sig oskyddat av något test
(första gången: 2026-08-23, kontrollen av antalet fält).
**Regel framåt:** Mutationsprövningen ska omfatta varje delvillkor paketet
självt lägger till eller ändrar, inte bara det villkor en lärdom råkar nämna.
Räkna upp de nya delvillkoren skriftligt i redovisningen och visa en
mutationskörning per villkor med exit 1. Överlever ett villkor: leta först efter
den indatatyp där det skyddar mot ett *kast* och inte mot ett `false` — för
aritmetik på ovaliderade värden är det `BigInt` och `Symbol`, som kastar
`TypeError` där varje annan typ tvingas till `NaN`. Varje typvakt som räknar på
ett fält ska ha testfall med `BigInt` och `Symbol` för det fältet.

### 2026-09-02 — dokumentation: "exakt heltalsaritmetik utan flyttal" skrevs in i koden utan att köras
**Vad gick fel:** `src/core/money.js` rad 24 lovar "Heltalsdivision med 'halva
öret uppåt', utan flyttal i mellanledet" och `src/core/cost.js` rad 3 lovar
"Årssumman är exakt", men båda påståendena är falska på den här maskinen:
`divideRoundHalfUp(9007199254740989, 12)` ger `750599937895083` där det exakta
svaret är `750599937895082`, och `totalYearlyOre` av 10 000 000 årsposter à
9 999 999,99 kr ger `9999999990992800` i stället för `9999999990000000` — ett
tyst fel på 992 800 öre utan undantag och utan `Number.isSafeInteger`-kontroll.
**Varför:** `2 * numerator + denominator` och `sum += yearlyOre(entry)` är
flyttalsoperationer på `Number`, inte heltalsaritmetik; över 2^53 avrundas både
`2n + d` och den ackumulerade summan till närmaste representerbara dubbel.
Formuleringen "Exakt, i heltalsaritmetik, utan flyttal" hämtades ur
`ARKITEKTUR.md` rad 672 och skrevs av in i koden som ett allmängiltigt påstående
utan att något värde nära 2^53 kördes; testerna går som högst till `999999999`.
Detta är tredje gången ett påstående skrivits in i ett bindande dokument eller i
koden utan att ha körts (2026-08-18 testkommandot, 2026-08-23 flyttalsgränsen).
**Regel framåt:** Ett påstående om exakthet ("exakt", "utan flyttal", "heltal")
får skrivas i `ARKITEKTUR.md` eller i en kodkommentar först efter att funktionen
körts mot en `BigInt`-beräkning av samma uttryck för `Number.MAX_SAFE_INTEGER`,
`2**53`, `2**53 - 3` och `2**54`, med utdatan inklistrad i redovisningen. Håller
exaktheten bara inom ett intervall ska intervallet skrivas ut i påståendet och
funktionen ska kasta `RangeError` utanför det: `divideRoundHalfUp` ska kräva
`Number.isSafeInteger(2 * numerator + denominator)` och `totalYearlyOre` ska
kräva `Number.isSafeInteger(sum)` efter varje addition.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-02 — dokumentation: ARKITEKTUR.md:s exempelsträng för formatSek är inte den koden ger
**Vad gick fel:** `ARKITEKTUR.md` rad 976 anger `formatSek`-utdatan som
`"1 234,50 kr"` med vanliga mellanslag (U+0020, verifierat med `od -c`), medan
`formatSek(123450)` på den här maskinen ger kodpunkterna
`U+0031 U+00A0 U+0032 U+0033 U+0034 U+002C U+0035 U+0030 U+00A0 U+006B U+0072`,
alltså hårt blanksteg på båda platserna — `formatSek(123450) === '1 234,50 kr'`
är `false`.
**Varför:** Byggaren upptäckte skillnaden, skrev testerna mot den verkliga
utdatan och dokumenterade den i `tests/money.test.js` rad 143–144, men lämnade
det bindande dokumentet oförändrat, trots regeln i `CLAUDE.md` att
`ARKITEKTUR.md` ska ändras först och byggas sedan. Paket 6 läser rad 976 för att
bygga gränssnittet och jämför då mot en sträng som aldrig uppstår. Tredje gången
`ARKITEKTUR.md` innehåller ett påstående om koden som koden inte uppfyller
(2026-08-23 två facit i samma fil, 2026-08-23 beskriver kod som inte längre ser
ut så).
**Regel framåt:** Hittar byggaren en skillnad mellan `ARKITEKTUR.md` och det som
koden faktiskt producerar ska paketet lämnas tillbaka till arkitekten innan det
redovisas som klart — skillnaden får aldrig bara noteras i en testkommentar.
Varje exempelsträng i `ARKITEKTUR.md` som en funktion ska producera skrivs med
kodpunkterna utskrivna så snart den innehåller andra blanktecken än U+0020,
`"1\u00a0234,50\u00a0kr"`, och verifieras med en körning av funktionen.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-02 — kostnad: ett interval utanför tabellen ger tyst NaN i stället för fel
**Vad gick fel:** `yearlyOre({ …, interval: 'weekly' })` i `src/core/cost.js`
rad 20 returnerar `NaN`, och `totalYearlyOre([giltigPost, weeklyPost])`
returnerar `NaN` utan att kasta; `monthlyOre` och `totalMonthlyOre` för samma
post kastar `RangeError: divideRoundHalfUp kräver ett heltal som täljare.`, ett
meddelande som pekar ut fel orsak. Kedjan vidare är körd:
`formatSek(totalYearlyOre(entries))` ger strängen `"NaN kr"`, alltså engelsk
felutdata rakt in i gränssnittet som paket 6 bygger. Inget testfall i
`tests/cost.test.js` skickar in ett interval utanför tabellen.
**Varför:** `PAYMENTS_PER_YEAR[entry.interval]` är ett ovaliderat uppslag: en
nyckel som saknas ger `undefined`, och `heltal * undefined` ger `NaN` i stället
för att kasta. `sekToOre` i samma paket har uttryckligen en spärr med
motiveringen "i stället för att föras vidare som ett skadat ören-tal"
(`src/core/money.js` rad 9–14), men `cost.js` för sedan vidare precis ett sådant
skadat tal. `cost.js` kontrollerar ingen indata alls: `yearlyOre({ amountSek:
-100, interval: 'monthly' })` ger `-120000` och `totalYearlyOre('abc')` itererar
över strängens tecken.
**Regel framåt:** Ett uppslag i en tabell med ett ovaliderat värde som nyckel ska
alltid ha en explicit spärr före multiplikationen: `yearlyOre` ska kasta
`RangeError` när `Object.hasOwn(PAYMENTS_PER_YEAR, entry.interval)` är `false`,
med ett meddelande som namnger `interval` och inte täljaren. Varje funktion i
`src/core/` som tar emot ett `Entry` ska ha testfall med `interval` utanför
tabellen, `interval: undefined` och negativt `amountSek`, och ingen exporterad
funktion i `src/core/` får returnera `NaN` för någon indata — den ska kasta i
stället.

### 2026-09-02 — test: kopplingen mellan INTERVALS och PAYMENTS_PER_YEAR skyddas inte av något test
**Vad gick fel:** `tests/cost.test.js` innehåller noll referenser till
`INTERVALS` (`grep -c 'INTERVALS' tests/cost.test.js` ger `0`). Läggs `'weekly'`
till i `INTERVALS` i `src/core/entry.js` rad 10 faller fyra tester, och alla fyra
ligger i `tests/entry.test.js` (rad 39, 70, 441, 518) — inget test i paket 3
faller. `validateEntryDraft` godkänner då posten (`ok: true`) medan `yearlyOre`
för samma post ger `NaN`.
**Varför:** De två konstanterna beskriver samma domän men bor i var sin modul,
och `PAYMENTS_PER_YEAR` fick sin ägarkommentar utan att någon kontroll knyter
nycklarna till `INTERVALS`. De fyra tester som faller är just de tester en
byggare uppdaterar som en del av att lägga till ett intervall; när de är
uppdaterade är hålet i `cost.js` helt otäckt.
**Regel framåt:** När två konstanter i `src/core/` måste beskriva samma domän
ska den beroende modulens testfil importera båda och asserta att de stämmer:
`tests/cost.test.js` ska innehålla
`assert.deepEqual(Object.keys(PAYMENTS_PER_YEAR).sort(), [...INTERVALS].sort())`,
och samma mönster ska finnas för `MONTHS_PER_PERIOD` i `tests/schedule.test.js`
i paket 7. Ett sådant test räknas inte som skrivet förrän mutationen "lägg till
ett värde i den ena listan" har fällt just det testet.

### 2026-09-02 — money: formatSek har ingen ingångsspärr och visar NaN och ∞ för användaren
**Vad gick fel:** `formatSek(NaN)` ger `"NaN kr"`, `formatSek('abc')` ger
`"NaN kr"`, `formatSek(Infinity)` ger `"∞ kr"` och `formatSek(1e300)` ger en
sträng på 313 tecken, medan `formatSek(1n)` och `formatSek(Symbol('x'))` kastar
`TypeError` i stället för det `RangeError` modulens övriga exporter använder.
Inget testfall i `tests/money.test.js` skickar in något annat än ett giltigt
antal öre till `formatSek` eller `oreToSek`.
**Varför:** `sekToOre` och `divideRoundHalfUp` fick var sin uttryckliga
ingångsspärr i samma paket, men `formatSek` och `oreToSek` fick ingen — de
räknades som "bara visning". Just visningsfunktionen är dock den sista som körs
före användaren, så ett skadat tal som slinker igenom någon annanstans blir
synlig engelsk text i ett gränssnitt där all text ska vara svensk.
**Regel framåt:** Ge varje exporterad funktion i en modul samma ingångskontroll
och samma feltyp — kastar en funktion i modulen `RangeError` för icke-finit
indata ska alla göra det. `formatSek` och `oreToSek` ska kasta `RangeError` när
`Number.isInteger(ore)` är `false`, och `tests/money.test.js` ska ha testfall med
`NaN`, `Infinity`, `-Infinity`, en sträng, `null`, `1n` och `Symbol('x')` för
varje exporterad funktion — inte bara för dem som råkade få en spärr först.

### 2026-09-02 — test: summaspärren efter varje addition överlever mutation
**Vad gick fel:** Flyttas `if (!Number.isSafeInteger(sum))` i `src/core/cost.js`
rad 86–88 ut ur `for`-loopen så att bara slutsumman prövas ger `npm test`
fortfarande `tests 118, pass 118, fail 0` och exit 0, trots att `ARKITEKTUR.md`
rad 1245 skriver "efter **varje** addition" som bindande och rad 980–990 kräver
mutationsprövning av varje delvillkor; placeringen ändrar ändå svaret:
`totalYearlyOre([4e13 år, 4e13 år, 4e13 år, post med interval 'weekly'])` ger
`totalYearlyOre kräver att summan är ett säkert heltal.` med villkoret i loopen
och `yearlyOre kräver ett känt interval, fick "weekly".` med det utanför.
**Varför:** Kodkommentaren på rad 84–85 motiverar placeringen med att "en summa
som lämnar det säkra området avrundas tyst och kan inte upptäckas i efterhand",
och den motiveringen är falsk. Alla årsbelopp är minst 0, så delsummorna växer
monotont: överskrider en delsumma området gör slutsumman det också, och den
utflyttade spärren fångar samma lista — testet "totalYearlyOre kastar RangeError
när summan lämnar det säkra heltalsområdet" passerade i mutationskörningen. Den
verkliga skillnaden är vilket felmeddelande som vinner när både en delsumma och
en senare post är trasiga, och den skillnaden stod aldrig skriven, så inget test
kunde härledas ur motiveringen. Tredje gången ett delvillkor lämnas oskyddat av
något test (2026-08-23 fältantalskontrollen i `isEntry`, 2026-08-24
`typeof value.amountSek !== 'number'`).
**Regel framåt:** Skriv motiveringen till ett villkors *placering* som det
indatafall där placeringen ändrar svaret, och gör det fallet till ett testfall i
samma paket. För en spärr inuti en loop betyder det en lista där både
loopvillkoret och ett senare element är trasiga, med det förväntade meddelandet
utskrivet. Överlever villkoret ändå mutationen ska det flyttas ut eller tas bort
— en kommentar som säger "annars kan det inte upptäckas i efterhand" räknas inte
som skydd förrän en körning visat att det faktiskt inte upptäcks.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-02 — dokumentation: totalYearlyOre-tabellen numrerar spärrarna i en ordning koden inte följer
**Vad gick fel:** `ARKITEKTUR.md` rad 1198 slår fast "Ingångsspärrar i `cost.js`
— bindande, första träff vinner", och `totalYearlyOre`-tabellen på rad 1241–1245
numrerar "varje post prövas av `yearlyOre`-kedjan" som 2 och
`!Number.isSafeInteger(sum)` som 3, men koden varvar dem: för
`totalYearlyOre([4e13 år, 4e13 år, 4e13 år, post med interval 'weekly'])` ger
tabellens ordning `yearlyOre kräver ett känt interval, fick "weekly".` medan
körningen ger `totalYearlyOre kräver att summan är ett säkert heltal.`
**Varför:** Rad 3 i tabellen bär själv undantaget ("efter **varje** addition"),
vilket upphäver den numrering raden står i — samma tabell har alltså två svar på
frågan "vilken spärr vinner". `yearlyOre`-tabellen strax ovanför är en verklig
sekventiell kedja i en funktion, där numreringen stämmer, och
`totalYearlyOre`-tabellen skrevs i samma form utan att formen passade: där är
postprövningen och summaprövningen inte två steg efter varandra utan varvade.
**Regel framåt:** En numrerad "första träff vinner"-tabell får bara beskriva
villkor som körs sekventiellt i en enda kedja. Prövas villkoren varvat i en loop
ska tabellen ersättas av loopens ordning skriven som pseudokod, följd av ett
utskrivet exempel på en indata där två villkor är sanna samtidigt och det
vinnande meddelandet angivet. Kontrollera efter varje tabelltillägg genom att
konstruera en indata som gör två rader sanna och köra den.

### 2026-09-02 — dokumentation: "tom lista ger 0 för samtliga fyra funktioner" motsägs av koden
**Vad gick fel:** `ARKITEKTUR.md` rad 672 påstår "Tom lista ger `0` för samtliga
fyra funktioner, aldrig fel och aldrig `NaN`", men `yearlyOre([])` och
`monthlyOre([])` kastar `RangeError: yearlyOre kräver ett känt interval, fick
"undefined".`; bara `totalYearlyOre([])` och `totalMonthlyOre([])` ger `0`. Det
nya avsnittet på rad 1252, skrivet i samma paket, säger rätt sak ("Tom lista ger
fortfarande `0` från både `totalYearlyOre` och `totalMonthlyOre`"), så filen har
två svar på samma fråga.
**Varför:** Paketet skrev in det korrekta påståendet i `cost.js`-blocket men läste
inte om normaliseringsavsnittet som säger emot det, trots att just det stycket
ändrades i samma paket — kodblocket direkt ovanför rad 672 skrevs om i samma
ändring. Regeln från 2026-08-23 ("kör varje värde i facittabellen mot båda
tabellerna och kräv samma svar") tillämpades på beloppskedjan men inte på det nya
avsnittet.
**Regel framåt:** När ett påstående om en funktions beteende skrivs in på ett nytt
ställe i `ARKITEKTUR.md` ska funktionsnamnet först sökas i hela filen, och varje
träff antingen strykas eller skrivas om så att den ger samma svar. Ett påstående
som räknar upp "samtliga N funktioner" ska namnge dem, och varje namngiven
funktion ska köras med det påstådda argumentet innan meningen skrivs.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-02 — arkitektur: den utvidgade ägarregeln för tal bryts av kod som redan fanns
**Vad gick fel:** `ARKITEKTUR.md` rad 121–131 utvidgades i det här paketet till
"Ett tal som står på mer än ett ställe *i samma roll* ska ha en namngiven ägande
konstant och läsas därifrån", men `100` i rollen "öre per krona" står handskrivet
i `src/core/entry.js` på rad 168 (två gånger), rad 247 (två gånger) och rad 257,
medan `ORE_PER_SEK` i `src/core/money.js` rad 9 är den namngivna ägaren — och
samma dokument förbjuder på rad 1048 den import regeln kräver ("`entry.js`
importerar den inte").
**Varför:** Regeln utvidgades för att motivera `MONTHS_PER_YEAR` i `cost.js` och
prövades bara mot det tal utvidgningen handlade om. Ingen sökning gjordes efter
andra tal som redan står i samma roll på flera ställen, och kravet stämdes inte
av mot filens egna importbeslut. En bindande regel som den befintliga koden
bryter mot är verkningslös: nästa granskare kan inte avgöra om ett handskrivet
tal är ett fel eller ett accepterat undantag.
**Regel framåt:** När en regel i `ARKITEKTUR.md` utvidgas ska den köras mot hela
`src/core/` innan paketet lämnas vidare: sök upp varje förekomst regeln nu
träffar och skriv in var och en antingen som ett fel att laga i beslutsloggen
eller som ett namngivet undantag i regeltexten med skälet utskrivet. Kontrollera
i samma svep att ingen annan mening i filen förbjuder det regeln kräver — här att
`ORE_PER_SEK` inte kan läsas från `entry.js` så länge rad 1048 står kvar.

### 2026-09-02 — datamodell: cost.js har en egen, svagare kopia av "är detta ett objekt"
**Vad gick fel:** `yearlyOre` i `src/core/cost.js` rad 42 prövar
`entry === null || typeof entry !== 'object'`, vilket släpper igenom en array och
ett `Date`: med `arr = []` och de sex fälten påsatta ger `yearlyOre(arr)` `120000`
och `monthlyOre(arr)` `10000`, medan `isEntry(arr)` i `src/core/entry.js`
returnerar `false` för exakt samma värde — `entry.js` rad 310–312 äger begreppet
med `isPlainObject`, som också har `!Array.isArray(value)`.
**Varför:** Villkoret skrevs för hand i `cost.js` och skrevs sedan av ordagrant in
i facittabellen i `ARKITEKTUR.md` rad 1207, så den svagare kopian blev bindande.
`isPlainObject` är inte exporterad från `entry.js`, så den var inte tillgänglig,
och ingen kontrollerade om begreppet redan hade en ägare — det är precis den
situation ägarregeln under "Mappstruktur" finns för. Testet "varje postfunktion
kastar RangeError för något som inte är ett objekt" använder `null`, `undefined`,
`'abc'`, `42`, `true`, `Symbol('x')` och `100n` men aldrig en array, så
avvikelsen syns inte.
**Regel framåt:** Innan ett typvillkor skrivs för hand i en ny modul: sök i
`src/core/` efter en befintlig funktion som avgör samma sak, och exportera och
importera den i stället för att skriva en andra kopia. Här ska `isPlainObject`
exporteras från `entry.js` och anropas av `yearlyOre`. Varje test som prövar "är
detta ett objekt" ska ha `[]`, `[1]` och `new Date()` bland sina fall, inte bara
primitiver och `null`.

### 2026-09-02 — dokumentation: ARKITEKTUR.md pekar ut en kvarvarande uppgift i paket 3 som redan är utförd
**Vad gick fel:** `ARKITEKTUR.md` rad 1856–1859 säger "**Kvar i paket 3:** de
kommentarer i checkAmountSek som citerar uttrycket med siffran (v * 100 och
Math.round(v * 100) / 100) ska skrivas om till ORE_PER_SEK", men byggaren har
redan skrivit om dem: `grep -n '\b100\b' src/core/entry.js` ger noll träffar, och
kommentarerna på rad 245, 258 och 259 lyder numera `v * ORE_PER_SEK` respektive
`Math.round(v * ORE_PER_SEK) / ORE_PER_SEK`. Samma fil säger på rad 160
`**Åtgärdat i paket 3**` om de fem literalerna, så dokumentet ger två besked om
läget i samma fil: en punkt är avklarad och en punkt är kvar, fast båda är gjorda.
**Varför:** Beslutsloggen delar varje beslut i "Utfört i paket 3" och "Kvar i
paket 3", och den uppdelningen skrevs när beslutet fattades, inte när byggaren
lämnade tillbaka paketet. "Kvar"-raden är ett påstående om hur koden ser ut i dag
och blir falsk i samma stund som byggaren utför den, men ingenting i arbetsgången
tvingar fram en omläsning av just den raden — byggaren rättade koden och
arkitekten uppdaterade bara de avsnitt som rörde nya beslut. Fjärde gången
`ARKITEKTUR.md` innehåller ett påstående om koden som koden inte uppfyller
(2026-08-23 två facit i samma fil, 2026-08-23 beskriver kod som inte längre ser ut
så, 2026-09-02 exempelsträngen för `formatSek`).
**Regel framåt:** En rad i beslutsloggen som börjar `**Kvar i paket N:**` är en
öppen uppgift och får inte stå kvar när paket N lämnas vidare. Innan paketet
redovisas som klart: kör `grep -n "Kvar i paket N" ARKITEKTUR.md`, och för varje
träff antingen kör det kommando som visar att uppgiften kvarstår och klistra in
utdatan, eller skriv om raden till `**Utfört i paket N:**` med det som faktiskt
gjordes. En uppgift som flyttas till ett senare paket skrivs om till
`**Kvar i paket M:**` med M > N.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-02 — money: -0 tar sig genom alla tre spärrarna och blir "−0,00 kr" för användaren
**Vad gick fel:** `formatSek(-0)` ger kodpunkterna `U+2212 U+0030 U+002C U+0030
U+0030 U+00A0 U+006B U+0072`, alltså minustecknet före noll kronor i ett svenskt
gränssnitt, och `oreToSek(-0)` ger `-0`, `sekToOre(-0)`, `sekToOre(-0.001)`,
`sekToOre(-0.004)` och `sekToOre(-1e-9)` ger alla `-0`, och
`canonicalAmountSek(-0)` i `entry.js` ger `-0`. `cost.js` avvisar samma värde med
`yearlyOre kräver ett belopp som inte är negativt.` — de två modulerna i samma
kärna ger alltså olika svar för `-0`. Inget testfall i `tests/money.test.js`
skickar in `-0` till någon exporterad funktion (`grep -n -- '-0\b' ` ger en enda
träff, `oreToSek(-1) === -0.01`).
**Varför:** Alla tre spärrarna i `money.js` är byggda på `Number`-predikat som
säger `true` för `-0`: `Number.isFinite(-0)`, `Number.isInteger(-0)` och
`Number.isSafeInteger(-0)` är alla sanna, och `Math.round(-0.001)` ger `-0` i
stället för `0`. `cost.js` löste samma sak med `Object.is(amountOre, -0)`, och
`ARKITEKTUR.md` skriver där uttryckligen att spärren finns för att `formatSek`
annars visar `-0,00 kr` — men slutsatsen drogs bara för `yearlyOre`, inte för
visningsmodulen som faktiskt producerar strängen. Rättningen 2026-09-02 (`money:
formatSek har ingen ingångsspärr`) gav `formatSek` och `oreToSek` en spärr mot
`NaN`, `Infinity` och fel typ, och listan över testvärden i den lärdomen räknade
upp `NaN`, `Infinity`, `-Infinity`, sträng, `null`, `1n` och `Symbol('x')` — men
inte `-0`, så hålet överlevde en spärr som skrevs just för att täppa till det.
**Regel framåt:** `-0` ska stå i testlistan för varje exporterad funktion i
`src/core/` som tar eller returnerar ett tal, tillsammans med `NaN`, `Infinity`,
`-Infinity`, sträng, `null`, `1n` och `Symbol('x')`. Ett `Number.is*`-predikat
räknas aldrig som en spärr mot `-0`: skriv `Object.is(v, -0)` explicit, precis som
`yearlyOre` gör. Ingen exporterad funktion i `src/core/` får returnera `-0` —
normalisera med `v === 0 ? 0 : v` eller kasta `RangeError`. Asserta `-0` med
`assert.equal(Object.is(resultat, -0), false)`, aldrig med `assert.equal(resultat,
0)`, som är sant för `-0`.

### 2026-09-02 — lagring: två överlappande saveEntries delar samma .tmp-namn och förstör datafilen
**Vad gick fel:** Två `saveEntries`-anrop som överlappar i tid skriver båda till
samma `entries.json.tmp` (`src/server/storage.js` rad 74, `filePath + TEMP_SUFFIX`),
så innehållet blandas: `Promise.allSettled([saveEntries(3000 poster), saveEntries(1500 poster)])`
körd 60 gånger gav 44 gånger en datafil som `loadEntries` därefter avvisar med
`Datafilen är skadad och kunde inte läsas: <sökväg>` och 14 gånger ett
ohanterat `ENOENT: … rename` från det andra anropet — bara 16 av 60 omgångar gav
en läsbar fil, och i samtliga 16 hade det ena anropets poster tyst försvunnit.
I den minimala körningen fanns två sparade poster på disk före omgången och
noll läsbara efter, medan **båda** `saveEntries` returnerade `fulfilled` — appen
rapporterade alltså lyckad sparning samtidigt som användarens fil blev obrukbar.
**Varför:** Temporärfilens namn härleds ur måldatafilens namn och är därför
detsamma för varje samtidigt anrop, och `saveEntries` har varken lås eller kö.
`fs.writeFile` är inte atomär: två parallella `writeFile` mot samma sökväg
varvar sina block, och `fs.rename` byter sedan ut den riktiga filen mot det
blandade resultatet. Atomiciteten skrevs som "skriv till `.tmp`, byt med
`rename`" i `ARKITEKTUR.md` under "Lagring", vilket skyddar mot ett avbrott i
*en* skrivning men inte mot *två* skrivningar — det andra fallet stod aldrig
skrivet och fick därför inget testfall. Paket 5 gör en `POST` per klick, så två
snabba klick på Spara räcker för att nå det.
**Regel framåt:** En temporärfil får aldrig ha ett namn som två samtidiga anrop
kan välja likadant: bygg namnet med ett unikt inslag per anrop
(`${filePath}.${process.pid}.${randomUUID()}.tmp`) och ta bort den i ett
`finally` om `rename` inte hann köras. Serialisera dessutom skrivningarna i
`storage.js` med en modullokal löfteskedja, så att anrop nummer två börjar först
när anrop nummer ett är klart. Testfallet är obligatoriskt:
`await Promise.allSettled([saveEntries(a), saveEntries(b)])` följt av
`loadEntries()`, kört minst 20 omgångar, ska ge en läsbar fil som är exakt `a`
eller exakt `b` — aldrig ett fel och aldrig en blandning.

### 2026-09-02 — lagring: saveEntries kastar råa engelska OS-fel i stället för StorageError
**Vad gick fel:** `saveEntries` (`src/server/storage.js` rad 72–86) har ingen
`try`/`catch`, så varje fel från `fs.mkdir`, `fs.writeFile` och `fs.rename` går
rakt ut till anroparen som ett vanligt `Error`. Körda fall:
en datafil som någon annan har öppen för läsning ger
`EPERM: operation not permitted, rename 'C:\…\entries.json.tmp' -> 'C:\…\entries.json'`
med `instanceof StorageError === false`; en skrivskyddad datafil (`chmod 0o444`)
ger samma `EPERM`; en katalog på `.tmp`-namnets plats ger
`EISDIR: illegal operation on a directory, open 'C:\…\entries.json.tmp'`.
`ARKITEKTUR.md` under "Lagring" säger `StorageError kastas — den fångas i api.js,
som svarar 500 med { "error": "<meddelandet>" }`, och `storage.js` rad 10–11 säger
själv `.message är alltid svensk text: den skickas rakt ut till användaren`.
Meddelandet ovan är engelskt och innehåller användarens fulla hemkatalogsökväg,
vilket bryter mot `CLAUDE.md`:s regel "All text mot användaren ska vara på
svenska". Efter det misslyckade `rename` ligger dessutom `entries.json.tmp` kvar
med användarens nya data (körd: `filer kvar: ["entries.json","entries.json.tmp"]`),
utan att någon kod någonsin tar bort eller läser den.
**Varför:** Feltabellen i `ARKITEKTUR.md` heter "Beteende vid **läsning**" och
räknar bara upp läsvägens fall, så skrivvägens fel fick aldrig någon rad — och
det som inte står i tabellen blev inte byggt. `loadEntries` fick sin `catch` från
tabellens sista rad ("Läsfel från operativsystemet"), medan `saveEntries` inte
hade någon motsvarande rad att bygga efter. Att `EPERM` vid `rename` är det
normala Windows-utfallet när filen är öppen i en annan process (virusskydd,
OneDrive, en editor, eller appens egen samtidiga `GET /api/entries`) syntes inte,
eftersom inget testfall håller filen öppen under en skrivning.
**Regel framåt:** Varje funktion som rör disken ska omsluta *alla* sina
`node:fs`-anrop i `try`/`catch` och kasta `StorageError` med svensk text och
`cause` satt till originalfelet — samma krav som redan gäller `loadEntries`.
`ARKITEKTUR.md` ska få en tabell "Beteende vid skrivning" med en rad per
felsituation (`mkdir` misslyckas, `writeFile` misslyckas, `rename` misslyckas)
och den svenska strängen utskriven, innan koden skrivs. Ett kvarliggande `.tmp`
ska tas bort i ett `finally`. Testfallen är obligatoriska och ska köras med
filen öppen via `await fs.open(filePath, 'r')`, med `fs.chmod(filePath, 0o444)`
och med en katalog på `.tmp`-namnets plats; varje fall ska asserta
`error instanceof StorageError` och att `error.message` inte innehåller
`operation not permitted`.

### 2026-09-02 — lagring: saveEntries validerar ingenting och kan skriva en fil appen vägrar läsa
**Vad gick fel:** `isEntry` sitter bara på läsvägen; `saveEntries` skriver vad
som helst till disk. Körda fall, alla med `saveEntries: ok` och därefter ett
kastande `loadEntries`: en post med ett okänt fält (`income`) och en post med
`amountSek: '199'` ger båda
`Datafilen innehåller en ogiltig post: <sökväg>`; `saveEntries({a: 1})`,
`saveEntries('abc')` och `saveEntries(null)` skriver
`{ "version": 1, "entries": { "a": 1 } }`, `… "entries": "abc" }` respektive
`… "entries": null }` och ger sedan `Datafilen har fel innehåll: <sökväg>`;
`saveEntries(undefined)` skriver `{ "version": 1 }` — nyckeln `entries`
försvinner helt. I samtliga fall har den tidigare, giltiga filen redan bytts ut
av `rename`, så användarens poster är oåtkomliga och appen ger samma fel vid
varje start. `saveEntries([cirkulär post])` och `saveEntries([{…, amountSek: 1n}])`
kastar dessutom `TypeError: Converting circular structure to JSON` respektive
`TypeError: Do not know how to serialize a BigInt` i stället för `StorageError`.
**Varför:** `ARKITEKTUR.md` skriver ut `isEntry` som domare på läsvägen ("Raden
om 'en ogiltig post' avgörs av `isEntry`") men säger ingenting om skrivvägen, och
signaturen `saveEntries(entries: Entry[])` lästes som en garanti i stället för
som ett krav som måste kontrolleras. Det är samma grundorsak som lärdomen
2026-08-18 om `createEntry` och det injicerade id:t: ett värde som kommer utifrån
antas uppfylla modulens egen typvakt utan att någon frågar den. Invarianten
"allt som `saveEntries` skriver kan `loadEntries` läsa tillbaka" fanns aldrig
skriven, och testfilen skickar bara giltiga poster till `saveEntries`.
**Regel framåt:** En funktion som skriver över användarens enda datafil ska
kontrollera hela sin indata *innan* något rör disken och kasta `StorageError`
med svensk text om något är fel — `saveEntries` ska avvisa allt som inte är en
array och varje element som `isEntry` säger `false` om, före `fs.mkdir`. Den
kontrollen ska ha ett invarianttest: för varje ogiltig indata gäller att
`saveEntries` kastar `StorageError` **och** att filen på disk är byte-identisk
med hur den såg ut före anropet. Testlistan ska innehålla `undefined`, `null`,
`'abc'`, `{a: 1}`, `[giltigPost, undefined]`, en post med okänt fält, en post med
fel typ, en cirkulär post och en post med `BigInt`.

### 2026-09-02 — test: atomicitetstestet avbryter aldrig en skrivning och bevisar ingenting
**Vad gick fel:** Testet `en avbruten skrivning lämnar den befintliga filen
oförändrad` (`tests/storage.test.js` rad 395–412) anropar aldrig `saveEntries`
under den påstådda avbrutna skrivningen — det skriver själv `entries.json.tmp`
med `fs.writeFile` på rad 403 och kontrollerar sedan på rad 405–406 att
`entries.json` är oförändrad, fast ingenting har rört `entries.json` mellan rad
398 och 405. Byts hela atomiciteten ut mot `await fs.writeFile(filePath, text,
'utf8')` (ingen `.tmp`, inget `rename`) passerar rad 405 och 406 ändå; det enda
som faller är rad 410, `assert.equal(await exists(filePath + '.tmp'), false)`,
och den faller bara för att testets egen handskrivna `.tmp` inte längre
konsumeras: `AssertionError … true !== false at tests\storage.test.js:410:12`.
`src/server/storage.js` rad 80–83 åberopar just detta test som bevis: "Körd
kontroll i tests/storage.test.js: en halv .tmp-fil lämnar entries.json
oförändrad och läsbar."
**Varför:** Kravet i `ARKITEKTUR.md` under "Lagring" — "Ett avbrott mitt i
skrivningen får inte kunna lämna en halv fil" — handlar om att processen dör
mellan `writeFile` och `rename`, alltså om ett tillstånd som bara uppstår om
`saveEntries` verkligen avbryts. Testet simulerade i stället *resultatet* av ett
avbrott genom att skapa filen för hand, och då blev assertionen sann av sig
själv oavsett hur `saveEntries` är skriven. Samma grundorsak som lärdomen
2026-08-23 om fältantalskontrollen i `isEntry`: en testkommentar namnger vilken
egenskap som fångas utan att mutationen har visat att just den assertionen
fångar den.
**Regel framåt:** Ett test som påstår sig pröva ett avbrott ska avbryta på
riktigt: starta skrivningen i en barnprocess (`fork`), döda den med
`child.kill('SIGKILL')` medan `.tmp` växer, och asserta därefter att
`entries.json` är byte-identisk med före och att `loadEntries()` ger samma lista.
Innan ett sådant test räknas som skrivet ska mutationen "ersätt `writeFile` till
`.tmp` + `rename` med en direkt `writeFile` till datafilen" fällas av en
assertion som ligger i just det testet och namnger avbrottet — inte av en
sidoeffekt på en annan rad. En kodkommentar i `src/` får inte åberopa ett test
som bevis förrän den mutationen har körts och visat exit 1 på rätt rad.

### 2026-09-04 — test: SIGKILL-testet dödar barnet innan skrivningen har börjat
**Vad gick fel:** `ARKITEKTUR.md` rad 1274–1277 gör mutationen "ersätt `writeFile`
till temporärfilen plus `rename` med `await fs.writeFile(filePath, text, 'utf8')`"
bindande och kräver att *punkt 4 i SIGKILL-testet* är det fallerande anropet, men
med mutationen på plats ger körningen `✔ en skrivning som dödas med SIGKILL lämnar
antingen den gamla eller den nya listan (1709.2165ms)` — testet passerar, och exit
1 kommer bara från två andra tester (`✖ rad 6: rename som misslyckas ...` och
`✖ ett misslyckat anrop blockerar inte nästa`). Orsaken är mätt: barnprocessen
börjar skriva först efter cirka 45 ms (validering av 20 000 poster plus
`JSON.stringify` till 3 MB), medan `await sleep(i)` på rad 768 i
`tests/storage.test.js` bara går `i = 0 … 19` ms. Utfallsraden i den ostörda
körningen är `SIGKILL-fördelning: gamla listan 20, barnets lista 0` — grenen
`assert.deepEqual(after, childList)` på rad 780–783 kördes noll gånger. Med
mutationen och ett dödande vid 48–51 ms i stället, 20 omgångar, blev utfallet
`3 × Datafilen är skadad och kunde inte läsas: <sökväg>` och `1 × 0 poster` (tom
fil, tyst dataförlust) — mutationen *är* alltså upptäckbar, men inte i det
tidsfönster testet använder.
**Varför:** Fönstret `i = 0 … 19` skrevs in i `ARKITEKTUR.md` rad 1264 som ett
bindande tal utan att någon mätte när skrivningen faktiskt börjar. Punkt 7 i samma
avsnitt fångar bara den ena snedfördelningen ("gav alla omgångar barnets lista")
och säger ingenting om det omvända, som är precis det som inträffade. Byggaren
läste `exit 1` som ett godkänt utfall utan att kontrollera *vilket* test som föll,
trots att punkt 6 kräver att det namngivna testet faller. Andra gången
atomicitetstestet inte bevisar det det påstår (2026-09-02, atomicitetstestet
avbryter aldrig en skrivning).
**Regel framåt:** Ett tidsfönster i ett avbrottstest ska härledas ur en mätning,
inte skrivas som ett tal: mät först hur många millisekunder barnet behöver från
`process.send('startar')` till dess att `entries.json` ändras, och lägg
dödandetiderna så att fönstret spänner över mätvärdet från klart under till klart
över. Ett mutationsresultat räknas inte som godkänt förrän namnet på det
fallerande testet har jämförts med det test dokumentet pekar ut — klistra in
raden som börjar med kryss. Är den påbjudna assertionsgrenen aldrig körd (här:
noll omgångar med barnets lista) ska testet räknas som fallerat, och båda utfallen
ska räknas i en assertion, inte bara i en `console.log`.

### 2026-09-04 — dokumentation: "Kvar i paket 3" står kvar i ARKITEKTUR.md och är fortfarande falsk
**Vad gick fel:** `ARKITEKTUR.md` rad 2249 säger fortfarande "**Kvar i paket 3:**
de kommentarer i `checkAmountSek` som citerar uttrycket med siffran (`v * 100` och
`Math.round(v * 100) / 100`) ska skrivas om till `ORE_PER_SEK`", men uppgiften är
utförd: `grep -n '\b100\b' src/core/entry.js` ger noll träffar (exit 1), och
kommentarerna på rad 249 och 262–263 lyder `v * ORE_PER_SEK` respektive
`Math.round(v * ORE_PER_SEK) / ORE_PER_SEK`. Raden är oförändrad i commit
`af59b83` — paket 4 lämnades vidare med en öppen uppgift i beslutsloggen som inte
är öppen.
**Varför:** Lärdomen 2026-09-02 om exakt den här raden formulerade sin regel som
en kontroll byggaren gör "innan paket N lämnas vidare", och paket 3 var redan
lämnat när lärdomen skrevs. Ingen agent äger därmed en `**Kvar i paket N:**`-rad
för ett paket som redan är avslutat, och kontrollen `grep -n "Kvar i paket N"`
kördes i paket 4 bara mot `N = 4` (noll träffar) — inte mot filen som helhet.
Femte gången `ARKITEKTUR.md` innehåller ett påstående om koden som koden inte
uppfyller.
**Regel framåt:** Kör `grep -n "Kvar i paket" ARKITEKTUR.md` utan siffra innan
varje paket lämnas vidare, inte `grep -n "Kvar i paket N"`. För varje träff med
ett nummer som är lägre än eller lika med det pågående paketet: kör kommandot som
visar om uppgiften kvarstår och klistra in utdatan, eller skriv om raden till
`**Utfört i paket N:**`. En rad som pekar på ett redan avslutat paket är alltid
ett fel och rättas av den agent som hittar den, oavsett vilket paket som pågår.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-04 — test: två konstruktioner i storage.js körs aldrig och överlever mutation
**Vad gick fel:** Två delvillkor i `src/server/storage.js` kan inte nås av någon
indata. (1) `catch (error) { throw asStorageError(error); }` på rad 141–143: byts
`try { await work; } catch … }` mot enbart `await work;` ger `npm test`
`tests 170, pass 170, fail 0` och exit 0; instrumenteras grenen med en utskrift
som bara körs när `error` *inte* redan är en `StorageError` skrivs den noll gånger
under hela sviten. (2) Den andra handlern i `writeQueue.then(() => writeToDisk(…),
() => writeToDisk(…))` på rad 133–136: tas den bort ger `npm test` `pass 170,
fail 0` och exit 0, och instrumenterad med en `console.log` först i handlern ger
`grep -c` värdet `0` över hela sviten — `writeQueue` tilldelas alltid
`work.then(() => undefined, () => undefined)` på rad 137 och kan därför aldrig
vara ett avvisat löfte. Testet `ett misslyckat anrop blockerar inte nästa`, som
`ARKITEKTUR.md` rad 1100–1102 motiverar handlern med, passerar utan den.
**Varför:** Båda konstruktionerna försvarar mot ett fel som en annan rad i samma
funktion redan har omöjliggjort: `writeToDisk` lindar varje `node:fs`-anrop och
sväljer sitt eget städningsfel, så den kan bara avvisa med `StorageError`, och
neutraliseringsraden 137 gör kedjan omöjlig att avvisa. Mutationskravet i
`ARKITEKTUR.md` rad 1340–1345 räknar upp "rad 1–7, det unika temporärnamnet,
löfteskedjan och `finally`-städningen" men inte de två felhanterarna, så de kördes
aldrig. Fjärde gången ett delvillkor visar sig oskyddat av något test (2026-08-23
fältantalskontrollen, 2026-08-24 `typeof value.amountSek !== 'number'`, 2026-09-02
summaspärren i loopen).
**Regel framåt:** Mutationslistan ska genereras ur filen, inte ur dokumentet:
räkna upp varje `if`, varje `catch` och varje andra argument till `.then` i den
ändrade filen och pröva dem en och en. En felhanterare som överlever mutation
prövas därefter med instrumentering — lägg en `console.log` först i grenen och kör
hela sviten. Skrivs raden noll gånger ska den tas bort, eftersom en gren som ingen
indata når inte är ett skydd utan en osann uppgift om vad koden hanterar.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-04 — lagring: en pågående loadEntries får saveEntries att misslyckas med EPERM
**Vad gick fel:** `ARKITEKTUR.md` rad 1110–1111 slår fast "**`loadEntries` köas
inte.** `rename` byter filen i ett enda steg, så en läsning ser antingen hela den
gamla eller hela den nya filen", men på den här maskinen misslyckas *skrivningen*
när en läsning pågår. Körd: en datafil på 37 577 818 byte (200 000 poster),
`const load = loadEntries(); const save = saveEntries(liten);` följt av
`Promise.allSettled`, 25 omgångar — resultatet blev `saveEntries lyckades 0,
avvisade 25`, samtliga med `StorageError: Datafilen kunde inte sparas: den nya
filen gick inte att byta in: <sökväg> / cause=EPERM`. Kön i `storage.js`
serialiserar bara skrivning mot skrivning; ingenting hindrar en läsning från att
hålla `entries.json` öppen medan `fs.rename` körs. Projektets eget testfall
`rad 6: rename som misslyckas` provocerar felet på exakt samma sätt
(`await fs.open(filePath, 'r')`), så beteendet är känt — men bara som ett OS-fel
att översätta, inte som något appen själv kan orsaka.
**Varför:** Meningen om `rename` beskriver vad *läsaren* ser och användes som skäl
för att läsningen inte behöver köas. Att `rename` på Windows kastar `EPERM` när
målfilen är öppen i en annan handtagare gör att slutsatsen inte gäller åt andra
hållet, och den riktningen skrevs aldrig ut. Paket 5 gör `GET /api/entries`
(`loadEntries`) och `POST /api/entries` (`saveEntries`) mot samma fil i samma
process, så en användare som klickar Spara medan listan läses om når fallet utan
att göra något ovanligt; användaren får då ett felmeddelande trots att ingenting
är fel med datan.
**Regel framåt:** En kö som ska skydda en fil ska omfatta varje operation som rör
filen, inte bara de som skriver: lägg `loadEntries` i samma `writeQueue` som
`saveEntries`, eller gör om `fs.rename` till ett anrop med omförsök (`EPERM` och
`EBUSY`, minst 3 försök med växande paus) och skriv ut i `ARKITEKTUR.md` vilket av
de två som gäller. Ett påstående om att en samtidig operation är ofarlig ska
skrivas åt båda hållen ("läsaren ser X" *och* "skrivaren får Y") och båda hållen
ska ha ett testfall: `Promise.allSettled([saveEntries(b), loadEntries()])` med en
datafil stor nog att läsningen fortfarande pågår när `rename` körs, kört minst 20
omgångar, ska ge `fulfilled` för båda.

### 2026-09-04 — test: storage-testet hänger för alltid i stället för att falla när barnprocessen inte startar
**Vad gick fel:** `tests/storage.test.js` rad 763 startar barnet med den
cwd-relativa sökvägen `fork('tests/helpers/interrupted-save.js', …)` och väntar på
rad 767 med `await new Promise((resolve) => child.once('message', resolve))`, utan
lyssnare på `exit` eller `error` och utan timeout. Körd från en annan katalog:
`node --test "C:\…\tests\storage.test.js"` skriver
`Error: Cannot find module 'C:\…\scratchpad\tests\helpers\interrupted-save.js'`
med `code: 'MODULE_NOT_FOUND'`, barnet dör utan att skicka `startar`, och
körningen hänger — en första körning avbröts efter 10 minuter utan exitkod, en
andra avbröts av `timeout 60` med `EXIT=124` och testfilen redovisad som
`✖ …\tests\storage.test.js (59994.4315ms)`.
**Varför:** Barnprocessens sökväg löses mot `process.cwd()`, medan testfilens egna
importer löses mot filens plats — de två sätten sammanfaller bara så länge
kommandot körs från projektroten. `child.once('message', …)` är rätt villkor för
det lyckade fallet men det enda villkoret som är uppsatt, så varje sätt för barnet
att dö före sitt första meddelande (saknad modul, syntaxfel, kastande import,
`saveEntries` som avvisar) blir en oändlig väntan i stället för ett fallerande
test. En hängning är sämre än ett fel: den ger ingen exitkod alls, och kravet i
`CLAUDE.md` att kontrollera utgångskoden går då inte att uppfylla.
**Regel framåt:** Bygg alltid en barnprocess sökväg ur `import.meta.url`
(`fileURLToPath(new URL('./helpers/interrupted-save.js', import.meta.url))`),
aldrig ur `process.cwd()`. Varje `await` på ett `child.once('message', …)` ska
kapplöpa mot både `child.once('exit', …)`, `child.once('error', …)` och en
`AbortSignal.timeout`, och vinner något annat än meddelandet ska testet falla med
barnets `exitCode`, `signalCode` och `stderr` i felmeddelandet. Innan ett test med
`fork` räknas som skrivet ska det köras en gång med barnets filnamn medvetet
felstavat och ge exit 1 inom några sekunder.

### 2026-09-07 — test: ett misslyckat assert.deepEqual användes som grenval och sprängde testprocessens minne
**Vad gick fel:** SIGKILL-testet i `tests/storage.test.js` valde gren med ett
*misslyckat* `assert.deepEqual` i en `try`/`catch`
(`let gammal = true; try { assert.deepEqual(after, before); } catch { gammal = false; }`),
och när barnets skrivning hann bli klar jämfördes 20 000 poster mot 2: Node byggde
då en fullständig `util.inspect`-diff innan `AssertionError`-meddelandet
trunkerades. Mätt på Node v24.19.0 på den här maskinen: `count=20000` gav
`52700 ms`, ett meddelande på `30 tecken` och `rss +9187 MB`; `count=40000` gav
`36575 ms` och `+1712 MB`; `count=80000` gav `40941 ms` och `+24 MB`; 20 *lyckade*
`deepEqual` på 20 000 poster tog `115 ms` och `+15 MB`, och 20 misslyckade på 2
poster tog `8 ms`. Ett enda sådant kast blåste upp testprocessen till cirka 9 GB,
varpå nästa `fork` föll med
`[Error: spawn UNKNOWN] { errno: -4094, code: 'UNKNOWN', syscall: 'spawn' }` i hela
sviten och med `exitCode=3221226505, stderr=[low_level_alloc.cc : 554] RAW: Check
new_pages != nullptr failed: VirtualAlloc failed` när bara testfilen kördes.
Sviten tog `168,6 s` och slutade med `fail 1` och exit 1.
**Varför:** `assert.deepEqual` är en *assertion*, inte ett predikat: dess kastväg
är byggd för att producera en läsbar rapport, inte för att svara ja eller nej
billigt. Att fånga kastet och kasta bort felet betalar hela rapportkostnaden och
använder ingenting av den — meddelandet på 30 tecken visar att diffen byggdes och
sedan slängdes. Symtomet tolkades dessutom bakvänt: räknaren `barnetsLista` såg ut
att behöva fler poster, så `entryCount` fördubblades enligt punkt 7 till 40 000 och
80 000, vilket ökade den indatastorlek som orsakade minnesbristen i stället för att
minska den. Med grenvalet lagat räcker 20 000 poster och ett enda försök.
**Regel framåt:** Använd aldrig ett fångat `assert.*`-kast som grenval eller som
predikat. Välj gren på ett billigt värde — `after.length`, en `id`-sträng, en
hash — och låt `assert.deepEqual` stå kvar bara som den assertion som avgör
utgången. Ett `try { assert… } catch {}` i en testfil är ett fel oavsett hur
snabbt det råkar gå i dag. Innan en räknare i ett tidsberoende test tolkas som
"för lite indata": mät först kostnaden för den gren som körs, och kräv ett
mätvärde innan indatastorleken ändras — en fördubbling som gör körtiden längre i
stället för kortare betyder att diagnosen är fel, inte att fördubblingen ska
upprepas.

### 2026-09-07 — process: paket 4 lämnades vidare en gång med fail 1 och exit 1
**Vad gick fel:** Paketet redovisades som klart trots att `npm test` slutade med
`fail 1` och exit 1 (sviten tog 168,6 s och föll på SIGKILL-testet efter
minnesbristen ovan), medan `CLAUDE.md` kräver "`npm test` ska ge `fail 0` och
exit 0 innan ett paket lämnas vidare — kontrollera utgångskoden, inte bara
utskriften".
**Varför:** Den körning som redovisades var inte den sista körningen. Utfallet
tolkades som ett miljöproblem ("spawn UNKNOWN") i stället för som ett resultat av
koden i paketet, och ett kraschartat fel med en engelsk OS-text ser ut att komma
utifrån även när det är testfilens egen minnesförbrukning som orsakar det.
**Regel framåt:** Den körning som redovisas ska vara den sista körningen, och
raden `ℹ fail` tillsammans med `EXIT=` ska klistras in ordagrant från just den.
Ger `npm test` exit 1 av något skäl — även ett som ser ut att komma från
operativsystemet (`spawn UNKNOWN`, `VirtualAlloc failed`, `EPERM`) — är paketet
inte klart förrän orsaken är hittad i projektets egen kod eller motbevisad med en
körning som visar exit 0 tre gånger i rad.

### 2026-09-07 — lagring: felsökningsutskrifter lämnades kvar i src/server/storage.js
**Vad gick fel:** `src/server/storage.js` rad 149 och 156 innehåller
`console.log('INSTRUMENT andra handlern')` respektive
`console.log('INSTRUMENT catch efter await work')` i arbetsträdet — den
instrumentering lärdomen 2026-09-04 begärde, kvarlämnad i den kod paket 5 ska
bygga vidare på. `grep -rn "INSTRUMENT" src tests ARKITEKTUR.md` ger de två
raderna och inget annat, och hela sviten skriver `INSTRUMENT` noll gånger
(`grep -c INSTRUMENT` på loggen från en körning med `tests 171, pass 171, fail 0`
och exit 0). De två grenarna är alltså fortfarande oåtkomliga, precis som
lärdomen 2026-09-04 mätte, och de togs inte bort: mutationen "ta bort den andra
handlern i `ioQueue.then`" ger `tests 171, pass 171, fail 0` och exit 0, och
mutationen "byt `try { await work; } catch { … }` mot enbart `await work;`" ger
samma sak.
**Varför:** Lärdomen 2026-09-04 gav två steg — instrumentera, och ta bort raden om
den skrivs noll gånger — och bara det första utfördes. Instrumenteringen skrevs
direkt i den riktiga filen i stället för i en kopia, så när mätningen var gjord
fanns inget som skilde utredningskod från kod; ingenting i arbetsgången läser om
diffen mot HEAD innan paketet lämnas, och `npm test` kan inte fälla en
`console.log` i en gren som ingen indata når. Femte gången ett delvillkor i
projektet visar sig oskyddat av något test (2026-08-23 fältantalskontrollen,
2026-08-24 `typeof value.amountSek !== 'number'`, 2026-09-02 summaspärren i
loopen, 2026-09-04 de två konstruktionerna i `storage.js`) — och samma två
konstruktioner som förra gången.
**Regel framåt:** Mutation och instrumentering görs i en kopia av trädet, aldrig i
`src/`. Innan ett paket lämnas vidare körs `git diff HEAD -- src` och varje rad
läses; en rad som innehåller `console.log`, `console.error`, `INSTRUMENT`, `TODO`
eller `FIXME` i `src/` är ett fel och stoppar paketet. En gren som instrumenterats
och skrivits noll gånger ska tas bort i samma paket som mätningen görs — mätningen
är inte klar förrän raden är borta och `npm test` körts om med `fail 0` och exit 0
utan den.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — test: atomicitetsmutationen fäller det utpekade testet i bara hälften av körningarna
**Vad gick fel:** `ARKITEKTUR.md` punkt 6 (rad 1330–1341, skriven i det här
paketet) gör bindande att mutationen "ersätt `writeFile` till temporärfilen plus
`rename` med `await fs.writeFile(filePath, text, 'utf8')`" ska ge exit 1 **och att
det fallerande testet ska vara SIGKILL-testet**, och slår fast att "Faller bara
andra tester medan det här passerar räknas mutationen som överlevd och paketet
lämnas tillbaka". Med mutationen på plats, kört 12 gånger på den här maskinen,
passerade `en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den
nya listan` i 6 körningar och föll i 6. En passerande körning gav
`SIGKILL-försök {"forsok":1,"poster":20000,"tKlarMs":60,"fonsterMs":"0…120",…,"gamlaListan":7,"barnetsLista":13}`
följt av `✔ en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den
nya listan (3450.688ms)`, medan exit 1 kom från `✖ rad 5: writeFile som misslyckas
ger skrivfelet`, `✖ rad 6: rename som misslyckas ger inbytesfelet och lämnar
datafilen orörd` och `✖ ett misslyckat anrop blockerar inte nästa` — alltså exakt
det utfall punkt 6 uttryckligen förbjuder. När testet väl föll var det på den
tredje grenen (`avbrottet efter 38 ms gav varken den gamla eller barnets lista
(0 poster)`), inte på någon av de två `deepEqual` punkt 4 pekar ut.
**Varför:** Det mätta fönstret rättade den ena snedheten — båda grenarna körs nu
(`gamlaListan` 7–10 och `barnetsLista` 10–13 i tre ostörda körningar) — men det gör
inte mutationen upptäckbar, eftersom `fs.writeFile` med en 3,8 MB-sträng trunkerar
och skriver i ett så kort intervall att bara en liten del av fönstret
`0 … 2 × tKlar` landar inuti det. Testets utfallsrum, "gamla listan eller barnets
lista", är dessutom sant för den muterade koden i varje omgång där dödandet missar
det intervallet, så assertionen kan bara fälla mutationen av slump. Tredje gången
atomicitetstestet inte bevisar det det påstår (2026-09-02, testet avbryter aldrig
en skrivning; 2026-09-04, barnet dödas innan skrivningen har börjat).
**Regel framåt:** En mutationsdetektor som beror på tur ska köras tills utfallet är
känt, inte en gång: kör den utpekade mutationen minst 10 gånger och skriv in i
`ARKITEKTUR.md` hur många av körningarna som fällde det utpekade testet. Fäller
den inte alla 10 är testet inte ett skydd mot mutationen och paketet lämnas
tillbaka. Ska ett `SIGKILL` fälla en icke-atomär skrivning måste dödandet träffa
tiden *mellan* trunkeringen och den sista byten — antingen genom att barnet skriver
i mätbart många omgångar (`fs.open` plus upprepade `write` av kända block, med
blockstorleken mätt) eller genom att testet också asserterar på ett tillstånd som
bara atomiciteten ger, till exempel att `entries.json` byte-jämförd med före är
oförändrad i varje omgång där barnets lista inte vann.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — test: den dyra diffen togs bort ur grenvalet men står kvar i grenkropparna och i det nya överlappningstestet
**Vad gick fel:** Rättningen flyttade `assert.deepEqual` från grenvalet till
grenkroppen, men kostnaden ligger i jämförelsen, inte i placeringen, och fyra
assertioner i `tests/storage.test.js` jämför fortfarande listor där ett verkligt
fel ger en fullständig diff. Mätt på den här maskinen, Node v24.19.0:
`assert.deepEqual(after, childList)` (rad 933, båda listorna 20 000 poster) tar
`60 344 ms` och `+8922 MB rss` när hälften av posterna skiljer och `63 340 ms` och
`+9353 MB` när alla skiljer — meddelandet är i båda fallen `30 tecken`. I det nya
testet `en läsning och en skrivning som överlappar` tar
`assert.deepEqual(results[0].value, stor, …)` (rad 852, 3 poster mot 20 000)
`48 595 ms` och `+8734 MB`, och `assert.deepEqual(await loadEntries(), b, …)`
(rad 855, 20 000 poster mot 3) `46 534 ms` och `+9333 MB`. Skiljer bara en enda
post kostar samma jämförelse `200 ms` och `+119 MB` — kostnaden följer diffens
storlek, inte listans.
**Varför:** Kommentaren på rad 918–928 mäter och motiverar bara *grenvalet* och
drar slutsatsen att grenkroppen är säker eftersom "grenvalet sker på after.length,
aldrig på ett kast". Men grenkroppen är samma anrop mot samma listor: den är
billig bara så länge den lyckas, och den körs som felmeddelande bara när något
redan är trasigt — alltså i precis det läge där ett läsbart svar är hela poängen.
Det nya överlappningstestet skrevs i samma paket, med samma listor på 20 000
poster, utan att mätningen tillämpades på det.
**Regel framåt:** En `assert.deepEqual` mot en lista med fler än 1 000 element ska
föregås av en billigare assertion som fäller först och skriver ut skillnaden
själv: asserta `actual.length`, och därefter det första avvikande indexet med
index och den enskilda posten i meddelandet. Först när de två har passerat får
`assert.deepEqual` stå kvar som slutkontroll. Regeln gäller varje gren, inte bara
den som råkar mätas: när en kostnad har mätts för ett anrop ska
`grep -n "assert.deepEqual" <testfil>` köras och varje träff bedömas mot samma
mätvärde i samma paket.

### 2026-09-07 — dokumentation: ARKITEKTUR.md förbjuder den millisekundkonstant LARDOMAR.md kräver
**Vad gick fel:** `ARKITEKTUR.md` rad 1319 slår fast "Inget millisekundtal får stå
som konstant i testkoden eller i den här filen", medan `tests/storage.test.js`
rad 114 har `const CHILD_START_TIMEOUT_MS = 30000;` — den timeout lärdomen
2026-09-04 (storage-testet hänger för alltid) gör obligatorisk. `ARKITEKTUR.md`
nämner inte hängningsspärren alls: `grep -n "AbortSignal\|timeout" ARKITEKTUR.md`
ger noll träffar. Två bindande dokument ger alltså motsatta besked om samma rad,
och `CLAUDE.md` kräver att `ARKITEKTUR.md` ändras först och byggs sedan.
**Varför:** Förbudet formulerades under punkt 3, som handlar om dödandetiden, men
skrevs som ett absolut villkor om "testkoden" i stället för om just dödandetiden.
När byggaren därefter lade till hängningsspärren från en annan lärdom fanns ingen
plats i dokumentet där den hörde hemma, och undantaget skrevs varken in eller
redovisades. Ett förbud som är bredare än sitt skäl gör nästa granskare oförmögen
att avgöra om en konstant är ett fel eller en nödvändighet.
**Regel framåt:** Skriv ett förbud i `ARKITEKTUR.md` med den roll det gäller, inte
med den datatyp det råkar träffa: här "ingen dödandetid får stå som konstant",
inte "inget millisekundtal". Inför ett paket en konstruktion som en lärdom kräver
men som `ARKITEKTUR.md` inte nämner ska dokumentet få ett eget stycke om den
konstruktionen — med syfte, värde och det körda utfallet — innan koden skrivs. Kör
`grep` på förbudets nyckelord (`millisekund`, `konstant`, `får aldrig`, `får
inte`) mot den fil förbudet gäller, i samma paket som förbudet skrivs.

### 2026-09-07 — dokumentation: punkt 1 i atomicitetstestets kravlista uppfylls inte av testet
**Vad gick fel:** `ARKITEKTUR.md` rad 1286–1288 inleder med "Kraven är bokstavliga"
och kräver i punkt 1 att testet "skapar utgångsläget genom att anropa
`saveEntries` och läser därefter filens byte med `fs.readFile(filePath)` (en
`Buffer`)", men SIGKILL-testet (`tests/storage.test.js` rad 862–950) läser aldrig
filens byte: `grep -n "fs.readFile" tests/storage.test.js` ger 14 träffar, alla på
rad 294–753, ingen inom testet. Utgångsläget jämförs i stället med `loadEntries()`
och `deepEqual`. Kravet var ouppfyllt redan i commit `af59b83` och blev det inte
mindre av att just det testet skrevs om i sin helhet i det här paketet.
**Varför:** Omskrivningen utgick från punkt 3, 4, 6 och 7, som var de punkter
lärdomen 2026-09-04 pekade ut, och de punkter som inte ändrades lästes inte om mot
den nya testkoden. Punkt 1:s byte-jämförelse blev dessutom svår att uppfylla när
utgångsläget skrivs om före varje omgång, men det beslutet togs i koden i stället
för i dokumentet. Sjätte gången `ARKITEKTUR.md` innehåller ett krav eller ett
påstående som koden inte uppfyller.
**Regel framåt:** Skrivs ett test om ska varje punkt i den kravlista som styr
testet läsas mot den nya koden, inte bara de punkter uppdraget gäller — numrera
punkterna i redovisningen och skriv `uppfylld av rad N` eller `struken, skäl` för
var och en. Går en punkt inte längre att uppfylla ska den strykas ur
`ARKITEKTUR.md` med skälet utskrivet innan koden lämnas vidare; en kravlista som
inleds med "Kraven är bokstavliga" får aldrig innehålla en punkt som ingen kod
uppfyller.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — dokumentation: en byggarinstruktion i beslutsloggen pekar på writeQueue, som inte längre finns
**Vad gick fel:** `ARKITEKTUR.md` rad 2410 säger fortfarande "**Byggaren ska:**
bygga namnet som `` `${filePath}.${process.pid}.${randomUUID()}.tmp` ``, utöka
`writeQueue` synkront före funktionens första `await` …", men variabeln
`writeQueue` finns inte i koden: `grep -rn "writeQueue" src tests` ger noll
träffar, och samma paket döpte om den till `ioQueue` (rad 1097–1099 skriver ut
bytet). En byggare som följer rad 2410 bokstavligt skapar en andra kö.
**Varför:** Omdöpningen söktes upp i de avsnitt som beskriver kön och i
gränssnittsblocket, men inte i beslutsloggen, där det gamla namnet står inuti en
instruktion i presens. Regeln från 2026-09-02 ("funktionsnamnet ska först sökas i
hela filen, och varje träff antingen strykas eller skrivas om") tillämpades på
avsnitten men inte på hela filen, och `**Byggaren ska:**`-raderna räknades som
historik trots att de är skrivna som order.
**Regel framåt:** Byter ett namn i `src/` ska `grep -n "<gamla namnet>"
ARKITEKTUR.md` köras och varje träff åtgärdas: en beskrivning skrivs om till det
nya namnet, en historisk mening skrivs om i dåtid med bytet utskrivet, och en
`**Byggaren ska:**`-rad skrivs alltid om till det nya namnet — den är en order,
aldrig historik. Redovisa `grep`-utdatan före och efter i paketet.

### 2026-09-07 — process: paket 5 och 6 byggdes i arbetsträdet medan paket 4 låg hos granskaren
**Vad gick fel:** När granskningen av paket 4 började visade `git status` fem
ändrade filer och inga ospårade. Under granskningen dök `src/server/api.js`
(185 rader), `src/server/server.js` (108 rader), `src/web/index.html`,
`src/web/app.js`, `src/web/style.css` och katalogen `.scratch/` med `t.mjs` upp som
ospårade filer, med skrivtider `2026-09-07 11:18–11:23` — alltså paket 5 och paket
6 byggda ovanpå ett paket 4 som samtidigt granskades och som i den här
granskningen visade sig ha felsökningsutskrifter kvar i `src/server/storage.js`
och en mutation som överlever i hälften av körningarna. `CLAUDE.md` säger "En
uppgift i taget. Bygg inte vidare på något som inte är verifierat" och "Kör alltid
`granskare` innan ett arbetspaket räknas som klart". `.scratch/t.mjs` ligger
dessutom i projektroten utan att stå i `.gitignore` (`cat .gitignore` ger
`node_modules/`, `.env`, `*.log`), så ett `git add -A` skulle checka in den.
**Varför:** Granskningen är ett steg i arbetsgången men blockerar ingenting: inget
i kedjan hindrar nästa agent från att starta medan granskaren fortfarande kör, och
utredningsskript får läggas var som helst eftersom bara `node_modules/`, `.env`
och `*.log` är ignorerade. Följden är att rättningarna från den här granskningen
ska in i en fil (`src/server/storage.js`) som två senare paket redan importerar.
**Regel framåt:** Ett paket får inte startas medan granskaren av det föregående
paketet fortfarande kör: granskningen avslutas med ett skriftligt besked
(godkänt/tillbaka till byggaren), och först det beskedet startar nästa paket.
Kontrollera med `git status --porcelain` före och efter en granskning och kräv
samma lista. Utredningsskript läggs i en katalog som står i `.gitignore` — lägg
till `.scratch/` där innan nästa sådant skript skrivs — aldrig i projektroten och
aldrig i `src/`.

### 2026-09-07 — dokumentation: rättningen av "beskriver kod som inte längre ser ut så" gjordes till hälften och den falska raden står kvar
**Vad gick fel:** `ARKITEKTUR.md` rad 289–291 säger fortfarande "I dagens
`src/core/entry.js` står villkoret skrivet för hand på båda ställena; de två
raderna ska ersättas av två anrop till `isValidEntryId`", men koden anropar
`isValidEntryId` på rad 147 (`createEntry`) och rad 194 (`isEntry`) och har ingen
handskriven kopia: `grep -n "trim().length" src/core/entry.js` ger en enda träff,
rad 168, inuti `isValidEntryId` själv. Exakt den meningen står redan rapporterad i
den här filen 2026-08-23 ("dokumentation: ARKITEKTUR.md beskriver kod som inte
längre ser ut så"); postens andra halva (importraden i gränssnittsblocket) är
rättad — rad 1784 lyder numera
`import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate }` — medan den här halvan
är oförändrad sedan commit `10fe469`, enligt en körning av `git log -S` på
meningens första ord. Raden har alltså överlevt paket 3, paket 4 och paket 5.
**Varför:** Lärdomen namngav två ställen, ett av dem rättades, och posten
räknades därefter som avklarad. Regeln var skriven som en engångskontroll "innan
ett paket lämnas vidare", och den som utför rättningen har inget sökbart
kännetecken att gå på: en falsk mening om koden ser ut precis som en sann. Det är
samma grundorsak som posten 2026-09-04 om `**Kvar i paket 3:**` — en öppen
instruktion skriven i presens blir falsk i samma stund byggaren utför den, utan
att något i arbetsgången tvingar fram en omläsning av just den raden.
**Regel framåt:** Kör `grep -n "I dagens" ARKITEKTUR.md` och
`grep -n "ska ersättas" ARKITEKTUR.md` innan varje paket lämnas vidare, precis som
`grep -n "Kvar i paket"`, och åtgärda varje träff: en utförd instruktion skrivs om
i dåtid ("Ersattes i paket N av ...") eller stryks, annars klistras körningen som
visar att den kvarstår in i redovisningen. En post i `LARDOMAR.md` som räknar upp
flera ställen är åtgärdad först när varje uppräknat ställe har körts mot koden och
utfallet redovisats — rätta aldrig ett av två och gå vidare.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — api: två snabba klick tappar en post eller en borttagning, och båda anropen svarar att det gick bra
**Vad gick fel:** `handleCreate` och `handleDelete` i `src/server/api.js` (rad
151–157 respektive 161–181) gör `await loadEntries()` och därefter
`await saveEntries(...)` som två skilda steg i `ioQueue`, så två överlappande
anrop läser samma lista och skriver var sin version av den. Körda fall på den här
maskinen, mot en riktig server startad med `listen(0)`:
`Promise.all([POST Klick A, POST Klick B])` i 20 omgångar gav 20 av 20 omgångar
där bara en post fanns kvar på disk (`["Klick B"]`) trots att båda svaren var
`201` med var sin `entry`; `Promise.all([DELETE a, DELETE b])` mot tre poster i
20 omgångar gav 19 av 20 omgångar där bara den ena borttagningen blev av, båda
svaren `204`. Genom `src/web/app.js` med en DOM-attrapp, kört tre gånger: poster
`Hyra, El, Bredband`, ett klick på Ta bort för `Hyra` och ett för `El` gav varje
gång både vyn och filen `["Hyra","Bredband"]` med tom felruta — användaren ser
posten hen just tog bort ligga kvar utan ett ord om varför. `src/web/app.js` har
ingen spärr mot dubbelklick: `grep -n "disabled" src/web/*.js src/web/*.html` ger
noll träffar, så både Spara och Ta bort kan skicka två anrop.
**Varför:** Kön i `storage.js` gör varje enskild operation atomär, och
`ARKITEKTUR.md` rad 1108–1113 skriver ut det som facit ("sista anropet vinner").
Just det facit gör en läs-ändra-skriv-sekvens osäker: anrop två läser före anrop
ett har skrivit och skriver sedan över det. `ARKITEKTUR.md` säger ingenting om
två samtidiga HTTP-anrop, och varken `tests/api.test.js` eller
`tests/server.test.js` har ett fall där två anrop är i luften samtidigt
(`grep -c "Promise.all" tests/api.test.js` ger `0`). Lärdomen 2026-09-02 (två
överlappande `saveEntries`) förutsåg exakt det här: "Paket 5 gör en `POST` per
klick, så två snabba klick på Spara räcker för att nå det" — men rättningen
gjordes bara i det lager lärdomen mätte, och ingen prövade om symtomet fanns kvar
ett lager upp.
**Regel framåt:** En läs-ändra-skriv-sekvens mot användarens datafil ska utföras
som ett steg i `ioQueue`, aldrig som två. `storage.js` ska få en export av formen
`updateEntries(mutera)` som läser, kör `mutera(entries)` och skriver innanför
samma köplats, och `api.js` får därefter inte anropa `loadEntries` och
`saveEntries` efter varandra i samma hanterare. Testfallen är obligatoriska i
paket 5 och körs minst 20 omgångar var: `Promise.all([POST a, POST b])` ska ge två
`201` och två poster på disk, och `Promise.all([DELETE a, DELETE b])` mot tre
poster ska ge två `204` och exakt en post kvar. Knappen som utlöste anropet ska
dessutom sättas till `disabled` tills svaret kommit, och paketet redovisar en
körning som visar att ett andra klick inte skickar något anrop.

### 2026-09-07 — server: ett enda HTTP-anrop dödar hela appen, och användaren får ett engelskt stackspår
**Vad gick fel:** `handleRequest` i `src/server/server.js` rad 82 kör
`new URL(req.url, ...)`, och `createServer` på rad 93 anropar
`handleRequest(req, res)` utan `catch`. En förfrågan i absolut form med en ogiltig
värddel får `new URL` att kasta, avvisningen blir ohanterad och Node avslutar
processen. Körd mot en server startad med `node src/server/server.js`:
förfrågningsraden `GET http://[v1.x]/ HTTP/1.1` gav klienten "stängd utan svar",
processen dog med `EXIT=1` och skrev
`TypeError: Invalid URL ... at handleRequest (.../src/server/server.js:82:24)`
med `code: 'ERR_INVALID_URL'`, och nästa `curl` mot samma port gav `000`. Fem av
sex prövade rader gjorde samma sak (`http://[v1.x]/`, `http://[::1`,
`https://[fe80::1%25]/`, `http://%/`, `foo://[bad]/x`); `http://a b/` stoppades av
HTTP-parsern och gav `400`. Med en `unhandledRejection`-lyssnare installerad
svarade servern i stället aldrig alls: anropet hängde i 2,5 sekunder och sockeln
lämnades öppen. `ARKITEKTUR.md` rad 1085 slår fast "Servern får aldrig krascha på
ett trasigt lager" — samma krav finns inte skrivet för ett trasigt anrop, och det
är det som saknas.
**Varför:** `handleRequest` är `async` men anropas som om den vore synkron, så
varje kast någonstans i anropskedjan blir en ohanterad avvisning i stället för ett
`500`. Feltabellerna i `ARKITEKTUR.md` täcker lagringens fel och API:ts fältfel
men inte serverskiktets egna fel, och det som inte står i en tabell blev inte
byggt — samma grundorsak som posten 2026-09-02 om `saveEntries` och de råa
OS-felen. Ingen prövade heller en förfrågningsrad som inte kommer från en
webbläsare: `tests/server.test.js` skickar sina sonder med `http.request` och
`path:`, som alltid ger en sökväg i origin-form.
**Regel framåt:** En `async` hanterare får aldrig anropas utan felhantering:
`createServer` ska skriva `handleRequest(req, res).catch(...)` och svara `500` med
en svensk text ur en namngiven konstant, aldrig låta felet nå `process`. Sökvägen
ska dessutom läsas ut med `try`/`catch` runt `new URL`, och en förfrågan som inte
går att tolka ska ge `400` med svensk text. Testfallen är obligatoriska och ska
skickas som råa förfrågningsrader över en `net.Socket`, aldrig med
`http.request({ path })`: minst `GET http://[v1.x]/ HTTP/1.1`,
`GET http://[::1 HTTP/1.1` och `OPTIONS * HTTP/1.1`, och varje fall ska asserta att
ett svar kommer och att `GET /api/entries` efteråt fortfarande ger `200`.

### 2026-09-07 — server: npm start på en upptagen port ger tolv rader engelskt stackspår i stället för ett svenskt besked
**Vad gick fel:** `start` i `src/server/server.js` rad 112–118 väntar på
`server.listen(port, HOST, resolve)` utan någon lyssnare på serverns
`error`-händelse. Startas appen när den redan kör avslutas den andra processen med
`EXIT=1` och skriver `node:events:487 throw er; // Unhandled 'error' event` följt
av `Error: listen EADDRINUSE: address already in use 127.0.0.1:3098` och sex rader
stackspår — noll svenska ord, ingen ledtråd om att appen redan kör och ingen
uppmaning att öppna adressen i webbläsaren. Körd: två `node src/server/server.js`
med `PORT=3098`; den första skrev `Hemochekonomi kör på http://127.0.0.1:3098`,
den andra kraschade som ovan. `CLAUDE.md` kräver att all text mot användaren är
svensk, och `npm start` är användarens enda sätt att starta appen.
**Varför:** `listen` rapporterar sitt fel som en händelse och inte som en
avvisning, så `await new Promise((resolve) => server.listen(...))` fångar
ingenting: löftet uppfylls aldrig och Node kastar händelsen i stället.
`ARKITEKTUR.md` beskriver portvalet i detalj (facittabellen för `resolvePort`) men
har ingen rad alls för vad som händer när porten inte går att binda, och det som
inte står i en tabell blev inte byggt. Att starta appen två gånger är dessutom det
första en användare gör som inte märker att den redan kör — felet ligger i det
vanligaste felgreppet, inte i ett kantfall.
**Regel framåt:** Varje `await` på en `listen` ska kapplöpa mot serverns
`error`-händelse: `server.once('error', reject)` i samma `new Promise`, och
`EADDRINUSE` översätts till en egen svensk sträng som står i `ARKITEKTUR.md` under
`src/server/server.js` innan koden skrivs — texten ska namnge porten och att appen
troligen redan kör. `ARKITEKTUR.md` ska få en rad per felsituation vid start
(`EADDRINUSE`, `EACCES`, övrigt), på samma form som "Beteende vid skrivning".
Testfallet är obligatoriskt: bind en port med `listen(0)`, kör `start(<den
porten>)` och asserta att anropet avvisas med den svenska texten och inte kraschar
processen.

### 2026-09-07 — dokumentation: en kodkommentar i server.js påstår "uppmätt" något som en mutationskörning motsäger
**Vad gick fel:** `src/server/server.js` rad 126–130 lyder "Den port som verkligen
bands, läst ur `server.address()` efter listen — aldrig `DEFAULT_PORT` skriven in
i strängen. Uppmätt: de två uttrycken går inte att skilja åt av något testfall".
De går att skilja åt: mutationen `const { port } = server.address();` →
`const port = DEFAULT_PORT;` ger `EXIT=1` och
`✖ node src/server/server.js startar servern, skriver sin rad och svarar på /
(30021.5516ms)`, och samma sak med literalen `3000`
(`✖ ... (30015.4591ms)`). Det uttryck som verkligen överlever mutation är
`resolvePort(process.env)` (`EXIT=0`, `fail 0`), och det är inte det kommentaren
namnger. `ARKITEKTUR.md` rad 2122–2124 säger dessutom motsatsen till kommentaren:
"`<port>` är `server.address().port` ... inte siffran `3000` skriven i strängen.
Med `PORT` osatt är de två samma tal" — alltså att de skiljer sig när `PORT` är
satt, vilket är precis vad autostarttestet gör.
**Varför:** Kommentaren blandar ihop två olika alternativuttryck. Motiveringen den
ger ("start() här alltid får sin port av `resolvePort` och därför binder exakt det
talet") är sann om `resolvePort(process.env)` men falsk om `DEFAULT_PORT`, som
skiljer sig från `resolvePort` så snart `PORT` är satt — och testet sätter `PORT`.
Ordet "Uppmätt" skrevs ut utan att just den mutation kommentaren namnger hade
körts. Det är samma grundorsak som posterna 2026-08-18 (testkommandot),
2026-08-23 (flyttalsgränsen), 2026-09-02 (exakthetspåståendet) och 2026-09-02
(exempelsträngen för `formatSek`): ett påstående härlett ur resonemang och skrivet
som en mätning.
**Regel framåt:** En kodkommentar som innehåller "uppmätt", "mätt" eller "går inte
att skilja åt" ska namnge den exakta mutationen den bygger på och utfallet, i
formen `mutation: <gammalt> -> <nytt> ger EXIT=<kod>`. Överlever bara ett av flera
möjliga alternativuttryck ska kommentaren skriva ut vilket, och kontrollen är att
köra varje namngivet alternativ. Motsäger kommentaren en mening i `ARKITEKTUR.md`
gäller `ARKITEKTUR.md`, och paketet lämnas tillbaka.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — dokumentation: HTTP-API-tabellen utesluter tre av kodens statuskoder
**Vad gick fel:** `ARKITEKTUR.md` rad 2165–2170 är API:ts facittabell. Där står
`GET /api/entries` med enbart `200 { "entries": Entry[] }` och
`DELETE /api/entries/<id>` med enbart `204` och `404`, medan `POST`-raden räknar
upp ett `500` och uttryckligen avgränsar det till "vid internt fel från
`createEntry`". Koden svarar `500` med lagringens svenska text på alla tre vägarna
(`src/server/api.js` rad 121, 155, 166 och 179), och två testfall i
`tests/api.test.js` heter just "en skadad datafil ger 500 med lagringens svenska
text på alla tre vägarna" (rad 329) och "en skrivning som misslyckas ger 500 vid
både POST och DELETE" (rad 347). Tabellen ger alltså ett annat svar än koden och
testerna på frågan vilka statuskoder `GET /api/entries` kan ge.
**Varför:** Lagringens `500` står bara i "Lagring"-avsnittet ("`StorageError`
kastas — den fångas i `api.js`, som svarar `500`"), och när HTTP-API-tabellen
skrevs fördes det inte in där. Avgränsningen i `POST`-raden gör det värre än en
ren utelämning: den läser som en fullständig uppräkning och utesluter aktivt
lagringens `500`. Det är samma fel som posten 2026-09-02 om
`totalYearlyOre`-tabellen — en tabell som ser fullständig ut men inte är det blir
ett andra facit.
**Regel framåt:** En tabell som räknar upp svaren för en väg ska räkna upp alla
statuskoder koden kan ge för den vägen, eller inledas med en mening som pekar ut
var resten står. Kontrollen är mekanisk och körs när en sådan tabell ändras:
`grep -n "sendJson(res, " src/server/api.js` och `grep -n "writeHead(" src/server/*.js`,
och varje statuskod som kan komma ut ur en väg ska finnas på den vägens rad. En
avgränsning av ett svar ("vid internt fel från `createEntry`") får bara stå kvar
om ingen annan kodväg kan ge samma statuskod.

### 2026-09-07 — test: en fjärde hängningsspärr byggdes utan den rad ARKITEKTUR.md kräver för den
**Vad gick fel:** `ARKITEKTUR.md` rad 1680–1689 räknar upp exakt tre tillåtna
tidsberoende villkor i projektet och avslutar "Inget annat villkor får åberopa
något av de tre, och en fjärde hängningsspärr kräver en egen rad här". Paket 5
byggde en fjärde: `tests/api.test.js` rad 240–248 har
`setTimeout(() => resolve('HÄNGDE'), 5000).unref()` i en `Promise.race` med
`assert.notEqual(utfall, 'HÄNGDE', ...)`, och kommentaren på rad 237–239 åberopar
just det skäl de tre undantagen har ("Tidsgränsen är ingen assertion på körtid
utan ett skydd mot en hängning"). Någon rad i `ARKITEKTUR.md` finns inte:
`grep -n "5000\|Promise.race\|bryter anropet\|avbrutet anrop" ARKITEKTUR.md` ger
noll träffar. Talet står dessutom som en bar literal, medan de två andra
hängningsspärrarna ska vara en namngiven konstant på minst 30 000 ms
(`CHILD_START_TIMEOUT_MS`).
**Varför:** Undantagslistan skrevs som en uppräkning av de spärrar som fanns när
den skrevs, och paket 5 tillförde en spärr i en testfil som inte fanns då. Kravet
att en fjärde spärr kräver en egen rad är en skyldighet för den som lägger till
den, men ingenting i arbetsgången läser den meningen när en ny testfil skrivs —
samma mönster som posten 2026-09-07 om millisekundförbudet, där `ARKITEKTUR.md`
och `LARDOMAR.md` gav motsatta besked om samma rad.
**Regel framåt:** Innan en testfil lämnas vidare körs
`grep -n "setTimeout\|AbortSignal.timeout\|Promise.race\|performance.now" tests/<fil>`
och varje träff jämförs mot undantagslistan i `ARKITEKTUR.md` under "Inget test
asserterar på körtid". En träff utan rad där stoppar paketet: antingen skrivs
raden in i `ARKITEKTUR.md` först — med syfte, värde och skälet till att spärren
inte kan påverka utfallet av ett prov som blir av — eller så tas konstruktionen
bort. Varje hängningsspärr skrivs som en namngiven konstant i testfilen, aldrig
som en literal, och med minst samma värde som den strängaste spärren i projektet.

### 2026-09-07 — gränssnitt: withoutField-grenen i app.js kan inget serversvar nå
**Vad gick fel:** `showErrors` i `src/web/app.js` rad 94–108 samlar varje
`fieldError` vars `field` saknar ett formulärelement i `withoutField` och visar
dem i den allmänna felrutan, men inget svar servern kan producera fyller den
listan. `validateEntryDraft` i `src/core/entry.js` rapporterar bara fälten `name`,
`amountSek`, `interval`, `startDate` och `category` (rad 89, 96, 103, 110, 117) —
alla fem har ett `#error-<fält>` i `index.html` — och det enda sjätte fältet, `id`
(rad 148), plockas ut av `src/server/api.js` rad 142–146 och skickas som
`500 { error }` utan `fieldErrors`. `withoutField.length > 0` är alltså alltid
falskt, och `return`-satsen på rad 107 kan aldrig köras. Grenen skyddas inte
heller av något test: `src/web/` har enligt teststrategin bara manuell genomgång,
och den genomgången har ingen gjort — ingen agent kan öppna en webbläsare.
**Varför:** Grenen är byggd efter punkt 6 i ansvarslistan (`ARKITEKTUR.md` rad
2280–2287), som kräver att "varje `fieldError` vars `field` saknar motsvarande
formulärelement" hamnar i den allmänna felrutan. Punkten skrevs innan beslutet att
`id`-felet ger `500` utan `fieldErrors`, och de två besluten stämdes aldrig av mot
varandra: när `id` togs ur `fieldErrors` blev punkt 6:s andra hälft ouppfyllbar.
Sjätte gången en gren i projektet visar sig onåbar (2026-08-23
fältantalskontrollen, 2026-08-24 `typeof value.amountSek`, 2026-09-02
summaspärren, 2026-09-04 de två konstruktionerna i `storage.js`, 2026-09-07 samma
två kvarlämnade), och första gången i en fil som inget automatiskt test rör.
**Regel framåt:** Innan en gren byggs efter en punkt i en ansvarslista ska den
indata som når grenen skrivas ut som ett konkret serversvar i redovisningen. Går
det inte att konstruera ett sådant svar ur koden ska punkten ändras i
`ARKITEKTUR.md` först — här: `fieldErrors` innehåller alltid exakt de fem
formulärfälten, så antingen stryks punkt 6:s andra hälft och `showErrors`
förenklas, eller så ändras `api.js` så att `id`-felet verkligen kan komma som ett
`fieldError`. Kravet "en gren som ingen indata når tas bort" gäller `src/web/`
lika mycket som `src/core/` och `src/server/`, och att en fil bara har manuell
genomgång gör bevisbördan större, inte mindre.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — lagring: två instanser av appen mot samma datafil tappar poster, och appens eget felmeddelande ber användaren starta en till
**Vad gick fel:** `ioQueue` i `src/server/storage.js` är modullokal och skyddar
därför bara mot samtidighet inuti *en* process, men `START_MESSAGES.addressInUse`
i `src/server/server.js` rad 24–25 säger ordagrant "Sätt PORT till ett annat
portnummer om du vill starta en till", och `getDataFilePath` i
`src/server/paths.js` läser inte `PORT` — två instanser delar alltså
`entries.json`. Körd med två `node src/server/server.js` (`PORT=3111` och
`PORT=3112`, samma `HEMOCHEKONOMI_DATA_FILE`): `Promise.all([POST mot 3111,
POST mot 3112])` i 20 omgångar gav **19 av 20 omgångar med bara en post på disk
trots att båda svaren var `201`**, och `Promise.all([DELETE mot 3111, DELETE mot
3112])` mot tre poster gav **19 av 20 omgångar med fel utfall** (båda svaren
`204`, men bara den ena borttagningen blev av). I en körning på 40 omgångar var
5 av 80 svar dessutom `500 {"error":"Datafilen kunde inte sparas: den nya filen
gick inte att byta in: <sökväg>"}` — `EPERM` från `fs.rename` när den andra
processen håller filen öppen.
**Varför:** `ARKITEKTUR.md` rad 1143–1145 slår fast "Två processer som skriver
samtidigt skyddas av det unika temporärnamnet plus `rename`: en av dem vinner
hela filen, och ingen fil blir en blandning", och den meningen används på rad
3218 som skäl att inte införa något fillås. Påståendet är sant om *filens
integritet* och falskt om *användarens data*: att en av dem vinner hela filen
betyder att den andres post är borta. Riktningen "vad förlorar användaren"
skrevs aldrig ut, så den fick inget testfall — `tests/storage.test.js` och
`tests/api.test.js` startar aldrig två processer mot samma fil. Det här är
tredje gången samma symtom dyker upp ett lager längre ut efter att det lagats
där det mättes: 2026-09-02 två överlappande `saveEntries` i samma modul,
2026-09-07 två överlappande HTTP-anrop i samma process, och nu två processer mot
samma fil. Varje gång har rättningen lagts i det lager mätningen gjordes i, och
ingen har frågat om symtomet finns kvar ett lager upp.
**Regel framåt:** Ett påstående om att en samtidig operation är ofarlig ska
skrivas som vad *användaren* förlorar, inte som vad *filen* blir, och båda
leden ska ha ett testfall. Ett skydd som är modullokalt får aldrig beskrivas som
skydd mot "två processer": skriv ut i `ARKITEKTUR.md` att `ioQueue` bara gäller
inuti en processinstans, och avgör där uttryckligen ettdera — appen tar ett
fillås vid start och vägrar starta en andra instans mot samma datafil med en
egen svensk text, eller `START_MESSAGES.addressInUse` slutar uppmana användaren
att starta en till och säger i stället att bara en instans i taget får röra
datafilen. Testfallet är obligatoriskt och körs med två `spawn` av
`src/server/server.js` mot samma `HEMOCHEKONOMI_DATA_FILE`, minst 20 omgångar av
`Promise.all([POST mot A, POST mot B])`: två `201` ska ge två poster på disk,
annars ska minst det ena anropet ge ett fel — ett `201` för en post som inte
finns kvar är alltid ett fel.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — dokumentation: fem "inte kört av arkitekten"-markörer står kvar i ARKITEKTUR.md fast körningen är gjord
**Vad gick fel:** `grep -n "inte kört" ARKITEKTUR.md` ger åtta träffar och
`grep -n "inte körd" ARKITEKTUR.md` en till. Fem av dem är körda och stämmer, men
markören är oförändrad. Rad 1517, 2451 och 3809 säger alla att utfallet av
`createServer(() => undefined)` är "arkitektens läsning och **inte kört av
arkitekten**" — granskarens körning mot en riktig server ger
`HTTP/1.1 500 Internal Server Error` med
`{"error":"Ett oväntat fel inträffade. Försök igen."}` på båda anropen, och
testet `det brutna kontraktet: createServer(() => undefined) …` finns i
`tests/server.test.js` rad 613 och passerar. Rad 3691 och 3785 säger att exitkod
`1` från `npm start` mot en upptagen port är "inte kört av arkitekten" — körd:
`EXIT2=1` och en enda rad på stderr, `Port 3099 är upptagen. Hemochekonomi kör
troligen redan på http://127.0.0.1:3099. Sätt PORT till ett annat portnummer om
du vill starta en till.` Byggaren har till och med skrivit in det körda utfallet
i `tests/server.test.js` rad 621–624 ("Körd (utfallet var arkitektens läsning och
okört): båda anropen gav HTTP/1.1 500 …") utan att röra det bindande dokumentet.
**Varför:** Markören är skriven som en order i presens till byggaren ("byggaren
kör fallet, klistrar in statuskoden och rättar den här meningen om den inte
stämmer") och blir falsk i samma stund byggaren utför den — exakt samma form och
samma grundorsak som `**Kvar i paket N:**` (2026-09-04) och "I dagens
`src/core/entry.js`" (2026-09-07). Rättningen dokumenterades där byggaren
arbetade, i testfilen, i stället för där ordern stod, precis som lärdomen
2026-09-02 om `formatSek`-strängen beskriver. Ordern står dessutom på tre olika
rader för samma sak (1517, 2451, 3809), så den som rättar en av dem tror sig
klar. Sjunde gången `ARKITEKTUR.md` innehåller ett påstående om koden som koden
inte uppfyller.
**Regel framåt:** Kör `grep -n "inte kört\|inte körd\|arkitektens läsning" ARKITEKTUR.md`
innan varje paket lämnas vidare, på samma villkor som
`grep -n "Kvar i paket"`. För varje träff: antingen klistra in körningen som
visar att frågan fortfarande är oprövad, eller skriv om meningen till dåtid med
det körda utfallet och testets namn utskrivet ("Körd i paket N: `<kommando>` gav
`<utfall>`, testfall `<namn>`"). En markör får aldrig stå på mer än ett ställe:
skriv utfallet på ett ställe och låt övriga rader hänvisa dit. Ett körresultat
som byggaren skriver in i en testfil räknas inte som redovisat förrän samma
utfall står i `ARKITEKTUR.md`.
**Efterskrift 2026-09-07 18:35 (granskaren):** markörerna togs bort av arkitekten
kl. 17:42, alltså medan den här granskningen pågick och innan posten skrevs ned;
`grep -c "inte kört" ARKITEKTUR.md` ger numera `2`. Felet inträffade och gällde
hela paket 5 fram till dess, men beskrivningen i presens ovan är inte längre sann
om filen. Se posten om att paket 6 byggdes under granskningen.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-07 — test: kravet "två anrop i rad" gav kontraktstestet en loop som inte kan fälla någon mutation
**Vad gick fel:** `tests/server.test.js` rad 630 kör
`for (const nummer of [1, 2])` med identiska assertioner i båda varven, eftersom
hanteraren `() => undefined` bryter kontraktet vid varje anrop. Mätt i en kopia
under scratchpad: byts loopen mot `for (const nummer of [1])` ger
`node --test tests/server.test.js` fortfarande `tests 22, pass 22, fail 0`, och
båda de mutationer `ARKITEKTUR.md` föreskriver ger exakt samma utfall som med
`[1, 2]` — "ta bort `.catch(...)`" ger `fail 3` med samma tre kryssrader, och
"ta bort `try`/`catch`" ger `fail 1` med `✖ tests\server.test.js`. Andra varvet
tillför alltså noll upptäcktsförmåga. I testet `rad S2: en hanterare som kastar
…` (rad 598) är det andra anropet däremot bärande: hanteraren kastar bara på sitt
första anrop, så det andra anropets `404` utan kropp assertar något det första
inte gör.
**Varför:** Kravet "`500` med rad S2:s kropp på två anrop i rad" (`ARKITEKTUR.md`
rad 1516–1517) skrevs för S2- och S3-testen, där hanteraren kastar bara första
gången, och kopierades till kontraktsfallet, där hanteraren beter sig likadant
varje gång. Formen passade inte fallet — samma sorts fel som posten 2026-09-02
om `totalYearlyOre`-tabellen, där en tabellform kopierades till ett fall den inte
beskrev. Byggaren mätte att loopen inte var mutationsskyddad och redovisade det,
men behöll konstruktionen med skälet "dokumentet kräver det ordagrant". Det är
fel ordning: `CLAUDE.md` säger att `ARKITEKTUR.md` ändras först och byggs sedan,
och lärdomen 2026-09-02 om `formatSek` kräver att paketet lämnas tillbaka till
arkitekten när byggaren hittar en skillnad mellan dokumentet och verkligheten.
**Regel framåt:** Ett upprepningskrav i en kravlista ("två anrop i rad", "minst N
omgångar") ska skrivas tillsammans med den skillnad mellan varven som gör
upprepningen bärande — för S2 och S3: "hanteraren kastar bara på sitt första
anrop, det andra anropets `404` är beviset". Går den skillnaden inte att skriva
för ett fall gäller kravet inte det fallet, och kravlistan skrivs om innan
testet skrivs. Hittar byggaren att en konstruktion dokumentet kräver inte kan
fälla någon mutation lämnas paketet tillbaka till arkitekten — att redovisa
fyndet och ändå bygga konstruktionen räknas inte som åtgärdat.

### 2026-09-07 — arkitektur: saveEntries blev en export utan anropare i src/ när updateEntries togs i bruk
**Vad gick fel:** Efter paket 5 finns ingen anropare av `saveEntries` kvar i
`src/`: `grep -rn "saveEntries" src/` ger tio träffar, varav nio är kommentarer
och den tionde är `export async function saveEntries(entries)` i
`src/server/storage.js` rad 114. `src/server/api.js` rad 8 importerar bara
`loadEntries` och `updateEntries`. De enda anroparna är tester —
`tests/storage.test.js` (47 träffar), `tests/api.test.js` (3, som riggning) och
`tests/helpers/interrupted-save.js` (3). `ARKITEKTUR.md` rad 2296–2326 räknar
fortfarande upp `saveEntries` i gränssnittsblocket utan att nämna att den tappat
sin produktionsväg, och rad 3218–3221 motiverar fortfarande kön och det unika
temporärnamnet med "paket 5 gör en `POST` per klick: två snabba klick på Spara
ska spara" — ett påstående om `saveEntries`, som paket 5 inte anropar.
**Varför:** Teststrategins regel om exporter är skriven bara åt ena hållet:
"Ingen export får byggas i förtid — en export utan användare får inga
meningsfulla tester." Det motsatta fallet — en export som *förlorar* sin
användare när en ny väg byggs — har ingen regel, så ingenting i arbetsgången
tvingar fram en omläsning av gränssnittsblocket när en anropare byts ut. Enda
spärren mot att en framtida hanterare i paket 6 eller 7 återinför felet "två
snabba klick tappar en post" är en mening i `ARKITEKTUR.md` ("`api.js` får
därefter inte anropa `loadEntries` och `saveEntries` efter varandra i samma
hanterare"), och den meningen har inget test: mutationen som fäller den prövas
bara mot de två hanterare som finns i dag.
**Regel framåt:** När en ny export tar över en befintlig exports produktionsväg
ska den gamla exporten i samma paket antingen tas bort, eller märkas i
`ARKITEKTUR.md`:s gränssnittsblock med raden "ingen anropare i `src/` sedan
paket N — behålls därför att <skäl>". Kör `grep -rn "<export>" src/` för varje
export i gränssnittsblocket innan ett paket lämnas vidare, räkna bort
kommentarsraderna och redovisa utfallet. Ett förbud mot ett anropsmönster
("aldrig `loadEntries` följt av `saveEntries` i samma hanterare") ska ha ett test
som gäller varje hanterare, inte bara de som finns i dag — till exempel ett test
som läser `src/server/api.js` och kräver att `saveEntries` inte förekommer där.

### 2026-09-07 — process: paket 6 byggdes i arbetsträdet under granskningen av paket 5, och git status kunde inte visa det
**Vad gick fel:** Återfall av posten 2026-09-07 ("paket 5 och 6 byggdes i
arbetsträdet medan paket 4 låg hos granskaren"), vars regel lyder "Ett paket får
inte startas medan granskaren av det föregående paketet fortfarande kör … först
det beskedet startar nästa paket." Under granskningen av paket 5 ändrades
`ARKITEKTUR.md` (17:42:21, +292 rader utöver de 1 619 som fanns när granskningen
började), `src/server/paths.js` (17:48:33, ny export `getLockFilePath`),
`src/server/server.js` (17:49:59) och `src/web/app.js`, och `src/server/lock.js`
(18:27:43) samt `tests/lock.test.js` (18:33:38) skapades — ett fillås, alltså
paket 6-arbete. Mätt mot granskarens kopia: `src/server/server.js` gick från 254
till 291 rader med 57 ändrade rader och ny `sha256`, `src/web/app.js` från 216
till 232 rader med 16 ändrade, `tests/server.test.js` 39 ändrade rader,
`tests/api.test.js` 42. Granskningens `npm test` (`tests 229, pass 229, fail 0`)
gällde ett träd som inte längre finns; det nuvarande ger `tests 241, pass 241,
fail 0`. Ett av granskningens fyra fynd, "fem inte kört av arkitekten-markörer
står kvar", var redan åtgärdat när det skrevs ned: `ARKITEKTUR.md` rad 4158 säger
"Mekanismen 'inte kört av arkitekten' avskaffades" och `grep -c "inte kört"` ger
numera `2` i stället för `8`.
**Varför:** Regeln från den tidigare posten föreskriver kontrollen
`git status --porcelain` före och efter en granskning med krav på samma lista.
Den kontrollen är blind för just det här paketet: `src/server/server.js`,
`src/server/api.js`, `src/web/` och de två nya testfilerna är **ospårade**, och
en ospårad fil som skrivs om ger exakt samma rad `?? src/server/server.js` både
före och efter. Granskaren körde kontrollen, fick identisk lista, och upptäckte
bytet först när två *spårade* filer (`paths.js`) och två *nya* filnamn
(`lock.js`, `lock.test.js`) råkade dyka upp i samma utskrift. Regeln pekade
alltså ut ett kommando som inte kan svara på den fråga den ställer, och
granskningen fortsatte i drygt en och en halv timme mot filer som byttes ut under
tiden.
**Regel framåt:** Kontrollen före och efter en granskning ska vara innehållsbaserad
och omfatta ospårade filer, inte `git status --porcelain`: kör
`git status --porcelain -uall` **och**
`find src tests -name '*.js' -o -name '*.html' -o -name '*.css' | sort | xargs sha256sum > <fil>`
före granskningen och `sha256sum -c <fil>` efter, och klistra in båda utfallen i
granskningens besked. Skiljer de sig är granskningen ogiltig för de ändrade
filerna och görs om från den nya versionen — ett fynd får aldrig redovisas mot en
fil som bytts ut sedan det mättes. Granskaren ska dessutom ta en kopia av trädet
i sitt första steg och mäta alla fynd mot kopian, så att det går att visa exakt
vad som granskades. Nästa paket startar först när granskarens skriftliga besked
finns; att arkitekten och granskaren råkar hitta samma fel samtidigt är inte ett
kvitto på att parallellt arbete fungerar, utan på att granskningens arbete
gjordes två gånger.

### 2026-09-07 — lås: ett misslyckat andra `start()` i samma process tar bort ett lås som fortfarande används
**Vad gick fel:** `acquireDataFileLock` returnerar "låset är redan vårt" när
låsfilen bär den egna pid:en (`src/server/lock.js` rad 161–168), men
`releaseDataFileLock` tar bort filen villkorslöst så snart pid:en stämmer (rad
203–217) — det finns ingen räknare över hur många innehavare låset har. Körd, med
`HEMOCHEKONOMI_DATA_FILE` under `os.tmpdir()`: `const s1 = await start(0)` gav
`låsfil efter start 1: "22600\n"`; ett andra `await start(<s1:s port>)` i samma
process föll på `listen` med `ServerStartError: Port 62314 är upptagen…`, och
dess `catch` i `src/server/server.js` rad 247 anropade `releaseDataFileLock()` →
`låsfil efter start 2 misslyckades: ENOENT` medan `server 1 lever fortfarande:
200`. En `fork`:ad barnprocess mot samma datafil svarade därefter `BARNET TOG
LÅSET pid 780` — alltså två processer mot en datafil, precis det läge låset
byggdes för att omöjliggöra. Samma grundorsak har ett andra ansikte:
`heldLockPath` är en enda variabel, så ett andra `acquireDataFileLock()` mot en
annan datafil skriver över den. Körd: efter lås på `a.json` och därefter `b.json`
gav ett släpp `a.json.lock: finns  b.json.lock: BORTA`, och ett andra släpp
ändrade ingenting; `a.json.lock` tas aldrig bort av vare sig
`releaseDataFileLock` eller `exit`-städningen, och ett barn mot `a.json`
blockerades med rad L1 fastän ingen server körde där.
**Varför:** Låsets ägarskap är bokfört som "en sökväg plus en pid", och den
bokföringen kan varken skilja *vem* i processen som håller låset eller *hur
många*. `ARKITEKTUR.md` gör båda halvorna bindande var för sig — "Två anrop i
samma process delar lås" under "Låset på datafilen" och "Misslyckas något av de
två senare stegen släpps låset innan felet kastas vidare" — utan att någon
prövade dem tillsammans. Punkten "Släppandet tar aldrig någon annans lås"
definierar "någon annan" som en annan *process*, så delningen inom processen
faller utanför regeln och blev därmed aldrig testad: `tests/server.test.js` rad
729 håller porten upptagen med en `http.createServer()` som inte tar något lås,
alltså just den variant där buggen inte kan uppstå. Vägen är inte nåbar via
`npm start`, som anropar `start()` en gång — den öppnas av paket 6 och 7 och av
varje test som anropar `start()` två gånger, vilket dokumentet uttryckligen
tillåter.
**Regel framåt:** Ett lås som får delas ska bokföra sina innehavare, inte bara
sin sökväg: håll en modullokal räknare (eller en `Map` från låssökväg till antal)
som `acquireDataFileLock` ökar vid varje uppfyllt anrop — även i grenen "pid:en
är vår egen" — och som `releaseDataFileLock` minskar, och ta bort låsfilen först
när räknaren når `0`. Låsfilen ska dessutom bära ett anropsunikt inslag utöver
pid:en (`${process.pid}:${randomUUID()}`), så att "vårt gamla lås" går att skilja
från "vårt nya" när en omstart och ett osynkat `void releaseDataFileLock()`
överlappar. Testfallen är obligatoriska och ska anropa `start()` **två gånger i
samma process**: (1) ett andra `start()` mot en port som en *egen* `start()`
redan håller ska lämna låsfilen kvar, och en `fork`:ad process mot samma datafil
ska då fortfarande avvisas med rad L1; (2) två lås mot två olika datafiler följt
av två släpp ska lämna noll låsfiler kvar. Ett test som håller porten upptagen
med en server som inte tar låset räknas inte som täckning för den här raden.

### 2026-09-07 — test: `src/web/app.js` kan göras syntaktiskt trasig utan att `npm test` faller
**Vad gick fel:** Hela det användarvända lagret i paket 5 har noll körd täckning.
Körd mutation i en kopia under scratchpad: raden `import { CATEGORY_LABELS,
INTERVAL_LABELS } from '/core/entry.js';` byttes mot `import {
KATEGORI_ETIKETTER, INTERVAL_LABELS } from '/core/entry.js';` följd av raden
`const trasig = ( ;` — alltså ett namn som inte finns *och* ett rent syntaxfel —
och `node --test "tests/*.test.js"` gav `tests 241, pass 241, fail 0` och
`EXIT=0`. Ingen testfil importerar, kör eller ens parsar filen: `grep -n
"app.js" tests/*.js` ger två träffar, och båda hämtar filen över HTTP och
jämför byte mot byte med filen på disk, så vilket innehåll som helst passerar.
Filen är i sak funktionsduglig — granskaren körde den mot en egen DOM-attrapp
och en riktig server och fick rätt utfall i varje prövat fall — men ingenting i
projektet kan visa det, och `CLAUDE.md`:s grind "`npm test` ska ge `fail 0` och
exit 0 innan ett paket lämnas vidare" är blind för filen.
**Varför:** `ARKITEKTUR.md` beslutade "`src/web/app.js` har ingen automatisk
testfil, men fem redovisade körningar" och lade bevisbördan på en DOM-attrapp
som byggaren kör och klistrar in utfallet från. Attrappen är inget spårat
artefakt i projektet (`grep -rn "attrapp"` ger fyra träffar, alla i prosa:
`ARKITEKTUR.md` ×2, `LARDOMAR.md` ×1 och kommentaren i `src/web/app.js` rad 221),
så körningen kan inte göras om av nästa agent och kan inte fälla någon ändring.
Beslutet "ingen webbläsarautomatisering införs" motiverar att `click`- och
`submit`-beteende inte automatiseras — det motiverar inte att filen aldrig ens
laddas. Paket 6 och 7 ska bygga vidare i just den här filen (totalrutan och
listan över kommande dragningar), och de kommer att göra det med en grön svit
oavsett vad de skriver.
**Regel framåt:** Varje fil under `src/web/` som webbläsaren laddar som modul ska
ha minst en automatisk körning i `tests/`, även när beslutet är att inte
automatisera gränssnittsbeteendet: en `tests/app.test.js` som sätter en
DOM-attrapp på `globalThis.document`, importerar `app.js` dynamiskt med
`/core/`-specifikationerna ompekade mot `src/core/`, och asserterar att importen
inte kastar samt att `#interval` och `#category` fyllts med nycklarna ur
`INTERVAL_LABELS` respektive `CATEGORY_LABELS`. Attrappen checkas in under
`tests/helpers/`, aldrig som en engångskörning — en mätapparat som kastas bort
gör mätningen omöjlig att göra om. Innan filen räknas som testad ska mutationen
"stoppa in ett syntaxfel i `src/web/app.js`" ha körts och gett exit 1.

### 2026-09-07 — test: textspärren mot `saveEntries` i `api.js` går förbi med ett alias
**Vad gick fel:** Testet `src/server/api.js importerar från ./storage.js på ett
ställe, namngivet och utan saveEntries` (`tests/api.test.js` rad 491–515) delar
importlistan på `,` och prövar `namn.includes('saveEntries')`, vilket är falskt
för elementet `'saveEntries as spara'`. Körd mutation i en kopia: importraden
byttes till `import { loadEntries, updateEntries, saveEntries as spara } from
'./storage.js';` och testet gav `✔ … (0.6605ms)` och `EXIT=0`. Spärren släpper
alltså igenom exakt den återinföring den byggdes för att stoppa, och
`ARKITEKTUR.md` föreskriver bara mutationen "lägg till `saveEntries` i
`api.js`:s importlista", som är den enda stavning spärren råkar fånga.
**Varför:** Regeln formulerades om en *sträng i en importlista* i stället för om
en *bindning i modulens omfång*, och mutationen som skulle pröva spärren skrevs i
samma stavning som spärren själv — då prövar mutationen bara att spärren
fungerar för det fall den redan är skriven för. Regressionen fångas i praktiken
av beteendetesterna, vilket granskaren körde: `loadEntries` följt av det aliasade
`spara` i `handleCreate` fällde `✖ två samtidiga POST ger 201 var och två poster
på disk`, och samma sak i `handleDelete` fällde `✖ två samtidiga DELETE av olika
poster ger 204 var och lämnar exakt en post` och `✖ två samtidiga DELETE av samma
post ger ett 204 och ett 404`. Felet i dag är alltså att spärren inte gör det den
utger sig för, inte att regressionen är oupptäckbar.
**Regel framåt:** En spärr som läser källkod som text ska prövas med varje
stavning språket tillåter för samma bindning, inte bara den stavning regeltexten
råkar använda. För en importlista betyder det att namnet ska matchas som en
`import`-*bindning*: normalisera varje element med
`del.split(/\s+as\s+/)[0].trim()` innan jämförelsen. Mutationslistan ska skrivas
ut med minst tre stavningar — `saveEntries`, `saveEntries as X` och
`import * as storage` — och var och en ska ha körts och gett exit 1. En textspärr
räknas aldrig som det enda skyddet mot en regression: skriv ut i redovisningen
vilket beteendetest som fäller samma regression, och kör det.

### 2026-09-07 — dokumentation: antalet avskaffade "inte kört av arkitekten"-markörer räknades utan alla böjningsformer
**Vad gick fel:** Beslutsloggen i `ARKITEKTUR.md` rad 4158 skriver "markeringen
fanns på **nio** ställen" och avslutar "De **nio** markeringarna är strukna", men
enligt projektledarens körning fanns elva förekomster — de två som saknades var
pluralformer (`inte **körda** av arkitekten`), som granskarens `grep` på
singularformen inte träffade. Slutresultatet är rätt: granskarens kontroll av det
frysta trädet ger noll kvarvarande markörer, `grep -n "inte kört\|inte körd\|inte
körda\|ej kört" ARKITEKTUR.md` ger två träffar och båda är meta-omnämnanden (rad
3078 och 4158) som beskriver att mekanismen är avskaffad. Det är antalet i den
bindande texten som är fel, och därmed går det inte att avgöra ur dokumentet självt
om alla markörer är borta eller om två aldrig hittades.
**Varför:** Antalet ärvdes ur granskarens `grep`-utfall i föregående runda utan
att sökmönstret skrevs ut eller kördes om mot alla böjningsformer.
`grep "inte kört av arkitekten"` matchar inte `inte körda av arkitekten`, och den
skillnaden syns inte i ett antal — bara i mönstret. Samma grundorsak som
2026-08-18 (testkommandot skrevs ned utan att köras) och 2026-09-02
(exakthetspåståendet i `money.js`): en siffra i ett bindande dokument som är en
slutsats *av* en körning i stället för en körning.
**Regel framåt:** Ett antal i `ARKITEKTUR.md` ("fanns på N ställen", "N träffar",
"noll förekomster") ska alltid skrivas tillsammans med det kommando som gav
antalet, ordagrant och körbart: `grep -c "<mönster>" ARKITEKTUR.md`. Handlar
sökningen om svensk text ska mönstret täcka böjningen med en alternering
(`inte kör\(t\|d\|da\)`), och sökningen ska köras om efter rättningen och ge `0`,
med den utdatan inklistrad. Går antalet inte att verifiera när det skrivs ska
meningen formuleras som "samtliga förekomster av mönstret `<mönster>` är strukna;
`grep -c` ger nu 0" — påståendet om *noll kvar* går att kontrollera, påståendet om
*hur många det var* gör det inte.

### 2026-09-10 — test: två av tre fall i den bindande uppräkningen för GENERAL_ERROR körs av inget test
**Vad gick fel:** `ARKITEKTUR.md` rad 3530–3533 räknar upp exakt när
`GENERAL_ERROR` visas och namnger tre fall — "`fetch` avvisas — vid
sidladdningen, vid Spara och vid Ta bort" — men bara Spara körs av sviten.
Instrumenterat i en kopia (alla tre `FORM_ERROR.textContent = GENERAL_ERROR;` i
`src/web/app.js` rad 151, 197 och 229 fick var sin `console.log`) och kört
`node --test "tests/*.test.js"` över hela sviten: utfallet är `1 MARK-GE-2` och
noll rader för `MARK-GE-1` (sidladdningen) och `MARK-GE-3` (Ta bort). Båda
grenarna överlever mutation: `loadAndRender`s try/catch runt
`await fetch('/api/entries')` ersatt av ett rakt `const response = await
fetch('/api/entries');` ger `tests 16, pass 16, fail 0` och `EXIT=0`, och
`FORM_ERROR.textContent = GENERAL_ERROR;` struken ur `removeEntry`s catch ger
samma sak. Utan de raderna blir ett avvisat `fetch` vid sidladdning en ohanterad
avvisning från modulens toppnivås `await loadAndRender()` och användaren ser en
tom skärm utan ett ord.
**Varför:** Kravlistan för `tests/app.test.js` (`ARKITEKTUR.md` rad 2044–2083) är
skriven som en lista över *scenarier* — "ett fetch som kastar visar den allmänna
texten och lämnar knappen påslagen" — medan uppräkningen av `GENERAL_ERROR`-fallen
står i ett helt annat avsnitt och aldrig översattes till en rad per fall. När ett
av tre scenarier fick ett testfall såg kravet uppfyllt ut: testet heter något som
låter allmänt ("ett fetch som kastar"), fast det bara prövar POST-vägen. Paket 6
lade till fyra testfall i samma fil utan att uppräkningen lästes om, trots att
paketets egen totalruta är beroende av just laddningsvägen.
**Regel framåt:** En uppräkning i `ARKITEKTUR.md` som säger "i exakt dessa fall"
eller räknar upp platser ("vid sidladdningen, vid Spara och vid Ta bort") ska ha
ett eget testfall per uppräknad plats, och testets namn ska innehålla platsen
("vid sidladdning", "vid Ta bort") — aldrig ett namn som täcker alla tre men bara
kör en. Kontrollen körs innan paketet lämnas vidare: instrumentera varje
kodställe som uppräkningen pekar ut med en `console.log` i en kopia av trädet, kör
hela sviten och kräv minst en rad per ställe. Skrivs ett ställe noll gånger är
kravet inte byggt färdigt, oavsett hur många tester filen har.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-10 — gränssnitt: totalrutan och tomläget har ett tredje tillstånd som specen inte nämner — helt tomma rutor
**Vad gick fel:** `ARKITEKTUR.md` rad 3410–3416 slår fast "**Totalrutan visas
alltid, också när listan är tom.** Den döljs inte" och motiverar det med att "en
ruta som försvinner och kommer tillbaka är oroligare att läsa än två nollor", men
`renderEntries` i `src/web/app.js` rad 100–108 är det enda stället som skriver
`#total-monthly`, `#total-yearly` och `#empty-state`, och den anropas bara efter
ett `200`. Mätt med den incheckade DOM-attrappen: ett `fetch` som avvisas vid
sidladdningen ger `empty-state="" total-monthly="" total-yearly=""
form-error="Det gick inte att nå appens server. Försök igen." rader=0`, och ett
`500` med lagringens svenska text ger `empty-state="" total-monthly=""
total-yearly="" form-error="Datafilen är skadad och kunde inte läsas: X"
rader=0`. Användaren får alltså kortet Summa med etiketterna `Totalt per månad`
och `Totalt per år` och **inget belopp alls** — varken de utlovade två nollorna
eller en dold ruta. Samma mätning visar ett fjärde, lika ospecificerat läge: efter
ett lyckat `DELETE` (`204`) vars omladdning avvisas står raden kvar i vyn och
totalerna kvar på det gamla beloppet för en post som redan är borta ur datafilen.
**Varför:** Facit för paket 6 är skrivet som två tillstånd — "tom lista" och
"lista med poster" — och båda förutsätter att en lista har kommit. Tillståndet
"ingen lista kom" tillhör felvägen, som beskrivs i ett annat avsnitt
("Den allmänna felrutans egen text"), och det avsnittet talar bara om felrutans
text, aldrig om vad de övriga elementen ska visa. Ingen mening i filen binder ihop
de två, så byggaren byggde två av tre tillstånd och sviten prövade samma två:
laddningsvägens felgren körs av inget testfall alls (se posten ovan).
**Regel framåt:** När ett element bara skrivs på lyckoväg ska specen ha en rad för
varje väg där det *inte* skrivs, med den text elementet ska bära då. För paket 6
betyder det en rad i totalruteavsnittet för "laddningen misslyckades" och en för
"en omladdning efter en lyckad ändring misslyckades", med beslutet utskrivet —
antingen `0,00 kr` i båda, eller den senast kända summan med en text som säger att
den är gammal. Kontrollen är mekanisk och körs i samma paket: för varje element
`app.js` sätter, kör `grep -n "textContent" src/web/app.js`, räkna upp varje
funktion som *inte* passerar den raden på sin väg ut, och skriv ett testfall per
sådan väg som asserterar elementets värde.

### 2026-09-10 — dokumentation: kravlistan för paket 6 skriver formatSek-utdata med vanligt mellanslag
**Vad gick fel:** `ARKITEKTUR.md` rad 2073, 2074 och 2077 är den bindande
kravlistan för `tests/app.test.js` och anger de strängar testet ska asserta:
`141,66 kr`, `141,67 kr` och `0,00 kr` — alla tre skrivna med U+0020 före `kr`.
Körd: `formatSek(14166)` ger kodpunkterna
`U+0031 U+0034 U+0031 U+002C U+0036 U+0036 U+00A0 U+006B U+0072`, och
jämförelsen mot `141,66 kr` skriven med U+0020 är `false`; samma sak för
`0,00 kr` mot `formatSek(0)`. En byggare som följer kravlistan ordagrant skriver
alltså ett test som aldrig kan passera. Samma stycke gör motsatt fel på rad 3412:
meningen "formatSek(0) ger 0,00 kr — en tom lista visar alltså 0,00 kr på båda
raderna" har U+00A0 i den första strängen och U+0020 i den andra, i samma mening.
Rad 3388 och 3412 skriver dessutom det hårda blanksteget som ett osynligt U+00A0 i
källtexten, medan rad 866, 912 och 2478 i samma fil skriver samma tecken som
escapesekvensen — filen har två skrivsätt för samma tecken, och det ena går inte
att se.
**Varför:** Lärdomen 2026-09-02 om `formatSek`-strängen kräver att en exempelsträng
skrivs med kodpunkterna utskrivna "så snart den innehåller andra blanktecken än
U+0020". Regeln följdes i brödtexten om kvartalsposten, där skillnaden var poängen,
men inte i kravlistan under "Teststrategi", som skrevs i ett annat stycke och lästes
som en uppräkning av testfall snarare än som exempelsträngar. Att byggaren ändå
skrev testet rätt (`tests/app.test.js` rad 433, 438, 443 och 458–460 har U+00A0)
döljer felet: sviten är grön, och bara nästa läsare av dokumentet går på det.
**Regel framåt:** Ett hårt blanksteg får aldrig stå som ett osynligt U+00A0 i
`ARKITEKTUR.md` — varje sträng som en funktion producerar skrivs med
escapesekvensen `\u00a0`, oavsett om den står i brödtext, i en tabell eller i en
kravlista. Kontrollen körs när ett avsnitt med belopp skrivs: kör funktionen och
skriv ut kodpunkterna för varje sträng avsnittet påstår, och kör dessutom
`grep -nP "\x{00A0}" ARKITEKTUR.md` — varje träff ska antingen bytas mot `\u00a0`
eller motiveras på raden. En kravlista räknas som exempelsträngar, inte som prosa.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-10 — dokumentation: "Två nya id:n" i samma stycke som kräver tre FakeElement
**Vad gick fel:** `ARKITEKTUR.md` rad 3430 inleder ett fetstilt krav med
"**Två nya id:n betyder två tillägg i DOM-attrappen.**" och fortsätter tre ord
senare "`index.html` får `total-monthly`, `total-yearly` och `empty-state` … faller
tills `createDom()` … registrerar samma tre. Attrappen ska alltså få tre
`FakeElement` till". Det är tre nya id:n och tre tillägg, inte två. Körd mot det
frysta trädet: `grep -o ' id="[^"]*"' src/web/index.html` ger 16 id:n mot 13 i
commit `ced5661`, alltså tre nya, och `tests/helpers/dom.js` rad 159–169 lägger
till tre `FakeElement`. Stycket ger alltså två svar på frågan "hur många".
**Varför:** Meningen skrevs först om totalrutans två beloppselement, som var
avsnittets ämne, och tomläget lades till i uppräkningen efteråt utan att den
fetstilta ingressen räknades om. En fetstilt ingress läses som facit och kopieras
vidare; siffran i den kontrollerades aldrig mot uppräkningen på nästa rad. Tredje
gången ett antal i `ARKITEKTUR.md` är fel (2026-09-07, "nio" markörer som var elva,
och posten om grep-antalet nedan).
**Regel framåt:** Skriv aldrig ett antal i en rubrik eller en fetstilt ingress när
uppräkningen står i samma stycke — skriv "Varje nytt id betyder ett tillägg i
DOM-attrappen" och låt uppräkningen bära antalet. Måste ett antal stå ska det
skrivas tillsammans med kommandot som ger det, och kommandot ska köras efter att
stycket är färdigskrivet: här `grep -c ' id="' src/web/index.html` före och efter,
med båda talen inklistrade.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-10 — test: förbudet mot att summera kolumnen skyddas bara för månadstotalen
**Vad gick fel:** `ARKITEKTUR.md` rad 3369–3371 är bindande: "`app.js` får aldrig
summera kolumnen själv. Totalerna kommer alltid ur `totalMonthlyOre` och
`totalYearlyOre`", och punkt (14) i kravlistan motiverar sitt testfall med "så att
ingen senare byggare kan byta `totalMonthlyOre` mot en kolumnsumma utan att ett
test faller". Skyddet gäller bara halva förbudet. Kört i en kopia:
`TOTAL_YEARLY.textContent = formatSek(totalYearlyOre(entries))` bytt mot
`formatSek(entries.reduce((s, e) => s + yearlyOre(e), 0))` ger
`tests 264, pass 264, fail 0` och `EXIT=0` på hela sviten. Motsvarande mutation för
månadstotalen fälls som utlovat (`✖ totalrutan visar totalMonthlyOre och
totalYearlyOre för hela listan`, `✖ kolumnen och totalen skiljer sig med ett öre
för de tre posterna`, `EXIT=1`).
**Varför:** Testfallet bygger på en öres skillnad mellan kolumn och total, och den
skillnaden finns bara för månadstotalen: `totalYearlyOre` i `src/core/cost.js` rad
85–102 *är* summan av `yearlyOre` per post, så inget visat värde kan skilja en
kolumnsumma från totalen. `ARKITEKTUR.md` rad 3363–3364 skriver till och med ut
att "Årskolumnen summerar till 170000 öre och `totalYearlyOre` ger 170000 öre,
alltså ingen skillnad där" utan att dra slutsatsen att förbudets andra hälft
därmed står oskyddad. Skillnaden mellan de två skrivsätten är inte värdet utan
spärrarna: `totalYearlyOre` avvisar en icke-array och kastar `RangeError` när
summan lämnar det säkra heltalsområdet, medan en `reduce` i `app.js` svarar tyst.
**Regel framåt:** Ett förbud som gäller flera anrop ("totalerna kommer alltid ur
X och Y") ska ha en mutation per anrop, och mutationerna räknas upp skriftligt i
paketets redovisning med sin exitkod. Ger en mutation samma värde som originalet
för varje möjlig indata går den inte att fälla på värdet — då ska skyddet skrivas
som en kontroll av källtexten i stället, på samma sätt som testet
`src/server/api.js importerar från ./storage.js … utan saveEntries`: läs
`src/web/app.js` och kräv att `reduce` och `for` inte förekommer i samma sats
som `TOTAL_MONTHLY` eller `TOTAL_YEARLY`, och pröva den spärren med varje stavning
språket tillåter.

### 2026-09-10 — dokumentation: sökmönstret skrevs in i filen det söker i, och antalet blev fel
**Vad gick fel:** `ARKITEKTUR.md` rad 3578–3581 påstår att den bredare sökningen
efter markören "inte kört av arkitekten" ger två träffar, "och båda är sådana
omnämnanden". Körd på det frysta trädet ger samma kommando `6`, och en av
träffarna är rad 3580 — meningen som skriver ut mönstret matchar sitt eget
mönster. Träffarna är rad 3557, 3577, 3580, 4652, 4672 och 4727. Felet finns även
i commit `ced5661` (samma kommando mot `git show HEAD:ARKITEKTUR.md` ger `6`), så
det är inte paket 6 som infört det, men paket 6 lämnades vidare med det.
**Varför:** Rättningen av lärdomen 2026-09-07 (antalet markörer räknades utan alla
böjningsformer) följde regeln "skriv antalet tillsammans med det kommando som gav
antalet, ordagrant och körbart" — och det är just det som gör antalet fel: så snart
mönstret står ordagrant i filen matchar filen sig själv, och antalet ändras av
rättningen som skriver ned det. Kommandot kördes före meningen skrevs, aldrig
efter.
**Regel framåt:** Ett grep-antal om en fil får bara skrivas ned i samma fil om
kommandot körs **efter** att meningen är skriven och utfallet klistras in från just
den körningen. Räknar meningen bara kvarvarande verkliga förekomster ska raden som
dokumenterar mönstret uteslutas explicit och uteslutningen skrivas ut i kommandot.
Ett antal som ändras av att man skriver ned det ska ersättas med ett påstående som
inte gör det: "varje kvarvarande träff är ett omnämnande av mekanismen, ingen är en
markör".

### 2026-09-10 — kod: kommentaren i app.js räknar upp två av filens fem användarvända strängar
**Vad gick fel:** `src/web/app.js` rad 12–13 lyder "De strängar i den här filen som
varken kommer från servern eller från `src/core/`. Båda står ordagrant i
`ARKITEKTUR.md` och får inte skrivas om." och följs av `GENERAL_ERROR` och
`EMPTY_STATE`. Filen har fem sådana strängar, inte två: `Ta bort` på rad 73 samt
etiketterna `Per månad: ` på rad 87 och `Per år: ` på rad 88, varav de två sista
lades till i samma paket som gjorde kommentaren till plural. Körd: en sökning efter
strängliteraler med svenska ord i `src/web/app.js` ger rad 17, 18, 73, 87 och 88.
**Varför:** Kommentaren skrevs om från "Enda strängen i den här filen…" till "De
strängar…" när `EMPTY_STATE` tillkom, alltså i samma ändring som lade till två nya
användarvända strängar en skärmhöjd längre ned. Omskrivningen såg ut som en ren
pluralböjning och prövades bara mot de två konstanter som stod direkt under den;
ingen sökte i filen efter övriga strängar. Följden är att den enda mening i filen
som markerar en sträng som "får inte skrivas om" utesluter tre av fem.
**Regel framåt:** En kommentar som räknar upp något i sin egen fil ("de enda", "de
strängar", "båda", "alla tre") ska verifieras med en sökning i filen i samma
ändring, och sökningen skrivs ut i redovisningen. Går uppräkningen inte att hålla
uppdaterad ska den formuleras utan antal ("Strängar mot användaren som varken
kommer från servern eller från `src/core/` står ordagrant i `ARKITEKTUR.md` och får
inte skrivas om") — ett krav utan siffra blir inte falskt av nästa tillägg.

### 2026-09-10 — kod: uppräkningen "enda strängen" rättades i app.js och lämnades kvar i tests/app.test.js
**Vad gick fel:** Rättningen av posten `2026-09-10 — kod: kommentaren i app.js
räknar upp två av filens fem användarvända strängar` skrev om `src/web/app.js`
rad 12–17 till en uppräkning utan antal, men samma påstående står kvar i
`tests/app.test.js` rad 24: `// Enda strängen i app.js som varken kommer från
servern eller från src/core/.` — och den filen ändrades i samma runda. Körd mot
det frysta trädet: `src/web/app.js` har sex sådana strängar (rad 21
`GENERAL_ERROR`, rad 22 `EMPTY_STATE`, rad 26 `UNKNOWN_TOTAL`, rad 81 `'Ta bort'`,
rad 95 `Per månad: `, rad 96 `Per år: `), och fyra av dem skrivs ut i testfilen
själv — rad 388, 392, 453, 477 och rad 493, där `const UNKNOWN_TOTAL` med värdet
`\u2013` lades till i den här rundan, 469 rader under meningen som säger att den
inte finns.
**Varför:** Lärdomens "Vad gick fel" namngav `src/web/app.js` rad 12–13, och
rättningen gjordes mot den adressen i stället för mot påståendet. Meningen i
testfilen är ordagrant samma fel med samma ord, men den stod inte i posten och
söktes därför aldrig upp: `grep -rn "Enda strängen" src tests` var en körning som
ingen gjorde. Andra gången samma rättning görs på ett av två ställen
(`2026-09-07 — dokumentation: rättningen av "beskriver kod som inte längre ser ut
så" gjordes till hälften`).
**Regel framåt:** Rätta ett felaktigt påstående genom att söka på påståendets egna
ord i hela trädet, aldrig bara på den adress lärdomen råkar namnge: kör
`grep -rn "<fem ord ur den falska meningen>" src tests ARKITEKTUR.md` före
rättningen och igen efteråt, och klistra in båda utfallen. Antalet träffar ska
vara noll i den andra körningen. Lägger samma paket till ett nytt exemplar av det
uppräknade (här `UNKNOWN_TOTAL` i testfilen) räknas rättningen som ogjord.

### 2026-09-10 — dokumentation: det hårda blanksteget rättades till ett osynligt U+00A0, som filen själv förbjuder
**Vad gick fel:** Rättningen av posten `2026-09-10 — dokumentation: kravlistan för
paket 6 skriver formatSek-utdata med vanligt mellanslag` bytte U+0020 mot ett rått
U+00A0 i `ARKITEKTUR.md` rad 2073, 2074 och 2077 i stället för mot escapen
`\u00a0`. Antalet råa förekomster i filen gick därmed **upp** från `2` till `5`:
kommandot `grep -cP` med mönstret för U+00A0 gav `2` i runda 1 och ger `5` nu, med
träffar på rad 2073, 2074, 2077, 3407 och 3431. Filen förbjuder det själv på rad
2488–2489: "Varje jämförelse mot `formatSek`, i kod eller i test, skrivs därför
med escapen `\u00a0`, aldrig med ett vanligt mellanslag", och rad 3483 — skriven i
samma runda, i det nya avsnittet "Vyn när en hämtning misslyckas" — skriver samma
sträng rätt, med escapen. Samma sträng har alltså två skrivsätt i ändringar från
samma paket.
**Varför:** Posten formulerade felet som "strängen matchar inte det `formatSek`
ger", och rättningen löste just det: strängarna är nu rätt som *innehåll*. Postens
"Regel framåt" gällde *skrivsättet* ("får aldrig stå som ett osynligt U+00A0") och
den halvan lästes inte, eftersom ett rått U+00A0 ser exakt ut som ett vanligt
mellanslag i editorn — rättningen syns inte i en genomläsning och kan bara
upptäckas av kommandot posten skrev ut. Kommandot kördes aldrig efter rättningen.
**Regel framåt:** En rättning som gäller ett osynligt tecken redovisas med samma
mätning före och efter, aldrig med en genomläsning: kör `grep -cP` med mönstren
för U+00A0 och U+2212 mot `ARKITEKTUR.md` före ändringen och efter, och klistra in
båda talen. Talet efter ska vara lägre eller lika; blir det högre är rättningen
felaktig oavsett hur strängen läser. Skriv aldrig ett tecken utanför ASCII i en
sträng som en funktion producerar — använd escapen (`\u00a0`, `\u2212`, `\u2013`)
och låt brödtexten intill namnge kodpunkten.

### 2026-09-10 — test: raden som tömmer #empty-state i clearView överlever mutation, och mutationskravet träffar bara den andra kopian
**Vad gick fel:** `src/web/app.js` rad 129, som sätter `#empty-state` till den
tomma strängen i den nya `clearView`, kan tas bort utan att något test faller:
`npm test` ger `tests 267, pass 267, fail 0` och `EXIT=0`. Instrumenterad med en
utskrift först i `clearView` körs funktionen exakt två gånger i hela sviten, och
båda gångerna är `#empty-state` redan tomt — raden skriver alltså aldrig över
något. Den indata som når raden i verksam form är konstruerad och körd: tom lista
vid start (tomläget skrivs), `POST` som ger `201`, omhämtningen ger `500`. Med
raden ger vyn `empty-state = ""`; utan raden ger den
`empty-state = "Du har inga poster ännu. Lägg till din första utgift ovan."`
samtidigt som båda totalerna visar `\u2013`, alltså två motsägande påståenden på
skärmen — precis det `ARKITEKTUR.md` rad 3482 gör bindande ("`#empty-state` | den
tomma strängen | ... ett **påstående om datafilen**"). Mutationskravet (b) i
kravlistan, rad 2086–2088, lyder "ta bort **raden** som sätter `#empty-state` till
den tomma strängen" i singular, men efter paket 6 finns två sådana rader (rad 115
i `renderEntries` och rad 129 i `clearView`); den mutationen fäller
`✖ en lista med en post tömmer tomläget` och lämnar rad 129 oprövad.
**Varför:** De två nya testfallen prövar `#empty-state` med en likhet mot tomma
strängen i lägen där elementet redan är tomt: i punkt (17) har det aldrig
skrivits, i punkt (18) har `renderEntries` just satt det till tomt i sin
`else`-gren. Assertionen är alltså sann av sig själv och kan bara fälla en
mutation som skriver *fel* text — mutationen "sätt `EMPTY_STATE` i stället" fäller
båda testfallen, men "ta bort raden" gör det inte. Mutationslistan hämtades ur
`ARKITEKTUR.md`, som skrevs innan den andra kopian av raden fanns, i stället för
ur den ändrade filen. Sjunde gången ett delvillkor i projektet visar sig oskyddat
av något test.
**Regel framåt:** En assertion som kräver att ett element är tomt räknas inte som
skydd för raden som tömmer det förrän testet har försatt elementet i ett
**icke-tomt** läge först. Skriv testfallet så att det synliga tillståndet före
anropet är det motsatta av det förväntade efter, och kör mutationen "ta bort
raden" — inte bara "skriv fel värde". Ett mutationskrav i `ARKITEKTUR.md` som
säger "raden" i bestämd form singular ska verifieras med en `grep` efter radens
text i filen i samma paket; ger sökningen fler än en träff skrivs kravet om till
en mutation per träff, med en kryssrad för var och en.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-10 — kod: kommentaren i loadAndRender påstår att ordningen är bindande och namnger fel gren
**Vad gick fel:** `src/web/app.js` rad 169–172 lyder "Ordningen är bindande i den
avvisade grenen — `clearView` rör inte felrutan, men `showErrors` börjar med
`clearErrors`, så feltexten måste skrivas efteråt." Båda leden är motbevisade av
en körning. (1) Ordningen är inte bindande: satsparet i `catch`-grenen bytt till
omvänd ordning **och** satsparet i grenen för status ≠ 200 bytt till omvänd
ordning, båda samtidigt, ger `tests 267, pass 267, fail 0` och `EXIT=0` på hela
sviten. (2) Meningen namnger fel gren: "den avvisade grenen" är `catch`-grenen på
rad 177–181, och där finns ingen `showErrors` — den står i grenen för status ≠ 200
på rad 184–188. `clearView` skriver bara till `#entry-list`, `#empty-state`,
`#total-monthly` och `#total-yearly`, medan `showErrors` och `FORM_ERROR` skriver
till `#form-error` och `#error-<fält>`; mängderna är disjunkta, så ordningen kan
inte spela roll i någondera grenen. Uppmätt med DOM-attrappen: ett fältfel och en
allmän text satta för hand före en borttagning vars omhämtning ger `500` gav
efteråt `form-error = "SERVERTEXT"` och tomt fältfel för `name` — och det är
`removeEntry`s eget `clearErrors()` som tömde fältfelet, inte `clearView`.
**Varför:** Kommentaren skrevs för att motivera var `clearView()`-anropen
placerades, och motiveringen lånades från den gren där `clearErrors` finns till
den gren där den inte finns. Ordet "bindande" skrevs utan att ordningen kastades
om och kördes — samma grundorsak som `2026-09-07 — dokumentation: en kodkommentar
i server.js påstår "uppmätt" något som en mutationskörning motsäger`. En kommentar
som säger "bindande" läses av nästa byggare som att ett test skyddar ordningen;
inget gör det.
**Regel framåt:** Ordet "bindande" i en kodkommentar i `src/` kräver den
mutationskörning som visar det: skriv ut mutationen och utfallet på formen
`mutation: <gammalt> -> <nytt> ger EXIT=<kod>, faller <testnamn>`. Passerar sviten
ska ordet strykas och kommentaren skrivas om till vad ordningen faktiskt gör.
Namnger en kommentar en gren ("den avvisade grenen", "grenen för status ≠ 200")
ska den konstruktion motiveringen bygger på (`clearErrors`, `showErrors`) finnas i
just den grenen — kontrollen är att läsa grenens rader och räkna upp vilka element
varje sats skriver till.

### 2026-09-10 — dokumentation: "det är punkt (13) som är dess test" prövades inte med den mutation punkt (14) prövades med
**Vad gick fel:** `ARKITEKTUR.md` rad 3390–3392, skriven för att rätta lärdomen
`2026-09-10 — test: förbudet mot att summera kolumnen skyddas bara för
månadstotalen`, avslutar "Kravet på `app.js` står kvar oförändrat — totalerna
hämtas ur de två exporterna — men det är punkt (13), inte punkt (14), som är dess
test." Punkt (13) fäller inte mutationen heller. Körd på det frysta trädet:
årstotalens uttryck bytt mot en `reduce` över `yearlyOre` per post ger
`tests 267, pass 267, fail 0` och `EXIT=0`, utan en enda kryssrad — punkt (13):s
testfall `totalrutan visar totalMonthlyOre och totalYearlyOre för hela listan`
jämför mot ett anrop av `totalYearlyOre`, och de två uttrycken ger samma tal.
Kravets årshalva har alltså fortfarande inget test, och dokumentet påstår nu att
den har ett.
**Varför:** Stycket redovisar korrekt *varför* punkt (14):s form inte går att
skriva för årshalvan, och drog därefter slutsatsen att en annan befintlig punkt
måste vara skyddet — utan att köra samma mutation mot den. Den ursprungliga
lärdomens "Regel framåt" pekade ut ett annat svar ("då ska skyddet skrivas som en
kontroll av källtexten i stället ... läs `src/web/app.js` och kräv att `reduce`
och `for` inte förekommer i samma sats som `TOTAL_MONTHLY` eller `TOTAL_YEARLY`"),
och det alternativet varken byggdes eller avfärdades skriftligt. Ett falskt
påstående ersattes alltså av ett annat falskt påstående om samma krav.
**Regel framåt:** Flyttas ett skydd från en testpunkt till en annan i
`ARKITEKTUR.md` ska den mutation som avslöjade luckan köras mot den nya punkten i
samma ändring, och kryssraden klistras in. Ger körningen `fail 0` får meningen
"det är punkt N som är dess test" inte skrivas — skriv i stället ut att kravet
saknar test och vilken form skyddet ska ta. En lärdoms "Regel framåt" som
föreskriver en konkret konstruktion ska antingen byggas eller avfärdas med skäl i
beslutsloggen; att lämna den obesvarad räknas som att lärdomen inte är åtgärdad.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-10 — process: git checkout -- kastade paket 6:s ospårade arbete på en radslutsdiagnos som är falsk
**Vad gick fel:** Byggaren körde mitt i paket 6 `git checkout -- src/web/app.js` i
tron att `git diff HEAD` visade en skillnad som berodde på radslut. Kommandot
återställde filen till paket 5-versionen i `ced5661` och kastade paket 6:s
ändringar utan fråga och utan möjlighet att ångra — filen var ospårat ändrad, så
varken `git stash` eller `git reflog` kunde nå den. Diagnosen är motbevisad på den
här maskinen: `core.autocrlf` är `true` och `.gitattributes` saknas, arbetsträdets
`src/web/app.js` har enbart LF medan HEAD-versionen checkas ut med CRLF, och ändå
ger `git diff HEAD -- src/server/api.js` — en fil i exakt samma läge men utan
innehållsändring — `0` rader. Git normaliserar radsluten före jämförelsen, så
radslut kan aldrig ensamma ge en diff. Den diff byggaren såg var 70 rader (60
tillagda, 5 borttagna), alltså paket 6:s verkliga arbete. Det enda som verkligen
rörde radslut var varningen `warning: in the working copy of 'src/web/app.js', LF
will be replaced by CRLF the next time Git touches it`, som gäller en framtida
skrivning och inte den visade diffen. Utfallet blev den här gången ingen förlust:
granskarens jämförelse av `src/web/app.js` mot runda 1-kopian (verifierad mot
`granskning-fore.sha256`) ger 31 tillagda rader och exakt två borttagna, och de
två är den kommentar som skulle skrivas om.
**Varför:** `git checkout --` skiljer inte på "återställ en spårad ändring jag inte
vill ha" och "kasta arbete som aldrig blivit incheckat", och paket 6:s filer var
ändrade utan commit sedan paket 5. Varningen om CRLF står i utdatan från samma
kommandon som visar diffen, så den läses som en förklaring till diffen i stället
för som en upplysning om nästa skrivning. Att byggaren hade en fryst kopia var en
tillfällighet som räddade paketet, inte en del av arbetsgången.
**Regel framåt:** Kör aldrig `git checkout --`, `git restore` eller
`git reset --hard` mot en fil som har ospårade ändringar från det pågående
paketet. Ska en ändring undersökas: kopiera först filen till scratchpad-katalogen
och redovisa kopians `sha256sum`, och gör därefter jämförelsen mot kopian.
Misstänks radslut ligga bakom en diff är kontrollen att jämföra antalet `+`- och
`-`-rader från `git diff HEAD -- <fil>` med samma antal från `git diff -w HEAD --
<fil>`: är talen lika beror diffen inte på blanktecken, och `warning: LF will be
replaced by CRLF` är då inte förklaringen. Varje paket som ändrar filer utan att
committa dem tar en kopia av de ändrade filerna innan något git-kommando som
skriver i arbetsträdet körs.

### 2026-09-11 — dokumentation: det osynliga blanksteget rättades i dokumentet och lämnades kvar i testfilen
**Vad gick fel:** Rättningen av lärdomen 2026-09-10 (det hårda blanksteget
skrevs som ett osynligt U+00A0) kördes bara mot `ARKITEKTUR.md`. Efteråt gav en
sökning över hela trädet noll råa U+00A0 i dokumentet men **elva** i
`tests/app.test.js` — rad 269, 405, 406, 437, 442, 447 och 462–464, bland dem
`assert.equal(celltext(rad, 'entry-amount'), '1 234,50 kr');` med två osynliga
tecken i källan. `ARKITEKTUR.md` rad 2507 säger att tecknet "i dokument eller i
test, skrivs därför med escapen `\u00a0`", så regeln pekade ut testfilen lika
uttryckligen som dokumentet.
**Varför:** Fyndet var formulerat som "rad 2073, 2074, 2077 i `ARKITEKTUR.md`",
och rättningen kördes mot den fil raderna låg i. Ett sökande efter samma tecken i
de andra filer regeln nämner gjordes aldrig, eftersom fyndets ordalydelse — inte
regelns — styrde rättningens omfång. Det är samma grundorsak som posten
2026-09-07 ("rättningen av 'beskriver kod som inte längre ser ut så' gjordes till
hälften"): en post som räknar upp ett ställe åtgärdas på det stället, och
ingenting i arbetsgången tvingar fram en sökning efter de övriga. Tredje gången
samma tecken är fel i den här filen på tio dagar: 2026-09-02 (U+0020 där
`formatSek` ger U+00A0), 2026-09-10 (rått U+00A0 där escapen krävs), och nu.
**Regel framåt:** Rätta efter **regeln**, inte efter fyndets radnummer. En regel
som nämner fler än en fil ska rättas med en sökning över samtliga filer den
nämner, och sökningen klistras in i redovisningen — här
`grep -rn $'\xc2\xa0' ARKITEKTUR.md LARDOMAR.md CLAUDE.md src tests`, som ska ge
noll träffar. Ett tecken utanför ASCII i en strängliteral eller i ett dokument
skrivs alltid med escapen; är tecknet en del av det som prövas ska kodpunkten
dessutom stå utskriven intill.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.
**Efterskrift 2026-09-11:** posten ovan skrevs med två råa U+00A0 i sin egen
text — ett i citatet av regeln, ett i det föreskrivna sökkommandot — och fyndet
inträffade alltså en fjärde gång i den mening som förbjuder det. Kommandot var
dessutom oanvändbart: `grep -rnP '\xc2\xa0'` ger `exit 1` och noll träffar på
den här maskinen, medan `grep -rn $'\xc2\xa0'` ger `exit 0` och de två
raderna. Båda är rättade. Det är själva skälet till att regeln behöver ett test:
ett tecken som inte syns går inte att läsa sig till, inte ens av den som just
skrivit ned att det inte går att läsa sig till.

### 2026-09-12 — schedule: klampningsregeln i loopkroppen fälls inte av någon mutation
**Vad gick fel:** Raden `occurrence = addMonthsClamped(entry.startDate, k * step);`
inuti `while`-loopen i `src/core/schedule.js` rad 77 kan bytas mot
`occurrence = addMonthsClamped(occurrence, step);` — alltså mot precis det
`ARKITEKTUR.md` rad 955–958 förbjuder ("Klampningen utgår **alltid från
startdatumets ursprungliga dag** — aldrig från föregående klampade resultat") och
som kommentaren på rad 73–74 i samma fil påstår ("Klampningen räknas om från
startDate varje varv och aldrig från föregående occurrence") — och `npm test` ger
då `tests 331, pass 331, fail 0` och `EXIT=0` utan en enda kryssrad. Mutationen
är ändå synlig för användaren: en kvartalspost med `startDate: '2026-01-31'`
avläst `2026-06-15` ger `2026-07-31` med koden och `2026-07-30` med mutationen.
Instrumenterad i en kopia kördes loopkroppen 74 gånger i hela sviten, och i
0 av dem skilde sig `addMonthsClamped(entry.startDate, k * step)` från
`addMonthsClamped(föregående occurrence, step)`.
**Varför:** Facittabellens rad `2026-01-31 | monthly | 2026-03-01 | 2026-03-31 |
klampningen smittar inte vidare` (`ARKITEKTUR.md` rad 988) och testet
`nextDueDate klampar från startdatumets dag i varje period, aldrig från
föregående resultat` (`tests/schedule.test.js` rad 88) prövar båda regeln — men
för alla deras indata svarar steg 2 (`k = Math.floor(diff / step)`) direkt
och loopen körs aldrig. För `monthly` är det ingen tillfällighet utan en följd av
algoritmen: loopen körs bara när `today.day > occurrence.day`, och när dagen har
klampats är `occurrence.day` månadens sista dag, alltså aldrig mindre än
`today.day`. Klampning och loop kan för `monthly` därför inte inträffa samtidigt;
bara `quarterly` och `yearly` når kombinationen, och inget testfall har ett
`today` som ligger mitt i en sådan period. Regeln är alltså testad på den ena av
sina två kodvägar, och testets namn ("i varje period") döljer det.
**Regel framåt:** Ett villkor som står i både en snabbväg och en korrigerande
loop ska ha ett testfall som kör loopen. Innan ett sådant test räknas som skrivet
ska loopkroppen instrumenteras i en kopia av trädet med en utskrift av både det
faktiska och det förbjudna uttrycket, hela sviten köras, och redovisningen visa
minst ett varv där de två skiljer sig — skrivs `SKILJER` noll gånger är regeln
otestad oavsett hur många rader facittabellen har. För `nextDueDate` är det
obligatoriska fallet `startDate: '2026-01-31'`, `interval: 'quarterly'`,
`today: '2026-06-15'` med svaret `2026-07-31`, och mutationen
`addMonthsClamped(entry.startDate, k * step)` till `addMonthsClamped(occurrence, step)`
ska ge `EXIT=1` med just det testets kryssrad inklistrad.

### 2026-09-12 — gränssnitt: renderUpcomings två nollställningar överlever mutation och kortet motsäger sig självt
**Vad gick fel:** Två rader i `renderUpcoming` (`src/web/app.js`) kan tas bort
utan att något test faller. (1) `UPCOMING_LIST.replaceChildren();` på rad 149
borttagen ger `tests 331, pass 331, fail 0` och `EXIT=0`; mätt med den
incheckade DOM-attrappen blir följden att en lyckad omhämtning efter en
borttagning visar `postlista=1` men `upcoming=3` med namnen
`["Hyra","El","Hyra"]` — alltså en dragning för en post användaren just tagit
bort, plus en dubblett. (2) `else`-grenen på rad 164–166
(`UPCOMING_EMPTY.textContent = '';`) borttagen ger samma gröna svit, och mätt med
attrappen står texten `Inga kommande dragningar ännu.` kvar samtidigt som
kortet visar en rad — medan `#empty-state` i samma vy korrekt töms, eftersom
paket 6:s motsvarande rad har ett test. Motsvarande mutation i `renderEntries`
(`LIST.replaceChildren();` borttagen) ger `EXIT=1` med två kryssrader; det är
alltså bara det nya kortet som står oskyddat.
**Varför:** Alla testfall som rör `#upcoming-list` och `#upcoming-empty` når dem
från ett orört utgångsläge: (21) och (22) renderar en enda gång, (23) renderar en
tom lista en enda gång, och de två `clearView`-fallen sätter utgångsläget via
`clearView`, inte via en andra `renderUpcoming`. `renderUpcoming` anropas därför
aldrig två gånger i rad med olika listor i hela sviten, och en assertion som
kräver att ett element är tomt är sann av sig själv när elementet aldrig har
skrivits. Det är ordagrant det lärdomen `2026-09-10 — test: raden som tömmer
#empty-state i clearView överlever mutation` beskriver, och byggaren tillämpade
den regeln — den citeras i `tests/app.test.js` rad 811–815 — men bara på de två
rader `ARKITEKTUR.md` rad 3696–3698 räknar upp som mutationer ("varje rad i
`clearView` som rör de två nya elementen"). Mutationslistan hämtades ur
dokumentet i stället för ur den ändrade filen, vilket lärdomen `2026-09-04 —
test: två konstruktioner i storage.js körs aldrig och överlever mutation`
förbjuder. Åttonde gången ett delvillkor i projektet visar sig oskyddat av något
test.
**Regel framåt:** Varje renderingsfunktion som skriver om en vy ska ha minst ett
testfall där den anropas två gånger med olika indata, och det andra anropets
utgångsläge ska vara det motsatta av det förväntade resultatet: en kortare lista
efter en längre (fälls av att `replaceChildren` saknas) och en icke-tom lista
efter en tom (fälls av att `else`-grenen saknas). Mutationslistan i paketets
redovisning genereras ur `git diff HEAD -- <fil>`: varje `if`, varje `else`,
varje `replaceChildren` och varje `textContent`-tilldelning i de ändrade raderna
räknas upp och prövas en och en med `EXIT` och kryssrad utskriven. En
mutationslista som står i `ARKITEKTUR.md` är ett minimum, aldrig en avgränsning.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-12 — test: språkargumentet 'sv' i localeCompare skyddas inte, eftersom maskinens eget språk är sv-SE
**Vad gick fel:** `compareUpcoming` i `src/core/schedule.js` rad 118 skriver
`a.entry.name.localeCompare(b.entry.name, 'sv')`, och `tests/schedule.test.js`
rad 272–273 motiverar argumentet med "localeCompare(b.name, 'sv') skrivs med
språket utsatt så att ordningen inte beror på maskinens systemspråk". Mutationen
som tar bort argumentet ger `tests 331, pass 331, fail 0` och `EXIT=0`. Skälet är
mätt: `new Intl.Collator().resolvedOptions().locale` ger `sv-SE` på den här
maskinen, så `'Ångbåt'.localeCompare('Zebra')` ger `1` — samma svar som med
`'sv'` — medan `'Ångbåt'.localeCompare('Zebra', 'en')` ger `-1`. Testet
`upcoming avgör lika datum med name i svensk ordning` kan alltså inte skilja de
två skrivsätten här, och dess två sista assertioner (rad 283–284) skickar in
`'sv'` själva och prövar därmed `String.prototype.localeCompare`, inte
`upcoming`. `app.js` körs i webbläsaren, vars standardspråk är användarens
webbläsarspråk: tas argumentet bort i ett senare paket sorteras kortet Kommande
dragningar efter engelsk ordning för varje användare med engelsk webbläsare, utan
att sviten säger något.
**Varför:** Testet prövar resultatet av sorteringen, och resultatet är
detsamma så länge körmiljöns standardspråk råkar sammanfalla med det utskrivna
språket. Ett testfall vars utfall beror på en egenskap hos maskinen är inget
skydd för den rad som finns just för att göra utfallet oberoende av maskinen —
samma grundorsak som `2026-09-07 — test: textspärren mot saveEntries i api.js går
förbi med ett alias`, där spärren prövades bara med den stavning den själv var
skriven för.
**Regel framåt:** Ett argument som finns för att göra ett utfall oberoende av
körmiljön får aldrig prövas genom utfallet ensamt. Skriv i stället ett testfall
som jämför mot den explicita kollatorn och mot ett motexempel:
`assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true)`
tillsammans med
`assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true)`,
och asserta därefter att `upcoming` ger den svenska ordningen och att den
skiljer sig från den ordning `Intl.Collator('en')` ger för samma namn — då fäller
mutationen "ta bort `'sv'`" oavsett maskinens språk. Varje testfil som bygger på
`localeCompare`, `Intl`, `toLocaleString` eller tidszon ska dessutom skriva ut
`new Intl.Collator().resolvedOptions().locale` och
`Intl.DateTimeFormat().resolvedOptions().timeZone` i paketets redovisning, så att
det syns vilken miljö körningen mätte.

### 2026-09-12 — dokumentation: "omfattar den fem element" står tre rader ovanför en uppräkning med sex
**Vad gick fel:** `ARKITEKTUR.md` rad 3662 lyder "och efter paket 7 omfattar den
fem element:" och följs direkt av ett kodblock med sex rader — `#entry-list`,
`#empty-state`, `#total-monthly`, `#total-yearly`, `#upcoming-list` och
`#upcoming-empty`. Körd: `awk 'NR>=3664 && NR<=3671' ARKITEKTUR.md | grep -c '^#'`
ger `6`, och `clearView` i `src/web/app.js` rad 178–185 rör sex element. Koden
och uppräkningen stämmer; det är siffran i den bindande meningen som är fel.
**Varför:** Meningen skrevs om från paket 6:s fyra element och siffran räknades
upp med ett för `#upcoming-list` utan att `#upcoming-empty` räknades med, fast
båda står i uppräkningen på nästa rad. Det är exakt det fel lärdomen `2026-09-10
— dokumentation: "Två nya id:n" i samma stycke som kräver tre FakeElement`
beskriver, och den lärdomens regel ("Skriv aldrig ett antal ... när uppräkningen
står i samma stycke") följdes på rad 3677 i samma avsnitt — "Två nya id:n i
`index.html` betyder två nya `FakeElement`", som är rätt: `grep -o ' id="[^"]*"'
src/web/index.html | wc -l` ger `18` mot `16` för samma kommando mot
`git show dd5ddaf:src/web/index.html` — men inte tolv rader längre upp. Fjärde
gången ett antal i `ARKITEKTUR.md` är fel.
**Regel framåt:** En mening som inleder en uppräkning får inte bära
uppräkningens antal, oavsett om den är fetstilt eller vanlig brödtext: skriv
"och efter paket 7 omfattar den dessa element:" och låt blocket bära antalet.
Varje befintlig mening i filen som innehåller ett räkneord omedelbart före ett
kodblock eller en tabell ska prövas med ett kommando som räknar blockets rader,
och båda talen klistras in. Kontrollen körs på hela filen, inte bara på det
avsnitt paketet ändrar, med mönstret
`(två|tre|fyra|fem|sex|sju|åtta|nio|tio|[0-9]+) *(nya |sista |första )?(element|rader|id:n|fall|punkter|exporter|stavningar|ställen)`.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-12 — dokumentation: fyra framtidspåståenden om paket 7 är nu falska, och den nya rutinen fångar inget av dem
**Vad gick fel:** `ARKITEKTUR.md` säger på fyra ställen att paket 7-arbetet ännu
inte är gjort, fast det är gjort: rad 94 "`dates.test.js`     Paket 2, byggs ut i
paket 7."; rad 1575–1576 "de fem exporter som tillkommer i paket 7 får sina
testfall i `tests/dates.test.js` i paket 7"; rad 2530 "De fem sista har sin
första användare i paket 7 och byggs där"; och skarpast rad 2552–2554 "Att paket
2-hälften är byggd och paket 7-hälften inte är **rätt tillstånd** i dag ...
i paket 7 utökas samma fil med testfall för de fem tillkommande". Körd:
`grep -o "^export \(function\|const\) [a-zA-Z_]*" src/core/dates.js` ger nio
exporter inklusive `toIsoDate`, `addMonthsClamped`, `compareIsoDates`,
`daysBetween` och `todayIso`, och `grep -c` i `tests/dates.test.js` ger `32`,
`36`, `19`, `27` respektive `20` träffar för samma fem namn. Den rutin
arkitekten skrev i samma runda för att fånga just den här sortens åldrade markör
— `grep -nE "\*\*[^*]+ i paket [0-9]" ARKITEKTUR.md`, rad 3822, med löftet på rad
3815–3816 att "En fjärde stavning ska träffas av samma kontroll utan att någon
ändrar den" — träffar ingen av de fyra raderna ovan:
`grep -nE "\*\*[^*]+ i paket [0-9]" ARKITEKTUR.md | grep -cE "^(94|1575|1576|2530|2552|2553|2554):"`
ger `0` och `exit 1`. Åttonde gången filen innehåller ett påstående om koden som
koden inte uppfyller.
**Varför:** Mönstret är förankrat i fetstilsmarkeringen, alltså i typografin,
medan rutinens egen text säger att det är rollen som avgör.
Filens tre tidigare stavningar råkade alla vara fetstilta, så förankringen såg ut
att vara gratis; men en åldrande markör kan lika gärna stå som vanlig brödtext i
presens eller futurum ("byggs där", "utökas", "får sina testfall", "är rätt
tillstånd i dag"), och då faller den utanför. Rutinen prövades bara mot de tre
stavningar som fanns när den skrevs — samma fel som lärdomen `2026-09-07 — test:
textspärren mot saveEntries i api.js går förbi med ett alias`: en spärr prövad
enbart med den stavning den själv är skriven för.
**Regel framåt:** En kontroll som ska fånga "varje markör oavsett stavning" ska
prövas med minst en stavning som inte liknar de redan kända, och den
stavningen ska tas ur filen som den ser ut i dag: innan rutinen skrivs ned körs
`grep -nE "paket [0-9]" ARKITEKTUR.md`, varje träff läses, och de träffar rutinen
missar räknas upp i beslutsloggen som antingen rättade eller undantagna med skäl.
Förankra aldrig ett sådant mönster i typografi (fetstil, backticks, rubriknivå) —
förankra det i orden som bär rollen. Den konkreta utökningen här är att köra
`grep -nE "(byggs|byggs ut|utökas|tillkommer|får sina|ska byggas|rätt tillstånd)[^.]{0,60}paket [0-9]|paket [0-9][^.]{0,40}(byggs|utökas|tillkommer)" ARKITEKTUR.md`
vid sidan av det befintliga kommandot, och att skriva om varje träff vars
paketnummer är påbörjat eller avslutat till dåtid med det körda utfallet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — dokumentation: U+2013 står rått i ARKITEKTUR.md, även i meningen som förbjuder det
**Vad gick fel:** `ARKITEKTUR.md` rad 3560 skriver kodblocket
`const UNKNOWN_TOTAL = '<rått U+2013>';` under rubriken "`UNKNOWN_TOTAL` är
`app.js`:s tredje egna sträng och bindande ordagrant", medan koden på
`src/web/app.js` rad 32 lyder `const UNKNOWN_TOTAL = '\u2013';` — det bindande
kodblocket är alltså inte det koden innehåller. Rad 3564 lyder "**Det skrivs med
escapen `<rått U+2013>` i koden, aldrig som det råa tecknet**", där ordet
"escapen" i meningen är själva råtecknet, och samma rå kodpunkt står även på rad
2084 och 3573 i påståenden om vad totalelementen visar. Verifierat med en sökning
efter byten `\xe2\x80\x93` i filen, rörledd genom `cat -v`, som ger `M-bM-^@M-^S`
på de fyra raderna. Felet finns sedan commit `dd5ddaf` (paket 6) och överlevde
granskningen av paket 7 i två rundor. Samma runda: `src/core/money.js` rad 15
skriver en negativ `formatSek`-sträng som `"<rått U+2212>0,00<U+0020>kr"`, där
`ARKITEKTUR.md` rad 2508 och 2516 kräver `"\u22120,00\u00a0kr"` — två avvikelser i
samma elva tecken. Träffarna på U+2013 i löptext (`1-60 tecken`, `paket 2-8`) och
i kommentarer i `src/` och `tests/` (`regel 1-3`, `Läs-ändra-skriv`) är typografi
och ligger utanför regeln; de fyra ovan och `money.js` rad 15 är strängar en
funktion producerar.
**Varför:** Regeln om osynliga tecken har hittills formulerats om ett tecken i
taget — `\u00a0` 2026-09-02, `\u00a0` igen 2026-09-10 och 2026-09-11, `\u2212`
2026-09-02 — och varje rättning har sökt efter just det tecken posten namngav.
`\u2013` fick sin egen regel på rad 3564 i paket 6 och bröts i samma mening, i
samma stund den skrevs, eftersom skribenten skrev *tecknet* där hen menade
*escapen* och skillnaden inte syns i en genomläsning. Sökningen efter U+00A0 körs
numera över hela trädet och ger noll träffar; ingen motsvarande sökning finns för
U+2013 eller U+2212, så de två tecknen har ingen mätning alls.
**Regel framåt:** Regeln gäller **varje** icke-ASCII-tecken som ingår i en sträng
en funktion producerar, inte det tecken som senast råkade bli fel. Kontrollen är
en enda sökning med alla tre kodpunkternas byten i en alternering
(`\xc2\xa0`, `\xe2\x80\x93`, `\xe2\x88\x92`) mot `ARKITEKTUR.md`, `src` och
`tests`, rörledd genom `cat -v`, och den körs innan varje paket lämnas vidare.
Varje träff ska antingen bytas mot escapen (`\u00a0`, `\u2013`, `\u2212`) eller
stå på en rad där den är ren typografi i löptext (intervall, tankstreck), och den
bedömningen skrivs ut per träff i redovisningen. Ett kodblock i `ARKITEKTUR.md`
som sägs vara "bindande ordagrant" ska jämföras byte för byte mot raden i `src/`
det beskriver, med båda raderna körda genom `cat -v` och utdatan inklistrad.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — dokumentation: fem antal skrevs in i ARKITEKTUR.md utan kommandot, och två av fem stämmer inte
**Vad gick fel:** Rättningen av framtidspåståendena om `dates.js` skrev in i
`ARKITEKTUR.md` rad 2553–2560: "en räkning av `toIsoDate`, `addMonthsClamped`,
`compareIsoDates`, `daysBetween` och `todayIso` i `tests/dates.test.js` ger `32`,
`36`, `19`, `27` respektive `20` träffar". Ordet "träffar" har två läsningar och
talen stämmer bara för den ena. Körd på det frysta trädet: `grep -c` ger
`32 36 19 27 20`, medan `grep -o` rörledd till `wc -l` ger `32 37 19 27 21` —
`addMonthsClamped` och `todayIso` skiljer sig, eftersom två rader i filen
innehåller namnet två gånger. Kommandot som gav talen står inte utskrivet, så en
läsare kan inte avgöra vilken läsning som gäller och får `36` mot `37` när hen
kontrollerar.
**Varför:** Posten 2026-09-07 (antalet markörer räknades utan alla böjningsformer)
gav regeln "Ett antal i `ARKITEKTUR.md` ska alltid skrivas tillsammans med det
kommando som gav antalet, ordagrant och körbart". Rättningen skrev talen men
beskrev kommandot i prosa ("en räkning av X ger N träffar"), och prosa är precis
det formatet regeln finns för att ersätta: ett tal utan sitt kommando är inte
kontrollerbart, och "träffar" är dessutom tvetydigt på just den punkt där de två
kommandona ger olika svar. Femte gången ett antal i den här filen är fel
(2026-09-07, 2026-09-10 två gånger, 2026-09-12).
**Regel framåt:** Ett antal i `ARKITEKTUR.md` skrivs aldrig med ordet "träffar"
eller "förekomster" utan det kommando som producerade det, i en form som går att
klistra in i ett skal: `grep -c` ger rader, `grep -o` rörledd till `wc -l` ger
förekomster, och de två är olika tal. Skriv ut vilket av dem som avses genom att
skriva ut kommandot, kör det efter att meningen är färdig, och klistra in utdatan.
Ska antalet bara visa att något finns i filen ska meningen skrivas utan tal
("varje namn i blocket ovan förekommer i `tests/dates.test.js`") — ett påstående
utan siffra blir inte fel av nästa tillägg.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — test: samma bindande användartext fick två skrivsätt i tests/app.test.js
**Vad gick fel:** Det nya testfallet `en sparning med lyckad omhämtning tar bort
tomtexten ur #upcoming-empty` skriver på `tests/app.test.js` rad 943
`'Inga kommande dragningar \u00e4nnu.'`, medan rad 808 och 827 i samma fil skriver
samma sträng rått (`ännu`), liksom ägaren `src/web/app.js` rad 28 och den bindande
texten i `ARKITEKTUR.md` rad 3660. Följden är mätt:
`grep -rn "Inga kommande dragningar ännu." src tests ARKITEKTUR.md` ger fyra
träffar — `src/web/app.js:28`, `tests/app.test.js:808`, `tests/app.test.js:827`
och `ARKITEKTUR.md:3660` — och missar rad 943. En framtida ändring av texten
rättar alltså tre av fyra assertioner och lämnar den fjärde med den gamla
lydelsen. Samma runda skrevs `'listan h\u00e4mtades inte om efter borttagningen'`
och `'listan h\u00e4mtades inte om efter sparningen'` med escape, medan 31 andra
assertionsmeddelanden i samma fil och alla fyra nya testnamn skriver `ä` rått.
**Varför:** Kommentaren över rad 941–942 åberopar lärdomen 2026-09-11 med
motiveringen "ett tecken utanför ASCII i en strängliteral går inte att se i en
genomläsning". Den motiveringen gäller *osynliga* tecken — U+00A0, U+2013, U+2212
— och `ä` är inte ett av dem: det syns, det skiljer sig från sina grannar, och
`ARKITEKTUR.md` rad 2508 och 2516 avgränsar escape-kravet till `formatSek`:s
blanktecken och minustecken. Regeln tillämpades alltså på tecknets *kodpunkt* i
stället för på dess *roll*, och bara på tre av filens många strängar — och just
den ena av de tre är en kopia av en bindande text som redan har en ägare. Tredje
gången samma sträng får två skrivsätt i samma ändring (2026-09-10, 2026-09-11).
**Regel framåt:** Escape används för tecken som inte går att se (U+00A0, U+2013,
U+2212 och liknande), aldrig för bokstäver i svenska ord. En sträng som redan har
en ägare i `src/` skrivs i ett test **tecken för tecken som ägaren skriver den**,
så att en sökning på hela strängen i `src`, `tests` och `ARKITEKTUR.md` hittar
varje ställe den prövas; kontrollen är att köra just den sökningen och kräva lika
många träffar som det finns assertioner mot strängen. Blir en sträng olika skriven
på två ställen i samma fil är det ett fel oavsett vilket av skrivsätten som är
rätt.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — test: steg 2 i nextDueDate kan tas bort utan att något test faller, och det nya fallet påstår sig förankra k
**Vad gick fel:** `ARKITEKTUR.md` rad 980–981 är bindande och står under
"Konsekvenser som följer av algoritmen och som **ska testas i paket 7**":
"Startdatum flera perioder tillbaka → steg 2 hoppar direkt till rätt trakt, steg 3
justerar. Inget varv-för-varv-räknande från 1970." Ingen sådan test finns. Körd
mutation på det frysta trädet: `src/core/schedule.js` rad 69,
`let k = Math.max(0, Math.floor(diff / step));` bytt mot `let k = 0;`, ger
`npm test` med `ℹ tests 335`, `ℹ pass 335`, `ℹ fail 0` och `EXIT=0` — algoritmen
räknar då varv för varv från 1970 (679 varv för testets egen post) utan att ett
enda testfall märker det, inklusive fallet som heter `nextDueDate hoppar direkt
till rätt trakt för en start långt tillbaka`, som bara asserterar returvärdet. Det
nya fallet `nextDueDate klampar från startDate också i korrigeringsloopen` skriver
`assert.equal(nextDueDate(kvartal, '2026-04-30'), '2026-04-30', 'k = 1 ger den
klampade 2026-04-30')` och motiverar raden i kommentaren med "så att k:s värde
inte bara står i en kommentar". Assertionen kan inte se `k`: med `let k = 0;`
returnerar samma anrop fortfarande `2026-04-30` (loopen går från 0 till 1), så
raden passerar med varje `k`-uttryck som ger rätt slutvärde.
**Varför:** `k` är modulintern och syns aldrig i en returvärdesassertion, och steg
2 är en ren optimering: en uttömmande körning över `monthly`, `quarterly` och
`yearly` med startdatum 2022–2028 och dagens datum 2022–2031 ger noll indata där
`let k = 0` ändrar svaret. Egenskapen som ska skyddas är alltså inte ett värde
utan ett **arbete** — antalet varv — och ingen assertion i projektet mäter arbete.
Kravraden i `ARKITEKTUR.md` skrevs som en konsekvens i en punktlista och fick
aldrig en rad i någon mutationslista, så byggaren namngav i stället en
värdeassertion som bevis. Åttonde gången ett villkor i projektet visar sig
oskyddat av något test.
**Regel framåt:** En egenskap som inte syns i ett returvärde ska mätas, inte
påstås. `tests/schedule.test.js` ska räkna loopvarven: gör `occurrence`-steget
observerbart genom att `nextDueDate` tar emot `addMonthsClamped` som ett
injicerbart argument med `addMonthsClamped` som förval, och asserta att ett anrop
med `startDate: '1970-01-31'` och `interval: 'monthly'` gör **högst 3** anrop.
Mutationen `let k = Math.max(0, Math.floor(diff / step));` till `let k = 0;` ska
ge `EXIT=1` och fälla just det fallet, med kryssraden inklistrad. Ett
assertionsmeddelande får aldrig namnge en modulintern variabel (`k = 1 ger …`)
förrän en mutation av just den variabelns uttryck har fällt just den raden; går
mutationen inte att fälla ska meddelandet skrivas om till det assertionen faktiskt
prövar.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — test: fyra obligatoriska testfall byggdes utan sin rad i ARKITEKTUR.md, och två av dem numrerar punkter som inte finns
**Vad gick fel:** `tests/app.test.js` rad 879 och 924 inleder de två nya fallen
med `// (24)` respektive `// (25)`, vilket i det här projektet är hänvisningen
till en numrerad punkt i kravlistan för filen. Punkterna finns inte:
`grep -c "(24)" ARKITEKTUR.md` och `grep -c "(25)" ARKITEKTUR.md` ger båda `0`,
medan varje nummer `(1)`–`(23)` ger minst en träff, och `ARKITEKTUR.md` rad 3696
slår fast att paket 7:s kravlista är "punkt (21)–(23)". De två nya
`schedule`-fallen är i samma läge utan att ha ett nummer alls:
`grep -n "schedule.test.js" ARKITEKTUR.md` ger en enda träff, raden i trädvyn, så
filen har ingen kravlista och ingen mutationslista. Fallen är inte valfria — var
och en av de fyra är det enda som fäller en mutation:
`UPCOMING_LIST.replaceChildren()` borttagen, `else`-grenens
`UPCOMING_EMPTY.textContent = ''` borttagen,
`addMonthsClamped(entry.startDate, k * step)` på rad 77 bytt mot
`addMonthsClamped(occurrence, step)`, och `'sv'` struket ur `localeCompare`,
samtliga `EXIT=1` med de nya testfilerna och `EXIT=0` med förra rundans.
Kollationsfallet bygger dessutom på en konstruktion som är ny i projektet —
`String.prototype.localeCompare` och `Intl.Collator` ersätts under sorteringen —
och den står inte beskriven någonstans i det bindande dokumentet.
**Varför:** Kravlistan skrevs när paketet planerades, och granskningen som krävde
de fyra fallen kom efteråt; byggaren fortsatte numreringen i testfilen i stället
för att lämna tillbaka till arkitekten för nya punkter. Ett nummer utan punkt är
värre än inget nummer: det ser ut som en hänvisning och får nästa läsare att tro
att kravet är nedskrivet. Det är samma mönster som posten 2026-09-07 om den
fjärde hängningsspärren, där en ny testkonstruktion byggdes utan den rad
`ARKITEKTUR.md` kräver för den, och `CLAUDE.md` säger att `ARKITEKTUR.md` ändras
först och byggs sedan.
**Regel framåt:** Ett testfall som en granskning kräver får inte skrivas förrän
det har en punkt i kravlistan i `ARKITEKTUR.md`, med numret, mutationen det ska
fälla och det förväntade felmeddelandet utskrivna. Innan en testfil lämnas vidare
plockas varje `(N)` ut ur filen med `grep -oE` och söks i `ARKITEKTUR.md`; ett
nummer utan träff stoppar paketet. En testfil som saknar kravlista i
`ARKITEKTUR.md` — här `tests/schedule.test.js` — ska få en innan nästa paket rör
den. Inför ett test en konstruktion projektet inte använder någon annanstans
(här: ersättning av inbyggda prototyper) ska den ha ett eget stycke i
`ARKITEKTUR.md` med syfte, återställning och det den inte kan upptäcka, innan
koden skrivs.

### 2026-09-14 — test: midnattsspärren står före den rendering det nya fallet asserterar på
**Vad gick fel:** `tests/app.test.js` rad 751–753 definierar
`kravIngenMidnatt(idag)` med kommentaren "Dagens datum läses en gång när posterna
byggs och en gång **efter körningen**". I det nya fallet `en borttagning med
lyckad omhämtning lämnar bara de kvarvarande posternas dragningar` anropas den på
rad 894, alltså efter den första renderingen men **före** klicket, omhämtningen
och den andra renderingen — och det är den andra renderingen assertionen på rad
912 prövar: `assert.deepEqual(namnen, upcoming(kvar, idag).map(...))`. Den
vänstra sidan renderas med `todayIso()` läst inne i `renderUpcoming` efter
klicket, den högra räknas med `idag` som lästes före. Passerar midnatt däremellan
byter raderna plats: körd med posterna testet använder (`monthly`, `Ström` med
`startDate` lika med idag och `Hyra` med idag plus en dag) ger
`upcoming(kvar, '2026-09-14')` ordningen `[ 'Ström', 'Hyra' ]` och
`upcoming(kvar, '2026-09-15')` ordningen `[ 'Hyra', 'Ström' ]`. Testet faller då
på en `deepEqual` över namnordning i stället för på spärrens egen text "testet
korsade midnatt mellan uppställningen och körningen". Samma placering i det andra
nya fallet, rad 940.
**Varför:** Spärren kopierades från punkt (21) och (22), där den står sist i
testet och där det bara finns en rendering — placeringen "efter `starta(...)`" är
då detsamma som "efter körningen". De nya fallen har två renderingar, och den
andra kommer efter ett `await flush()`; att kopiera radens *position* i stället
för dess *roll* flyttade spärren till ett ställe där den inte längre täcker det
den finns för. Att sannolikheten är liten gör felet svårare, inte mildare:
spärren finns just för att förvandla ett sällsynt fel till ett läsbart besked,
och där den står nu gör den det inte.
**Regel framåt:** En spärr mot att klockan tickar under ett test placeras efter
den **sista** klockläsning testet jämför mot, aldrig efter den första — i ett
test med två renderingar betyder det ett anrop efter varje `await flush()` som
utlöser en rendering. Kontrollen är mekanisk och körs när ett tidsberoende
testfall skrivs: räkna upp varje ställe i testet där produktionskoden läser
`todayIso()`, och kräv ett `kravIngenMidnatt`-anrop efter vart och ett. En
hjälpfunktion vars dokumentationskommentar säger "efter körningen" får inte
anropas mitt i körningen.

### 2026-09-14 — test: loopkroppens väg genom addMonths skyddas av inget test, och tas den bort överlever också den mutation (S3) byggdes för
**Vad gick fel:** Mutationen `occurrence = addMonths(entry.startDate, k * step);`
→ `occurrence = addMonthsClamped(entry.startDate, k * step);` i loopkroppen i
`src/core/schedule.js` rad 102 ger `tests 339, pass 339, fail 0` och `EXIT=0` —
ingen kryssrad. Den är beteendeidentisk, men den avväpnar hela paketets skydd:
körs den först och därefter `let k = Math.max(0, Math.floor(diff / step));` →
`let k = 0;` ger sviten `tests 339, pass 339, fail 0` och `EXIT=0`, medan samma
`k`-mutation ensam ger `EXIT=1` och `✖ nextDueDate hoppar till rätt period i
stället för att räkna varv för varv`. Kommentaren på rad 87–89 påstår att båda
vägarna behövs — "Går bara det ena genom parametern kan en räknande omslutning
inte skilja ett hopp från 674 varv" — och det är mätt falskt för den andra
halvan: med steg 2:s anrop återställt till `addMonthsClamped` och `k = 0` faller
testet fortfarande (`EXIT=1`, `fail 1`, samma kryssrad), eftersom loopkroppen då
räknar 679 anrop.
**Varför:** (S3) mäter med ett tak (`anrop <= 3`) på en indata där
korrigeringsloopen aldrig körs: `startDate: '1970-01-31'`, `monthly`, `today
2026-08-18` ger `occurrence = 2026-08-31 >= today`, alltså exakt ett anrop och
noll varv. Ett tak kan bara fällas nedifrån av fler anrop, aldrig av färre, så
varje ändring som gör att ett anrop slutar räknas är osynlig för fallet.
Loopkroppens routning är därmed den enda av de två som bär detektorn, och den är
den enda som inget testfall rör — kommentaren pekar dessutom ut fel halva som
bärande, så en framtida byggare som städar loopkroppen tillbaka till
`addMonthsClamped` får grön svit och tar bort skyddet i samma ändring. Åttonde
gången ett delvillkor i projektet visar sig oskyddat av något test.
**Regel framåt:** Ett tak på en räknare (`anrop <= N`) skyddar bara mot att
arbetet växer. Varje anropsställe som ska räknas ska därför dessutom ha en undre
gräns på en indata där just det stället körs: för (S3) betyder det ett andra fall
med en post vars korrigeringsloop kör minst ett varv — `startDate: '1970-01-15'`,
`monthly`, `today '2026-08-18'` ger två anrop — och en assertion `anrop >= 2` med
loopkroppen utpekad i meddelandet. Mät före rättningen hur många anrop varje
indata ger, och kräv att varje anropsställe i produktionskoden är det enda som
kan få någon av gränserna att brytas. En kommentar i `src/` som påstår att två
kodställen båda är nödvändiga ska skrivas med mutationsutfallet för vart och ett
utskrivet på formen `mutation: <gammalt> -> <nytt> ger EXIT=<kod>`; visar
körningen att bara det ena är bärande ska kommentaren skrivas om till det, inte
tvärtom.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — dokumentation: (S1):s mutation i ARKITEKTUR.md citerar ett uttryck som inte längre finns i koden
**Vad gick fel:** `ARKITEKTUR.md` rad 1100 är (S1)-raden i den bindande
mutationstabellen för `tests/schedule.test.js` och anger mutationen
`addMonthsClamped(entry.startDate, k * step)` i loopkroppen →
`addMonthsClamped(occurrence, step)`, men signaturändringen i samma paket skrev
om loopkroppen till `addMonths(entry.startDate, k * step)`. Körd på det frysta
trädet: `grep -n "addMonthsClamped(entry.startDate" src/core/schedule.js` ger
noll träffar, medan `grep -n "addMonths(entry.startDate" src/core/schedule.js`
ger rad 90 och 102. Mutationen går alltså inte att tillämpa ordagrant, trots att
avsnittet slår fast "Varje mutation körs en i taget". Samma föråldrade uttryck
står i `tests/schedule.test.js` rad 113.
**Varför:** Beslutet att injicera `addMonths` ändrade texten på båda
anropsställena, och de avsnitt som beskriver beslutet skrevs om — men
mutationstabellen tre skärmhöjder längre ned beskriver koden och lästes inte om
mot den. Regeln från 2026-09-07 ("Byter ett namn i `src/` ska
`grep -n "<gamla namnet>" ARKITEKTUR.md` köras och varje träff åtgärdas") gäller
namn; här bytte inte ett namn utan ett uttryck, och ingen sökning täcker det.
Åttonde gången `ARKITEKTUR.md` innehåller ett påstående om koden som koden inte
uppfyller.
**Regel framåt:** Varje mutation i en mutationstabell ska vara ett uttryck som
går att hitta i filen den gäller. Kontrollen är mekanisk och körs innan paketet
lämnas vidare: för varje rad i varje mutationstabell, kör
`grep -c "<uttrycket före pilen>" <filen raden gäller>` och kräv minst `1`; ger
den `0` är raden falsk och rättas. Ändras ett anropsuttryck i `src/` ska det
gamla uttryckets kärna sökas i `ARKITEKTUR.md` och i testfilernas kommentarer med
samma körning, inte bara det gamla namnet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — dokumentation: "674 varv" är antalet för ett annat today än det meningen själv namnger
**Vad gick fel:** `ARKITEKTUR.md` rad 1020–1026 redovisar mutationskörningen och
avslutar "där `nextDueDate` för en månadspost från `1970-01-15` dessutom
fortfarande gav `2026-09-15`. Skillnaden är inte ett värde utan ett arbete: 674
varv i stället för ett hopp." Talet hör till ett annat `today`. Kört på det frysta
trädet, med `let k = 0` simulerat: `start 1970-01-15 today 2026-09-15: varv=680
anrop=681` och `start 1970-01-15 today 2026-03-15: varv=674 anrop=675`. Rätt tal
för den körning meningen namnger är alltså `680`, inte `674`. Samma föråldrade tal
är avskrivet i `src/core/schedule.js` rad 89 ("ett hopp från 674 varv"), medan
`tests/schedule.test.js` och mutationskörningens eget meddelande säger `679
perioder` respektive `680 gånger` — projektet har tre olika tal för samma sak, och
två av dem står i bindande text.
**Varför:** Stycket skrevs om i det här paketet och ärvde talet från ett tidigare
utkast där `today` låg i mars. Datumet i meningen uppdaterades, talet gjorde det
inte, och de två står tre rader från varandra. Paketets svar på lärdomen
2026-09-14 ("fem antal skrevs in i ARKITEKTUR.md utan kommandot") var att stryka
tal i stället för att skriva ut kommandot — och i samma runda skrevs ett nytt tal
in utan sitt kommando, i det stycke beslutet handlade om. Sjätte gången ett antal
i `ARKITEKTUR.md` är fel.
**Regel framåt:** Ett antal som beskriver en körning ska stå i samma mening som
den indata som gav det, och båda ska komma ur samma körning: skriv
`start <startDate>, today <today>: <N> varv` och klistra in raden ur körningen,
aldrig ett tal som beskrivs i löptext bredvid ett datum. Ändras ett datum i en
sådan mening ska talet räknas om i samma ändring. Ett tal som avskrivs från
`ARKITEKTUR.md` till en kodkommentar i `src/` ska ha samma körning bakom sig: kör
`grep -rn "<talet>" ARKITEKTUR.md src tests` efter rättningen och kräv att varje
kvarvarande träff hör till samma körning.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-14 — schedule: spärren för det injicerade addMonths täcker bara halva sin egen motivering
**Vad gick fel:** `typeof addMonths !== 'function'` i `src/core/schedule.js` rad
78 är skriven med motiveringen på rad 76–77 att `1n` och `Symbol('x')` annars
skulle ge `TypeError` i stället för `RangeError`. Två körda indata tar sig förbi
spärren ändå. (1) En klass: `typeof (class C {})` är `'function'`, så raden
släpper igenom den, och anropet på rad 90 ger `TypeError: Class constructor C
cannot be invoked without 'new'` — exakt den feltyp raden finns för att undvika.
(2) En funktion som inte flyttar `occurrence` framåt hänger för alltid:
`nextDueDate(giltigPost, '2026-09-14', () => '1970-01-01')` avbröts av
`timeout 8` med `EXIT=124` och skrev aldrig något svar. Kommentaren på rad 91–93
säger fortfarande "`occurrence` växer med minst 28 dagar per varv, så loopen
terminerar" — ett påstående som efter signaturändringen bara gäller förvalet
`addMonthsClamped`, inte den parameter meningen nu står bredvid. Inget testfall
skickar in en klass eller en icke-framåtskridande funktion: listan på rad 264 är
`[1n, Symbol('x'), null, 'addMonthsClamped', 42, true, NaN, {}, [], new Date()]`.
**Varför:** Parametern infördes för att göra arbete mätbart, och kontrollen av den
skrevs mot den enda fråga beslutet ställde — "är värdet en funktion". Men en
injicerad funktion har ett kontrakt med tre led, inte ett: den ska gå att anropa,
den ska ge ett datum, och den ska flytta `occurrence` framåt. Led två fick en
uttrycklig ägare, och den håller — kört: `() => 'skräp'`, `() => new Date()`,
`() => null` och `() => '2026-02-30'` ger alla `compareIsoDates`-meddelandet,
eftersom varje `occurrence` passerar `compareIsoDates` innan den returneras. Led
ett och tre fick ingen ägare alls, och termineringsbeviset i kommentaren skrevs
för en fast funktion och lämnades kvar när funktionen blev en parameter. Att
`src/` inte skickar något tredje argument gör hålet onåbart i produktion men inte
i testkod, och en hängning ger ingen exitkod alls (`LARDOMAR.md` 2026-09-04).
**Regel framåt:** En injicerad funktion prövas på hela sitt kontrakt, inte bara på
`typeof`. För `nextDueDate` betyder det att testlistan för `addMonths` ska
innehålla `class C {}` utöver `1n` och `Symbol('x')`, och att ett kontrakt som
kräver framåtskridande antingen bevakas i koden eller att kommentarens
termineringsbevis skrivs om till att gälla förvalet och ingenting annat. Ett
`typeof x === 'function'` räknas aldrig som "går att anropa": klasser är
funktioner som kastar `TypeError` vid anrop, precis som `BigInt` och `Symbol`
kastar i aritmetik. Varje kommentar i `src/` som bevisar att en loop terminerar
ska namnge vilken av loopens storheter beviset vilar på och om den storheten är
en parameter.

### 2026-09-15 — dokumentation: (S3):s kravlista föreskriver den form granskningen underkände, inte den som byggdes
**Vad gick fel:** `tests/schedule.test.js` skrevs om efter runda 3 så att (S3) nu
mäter två poster med var sin räknare och har en undre gräns `medVarv.anrop >= 2`
utöver taket — rättningen fungerar, mätt: mutationerna `let occurrence =
addMonths(entry.startDate, k * step);` → `addMonthsClamped(...)` (steg 2) och
`occurrence = addMonths(entry.startDate, k * step);` → `addMonthsClamped(...)`
(loopkroppen) ger var för sig `EXIT=1`, `fail 1` och
`✖ nextDueDate hoppar till rätt period i stället för att räkna varv för varv`.
Men `ARKITEKTUR.md` rad 1198–1205, det enda stycke som föreskriver hur (S3) ska
byggas, beskriver fortfarande den underkända formen: "skickar in en omslutning
kring `addMonthsClamped` som räknar sina anrop, kör `startDate: '1970-01-31'` med
`interval: 'monthly'` mot ett fast `today` … **och** att antalet anrop är **högst
3**". Den andra posten, den andra räknaren och den undre gränsen står ingenstans:
`grep -n "undre gräns\|anrop >= 2\|två poster" ARKITEKTUR.md` ger noll träffar,
och filens enda `1970-01-15` är rad 1028, i ett annat sammanhang.
Mutationstabellens (S3)-rad (rad 1173) namnger fortfarande bara
`let k = Math.max(0, Math.floor(diff / step));` → `let k = 0;`, trots att (S3)
efter omskrivningen ensamt fäller tre mutationer; de två nytillkomna står bara i
en kodkommentar i `src/core/schedule.js` rad 92–96 och i ingen bindande lista.
Beslutsloggen fick poster för rundans tre övriga fynd men ingen för det här.
**Varför:** Stycket skrevs när (S3) hade en post, och rättningen gjordes i
testfilen efter en granskning — precis det läge där regeln från 2026-09-14 ("Ett
testfall som en granskning kräver får inte skrivas förrän det har en punkt i
kravlistan i `ARKITEKTUR.md`, med numret, mutationen det ska fälla … utskrivna")
gäller. Klassfallet från samma runda fick sitt stycke, eftersom arkitekten fattade
det beslutet; (S3)-omskrivningen gjordes av byggaren ensam, och det som annars
tvingar fram en omläsning av det styrande stycket — paketets redovisning — uteblev
när de två byggaragenterna dog med "stalled, no progress for 600s" utan
slutrapport. Följden är att kravlistan nu beskriver ett test som är strikt svagare
än det byggda: en senare byggare som städar (S3) tillbaka till dokumentets
lydelse får grön svit och tar bort den enda detektorn för att båda
`occurrence`-stegen går genom parametern — samma hål som kostade tre
granskningsrundor.
**Regel framåt:** Ett testfall som skrivs om efter en granskning är inte klart
förrän det stycke i `ARKITEKTUR.md` som föreskriver dess konstruktion har lästs
mening för mening mot den nya testkoden och skrivits om, och varje mutation det
omskrivna fallet ensamt fäller står som en egen rad i mutationstabellen för
punkten. Kontrollen är mekanisk och körs innan paketet lämnas vidare: plocka ut
varje `(SN)` ur den ändrade testfilen, slå upp punktens stycke och tabellrad, och
kör varje mutation raden namnger. Fäller fallet en mutation som inte står i
tabellen läggs raden till först — en mutation som bara står i en kodkommentar i
`src/` ingår inte i den bindande mutationslistan och skyddar inget nästa byggare
kan slå upp. Dör en byggaragent utan slutrapport ska nästa agent göra om den
kontrollen från de ändrade filerna, inte lita på att den är gjord.
**Efterskrift 2026-09-15 (granskaren):** rättat av arkitekten samma dag, i en
ändring som rörde `ARKITEKTUR.md` och ingenting annat — `sha256sum -c` ger alla
26 filer i `src/` och `tests/` `OK` mot det granskade trädet. (S3)-stycket (nu
rad 1207–1265) föreskriver den byggda formen med två poster, var sin räknare och
en undre gräns på den post vars korrigeringsloop kör ett varv, och
mutationstabellen har tre `(S3)`-rader i stället för en. Meningen "beskriver
fortfarande den underkända formen" ovan är därmed inte längre sann om filen; felet
inträffade och gällde under hela runda 4, och beskrivningen står kvar oförändrad
för att posten ska gå att läsa som den skrevs.

### 2026-09-15 — test: SIGKILL-testets 200 forkar har ingen omförsöksväg när ett barn inte hinner starta, och hela sviten blir röd
**Vad gick fel:** `npm test` gav `ℹ tests 340`, `ℹ pass 339`, `ℹ fail 1` och
`EXIT=1` på ett träd utan en enda kodändring — `sha256sum -c` gav samtliga 26
filer i `src/` och `tests/` `OK` mot det träd där samma kommando gett `fail 0`
och `EXIT=0` strax innan. Kryssraden var
`✖ en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den nya
listan (358170.0881ms)` med
`AssertionError … barnprocessen …\tests\helpers\interrupted-save.js skickade
aldrig "startar" (timeout): exitCode=null, signalCode=null, stderr=` från
`waitForChildStart` (`tests/storage.test.js` rad 217, anropad från rad 993).
`exitCode=null` och `signalCode=null` betyder att barnet levde — det hade bara
inte hunnit skicka sitt första meddelande inom `CHILD_START_TIMEOUT_MS`
(30 000 ms). Maskinen var idle: noll `node`-processer och 2 % CPU mättes direkt
efter. Testet forkar `N = 200` barn per omgång (räknat ur `dodandetiderMs`, 200
värden) plus en mätomgång, och dess körtid över de sju körningar jag har loggar
för är 36,7 s, 45,1 s, 45,8 s, 52,9 s, 53,0 s, 54,8 s och 130,0 s — mot 358,2 s i
den fallerande. Tre omkörningar direkt efteråt gav `fail 0` och `EXIT=0` var
(45,1 s, 45,8 s, 54,8 s).
**Varför:** Testet har redan en omförsöksväg — `for (let attempt = 1; attempt <= 3;
attempt += 1)` på rad 958 — men den täcker bara det ena icke-deterministiska
utfallet, att en av räknarna `gamlaListan`/`barnetsLista` blir `0`
(`ARKITEKTUR.md` punkt 7). Det andra icke-deterministiska utfallet, att en fork
bland 200 inte hinner skicka `startar`, går rakt på `assert.fail` och river hela
testet. `N = 200` är i sig välmotiverat och bindande (`ARKITEKTUR.md` rad 2484:
referensvärdet "9 av 10" för mutationsdetektionen), men talet multiplicerar också
svansrisken: sannolikheten att *någon* av 200 forkar stallar förbi 30 sekunder är
200 gånger den per fork, och ingenting amorterar den. Hängningsspärren från
lärdomen 2026-09-04 gör precis det den ska — den faller i stället för att hänga —
men den skrevs som skydd mot ett barn som *aldrig* startar, och används nu som
domare över ett barn som startar långsamt. Följden är att `CLAUDE.md`:s grind
"`npm test` ska ge `fail 0` och exit 0" inte är deterministisk: den gick röd en
gång på 26 fullkörningar under den här granskningen, utan att något i projektet
ändrats.
**Regel framåt:** Har ett test en omförsöksväg för ett icke-deterministiskt utfall
ska varje annat icke-deterministiskt utfall i samma loop antingen omfattas av
samma omförsök eller stå utskrivet i `ARKITEKTUR.md` som ett hårt fel med skälet
angivet. Konkret för SIGKILL-testet: en `waitForChildStart`-timeout i en av de 200
omgångarna ska kassera omgången och köra en ny, upp till ett utskrivet tak
(förslagsvis 5 kasserade omgångar per försök), och testet ska falla först när
taket nås — med antalet kasserade omgångar utskrivet i `SIGKILL-försök`-raden och
asserterat mot taket, så att en miljö som stallar systematiskt fortfarande fäller
testet. Ett barn som *dör* (`exit`) eller kastar (`error`) ska däremot fortsätta
vara ett hårt fel; skilj på de två i meddelandet. Ett testfall som forkar fler än
50 processer ska dessutom redovisas med tre `npm test`-körningar i rad, med
`ℹ fail` och `EXIT=` inklistrade från var och en — en enda grön körning säger
ingenting om ett test vars utfall beror på 200 processtarter.

### 2026-09-16 — test: datumkolumnen i kortet Kommande dragningar kan bytas mot startDate utan att något test faller
**Vad gick fel:** `ARKITEKTUR.md` rad 4035 är bindande facit för kortets celler
(`| Datum | upcoming-date | item.nextDueDate, ordagrant |`), men raden har inget
skydd. Körd mutation på det frysta trädet: `src/web/app.js` rad 155,
`cell('upcoming-date', item.nextDueDate)` bytt mot
`cell('upcoming-date', item.entry.startDate)`, ger `npm test` med `ℹ tests 340`,
`ℹ pass 340`, `ℹ fail 0` och `EXIT=0` — ingen kryssrad. Skillnaden är det enda
kortet finns för: med fyra riktiga poster sparade genom en riktig server
(fyra `POST` med `201`, `idag 2026-09-16`) visar kolumnen med koden
`Hemförsäkring 2026-09-30`, `Hyra 2026-09-30`, `Bredband 2026-10-15` och
`Domännamn 2027-02-28`, och med mutationen `2020-03-31`, `2020-03-31`,
`2019-01-15` och `2024-02-29` — alltså startdatumen, flera år tillbaka, bredvid
texterna `Om 14 dagar` och `Om 165 dagar`, som fortfarande är rätt.
Mutationslistan i `ARKITEKTUR.md` rad 4098 till 4101 räknar upp
`clearView`-raderna och `item.daysUntil === 1`-grenen men ingen mutation alls för
datumcellen.
**Varför:** Varje post i `tests/app.test.js` har `startDate` lika med `idag`
eller `idag` plus en eller två dagar (`dragningsposter` rad 739 till 745,
`skapad` rad 938), och för en post som startar i framtiden är `nextDueDate`
definitionsmässigt startdatumet: steg 2 ger `k = 0`. Assertionerna på rad 779 och
rad 970 jämför därför två uttryck som är lika för all testdata, precis som
`localeCompare(namn, 'sv')` och `localeCompare(namn)` var lika på en svensk
maskin (`LARDOMAR.md` 2026-09-12) och som `let k = 0` gav samma returvärde som
steg 2 (`LARDOMAR.md` 2026-09-14). Facitraden säger `ordagrant` om *formatet* men
ingenting om *vilket* datum, och mutationslistan skrevs för de två
nollställningarna granskningen krävde, inte ur den ändrade filen.
**Regel framåt:** En assertion på ett renderat värde räknas som skydd först när
testdatan är vald så att värdet skiljer sig från varje annat fält raden kunde ha
visat. För kortet Kommande dragningar betyder det minst en post med `startDate`
flera perioder tillbaka — `2020-03-31` med `quarterly` — där `nextDueDate` är ett
annat datum än `startDate`, och mutationen
`cell('upcoming-date', item.nextDueDate)` till
`cell('upcoming-date', item.entry.startDate)` ska ge `EXIT=1` med kryssraden
inklistrad. Raden ska stå som en egen rad i mutationslistan i `ARKITEKTUR.md`.
Generellt: för varje cell en renderingsfunktion skriver, räkna upp de andra fält
samma objekt bär och kräv att testdatan gör dem olika — är två fält lika i all
testdata prövar assertionen inte vilket av dem koden läser.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-16 — test: Object.hasOwn-spärren i schedule.js överlever mutation, och testkommentaren namnger ett skydd assertionen inte ger
**Vad gick fel:** `src/core/schedule.js` rad 60,
`if (!Object.hasOwn(MONTHS_PER_PERIOD, entry.interval))`, bytt mot det
sanningsprövade uppslaget `if (!MONTHS_PER_PERIOD[entry.interval])` ger `npm test`
med `ℹ tests 340`, `ℹ pass 340`, `ℹ fail 0` och `EXIT=0`. Både kodkommentaren
(rad 55 till 59, "Object.hasOwn, inte ett sanningsprövat uppslag: annars hittar
interval: 'constructor' något på prototypen") och testkommentaren
(`tests/schedule.test.js` rad 274 till 275, "Object.hasOwn och inte ett
sanningsprövat uppslag: annars hittar de här nycklarna något på prototypen")
namnger exakt den här spärren, men assertionen på rad 277 är
`assert.throws(() => nextDueDate(post({ interval }), '2026-08-18'), RangeError, interval)`
— bara feltypen. Med mutationen kastar koden fortfarande `RangeError`, från fel
ställe och med fel orsak. Körda meddelanden, med koden respektive med mutationen:
`constructor` ger `nextDueDate kräver ett känt interval, fick "constructor".`
respektive `addMonthsClamped kräver ett heltal månader, fick "NaN".`; samma sak
för `toString`, `hasOwnProperty`, `__proto__` och `valueOf`. Den motsvarande
spärren i `cost.js` är skyddad: samma mutation där
(`!Object.hasOwn(PAYMENTS_PER_YEAR, entry.interval)` till
`!PAYMENTS_PER_YEAR[entry.interval]`) ger `EXIT=1` och
`✖ varje postfunktion kastar RangeError för ett interval utanför tabellen`,
eftersom `tests/cost.test.js` rad 273 till 274 asserterar hela meddelandet med
`unknownInterval('constructor')`.
**Varför:** `schedule.js` ärvde `cost.js` konstruktion men inte dess facit.
`ARKITEKTUR.md` har en bindande tabell "Ingångsspärrar i `cost.js`" (rad 3076 till
3100) med varje meddelande utskrivet, och testet kunde därför skrivas mot
meddelandet. För `schedule.js` finns ingen sådan tabell (se posten nedan), så
byggaren hade ingen sträng att asserta mot och nöjde sig med feltypen. Det som
saknas är alltså inte ett testfall utan ett facit: en `assert.throws` mot enbart
`RangeError` kan aldrig skilja en spärr från en annan spärr längre ner i kedjan,
och det är just vad meddelandet finns för. Samma fel som `LARDOMAR.md` 2026-09-02
beskriver för `monthlyOre` — "`divideRoundHalfUp kräver ett heltal som täljare.`,
ett meddelande som pekar ut fel orsak".
**Regel framåt:** En `assert.throws` som ska skydda en namngiven spärr ska
asserta hela `message`, aldrig bara feltypen — en feltyp delas av varje spärr i
modulen. Namnger en testkommentar vilken kontroll som fångar ett fall
(`Object.hasOwn`, `Array.isArray`, `isPlainObject`) ska mutationen av just den
kontrollen ha körts och gett `EXIT=1` innan kommentaren skrivs (`LARDOMAR.md`
2026-08-23). Konkret här: de fyra prototypnycklarna i `tests/schedule.test.js`
rad 276 till 278 ska asserta
`nextDueDate kräver ett känt interval, fick "<nyckeln>".` ordagrant, och
mutationen `Object.hasOwn(MONTHS_PER_PERIOD, entry.interval)` till
`MONTHS_PER_PERIOD[entry.interval]` ska fälla det testet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-16 — dokumentation: schedule.js:s sex felmeddelanden och spärrordning står inte i ARKITEKTUR.md, som ändå hänvisar till "de fyra befintliga raderna"
**Vad gick fel:** `CLAUDE.md` gör `ARKITEKTUR.md` bindande för "felmeddelanden",
och `src/core/schedule.js` rad 42 till 43 kallar sin kedja "Äger hela
indatakedjan för modulen; första träff vinner", men kedjan och sex av dess åtta
meddelanden finns inte i dokumentet. Körd räkning med `grep -c` på meddelandets
början mot `ARKITEKTUR.md`, `src/core/schedule.js` och `tests/schedule.test.js`:
`nextDueDate kräver ett känt interval` 0/1/6, `nextDueDate kräver ett startDate`
0/1/2, `nextDueDate kräver ett dagens datum` 0/1/2, `upcoming kräver en lista`
0/1/1, `upcoming kräver ett name` 0/1/1 och `upcoming kräver ett id` 0/1/1. Bara
två finns i dokumentet: `nextDueDate kräver att addMonths` 1/1/2 (tabellraden
1050) och `nextDueDate kräver en post som objekt` 1/2/4, där den enda träffen
står i löptext på rad 1055 som exempel på var `addMonths`-raden ska placeras,
inte som ett facit. Rad 1056 skriver "De fyra befintliga radernas företräde ska
vara oförändrat, så den nya raden går sist" — de fyra raderna finns ingenstans i
filen, och en läsare kan därför inte avgöra vilka de är eller i vilken ordning de
står. `grep -n "Ingångsspärrar" ARKITEKTUR.md` ger tre träffar (rad 796, 2893 och
3076) och ingen av dem gäller `schedule.js`.
**Varför:** `cost.js` fick sin tabell "Ingångsspärrar i `cost.js` — bindande"
efter lärdomen 2026-09-02 om det tysta `NaN`, och `schedule.js` byggdes med exakt
samma form — ett uppslag i en fryst tabell, en `isPlainObject`-spärr, en kedja
där första träff vinner — utan att tabellen följde med. Avsnittet "Steg 2 görs
mätbart" skrevs för att motivera *en* ny spärr, och dess tabell har därför bara
den raden; de fyra äldre raderna förutsattes stå någon annanstans. Det som inte
står i en tabell blev inte byggt förr (`LARDOMAR.md` 2026-09-02, skrivvägens fel
i `storage.js`); här blev det byggt men fick inget facit, och följden är fyndet
ovan: utan en utskriven sträng kunde testet bara asserta feltypen.
**Regel framåt:** Varje modul i `src/core/` och `src/server/` som kastar ska ha
en egen numrerad tabell i `ARKITEKTUR.md` av formen "Ingångsspärrar i `<modul>` —
bindande, första träff vinner", med villkoret skrivet exakt som i koden och den
svenska strängen utskriven per rad, skriven innan koden. En mening som hänvisar
till "de N befintliga raderna" får bara stå om de raderna går att slå upp i samma
fil. Kontrollen är `grep -c` på varje meddelandesträng i modulen mot
`ARKITEKTUR.md`, och varje `0` stoppar paketet; kör den för `src/core/schedule.js`
i samma paket som tabellen skrivs och klistra in utdatan.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-16 — dokumentation: mutationsraden i kravlistan för (21) till (23) citerar ett uttryck som inte finns i app.js
**Vad gick fel:** `ARKITEKTUR.md` rad 4099 till 4101 är den bindande
mutationslistan för punkt (21) till (23) och föreskriver att
"`item.daysUntil === 1`-grenen byts mot `>= 1`". Uttrycket finns inte i den fil
raden gäller: `grep -c "item\.daysUntil === 1" src/web/app.js` ger `0`, medan
`grep -c "daysUntil === 1" src/web/app.js` ger `1` — grenen står i
`daysText(daysUntil)` på rad 134, och `item.daysUntil` förekommer på ett enda
ställe, rad 156, där värdet skickas in i `daysText`. Mutationen går alltså inte
att tillämpa ordagrant, trots att samma avsnitt kräver att varje mutation körs en
i taget med kryssraden inklistrad. Den mutation som verkligen går att köra faller
som utlovat: `if (daysUntil === 1)` till `if (daysUntil >= 1)` ger `EXIT=1`,
`ℹ fail 2` och `✖ dagtexterna är Idag, Om 1 dag och Om 2 dagar för daysUntil 0, 1
och 2`.
**Varför:** Kravlistan skrevs medan `daysText` ännu inte hade brutits ut ur
`renderUpcoming` som en egen funktion med en egen parameter, och uttrycket skrevs
med det namn raden bär på anropsstället i stället för med det namn den bär där
villkoret står. Det är ordagrant samma fel som `LARDOMAR.md` 2026-09-14,
"(S1):s mutation i ARKITEKTUR.md citerar ett uttryck som inte längre finns i
koden", och den postens regel ("för varje rad i varje mutationstabell, kör
`grep -c "<uttrycket före pilen>" <filen raden gäller>` och kräv minst `1`")
tillämpades på mutationstabellen för `tests/schedule.test.js`, där alla fem
raderna är körda och stämmer, men inte på den prosaformulerade mutationslistan
för `tests/app.test.js` — en lista i löptext lästes inte som en mutationstabell.
**Regel framåt:** En mutation är en mutationstabellsrad oavsett om den står i en
tabell eller i en mening, och `grep -c`-kontrollen gäller båda formerna. Kör före
varje paket: plocka ut varje kodcitat som står före ordet "byts", "ersätts",
"tas bort" eller en pil i `ARKITEKTUR.md`, kör `grep -c` mot den fil raden
namnger och kräv minst `1`. Skriv mutationer med det namn uttrycket bär där
villkoret står, aldrig med det namn det bär hos anroparen; bryts en gren ut i en
egen funktion i ett senare paket ska mutationsraden skrivas om i samma ändring.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-16 — arkitektur: daysUntilNextDue byggdes utan anropare i src/ och utan den märkning gränssnittsblocket kräver
**Vad gick fel:** `grep -rn "daysUntilNextDue" src/` ger en enda träff,
`src/core/schedule.js:119`, och den är definitionen — ingen kommentar och ingen
anropare. `src/web/app.js` läser i stället fältet `item.daysUntil` ur `upcoming()`
(rad 156), och `upcoming` anropar `nextDueDate` och `daysBetween` direkt (rad 132
och 143) i stället för `daysUntilNextDue`. Exportens enda anropare är
`tests/schedule.test.js`. `ARKITEKTUR.md` rad 1865 till 1870 slår fast "Ingen
export får byggas i förtid — en export utan användare får inga meningsfulla
tester", och gränssnittsblocket för `src/core/schedule.js` (rad 3213 till 3219)
listar `daysUntilNextDue` utan någon anmärkning — medan den enda andra export som
är i samma läge, `saveEntries`, bär en utskriven motivering på rad 3310 till 3320
och i beslutsloggen rad 5453 till 5465 ("Exporten har alltså ingen anropare i
`src/` ... Att ta bort den prövades och förkastades").
**Varför:** Regeln från `LARDOMAR.md` 2026-09-07 är formulerad om en export som
*förlorar* sin produktionsväg när en ny export tar över, och `daysUntilNextDue`
förlorade ingenting — den fick aldrig någon. Kontrollen den posten föreskriver
("Kör `grep -rn "<export>" src/` för varje export i gränssnittsblocket innan ett
paket lämnas vidare, räkna bort kommentarsraderna och redovisa utfallet") täcker
fallet, men den står under en rubrik om övertagande och lästes därför inte som
ett krav på en helt ny modul. Funktionen är i sig riktig och grundligt testad;
det som saknas är svaret på frågan varför den finns, och den frågan blir dyrare
att svara på för varje paket som går.
**Regel framåt:** Kontrollen `grep -rn "<export>" src/` gäller varje export i
gränssnittsblocket, både nya och gamla, och körs innan varje paket lämnas vidare
med utfallet inklistrat. Ger den bara definitionen ska exporten i samma paket
antingen tas bort, tas i bruk av produktionskoden, eller få raden
"ingen anropare i `src/` sedan paket N — behålls därför att <skäl>" i
gränssnittsblocket, på samma form som `saveEntries` redan har. För
`daysUntilNextDue` är det tredje alternativet rimligt bara om skälet skrivs ut;
annars ska `upcoming` anropa den i stället för att räkna `daysBetween` själv, så
att de två inte kan glida isär.

### 2026-09-22 — test: tests/app.test.js läser klockan sju gånger, och kontrollen som ska förbjuda det ser ingenting
**Vad gick fel:** `ARKITEKTUR.md` rad 2421–2424 är bindande och säger att kravet på
`tests/app.test.js` och `tests/helpers/dom.js` är "strängare än på de andra:
**ingen klocka alls**", med kontrollen
`grep -n "setTimeout\|setInterval\|AbortSignal.timeout\|Promise.race\|performance.now\|Date.now" tests/app.test.js tests/helpers/dom.js`
och kravet noll träffar. Paket 7 lade in sju klockläsningar i filen —
`todayIso()` på rad 757, 762, 793, 850, 886, 938 och 987, där signaturen är
`todayIso(now = new Date())` och ett utelämnat argument alltså läser klockan —
plus `Date.parse` och `new Date(ms)` i `datumOmDagar` rad 728–729. Den
föreskrivna kontrollen ger ändå noll träffar och `exit 1` på det frysta trädet,
eftersom inget av de sex mönstren matchar `todayIso()` eller `new Date(`. Samma
sökning mot `git show HEAD:tests/app.test.js` ger `0` — varje klockläsning är
paket 7:s. Följden är mätt: med en simulerad midnattspassage (testets första
`todayIso()` ger gårdagen medan produktionskoden ser dagens datum) ger
`node --test tests/app.test.js` `ℹ tests 30`, `ℹ pass 29`, `ℹ fail 1` och
`EXIT=1` med `AssertionError [ERR_ASSERTION]: testet korsade midnatt mellan
uppställningen och körningen` — på oförändrad produktionskod. `CLAUDE.md`:s grind
"`npm test` ska ge `fail 0` och exit 0" är därmed inte deterministisk för den
här filen, och `ARKITEKTUR.md` rad 2516–2518 ("**Determinism:** inget test får
bero på dagens datum") har inget undantag för den: `grep -c "kravIngenMidnatt"
ARKITEKTUR.md` ger `0`, och ordet "midnatt" finns bara på rad 4243 och 4268, där
spärrens *placering* regleras men aldrig dess existens.
**Varför:** Kontrollen är förankrad i sex namngivna API:er i stället för i rollen
"läser klockan", och paket 7 behövde just den klockläsning som inget av de sex
heter: `app.js` anropar `todayIso()` själv inne i `renderUpcoming`, och attrappen
har ingen klocka att ställa, så testet måste läsa samma klocka för att veta vad
det ska förvänta sig. Behovet är äkta — men det skulle ha ändrat dokumentet
först (`CLAUDE.md`: "Behöver något ändras: ändra `ARKITEKTUR.md` först, bygg
sedan"), och `kravIngenMidnatt` är dessutom precis en sådan ny testkonstruktion
som lärdomen 2026-09-07 (den fjärde hängningsspärren) kräver ett eget stycke för
innan den byggs. Fjärde gången en kontroll i projektet är förankrad i en sluten
lista med stavningar och därför inte ser det den finns för (2026-09-07
`saveEntries as X`, 2026-09-12 de fetstilta paketmarkörerna, 2026-09-16
mutationsraden i löptext).
**Regel framåt:** Förankra en förbudskontroll i rollen, inte i API-namnen.
Kontrollen för "ingen klocka" ska vara
`grep -nE "todayIso\(\)|new Date\(|Date\.now|Date\.parse|setTimeout|setInterval|AbortSignal\.timeout|Promise\.race|performance\.now" tests/app.test.js tests/helpers/dom.js`
— körd på det frysta trädet ger den 13 rader och `EXIT=0` — och varje träff ska
ha en egen rad i `ARKITEKTUR.md` med syfte och med vad som händer när klockan
tickar mitt i provet. Behöver ett test läsa klockan därför att produktionskoden
gör det ska undantaget skrivas in i determinismavsnittet **innan** testet
skrivs, tillsammans med beskedet om en midnattspassage är ett hårt fel eller en
omtagning (samma krav som lärdomen 2026-09-15 ställer på ett annat
icke-deterministiskt utfall). Ett test som kan bli rött på oförändrad kod utan
att dokumentet nämner det är alltid ett fel. Hjälpfunktionens namn skrivs ut i
dokumentet, så att nästa läsare kan slå upp den.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — gränssnitt: radens egen klass i kortet Kommande dragningar överlever mutation
**Vad gick fel:** `rad.className = 'upcoming'` i `renderUpcoming`
(`src/web/app.js` rad 152) kan bytas mot `'entry'` utan att något test faller:
`npm test` ger `ℹ tests 342`, `ℹ pass 342`, `ℹ fail 0` och `EXIT=0`. Detsamma
gäller `''` och `document.createElement('li')` → `'div'`
(`node --test tests/app.test.js` ger `tests 30, pass 30, fail 0, EXIT=0` för var
och en). Klassen är enda kopplingen mellan kortet och de regler
`src/web/style.css` rad 203–233 och rad 285 skriver för `.upcoming`, och
`ARKITEKTUR.md` rad 4200–4204 gör dem bindande ("raden ska ha samma slags
rutnät som `.entry` med datumet och dagarna högerställda"). Med fel klass får
raden `.entry`:s rutnät eller inget alls, och ingen assertion märker det.
Cellernas klasser är däremot skyddade: `cell('upcoming-days', …)` →
`cell('upcoming-dagar', …)` ger `EXIT=1` och tre kryssrader. Attrappen
exponerar redan det som saknas — en körning mot den incheckade
`tests/helpers/dom.js` ger `upcoming-radens className = "upcoming"  tagName =
"li"` — så assertionen är en rad bort. Hålet är inte bara paket 7:s: samma
mutation på paket 5:s `item.className = 'entry'` i `renderEntries` ger också
`pass 30, fail 0, EXIT=0`, så det finns nu i två renderingsfunktioner.
**Varför:** Mutationslistan för punkt (21)–(26) räknar upp `clearView`-raderna,
`renderUpcoming`s två nollställningar, dagtextgrenen och datumcellen — allt som
*innehåll*. Radelementet självt bär ingen text och hamnade därför utanför listan,
trots att lärdomen 2026-09-12 säger att listan ska genereras ur
`git diff HEAD -- <fil>` och att dokumentets lista är "ett minimum, aldrig en
avgränsning". Att `tests/app.test.js` asserterar cellernas klasser (rad 771–774)
gör hålet svårare att se: filen ser ut att pröva klasser. Nionde gången ett
delvillkor i projektet visar sig oskyddat av något test.
**Regel framåt:** Varje egenskap en renderingsfunktion sätter på ett element ska
ha en assertion, inte bara `textContent`. För varje `document.createElement(...)`
i `src/web/app.js` ska testet asserta elementets `className` **och** `tagName`,
och mutationen "byt klassnamnet mot ett annat" ska ge `EXIT=1`. Konkret:
`tests/app.test.js` ska asserta
`dom.falt('upcoming-list').children[0].className === 'upcoming'` och
`… .tagName === 'li'`, och motsvarande för `renderEntries`-radens `'entry'`. Ett
klassnamn som en selektor i `src/web/style.css` beror på är ett kontrakt mellan
två filer och ska prövas som ett: när en regel läggs till i `style.css` ska
selektorns namn sökas i `src/web/app.js` **och** i `tests/app.test.js`, och
saknas det i testfilen stoppar det paketet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: "Varje assert.throws ... asserterar hela message" skrevs i samma runda som tolv assert.throws utan message
**Vad gick fel:** `ARKITEKTUR.md` rad 1104–1108 är fetstilt och bindande:
"**Varje `assert.throws` som ska skydda en rad i det här avsnittet asserterar
hela `message`, aldrig bara feltypen.**" Avsnittet är "Ingångsspärrar i
`src/core/schedule.js`", och `tests/schedule.test.js` — skriven i samma runda —
har tolv `assert.throws` som bara asserterar feltypen, alla mot rader i just det
avsnittet: rad 261, 289, 295, 305, 321, 631, 632, 633, 638, 648, 655 och 660.
Körda tal: `grep -c "assert.throws(.*, RangeError\b" tests/schedule.test.js` ger
`12` och `grep -c "assert.throws" tests/schedule.test.js` ger `37`. Varje spärrad
rad har visserligen minst en assertion med hela meddelandet någon annanstans, och
granskarens två försvagningsmutationer — `if (start === null)` →
`if (start === null && typeof entry.startDate === 'string')` och motsvarande för
`today` — fälls båda med `EXIT=1` och `fail 1`, så ingen känd mutation överlever
i dag. Felet är att kravet är bredare än det som byggdes: nästa granskare kan
inte avgöra om en av de tolv raderna är ett fel eller ett accepterat undantag.
**Varför:** Meningen skrevs för att rätta lärdomen 2026-09-16, där just
prototypnycklarnas assertion saknade meddelandet, och formulerades om *varje*
`assert.throws` i stället för om den roll den gällde — "den assertion som ensam
skiljer en spärr från en annan". Det är samma form som lärdomen 2026-09-07 om
millisekundförbudet: ett krav skrivet om den konstruktion det råkar träffa i
stället för om den roll det gäller gör nästa läsare oförmögen att skilja fel från
nödvändighet. Nionde gången `ARKITEKTUR.md` innehåller ett krav eller ett
påstående som koden inte uppfyller.
**Regel framåt:** Skriv ett "varje"-krav i `ARKITEKTUR.md` tillsammans med det
kommando som räknar dess förekomster i den fil kravet gäller, och kör kommandot
**efter** att kravet är skrivet: här
`grep -c "assert.throws(.*, RangeError\b" tests/schedule.test.js`, som ska ge `0`
om kravet ska stå som det står. Ger den ett annat tal ska antingen varje träff
rättas i samma paket, eller kravet skrivas om till den roll det gäller — "den
assertion som ensam skyddar en rad asserterar hela `message`; en bredare lista
med värden för samma rad får asserta enbart feltypen" — med undantaget utskrivet
och med den fullmeddelandeassertion varje rad ska ha namngiven. Ett bindande
"varje" som filen bryter mot i samma runda det skrivs är alltid ett fel.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: "Raden har tre celler:" står före uppräkningen, och kontrollen mot det saknar ordet celler
**Vad gick fel:** `ARKITEKTUR.md` rad 4144 lyder "**En rad per post, i den ordning
`upcoming` gav.** Raden har tre celler:" och följs direkt av en tabell med tre
rader. Antalet stämmer i dag, men konstruktionen är den lärdomen 2026-09-12
förbjuder ordagrant ("En mening som inleder en uppräkning får inte bära
uppräkningens antal, oavsett om den är fetstilt eller vanlig brödtext"). Samma
lärdom föreskriver en mekanisk kontroll över hela filen, och den kontrollen kan
inte se raden: den föreskrivna alterneringen slutar med substantiven
`element|rader|id:n|fall|punkter|exporter|stavningar|ställen`, och ordet `celler`
saknas där, så `sed -n '4144p' ARKITEKTUR.md` rörledd genom det mönstret ger `0`.
Raden skrevs i paket 7 och överlevde två granskningsrundor. Filen har tre äldre
förekomster av samma konstruktion — rad 595, 891 och 2442 — och alla tre bär
rätt antal, så inget påstående är falskt i dag.
**Varför:** Mönstret är en sluten lista över de substantiv som råkade förekomma
när lärdomen skrevs, och paket 7 införde ett nytt. Det är samma grundorsak som
posten om klockkontrollen ovan och som lärdomarna 2026-09-07 (`saveEntries as X`)
och 2026-09-12 (de fetstilta paketmarkörerna): en spärr prövad enbart med de
stavningar som fanns när den skrevs.
**Regel framåt:** Byt substantivlistan mot formen. Kör
`grep -nE "\b(två|tre|fyra|fem|sex|sju|åtta|nio|tio|[0-9]+) [a-zåäöA-ZÅÄÖ]+( [a-zåäöA-ZÅÄÖ]+)?:$" ARKITEKTUR.md`
— körd på det frysta trädet ger den fem rader (595, 3783, 3884, 4144 och 5599),
alltså en läsbar lista — och läs varje träff: räknar talet posterna i blocket som
följer ska meningen skrivas om utan talet och blocket bära antalet. Kontrollen
körs på hela filen innan varje paket lämnas vidare och utdatan klistras in.
Behöver en uppräkning ändå ett antal ska talet stå tillsammans med det kommando
som räknar blockets rader, kört efter att stycket är färdigskrivet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: "deras rader är äkta ensamma fällare" skrevs om fem tabeller utan att någon av dem kördes om
**Vad gick fel:** Beslutsloggen i `ARKITEKTUR.md` motiverar att rubriken
`Mutationer det ensamt fäller` behålls i de fem övriga mutationstabellerna med
meningen "Rubrikerna i de andra mutationstabellerna är **inte** ändrade: deras
rader är redovisade som ensamma fällare", men två av raderna är det inte längre.
Körda på det frysta trädet, en mutation i taget mot hela sviten: punkt (24),
`UPCOMING_LIST.replaceChildren()` borttagen ur `renderUpcoming`, ger `EXIT=1`,
`fail 2` med `✖ en borttagning med lyckad omhämtning lämnar bara de kvarvarande
posternas dragningar` **och** `✖ dagarna räknas om mot den nya dagen när listan
hämtas om`; punkt (26), `cell('upcoming-date', item.nextDueDate)` bytt mot
`cell('upcoming-date', item.entry.startDate)`, ger `EXIT=1`, `fail 2` med
`✖ datumkolumnen visar nästa dragning och inte startdatumet` **och** samma andra
kryssrad. Den andra kryssraden är punkt (27), `dagarna räknas om mot den nya
dagen när listan hämtas om`, som skrevs i den här rundan. Övriga rader stämmer:
(25), (S1), (S2), (S3):s tre rader, (S4), (27) och (32) ger var och en `fail 1`.
**Varför:** Rubriken skrevs om på ett ställe därför att byggarens körning visade
att den inte höll där, och de fem andra tabellerna bedömdes på minnet av tidigare
rundors redovisningar i stället för på en körning i den här. Just den här rundan
var den som gjorde påståendet falskt: punkt (27) renderar kortet två gånger med
en lista som inte är tom, och det är precis den formen som också fäller varje
mutation i `renderUpcoming` som lämnar gamla rader kvar eller läser fel fält.
Ett nytt testfall kan alltså göra en befintlig tabellrad osann utan att någon rör
raden, och ingenting i arbetsgången läser om tabellerna när ett testfall
tillkommer. Samma grundorsak som posten 2026-09-10 ("det är punkt (13) som är
dess test" prövades inte med den mutation punkt (14) prövades med): ett
påstående om vilket test som skyddar vad, skrivet utan den körning som avgör det.
**Regel framåt:** En rubrik eller mening som påstår något om **varje rad i en
tabell** får bara stå kvar efter att varje rad har körts i samma runda. Skrivs ett
nytt testfall som renderar samma vy som en befintlig punkt ska varje
mutationstabell som rör den vyn köras om, rad för rad, och antalet fallerande
testfall skrivas ut per rad. Konkret: byt rubriken i samtliga mutationstabeller
till `Mutation som ska ge EXIT=1 med punktens egen kryssrad i utfallet` — kravet
är avgörbart rad för rad och blir inte falskt av ett nytt testfall — eller kör om
alla fem tabellerna och skriv in de faktiska kryssraderna. Ett skäl att inte köra
om ("deras rader är redovisade som ensamma fällare") räknas aldrig som en körning.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — test: laddarens återställning av den frusna dagen lämnar kvar den första dagen när loadApp anropas två gånger i samma test
**Vad gick fel:** `ARKITEKTUR.md` krav 5 för laddaren är bokstavligt: "Laddaren
sätter dagen före importen och återställer det tidigare värdet i en
`t.after`-hook", och `tests/helpers/frozen-dates.js` rad 53 till 56 skriver att
återställningen "lägger tillbaka precis det — också läget 'ingen dag satt', som är
utgångsläget för varje testfall". Körd på det frysta trädet: ett test som anropar
`loadApp` två gånger, med `idag: '2026-01-01'` och därefter `idag: '2026-02-02'`,
lämnar efter sina `after`-hookar `todayIso()` som svarar `2026-01-01` i stället
för att kasta `frozen-dates: ingen dag är satt`, och `globalThis.document` och
`globalThis.fetch` står kvar satta i stället för att vara `undefined`. Orsaken är
mätt: `node:test` kör `t.after`-hookar i den ordning de lades till — ett test med
två `t.after(() => console.log(...))` skriver `1` före `2` — så hooken från det
andra anropet, som tog sin ögonblicksbild efter det första anropets
`setFrozenDay`, skriver sist och vinner. Hålet är i dag onåbart: inget testfall i
`tests/app.test.js` anropar `starta` eller `loadApp` mer än en gång.
**Varför:** Återställningen bokför ett värde per anrop men äger ett tillstånd per
modul, och den bokföringen kan inte skilja "mitt eget tidigare värde" från "någon
annans". Det är samma sorts fel som posten 2026-09-07 om fillåset, där ett lås som
får delas saknade räknare över sina innehavare. Att den borttagna `else`-grenen i
`snapshotFrozenDay` mättes till 0 av 31 var en riktig mätning, och borttagningen
är inte orsaken — en `if/else` hade lämnat exakt samma kvarvarande dag, eftersom
felet ligger i hookarnas ordning och inte i grenvalet. Mätningen svarade alltså på
en annan fråga än den krav 5 ställer, och ingen prövade kravet med mer än ett
anrop.
**Regel framåt:** En `t.after`-återställning som bygger på en ögonblicksbild ska
antingen vara idempotent mot flera anrop i samma test — lägg hooken bara vid det
första anropet, eller håll en räknare som släpper tillståndet först när den når
`0`, på samma form som lärdomen 2026-09-07 kräver av fillåset — eller så ska
laddaren avvisa ett andra anrop i samma test med en svensk text. Testfallet är
obligatoriskt: ett fall som anropar `loadApp` två gånger, följt av ett fall som
kräver att `todayIso()` kastar `frozen-dates: ingen dag är satt` och att
`globalThis.document` och `globalThis.fetch` är `undefined`. Ett krav i
`ARKITEKTUR.md` som säger "återställer det tidigare värdet" räknas som oprövat
tills det har körts med två anrop i samma test.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — test: sista raden i compareUpcoming körs av inget test och överlever mutation
**Vad gick fel:** `return 0;` sist i `compareUpcoming` (`src/core/schedule.js` rad
157) bytt mot `return 1;` ger `npm test` med `tests 348`, `pass 348`, `fail 0`
och `EXIT=0` — ingen kryssrad. Raden är den enda i modulen utan täckning:
`node --test --experimental-test-coverage` för `tests/schedule.test.js` och
`tests/dates.test.js` ger `schedule.js | 99.38 | 96.77 | 100.00 | 157`, alltså
rad 157 som enda otäckta rad, mot `dates.js | 100.00 | 100.00 | 100.00 |`.
Grenen är nåbar men oprövad: den nås av två poster med samma `nextDueDate`, samma
`name` och samma `id`, och ingenting i projektet kräver att `id` är unikt — en
sökning efter `unik` och `Set(` i `src/` ger en enda träff, en kommentar om
temporärfilens namn i `storage.js`. Med mutationen är jämföraren inte längre
reflexiv, vilket `ARKITEKTUR.md` rad 1011 till 1015 ändå lovar: "Ordningen blir
därmed alltid stabil och oberoende av inmatningsordningen."
**Varför:** Testfallen för sorteringen är byggda ur facittabellens tre nycklar en i
taget — lika datum, lika namn, lika id — och det sista steget, "lika på alla tre",
finns inte som rad i tabellen, eftersom två poster som är lika på alla tre inte går
att skilja åt i vyn. Att utfallet är osynligt gjorde raden ointressant att testa,
men den är ändå det enda som håller jämföraren reflexiv, och en jämförare som inte
är det är ett fel oavsett om det syns. Nionde gången ett delvillkor i projektet
visar sig oskyddat av något test.
**Regel framåt:** En jämförarfunktion ska ha ett testfall där två element är lika
på **varje** nyckel jämföraren läser, med assertionen skriven på jämförarens egen
utdata och inte på den sorterade listan: för `upcoming` betyder det två poster med
samma `nextDueDate`, samma `name` och samma `id`, och ett krav på att ordningen är
densamma för båda inmatningsordningarna. Mutationen `return 0;` till `return 1;`
på sista raden ska ge `EXIT=1` med det fallets kryssrad inklistrad. Generellt: kör
`node --test --experimental-test-coverage` på varje ny fil i `src/core/` i samma
paket som filen skrivs, och för varje otäckt rad avgör och skriv ut i
redovisningen om raden är onåbar — då tas den bort — eller nåbar men oprövad — då
får den ett testfall.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — test: setFrozenDay släpper igenom kalenderogiltiga datum, och kommentaren på två ställen påstår motsatsen
**Vad gick fel:** `setFrozenDay` i `tests/helpers/frozen-dates.js` rad 46 till 51
prövar `ISO_DATE_PATTERN.test(day)`, alltså formen och inte kalendern, medan
kommentaren rad 43 till 45 säger "så att ett felskrivet argument fälls här och
inte långt inne i schedule.js" och kommentaren över punkt (32) i
`tests/app.test.js` rad 1143 till 1144 upprepar samma mening ordagrant. Körd på
det frysta trädet: `setFrozenDay('2026-02-30')`, `setFrozenDay('2026-13-45')`,
`setFrozenDay('0000-00-00')` och `setFrozenDay('9999-99-99')` godkänns alla fyra,
trots att `isValidIsoDate` från samma modul ger `false` för var och en. Med
`loadApp(t, { …, idag: '2026-02-30' })` och en post i listan faller testet med
`RangeError: nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick
"2026-02-30".` kastad från `src/core/schedule.js:69` — alltså från exakt det
ställe de två kommentarerna säger att kastet inte kommer från, och med ett
meddelande som pekar ut `nextDueDate` i stället för laddaren.
**Varför:** Filen citerar i sin egen inledning (rad 14 till 16) lärdomen
2026-09-02 om att inte skriva en egen, svagare kopia av ett begrepp som redan har
en ägare, och importerar därför formen från `dates.js` — men väljer den svagare av
de två ägarna i samma modul: `ISO_DATE_PATTERN` äger "rätt form",
`isValidIsoDate` äger "finns i kalendern", och det är den senare frågan
kommentaren lovar ett svar på. `ARKITEKTUR.md` krav 3 skriver bara formen, så
koden följer dokumentet; det är kommentarernas motivering som är bredare än både
koden och kravet. Tredje gången en kodkommentar påstår något som en körning
motsäger (2026-09-07 om `server.js` och ordet "uppmätt", 2026-09-10 om
`loadAndRender` och ordet "bindande").
**Regel framåt:** En kommentar som säger *var* ett fel ska fällas ska ha körts med
den indata som ligger närmast gränsen — här ett datum med rätt form men fel
kalender — och utfallet skrivas ut på formen
`indata: <värde> ger <feltyp>: <meddelande> från <fil>:<rad>`. Håller kommentaren
inte ska antingen spärren skärpas till den ägare som svarar på frågan
(`isValidIsoDate` i stället för `ISO_DATE_PATTERN`, med `ARKITEKTUR.md` krav 3
ändrat först) eller kommentaren skrivas om till vad spärren faktiskt gör. Finns
två ägare av samma begrepp i en modul ska valet mellan dem motiveras i
kommentaren, aldrig lämnas underförstått. Samma mening som står på två ställen
rättas på båda: sök på fem ord ur meningen i `src`, `tests` och `ARKITEKTUR.md`
före och efter rättningen.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: byggarordern för punkt (33) kräver fortfarande det undefined som samma fil förbjuder
**Vad gick fel:** `ARKITEKTUR.md` rad 6907–6909 är en order i presens:
`**Byggaren ska:** bygga krav 8 med en modullokal WeakSet prövad före allt annat;
skriva testfallet (33) och det efterföljande fallet som asserterar att
globalThis.document och globalThis.fetch är undefined`. Samma fil förbjuder
uttryckligen den andra halvan på rad 33–38, under "Verifierad miljö": "**ett test
får aldrig kräva att `globalThis.fetch` är `undefined` efter en återställning**".
Förbudet är mätt på den här maskinen — `node -e` ger `typeof fetch = function`
och `typeof document = undefined` — och det var just den ordern som fällde
byggaren i den här rundan. Rättningen gjordes i koden (`tests/app.test.js` rad 43
och 1216–1221 jämför mot `FETCH_FORE_TESTERNA`), i kravtexten (rad 2712–2719) och
i beslutsloggens sista punkt (rad 6963–6979), men ordern tre skärmhöjder högre upp
står oförändrad. En byggare som slår upp "vad ska jag göra för (33)" och läser
`**Byggaren ska:**`-raden bygger om det omöjliga kravet.
**Varför:** Beslutsloggens punkter skrivs när beslutet fattas, och
`**Byggaren ska:**`-raden är den enda meningen i punkten som är skriven som en
order i presens — den blir falsk i samma stund beslutet ändras, precis som
`**Kvar i paket N:**` (2026-09-04) och "I dagens `src/core/entry.js`"
(2026-09-07). Här ändrades beslutet av en *senare* punkt i samma logg i stället
för av en ändring i den ursprungliga punkten, så ingenting i arbetsgången pekade
tillbaka på den gamla ordern. Rättningen söktes på `undefined` i kravtexten, inte
i hela filen: `grep -n "undefined" ARKITEKTUR.md | grep -i "global"` ger sex
träffar och rad 6909 är en av dem.
**Regel framåt:** Upphävs ett beslut av en senare punkt i beslutsloggen ska den
upphävda punktens `**Byggaren ska:**`-rad rättas i samma ändring — en sådan rad är
alltid en order och aldrig historik, och en upphävd order stryks eller skrivs om
till det nya beslutet med en hänvisning till punkten som upphävde det. Kontrollen
är mekanisk och körs innan varje paket lämnas vidare: för varje förbud filen själv
skriver ut (`får aldrig`, `får inte`, `ska aldrig`), plocka ut förbudets nyckelord
och kör `grep -n "<nyckelordet>" ARKITEKTUR.md` över hela filen — här `undefined`
tillsammans med `global` — och läs varje träff mot förbudet. En träff som kräver
det förbudet förbjuder stoppar paketet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — test: WeakSet-spärren i loadApp går förbi med t.test, och de två modulinstanserna byter fetch med varandra
**Vad gick fel:** Krav 8 i `ARKITEKTUR.md` och spärren i `tests/helpers/dom.js`
rad 302–307 nycklas på testkontexten `t`, så den avvisar bara ett andra `loadApp`
med *samma* kontextobjekt. Ett underordnat test har en egen kontext:
`await loadApp(t, …)` i föräldern följt av
`await t.test("barn", async (t2) => { await loadApp(t2, …); })` accepteras, och
båda modulinstanserna lever samtidigt. Skadan är mätt i en kopia av trädet, med
var sin `createFetch`-attrapp märkt `FORALDER` respektive `BARN`: efter barnets
`loadApp` ger `globalThis.fetch === barnets attrapp` värdet `true`, och när
**förälderns** formulär därefter skickas hamnar anropet i barnets attrapp —
`förälderns anrop = GET/FORALDER`, `barnets anrop = GET/BARN, POST/BARN`. Det är
ordagrant den fara krav 8 skrevs för: kommentaren på rad 32–38 i samma fil säger
"två modulinstanser i samma testfall delar `globalThis.fetch` och laddarens dag …
medan båda lever vidare med var sin lyssnare på attrappens element". Mutationen
`if (laddadeTester.has(t)) {` till `if (false) {` fäller båda (33):s testfall
(`EXIT=1`, `fail 2`), så spärren fungerar — för den enda stavning den är skriven
för.
**Varför:** Krav 8 är formulerat om en *identitet* ("ett andra `loadApp` för samma
`t`") medan faran är formulerad om ett *tillstånd* ("två modulinstanser i samma
testfall"). De två sammanfaller bara så länge ingen skriver ett underordnat test,
och `node:test` ger varje `t.test` en ny kontext. Fjärde gången en spärr i
projektet prövas enbart med den stavning den själv är skriven för (2026-09-07
`saveEntries as X`, 2026-09-12 `localeCompare` utan språkargumentet, 2026-09-12 de
fetstilta paketmarkörerna). Återställningen är däremot oskadd i just det här
fallet — `node:test` kör barnets `after`-hook före förälderns — så felet är att den
ena halvan av faran står oskyddad, inte att bokföringen är fel.
**Regel framåt:** En spärr som ska hindra två samtidiga modulinstanser ska bokföra
*instanser*, inte *kontexter*: håll en modullokal räknare som `loadApp` ökar och
`after`-hooken minskar, och avvisa varje anrop som görs medan räknaren är större
än `0` — då träffas både `loadApp(t, …)` två gånger och `loadApp(t2, …)` i ett
underordnat test. Innan en sådan spärr räknas som skriven ska den prövas med varje
stavning `node:test` tillåter för "ett andra anrop": samma `t`, ett `t.test`-barn,
en `before`-hook och en `beforeEach`-hook — och varje stavning ska ha ett testfall
som asserterar hela avvisningstexten. Skriv kravet i `ARKITEKTUR.md` som det
tillstånd det förbjuder ("högst en laddad instans av `app.js` åt gången"), aldrig
som en identitet på ett argument.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: "medan övriga rader ger fail 1" motsägs av två av filens egna rader
**Vad gick fel:** `ARKITEKTUR.md` rad 3151–3154, i Teststrategins nya regel om
mutationstabellernas rubrik, slår fast: "Granskarens körning av varje rad: (24)
och (26) ger `fail 2`, där den andra kryssraden i båda fallen är (27), medan
övriga rader ger `fail 1`." Två av de fjorton raderna ger inte `fail 1`, och filen
säger det själv på två andra ställen. Granskarens körning av varje rad i det
frysta trädet, med testfilerna utom `tests/storage.test.js`: (24) `fail 2`,
(25) `fail 1`, (26) `fail 2`, (27) `fail 1`, (28) `fail 1` för var och en av sina
tre mutationer, (29) `fail 1` för båda, (30) **`fail 8`**, (31) `fail 1`,
(S1) till (S5) `fail 1` var, (32) `fail 1`, (33) **`fail 2`**. Rad 4722–4725
skriver ut (30):s utfall korrekt ("åtta testfall faller, varav sju fanns före den
här rundan") och rad 2723 kräver uttryckligen att (33):s mutation "ska fälla
**båda** fallen". Samma fil ger alltså två svar på frågan hur många testfall en
rad fäller.
**Varför:** Meningen skrevs i det stycke som förklarar vad punkt (27) gjorde med
de rader som renderar samma vy, och "varje rad" syftade där på just de raderna.
Uttrycket blev ändå obegränsat, och den slutsats som var sann om en delmängd
skrevs som en uppgift om hela tabellsamlingen — samma form som
`totalYearlyOre`-tabellen 2026-09-02, där en tabellform kopierades till ett fall
den inte beskrev. Sjunde gången ett antal i den här filen är fel (2026-09-07,
2026-09-10 två gånger, 2026-09-12, 2026-09-14 två gånger).
**Regel framåt:** Ett antal som gäller "varje rad" i en tabellsamling ska skrivas
som en kolumn i tabellerna, inte som en mening i löptext: lägg till kolumnen
"Antal fallerande testfall" och fyll den rad för rad ur körningen. Måste
sammanfattningen stå i löptext ska den räkna upp varje avvikande rad vid namn
och köras om varje gång en rad tillkommer. Kontrollen är att söka upp varje rads
egen not och kräva samma tal som sammanfattningen: ett tal som en not i samma fil
motsäger är alltid ett fel.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — dokumentation: täckningssiffran för schedule.js står i presens och är inte längre den körningen ger
**Vad gick fel:** `ARKITEKTUR.md` rad 1467–1470 lyder "Sista raden i
`compareUpcoming`, `return 0;`, är modulens enda rad utan täckning: granskarens
körning med `--experimental-test-coverage` **ger** `schedule.js | 99.38 | 96.77 |
100.00 | 157`, och mutationen `return 0;` till `return 1;` **gav** `tests 348,
pass 348, fail 0` och `EXIT=0`." Efter rättningen i den här rundan ger samma
körning `schedule.js | 100.00 | 100.00 | 100.00 |` med tom kolumn för otäckta
rader, och samma mutation ger `fail 1` och `EXIT=1` med kryssraden
`compareUpcoming svarar 0 för två poster som är lika på varje nyckel`. Meningens
första verb står i presens och är därmed falskt; dess andra verb står i dåtid och
är sant. Den som slår upp täckningen får två olika svar beroende på vilken halva
av meningen hen läser.
**Varför:** Stycket är både en motivering (varför punkt (S5) finns) och en
mätuppgift (vad körningen gav), och de två blandades i en mening. Motiveringen är
tidlös och tål presens; mätuppgiften gäller ett tillstånd som punkten själv
avskaffar och blir falsk i samma stund byggaren utför den — samma grundorsak som
`**Kvar i paket N:**` (2026-09-04) och "I dagens `src/core/entry.js`"
(2026-09-07). Nionde gången filen innehåller ett påstående om koden som koden inte
uppfyller.
**Regel framåt:** Ett mätvärde i `ARKITEKTUR.md` skrivs alltid i dåtid och med
datum eller paketnummer utsatt ("granskarens körning i runda 2 gav …"), aldrig med
presens av verbet "ge". Beskriver mätningen ett tillstånd som paketet självt
avskaffar ska den efterföljande mätningen skrivas in i samma stycke när paketet är
klart ("efter rättningen ger samma körning …"), med båda utfallen inklistrade.
Kontrollen körs innan paketet lämnas vidare: sök upp varje mening som innehåller
ordet "körning" följt av verbet "ger", kör om den körningen och jämför med det
utskrivna värdet.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-22 — gränssnitt: en borttagning som ger 404 lämnar posten kvar i listan, i båda totalerna och bland kommande dragningar
**Vad gick fel:** Två flikar mot samma datafil, borttagning av `Hyra` i flik 1 och
därefter klick på `Ta bort` för samma rad i flik 2: datafilen innehåller
`["Elavtal"]` med de sanna totalerna `800,00 kr` och `9 600,00 kr`, men flik 2
visar samtidigt `#form-error = "Posten finns inte."`, raderna
`["Hyra","Elavtal"]`, `Totalt per månad = "12 800,00 kr"`,
`Totalt per år = "153 600,00 kr"` och en kommande dragning
`Hyra 2026-09-30 Om 8 dagar` — alltså ett belopp som är 12 000 kr för högt per
månad och en dragning för en post som inte finns, bredvid en text som säger att
posten inte finns. Ett andra klick ger samma svar och samma vy (`2 rader`); bara
en sidomladdning eller en annan lyckad ändring läker läget, eftersom
`removeEntry` i `src/web/app.js` rad 324–329 anropar `loadAndRender()` bara vid
`204` och går till `showErrors` i varje annat fall.
**Varför:** Beslutet att låta raden stå kvar finns bara som en kommentar i ett
testfall — `tests/app.test.js` rad 385, "Listan står kvar: en misslyckad
borttagning tar inte bort raden i vyn" — och `ARKITEKTUR.md` har ingen regel alls
för vad vyn ska göra efter en misslyckad borttagning (`grep -n "misslyckad
borttagning" ARKITEKTUR.md` ger noll träffar). Regeln är dessutom skriven för
*alla* misslyckade svar, medan `404` är det enda av dem som är ett definitivt
besked: vid `500` vet appen inte vad datafilen innehåller och får inte gissa, men
vid `404` har servern sagt att posten är borta. `clearView` i samma fil, rad
169–177, namnger ordagrant det tillstånd som nu uppstår som det den finns för att
förhindra — "totaler som räknar med en post som redan är borta ur datafilen, och
med dragningar för samma post" — men slutsatsen drogs bara för `loadAndRender`,
inte för `removeEntry`. Att fallet bara nås med två flikar gjorde det osynligt:
sviten har inget testfall där två vyer lever mot samma datafil.
**Regel framåt:** Ett `404` från `DELETE /api/entries/<id>` är ett besked om att
datafilen har ändrats sedan vyn hämtades, och ska därför följas av en omhämtning:
`removeEntry` ska anropa `loadAndRender()` efter `showErrors(...)` när
`response.status === 404`, så att raden, totalerna och kortet Kommande dragningar
stämmer med disken när feltexten visas. `500` ska behålla dagens beteende —
appen vet då inget nytt om datafilen. Regeln skrivs först i `ARKITEKTUR.md` som
en egen rad per statuskod under gränssnittets ansvarslista, med den vy som gäller
för var och en, innan koden ändras. Testfallet är obligatoriskt och ska asserta
alla tre elementen efter ett `404`: `#entry-list` har en rad färre,
`#total-monthly` och `#total-yearly` är den kvarvarande listans totaler, och
`#upcoming-list` saknar den borttagna postens namn — en assertion på bara
`#form-error` räknas inte, eftersom den passerar med dagens kod.

### 2026-09-22 — validering: appen visar belopp som "12 000,00 kr" men avvisar "12 000" med "Beloppet måste vara ett tal."
**Vad gick fel:** `formatSek(sekToOre(12000))` ger strängen `12 000,00 kr`
(mellanrummet är U+00A0), och det är så varje belopp presenteras i listan, i
totalrutan och i kostnaden per post. Skrivs samma tal tillbaka i formuläret
avvisas det: körda fall genom `validateEntryDraft` gav `"12 000"` (U+0020) →
`Beloppet måste vara ett tal.`, `"12 000"` → samma, och `"1 234,50 kr"`,
alltså en ordagrann kopia av appens egen utdata, → samma. Felmeddelandet säger
att värdet inte är ett tal, fast `12 000` är det normala svenska skrivsättet för
tolvtusen och dessutom det skrivsätt appen själv valt för utmatning; texten säger
ingenting om vad användaren ska göra i stället. `"12000"`, `"139,5"`, `"139.50"`
och `"  50  "` godkänns, så regeln är att tusentalsavgränsare inte stöds.
**Varför:** `AMOUNT_PATTERN` (`/^-?\d{1,15}([.,]\d{1,15})?$/`) och beslutet står i
`ARKITEKTUR.md` rad 517–519, som uttryckligen räknar upp att
"tusentalsavgränsare stöds inte" — koden följer alltså dokumentet, och
mönstret har testfall. Det som aldrig prövades är sambandet mellan *utmatningens*
format och *inmatningens*: de två avsnitten skrevs var för sig, `formatSek` ägs
av `money.js` och `AMOUNT_PATTERN` av `entry.js`, och ingen mening i
`ARKITEKTUR.md` ställer frågan om appens egen utdata är giltig indata. Felet syns
inte i något testfall, eftersom testerna matar in belopp de själva skrivit som
`'12000'` och jämför utdata mot `'12 000,00 kr'` — aldrig det omvända
varvet, där utdatan matas tillbaka in.
**Regel framåt:** Varje format en app *visar* ska antingen godtas som indata
eller mötas av ett felmeddelande som namnger skillnaden. Konkret: antingen ska
`AMOUNT_PATTERN` acceptera blanksteg som tusentalsavgränsare (U+0020 och U+00A0)
genom att strippa dem före matchningen, eller så ska meddelandet för en sträng
som består av siffror, blanksteg, komma, punkt och `kr` bytas mot en egen rad i
felmeddelandetabellen som säger vad som gäller — förslagsvis
`Skriv beloppet med siffror utan mellanslag, till exempel 12000 eller 139,50.` —
och det valet skrivs i `ARKITEKTUR.md` innan koden ändras. Kontrollen är
obligatorisk och ska finnas som testfall i `tests/entry.test.js`: för varje belopp
i tabellen över giltiga värden, kör `formatSek(sekToOre(v))` och mata tillbaka
resultatet i `validateEntryDraft` — antingen ska det ge `ok: true` med samma tal,
eller ska det ge det nya, vägledande meddelandet. Ett rundgångstest av den formen
saknas i projektet och ska skrivas för varje par av formaterare och tolk.

### 2026-09-23 — test: de två "oförändrad"-raderna i facittabellen för vyn efter en borttagning skyddas av inget test
**Vad gick fel:** `ARKITEKTUR.md` rad 4669–4675 är paket 8:s nya bindande facit
med en rad per utfall av `DELETE /api/entries/<id>`, och två av de fyra raderna
säger att vyn ska stå **oförändrad** (`500` och ett avvisat `fetch`). Ingen av
dem har ett test. Körda mutationer i en kopia av trädet, en i taget:
`if (response.status === 404) {` (`src/web/app.js` rad 343) →
`if (response.status === 404 || response.status === 500) {` ger
`tests 42, pass 42, fail 0` och `EXIT=0`; `await loadAndRender();` inlagt före
`return;` i `removeEntry`s `catch` (rad 320) ger samma sak. Den avgörande
körningen är de två tillsammans, alltså precis det alternativ samma dokument på
rad 7334 säger är förkastat — "*Att hämta om vid varje misslyckat svar
förkastades:* en omhämtning som själv misslyckas nollställer vyn": 404-grenen
ersatt av ett villkorslöst `await loadAndRender();` **och** en omhämtning i
`catch`-grenen ger på hela sviten `ℹ tests 358`, `ℹ pass 358`, `ℹ fail 0` och
`EXIT=0`, utan en enda kryssrad. De två rader paketet självt byggde är däremot
skyddade: `if (response.status === 404) {` → `if (false) {` ger `EXIT=1` med
`✖ en borttagning som ger 404 hämtar om listan och visar serverns text` och
`✖ en borttagning som ger 404 följd av en misslyckad omhämtning visar det nyare
felet`, och `showErrors(await readJson(response));` flyttad efter 404-grenen ger
`EXIT=1` med det andra av de två.
**Varför:** Mutationslistan på rad 4699–4700 har en rad per **nytt testfall**,
inte en rad per **rad i facittabellen**, så de två utfall paketet lämnade
oförändrade fick ingen mutation. Alla sex `status: 500` i `tests/app.test.js`
(rad 221, 235, 554, 609, 824, 853 och 1331) ligger antingen på `POST`-vägen
eller på en **omhämtning** efter ett `DELETE` som gav `204` eller `404` — inget
testfall låter `DELETE` självt svara `500`. Att grannfallet är oförändrat sedan
paket 5 lästes som att det redan var täckt, men det som täcktes var att texten
visas, aldrig att vyn *inte* hämtas om. Det är samma grundorsak som
`2026-09-12` (renderUpcomings två nollställningar): mutationslistan hämtades ur
dokumentet i stället för ur facittabellen, och ett tillstånd som ingen kodrad
skriver får ingen assertion. Nionde gången ett delvillkor visar sig oskyddat av
något test.
**Regel framåt:** En facittabell med en rad per utfall ska ha en mutation per
**rad**, inte per testfall — också för de rader där beteendet är "gör ingenting".
En rad vars utfall är "oförändrad" prövas med mutationen som *inför* handlingen
(här `await loadAndRender()` i den grenen), aldrig bara med mutationen som tar
bort den. Konkret för punkt (34): `tests/app.test.js` ska få ett testfall där
`DELETE` svarar `500` och `GET` räknas, med `assert.equal(hamtningar, 1)` plus
oförändrad `#entry-list`, oförändrade totaler och oförändrad `#upcoming-list`,
och ett motsvarande fall för ett avvisat `fetch` vid Ta bort. Står ett
förkastat alternativ utskrivet i beslutsloggen ("*Att X förkastades*") ska X
köras som mutation innan paketet lämnas vidare; överlever det med `fail 0` är
avgränsningen bara en mening och inte ett skydd.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-09-23 — dokumentation: paket 8:s nya beloppstext gjorde README.md:s beskrivning av samma fel falsk i samma ändring
**Vad gick fel:** `README.md` rad 185–187 lyder "Felmeddelandet för ett
mellanslag säger bara `Beloppet måste vara ett tal.` och pekar alltså inte ut
mellanslaget. Ser du det meddelandet trots att du tycker att du skrev ett tal:
leta efter ett mellanslag." Efter paket 8 säger appen något annat. Körd:
`validateEntryDraft` med `amountSek: '12 000'` ger
`Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000
eller 139,50.`, och samma text för `'12 000'`, `'50 kr'`, `'1 234,50 kr'`
och `'-12 000'` — alltså exakt de strängar stycket handlar om. Rådet i README är
därmed omvänt: den som letar efter texten `Beloppet måste vara ett tal.` efter
att ha skrivit ett mellanslag hittar den inte. Samma fil har ett andra påstående
som inte stämmer: rad 96–97 säger "Senaste körningen gav `tests 353`, `pass
353`, `fail 0`", medan `npm test` på det granskade trädet ger `ℹ tests 358`,
`ℹ pass 358`, `ℹ fail 0` och `EXIT=0` — de fem som fattas är paket 8:s egna nya
testfall.
**Varför:** Paket 8 bytte en sträng som visas för användaren och sökte efter det
gamla påståendet i `ARKITEKTUR.md` och i testfilerna, men inte i `README.md`,
som skrevs i mellantiden och inte är med i de sökningar projektets lärdomar
räknar upp (`LARDOMAR.md` 2026-09-11 föreskriver
`grep -rn … ARKITEKTUR.md LARDOMAR.md CLAUDE.md src tests` — `README.md` saknas i
listan). Att rättningen var en *förbättring* av texten döljer det: en text som
blir bättre läses inte som en ändring med följdverkningar. `README.md` ägs av
dokumentatorn, som kör efter granskaren, men filen låg i trädet när paketet
lämnades och beskriver nu ett beteende appen inte har.
**Regel framåt:** `README.md` ingår i varje sökning som gäller en sträng mot
användaren, på samma villkor som `ARKITEKTUR.md`, `src` och `tests`: byts eller
läggs en användarvänd sträng till ska `grep -rn "<den gamla strängen>" README.md
ARKITEKTUR.md CLAUDE.md src tests` köras före och efter ändringen och båda
utfallen klistras in, och varje träff i `README.md` som citerar den gamla texten
rättas eller skrivs upp som en öppen uppgift i paketets redovisning. Ett antal
i `README.md` skrivs aldrig utan sitt kommando — skriv `npm test` ger
`ℹ tests <N>` med körningen inklistrad, eller skriv meningen utan siffra; ett
tal som är en slutsats av en körning åldras utan att någon rör raden
(`LARDOMAR.md` 2026-09-14).

### 2026-09-23 — test: kommentaren över AMOUNT_HINT_CASES påstår att båda blanktecknen står som escaper, men fem av raderna skriver U+0020 rått
**Vad gick fel:** `tests/entry.test.js` rad 444–447 lyder "Båda blanktecknen står
som escaper:   är det tangentbordet ger och ` ` det appen själv visar. Ett
tecken som inte syns i en genomläsning skrivs alltid som escape (LARDOMAR.md
2026-09-11)". Testdatan direkt under gör inte det: `'12 000'`, `'50 kr'`,
`'12 kr'`, `'1 234,50'` och `'-12 000'` i `AMOUNT_HINT_CASES` (rad 448–466)
skriver blanksteget som ett rått U+0020, och kommentarsraden **på nästa rad**
säger det själv — `// '12 000' med U+0020, det tangentbordet ger.` Ordet som
skulle vara escapen är dessutom borta ur meningen: `cat -A` ger
`escaper:   M-CM-$r`, alltså tre bara blanksteg där ` ` skulle ha stått, och
meningen är bruten mitt i en bisats över tre rader. Ägaren i `src/core/entry.js`
rad 56 har samma mening och där stämmer den — mönstret skriver verkligen
`[\d.,  ]`.
**Varför:** Meningen kopierades från `entry.js`, där den är sann om ett
reguljärt uttryck, till en testfil, där den står över en lista med
strängliteraler och därmed handlar om något annat. Vid kopieringen förlorade
texten just den escape den handlar om, och förlusten syns inte i en
genomläsning: ` ` som blir tre blanksteg ser ut som vanlig typografi.
Sakligt är testdatan rätt — `LARDOMAR.md` 2026-09-14 slår fast att escape gäller
tecken som inte går att se, aldrig vanliga tecken — så felet är enbart att
kommentaren beskriver en fil som inte ser ut så. Det är samma form som
`2026-09-10` (kommentaren i `app.js` räknar upp två av filens fem användarvända
strängar) och `2026-09-10` (kommentaren i `loadAndRender` namnger fel gren).
**Regel framåt:** En kommentar som påstår hur raderna under den är *skrivna*
("står som escaper", "skrivs med", "alla tre är") ska verifieras mot just de
raderna i samma ändring, med sökningen utskriven — här
`grep -n $'\x20\x30\x30\x30' tests/entry.test.js` eller en uppräkning av vilka
rader som bär vilket tecken. Kopieras en kommentar från `src/` till `tests/` ska
den läsas om mot den nya omgivningen innan den klistras in: en mening som
beskriver ett reguljärt uttryck beskriver inte en lista med strängar. Innehåller
meningen själv en escape ska raden köras genom `cat -A` efter kopieringen, så att
en escape som tappats bort syns.

### 2026-10-10 — test: U+FEFF står rått i två nya testfiler, under kommentarer som säger att tecknet står som escape
**Vad gick fel:** Återfall av posterna 2026-09-11, 2026-09-14 (U+2013 stod rått)
och 2026-09-23 (kommentaren påstår escaper). `tests/report-csv.test.js` rad 30–32
lyder "U+FEFF BYTE ORDER MARK och U+000D U+000A, skrivna som escaper. Ett rått
tecken här går inte att se i en genomläsning" och följs av
`const BOM = '<rått U+FEFF>';`. `tests/report-api.test.js` rad 621–624 säger
"Escaperna står för tecken som inte syns" ovanför rubrikraden, som börjar med
samma råa tecken, och rad 659 i samma fil har det också. Sökningen
`grep -rn $'\xef\xbb\xbf' src tests`, rörledd genom `cat -v`, ger `M-oM-;M-?` på
exakt de tre raderna, och de två filerna har noll förekomster av escapen
(`grep -c 'uFEFF'` ger `0` för båda). Del 1:s `tests/csv.test.js` skriver samma
tecken som escape (`grep -c` ger `1`), så del 3 gick bakåt jämfört med sin egen
förlaga.
**Varför:** Sökkommandot som posten 2026-09-14 föreskriver räknar upp tre
kodpunkter (U+00A0, U+2013, U+2212), och U+FEFF var inte en av dem. Regeln gällde
"varje icke-ASCII-tecken", men kontrollen var skriven för en sluten lista, så det
fjärde osynliga tecken projektet använder hamnade utanför. Kommentaren kopierades
från förlagan och står nu ovanför ett värde som inte längre är en escape. Det är
samma glidning som posten 2026-09-23 beskriver, och den syns inte i en
genomläsning.
**Regel framåt:** Sök efter osynliga tecken med ett mönster som täcker *alla*
tecken utanför ASCII i strängliteraler, inte med en lista över kodpunkter: kör
`grep -nP "'[^']*[^\x00-\x7F][^']*'" <ändrade filer>` och läs varje träff.
Bokstäver i svenska ord står kvar, medan U+FEFF, U+00A0, U+2013, U+2212, U+200B
och varje annat tecken som inte syns byts mot escapen. Lägg dessutom till
`\xef\xbb\xbf` i alterneringen från posten 2026-09-14 och kör den innan paketet
lämnas vidare. Konkret här: `const BOM = '\uFEFF';` i `tests/report-csv.test.js`
och `'\uFEFF'` i `tests/report-api.test.js` rad 624 och 659.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-10 — test: textspärren mot talen 1 och 36 i reports.js går förbi med 3 * 12
**Vad gick fel:** Testet `talen 1 och 36 står aldrig skrivna som tak i
src/server/reports.js` (`tests/report-api.test.js` rad 256–269) läser källtexten
med tre villkor: att `\b36\b` inte finns, att `count` inte jämförs med en siffra,
och en `includes` av den exakta texten
`count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS`. Mutationen kördes i
en kopia av trädet: villkoret byttes mot `count > TAK` med `const TAK = 3 * 12;`,
och den exakta texten flyttades till en kommentar på raden ovanför. Hela sviten
gav då `ℹ tests 1098`, `ℹ fail 0` och `EXIT=0`. Talet står alltså skrivet i
`reports.js` igen, nu i en annan stavning, utan att något test faller. Inget
beteendetest kan märka det, eftersom båda stavningarna ger samma tal.
**Varför:** Spärren söker efter *stavningar* av talet (`36`, `count > <siffra>`)
i stället för att kräva *bindningen*, alltså att jämförelsen läser
`OVERVIEW_MAX_MONTHS`. `includes`-kontrollen matchar texten var den än står, även
i en kommentar. Det är samma grundorsak som posterna 2026-09-07
(`saveEntries as X`) och 2026-09-12 (de fetstilta paketmarkörerna): en spärr som
bara har prövats med de stavningar den själv är skriven för.
**Regel framåt:** En textspärr som ska kräva att ett namn används ska ta bort
kommentarerna innan den matchar, med
`källa.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')`, och därefter
kräva att jämförelsen står med namnet, inte bara att en siffra saknas. Innan
spärren räknas som skriven ska den ha prövats med minst tre stavningar: literalen
`36`, ett uttryck som `3 * 12` och en lokal konstant med kravtexten kvar i en
kommentar. Varje stavning ska ge `EXIT=1`, och kryssraden klistras in i
redovisningen.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-10 — test: tre delvillkor i rapportens nya kod överlever mutation
**Vad gick fel:** Tre mutationer kördes en i taget i en kopia av trädet, och var
och en gav `ℹ tests 1098`, `ℹ fail 0` och `EXIT=0` på hela sviten:
(1) `budgetOre === null ? { text: EMPTY } : { amountOre: budgetOre }` i
`src/core/report-csv.js` (kolumnen Tak) bytt mot `budgetOre == null`;
(2) samma byte i villkoret för kolumnen Över tak;
(3) `if (req.method === 'GET')` före `handleReadReport` i `src/server/api.js`
bytt mot `if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE')`.
Med (1) och (2) blir ett tak som är `undefined` en tyst tom cell i filen. Med
originalkoden kastar `toCsv` i stället
`csvAmountSek kräver ett säkert heltal öre.`, vilket är det testet
`(RA30) ett belopp som inte är ett öretal släpps vidare och fälls av csvAmountSek`
säger att filen gör — men testet prövar bara kolumnen Belopp, aldrig kolumnen
Tak. Med (3) får `PATCH` och `HEAD` mot rapportvägarna `200` i stället för `405`,
eftersom 405-testet bara skickar `POST`, `PUT` och `DELETE`. Däremot prövar
`tests/bill-api.test.js` rad 360 och `tests/plan-api.test.js` rad 344 `PATCH`.
**Varför:** Byggarens 78 mutationer prövade värden och felmeddelanden, inte de
villkor som skiljer `null` från `undefined` eller `GET` från alla andra metoder.
Testdatan för kolumnen Tak innehöll bara `null` och giltiga tal, och testet för
metoderna bara de tre som en annan väg i samma fil använder. Tionde gången ett
delvillkor i projektet visar sig sakna skydd av något test.
**Regel framåt:** Ett villkor som skiljer ut ett *enda* värde (`=== null`,
`=== 'GET'`) ska ha ett testfall med det närliggande värde villkoret *inte* ska
släppa förbi: `undefined` för `=== null`, `PATCH` och `HEAD` för `=== 'GET'`.
Konkret ska `(RA30)`-fallet för skadade tal också köras med värden i kolumnen Tak
(`budgetPerMonthOre: [undefined]` och `[NaN]`), och 405-testet för rapportvägarna
ska ha `PATCH` och `HEAD` i metodlistan. Mutationerna `=== null` → `== null` och
`=== 'GET'` → "allt utom POST, PUT och DELETE" ska ge `EXIT=1` med kryssraden
inklistrad.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-10 — process: två val på rapportvägen byggdes och låstes i test utan att ARKITEKTUR.md avgjort dem
**Vad gick fel:** `ARKITEKTUR.md` rad 10697–10715 säger att `<N>` följer
`segmentAfter`-regeln, "ingen trimning, ingen avkodning och ingen normalisering —
ett värde som inte matchar exakt finns inte", men tar inte ställning till
inledande nollor. `reportFromPath` i `src/server/api.js` läser `N` med `Number()`
efter `/^[0-9]+$/`, så `/api/rapport/2026-10/012` och `/api/rapport/2026-10/0012`
ger samma `200` med tolv månader som `/12`, medan `/00` ger `400`. Testet
`(RA18) gränserna 1 och 36 och ett tal med inledande nolla ger 200` i
`tests/report-api.test.js` rad 477–488 gör det valet bindande. På samma sätt säger
tabellen bara "`200` med rapporten", medan `handleReadReport` svarar
`{ months, rows, largest }`. Den kroppen är det kontrakt som gränssnittet i punkt
4 ska byggas mot, och den står inte i dokumentet. Byggaren redovisade båda valen
öppet men byggde dem ändå, trots att `CLAUDE.md` säger "ändra `ARKITEKTUR.md`
först, bygg sedan".
**Varför:** Byggaren lämnade tillbaka punkt 4 eftersom specen hade hål, men
bedömde att hålen i punkt 3 var små nog att fylla själv. Ett test som låser ett
val som dokumentet inte gjort blir i praktiken ett andra facit: nästa arkitekt
som skriver regeln möts av ett grönt test som kanske säger emot den. Det är samma
ordningsfel som posten 2026-09-14 om testfall som byggdes utan sin rad i
`ARKITEKTUR.md`.
**Regel framåt:** Hittar byggaren ett fall som specen inte avgör — inledande
nollor, svarskroppens fält, en statuskod — ska fallet lämnas tillbaka till
arkitekten innan något test skrivs för det, precis som punkt 4 lämnades tillbaka.
Ett "eget val" i redovisningen räknas som ett öppet hål, inte som ett beslut.
Konkret ska arkitekten i `ARKITEKTUR.md` avgöra om `/012` ger `200` eller `404`
(`segmentAfter`-principen talar för `404`, med mönstret `/^(0|[1-9][0-9]*)$/`)
och skriva ut 200-kroppen på JSON-vägen som `{ months, rows, largest }`. Först
därefter får testet på rad 477–488 stå kvar eller skrivas om.

### 2026-10-10 — dokumentation: spärrtabellen för report-csv.js skriver rad 5 och 6 annorlunda än koden
**Vad gick fel:** Tabellen "Ingångsspärrar i `src/core/report-csv.js`" i
`ARKITEKTUR.md` rad 10818–10825 har kolumnrubriken "Villkor, skrivet som i
koden" och anger rad 5 som
`report.rows[i].perMonthOre.length !== report.months.length`. Koden i
`checkReport` i `src/core/report-csv.js` lyder
`!Array.isArray(report.rows[i].perMonthOre) || report.rows[i].perMonthOre.length !== report.months.length`,
och rad 6 skiljer sig på samma sätt. Kommandot
`sed -n 10816,10826p ARKITEKTUR.md | grep -c "Array.isArray(report.rows\[i\].perMonthOre)"`
ger `0`. Stycket under tabellen (rad 10833–10836) kräver själv `Array.isArray`
före längden, så filen ger två svar på hur villkoret ser ut. Koden följer
stycket, så det är tabellen som är fel. Delvillkoret bär: mutationen som tar bort
`Array.isArray` ur rad 5 ger `EXIT=1` med två fallerande testfall.
**Varför:** Kravet på `Array.isArray` lades till som ett stycke under tabellen
och inte på tabellraden. Det är samma fel som posterna 2026-08-23 (två facit i
samma fil) och 2026-09-02 (`totalYearlyOre`-tabellen) beskriver. Tionde gången
`ARKITEKTUR.md` innehåller ett påstående om koden som koden inte uppfyller.
**Regel framåt:** Läggs ett delvillkor till i en spärrtabell med rubriken
"skrivet som i koden" ska det skrivas *på tabellraden*, aldrig i ett stycke under
tabellen. Kontrollen är mekanisk och körs efter varje ändring av tabellen: för
varje rad, kör `grep -cF "<villkoret i tabellen>" <modulen>` och kräv minst `1`.
Ett villkor som i koden sträcker sig över flera rader jämförs efter att
radbrytningar och indrag normaliserats bort.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — dokumentation: steg 5 lämnades vidare med sju "inte körd"- och "Byggaren ska"-rader som redan är utförda
**Vad gick fel:** Återfall av posten 2026-09-07 ("fem 'inte kört av
arkitekten'-markörer står kvar i ARKITEKTUR.md fast körningen är gjord").
Beslutsloggen för steg 5 del 3 och avsnittet "Nedladdningen" säger fortfarande
att fyra saker är okörda eller ska göras: rad 11251 ("arkitekten har ingen
körning bakom det; byggaren kör ..."), rad 11582–11583 ("Läsningen är inte körd
... **Byggaren ska** ... asserta längden"), rad 11612 och 11623 ("**Byggaren
ska** låta (95):s andra argument ..." och "Talen 14 till 17 är arkitektens
räkning ..., inte körda"), rad 11635 ("**byggaren ska** döpa om dem") och rad
11674–11675 ("arkitektens läsning och inte körd: **byggaren ska** pröva det").
Alla fyra är utförda och stämmer: `tests/app.test.js` rad 4675, 4684, 4692 och
4703 asserterar `anrop.length` 8, 11, 14 och 17 med de föreskrivna
meddelandena; `(D15)` står på `tests/demo.test.js` rad 1729 och `(RA37)` på
`tests/report-api.test.js` rad 382; granskarens körning av
`new Response(String.fromCharCode(0xFEFF) + 'a').text()` gav längden `1`, alltså
att `text()` tar bort BOM:en; och `grep -rnI $'\xef\xbb\xbf'` mot en `.js`-fil i
scratchpad vars första rad börjar med de tre byten gav en träffrad. Utfallen
står ingenstans i `ARKITEKTUR.md`.
**Varför:** Rättningarna skrevs "innan granskaren kör", som order i presens, och
samma mekanism som posterna 2026-09-04 (`Kvar i paket N`) och 2026-09-07 ("I
dagens", "inte kört av arkitekten") beskriver gjorde dem falska i samma stund
byggaren utförde dem. Beslutsloggen säger sedan 2026-09-07 att mekanismen "inte
kört av arkitekten" avskaffades, men den kom tillbaka med andra ord ("inte
körd", "arkitektens räkning", "ingen körning bakom det"). Den sökning posten
2026-09-07 föreskriver, `grep -n "inte kört\|inte körd\|arkitektens läsning"`,
träffar bara en del av raderna, eftersom den är skriven för de stavningar som
fanns då.
**Regel framåt:** Innan ett paket lämnas vidare kör arkitekten
`awk 'NR>=<avsnittets första rad>' ARKITEKTUR.md | grep -nE "inte kör(t|d|da)|arkitektens (läsning|räkning)|ingen körning|[Bb]yggaren (ska|kör)"`
och skriver om varje träff i dåtid med det körda utfallet och testets namn
("Körd i steg 5 del 3: `<kommando>` gav `<utfall>`, testfall `<namn>`"), eller
klistrar in körningen som visar att frågan fortfarande är öppen. Byggaren
redovisar utfallet av varje "Byggaren ska"-rad med radnumret i `ARKITEKTUR.md`,
så att arkitekten vet vilka rader som ska skrivas om. Ett utfall som bara står i
en testfil eller i en logg i scratchpad räknas inte som redovisat.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — test: återställningen av URL.createObjectURL i loadApp skyddas av inget test
**Vad gick fel:** Återfall av posten 2026-09-22 ("laddarens återställning av den
frusna dagen ..."), vars regel säger att ett krav på att "återställa det
tidigare värdet" räknas som oprövat tills det har körts. `ARKITEKTUR.md` rad
11275–11279 kräver att `URL.createObjectURL` återställs "i **samma**
`t.after`-hook som `document`, `fetch` och dagen". Mutationen i en kopia av
trädet, där raden `URL.createObjectURL = tidigareCreateObjectURL;` i
`tests/helpers/dom.js` rad 696 togs bort, gav `node --test tests/app.test.js`
med `fail 0` och `EXIT=0`. Testet `(33) laddarens after-hook lämnar tillbaka
globalThis efter ett avvisat andra anrop` (`tests/app.test.js` rad 1888–1895)
prövar `globalThis.document` och `globalThis.fetch` men inte den tredje global
laddaren nu byter. Förvalet är lika oskyddat: att byta
`throw new Error('createObjectURL anropades utan attrapp')` på
`tests/helpers/dom.js` rad 54 mot `return 'blob:x'` gav också `fail 0` och
`EXIT=0`.
**Varför:** Laddaren fick en ny global, men testet som prövar återställningen
räknar upp sina globaler vid namn och lästes inte om när listan växte. Det är
samma form som posten 2026-09-07 om `writeQueue`, där ett nytt namn söktes upp i
koden men inte i det som beskriver koden. Specen säger *var* återställningen ska
stå, men inte att den ska ha ett testfall, och mutationslistan för steg 5 har
ingen rad för attrappen.
**Regel framåt:** Varje global som `loadApp` sätter ska stå i testet för
after-hooken. Konkret ska `(33) laddarens after-hook ...` också kräva
`URL.createObjectURL === CREATE_OBJECT_URL_FORE_TESTERNA`, med konstanten läst
överst i filen på samma sätt som `FETCH_FORE_TESTERNA`, och mutationen som tar
bort `URL.createObjectURL = tidigareCreateObjectURL;` ska ge `EXIT=1` med den
kryssraden. Förvalet ska ha ett eget fall: ett test som klickar på
`report-download` utan att skicka `createObjectURL` ska få den kastade texten.
När en global läggs till i laddaren ska raderna med `tidigare` i
`tests/helpers/dom.js` och testet för after-hooken läsas mot varandra, och varje
global ska finnas i båda.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — test: nedladdningen kan läsa förvalsperioden i stället för reportCount utan att något test faller
**Vad gick fel:** Återfall av posten 2026-09-16 ("datumkolumnen i kortet
Kommande dragningar kan bytas mot startDate"). `downloadReport` i
`src/web/app.js` rad 1290 hämtar
`` `/api/rapport/${reportMonth}/${reportCount}/csv` ``, och specens (97) kräver
just `<reportCount>`. Mutationen `${reportCount}` → `${REPORT_DEFAULT_PERIOD}`
gav `node --test tests/app.test.js` med `fail 0` och `EXIT=0`. Det enda
testfallet som laddar ned, `(97)` (`tests/app.test.js` rad 4780), gör det utan
att först byta period, så `reportCount` är `12`, alltså lika med förvalet, i all
testdata. För användaren betyder mutationen att den som väljer `3 mån` och
klickar på `Hämta som CSV` får en fil med tolv månader.
**Varför:** Testet prövar *vilken månad* nedladdningen gäller (efter ett
misslyckat månadsbyte), men inte *vilken period*, och perioden har samma värde
som förvalet i varje scenario. Två fält som är lika i all testdata går inte att
skilja åt, vilket är regeln i posten 2026-09-16, och den lästes inte mot (97).
**Regel framåt:** Ett testfall som prövar en adress ska byta varje led i
adressen bort från sitt förval innan anropet görs. För (97) betyder det att
klicka på `report-period-3`, svara `200` och därefter ladda ned, och kräva
`` `${rapportvag(MANAD, 3)}/csv` ``. Mutationen `${reportCount}` →
`${REPORT_DEFAULT_PERIOD}` i `downloadReport` ska stå i (97):s mutationskolumn
och ge `EXIT=1` med (97):s kryssrad.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — test: kolumnrubrikerna i F2 kan skrivas om eller byta plats utan att något test faller
**Vad gick fel:** Rubrikerna `Slag`, `Kategori`, `Snitt per månad`, `Summa`,
`Tak` och `Över taket` är användarens beslut F2 och står i `src/web/index.html`
rad 472. Ingen testfil innehåller rubriken `Snitt per månad` (sökningen över
`tests` ger noll träffar). Två mutationer kördes i en kopia av trädet mot hela
sviten: (a) de fyra sista rubrikerna bytta mot `Medel`, `Totalt`, `Budget` och
`Över` gav `fail 0` och `EXIT=0`; (b) `<th>Slag</th><th>Kategori</th>` bytt mot
`<th>Kategori</th><th>Slag</th>` gav också `fail 0` och `EXIT=0`. Med (b) står
`Inkomst` och `Utgift` under rubriken `Kategori` och kategorinamnen under `Slag`,
eftersom `reportRow` skriver cellerna i en fast ordning som inget kopplar till
rubrikernas ordning.
**Varför:** Kravlistans (90) räknar upp uppmärkningen som ska stå i `index.html`
(id:n, `hidden`, knapparnas etiketter) men inte tabellhuvudet. (92) prövar
cellernas klasser och ordning i attrappen, och attrappen har inget `thead`. Av
F1 till F4 är rubrikerna det enda som saknar testfall, och de är också det enda
som binder ihop två filer: ordningen i `index.html` och ordningen i `reportRow`.
**Regel framåt:** Varje användarbeslut (F-punkt) ska ha minst ett testfall som
kräver dess text ordagrant, och mutationen som ändrar texten ska stå i punktens
mutationskolumn. Konkret ska (90) läsa `index.html` och kräva
`<th>Slag</th><th>Kategori</th><th>Snitt per månad</th><th>Summa</th><th>Tak</th><th>Över taket</th>`
ordagrant, och ordningen ska kopplas till cellerna genom en lista
`[['Slag', 'report-kind'], ['Kategori', 'report-category'], ...]` som testet
prövar mot både `index.html` och klasserna i (92). Mutationerna (a) och (b) ovan
ska ge `EXIT=1` med (90):s kryssrad.

### 2026-10-11 — gränssnitt: ett rapportfel står kvar i #month-error efter att ett nytt försök lyckats
**Vad gick fel:** `loadReport` och `downloadReport` i `src/web/app.js` skriver
serverns text i `#month-error` vid ett misslyckat svar (rad 1242 och 1306), men
ingen av dem tömmer elementet vid ett senare `200` (rad 1246 anropar bara
`renderReport` och sedan `showCard`). Scenariot kördes med den incheckade
DOM-attrappen i en kopia av trädet. Ett klick på `6 mån` som svarade `500` gav
`#month-error = "Det gick inte att läsa dina uppgifter. Försök igen."` och fyra
rader. Ett därpå följande klick på `3 mån` som svarade `200` gav en rad och
markeringen `["true","false","false"]`, men **samma text stod kvar i
`#month-error`**. Användaren gör det texten ber om, försöker igen och lyckas,
men ser fortfarande beskedet om att det misslyckades bredvid den nya rapporten.
Texten försvinner först vid nästa lyckade hämtning av *månaden*.
**Varför:** `#month-error` delas av månadens och rapportens hämtningar.
Svarstabellen för `loadReport` (`ARKITEKTUR.md` rad 11104–11110) har en rad per
svar som säger vad som *skrivs* vid ett fel, men ingen rad för vad som händer
med elementet vid `200`. Månadens regel ("töms vid varje lyckad hämtning, och
bara då") gäller månaden, och ingen tog ställning till om en lyckad rapport får
tömma ett fel som kan ha kommit från månaden. Det är det tredje tillståndet som
posten 2026-09-10 ("totalrutan och tomläget har ett tredje tillstånd som specen
inte nämner") kräver en rad för: ett element som bara skrivs på felvägen.
**Regel framåt:** När ett element delas av flera hämtningar ska specen ange, för
varje hämtning, vad ett `200` gör med elementet och vems fel det får tömma.
Arkitekten avgör det i svarstabellen för `loadReport` och i stegen för
`downloadReport`. Två möjliga lösningar är att rapportens fel får ett eget
element i kortet, eller att `#month-error` töms vid `200` bara om texten skrevs
av rapporten. Testfallet är obligatoriskt: ett misslyckat periodbyte följt av
ett lyckat ska asserta `#month-error` efter det andra svaret, och likadant en
misslyckad nedladdning följd av en lyckad. Varje gång ett delat element får en
ny `textContent`-tilldelning ska alla tilldelningar av det elementet räknas upp
i specen, med vilken hämtning som skriver och vilken som tömmer.

### 2026-10-11 — test: "#month-error skrivs och töms aldrig av rapporten" prövas bara för loadReports 200, inte för 403 och nedladdningen
**Vad gick fel:** Återfall av posten 2026-09-23 ("de två 'oförändrad'-raderna i
facittabellen ... skyddas av inget test"). `ARKITEKTUR.md` rad 11139 slår fast
att `#month-error` "skrivs och töms aldrig av `loadReport` eller
`downloadReport`", och rad 11152 att "En hämtning som pågår tömmer inte
`#report-error`". Fyra mutationer som bryter de två meningarna kördes en i taget
i en kopia av trädet, och alla gav `node --test tests/app.test.js` med
`fail 0` och `EXIT=0`: (1) `MONTH_ERROR.textContent = '';` tillagt i
`loadReport`s gren för `403` (`src/web/app.js` rad 1246); (2) samma rad
tillagd efter `link.click()` i `downloadReport` (rad 1335); (3)
`REPORT_ERROR.textContent = '';` först i `loadReport`, före `fetch`; (4) samma
rad först i `downloadReport`. Mutation (1) träffar den vanligaste vägen i appen:
en Bas-användare får alltid `403` på rapporten, och vid start hämtas rapporten
sist, så ett `500` från räkningarnas eller sparmålens väg försvinner från
skärmen så snart rapportens `403` kommer. Det är precis den risk
beslutsloggen (rad 11741–11746) anger som skäl för `#report-error`, men
testfallet `(100) ett 200 på rapporten tömmer inte ett fel från räkningarnas väg`
(`tests/app.test.js` rad 5000) prövar den bara med svaret `200`.
**Varför:** (100):s mutationskolumn har en rad för varje tilldelning som *finns*
i koden, och `MONTH_ERROR` i `200`-grenen är den enda "inte tömma"-mutation den
nämner. Garantin i rad 11139 gäller däremot varje gren i två funktioner. Att
`#month-error` lämnas orört är ett utfall av typen "gör ingenting", och sådana
utfall fälls bara av en mutation som *inför* handlingen i varje gren, vilket är
regeln i posten 2026-09-23. Den tillämpades på en gren av fyra.
**Regel framåt:** En mening som säger att ett element "aldrig" skrivs eller töms
av en funktion ska ha en mutation per gren i funktionen som inför
tilldelningen. Testet ska ställa elementet i ett icke-tomt läge före svaret.
Konkret ska (100)(c) köras med rapportens svar `200` **och** `403`, och ett
motsvarande fall för nedladdningen (`200` med Blob och `403`) ska kräva att
räkningarnas text står kvar i `#month-error`. Mening rad 11152 ska ha ett fall
där ett anrop hänger och `#report-error` asserteras innan svaret kommer, för
både periodbyte och nedladdning. Mutationerna (1)–(4) ovan ska stå i (100):s
mutationskolumn och ge `EXIT=1` med (100):s kryssrad.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — test: den nya felraden #report-error kan tappa sin klass och sin role utan att något test faller
**Vad gick fel:** `ARKITEKTUR.md` rad 11061 gör uppmärkningen
`<p class="form-error" id="report-error" role="alert"></p>` bindande, och den
står i `src/web/index.html` rad 491. Två mutationer i en kopia av trädet gav
båda `node --test tests/app.test.js` med `fail 0` och `EXIT=0`:
`class="form-error"` bytt mot `class="x"`, och `role="alert"` struket. Med den
första visas rapportens fel utan felstilen. Med den andra läser en skärmläsare
inte upp felet. Ingen testfil innehåller `id="report-error"` som uppmärkning,
och kravlistans (90), som läser `index.html` för rapportens kort, räknar inte
upp elementet.
**Varför:** Regeln om statiska klasser i beslutsloggen (rad 11779–11799) gäller
bara klasser vars selektor "ett paket lägger till i `style.css`". `.form-error`
fanns före steg 5, så en klass som ett nytt element i steg 5 *använder* faller
utanför. Regelns eget skäl är att "en omdöpt klass i `index.html` tappar stilen
lika tyst som en omdöpt klass i `app.js`", och det gäller lika mycket ett nytt
element med en gammal klass. Regeln går alltså att följa bokstavligt, men den är
smalare än sitt skäl, vilket posten 2026-09-07 om millisekundförbudet varnar för.
`role="alert"` är inget klassnamn och omfattas inte av någon regel alls.
**Regel framåt:** Utlös regeln på *elementet* och inte på selektorn. Varje
element som ett paket lägger till i `index.html` ska asserteras med sin hela
öppnande tagg, alltså klass, id och varje attribut som påverkar stil eller
tillgänglighet (`role`, `aria-*`, `hidden`), i det testfall som läser
`index.html` för samma kort. Konkret ska (90) kräva
`<p class="form-error" id="report-error" role="alert"></p>` ordagrant, och de
två mutationerna ovan ska stå i (90):s mutationskolumn och ge `EXIT=1`.

### 2026-10-11 — dokumentation: rättningen av de okörda ordrarna lade till en ny, som sökmönstret inte fångar
**Vad gick fel:** Återfall av posten 2026-10-11 ("steg 5 lämnades vidare med sju
'inte körd'- och 'Byggaren ska'-rader"), i samma omgång som rättade den.
Beslutsloggen i `ARKITEKTUR.md` rad 11751–11754 säger "Uttrycken
`REPORT_ERROR.textContent = …` i (88), (96), (98) och (100) finns inte i
`src/web/app.js` förrän rättningen är byggd; sökningen per mutationsuttryck körs
efter bygget." Rättningen är byggd: uttrycket står i `src/web/app.js` på rad
1233, 1246, 1252, 1256, 1303, 1314, 1318, 1326 och 1335. Sökningens utfall står
inte i dokumentet. Arkitektens egen kontroll, den rubrikförankrade sökningen på
rad 11725–11727, ger ingen träff på meningen, eftersom den letar efter `inte
kör(t|d|da)`, `arkitektens (läsning|räkning)`, `ingen körning` och
`[Bb]yggaren (ska|kör)`. Meningen säger "förrän" och "körs efter bygget".
**Varför:** Sökmönstret räknar upp stavningar av en order i stället för rollen
"ett påstående om framtiden som blir falskt när det utförs". Det är samma fel
som posten 2026-09-12 beskriver om paketmarkörer förankrade i typografi: en
spärr prövad bara med de stavningar den själv är skriven för.
**Regel framåt:** Sökningen efter okörda markörer ska också fånga tidsord som
pekar framåt: lägg till `förrän|körs efter|ska köras|när .* är byggd` i
alterneringen och läs varje träff. En mening i beslutsloggen får aldrig villkora
sin sanning på en framtida byggnad ("finns inte förrän ..."). Skriv i stället
utfallet efter bygget, eller skriv kravet som en rad i kravlistan, vilket
beslutsloggen själv föreskriver på rad 11733–11736.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-11 — dokumentation: "inte byggda" om sparmål, rapporter och planer står kvar på tre ställen, varav ett visas för användaren
**Vad gick fel:** Tre texter säger att funktioner som är byggda inte finns:
(1) HTML-kommentaren i `src/web/index.html` rad 90–94 säger att "sparmål, delat
hushåll, rapporter, Mina funktioner och prioriterad support - är inte byggda
ännu"; (2) `ARKITEKTUR.md` rad 9437–9442, "Det demon inte visar", säger att
"prisplaner, behörighet, sparmål, räkningspåminnelser, delat hushåll och Mina
funktioner är **inte byggda**" och att "En planväxlare ... byggs inte"; (3)
`NOT_BUILT_TEXT` i `src/web/demo/banner.js` rad 29–30 säger samma sak i
bannerns hjälptext, som visas för besökaren så snart `DEMO` är sann. Planer,
behörighet (`requireFeature` och demons `kraverFunktion`), sparmål, räkningar
med påminnelse och rapporten är byggda, både i appen och i demon:
`src/web/demo/demo-fetch.js` har `PLAN_PATH` (rad 89), `BILLS_PATH` (rad 99),
`GOALS_PATH` (rad 103) och `REPORT_PATH_PREFIX` (rad 116). Kommentaren i (1)
kom in i commit `044f72d` (enligt `git log -S "är inte byggda ännu"`) och har
stått kvar genom steg 4 och 5.
**Varför:** Alla tre beskriver projektets läge när de skrevs ("ännu", "byggs
inte") och är alltså samma sorts åldrande påstående som posterna 2026-09-04
(`Kvar i paket N`) och 2026-09-12 (framtidspåståenden om paket 7). Sökningarna
som de posterna föreskriver körs mot `ARKITEKTUR.md`, inte mot kommentarer i
`src/web/` eller mot användarvända konstanter. `banner.js` säger själv att
texten är "Samma uppräkning som ARKITEKTUR.md under 'Det demon inte visar'".
Två kopior av samma påstående åldrades därför tillsammans, och ingen av dem har
ett test.
**Regel framåt:** När ett steg bygger en funktion som tidigare var bortvald,
kör `grep -rniE "inte byggd|inte byggt|byggs inte|ännu" src ARKITEKTUR.md README.md`
och läs varje träff som nämner funktionen. En användarvänd konstant som räknar
upp vad som "inte är byggt" (`NOT_BUILT_TEXT`) ska ha ett test som jämför
uppräkningen mot `FEATURE_LABELS` och de vägar demon svarar på. Konkret ska
arkitekten skriva om "Det demon inte visar" så att bara delat hushåll, Mina
funktioner, prioriterad support och betalning står kvar. Därefter rättar
byggaren `NOT_BUILT_TEXT` och HTML-kommentaren efter den.

### 2026-10-11 — dokumentation: README säger att alla sökvägar utom / och /app ger 404 utan innehåll
**Vad gick fel:** `README.md` rad 550–552 ("En felstavad adress ger en blank
sida") säger "Andra sökvägar än `/` och `/app` svarar `404` utan innehåll". En
körning mot en server på port 3197 med databas och datafil i scratchpad gav
`GET /apps` → `404` och `0` byte, men `GET /tema.css` → `200` (8209 byte) och
`GET /api/finnsinte` → `404` med kroppen `{"error":"Okänd adress."}`.
`STATIC_ROUTES` i `src/server/server.js` rad 51–60 serverar dessutom
`/landning.css`, `/style.css`, `/app.js` och `/priser.js`, och `/core/`,
`/demo/` och `/bilder/` serveras också.
**Varför:** Meningen generaliserade det användaren ser (en felstavad sidadress
ger en blank sida) till ett påstående om servern, utan att routningen lästes.
Dokumentatorn kunde inte köra servern, och påståendet skrevs därför ur
resonemang i stället för ur en körning. Det är samma grundorsak som posten
2026-08-18 om testkommandot.
**Regel framåt:** Ett påstående i `README.md` om vad servern svarar ska avgränsas
till det som prövats, och den som granskar ska köra minst en adress per
grupp i `STATIC_ROUTES`, `/core/`, `/api/` och en okänd sidadress. Här räcker
lydelsen "En felstavad sidadress, till exempel `/apps`, svarar `404` utan
innehåll, så webbläsaren visar en tom sida."

### 2026-10-12 — dokumentation: landningssidan lovar fortfarande månadskostnad, årskostnad och nästa dragning, som appen inte räknar fram
**Vad gick fel:** Återfall av posten 2026-09-12 ("fyra framtidspåståenden om
paket 7 är nu falska, och den nya rutinen fångar inget av dem"), i rättelsen
som skulle göra att landningssidan "lovar inget som inte finns".
`ARKITEKTUR.md` ("Landningssidan lovar inget som inte finns", rad ca 9549) säger
att "Kontrollen mot koden 2026-10-11 hittade löften på tre ställen", och alla tre
gäller planfunktioner. `src/web/landning.html` lovar dock på fem ställen det som
appen från paket 1–8 gjorde och som dagens app inte gör:
- rad 9, sidans `meta description`: "visar månadskostnad, årskostnad och vad som
  dras härnäst";
- rad 87, inledningen: "Du ser månadskostnaden, årskostnaden och vad som dras
  härnäst";
- rad 214, "Räknat i öre": "En kvartalsutgift blir rätt månadskostnad och rätt
  årskostnad";
- rad 249, "Få överblick": "Månadskostnad, årskostnad och nästa dragning räknas
  fram åt dig och står överst";
- rad 317, FAQ-svaret om en utgift som dras var tredje månad: "Appen räknar om
  det till månadskostnad och årskostnad och visar nästa dragningsdatum".

Körning mot en server i en kopia, med data i scratchpad: en kvartalsmall på
900 kr skapad i `2026-10` gav `expenseOre` `90000` i `2026-10` och `2027-01` och
`0` i `2026-11` och `2026-12`. Ingen omräkning till månads- eller årskostnad
sker. Postraden i `renderItem` (`src/web/app.js`) visar namn, kategori, belopp
och återkommandemärket, men inget dragningsdatum, och `src/web/app.js`
importerar varken `cost.js` eller `nextDueDate`. Överst i månadsvyn står
Inkomster, Utgifter, Sparande och Kvar att leva på.
**Varför:** Kontrollen gick från `FEATURE_LABELS` och `NOT_BUILT_FEATURES` till
sidan, och (P18) söker efter funktionsnamn och fyra fasta fraser. Den hittar
därför bara löften om *planfunktioner*. Användarens beslut gäller allt som inte
finns, och de här meningarna skrevs för appen i paket 1–8 (månadskostnad per
post, `Kommande dragningar`). När appen byggdes om till en månadsbudget lästes
de aldrig om. Kontrollen var förankrad i en sluten lista (funktionsnycklarna) i
stället för i rollen "ett påstående om vad appen gör". Det är samma fel som
posterna 2026-09-07 (`saveEntries as X`), 2026-09-12 och 2026-09-22
(klockkontrollen) beskriver.
**Regel framåt:** En kontroll av att en sida "inte lovar något som inte finns"
läser varje mening på sidan, inte bara de meningar som innehåller ett
funktionsnamn. Ta ut den synliga texten (taggar, kommentarer, `<script>` och
`<svg>` bortrensade, `meta description` med), och skriv i specen en rad per
mening med påstående och den kodrad eller körning som visar att det stämmer.
Konkret ska arkitekten skriva om de fem meningarna ovan efter dagens app, lägga
in lydelsen ordagrant i "Landningssidan lovar inget som inte finns" och lägga
till `månadskostnad`, `årskostnad` och `nästa dragning` i (P18):s förbjudna
fraser. `Räkningar i tid` (rad 133) ska bedömas för sig: räkningar har
förfallodag och intervall, och `Betald` flyttar fram dem.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-12 — test: talet i den nya fördelen "Tolv månader i en översikt" skyddas inte av något test
**Vad gick fel:** `ARKITEKTUR.md` skriver fördelen `Hela året på en gång` med
stycket "Tolv månader i en översikt: …" som bindande ordagrant och motiverar
det med "Påståendet stämmer mot koden: `readOverview` svarar med tolv månader
(`OVERVIEW_MONTHS` i `src/server/api.js`)". Mutationen `Tolv månader i en
översikt` → `Tretton månader i en översikt` i `src/web/landning.html`, körd i en
kopia av trädet, gav `node --test tests/priser.test.js` med `fail 0` och
`EXIT=0`. (P18) kräver bara rubriken `<h3>Hela året på en gång</h3>`, inte
stycket.
**Varför:** Specen kontrollerade påståendet mot koden när det skrevs, men
kopplingen mellan talet på sidan och `OVERVIEW_MONTHS` står bara i prosa. Ändras
översiktens längd, eller texten, lovar sidan något annat än appen gör utan att
något test märker det. Det är samma lucka som posten 2026-10-11 om F2:s
kolumnrubriker: en bindande text utan test.
**Regel framåt:** Ett påstående på landningssidan som specen säger "stämmer mot
koden" ska ha ett test som läser båda: här ska (P18) kräva stycket ordagrant och
kontrollera att talordet motsvarar `OVERVIEW_MONTHS`, till exempel med en tabell
`{ 12: 'Tolv' }` i testet och en assertion som faller om konstanten ändras.
Mutationen `Tolv` → `Tretton` ska stå i (P18):s mutationskolumn och ge `EXIT=1`.

### 2026-10-12 — test: låstestets 20 processtarter har ingen omförsöksväg, och en barnprocess som startar långsamt gör hela sviten röd
**Vad gick fel:** Återfall av posten 2026-09-15 (SIGKILL-testets 200 forkar), i
ett annat test. `tests/lock.test.js` rad 272, `fall 1: instans två startar inte
mot samma datafil, 20 omgångar`, startar en server och därefter 20 instanser
mot samma datafil (`OMGANGAR = 20`, rad 47). Den väntar på varje instans med
`waitForClose` (rad 227–237) och tidsgränsen `CHILD_START_TIMEOUT_MS = 30000`.
Ett `timeout` går rakt till `assert.equal(utfall.kind, 'close', …)` på rad 289.
I loggarna i scratchpad har testet körts i 86 fullkörningar, och de två som föll
(`mut-P20-5.log`, 181 091 ms, och `npm4-2.log`, 36 420 ms) föll båda med
`omgång 1: instans två avslutades aldrig (timeout): exitCode=null,
signalCode=null, stdout="", stderr=""`. Koden var oförändrad: övriga 84 körningar
gav `✔` på cirka 4–6 s, och granskarens tre körningar 2026-10-12 gav
`ℹ tests 1154`, `ℹ fail 0` och `EXIT=0` var. `exitCode=null` och tom utdata
betyder att barnprocessen levde men inte hann skriva sin rad på 30 s. Barnet
dog alltså inte, och låset fungerade.
**Varför:** Regeln från 2026-09-15 kräver att varje icke-deterministiskt utfall
i en loop med processtarter antingen tas om upp till ett tak, eller står i
`ARKITEKTUR.md` som ett hårt fel med skälet utskrivet. Den skrevs och tillämpades
bara för SIGKILL-testet i `tests/storage.test.js`. Ingen sökning gjordes efter
andra tester med samma form, alltså en loop med `spawn` och en tidsgräns som
domare. Därför står låstestet kvar med en tidsgräns som skiljer "barnet dog"
från "barnet startade långsamt" bara genom att båda blir ett fel. Följden är att
`CLAUDE.md`:s grind "`npm test` ska ge `fail 0` och exit 0" är icke-deterministisk
också i det här testet. Den har slagit fel i ungefär 2 av 86 körningar på den
här maskinen, och felet syns för en byggare som en regression i det paket hen
just arbetar med.
**Regel framåt:** Kör `grep -lnE "spawn\(|fork\(" tests/*.test.js` och tillämpa
regeln från 2026-09-15 på varje träff, inte bara på det test en lärdom namnger.
För `fall 1` i `tests/lock.test.js`: ett `timeout` där barnet lever
(`exitCode === null` och `signalCode === null`) ska döda barnet, kassera omgången
och köra en ny, upp till ett tak som skrivs i `ARKITEKTUR.md` (förslagsvis 3
kasserade omgångar). Antalet kasserade omgångar asserteras mot taket och skrivs
ut i felmeddelandet. Ett barn som avslutas med fel kod, skriver till stdout
eller skriver en annan stderr är fortfarande ett hårt fel. Felet ligger utanför
den rättelse där det upptäcktes och rättas som ett eget paket. Tills dess räknas
en röd körning med just det här meddelandet som ogiltig och tas om, och tre
gröna körningar i rad krävs, enligt posten 2026-09-07 om `fail 1`.

### 2026-10-13 — test: sonden /bilder/hero-ekonomi.jpeg ger 404 för att filen saknas, inte för att mönstret avvisar ändelsen
**Vad gick fel:** Beslutsloggen i `ARKITEKTUR.md` del 6 motiverar "Servern får
`jpg`, inte `jpeg`" med att "sonden `/bilder/hero-ekonomi.jpeg` kräver `404`",
men sonden kan inte fälla den mutation beslutet handlar om: `IMAGE_FILE_PATTERN`
i `src/server/server.js` ändrat från `(png|svg|jpg)$/` till
`(png|svg|jpg|jpeg)$/` ger med `tests/hero.test.js` och `tests/server.test.js`
`ℹ fail 0` och `EXIT=0`, eftersom någon fil `hero-ekonomi.jpeg` inte finns och
servern därför svarar `404` oavsett mönstret. Sonden `.JPG` bär däremot sitt
skydd: flaggan `/i` på samma mönster ger `EXIT=1` och
`✖ sökvägsfiltret för /bilder/: en sökväg ut ur bildkatalogen ger 404 utan kropp`,
eftersom NTFS hittar `hero-ekonomi.jpg` under det versala namnet.
**Varför:** Sonden skrevs efter det utfall den förväntas ge (`404`) och inte
efter den kodväg som ska ge det; en `404` kan komma både från mönstret och från
att filen saknas, och bara det första är det beslutet kräver. Mutationslistan i
(H1) räknar inte upp "lägg till `jpeg` i mönstret", så ingen körning visade att
sonden inte kan skilja de två orsakerna åt. Samma form som posten 2026-09-07
(`app.js` hämtas över HTTP och jämförs byte mot byte, så vilket innehåll som
helst passerar).
**Regel framåt:** En sond som ska bevisa att ett mönster avvisar ett namn ska
gälla ett namn vars fil **finns** på disk under en form filsystemet hittar, så
att `404` bara kan komma från mönstret — eller kombineras med ett direkt test av
mönstret (`IMAGE_FILE_PATTERN.test('hero-ekonomi.jpeg') === false`). Varje
motivering i beslutsloggen av formen "sonden X kräver Y" ska ha en mutation i
kravlistan som tar bort det skydd sonden påstås ge, körd med `EXIT=1`.

### 2026-10-13 — test: (H3):s krav på exakt en url() i landning.css ser bara dubbelfnuttade adresser
**Vad gick fel:** (H3) i `tests/server.test.js` tar ut adresserna i
`src/web/landning.css` med `/url\("([^"]+)"\)/g` och kräver exakt en träff, men
CSS tillåter också `url('…')` och `url(…)` utan citattecken. Körd i en kopia:
raden `background-image: url(bilder/finns-inte.png);` tillagd i `.hero-inre` ger
`ℹ fail 0` och `EXIT=0` — en andra bildadress till en fil som inte finns passerar
alltså det krav som ska fånga en andra adress. Mutationen i kravlistan,
`url("bilder/logga.png")`, fälls bara därför att den råkar vara skriven med samma
citattecken som mönstret.
**Varför:** Spärren läser källkod som text och prövades bara med den stavning den
själv är skriven för — samma fel som posterna 2026-09-07 (`saveEntries as X`),
2026-09-12 (paketmarkörerna) och 2026-09-22 (WeakSet-spärren och `t.test`).
**Regel framåt:** Ett mönster som plockar ut `url(...)` ur CSS ska täcka alla tre
stavningarna: `/url\(\s*(["']?)([^"')]+)\1\s*\)/g`. Mutationslistan för en
textspärr ska ha en rad per stavning språket tillåter, och varje rad ska ha körts
med `EXIT=1`.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-13 — tema: --gron-djup blev en token utan användare när --hero-till togs bort
**Vad gick fel:** `ARKITEKTUR.md` del 6 tar bort `--hero-fran` och `--hero-till`
med skälet "en token utan användare är en osann uppgift om vad temat bär", men
`--hero-till` var den enda användaren av `--gron-djup`: `git grep -n
"var(--gron-djup)" HEAD -- src` gav en träff (`--hero-till` i `src/web/tema.css`)
och samma sökning i arbetsträdet ger noll, medan `--gron-djup: #025b38;` står kvar
på rad 19 och i palettabellen i `ARKITEKTUR.md`. Den gamla HTML-kommentaren i
hero ("8,22:1 mot --gron-djup") försvann i samma ändring.
**Varför:** Principen tillämpades på de tokener uppdraget namngav men inte ett
led längre ner: ingen sökte efter vilka tokener som förlorade sin sista användare
när `--hero-till` försvann. Samma grundorsak som posten 2026-09-07 om
`saveEntries`, som blev en export utan anropare när `updateEntries` tog över.
**Regel framåt:** När en token, export eller variabel tas bort ska varje token den
refererar till (`var(--x)` i dess värde) sökas med `grep -rn "var(--x)" src` efter
borttagningen. Ger sökningen noll ska den antingen tas bort i samma ändring eller
få en rad i `ARKITEKTUR.md` som säger att den står kvar och varför — för en
palettoken uppmätt ur loggan är "den hör till paletten" ett godtagbart skäl, men
det ska stå skrivet.

### 2026-10-13 — dokumentation: steg 10 kräver noll träffar på ett mönster som (H5) måste innehålla
**Vad gick fel:** Byggarens instruktion 10 i del 6 säger att
`grep -rn "hero-fran\|hero-till\|rutnat\|hero-gradient" src tests` ska köras och
att "varje träff ska vara borta", men (H5) i samma kravlista kräver att
`tests/hero.test.js` förbjuder just de namnen, så kommandot ger alltid
`tests/hero.test.js:223:    for (const name of ['--hero-fran', '--hero-till', '--rutnat']) {`
och `EXIT=0`. Instruktionen går inte att uppfylla bokstavligt.
**Varför:** Sökningen skrevs innan testet som förbjuder namnen fanns, och ingen
körde den mot den färdiga kravlistan. Samma fel som posten 2026-09-10
(sökmönstret skrevs in i filen det söker i).
**Regel framåt:** En sökning som ska ge noll träffar ska utesluta den fil som
äger förbudet, och uteslutningen skrivs ut i kommandot (här
`grep -rn … src tests | grep -v "^tests/hero.test.js:"`). Kör varje sådant
kommando efter att kravlistan är färdigskriven och klistra in utdatan.

### 2026-10-13 — test: kommentaren om bildkatalogen säger att alla png-loggor hämtas av sidorna
**Vad gick fel:** Den omskrivna kommentaren i testfallet `varje bild i
src/web/bilder levereras under /bilder/ med sitt eget innehåll` i
`tests/server.test.js` säger "Katalogen har loggorna i png, som headern,
sidfoten, appens sidomeny och faviconen hämtar", men av de tre png-filerna hämtas
bara `logga-liten.png`: `grep -rn "logga\.png\|logga-beskuren" src/web --include=*.html --include=*.js`
ger ingen `src`- eller `href`-träff för `logga.png` eller `logga-beskuren.png`.
`ARKITEKTUR.md` säger i samma ändring rätt sak om `logga-beskuren.png` ("Ingen
sida").
**Varför:** Kommentaren skrevs om för att stryka ett antal (instruktion 7), och
den nya meningen skrevs ur minnet av vad loggan används till i stället för ur en
sökning — samma form som posten 2026-09-10 (kommentaren i `app.js` räknar upp två
av filens fem strängar).
**Regel framåt:** En kommentar som säger vilka filer som hämtar en resurs ska
skrivas efter en sökning på resursens namn i `src/web`, och kommentaren ska bara
räkna upp de filer sökningen visar. Skriv om till exempel: "Katalogen har
loggorna i png — `logga-liten.png` hämtas av headern, sidfoten, appens sidomeny
och faviconen — och hero-fotot `hero-ekonomi.jpg`, som `landning.css` hämtar."

### 2026-10-13 — test: (H12) och (H13) kräver att en regel innehåller en deklaration, men inte att den vinner kaskaden
**Vad gick fel:** Testet `(H12) landning.css har bilden utan slöja, och texten kan
inte hamna på bilden` och testet (H13) passerar trots att texten hamnar på bilden
eller vågen på bilden. Fyra mutationer kördes, var och en i en egen kopia under
scratchpad, med `tests/hero.test.js`, `tests/server.test.js`, `tests/demo.test.js`
och `tests/priser.test.js`. Alla fyra gav `ℹ tests 96`, `ℹ fail 0` och `EXIT=0`:
(G-5) raden `background-size: cover;` tillagd sist i det översta `.hero`, så att
bilden täcker hela sektionen och texten står på den på smal skärm; (G-2) regeln
`.hero-text { max-width: 46rem; }` tillagd efter `@media (min-width: 960px)`, så
att texten vid 960 bildpunkter blir 736 bred och når in i bildens halva;
(G-1) regeln `.hero { padding-bottom: 56.25%; }` tillagd efter `.hero-vag-yta`,
så att remsan försvinner och vågen ligger på bildens nederkant; (G-3) raden
`padding-bottom: 0;` tillagd sist i `.hero` i `@media (min-width: 960px)`.
**Varför:** Kraven är skrivna som `body.includes(deklaration)` och som
`bodies.some(...)`. Båda är sanna så länge deklarationen står någonstans, också när
en senare deklaration eller regel tar över. `HERO_SELECTORS` jämförs som en mängd
(`new Set`), så en andra regel med en selektor som redan finns syns inte.
`.hero-vag` skyddas mot just detta med `vagRules.length === 1`, men samma kontroll
gjordes inte för `.hero` och `.hero-text`, som bär layoutens hela bevis. Detta är
samma fel som posterna 2026-09-07 (`saveEntries as X`), 2026-09-22 (WeakSet och
`t.test`) och 2026-10-13 (`url()` med en stavning): en textspärr som bara prövats
med de stavningar den själv skrevs för.
**Regel framåt:** En spärr som läser CSS som text ska kräva att den bindande
deklarationen är den som gäller. Varje egenskap ska förekomma exakt en gång i
varje regelkropp som prövas, och antalet regler per selektor ska jämföras som en
lista med antal (här `.hero` 2, `.hero-text` 2, `.hero-inre` 2, `.hero h1` 2) och
inte som en mängd. Mutationslistan för en sådan spärr ska alltid ha tre rader per
skyddad deklaration: deklarationen ändrad, en andra deklaration av samma egenskap
sist i samma regel, och en ny regel med samma selektor sist i filen. Varje rad ska
ha körts med `EXIT=1`.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-13 — dokumentation: del 7 beskriver fortfarande den tillfälliga bilden i presens efter bytet till den slutliga
**Vad gick fel:** `hero.png` är den slutliga bilden: sha256 `de69bcc5…daba9b` och
279 561 byte, identisk med `Utgiftskollen – 1920×1080@1x.png` på skrivbordet
(kontrollerat med `cmp`). Ändå står flera meningar i `ARKITEKTUR.md` del 7 kvar i
presens om den tillfälliga bilden. Rad 13143 under "Bilden" säger "Längden ska vara
256 547 byte", medan steg 2 i "Byggarens instruktioner [hero-våg]" kräver 279 561.
Den bindande texten har alltså två svar på samma fråga. Rad 13630–13632 säger att
"den tillfälliga bilden visar dessutom fel namn", men telefonen visar inget namn.
Rad 13690 säger att kontrollen "görs för den tillfälliga bilden nu". Rad 13658
pekar på README "i dag rad 590–591", men raden är struken. Rad 14182 inleds med
`**Kvar efter steg 13, en order till byggaren:**`, fast ordern är utförd: den nya
kommentaren står i `tests/server.test.js` rad 255–264. `tests/hero.test.js` rad 22
säger fortfarande "bilden är tillfällig".
**Varför:** Bytet till den slutliga bilden fördes in som en ny post i
beslutsloggen. Avsnitten som skrevs när bilden var tillfällig lästes inte om. Det
är samma grundorsak som posterna 2026-09-04 (`Kvar i paket 3`) och 2026-09-07
("I dagens ..."): en mening i presens blir falsk när det den beskriver har hänt.
**Regel framåt:** När ett användarbeslut inträffar som en tidigare del väntade på
(här "när den slutliga bilden finns"), kör
`grep -n "tillfällig\|slutliga\|i dag rad\|Kvar efter\|ska vara [0-9]" ARKITEKTUR.md`
över hela delen och samma sökning i de testfiler delen styr. Varje träff skrivs om
i dåtid eller stryks, och utfallet före och efter klistras in. En rad som börjar
med `**Kvar` får inte stå kvar när ordern är utförd. Den skrivs om till
`**Utfört 2026-…:**` med det som gjordes.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-13 — dokumentation: mutation E-10 är skriven utan ankare, och läst bokstavligt träffar den fel svg
**Vad gick fel:** (H13):s mutationskolumn i `ARKITEKTUR.md` anger
"(E-10) i `landning.html`: `focusable="false"` borttaget ur vågens `<svg>`", men
strängen står nio gånger i filen (`grep -c 'focusable="false"' src/web/landning.html`
ger `9`). Mutationen läst som "ta bort `focusable="false"`" träffar den första
förekomsten, som ligger i menyikonen på rad 60. Den mutationen gav `ℹ fail 0` och
`EXIT=0` (granskarens G-4). Byggarens skript ankrade rätt, med strängen
`focusable="false">` följd av radbrytningen och `<path class="hero-vag-yta"`, och
den mutationen fälls. Skyddet finns alltså, men dokumentet beskriver det inte så
att någon kan upprepa det.
**Varför:** (H13) mutation (4) fick ett ankare när arkitekten såg att
`aria-hidden="true" ` står nio gånger. E-10 fördes in i tabellen från byggarens
redovisning och prövades inte på samma sätt. Kontrollen `grep -c "<uttrycket före
pilen>"` kräver bara minst en träff och ser därför inte att en sträng är tvetydig.
**Regel framåt:** Kontrollen av en mutationsrad kräver exakt en träff, inte minst
en. Ger `grep -c -F` mer än `1`, skrivs ankaret ut i tabellen med den omgivande
texten som gör strängen unik. Skriptet som kör mutationen ska använda samma
ankare och vägra köra om antalet träffar inte är `1`.

### 2026-10-13 — dokumentation: förhandsbilden sägs visa ett exakt möte "som räkningen ovan säger", men räkningen säger en bildpunkt
**Vad gick fel:** `ARKITEKTUR.md` rad 13804–13807 säger att bildens nederkant och
vågens överkant vid 375 bildpunkter båda låg vid 691,99, "alltså ett exakt möte
utan överlapp, som räkningen ovan säger". Räkningen ovan säger något annat, på rad
13789–13791: vågen har `bottom: -1px` och höjden `--vag-hojd`, "så den börjar en
bildpunkt under bildens nederkant". Steg 10 i byggarens instruktioner ritar vågen
från `headerH + sektionH - vag` utan `-1px`, så skissen räknade inte med den
bildpunkten.
**Varför:** Skissens utdata fördes in som en bekräftelse av räkningen utan att de
två jämfördes tal för tal.
**Regel framåt:** En mening som säger att en körning "stämmer med räkningen" ska
skriva ut båda talen, och räkningens tal ska tas ur samma regler som körningen
använde. Skiljer sig reglerna (här `bottom: -1px`), skriv ut skillnaden och vad den
betyder i stället för att kalla utfallet ett exakt möte.

### 2026-10-13 — dokumentation: mätningen av den slutliga bilden står i beslutsloggen utan utdata, och "33 stycken" utan kommando
**Vad gick fel:** Posten "Mätningen av den slutliga hero.png kördes" återger
mätningen i löptext: "den största kanalavvikelsen där var högst 7" och
"Kontrasterna blev desamma". Ingen rad ur `matning.mjs` eller `kant.mjs` är
inklistrad, medan posten om den tillfälliga bilden har hela utdatan. Steg 1–11 i
"Byggarens instruktioner [hero-våg]" säger "Alla mutationer i (H12) och (H13), 33
stycken" utan det kommando som räknar dem. Sakligt stämmer båda. Granskarens
körning av `matning.mjs` gav `längd: 279561 byte`, `vanligaste färgen (vänstra
området): a3c6f2, 828672 av 829440 bildpunkter, 99.91 %` och samma fem
kontrastrader som den tillfälliga bilden. `kant.mjs` gav `vänsterkanten (kolumn 0):
1080 punkter, 0 avviker mer än 8, största avvikelse 7`, med `EXIT=0`. Tabellen har
9 kvarvarande rader i (H12) och 24 i (H13).
**Varför:** Den andra mätningen sågs som en upprepning av den första och
sammanfattades. Lärdomen 2026-09-14 kräver ändå att ett mätvärde står med sitt
kommando och sin utdata, så att nästa läsare kan kontrollera det.
**Regel framåt:** Varje mätning som avgör ett stoppvillkor ska klistras in med
utdata i beslutsloggen, också när den upprepar en tidigare. Det räcker med de
rader stoppvillkoren läses ur, ordagrant. Ett antal mutationer skrivs med det
kommando som räknar dem, till exempel antalet `.log`-filer i loggkatalogen, eller
utan siffra.

### 2026-10-14 — test: kaskadspärrens led 3 och (H9) går förbi med en annan stavning av samma sak
**Vad gick fel:** Återfall av posterna 2026-10-13 ("(H3):s krav på exakt en
url() ser bara dubbelfnuttade adresser" och "(H12) och (H13) kräver att en regel
innehåller en deklaration, men inte att den vinner kaskaden"). Led 3 i
"Kaskadspärren [hero-kaskad]" i `ARKITEKTUR.md` lovar "Inga vägar runt listan i
de filer som laddas" och bygger på premissen att "`landning.html` laddar bara
`/tema.css` och `/landning.css`". (H12)(j) i `tests/hero.test.js` rad 476–484
prövar det med `includes('!important')`, `includes('@import')`,
`includes('<style')` och `includes('style=')`, alltså gemener och utan
mellanslag. Mutationerna kördes en i taget i en kopia av trädet under
scratchpad, med `node --test tests/hero.test.js tests/server.test.js
tests/demo.test.js tests/priser.test.js`. Alla sex gav `fail 0` och `EXIT=0`:
(1) `<div class="hero-text">` → `<div class="hero-text" STYLE="max-width: 46rem">`;
(2) samma med `style ="max-width: 46rem"`; (3) raden
`<link rel="stylesheet" href="data:text/css,.hero%7Bpadding-bottom:0%7D" />`
efter länken till `/landning.css`; (4) `@IMPORT "extra.css";` först i
`landning.css`; (5) `section { overflow: hidden ! important; }` sist i
`landning.css`; (6) `.fordel-x { background-image: URL(bilder/finns-inte.png); }`
sist i `landning.css`, som (H9) i `tests/server.test.js` rad 222–224 släpper
igenom trots kommentaren "Mönstret ser alla tre stavningarna av adressen".
HTML-attribut, at-regelnamn, `!important` och CSS-funktionsnamn är okänsliga för
skiftläge, och `!` och `important` får skiljas av blanktecken. (1), (2) och (3)
gör alltså det led 3 ska omöjliggöra: en stil i `landning.html` som skriver över
`HERO_RULES`. Ingen av dem står under "Det spärren inte fångar", och premissen
om de två stilmallarna prövas inte av något test. (`<STYLE>` i versaler fångas
av en slump, eftersom (P20) ser elementets innehåll som text.) Mutationerna
(K-15), (K-16) och (K-17) är skrivna med samma stavning som spärren och fälls
därför.
**Varför:** Spärren och mutationerna som ska pröva den skrevs i samma stavning,
så mutationerna kunde bara visa att spärren fungerar för det fall den redan var
skriven för. Rättningen av lärdomen om `url()` lade till citattecknens tre
stavningar men inte skiftläget, och led 3 räknade upp sina förbjudna konstruktioner
som strängar i stället för som den roll de har ("allt som kan lägga till eller
väga upp en stil i de tre filerna"). Det är samma fel som posterna 2026-09-07
(`saveEntries as X`), 2026-09-12 (paketmarkörerna), 2026-09-22 (WeakSet och
`t.test`) och 2026-10-13 (`url()` med en stavning).
**Regel framåt:** En textspärr mot CSS eller HTML jämför efter `toLowerCase()`
och med blanktecken tillåtna där språket tillåter dem: i led 3 betyder det
`/!\s*important/i`, `/@import\b/i`, `/<style\b/i` och `/\sstyle\s*=/i`, och i
(H9) flaggan `i` på `url(`-mönstret. Premissen om vilka stilmallar sidan laddar
ska vara ett eget krav: listan över `href` i varje `<link` vars `rel` innehåller
`stylesheet`, efter att HTML-kommentarerna tagits bort, ska vara exakt
`['/tema.css', '/landning.css']`. Mutationstabellen för en textspärr ska ha minst
en rad per stavning som skiljer sig i skiftläge eller blanktecken från spärrens
egen, och mutationerna (1)–(6) ovan ska stå i tabellen och ge `EXIT=1`. Skriv
kravet i `ARKITEKTUR.md` först.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.

### 2026-10-14 — test: kommentarborttagningen före kaskadspärren äter en regel eller ett attribut som står mellan två kommentarmarkörer i strängar
**Vad gick fel:** Återfall av posten 2026-10-14 ("kaskadspärrens led 3 och (H9)
går förbi med en annan stavning av samma sak"). Rättningen fäller nu granskarens
sex mutationer och alla rader (K-1) till (K-39) i urvalet, men två nya stavningar
gav `fail 0` och `EXIT=0`. Båda kördes i en kopia under scratchpad med
`node --test tests/hero.test.js tests/server.test.js tests/demo.test.js tests/priser.test.js`.
(N1) De tre raderna `.fordel-x::after { content: "/*"; }`,
`.hero { padding-bottom: 0; }` och `.fordel-y::after { content: "*/"; }` lades
sist i `landning.css`. (N2) `<div class="hero-text">` i `landning.html` ändrades
till `<div class="hero-text" title="<!--" style="max-width: 46rem" data-x="-->">`.
`stripComments` i `tests/hero.test.js` (`/\/\*[\s\S]*?\*\//g`) och
HTML-borttagningen (`/<!--[\s\S]*?-->/g`) tar bort allt från markören i den första
strängen till markören i den sista. Därmed försvinner både den andra
`.hero`-regeln och `style`-attributet ur det led 1, led 2 och led 3 prövar. En
webbläsare läser `/*` inuti en CSS-sträng och `<!--` inuti ett attributvärde som
vanliga tecken, så båda stilarna gäller. (N1) skriver över `padding-bottom` i rad 5
i `HERO_RULES`, och (N2) skriver över `max-width` för texten. Ingen av dem nämns
under "Det spärren inte fångar" i `ARKITEKTUR.md`.
**Varför:** Led 1–3 i "Spärrens tre led" säger att "Alla tre läser den
kommentarfria texten", och kommentarborttagningen behandlades som ett neutralt
förarbete i stället för som en del av spärren. Ett reguljärt uttryck som tar bort
kommentarer utan att känna till strängar är självt en textspärr, och den prövades
inte med någon stavning alls. Rättningen räknade upp de stavningar lärdomen nämnde
(skiftläge, blanktecken, escape, `@scope`), men inte det steg som avgör vilken text
de stavningarna prövas mot.
**Regel framåt:** Varje steg som tar bort text innan en spärr läser den
(kommentarer, strängar, blanktecken) räknas som en del av spärren och ska ha egna
mutationer i tabellen. För kaskadspärren ska `stripComments` hoppa över strängar,
till exempel med `css.replace(/("[^"]*"|'[^']*')|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '')`,
vilket räcker eftersom `\` redan är förbjudet. Led 3 krav 1 och krav 5 ska prövas
mot den råa texten i `landning.html` och inte mot den kommentarfria, eller så ska
borttagningen avvisa en kommentar som börjar inuti ett attributvärde. Skriv
kravet i `ARKITEKTUR.md` först. (N1) och (N2) ovan ska stå i mutationstabellen och
ge `EXIT=1`.
**⚠️ ÅTERKOMMANDE (3+):** gör om detta till ett automatiskt test.
