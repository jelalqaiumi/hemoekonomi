# Plan: En app för hemmets fasta utgifter och prenumerationer som visar månadskostnad, årskostnad och nästa dragning, med poster användaren själv lägger till och tar bort.

## Lärdomar som gäller här

`LARDOMAR.md` innehåller ännu inga riktiga poster — bara exempelposten
`0000-00-00 — exempel`. Jag redovisar den ändå i klartext, eftersom regeln under
"Regel framåt" är formulerad som bindande och är direkt relevant för det här
projektet:

- **0000-00-00 — exempel:** "Validera alltid användarinput innan den används —
  tom sträng, för lång sträng och fel typ ska hanteras explicit och testas."
  → Påverkar paket 2 och 5. All inmatning av en post (namn, belopp, intervall,
  startdatum) ska valideras explicit, och valideringen ska ha egna tester. Ett
  paket får inte räknas som klart om det tar emot användarinput utan testad
  validering.

Övrigt: `CLAUDE.md` är fortfarande en mall (rubrikerna för kör-kommandon och
projektregler är ofyllda). Det är arkitektens och dokumentatorns ansvar att fylla
i dem — se paket 1 och 8.

## Beslut

Fastställda avgränsningar för den här versionen. De är inte antaganden och ska
inte omprövas under bygget.

1. **Bara utgifter.** Ingen inkomsthantering. Appen visar vad som kostar, inte
   vad som blir över.
2. **Bara en lista över kommande dragningar.** Inga notiser, inga påminnelser,
   ingen bakgrundskörning.
3. **En person, en enhet.** Ingen delning, inga konton, ingen synk, ingen
   inloggning.
4. **Ingen historik över faktiska dragningar.** Nästa dragningsdatum räknas fram
   ur betalningsintervall + startdatum. Datumet lagras alltså inte som ett eget
   fält som användaren underhåller.
5. **SEK som enda valuta.** Ingen valutaomräkning, ingen valutaväljare.

**Medvetet uppskjutet till en senare version** — bortvalt, inte glömt:
inkomster och saldo, notiser och påminnelser, delning mellan flera personer och
enheter, samt historik över faktiskt genomförda dragningar. Ingen av dem ska
förberedas med halvfärdiga fält eller platshållare i den här versionen.

## Arbetspaket

Ordningen är bindande. Ett paket startar inte förrän föregående är granskat.

