// UI-logik. Ingen ny logik: etiketter, belopp och validering kommer ur
// src/core/, som servern levererar under /core/.
//
// Paket 5 bygger punkt 1, 2 (utan kostnader per post), 5, 6 och 7 i
// ARKITEKTUR.md:s ansvarslista. Paket 6 bygger resten av punkt 2 (kostnaden per
// post), punkt 3 (totalerna) och punkt 8 (tomläget). Paket 7 bygger punkt 4
// (kommande dragningar).
import { monthlyOre, totalMonthlyOre, totalYearlyOre, yearlyOre } from '/core/cost.js';
import { todayIso } from '/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '/core/entry.js';
import { formatSek, sekToOre } from '/core/money.js';
import { upcoming } from '/core/schedule.js';

// Text mot användaren som varken kommer från servern eller från src/core/ står
// ordagrant i ARKITEKTUR.md och får inte skrivas om. Det gäller konstanterna
// här nedanför och varje sträng som skrivs på plats i en renderingsfunktion —
// knappens Ta bort, etiketterna framför kostnaden per post och texterna för
// dagar kvar. Uppräkningen står utan antal och utan ordet enda — ett krav med
// siffra blir falskt av nästa tillägg (LARDOMAR.md 2026-09-10, kommentaren i
// app.js räknar upp två av filens fem strängar).
//
// GENERAL_ERROR visas bara när ett svar varken bär error eller fieldErrors, till
// exempel när servern inte svarar alls.
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const EMPTY_STATE = 'Du har inga poster ännu. Lägg till din första utgift ovan.';
// Kortet Kommande dragningar har en egen tomtext: en läsare ska inte behöva
// sluta sig till varför ett kort är tomt genom att läsa ett annat.
const UPCOMING_EMPTY_STATE = 'Inga kommande dragningar ännu.';
// U+2013 EN DASH, inte bindestreck (U+002D) och inte tankstreck (U+2014).
// Står i båda totalerna när en hämtning misslyckades: vyn visar aldrig ett tal
// appen inte vet är sant, och 0,00 kr vore ett tal appen inte har räknat fram.
const UNKNOWN_TOTAL = '\u2013';

const FORM = document.querySelector('#entry-form');
const LIST = document.querySelector('#entry-list');
const FORM_ERROR = document.querySelector('#form-error');
const EMPTY_STATE_ELEMENT = document.querySelector('#empty-state');
const TOTAL_MONTHLY = document.querySelector('#total-monthly');
const TOTAL_YEARLY = document.querySelector('#total-yearly');
const UPCOMING_LIST = document.querySelector('#upcoming-list');
const UPCOMING_EMPTY = document.querySelector('#upcoming-empty');
const SUBMIT_BUTTON = FORM.querySelector('button[type="submit"]');

// Fälten i formuläret, i samma ordning som validateEntryDraft rapporterar dem.
// Servern skickar aldrig ett fieldError med något annat field: id-felet går som
// 500 { error } utan fieldErrors (ARKITEKTUR.md, "Hur showErrors letar upp
// fälten").
const FORM_FIELDS = ['name', 'amountSek', 'interval', 'startDate', 'category'];

function fieldErrorElement(field) {
  return document.querySelector(`#error-${field}`);
}

function clearErrors() {
  FORM_ERROR.textContent = '';
  for (const field of FORM_FIELDS) {
    fieldErrorElement(field).textContent = '';
  }
}

