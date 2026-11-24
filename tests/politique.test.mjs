// Banc de la page de la politique intérieure (web/js/politique.js, SPEC-POLITIQUE P9) : node --test tests/
//
// POURQUOI CE BANC EXISTE. La fenêtre « Gouvernement » se lit dans un état que le moteur ne fabrique qu'au bout de
// révolutions et de guerres civiles : ici un état écrit à la main vérifie l'estimation de l'effet d'un impôt de classe,
// le camp rebelle inscrit parmi les camps de la page (nom, couleur), la fenêtre (postes, candidats, raisons, alerte qui
// renvoie à la fenêtre des décisions sans en doubler les choix) et le résumé d'un camp étranger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installer } from './dom.mjs';

installer();
const { Politique, estimeImpot } = await import('../web/js/politique.js');

const REGIMES = {
  absolue: { label: 'Monarchie absolue', desc: 'Le roi gouverne seul.', sensible: { noblesse: 1.6, peuple: 1.3 }, renvoi: 3 },
  republique: { label: 'République', desc: 'Des élections.', sensible: { noblesse: 0.9, peuple: 0.8 }, renvoi: 8 },
};
const ministre = (id, nom, traits = []) => ({ id, nom, competence: 4, traits, age: 50 });
const P = {
  regime: 'absolue', mandat: null, repit: 0, rebelles: 'FRr', revolutions: 1, guerres_civiles: 1,
  cabinet: { chef: ministre('m1', 'Jean <Duc>', ['populaire']), finances: null },
  candidats: [ministre('m9', 'Paul Neuf', ['integre'])],
  classes: {
    noblesse: { mecontentement: 30, impot: 0.2, cible: 10, mois: 0, etat: 'calme', raisons: [{ texte: 'Impôts', valeur: -33.6 }] },
    peuple: { mecontentement: 85, impot: 0.8, cible: 61, mois: 3, etat: 'revolution', raisons: [{ texte: 'Injustice fiscale', valeur: 9 }] },
  },
  seuils: { agitation: 55, emeute: 70, revolution: 80, mois: 4 },
};
function fausseUi() {
  const ui = {
    rules: {
      regimes: REGIMES, classes: { noblesse: { label: 'Noblesse', but: 'absolue' }, peuple: { label: 'Peuple', but: 'republique' } },
      postes: { chef: { label: 'Chef du gouvernement', desc: 'Ordre public.', fx: { order: 0.006 }, mec: -1 }, finances: { label: 'Finances', desc: 'Impôts.', fx: { livres: 0.012 }, mec: 0 } },
      ministre_traits: { populaire: { label: 'Populaire', desc: 'Peuple −5.' }, integre: { label: 'Intègre', desc: 'Ordre public +2 %.' } },
      factions: { FR: { name: 'Royaume de France', short: 'France', color: '#2b3d7a', capital: 'Paris', pros: [] } },
    },
    md: { nodes: { 7: { name: 'Lyon' } } }, map: { colors: { FR: '#2b3d7a' } },
    taxLabel: v => (v < 0.5 ? 'Légers' : 'Lourds'), toasts: [], toast(t) { this.toasts.push(t); },
    $: () => null,
  };
  ui.st = {
    year: 1790, names: { FR: 'Royaume de France', FRr: 'Royaume de France (républicains)' },
    me: { code: 'FR', tax: 0.5, politique: P },
    pending: [{ id: 'e1', ev: 'revolution', title: 'Révolution', choices: [] }],
    factions: [{ code: 'FR', nodes: 30 }, { code: 'FRr', nodes: 17, politique: { regime: 'republique', noblesse: 50, peuple: 20, rebelle: { de: 'FR', nom: 'Royaume de France (républicains)', couleur: '#c8423a', capitale: 7 } } }],
  };
  return ui;
}

