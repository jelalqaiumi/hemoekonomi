// Sparmålet: hur långt användaren har kommit, och hur mycket per månad som
// återstår [steg 4].
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren.
//
// Modulen äger fyra frågor och ingenting annat:
//   1. de räknade fälten — savedOre, leftOre, percent, monthsLeft, perMonthOre,
//   2. statusen — klart, pagaende eller forsenat,
//   3. valideringen av sparmålets utkast från användaren,
//   4. valideringen av en insättnings utkast från användaren.
//
// Klockan läses inte här. Dagens datum kommer in som parameter, av samma skäl som
// i bill.js och schedule.js: en funktion som läser klockan går inte att testa.
//
// Beroendet är riktat och cykelfritt: cost.js importerar entry.js och money.js,
// entry.js importerar dates.js och money.js, och ingen av dem importerar den här
// filen.
import { MONTHS_PER_YEAR } from './cost.js';
import { compareIsoDates, isValidIsoDate, parseIsoDate } from './dates.js';
import { AMOUNT_MAX_SEK, AMOUNT_PATTERN, checkAmountSek, checkName, isPlainObject } from './entry.js';
import { ORE_PER_SEK, divideRoundHalfUp, normalizeZero, sekToOre } from './money.js';

// De tre statusvärdena, i den ordning de första gången vinner i tabellen under
// "Sparmål" i ARKITEKTUR.md: rad 1 ger klart, rad 2 och rad 4 ger pagaende, rad 3
// ger forsenat. Ordningen är inte fri — den ÄR regeln, och (S6) prövar en rad i
// taget.
//
// Nycklarna är svenska därför att de är en del av appens datamodell och inte text
// mot användaren: de står i JSON-svaret från GET /api/sparmal och väljs av
// gränssnittet för att avgöra hur en rad ska se ut. Samma skäl som för
// BILL_STATUSES i bill.js; användaren ser aldrig strängarna.
//
// Fryst av samma skäl som INTERVALS och CATEGORIES i entry.js: en importör som
// skriver om ett värde skulle annars flytta hela appens statusregel utan att
// någon fil visar det.
//
// Ingen anropare i src/ utanför den här filen sedan steg 4 — körd:
// grep -rn "GOAL_STATUSES" src/ ger definitionen, en kommentar och
// destruktureringen nedan. Exporten finns för att sparmålskortet i src/web/app.js
// ska kunna räkna upp de tre utseendena ur listan i stället för att skriva av dem,
// på samma sätt som räkningskortet läser BILL_STATUSES. Kortet är inte byggt:
// steg 4 lämnades vidare efter API-vägarna, och gränssnittet står kvar hos
// arkitekten. Läser kortet inte listan när det byggs ska exporten tas bort
// (LARDOMAR.md 2026-09-16). Detsamma gäller PERCENT_MIN och PERCENT_FULL nedan,
// som stapelns bredd ska läsa sina två ändar ur.
export const GOAL_STATUSES = Object.freeze(['klart', 'pagaende', 'forsenat']);

// De tre värdena läses ur listan ovan och skrivs inte en andra gång som literaler
// i goalStatus: listan är därmed verkligen ägaren. Destrukturering och inte tre
// uppslag, av samma skäl som i bill.js — ordningen i listan är regeln, och en rad
// som läser GOAL_STATUSES[2] hade sagt samma sak utan att visa vilket värde som
// menas.
const [DONE, ONGOING, LATE] = GOAL_STATUSES;

// Procentskalans båda ändar. percent klipps i båda: en progressruta kan inte rita
// minus tolv procent och inte heller 140 (ARKITEKTUR.md under "Sparmål").
// savedOre och leftOre bär sanningen; percent är till för stapeln.
//
// PERCENT_FULL är både skalfaktorn i divisionen och den övre gränsen, eftersom
// det är samma roll: hundra procent är hela målet. Talet står som ett namn och
// inte som en literal på två ställen, av samma skäl som ORE_PER_SEK i money.js
// och MONTHS_PER_YEAR i cost.js (LARDOMAR.md 2026-09-02).
export const PERCENT_MIN = 0;
export const PERCENT_FULL = 100;

