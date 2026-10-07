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

import { formatSek } from '../src/core/money.js';
import { FEATURE_LABELS, PLANS, PLAN_LABELS } from '../src/core/plans.js';
import { createLandningDom } from './helpers/landning-dom.js';

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

test('kortens punkter är FEATURE_LABELS, och arvet står som en rad', async (t) => {
  const { document, list } = createLandningDom();
  await loadPriser(t, { document });

  const planer = Object.keys(PLANS);
  for (const [index, plan] of planer.entries()) {
    const egna = [...PLANS[plan].features].map((feature) => FEATURE_LABELS[feature]);
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
