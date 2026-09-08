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
