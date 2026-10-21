// La carte qui change avec les siècles (SPEC-SUITE, partie H ; SPEC-TECH, phases 2b à 2d), dans le style de la carte
// de campagne : chaque camp montre ce que ses technologies ont changé (rules.VISUALS, envoyées dans l'état : mk).
//   2b, l'industrie : tours Chappe aux bras mobiles près des villes, puis poteaux et fil le long des routes royales ;
//       cheminées d'usine qui fument ; lueur des forges dans les villes du fer ; vapeurs à roues sur les fleuves.
//   2c, le paysage (peint dans les tuiles, map.js decorate) : les pins gagnent la lande, les marais rétrécissent, le
//       phylloxéra roussit les vignes de 1875 jusqu'aux plants greffés, le maïs en Chalosse et en Béarn, des champs
//       plus variés avec l'assolement.
//   2d, l'allure : le drapeau de l'époque au clocher (bordé de la couleur du maître de la place), les passants coiffés
//       du tricorne, du bicorne puis du haut-de-forme, une teinte un peu sépia au XVIIIe siècle.
import { clamp } from './battle/formes.js';
import { hash } from './map.js';

const TAU = Math.PI * 2;
// marques qui changent la peinture des tuiles : les tuiles sont repeintes quand elles changent
const PAYSAGE = ['pins', 'landes1857', 'drainage', 'greffe', 'mais', 'assolement'];

// drapeau de la France à cette année : blanc du roi, tricolore, blanc de la Restauration, tricolore
export function drapeauEpoque(year) {
  return year < 1790 ? 'roi' : year < 1815 ? 'tricolore' : year < 1830 ? 'blanc' : 'tricolore';
}
// coiffure des passants : tricorne, bicorne, haut-de-forme
export function coiffeEpoque(year) {
  return year < 1790 ? 'tricorne' : year < 1830 ? 'bicorne' : 'haut';
}
// le phylloxéra frappe de 1875 jusqu'aux plants greffés
export const phylloxera = (year, mk) => year >= 1875 && !(mk && mk.has('greffe'));
// le style « d'époque » de la carte (SPEC-SUITE H3) : la carte de Cassini (achevée en 1815), puis celle de l'état-major,
// levée à partir de 1818 ; null pour les couleurs d'Ultimate General
// ce qu'un camp sait déjà au début d'un scénario (game/engine.py : les techniques d'avant sc.techs_before)
export function startTechs(rules, sc) {
  return new Set(sc && sc.techs_before ? (rules.techs || []).filter(t => t.year <= sc.techs_before).map(t => t.id) : []);
}
// les tronçons de voie ferrée ouverts avant l'année de départ (game/engine.py) ; rails : payload de game/rails.py
export function startRails(rails, year) {
  return (rails?.sections || []).filter(s => s[6] > 0 && s[6] < year).map(s => s[0]);
}
export const styleCarte = (style, year) => style !== 'epoque' ? null : year < 1818 ? 'cassini' : 'etatmajor';

export class Epoque {
  constructor(map) {
    this.map = map;
    this.marks = {};   // code du camp → Set des marques
    this.key = '';
    this.year = 1790;
  }
  // nouvel état : marques de chaque camp ; true si les tuiles sont à repeindre
  update(st) {
    this.year = st.year || 1790;
    this.marks = {};
    for (const f of st.factions || []) this.marks[f.code] = new Set(f.mk || []);
    const pays = Object.entries(this.marks).map(([c, s]) => c + ':' + PAYSAGE.filter(k => s.has(k)).join('+')).join(',');
    const any = Object.values(this.marks).some(s => PAYSAGE.some(k => s.has(k)));
    // (les marques du paysage suivent le maître de chaque case : les propriétaires comptent aussi)
    const key = `${pays}|${this.year >= 1875}|${any ? this.map.ownersKey : ''}`;
    const changed = key !== this.key;
    this.key = key;
    return changed;
  }
  of(code) { return this.marks[code] || null; }
  // marques du camp qui tient la case (i, j), d'après les territoires (map.js rebuildTerritory)
  at(i, j) {
    const m = this.map, k = m.cellFac ? m.cellFac[j * m.W + i] : -1;
    return k >= 0 ? this.marks[m.facCodes[k]] || null : null;
  }

