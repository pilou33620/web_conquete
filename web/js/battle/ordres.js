// « Donner mes ordres » : la fenêtre des ordres sur le champ de bataille vu de dessus, puis le film de la bataille que
// vos officiers livrent selon ces ordres (bandeau, caméra qui suit l'action, moment décisif). Les choix, ce qui les
// verrouille, l'avis du général et le rapport des éclaireurs viennent du serveur (game/tactics/orders.py) ; à chaque
// choix, le serveur redéploie vos troupes et la vue les montre à leur nouvelle place. Le récapitulatif de fin reste
// celui de interface.js (avec les pertes par arme et ce qui a décidé la journée).
import { esc, clamp } from './formes.js';

const TOP = 1.2;         // inclinaison de la vue de dessus (rad ; 1,57 serait la verticale)
const CAM_EVERY = 2600;  // la caméra du film cherche l'action toutes les 2,6 s
const ACTIVE = { melee: 3, charge: 3, feu: 1, recharge: 1, deroute: 1.5 };
const TRAIT = { audacieux: 'audacieux', prudent: 'prudent', cavalier: 'cavalier', artilleur: 'artilleur', montagnard: 'montagnard', eclaireur: 'éclaireur', inspirant: 'inspirant', logisticien: 'logisticien' };

export class Ordres {
  constructor(ui) {
    this.ui = ui; this.v = ui.v;
    this.tab = 'man';
    this.data = null; this.o = null;
    this.camAuto = true;
    const el = document.createElement('div');
    el.className = 'bo';
    el.innerHTML = `
      <section class="bo-panel" role="region" aria-label="Vos ordres" hidden></section>
      <div class="bo-hud" role="region" aria-label="La bataille menée par vos officiers" hidden>
        <div class="bo-cap" aria-live="polite"></div>
        <div class="bo-row"><div class="bo-day" aria-hidden="true"><i></i></div><span class="bo-h"></span></div>
        <div class="bo-hbtns">
          <button class="bt-btn" data-o="fast" aria-pressed="false">×2</button>
          <button class="bt-btn" data-o="cam"></button>
          <button class="bt-btn primary" data-o="skip">Passer ▸▸</button>
        </div>
      </div>
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
      // vue de dessus sur tout le champ, vos troupes en bas de l'image
      this.camSet = true;
      v.showCover = false;
      v.pitchOv = TOP;
      v.moveCam(v.W / 2, v.H / 2, v.fitZ() * (deploy ? 1.05 : 1.2), 1400, this.yaw());
    }
    this.$('.bo-panel').hidden = !deploy || !this.data;
    this.$('.bo-hud').hidden = !play;
    if (play) this.hud(st);
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
  // cap de la caméra : de vos troupes vers l'ennemi (vos troupes en bas de l'image)
  yaw() {
    const v = this.v, us = [...v.units.values()];
    const c = side => { const s = us.filter(u => side ? u.side !== v.me : u.side === v.me); return s.length ? [s.reduce((a, u) => a + u.x, 0) / s.length, s.reduce((a, u) => a + u.y, 0) / s.length] : null; };
    const a = c(0), b = c(1) || [v.W / 2, v.H / 2];   // (l'ennemi pas encore repéré : vers le centre du champ)
    if (!a || Math.hypot(b[0] - a[0], b[1] - a[1]) < 50) return v.cam.yaw || 0;
    return Math.atan2(b[0] - a[0], -(b[1] - a[1]));
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
    const cap = this.skipping ? 'Vos officiers achèvent la bataille…' : notes.length ? notes[notes.length - 1] : 'La bataille est engagée.';
    const c = this.$('.bo-cap');
    if (c.textContent !== cap) c.textContent = cap;
    const dusk = Math.max(1, st.dusk || 1);
    this.$('.bo-day i').style.width = (clamp((st.clock || 0) / dusk, 0, 1) * 100).toFixed(1) + '%';
    this.$('.bo-h').textContent = st.hour || '';
    const fast = this.$('[data-o="fast"]');
    fast.classList.toggle('on', !!st.replay.fast);
    fast.setAttribute('aria-pressed', String(!!st.replay.fast));
    this.$('[data-o="cam"]').textContent = this.camAuto ? 'Caméra : suit l’action' : 'Caméra : vue d’ensemble';
  }
  // la caméra cherche l'action : là où l'on se bat (mêlées et charges d'abord), assez près pour voir les régiments
  frame(now) {
    const v = this.v, st = v.st;
    if (!this.on() || st?.phase !== 'combat' || !st.replay || v.controls.busy()) return;
    if (now < (this.nextCam || 0)) return;
    this.nextCam = now + CAM_EVERY;
    if (!this.camAuto) return;
    let sx = 0, sy = 0, sw = 0;
    const act = [];
    for (const u of v.units.values()) {
      const w = ACTIVE[u.state] || 0;
      if (!w || u._ghost || u.state === 'hors') continue;
      sx += u.x * w; sy += u.y * w; sw += w; act.push(u);
    }
    if (!sw) return;
    const cx = sx / sw, cy = sy / sw;
    const spread = Math.max(...act.map(u => Math.hypot(u.x - cx, u.y - cy)), 200);
    const z = clamp(Math.min(v.vw, v.vh) / (2 * spread + 500), v.fitZ() * 1.2, v.fitZ() * 3.2);
    v.moveCam(cx, cy, z, 2200);
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
      case 'fast': v.cmd('replay', { fast: !v.st?.replay?.fast }); break;
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

const fmtN = n => (Math.round(n) || 0).toLocaleString('fr-FR');
