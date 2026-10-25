// Vue tactique : effets (fumée des salves, éclairs, boulets en cloche et ricochets, mitraille, explosions, éclats de
// terre, poussière des charges, débandade), puis l'atmosphère : bancs de brouillard, ombres des nuages, teinte de
// l'heure, nuit, pluie, neige, orage, chaleur.
// Vue de dessus, sur le canevas 2D (SPEC-2D.md § 2, calque 5) : tout vit en mètres et se dessine après
// view.monde(ctx), d'après la maquette (web/js/battle/dev/maquette-2d.html : sprite, fumee, eclair, etincelle, terre,
// boulet, impact). Des taches pâles pour la fumée (comme la poussière du tracteur de Champs de Plaine), des éclairs
// brefs ajoutés à la lumière, les boulets qui montent et retombent au-dessus de leur ombre. Images préparées une fois,
// posées par drawImage : aucun dégradé par particule.
// Une salve roule le long du front : chaque file fait feu à son tour, aux bouches que donne Troupes2D.muzzles (la vue
// les met dans `un._muzzles`, [[x, y, angle], …]) ou, sans elles, le long du front de l'unité. Les troupes lisent
// `un._volley` et `un._shots` pour mettre les hommes en joue au même instant et faire reculer les pièces.
import { clamp, TAU, canvas, pieces, clsOf } from './formes.js';
import { ligne, heureEffective, METEO } from './heures.js';

// poudre sans fumée : l'infanterie à partir du fusil Lebel (arm 7), l'artillerie si son camp l'a (rules.VISUALS)
export function smokeless(un, marks) {
  if (clsOf(un) === 'artillerie') return !!marks?.[un.side]?.includes('sans_fumee');
  return clsOf(un) === 'inf' && (un.arm ?? 0) >= 7;
}

