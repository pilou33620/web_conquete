// Banc de la marine côté page (SPEC-EMPIRE, page P2) : node --test tests/
//
// POURQUOI CE BANC EXISTE. marine.js (web_engine) compte en indices de case de la fenêtre bâtie par le plateau, le jeu en
// cases [x, y] : une flotte traduite de travers mouillerait à terre ou à l'autre bout de la carte, un blocus se tournerait
// vers le mauvais port, sans que rien ne plante. Et la carte Monde envoie ses grilles compactées : un octet de travers
// dans le dépliage décalerait toute la carte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installer } from './dom.mjs';
import { Niveau, cadrer, indexEn } from '../web/js/hex/carte-moteur.js';
import { hexEau, trajetEau, numeros, etatMarine, mouvements, routesMer, scenesCommerce, versTheatre } from '../web/js/hex/marine.js';

installer();
const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const { deRle } = await import(pathToFileURL(join(JS, 'map.js')).href);

// une carte de 60 × 50 cases : la mer à l'ouest (x < 20), la terre à l'est ; un port (place 0) sur la côte
const W = 60, H = 50, terrain = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) terrain[j * W + i] = i < 20 ? 0 : 2;
const N = new Niveau({ W, H, terrain, playable: new Uint8Array(W * H).fill(1), m: { rivers: [] } }, 4);
const f = cadrer(N, 24, 25, 6, 6);   // (24 cases de large : la côte et le port, pas le large)
const local = k => { const c = k % N.g.cols - f.c0, r = ((k / N.g.cols) | 0) - f.r0; return k >= 0 && c >= 0 && r >= 0 && c < f.l && r < f.h ? r * f.l + c : -1; };
const md = { nodes: [{ id: 0, name: 'Port', x: 21, y: 25, spec: ['port'] }, { id: 1, name: 'Bourg', x: 40, y: 10, spec: [] }],
  comptoirs: [{ id: 'c1', nom: 'Comptoir', x: 5, y: 40, denree: 'sucre' }], sorties: [{ case: [1, 2], nom: 'vers l’Inde', route: 'r' }] };
const places = new Map([[0, indexEn(N.g, 22, 25)], [1, indexEn(N.g, 40, 10)]]);
const rules = { factions: { FR: { color: '#2f55b0' }, GB: { color: '#c8322c' } } };
const ctx = { N, local, places, md, rules, couleurs: {} };

test('une case de mer devient un hexagone d’eau de la fenêtre', () => {
  // au large : l'hexagone sous le centre de la case ; sur la côte (hexagone de terre), le voisin d'eau le plus proche
  assert.equal(hexEau(N, 5, 25), indexEn(N.g, 5.5, 25.5));
  const cote = hexEau(N, 20, 25);
  assert.ok(N.estEau(cote), 'la flotte mouille sur l’eau');
  const t = N.g.liste[cote];
  assert.ok(Math.hypot(t.gx - 20.5, t.gy - 25.5) < 5, 'près de sa case');
  assert.equal(hexEau(N, -10, 25), -1);
  // un chemin d'eau, d'un bout à l'autre, d'hexagones voisins
  const ch = trajetEau(N, hexEau(N, 2, 3), hexEau(N, 15, 45));
  assert.ok(ch.length > 5 && ch.every(h => N.estEau(h)));
  assert.equal(trajetEau(N, hexEau(N, 2, 3), indexEn(N.g, 50, 25)), null, 'pas de chemin d’eau jusqu’au cœur des terres');
});

