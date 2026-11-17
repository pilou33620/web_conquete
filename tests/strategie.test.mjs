// La bataille par stratégie côté page (SPEC-BATAILLE.md) : ce qui n'est pas du simple affichage.
//  - strategie.js : la stratégie présélectionnée, le résultat d'une bataille (battle_end), l'aperçu avant d'attaquer ;
//  - carte/combat.js : le nombre de figures de la petite scène d'après les effectifs par arme, le déroulé des phases
//    (rejouées d'après le journal, ou d'un coup en mouvement réduit), la place de la trace devant une ville.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installer } from './dom.mjs';

installer();
const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const charger = f => import(pathToFileURL(join(JS, f)).href);
const { stratChoisie, resultatHtml, apercuHtml } = await charger('strategie.js');
const { figurines, derouler, phaseA, lieuTrace, PAS } = await charger('carte/combat.js');

const C = {
  me: '33', names: {}, nodes: [{ id: 0, name: 'Blaye' }],
  rules: { factions: { 33: { name: 'Gironde', color: '#2f55b0' }, 24: { name: 'Dordogne', color: '#c8322c' } },
    armes: { inf: 'Infanterie', cav: 'Cavalerie', art: 'Artillerie', tir: 'Tirailleurs', grenadiers: 'Grenadiers' },
    phases: { fusillade: 'Fusillade' }, strats: { prep: { label: 'Préparation d’artillerie' }, tenir: { label: 'Tenir la ligne' } },
    situations: { ville: { label: 'Ville', att: 'Attaque de ville', def: 'Défense de ville', desc: '' } } },
};

test('stratégie présélectionnée : celle qu’on a touchée, sinon celle du général, jamais une stratégie refusée', () => {
  const b = { choix: [{ id: 'frontal', why: '' }, { id: 'prep', why: '' }, { id: 'colonnes', why: 'Découverte requise' }], defaut: 'prep' };
  assert.equal(stratChoisie(b, null), 'prep');
  assert.equal(stratChoisie(b, 'frontal'), 'frontal');
  assert.equal(stratChoisie(b, 'colonnes'), 'prep', 'une stratégie grisée ne se choisit pas');
  assert.equal(stratChoisie({ choix: b.choix, defaut: 'colonnes' }, null), 'frontal', 'le choix du général est refusé : la première permise');
  assert.equal(stratChoisie({ choix: [{ id: 'x', why: 'non' }] }, null), null);
});

test('résultat d’une bataille : pertes, prisonniers, prises, sort des généraux, stratégies, journal', () => {
  const h = resultatHtml(C, { seq: 5, win: true, a: '33', d: '24', la: 12, ld: 340, node: 0, sit: 'ville', w: 0, repli: false, strats: ['prep', 'tenir'], poursuite: true,
    prisonniers: 45, prises: { drapeaux: 1, canons: 8 }, generaux: [[1, '<Duroc>', 'pris']], x: 1, y: 2,
    journal: [{ ph: 'fusillade', l: [10, 200], p: [{}, {}], w: [{ c: 0, t: 'Infanterie : avantage à Gironde' }] }], pese: [{ c: 0, t: '« Préparation » contre « Tenir » (+20 %)' }] });
  for (const t of ['Victoire — Blaye', '340', 'Prisonniers', '1 drapeau, 8 canons', '&lt;Duroc&gt; (Dordogne) : fait prisonnier', 'Préparation d’artillerie', 'Tenir la ligne', 'Fusillade', 'Ce qui a pesé', 'le vainqueur poursuit'])
    assert.ok(h.includes(t), t);
  assert.ok(resultatHtml(C, { win: false, repli: true, a: '24', d: '33', la: 1, ld: 2, w: 0 }).includes('Retraite'));
});

test('aperçu avant d’attaquer : rapport de forces, mot, effectifs ; « estimé » sans renseignement sûr', () => {
  const r = { ok: true, ratio: 1.67, mot: 'avantage', sit: 'ville', terrain: 'Plaine', moi: { men: 740, armes: { inf: 300, cav: 200, tir: 240 } }, lui: { men: 400, armes: { inf: 400 } }, sur: false };
  const h = apercuHtml(C, r, '24');
  assert.ok(h.includes('1,7 contre 1') && h.includes('avantage') && h.includes('estimé') && h.includes('Attaque de ville') && h.includes('Plaine') && h.includes('Dordogne'));
  assert.ok(!apercuHtml(C, { ...r, sur: true }, '24').includes('estimé'));
  assert.equal(apercuHtml(C, { ok: false }, '24'), '');
});

test('la petite scène : des figures à proportion des armes, jamais une grande armée', () => {
  assert.deepEqual(figurines({ inf: 300, cav: 200, art: 0, tir: 240, grenadiers: 0 }), { inf: 3, gren: 0, tir: 1, cav: 1, art: 0 });
  const g = figurines({ inf: 6000, cav: 900, art: 300, tir: 800, grenadiers: 2000 });
  assert.deepEqual(g, { inf: 8, gren: 2, tir: 2, cav: 2, art: 1 }, 'huit fantassins au plus, dont les grenadiers à leur part');
  assert.equal(figurines({}, 80).inf, 3, 'une milice sans détail : trois hommes');
  assert.equal(figurines({}, 0).inf, 0);
});

test('le déroulé : les phases du journal l’une après l’autre, puis la fin ; d’un coup en mouvement réduit', () => {
  const s = derouler([], ['escarmouche', 'canonnade', 'fusillade'], 10, true);
  assert.deepEqual(s.map(e => e.ph), ['escarmouche', 'canonnade', 'fusillade', 'fin']);
  assert.equal(phaseA(s, 9).ph, null, 'avant : les lignes attendent');
  assert.equal(phaseA(s, 10 + PAS * 1.5).ph, 'canonnade');
  assert.equal(phaseA(s, 10 + PAS * 3 + 1).ph, 'fin');
  assert.ok(Math.abs(phaseA(s, 10 + PAS * 3 + 1).av - 1) < 1e-9);
  derouler(s, ['escarmouche', 'charge'], 11, true);
  assert.equal(s.length, 5, 'une phase déjà montrée ne se rejoue pas ; une seule fin');
  assert.equal(phaseA(derouler([], ['escarmouche', 'fusillade'], 3, true, true), 3).ph, 'fin', 'image fixe : tout de suite la fin');
});

test('la trace d’une bataille devant une place se pose hors de ses murs', () => {
  assert.deepEqual(lieuTrace(100, 50, 0), [100, 50]);
  const [x, y] = lieuTrace(100, 50, 2);
  assert.ok(Math.hypot(x - 100, y - 50) > 2, 'au-delà du rayon de la place');
});
