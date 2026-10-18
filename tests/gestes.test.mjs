// Banc de la logique des gestes (web/js/battle/gestes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les hommes jouent des animations précalculées (web/anims/soldat.*) choisies par le
// processeur d'après l'état de leur régiment. Un mauvais choix (un porte-drapeau qui met en joue sa hampe, un régiment
// qui marche figé) ne fait rien planter : il se voit mal au milieu de milliers de soldats. Ici on fixe les règles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gesture, activity, pick, SALVE_FEU, SALVE_DUREE } from '../web/js/battle/gestes.js';

const meta = JSON.parse(fs.readFileSync(new URL('../web/anims/soldat.json', import.meta.url)));

test('le geste suit l’état du régiment', () => {
  assert.equal(gesture('repos', 'inf'), 'repos');
  assert.equal(gesture('marche', 'inf'), 'marche');
  assert.equal(gesture('charge', 'inf'), 'charge');
  assert.equal(gesture('deroute', 'inf'), 'course');
  assert.equal(gesture('ralliement', 'inf'), 'trot');
  assert.equal(gesture('feu', 'inf'), 'joue');
  assert.equal(gesture('recharge', 'inf'), 'recharge');
});

test('un régiment qui se déplace marche, sauf s’il charge ou fuit', () => {
  assert.equal(activity({ state: 'repos' }, true), 'marche');
  assert.equal(activity({ state: 'feu' }, true), 'marche');
  assert.equal(activity({ state: 'charge' }, true), 'charge');
  assert.equal(activity({ state: 'deroute' }, true), 'deroute');
  assert.equal(activity({ state: 'repos' }, false), 'repos');
});

test('officiers, tambours et porte-drapeau ne mettent jamais en joue', () => {
  for (const kind of ['officier', 'tambour', 'drapeau']) for (const state of ['feu', 'recharge', 'charge', 'melee']) {
    const g = gesture(state, kind);
    assert.ok(!['joue', 'genou', 'recharge', 'charge', 'estoc', 'poussee'].includes(g), `${kind} en ${state} : ${g}`);
  }
  assert.equal(gesture('repos', 'officier'), 'parle');
});

test('chaque geste existe dans le fichier précalculé', () => {
  for (const kind of ['inf', 'officier', 'tambour', 'drapeau']) for (const state of ['repos', 'marche', 'charge', 'deroute', 'ralliement', 'feu', 'recharge', 'melee', 'hors']) {
    assert.ok(meta.clips[gesture(state, kind)], `${kind} en ${state} : ${gesture(state, kind)} absent`);
  }
});

// un homme d'une ligne de 40 m qui fait feu, à l'instant now ; volley : la dernière salve (effets.js : instant, sens,
// durée du roulement)
const homme = o => ({ act: 'feu', actT: 5, now: 10, kind: 'inf', rank: 1, u: 0, w: 40, form: 'ligne', phase: 1, volley: null, moving: false, ...o });

test('la salve roule le long du front : chaque file tire à son tour', () => {
  const v = { t: 10, roll: 1, dur: 1 };
  assert.deepEqual(pick(homme({ u: -20, volley: v })), ['salve', 10 - SALVE_FEU]);
  assert.deepEqual(pick(homme({ u: 20, volley: v })), ['salve', 11 - SALVE_FEU]);
  // dans l'autre sens, la file de droite tire la première
  assert.deepEqual(pick(homme({ u: 20, volley: { ...v, roll: -1 } })), ['salve', 10 - SALVE_FEU]);
});

test('en ligne à l’arrêt, le premier rang tire à genoux ; le troisième rang ne tire pas', () => {
  const v = { t: 10, roll: 1, dur: 1 };
  assert.equal(pick(homme({ rank: 0, volley: v }))[0], 'salve-genou');
  assert.equal(pick(homme({ rank: 0, volley: v, form: 'colonne' }))[0], 'salve');
  assert.equal(pick(homme({ rank: 2, volley: v }))[0], 'repos');
});

test('sans salve récente : en joue au feu, la baguette à la recharge', () => {
  assert.equal(pick(homme({ rank: 0 }))[0], 'genou');
  assert.equal(pick(homme({ rank: 1 }))[0], 'joue');
  assert.equal(pick(homme({ act: 'recharge' }))[0], 'recharge');
  // une salve finie ne compte plus
  assert.equal(pick(homme({ now: 11 + SALVE_DUREE + 0.1, volley: { t: 10, roll: 1, dur: 1 } }))[0], 'joue');
});

test('une salve tirée depuis le repos se joue aussi (la maquette tire sans passer à l’état feu)', () => {
  assert.equal(pick(homme({ act: 'repos', volley: { t: 10, roll: 1, dur: 1 } }))[0], 'salve');
  assert.equal(pick(homme({ act: 'repos', now: 20, volley: { t: 10, roll: 1, dur: 1 } }))[0], 'repos');
  assert.equal(pick(homme({ act: 'marche', volley: { t: 10, roll: 1, dur: 1 } }))[0], 'marche');
});

test('les tirailleurs tirent chacun à son rythme', () => {
  const a = pick(homme({ form: 'tirailleurs', rank: 0, phase: 0.5 })), b = pick(homme({ form: 'tirailleurs', rank: 0, phase: 2.5 }));
  assert.equal(a[0], 'feu-libre'); assert.equal(b[0], 'feu-libre');
  assert.notEqual(a[1], b[1]);
});

test('officiers en garde au feu, tambours qui battent la caisse', () => {
  assert.equal(pick(homme({ kind: 'officier' }))[0], 'garde');
  assert.equal(pick(homme({ kind: 'officier', act: 'repos' }))[0], 'parle');
  assert.equal(pick(homme({ kind: 'tambour', act: 'repos' }))[0], 'tambour');
  assert.equal(pick(homme({ kind: 'tambour', act: 'marche' }))[0], 'tambour-marche');
  assert.equal(pick(homme({ kind: 'drapeau', volley: { t: 10, roll: 1, dur: 1 } }))[0], 'repos');
});

test('les gestes de la salve existent dans le fichier précalculé', () => {
  for (const c of ['salve', 'salve-genou', 'feu-libre', 'tambour', 'tambour-marche', 'garde']) assert.ok(meta.clips[c], c);
});
