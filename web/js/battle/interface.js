// Vue tactique : l'interface par-dessus le canevas. Barre fine en haut (lieu, heure, temps, rapport de forces,
// boutons), bandeau du déploiement, journal, panneau de l'unité choisie avec ses ordres, barre des cartes
// d'unités groupées en bas, mini-carte et vitesses en bas à droite, bulles d'aide, confirmations et récapitulatif.
import { ICON } from '../icons.js';
import { QUALITES, QUALITE_LABEL, qualite, setQualite } from './qualite.js';
import { clsOf, isGeneral, isLight, isWagon, genName, emprise, stars, fmt, esc, clamp, TYPE_LABEL, FORM_LABEL, FORM_HELP, FORMS, STATE_LABEL, SEASON_LABEL, WEATHER_LABEL, normSeason, TILT } from './formes.js';
import { ORDER_LABEL, ordresHtml, aide as aideArme, arme } from './doctrine.js';

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
const I = {
  pause: '<svg viewBox="0 0 24 20"><rect x="7" y="3" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.4" y="3" width="3.6" height="14" rx="1" fill="currentColor"/></svg>',
  journal: ICON.journal, aide: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.6"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>'),
  retraite: svg('<path d="M10 6 4 12l6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>'), auto: svg('<path d="M5 4l9 8-9 8z"/><path d="M15 4v16M19 4v16"/>'),
  close: ICON.close, couvert: svg('<path d="M12 3 4 20h16z"/><path d="M8 14h8"/>'),
};
const speedSvg = n => { let p = '', x = (24 - (n * 7 - (n - 1) * 1.5)) / 2; for (let k = 0; k < n; k++) { p += `<path d="M${x} 3 L${x + 7} 10 L${x} 17z" fill="currentColor"/>`; x += 6; } return `<svg viewBox="0 0 24 20">${p}</svg>`; };

// bulles de situation (situ) : déjà vues sur cet appareil ; « Revoir le tutoriel » (menu ☰ de la campagne) les remet
const VUES = 'conquete.bataille.aide.vues';
const SITU = {
  deroute: 'Un de vos régiments est en déroute ! Il ne se reformera qu’auprès de votre général (le cercle doré), loin de l’ennemi : envoyez l’état-major à sa rencontre avant qu’il ne quitte le terrain.',
  munitions: 'Un canon n’a plus de munitions : il se tait. Amenez-le à moins de 150 m du chariot de munitions : il s’y recomplète (le chariot aussi recomplète les régiments).',
  'arme:ligne': 'Infanterie de ligne : feu à volonté, en salve (plus juste, plus lent) ou cesser. « Salve + baïonnette » lâche une volée à bout portant puis charge ; « Baïonnette ! » charge sans tirer. Touchez ensuite l’ennemi visé.',
  'arme:grenadiers': 'Grenadiers : l’élite de l’infanterie. Une salve à bout portant puis la baïonnette (« Salve + baïonnette ») : ils tiennent mieux le corps à corps.',
  'arme:tirailleurs': 'Tirailleurs : « Harceler » les fait tirer à bonne portée et reculer devant l’ennemi. Ils craignent la cavalerie : gardez-les près de la ligne ou à couvert.',
  'arme:cavalerie': 'Cavalerie : elle ne tire pas, elle charge. « Charger ! » puis touchez l’ennemi : de flanc, sur les canons ou sur les fuyards. « Poursuivre » achève une troupe en déroute.',
  'arme:artillerie': 'Artillerie : le boulet de loin, la mitraille de près (sous 150 m, elle fauche des files entières). « Contre-batterie » fait taire d’abord les canons ennemis.',
};