test('camps, flottes, blocus, comptoirs et balises pour marine.js', () => {
  const ids = numeros(rules, 'GB');
  assert.equal(ids.get('GB'), 0, 'le joueur est le camp 0');
  assert.equal(ids.get('FR'), 1);
  assert.equal(ids.get('neutre'), 99);
  const st = { year: 1790, me: { code: 'GB', techs: [] }, nodes: [{ o: 'FR', sl: [['port', 2]] }, { o: 'FR', sl: [] }], armies: [],
    flottes: [{ id: 'f1', proprio: 'GB', case: [18, 25], navires: { fregate: 2 }, chemin: [[17, 25], [16, 25]], a_quai: null, armee: null, ordre: 'blocus' },
      { id: 'f2', proprio: 'FR', case: [2, 2], navires: { corvette: 1 }, chemin: [], a_quai: null, armee: null, ordre: '' }],
    blocus: [{ flotte: 'f1', ville: 0, lieu: [18, 25] }] };
  const e = etatMarine(st, ctx);
  assert.equal(e.epoque.cle, 'empire');
  assert.deepEqual(e.royaumes.map(r => [r.id, r.couleur, r.joueur]), [[0, '#c8322c', true], [1, '#2f55b0', false]]);
  // f1 dans la fenêtre, sur l'eau ; f2 hors de la fenêtre : pas montrée
  assert.deepEqual(e.flottes.map(x => x.id), ['f1']);
  const f1 = e.flottes[0];
  assert.equal(f1.case, local(hexEau(N, 18, 25)));
  assert.equal(f1.proprio, 0);
  assert.ok(f1.chemin.every(k => k >= 0 && k !== f1.case));
  // le port et son bâtiment (chaîne port) ; le blocus {flotte, ville, lieu} → {par, ville, case : l'hexagone de la place}
  assert.deepEqual(e.villes, [{ id: 0, case: local(places.get(0)) }]);
  assert.deepEqual(e.batiments.map(b => [b.cle, b.ville, b.proprio, b.reste]), [['port', 0, 1, 0]]);
  assert.deepEqual(e.blocus, [{ par: 0, ville: 0, case: local(places.get(0)) }]);
  // comptoir et balise hors de la fenêtre : rien
  assert.equal(e.comptoirs.length + e.sorties.length, 0);
  // une flotte cachée (scène de bataille navale)
  assert.equal(etatMarine(st, { ...ctx, masque: new Set(['f1']) }).flottes.length, 0);
  // l'écran de départ (sans joueur) : ni flotte ni blocus, les camps numérotés à partir de 1
  const d = etatMarine({ nodes: st.nodes }, { ...ctx, local: k => (k < 0 ? -1 : k) });
  assert.equal(d.flottes.length, 0);
  assert.ok(d.royaumes.every(r => r.id > 0));
  assert.equal(d.comptoirs[0].case, hexEau(N, 5, 40));
  assert.equal(d.sorties[0].nom, 'vers l’Inde');
});

test('le mois des flottes : un chemin d’eau de l’ancienne case à la nouvelle', () => {
  const st = c => ({ year: 1790, me: { code: 'GB', techs: [] }, nodes: [], armies: [], blocus: [],
    flottes: [{ id: 'f1', proprio: 'GB', case: c, navires: { fregate: 1 }, chemin: [], ordre: '' }] });
  const avant = etatMarine(st([18, 20]), ctx), apres = etatMarine(st([14, 28]), ctx);
  const mv = mouvements(new Map(avant.flottes.map(x => [x.id, x._h])), apres, N, local);
  assert.equal(mv.length, 1);
  assert.deepEqual([mv[0].flotte, mv[0].armee, mv[0].trajet[0], mv[0].trajet.at(-1)], [true, 'f1', avant.flottes[0].case, apres.flottes[0].case]);
  assert.equal(mouvements(new Map([['f1', apres.flottes[0]._h]]), apres, N, local).length, 0, 'immobile : rien à jouer');
});

test('une flotte qui sort de la fenêtre ou y entre suit son chemin jusqu’au bord (page P4)', () => {
  // la fenêtre du banc : x de 12 à 36 environ ; la mer s'arrête à x = 20. Une flotte part de la côte vers le large (x = 3)
  const st = c => ({ year: 1790, me: { code: 'GB', techs: [] }, nodes: [], armies: [], blocus: [],
    flottes: [{ id: 'f1', proprio: 'GB', case: c, navires: { fregate: 1 }, chemin: [], ordre: '' }] });
  const ici = etatMarine(st([18, 25]), ctx), loin = etatMarine(st([3, 25]), ctx);
  assert.deepEqual([ici.flottes.length, loin.flottes.length, loin.dehors.length], [1, 0, 1], 'au large : hors de la fenêtre, gardée dans dehors');
  const [s] = mouvements(new Map([['f1', ici.flottes[0]._h]]), loin, N, local, loin.dehors);
  assert.equal(s.trajet[0], ici.flottes[0].case, 'elle part de sa case');
  assert.equal(s.trajet.at(-1), -1, 'et finit hors de la fenêtre');
  assert.ok(s.trajet.slice(0, -1).every(k => k >= 0) && s.trajet.length > 2, 'par les hexagones de la fenêtre');
  assert.ok(s.sortie[0] < 0 && Math.abs(s.sortie[1]) <= Math.abs(s.sortie[0]), 'vers l’ouest');
  assert.equal(s.entree, undefined);
  // dans l'autre sens : elle paraît au bord ouest, puis gagne sa case
  const [e] = mouvements(new Map([['f1', loin.dehors[0]._h]]), ici, N, local, ici.dehors);
  assert.equal(e.trajet[0], -1);
  assert.equal(e.trajet.at(-1), ici.flottes[0].case);
  assert.ok(e.entree[0] < 0, 'elle vient de l’ouest');
  // dehors avant et après : rien (pas même de chemin cherché)
  assert.equal(mouvements(new Map([['f1', hexEau(N, 2, 2)]]), loin, N, local, loin.dehors).length, 0);
});

