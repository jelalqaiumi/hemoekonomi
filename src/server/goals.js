// Datalagret för sparmålen: tabellerna goals och goal_deposits [steg 4].
// Ligger i src/server/ och får därför importera node:-moduler.
//
// DatabaseSync är synkron. Ingen funktion i den här filen är async och ingen
// anropare ska await:a den.
//
// Varje funktion tar userId som FÖRSTA argument, och varje WHERE bär
// user_id = ?. En funktion utan det är ett fel även om den fungerar, eftersom
// nästa användare av modulen då ärver hålet. Ett sparmål som tillhör någon annan
// ska bete sig som om det inte finns: updateGoal, removeGoal och addDeposit mot
// ett id som ägs av någon annan svarar precis som mot ett id som inte existerar,
// aldrig med ett fel som avslöjar att raden finns. Skälet är detsamma som i
// bills.js och months.js, och ytterst detsamma som att inloggningen inte avslöjar
// om en e-postadress har konto.
//
// Modulen räknar ingenting själv. De sex räknade fälten kommer ur goalProgress i
// src/core/goal.js, som i sin tur äger statusordningen, klippningen av percent och
// divisionen genom divideRoundHalfUp. Ingen SQL räknar procent, månader eller
// kvarvarande belopp — SUM över insättningarna är den enda aritmetik som står i
// en fråga, och den summerar ören.
//
// Ingen klocka läses här: today är ett argument på den väg som behöver dagens
// datum, och tidsstämpeln kommer in som now med nowIso() som förval. Samma skäl
// som i bills.js och months.js — en funktion som läser klockan går inte att testa.
import crypto from 'node:crypto';

import { nowIso } from '../core/dates.js';
import { goalProgress } from '../core/goal.js';
import { getDatabase, readRows, transaction, write } from './db.js';

// Namnordningen i sorteringen. Språket står utskrivet och hämtas aldrig ur
// körmiljön: utan 'sv' sorteras Å före Z för en svensk användare men efter för en
// engelsk (LARDOMAR.md 2026-09-12). Samma konstant som bills.js och months.js
// har, av samma skäl och med samma språk.
const NAME_COLLATOR = new Intl.Collator('sv');

// Kolumnlistan står en gång per fråga och aldrig som SELECT *: en ny kolumn ska
// inte kunna hamna i svaret utan att toGoal nedan har fått en rad för den.
const GOAL_COLUMNS = 'id, name, target_ore, target_date';

// Summan av insättningarna som en egen kolumn, med COALESCE: SUM över noll rader
// ger NULL i SQL, och savedOre ska vara 0 för ett mål utan insättningar.
// Underfrågan bär både goal_id och user_id, fastän goal_id ensamt räcker så länge
// varje insättning hör till sin ägares mål — raden är samma regel som varje annan
// WHERE i filen, och en underfråga utan den hade varit det enda undantaget.
const SAVED_ORE_COLUMN = `
  COALESCE((SELECT SUM(d.amount_ore)
              FROM goal_deposits d
             WHERE d.goal_id = g.id
               AND d.user_id = g.user_id), 0) AS saved_ore`;

const SQL_GOALS = `
SELECT g.id, g.name, g.target_ore, g.target_date,${SAVED_ORE_COLUMN}
  FROM goals g
 WHERE g.user_id = ?`;

const SQL_GOAL_BY_ID = `
SELECT ${GOAL_COLUMNS}
  FROM goals
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_GOAL = `
INSERT INTO goals
  (id, user_id, name, target_ore, target_date, created_at)
VALUES (?, ?, ?, ?, ?, ?)`;

const SQL_UPDATE_GOAL = `
UPDATE goals
   SET name = ?, target_ore = ?, target_date = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_GOAL = `
DELETE FROM goals
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_DEPOSIT = `
INSERT INTO goal_deposits
  (id, user_id, goal_id, amount_ore, made_on, created_at)
