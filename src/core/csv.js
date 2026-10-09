// CSV-formatet: avgränsare, BOM, radslut, injektionsskydd, citering och belopp
// [steg 5].
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren.
//
// Modulen äger formatet och ingenting annat. Rapportens form ägs av
// src/core/report.js, som byggs i del 2 av steget. Åtskilda därför att CSV är ett
// filformat med egna fällor som ska gå att pröva ensamt (ARKITEKTUR.md, "Två nya
// moduler i kärnan").
//
// De sex fällorna i ARKITEKTUR.md under "CSV: sex fällor, var och en mätbar" är
// var och en ett fel som annars blir användarens:
//   1. avgränsaren är semikolon, inte komma — vi skriver decimalkomma,
//   2. filen börjar med en UTF-8 BOM, annars läser Excel UTF-8 som Latin-1,
//   3. radslutet är CR LF enligt RFC 4180,
//   4. en textcell som börjar med ett formeltecken föregås av en apostrof,
//   5. en cell med avgränsare, citattecken eller radbrott citeras,
//   6. belopp skrivs 1234,50 — ingen enhet, ingen tusentalsavgränsare.
//
// Beroendet är riktat och cykelfritt: entry.js importerar dates.js och money.js,
// och ingen av dem importerar den här filen.
import { isPlainObject } from './entry.js';
import { ORE_PER_SEK } from './money.js';

// Fälla 1. Semikolon, inte komma: beloppen bär decimalkomma, så ett komma som
// avgränsare bryter varje rad med ett belopp i.
const SEPARATOR = ';';

// Fälla 2. U+FEFF BYTE ORDER MARK, skriven som escape. Ett rått tecken här syns
// inte i en genomläsning och går då inte att skilja från att det saknas
// (LARDOMAR.md 2026-09-14).
const BOM = '\ufeff';

// Fälla 3. U+000D CARRIAGE RETURN följt av U+000A LINE FEED, båda som escaper.
const CRLF = '\r\n';

// Fälla 4. De sex tecken Excel tolkar som början på en formel, i den ordning
// ARKITEKTUR.md räknar upp dem: U+003D likhetstecken, U+002B plus, U+002D minus,
// U+0040 snabel-a, U+0009 tabb och U+000D CR. Tabben och CR står som escaper av
// samma skäl som BOM ovan.
//
// Listan är modullokal med flit. Facit för vilka tecken som ingår står utskrivet
// som sex literaler i tests/csv.test.js under (RA3): en exporterad lista hade
// låtit testet läsa samma lista modulen själv använder, och då hade provet
// prövat att två kopior är lika i stället för att pröva regeln.
const INJECTION_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r']);

// Fälla 4:s apostrof, U+0027.
const APOSTROPHE = "'";

// Fälla 5. Citattecken, U+0022.
const QUOTE = '"';

// Fälla 6. Belopp i öre till den sträng ett kalkylblad läser som ett tal:
// decimalkomma, exakt två decimaler, ingen tusentalsavgränsare och ingen enhet.
//
// formatSek i money.js får inte användas och härmas inte: dess utdata har hårt
// blanksteg U+00A0 som tusentalsavgränsare och enheten kr, och båda gör strängen
// obrukbar i ett kalkylblad. Den här funktionen är en egen ägare, och
// rundgångskravet (RA7) prövar att dess utdata går att läsa tillbaka.
//
// Strängen byggs i heltalsaritmetik, aldrig genom en division av kronor som
// flyttal: kronorna är Math.trunc av heltalskvoten och örena är heltalsresten.
export function csvAmountSek(ore) {
  // Spärrtabellen rad 1. Number.isSafeInteger avvisar NaN, Infinity, -Infinity,
  // flyttal och 1e300, och coercar inte: 1n och Symbol('x') ger false i stället
  // för att kasta TypeError ur aritmetiken längre ner.
  if (!Number.isSafeInteger(ore)) {
    throw new RangeError('csvAmountSek kräver ett säkert heltal öre.');
  }

  // -0 är noll skrivet med tecken och ett giltigt belopp i en rapport: en
  // kategori kan vara noll en månad. csvAmountSek(-0) ger därför 0,00 och kastar
  // inte.
  //
  // Formen nedan är själv garantin, inte ett anrop: tecknet och magnituden
  // avgörs var för sig, och -0 < 0 är falskt medan Math.abs(-0) är 0, så
  // strängen -0,00 går inte att producera.
  //
  // Ett normalizeZero(ore) stod här först, men ingen indata skilde anropet från
  // dess borttagande: mutation: normalizeZero(ore) -> ore ger EXIT=0, fail 0.
  // Det som verkligen håller invarianten är testfallet, inte raden — mätt genom
  // att skriva om formen till den enda sort som bevarar tecknet, Intl, som ger
  // minus noll med U+2212 för -0 (medan toFixed och String ger 0.00 och 0):
  // mutation: sign-och-magnitud + normalizeZero -> Intl utan normalizeZero ger
  // EXIT=1, fail 6, däribland csvAmountSek tar emot -0, kastar inte och ger 0,00.

  const negative = ore < 0;
  const magnitude = Math.abs(ore);
  const kronor = Math.trunc(magnitude / ORE_PER_SEK);
  const rest = magnitude % ORE_PER_SEK;
  return `${negative ? '-' : ''}${kronor},${String(rest).padStart(2, '0')}`;
}

