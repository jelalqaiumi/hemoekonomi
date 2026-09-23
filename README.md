# Hemochekonomi

En lokal app som håller koll på hemmets fasta utgifter och prenumerationer. Du
lägger in dina återkommande utgifter — hyra, försäkring, strömavtal,
strömningstjänster — och appen visar vad de kostar per månad, vad de kostar per
år och vad som dras härnäst.

Allt körs på din egen dator. Ingen inloggning, inget konto, ingen nätverkstrafik
utanför maskinen: servern lyssnar bara på `127.0.0.1`.

---

## Innehåll

- [Vad du behöver](#vad-du-behöver)
- [Installera](#installera)
- [Starta](#starta)
- [Testa](#testa)
- [De fyra flödena](#de-fyra-flödena)
- [Så skriver du ett belopp](#så-skriver-du-ett-belopp)
- [Startdatum och nästa dragning](#startdatum-och-nästa-dragning)
- [Var dina poster sparas](#var-dina-poster-sparas)
- [Bara en instans i taget](#bara-en-instans-i-taget)
- [Låsfilen som ligger kvar](#låsfilen-som-ligger-kvar)
- [Bra att veta](#bra-att-veta)
- [Medvetet utelämnat](#medvetet-utelämnat)
- [Projektets filer](#projektets-filer)

---

## Vad du behöver

- **Node.js 20.17.0 eller senare.** Kontrollera med `node --version`.
  Dokumentationen nedan är körd och verifierad på Node v24.19.0.
- En webbläsare.

Ingenting annat. Projektet har **noll beroenden** — inga paket hämtas från
internet.

---

## Installera

```
npm install
```

Kommandot hämtar inga beroenden, eftersom projektet inte har några. Det skapar
bara `package-lock.json`. **Du kan hoppa över det helt** och gå direkt till
`npm start`.

---

## Starta

```
npm start
```

Servern skriver en rad i terminalen:

```
Hemochekonomi kör på http://127.0.0.1:3000
```

**Öppna adressen själv i webbläsaren** — appen öppnar inget fönster åt dig.

Stäng appen med `Ctrl+C` i terminalen.

Vill du använda en annan port sätter du miljövariabeln `PORT` innan du startar.

PowerShell:

```
$env:PORT = "3100"; npm start
```

Bash:

```
PORT=3100 npm start
```

Är porten upptagen av ett annat program startar appen inte, utan skriver ett
svenskt besked om att porten är upptagen och att du kan sätta `PORT` till ett
annat portnummer.

---

## Testa

```
npm test
```

Kommandot kör `node --test "tests/**/*.test.js"`. Hela sviten ska sluta med
`fail 0` och avsluta med exitkod 0. Antalet tester står inte här — det växer med
varje tillägg, och siffran i sammanfattningsraden `ℹ tests` är det enda facit som
gäller.

**Citattecknen runt glob-mönstret är nödvändiga.** Skriv inte `node --test
tests/` — på Node 24 tolkas `tests/` som en modulsökväg och kommandot avslutas
med `MODULE_NOT_FOUND`. Använd `npm test`, så blir det rätt.

---

## De fyra flödena

Hela appen är en enda sida på `http://127.0.0.1:3000/`. Den har fyra kort:
**Lägg till en utgift**, **Dina poster**, **Summa** och **Kommande dragningar**.

### 1. Lägg till en post

Fyll i formuläret högst upp och klicka **Spara**:

| Fält | Vad du skriver |
|---|---|
| **Namn** | Fritext, 1–60 tecken. Till exempel `Hyra`. |
| **Belopp per betalning (kr)** | Beloppet **per dragning**, inte per månad. `12000` eller `139,50`. Se [Så skriver du ett belopp](#så-skriver-du-ett-belopp). |
| **Betalningsintervall** | Rullgardin med `Månadsvis`, `Kvartalsvis` och `Årsvis`. |
| **Startdatum** | Den första dragningen, på formen `ÅÅÅÅ-MM-DD`. |
| **Kategori** | Rullgardin med `Boende`, `Prenumeration`, `Försäkring`, `Transport`, `Lån` och `Övrigt`. |

Posten dyker upp direkt i **Dina poster**, och alla tre korten räknas om.

Är något fel i formuläret skrivs ett felmeddelande på svenska **under det fält
det gäller**, och ingen post skapas. Exempel: `Namnet får inte vara tomt.`,
`Beloppet måste vara ett tal.`, `Startdatum är inget giltigt datum.`

Innan du har lagt in något visar listan texten
`Du har inga poster ännu. Lägg till din första utgift ovan.`

### 2. Se månadskostnad och årskostnad

Varje rad i **Dina poster** visar namn, kategori, beloppet per betalning,
intervallet och två omräkningar: `Per månad: …` och `Per år: …`

Kortet **Summa** visar `Totalt per månad` och `Totalt per år` för alla poster
tillsammans. Med en tom lista står `0,00 kr` på båda raderna — rutan försvinner
aldrig.

> **Månadskolumnen summerar inte alltid till månadstotalen.** I en körning med
> flera kvartals- och årsposter visade raderna tillsammans `845 900,94` medan
> rutan visade `845 900,95` — en öres skillnad. **Rutan är den riktiga
> summan.** Skälet: totalen avrundas *en gång* ur den exakta årssumman, medan
> varje rad avrundas för sig och de avrundningsfelen adderas. Appen förklarar
> inte det själv.

### 3. Se vad som dras härnäst

Kortet **Kommande dragningar** listar varje post med sitt nästa dragningsdatum
och hur lång tid det är dit — `Idag`, `Om 1 dag` eller `Om N dagar`. Listan är
sorterad så att det som ligger närmast i tiden står överst.

Datumet räknas fram ur startdatum och intervall; det är inget du matar in. Se
[Startdatum och nästa dragning](#startdatum-och-nästa-dragning).

Utan poster står `Inga kommande dragningar ännu.`

### 4. Ta bort en post

Varje rad i **Dina poster** har en **Ta bort**-knapp. Ett klick tar bort posten
direkt — ingen bekräftelsefråga — och listan, totalerna och kommande dragningar
räknas om.

Borttagningen sparas till disk med detsamma och gäller även efter en omstart.

---

## Så skriver du ett belopp

Det här är den vanligaste fällan i appen, så läs igenom den.

**Fungerar:**

- `12000`
- `139,50` — komma som decimaltecken
- `139.50` — punkt fungerar också

**Fungerar inte:**

- `12 000` — mellanslag som tusentalsavgränsare **avvisas**
- `12000,555` — högst två decimaler
- `0` och negativa tal — beloppet måste vara större än 0
- Belopp över `9 999 999,99 kr`

**Appen talar om hur du ska skriva.** Skriver du något som ser ut som ett belopp
men inte går att räkna på — `12 000`, `50 kr` eller `1 234,50 kr` — svarar
fältet:

`Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.`

Den kortare texten `Beloppet måste vara ett tal.` får du för inmatning som inte
alls ser ut som ett belopp, till exempel `abc` eller ett tomt fält.

**Följd av detta:** appens egen utdata går *inte* att klistra tillbaka in i
fältet. Appen visar `12 000,00 kr` med ett hårt blanksteg (U+00A0) som
tusentalsavgränsare, och den strängen avvisas som inmatning — men den avvisas
med den vägledande texten ovan, som talar om vad du ska skriva i stället. Skriv
`12000`.

---

## Startdatum och nästa dragning

**Startdatum är inte "nästa dragning".** Du anger när utgiften började (eller
börjar), och appen räknar själv fram nästa dragningsdatum genom att lägga på
hela intervall från startdatumet tills datumet ligger idag eller senare. Ett
startdatum flera år tillbaka fungerar därför lika bra som ett i framtiden.

Datum skrivs alltid som `ÅÅÅÅ-MM-DD`. Ett datum som inte finns i kalendern —
till exempel `2026-02-31` — avvisas med `Startdatum är inget giltigt datum.`

**Den 29:e, 30:e och 31:a:** i månader som är för korta flyttas dragningen till
månadens sista dag, och den korta månaden smittar inte vidare. En månadspost med
startdatum `2026-01-31` får alltså `2026-09-30` i september och `2026-10-31` i
oktober — inte den 30:e för all framtid.

---

## Var dina poster sparas

Som förval i:

```
%APPDATA%\hemochekonomi\entries.json
```

Vill du lägga filen någon annanstans — till exempel för att testa med en annan
uppsättning poster — sätter du miljövariabeln `HEMOCHEKONOMI_DATA_FILE` till en
full sökväg innan du startar.

PowerShell:

```
$env:HEMOCHEKONOMI_DATA_FILE = "C:\temp\mina-poster.json"; npm start
```

Bash:

```
HEMOCHEKONOMI_DATA_FILE=/tmp/mina-poster.json npm start
```

Filen skapas automatiskt vid första sparningen. Finns den inte, eller är den
tom, tolkas det som "inga poster" — inte som ett fel.

> **Redigera inte `entries.json` för hand medan appen kör.** Går innehållet inte
> att läsa visar appen en svensk feltext med filens sökväg, sätter båda
> totalerna till ett streck i stället för ett belopp, och **vägrar spara**. Det
> är avsiktligt: så länge appen inte förstår filen skriver den inte över den, och
> du kan rätta eller flytta undan filen utan att förlora något.

---

## Bara en instans i taget

En datafil får användas av **en** körande app i taget. Startar du `npm start` en
gång till medan den första kör, vägrar den andra starta och skriver ett svenskt
besked i terminalen i stället. Det är avsiktligt — två instanser mot samma fil
skriver över varandras poster.

Vill du verkligen köra två samtidigt måste **både** porten och datafilen vara
olika:

```
$env:PORT = "3100"; $env:HEMOCHEKONOMI_DATA_FILE = "C:\temp\andra.json"; npm start
```

Räcker det med en annan port får du ändå beskedet att appen redan kör — det är
datafilen som är låst, inte porten.

---

## Låsfilen som ligger kvar

Bredvid datafilen skapar appen en låsfil, `entries.json.lock`. **Den ligger kvar
efter `Ctrl+C` och efter en krasch — det är normalt.** Nästa start läser filen,
ser att processen som skrev den är borta och tar över låset. Du behöver inte
göra något.

I ett ovanligt fall räcker inte det: om operativsystemet har återanvänt det
process-id som står i låsfilen till ett helt annat program, tror appen att den
redan kör och vägrar starta med ett meddelande som börjar

```
Hemochekonomi kör redan i en annan process (pid N)…
```

**Botemedel:** kontrollera att ingen Hemochekonomi-terminal är igång och ta
sedan bort `entries.json.lock` för hand. Appens eget meddelande talar inte om
det, så det står här.

---

## Bra att veta

**Öppna inte appen i två flikar samtidigt.** Flikarna uppdaterar inte varandra
av sig själva. Lägger du till eller tar bort en post i den ena flikens vy vet den
andra ingenting om det, och dess lista, totaler och kommande dragningar blir
inaktuella. Har du ändrat något i en annan flik: ladda om sidan.

**Tar du bort en post som redan är borta rättar appen vyn själv.** Klickar du
**Ta bort** på en post som inte längre finns i datafilen — till exempel för att
den redan raderats i en annan flik — säger felrutan `Posten finns inte.`, och
appen hämtar samtidigt om listan, totalerna och kortet Kommande dragningar. Du
ser alltså det verkliga läget direkt, utan att ladda om sidan. Meddelandet står
kvar tills du gör något annat i formuläret.

**En felstavad adress ger en blank sida.** Appen har en enda ingång:
`http://127.0.0.1:3000/`. Andra sökvägar svarar `404` utan innehåll, så
webbläsaren visar en tom vit sida. Det betyder inte att appen är trasig —
kontrollera adressen.

**Beloppen räknas i hela ören.** Inga kronor hanteras som flyttal, så
kvartals- och årsposter räknas om till månad utan att ören försvinner på vägen.
Det är också därför kolumnen och totalen kan skilja sig med en öre; se
[flöde 2](#2-se-månadskostnad-och-årskostnad).

---

## Medvetet utelämnat

Fyra saker är **bortvalda, inte glömda**. De finns inte ens som tomma fält i
datamodellen — postens typkontroll avvisar aktivt en post som bär dem, så
ingenting ligger halvfärdigt och väntar:

1. **Inkomster och saldo.** Appen visar vad saker kostar, inte vad som blir över.
2. **Notiser och påminnelser.** Kortet med kommande dragningar är hela
   påminnelsen. Ingen bakgrundskörning, inga aviseringar, inga mejl.
3. **Delning mellan flera personer och enheter.** En person, en enhet, en
   datafil. Ingen inloggning, inga konton, ingen synk.
4. **Historik över faktiskt genomförda dragningar.** Appen vet inte vad som
   verkligen har dragits. Nästa dragningsdatum räknas fram ur startdatum och
   intervall varje gång och lagras aldrig.

Därtill: **SEK är enda valutan.** Ingen valutaomräkning, ingen valutaväljare.

---

## Projektets filer

```
src/core/      Beräkningar och regler. Körs både i Node och i webbläsaren.
src/server/    HTTP-server, API, lagring på disk och låset på datafilen.
src/web/       Sidan användaren ser: index.html, app.js, style.css.
tests/         Testsviten som npm test kör.
```

| Fil | Innehåll |
|---|---|
| `ARKITEKTUR.md` | Bindande beslut: datamodell, felmeddelanden, avrundnings- och datumregler. |
| `PLAN.md` | Arbetspaketen och avgränsningarna. |
| `LARDOMAR.md` | Projektets minne: varje fel som gjorts och regeln som ska hindra att det görs om. |
| `CLAUDE.md` | Projektreglerna för den som bygger vidare. |