// De texter modulen äger. Alla är text mot användaren och står på svenska.
//
// targetSek får en egen uppsättning texter och lånar inte checkAmountSeks: de
// namnger "Beloppet", och fältet heter Målbelopp i sparmålets formulär. En text
// som namnger ett annat fälts etikett är en text användaren inte kan följa. Själva
// REGELKEDJAN skrivs ändå inte av — checkTargetSek nedan anropar checkAmountSek
// och byter bara ut meddelandet.
//
// amountSek har däremot en egen kedja, och det är den enda avvikelsen från
// ägarregeln i filen: checkAmountSek avvisar varje belopp som inte är större än
// noll, och en insättning får vara negativ. Kedjan nedan är skriven i samma
// ordning som checkAmountSeks med rad 1 bytt mot "inte noll", och gränsen läses
// ur AMOUNT_MAX_SEK och mönstret ur AMOUNT_PATTERN — båda hos sin ägare i
// entry.js.
const MESSAGES = Object.freeze({
  targetNotNumber: 'Målbeloppet måste vara ett tal.',
  targetInvalid: 'Målbeloppet måste vara ett belopp större än 0 kr, med högst två decimaler.',
  targetDate: 'Slutdatum måste anges som ÅÅÅÅ-MM-DD.',
  amountNotNumber: 'Beloppet måste vara ett tal.',
  amountZero: 'Beloppet får inte vara 0 kr. Skriv ett minustecken framför för ett uttag.',
  amountTooLarge: `Beloppet får vara högst ${formatAmountLimitSek(AMOUNT_MAX_SEK)} kr.`,
  amountTooManyDecimals: 'Beloppet får ha högst två decimaler.',
  madeOn: 'Datum måste anges som ÅÅÅÅ-MM-DD.'
});

// Sparmålets status. Tabellen i ARKITEKTUR.md under "Sparmål" är facit, och
// ordningen är bindande — första träff vinner:
//
//   1. savedOre >= targetOre      -> klart
//   2. targetDate saknas          -> pagaende
//   3. targetDate har passerat    -> forsenat
//   4. annars                     -> pagaende
//
// Rad 1 före rad 3 är hela skillnaden mot en handskriven kedja i omvänd ordning:
// ett nått mål med passerat slutdatum är klart, inte försenat. Det är (S7).
//
// Rad 2 före rad 3 är inte heller fri: compareIsoDates kastar för null, så ett mål
// utan slutdatum måste svara innan raden nås. Ett mål utan slutdatum kan dessutom
// inte vara försenat — det har ingen tidpunkt att vara sen mot.
//
// Spärrarna nedan är modulens ingångsspärrar, första träff vinner. Sparmålet
// kommer ur databasen, så ett värde som faller här är ett programmeringsfel och
// inte ett användarfel; texterna är skrivna för den som läser ett stackspår, på
// samma form som RangeError-texterna i bill.js, cost.js och dates.js.
//
// today prövas med en egen rad och inte bara av compareIsoDates: rad 2 svarar
// innan jämförelsen körs för varje mål utan slutdatum, och ett today som inte är
// ett datum hade då passerat tyst.
export function goalStatus(goal, today) {
  requireGoalFields('goalStatus', goal, today);
  if (goal.savedOre >= goal.targetOre) {
    return DONE;
  }
  if (goal.targetDate === null) {
    return ONGOING;
  }
  if (compareIsoDates(goal.targetDate, today) < 0) {
    return LATE;
  }
  return ONGOING;
}

// De sex räknade fälten. Svaret är { savedOre, leftOre, percent, monthsLeft,
// perMonthOre, status }, alltså tabellen under "Vad readGoals svarar" i
// ARKITEKTUR.md minus de tre fälten som står i goals-raden (id, name, targetOre,
// targetDate).
//
// savedOre skickas med orört: det är summan av insättningarna och KAN vara
// negativ, när uttagen överstiger insättningarna. leftOre är aldrig negativ — ett
// överskridet mål har noll kvar. De två fälten svarar på olika frågor, och det är
// därför ingen av dem räknas om till den andra (ARKITEKTUR.md under "Sparmål").
export function goalProgress(goal, today) {
  // Hela spärrkedjan ägs av goalStatus och anropas genom den: texterna namnger
  // därför goalStatus också när felet uppstår här. En andra kopia av kedjan hade
  // varit två facit för samma fråga (LARDOMAR.md 2026-09-02).
  const status = goalStatus(goal, today);
  const savedOre = normalizeZero(goal.savedOre);
  // Math.max och inte en if: frågan är "aldrig negativ", och ett överskridet mål
  // har noll kvar. normalizeZero äger villkoret "detta är -0" — targetOre är
  // alltid större än noll, så subtraktionen kan inte ge -0, men raden görs inte
  // starkare av att utelämna den.
  const leftOre = Math.max(0, goal.targetOre - savedOre);
  const monthsLeft = goal.targetDate === null ? null : wholeMonthsUntil(today, goal.targetDate);
  return {
    savedOre,
    leftOre,
    percent: clampedPercent(savedOre, goal.targetOre),
    monthsLeft,
    perMonthOre: monthsLeft === null ? null : perMonthOre(leftOre, monthsLeft),
    status
  };
}

