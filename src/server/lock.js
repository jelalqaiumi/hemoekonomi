// Låset på datafilen: en instans i taget.
//
// ioQueue och updateEntries i storage.js gör varje läs-ändra-skriv odelbar inom
// EN process. Två processer delar inte modulminne, så två servrar mot samma
// datafil läser samma utgångsläge och skriver över varandra. Uppmätt i det här
// projektet, två serverprocesser på 3111 och 3112 mot samma datafil, 20 omgångar
// av Promise.all([POST mot A, POST mot B]): omgångar där en post tappades 20 av
// 20, poster på disk till slut 20 (förväntat 40).
//
// Svaret är en spärr vid processgränsen: start() tar låset innan porten binds,
// och en andra instans startar inte.
//
// Ägarskapet bokförs per låssökväg i heldLocks och aldrig i en enda variabel.
// Med en enda variabel gav ett lås på a.json följt av ett lås på b.json ett
// släpp som lämnade "a.json.lock: finns, b.json.lock: BORTA", och a.json.lock
// städades aldrig; och ett andra start() i samma process delade låset utan att
// någon räknade innehavare, så det anropets misslyckade listen tog bort ett lås
// som den första servern fortfarande använde (LARDOMAR.md 2026-09-07).
//
// Modulen är den enda i src/server/ som rör låsfilen; storage.js känner inte
// till att den finns.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getDataFilePath, getLockFilePath } from './paths.js';

// De fem svenska strängarna, rad L1-L5 i tabellen under "Låset på datafilen —
// en instans i taget" i ARKITEKTUR.md. Rad L1 och rad L5 namnger DATAFILEN,
// eftersom det är den resurs användaren delar och den enda uppgift som gör felet
// begripligt när två fönster står öppna. Rad L2-L4 namnger LÅSFILEN, eftersom
// den är det användaren ska ta bort. Rad L5 bär ingen pid: det är den egna
// processen, och en pid som pekar på en själv hjälper ingen.
const LOCK_MESSAGES = Object.freeze({
  sameProcess: (dataFilePath) =>
    `Hemochekonomi kör redan i den här processen mot samma datafil: ${dataFilePath}. `
    + 'En datafil används av högst en instans i taget — stäng den första servern innan du startar en ny.',
  alreadyRunning: (pid, dataFilePath) =>
    `Hemochekonomi kör redan i en annan process (pid ${pid}) mot samma datafil: ${dataFilePath}. `
    + 'Stäng den först — två samtidiga körningar mot samma fil kan förstöra dina poster.',
  unparsable: (lockPath) =>
    `Hemochekonomi kunde inte starta: låsfilen ${lockPath} går inte att tolka. `
    + 'Kontrollera att appen inte redan kör, ta bort filen och försök igen.',
  unreadable: (lockPath) =>
    `Hemochekonomi kunde inte starta: låsfilen ${lockPath} gick inte att läsa. `
    + 'Kontrollera att appen inte redan kör, ta bort filen och försök igen.',
  notCreated: (lockPath) => `Hemochekonomi kunde inte starta: låsfilen ${lockPath} gick inte att skapa.`
});

// Märkningen: den låsande processens pid som decimal text, ett kolon, ett
// randomUUID() och ett avslutande radslut. Allt annat är rad L2 — också en
// låsfil som bara bär en pid, alltså det format en äldre version av appen skrev.
const MARKING_PATTERN = /^([0-9]+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// .message är alltid svensk text: den går genom asStartError rad 0 ordagrant och
// skrivs rakt ut till stderr av autostarten.
export class DataFileLockError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DataFileLockError';
  }
}

// Modullokalt tillstånd. heldLocks är en Map från låssökväg till den märkning
// processen skrev i just den filen: två datafiler kan hållas samtidigt, och
// varje släpp gäller den sökväg det handlar om och aldrig "den senast tagna".
// lockQueue är löfteskedjan båda exporterna ligger i, och flaggan säger att
// exit-hanteraren är registrerad.
const heldLocks = new Map();
let lockQueue = Promise.resolve();
let exitHandlerRegistered = false;

