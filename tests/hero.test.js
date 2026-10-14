// Hero-bilden på landningssidan (ARKITEKTUR.md del 7, kravlista [hero-bild]). Ingen server:
// filen läser filer från disk. Punkterna som kräver en server står i
// tests/server.test.js.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const IMAGE_PATH = fileURLToPath(new URL('../src/web/bilder/hero.png', import.meta.url));
const TEMA_PATH = fileURLToPath(new URL('../src/web/tema.css', import.meta.url));
const LANDNING_CSS_PATH = fileURLToPath(new URL('../src/web/landning.css', import.meta.url));
const LANDNING_HTML_PATH = fileURLToPath(new URL('../src/web/landning.html', import.meta.url));

const MAX_IMAGE_BYTES = 400000;
const MIN_CONTRAST = 4.5;
const MIN_NON_TEXT_CONTRAST = 3;
const HERO_YTA_TOLERANS = 8;

// --- (H10) --------------------------------------------------------------

// Bara format, mått och byte-gräns: bilden ska kunna bytas utan att testet
// ändras (användarens beslut, ARKITEKTUR.md del 7), så inget krav gäller
// innehållet, färgerna eller en hash.
test('(H10) hero-bilden är en PNG på 1920 x 1080 och högst 400 000 byte', async () => {
  const buffer = await fs.readFile(IMAGE_PATH);
  assert.ok(
    buffer.length <= MAX_IMAGE_BYTES,
    `hero.png är ${buffer.length} byte, högst ${MAX_IMAGE_BYTES} är tillåtet`
  );
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'filen börjar inte med PNG-signaturen'
  );
  assert.equal(buffer.readUInt32BE(8), 13, 'det första stycket har inte längden 13');
  assert.equal(buffer.toString('latin1', 12, 16), 'IHDR', 'det första stycket är inte IHDR');
  assert.equal(buffer.readUInt32BE(16), 1920, `bredden är ${buffer.readUInt32BE(16)}`);
  assert.equal(buffer.readUInt32BE(20), 1080, `höjden är ${buffer.readUInt32BE(20)}`);
  assert.equal(buffer[24], 8, `bitdjupet är ${buffer[24]}`);
  assert.ok(buffer[25] === 2 || buffer[25] === 6, `färgtypen är ${buffer[25]}, inte 2 eller 6`);
  assert.equal(buffer.readUInt32BE(buffer.length - 12), 0, 'det sista stycket är inte tomt');
  assert.equal(
    buffer.toString('latin1', buffer.length - 8, buffer.length - 4),
    'IEND',
    'filen slutar inte med IEND'
  );
});

