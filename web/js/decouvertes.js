// Les découvertes (SPEC-SUITE, partie I ; SPEC-TECH, phase 3). Quand une de vos recherches aboutit :
//   - si elle se voit sur la carte (rules.VISUALS : rails, télégraphe, usines, pins…), la caméra va à votre chef-lieu
//     et un éclat d'or s'y ouvre, puis la fenêtre paraît ;
//   - la fenêtre de découverte (thème ardoise) : le nom, la date, la branche, ce que cela change, et une vignette
//     animée dessinée par le code, d'une famille parmi une dizaine (vapeur, canon, moisson, vigne, télégraphe,
//     forge, phare, médecine, livre).
// Les découvertes marquantes des IA arrivent en bandeau, avec un éclat sur leur chef-lieu, sans arrêter le jeu.
// La frise de vos découvertes est dans le panneau des technologies (ui.js, techModal).
import { esc } from './battle/formes.js';

const TAU = Math.PI * 2;

// famille de la vignette d'une technologie (id, branche)
export function famille(t) {
  const id = t.id;
  if (/chappe|telegraphe|telephone/.test(id)) return 'telegraphe';
  if (/vapeur|chemins_fer|rail|electricite|manufactures|moissonneuses/.test(id)) return 'vapeur';
  if (/fresnel|phare|gabares|canal/.test(id)) return 'phare';
  if (/vaccine|croix_rouge|larrey|hopit|quinine|medecine/.test(id)) return 'medecine';
  if (/hauts_fourneaux|coke|acier|fonderie|armureries|forge/.test(id)) return 'forge';
  if (/chais|greffe|bouillie|vin/.test(id)) return 'vigne';
  if (t.branch === 'militaire') return 'canon';
  if (t.branch === 'agricole') return 'moisson';
  if (t.branch === 'industriel') return 'vapeur';
  return 'livre';
}

