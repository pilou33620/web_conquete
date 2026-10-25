// La vue de l'intérieur d'une ville (SPEC-CARTE-2D.md, chantier B), ouverte par « Voir l'intérieur » du panneau d'une
// place : le plan détaillé (villes.js) en plein écran, avec gestes (glisser, pincer, molette), retour, visites, et sa
// vie (passants, charrettes, bateaux, bêtes, fumées, moulins), comme la maquette (new.js, montrerVille).
// L'état de la partie la change : siège (ruines, incendies, rues vides), événement local (foire, émeute, épidémie,
// disette, incendie, crue), famine du joueur ; l'heure du jour (AMB.heure) assombrit la scène.
import {
  C, E, RR, T, TAU, KT, OMBRE, PAL, SPR, Scene, alea, angLerp, brancher, camAnim, cheval, clamp, coneF, fantassin, flammes, fumee,
  longueur, mod, sombre, surChemin, tenue,
} from './lib.js';
import { carteDe, etatVille, planDe, peindreInterieurPas, lecture, navire, cleVille, IC, IW, IH } from './villes.js';
import { AMB } from './ambiance.js';

const TYPE_TXT = { capitale: 'Capitale', ville: 'Ville', village: 'Village', fort: 'Place forte' };
const LV_TXT = {
  incendie: 'Incendie : des maisons ont brûlé', epidemie: 'Épidémie : rues vides, convois funèbres', disette: 'Disette : le marché est vide',
  foire: 'Jour de foire : étals et foule sur la place', crue: 'Crue : les quais sont sous l’eau', emeute: 'Émeute : la foule devant l’hôtel de ville',
  brigands: 'Brigands sur les routes', refugies: 'Réfugiés en ville', filon: 'Un filon découvert',
};
const HABITS = ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a', '#9a4a3a'];
const LCIV = tenue('fr', 'civil');
const TEINTE = { matin: 'rgb(255,226,196)', soir: 'rgb(236,170,128)', nuit: 'rgb(70,84,130)' };
let vue = null;   // { el, sc, raf, V, tex }
const TEX = new Map();   // les deux derniers intérieurs peints (rouvrir la même ville est immédiat)

function construire() {
  const el = document.createElement('div');
  el.id = 'vi'; el.className = 'vi'; el.hidden = true;
  el.innerHTML = `<div class="vi-barre"><div class="vi-titre"><b id="vi-nom"></b><span id="vi-sous"></span></div>
    <button class="btn" id="vi-retour">Retour à la carte</button></div>
    <div class="vi-scene"><canvas id="vi-cv" aria-label="Intérieur de la ville vu de dessus"></canvas>
      <div class="vi-outils">
        <button id="vi-zplus" aria-label="Zoomer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
        <button id="vi-zmoins" aria-label="Dézoomer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
        <button id="vi-zall" aria-label="Vue d’ensemble"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9H4z"/></svg></button>
      </div>
      <details class="vi-lecture"><summary>Ce que le générateur a lu</summary><dl id="vi-lecture"></dl></details>
    </div>
    <div class="vi-visites" id="vi-visites"><span class="lbl">Aller voir</span></div>`;
  document.body.appendChild(el);
  el.hidden = false;   // (la scène mesure son canevas à sa création)
  const sc = new Scene(el.querySelector('#vi-cv'), {
    max: 500, vie: [], zMax: 4.5,
    sol(sc, g) { const t = sc.tv; g.fillStyle = '#6c984d'; g.fillRect(0, 0, sc.W, sc.H); if (!t) return; const m = sc.m, k = t.k; g.drawImage(t.c, (sc.cx - sc.W / 2 / m) * k, (sc.cy - sc.H / 2 / m) * k, sc.W / m * k, sc.H / m * k, 0, 0, sc.W, sc.H); },
  });
  const lieu = k => () => vue?.V?.lieux[k];
  brancher(sc, IW, IH, 'vi', [
    ['La grand-place', lieu('place'), 0, 3.2], ['L’église', () => vue?.V?.lieux.eglise || vue?.V?.lieux.cathedrale, 0, 3.4], ['Le port', lieu('port'), 0, 2.6],
    ['Les remparts', () => vue?.V?.lieux.remparts || (vue?.V?.trace ? { x: vue.V.trace.V[0][0], y: vue.V.trace.V[0][1] } : null), 0, 2.6],
    ['La citadelle', lieu('citadelle'), 0, 2.6], ['Le château', lieu('chateau'), 0, 3.4], ['Les vignes', lieu('vin'), 0, 2.4], ['La gare', lieu('gare'), 0, 2.6],
    ['Les salines', lieu('sel'), 0, 3], ['Les forges', lieu('fer'), 0, 3],
  ], sc => { sc.z = Math.max(sc.zB()[0], sc.cssW / 640); sc.cx = IC[0]; sc.cy = IC[1]; });
  sc.avant = avant; sc.sous = sous; sc.dessus = dessus; sc.apres = apres;
  el.querySelector('#vi-retour').onclick = fermerInterieur;
  addEventListener('keydown', e => { if (e.key === 'Escape' && vue && !vue.el.hidden) fermerInterieur(); });
  addEventListener('resize', () => { if (vue && !vue.el.hidden) { sc.resize(); } });
  return { el, sc };
}

