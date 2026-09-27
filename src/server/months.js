// Datalagret för en månads innehåll: mallarna i templates, avvikelserna i
// overrides och engångsposterna i month_items.
// Ligger i src/server/ och får därför importera node:-moduler.
//
// DatabaseSync är synkron. Ingen funktion i den här filen är async och ingen
// anropare ska await:a den.
//
// Varje funktion tar userId som FÖRSTA argument, och varje WHERE bär
// user_id = ?. En funktion utan det är ett fel även om den fungerar, eftersom
// nästa användare av modulen då ärver hålet. En post som tillhör någon annan ska
// bete sig som om den inte finns: updateMonthItem och removeMonthItem mot ett id
// som ägs av någon annan svarar precis som mot ett id som inte existerar, aldrig
// med ett fel som avslöjar att raden finns. Skälet är detsamma som att
// inloggningen inte avslöjar om en e-postadress har konto.
//
// Modulen räknar ingenting själv: summorna kommer ur monthTotals i
// src/core/budget.js, intervallogiken ur nextDueDate i src/core/schedule.js och
// månadsbegreppet ur src/core/dates.js. Ingen SQL räknar månader, och ingen rad
// här klipper en månad ur ett datum.
//
// Ingen klocka läses här: tidsstämpeln kommer in som now, med nowIso() som
// förval, av samma skäl som dagens datum injiceras i schedule.js — annars går en
// skriven created_at inte att testa.
import crypto from 'node:crypto';

import { monthTotals } from '../core/budget.js';
import { firstDayOfMonth, isValidIsoMonth, monthOfIsoDate, nowIso } from '../core/dates.js';
import { ITEM_KINDS } from '../core/item.js';
import { nextDueDate } from '../core/schedule.js';
import { getDatabase, readRows, write } from './db.js';

// Namnordningen i steg 5 av kedjan. Språket står utskrivet och hämtas aldrig ur
// körmiljön: i webbläsaren är standardspråket användarens webbläsarspråk, och
// utan 'sv' sorteras Å före Z för en svensk användare men efter för en engelsk
// (LARDOMAR.md 2026-09-12).
const NAME_COLLATOR = new Intl.Collator('sv');

// Steg 1: de mallar som är giltiga månaden M. Jämförelsen sker som text, vilket
// är korrekt just för ÅÅÅÅ-MM: både år och månad är nollutfyllda, så ordningen
// är densamma alfabetiskt som kronologiskt. Samma regel som compareMonths i
// dates.js vilar på, uttryckt en andra gång på ett annat språk — schemats CHECK
// och kärnans ägare svarar på olika frågor, precis som för kind och interval
// ("Två spärrar i två språk").
const SQL_TEMPLATES = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND from_month <= ?
   AND (to_month IS NULL OR to_month >= ?)`;

// Steg 3: månadens avvikelser. user_id står med utöver month, fastän
// template_id nedan bara kan matcha en mall som redan är användarens.
const SQL_OVERRIDES = `
SELECT template_id, amount_ore, skipped
  FROM overrides
 WHERE user_id = ?
   AND month = ?`;

// Steg 4: månadens engångsposter.
const SQL_MONTH_ITEMS = `
SELECT id, kind, name, amount_ore, category
  FROM month_items
 WHERE user_id = ?
   AND month = ?`;

const SQL_MONTH_ITEM_BY_ID = `
SELECT id, kind, name, amount_ore, category
  FROM month_items
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_MONTH_ITEM = `
INSERT INTO month_items (id, user_id, month, kind, name, amount_ore, category, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_UPDATE_MONTH_ITEM = `
UPDATE month_items
   SET kind = ?, name = ?, amount_ore = ?, category = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_MONTH_ITEM = `
DELETE FROM month_items
 WHERE user_id = ?
   AND id = ?`;

// En månads innehåll och summor. Kedjan står som pseudokod i ARKITEKTUR.md under
// "En månads innehåll — kedjan", och stegen nedan är numrerade efter den.
export function readMonth(userId, month, { db = getDatabase() } = {}) {
  // Månadens ägare avgör om månaden är en månad, före varje fråga: en ogiltig
  // månad ska aldrig bli en SQL-fråga. Värdet används i steg 2, så raden är
  // ingen kontroll för kontrollens skull, och meddelandet är firstDayOfMonths
  // eget — ingen ny text för en fråga som redan har en ägare.
  const firstDay = firstDayOfMonth(month);

  const templates = readRows(db, SQL_TEMPLATES, [userId, month, month]);
  const overrides = readRows(db, SQL_OVERRIDES, [userId, month]);
  const oneOffItems = readRows(db, SQL_MONTH_ITEMS, [userId, month]);

  // UNIQUE (template_id, month) i schemat gör att en mall har högst en avvikelse
  // den här månaden, så uppslaget kan vara en Map utan att något värde skrivs
  // över tyst.
  const overrideByTemplateId = new Map(overrides.map((row) => [row.template_id, row]));

  const items = [];
  for (const template of templates) {
    // Steg 2: intervallträffen. nextDueDate äger både periodräkningen och
    // klampningen för den 29-31, och den prövar bara interval och startDate i
    // posten den får — ett objekt med de två fälten räcker, och det är
    // avsiktligt. Frågan "dras posten den här månaden" ställs som "ligger den
    // första dragningen den 1:a i månaden eller senare fortfarande i samma
    // månad". Körd för en kvartalspost med start_date 2026-01-31: januari ger
    // 2026-01-31, februari och mars ger 2026-04-30 (alltså ingen träff), april
    // ger 2026-04-30 och juli ger 2026-07-31.
    const dueDate = nextDueDate({ interval: template.interval, startDate: template.start_date }, firstDay);
    if (monthOfIsoDate(dueDate) !== month) {
      continue;
    }
    // Steg 3: avvikelsen för just den här mallversionen.
    const override = overrideByTemplateId.get(template.id);
    if (override !== undefined && override.skipped === 1) {
      continue;
    }
    const overridden = override !== undefined;
    items.push({
      id: template.id,
      kind: template.kind,
      name: template.name,
      amountOre: overridden ? override.amount_ore : template.amount_ore,
      category: template.category,
      dueDate,
      // De två fälten som säger att posten kommer från en mall. Gränssnittet
      // behöver dem för ikonen, och "ändra från och med denna månad" behöver
      // seriens id.
      recurring: true,
      seriesId: template.series_id,
      overridden
    });
  }

  // Steg 4: engångsposterna. Ingen dag och inget intervall, alltså ingen
  // dueDate, och en engångspost kan inte ha en avvikelse.
  for (const row of oneOffItems) {
    items.push(toMonthItem(row));
  }

  // Steg 5.
  items.sort(compareItems);
  // Steg 6: summorna. budget.js äger räkningen, inklusive "kvar att leva på".
  return { items, totals: monthTotals(items) };
}

