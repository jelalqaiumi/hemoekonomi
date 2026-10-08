// UI-logik för inloggningsvyn och månadsvyn [etapp 3]. Ingen ny logik: etiketter,
// månadsnamn, belopp och validering kommer ur src/core/, som servern levererar
// under /core/.
//
// Sidan har två tillstånd och ingen router. GET /api/mig avgör vilket: 401 visar
// inloggningsvyn, 200 visar månadsvyn. Ett 401 från någon annan väg senare i
// körningen visar inloggningsvyn igen — sessionen kan gå ut medan sidan är öppen.
import {
  BILL_STATUSES,
  REMIND_DAYS_DEFAULT,
  REMIND_DAYS_MAX,
  REMIND_DAYS_MIN,
  billDaysText
} from '/core/bill.js';
import { monthLabel, monthName, monthOfIsoDate, shiftMonth, todayIso } from '/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '/core/entry.js';
import { ITEM_KINDS } from '/core/item.js';
import { FEATURE_LABELS, PLANS, PLAN_LABELS } from '/core/plans.js';
import { divideRoundHalfUp, formatSek, oreToSek } from '/core/money.js';

// Text mot användaren som varken kommer från servern eller från src/core/ står
// ordagrant i ARKITEKTUR.md och får inte skrivas om. Uppräkningen bär inget antal
// och inte ordet enda: ett krav med siffra blir falskt av nästa tillägg
// (LARDOMAR.md 2026-09-10).
//
// GENERAL_ERROR visas när ett svar varken bär error eller fieldErrors, till
// exempel när servern inte svarar alls.
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const CHART_EMPTY_TEXT = 'Inga utgifter att visa i diagrammet ännu.';
// SVG:ns <title>. role="img" plus en title gör diagrammet läsbart med
// skärmläsare.
const CHART_TITLE = 'Utgifter per kategori';
// U+21BB CLOCKWISE OPEN CIRCLE ARROW. Märket på en post som kommer från en mall.
// Skrivs som escape och aldrig som råtecken: ett tecken utanför ASCII som inte är
// en bokstav i ett svenskt ord går inte att skilja från sina grannar i en
// genomläsning (LARDOMAR.md 2026-09-14).
const RECURRING_MARK = '\u21bb';
const RECURRING_TITLE = 'Återkommande varje månad';
// Min plan [steg 1 i del 5]. Bekräftelsen efter ett byte, ordagrant ur
// ARKITEKTUR.md under "Byta plan". Ingen knapp och ingen text antyder att
// pengar dras: planbytet är en UPDATE av en kolumn, och texten säger det.
const PLAN_DEMO_NOTE = 'Demo: ingen betalning genomförs.';
// Knappens text på de tre planknapparna. Samma form som prissidans kort:
// Välj Bas, Välj Plus, Välj Premium.
function choosePlanLabel(plan) {
  return `Välj ${PLAN_LABELS[plan]}`;
}

// Kvar-beloppets ledtext i budgetkortet [steg 2], ur raden
// "Mat        4 000,00 kr    kvar 1 240,00 kr" i ARKITEKTUR.md. Beloppet kommer
// ur svarets leftOre och skrivs av formatSek — ordet är det enda app.js lägger
// till.
const BUDGET_LEFT_PREFIX = 'kvar ';

function budgetLeftText(leftOre) {
  return `${BUDGET_LEFT_PREFIX}${formatSek(leftOre)}`;
}

// Räkningskortets två egna texter [steg 3]. Dagtexten står INTE här: den ägs av
// billDaysText i src/core/bill.js, eftersom den räknas fram ur ett tal.
//
// Betald är knappen på varje rad, och Engångs är det första alternativet i
// formulärets intervallfält - det alternativ en räkning utan intervall har.
// Båda står ordagrant i ARKITEKTUR.md under "Gränssnittet" respektive
// "Dagtexterna med naturlig svenska".
const BILL_PAID_LABEL = 'Betald';
const BILL_ONE_TIME_LABEL = 'Engångs';

const SAVE_LABEL = 'Spara';
const SAVE_CHANGE_LABEL = 'Spara ändring';
const EDIT_LABEL = 'Ändra';
const REMOVE_LABEL = 'Ta bort';

// Frågorna en rad som kommer från en mall ställer [etapp 4], ur tabellen under
// "Gränssnittets två frågor skrivs om" i ARKITEKTUR.md. Varje fråga har TVÅ val:
// Hela serien är borttaget av rättelsen av etapp 4, och ingen varningstext finns
// därför — ingen av de två vägarna rör en passerad månad.
const EDIT_QUESTION = 'Vad ska ändras?';
const REMOVE_QUESTION = 'Vad ska tas bort?';
// Valens etiketter. Månaden skrivs med monthLabel, alltså Oktober 2026.
function onlyMonthLabel(month) {
  return `Bara ${monthLabel(month)}`;
}

function fromMonthLabel(month) {
  return `Från och med ${monthLabel(month)}`;
}

// Raden i formuläret i läget Bara <månad>, ur ARKITEKTUR.md under rättelsen
// "Bara <månad> döljer de fält som inte går att ändra".
function monthOnlyNoteText(month) {
  return `Ändrar bara beloppet för ${monthLabel(month)}.`;
}

function codeSentText(email) {
  return `En kod är skickad till ${email}. Den gäller i tio minuter.`;
}

// Slagens namn. Värdena ägs av ITEM_KINDS i src/core/item.js, som är listan
// valideringen prövar mot; konstanterna här är filens enda skrivning av var och
// en av de tre strängarna, och LISTS nedan läser sina nycklar ur dem.
const INCOME = 'income';
const EXPENSE = 'expense';
const SAVING = 'saving';

// De tre listorna: elementens id:n och den egna tomtexten. Månadens namn står i
// gemener i texten ("Inga utgifter i oktober ännu"), och bindestrecket är ASCII
// och inget tankstreck.
const LISTS = Object.freeze({
  [INCOME]: Object.freeze({
    list: '#income-list',
    empty: '#income-empty',
    add: '#add-income',
    emptyText: (month) => `Inga inkomster i ${month} ännu - lägg till din första.`
  }),
  [EXPENSE]: Object.freeze({
    list: '#expense-list',
    empty: '#expense-empty',
    add: '#add-expense',
    emptyText: (month) => `Inga utgifter i ${month} ännu - lägg till din första.`
  }),
  [SAVING]: Object.freeze({
    list: '#saving-list',
    empty: '#saving-empty',
    add: '#add-saving',
    emptyText: (month) => `Inget sparande i ${month} ännu - lägg till ditt första.`
  })
});

// Diagrammets mått i SVG:ns egna användarenheter. viewBox skalar dem till
// kortets bredd, så inget tal här är pixlar.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 100;
const CHART_ROW_HEIGHT = 14;
const CHART_BAR_HEIGHT = 5;
const CHART_TEXT_BASELINE = 5;
const CHART_BAR_TOP = 7;

// Översiktens diagram [etapp 5]. Staplarna står bredvid varandra, en per månad,
// och nollinjen ligger på halva höjden: en månad får växa lika långt nedåt som
// uppåt. OVERVIEW_CHART_HALF är därför både nollinjens y och den högsta
// stapelns höjd.
const OVERVIEW_CHART_WIDTH = 120;
const OVERVIEW_CHART_HALF = 20;
// Luften mellan två staplar, dragen från kolumnens bredd.
const OVERVIEW_BAR_GAP = 2;
const OVERVIEW_CHART_TITLE = 'Kvar att leva på per månad';
// Klasserna som hämtar var(--positiv) och var(--negativ) i style.css. Står som
// namn och inte som literaler i renderOverviewChart: samma sträng läses av
// koden och av testfallet (76).
const OVERVIEW_BAR_POSITIVE = 'overview-bar overview-bar-positive';
const OVERVIEW_BAR_NEGATIVE = 'overview-bar overview-bar-negative';

const LOGIN_VIEW = document.querySelector('#login-view');
const LOGIN_STEP_EMAIL = document.querySelector('#login-step-email');
const LOGIN_STEP_CODE = document.querySelector('#login-step-code');
const LOGIN_EMAIL = document.querySelector('#login-email');
const LOGIN_CODE = document.querySelector('#login-code');
const SEND_CODE = document.querySelector('#send-code');
const LOG_IN = document.querySelector('#log-in');
const USE_OTHER_EMAIL = document.querySelector('#use-other-email');
const CODE_SENT = document.querySelector('#code-sent');
const LOGIN_ERROR = document.querySelector('#login-error');

const MONTH_VIEW = document.querySelector('#month-view');
const MONTH_PREV = document.querySelector('#month-prev');
const MONTH_NEXT = document.querySelector('#month-next');
const MONTH_LABEL = document.querySelector('#month-label');
const MONTH_ERROR = document.querySelector('#month-error');
const USER_EMAIL = document.querySelector('#user-email');
const LOG_OUT = document.querySelector('#log-out');