// o : { m (map.m), n (nœud), ns (st.nodes[id]), st, dept (nom du pays), col (couleur du maître), flag (g, x, y, h, col) }
export function ouvrirInterieur(o) {
  const t0 = performance.now();
  if (!vue) vue = construire();
  const { el, sc } = vue, n = o.n, K = carteDe(o.m), e = etatVille(n, o.ns, o.st);
  el.hidden = false; document.body.classList.add('vi-ouverte');
  sc.resize();
  const V = planDe(K, n, e), Pf = V.Pf;
  const cle = cleVille(n, e) + `|${Math.round(e.dmg * 10)}|${Math.round(e.deg * 20)}|${e.lv}|${AMB.saison}|${KT}`;
  Object.assign(vue, { V, e, col: o.col, flag: o.flag, t0, peinte: 0, o, etat: cle + `|${e.siege}|${e.blocus}|${e.famine}` });
  sc.V = V; sc.fx = []; sc.vie = []; sc.etals = []; sc.feux = []; sc.fumees = []; sc.moulins = [];
  // la texture se peint par pas pendant les premières images (peindreInterieurPas), puis la vie s'y installe
  const fini = tv => { vue.peint = null; vue.deg = tv.deg; vue.tex = tv; sc.tv = tv; vivre(sc, V, e); vue.peinte = performance.now() - t0; };
  const tv = TEX.get(cle);
  if (tv) { vue.peint = null; fini(tv); }
  else {
    const it = peindreInterieurPas(K, V, KT, e);
    sc.tv = it.next().value;
    vue.peint = { it, cle };
  }
  sc.z = Math.max(sc.zB()[0], Math.min(4, sc.cssW / (Pf.R * 2.7))); sc.cx = IC[0]; sc.cy = IC[1]; sc.vol = null; sc.suivi = null; sc.borner(); sc.marquer(null);
  el.querySelector('#vi-nom').textContent = n.name;
  el.querySelector('#vi-sous').textContent = `${TYPE_TXT[n.type] || n.type} · ${o.dept || n.dept} · ${e.annee}`;
  const etat = [e.siege ? (e.blocus ? 'bloquée' : `assiégée, ${Math.round(e.dmg * 100)} % de dégâts`) : null, e.deg >= .01 ? `${Math.round(e.deg * 100)} % de la ville en ruine` : null, e.lv ? `${LV_TXT[e.lv] || e.lv} (il y a ${e.lvAge} jours)` : null, e.famine ? 'famine : moins de monde dans les rues' : null].filter(Boolean);
  el.querySelector('#vi-lecture').innerHTML = [...lecture(Pf, V), ...(etat.length ? [['État', etat.join(' ; ')]] : [])].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  sc.majVisites();
  if (!vue.raf) {
    let tp = performance.now();
    const boucle = now => {
      if (!vue || vue.el.hidden) { vue.raf = 0; return; }
      const p = vue.peint;
      if (p) {   // 12 ms de peinture par image
        const tf = performance.now();
        for (let r; performance.now() - tf < 12;) if ((r = p.it.next()).done) { TEX.set(p.cle, r.value); while (TEX.size > 2) { const [k0, v0] = TEX.entries().next().value; TEX.delete(k0); if (v0 !== r.value) v0.c.width = v0.c.height = 0; } fini(r.value); break; }
      }
      const dt = Math.min(.05, (now - tp) / 1000); tp = now; sc.step(dt); sc.draw(); vue.raf = requestAnimationFrame(boucle);
    };
    vue.raf = requestAnimationFrame(boucle);
  }
  vue.ouverture = performance.now() - t0;   // (mesurés par les essais : ouverture, puis peinte quand la texture est finie)
  return vue.ouverture;
}
export function fermerInterieur() {
  if (!vue) return;
  vue.el.hidden = true; document.body.classList.remove('vi-ouverte');
  if (vue.raf) cancelAnimationFrame(vue.raf); vue.raf = 0;
  vue.sc.vie = []; vue.sc.fx = [];
}
export const interieurOuvert = () => !!vue && !vue.el.hidden;
// un nouvel état de la partie arrive pendant qu'on regarde la ville : si elle a changé (siège, ruines, foire,
// incendie, famine…), on la redessine sans bouger la vue
export function majInterieur(st) {
  if (!interieurOuvert() || !vue.o || !st?.nodes) return;
  const o = vue.o, ns = st.nodes[o.n.id];
  if (!ns) return;
  const e = etatVille(o.n, ns, st);
  const etat = cleVille(o.n, e) + `|${Math.round(e.dmg * 10)}|${Math.round(e.deg * 20)}|${e.lv}|${AMB.saison}|${KT}|${e.siege}|${e.blocus}|${e.famine}`;
  if (etat === vue.etat) return;
  const { cx, cy, z } = vue.sc;
  ouvrirInterieur({ ...o, ns, st });
  Object.assign(vue.sc, { cx, cy, z }); vue.sc.borner();
}
export const vueInterieur = () => vue;

