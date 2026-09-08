// Läser och skriver datafilen. Enda stället som rör disken för poster.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isEntry, isPlainObject } from '../core/entry.js';
import { getDataFilePath } from './paths.js';

export const STORAGE_VERSION = 1;

// .message är alltid svensk text: den skickas rakt ut till användaren av
// api.js (500 { error }) i paket 5.
export class StorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageError';
  }
}

// Skrivvägens felmeddelanden. Ordningen mellan dem står i "Beteende vid
// skrivning" i ARKITEKTUR.md; strängarna skrivs bara här.
const SAVE_MESSAGES = Object.freeze({
  notAnArray: 'Posterna kunde inte sparas: listan över poster är ogiltig.',
  invalidEntry: (index) => `Posterna kunde inte sparas: post nummer ${index + 1} är ogiltig.`,
  notJson: 'Posterna kunde inte sparas: de gick inte att omvandla till JSON.',
  mkdirFailed: (filePath) => `Datafilen kunde inte sparas: katalogen gick inte att skapa: ${filePath}`,
  writeFailed: (filePath) => `Datafilen kunde inte sparas: skrivningen misslyckades: ${filePath}`,
  renameFailed: (filePath) => `Datafilen kunde inte sparas: den nya filen gick inte att byta in: ${filePath}`,
  unexpected: 'Posterna kunde inte sparas: ett oväntat fel inträffade.'
});

// Rad 7 i skrivtabellen, med en enda ägare. En StorageError som redan kastats
// på rad 1-6 kastas om oförändrad — annars skulle rad 7 skriva över deras
// meddelanden. Rad 7 får ingen sökväg: den fångar också fel som inträffar innan
// sökvägen har använts.
function asStorageError(error) {
  if (error instanceof StorageError) {
    return error;
  }
  return new StorageError(SAVE_MESSAGES.unexpected, { cause: error });
}

// Modullokal löfteskedja för varje diskoperation i modulinstansen. Både
// loadEntries och saveEntries utökar den synkront, före sitt första await, så
// att kedjans ordning är anropsordningen. Kedjan går vidare både efter
// uppfyllelse och efter avvisning: ett misslyckat anrop får varken blockera
// nästa eller bli nästa anrops fel.
let ioQueue = Promise.resolve();

export async function loadEntries() {
  // Sökvägen läses vid varje anrop, aldrig vid modulladdning. Filen på disk är
  // sanningen — ingenting cachas i modulminne.
  const filePath = getDataFilePath();

  // Kön utökas synkront, före funktionens första await, precis som i
  // saveEntries: annars är kedjans ordning inte anropsordningen. Läsningen
  // ligger i samma kö som skrivningen, eftersom fs.rename på Windows ger EPERM
  // när datafilen är öppen i en annan handtagare — även när det är appens egen
  // samtidiga läsning som håller den öppen.
  const work = ioQueue.then(() => readFromDisk(filePath));
  ioQueue = work.then(() => undefined, () => undefined);
  return work;
}

// Hela fs.readFile-arbetet ligger inuti kedjan: läsvägens tabell i
// ARKITEKTUR.md prövas alltså först när kön släppt fram anropet.
async function readFromDisk(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Filen saknas: tom lista, inget fel, och ingen fil skapas.
      return [];
    }
    throw new StorageError(`Datafilen kunde inte läsas: ${filePath}`, { cause: error });
  }

  if (text.trim() === '') {
    return [];
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new StorageError(`Datafilen är skadad och kunde inte läsas: ${filePath}`, { cause: error });
  }

  // isPlainObject i entry.js äger villkoret "är det här ett vanligt objekt";
  // storage.js skriver ingen egen kopia. Utan delvillkoret kastar `null.entries`
  // ett TypeError i stället för StorageError — det är den enda skillnaden i
  // mätt beteende, eftersom 42, "text", true, [] och [1,2] saknar entries och
  // avvisas av nästa delvillkor ändå (körd jämförelse, alla sex värdena).
  if (!isPlainObject(data) || !Array.isArray(data.entries)) {
    throw new StorageError(`Datafilen har fel innehåll: ${filePath}`);
  }

  if (data.version !== STORAGE_VERSION) {
    throw new StorageError(`Datafilen har en version som appen inte känner igen: ${filePath}`);
  }

  // isEntry är enda domaren över om en post är giltig. storage.js har ingen
  // egen åsikt om id, belopp eller datum.
  for (const entry of data.entries) {
    if (!isEntry(entry)) {
      throw new StorageError(`Datafilen innehåller en ogiltig post: ${filePath}`);
    }
  }

  return data.entries;
}

