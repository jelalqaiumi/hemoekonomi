import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDom, createFetch, flush, loadApp } from './helpers/dom.js';

const IDAG = '2026-10-17';
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const MIG_401 = Object.freeze({ status: 401, json: { error: 'Du är inte inloggad.' } });
const MIG_200 = Object.freeze({ status: 200, json: { email: 'nils@example.se' } });
const TOM_MANAD = Object.freeze({
  status: 200,
  json: { items: [], totals: { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 }, budgets: [] }
});

function inloggadeHamtningar(anropet) {
  if (anropet.url === '/api/mig') {
    return MIG_200;
  }
  if (anropet.url.startsWith('/api/manad/')) {
    return TOM_MANAD;
  }
  if (anropet.url.startsWith('/api/rakningar/')) {
    return { status: 200, json: { bills: [] } };
  }
  if (anropet.url.startsWith('/api/sparmal/')) {
    return { status: 200, json: { goals: [] } };
  }
  if (anropet.url.startsWith('/api/rapport/')) {
    return { status: 200, json: { months: [], rows: [], largest: null } };
  }
  return null;
}

async function starta(t, plan, { search = '' } = {}) {
  const dom = createDom();
  const { fetch, anrop } = createFetch(plan);
  const { historik } = await loadApp(t, { document: dom.document, fetch, idag: IDAG, search });
  await flush();
  return { dom, anrop, historik };
}

function kropp(anropet) {
  return JSON.parse(anropet.body);
}

function skicka(dom) {
  dom.falt('login-form').utlos('submit', { preventDefault() {} });
}

test('ett 401 vid laddningen visar läget Logga in med två fält och länken Glömt lösenordet?', async (t) => {
  const { dom, anrop } = await starta(t, () => MIG_401);
  assert.deepEqual(anrop.map((a) => a.url), ['/api/mig']);
  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('login-submit').textContent, 'Logga in');
  assert.equal(dom.falt('login-tabs').hidden, false);
  assert.equal(dom.falt('tab-login').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.falt('tab-register').getAttribute('aria-pressed'), 'false');
  assert.equal(dom.falt('login-email-field').hidden, false);
  assert.equal(dom.falt('login-password-field').hidden, false);
  assert.equal(dom.falt('login-password').getAttribute('autocomplete'), 'current-password');
  assert.equal(dom.falt('password-hint').hidden, true);
  assert.equal(dom.falt('forgot-link').hidden, false);
  assert.equal(dom.falt('back-to-login').hidden, true);
  assert.equal(dom.falt('login-error').textContent, '');
});

test('Logga in skickar e-post och lösenord och laddar månadsvyn vid 204', async (t) => {
  let inloggad = false;
  const { dom, anrop } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig' && !inloggad) {
      return MIG_401;
    }
    if (anropet.url === '/api/auth/logga-in') {
      inloggad = true;
      return { status: 204 };
    }
    return inloggadeHamtningar(anropet);
  });
  dom.falt('login-email').value = 'Nils@Example.se';
  dom.falt('login-password').value = 'ett långt lösenord';
  skicka(dom);
  await flush();
  const post = anrop.find((a) => a.url === '/api/auth/logga-in');
  assert.equal(post.method, 'POST');
  assert.deepEqual(kropp(post), { email: 'Nils@Example.se', password: 'ett långt lösenord' });
  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('user-email').textContent, 'nils@example.se');
  assert.equal(dom.falt('account-email').textContent, 'nils@example.se');
  assert.equal(dom.falt('login-password').value, '');
});

test('fel lösenord visar serverns text ordagrant och stannar i vyn', async (t) => {
  const serverns = 'Fel e-postadress eller lösenord.';
  const { dom } = await starta(t, (anropet) =>
    anropet.url === '/api/auth/logga-in' ? { status: 401, json: { error: serverns } } : MIG_401
  );
  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('login-password').value = 'fel lösenord här';
  skicka(dom);
  await flush();
  assert.equal(dom.falt('login-error').textContent, serverns);
  assert.equal(dom.falt('login-view').hidden, false);
});