| # | Uppgift | Agent | Klar när |
|---|---------|-------|----------|
| 1 | **Arkitektur och avgränsning.** Bestäm språk, körsätt, lagringsform, teststrategi och projektstruktur. Beskriv datamodellen för en post (minst: namn, belopp i SEK, betalningsintervall, startdatum, kategori), hur intervall normaliseras till månad och år, samt regeln för hur nästa dragningsdatum härleds ur intervall + startdatum — inklusive vad som gäller vid månadsskiften och startdatum den 29–31. Fyll i kör- och testkommandon i `CLAUDE.md`. Inga beroenden utan motivering. | arkitekt | `ARKITEKTUR.md` finns och namnger datamodellens fält, lagringsform, testkommando, avrundningsregel och härledningsregel för nästa dragningsdatum. `CLAUDE.md` har ifyllda kommandon för installera/starta/testa. Ett tomt projekt kan startas och testkommandot kan köras utan fel (0 tester är OK). |
| 2 | **Datamodell och validering.** Representationen av en post plus regler för vad som är en giltig post. Ingen lagring, inget gränssnitt. Nästa dragningsdatum är inget inmatat fält — användaren anger startdatum. | byggare | Tester finns och passerar för: giltig post accepteras; tomt namn avvisas; för långt namn avvisas; belopp som inte är ett tal avvisas; negativt belopp avvisas; okänt betalningsintervall avvisas; ogiltigt startdatum avvisas. Varje avvisning ger ett felmeddelande på svenska. |
| 3 | **Kostnadsberäkning.** Månadskostnad och årskostnad, per post och som total för alla poster. Hanterar minst intervallen månad, kvartal och år. | byggare | Tester passerar för: en månadspost, en kvartalspost och en årspost räknas rätt både per månad och per år; totalen av flera poster med olika intervall stämmer; tom lista ger 0 och inte fel. Avrundning följer paket 1 och är testad. Beror på paket 2. |
| 4 | **Lagring som överlever omstart.** Poster sparas och läses tillbaka, lokalt på enheten. | byggare | Test som skriver poster, läser tillbaka dem i en ny körning och får identiskt innehåll passerar. Läsning från tomt/saknat lager ger tom lista, inte krasch. Trasigt/oläsbart innehåll ger ett tydligt fel på svenska i stället för krasch. Beror på paket 2. |
| 5 | **Lägg till och ta bort poster.** Användaren skapar en ny post och tar bort en befintlig, via appens gränssnitt. Ändringen sparas. | byggare | Manuellt körd genomgång: ny post läggs till, syns i listan och finns kvar efter omstart; posten tas bort, försvinner ur listan och är borta efter omstart. Ogiltig inmatning enligt paket 2 visar felmeddelande och skapar ingen post. Borttagning av en post som inte finns ger ett tydligt fel, inte krasch. Beror på paket 2, 3 och 4. |
| 6 | **Översikt: månadskostnad och årskostnad.** Vy som listar alla poster med belopp och intervall, samt totalsummorna. | byggare | Med minst tre poster med olika intervall visar vyn varje post och två totaler som stämmer med paket 3:s beräkning. Tom lista visar ett begripligt tomläge, inte en tom skärm eller ett fel. Beror på paket 3 och 5. |
| 7 | **Vad dras härnäst.** Härled nästa dragningsdatum ur intervall + startdatum och visa kommande dragningar sorterade i datumordning, med hur många dagar det är kvar. | byggare | Tester passerar för: nästa datum härleds rätt när startdatumet ligger i framtiden; nästa datum härleds rätt när startdatumet passerat, även flera perioder tillbaka; startdatum den 29–31 hanteras enligt paket 1:s regel i kortare månader; poster sorteras stigande på nästa dragningsdatum; poster med samma datum ger en stabil ordning. Vyn visar listan och antal dagar kvar. Beror på paket 6. |
| 8 | **Slutgranskning och dokumentation.** Genomgång av hela flödet mot målet, därefter README och användarguide. | granskare, sedan dokumentator | Granskaren har kört hela flödet (lägg till → se totaler → se nästa dragning → ta bort) och skrivit resultatet i `LARDOMAR.md` — exempelposten är då ersatt av riktiga poster eller borttagen. `README.md` finns och beskriver installera, starta, testa samt de fyra användarflödena, och nämner de fyra uppskjutna funktionerna som medvetet utelämnade. En utomstående kan följa README från noll till en körande app. |

**Stående regel:** `granskare` körs efter varje paket, inte bara efter paket 8.
Ett paket är inte klart förrän granskaren godkänt det.

## Risker

- **Arkitekten fattar för många beslut på en gång.** Paket 1 är brett. Märks
  tidigt om `ARKITEKTUR.md` saknar konkret svar på testkommando, lagringsform
  eller härledningsregeln för nästa dragningsdatum — då är paket 2 inte
  startbart och ska lämnas tillbaka.
- **Intervall och avrundning smyger in fel.** Kvartal och år som räknas om till
  månad ger ören som inte går jämnt ut, och felet syns först i totalen. Motmedel:
  avrundningsregeln bestäms i paket 1 och testas explicit i paket 3.
- **Datumhärledningen är den svåraste delen.** Eftersom nästa dragning räknas
  fram ur startdatum i stället för att lagras, slår varje fel i månadsskiften,
  den 31:e i korta månader och passerade startdatum igenom överallt. Motmedel:
  regeln skrivs ned i paket 1 och har egna tester i paket 7.
- **Validering hoppas över för att "det går ändå".** Det är precis den enda
  lärdom projektet har. Motmedel: granskaren underkänner paket 2 och 5 om
  valideringstesterna saknas.
- **Uppskjutna funktioner smyger in i förtid.** Fält för inkomst, konton eller
  historik läggs in "så det finns sen" och gör datamodellen större än beslutet.
  Märks vid granskning av paket 2. Motmedel: granskaren underkänner fält som
  inte används av något av paket 3–7.
