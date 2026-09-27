// En månads summor: inkomst, utgift, sparande och "kvar att leva på".
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
//
// Modulen tar emot en lista poster och svarar med summorna. Den läser ingen
// databas och ingen klocka, och den anropar aldrig formatSek: money.js äger
// omvandlingen till text.
//
// All räkning sker i heltal ören. Ingen division, ingen avrundning, inget
// flyttal — en summa av heltal är exakt så länge den ligger i det säkra
// heltalsområdet, och utanför det kastar modulen RangeError i stället för att
// svara (samma giltighetsområde och samma form som cost.js).
//
// Ingångsspärrarna ägs av sumByKind. monthTotals har inga egna spärrar för de
// fyra första raderna utan ärver dem, enligt regeln att ett villkor har en enda
// ägarfunktion — samma form som yearlyOre och monthlyOre i cost.js. Följden är
// facit: varje meddelande namnger monthTotals, också när kastet sker i
// sumByKind, eftersom ARKITEKTUR.md skriver ut de fem texterna ordagrant i
// tabellen "Ingångsspärrar — bindande, första träff vinner" och en text inte får
// skrivas om.

import { isPlainObject } from './entry.js';
import { isItemKind } from './item.js';
import { normalizeZero } from './money.js';

// De fem texterna ur spärrtabellen, skrivna bara här. Rad 3 tar värdet genom
// String(): ${Symbol('x')} kastar TypeError, medan String(Symbol('x')) ger
// 'Symbol(x)'.
const MESSAGES = Object.freeze({
  notAList: 'monthTotals kräver en lista med poster.',
  notAnObject: 'monthTotals kräver poster som objekt.',
  unknownKind: (value) => `monthTotals kräver ett känt slag, fick "${String(value)}".`,
  badAmount: 'monthTotals kräver ett belopp i heltal ören.',
  unsafeSum: 'monthTotals kräver att summan är ett säkert heltal.'
});

// Rad 1 till 4 i spärrtabellen, i tabellens ordning och över hela listan i
// taget. Tre varv och inte ett: tabellen säger "första träff vinner" om
// *raderna*, så en lista där en post inte är ett objekt (rad 2) och en annan har
// ett trasigt belopp (rad 4) ska svara med rad 2 oavsett vilken av posterna som
// står först. Ett enda varv hade gjort svaret beroende av ordningen i listan.
function checkItems(items) {
  // Utan Array.isArray itererar sumByKind('abc', 'income') över strängens tecken.
  if (!Array.isArray(items)) {
    throw new RangeError(MESSAGES.notAList);
  }
  for (const item of items) {
    // Ägaren till villkoret "är det här ett vanligt objekt" står i entry.js.
    // Ingen handskriven kopia här: en egen kopia släppte tidigare igenom en
    // array och ett Date i cost.js (LARDOMAR.md 2026-09-02).
    if (!isPlainObject(item)) {
      throw new RangeError(MESSAGES.notAnObject);
    }
  }
  for (const item of items) {
    if (!isItemKind(item.kind)) {
      throw new RangeError(MESSAGES.unknownKind(item.kind));
    }
  }
  for (const item of items) {
    // Number.isSafeInteger coercar inte: 1n och Symbol('x') ger false i stället
    // för att kasta TypeError, och NaN, Infinity, 199.5 och 1e300 avvisas här i
    // stället för att föras vidare som ett skadat ören-tal.
    if (!Number.isSafeInteger(item.amountOre)) {
      throw new RangeError(MESSAGES.badAmount);
    }
  }
}

