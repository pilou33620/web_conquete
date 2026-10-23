// Banc d'essai de l'interface (web/js), sans navigateur : node --test tests/
//
// POURQUOI CE BANC EXISTE. L'interface ne se voit qu'en lançant le jeu, et un bouton d'ordre qui manque ou un import
// cassé (une fonction déplacée d'un fichier à l'autre) ne se remarque qu'en jouant. Ici chaque module est chargé, et
// les fonctions d'affichage reçoivent un état fabriqué à la main (comme celui que renvoie le serveur) : on vérifie le
// HTML produit. Ce qui est vérifié :
//  - tous les modules se chargent (imports et exports cohérents) ;
//  - la fiche du régiment inspecté pendant la bataille (interface.js) ;
//  - la barre du tour : « Tour suivant », tour des IA, interruption (texte échappé), bataille en attente ;
//  - le tutoriel de la campagne (tuto.js) avance quand le joueur fait l'action demandée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installer, element } from './dom.mjs';

const dom = installer();
const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const charger = f => import(pathToFileURL(join(JS, f)).href);

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
const a = (html, act) => html.includes(`data-a="${act}"`);

test('tous les modules se chargent', async () => {
  for (const dir of ['', 'battle']) {
    for (const f of readdirSync(join(JS, dir)).filter(f => f.endsWith('.js') && f !== 'main.js')) {
      await assert.doesNotReject(charger(join(dir, f)), `${dir}/${f}`);
    }
  }
});

// ------------------------------------------------------------------ panneau du régiment (bataille)
function panneau(us, st = { phase: 'combat' }, reglages = {}) {
  const ui = Object.assign(Object.create(BattleUI.prototype), reglages);
  const p = element();
  ui.$ = () => p;
  ui.el = element();
  ui.figure = () => {};
  ui.inspected = us[0].id;
  ui.v = { me: 0, units: new Map(us.map(u => [u.id, u])), st, setLos() {} };
  ui.renderPanel(true);
  return p.innerHTML;
}

test('fiche du régiment : nom échappé, pas d’ordres (vos officiers commandent)', () => {
  const h = panneau([unite('cavalerie', { name: '<b>Hussards</b>' })]);
  assert.ok(!h.includes('<b>Hussards</b>') && h.includes('&lt;b&gt;Hussards'), 'nom échappé');
  assert.ok(!a(h, 'charge') && !a(h, 'retreat') && a(h, 'los'));
  const e = panneau([unite('ligne', { side: 1 })]);
  assert.ok(e.includes('ennemi repéré') && !a(e, 'los'), 'un ennemi : ce qu’on en voit');
});

test('fiche du régiment : canons camouflés dans un bois', () => {
  assert.ok(panneau([unite('artillerie', { camo: 1 })]).includes('Camouflée dans le bois'));
  assert.ok(!panneau([unite('artillerie')]).includes('Camouflée'));
});

// valeurs chiffrées (valeurs.js, game/tactics/stats.py), à la manière d'Empire: Total War
const { valeursTable } = await charger('valeurs.js');
const VLIGNE = { mel: [32, 8, 0], chg: [15, 0, 0], pre: [32, 8, 0], rec: [68, -8, 0], por: [120, 230, null], mun: 60, vit: [1.2, 0, 0], dis: [40, 0, 0], car: [60, -12, 0] };

test('panneau : valeurs du régiment, repliées par défaut', () => {
  const ferme = panneau([unite('ligne', { stats: VLIGNE })]);
  assert.ok(a(ferme, 'valeurs') && ferme.includes('>Valeurs</button>') && !ferme.includes('Mêlée'), 'le bouton seulement');
  const h = panneau([unite('ligne', { stats: VLIGNE })], { phase: 'combat' }, { showVals: true });
  for (const x of ['Mêlée', '40', '+8', '60 s', '−8', '1,2', 'Discipline', '120 / 230 m', 'aria-expanded="true"']) assert.ok(h.includes(x), x);
  assert.ok(!h.includes('mitr.'), 'pas de mitraille pour un fusil');
  assert.ok(!panneau([unite('ligne')], { phase: 'combat' }, { showVals: true }).includes('class="vl"'), 'sans valeurs (ennemi, ancien serveur) : rien');
});

