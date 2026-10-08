// Räkningen: vad som ska betalas, och när [steg 3].
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren.
//
// Modulen äger tre frågor och ingenting annat:
//   1. statusen — betald, forfallen, paminnelse eller kommande,
//   2. framflyttningen när en återkommande räkning betalas,
//   3. valideringen av räkningens utkast från användaren.
//
// Den räknar inget datum själv. Periodlängden kommer ur MONTHS_PER_PERIOD i
// schedule.js, månadsstegen och klampningen för den 29-31 ur addMonthsClamped i
// dates.js, hoppet över flera perioder ur nextDueDate i schedule.js och
// dagsskillnaden ur daysBetween i dates.js. Ingen subtraktion av datum och ingen
// egen klampning står i den här filen.
//
// Beroendet är riktat och cykelfritt: schedule.js importerar entry.js och
// dates.js, entry.js importerar dates.js och money.js, och ingen av de tre
// importerar den här filen.
//
// Klockan läses inte här. Dagens datum kommer in som parameter, av samma skäl som
// i schedule.js: en funktion som läser klockan går inte att testa.
import { addMonthsClamped, compareIsoDates, daysBetween, isValidIsoDate } from './dates.js';
import { checkAmountSek, checkInterval, checkName, isPlainObject } from './entry.js';
import { sekToOre } from './money.js';
import { MONTHS_PER_PERIOD, nextDueDate } from './schedule.js';

// De fyra statusvärdena i tabellordning, alltså i den ordning första träff
// vinner i billStatus nedan. Ordningen är inte fri: den ÄR regeln, och ett
// testfall per rad prövar den ((R1) och (R2) i tests/bills.test.js).
//
// Nycklarna är svenska därför att de är en del av appens datamodell och inte
// text mot användaren: de står i JSON-svaret från GET /api/rakningar och väljs
// av gränssnittet för att avgöra hur en rad ska se ut. Adresserna i API:t är
// svenska av samma skäl (/api/manad, /api/rakningar). Användaren ser aldrig
// strängarna — dagtexten är en egen sak.
//
// Fryst av samma skäl som INTERVALS och CATEGORIES i entry.js: en importör som
// skriver om ett värde skulle annars flytta hela appens statusregel utan att
// någon fil visar det.
//
// Exportens enda anropare i src/ är raden nedan, i samma fil
// (`grep -rn "BILL_STATUSES" src/` ger definitionen, en kommentar och
// destruktureringen). Den är exporterad för att korten i månadsvyn ska kunna
// räkna upp de fyra utseendena ur listan i stället för att skriva av dem, och
// gränssnittet är ännu inte byggt. Läser gränssnittet den inte när steg 3 är klart
// ska exporten tas bort (LARDOMAR.md 2026-09-16). Detsamma gäller
// REMIND_DAYS_MIN, REMIND_DAYS_MAX och REMIND_DAYS_DEFAULT nedan, som
// formulärets fält Påminn mig <N> dagar innan ska läsa sina gränser ur.
export const BILL_STATUSES = Object.freeze(['betald', 'forfallen', 'paminnelse', 'kommande']);

// De fyra värdena läses ur listan ovan och skrivs inte en andra gång som
// literaler i billStatus: listan är därmed verkligen ägaren, och en ändring i
// den når både statusen och varje anropare som räknar upp värdena.
// Destrukturering och inte fyra uppslag: ordningen i listan är regeln, och en
// rad som läser BILL_STATUSES[1] hade sagt samma sak utan att visa vilket värde
// som menas.
const [PAID, OVERDUE, REMINDER, UPCOMING] = BILL_STATUSES;

// Gränserna för remind_days, skrivna som namn och inte som literaler: var och en
// läses av villkoret i checkRemindDays, av meddelandet och av schemats CHECK i
// src/server/db.js. Två handskrivna kopior kan glida isär utan att något test
// märker det (LARDOMAR.md 2026-09-02). Kopplingen till schemat hålls av ett
// testfall i tests/bills.test.js, som läser villkoret ur sqlite_master.
export const REMIND_DAYS_MIN = 0;
export const REMIND_DAYS_MAX = 30;
// Förvalet är detsamma som schemats DEFAULT 3. Det används när användaren inte
// fyller i fältet, och skrivs alltid ut i den rad som sparas — kolumnens DEFAULT
// är alltså aldrig det som avgör, utan en andra spärr i ett annat språk.
export const REMIND_DAYS_DEFAULT = 3;

