// Banc de la logique des gestes (web/js/battle/gestes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les hommes jouent des animations précalculées (web/anims/soldat.*) choisies par le
// processeur d'après l'état de leur régiment. Un mauvais choix (un porte-drapeau qui met en joue sa hampe, un régiment
// qui marche figé) ne fait rien planter : il se voit mal au milieu de milliers de soldats. Ici on fixe les règles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gesture, activity } from '../web/js/battle/gestes.js';

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
