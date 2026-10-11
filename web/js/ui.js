import { ICON, speedIcon, coat } from './icons.js';
import { fmtMen, unitCls } from './map.js';

// nombres à la française : virgule décimale et vrai signe moins (−)
const minus = s => s.replace(/^-/, '−');
const fmt = n => minus((Math.round(n) || 0).toLocaleString('fr-FR'));   // || 0 : pas de « −0 »
const fmt1 = n => minus(((Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10) || 0).toLocaleString('fr-FR'));
const fmt2 = n => minus((Math.round(n * 100) / 100 || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { paix: 'En paix', guerre: 'En guerre', alliance: 'Alliés', self: 'Vous' };
const TYPE_LABEL = { capitale: 'Chef-lieu', ville: 'Ville', village: 'Village', fort: 'Place forte' };
const RES_ORDER = ['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'];
const BRANCH_LABEL = { militaire: 'Militaire', civil: 'Civil', industriel: 'Industriel', agricole: 'Agricole' };
const ACTION_LABEL = { paix: 'propose la paix', alliance: 'propose une alliance', commerce: 'propose un accord commercial', echange: 'propose un échange', prisonniers: 'propose un échange de prisonniers' };

function relLabel(r) {
  if (r <= -50) return 'Haineux';
  if (r <= -20) return 'Hostile';
  if (r < 10) return 'Méfiant';
  if (r < 40) return 'Cordial';
  return 'Amical';
}

export class UI {
  constructor(map, rules, mapData, api) {
    this.map = map; this.rules = rules; this.md = mapData; this.api = api;
    this.st = null;
    this.sel = null;
    this.checked = new Set();
    this.targeting = null;
    this.modal = null;
    this.events = [];
    this.lastSpeed = 1;
    this.panelSig = '';
    this.modalSig = '';
    this.pressing = false;
    this.startDept = null;
    this.startDiff = 'normal';
    this.startScen = (rules.scenario_order || ['1790'])[0];
    this.overShown = false;
    this.$ = id => document.getElementById(id);
    this.buildStatic();
    map.onTap = e => this.onTap(e);
    map.onContext = e => this.onContext(e);
    map.onLongPress = e => this.onLongPress(e);
    map.onDragOrder = e => this.onDragOrder(e);
    map.onGesture = () => this.hideBubble();
    map.onDoubleTap = () => this.hideBubble();
    map.canDragArmy = id => {
      const a = this.armyById(id);
      return !!(a && this.st && this.isMine(a.o) && a.st !== 'battle');
    };
  }

  // ------------------------------------------------------------------ squelette
  buildStatic() {
    const sp = this.$('tb-speed');
    sp.innerHTML = this.rules.speeds.map((v, i) => `<button data-act="speed" data-v="${i}" aria-label="${i ? 'Vitesse ' + i : 'Pause'}" title="${!i ? 'Pause (espace)' : i >= 5 ? `×${this.rules.speeds[i]} jours par seconde : pour les années de paix (touche ${i}) — guerres, batailles et propositions mettent le jeu en pause` : 'Vitesse ×' + i + ' (touche ' + i + ')'}">${speedIcon(i)}</button>`).join('');
    this.$('btn-menu').innerHTML = ICON.menu;
    this.$('btn-menu').dataset.act = 'modal';
    this.$('btn-menu').dataset.v = 'menu';
    const rail = [['tech', 'Technologies'], ['diplo', 'Diplomatie'], ['commerce', 'Commerce'], ['production', 'Production'], ['journal', 'Journal']];
    this.$('rail').innerHTML = rail.map(([k, l]) => `<button data-act="modal" data-v="${k}" aria-label="${l}">${ICON[k]}<span class="lbl">${l}</span><span class="badge" id="badge-${k}" hidden></span></button>`).join('');
    this.$('tb-res').innerHTML = RES_ORDER.map(r => `<div class="res" data-res="${r}">${ICON[r]}<span class="v" id="res-${r}">0</span><span class="d" id="inc-${r}"></span></div>`).join('');
    document.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) { e.preventDefault(); this.action(b.dataset.act, b.dataset, b); }
    });
    document.body.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.reg) { t.checked ? this.checked.add(t.dataset.reg) : this.checked.delete(t.dataset.reg); t.closest('.reg')?.classList.toggle('sel', t.checked); }
      if (t.dataset.act === 'slider') this.cmd({ cmd: 'slider', value: t.value / 100 }, false);
      if (t.dataset.act === 'tax') this.cmd({ cmd: 'tax', value: t.value / 100 }, false);
    });
    document.body.addEventListener('input', e => {
      if (e.target.dataset.live === 'slider') {
        const v = e.target.value;
        const l = document.getElementById('slider-val');
        if (l) l.textContent = `${v} % armes, ${100 - v} % outils`;
      }
      if (e.target.dataset.live === 'tax') {
        const l = document.getElementById('tax-val');
        if (l) l.textContent = this.taxLabel(e.target.value / 100);
      }
    });
    for (const id of ['panel', 'modal']) {
      const el = this.$(id);
      el.addEventListener('pointerdown', () => { this.pressing = true; });
    }
    // un défilement au doigt dans le panneau finit par pointercancel, pas pointerup
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { setTimeout(() => { this.pressing = false; }, 30); });
    // infobulles des ressources
    const tt = this.$('tooltip');
    this.$('tb-res').addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;   // au doigt, c'est le clic qui ouvre et referme l'infobulle
      const r = e.target.closest('.res');
      if (!r || !this.st) return;
      tt.innerHTML = this.resTip(r.dataset.res);
      const b = r.getBoundingClientRect();
      tt.hidden = false;
      tt.style.left = Math.min(window.innerWidth - 310, b.left) + 'px';
      tt.style.top = (b.bottom + 6) + 'px';
    });
    this.$('tb-res').addEventListener('pointerout', e => { if (e.pointerType === 'mouse') tt.hidden = true; });
    this.$('tb-res').addEventListener('click', e => {
      const r = e.target.closest('.res');
      if (!r || !this.st) return;
      if (!tt.hidden && tt.dataset.res === r.dataset.res) { tt.hidden = true; return; }
      tt.dataset.res = r.dataset.res;
      tt.innerHTML = this.resTip(r.dataset.res);
      const b = r.getBoundingClientRect();
      tt.hidden = false;
      tt.style.left = Math.max(6, Math.min(window.innerWidth - 310, b.left)) + 'px';
      tt.style.top = (b.bottom + 6) + 'px';
      clearTimeout(this.ttTimer);
      this.ttTimer = setTimeout(() => { tt.hidden = true; }, 5000);
    });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.res')) tt.hidden = true; });
    document.addEventListener('keydown', e => this.onKey(e));
  }

  onKey(e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (!this.st) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (this.st.speed) { this.lastSpeed = this.st.speed; this.setSpeed(0); } else this.setSpeed(this.lastSpeed || 1);
    } else if (/^[1-9]$/.test(e.key) && +e.key < this.rules.speeds.length) this.setSpeed(+e.key);
    else if (e.key === 'Escape') {
      if (!this.$('modal').hidden) this.closeModal();
      else if (this.targeting) this.stopTargeting();
      else if (!this.$('bubble').hidden) this.hideBubble();
      else this.select(null);
    } else if (e.key === '+' || e.key === '=') this.map.zoomBy(1.4);
    else if (e.key === '-') this.map.zoomBy(1 / 1.4);
  }

  // ------------------------------------------------------------------ commandes serveur
  async cmd(body, toastOk = true) {
    let r;
    try { r = await this.api.post('/api/cmd', body); } catch (e) { r = { ok: false, msg: 'Serveur injoignable : ordre non transmis.' }; }
    if (r.msg && (!r.ok || toastOk)) this.toast(r.msg, r.ok ? (r.pending ? '' : 'good') : 'bad');
    this.onRefresh && this.onRefresh();
    return r;
  }
  setSpeed(v) { this.cmd({ cmd: 'speed', value: v }, false); if (this.st) this.st.speed = v; this.renderSpeed(v); }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    const box = this.$('toasts');
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 4200);
  }

  // ------------------------------------------------------------------ mise à jour
  update(st) {
    const first = !this.st;
    this.st = st;
    let renamed = false;
    for (const [c, n] of Object.entries(st.names || {})) {
      if (this.rules.factions[c] && this.rules.factions[c].name !== n) { this.rules.factions[c].name = n; renamed = true; }
    }
    this.map.setState(st);
    if (first || renamed) {
      const f = this.rules.factions[st.me.code];
      this.$('tb-faction').innerHTML = `${coat(f.color, st.me.code)}<div><div class="fname">${esc(f.name)}</div><div class="ftitle">${esc(f.title)}</div></div>`;
    }
    if (first) {
      this.$('topbar').hidden = false;
      this.$('rail').hidden = false;
      this.$('feed').hidden = false;
      this.$('zoombar').hidden = false;
      this.$('zb-fog').classList.toggle('on', this.map.fogOn);
      const f = this.rules.factions[st.me.code];
      this.$('tb-faction').innerHTML = `${coat(f.color, st.me.code)}<div><div class="fname">${esc(f.name)}</div><div class="ftitle">${esc(f.title)}</div></div>`;
    }
    for (const ev of st.events) this.onEvent(ev, first);
    this.renderTop();
    this.renderProposals();
    this.renderFeed();
    if (this.sel) this.renderPanel();
    if (this.modal && !this.pressing) this.renderModal();
    const pend = st.proposals.length;
    const b = this.$('badge-diplo');
    b.hidden = !pend; b.textContent = pend;
    if (st.over && !this.overShown) { this.overShown = true; this.openModal('fin'); }
  }

  onEvent(ev, initial) {
    this.events.push(ev);
    if (this.events.length > 600) this.events.splice(0, 100);
    if (initial) return;
    if (ev.coins) this.map.spawnCoins(this.st.me.code);
    const toastKinds = ['tech', 'eco', 'meteo', 'fin', 'info', 'diplo', 'revolte', 'siege', 'armee', 'espion'];
    if (ev.important && toastKinds.includes(ev.kind)) this.toast(ev.text, ev.kind === 'diplo' && /guerre/.test(ev.text) ? 'bad' : '');
  }

  renderSpeed(v) {
    for (const b of this.$('tb-speed').children) b.classList.toggle('on', +b.dataset.v === v);
  }

  renderTop() {
    const st = this.st, me = st.me;
    this.$('tb-day').textContent = st.date;
    if (st.era) this.$('tb-day').title = `${st.era.name} — ${st.era.desc}`;
    const zones = ['cote', 'interieur', 'montagne'];
    const wsig = st.season + zones.map(z => st.weather[z].kind).join() + !!st.flood;
    if (wsig !== this.wxSig) {   // ne réécrit la météo que si elle change
      this.wxSig = wsig;
      const wx = zones.map(z => {
        const w = this.rules.weather[st.weather[z].kind];
        return `<span class="wx" title="${this.rules.zones[z]} : ${w.label}">${w.icon}<span>${this.rules.zones[z].split(' ')[0]}</span></span>`;
      }).join('');
      this.$('tb-season').innerHTML = `<span>${this.rules.seasons[st.season]}</span>${wx}${st.flood ? '<span class="wx" title="Crue des fleuves">🌊</span>' : ''}`;
    }
    this.renderSpeed(st.speed);
    for (const r of RES_ORDER) {
      const v = me.res[r], inc = me.income[r];
      this.$('res-' + r).textContent = fmt(v);
      const d = this.$('inc-' + r);
      const iv = fmt1(inc);
      d.textContent = (iv[0] === '−' ? '' : '+') + iv;
      d.classList.toggle('neg', iv[0] === '−');
      const warn = (r === 'vivres' && me.famine) || (r === 'livres' && me.banqueroute);
      d.parentElement.classList.toggle('warn', warn);
    }
  }

  // spécialité phare d'une ville : nom, type et production par jour (avec les technologies du joueur s'il la tient)
  starLine([kind, label], own, capital) {
    const sp = this.rules.specialty[kind];
    if (!sp) return '';
    const k = (1 + (own && sp.boost ? (this.st.me.mods[sp.boost] || 0) : 0)) * (capital ? this.rules.specialty_capital : 1);
    const prod = ['livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois'].filter(r => sp[r])
      .map(r => { const v = sp[r] * k, lab = r === 'industrie' ? 'industrie' : this.rules.res_label[r].toLowerCase();
        return `+${fmt1(v)} ${r === 'livres' && v < 2 ? 'livre' : lab}`; }).join(', ');
    return `<div class="star-line"><span class="star">★</span><div><b>${esc(label)}</b><div class="muted small">${esc(sp.label)} : ${prod} par jour (production de base)${own ? '' : ', pour qui tient la ville'}</div></div></div>`;
  }

  devName(type, d) { const n = this.rules.dev?.names?.[type] || []; return n[Math.min(d, n.length - 1)] || ''; }

  fortName(f) { return this.rules.fort.names[Math.min(f, this.rules.fort.names.length - 1)] || ''; }

  resTip(r) {
    const me = this.st.me;
    const lab = this.rules.res_label[r];
    const rows = [[`Stock`, fmt(me.res[r])], [`Variation par jour`, (fmt1(me.income[r])[0] === '−' ? '' : '+') + fmt1(me.income[r])]];
    if (r === 'livres') {
      rows.push(['Solde des troupes', '−' + fmt1(me.upkeep.livres || 0)]);
      if (me.upkeep.forts) rows.push(['Entretien des remparts', '−' + fmt1(me.upkeep.forts)]);
      rows.push(['Commerce', '+' + fmt1(me.trade.livres || 0)]);
    }
    if (r === 'vivres') { rows.push(['Rations des troupes', '−' + fmt1(me.upkeep.vivres || 0)]); if (me.prisoner_upkeep) rows.push(['Prisonniers détenus', '−' + fmt1(me.prisoner_upkeep)]); rows.push(['Saison', this.rules.seasons[this.st.season]]); }
    if (r === 'armes' || r === 'outils') rows.push(['Capacité industrielle', fmt1(me.cap) + ' /j']);
    if (r === 'outils') rows.push(['Bonus des outils', '+' + Math.round((me.tools_bonus - 1) * 100) + ' %']);
    if (r === 'fer' || r === 'bois') rows.push(['Consommés par les ateliers', 'oui']);
    const fl = me.floor && me.floor[r];
    if (fl) rows.push([this.st.word === 'province' ? 'Minimum garanti de la province' : 'Minimum garanti du département', fmt1(fl.min) + ' /j' + (fl.add > 0.05 ? ` (+${fmt1(fl.add)} en ce moment)` : '')]);
    const help = {
      livres: 'Monnaie : solde, recrutement, recherches, constructions.',
      vivres: 'Nourrissent les troupes. Récoltes fortes en été et en automne, faibles en hiver.',
      fer: 'Forges et mines. Sert aux armes, aux outils et aux canons.',
      bois: 'Forêts et landes. Sert aux outils, aux fortifications et aux affûts.',
      armes: 'Mousquets et sabres : nécessaires pour lever et compléter les régiments.',
      outils: 'Augmentent toute la production tant que le stock couvre vos villes.',
      recrues: 'Hommes disponibles pour former et compléter les régiments.',
    }[r];
    return `<b>${lab}</b><div class="muted small" style="margin:2px 0 6px">${help}</div><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  }

  renderProposals() {
    const box = this.$('proposals');
    const sig = this.st.proposals.map(p => p.id).join(',');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = this.st.proposals.map(p => {
      const f = this.rules.factions[p.frm];
      let detail = '';
      if (p.action === 'echange') detail = `Il offre ${fmt(p.give[1])} ${this.rules.res_label[p.give[0]].toLowerCase()} contre ${fmt(p.get[1])} ${this.rules.res_label[p.get[0]].toLowerCase()}.`;
      if (p.action === 'paix' && p.amount) detail = `Il offre un tribut de ${fmt(p.amount)} livres.`;
      if (p.action === 'commerce') detail = 'Chacun gagnera des livres et la ressource phare de l’autre.';
      if (p.action === 'prisonniers') detail = 'Chacun rend les prisonniers de l’autre ; le surplus se rachète 2 livres par homme.';
      if (p.action === 'alliance') detail = 'Vision partagée et entrée en guerre à vos côtés si vous êtes attaqué.';
      return `<div class="sheet proposal" style="border-left-color:${f.color}"><div class="pt">${esc(f.name)} ${esc(ACTION_LABEL[p.action] || p.action)}</div>
        <p>${detail}</p><div class="btns"><button class="btn primary" data-act="answer" data-id="${p.id}" data-v="1">Accepter</button>
        <button class="btn" data-act="answer" data-id="${p.id}" data-v="0">Refuser</button></div></div>`;
    }).join('');
  }

  renderFeed() {
    const kinds = ['battle_end', 'capture', 'capitulation', 'revolte', 'epoque'];
    const items = this.events.filter(e => kinds.includes(e.kind) && (e.important || e.kind === 'capitulation')).slice(-5);
    const box = this.$('feed');
    const sig = items.map(e => e.seq).join(',');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = items.map((e, i) => {
      const col = this.map.colors[e.who] || '#8d8a7a';
      const icon = e.kind === 'battle_end' ? ICON.swords : e.kind === 'capture' ? ICON.flag : ICON.seal;
      return `<div class="feed-item ${i < items.length - 2 ? 'old' : ''}" data-act="goto" data-x="${e.x ?? ''}" data-y="${e.y ?? ''}">
        <span class="stripe" style="background:${col}"></span>${icon}<span>${esc(e.text)}</span></div>`;
    }).join('');
  }

  // ------------------------------------------------------------------ sélection
  select(sel) {
    if (!sel || !this.sel || sel.kind !== this.sel.kind || sel.id !== this.sel.id) this.stopTargeting();
    this.sel = sel;
    this.map.selection = sel;
    this.checked.clear();
    this.panelSig = '';
    this.hideBubble();
    if (!sel) { this.$('panel').hidden = true; return; }
    this.renderPanel(true);
  }

  armyById(id) { return this.st?.armies.find(a => a.id === id); }
  isMine(o) { return o === this.st.me.code; }

  onTap(e) {
    if (!this.st) { this.onStartTap && this.onStartTap(e); return; }
    this.hideBubble();
    if (this.targeting) {
      const a = this.armyById(this.targeting);
      this.stopTargeting();
      if (a) this.orderMove(a, e, a.md || 'route');
      return;
    }
    const cur = this.sel && this.sel.kind === 'army' ? this.armyById(this.sel.id) : null;
    const mineSel = cur && this.isMine(cur.o) && cur.st !== 'battle';
    if (e.hit && e.hit.kind === 'army') {
      const a = this.armyById(e.hit.id);
      if (mineSel && a && !this.isMine(a.o)) { this.showBubble(e, cur, a); return; }
      this.select({ kind: 'army', id: e.hit.id });
      return;
    }
    if (mineSel) { this.showBubble(e, cur, null); return; }
    if (e.hit) this.select({ kind: e.hit.kind, id: e.hit.id });
    else this.select(null);
  }

  onContext(e) {
    if (!this.st) return;
    const cur = this.sel && this.sel.kind === 'army' ? this.armyById(this.sel.id) : null;
    if (cur && this.isMine(cur.o)) {
      e = this.moveTarget(e);
      const hit = e.hit;
      if (hit && hit.kind === 'army') {
        const a = this.armyById(hit.id);
        if (a) return this.orderMove(cur, { x: a.x, y: a.y, hit: null }, cur.md || 'route');
      }
      this.orderMove(cur, e, cur.md || 'route');
    }
  }

  onLongPress(e) {
    if (!this.st) return;
    this.hideBubble();
    const cur = this.sel && this.sel.kind === 'army' ? this.armyById(this.sel.id) : null;
    if (cur && this.isMine(cur.o) && cur.st !== 'battle' && !(e.hit && e.hit.kind === 'army' && e.hit.id === cur.id)) {
      this.onContext(e);   // appui long = clic droit : l'armée part tout de suite
      return;
    }
    if (e.hit) {
      this.select({ kind: e.hit.kind, id: e.hit.id });
      this.action('center', {});
    }
  }

  onDragOrder(e) {
    const a = this.armyById(e.army);
    if (!a) return;
    if (!this.sel || this.sel.kind !== 'army' || this.sel.id !== a.id) this.select({ kind: 'army', id: a.id });
    const tr = e.trail;
    let len = 0;
    for (let i = 1; i < tr.length; i++) len += Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]);
    this.pendingTrail = { army: a.id, pts: tr.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]) };
    let end = e.end;
    if (end.hit && end.hit.kind === 'army' && end.hit.id === a.id) return;
    end = this.moveTarget(end);
    const enemy = end.hit && end.hit.kind === 'army' ? this.armyById(end.hit.id) : null;
    this.showBubble(end, a, enemy && !this.isMine(enemy.o) ? enemy : null, len > 1.5);
  }

  // ordre de marche : nos propres jetons (décalés sous leur ville) ne doivent pas masquer la ville ou le point visé
  moveTarget(e) {
    const h = e.hit && e.hit.kind === 'army' ? this.armyById(e.hit.id) : null;
    if (!h || !this.isMine(h.o) || e.sx == null) return e;
    return { ...e, hit: this.map.hitTest(e.sx, e.sy, e.type, { skipArmy: b => this.isMine(b.o) }) };
  }

  orderMove(a, e, mode) {
    e = this.moveTarget(e);
    const body = { cmd: 'move', army: a.id, mode };
    if (e.hit && e.hit.kind === 'node') body.node = e.hit.id;
    else { body.x = e.x; body.y = e.y; }
    this.cmd(body, false).then(r => { if (r.ok) this.toast(r.msg || 'En marche.', 'good'); });
  }

  showBubble(e, army, enemy, withTrail = false) {
    const b = this.$('bubble');
    const hitNode = e.hit && e.hit.kind === 'node' ? this.md.nodes[e.hit.id] : null;
    let title = 'Ordre de marche';
    if (hitNode) title = hitNode.name;
    if (enemy) title = `${enemy.name} (${this.rules.factions[enemy.o].name})`;
    const target = enemy ? `data-x="${enemy.x}" data-y="${enemy.y}"` : hitNode ? `data-node="${hitNode.id}"` : `data-x="${e.x}" data-y="${e.y}"`;
    b.innerHTML = `<div class="bt">${esc(title)}</div>
      ${withTrail ? `<button class="btn primary" data-act="go-trail">Suivre mon tracé</button>` : ''}
      <button class="btn ${withTrail ? '' : 'primary'}" data-act="go" data-mode="route" ${target}>Marcher par les routes</button>
      <button class="btn" data-act="go" data-mode="champs" ${target}>Marcher à travers champs</button>
      ${hitNode ? `<button class="btn" data-act="selnode" data-node="${hitNode.id}">Voir ${esc(hitNode.name)}</button>` : ''}
      ${enemy ? `<button class="btn" data-act="selarmy" data-id="${enemy.id}">Voir cette armée</button>` : ''}
      <button class="btn" data-act="hidebubble">Annuler</button>`;
    b.style.left = clampN(e.sx, 110, window.innerWidth - 110) + 'px';
    b.style.top = Math.max(e.sy, 230) + 'px';
    b.hidden = false;
    // avec cinq boutons, la bulle peut sortir de l'écran : on la ramène entière dans la fenêtre
    const r = b.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    const dx = r.left < 6 ? 6 - r.left : r.right > W - 6 ? Math.max(6 - r.left, W - 6 - r.right) : 0;
    const dy = r.top < 6 ? 6 - r.top : r.bottom > H - 6 ? Math.max(6 - r.top, H - 6 - r.bottom) : 0;
    if (dx) b.style.left = (parseFloat(b.style.left) + dx) + 'px';
    if (dy) b.style.top = (parseFloat(b.style.top) + dy) + 'px';
  }
  hideBubble() { this.$('bubble').hidden = true; }
  stopTargeting() { this.targeting = null; this.map.cv.classList.remove('targeting'); }

  // ------------------------------------------------------------------ actions
  action(act, d, el) {
    const sel = this.sel;
    switch (act) {
      case 'speed': this.setSpeed(+d.v); break;
      case 'modal': this.openModal(d.v); break;
      case 'close-modal': this.closeModal(); break;
      case 'close-panel': this.select(null); break;
      case 'goto': if (d.x) { if (this.modal) this.closeModal(); this.map.moveTo(+d.x, +d.y, Math.max(this.map.cam.z, 6)); } break;
      case 'center': {
        const p = this.selPos();
        if (p) this.map.moveTo(p[0], p[1], Math.max(this.map.cam.z, 7));
        break;
      }
      case 'march':
        this.targeting = sel.id;
        this.map.cv.classList.add('targeting');
        this.toast('Touchez la destination : une ville ou un point de la carte.');
        break;
      case 'go': {
        this.hideBubble();
        const a = this.armyById(sel?.id);
        if (!a) break;
        const e = d.node != null && d.node !== '' ? { hit: { kind: 'node', id: +d.node } } : { x: +d.x, y: +d.y, hit: null };
        this.orderMove(a, e, d.mode);
        break;
      }
      case 'hidebubble': this.hideBubble(); break;
      case 'go-trail': {
        this.hideBubble();
        const t = this.pendingTrail;
        if (t) this.cmd({ cmd: 'path', army: t.army, pts: t.pts }, false).then(r => { if (r.ok) this.toast(r.msg || 'En marche.', 'good'); });
        break;
      }
      case 'zoom': {
        if (d.v === 'in') this.map.zoomBy(1.6);
        else if (d.v === 'out') this.map.zoomBy(1 / 1.6);
        else if (this.sel) this.action('center', {});
        else if (this.st) {
          const cap = this.md.nodes.find(n => n.type === 'capitale' && n.dept === this.st.me.code);
          if (cap) this.map.moveTo(cap.x, cap.y, Math.max(this.map.cam.z, 5));
        }
        break;
      }
      case 'selnode': this.select({ kind: 'node', id: +d.node }); break;
      case 'selarmy': this.select({ kind: 'army', id: d.id }); break;
      case 'selbattle': this.select({ kind: 'battle', id: d.id }); break;
      case 'mode': this.cmd({ cmd: 'mode', army: sel.id, value: d.v }, false); break;
      case 'formation': this.cmd({ cmd: 'formation', army: d.army || sel.id, value: d.v }); break;
      case 'plan': this.cmd({ cmd: 'plan', army: d.army || sel.id, value: d.v }); break;
      case 'reflex': this.cmd({ cmd: 'reflex', army: d.army || sel.id, value: d.v === '1' }); break;
      case 'enroll': {
        const n = +d.n || 0;
        if (!confirm(d.from === 'neutre' ? `Enrôler ${fmt(n)} prisonniers insurgés ?` : `Enrôler ${fmt(n)} prisonniers ? Leur ${this.st.word || 'département'} vous en voudra.`)) break;
        this.cmd({ cmd: 'enroll', from: d.from });
        break;
      }
      case 'split-type':
        this.cmd({ cmd: 'split_type', army: sel.id, value: d.v }, false).then(r => { if (r.ok) { this.toast('Détachement formé.', 'good'); this.select({ kind: 'army', id: r.id }); } });
        break;
      case 'spy': {
        const sp = this.rules.spy[d.v];
        if (d.v === 'saboter' && !confirm(`Envoyer des saboteurs (${sp.cost} livres) ? En cas d’échec, la relation se dégrade.`)) break;
        this.cmd({ cmd: 'spy', node: sel.id, value: d.v });
        break;
      }
      case 'fog': {
        this.map.fogOn = !this.map.fogOn;
        try { localStorage.setItem('conquete.fog', this.map.fogOn ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
        this.$('zb-fog').classList.toggle('on', this.map.fogOn);
        this.toast(this.map.fogOn ? 'Brouillard de guerre affiché.' : 'Brouillard de guerre masqué.');
        break;
      }
      case 'stance': this.cmd({ cmd: 'stance', army: sel.id, value: d.v }); break;
      case 'retreat': this.cmd({ cmd: 'retreat', army: sel.id }); break;
      case 'assault': this.cmd({ cmd: 'assault', army: sel.id }); break;
      case 'garrison': this.cmd({ cmd: 'garrison', army: sel.id }).then(r => { if (r.ok) this.select({ kind: 'node', id: this.armyById(sel.id)?.n ?? +d.node }); }); break;
      case 'split': {
        const regs = [...this.checked];
        this.cmd({ cmd: 'split', army: sel.id, regs }, false).then(r => { if (r.ok) { this.toast('Armée scindée.', 'good'); this.select({ kind: 'army', id: r.id }); } });
        break;
      }
      case 'merge': this.cmd({ cmd: 'merge', army: sel.id, other: d.other }); break;
      case 'form': {
        const n = this.st.nodes[sel.id];
        const mob = (n.g || []).filter(r => !this.rules.units[r[1]]?.garrison_only);   // la Garde nationale reste en ville
        let regs = [...this.checked].filter(id => mob.some(r => r[0] === id));
        if (!regs.length) regs = mob.map(r => r[0]);
        const body = { cmd: 'form', node: sel.id, regs };
        if (d.into) body.into = d.into;
        this.cmd(body, false).then(r => {
          if (r.ok) { this.toast(d.into ? 'Régiments ajoutés à l’armée.' : 'Nouvelle armée formée.', 'good'); this.select({ kind: 'army', id: d.into || r.id }); }
        });
        break;
      }
      case 'recruit': this.cmd({ cmd: 'recruit', node: sel.id, unit: d.v }); break;
      case 'build': this.cmd({ cmd: 'build', node: sel.id, what: d.v }); break;
      case 'research': this.cmd({ cmd: 'research', tech: d.v }); break;
      case 'diplo': {
        const body = { cmd: 'diplo', to: d.to, action: d.v };
        const inp = document.getElementById(`amt-${d.v}-${d.to}`);
        if (inp) body.amount = +inp.value || 0;
        if ((d.v === 'guerre') && !confirm(`Déclarer la guerre à ${this.rules.factions[d.to].name} ?`)) break;
        this.cmd(body, d.v !== 'guerre');   // la déclaration de guerre est déjà annoncée par le journal
        break;
      }
      case 'answer': this.cmd({ cmd: 'answer', id: d.id, accept: d.v === '1' }); break;
      case 'market': {
        const q = +document.getElementById(`mq-${d.res}`).value || 0;
        this.cmd({ cmd: 'market', res: d.res, qty: q, side: d.side });
        break;
      }
      case 'trade-offer': {
        const to = document.getElementById('tr-to').value;
        const give = [document.getElementById('tr-gr').value, +document.getElementById('tr-gq').value || 0];
        const get = [document.getElementById('tr-wr').value, +document.getElementById('tr-wq').value || 0];
        this.cmd({ cmd: 'diplo', to, action: 'echange', give, get });
        break;
      }
      case 'jtab': this.journalFilter = d.v; this.modalSig = ''; this.renderModal(); break;
      case 'save': {
        const name = document.getElementById('save-name').value;
        this.api.post('/api/save', { name }).then(r => { this.toast(r.msg, r.ok ? 'good' : 'bad'); this.modalSig = ''; this.refreshSaves(); })
          .catch(() => this.toast('Serveur injoignable : partie non sauvegardée.', 'bad'));
        break;
      }
      case 'load': this.onLoad && this.onLoad(d.v); break;
      case 'newgame': if (confirm('Abandonner la partie en cours et revenir à l’écran de départ ?')) this.onNewGame && this.onNewGame(); break;
      case 'selnode-modal': this.closeModal(); this.select({ kind: 'node', id: +d.node }); this.action('center', {}); break;
      // écran de départ
      case 'pick-dept': this.pickDept(d.v); break;
      case 'pick-diff': this.startDiff = d.v; this.renderStart(); break;
      case 'pick-scen': this.startScen = d.v; this.renderStart(); break;
      case 'start-game': this.onStartGame && this.onStartGame(this.startDept, this.startDiff, this.startScen); break;
      case 'resume': this.onResume && this.onResume(); break;
      default: break;
    }
  }

  selPos() {
    const s = this.sel;
    if (!s) return null;
    if (s.kind === 'node') { const n = this.md.nodes[s.id]; return [n.x, n.y]; }
    if (s.kind === 'army') { const d = this.map.disp.get(s.id); return d ? [d.x, d.y] : null; }
    if (s.kind === 'battle') { const b = this.st.battles.find(x => x.id === s.id); return b ? [b.x, b.y] : null; }
    return null;
  }

  // ------------------------------------------------------------------ panneau
  renderPanel(force = false) {
    const p = this.$('panel');
    const s = this.sel;
    let html = '', sig = '';
    if (s.kind === 'node') [html, sig] = this.nodePanel(s.id);
    else if (s.kind === 'army') [html, sig] = this.armyPanel(s.id);
    else if (s.kind === 'battle') [html, sig] = this.battlePanel(s.id);
    if (html == null) {
      // bataille terminée : on annonce l'issue et on garde la main sur une de nos armées qui y était
      const m = this.fightMemo;
      if (s.kind === 'battle' && m && m.id === s.id) {
        this.fightMemo = null;
        this.toastBattleEnd(m);
        const mine = m.mine.find(id => this.armyById(id));
        this.select(mine ? { kind: 'army', id: mine } : null);
        return;
      }
      // l'objet peut manquer brièvement (nouvelle armée pas encore reçue) : on patiente un peu
      this.missing = (this.missing || 0) + 1;
      if (this.missing > 6) {
        if (s.kind === 'army' && m && m.army === s.id) { this.fightMemo = null; this.toastBattleEnd(m, true); }
        this.select(null);
      }
      return;
    }
    this.missing = 0;
    if (!force && (sig === this.panelSig || this.pressing)) return;
    this.panelSig = sig;
    const scroll = p.scrollTop;
    p.innerHTML = `<button class="icon-btn close" data-act="close-panel" aria-label="Fermer">${ICON.close}</button>` + html;
    p.scrollTop = scroll;
    p.hidden = false;
  }

  // issue de la dernière bataille livrée près de (m.x, m.y), d'après le journal
  toastBattleEnd(m, gone = false) {
    const ev = [...this.events].reverse().find(e => e.kind === 'battle_end' && e.seq > m.seq && e.x != null && Math.hypot(e.x - m.x, e.y - m.y) < 4);
    if (ev) this.toast(ev.text, ev.win === true ? 'good' : ev.win === false ? 'bad' : '');
    else if (gone && m.army) this.toast(`${m.name} n’existe plus.`, 'bad');
  }

  costHtml(cost) {
    return Object.entries(cost).map(([k, v]) => `<span title="${this.rules.res_label[k]}" style="white-space:nowrap">${fmt(v)} ${this.rules.res_label[k].toLowerCase()}</span>`).join(', ');
  }

  canPay(cost) {
    const r = this.st.me.res;
    return Object.entries(cost).every(([k, v]) => (r[k] || 0) >= v);
  }

  regRow(r, owner, check) {
    const u = this.rules.units[r[1]] || { short: r[1] };
    const frac = r[2] / r[3];
    const stars = r[4] >= 60 ? '★★★' : r[4] >= 30 ? '★★' : r[4] >= 10 ? '★' : '';
    const fixed = check && u.garrison_only;
    const ck = fixed ? '<input type="checkbox" disabled aria-label="Ne quitte pas sa ville">'
      : check ? `<input type="checkbox" data-reg="${r[0]}" ${this.checked.has(r[0]) ? 'checked' : ''} aria-label="Sélectionner">` : '<span></span>';
    return `<label class="reg ${this.checked.has(r[0]) ? 'sel' : ''}"${fixed ? ' title="La Garde nationale ne quitte pas sa ville"' : u.desc ? ` title="${esc(u.desc)}"` : ''}>${ck}${ICON[r[1]] || ICON.ligne}
      <div class="rn">${u.short}${stars ? ` <span style="color:var(--laiton-clair)">${stars}</span>` : ''}
        ${check ? `<div class="bars"><div class="bar ${frac < 0.5 ? 'red' : ''}"><i style="width:${Math.round(frac * 100)}%"></i></div><div class="bar green"><i style="width:${Math.min(100, r[5])}%"></i></div></div>` : ''}</div>
      <div class="rv">${fmt(r[2])}<small class="muted" style="display:block;font-weight:400;font-size:12px">${check ? 'moral ' + r[5] : '/ ' + r[3]}</small></div></label>`;
  }

  nodePanel(id) {
    const st = this.st, gn = this.md.nodes[id], ns = st.nodes[id];
    if (!gn || !ns) return [null, ''];
    const me = st.me.code;
    const own = ns.o === me;
    const oname = ns.o === 'neutre' ? 'Indépendant (à rallier)' : this.rules.factions[ns.o].name;
    const col = this.map.colors[ns.o];
    const DE = st.word === 'province'
      ? { '33': 'de la Guyenne', '24': 'du Périgord', '40': 'des Landes de Gascogne', '47': 'de l’Agenais', '64': 'du Béarn et du Pays basque' }
      : { '33': 'de la Gironde', '24': 'de la Dordogne', '40': 'des Landes', '47': 'du Lot-et-Garonne', '64': 'des Basses-Pyrénées' };
    const typeLab = gn.type === 'capitale' ? `Chef-lieu ${DE[gn.dept]}` : TYPE_LABEL[gn.type];
    const terr = this.md.terrain_names[this.map.terrain[Math.floor(gn.y) * this.md.W + Math.floor(gn.x)]];
    const sub = ns.o === gn.dept && gn.type === 'capitale' ? typeLab : gn.type === 'capitale' ? `${typeLab}, tenu par ${oname}` : `${typeLab}, ${oname}`;
    let h = `<div class="p-head">${ns.o === 'neutre' ? coat('#8d8a7a', '—') : coat(col, ns.o)}<div><div class="p-title">${esc(gn.name)}</div>
      <div class="p-sub">${sub}</div></div></div>`;
    if (ns.sg) {
      const by = this.rules.factions[ns.sg.by]?.name || ns.sg.by;
      const occ = ns.sg.occ;
      h += `<div class="p-state">${occ ? `Ralliement par ${by}` : `Assiégée par ${by}`} : ${Math.round(ns.sg.dmg * 100)} %</div><div class="bar red"><i style="width:${Math.round(ns.sg.dmg * 100)}%"></i></div>`;
    }
    const pips = (v, m = 3) => `<span class="pips">${Array.from({ length: m }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>`;
    h += `<dl class="kv">
      <dt>Milice</dt><dd>${ns.m != null ? fmt(ns.m) + (ns.mm ? ' / ' + fmt(ns.mm) : '') : 'inconnue'}</dd>
      ${ns.gm != null ? `<dt>Garnison repérée</dt><dd>${fmt(ns.gm)} hommes</dd>` : ''}
      <dt>Fortifications</dt><dd title="${esc(this.fortName(ns.f))}">${pips(ns.f, Math.max(this.rules.fort.max, ns.f, ns.fx || 0))}</dd>
      ${ns.f > 0 ? `<dt></dt><dd class="muted small">${esc(this.fortName(ns.f))}${own ? `, entretien ${fmt1(this.rules.fort.upkeep[ns.f])} livres /j` : ''}</dd>` : ''}
      ${ns.pop ? `<dt>Population</dt><dd>${fmt(ns.pop)} habitants</dd>` : ''}
      <dt>Agrandissement</dt><dd title="${esc(this.devName(gn.type, ns.d))}">${pips(ns.d)}</dd>
      <dt></dt><dd class="muted small">${esc(this.devName(gn.type, ns.d))}${own && ns.pc ? `, place pour ${fmt(ns.pc)}` : ''}</dd>
      ${own ? `<dt>Ordre public</dt><dd>${Math.round(ns.s * 100)} %</dd>` : ''}
      <dt>Terrain</dt><dd>${terr}</dd></dl>`;
    if (own && ns.s < 0.5) h += `<div class="warnline">Population agitée : ${ns.g && ns.g.length ? 'la garnison maintient l’ordre.' : 'sans garnison ni armée sur place, la ville peut se révolter. Baissez les impôts ou laissez-y un régiment.'}</div>`;
    if (own && ns.pc && ns.pop) {
      const free = ns.pc - ns.pop;
      if (ns.pg < 0) h += `<div class="warnline">La population fuit ${ns.sg ? 'le siège' : 'la disette'} : la ville se vide.</div>`;
      else if (free > ns.pc * 0.02 && ns.pg > 0) h += `<div class="muted small" style="margin:-4px 0 8px">De nouveaux habitants arrivent : environ +${fmt(free * ns.pg)} le mois prochain.</div>`;
      else if (free > ns.pc * 0.02) h += `<div class="muted small" style="margin:-4px 0 8px">Personne ne vient s’installer : l’ordre public est trop bas ou les impôts trop lourds.</div>`;
      else if (ns.d < 3) h += `<div class="muted small" style="margin:-4px 0 8px">La ville est pleine : agrandissez-la pour attirer de nouveaux habitants.</div>`;
    }
    if (ns.as != null && ns.as < 1 && this.rules.factions[gn.dept]) {
      const home = this.rules.factions[gn.dept].name;
      h += `<div class="muted small" style="margin:-2px 0 8px">Place conquise, encore attachée à ${esc(home)} : assimilation ${Math.round(ns.as * 100)} %${own ? ' (production réduite, ordre public fragile ; une révolte la rendrait à son pays)' : ''}.</div>`;
    }
    if (gn.star) h += this.starLine(gn.star, own, gn.type === 'capitale');
    const chips = gn.spec.map(s => `<span class="chip">${this.rules.spec[s]}</span>`);
    if (ns.dp) chips.push(`<span class="chip">${ICON.depot.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:3px"')}Magasin aux vivres</span>`);
    if (gn.quai) chips.push(`<span class="chip water">${ICON.anchor.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:3px"')}Quai : ${gn.quai.join(', ')}</span>`);
    if (chips.length) h += `<div class="chips">${chips.join('')}</div>`;
    if (ns.bk) h += `<div class="warnline">Blocus : une place ennemie en aval coupe la route de la mer. Le commerce du port et du quai tombe à ${Math.round(this.rules.water.blockade * 100)} %.</div>`;
    if (!own && ns.o !== 'neutre') {
      const fs = st.factions.find(f => f.code === ns.o);
      h += `<div class="row" style="margin-top:8px"><span class="chip ${fs.st === 'guerre' ? 'war' : fs.st === 'alliance' ? 'ally' : ''}">${STATUS[fs.st]}</span>
        ${fs.st === 'paix' ? '<span class="muted small">Déclarez la guerre (Diplomatie) pour attaquer.</span>' : ''}</div>`;
    }
    if (ns.o === 'neutre') h += `<p class="muted small">Village indépendant : envoyez une armée nettement plus forte que sa milice pour le rallier en quelques jours, sinon il faudra combattre.</p>`;
    if (!own) {
      // renseignement
      if (ns.intel) {
        h += `<div class="section-t">Rapport d’espion (jusqu’au ${ns.intel})</div>` +
          (ns.g && ns.g.length ? `<div class="reg-list">${ns.g.map(r => this.regRow(r, ns.o, false)).join('')}</div>` : '<p class="muted small">Aucun régiment en garnison, seulement la milice.</p>');
      }
      const fsn = st.factions.find(x => x.code === ns.o);
      const atWar = fsn && fsn.st === 'guerre';
      h += `<div class="section-t">Espionnage</div>`;
      if (ns.spy) h += `<p class="small">${ICON.spy.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Un agent est en route (${this.rules.spy[ns.spy.kind].label.toLowerCase()}), ${Math.max(0, Math.ceil(ns.spy.left * 24))} h restantes.</p>`;
      else {
        h += `<div class="btns">${Object.entries(this.rules.spy).map(([k, sp]) => {
          const ok = st.me.res.livres >= sp.cost && (k !== 'saboter' || (atWar && ns.f > 0));
          return `<button class="btn" data-act="spy" data-v="${k}" ${ok ? '' : 'disabled'} title="${esc(sp.desc)}">${sp.label}<small>${sp.cost} livres, ${sp.days} j, ${Math.round(sp.chance * 100)} % de réussite</small></button>`;
        }).join('')}</div><div class="muted small">Espionner révèle la garnison et les armées alentour pendant ${this.rules.spy_days} jours. Saboter (en guerre) ouvre une brèche dans les remparts. Un agent démasqué fâche ${this.st.word === 'province' ? 'la province visée' : 'le département visé'}.</div>`;
      }
    }
    if (own) {
      const here = st.armies.filter(a => a.o === me && a.n === id && a.st === 'idle');
      if (ns.g && ns.g.length) {
        const mobile = ns.g.some(r => !this.rules.units[r[1]]?.garrison_only), garde = ns.g.length > 1 && !ns.g.every(r => !this.rules.units[r[1]]?.garrison_only);
        h += `<div class="section-t">Garnison</div><div class="reg-list">${ns.g.map(r => this.regRow(r, me, true)).join('')}</div>` + (mobile
          ? `<div class="btns"><button class="btn primary" data-act="form">Former une armée</button>
          ${here.map(a => `<button class="btn" data-act="form" data-into="${a.id}">Renforcer ${esc(a.name)}</button>`).join('')}</div>
          <div class="muted small" style="margin-top:4px">Cochez des régiments, sinon toute la garnison part${garde ? ' (sauf la Garde nationale)' : ''}.</div>`
          : `<div class="muted small" style="margin-top:4px">La Garde nationale défend la ville mais n’en sort pas.</div>`);
      }
      // ru : armes qu'on peut lever ici (coût mis à part) ; rw : raison pour les autres
      const U = this.rules.units;
      const ru = ns.ru || (gn.type === 'village' ? [] : gn.type === 'fort' ? ['ligne', 'legere'] : this.rules.unit_order);
      const rw = ns.rw || {};
      const queue = ns.q || [];
      const qFull = queue.length >= 4;   // le serveur refuse au-delà de 4 ordres en file
      const fullT = 'File de production pleine (4 maximum)';
      if (ru.length) {
        h += `<div class="section-t">Lever un régiment</div><div class="units-grid">${ru.filter(u => U[u]).map(u => {
          const c = st.me.unit_costs[u] || {};
          return `<button class="btn unit-card" data-act="recruit" data-v="${u}" ${this.canPay(c) && !ns.sg && !qFull ? '' : 'disabled'} title="${qFull ? fullT : esc(U[u].name + (U[u].desc ? ' : ' + U[u].desc : ''))}">
            ${ICON[u] || ICON.ligne}<span class="un">${U[u].short} <span class="muted" style="font-weight:400">(${U[u].men})</span></span>
            <span class="uc">${this.costHtml(c)}, ${st.me.unit_days[u] ?? '?'} j</span></button>`;
        }).join('')}</div>`;
        // armes encore à découvrir (technologie manquante) : une ligne discrète
        const later = this.rules.unit_order.filter(u => !ru.includes(u) && U[u]?.req && !st.me.techs.includes(U[u].req) && rw[u]);
        if (later.length) h += `<div class="muted small" style="margin-top:4px">Plus tard : ${later.map(u => `<span title="${esc(U[u].desc || '')}">${esc(U[u].short)} (${esc(rw[u])})</span>`).join(', ')}.</div>`;
      }
      h += `<div class="section-t">Aménagements</div><div class="btns">`;
      for (const k of ['fort', 'dev', 'depot'].filter(k => this.rules.build[k])) {
        const b = this.rules.build[k];
        const lvl = k === 'fort' ? ns.f : k === 'depot' ? (ns.dp ? 1 : 0) : ns.d;
        const pend = queue.filter(q => q.kind === 'build' && q.what === k).length;
        const l = lvl + pend;
        const top = k === 'fort' ? (ns.fx || this.rules.fort.max) : b.max || 1;
        // dernier niveau seulement commandé : en chantier (premier de la file) ou en attente derrière d'autres ordres
        const qState = pend ? (queue[0]?.kind === 'build' && queue[0]?.what === k ? 'en chantier' : 'en file d’attente') : '';
        const qDis = qFull ? ` disabled title="${fullT}"` : '';
        if (k === 'depot') {
          // magasin aux vivres : un seul par place
          if (l >= top) h += `<button class="btn" disabled>${ns.dp ? 'Magasin aux vivres construit' : 'Magasin aux vivres : ' + (qState || 'en chantier')}</button>`;
          else h += `<button class="btn" data-act="build" data-v="depot" ${this.canPay(b.costs?.[0] || {}) ? '' : 'disabled'}${qDis || ` title="${esc(b.desc || '')}"`}>Magasin aux vivres<small>${this.costHtml(b.costs?.[0] || {})}, ${b.days?.[0] ?? '?'} j</small></button>`;
          continue;
        }
        if (l >= top) {
          const vauban = k === 'fort' && top < this.rules.fort.bastion && this.rules.fort.bastion_types.includes(gn.type);
          const done = k === 'dev' ? this.devName(gn.type, l) : l === this.rules.fort.bastion ? 'Bastions à la Vauban' : `${b.name} niveau ${l}`;
          h += pend ? `<button class="btn" disabled>${esc(done)} : ${qState}</button>`
            : vauban ? `<button class="btn" disabled title="Recherchez « Fortifications à la Vauban » (militaire)">Bastions à la Vauban<small>technologie Vauban requise</small></button>`
            : `<button class="btn" disabled>${k === 'dev' ? this.devName(gn.type, lvl) + ' : agrandissement maximal' : b.name + ' au maximum'}</button>`;
          continue;
        }
        const c = b.costs[l];
        const lab = k === 'fort' ? `${l + 1 === this.rules.fort.bastion ? 'Bastions à la Vauban' : b.name + ' niveau ' + (l + 1)}`
          : k === 'dev' ? `Agrandir : ${this.devName(gn.type, l + 1).toLowerCase()}` : `${b.name} niveau ${l + 1}`;
        const up = k === 'fort' ? `, entretien ${fmt1(this.rules.fort.upkeep[l + 1])} livres /j` : '';
        h += `<button class="btn" data-act="build" data-v="${k}" ${this.canPay(c) ? '' : 'disabled'}${qDis || ` title="${esc(b.desc)}"`}>${lab}<small>${this.costHtml(c)}, ${b.days[l]} j${up}</small></button>`;
      }
      h += `</div>`;
      if (queue.length) {
        h += `<div class="section-t">En préparation${qFull ? ' <span class="muted small">(file pleine)</span>' : ''}</div>` + queue.map((q, i) => {
          const lab = q.kind === 'unit' ? this.rules.units[q.what]?.name || q.what : this.rules.build[q.what]?.name || q.what;
          const pct = i === 0 ? Math.round((1 - q.left / q.total) * 20) * 5 : 0;   // par pas de 5 % : moins de redessins
          return `<div class="queue-item"><span>${lab}</span><span class="muted">${i === 0 ? Math.ceil(q.left) + ' j' : 'en attente'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
        }).join('');
      }
    }
    h += `<div class="btns"><button class="btn" data-act="center">Centrer la carte</button></div>`;
    // signature = ce qui est affiché (valeurs arrondies, boutons actifs ou non) : pas de redessin à chaque relevé
    return [h, id + '|' + h];
  }

  taxLabel(v) {
    for (const [lim, lab] of this.rules.tax_labels) if (v < lim) return lab;
    return this.rules.tax_labels[this.rules.tax_labels.length - 1][1];
  }

  genHtml(g) {
    if (!g) return '';
    const tr = this.rules.traits[g.trait];
    return `<div class="gen">${ICON.bicorne}<div><div class="gn">${esc(g.rank)} ${esc(g.name)} <span class="stars" title="Niveau ${g.lvl}">${'★'.repeat(g.lvl)}</span></div>
      <div class="gt"><b>${tr.label}</b> : ${esc(tr.desc)}</div></div></div>`;
  }

  tacHtml(a, inBattle) {
    const F = this.rules.formations, P = this.rules.plans;
    const fm = a.fm || 'ligne', pl = a.pl || 'frontal';
    const hasInf = a.regs.some(r => unitCls(this.rules, r[1]) === 'inf');
    const rx = a.rx !== false;
    return `<div class="section-t">Tactique</div>
      ${hasInf ? `<div class="row"><span class="lab">Formation</span><span class="seg wrap">${Object.entries(F).map(([k, f]) =>
        `<button data-act="formation" data-army="${a.id}" data-v="${k}" class="${fm === k ? 'on' : ''}" title="${esc(f.desc)}">${f.label}</button>`).join('')}</span></div>
      <div class="tac-desc">${esc(F[fm].desc)}</div>
      <div class="btns"><button class="btn ${rx ? 'primary' : ''}" data-act="reflex" data-army="${a.id}" data-v="${rx ? 0 : 1}" title="Quand vous commandez vous-même, l’infanterie se forme d’elle-même en carré si la cavalerie ennemie charge.">Carré réflexe face aux charges : ${rx ? 'oui' : 'non'}</button></div>` : ''}
      <div class="row"><span class="lab">Plan de bataille</span><span class="seg wrap">${Object.entries(P).map(([k, p]) =>
        `<button data-act="plan" data-army="${a.id}" data-v="${k}" class="${pl === k ? 'on' : ''}" title="${esc(p.desc)}">${p.label}</button>`).join('')}</span></div>
      <div class="tac-desc">${esc(P[pl].desc)}</div>
      <div class="btns"><button class="btn ${a.auto ? 'primary' : ''}" data-act="plan" data-army="${a.id}" data-v="auto">${a.auto ? '✓ Le général décide' : 'Laisser le général décider'}</button></div>
      <div class="muted small">${a.auto ? 'Le général choisit formation et plan selon les armes de l’ennemi, et s’adapte à chaque phase : canonnade, fusillade, charge.' : 'Vos ordres tactiques sont appliqués tels quels.'}
      ${inBattle ? ' Changer de formation sous le feu désorganise les rangs quelques heures.' : ' Le carré brise les charges mais souffre du canon ; la ligne fusille, la colonne charge, les tirailleurs esquivent les boulets.'}</div>`;
  }

  armyPanel(id) {
    const st = this.st, a = this.armyById(id);
    if (!a) return [null, ''];
    const me = st.me.code, own = a.o === me;
    const f = this.rules.factions[a.o];
    const nodeName = n => this.md.nodes[n]?.name;
    let state = '';
    const lastNode = () => {
      if (!a.path || !a.path.length) return null;
      const l = a.path[a.path.length - 1];
      return l.to != null ? nodeName(l.to) : null;
    };
    const way = a.e ? this.md.edges[a.e[0]] : null;
    if (a.st === 'idle') state = a.sk === 'embuscade' ? (a.h ? 'En embuscade, invisible' : 'En embuscade, mais repérée') : a.n != null ? `Au repos à ${nodeName(a.n)}` : 'Au repos en rase campagne';
    else if (a.st === 'move') state = a.boat ? `${a.emb ? 'Embarque sur les gabares' : 'En gabare'}${way && way.water ? ` (${way.sea ? 'cabotage' : way.way})` : ''}${lastNode() ? ' vers ' + lastNode() : ''}` : `En marche ${lastNode() ? 'vers ' + lastNode() : 'à travers champs'}`;
    else if (a.st === 'retreat') state = `En retraite ${lastNode() ? 'vers ' + lastNode() : ''}`;
    else if (a.st === 'battle') state = 'Engagée dans une bataille';
    else if (a.st === 'siege') {
      const ns = a.n != null ? st.nodes[a.n] : null;
      state = ns && ns.o === 'neutre' ? `Rallie ${nodeName(a.n)} (${Math.round((ns.sg?.dmg || 0) * 100)} %)` : `Assiège ${nodeName(a.n)} (brèche ${Math.round((ns?.sg?.dmg || 0) * 100)} %)`;
    }
    const cell = Math.floor(a.y) * this.md.W + Math.floor(a.x);
    const terr = a.boat && a.n == null ? (way && way.sea ? 'Océan' : 'Fleuve') : this.md.terrain_names[this.map.terrain[cell]];
    let h = `<div class="p-head">${coat(f.color, a.o)}<div><div class="p-title">${esc(a.name)}</div><div class="p-sub">${f.name}, ${fmtMen(a.men)} hommes</div></div></div>
      <div class="p-state">${state}</div>${this.genHtml(a.gen)}`;
    if (a.fire) h += `<div class="warnline">Les gabares essuient le feu des canons ennemis sur la berge !</div>`;
    if (own) {
      h += `<dl class="kv"><dt>Terrain</dt><dd>${terr}${a.h ? ', à couvert' : ''}</dd><dt>Ravitaillement</dt><dd>${Math.round(a.sup * 100)} %</dd>
        ${a.dp ? `<dt></dt><dd class="muted small">Ravitaillée par le magasin de ${esc(a.dp)}</dd>` : ''}
        <dt>Vitesse de marche</dt><dd>${fmt1(a.sp)} km/j${a.boat ? `, ${this.rules.water.speed} en gabare` : ''}</dd></dl>`;
      const wn = a.wn || [];
      if (a.sup < 0.35 && !wn.includes('faim')) h += `<div class="warnline">Ravitaillement épuisé : l’armée s’use. Revenez en territoire ami.</div>`;
      if (wn.includes('solde')) h += `<div class="warnline">Solde impayée : le moral chute et les soldats désertent.</div>`;
      if (wn.includes('faim')) h += `<div class="warnline">Vivres épuisés : le moral chute et les soldats désertent.</div>`;
      if (a.des > 0) h += `<div class="warnline">Déserteurs ce mois-ci : ${fmt(a.des)}</div>`;
      h += `<div class="reg-list">${a.regs.map(r => this.regRow(r, me, true)).join('')}</div>`;
      const canAct = a.st !== 'battle';
      if (!canAct) this.fightMemo = { army: a.id, name: a.name, x: a.x, y: a.y, seq: this.events.length ? this.events[this.events.length - 1].seq : 0, mine: [] };
      else if (this.fightMemo?.army === a.id) { this.toastBattleEnd(this.fightMemo); this.fightMemo = null; }   // sortie de bataille : son issue
      h += `<div class="section-t">Ordres</div>`;
      if (canAct) {
        h += `<div class="row"><span class="lab">Itinéraire</span><span class="seg">
          <button data-act="mode" data-v="route" class="${a.md !== 'champs' ? 'on' : ''}">Routes et fleuves</button>
          <button data-act="mode" data-v="champs" class="${a.md === 'champs' ? 'on' : ''}">À travers champs</button></span></div>
          <div class="row"><span class="lab">Posture</span><span class="seg">
          ${[['normal', 'Normale'], ['embuscade', 'Embuscade'], ['retranche', 'Retranchée']].map(([k, l]) => `<button data-act="stance" data-v="${k}" class="${a.sk === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
          <div class="btns"><button class="btn primary" data-act="march">${ICON.target.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Marcher</button>`;
        if (a.regs.length > 1) h += `<button class="btn" data-act="split">Scinder la sélection</button>`;
        const near = st.armies.filter(b => b.o === me && b.id !== a.id && Math.hypot(b.x - a.x, b.y - a.y) < 3 && b.st !== 'battle');
        for (const b of near) h += `<button class="btn" data-act="merge" data-other="${b.id}">Réunir ${esc(b.name)}</button>`;
        if (a.n != null && st.nodes[a.n].o === me && a.st === 'idle') h += `<button class="btn" data-act="garrison" data-node="${a.n}">Mettre en garnison</button>`;
        if (a.st === 'siege') h += `<button class="btn danger" data-act="assault">Donner l’assaut</button>`;
        if (a.st === 'siege' || a.st === 'move') h += `<button class="btn" data-act="retreat">Se replier</button>`;
        h += `</div>`;
        // détacher une arme entière
        const cls = r => unitCls(this.rules, r[1]);
        const kinds = [...new Set(a.regs.map(cls))];
        if (kinds.length > 1) {
          const lab = { cavalerie: 'la cavalerie', artillerie: 'l’artillerie', inf: 'l’infanterie' };
          h += `<div class="btns">${kinds.map(k => `<button class="btn" data-act="split-type" data-v="${k}">${ICON[k === 'inf' ? 'ligne' : k].replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Détacher ${lab[k]}</button>`).join('')}</div>`;
        }
        h += this.tacHtml(a, false);
        h += `<div class="muted small" style="margin-top:6px">Glissez l’armée du doigt ou du stylet pour tracer son chemin. Par les routes, l’armée embarque d’elle-même sur les gabares quand le fleuve est plus rapide (l’artillerie y gagne beaucoup). Embuscade : hors des routes, dans un bois, une lande, un marais ou en montagne.</div>`;
      } else {
        h += `<div class="btns"><button class="btn danger" data-act="retreat">Ordonner la retraite</button>${a.bt ? `<button class="btn" data-act="selbattle" data-id="${a.bt}">Voir la bataille</button>` : ''}</div><div class="muted small">La retraite coûte des hommes, surtout face à la cavalerie.</div>`;
        h += this.tacHtml(a, true);
      }
    } else {
      const fs = st.factions.find(x => x.code === a.o);
      const fmL = this.rules.formations[a.fm || 'ligne'].label;
      h += `<div class="row"><span class="chip ${fs?.st === 'guerre' ? 'war' : fs?.st === 'alliance' ? 'ally' : ''}">${STATUS[fs?.st] || ''}</span><span class="muted small">Terrain : ${terr}, en ${fmL.toLowerCase()}</span></div>
        <div class="reg-list">${a.regs.map(r => this.regRow(r, a.o, false)).join('')}</div>`;
    }
    h += `<div class="btns"><button class="btn" data-act="center">Centrer la carte</button></div>`;
    const sig = JSON.stringify([id, a.st, a.sk, a.md, a.h, a.n, Math.round(a.sup * 20), a.regs.map(r => [r[0], r[2], Math.round(r[5] / 5)]),
      lastNode(), st.armies.filter(b => b.o === me && Math.hypot(b.x - a.x, b.y - a.y) < 3).length, a.n != null ? st.nodes[a.n].sg : null,
      a.fm, a.pl, a.auto, a.gen, a.boat, !!a.emb, a.fire, a.e && a.e[0], a.dp, a.wn, a.des, a.rx]);
    return [h, sig];
  }

  battlePanel(id) {
    const b = this.st.battles.find(x => x.id === id);
    if (!b) return [null, ''];
    const me = this.st.me.code;
    const phases = Object.entries(this.rules.phases);
    const pi = phases.findIndex(([k]) => k === b.phase);
    let h = `<div class="p-head">${ICON.swords.replace('<svg', '<svg style="width:32px;height:32px;color:var(--laiton-clair)"')}<div><div class="p-title">${b.amb ? 'Embuscade' : b.node != null ? 'Assaut de ' + esc(this.md.nodes[b.node].name) : 'Bataille'}</div><div class="p-sub">Terrain : ${b.terrain}, depuis ${Math.round(b.age * 24)} h</div></div></div>
      <div class="phases">${phases.map(([k, l], i) => `<span class="ph ${i === pi ? 'on' : i < pi ? 'done' : ''}">${l}</span>`).join('<span class="ph-sep">›</span>')}</div>
      <div class="muted small">${{ canonnade: 'Les batteries ouvrent le feu : l’artillerie domine, les carrés et les colonnes souffrent.', fusillade: 'Feux de salve : la ligne et les voltigeurs font la différence, la cavalerie attend son heure.', charge: 'Charges et corps à corps : la cavalerie et les colonnes décident, le carré tient bon.' }[b.phase] || ''}
      ${b.land ? ' Les troupes débarquent sous le feu (attaque affaiblie).' : ''}${b.river >= 2 ? ' L’attaquant doit franchir la rivière.' : ''}</div>`;
    const MIX = { inf: 'infanterie', cavalerie: 'cavalerie', artillerie: 'artillerie', milice: 'milice' };
    b.sides.forEach((s, i) => {
      const f = this.rules.factions[s.o];
      h += `<div class="section-t" style="color:${f ? f.color : '#ccc'}">${i === 0 ? 'Attaque' : 'Défense'} : ${f ? f.name : 'Insurgés'}</div>
        <dl class="kv"><dt>Hommes engagés</dt><dd>${fmt(s.men)}</dd><dt>Pertes</dt><dd>${fmt(s.lost)}</dd><dt>Moral</dt><dd>${s.mor}</dd></dl>
        <div class="bar green"><i style="width:${s.mor}%"></i></div>
        <div class="chips">${Object.entries(s.mix || {}).filter(([, v]) => v > 0).map(([k, v]) => `<span class="chip">${fmt(v)} ${MIX[k] || this.rules.units[k]?.short?.toLowerCase() || k}</span>`).join('')}</div>`;
      for (const t of s.tac || []) {
        const mine = s.o === me;
        h += `<div class="tac-army">${mine ? `<button class="linkish" data-act="selarmy" data-id="${t.id}">${esc(t.name)}</button>` : `<b>${esc(t.name)}</b>`}
          <span class="muted small">${t.gen ? esc(t.gen.rank + ' ' + t.gen.name) + ' (' + this.rules.traits[t.gen.trait].label.toLowerCase() + '), ' : ''}en ${this.rules.formations[t.fm].label.toLowerCase()}, ${this.rules.plans[t.pl].label.toLowerCase()}${t.reorg ? ', se réorganise' : ''}</span></div>`;
      }
    });
    const mineIn = b.sides.flatMap(s => s.o === me ? (s.tac || []) : []);
    const lastSeq = this.events.length ? this.events[this.events.length - 1].seq : 0;
    this.fightMemo = { id, x: b.x, y: b.y, seq: lastSeq, mine: b.sides.flatMap(s => s.o === me ? [...(s.armies || []), ...(s.tac || []).map(t => t.id)] : []) };
    if (mineIn.length) h += `<p class="muted small">Touchez une de vos armées pour changer sa formation ou son plan pendant le combat.</p>`;
    return [h, JSON.stringify([b.phase, b.sides.map(s => [s.men, s.lost, s.mor, (s.tac || []).map(t => [t.fm, t.pl, t.reorg])])])];
  }

  // ------------------------------------------------------------------ fenêtres
  openModal(kind) {
    this.modal = kind;
    this.modalSig = '';
    this.$('modal').hidden = false;
    document.body.classList.add('modal-open');
    this.renderModal(true);
    if (kind === 'menu') this.refreshSaves();
  }
  closeModal() {
    this.modal = null;
    this.$('modal').hidden = true;
    document.body.classList.remove('modal-open');
    for (const b of this.$('rail').children) b.classList.remove('on');
  }

  async refreshSaves() {
    let r;
    try { r = await this.api.get('/api/saves'); } catch (e) { this.toast('Serveur injoignable : liste des sauvegardes indisponible.', 'bad'); return; }
    this.saves = r.saves;
    this.net = r.net;
    this.modalSig = '';
    if (this.modal === 'menu') this.renderModal(true);
  }

  renderModal(force = false) {
    const k = this.modal;
    if (!k || !this.st) return;
    // pendant que le temps file, une fenêtre se met à jour au plus une fois par seconde (lecture et survol tranquilles)
    const now = performance.now();
    if (!force && now - (this.modalAt || 0) < 1000) return;
    const card = this.$('modal').firstElementChild;
    // saisie en cours (quantité, montant…) : ne pas reconstruire, sinon le champ perd le focus à chaque frappe
    const ae = document.activeElement;
    if (!force && ae && card.contains(ae) && (/^(SELECT|TEXTAREA)$/.test(ae.tagName) || (ae.tagName === 'INPUT' && !['range', 'checkbox'].includes(ae.type)))) return;
    const fn = { tech: this.techModal, diplo: this.diploModal, commerce: this.commerceModal, production: this.prodModal,
                 journal: this.journalModal, menu: this.menuModal, fin: this.endModal }[k];
    const [html, sig] = fn.call(this);
    if (!force && sig === this.modalSig) return;
    this.modalSig = sig;
    this.modalAt = now;
    const scroll = card.scrollTop;
    // conserve les saisies
    const vals = {};
    card.querySelectorAll('input[id],select[id]').forEach(i => { vals[i.id] = i.value; });
    card.innerHTML = `<button class="icon-btn close" data-act="close-modal" aria-label="Fermer">${ICON.close}</button>` + html;
    for (const [id, v] of Object.entries(vals)) { const i = document.getElementById(id); if (i && i.type !== 'range') i.value = v; }
    card.scrollTop = scroll;
    for (const b of this.$('rail').children) b.classList.toggle('on', b.dataset.v === k);
  }

  techModal() {
    const me = this.st.me;
    const cols = this.rules.branches.map(br => {
      const cur = me.research[br];
      // par étage de l'arbre (les prérequis d'abord), puis par coût
      const depth = t => t.req.length ? 1 + Math.max(...t.req.map(r => depth(this.rules.techs.find(x => x.id === r)))) : 0;
      const techs = this.rules.techs.filter(t => t.branch === br).sort((a, b) => depth(a) - depth(b) || a.cost - b.cost);
      const curT = cur ? this.rules.techs.find(t => t.id === cur.tech) : null;
      const head = curT ? `En cours : ${curT.name}, ${Math.ceil(cur.left)} j<div class="bar green" style="margin-top:4px"><i style="width:${Math.round((1 - cur.left / cur.total) * 100)}%"></i></div>` : 'Aucune recherche en cours.';
      const cards = techs.map(t => {
        const done = me.techs.includes(t.id);
        const running = cur && cur.tech === t.id;
        const ready = t.req.every(r => me.techs.includes(r)) && !(t.year > (this.st.year || 0));
        const reqNames = t.req.map(r => this.rules.techs.find(x => x.id === r).name).join(', ');
        let foot = '';
        if (done) foot = '<span class="muted">Acquise</span>';
        else if (running) foot = '<span>En cours…</span>';
        else if (t.year > (this.st.year || 0)) foot = `<span class="muted">Pas encore inventée : vers ${t.year}${t.req.length ? ' ; requiert ' + reqNames : ''}</span>`;
        else if (!ready) foot = `<span class="muted">Requiert : ${reqNames}</span>`;
        else foot = `<span>${fmt(t.cost)} livres, ${t.days} j</span><button class="btn" data-act="research" data-v="${t.id}" ${cur || me.res.livres < t.cost ? 'disabled' : ''}>Rechercher</button>`;
        return `<div class="tech ${done ? 'done' : running ? 'running' : !ready ? 'locked' : ''}"><div class="tn">${t.name}</div><div class="td">${t.desc}</div><div class="tc">${foot}</div></div>`;
      }).join('');
      return `<div class="tech-col"><h3>${BRANCH_LABEL[br]}</h3><div class="cur">${head}</div>${cards}</div>`;
    }).join('');
    const html = `<h2 class="m-title" id="m-title">Technologies</h2><p class="m-sub">Une recherche à la fois par branche. Le militaire gagne les batailles, le civil fait marcher l’État, l’industriel forge armes et outils, l’agricole remplit les greniers.</p><div class="tech-cols">${cols}</div>`;
    return [html, JSON.stringify([me.techs, Object.values(me.research).map(r => r && Math.ceil(r.left)), Math.floor(me.res.livres / 25)])];
  }

  diploModal() {
    const st = this.st, me = st.me.code;
    const myPow = st.factions.find(f => f.code === me).power;
    const pris = st.me.prisoners || {};
    const enrollBtn = (code, n, l) => `<button class="btn" data-act="enroll" data-from="${code}" data-n="${n}" ${n ? '' : 'disabled'}>${l}</button>`;
    const cards = st.factions.filter(f => f.code !== me).map(f => {
      const R = this.rules.factions[f.code];
      const held = pris[f.code] || 0;
      if (!f.alive) {
        const by = this.rules.factions[f.cap_owner]?.name || '?';
        return `<div class="dcard dead">${coat(R.color, f.code)}<div><div class="dn">${R.name}</div><div class="dt">A capitulé. Son chef-lieu appartient à ${by}.</div>
          ${held ? `<div class="small">Vous tenez ${fmt(held)} de ses soldats.</div><div class="btns">${enrollBtn(f.code, held, 'Enrôler ses prisonniers')}</div>` : ''}</div></div>`;
      }
      const statusChip = f.over === me ? '<span class="chip ally">Votre vassal</span>' : `<span class="chip ${f.st === 'guerre' ? 'war' : f.st === 'alliance' ? 'ally' : ''}">${STATUS[f.st]}</span>`;
      const wars = f.wars.filter(w => w !== me).map(w => this.rules.factions[w].name);
      const relPos = Math.round((f.rel + 100) / 2);
      let acts = '';
      const btn = (v, l, cls = '') => `<button class="btn ${cls}" data-act="diplo" data-to="${f.code}" data-v="${v}">${l}</button>`;
      if (f.over === me) {
        acts += `<div class="muted small">${this.st.word === 'province' ? 'Cette province' : 'Ce département'} vous verse un tribut et combat vos ennemis.</div>`;
      } else if (f.st === 'guerre') {
        acts += `<div class="row"><input class="amount" type="number" min="0" step="50" value="0" id="amt-paix-${f.code}" aria-label="Tribut offert"><span class="muted small">livres offertes</span>${btn('paix', 'Proposer la paix')}</div>`;
        acts += `<div class="btns">${btn('soumission', 'Exiger la soumission', 'danger')}</div>`;
      } else {
        acts += `<div class="btns">${btn('guerre', 'Déclarer la guerre', 'danger')}
          ${f.st === 'alliance' ? btn('rompre', 'Rompre l’alliance') : btn('alliance', 'Proposer une alliance')}
          ${f.trade ? btn('fin_commerce', 'Dénoncer l’accord commercial') : btn('commerce', 'Proposer un accord commercial')}</div>`;
      }
      acts += `<div class="row"><input class="amount" type="number" min="0" step="50" value="100" id="amt-cadeau-${f.code}" aria-label="Montant du présent"><span class="muted small">livres</span>${btn('cadeau', 'Offrir un présent')}</div>`;
      const theirs = f.pr || 0;
      acts += `<div class="small">Prisonniers : vous tenez ${fmt(held)} de ses soldats, il tient ${fmt(theirs)} des vôtres.</div>
        <div class="btns"><button class="btn" data-act="diplo" data-to="${f.code}" data-v="prisonniers" ${held || theirs ? '' : 'disabled'} title="Chacun rend les prisonniers de l’autre ; le surplus se rachète 2 livres par homme.">Échanger les prisonniers</button>${enrollBtn(f.code, held, 'Enrôler ses prisonniers')}</div>`;
      return `<div class="dcard">${coat(R.color, f.code)}<div>
          <div class="dn">${R.name}</div><div class="dt">${R.title}, chef-lieu ${R.capital}</div>
          <div class="row">${statusChip}${f.trade ? '<span class="chip ally">Accord commercial</span>' : ''}${f.truce ? `<span class="chip">Trêve jusqu’au ${f.truce}</span>` : ''}</div>
          <div class="row"><span class="lab">${relLabel(f.rel)} (${fmt(f.rel)})</span><div class="relbar" style="flex:1;min-width:120px"><i style="left:${relPos}%"></i></div></div>
          <div class="small">Puissance estimée ${fmt(f.power)} (vous ${fmt(myPow)}), ${f.nodes} villes et villages, ${f.techs} technologies.</div>
          <div class="small">Prestige ${fmt(f.prestige || 0)} (vous ${fmt(st.me.prestige || 0)})${f.weary >= 30 ? ` · <span style="color:#ff9a85">las de la guerre (${f.weary} %)</span>` : ''}</div>
          ${wars.length ? `<div class="small" style="color:#ffb3a6">En guerre contre : ${wars.join(', ')}</div>` : ''}
          <ul>${R.pros.map(p => `<li>${p}</li>`).join('')}${R.cons.map(p => `<li class="con">${p}</li>`).join('')}</ul>
        </div><div class="dact">${acts}</div></div>`;
    }).join('');
    const neu = pris.neutre || 0;
    const hegLine = !st.heg ? '' : `<p class="small" style="color:#ffcf85;margin:0 0 8px">${st.heg === st.me.code
      ? 'Vous dominez l’Aquitaine : les autres camps se méfient de vous et se liguent contre vous dès que vous êtes en guerre.'
      : `${esc(this.rules.factions[st.heg].name)} domine l’Aquitaine : les autres camps s’en méfient et entrent volontiers dans ses guerres, dans le camp adverse.`}</p>`;
    const neuLine = neu ? `<div class="row" style="margin-bottom:8px"><span class="small">Vous détenez ${fmt(neu)} miliciens insurgés prisonniers${st.me.prisoner_upkeep ? `, nourris ${fmt1(st.me.prisoner_upkeep)} vivres /j pour tous vos prisonniers` : ''}.</span>${enrollBtn('neutre', neu, 'Enrôler')}</div>` : '';
    const html = `<h2 class="m-title" id="m-title">Diplomatie</h2><p class="m-sub">La relation indique ce que chaque ${this.st.word || 'département'} pense de vous. Les présents, le commerce et les ennemis communs la font monter ; vos conquêtes près de leurs frontières la font baisser.</p>${hegLine}${neuLine}<div class="diplo-list">${cards}</div>`;
    return [html, JSON.stringify([st.factions.map(f => [f.code, f.st, f.rel, f.trade, f.alive, f.over, f.truce, Math.round(f.power / 500), f.wars, f.pr || 0, f.nodes, f.techs, f.cap_owner]),
      pris, fmt1(st.me.prisoner_upkeep || 0), Math.round(myPow / 500), st.heg])];
  }

  commerceModal() {
    const st = this.st, me = st.me;
    const [buyK, sellK] = st.market.spread;
    const rows = Object.entries(st.market.prices).map(([r, p]) => `<tr><td>${ICON[r].replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-4px;margin-right:6px;color:var(--laiton)"')}${this.rules.res_label[r]}</td>
      <td>${fmt(me.res[r])}</td><td>${fmt2(p * buyK)}</td><td>${fmt2(p * sellK)}</td>
      <td><input class="amount" type="number" min="1" max="1000" value="50" id="mq-${r}" aria-label="Quantité de ${esc(this.rules.res_label[r].toLowerCase())}"></td>
      <td><button class="btn" data-act="market" data-res="${r}" data-side="buy">Acheter</button> <button class="btn" data-act="market" data-res="${r}" data-side="sell">Vendre</button></td></tr>`).join('');
    const partners = st.factions.filter(f => f.code !== me.code && f.alive && f.st !== 'guerre');
    const resOpts = sel => ['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'].map(r => `<option value="${r}" ${r === sel ? 'selected' : ''}>${this.rules.res_label[r]}</option>`).join('');
    const trades = st.factions.filter(f => f.trade);
    const html = `<h2 class="m-title" id="m-title">Commerce</h2>
      <p class="m-sub">${me.has_port ? 'Vous tenez un port : les négociants vous font de bons prix.' : 'Sans port, les négociants prennent une forte marge. Prenez Bordeaux, Libourne, Bayonne ou un autre port pour mieux commercer.'}</p>
      <div class="two"><div>
        <h3 class="section-t" style="border:0;padding:0">Marché des négociants</h3>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>Ressource</th><th>Stock</th><th>Achat</th><th>Vente</th><th>Quantité</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted small">Prix en livres par unité. Les prix bougent avec les saisons et vos propres ventes.</p>
      </div><div>
        <h3 class="section-t" style="border:0;padding:0">Proposer un échange</h3>
        ${partners.length ? `<div class="row"><span class="lab">Avec</span><select class="amount" id="tr-to" aria-label="Partenaire de l’échange">${partners.map(f => `<option value="${f.code}">${this.rules.factions[f.code].name}</option>`).join('')}</select></div>
        <div class="row"><span class="lab">Je donne</span><input class="amount" type="number" id="tr-gq" value="100" min="1" aria-label="Quantité donnée"><select class="amount" id="tr-gr" aria-label="Ressource donnée">${resOpts('vivres')}</select></div>
        <div class="row"><span class="lab">Je reçois</span><input class="amount" type="number" id="tr-wq" value="40" min="1" aria-label="Quantité reçue"><select class="amount" id="tr-wr" aria-label="Ressource reçue">${resOpts('fer')}</select></div>
        <div class="btns"><button class="btn primary" data-act="trade-offer">Proposer l’échange</button></div>` : '<p class="muted">Aucun partenaire en paix.</p>'}
        <h3 class="section-t">Accords commerciaux</h3>
        ${trades.length ? trades.map(f => `<div class="row"><span class="chip ally">${this.rules.factions[f.code].name}</span><span class="muted small">Spécialité reçue : ${this.rules.res_label[this.rules.factions[f.code].specialty].toLowerCase()}</span></div>`).join('') +
          `<p class="small">Gains par jour : ${Object.entries(me.trade).filter(([, v]) => v > 0.01).map(([k, v]) => `+${fmt1(v)} ${this.rules.res_label[k].toLowerCase()}`).join(', ') || 'aucun'}</p>`
          : '<p class="muted">Aucun accord. Proposez-en un depuis la Diplomatie.</p>'}
      </div></div>`;
    return [html, JSON.stringify([Object.values(st.market.prices).map(p => p.toFixed(2)), Object.values(me.res).map(Math.round), partners.map(f => f.code), trades.map(f => f.code)])];
  }

  prodModal() {
    const st = this.st, me = st.me;
    const s = Math.round(me.slider * 100);
    const own = this.md.nodes.filter(n => st.nodes[n.id].o === me.code);
    own.sort((a, b) => ['capitale', 'ville', 'fort', 'village'].indexOf(a.type) - ['capitale', 'ville', 'fort', 'village'].indexOf(b.type) || a.name.localeCompare(b.name));
    const rows = own.map(n => {
      const ns = st.nodes[n.id];
      const gar = (ns.g || []).reduce((a, r) => a + r[2], 0);
      const q = (ns.q || []).map(q => q.kind === 'unit' ? this.rules.units[q.what].short : this.rules.build[q.what].name).join(', ');
      return `<tr class="click" data-act="selnode-modal" data-node="${n.id}"><td>${n.name}${ns.bk ? ' <span title="Blocus" style="color:#ff9a85">⚓</span>' : ''}</td><td>${TYPE_LABEL[n.type]}</td><td>${fmt(ns.m || 0)}${gar ? ' + ' + fmt(gar) : ''}</td><td>${fmt(ns.pop || 0)}</td><td>${ns.f}/${ns.d}</td><td style="${ns.s < 0.5 ? 'color:#ff9a85' : ''}">${Math.round(ns.s * 100)} %</td><td class="small">${q || '<span class="muted">—</span>'}</td></tr>`;
    }).join('');
    const tax = Math.round(me.tax * 100), od = me.order;
    const nPr = Object.values(me.prisoners || {}).reduce((a, v) => a + (v || 0), 0);
    const taxK = 0.6 + 0.8 * me.tax;
    const unrest = od.unrest.map(([nid, v]) => `<span class="chip ${od.risk.includes(nid) ? 'war' : ''}" data-act="selnode-modal" data-node="${nid}" style="cursor:pointer">${esc(this.md.nodes[nid].name)} ${Math.round(v * 100)} %</span>`).join('');
    const html = `<h2 class="m-title" id="m-title">Production et impôts</h2><p class="m-sub">Vos ateliers transforment le fer et le bois. Les impôts remplissent le trésor, mais un pays pressuré produit moins et finit par se soulever.</p>
      <div class="two"><div>
        <h3 class="section-t" style="border:0;padding:0">${ICON.scale.replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-3px;margin-right:6px"')}Impôts</h3>
        <input id="tx" class="slider" type="range" min="0" max="100" step="5" value="${tax}" data-act="tax" data-live="tax" aria-label="Niveau des impôts">
        <div class="big-slider-labels"><span>Légers</span><span id="tax-val">${this.taxLabel(me.tax)}</span><span>Écrasants</span></div>
        <dl class="kv" style="margin-top:10px">
          <dt>Rendement des impôts</dt><dd>${Math.round(taxK * 100)} % des livres</dd>
          <dt>Recrues</dt><dd>${me.tax < 0.5 ? '+' : me.tax > 0.5 ? '−' : ''}${Math.round(Math.abs(0.3 * (0.5 - me.tax)) * 100)} %</dd>
          <dt>Ordre public moyen</dt><dd>${Math.round(od.avg * 100)} % (tend vers ${Math.round(od.target * 100)} %)</dd>
        </dl>
        <div class="bar green"><i style="width:${Math.round(od.avg * 100)}%"></i></div>
        ${od.risk.length ? `<p class="warnline">${od.risk.length} place(s) menacée(s) de révolte : ordre public très bas et ni garnison ni armée sur place.</p>` : ''}
        ${unrest ? `<div class="chips" style="margin-top:6px">${unrest}</div>` : ''}
        <p class="muted small">Au-delà d’impôts « normaux », l’ordre public baisse lentement : la production de chaque place suit son ordre public. Des impôts légers pacifient plus vite les villes conquises. Famine et banqueroute agitent aussi la population ; une garnison la calme.</p>
        <h3 class="section-t">Ateliers</h3>
        <label for="sl" class="small muted">Répartition des ateliers</label>
        <input id="sl" class="slider" type="range" min="0" max="100" step="5" value="${s}" data-act="slider" data-live="slider">
        <div class="big-slider-labels"><span>Tout en outils</span><span id="slider-val">${s} % armes, ${100 - s} % outils</span><span>Tout en armes</span></div>
        <dl class="kv" style="margin-top:12px">
          <dt>Capacité industrielle</dt><dd>${fmt1(me.cap)} /j</dd>
          <dt>Armes fabriquées</dt><dd>+${fmt1(me.income.armes)} /j</dd>
          <dt>Outils fabriqués</dt><dd>+${fmt1(me.income.outils)} /j</dd>
          <dt>Couverture en outils</dt><dd>${Math.round(me.cov * 100)} %</dd>
          <dt>Bonus de production</dt><dd>+${Math.round((me.tools_bonus - 1) * 100)} %</dd>
          ${me.pop ? `<dt>Population de vos terres</dt><dd>${fmt(me.pop)} habitants</dd>` : ''}
          <dt>Lassitude de la guerre</dt><dd style="${(me.weary || 0) >= 50 ? 'color:#ff9a85' : ''}">${me.weary || 0} %</dd>
          <dt>Solde des troupes</dt><dd>${fmt1(me.upkeep.livres || 0)} livres /j</dd>
          <dt>Entretien des remparts</dt><dd>${fmt1(me.upkeep.forts || 0)} livres /j</dd>
          <dt>Rations des troupes</dt><dd>${fmt1(me.upkeep.vivres || 0)} vivres /j</dd>
          ${nPr ? `<dt>Prisonniers détenus</dt><dd>${fmt(nPr)} (${fmt1(me.prisoner_upkeep || 0)} vivres /j)</dd>` : ''}
        </dl>
        <div class="bar"><i style="width:${Math.round(me.cov * 100)}%"></i></div>
        ${me.res.fer < 5 || me.res.bois < 5 ? `<p class="warnline">Les ateliers manquent de ${me.res.fer < 5 ? 'fer' : 'bois'} : achetez-en au marché, négociez un échange ou prenez ${me.res.fer < 5 ? 'une forge ou une mine' : 'un village forestier'}.</p>` : ''}
        <p class="muted small">Chaque arme coûte 1 fer et ½ bois ; chaque outil ½ fer et 1 bois. Sans fer ni bois, les ateliers s’arrêtent.</p>
      </div><div>
        <h3 class="section-t" style="border:0;padding:0">Vos villes et villages (${own.length})</h3>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>Lieu</th><th>Type</th><th>Défense</th><th>Habitants</th><th>Fort/Agr.</th><th>Ordre</th><th>Chantier</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div></div>`;
    // signature = le texte affiché (habitants, solde, rations, prisonniers, fabrication…), arrondi comme à l'écran
    return [html, html];
  }

  journalModal() {
    const f = this.journalFilter || 'all';
    const groups = { all: null, battle: ['battle', 'battle_end', 'siege', 'capture', 'capitulation', 'revolte', 'espion'], diplo: ['diplo', 'espion'], eco: ['eco', 'tech', 'meteo', 'armee'] };
    const evs = this.events.filter(e => !groups[f] || groups[f].includes(e.kind)).slice(-250).reverse();
    const tabs = [['all', 'Tout'], ['battle', 'Guerre'], ['diplo', 'Diplomatie'], ['eco', 'Économie']].map(([k, l]) =>
      `<button class="btn ${k === f ? 'primary' : ''}" data-act="jtab" data-v="${k}">${l}</button>`).join('');
    const html = `<h2 class="m-title" id="m-title">Journal de campagne</h2><div class="tabs">${tabs}</div><div class="journal">${evs.map(e =>
      `<div class="ev ${e.important ? 'imp' : ''}" ${e.x != null ? `data-act="goto" data-x="${e.x}" data-y="${e.y}" style="cursor:pointer"` : ''}><span class="when">${e.date}</span><span class="what">${esc(e.text)}</span></div>`).join('') || '<p class="muted">Rien à signaler pour l’instant.</p>'}</div>`;
    return [html, f + this.events.length];
  }

  menuModal() {
    const me = this.st.me;
    const f = this.rules.factions[me.code];
    const def = `${f.name} ${this.st.date.split(' ').slice(1).join(' ')}`;
    const saves = (this.saves || []).map(s => `<div class="save-item"><span>${s.auto ? '<i>Sauvegarde automatique</i>' : esc(s.name)}<br><span class="muted small">${esc(s.faction || '')}, ${esc(s.date || '')}</span></span><button class="btn" data-act="load" data-v="${esc(s.name)}">Charger</button></div>`).join('');
    const rank = [{ code: me.code, prestige: me.prestige || 0, alive: true }, ...this.st.factions.filter(x => x.code !== me.code)]
      .filter(x => x.alive).sort((a, b) => b.prestige - a.prestige);
    const PL = { territoire: 'Territoire', population: 'Population', richesse: 'Richesse', villes: 'Villes et remparts', savoir: 'Savoir', armes: 'Faits d’armes', histoire: 'Histoire' };
    const parts = Object.entries(me.prestige_parts || {}).map(([k, v]) => `<dt>${PL[k] || k}</dt><dd>${fmt(v)}</dd>`).join('');
    const prest = `<h3 class="section-t">Prestige</h3><p class="muted small">En 1900, le plus prestigieux l’emporte. Chaque 1er janvier, votre rayonnement du moment s’ajoute à votre gloire.</p>
      <table class="grid"><tbody>${rank.map((x, i) => `<tr${x.code === me.code ? ' style="font-weight:600"' : ''}><td>${i + 1}.</td><td>${esc(this.rules.factions[x.code].name)}</td><td style="text-align:right">${fmt(x.prestige)}</td></tr>`).join('')}</tbody></table>
      <dl class="kv" style="margin-top:8px"><dt>Gloire accumulée (bilans du 1er janvier)</dt><dd>${fmt(me.glory || 0)}</dd></dl>
      <p class="muted small" style="margin:8px 0 2px">Rayonnement du moment :</p><dl class="kv">${parts}</dl>`;
    const html = `<h2 class="m-title" id="m-title">Partie</h2><p class="m-sub">${f.name}, ${this.st.date}${this.st.era ? ` — ${esc(this.st.era.name)}` : ''}. Victoires ${me.stats.won}, défaites ${me.stats.lost}, places prises ${me.stats.captured}.</p>
      ${prest}
      <div class="two"><div>
        <h3 class="section-t" style="border:0;padding:0">Sauvegarder</h3>
        <div class="row"><input class="amount" style="width:100%" id="save-name" value="${esc(def)}" maxlength="40" aria-label="Nom de la sauvegarde"></div>
        <div class="btns"><button class="btn primary" data-act="save">Sauvegarder</button></div>
        <h3 class="section-t">Charger</h3><div class="saves">${saves || '<p class="muted">Aucune sauvegarde.</p>'}</div>
        <h3 class="section-t">Recommencer</h3><div class="btns"><button class="btn danger" data-act="newgame">Nouvelle partie</button></div>
        <h3 class="section-t">Jouer depuis un autre appareil</h3>${this.netHtml(this.net)}
      </div><div>
        <h3 class="section-t" style="border:0;padding:0">Comment jouer</h3>
        <ul class="small" style="padding-left:18px;margin:0">
          <li>Carte : glissez pour la déplacer (elle garde son élan), pincez ou utilisez les boutons + et − pour zoomer. Double appui : zoom avant ; appui à deux doigts : zoom arrière.</li>
          <li>Touchez une armée pour la sélectionner, puis touchez une destination : choisissez la route ou la marche à travers champs.</li>
          <li>Glissez une de vos armées du doigt ou du stylet pour <b>dessiner son itinéraire</b>, par exemple à travers un bois pour préparer une embuscade, puis choisissez « Suivre mon tracé ».</li>
          <li>Appui long sur la carte (ou clic droit) avec une armée sélectionnée : elle part aussitôt. Appui long sur une ville ou une armée : sélection et centrage.</li>
          <li>Au stylet ou à la souris, survolez une ville ou une armée pour voir ses forces. La paume posée sur l’écran est ignorée pendant l’usage du stylet.</li>
          <li>Les routes sont rapides. À travers champs, l’armée peut se cacher dans les bois, landes, marais ou montagnes et tendre une embuscade (posture « Embuscade »), mais avance plus lentement, s’use et perd son ravitaillement.</li>
          <li>Ralliez les villages indépendants avec une armée bien plus forte que leur milice. Les places fortifiées se prennent par siège : l’artillerie ouvre la brèche plus vite. Les remparts ont quatre niveaux (le quatrième, les bastions à la Vauban, après la technologie du même nom, dans le chef-lieu et les places fortes) ; ils coûtent un entretien et perdent un niveau quand la place est prise de force.</li>
          <li><b>Deux siècles</b> : la grande campagne part de 1700 (ou de 1790, 1813, 1870) et s’achève fin 1899 ; le plus prestigieux l’emporte. Les provinces deviennent départements en 1790 ; technologies et unités n’apparaissent qu’à leur époque. Vitesses ×10 et ×30 (touches 5 et 6) pour les années de paix : guerres, batailles et grandes propositions remettent en pause.</li>
          <li><b>Tactique</b> : chaque armée a un général (trait et grade) et suit une formation et un plan de bataille. Une bataille passe par la canonnade, la fusillade puis la charge. Le carré brise la cavalerie mais souffre du canon ; la ligne fusille mais craint les charges ; la colonne charge fort ; les tirailleurs esquivent les boulets. Laissez le général décider, ou commandez vous-même.</li>
          <li><b>Armée et intendance</b> : grenadiers (infanterie d’élite), chasseurs basques (montagnards, levés au Pays basque), sapeurs (sièges, rivières) et Garde nationale (milice levée partout, qui ne quitte pas sa ville). Un magasin aux vivres ravitaille les armées alentour ; sans solde ni vivres, le moral chute et les soldats désertent. Vos prisonniers s’échangent, se rachètent ou s’enrôlent (Diplomatie). Le carré réflexe forme d’office le carré face aux charges quand vous commandez vous-même.</li>
          <li><b>Fleuves</b> : par les routes, vos armées embarquent sur les gabares de la Garonne, de la Dordogne, du Lot, de l’Isle, de la Baïse, de la Midouze et de l’Adour, ou longent la côte (les tempêtes bloquent les navires). Les canons ennemis sur la berge tirent sur les gabares ; tenir une place en aval coupe le commerce de l’amont (blocus).</li>
          <li><b>Espions</b> : depuis une place étrangère, espionnez (vision et garnison pendant 45 jours) ou sabotez ses remparts en temps de guerre. Le brouillard de guerre (bouton œil) montre ce que vous voyez réellement.</li>
          <li><b>Impôts</b> (fenêtre Production) : plus d’argent tout de suite, mais l’ordre public baisse ; une ville agitée sans garnison peut se révolter.</li>
          <li>La partie est sauvegardée automatiquement chaque mois ; elle reprend au redémarrage du serveur.</li>
          <li>La pluie mouille la poudre, la neige ferme les cols, l’hiver vide les greniers. Les récoltes arrivent en été et en automne.</li>
          <li>Prenez tous les chefs-lieux, ou obtenez la soumission des autres camps. Un camp dont le chef-lieu tombe signe un traité (places cédées, tribut, trêve de cinq ans) ; il n’est rayé de la carte que s’il est déjà écrasé, ou si le même vainqueur le fait plier deux fois en 25 ans. Vous aussi.</li>
          <li>Raccourcis : espace pour la pause, 1 à 6 pour la vitesse, Échap pour annuler.</li>
        </ul>
      </div></div>`;
    return [html, JSON.stringify([(this.saves || []).map(s => s.name), me.stats, this.net])];
  }

  netHtml(net) {
    if (!net) return '<p class="muted small">…</p>';
    if (!net.lan) return `<p class="muted small">Le jeu n’est ouvert qu’à cet ordinateur. Relancez le serveur avec <code>--lan</code> (ou « lancer-reseau ») pour jouer depuis l’iPad.</p>`;
    if (!net.urls.length) return '<p class="muted small">Réseau pas encore disponible.</p>';
    return `<p class="small" style="margin:0 0 4px">Sur l’iPad ou un téléphone connecté au même Wi-Fi, ouvrez :</p>
      <div class="net-urls">${net.urls.map(u => `<code>${esc(u)}</code>`).join('')}</div>`;
  }

  endModal() {
    const o = this.st.over;
    const win = o.result === 'victoire';
    const me = this.st.me;
    const html = `<div class="endcard"><h2 id="m-title" style="color:${win ? 'var(--laiton-clair)' : '#ff9a85'}">${win ? 'Victoire' : 'Défaite'}</h2><p>${esc(o.text)}</p>
      <p class="muted">${me.stats.won} ${me.stats.won > 1 ? 'batailles gagnées' : 'bataille gagnée'}, ${me.stats.lost} ${me.stats.lost > 1 ? 'perdues' : 'perdue'}, ${me.stats.captured} places prises, ${fmt(me.stats.killed)} ennemis hors de combat.</p>
      <div class="btns" style="justify-content:center"><button class="btn primary" data-act="newgame">Nouvelle partie</button><button class="btn" data-act="close-modal">Regarder la carte</button></div></div>`;
    return [html, 'fin'];
  }

  // ------------------------------------------------------------------ écran de départ
  showStart(info) {
    this.startInfo = info;
    this.$('start').hidden = false;
    this.renderStart();
  }
  hideStart() { this.$('start').hidden = true; this.map.highlightDept = null; }

  pickDept(code) {
    this.startDept = code;
    this.map.highlightDept = code;
    const cap = this.md.nodes.find(n => n.type === 'capitale' && n.dept === code);
    const side = window.innerWidth > 760 ? Math.min(470, window.innerWidth * 0.4) : 0;
    const z = Math.min(window.innerWidth - side, window.innerHeight) / 120;
    this.map.moveTo(cap.x - side / 2 / z, cap.y, z);
    this.renderStart();
  }

  renderStart() {
    const info = this.startInfo || { saves: [], running: false };
    const scs = this.rules.scenarios || {};
    const sc = scs[this.startScen] || { title: 'Aquitaine, 1790', intro: '', names: {}, word: 'département' };
    const scenBtns = (this.rules.scenario_order || []).map(k => `<button class="${k === this.startScen ? 'on' : ''}" data-act="pick-scen" data-v="${k}" title="${esc(scs[k].campaign)}">${k}</button>`).join('');
    const cards = Object.entries(this.rules.factions).map(([code, f]) => `
      <button class="dept-card ${this.startDept === code ? 'on' : ''}" data-act="pick-dept" data-v="${code}">
        ${coat(f.color, code)}<div class="dn">${esc(sc.names[code] || f.name)}<small>${f.capital}</small></div><div class="dd">${f.title}</div>
        <div class="traits">${f.pros.map(p => `<div>${p}</div>`).join('')}${f.cons.map(p => `<div class="con">${p}</div>`).join('')}</div>
      </button>`).join('');
    const diffs = Object.entries(this.rules.difficulty).map(([k, l]) => `<button class="${k === this.startDiff ? 'on' : ''}" data-act="pick-diff" data-v="${k}">${l}</button>`).join('');
    const saves = (info.saves || []).map(s => `<div class="save-item"><span>${s.auto ? '<i>Sauvegarde automatique</i>' : esc(s.name)}<br><span class="muted small">${esc(s.faction || '')}, ${esc(s.date || '')}</span></span><button class="btn" data-act="load" data-v="${esc(s.name)}">Charger</button></div>`).join('');
    this.$('start').innerHTML = `<div class="start-side">
      <div class="cartouche"><h1>Conquête</h1><div class="campaign">${esc(sc.title)}</div><p><b>${esc(sc.campaign || '')}.</b> ${esc(sc.intro)}</p></div>
      <div class="row"><span class="lab">Début</span><span class="seg">${scenBtns}</span></div>
      ${info.running ? '<button class="btn primary" data-act="resume">Reprendre la partie en cours</button>' : ''}
      <div class="dept-list">${cards}</div>
      <div class="row"><span class="lab">Difficulté</span><span class="seg">${diffs}</span></div>
      <div class="start-actions">
        <button class="btn primary" data-act="start-game" ${this.startDept ? '' : 'disabled'}>${this.startDept ? `Commencer avec ${esc(sc.names[this.startDept] || this.rules.factions[this.startDept].name)} en ${sc.year}` : (sc.word === 'province' ? 'Choisissez une province' : 'Choisissez un département')}</button>
        ${saves ? `<div class="section-t">Parties sauvegardées${info.saves.length > 5 ? ` <span class="muted small">(${info.saves.length})</span>` : ''}</div><div class="saves scroll">${saves}</div>` : ''}
        ${info.net && info.net.lan && info.net.urls.length ? `<div class="section-t">Sur le réseau local</div>${this.netHtml(info.net)}` : ''}
      </div></div>`;
  }
}

function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }
