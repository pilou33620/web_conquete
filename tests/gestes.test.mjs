// Banc de la logique des gestes (web/js/battle/gestes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les hommes jouent des animations précalculées (web/anims/soldat.*) choisies par le
// processeur d'après l'état de leur régiment. Un mauvais choix (un porte-drapeau qui met en joue sa hampe, un régiment
// qui marche figé) ne fait rien planter : il se voit mal au milieu de milliers de soldats. Ici on fixe les règles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Terrain } from '../web/js/battle/terrain.js';
import { gesture, activity, pick, SALVE_FEU, SALVE_DUREE, BOUTEFEU_FEU, serving, variety, rows, chooseDead, pushRing, chooseLine, matchSlots, moves, pushOut, foeOf, scrum, scaleAt, smokeless } from '../web/js/battle/gestes.js';

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

test('un régiment qui se déplace marche, sauf s’il charge, fuit ou se bat ; arrêté, un fuyard se repose', () => {
  assert.equal(activity({ state: 'repos' }, true), 'marche');
  assert.equal(activity({ state: 'feu' }, true), 'marche');
  assert.equal(activity({ state: 'charge' }, true), 'charge');
  assert.equal(activity({ state: 'deroute' }, true), 'deroute');
  assert.equal(activity({ state: 'repos' }, false), 'repos');
  // le choc : le serveur fait avancer la charge et la met en mêlée dans le même pas (les chevaux se cabrent)
  assert.equal(activity({ state: 'melee' }, true), 'melee');
  // le régiment se reforme sur place (60 s), les fuyards arrêtés ne courent pas sur place
  assert.equal(activity({ state: 'ralliement' }, false), 'repos');
  assert.equal(activity({ state: 'deroute' }, false), 'repos');
  assert.equal(activity({ state: 'ralliement' }, true), 'ralliement');
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

test('la salve dure jusqu’à la fin de la recharge du dernier homme, puis le feu reprend', () => {
  const volley = { t: 10, roll: 1, dur: 1 };
  assert.equal(pick(homme({ now: 10 + 1 + SALVE_DUREE - 0.3, volley }))[0], 'salve', 'le dernier homme recharge encore');
  assert.equal(pick(homme({ now: 10 + 1 + SALVE_DUREE + 0.3, volley }))[0], 'joue');
});

test('le porte-drapeau ne se bat pas en mêlée', () => {
  assert.equal(pick(homme({ kind: 'drapeau', act: 'melee' }))[0], 'repos');
});

test('une batterie reste en action quelques secondes après le coup d’une de ses pièces', () => {
  assert.equal(serving({ 1: 9 }, 10), true);
  assert.equal(serving({ 1: 9 }, 17.1), false);
  assert.equal(serving(undefined, 0), false);
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

// une ligne de trois rangs de 20 files, puis l'encadrement (rang négatif) ; une figurine : [u, v, sorte, …, rang]
const ligne = [...[0, 1, 2].flatMap(r => Array.from({ length: 20 }, (_, k) => [k, -r, 'inf', 0, 0, r])), [0, -4, 'officier', 0, 0, -1]];

test('les tués : autant que demandé, chacun une fois, surtout au premier rang', () => {
  const d = chooseDead(ligne, 12, 5);
  assert.equal(d.length, 12);
  assert.equal(new Set(d).size, 12);
  assert.deepEqual(chooseDead(ligne, 12, 5), d, 'le même tirage pour la même graine');
  let front = 0, all = 0;
  for (let seed = 0; seed < 50; seed++) for (const i of chooseDead(ligne, 6, seed)) { all++; if (ligne[i][5] === 0) front++; }
  assert.ok(front / all > 0.45, `${front} sur ${all} au premier rang`);
  assert.equal(chooseDead(ligne, 100, 1).length, ligne.length, 'pas plus que de figurines');
});

test('les corps au sol : plafonnés, les plus anciens sortent les premiers, tous ceux de trop si le plafond baisse', () => {
  const ring = [];
  assert.deepEqual(pushRing(ring, 3, 'a'), []);
  pushRing(ring, 3, 'b'); pushRing(ring, 3, 'c');
  assert.deepEqual(pushRing(ring, 3, 'd'), ['a']);
  assert.deepEqual(pushRing(ring, 3, 'e'), ['b']);
  assert.deepEqual(ring, ['c', 'd', 'e']);
  // la qualité descend (plafond 2) : les plus anciens sortent tous à la chute suivante
  assert.deepEqual(pushRing(ring, 2, 'f'), ['c', 'd']);
  assert.deepEqual(ring, ['e', 'f']);
});

test('un boulet couche la file la plus proche de sa trajectoire', () => {
  // boulet venu de l'avant qui traverse le front à u = 5 (repère du régiment : u le long du front, v vers l'avant)
  const d = chooseLine(ligne, 3, [5.2, 30], [4.8, -30]);
  assert.equal(d.length, 3);
  for (const i of d) assert.equal(ligne[i][0], 5, `figurine ${i} en u = ${ligne[i][0]}`);
  // de biais : les plus proches d'abord
  const e = chooseLine(ligne, 2, [0, 10], [10, -10]);
  for (const i of e) assert.ok(Math.abs(ligne[i][0] - (5 - ligne[i][1] / 2)) < 1.5, `figurine ${i}`);
});

test('d’une disposition à l’autre : chaque homme une place, aucune prise deux fois, l’ordre gardé', () => {
  // la même ligne : chacun garde sa place
  assert.deepEqual(matchSlots(ligne, ligne), ligne.map((_, i) => i));
  // la ligne s'élargit (un mètre de plus entre les files) : celui de gauche reste à gauche
  const large = ligne.map(f => [f[0] * 1.5, ...f.slice(1)]);
  const m = matchSlots(ligne, large);
  assert.equal(new Set(m).size, m.length);
  for (let j = 1; j < 20; j++) assert.ok(ligne[m[j]][0] > ligne[m[j - 1]][0], 'ordre gardé dans le rang');
  // l'officier reste officier
  assert.equal(ligne[m[ligne.length - 1]][2], 'officier');
});

test('après des pertes : les tués sont exclus, les nouveaux venus n’ont pas d’ancien', () => {
  const moins = ligne.filter((f, i) => i !== 0 && i !== 1);
  const m = matchSlots(ligne, moins, new Set([3, 25]));
  assert.ok(!m.includes(3) && !m.includes(25), 'pas de tué');
  assert.equal(new Set(m.filter(i => i >= 0)).size, m.filter(i => i >= 0).length);
  // une figurine de plus que la ligne d'avant : celle de trop n'a pas d'ancien (-1)
  const plus = [...ligne, [30, 0, 'inf', 0, 0, 0]];
  assert.equal(matchSlots(ligne, plus).filter(i => i < 0).length, 1);
});

test('d’une ligne à une colonne : personne ne change de côté', () => {
  // les 60 hommes de la ligne (20 files sur 3 rangs, centre à u = 9,5) en colonne de 4 files sur 15 rangs
  const col = Array.from({ length: 60 }, (_, k) => [(k % 4) * 1.5 - 2.25, -Math.floor(k / 4), 'inf', 0, 0, Math.floor(k / 4)]);
  const m = matchSlots(ligne, col);
  assert.equal(m.filter(i => i >= 0).length, 60);
  for (const [j, i] of m.entries()) assert.equal(Math.sign(col[j][0]), Math.sign(ligne[i][0] - 9.5), `homme ${i} : de u = ${ligne[i][0]} à ${col[j][0]}`);
});

test('un régiment qui tourne sur place marche aussi (pas de glissade)', () => {
  const at = (x, y, dir) => ({ x, y, dir });
  assert.equal(moves({ from: at(0, 0, 0), to: at(0, 0, 0.5) }), true, 'conversion');
  assert.equal(moves({ from: at(0, 0, 0), to: at(5, 0, 0) }), true, 'marche');
  assert.equal(moves({ from: at(0, 0, 0), to: at(0.1, 0, 0.01) }), false, 'immobile');
  assert.equal(moves({ from: at(0, 0, 3.1), to: at(0, 0, -3.1) }), true, 'de part et d’autre de ±π');
  assert.equal(moves({ from: at(0, 0, 3.13), to: at(0, 0, -3.13) }), false);
  assert.equal(moves({}), false, 'sans positions');
});

test('bâtiments : un homme pris dans une maison en sort au plus court ; dehors, il ne bouge pas', () => {
  // maison de 10 × 6 m centrée en (100, 50), marge 0,5 m
  const maison = [{ x: 100, y: 50, w: 10, h: 6, a: 0 }];
  assert.deepEqual(pushOut(100 + 4, 50, maison, 0.5), [105.5, 50], 'par le petit côté le plus proche');
  assert.deepEqual(pushOut(100, 50 - 2.5, maison, 0.5), [100, 46.5], 'par le grand côté');
  assert.deepEqual(pushOut(120, 50, maison, 0.5), [120, 50], 'dehors');
  // la même maison tournée d'un quart de tour : ses 10 m vont maintenant du nord au sud
  const [x, y] = pushOut(100, 50 + 4, [{ ...maison[0], a: Math.PI / 2 }], 0.5);
  assert.ok(Math.abs(x - 100) < 1e-9 && Math.abs(y - 55.5) < 1e-9, `${x}, ${y}`);
});

test('en mêlée, l’adversaire est le régiment ennemi en mêlée le plus proche', () => {
  const nous = { id: 1, side: 0, x: 0, y: 0, state: 'melee' };
  const units = [nous, { id: 2, side: 1, x: 30, y: 0, state: 'melee' }, { id: 3, side: 1, x: 10, y: 0, state: 'feu' },
    { id: 4, side: 0, x: 5, y: 0, state: 'melee' }, { id: 5, side: 1, x: 300, y: 0, state: 'melee' }];
  assert.equal(foeOf(nous, units).id, 2);
  assert.equal(foeOf({ ...nous, x: 600 }, units), null, 'trop loin');
});

test('mêlée : les premiers rangs avancent vers l’ennemi et se tournent vers lui', () => {
  const vers = [1, 0];   // l'ennemi sur la gauche du front (u > 0)
  const [a0] = scrum(0, vers, 0.5), [a1] = scrum(1, vers, 0.5), [a3, b3] = scrum(3, vers, 0.5);
  assert.ok(a0 > a1 && a1 > 0, `premier rang ${a0}, deuxième ${a1}`);
  assert.equal(a3, 0); assert.equal(b3, 0);
  assert.ok(Math.abs(scrum(0, vers, 0.5)[2] - Math.PI / 2) < 1e-9, 'tourné vers l’ennemi');
});

test('mêlée : estoc ou poussée selon l’homme, escrime pour les officiers', () => {
  const g = new Set([0.2, 1.1, 2.3, 3.7, 4.1, 5.9].map(phase => pick(homme({ act: 'melee', phase }))[0]));
  assert.deepEqual([...g].sort(), ['estoc', 'poussee']);
  assert.equal(pick(homme({ act: 'melee', kind: 'officier' }))[0], 'escrime');
  assert.ok(meta.clips.escrime, 'escrime précalculée');
});

test('cavaliers : en selle, sabre levé à la charge', () => {
  for (const kind of ['cavalier', 'chef']) {
    assert.equal(pick(homme({ kind, act: 'repos' }))[0], 'selle');
    assert.equal(pick(homme({ kind, act: 'marche' }))[0], 'selle');
    assert.equal(pick(homme({ kind, act: 'charge' }))[0], 'selle-sabre');
  }
  for (const c of ['selle', 'selle-sabre']) assert.ok(meta.clips[c], c);
});

test('cavaliers en mêlée : coups de sabre, chacun à son rythme', () => {
  const a = pick(homme({ kind: 'cavalier', act: 'melee', phase: 0.4 })), b = pick(homme({ kind: 'cavalier', act: 'melee', phase: 2.2 }));
  assert.equal(a[0], 'selle-combo'); assert.notEqual(a[1], b[1]);
  assert.ok(meta.clips['selle-combo'], 'selle-combo précalculée');
});

test('de loin, les figurines grossissent par paliers (×1 à ×3), avec une marge', () => {
  assert.equal(scaleAt(40, 1), 1, 'de près : taille vraie');
  assert.equal(scaleAt(2, 1), 3, 'très loin : ×3 au plus');
  let prev = 1;
  for (let px = 40; px > 1; px *= 0.9) { const k = scaleAt(px, prev); assert.ok(k >= prev, `${px.toFixed(1)} px : ${k} après ${prev}`); prev = k; }
  // près du seuil, le palier d'avant tient encore (de 85 % à 125 % de la hauteur voulue)
  assert.equal(scaleAt(11, 1), 1);
  assert.equal(scaleAt(9, 1), 1.6);
  assert.equal(scaleAt(9, 1.25), 1.25);
  // en se rapprochant, les paliers redescendent jusqu'à la taille vraie
  assert.equal(scaleAt(40, 3), 1, 'revenu près après ×3');
  prev = 3;
  for (let px = 1.5; px < 40; px *= 1.1) { const k = scaleAt(px, prev); assert.ok(k <= prev, `${px.toFixed(1)} px : ${k} après ${prev}`); prev = k; }
  assert.equal(prev, 1);
});

test('la grille des bâtiments (terrain.js) range chaque maison dans les cases qu’elle touche, et prévient si une case déborde', () => {
  const grid = B => Object.assign(Object.create(Terrain.prototype), { buildings: B }).buildingGrid();
  const g = grid([{ x: 100, y: 100, w: 10, h: 8, a: 0 }, { x: 140, y: 100, w: 10, h: 8, a: 0 }]);
  const at = (x, y) => [...g.cells.slice(((Math.floor((y - g.y0) / g.cell)) * g.cols + Math.floor((x - g.x0) / g.cell)) * 4).slice(0, 4)].filter(Boolean);
  assert.deepEqual(at(100, 100), [1]);
  assert.deepEqual(at(140, 100), [2]);
  assert.deepEqual(at(120, 100), []);
  // un bourg serré : la portée raccourcit d'abord (aucune case pleine, aucun avertissement)…
  const warn0 = console.warn, said0 = [];
  console.warn = m => said0.push(m);
  let g0;
  try { g0 = grid([0, 1, 2, 3, 4].map(k => ({ x: 100 + k * 3, y: 100, w: 4, h: 4, a: 0 }))); } finally { console.warn = warn0; }
  assert.equal(said0.length, 0);
  assert.deepEqual([...new Set(g0.cells)].filter(Boolean).sort(), [1, 2, 3, 4, 5], 'chaque maison est dans la grille');
  // … mais cinq maisons l'une sur l'autre débordent même sans portée, et on le dit
  const warn = console.warn, said = [];
  console.warn = m => said.push(m);
  try { grid([0, 1, 2, 3, 4].map(k => ({ x: 100 + k, y: 100, w: 4, h: 4, a: 0 }))); } finally { console.warn = warn; }
  assert.equal(said.length, 1);
});

test('poudre sans fumée : le Lebel, et les pièces du camp qui a la poudre B (SPEC-TECH.md)', () => {
  const marks = [['sans_fumee'], []];
  assert.equal(smokeless({ side: 1, cls: 'inf', arm: 7 }, marks), true, 'fusil Lebel');
  assert.equal(smokeless({ side: 0, cls: 'inf', arm: 6 }, marks), false, 'fusil Gras : poudre noire, même dans un camp en avance');
  assert.equal(smokeless({ side: 0, cls: 'artillerie', arm: 5 }, marks), true);
  assert.equal(smokeless({ side: 1, cls: 'artillerie', arm: 6 }, marks), false, 'le camp sans la poudre B');
  assert.equal(smokeless({ side: 0, type: 'mitrailleuses', cls: 'artillerie' }, marks), true);
  assert.equal(smokeless({ side: 0, type: 'ligne', arm: 7 }), true, 'sans marques ni classe');
  assert.equal(smokeless({ side: 0, cls: 'artillerie' }), false);
});

test('piquiers : pique dressée, croisée à la charge, en mêlée et en carré ; ils ne tirent pas', () => {
  const g = (act, form = 'ligne', extra = {}) => pick({ act, actT: 0, now: 1, kind: 'piquier', rank: 0, u: 0, w: 100, form, phase: 0.3, volley: null, moving: false, ...extra })[0];
  assert.equal(g('repos'), 'repos');
  assert.equal(g('marche'), 'marche');
  assert.equal(g('feu'), 'repos', 'pendant le feu de la ligne, pique dressée');
  assert.equal(g('repos', 'ligne', { volley: { t: 0.5, roll: 1, dur: 1 } }), 'repos', 'ni pendant la salve');
  assert.equal(g('charge'), 'charge', 'pique croisée');
  assert.ok(['estoc', 'poussee'].includes(g('melee')));
  assert.equal(g('repos', 'carre'), 'joue', 'en carré, pique croisée vers l’extérieur');
  assert.equal(g('deroute'), 'course');
});
