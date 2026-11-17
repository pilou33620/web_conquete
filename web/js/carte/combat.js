// La petite bataille sur l'hexagone (SPEC-BATAILLE.md), d'après la maquette validée (armee.js) : pour chaque bataille
// en cours ou qui vient de finir, une scène toute petite, proportionnelle à la carte, de figures debout comme les pions
// de la vie des pays (carte/vie.js). Elle change selon la situation : en rase campagne deux lignes face à face ; à la
// prise d'une position le défenseur tient une redoute de terre ; devant une ville ou un fort il garnit le rempart de la
// place (celui du plateau, à sa vraie place) et l'assaillant attaque du dehors, échelles à la charge. Les phases sont
// celles du serveur (bataille en cours), ou rejouées d'après le journal (bataille réglée d'un coup, au tour par tour).
// Aussi : la trace des champs de bataille récents (state.sites), une marque sur leur hexagone.
import { clair, sombre, clamp } from './lib.js';
import { Son } from '../son.js';

export const UK = 4 / 75;            // km par unité de dessin : un hexagone (4 km) fait 75 unités, comme sur la maquette
const Z_MIN = 10, Z_MAX = 36;        // la scène suit le zoom entre ces deux échelles (px par km) : ni illisible, ni énorme
const TAILLE = 0.7;                  // les figures, réduites comme sur la maquette
export const PAS = 1.7, FIN = 5;     // secondes : une phase rejouée, puis la fin (le vaincu décroche) avant que la scène s'efface
const TRACE_JOURS = 120;

const hacher = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// ------------------------------------------------------------------ ce qui se calcule sans dessin
// combien de figures pour un camp, d'après ses effectifs par arme : { inf, gren (parmi inf), tir, cav, art }
export function figurines(armes, men = 0) {
  const a = armes || {}, pied = (a.inf || 0) + (a.grenadiers || 0);
  const out = { inf: pied > 0 ? clamp(Math.round(pied / 350), 2, 8) : 0, gren: 0, tir: a.tir > 0 ? (a.tir > 400 ? 2 : 1) : 0, cav: a.cav > 0 ? (a.cav > 300 ? 2 : 1) : 0, art: a.art > 0 ? 1 : 0 };
  if (a.grenadiers > 0) out.gren = clamp(Math.round(out.inf * a.grenadiers / pied), 1, out.inf);
  if (!out.inf && !out.tir && !out.cav && !out.art && men > 0) out.inf = 2;   // (une milice sans détail)
  return out;
}
// le déroulé d'une scène : [{ ph, t }] (la phase et l'heure où elle commence). ajouter : les phases pas encore montrées,
// l'une après l'autre (toutes à la fois si fixe : mouvement réduit), puis « fin » si la bataille est décidée
export function derouler(script, phases, t, fin, fixe = false) {
  const vues = new Set(script.map(e => e.ph));
  let t0 = Math.max(t, script.length ? script[script.length - 1].t + (fixe ? 0 : PAS) : t);
  for (const ph of phases) { if (vues.has(ph)) continue; script.push({ ph, t: t0 }); vues.add(ph); if (!fixe) t0 += PAS; }
  if (fin && !vues.has('fin')) script.push({ ph: 'fin', t: t0 });
  return script;
}
// la phase montrée à l'heure t : { ph, av } (av : secondes depuis son début), ou { ph: null } avant la première
export function phaseA(script, t) {
  let e = null;
  for (const x of script) if (x.t <= t) e = x;
  return e ? { ph: e.ph, av: t - e.t } : { ph: null, av: 0 };
}
// où poser la trace d'une bataille livrée devant une place : hors de ses murs, en haut à droite (les armées et le nom
// de la place sont dessous) ; ailleurs, là où elle s'est livrée. r : le rayon de la place (km)
export const lieuTrace = (x, y, r) => (r > 0 ? [x + (r + 0.7) * 0.75, y - (r + 0.7) * 0.6] : [x, y]);