test('ett avvisat fetch vid inloggningen ger den allmänna texten och knappen släpps', async (t) => {
  const { dom } = await starta(t, (anropet) => (anropet.url === '/api/auth/logga-in' ? new Error('nätet nere') : MIG_401));
  skicka(dom);
  await flush();
  assert.equal(dom.falt('login-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('login-submit').disabled, false);
});

test('Skapa konto byter läge och skickar till /api/auth/registrera, med fältfel under fälten', async (t) => {
  const { dom, anrop } = await starta(t, (anropet) => {
    if (anropet.url === '/api/auth/registrera') {
      return {
        status: 400,
        json: {
          error: 'Lösenordet måste vara minst 10 tecken.',
          fieldErrors: [{ field: 'password', message: 'Lösenordet måste vara minst 10 tecken.' }]
        }
      };
    }
    return MIG_401;
  });
  dom.falt('tab-register').utlos('click');
  assert.equal(dom.falt('login-title').textContent, 'Skapa konto');
  assert.equal(dom.falt('login-submit').textContent, 'Skapa konto');
  assert.equal(dom.falt('login-password-label').textContent, 'Välj ett lösenord');
  assert.equal(dom.falt('login-password').getAttribute('autocomplete'), 'new-password');
  assert.equal(dom.falt('password-hint').hidden, false);
  assert.equal(dom.falt('forgot-link').hidden, true);
  assert.equal(dom.falt('tab-register').getAttribute('aria-pressed'), 'true');

  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('login-password').value = 'kort';
  skicka(dom);
  await flush();
  const post = anrop.find((a) => a.url === '/api/auth/registrera');
  assert.deepEqual(kropp(post), { email: 'nils@example.se', password: 'kort' });
  assert.equal(dom.falt('error-password').textContent, 'Lösenordet måste vara minst 10 tecken.');
  assert.equal(dom.falt('login-error').textContent, '');
});

test('ett 201 från registreringen laddar månadsvyn', async (t) => {
  let skapat = false;
  const { dom } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig' && !skapat) {
      return MIG_401;
    }
    if (anropet.url === '/api/auth/registrera') {
      skapat = true;
      return { status: 201, json: { ok: true } };
    }
    return inloggadeHamtningar(anropet);
  });
  dom.falt('tab-register').utlos('click');
  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('login-password').value = 'ett långt lösenord';
  skicka(dom);
  await flush();
  assert.equal(dom.falt('month-view').hidden, false);
});

test('?registrera öppnar vyn i läget Skapa konto', async (t) => {
  const { dom } = await starta(t, () => MIG_401, { search: '?registrera' });
  assert.equal(dom.falt('login-title').textContent, 'Skapa konto');
});

test('efter inloggningen tas ?registrera bort, så att nästa utloggning visar Logga in', async (t) => {
  const { dom, historik } = await starta(t, (anropet) =>
    anropet.url === '/api/auth/logga-ut' ? { status: 204 } : inloggadeHamtningar(anropet), { search: '?registrera' });
  assert.deepEqual(historik, ['/app']);
  dom.falt('log-out').utlos('click');
  await flush();
  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('forgot-link').hidden, false);
});

test('byte av läge tömmer lösenordet och gamla fel men behåller adressen', async (t) => {
  const { dom } = await starta(t, (anropet) =>
    anropet.url === '/api/auth/logga-in' ? { status: 401, json: { error: 'Fel.' } } : MIG_401
  );
  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('login-password').value = 'något lösenord';
  skicka(dom);
  await flush();
  assert.equal(dom.falt('login-error').textContent, 'Fel.');
  dom.falt('tab-register').utlos('click');
  assert.equal(dom.falt('login-error').textContent, '');
  assert.equal(dom.falt('login-password').value, '');
  assert.equal(dom.falt('login-email').value, 'nils@example.se');
});

test('Glömt lösenord skickar bara adressen och visar beskedet vid 202', async (t) => {
  const { dom, anrop } = await starta(t, (anropet) => (anropet.url === '/api/auth/glomt-losenord' ? { status: 202 } : MIG_401));
  dom.falt('forgot-link').utlos('click');
  assert.equal(dom.falt('login-title').textContent, 'Glömt lösenord');
  assert.equal(dom.falt('login-submit').textContent, 'Skicka länk');
  assert.equal(dom.falt('login-password-field').hidden, true);
  assert.equal(dom.falt('login-tabs').hidden, true);
  assert.equal(dom.falt('back-to-login').hidden, false);
  dom.falt('login-email').value = 'nils@example.se';
  skicka(dom);
  await flush();
  assert.deepEqual(kropp(anrop.find((a) => a.url === '/api/auth/glomt-losenord')), { email: 'nils@example.se' });
  assert.equal(
    dom.falt('login-note').textContent,
    'Om adressen har ett konto har vi skickat en länk dit. Den gäller i en timme. Titta också i skräpposten.'
  );
  dom.falt('back-to-login').utlos('click');
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('login-note').textContent, '');
});