// une vignette animée de la famille fam, sur g (w × h), au temps t (s)
export function vignette(g, w, h, fam, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9fb8c8'); sky.addColorStop(0.62, '#e6dcc2'); sky.addColorStop(0.62, '#8f9a58'); sky.addColorStop(1, '#5f6b38');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const gy = h * 0.62, puff = (x, y, r, a) => { g.fillStyle = `rgba(236,232,224,${a})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const dark = '#2b2620';
  switch (fam) {
    case 'vapeur': {   // une locomotive qui passe, son panache
      const x = ((t * 40) % (w + 160)) - 120;
      g.fillStyle = '#4a3a2a'; g.fillRect(0, gy - 4, w, 4);
      g.fillStyle = dark; g.fillRect(x, gy - 30, 70, 22); g.fillRect(x + 50, gy - 44, 20, 14); g.fillRect(x + 8, gy - 42, 9, 12);
      g.fillStyle = '#7a2a22'; g.fillRect(x - 46, gy - 26, 40, 18);
      for (const wx of [x + 12, x + 32, x + 56, x - 36, x - 16]) { g.fillStyle = '#1a1612'; g.beginPath(); g.arc(wx, gy - 6, 6, 0, TAU); g.fill(); }
      for (let q = 0; q < 6; q++) { const u = (t * 0.8 + q / 6) % 1; puff(x + 12 - u * 70, gy - 46 - u * 30, 5 + u * 14, 0.7 * (1 - u)); }
      break;
    }
    case 'canon': {   // une pièce qui tire, recul et fumée
      const c = (t % 2.4), k = c < 0.15 ? c / 0.15 : Math.max(0, 1 - (c - 0.15) / 0.3);
      g.save(); g.translate(w * 0.35 - k * 6, gy - 12);
      g.fillStyle = '#5f6b3e'; g.fillRect(-26, 2, 34, 6);
      g.fillStyle = '#b08a3e'; g.fillRect(-6, -6, 46, 9);
      g.fillStyle = '#4a3420'; g.beginPath(); g.arc(-4, 10, 11, 0, TAU); g.fill(); g.fillStyle = '#6e5134'; g.beginPath(); g.arc(-4, 10, 7, 0, TAU); g.fill();
      g.restore();
      if (c < 0.12) { g.fillStyle = 'rgba(255,220,140,0.95)'; g.beginPath(); g.arc(w * 0.35 + 46, gy - 14, 9, 0, TAU); g.fill(); }
      for (let q = 0; q < 5; q++) { const u = Math.min(1, c / 2.2 + q * 0.04); puff(w * 0.35 + 50 + u * 60 + q * 8, gy - 14 - u * 18, 6 + u * 20, 0.75 * (1 - u)); }
      break;
    }
    case 'moisson': {   // des épis qui ondulent au vent
      for (let k = 0; k < 70; k++) {
        const x = (k / 70) * w + 4, s = Math.sin(t * 2 + k * 0.4) * 4;
        g.strokeStyle = k % 3 ? '#c9a94a' : '#b8923a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + s * 0.5, gy + 10, x + s, gy - 6 - (k % 4) * 3); g.stroke();
        g.fillStyle = '#d9b85a'; g.beginPath(); g.ellipse(x + s, gy - 9 - (k % 4) * 3, 2, 5, s * 0.05, 0, TAU); g.fill();
      }
      break;
    }
    case 'vigne': {   // rangs de vigne et un vendangeur
      for (let r = 0; r < 5; r++) {
        const y = gy + 6 + r * 9;
        g.strokeStyle = '#4a3420'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        for (let k = 0; k < 16; k++) { g.fillStyle = (k + r) % 3 ? '#4f6b2a' : '#6a8a34'; g.beginPath(); g.arc(k * w / 15 + (r % 2) * 6, y - 3, 4.5, 0, TAU); g.fill(); }
      }
      const x = w * 0.2 + (Math.sin(t * 0.5) * 0.5 + 0.5) * w * 0.6;
      g.fillStyle = '#6a3a2a'; g.fillRect(x - 3, gy - 14, 6, 12); g.fillStyle = '#e2b996'; g.beginPath(); g.arc(x, gy - 17, 3.5, 0, TAU); g.fill();
      g.fillStyle = '#5a2a4a'; g.beginPath(); g.arc(x + 7, gy - 6, 4, 0, TAU); g.fill();
      break;
    }
    case 'telegraphe': {   // une tour Chappe qui bat des bras
      g.fillStyle = '#d8ccb0'; g.fillRect(w * 0.45, gy - 34, 22, 34);
      g.strokeStyle = dark; g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.45 + 11, gy - 34); g.lineTo(w * 0.45 + 11, gy - 70); g.stroke();
      const a = Math.round(Math.sin(t * 0.9) * 2) * 0.4, b = Math.sin(t * 1.7) * 1.4, c = Math.cos(t * 1.3) * 1.4;
      g.save(); g.translate(w * 0.45 + 11, gy - 68); g.rotate(a);
      g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.stroke();
      g.lineWidth = 2.5; for (const [px, r] of [[-22, b], [22, c]]) { g.beginPath(); g.moveTo(px, 0); g.lineTo(px + Math.cos(r) * 12, Math.sin(r) * 12); g.stroke(); }
      g.restore();
      break;
    }
    case 'forge': {   // un haut fourneau, sa lueur et ses étincelles
      g.fillStyle = '#6a4a3a'; g.beginPath(); g.moveTo(w * 0.4, gy); g.lineTo(w * 0.44, gy - 46); g.lineTo(w * 0.56, gy - 46); g.lineTo(w * 0.6, gy); g.fill();
      const k = 0.6 + 0.3 * Math.sin(t * 6);
      const gl = g.createRadialGradient(w * 0.5, gy - 8, 0, w * 0.5, gy - 8, 30); gl.addColorStop(0, `rgba(255,170,60,${k})`); gl.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(w * 0.5, gy - 8, 30, 0, TAU); g.fill();
      for (let q = 0; q < 14; q++) { const u = (t * 0.9 + q / 14) % 1; g.fillStyle = `rgba(255,200,90,${1 - u})`; g.fillRect(w * 0.5 + Math.sin(q * 7.1) * u * 30, gy - 48 - u * 40, 2, 2); }
      for (let q = 0; q < 4; q++) { const u = (t * 0.4 + q / 4) % 1; g.fillStyle = `rgba(80,74,70,${0.6 * (1 - u)})`; g.beginPath(); g.arc(w * 0.5 + u * 30, gy - 50 - u * 30, 6 + u * 14, 0, TAU); g.fill(); }
      break;
    }
    case 'phare': {   // un phare sur son rocher, le faisceau qui tourne sur la mer
      g.fillStyle = '#3f6f78'; g.fillRect(0, gy, w, h - gy);
      const a = t * 0.9, len = w * 0.6;
      for (const s of [0, Math.PI]) {
        const dx = Math.cos(a + s), gr = g.createLinearGradient(w * 0.5, gy - 52, w * 0.5 + dx * len, gy - 52);
        gr.addColorStop(0, 'rgba(255,244,190,0.6)'); gr.addColorStop(1, 'rgba(255,244,190,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(w * 0.5, gy - 52); g.lineTo(w * 0.5 + dx * len, gy - 62); g.lineTo(w * 0.5 + dx * len, gy - 42); g.closePath(); g.fill();
      }
      g.fillStyle = '#8a8270'; g.beginPath(); g.ellipse(w * 0.5, gy + 2, 26, 7, 0, 0, TAU); g.fill();
      g.fillStyle = '#f4efe2'; g.beginPath(); g.moveTo(w * 0.5 - 9, gy); g.lineTo(w * 0.5 - 5, gy - 50); g.lineTo(w * 0.5 + 5, gy - 50); g.lineTo(w * 0.5 + 9, gy); g.fill();
      g.fillStyle = 'rgba(255,226,120,0.95)'; g.beginPath(); g.arc(w * 0.5, gy - 53, 4, 0, TAU); g.fill();
      break;
    }
    case 'medecine': {   // une tente d'ambulance, la croix et le brancard
      g.fillStyle = '#e8e0cc'; g.beginPath(); g.moveTo(w * 0.3, gy); g.lineTo(w * 0.42, gy - 40); g.lineTo(w * 0.58, gy - 40); g.lineTo(w * 0.7, gy); g.fill();
      g.fillStyle = '#c0392b'; g.fillRect(w * 0.5 - 3, gy - 34, 6, 18); g.fillRect(w * 0.5 - 9, gy - 28, 18, 6);
      const x = ((t * 25) % (w * 0.5)) + w * 0.05;
      g.fillStyle = '#4a3420'; g.fillRect(x, gy - 8, 34, 3);
      for (const px of [x - 4, x + 34]) { g.fillStyle = '#2b3d7a'; g.fillRect(px, gy - 20, 6, 12); g.fillStyle = '#e2b996'; g.beginPath(); g.arc(px + 3, gy - 23, 3, 0, TAU); g.fill(); }
      break;
    }
    default: {   // un livre dont les pages tournent
      g.fillStyle = '#5a3d22'; g.fillRect(w * 0.3, gy - 6, w * 0.4, 8);
      g.fillStyle = '#f2ead6'; g.fillRect(w * 0.3 + 2, gy - 40, w * 0.2 - 2, 34); g.fillRect(w * 0.5, gy - 40, w * 0.2 - 2, 34);
      const k = (t * 0.5) % 1, px = w * 0.5 + Math.cos(k * Math.PI) * w * 0.2;
      g.fillStyle = '#fbf6e8'; g.beginPath(); g.moveTo(w * 0.5, gy - 40); g.lineTo(px, gy - 40 - Math.sin(k * Math.PI) * 10); g.lineTo(px, gy - 6 - Math.sin(k * Math.PI) * 10); g.lineTo(w * 0.5, gy - 6); g.fill();
      g.strokeStyle = 'rgba(60,44,26,0.35)'; g.lineWidth = 1;
      for (let l = 0; l < 6; l++) { g.beginPath(); g.moveTo(w * 0.32, gy - 34 + l * 5); g.lineTo(w * 0.48, gy - 34 + l * 5); g.moveTo(w * 0.52, gy - 34 + l * 5); g.lineTo(w * 0.68, gy - 34 + l * 5); g.stroke(); }
    }
  }
  // cadre gravé
  g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
}

