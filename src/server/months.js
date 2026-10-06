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
import { compareMonths, firstDayOfMonth, isValidIsoMonth, monthOfIsoDate, nowIso, shiftMonth } from '../core/dates.js';
import { ITEM_KINDS } from '../core/item.js';
import { nextDueDate } from '../core/schedule.js';
import { getDatabase, readRows, transaction, write } from './db.js';

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

// ---------------------------------------------------------------------------
// Mallarna och avvikelserna [etapp 4]. Vägen att skapa och ändra det readMonth
// ovan redan läser.
//
// Historiken är oföränderlig: ingen av de sex funktionerna nedan skriver om en
// rad så att en passerad månad får ett annat innehåll. En ändring framåt
// avslutar den gamla versionen vid månaden före och lägger en ny — det är hela
// skälet till series_id och from_month/to_month i schemat.
//
// Varje funktion tar userId först och har user_id = ? i varje WHERE. En mall som
// tillhör någon annan ska bete sig som om den inte finns, precis som
// updateMonthItem och removeMonthItem redan gör: samma svar som för ett okänt
// id, aldrig ett fel som avslöjar att raden finns.
// ---------------------------------------------------------------------------

const SQL_INSERT_TEMPLATE = `
INSERT INTO templates
  (id, user_id, series_id, kind, name, amount_ore, category, interval,
   start_date, from_month, to_month, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// user_id står med fastän anroparen redan känner raden som sin: id:t kommer
// antingen ur makeId i samma anrop eller ur en rad SQL_TEMPLATE_VERSION_FOR_MONTH
// redan har begränsat till användaren, så ingen indata kan nå frågan med någon
// annans id. Raden finns för modulens regel "varje WHERE bär user_id = ?" och
// inte som en spärr mot ett nåbart fall — samma skäl som SQL_OVERRIDES ovan
// skriver ut. En mutationskörning av just den här raden överlever därför
// (redovisat i paketet), och det är väntat.
const SQL_TEMPLATE_BY_ID = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND id = ?`;

