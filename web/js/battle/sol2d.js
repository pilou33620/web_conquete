// Vue tactique : le sol à plat (SPEC-2D § 2, calque 1). La peinture du terrain (terrain.js) est découpée en tuiles de
// 512 px, par niveau de zoom (1, 2, 4… pixels par mètre, jusqu'au plus fin que permet la qualité), peintes à la
// demande et gardées tant que la mémoire le permet (les moins récemment vues partent d'abord, jamais une tuile à
// l'écran). Une tuile qui manque est remplacée, le temps d'être peinte, par une tuile plus grossière ou par l'image
// entière du terrain : pas de trou quand on glisse ou qu'on pince ; quelques tuiles seulement sont peintes par image.
// Tués, chevaux, débris et cratères sont peints une fois pour toutes dans les tuiles qu'ils touchent (et gardés pour
// les tuiles peintes plus tard) ; le piétinement (pietinement.js) est posé par-dessus, d'un seul tracé.
import { paintDecal, BASE } from './terrain.js';
import { canvas } from './formes.js';
import { profil } from './qualite.js';

export const TS = 512;          // côté d'une tuile (px)
const MARGE = 3;                // m : un tué ou un cratère déborde de son centre
const MAX_DECALS = 40000;       // gardés pour les tuiles à venir (au-delà, les plus anciens ne restent que peints)
const BUDGET = 8;               // ms de peinture de tuiles par image (au moins une tuile)
const FOND = '#4f7038';         // au-delà du champ