VALUES (?, ?, ?, ?, ?, ?)`;

// Användarens sparmål med de sex räknade fälten, sorterade.
//
// Svaret är listan ARKITEKTUR.md skriver ut under "Vad readGoals svarar":
// { id, name, targetOre, targetDate, savedOre, leftOre, percent, monthsLeft,
// perMonthOre, status } per rad. Ingen filtrering: också ett mål som är klart
// kommer med, med status klart, och det är gränssnittet som avgör vilka rader
// kortet visar. Ett datalager som sållar bort rader gör det omöjligt för en
// anropare att veta vad som finns.
//
// today är ett argument. Ingen funktion i datalagret läser klockan. Giltigheten
// prövas inte här utan av goalProgress i src/core/goal.js, som äger frågan och
// kastar med sitt eget namn i meddelandet; en andra kopia av villkoret vore två
// facit för samma fråga. API-lagret prövar detsamma innan det anropar hit, så en
// anropare som når kastet har gjort ett programmeringsfel.
export function readGoals(userId, today, { db = getDatabase() } = {}) {
  return readRows(db, SQL_GOALS, [userId])
    .map((row) => toGoalView(row, today))
    .sort(compareGoals);
}

// Ett nytt sparmål. Svaret är det skapade målet, på samma form som toGoal ger.
//
// Fälten prövas inte om här. Kedjan är densamma som för räkningen:
// validateGoalDraft i src/core/goal.js och API-lagret avgör vad användaren får för
// svar, och schemats CHECK är sista utposten mot ett programmeringsmisstag — ett
// brutet CHECK blir "Uppgifterna kunde inte sparas: något värde är ogiltigt."
export function addGoal(userId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  const id = makeId();
  write(db, SQL_INSERT_GOAL, [
    id,
    userId,
    draft?.name,
    draft?.targetOre,
    // ?? null av samma skäl som toMonth i months.js: ett utkast utan fältet ska
    // skriva NULL och inte undefined, som node:sqlite inte kan binda. Ett mål
    // utan slutdatum är ett normalt fall här.
    draft?.targetDate ?? null,
    now
  ]);
  // Läses tillbaka i stället för att sättas samman ur draft: det som svaret
  // beskriver är raden på disk, och den kan bära ett annat värde än draft om
  // schemat har normaliserat något.
  return findGoal(db, userId, id);
}

// Ändrar ett sparmål. Svaret är det ändrade målet, eller null när det inte finns
// eller tillhör någon annan — samma svar i båda fallen.
//
// Insättningarna rörs inte: att ändra ett måls namn, belopp eller slutdatum är
// inte att ändra vad som redan satts in. Ett höjt målbelopp sänker percent och
// höjer leftOre, och det är rätt — savedOre är ett faktum och inte en följd av
// målet.
//
// Ingen läsning före skrivningen, av samma skäl som updateBill i bills.js inte har
// någon: ett UPDATE mot ett id som ägs av någon annan matchar noll rader, och
// läsningen efteråt svarar då null ändå.
export function updateGoal(userId, goalId, draft, { db = getDatabase() } = {}) {
  write(db, SQL_UPDATE_GOAL, [
    draft?.name,
    draft?.targetOre,
    draft?.targetDate ?? null,
    userId,
    goalId
  ]);
  return findGoal(db, userId, goalId);
}

// true om något togs bort, false när målet inte finns eller tillhör någon annan.
// De två fallen ger samma svar med flit.
//
// Insättningarna försvinner med målet genom ON DELETE CASCADE på goal_id, och
// ingen DELETE mot goal_deposits står här: två satser hade gjort schemats regel
// till en kopia i JavaScript som kan glida isär. PRAGMA foreign_keys = ON sätts på
// varje anslutning i db.js, och utan den raden vore CASCADE bara en kommentar.
// Det är (S10).
export function removeGoal(userId, goalId, { db = getDatabase() } = {}) {
  return write(db, SQL_DELETE_GOAL, [userId, goalId]).changes > 0;
}

// En insättning på ett mål. Svaret är den skapade insättningen, eller null när
// målet inte finns eller tillhör någon annan.
//
// Målet läses FÖRE insättningen skrivs, och det är inte överflödigt: främmande
// nyckeln goal_id kräver bara att målet finns, inte att det är användarens. Utan
// läsningen hade ett anrop med någon annans goalId skapat en rad med vårt user_id
// på den andres mål — alltså en insättning användaren inte kan se men som ändrar
// den andres savedOre.
//
// Läsningen och skrivningen ligger i samma transaktion: om målet finns avgör om
// insättningen får skrivas, så en läs-ändra-skriv-sekvens mot användarens data ska
// vara ett steg och inte två (LARDOMAR.md 2026-09-07).
export function addDeposit(userId, goalId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  return transaction(db, () => {
    if (readRows(db, SQL_GOAL_BY_ID, [userId, goalId]).length === 0) {
      return null;
    }
    const id = makeId();
    write(db, SQL_INSERT_DEPOSIT, [
      id,
      userId,
      goalId,
      draft?.amountOre,
      draft?.madeOn,
      now
    ]);
    return { id, goalId, amountOre: draft?.amountOre, madeOn: draft?.madeOn };
  });
}

function findGoal(db, userId, goalId) {
  const rows = readRows(db, SQL_GOAL_BY_ID, [userId, goalId]);
  return rows.length === 0 ? null : toGoal(rows[0]);
}

// En rad ur goals som ett sparmål. Översättningen mellan SQL:s snake_case och
// kärnans camelCase sker här och ingen annanstans.
//
// Det här är formen skrivvägarna svarar med: addGoal och updateGoal. Läsvägen
// svarar med toGoalView nedan, som är samma fyra fält plus de sex räknade — de
// kräver ett today, och det har bara läsvägen. Skillnaden står utskriven här för
// att ingen anropare ska behöva fråga vilken av formerna den fick.
function toGoal(row) {
  return {
    id: row.id,
    name: row.name,
    targetOre: row.target_ore,
    targetDate: row.target_date
  };
}

// Samma mål med de sex räknade fälten. Alla sex kommer ur goalProgress i
// src/core/goal.js, som äger både statusordningen och klippningen av percent.
//
// savedOre kommer ur SQL:s SUM och skickas in i goalProgress, som returnerar det
// orört. Det går alltså genom kärnan och inte runt den: kärnans spärr prövar att
// summan är ett säkert heltal, och ett fält som satts samman här hade kringgått
// den prövningen.
function toGoalView(row, today) {
  const goal = toGoal(row);
  return { ...goal, ...goalProgress({ ...goal, savedOre: row.saved_ore }, today) };
}

// Sorteringen: namn i svensk ordning, därefter id.
//
// ARKITEKTUR.md skriver inte ut någon ordning för sparmålen, till skillnad från
// räkningarnas (due_date, namn, id). Namnet är den neutrala nyckeln: ett slutdatum
// är valfritt, så en ordning på det hade krävt ett eget beslut om var målen utan
// datum hamnar — och det beslutet är arkitektens. Se paketets redovisning.
//
// Sista ledet finns för att ordningen ska vara total: två mål med samma namn ska
// komma i samma ordning vid varje läsning, annars hoppar de i vyn. Samma kedja och
// samma skäl som compareBills i bills.js.
function compareGoals(a, b) {
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
