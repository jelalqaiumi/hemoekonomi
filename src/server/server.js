// HTTP-server, statisk filserver och appens startpunkt.
// Lyssnar på 127.0.0.1, aldrig 0.0.0.0: appen är för en person på en enhet och
// ska inte vara nåbar från nätverket.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNPARSABLE_MESSAGE, handleApiRequest } from './api.js';
import { DataFileLockError, acquireDataFileLock, releaseDataFileLock } from './lock.js';
import { getCoreDir, getDemoDir, getImageDir, getWebDir } from './paths.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

// Rad S2 i tabellen "Ett trasigt anrop får inte döda appen". Strängen ägs av den
// här filen. Felets eget meddelande når aldrig användaren: det kan vara engelsk
// OS-text eller bära en sökväg, samma skäl som skrivtabellens rad 7 har.
const UNEXPECTED_MESSAGE = 'Ett oväntat fel inträffade. Försök igen.';

// Startfelen — en sträng per rad i tabellen "Beteende vid start". <port> är
// argumentet till start, aldrig server.address(), som är null när listen
// misslyckades.
// Rad 1:s text är omskriven i paket 5 och den gamla lydelsen är förbjuden: den
// bad användaren på svenska att göra just det som förstör hens data — starta en
// andra instans mot samma datafil, mätt till 20 tappade poster på 20 omgångar.
// Efter låset är "Hemochekonomi kör redan" dessutom rad L1:s svar och inte den
// här radens: när porten är upptagen och låset gick att ta är det något annat
// program som håller porten. Texten säger därför inte längre vad som håller
// porten.
const START_MESSAGES = Object.freeze({
  addressInUse: (port) => `Port ${port} är upptagen. Stäng programmet som använder porten, `
    + 'eller sätt PORT till ett annat portnummer och starta om Hemochekonomi.',
  accessDenied: (port) => `Port ${port} gick inte att öppna: åtkomst nekades. Sätt PORT till ett annat portnummer.`,
  unexpected: (port) => `Servern kunde inte startas på port ${port}.`
});

const HTML_TYPE = 'text/html; charset=utf-8';
const CSS_TYPE = 'text/css; charset=utf-8';
const JS_TYPE = 'text/javascript; charset=utf-8';

// Nollprototyp: ett vanligt objektuppslag skulle annars kunna träffa något som
// ärvs från Object.prototype i stället för en riktig rutt.
//
// "/" är landningssidan och "/app" är den inloggade appen. Bytet skedde i
// paket "ny design och landningssida"; dessförinnan låg index.html på "/".
// index.html hämtar fortfarande /style.css, /app.js och /core/*.js med
// absoluta sökvägar, så flytten av dess egen adress ändrar ingenting i filen.
// "/app" och "/app.js" är två skilda nycklar och slås upp med exakt likhet:
// den ena kan aldrig fånga den andra.
const STATIC_ROUTES = Object.freeze(Object.assign(Object.create(null), {
  '/': { file: 'landning.html', type: HTML_TYPE },
  '/app': { file: 'index.html', type: HTML_TYPE },
  '/landning.css': { file: 'landning.css', type: CSS_TYPE },
  '/tema.css': { file: 'tema.css', type: CSS_TYPE },
  '/style.css': { file: 'style.css', type: CSS_TYPE },
  '/app.js': { file: 'app.js', type: JS_TYPE },
  // Prissidans kort [steg 1 i del 5]. Hämtas bara av landning.html, på samma
  // form som /app.js hämtas bara av index.html.
  '/priser.js': { file: 'priser.js', type: JS_TYPE }
}));

const CORE_PREFIX = '/core/';
const CORE_TYPE = JS_TYPE;
// Bara ett rent filnamn får slås upp under /core/. Kontrollen sker före
// sökvägssammanslagningen, aldrig efter: mönstret tillåter varken punkt, snedstreck
// eller versaler, så "..", "../paths.js" och "%2e%2e" kan aldrig nå path.join.
const CORE_FILE_PATTERN = /^[a-z0-9-]+\.js$/;

// Demofilerna under src/web/demo/. Samma form som /core/ och av samma skäl:
// mönstret prövas på namnet FÖRE path.join, och det tillåter varken punkt,
// snedstreck eller versaler, så "..", "../paths.js" och "%2e%2e" kan aldrig nå
// sammanslagningen.
//
// Katalogen serveras oavsett om DEMO är sann: index.html och landning.html
// hämtar /demo/demo-fetch.js vid varje laddning, och med flaggan falsk gör filen
// ingenting. Ett 404 i stället hade gett ett fel i webbläsarens konsol på varje
// sidladdning.
const DEMO_PREFIX = '/demo/';
// Ändelsen fångas av gruppen och avgör innehållstypen: en fil kan därför
// aldrig serveras med en typ som inte hör till dess namn.
const DEMO_FILE_PATTERN = /^[a-z0-9-]+\.(js|css)$/;
const DEMO_TYPES = Object.freeze(Object.assign(Object.create(null), {
  js: JS_TYPE,
  css: CSS_TYPE
}));

// Bilderna under src/web/bilder/. Samma form som /core/ och av samma skäl:
// mönstret prövas på namnet FÖRE path.join, och det tillåter varken punkt
// (annat än den före ändelsen), snedstreck eller versaler, så
// "..", "../../package.json" och "%2e%2e" kan aldrig nå sammanslagningen.
// Mönstret släpper bara igenom png, så innehållstypen är en enda konstant.
const IMAGE_PREFIX = '/bilder/';
const IMAGE_FILE_PATTERN = /^[a-z0-9-]+\.png$/;
const IMAGE_TYPE = 'image/png';

function sendNotFound(res) {
  res.writeHead(404);
  res.end();
}

