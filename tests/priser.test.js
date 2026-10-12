// Prissidans kort [steg 1 i del 5]: src/web/priser.js.
//
// Filen laddas av webbläsaren som en modul och har därför en automatisk körning,
// precis som src/web/app.js: en fil som ingen testfil ens parsar kan göras
// syntaktiskt trasig utan att npm test faller (LARDOMAR.md 2026-09-07).
// Källan läses från disk vid varje körning, så ett syntaxfel i filen fäller
// importen här.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INTERVAL_LABELS } from '../src/core/entry.js';
import { formatSek, ORE_PER_SEK } from '../src/core/money.js';
import { FEATURE_LABELS, featureText, NOT_BUILT_FEATURES, PLANS, PLAN_LABELS, planFor } from '../src/core/plans.js';
import { MONTHS_PER_PERIOD } from '../src/core/schedule.js';
import { createLandningDom } from './helpers/landning-dom.js';
import { visibleTexts } from './helpers/landning-text.js';

const PRISER_PATH = fileURLToPath(new URL('../src/web/priser.js', import.meta.url));
// Webbläsaren hämtar src/core/ under /core/; i en Node-körning finns ingen
// server, så specifikationerna pekas om till filerna på disk. Adressen byggs ur
// import.meta.url och aldrig ur process.cwd() (LARDOMAR.md 2026-09-04).
const CORE_DIR = new URL('../src/core/', import.meta.url).href;
const CORE_SPECIFIER = "'/core/";

// Laddar src/web/priser.js med document satt av laddaren. Ett unikt tillägg per
// anrop: två identiska data:-adresser är samma modul för laddaren, och filen
// ritar listan vid import.
async function loadPriser(t, { document }) {
  const kalla = await fs.readFile(PRISER_PATH, 'utf8');
  const antal = kalla.split(CORE_SPECIFIER).length - 1;
  assert.notEqual(
    antal,
    0,
    `src/web/priser.js importerar inte längre något under ${CORE_SPECIFIER}… — ompekningen träffar ingenting`
  );
  const omskriven = `${kalla.replaceAll(CORE_SPECIFIER, `'${CORE_DIR}`)}\n// ${randomUUID()}\n`;

  const tidigareDocument = globalThis.document;
  t.after(() => {
    if (tidigareDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = tidigareDocument;
    }
  });
  globalThis.document = document;

  return import(`data:text/javascript,${encodeURIComponent(omskriven)}`);
}

// Första elementet med klassen, bland kortets ättlingar. Klassnamnet jämförs ord
// för ord: priser.js skriver flera klasser på samma element.
function medKlass(element, className) {
  const alla = [];
  const samla = (nod) => {
    for (const barn of nod.children) {
      alla.push(barn);
      samla(barn);
    }
  };
  samla(element);
  return alla.find((nod) => nod.className.split(' ').includes(className)) ?? null;
}

function texter(element, className) {
  const alla = [];
  const samla = (nod) => {
    for (const barn of nod.children) {
      alla.push(barn);
      samla(barn);
    }
  };
  samla(element);
  return alla
    .filter((nod) => nod.className.split(' ').includes(className))
    .flatMap((nod) => nod.children.map((barn) => barn.textContent));
}

test('priser.js ritar ett kort per plan i PLANS, med namn, pris och knapp', async (t) => {
  const { document, list } = createLandningDom();
  await loadPriser(t, { document });

  const planer = Object.keys(PLANS);
  assert.equal(list.children.length, planer.length);

  for (const [index, plan] of planer.entries()) {
    const kort = list.children[index];
    assert.equal(kort.tagName, 'li', plan);
    // Namnet är det svenska ur PLAN_LABELS och aldrig plannyckeln.
    assert.equal(medKlass(kort, 'pris-tal') === null, false, plan);
    assert.equal(
      kort.children.find((barn) => barn.tagName === 'h3').textContent,
      PLAN_LABELS[plan],
      plan
    );
    // Priset går genom formatSek, som varje annat belopp i projektet. Jämförs
    // mot ett anrop och aldrig mot en skriven sträng: formatSek ger ett hårt
    // blanksteg före kr, och en skriven sträng med vanligt mellanslag hade
    // aldrig kunnat passera (LARDOMAR.md 2026-09-10).
    assert.equal(medKlass(kort, 'pris-tal').textContent, formatSek(PLANS[plan].priceOre), plan);
    // Knappen är en länk till /app och antyder ingen betalning.
    const knapp = kort.children.find((barn) => barn.tagName === 'a');
    assert.equal(knapp.textContent, `Välj ${PLAN_LABELS[plan]}`, plan);
    assert.equal(knapp.href, '/app', plan);
  }

  // Priserna är de tre i tabellen, skrivna som formatSek ger dem.
  assert.deepEqual(
    list.children.map((kort) => medKlass(kort, 'pris-tal').textContent),
    [formatSek(9900), formatSek(14900), formatSek(17900)]
  );
});

