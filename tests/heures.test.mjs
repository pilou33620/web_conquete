// Banc de la table des heures (web/js/battle/heures.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Toute la lumière des batailles (effets.js, ciel) sort de cette table. Une heure mal
// rangée ou un saut entre deux lignes ferait clignoter l'image quand l'horloge tourne, sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEURES, ligne, heureEffective } from '../web/js/battle/heures.js';

test('la table est rangée de 5 h à 22 h, chaque ligne complète', () => {
  assert.equal(HEURES[0].he, 5); assert.equal(HEURES.at(-1).he, 22);
  for (let i = 1; i < HEURES.length; i++) assert.ok(HEURES[i].he > HEURES[i - 1].he, `ligne ${i}`);
  const cles = Object.keys(HEURES[0].g).sort().join();
  for (const r of HEURES) assert.equal(Object.keys(r.g).sort().join(), cles, `étalonnage de ${r.he} h`);
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
