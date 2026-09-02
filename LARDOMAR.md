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
