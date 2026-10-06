// Seed-datan för demoläget (ARKITEKTUR.md, "Del 4: demoläge" — "Seed-data").
//
// Importerna går via ../../core/ och inte via /core/: båda formerna pekar på
// samma fil i webbläsaren, eftersom demon ligger under /demo/ och
// new URL('../../core/dates.js', '…/demo/seed.js') ger /core/dates.js, men bara
// den relativa formen pekar på src/core/ också när ett testfall importerar den
// här filen från disk. app.js skriver /core/ därför att tests/helpers/dom.js
// skriver om just den formen; en demofil som testas direkt behöver ingen
// omskrivning.
import { monthOfIsoDate, shiftMonth } from '../../core/dates.js';

// Demoanvändaren. exempel.se är ett påhittat domännamn som inte kan ta emot
// post, så ingen riktig adress står i koden.
export const DEMO_EMAIL = 'anna.andersson@exempel.se';

// Tabellen i ARKITEKTUR.md, i tabellens ordning. Beloppen står i heltal ören —
// aldrig kronor som flyttal — och kategorierna är nycklar ur CATEGORIES i
// src/core/entry.js.
//
// day är dagen i månaden som startDate får. Den styr intervallets fas i steg 2
// av kedjan nedan, och därför vilka månader en kvartals- eller halvårspost
// träffar. Ingen dag är större än 28: en klampad dag (29-31) skulle flytta
// fasen för februari och göra seed-datan beroende av vilket år demon visas.
//
// monthsBack säger vilken av de tre månaderna posten startar i, räknat från den
// aktuella. De månadsvisa posterna startar i den tidigaste av de tre, så att de
// syns i alla tre (D9). Kvartalsposten startar i den aktuella månaden och
// halvårsposten i den föregående, så att var och en träffar exakt en av de tre
// (D10).
const SEED_TEMPLATES = Object.freeze([
  { id: 'demo-lon', kind: 'income', name: 'Lön', amountOre: 3200000, category: 'other', interval: 'monthly', day: 25, monthsBack: 1 },
  { id: 'demo-barnbidrag', kind: 'income', name: 'Barnbidrag', amountOre: 125000, category: 'other', interval: 'monthly', day: 20, monthsBack: 1 },
  { id: 'demo-hyra', kind: 'expense', name: 'Hyra', amountOre: 890000, category: 'housing', interval: 'monthly', day: 28, monthsBack: 1 },
  { id: 'demo-el', kind: 'expense', name: 'El', amountOre: 76000, category: 'housing', interval: 'monthly', day: 5, monthsBack: 1 },
  { id: 'demo-mat', kind: 'expense', name: 'Mat', amountOre: 620000, category: 'other', interval: 'monthly', day: 2, monthsBack: 1 },
  { id: 'demo-mobil', kind: 'expense', name: 'Mobil och bredband', amountOre: 59800, category: 'subscription', interval: 'monthly', day: 12, monthsBack: 1 },
  { id: 'demo-hemforsakring', kind: 'expense', name: 'Hemförsäkring', amountOre: 145000, category: 'insurance', interval: 'quarterly', day: 14, monthsBack: 0 },
  { id: 'demo-bilskatt', kind: 'expense', name: 'Bilskatt', amountOre: 280000, category: 'transport', interval: 'semiannual', day: 20, monthsBack: 1 },
  { id: 'demo-buffert', kind: 'saving', name: 'Buffert', amountOre: 300000, category: 'other', interval: 'monthly', day: 26, monthsBack: 1 },
  { id: 'demo-pension', kind: 'saving', name: 'Pension', amountOre: 150000, category: 'other', interval: 'monthly', day: 26, monthsBack: 1 }
]);

// Avvikelsen. ARKITEKTUR.md namnger januari ("elräkningen högre i januari"), men
// samma avsnitt säger att de tre månaderna räknas från den aktuella, och januari
// ligger utanför det fönstret elva månader av tolv. Avvikelsen ligger därför i
// den föregående månaden, som alltid är en av de tre, så att besökaren faktiskt
// kan bläddra till den. Skillnaden mot dokumentets ordalydelse är redovisad.
const WINTER_ELECTRICITY_ORE = 124000;

// Hur många månader bakåt den tidigaste av de tre månaderna ligger. Den
// aktuella månaden är mitten (ARKITEKTUR.md), alltså en månad bakåt och en
// framåt.
const SEED_MONTHS_BACK = 1;

// Demons hela tillstånd, som det ser ut innan besökaren rört något.
//
// today är dagens datum på formen ÅÅÅÅ-MM-DD och kommer in som parameter:
// klockan läses på exakt ett ställe i projektet, todayIso() i
// src/core/dates.js, och varje annan funktion tar emot dagen (CLAUDE.md).
//
// Fälten är kärnans camelCase och inte SQL:s snake_case: demon har ingen
// databas, och översättningen i src/server/months.js finns just för att ingen
// annan fil ska läsa kolumnnamnen. skipped är en boolean här, där SQLite skriver
// 0 och 1.
export function createSeedState(today) {
  const currentMonth = monthOfIsoDate(today);
  const firstMonth = shiftMonth(currentMonth, -SEED_MONTHS_BACK);

  const templates = SEED_TEMPLATES.map((seed) => {
    const startMonth = shiftMonth(currentMonth, -seed.monthsBack);
    return {
      id: seed.id,
      // Första versionen av en serie bär sitt eget id som series_id, precis som
      // addTemplate i src/server/months.js skriver det.
      seriesId: seed.id,
      kind: seed.kind,
      name: seed.name,
      amountOre: seed.amountOre,
      category: seed.category,
      interval: seed.interval,
      startDate: `${startMonth}-${String(seed.day).padStart(2, '0')}`,
      // Mallen gäller från den tidigaste av de tre månaderna, oavsett vilken
      // månad dess startDate ligger i: from_month avgör vilka månader mallen
      // läses i, startDate avgör intervallets fas. De två är skilda frågor i
      // src/server/months.js och är det här också.
      fromMonth: firstMonth,
      toMonth: null
    };
  });

  return {
    version: 1,
    email: DEMO_EMAIL,
    // Demon börjar inloggad: en besökare som öppnar adressen ska se en budget,
    // inte ett formulär. Logga ut fungerar, och knappen
    // "Logga in som demoanvändare" tar besökaren tillbaka.
    loggedIn: true,
    // Den kod attrappen senast skickade. Ingen kod finns innan besökaren bett om
    // en.
    code: null,
    templates,
    overrides: [
      {
        id: 'demo-el-vinter',
        templateId: 'demo-el',
        month: shiftMonth(currentMonth, -1),
        amountOre: WINTER_ELECTRICITY_ORE,
        skipped: false
      }
    ],
    // Inga engångsposter i seed-datan: de tio posterna i tabellen är alla
    // återkommande, så en engångspost är det första besökaren själv skapar.
    monthItems: []
  };
}

// Demons tre månader, i ordning.
//
// Ingen anropare i src/ — behålls därför att (D9) och (D10) prövar exakt de tre
// månaderna seed-datan är byggd för, och de måste läsa dem ur samma ägare som
// bygger datan. Står de i stället skrivna i testfilen prövar testet sin egen
// räkning och inte seed-filens (ARKITEKTUR.md, "Teststrategi"; LARDOMAR.md
// 2026-09-16).
export function seedMonths(today) {
  const currentMonth = monthOfIsoDate(today);
  return [
    shiftMonth(currentMonth, -SEED_MONTHS_BACK),
    currentMonth,
    shiftMonth(currentMonth, SEED_MONTHS_BACK)
  ];
}
