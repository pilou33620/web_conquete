// Vue tactique : l'interface par-dessus le canevas. Barre fine en haut (lieu, heure, temps, rapport de forces, journal),
// fil des événements, fiche du régiment inspecté, mini-carte en bas à droite, récapitulatif ; la fenêtre des ordres et
// le bandeau du film sont dans ordres.js (vos officiers commandent : « Donner mes ordres »).
import { ICON } from '../icons.js';
import { QUALITES, QUALITE_LABEL, qualite, setQualite } from './qualite.js';
import { clsOf, isGeneral, isLight, isWagon, stars, fmt, esc, clamp, TYPE_LABEL, FORM_LABEL, STATE_LABEL, SEASON_LABEL, WEATHER_LABEL, normSeason } from './formes.js';
import { figureKind, drawPortrait } from '../portraits.js';
import { valeursHtml } from '../valeurs.js';
import { Ordres } from './ordres.js';

const WX_ICON = {
  soleil: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  nuages: '<path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z"/>',
  pluie: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  orage: '<path d="M7 13h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 13z"/><path d="M12 14l-2 4h3l-2 4"/>',
  neige: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M10 4.5l2 1.5 2-1.5M10 19.5l2-1.5 2 1.5"/>',
  brouillard: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  canicule: '<circle cx="12" cy="10" r="4"/><path d="M12 2v2M4 10h2M18 10h2M6.3 4.3l1.4 1.4M17.7 4.3l-1.4 1.4"/><path d="M5 18c2-1.5 4 1.5 7 0s5 1.5 7 0"/>',
};
WX_ICON.tempete = WX_ICON.orage;
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = { journal: ICON.journal, close: ICON.close };

export class BattleUI {
  constructor(view) {
    this.v = view;
    const el = document.createElement('div');
    el.className = 'bt-ui';
    el.innerHTML = `
      <header class="bt-top">
        <div class="bt-place"><div class="bt-name"></div><div class="bt-when"></div></div>
        <div class="bt-gauge" title="Rapport de forces (hommes valides)"><div class="bt-g-l"></div><div class="bt-g-bar"><i class="a"></i><i class="b"></i></div><div class="bt-g-r"></div></div>
        <div class="bt-clock" title="Année et heure de la bataille"></div>
        <div class="bt-acts">
          <button class="bt-btn bt-menu" data-a="menu" hidden title="Quitter la bataille et revenir au menu principal" aria-label="Revenir au menu principal">Menu</button>
          <button class="bt-ib" data-a="journal" aria-label="Journal de la bataille" title="Journal">${I.journal}</button>
        </div>
      </header>
      <button class="bt-feedtog" data-a="feedtog" aria-label="Afficher ou replier le fil des événements" title="Fil des événements"><span class="ft-i">‹</span><span class="ft-n" hidden></span></button>
      <div class="bt-feed" aria-live="polite"></div>
      <section class="bt-panel" hidden></section>
      <div class="bt-side">
        <div class="bt-mini"><canvas></canvas></div>
      </div>
      <div class="bt-toasts"></div>
      <div class="bt-modal" hidden><div class="bt-card" role="dialog" aria-modal="true"></div></div>
      <div class="bt-cartouche" hidden></div>`;
    view.root.appendChild(el);
    this.el = el;
    this.$ = s => el.querySelector(s);
    this.logAll = [];
    this.feed = [];
    this.panelSig = '';
    this.inspected = null;
    this.miniT = 0;
    this.entering = false;
    // fil des événements replié ou non (gardé sur cet appareil)
    try { this.feedOff = localStorage.getItem('conquete.bataille.fil') === '0'; } catch (e) { this.feedOff = false; }
    // valeurs chiffrées du régiment repliées par défaut (le panneau est déjà haut sur un téléphone)
    try { this.showVals = localStorage.getItem('conquete.bataille.valeurs') === '1'; } catch (e) { this.showVals = false; }
    this.unseen = 0;
    this.setFeed(!this.feedOff);
    el.addEventListener('click', e => this.click(e));
    this.bindMini();
    this.ordres = new Ordres(this);   // « Donner mes ordres » : la fenêtre des ordres, puis le film de la bataille
  }
  dispose() { this.el.remove(); }