// ------------------------------------------------------------------ le dessin des figures (unités de la maquette)
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.fill(); };
const trait = (g, c, l, x0, y0, x1, y1) => { g.strokeStyle = c; g.lineWidth = l; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
const disque = (g, c, x, y, rx, ry = rx) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.3); g.fill(); };
const PEAU = '#e6bd95', OMBRE = 'rgba(0,0,0,.25)';

function soldat(g, f, t, col) {
  const x = f.x, y = f.y, dir = f.dir, c = f.type === 'tir' ? sombre(col, 0.3) : col, pas = f.marche ? Math.sin(t * 9 + f.ph) * 1.4 : 0;
  if (f.mort) { g.globalAlpha *= 0.75; g.fillStyle = c; rr(g, x - 3.2, y - 1.6, 6.4, 2.4, 1); disque(g, PEAU, x + 3.6, y - 0.6, 1.2); return; }
  disque(g, OMBRE, x + 1, y + 0.4, 3.2, 1.2);
  trait(g, '#33291f', 1.2, x - 1, y - 3.2, x - 1 + pas, y); trait(g, '#33291f', 1.2, x + 1, y - 3.2, x + 1 - pas, y);
  g.fillStyle = c; rr(g, x - 2.3, y - 9.2, 4.6, 6.4, 1.3); trait(g, '#f7f5ee', 0.8, x - 2, y - 8.6, x + 2, y - 3.6);
  disque(g, PEAU, x, y - 10.5, 1.75); g.fillStyle = '#26211e';
  if (f.gren) { rr(g, x - 1.9, y - 16.4, 3.8, 4.9, 1.5); disque(g, '#c8322c', x + dir * 1.1, y - 16.2, 0.9); }   // le bonnet à poil et son plumet
  else { rr(g, x - 1.8, y - 14.6, 3.6, 3.1, 0.6); disque(g, clair(col, 0.45), x, y - 15.4, 0.9); }
  if (f.drapeau) {
    trait(g, '#5a4030', 0.8, x, y - 6, x, y - 25); g.fillStyle = col; const o = Math.sin(t * 5 + f.ph);
    g.beginPath(); g.moveTo(x, y - 25); g.lineTo(x + dir * 9, y - 24 + o); g.lineTo(x + dir * 9, y - 19 + o); g.lineTo(x, y - 19.5); g.fill(); trait(g, '#f7f5ee', 1, x, y - 22.2, x + dir * 9, y - 21.6 + o);
  } else if (f.vise) { trait(g, '#4a3320', 1, x, y - 7.6, x + dir * 6.5, y - 8.1); trait(g, '#c9ccd0', 0.6, x + dir * 6.5, y - 8.1, x + dir * 9, y - 8.3); }
  else trait(g, '#4a3320', 1, x + dir * 2, y - 4, x + dir * 2.4, y - 15.5);
}
function monture(g, f, t, col, charge) {
  const x = f.x, y = f.y, dir = f.dir, robe = ['#6b4a2c', '#3f2d1f', '#8b6a47'][((f.ph * 10) | 0) % 3], gal = f.marche ? Math.sin(t * 13 + f.ph) : 0;
  if (f.mort) { g.globalAlpha *= 0.7; disque(g, robe, x, y - 1.5, 5.5, 2); return; }
  disque(g, OMBRE, x + 1, y + 0.5, 6.5, 1.6);
  for (const [px, k] of [[-3.4, 1], [-2, -1], [2.2, -1], [3.6, 1]]) trait(g, '#2a1f18', 1.1, x + px, y - 4.2, x + px + gal * k * 2, y);
  disque(g, robe, x, y - 6, 5.4, 2.5); trait(g, robe, 2.6, x + dir * 4, y - 7, x + dir * 6.2, y - 11); disque(g, robe, x + dir * 7.4, y - 11.4, 2, 1.2); trait(g, '#2a1f18', 1.2, x - dir * 5, y - 6.5, x - dir * 7, y - 3.5);
  g.fillStyle = col; rr(g, x - 2.2, y - 14, 4.4, 6, 1.2); disque(g, PEAU, x, y - 15.4, 1.7); disque(g, '#c9ccd0', x, y - 16.6, 1.8, 1.4);
  const leve = f.marche && charge; trait(g, '#d8dde2', 0.9, x + dir * 2, y - 11, x + dir * (leve ? 6 : 3), y - (leve ? 19 : 5));
}
function canon(g, f, t, col) {
  const dir = f.dir, x = f.x - dir * (f.recul || 0) * 3, y = f.y;
  disque(g, OMBRE, x, y + 0.6, 7, 1.6); trait(g, '#4f6a3a', 1.6, x - dir * 8, y - 0.6, x, y - 4); trait(g, '#3a3a3c', 3, x - dir * 2, y - 5, x + dir * 8, y - 6.6);
  g.strokeStyle = '#6b4a30'; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y - 3.2, 3.2, 0, 6.3); g.stroke(); disque(g, '#6b4a30', x, y - 3.2, 0.9);
  for (const k of [-1, 1]) soldat(g, { x: f.x - dir * 5 + k, y: f.y + k * 5, dir, type: 'inf', ph: f.ph + k }, t, col);
}
// n pans autour de (x, y), écrasés par la vue inclinée
const pans = o => Array.from({ length: o.n }, (_, k) => { const a = k * 6.283 / o.n + o.tour; return [o.x + Math.cos(a) * o.R, o.y + Math.sin(a) * o.R * 0.7]; });
const surLigne = (l, t) => { const n = l.length - 1, i = Math.min(n - 1, Math.floor(t * n)), k = t * n - i; return [l[i][0] + (l[i + 1][0] - l[i][0]) * k, l[i][1] + (l[i + 1][1] - l[i][1]) * k]; };
// la redoute (ou la barricade) de campagne, dans le rendu de la carte : un ouvrage de terre à l'ombre portée, son
// parapet clair, les pieux aux angles, le drapeau de qui le tient
function ouvrage(g, o, col) {
  const pts = pans(o), ferme = () => { g.beginPath(); pts.forEach((p, k) => g[k ? 'lineTo' : 'moveTo'](p[0], p[1])); g.closePath(); };
  g.lineJoin = 'round';
  g.save(); g.translate(1.6, 2); ferme(); g.strokeStyle = 'rgba(30,36,22,.38)'; g.lineWidth = 3.4; g.stroke(); g.restore();
  ferme(); g.fillStyle = '#c9b382'; g.fill();
  ferme(); g.strokeStyle = '#8f7647'; g.lineWidth = 3; g.stroke();
  g.save(); g.translate(0, -1.1); ferme(); g.strokeStyle = '#b99c62'; g.lineWidth = 1.5; g.stroke(); g.restore();
  for (const [x, y] of pts) disque(g, '#7a643c', x, y - 0.6, 1.5, 1.2);
  trait(g, '#4a3a28', 0.9, o.x, o.y - 2, o.x, o.y - 17); g.fillStyle = col; g.fillRect(o.x + 0.4, o.y - 17, 7.5, 4.6); trait(g, '#f7f5ee', 0.9, o.x + 0.4, o.y - 14.7, o.x + 7.9, o.y - 14.7);
}

