// Banc des effets de bataille en 2D (web/js/battle/effets.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le serveur envoie ses effets par genre (salve, canon, mitraille, impact, explosion, charge,
// deroute, fumee) ; un genre qui plante coupe l'image en pleine bataille. Les éclairs doivent partir des bouches que
// donne Troupes2D (un._muzzles), les plafonds de particules tenir (sinon un feu roulant fait tomber l'iPad), les trous
// garder la forme que la vue peint au sol, et la lumière de chaque heure rester dans des bornes sûres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installer } from './dom.mjs';

installer();
// un faux canevas 2D : toute méthode existe et ne fait rien ; on compte les drawImage
let images = 0;
const ctx2d = new Proxy({}, {
  get: (o, k) => k in o ? o[k] : k === 'drawImage' ? () => { images++; } : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {},
  set: (o, k, v) => { o[k] = v; return true; },
});
globalThis.document.createElement = () => ({ width: 0, height: 0, getContext: () => ctx2d });
const { Effects, smokeless } = await import('../web/js/battle/effets.js');
const { PROFILS } = await import('../web/js/battle/qualite.js');

const view = { z: 6, dpr: 2, vw: 1280, vh: 800, cam: { x: 500, y: 300 }, monde() {}, time: 0, dt: 1 / 60 };
const ligne = (o = {}) => ({ id: 1, side: 0, type: 'ligne', cls: 'inf', form: 'ligne', x: 500, y: 300, dir: 0, w: 120, d: 12, men: 300, men0: 300, ...o });
const batterie = (o = {}) => ({ id: 2, side: 0, type: 'artillerie', cls: 'artillerie', form: 'batterie', x: 400, y: 300, dir: 0, w: 60, d: 30, men: 120, men0: 120, ...o });
const tourner = (fx, s, step = 1 / 30) => { for (let t = 0; t < s; t += step) fx.update(step, [2, 1]); };

test('chaque genre d’effet du serveur passe sans erreur, et se dessine', () => {
  const fx = new Effects(PROFILS.haute);
  const units = [ligne(), batterie(), batterie({ id: 3, type: 'mitrailleuses', arm: 5 }), ligne({ id: 4, form: 'tirailleurs' })];
  const fxs = [
    { k: 'salve', x: 500, y: 300, x2: 700, y2: 300, n: 4 }, { k: 'canon', x: 400, y: 300, x2: 800, y2: 320, n: 3 },
    { k: 'mitraille', x: 400, y: 300, x2: 560, y2: 300, n: 8 }, { k: 'impact', x: 600, y: 300, n: 300 },
    { k: 'impact', x: 610, y: 300 }, { k: 'explosion', x: 650, y: 310 }, { k: 'charge', x: 520, y: 300, x2: 600, y2: 300 },
    { k: 'deroute', x: 540, y: 300 }, { k: 'fumee', x: 500, y: 290 }, { k: 'fumee', x: 500, y: 290, dust: true },
    { k: 'inconnu', x: 0, y: 0 },
  ];
  for (const f of fxs) { for (const u of [undefined, ...units]) fx.push(f, u, Math.random() * 0.5); }
  fx.trail(500, 300, 0, 80, 1.5);
  tourner(fx, 3);
  assert.ok(fx.puffs.length > 0 && fx.bits.length > 0, 'de la fumée et de la terre');
  images = 0;
  fx.draw(ctx2d, view);
  assert.ok(images > 0, 'des taches posées par drawImage');
  for (const sky of [{ weather: 'pluie', light: 1, hour: 10 }, { weather: 'neige', hour: 8 }, { weather: 'orage', light: 0.3, hour: 20 }, { weather: 'brouillard', hour: 7 }, { weather: 'canicule', hour: 14 }])
    for (let i = 0; i < 40; i++) fx.atmosphere(ctx2d, view, { ...sky, wind: [3, 1] }, 0.25, i);
  tourner(fx, 70);
  assert.equal(fx.puffs.length + fx.flashes.length + fx.balls.length + fx.streaks.length + fx.bits.length + fx.queue.length, 0, 'tout s’éteint');
});

test('les éclairs et la fumée partent des bouches données par Troupes2D', () => {
  const fx = new Effects(PROFILS.haute);
  const bouches = [[480, 310, 0.3], [490, 312, 0.3], [505, 314, 0.3]];
  const u = ligne({ _muzzles: bouches });
  fx.push({ k: 'salve', x: 500, y: 300, x2: 700, y2: 300 }, u, 0);
  const vus = [];
  for (let t = 0; t < 2; t += 1 / 60) { fx.update(1 / 60, [0, 0]); vus.push(...fx.flashes.map(f => [f.x, f.y, f.a])); }
  assert.ok(vus.length >= 3);
  for (const [x, y, a] of vus) assert.ok(bouches.some(m => Math.hypot(m[0] - x, m[1] - y) < 1e-6 && m[2] === a), `éclair hors des bouches : ${x}, ${y}`);
  assert.ok(u._volley, 'la salve est signalée aux troupes');
  // la batterie : une bouche par pièce, chaque pièce signalée (recul)
  const b = batterie({ _muzzles: [[380, 290, 0], [380, 310, 0]] });
  fx.push({ k: 'canon', x: 400, y: 300, x2: 900, y2: 300 }, b, 0);
  const vb = [];
  for (let t = 0; t < 1; t += 1 / 60) { fx.update(1 / 60, [0, 0]); vb.push(...fx.flashes.filter(f => f.x < 400)); }
  assert.ok(vb.length >= 2 && vb.every(f => f.x === 380));
  assert.deepEqual(Object.keys(b._shots).sort(), ['0', '1']);
});

