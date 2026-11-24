// Banc de la diplomatie profonde côté page (SPEC-POLITIQUE, page P10) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le moteur lit une proposition composée du point de vue de celui qui la fait (il donne
// `donner`, demande `recevoir`) : la page qui l'afficherait telle quelle au joueur lui ferait accepter l'inverse de ce
// qu'il croit. Et une clause envoyée avec un champ en texte, ou un champ de trop, est refusée par le moteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installer } from './dom.mjs';

installer();
const { Diplomatie, couleurAttitude, raisonsTriees, clausePourMoteur, vuJoueur } = await import('../web/js/diplomatie.js');

const CLAUSES = {
  region: { nom: 'Région', desc: '', champs: ['node'] }, technologie: { nom: 'Technologie', desc: '', champs: ['tech'] },
  argent: { nom: 'Argent', desc: '', champs: ['montant'] }, tribut: { nom: 'Tribut', desc: '', champs: ['montant', 'tours'] },
  passage: { nom: 'Droit de passage', desc: '', champs: [] }, commerce: { nom: 'Accord commercial', desc: '', champs: [], mutuelle: true },
  alliance: { nom: 'Alliance', desc: '', champs: [], mutuelle: true }, paix: { nom: 'Paix', desc: '', champs: [], mutuelle: true },
  protectorat: { nom: 'Protectorat', desc: '', champs: [] }, independance: { nom: 'Indépendance', desc: '', champs: [] },
  cartes: { nom: 'Cartes', desc: '', champs: [] },
};
const fac = (code, o = {}) => ({ code, alive: true, st: 'paix', power: 1000, wars: [], nodes: 3, techs: 2, ...o });
function ui(factions, proposals = []) {
  return {
    rules: { CLAUSES, CARACTERES: { marchand: { nom: 'Marchand', desc: 'L’argent le convainc.' } }, regimes: {}, techs: [],
      factions: { '33': { name: 'Gironde', color: '#00f' }, '24': { name: 'Dordogne', color: '#0f0' }, '47': { name: 'Lot-et-Garonne', color: '#f0f' } } },
    md: { nodes: [{ id: 0, name: 'Bazas', type: 'ville', dept: '33' }, { id: 1, name: 'Agen', type: 'capitale', dept: '47' }] },
    st: { me: { code: '33', techs: [] }, factions, proposals, nodes: [{ id: 0, o: '33' }, { id: 1, o: '47' }] },
    proposalHtml: () => '',
  };
}

test('attitude : couleur et raisons triées', () => {
  assert.equal(couleurAttitude(0), 'rgb(107,106,92)');
  assert.equal(couleurAttitude(-100), 'rgb(168,57,45)');
  assert.equal(couleurAttitude(250), 'rgb(95,154,78)', 'bornée');
  const l = raisonsTriees({ raisons: [{ texte: 'a', valeur: -12 }, { texte: 'b', valeur: 10 }, { texte: 'c', valeur: 2 }] });
  assert.deepEqual(l.map(r => r.texte), ['b', 'c', 'a']);
  assert.deepEqual(raisonsTriees(undefined), []);
});

test('une clause part vers le moteur avec ses seuls champs, en nombres', () => {
  assert.deepEqual(clausePourMoteur({ type: 'tribut', montant: '20', tours: 12.4, node: 3 }, CLAUSES), { type: 'tribut', montant: 20, tours: 12 });
  assert.deepEqual(clausePourMoteur({ type: 'technologie', tech: 'canons' }, CLAUSES), { type: 'technologie', tech: 'canons' });
  assert.deepEqual(clausePourMoteur({ type: 'alliance' }, CLAUSES), { type: 'alliance' });
});

test('une proposition reçue se lit du côté du joueur', () => {
  const p = { id: 'p1', frm: '47', action: 'proposition', contre_proposition: true,
    clauses: { donner: [{ type: 'region', node: 1, texte: 'Agen' }], recevoir: [{ type: 'argent', montant: 900, texte: '900 livres' }] } };
  assert.deepEqual(vuJoueur(p).recoit.map(c => c.texte), ['Agen']);
  const d = new Diplomatie(ui([fac('33'), fac('47')], [p]));
  const h = d.recueHtml(p);
  assert.match(h, /contre-proposition/);
  assert.ok(h.indexOf('Vous recevez') < h.indexOf('Agen') && h.indexOf('Agen') < h.indexOf('Vous donnez') && h.indexOf('Vous donnez') < h.indexOf('900 livres'));
  assert.match(h, /data-act="dp-rep" data-id="p1" data-v="1"/);
  assert.equal(d.recueHtml({ id: 'p2', frm: '47', action: 'alliance' }), null, 'une action d’avant reste à ui.js');
});

test('ultimatum et appel aux armes : la menace et ce qu’on perd à refuser', () => {
  const d = new Diplomatie(ui([fac('33', { power: 800 }), fac('47', { power: 2000 })]));
  const u = d.recueHtml({ id: 'u', frm: '47', action: 'ultimatum', exigence: { type: 'region', node: 0 } });
  assert.match(u, /Il exige Bazas/);
  assert.match(u, /casus belli/);
  assert.match(u, /2\s000 \(vous 800\)/);
  const a = d.recueHtml({ id: 'a', frm: '24', action: 'appel', contre: '47' });
  assert.match(a, /Contre <b>Lot-et-Garonne/);
  assert.match(a, /alliance peut se rompre/);
  assert.ok(d.urgent({ proposals: [{ action: 'appel' }] }) && !d.urgent({ proposals: [{ action: 'paix' }] }));
});

test('fiche, clauses possibles et protectorats', () => {
  const att = { valeur: 23, raisons: [{ texte: 'Relations', valeur: 5 }, { texte: 'Un diplomate à notre cour', valeur: 10 }] };
  // le joueur protégé par le Lot-et-Garonne
  const d = new Diplomatie(ui([fac('33', { over: '47' }), fac('47', { caractere: 'marchand', attitude: att }), fac('24', { st: 'guerre' })]));
  const f = d.fac('47');
  const h = d.ficheHtml(f, true);
  assert.match(h, /Marchand/);
  assert.match(h, /\+23/);
  assert.ok(h.indexOf('Un diplomate') < h.indexOf('Relations'), 'raisons triées');
  assert.match(h, /Votre protecteur/);
  assert.match(d.protectoratsHtml(), /Demander l’indépendance/);
  assert.ok(d.typesPossibles(f, 'recevoir').includes('independance'));
  assert.ok(!d.typesPossibles(f, 'donner').includes('independance'));
  assert.ok(!d.typesPossibles(f, 'donner').includes('paix'), 'pas de paix sans guerre');
  assert.ok(d.typesPossibles(d.fac('24'), 'donner').includes('paix'));
  assert.equal(d.boutonsHtml(d.fac('24')), '', 'un protectorat ne traite qu’avec son protecteur');
  assert.deepEqual(d.places('47'), [], 'pas de chef-lieu à céder');
  assert.deepEqual(d.places('33'), [0]);
});
