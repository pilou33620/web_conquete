import { ICON, speedIcon, coat } from './icons.js';
import { esc, clamp } from './battle/formes.js';
import { fmtMen, unitCls, toursTxt, partTour, TOUR_DAYS } from './map.js';
import { QUALITES, QUALITE_LABEL, QUALITE_AIDE, qualite, setQualite } from './battle/qualite.js';
import { Tuto } from './tuto.js';
import { UnitArt } from './battle/unites.js';
import { profil } from './battle/qualite.js';
import { figureKind, drawPortrait } from './portraits.js';
import { valeursTable } from './valeurs.js';
import { Decouvertes } from './decouvertes.js';
import { ouvrirInterieur } from './carte/interieur.js';
import { arbreHtml } from './arbre.js';
import { startTechs, startRails } from './epoque.js';
import { drawPlan } from './plan.js';

// nombres à la française : virgule décimale et vrai signe moins (−)
const minus = s => s.replace(/^-/, '−');
const fmt = n => minus((Math.round(n) || 0).toLocaleString('fr-FR'));   // || 0 : pas de « −0 »
const fmt1 = n => minus(((Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10) || 0).toLocaleString('fr-FR'));
const fmt2 = n => minus((Math.round(n * 100) / 100 || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signed = n => (Math.round(n) > 0 ? '+' : '') + fmt(n);   // « +2 300 », « −150 »
const hab = n => `${signed(n)} ${Math.abs(Math.round(n)) >= 2 ? 'habitants' : 'habitant'}`;
// variation en pour cent, une décimale, espace fine avant le signe % : « +0,7 % »
const pctChg = (now, before) => {
  const v = before > 0 ? Math.round((now - before) / before * 1000) / 10 : 0;
  return (v > 0 ? '+' : '') + minus((v || 0).toLocaleString('fr-FR')) + '\u202f%';
};
// « de » élidé, comme côté serveur (rules.de) : de Dordogne, d’Agen, du Bugue
const de = n => /^Le /.test(n) ? 'du ' + n.slice(3) : /^Les /.test(n) ? 'des ' + n.slice(4) : /^[aeiouyhâàéèêîïôöûü]/i.test(n) ? `d’${n}` : `de ${n}`;
const STATUS = { paix: 'En paix', guerre: 'En guerre', alliance: 'Alliés', self: 'Vous' };
const TYPE_LABEL = { capitale: 'Chef-lieu', ville: 'Ville', village: 'Village', fort: 'Place forte' };
const RES_ORDER = ['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'];
const BRANCH_LABEL = { infanterie: 'Infanterie et cavalerie', artillerie: 'Artillerie et génie', civil: 'Civil et social', industriel: 'Industriel', agricole: 'Agricole' };
const ACTION_LABEL = { paix: 'propose la paix', alliance: 'propose une alliance', commerce: 'propose un accord commercial', echange: 'propose un échange', prisonniers: 'propose un échange de prisonniers', passage: 'demande le droit de passage sur vos terres' };
// conduite d'une marche : conquérir en chemin ou traverser (le dernier choix est gardé)
const TR_HELP = ['Rallie ou attaque les places indépendantes et ennemies sur la route.',
  'Passe les places indépendantes sans combattre ; halte devant la destination.'];

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
    this.decouv = new Decouvertes(this);   // fenêtre et mise en scène des découvertes (decouvertes.js)
    this.targeting = null;
    this.modal = null;
    this.events = [];
    this.lastSpeed = 1;
    this.cmdSeq = 0;
    this.panelSig = '';
    this.modalSig = '';
    this.pressing = false;
    this.startDept = null;
    this.startDiff = 'normal';
    this.startScen = (rules.scenario_order || ['1790'])[0];
    this.startMode = 'campagne';   // écran de départ : « campagne » ou « bataille » (mode Bataille, bataille isolée)
    this.skOpts = null;            // choix du mode Bataille (serveur : game/tactics/skirmish.py, via main.js)
    this.sk = { me: null, foe: '', era: '1790', kind: 'bataille', role: 'att', place: '', season: '', weather: '', units: {} };
    try { Object.assign(this.sk, JSON.parse(localStorage.getItem('conquete.bataille') || '{}')); } catch (e) { /* réglages perdus */ }
    this.overShown = false;
    try { this.trMode = localStorage.getItem('conquete.traverse') === '1'; } catch (e) { this.trMode = false; }
    map.trMode = this.trMode;
    this.$ = id => document.getElementById(id);
    this.tuto = new Tuto(this);
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
    const tour = this.st.tour && this.st.tour.on;
    if (e.key === ' ') {
      e.preventDefault();
      if (tour) { if (this.st.tour.phase !== 'cours') this.turnCmd('go'); }   // tour par tour : tour suivant, continuer
      else if (this.st.speed) { this.lastSpeed = this.st.speed; this.setSpeed(0); } else this.setSpeed(this.lastSpeed || 1);
    } else if (!tour && /^[1-9]$/.test(e.key) && +e.key < this.rules.speeds.length) this.setSpeed(+e.key);
    else if (e.key === 'Escape') {
      if (!this.$('modal').hidden) this.dismissModal();
      else if (this.targeting) this.stopTargeting();
      else if (!this.$('bubble').hidden) this.hideBubble();
      else this.select(null);
    } else if (e.key === '+' || e.key === '=') this.map.zoomBy(1.4);
    else if (e.key === '-') this.map.zoomBy(1 / 1.4);
  }

  // ------------------------------------------------------------------ commandes serveur
  async cmd(body, toastOk = true) {
    let r;
    this.cmdSeq++;
    try { r = await this.api.post('/api/cmd', body); } catch (e) { r = { ok: false, msg: 'Serveur injoignable : ordre non transmis.' }; }
    this.cmdSeq++;   // avant et après l'ordre : un état demandé entre-temps est périmé (voir poll)
    if (r.ok) this.tuto.signal(body.cmd);
    if (r.msg && (!r.ok || toastOk)) this.toast(r.msg, r.ok ? (r.pending ? '' : 'good') : 'bad');
    this.onRefresh && this.onRefresh();
    return r;
  }
  setSpeed(v) { this.cmd({ cmd: 'speed', value: v }, false); if (this.st) this.st.speed = v; this.renderSpeed(v); }
  // tour par tour : 'go' (tour suivant, continuer le tour des IA) ou 'stop' (arrêter le temps)
  turnCmd(v) {
    const tr = this.st && this.st.tour;
    if (!tr || !tr.on || this.st.over) return;
    this.cmd({ cmd: 'tour', action: v }, false);
    // réponse immédiate à l'écran, sans attendre le prochain état du serveur
    if (v === 'go') { tr.phase = 'cours'; tr.recap = null; }
    this.renderTurn();
  }

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
    // noms des troupes selon l'époque : piquiers, miquelets, milice bourgeoise, chasseurs à pied…
    for (const [k, [nm, sh]] of Object.entries(st.me.unames || {})) {
      const u = this.rules.units[k];
      if (u && (u.name !== nm || u.short !== sh)) { u.name = nm; u.short = sh; }
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
    // une décision historique ou un imprévu : la fenêtre s'ouvre d'elle-même, une fois par événement
    this.evSeen = this.evSeen || new Set();
    const fresh = (st.pending || []).find(p => !this.evSeen.has(p.id));
    if (fresh && !st.over && (!this.modal || this.modal === 'event')) {
      for (const p of st.pending) this.evSeen.add(p.id);
      if (this.modal !== 'event') this.openModal('event');
    }
    if (this.modal === 'event' && !(st.pending || []).length) this.closeModal();
    // une bataille du joueur attend : donner ses ordres, ou la laisser au général (résolution automatique)
    const waitBt = (st.battles || []).find(b => b.mode === 'attente');
    if (waitBt && !st.over && (!this.modal || this.modal === 'bataille')) { if (this.modal !== 'bataille') this.openModal('bataille'); }
    else if (this.modal === 'bataille' && !waitBt) this.closeModal();
    // une de vos armées est arrivée devant une place : à vous de choisir (une fenêtre à la fois, après les batailles)
    const asked = !waitBt && (st.armies || []).find(a => a.ask);
    if (asked && !st.over && (!this.modal || this.modal === 'arrivee')) { if (this.modal !== 'arrivee') this.openModal('arrivee'); }
    else if (this.modal === 'arrivee' && !asked) this.closeModal();
    this.tuto.check();
  }

  battleModal() {
    const b = (this.st.battles || []).find(x => x.mode === 'attente');
    if (!b) return ['<p class="muted">Aucune bataille en attente.</p>', 'none'];
    const nm = o => esc(this.st.names[o] || 'Les insurgés');
    const side = s => `<b>${nm(s.o)}</b> : ${fmt(s.men)} hommes${Object.entries(s.mix || {}).map(([k, v]) => ` · ${fmt(v)} ${k}`).join('')}`;
    const place = b.node != null && this.md.nodes[b.node] ? this.md.nodes[b.node].name : null;
    // le plan de la position ennemie : la bataille se prépare sur le serveur à l'ouverture de la fenêtre (une fois)
    this.plans = this.plans || {};
    const plan = this.plans[b.id];
    if (!plan && this.planReq !== b.id) {
      this.planReq = b.id;
      this.api.post('/api/cmd', { cmd: 'tac', sub: 'preview', bid: b.id }).then(r => {
        this.plans[b.id] = r?.ok ? r.plan : { err: r?.msg || 'Plan indisponible.' };
        if (this.modal === 'bataille') this.renderModal(true);
      }, () => { this.planReq = null; });
    }
    const pcap = !plan ? 'Les éclaireurs reviennent…' : plan.err ? esc(plan.err) : plan.seen
      ? 'Rapport des éclaireurs : la position ennemie (en haut), vos troupes (en bas).'
      : 'Trop peu d’éclaireurs (cavaliers, légers) : la position ennemie est devinée (hachures).';
    const html = `<h2 class="m-title" id="m-title">${b.amb ? 'Embuscade' : b.node != null ? 'Assaut' : 'Bataille'}${place ? ' — ' + esc(place) : ''}</h2>
      <p class="m-sub">${esc(b.terrain)}${b.river ? ', rivière' : ''}. ${side(b.sides[0])} attaque ; ${side(b.sides[1])}.</p>
      <figure class="bt-plan"><canvas role="img" aria-label="Plan de la bataille : la position ennemie"></canvas><figcaption class="muted small">${pcap}</figcaption></figure>
      <div class="ev-choices"><button class="btn primary ev-choice" data-act="tac-choose" data-id="${b.id}" data-v="ordres"><b>Donner mes ordres</b><small>Votre plan, vos ruses ; vos officiers la livrent sous vos yeux, vue de dessus</small></button>
        <button class="btn ev-choice" data-act="tac-choose" data-id="${b.id}" data-v="auto"><b>Résolution automatique</b><small>Le général décide ; la bataille se joue avec la campagne</small></button></div>
      <p class="muted small">La campagne reste en pause tant que vous n’avez pas choisi. Réglage dans le menu ☰.</p>`;
    return [html, `${b.id}|${plan ? 1 : 0}`];
  }

  // devant une place : assaut (à la main ou automatique), rallier, négocier, assiéger, bloquer, contribution, attendre
  arriveeModal() {
    const a = (this.st.armies || []).find(x => x.ask);
    if (!a) return ['<p class="muted">Aucune armée n’attend vos ordres.</p>', 'none'];
    const name = this.md.nodes[a.ask.n]?.name || '';
    const L = {
      ordres: ['Donner mes ordres', 'L’assaut selon votre plan, livré par vos officiers sous vos yeux'],
      auto: ['Résolution automatique', 'L’assaut, réglé par le général'],
      rallier: ['Rallier', 'La place se rallie sans combat'],
      negocier: ['Négocier le ralliement', 'Pourparlers avec les notables, réponse au prochain tour'],
      assieger: ['Assiéger', 'Le siège bat les remparts à chaque tour ; l’assaut part de lui-même à la brèche'],
      bloquer: ['Bloquer et affamer', 'Remparts intacts, vivres coupés : la faim la pousse à se rendre'],
      contribution: ['Exiger une contribution', 'Rançonner la place puis la laisser'],
      attendre: ['Attendre devant la place', 'Halte : les actions restent dans le panneau de l’armée'],
    };
    const btns = Object.entries(a.ask.c).filter(([k]) => L[k]).map(([k, why]) =>
      `<button class="btn ${k === 'ordres' ? 'primary ' : ''}ev-choice" data-act="arrive" data-id="${esc(a.id)}" data-v="${k}"${why ? ' disabled' : ''}><b>${L[k][0]}</b><small>${esc(why || L[k][1])}</small></button>`).join('');
    const html = `<h2 class="m-title" id="m-title">Devant ${esc(name)}</h2>
      <p class="m-sub">La ${esc(a.name)} est arrivée devant la place. Que fait-elle ?</p>
      <div class="ev-choices">${btns}</div>`;
    return [html, `${a.id}|${JSON.stringify(a.ask)}`];
  }

  onEvent(ev, initial) {
    this.events.push(ev);
    if (this.events.length > 600) this.events.splice(0, 100);
    if (initial) return;
    this.decouv.onEvent(ev, initial);
    if (ev.kind === 'tech_ia') this.toast(ev.text);   // (une découverte d'une IA : un bandeau, le jeu continue)
    if (ev.coins) this.map.spawnCoins(this.st.me.code);
    const toastKinds = ['tech', 'eco', 'meteo', 'fin', 'info', 'diplo', 'revolte', 'siege', 'armee', 'espion', 'rail'];
    if (ev.important && toastKinds.includes(ev.kind)) this.toast(ev.text, ev.kind === 'diplo' && /guerre/.test(ev.text) ? 'bad' : '');
  }

  renderSpeed(v) {
    // une bataille se livre sur le champ de bataille : la campagne ne peut pas reprendre
    const tac = this.st && this.st.tac && this.st.tac.phase !== 'fin';
    for (const b of this.$('tb-speed').children) { b.classList.toggle('on', +b.dataset.v === v); b.disabled = !!tac && +b.dataset.v > 0; }
  }

  // ------------------------------------------------------------------ tour par tour
  // barre du haut : « Tour suivant » (votre tour : les ordres s'exécutent tout de suite), progression et « Arrêter »
  // (le tour des IA : le mois s'écoule), « Continuer » et la raison de l'arrêt (interruption)
  renderTurn() {
    const tr = this.st.tour || { on: false };
    const tb = this.$('tb-turn');
    this.$('tb-speed').hidden = !!tr.on;
    tb.hidden = !tr.on;
    document.body.classList.toggle('mode-tour', !!tr.on);
    this.renderRecap();
    if (!tr.on) return;
    const until = `jusqu’au ${esc(tr.end || '')}`;
    const nextTurn = esc(tr.end || '');
    const stop = tr.stop;
    // une bataille attend le choix du joueur, ou se livre sur le champ de bataille : le mois ne reprend pas
    const held = (this.st.tac && this.st.tac.phase !== 'fin') || (this.st.battles || []).some(b => b.mode === 'attente') ||
      (this.st.armies || []).some(a => a.ask);
    const sig = [tr.phase, tr.end, stop ? stop.text + stop.date + stop.more : '', !!this.st.over, held].join('|');
    if (sig !== tb.dataset.sig) {
      tb.dataset.sig = sig;
      const off = this.st.over || held ? ' disabled' : '';
      if (tr.phase === 'cours') {
        tb.innerHTML = `<div class="turn-run" title="Les IA jouent leur tour ${until}"><div class="turn-lbl">Les IA jouent… <span>${until.replace(/ \d{4}$/, '')}</span></div><div class="bar"><i id="turn-bar"></i></div></div>`;
      } else if (tr.phase === 'arret') {
        const why = stop ? `<button class="turn-why k-${esc(stop.kind)}" data-act="turn-why" title="${esc(stop.text)}${stop.x != null || stop.sel ? ' — toucher pour voir' : ''}">${esc(stop.text)}${stop.more ? ` <span class="more">+${stop.more}</span>` : ''}</button>`
          : '<span class="turn-why muted">Tour des IA interrompu.</span>';
        tb.innerHTML = `<button class="turn-go" data-act="turn" data-v="go"${off} title="Reprendre le tour des IA (espace)"><b>Continuer</b><small>le tour des IA ${until}</small></button>${why}`;
      } else {
        tb.innerHTML = `<button class="turn-go" data-act="turn" data-v="go"${off} title="Terminer votre tour (espace) : les IA jouent, puis c’est le ${nextTurn}"><b>Tour suivant</b><small>→ ${nextTurn}</small></button>`;
      }
    }
    const bar = document.getElementById('turn-bar');
    if (bar) bar.style.width = (Math.max(0, Math.min(1, tr.prog || 0)) * 100).toFixed(1) + '%';
  }

  // raison de l'arrêt : centrer la carte, sélectionner la bataille, la place ou l'armée, ou ouvrir la décision
  turnWhy() {
    const s = this.st.tour && this.st.tour.stop;
    if (!s) return;
    if (s.sel === 'event' && (this.st.pending || []).length) { this.openModal('event'); return; }
    if (s.x != null) this.map.moveTo(s.x, s.y, Math.max(this.map.cam.z, 7));
    if (Array.isArray(s.sel)) {
      const [kind, id] = s.sel;
      const there = kind === 'node' || (kind === 'battle' ? this.st.battles.some(b => b.id === id) : !!this.armyById(id));
      if (there) this.select({ kind, id });
    }
  }

  // récapitulatif du mois écoulé, au début de chaque tour : discret, refermable (une fois par appareil)
  renderRecap() {
    const box = this.$('recap');
    const tr = this.st.tour || {};
    const rc = tr.on && tr.phase === 'ordres' ? tr.recap : null;
    if (this.recapClosed === undefined) { try { this.recapClosed = localStorage.getItem('conquete.recap') || ''; } catch (e) { this.recapClosed = ''; } }
    if (!rc || rc.id === this.recapClosed || this.st.over) { box.hidden = true; box.dataset.sig = ''; return; }
    const sig = rc.id + (this.recapOpen ? '+' : '-');
    if (box.dataset.sig === sig && !box.hidden) return;
    box.dataset.sig = sig;
    const go = it => it.x != null ? ` data-act="goto" data-x="${it.x}" data-y="${it.y}"` : '';
    const line = (icon, html, it, cls = '') => `<li class="${cls}"${it ? go(it) : ''}>${icon}<span>${html}</span></li>`;
    const places = l => l.map(p => `<button class="linkish" data-act="goto" data-x="${p.x}" data-y="${p.y}">${esc(p.name)}</button>`).join(', ');
    const lines = [];
    for (const b of rc.battles) lines.push(line(ICON.swords, esc(b.text), b, b.win === true ? 'good' : b.win === false ? 'bad' : ''));
    if (rc.gained.length) lines.push(line(ICON.flag, `${rc.gained.length > 1 ? 'Places prises' : 'Place prise'} : ${places(rc.gained)}`, null, 'good'));
    if (rc.lost.length) lines.push(line(ICON.flag, `${rc.lost.length > 1 ? 'Places perdues' : 'Place perdue'} : ${places(rc.lost)}`, null, 'bad'));
    for (const f of rc.foes || []) lines.push(line(ICON.swords, esc(f.text), f, 'bad'));
    for (const f of rc.facts) lines.push(line(ICON.seal, esc(f.text), f));
    for (const t of rc.techs) lines.push(line(ICON.tech, esc(t.text), t));
    for (const b of rc.built) lines.push(line(ICON.ville, esc(b.text), b));
    if (rc.levied) lines.push(line(ICON.recrues, `${rc.levied} ${rc.levied > 1 ? 'régiments levés' : 'régiment levé'}.`));
    const inc = RES_ORDER.filter(r => Math.abs(rc.inc[r] || 0) >= 1)
      .map(r => `<span class="rc-r" title="${esc(this.rules.res_label[r])}">${ICON[r]}${signed(rc.inc[r])}</span>`).join('');
    const SHOW = 4;
    const more = lines.length - SHOW;
    const shown = this.recapOpen ? lines : lines.slice(0, SHOW);
    box.innerHTML = `<button class="icon-btn close" data-act="recap-close" aria-label="Fermer le récapitulatif">${ICON.close}</button>
      <div class="rc-title">${esc(rc.title)}</div><div class="rc-sub">${esc(rc.period)}${rc.stops ? ` · ${rc.stops} ${rc.stops > 1 ? 'interruptions' : 'interruption'}` : ''}</div>
      <div class="rc-inc"><span class="rc-k">Revenus nets du mois</span>${inc || '<span class="muted">aucun</span>'}</div>
      <ul class="rc-list">${shown.join('') || '<li class="muted"><span>Un mois calme : ni bataille, ni conquête, ni chantier achevé.</span></li>'}</ul>
      ${more > 0 ? `<button class="linkish rc-more" data-act="recap-more">${this.recapOpen ? 'Réduire' : `Tout voir (${more} de plus)`}</button>` : ''}`;
    box.hidden = false;
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
    this.renderTurn();
    for (const r of RES_ORDER) {
      const v = me.res[r], inc = me.income[r];
      this.$('res-' + r).textContent = fmt(v);
      const d = this.$('inc-' + r);
      const iv = fmt1(this.per(inc));
      d.textContent = (iv[0] === '−' ? '' : '+') + iv;
      d.classList.toggle('neg', iv[0] === '−');
      const warn = (r === 'vivres' && me.famine) || (r === 'livres' && me.banqueroute);
      d.parentElement.classList.toggle('warn', warn);
    }
  }

  // taux du moteur (par jour), montrés par tour en tour par tour (un tour = un mois, TOUR_DAYS jours), par jour en temps réel
  per(v) { return this.st?.tour?.on ? v * TOUR_DAYS : v; }
  get perU() { return this.st?.tour?.on ? '/tour' : '/j'; }

  // spécialité phare d'une ville : nom, type et production par tour (avec les technologies du joueur s'il la tient)
  starLine([kind, label], own, capital) {
    const sp = this.rules.specialty[kind];
    if (!sp) return '';
    const k = (1 + (own && sp.boost ? (this.st.me.mods[sp.boost] || 0) : 0)) * (capital ? this.rules.specialty_capital : 1);
    const prod = ['livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois'].filter(r => sp[r])
      .map(r => { const v = this.per(sp[r] * k), lab = r === 'industrie' ? 'industrie' : this.rules.res_label[r].toLowerCase();
        return `+${fmt1(v)} ${r === 'livres' && v < 2 ? 'livre' : lab}`; }).join(', ');
    return `<div class="star-line"><span class="star">★</span><div><b>${esc(label)}</b><div class="muted small">${esc(sp.label)} : ${prod} ${this.perU} (production de base)${own ? '' : ', pour qui tient la ville'}</div></div></div>`;
  }

  // tendance de la population d'une place (trajectoire de l'époque) et, pour les vôtres, ce qui se passe ce mois-ci
  popLines(ns, own) {
    const line = t => `<div class="muted small" style="margin:-4px 0 8px">${t}</div>`;
    let h = '';
    if (ns.pt) {
      const [r, why] = ns.pt;
      const rate = `${r > 0 ? '+' : ''}${minus(r.toLocaleString('fr-FR'))}\u202f% par an`;
      const lab = r >= 1.5 ? `en plein essor (${rate})` : r >= 0.3 ? `en croissance (${rate})` : r > -0.3 ? 'stable' : `en déclin (${rate})`;
      const txt = this.rules.dev?.why?.[why];
      h += line(`Population ${lab}${txt ? ` : ${esc(txt)}` : ''}.`);
    }
    if (!own || !ns.pc || !ns.pop) return h;
    if (ns.pm > 0 && ns.py) {
      h += line(`${hab(ns.pop - ns.py)} depuis ${ns.pm >= 12 ? 'un an' : ns.pm + ' mois'} (${pctChg(ns.pop, ns.py)}).`);
    }
    if (ns.rf) h += line(`Des réfugiés affluent : +${fmt(ns.rf)} le mois dernier.`);
    const free = ns.pc - ns.pop;
    if (ns.pg < 0) {
      const why = ns.sg ? 'le siège' : ns.s < (this.rules.dev?.unrest || 0.35) ? 'le désordre' : 'la disette';
      h += `<div class="warnline">La population fuit ${why} : environ −${fmt(ns.pop * -ns.pg)} habitants le mois prochain${why === 'le désordre' ? ', vers des places plus sûres' : ''}.</div>`;
    } else if (free < -ns.pc * 0.01) {
      h += line(`Trop de monde pour la place : environ −${fmt(-free * (this.rules.dev?.excess || 0.05))} habitants le mois prochain${ns.d < 3 ? ' (un agrandissement les retiendrait)' : ''}.`);
    } else if (free > ns.pc * 0.02 && ns.pg > 0) h += line(`De nouveaux habitants arrivent : environ +${fmt(free * ns.pg)} le mois prochain.`);
    else if (free > ns.pc * 0.02) h += line('Personne ne vient s’installer : l’ordre public est trop bas ou les impôts trop lourds.');
    else if (ns.d < 3) h += line('La ville est pleine : agrandissez-la pour attirer de nouveaux habitants.');
    return h;
  }

  // population de vos terres : évolution sur l'année, villes et campagnes à part
  popYear(py) {
    if (!py || !py.months) return '';
    const when = py.months >= 12 ? 'un an' : `${py.months} mois`;
    const [now, before] = py.all;
    let h = `<dt></dt><dd class="muted small">${hab(now - before)} depuis ${when} (${pctChg(now, before)})</dd>`;
    if (py.towns[0] && py.fields[0]) {
      h += `<dt>dont villes</dt><dd>${fmt(py.towns[0])} <span class="muted small">(${pctChg(...py.towns)})</span></dd>
          <dt>dont campagnes</dt><dd>${fmt(py.fields[0])} <span class="muted small">(${pctChg(...py.fields)})</span></dd>`;
    }
    return h;
  }

  devName(type, d) { const n = this.rules.dev?.names?.[type] || []; return n[Math.min(d, n.length - 1)] || ''; }

  fortName(f) { return this.rules.fort.names[Math.min(f, this.rules.fort.names.length - 1)] || ''; }

  resTip(r) {
    const me = this.st.me;
    const lab = this.rules.res_label[r];
    const rows = [[`Stock`, fmt(me.res[r])], [`Variation ${this.st.tour?.on ? 'par tour' : 'par jour'}`, (fmt1(me.income[r])[0] === '−' ? '' : '+') + fmt1(this.per(me.income[r]))]];
    if (r === 'livres') {
      rows.push(['Solde des troupes', '−' + fmt1(this.per(me.upkeep.livres || 0))]);
      if (me.upkeep.forts) rows.push(['Entretien des remparts', '−' + fmt1(this.per(me.upkeep.forts))]);
      if (me.upkeep.batiments) rows.push(['Entretien des bâtiments', '−' + fmt1(this.per(me.upkeep.batiments))]);
      rows.push(['Commerce', '+' + fmt1(this.per(me.trade.livres || 0))]);
    }
    if (r === 'vivres') { rows.push(['Rations des troupes', '−' + fmt1(this.per(me.upkeep.vivres || 0))]); if (me.prisoner_upkeep) rows.push(['Prisonniers détenus', '−' + fmt1(this.per(me.prisoner_upkeep))]); rows.push(['Saison', this.rules.seasons[this.st.season]]); }
    if (r === 'armes' || r === 'outils') rows.push(['Capacité industrielle', fmt1(this.per(me.cap)) + ' ' + this.perU]);
    if (r === 'outils') rows.push(['Bonus des outils', '+' + Math.round((me.tools_bonus - 1) * 100) + ' %']);
    if (r === 'fer' || r === 'bois') rows.push(['Consommés par les ateliers', 'oui']);
    const fl = me.floor && me.floor[r];
    if (fl) rows.push([this.st.word === 'province' ? 'Minimum garanti de la province' : 'Minimum garanti du département', fmt1(this.per(fl.min)) + ' ' + this.perU + (fl.add > 0.05 ? ` (+${fmt1(this.per(fl.add))} en ce moment)` : '')]);
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
    const sig = this.st.proposals.map(p => p.id).join(',') + '|' + (this.st.pending || []).map(p => p.id + ':' + p.tn).join(',');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = (this.st.pending || []).map(p => `<div class="sheet proposal" style="border-left-color:var(--laiton)"><div class="pt">${esc(p.title)}</div>
        <p>Une décision vous attend (${p.tn <= 1 ? 'avant la fin du tour' : `d’ici ${p.tn} tours`}).</p><div class="btns"><button class="btn primary" data-act="modal" data-v="event">Décider</button></div></div>`).join('') + this.st.proposals.map(p => {
      const f = this.rules.factions[p.frm];
      let detail = '';
      if (p.action === 'echange') detail = `Il offre ${fmt(p.give[1])} ${this.rules.res_label[p.give[0]].toLowerCase()} contre ${fmt(p.get[1])} ${this.rules.res_label[p.get[0]].toLowerCase()}.`;
      if (p.action === 'paix' && p.amount) detail = `Il offre un tribut de ${fmt(p.amount)} livres.`;
      if (p.action === 'commerce') detail = 'Chacun gagnera des livres et la ressource phare de l’autre.';
      if (p.action === 'prisonniers') detail = 'Chacun rend les prisonniers de l’autre ; le surplus se rachète 2 livres par homme.';
      if (p.action === 'alliance') detail = 'Vision partagée et entrée en guerre à vos côtés si vous êtes attaqué.';
      if (p.action === 'passage') detail = `Sans ce droit, ses armées ne peuvent pas traverser vos terres. Accordé, il vaut un an (révocable dans la fenêtre Diplomatie).${p.amount ? ` Il offre ${fmt(p.amount)} livres.` : ''}`;
      return `<div class="sheet proposal" style="border-left-color:${f.color}"><div class="pt">${esc(f.name)} ${esc(ACTION_LABEL[p.action] || p.action)}</div>
        <p>${detail}</p><div class="btns"><button class="btn primary" data-act="answer" data-id="${p.id}" data-v="1">Accepter</button>
        <button class="btn" data-act="answer" data-id="${p.id}" data-v="0">Refuser</button></div></div>`;
    }).join('');
  }

  renderFeed() {
    const kinds = ['battle_end', 'capture', 'capitulation', 'revolte', 'epoque', 'evenement'];
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
    const changed = !sel || !this.sel || sel.kind !== this.sel.kind || sel.id !== this.sel.id;
    if (changed) this.stopTargeting();
    this.sel = sel;
    this.map.selection = sel;
    this.checked.clear();
    if (changed) this.$('panel').scrollTop = 0;   // (une autre sélection s'ouvre en haut, son nom visible)
    this.panelSig = '';
    this.hideBubble();
    if (!sel) { this.$('panel').hidden = true; this.tuto.check(); return; }
    this.renderPanel(true);
    this.tuto.check();
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

  orderMove(a, e, mode, force = false) {
    e = this.moveTarget(e);
    const body = { cmd: 'move', army: a.id, mode, tr: this.trMode, force };
    if (e.hit && e.hit.kind === 'node') body.node = e.hit.id;
    else { body.x = e.x; body.y = e.y; }
    this.cmd(body, false).then(r => {
      // pas de chemin sans terres fermées : passer en force, c'est déclarer la guerre (le joueur confirme)
      if (r.confirm) { if (confirm(r.confirm)) this.orderMove(a, e, mode, true); return; }
      if (r.ok) this.toast(r.msg || 'En marche.', 'good');
    });
  }

  // terres fermées (ni à nous, ni alliées, ni ennemies, sans droit de passage) : sur la destination, et sur le
  // chemin direct (le tracé dessiné, sinon à vol d'oiseau) ; propriétaire d'une cellule = celui de sa place
  closedOnWay(army, tx, ty, trail) {
    const closed = new Set(this.st.factions.filter(f => f.cl).map(f => f.code));
    const out = { target: null, way: [] };
    if (!closed.size || !army) return out;
    const owner = (x, y) => {
      const nd = this.map.cellnode[Math.floor(y) * this.md.W + Math.floor(x)];
      return nd == null || nd === 255 ? null : this.st.nodes[nd]?.o;
    };
    const pts = trail && trail.length > 1 ? trail : [[army.x, army.y], [tx, ty]];
    const start = owner(army.x, army.y), seen = new Set();
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= k; s++) { const o = owner(x0 + (x1 - x0) * s / k, y0 + (y1 - y0) * s / k); if (closed.has(o) && o !== start) seen.add(o); }
    }
    const end = pts[pts.length - 1];
    const to = owner(end[0], end[1]);
    if (closed.has(to)) out.target = to;
    out.way = [...seen].filter(o => o !== out.target);
    return out;
  }

  setTrMode(on) {
    this.trMode = this.map.trMode = on;
    try { localStorage.setItem('conquete.traverse', on ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  }

  trSeg(on, act, army) {
    return `<span class="seg conduct">${['Conquérir en chemin', 'Traverser'].map((l, i) =>
      `<button data-act="${act}" data-v="${i}"${army ? ` data-army="${army}"` : ''} class="${+on === i ? 'on' : ''}" title="${TR_HELP[i]}">${l}</button>`).join('')}</span>`;
  }

  showBubble(e, army, enemy, withTrail = false) {
    const b = this.$('bubble');
    this.bubbleArgs = [e, army, enemy, withTrail];
    const hitNode = e.hit && e.hit.kind === 'node' ? this.md.nodes[e.hit.id] : null;
    const hs = hitNode ? this.st.nodes[hitNode.id] : null;
    const peace = hs && hs.o !== 'neutre' && !this.isMine(hs.o) && this.st.factions.find(f => f.code === hs.o)?.st === 'paix';
    let title = 'Ordre de marche';
    if (hitNode) title = hitNode.name;
    if (enemy) title = `${enemy.name} (${this.rules.factions[enemy.o].name})`;
    const target = enemy ? `data-x="${enemy.x}" data-y="${enemy.y}"` : hitNode ? `data-node="${hitNode.id}"` : `data-x="${e.x}" data-y="${e.y}"`;
    // terres fermées : destination interdite (droit de passage ou passage en force), ou contournement à prévoir
    const [tx, ty] = enemy ? [enemy.x, enemy.y] : hitNode ? [hitNode.x, hitNode.y] : [e.x, e.y];
    const trail = withTrail && this.pendingTrail?.army === army?.id ? this.pendingTrail.pts : null;
    const cw = this.closedOnWay(army, tx, ty, trail);
    const closedTxt = (cw.target ? `<div class="bh warnline">Terres ${esc(de(this.rules.factions[cw.target].name))}, fermées : demandez un droit de passage (Diplomatie), ou passez en force (déclaration de guerre).</div>` : '')
      + (cw.way.length ? `<div class="bh">Détour : les terres ${esc(de(cw.way.map(c => this.rules.factions[c].name).join(' et ')))} sont fermées (sans droit de passage), l’itinéraire les contournera${cw.target ? '' : ' s’il le peut'}.</div>` : '');
    // tour par tour : arrivée estimée par le serveur, sur l'itinéraire que prendrait l'ordre (par les routes)
    const eta = army && this.st.tour?.on ? '<div class="bh" id="bubble-eta"></div>' : '';
    if (eta) {
      const seq = this.etaSeq = (this.etaSeq || 0) + 1;
      const where = enemy ? { x: enemy.x, y: enemy.y } : hitNode ? { node: hitNode.id } : { x: e.x, y: e.y };
      this.api.post('/api/cmd', { cmd: 'eta', army: army.id, mode: 'route', ...where }).then(r => {
        const el = document.getElementById('bubble-eta');
        if (el && seq === this.etaSeq && r.ok && r.tn != null) el.textContent = `Par les routes : arrivée ${r.tn ? toursTxt(r.tn) : 'ce tour-ci'} (estimation).`;
      }).catch(() => { /* estimation indisponible : la bulle s'en passe */ });
    }
    b.innerHTML = `<div class="bt">${esc(title)}</div>${this.trSeg(this.trMode, 'trmode')}
      <div class="bh">${peace && !this.trMode && !cw.target ? 'En paix : on n’y entre qu’en traversant.' : TR_HELP[+this.trMode]}</div>${closedTxt}${eta}
      ${withTrail ? `<button class="btn primary" data-act="go-trail">Suivre mon tracé</button>` : ''}
      <button class="btn ${withTrail ? '' : 'primary'}" data-act="go" data-mode="route" ${target}>Marcher par les routes</button>
      <button class="btn" data-act="go" data-mode="champs" ${target}>Marcher à travers champs</button>
      ${hitNode ? `<button class="btn" data-act="selnode" data-node="${hitNode.id}">Voir ${esc(hitNode.name)}</button>` : ''}
      ${enemy ? `<button class="btn" data-act="selarmy" data-id="${enemy.id}">Voir cette armée</button>` : ''}
      <button class="btn" data-act="hidebubble">Annuler</button>`;
    b.style.left = clamp(e.sx, 110, window.innerWidth - 110) + 'px';
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
      case 'turn': this.turnCmd(d.v); break;
      case 'turn-why': this.turnWhy(); break;
      case 'regcard': {
        // (comme la case à cocher de la liste : le régiment est pris ou laissé pour « Scinder la sélection »)
        if (this.checked.has(d.reg)) this.checked.delete(d.reg); else this.checked.add(d.reg);
        this.renderPanel(true);
        break;
      }
      case 'turn-mode': this.cmd({ cmd: 'tour', action: 'mode', value: d.v === '1' }); break;
      case 'recap-close': {
        const rc = this.st.tour && this.st.tour.recap;
        this.recapClosed = rc ? rc.id : '';
        try { localStorage.setItem('conquete.recap', this.recapClosed); } catch (e) { /* stockage indisponible */ }
        this.renderRecap();
        break;
      }
      case 'recap-more': this.recapOpen = !this.recapOpen; this.renderRecap(); break;
      case 'modal': this.openModal(d.v); break;
      case 'close-modal': this.dismissModal(); break;
      case 'open-tech': this.openModal('tech'); break;
      case 'close-panel': this.select(null); break;
      case 'tuto-next': this.tuto.next(); break;
      case 'tuto-skip': this.tuto.stop(); break;
      case 'tuto-start':   // menu ☰ : tout le tutoriel de la campagne
        this.closeModal();
        this.tuto.start();
        break;
      case 'goto': if (d.x) { if (this.modal) this.closeModal(); this.map.moveTo(+d.x, +d.y, Math.max(this.map.cam.z, 6)); } break;
      case 'interieur': {   // la ville en plein écran (carte/interieur.js)
        const gn = sel && sel.kind === 'node' && this.md.nodes[sel.id];
        if (gn) ouvrirInterieur({ m: this.md, n: gn, ns: this.st.nodes[gn.id], st: this.st, dept: this.md.depts?.[gn.dept]?.name, col: this.map.colors[this.st.nodes[gn.id]?.o], flag: (g, x, y, h, c) => this.map.flag(g, x, y, h, c) });
        break;
      }
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
        const send = force => this.cmd({ cmd: 'path', army: t.army, pts: t.pts, tr: this.trMode, force }, false).then(r => {
          if (r.confirm) { if (confirm(r.confirm)) send(true); return; }
          if (r.ok) this.toast(r.msg || 'En marche.', 'good');
        });
        if (t) send(false);
        break;
      }
      case 'trmode':
        this.setTrMode(d.v === '1');
        if (this.bubbleArgs && !this.$('bubble').hidden) this.showBubble(...this.bubbleArgs);
        break;
      case 'conduct':
        this.setTrMode(d.v === '1');
        this.cmd({ cmd: 'conduct', army: d.army || sel.id, value: d.v === '1' });
        break;
      case 'army-act':
        if (d.confirm && !confirm(d.confirm)) break;
        this.cmd({ cmd: 'army_act', army: sel.id, value: d.v });
        break;
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
      case 'tactic': if (this.onTactic) this.onTactic(d.id); break;
      case 'mode': this.cmd({ cmd: 'mode', army: sel.id, value: d.v }, false); break;
      case 'formation': this.cmd({ cmd: 'formation', army: d.army || sel.id, value: d.v }); break;
      case 'plan': this.cmd({ cmd: 'plan', army: d.army || sel.id, value: d.v }); break;
      case 'reflex': this.cmd({ cmd: 'reflex', army: d.army || sel.id, value: d.v === '1' }); break;
      case 'evchoice': this.cmd({ cmd: 'event', id: d.id, choice: +d.v }).then(r => { if (r && r.ok && (this.st.pending || []).length <= 1) this.closeModal(); }); break;
      case 'rearm': this.cmd(d.node != null ? { cmd: 'rearm', node: +d.node } : { cmd: 'rearm', army: sel.id }); break;
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
        this.tuto.signal('fog');
        break;
      }
      case 'stance': this.cmd({ cmd: 'stance', army: sel.id, value: d.v }); break;
      case 'retreat': this.cmd({ cmd: 'retreat', army: sel.id }); break;
      case 'assault': this.cmd({ cmd: 'assault', army: sel.id }); break;
      case 'garrison': this.cmd({ cmd: 'garrison', army: sel.id }).then(r => {
        if (!r.ok) return;
        this.select({ kind: 'node', id: this.armyById(sel.id)?.n ?? +d.node });
        this.$('p-garnison')?.scrollIntoView({ block: 'start' });   // le bouton pour en ressortir, bas du panneau
      }); break;
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
      // villes : emplacements et politique
      case 'slot': {
        const same = this.slotSel && this.slotSel.node === sel.id && this.slotSel.i === +d.v;
        this.slotSel = same ? null : { node: sel.id, i: +d.v };
        this.renderPanel(true);
        break;
      }
      case 'rail-build': this.cmd({ cmd: 'rail_build', node: sel.id, section: d.v }).then(r => { if (r.ok) this.renderPanel(true); }); break;
      case 'slot-build': this.cmd({ cmd: 'slot_build', node: sel.id, chain: d.v }).then(r => { if (r.ok) { this.slotSel = null; this.renderPanel(true); } }); break;
      case 'slot-demolish': {
        const ns = this.st.nodes[sel.id], s = (ns.sl || []).find(x => x[0] === d.v);
        const name = s ? this.slotName(this.md.nodes[sel.id], d.v, s[1] || 1) : d.v;
        if (!confirm(s && s[1] ? `Démolir « ${name} » ? Le bâtiment est perdu et l’emplacement libéré.` : `Abandonner le chantier de « ${name} » ? Les ressources engagées sont perdues.`)) break;
        this.cmd({ cmd: 'slot_demolish', node: sel.id, chain: d.v }).then(r => { if (r.ok) { this.slotSel = null; this.renderPanel(true); } });
        break;
      }
      case 'policy': this.cmd({ cmd: 'policy', node: sel.id, value: d.v }); break;
      case 'policy-all': this.cmd({ cmd: 'policy', node: sel.id, value: d.v, all: true }); break;
      case 'research': this.cmd({ cmd: 'research', tech: d.v }); break;
      case 'techtab': this.techTab = d.v; this.modalSig = ''; this.renderModal(); break;
      case 'techsel': this.techSel = d.v; this.modalSig = ''; this.renderModal(); break;
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
      case 'arrive':
        this.cmd({ cmd: 'arrive', army: d.id, value: d.v }).then(r => {
          if (r && r.ok) { this.closeModal(); if (r.bid && this.onTactic) this.onTactic(r.bid); }   // (à la main ou sur ordres)
        });
        break;
      case 'tac-choose':
        this.cmd({ cmd: 'tac', sub: 'choose', bid: d.id, mode: d.v }, d.v === 'auto').then(r => {
          if (r && r.ok) { this.closeModal(); if (d.v !== 'auto' && this.onTactic) this.onTactic(r.bid); }
        });
        break;
      case 'tac-set':
        this.st.settings = { battles: d.v };
        this.cmd({ cmd: 'tac', sub: 'settings', battles: d.v }).then(() => { this.modalSig = ''; this.renderModal(true); });
        break;
      case 'map-style': {   // style de la carte (enregistré sur cet appareil)
        this.map.setStyle(d.v);
        this.toast(this.map.style === 'epoque' ? 'Carte d’époque : Cassini, puis état-major.' : 'Carte à la manière d’Ultimate General.');
        this.modalSig = ''; this.renderModal(true);
        break;
      }
      case 'anim': {
        this.map.ambient.setOn(!this.map.ambient.on);
        this.toast(this.map.ambient.on ? 'Animations de la carte activées.' : 'Animations de la carte coupées.');
        this.modalSig = ''; this.renderModal(true);
        break;
      }
      case 'bt-qualite': {   // qualité graphique des batailles (enregistrée sur cet appareil)
        if (!QUALITE_LABEL[d.v]) break;
        setQualite(d.v);
        this.toast(`Qualité graphique des batailles : ${QUALITE_LABEL[d.v].toLowerCase()}.`);
        this.modalSig = ''; this.renderModal(true);
        break;
      }
      case 'newgame': if (confirm('Abandonner la partie en cours et revenir à l’écran de départ ?')) this.onNewGame && this.onNewGame(); break;
      case 'selnode-modal': this.closeModal(); this.select({ kind: 'node', id: +d.node }); this.action('center', {}); break;
      // écran de départ
      case 'pick-dept': this.pickDept(d.v); break;
      case 'pick-diff': this.startDiff = d.v; this.renderStart(); break;
      case 'pick-scen': this.startScen = d.v; this.map.showPreview(d.v); this.renderStart(); break;
      case 'start-game': this.onStartGame && this.onStartGame(this.startDept, this.startDiff, this.startScen); break;
      case 'resume': this.onResume && this.onResume(); break;
      case 'start-mode': this.startMode = d.v; this.map.highlightDept = d.v === 'bataille' ? this.sk.me : this.startDept; this.skMark(); this.renderStart(); break;
      // mode Bataille
      case 'sk-set': {
        const k = d.k, sk = this.sk;
        sk[k] = d.v;
        if (k === 'me') { this.map.highlightDept = d.v; if (sk.foe === d.v) sk.foe = ''; }
        if (k === 'kind' && sk.place && !this.skPlaceOk(+sk.place)) sk.place = '';
        if (k === 'season' && sk.weather && d.v && !(sk.weather in this.skOpts.weather_w[d.v])) sk.weather = '';
        if (k === 'kind') this.skMark();
        this.renderStart();
        break;
      }
      case 'sk-unit': {
        const n = this.skCount(), u = this.sk.units, k = +d.d;
        if (k > 0 && n >= this.skOpts.max) { this.toast(`Au plus ${this.skOpts.max} régiments.`); break; }
        u[d.v] = Math.max(0, (u[d.v] || 0) + k);
        this.renderStart();
        break;
      }
      case 'sk-start': {
        try { localStorage.setItem('conquete.bataille', JSON.stringify(this.sk)); } catch (e) { /* tant pis */ }
        this.onStartSkirmish && this.onStartSkirmish({ ...this.sk, difficulty: this.startDiff });
        break;
      }
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
    this.drawCards(p);
    for (const d of p.querySelectorAll('details.vl-d')) d.addEventListener('toggle', () => { this.vlOpen = d.open; });   // reste ouvert d'un rendu à l'autre
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

  // prix et délai d'une construction pour vous : le ciment les réduit (même calcul que Game.build_cost)
  buildK() { return 1 + (this.st.me.mods?.build_cost || 0); }
  buildCost(cost) { const k = this.buildK(); return Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, Math.ceil(v * k)])); }

  canPay(cost) {
    const r = this.st.me.res;
    return Object.entries(cost).every(([k, v]) => (r[k] || 0) >= v);
  }

  // « Moderniser » (SPEC-ARBRE.md) : mz = { c: prix, n: régiments, arms: [[de, vers, n]], man: [[manœuvre, n]], dr: jours
  // d'exercice qui restent } (game/views.py, _modern)
  modernBtn(mz, node) {
    if (!mz) return '';
    const drill = mz.dr ? `<div class="muted small">À l’exercice dans la place : encore ${partTour(mz.dr)}. Partir l’interrompt.</div>` : '';
    if (!mz.n) return drill;
    const cost = Object.entries(mz.c);
    const ok = cost.every(([k, v]) => (this.st.me.res[k] || 0) >= v);
    const what = [...mz.arms.map(([a, b, n]) => `${n} rég. : ${a} → ${b}`), ...mz.man.map(([m, n]) => `${n} rég. : ${m}`)].join(' ; ');
    return `<button class="btn" data-act="rearm"${node != null ? ` data-node="${node}"` : ''} ${ok ? '' : 'disabled'} title="${esc(`${what}. ${partTour(this.rules.man_days)} d’exercice dans la place.`)}">Moderniser<small>${cost.map(([k, v]) => `${fmt(v)} ${k}`).join(', ')}</small></button>${drill}
      <div class="muted small mz-what">${esc(what)}</div>`;
  }

  // valeurs chiffrées (valeurs.js, calculées par game/tactics/stats.py) : un tableau replié sous les régiments
  valeursDetails(rows, titre) {
    return rows.length ? `<details class="vl-d" ${this.vlOpen ? 'open' : ''}><summary>${esc(titre)}</summary><div class="vl-w">${valeursTable(rows)}</div></details>` : '';
  }

  // lignes du tableau des valeurs : nom court et chevrons de campagne (10, 30, 60 d'expérience)
  valeursRegs(regs) {
    return regs.filter(r => r[10]).map(r => [(this.rules.units[r[1]]?.short || r[1]) + (r[4] >= 10 ? ' ' + '★'.repeat(r[4] >= 60 ? 3 : r[4] >= 30 ? 2 : 1) : ''), r[10]]);
  }

  // régiments en cartes portrait, à la manière d'Ultimate General (portraits.js) : figure de l'arme à l'uniforme de
  // l'époque, effectif, expérience, effectif et moral en barres ; un appui coche ou décoche le régiment (scinder…)
  cardsHtml(regs, owner, check) {
    return `<div class="cards" role="group" aria-label="Régiments">${regs.map(r => {
      const u = this.rules.units[r[1]] || {}, frac = Math.max(0, Math.min(1, r[2] / Math.max(1, r[3])));
      const stars = r[4] >= 60 ? 3 : r[4] >= 30 ? 2 : r[4] >= 10 ? 1 : 0, can = check && !u.garrison_only;
      return `<button class="cu ${can && this.checked.has(r[0]) ? 'on' : ''}" ${can ? `data-act="regcard" data-reg="${r[0]}"` : 'tabindex="-1"'} title="${esc(u.name || r[1])}">
        <canvas data-fig="${esc(r[1])}|${r[6] ?? 1}|${esc(owner)}" width="100" height="160"></canvas>
        <span class="cu-n">${esc(u.short || r[1])}</span><span class="cu-m">${fmt(r[2])}</span>${stars ? `<span class="cu-x">${'★'.repeat(stars)}</span>` : ''}
        <span class="cu-b"><i style="width:${Math.round(frac * 100)}%"></i><i class="mor" style="width:${Math.max(0, Math.min(100, r[5]))}%"></i></span></button>`;
    }).join('')}</div>`;
  }
  // dessine les portraits des cartes d'un panneau
  drawCards(root) {
    const cvs = root.querySelectorAll('.cards canvas[data-fig]');
    if (!cvs.length) return;
    if (!this.cardArt) this.cardArt = new UnitArt(profil());
    const art = this.cardArt, year = this.st?.year || 1790;
    if (art.year !== year) { art.year = year; art.sprites.clear(); }
    for (const cv of cvs) {
      const [type, arm, owner] = cv.dataset.fig.split('|'), u = this.rules.units[type] || {}, cls = unitCls(this.rules, type);
      drawPortrait(cv, art, figureKind({ cls, type, light: !!u.light, arm: +arm }), this.map.colors[owner] || '#888', cls, u.name || '');
    }
  }

  regRow(r, owner, check) {
    const u = this.rules.units[r[1]] || { short: r[1] };
    // (armement fixe, la pièce de Reffye : son nom, jamais démodé)
    const arms = u.arm_name ? [null, u.arm_name] : r[6] != null && this.rules.arms[u.cls] ? this.rules.arms[u.cls][r[6]] : null;
    const mine = owner === this.st.me.code, lag = mine ? r[12] : 0;
    const man = (mine ? r[11] : Array.isArray(r[7]) ? r[7] : null) || [];
    const manNames = man.map(t => this.rules.techs.find(x => x.id === t)?.name || t).join(', ');
    const tip = (arms ? 'Armement' : '') + (manNames ? `${arms ? ' ; m' : 'M'}anœuvres : ${manNames}` : '') +
      (lag === 1 ? '. À moderniser (armes ou manœuvres) dans une de vos places' : lag === 2 ? '. À l’exercice dans la place' : '');
    const armTxt = arms || man.length ? `<span class="small" style="font-weight:400;color:${lag === 1 ? '#ff9a85' : 'var(--muted, #9a9483)'}" title="${esc(tip)}"> · ${arms ? esc(arms[1]) : ''}${man.length ? `${arms ? ', ' : ''}${man.length} manœuvre${man.length > 1 ? 's' : ''}` : ''}${lag === 1 ? ' (à moderniser)' : lag === 2 ? ' (à l’exercice)' : ''}</span>` : '';
    const frac = r[2] / r[3];
    const stars = r[4] >= 60 ? '★★★' : r[4] >= 30 ? '★★' : r[4] >= 10 ? '★' : '';
    const fixed = check && u.garrison_only;
    const ck = fixed ? '<input type="checkbox" disabled aria-label="Ne quitte pas sa ville">'
      : check ? `<input type="checkbox" data-reg="${r[0]}" ${this.checked.has(r[0]) ? 'checked' : ''} aria-label="Sélectionner">` : '<span></span>';
    return `<label class="reg ${this.checked.has(r[0]) ? 'sel' : ''}"${fixed ? ` title="${esc(u.name)} : ne quitte pas sa ville"` : u.desc ? ` title="${esc(u.desc)}"` : ''}>${ck}${ICON[r[1]] || ICON.ligne}
      <div class="rn">${u.short}${stars ? ` <span style="color:var(--laiton-clair)">${stars}</span>` : ''}${armTxt}${r[9] ? `<span class="small" style="font-weight:400;color:var(--papier-2)" title="Portée efficace"> · ${fmt(r[9])} m</span>` : ''}
        ${check ? `<div class="bars"><div class="bar ${frac < 0.5 ? 'red' : ''}" title="Effectif"><i style="width:${Math.round(frac * 100)}%"></i></div><div class="bar green" title="Moral"><i style="width:${Math.min(100, r[5])}%"></i></div>${r[7] != null ? `<div class="bar" style="height:4px" title="Munitions : ${Math.round(r[7])} %"><i style="width:${Math.max(0, Math.min(100, r[7]))}%;background:var(--laiton)"></i></div>` : ''}${r[8] != null ? `<div class="bar" style="height:4px" title="Endurance : ${Math.round(100 - r[8])} %"><i style="width:${Math.max(0, Math.min(100, 100 - r[8]))}%;background:#7fb2e0"></i></div>` : ''}</div>` : ''}</div>
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
      h += `<div class="p-state">${occ ? `Ralliement par ${by}` : ns.sg.bl ? `Bloquée par ${by}, la faim gagne` : `Assiégée par ${by}`} : ${Math.round(ns.sg.dmg * 100)} %${ns.sg.br ? `, brèche ${toursTxt(ns.sg.br)}` : ''}${ns.sg.food ? `, vivres pour ${ns.sg.food > 1 ? ns.sg.food + ' tours' : 'ce tour'}` : ''}</div><div class="bar red"><i style="width:${Math.round(ns.sg.dmg * 100)}%"></i></div>`;
    }
    h += this.worksHtml(ns);
    const pips = (v, m = 3) => `<span class="pips">${Array.from({ length: m }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>`;
    h += `<dl class="kv">
      <dt>Milice</dt><dd>${ns.m != null ? fmt(ns.m) + (ns.mm ? ' / ' + fmt(ns.mm) : '') : 'inconnue'}</dd>
      ${ns.gm != null ? `<dt>Garnison repérée</dt><dd>${fmt(ns.gm)} hommes</dd>` : ''}
      <dt>Fortifications</dt><dd title="${esc(this.fortName(ns.f))}">${pips(ns.f, Math.max(this.rules.fort.max, ns.f, ns.fx || 0))}</dd>
      ${ns.f > 0 ? `<dt></dt><dd class="muted small">${esc(this.fortName(ns.f))}${own ? `, entretien ${fmt1(this.per(this.rules.fort.upkeep[ns.f]))} livres ${this.perU}` : ''}</dd>` : ''}
      ${ns.pop ? `<dt>Population</dt><dd>${fmt(ns.pop)} habitants</dd>` : ''}
      <dt>Agrandissement</dt><dd title="${esc(this.devName(gn.type, ns.d))}">${pips(ns.d)}</dd>
      <dt></dt><dd class="muted small">${esc(this.devName(gn.type, ns.d))}${own && ns.pc ? `, place pour ${fmt(ns.pc)}` : ''}</dd>
      ${own ? `<dt>Ordre public</dt><dd>${Math.round(ns.s * 100)} %</dd>` : ''}
      ${ns.dg ? `<dt>Dégâts</dt><dd>${Math.round(ns.dg * 100)} % en ruine</dd><dt></dt><dd class="muted small">production −${Math.round(ns.dg * (this.rules.deg_prod ?? 0.8) * 100)} %</dd>` : ''}
      <dt>Terrain</dt><dd>${terr}</dd></dl>`;
    if (own && ns.s < 0.5) h += `<div class="warnline">Population agitée : ${ns.g && ns.g.length ? 'la garnison maintient l’ordre.' : 'sans garnison ni armée sur place, la ville peut se révolter. Baissez les impôts ou laissez-y un régiment.'}</div>`;
    if (ns.pop) h += this.popLines(ns, own);
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
    if (ns.o === 'neutre') h += `<p class="muted small">Village indépendant : envoyez une armée nettement plus forte que sa milice : il se rallie aussitôt (sa marche du tour s’arrête là), sinon il faudra combattre.</p>`;
    if (!own) {
      // renseignement
      if (ns.intel) {
        h += `<div class="section-t">Rapport d’espion (jusqu’au ${ns.intel})</div>` +
          (ns.g && ns.g.length ? `<div class="reg-list">${ns.g.map(r => this.regRow(r, ns.o, false)).join('')}</div>` : '<p class="muted small">Aucun régiment en garnison, seulement la milice.</p>');
      }
      const fsn = st.factions.find(x => x.code === ns.o);
      const atWar = fsn && fsn.st === 'guerre';
      h += `<div class="section-t">Espionnage</div>`;
      if (ns.spy) h += `<p class="small">${ICON.spy.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Un agent est en route (${this.rules.spy[ns.spy.kind].label.toLowerCase()}) : son rapport ${toursTxt(ns.spy.tn)}.</p>`;
      else {
        h += `<div class="btns">${Object.entries(this.rules.spy).map(([k, sp]) => {
          const ok = st.me.res.livres >= sp.cost && (k !== 'saboter' || (atWar && ns.f > 0));
          return `<button class="btn" data-act="spy" data-v="${k}" ${ok ? '' : 'disabled'} title="${esc(sp.desc)}">${sp.label}<small>${sp.cost} livres, rapport au prochain tour, ${Math.round(sp.chance * 100)} % de réussite</small></button>`;
        }).join('')}</div><div class="muted small">Espionner révèle la garnison et les armées alentour pendant ${this.rules.spy_tours} tours. Saboter (en guerre) ouvre une brèche dans les remparts. Un agent démasqué fâche ${this.st.word === 'province' ? 'la province visée' : 'le département visé'}.</div>`;
      }
    }
    if (own) {
      const here = st.armies.filter(a => a.o === me && a.n === id && a.st === 'idle');
      if (ns.g && ns.g.length) {
        const mobile = ns.g.some(r => !this.rules.units[r[1]]?.garrison_only), garde = ns.g.length > 1 && !ns.g.every(r => !this.rules.units[r[1]]?.garrison_only);
        h += `<div class="section-t" id="p-garnison">Garnison</div><div class="reg-list">${ns.g.map(r => this.regRow(r, me, true)).join('')}</div>` + this.valeursDetails(this.valeursRegs(ns.g), 'Valeurs des régiments (en bataille)') + (mobile
          ? `<div class="btns"><button class="btn primary" data-act="form">Sortir de la garnison (former une armée)</button>
          ${here.map(a => `<button class="btn" data-act="form" data-into="${a.id}">Renforcer ${esc(a.name)}</button>`).join('')}${ns.sg ? '' : this.modernBtn(ns.gmz, id)}</div>
          <div class="muted small" style="margin-top:4px">Cochez des régiments, sinon toute la garnison part${garde ? ` (sauf ${/^[aeiouéh]/i.test(this.rules.units.garde.name) ? 'l’' : 'la '}${esc(this.rules.units.garde.name.toLowerCase())})` : ''}.</div>`
          : `<div class="btns">${ns.sg ? '' : this.modernBtn(ns.gmz, id)}</div><div class="muted small" style="margin-top:4px">${esc(this.rules.units.garde.name)} : elle défend la ville mais n’en sort pas.</div>`);
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
            <span class="uc">${this.costHtml(c)}, ${st.me.unit_days[u] != null ? partTour(st.me.unit_days[u]) : '?'}</span></button>`;
        }).join('')}</div>` + this.valeursDetails(ru.filter(u => U[u] && ns.rs?.[u]).map(u => [U[u].short, ns.rs[u]]), 'Valeurs des troupes à lever (en bataille)');
        // armes encore à découvrir (technologie manquante) : une ligne discrète
        const later = this.rules.unit_order.filter(u => !ru.includes(u) && U[u]?.req && !st.me.techs.includes(U[u].req) && rw[u]);
        if (later.length) h += `<div class="muted small" style="margin-top:4px">Plus tard : ${later.map(u => `<span title="${esc(U[u].desc || '')}">${esc(U[u].short)} (${esc(rw[u])})</span>`).join(', ')}.</div>`;
      }
      h += `<div class="section-t">Aménagements</div><div class="btns">`;
      if (ns.rp) {   // réparer la ville : en tours selon les dégâts (engine.repair_quote)
        const pend = queue.some(q => q.kind === 'build' && q.what === 'repar');
        h += pend ? `<button class="btn" disabled>Réparations : ${queue[0]?.kind === 'build' && queue[0]?.what === 'repar' ? 'en chantier' : 'en file d’attente'}</button>`
          : `<button class="btn" data-act="build" data-v="repar" ${this.canPay(ns.rp.c) && !ns.sg && !qFull ? '' : 'disabled'} title="${esc(ns.sg ? 'On ne rebâtit pas une ville assiégée' : qFull ? fullT : this.rules.build.repar?.desc || '')}">Réparer la ville<small>${this.costHtml(ns.rp.c)}, ${ns.rp.tn} tour${ns.rp.tn > 1 ? 's' : ''}</small></button>`;
      }
      for (const k of ['fort', 'dev'].filter(k => this.rules.build[k])) {   // le magasin aux vivres est dans les emplacements
        const b = this.rules.build[k];
        const lvl = k === 'fort' ? ns.f : ns.d;
        const pend = queue.filter(q => q.kind === 'build' && q.what === k).length;
        const l = lvl + pend;
        const top = k === 'fort' ? (ns.fx || this.rules.fort.max) : b.max || 1;
        // dernier niveau seulement commandé : en chantier (premier de la file) ou en attente derrière d'autres ordres
        const qState = pend ? (queue[0]?.kind === 'build' && queue[0]?.what === k ? 'en chantier' : 'en file d’attente') : '';
        const qDis = qFull ? ` disabled title="${fullT}"` : '';
        if (l >= top) {
          const vauban = k === 'fort' && top < this.rules.fort.bastion && this.rules.fort.bastion_types.includes(gn.type);
          const done = k === 'dev' ? this.devName(gn.type, l) : l === this.rules.fort.bastion ? 'Bastions à la Vauban' : `${b.name} niveau ${l}`;
          h += pend ? `<button class="btn" disabled>${esc(done)} : ${qState}</button>`
            : vauban ? `<button class="btn" disabled title="Recherchez « Fortifications à la Vauban » (artillerie et génie)">Bastions à la Vauban<small>technologie Vauban requise</small></button>`
            : `<button class="btn" disabled>${k === 'dev' ? this.devName(gn.type, lvl) + ' : agrandissement maximal' : b.name + ' au maximum'}</button>`;
          continue;
        }
        const c = this.buildCost(b.costs[l]);
        const lab = k === 'fort' ? `${l + 1 === this.rules.fort.bastion ? 'Bastions à la Vauban' : b.name + ' niveau ' + (l + 1)}`
          : k === 'dev' ? `Agrandir : ${this.devName(gn.type, l + 1).toLowerCase()}` : `${b.name} niveau ${l + 1}`;
        const up = k === 'fort' ? `, entretien ${fmt1(this.per(this.rules.fort.upkeep[l + 1]))} livres ${this.perU}` : '';
        h += `<button class="btn" data-act="build" data-v="${k}" ${this.canPay(c) ? '' : 'disabled'}${qDis || ` title="${esc(b.desc)}"`}>${lab}<small>${this.costHtml(c)}, ${partTour(b.days[l] * this.buildK())}${up}</small></button>`;
      }
      h += `</div>`;
      h += this.railHtml(id);   // voie ferrée (game/rails.py)
      h += this.cityHtml(id, gn, ns, queue, qFull);   // emplacements et politique de la ville
      if (queue.length) {
        h += `<div class="section-t">En préparation${qFull ? ' <span class="muted small">(file pleine)</span>' : ''}</div>` + queue.map((q, i) => {
          const lab = q.kind === 'unit' ? this.rules.units[q.what]?.name || q.what
            : q.kind === 'slot' && this.rules.cities?.chains[q.what] ? this.slotName(gn, q.what, q.lvl || 1) : this.rules.build[q.what]?.name || q.what;
          const pct = i === 0 ? Math.round((1 - q.left / q.total) * 20) * 5 : 0;   // par pas de 5 % : moins de redessins
          return `<div class="queue-item"><span>${lab}</span><span class="muted">${q.tn == null ? 'en attente (place assiégée)' : 'prêt ' + toursTxt(q.tn)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
        }).join('');
      }
    }
    h += `<div class="btns"><button class="btn" data-act="center">Centrer la carte</button><button class="btn" data-act="interieur">Voir l’intérieur</button></div>`;
    // signature = ce qui est affiché (valeurs arrondies, boutons actifs ou non) : pas de redessin à chaque relevé
    return [h, id + '|' + h];
  }

  // ------------------------------------------------------------------ villes : emplacements et politique
  slotName(gn, k, lvl) {
    const C = this.rules.cities, sp = gn.star && C.spec_names[gn.star[0]];
    lvl = Math.max(1, lvl);
    if (k === 'specialite' && sp) return sp.names[lvl - 1];
    return C.chains[k].levels[lvl - 1].name;
  }

  slotTech(gn, k, lvl) {
    const C = this.rules.cities, t = C.chains[k].levels[lvl - 1].tech;
    return t === '*' ? (gn.star && C.spec_names[gn.star[0]]?.tech) || null : t;
  }

  // ce que le serveur vérifiera (cities.check) : niveau visé et raison d'un refus
  slotCheck(gn, ns, k) {
    const C = this.rules.cities, ch = C.chains[k];
    if (ch.where === 'star' && !(gn.star && this.rules.specialty[gn.star[0]])) return { why: 'Il faut une spécialité dans la ville', hide: true };
    if (ch.where === 'quai' && !(gn.quai && gn.type !== 'fort')) return { why: 'Il faut un quai sur un fleuve navigable', hide: true };
    const cur = (ns.sl.find(s => s[0] === k) || [])[1];
    if (cur === 0 || (ns.q || []).some(q => (q.kind === 'slot' || q.kind === 'build') && q.what === k)) return { why: 'Déjà en chantier' };
    const lvl = cur == null ? 1 : cur + 1;
    if (lvl > ch.levels.length) return { why: 'Niveau maximal atteint' };
    if (cur == null && ns.sl.length >= ns.sn) return { lvl, why: 'Plus d’emplacement libre' };
    const L = ch.levels[lvl - 1];
    if ((ns.d || 0) < (L.dev || 0)) return { lvl, why: `Il faut d’abord agrandir la ville (niveau ${L.dev})` };
    const t = this.slotTech(gn, k, lvl);
    if (t && !this.st.me.techs.includes(t)) return { lvl, why: `Technologie requise : ${C.tech_names[t] || t}` };
    return { lvl };
  }

  // effets d'un niveau ; la production des bâtiments dépend de la taille de la place
  slotFx(gn, L) {
    const sk = this.rules.cities.size_k[gn.type];
    const txt = this.st?.tour?.on ? L.txt : L.txtj || L.txt;   // (temps réel : txtj)
    const note = sk !== 1 && /\/(tour|j)\b/.test(txt) ? ` (production ×${fmt1(sk)} ${gn.type === 'capitale' ? 'au chef-lieu' : gn.type === 'fort' ? 'dans une place forte' : 'dans un village'})` : '';
    return txt + note + (L.up ? `, entretien ${fmt1(this.per(L.up))} livres ${this.perU}` : '');
  }

  // section « Voie ferrée » du panneau d'une ville : les tronçons qui en partent, ouverts, coupés, en chantier, ou à
  // lancer (SPEC-TECH.md, phase 2a)
  railHtml(id) {
    const R = this.st.rails, secs = (this.md.rails?.sections || []).filter(s => s[1] === id || s[2] === id);
    if (!R || !secs.length) return '';
    const st = new Map(R.state.map(x => [x[0], x])), op = new Map(R.open.map(x => [x[0], x]));
    const rows = secs.map(([sid, a, b, , km, line]) => {
      const to = this.md.nodes[a === id ? b : a].name, s = st.get(sid), o = op.get(sid);
      const lab = `Vers ${esc(to)} <span class="muted small">(${fmt(km)} km, ${esc(line)})</span>`;
      if (s && s[1] === 'fait') return `<div class="rail">${lab} : voie ouverte</div>`;
      if (s && s[1] === 'coupe') return `<div class="rail">${lab} : <span style="color:#ff9a85">voie coupée</span></div>`;
      if (s) return `<div class="rail">${lab} : chantier${s[3] && s[3] !== this.st.me.code ? ` (${esc(this.st.names?.[s[3]] || s[3])})` : ''}
        <div class="bar green" style="margin-top:3px"><i style="width:${Math.round(s[2] * 100)}%"></i></div></div>`;
      if (o) return `<button class="btn" data-act="rail-build" data-v="${sid}" ${this.canPay(o[1]) ? '' : 'disabled'}>${lab}<small>${this.costHtml(o[1])}, environ ${fmt(Math.ceil(o[2]))} tour${o[2] > 1 ? 's' : ''}</small></button>`;
      return '';
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<div class="section-t">Voie ferrée <span class="muted small">(${R.works} / ${R.max} chantiers)</span></div><div class="build">${rows.join('')}</div>`;
  }

  slotBtn(gn, ns, k, chk, qFull, label) {
    const L = this.rules.cities.chains[k].levels[chk.lvl - 1], cost = this.buildCost(L.cost);
    const ok = !chk.why && !qFull && !ns.sg && this.canPay(cost);
    const why = chk.why || (qFull ? 'File de production pleine' : ns.sg ? 'Place assiégée' : !this.canPay(cost) ? 'Ressources insuffisantes' : '');
    return `<button class="btn slot-opt" data-act="slot-build" data-v="${k}" ${ok ? '' : 'disabled'}><b>${esc(label)}</b>
      <small>${this.costHtml(cost)}, ${partTour(L.days * this.buildK())}</small><small>${esc(this.slotFx(gn, L))}</small>${why ? `<small class="why">${esc(why)}</small>` : ''}</button>`;
  }

  cityHtml(id, gn, ns, queue, qFull) {
    const C = this.rules.cities;
    if (!C || !ns.sl) return '';
    const sl = ns.sl, sn = ns.sn, n = Math.max(sn, sl.length);
    const cur = this.slotSel && this.slotSel.node === id && this.slotSel.i < n ? this.slotSel.i : null;
    let h = `<div class="section-t">Emplacements <span class="muted small">(${sl.length} / ${sn})</span></div><div class="slots">`;
    for (let i = 0; i < n; i++) {
      const s = sl[i], on = cur === i ? ' on' : '';
      if (!s) { h += `<button class="slot empty${on}" data-act="slot" data-v="${i}" aria-label="Emplacement libre"><span class="si">+</span><span>Libre</span></button>`; continue; }
      const [k, lvl] = s, ch = C.chains[k];
      const work = lvl === 0 || queue.some(q => q.kind === 'slot' && q.what === k);
      const ic = ch.icon === 'star' ? '<span class="si">★</span>' : (ICON[ch.icon] || '');
      h += `<button class="slot${on}${i >= sn ? ' over' : ''}" data-act="slot" data-v="${i}" title="${esc(ch.name)}">${ic}<span>${esc(this.slotName(gn, k, lvl || 1))}</span>
        <span class="pips">${ch.levels.map((_, j) => `<i class="${j < lvl ? 'on' : ''}"></i>`).join('')}</span>${work ? '<span class="sw">en chantier</span>' : ''}</button>`;
    }
    h += '</div>';
    if (sl.length > sn) h += `<div class="muted small" style="margin-top:4px">Plus de bâtiments que d’emplacements (ville réduite) : rien n’est détruit, mais on ne peut plus en bâtir de nouveaux.</div>`;
    if (cur != null) {
      h += '<div class="slot-box">';
      const s = sl[cur];
      if (!s) {
        const opts = C.order.filter(k => !sl.some(x => x[0] === k)).map(k => [k, this.slotCheck(gn, ns, k)]).filter(([, c]) => !c.hide);
        h += sl.length >= sn ? `<div class="warnline">Plus d’emplacement libre : agrandissez la ville ou démolissez un bâtiment.</div>`
          : `<div class="small muted">Emplacement libre : choisissez une chaîne de bâtiments (trois niveaux au plus).</div>`;
        if (sl.length < sn) h += `<div class="slot-opts">${opts.map(([k, c]) => this.slotBtn(gn, ns, k, { ...c, lvl: c.lvl || 1 }, qFull,
          `${this.slotName(gn, k, 1)}${C.chains[k].levels.length > 1 ? ` — ${C.chains[k].name.toLowerCase()}` : ''}`)).join('')}</div>`;
      } else {
        const [k, lvl] = s, ch = C.chains[k], chk = this.slotCheck(gn, ns, k);
        h += `<div><b>${esc(this.slotName(gn, k, lvl || 1))}</b> <span class="muted small">${ch.levels.length > 1 ? `${esc(ch.name)}, ${lvl ? `niveau ${lvl} sur ${ch.levels.length}` : 'en chantier'}` : lvl ? 'construit' : 'en chantier'}</span></div>`;
        h += lvl ? `<div class="small">${esc(this.slotFx(gn, ch.levels[lvl - 1]))}.</div>` : `<div class="small muted">Premier niveau en chantier.</div>`;
        if (chk.lvl) h += `<div class="slot-opts">${this.slotBtn(gn, ns, k, chk, qFull, `Améliorer : ${this.slotName(gn, k, chk.lvl)}`)}</div>`;
        else if (chk.why && lvl) h += `<div class="muted small" style="margin-top:4px">${esc(chk.why)}.</div>`;
        h += `<div class="btns"><button class="btn danger" data-act="slot-demolish" data-v="${k}" ${ns.sg ? 'disabled' : ''}>${lvl ? 'Démolir' : 'Abandonner le chantier'}</button></div>`;
      }
      h += '</div>';
    }
    // politique de la ville
    const [pk, prev, w] = ns.pol || ['equilibre', 'equilibre', 1];
    const P = C.policies[pk];
    h += `<div class="section-t">Politique de la ville</div><div class="seg wrap">${C.policy_order.map(k => `<button class="${k === pk ? 'on' : ''}" data-act="policy" data-v="${k}" title="${esc(C.policies[k].pro + (C.policies[k].con ? ' ; ' + C.policies[k].con : ''))}">${esc(C.policies[k].label)}</button>`).join('')}</div>`;
    h += `<div class="tac-desc" style="margin-top:4px">${esc(P.pro)}${P.con ? `. En contrepartie : ${esc(P.con)}` : ''}.</div>`;
    if (w < 1) h += `<div class="muted small">Transition depuis « ${esc(C.policies[prev].label)} » : ${Math.round(w * 100)} %, en place ${toursTxt(ns.pol[3])}</div><div class="bar"><i style="width:${Math.round(w * 100)}%"></i></div>`;
    const plural = { village: 'tous mes villages', fort: 'toutes mes places fortes', ville: 'toutes mes villes' }[gn.type];
    if (plural) h += `<div style="margin-top:4px"><button class="linkish small" data-act="policy-all" data-v="${pk}">Appliquer « ${esc(P.label)} » à ${plural}</button></div>`;
    if (ns.tm) h += `<div class="muted small" style="margin-top:6px">Effets en cours : ${ns.tm.map(esc).join(' ; ')}.</div>`;
    return h;
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
    if (a.st === 'idle') state = a.sk === 'embuscade' ? (a.h ? 'En embuscade, invisible' : 'En embuscade, mais repérée') : a.hold && a.n != null ? `Halte devant ${nodeName(a.n)}` : a.rg && a.n != null ? `Complète ses rangs à ${nodeName(a.n)}` : a.qr && a.n != null ? `En quartiers à ${nodeName(a.n)}` : a.n != null ? `Au repos à ${nodeName(a.n)}` : 'Au repos en rase campagne';
    else if (a.st === 'move') state = a.boat ? `${a.emb ? 'Embarque sur les gabares' : 'En gabare'}${way && way.water ? ` (${way.sea ? 'cabotage' : way.way})` : ''}${lastNode() ? ' vers ' + lastNode() : ''}` : `En marche ${lastNode() ? 'vers ' + lastNode() : 'à travers champs'}`;
    else if (a.st === 'retreat') state = `En retraite ${lastNode() ? 'vers ' + lastNode() : ''}`;
    else if (a.st === 'battle') state = 'Engagée dans une bataille';
    else if (a.st === 'siege') {
      const ns = a.n != null ? st.nodes[a.n] : null;
      state = ns?.sg?.bl ? `Bloque ${nodeName(a.n)} (${Math.round(ns.sg.dmg * 100)} %)` : ns && ns.o === 'neutre' ? `Rallie ${nodeName(a.n)} (${Math.round((ns.sg?.dmg || 0) * 100)} %)` : `Assiège ${nodeName(a.n)} (brèche ${ns?.sg?.br ? toursTxt(ns.sg.br) : Math.round((ns?.sg?.dmg || 0) * 100) + ' %'})`;
    }
    const cell = Math.floor(a.y) * this.md.W + Math.floor(a.x);
    const terr = a.boat && a.n == null ? (way && way.sea ? 'Océan' : 'Fleuve') : this.md.terrain_names[this.map.terrain[cell]];
    let h = `<div class="p-head">${coat(f.color, a.o)}<div><div class="p-title">${esc(a.name)}</div><div class="p-sub">${f.name}, ${fmtMen(a.men)} hommes</div></div></div>
      <div class="p-state">${state}</div>${this.genHtml(a.gen)}`;
    if (a.fire) h += `<div class="warnline">Les gabares essuient le feu des canons ennemis sur la berge !</div>`;
    // terres fermées : délai de grâce pour en sortir, ou contournement
    if (a.cl) h += `<div class="warnline">Sur les terres ${esc(de(a.cl[0]))}, sans droit de passage : ${a.cl[1] > 0
      ? `${a.cl[1] <= 1 ? 'jusqu’à la fin du tour' : `encore ${a.cl[1]} tours`} pour en sortir (itinéraire de sortie tracé), sinon incident diplomatique.`
      : `délai de grâce écoulé, rester ici fâche ${esc(a.cl[0])} (incident, voire la guerre).`}</div>`;
    else if (a.dt && a.st === 'move') h += `<div class="muted small">Détour : l’itinéraire contourne les terres ${esc(de(a.dt.join(' et ')))} (sans droit de passage).</div>`;
    if (a.st === 'move' && a.path?.some(l => !l.r && st.cut?.some(c => c[0] === l.e))) h += `<div class="muted small">Route coupée par la crue : l’armée passe à gué ou fait un détour, environ un jour de plus.</div>`;
    if (own) {
      h += `<dl class="kv"><dt>Terrain</dt><dd>${terr}${a.h ? ', à couvert' : ''}</dd><dt>Ravitaillement</dt><dd>${Math.round(a.sup * 100)} %</dd>
        ${a.dp ? `<dt></dt><dd class="muted small">Ravitaillée par le magasin de ${esc(a.dp)}</dd>` : ''}
        ${a.mp != null && st.tour?.march ? `<dt>Mouvement</dt><dd title="Ce qui reste de marche à cette armée pour ce tour : elle avance tout de suite, sous vos yeux. Une route plus longue est reprise au tour suivant."><span class="bar mp-bar"><i style="width:${Math.round(Math.min(1, a.mp / st.tour.march) * 100)}%"></i></span>${a.mp <= 0.05 ? ' <span class="muted">(a joué)</span>' : ''}</dd>` : ''}
        ${a.eta ? `<dt>Arrivée</dt><dd>${toursTxt(a.eta)} <span class="muted">(estimation)</span></dd>` : ''}</dl>`;
      const wn = a.wn || [];
      if (a.sup < 0.35 && !wn.includes('faim')) h += `<div class="warnline">Ravitaillement épuisé : l’armée s’use. Revenez en territoire ami.</div>`;
      if (wn.includes('solde')) h += `<div class="warnline">Solde impayée : le moral chute et les soldats désertent.</div>`;
      if (wn.includes('faim')) h += `<div class="warnline">Vivres épuisés : le moral chute et les soldats désertent.</div>`;
      if (a.des > 0) h += `<div class="warnline">Déserteurs ce mois-ci : ${fmt(a.des)}</div>`;
      h += this.cardsHtml(a.regs, me, true) + `<div class="reg-list">${a.regs.map(r => this.regRow(r, me, true)).join('')}</div>`;
      h += this.valeursDetails(this.valeursRegs(a.regs), 'Valeurs des régiments (en bataille)');
      const canAct = a.st !== 'battle';
      if (!canAct) this.fightMemo = { army: a.id, name: a.name, x: a.x, y: a.y, seq: this.events.length ? this.events[this.events.length - 1].seq : 0, mine: [] };
      else if (this.fightMemo?.army === a.id) { this.toastBattleEnd(this.fightMemo); this.fightMemo = null; }   // sortie de bataille : son issue
      h += `<div class="section-t">Ordres</div>`;
      if (canAct) {
        h += `<div class="row"><span class="lab">Itinéraire</span><span class="seg">
          <button data-act="mode" data-v="route" class="${a.md !== 'champs' ? 'on' : ''}">Routes et fleuves</button>
          <button data-act="mode" data-v="champs" class="${a.md === 'champs' ? 'on' : ''}">À travers champs</button></span></div>
          <div class="row"><span class="lab">Conduite</span>${this.trSeg(!!a.tr, 'conduct', a.id)}</div>
          <div class="row"><span class="lab">Posture</span><span class="seg">
          ${[['normal', 'Normale'], ['embuscade', 'Embuscade'], ['retranche', 'Retranchée']].map(([k, l]) => `<button data-act="stance" data-v="${k}" class="${a.sk === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
          <div class="btns"><button class="btn primary" data-act="march">${ICON.target.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Marcher</button>`;
        if (a.regs.length > 1) h += `<button class="btn" data-act="split">Scinder la sélection</button>`;
        const near = st.armies.filter(b => b.o === me && b.id !== a.id && Math.hypot(b.x - a.x, b.y - a.y) < 3 && b.st !== 'battle');
        for (const b of near) h += `<button class="btn" data-act="merge" data-other="${b.id}">Réunir ${esc(b.name)}</button>`;
        if (a.n != null && st.nodes[a.n].o === me && a.st === 'idle') h += `<button class="btn" data-act="garrison" data-node="${a.n}">Mettre en garnison</button>`;
        if (a.n != null && st.nodes[a.n].o === me && a.st === 'idle' && !st.nodes[a.n].sg) h += this.modernBtn(a.mz);
        if (a.st === 'siege') h += `<button class="btn danger" data-act="assault">Donner l’assaut</button>`;
        if (a.st === 'siege' || a.st === 'move') h += `<button class="btn" data-act="retreat">Se replier</button>`;
        h += `</div>` + this.placeActsHtml(a);
        const mx = a.regs.reduce((s, r) => s + r[3], 0);
        if (!a.ax?.own && mx && a.regs.reduce((s, r) => s + r[3] - r[2], 0) / mx >= 0.1) h += `<div class="muted small">Pour compléter ses rangs (1 à 3 tours), ramenez-la dans une de vos villes.</div>`;
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
        ${this.cardsHtml(a.regs, a.o, false)}<div class="reg-list">${a.regs.map(r => this.regRow(r, a.o, false)).join('')}</div>`;
    }
    h += `<div class="btns"><button class="btn" data-act="center">Centrer la carte</button></div>`;
    const sig = JSON.stringify([id, a.st, a.sk, a.md, a.h, a.n, Math.round(a.sup * 20), a.regs.map(r => [r[0], r[2], Math.round(r[5] / 5), r[6]]), st.me.arm, a.mz, Object.entries(a.mz?.c || {}).map(([k, v]) => st.me.res[k] >= v),
      lastNode(), st.armies.filter(b => b.o === me && Math.hypot(b.x - a.x, b.y - a.y) < 3).length, a.n != null ? st.nodes[a.n].sg : null,
      a.fm, a.pl, a.auto, a.gen, a.boat, !!a.emb, a.fire, a.e && a.e[0], a.dp, a.wn, a.des, a.rx, a.tr, a.hold, a.qr, a.ax, a.rg,
      a.cl && [a.cl[0], Math.ceil(a.cl[1])], a.dt,
      a.n != null ? [st.nodes[a.n].o, st.nodes[a.n].bar] : null]);
    return [h, sig];
  }

  // ouvrages provisoires, travaux et bourgeois en armes d'une place
  worksHtml(ns) {
    let h = '';
    if (ns.bar != null) h += `<div class="muted small" style="margin:2px 0 6px">${ns.f > 0 ? 'Redoutes et ouvrages de campagne : un peu plus de défense' : 'Barricades et palissades : la place soutiendra un siège'}, solidité ${Math.round(ns.bar * 100)} % (s’use avec le temps, la pluie et le canon).</div>`;
    if (ns.bw) h += `<div class="queue-item"><span>${ns.bw[2] === 'bar' ? 'Barricades et palissades' : 'Redoutes'} en chantier</span><span class="muted">${partTour(ns.bw[1])}</span><div class="bar"><i style="width:${Math.round(ns.bw[0] * 20) * 5}%"></i></div></div>`;
    if (ns.gd) h += `<div class="muted small" style="margin:2px 0 6px">Habitants en armes : +${fmt(ns.gd[1])} miliciens jusqu’au ${esc(ns.gd[0])} (production réduite).</div>`;
    return h;
  }

  // actions de l'armée là où elle se tient : dans une de nos places, ou devant une place étrangère
  placeActsHtml(a) {
    const x = a.ax;
    if (!x || a.n == null) return '';
    const nm = esc(this.md.nodes[a.n]?.name || '');
    const btn = (v, label, sub, why, title, extra = '') => `<button class="btn" data-act="army-act" data-v="${v}" ${why ? 'disabled' : ''} title="${esc(title)}"${extra}>${label}<small>${esc(why || sub)}</small></button>`;
    if (x.own) {
      const F = x.fort, Q = x.qrt, G = x.garde, Rq = x.req;
      let h = `<div class="section-t">Dans la place</div><div class="btns">`;
      if (F.w) h += `<div class="queue-item" style="flex:1 1 100%"><span>${F.k === 'bar' ? 'Barricades et palissades' : 'Redoutes'} en chantier</span><span class="muted">${partTour(F.w[0])}</span><div class="bar"><i style="width:${Math.round((1 - F.w[0] / F.w[1]) * 20) * 5}%"></i></div></div>`;
      else h += btn('fortify', F.k === 'bar' ? 'Barricades et palissades' : 'Redoutes de campagne', `${F.b} bois, ${partTour(F.d)}`, F.why,
        F.k === 'bar' ? 'Fortification de fortune : presque un mur d’enceinte pour une place sans remparts, le temps qu’elle dure (environ trois tours, moins sous la pluie, en hiver ou sous le canon). Les sapeurs vont plus vite.'
          : 'Ouvrages de campagne devant les remparts : un petit bonus de défense, provisoire.');
      h += Q.on ? `<button class="btn primary" data-act="army-act" data-v="camp" title="Le cantonnement cesse aussi dès que l’armée se met en marche.">✓ En quartiers : lever le camp<small>+${fmt1(this.per(Q.food))} vivres ${this.perU}</small></button>`
        : btn('quarters', 'Prendre ses quartiers', `+${fmt1(this.per(Q.food))} vivres ${this.perU}`, Q.why, 'Renforts et moral plus rapides, ordre public en hausse ; l’armée mange davantage. Cesse dès qu’elle bouge.');
      const Rg = x.rg;
      h += Rg.w != null ? `<div class="queue-item" style="flex:1 1 100%"><span>Renforts en route</span><span class="muted">au complet ${toursTxt(Rg.w)}</span></div><button class="btn" data-act="army-act" data-v="rangs_stop">Arrêter les renforts</button>`
        : btn('rangs', 'Compléter les rangs', `${fmt(Rg.men)} recrues, ${fmt(Rg.armes)} armes, ${Rg.t > 1 ? Rg.t + ' tours' : '1 tour'}${Rg.rm ? ' (remontes)' : ''}`, Rg.why,
          'Les conscrits du dépôt rejoignent les régiments : 1 tour, 2 si les pertes passent 30 %. Remontes : la cavalerie et l’artillerie qui ont perdu plus de 10 % de leurs chevaux attendent un tour de plus (l’infanterie arrive à l’heure), et se refont deux fois moins vite au repos. L’armée doit rester dans la place ; les recrues diluent l’expérience des vétérans.')
          .replace('class="btn"', !Rg.why && Rg.men > 0.1 * a.regs.reduce((s, r) => s + r[3], 0) ? 'class="btn primary"' : 'class="btn"');
      const Rv = x.rv;   // régiments anéantis depuis peu : on les relève sous leur numéro
      if (Rv && Rg.w == null) h += btn('relever', `Relever ${Rv.regs.length > 1 ? Rv.regs.length + ' régiments anéantis' : 'le régiment anéanti'}`,
        Rv.regs.map(r => this.rules.units[r[1]]?.short || r[1]).join(', ') + ' — ' + Object.entries(Rv.cost).map(([k, v]) => `${fmt(v)} ${k}`).join(', ') + ', puis les recrues',
        Rv.why, 'Le dépôt envoie un cadre d’officiers et de sous-officiers ; le régiment reprend son nom et son numéro, avec des conscrits sans expérience. Se paie comme une levée ; les recrues arrivent ensuite comme pour « Compléter les rangs ». Possible pendant un mois environ après sa perte.');
      h += btn('garde', 'Armer les habitants', `+${fmt(G.add)} miliciens, ${G.armes} armes, ${G.t} tours`, G.why,
        `${this.rules.units.garde.name} : la milice de la place se renforce fortement pendant ${G.t} tours ; un peu moins de production.`);
      const gain = [`${fmt(Rq.g.vivres)} vivres`, `${fmt(Rq.g.recrues)} recrues`].concat(Rq.g.livres ? [`${fmt(Rq.g.livres)} livres`] : []).join(', ');
      h += btn('req', 'Réquisitionner', `${gain} ; ordre public −${Rq.stab} %`, Rq.why, 'Prend tout de suite vivres, recrues et livres aux habitants ; l’ordre public baisse nettement.',
        ` data-confirm="${esc(`Réquisitionner ${this.md.nodes[a.n]?.name} (${gain}) ? L’ordre public baissera de ${Rq.stab} %.`)}"`);
      return h + `</div>`;
    }
    let h = `<div class="section-t">Devant ${nm}</div>`;
    if (x.o !== 'neutre' && !x.neg && !x.ctb && !x.blq && !x.bl && !x.busy) {
      return h + `<div class="muted small">Terres d’un voisin en paix : avec son droit de passage, l’armée passe ou s’y tient sans l’attaquer ; sans lui, elle doit en sortir.</div>`;
    }
    if (x.busy) return h + `<div class="muted small">La place est déjà investie par un autre camp.</div>`;
    h += `<div class="btns">`;
    if (x.neg) {
      const N = x.neg;
      if (N.w != null) h += `<div class="queue-item" style="flex:1 1 100%"><span>Pourparlers avec les notables</span><span class="muted">réponse ${toursTxt(N.w)}</span></div>`;
      else h += btn('neg', 'Négocier le ralliement', `${fmt(N.p)} livres, réponse au prochain tour, refus ${Math.round(N.r * 100)} %`, N.why,
        'Les notables rallient la place sans combat contre une somme, moindre si votre armée est imposante. Ils peuvent refuser (l’argent vous est alors rendu).');
    }
    if (x.ctb) {
      const C = x.ctb;
      const txt = `${fmt(C.g.livres)} livres, ${fmt(C.g.vivres)} vivres`;
      h += btn('ctb', 'Exiger une contribution', txt, C.why,
        C.all ? 'Rançonner la place puis la laisser : tous les départements s’en indignent.' : 'Rançonner la place puis la laisser : son maître s’en souviendra.',
        ` data-confirm="${esc(`Rançonner ${this.md.nodes[a.n]?.name} (${txt}) ? ${C.all ? 'Tous les départements s’en indigneront.' : 'Les relations en pâtiront.'}`)}"`);
    }
    if (x.blq) h += btn('blocus', 'Bloquer et affamer', `reddition ${toursTxt(x.blq.t)} environ${x.blq.dp ? ' (magasin aux vivres)' : ''}`, x.blq.why,
      'Investir la place sans bombardement ni assaut : remparts intacts, commerce et vivres coupés ; la faim et les désertions la poussent à se rendre.');
    if (x.bl) {
      h += `<span class="muted small" style="flex:1 1 100%">Blocus : ${x.bl.food ? `réserves pour ${x.bl.food > 1 ? x.bl.food + ' tours' : 'ce tour'} encore` : 'la famine sévit'}.</span>`;
      if (x.bl.walled) h += `<button class="btn" data-act="army-act" data-v="bombard" title="Ouvrir le feu : le blocus devient un siège qui bat les remparts.">Bombarder la place</button>`;
    }
    if (x.conq) h += `<button class="btn danger" data-act="army-act" data-v="conquer" title="Comme en marche de conquête : ralliement, siège ou assaut.">${x.o === 'neutre' ? 'Rallier ou attaquer' : 'Assiéger ou attaquer'}</button>`;
    return h + `</div>`;
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
    if (b.mode === 'ordres') h += `<div class="btns"><button class="btn primary" data-act="tactic" data-id="${b.id}">Voir la bataille</button></div>`;
    else if (mineIn.length) h += `<p class="muted small">Touchez une de vos armées pour changer sa formation ou son plan pendant le combat.</p>`;
    return [h, JSON.stringify([b.phase, b.sides.map(s => [s.men, s.lost, s.mor, (s.tac || []).map(t => [t.fm, t.pl, t.reorg])])])];
  }

  // ------------------------------------------------------------------ décisions (événements)
  eventModal() {
    const all = this.st.pending || [];
    const p = all[0];
    if (!p) return ['<p class="muted">Aucune décision en attente.</p>', 'none'];
    const html = `<h2 class="m-title" id="m-title">${esc(p.title)}</h2>
      <p class="m-sub">${esc(p.date)}${all.length > 1 ? ` — décision 1 sur ${all.length}` : ''}</p>
      <p style="font-size:16px;line-height:1.5">${esc(p.text)}</p>
      ${p.base ? `<p class="small" style="color:#ffcf85">Déjà : ${esc(p.base)}.</p>` : ''}
      ${p.town != null && this.md.nodes[p.town] ? `<div class="btns" style="margin-top:0"><button class="btn" data-act="selnode-modal" data-node="${p.town}">Voir ${esc(this.md.nodes[p.town].name)} sur la carte</button></div>` : ''}
      <div class="ev-choices">${p.choices.map((c, i) => `<button class="btn ${i === 0 ? 'primary' : ''} ev-choice" data-act="evchoice" data-id="${p.id}" data-v="${i}" ${c.ok ? '' : 'disabled title="Vous n’en avez pas les moyens"'}>
        <b>${esc(c.label)}</b><small>${c.desc.map(esc).join(' · ')}</small></button>`).join('')}</div>
      <p class="muted small">Sans réponse ${p.tn <= 1 ? 'avant la fin du tour' : `d’ici ${p.tn} tours`}, la dernière option s’appliquera.</p>`;
    return [html, JSON.stringify([p.id, all.length, p.tn, p.choices.map(c => c.ok)])];
  }

  // ------------------------------------------------------------------ fenêtres
  openModal(kind) {
    this.modal = kind;
    this.modalSig = '';
    this.$('modal').hidden = false;
    document.body.classList.add('modal-open');
    document.body.classList.toggle('modal-event', kind === 'event');   // une décision : rien ne doit masquer ses choix
    this.renderModal(true);
    if (kind === 'menu') this.refreshSaves();
    this.tuto.check();
  }
  // fermée à la main, la fenêtre d'arrivée vaut « Attendre » : sinon le choix toujours posé la rouvrirait aussitôt
  dismissModal() {
    const a = this.modal === 'arrivee' && (this.st.armies || []).find(x => x.ask);
    this.closeModal();
    if (a) this.cmd({ cmd: 'arrive', army: a.id, value: 'attendre' });
  }
  closeModal() {
    this.modal = null;
    this.$('modal').hidden = true;
    document.body.classList.remove('modal-open', 'modal-event');
    for (const b of this.$('rail').children) b.classList.remove('on');
    this.tuto.check();
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
                 journal: this.journalModal, menu: this.menuModal, fin: this.endModal, event: this.eventModal,
                 bataille: this.battleModal, arrivee: this.arriveeModal, decouverte: () => this.decouv.html() }[k];
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
    if (k === 'decouverte') this.decouv.anime();
    const pl = k === 'bataille' && card.querySelector('.bt-plan canvas'), b = (this.st.battles || []).find(x => x.mode === 'attente');
    if (pl && b && this.plans?.[b.id]?.t) drawPlan(pl, this.plans[b.id]);
  }

  techModal() {
    const me = this.st.me, brs = this.rules.branches;
    const br = brs.includes(this.techTab) ? this.techTab : brs[0];
    const tabs = brs.map(b => `<button class="btn ${b === br ? 'primary' : ''}" role="tab" aria-selected="${b === br}" data-act="techtab" data-v="${b}"
      ${me.research[b] ? '' : 'title="Aucune recherche en cours"'}>${BRANCH_LABEL[b]}${me.research[b] ? '' : ' <span class="idle" aria-label="(libre)">•</span>'}</button>`).join('');
    const html = `<h2 class="m-title" id="m-title">Technologies</h2><p class="m-sub">Une recherche à la fois par branche, sans attendre la date : seuls les prérequis comptent, et plus une technologie est loin dans l’arbre, plus elle est longue à trouver. Une arme ou une manœuvre nouvelle ne sert qu’aux régiments modernisés.</p>${this.decouv.frise()}
      <div class="tabs" role="tablist">${tabs}</div>${arbreHtml({ techs: this.rules.techs, branch: br, labels: BRANCH_LABEL, me, year: this.st.year || 0, sel: this.techSel, toursTxt })}`;
    return [html, JSON.stringify([me.techs, Object.values(me.research).map(r => r && Math.ceil(r.left)), Math.floor(me.res.livres / 25), br, this.techSel])];
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
        if (f.st === 'paix' && !f.ps) acts += `<div class="row"><input class="amount" type="number" min="0" step="50" value="0" id="amt-passage-${f.code}" aria-label="Livres offertes pour le passage"><span class="muted small">livres</span>${btn('passage', 'Demander le droit de passage')}</div>`;
        if (f.pg) acts += `<div class="btns">${btn('fin_passage', 'Retirer le droit de passage')}</div>`;
      }
      acts += `<div class="row"><input class="amount" type="number" min="0" step="50" value="100" id="amt-cadeau-${f.code}" aria-label="Montant du présent"><span class="muted small">livres</span>${btn('cadeau', 'Offrir un présent')}</div>`;
      const theirs = f.pr || 0;
      acts += `<div class="small">Prisonniers : vous tenez ${fmt(held)} de ses soldats, il tient ${fmt(theirs)} des vôtres.</div>
        <div class="btns"><button class="btn" data-act="diplo" data-to="${f.code}" data-v="prisonniers" ${held || theirs ? '' : 'disabled'} title="Chacun rend les prisonniers de l’autre ; le surplus se rachète 2 livres par homme.">Échanger les prisonniers</button>${enrollBtn(f.code, held, 'Enrôler ses prisonniers')}</div>`;
      return `<div class="dcard">${coat(R.color, f.code)}<div>
          <div class="dn">${R.name}</div><div class="dt">${R.title}, chef-lieu ${R.capital}</div>
          <div class="row">${statusChip}${f.trade ? '<span class="chip ally">Accord commercial</span>' : ''}${f.truce ? `<span class="chip">Trêve jusqu’au ${f.truce}</span>` : ''}${f.ps ? `<span class="chip ally" title="Vos armées peuvent traverser ses terres">Passage chez lui jusqu’au ${f.ps}</span>` : ''}${f.pg ? `<span class="chip" title="Ses armées peuvent traverser vos terres">Vous lui accordez le passage jusqu’au ${f.pg}</span>` : ''}${f.cl ? '<span class="chip" title="Sans droit de passage, vos armées ne traversent ni ses places ni ses campagnes : elles contournent, ou passent en force (déclaration de guerre)">Terres fermées</span>' : ''}</div>
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
    const neuLine = neu ? `<div class="row" style="margin-bottom:8px"><span class="small">Vous détenez ${fmt(neu)} miliciens insurgés prisonniers${st.me.prisoner_upkeep ? `, nourris ${fmt1(this.per(st.me.prisoner_upkeep))} vivres ${this.perU} pour tous vos prisonniers` : ''}.</span>${enrollBtn('neutre', neu, 'Enrôler')}</div>` : '';
    // droits de passage : qui nous laisse passer, à qui nous laissons passer (sinon, terres fermées)
    const others = st.factions.filter(f => f.code !== me && f.alive);
    const nm = f => esc(this.rules.factions[f.code].name);
    const why = (f, until) => until ? `${nm(f)} (droit jusqu’au ${until})` : `${nm(f)} (${f.st === 'guerre' ? 'en guerre' : f.st === 'alliance' ? 'allié' : 'vassalité'})`;
    const list = l => l.join(', ') || 'personne';
    const passLine = `<div class="small" style="margin:0 0 8px"><b>Droits de passage</b> · Vous laissent passer : ${list(others.filter(f => !f.cl).map(f => why(f, f.ps)))} ; terres fermées à vos armées : ${list(others.filter(f => f.cl).map(nm))}.<br>
      Vous laissez passer : ${list(others.filter(f => !f.cg).map(f => why(f, f.pg)))} ; vos terres sont fermées à : ${list(others.filter(f => f.cg).map(nm))}.
      <span class="muted">Sans droit de passage (ni alliance, ni guerre), on contourne ses terres, ou l’on passe en force : c’est la guerre.</span></div>`;
    const html = `<h2 class="m-title" id="m-title">Diplomatie</h2><p class="m-sub">La relation indique ce que chaque ${this.st.word || 'département'} pense de vous. Les présents, le commerce et les ennemis communs la font monter ; vos conquêtes près de leurs frontières la font baisser.</p>${hegLine}${neuLine}${passLine}<div class="diplo-list">${cards}</div>`;
    return [html, JSON.stringify([st.factions.map(f => [f.code, f.st, f.rel, f.trade, f.alive, f.over, f.truce, Math.round(f.power / 500), f.wars, f.pr || 0, f.nodes, f.techs, f.cap_owner, f.ps, f.pg, f.cl, f.cg]),
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
          `<p class="small">Gains ${this.st.tour?.on ? 'par tour' : 'par jour'} : ${Object.entries(me.trade).filter(([, v]) => v > 0.01).map(([k, v]) => `+${fmt1(this.per(v))} ${this.rules.res_label[k].toLowerCase()}`).join(', ') || 'aucun'}</p>`
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
      // chantiers : régiments, aménagements et bâtiments d'emplacement (marché, moulins…)
      const q = (ns.q || []).map(q => q.kind === 'unit' ? this.rules.units[q.what]?.short || q.what
        : q.kind === 'slot' && this.rules.cities?.chains[q.what] ? this.slotName(n, q.what, q.lvl || 1) : this.rules.build[q.what]?.name || q.what).join(', ');
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
          <dt>Capacité industrielle</dt><dd>${fmt1(this.per(me.cap))} ${this.perU}</dd>
          <dt>Armes fabriquées</dt><dd>+${fmt1(this.per(me.income.armes))} ${this.perU}</dd>
          <dt>Outils fabriqués</dt><dd>+${fmt1(this.per(me.income.outils))} ${this.perU}</dd>
          <dt>Couverture en outils</dt><dd>${Math.round(me.cov * 100)} %</dd>
          <dt>Bonus de production</dt><dd>+${Math.round((me.tools_bonus - 1) * 100)} %</dd>
          ${me.pop ? `<dt>Population de vos terres</dt><dd>${fmt(me.pop)} habitants</dd>${this.popYear(me.popy)}` : ''}
          <dt>Lassitude de la guerre</dt><dd style="${(me.weary || 0) >= 50 ? 'color:#ff9a85' : ''}">${me.weary || 0} %</dd>
          <dt>Solde des troupes</dt><dd>${fmt1(this.per(me.upkeep.livres || 0))} livres ${this.perU}</dd>
          <dt>Entretien des remparts</dt><dd>${fmt1(this.per(me.upkeep.forts || 0))} livres ${this.perU}</dd>
          <dt>Rations des troupes</dt><dd>${fmt1(this.per(me.upkeep.vivres || 0))} vivres ${this.perU}</dd>
          ${nPr ? `<dt>Prisonniers détenus</dt><dd>${fmt(nPr)} (${fmt1(this.per(me.prisoner_upkeep || 0))} vivres ${this.perU})</dd>` : ''}
        </dl>
        ${(me.effects || []).length ? `<div class="muted small" style="margin-top:6px"><b>Effets des événements :</b> ${me.effects.map(esc).join(' · ')}</div>` : ''}
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
    const groups = { all: null, battle: ['battle', 'battle_end', 'siege', 'capture', 'capitulation', 'revolte', 'espion'], diplo: ['diplo', 'espion'], eco: ['eco', 'tech', 'tech_ia', 'meteo', 'armee', 'rail'], hist: ['evenement', 'epoque', 'info'] };
    const evs = this.events.filter(e => !groups[f] || groups[f].includes(e.kind)).slice(-250).reverse();
    const tabs = [['all', 'Tout'], ['battle', 'Guerre'], ['diplo', 'Diplomatie'], ['eco', 'Économie'], ['hist', 'Histoire']].map(([k, l]) =>
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
        ${this.turnSettings()}
        <h3 class="section-t">Affichage</h3><div class="btns"><button class="btn" data-act="anim">${this.map.ambient.on ? 'Couper les animations de la carte' : 'Animer la carte'}</button></div>
        <p class="muted small" style="margin:4px 0 0">Moulins, fumées, oiseaux, bateaux, charrettes et troupeaux.</p>
        <p class="small" style="margin:10px 0 4px">Style de la carte :</p><div class="seg wrap" role="group" aria-label="Style de la carte">${[['ugar', 'Ultimate General'], ['epoque', 'Carte d’époque']].map(([k, l]) =>
          `<button class="${k === this.map.style ? 'on' : ''}" data-act="map-style" data-v="${k}" aria-pressed="${k === this.map.style}">${l}</button>`).join('')}</div>
        <p class="muted small" style="margin:4px 0 0">${this.map.style === 'epoque' ? 'Papier, hachures et encre : la carte de Cassini, puis celle de l’état-major à partir de 1818.' : 'Couleurs, reliefs ombrés et plaques d’ardoise, à la manière d’Ultimate General.'}</p>
        <p class="small" style="margin:10px 0 4px">Qualité graphique des batailles :</p><div class="seg wrap" role="group" aria-label="Qualité graphique des batailles">${QUALITES.map(k =>
          `<button class="${k === qualite().q ? 'on' : ''}" data-act="bt-qualite" data-v="${k}" aria-pressed="${k === qualite().q}" title="${QUALITE_AIDE[k]}">${QUALITE_LABEL[k]}</button>`).join('')}</div>
        <p class="muted small" style="margin:4px 0 0">${qualite().auto ? 'Choisie d’après cet appareil ; elle baisse d’elle-même si la bataille saccade.' : QUALITE_AIDE[qualite().q]}</p>
        <h3 class="section-t">Batailles</h3><div class="seg wrap">${[['demander', 'Toujours demander'], ['auto_petites', 'Escarmouches automatiques'], ['auto', 'Toujours automatiques']].map(([k, l]) =>
          `<button class="${(this.st.settings || {}).battles === k ? 'on' : ''}" data-act="tac-set" data-v="${k}">${l}</button>`).join('')}</div>
        <p class="muted small" style="margin:4px 0 0">Donner ses ordres et regarder ses officiers livrer la bataille, ou laisser le général la résoudre.</p>
        <h3 class="section-t">Jouer depuis un autre appareil</h3>${this.netHtml(this.net)}
      </div><div>
        <h3 class="section-t" style="border:0;padding:0">Comment jouer</h3>
        <div class="btns" style="margin:4px 0 8px"><button class="btn" data-act="tuto-start">Revoir le tutoriel</button></div>
        <ul class="small" style="padding-left:18px;margin:0">
          <li>Carte : glissez pour la déplacer (elle garde son élan), pincez ou utilisez les boutons + et − pour zoomer. Double appui : zoom avant ; appui à deux doigts : zoom arrière.</li>
          <li>Touchez une armée pour la sélectionner, puis touchez une destination : choisissez la route ou la marche à travers champs.</li>
          <li>Glissez une de vos armées du doigt ou du stylet pour <b>dessiner son itinéraire</b>, par exemple à travers un bois pour préparer une embuscade, puis choisissez « Suivre mon tracé ».</li>
          <li>Appui long sur la carte (ou clic droit) avec une armée sélectionnée : elle part aussitôt. Appui long sur une ville ou une armée : sélection et centrage.</li>
          <li>Au stylet ou à la souris, survolez une ville ou une armée pour voir ses forces. La paume posée sur l’écran est ignorée pendant l’usage du stylet.</li>
          <li>Les routes sont rapides. À travers champs, l’armée peut se cacher dans les bois, landes, marais ou montagnes et tendre une embuscade (posture « Embuscade »), mais avance plus lentement, s’use et perd son ravitaillement.</li>
          <li>Ralliez les villages indépendants avec une armée bien plus forte que leur milice. Les places fortifiées se prennent par siège : l’artillerie ouvre la brèche plus vite. Les remparts ont quatre niveaux (le quatrième, les bastions à la Vauban, après la technologie du même nom, dans le chef-lieu et les places fortes) ; ils coûtent un entretien et perdent un niveau quand la place est prise de force.</li>
          <li><b>Deux siècles</b> : la grande campagne part de 1700 (ou de 1790, 1813, 1870) et s’achève fin 1899 ; le plus prestigieux l’emporte. Les provinces deviennent départements en 1790 ; technologies et unités n’apparaissent qu’à leur époque. ${this.st.tour && this.st.tour.on ? '' : 'Vitesses ×10 et ×30 (touches 5 et 6) pour les années de paix : guerres, batailles et grandes propositions remettent en pause.'}</li>
          <li><b>Tour par tour</b> : chaque tour est un mois. Pendant votre tour, vos ordres s’exécutent tout de suite : vos armées marchent sous vos yeux (dans la limite de leur marche du tour, ou jusqu’au contact de l’ennemi), les batailles et les assauts se livrent aussitôt, les achats sont payés. Touchez « Tour suivant » : les IA jouent leur tour d’un coup (une ou deux secondes), puis c’est de nouveau à vous, au 1er du mois suivant, avec le bilan du mois écoulé. Le tour des IA ne s’arrête que si vous devez choisir : une IA vous attaque (livrer la bataille ou la laisser au général), ou une décision vous attend ; votre choix fait, il reprend tout seul. Le reste (armées ennemies sur vos terres, sièges, guerres, propositions) est dans le bilan du mois.</li>
          <li><b>Tactique</b> : chaque armée a un général (trait et grade) et suit une formation et un plan de bataille. Une bataille passe par la canonnade, la fusillade puis la charge. Le carré brise la cavalerie mais souffre du canon ; la ligne fusille mais craint les charges ; la colonne charge fort ; les tirailleurs esquivent les boulets. Laissez le général décider, ou commandez vous-même.</li>
          <li><b>Événements</b> : aux grandes dates (Grand Hiver, Révolution, Blocus continental, phylloxéra…) et au gré des imprévus, une fenêtre vous demande un choix ; chaque option affiche ses effets. Vos choix nourrissent l’« histoire » de votre prestige. Sans réponse avant la fin du tour suivant, l’option la plus prudente s’applique.</li>
          <li><b>Armement par époque</b> : des piquiers et mousquets de 1700 au Chassepot et au Lebel, des canons de bronze au canon de 75. Chaque régiment garde les armes et les manœuvres (feu de rang, ordre mixte, cuirassiers…) reçues à sa levée, affichées à côté de son nom : après une découverte, modernisez les régiments en retard dans une de vos places (bouton « Moderniser » : armes, fer pour l’artillerie, et livres pour les manœuvres ; un tiers de tour d’exercice, que l’armée perd si elle part avant). Les noms des troupes changent avec l’époque : milice bourgeoise puis Garde nationale, miquelets puis chasseurs basques…</li>
          <li><b>Armée et intendance</b> : grenadiers (infanterie d’élite), chasseurs basques (montagnards, levés au Pays basque), sapeurs (sièges, rivières) et Garde nationale (milice levée partout, qui ne quitte pas sa ville). Un magasin aux vivres ravitaille les armées alentour ; sans solde ni vivres, le moral chute et les soldats désertent. Vos prisonniers s’échangent, se rachètent ou s’enrôlent (Diplomatie). Le carré réflexe forme d’office le carré face aux charges quand vous commandez vous-même.</li>
          <li><b>Fleuves</b> : par les routes, vos armées embarquent sur les gabares de la Garonne, de la Dordogne, du Lot, de l’Isle, de la Baïse, de la Midouze et de l’Adour, ou longent la côte (les tempêtes bloquent les navires). Les canons ennemis sur la berge tirent sur les gabares ; tenir une place en aval coupe le commerce de l’amont (blocus).</li>
          <li><b>Frontières</b> : les terres d’un ${this.st?.word || 'département'} en paix vous sont fermées, sauf droit de passage (fenêtre Diplomatie) ou alliance. Vos armées les contournent ; sans détour possible, vous pouvez passer en force, ce qui revient à lui déclarer la guerre. Les gabares passent devant ses quais sans y débarquer. Une armée surprise sur des terres fermées (droit retiré, paix signée…) a jusqu’à la fin du tour pour en sortir.</li>
          <li><b>Espions</b> : depuis une place étrangère, espionnez (vision et garnison pendant deux tours, rapport au tour suivant) ou sabotez ses remparts en temps de guerre. Le brouillard de guerre (bouton œil) montre ce que vous voyez réellement.</li>
          <li><b>Impôts</b> (fenêtre Production) : plus d’argent tout de suite, mais l’ordre public baisse ; une ville agitée sans garnison peut se révolter.</li>
          <li>La partie est sauvegardée automatiquement chaque mois ; elle reprend au redémarrage du serveur.</li>
          <li>La pluie mouille la poudre, la neige ferme les cols, l’hiver vide les greniers. Les récoltes arrivent en été et en automne.</li>
          <li>Prenez tous les chefs-lieux, ou obtenez la soumission des autres camps. Un camp dont le chef-lieu tombe signe un traité (places cédées, tribut, trêve de cinq ans) ; il n’est rayé de la carte que s’il est déjà écrasé, ou si le même vainqueur le fait plier deux fois en 25 ans. Vous aussi.</li>
          <li>Raccourcis : ${this.st.tour && this.st.tour.on ? 'espace pour le tour suivant (ou continuer le tour des IA)' : 'espace pour la pause, 1 à 6 pour la vitesse'}, Échap pour annuler.</li>
        </ul>
      </div></div>`;
    const tr = this.st.tour || {};
    return [html, JSON.stringify([(this.saves || []).map(s => s.name), me.stats, this.net, tr.on])];
  }

  // menu ☰ : le tour par tour, et en réglage avancé le temps réel d'origine
  turnSettings() {
    const tr = this.st.tour || {};
    return `<h3 class="section-t">Rythme du jeu</h3>${tr.on ? `
        <p class="muted small" style="margin:0 0 6px">Tour par tour : vos ordres s’exécutent tout de suite pendant votre tour, puis « Tour suivant » : les IA jouent leur tour d’un coup, jusqu’au 1er du mois suivant  ; il ne s’arrête que si une IA vous attaque ou si une décision vous attend.</p>` : `
        <p class="muted small" style="margin:0 0 6px">Temps réel avec pause : choisissez la vitesse en haut (espace pour la pause).</p>`}
        <p class="small" style="margin:10px 0 0"><b>Réglage avancé</b></p>
        <div class="btns" style="margin-top:4px"><button class="btn" data-act="turn-mode" data-v="${tr.on ? '0' : '1'}">${tr.on ? 'Jouer en temps réel (avec pause)' : 'Revenir au tour par tour'}</button></div>`;
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
  hideStart() { this.$('start').hidden = true; this.map.highlightDept = null; this.map.selection = null; }

  pickDept(code) {
    this.startDept = code;
    this.map.highlightDept = code;
    const cap = this.md.nodes.find(n => n.type === 'capitale' && n.dept === code);
    const side = window.innerWidth > 760 ? Math.min(470, window.innerWidth * 0.4) : 0;
    const z = Math.min(window.innerWidth - side, window.innerHeight) / 120;
    this.map.moveTo(cap.x - side / 2 / z, cap.y, z);
    this.renderStart();
  }

  // l'écran de départ est redessiné à chaque choix (un régiment de plus, une option…) : le panneau garde son défilement
  // au lieu de remonter en haut, tant qu'on reste dans le même onglet (Campagne ou Bataille)
  renderStart() {
    const root = this.$('start'), sel = '.start-side, .scroll', same = this.startDrawn === this.startMode;
    const keep = same ? [...root.querySelectorAll(sel)].map(e => e.scrollTop) : [];
    this.drawStart();
    this.startDrawn = this.startMode;
    root.querySelectorAll(sel).forEach((e, i) => { if (keep[i]) e.scrollTop = keep[i]; });
  }
  drawStart() {
    if (this.startMode === 'bataille' && this.skOpts) return this.renderSkirmish();
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
      ${this.modeTabs()}
      <div class="row"><span class="lab">Début</span><span class="seg">${scenBtns}</span></div>
      ${this.startEraHtml(sc)}
      ${info.running ? '<button class="btn primary" data-act="resume">Reprendre la partie en cours</button>' : ''}
      <div class="dept-list">${cards}</div>
      <div class="row"><span class="lab">Difficulté</span><span class="seg">${diffs}</span></div>
      <div class="start-actions">
        <button class="btn primary" data-act="start-game" ${this.startDept ? '' : 'disabled'}>${this.startDept ? `Commencer avec ${esc(sc.names[this.startDept] || this.rules.factions[this.startDept].name)} en ${sc.year}` : (sc.word === 'province' ? 'Choisissez une province' : 'Choisissez un département')}</button>
        ${saves ? `<div class="section-t">Parties sauvegardées${info.saves.length > 5 ? ` <span class="muted small">(${info.saves.length})</span>` : ''}</div><div class="saves scroll">${saves}</div>` : ''}
        ${info.net && info.net.lan && info.net.urls.length ? `<div class="section-t">Sur le réseau local</div>${this.netHtml(info.net)}` : ''}
        ${this.versionHtml(info.update)}
      </div></div>`;
    const det = this.$('start').querySelector('details.ver-line');
    if (det) det.addEventListener('toggle', () => { this.verOpen = det.open; });   // reste ouvert d'un rendu à l'autre
  }

  // ce que l'époque choisie donne au départ : techniques déjà connues (les plus récentes de celles qui se voient), voies
  // ferrées déjà ouvertes ; la carte derrière les montre déjà (map.showPreview)
  startEraHtml(sc) {
    const known = startTechs(this.rules, sc);
    if (!known.size) return '<p class="muted small start-era">Aucune technologie au départ : tout est à découvrir.</p>';
    const seen = new Set([...Object.values(this.rules.visuals || {}).map(v => v.tech), 'chemins_fer', 'rail_militaire']);
    const top = (this.rules.techs || []).filter(t => known.has(t.id) && seen.has(t.id)).sort((a, b) => b.year - a.year).slice(0, 4).map(t => t.name);
    const rails = startRails(this.map.m.rails, sc.year).length;
    return `<p class="muted small start-era">Déjà acquis : <b>${known.size} technologies</b>${top.length ? `, dont ${esc(top.join(', '))}` : ''}${rails ? ` ; <b>${rails} tronçons de voie ferrée</b> ouverts` : ''}. La carte les montre déjà.</p>`;
  }

  // ------------------------------------------------------------------ mode Bataille (écran de départ)
  modeTabs() {
    if (!this.skOpts) return '';
    return `<div class="seg mode-tabs" role="tablist">${[['campagne', 'Campagne'], ['bataille', 'Bataille']].map(([k, l]) =>
      `<button role="tab" aria-selected="${this.startMode === k}" class="${this.startMode === k ? 'on' : ''}" data-act="start-mode" data-v="${k}">${l}</button>`).join('')}</div>`;
  }
  skUnits() {
    const o = this.skOpts, sk = this.sk;
    const l = (o.units[sk.era] || o.units['1790'])[sk.kind === 'forteresse' && sk.role === 'def' ? 'garrison' : 'field'];
    return l.filter(t => !this.rules.units[t].where || this.rules.units[t].where.includes(sk.me));
  }
  skCount() { return Object.values(this.sk.units).reduce((a, k) => a + (k > 0 ? k : 0), 0); }
  // régiments devenus indisponibles (époque, camp, rôle) : retirés ; dix au plus
  skClamp() {
    const ok = new Set(this.skUnits());
    for (const t of Object.keys(this.sk.units)) if (!ok.has(t)) delete this.sk.units[t];
    let over = this.skCount() - this.skOpts.max;
    for (const t of Object.keys(this.sk.units).reverse()) { while (over > 0 && this.sk.units[t] > 0) { this.sk.units[t]--; over--; } }
  }
  skPlaceOk(id) {
    const n = this.md.nodes[id];
    return !!n && (this.sk.kind !== 'forteresse' || (this.skOpts.places.find(p => p.id === id)?.fort || 0) >= 1);
  }
  // le lieu choisi, marqué et montré sur la carte
  skMark() {
    const id = this.startMode === 'bataille' && this.sk.place !== '' ? +this.sk.place : null;
    this.map.selection = id != null ? { kind: 'node', id } : null;
    if (id != null) {
      const n = this.md.nodes[id], side = window.innerWidth > 760 ? Math.min(470, window.innerWidth * 0.4) : 0;
      const z = Math.min(window.innerWidth - side, window.innerHeight) / 90;
      this.map.moveTo(n.x - side / 2 / z, n.y, z);
    }
  }
  // touché sur la carte de l'écran de départ, en mode Bataille : le lieu de la bataille
  skPickNode(id) {
    if (!this.skPlaceOk(id)) { this.toast('Choisissez une place forte (ville fortifiée ou fort) pour un assaut.'); return; }
    this.sk.place = String(id);
    this.skMark();
    this.renderStart();
  }
  renderSkirmish() {
    const info = this.startInfo || { saves: [], running: false };
    const o = this.skOpts, sk = this.sk, R = this.rules, F = R.factions;
    if (sk.me && !F[sk.me]) sk.me = null;
    this.skClamp();
    const scs = R.scenarios || {}, sc = scs[sk.era] || scs['1790'];
    const fname = c => (sc && sc.names[c]) || F[c].name;
    const seg = (k, items, wrap) => `<span class="seg${wrap ? ' wrap' : ''}">${items.map(([v, l, t]) =>
      `<button class="${String(sk[k]) === String(v) ? 'on' : ''}" data-act="sk-set" data-k="${k}" data-v="${esc(v)}"${t ? ` title="${esc(t)}"` : ''}>${l}</button>`).join('')}</span>`;
    const dot = c => `<i class="sk-dot" style="background:${F[c].color}"></i>`;
    const eras = (R.scenario_order || []).map(k => [k, k, scs[k].campaign]);
    const camps = Object.keys(F).map(c => [c, dot(c) + esc(fname(c))]);
    const foes = [['', 'Au hasard']].concat(Object.keys(F).filter(c => c !== sk.me).map(c => [c, dot(c) + esc(fname(c))]));
    const fort = sk.kind === 'forteresse';
    const places = o.places.filter(p => !fort || p.fort >= 1);
    const cur = sk.place !== '' ? this.md.nodes[+sk.place] : null;
    const extra = cur && !places.some(p => p.id === cur.id) ? `<option value="${cur.id}" selected>${esc(cur.name)}</option>` : '';
    const placeSel = `<select class="sk-place" aria-label="Lieu de la bataille"><option value="">Au hasard</option>${extra}${places.map(p =>
      `<option value="${p.id}" ${String(p.id) === String(sk.place) ? 'selected' : ''}>${esc(p.name)}${fort ? ` (${'★'.repeat(Math.min(3, p.fort))})` : ''}</option>`).join('')}</select>`;
    const seasons = [['', 'Au hasard']].concat(o.seasons.map(k => [k, R.seasons[k]]));
    const wk = sk.season ? Object.keys(o.weather_w[sk.season]) : Object.keys(R.weather);
    const weathers = [['', 'Au hasard']].concat(wk.map(k => [k, `${R.weather[k].icon} ${R.weather[k].label}`]));
    const n = this.skCount();
    const units = this.skUnits().map(t => {
      const u = R.units[t], k = sk.units[t] || 0;
      return `<div class="sk-unit ${k ? 'on' : ''}"><div><b>${esc(u.name)}</b><small>${esc(u.desc || '')}</small></div>
        <span class="sk-ctr"><button class="btn" data-act="sk-unit" data-v="${t}" data-d="-1" ${k ? '' : 'disabled'} aria-label="Un de moins">−</button><b>${k}</b><button class="btn" data-act="sk-unit" data-v="${t}" data-d="1" ${n >= o.max ? 'disabled' : ''} aria-label="Un de plus">+</button></span></div>`;
    }).join('');
    const foeTxt = !fort ? 'L’ennemi aligne autant de régiments que vous, tirés au sort, avec son général.'
      : sk.role === 'def' ? `Vous tenez la place, remparts intacts, avec la milice ; l’ennemi monte à l’assaut avec ${o.assault_units} régiments, dont son parc de siège.`
        : `La garnison ennemie : ${o.garrison_units} régiments et la milice, derrière des remparts intacts (il faut les escalader). Renforts d’assaut : +${o.assault_bonus} régiments en plus des vôtres (2 batteries, sapeurs, grenadiers, ligne).`;
    const diffs = Object.entries(R.difficulty).map(([k, l]) => `<button class="${k === this.startDiff ? 'on' : ''}" data-act="pick-diff" data-v="${k}">${l}</button>`).join('');
    const ready = sk.me && n > 0;
    this.$('start').innerHTML = `<div class="start-side">
      <div class="cartouche"><h1>Conquête</h1><div class="campaign">Mode bataille</div><p>Une bataille, sans campagne : choisissez vos régiments, le reste se tire au sort ou se règle ci-dessous.</p></div>
      ${this.modeTabs()}
      ${info.running ? '<button class="btn" data-act="resume">Reprendre la campagne en cours</button>' : ''}
      <div class="row"><span class="lab">Époque</span>${seg('era', eras)}</div>
      <div class="sk-l">Votre camp</div>${seg('me', camps, true)}
      <div class="sk-l">L’adversaire</div>${seg('foe', foes, true)}
      <div class="sk-l">La bataille</div>${seg('kind', [['bataille', 'Bataille rangée', 'En rase campagne'], ['forteresse', 'Place forte', 'Assaut ou défense d’une place fortifiée']])}
      ${seg('role', [['att', fort ? 'Vous attaquez la place' : 'Vous attaquez'], ['def', fort ? 'Vous la défendez' : 'Vous défendez']])}
      <div class="row"><span class="lab">Lieu</span>${placeSel}</div>
      <p class="muted small sk-help">${fort ? 'Au hasard parmi les places fortes, ou touchez une place sur la carte.' : 'Le combat se livre dans la campagne voisine. Touchez aussi une ville ou un village sur la carte.'}</p>
      <div class="row"><span class="lab">Saison</span>${seg('season', seasons, true)}</div>
      <div class="row"><span class="lab">Météo</span>${seg('weather', weathers, true)}</div>
      <div class="sk-l">Vos régiments <span class="muted">${n} / ${o.max}</span></div>
      <div class="sk-units">${units}</div>
      <p class="muted small sk-help">${foeTxt}</p>
      <div class="row"><span class="lab">Difficulté</span><span class="seg">${diffs}</span></div>
      <div class="start-actions">
        <button class="btn primary" data-act="sk-start" ${ready ? '' : 'disabled'}>${!sk.me ? 'Choisissez votre camp' : !n ? 'Choisissez vos régiments' : 'Livrer bataille'}</button>
        ${this.versionHtml(info.update)}
      </div></div>`;
    const sel = this.$('start').querySelector('select.sk-place');
    sel.addEventListener('change', () => { sk.place = sel.value; this.skMark(); this.renderStart(); });
  }

  // ligne discrète : version du jeu et résultat de la recherche de mise à jour au démarrage du serveur
  versionHtml(u) {
    if (!u) return '';
    const v = u.version ? `Version ${esc(u.version)}${u.date ? ` du ${esc(u.date)}` : ''}` : 'Version inconnue';
    const label = { a_jour: 'à jour', hors_ligne: 'mise à jour non vérifiée', bloque: 'mise à jour bloquée',
      desactive: 'vérification désactivée', pas_git: 'pas de mise à jour automatique' }[u.status] || '';
    if (u.status === 'mis_a_jour') {
      const news = (u.news || []).map(t => `<li>${esc(t)}</li>`).join('');
      const rest = u.n - (u.news || []).length;
      const more = rest > 0 ? `<li class="muted">… et ${rest} ${rest > 1 ? 'autres' : 'autre'}</li>` : '';
      return `<details class="ver-line maj" ${this.verOpen ? 'open' : ''}><summary>Mise à jour installée : ${u.n} ${u.n > 1 ? 'nouveautés' : 'nouveauté'} <span class="muted">· ${v}</span></summary>${news ? `<ul>${news}${more}</ul>` : ''}</details>`;
    }
    if (u.status === 'a_jour' || !u.msg) return `<div class="ver-line">${v}${label ? ` · ${label}` : ''}</div>`;
    return `<details class="ver-line" ${this.verOpen ? 'open' : ''}><summary>${v} · ${label}</summary><p>${esc(u.msg)}</p></details>`;
  }
}