// Summan av amountOre för posterna med det slaget. Tom lista ger 0. Äger hela
// indatakedjan för modulen.
export function sumByKind(items, kind) {
  checkItems(items);
  // Spärren mot ett okänt kind-argument står efter listans kedja och inte före:
  // då kan den aldrig ändra vilken av tabellens fem rader som vinner. Den finns
  // därför att sumByKind(items, 'gift') annars svarar 0 — ett tyst fel av samma
  // slag som ett ovaliderat tabelluppslag (LARDOMAR.md 2026-09-02). Texten är
  // rad 3:s, eftersom villkoret är detsamma: slaget är inte ett känt slag.
  if (!isItemKind(kind)) {
    throw new RangeError(MESSAGES.unknownKind(kind));
  }
  let sum = 0;
  for (const item of items) {
    if (item.kind !== kind) {
      continue;
    }
    sum += item.amountOre;
    // Rad 5, efter varje addition och inte bara på slutsumman: ett belopp får
    // vara negativt här, så delsummorna växer inte monotont och en delsumma kan
    // lämna det säkra området även när slutsumman ligger inom det. Kört:
    // [MAX_SAFE_INTEGER, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER] ger rad 5 med
    // kontrollen i loopen och MAX_SAFE_INTEGER utan den. Det är samma skäl som
    // totalYearlyOre i cost.js anger — en summa som lämnar området avrundas
    // tyst — men där är placeringen den omvända, eftersom varje årsbelopp där
    // är minst 0.
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(MESSAGES.unsafeSum);
    }
  }
  return sum;
}

// De tre summorna och "kvar att leva på". Inga egna spärrar för rad 1 till 4 —
// ärver sumByKind. Tom lista ger fyra nollor.
export function monthTotals(items) {
  // Slagen står som strängar och inte som ITEM_KINDS[0], ITEM_KINDS[1] och
  // ITEM_KINDS[2]: en omordning av listan i item.js skulle då tyst byta vilket
  // slag som hamnar i incomeOre. Att de tre är samma tre som listan skyddas i
  // stället av ett testfall som jämför returvärdets nycklar mot ITEM_KINDS,
  // samma sorts prov som tests/cost.test.js har för PAYMENTS_PER_YEAR mot
  // INTERVALS (LARDOMAR.md 2026-09-02).
  const incomeOre = sumByKind(items, 'income');
  const expenseOre = sumByKind(items, 'expense');
  const savingOre = sumByKind(items, 'saving');
  // Enda stället i projektet där "kvar att leva på" definieras:
  // leftOre = incomeOre - expenseOre - savingOre. Sparande dras bort och läggs
  // inte till — pengar som går till sparande är inte pengar som finns kvar att
  // leva på den månaden.
  //
  // leftOre får vara negativt, och ingen spärr mot det finns: en månad där
  // utgifter och sparande överstiger inkomsten ska visa ett minusbelopp, inte
  // noll och inte ett fel.
  let leftOre = incomeOre - expenseOre;
  // Rad 5 efter varje led, av samma skäl som i loopen ovan: de tre summorna är
  // var för sig säkra heltal, men ett negativt belopp gör att differensen kan
  // ligga utanför. Kört: incomeOre MAX_SAFE_INTEGER och expenseOre
  // -MAX_SAFE_INTEGER ger rad 5, där utan kontrollen svaret blir 18014398509481982,
  // ett tal som inte är ett säkert heltal.
  if (!Number.isSafeInteger(leftOre)) {
    throw new RangeError(MESSAGES.unsafeSum);
  }
  leftOre -= savingOre;
  if (!Number.isSafeInteger(leftOre)) {
    throw new RangeError(MESSAGES.unsafeSum);
  }
  return {
    incomeOre,
    expenseOre,
    savingOre,
    // normalizeZero äger villkoret "detta är -0" (money.js). Ingen indata gör
    // leftOre till -0 i dag: varje summa börjar på 0, och 0 + (-0) samt 0 - 0
    // ger båda +0, så subtraktionen har ingen väg till -0. Anropet står ändå
    // kvar därför att ARKITEKTUR.md gör normaliseringen bindande för leftOre,
    // och därför att villkoret då har en ägare i stället för att vila på det
    // resonemanget: formatSek(-0) gav i en tidigare granskning ett
    // minustecken (kodpunkt U+2212) före noll kronor, med hårt blanksteg
    // (kodpunkt U+00A0) före kr. Ingen av de två kodpunkterna skrivs rått i
    // projektets filer (LARDOMAR.md 2026-09-14), och därför står de här som
    // namn och inte som tecken. Kontrollen att leftOre aldrig
    // blir -0 är ett eget testfall (B4).
    leftOre: normalizeZero(leftOre)
  };
}