// ---------- la vie : tirée du plan (mêmes rues, mêmes gens), réglée par l'état de la ville
function vivre(sc, V, e) {
  const Pf = V.Pf, R = alea(Pf.sd + 3), vie = [];
  // combien de monde dehors
  const k = (e.famine ? .4 : 1) * (e.lv === 'epidemie' ? .15 : e.lv === 'disette' ? .7 : 1) * (e.siege ? .35 : 1) * ({ nuit: .2, soir: .65 }[AMB.heure] || 1);
  const rues = V.rues.filter(r => r.pts.length > 1 && r.pts.some(p => V.ilots.some(b => Math.hypot(b.c[0] - p[0], b.c[1] - p[1]) < 40)));
  const passant = (r, v) => { const L = longueur(r.pts); return { k: 'passant', pts: r.pts, L, s: R() * L, v: (R() < .5 ? -1 : 1) * v, lat: (R() - .5) * 3, L2: Object.assign({}, LCIV, { tete: R() < .5 ? 'coiffe' : 'rond' }), habit: HABITS[R() * 6 | 0], x: 0, y: 0, a: 0, pas: R() }; };
  for (let i = 0; i < clamp(Pf.pop / 90, 14, 90) * k; i++) { const r = rues[R() * rues.length | 0]; if (!r) break; vie.push(passant(r, 1.4 + R())); }
  if (!e.siege) for (const r of V.routesL) for (let i = 0; i < 2; i++) vie.push({ k: 'charrette', pts: r.pts, L: longueur(r.pts), s: 40 + R() * 500, v: (R() < .5 ? -1 : 1) * 5, lat: 2.6, x: 0, y: 0, a: 0, pas: 0 });
  for (const rv of Pf.rivs) { const L = longueur(rv.pts); for (let i = 0; i < (Pf.port ? 6 : 2) * (e.blocus ? .3 : 1); i++) vie.push({ k: 'bateau', pts: rv.pts, L, s: R() * L, v: (R() < .5 ? -1 : 1) * (2 + R() * 2), lat: (R() - .5) * rv.w * .5, grand: Pf.port && rv.rank <= 1 && R() < .5, x: 0, y: 0, a: 0 }); }
  if (Pf.mer && Pf.port) for (let i = 0; i < 6; i++) { const a = Pf.mer.a + (R() - .5) * .8, d = Pf.R * (1.1 + R() * .8); vie.push({ k: 'mouille', x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: R() * TAU, grand: R() < .4 }); }
  // la place : badauds, foire, émeute ; vide en disette et en épidémie
  const pl = V.lieux.place;
  sc.etals = [];
  if (pl) {
    let nb = V.placeCentre ? 24 * k : 0, r0 = 15, vite = 2;
    if (e.lv === 'foire') { const rp = V.placeCentre ? 19 : 12; nb = 80; r0 = rp; for (let i = 0; i < 14; i++) { const a = i * 2.4, d = rp * (.45 + (i % 3) * .25); sc.etals.push([pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, a + Math.PI / 2, i]); } }
    if (e.lv === 'emeute') { nb = 70; r0 = 9; vite = 5; }
    if (e.lv === 'disette' || e.lv === 'epidemie') nb = 0;
    const ox = e.lv === 'emeute' ? 0 : 0, oy = e.lv === 'emeute' ? -14 : 0;   // l'attroupement devant l'hôtel de ville, au nord de la place
    for (let i = 0; i < nb; i++) vie.push({ k: 'badaud', x0: pl.x + ox, y0: pl.y + oy, r0, vite, x: pl.x + ox + (R() - .5) * r0 * 2, y: pl.y + oy + (R() - .5) * r0 * 2, a: R() * TAU, c: ['#5d6b86', '#7a4a3a', '#f2efe6', '#6e5c45', '#8a5a44', '#2f4f9c'][R() * 6 | 0], poing: e.lv === 'emeute' && R() < .3 });
  }
  // épidémie : le convoi funèbre suit une rue maîtresse
  if (e.lv === 'epidemie') { const r = V.rues.find(x => x.main && x.pts.length > 1) || rues[0]; if (r) { const L = longueur(r.pts); vie.push({ k: 'convoi', pts: r.pts, L, s: R() * L, v: 1.1, lat: 0, x: 0, y: 0, a: 0, pas: 0 }); } }
  // bêtes aux prés (pas pendant un siège : la campagne est vide)
  if (!e.siege) for (let i = 0; i < 8; i++) { const a = R() * TAU, d = Pf.R + 90 + R() * 200, x = IC[0] + Math.cos(a) * d, y = IC[1] + Math.sin(a) * d; if (!V.eau(x, y)) vie.push({ k: 'vache', x, y, a: R() * TAU, zone: [x - 30, y - 20, 60, 40], attente: R() * 4, v: 0, robe: R() < .5 ? '#efe9dd' : '#c9a07a', tache: R() < .5 ? '#3a2c22' : '#8a5a3a', pas: 0 }); }
  sc.vie = vie;
  sc.fumees = (vue.tex?.chem || V.cheminees).filter((c, i) => i % 7 === 0 && (e.lv !== 'epidemie' || i % 21 === 0));
  sc.moulins = V.plus.filter(p => p.ailes);
  // les feux : maisons qui brûlent (incendie récent), toits crevés et ruines d'un siège en cours
  sc.feux = [];
  for (const [b, kd] of vue.deg || []) {
    const brule = kd === 'brule' && e.lvAge < 8, siege = e.siege && kd !== 'brule' && R() < .35;
    if (!brule && !siege) continue;
    const r = Math.sqrt(b.aire) * .3;
    sc.feux.push({ x: b.c[0], y: b.c[1], m: { intensite: brule ? 1 : .7, w: r * 1.4, foyers: Array.from({ length: 3 }, () => ({ x: (R() - .5) * r, y: (R() - .5) * r, s: R() * 9, k: .8 + R() * .6 })) } });
  }
  if (e.lv === 'incendie' && e.lvAge >= 8 && e.lvAge < 30) for (const [b, kd] of vue.deg || []) if (kd === 'brule' && R() < .4) sc.fumees.push(b.c);   // les décombres fument encore
}
function avant(sc, dt = 0) {
  camAnim(sc);
  for (const e of sc.vie) {
    if (e.pts) { e.s = mod(e.s + e.v * dt, e.L); const p = surChemin(e.pts, e.s), a = p.a + (e.v < 0 ? Math.PI : 0); e.x = p.x - Math.sin(a) * e.lat; e.y = p.y + Math.cos(a) * e.lat; e.a = a; e.pas = (e.pas || 0) + dt * 1.6; }
    else if (e.k === 'badaud') { if (!e.tx || Math.random() < dt * .3 * e.vite) { e.tx = e.x0 + (Math.random() - .5) * e.r0 * 2.4; e.ty = e.y0 + (Math.random() - .5) * e.r0 * 2.4; } const d = Math.hypot(e.tx - e.x, e.ty - e.y); if (d > .3) { e.a = Math.atan2(e.ty - e.y, e.tx - e.x); e.x += Math.cos(e.a) * Math.min(d, e.vite * dt); e.y += Math.sin(e.a) * Math.min(d, e.vite * dt); } }
    else if (e.k === 'vache') { if (e.attente > 0) { e.attente -= dt; e.v = 0; } else { if (!e.but || Math.hypot(e.but[0] - e.x, e.but[1] - e.y) < 2) { e.but = [e.zone[0] + Math.random() * e.zone[2], e.zone[1] + Math.random() * e.zone[3]]; e.attente = 2 + Math.random() * 6; } e.a = angLerp(e.a, Math.atan2(e.but[1] - e.y, e.but[0] - e.x), dt * 2); e.v = 1.5; e.x += Math.cos(e.a) * e.v * dt; e.y += Math.sin(e.a) * e.v * dt; } }
  }
  for (const [x, y] of sc.fumees || []) if (Math.random() < dt * .25) fumee(sc, x, y, 0, 0, .6, 4.5, 4, .28);
  for (const f of sc.feux || []) if (Math.random() < dt * 3) fumee(sc, f.x + (Math.random() - .5) * 6, f.y + (Math.random() - .5) * 6, 0, 0, 2, 14, 6, .5, 'n');
}
function etal(g, k) {
  const c = ['#c8322b', '#e3c04f', '#2f4f9c', '#3f8a3c', '#8a5a44'][k % 5];
  RR(g, 'rgba(20,20,10,.3)', -2.6, -1.6, 7, 5, .4); RR(g, c, -3.5, -2.5, 7, 5, .4);
  for (let i = 0; i < 3; i++) RR(g, '#f1eee4', -3.5 + .7 + i * 2.2, -2.5, 1, 5, 0);
  for (let i = 0; i < 4; i++) C(g, ['#d6ba5c', '#9a4a3a', '#6b8f3a', '#e8dcc0'][(k + i) % 4], -2.6 + i * 1.7, 3.4, .7);
}
function sous(sc, g) {
  for (const [x, y, a, k] of sc.etals || []) { sc.fig(g, x, y, a); etal(g, k); }
  for (const e of sc.vie) {
    if (Math.abs(e.x - sc.cx) > sc.W / 2 / sc.m + 30 || Math.abs(e.y - sc.cy) > sc.H / 2 / sc.m + 30) continue;
    sc.fig(g, e.x, e.y, e.a); g.lineCap = 'round';
    if (e.k === 'passant') fantassin(g, e.L2, { role: 'h', habit: e.habit }, { legs: e.pas * TAU, arme: 'aucun' });
    else if (e.k === 'badaud') { C(g, e.c, 0, 0, .9); C(g, '#2a2420', .25, 0, .45); if (e.poing) T(g, '#e8d2b0', .35, .4, .5, 1.6, .9); }
    else if (e.k === 'charrette') { cheval(g, '#6b4a2c', { gait: e.pas * TAU, bob: 0 }); g.save(); g.translate(-9, 0); RR(g, '#3a2a1b', -3, -3.6, 6, 1, .4); RR(g, '#3a2a1b', -3, 2.6, 6, 1, .4); RR(g, '#8a6a45', -4, -2.6, 8, 5.2, .6); RR(g, '#b8a27a', -3.4, -2, 3.4, 4, .4); g.restore(); }
    else if (e.k === 'convoi') { RR(g, '#2a2420', -6, -2.6, 12, 5.2, .6); RR(g, '#5b4127', -4.5, -1.4, 9, 2.8, .4); T(g, '#efe6cc', .4, -1, 0, 2, 0); T(g, '#efe6cc', .4, 0, -1, 0, 1); g.save(); g.translate(13, 0); cheval(g, '#2e2119', { gait: e.pas * TAU * .6, bob: 0 }); g.restore(); for (let m = 0; m < 4; m++) { g.save(); g.translate(-10 - m * 4, m % 2 ? 1.5 : -1.5); fantassin(g, LCIV, { role: 'h', habit: '#1f1d1d' }, { legs: e.pas * TAU * .6 + m, arme: 'aucun' }); g.restore(); } }
    else if (e.k === 'bateau' || e.k === 'mouille') { sc.monde(g); navire(g, e.x, e.y, e.a, e.grand); }
    else if (e.k === 'vache') { E(g, e.robe, 0, 0, 4.3, 1.9); E(g, e.tache, -1.2, .5, 1.4, .9, .4); E(g, sombre(e.robe, .08), 4.6, 0, 1.4, .95); }
  }
}
// moulin vu d'en haut : les ailes tournent dans un plan vertical face au vent, on les voit donc de profil ; leur ombre
// au sol, une croix de biais, montre qu'elles tournent (la maquette, new.js)
function moulinVu(g, x, y, t, wa = .35, L = 17, H = 12) {
  const dx = Math.cos(wa), dy = Math.sin(wa), px = -dy, py = dx, sx = .34, sy = .45;
  const hx0 = x - dx * 4.5, hy0 = y - dy * 4.5;
  const bras = [0, 1, 2, 3].map(k => t * .9 + k * Math.PI / 2);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(20,20,10,.34)'; g.lineWidth = 3.2; g.beginPath();
  for (const a of bras) { const u = L * Math.cos(a), h = H + L * Math.sin(a); g.moveTo(hx0 + sx * H, hy0 + sy * H); g.lineTo(hx0 + px * u + sx * h, hy0 + py * u + sy * h); }
  g.stroke();
  T(g, '#5b4127', 1, x, y, x + dx * 13, y + dy * 13);
  C(g, OMBRE, x + 3, y + 4, 7.5); C(g, '#d8cdb5', x, y, 7); coneF(g, x, y, 5.4, PAL.ardoise, 0);
  const us = bras.map(a => L * Math.cos(a)), u0 = Math.min(...us), u1 = Math.max(...us);
  T(g, '#4a3a28', 1.6, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  T(g, '#e8e0cc', .9, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  C(g, '#3a2a1b', hx0, hy0, 1.3);
}
function dessus(sc, g) {
  sc.monde(g);
  for (const p of sc.moulins || []) moulinVu(g, p.x, p.y, sc.time + p.x);
  // le drapeau du maître de la place, au clocher ou à la citadelle
  const L = vue.V.lieux, mat = L.citadelle || L.cathedrale || L.eglise || L.chateau || L.place;
  if (mat && vue.flag && vue.col) { sc.monde(g); vue.flag(g, mat.x + 3, mat.y - 1, 9, vue.col); }
  for (const f of sc.feux || []) { sc.monde(g); g.translate(f.x, f.y); flammes(g, f.m, sc.time); }
}
function apres(sc, g) {
  const t = TEINTE[AMB.heure]; if (!t) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = t; g.fillRect(0, 0, sc.W, sc.H); g.globalCompositeOperation = 'source-over';
  if (AMB.heure === 'nuit') { g.fillStyle = 'rgba(8,12,34,.25)'; g.fillRect(0, 0, sc.W, sc.H); }
  if (sc.feux?.length && AMB.heure !== 'matin') { sc.monde(g); g.globalCompositeOperation = 'lighter'; for (const f of sc.feux) { const r = f.m.w * 3; g.globalAlpha = .5; g.drawImage(SPR.lueur, f.x - r, f.y - r, r * 2, r * 2); } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
}
