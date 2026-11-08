// Banc de l'interface de la religion et des révoltes (SPEC-RELIGION.md, décisions 24 à 28) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les bandes armées et la politique religieuse ne paraissent qu'au bout de mois de jeu : ici,
// les fonctions d'affichage du panneau de ville et du panneau Production reçoivent un état fabriqué à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installer } from './dom.mjs';

installer();
const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const { UI } = await import(pathToFileURL(join(JS, 'ui.js')).href);

function ui(st) {
  const u = Object.create(UI.prototype);
  u.rules = { factions: { 33: { name: 'Gironde' }, 24: { name: 'Dordogne' } },
    revoltes: { genres: { rebelles: 'insurgés', brigands: 'brigands', partisans: 'partisans' },
      soutien: { livres: 150, armes: 50 }, lever: { livres: 120, armes: 40 }, lever_n: 250 } };
  u.st = st;
  return u;
}
const etat = (st24 = 'paix', res = { livres: 1000, armes: 500 }) => ({ me: { code: '33', res }, factions: [{ code: '24', st: st24 }, { code: '33', st: 'self' }] });

test('confession des places', () => {
  const u = ui(etat());
  assert.equal(u.confession(undefined), 'catholique');
  assert.equal(u.confession(0.6), 'protestante, 60 % de réformés');
  assert.equal(u.confession(0.3), 'mixte, 30 % de réformés');
});

test('bande qui vous vise : apaiser ; chez un ennemi : soutenir', () => {
  const b = { id: 'b9', k: 'rebelles', n: 400, c: '33', sp: null, why: 'affamée', nom: 'la jacquerie de Bazas', prix: 320 };
  let h = ui(etat()).bandeHtml({ dept: '33' }, { o: '33', bd: b }, '33');
  assert.match(h, /La jacquerie de Bazas : 400 insurgés, contre Gironde \(population affamée\)/);
  assert.match(h, /data-v="apaiser" data-id="b9" >Apaiser/);
  assert.doesNotMatch(h, /soutenir/);
  h = ui(etat('guerre')).bandeHtml({ dept: '24' }, { o: '24', bd: { ...b, c: '24' } }, '33');
  assert.match(h, /data-v="soutenir"/);
  h = ui(etat('paix')).bandeHtml({ dept: '24' }, { o: '24', bd: { ...b, c: '24' } }, '33');
  assert.doesNotMatch(h, /data-act/, 'pas de soutien sans guerre');
  h = ui(etat('guerre', { livres: 10, armes: 0 })).bandeHtml({ dept: '33' }, { o: '33', bd: { ...b, k: 'brigands' } }, '33');
  assert.match(h, /disabled>Amnistier/);
});

test('lever des partisans dans une place d’origine occupée', () => {
  const h = ui(etat('guerre')).bandeHtml({ dept: '33' }, { o: '24' }, '33');
  assert.match(h, /data-v="lever"/);
  assert.equal(ui(etat('paix')).bandeHtml({ dept: '33' }, { o: '24' }, '33'), '');
});

test('politique religieuse dans le panneau Production', () => {
  const c = { k: 'contrainte', nom: 'Contrainte', options: [['tolerance', 'Tolérance', 'Chacun prie.'], ['contrainte', 'Contrainte', 'Réformés −15 %.']],
    ref: 4200, part: 0.12, lib: '1er mars 1701' };
  const h = ui(etat()).culteHtml(c);
  assert.match(h, /<option value="contrainte" selected>Contrainte/);
  assert.match(h, /Réformés −15 %/);
  assert.match(h, /disabled/);
  assert.match(h, /12 % des habitants/);
  assert.equal(ui(etat()).culteHtml(null), '');
});