test('(P16) kortens punkter är featureText, och arvet står som en rad', async (t) => {
  const { document, list } = createLandningDom();
  await loadPriser(t, { document });

  const planer = Object.keys(PLANS);
  for (const [index, plan] of planer.entries()) {
    const egna = [...PLANS[plan].features].map((feature) => featureText(feature));
    // Den lägsta planen har bara sina egna punkter; de högre har raden
    // "Allt i <den lägre planen>" först, i stället för att räkna upp de lägre
    // planernas punkter igen.
    const vantat = index === 0
      ? egna
      : [`Allt i ${PLAN_LABELS[planer[index - 1]]}`, ...egna];
    assert.deepEqual(texter(list.children[index], 'pris-punkter'), vantat, plan);
  }

  // Ingen engelsk funktionsnyckel står i någon punkt: användaren ser aldrig dem.
  const allaPunkter = planer.flatMap((_, index) => texter(list.children[index], 'pris-punkter'));
  for (const feature of Object.keys(FEATURE_LABELS)) {
    assert.equal(allaPunkter.includes(feature), false, feature);
  }

  // Kortet lovar ingen funktion som inte finns: Plus-kortet säger att delat
  // hushåll inte finns i appen, och ingen punkt på något kort är det nakna namnet
  // på en funktion i NOT_BUILT_FEATURES.
  const plus = texter(list.children[planer.indexOf('plus')], 'pris-punkter');
  assert.equal(plus.includes('Delat hushåll - finns inte i appen'), true);
  for (const feature of NOT_BUILT_FEATURES) {
    assert.equal(allaPunkter.includes(FEATURE_LABELS[feature]), false, feature);
  }
});

test('mittenkortet är upphöjt och bär badgen, de andra två inte', async (t) => {
  const { document, list } = createLandningDom();
  await loadPriser(t, { document });

  const mitten = Math.floor(list.children.length / 2);
  for (const [index, kort] of list.children.entries()) {
    const upphojd = kort.className.split(' ').includes('pris-kort-upphojd');
    assert.equal(upphojd, index === mitten, `kort ${index}`);
    const badge = medKlass(kort, 'pris-badge');
    assert.equal(badge === null, index !== mitten, `kort ${index}`);
    if (index === mitten) {
      assert.equal(badge.textContent, 'Populärast');
    }
    // Guldknappen sitter på samma kort som badgen.
    const knapp = kort.children.find((barn) => barn.tagName === 'a');
    assert.equal(knapp.className.split(' ').includes('knapp-guld'), index === mitten, `kort ${index}`);
  }
});

test('en andra rendering ersätter korten i stället för att dubblera dem', async (t) => {
  const { document, list } = createLandningDom();
  const modul = await loadPriser(t, { document });

  const antal = list.children.length;
  modul.renderPlanCards(list);
  assert.equal(list.children.length, antal, 'korten dubblerades');
  // Och kortens ordning är densamma: renderingen är inte beroende av ett
  // tillstånd som ändras av att den körs.
  assert.deepEqual(
    list.children.map((kort) => kort.children.find((barn) => barn.tagName === 'h3').textContent),
    Object.keys(PLANS).map((plan) => PLAN_LABELS[plan])
  );
});

test('utan #pris-lista gör priser.js ingenting', async (t) => {
  const { document } = createLandningDom({ medLista: false });
  // Importen får inte kasta: filen laddas av varje sida som hämtar den, och ett
  // kast i webbläsaren hade skrivit ett engelskt fel i konsolen.
  const modul = await loadPriser(t, { document });
  assert.equal(typeof modul.renderPlanCards, 'function');
});