// Etiketterna ägs av src/core/entry.js. Nycklarna i listan är samma nycklar som
// valideringen godkänner, så en post kan aldrig bära ett värde som saknas här.
function fillOptions(selectId, labels) {
  const select = document.querySelector(`#${selectId}`);
  for (const [value, label] of Object.entries(labels)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function cell(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function renderEntries(entries) {
  LIST.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'entry';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Ta bort';
    remove.addEventListener('click', () => {
      void removeEntry(entry.id, remove);
    });

    // entry-amount är beloppet PER BETALNING; de två sista cellerna är
    // omräkningar och bär därför var sin etikett, annars visar raden tre belopp
    // utan att något skiljer dem åt. Talen kommer ur src/core/cost.js — inget
    // räknas här.
    item.append(
      cell('entry-name', entry.name),
      cell('entry-category', CATEGORY_LABELS[entry.category]),
      cell('entry-amount', formatSek(sekToOre(entry.amountSek))),
      cell('entry-interval', INTERVAL_LABELS[entry.interval]),
      cell('entry-monthly', `Per månad: ${formatSek(monthlyOre(entry))}`),
      cell('entry-yearly', `Per år: ${formatSek(yearlyOre(entry))}`),
      remove
    );

    LIST.append(item);
  }

  // Totalerna kommer ur totalMonthlyOre och totalYearlyOre, som får hela listan.
  // Kolumnen summeras aldrig här: totalen avrundas en gång ur den exakta
  // årssumman medan varje rad avrundas för sig, så de kan skilja sig med ören —
  // och den korrekta totalen är den som visas. Skillnaden förklaras inte för
  // användaren; den är i stället testad i tests/app.test.js.
  TOTAL_MONTHLY.textContent = formatSek(totalMonthlyOre(entries));
  TOTAL_YEARLY.textContent = formatSek(totalYearlyOre(entries));

  // Tomläget. Totalrutan döljs aldrig: en tom lista ger 0,00 kr på båda raderna.
  if (entries.length === 0) {
    EMPTY_STATE_ELEMENT.textContent = EMPTY_STATE;
  } else {
    EMPTY_STATE_ELEMENT.textContent = '';
  }
}

// Texten för dagar kvar ägs av app.js: ingen modul i src/core/ formaterar text
// mot användaren. daysUntil är aldrig negativ — nextDueDate är per definition
// idag eller senare — så det fallet har ingen gren här.
function daysText(daysUntil) {
  if (daysUntil === 0) {
    return 'Idag';
  }
  if (daysUntil === 1) {
    return 'Om 1 dag';
  }
  return `Om ${daysUntil} dagar`;
}

// Kommande dragningar. Ingenting räknas här: varje rad kommer ur upcoming(),
// som ger en redan sorterad lista av { entry, nextDueDate, daysUntil }. Datumet
// visas som ÅÅÅÅ-MM-DD utan omskrivning — det är formatet datamodellen
// använder, och ett månadsnamn skulle kräva svensk text som ingen modul äger.
//
// todayIso() är projektets enda klockläsning och läses här, vid renderingen,
// inte vid sidladdningen: en flik som står öppen över midnatt visar rätt dagar
// kvar vid nästa hämtning.
function renderUpcoming(entries) {
  UPCOMING_LIST.replaceChildren();
  for (const item of upcoming(entries, todayIso())) {
    const rad = document.createElement('li');
    rad.className = 'upcoming';
    rad.append(
      cell('upcoming-name', item.entry.name),
      cell('upcoming-date', item.nextDueDate),
      cell('upcoming-days', daysText(item.daysUntil))
    );
    UPCOMING_LIST.append(rad);
  }

  // Listan är tom exakt när entries är tom: varje post har en nästa dragning.
  if (entries.length === 0) {
    UPCOMING_EMPTY.textContent = UPCOMING_EMPTY_STATE;
  } else {
    UPCOMING_EMPTY.textContent = '';
  }
}

// Vyn när en hämtning misslyckas (ARKITEKTUR.md, "Vyn när en hämtning
// misslyckas"). renderEntries och renderUpcoming är enda skrivarna av de sex
// elementen och nås bara efter ett 200, så utan den här funktionen står förra
// svarets lista kvar i vyn — med totaler som räknar med en post som redan är
// borta ur datafilen, och med dragningar för samma post.
//
// Tomlägets text är ett påstående om datafilen. Appen vet inte om den är tom;
// den vet bara att den inte kunde läsas. Därför den tomma strängen och inte
// EMPTY_STATE eller UPCOMING_EMPTY_STATE.
function clearView() {
  LIST.replaceChildren();
  EMPTY_STATE_ELEMENT.textContent = '';
  TOTAL_MONTHLY.textContent = UNKNOWN_TOTAL;
  TOTAL_YEARLY.textContent = UNKNOWN_TOTAL;
  UPCOMING_LIST.replaceChildren();
  UPCOMING_EMPTY.textContent = '';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// Uppslaget går från formuläret till svaret, aldrig tvärtom: för vart och ett av
// de fem kända fälten söks det första fieldError med det field. Ett okänt field
// kan därmed varken hittas eller slå i en null-referens — det ignoreras.
//
// Visades inget fältfel alls visas den allmänna texten: svarets error när den är
// en sträng, annars GENERAL_ERROR. Grenen med GENERAL_ERROR nås av varje svar
// utan läsbar JSON-kropp, eftersom readJson svarar {} för just det. Inget
// felsvar får leda till att ingenting syns.
function showErrors(body) {
  clearErrors();

  const fieldErrors = Array.isArray(body.fieldErrors) ? body.fieldErrors : [];
  let visadeFaltfel = false;

  for (const field of FORM_FIELDS) {
    const fieldError = fieldErrors.find((candidate) => candidate.field === field);
    if (fieldError !== undefined) {
      fieldErrorElement(field).textContent = fieldError.message;
      visadeFaltfel = true;
    }
  }

  if (!visadeFaltfel) {
    FORM_ERROR.textContent = typeof body.error === 'string' ? body.error : GENERAL_ERROR;
  }
}

// Varje misslyckad hämtning nollställer vyn: både ett avvisat fetch och varje
// status som inte är 200.
//
// Ordningen mellan clearView och feltexten är fri i båda grenarna, inte
// bindande: clearView skriver bara till #entry-list, #empty-state,
// #total-monthly, #total-yearly, #upcoming-list och #upcoming-empty, medan
// FORM_ERROR i den avvisade grenen och showErrors i grenen för status ≠ 200
// bara skriver till #form-error och #error-<fält>. Mängderna är disjunkta.
// Mätt i en kopia av trädet: mutation: satsparet i den avvisade grenen och
// satsparet i grenen för status ≠ 200, båda i omvänd ordning samtidigt -> ger
// EXIT=0 med fail 0, och inget test faller.
async function loadAndRender() {
  let response;
  try {
    response = await fetch('/api/entries');
  } catch {
    clearView();
    FORM_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    clearView();
    showErrors(body);
    return;
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];
  renderEntries(entries);
  renderUpcoming(entries);
}

// Formulärets eget pågående-läge. Knappens disabled duger inte som enda
// spärr: den stoppar bara klick, och en submit-händelse behöver inte komma
// från knappen.
let sparningPagar = false;

async function submitForm(button) {
  clearErrors();

  const draft = {
    name: FORM.elements.name.value,
    // Den råa strängen ur formuläret, orörd. Beloppet tolkas på exakt ett
    // ställe i projektet: createEntry på servern. Ingen parseFloat här.
    amountSek: FORM.elements.amountSek.value,
    interval: FORM.elements.interval.value,
    startDate: FORM.elements.startDate.value,
    category: FORM.elements.category.value
  };

  // Knappen som utlöste anropet spärras före fetch och släpps i ett finally.
  // Spärren skyddar mot ett andra klick på samma knapp; två klick på olika Ta
  // bort-knappar ska fungera, och det är serverns updateEntries som gör det
  // korrekt.
  button.disabled = true;
  sparningPagar = true;
  try {
    let response;
    try {
      response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
    } catch {
      FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 201) {
      FORM.reset();
      await loadAndRender();
      return;
    }

    showErrors(await readJson(response));
  } finally {
    button.disabled = false;
    sparningPagar = false;
  }
}

async function removeEntry(id, button) {
  clearErrors();

  // Samma spärr som i submitForm. Att knappen redan är borttagen ur DOM:en när
  // listan har renderats om är ofarligt: den får då disabled = false utan att
  // någon ser det.
  button.disabled = true;
  try {
    let response;
    try {
      // Id:t skickas ordagrant. Ett id är alltid ett UUID från
      // crypto.randomUUID(), och servern jämför sökvägens sista del som exakt
      // sträng utan att avkoda den.
      response = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    } catch {
      FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 204) {
      await loadAndRender();
      return;
    }

    showErrors(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

fillOptions('interval', INTERVAL_LABELS);
fillOptions('category', CATEGORY_LABELS);

FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  // Hanteraren prövar sitt EGET pågående-läge och litar aldrig på knappens
  // disabled. Skälet är uppmätt med DOM-attrappen: Enter i ett textfält
  // skickar formuläret direkt, förbi den avstängda knappen. Två Enter i rad
  // gav två POST innan den här raden fanns och ett POST efter; två klick på
  // Spara gav ett POST i båda fallen, eftersom webbläsaren inte skickar något
  // klick till en avstängd knapp.
  if (sparningPagar) {
    return;
  }
  void submitForm(SUBMIT_BUTTON);
});

await loadAndRender();
