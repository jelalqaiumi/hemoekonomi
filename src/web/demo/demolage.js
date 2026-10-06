// Demoflaggan. Den enda raden som skiljer demon från den riktiga appen
// (ARKITEKTUR.md, "Del 4: demoläge" — "Flaggan").
//
// Ingen miljövariabel: projektet har ingen byggkedja som kan läsa en, och en
// flagga som bara finns i en byggkedja går inte att läsa ur filen.
//
// Raden byts till true vid publicering. Är den falsk laddas ingen annan fil
// under demo/ — demo-fetch.js importerar seed.js, lagring.js och banner.js
// dynamiskt och bara inne i sin DEMO-gren.
export const DEMO = false;