  // ------------------------------------------------------------------ dessin (au-dessus des tuiles, sous les places)
  draw(ctx, time, st) {
    const mp = this.map, z = mp.cam.z;
    if (z < 2.4) return;
    const owner = n => st.nodes[n.id]?.o;
    for (const n of mp.nodes) {
      const mk = this.of(owner(n));
      if (!mk) continue;
      const [x, y] = mp.toScreen(n.x, n.y), s = mp.nodeSize(n);
      if (x < -120 || y < -120 || x > mp.vw + 120 || y > mp.vh + 120) continue;
      const big = n.type === 'ville' || n.type === 'capitale';
      // tour Chappe sur une hauteur voisine (le télégraphe électrique la remplace)
      if (big && mk.has('chappe') && !mk.has('telegraphe')) {
        const a = hash(n.id, 61) * TAU, d = clamp(z * 1.7, 18, 60);
        this.chappe(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, clamp(z * 1.6, 10, 26), time + n.id);
      }
      // cheminées d'usine qui fument
      // (derrière la ville, à gauche : la ville cache leur pied, la plaque de la garnison est à droite)
      if (big && mk.has('usines') && z >= 3) this.cheminees(ctx, x - s * 0.42, y - s * 0.02, clamp(s * 0.8, 10, 40), time + n.id * 0.37, n.id);
      // lueur des forges dans les places du fer
      if (mk.has('forges') && n.spec?.includes('fer') && z >= 3) {
        const k = 0.55 + 0.25 * Math.sin(time * 2.1 + n.id) + 0.12 * Math.sin(time * 7.3 + n.id * 3);
        const r = clamp(s * 0.5, 6, 20), gx = x - s * 0.5, gy = y + s * 0.25;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        g.addColorStop(0, `rgba(255,150,60,${0.55 * k})`); g.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill();
      }
    }
    if (z >= 3.4) this.telegraphe(ctx, st);
  }
  // tour Chappe : un mât, le régulateur et ses deux indicateurs qui bougent
  chappe(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(20,24,16,0.3)'; ctx.beginPath(); ctx.ellipse(s * 0.1, 0, s * 0.3, s * 0.08, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8ccb0'; ctx.strokeStyle = '#3b2c1c'; ctx.lineWidth = Math.max(0.8, s * 0.05);
    ctx.fillRect(-s * 0.14, -s * 0.5, s * 0.28, s * 0.5); ctx.strokeRect(-s * 0.14, -s * 0.5, s * 0.28, s * 0.5);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, -s * 1.05); ctx.stroke();
    const a = Math.sin(t * 0.7) > 0.3 ? 0.4 : 0, b = Math.sin(t * 1.1) * 1.2, c = Math.cos(t * 0.9) * 1.2;
    ctx.save(); ctx.translate(0, -s * 0.98); ctx.rotate(a);
    ctx.lineWidth = Math.max(1, s * 0.07); ctx.beginPath(); ctx.moveTo(-s * 0.32, 0); ctx.lineTo(s * 0.32, 0); ctx.stroke();
    for (const [px, r] of [[-s * 0.32, b], [s * 0.32, c]]) { ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px + Math.cos(r) * s * 0.18, Math.sin(r) * s * 0.18); ctx.stroke(); }
    ctx.restore(); ctx.restore();
  }
  // deux cheminées de brique et leurs fumées qui montent et s'étirent au vent
  cheminees(ctx, x, y, s, t, id) {
    for (let k = 0; k < 2; k++) {
      const cx = x + k * s * 0.42, h = s * (1.1 - k * 0.25), w = Math.max(2, s * 0.13);
      ctx.fillStyle = 'rgba(20,24,16,0.3)'; ctx.fillRect(cx + 1, y - 1, w, 3);
      ctx.fillStyle = '#8a4a34'; ctx.fillRect(cx - w / 2, y - h, w, h);
      ctx.fillStyle = '#5a2e22'; ctx.fillRect(cx - w * 0.65, y - h - w * 0.3, w * 1.3, w * 0.35);
      for (let q = 0; q < 4; q++) {
        const u = (t * 0.35 + q / 4 + k * 0.13 + hash(id, q, 7)) % 1;
        ctx.fillStyle = `rgba(70,66,62,${0.55 * (1 - u)})`;
        ctx.beginPath(); ctx.arc(cx + u * s * 0.9, y - h - u * s * 0.8, w * (0.7 + u * 2.2), 0, TAU); ctx.fill();
      }
    }
  }
  // poteaux et fil le long des routes royales tenues par des camps qui ont le télégraphe
  telegraphe(ctx, st) {
    const mp = this.map, z = mp.cam.z, gap = 1.6, off = 0.35;
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of mp.edges) {
      if (e.water || !e.royal) continue;
      const ma = this.of(st.nodes[e.a]?.o), mb = this.of(st.nodes[e.b]?.o);
      if (!ma?.has('telegraphe') || !mb?.has('telegraphe')) continue;
      const L = Math.hypot(e.B[0] - e.A[0], e.B[1] - e.A[1]), n = Math.max(2, Math.round(L / gap));
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n, [px, py] = mp.edgePoint(e, t), [tx, ty] = mp.edgeTangent(e, t), tl = Math.hypot(tx, ty) || 1;
        pts.push(mp.toScreen(px - ty / tl * off, py + tx / tl * off));
      }
      if (pts.every(([x, y]) => x < -40 || y < -40 || x > mp.vw + 40 || y > mp.vh + 40)) continue;
      const h = clamp(z * 0.9, 5, 14);
      ctx.strokeStyle = 'rgba(30,26,20,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach(([x, y], k) => { if (!k) ctx.moveTo(x, y - h); else { const [x0, y0] = pts[k - 1]; ctx.quadraticCurveTo((x0 + x) / 2, (y0 + y) / 2 - h + h * 0.18, x, y - h); } });
      ctx.stroke();
      ctx.strokeStyle = '#3a2c1e'; ctx.lineWidth = Math.max(1.2, h * 0.14);
      ctx.beginPath(); for (const [x, y] of pts) { ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.moveTo(x - h * 0.22, y - h * 0.88); ctx.lineTo(x + h * 0.22, y - h * 0.88); } ctx.stroke();
    }
    ctx.restore();
  }
  // un bateau du fleuve est-il un vapeur ? (près d'une place d'un camp qui a les vapeurs, un bateau sur deux)
  vapeur(x, y, seed) {
    const mp = this.map, i = clamp(Math.floor(x), 0, mp.W - 1), j = clamp(Math.floor(y), 0, mp.H - 1);
    return !!this.at(i, j)?.has('vapeurs') && hash(seed | 0, 77) < 0.55;
  }
  // vapeur à roues : coque, roue à aubes qui tourne, cheminée qui fume (de profil, comme les autres bateaux)
  steamer(ctx, sx, sy, s, head, t) {
    const hx = Math.cos(head);
    ctx.save(); ctx.translate(sx, sy + Math.sin(t * 2.3) * s * 0.02); ctx.scale(hx < 0 ? -1 : 1, 1);
    ctx.fillStyle = 'rgba(10,30,50,0.25)'; ctx.beginPath(); ctx.ellipse(0, s * 0.04, s * 0.52, s * 0.07, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f2a26'; ctx.strokeStyle = '#151210'; ctx.lineWidth = Math.max(0.7, s * 0.03);
    ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.1); ctx.lineTo(s * 0.52, -s * 0.1); ctx.lineTo(s * 0.38, s * 0.03); ctx.lineTo(-s * 0.42, s * 0.03); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8e0cc'; ctx.fillRect(-s * 0.3, -s * 0.22, s * 0.46, s * 0.12);
    ctx.fillStyle = '#7a2a22'; ctx.fillRect(-s * 0.03, -s * 0.48, s * 0.08, s * 0.26);
    // roue à aubes
    ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(0.8, s * 0.035);
    ctx.beginPath(); ctx.arc(s * 0.02, -s * 0.06, s * 0.14, 0, TAU); ctx.stroke();
    for (let k = 0; k < 6; k++) { const a = t * 3 + k * TAU / 6; ctx.beginPath(); ctx.moveTo(s * 0.02, -s * 0.06); ctx.lineTo(s * 0.02 + Math.cos(a) * s * 0.14, -s * 0.06 + Math.sin(a) * s * 0.14); ctx.stroke(); }
    // panache
    for (let q = 0; q < 4; q++) {
      const u = (t * 0.4 + q / 4) % 1;
      ctx.fillStyle = `rgba(70,66,62,${0.5 * (1 - u)})`;
      ctx.beginPath(); ctx.arc(s * 0.01 - u * s * 0.7, -s * 0.52 - u * s * 0.25, s * (0.05 + u * 0.12), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  // le drapeau de l'époque, à la place du drapeau aux couleurs du maître (dont la couleur borde l'étoffe) ; path :
  // le contour de l'étoffe déjà tracé dans ctx
  etoffe(ctx, x, y, w, h, col) {
    const d = drapeauEpoque(this.year);
    ctx.save(); ctx.clip();
    if (d === 'tricolore') {
      for (const [k, c] of [[0, '#2b4f9a'], [1, '#f4f1e8'], [2, '#c0392b']]) { ctx.fillStyle = c; ctx.fillRect(x + w * k / 3, y - 2, w / 3 + 0.5, h + 4); }
    } else {
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(x, y - 2, w + 1, h + 4);
      if (d === 'roi' && w > 9) { ctx.fillStyle = '#c9a43a'; for (const [u, v] of [[0.3, 0.3], [0.65, 0.55], [0.3, 0.8]]) { ctx.beginPath(); ctx.arc(x + w * u, y + h * v, Math.max(0.6, w * 0.06), 0, TAU); ctx.fill(); } }
    }
    ctx.restore();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, h * 0.16); ctx.stroke();
  }
  // coiffure d'un passant (ambient.js walker), au-dessus de sa tête en (0, -s*0.41)
  coiffe(ctx, s) {
    const c = coiffeEpoque(this.year);
    ctx.fillStyle = '#1f1b18';
    if (c === 'tricorne') { ctx.beginPath(); ctx.moveTo(-s * 0.08, -s * 0.44); ctx.lineTo(0, -s * 0.5); ctx.lineTo(s * 0.08, -s * 0.44); ctx.closePath(); ctx.fill(); }
    else if (c === 'bicorne') { ctx.beginPath(); ctx.ellipse(0, -s * 0.46, s * 0.09, s * 0.03, 0, 0, TAU); ctx.fill(); }
    else { ctx.fillRect(-s * 0.04, -s * 0.54, s * 0.08, s * 0.09); ctx.fillRect(-s * 0.065, -s * 0.46, s * 0.13, s * 0.015); }
  }
  // teinte de l'époque sur toute la carte : un peu sépia au XVIIIe siècle, comme une gravure qui a jauni
  teinte(ctx) {
    if (this.year >= 1790) return;
    const mp = this.map, [x0, y0] = mp.toScreen(0, 0), [x1, y1] = mp.toScreen(mp.W, mp.H);
    ctx.fillStyle = 'rgba(150,112,58,0.07)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