  // ------------------------------------------------------------------ mises à jour
  update(st, prev) {
    const v = this.v;
    const side = st.sides || [], me = v.me, foe = 1 - me;
    const title = st.title || v.map?.title || (v.map?.place ? `Assaut de ${v.map.place.name}` : 'Bataille');
    this.$('.bt-name').textContent = title;
    this.$('.bt-menu').hidden = !st.skirmish;
    const wx = st.weather || v.map?.weather || 'soleil', season = normSeason(st.season || v.map?.season);
    const left = st.dusk != null && st.clock != null ? st.dusk - st.clock : null;
    const dusk = left != null && left < 5400 && left > 0 ? ` · <span class="bt-dusk">nuit dans ${Math.max(1, Math.round(left / 60))} min</span>` : '';
    this.$('.bt-when').innerHTML = `<span class="bt-wx">${svg(WX_ICON[wx] || WX_ICON.soleil)}</span>${esc(st.hour || '')} · ${esc(WEATHER_LABEL[wx] || wx)} · ${esc(SEASON_LABEL[season] || '')}${dusk}`;
    // horloge, à la manière d'Ultimate General : l'année en grand, l'heure dessous
    const year = st.year || v.map?.year;
    this.$('.bt-clock').innerHTML = `${year ? `<b>${esc(year)}</b>` : ''}<span>${esc(st.hour || '')}</span>`;
    // jauge du rapport de forces
    const a = side[me]?.men ?? 0, b = side[foe]?.men ?? 0, tot = a + b || 1;
    const ga = this.$('.bt-g-bar .a'), gb = this.$('.bt-g-bar .b');
    ga.style.width = (a / tot * 100) + '%'; gb.style.width = (b / tot * 100) + '%';
    ga.style.background = v.colors[me] || '#b8352a'; gb.style.background = v.colors[foe] || '#3f6fb5';
    this.$('.bt-g-l').innerHTML = `<b>${fmt(a)}</b><small>${esc(side[me]?.name || 'Vous')}</small>`;
    this.$('.bt-g-r').innerHTML = `<small>${esc(side[foe]?.name || 'Ennemi')}${side[foe]?.seen ? ' (vus)' : ''}</small><b>${fmt(b)}</b>`;
    this.el.classList.toggle('deploy', st.phase === 'deploiement');
    this.el.classList.toggle('fin', st.phase === 'fin');
    for (const txt of st.log || []) this.addLog(txt);
    if (st.phase === 'fin' && !this.recapShown && (st.result || prev?.phase !== 'fin')) { this.recapShown = true; setTimeout(() => this.recap(st.result || {}), 900); }
    this.ordres.update(st, prev);
    this.renderPanel();
  }
  frame(now) {
    if (now - this.miniT > 100) { this.miniT = now; this.drawMini(); }
    this.ordres.frame(now);
    // le journal s'efface peu à peu
    const box = this.$('.bt-feed');
    let changed = false;
    this.feed = this.feed.filter(f => { const keep = now - f.t < 7000; if (!keep) { f.el.remove(); changed = true; } return keep; });
    if (changed && !this.feed.length) box.innerHTML = '';
  }
  addLog(txt) {
    const v = this.v;
    // le moteur met parfois l'heure en tête du message (« 8 h 08 — … ») : on la garde à part
    const m = /^(Ennemi : )?(\d{1,2} h \d{2}) — /.exec(txt);
    const hour = m ? m[2] : v.st?.hour || '';
    if (m) txt = (m[1] || '') + txt.slice(m[0].length);
    this.logAll.push({ hour, txt });
    if (this.logAll.length > 400) this.logAll.shift();
    const box = this.$('.bt-feed'), d = document.createElement('div');
    d.className = 'bt-ev' + (/déroute|anéanti|charge|enfonce|brise|Victoire|Défaite/i.test(txt) ? ' imp' : '');
    d.innerHTML = `<span>${esc(hour)}</span>${esc(txt)}`;
    box.appendChild(d);
    this.feed.push({ el: d, t: performance.now() });
    while (this.feed.length > 2) this.feed.shift().el.remove();
    if (this.feedOff) { this.unseen++; const n = this.$('.ft-n'); n.hidden = false; n.textContent = this.unseen > 9 ? '9+' : this.unseen; }
    if (this.modal === 'journal') this.journal();
  }
  setFeed(on) {
    this.feedOff = !on;
    this.el.classList.toggle('feed-off', !on);
    this.$('.ft-i').textContent = on ? '‹' : '›';
    if (on) { this.unseen = 0; this.$('.ft-n').hidden = true; }
    try { localStorage.setItem('conquete.bataille.fil', on ? '1' : '0'); } catch (e) { /* tant pis */ }
  }
  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'bt-toast ' + kind; t.textContent = text;
    const box = this.$('.bt-toasts');
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), 3600);
  }

  ammoFrac(u) { return u.ammo0 ? clamp(u.ammo / u.ammo0, 0, 1) : u.ammo != null ? clamp(u.ammo / 100, 0, 1) : 1; }
  // figure du type de soldat, sur la carte d'unité (en portrait) ou dans le panneau : dessinée dans un repère de
  // 56 × 64, mis à l'échelle de la hauteur du canevas (calée en bas, centrée ; en portrait, les côtés sont rognés)
  figure(cv, u) {
    if (!u) return;
    const cls = clsOf(u);
    // (portraits.js : le même dessin que les cartes de la campagne)
    const kind = figureKind({ cls, type: u.type, light: isLight(u), arm: u.arm ?? 1, general: isGeneral(u), wagon: isWagon(u) });
    drawPortrait(cv, this.v.art, kind, this.v.colors[u.side] || '#888', cls, u.name);
  }
  // ------------------------------------------------------------------ panneau de l'unité choisie
  // le régiment touché sur le terrain (commandes.js) : sa fiche, son anneau au sol ; null : la refermer
  inspect(id) {
    const v = this.v;
    this.inspected = id && v.units.get(String(id)) ? String(id) : null;
    v.sel = new Set(this.inspected ? [this.inspected] : []);
    if (!this.inspected) v.setLos(false);
    this.renderPanel(true);
  }
  renderPanel(force = false) {
    const v = this.v, p = this.$('.bt-panel');
    const u = this.inspected && v.units.get(this.inspected);
    if (!u) { p.hidden = true; this.panelSig = ''; this.el.classList.remove('has-panel'); return; }
    const mine = u.side === v.me;
    const sig = JSON.stringify([u.id, u.men, Math.round(u.morale ?? 0), Math.round(u.fat ?? 0), u.ammo, u.state, u.form, u._ghost, u.camo, v.losOn, this.showVals, u.can_occupy, u.can_barricade, u.seen, u.order]);
    if (sig === this.panelSig && !force) return;
    this.panelSig = sig;
    p.hidden = false;
    this.el.classList.add('has-panel');
    if (!mine) { p.innerHTML = this.foeHtml(u); return; }
    const am = u.ammo0 ? `${fmt(u.ammo)} / ${fmt(u.ammo0)} ${clsOf(u) === 'artillerie' ? 'coups' : 'cartouches'}` : `${fmt(u.ammo ?? 100)} %`;
    const rg = u.range ? `portée max ${fmt(u.range[1])} m${u.range[2] ? `, mitraille ${fmt(u.range[2])} m` : ''}` : '';
    p.innerHTML = `<button class="bt-x" data-a="desel" aria-label="Fermer">${I.close}</button>
      <div class="bp-head"><canvas class="bp-fig" data-fig="${esc(u.id)}" width="56" height="64"></canvas><div><div class="bp-t">${esc(u.name)}</div>
      <div class="bp-s">${esc(TYPE_LABEL[u.type] || u.type)} · ${esc(FORM_LABEL[u.form] || u.form || '')} · <span class="bp-state ${u.state}">${esc(STATE_LABEL[u.state] || u.state || '')}</span></div></div></div>
      <dl class="bp-kv two">
        <dt>Hommes</dt><dd>${fmt(u.men)} <small>/ ${fmt(u.men0 || u.men)}</small></dd>
        <dt>Expérience</dt><dd class="bp-stars">${'★'.repeat(stars(u.xp))}<i>${'★'.repeat(5 - stars(u.xp))}</i></dd>
        <dt>Moral</dt><dd><span class="bp-bar mor"><i style="width:${clamp(u.morale ?? 0, 0, 100)}%"></i></span> <small>${Math.round(u.morale ?? 0)}</small></dd>
        <dt>Endurance</dt><dd><span class="bp-bar end"><i style="width:${clamp(100 - (u.fat ?? 0), 0, 100)}%"></i></span></dd>
        <dt>Munitions</dt><dd><span class="bp-bar amm"><i style="width:${this.ammoFrac(u) * 100}%"></i></span></dd>
        <dt>Portée</dt><dd>${u.range ? fmt(u.range[0]) + ' m' : '—'}</dd>
      </dl>
      <div class="bp-note">${am} · ${rg}<button class="bp-vl ${this.showVals ? 'on' : ''}" data-a="valeurs" aria-expanded="${!!this.showVals}">Valeurs</button></div>${this.showVals ? valeursHtml(u.stats) : ''}
      ${u.camo ? '<p class="bp-help">Camouflée dans le bois : l’ennemi ne la voit qu’à moins de 250 m (500 m quand elle tire). En échange, les arbres gênent son tir (−35 %) et sa mise en batterie (plus longue de moitié).</p>' : ''}
      ${u.form === 'maisons' ? `<p class="bp-help">Dans les maisons${u.seen ? '' : ', <b>cachée</b>'} : l’ennemi ne la voit qu’à moins de 120 m (60 s après qu’elle a tiré). Elle tire par les fenêtres (60 % des hommes), se défend mieux au corps à corps, et les cavaliers n’y chargent pas.</p>` : ''}
      ${u.order === 'barricade' ? '<p class="bp-help">Elle se barricade (4 min, 2 pour des sapeurs) : un ennemi à moins de 150 m interrompt le travail.</p>' : ''}
      <div class="bp-row bp-btns"><button class="bt-btn ${v.losOn ? 'on' : ''}" data-a="los" title="Ce que voit ce régiment">Ligne de vue</button>${'can_occupy' in u ? this.abri(u, 'maisons', 'Occuper les maisons', u.can_occupy) + this.abri(u, 'barricade', 'Barricader', u.can_barricade) : ''}</div>`;
    const c = p.querySelector('canvas[data-fig]');
    if (c) this.figure(c, u);
  }
  // « Occuper les maisons », « Barricader » : refusés, ils disent pourquoi (la raison du serveur)
  abri(u, kind, label, can) {
    const why = can === true ? '' : String(can || '');
    return `<button class="bt-btn${why ? ' lock' : ''}" data-a="abri" data-k="${kind}"${why ? ` aria-disabled="true" title="${esc(why)}"` : ''}>${label}</button>`;
  }
  foeHtml(u) {
    const ghost = u._ghost;
    const est = Math.round(u.men / 50) * 50;
    return `<button class="bt-x" data-a="desel" aria-label="Fermer">${I.close}</button>
      <div class="bp-head"><canvas class="bp-fig" data-fig="${esc(u.id)}" width="56" height="64"></canvas><div><div class="bp-t">${esc(u.name || 'Troupe ennemie')}</div>
      <div class="bp-s">${esc(TYPE_LABEL[u.type] || u.type || '')} · ${ghost ? 'dernière position connue' : 'ennemi repéré'}</div></div></div>
      <dl class="bp-kv"><dt>Effectif</dt><dd>environ ${fmt(Math.max(est, 50))}</dd><dt>Formation</dt><dd>${esc(FORM_LABEL[u.form] || '—')}</dd><dt>État</dt><dd>${esc(STATE_LABEL[u.state] || '—')}</dd></dl>`;
  }

  // ------------------------------------------------------------------ clics
  click(e) {
    const b = e.target.closest('[data-a]');
    if (!b) { if (e.target.classList.contains('bt-modal') && this.modal !== 'recap') this.closeModal(); return; }
    const v = this.v;
    switch (b.dataset.a) {
      case 'desel': this.inspect(null); break;
      case 'los': v.setLos(!v.losOn); this.renderPanel(true); break;
      case 'abri': {
        const u = this.inspected && v.units.get(this.inspected);
        if (!u) break;
        if (b.title) { this.toast(b.title); break; }
        v.cmd('unit', { id: u.id, kind: b.dataset.k }).then(r => { if (r.ok && r.msg) this.toast(r.msg, 'good'); });
        break;
      }
      case 'valeurs':
        this.showVals = !this.showVals;
        try { localStorage.setItem('conquete.bataille.valeurs', this.showVals ? '1' : '0'); } catch (e) { /* tant pis */ }
        this.renderPanel(true); break;
      case 'journal': this.journal(); break;
      case 'menu': if (confirm('Quitter la bataille et revenir au menu principal ?')) { this.closeModal(); v.onExit && v.onExit(null); } break;
      case 'qualite': setQualite(b.dataset.q); this.journal(); break;
      case 'feedtog': this.setFeed(this.feedOff); break;
      case 'close': this.closeModal(); break;
      case 'retour': this.closeModal(); v.onExit && v.onExit(this.result); break;
    }
  }

  // ------------------------------------------------------------------ fenêtres
  openModal(kind, html) {
    this.modal = kind;
    const m = this.$('.bt-modal');
    m.hidden = false;
    m.querySelector('.bt-card').innerHTML = html;
    m.querySelector('.bt-card').className = 'bt-card ' + kind;
  }
  closeModal() { this.modal = null; this.$('.bt-modal').hidden = true; }
  closeTransient() { if (this.modal === 'journal') this.closeModal(); }
  journal() {
    const rows = this.logAll.slice().reverse().map(l => `<div class="bj-ev"><span>${esc(l.hour)}</span>${esc(l.txt)}</div>`).join('') || '<p class="bp-help">Rien encore.</p>';
    // la qualité graphique se règle aussi d'ici (comme dans le menu ☰ de la campagne)
    const q = qualite().q, qs = QUALITES.map(k => `<button class="bt-btn ${k === q ? 'on' : ''}" data-a="qualite" data-q="${k}" aria-pressed="${k === q}">${QUALITE_LABEL[k]}</button>`).join('');
    this.openModal('journal', `<button class="bt-x" data-a="close" aria-label="Fermer">${I.close}</button><h2 class="bm-t">Journal de la bataille</h2><div class="bj">${rows}</div>
      <div class="bm-btns" role="group" aria-label="Qualité graphique"><span class="bp-help">Qualité graphique</span>${qs}</div>`);
  }
  // récapitulatif de fin de bataille
  recap(r) {
    const v = this.v;
    this.result = r;
    const me = v.me;
    const win = r.won ?? (r.winner === me || r.winner === v.st?.sides?.[me]?.owner);
    // prisonniers : [les nôtres capturés, ennemis capturés] (moteur) ou un seul nombre (faits)
    const pris = Array.isArray(r.prisoners) ? r.prisoners : [0, r.prisoners ?? 0];
    const ls = Array.isArray(r.losses?.[0]) ? r.losses[0] : r.losses || [];
    const mine = v.mine().concat([...v.units.values()].filter(u => u.side === me && u.state === 'hors'));
    const lostMine = ls[0] ?? mine.reduce((a, u) => a + Math.max(0, (u.men0 || u.men) - u.men), 0);
    const lostFoe = ls[1] ?? '—';
    const per = r.units || mine.map(u => ({ id: u.id, name: u.name, lost: Math.max(0, (u.men0 || u.men) - u.men), xp: r.xp }));
    const title = r.title || (win ? 'Victoire !' : 'Défaite');
    this.openModal('recap', `<div class="br-head ${win ? 'win' : 'loss'}"><div class="br-orn">${win ? '✦' : '✧'}</div><h2>${esc(title)}</h2><div class="br-sub">${esc(v.st?.title || '')} — ${esc(v.st?.hour || '')}</div></div>
      ${(r.lines || []).map(l => `<p class="br-line">${esc(l)}</p>`).join('')}
      <div class="br-stats">
        <div><b>${fmt(lostMine)}</b><span>vos pertes</span></div>
        <div><b>${typeof lostFoe === 'number' ? fmt(lostFoe) : lostFoe}</b><span>pertes ennemies</span></div>
        <div><b>${fmt(pris[1])}</b><span>prisonniers faits${pris[0] ? ` <small>(${fmt(pris[0])} perdus)</small>` : ''}</span></div>
        <div><b>+${fmt(r.xp ?? 0)}</b><span>expérience</span></div>
      </div>
      ${r.arms ? `<table class="br-arms"><thead><tr><th>Pertes</th><th>Vous</th><th>L’ennemi</th></tr></thead><tbody>${r.arms.map(([l, a, b]) => `<tr><td>${esc(l)}</td><td>${a ? '−' + fmt(a) : '—'}</td><td>${b ? '−' + fmt(b) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
      ${r.decisive?.length ? `<div class="br-why"><b>Ce qui a décidé la journée</b>${r.decisive.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
      <div class="br-units">${per.map(p => `<div><span>${esc(p.name)}</span><span>${p.lost ? '−' + fmt(p.lost) : '—'}</span><span>${Math.round(p.xp || 0) ? '+' + fmt(p.xp) + ' xp' : ''}</span></div>`).join('')}</div>
      <div class="bm-btns"><button class="bt-btn primary big" data-a="retour">${v.st?.skirmish ? 'Retour au menu' : 'Retour à la carte'}</button></div>`);
  }
  // cartouche du titre à l'entrée
  cartouche() {
    const v = this.v, st = v.st || {}, c = this.$('.bt-cartouche');
    const wx = st.weather || v.map?.weather, season = normSeason(st.season || v.map?.season);
    c.innerHTML = `<div class="bc-t">${esc(st.title || v.map?.title || 'Bataille')}</div><div class="bc-s">${esc(SEASON_LABEL[season] || '')} · ${esc(WEATHER_LABEL[wx] || '')} · ${esc(st.hour || '8 h 00')}</div>`;
    c.hidden = false;
    c.classList.remove('go'); void c.offsetWidth; c.classList.add('go');
    setTimeout(() => { c.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------------ mini-carte
  bindMini() {
    const cv = this.$('.bt-mini canvas');
    let down = false;
    const go = e => {
      const r = cv.getBoundingClientRect(), v = this.v;
      const x = (e.clientX - r.left) / r.width * v.W, y = (e.clientY - r.top) / r.height * v.H;
      v.cam.x = x; v.cam.y = y; v.camAnim = null; v.clampCam();
    };
    cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture?.(e.pointerId); go(e); e.stopPropagation(); });
    cv.addEventListener('pointermove', e => { if (down) go(e); });
    cv.addEventListener('pointerup', () => { down = false; });
    cv.addEventListener('pointercancel', () => { down = false; });
  }
  drawMini() {
    const v = this.v, t = v.terrain;
    if (!t) return;
    const cv = this.$('.bt-mini canvas'), r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = v.dpr, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; this.miniBg = null; }
    if (!this.miniBg) {
      this.miniBg = document.createElement('canvas'); this.miniBg.width = W; this.miniBg.height = H;
      const g = this.miniBg.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(t.base, 0, 0, W, H);
    }
    const g = cv.getContext('2d'), sx = W / v.W, sy = H / v.H;
    g.drawImage(this.miniBg, 0, 0);
    for (const u of v.units.values()) {
      if (u.state === 'hors') continue;
      const [w, d] = [Math.max(u.w, 30), Math.max(u.d, 14)];
      g.save(); g.translate(u.x * sx, u.y * sy); g.rotate(u.dir + Math.PI / 2);
      g.globalAlpha = u._ghost ? 0.45 : 1;
      g.fillStyle = v.colors[u.side] || '#888';
      g.fillRect(-w * sx / 2, -d * sy / 2, w * sx, Math.max(2 * dpr, d * sy));
      if (v.sel.has(u.id)) { g.strokeStyle = '#ffe29a'; g.lineWidth = 1.5 * dpr; g.strokeRect(-w * sx / 2 - dpr, -d * sy / 2 - dpr, w * sx + 2 * dpr, Math.max(2 * dpr, d * sy) + 2 * dpr); }
      g.restore();
    }
    g.globalAlpha = 1;
    // la part du terrain que montre la vue (un rectangle : la vue est de dessus)
    const pts = [[0, 0], [v.vw, 0], [v.vw, v.vh], [0, v.vh]].map(([x, y]) => v.toWorld(x, y));
    g.strokeStyle = 'rgba(255,248,230,0.95)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)); g.closePath(); g.stroke();
  }
}
