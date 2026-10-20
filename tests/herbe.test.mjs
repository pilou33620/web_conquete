// Banc de l'herbe en relief (web/js/battle/herbe.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque touffe coûte sept triangles, et elles sont des dizaines de milliers : un réglage
// trop généreux ferait tomber l'iPad sous 30 images par seconde sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERBE, cote } from '../web/js/battle/herbe.js';
import { PROFILS } from '../web/js/battle/qualite.js';

test('pas d’herbe en relief en Basse ni en Moyenne', () => {
  assert.equal(HERBE[PROFILS.basse.herbe], null);
  assert.equal(HERBE[PROFILS.moyenne.herbe], null);
});

test('budget : au plus 60 000 touffes en Haute (iPad), 120 000 en Ultra', () => {
  const n = q => cote(HERBE[PROFILS[q].herbe]) ** 2;
  assert.ok(n('haute') <= 60000, `${n('haute')}`);
  assert.ok(n('ultra') <= 120000, `${n('ultra')}`);
  assert.ok(n('ultra') > n('haute'));
});