// Sparmålets tre fält från användaren, validerade och målbeloppet omräknat till
// ören. Svaret är { ok: true, value } eller { ok: false, errors }, samma form som
// validateBillDraft i bill.js och validateMonthItemDraft i item.js.
//
// Fältordningen i errors är bindande och följer formuläret: name, targetSek,
// targetDate. Alla tre prövas, aldrig bara det första — ett formulär med tre fel
// ska visa tre meddelanden samtidigt.
//
// value bär targetOre och aldrig kronor: sekToOre är enda stället i projektet där
// ett kronbelopp blir öre. value bär alltid targetDate, också när användaren
// lämnat fältet tomt — då som null. Två former av samma value hade tvingat varje
// anropare att fråga vilken av dem den fick.
export function validateGoalDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const target = checkTargetSek(source.targetSek);
  if (target.message) {
    errors.push({ field: 'targetSek', message: target.message });
  } else {
    // Kastar inte här: checkAmountSek har redan avvisat allt som inte är ett
    // finit tal, och dess fjärde steg kräver att det avrundade värdet är minst
    // ett öre — alltså precis vad schemats CHECK (target_ore > 0) kräver.
    value.targetOre = sekToOre(target.value);
  }

  const targetDate = checkTargetDate(source.targetDate);
  if (targetDate.message) {
    errors.push({ field: 'targetDate', message: targetDate.message });
  } else {
    value.targetDate = targetDate.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Insättningens två fält från användaren, validerade och beloppet omräknat till
// ören. Samma svarsform och samma bindande fältordning som ovan: amountSek,
// madeOn.
//
// value.amountOre kan vara negativt och är aldrig noll — se checkDepositAmountSek
// nedan. Schemats CHECK (amount_ore <> 0) är sista utposten mot samma fel.
export function validateDepositDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const amount = checkDepositAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    value.amountOre = sekToOre(amount.value);
  }

  const madeOn = checkMadeOn(source.madeOn);
  if (madeOn.message) {
    errors.push({ field: 'madeOn', message: madeOn.message });
  } else {
    value.madeOn = madeOn.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Målbeloppet. Regelkedjan ägs av checkAmountSek i entry.js och anropas här;
// bara meddelandet byts, eftersom fältet heter Målbelopp och inte Belopp.
//
// Två texter och inte fem: checkAmountSeks fem meddelanden skiljer "inte ett tal"
// från fyra värdefel, och den skillnaden är den enda som ändrar vad användaren
// ska göra åt saken. Vilket av värdefelen som vann står inte i svaret — en text
// som räknar upp alla tre reglerna samtidigt är kortare att läsa än fyra texter
// som skiljer sig på ett ord. Gränsen 9 999 999,99 nämns inte: den är orimlig
// som målbelopp och skulle göra texten längre än den hjälper.
function checkTargetSek(raw) {
  const result = checkAmountSek(raw);
  if (!result.message) {
    return { value: result.value };
  }
  // normalizeDepositAmountSek är ägaren till frågan "går råvärdet alls att läsa
  // som ett tal". Den används här för att välja mellan de två texterna, inte för
  // att pröva värdet: det har checkAmountSek redan gjort.
  return { message: normalizeDepositAmountSek(raw) === null ? MESSAGES.targetNotNumber : MESSAGES.targetInvalid };
}

// Slutdatumet, eller null när användaren inte anger något.
//
// Valfritt: ett sparmål utan slutdatum är ett giltigt sparmål — det har bara
// ingen månadstakt och kan inte vara försenat. Tomt betyder null, och formuläret
// kan skicka antingen ingen nyckel alls, null eller den tomma strängen. Alla tre
// ger samma svar, precis som checkOccurredOn och checkNote i item.js gör för sina
// fält.
//
// Giltigheten ägs av isValidIsoDate i dates.js, som prövar både formatet och att
// datumet finns — '2026-02-30' matchar mönstret utan att vara ett datum. En enda
// text för båda felen, av samma skäl som checkDueDate i bill.js har en:
// isValidIsoDate avgör format och giltighet i samma fråga, så en andra text hade
// krävt en andra kontroll att hålla i takt med den.
//
// Ingen årsgräns och ingen kontroll mot dagens datum: ett slutdatum som redan har
// passerat är giltigt och ger statusen forsenat (rad 3 i tabellen). Att avvisa det
// hade gjort statusen onåbar för varje mål användaren själv skapar.
function checkTargetDate(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.targetDate };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.targetDate };
  }
  return { value: trimmed };
}