// Månadens engångspost. Svaret är den skapade posten, på samma form som en post
// ur readMonth.
export function addMonthItem(userId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('addMonthItem', month);
  const id = makeId();
  // Fälten prövas inte om här. Kedjan är: kärnan och API-lagret avgör vad
  // användaren får för svar, och schemats CHECK är sista utposten mot ett
  // programmeringsmisstag — ett brutet CHECK blir rad 4 i feltabellen
  // ("Uppgifterna kunde inte sparas: något värde är ogiltigt."), vilket är
  // precis vad den raden finns för. En andra beloppsvalidering eller en andra
  // kopia av namnregeln här vore två facit för samma fråga.
  write(db, SQL_INSERT_MONTH_ITEM, [
    id,
    userId,
    month,
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    now
  ]);
  // Läses tillbaka i stället för att sättas samman ur draft: det som svaret
  // beskriver är raden på disk, och den kan bära ett annat värde än draft om
  // schemat har normaliserat något.
  const row = findMonthItem(db, userId, id);
  return row === null ? null : toMonthItem(row);
}

// Ändrar en engångspost. Svaret är den ändrade posten, eller null när posten
// inte finns eller tillhör någon annan — samma svar i båda fallen.
export function updateMonthItem(userId, itemId, draft, { db = getDatabase() } = {}) {
  // Ingen läsning före skrivningen. En sådan rad fanns här först, med skälet att
  // "noll rader ändrade" inte går att skilja från "raden fanns men blev likadan",
  // och den togs bort efter en mutationskörning: med raden borta gav hela sviten
  // fortfarande fail 0, eftersom UPDATE mot ett id som ägs av någon annan matchar
  // noll rader och läsningen efteråt då svarar null ändå. En gren som ingen indata
  // kan skilja från sin frånvaro är ingen spärr (LARDOMAR.md 2026-09-04).
  //
  // Låg user_id utanför WHERE skulle skrivningen kunna träffa någon annans rad;
  // därför bär både UPDATE och läsningen efteråt user_id = ?.
  write(db, SQL_UPDATE_MONTH_ITEM, [
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    userId,
    itemId
  ]);
  const row = findMonthItem(db, userId, itemId);
  return row === null ? null : toMonthItem(row);
}

// true om något togs bort, false när posten inte finns eller tillhör någon
// annan. De två fallen ger samma svar med flit.
export function removeMonthItem(userId, itemId, { db = getDatabase() } = {}) {
  const result = write(db, SQL_DELETE_MONTH_ITEM, [userId, itemId]);
  return result.changes > 0;
}

function findMonthItem(db, userId, itemId) {
  const rows = readRows(db, SQL_MONTH_ITEM_BY_ID, [userId, itemId]);
  return rows.length === 0 ? null : rows[0];
}

// En rad ur month_items som en post i svaret. Översättningen mellan SQL:s
// snake_case och kärnans camelCase sker här och ingen annanstans.
//
// Posten bär inget month-fält: månaden är frågan och inte ett svar, och en post ur
// en mall har ingen egen månad att bära. De två sorternas poster har därmed exakt
// samma fält, så en anropare kan läsa listan utan att fråga varifrån raden kom.
function toMonthItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountOre: row.amount_ore,
    category: row.category,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false
  };
}

// Steg 5 i kedjan: slag i ITEM_KINDS ordning, därefter namn i svensk ordning,
// därefter id. Sista ledet finns för att ordningen ska vara total: två poster med
// samma slag och samma namn ska komma i samma ordning vid varje läsning, annars
// hoppar de i vyn.
function compareItems(a, b) {
  const kindOrder = ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  const nameOrder = NAME_COLLATOR.compare(a.name, b.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

// Månadsspärren för de vägar som inte har någon annan användning av månaden.
// readMonth anropar i stället firstDayOfMonth, som både avgör frågan och ger ett
// värde kedjan behöver.
function requireMonth(functionName, month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`${functionName} kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
}
