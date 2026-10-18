// Banc de la logique des gestes (web/js/battle/gestes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les hommes jouent des animations précalculées (web/anims/soldat.*) choisies par le
// processeur d'après l'état de leur régiment. Un mauvais choix (un porte-drapeau qui met en joue sa hampe, un régiment
// qui marche figé) ne fait rien planter : il se voit mal au milieu de milliers de soldats. Ici on fixe les règles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gesture, activity, pick, SALVE_FEU, SALVE_DUREE, BOUTEFEU_FEU, variety, rows } from '../web/js/battle/gestes.js';

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

test('chaque homme a sa variété, toujours la même, dans les bornes', () => {
  assert.deepEqual(variety(7, 12), variety(7, 12));
  assert.notDeepEqual(variety(7, 12), variety(7, 13));
  assert.notDeepEqual(variety(7, 12), variety(8, 12));
  for (let i = 0; i < 500; i++) {
    const v = variety(3, i);
    assert.ok(Math.abs(v.du) <= 0.15 && Math.abs(v.dv) <= 0.15, 'place à ±15 cm');
    assert.ok(Math.abs(v.da) <= 6 * Math.PI / 180, 'sens à ±6°');
    assert.ok(v.size >= 0.95 && v.size <= 1.05, 'taille à ±5 %');
    assert.ok(v.speed >= 0.94 && v.speed <= 1.06, 'rythme à ±6 %');
    assert.ok(v.delay >= 0 && v.delay <= 0.4, 'délai de quelques dixièmes de seconde');
  }
});

test('attributs du geste : fondu depuis le geste d’avant, au délai de l’homme ; son rythme dans les boucles', () => {
  const v = { speed: 1.05, delay: 0.2 }, loop = id => id === 1;
  // geste 1 (en boucle) depuis le geste 2 (une salve), changement à 10 s
  assert.deepEqual(rows([1, 9], [2, 4], 10, v, loop), [[1, 9, 2, 4], [10.2, 1.05, 1, 0]]);
  // geste 2 (sans boucle) : joué à sa vitesse propre
  assert.deepEqual(rows([2, 9], [1, 4], 10, v, loop)[1], [10.2, 1, 1.05, 0]);
  // sans geste d'avant : pas de fondu
  assert.deepEqual(rows([1, 9], null, 10, v, loop), [[1, 9, 1, 9], [-99, 1.05, 1.05, 0]]);
});

// un servant de la pièce 1 (rang 200 + 10 × pièce + rôle : 1 écouvillon, 2 porteur, 3 pointeur, 4 boutefeu, 0 chef)
const servant = (role, o) => homme({ kind: 'servant', act: 'repos', rank: 210 + role, form: 'batterie', ...o });

test('les servants s’affairent quand leur pièce vient de tirer, se reposent sinon', () => {
  const shots = { 1: 9 };
  assert.equal(pick(servant(1, { shots }))[0], 'refouler');
  assert.equal(pick(servant(2, { shots }))[0], 'porter');
  assert.equal(pick(servant(0, { shots }))[0], 'parle');
  assert.equal(pick(servant(1, { shots, now: 30 }))[0], 'repos');
  assert.equal(pick(servant(1, { shots: { 0: 9 } }))[0], 'repos', 'une autre pièce a tiré');
  // le pointeur reste accroupi derrière sa pièce
  assert.equal(pick(servant(3, { now: 30 }))[0], 'pointer');
});

test('le boutefeu touche la lumière au moment du coup de sa pièce', () => {
  assert.deepEqual(pick(servant(4, { shots: { 1: 9 } })), ['boutefeu', 9 - BOUTEFEU_FEU]);
});

test('une batterie qui se déplace : ses servants marchent', () => {
  assert.equal(pick(servant(1, { act: 'marche', shots: { 1: 9 } }))[0], 'marche');
});

test('les gestes des servants existent dans le fichier précalculé', () => {
  for (const c of ['refouler', 'porter', 'pointer', 'boutefeu']) assert.ok(meta.clips[c], c);
});
