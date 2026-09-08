// UI-logik. Ingen ny logik: etiketter, belopp och validering kommer ur
// src/core/, som servern levererar under /core/.
//
// Paket 5 bygger punkt 1, 2 (utan kostnader per post), 5, 6 och 7 i
// ARKITEKTUR.md:s ansvarslista. Punkt 3 (totaler), punkt 4 (kommande
// dragningar) och punkt 8 (tomläge) hör till paket 6 och 7 och finns inte här.
import { CATEGORY_LABELS, INTERVAL_LABELS } from '/core/entry.js';
import { formatSek, sekToOre } from '/core/money.js';

// Enda strängen i den här filen som inte kommer från servern eller från
// src/core/. Den visas bara när ett svar varken bär error eller fieldErrors,
// till exempel när servern inte svarar alls.
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';

const FORM = document.querySelector('#entry-form');
const LIST = document.querySelector('#entry-list');
const FORM_ERROR = document.querySelector('#form-error');
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

    item.append(
      cell('entry-name', entry.name),
      cell('entry-category', CATEGORY_LABELS[entry.category]),
      cell('entry-amount', formatSek(sekToOre(entry.amountSek))),
      cell('entry-interval', INTERVAL_LABELS[entry.interval]),
      remove
    );

    LIST.append(item);
  }
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

async function loadAndRender() {
  let response;
  try {
    response = await fetch('/api/entries');
  } catch {
    FORM_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    showErrors(body);
    return;
  }

  renderEntries(Array.isArray(body.entries) ? body.entries : []);
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