// Fälla 4. Injektionsskyddet för fritext, och projektets enda säkerhetspunkt i
// steg 5: ett postnamn är text användaren skriver själv, och Excel kör en cell
// som börjar med ett formeltecken som en formel.
//
// Citerar inte. Citeringen gör toCsv för varje cell, eftersom den regeln är
// gemensam för text och belopp — två funktioner som båda citerade hade
// dubbelciterat (ARKITEKTUR.md). csvText äger bara apostrofen.
export function csvText(value) {
  // Spärrtabellen rad 2.
  if (typeof value !== 'string') {
    throw new RangeError('csvText kräver en sträng.');
  }
  // Bara det första tecknet avgör: regeln i ARKITEKTUR.md gäller en cell som
  // BÖRJAR med ett av de sex tecknen.
  if (INJECTION_PREFIXES.includes(value[0])) {
    return APOSTROPHE + value;
  }
  return value;
}

// BOM, en rad per lista och CR LF efter varje rad, med citeringen inräknad.
//
// En cell deklarerar sin typ: { text } eller { amountOre }, aldrig en färdig
// sträng. Det är ett val mot en fotgillra — tog funktionen emot strängar måste
// anroparen minnas att köra varje fritextcell genom csvText, och en enda glömd
// cell är injektionshålet tillbaka. Med typade celler väljer toCsv regel ur
// cellens egen form, och en cell som varken är text eller belopp kastar i
// stället för att tystna (ARKITEKTUR.md).
//
// Ordningen mellan spärrarna är tre skilda genomgångar och inte en nästlad
// loop, så att spärrtabellens "första träff vinner" är sann ordagrant: rad 3,
// därefter rad 4 för VARJE rad, därefter rad 5 för varje cell, och först sist
// omvandlingen, som kan kasta rad 1 eller rad 2 ur sin egen ägare. En nästlad
// loop hade varvat raderna så att rad 5 på rad 0 vann över rad 4 på rad 1, och
// en numrerad tabell får inte beskriva villkor som prövas varvat
// (LARDOMAR.md 2026-09-02).
//
// Körd konsekvens av ordningen: toCsv([[{ text: 42 }], 'inte en rad']) ger
// rad 4:s meddelande om index 1, inte rad 2:s om texten i rad 0.
export function toCsv(rows) {
  // Spärrtabellen rad 3.
  if (!Array.isArray(rows)) {
    throw new RangeError('toCsv kräver en lista med rader.');
  }

  // Spärrtabellen rad 4, för varje rad innan någon cell prövas.
  for (let i = 0; i < rows.length; i += 1) {
    if (!Array.isArray(rows[i])) {
      throw new RangeError(`toCsv kräver att varje rad är en lista, raden på index ${i} är det inte.`);
    }
  }

  // Spärrtabellen rad 5, för varje cell innan någon cell omvandlas. Prövar
  // EXAKT en nyckel och inte bara att en av dem finns: en cell med båda hade
  // låtit toCsv välja tyst, och det valet är hela poängen med att cellen
  // deklarerar sin typ (ARKITEKTUR.md).
  //
  // isPlainObject ägs av entry.js och importeras: den avvisar null och en array,
  // som Object.keys annars kastar för respektive svarar på med sina index
  // (LARDOMAR.md 2026-09-02).
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows[i].length; j += 1) {
      if (!isCell(rows[i][j])) {
        throw new RangeError(`toCsv kräver en cell med text eller amountOre, rad ${i} kolumn ${j}.`);
      }
    }
  }

  let out = BOM;
  for (const row of rows) {
    out += row.map(toField).join(SEPARATOR) + CRLF;
  }
  return out;
}

// Rad 5:s villkor, skrivet en gång.
function isCell(cell) {
  if (!isPlainObject(cell)) {
    return false;
  }
  const keys = Object.keys(cell);
  return keys.length === 1 && (keys[0] === 'text' || keys[0] === 'amountOre');
}

// Omvandlingen plus fälla 5. Apostrofen sätts först av csvText och kan därför
// hamna inuti citattecknen, vilket är rätt: Excel läser cellens innehåll efter
// att citeringen tagits bort.
function toField(cell) {
  const raw = Object.hasOwn(cell, 'text') ? csvText(cell.text) : csvAmountSek(cell.amountOre);
  return needsQuoting(raw) ? QUOTE + raw.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE : raw;
}

// Fälla 5. Semikolon, citattecken eller ett radbrott — både CR och LF, var för
// sig, eftersom en sträng kan bära det ena utan det andra. Skrivna som escaper.
function needsQuoting(field) {
  return field.includes(SEPARATOR)
    || field.includes(QUOTE)
    || field.includes('\r')
    || field.includes('\n');
}
