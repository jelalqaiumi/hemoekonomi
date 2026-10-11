// Datalagret för rapporten [steg 5]: uppdelningen bakom månadssummorna, en rad
// per (kind, category), över en serie månader.
// Ligger i src/server/ och får därför importera node:-moduler, men behöver
// ingen.
//
// Två namn för två skilda ansvar (ARKITEKTUR.md, "Ingångsspärrar i
// src/core/report.js"): readReport här är den funktion som läser databasen,
// reportRows i src/core/report.js är den rena formen och körs i webbläsaren.
//
// Ingen egen SELECT. Varje månad läses genom readMonth i months.js, som redan
// bär user_id = ? på varje fråga, och som är den enda ägaren till frågan vad en
// månad innehåller: mallar, intervallträffar, avvikelser, engångsposter och
// budgetarnas tak. En andra väg till samma rader hade kunnat glida isär från
// månadsvyn utan att något test märker det.
//
// DatabaseSync är synkron, och funktionen är det också.
//
// Ingen klocka läses: en rapport är historik, och endMonth kommer från
// anroparen (ARKITEKTUR.md, "Vad readReport svarar").
import { isValidIsoMonth, shiftMonth } from '../core/dates.js';
import { reportRows } from '../core/report.js';
import { getDatabase } from './db.js';
import { OVERVIEW_MAX_MONTHS, OVERVIEW_MIN_MONTHS, readMonth } from './months.js';

// Rapporten för count månader som slutar med endMonth, äldst först. Svaret är
// reportRows svar oförändrat: { months, rows, largest }.
//
// Spärrtabellen "Ingångsspärrar i src/server/reports.js" i ARKITEKTUR.md har två
// rader, och de står nedan i tabellens ordning. reportRows nio rader ärvs genom
// anropet och kopieras inte: funktionen skriver ingen egen kontroll av items,
// budgets, månadsordningen eller budgetradernas form, eftersom en andra kopia
// hade varit två facit (LARDOMAR.md 2026-09-02).
export function readReport(userId, endMonth, count, { db = getDatabase() } = {}) {
  // Rad 1. isValidIsoMonth i src/core/dates.js äger frågan. Prövas före varje
  // fråga mot databasen: en ogiltig månad ska aldrig bli en SQL-fråga. Värdet
  // går genom String() i meddelandet: `${Symbol('x')}` kastar TypeError.
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(`readReport kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".`);
  }
  // Rad 2. Samma tak och samma meddelandeform som readOverview rad 2, vilket är
  // vad (RA17) kräver. Talen läses ur months.js och står aldrig skrivna här.
  //
  // Number.isInteger coercar inte: 1n och Symbol('x') ger false i stället för
  // att kasta TypeError ur jämförelsen, och NaN, Infinity och 12.5 avvisas här i
  // stället för att bli ett antal varv i loopen nedan.
  if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {
    throw new RangeError(`readReport kräver ett antal månader mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}, fick "${String(count)}".`);
  }

  // Ett element per månad, äldst först: reportRows rad 7 kräver stigande
  // ordning, och perMonthOre:s index ÄR månaden. shiftMonth i dates.js äger
  // månadsräkningen, precis som i readOverview.
  //
  // En tom månad utelämnas inte. readMonth svarar med tomma listor för en månad
  // utan poster, och elementet skrivs som varje annat — annars hade serien fått
  // en lucka, och averageOre delas med antalet månader (beslut 2).
  const monthsData = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    const { items, budgets } = readMonth(userId, month, { db });
    monthsData.push({ month, items, budgets });
  }

  return reportRows(monthsData);
}
