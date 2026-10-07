// Demons lagring (ARKITEKTUR.md, "Del 4: demoläge" — "Lagring").
//
// Varje ändring besökaren gör sparas under en egen nyckel i localStorage, så att
// demon känns levande mellan sidladdningar.
//
// localStorage kan saknas eller kasta — i privat läge, med lagring blockerad av
// webbläsaren, eller i en körning utan webbläsare alls. Varje läsning och
// skrivning omsluts därför, och demon ska fungera utan lagring: ändringarna
// försvinner då vid omladdning, vilket är bättre än ett fel. (D8) prövar det.
//
// Lagringen tas emot som parameter i stället för att läsas ur globalThis inne i
// funktionerna: ett testfall kan då skicka in en attrapp som kastar, och det är
// hela skälet till att spärrarna går att pröva.

// isPlanKey är ägaren till frågan "detta är en känd plan". Filen importerar
// kärnan bara för den frågan: ett sparat tillstånd bär ett värde som måste
// finnas i PLANS, och en handskriven lista över plannycklar här hade varit en
// andra ägare (LARDOMAR.md 2026-09-02). Importen går via ../../core/ av samma
// skäl som i demo-fetch.js: båda formerna pekar på samma fil i webbläsaren, men
// bara den relativa fungerar också när ett testfall läser filen från disk.
import { isPlanKey } from '../../core/plans.js';

// Nyckeln är demons egen och delas inte med något annat. Namnet bär ordet demo,
// så att den aldrig kan förväxlas med riktig data om appen en dag får något
// eget i localStorage.
//
// Exporterad utöver att de tre funktionerna nedan läser den: (D7) skriver skräp
// under just den nyckeln för att pröva att ett sparat tillstånd med fel form
// kasseras, och en nyckel skriven en andra gång i testfilen hade kunnat glida
// isär från den här.
export const STORAGE_KEY = 'hemochekonomi.demo.v1';

// globalThis.localStorage, eller null när den inte finns eller inte går att
// läsa. Åtkomsten står inne i try: i vissa webbläsare kastar själva uppslaget
// globalThis.localStorage när lagring är blockerad, inte bara anropen på den.
export function getStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage === undefined || storage === null ? null : storage;
  } catch {
    return null;
  }
}

// Det sparade tillståndet, eller null när ingenting finns sparat, när lagringen
// saknas, när läsningen kastar eller när innehållet inte går att tolka. Varje
// sådant fall betyder samma sak för anroparen: börja om från seed-datan.
//
// isPlainObject-villkoret har en ägare i src/core/entry.js, men den här filen
// ska inte importera kärnan för att svara på frågan "kom det här ur min egen
// JSON.stringify": kontrollen nedan prövar att värdet bär de fält demon läser,
// vilket är en annan och strängare fråga än "är detta ett objekt".
export function readState(storage) {
  if (storage === null) {
    return null;
  }
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (typeof text !== 'string') {
    return null;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isDemoState(value) ? value : null;
}

// Sant när värdet har den form demo-fetch.js läser. Ett sparat tillstånd från en
// äldre version av demon, eller något någon annan skrivit under nyckeln, ska
// kasseras och inte halvt användas.
function isDemoState(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value.version === 1 &&
    typeof value.email === 'string' &&
    typeof value.loggedIn === 'boolean' &&
    // Planen prövas mot ägarens lista och inte bara som en sträng: ett sparat
    // 'guld' hade annars nått hasFeature, som kastar RangeError för en okänd
    // plan. Ett tillstånd som saknar plan - alltså ett som sparades före
    // steg 1 i del 5 - kasseras av samma rad, och demon läser om seed-datan.
    isPlanKey(value.plan) &&
    Array.isArray(value.templates) &&
    Array.isArray(value.overrides) &&
    Array.isArray(value.monthItems) &&
    // Taken [steg 2]. Ett tillstånd som saknar budgets - alltså ett som sparades
    // före steg 2 - kasseras av raden, och demon läser om seed-datan. Utan den
    // skulle readDemoMonth läsa state.budgets på ett tillstånd som inte har
    // fältet, och kortet Budget vore ett kast i stället för en lista.
    Array.isArray(value.budgets)
  );
}

// Sparar tillståndet. Svaret är true när det gick och false annars — en
// skrivning som inte går igenom är inget fel för demon, bara en ändring som
// försvinner vid nästa omladdning.
export function writeState(storage, state) {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Tömmer nyckeln. Används av Återställ demo, som därefter laddar om seed-datan.
export function clearState(storage) {
  if (storage === null) {
    return false;
  }
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
