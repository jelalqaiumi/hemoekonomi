// Rapportens form: en rad per slag och kategori, över flera månader [steg 5].
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren.
//
// Modulen äger formen och ingenting annat. Filformatet ägs av src/core/csv.js,
// som byggdes i del 1 av steget, och databasläsningen av readReport i
// src/server/reports.js. Tre namn för tre skilda ansvar (ARKITEKTUR.md, "Två nya
// moduler i kärnan").
//
// Gränsen mot overview är skarp: readOverview svarar fyra summor per månad,
// reportRows svarar uppdelningen bakom dem — en rad per (kind, category), med
// taket per månad och antalet månader det sprack (ARKITEKTUR.md, "Gränsen mot
// overview, som Bas redan har").
//
// Ingen klocka läses: en rapport är historik, och reportRows tar inget today.
// Ingen division i flyttal: divideRoundHalfUp i money.js äger divisionen, och
// sumByKind i budget.js äger additionen.
//
// Beroendet är riktat och cykelfritt: entry.js importerar dates.js och money.js,
// budget.js importerar entry.js, item.js och money.js, och ingen av dem
// importerar den här filen.
import { isValidIsoMonth } from './dates.js';
import { CATEGORIES, isPlainObject } from './entry.js';
import { ITEM_KINDS } from './item.js';
import { sumByKind } from './budget.js';
import { divideRoundHalfUp, normalizeZero } from './money.js';

// De nio texterna ur spärrtabellen "Ingångsspärrar i src/core/report.js" i
// ARKITEKTUR.md, skrivna bara här. Rad 3 till 9 namnger platsen, till skillnad
// från money.js meddelanden: ett trasigt element i en serie på trettiosex
// månader går annars inte att hitta, och rad 8 och 9 namnger både månaden och
// budgetraden. Ingen av texterna skriver ut värdet, så ingen av dem behöver gå
// genom String().
const MESSAGES = Object.freeze({
  notAList: 'reportRows kräver en lista med månader.',
  empty: 'reportRows kräver minst en månad.',
  notAnObject: (i) => `reportRows kräver ett objekt per månad, index ${i}.`,
  badMonth: (i) => `reportRows kräver en månad på formen ÅÅÅÅ-MM, index ${i}.`,
  badItems: (i) => `reportRows kräver en lista med poster, index ${i}.`,
  badBudgets: (i) => `reportRows kräver en lista med budgetar, index ${i}.`,
  badOrder: (i) => `reportRows kräver månaderna i stigande ordning, index ${i}.`,
  badBudgetLine: (i, j) => `reportRows kräver ett objekt per budgetrad, index ${i} rad ${j}.`,
  badBudgetAmount: (i, j) => `reportRows kräver ett belopp i heltal ören per budgetrad, index ${i} rad ${j}.`
});

// Det slag som har ett tak. Taket gäller bara utgifter — det är steg 2:s beslut,
// där spentOre i budgetLines räknar enbart utgifter — och beslut 5 i
// ARKITEKTUR.md skriver ut följden: budgetPerMonthOre är enbart null för income
// och saving.
//
// Står som en sträng och inte som ITEM_KINDS[1], av exakt samma skäl som
// monthTotals i budget.js anger: en omordning av ITEM_KINDS skulle då tyst byta
// vilket slag som får läsa taket. Att slaget finns i ITEM_KINDS skyddas i
// stället av ett testfall.
const BUDGETED_KIND = 'expense';

