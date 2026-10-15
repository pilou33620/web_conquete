// Banc d'essai de l'interface (web/js), sans navigateur : node --test tests/
//
// POURQUOI CE BANC EXISTE. L'interface ne se voit qu'en lançant le jeu, et un bouton d'ordre qui manque ou un import
// cassé (une fonction déplacée d'un fichier à l'autre) ne se remarque qu'en jouant. Ici chaque module est chargé, et
// les fonctions d'affichage reçoivent un état fabriqué à la main (comme celui que renvoie le serveur) : on vérifie le
// HTML produit. Ce qui est vérifié :
//  - tous les modules se chargent (imports et exports cohérents) ;
//  - les ordres proposés dépendent de l'arme (doctrine.js), dans le panneau du régiment (interface.js) ;
//  - la barre du tour : « Tour suivant », tour des IA, interruption (texte échappé), bataille en attente ;
//  - le tutoriel de la campagne (tuto.js) avance quand le joueur fait l'action demandée ; les bulles de situation
//    de la bataille ne s'affichent qu'une fois.
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
const { Tuto } = await charger('tuto.js');

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
  ui.rules = {};
  ui.st = { tour: { on: true, end: '1er avril 1790', ...tour }, battles: [], ...extra };
  ui.renderTurn();
  return dom.ids['tb-turn'].innerHTML;
}

test('barre du tour : votre tour', () => {
  const h = barre({ phase: 'ordres' });
  assert.ok(h.includes('Tour suivant') && h.includes('1er avril 1790'));
  assert.ok(!h.includes('disabled'));
  assert.ok(!h.includes('turn-pace'), 'plus de rythme : le tour des IA se calcule d’un coup');
});

test('barre du tour : tour des IA, puis interruption', () => {
  const run = barre({ phase: 'cours' });
  assert.ok(run.includes('Les IA jouent') && !run.includes('Arrêter'), 'le tour des IA se calcule d’un coup : rien à arrêter');
  const h = barre({ phase: 'arret', stop: { kind: 'bataille', text: 'Bataille <près> de Libourne', date: 'x', more: 0 } });
  assert.ok(h.includes('Continuer') && h.includes('&lt;près&gt;'), 'raison affichée, échappée');
});

test('durées en tours', async () => {
  const { toursTxt, partTour } = await charger('map.js');
  assert.equal(toursTxt(1), 'au prochain tour');
  assert.equal(toursTxt(3), 'dans 3 tours');
  assert.equal(toursTxt(0), 'ce tour-ci');
  assert.equal(partTour(6), '⅕ de tour', 'un régiment de 6 jours');
  assert.equal(partTour(15), '½ tour');
  assert.equal(partTour(30), '1 tour');
  assert.equal(partTour(32), '1 tour');
  assert.equal(partTour(75), '2 tours ½');
});

test('barre du tour : bloquée tant qu’une bataille attend votre choix', () => {
  const h = barre({ phase: 'ordres' }, { battles: [{ id: 'b1', mode: 'attente' }] });
  assert.ok(h.includes('disabled'));
});

// ------------------------------------------------------------------ tutoriel de la campagne
function campagne(tour = true) {
  const ui = Object.create(UI.prototype);
  for (const id of ['tuto', 'recap']) dom.ids[id] = element();
  ui.$ = id => dom.ids[id];
  ui.md = { nodes: [{ id: 0, name: 'Bordeaux', type: 'capitale', dept: '33', x: 10, y: 10 }] };
  ui.rules = { factions: { 33: { name: 'Gironde' }, 24: { name: 'Dordogne' } } };
  ui.map = { cam: { z: 4 }, moveTo() {} };
  ui.st = {
    me: { code: '33' }, nodes: { 0: { o: '33' } }, tour: { on: tour, phase: 'ordres' },
    armies: [{ id: 'a1', o: '33', x: 12, y: 12, st: 'idle' }, { id: 'e1', o: '24', x: 30, y: 30, st: 'idle' }],
  };
  ui.sel = null; ui.modal = null;
  ui.select = sel => { ui.sel = sel; ui.tuto.check(); };
  ui.tuto = new Tuto(ui);
  return ui;
}
const bulle = () => dom.ids.tuto.innerHTML;

