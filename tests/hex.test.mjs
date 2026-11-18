// Banc du rendu en plateau d'hexagones (web/js/hex, SPEC-HEX.md ; dessiné par le moteur web_engine) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plateau 3D et les calques 2D (vie, armées, interface) doivent tomber au même endroit : la
// grille doit retrouver l'hexagone sous un point, et la projection inclinée (K) doit faire l'aller-retour exact entre
// l'écran et le terrain, sinon un toucher choisirait le mauvais régiment ou la mauvaise ville sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grille, K, versEcran, versJeu } from '../web/js/hex/grille.js';
import { Niveau, MAXC, PAS, choisirPas, cadrer, couvre, fenetre, indexEn } from '../web/js/hex/carte-moteur.js';

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
  for (const [cx, cy] of [[30, 25], [0, 0], [59, 49], [33, 17]]) {
    const f = cadrer(N, cx, cy, 6, 5), C = fenetre(N, f);
    assert.equal(f.r0 % 2, 0);
    assert.equal(C.terrain.length, f.l * f.h);
    for (const ch of C.rivieres) for (const i of ch) assert.ok(i >= 0 && i < f.l * f.h && C.riviere[i] === 1);
    assert.ok(couvre(f, f.x0, f.x1, f.y0, f.y1));
  }
  for (const z of [0.5, 1, 3, 8, 30, 240]) { const c = choisirPas(1400, 900, z, K); assert.ok(c.l * c.h <= MAXC || c.pas === PAS[PAS.length - 1]); }
});