// Texterna i landning.html som hör till avsnittet Priser. Listan är tom i
// HTML:en med flit: står texten också där blir den ett andra facit som kan säga
// något annat än behörigheten.
test('landning.html har en tom pris-lista och demotexten under korten', async () => {
  const html = await fs.readFile(
    fileURLToPath(new URL('../src/web/landning.html', import.meta.url)),
    'utf8'
  );
  assert.equal(html.includes('<ul class="pris-lista" id="pris-lista"></ul>'), true);
  assert.equal(
    html.includes('Detta är en demo - du kan byta plan fritt och ingen betalning dras.'),
    true
  );
  // Inget pris, ingen knapptext och ingen funktionstext står skriven i
  // avsnittet Priser längre. Jämförelsen görs mot just det avsnittet och inte
  // mot hela filen: FAQ-svaret "Vad kostar Hem och Ekonomi?" räknar upp de tre
  // priserna som skriven text, och det svaret ligger utanför det här stegets
  // uppdrag — avvikelsen är redovisad till arkitekten i stället för ändrad här.
  const start = html.indexOf('<section class="priser"');
  assert.notEqual(start, -1, 'avsnittet Priser finns inte');
  const avsnitt = html.slice(start, html.indexOf('</section>', start));
  for (const text of ['99 kr', '149 kr', '179 kr', 'Välj Bas', 'Välj Plus', 'Populärast']) {
    assert.equal(avsnitt.includes(text), false, text);
  }
  for (const namn of Object.values(FEATURE_LABELS)) {
    assert.equal(avsnitt.includes(namn), false, namn);
  }
  // Och sidan hämtar filen som ritar dem.
  assert.equal(html.includes('src="/priser.js"'), true);
});

test('(P18) landning.html lovar ingen funktion som inte är byggd', async () => {
  // ARKITEKTUR.md, "Landningssidan lovar inget som inte finns": sidan får inte
  // nämna en funktion i NOT_BUILT_FEATURES. Den synliga texten tas ut med
  // visibleTexts, plus meta description, och varje text sänks till gemener, så
  // att en versal i början av en mening inte tar sig förbi jämförelsen. (P20)
  // jämför hela texten ordagrant.
  const html = await fs.readFile(
    fileURLToPath(new URL('../src/web/landning.html', import.meta.url)),
    'utf8'
  );
  const meta = /name="description"\s+content="([^"]*)"/.exec(html);
  assert.notEqual(meta, null, 'meta description saknas');
  const texter = [...visibleTexts(html), meta[1]].map((text) => text.toLocaleLowerCase('sv'));
  for (const feature of NOT_BUILT_FEATURES) {
    const namn = FEATURE_LABELS[feature].toLocaleLowerCase('sv');
    for (const text of texter) {
      assert.equal(text.includes(namn), false, `${feature}: ${text}`);
    }
  }
});

test('(P19) FAQ-svaret om priset säger att demon inte kostar något', async () => {
  // ARKITEKTUR.md, "Ändringar i src/web/landning.html", punkt 6: svaret är
  // användarens lydelse. Tankstrecket står som teckenreferensen &ndash; i
  // källan, och testet skriver det som en kodpunkt, så att tecknet aldrig står
  // rått i den här filen (LARDOMAR.md 2026-09-14).
  const TANKSTRECK = String.fromCodePoint(0x2013);
  const html = await fs.readFile(
    fileURLToPath(new URL('../src/web/landning.html', import.meta.url)),
    'utf8'
  );
  // Svaret ska stå i samma details som frågan, inte någonstans på sidan.
  const fraga = '<summary>Vad kostar Hem och Ekonomi?</summary>';
  const start = html.indexOf(fraga);
  assert.notEqual(start, -1, 'frågan om priset finns inte');
  const slut = html.indexOf('</details>', start);
  assert.notEqual(slut, -1, 'frågan om priset har ingen avslutande details');
  const utsnitt = html.slice(start, slut);
  const pStart = utsnitt.indexOf('<p>');
  const pSlut = utsnitt.indexOf('</p>', pStart);
  assert.notEqual(pStart, -1, 'svaret om priset har inget p-element');
  assert.notEqual(pSlut, -1, 'svaret om priset har inget avslutande p-element');
  const inner = utsnitt.slice(pStart + '<p>'.length, pSlut);

  // (a) Det råa innehållet: referensen står där, och det råa tecknet gör det inte.
  assert.equal(inner.includes('ingenting &ndash; ingen'), true, 'referensen &ndash; saknas');
  assert.equal(inner.includes(TANKSTRECK), false, 'tankstrecket står som rått tecken');

  // (b) Det användaren ser.
  assert.equal(
    inner.replaceAll('&ndash;', TANKSTRECK).replace(/\s+/g, ' ').trim(),
    `Bas kostar 99 kr/mån, Plus 149 kr/mån och Premium 179 kr/mån. Det här är en demoversion och kostar ingenting ${TANKSTRECK} ingen betalning tas ut. Du byter plan under Min plan i appen.`
  );
});