test('effet attendu d’un impôt de classe : rendement et mécontentement visé (injustice fiscale comprise)', () => {
  const e = estimeImpot(P, REGIMES.absolue, 'peuple', 0.4);
  assert.equal(Math.round(e.rendement * 100), 84, 'impôt moyen 0,3 : 0,6 + 0,8 × 0,3');
  // peuple : −0,4 × 70 × 1,3 = −36,4 ; injustice (0,8 − 0,2) × 15 = 9 → (0,4 − 0,2) × 15 = 3
  assert.equal(Math.round(e.cibles.peuple * 10) / 10, Math.round((61 - 36.4 - 6) * 10) / 10);
  assert.equal(e.cibles.noblesse, 10, 'la noblesse ne bouge pas');
  assert.equal(estimeImpot(P, REGIMES.absolue, 'noblesse', 0).cibles.noblesse, 0, 'borné à 0');
});

test('le camp rebelle prend place parmi les camps : nom, couleur, capitale ; l’en-tête suit le joueur', () => {
  const ui = fausseUi(), pol = new Politique(ui);
  assert.equal(pol.camps(ui.st), true);
  const f = ui.rules.factions.FRr;
  assert.equal(f.name, 'Royaume de France (républicains)');
  assert.equal(f.color, '#c8423a');
  assert.equal(ui.map.colors.FRr, '#c8423a');
  assert.equal(f.capital, 'Lyon');
  assert.equal(f.title, 'Rebelles de France');
  assert.equal(pol.camps(ui.st), false, 'rien de neuf au relevé suivant');
  ui.st.me.code = 'FRr';
  assert.equal(pol.camps(ui.st), true, 'le joueur a pris la tête des rebelles');
});

test('fenêtre Gouvernement : régime, classes et raisons, cabinet, candidats ; la révolution renvoie à la fenêtre des décisions', () => {
  const ui = fausseUi(), pol = new Politique(ui);
  pol.camps(ui.st);
  let [h] = pol.modal();
  assert.ok(h.includes('Monarchie absolue') && h.includes('Ministres nommés à vie'));
  assert.ok(h.includes('Injustice fiscale') && h.includes('+9'));
  assert.ok(h.includes('data-pol-impot="peuple"') && h.includes('data-pol-impot="noblesse"'));
  assert.ok(h.includes('Jean &lt;Duc&gt;') && !h.includes('<Duc>'), 'noms échappés');
  assert.ok(h.includes('mécontentement du peuple +3'), 'renvoyer un ministre populaire fâche le peuple');
  assert.ok(h.includes('Ordre public +2,4 %'), 'effet du poste selon la compétence');
  assert.ok(h.includes('Poste vacant'));
  assert.ok(h.includes('data-act="modal" data-v="event"') && !h.includes('evchoice'), 'un seul chemin pour décider');
  assert.ok(h.includes('Royaume de France (républicains)</b> tient 17 places'));
  assert.ok(!h.includes('Paul Neuf'), 'candidats repliés');
  pol.poste = 'finances';
  [h] = pol.modal();
  assert.ok(h.includes('Paul Neuf') && h.includes('data-act="pol-nommer" data-v="finances" data-id="m9"'));
});

test('contexte d’une révolution dans la fenêtre des décisions, résumé d’un camp étranger', () => {
  const ui = fausseUi(), pol = new Politique(ui);
  pol.camps(ui.st);
  P.revolution = { classe: 'peuple', chance: 0.62, decision: 'revolution' };
  const c = pol.contexte({ ev: 'revolution' });
  assert.ok(c.includes('Chance de réprimer : <b>62 %</b>') && c.includes('guerre civile'));
  assert.equal(pol.contexte({ ev: 'grand_hiver' }), '');
  assert.ok(pol.contexte({ ev: 'guerre_civile' }).includes('Lyon'));
  const r = pol.resumeCamp(ui.st.factions[1]);
  assert.ok(r.includes('République') && r.includes('rebelles de France') && r.includes('peuple <span class="">20</span>'));
  assert.equal(pol.resumeCamp({ code: 'XX' }), '');
});