// Samma form som /api/*: { "error": "<svensk text>" } med
// application/json; charset=utf-8. Rad S1 och S2 är det enda undantaget från att
// den formen bara gäller /api/*.
function sendJsonError(res, status, message) {
  const text = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

// Rad S2 och S3. Är svaret redan påbörjat går det inte att skicka en kropp: då
// stängs sockeln i stället, och klienten ser ett avbrutet svar. Processen lever
// vidare i båda fallen — det är hela poängen.
function sendUnexpectedError(res, error) {
  // error tas emot men används aldrig: felets eget meddelande når aldrig
  // användaren, och det loggas inte heller — svaret är hela hanteringen.
  void error;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJsonError(res, 500, UNEXPECTED_MESSAGE);
}

// Avgör vilken fil en sökväg pekar ut, eller null om den inte pekar ut någon.
function resolveStaticFile(pathname) {
  const route = STATIC_ROUTES[pathname];
  if (route !== undefined) {
    return { filePath: path.join(getWebDir(), route.file), type: route.type };
  }

  if (pathname.startsWith(CORE_PREFIX)) {
    const name = pathname.slice(CORE_PREFIX.length);
    if (!CORE_FILE_PATTERN.test(name)) {
      return null;
    }
    return { filePath: path.join(getCoreDir(), name), type: CORE_TYPE };
  }

  if (pathname.startsWith(DEMO_PREFIX)) {
    const name = pathname.slice(DEMO_PREFIX.length);
    const match = DEMO_FILE_PATTERN.exec(name);
    if (match === null) {
      return null;
    }
    // match[1] är 'js' eller 'css' och ingenting annat: mönstret har redan
    // avgjort det, och tabellen har nollprototyp av samma skäl som
    // STATIC_ROUTES.
    return { filePath: path.join(getDemoDir(), name), type: DEMO_TYPES[match[1]] };
  }

  if (pathname.startsWith(IMAGE_PREFIX)) {
    const name = pathname.slice(IMAGE_PREFIX.length);
    if (!IMAGE_FILE_PATTERN.test(name)) {
      return null;
    }
    return { filePath: path.join(getImageDir(), name), type: IMAGE_TYPE };
  }

  return null;
}

async function readOrNull(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function serveStatic(res, pathname) {
  const target = resolveStaticFile(pathname);
  // En sökväg utan rutt och en rutt vars fil saknas är samma sak för klienten:
  // 404. Beslutet fattas på ett enda ställe, och ingen av de två vägarna kan
  // täcka för den andra — läses filen utan att target prövats först kastar
  // target.filePath ett TypeError innan readOrNull ens anropas.
  const content = target === null ? null : await readOrNull(target.filePath);
  if (content === null) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': target.type, 'Content-Length': content.length });
  res.end(content);
}

async function handleRequest(req, res) {
  // Rad S1: går förfrågningsraden inte att tolka mot basen är det klientens
  // förfrågan som är trasig, inte appen — svaret är 400 och hanteringen är slut.
  // Körd: raderna GET http://[v1.x]/, GET http://[::1,
  // GET https://[fe80::1%25]/ och GET http://%/ når lyssnaren med req.url
  // ordagrant, och new URL kastar TypeError med code ERR_INVALID_URL för var och
  // en av dem. Utan try/catch blev avvisningen ohanterad och processen dog.
  let pathname;
  try {
    // Basen används bara för att kunna läsa ut pathname ur en relativ
    // förfrågningsrad. URL avkodar inte procenttecken i pathname, så id:t i
    // /api/entries/<id> når api.js ordagrant.
    ({ pathname } = new URL(req.url, `http://${HOST}`));
  } catch {
    sendJsonError(res, 400, UNPARSABLE_MESSAGE);
    return;
  }

  if (await handleApiRequest(req, res, pathname)) {
    return;
  }

  await serveStatic(res, pathname);
}

// handler tas som argument med handleRequest som defaultvärde, av samma skäl som
// handleApiRequest tar pathname: annars finns ingen indata som når rad S2 och S3,
// och en gren ingen indata når är ingen spärr utan en osann uppgift om vad koden
// hanterar. start() och autostarten anropar createServer() utan argument, så
// produktionsvägen är oförändrad.
export function createServer(handler = handleRequest) {
  return http.createServer((req, res) => {
    // .catch(...) täcker varje väg — sökvägsläsningen, handleApiRequest,
    // serveStatic och allt som tillkommer senare — och låter aldrig en avvisning
    // nå process. try/catch runt anropet täcker samma sak för en hanterare som
    // kastar synkront, innan något löfte finns: teststrategins rad S2 provoceras
    // med createServer(() => { throw new Error('trasig'); }), och utan try/catch
    // blir det kastet ett uncaughtException som dödar processen.
    try {
      handler(req, res).catch((error) => sendUnexpectedError(res, error));
    } catch (error) {
      sendUnexpectedError(res, error);
    }
  });
}

// Portvalet — beslutet, skilt från effekten. Uttrycket är Number(env.PORT) ||
// DEFAULT_PORT och ingenting mer: ingen validering, ingen trimning och inget nytt
// felmeddelande. Miljön tas som argument just för att ett test ska kunna köra
// varje rad i facittabellen utan att binda en port och utan att röra process.env.
// Körd facittabell (ARKITEKTUR.md, "Gränssnitt"): osatt, '', '   ', 'abc' och
// '0' ger alla DEFAULT_PORT; '8080' ger 8080. Raden '0' är skälet till att ett test
// inte kan be om en ledig port via PORT — 0 är falskt.
export function resolvePort(env = process.env) {
  return Number(env.PORT) || DEFAULT_PORT;
}

// Autostartvillkoret — beslutet, skilt från effekten. argv1 och moduleUrl tas som
// argument så att båda utfallen går att pröva utan att någon server startas.
export function isDirectRun(argv1, moduleUrl) {
  return argv1 !== undefined && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

// .message är alltid svensk text: den skrivs rakt ut till stderr av autostarten
// och är appens svar till användaren när npm start misslyckas.
export class ServerStartError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ServerStartError';
  }
}

// Tabellen "Beteende vid start", första sanna raden vinner. EACCES får en egen
// rad och inte den gemensamma därför att åtgärden är en annan än vid EADDRINUSE:
// appen kör inte redan, utan porten är otillåten, och texten ska inte be
// användaren leta efter ett fönster som inte finns. Rad 3 gör invarianten "start
// avvisar alltid med ServerStartError" sann också för ett fel ingen har sett.
export function asStartError(port, error) {
  // Rad 0. Låsfelets text går vidare ordagrant och ingen ny sträng skrivs:
  // texten är redan svensk och redan användarens svar, och rad 3 skulle annars
  // skriva över den med en mening om porten. Portnumret får aldrig smyga in i
  // den — låset handlar om datafilen, inte om porten.
  if (error instanceof DataFileLockError) {
    return new ServerStartError(error.message, { cause: error });
  }
  if (error.code === 'EADDRINUSE') {
    return new ServerStartError(START_MESSAGES.addressInUse(port), { cause: error });
  }
  if (error.code === 'EACCES') {
    return new ServerStartError(START_MESSAGES.accessDenied(port), { cause: error });
  }
  return new ServerStartError(START_MESSAGES.unexpected(port), { cause: error });
}

export async function start(port = resolvePort(process.env)) {
  // Sökvägen till DET HÄR anropets lås, och ingen fråga till låsmodulen om vad
  // som råkar vara taget. Variabeln är null tills låset är taget: var det låset
  // självt som fällde starten släpps därför ingenting, och den första serverns
  // lås ligger orört kvar (LARDOMAR.md 2026-09-07, ett misslyckat andra start()).
  let lockPath = null;
  // Hela kroppen ligger innanför spärren, precis som varje node:fs-anrop ligger
  // innanför saveEntries rad 7: invarianten gäller varje fel som lämnar start,
  // inte bara listen-händelsen.
  try {
    // Låset tas FÖRE createServer och listen. Ordningen är ett beslut: den gör
    // "Hemochekonomi kör redan" till ett svar från låset och aldrig från
    // EADDRINUSE, så de två felen svarar på var sin fråga i stället för på samma.
    lockPath = await acquireDataFileLock();

    const server = createServer();
    await new Promise((resolve, reject) => {
      // listen rapporterar sitt fel som en händelse och inte som en avvisning:
      // utan den här lyssnaren uppfylls löftet aldrig, och Node kastar händelsen
      // vidare som tolv rader engelskt stackspår. Lyssnaren sätts upp före
      // listen-anropet.
      server.once('error', reject);
      server.listen(port, HOST, resolve);
    });

    // Låset hör till körningen och släpps när servern stängs. releaseDataFileLock
    // kastar aldrig, så void är hela hanteringen.
    server.once('close', () => {
      void releaseDataFileLock(lockPath);
    });

    // Efter ett lyckat listen sitter once('error', reject) kvar på ett redan
    // uppfyllt löfte, så ett senare error från servern sväljs i stället för att
    // kasta. Det är avsiktligt och följer kravet att servern aldrig får krascha.
    return server;
  } catch (error) {
    // Misslyckas createServer eller listen släpps det här anropets lås innan
    // felet kastas vidare. Fällde låset självt starten är lockPath fortfarande
    // null, och släppandet gör då ingenting — det är den enda vägen till "släpp
    // ingenting", och start avgör den med sin egen variabel.
    await releaseDataFileLock(lockPath);
    throw asStartError(port, error);
  }
}

// Startar automatiskt när filen körs direkt (npm start), aldrig när den
// importeras.
if (isDirectRun(process.argv[1], import.meta.url)) {
  try {
    const server = await start();
    // Den port som verkligen bands, läst ur server.address() efter listen.
    // Uppmätt, med mutationerna körda i en kopia av trädet under scratchpad:
    // mutation: const { port } = server.address(); -> const port = DEFAULT_PORT;
    //   ger EXIT=1 och ✖ node src/server/server.js startar servern, skriver sin
    //   rad och svarar på /
    // mutation: -> const port = 3000; ger EXIT=1 och samma ✖-rad.
    // mutation: -> const port = resolvePort(process.env); ger EXIT=0 och fail 0.
    // Det uttrycket är alltså det enda alternativ som överlever mutation, och det
    // är inte DEFAULT_PORT: autostarten får alltid sin port av resolvePort, medan
    // DEFAULT_PORT och siffran 3000 skiljer sig så snart PORT är satt — vilket
    // autostarttestet gör.
    const { port } = server.address();
    console.log(`Hemochekonomi kör på http://${HOST}:${port}`);
  } catch (error) {
    // Svensk text, inget stackspår och ingen rad till stdout. process.stderr.write
    // och inte console.error: startfelet är appens svar till användaren, inte en
    // felsökningsutskrift.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
