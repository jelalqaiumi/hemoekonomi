// Demobannern (ARKITEKTUR.md, "Del 4: demoläge" — "Bannern" och "Inloggning i
// demoläge").
//
// Filen laddas bara när DEMO är sann: demo-fetch.js importerar den dynamiskt
// inne i sin DEMO-gren. Det är därför ingen rad här prövar flaggan en andra
// gång.
//
// All text mot användaren står i den här filen och ingen annanstans, precis som
// app.js samlar sina egna strängar. Texterna står ordagrant i ARKITEKTUR.md och
// får inte skrivas om.
//
// document tas emot som parameter och läses aldrig ur globalThis inne i
// funktionerna: ett testfall kan då skicka in en DOM-attrapp, vilket är hela
// skälet till att filen går att köra utan webbläsare.

// Bannerns stilmall. Adressen är den server.js serverar under /demo/.
const DEMO_STYLESHEET = '/demo/banner.css';

const BANNER_TEXT = 'Demoversion - ingen riktig data eller betalning.';
const GITHUB_LABEL = 'Se koden på GitHub';
const RESET_LABEL = 'Återställ demo';
const DEMO_LOGIN_LABEL = 'Logga in som demoanvändare';
// Bannern går att fälla ihop till en smal remsa men aldrig dölja helt, så
// knappen har två lydelser och inget stängkryss.
const COLLAPSE_LABEL = 'Fäll ihop';
const EXPAND_LABEL = 'Visa mer';
// Det demon inte visar: de planfunktioner som står på prissidan men inte är
// byggda, och betalningen. Texten står ordagrant i ARKITEKTUR.md under "Det demon
// inte visar", och (D17) i tests/demo.test.js prövar den mot FEATURE_LABELS och
// mot de requireFeature-anrop src/server/api.js gör. README:s avsnitt "Inte
// byggt" är längre och ägs av README.
const NOT_BUILT_TEXT =
  'Delat hushåll, Mina funktioner och Prioriterad support står på prissidan men är inte byggda. Betalning finns inte heller - planbytet är gratis och sker direkt.';
// Visas bara när webbläsaren inte ger demon någon lagring.
const NO_STORAGE_TEXT = 'Webbläsaren ger demon ingen lagring, så ändringar försvinner när sidan laddas om.';

// Koden attrappen "skickade". Texten säger var den kommer ifrån: inget mejl
// lämnar sidan.
function codeText(code, email) {
  return `Demoläge: koden till ${email} är ${code}. Inget mejl skickas.`;
}

// GitHub-länken är en platshållare tills repot finns. Ett a-element utan href är
// en platshållarlänk enligt HTML-standarden, precis som Kontakt, Villkor och
// Integritetspolicy i sidfoten på landningssidan.
function skapaGithubLank(document) {
  const lank = document.createElement('a');
  lank.className = 'demo-banner-lank';
  lank.textContent = GITHUB_LABEL;
  return lank;
}

// Bannerns egen stilmall. Den laddas härifrån och inte ur index.html eller
// landning.html: med DEMO falsk ska varken filen eller någon regel ur den finnas
// på sidan, och de två sidorna delar ingen CSS-fil som regeln hade kunnat stå i
// bara en gång.
//
// Adressen är absolut från roten, så att samma rad fungerar från båda sidorna.
// Saknar attrappen head eller link är stilmallen inget den mäter, och raden
// hoppas över.
function laggInStilmall(document) {
  const head = document.head;
  if (head === undefined || head === null || typeof head.append !== 'function') {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = DEMO_STYLESHEET;
  head.append(link);
}

function skapaKnapp(document, className, label, onClick) {
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = className;
  knapp.textContent = label;
  knapp.addEventListener('click', () => {
    onClick(knapp);
  });
  return knapp;
}

// Ritar bannern högst upp på sidan och returnerar de två vägar demo-fetch.js
// behöver: showCode, som visar inloggningskoden, och element, som testfallen
// läser.
//
// Knappen "Logga in som demoanvändare" läggs i inloggningsvyns första steg när
// det finns — det gör det på index.html men inte på landningssidan. Knappen
// skapas här och inte i index.html, så att markeringen i den riktiga appen är
// orörd: ett nytt id i index.html hade dessutom krävt ett nytt FakeElement i
// DOM-attrappen för en knapp som bara finns i demoläge.
export function mountBanner({
  document,
  storageMissing = false,
  onReset = () => undefined,
  onDemoLogin = () => undefined
}) {
  laggInStilmall(document);

  const banner = document.createElement('div');
  banner.className = 'demo-banner';

  const rad = document.createElement('div');
  rad.className = 'demo-banner-rad';

  const text = document.createElement('span');
  text.className = 'demo-banner-text';
  text.textContent = BANNER_TEXT;

  const kod = document.createElement('p');
  kod.className = 'demo-banner-kod';
  kod.textContent = '';
  kod.hidden = true;

  const hjalp = document.createElement('p');
  hjalp.className = 'demo-banner-hjalp';
  hjalp.textContent = storageMissing ? `${NOT_BUILT_TEXT} ${NO_STORAGE_TEXT}` : NOT_BUILT_TEXT;

  const fall = skapaKnapp(document, 'demo-banner-knapp', COLLAPSE_LABEL, (knapp) => {
    const ihopfalld = banner.className !== 'demo-banner demo-banner-ihopfalld';
    banner.className = ihopfalld ? 'demo-banner demo-banner-ihopfalld' : 'demo-banner';
    knapp.textContent = ihopfalld ? EXPAND_LABEL : COLLAPSE_LABEL;
    // Hjälptexten och koden följer med in i remsan; själva raden med
    // BANNER_TEXT står kvar, så bannern är aldrig helt dold.
    hjalp.hidden = ihopfalld;
    kod.hidden = ihopfalld || kod.textContent === '';
  });

  rad.append(
    text,
    skapaGithubLank(document),
    skapaKnapp(document, 'demo-banner-knapp', RESET_LABEL, () => {
      onReset();
    }),
    fall
  );
  banner.append(rad, kod, hjalp);

  const body = document.body;
  // prepend när den finns: bannern ska ligga högst upp. En DOM-attrapp utan
  // prepend får append i stället — placeringen är inget attrappen mäter.
  if (typeof body.prepend === 'function') {
    body.prepend(banner);
  } else {
    body.append(banner);
  }

  const loginSteg = document.querySelector('#login-step-email');
  if (loginSteg !== null) {
    loginSteg.append(
      skapaKnapp(document, 'secondary demo-login', DEMO_LOGIN_LABEL, () => {
        onDemoLogin();
      })
    );
  }

  return {
    element: banner,
    showCode: (code, email) => {
      kod.textContent = codeText(code, email);
      kod.hidden = false;
    }
  };
}