// Insättningens dag. Obligatorisk: en insättning utan dag går inte att placera i
// tiden, och till skillnad från slutdatumet finns ingen rimlig tolkning av tomt.
// Samma ägare och samma enda text som checkTargetDate ovan, men en egen sträng —
// fältet heter Datum och inte Slutdatum.
function checkMadeOn(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.madeOn };
  }
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.madeOn };
  }
  return { value: trimmed };
}

// Insättningens belopp i kronor, kanoniskt avrundat. Till skillnad från varje
// annat belopp i appen får det vara NEGATIVT: den som tar ut pengar ur sitt
// sparande ska kunna registrera det, annars visar målet mer än som finns. Noll är
// däremot meningslöst och avvisas.
//
// Kedjan är checkAmountSeks med rad 1 ("> 0") bytt mot "inte 0", och den körs i
// samma ordning av samma skäl: maxgränsen före decimalregeln, därför att
// decimalregeln är en toleransjämförelse där 1e-6 bara håller så länge
// |v| * ORE_PER_SEK ligger under ungefär 1e9 (LARDOMAR.md 2026-08-18).
//
// Regel 1 prövas om på det värde som faktiskt lagras, precis som i
// checkAmountSek: varje v vars v * ORE_PER_SEK avrundas till noll ryms under
// decimalregelns tolerans (t.ex. 1e-9 och -1e-9), och utan den raden lagras ett
// belopp som bryter mot schemats CHECK (amount_ore <> 0)
// (LARDOMAR.md 2026-09-02).
//
// En enda valideringsväg för båda ingångstyperna: steg 1 normaliserar råvärdet
// till ett finit tal, steg 2 kör kedjan på talet. Samma värde ska ge samma
// meddelande oavsett om det kom in som sträng eller som tal (LARDOMAR.md
// 2026-08-18).
function checkDepositAmountSek(raw) {
  const v = normalizeDepositAmountSek(raw);
  if (v === null) {
    return { message: MESSAGES.amountNotNumber };
  }
  if (v === 0) {
    return { message: MESSAGES.amountZero };
  }
  if (Math.abs(v) > AMOUNT_MAX_SEK) {
    return { message: MESSAGES.amountTooLarge };
  }
  if (Math.abs(v * ORE_PER_SEK - Math.round(v * ORE_PER_SEK)) >= 1e-6) {
    return { message: MESSAGES.amountTooManyDecimals };
  }
  const ore = Math.round(v * ORE_PER_SEK);
  if (ore === 0) {
    return { message: MESSAGES.amountZero };
  }
  // normalizeZero äger villkoret "detta är -0". Division av ett ören-tal som inte
  // är noll kan inte ge -0, men raden görs inte starkare av att utelämna den, och
  // regeln säger att ingen exporterad funktion i src/core/ får returnera -0
  // (LARDOMAR.md 2026-09-02).
  return { value: normalizeZero(ore / ORE_PER_SEK) };
}

// Steg 1 i kedjan ovan, och enda stället i filen som läser ett råvärde.
// AMOUNT_PATTERN i entry.js äger formatet och tillåter ett ledande minustecken,
// så mönstret skrivs inte av här. Mönstret är tillåtande nog att varje tal når
// värdereglerna: '10000000' avvisas av gränsen och inte av formatet
// (LARDOMAR.md 2026-08-18).
//
// Number.isFinite coercar inte: 1n och Symbol('x') ger false i stället för att
// kasta TypeError, och NaN, Infinity och -Infinity avvisas här.
function normalizeDepositAmountSek(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!AMOUNT_PATTERN.test(trimmed)) {
      return null;
    }
    return Number(trimmed.replace(',', '.'));
  }
  return null;
}

// percent, klippt i båda ändar. Heltal, avrundat nedåt.
//
// De två ytterfallen prövas före divisionen, och det är inte bara en klippning:
// i mittengrenen gäller 0 < savedOre < targetOre <= 999999999, så savedOre *
// PERCENT_FULL ligger under 1e11 och är alltid ett säkert heltal. Skrevs
// klippningen i stället på resultatet av divisionen kunde multiplikationen lämna
// det säkra heltalsområdet för en summa av många insättningar, och svaret hade
// blivit tyst oexakt (LARDOMAR.md 2026-09-02).
function clampedPercent(savedOre, targetOre) {
  if (savedOre <= 0) {
    return PERCENT_MIN;
  }
  if (savedOre >= targetOre) {
    return PERCENT_FULL;
  }
  return Math.floor((savedOre * PERCENT_FULL) / targetOre);
}

