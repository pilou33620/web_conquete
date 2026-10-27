// « Donner mes ordres » : la fenêtre des ordres sur le champ de bataille vu de dessus, puis le film de la bataille que
// vos officiers livrent selon ces ordres (bandeau, caméra qui suit l'action, moment décisif). Les choix, ce qui les
// verrouille, l'avis du général et le rapport des éclaireurs viennent du serveur (game/tactics/orders.py) ; à chaque
// choix, le serveur redéploie vos troupes et la vue les montre à leur nouvelle place. Le récapitulatif de fin reste
// celui de interface.js (avec les pertes par arme et ce qui a décidé la journée). Sur la carte : les flèches de la
// manœuvre pendant les ordres ; pendant le film, des étiquettes là où il se passe quelque chose (charge, carré,
// déroute, mêlée) et, sur la barre de la journée, un repère par grand moment : le toucher y emmène la caméra.
import { esc, clamp, clsOf } from './formes.js';

const CAM_EVERY = 2600;  // la caméra du film cherche l'action toutes les 2,6 s
const ACTIVE = { melee: 3, charge: 3, feu: 1, recharge: 1, deroute: 1.5 };
// les flèches au sol, par sorte (orders.arrows) : couleur, épaisseur (m à l'écran), pointillés, pointe
const ARROW = {
  main: ['255,214,120', 7, null, true], fix: ['255,226,150', 3.5, [10, 8], true], feint: ['255,160,90', 4, [10, 7], true],
  raid: ['150,200,255', 4.5, [12, 7], true], hidden: ['140,215,130', 6, [3, 7], true], counter: ['255,120,95', 5, null, true],
  fire: ['255,120,95', 1.6, [4, 6], false],
};
// les étiquettes du film : ce qui change chez un régiment visible
// (par ordre d'importance : une seule étiquette par relevé)
const EVENTS = [
  [(u, p) => u.state === 'deroute' && p.state !== 'deroute', (u, me) => u.side === me ? 'En déroute' : 'L’ennemi plie'],
  [(u, p) => u.state === 'charge' && p.state !== 'charge' && clsOf(u) === 'cavalerie', (u, me) => u.side === me ? 'Charge !' : 'Charge ennemie'],
  [(u, p) => u.form === 'carre' && p.form !== 'carre', () => 'Carré !'],
  [(u, p) => u.state === 'melee' && p.state !== 'melee', () => 'Mêlée'],
];
const LABEL_MS = 3800, LABEL_GAP = 900;
const TRAIT = { audacieux: 'audacieux', prudent: 'prudent', cavalier: 'cavalier', artilleur: 'artilleur', montagnard: 'montagnard', eclaireur: 'éclaireur', inspirant: 'inspirant', logisticien: 'logisticien' };

export class Ordres {
  constructor(ui) {
    this.ui = ui; this.v = ui.v;
    this.tab = 'man';
    this.data = null; this.o = null;
    this.camAuto = true;
    this.prev = new Map();      // dernier état vu de chaque régiment (étiquettes)
    this.labels = [];           // étiquettes affichées : {x, y, text, mine, t, el}
    this.moments = [];          // grands moments du film : {clock, x, y, text}
    const el = document.createElement('div');
    el.className = 'bo';
    el.innerHTML = `
      <section class="bo-panel" role="region" aria-label="Vos ordres" hidden></section>
      <div class="bo-hud" role="region" aria-label="La bataille menée par vos officiers" hidden>
        <div class="bo-cap" aria-live="polite"></div>
        <div class="bo-row"><div class="bo-day"><i></i><span class="bo-marks"></span></div><span class="bo-h"></span></div>
        <div class="bo-hbtns">
          <span class="bo-k" role="group" aria-label="Vitesse du film">${[1, 2, 4].map(k => `<button class="bt-btn" data-o="k" data-v="${k}" aria-pressed="false">×${k}</button>`).join('')}</span>
          <button class="bt-btn" data-o="cam"></button>
          <button class="bt-btn primary" data-o="skip">Passer ▸▸</button>
        </div>
      </div>
      <div class="bo-labels" aria-hidden="true"></div>
      <div class="bo-ask" hidden><div class="bt-card bo-askcard" role="dialog" aria-modal="true" aria-labelledby="bo-askt"></div></div>`;
    ui.el.appendChild(el);
    this.el = el;
    this.$ = s => el.querySelector(s);
    el.addEventListener('click', e => this.click(e));
  }