// --- (H11) --------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Tokenvärdena ur ett :root-block. Kommentarerna är redan borttagna.
function readDeclarations(block) {
  const tokens = new Map();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// Det ljusa läget är det första :root { … }; det mörka är det ljusa med
// :root { … } inuti @media (prefers-color-scheme: dark) ovanpå. Det mörka
// lägets egna deklarationer returneras dessutom för sig.
function readThemes(css) {
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
function resolveToken(tokens, name, mode) {
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

function parseHex(value, label) {
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
function over(top, base) {
  const mix = (s, b) => top.a * s + (1 - top.a) * b;
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a: 1 };
}

function shift(color, delta) {
  const clamp = (v) => Math.min(255, Math.max(0, v + delta));
  return { r: clamp(color.r), g: clamp(color.g), b: clamp(color.b), a: 1 };
}

function luminance(color) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(light, dark) {
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

const HERO_TOKENS = [
  '--hero-fokus',
  '--hero-hover',
  '--hero-knapp-text',
  '--hero-knapp-yta',
  '--hero-knapp-yta-hover',
  '--hero-text',
  '--hero-text-accent',
  '--hero-yta'
];

test('(H11) den mörka texten når 4,5:1, och fokusramen och den fyllda knappens yta 3:1, mot bildens blå, i båda lägena', async (t) => {
  const css = await fs.readFile(TEMA_PATH, 'utf8');
  const { lightTokens, darkTokens, darkOwn } = readThemes(css);

  // (a)
  const lightHero = [...lightTokens.keys()].filter((name) => name.startsWith('--hero-')).sort();
  assert.deepEqual(lightHero, HERO_TOKENS, `ljust läge: --hero-tokenerna är ${lightHero.join(', ')}`);
  const darkHero = [...darkOwn.keys()].filter((name) => name.startsWith('--hero-'));
  assert.deepEqual(darkHero, [], `mörkt läge: deklarerar egna --hero-tokener: ${darkHero.join(', ')}`);
  for (const name of HERO_TOKENS) {
    const light = resolveToken(lightTokens, name, 'ljust läge').toLowerCase();
    const dark = resolveToken(darkTokens, name, 'mörkt läge').toLowerCase();
    assert.equal(dark, light, `${name} är ${light} i ljust läge men ${dark} i mörkt läge`);
  }

  for (const [mode, tokens] of [
    ['ljust läge', lightTokens],
    ['mörkt läge', darkTokens]
  ]) {
    const color = (name) => parseHex(resolveToken(tokens, name, mode), `${mode}: ${name}`);
    const opaque = (name) => {
      const parsed = color(name);
      assert.equal(parsed.hasAlpha, false, `${mode}: ${name} ska vara ogenomskinlig`);
      return parsed;
    };
    // Kräver att fg har lägre (darker = true) eller högre luminans än ytan
    // och minst min i kvot.
    const check = (fgName, fg, surface, surfaceName, min, darker) => {
      if (darker) {
        assert.ok(
          luminance(fg) < luminance(surface),
          `${mode}: ${fgName} är inte mörkare än ytan ${surfaceName}`
        );
      } else {
        assert.ok(
          luminance(fg) > luminance(surface),
          `${mode}: ${fgName} är inte ljusare än ytan ${surfaceName}`
        );
      }
      const ratio = darker ? contrast(surface, fg) : contrast(fg, surface);
      t.diagnostic(`${mode}: ${fgName} mot ${surfaceName} ${ratio.toFixed(2)}:1`);
      assert.ok(
        ratio >= min,
        `${mode}: ${fgName} mot ytan ${surfaceName} ger ${ratio.toFixed(2)}:1, under ${min}:1`
      );
    };

    // (b)
    const y = color('--hero-yta');
    assert.equal(y.hasAlpha, false, `${mode}: --hero-yta ska ha 6 siffror`);
    const surfaces = [
      ['Y (--hero-yta)', y],
      ['Yljus (--hero-yta + 8)', shift(y, HERO_YTA_TOLERANS)],
      ['Ymork (--hero-yta - 8)', shift(y, -HERO_YTA_TOLERANS)]
    ];
    const tolerance = surfaces.slice(1);

    // (c)
    for (const name of ['--hero-text', '--hero-text-accent']) {
      const fg = opaque(name);
      for (const [surfaceName, surface] of surfaces) {
        check(name, fg, surface, surfaceName, MIN_CONTRAST, true);
      }
    }

    // (d)
    const hover = color('--hero-hover');
    assert.equal(hover.hasAlpha, true, `${mode}: --hero-hover ska ha 8 siffror`);
    const text = opaque('--hero-text');
    for (const [surfaceName, surface] of tolerance) {
      check('--hero-text', text, over(hover, surface), `--hero-hover över ${surfaceName}`, MIN_CONTRAST, true);
    }

    // (e)
    const fokus = color('--hero-fokus');
    for (const [surfaceName, surface] of tolerance) {
      const ratio = Math.max(contrast(fokus, surface), contrast(surface, fokus));
      t.diagnostic(`${mode}: --hero-fokus mot ${surfaceName} ${ratio.toFixed(2)}:1`);
      assert.ok(
        ratio >= MIN_NON_TEXT_CONTRAST,
        `${mode}: --hero-fokus mot ytan ${surfaceName} ger ${ratio.toFixed(2)}:1, under ${MIN_NON_TEXT_CONTRAST}:1`
      );
    }

    // (f)
    const knappYta = opaque('--hero-knapp-yta');
    const knappHover = opaque('--hero-knapp-yta-hover');
    const knappText = opaque('--hero-knapp-text');
    check('--hero-knapp-text', knappText, knappYta, '--hero-knapp-yta', MIN_CONTRAST, false);
    check('--hero-knapp-text', knappText, knappHover, '--hero-knapp-yta-hover', MIN_CONTRAST, false);

    // (g)
    for (const [name, fg] of [
      ['--hero-knapp-yta', knappYta],
      ['--hero-knapp-yta-hover', knappHover]
    ]) {
      for (const [surfaceName, surface] of tolerance) {
        check(name, fg, surface, surfaceName, MIN_NON_TEXT_CONTRAST, true);
      }
    }
  }
});

// --- (H12) --------------------------------------------------------------

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Varje regel { … } i css (redan utan kommentarer), i filens ordning.
// context är '' för en regel utanför varje at-regel och annars huvudena på de
// omslutande at-reglerna, ihopslagna med collapse och åtskilda av ett
// mellanslag, till exempel '@media (min-width: 960px)'. selector och body är
// ihopslagna med collapse.
// En at-sats som slutar med ';' före sin '{' (till exempel @import "x.css";)
// hoppas över. En '{' inuti en regels kropp, en '}' utan motsvarande '{', och
// en text som tar slut med en öppen regel eller at-regel kastar Error med
// texten 'ruleList: obalanserade klamrar' följd av radnumret.
function ruleList(css) {
  const list = [];
  const contexts = [];
  let buffer = '';
  let rule = null;
  let line = 1;
  const fail = () => {
    throw new Error(`ruleList: obalanserade klamrar ${line}`);
  };
  for (const char of css) {
    if (char === '\n') {
      line += 1;
    }
    if (rule !== null) {
      if (char === '{') {
        fail();
      }
      if (char === '}') {
        list.push({ context: contexts.join(' '), selector: rule, body: collapse(buffer) });
        rule = null;
        buffer = '';
      } else {
        buffer += char;
      }
      continue;
    }
    if (char === '{') {
      const prelude = collapse(buffer);
      if (prelude.startsWith('@')) {
        contexts.push(prelude);
      } else {
        rule = prelude;
      }
      buffer = '';
    } else if (char === '}') {
      if (contexts.length === 0) {
        fail();
      }
      contexts.pop();
      buffer = '';
    } else if (char === ';') {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (rule !== null || contexts.length > 0) {
    fail();
  }
  return list;
}

// Kroppen delad på ';'. Tomma delar tas bort. name är texten före det första
// ':' i delen, trimmad och med gemener. text är delen trimmad och följd av
// ';', så att den kan jämföras med en krävd deklaration som
// 'background-size: 100% auto;'.
function declarations(body) {
  return body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => ({ name: part.split(':')[0].trim().toLowerCase(), text: `${part};` }));
}

// Kräver i den här ordningen, med file i varje meddelande:
//   1. exakt en regel i list med just context och selector;
//   2. att inget name förekommer mer än en gång i regelns declarations;
//   3. att varje sträng i required är text för någon av regelns declarations.
// Returnerar regeln.
function assertSingleRule(list, context, selector, required, file) {
  const where = context || 'ingen at-regel';
  const found = list.filter((rule) => rule.context === context && rule.selector === selector);
  assert.equal(found.length, 1, `${file}: ${found.length} regler ${selector} i ${where}, inte 1`);
  const rule = found[0];
  const parts = declarations(rule.body);
  const counts = new Map();
  for (const { name } of parts) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const [name, n] of counts) {
    assert.equal(n, 1, `${file}: ${selector} i ${where} deklarerar ${name} ${n} gånger`);
  }
  const texts = parts.map((part) => part.text);
  for (const declaration of required) {
    assert.ok(texts.includes(declaration), `${file}: ${selector} i ${where} saknar ${declaration}`);
  }
  return rule;
}

const FORBIDDEN_NAMES = [
  '--hero-sloja',
  '--hover-pa-mork',
  '--hero-fran',
  '--hero-till',
  '--rutnat',
  'knapp-kontur-ljus',
  'hero-ekonomi'
];

test('(H12) landning.css har bilden utan slöja, och texten kan inte hamna på bilden', async () => {
  const landningRaw = await fs.readFile(LANDNING_CSS_PATH, 'utf8');
  const temaRaw = await fs.readFile(TEMA_PATH, 'utf8');
  const html = await fs.readFile(LANDNING_HTML_PATH, 'utf8');
  // Kommentarerna tas bort innan något deklarationskrav prövas, så att en
  // kommentar aldrig kan uppfylla ett krav.
  const landning = stripComments(landningRaw);
  const tema = stripComments(temaRaw);
  const list = ruleList(landning);
  const WIDE = '@media (min-width: 960px)';

  // (a) Exakt en .hero utan at-regel, ingen egenskap två gånger
  // (kaskadspärrens led 1).
  const top = assertSingleRule(
    list,
    '',
    '.hero',
    [
      'background-color: var(--hero-yta);',
      'background-image: url("bilder/hero.png");',
      'background-repeat: no-repeat;',
      'background-size: 100% auto;',
      'color: var(--hero-text);'
    ],
    'landning.css'
  );
  assert.equal(/gradient/i.test(top.body), false, '.hero innehåller en gradient');

  // (b) Utfyllnaden, bildens läge på smal skärm, background-origin och
  // min-height prövas av (H13)(b), eftersom vågen ändrade deras värden.
  assertSingleRule(
    list,
    WIDE,
    '.hero',
    ['background-size: 50% auto;', 'background-position: right center;'],
    'landning.css'
  );
  assertSingleRule(list, WIDE, '.hero-text', ['max-width: min(46rem, 48%);'], 'landning.css');

  // (c)
  assertSingleRule(list, '', '.hero-ingress', ['color: var(--hero-text-accent);'], 'landning.css');
  assertSingleRule(list, '', '.hero-under', ['color: var(--hero-text);'], 'landning.css');

  // (d)
  assertSingleRule(list, '', '.hero :focus-visible', ['outline-color: var(--hero-fokus);'], 'landning.css');

  // (e)
  assertSingleRule(
    list,
    '',
    '.knapp-kontur-hero',
    ['border-color: var(--hero-text);', 'color: var(--hero-text);'],
    'landning.css'
  );
  assertSingleRule(list, '', '.knapp-kontur-hero:hover', ['background: var(--hero-hover);'], 'landning.css');

  // (f)
  const used = new Set([...landning.matchAll(/var\((--hero-[a-z0-9-]+)\)/g)].map((match) => match[1]));
  const declared = new Set([...tema.matchAll(/(--hero-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  for (const name of used) {
    assert.ok(declared.has(name), `landning.css använder ${name}, som inte är deklarerad i tema.css`);
  }
  for (const name of declared) {
    assert.ok(used.has(name), `tema.css deklarerar ${name}, som landning.css inte använder`);
  }

  // (g) Den råa texten, med kommentarerna kvar.
  for (const [file, text] of [
    ['landning.css', landningRaw],
    ['tema.css', temaRaw],
    ['landning.html', html]
  ]) {
    for (const name of FORBIDDEN_NAMES) {
      assert.equal(text.includes(name), false, `${file} innehåller ${name}`);
    }
  }

  // (h)
  const sectionStart = html.indexOf('<section class="hero">');
  assert.notEqual(sectionStart, -1, 'landning.html har ingen <section class="hero">');
  const sectionEnd = html.indexOf('</section>', sectionStart);
  assert.notEqual(sectionEnd, -1, 'hero-sektionen i landning.html slutar aldrig');
  const section = html.slice(sectionStart, sectionEnd);
  assert.ok(section.includes('class="knapp knapp-hero-fylld"'), 'hero saknar class="knapp knapp-hero-fylld"');
  assert.ok(section.includes('class="knapp knapp-kontur-hero"'), 'hero saknar class="knapp knapp-kontur-hero"');
  assert.equal(section.includes('knapp-guld'), false, 'hero innehåller knapp-guld');

  // (i)
  assertSingleRule(
    list,
    '',
    '.knapp-hero-fylld',
    [
      'background: var(--hero-knapp-yta);',
      'border-color: var(--hero-knapp-yta);',
      'color: var(--hero-knapp-text);'
    ],
    'landning.css'
  );
  assertSingleRule(
    list,
    '',
    '.knapp-hero-fylld:hover',
    [
      'background: var(--hero-knapp-yta-hover);',
      'border-color: var(--hero-knapp-yta-hover);',
      'color: var(--hero-knapp-text);'
    ],
    'landning.css'
  );

  // (j) Kaskadspärrens led 3: inga vägar runt HERO_RULES i de filer som
  // laddas. Mönstren är okänsliga för skiftläge och tål blanktecken där CSS
  // och HTML tillåter dem (ARKITEKTUR.md "Stavningarna i led 3 och (H9)").
  const htmlUtanKommentarer = html.replace(/<!--[\s\S]*?-->/g, '');

  // Krav 1: stilmallarna. Varje <link> har rel icon eller stylesheet, och
  // stilmallarnas href är exakt /tema.css och /landning.css, i den ordningen.
  const stylesheets = [];
  for (const [tag] of htmlUtanKommentarer.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = new Map();
    for (const match of tag.matchAll(/([^\s=\/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
    }
    const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    assert.ok(
      rel.length === 1 && (rel[0] === 'icon' || rel[0] === 'stylesheet'),
      `landning.html, led 3 krav 1: ${tag} har inte rel icon eller stylesheet`
    );
    if (rel[0] === 'stylesheet') {
      stylesheets.push(attributes.get('href'));
    }
  }
  assert.deepEqual(
    stylesheets,
    ['/tema.css', '/landning.css'],
    `landning.html, led 3 krav 1: stilmallarna är ${JSON.stringify(stylesheets)}, inte ["/tema.css","/landning.css"]`
  );

  // Krav 2: landning.css.
  assert.equal(/!\s*important/i.test(landning), false, 'landning.css, led 3 krav 2: innehåller !important');
  assert.equal(/@import\b/i.test(landning), false, 'landning.css, led 3 krav 2: innehåller @import');

  // Krav 3: tema.css.
  assert.equal(/@import\b/i.test(tema), false, 'tema.css, led 3 krav 3: innehåller @import');
  const temaHero = ruleList(tema)
    .filter((rule) => rule.selector.includes('hero') || rule.context.includes('hero'))
    .map((rule) => `${rule.context} ${rule.selector}`.trim());
  assert.deepEqual(
    temaHero,
    [],
    `tema.css, led 3 krav 3: har regler med hero i selektorn eller kontexten: ${temaHero.join(' | ')}`
  );

  // Krav 4: inga escape-sekvenser i CSS.
  assert.equal(landning.includes('\\'), false, 'landning.css, led 3 krav 4: innehåller \\');
  assert.equal(tema.includes('\\'), false, 'tema.css, led 3 krav 4: innehåller \\');

  // Krav 5: landning.html.
  assert.equal(/<style\b/i.test(htmlUtanKommentarer), false, 'landning.html, led 3 krav 5: innehåller <style');
  assert.equal(
    /[\s"'\/]style\s*=/i.test(htmlUtanKommentarer),
    false,
    'landning.html, led 3 krav 5: innehåller ett style-attribut'
  );
});

// --- (H13) --------------------------------------------------------------

// Vågens markering ur ARKITEKTUR.md del 7, "Vågen i hero", "HTML, bindande
// ordagrant", med blanktecknen ihopslagna som av collapse.
const VAG_SVG =
  '<svg class="hero-vag" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"> ' +
  '<path class="hero-vag-yta" d="M0 42 C120 18 240 4 360 4 C600 4 840 80 1080 80 C1240 80 1360 64 1440 50 V100 H0 Z" /> ' +
  '</svg>';

// Varje regel i landning.css vars selektor eller kontext innehåller hero, i filens
// ordning, som [context, selector, body] (ARKITEKTUR.md "Kaskadspärren [hero-kaskad]",
// HERO_RULES, bindande ordagrant). Kontexten '' betyder ingen at-regel.
const HERO_RULES = [
  ['', '.knapp-kontur-hero', 'background: transparent; border-color: var(--hero-text); color: var(--hero-text);'],
  ['', '.knapp-kontur-hero:hover', 'background: var(--hero-hover); color: var(--hero-text);'],
  [
    '',
    '.knapp-hero-fylld',
    'background: var(--hero-knapp-yta); border-color: var(--hero-knapp-yta); color: var(--hero-knapp-text);'
  ],
  [
    '',
    '.knapp-hero-fylld:hover',
    'background: var(--hero-knapp-yta-hover); border-color: var(--hero-knapp-yta-hover); color: var(--hero-knapp-text);'
  ],
  [
    '',
    '.hero',
    'position: relative; --vag-hojd: max(1.5rem, 5vw); background-color: var(--hero-yta); background-image: url("bilder/hero.png"); background-repeat: no-repeat; background-size: 100% auto; background-position: center bottom var(--vag-hojd); padding-bottom: calc(56.25% + var(--vag-hojd)); color: var(--hero-text);'
  ],
  ['', '.hero :focus-visible', 'outline-color: var(--hero-fokus);'],
  [
    '',
    '.hero-inre',
    'max-width: var(--sidbredd); margin: 0 auto; padding: 3rem 1rem 3.5rem; display: flex; flex-direction: column; gap: 2rem;'
  ],
  [
    '',
    '.hero-ingress',
    'margin: 0 0 0.75rem; font-size: 0.9rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hero-text-accent);'
  ],
  ['', '.hero h1', 'font-size: 2.1rem; max-width: 16em;'],
  ['', '.hero-under', 'max-width: 34rem; font-size: 1.05rem; color: var(--hero-text);'],
  ['', '.hero-knappar', 'display: flex; flex-wrap: wrap; gap: 0.75rem;'],
  [
    '',
    '.hero-vag',
    'position: absolute; left: 0; bottom: -1px; display: block; width: 100%; height: var(--vag-hojd); pointer-events: none;'
  ],
  ['', '.hero-vag-yta', 'fill: var(--bakgrund);'],
  ['@media (min-width: 840px)', '.hero-inre', 'padding: 4.5rem 1rem 5rem;'],
  ['@media (min-width: 840px)', '.hero-text', 'max-width: 46rem;'],
  ['@media (min-width: 840px)', '.hero h1', 'font-size: 3rem;'],
  [
    '@media (min-width: 960px)',
    '.hero',
    '--vag-hojd: clamp(3rem, 4vw, 6rem); background-size: 50% auto; background-position: right center; background-origin: content-box; padding-bottom: var(--vag-hojd); min-height: calc(28.125vw + var(--vag-hojd));'
  ],
  ['@media (min-width: 960px)', '.hero-text', 'max-width: min(46rem, 48%);']
];

test('(H13) vågen i hero finns, har nästa sektions bakgrund i båda lägena och täcker varken bilden eller texten', async (t) => {
  const htmlRaw = await fs.readFile(LANDNING_HTML_PATH, 'utf8');
  const landningRaw = await fs.readFile(LANDNING_CSS_PATH, 'utf8');
  const temaRaw = await fs.readFile(TEMA_PATH, 'utf8');
  // Kommentarerna tas bort innan något krav prövas, så att en bortkommenterad
  // våg eller regel aldrig räknas.
  const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
  const landning = stripComments(landningRaw);

  // (a)
  const sectionStart = html.indexOf('<section class="hero">');
  assert.notEqual(sectionStart, -1, 'landning.html har ingen <section class="hero">');
  const sectionEnd = html.indexOf('</section>', sectionStart);
  assert.notEqual(sectionEnd, -1, 'hero-sektionen i landning.html slutar aldrig');
  const section = collapse(html.slice(sectionStart, sectionEnd));
  assert.ok(section.endsWith(VAG_SVG), `hero-sektionen slutar inte med vågen: ${section.slice(-300)}`);
  const vagCount = html.split('hero-vag').length - 1;
  assert.equal(vagCount, 2, `landning.html innehåller hero-vag ${vagCount} gånger, inte 2`);

  // (b) Exakt en regel per kontext och ingen egenskap två gånger
  // (kaskadspärrens led 1).
  const allRules = ruleList(landning);
  const narrowHero = assertSingleRule(
    allRules,
    '',
    '.hero',
    [
      'position: relative;',
      '--vag-hojd: max(1.5rem, 5vw);',
      'padding-bottom: calc(56.25% + var(--vag-hojd));',
      'background-position: center bottom var(--vag-hojd);'
    ],
    'landning.css'
  );
  const wideHero = assertSingleRule(
    allRules,
    '@media (min-width: 960px)',
    '.hero',
    [
      '--vag-hojd: clamp(3rem, 4vw, 6rem);',
      'background-origin: content-box;',
      'padding-bottom: var(--vag-hojd);',
      'min-height: calc(28.125vw + var(--vag-hojd));'
    ],
    'landning.css'
  );
  for (const rule of [narrowHero, wideHero]) {
    const overflow = declarations(rule.body).filter((d) => d.name.startsWith('overflow'));
    assert.deepEqual(
      overflow.map((d) => d.text),
      [],
      `.hero i ${rule.context || 'ingen at-regel'} har ${overflow.map((d) => d.text).join(' ')}`
    );
  }
  const vagDeclarations = (landning.match(/--vag-hojd\s*:/g) || []).length;
  assert.equal(vagDeclarations, 2, `landning.css deklarerar --vag-hojd ${vagDeclarations} gånger, inte 2`);
  assert.equal(temaRaw.includes('--vag-hojd'), false, 'tema.css innehåller --vag-hojd');

  // (c)
  const vagRules = allRules.filter((r) => r.selector === '.hero-vag');
  assert.equal(vagRules.length, 1, `landning.css har ${vagRules.length} regler .hero-vag, inte 1`);
  assert.equal(
    vagRules[0].body,
    'position: absolute; left: 0; bottom: -1px; display: block; width: 100%; height: var(--vag-hojd); pointer-events: none;',
    '.hero-vag har inte den bindande kroppen'
  );
  const ytaRules = allRules.filter((r) => r.selector === '.hero-vag-yta');
  assert.equal(ytaRules.length, 1, `landning.css har ${ytaRules.length} regler .hero-vag-yta, inte 1`);
  assert.equal(ytaRules[0].body, 'fill: var(--bakgrund);', '.hero-vag-yta har inte den bindande kroppen');
  // Kaskadspärrens led 2: hela den ordnade listan över hero-regler, jämförd
  // som en lista och utan sortering. Längden först, sedan det första index som
  // skiljer sig, sist hela listan (lärdomen 2026-09-07 om assert.deepEqual).
  const heroRules = allRules
    .filter((r) => r.selector.includes('hero') || r.context.includes('hero'))
    .map((r) => [r.context, r.selector, r.body]);
  assert.equal(
    heroRules.length,
    HERO_RULES.length,
    `landning.css har ${heroRules.length} hero-regler, HERO_RULES har ${HERO_RULES.length}`
  );
  const firstDiff = heroRules.findIndex(
    (row, index) => row.some((cell, column) => cell !== HERO_RULES[index][column])
  );
  assert.equal(
    firstDiff,
    -1,
    firstDiff === -1
      ? ''
      : `hero-regel ${firstDiff} är ${JSON.stringify(heroRules[firstDiff])}, väntad ${JSON.stringify(HERO_RULES[firstDiff])}`
  );
  assert.deepEqual(heroRules, HERO_RULES);
  const svgSelectors = [...new Set(allRules.map((r) => r.selector).filter((s) => /\b(svg|path)\b/.test(s)))];
  assert.deepEqual(svgSelectors, ['img, svg'], `selektorerna med svg eller path är ${svgSelectors.join(' | ')}`);

  // (d)
  const afterHero = html.slice(sectionEnd);
  const next = /<section class="([^"]*)"/.exec(afterHero);
  assert.ok(next, 'ingen <section class="…"> efter hero');
  const nextSelector = `.${next[1]}`;
  const backgrounds = allRules
    .filter((r) => r.selector === nextSelector)
    .flatMap((r) => [...` ${r.body}`.matchAll(/[\s;](background(?:-color)?)\s*:\s*([^;]+);/g)])
    .map((match) => match[2].trim());
  assert.equal(
    backgrounds.length,
    1,
    `${nextSelector} har ${backgrounds.length} deklarationer av background eller background-color, inte 1`
  );
  const nextToken = /^var\((--[a-z0-9-]+)\)$/.exec(backgrounds[0]);
  assert.ok(nextToken, `${nextSelector} har bakgrunden ${backgrounds[0]}, inte var(--x)`);
  const fillToken = /^fill: var\((--[a-z0-9-]+)\);$/.exec(ytaRules[0].body);
  assert.ok(fillToken, `.hero-vag-yta har fyllningen ${ytaRules[0].body}, inte var(--x)`);
  assert.equal(
    fillToken[1],
    nextToken[1],
    `vågen fylls med ${fillToken[1]} men ${nextSelector} har bakgrunden ${nextToken[1]}`
  );
  const { lightTokens, darkTokens } = readThemes(temaRaw);
  for (const [mode, tokens] of [
    ['ljust läge', lightTokens],
    ['mörkt läge', darkTokens]
  ]) {
    const vag = parseHex(resolveToken(tokens, nextToken[1], mode), `${mode}: ${nextToken[1]}`);
    assert.equal(vag.hasAlpha, false, `${mode}: ${nextToken[1]} ska ha 6 siffror`);
    const yta = parseHex(resolveToken(tokens, '--hero-yta', mode), `${mode}: --hero-yta`);
    assert.notEqual(vag.hex, yta.hex, `${mode}: ${nextToken[1]} är samma färg som --hero-yta, ${yta.hex}`);
    const ratio = Math.max(contrast(vag, yta), contrast(yta, vag));
    t.diagnostic(`${mode}: vågen (${nextToken[1]}, ${vag.hex}) mot --hero-yta (${yta.hex}) ${ratio.toFixed(2)}:1`);
  }
});