const TOTAL_INCOME = document.querySelector('#total-income');
const TOTAL_EXPENSE = document.querySelector('#total-expense');
const TOTAL_SAVING = document.querySelector('#total-saving');
const TOTAL_LEFT = document.querySelector('#total-left');

const CHART = document.querySelector('#chart');
const CHART_EMPTY = document.querySelector('#chart-empty');

// Översiktens vy [etapp 5]. Knappen Översikt ligger i sidomenyn, alltså i
// månadsvyn; Tillbaka till månaden ligger i översikten.
const OVERVIEW_VIEW = document.querySelector('#overview-view');
const SHOW_OVERVIEW = document.querySelector('#show-overview');
const BACK_TO_MONTH = document.querySelector('#back-to-month');
const OVERVIEW_LABEL = document.querySelector('#overview-label');
const OVERVIEW_SAVED = document.querySelector('#overview-saved');
const OVERVIEW_AVERAGE = document.querySelector('#overview-average');
const OVERVIEW_BEST = document.querySelector('#overview-best');
const OVERVIEW_CHART = document.querySelector('#overview-chart');
const OVERVIEW_ROWS = document.querySelector('#overview-rows');

// Min plan [steg 1 i del 5]. Knappen Min plan ligger i sidomenyn, alltså i
// månadsvyn; Tillbaka till månaden ligger i vyn.
const PLAN_VIEW = document.querySelector('#plan-view');
const SHOW_PLAN = document.querySelector('#show-plan');
const BACK_FROM_PLAN = document.querySelector('#back-from-plan');
const PLAN_CURRENT = document.querySelector('#plan-current');
const PLAN_FEATURES = document.querySelector('#plan-features');
const PLAN_BUTTONS = document.querySelector('#plan-buttons');
const PLAN_NOTE = document.querySelector('#plan-note');
const PLAN_ERROR = document.querySelector('#plan-error');

const FORM_CARD = document.querySelector('#item-form-card');
const FORM = document.querySelector('#item-form');
const FORM_ERROR = document.querySelector('#item-form-error');
const SUBMIT_BUTTON = document.querySelector('#item-submit');
const CANCEL_BUTTON = document.querySelector('#item-cancel');

// Kryssrutan Återkommande och de två fälten den öppnar [etapp 4]. Fälten läses
// som element och inte ur FORM.elements, av samma skäl som kryssrutan: en
// kryssruta bär sitt värde i checked och inte i value, och de tre hör ihop.
const RECURRING_CHECKBOX = document.querySelector('#item-recurring');
const RECURRING_FIELDS = document.querySelector('#recurring-fields');
const INTERVAL_FIELD = document.querySelector('#item-interval');
const TO_MONTH_FIELD = document.querySelector('#item-to-month');

// Fältblocken som döljs i läget Bara <månad>, plus raden som säger varför. En
// avvikelse kan bara bära ett belopp — overrides har varken en kolumn för namn
// eller för kategori — så ett redigerbart namnfält i det läget är ett fält vars
// ändring försvinner tyst när formuläret skickas.
const NAME_FIELD_BLOCK = document.querySelector('#name-field');
const CATEGORY_FIELD_BLOCK = document.querySelector('#category-field');
const RECURRING_FIELD_BLOCK = document.querySelector('#recurring-field');
const MONTH_ONLY_NOTE = document.querySelector('#month-only-note');

// Datum och Kommentar [steg 2], de två fält bara en engångspost har. Blocket
// döljs i två lägen, båda av samma skäl: en mall har varken en enskild dag eller
// en enskild kommentar, och en avvikelse bär bara ett belopp. Se
// updateSingleFields nedan.
const SINGLE_FIELDS = document.querySelector('#single-fields');
const OCCURRED_ON_FIELD = document.querySelector('#item-occurred-on');
const NOTE_FIELD = document.querySelector('#item-note');

// Budgetkortet [steg 2]. Listan ritas ur fältet budgets i månadens svar, och
// formuläret knappen öppnar skickar PUT /api/budget/<ÅÅÅÅ-MM>.
const BUDGET_LIST = document.querySelector('#budget-list');
const ADD_BUDGET = document.querySelector('#add-budget');
const BUDGET_FORM = document.querySelector('#budget-form');
const BUDGET_CATEGORY_FIELD = document.querySelector('#budget-category');
const BUDGET_AMOUNT_FIELD = document.querySelector('#budget-amount');
const BUDGET_FORM_ERROR = document.querySelector('#budget-form-error');
const BUDGET_SUBMIT = document.querySelector('#budget-submit');
const BUDGET_CANCEL = document.querySelector('#budget-cancel');

// Räkningskortet [steg 3]. Ligger i månadsvyn, över budgetkortet. Formuläret har
// fem fält och en enda felruta, samma form som budgetformuläret.
const BILL_LIST = document.querySelector('#bill-list');
const ADD_BILL = document.querySelector('#add-bill');
const BILL_FORM = document.querySelector('#bill-form');
const BILL_NAME_FIELD = document.querySelector('#bill-name');
const BILL_AMOUNT_FIELD = document.querySelector('#bill-amount');
const BILL_DUE_DATE_FIELD = document.querySelector('#bill-due-date');
const BILL_INTERVAL_FIELD = document.querySelector('#bill-interval');
const BILL_REMIND_DAYS_FIELD = document.querySelector('#bill-remind-days');
const BILL_FORM_ERROR = document.querySelector('#bill-form-error');
const BILL_SUBMIT = document.querySelector('#bill-submit');
const BILL_CANCEL = document.querySelector('#bill-cancel');

// Fälten i formuläret, i samma ordning som validateMonthItemDraft rapporterar
// dem. Fältet kind står inte här: slaget kommer från vilken lista knappen satt i
// och är inget fält, så ett fieldError för kind har inget element att skrivas
// vid och hamnar i den allmänna rutan — samma väg som varje annat svar utan
// fältfel.
// occurredOn och note står efter de tre första därför att de står där i
// formuläret, samma ordning som validateMonthItemDraft rapporterar dem [steg 2].
// interval och toMonth står sist därför att kryssrutan Återkommande öppnar dem
// under de andra, samma ordning som validateTemplateDraft rapporterar dem.
const FORM_FIELDS = ['name', 'amountSek', 'category', 'occurredOn', 'note', 'interval', 'toMonth'];

// Formulärets fyra lägen [etapp 4]. Vilken väg en sparning går avgörs av läget,
// aldrig av kryssrutan — utom i MODE_NEW, där kryssrutan väljer mellan månadens
// engångspost och en mall. Ett läge per väg, så att ingen hanterare behöver
// gissa.
const MODE_NEW = 'new';
const MODE_ITEM = 'item';
const MODE_MONTH = 'month';
const MODE_SERIES = 'series';

// Dagens datum, och filens enda klockläsning. Tre läsare: månadsvyn öppnar den
// månad dagen ligger i, räkningskortet hämtas för dagen, och Betald skickar
// dagen med i kroppen. Alla tre läser samma sträng - en andra läsning hade
// kunnat ge två olika dagar i samma klickning, om dygnet byttes mittemellan, och
// då skulle sökvägen och kroppen kunna säga olika saker om samma handling.
//
// Dagen läses vid laddningen och inte vid varje rendering: den sida som står
// öppen över midnatt visar den dag den öppnades, precis som månadsvyn alltid
// gjort.
const TODAY = todayIso();
// Månaden vyn visar. Knapparna räknar därefter med shiftMonth.
let currentMonth = monthOfIsoDate(TODAY);
// E-postadressen koden skickades till. Behövs i steg två, som bara skickar koden.
let loginEmail = '';
// Id:t formuläret ändrar, eller null när formuläret gäller en ny post.
let editingId = null;
// Slaget formuläret gäller, satt av knappen som öppnade det.
let formKind = null;
// Formulärets läge, satt av knappen eller valet som öppnade det.
let formMode = MODE_NEW;
// Seriens id när formuläret gäller en ändring från och med månaden, annars null.
let formSeriesId = null;
// Den senast öppnade frågans element, eller null. Högst en fråga är öppen: en
// andra fråga stänger den första, så att två rader aldrig frågar samtidigt.
//
// Variabeln nollställs INTE vid en rendering. En rad som byggts om är ett annat
// element, så jämförelsen i showQuestion är då sann och den gamla rutan döljs i
// onödan — utan att något syns, eftersom rutan inte längre står i vyn. En rad
// som nollställde variabeln vid varje rendering överlevde mutation
// (tests/app.test.js gav tests 65, pass 65, fail 0 och EXIT=0 utan den), och en
// rad som ingen indata kan fälla är ingen spärr (LARDOMAR.md 2026-09-04).
let openQuestion = null;
// Formulärets eget pågående-läge. Knappens disabled duger inte som enda spärr:
// den stoppar bara klick, och en submit-händelse behöver inte komma från knappen.
let submitInProgress = false;
// Budgetformulärets eget pågående-läge, av samma skäl: Enter i beloppsfältet
// skickar formuläret direkt, förbi den avstängda knappen.
let budgetSubmitInProgress = false;
// Räkningsformulärets eget pågående-läge, av samma skäl som de två andras: Enter
// i ett fält skickar formuläret direkt, förbi den avstängda knappen.
let billSubmitInProgress = false;
// Om formuläret står i läget Bara <månad>. Satt av setMonthOnlyLayout och läst av
// updateSingleFields, som behöver både det här läget och kryssrutans: blocket med
// Datum och Kommentar döljs av vilket som helst av de två, och ett villkor som
// läste bara det ena hade visat fälten igen så snart det andra ändrades.
let monthOnlyLayout = false;

