// Prissidans tre kort [steg 1 i del 5]. Korten ritas ur PLANS i
// src/core/plans.js och inte ur inskriven text i landning.html: priset och
// innehållet har en enda källa, som servern och appen läser samma rad ur, och
// ett kort kan därför inte säga något annat än behörigheten gör
// (ARKITEKTUR.md, "Prissidan renderas ur PLANS").
//
// Filen läser ingen klocka, hämtar ingenting och har inga händelselyssnare:
// knapparna är länkar till /app, eftersom registrering med planval byggs senare
// och ingen knapp får antyda att en betalning sker.
import { formatSek } from '/core/money.js';
import { FEATURE_LABELS, PLANS, PLAN_LABELS } from '/core/plans.js';

// Texten som ersätter den lägre planens punkter på Plus och Premium. Står som
// en funktion av den lägre planens namn och inte som tre skrivna strängar:
// "Allt i Bas" och "Allt i Plus" är samma mening med olika plan.
function allInLabel(lowerPlan) {
  return `Allt i ${PLAN_LABELS[lowerPlan]}`;
}

// Knappens text. Samma form som på de tre korten innan de renderades: Välj Bas,
// Välj Plus, Välj Premium.
function chooseLabel(plan) {
  return `Välj ${PLAN_LABELS[plan]}`;
}

// Hur priset skrivs. Beloppet går genom formatSek, som varje annat belopp i
// projektet; /mån står utanför talet, i en egen textnod, så att hela raden blir
// till exempel "99,00 kr/mån".
const PER_MONTH_SUFFIX = '/mån';

// Badgen på det upphöjda kortet, ur tabellen över landningssidans sektioner i
// ARKITEKTUR.md: "Mittenkortet upphöjt med guldbadge Populärast".
const HIGHLIGHT_BADGE = 'Populärast';

// Klasserna i landning.css. Står som namn och inte som literaler i
// renderPlanCards, så att samma sträng läses av koden och av testfallet.
const CARD_CLASS = 'pris-kort';
const CARD_HIGHLIGHT_CLASS = 'pris-kort pris-kort-upphojd';
const BUTTON_CLASS = 'knapp knapp-kontur';
const BUTTON_HIGHLIGHT_CLASS = 'knapp knapp-guld';

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className !== null) {
    node.className = className;
  }
  if (text !== null) {
    node.textContent = text;
  }
  return node;
}

// Ett kort. index avgör bara utseendet: mittenkortet är upphöjt och bär badgen,
// enligt landningssidans tabell. Ingen plannyckel står skriven här — vilket
// kort som är i mitten räknas ur listans längd, så ett tillägg i PLANS flyttar
// upphöjningen av sig själv.
function planCard(plan, index, plans) {
  const highlighted = index === Math.floor(plans.length / 2);
  const card = element('li', highlighted ? CARD_HIGHLIGHT_CLASS : CARD_CLASS, null);

  if (highlighted) {
    card.append(element('p', 'pris-badge', HIGHLIGHT_BADGE));
  }
  card.append(element('h3', null, PLAN_LABELS[plan]));

  // Priset: talet i .pris-tal, suffixet i ett eget span efter det. Samma
  // klasser som stod i landning.html, så landning.css gäller oförändrad —
  // suffixets span har ingen klass och ärver därmed .pris-belopp, precis som
  // textnoden gjorde.
  const price = element('p', 'pris-belopp', null);
  price.append(element('span', 'pris-tal', formatSek(PLANS[plan].priceOre)));
  price.append(element('span', null, PER_MONTH_SUFFIX));
  card.append(price);

  // Punkterna: "Allt i <den lägre planen>" för varje plan utom den lägsta, och
  // därefter planens egna funktioner. Arvet skrivs alltså som en rad och inte
  // genom att de lägre planernas punkter räknas upp igen.
  const bullets = element('ul', 'pris-punkter', null);
  if (index > 0) {
    bullets.append(element('li', null, allInLabel(plans[index - 1])));
  }
  for (const feature of PLANS[plan].features) {
    bullets.append(element('li', null, FEATURE_LABELS[feature]));
  }
  card.append(bullets);

  const button = element('a', highlighted ? BUTTON_HIGHLIGHT_CLASS : BUTTON_CLASS, chooseLabel(plan));
  button.href = '/app';
  card.append(button);
  return card;
}

// Ritar om hela listan. replaceChildren och inte append: funktionen ska kunna
// köras om utan att korten dubbleras.
export function renderPlanCards(list) {
  const plans = Object.keys(PLANS);
  list.replaceChildren(...plans.map((plan, index) => planCard(plan, index, plans)));
}

// Listan finns bara på landningssidan. querySelector svarar null på varje annan
// sida, och då gör filen ingenting — samma mönster som demo-fetch.js med
// flaggan falsk.
const LIST = document.querySelector('#pris-lista');
if (LIST !== null) {
  renderPlanCards(LIST);
}
