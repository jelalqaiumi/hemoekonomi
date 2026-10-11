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

import { monthTotals, sumByKind } from '../core/budget.js';
import { compareMonths, firstDayOfMonth, isValidIsoMonth, monthOfIsoDate, nowIso, parseIsoDate, shiftMonth } from '../core/dates.js';
import { CATEGORIES } from '../core/entry.js';
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

// Steg 4: månadens engångsposter. occurred_on och note står med sedan steg 2:
// de är postens egna fält och läses därför på varje väg som läser en post.
const SQL_MONTH_ITEMS = `
SELECT id, kind, name, amount_ore, category, occurred_on, note
  FROM month_items
 WHERE user_id = ?
   AND month = ?`;

const SQL_MONTH_ITEM_BY_ID = `
SELECT id, kind, name, amount_ore, category, occurred_on, note
  FROM month_items
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_MONTH_ITEM = `
INSERT INTO month_items
  (id, user_id, month, kind, name, amount_ore, category, created_at, occurred_on, note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_UPDATE_MONTH_ITEM = `
UPDATE month_items
   SET kind = ?, name = ?, amount_ore = ?, category = ?, occurred_on = ?, note = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_MONTH_ITEM = `
DELETE FROM month_items
 WHERE user_id = ?
   AND id = ?`;

// Månadens tak per kategori [steg 2]. Ingen ORDER BY: ordningen avgörs av
// CATEGORIES i src/core/entry.js, som är ägaren till kategoriernas ordning, och
// inte av en alfabetisk sortering av de engelska nycklarna i ett svenskt
// gränssnitt. Samma skäl som att steg 5 sorterar slag i ITEM_KINDS ordning.
const SQL_BUDGETS = `
SELECT category, amount_ore
  FROM budgets
 WHERE user_id = ?
   AND month = ?`;

// ON CONFLICT (user_id, month, category) är schemats UNIQUE: ett andra tak för
// samma kategori och månad ersätter det första i stället för att falla, så PUT
// är en enda operation och inte "läs, välj, skriv".
const SQL_UPSERT_BUDGET = `
INSERT INTO budgets (id, user_id, month, category, amount_ore, created_at)
VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, month, category)
    DO UPDATE SET amount_ore = excluded.amount_ore`;

const SQL_DELETE_BUDGET = `
DELETE FROM budgets
 WHERE user_id = ?
   AND month = ?
   AND category = ?`;

// Gränserna för count i readOverview nedan. Talen står som namn och inte som
// literaler: var och en läses både av villkoret och av felmeddelandet, alltså i
// samma roll på två ställen, och två handskrivna kopior kan glida isär utan att
// något test märker det.
//
// Exporterade sedan steg 5: readReport i src/server/reports.js har samma tak och
// läser det härifrån, och api.js interpolerar 400-texten för ett otillåtet antal
// ur samma två namn. Ett andra tak för samma sak vore två facit (ARKITEKTUR.md,
// "Vad readReport svarar").
export const OVERVIEW_MIN_MONTHS = 1;
export const OVERVIEW_MAX_MONTHS = 36;

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
  const budgetRows = readRows(db, SQL_BUDGETS, [userId, month]);

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
      // En mall har ingen enskild dag och ingen enskild kommentar [steg 2]. De två
      // fälten står ändå med, och som null, av samma skäl som interval och
      // toMonth står med som null på en engångspost: de två sorternas poster ska
      // ha exakt samma fält, så att en anropare kan läsa listan utan att fråga
      // varifrån raden kom.
      occurredOn: null,
      note: null,
      dueDate,
      // De två fälten som säger att posten kommer från en mall. Gränssnittet
      // behöver dem för ikonen, och "ändra från och med denna månad" behöver
      // seriens id.
      recurring: true,
      seriesId: template.series_id,
      overridden,
      // Mallens två egna fält. Gränssnittet förifyller dem när användaren väljer
      // "Från och med <månad>": utan dem står intervallfältet på sitt första
      // alternativ, och en beloppsändring på en kvartalspost skrev tyst om
      // serien till månadsvis (ARKITEKTUR.md, rättelsen "posten bär sitt
      // intervall").
      interval: template.interval,
      toMonth: template.to_month
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
  // Steg 7: budgetarna [steg 2], räknade ur items ovan och inte ur en egen fråga:
  // det som är kvar av ett tak ska vara kvar av exakt de poster månadsvyn visar.
  return { items, totals: monthTotals(items), budgets: budgetLines(budgetRows, items) };
}

// Månadens tak med utfallet: { category, amountOre, spentOre, leftOre } per
// kategori som har ett tak [steg 2]. Bara kategorier med ett tak kommer med — en
// kategori utan tak har ingen budget att vara kvar av.
//
// spentOre räknar bara utgifter. En inkomst eller ett sparande i samma kategori
// ska inte påverka hur mycket som är kvar av ett utgiftstak, och det är sumByKind
// i src/core/budget.js som avgör vilka poster som är utgifter — den här filen
// adderar ingenting själv och ärver därmed också spärren mot en summa som lämnar
// det säkra heltalsområdet.
//
// leftOre = amountOre - spentOre och får vara negativt: har användaren dragit
// över taket ska det synas som ett minusbelopp, inte som noll. Ingen spärr mot
// negativa värden, samma regel som leftOre i budget.js redan har. Differensen är
// den enda räkning den här modulen gör, och den kan inte lämna det säkra
// heltalsområdet: amount_ore har CHECK (amount_ore > 0) och skrivs genom
// checkAmountSek, som avvisar belopp över 9 999 999,99 kr, och spentOre är en
// summa sumByKind redan har prövat. -0 är omöjlig av samma skäl: a - b är -0 bara
// när båda leden är noll, och amountOre är alltid minst 1.
//
// Ordningen är CATEGORIES ordning, alltså kategoriernas ägares ordning. Den är
// total: UNIQUE (user_id, month, category) gör att en kategori har högst ett tak.
function budgetLines(budgetRows, items) {
  const amountByCategory = new Map(budgetRows.map((row) => [row.category, row.amount_ore]));
  const lines = [];
  for (const category of CATEGORIES) {
    if (!amountByCategory.has(category)) {
      continue;
    }
    const amountOre = amountByCategory.get(category);
    const spentOre = sumByKind(items.filter((item) => item.category === category), 'expense');
    lines.push({ category, amountOre, spentOre, leftOre: amountOre - spentOre });
  }
  return lines;
}

// Tolv månader bredvid varandra [etapp 5]. Svaret är
// { months, savedThisYear }, där months är count poster, äldst först, och den
// sista är endMonth.
//
// Varje månads summor kommer ur readMonth ovan, alltså ur monthTotals i
// src/core/budget.js. Ingen andra väg till ett tal: ingen SQL summerar, och
// ingen rad här adderar ett belopp. En tom månad utelämnas inte — readMonth
// svarar med fyra nollor för en månad utan poster, och raden skrivs som varje
// annan, annars ser tidslinjen ut att hoppa över tid.
export function readOverview(userId, endMonth, count, { db = getDatabase() } = {}) {
  // Rad 1 i spärrtabellen. isValidIsoMonth i src/core/dates.js äger frågan,
  // precis som för de övriga funktionerna i modulen; texten är readOverviews
  // egen eftersom ingen annan funktion i kedjan behöver månaden först.
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(`readOverview kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".`);
  }
  // Rad 2. Taket finns för att en översikt läser varje månads hela kedja:
  // mallar, intervallträffar, avvikelser och engångsposter. Utan tak kan en
  // klient be om tiotusen månader och få servern att arbeta i onödan.
  //
  // Number.isInteger coercar inte: 1n och Symbol('x') ger false i stället för
  // att kasta TypeError från jämförelsen, och NaN, Infinity och 12.5 avvisas
  // här i stället för att bli ett antal varv i loopen nedan. Värdet tas genom
  // String() i meddelandet av samma skäl: ${Symbol('x')} kastar TypeError.
  if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {
    throw new RangeError(`readOverview kräver ett antal månader mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}, fick "${String(count)}".`);
  }

  // Ingen cache över de månader som behövs både i months och i savedThisYear.
  // En Map med uppslaget "har månaden lästs" stod här först, och den togs bort
  // efter en mutationskörning: med grenen alltid tagen (varje månad läst om)
  // gav hela sviten fortfarande fail 0 och EXIT=0, eftersom en andra läsning av
  // samma månad ger samma rader och samma summor. En gren vars frånvaro ingen
  // indata kan skilja från dess närvaro är ingen spärr utan ett påstående om
  // arbete, och arbetet är redan begränsat av taket ovan: högst 36 månader i
  // serien plus högst 12 i året (LARDOMAR.md 2026-09-04).
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    // Summorna sprids in som de kommer ur monthTotals, utan att något tal rörs:
    // de fyra fälten incomeOre, expenseOre, savingOre och leftOre är budget.js
    // namn, och en omskrivning här vore en andra datamodell för samma summor.
    months.push({ month, ...readMonth(userId, month, { db }).totals });
  }

  // savedThisYear täcker januari till och med endMonth i endMonth:s år, oavsett
  // hur långt count sträcker sig bakåt. Månadsnumret läses genom dates.js och
  // klipps inte ur strängen här: monthOfIsoDate är det enda stället som delar
  // ett datum, och parseIsoDate det enda som läser ut dess delar.
  const januaryOffset = parseIsoDate(firstDayOfMonth(endMonth)).month - 1;
  const yearItems = [];
  for (let offset = januaryOffset; offset >= 0; offset -= 1) {
    for (const item of readMonth(userId, shiftMonth(endMonth, -offset), { db }).items) {
      yearItems.push(item);
    }
  }
  // Summan räknas av sumByKind, monthTotals egen summerare, och inte av en
  // addition här. Två skäl: additionen har då bara en ägare i projektet, och
  // spärren mot en summa som lämnar det säkra heltalsområdet följer med —
  // tolv savingOre som var för sig är säkra heltal kan tillsammans ligga
  // utanför, och den spärren har redan en utskriven svensk text
  // ("monthTotals kräver att summan är ett säkert heltal."). Talet är detsamma:
  // summan av varje månads savingOre är summan av alla månadernas
  // sparandeposter.
  const savedThisYear = sumByKind(yearItems, 'saving');

  return { months, savedThisYear };
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
    now,
    // ?? null av samma skäl som toMonth i addTemplate: ett utkast utan fältet ska
    // skriva NULL och inte undefined, som node:sqlite inte kan binda.
    draft?.occurredOn ?? null,
    draft?.note ?? null
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
    draft?.occurredOn ?? null,
    draft?.note ?? null,
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
    // Dagen användaren skrev in, eller null [steg 2]. Den har ingenting att göra
    // med dueDate på raden under: dueDate räknas fram ur en malls interval och
    // start_date, occurredOn skrivs in. En engångspost kan ha occurredOn men
    // aldrig dueDate.
    occurredOn: row.occurred_on,
    note: row.note,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    // En engångspost har inget intervall och ingen slutmånad. De två fälten står
    // ändå med, och som null: de två sorternas poster ska ha exakt samma fält,
    // så att en anropare kan läsa listan utan att fråga varifrån raden kom
    // [etapp 4, rättelsen "posten bär sitt intervall"].
    interval: null,
    toMonth: null
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

