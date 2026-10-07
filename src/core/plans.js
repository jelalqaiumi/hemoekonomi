// Planerna: vad en plan kostar och vad den innehåller.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren. Modulen importerar ingenting alls, inte heller ur src/core/:
// priset skrivs ut med formatSek av den som visar det, aldrig här.
//
// Det här är den enda platsen i projektet som vet vad en plan kostar och vad
// den innehåller (ARKITEKTUR.md, "En källa för planerna (bindande)")
// Prissidan, appen och servern läser alla härifrån, och ingen av dem skriver av
// en pris- eller funktionslista.
//
// Priserna lagras i ören, som varje annat belopp i projektet.

// De tre planerna i ordning, lägst först. Ordningen är inte fri: den är den
// ordning en plan ärver i — plus ärver bas funktioner, premium ärver bådas — och
// hasFeature läser just den ordningen. Object.keys bevarar
// insättningsordningen för strängnycklar, så Object.keys(PLANS) ger
// ['bas', 'plus', 'premium'] och är därmed också den ordning prissidan ritar
// korten i.
//
// features är funktionerna *utöver den lägre planens*. Ingen nyckel står
// därför två gånger: hasFeature löser upp arvet.
//
// Fryst i tre lager — tabellen, varje plan och varje funktionslista — av samma
// skäl som INTERVALS och CATEGORIES i entry.js: en importör som skriver om ett
// värde skulle annars ändra hela appens behörighet utan att någon fil visar det.
export const PLANS = Object.freeze({
  bas: Object.freeze({
    priceOre: 9900,
    features: Object.freeze(['budget', 'billReminders', 'overview'])
  }),
  plus: Object.freeze({
    priceOre: 14900,
    features: Object.freeze(['savingsGoals', 'sharedHousehold', 'reports'])
  }),
  premium: Object.freeze({
    priceOre: 17900,
    features: Object.freeze(['customFeatures', 'prioritySupport'])
  })
});

// Varje funktionsnyckel i projektet, i planordning. Listan är frusen och
// uttömmande: en nyckel som inte står här finns inte, och hasFeature kastar för
// den i stället för att svara false (se spärren nedan).
//
// Listan skrivs för hand och härleds inte ur PLANS, fastän (P5) i
// tests/plans.test.js kräver att de två innehåller exakt samma nycklar. Skälet
// är just det testet: härledd ur PLANS kunde listan aldrig säga emot PLANS, och
// då fanns ingen plats där en felstavad nyckel i en plan kunde upptäckas.
export const FEATURES = Object.freeze([
  'budget',
  'billReminders',
  'overview',
  'savingsGoals',
  'sharedHousehold',
  'reports',
  'customFeatures',
  'prioritySupport'
]);

// De svenska namnen. Enda stället de står skrivna: 403-svarets text i
// src/server/api.js, prissidans kort och vyn Min plan läser alla härifrån.
export const PLAN_LABELS = Object.freeze({
  bas: 'Bas',
  plus: 'Plus',
  premium: 'Premium'
});

// Funktionernas svenska namn. Texterna är de som står i tabellen "Priskorten" i
// ARKITEKTUR.md och som stod inskrivna i src/web/landning.html fram till det här
// steget; de flyttades hit när prissidan började renderas ur PLANS, så att
// kortet och behörigheten inte kan säga olika saker.
//
// Nycklarna är FEATURES nycklar, och ett testfall kräver att de två listorna är
// desamma: en funktion utan namn hade visats som sin engelska nyckel, och
// användaren ser aldrig dem.
export const FEATURE_LABELS = Object.freeze({
  budget: 'Budget och utgiftsregistrering',
  billReminders: 'Räkningspåminnelser',
  overview: 'Grundläggande översikt',
  savingsGoals: 'Sparmål',
  sharedHousehold: 'Delat hushåll',
  reports: 'Diagram och rapporter',
  customFeatures: 'Mina funktioner',
  prioritySupport: 'Prioriterad support'
});

