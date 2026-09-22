// Den frusna dagen som src/web/app.js får i stället för klockan i
// src/core/dates.js.
//
// Laddaren i tests/helpers/dom.js pekar om app.js:s egen import av
// /core/dates.js hit, på samma sätt som den redan pekar om varje annan
// /core/-import, och sätter dagen innan modulen importeras. Filen läser ingen
// klocka alls: den lämnar tillbaka den sträng laddaren satt senast
// (ARKITEKTUR.md, "Klockan som app.js läser är injicerad, inte verklig").
//
// Attrappen är sträng, samma regel som för DOM-attrappen: ett uppslag utan satt
// värde ger ett kast och aldrig undefined. En stub som svarar undefined skulle
// låta app.js gå sönder tyst, och då mäter testet ingenting.
//
// Ägaren till frågan "är det här en dag" är isValidIsoDate i src/core/dates.js,
// och valet är inte fritt. ISO_DATE_PATTERN äger frågan "rätt form" och säger
// true om 2026-02-30; isValidIsoDate äger frågan "finns i kalendern" och säger
// false. Det senare är vad spärren nedan lovar ett svar på: med mönstret ensamt
// tar sig 2026-02-30 förbi laddaren och faller först i src/core/schedule.js,
// med RangeError: nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD,
// fick "2026-02-30". — långt från laddaren och med fel orsak utpekad. Ingen
// handskriven kopia av villkoret här (LARDOMAR.md 2026-09-02, cost.js har en
// egen, svagare kopia av "är detta ett objekt").
import { isValidIsoDate } from '../../src/core/dates.js';

let frusenDag = null;

// Den export app.js når genom laddarens ompekning. Namnet är app.js:s
// importnamn och ingenting annat.
//
// Kastet nedan har med flit inget testfall, till skillnad från sättarens
// formkontroll, som har punkt (32). Skälet står i ARKITEKTUR.md under
// "Stubbens spärrar, och varför bara den ena får ett testfall": grenen är
// nåbar — en laddare som importerar app.js utan att sätta dagen når den, och
// byggarens körning har gjort just det — men den indatan går inte att skriva i
// tests/app.test.js, eftersom enda vägen dit är att anropa funktionen här från
// testfilen, och varje sådan väg är en träff i klockkontrollen. Grenen står
// alltså kvar som diagnostik: utan den byter ett glömt sättande ut det svenska
// beskedet nedan mot ett fel längre in i src/core/. Avsaknaden av testfall är
// ett beslut och inte ett förbiseende.
export function todayIso() {
  if (frusenDag === null) {
    throw new Error(
      'frozen-dates: ingen dag är satt — laddaren ska sätta dagen innan src/web/app.js importeras.'
    );
  }
  return frusenDag;
}

// Sättaren laddaren använder. Kastar för varje värde isValidIsoDate svarar
// false på, så att ett felskrivet argument fälls här och inte långt inne i
// schedule.js.
//
// Villkoret står ensamt, utan en typkontroll bredvid: isValidIsoDate svarar
// false för varje värde som inte är en sträng, så en andra kontroll vore en
// gren ingen indata når. String(day) i meddelandet och inte värdet rakt in i
// mallsträngen — ${Symbol('x')} kastar TypeError.
export function setFrozenDay(day) {
  if (!isValidIsoDate(day)) {
    throw new Error(
      `frozen-dates kräver ett datum som finns i kalendern på formen ÅÅÅÅ-MM-DD, fick "${String(day)}".`
    );
  }
  frusenDag = day;
}

// Laddarens återställning. Anropet tar en ögonblicksbild av det som är satt nu
// och lämnar tillbaka en funktion som lägger tillbaka precis det — också läget
// "ingen dag satt", som är utgångsläget för varje testfall.
//
// Återställningen är sann bara under krav 8 i ARKITEKTUR.md: högst ett loadApp
// per testfall, alltså högst en hook. node:test kör after-hookar i
// registreringsordning, så två hookar i samma test ger den sist registrerade
// sista ordet — och den lägger tillbaka en ögonblicksbild som redan var det
// första anropets värde. Laddaren avvisar därför ett andra loadApp, och punkt
// (33) i tests/app.test.js skyddar den avvisningen.
//
// Formen är vald för att laddarens after-hook ska bli en enda sats utan gren,
// på samma form som globalThis.document = tidigareDocument. En if/else över
// "var det satt eller inte" mättes med instrumentering och kördes 31 gånger i
// den ena grenen och 0 i den andra; en gren som ingen indata når är ingen
// återställning utan en osann uppgift om vad koden hanterar (LARDOMAR.md
// 2026-09-04). Det tidigare värdet kan dessutom bara komma ur modulen själv,
// så återställningen kan inte smuggla in en dag som sättaren nedan skulle ha
// avvisat.
export function snapshotFrozenDay() {
  const tidigare = frusenDag;
  return () => {
    frusenDag = tidigare;
  };
}
