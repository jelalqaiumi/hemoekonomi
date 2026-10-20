# Hem och Ekonomi

En gratis webbapp för hushållets ekonomi. Du skapar ett konto med e-postadress
och lösenord och för sedan in månadens inkomster, utgifter och sparande. Appen
visar vad som blir kvar att leva på, hur mycket som återstår av budgeten per
kategori, vilka räkningar som snart förfaller, hur dina sparmål går och en
rapport över flera månader som går att ladda ned som CSV.

Allt är gratis och alla funktioner ingår. Det finns inga planer och ingen
betalning. Dina uppgifter sparas på ditt konto i en databas, så ingenting
försvinner när du loggar ut eller när servern startas om.

Du kan köra appen på din egen dator eller lägga ut den på nätet så att andra kan
använda den, se [Lägga ut appen på nätet](#lägga-ut-appen-på-nätet).

---

## Innehåll

- [Vad du behöver](#vad-du-behöver)
- [Installera](#installera)
- [Starta](#starta)
- [Testa](#testa)
- [Skapa konto och logga in](#skapa-konto-och-logga-in)
- [Mitt konto](#mitt-konto)
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
- [Lägga ut appen på nätet](#lägga-ut-appen-på-nätet)
- [Bra att veta](#bra-att-veta)
- [Inte byggt](#inte-byggt)
- [Projektets filer](#projektets-filer)

---

## Vad du behöver

- **Node.js 22 eller senare.** Kontrollera med `node --version`.
- En webbläsare.

Du behöver **ingen databasserver** för att köra appen på din egen dator. Utan
`DATABASE_URL` använder appen PGlite, en PostgreSQL som körs inuti Node och
sparar i en katalog på disken. På nätet används en riktig PostgreSQL hos Neon.

---

## Installera

```
npm install
```

Kommandot hämtar projektets två beroenden: `pg` (anslutningen till PostgreSQL)
och `@electric-sql/pglite` (den lokala databasen). Kör det en gång, och igen när
`package.json` har ändrats.

---

## Starta

```
npm start
```

Servern skriver en rad i terminalen:

```
Hem och Ekonomi kör på http://127.0.0.1:3000
```

**Öppna adressen själv i webbläsaren.** Appen öppnar inget fönster åt dig.

- `http://127.0.0.1:3000/` är landningssidan med funktioner och vanliga frågor.
  Knapparna **Logga in**, **Registrera**, **Skapa konto** och **Kom igång**
  leder till appen.
- `http://127.0.0.1:3000/app` är själva appen.

**Låt terminalen vara öppen.** Lokalt skickas inga mejl, så länken för nytt
lösenord skrivs ut där (se [Glömt lösenord](#glömt-lösenord)). Stäng appen med
`Ctrl+C` i terminalen.

Vill du använda en annan port sätter du miljövariabeln `PORT` innan du startar.

PowerShell:

```
$env:PORT = "3100"; npm start
```

Bash:

```
PORT=3100 npm start
```

Är porten upptagen startar appen inte. Den skriver i stället ett svenskt besked
som börjar `Port <port> är upptagen.` och talar om att du kan stänga det andra
programmet eller sätta `PORT` till ett annat portnummer.

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

## Skapa konto och logga in

1. Gå till `http://127.0.0.1:3000/app` och klicka **Skapa konto**.
2. Skriv din e-postadress och ett lösenord på **minst 10 tecken**. En mening med
   flera ord är lätt att minnas och svår att gissa.
3. Klicka **Skapa konto**. Du är inloggad direkt.

Nästa gång klickar du **Logga in** och skriver samma adress och lösenord.

- Du förblir inloggad i 30 dygn i samma webbläsare. **Logga ut** finns i
  sidomenyn.
- Är adressen eller lösenordet fel står `Fel e-postadress eller lösenord.`
- Efter tio felaktiga försök med samma adress inom en kvart får du vänta en
  stund innan du kan försöka igen.

### Glömt lösenord

Klicka **Glömt lösenordet?**, skriv din adress och klicka **Skicka länk**. Sidan
svarar alltid
`Om adressen har ett konto har vi skickat en länk dit. Den gäller i en timme. Titta också i skräpposten.`

Länken öppnar **Välj ett nytt lösenord**. När du har sparat det nya lösenordet
loggas du ut överallt annars och in i den webbläsare du står i.

**Lokalt skickas inget mejl.** Länken skrivs i terminalen där `npm start` körs:

```
Länk för nytt lösenord till anna@exempel.se: http://127.0.0.1:3000/app?aterstall=…
```

På nätet mejlas länken via Resend, se [Miljövariabler](#miljövariabler).

---

## Mitt konto

Knappen **Mitt konto** i sidomenyn visar vilken adress du är inloggad med och
två saker du alltid kan göra med dina uppgifter:

- **Ladda ner mina uppgifter** ger en JSON-fil med allt du har sparat: poster,
  tak, räkningar och sparmål.
- **Ta bort kontot** tar bort kontot och allt som hör till det för gott. Du
  bekräftar med ditt lösenord. Det går inte att ångra.

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

**På din egen dator** ligger konton, poster, tak, räkningar och sparmål i en
lokal databaskatalog:

```
%APPDATA%\hemochekonomi\databas
```

Katalogen skapas automatiskt första gången appen startar. Vill du lägga
databasen någon annanstans, till exempel för att prova med ett tomt konto,
sätter du `HEMOCHEKONOMI_DB_FILE` till en katalogsökväg innan du startar.

PowerShell:

```
$env:HEMOCHEKONOMI_DB_FILE = "C:\temp\prov"; npm start
```

Bash:

```
HEMOCHEKONOMI_DB_FILE=/tmp/prov npm start
```

**På nätet** ligger allt i PostgreSQL-databasen som `DATABASE_URL` pekar på.
Varje rad hör till ett konto, och den som är inloggad ser bara sina egna
uppgifter.

En gammal `hemochekonomi.sqlite` eller `entries.json` från tidigare versioner
av appen läses inte och flyttas inte över.

---

## Miljövariabler

Ingen av dem behöver sättas för att köra appen lokalt. Appen läser ingen
`.env`-fil; `.env.example` är bara en mall som visar vad som ska sättas i drift.

| Variabel | Vad den gör |
|---|---|
| `PORT` | Porten servern lyssnar på. Förval `3000`. Render sätter den själv. |
| `DATABASE_URL` | Anslutningssträngen till PostgreSQL (Neon). Satt: appen sparar där. Inte satt: appen sparar lokalt. |
| `HEMOCHEKONOMI_DB_FILE` | Katalog för den lokala databasen när `DATABASE_URL` inte är satt. |
| `APP_URL` | Adressen appen nås på, till exempel `https://din-doman.se`. Används i länken för nytt lösenord och **krävs i drift**. |
| `RESEND_API_KEY` | Satt: länken för nytt lösenord mejlas via Resend. Inte satt: lokalt skrivs länken i terminalen, och i drift går Glömt lösenord inte att använda. |
| `RESEND_FROM` | Avsändaren för mejlet, till exempel `Hem och Ekonomi <noreply@din-doman.se>`. Krävs tillsammans med `RESEND_API_KEY`. |
| `NODE_ENV` | `production` i drift: sätter `Secure` på inloggningscookien och låter servern lyssna på alla nätverkskort. **Sätt den inte lokalt**: över `http://127.0.0.1` skickar webbläsaren då aldrig tillbaka cookien, och du kan inte logga in. |
| `TRUST_PROXY` | `1` när appen kör bakom en proxy som sätter `X-Forwarded-For`, som på Render. Ska inte vara satt lokalt. |

---

## Lägga ut appen på nätet

Allt nedan går att göra gratis. Du behöver ett GitHub-konto med projektet
uppladdat, och om du vill ha en egen adress en domän (den kostar oftast runt
100–200 kr om året hos en domänregistrar).

### 1. Databasen hos Neon

1. Skapa ett konto på [neon.tech](https://neon.tech) och ett nytt projekt.
   Välj regionen **AWS Europe Central 1 (Frankfurt)**, så att uppgifterna ligger
   inom EU.
2. Öppna **Connect** och kopiera anslutningssträngen. Den börjar med
   `postgresql://` och slutar med `?sslmode=require`. Det är din
   `DATABASE_URL`.

Tabellerna skapas automatiskt första gången appen startar.

### 2. Webbtjänsten hos Render

1. Skapa ett konto på [render.com](https://render.com) och logga in med GitHub.
2. Välj **New → Blueprint** och peka på ditt repo. Render läser `render.yaml` i
   projektroten och skapar en gratis webbtjänst som kör `npm ci` och `npm start`.
3. Render frågar efter de hemliga värdena. Fyll i `DATABASE_URL` från Neon och
   `APP_URL` med adressen tjänsten får, till exempel
   `https://hemochekonomi.onrender.com` (byt till din egen domän i steg 4).
   `NODE_ENV=production` och `TRUST_PROXY=1` är redan satta av `render.yaml`.
4. När driftsättningen är klar svarar `https://<din-tjänst>.onrender.com/healthz`
   med `ok`.

Gratistjänsten somnar efter en stund utan besökare och vaknar vid nästa
besök, vilket kan ta en halv minut. Dina uppgifter påverkas inte, eftersom de
ligger hos Neon.

### 3. Mejl för Glömt lösenord via Resend

1. Skapa ett konto på [resend.com](https://resend.com) och lägg till din domän
   under **Domains**. Resend visar några DNS-poster som du lägger in hos din
   domänregistrar.
2. Skapa en API-nyckel och lägg in den som `RESEND_API_KEY` hos Render, och
   sätt `RESEND_FROM`, till exempel `Hem och Ekonomi <noreply@din-doman.se>`.

Utan de två fungerar allt utom Glömt lösenord.

### 4. Egen domän

1. Välj **Settings → Custom Domains** i Render och lägg till din domän.
2. Lägg in de DNS-poster Render visar hos din domänregistrar. Render ordnar
   HTTPS-certifikatet själv.
3. Ändra `APP_URL` till `https://din-doman.se`.

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
Lokalt: kontrollera att terminalen med `npm start` fortfarande kör.

**Beloppen räknas i hela ören.** Inga kronor hanteras som flyttal.

---

## Inte byggt

- **Delat hushåll.** Varje konto är en person.
- **Påminnelser utanför appen.** Inga notiser och inga mejl utom länken för nytt
  lösenord. Påminnelsen är markeringen i kortet Räkningar.
- **Historik över betalda räkningar.** En återkommande räkning flyttas fram när
  den betalas, och den betalda förfallodagen sparas inte.
- **Byte av e-postadress.** Vill du byta adress: ladda ner dina uppgifter, ta
  bort kontot och skapa ett nytt.
- **Andra valutor än SEK.**

---

## Projektets filer

```
src/core/      Beräkningar och regler. Körs både i Node och i webbläsaren.
src/server/    HTTP-server, API, inloggning och databas.
src/web/       Det webbläsaren får: landningssidan, appen och integritetspolicyn.
tests/         Testsviten som npm test kör.
```

| Fil | Innehåll |
|---|---|
| `ARKITEKTUR.md` | Bindande beslut: datamodell, felmeddelanden, avrundnings- och datumregler. |
| `PLAN.md` | Arbetspaketen för appens första version. |
| `render.yaml` | Uppsättningen av webbtjänsten hos Render. |
| `.env.example` | Mall för miljövariablerna i drift. |
| `LARDOMAR.md` | Projektets minne: varje fel som gjorts och regeln som ska hindra att det görs om. |
| `CLAUDE.md` | Projektreglerna för den som bygger vidare. |