export class BattleUI {
  constructor(view) {
    this.v = view;
    const el = document.createElement('div');
    el.className = 'bt-ui';
    el.innerHTML = `
      <header class="bt-top">
        <div class="bt-place"><div class="bt-name"></div><div class="bt-when"></div></div>
        <div class="bt-gauge" title="Rapport de forces (hommes valides)"><div class="bt-g-l"></div><div class="bt-g-bar"><i class="a"></i><i class="b"></i></div><div class="bt-g-r"></div></div>
        <div class="bt-acts">
          <button class="bt-ib" data-a="journal" aria-label="Journal de la bataille" title="Journal">${I.journal}</button>
          <button class="bt-ib" data-a="aide" aria-label="Aide" title="Aide">${I.aide}</button>
          <button class="bt-btn" data-a="auto" title="Confier la suite à vos officiers, en accéléré">${I.auto}<span>Finir auto.</span></button>
          <button class="bt-btn danger" data-a="decrocher" title="Faire retraite">${I.retraite}<span>Décrocher</span></button>
        </div>
      </header>
      <div class="bt-deploy" hidden>
        <div class="bt-dtxt"><b>Déploiement</b> — glissez vos régiments dans la zone dorée et orientez-les. <span class="bt-legend"><i class="lg-bois"></i>bois : couvert <i class="lg-haut"></i>hauteurs : vue et portée <i class="lg-bati"></i>bâti, murs</span></div>
        <div class="bt-dbtns"><button class="bt-btn" data-a="couverts">${I.couvert}<span>Couverts</span></button><button class="bt-btn primary" data-a="engager">Engager la bataille</button></div>
      </div>
      <div class="bt-accel" role="region" aria-label="Bataille en accéléré" hidden>
        <div class="ba-txt"><b>Les généraux poursuivent la bataille…</b><span class="ba-h"></span>
          <div class="ba-prog" aria-hidden="true"><i class="ba-done"></i><i class="ba-from"></i></div></div>
        <button class="bt-btn primary" data-a="reprendre">Reprendre le commandement</button>
      </div>
      <button class="bt-feedtog" data-a="feedtog" aria-label="Afficher ou replier le fil des événements" title="Fil des événements"><span class="ft-i">‹</span><span class="ft-n" hidden></span></button>
      <div class="bt-feed" aria-live="polite"></div>
      <div class="bt-target-hint" hidden></div>
      <section class="bt-panel" hidden></section>
      <div class="bt-side">
        <div class="bt-mini"><canvas></canvas></div>
        <div class="bt-speed" role="group" aria-label="Vitesse de la bataille">
          <button data-v="0" aria-label="Pause">${I.pause}</button><button data-v="1" aria-label="Vitesse ×1">${speedSvg(1)}</button><button data-v="2" aria-label="Vitesse ×2">${speedSvg(2)}</button><button data-v="4" aria-label="Vitesse ×4">${speedSvg(3)}<small>4</small></button>
        </div>
      </div>
      <nav class="bt-dock" aria-label="Vos régiments"></nav>
      <button class="bt-dscroll l" data-a="dscroll" data-d="-1" aria-label="Régiments précédents" hidden>‹</button>
      <button class="bt-dscroll r" data-a="dscroll" data-d="1" aria-label="Régiments suivants" hidden>›</button>
      <div class="bt-toasts"></div>
      <div class="bt-tip" hidden></div>
      <div class="bt-modal" hidden><div class="bt-card" role="dialog" aria-modal="true"></div></div>
      <div class="bt-cartouche" hidden></div>`;
    view.root.appendChild(el);
    this.el = el;
    this.$ = s => el.querySelector(s);
    this.logAll = [];
    this.feed = [];
    this.dockSig = ''; this.panelSig = '';
    this.inspected = null;
    this.miniT = 0;
    this.entering = false;
    // fil des événements replié ou non (gardé sur cet appareil)
    try { this.feedOff = localStorage.getItem('conquete.bataille.fil') === '0'; } catch (e) { this.feedOff = false; }
    this.unseen = 0;
    this.setFeed(!this.feedOff);
    el.addEventListener('click', e => this.click(e));
    this.$('.bt-dock').addEventListener('scroll', () => this.dockArrows(), { passive: true });
    this.bindMini();
    this.bindDock();
  }
  dispose() { this.el.remove(); }