// Innehållet läses alltid med 'utf8' och är därför alltid en sträng: en
// typkontroll här vore en gren ingen indata når.
function withoutNewline(content) {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

// Ger märkningens pid, eller null om innehållet inte är en märkning.
//
// pid <= 0 avvisas och inte bara för formens skull: process.kill(0, 0) frågar om
// den EGNA processgruppen och skulle svara "lever" för varje körning, så en
// märkning med "0" skulle annars blockera för alltid utan att någon kör.
function markingPid(content) {
  const match = MARKING_PATTERN.exec(withoutNewline(content));
  if (match === null) {
    return null;
  }
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  return pid;
}

// Sista utvägen. En exit-hanterare kan inte invänta ett löfte, så det här är den
// enda synkrona filoperationen i src/. Den går igenom VARJE post i heldLocks —
// en städning av bara den senast tagna sökvägen lämnar kvar varje annat lås
// processen håller — och sväljer sina egna fel, precis som finally-städningen av
// temporärfilen i saveEntries: ett fel här får inte ändra hur processen avslutas.
function releaseSync() {
  for (const [lockPath, token] of heldLocks) {
    try {
      // Läser innan den tar bort: släppandet tar aldrig ett annat lås än sitt
      // eget, och jämförelsen gäller hela märkningen. En jämförelse på bara pid
      // räcker inte — en märkning från ett tidigare, redan släppt lås i samma
      // process bär samma pid.
      if (withoutNewline(fsSync.readFileSync(lockPath, 'utf8')) === token) {
        fsSync.unlinkSync(lockPath);
      }
    } catch {
      // Sväljs med flit. En krasch, ett SIGKILL eller ett Ctrl+C kan lämna
      // låsfilen kvar, och det är inte ett fel utan det normala fallet: nästa
      // start läser pid:en, ser att processen är borta och tar över låset.
    }
  }
  heldLocks.clear();
}

function registerExitCleanup() {
  if (exitHandlerRegistered) {
    return;
  }
  exitHandlerRegistered = true;
  process.once('exit', releaseSync);
}

// wx: skapandet lyckas bara om filen inte redan finns, och det är den
// operationen som är odelbar i filsystemet. Ett läs-först-skriv-sedan vore samma
// kapplöpning som låset finns för att stänga. Bokföringen sker i samma steg som
// skrivningen: heldLocks och filen får aldrig komma ur takt.
async function writeLock(lockPath, token) {
  await fs.writeFile(lockPath, `${token}\n`, { flag: 'wx' });
  heldLocks.set(lockPath, token);
  registerExitCleanup();
}

// Ordningen står som pseudokod i ARKITEKTUR.md och följs här steg för steg.
// Låset släpper bara på ett bevis, aldrig på en gissning: enda vägen att ta över
// ett lås som bär en ANNAN process pid är att process.kill(pid, 0) avvisar den
// pid:en med ESRCH. Varje annat utfall blockerar starten, och det är valt med
// flit — ett fel åt det hållet betyder "appen startar inte och säger varför på
// svenska", ett fel åt andra hållet betyder "två instanser skriver över
// varandras poster utan att någon får veta det".
async function acquireOnce() {
  const lockPath = getLockFilePath();

  // Rad L5, och den prövas först: svaret kommer ur den egna bokföringen, så det
  // kostar ingen filoperation och kan aldrig förväxlas med rad L1. Två start() i
  // samma process är två instanser lika mycket som två processer är det.
  if (heldLocks.has(lockPath)) {
    throw new DataFileLockError(LOCK_MESSAGES.sameProcess(getDataFilePath()));
  }

  const token = `${process.pid}:${randomUUID()}`;

  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
  } catch (error) {
    throw new DataFileLockError(LOCK_MESSAGES.notCreated(lockPath), { cause: error });
  }

  try {
    await writeLock(lockPath, token);
    return lockPath;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw new DataFileLockError(LOCK_MESSAGES.notCreated(lockPath), { cause: error });
    }
  }

  // EEXIST: låsfilen finns redan. Vem äger den?
  let content;
  try {
    content = await fs.readFile(lockPath, 'utf8');
  } catch (error) {
    throw new DataFileLockError(LOCK_MESSAGES.unreadable(lockPath), { cause: error });
  }

  const pid = markingPid(content);
  if (pid === null) {
    throw new DataFileLockError(LOCK_MESSAGES.unparsable(lockPath));
  }

  if (pid !== process.pid) {
    let esrch = false;
    try {
      // Signal 0 skickar ingenting: den frågar bara om processen finns.
      process.kill(pid, 0);
    } catch (error) {
      esrch = error.code === 'ESRCH';
    }
    if (!esrch) {
      // Pid:en lever, eller så gick frågan inte att ställa (EPERM). Ingen
      // gissning: starten blockeras.
      throw new DataFileLockError(LOCK_MESSAGES.alreadyRunning(pid, getDataFilePath()));
    }
  }
  // Här är låset övergivet: antingen bär det den EGNA pid:en — och då finns
  // ingen nuvarande innehavare, för annars hade rad L5 vunnit innan disken
  // rördes — eller så är pid:en död enligt ESRCH. Båda vägarna tar över låset.

  // De två sista anropen har ingen egen felhantering, och strykningen är mätt.
  // De hade tidigare var sin gren — en catch som svalde unlink-felet och en
  // catch som kastade rad L4 efter försök 2 — och ingen indata nådde någon av
  // dem. Den enda konstruktion som fanns, en märkning med en död pid plus ett
  // öppet handtag på låsfilen, gav i den här miljön "unlink LYCKADES med oppet
  // handtag", "filen finns efterat: false" och "writeFile wx LYCKADES", alltså
  // inget EEXIST i försök 2; instrumentering av båda grenarna över hela sviten
  // gav GREN unlink-catch: 0 och GREN forsok2-catch: 0, och båda mutationerna
  // gav pass 18, fail 0, EXIT=0. En gren ingen indata når är inte ett skydd utan
  // en osann uppgift om vad koden hanterar (LARDOMAR.md 2026-09-04).
  //
  // Följden är skriven i stället för antagen: ett fel härifrån lämnar
  // acquireDataFileLock rått, går genom start:s try/catch och blir rad 3 under
  // "Beteende vid start" — svensk text, cause satt, ingen krasch, men med
  // portens namn i stället för låsfilens. Rad L4 är oförändrad och nås av mkdir
  // och av försök 1, båda med testfall.
  await fs.unlink(lockPath);
  await writeLock(lockPath, token);
  return lockPath;
}