// ------------------------------------------------------------------ les scènes
export class Combat {
  constructor(map) {
    this.map = map;
    this.scenes = new Map();   // par bataille
    this.reduit = false;
    try { this.reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* API absente */ }
  }
  // image fixe : mouvement réduit demandé au navigateur, ou animations de la carte coupées (réglages)
  get fixe() { return this.reduit || this.map.ambient?.on === false; }

  // une bataille dont on apprend la fin (événement battle_end, ui.js) : sa scène rejoue les phases du journal, puis le
  // vaincu décroche. Une bataille qu'on n'a pas vue commencer (tour des IA) n'a de scène que si son lieu est en vue
  fin(ev, t = performance.now() / 1000) {
    if (ev.x == null || ev.w == null) return;
    let S = this.scenes.get(String(ev.bid));
    if (!S) {
      if (ev.win == null && !this.map.guerreDe().visible(ev.x, ev.y)) return;
      const tot = (ev.la || 0) + (ev.ld || 0) + 1;
      S = this.creer({ id: ev.bid, x: ev.x, y: ev.y, node: ev.node, sit: ev.sit, ouvrage: ev.sit === 'position' ? { type: 'redoute' } : null,
                       sides: [{ o: ev.a, men: tot * 2, lost: 0 }, { o: ev.d, men: tot * 2, lost: 0 }] });
    }
    S.pertes = [0, 1].map(i => clamp((i ? ev.ld : ev.la) / Math.max(1, S.n0[i]), 0, 0.6));
    S.perdant = 1 - ev.w; S.parti = t;
    derouler(S.script, (ev.journal || []).map(j => j.ph), t, true, this.fixe);
  }