  // ------------------------------------------------------------------ mises à jour
  update(st, prev) {
    const v = this.v;
    const side = st.sides || [], me = v.me, foe = 1 - me;
    // la bulle d'aide ouverte suit la phase : les conseils de déploiement ne restent pas affichés pendant le combat
    if (st.phase !== this.tipPhase) {
      this.tipPhase = st.phase;
      const tip = this.$('.bt-tip');
      if (tip && !tip.hidden) {
        if (st.phase === 'fin') tip.hidden = true;
        else this.tipStep(Math.min(this.tipI || 0, 3));
      }
    }
    const title = st.title || v.map?.title || (v.map?.place ? `Assaut de ${v.map.place.name}` : 'Bataille');
    this.$('.bt-name').textContent = title;
    const wx = st.weather || v.map?.weather || 'soleil', season = normSeason(st.season || v.map?.season);
    const left = st.dusk != null && st.clock != null ? st.dusk - st.clock : null;
    const dusk = left != null && left < 5400 && left > 0 ? ` · <span class="bt-dusk">nuit dans ${Math.max(1, Math.round(left / 60))} min</span>` : '';
    this.$('.bt-when').innerHTML = `<span class="bt-wx">${svg(WX_ICON[wx] || WX_ICON.soleil)}</span>${esc(st.hour || '')} · ${esc(WEATHER_LABEL[wx] || wx)} · ${esc(SEASON_LABEL[season] || '')}${dusk}`;
    // jauge du rapport de forces
    const a = side[me]?.men ?? 0, b = side[foe]?.men ?? 0, tot = a + b || 1;
    const ga = this.$('.bt-g-bar .a'), gb = this.$('.bt-g-bar .b');
    ga.style.width = (a / tot * 100) + '%'; gb.style.width = (b / tot * 100) + '%';
    ga.style.background = v.colors[me] || '#b8352a'; gb.style.background = v.colors[foe] || '#3f6fb5';
    this.$('.bt-g-l').innerHTML = `<b>${fmt(a)}</b><small>${esc(side[me]?.name || 'Vous')}</small>`;
    this.$('.bt-g-r').innerHTML = `<small>${esc(side[foe]?.name || 'Ennemi')}${side[foe]?.seen ? ' (vus)' : ''}</small><b>${fmt(b)}</b>`;
    // phase
    const deploy = st.phase === 'deploiement';
    this.$('.bt-deploy').hidden = !deploy;
    this.el.classList.toggle('deploy', deploy);
    this.el.classList.toggle('fin', st.phase === 'fin');
    // « Finir automatiquement » : vos officiers commandent et la bataille défile en accéléré (les vitesses n'y font rien)
    const accel = !!st.accel && st.phase === 'combat';
    this.el.classList.toggle('accel', accel);
    this.$('.bt-accel').hidden = !accel;
    if (accel) this.accelBar(st);
    // (les bulles d'aide parlent de commander : elles se referment quand les officiers prennent la main)
    if (accel && !prev?.accel) { if (v.controls.targeting) v.controls.setTargeting(null); this.$('.bt-tip').hidden = true; this.panelSig = ''; }
    this.$('[data-a="auto"]').hidden = deploy || st.phase === 'fin' || accel;
    this.$('[data-a="decrocher"]').hidden = st.phase === 'fin';
    for (const bt of this.$('.bt-speed').children) bt.classList.toggle('on', +bt.dataset.v === (st.speed ?? 0) && !deploy && !accel);
    this.$('.bt-speed').classList.toggle('off', deploy || accel);
    this.$('[data-a="couverts"]').classList.toggle('on', v.showCover !== false);
    // journal
    for (const txt of st.log || []) this.addLog(txt);
    // fin
    if (st.phase === 'fin' && !this.recapShown && (st.result || prev?.phase !== 'fin')) { this.recapShown = true; setTimeout(() => this.recap(st.result || {}), 900); }
    if (prev && prev.phase === 'deploiement' && st.phase === 'combat') { this.toast('La bataille est engagée !', 'good'); v.showCover = false; }
    this.renderDock();
    this.renderPanel();
    this.situ();
  }
  // bandeau de l'accéléré : l'heure de bataille qui avance, et la journée de 8 h à la nuit (repère : la prise de
  // commandement des officiers)
  accelBar(st) {
    const dusk = Math.max(1, st.dusk || 1), k = clamp((st.clock || 0) / dusk, 0, 1), k0 = clamp((st.accel_t || 0) / dusk, 0, 1);
    this.$('.ba-h').textContent = `${st.hour || ''} — nuit vers ${hourOf(dusk)}`;
    this.$('.ba-done').style.width = (k * 100).toFixed(1) + '%';
    const from = this.$('.ba-from');
    from.style.left = (k0 * 100).toFixed(1) + '%';
    from.hidden = k0 <= 0.005;
  }
  frame(now) {
    if (now - this.miniT > 100) { this.miniT = now; this.drawMini(); }
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
  // flèches de défilement de la barre des unités, quand elle déborde
  dockArrows() {
    const d = this.$('.bt-dock'), over = d.scrollWidth > d.clientWidth + 4;
    this.$('.bt-dscroll.l').hidden = !over || d.scrollLeft < 4;
    this.$('.bt-dscroll.r').hidden = !over || d.scrollLeft + d.clientWidth > d.scrollWidth - 4;
  }
  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'bt-toast ' + kind; t.textContent = text;
    const box = this.$('.bt-toasts');
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), 3600);
  }

  // ------------------------------------------------------------------ barre des unités
  groups() {
    const v = this.v, mine = v.mine();
    const by = new Map();
    const gen = mine.find(isGeneral);
    for (const u of mine) {
      const k = u.group ?? u.brigade ?? u.army ?? (isGeneral(u) ? 'gen' : clsOf(u));
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(u);
    }
    const order = ['gen', 'inf', 'cavalerie', 'artillerie'];
    const label = { gen: gen ? (gen.gen || gen.name) : 'État-major', inf: 'Infanterie', cavalerie: 'Cavalerie', artillerie: 'Artillerie' };
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) + 10) % 14 - (order.indexOf(b[0]) + 10) % 14).map(([k, us]) => ({ k, label: us.find(u => u.gname)?.gname || us[0].brigade_name || us[0].army_name || label[k] || String(k), us }));
  }
  renderDock() {
    const v = this.v, gs = this.groups();
    const sig = JSON.stringify(gs.map(g => [g.k, g.us.map(u => [u.id, Math.round(u.men / 5), Math.round(u.morale / 5), Math.round((u.fat ?? 0) / 5), Math.round(this.ammoFrac(u) * 20), u.state, v.sel.has(u.id)])]));
    if (sig === this.dockSig) return;
    this.dockSig = sig;
    const dock = this.$('.bt-dock');
    const scroll = dock.scrollLeft;
    dock.innerHTML = gs.map(g => `<div class="bt-grp"><button class="bt-gl" data-a="selgroup" data-k="${esc(g.k)}">${esc(g.label)}</button><div class="bt-cards">${g.us.map(u => this.cardHtml(u)).join('')}</div></div>`).join('');
    dock.scrollLeft = scroll;
    this.dockArrows();
    for (const c of dock.querySelectorAll('canvas[data-fig]')) this.figure(c, v.units.get(c.dataset.fig));
  }
  ammoFrac(u) { return u.ammo0 ? clamp(u.ammo / u.ammo0, 0, 1) : u.ammo != null ? clamp(u.ammo / 100, 0, 1) : 1; }
  cardHtml(u) {
    const v = this.v, sel = v.sel.has(u.id), mor = clamp(u.morale ?? 70, 0, 100), end = clamp(100 - (u.fat ?? 0), 0, 100), am = this.ammoFrac(u) * 100;
    const st = u.state === 'deroute' ? 'rout' : u.state === 'charge' || u.state === 'melee' ? 'fight' : u.state === 'feu' ? 'fire' : '';
    const range = u.range && u.range[0] ? `${fmt(u.range[0])} m` : '';
    return `<button class="bt-uc ${sel ? 'on' : ''} ${st} ${u.busy ? 'busy' : ''}" data-a="selunit" data-id="${esc(u.id)}" title="${esc(u.name)} — ${esc(TYPE_LABEL[u.type] || u.type)}">
      <canvas data-fig="${esc(u.id)}" width="56" height="64"></canvas>
      <span class="uc-n">${esc(short(isGeneral(u) && genName(u) ? genName(u) : u.name))}</span>
      <span class="uc-m">${fmt(u.men)}</span>
      <span class="uc-x">${'★'.repeat(stars(u.xp))}<i>${'★'.repeat(5 - stars(u.xp))}</i></span>
      <span class="uc-bars"><i class="mor" style="width:${mor}%"></i><i class="end" style="width:${end}%"></i><i class="amm" style="width:${am}%"></i></span>
      ${range ? `<span class="uc-r">${range}</span>` : ''}
      ${u.state === 'deroute' ? '<span class="uc-s">Déroute</span>' : ''}
    </button>`;
  }
  // petite figure du type de soldat, sur la carte d'unité
  figure(cv, u) {
    if (!u) return;
    const g = cv.getContext('2d'), col = this.v.colors[u.side] || '#888', cls = clsOf(u);
    g.clearRect(0, 0, cv.width, cv.height);
    const kind = isGeneral(u) || cls === 'cavalerie' ? 'cav' : cls === 'artillerie' ? 'canon' : isWagon(u) ? 'caisson' : u.type === 'grenadiers' || u.type === 'garde' ? 'gren' : u.type === 'milice' ? 'milice' : isLight(u) ? 'leger' : 'inf';
    const H = kind === 'cav' ? 34 : kind === 'canon' || kind === 'caisson' ? 38 : 50;
    const sp = this.v.art.sprite(kind, col, kind === 'inf' || kind === 'gren' || kind === 'leger' || kind === 'milice' ? 0 : 1, H, 0);
    const sc = H / sp.h;
    if (kind === 'canon') { const s2 = this.v.art.sprite('inf', col, 0, 40, 0); g.drawImage(s2.cv, 34 - s2.ax * (40 / s2.h), 60 - s2.ay * (40 / s2.h), s2.cv.width * 40 / s2.h, s2.cv.height * 40 / s2.h); }
    g.drawImage(sp.cv, 28 - sp.ax * sc, 60 - sp.ay * sc, sp.cv.width * sc, sp.cv.height * sc);
  }
  bindDock() {
    const dock = this.$('.bt-dock');
    let last = null;
    dock.addEventListener('dblclick', e => {
      const b = e.target.closest('[data-a="selunit"]');
      if (b) { const u = this.v.units.get(b.dataset.id); if (u) this.v.moveCam(u.x, u.y, Math.max(this.v.cam.z, 1.4), 500); }
    });
    // un double appui au doigt centre aussi la vue sur l'unité
    dock.addEventListener('pointerup', e => {
      const b = e.target.closest('[data-a="selunit"]');
      if (!b || e.pointerType === 'mouse') return;
      const now = performance.now();
      if (last && last.id === b.dataset.id && now - last.t < 350) { const u = this.v.units.get(b.dataset.id); if (u) this.v.moveCam(u.x, u.y, Math.max(this.v.cam.z, 1.4), 500); }
      last = { id: b.dataset.id, t: now };
    });
  }

  // ------------------------------------------------------------------ panneau de l'unité choisie
  selChanged() { this.inspected = null; this.dockSig = ''; this.renderDock(); this.renderPanel(true); this.situ(); }
  inspect(id) { this.inspected = id; if (id) { this.v.sel.clear(); this.dockSig = ''; this.renderDock(); } this.renderPanel(true); }
  renderPanel(force = false) {
    const v = this.v, p = this.$('.bt-panel');
    const us = [...v.sel].map(id => v.units.get(id)).filter(Boolean);
    const foe = this.inspected && v.units.get(this.inspected);
    if (!us.length && !foe) { p.hidden = true; this.panelSig = ''; this.el.classList.remove('has-panel'); return; }
    const deploy = v.st?.phase === 'deploiement';
    const sig = JSON.stringify([deploy, !!v.st?.accel, foe ? [foe.id, foe.men, foe.state, foe.form, foe._ghost] : us.map(u => [u.id, u.men, Math.round(u.morale), Math.round(u.fat ?? 0), u.ammo, u.state, u.form, u.fire, u.shot, u.prio, u.order, u.state === 'deroute' && !!u.halt]), v.controls.run, v.controls.targeting]);
    if (sig === this.panelSig && !force) return;
    this.panelSig = sig;
    p.hidden = false;
    this.el.classList.add('has-panel');
    if (foe) { p.innerHTML = this.foeHtml(foe); return; }
    const u = us[0], multi = us.length > 1, cls = multi ? (us.every(x => clsOf(x) === clsOf(u)) ? clsOf(u) : 'mix') : clsOf(u);
    let h = `<button class="bt-x" data-a="desel" aria-label="Fermer">${I.close}</button>`;
    if (multi) {
      const men = us.reduce((a, x) => a + x.men, 0);
      h += `<div class="bp-head"><div><div class="bp-t">${us.length} régiments</div><div class="bp-s">${fmt(men)} hommes · moral moyen ${Math.round(us.reduce((a, x) => a + (x.morale ?? 0), 0) / us.length)}</div></div></div>`;
    } else {
      const am = u.ammo0 ? `${fmt(u.ammo)} / ${fmt(u.ammo0)} ${clsOf(u) === 'artillerie' ? 'coups' : 'cartouches'}` : `${fmt(u.ammo ?? 100)} %`;
      const rg = u.range ? `portée max ${fmt(u.range[1])} m${u.range[2] ? `, mitraille ${fmt(u.range[2])} m` : ''}` : '';
      h += `<div class="bp-head"><canvas class="bp-fig" data-fig="${esc(u.id)}" width="56" height="64"></canvas><div><div class="bp-t">${esc(u.name)}</div>
        <div class="bp-s">${esc(TYPE_LABEL[u.type] || u.type)} · ${esc(FORM_LABEL[u.form] || u.form || '')} · <span class="bp-state ${u.state}">${esc(STATE_LABEL[u.state] || u.state || '')}</span>${u.order && ORDER_LABEL[u.order] && u.order !== 'hold' ? ` · ${esc(ORDER_LABEL[u.order])}` : ''}</div></div></div>
        <dl class="bp-kv two">
          <dt>Hommes</dt><dd>${fmt(u.men)} <small>/ ${fmt(u.men0 || u.men)}</small></dd>
          <dt>Expérience</dt><dd class="bp-stars">${'★'.repeat(stars(u.xp))}<i>${'★'.repeat(5 - stars(u.xp))}</i></dd>
          <dt>Moral</dt><dd><span class="bp-bar mor"><i style="width:${clamp(u.morale ?? 0, 0, 100)}%"></i></span></dd>
          <dt>Endurance</dt><dd><span class="bp-bar end"><i style="width:${clamp(100 - (u.fat ?? 0), 0, 100)}%"></i></span></dd>
          <dt>Munitions</dt><dd><span class="bp-bar amm"><i style="width:${this.ammoFrac(u) * 100}%"></i></span></dd>
          <dt>Portée</dt><dd>${u.range ? fmt(u.range[0]) + ' m' : '—'}</dd>
        </dl>
        <div class="bp-note">${am} · ${rg}</div>`;
    }
    // formations communes (pas pendant l'accéléré : ce sont vos officiers qui commandent)
    const forms = cls === 'mix' || v.st?.accel ? [] : FORMS[cls] || [];
    if (forms.length) h += `<div class="bp-row"><div class="bp-seg">${forms.map(f => `<button data-a="form" data-f="${f}" class="${us.every(x => x.form === f) ? 'on' : ''}" title="${esc(FORM_HELP[f])}">${esc(FORM_LABEL[f])}</button>`).join('')}</div></div>`;
    if (deploy) {
      h += `<div class="bp-row bp-btns"><button class="bt-btn" data-a="rot" data-r="-1">↺ Pivoter</button><button class="bt-btn" data-a="rot" data-r="1">Pivoter ↻</button></div>
        <p class="bp-help">Glissez le régiment pour le placer ; glissez depuis le sol pour fixer l'emplacement et l'orientation.</p>`;
    } else if (v.st?.accel) {
      h += `<p class="bp-help">Vos officiers commandent ce régiment. Touchez « Reprendre le commandement » pour lui donner vos ordres.</p>`;
    } else {
      const anyRout = us.some(x => x.state === 'deroute');
      // les ordres dépendent de l'arme : tir à volonté ou en salve, baïonnette, harcèlement, charge, projectile…
      const o = ordresHtml(us, { targeting: v.controls.targeting, run: v.controls.run });
      h += o.top;
      h += `<div class="bp-row bp-btns">${o.btns}
        <button class="bt-btn" data-a="rally" ${anyRout ? '' : 'disabled'}>Rallier</button>
        <button class="bt-btn danger" data-a="retreat">Retraite</button></div>`;
      const tip = aideArme(us);
      if (tip) h += `<p class="bp-help">${esc(tip)}</p>`;
      if (anyRout) h += `<p class="bp-help">${esc(this.rallyHint(us.filter(x => x.state === 'deroute')))}</p>`;
    }
    p.innerHTML = h;
    const c = p.querySelector('canvas[data-fig]');
    if (c) this.figure(c, u);
  }
  // troupes en déroute : elles ne se reforment qu'auprès du général (cercle doré), loin de l'ennemi
  rallyHint(rs) {
    const gen = this.v.mine().some(x => isGeneral(x) && x.rally);
    if (rs.length && rs.every(x => x.halt)) return gen ? 'Les fuyards se sont arrêtés : les officiers les reforment.' : 'Loin de l’ennemi, les officiers reforment les rangs.';
    if (gen) return rs.length > 1 ? 'En déroute : approchez le général pour les rallier (cercle doré), loin de l’ennemi, avant qu’elles ne quittent le terrain.'
      : 'En déroute : approchez le général pour la rallier (cercle doré), loin de l’ennemi, avant qu’elle ne quitte le terrain.';
    return 'En déroute, sans général pour les rallier : ces hommes ne s’arrêteront que loin de l’ennemi (ou dans les maisons d’une place).';
  }
  foeHtml(u) {
    const ghost = u._ghost;
    const est = Math.round(u.men / 50) * 50;
    return `<button class="bt-x" data-a="desel" aria-label="Fermer">${I.close}</button>
      <div class="bp-head"><canvas class="bp-fig" data-fig="${esc(u.id)}" width="56" height="64"></canvas><div><div class="bp-t">${esc(u.name || 'Troupe ennemie')}</div>
      <div class="bp-s">${esc(TYPE_LABEL[u.type] || u.type || '')} · ${ghost ? 'dernière position connue' : 'ennemi repéré'}</div></div></div>
      <dl class="bp-kv"><dt>Effectif</dt><dd>environ ${fmt(Math.max(est, 50))}</dd><dt>Formation</dt><dd>${esc(FORM_LABEL[u.form] || '—')}</dd><dt>État</dt><dd>${esc(STATE_LABEL[u.state] || '—')}</dd></dl>
      <p class="bp-help">Choisissez un de vos régiments, puis touchez cet ennemi pour l'attaquer.</p>`;
  }
  // ordre donné : un petit retour visuel et écrit
  ordered(kind, us, body) {
    if (kind === 'charge') this.toast(`${us.length > 1 ? 'Vos régiments chargent' : us[0].name + ' charge'} !`, 'good');
    else if (kind === 'volley_charge') this.toast(`${us.length > 1 ? 'Vos régiments donnent' : us[0].name + ' donne'} la salve, puis la baïonnette !`, 'good');
    this.dockSig = ''; this.renderPanel(true);
  }
  targetingChanged(kind) {
    const h = this.$('.bt-target-hint');
    h.hidden = !kind;
    if (kind) h.innerHTML = `${kind === 'vcharge' ? 'Touchez l’ennemi : salve, puis baïonnette' : "Touchez l'ennemi à charger"} <button class="bt-btn" data-a="untarget">Annuler</button>`;
  }
  act(a, d = {}) {
    const v = this.v, c = v.controls, us = c.mineSel();
    if (!us.length) return;
    if (a === 'form') {
      if (v.st?.phase === 'deploiement') {
        // chaque unité reste où elle est : une commande par unité
        for (const u of us) { u.form = d.f; u._pin = performance.now(); v.cmd('deploy', { units: [u.id], x: u.to?.x ?? u.x, y: u.to?.y ?? u.y, dir: u.dir, form: d.f }); }
        this.renderPanel(true);
      } else c.order('form', { form: d.f });
    }
    else if (a === 'fire') { const m = d.m || (us.every(u => u.fire === 'hold') ? 'free' : 'hold'); for (const u of us) u.fire = m; c.order('fire', { mode: m, fire: m }); this.renderPanel(true); }
    else if (a === 'shot') { for (const u of us) u.shot = d.m; c.order('shot', { mode: d.m }); this.renderPanel(true); }
    else if (a === 'counter') { const on = !us.every(u => u.prio === 'artillerie'); for (const u of us) u.prio = on ? 'artillerie' : null; c.order('counter', { mode: on ? 'on' : 'off' }); this.renderPanel(true); }
    else if (a === 'harass') c.order('harass');
    else if (a === 'cover') c.order('cover');
    else if (a === 'pursue') c.order('pursue');
    else if (a === 'gait') { c.run = !c.run; this.toast(c.run ? 'Prochains déplacements : à marche forcée.' : 'Prochains déplacements : au pas.'); this.renderPanel(true); }
    else if (a === 'vcharge') c.setTargeting(c.targeting === 'vcharge' ? null : 'vcharge');
    else if (a === 'hold') c.order('hold');
    else if (a === 'rally') c.order('rally');
    else if (a === 'retreat') c.order('retreat');
    else if (a === 'charge') {
      const tg = us.map(u => u.target).find(t => t != null && v.units.get(String(t)));
      if (tg != null && us.length === 1) c.order('charge', { target: tg });
      else c.setTargeting(c.targeting === 'charge' ? null : 'charge');
    } else if (a === 'rot') {
      for (const u of us) { u.dir += d.r * Math.PI / 4; u._pin = performance.now(); u.from = u.to = { x: u.x, y: u.y, dir: u.dir }; }
      for (const u of us) v.cmd('deploy', { units: [u.id], x: u.x, y: u.y, dir: u.dir });
    }
  }

  // ------------------------------------------------------------------ vitesse
  setSpeed(n) {
    const v = this.v;
    if (!v.st || v.st.phase !== 'combat') return;
    if (v.st.accel) { this.toast('Vos officiers mènent la bataille au plus vite : reprenez le commandement pour régler la vitesse.'); return; }
    v.st.speed = n;
    for (const bt of this.$('.bt-speed').children) bt.classList.toggle('on', +bt.dataset.v === n);
    v.cmd('speed', { v: n });
  }
  togglePause() { const s = this.v.st?.speed ?? 0; if (s) { this.lastSpeed = s; this.setSpeed(0); } else this.setSpeed(this.lastSpeed || 1); }

  // ------------------------------------------------------------------ clics
  click(e) {
    const b = e.target.closest('[data-a], .bt-speed button');
    if (!b) { if (e.target.classList.contains('bt-modal') && this.modal !== 'recap') this.closeModal(); return; }
    const v = this.v, a = b.dataset.a;
    if (!a && b.dataset.v != null) return this.setSpeed(+b.dataset.v);
    switch (a) {
      case 'selunit': {
        const id = b.dataset.id;
        if (e.shiftKey) { if (v.sel.has(id)) v.sel.delete(id); else v.sel.add(id); }
        else if (v.sel.size === 1 && v.sel.has(id)) v.sel.clear();
        else { v.sel.clear(); v.sel.add(id); const u = v.units.get(id); if (u && !v.onScreen(u)) v.moveCam(u.x, u.y, v.cam.z, 500); }
        this.selChanged(); break;
      }
      case 'selgroup': { const g = this.groups().find(x => String(x.k) === b.dataset.k); if (g) { v.sel = new Set(g.us.map(u => u.id)); this.selChanged(); } break; }
      case 'desel': v.sel.clear(); this.inspected = null; this.selChanged(); break;
      case 'form': this.act('form', { f: b.dataset.f }); break;
      case 'rot': this.act('rot', { r: +b.dataset.r }); break;
      case 'fire': case 'shot': this.act(a, { m: b.dataset.m }); break;
      case 'hold': case 'rally': case 'charge': case 'counter': case 'harass': case 'cover': case 'pursue': case 'gait': case 'vcharge': this.act(a); break;
      case 'retreat': this.confirm('Retraite', 'Les régiments choisis quittent le champ de bataille par votre bord. Ils reviennent en campagne avec leurs hommes.', 'Ordonner la retraite', () => this.act('retreat'), true); break;
      case 'untarget': v.controls.setTargeting(null); break;
      case 'engager': this.engage(); break;
      case 'couverts': v.showCover = v.showCover === false ? (v.st?.phase === 'deploiement' ? null : true) : false; b.classList.toggle('on', v.showCover !== false); break;
      case 'journal': this.journal(); break;
      case 'qualite': setQualite(b.dataset.q); this.journal(); break;
      case 'feedtog': this.setFeed(this.feedOff); break;
      case 'dscroll': { const d = this.$('.bt-dock'); d.scrollBy({ left: +b.dataset.d * d.clientWidth * 0.75, behavior: 'smooth' }); break; }
      case 'aide': this.tips(true); break;
      case 'decrocher': this.confirm('Décrocher ?', 'Toute l’armée rompt le combat et quitte le champ de bataille. L’ennemi reste maître du terrain ; vos blessés restent en arrière.', 'Décrocher', async () => {
        const r = await v.cmd('withdraw');
        if (!r.ok) return;
        // le décrochage se fait en marchant vers son bord : le temps doit tourner
        this.toast('L’armée décroche et quitte le champ de bataille…');
        if (!(v.st?.speed > 0) && !v.st?.accel) { v.st.phase = 'combat'; this.setSpeed(2); }
      }, true); break;
      case 'auto': this.confirm('Finir automatiquement ?', 'La suite de la bataille est jouée par vos officiers, en accéléré, avec les mêmes règles que si vous commandiez : vous la voyez défiler jusqu’à son issue, et vous pouvez reprendre le commandement à tout moment.', 'Finir automatiquement', async () => {
        const r = await v.cmd('autofinish');
        if (!r.ok) return;
        // (la prochaine réponse du serveur affiche le bandeau ; d'ici là, plus d'ordres)
        if (v.st) v.st.accel = true;
        v.sel.clear(); this.selChanged(); this.toast('Vos officiers prennent le commandement…');
      }); break;
      case 'reprendre': this.resume(); break;
      case 'close': this.closeModal(); break;
      case 'ok': { const f = this.onOk; this.closeModal(); f && f(); break; }
      case 'retour': this.closeModal(); v.onExit && v.onExit(this.result); break;
      case 'tipnext': this.tipStep(this.tipI + 1); break;
      case 'tipskip': this.tipStep(99); break;
      case 'tipok': this.$('.bt-tip').hidden = true; break;
    }
  }
  async resume() {
    const v = this.v, b = this.$('[data-a="reprendre"]');
    b.disabled = true;
    const r = await v.cmd('resume');
    b.disabled = false;
    if (!r.ok) return;
    // la bataille est en pause : le joueur voit où en sont les choses avant de donner ses ordres
    // (la prochaine réponse du serveur met à jour le reste : vitesses, bouton « Finir auto. »)
    if (v.st) { v.st.accel = false; v.st.speed = 0; }
    this.$('.bt-accel').hidden = true;
    this.el.classList.remove('accel');
    this.renderPanel(true);
    this.toast('Vous reprenez le commandement : la bataille est en pause.', 'good');
  }
  async engage() {
    const r = await this.v.cmd('start');
    if (r.ok) { this.v.showCover = false; this.v.sel.clear(); this.selChanged(); }
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
  confirm(title, text, okLabel, fn, danger = false) {
    this.onOk = fn;
    this.openModal('confirm', `<h2 class="bm-t">${esc(title)}</h2><p>${esc(text)}</p><div class="bm-btns"><button class="bt-btn" data-a="close">Continuer le combat</button><button class="bt-btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okLabel)}</button></div>`);
  }
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

  // ------------------------------------------------------------------ bulles d'aide
  tips(force = false) {
    let seen = false;
    try { seen = localStorage.getItem('conquete.bataille.aide') === '1'; } catch (e) { /* stockage indisponible */ }
    if (seen && !force) return;
    this.tipStep(0);
  }
  tipStep(i) {
    const deploy = this.v.st?.phase === 'deploiement';
    const steps = [
      ['.bt-deploy', deploy ? 'Glissez vos régiments dans la zone dorée. Les bois (vert) cachent et protègent, les hauteurs (or) voient loin et portent plus loin, le bâti (bleu) abrite.' : 'Vos troupes sont engagées : touchez un régiment pour le commander.'],
      ['.bt-dock', 'Touchez un régiment (sur le terrain ou ici) pour le choisir. Puis touchez le sol pour l’y envoyer, ou glissez depuis le régiment pour tracer sa route. Appui long puis glisser : plusieurs à la fois.'],
      ['.bt-mini', 'Pincez pour zoomer, glissez à deux doigts pour déplacer la vue. Touchez la mini-carte pour y aller. Sous elle : pause, ×1, ×2, ×4.'],
      ['.bt-acts', 'Le journal raconte la bataille. « Décrocher » sauve l’armée en lui faisant quitter le terrain ; « Finir auto. » confie la suite à vos officiers : elle se joue en accéléré sous vos yeux, avec les mêmes règles, et vous pouvez reprendre le commandement à tout moment.'],
    ];
    steps.splice(2, 0, ['.bt-dock', 'Une troupe en déroute fuit vers votre bord : elle ne se reforme qu’auprès de votre général (cercle doré), loin de l’ennemi. Allez la chercher avec l’état-major avant qu’elle ne quitte le terrain. Et gare à la mitraille : abordez les canons par le flanc.']);
    if (deploy) steps.push(['[data-a="engager"]', 'Quand tout le monde est en place : « Engager la bataille ».']);
    const tip = this.$('.bt-tip');
    this.tipI = i;
    if (i >= steps.length) { tip.hidden = true; try { localStorage.setItem('conquete.bataille.aide', '1'); } catch (e) { /* tant pis */ } return; }
    const [sel, txt] = steps[i];
    const anchor = this.$(sel);
    tip.innerHTML = `<p>${esc(txt)}</p><div class="bm-btns"><button class="bt-btn" data-a="tipskip">Passer</button><button class="bt-btn primary" data-a="tipnext">${i + 1 < steps.length ? 'Suivant' : 'Compris'}</button></div><span class="bt-tip-n">${i + 1} / ${steps.length}</span>`;
    tip.hidden = false;
    this.placeTip(anchor);
  }
  // la bulle près de l'élément visé, la flèche pointée sur lui (au milieu de l'écran sans élément visible)
  placeTip(anchor) {
    const tip = this.$('.bt-tip');
    const r = anchor && !anchor.hidden ? anchor.getBoundingClientRect() : null, R = this.el.getBoundingClientRect();
    const tw = Math.min(330, R.width - 24);
    tip.style.width = tw + 'px';
    if (r && r.width) {
      const below = r.top + r.height / 2 < R.height / 2;
      const x = clamp(r.left + r.width / 2 - R.left - tw / 2, 12, R.width - tw - 12);
      tip.style.left = x + 'px';
      tip.classList.toggle('up', below);
      if (below) { tip.style.top = (r.bottom - R.top + 12) + 'px'; tip.style.bottom = ''; }
      else { tip.style.bottom = (R.bottom - r.top + 12) + 'px'; tip.style.top = ''; }
      tip.style.setProperty('--ax', clamp(r.left + r.width / 2 - R.left - x, 20, tw - 20) + 'px');
    } else { tip.style.left = (R.width - tw) / 2 + 'px'; tip.style.top = '30%'; tip.style.bottom = ''; }
  }

  // bulles de situation, une fois chacune sur cet appareil : la première déroute, le premier canon sans munitions, le
  // premier régiment choisi de chaque arme (ses ordres propres) ; jamais par-dessus une autre bulle
  situ() {
    const v = this.v, tip = this.$('.bt-tip');
    if (v.st?.phase !== 'combat' || v.st.accel || !tip.hidden) return;
    let vues;
    try { vues = JSON.parse(localStorage.getItem(VUES) || '[]'); } catch (e) { return; }
    this.situVues = this.situVues || new Set();   // (si le stockage refuse d'écrire : une fois par bataille)
    vues.push(...this.situVues);
    const mine = v.mine(), sel = [...v.sel].map(id => v.units.get(id)).filter(Boolean);
    const cas = [
      ['deroute', '.bt-dock', mine.some(u => u.state === 'deroute')],
      ['munitions', '.bt-dock', mine.some(u => clsOf(u) === 'artillerie' && u.ammo != null && u.ammo <= 0)],
      sel.length === 1 && ['arme:' + arme(sel[0]), '.bt-panel', true],
    ];
    const c = cas.find(c => c && c[2] && SITU[c[0]] && !vues.includes(c[0]));
    if (!c) return;
    this.situVues.add(c[0]);
    try { localStorage.setItem(VUES, JSON.stringify([...vues, c[0]])); } catch (e) { /* tant pis : elle reviendra */ }
    tip.innerHTML = `<p>${esc(SITU[c[0]])}</p><div class="bm-btns"><button class="bt-btn primary" data-a="tipok">Compris</button></div>`;
    tip.hidden = false;
    this.placeTip(this.$(c[1]));
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
    const z = v.st?.zone;
    if (z && v.st.phase === 'deploiement') { g.strokeStyle = 'rgba(255,226,150,0.9)'; g.lineWidth = dpr; g.strokeRect(z[0] * sx, z[1] * sy, (z[2] - z[0]) * sx, (z[3] - z[1]) * sy); }
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
    // la part du terrain que montre la vue : un trapèze (la caméra est inclinée et peut tourner)
    const pts = [[0, 0], [v.vw, 0], [v.vw, v.vh], [0, v.vh]].map(([x, y]) => v.toWorld(x, y));
    g.strokeStyle = 'rgba(255,248,230,0.95)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)); g.closePath(); g.stroke();
  }
}
// nom court pour les cartes d'unités : abréviations d'état-major pour les mots longs
const ABBR = [[/^Chariot de munitions.*/i, 'Munitions'], [/^Batterie /, 'Bie '], [/ de ligne$/, ' ligne'], [/chasseurs à cheval/i, 'ch. à cheval'], [/grenadiers?/i, 'Gren.'],
  [/cavalerie/i, 'Cav.'], [/artillerie/i, 'Art.'], [/chasseurs?/i, 'Chass.'], [/voltigeurs?/i, 'Volt.'], [/Miquelets?/, 'Miq.'],
  [/Sapeurs?/, 'Sap.'], [/Garde nationale/, 'Garde nat.'], [/Territoriale/, 'Territ.'], [/réunis$/, 'réun.']];
const short = n => ABBR.reduce((t, [re, by]) => (t.length > 11 ? t.replace(re, by) : t), String(n || ''));
// heure de bataille (secondes depuis 8 h) écrite comme le serveur : « 20 h 30 »
const hourOf = c => { const m = Math.floor(480 + c / 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
