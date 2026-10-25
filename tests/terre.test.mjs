// Banc de la terre de la carte vue du ciel (web/js/carte/terre.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les tuiles se peignent chacune à part, dans plusieurs workers : tout ce qui y est tiré au
// sort doit venir de la grille absolue de la carte, sinon une parcelle ou un bois change d'une tuile à sa voisine
// (couture). Les saisons changent les cultures, la neige suit le relief ; on vérifie ces règles sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { solSaison, neigeAu, SEUIL_NEIGE, parcelles, hash2, Terre, TT } = await import('../web/js/carte/terre.js');
const { hash } = await import('../web/js/map.js').catch(() => ({ hash: null }));
const { AMB } = await import('../web/js/carte/ambiance.js');

test('les cultures de la saison : blé en herbe au printemps, chaume moissonné l’été, labour l’hiver', () => {
  assert.equal(solSaison('chaume', 'printemps', 0.3), 'ble_vert');
  assert.equal(solSaison('chaume', 'ete', 0.3), 'moisson');
  assert.equal(solSaison('pre', 'ete', 0.3), 'pre_sec');
  assert.equal(solSaison('pre', 'printemps', 0.3), 'pre');   // (sans changement, la culture reste)
  assert.equal(solSaison('pre', 'hiver', 0.3), 'pre_hiver');
  for (let k = 0; k < 50; k++) {
    const h = k / 50;
    assert.ok(['labour_hiver', 'ble_hiver'].includes(solSaison('labour', 'hiver', h)));
    assert.ok(['labour_frais', 'chaume', 'ble_hiver'].includes(solSaison('ble', 'automne', h)));
  }
  // un tirage donne toujours la même culture
  assert.equal(solSaison('colza', 'printemps', 0.42), solSaison('colza', 'printemps', 0.42));
});

test('la neige : rien en plaine hors des chutes, les sommets blancs l’hiver, plus haut l’été', () => {
  for (const s of ['printemps', 'ete', 'automne', 'hiver']) assert.equal(neigeAu(0.1, 50, 50, s, false), 0);
  assert.equal(neigeAu(1.6, 120, 300, 'hiver', false), 1);
  assert.ok(SEUIL_NEIGE.ete > SEUIL_NEIGE.printemps && SEUIL_NEIGE.printemps > SEUIL_NEIGE.hiver);
  assert.ok(neigeAu(1.2, 120, 300, 'ete', false) < neigeAu(1.2, 120, 300, 'hiver', false));
  // quand il neige, la plaine blanchit
  assert.ok(neigeAu(0.1, 50, 50, 'hiver', true) > 0.3);
});

test('la limite des neiges ne fait pas de damier : d’un point voisin à l’autre, elle bouge à peine', () => {
  // (un bruit fin hachurait la limite ; seuls des bruits lents la font onduler)
  let pire = 0;
  for (let x = 100; x < 130; x += 0.05) {
    const a = neigeAu(1.0, x, 300, 'hiver', false), b = neigeAu(1.0, x + 0.05, 300, 'hiver', false);
    pire = Math.max(pire, Math.abs(a - b));
  }
  assert.ok(pire < 0.05, `saut de ${pire}`);
});

test('les parcelles viennent de la grille absolue : deux tuiles voisines voient les mêmes', () => {
  const tout = new Map(), parTuile = [];
  parcelles(0, 0, 8, 8, (x, y, w, h, hh, r, k) => tout.set(r + ':' + k, [x, y, w, h, hh]));
  for (const [x0, y0] of [[0, 0], [4, 0], [0, 4], [4, 4]]) parcelles(x0, y0, x0 + 4, y0 + 4, (x, y, w, h, hh, r, k) => parTuile.push([r + ':' + k, x, y, w, h, hh]));
  for (const [id, ...p] of parTuile) assert.deepEqual(p, tout.get(id), id);
  // des briques : pas de chevauchement dans un rang, des largeurs variées, rien de calé sur la grille du jeu
  const rangs = new Map();
  for (const [id, [x, , w]] of tout) { const r = id.split(':')[0]; (rangs.get(r) || rangs.set(r, []).get(r)).push([x, w]); }
  const largeurs = new Set();
  for (const l of rangs.values()) {
    l.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < l.length; i++) assert.ok(Math.abs(l[i][0] - (l[i - 1][0] + l[i - 1][1])) < 1e-9, 'trou ou chevauchement');
    for (const [, w] of l) { assert.ok(w > 0.2 && w < 1.6, `largeur ${w}`); largeurs.add(w.toFixed(2)); }
  }
  assert.ok(largeurs.size > 20);
});