export async function saveEntries(entries) {
  // Sökvägen läses en gång per anrop, precis som i loadEntries.
  let filePath;
  let text;
  try {
    filePath = getDataFilePath();

    // Rad 1: allt som inte är en array avvisas innan något rör disken.
    if (!Array.isArray(entries)) {
      throw new StorageError(SAVE_MESSAGES.notAnArray);
    }

    // Rad 2: isEntry är enda domaren, samma funktion som läsvägen frågar.
    // Lägsta index vinner, och numret i meddelandet räknas från 1.
    for (let index = 0; index < entries.length; index += 1) {
      if (!isEntry(entries[index])) {
        throw new StorageError(SAVE_MESSAGES.invalidEntry(index));
      }
    }

    // Rad 3: strängifieringen sker före kön, alltså utan att ta plats i den.
    try {
      text = JSON.stringify({ version: STORAGE_VERSION, entries }, null, 2) + '\n';
    } catch (error) {
      throw new StorageError(SAVE_MESSAGES.notJson, { cause: error });
    }
  } catch (error) {
    throw asStorageError(error);
  }

  // Kön utökas synkront, före funktionens första await. Anrop nummer två börjar
  // först när anrop nummer ett är klart, så anropsordningen avgör och sista
  // anropet vinner på disk. Kedjan behöver bara en handlare: nästa rad
  // neutraliserar varje avvisning, så ioQueue kan aldrig vara ett avvisat löfte
  // och en andra handlare vore en gren ingen indata når.
  const work = ioQueue.then(() => writeToDisk(filePath, text));
  ioQueue = work.then(() => undefined, () => undefined);

  // Ingen catch här: writeToDisk lindar varje node:fs-anrop och sväljer sitt
  // eget städningsfel, så work kan bara avvisa med StorageError. Rad 7 ligger
  // därför bara runt arbetet före kön.
  return work;
}

// Rad 4-6 i skrivtabellen. Varje node:fs-anrop ligger innanför sitt eget
// try/catch, och <sökväg> i meddelandet är alltid datafilens sökväg, aldrig
// temporärfilens: temporärnamnet innehåller ett pid och ett UUID som inte
// betyder något för användaren.
async function writeToDisk(filePath, text) {
  // Namnet är unikt per anrop och får aldrig härledas enbart ur datafilens
  // namn: två överlappande anrop skulle då välja samma fil och blanda sitt
  // innehåll.
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (error) {
      throw new StorageError(SAVE_MESSAGES.mkdirFailed(filePath), { cause: error });
    }

    // Atomär skrivning: allt innehåll hamnar först i temporärfilen, och först
    // därefter byter rename ut den riktiga filen i ett steg.
    try {
      await fs.writeFile(tempPath, text, 'utf8');
    } catch (error) {
      throw new StorageError(SAVE_MESSAGES.writeFailed(filePath), { cause: error });
    }

    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      throw new StorageError(SAVE_MESSAGES.renameFailed(filePath), { cause: error });
    }
  } finally {
    // Kördes inte rename klart ligger temporärfilen kvar. Städningen har ett
    // eget try/catch och sväljer sitt eget fel: den får varken göra en lyckad
    // skrivning till ett fel eller ersätta det verkliga felet.
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Med flit tom.
    }
  }
}

// Läs-ändra-skriv innanför en enda köplats (ARKITEKTUR.md, "Läs–ändra–skriv i
// ett steg"). loadEntries() följt av saveEntries(...) är två köplatser med ett
// glapp emellan: två överlappande anrop läser då samma utgångsläge och skriver
// över varandra, och båda svarar att det gick bra.
//
// mutera(entries) körs mellan läsningen och skrivningen, innanför samma
// köplats. Returnerar den skrivna listan, eller null när mutera valde att inte
// skriva.
export async function updateEntries(mutera) {
  // Sökvägen läses synkront, före kön, precis som i loadEntries och
  // saveEntries.
  const filePath = getDataFilePath();

  // Kön utökas synkront, före funktionens första await. Läsningen och
  // skrivningen ligger i samma köplats: ingen annan diskoperation i den här
  // modulinstansen kan komma emellan.
  const work = ioQueue.then(() => readModifyWrite(filePath, mutera));
  ioQueue = work.then(() => undefined, () => undefined);
  return work;
}

// Innehållet i köplatsen. updateEntries anropar aldrig loadEntries eller
// saveEntries: ett anrop till dem härifrån skulle ställa sig sist i en kö som
// väntar på just den här köplatsen — en låsning som inget felmeddelande
// beskriver. De modullokala readFromDisk och writeToDisk används i stället.
async function readModifyWrite(filePath, mutera) {
  // Läsvägens tabell gäller oförändrad, och readFromDisk kastar bara
  // StorageError.
  const entries = await readFromDisk(filePath);

  let next;
  let text;
  try {
    // Tillägg U1: kastar mutera blir svaret skrivtabellens rad 7, samma sträng
    // och samma ägare — ingen ny sträng.
    next = mutera(entries);

    // Tillägg U2: null betyder "skriv inte". Det är inget fel, och ingenting
    // rör disken.
    if (next === null) {
      return null;
    }

    // Skrivtabellens rad 1-3 prövas inuti köplatsen här, till skillnad från i
    // saveEntries: listan finns först efter läsningen. Strängarna och ordningen
    // är oförändrade.
    if (!Array.isArray(next)) {
      throw new StorageError(SAVE_MESSAGES.notAnArray);
    }

    for (let index = 0; index < next.length; index += 1) {
      if (!isEntry(next[index])) {
        throw new StorageError(SAVE_MESSAGES.invalidEntry(index));
      }
    }

    try {
      text = JSON.stringify({ version: STORAGE_VERSION, entries: next }, null, 2) + '\n';
    } catch (error) {
      throw new StorageError(SAVE_MESSAGES.notJson, { cause: error });
    }
  } catch (error) {
    throw asStorageError(error);
  }

  // Rad 4-6 och finally-städningen, samma funktion som saveEntries använder.
  await writeToDisk(filePath, text);
  return next;
}
