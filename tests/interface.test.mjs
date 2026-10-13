// Banc d'essai de l'interface (web/js), sans navigateur : node --test tests/
//
// POURQUOI CE BANC EXISTE. L'interface ne se voit qu'en lançant le jeu, et un bouton d'ordre qui manque ou un import
// cassé (une fonction déplacée d'un fichier à l'autre) ne se remarque qu'en jouant. Ici chaque module est chargé, et
// les fonctions d'affichage reçoivent un état fabriqué à la main (comme celui que renvoie le serveur) : on vérifie le
// HTML produit. Ce qui est vérifié :
//  - tous les modules se chargent (imports et exports cohérents) ;
//  - les ordres proposés dépendent de l'arme (doctrine.js), dans le panneau du régiment (interface.js) ;
//  - la barre du tour : « Tour suivant », tour des IA, interruption (texte échappé), bataille en attente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installer, element } from './dom.mjs';

const dom = installer();
const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const charger = f => import(pathToFileURL(join(JS, f)).href);

const { ordresHtml, arme } = await charger('battle/doctrine.js');
const { UI } = await charger('ui.js');
const { BattleUI } = await charger('battle/interface.js');

// unités comme les envoie le serveur (units.py, to_client)
const unite = (type, extra = {}) => ({
  id: type, type, side: 0, name: `Régiment ${type}`, men: 600, men0: 600, morale: 70, fat: 10, xp: 20, ammo: 50, ammo0: 60,
  range: [120, 230], state: 'repos', form: type === 'artillerie' ? 'batterie' : 'ligne', fire: 'free',
  cls: { cavalerie: 'cavalerie', artillerie: 'artillerie', general: 'general' }[type] || 'inf',
  light: type === 'legere' || type === 'chasseurs', ...extra,
});
const ordres = us => { const o = ordresHtml(us, { targeting: null, run: false }); return o.top + o.btns; };
const a = (html, act) => html.includes(`data-a="${act}"`);

test('tous les modules se chargent', async () => {
  for (const dir of ['', 'battle']) {
    for (const f of readdirSync(join(JS, dir)).filter(f => f.endsWith('.js') && f !== 'main.js')) {
      await assert.doesNotReject(charger(join(dir, f)), `${dir}/${f}`);
    }
  }
});

test('ordres de l’infanterie de ligne et des grenadiers', () => {
  for (const t of ['ligne', 'grenadiers']) {
    const h = ordres([unite(t)]);
    assert.ok(a(h, 'vcharge') && a(h, 'charge'), `${t} : salve + baïonnette et baïonnette`);
    assert.ok(h.includes('data-m="volley"'), `${t} : feu de salve`);
    assert.ok(!a(h, 'harass') && !a(h, 'pursue'), `${t} : ni harcèlement ni poursuite`);
  }
});

test('ordres des tirailleurs', () => {
  const h = ordres([unite('legere')]);
  assert.equal(arme(unite('legere')), 'tirailleurs');
  assert.ok(a(h, 'harass') && a(h, 'cover'));
  assert.ok(!h.includes('data-m="volley"') && !a(h, 'vcharge'), 'pas de salve');
});

test('ordres de la cavalerie : la charge, pas le feu', () => {
  const h = ordres([unite('cavalerie')]);
  assert.ok(a(h, 'charge') && h.includes('Charger !') && a(h, 'pursue'));
  assert.ok(!a(h, 'fire') && !a(h, 'vcharge') && !a(h, 'harass'));
});

test('ordres de l’artillerie', () => {
  const h = ordres([unite('artillerie')]);
  assert.ok(a(h, 'shot') && h.includes('data-m="mitraille"') && a(h, 'counter'));
  assert.ok(!a(h, 'charge'));
});

test('sélection mêlée : seulement les ordres communs', () => {
  const h = ordres([unite('ligne'), unite('cavalerie')]);
  assert.ok(a(h, 'hold'));
  assert.ok(!a(h, 'vcharge') && !a(h, 'pursue') && !a(h, 'fire'));
});

// ------------------------------------------------------------------ panneau du régiment (bataille)
function panneau(us, st = { phase: 'combat' }) {
  const ui = Object.create(BattleUI.prototype);
  const p = element();
  ui.$ = () => p;
  ui.el = element();
  ui.figure = () => {};
  ui.v = { sel: new Set(us.map(u => u.id)), units: new Map(us.map(u => [u.id, u])), st, controls: { targeting: null, run: false }, mine: () => us };
  ui.renderPanel(true);
  return p.innerHTML;
}

test('panneau : ordres de la cavalerie, nom échappé', () => {
  const h = panneau([unite('cavalerie', { name: '<b>Hussards</b>' })]);
  assert.ok(h.includes('Charger !') && a(h, 'retreat'));
  assert.ok(!h.includes('<b>Hussards</b>') && h.includes('&lt;b&gt;Hussards'), 'nom échappé');
});

test('panneau : pas d’ordres de combat pendant le déploiement', () => {
  const h = panneau([unite('ligne')], { phase: 'deploiement' });
  assert.ok(h.includes('Pivoter') && !a(h, 'vcharge'));
});

// ------------------------------------------------------------------ barre du tour (campagne)
function barre(tour, extra = {}) {
  const ui = Object.create(UI.prototype);
  dom.ids['tb-turn'] = element();
  dom.ids['tb-speed'] = element();
  ui.$ = id => dom.ids[id];
  ui.renderRecap = () => {};
  ui.rules = { paces: [['lent', 'Lent', 30], ['normal', 'Normal', 15], ['rapide', 'Rapide', 8], ['eclair', 'Éclair', 4]] };
  ui.st = { tour: { on: true, pace: 'normal', end: '1er avril 1790', ...tour }, battles: [], ...extra };
  ui.renderTurn();
  return dom.ids['tb-turn'].innerHTML;
}

test('barre du tour : votre tour', () => {
  const h = barre({ phase: 'ordres' });
  assert.ok(h.includes('Tour suivant') && h.includes('1er avril 1790'));
  assert.ok(!h.includes('disabled'));
});

test('barre du tour : tour des IA, puis interruption', () => {
  assert.ok(barre({ phase: 'cours' }).includes('Arrêter'));
  const h = barre({ phase: 'arret', stop: { kind: 'bataille', text: 'Bataille <près> de Libourne', date: 'x', more: 0 } });
  assert.ok(h.includes('Continuer') && h.includes('&lt;près&gt;'), 'raison affichée, échappée');
});

test('barre du tour : bloquée tant qu’une bataille attend votre choix', () => {
  const h = barre({ phase: 'ordres' }, { battles: [{ id: 'b1', mode: 'attente' }] });
  assert.ok(h.includes('disabled'));
});