test('tableau des valeurs (campagne) : « — » quand l’arme n’a pas la valeur, noms échappés', () => {
  const h = valeursTable([['<i>Ligne</i>', VLIGNE], ['Artillerie', { mel: [11, 0, 0], pre: [37, 0, 0], rec: [94, 0, 0], por: [700, 1100, 280], mun: 120, vit: [1.5, 0, 0], dis: [40, 0, 5] }]]);
  assert.ok(h.includes('&lt;i&gt;Ligne') && !h.includes('<i>Ligne'));
  const art = h.split('<tr>').find(r => r.includes('Artillerie'));
  const cells = art.match(/<td[^>]*>(.*?)<\/td>/g);
  assert.equal(cells.length, 9, 'Troupe et huit colonnes (pas les munitions)');
  assert.equal(cells.at(-1), '<td>—</td>', 'pas de carré pour les canons');
  assert.equal(cells[2], '<td>—</td>', 'pas de charge pour les canons');
  assert.ok(/<td title="700 \/ 1.100 m · mitr\. 280">700 m<\/td>/.test(art), 'la portée efficace, le reste dans la bulle');
  assert.ok(art.includes('45<small class="vl-g"'), 'le général à part');
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

test('campagne : plus aucune durée en jours à l’écran (tour par tour)', () => {
  // relevé des textes de ui.js et map.js (la vitesse du temps réel et l'unité perU mises à part)
  const motifs = [/\d j\b/, /\} j\b/, /' j\b/, /\/j\b/, /par jour/, /jours de marche/, /\d+ jours/, /\} jours/];
  for (const f of ['ui.js', 'map.js']) {
    const lignes = readFileSync(join(JS, f), 'utf8').split('\n');
    lignes.forEach((l, i) => {
      if (/^\s*\/\//.test(l) || /speeds\[i\]|perU|'par jour'/.test(l)) return;
      for (const m of motifs) assert.ok(!m.test(l), `${f}:${i + 1} : ${l.trim().slice(0, 90)}`);
    });
  }
});

test('effets des bâtiments : par tour, ou par jour en temps réel', () => {
  const ui = Object.create(UI.prototype);
  ui.rules = { cities: { size_k: { ville: 1 } } };
  const L = { txt: '+3 livres /tour', txtj: '+0,1 livre /j', up: 0.01 };
  ui.st = { tour: { on: true } };
  assert.ok(ui.slotFx({ type: 'ville' }, L).includes('/tour') && !ui.slotFx({ type: 'ville' }, L).includes('/j'));
  ui.st = { tour: { on: false } };
  assert.ok(ui.slotFx({ type: 'ville' }, L).includes('/j') && !ui.slotFx({ type: 'ville' }, L).includes('/tour'));
});

test('barre du tour : bloquée tant qu’une bataille attend votre choix', () => {
  const h = barre({ phase: 'ordres' }, { battles: [{ id: 'b1', mode: 'attente' }] });
  assert.ok(h.includes('disabled'));
});

test('barre du tour : bloquée tant qu’une armée attend votre choix devant une ville', () => {
  const h = barre({ phase: 'ordres' }, { armies: [{ id: 'a1', ask: { n: 0, c: { manuel: '', auto: '', attendre: '' } } }] });
  assert.ok(h.includes('disabled'));
});

test('fenêtre d’arrivée devant une ville : les choix permis, les autres grisés avec leur raison', () => {
  const ui = Object.create(UI.prototype);
  ui.md = { nodes: [{ id: 0, name: '<Mérignac>' }] };
  ui.st = { armies: [{ id: 'a1', name: '1re Armée', ask: { n: 0, c: { ordres: '', auto: '', rallier: 'Armée trop faible <b>', attendre: '' } } }] };
  const [h] = ui.arriveeModal();
  assert.ok(h.includes('Devant &lt;Mérignac&gt;'), 'nom échappé');
  for (const v of ['ordres', 'auto', 'rallier', 'attendre']) assert.ok(h.includes(`data-act="arrive" data-id="a1" data-v="${v}"`), v);
  assert.ok(h.includes('Donner mes ordres') && h.includes('Résolution automatique') && !h.includes('Commander'));
  assert.ok(/data-v="rallier" disabled/.test(h) && h.includes('Armée trop faible &lt;b&gt;'), 'rallier grisé, avec sa raison (échappée)');
  assert.ok(!h.includes('data-v="assieger"'), 'un choix absent n’est pas proposé');
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

test('voie ferrée : la section du panneau de la ville (SPEC-TECH.md, phase 2a)', () => {
  const ui = Object.create(UI.prototype);
  ui.md = { nodes: [{ name: 'Bordeaux' }, { name: 'Langon' }, { name: 'La Teste' }, { name: 'Libourne' }],
    rails: { sections: [['0-1', 0, 1, [3], 41, 'Bordeaux–Sète', 1855], ['0-2', 0, 2, [4], 50, 'Bordeaux–La Teste', 1841], ['0-3', 0, 3, [5], 30, 'Paris–Bordeaux', 1852]] } };
  ui.rules = { res_label: { livres: 'Livres', fer: 'Fer', bois: 'Bois' } };
  ui.st = { me: { code: '33', res: { livres: 5000, fer: 900, bois: 900 } }, names: {},
    rails: { state: [['0-2', 'fait', 1, null], ['0-1', 'chantier', 0.4, '33']], open: [['0-3', { livres: 900, fer: 240, bois: 180 }, 3.5]], works: 1, max: 2 } };
  const h = ui.railHtml(0);
  assert.ok(h.includes('Voie ferrée') && h.includes('voie ouverte') && h.includes('width:40%'));
  assert.ok(h.includes('data-act="rail-build" data-v="0-3"') && h.includes('environ 4 tours'));
  assert.equal(ui.railHtml(9), '', 'une ville sans ligne : pas de section');
  ui.st.rails = null;
  assert.equal(ui.railHtml(0), '');
});

test('valeurs : la portée de justesse (demi-justesse D50 de l’arme), dans la fiche et dans le tableau', () => {
  const s = { ...VLIGNE, jus: 180 };
  const h = panneau([unite('ligne', { stats: s })], { phase: 'combat' }, { showVals: true });
  assert.ok(h.includes('Portée de justesse') && h.includes('>180 m<'), 'la ligne de la fiche');
  assert.ok(h.includes('bout portant'), 'la bulle de la Précision dit qu’elle vaut à bout portant');
  assert.ok(valeursTable([['Ligne', s]]).includes('<td>180 m</td>'), 'une colonne du tableau');
});

test('l’arbre des technologies : une case par technologie, un trait par prérequis de la même branche', async () => {
  const { arbrePlace, arbreHtml } = await charger('arbre.js');
  const T = (id, branch, req = [], cost = 100) => ({ id, branch, req, cost, days: 360, name: id, desc: '', year: 1800 });
  const techs = [T('a', 'inf'), T('b', 'inf', ['a']), T('c', 'inf', ['a', 'x']), T('d', 'inf', ['b', 'c']), T('e', 'inf', [], 50),
    T('x', 'ind')];
  const P = arbrePlace(techs, 'inf');
  assert.equal(P.cases.length, 5);
  assert.deepEqual(P.traits.sort(), [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']], 'pas de trait vers une autre branche');
  const at = Object.fromEntries(P.cases.map(c => [c.id, c]));
  assert.deepEqual([at.a.col, at.b.col, at.c.col, at.d.col, at.e.col], [0, 1, 1, 2, 0]);
  assert.equal(new Set(P.cases.map(c => `${c.col},${c.row}`)).size, 5, 'deux cases jamais au même endroit');
  const me = { techs: ['a'], research: { inf: null }, res: { livres: 1000 }, tech_dates: {} };
  const html = arbreHtml({ techs, branch: 'inf', labels: { inf: 'Inf', ind: 'Ind' }, me, year: 1700, sel: 'b', toursTxt: n => `${n}` });
  assert.equal((html.match(/data-act="techsel"/g) || []).length, 5);
  assert.equal((html.match(/<path /g) || []).length, 4);
  assert.match(html, /← x/, 'le prérequis d’une autre branche est écrit dans la case');
  assert.match(html, /data-act="research" data-v="b"/, 'la fiche de la case choisie a son bouton');
  assert.match(html, /100 ans d’avance/);
});
