# Hemochekonomi

En webbapp för hushållets ekonomi som du kör på din egen dator. Du loggar in med
en engångskod och för sedan in månadens inkomster, utgifter och sparande. Appen
visar vad som blir kvar att leva på, hur mycket som återstår av budgeten per
kategori, vilka räkningar som snart förfaller, hur dina sparmål går och, för
planerna Plus och Premium, en rapport över flera månader som går att ladda ned
som CSV.

Servern lyssnar bara på `127.0.0.1`, så appen går inte att nå från andra datorer
i nätverket.

---

## Innehåll

- [Vad du behöver](#vad-du-behöver)
- [Installera](#installera)
- [Starta](#starta)
- [Testa](#testa)
- [Logga in](#logga-in)
- [Planer och vad de låser upp](#planer-och-vad-de-låser-upp)
- [Månadsvyn](#månadsvyn)
- [Återkommande poster](#återkommande-poster)
- [Budget per kategori](#budget-per-kategori)
- [Räkningar och påminnelser](#räkningar-och-påminnelser)
- [Sparmål](#sparmål)
- [Rapport och CSV-export](#rapport-och-csv-export)
- [Översikt över tolv månader](#översikt-över-tolv-månader)
- [Så skriver du ett belopp](#så-skriver-du-ett-belopp)
- [Var dina uppgifter sparas](#var-dina-uppgifter-sparas)
- [Miljövariabler](#miljövariabler)
- [Bara en instans i taget](#bara-en-instans-i-taget)
- [Demoläget](#demoläget)
- [Bra att veta](#bra-att-veta)
- [Inte byggt](#inte-byggt)
- [Projektets filer](#projektets-filer)

---

## Vad du behöver

- **Node.js 24.** Kontrollera med `node --version`. Projektet är kört och
  verifierat på Node v24.19.0, och det är den enda version dokumentationen
  gäller för.
  `package.json` anger `>=22.5.0` som lägsta version, eftersom lagringen
  använder den inbyggda modulen `node:sqlite`, som inte finns i Node 20. I äldre
  versioner av Node 22 kan `node:sqlite` kräva en experimentflagga som
  `npm start` inte skickar med, så använd Node 24.
- En webbläsare.

Ingenting annat. Projektet har **noll beroenden**: inga paket hämtas från
internet, och SQLite följer med Node.

---

## Installera

```
npm install
```

Kommandot hämtar inga beroenden, eftersom projektet inte har några. Det skapar
bara `package-lock.json`. **Du kan hoppa över det** och gå direkt till
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

**Öppna adressen själv i webbläsaren.** Appen öppnar inget fönster åt dig.

- `http://127.0.0.1:3000/` är landningssidan med funktioner, priser och vanliga
  frågor. Knapparna **Logga in**, **Registrera** och **Kom igång** leder till
  appen.
- `http://127.0.0.1:3000/app` är själva appen.

**Låt terminalen vara öppen.** Inloggningskoden skrivs ut där (se
[Logga in](#logga-in)). Stäng appen med `Ctrl+C` i terminalen.

Vill du använda en annan port sätter du miljövariabeln `PORT` innan du startar.

PowerShell:

```
$env:PORT = "3100"; npm start
```

Bash:

```
PORT=3100 npm start
```

Är porten upptagen av ett annat program startar appen inte. Den skriver i
stället ett svenskt besked som börjar `Port <port> är upptagen.` och talar om att
du kan stänga det andra programmet eller sätta `PORT` till ett annat portnummer.

---

## Testa

```
npm test
```

Kommandot kör `node --test "tests/**/*.test.js"`. Hela sviten ska sluta med
raden `ℹ fail 0` och avsluta med exitkod 0. Antalet tester står inte här, eftersom
det växer med varje tillägg. Raden `ℹ tests` i din egen körning är det som gäller.

**Citattecknen runt glob-mönstret är nödvändiga.** Skriv inte
`node --test tests/`. På Node 24 tolkas `tests/` som ett glob-mönster som inte
matchar något, och kommandot avslutas med `Cannot find module`. Använd
`npm test`, så blir det rätt.

---

## Logga in

Det finns inga lösenord. Du loggar in med en sexsiffrig kod som skickas till din
e-postadress. Första gången du loggar in med en adress skapas kontot, så
registrering och inloggning är samma sak.

1. Gå till `http://127.0.0.1:3000/app`.
2. Skriv din e-postadress och klicka **Skicka kod**. Sidan svarar
   `En kod är skickad till <e-post>. Den gäller i tio minuter.`
3. **Hämta koden i terminalen där `npm start` körs.** Vid lokal körning skickas
   inget mejl. Servern skriver i stället en rad av den här formen:

   ```
   Inloggningskod till anna@exempel.se: 123456 (gäller i tio minuter)
   ```

4. Skriv koden i fältet **Kod** och klicka **Logga in**.

Koden mejlas på riktigt bara om miljövariabeln `RESEND_API_KEY` är satt (se
[Miljövariabler](#miljövariabler)). Utan den skrivs koden alltid i terminalen.

Regler för koden:

- Den gäller i tio minuter och kan bara användas en gång.
- Begär du en ny kod slutar den gamla att gälla.
- Efter fem felaktiga försök på samma kod måste du begära en ny.
- Högst fem koder per e-postadress och högst tjugo koder per anslutning inom en
  timme.

Vanliga svar när något är fel:

| Svar | Betyder |
|---|---|
| `Koden stämmer inte. Begär en ny kod och försök igen.` | Fel kod. Samma text visas om adressen inte har någon kod. |
| `Koden har gått ut. Begär en ny kod.` | Mer än tio minuter har gått. |
| `En nyare kod har skickats. Använd den senaste koden.` | Du använde en äldre kod. |
| `För många försök på den här koden. Begär en ny kod.` | Fem felaktiga försök. |

Knappen **Använd en annan adress** tar dig tillbaka till steget med
e-postadressen.

Du förblir inloggad i 30 dygn i samma webbläsare. **Logga ut** finns i
sidomenyn, bredvid adressen du är inloggad med.

---

## Planer och vad de låser upp

Varje konto har en plan. **Ett nytt konto får planen Bas.** Du byter plan under
**Min plan** i sidomenyn genom att klicka **Välj Bas**, **Välj Plus** eller
**Välj Premium**. Bytet gäller direkt.

**Ingen betalning sker.** Efter ett byte står texten
`Demo: ingen betalning genomförs.` Priserna på landningssidan (99, 149 och 179 kr
i månaden) visas bara, och knapparna **Välj ...** på landningssidan leder till
appen utan att välja någon plan.

| Funktion | Bas | Plus | Premium |
|---|---|---|---|
| Månadsvyn med inkomster, utgifter och sparande | ja | ja | ja |
| Budget per kategori | ja | ja | ja |
| Räkningar och påminnelser | ja | ja | ja |
| Översikt över tolv månader | ja | ja | ja |
| Sparmål | nej | ja | ja |
| Rapport och CSV-export | nej | ja | ja |

Plus och Premium har i dag samma funktioner i appen. Det Premium lägger till på
prissidan, *Mina funktioner* och *Prioriterad support*, är inte byggt. Det är
inte heller *Delat hushåll*, som står på Plus.

**Med Bas** syns en låsrad i stället för korten Sparmål och Rapport, till
exempel `Sparmål ingår i Plus.` med knappen **Se planer**, som öppnar
Min plan. Spärren sitter på servern: varje anrop till sparmålens och rapportens
vägar avvisas för Bas.

**En nedgradering raderar ingenting.** Sparmål du skapat på Plus blir dolda när
du går ned till Bas och syns igen när du går upp.

---

## Månadsvyn

Överst finns månadsväljaren med **Föregående** och **Nästa**. Vyn öppnar den
aktuella månaden.

Direkt under väljaren står summeringen:

| Rad | Innehåll |
|---|---|
| **Inkomster** | månadens inkomster |
| **Utgifter** | månadens utgifter |
| **Sparande** | månadens sparande |
| **Kvar att leva på** | inkomster minus utgifter minus sparande. Kan vara negativt och visas då i varningsfärg. |

Därefter kommer tre listor, **Inkomster**, **Utgifter** och **Sparande**, med var
sin knapp: **+ Ny inkomst**, **+ Ny utgift** och **+ Nytt sparande**. Knappen
öppnar formuläret:

| Fält | Vad du skriver |
|---|---|
| **Namn** | Fritext, 1 till 60 tecken. |
| **Belopp (kr)** | Till exempel `12000` eller `139,50`. Se [Så skriver du ett belopp](#så-skriver-du-ett-belopp). |
| **Kategori** | `Boende`, `Prenumeration`, `Försäkring`, `Transport`, `Lån` eller `Övrigt`. |
| **Datum** | Valfritt. Dagen det hände, som `ÅÅÅÅ-MM-DD`. |
| **Kommentar** | Valfritt. Högst 200 tecken. |
| **Återkommande** | Kryssruta. Se [Återkommande poster](#återkommande-poster). |

Klicka **Spara**, eller **Avbryt** för att stänga formuläret utan att spara.
Slaget (inkomst, utgift eller sparande) bestäms av vilken lista du klickade i,
och är inget fält.

Varje post har knapparna **Ändra** och **Ta bort**. **Ta bort** på en
engångspost tar bort den direkt, utan bekräftelsefråga. Vid ändring heter
knappen **Spara ändring**.

En tom lista visar en egen text med månadens namn, till exempel
`Inga utgifter i oktober ännu - lägg till din första.`

Längre ned i vyn finns ett stapeldiagram över månadens utgifter per kategori.
Utan utgifter står `Inga utgifter att visa i diagrammet ännu.`

Är något fel i formuläret visas ett svenskt felmeddelande vid fältet, och ingen
post skapas.

---

## Återkommande poster

Kryssar du i **Återkommande** i formuläret visas två fält till:

- **Intervall:** `Månadsvis`, `Kvartalsvis`, `Halvårsvis` eller `Årsvis`.
- **Till och med:** valfri sista månad som `ÅÅÅÅ-MM`. Tomt betyder tills vidare.

Fälten **Datum** och **Kommentar** döljs, eftersom en återkommande post inte har
någon enskild dag eller kommentar.

Posten gäller från och med den månad du skapar den. En kvartalspost syns var
tredje månad räknat därifrån, en halvårspost var sjätte och en årspost var
tolfte. En återkommande post är märkt med en pil i listan.

**Ändra** och **Ta bort** på en återkommande post frågar först
`Vad ska ändras?` respektive `Vad ska tas bort?` och ger två val:

| Val | Ändra | Ta bort |
|---|---|---|
| **Bara <månad>** | Ändrar bara beloppet för den månaden. | Hoppar över posten den månaden. |
| **Från och med <månad>** | Ändrar posten från den månaden och framåt. | Avslutar posten från den månaden och framåt. |

**Tidigare månader ändras aldrig.** Bläddrar du bakåt ser du det som gällde då.

---

## Budget per kategori

Kortet **Budget** visar en rad per kategori som har ett tak den här månaden:
kategorin, taket och ordet `kvar` följt av det som återstår. Har du gått över
taket blir det kvarvarande beloppet negativt och visas i varningsfärg.

Bara **utgifter** räknas mot taket, inte inkomster eller sparande.

Klicka **+ Sätt tak**, välj **Kategori**, skriv **Tak (kr)** och klicka
**Spara**. Sätter du ett nytt tak för en kategori som redan har ett ersätts det
gamla.

**Ett tak gäller en enda månad.** Vill du ha samma tak varje månad måste du
sätta det i varje månad.

---

## Räkningar och påminnelser

Kortet **Räkningar** visar en rad per obetald räkning, sorterade efter
förfallodag. Klicka **+ Ny räkning** och fyll i:

| Fält | Vad du skriver |
|---|---|
| **Namn** | Fritext. |
| **Belopp (kr)** | Samma regler som för en post. |
| **Förfallodag** | Datum. |
| **Intervall** | `Engångs`, `Månadsvis`, `Kvartalsvis`, `Halvårsvis` eller `Årsvis`. |
| **Påminn mig ... dagar innan** | 0 till 30. Förvalt är 3. |

Raden visar en text om när räkningen förfaller:

- `Förföll för <N> dagar sedan`
- `Förföll igår`
- `Förfaller idag`
- `Förfaller imorgon`
- `Förfaller om <N> dagar`

Räkningar som har förfallit och räkningar inom påminnelsetiden markeras med
färg.

Varje rad har knappen **Betald**:

- En **återkommande** räkning flyttas till nästa förfallodag och står kvar i
  listan. Förfallodagen behåller sin ursprungliga dag i månaden, så en räkning
  den 31:a flyttas till månadens sista dag i korta månader men tillbaka till den
  31:a när månaden är lång nog.
- En **engångsräkning** försvinner ur listan.

Appen sparar ingen historik över betalda räkningar.

---

## Sparmål

*Kräver Plus eller Premium.*

Klicka **+ Nytt sparmål** och fyll i **Namn**, **Målbelopp (kr)** och
**Slutdatum (valfritt)**. Varje mål visar hur mycket som är sparat av målet, en
stapel med procent och hur mycket som återstår. Har målet ett slutdatum står
också hur mycket du behöver spara i månaden för att nå det.

Knappen **+ Sätt in** på ett mål öppnar ett formulär med belopp och datum. **Ett
negativt belopp är ett uttag.** Noll avvisas med
`Beloppet får inte vara 0 kr. Skriv ett minustecken framför för ett uttag.`

Ett nått mål visar `Målet är nått`. Ett mål vars slutdatum har passerat utan att
det nåtts visar `Slutdatumet har passerat`.

---

## Rapport och CSV-export

*Kräver Plus eller Premium.*

Kortet **Rapport** i månadsvyn visar vart pengarna gick över flera månader.

**Perioden** väljs med knapparna **3 mån**, **6 mån** och **12 mån**. När sidan
laddas visas **12 månader**. Perioden slutar med den månad som visas i
månadsväljaren, så byter du månad följer rapporten med.

Överst i kortet finns ett stapeldiagram över utgifterna per kategori för hela
perioden. Under det finns en tabell med en rad per slag och kategori:

| Kolumn | Innehåll |
|---|---|
| **Slag** | `Inkomst`, `Utgift` eller `Sparande`. |
| **Kategori** | Kategorins namn. |
| **Snitt per månad** | Summan delad med antalet månader i perioden. Månader utan belopp räknas med som noll. |
| **Summa** | Summan över hela perioden. |
| **Tak** | Taket i periodens **sista** månad. Tom om den månaden saknar tak. |
| **Över taket** | `<n> av <m>`: i *n* av de *m* månader som hade ett tak låg utgiften över taket. Lika med taket räknas inte som över. Tom om ingen månad i perioden hade ett tak. |

Tak finns bara för utgifter, så **Tak** och **Över taket** är alltid tomma för
inkomster och sparande. En kategori kommer med i tabellen om den har ett belopp
i någon månad eller ett tak i någon månad. Finns ingenting att visa står
`Inget att visa för perioden.`

**Hämta som CSV** laddar ned en fil för **samma period som visas**. Filen heter
`hemochekonomi-<ÅÅÅÅ-MM>.csv`, där `<ÅÅÅÅ-MM>` är periodens sista månad.

Filen är gjord för Excel och andra kalkylprogram:

- Semikolon mellan kolumnerna och UTF-8 med BOM, så att svenska tecken blir rätt
  i Excel på Windows.
- Rubrikraden är `Slag;Kategori;Månad;Belopp;Tak;Över tak`.
- **En rad per slag, kategori och månad**, inte en rad per kategori som på
  skärmen. Månaden skrivs som `ÅÅÅÅ-MM`.
- Belopp skrivs som tal utan `kr` och utan tusentalsavgränsare, till exempel
  `1234,50`.
- **Tak** är tomt för en månad utan tak. **Över tak** är `Ja`, `Nej` eller tomt
  när månaden saknar tak.
- Snitt och summa står inte i filen. Räkna fram dem i kalkylbladet.
- En text som börjar med `=`, `+`, `-`, `@`, ett tabbtecken eller en
  vagnretur (CR) får en apostrof framför sig, så att Excel inte tolkar ett
  postnamn som en formel. Belopp får ingen apostrof.

---

## Översikt över tolv månader

Knappen **Översikt** i sidomenyn visar de tolv månader som slutar med den månad
du står på. Överst står **Sparat hittills i år**, **Snitt kvar per månad** och
**Bästa månaden**. Under dem finns ett stapeldiagram över *kvar att leva på* per
månad, där en månad som gick back ritas nedåt, och en tabell med inkomst, utgift,
sparande och kvar för varje månad. **Tillbaka till månaden** tar dig tillbaka.

---

## Så skriver du ett belopp

Det här är den vanligaste fällan i appen.

**Fungerar:**

- `12000`
- `139,50`, med komma som decimaltecken
- `139.50`, punkt fungerar också

**Fungerar inte:**

- `12 000`: mellanslag som tusentalsavgränsare **avvisas**
- `12000,555`: högst två decimaler
- `0` och negativa tal: beloppet måste vara större än 0 kr (utom vid en
  insättning i ett sparmål, se [Sparmål](#sparmål))
- Belopp över 9999999,99 kr

**Appen talar om hur du ska skriva.** Skriver du något som ser ut som ett belopp
men inte går att räkna på, till exempel `12 000`, `50 kr` eller `1 234,50 kr`,
svarar fältet:

`Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.`

Den kortare texten `Beloppet måste vara ett tal.` får du när inmatningen inte
alls ser ut som ett belopp, till exempel `abc`.

**Följden:** ett belopp som du kopierar från appen går inte att klistra in igen.
Appen visar belopp med ett hårt blanksteg (U+00A0) som tusentalsavgränsare och
`kr` efter talet, och den strängen avvisas som inmatning. Skriv `12000`.

---

## Var dina uppgifter sparas

Konton, poster, tak, räkningar och sparmål ligger i en SQLite-databas:

```
%APPDATA%\hemochekonomi\hemochekonomi.sqlite
```

Filen och katalogen skapas automatiskt första gången appen behöver dem. Vill du
lägga databasen någon annanstans, till exempel för att prova med ett tomt konto,
sätter du `HEMOCHEKONOMI_DB_FILE` till en full sökväg innan du startar.

PowerShell:

```
$env:HEMOCHEKONOMI_DB_FILE = "C:\temp\prov.sqlite"; npm start
```

Bash:

```
HEMOCHEKONOMI_DB_FILE=/tmp/prov.sqlite npm start
```

Med standardsökvägarna ligger låsfilen `entries.json.lock` i samma katalog
(se [Bara en instans i taget](#bara-en-instans-i-taget)). Låsfilen följer
`HEMOCHEKONOMI_DATA_FILE` och inte `HEMOCHEKONOMI_DB_FILE`. Flyttar du bara
databasen ligger låsfilen kvar i `%APPDATA%\hemochekonomi\`. Sätter du
`HEMOCHEKONOMI_DATA_FILE` hamnar den bredvid den filen, med `.lock` efter
namnet. Hade du en `entries.json`
från appens första version visas den inte i den nuvarande appen. Den flyttas
inte över automatiskt.

---

## Miljövariabler

Ingen av dem behöver sättas för att köra appen lokalt.

| Variabel | Vad den gör |
|---|---|
| `PORT` | Porten servern lyssnar på. Förval `3000`. |
| `HEMOCHEKONOMI_DB_FILE` | Sökväg till databasfilen. |
| `HEMOCHEKONOMI_DATA_FILE` | Sökväg till den gamla datafilen. Avgör var låsfilen hamnar: låsfilen är datafilens sökväg med `.lock` efter. |
| `RESEND_API_KEY` | Satt: koden mejlas via Resend i stället för att skrivas i terminalen. |
| `RESEND_FROM` | Avsändaradress för mejlet. Krävs när `RESEND_API_KEY` är satt, annars misslyckas utskicket med `Det gick inte att skicka koden. Försök igen.` |
| `NODE_ENV` | `production` sätter `Secure` på inloggningscookien. **Sätt den inte lokalt**: över `http://127.0.0.1` skickar webbläsaren då aldrig tillbaka cookien, och du kan inte logga in. |
| `TRUST_PROXY` | `1` bara när appen kör bakom en proxy som sätter `X-Forwarded-For`. Ska inte vara satt lokalt. |

Appen läser ingen `.env`-fil. Sätt variablerna i terminalen innan `npm start`.

---

## Bara en instans i taget

Startar du `npm start` en gång till medan den första kör, vägrar den andra starta
och skriver ett svenskt besked som börjar
`Hemochekonomi kör redan i en annan process (pid <pid>) mot samma datafil:`
följt av sökvägen.

Vill du verkligen köra två samtidigt måste **både** porten och datafilen vara
olika, eftersom låset sitter på datafilen och inte på porten. Sätt också en egen
databasfil, annars använder båda instanserna samma konton och poster:

```
$env:PORT = "3100"; $env:HEMOCHEKONOMI_DATA_FILE = "C:\temp\andra.json"; $env:HEMOCHEKONOMI_DB_FILE = "C:\temp\andra.sqlite"; npm start
```

### Låsfilen som ligger kvar

**Låsfilen `entries.json.lock` ligger kvar efter `Ctrl+C` och efter en krasch.
Det är normalt.** Nästa start läser filen, ser att processen som skrev den är
borta och tar över låset. Du behöver inte göra något.

I ett ovanligt fall räcker det inte: om operativsystemet har återanvänt
process-id:t i låsfilen till ett annat program tror appen att den redan kör och
vägrar starta med beskedet ovan. **Botemedel:** kontrollera att ingen terminal
med Hemochekonomi är igång och ta sedan bort `entries.json.lock` för hand. Den
ligger som förval i `%APPDATA%\hemochekonomi\`.

---

## Demoläget

Appen har ett demoläge där webbläsaren visar påhittad data utan att anropa
appens API eller databas. **Det är avstängt.** Det styrs av raden

```js
export const DEMO = false;
```

i `src/web/demo/demolage.js`. Med `false` gör demofilerna ingenting och appen
beter sig som beskrivet ovan. Med `true` visas en banner överst med texten
`Demoversion - ingen riktig data eller betalning.`, inloggningsvyn får knappen
**Logga in som demoanvändare**, och ändringar sparas i webbläsarens
`localStorage`. Knappen **Återställ demo** i bannern tar tillbaka
utgångsdatan.

---

## Bra att veta

**Öppna inte appen i två flikar samtidigt.** Flikarna uppdaterar inte varandra.
Har du ändrat något i en annan flik: ladda om sidan.

**Räkningar, sparmål och tak går inte att ta bort från sidan.** Gränssnittet har
ingen knapp för att ändra eller ta bort en räkning eller ett sparmål, eller för
att ta bort ett tak. Det du kan göra är att markera en räkning som betald, göra
en insättning eller ett uttag på ett sparmål och ersätta ett tak med ett nytt.

**Räkningar och sparmål räknas mot dagens datum** när sidan laddas. Står sidan
öppen över midnatt: ladda om den.

**En felstavad adress ger en blank sida.** En felstavad sidadress, till exempel
`/apps`, svarar `404` utan innehåll, så webbläsaren visar en tom sida.
Kontrollera adressen. En okänd väg under `/api/` svarar i stället `404` med
`{"error":"Okänd adress."}`.

**Når sidan inte servern** står `Det gick inte att nå appens server. Försök igen.`
Kontrollera att terminalen med `npm start` fortfarande kör.

**Beloppen räknas i hela ören.** Inga kronor hanteras som flyttal.

---

## Inte byggt

- **Betalning.** Planbytet är gratis och sker direkt.
- **Delat hushåll, Mina funktioner och Prioriterad support.** De står på
  prissidan men finns inte i appen.
- **Påminnelser utanför appen.** Inga notiser och inga mejl utom
  inloggningskoden. Påminnelsen är markeringen i kortet Räkningar.
- **Historik över betalda räkningar.** En återkommande räkning flyttas fram när
  den betalas, och den betalda förfallodagen sparas inte.
- **Flytt av poster från appens första version** (`entries.json`).
- **Andra valutor än SEK.**

---

## Projektets filer

```
src/core/      Beräkningar och regler. Körs både i Node och i webbläsaren.
src/server/    HTTP-server, API, inloggning, databas och låset.
src/web/       Det webbläsaren får: landningssidan, appen och demoläget.
tests/         Testsviten som npm test kör.
```

Fotot i landningssidans hero är taget av N. Voitkevich och hämtat från Pexels
(pexels-n-voitkevich-7173046). Filen ligger i `src/web/bilder/hero-ekonomi.jpg`.

| Fil | Innehåll |
|---|---|
| `ARKITEKTUR.md` | Bindande beslut: datamodell, felmeddelanden, avrundnings- och datumregler. |
| `PLAN.md` | Arbetspaketen för appens första version. |
| `LARDOMAR.md` | Projektets minne: varje fel som gjorts och regeln som ska hindra att det görs om. |
| `CLAUDE.md` | Projektreglerna för den som bygger vidare. |