export class Decouvertes {
  constructor(ui) { this.ui = ui; this.tech = null; this.raf = 0; }
  techOf(id) { return this.ui.rules.techs.find(t => t.id === id); }
  // un événement du journal (ui.js onEvent) ; initial : relu au chargement (rien ne s'anime)
  onEvent(ev, initial) {
    if (initial) return;
    if (ev.kind === 'tech' && ev.tech) this.decouverte(ev.tech);
    else if (ev.kind === 'tech_ia' && ev.who) this.eclat(ev.who, false);
  }
  // une de vos découvertes : mise en scène si elle se voit sur la carte, puis la fenêtre
  decouverte(id) {
    const t = this.techOf(id);
    if (!t) return;
    const visible = Object.values(this.ui.rules.visuals || {}).some(v => v.tech === id) || /chemins_fer|rail/.test(id);
    if (visible) this.eclat(this.ui.st.me.code, true);
    setTimeout(() => {
      if (this.ui.modal) return;   // une autre fenêtre est ouverte : l'annonce du journal suffit
      this.tech = id;
      this.ui.openModal('decouverte');
    }, visible ? 1800 : 300);
  }
  // un éclat d'or sur le chef-lieu d'un camp ; go : la caméra y va
  eclat(code, go) {
    const map = this.ui.map, cap = this.ui.rules.factions[code]?.capital;
    const n = map.nodes.find(x => x.name === cap) || map.nodes.find(x => x.dept === code && x.type === 'capitale');
    if (!n) return;
    if (go) map.moveTo(n.x, n.y, Math.max(map.cam.z, 4));
    map.flashes = map.flashes || [];
    map.flashes.push({ x: n.x, y: n.y, t0: performance.now(), col: map.colors[code] || '#e6c97f' });
  }
  html() {
    const t = this.techOf(this.tech);
    if (!t) return ['', ''];
    const LAB = { militaire: 'Militaire', civil: 'Civil et social', industriel: 'Industriel', agricole: 'Agricole' };
    const d = this.ui.st.me.tech_dates?.[t.id];
    return [`<div class="disc"><div class="disc-rib">Découverte</div><h2 class="m-title" id="m-title">${esc(t.name)}</h2>
      <p class="m-sub">${esc(LAB[t.branch] || t.branch)}${d ? ` · ${esc(d[0])}` : ''}${t.year ? ` · inventée vers ${t.year}` : ''}</p>
      <canvas class="disc-cv" width="440" height="200" aria-hidden="true"></canvas>
      <p class="disc-d">${esc(t.desc)}</p>
      <div class="btns"><button class="btn primary" data-act="close-modal">Continuer</button><button class="btn" data-act="open-tech">Voir les technologies</button></div></div>`, t.id];
  }
  // anime la vignette tant que la fenêtre est ouverte
  anime() {
    cancelAnimationFrame(this.raf);
    const t = this.techOf(this.tech), fam = t ? famille(t) : 'livre', t0 = performance.now();
    const loop = now => {
      const cv = document.querySelector('#modal .disc-cv');
      if (!cv || this.ui.modal !== 'decouverte') return;
      vignette(cv.getContext('2d'), cv.width, cv.height, fam, (now - t0) / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  // la frise de vos découvertes datées, de la plus ancienne à la plus récente
  frise() {
    const dates = Object.entries(this.ui.st.me.tech_dates || {}).sort((a, b) => a[1][1] - b[1][1]);
    if (!dates.length) return '';
    return `<div class="frise" aria-label="Frise de vos découvertes">${dates.map(([id, [d]]) => {
      const t = this.techOf(id);
      return t ? `<div class="fr-i" title="${esc(t.desc)}"><span class="fr-d">${esc(d.replace(/^\d+(er)? /, ''))}</span><span class="fr-n">${esc(t.name)}</span></div>` : '';
    }).join('')}</div>`;
  }
}
