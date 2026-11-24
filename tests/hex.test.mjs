// Banc du rendu en plateau d'hexagones (web/js/hex, SPEC-HEX.md ; dessiné par le moteur web_engine) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plateau 3D et les calques 2D (vie, armées, interface) doivent tomber au même endroit : la
// grille doit retrouver l'hexagone sous un point, et la projection inclinée (K) doit faire l'aller-retour exact entre
// l'écran et le terrain, sinon un toucher choisirait le mauvais régiment ou la mauvaise ville sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grille, K, versEcran, versJeu } from '../web/js/hex/grille.js';
import { Niveau, NIVEAUX, choisirPas, cadrer, couvre, fenetre, indexEn } from '../web/js/hex/carte-moteur.js';
import { PALIERS, Regulateur } from '../web/js/hex/qualite.js';

test('la grille retrouve l’hexagone sous chaque point', () => {
  const g = new Grille(272, 337, 4);
  for (let k = 0; k < 2000; k++) {
    const x = (k * 37.3) % 270 + 1, y = (k * 53.1) % 330 + 1, t = g.en(x, y);
    if (!t) continue;
    // le point est dans l'hexagone trouvé : au plus le rayon du centre, et plus près de lui que de tout voisin
    assert.ok(Math.hypot(t.gx - x, t.gy - y) <= g.RK + 1e-9);
    for (const v of g.voisins(t)) assert.ok(Math.hypot(t.gx - x, t.gy - y) <= Math.hypot(v.gx - x, v.gy - y) + 1e-9);
  }
  assert.equal(g.voisins(g.get(5, 5)).length, 6);
});

test('vue inclinée : aller-retour exact écran ↔ terrain', () => {
  const cam = { x: 120, y: 80, z: 7 };
  for (const [x, y] of [[0, 0], [120, 80], [200.5, 13.25]]) {
    const [sx, sy] = versEcran(cam, 1200, 800, x, y), [x2, y2] = versJeu(cam, 1200, 800, sx, sy);
    assert.ok(Math.abs(x2 - x) < 1e-9 && Math.abs(y2 - y) < 1e-9);
  }
  // le centre de la caméra est au centre de l'écran ; le sol est aplati de K sur la verticale
  assert.deepEqual(versEcran(cam, 1200, 800, 120, 80), [600, 400]);
  assert.ok(Math.abs(versEcran(cam, 1200, 800, 120, 90)[1] - (400 + 10 * 7 * K)) < 1e-9);
});