// Idempotent och kastar aldrig. null, undefined och en sökväg utan post i
// heldLocks betyder alla "ingenting att släppa", och anropet rör då inte disken.
async function releaseOnce(lockPath) {
  const token = heldLocks.get(lockPath);
  if (token === undefined) {
    return;
  }
  // Posten tas bort oavsett filens utfall: bokföringen säger vem som håller
  // låset, och den innehavaren har släppt det.
  heldLocks.delete(lockPath);
  try {
    if (withoutNewline(await fs.readFile(lockPath, 'utf8')) === token) {
      await fs.unlink(lockPath);
    }
  } catch {
    // Sväljs med flit, precis som finally-städningen i saveEntries: ett fel i
    // städningen får aldrig bli anroparens fel.
  }
}

// Båda exporterna ligger i samma modullokala löfteskedja, samma konstruktion som
// ioQueue i storage.js: kedjan utökas synkront före funktionens första await, så
// att kedjans ordning är anropsordningen. Utan kön kan bokföringen och filen
// komma ur takt på två sätt — två acquire som båda ser ett heldLocks utan posten
// tar sig båda förbi rad L5 och skriver över varandras låsfil, och ett release
// vars unlink ligger i luften hinner ta bort den låsfil ett efterföljande
// acquire just skapat.
//
// Neutraliseringsraden gör att kedjan aldrig kan vara ett avvisat löfte, och
// därför har work-raden bara en handlare: en andra vore en gren ingen indata når.
export async function acquireDataFileLock() {
  const work = lockQueue.then(() => acquireOnce());
  lockQueue = work.then(() => undefined, () => undefined);
  return work;
}

export async function releaseDataFileLock(lockPath) {
  const work = lockQueue.then(() => releaseOnce(lockPath));
  lockQueue = work.then(() => undefined, () => undefined);
  return work;
}