// tache ronde et douce (maquette : sprite)
function sprite(rgb) {
  const c = canvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.55, `rgba(${rgb},0.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
// feu d'une explosion (maquette : SPR.fl)
function flamme() {
  const c = canvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 38, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,248,200,1)'); gr.addColorStop(0.3, 'rgba(255,190,70,0.95)'); gr.addColorStop(0.65, 'rgba(235,90,20,0.55)'); gr.addColorStop(1, 'rgba(180,30,10,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
// éclair de bouche (maquette : eclair) : une lueur orangée et un dard blanc vers +x ; s = 20 px, la bouche en (32, 32)
const ES = 20, EX = 32;
function dard() {
  const c = canvas(96, 64), g = c.getContext('2d'), gr = g.createRadialGradient(EX, 32, 0, EX, 32, ES * 1.3);
  gr.addColorStop(0, 'rgba(255,200,100,0.6)'); gr.addColorStop(1, 'rgba(255,200,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 96, 64);
  g.fillStyle = '#fff6d2'; g.beginPath();
  g.moveTo(EX + ES * 2.4, 32); g.lineTo(EX, 32 + ES * 0.55); g.lineTo(EX, 32 - ES * 0.55); g.closePath(); g.fill();
  return c;
}
const rnd = () => Math.random();
const lerp = (a, b, t) => a + (b - a) * t;

export class Effects {
  // q : profil de qualité graphique (qualite.js) : puffs (fumées au plus), fx (richesse des effets, 0 à 3), clouds
  constructor(q) {
    this.q = q;
    this.puffs = [];      // fumées, poussières : x, y (m), alt (m, pour le vent), r0 → r1 (m), a, life, t
    this.flashes = [];    // éclairs de bouche (dard orienté) et feux d'explosion (additifs)
    this.balls = [];      // boulets en vol (en cloche, avec leur ombre)
    this.streaks = [];    // mitraille, éclats d'explosion
    this.bits = [];       // éclats de terre (retombent), étincelles, braises
    this.queue = [];      // effets différés (étalés entre deux réponses du serveur, salves qui roulent)
    this.decals = [];     // à peindre au sol par la vue : { k: 'trou', x, y, r, a }
    this.marks = [[], []];   // marques visibles de chaque camp (rules.VISUALS ; la vue les reçoit avec la carte)
    this.S = { f: sprite('244,242,234'), c: sprite('222,218,208'), p: sprite('214,196,152'), t: sprite('120,94,60'),
      n: sprite('62,58,54'), h: sprite('206,214,224'), lueur: sprite('255,150,50'), fl: flamme(), e: dard(),
      brume: sprite('226,230,234'), nuage: sprite('16,22,30') };
    this.rain = []; this.snow = []; this.bancs = [];
    this.bolt = null; this.flashT = 0; this.nextBolt = 4;
    this.t = 0;
  }
  setQuality(q) { this.q = q; }
  dispose() {
    for (const k of ['puffs', 'flashes', 'balls', 'streaks', 'bits', 'queue', 'decals', 'rain', 'snow', 'bancs']) this[k].length = 0;
    for (const cv of [this.couche, this.ciels]) if (cv) cv.width = cv.height = 1;   // (Safari compte la mémoire des canevas)
  }
  get fxq() { return this.q?.fx ?? 2; }
  later(at, fn) { this.queue.push({ fn, at: this.t + at }); }

  // ------------------------------------------------------------------ effets envoyés par le serveur
  // f : {k, x, y, x2, y2, n, u} ; unit : l'unité qui l'a produit (pour le front d'une salve) ; delay en s
  push(f, unit, delay = 0) { this.queue.push({ f, unit, at: this.t + delay }); }
  spawn(f, un) {
    const k = f.k;
    if (k === 'salve') { if (un?.type === 'mitrailleuses') this.crackle(f, un); else this.volley(f, un); }
    else if (k === 'canon' || k === 'mitraille') this.cannon(f, un, k === 'mitraille');
    else if (k === 'impact') {
      // choc d'une charge (n = hommes qui chargent) ou chariot pris : poussière et quelques étincelles, une fois
      if (this.balls.some(b => Math.hypot(b.x1 - f.x, b.y1 - f.y) < 40)) return;
      const sc = un?._figScale ?? 1;
      if (f.n > 20) {
        for (let q = 0; q < 10; q++) { const a = q / 10 * TAU; this.puff('p', f.x + Math.cos(a) * 14 * sc, f.y + Math.sin(a) * 9 * sc, 1, 3 * sc, 9 * sc, 0.42, 2.6, Math.cos(a) * 6, Math.sin(a) * 4); }
        for (let q = 0; q < 8; q++) this.etincelle(f.x + (rnd() - 0.5) * 24 * sc, f.y + (rnd() - 0.5) * 12 * sc);
      } else this.burst(f.x, f.y, 1, sc);
    }
    else if (k === 'explosion') this.explosion(f.x, f.y);
    else if (k === 'charge') { for (let q = 0; q < 6; q++) this.puff('p', f.x + (rnd() - 0.5) * 30, f.y + (rnd() - 0.5) * 12, 0, 2, 7, 0.38, 3); }
    else if (k === 'deroute') { for (let q = 0; q < 5; q++) this.puff('p', f.x + (rnd() - 0.5) * 40, f.y + (rnd() - 0.5) * 20, 0.5, 2, 7, 0.32, 3); }
    else if (k === 'fumee') this.puff(f.dust ? 'p' : 'f', f.x, f.y, 0, 2, f.dust ? 8 : 10, f.dust ? 0.3 : 0.42, 5);
  }
  // une tache (maquette : fumee) ; s : nom de l'image ; r0 → r1 : rayon (m) en naissant, puis au bout de sa vie
  puff(s, x, y, alt, r0, r1, a, life, vx = 0, vy = 0, valt = 0) {
    // trop de particules : la poussière part d'abord, la fumée des salves reste
    if (this.puffs.length >= (this.q?.puffs ?? 1400)) {
      const k = this.puffs.findIndex((p, i) => i < 300 && p.s !== 'f');
      this.puffs.splice(k >= 0 ? k : 0, 1);
    }
    this.puffs.push({ s, x, y, alt, r0, r1, a, life, t: 0, vx, vy, valt });
  }
  // éclair de bouche, dans l'angle a ; s : taille du dard (m)
  eclair(x, y, a, s) { if (this.flashes.length < 600) this.flashes.push({ x, y, a, s, t: 0, life: 0.09 }); }
  etincelle(x, y) { this.bit(x, y, 0, 0, 0.6, 0, 0.14, 'e', 0.2); }
  bit(x, y, vx, vy, alt, valt, life, c, sz) { if (this.bits.length < (this.q?.puffs ?? 1400) >> 1) this.bits.push({ x, y, vx, vy, alt, valt, t: 0, life, c, sz }); }
  // gerbe de terre (maquette : terre) : n mottes, v vitesse au sol (m/s)
  terre(x, y, n, v = 6, sc = 1) {
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = rnd() * v * sc; this.bit(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.2, (2 + rnd() * 5) * Math.sqrt(sc), 1.6, rnd() < 0.5 ? 0 : 1, (0.12 + rnd() * 0.18) * sc); }
  }
  // les bouches à feu de l'unité : celles de Troupes2D (un._muzzles), sinon n points le long de son front (sur un
  // rempart, son front est la ligne du mur) ; [x, y, angle] en m
  bouches(un, x, y, dir, w, n, front) {
    if (un?._muzzles?.length) return un._muzzles;
    const c = Math.cos(dir), s = Math.sin(dir), out = [];
    for (let q = 0; q < n; q++) { const u = n > 1 ? ((q + 0.5) / n - 0.5) * w : 0; out.push([x + c * front - s * u, y + s * front + c * u, dir]); }
    return out;
  }
  // tirée des n parmi M, également réparties
  static choix(M, n) { const out = []; for (let q = 0; q < n; q++) out.push(M[Math.min(M.length - 1, Math.floor((q + rnd()) / n * M.length))]); return out; }

  // salve : elle roule d'un bout à l'autre du front ; chaque file fait feu à son tour, éclair puis fumée
  volley(f, un) {
    let x = f.x, y = f.y, dir = Math.atan2((f.y2 ?? y + 1) - y, (f.x2 ?? x) - x), w = 60;
    if (un) { x = un.x; y = un.y; w = un.form === 'tirailleurs' ? un.w * 0.8 : un.w; dir = un.dir; }
    const c = Math.cos(dir), s = Math.sin(dir), fx = this.fxq;
    // salves rapprochées (vitesse ×2, ×4, feu roulant) : moins de fumée neuve, sinon elle devient une masse opaque
    const since = un ? this.t - (un._volley?.t ?? -99) : 99;
    const roll = rnd() < 0.5 ? 1 : -1, dur = clamp(w / 150, 0.4, 1.4);
    if (un) un._volley = { t: this.t, roll, dur };
    let n = Math.max(3, Math.round(clamp(Math.round(w / 3.2), 5, 48) * [0.45, 0.7, 1, 1.25][fx] * (since < 1.5 ? 0.3 : since < 4 ? 0.6 : 1)));
    // déjà un banc épais devant ce front : on ne l'épaissit plus
    const R2 = Math.max(40, w * 0.6) ** 2;
    let near = 0;
    for (const p of this.puffs) if (p.s === 'f' && (p.x - x) ** 2 + (p.y - y) ** 2 < R2) near++;
    if (near > n * 6) n = Math.min(n, 3);
    // (sc : échelle des figures du régiment : de loin, elles grossissent, et leur fumée avec elles)
    const life = [6, 9, 12, 15][fx], sk = un?.form === 'tirailleurs', sc = un?._figScale ?? 1;
    const clean = !!un && smokeless(un, this.marks);
    const M = this.bouches(un, x, y, dir, w, n, (un?.d || 12) / 2 + 1.5);
    // l'instant de chaque bouche : selon sa place le long du front ; position gardée par rapport à l'unité (elle bouge)
    const ox = () => un ? un.x : x, oy = () => un ? un.y : y;
    const quand = m => { const u = -s * (m[0] - x) + c * (m[1] - y); return sk ? rnd() * 1.6 : clamp(roll > 0 ? u / w + 0.5 : 0.5 - u / w, 0, 1) * dur + rnd() * 0.05; };
    for (const m of Effects.choix(M, Math.min(M.length, [24, 40, 64, 96][fx]))) {
      const dx = m[0] - x, dy = m[1] - y;
      this.later(quand(m), () => this.eclair(ox() + dx, oy() + dy, m[2], 0.2 * sc));
    }
    Effects.choix(M, n).forEach((m, q) => {
      const dx = m[0] - x, dy = m[1] - y, ca = Math.cos(m[2]), sa = Math.sin(m[2]);
      this.later(quand(m), () => {
        // (un peu de désordre le long du front et devant : les bouffées se fondent en un banc, pas en chapelet)
        const j = (rnd() - 0.5) * 3, f = 0.6 + rnd() * 2, px = ox() + dx + ca * f - sa * j, py = oy() + dy + sa * f + ca * j, sp = 3 + rnd() * 3;
        // poudre B : un voile à peine visible, un homme sur trois
        if (clean) { if (q % 3 === 0) this.puff('h', px, py, 1.5, 1 * sc, 3 * sc, 0.12, 3 + rnd() * 2, ca * sp, sa * sp, 0.1); return; }
        this.puff('f', px, py, 1.5 * sc, 2.5 * sc, (5 + rnd() * 3.5) * sc, 0.42 + rnd() * 0.12, life * (0.7 + rnd() * 0.5), ca * sp + (rnd() - 0.5) * 2, sa * sp + (rnd() - 0.5) * 2, 0.1);
      });
    });
  }
  // mitrailleuse : chaque pièce crache sa gerbe en crépitant ; un filet de fumée, presque rien sans fumée.
  // Les servants suivent (_shots : la manivelle tourne)
  crackle(f, un) {
    const sc = un._figScale ?? 1, clean = smokeless(un, this.marks);
    const M = this.bouches(un, un.x, un.y, un.dir, un.w || 40, pieces(un), (un.d || 30) / 2 - 3);
    un._shots = un._shots || {};
    M.forEach((m, q) => {
      const dx = m[0] - un.x, dy = m[1] - un.y, ca = Math.cos(m[2]), sa = Math.sin(m[2]), t0 = q * 0.1 + rnd() * 0.1;
      this.later(t0, () => { un._shots[q] = this.t; });
      for (let k = 0; k < 10; k++) this.later(t0 + k * 0.14, () => {
        const px = un.x + dx, py = un.y + dy;
        this.eclair(px, py, m[2], 0.25 * sc);
        if (k % 3 === 0) this.puff(clean ? 'h' : 'f', px + ca, py + sa, sc, 0.6 * sc, (clean ? 2 : 3) * sc, clean ? 0.1 : 0.32, clean ? 2 : 6, ca * 6, sa * 6, 0.15);
        // la gerbe hache la terre au loin
        if (f.x2 != null && rnd() < 0.5) this.terre(f.x2 + (rnd() - 0.5) * 24, f.y2 + (rnd() - 0.5) * 16, 2, 3);
      });
    });
  }
  cannon(f, un, grape) {
    const dx = (f.x2 ?? f.x + 1) - f.x, dy = (f.y2 ?? f.y) - f.y, d = Math.hypot(dx, dy) || 1, fx = this.fxq;
    // une bouche par pièce ; sans la batterie, n pièces (la maquette y met le nombre de pièces ; le serveur, les pertes)
    const p = un ? pieces(un) : clamp(f.n || 1, 1, 8);
    const M = this.bouches(un, un ? un.x : f.x, un ? un.y : f.y, un ? un.dir : Math.atan2(dy, dx), un ? un.w : 60, p, (un?.d || 30) / 2 - 3);
    const sc = un?._figScale ?? 1, clean = !!un && smokeless(un, this.marks);
    const ux = un ? un.x : f.x, uy = un ? un.y : f.y;
    if (un) un._shots = un._shots || {};
    M.forEach((m, q) => {
      const ox = m[0] - ux, oy = m[1] - uy, ca = Math.cos(m[2]), sa = Math.sin(m[2]);
      this.later(q * 0.18 + rnd() * 0.12, () => {
        const px = (un ? un.x : ux) + ox, py = (un ? un.y : uy) + oy;
        if (un) un._shots[q] = this.t;
        this.eclair(px, py, m[2], (grape ? 0.55 : 0.48) * sc);
        // la bouffée : poussée en avant, épaisse, qui s'élargit ; la poussière du souffle au ras du sol
        if (clean) this.puff('h', px + ca * 3, py + sa * 3, 1.5, 1.5 * sc, 5 * sc, 0.16, 4 + rnd() * 2, ca * 10, sa * 10, 0.2);
        else for (let k = 0; k < 4 + fx; k++) this.puff(k % 2 ? 'c' : 'f', px + ca * k * 2, py + sa * k * 2, (1.8 + k * 0.5) * sc, 2 * sc, (7 + k * 1.2 + rnd() * 3) * sc, 0.55, [10, 14, 18, 22][fx] * (0.7 + rnd() * 0.4), ca * (14 + rnd() * 14) + (rnd() - 0.5) * 6, sa * (14 + rnd() * 14) + (rnd() - 0.5) * 6, k % 2 ? 0.7 : 0.25);
        if (fx >= 1) this.puff('p', px - ca * 2, py - sa * 2, 0, 1.5 * sc, 5 * sc, 0.32, 2);
        if (grape) {
          for (let k = 0; k < 14; k++) {
            const a = Math.atan2(dy, dx) + (rnd() - 0.5) * 0.28, L = d * (0.75 + rnd() * 0.35);
            if (this.streaks.length < 1200) this.streaks.push({ x: px, y: py, x1: px + Math.cos(a) * L, y1: py + Math.sin(a) * L, t: 0, life: 0.28 });
          }
          for (let k = 0; k < 5; k++) this.later(0.25, () => this.burst(f.x2 + (rnd() - 0.5) * 40, f.y2 + (rnd() - 0.5) * 25, 0.5, sc));
        } else {
          const tx = (f.x2 ?? f.x) + (rnd() - 0.5) * 30, ty = (f.y2 ?? f.y) + (rnd() - 0.5) * 20, dd = Math.hypot(tx - px, ty - py);
          if (this.balls.length < 200) this.balls.push({ x0: px, y0: py, x1: tx, y1: ty, t: 0, dur: clamp(dd / 900, 0.35, 1.6), h: 3 + dd * 0.03, bounce: 2, sc });
        }
      });
    });
  }
  // point de chute (maquette : impact) : gerbe de terre, poussière brune, trou
  burst(x, y, k = 1, sc = 1) {
    this.terre(x, y, Math.round([4, 8, 12, 16][this.fxq] * k), 6, sc);
    this.puff('t', x, y, 0, 1.5 * sc, (4 + rnd() * 2) * sc * Math.sqrt(k), 0.5, 2.4);
    this.puff('p', x + 1, y - 0.5, 0, 1 * sc, 3.5 * sc * Math.sqrt(k), 0.4, 2);
    // (le trou reste : à sa taille vraie, pas à l'échelle des figures du moment)
    if (rnd() < 0.6) this.decals.push({ k: 'trou', x, y, r: 1.4 + rnd() * 1.2 * k, a: rnd() * 3 });
  }
  // caisson qui saute : grand feu, fumée noire qui monte, mottes, éclats, braises
  explosion(x, y) {
    this.flashes.push({ x, y, a: 0, s: 0, r: 16, t: 0, life: 0.5 });
    for (let q = 0; q < 10; q++) this.puff('lueur', x + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 6, 2, 2, 5 + rnd() * 3, 0.8, 0.8 + rnd() * 0.6, 0, 0, 6);
    for (let q = 0; q < 20; q++) { const a = rnd() * TAU, r = rnd() * 12; this.puff(q % 3 ? 'n' : 't', x + Math.cos(a) * r, y + Math.sin(a) * r, 3, 3, 10 + rnd() * 10, 0.45, 10 + rnd() * 6, Math.cos(a) * 6, Math.sin(a) * 6, 2.5 + rnd() * 2); }
    for (let q = 0; q < 16; q++) { const a = rnd() * TAU, L = 15 + rnd() * 35; if (this.streaks.length < 1200) this.streaks.push({ x, y, x1: x + Math.cos(a) * L, y1: y + Math.sin(a) * L, t: 0, life: 0.45, dark: true }); }
    this.terre(x, y, 30, 14);
    for (let q = 0; q < 14; q++) { const a = rnd() * TAU, v = 2 + rnd() * 5; this.bit(x, y, Math.cos(a) * v, Math.sin(a) * v, 1, 3 + rnd() * 4, 2 + rnd() * 2, 'm', 0.3); }
    this.decals.push({ k: 'trou', x, y, r: 6, a: 0 });
  }
  // poussière sous les sabots d'une charge
  trail(x, y, dir, w, sc = 1) {
    if (rnd() > [0.25, 0.4, 0.55, 0.7][this.fxq]) return;
    const c = Math.cos(dir), s = Math.sin(dir), u = (rnd() - 0.5) * w;
    this.puff('p', x - c * 8 * sc - s * u, y - s * 8 * sc + c * u, 0.5 * sc, 1.5 * sc, (5 + rnd() * 4) * sc, 0.42, 2.2 + rnd() * 1.2, -c * 3, -s * 3, 0.5);
  }

  // ------------------------------------------------------------------ animation
  update(dt, wind) {
    this.t += dt;
    let wx = clamp(wind?.[0] ?? 1.5, -12, 12), wy = clamp(wind?.[1] ?? 0.5, -12, 12);
    // toujours une petite brise : la fumée finit par s'en aller
    const wl = Math.hypot(wx, wy);
    if (wl < 1.2) { const a = wl > 0.01 ? Math.atan2(wy, wx) : 0.4; wx = Math.cos(a) * 1.2; wy = Math.sin(a) * 1.2; }
    this.wind = [wx, wy];
    // les effets dus (ceux qu'ils ajoutent à la file attendent l'image suivante)
    const due = [];
    this.queue = this.queue.filter(e => e.at > this.t || !due.push(e));
    for (const e of due) { if (e.fn) e.fn(); else this.spawn(e.f, e.unit); }
    const P = this.puffs, drag = Math.exp(-dt * 1.6);
    let n = 0;
    for (const p of P) {
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vx *= drag; p.vy *= drag;
      // le vent emporte la fumée, d'autant plus qu'elle est montée
      const lift = 1 + Math.min(0.8, p.alt * 0.06);
      p.x += (p.vx + wx * lift) * dt; p.y += (p.vy + wy * lift) * dt; p.alt += p.valt * dt;
      P[n++] = p;
    }
    P.length = n;
    const vivant = A => { let m = 0; for (const f of A) if ((f.t += dt) < f.life) A[m++] = f; A.length = m; };
    vivant(this.flashes); vivant(this.streaks);
    let m = 0;
    for (const b of this.bits) {
      b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.valt -= 9.8 * dt; b.alt += b.valt * dt;
      if (b.alt < 0) { b.alt = 0; b.valt = 0; b.vx *= 0.2; b.vy *= 0.2; }   // la motte retombe et reste un instant
      if (b.t < b.life) this.bits[m++] = b;
    }
    this.bits.length = m;
    const still = [];
    for (const b of this.balls) {
      b.t += dt;
      if (b.t < b.dur) { still.push(b); continue; }
      this.burst(b.x1, b.y1, 0.8, b.sc);
      if (b.bounce > 0) {   // ricochet : repart plus bas, plus court
        const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
        still.push({ x0: b.x1, y0: b.y1, x1: b.x1 + dx * 0.22, y1: b.y1 + dy * 0.22, t: 0, dur: b.dur * 0.35, h: b.h * 0.18, bounce: b.bounce - 1, sc: b.sc });
      }
    }
    this.balls = still;
  }

  // ------------------------------------------------------------------ dessin (calque 5, en mètres)
  // un calque flou à basse définition (res pixels par pixel CSS), vidé, en mètres ; poser() l'étend sur l'image
  basse(nom, view, res) {
    const W = Math.ceil(view.vw * res), H = Math.ceil(view.vh * res), z = view.z;
    const cv = this[nom] ??= canvas(W, H), g = cv.getContext('2d');
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, W, H);
    g.setTransform(res * z, 0, 0, res * z, res * (view.vw / 2 - view.cam.x * z), res * (view.vh / 2 - view.cam.y * z));
    return g;
  }
  poser(ctx, view, cv) { ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(cv, 0, 0, view.vw, view.vh); }
  draw(ctx, view) {
    view.monde(ctx);
    const z = view.z, hw = view.vw / 2 / z + 30, hh = view.vh / 2 / z + 30, cx = view.cam.x, cy = view.cam.y;
    const vu = (x, y, r) => Math.abs(x - cx) < hw + r && Math.abs(y - cy) < hh + r;
    const px = 1 / z;   // un pixel, en mètres : les petits effets restent visibles de loin
    ctx.globalCompositeOperation = 'source-over';
    // mottes (rabattues vers le haut de l'écran selon leur hauteur, comme la maquette), d'un tracé par couleur
    for (const [c, col] of [[0, '#5b412b'], [1, '#86683f']]) {
      ctx.fillStyle = col; ctx.globalAlpha = 1; ctx.beginPath();
      for (const b of this.bits) {
        if (b.c !== c || !vu(b.x, b.y, 2)) continue;
        const s = Math.max(b.sz, px * 1.2) * Math.min(1, (b.life - b.t) * 3);
        ctx.rect(b.x - s / 2, b.y - b.alt * 0.4 - s / 2, s, s);
      }
      ctx.fill();
    }
    // mitraille, éclats : de courts traits
    if (this.streaks.length) {
      ctx.lineWidth = Math.max(0.15, px); ctx.strokeStyle = 'rgba(60,52,40,0.55)'; ctx.beginPath();
      for (const s of this.streaks) {
        const k = s.t / s.life, a = Math.max(0, k - 0.12);
        ctx.moveTo(s.x + (s.x1 - s.x) * a, s.y + (s.y1 - s.y) * a); ctx.lineTo(s.x + (s.x1 - s.x) * k, s.y + (s.y1 - s.y) * k);
      }
      ctx.stroke();
    }
    // fumées et poussières (maquette : grossit vite puis lentement, apparaît vite, s'efface lentement) ; de très près,
    // la fumée s'éclaircit : on voit encore les hommes au travers
    // Elles sont floues : peintes sur un calque à basse définition (res pixels par pixel CSS), posé d'un coup, sinon
    // le recouvrement de 1 500 taches coûte plus que tout le reste de l'image
    const thin = clamp(1.2 - z / 40, 0.55, 1), S = this.S;
    if (this.puffs.length) {
      const g = this.basse('couche', view, [0.35, 0.5, 0.5, 0.75][this.fxq]);
      let n = 0;
      for (const p of this.puffs) {
        const k = p.t / p.life, r = p.r0 + (p.r1 - p.r0) * (1 - (1 - k) ** 2);
        if (!vu(p.x, p.y, r)) continue;
        const a = p.a * (k < 0.06 ? k / 0.06 : (1 - k) ** 1.3) * (p.s === 'f' ? thin : 1);
        if (a < 0.01) continue;
        g.globalAlpha = a; g.drawImage(S[p.s], p.x - r, p.y - r, r * 2, r * 2); n++;
      }
      if (n) { this.poser(ctx, view, this.couche); view.monde(ctx); }
    }
    // boulets : l'ombre au sol, le boulet au-dessus, en cloche (maquette : boulet)
    if (this.balls.length) {
      const pos = this.balls.map(b => { const k = b.t / b.dur; return [lerp(b.x0, b.x1, k), lerp(b.y0, b.y1, k), 4 * b.h * k * (1 - k), Math.max(0.3 * b.sc, px * 1.4)]; });
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath();
      for (const [x, y, , r] of pos) { ctx.moveTo(x + r * 0.8, y); ctx.arc(x, y, r * 0.8, 0, TAU); }
      ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#1d1d1d'; ctx.beginPath();
      for (const [x, y, h, r] of pos) { ctx.moveTo(x + r, y - h); ctx.arc(x, y - h, r, 0, TAU); }
      ctx.fill();
    }
    // ce qui brille s'ajoute à la lumière : éclairs, feux, étincelles, braises
    ctx.globalCompositeOperation = 'lighter';
    const m = view.dpr * z, ox = view.dpr * (view.vw / 2 - cx * z), oy = view.dpr * (view.vh / 2 - cy * z);
    for (const f of this.flashes) {
      if (!vu(f.x, f.y, 20)) continue;
      const k = 1 - f.t / f.life;
      if (f.r) { const r = f.r * (0.6 + k * 0.6); ctx.globalAlpha = k; ctx.drawImage(S.fl, f.x - r, f.y - r, r * 2, r * 2); continue; }
      const s = Math.max(f.s, px * 2.5) / ES, c = Math.cos(f.a) * m * s, sn = Math.sin(f.a) * m * s;
      ctx.setTransform(c, sn, -sn, c, ox + f.x * m, oy + f.y * m);
      ctx.globalAlpha = Math.min(1, k * 1.6); ctx.drawImage(S.e, -EX, -32);
    }
    view.monde(ctx);
    for (const b of this.bits) {
      if (typeof b.c === 'number' || !vu(b.x, b.y, 2)) continue;
      const k = 1 - b.t / b.life;
      if (b.c === 'e') {   // étincelle de mêlée : une petite croix (maquette : etincelle)
        ctx.globalAlpha = k; ctx.strokeStyle = '#fffbe8'; ctx.lineWidth = Math.max(0.05, px); ctx.beginPath();
        for (let i = 0; i < 4; i++) { const a = b.vx + i * TAU / 4 + b.t * 9; ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a) * 0.25, b.y + Math.sin(a) * 0.25); }
        ctx.stroke();
      } else {   // braise qui palpite
        const r = Math.max(b.sz, px * 1.5);
        ctx.globalAlpha = k * (0.55 + 0.45 * Math.sin(b.t * 31 + b.x)); ctx.drawImage(S.lueur, b.x - r * 2, b.y - b.alt * 0.4 - r * 2, r * 4, r * 4);
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ atmosphère
  // La lumière de l'heure pour l'état du ciel st ({weather, light, hour, wind}) et la saison, d'après la table des
  // heures (heures.js), sans WebGL :
  //   he : heure de la table ; sunDir : direction du soleil [est, haut, sud] (unitaire) ;
  //   ombre : { dx, dy, a } décalage au sol des ombres (m par m de hauteur, vers l'opposé du soleil) et leur force (0 à 1) ;
  //   voile : [r, g, b, a] teinte à poser sur toute l'image en 'multiply' (couleurs 0 à 255 ; a = 0 : rien) ;
  //   desat : part de gris à poser en 'saturation' (0 à 0,6) ; nuit : 0 le jour, 1 la nuit ; brume : 0 à 1 ;
  //   nuages : force des ombres des nuages (0 à 1) ; flash : éclair d'orage en cours (0 à 0,5)
  ciel(st, season) {
    const w = METEO[st.weather] ? st.weather : 'soleil', M = METEO[w];
    const L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12, he = heureEffective(h, L), row = ligne(he);
    const emax = ({ ete: 62, printemps: 47, automne: 40, hiver: 26 }[season] ?? 45) * Math.PI / 180;
    const el = Math.max(0.06, emax * Math.sin(Math.PI * clamp((h - 6) / 14, 0, 1))), az = (90 + (h - 6) * 15) * Math.PI / 180;
    const sx = Math.sin(az), sy = -Math.cos(az);
    const wet = w === 'pluie' || w === 'orage' || w === 'tempete', dull = wet || w === 'brouillard' || w === 'nuages' || w === 'neige';
    const long = Math.min(4, Math.cos(el) / Math.sin(el));
    // la couleur de la lumière : le soleil, et le ciel quand il baisse ; rapportée à celle de midi (midi : neutre)
    const NOON = [1, 0.95, 0.87];
    let col = row.sun.map((s, i) => lerp(row.sky[i] * row.skyI, s, row.sunI) / NOON[i]);
    const lum = (col[0] + col[1] + col[2]) / 3;
    if (dull) col = col.map(v => lerp(v, lum, 0.5));
    const dim = { nuages: 0.94, pluie: 0.86, orage: 0.8, tempete: 0.8, brouillard: 0.95 }[w] ?? 1;
    const mult = col.map(v => clamp(1 - (1 - clamp(v * dim, 0, 1)) * 0.6, 0, 1));
    const a = 1 - Math.min(...mult);
    const voile = a < 0.01 ? [255, 255, 255, 0] : [...mult.map(v => Math.round((1 - (1 - v) / a) * 255)), a];
    const matin = clamp((9 - he) / 2.5, 0, 1) * (he < 20 ? 1 : 0);
    return {
      he, sunDir: [sx * Math.cos(el), Math.sin(el), sy * Math.cos(el)],
      ombre: { dx: -sx * long, dy: -sy * long, a: clamp(row.sunI * (dull ? 0.35 : 1), 0, 1) },
      voile, desat: clamp(1 - (row.g.sat * (dull ? 0.85 : 1)), 0, 0.6),
      nuit: clamp((he - 19) / 2, 0, 1), brume: w === 'brouillard' ? 1 : clamp(matin * 0.5 + (wet ? 0.2 : 0), 0, 1),
      nuages: (M.cloud ?? 0) * L * (this.q?.clouds !== false ? 1 : 0), flash: Math.max(0, this.flashT),
    };
  }
  // st : {weather, light, hour (nombre), wind, season} ; view : caméra (SPEC-2D § 2) ; dt en s. Après draw : bancs de
  // brume et ombres des nuages en mètres, puis la teinte de l'heure, la nuit, la pluie, la neige et l'orage à l'écran.
  // Laisse ctx en pixels CSS (setTransform(dpr, 0, 0, dpr, 0, 0)).
  atmosphere(ctx, view, st, dt, time) {
    const vw = view.vw, vh = view.vh, dpr = view.dpr, z = view.z, w = st.weather || 'soleil', fx = this.fxq;
    const wind = st.wind || [1.5, 0.5], wet = w === 'pluie' || w === 'orage' || w === 'tempete';
    const C = this.ciel(st, st.season);
    // bancs de brume et ombres des nuages : de grandes taches posées sur le terrain, qui passent avec le vent
    const nb = C.brume > 0.05 ? [6, 10, 14, 18][fx] : 0, nn = C.nuages > 0.05 ? [0, 4, 6, 8][fx] : 0;
    if (nb + nn) {
      const span = Math.max(vw, vh) / z / 2 + 300, cx = view.cam.x, cy = view.cam.y;
      while (this.bancs.length < nb + nn) this.bancs.push({ x: cx + (rnd() - 0.5) * 2 * span, y: cy + (rnd() - 0.5) * 2 * span, r: 120 + rnd() * 220, ph: rnd() * TAU });
      this.bancs.length = nb + nn;
      const g = this.basse('ciels', view, 0.125);
      this.bancs.forEach((b, i) => {
        b.x += wind[0] * dt * 2; b.y += wind[1] * dt * 2;
        // sorti de la vue : revient de l'autre côté
        if (b.x - cx > span) b.x -= 2 * span; else if (cx - b.x > span) b.x += 2 * span;
        if (b.y - cy > span) b.y -= 2 * span; else if (cy - b.y > span) b.y += 2 * span;
        const brume = i < nb, r = b.r * (brume ? 1 : 1.6);
        g.globalAlpha = brume ? C.brume * (0.35 + 0.15 * Math.sin(time * 0.1 + b.ph)) : C.nuages * 0.45;
        g.drawImage(brume ? this.S.brume : this.S.nuage, b.x - r, b.y - r * 0.7, r * 2, r * 1.4);
      });
      this.poser(ctx, view, this.ciels);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // la teinte de l'heure (matin doré, couchant orangé, nuit bleue), puis les couleurs éteintes du soir et du gris
    if (C.voile[3] > 0) {
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = C.voile[3];
      ctx.fillStyle = `rgb(${C.voile[0]},${C.voile[1]},${C.voile[2]})`; ctx.fillRect(0, 0, vw, vh);
    }
    if (C.desat > 0.02) {
      ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = C.desat;
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, vw, vh);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // les bords de l'image plus sombres quand la nuit tombe (un seul dégradé par image)
    const L = clamp(st.light ?? 1, 0, 1), k = Math.max(clamp((1 - L) / 0.8, 0, 1), C.nuit), vk = fx >= 3 ? 0.16 : 0;
    if (vk || k > 0.05) {
      const vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.62);
      vig.addColorStop(0, 'rgba(12,18,40,0)'); vig.addColorStop(1, `rgba(12,18,40,${Math.max(vk, 0.55 * k)})`);
      ctx.fillStyle = vig; ctx.fillRect(0, 0, vw, vh);
    }
    // pluie : des traits penchés par le vent
    if (wet) {
      const n = Math.round((w === 'pluie' ? 240 : 380) * [0.5, 0.75, 1, 1.3][fx]), ang = clamp(wind[0] * 0.05, -0.5, 0.5);
      while (this.rain.length < n) this.rain.push({ x: rnd() * vw, y: rnd() * vh, l: 10 + rnd() * 14, v: 900 + rnd() * 500 });
      this.rain.length = n;
      ctx.strokeStyle = 'rgba(210,225,240,0.38)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const r of this.rain) {
        r.y += r.v * dt; r.x += r.v * ang * dt;
        if (r.y > vh) { r.y = -r.l; r.x = rnd() * vw; }
        if (r.x > vw) r.x -= vw; else if (r.x < 0) r.x += vw;
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.l * ang, r.y - r.l);
      }
      ctx.stroke();
    } else this.rain.length = 0;
    // neige
    if (w === 'neige') {
      const n = Math.round(320 * [0.5, 0.75, 1, 1.3][fx]);
      while (this.snow.length < n) this.snow.push({ x: rnd() * vw, y: rnd() * vh, r: 0.8 + rnd() * 2, v: 25 + rnd() * 45, ph: rnd() * 6 });
      this.snow.length = n;
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath();
      for (const f of this.snow) {
        f.y += f.v * dt; f.x += (Math.sin(time * 1.3 + f.ph) * 14 + wind[0] * 6) * dt;
        if (f.y > vh) { f.y = -4; f.x = rnd() * vw; }
        if (f.x > vw) f.x -= vw; else if (f.x < 0) f.x += vw;
        ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(235,240,248,0.08)'; ctx.fillRect(0, 0, vw, vh);
    } else this.snow.length = 0;
    // orage : éclairs
    if (w === 'orage' || w === 'tempete') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + rnd() * 9; this.flashT = 0.5;
        const pts = [[rnd() * vw, -10]];
        for (let q = 0; q < 9; q++) { const p = pts[pts.length - 1]; pts.push([p[0] + (rnd() - 0.5) * 90, p[1] + vh * 0.06 + rnd() * vh * 0.05]); }
        this.bolt = pts;
      }
      if (this.flashT > 0) {
        this.flashT -= dt;
        const kk = this.flashT / 0.5, flick = kk > 0.6 || (kk > 0.25 && kk < 0.4) ? 1 : 0.3;
        ctx.fillStyle = `rgba(235,240,255,${0.45 * kk * flick})`; ctx.fillRect(0, 0, vw, vh);
        if (this.bolt && kk > 0.5) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.2; ctx.beginPath();
          this.bolt.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
        }
      }
    }
    // canicule : air qui tremble (voile clair en haut de l'écran)
    if (w === 'canicule') {
      const gr = ctx.createLinearGradient(0, 0, 0, vh * 0.5);
      gr.addColorStop(0, 'rgba(255,240,210,0.28)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh * 0.5);
    }
  }
}