// La carte du moteur (carte-moteur.js) : le moteur web_engine bâtit toute sa carte d'un coup, sa grille décale les lignes
// impaires. Une fenêtre qui commencerait sur une ligne impaire décalerait tout le plateau d'un demi-hexagone sous les
// calques 2D, et une fenêtre trop grande gèlerait la page plusieurs secondes : rien ne planterait.
test('carte du moteur : indice d’hexagone, fenêtre alignée, taille bornée', () => {
  const g = new Grille(272, 337, 4);
  for (let k = 0; k < 500; k++) { const x = (k * 37.3) % 270 + 1, y = (k * 53.1) % 330 + 1, t = g.en(x, y); assert.equal(indexEn(g, x, y), t ? t.row * g.cols + t.col : -1); }
  // une carte de 60 × 50 km : mer à l'ouest, plaine à l'est, une forêt, une rivière d'ouest en est
  const W = 60, H = 50, terrain = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) terrain[j * W + i] = i < 15 ? 0 : i > 40 && j < 20 ? 3 : 2;
  const mp = { W, H, terrain, playable: new Uint8Array(W * H).fill(1), m: { rivers: [{ rank: 1, pts: [[20, 30], [58, 30]] }] } };
  const N = new Niveau(mp, 4);
  assert.equal(N.terrain[indexEn(N.g, 5, 25)], 0);          // la mer au large
  assert.equal(N.terrain[indexEn(N.g, 15, 25)] <= 1, true); // la côte (haut-fond) ou la mer
  assert.equal(N.foret[indexEn(N.g, 50, 8)], 1);
  assert.equal(N.riviere[indexEn(N.g, 40, 30)], 1);
  // un estuaire d'une case de large (y = 10, de la mer à x = 38) : effacé par la majorité, montré par son axe (de la mer
  // en hexagones de 4 cases, un ruban de fleuve plus loin)
  const estu = { ...mp, terrain: terrain.map((t, c) => c % W < 38 && ((c / W) | 0) === 10 ? 0 : t) };
  assert.ok(new Niveau(estu, 4).terrain[indexEn(N.g, 30, 10)] >= 3);
  estu.m = { ...mp.m, estuaires: [{ name: 'Gironde', pts: [[14, 10], [38, 10]] }] };
  const E4 = new Niveau(estu, 4), E8 = new Niveau(estu, 8), h8 = indexEn(E8.g, 37, 10);
  assert.ok(E4.estEau(indexEn(E4.g, 30, 10)) && E4.estEau(indexEn(E4.g, 37, 10)));
  assert.ok(!E8.estEau(h8) && E8.riviere[h8] === 1);
  estu.nodes = [{ x: 37, y: 10 }];   // le port du fond garde son hexagone
  assert.ok(!new Niveau(estu, 4).estEau(indexEn(E4.g, 37, 10)) && new Niveau(estu, 4).estEau(indexEn(E4.g, 30, 10)));
  for (const [cx, cy] of [[30, 25], [0, 0], [59, 49], [33, 17]]) {
    const f = cadrer(N, cx, cy, 6, 5), C = fenetre(N, f);
    assert.equal(f.r0 % 2, 0);
    assert.equal(C.terrain.length, f.l * f.h);
    for (const ch of C.rivieres) for (const i of ch) assert.ok(i >= 0 && i < f.l * f.h && C.riviere[i] === 1);
    assert.ok(couvre(f, f.x0, f.x1, f.y0, f.y1));
  }
  const dernier = NIVEAUX.findLastIndex(n => !n.sobre);
  for (const z of [0.5, 1, 3, 8, 30, 240]) { const c = choisirPas(1400, 900, z, K); assert.ok(c.l * c.h <= NIVEAUX[c.niv].max || c.niv === dernier); }
  // la qualité automatique allège la fenêtre (part < 1) : des hexagones plus grands plus tôt, jusqu'au niveau sobre ; jamais sans elle
  assert.equal(choisirPas(1400, 900, 0.5, K, 2607, 1254).pas, 16);
  assert.equal(choisirPas(1400, 900, 0.5, K, 2607, 1254, 0.3).pas, 32);
  assert.equal(choisirPas(1400, 900, 2.5, K, 272, 337, 0.3).pas, 8);
  // la géographie reste fine de loin : l'Aquitaine entière (272 × 337) en hexagones de 4, l'Europe entière (867 × 733) de 8
  assert.equal(choisirPas(1400, 900, 2.5, K, 272, 337).pas, 4);
  assert.equal(choisirPas(1400, 900, 1.25, K, 867, 733).pas, 8);
  assert.equal(choisirPas(1400, 900, 30, K, 867, 733).leger, false);
});

// qualité automatique (hex/qualite.js) : baisser quand les images se suivent lentement quelques secondes, remonter quand tout
// va bien assez longtemps, sans osciller ; un à-coup isolé (fenêtre rebâtie) ou un onglet caché ne comptent pas
test('qualité automatique : baisse, remonte, ne s’emballe pas', () => {
  const r = new Regulateur(), suite = (t0, ms, dt) => { let t = t0; for (; t < t0 + ms; t += dt) r.noter(t, dt); return t; };
  let t = suite(0, 2000, 30);
  assert.equal(r.palier, 0);
  t = suite(t, 12000, 6000);              // (des intervalles de plus de 5 s : onglet caché, ignorés)
  t = suite(t, 2000, 30);
  for (let k = 0; k < 6; k++) { r.noter(t, 400); t = suite(t + 400, 300, 30); }   // (à-coups isolés : la médiane reste bonne)
  assert.equal(r.palier, 0);
  t = suite(t, 2500, 80);                 // lent, moins longtemps que l'attente
  assert.equal(r.palier, 0);
  t = suite(t, 2000, 80);
  assert.equal(r.palier, 1);
  t = suite(t, 30000, 80);                // toujours lent : jusqu'au palier le plus sobre, pas au-delà
  assert.equal(r.palier, PALIERS.length - 1);
  t = suite(t, 9000, 33);
  assert.equal(r.palier, PALIERS.length - 1);
  t = suite(t, 4000, 33);                 // à l'aise dix secondes (sans compter le calme qui suit un changement) : un cran
  assert.equal(r.palier, PALIERS.length - 2);
  t = suite(t, 6000, 80);                 // la remontée ne tient pas : on redescend, et la prochaine attendra deux fois plus
  assert.equal(r.palier, PALIERS.length - 1);
  t = suite(t, 14000, 33);
  assert.equal(r.palier, PALIERS.length - 1);
  t = suite(t, 10000, 33);
  assert.equal(r.palier, PALIERS.length - 2);
  // un palier qui ne change rien sur l'appareil (sans ombres) est passé d'un coup, dans les deux sens
  const s = new Regulateur(); s.saute = new Set([1]);
  assert.equal(s.changer(0, 1), 2);
  assert.equal(s.changer(0, 1), 0);
});