// Den version av serien som gäller en given månad. Samma periodvillkor som
// SQL_TEMPLATES ovan, med series_id tillagt: högst en version av en serie kan
// gälla en månad, eftersom versionerna läggs efter varandra utan överlapp.
const SQL_TEMPLATE_VERSION_FOR_MONTH = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month <= ?
   AND (to_month IS NULL OR to_month >= ?)`;

// Avslutar den version som löper in i month vid månaden före. from_month < ?
// står med: en version som börjar i month eller senare kan inte avslutas vid
// månaden före utan att bryta CHECK (to_month IS NULL OR to_month >= from_month),
// och den tas i stället bort av SQL_DELETE_TEMPLATES_FROM nedan.
const SQL_END_TEMPLATE_VERSION = `
UPDATE templates
   SET to_month = ?
 WHERE user_id = ?
   AND series_id = ?
   AND from_month < ?
   AND (to_month IS NULL OR to_month >= ?)`;

// Versioner som helt ligger i month eller senare. De täcker ingen passerad
// månad, så en borttagning rör inte historiken.
const SQL_DELETE_TEMPLATES_FROM = `
DELETE FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month >= ?`;

// Samma sak som för SQL_TEMPLATE_BY_ID: id:t är raden
// SQL_TEMPLATE_VERSION_FOR_MONTH gav, alltså redan användarens, så user_id här
// är modulens regel och inte en nåbar spärr.
// Versioner som helt ligger i month eller senare, utom den version anropet
// behåller. Samma periodvillkor som SQL_DELETE_TEMPLATES_FROM ovan, med
// id <> ? tillagt: changeTemplateFrom ska ta bort de framtida versionerna men
// inte den rad den själv uppdaterar, och i gränsfallet nedan är de två samma
// månad. endTemplate har ingen rad att behålla och använder därför den andra
// konstanten.
//
// Avvikelserna för en borttagen version följer med: overrides.template_id har
// ON DELETE CASCADE i schemat, och PRAGMA foreign_keys = ON sätts på varje
// anslutning i db.js, så raden är ingen kommentar. Prövat av testfallet
// "en avvikelse på en borttagen framtida version försvinner med den".
//
// Två delvillkor här överlever mutation, och det är väntat — de skyddar inget
// nåbart fall utan uttrycker frågans form:
//
//   from_month >= ?   mutation till > ? ger EXIT=0 och fail 0. Skillnaden
//                     gäller bara en version som inte är current och som har
//                     from_month === month, och två versioner av samma serie
//                     kan inte täcka samma månad. >= står kvar därför att det
//                     är exakt vad ARKITEKTUR.md skriver ("i eller efter den
//                     månad ändringen gäller") och därför att det städar upp
//                     en fil som redan skulle råka bära överlappande rader.
//   user_id = ?       mutation till (user_id = ? OR 1=1) ger EXIT=0 och
//                     fail 0. Frågan nås först efter att
//                     SQL_TEMPLATE_VERSION_FOR_MONTH har begränsat raden till
//                     användaren, så ingen indata kan nå den med någon annans
//                     series_id. Raden står kvar för modulens regel "varje
//                     WHERE bär user_id = ?", samma skäl som SQL_OVERRIDES och
//                     SQL_TEMPLATE_BY_ID redan skriver ut.
const SQL_DELETE_TEMPLATES_FROM_EXCEPT = `
DELETE FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month >= ?
   AND id <> ?`;

const SQL_UPDATE_TEMPLATE_IN_PLACE = `
UPDATE templates
   SET kind = ?, name = ?, amount_ore = ?, category = ?, interval = ?, to_month = ?
 WHERE user_id = ?
   AND id = ?`;

// Avvikelsen skrivs genom ett INSERT ... SELECT ur templates, inte genom en
// läsning följd av ett INSERT. Ägarkontrollen blir då en del av skrivningen:
// matchar WHERE ingen mall skrivs ingen rad, och en mall som tillhör någon annan
// kan inte få en avvikelse ens om anroparen skickar dess id. SELECT har en
// WHERE, vilket SQLite kräver för att ON CONFLICT ska gå att skilja från ett
// villkor i SELECT:en.
//
// ON CONFLICT (template_id, month) är schemats UNIQUE: en andra avvikelse för
// samma mall och månad ersätter den första i stället för att falla. Beloppet och
// skipped skrivs båda, så en månad som var överhoppad kan bli ett belopp och
// tvärtom — schemats CHECK tillåter bara en av de två åt gången.
const SQL_UPSERT_OVERRIDE = `
INSERT INTO overrides (id, user_id, template_id, month, amount_ore, skipped, created_at)
SELECT ?, t.user_id, t.id, ?, ?, ?, ?
  FROM templates t
 WHERE t.user_id = ?
   AND t.id = ?
    ON CONFLICT (template_id, month)
    DO UPDATE SET amount_ore = excluded.amount_ore, skipped = excluded.skipped`;

const SQL_DELETE_OVERRIDE = `
DELETE FROM overrides
 WHERE user_id = ?
   AND template_id = ?
   AND month = ?`;

// En ny återkommande post. from_month är den månad posten skapas i, och
// series_id är den första versionens eget id — varje senare version av samma
// post bär samma series_id.
//
// start_date härleds ur månaden och står inte i utkastet: formuläret har inget
// dagfält, och den enda dag som går att läsa ur "den här månaden" är den första.
// Dagen styr intervallets fas i steg 2 av readMonth, så den får inte bytas
// senare: changeTemplateFrom nedan kopierar därför start_date från den version
// den ersätter i stället för att räkna fram en ny.
export function addTemplate(userId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('addTemplate', month);
  const id = makeId();
  // Fälten prövas inte om här, av samma skäl som i addMonthItem: kärnan
  // (validateTemplateDraft) och API-lagret avgör vad användaren får för svar,
  // och schemats CHECK är sista utposten mot ett programmeringsmisstag.
  write(db, SQL_INSERT_TEMPLATE, [
    id,
    userId,
    id,
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    draft?.interval,
    firstDayOfMonth(month),
    month,
    draft?.toMonth ?? null,
    now
  ]);
  const row = findTemplate(db, userId, id);
  return row === null ? null : toTemplate(row);
}

// Avslutar serien från och med month. Månaderna före month är orörda: den
// version som löper in i month får to_month = månaden före, och versioner som
// börjar i month eller senare tas bort.
//
// Två skrivningar som ska lyckas tillsammans, alltså en transaktion: blir bara
// den ena av dem kvar är serien halvt avslutad, och en passerad månad kan då få
// ett annat innehåll än den hade.
//
// true om serien fanns och berördes, false när den inte finns eller tillhör
// någon annan — de två fallen ger samma svar med flit.
export function endTemplate(userId, seriesId, month, { db = getDatabase() } = {}) {
  requireMonth('endTemplate', month);
  const previous = shiftMonth(month, -1);
  return transaction(db, () => {
    const ended = write(db, SQL_END_TEMPLATE_VERSION, [previous, userId, seriesId, month, month]);
    const removed = write(db, SQL_DELETE_TEMPLATES_FROM, [userId, seriesId, month]);
    return ended.changes + removed.changes > 0;
  });
}

// Ändrar serien från och med month, och versionerar: den gamla versionen får
// to_month = månaden före, och en ny version med samma series_id och samma
// start_date läggs från month. Månaderna före month behåller det gamla värdet.
//
// Svaret är den nya versionen, eller null när serien inte har någon version som
// gäller month — vilket är samma svar som för ett series_id som inte finns och
// för ett som tillhör någon annan.
export function changeTemplateFrom(userId, seriesId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('changeTemplateFrom', month);
  const rows = readRows(db, SQL_TEMPLATE_VERSION_FOR_MONTH, [userId, seriesId, month, month]);
  if (rows.length === 0) {
    return null;
  }
  const current = rows[0];
  const previous = shiftMonth(month, -1);

  // Gränsfallet: ändringen gäller från samma månad som versionen själv börjar i.
  // Att sätta to_month = previous ger då to_month < from_month, vilket schemats
  // CHECK (to_month IS NULL OR to_month >= from_month) fäller — versionen skulle
  // bli en serie utan en enda månad. Villkoret skrivs som jämförelsen mot
  // previous, alltså mot exakt det värde CHECK hade fått:
  if (compareMonths(previous, current.from_month) < 0) {
    // Ingen passerad månad berörs, eftersom versionen inte gäller någon månad
    // före month. Raden uppdateras därför i stället för att versioneras, och
    // serien får en rad och inte två.
    //
    // Två skrivningar, alltså en transaktion av samma skäl som grenen nedan:
    // blir borttagningen kvar utan uppdateringen har serien tappat sina
    // framtida versioner utan att den kvarvarande fått de nya värdena.
    transaction(db, () => {
      write(db, SQL_DELETE_TEMPLATES_FROM_EXCEPT, [userId, seriesId, month, current.id]);
      write(db, SQL_UPDATE_TEMPLATE_IN_PLACE, [
        draft?.kind,
        draft?.name,
        draft?.amountOre,
        draft?.category,
        draft?.interval,
        draft?.toMonth ?? null,
        userId,
        current.id
      ]);
    });
    const row = findTemplate(db, userId, current.id);
    return row === null ? null : toTemplate(row);
  }

  // Två skrivningar som ska lyckas tillsammans eller inte alls. Faller INSERT
  // får UPDATE inte bli kvar: serien hade då avslutats vid månaden före utan att
  // någon ny version tog över, och posten hade försvunnit ur varje kommande
  // månad.
  const id = makeId();
  transaction(db, () => {
    // Före INSERT: varje version som börjar i month eller senare tas bort.
    // Utan raden täcker den nya versionen samma månader som en redan befintlig
    // framtida version, och posten visas två gånger i de månaderna — nåbart
    // genom att ändra från en framtida månad och därefter från en tidigare.
    //
    // Placeringen före INSERT är bärande, och vilket indatafall som visar det är
    // kört: mutation "flytta raden till efter INSERT" ger EXIT=1 och fail 8,
    // bland dem M22, M25 och M13 — DELETE:n träffar då den rad anropet just
    // skapat, eftersom id <> ? undantar current.id och inte det nya id:t, och
    // changeTemplateFrom svarar null för en ändring som gick igenom.
    //
    // Ordningen mellan DELETE och END spelar däremot ingen roll: deras WHERE är
    // disjunkta (from_month >= month mot from_month < month), och mutation
    // "byt plats på de två" ger EXIT=0 och fail 0.
    write(db, SQL_DELETE_TEMPLATES_FROM_EXCEPT, [userId, seriesId, month, current.id]);
    write(db, SQL_END_TEMPLATE_VERSION, [previous, userId, seriesId, month, month]);
    write(db, SQL_INSERT_TEMPLATE, [
      id,
      userId,
      // Samma serie, och samma dag i månaden: start_date styr intervallets fas i
      // steg 2 av readMonth, så en ny dag hade flyttat vilka månader serien
      // träffar.
      current.series_id,
      draft?.kind,
      draft?.name,
      draft?.amountOre,
      draft?.category,
      draft?.interval,
      current.start_date,
      month,
      draft?.toMonth ?? null,
      now
    ]);
  });
  const row = findTemplate(db, userId, id);
  return row === null ? null : toTemplate(row);
}

// Ett annat belopp bara den här månaden. Övriga månader behåller mallens belopp.
// true om mallen fanns och är användarens, annars false.
export function setOverride(userId, templateId, month, amountOre, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('setOverride', month);
  const result = write(db, SQL_UPSERT_OVERRIDE, [makeId(), month, amountOre, 0, now, userId, templateId]);
  return result.changes > 0;
}

// Hoppar över mallen bara den här månaden. Samma rad i overrides som
// setOverride, med skipped = 1 och inget belopp — schemats CHECK tillåter bara
// ett av de två.
export function skipMonth(userId, templateId, month, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('skipMonth', month);
  const result = write(db, SQL_UPSERT_OVERRIDE, [makeId(), month, null, 1, now, userId, templateId]);
  return result.changes > 0;
}

// Tar bort avvikelsen, så att månaden återgår till mallens belopp. true om en
// rad togs bort, false när ingen fanns eller mallen tillhör någon annan.
//
// Ingen anropare i src/ sedan etapp 4 — behålls därför att gränssnittet behöver
// den för att ta tillbaka en avvikelse, och det byggs i nästa uppdrag.
// ARKITEKTUR.md under "Rättelse av etapp 4" ger de två mallvägarna sina
// anropare men ingen väg till den här: kroppen i
// PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM> har bara formerna { amountSek } och
// { skipped: true }. Exporten prövas av (M18) i tests/months.test.js
// (LARDOMAR.md 2026-09-16).
export function clearOverride(userId, templateId, month, { db = getDatabase() } = {}) {
  requireMonth('clearOverride', month);
  const result = write(db, SQL_DELETE_OVERRIDE, [userId, templateId, month]);
  return result.changes > 0;
}

function findTemplate(db, userId, templateId) {
  const rows = readRows(db, SQL_TEMPLATE_BY_ID, [userId, templateId]);
  return rows.length === 0 ? null : rows[0];
}

// En rad ur templates som en mall i svaret. Översättningen mellan SQL:s
// snake_case och kärnans camelCase sker här, precis som toMonthItem gör det för
// month_items — ingen annan fil läser kolumnnamnen.
function toTemplate(row) {
  return {
    id: row.id,
    seriesId: row.series_id,
    kind: row.kind,
    name: row.name,
    amountOre: row.amount_ore,
    category: row.category,
    interval: row.interval,
    startDate: row.start_date,
    fromMonth: row.from_month,
    toMonth: row.to_month
  };
}
