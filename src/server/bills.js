// Datalagret för räkningarna: tabellen bills [steg 3].
// Ligger i src/server/ och får därför importera node:-moduler.
//
// DatabaseSync är synkron. Ingen funktion i den här filen är async och ingen
// anropare ska await:a den.
//
// Varje funktion tar userId som FÖRSTA argument, och varje WHERE bär
// user_id = ?. En funktion utan det är ett fel även om den fungerar, eftersom
// nästa användare av modulen då ärver hålet. En räkning som tillhör någon annan
// ska bete sig som om den inte finns: updateBill, markBillPaid och removeBill
// mot ett id som ägs av någon annan svarar precis som mot ett id som inte
// existerar, aldrig med ett fel som avslöjar att raden finns. Skälet är detsamma
// som i src/server/months.js, och ytterst detsamma som att inloggningen inte
// avslöjar om en e-postadress har konto.
//
// Modulen räknar ingenting själv. Statusen kommer ur billStatus i
// src/core/bill.js, dagsskillnaden ur daysUntilDue i samma fil, framflyttningen
// ur nextBillDueDate där — som i sin tur går genom nextDueDate i
// src/core/schedule.js. Ingen SQL räknar datum, och ingen rad här klampar en
// månad eller drar två datum från varandra.
//
// Ingen klocka läses här: today är ett argument på varje väg som behöver dagens
// datum, och tidsstämpeln kommer in som now med nowIso() som förval. Samma skäl
// som i months.js och schedule.js — en funktion som läser klockan går inte att
// testa.
import crypto from 'node:crypto';

import { billStatus, daysUntilDue, nextBillDueDate } from '../core/bill.js';
import { compareIsoDates, isValidIsoDate, nowIso } from '../core/dates.js';
import { getDatabase, readRows, transaction, write } from './db.js';

// Namnordningen i steg 2 av sorteringskedjan. Språket står utskrivet och hämtas
// aldrig ur körmiljön: utan 'sv' sorteras Å före Z för en svensk användare men
// efter för en engelsk (LARDOMAR.md 2026-09-12). Samma konstant som months.js
// har, av samma skäl och med samma språk.
const NAME_COLLATOR = new Intl.Collator('sv');

// Kolumnlistan står en gång per fråga och aldrig som SELECT *: en ny kolumn ska
// inte kunna hamna i svaret utan att toBill nedan har fått en rad för den.
const BILL_COLUMNS = 'id, name, amount_ore, due_date, interval, remind_days, paid_at';

const SQL_BILLS = `
SELECT ${BILL_COLUMNS}
  FROM bills
 WHERE user_id = ?`;

const SQL_BILL_BY_ID = `
SELECT ${BILL_COLUMNS}
  FROM bills
 WHERE user_id = ?
   AND id = ?`;

// De tre fälten framflyttningen frågar om. anchor_date står inte i
// BILL_COLUMNS, eftersom den inte ingår i svaret till gränssnittet: vyn visar
// due_date, och ankardagen är intervallets fas och ingenting användaren läser.
// ARKITEKTUR.md:s "Svarskropparna godkänns" räknar upp sju respektive nio fält,
// och de talen står kvar.
const SQL_BILL_SERIES_BY_ID = `
SELECT interval, due_date, anchor_date
  FROM bills
 WHERE user_id = ?
   AND id = ?`;

// anchor_date skrivs med samma värde som due_date när räkningen skapas: den
// första förfallodagen ÄR seriens ursprungliga dag.
const SQL_INSERT_BILL = `
INSERT INTO bills
  (id, user_id, name, amount_ore, due_date, anchor_date, interval, remind_days, paid_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`;

// anchor_date skrivs om här och bara här. Att användaren själv ändrar
// förfallodagen är det enda som flyttar seriens fas; en betalning gör det
// aldrig (ARKITEKTUR.md, "Klampningen ska inte fastna — en ankardag bevaras").
const SQL_UPDATE_BILL = `
UPDATE bills
   SET name = ?, amount_ore = ?, due_date = ?, anchor_date = ?, interval = ?, remind_days = ?
 WHERE user_id = ?
   AND id = ?`;

// De två skrivningarna "betald". En engångsräkning behåller sitt due_date och
// får en tidsstämpel; en återkommande får ett nytt due_date och paid_at = NULL.
// Två satser och inte en med CASE: vilken av de två som gäller avgörs av
// interval, och den frågan ställs av markBillPaid nedan i JavaScript, där den
// går att läsa.
const SQL_MARK_BILL_PAID = `
UPDATE bills
   SET paid_at = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_MOVE_BILL_FORWARD = `