test('länken i mejlet öppnar Nytt lösenord utan att fråga /api/mig, och tokenet skickas med', async (t) => {
  let klart = false;
  const { dom, anrop, historik } = await starta(
    t,
    (anropet) => {
      if (anropet.url === '/api/auth/nytt-losenord') {
        klart = true;
        return { status: 204 };
      }
      if (anropet.url === '/api/mig' && !klart) {
        return MIG_401;
      }
      return inloggadeHamtningar(anropet);
    },
    { search: '?aterstall=abc123' }
  );
  assert.deepEqual(anrop.map((a) => a.url), []);
  assert.equal(dom.falt('login-title').textContent, 'Välj ett nytt lösenord');
  assert.equal(dom.falt('login-email-field').hidden, true);
  assert.equal(dom.falt('login-password-label').textContent, 'Nytt lösenord');
  assert.equal(dom.falt('password-hint').hidden, false);
  dom.falt('login-password').value = 'ett nytt långt lösenord';
  skicka(dom);
  await flush();
  assert.deepEqual(kropp(anrop[0]), { token: 'abc123', password: 'ett nytt långt lösenord' });
  assert.deepEqual(historik, ['/app']);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('en ogiltig länk visar serverns text under fältet för token i den allmänna felraden', async (t) => {
  const text = 'Länken är ogiltig eller har gått ut. Begär en ny länk.';
  const { dom } = await starta(
    t,
    () => ({ status: 400, json: { error: text, fieldErrors: [{ field: 'token', message: text }] } }),
    { search: '?aterstall=gammal' }
  );
  dom.falt('login-password').value = 'ett nytt långt lösenord';
  skicka(dom);
  await flush();
  assert.equal(dom.falt('login-error').textContent, text);
});

test('ett andra submit medan anropet pågår skickar inget nytt anrop', async (t) => {
  const { dom, anrop } = await starta(t, (anropet) => (anropet.url === '/api/auth/logga-in' ? null : MIG_401));
  skicka(dom);
  skicka(dom);
  await flush();
  assert.equal(anrop.filter((a) => a.url === '/api/auth/logga-in').length, 1);
  assert.equal(dom.falt('login-submit').disabled, true);
});

test('Mitt konto visar adressen, exportlänken och Tillbaka byter till månaden', async (t) => {
  const { dom } = await starta(t, inloggadeHamtningar);
  assert.equal(dom.falt('show-account').utlos('click'), true);
  assert.equal(dom.falt('account-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('account-email').textContent, 'nils@example.se');
  assert.equal(dom.falt('account-export').href, '/api/mig/export');
  dom.falt('back-from-account').utlos('click');
  assert.equal(dom.falt('account-view').hidden, true);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('Ta bort kontot skickar lösenordet och visar inloggningsvyn vid 204', async (t) => {
  const { dom, anrop } = await starta(t, (anropet) =>
    anropet.method === 'DELETE' && anropet.url === '/api/mig' ? { status: 204 } : inloggadeHamtningar(anropet)
  );
  dom.falt('show-account').utlos('click');
  dom.falt('delete-password').value = 'ett långt lösenord';
  dom.falt('delete-form').utlos('submit', { preventDefault() {} });
  await flush();
  const del = anrop.find((a) => a.method === 'DELETE');
  assert.deepEqual(kropp(del), { password: 'ett långt lösenord' });
  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('account-view').hidden, true);
  assert.equal(dom.falt('login-note').textContent, 'Kontot är borttaget.');
  assert.equal(dom.falt('delete-password').value, '');
});

test('fel lösenord vid borttagningen visar serverns text och kontot står kvar', async (t) => {
  const { dom } = await starta(t, (anropet) =>
    anropet.method === 'DELETE' ? { status: 400, json: { error: 'Lösenordet stämmer inte.' } } : inloggadeHamtningar(anropet)
  );
  dom.falt('show-account').utlos('click');
  dom.falt('delete-password').value = 'fel';
  dom.falt('delete-form').utlos('submit', { preventDefault() {} });
  await flush();
  assert.equal(dom.falt('delete-error').textContent, 'Lösenordet stämmer inte.');
  assert.equal(dom.falt('account-view').hidden, false);
});

test('att öppna Mitt konto igen tömmer lösenordet och felet', async (t) => {
  const { dom } = await starta(t, (anropet) =>
    anropet.method === 'DELETE' ? { status: 400, json: { error: 'Lösenordet stämmer inte.' } } : inloggadeHamtningar(anropet)
  );
  dom.falt('show-account').utlos('click');
  dom.falt('delete-password').value = 'fel';
  dom.falt('delete-form').utlos('submit', { preventDefault() {} });
  await flush();
  dom.falt('back-from-account').utlos('click');
  dom.falt('show-account').utlos('click');
  assert.equal(dom.falt('delete-error').textContent, '');
  assert.equal(dom.falt('delete-password').value, '');
});
