// Routing och JSON-svar för /api/*. Enda stället som översätter ett HTTP-anrop
// till ett anrop i kärnan eller i lagringen.
//
// Beloppet tolkas på exakt ett ställe i projektet: createEntry i src/core/entry.js.
// Den här filen gör ingen parseFloat, ingen Number() och ingen trimning av ett
// belopp — råvärdet ur anropets JSON skickas vidare orört.
import { createEntry } from '../core/entry.js';
import { loadEntries, updateEntries } from './storage.js';

// Ägs här och läses av server.js för rad S1 ("Ett trasigt anrop får inte döda
// appen"). Texten säger "anropet", inte "kroppen", och täcker därför både en
// kropp som inte gick att tolka och en förfrågningsrad som inte gick att tolka.
// En handskriven kopia i server.js vore en andra text för samma sak.
export const UNPARSABLE_MESSAGE = 'Kunde inte tolka anropet.';

// Svenska strängar mot användaren. De står i ARKITEKTUR.md under "HTTP-API" och
// skrivs bara här.
const MESSAGES = Object.freeze({
  unknownPath: 'Okänd adress.',
  methodNotAllowed: 'Metoden stöds inte.',
  entryNotFound: 'Posten finns inte.'
});

const API_PREFIX = '/api/';
const ENTRIES_PATH = '/api/entries';
const ENTRY_PATH_PREFIX = '/api/entries/';

// Ett eget värde i stället för null eller undefined: en kropp som innehåller
// exakt "null" är giltig JSON och ska nå createEntry, inte förväxlas med en
// kropp som inte gick att tolka.
const UNPARSABLE = Symbol('unparsable');

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

// Läser hela kroppen. Avvisas strömmen (klienten bryter anropet mitt i) svarar
// funktionen null, och POST-vägen behandlar det som en kropp som inte gick att
// tolka — annars skulle löftet aldrig fullbordas och anropet hänga för alltid.
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

function parseBody(text) {
  if (text === null) {
    return UNPARSABLE;
  }
  try {
    return JSON.parse(text);
  } catch {
    return UNPARSABLE;
  }
}

// Id:t är resten av sökvägen efter /api/entries/, ordagrant. Ingen trimning,
// ingen avkodning och ingen normalisering: en post som inte matchar exakt finns
// inte. Ett tomt id och ett id som innehåller / är ingen postväg alls utan
// "annat /api/*", alltså Okänd adress.
function entryIdFromPath(pathname) {
  if (!pathname.startsWith(ENTRY_PATH_PREFIX)) {
    return null;
  }
  const id = pathname.slice(ENTRY_PATH_PREFIX.length);
  if (id === '' || id.includes('/')) {
    return null;
  }
  return id;
}

// Returnerar true om anropet hanterades, false om det inte var en /api-väg.
export async function handleApiRequest(req, res, pathname) {
  if (pathname !== '/api' && !pathname.startsWith(API_PREFIX)) {
    return false;
  }

  if (pathname === ENTRIES_PATH) {
    if (req.method === 'GET') {
      await handleList(res);
      return true;
    }
    if (req.method === 'POST') {
      await handleCreate(req, res);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const id = entryIdFromPath(pathname);
  if (id !== null) {
    if (req.method === 'DELETE') {
      await handleDelete(res, id);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  sendJson(res, 404, { error: MESSAGES.unknownPath });
  return true;
}

async function handleList(res) {
  let entries;
  try {
    // GET läser bara och använder loadEntries; updateEntries är för de två
    // vägar som ändrar filen.
    entries = await loadEntries();
  } catch (error) {
    // storage.js kastar bara StorageError, och dess .message är svensk text
    // avsedd att visas för användaren.
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { entries });
}

async function handleCreate(req, res) {
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }

  // draft skickas orört vidare. Allt som inte är ett vanligt objekt — null, en
  // array, en sträng — hanteras av validateEntryDraft och ger fältfel.
  //
  // createEntry anropas före updateEntries, aldrig inuti mutera: ett
  // valideringsfel ska ge 400 utan att någon köplats tas i anspråk, precis som
  // skrivvägens rad 1-3 avvisar utan att röra disken.
  const result = createEntry(draft);
  if (!result.ok) {
    // Statuskoden avgörs av felets ursprung, inte av returtypen. Ett fel med
    // field: 'id' kan bara orsakas av ett programmeringsmisstag i appen, aldrig
    // av användarens anrop: 500, och utan fieldErrors — 'id' finns inte i
    // formuläret och skulle bli osynligt som fältfel. fieldErrors bär därmed
    // alltid bara de fem formulärfälten, vilket app.js showErrors bygger på.
    const internal = result.errors.find((error) => error.field === 'id');
    if (internal !== undefined) {
      sendJson(res, 500, { error: internal.message });
      return;
    }
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }

  try {
    // Ett enda anrop, aldrig loadEntries följt av saveEntries: läsningen och
    // skrivningen ska ligga i samma köplats, annars tappar två överlappande
    // POST varandras post.
    await updateEntries((entries) => [...entries, result.value]);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { entry: result.value });
}

async function handleDelete(res, id) {
  let remaining;
  try {
    // Beslutet "finns posten?" fattas inuti köplatsen, av mutera, och inte av
    // en läsning före den: två samtidiga DELETE av samma id ger då exakt ett
    // 204 och exakt ett 404. mutera kastar aldrig och svarar null för
    // "skriv inte".
    remaining = await updateEntries((entries) => {
      const kept = entries.filter((entry) => entry.id !== id);
      return kept.length === entries.length ? null : kept;
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (remaining === null) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }

  res.writeHead(204);
  res.end();
}