// Hur mycket som ska sparas per månad för att nå målet.
//
// monthsLeft noll ger hela leftOre: allt som återstår ska sparas nu, och en
// division med noll får aldrig uppstå (ARKITEKTUR.md under "Sparmål"). Grenen är
// inte en artighet mot divideRoundHalfUp utan svaret på en verklig fråga — ett
// slutdatum i denna månad eller tidigare betyder att hela beloppet är den här
// månadens takt. Det är (S5).
//
// Divisionen går genom divideRoundHalfUp i money.js, som äger "halva öret uppåt".
// Ingen egen avrundning står i den här filen.
function perMonthOre(leftOre, monthsLeft) {
  if (monthsLeft === 0) {
    return leftOre;
  }
  return divideRoundHalfUp(leftOre, monthsLeft);
}

// Hela månader från today till targetDate, aldrig negativt.
//
// Noll när slutdatumet ligger i denna månad eller har passerat: då är hela
// leftOre den här månadens takt, och perMonthOre ovan behöver aldrig dividera med
// noll.
//
// Räknas på MÅNADEN och inte på dagen: "hela månader" är skillnaden mellan två
// månadsnummer, inte ett antal dagar delat med 30. Ett slutdatum den 1 i en månad
// tre månader bort ger alltså 3, precis som den 31 i samma månad.
//
// Talet 12 läses ur MONTHS_PER_YEAR i cost.js, som är ägaren till den rollen i
// src/core/ (LARDOMAR.md 2026-09-02). Importen är ingen cykel: cost.js importerar
// entry.js och money.js, och ingen av dem importerar den här filen. dates.js har
// samma tal i samma roll men exporterar det inte med flit, och dess
// månadsexporter är en bindande uppräkning av sex funktioner i ARKITEKTUR.md —
// en sjunde är ett arkitektbeslut och inte byggarens, så subtraktionen står här.
//
// parseIsoDate ägar frågan "vilket år och vilken månad är det här"; den här
// funktionen klipper ingen sträng med slice. Båda datumen har redan passerat
// isValidIsoDate i requireGoalFields, så inget av uppslagen kan vara null.
function wholeMonthsUntil(today, targetDate) {
  const from = parseIsoDate(today);
  const to = parseIsoDate(targetDate);
  const months = (to.year - from.year) * MONTHS_PER_YEAR + (to.month - from.month);
  return Math.max(0, months);
}

// Modulens ingångsspärrar, första träff vinner. Ägaren till kedjan: den anropas
// av goalStatus och, genom den, av goalProgress — en andra handskriven kopia är
// just det ägarregeln förbjuder.
//
// functionName står som parameter och inte som en literal, så att meddelandet
// namnger den funktion anroparen anropade. I dag är det alltid 'goalStatus', och
// det är med flit: goalProgress delegerar hela kedjan dit, och ett meddelande som
// namngav goalProgress hade påstått att felet uppstod i en annan kontroll.
//
// Number.isSafeInteger och inte Number.isInteger: ett ören-tal utanför det säkra
// heltalsområdet räknas inte exakt, och predikatet coercar inte — 1n och
// Symbol('x') ger false i stället för att kasta TypeError ur jämförelsen.
function requireGoalFields(functionName, goal, today) {
  if (!isPlainObject(goal)) {
    throw new RangeError(`${functionName} kräver ett sparmål som objekt.`);
  }
  if (!Number.isSafeInteger(goal.targetOre) || goal.targetOre <= 0) {
    throw new RangeError(`${functionName} kräver ett targetOre större än 0, fick "${String(goal.targetOre)}".`);
  }
  if (!Number.isSafeInteger(goal.savedOre)) {
    throw new RangeError(`${functionName} kräver ett savedOre som ett säkert heltal, fick "${String(goal.savedOre)}".`);
  }
  if (goal.targetDate !== null && !isValidIsoDate(goal.targetDate)) {
    throw new RangeError(`${functionName} kräver ett targetDate på formen ÅÅÅÅ-MM-DD eller null, fick "${String(goal.targetDate)}".`);
  }
  if (!isValidIsoDate(today)) {
    throw new RangeError(`${functionName} kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
  }
}

// Gränsen skriven som ett belopp med tusentalsavgränsare, för meddelandet ovan.
// En handskriven kopia av samma funktion i entry.js, som inte exporterar den.
// Alternativet vore att skriva ut strängen '9 999 999,99' som en literal, och då
// hade gränsen stått på två ställen i två former — talet läses nu ur
// AMOUNT_MAX_SEK, som är ägaren.
function formatAmountLimitSek(amountSek) {
  const [whole, fraction] = amountSek.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
}