UPDATE bills
   SET due_date = ?, paid_at = NULL
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_BILL = `
DELETE FROM bills
 WHERE user_id = ?
   AND id = ?`;

// Användarens räkningar med daysUntil och status, sorterade.
//
// Svaret är listan ARKITEKTUR.md skriver ut under "Vad readBills svarar":
// { id, name, amountOre, dueDate, interval, remindDays, paidAt, daysUntil,
// status } per rad. Ingen filtrering: också en betald engångsräkning kommer med,
// med status betald, och det är gränssnittet som avgör vilka rader kortet visar.
// Ett datalager som sållar bort rader gör det omöjligt för en anropare att veta
// vad som finns.
//
// today är ett argument. Ingen funktion i datalagret läser klockan.
export function readBills(userId, today, { db = getDatabase() } = {}) {
  requireToday('readBills', today);
  return readRows(db, SQL_BILLS, [userId])
    .map((row) => toBillView(row, today))
    .sort(compareBills);
}

// En ny räkning. Svaret är den skapade räkningen, på samma form som toBill ger.
//
// Fälten prövas inte om här. Kedjan är densamma som för månadsposten:
// validateBillDraft i src/core/bill.js och API-lagret avgör vad användaren får
// för svar, och schemats CHECK är sista utposten mot ett programmeringsmisstag —
// ett brutet CHECK blir "Uppgifterna kunde inte sparas: något värde är ogiltigt."
// En andra beloppsvalidering eller en andra kopia av gränsen för remind_days här
// vore två facit för samma fråga.
//
// paid_at skrivs som NULL i SQL-texten och inte som en parameter: en räkning som
// skapas är obetald, och det är ingen uppgift anroparen får bestämma.
export function addBill(userId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  const id = makeId();
  write(db, SQL_INSERT_BILL, [
    id,
    userId,
    draft?.name,
    draft?.amountOre,
    draft?.dueDate,
    draft?.dueDate,
    // ?? null av samma skäl som toMonth i months.js: ett utkast utan fältet ska
    // skriva NULL och inte undefined, som node:sqlite inte kan binda. En
    // engångsräkning har interval = null, och det är det normala fallet här.
    draft?.interval ?? null,
    draft?.remindDays,
    now
  ]);
  // Läses tillbaka i stället för att sättas samman ur draft: det som svaret
  // beskriver är raden på disk, och den kan bära ett annat värde än draft om
  // schemat har normaliserat något.
  return findBill(db, userId, id);
}

// Ändrar en räkning. Svaret är den ändrade räkningen, eller null när den inte
// finns eller tillhör någon annan — samma svar i båda fallen.
//
// paid_at står inte i UPDATE-satsen. Att ändra en räknings namn eller belopp är
// inte att betala den eller att ta tillbaka en betalning, och ett fält som
// skrivs över av en väg som inte handlar om det är ett fält som tappas tyst.
//
// anchor_date står däremot där, och sätts till samma värde som due_date. Det är
// den enda vägen i appen som flyttar seriens fas: att användaren själv ändrar
// förfallodagen är ett nytt besked om vilken dag räkningen ska dras, medan en
// betalning bara flyttar raden ett steg i den fas som redan gäller.
//
// Ingen läsning före skrivningen, av samma skäl som updateMonthItem i months.js
// inte har någon: ett UPDATE mot ett id som ägs av någon annan matchar noll
// rader, och läsningen efteråt svarar då null ändå.
export function updateBill(userId, billId, draft, { db = getDatabase() } = {}) {
  write(db, SQL_UPDATE_BILL, [
    draft?.name,
    draft?.amountOre,
    draft?.dueDate,
    draft?.dueDate,
    draft?.interval ?? null,
    draft?.remindDays,
    userId,
    billId
  ]);
  return findBill(db, userId, billId);
}