// Spärrtabellen rad 1 till 9, i tabellens ordning och över hela listan i taget.
// Nio genomgångar och inte en nästlad loop, ordagrant samma konstruktion och
// samma skäl som toCsv i csv.js: tabellen säger "första träff vinner" om
// *raderna*, så en serie där index 0 saknar items (rad 5) och index 1 har en
// trasig månad (rad 4) ska svara med rad 4. En enda genomgång hade varvat
// raderna och gjort svaret beroende av ordningen i listan, och en numrerad
// tabell får inte beskriva villkor som prövas varvat (LARDOMAR.md 2026-09-02).
//
// Rad 8 och 9 gäller per budgetrad och har därför två index. Ordningen är
// densamma som för de övriga: rad 8 för VARJE budgetrad i varje månad, därefter
// rad 9 för varje budgetrad i varje månad. Inom en genomgång är ordningen
// månadernas och därefter budgetradernas, alltså läsordningen. Att rad 8 går
// före rad 9 är inte bara tabellordning utan ett krav: rad 9 läser .amountOre,
// och på en budgetrad som är null hade det gett TypeError i stället för modulens
// RangeError.
//
// Körda konsekvenser av ordningen, alla tre med egna testfall:
//   reportRows([{ month: '2026-01', budgets: [] },
//               { month: 'januari', items: [], budgets: [] }])
//     ger rad 4:s meddelande om index 1, inte rad 5:s om index 0.
//   budgets: [{ category: 'housing', amountOre: 'abc' }] i index 0 och
//     budgets: [null] i index 1 ger rad 8 om index 1 rad 0, inte rad 9.
//   två månader i fallande ordning med en trasig budgetrad i index 1 ger rad 7.
function checkMonthsData(monthsData) {
  // Utan Array.isArray itererar map och flatMap nedan över en strängs tecken.
  if (!Array.isArray(monthsData)) {
    throw new RangeError(MESSAGES.notAList);
  }
  // En tom serie har inga månader att indexera, och averageOre hade då delats
  // med noll — divideRoundHalfUp kastar för en nämnare som inte är större än 0,
  // men meddelandet hade namngett nämnaren i stället för indatan.
  if (monthsData.length === 0) {
    throw new RangeError(MESSAGES.empty);
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    // isPlainObject ägs av entry.js och importeras: ett handskrivet
    // typeof x === 'object' släpper igenom en array (LARDOMAR.md 2026-09-02).
    // new Date() är ett vanligt objekt också för ägaren och passerar därför den
    // här raden — det är rad 4 som avvisar den, eftersom ett Date inte bär
    // något month. Båda utfallen har egna testfall.
    if (!isPlainObject(monthsData[i])) {
      throw new RangeError(MESSAGES.notAnObject(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    // isValidIsoMonth äger frågan "är det här en riktig månad": mönstret ensamt
    // räcker aldrig, eftersom '2026-13' matchar det utan att vara en månad.
    if (!isValidIsoMonth(monthsData[i].month)) {
      throw new RangeError(MESSAGES.badMonth(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!Array.isArray(monthsData[i].items)) {
      throw new RangeError(MESSAGES.badItems(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!Array.isArray(monthsData[i].budgets)) {
      throw new RangeError(MESSAGES.badBudgets(i));
    }
  }
  // Rad 7 är den som bär mest. perMonthOre:s index ÄR månaden: element noll hör
  // till months[0]. Kommer indatan i fel ordning blir hela serien tyst omkastad,
  // och diagrammet ritar en kurva som inte är användarens — ett kast är därför
  // enda hederliga svaret (ARKITEKTUR.md).
  //
  // Villkoret bär i > 0 i stället för att loopen börjar på 1, så att det står
  // ordagrant som i spärrtabellen. Delvillkoret är inte dekoration: utan det
  // läser raden monthsData[-1], som är undefined, och .month på den kastar
  // TypeError i stället för modulens RangeError — för varje giltig indata.
  //
  // Månaderna behöver inte vara varandras granne, bara strikt stigande. En
  // strängjämförelse räcker: formen ÅÅÅÅ-MM sorterar lexikografiskt som den
  // sorterar kronologiskt, och rad 4 har redan prövat att båda leden har formen.
  for (let i = 0; i < monthsData.length; i += 1) {
    if (i > 0 && monthsData[i].month <= monthsData[i - 1].month) {
      throw new RangeError(MESSAGES.badOrder(i));
    }
  }
  // Rad 8. Samma ägare till begreppet "vanligt objekt" som rad 3, och samma
  // stränghet som items redan hade: items: [null] kastar genom sumByKind, och
  // budgets: [null] ska inte tystna. Två listor i samma element ska prövas lika
  // strikt (ARKITEKTUR.md, "Rad 8 och 9 tillkom i del 2, efter en mätning").
  for (let i = 0; i < monthsData.length; i += 1) {
    for (let j = 0; j < monthsData[i].budgets.length; j += 1) {
      if (!isPlainObject(monthsData[i].budgets[j])) {
        throw new RangeError(MESSAGES.badBudgetLine(i, j));
      }
    }
  }
  // Rad 9. Taket är det enda värdet modulen jämför ett belopp mot, och en
  // jämförelse mot något som inte är ett tal är tyst falsk: mätt före rättningen
  // gav 500000 ören spenderat mot amountOre 'abc' som tak overBudgetMonths: 0,
  // alltså svaret att användaren höll budgeten.
  //
  // Number.isSafeInteger och inte Number.isInteger: det är inte samma fråga.
  // Number.isInteger(9007199254740994) och Number.isInteger(1e300) är båda sanna,
  // och ett tak utanför det säkra heltalsområdet går inte att jämföra meningsfullt
  // med en summa — två skilda heltal över 2^53 är samma dubbel. Summan på andra
  // sidan jämförelsen är redan prövad som ett säkert heltal av sumByKind, så
  // kraven ska vara desamma på båda leden. Predikatet coercar inte: 1n och
  // Symbol('x') ger false i stället för att kasta TypeError ur jämförelsen.
  //
  // En gräns raden medvetet inte täcker: Number.isSafeInteger(-0) är sant, så
  // amountOre: -0 passerar här. Det är avgjort och inte öppet — arkitekten
  // beslutade att värdet normaliseras i stället för att avvisas, eftersom budgets
  // har CHECK (amount_ore > 0) och en tionde rad hade varit en spärr mot en
  // indata ingen skrivväg kan producera. Normaliseringen görs av normalizeZero
  // där talet skrivs in i svaret, se budgetPerMonthOre nedan.
  for (let i = 0; i < monthsData.length; i += 1) {
    for (let j = 0; j < monthsData[i].budgets.length; j += 1) {
      if (!Number.isSafeInteger(monthsData[i].budgets[j].amountOre)) {
        throw new RangeError(MESSAGES.badBudgetAmount(i, j));
      }
    }
  }
}

// Posterna i en kategori, ur en månads items.
//
// En post som inte är ett vanligt objekt faller INTE bort i filtret utan följer
// med i varje kategorilista. Skälet är ägarskap: postens egna fält — kind och
// amountOre — prövas av sumByKind i budget.js, och en post filtret hade tappat
// nådde aldrig den kedjan. Summan hade då blivit 0 för en lista med skräp i, i
// stället för ett kast, och en exporterad funktion i src/core/ får aldrig svara
// med ett skadat tal (LARDOMAR.md 2026-09-02). Kortslutningen gör dessutom att
// item.category aldrig läses på null, som hade gett TypeError i stället för ett
// RangeError.
//
// Körd konsekvens: en månad vars items är [null] ger
// "monthTotals kräver poster som objekt.", och en post med amountOre: 'abc' ger
// "monthTotals kräver ett belopp i heltal ören." Meddelandet namnger monthTotals
// också här, precis som ARKITEKTUR.md skriver ut för varje annan anropare av
// sumByKind: texten är spärrens ägares och skrivs inte om.
//
// En post vars kategori ligger utanför CATEGORIES har ingen rad att höra till
// och kommer därför inte med i någon summa. Varje skrivväg i src/server/ prövar
// fältet med checkCategory, så en sådan post kan inte komma ur databasen.
function itemsInCategory(items, category) {
  return items.filter((item) => !isPlainObject(item) || item.category === category);
}

// Rapportens form. Svaret är { months, rows, largest }, skrivet ut i
// ARKITEKTUR.md under "Vad readReport svarar".
//
// Varje element i monthsData är { month, items, budgets } — precis de två listor
// readMonth i src/server/months.js redan svarar med. En lista och inte två
// parallella: två parallella listor kan komma i otakt i längd, och hela den
// felklassen försvinner när månaden bärs av samma element som sina poster.
// months i svaret härleds därför ur indatan och skickas inte in.
export function reportRows(monthsData) {
  checkMonthsData(monthsData);

  const months = monthsData.map((month) => month.month);

  // Taket per månad, ett uppslag per månad i stället för en sökning per rad.
  // UNIQUE (user_id, month, category) i schemat gör att en kategori har högst
  // ett tak per månad, så ingen Map skriver över ett värde tyst.
  //
  // Inget filter på raderna: rad 8 och rad 9 i spärrtabellen har redan prövat att
  // varje budgetrad är ett vanligt objekt med ett belopp i heltal ören, så varje
  // rad som kommer hit hör i uppslaget.
  //
  // Här stod först ett .filter((line) => isPlainObject(line)) i stället för de
  // två spärrarna. Det togs bort i del 2 av steget, efter två mätningar:
  // mutation: filtret struket gav EXIT=0, fail 0 — alltså överlevde det varje
  // mutation — och filtret fångade bara icke-objekt, så en budgetrad med skräp i
  // beloppet gick rakt in i svaret: 500000 ören spenderat mot amountOre 'abc'
  // som tak gav budgetPerMonthOre ["abc"] och overBudgetMonths: 0, alltså svaret
  // att användaren höll budgeten (ARKITEKTUR.md, "Rad 8 och 9 tillkom i del 2").
  //
  // normalizeZero i money.js äger frågan "detta är -0" och anropas här, på det
  // enda tal i svaret som kommer rakt ur indatan: Number.isSafeInteger(-0) är
  // sant, så rad 9 släpper igenom värdet, och utan anropet bär
  // budgetPerMonthOre -0 — osynligt i JSON, men Object.is mot -0 är true, och
  // ingen exporterad funktion i src/core/ får returnera värdet
  // (LARDOMAR.md 2026-09-02). Anropet är prövbart här därför att utdatan är talet
  // självt; i csv.js är utdatan en sträng byggd ur tecken och magnitud, där -0,00
  // är strukturellt omöjlig och anropet därför togs bort i del 1.
  const budgetByCategory = monthsData.map((month) => new Map(
    month.budgets.map((line) => [line.category, normalizeZero(line.amountOre)])
  ));

  const rows = [];
  // Beslut 1: radens nyckel är (kind, category) och inte category. Samma
  // kategori kan bära både en inkomst och en utgift, och en rad som slog ihop
  // dem hade visat ett netto användaren aldrig skrivit. Ordningen är
  // ITEM_KINDS ordning, därefter CATEGORIES ordning — båda frysta listor med en
  // ägare, så ordningen är total och vyn kan inte hoppa mellan två läsningar.
  for (const kind of ITEM_KINDS) {
    for (const category of CATEGORIES) {
      // Summan per månad. sumByKind i budget.js äger additionen, och den här
      // modulen adderar inget belopp själv: spärren mot en summa som lämnar det
      // säkra heltalsområdet följer då med, och additionen har en enda ägare i
      // projektet (samma skäl som readOverview anger för savedThisYear).
      const perMonthOre = monthsData.map((month) => sumByKind(itemsInCategory(month.items, category), kind));

      // Summan över hela serien, räknad av samma ägare över månadernas poster
      // tillsammans — inte genom en addition av perMonthOre här. Talet är
      // detsamma, och ingen rad i den här filen summerar.
      const totalOre = sumByKind(
        monthsData.flatMap((month) => itemsInCategory(month.items, category)),
        kind
      );

      const budgetPerMonthOre = budgetByCategory.map((byCategory) => {
        // Beslut 5: taket gäller bara utgifter, alltså enbart null för income
        // och saving.
        if (kind !== BUDGETED_KIND) {
          return null;
        }
        // Beslut 4: budgetPerMonthOre är en lista och inte ett tal. Taket sätts
        // per månad och per kategori, och ett enda budgetOre för hela serien
        // blir en lögn i samma stund användaren ändrar taket. has och inte get
        // ensamt: ett saknat tak ska ge null och inte undefined.
        if (!byCategory.has(category)) {
          return null;
        }
        return byCategory.get(category);
      });

      // Beslut 3: en rad kommer med om den har ett belopp skilt från noll i
      // någon månad ELLER ett tak i någon månad. Ett satt tak som inte använts
      // är ett svar — du budgeterade för mat och handlade ingen. En kategori som
      // är noll hela serien och saknar tak har ingenting att rapportera.
      const hasAmount = perMonthOre.some((ore) => ore !== 0);
      const hasBudget = budgetPerMonthOre.some((ore) => ore !== null);
      if (!hasAmount && !hasBudget) {
        continue;
      }

      // Beslut 6: overBudgetMonths räknar månader där taket finns OCH beloppet
      // överstiger det. Lika med taket är inte över det.
      let overBudgetMonths = 0;
      for (let i = 0; i < perMonthOre.length; i += 1) {
        if (budgetPerMonthOre[i] !== null && perMonthOre[i] > budgetPerMonthOre[i]) {
          overBudgetMonths += 1;
        }
      }

      rows.push({
        kind,
        category,
        perMonthOre,
        totalOre,
        // Beslut 2: averageOre delas med antalet månader i serien, aldrig med
        // antalet månader som har ett belopp. Frågan är vad kategorin kostar i
        // månaden, och en månad utan utgift är en riktig nolla och inte en
        // saknad mätning. divideRoundHalfUp äger divisionen; ingen
        // flyttalsdivision, och ingen tyst avrundning av en summa som inte går
        // att dela — funktionen kastar utanför det säkra heltalsområdet.
        averageOre: divideRoundHalfUp(totalOre, monthsData.length),
        budgetPerMonthOre,
        overBudgetMonths
      });
    }
  }

  // largest är raden med störst totalOre, till diagrammets skalning, och null
  // för en tom rapport. Jämförelsen är strikt större, så vid lika totalOre
  // vinner den tidigare i radordningen och svaret är entydigt.
  let largestRow = null;
  for (const row of rows) {
    if (largestRow === null || row.totalOre > largestRow.totalOre) {
      largestRow = row;
    }
  }
  const largest = largestRow === null ? null : { kind: largestRow.kind, category: largestRow.category };

  return { months, rows, largest };
}
