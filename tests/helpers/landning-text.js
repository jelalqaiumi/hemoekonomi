// Den text en besökare kan läsa på landning.html, i dokumentordning.
// Algoritmen är bindande och står i ARKITEKTUR.md under "Landningssidans synliga
// text — bindande ordagrant". (P18) och (P20) i tests/priser.test.js läser
// sidans text härifrån, så att de inte har var sin kopia av regeln.
//
// Funktionen asserterar ingenting. Kravet att ingen del innehåller & står i
// (P20): det fångar en ny teckenreferens som algoritmen inte avkodar.

const TANKSTRECK = String.fromCodePoint(0x2013);
const COPYRIGHT = String.fromCodePoint(0xa9);

export function visibleTexts(html) {
  // 1. Kommentarer, skript och SVG bort, i den ordningen.
  const utan = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '');
  // 2. Varje tagg blir en avgränsare.
  return utan
    .replace(/<[^>]+>/g, '<>')
    .split('<>')
    // 3. De två teckenreferenser sidan använder avkodas, och blanktecken slås
    // ihop.
    .map((del) =>
      del
        .replaceAll('&ndash;', TANKSTRECK)
        .replaceAll('&#169;', COPYRIGHT)
        .replace(/\s+/g, ' ')
        .trim()
    )
    // 4. Tomma delar bort.
    .filter((del) => del !== '');
}
