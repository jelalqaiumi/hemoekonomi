// Posttypen: inkomst, utgift eller sparande.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
//
// Modulen importerar bara ur src/core/: checkName, checkAmountSek och
// checkCategory är ägarna till tre av månadspostens fyra fält, och sekToOre är
// ägaren till omräkningen kronor till öre. Beroendet är riktat och cykelfritt:
// entry.js importerar aldrig item.js.
//
// Modulen äger listan över tillåtna värden för fältet kind och ingenting annat.
// ARKITEKTUR.md under "Posttypen: inkomst, utgift eller sparande" skriver ut
// ägarskapet ordagrant: "Ägaren till listan är ITEM_KINDS i src/core/item.js".
// Listan står därför inte skriven en andra gång i src/core/budget.js — den
// importeras härifrån, av samma skäl som cost.js anropar isPlainObject i
// entry.js i stället för att skriva av villkoret (LARDOMAR.md 2026-09-02).
//
// ITEM_KIND_LABELS, som samma avsnitt namnger, är inte byggd här: den har ingen
// anropare i src/ förrän gränssnittet visar etiketterna, och en export utan
// användare får inga meningsfulla tester (ARKITEKTUR.md, "Teststrategi").

import { checkAmountSek, checkCategory, checkName, isPlainObject } from './entry.js';
import { sekToOre } from './money.js';

// Den text den här modulen äger, ur tabellen "Den text som saknades" i
// ARKITEKTUR.md. De tre övriga fälten ger exakt de texter deras ägare redan ger.
// Texten nämner inte de engelska nycklarna income, expense och saving —
// användaren ser aldrig dem.
const MESSAGES = Object.freeze({
  kind: 'Välj inkomst, utgift eller sparande.'
});

// Ordningen är inte fri: den är sorteringsordningen för slag i en månads
// innehåll (ARKITEKTUR.md, kedjans steg 5) och samma ordning som tabellen över
// posttypen. Fryst av samma skäl som INTERVALS och CATEGORIES i entry.js: en
// importör som skriver om ett värde skulle annars ändra hela appens beräkning
// utan att någon fil visar det.
export const ITEM_KINDS = Object.freeze(['income', 'expense', 'saving']);

// Enda definitionen i projektet av villkoret "detta är ett känt slag".
// ITEM_KINDS.includes och inte ett uppslag i ett objekt: en lista har ingen
// prototyp att hitta 'constructor' på, så frågan behöver ingen Object.hasOwn
// (jämför PAYMENTS_PER_YEAR i cost.js, som är ett objekt och därför har det).
//
// Medvetet ingen ingångsspärr och ingen feltyp: funktionen avgör en tillhörighet
// och svarar false för varje värde som inte står i listan, också 1n och
// Symbol('x') — includes använder SameValueZero och kastar för ingen indata.
export function isItemKind(value) {
  return ITEM_KINDS.includes(value);
}

// Månadspostens fyra fält från användaren, validerade och omräknade till ören.
//
// Tre av fälten har redan en ägare i entry.js — checkName, checkAmountSek och
// checkCategory — och de anropas härifrån i stället för att skrivas av. kind är
// det enda fältet den här modulen äger, och dess text står i tabellen "Den text
// som saknades" i ARKITEKTUR.md.
//
// Fältordningen är bindande och avgör ordningen i errors: kind, name, amountSek,
// category. Alla fyra prövas, aldrig bara det första — ett formulär med fyra fel
// ska visa fyra meddelanden samtidigt, samma beteende som validateEntryDraft
// redan har.
//
// value bär amountOre och aldrig kronor: omvandlingen sker här, med sekToOre,
// eftersom item.js är kärna och får importera kärna. Kronor finns därmed bara i
// det användaren skrev och i det formatSek skriver ut.
export function validateMonthItemDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  if (!isItemKind(source.kind)) {
    errors.push({ field: 'kind', message: MESSAGES.kind });
  } else {
    value.kind = source.kind;
  }

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    // sekToOre är enda stället där ett kronbelopp blir öre. Kastar inte här:
    // checkAmountSek har redan avvisat allt som inte är ett finit tal, och dess
    // fjärde steg kräver att det avrundade värdet är minst ett öre.
    value.amountOre = sekToOre(amount.value);
  }

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}