test('commerce : comptoirs de l’état, routes commerciales coupées par la fenêtre', () => {
  const tout = { ...ctx, local: k => (k < 0 ? -1 : k) };
  const st = { year: 1700, me: { code: 'GB', techs: [] }, nodes: [], armies: [], blocus: [], flottes: [],
    comptoirs: [{ id: 'c1', nom: 'Comptoir', case: [5, 40], denree: 'sucre', places: 3, navires: [{ flotte: 'f9', proprio: 'FR' }, { flotte: 'f8', proprio: 'GB' }], dispute: false }],
    routes_mer: [{ id: 'FR-GB', chemin: [[2, 2], [2, 3], [2, 4], [3, 8], [3, 12]], proprio: 'FR', partenaire: 'GB', coupee: 'corsaire' }] };
  const e = etatMarine(st, tout);
  // le comptoir de l'état (pas celui de la carte) : ses marchands, numérotés comme les camps
  assert.deepEqual(e.comptoirs, [{ id: 'c1', case: hexEau(N, 5, 40), denree: 'sucre', navires: [{ proprio: 1 }, { proprio: 0 }], dispute: false }]);
  // la route : des hexagones d'eau sans doublon à la suite, coupée (marine.js la dessine en rouge)
  assert.equal(e.routes_mer.length, 1);
  const r = e.routes_mer[0];
  assert.deepEqual([r.id, r.proprio, r.coupee], ['FR-GB#0', 1, 'corsaire']);
  assert.ok(r.chemin.length >= 2 && r.chemin.every((k, i) => N.estEau(k) && k !== r.chemin[i - 1]));
  // une route qui sort de la fenêtre et y revient : deux morceaux, aucun hexagone hors de la fenêtre
  const ici = (x, y) => (y >= 10 && y < 20 ? -1 : hexEau(N, x, y));
  const m = routesMer([{ id: 'r', proprio: 'FR', coupee: null, chemin: [[2, 2], [2, 6], [2, 15], [2, 25], [2, 30]] }], ici, () => 1);
  assert.deepEqual(m.map(x => [x.id, x.chemin.length]), [['r#0', 2], ['r#1', 2]]);
  assert.deepEqual(routesMer([{ id: 'r', chemin: [[2, 2]] }], ici, () => 1), [], 'un seul hexagone : rien');
  // hors de la fenêtre (ctx.local du banc) : ni comptoir, ni route
  const d = etatMarine(st, ctx);
  assert.equal(d.comptoirs.length + d.routes_mer.length, 0);
});

