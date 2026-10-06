// UI-logik för inloggningsvyn och månadsvyn [etapp 3]. Ingen ny logik: etiketter,
// månadsnamn, belopp och validering kommer ur src/core/, som servern levererar
// under /core/.
//
// Sidan har två tillstånd och ingen router. GET /api/mig avgör vilket: 401 visar
// inloggningsvyn, 200 visar månadsvyn. Ett 401 från någon annan väg senare i
// körningen visar inloggningsvyn igen — sessionen kan gå ut medan sidan är öppen.
import { monthLabel, monthName, monthOfIsoDate, shiftMonth, todayIso } from '/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '/core/entry.js';
import { ITEM_KINDS } from '/core/item.js';
import { formatSek, oreToSek } from '/core/money.js';

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

// Fälten i formuläret, i samma ordning som validateMonthItemDraft rapporterar
// dem. Fältet kind står inte här: slaget kommer från vilken lista knappen satt i
// och är inget fält, så ett fieldError för kind har inget element att skrivas
// vid och hamnar i den allmänna rutan — samma väg som varje annat svar utan
// fältfel.
// interval och toMonth står sist därför att kryssrutan Återkommande öppnar dem
// under de fyra andra, samma ordning som validateTemplateDraft rapporterar dem.
const FORM_FIELDS = ['name', 'amountSek', 'category', 'interval', 'toMonth'];

// Formulärets fyra lägen [etapp 4]. Vilken väg en sparning går avgörs av läget,
// aldrig av kryssrutan — utom i MODE_NEW, där kryssrutan väljer mellan månadens
// engångspost och en mall. Ett läge per väg, så att ingen hanterare behöver
// gissa.
const MODE_NEW = 'new';
const MODE_ITEM = 'item';
const MODE_MONTH = 'month';
const MODE_SERIES = 'series';

// Månaden vyn visar. Den enda klockläsningen i filen: monthOfIsoDate(todayIso())
// öppnar den aktuella månaden, och knapparna räknar därefter med shiftMonth.
let currentMonth = monthOfIsoDate(todayIso());
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
  LOGIN_STEP_EMAIL.hidden = false;
  LOGIN_STEP_CODE.hidden = true;
  CODE_SENT.textContent = '';
  LOGIN_CODE.value = '';
}

function showMonthView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = false;
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

function cell(className, text) {
  const element = document.createElement('span');
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

function renderMonth(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  renderTotals(body.totals ?? {});
  renderLists(items);
  renderChart(items);
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
}

// Vilka fält formuläret visar. Bara i läget Bara <månad> skiljer sig vyn: då är
// beloppet det enda som går att ändra, och namn, kategori och kryssrutan döljs i
// stället för att spärras — ett utgråat fält ser ut som något som kan låsas upp,
// medan ett fält som inte finns inte väcker frågan.
function setMonthOnlyLayout(monthOnly) {
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

// Månadspostens fyra fält, ur formuläret. Beloppet är den råa strängen ur
// fältet, orörd: beloppet tolkas på exakt ett ställe i projektet —
// checkAmountSek, som valideringen anropar på servern.
function itemDraft() {
  return {
    kind: formKind,
    name: FORM.elements.name.value,
    amountSek: FORM.elements.amountSek.value,
    category: FORM.elements.category.value
  };
}

// Mallens sex fält: månadspostens fyra plus de två kryssrutan öppnar. Ett tomt
// toMonth betyder tills vidare, och checkToMonth i src/core/item.js äger den
// frågan — strängen skickas orörd, precis som beloppet.
function templateDraft() {
  return { ...itemDraft(), interval: INTERVAL_FIELD.value, toMonth: TO_MONTH_FIELD.value };
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

// En ändring som inte går genom formuläret: en borttagen engångspost, en
// överhoppad månad och en avslutad serie. Knappen som utlöste anropet spärras
// före fetch och släpps i ett finally, så att två snabba klick inte ger två
// anrop. Lyckas ändringen hämtas månaden om — vyn byggs aldrig ur svaret på en
// ändring. Annars står serverns text i månadsvyns allmänna ruta.
//
// Id:n skickas ordagrant. Ett id är alltid ett UUID, och servern jämför
// sökvägens led som exakta strängar utan att avkoda dem.
async function sendChange(button, { url, method, body, okStatus }) {
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
      await loadMonth();
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

// Kryssrutan öppnar och stänger de två fälten. Den skickar inget anrop och rör
// inget annat: vilken väg en sparning går avgörs av formulärets läge, och
// kryssrutan väljer bara i läget för en ny post.
RECURRING_CHECKBOX.addEventListener('change', () => {
  RECURRING_FIELDS.hidden = !RECURRING_CHECKBOX.checked;
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

await loadMe();