// De texter modulen äger. Alla fyra är text mot användaren och står på svenska.
//
// dueDate får en egen text och lånar inte checkStartDates: den texten namnger
// "Startdatum", och fältet heter Förfallodag i räkningens formulär. En text som
// namnger ett annat fälts etikett är en text användaren inte kan följa.
//
// interval får också en egen text, fastän checkInterval i entry.js äger
// VÄRDELISTAN: räkningens fält har ett alternativ mer än mallens — Engångs — och
// checkIntervals text räknar inte upp det. Värdelistan skrivs ändå inte av här;
// checkBillInterval nedan anropar checkInterval för just den frågan.
const MESSAGES = Object.freeze({
  dueDate: 'Förfallodag måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD.',
  interval: 'Välj Engångs, månadsvis, kvartalsvis, halvårsvis eller årsvis.',
  remindDays: `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`
});

// Räkningens status. Tabellen i ARKITEKTUR.md under "Vad readBills svarar" är
// facit, och ordningen är bindande — första träff vinner:
//
//   1. paidAt är satt            -> betald
//   2. dueDate ligger före today -> forfallen
//   3. daysUntil <= remindDays   -> paminnelse
//   4. annars                    -> kommande
//
// Rad 1 före rad 2 är hela skillnaden mot en handskriven kedja i omvänd ordning:
// en betald räkning som har förfallit är betald, inte försenad. (R2) prövar just
// det fallet.
//
// Rad 3 kan bara vara sann för ett daysUntil som inte är negativt: rad 2 har
// redan fångat varje dueDate före today, och ett dueDate som är today eller
// senare ger ett daysUntil på minst 0. Villkoret skrivs därför utan en undre
// gräns — en sådan hade varit en gren ingen indata når (LARDOMAR.md 2026-09-04).
//
// Spärrarna nedan är modulens ingångsspärrar, första träff vinner. Räkningen
// kommer ur databasen, så ett värde som faller här är ett programmeringsfel och
// inte ett användarfel; texterna är skrivna för den som läser ett stackspår, på
// samma form som RangeError-texterna i cost.js och dates.js.
export function billStatus(bill, today) {
  if (!isPlainObject(bill)) {
    throw new RangeError('billStatus kräver en räkning som objekt.');
  }
  if (!isValidBillPaidAt(bill.paidAt)) {
    throw new RangeError(`billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "${String(bill.paidAt)}".`);
  }
  if (!isValidRemindDays(bill.remindDays)) {
    throw new RangeError(`billStatus kräver ett remindDays mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX}, fick "${String(bill.remindDays)}".`);
  }
  if (bill.paidAt !== null) {
    return PAID;
  }
  // compareIsoDates äger både jämförelsen och frågan "är det här ett datum", och
  // kastar med sitt eget namn i meddelandet för ett dueDate eller ett today som
  // inte är ett datum. En andra kopia av villkoret här vore två facit för samma
  // fråga (LARDOMAR.md 2026-09-02).
  if (compareIsoDates(bill.dueDate, today) < 0) {
    return OVERDUE;
  }
  if (daysUntilDue(bill.dueDate, today) <= bill.remindDays) {
    return REMINDER;
  }
  return UPCOMING;
}

// Antal dagar från today till förfallodagen. Enda stället i projektet som
// räknar fram en räknings daysUntil, och det gör det genom daysBetween i
// dates.js — ingen egen subtraktion av datum.
//
// Negativt för en räkning som förfallit: dagarna som gått sedan förfallodagen är
// daysUntil med omvänt tecken, och dagtexten i gränssnittet läser just det.
export function daysUntilDue(dueDate, today) {
  return daysBetween(today, dueDate);
}