// De två meddelandena modulen äger. Båda är programmeringsfel och når aldrig
// användaren: planen kommer ur databasens plan-kolumn, som har ett CHECK, och
// funktionsnyckeln står i koden. Texterna är därför skrivna för den som läser
// ett stackspår, på samma form som RangeError-texterna i cost.js och dates.js.
const MESSAGES = Object.freeze({
  unknownFeature: (value) => `hasFeature kräver en känd funktion, fick "${String(value)}".`,
  unknownPlan: (value) => `hasFeature kräver en känd plan, fick "${String(value)}".`
});

// Enda definitionen i projektet av villkoret "detta är en känd plan".
// Object.hasOwn och inte ett sanningsprövat uppslag: PLANS är ett objekt, så
// ett uppslag hade hittat något på prototypen för 'constructor' och 'toString'
// (samma skäl som PAYMENTS_PER_YEAR i cost.js har sin Object.hasOwn).
//
// Funktionen finns för att villkoret har två anropare — hasFeature nedan och
// PUT /api/plan i src/server/api.js, som avvisar en okänd plan med 400 — och en
// andra handskriven kopia är just det ägarregeln förbjuder
// (LARDOMAR.md 2026-09-02).
//
// Medvetet ingen ingångsspärr och ingen feltyp: funktionen avgör en
// tillhörighet och svarar false för varje värde som inte är en plannyckel,
// också 1n och Symbol('x') — typeof och Object.hasOwn kastar för ingen indata.
//
// typeof value === 'string' står först och är inte överflödigt: en nyckel i ett
// uppslag tvingas till en sträng, så Object.hasOwn(PLANS, ['bas']) är true och
// Object.hasOwn(PLANS, { toString: () => 'bas' }) likaså. Utan raden tog
// PUT /api/plan emot kroppen { "plan": ["bas"] } och svarade 500 från
// databasens CHECK i stället för 400 med den svenska texten — uppmätt innan
// raden lades till, av (P12) i tests/plan-api.test.js.
export function isPlanKey(value) {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

// Har planen funktionen? Arvet löses upp här: en plan har sina egna funktioner
// och varje lägre plans.
//
// De två spärrarna finns av samma skäl som yearlyOre fick sin
// (LARDOMAR.md 2026-09-02): ett uppslag med en ovaliderad nyckel ger annars
// undefined, och en funktion som råkat stavas fel ser då ut att vara låst för
// alla — respektive en plan som råkat stavas fel ser ut att sakna allt.
// FEATURES.includes och isPlanKey kastar för ingen indata, inte heller för
// 1n och Symbol('x'), så varje felaktigt värde når sitt RangeError.
export function hasFeature(plan, feature) {
  if (!FEATURES.includes(feature)) {
    throw new RangeError(MESSAGES.unknownFeature(feature));
  }
  if (!isPlanKey(plan)) {
    throw new RangeError(MESSAGES.unknownPlan(plan));
  }
  const keys = Object.keys(PLANS);
  // Planen själv och varje lägre plan. En högre plans funktioner ärvs inte
  // nedåt, så listan slutar vid planen.
  return keys
    .slice(0, keys.indexOf(plan) + 1)
    .some((key) => PLANS[key].features.includes(feature));
}

// Den lägsta plan som har funktionen. Används av 403-svaret, som ska kunna säga
// vilken plan användaren behöver utan att gränssnittet gissar ur texten.
//
// Ingen egen spärr: en okänd funktionsnyckel avvisas av hasFeature redan i
// loopens första varv, med modulens enda text för den frågan. En andra text
// hade varit en andra ägare till samma villkor.
// Svaret är alltid en plannyckel: feature står i FEATURES, och (P5) i
// tests/plans.test.js kräver att FEATURES och planernas listor innehåller exakt
// samma nycklar — alltså har någon plan funktionen. Därför finns här ingen gren
// för "ingen plan har den": en gren som ingen indata når är inget skydd.
export function planFor(feature) {
  return Object.keys(PLANS).find((key) => hasFeature(key, feature));
}
