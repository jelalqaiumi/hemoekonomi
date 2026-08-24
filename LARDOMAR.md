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