  creer(b) {
    const mp = this.map, n = b.node != null ? mp.nodes[b.node] : null, sens = hacher(b.id) & 1 ? 1 : -1, K = mp.K || 1;
    // D : du camp 0 (l'assaillant) vers le camp 1 (le défenseur), à l'écran ; de profil, les figures se lisent mieux
    const S = { id: String(b.id), x: b.x, y: b.y, sit: b.sit || 'campagne', D: [0.92 * sens, -0.39], def: 1, figs: [], parts: [], script: [], perdant: null, pertes: [0, 0],
                cols: b.sides.map(s => mp.colors[s.o] || '#8d8a7a'), n0: b.sides.map(s => (s.men || 0) + (s.lost || 0)),
                nb: b.sides.map(s => figurines(s.armes, s.men)), q: 0, place: null, redoute: null };
    if (n && (S.sit === 'ville' || S.sit === 'fort')) {
      // la place du plateau : le fort en étoile (1,6 km aux pointes), ou l'enceinte de la ville ; on en garnit le rempart
      S.x = n.x; S.y = n.y; S.place = S.sit === 'fort' ? 1.2 : Math.max(0.9, (mp.plateau?.rayon(n) || 1.7) * 0.93);
    } else {
      if (n) { const r = (mp.plateau?.rayon(n) || 0.8) + 1; S.x = n.x - S.D[0] * r; S.y = n.y - S.D[1] * r / K; }   // une place ouverte : devant ses maisons
      if (b.ouvrage || S.sit === 'position') S.redoute = { nom: b.ouvrage?.type === 'barricade' ? 'Barricade' : 'Redoute' };
    }
    this.scenes.set(S.id, S);
    return S;
  }

  // le rempart tenu par le défenseur, en unités de la scène : l'arc de la place tourné vers l'assaillant, ou les trois
  // pans de la redoute qui lui font face
  former(S, q) {
    const D = S.D, P = [-D[1], D[0]], K = this.map.K || 1, vieux = S.figs;
    S.q = q; S.figs = []; S.mur = null; S.ouvrage = null;
    if (S.place) {
      const R = S.place / UK * q, a0 = Math.atan2(-D[1] / K, -D[0]);
      S.mur = [-0.5, -0.25, 0, 0.25, 0.5].map(d => [Math.cos(a0 + d) * R, Math.sin(a0 + d) * R * K]);
    } else if (S.redoute) {
      const o = S.ouvrage = { x: D[0] * 13, y: D[1] * 13, R: 14, n: 4, tour: 0.35, nom: S.redoute.nom };
      const pts = pans(o).map(p => [p, -((p[0] - o.x) * D[0] + (p[1] - o.y) * D[1])]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(p => p[0]);
      S.mur = pts.sort((a, b) => (a[0] - o.x) * -D[1] + (a[1] - o.y) * D[0] - ((b[0] - o.x) * -D[1] + (b[1] - o.y) * D[0]));
    }
    const mur = S.mur;
    for (const camp of [0, 1]) {
      const s = camp ? 1 : -1, nb = S.nb[camp], tient = !!mur && S.def === camp, assaut = !!mur && S.def !== camp;
      const ajoute = (type, hx, hy, extra) => S.figs.push(Object.assign({ camp, type, hx, hy, x: hx, y: hy, dir: D[0] * -s >= 0 ? 1 : -1, ph: (hacher(S.id + camp + type + S.figs.length) % 628) / 100,
                                                                         suiv: 0, mort: false, tient, assaut, attaque: S.def !== camp }, extra));
      if (tient) {   // la garnison sur le rempart : les fantassins le long du mur, une pièce au milieu, le drapeau
        const k = Math.max(4, nb.inf + nb.tir);
        for (let i = 0; i < k; i++) { const p = surLigne(mur, (i + 0.5) / k); ajoute('inf', p[0], p[1] - 1.5, { rang: i % 2, gren: i < nb.gren, drapeau: i === (k >> 1) && !S.ouvrage }); }
        if (nb.art || S.place) { const m = surLigne(mur, 0.5); ajoute('art', m[0] + D[0] * s, m[1] - 2, {}); }
        continue;
      }
      // en ligne : face à l'ennemi, ou face au rempart qu'on attaque
      const but = mur ? surLigne(mur, 0.5) : null, attaque = S.def !== camp, L = but ? [but[0] + D[0] * s * 46, but[1] + D[1] * s * 46] : [D[0] * s * (attaque ? 44 : 13), D[1] * s * (attaque ? 44 : 13)];
      const pose = (type, a, b, extra) => ajoute(type, L[0] + P[0] * a + D[0] * s * b, L[1] + P[1] * a + D[1] * s * b, extra);
      const larg = Math.ceil(nb.inf / 2);
      for (let i = 0; i < nb.inf; i++) { const r = i < larg ? 0 : 1, j = r ? i - larg : i; pose('inf', (j - (larg - 1) / 2) * 4.6, r * 5, { rang: r, gren: i < nb.gren, drapeau: i === nb.inf - 1 && nb.inf > 2 }); }
      for (let i = 0; i < nb.tir; i++) pose('tir', (i ? 12 : -12) + (S.figs.length % 3 - 1), -6, {});
      for (let i = 0; i < nb.cav; i++) pose('cav', -20 - i * 6, assaut ? 10 : 3, {});
      if (nb.art) pose('art', 20, assaut ? 6 : 1, {});
    }
    // (reformée après un zoom : les tombés le restent)
    S.figs.forEach((f, i) => { if (vieux[i]?.mort && vieux[i].type === f.type) f.mort = true; });
  }

  fumee(S, x, y, gros, retard = 0) { S.parts.push({ x, y, vx: 2 + Math.random() * 2, vy: -4 - Math.random() * 3, age: -retard, dur: gros ? 1.8 : 1.1, r: gros ? 2 : 1 }); }
  eclat(S, x, y, gros, retard = 0) { S.parts.push({ x, y, vx: 0, vy: 0, age: -retard, dur: 0.1, r: gros ? 1.8 : 0.9, feu: true }); }

  avancer(S, dt, t, vue) {
    const { ph, av } = phaseA(S.script, t), D = S.D, P = [-D[1], D[0]], mur = S.mur, fixe = this.fixe, fin = ph === 'fin';
    S.ph = ph; S.av = av;
    for (const f of S.figs) {
      const s = f.camp ? 1 : -1; let tx = f.hx, ty = f.hy, vit = 2.2;
      if (f.mort) continue;
      // l'assaillant avance par bonds sous le feu, puis se jette sur la ligne ou au pied du rempart ; ses tirailleurs le
      // précèdent dès l'escarmouche ; le défenseur ne bouge pas, sa cavalerie contre-charge à mi-chemin
      if (f.attaque && f.type === 'inf' && (ph === 'fusillade' || ph === 'charge')) { const loin = f.assaut ? [22, 41] : [30, 50], k = ph === 'charge' ? loin[0] + Math.min(1, av / 1.3) * (loin[1] - loin[0]) : Math.min(1, av / 2.6) * loin[0]; tx -= D[0] * s * k; ty -= D[1] * s * k; }
      if (f.attaque && f.type === 'tir' && ph && !fin) { const k = (f.assaut ? 20 : 24) * (ph === 'escarmouche' ? Math.min(1, av / 1.2) : 1); tx -= D[0] * s * k; ty -= D[1] * s * k; }
      if (f.attaque && f.type === 'art' && ph) { tx -= D[0] * s * 12; ty -= D[1] * s * 12; }
      if (ph === 'charge' && f.type === 'cav' && !mur) { const q = fixe ? 1 : Math.sin(Math.min(1, av / 2.2) * Math.PI), E = -D[0] * s * (f.attaque ? 13 : -12), F = -D[1] * s * (f.attaque ? 13 : -12); tx = f.hx + (E - P[0] * 13 - f.hx) * q; ty = f.hy + (F - P[1] * 13 - f.hy) * q; vit = 5; }
      f.fuit = fin && f.camp === S.perdant;
      if (f.fuit && !f.tient) { tx = f.hx + D[0] * s * 34; ty = f.hy + D[1] * s * 34; vit = 0.7; }
      if (fin && f.camp !== S.perdant && f.assaut && f.type === 'inf' && S.ouvrage) { tx = S.ouvrage.x + (f.ph - 3.14) * 2.4; ty = S.ouvrage.y + Math.sin(f.ph * 3) * 3.5; vit = 1.2; }
      const dx = tx - f.x, dy = ty - f.y, k = fixe ? 1 : Math.min(1, dt * vit);
      f.marche = !fixe && Math.hypot(dx, dy) > 0.5; f.x += dx * k; f.y += dy * k;
      const tire = !f.marche && !f.fuit && !fin && (f.type === 'tir' ? ph === 'escarmouche' || ph === 'canonnade' || ph === 'fusillade' : f.type === 'art' ? ph === 'canonnade' || ph === 'fusillade' || (ph === 'charge' && f.tient) : f.type === 'inf' ? ph === 'fusillade' || ph === 'charge' || (f.tient && ph === 'escarmouche') : false);
      f.vise = tire;
      if (tire && !fixe && t > f.suiv) {
        const gros = f.type === 'art';
        f.suiv = t + (gros ? 0.9 + Math.random() * 0.9 : f.type === 'inf' ? 1.15 + (f.rang ? 0.38 : 0) + Math.random() * 0.12 : 0.5 + Math.random() * 1.1);
        if (f.type === 'inf' && !f.salve) { f.salve = true; f.suiv = t + (f.rang ? 0.52 : 0.14) + Math.random() * 0.09; continue; }   // (le feu de rang : un rang après l'autre)
        const mx = f.x + f.dir * (gros ? 9 : 7) * TAILLE, my = f.y - (gros ? 6 : 8) * TAILLE;
        this.eclat(S, mx, my, gros); this.fumee(S, mx, my, gros); f.recul = gros ? 1 : 0;
        if (vue) Son.jouer(gros ? 'canon' : 'salve', gros ? 0.35 : 0.2);
        // le boulet de l'assiégeant frappe le rempart : un nuage de poussière sur le mur
        if (gros && f.assaut && mur) { const p = surLigne(mur, 0.2 + Math.random() * 0.6); this.fumee(S, p[0], p[1] - 1, true, 0.26); this.eclat(S, p[0], p[1] - 1, false, 0.26); }
      }
      if (f.recul) f.recul = Math.max(0, f.recul - dt * 2);
    }
    // les rangs s'éclaircissent à mesure des pertes
    const engage = ph === 'fusillade' || ph === 'charge' || fin;
    if (engage) for (const camp of [0, 1]) {
      const l = S.figs.filter(f => f.camp === camp && f.type !== 'art'), morts = l.filter(f => f.mort).length;
      const voulu = l.length * Math.min(0.6, S.pertes[camp] * 2.2) * (fixe || fin ? 1 : Math.min(1, ph === 'charge' ? 0.6 + av / 6 : av / 5));
      if (morts < Math.floor(voulu)) { const v = l.filter(f => !f.mort && !f.drapeau); if (v.length) v[hacher(S.id + morts + camp) % v.length].mort = true; }
    }
    for (const p of S.parts) { p.age += dt; if (p.age > 0) { p.x += p.vx * dt; p.y += p.vy * dt; } }
    S.parts = S.parts.filter(p => p.age < p.dur);
  }

  peindre(g, S, t) {
    const mur = S.mur, fixe = this.fixe, tf = fixe ? 0 : t;
    if (S.ouvrage) ouvrage(g, S.ouvrage, S.cols[S.ph === 'fin' && S.perdant === S.def ? 1 - S.def : S.def]);
    // les échelles de l'assaut, dressées contre le rempart de la place
    if (mur && S.place && S.ph === 'charge' && (fixe || S.av > 0.9)) {
      const s = S.def ? -1 : 1;
      for (const k of [0.3, 0.7]) {
        const p = surLigne(mur, k), bx = p[0] + S.D[0] * s * 5, by = p[1] + S.D[1] * s * 5 + 2;
        trait(g, '#5b4127', 0.7, bx - 0.8, by, p[0] - 0.8, p[1] - 3); trait(g, '#5b4127', 0.7, bx + 0.8, by, p[0] + 0.8, p[1] - 3);
        for (let e = 0.2; e < 1; e += 0.2) trait(g, '#5b4127', 0.5, bx - 0.8 + (p[0] - bx) * e, by + (p[1] - 3 - by) * e, bx + 0.8 + (p[0] - bx) * e, by + (p[1] - 3 - by) * e);
      }
    }
    for (const f of S.figs.slice().sort((a, b) => (a.mort ? -1e4 : 0) + a.y - ((b.mort ? -1e4 : 0) + b.y))) {
      // le vaincu décroche et s'efface ; la garnison d'une place prise reste sur son mur, effacée de même
      const a = f.fuit && !f.mort ? (fixe ? 0.45 : Math.max(0, 1 - S.av / 3.2)) : 1;
      if (a <= 0) continue;
      g.save(); g.globalAlpha = a; g.translate(f.x, f.y); g.scale(TAILLE, TAILLE); g.translate(-f.x, -f.y);
      const col = S.cols[f.camp];
      if (f.type === 'cav') monture(g, f, tf, col, S.ph === 'charge'); else if (f.type === 'art') canon(g, f, tf, col); else soldat(g, f, tf, col);
      g.restore();
    }
    for (const p of S.parts) {
      if (p.age < 0) continue;
      const k = p.age / p.dur;
      if (p.feu) disque(g, `rgba(255,205,110,${1 - k})`, p.x, p.y, p.r * (1 + k)); else disque(g, `rgba(248,246,238,${0.75 * (1 - k)})`, p.x, p.y, p.r * (1 + k * 2.4));
    }
    if (S.ouvrage) {
      const o = S.ouvrage, bas = o.y + o.R * 0.7 + 8;
      g.font = '700 6.5px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineWidth = 2; g.strokeStyle = 'rgba(20,24,28,.85)'; g.strokeText(o.nom, o.x, bas); g.fillStyle = '#efe6cc'; g.fillText(o.nom, o.x, bas);
    }
  }

  // les batailles de l'état : leur scène naît, suit la phase du serveur, rejoue le journal quand la bataille est décidée
  suivre(st, t) {
    const vues = new Set();
    for (const b of st.battles || []) {
      const id = String(b.id); vues.add(id);
      const S = this.scenes.get(id) || this.creer(b);
      if (S.vu === b) continue;
      S.vu = b;
      S.cols = b.sides.map(s => this.map.colors[s.o] || '#8d8a7a');
      const fini = b.mode === 'poursuite';
      if (S.perdant == null) S.pertes = b.sides.map(s => clamp((s.lost || 0) / Math.max(1, (s.men || 0) + (s.lost || 0)), 0, 0.6));
      if (fini && S.perdant == null) { S.perdant = 1 - (b.fin?.w ?? 0); derouler(S.script, (b.journal || []).map(j => j.ph), t, true, this.fixe); }
      else if (b.mode === 'auto' && S.perdant == null) derouler(S.script, [...(b.journal || []).map(j => j.ph), b.phase], t, false, true);   // (en cours : la phase du serveur, tout de suite)
    }
    // une bataille sortie de l'état : sa fin arrive par l'événement battle_end (fin) ; sans lui, la scène s'en va
    for (const [id, S] of this.scenes) {
      if (vues.has(id)) { S.absente = 0; continue; }
      S.absente = S.absente || t;
      const { ph, av } = phaseA(S.script, t);
      if (S.perdant == null ? t - S.absente > 2 : ph === 'fin' && av > FIN) this.scenes.delete(id);
    }
  }

  // dessiné par map.js au-dessus des armées ; ctx est en pixels CSS
  dessiner(ctx, dt, t) {
    const mp = this.map, st = mp.state, z = mp.cam.z;
    if (!st || mp.papierVu()) return;
    this.suivre(st, t);
    if (z >= 5.5) this.traces(ctx, st, z);
    if (z < 5.5) return;   // (de loin : le signe de la bataille, map.js)
    const ze = clamp(z, Z_MIN, Z_MAX), k = UK * ze, q = z / ze;
    for (const S of this.scenes.values()) {
      const [sx, sy] = mp.toScreen(S.x, S.y), marge = 80 * k + (S.place || 0) * z;
      const vue = sx > -marge && sy > -marge && sx < mp.vw + marge && sy < mp.vh + marge;
      if (!S.figs.length || Math.abs(S.q - q) > 0.01) this.former(S, q);
      this.avancer(S, dt, t, vue);
      if (!vue) continue;
      ctx.save(); ctx.translate(sx, sy); ctx.scale(k, k); ctx.lineCap = 'round';
      this.peindre(ctx, S, t);
      ctx.restore();
    }
  }

  // les champs de bataille des quatre derniers mois (state.sites) : sur leur hexagone, deux sabres croisés sous le
  // fanion du vainqueur, qui pâlissent avec le temps ; devant une place, la marque se pose hors de ses murs
  traces(ctx, st, z) {
    const mp = this.map, s = clamp(z * 0.09, 0.75, 1.5);
    for (const [x, y, age, , , o0, o1, w, , place] of st.sites || []) {
      const n = place != null ? mp.nodes[place] : null, [tx, ty] = lieuTrace(x, y, n ? mp.plateau?.rayon(n) || 1 : 0);
      if ([...this.scenes.values()].some(S => Math.hypot(S.x - x, S.y - y) < 4)) continue;   // (la scène se joue encore)
      const [sx, sy] = mp.toScreen(tx, ty);
      if (sx < -20 || sy < -20 || sx > mp.vw + 20 || sy > mp.vh + 20) continue;
      ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s); ctx.globalAlpha = clamp(1 - 0.7 * age / TRACE_JOURS, 0.3, 1); ctx.lineCap = 'round';
      disque(ctx, 'rgba(105,80,45,.5)', 0, 1.5, 9, 3.6);
      for (const d of [-1, 1]) { trait(ctx, 'rgba(20,24,28,.7)', 3, -5 * d, 1, 5 * d, -9); trait(ctx, '#d8dde2', 1.5, -5 * d, 1, 5 * d, -9); trait(ctx, '#8a6a3a', 2, -5.6 * d, 1.8, -3.6 * d, -1.2); }
      if (w === 0 || w === 1) { trait(ctx, '#3a2e20', 1.2, 0, -2, 0, -15); ctx.fillStyle = mp.colors[w ? o1 : o0] || '#8d8a7a'; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(8, -13); ctx.lineTo(0, -10.5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
}