test('(P20) landning.html säger ordagrant det tabellen säger, och talen följer koden', async () => {
  // ARKITEKTUR.md, "Landningssidans synliga text — bindande ordagrant": listan
  // nedan är hela den text en besökare kan läsa, i dokumentordning. En text som
  // inte står här får inte finnas på sidan. Tankstrecket skrivs som en kodpunkt,
  // så att det aldrig står rått i den här filen (LARDOMAR.md 2026-09-14).
  const TANKSTRECK = String.fromCodePoint(0x2013);
  const SYNLIG_TEXT = [
    'Hem och Ekonomi | Full koll på hemmet och ekonomin', // T1
    'Hoppa till innehållet', // T2
    'Hem och Ekonomi', // T3
    'Funktioner', // T4
    'Priser', // T5
    'FAQ', // T6
    'Logga in', // T7
    'Registrera', // T8
    'Funktioner', // T9
    'Priser', // T10
    'FAQ', // T11
    'Logga in', // T12
    'Hemmets ekonomi, samlad', // T13
    'Full koll på hemmet och ekonomin på ett ställe', // T14
    'Inkomster, fasta utgifter och sparande i samma vy, räknade i hela ören. Du ser vad som är kvar att leva på varje månad och när nästa räkning förfaller, utan att öppna ett enda kalkylblad.', // T15
    'Kom igång', // T16
    'Se hur det fungerar', // T17
    'Fyra saker appen gör', // T18
    'Inget att ställa in först. Lägg in en återkommande post en gång, så kommer den med i varje månad den dras.', // T19
    'Budget som håller', // T20
    'Sätt ett tak per kategori för månaden, så visar appen hur mycket som är kvar. Drar du över taket syns det som ett minusbelopp.', // T21
    'Räkningar i tid', // T22
    'Ange förfallodag och hur ofta räkningen kommer. Appen visar hur många dagar som är kvar, och när du klickar Betald flyttas en återkommande räkning fram till nästa förfallodag.', // T23
    'Sparmål som syns', // T24
    'Sätt ett målbelopp och, om du vill, ett slutdatum. Stapeln visar hur långt du har kommit. Ingår från Plus.', // T25
    'Hela året på en gång', // T26
    'Tolv månader i en översikt: vad som kom in, vad som gick ut och vad som blev över.', // T27
    'Varför Hem och Ekonomi', // T28
    'Allt på ett ställe', // T29
    'Hyran, elen, strömmande tjänster och sparandet i samma månadsvy. Inga kalkylblad som glider isär mellan månaderna.', // T30
    'Dina siffror stannar hos dig', // T31
    'Appen kör på din egen dator, och uppgifterna sparas där. Ingen tredje part får se vad hushållet tjänar eller betalar.', // T32
    'Räknat i öre, inte på en höft', // T33
    'Varje belopp lagras i hela ören, så månadens summor stämmer på öret. En kvartalsutgift räknas med hela beloppet i de månader den dras.', // T34
    'Så fungerar det', // T35
    '1', // T36
    'Registrera', // T37
    'Du anger din e-postadress och får en engångskod tillbaka. Inget lösenord att komma ihåg och inget att välja bort.', // T38
    '2', // T39
    'Lägg in din ekonomi', // T40
    'Inkomster, fasta utgifter och sparande, en post i taget. Namn, belopp och kategori, och för en återkommande post hur ofta den dras.', // T41
    '3', // T42
    'Få överblick', // T43
    'Överst i månaden står inkomster, utgifter, sparande och vad som är kvar att leva på. Översikten visar samma summor månad för månad.', // T44
    'Priser', // T45
    'Tre planer. Samma app, olika mycket av den.', // T46
    'Detta är en demo - du kan byta plan fritt och ingen betalning dras.', // T47
    'Vanliga frågor', // T48
    'Vad kostar Hem och Ekonomi?', // T49
    `Bas kostar 99 kr/mån, Plus 149 kr/mån och Premium 179 kr/mån. Det här är en demoversion och kostar ingenting ${TANKSTRECK} ingen betalning tas ut. Du byter plan under Min plan i appen.`, // T50
    'Var sparas mina uppgifter?', // T51
    'På den dator där appen körs: i en databasfil när du kör appen själv, och i webbläsarens lagring i demon. Uppgifterna om din ekonomi skickas aldrig vidare. Det enda som kan lämna datorn är din e-postadress och inloggningskoden, när appen är inställd på att mejla koden.', // T52
    'Behöver jag ett lösenord?', // T53
    'Nej. Du anger din e-postadress och loggar in med en engångskod. Det finns inget lösenord att glömma bort eller återställa.', // T54
    'Hur hanteras en utgift som dras var tredje månad?', // T55
    'Du lägger in den en gång som en återkommande post och väljer intervallet Kvartalsvis. Den räknas med hela beloppet i de månader den dras och syns inte i månaderna emellan.', // T56
    'Fungerar sidan utan JavaScript?', // T57
    'Det mesta av den. Frågorna och menyn öppnas av webbläsaren själv, men priskorten ritas med JavaScript. Inga typsnitt eller skript hämtas från någon tredje part.', // T58
    'Hem och Ekonomi', // T59
    'Funktioner', // T60
    'Priser', // T61
    'FAQ', // T62
    '© 2026 Hem och Ekonomi. Appen kör lokalt på din egen dator.', // T63
  ];
  const html = await fs.readFile(
    fileURLToPath(new URL('../src/web/landning.html', import.meta.url)),
    'utf8'
  );
  const texter = visibleTexts(html);

  // (a) Först &-kravet: en teckenreferens som visibleTexts inte avkodar står
  // kvar med sitt &. Ingen text i tabellen innehåller &, så jämförelsen nedan
  // hade annars fällt den först, med ett meddelande som inte säger varför.
  const medOchtecken = texter.find((text) => text.includes('&'));
  assert.equal(medOchtecken, undefined, `en synlig text innehåller &: ${medOchtecken}`);
  // Därefter antalet, så att en tillagd eller struken text pekas ut som just
  // det, och sist varje text med sitt nummer i tabellen.
  assert.equal(texter.length, SYNLIG_TEXT.length, 'antalet synliga texter');
  for (const [i, text] of SYNLIG_TEXT.entries()) {
    assert.equal(texter[i], text, `T${i + 1}`);
  }

  // (b) meta description.
  const meta = /name="description"\s+content="([^"]*)"/.exec(html);
  assert.notEqual(meta, null, 'meta description saknas');
  assert.equal(
    meta[1],
    'Hem och Ekonomi samlar hushållets inkomster, fasta utgifter och sparande på ett ställe och visar vad som är kvar att leva på varje månad och när räkningarna förfaller.'
  );

  // (c) Talen på sidan följer koden. Varje uppslag kräver att nyckeln finns, så
  // att ett tal utan ord fäller testet i stället för att ge "undefined".
  const TALORD = { 3: 'Tre', 4: 'Fyra', 12: 'Tolv' };
  const ORDNINGSTAL = { 3: 'tredje' };
  const talord = (n) => {
    assert.equal(Object.hasOwn(TALORD, n), true, `TALORD saknar ${n}`);
    return TALORD[n];
  };
  const ordningstal = (n) => {
    assert.equal(Object.hasOwn(ORDNINGSTAL, n), true, `ORDNINGSTAL saknar ${n}`);
    return ORDNINGSTAL[n];
  };

  const fordelar = html.split('<li class="fordel">').length - 1;
  assert.equal(texter[17].startsWith(`${talord(fordelar)} saker`), true, 'T18 och antalet fördelar');

  const api = await fs.readFile(
    fileURLToPath(new URL('../src/server/api.js', import.meta.url)),
    'utf8'
  );
  const manader = [...api.matchAll(/^const OVERVIEW_MONTHS = (\d+);$/gm)];
  assert.equal(manader.length, 1, 'OVERVIEW_MONTHS ska stå exakt en gång i api.js');
  assert.equal(
    texter[26].startsWith(`${talord(Number(manader[0][1]))} månader`),
    true,
    'T27 och OVERVIEW_MONTHS'
  );

  assert.equal(
    texter[45].startsWith(`${talord(Object.keys(PLANS).length)} planer.`),
    true,
    'T46 och antalet planer'
  );
  assert.equal(
    texter[54].includes(`var ${ordningstal(MONTHS_PER_PERIOD.quarterly)} månad`),
    true,
    'T55 och MONTHS_PER_PERIOD.quarterly'
  );
  assert.equal(
    texter[55].includes(`intervallet ${INTERVAL_LABELS.quarterly}`),
    true,
    'T56 och INTERVAL_LABELS.quarterly'
  );
  assert.equal(
    texter[24].endsWith(`Ingår från ${PLAN_LABELS[planFor('savingsGoals')]}.`),
    true,
    'T25 och planFor(savingsGoals)'
  );

  const kr = (plan) => {
    const varde = PLANS[plan].priceOre / ORE_PER_SEK;
    assert.equal(Number.isInteger(varde), true, `priset för ${plan} är inte ett helt antal kronor`);
    return varde;
  };
  assert.equal(
    texter[49].startsWith(
      `${PLAN_LABELS.bas} kostar ${kr('bas')} kr/mån, ${PLAN_LABELS.plus} ${kr('plus')} kr/mån och ${PLAN_LABELS.premium} ${kr('premium')} kr/mån.`
    ),
    true,
    'T50 och priserna i PLANS'
  );
});