  on() { return this.v.st?.mode === 'ordres'; }

  // ------------------------------------------------------------------ état du serveur
  update(st) {
    const on = st.mode === 'ordres', v = this.v;
    this.ui.el.classList.toggle('ordres', on);
    if (!on) return;
    if (st.ordres && !this.data) this.set(st.ordres);
    const deploy = st.phase === 'deploiement', play = st.phase === 'combat' && !!st.replay;
    if (!this.camSet && v.terrain && !this.ui.entering) {
      // tout le champ
      this.camSet = true;
      v.moveCam(v.W / 2, v.H / 2, v.fitZ() * (deploy ? 1.05 : 1.2), 1400);
    }
    this.$('.bo-panel').hidden = !deploy || !this.data;
    this.$('.bo-hud').hidden = !play;
    if (play) { this.events(st); this.hud(st); }
    // le moment décisif : la bataille s'arrête et attend votre réponse
    const ask = this.$('.bo-ask');
    if (st.ask && play) {
      if (this.askKey !== st.ask.key) {
        this.askKey = st.ask.key;
        this.$('.bo-askcard').innerHTML = `<h2 id="bo-askt">Le moment décisif</h2><p>${esc(st.ask.text)}</p>
          <div class="bm-btns"><button class="bt-btn" data-o="wait">Attendre un quart d’heure</button><button class="bt-btn primary big" data-o="go">Maintenant !</button></div>`;
        ask.hidden = false;
        this.$('[data-o="go"]').focus();
      }
    } else if (!ask.hidden) { ask.hidden = true; this.askKey = null; }
  }
  set(d) {
    this.data = d;
    this.o = { ...d.orders };
    if (!d.groups.some(g => g.tab === this.tab)) this.tab = d.tabs[0][0];
    this.render();
  }