test('le même hachage que la carte (map.js hash)', { skip: !hash }, () => {
  for (const [i, j, k] of [[0, 0, 0], [12, -7, 3], [500, 900, 41]]) assert.equal(hash2(i, j, k), hash(i, j, k));
});

test('la grille : les mêmes couleurs pour un même point, quelle que soit la tuile qui le demande', () => {
  const W = 40, H = 40, terrain = new Uint8Array(W * H).fill(TT.PLAINE);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (i < 8) terrain[j * W + i] = TT.OCEAN; else if (i > 25 && j > 20) terrain[j * W + i] = TT.FORET;
  const T = new Terre({ W, H, terrain, m: { x_cote: 8, waters: [] } });
  AMB.saison = 'printemps';
  const pas = 3 / 64, n = 30, a = new Uint8ClampedArray(n * n * 4), b = new Uint8ClampedArray(n * n * 4), ta = new Uint8Array(n * n), tb = new Uint8Array(n * n);
  const gi = Math.floor(9 / pas), gj = Math.floor(20 / pas);
  T.grille(gi, gj, n, pas, a, ta);
  T.grille(gi + 10, gj + 5, n, pas, b, tb);   // une tuile décalée de 10 et 5 points
  for (let j = 0; j < n - 5; j++) for (let i = 0; i < n - 10; i++) {
    const p = ((j + 5) * n + i + 10) * 4, q = (j * n + i) * 4;
    assert.deepEqual([...a.subarray(p, p + 4)], [...b.subarray(q, q + 4)]);
  }
  // la mer à l'ouest, le sable au bord, des champs ensuite
  const c = new Uint8ClampedArray(4 * 400), tc = new Uint8Array(400);
  T.grille(Math.floor(6 / 0.25), Math.floor(10 / 0.25), 20, 0.25, c, tc);
  assert.equal(tc[0], TT.OCEAN);
  assert.equal(tc[19], TT.PLAINE);
});

test('famine et disette : la campagne autour de la place passe en friche, et les tuiles se repeignent', async () => {
  const { majAmbiance, enDisette, cleTuiles } = await import('../web/js/carte/ambiance.js');
  const map = { nodes: [{ id: 0, x: 10, y: 10, type: 'ville' }, { id: 1, x: 50, y: 50, type: 'village' }] };
  const st = { season: 'printemps', weather: {}, me: { code: '33', famine: false }, nodes: [{ o: '33' }, { o: '24', lv: ['disette', 12] }] };
  majAmbiance(map, st);
  assert.ok(enDisette(51, 50) && !enDisette(10, 10), 'la disette du village, pas encore la ville');
  const avant = cleTuiles();
  st.me.famine = true;
  assert.equal(majAmbiance(map, st), true, 'la famine du joueur repeint les tuiles');
  assert.notEqual(cleTuiles(), avant);
  assert.ok(enDisette(13, 10) && !enDisette(15, 10), 'ses places à lui, sur 4,5 km autour d’une ville');
});

test('crue et feux des Landes : les prés au bord du fleuve sous l’eau, la pinède brûlée l’été ; les tuiles se repeignent', async () => {
  const { majAmbiance, cleTuiles, brule, feuDe, FEU_K } = await import('../web/js/carte/ambiance.js');
  const W = 60, H = 40, terrain = new Uint8Array(W * H).fill(TT.PLAINE);
  // la Garonne d'ouest en est à y = 20, une petite rivière à y = 5 ; des collines au nord-est
  for (let j = 0; j < 12; j++) for (let i = 40; i < W; i++) terrain[j * W + i] = TT.COLLINES;
  const T = new Terre({ W, H, terrain, m: { x_cote: 8, waters: [], rivers: [{ name: 'Garonne', rank: 1, pts: [[0, 20], [60, 20]] }, { name: 'Isle', rank: 2, pts: [[0, 5], [60, 5]] }] } });
  const map = { nodes: [] }, st = { season: 'printemps', date: '15 mai 1790', year: 1790, weather: { interieur: { kind: 'soleil' }, cote: { kind: 'soleil' } }, nodes: [] };
  majAmbiance(map, st);
  assert.equal(T.inonde(30, 20.3), false, 'en mai, les eaux sont rentrées');
  const avant = cleTuiles();
  st.weather.interieur.kind = 'pluie';
  assert.equal(majAmbiance(map, st), false, 'une averse ne repeint pas les tuiles');
  st.date = '15 avril 1790';
  assert.equal(majAmbiance(map, st), true, 'les hautes eaux d’avril font déborder les fleuves : tuiles repeintes');
  assert.notEqual(cleTuiles(), avant);
  let noyes = 0;
  for (let x = 1; x < 59; x += 0.5) { if (T.inonde(x, 20.4)) noyes++; assert.equal(T.inonde(x, 23.5), false, 'loin du fleuve, au sec'); assert.equal(T.inonde(x, 5.2), false, 'seulement la Garonne et la Dordogne'); }
  assert.ok(noyes > 50, `la plupart des prés du bord sont sous l’eau (${noyes} points sur 116)`);
  const n = 8, c = new Uint8ClampedArray(n * n * 4), tg = new Uint8Array(n * n);
  T.grille(Math.floor(30 / 0.05), Math.floor(20.1 / 0.05), n, 0.05, c, tg);
  assert.ok(tg.some(t => t === TT.EAU), 'ni parcelle ni arbre dans le pré noyé');
  st.season = 'ete'; st.date = '15 juillet 1790'; st.weather.interieur.kind = 'pluie'; majAmbiance(map, st);
  assert.equal(AMB.crue, false, 'l’été, la pluie ne fait pas de crue');
  st.flood = true; majAmbiance(map, st);
  assert.equal(AMB.crue, true, 'la crue de l’état (flood), si');
  // les feux : mêmes feux pour la même année, rien avant juin ni après octobre, noir au cœur
  let f = null, I = 0, J = 0;
  for (I = 0; I < 40 && !f; I++) for (J = 0; J < 40 && !f; J++) f = feuDe(I, J, 1790);
  assert.ok(f, 'des feux cette année-là');
  assert.deepEqual(feuDe(I - 1, J - 1, 1790), f);
  assert.ok(f.m >= 5 && f.m <= 7 && f.r >= 0.5 && f.r <= 1.6 && Math.floor(f.x / FEU_K) === I - 1);
  assert.equal(brule(f.x, f.y, 1790, f.m), 1, 'le mois du feu, le cœur brûlé');
  assert.equal(brule(f.x, f.y, 1790, 10), 1, 'encore noir en novembre');
  assert.equal(brule(f.x, f.y, 1790, f.m - 1), 0, 'pas avant');
  assert.equal(brule(f.x, f.y, 1790, 11), 0, 'en décembre, la lande a reverdi');
  assert.equal(brule(f.x + 5, f.y + 5, 1790, f.m), 0, 'loin du feu, rien');
  st.date = '15 juin 1790'; majAmbiance(map, st); const k6 = cleTuiles();
  st.date = '15 juillet 1790'; assert.equal(majAmbiance(map, st), true, 'chaque mois d’été, de nouveaux brûlis : tuiles repeintes');
  st.date = '15 décembre 1790'; st.season = 'hiver'; majAmbiance(map, st);
  assert.ok(!cleTuiles().includes('1790-'), 'l’hiver, plus de brûlis dans la clé'); assert.notEqual(cleTuiles(), k6);
  st.date = '15 avril 1790'; st.season = 'printemps'; st.flood = false; st.weather.interieur.kind = 'soleil'; majAmbiance(map, st);
});