export class Sol2D {
  // terrain : Terrain (terrain.js) ; q : profil de qualité ; piet : Pietinement, posé sur le sol (facultatif)
  constructor(terrain, q, piet = null) {
    this.t = terrain; this.piet = piet;
    this.tiles = new Map();     // `L|i|j` → {cv, L, i, j, f} ; ordre : de la moins à la plus récemment vue
    this.spare = [];            // canevas libérés, repris pour la tuile suivante
    this.decals = [];
    this.frame = 0;
    this.setQuality(q);
  }
  setQuality(q) {
    this.q = q || profil();
    this.t.setQuality(this.q);
    // mémoire des tuiles : le double de celle des motifs (Basse 16 Mo… Ultra 96 Mo), 24 Mo au moins
    this.max = Math.max(24e6, (this.q.textures || 32e6) * 2);
    this.trim();
  }
  // pixels par mètre des tuiles pour k pixels d'écran par mètre : la puissance de 2 la plus proche (agrandie ou
  // réduite de 1,41 fois au plus), bornée par la qualité ; 0 : l'image entière suffit
  niveau(k) {
    const L = 2 ** Math.round(Math.log2(Math.max(k, 1e-6)));
    return L <= BASE ? 0 : Math.min(this.q.level || 16, L);
  }
  // dessine le sol ; renvoie le nombre de tuiles qui restent à peindre (0 : l'image est finie)
  draw(ctx, view) {
    const { z, dpr, vw, vh, cam } = view, t = this.t, k = z * dpr, f = ++this.frame;
    const ox = dpr * vw / 2 - cam.x * k, oy = dpr * vh / 2 - cam.y * k;
    const X = x => Math.round(x * k + ox), Y = y => Math.round(y * k + oy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = FOND; ctx.fillRect(0, 0, Math.ceil(vw * dpr), Math.ceil(vh * dpr));
    // (le rectangle vu, en mètres, borné au champ)
    const x0 = Math.max(0, cam.x - vw / 2 / z), x1 = Math.min(t.W, cam.x + vw / 2 / z);
    const y0 = Math.max(0, cam.y - vh / 2 / z), y1 = Math.min(t.H, cam.y + vh / 2 / z);
    if (x1 <= x0 || y1 <= y0) return 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(X(0), Y(0), X(t.W) - X(0), Y(t.H) - Y(0)); ctx.clip();
    const L = this.niveau(k);
    let left = 0;
    if (!L) this.blit(ctx, t.base, BASE, x0, y0, x1, y1, X, Y);
    else {
      const span = TS / L, i0 = Math.floor(x0 / span), i1 = Math.ceil(x1 / span), j0 = Math.floor(y0 / span), j1 = Math.ceil(y1 / span);
      // tuiles manquantes, les plus proches du centre d'abord, peintes tant que le budget le permet
      const miss = [];
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (!this.tiles.has(`${L}|${i}|${j}`)) miss.push([i, j, ((i + 0.5) * span - cam.x) ** 2 + ((j + 0.5) * span - cam.y) ** 2]);
      miss.sort((a, b) => a[2] - b[2]);
      const t0 = performance.now();
      let n = 0;
      for (const [i, j] of miss) { if (n && performance.now() - t0 > BUDGET) break; this.paintTile(L, i, j, f); n++; }
      left = miss.length - n;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const key = `${L}|${i}|${j}`, e = this.tiles.get(key), a = i * span, b = j * span;
        if (e) { this.touch(key, e, f); ctx.drawImage(e.cv, X(a), Y(b), X(a + span) - X(a), Y(b + span) - Y(b)); continue; }
        // repli : la tuile plus grossière qui la couvre, sinon l'image entière
        let done = false;
        for (let P = L / 2; P >= 1 && !done; P /= 2) {
          const ps = TS / P, pi = Math.floor(a / ps), pj = Math.floor(b / ps), pk = `${P}|${pi}|${pj}`, pe = this.tiles.get(pk);
          if (!pe) continue;
          this.touch(pk, pe, f);
          const sx = (a - pi * ps) * P, sy = (b - pj * ps) * P, sw = span * P;
          ctx.drawImage(pe.cv, sx, sy, sw, sw, X(a), Y(b), X(a + span) - X(a), Y(b + span) - Y(b));
          done = true;
        }
        if (!done) this.blit(ctx, t.base, BASE, Math.max(0, a), Math.max(0, b), Math.min(t.W, a + span), Math.min(t.H, b + span), X, Y);
      }
      this.trim();
    }
    // la terre foulée par les troupes
    const p = this.piet;
    if (p && p.canvas && p.version) ctx.drawImage(p.canvas, X(0), Y(0), X(p.w * p.res) - X(0), Y(p.h * p.res) - Y(0));
    ctx.restore();
    return left;
  }
  // une partie (x0…y1, en m) d'une image peinte à s px/m
  blit(ctx, img, s, x0, y0, x1, y1, X, Y) {
    const sx = Math.max(0, x0 * s), sy = Math.max(0, y0 * s), sw = Math.min(img.width, x1 * s) - sx, sh = Math.min(img.height, y1 * s) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, X(sx / s), Y(sy / s), X((sx + sw) / s) - X(sx / s), Y((sy + sh) / s) - Y(sy / s));
  }
  touch(key, e, f) { e.f = f; this.tiles.delete(key); this.tiles.set(key, e); }
  paintTile(L, i, j, f) {
    const span = TS / L, x0 = i * span, y0 = j * span;
    let cv = this.spare.pop();
    if (!cv) cv = canvas(TS, TS);
    this.t.paintInto(cv, x0, y0, span, span, L);
    const g = cv.getContext('2d');
    for (const d of this.decals) if (d.x > x0 - MARGE && d.x < x0 + span + MARGE && d.y > y0 - MARGE && d.y < y0 + span + MARGE) this.decal(g, d, L, x0, y0);
    this.tiles.set(`${L}|${i}|${j}`, { cv, L, i, j, f });
  }
  decal(g, d, L, x0, y0) { g.setTransform(L, 0, 0, L, -x0 * L, -y0 * L); paintDecal(g, d, L); }
  // libère les tuiles les moins récemment vues au-delà de la mémoire permise (jamais celles de l'image en cours)
  trim() {
    for (const [key, e] of this.tiles) {
      if (this.tiles.size * TS * TS * 4 <= this.max || e.f === this.frame) break;
      this.tiles.delete(key);
      if (this.spare.length < 2) this.spare.push(e.cv); else e.cv.width = e.cv.height = 0;   // (Safari garde sinon la mémoire)
    }
  }
  // tués, chevaux, débris, cratères ({x, y, k, …}, paintDecal) : ceux qui tombent sur le sol découvert sont peints
  // dans les tuiles déjà faites et dans l'image entière (les cratères seulement : le reste n'y ferait pas un pixel) ;
  // renvoie ceux qui ont été posés
  stamp(list) {
    const out = (list || []).filter(d => this.t.bare(d.x, d.y));
    if (!out.length) return out;
    for (const e of this.tiles.values()) {
      const span = TS / e.L, x0 = e.i * span, y0 = e.j * span;
      let g = null;
      for (const d of out) {
        if (d.x <= x0 - MARGE || d.x >= x0 + span + MARGE || d.y <= y0 - MARGE || d.y >= y0 + span + MARGE) continue;
        this.decal(g = g || e.cv.getContext('2d'), d, e.L, x0, y0);
      }
    }
    const bg = this.t.base.getContext('2d');
    for (const d of out) if (d.k === 'trou') this.decal(bg, d, BASE, 0, 0);
    this.decals.push(...out);
    if (this.decals.length > MAX_DECALS) this.decals.splice(0, this.decals.length - MAX_DECALS * 0.9);
    return out;
  }
  // une brèche, un incendie… : les tuiles qui touchent le cercle (x, y, r) seront repeintes
  invalidate(x, y, r) {
    for (const [key, e] of this.tiles) {
      const span = TS / e.L, x0 = e.i * span, y0 = e.j * span;
      if (x + r < x0 || x - r > x0 + span || y + r < y0 || y - r > y0 + span) continue;
      this.tiles.delete(key);
      if (this.spare.length < 2) this.spare.push(e.cv); else e.cv.width = e.cv.height = 0;
    }
  }
  dispose() {
    for (const e of this.tiles.values()) e.cv.width = e.cv.height = 0;
    for (const cv of this.spare) cv.width = cv.height = 0;
    this.tiles.clear(); this.spare = []; this.decals = [];
  }
}