test('tutoriel : avance quand le joueur fait l’action, pas avant', () => {
  localStorage.removeItem('conquete.tuto');
  const ui = campagne();
  assert.equal(Tuto.vu(), false);
  ui.tuto.start();
  assert.ok(bulle().includes('Bienvenue') && bulle().includes('tuto-next') && !dom.ids.tuto.hidden);
  ui.tuto.next();
  assert.ok(bulle().includes('vos armées') && !bulle().includes('tuto-next'), 'on attend le joueur : pas de « Suivant »');
  ui.sel = { kind: 'army', id: 'e1' }; ui.tuto.check();
  assert.equal(ui.tuto.i, 1, 'une armée ennemie ne compte pas');
  ui.sel = { kind: 'army', id: 'a1' }; ui.tuto.check();
  assert.equal(ui.tuto.i, 2, 'une de vos armées : étape suivante');
  ui.tuto.signal('recruit');
  assert.equal(ui.tuto.i, 2, 'un autre ordre ne compte pas');
  ui.tuto.signal('move');
  assert.ok(ui.tuto.i === 3 && bulle().includes('Bordeaux'));
  assert.equal(ui.sel, null, 'l’armée est désélectionnée : toucher la ville la choisit');
  ui.select({ kind: 'node', id: 0 });
  assert.ok(ui.tuto.i === 4 && bulle().includes('tuto-next'), 'la ville : « Suivant » même sans rien lever');
});

test('tutoriel : une fenêtre ouverte cache la bulle ; « Passer » le ferme pour de bon', () => {
  localStorage.removeItem('conquete.tuto');
  const ui = campagne();
  ui.tuto.start();
  ui.modal = 'event'; ui.tuto.check();
  assert.ok(dom.ids.tuto.hidden, 'une décision passe avant');
  ui.modal = null; ui.tuto.check();
  assert.ok(!dom.ids.tuto.hidden);
  ui.tuto.stop();
  assert.ok(dom.ids.tuto.hidden && Tuto.vu() && !ui.tuto.on);
});

test('tutoriel : en temps réel, pas d’étape « Tour suivant »', () => {
  const textes = tour => {
    const ui = campagne(tour), out = [];
    ui.tuto.start();
    while (ui.tuto.on) { out.push(bulle()); ui.tuto.i++; ui.tuto.check(); }
    return out.join('|');
  };
  assert.ok(textes(true).includes('Tour suivant') && textes(true).includes('/ 15'));
  assert.ok(!textes(false).includes('Tour suivant') && textes(false).includes('vitesses'));
});

test('bataille : la bulle de la cavalerie une seule fois', () => {
  localStorage.removeItem('conquete.bataille.aide.vues');
  const tip = element(); tip.hidden = true;
  const ui = Object.create(BattleUI.prototype);
  const cav = unite('cavalerie');
  ui.$ = s => (s === '.bt-tip' ? tip : null);
  ui.placeTip = () => {};
  ui.v = { st: { phase: 'combat' }, sel: new Set(['cavalerie']), units: new Map([['cavalerie', cav]]), mine: () => [cav] };
  ui.situ();
  assert.ok(!tip.hidden && tip.innerHTML.includes('Charger !'));
  tip.hidden = true;
  ui.situ();
  assert.ok(tip.hidden, 'déjà vue');
  ui.v.st.phase = 'deploiement'; ui.v.units.set('x', unite('ligne', { state: 'deroute' }));
  ui.v.mine = () => [cav, ui.v.units.get('x')];
  ui.situ();
  assert.ok(tip.hidden, 'rien pendant le déploiement');
  ui.v.st.phase = 'combat'; ui.situ();
  assert.ok(!tip.hidden && tip.innerHTML.includes('déroute'));
});
