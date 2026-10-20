// Banc de la table des heures et de l'étalonnage (web/js/battle/heures.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Toute la lumière des batailles et la LUT de l'après-rendu sortent de cette table. Une
// heure mal rangée, un saut entre deux lignes, ou un étalonnage qui sort de [0, 1] ferait clignoter l'image quand
// l'horloge tourne, ou la noircirait sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEURES, METEO, ligne, heureEffective, etalonnage, grade, lut, cleEtalonnage, ambiance } from '../web/js/battle/heures.js';

const NEUTRE = { expo: 1, temp: 0, sat: 1, vert: 0, contrast: 1, lift: [0, 0, 0], gain: [1, 1, 1], vig: 0 };

test('la table est rangée de 5 h à 22 h, chaque ligne complète', () => {
  assert.equal(HEURES[0].he, 5); assert.equal(HEURES.at(-1).he, 22);
  for (let i = 1; i < HEURES.length; i++) assert.ok(HEURES[i].he > HEURES[i - 1].he, `ligne ${i}`);
  const cles = Object.keys(HEURES[0].g).sort().join();
  for (const r of HEURES) assert.equal(Object.keys(r.g).sort().join(), cles, `étalonnage de ${r.he} h`);
});

test('un étalonnage neutre ne change pas les couleurs', () => {
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.6, 0.3], [0.9, 0.4, 0.1]]) {
    const o = grade(...c, NEUTRE);
    c.forEach((v, i) => assert.ok(Math.abs(o[i] - v) < 1e-9, `${c} → ${o}`));
  }
});

test('pas de saut quand l’heure tourne : deux instants à une minute d’écart se ressemblent', () => {
  for (let h = 5; h < 22; h += 1 / 60) {
    const a = ligne(h), b = ligne(h + 1 / 60);
    assert.ok(Math.abs(a.sunI - b.sunI) < 0.01 && Math.abs(a.g.sat - b.g.sat) < 0.01 && Math.abs(a.fog[0] - b.fog[0]) < 2, `${h.toFixed(2)} h`);
  }
});

test('le crépuscule suit la lumière du serveur, sans saut quand elle commence à baisser', () => {
  assert.equal(heureEffective(10, 1), 10);
  assert.equal(heureEffective(19, 1), 17.5, 'plein jour jusqu’à 17 h 30');
  assert.ok(Math.abs(heureEffective(15, 0.999) - 15) < 0.05);
  assert.equal(heureEffective(15, 0.15), 21, 'la nuit');
  let prev = 0;
  for (let L = 1; L >= 0.15; L -= 0.05) { const he = heureEffective(16, L); assert.ok(he >= prev); prev = he; }
});

test('l’étalonnage reste dans [0, 1] et la LUT est complète, à toute heure et par tous les temps', () => {
  for (const w of Object.keys(METEO)) for (let h = 5; h <= 22; h += 0.5) {
    const G = etalonnage(h, w);
    for (const c of [[0, 0, 0], [1, 1, 1], [0, 1, 0], [0.3, 0.5, 0.2]]) for (const v of grade(...c, G)) assert.ok(v >= 0 && v <= 1 && !Number.isNaN(v), `${w} ${h} h`);
  }
  const L = lut(etalonnage(13, 'soleil'), 8);
  assert.equal(L.length, 8 * 8 * 8 * 4);
  assert.ok(L.every((v, i) => i % 4 !== 3 || v === 255));
});

test('midi au soleil : verts tirés vers le jaune, ombres bleutées ; la nuit, une image froide', () => {
  const midi = etalonnage(13, 'soleil');
  const herbe = grade(0.3, 0.55, 0.2, midi);
  assert.ok(herbe[0] / herbe[1] > 0.3 / 0.55, 'le vert tire vers le jaune');
  const ombre = grade(0.05, 0.05, 0.05, midi);
  assert.ok(ombre[2] > ombre[0], 'les ombres sont bleutées');
  const nuit = grade(0.5, 0.5, 0.5, etalonnage(21.5, 'soleil'));
  assert.ok(nuit[2] > nuit[0], 'la nuit est bleue');
  assert.ok(etalonnage(13, 'pluie').sat < midi.sat && etalonnage(13, 'pluie').vig > midi.vig, 'la pluie éteint les couleurs et assombrit les bords');
});

test('la clé ne change que si l’étalonnage change', () => {
  assert.equal(cleEtalonnage(etalonnage(13, 'soleil')), cleEtalonnage(etalonnage(13.0001, 'soleil')));
  assert.notEqual(cleEtalonnage(etalonnage(13, 'soleil')), cleEtalonnage(etalonnage(19, 'soleil')));
});

test('ambiance : soleil bas et doré le soir, plus haut l’été, brume du temps qu’il fait', () => {
  const soir = ambiance({ weather: 'soleil', light: 0.85, hour: 19 }, 'ete'), midi = ambiance({ weather: 'soleil', light: 1, hour: 13 }, 'ete');
  assert.ok(soir.sunDir[1] < midi.sunDir[1]);
  assert.ok(soir.sun[2] < midi.sun[2], 'le soir, le soleil est plus jaune');
  assert.ok(ambiance({ hour: 13 }, 'ete').sunDir[1] > ambiance({ hour: 13 }, 'hiver').sunDir[1]);
  assert.ok(ambiance({ weather: 'pluie', hour: 13 }, 'ete').fog[0] < midi.fog[0]);
  assert.equal(ambiance({ weather: 'pluie', hour: 13 }, 'ete', { clouds: false }).cloudA, 0);
});
