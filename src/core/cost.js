// Månadskostnad och årskostnad för poster.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
// All aritmetik sker i heltal öre. Avrundning sker en gång per visat värde och
// aldrig i mellanled.
//
// Giltighetsområde: årsbelopp och årssumma räknas i Number, som bär hela heltal
// bara upp till Number.MAX_SAFE_INTEGER. Utanför det området kastar modulen
// RangeError i stället för att svara. Ingen exporterad funktion här får
// returnera NaN för någon indata.
//
// Ingångsspärrarna ägs av yearlyOre respektive totalYearlyOre. monthlyOre och
// totalMonthlyOre har inga egna spärrar utan ärver dem, enligt regeln att ett
// villkor har en enda ägarfunktion. Följden är facit: totalMonthlyOre('abc')
// svarar med totalYearlyOre-namnet i meddelandet.
//
// Beloppsgränserna "> 0", "högst två decimaler" och AMOUNT_MAX_SEK prövas
// medvetet inte om här — de ägs av entry.js. Kvar blir teckenspärren, som finns
// därför att avrundningsregeln "halva öret uppåt" bara sammanfaller med
// bort-från-noll för icke-negativa täljare.

import { divideRoundHalfUp, sekToOre } from './money.js';
// Ägaren till villkoret "är det här ett vanligt objekt". cost.js skriver inte av
// villkoret utan anropar ägarfunktionen; en egen kopia släppte tidigare igenom en
// array och ett Date. Beroendet är riktat och cykelfritt: entry.js importerar
// aldrig cost.js, bara dates.js och money.js.
import { isPlainObject } from './entry.js';

// Ägs av den här modulen. INTERVALS i entry.js är listan över tillåtna värden;
// den här tabellen är normaliseringsfaktorn och skrivs inte av någon annanstans.
// Fryst: en importör som skriver om ett värde skulle annars ändra hela appens
// beräkning utan att någon fil visar det.
export const PAYMENTS_PER_YEAR = Object.freeze({
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  yearly: 1
});

// Ägare till talet 12 i rollen "antal månader per år". PAYMENTS_PER_YEAR.monthly
// bär samma siffra men svarar på en annan fråga och är därför inte samma
// konstant. Fryses inte: Object.freeze på ett primitivt värde gör ingenting, och
// en importerad ESM-bindning går ändå inte att skriva om.
export const MONTHS_PER_YEAR = 12;

// Beloppet i öre gånger antalet betalningar per år. Äger hela indatakedjan för
// modulen; första träff vinner.
export function yearlyOre(entry) {
  if (!isPlainObject(entry)) {
    throw new RangeError('yearlyOre kräver en post som objekt.');
  }
  // Object.hasOwn, inte ett sanningsprövat uppslag: annars hittar
  // interval: 'constructor' något på prototypen, och ett okänt interval ger
  // undefined rakt in i multiplikationen, alltså NaN i stället för ett fel.
  // Värdet skrivs in i meddelandet via String() — ${Symbol('x')} kastar
  // TypeError, medan String(Symbol('x')) ger 'Symbol(x)'.
  if (!Object.hasOwn(PAYMENTS_PER_YEAR, entry.interval)) {
    throw new RangeError(`yearlyOre kräver ett känt interval, fick "${String(entry.interval)}".`);
  }
  // Icke-finit belopp avvisas av sekToOre med dess eget meddelande.
  const amountOre = sekToOre(entry.amountSek);
  // Ingen egen -0-kontroll: amountOre kommer från sekToOre, som normaliserar -0
  // till 0 genom ägarfunktionen normalizeZero. En kontroll här vore både en
  // handskriven kopia av ett villkor som har en ägare och död kod. Följden är
  // facit: amountSek -0, -0.001 och -0.004 ger 0, medan -0.01 kastar. Exakt 0 är
  // tillåtet — teckenspärren står kvar därför att avrundningsregeln "halva öret
  // uppåt" bara sammanfaller med bort-från-noll för icke-negativa täljare.
  if (amountOre < 0) {
    throw new RangeError('yearlyOre kräver ett belopp som inte är negativt.');
  }
  const totalOre = amountOre * PAYMENTS_PER_YEAR[entry.interval];
  // Multiplikationen är det första stället där ett skadat belopp kan lämna det
  // säkra området, och det ska inte kunna passera bara för att summan rymmes.
  if (!Number.isSafeInteger(totalOre)) {
    throw new RangeError('yearlyOre kräver att årsbeloppet är ett säkert heltal.');
  }
  return totalOre;
}

// Avrundat en gång, ur postens årsbelopp. Inga egna spärrar — ärver yearlyOre
// och divideRoundHalfUp.
export function monthlyOre(entry) {
  return divideRoundHalfUp(yearlyOre(entry), MONTHS_PER_YEAR);
}

// Summan av årsbeloppen. Tom lista ger 0.
export function totalYearlyOre(entries) {
  // Utan Array.isArray itererar totalYearlyOre('abc') över strängens tecken.
  if (!Array.isArray(entries)) {
    throw new RangeError('totalYearlyOre kräver en lista med poster.');
  }
  let sum = 0;
  for (const entry of entries) {
    sum += yearlyOre(entry);
  }
  // Efter loopen, inte inuti den: varje posts eget fel vinner över summafelet.
  // Placeringen ändrar bara vilket meddelande som vinner när både en delsumma och
  // en senare post är trasiga, och det svaret är valt — postens fel pekar ut något
  // som går att rätta i datafilen. Båda riktningarna har var sitt testfall.
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('totalYearlyOre kräver att summan är ett säkert heltal.');
  }
  return sum;
}

// Bindande beslut: månadstotalen räknas ur årssumman och avrundas en enda gång
// — inte som summan av de avrundade månadsbeloppen. Kolumnen med månadsbelopp
// per post kan därför skilja sig något öre från den här totalen. Det är
// avsiktligt. Inga egna spärrar — ärver totalYearlyOre och divideRoundHalfUp.
export function totalMonthlyOre(entries) {
  return divideRoundHalfUp(totalYearlyOre(entries), MONTHS_PER_YEAR);
}