// Markerar en räkning betald. Svaret är räkningen efteråt, eller null när den
// inte finns eller tillhör någon annan.
//
// De två fallen står i ARKITEKTUR.md under "Betald, och vad som händer sedan":
//
//   - En ENGÅNGSRÄKNING (interval är NULL) behåller sitt due_date och får
//     paid_at satt. Den faller därmed ur listan över kommande: status blir
//     betald, första raden i statustabellen.
//
//   - En ÅTERKOMMANDE räkning flyttas fram. due_date sätts till nästa dragning
//     och paid_at nollställs, så att raden är den nästa obetalda. Historiken
//     över betalda räkningar lagras inte (PLAN.md beslut 4).
//
// Nästa dragning räknas av nextBillDueDate i src/core/bill.js, som går genom
// nextDueDate i src/core/schedule.js — den äger både periodlängden och
// klampningen för den 29-31. Den här filen räknar inget datum.
//
// Läsningen och skrivningen ligger i samma transaktion: vilken av de två
// satserna som körs avgörs av den lästa raden, så en läs-ändra-skriv-sekvens mot
// användarens data ska vara ett steg och inte två (LARDOMAR.md 2026-09-07).
export function markBillPaid(userId, billId, today, { db = getDatabase(), now = nowIso() } = {}) {
  requireToday('markBillPaid', today);
  return transaction(db, () => {
    // Läses med anchor_date och inte genom findBill: framflyttningen frågar om
    // seriens fas, och den kolumnen ingår inte i svaret till gränssnittet.
    const rows = readRows(db, SQL_BILL_SERIES_BY_ID, [userId, billId]);
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    if (row.interval === null) {
      write(db, SQL_MARK_BILL_PAID, [now, userId, billId]);
    } else {
      const series = { interval: row.interval, dueDate: row.due_date, anchorDate: row.anchor_date };
      write(db, SQL_MOVE_BILL_FORWARD, [nextBillDueDate(series, today), userId, billId]);
    }
    return findBill(db, userId, billId);
  });
}

// true om något togs bort, false när räkningen inte finns eller tillhör någon
// annan. De två fallen ger samma svar med flit.
export function removeBill(userId, billId, { db = getDatabase() } = {}) {
  return write(db, SQL_DELETE_BILL, [userId, billId]).changes > 0;
}

function findBill(db, userId, billId) {
  const rows = readRows(db, SQL_BILL_BY_ID, [userId, billId]);
  return rows.length === 0 ? null : toBill(rows[0]);
}

// En rad ur bills som en räkning. Översättningen mellan SQL:s snake_case och
// kärnans camelCase sker här och ingen annanstans.
//
// Det här är formen skrivvägarna svarar med: addBill, updateBill och
// markBillPaid. Läsvägen svarar med toBillView nedan, som är samma sju fält plus
// daysUntil och status — de två fälten kräver ett today, och det har bara
// läsvägen och markBillPaid. Skillnaden står utskriven här för att ingen
// anropare ska behöva fråga vilken av formerna den fick.
function toBill(row) {
  return {
    id: row.id,
    name: row.name,
    amountOre: row.amount_ore,
    dueDate: row.due_date,
    interval: row.interval,
    remindDays: row.remind_days,
    paidAt: row.paid_at
  };
}

// Samma räkning med de två räknade fälten. Båda kommer ur src/core/bill.js:
// daysUntil ur daysUntilDue, som räknar med daysBetween i dates.js, och status
// ur billStatus, som äger statusordningen.
function toBillView(row, today) {
  const bill = toBill(row);
  return { ...bill, daysUntil: daysUntilDue(bill.dueDate, today), status: billStatus(bill, today) };
}

// Sorteringen ARKITEKTUR.md skriver ut: due_date, därefter namn i svensk
// ordning, därefter id — samma kedja som compareUpcoming i
// src/core/schedule.js redan använder. Sista ledet finns för att ordningen ska
// vara total: två räkningar med samma datum och samma namn ska komma i samma
// ordning vid varje läsning, annars hoppar de i vyn.
//
// Kedjan skrivs här och inte som ett anrop av compareUpcoming: den funktionen
// sorterar på nextDueDate i ett item med en entry inuti, alltså på en annan
// form och med en annan första nyckel. compareItems i months.js är i samma läge
// med sin kind-nyckel.
function compareBills(a, b) {
  const byDate = compareIsoDates(a.dueDate, b.dueDate);
  if (byDate !== 0) {
    return byDate;
  }
  const byName = NAME_COLLATOR.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

// Dagens datum prövas innan datalagret nås, på varje väg som tar emot det.
// isValidIsoDate i src/core/dates.js äger frågan, och den här filen skriver
// inget eget datummönster. API-lagret prövar detsamma innan det anropar hit, så
// den här raden fångar ett programmeringsfel och inte ett användarfel — samma
// förhållande som mellan handleReadMonth och requireMonth i months.js.
function requireToday(functionName, today) {
  if (!isValidIsoDate(today)) {
    throw new RangeError(`${functionName} kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
  }
}
