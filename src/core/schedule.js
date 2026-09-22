// Nästa dragningsdatum och listan över kommande dragningar.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
//
// Nästa dragning lagras inte. Den räknas fram ur interval + startDate + dagens
// datum, varje gång den visas.
//
// Klockan läses inte här. Dagens datum kommer in som parameter; enda
// klockläsningen i projektet är todayIso() i dates.js.
//
// Beloppen är cost.js domän och läses inte av någon funktion i den här filen:
// en post med negativt amountSek ger samma dragningsdatum som en med positivt,
// och det är avsiktligt. Ingen exporterad funktion här får returnera NaN eller
// -0 för någon indata; den kastar RangeError i stället.

import { addMonthsClamped, compareIsoDates, daysBetween, parseIsoDate } from './dates.js';
// Ägarna till "är det här ett vanligt objekt" respektive "är det här ett giltigt
// id". Villkoren skrivs inte av här. Beroendet är riktat och cykelfritt:
// entry.js importerar bara dates.js och money.js.
import { isPlainObject, isValidEntryId } from './entry.js';

// Ägs av den här modulen: hur många månader en period omfattar. INTERVALS i
// entry.js är listan över tillåtna värden, PAYMENTS_PER_YEAR i cost.js är
// normaliseringsfaktorn, och den här tabellen är periodlängden. yearly skrivs
// som 12 och inte som MONTHS_PER_YEAR från cost.js: talen är lika, rollerna
// olika, och schedule.js importerar ingenting från cost.js.
// Fryst: en importör som skriver om ett värde skulle annars flytta varje
// dragningsdatum i appen utan att någon fil visar det.
export const MONTHS_PER_PERIOD = Object.freeze({
  monthly: 1,
  quarterly: 3,
  yearly: 12
});

// Talet 12 i rollen "antal månader per år", basen i monthIndex(year, month) =
// year * 12 + (month - 1). Samma roll som MONTHS_PER_YEAR i cost.js, men den
// konstanten går inte att läsa härifrån: schedule.js importerar ingenting från
// cost.js. Konstanten är därför modullokal och exporteras inte.
// MONTHS_PER_PERIOD.yearly ovan bär samma siffra men svarar på en annan fråga
// och skrivs inte som uttryck i den här.
const MONTHS_PER_YEAR = 12;

// Nästa dragning: idag eller senare, aldrig tidigare. Äger hela indatakedjan för
// modulen; första träff vinner.
//
// addMonths är funktionen som utför occurrence-steget, injicerad med
// addMonthsClamped som förval — samma form som todayIso(now = new Date()) och
// createEntry(draft, makeId). Skälet är att kravet "inget varv-för-varv-räknande
// från 1970" handlar om arbete och inte om ett värde: de två varianterna ger
// samma svar för varje indata, så bara antalet anrop av addMonths kan skilja
// dem åt. Punkt (S3) i tests/schedule.test.js räknar dem.
export function nextDueDate(entry, todayIsoDate, addMonths = addMonthsClamped) {
  if (!isPlainObject(entry)) {
    throw new RangeError('nextDueDate kräver en post som objekt.');
  }
  // Object.hasOwn, inte ett sanningsprövat uppslag: annars hittar
  // interval: 'constructor' något på prototypen, och ett okänt interval ger
  // undefined rakt in i multiplikationen, alltså NaN i stället för ett fel.
  // Värdet skrivs in i meddelandet via String() — ${Symbol('x')} kastar
  // TypeError, medan String(Symbol('x')) ger 'Symbol(x)'.
  if (!Object.hasOwn(MONTHS_PER_PERIOD, entry.interval)) {
    throw new RangeError(`nextDueDate kräver ett känt interval, fick "${String(entry.interval)}".`);
  }
  const start = parseIsoDate(entry.startDate);
  if (start === null) {
    throw new RangeError(`nextDueDate kräver ett startDate på formen ÅÅÅÅ-MM-DD, fick "${String(entry.startDate)}".`);
  }
  const today = parseIsoDate(todayIsoDate);
  if (today === null) {
    throw new RangeError(`nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(todayIsoDate)}".`);
  }
  // Raden står sist i kedjan, efter de fyra som fanns före den, så att de fyra
  // behåller sitt företräde. Placeringen skrivs som den indata där den ändrar
  // svaret: nextDueDate(5, '2026-09-14', null) ger härmed
  // "nextDueDate kräver en post som objekt." och med raden först i stället
  // parameterns meddelande. Det är ett testfall, inte bara den här kommentaren.
  // typeof-kontrollen, inte ett anrop på försök: 1n och Symbol('x') kastar
  // TypeError i en aritmetik eller ett anrop, aldrig RangeError.
  if (typeof addMonths !== 'function') {
    throw new RangeError(`nextDueDate kräver att addMonths är en funktion, fick "${String(addMonths)}".`);
  }
  const step = MONTHS_PER_PERIOD[entry.interval];
  const diff = monthIndex(today) - monthIndex(start);
  // Math.max(0, ...) håller kvar k på 0 för en post som startar i framtiden:
  // nästa dragning är då startdatumet självt. Utan den skulle Math.floor av ett
  // negativt diff ge ett negativt k och en dragning före startdatumet.
  let k = Math.max(0, Math.floor(diff / step));
  // Båda occurrence-stegen går genom addMonths — det här och det i loopkroppen.
  // Det är loopkroppen som bär detektorn i (S3): taket (anrop <= 3) kan bara
  // fällas av fler anrop, aldrig av färre, så ett steg som slutar gå genom
  // parametern är osynligt för ett tak. Undre gränsen i (S3):s andra fall, på en
  // post vars korrigeringsloop kör ett varv, fäller båda stegen:
  // mutation: loopkroppens addMonths(entry.startDate, k * step) ->
  //   addMonthsClamped(entry.startDate, k * step) ger EXIT=1, faller
  //   nextDueDate hoppar till rätt period i stället för att räkna varv för varv
  // mutation: det här stegets addMonths(entry.startDate, k * step) ->
  //   addMonthsClamped(entry.startDate, k * step) ger EXIT=1, faller samma fall
  let occurrence = addMonths(entry.startDate, k * step);
  // Steg 2 hoppar till rätt trakt, den här loopen justerar. Termineringen vilar
  // på att occurrence växer med minst 28 dagar per varv, och den storheten är en
  // egenskap hos förvalet addMonthsClamped — inte hos varje värde parametern kan
  // bära. Med förvalet kör loopen i praktiken högst 2-3 varv. Den skillnaden
  // bevakas inte; se "Parameterns kontrakt" i ARKITEKTUR.md.
  // Klampningen räknas om från startDate varje varv och aldrig från föregående
  // occurrence.
  //
  // Returvärdet från addMonths får ingen egen spärr här: compareIsoDates i
  // dates.js äger frågan "är det här ett datum" och kastar RangeError med sitt
  // eget namn. En andra kopia av villkoret vore samma fel som cost.js egen,
  // svagare kopia av "är detta ett objekt" (LARDOMAR.md 2026-09-02).
  while (compareIsoDates(occurrence, todayIsoDate) < 0) {
    k += 1;
    occurrence = addMonths(entry.startDate, k * step);
  }
  return occurrence;
}