test('commerce : traversées de tous les camps (départs, arrivées, côté du théâtre) et abordage d’un corsaire', () => {
  // une carte Monde de deux théâtres : celui du banc (x < 60) et un autre à l'est (x de 60 à 120)
  const theatres = [{ id: 'europe', cadre: [0, 0, 60, 50] }, { id: 'inde', cadre: [60, 0, 60, 50] }];
  const routes_mer = [{ id: 'europe-inde', de: [3, 5], vers: [70, 20], tours: 2, nom: 'vers l’Inde' }, { id: 'inde-europe', de: [70, 20], vers: [3, 5], tours: 2, nom: 'vers l’Europe' }];
  const md2 = { ...md, theatres, routes_mer, sorties: [{ case: [3, 5], nom: 'vers l’Inde', route: 'europe-inde' }] };
  const tout = { ...ctx, local: k => (k < 0 ? -1 : k), md: md2 };
  assert.deepEqual(versTheatre(md2, [3, 5], [70, 20]), [87, 20], 'du centre de l’Inde vu de la balise');
  assert.equal(versTheatre(md, [3, 5], [70, 20]), null, 'sans théâtres (Aquitaine, Europe) : rien');
  const flotte = (id, c, o = 'GB') => ({ id, proprio: o, case: c, navires: { fregate: 1 }, chemin: [], ordre: '' });
  // la balise pointe vers l'Inde (sorties[].vers)
  const e0 = etatMarine({ year: 1700, me: { code: 'GB' }, nodes: [], armies: [], flottes: [] }, tout);
  assert.deepEqual(e0.sorties, [{ case: hexEau(N, 3, 5), nom: 'vers l’Inde', vers: [87, 20] }]);
  // en route vers la balise (ordre `route`, encore sur la carte) : marine.js ne doit pas la cacher
  const enRoute = etatMarine({ year: 1700, me: { code: 'GB' }, nodes: [], armies: [], flottes: [{ ...flotte('f1', [10, 10]), ordre: 'route' }] }, tout);
  assert.equal(enRoute.flottes[0].ordre, '');
  // partie, et on la voyait (ctx.partis : le départ de la vue) : sur la balise, ordre `route`, balise et côté du théâtre
  const dep = { id: 'f1', proprio: 'GB', case: [3, 5], route: 'europe-inde', navires: { fregate: 1 } };
  const st1 = { year: 1700, me: { code: 'GB' }, nodes: [], armies: [], flottes: [], departs: [dep] };
  const e1 = etatMarine(st1, { ...tout, partis: new Map([['f1', dep]]) });
  assert.deepEqual(e1.flottes.map(f => [f.id, f.ordre, f.case, f.sortie, f.vers]), [['f1', 'route', hexEau(N, 3, 5), hexEau(N, 3, 5), [87, 20]]]);
  assert.equal(etatMarine(st1, tout).flottes.length, 0, 'sans départ vu : rien');
  // partie sans qu'on la voie (une flotte ennemie) : le départ se joue depuis la balise (departFlotte), aux couleurs de son camp
  const ennemi = { ...dep, id: 'e1', proprio: 'FR', navires: { vaisseau: 2 } };
  assert.deepEqual(scenesCommerce(st1, e0, tout, { departs: [ennemi] }).departs,
    [{ case: hexEau(N, 3, 5), proprio: 1, navires: { vaisseau: 2 }, sortie: hexEau(N, 3, 5), vers: [87, 20], armee: 0 }]);
  assert.deepEqual(scenesCommerce(st1, e0, ctx, { departs: [ennemi] }).departs, [], 'balise hors de la fenêtre : rien');
  // arrivée (vue `arrivees`) : par la balise de sa case d'arrivée, du côté du théâtre d'où elle vient ; l'abordage : sur la
  // case de la route pillée la plus proche du corsaire, le marchand aux couleurs de la victime
  const st2 = { year: 1700, me: { code: 'GB' }, nodes: [], armies: [], flottes: [flotte('f2', [4, 44]), flotte('c1', [6, 20], 'FR')],
    arrivees: [{ id: 'f2', proprio: 'GB', case: [4, 44], route: 'inde-europe' }],
    routes_mer: [{ id: 'FR-GB', chemin: [[2, 2], [5, 21], [9, 30]], proprio: 'FR', partenaire: 'GB', coupee: 'corsaire' }],
    events: [{ kind: 'eco', corsaire: 'c1', route: 'FR-GB', victime: 'GB', text: '…' }, { kind: 'eco', text: 'autre' }] };
  const e2 = etatMarine(st2, tout), sc = scenesCommerce(st2, e2, tout, { arrivees: st2.arrivees });
  assert.deepEqual(sc.arrivees, [{ flotte: 'f2', sortie: hexEau(N, 4, 44), vers: [86, -19] }]);
  assert.deepEqual(sc.abordages, [{ flotte: 'c1', case: hexEau(N, 5, 21), proprio: 0 }]);
  assert.deepEqual(scenesCommerce({ ...st2, events: [] }, e2, tout), { arrivees: [], abordages: [], departs: [] });
});

test('les grilles compactées de la carte Monde se déplient (geo.rs rle)', () => {
  const b = s => Uint8Array.from(Buffer.from(s, 'base64'));
  // (les mêmes octets que tests/monde.rs grilles_compactees)
  assert.deepEqual([...deRle(b('AAMFAgcB'), 6)], [0, 0, 0, 5, 5, 7]);
  assert.deepEqual([...deRle(b('AMgB'), 200)], new Array(200).fill(0));
  assert.deepEqual([...deRle(b('AQICAAAB'), 3, 2)], [1, 2, 1, 2, 0, 0]);
});