// Nästa förfallodag för en återkommande räkning som just betalades.
//
// Framflyttningen går genom nextDueDate i schedule.js, som äger både
// periodräkningen och klampningen för den 29-31. Den här funktionen räknar
// ingenting själv; den avgör bara VILKEN fråga nextDueDate ska svara på.
//
// Serien får anchorDate som startDate — aldrig dueDate. anchorDate är den
// ursprungliga förfallodagen, intervallets fas, och den ändras inte av en
// betalning (ARKITEKTUR.md, "Klampningen ska inte fastna — en ankardag
// bevaras"). Därmed gäller "klampningen smittar inte vidare" i schedule.js
// också här: en månadsräkning med anchorDate 2026-01-31 ger serien
// 2026-01-31 -> 2026-02-28 -> 2026-03-31 -> 2026-04-30 -> 2026-05-31, och
// februari drar inte med sig resten av året till den 28:e.
//
// Mutationen series.startDate: bill.anchorDate -> bill.dueDate ger EXIT=1 och
// faller nextBillDueDate bevarar ursprungsdagen genom en hel serie betalningar
// i tests/bill.test.js samt (R4) klampningen fastnar inte: ursprungsdagen
// bevaras genom hela serien i tests/bills.test.js.
//
// Frågan ställs från den senare av två dagar:
//   - afterPaid, en hel period efter den gamla förfallodagen. Den dragning som
//     just betalades får inte kunna bli svaret igen, så en betalning i tid eller
//     i förväg ska alltid flytta raden ett steg.
//   - today, när betalningen är så sen att afterPaid redan har passerat. Då är
//     det nextDueDate:s hopp över flera perioder som ger svaret, och raden blir
//     den första dragningen som ligger framåt i stället för en dragning
//     användaren aldrig kommer att betala.
//
// Båda leden är körda i tests/bill.test.js, och båda bär en mutation var:
// skrivs valet om till enbart afterPaid faller fallet med den sena betalningen,
// och skrivs nextDueDate-anropet om till enbart from faller samma fall.
export function nextBillDueDate(bill, today) {
  if (!isPlainObject(bill)) {
    throw new RangeError('nextBillDueDate kräver en räkning som objekt.');
  }
  // Object.hasOwn och inte ett sanningsprövat uppslag: ett interval som heter
  // 'constructor' hittar annars något på prototypen, och ett okänt interval ger
  // undefined rakt in i addMonthsClamped (samma skäl som i nextDueDate).
  // null hör också hit: en engångsräkning har ingen nästa dragning, och den
  // frågan ska ställas av anroparen innan den anropar.
  if (!Object.hasOwn(MONTHS_PER_PERIOD, bill.interval)) {
    throw new RangeError(`nextBillDueDate kräver ett känt interval, fick "${String(bill.interval)}".`);
  }
  const series = { interval: bill.interval, startDate: bill.anchorDate };
  const afterPaid = addMonthsClamped(bill.dueDate, MONTHS_PER_PERIOD[bill.interval]);
  const from = compareIsoDates(today, afterPaid) > 0 ? today : afterPaid;
  return nextDueDate(series, from);
}

// Räkningens fem fält från användaren, validerade och beloppet omräknat till
// ören. Svaret är { ok: true, value } eller { ok: false, errors }, samma form som
// validateMonthItemDraft och validateBudgetDraft i src/core/item.js.
//
// Fältordningen i errors är bindande och följer formuläret: name, amountSek,
// dueDate, interval, remindDays. Alla fem prövas, aldrig bara det första — ett
// formulär med fem fel ska visa fem meddelanden samtidigt.
//
// Tre av fälten har redan en ägare i entry.js — checkName, checkAmountSek och
// (för värdelistan) checkInterval — och de anropas härifrån i stället för att
// skrivas av. dueDate och remindDays äger den här modulen.
//
// value bär amountOre och aldrig kronor: sekToOre är enda stället i projektet där
// ett kronbelopp blir öre. value bär alltid interval och remindDays, också när
// användaren lämnat dem tomma — interval som null, remindDays som
// REMIND_DAYS_DEFAULT. Två former av samma value hade tvingat varje anropare att
// fråga vilken av dem den fick.
export function validateBillDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    // Kastar inte här: checkAmountSek har redan avvisat allt som inte är ett
    // finit tal, och dess fjärde steg kräver att det avrundade värdet är minst
    // ett öre — alltså precis vad schemats CHECK (amount_ore > 0) kräver.
    value.amountOre = sekToOre(amount.value);
  }

  const dueDate = checkDueDate(source.dueDate);
  if (dueDate.message) {
    errors.push({ field: 'dueDate', message: dueDate.message });
  } else {
    value.dueDate = dueDate.value;
  }

  const interval = checkBillInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const remindDays = checkRemindDays(source.remindDays);
  if (remindDays.message) {
    errors.push({ field: 'remindDays', message: remindDays.message });
  } else {
    value.remindDays = remindDays.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Förfallodagen. Obligatorisk: en räkning utan förfallodag svarar inte på frågan
// "när ska den betalas", och det är hela räkningens skäl att finnas. Tomt är
// alltså ett fel och inte ett null, till skillnad från occurredOn i item.js.
//
// Giltigheten ägs av isValidIsoDate i dates.js, som prövar både formatet och att
// datumet finns — '2026-02-30' matchar mönstret utan att vara ett datum. En enda
// text för alla tre felen (saknas, fel format, finns inte), av samma skäl som
// checkOccurredOn har en: isValidIsoDate avgör format och giltighet i samma
// fråga, så en andra text hade krävt en andra kontroll att hålla i takt med den.
//
// Ingen årsgräns prövas. checkStartDate i entry.js har en, därför att ett
// startdatum styr en oändlig serie av dragningar; en förfallodag är en dag, och
// en återkommande räkning flyttas ett steg i taget — ett år utanför kalendern
// avvisas av toIsoDate när steget räknas, med toIsoDates eget meddelande.
function checkDueDate(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.dueDate };
  }
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.dueDate };
  }
  return { value: trimmed };
}