// ---------------------------------------------------------------------------
// Budgetens tak per kategori [steg 2]. readMonth ovan läser dem redan; de två
// funktionerna här är vägen att sätta och ta bort ett.
//
// Ett tak gäller en månad. Vill användaren ha samma tak varje månad sätts det per
// månad; en återkommande budget är en annan funktion och byggs inte nu
// (ARKITEKTUR.md under "Tabellen").
// ---------------------------------------------------------------------------

// Sätter taket för en kategori och en månad, eller ersätter det som finns.
// ON CONFLICT i SQL_UPSERT_BUDGET gör de två till en operation, så ingen läsning
// behövs före skrivningen.
//
// Inget returvärde. En boolean hade alltid varit true: INSERT:en skriver eller
// ersätter alltid en rad, så det finns ingen indata som kan göra den false, och
// ett svar ingen indata kan göra falskt är ingen upplysning utan en gren som
// aldrig körs (LARDOMAR.md 2026-09-04). Anroparen läser utfallet genom readMonth,
// som är den enda ägaren till formen { category, amountOre, spentOre, leftOre }.
//
// Fälten prövas inte om här, av samma skäl som i addMonthItem: kärnan
// (checkCategory och checkAmountSek genom api.js) avgör vad användaren får för
// svar, och schemats CHECK är sista utposten mot ett programmeringsmisstag.
export function setBudget(userId, month, category, amountOre, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('setBudget', month);
  write(db, SQL_UPSERT_BUDGET, [makeId(), userId, month, category, amountOre, now]);
}

// Tar bort taket. true om ett fanns, false när det inte finns eller tillhör någon
// annan — de två fallen ger samma svar med flit, precis som för en post.
//
// Kategorin prövas inte: en kategori som inte finns matchar ingen rad, och svaret
// blir då detsamma som för en kategori utan tak. Vägen svarar därför 404 och
// aldrig 400 för en okänd kategori, vilket är exakt vad tabellen under
// "API-vägar" räknar upp för DELETE.
export function removeBudget(userId, month, category, { db = getDatabase() } = {}) {
  requireMonth('removeBudget', month);
  const result = write(db, SQL_DELETE_BUDGET, [userId, month, category]);
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
