// Vue tactique : ce que voit une unité (mode « ligne de vue », SPEC-SUITE F6, à la manière d'UGAR). La même règle
// que le moteur (game/tactics/battle.py, los) : les crêtes coupent le regard ; bois, bâti, murs et vergers le
// bouchent peu à peu quand il passe sous leur faîte ; les deux cases au bord de chaque bout ne comptent pas (une
// troupe en lisière voit dehors). Les haies (couche à part dans le moteur) ne sont pas prises : le mode est une aide
// à la lecture, l'arbitre reste le serveur. Logique pure, sans Three.js : tests/visibilite.test.mjs.

// par sorte de case (formes.js, CELL_NAMES, dans l'ordre du moteur) : opacité en centièmes, cumulée le long du
// regard, et hauteur (m) de ce qui bouche la vue (un regard qui passe au-dessus n'est pas gêné)
export const OPACITE = [0, 0, 0, 0, 34, 60, 0, 0, 0, 0, 0, 50, 100, 0, 100, 0, 0, 0, 14];
export const FAITE = [0, 0, 0, 0, 12, 16, 0, 0, 0, 0, 0, 8, 7, 0, 7, 0, 0, 0, 5];
export const OEIL = 2.5;   // hauteur d'un fantassin (m) ; ce qui est vu est pris à la même hauteur

// g : {cols, rows, t, h} (cases et altitudes, en m) ; c1, c2 : cases ; eye1, eye2 : hauteurs aux deux bouts
export function ligneDeVue(g, c1, c2, eye1 = OEIL, eye2 = OEIL) {
  const { cols, t, h } = g;
  if (c2 < c1) { [c1, c2] = [c2, c1]; [eye1, eye2] = [eye2, eye1]; }
  const i1 = c1 % cols, j1 = (c1 / cols) | 0, i2 = c2 % cols, j2 = (c2 / cols) | 0;
  const n = Math.max(Math.abs(i2 - i1), Math.abs(j2 - j1));
  if (n <= 2) return true;
  const z1 = h[c1] + eye1, dz = (h[c2] + eye2 - z1) / n, di = (i2 - i1) / n, dj = (j2 - j1) / n;
  let op = 0;
  for (let s = 1; s < n; s++) {
    const c = Math.floor(j1 + dj * s + 0.5) * cols + Math.floor(i1 + di * s + 0.5);
    const clear = z1 + dz * s - h[c];
    if (clear < -0.5) return false;
    if (s > 2 && s < n - 2) {
      const tc = t[c];
      if (OPACITE[tc] && clear < FAITE[tc]) { op += OPACITE[tc]; if (op >= 100) return false; }
    }
  }
  return true;
}

// toutes les cases vues depuis la case c0 (hauteur eye), jusqu'à portee cases : 1 vue, 0 cachée (hors de portée : 0)
export function champDeVision(g, c0, eye = OEIL, portee = 80) {
  const { cols, rows } = g, out = new Uint8Array(cols * rows);
  const i0 = c0 % cols, j0 = (c0 / cols) | 0;
  for (let j = Math.max(0, j0 - portee); j <= Math.min(rows - 1, j0 + portee); j++) {
    for (let i = Math.max(0, i0 - portee); i <= Math.min(cols - 1, i0 + portee); i++) {
      if ((i - i0) ** 2 + (j - j0) ** 2 > portee * portee) continue;
      const c = j * cols + i;
      out[c] = ligneDeVue(g, c0, c, eye, OEIL) ? 1 : 0;
    }
  }
  return out;
}