  // ------------------------------------------------------------------ la fenêtre des ordres
  render() {
    const d = this.data, o = this.o;
    if (!d) return;
    const r = d.report || {};
    const gen = r.gen ? `${esc(r.gen.rank || 'Général')} ${esc(r.gen.name || '')}, <b>${esc(TRAIT[r.gen.trait] || r.gen.trait || '')}</b>` : 'un chef inconnu';
    const plan = r.plan ? `Intention probable : ${esc(r.plan)} <small>(éclaireurs : ${esc(r.sure)})</small>` : 'Vos éclaireurs n’ont rien pu apprendre de ses intentions.';
    const mix = r.mix ? `${fmtN(r.mix.inf)} fantassins · ${fmtN(r.mix.cav)} cavaliers · ${r.mix.art} batterie${r.mix.art > 1 ? 's' : ''}` : '';
    const groups = d.groups.filter(g => g.tab === this.tab);
    const a = d.advice || { pros: [], cons: [], verdict: '' };
    const vk = { favorable: 'bon', incertaine: 'moyen', 'risquée': 'mauvais' }[a.verdict] || 'moyen';
    this.$('.bo-panel').innerHTML = `
      <header class="bo-head"><h2>Vos ordres</h2><p class="bo-sub">${d.side ? 'Vous défendez' : 'Vous attaquez'}${d.place ? ' la place' : ''} : vos officiers mèneront la bataille selon vos ordres. Vos troupes se placent sur la carte à chaque choix.</p></header>
      <div class="bo-foe"><b>En face :</b> ${gen}<br>${plan}${mix ? `<br><span class="bo-mix">${mix}</span>` : ''}</div>
      <div class="bo-tabs" role="tablist">${d.tabs.filter(([k]) => d.groups.some(g => g.tab === k)).map(([k, l]) => `<button role="tab" aria-selected="${k === this.tab}" class="${k === this.tab ? 'on' : ''}" data-o="tab" data-v="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="bo-groups">${groups.map(g => this.group(g, o[g.key])).join('')}</div>
      <div class="bo-advice">
        <div class="bo-pc pro"><b>Points forts</b>${(a.pros.length ? a.pros : ['—']).map(t => `<p>${esc(t)}</p>`).join('')}</div>
        <div class="bo-pc con"><b>Risques</b>${(a.cons.length ? a.cons : ['—']).map(t => `<p>${esc(t)}</p>`).join('')}</div>
      </div>
      <footer class="bo-foot"><button class="bt-btn" data-o="cancel">Retour</button><span class="bo-verdict">Estimation : <b class="${vk}">${esc(a.verdict)}</b></span><button class="bt-btn primary big" data-o="engage">Engager la bataille</button></footer>`;
  }
  group(g, cur) {
    const sel = g.opts.find(x => x.v === cur) || g.opts[0];
    const opt = x => {
      const on = x.v === cur, lock = !!x.why;
      const attrs = `data-o="opt" data-k="${esc(g.key)}" data-v="${esc(x.v)}" aria-pressed="${on}"${lock ? ` aria-disabled="true" title="${esc(x.why)}"` : ''}`;
      if (g.cards) return `<button class="bo-card${on ? ' on' : ''}${lock ? ' lock' : ''}" ${attrs}><b>${esc(x.label)}</b><span>${esc(lock ? x.why : x.desc)}</span></button>`;
      return `<button class="bo-opt${on ? ' on' : ''}${lock ? ' lock' : ''}" ${attrs}>${esc(x.label)}</button>`;
    };
    return `<div class="bo-g"><h3>${esc(g.title)}</h3>${g.cards ? `<div class="bo-cards">${g.opts.map(opt).join('')}</div>` :
      `<div class="bo-opts">${g.opts.map(opt).join('')}</div><p class="bo-desc">${esc(sel.desc)}</p>`}</div>`;
  }
  async choose(k, val) {
    const g = this.data.groups.find(x => x.key === k), x = g?.opts.find(y => y.v === val);
    if (!x) return;
    if (x.why) { this.ui.toast(x.why); return; }
    this.o[k] = val;
    this.render();
    const seq = (this.seq = (this.seq || 0) + 1);
    const r = await this.v.cmd('orders', { orders: this.o });
    if (r.ok && r.ordres && seq === this.seq) this.set(r.ordres);
  }
  async engage() {
    const b = this.$('[data-o="engage"]');
    if (b) b.disabled = true;
    const r = await this.v.cmd('orders', { orders: this.o, go: true });
    if (b) b.disabled = false;
    if (!r.ok) return;
    this.$('.bo-panel').hidden = true;
    this.ui.toast('Vos officiers engagent la bataille selon vos ordres.', 'good');
    this.nextCam = 0;
  }
  async cancel() {
    const r = await this.v.cmd('cancel');
    if (r.ok) this.v.onExit && this.v.onExit(null);
  }

  // ------------------------------------------------------------------ le film
  hud(st) {
    const notes = st.notes || [];
    const cap = this.skipping ? 'Vos officiers achèvent la bataille…' : performance.now() < (this.holdCam || 0) ? this.holdText
      : notes.length ? notes[notes.length - 1] : 'La bataille est engagée.';
    const c = this.$('.bo-cap');
    if (c.textContent !== cap) c.textContent = cap;
    const dusk = Math.max(1, st.dusk || 1);
    this.$('.bo-day i').style.width = (clamp((st.clock || 0) / dusk, 0, 1) * 100).toFixed(1) + '%';
    this.$('.bo-h').textContent = st.hour || '';
    for (const b of this.el.querySelectorAll('[data-o="k"]')) {
      const on = +b.dataset.v === (st.replay.k || 1);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    }
    this.$('[data-o="cam"]').textContent = this.camAuto ? 'Caméra : suit l’action' : 'Caméra : vue d’ensemble';
  }
  // ce qui vient de se passer : des étiquettes sur la carte (changements d'état des régiments visibles) et un repère
  // sur la barre de la journée par grand moment raconté (le journal de vos officiers)
  events(st) {
    const v = this.v, now = performance.now();
    let best = null;
    for (const u of v.units.values()) {
      const p = this.prev.get(u.id);
      this.prev.set(u.id, { state: u.state, form: u.form });
      if (!p || u._ghost || u.state === 'hors') continue;
      const i = EVENTS.findIndex(([test]) => test(u, p));
      if (i < 0 || (best && best.i <= i)) continue;
      if (this.labels.some(l => Math.hypot(l.x - u.x, l.y - u.y) < 150 && now - l.t < LABEL_MS)) continue;
      best = { i, u };
    }
    if (best && now - (this.lastLabel || 0) >= LABEL_GAP) {
      const u = best.u;
      this.lastLabel = now;
      this.label(u.to?.x ?? u.x, u.to?.y ?? u.y, EVENTS[best.i][1](u, v.me), u.side === v.me);
    }
    const dusk = Math.max(1, st.dusk || 1);
    for (const text of st.notes || []) {
      if (this.moments.some(m => m.text === text)) continue;
      const [x, y] = this.hot() || [v.cam.x, v.cam.y];
      this.moments.push({ clock: st.clock || 0, x, y, text });
      const b = document.createElement('button');
      b.className = 'bo-mark'; b.dataset.o = 'moment'; b.dataset.i = this.moments.length - 1;
      b.title = text; b.setAttribute('aria-label', text);
      b.style.left = (clamp((st.clock || 0) / dusk, 0, 1) * 100).toFixed(1) + '%';
      this.$('.bo-marks').appendChild(b);
    }
  }
  label(x, y, text, mine) {
    const el = document.createElement('div');
    el.className = 'bo-label' + (mine ? ' mine' : '');
    el.textContent = text;
    this.$('.bo-labels').appendChild(el);
    this.labels.push({ x, y, text, mine, t: performance.now(), el });
    while (this.labels.length > 4) this.labels.shift().el.remove();
  }
  // là où l'on se bat (mêlées et charges d'abord) : [x, y, étendue] ou null
  hot() {
    let sx = 0, sy = 0, sw = 0;
    const act = [];
    for (const u of this.v.units.values()) {
      const w = ACTIVE[u.state] || 0;
      if (!w || u._ghost || u.state === 'hors') continue;
      sx += u.x * w; sy += u.y * w; sw += w; act.push(u);
    }
    if (!sw) return null;
    const cx = sx / sw, cy = sy / sw;
    return [cx, cy, Math.max(...act.map(u => Math.hypot(u.x - cx, u.y - cy)), 200)];
  }
  // à chaque image : les étiquettes suivent la carte ; la caméra du film cherche l'action, assez près pour voir les
  // régiments (pas pendant un geste, ni quelques secondes après un repère touché)
  frame(now) {
    const v = this.v, st = v.st;
    this.labels = this.labels.filter(l => { const keep = now - l.t < LABEL_MS; if (!keep) l.el.remove(); return keep; });
    for (const l of this.labels) {
      const [sx, sy, depth] = v.toScreen(l.x, l.y), k = (now - l.t) / LABEL_MS;
      l.el.style.transform = `translate(${sx.toFixed(0)}px, ${(sy - 34 - k * 14).toFixed(0)}px) translateX(-50%)`;
      l.el.style.opacity = depth > 0 ? String(Math.min(1, (1 - k) * 3)) : '0';
    }
    if (!this.on() || st?.phase !== 'combat' || !st.replay || v.controls.busy() || now < (this.holdCam || 0)) return;
    if (now < (this.nextCam || 0)) return;
    this.nextCam = now + CAM_EVERY;
    if (!this.camAuto) return;
    const h = this.hot();
    if (!h) return;
    v.moveCam(h[0], h[1], v.miZ(), 2200);   // (à mi-distance, comme l'ouverture)
  }
  // pendant les ordres : les flèches de la manœuvre, au sol (lissées), pointe à l'arrivée
  drawGround(ctx, time) {
    const v = this.v, arrows = this.data?.arrows;
    if (!this.on() || v.st?.phase !== 'deploiement' || !arrows) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const a of arrows) {
      const [rgb, w, dash, head] = ARROW[a.k] || ARROW.main;
      const pts = smooth(a.pts);
      const lw = Math.max(1.5, w * Math.min(1.4, v.cam.z * 2.2));
      ctx.setLineDash(dash ? dash.map(d => d * lw / 3) : []);
      ctx.lineDashOffset = dash ? -time * 18 : 0;
      v.groundPath(ctx, pts);
      ctx.strokeStyle = 'rgba(20,14,8,0.5)'; ctx.lineWidth = lw + 4; ctx.stroke();
      ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = lw; ctx.stroke();
      ctx.setLineDash([]);
      if (!head || pts.length < 2) continue;
      const [bx, by] = v.toScreen(...pts[pts.length - 1]), [cx, cy] = v.toScreen(...pts[Math.max(0, pts.length - 4)]);
      const ang = Math.atan2(by - cy, bx - cx), r = lw * 2.4 + 6;
      ctx.fillStyle = `rgba(${rgb},0.95)`;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(ang) * r, by + Math.sin(ang) * r);
      ctx.lineTo(bx + Math.cos(ang + 2.5) * r, by + Math.sin(ang + 2.5) * r); ctx.lineTo(bx + Math.cos(ang - 2.5) * r, by + Math.sin(ang - 2.5) * r);
      ctx.closePath(); ctx.fill();
    }
  }

  click(e) {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    const v = this.v;
    switch (b.dataset.o) {
      case 'tab': this.tab = b.dataset.v; this.render(); break;
      case 'opt': this.choose(b.dataset.k, b.dataset.v); break;
      case 'engage': this.engage(); break;
      case 'cancel': this.cancel(); break;
      case 'k': v.cmd('replay', { k: +b.dataset.v }); break;
      case 'moment': {
        // un grand moment : la caméra y va, le bandeau le raconte de nouveau, la caméra du film attend un peu
        const m = this.moments[+b.dataset.i];
        if (!m) break;
        this.holdCam = performance.now() + 6000;
        v.moveCam(m.x, m.y, Math.max(v.cam.z, v.fitZ() * 2), 900);
        this.holdText = this.$('.bo-cap').textContent = m.text;
        break;
      }
      case 'cam':
        this.camAuto = !this.camAuto;
        if (!this.camAuto) v.moveCam(v.W / 2, v.H / 2, v.fitZ() * 1.2, 1200);
        this.nextCam = 0;
        if (v.st) this.hud(v.st);
        break;
      case 'skip':
        this.skipping = true;
        b.disabled = true;
        v.cmd('replay', { skip: true });
        if (v.st) this.hud(v.st);
        break;
      case 'go': case 'wait':
        this.$('.bo-ask').hidden = true;
        v.cmd('answer', { v: b.dataset.o });
        break;
    }
  }
}

// tracé lissé (Chaikin, trois passes) : quelques points de passage deviennent une courbe
function smooth(pts) {
  let p = pts;
  for (let k = 0; k < 3 && p.length > 2; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

const fmtN = n => (Math.round(n) || 0).toLocaleString('fr-FR');
