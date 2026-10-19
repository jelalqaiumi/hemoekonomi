// Temats färgräkning, gemensam för tests/hero.test.js (H11) och
// tests/tema.test.js (FA1) (ARKITEKTUR.md del 9, "Gemensam hjälpmodul"): ett
// begrepp, en ägare. Filnamnet slutar inte på .test.js, så npm test kör den
// inte som en testfil.

import assert from 'node:assert/strict';

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Tokenvärdena ur ett :root-block. Kommentarerna är redan borttagna.
export function readDeclarations(block) {
  const tokens = new Map();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// Det ljusa läget är det första :root { … }; det mörka är det ljusa med
// :root { … } inuti @media (prefers-color-scheme: dark) ovanpå. Det mörka
// lägets egna deklarationer returneras dessutom för sig.
export function readThemes(css) {
  const text = stripComments(css);
  const light = /:root\s*\{([^}]*)\}/.exec(text);
  assert.ok(light, 'tema.css har inget :root { … }');
  const media = text.indexOf('@media (prefers-color-scheme: dark)');
  assert.notEqual(media, -1, 'tema.css har inget @media (prefers-color-scheme: dark)');
  const dark = /:root\s*\{([^}]*)\}/.exec(text.slice(media));
  assert.ok(dark, 'det mörka läget har inget :root { … }');
  const lightTokens = readDeclarations(light[1]);
  const darkOwn = readDeclarations(dark[1]);
  const darkTokens = new Map([...lightTokens, ...darkOwn]);
  return { lightTokens, darkTokens, darkOwn };
}

// var(--x) löses upp tills värdet är en hexkod.
export function resolveToken(tokens, name, mode) {
  let value = tokens.get(name);
  const seen = new Set([name]);
  for (;;) {
    assert.notEqual(value, undefined, `${mode}: ${name} saknas i tema.css`);
    const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (reference === null) {
      return value;
    }
    assert.ok(!seen.has(reference[1]), `${mode}: ${name} refererar till sig själv`);
    seen.add(reference[1]);
    value = tokens.get(reference[1]);
  }
}

export function parseHex(value, label) {
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(value);
  assert.ok(match, `${label} är ${value}, inte en hexkod med 6 eller 8 siffror`);
  const digits = match[1];
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: match[2] === undefined ? 1 : parseInt(match[2], 16) / 255,
    hex: value.toLowerCase(),
    hasAlpha: match[2] !== undefined
  };
}

// c = a * s + (1 - a) * b, kanal för kanal.
export function over(top, base) {
  const mix = (s, b) => top.a * s + (1 - top.a) * b;
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a: 1 };
}

export function shift(color, delta) {
  const clamp = (v) => Math.min(255, Math.max(0, v + delta));
  return { r: clamp(color.r), g: clamp(color.g), b: clamp(color.b), a: 1 };
}

export function luminance(color) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrast(light, dark) {
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

// HSL-nyans i grader [0, 360) och mättnad i [0, 1] ur en hexkod med 3, 4, 6
// eller 8 siffror. Alfa räknas inte. Ingen avrundning.
export function hueSaturation(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join('');
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) {
      hue = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / d + 2);
    } else {
      hue = 60 * ((r - g) / d + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }
  return { hue, s };
}

// ARKITEKTUR.md del 9, "Regeln för grönt".
export function isGreen(hex) {
  const { hue, s } = hueSaturation(hex);
  return hue >= 70 && hue <= 175 && s >= 0.1;
}

// Tar bort CSS-kommentarer men låter strängar stå, så att en kommentarmarkör i
// en sträng (content: "/*") inte äter text som webbläsaren läser.
export function stripCssComments(css) {
  return css.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '');
}

// Attributen i en tagg, med namnen i gemener. Kaskadspärrens led 3:s mönster
// (ARKITEKTUR.md "Kaskadspärren [hero-kaskad]"): dubbla, enkla och inga
// citattecken.
export function attributeMap(tag) {
  const attributes = new Map();
  for (const match of tag.matchAll(/([^\s=\/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
  }
  return attributes;
}