function fieldErrorElement(field) {
  return document.querySelector(`#error-${field}`);
}

function clearFormErrors() {
  FORM_ERROR.textContent = '';
  for (const field of FORM_FIELDS) {
    fieldErrorElement(field).textContent = '';
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// Svarets egen text när den finns, annars appens. Inget felsvar får leda till att
// ingenting syns.
function generalText(body) {
  return typeof body.error === 'string' ? body.error : GENERAL_ERROR;
}

// Uppslaget går från formuläret till svaret, aldrig tvärtom: för vart och ett av
// de kända fälten söks det första fieldError med det field. Ett okänt field kan
// därmed varken hittas eller slå i en null-referens. Visades inget fältfel alls
// visas den allmänna texten.
function showFormErrors(body) {
  clearFormErrors();

  const fieldErrors = Array.isArray(body.fieldErrors) ? body.fieldErrors : [];
  let showedFieldError = false;

  for (const field of FORM_FIELDS) {
    const fieldError = fieldErrors.find((candidate) => candidate.field === field);
    if (fieldError !== undefined) {
      fieldErrorElement(field).textContent = fieldError.message;
      showedFieldError = true;
    }
  }

  if (!showedFieldError) {
    FORM_ERROR.textContent = generalText(body);
  }
}

// Etiketterna ägs av src/core/entry.js. Nycklarna är samma nycklar som
// valideringen godkänner, så en post kan aldrig bära ett värde som saknas här.
function fillOptions(selectId, labels) {
  const select = document.querySelector(selectId);
  for (const [value, label] of Object.entries(labels)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function showLoginView() {
  LOGIN_VIEW.hidden = false;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = true;
  PLAN_VIEW.hidden = true;
  LOGIN_STEP_EMAIL.hidden = false;
  LOGIN_STEP_CODE.hidden = true;
  CODE_SENT.textContent = '';
  LOGIN_CODE.value = '';
}

function showMonthView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = false;
  OVERVIEW_VIEW.hidden = true;
  PLAN_VIEW.hidden = true;
}

// Översikten är en vy och ingen egen sida: samma tre rader som ovan, med ett
// annat element synligt. Ingen router.
function showOverviewView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = false;
  PLAN_VIEW.hidden = true;
}

// Min plan är en vy och ingen egen sida: samma fyra rader som ovan, med ett
// annat element synligt. Ingen router.
function showPlanView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = true;
  PLAN_VIEW.hidden = false;
}

// Ett 401 betyder att sessionen gått ut medan sidan var öppen. Vyn byts, och
// ingen feltext skrivs: inloggningsvyn är beskedet. Svaret är true när anroparen
// inte ska göra något mer.
function sessionExpired(response) {
  if (response.status !== 401) {
    return false;
  }
  showLoginView();
  return true;
}

// Den inloggade adressen. Den kommer ur svaret och aldrig ur det användaren
// skrev i inloggningsformuläret: servern normaliserar e-posten med trim och
// gemener (src/server/auth.js), så de två kan skilja sig. Ett 200 utan läsbar
// kropp ger ingen adress alls — textContent = undefined skriver strängen
// "undefined" i webbläsaren.
function renderUser(email) {
  USER_EMAIL.textContent = typeof email === 'string' ? email : '';
}

// En cell med en klass och en text. tagName står som ett argument med span som
// förval: översiktens tabell behöver td, och en andra, nästan likadan hjälpare
// hade varit två ägare till samma tre rader.
function cell(className, text, tagName = 'span') {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function actionButton(className, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  // Knappen skickas till hanteraren, som spärrar den under anropet. Den läses ur
  // stängningen och aldrig ur händelsens target: attrappen har inga
  // Event-objekt, och en hanterare som behöver ett är inte prövbar.
  button.addEventListener('click', () => {
    onClick(button);
  });
  return button;
}

// Ett tal ur svaret, prövat innan det når formatSek: formatSek kastar RangeError
// för allt som inte är ett heltal, och ett 200 utan läsbar JSON-kropp ger en tom
// kropp. Vyn visar då nollor i stället för att gå sönder.
function oreFromResponse(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function renderItem(item) {
  const row = document.createElement('li');
  row.className = 'item';

  row.append(
    cell('item-name', item.name),
    cell('item-category', CATEGORY_LABELS[item.category]),
    cell('item-amount', formatSek(oreFromResponse(item.amountOre)))
  );

  // Posten kommer från en mall: märket plus texten som title. Fältet recurring
  // sätts av src/server/months.js — app.js avgör aldrig själv om en post är
  // återkommande.
  if (item.recurring === true) {
    const mark = cell('item-recurring', RECURRING_MARK);
    mark.title = RECURRING_TITLE;
    row.append(mark);
  }

  // En engångspost har inga val: Ändra öppnar formuläret och Ta bort tar bort,
  // precis som före etapp 4. En mallpost frågar först, eftersom båda knapparna
  // då har två utfall.
  if (item.recurring !== true) {
    row.append(
      actionButton('edit', EDIT_LABEL, () => {
        openForm(item.kind, item, MODE_ITEM);
      }),
      actionButton('remove', REMOVE_LABEL, (button) => {
        void sendChange(button, {
          url: `/api/poster/${item.id}`,
          method: 'DELETE',
          body: null,
          okStatus: 204
        });
      })
    );
    return row;
  }

  // Frågans ruta byggs tom vid renderingen och fylls av showQuestion. Den ligger
  // i raden, så att frågan står vid den post den gäller, och den försvinner av
  // sig själv vid nästa rendering — en lyckad ändring hämtar om månaden.
  const question = document.createElement('div');
  question.className = 'item-question';
  question.hidden = true;

  row.append(
    actionButton('edit', EDIT_LABEL, () => {
      showQuestion(question, EDIT_QUESTION, [
        // Bara månaden: en avvikelse bär bara ett belopp, så formuläret skickar
        // amountSek till PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>.
        ['scope-month', onlyMonthLabel(currentMonth), () => {
          openForm(item.kind, item, MODE_MONTH);
        }],
        // Från och med månaden: en ny version av serien, alltså mallens sex fält
        // till PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>.
        ['scope-forward', fromMonthLabel(currentMonth), () => {
          openForm(item.kind, item, MODE_SERIES);
        }]
      ]);
    }),
    actionButton('remove', REMOVE_LABEL, () => {
      showQuestion(question, REMOVE_QUESTION, [
        // Bara månaden: posten hoppas över just den månaden. Samma väg som
        // ändringen av en enda månad, med den andra kroppsformen.
        ['scope-month', onlyMonthLabel(currentMonth), (button) => {
          void sendChange(button, {
            url: `/api/poster/${item.id}/manad/${currentMonth}`,
            method: 'PUT',
            body: { skipped: true },
            okStatus: 200
          });
        }],
        // Från och med månaden: serien avslutas. Vägen har ingen kropp — vad som
        // ska hända står i metoden och i sökvägen.
        ['scope-forward', fromMonthLabel(currentMonth), (button) => {
          void sendChange(button, {
            url: `/api/mallar/${item.seriesId}/${currentMonth}`,
            method: 'DELETE',
            body: null,
            okStatus: 204
          });
        }]
      ]);
    }),
    question
  );

  return row;
}

// Frågan i en rad: texten och valen. Högst en fråga är öppen i vyn — en andra
// fråga stänger den första, så att två rader aldrig frågar samtidigt.
//
// Rutan fylls med replaceChildren och tas aldrig bort ur raden: nästa rendering
// bygger raden på nytt, och en lyckad ändring hämtar alltid om månaden.
function showQuestion(question, text, choices) {
  if (openQuestion !== null && openQuestion !== question) {
    openQuestion.hidden = true;
  }
  question.replaceChildren(
    cell('question-text', text),
    ...choices.map(([className, label, onClick]) => actionButton(className, label, onClick))
  );
  question.hidden = false;
  openQuestion = question;
}

// Summeringen. Talen kommer alltid ur svarets totals och räknas aldrig här:
// budget.js på servern äger räkningen, inklusive kvar att leva på.
function renderTotals(totals) {
  TOTAL_INCOME.textContent = formatSek(oreFromResponse(totals.incomeOre));
  TOTAL_EXPENSE.textContent = formatSek(oreFromResponse(totals.expenseOre));
  TOTAL_SAVING.textContent = formatSek(oreFromResponse(totals.savingOre));

  const left = oreFromResponse(totals.leftOre);
  TOTAL_LEFT.textContent = formatSek(left);
  // Noll räknas som positivt: en budget som går jämnt upp är inget problem.
  // Färgerna ligger i style.css, aldrig som style-attribut här.
  TOTAL_LEFT.className = left < 0 ? 'summary-amount left-negative' : 'summary-amount left-positive';
}

function renderLists(items) {
  const name = monthName(currentMonth);
  for (const kind of ITEM_KINDS) {
    const config = LISTS[kind];
    const list = document.querySelector(config.list);
    const empty = document.querySelector(config.empty);
    const rows = items.filter((item) => item.kind === kind);

    list.replaceChildren();
    for (const item of rows) {
      list.append(renderItem(item));
    }
    empty.textContent = rows.length === 0 ? config.emptyText(name) : '';
  }
}

// Summan per kategori står inte i svaret: månadens svar bär de fyra totalerna och
// posterna, inte en summa per kategori. Diagrammet kräver grupperingen, och den
// sker därför här — i heltal ören och utan att röra något av summeringens fyra
// element, som alltid kommer ur svaret.
//
// Ordningen är fallande belopp, så att den största kategorin ligger först och kan
// bli stapeln som fyller bredden. Sorteringen är stabil, så två lika belopp
// behåller svarets ordning.
function expensesByCategory(items) {
  const sums = new Map();
  for (const item of items) {
    if (item.kind !== EXPENSE) {
      continue;
    }
    const earlier = sums.get(item.category) ?? 0;
    sums.set(item.category, earlier + oreFromResponse(item.amountOre));
  }
  return [...sums]
    .map(([category, amountOre]) => ({ category, amountOre }))
    .sort((a, b) => b.amountOre - a.amountOre);
}

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

// Stapeldiagram över utgifter per kategori, som inline-SVG app.js bygger. Ingen
// bildfil, inget bibliotek, inget canvas.
//
// Stapelns längd är kategorins andel av den STÖRSTA kategorin, så att den största
// alltid fyller bredden. Andel av totalen skulle göra alla staplar korta när en
// kategori dominerar.
function renderChart(items) {
  CHART.replaceChildren();

  const bars = expensesByCategory(items);
  if (bars.length === 0) {
    CHART_EMPTY.textContent = CHART_EMPTY_TEXT;
    return;
  }
  CHART_EMPTY.textContent = '';

  const largest = bars[0].amountOre;
  const svg = svgElement('svg', {
    role: 'img',
    viewBox: `0 0 ${CHART_WIDTH} ${bars.length * CHART_ROW_HEIGHT}`
  });
  const title = svgElement('title', {});
  title.textContent = CHART_TITLE;
  svg.append(title);

  for (const [index, bar] of bars.entries()) {
    const top = index * CHART_ROW_HEIGHT;

    const label = svgElement('text', { class: 'chart-label', x: 0, y: top + CHART_TEXT_BASELINE });
    label.textContent = CATEGORY_LABELS[bar.category];

    const amount = svgElement('text', {
      class: 'chart-amount',
      x: CHART_WIDTH,
      y: top + CHART_TEXT_BASELINE,
      'text-anchor': 'end'
    });
    amount.textContent = formatSek(bar.amountOre);

    const rect = svgElement('rect', {
      class: 'chart-bar',
      x: 0,
      y: top + CHART_BAR_TOP,
      height: CHART_BAR_HEIGHT,
      width: Math.round((bar.amountOre * CHART_WIDTH) / largest)
    });

    svg.append(label, amount, rect);
  }

  CHART.append(svg);
}

// En rad i budgetkortet [steg 2]: kategorin, taket och vad som är kvar av det.
//
// Varje tal kommer ur svarets egna fält — line.amountOre och line.leftOre — och
// räknas aldrig här. spentOre står inte i raden: kortet visar taket och vad som
// är kvar, och det utgivna beloppet är differensen mellan de två. Textspärren
// (78) i tests/app.test.js förbjuder en loop eller en reduce i samma sats som
// någon av de två beloppscellerna.
//
// Kategorinamnet kommer ur CATEGORY_LABELS i src/core/entry.js, precis som i en
// postrad: ingen svensk kategorietikett skrivs i den här filen.
function budgetRow(line) {
  const row = document.createElement('li');
  row.className = 'item';

  const left = oreFromResponse(line.leftOre);
  row.append(
    cell('budget-category', CATEGORY_LABELS[line.category]),
    cell('budget-amount', formatSek(oreFromResponse(line.amountOre))),
    // Noll räknas som positivt, samma regel som raden Kvar att leva på, och de
    // två klasserna är summeringens egna — inga nya färgklasser.
    cell(left < 0 ? 'budget-left left-negative' : 'budget-left left-positive', budgetLeftText(left))
  );
  return row;
}

// Kortet ritas om vid varje lyckad hämtning. replaceChildren och inte append: en
// lista som byggs men aldrig töms visar kvar av ett tak som tagits bort, och en
// andra hämtning skulle då dubblera varje rad.
//
// En tom lista ger ett kort med bara knappen. Det är inget tredje tillstånd: en
// kategori utan tak har ingen rad, och har ingen kategori ett tak finns ingen rad
// alls att visa.
function renderBudgets(budgets) {
  BUDGET_LIST.replaceChildren(...budgets.map(budgetRow));
}

// Ett heltal dagar ur svaret, prövat innan det når billDaysText, som kastar
// RangeError för allt som inte är ett heltal. Samma regel och samma skäl som
// oreFromResponse ovan: ett 200 utan läsbart daysUntil ska ge en rad som går att
// läsa i stället för ett kast som tömmer hela kortet.
function daysFromResponse(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

// Radens klasser. Statusen kommer ur svaret och prövas mot BILL_STATUSES i
// src/core/bill.js, som äger de fyra värdena: en status som inte står i listan
// ger ingen statusklass i stället för en klass ingen stilregel känner. De fyra
// värdena skrivs därmed inte av i den här filen.
function billClassName(status) {
  return BILL_STATUSES.includes(status) ? `item bill bill-${status}` : 'item bill';
}

// En rad i räkningskortet: namn, belopp, förfallodag, dagtext och knappen
// Betald.
//
// Dagtexten räknas inte här. billDaysText i src/core/bill.js äger de fem
// formerna, och talet den läser är fältet daysUntil ur GET /api/rakningar, som
// servern redan har räknat med daysBetween - app.js subtraherar inga datum.
//
// Utseendet avgörs av bill.status, också det räknat av servern: appen avgör
// aldrig själv om en räkning är förfallen.
function billRow(bill) {
  const row = document.createElement('li');
  row.className = billClassName(bill.status);

  row.append(
    cell('bill-name', bill.name),
    cell('bill-amount', formatSek(oreFromResponse(bill.amountOre))),
    cell('bill-due-date', bill.dueDate),
    cell('bill-days', billDaysText(daysFromResponse(bill.daysUntil))),
    actionButton('bill-paid', BILL_PAID_LABEL, (button) => {
      void payBill(bill.id, button);
    })
  );
  return row;
}

// Kortet ritas om vid varje lyckad hämtning av räkningarna. replaceChildren och
// inte append, av samma skäl som i de övriga korten: en lista som byggs men
// aldrig töms visar en räkning som är betald och bort, och en andra hämtning
// skulle dubblera varje rad.
//
// Bara obetalda räkningar får en rad. Villkoret är paidAt === null och inte
// statusen: paidAt är det fält rad 1 i statustabellen läser, alltså definitionen
// av betald, och app.js skriver därmed ingen av statusens svenska strängar.
// Datalagret sållar med flit inte - det är kortet som avgör vad frågan "vad ska
// betalas" svarar på.
//
// En tom lista ger ett kort med bara knappen. Det är inget tredje tillstånd:
// en räkning som inte finns har ingen rad, samma regel som budgetkortet.
function renderBills(bills) {
  BILL_LIST.replaceChildren(...bills.filter((bill) => bill.paidAt === null).map(billRow));
}

function renderMonth(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  renderTotals(body.totals ?? {});
  renderLists(items);
  renderChart(items);
  // budgets står i svaret sedan steg 2. Ett 200 utan fältet ger ett tomt kort i
  // stället för ett kast, samma regel som items ovan.
  renderBudgets(Array.isArray(body.budgets) ? body.budgets : []);
}

// Hämtar månaden och renderar om listorna, summeringen och diagrammet. Varje
// ändring som lyckas går hit — vyn byggs aldrig ur ett svar på en ändring.
async function loadMonth() {
  MONTH_LABEL.textContent = monthLabel(currentMonth);

  let response;
  try {
    response = await fetch(`/api/manad/${currentMonth}`);
  } catch {
    MONTH_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    MONTH_ERROR.textContent = generalText(body);
    return;
  }

  // Töms vid varje lyckad hämtning, och bara då. Ett fel står kvar till nästa
  // lyckade hämtning, eftersom listorna, summeringen och diagrammet under texten
  // fortfarande visar den månad texten gäller — vyn nollställs aldrig av ett fel
  // (ARKITEKTUR.md, "Vyn när en hämtning misslyckas").
  MONTH_ERROR.textContent = '';
  renderMonth(body);
}

// Hämtar räkningarna och ritar om kortet. Dagens datum står i sökvägen, läst ur
// TODAY: listan hör till en dag och inte till en månad, så månadsväljaren rör
// den inte - en räkning förfaller ett datum, oavsett vilken månad vyn visar.
//
// Felvägarna är månadshämtningens: ett anrop som inte kommer fram ger den
// allmänna texten, ett 401 visar inloggningsvyn, och ett annat svar visar
// serverns text. Ingen av dem tömmer kortet - vyn nollställs aldrig av ett fel.
async function loadBills() {
  let response;
  try {
    response = await fetch(`/api/rakningar/${TODAY}`);
  } catch {
    MONTH_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    MONTH_ERROR.textContent = generalText(body);
    return;
  }

  renderBills(Array.isArray(body.bills) ? body.bills : []);
}

// Markerar en räkning betald. Dagens datum står i kroppen, samma sträng som i
// sökvägen ovan: servern läser ingen klocka, och en återkommande räkning som
// betalas sent ska flyttas till den första dragningen framåt.
//
// Lyckas anropet hämtas räkningarna om, inte månaden: en räkning är ingen
// månadspost, och listorna och summeringen rörs inte av en betalning. Den nya
// förfallodagen kommer ur omhämtningen - vyn byggs aldrig ur svaret på en
// ändring. En återkommande räkning får därmed direkt sin nya rad, och en betald
// engångsräkning faller ur listan.
function payBill(billId, button) {
  return sendChange(button, {
    url: `/api/rakningar/${billId}/betald`,
    method: 'POST',
    body: { today: TODAY },
    okStatus: 200,
    reload: loadBills
  });
}

async function changeMonth(month, button) {
  currentMonth = month;
  button.disabled = true;
  try {
    await loadMonth();
  } finally {
    button.disabled = false;
  }
}

// Kryssrutans läge och de två fältens synlighet, som en sak: fälten är dolda
// tills rutan kryssas, och rutan bär ingen egen tolkning utöver den.
function setRecurring(checked) {
  RECURRING_CHECKBOX.checked = checked;
  RECURRING_FIELDS.hidden = !checked;
  updateSingleFields();
}

// Datum och Kommentar [steg 2]. Blocket döljs i två lägen, och båda villkoren
// står här i stället för hos var sin ägare: en mall har varken en enskild dag
// eller en enskild kommentar, och i läget Bara <månad> bär kroppen bara
// amountSek. Att dölja och inte spärra, av samma skäl som namn och kategori i
// det läget — ett fält vars ändring försvinner tyst är sämre än inget fält.
function updateSingleFields() {
  SINGLE_FIELDS.hidden = RECURRING_CHECKBOX.checked || monthOnlyLayout;
}

// Vilka fält formuläret visar. Bara i läget Bara <månad> skiljer sig vyn: då är
// beloppet det enda som går att ändra, och namn, kategori och kryssrutan döljs i
// stället för att spärras — ett utgråat fält ser ut som något som kan låsas upp,
// medan ett fält som inte finns inte väcker frågan.
function setMonthOnlyLayout(monthOnly) {
  monthOnlyLayout = monthOnly;
  updateSingleFields();
  NAME_FIELD_BLOCK.hidden = monthOnly;
  CATEGORY_FIELD_BLOCK.hidden = monthOnly;
  RECURRING_FIELD_BLOCK.hidden = monthOnly;
  MONTH_ONLY_NOTE.hidden = !monthOnly;
  MONTH_ONLY_NOTE.textContent = monthOnly ? monthOnlyNoteText(currentMonth) : '';
}

// Samma formulär för ny post, för ändring av en post, för en enda månad och för
// en serie. Vid varje ändring är fälten ifyllda och knappen heter Spara ändring.
//
// FORM.reset() körs i varje läge och inte bara för en ny post: fälten interval
// och toMonth fylls inte av någon post — en post ur månadens svar bär varken
// intervallet eller slutmånaden — och utan nollställningen skulle ett tidigare
// värde följa med in i nästa sparning.
function openForm(kind, item, mode) {
  clearFormErrors();
  formKind = kind;
  formMode = mode;
  editingId = item === null ? null : item.id;
  formSeriesId = item === null ? null : item.seriesId;

  FORM.reset();
  if (item !== null) {
    FORM.elements.name.value = item.name;
    // Fältet är kronor, posten bär ören. oreToSek i money.js äger omvandlingen —
    // ingen egen division här.
    FORM.elements.amountSek.value = String(oreToSek(item.amountOre));
    FORM.elements.category.value = item.category;
    // Mallens två egna fält. Posten bär dem sedan rättelsen "posten bär sitt
    // intervall": utan dem stod intervallfältet på sitt första alternativ, och
    // en beloppsändring på en kvartalspost skrev tyst om serien till månadsvis.
    // En engångspost bär null på båda, och då står fälten tomma — de är ändå
    // dolda i varje läge utom MODE_SERIES.
    INTERVAL_FIELD.value = item.interval === null ? '' : item.interval;
    TO_MONTH_FIELD.value = item.toMonth === null ? '' : item.toMonth;
    // Datum och Kommentar [steg 2]. Båda är null på en post utan dem, och
    // villkoret prövar typen och inte bara null: ett 200 med en kropp som saknar
    // fälten ska ge tomma fält och aldrig strängen "undefined" i ett
    // inmatningsfält, samma regel som renderUser följer.
    OCCURRED_ON_FIELD.value = typeof item.occurredOn === 'string' ? item.occurredOn : '';
    NOTE_FIELD.value = typeof item.note === 'string' ? item.note : '';
  }

  // Kryssrutan sätts av läget och inte av FORM.reset(): en ändring från och med
  // månaden ger en ny version av serien, alltså en återkommande post, och de två
  // fälten behövs då. I de tre andra lägena står rutan tom och fälten dolda.
  setRecurring(mode === MODE_SERIES);
  setMonthOnlyLayout(mode === MODE_MONTH);

  SUBMIT_BUTTON.textContent = mode === MODE_NEW ? SAVE_LABEL : SAVE_CHANGE_LABEL;
  FORM_CARD.hidden = false;
}

// Stänger formuläret: dolt, tomma fält, inga fältfel. Ägaren till "stäng
// formuläret" — både Avbryt och en lyckad sparning går hit, så de två kan inte
// glida isär.
function closeForm() {
  FORM_CARD.hidden = true;
  FORM.reset();
  setRecurring(false);
  setMonthOnlyLayout(false);
  clearFormErrors();
}

// De fyra fält en månadspost och en mall har gemensamt, ur formuläret. Beloppet
// är den råa strängen ur fältet, orörd: beloppet tolkas på exakt ett ställe i
// projektet — checkAmountSek, som valideringen anropar på servern.
//
// Funktionen bröts ut i steg 2, av samma skäl som checkSharedFields i
// src/core/item.js: en månadspost har två fält en mall inte har, så de två
// utkasten kan inte längre vara det ena plus två fält.
function sharedDraft() {
  return {
    kind: formKind,
    name: FORM.elements.name.value,
    amountSek: FORM.elements.amountSek.value,
    category: FORM.elements.category.value
  };
}

// Månadspostens sex fält: de fyra gemensamma plus Datum och Kommentar [steg 2].
// Båda skickas som den råa strängen ur fältet; checkOccurredOn och checkNote i
// src/core/item.js äger frågan vad en tom sträng betyder.
function itemDraft() {
  return { ...sharedDraft(), occurredOn: OCCURRED_ON_FIELD.value, note: NOTE_FIELD.value };
}

// Mallens sex fält: de fyra gemensamma plus de två kryssrutan öppnar. Ett tomt
// toMonth betyder tills vidare, och checkToMonth i src/core/item.js äger den
// frågan — strängen skickas orörd, precis som beloppet.
//
// Utkastet bär inte occurredOn och note: en mall har dem inte, och kroppen ska
// inte lova ett fält servern ignorerar.
function templateDraft() {
  return { ...sharedDraft(), interval: INTERVAL_FIELD.value, toMonth: TO_MONTH_FIELD.value };
}

// Vägen, metoden, kroppen och det svar som räknas som lyckat, för formulärets
// fyra lägen. Läget avgör ensamt — utom i MODE_NEW, där kryssrutan väljer mellan
// månadens engångspost och en mall.
function formRequest() {
  if (formMode === MODE_MONTH) {
    // Bara den här månaden. Kroppen bär amountSek och ingenting annat: en
    // avvikelse har bara en kolumn för belopp, så namn, kategori och slag kan
    // inte skilja sig en enskild månad.
    return {
      url: `/api/poster/${editingId}/manad/${currentMonth}`,
      method: 'PUT',
      body: { amountSek: FORM.elements.amountSek.value },
      okStatus: 200
    };
  }
  if (formMode === MODE_SERIES) {
    return {
      url: `/api/mallar/${formSeriesId}/${currentMonth}`,
      method: 'PUT',
      body: templateDraft(),
      okStatus: 200
    };
  }
  if (formMode === MODE_ITEM) {
    return { url: `/api/poster/${editingId}`, method: 'PUT', body: itemDraft(), okStatus: 200 };
  }
  return RECURRING_CHECKBOX.checked
    ? { url: `/api/mallar/${currentMonth}`, method: 'POST', body: templateDraft(), okStatus: 201 }
    : { url: `/api/manad/${currentMonth}`, method: 'POST', body: itemDraft(), okStatus: 201 };
}

async function submitForm(button) {
  clearFormErrors();

  const { url, method, body, okStatus } = formRequest();

  // Knappen som utlöste anropet spärras före fetch och släpps i ett finally, så
  // att två snabba klick inte ger två poster.
  button.disabled = true;
  submitInProgress = true;
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === okStatus) {
      closeForm();
      await loadMonth();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    showFormErrors(await readJson(response));
  } finally {
    button.disabled = false;
    submitInProgress = false;
  }
}

// Budgetformuläret [steg 2]: kategori och belopp. Egna funktioner och inte
// postformulärets lägen — de två formulären har inga fält gemensamt, och ett
// femte läge i openForm hade gjort varje fält beroende av vilket av korten som
// öppnade det.
function openBudgetForm() {
  BUDGET_FORM.reset();
  BUDGET_FORM_ERROR.textContent = '';
  BUDGET_FORM.hidden = false;
}

function closeBudgetForm() {
  BUDGET_FORM.hidden = true;
  BUDGET_FORM.reset();
  BUDGET_FORM_ERROR.textContent = '';
}

// Sätter eller ersätter månadens tak för en kategori. Vägen gör de två till en
// operation, så kroppen behöver inget fält som säger vilket av dem som avses.
//
// Svaret bär månadens budgetar, men vyn ritas ändå om ur en hämtning: spentOre
// och leftOre beror på månadens poster, och kortet och listorna ska aldrig kunna
// visa två olika månadstillstånd. Samma regel som varje annan ändring i filen.
//
// Fältfelen visas i formulärets enda felruta. Svarets error är det första felets
// text, och de två fälten står bredvid varandra — en egen felruta per fält hade
// krävt två id:n som inte kan heta error-category och error-amountSek, eftersom
// postformuläret redan äger dem.
async function submitBudget(button) {
  BUDGET_FORM_ERROR.textContent = '';

  button.disabled = true;
  budgetSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch(`/api/budget/${currentMonth}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: BUDGET_CATEGORY_FIELD.value,
          amountSek: BUDGET_AMOUNT_FIELD.value
        })
      });
    } catch {
      BUDGET_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 200) {
      closeBudgetForm();
      await loadMonth();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    BUDGET_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    budgetSubmitInProgress = false;
  }
}

// Räkningsformuläret [steg 3]: namn, belopp, förfallodag, intervall eller
// Engångs, och hur många dagar innan påminnelsen visas. Egna funktioner och inte
// postformulärets lägen, av samma skäl som budgetformuläret har egna: de två
// formulären har inga fält gemensamt.
//
// Förvalet för Påminn mig läses ur REMIND_DAYS_DEFAULT i src/core/bill.js och
// sätts efter reset(), som tömmer varje fält. Ingen siffra står här: samma tal
// äger villkoret i checkRemindDays och schemats DEFAULT.
function openBillForm() {
  BILL_FORM.reset();
  BILL_REMIND_DAYS_FIELD.value = String(REMIND_DAYS_DEFAULT);
  BILL_FORM_ERROR.textContent = '';
  BILL_FORM.hidden = false;
}

function closeBillForm() {
  BILL_FORM.hidden = true;
  BILL_FORM.reset();
  BILL_FORM_ERROR.textContent = '';
}

// Sparar en ny räkning. De fem fälten skickas som de står, och valideringen ägs
// av validateBillDraft i src/core/bill.js genom POST /api/rakningar - app.js
// prövar varken beloppet, datumet eller intervallet självt.
//
// Intervallfältets tomma värde betyder Engångs, och den tomma strängen är precis
// vad checkBillInterval läser som null. Fältet skickas därför orört.
//
// Fältfelen visas i formulärets enda felruta, samma val och samma skäl som i
// budgetformuläret: svarets error är det första felets text, och fem egna
// felrutor hade krävt fem id:n som inte kan heta error-name och error-amountSek,
// eftersom postformuläret redan äger dem.
//
// Lyckas sparningen hämtas räkningarna om - vyn byggs aldrig ur svaret på en
// ändring, och svaret på en POST bär varken status eller daysUntil.
async function submitBill(button) {
  BILL_FORM_ERROR.textContent = '';

  button.disabled = true;
  billSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch('/api/rakningar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: BILL_NAME_FIELD.value,
          amountSek: BILL_AMOUNT_FIELD.value,
          dueDate: BILL_DUE_DATE_FIELD.value,
          interval: BILL_INTERVAL_FIELD.value,
          remindDays: BILL_REMIND_DAYS_FIELD.value
        })
      });
    } catch {
      BILL_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 201) {
      closeBillForm();
      await loadBills();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    BILL_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    billSubmitInProgress = false;
  }
}

// En ändring som inte går genom formuläret: en borttagen engångspost, en
// överhoppad månad och en avslutad serie. Knappen som utlöste anropet spärras
// före fetch och släpps i ett finally, så att två snabba klick inte ger två
// anrop. Lyckas ändringen hämtas månaden om — vyn byggs aldrig ur svaret på en
// ändring. Annars står serverns text i månadsvyns allmänna ruta.
//
// Id:n skickas ordagrant. Ett id är alltid ett UUID, och servern jämför
// sökvägens led som exakta strängar utan att avkoda dem.
//
// reload är den hämtning som körs när ändringen lyckades, med loadMonth som
// förval. Räkningskortet [steg 3] skickar loadBills i stället: en betalning rör
// ingen månadspost, så att hämta månaden om hade varit ett anrop utan verkan på
// det som ändrades. Parametern och inte en andra kopia av funktionen - de två
// vägarna är samma väg sånär som på vilken lista som ritas om.
async function sendChange(button, { url, method, body, okStatus, reload = loadMonth }) {
  button.disabled = true;
  try {
    let response;
    try {
      // En väg utan kropp får ingen Content-Type: DELETE /api/mallar/... läser
      // ingenting ur anropets kropp, och ett huvud som lovar JSON utan JSON vore
      // ett löfte koden inte håller.
      response = await fetch(
        url,
        body === null
          ? { method }
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === okStatus) {
      await reload();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    MONTH_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

// Utloggningen. Vägen svarar 204 även utan giltig session, så varje svar som når
// hit betyder att sessionen är borta — det finns ingen felväg att hantera. Bara
// ett anrop som inte kommer fram alls är ett fel, och då står användaren kvar i
// månadsvyn med den allmänna texten.
async function logOut(button) {
  button.disabled = true;
  try {
    try {
      await fetch('/api/auth/logga-ut', { method: 'POST' });
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }
    showLoginView();
  } finally {
    button.disabled = false;
  }
}

async function sendCode(button) {
  LOGIN_ERROR.textContent = '';
  loginEmail = LOGIN_EMAIL.value;

  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/auth/kod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail })
      });
    } catch {
      LOGIN_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    // Svaret är alltid 202 när adressen har rätt form, oavsett om kontot finns.
    if (response.status === 202) {
      LOGIN_STEP_EMAIL.hidden = true;
      LOGIN_STEP_CODE.hidden = false;
      CODE_SENT.textContent = codeSentText(loginEmail);
      return;
    }

    // Serverns text ordagrant vid 400 och 429 — aldrig en egen.
    LOGIN_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

async function logIn(button) {
  LOGIN_ERROR.textContent = '';

  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/auth/logga-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, code: LOGIN_CODE.value })
      });
    } catch {
      LOGIN_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 204) {
      // Vilken vy som syns avgörs av GET /api/mig och av ingenting annat, och
      // adressen i månadsvyn kommer därifrån: svaret på inloggningen bär ingen
      // adress, och den användaren skrev kan skilja sig från kontots.
      await loadMe();
      return;
    }

    LOGIN_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

// Vilken vy som syns avgörs av GET /api/mig och av ingenting annat: 401 visar
// inloggningsvyn, 200 visar månadsvyn. Ett annat svar visar också
// inloggningsvyn, och då med serverns text — ett 500 från databasen får inte bli
// en tom skärm.
// --------------------------------------------------------- översikten [etapp 5]
//
// Tolv månader bredvid varandra. Talen kommer ur
// GET /api/oversikt/<ÅÅÅÅ-MM> och räknas aldrig här — med ett undantag,
// snittet, där app.js summerar leftOre och låter divideRoundHalfUp i money.js
// äga avrundningen. Varje annat tal är ett fält i svaret, och textspärren (75)
// i tests/app.test.js förbjuder en loop eller en reduce i samma sats som något
// av de tre elementen.

// Rubriken i översikten. Bär inget antal: ett krav med siffra blir falskt av
// nästa ändring av OVERVIEW_MONTHS i src/server/api.js (LARDOMAR.md
// 2026-09-12).
function overviewHeadingText(month) {
  return `Översikt till och med ${monthLabel(month)}`;
}

// Det största beloppet i serien, mätt utan tecken: stapelns höjd är andelen av
// den, så att den kraftigaste månaden — plus eller minus — fyller halva
// diagrammet. Andel av summan hade gjort varje stapel kort så snart en månad
// dominerar, precis som för kategoridiagrammet ovan.
function largestLeftMagnitude(months) {
  let largest = 0;
  for (const row of months) {
    const magnitude = Math.abs(oreFromResponse(row.leftOre));
    if (magnitude > largest) {
      largest = magnitude;
    }
  }
  return largest;
}

// Månaden med högst leftOre. Jämförelsen är strikt, så den äldsta av två lika
// månader vinner — serien är äldst först, och ett oavgjort fall ska svara
// likadant vid varje hämtning.
//
// null när serien är tom. Det inträffar bara för ett 200 med en kropp som inte
// bär months, samma fall som oreFromResponse finns för.
function bestMonth(months) {
  let best = null;
  for (const row of months) {
    if (best === null || oreFromResponse(row.leftOre) > oreFromResponse(best.leftOre)) {
      best = row;
    }
  }
  return best;
}

// Snittet: det enda tal app.js räknar fram. Avrundningen ägs av
// divideRoundHalfUp i src/core/money.js — ingen division med / och ingen
// Math.round här, och summan byggs i den här funktionen och aldrig i satsen som
// skriver elementet, så att textspärren i (75) kan förbjuda en loop i just den
// satsen.
function averageLeftOre(months) {
  // divideRoundHalfUp kräver en nämnare större än 0 och kastar annars.
  if (months.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const row of months) {
    sum += oreFromResponse(row.leftOre);
    // Samma regel som oreFromResponse för ett enskilt tal, tillämpad på summan:
    // tolv belopp som var för sig är säkra heltal kan tillsammans ligga utanför
    // området, och villkoret är divideRoundHalfUps eget giltighetsområde
    // (2 * täljaren + nämnaren). Utan raden kastar money.js och vyn stannar
    // mitt i renderingen.
    if (!Number.isSafeInteger(2 * sum + months.length)) {
      return 0;
    }
  }
  return divideRoundHalfUp(sum, months.length);
}

function renderOverviewTotals(months, savedThisYear) {
  OVERVIEW_SAVED.textContent = formatSek(oreFromResponse(savedThisYear));
  OVERVIEW_AVERAGE.textContent = formatSek(averageLeftOre(months));
  const best = bestMonth(months);
  OVERVIEW_BEST.textContent = best === null ? '' : monthLabel(best.month);
}

// Stapeldiagrammet som inline-SVG, byggt på samma sätt som kategoridiagrammet:
// ingen bildfil, inget bibliotek, inget canvas.
//
// En månad med negativt kvar ritas NEDÅT från nollinjen och bär klassen som
// hämtar var(--negativ); en positiv ritas uppåt och bär klassen för
// var(--positiv). Noll räknas som positivt, precis som på raden Kvar att leva
// på. Nollinjen ritas som en egen linje och finns alltid, också när varje månad
// är noll — utan den går det inte att se vilka månader som gick back.
function renderOverviewChart(months) {
  OVERVIEW_CHART.replaceChildren();
  if (months.length === 0) {
    return;
  }

  const svg = svgElement('svg', {
    role: 'img',
    viewBox: `0 0 ${OVERVIEW_CHART_WIDTH} ${2 * OVERVIEW_CHART_HALF}`
  });
  const title = svgElement('title', {});
  title.textContent = OVERVIEW_CHART_TITLE;
  svg.append(title);

  // Nollinjen först, så att staplarna ritas över den.
  svg.append(svgElement('line', {
    class: 'overview-zero-line',
    x1: 0,
    y1: OVERVIEW_CHART_HALF,
    x2: OVERVIEW_CHART_WIDTH,
    y2: OVERVIEW_CHART_HALF
  }));

  const largest = largestLeftMagnitude(months);
  const columnWidth = OVERVIEW_CHART_WIDTH / months.length;
  for (const [index, row] of months.entries()) {
    const left = oreFromResponse(row.leftOre);
    // Varje månad är noll: då finns ingen största stapel att ta andel av, och
    // varje höjd är noll. Nollinjen står kvar och är hela diagrammet.
    const height = largest === 0 ? 0 : Math.round((Math.abs(left) * OVERVIEW_CHART_HALF) / largest);
    const negative = left < 0;
    const bar = svgElement('rect', {
      class: negative ? OVERVIEW_BAR_NEGATIVE : OVERVIEW_BAR_POSITIVE,
      x: index * columnWidth,
      // En negativ stapel börjar PÅ nollinjen och växer nedåt; en positiv
      // slutar på den och har därför sin överkant höjden ovanför.
      y: negative ? OVERVIEW_CHART_HALF : OVERVIEW_CHART_HALF - height,
      width: columnWidth - OVERVIEW_BAR_GAP,
      height
    });
    const barTitle = svgElement('title', {});
    barTitle.textContent = `${monthLabel(row.month)}: ${formatSek(left)}`;
    bar.append(barTitle);
    svg.append(bar);
  }

  OVERVIEW_CHART.append(svg);
}

// Tabellen: en rad per månad, i samma ordning som diagrammet. En tom månad står
// med, med fyra nollor — annars ser tidslinjen ut att hoppa över tid.
function overviewRow(row) {
  const tr = document.createElement('tr');
  const left = oreFromResponse(row.leftOre);
  tr.append(
    cell('overview-month', monthLabel(row.month), 'td'),
    cell('overview-income', formatSek(oreFromResponse(row.incomeOre)), 'td'),
    cell('overview-expense', formatSek(oreFromResponse(row.expenseOre)), 'td'),
    cell('overview-saving', formatSek(oreFromResponse(row.savingOre)), 'td'),
    // Samma två klasser som raden Kvar att leva på i månadsvyn: färgen ligger i
    // style.css och aldrig som ett style-attribut här.
    cell(left < 0 ? 'overview-left left-negative' : 'overview-left left-positive', formatSek(left), 'td')
  );
  return tr;
}

function renderOverviewRows(months) {
  OVERVIEW_ROWS.replaceChildren();
  for (const row of months) {
    OVERVIEW_ROWS.append(overviewRow(row));
  }
}

function renderOverview(body) {
  const months = Array.isArray(body.months) ? body.months : [];
  OVERVIEW_LABEL.textContent = overviewHeadingText(currentMonth);
  renderOverviewTotals(months, body.savedThisYear);
  renderOverviewChart(months);
  renderOverviewRows(months);
}

// Hämtar översikten och byter vy först när svaret är läst. Ordningen är inte
// likgiltig: byttes vyn först skulle ett misslyckat anrop lämna användaren i en
// vy med tre tomma rutor och en tom tabell, alltså ett tillstånd som varken är
// "tolv månader" eller "månadsvyn" (LARDOMAR.md 2026-09-10, "ett tredje
// tillstånd som specen inte nämner"). Felet skrivs därför i månadsvyns felruta,
// där användaren fortfarande står.
async function showOverview(button) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch(`/api/oversikt/${currentMonth}`);
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    const body = await readJson(response);
    if (response.status !== 200) {
      MONTH_ERROR.textContent = generalText(body);
      return;
    }

    MONTH_ERROR.textContent = '';
    renderOverview(body);
    showOverviewView();
  } finally {
    button.disabled = false;
  }
}

// Min plan [steg 1 i del 5] ---------------------------------------------------

// Planens namn och de funktioner planen har. Båda kommer ur svaret och räknas
// aldrig här: features är samma lista servern räknar behörigheten ur, så vyn och
// spärren kan inte säga olika saker.
//
// En plannyckel som inte står i PLAN_LABELS skrivs inte alls, av samma skäl som
// renderUser inte skriver "undefined": ett 200 utan läsbar kropp ska ge en tom
// rad och inte en engelsk nyckel.
function renderPlan(body) {
  const plan = body.plan;
  PLAN_CURRENT.textContent = Object.hasOwn(PLAN_LABELS, plan) ? PLAN_LABELS[plan] : '';

  const features = Array.isArray(body.features) ? body.features : [];
  PLAN_FEATURES.replaceChildren(
    ...features
      // Ett okänt namn hoppas över i stället för att visas som sin engelska
      // nyckel - användaren ser aldrig nycklarna.
      .filter((feature) => Object.hasOwn(FEATURE_LABELS, feature))
      .map((feature) => {
        const row = document.createElement('li');
        row.className = 'item';
        row.append(cell('item-name', FEATURE_LABELS[feature]));
        return row;
      })
  );
}

// Hämtar planen och byter vy först när svaret är läst. Samma ordning och samma
// skäl som showOverview: byttes vyn först skulle ett misslyckat anrop lämna
// användaren i en vy med en tom plan och en tom lista, alltså ett tillstånd som
// varken är "en plan" eller "månadsvyn" (LARDOMAR.md 2026-09-10). Felet skrivs
// därför i månadsvyns felruta, där användaren fortfarande står.
async function showPlan(button) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/plan');
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    const body = await readJson(response);
    if (response.status !== 200) {
      MONTH_ERROR.textContent = generalText(body);
      return;
    }

    MONTH_ERROR.textContent = '';
    renderPlan(body);
    // Vyns egna rutor nollställs när vyn öppnas: bekräftelsen hör till ett byte
    // och inte till ett besök, och ett fel från ett tidigare byte ska inte stå
    // kvar.
    PLAN_NOTE.textContent = '';
    PLAN_ERROR.textContent = '';
    showPlanView();
  } finally {
    button.disabled = false;
  }
}

// Byter plan. Vyn ritas om ur PUT:ens svar och utan en andra hämtning: svaret
// bär samma { plan, features } som GET ger, så en omladdning behövs inte.
//
// Knappen spärras under anropet, så att två snabba klick inte blir två anrop.
async function changePlan(plan, button) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });
    } catch {
      PLAN_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    const body = await readJson(response);
    if (response.status !== 200) {
      PLAN_NOTE.textContent = '';
      PLAN_ERROR.textContent = generalText(body);
      return;
    }

    PLAN_ERROR.textContent = '';
    renderPlan(body);
    PLAN_NOTE.textContent = PLAN_DEMO_NOTE;
  } finally {
    button.disabled = false;
  }
}

// De tre knapparna, ritade ur PLANS. Ingen plannyckel står skriven i filen: en
// knapp kan därför inte erbjuda en plan som inte finns, och ett tillägg i
// modulen ger en fjärde knapp av sig själv.
function renderPlanButtons() {
  PLAN_BUTTONS.replaceChildren(
    ...Object.keys(PLANS).map((plan) =>
      actionButton('secondary', choosePlanLabel(plan), (button) => {
        void changePlan(plan, button);
      })
    )
  );
}

async function loadMe() {
  let response;
  try {
    response = await fetch('/api/mig');
  } catch {
    showLoginView();
    LOGIN_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (response.status === 200) {
    renderUser((await readJson(response)).email);
    showMonthView();
    await loadMonth();
    // Räkningarna hämtas en gång, efter månaden. Inte vid varje månadsbyte:
    // listan hör till dagen och inte till månaden, så ett andra anrop hade gett
    // samma svar. Kortet hämtas om när en räkning sparas eller markeras betald,
    // alltså när listan verkligen kan ha ändrats.
    //
    // Utan await: loadMe anropas av filens await på toppnivå, och ett svar som
    // dröjer skulle då hålla hela modulen oladdad - inloggningsvyn, månadsvyn
    // och varje lyssnare med den. Anropet görs ändå här och inte i en lyssnare,
    // så att fetch registreras synkront i samma ordning varje gång; bara
    // väntan på svaret är släppt. Funktionen hanterar själv varje felväg, så
    // löftet kan inte avvisas.
    void loadBills();
    return;
  }

  showLoginView();
  if (response.status !== 401) {
    LOGIN_ERROR.textContent = generalText(await readJson(response));
  }
}

fillOptions('#item-category', CATEGORY_LABELS);
// Intervallets fyra alternativ [etapp 4]. Etiketterna ägs av INTERVAL_LABELS i
// src/core/entry.js, och nycklarna är samma nycklar checkInterval godkänner.
fillOptions('#item-interval', INTERVAL_LABELS);
// Budgetformulärets kategorier [steg 2], ur samma CATEGORY_LABELS som
// postformulärets: ett tak kan därmed bara gälla en kategori valideringen
// godkänner.
fillOptions('#budget-category', CATEGORY_LABELS);
// Räkningens intervallfält [steg 3]: Engångs först, därefter de fyra intervallen
// ur INTERVAL_LABELS. Engångs har den tomma strängen som värde, som
// checkBillInterval i src/core/bill.js läser som null - en räkning utan
// intervall. Ingen intervalletikett skrivs för hand i den här filen.
fillOptions('#bill-interval', { '': BILL_ONE_TIME_LABEL, ...INTERVAL_LABELS });

// Gränserna för Påminn mig läses ur src/core/bill.js, samma två tal som
// checkRemindDays prövar mot och som schemats CHECK bär. Som attribut och inte
// som egenskaper: min och max finns bara som attribut på ett number-fält.
BILL_REMIND_DAYS_FIELD.setAttribute('min', String(REMIND_DAYS_MIN));
BILL_REMIND_DAYS_FIELD.setAttribute('max', String(REMIND_DAYS_MAX));

// Kryssrutan öppnar och stänger de två fälten, och döljer samtidigt Datum och
// Kommentar [steg 2] — en mall har dem inte. Den skickar inget anrop och rör
// inget annat: vilken väg en sparning går avgörs av formulärets läge, och
// kryssrutan väljer bara i läget för en ny post.
//
// Anropet går genom setRecurring och inte genom en egen rad, så att de tre
// elementen har en enda ägare. Att sätta checked till det värde rutan redan har
// ändrar ingenting.
RECURRING_CHECKBOX.addEventListener('change', () => {
  setRecurring(RECURRING_CHECKBOX.checked);
});

SEND_CODE.addEventListener('click', () => {
  void sendCode(SEND_CODE);
});

LOG_IN.addEventListener('click', () => {
  void logIn(LOG_IN);
});

USE_OTHER_EMAIL.addEventListener('click', () => {
  showLoginView();
});

LOG_OUT.addEventListener('click', () => {
  void logOut(LOG_OUT);
});

CANCEL_BUTTON.addEventListener('click', () => {
  closeForm();
});

SHOW_OVERVIEW.addEventListener('click', () => {
  void showOverview(SHOW_OVERVIEW);
});

SHOW_PLAN.addEventListener('click', () => {
  void showPlan(SHOW_PLAN);
});

// Tillbaka till månaden byter bara vy, av samma skäl som i översikten:
// månadsvyn är kvar som den var, och ingen omhämtning kan misslyckas.
BACK_FROM_PLAN.addEventListener('click', () => {
  showMonthView();
});

// Tillbaka till månaden byter bara vy: månadsvyn är kvar som den var, och
// currentMonth har inte rörts, så användaren kommer tillbaka till samma månad.
// Ingen ny hämtning — en omhämtning som misslyckas hade kunnat lämna månadsvyn
// med ett fel som användaren inte bad om.
BACK_TO_MONTH.addEventListener('click', () => {
  showMonthView();
});

MONTH_PREV.addEventListener('click', () => {
  void changeMonth(shiftMonth(currentMonth, -1), MONTH_PREV);
});

MONTH_NEXT.addEventListener('click', () => {
  void changeMonth(shiftMonth(currentMonth, 1), MONTH_NEXT);
});

for (const kind of ITEM_KINDS) {
  const add = document.querySelector(LISTS[kind].add);
  add.addEventListener('click', () => {
    openForm(kind, null, MODE_NEW);
  });
}

// Budgetkortets knappar [steg 2]. + Sätt tak öppnar formuläret, Avbryt stänger
// det utan att skicka något anrop.
ADD_BUDGET.addEventListener('click', () => {
  openBudgetForm();
});

BUDGET_CANCEL.addEventListener('click', () => {
  closeBudgetForm();
});

// Räkningskortets knappar [steg 3]. + Ny räkning öppnar formuläret, Avbryt
// stänger det utan att skicka något anrop.
ADD_BILL.addEventListener('click', () => {
  openBillForm();
});

BILL_CANCEL.addEventListener('click', () => {
  closeBillForm();
});

BILL_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  // Samma spärr och samma skäl som de två andra formulärens: Enter i ett fält
  // skickar formuläret direkt, förbi den avstängda knappen.
  if (billSubmitInProgress) {
    return;
  }
  void submitBill(BILL_SUBMIT);
});

BUDGET_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  // Samma spärr och samma skäl som postformulärets: Enter i beloppsfältet
  // skickar formuläret direkt, förbi den avstängda knappen.
  if (budgetSubmitInProgress) {
    return;
  }
  void submitBudget(BUDGET_SUBMIT);
});

FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  // Hanteraren prövar sitt EGET pågående-läge och litar aldrig på knappens
  // disabled: Enter i ett textfält skickar formuläret direkt, förbi den avstängda
  // knappen.
  if (submitInProgress) {
    return;
  }
  void submitForm(SUBMIT_BUTTON);
});

// De tre planknapparna ritas en gång, innan den första hämtningen: de beror
// bara på PLANS och inte på vilken plan användaren har.
renderPlanButtons();

await loadMe();