test('sans bouches, la salve part du front de l’unité', () => {
  const fx = new Effects(PROFILS.haute), u = ligne({ dir: Math.PI / 2 });   // face au sud : le front est en y + d/2
  fx.push({ k: 'salve', x: 500, y: 300 }, u, 0);
  const ys = [];
  for (let t = 0; t < 2; t += 1 / 60) { fx.update(1 / 60, [0, 0]); ys.push(...fx.flashes.map(f => f.y)); }
  assert.ok(ys.length > 0 && ys.every(y => y > 300 + 6), 'devant les hommes');
});

test('les plafonds de particules tiennent sous un feu roulant', () => {
  for (const q of ['basse', 'moyenne', 'haute', 'ultra']) {
    const P = PROFILS[q], fx = new Effects(P);
    for (let i = 0; i < 300; i++) {
      fx.push({ k: i % 3 ? 'salve' : 'canon', x: 0, y: i, x2: 300, y2: i }, i % 3 ? ligne({ id: i, y: i * 3, w: 200 }) : batterie({ id: i, y: i * 3 }), Math.random());
      if (i % 20 === 0) fx.push({ k: 'explosion', x: 200, y: i }, null, 0);
    }
    let max = 0;
    for (let t = 0; t < 6; t += 1 / 30) { fx.update(1 / 30, [1, 0]); max = Math.max(max, fx.puffs.length); assert.ok(fx.bits.length <= P.puffs >> 1, `${q} : mottes`); }
    assert.ok(max <= P.puffs, `${q} : ${max} fumées pour ${P.puffs}`);
    assert.ok(fx.flashes.length <= 600 && fx.streaks.length <= 1200 && fx.balls.length <= 200);
  }
});

test('les trous gardent leur forme (la vue les peint au sol)', () => {
  const fx = new Effects(PROFILS.haute);
  fx.push({ k: 'explosion', x: 10, y: 20 }, null, 0);
  for (let i = 0; i < 40; i++) fx.push({ k: 'canon', x: 0, y: 0, x2: 400, y2: 0, n: 2 }, null, 0);
  tourner(fx, 4);
  assert.ok(fx.decals.length > 1);
  for (const d of fx.decals) {
    assert.equal(d.k, 'trou');
    for (const k of ['x', 'y', 'r', 'a']) assert.ok(Number.isFinite(d[k]), k);
    assert.ok(d.r > 0 && d.r <= 6);
  }
  assert.deepEqual(fx.decals[0], { k: 'trou', x: 10, y: 20, r: 6, a: 0 });
});

test('poudre sans fumée : presque rien après la salve', () => {
  const fx = new Effects(PROFILS.haute);
  assert.equal(smokeless(ligne({ arm: 7 }), fx.marks), true);
  fx.marks = [['sans_fumee'], []];
  assert.equal(smokeless(batterie(), fx.marks), true);
  fx.push({ k: 'salve', x: 500, y: 300 }, ligne({ arm: 7 }), 0);
  tourner(fx, 2);
  assert.ok(fx.puffs.every(p => p.s === 'h'));
});

test('la lumière de chaque heure reste dans des bornes sûres', () => {
  const fx = new Effects(PROFILS.haute);
  for (const weather of ['soleil', 'canicule', 'nuages', 'pluie', 'orage', 'tempete', 'brouillard', 'neige', undefined])
    for (let hour = 5; hour <= 22; hour += 0.5)
      for (const light of [1, 0.6, 0.15]) {
        const c = fx.ciel({ weather, hour, light }, 'ete'), m = `${weather} ${hour} h ${light}`;
        assert.ok(Math.abs(Math.hypot(...c.sunDir) - 1) < 1e-9 && c.sunDir[1] > 0, m);
        assert.ok(Number.isFinite(c.ombre.dx) && Math.hypot(c.ombre.dx, c.ombre.dy) <= 4 + 1e-9 && c.ombre.a >= 0 && c.ombre.a <= 1, m);
        assert.equal(c.voile.length, 4);
        c.voile.slice(0, 3).forEach(v => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${m} : ${c.voile}`));
        assert.ok(c.voile[3] >= 0 && c.voile[3] < 0.75, m);
        for (const k of ['desat', 'nuit', 'brume', 'nuages']) assert.ok(c[k] >= 0 && c[k] <= 1, `${m} : ${k}`);
      }
  // midi clair : presque rien ; la nuit : sombre et bleutée ; le matin, les ombres portent vers l'ouest
  const midi = fx.ciel({ weather: 'soleil', hour: 13, light: 1 }, 'ete'), nuit = fx.ciel({ weather: 'soleil', hour: 22, light: 0.15 }, 'ete');
  assert.ok(midi.voile[3] < 0.08 && nuit.voile[3] > 0.3 && nuit.voile[2] > nuit.voile[0] && nuit.nuit === 1);
  assert.ok(fx.ciel({ hour: 7 }, 'ete').ombre.dx < 0 && fx.ciel({ hour: 18 }, 'ete').ombre.dx > 0);
  assert.ok(midi.ombre.dy < 0, 'à midi, le soleil au sud : les ombres vers le nord');
});