// Alla posters nästa dragning, sorterad stigande på datum. Vid samma datum
// avgör name med localeCompare(b.name, 'sv'), och vid samma namn id med vanlig
// strängjämförelse. Ordningen är därmed oberoende av inmatningsordningen.
export function upcoming(entries, todayIsoDate) {
  // Utan Array.isArray itererar upcoming('abc') över strängens tecken.
  if (!Array.isArray(entries)) {
    throw new RangeError('upcoming kräver en lista med poster.');
  }
  const items = entries.map((entry) => {
    const due = nextDueDate(entry, todayIsoDate);
    // name och id läses av sorteringen nedan och prövas därför här, för varje
    // post och inte bara när två datum råkar vara lika: annars beror svaret på
    // om en oduglig post hamnade bredvid en post med samma datum.
    // localeCompare på något annat än en sträng kastar TypeError.
    if (typeof entry.name !== 'string') {
      throw new RangeError(`upcoming kräver ett name som sträng, fick "${String(entry.name)}".`);
    }
    if (!isValidEntryId(entry.id)) {
      throw new RangeError(`upcoming kräver ett id som är en icke-tom sträng, fick "${String(entry.id)}".`);
    }
    return { entry, nextDueDate: due, daysUntil: daysBetween(todayIsoDate, due) };
  });
  return items.sort(compareUpcoming);
}

// Jämföraren upcoming sorterar med. Exporterad för att (S5) ska kunna asserta
// svaret 0 för två items som är lika på varje nyckel: sista raden nedan är
// modulens enda rad utan täckning, och en sorterad lista kan inte skilja 0 från
// 1 utan att luta sig mot hur körmiljöns sortering behandlar en jämförare som
// inte är reflexiv (LARDOMAR.md 2026-09-22). Exporten är ingen väg in i modulen
// för någon annan: upcoming bestämmer ordningen.
export function compareUpcoming(a, b) {
  const byDate = compareIsoDates(a.nextDueDate, b.nextDueDate);
  if (byDate !== 0) {
    return byDate;
  }
  const byName = a.entry.name.localeCompare(b.entry.name, 'sv');
  if (byName !== 0) {
    return byName;
  }
  if (a.entry.id < b.entry.id) {
    return -1;
  }
  if (a.entry.id > b.entry.id) {
    return 1;
  }
  return 0;
}

function monthIndex(parts) {
  return parts.year * MONTHS_PER_YEAR + (parts.month - 1);
}