// Räkningens intervall, eller null för en engångsräkning.
//
// Tomt betyder Engångs: fältet är valfritt, och ett formulär som väljer Engångs
// skickar antingen ingen nyckel alls, null eller den tomma strängen. Alla tre ger
// samma svar, null, precis som checkOccurredOn och checkNote i item.js gör för
// sina fält.
//
// Värdelistan skrivs inte av: checkInterval i entry.js äger frågan "är det här
// ett känt intervall", och ett fel där ger den här modulens text i stället för
// checkIntervals, som inte räknar upp Engångs.
function checkBillInterval(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.interval };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  const result = checkInterval(trimmed);
  if (result.message) {
    return { message: MESSAGES.interval };
  }
  return { value: result.value };
}

// Hur många dagar innan förfallodagen påminnelsen visas. Tomt ger förvalet, så
// att ett formulär som inte rör fältet sparar samma tal som schemats DEFAULT.
//
// Fältet kommer in som en sträng från formuläret och som ett tal från kod, och
// båda vägarna normaliseras till ett tal innan en enda ordnad regelkedja körs —
// samma värde ska ge samma meddelande oavsett ingångstyp (LARDOMAR.md
// 2026-08-18). Mönstret är tillåtande nog att varje tal når intervallkontrollen:
// '31' avvisas av gränsen och inte av formatet, precis som AMOUNT_PATTERN i
// entry.js är tillåtande för att '10000000' ska nå maxgränsen.
//
// Number.isInteger coercar inte: 1n och Symbol('x') ger false i stället för att
// kasta TypeError från jämförelsen, och NaN, Infinity och 2.5 avvisas här i
// stället för att bli ett ogiltigt remind_days i databasen.
function checkRemindDays(raw) {
  if (raw === undefined || raw === null) {
    return { value: REMIND_DAYS_DEFAULT };
  }
  let days = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { value: REMIND_DAYS_DEFAULT };
    }
    // Snabbväg av samma slag som längdspärren i checkName: Number('1'.repeat(1e7))
    // läser hela strängen för att svara, och svaret är ändå ett fel. Fyra tecken
    // räcker för varje tal gränsen släpper igenom.
    if (trimmed.length > 4 || !/^-?\d{1,3}$/.test(trimmed)) {
      return { message: MESSAGES.remindDays };
    }
    days = Number(trimmed);
  }
  if (!isValidRemindDays(days)) {
    return { message: MESSAGES.remindDays };
  }
  return { value: days };
}

// Enda definitionen i projektet av villkoret "detta är ett giltigt remind_days".
// Två anropare: checkRemindDays ovan och ingångsspärren i billStatus, som läser
// talet ur databasen. En andra handskriven kopia är just det ägarregeln förbjuder.
//
// Medvetet ingen feltyp: funktionen avgör en tillhörighet och svarar false för
// varje värde som inte är ett heltal i intervallet, också 1n och Symbol('x') —
// Number.isInteger kastar för ingen indata.
function isValidRemindDays(value) {
  return Number.isInteger(value) && value >= REMIND_DAYS_MIN && value <= REMIND_DAYS_MAX;
}

// Villkoret "paidAt är satt eller tydligt osatt". Kolumnen bär en tidsstämpel
// eller NULL, så allt annat är ett programmeringsfel. Den tomma strängen räknas
// inte som satt: en rad med paid_at = '' hade annars blivit betald utan att bära
// någon tidpunkt.
function isValidBillPaidAt(value) {
  return value === null || (typeof value === 'string' && value.trim() !== '');
}
