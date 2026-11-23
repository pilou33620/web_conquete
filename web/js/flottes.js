// Les flottes côté page (SPEC-EMPIRE, module 2, page P2) : la sélection d'une flotte sur la carte, sa fenêtre
// (composition, coque, amiral, ordres), le chantier naval d'une place portuaire, et la bataille navale par stratégie
// (choix dans la fenêtre des batailles, strategie.js, puis la scène jouée par phases). Les navires sont dessinés par
// graphismes/rendu/marine.js (via hex/marine.js) ; ici, rien que du HTML et l'anneau de sélection en 2D.
// Contrat du moteur : state.flottes, state.blocus, batailles `naval: true` ; commandes {cmd: "flotte", sub, …}.
// Commerce maritime (module 7, page P3) : comptoirs, course, traversées dans la fenêtre de flotte ; le panneau « Commerce
// maritime » (fenêtre Commerce : marché des denrées, revenus `me.mer`, routes, flottes en mer). Contrat : state.comptoirs,
// routes_mer, marche, en_mer, me.mer ; rules.denrees.
import { esc } from './battle/formes.js';
import { ICON } from './icons.js';
import { partTour } from './map.js';
import * as BT from './strategie.js';

const fmt = n => (Math.round(n) || 0).toLocaleString('fr-FR');
const fmt1 = n => ((Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10) || 0).toLocaleString('fr-FR');
const COUPEE = { blocus: 'coupée par un blocus', ennemi: 'coupée par une flotte ennemie', corsaire: 'coupée par un corsaire' };
const PORTS = ['', 'port de commerce', 'chantier naval', 'arsenal de marine'];   // (marine.rs peut_construire)
const ORDRE = { '': 'Aucun ordre', blocus: 'Blocus', commerce: 'Commerce', corsaire: 'Course (corsaire)', route: 'En route vers un autre théâtre' };
// la scène de la bataille navale : durée de chaque phase (ms)
const SCENE = [['approche', 3500], ['bordees', 5000], ['abordage', 4000], ['fin', 2500]];

export class Flottes {
  constructor(ui) {
    this.ui = ui;
    this.vise = null;    // ordre qui attend un toucher sur la carte : { id, mode: 'voile' | 'blocus' | 'debarquer' }
    this.scene = null;   // bataille navale montrée : { bid, b (sa vue), ev (sa fin), k (phase), t }
    this.prix = {};      // denrée → { prix, avant } : le prix du marché au dernier état et celui d'avant son dernier changement
  }
  get st() { return this.ui.st; }
  get R() { return this.ui.rules; }
  liste() { return this.st?.flottes || []; }
  get(id) { return this.liste().find(f => f.id === id); }
  mienne(f) { return f && f.proprio === this.st.me.code; }
  pos(id) { const f = this.get(id); return f ? this.ou(f) : null; }
  // la flotte sur la carte : là où le plateau pose ses navires, sinon au centre de sa case
  ou(f) { return (this.ui.map.hex && this.marine?.lieu(f.case[0], f.case[1])) || [f.case[0] + 0.5, f.case[1] + 0.5]; }
  cmd(sub, body, toast = true) { return this.ui.cmd({ cmd: 'flotte', sub, ...body }, toast); }
  nb(f) { return Object.values(f.navires || {}).reduce((s, n) => s + n, 0); }
  nomPlace(id) { return this.ui.md.nodes[id]?.name || ''; }

  // ------------------------------------------------------------------ carte (map.js hitTest, draw)
  touche(sx, sy, pad) {
    let best = null;
    for (const f of this.liste()) {
      const [x, y] = this.ui.map.toScreen(...this.ou(f)), d = Math.hypot(sx - x, sy - y);
      if (d < 24 + pad && (!best || d < best.d)) best = { kind: 'flotte', id: f.id, d };
    }
    return best;
  }
  // l'anneau de la flotte choisie et sa route ; sans plateau 3D (carte de secours), une pastille par flotte
  dessin(ctx) {
    const m = this.ui.map, s = this.ui.sel, sel = s?.kind === 'flotte' && !this.marine?.masque.has(s.id) ? this.get(s.id) : null;
    if (!m.hex) for (const f of this.liste()) {
      const [x, y] = m.toScreen(f.case[0] + 0.5, f.case[1] + 0.5);
      ctx.fillStyle = m.colors[f.proprio] || '#888'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 18, y - 9, 36, 18, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚓ ' + this.nb(f), x, y + 1);
    }
    if (!sel) return;
    const [x, y] = m.toScreen(...this.ou(sel));
    ctx.save();
    if (sel.chemin?.length) {
      ctx.strokeStyle = 'rgba(243,217,142,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (const [cx, cy] of sel.chemin) ctx.lineTo(...m.toScreen(cx + 0.5, cy + 0.5));
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(x, y, 30, 15, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ ordres par toucher (ui.onTap)
  viser(id, mode, msg) {
    this.vise = { id, mode };
    this.ui.targeting = 'flotte';
    this.ui.map.cv.classList.add('targeting');
    this.ui.toast(msg);
  }
  // rend vrai si le toucher était pour une flotte : un ordre visé, ou la mer touchée avec une de nos flottes choisie
  tap(e) {
    const v = this.vise, s = this.ui.sel;
    if (v) {
      this.ui.stopTargeting();
      const node = e.hit?.kind === 'node' ? e.hit.id : null;
      if (v.mode === 'blocus') {
        if (node == null) this.ui.toast('Touchez un port ennemi.', 'bad');
        else this.cmd('ordre', { flotte: v.id, ordre: 'blocus', node });
      } else if (v.mode === 'debarquer') this.cmd('debarquer', { flotte: v.id, x: e.x, y: e.y });
      else this.cmd('deplacer', node != null ? { flotte: v.id, node } : { flotte: v.id, x: e.x, y: e.y });
      return true;
    }
    const f = s?.kind === 'flotte' ? this.get(s.id) : null;
    if (!this.mienne(f) || f.bataille || e.hit || !(e.x >= 0 && e.y >= 0 && e.x < this.ui.md.W && e.y < this.ui.md.H)) return false;
    if (this.ui.map.terrain[Math.floor(e.y) * this.ui.md.W + Math.floor(e.x)] > 1) return false;   // (la terre : la sélection ordinaire)
    this.cmd('deplacer', { flotte: f.id, x: e.x, y: e.y });
    return true;
  }

  // ------------------------------------------------------------------ fenêtre de la flotte (ui.renderPanel)
  panneau(id) {
    const f = this.get(id);
    if (!f) return this.enMerHtml(id);
    const R = this.R, st = this.st, own = this.mienne(f), fac = R.factions[f.proprio] || {}, N = R.navires || {};
    const ou = f.bataille ? 'Engagée dans une bataille navale' : f.ordre === 'route' ? ORDRE.route : f.chemin?.length ? `En mer, ${f.chemin.length} ${f.chemin.length > 1 ? 'cases' : 'case'} à parcourir`
      : f.a_quai != null ? `À quai à ${esc(this.nomPlace(f.a_quai))}` : 'Au mouillage';
    let h = `<div class="p-head">${ICON.anchor.replace('<svg', `<svg style="width:32px;height:32px;color:${fac.color || '#ccc'}"`)}<div><div class="p-title">Flotte</div>
      <div class="p-sub">${esc(BT.nomCamp(this.ui.ctxBt(), f.proprio))}, ${this.nb(f)} ${this.nb(f) > 1 ? 'navires' : 'navire'}, coque ${Math.round((f.pv ?? 1) * 100)} %</div></div></div><div class="p-state">${ou}</div>`;
    // composition : une ligne par type (canons, coque, vitesse, transport)
    const types = (R.navire_ordre || Object.keys(f.navires)).filter(t => f.navires[t] > 0);
    h += `<div class="section-t">Composition</div><table class="grid fl-compo"><thead><tr><th>Navire</th><th>Nb</th><th>Canons</th><th>Coque</th><th>Transport</th></tr></thead><tbody>${types.map(t => {
      const n = N[t] || {};
      return `<tr title="${esc(n.desc || '')}"><td>${esc(n.nom || t)}</td><td>${f.navires[t]}</td><td>${fmt(n.canons)}</td><td>${fmt(n.coque)}</td><td>${n.transport ? fmt(n.transport) + ' h.' : '—'}</td></tr>`;
    }).join('')}</tbody></table><div class="bar ${f.pv < 0.5 ? 'red' : ''}" title="Coque"><i style="width:${Math.round((f.pv ?? 1) * 100)}%"></i></div>`;
    if (!own) {
      h += f.armee ? `<p class="small">Une armée à bord : ${fmt(f.armee.effectif)} hommes.</p>` : '';
      h += f.ordre ? `<p class="small">Ordre : ${esc(ORDRE[f.ordre] || f.ordre)}.</p>` : '';
      return [h, JSON.stringify(f)];
    }
    const am = f.amiral;
    h += `<dl class="kv"><dt>Amiral</dt><dd>${am ? esc(`${am.rank || ''} ${am.name || ''}`.trim()) : 'aucun'}</dd>
      <dt>Vitesse</dt><dd>${String(f.vitesse ?? '?').replace('.', ',')} cases par jour</dd>
      ${f.mp != null ? `<dt>Jours de mer</dt><dd>encore ${String(f.mp).replace('.', ',')} ce tour</dd>` : ''}
      <dt>Capacité</dt><dd>${fmt(f.capacite)} hommes</dd>
      <dt>Ordre</dt><dd>${esc(ORDRE[f.ordre] || f.ordre)}${f.ordre === 'blocus' && f.cible != null ? ` : ${esc(this.nomPlace(f.cible))}` : f.cible ? ` : ${esc(this.nomCible(f))}` : ''}</dd></dl>`;
    if (f.bataille) return [h, JSON.stringify(f)];
    const me = st.me.code, b = [];
    // armée à bord, armées qui attendent au quai
    if (f.armee) {
      h += `<div class="section-t">Armée à bord</div><p class="small">${fmt(f.armee.effectif)} hommes.</p>`;
      b.push(`<button class="btn" data-act="fl-debarquer" data-id="${esc(f.id)}">Débarquer${f.a_quai != null ? ' au quai' : ' sur la côte proche'}</button>`,
        `<button class="btn" data-act="fl-viser" data-id="${esc(f.id)}" data-v="debarquer">Débarquer sur une côte…</button>`);
    } else if (f.a_quai != null) {
      for (const a of st.armies.filter(a => a.o === me && a.n === f.a_quai && a.st === 'idle'))
        b.push(`<button class="btn" data-act="fl-embarquer" data-id="${esc(f.id)}" data-v="${esc(a.id)}" ${a.men > f.capacite ? `disabled title="Trop d’hommes : ${fmt(a.men)} pour ${fmt(f.capacite)} places"` : ''}>Embarquer ${esc(a.name)}<small>${fmt(a.men)} hommes</small></button>`);
    }
    // ordres
    b.push(`<button class="btn primary" data-act="fl-viser" data-id="${esc(f.id)}" data-v="voile">Faire voile…<small>touchez la mer ou un port</small></button>`,
      `<button class="btn" data-act="fl-viser" data-id="${esc(f.id)}" data-v="blocus">Bloquer un port ennemi…</button>`);
    // course : contre tout camp vivant qui n'est ni allié ni vassal (sans guerre déclarée : incidents)
    const proies = st.factions.filter(x => x.code !== me && x.alive && x.st !== 'alliance' && x.over !== me), armes = types.some(t => t !== 'flute');
    b.push(`<label class="fl-sel">Course contre <select data-fl-ordre="corsaire" data-id="${esc(f.id)}" ${armes ? '' : 'disabled title="Des flûtes ne font pas la course : il faut des navires armés"'}><option value="">un camp…</option>${proies.map(x => `<option value="${esc(x.code)}">${esc(R.factions[x.code]?.name || x.code)}${x.st === 'guerre' ? ' (en guerre)' : ''}</option>`).join('')}</select></label>`);
    const routes = this.routesDe(f);
    if (routes.length) b.push(`<label class="fl-sel">Route <select data-fl-ordre="route" data-id="${esc(f.id)}"><option value="">vers un autre théâtre…</option>${routes.map(r => `<option value="${esc(r.id)}">${esc(r.nom)} (${r.tours} ${r.tours > 1 ? 'tours' : 'tour'} en mer)</option>`).join('')}</select></label>`);
    if (f.ordre) b.push(`<button class="btn" data-act="fl-ordre" data-id="${esc(f.id)}" data-v="">Lever l’ordre</button>`);
    // fusionner, séparer
    for (const o of this.liste().filter(o => o.id !== f.id && this.mienne(o) && o.case[0] === f.case[0] && o.case[1] === f.case[1]))
      b.push(`<button class="btn" data-act="fl-fusionner" data-id="${esc(f.id)}" data-v="${esc(o.id)}">Fusionner avec la flotte voisine<small>${this.nb(o)} navires</small></button>`);
    if (this.nb(f) > 1) for (const t of types) b.push(`<button class="btn" data-act="fl-separer" data-id="${esc(f.id)}" data-v="${esc(t)}">Détacher : ${esc(N[t]?.nom || t)}</button>`);
    h += `<div class="section-t">Ordres</div><div class="btns">${b.join('')}</div>
      <p class="muted small">La course pille les routes commerciales du camp visé sans guerre déclarée ; contre un camp en paix, chaque mois de pillage risque un incident diplomatique : sa relation baisse et il tient un casus belli contre vous.${f.ordre === 'route' ? ' La flotte prend la mer en atteignant la balise ; pendant la traversée, elle ne reçoit pas d’ordre.' : ''}</p>
      ${this.comptoirsHtml(f, types)}
      <div class="btns"><button class="btn" data-act="center">Centrer la carte</button></div>`;
    return [h, JSON.stringify([f, st.comptoirs, st.marche]) + st.armies.filter(a => a.n === f.a_quai).length];
  }
  // la fenêtre d'une flotte en traversée (state.en_mer) : hors de la carte, sans ordre jusqu'à l'arrivée
  enMerHtml(id) {
    const e = (this.st.en_mer || []).find(x => x.id === id);
    if (!e) return [null, ''];
    const fac = this.R.factions[e.proprio] || {}, n = this.nb(e);
    return [`<div class="p-head">${ICON.anchor.replace('<svg', `<svg style="width:32px;height:32px;color:${fac.color || '#ccc'}"`)}<div><div class="p-title">Flotte</div>
      <div class="p-sub">${esc(BT.nomCamp(this.ui.ctxBt(), e.proprio))}, ${n} ${n > 1 ? 'navires' : 'navire'}</div></div></div>
      <div class="p-state">En mer, arrivée ${this.arriveeTxt(e)}</div>
      <p class="small">${esc(this.route(e.route)?.nom || 'Traversée')} : ${esc(BT.naviresTxt(this.ui.ctxBt(), e.navires))}${e.armee ? `, ${fmt(e.armee.effectif)} hommes à bord` : ''}.</p>
      <p class="muted small">Pendant la traversée, la flotte ne reçoit pas d’ordre ; personne ne la voit ni ne la combat. Elle reparaît au bout de sa route, sans ordre, l’armée à bord.</p>`, JSON.stringify(e)];
  }
  arriveeTxt(e) { return `${e.arrivee > 1 ? `dans ${e.arrivee} tours` : e.arrivee === 1 ? 'au prochain tour' : 'ce tour'} (${e.date})`; }
  // les comptoirs du théâtre de la flotte : denrée et son prix, places prises (par qui), disputé ; « Commercer » y mène
  // la flotte (des flûtes exigées)
  comptoirsHtml(f, types) {
    const st = this.st, t = this.theatreDe(f.case);
    const l = (st.comptoirs || []).filter(c => !t || this.dans(t, c.case));
    if (!l.length) return '';
    const flutes = types.includes('flute'), D = this.R.denrees || {};
    const rows = l.map(c => {
      const px = st.marche?.[c.denree]?.prix, libres = c.places - c.navires.length, ici = f.ordre === 'commerce' && f.cible === c.id;
      const qui = c.navires.map(n => `<i class="fl-pav" style="background:${this.ui.map.colors[n.proprio] || '#888'}" title="${esc(this.R.factions[n.proprio]?.name || n.proprio)}"></i>`).join('');
      return `<tr><td>${esc(c.nom)}</td><td>${esc(D[c.denree]?.nom || c.denree)}${px != null ? ` <span class="muted small">${fmt1(this.ui.per(px))} l.</span>` : ''}</td>
        <td>${c.dispute ? '<span class="chip war">disputé</span>' : `${qui}${libres > 0 ? ` ${libres} libre${libres > 1 ? 's' : ''}` : ' complet'}`}</td>
        <td>${ici ? '<span class="chip ally">en cours</span>' : `<button class="btn" data-act="fl-commerce" data-id="${esc(f.id)}" data-v="${esc(c.id)}" ${flutes ? '' : 'disabled title="Il faut des flûtes pour commercer"'}>Commercer</button>`}</td></tr>`;
    }).join('');
    return `<div class="section-t">Comptoirs${t ? ` · ${esc(t.nom)}` : ''}</div><div class="tbl-wrap"><table class="grid fl-compo"><thead><tr><th>Comptoir</th><th>Denrée, prix</th><th>Places</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">Chaque flûte d’une flotte au comptoir vend une unité de sa denrée au prix du marché mondial (livres ${this.ui.perU === '/tour' ? 'par tour' : 'par jour'}, 4 flûtes au plus) ; trois flottes par comptoir.</p>`;
  }
  nomCible(f) {
    if (f.ordre === 'commerce') return (this.ui.md.comptoirs || []).find(c => c.id === f.cible)?.nom || f.cible;
    if (f.ordre === 'corsaire') return this.R.factions[f.cible]?.name || f.cible;
    const r = this.route(f.route);
    return r ? `${r.nom} (${r.tours} ${r.tours > 1 ? 'tours' : 'tour'} en mer)` : f.route || f.cible;
  }
  route(id) { return (this.ui.md.routes_mer || []).find(r => r.id === id); }
  // les théâtres de la carte Monde (cadres en cases)
  dans(t, [x, y]) { return x >= t.cadre[0] && y >= t.cadre[1] && x < t.cadre[0] + t.cadre[2] && y < t.cadre[1] + t.cadre[3]; }
  theatreDe(c) { return (this.ui.md.theatres || []).find(t => this.dans(t, c)); }
  // les routes maritimes qui partent du théâtre de la flotte (carte Monde)
  routesDe(f) {
    const t = this.theatreDe(f.case);
    return t ? (this.ui.md.routes_mer || []).filter(r => this.dans(t, r.de)) : [];
  }

  // ------------------------------------------------------------------ commerce maritime (fenêtre Commerce, ui.commerceModal)
  // à chaque état : le prix d'avant de chaque denrée (la flèche de tendance)
  majPrix(st) {
    for (const [d, m] of Object.entries(st.marche || {})) {
      const p = this.prix[d];
      if (!p) this.prix[d] = { prix: m.prix, avant: m.prix };
      else if (Math.abs(p.prix - m.prix) > 1e-6) { p.avant = p.prix; p.prix = m.prix; }
    }
  }
  // le panneau : marché mondial des denrées, revenus, routes commerciales du joueur (cadrer la carte dessus), flottes en mer
  commerceHtml() {
    const st = this.st, R = this.R, me = st.me.code, mer = st.me.mer || {}, D = R.denrees || {}, per = v => fmt1(this.ui.per(v)), u = this.ui.perU;
    const routes = (st.routes_mer || []).filter(r => r.proprio === me || r.partenaire === me), enMer = st.en_mer || [];
    if (!(st.comptoirs || []).length && !routes.length && !enMer.length && !Object.values(mer).some(v => v > 0)) return ['', ''];
    const fn = c => esc(R.factions[c]?.name || c), place = id => esc(this.nomPlace(id));
    const fl = d => { const p = this.prix[d]; return !p || Math.abs(p.prix - p.avant) < 1e-3 ? '' : p.prix > p.avant ? ' <span class="fl-hausse" title="En hausse">▲</span>' : ' <span class="fl-baisse" title="En baisse">▼</span>'; };
    const marche = Object.entries(st.marche || {}).map(([d, m]) => `<tr><td>${esc(D[d]?.nom || d)}</td><td>${per(m.prix)}${fl(d)}</td><td>${fmt1(m.offre)}</td><td>${fmt1(m.demande)}</td></tr>`).join('');
    const total = ['plantations', 'comptoirs', 'routes', 'corsaires'].reduce((s, k) => s + (mer[k] || 0), 0);
    const rts = routes.map(r => {
      const autre = r.proprio === me ? r.partenaire : r.proprio;
      return `<tr><td>${place(r.de)} – ${place(r.vers)}<div class="muted small">avec ${fn(autre)}</div></td><td>${per(r.valeur)}</td>
        <td>${r.coupee ? `<span class="chip war">${COUPEE[r.coupee] || 'coupée'}</span>` : '<span class="chip ally">ouverte</span>'}</td>
        <td><button class="btn" data-act="fl-cadrer" data-v="${esc(r.id)}">Voir</button></td></tr>`;
    }).join('');
    const flottes = enMer.map(e => `<li>${e.proprio === me ? '' : `${fn(e.proprio)} : `}${esc(BT.naviresTxt(this.ui.ctxBt(), e.navires))}${e.armee ? `, ${fmt(e.armee.effectif)} hommes à bord` : ''} —
      ${esc(this.route(e.route)?.nom || 'traversée')} : en mer, arrivée ${esc(this.arriveeTxt(e))} <button class="btn" data-act="fl-voir" data-v="${esc(e.id)}">Fenêtre</button></li>`).join('');
    const html = `<h3 class="section-t">Commerce maritime</h3>
      <p class="small">Revenu de la mer : <b>+${per(total)} livres ${u}</b> (déjà compté dans le commerce) — plantations +${per(mer.plantations || 0)}, comptoirs +${per(mer.comptoirs || 0)}, routes +${per(mer.routes || 0)}, corsaires +${per(mer.corsaires || 0)}.</p>
      <div class="two"><div>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>Denrée</th><th>Prix mondial</th><th>Offre</th><th>Demande</th></tr></thead><tbody>${marche}</tbody></table></div>
        <p class="muted small">Prix en livres ${u} pour une unité vendue ; il baisse quand l’offre dépasse la demande (plantations et comptoirs du monde entier).</p>
      </div><div>
        <h4 class="small" style="margin:0 0 4px">Vos routes commerciales</h4>
        ${rts ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Route</th><th>Valeur ${u}</th><th>État</th><th></th></tr></thead><tbody>${rts}</tbody></table></div>` : '<p class="muted small">Aucune : un accord commercial avec un camp qui a un port de mer ouvre une route entre vos deux ports.</p>'}
        <h4 class="small" style="margin:10px 0 4px">Flottes en mer</h4>
        ${flottes ? `<ul class="small">${flottes}</ul>` : '<p class="muted small">Aucune flotte en traversée.</p>'}
      </div></div>`;
    return [html, JSON.stringify([st.marche, mer, routes.map(r => [r.id, r.valeur, r.coupee]), enMer.map(e => [e.id, e.arrivee]), Object.values(this.prix)])];
  }
  // cadre la carte sur une route commerciale (et ferme la fenêtre pour la montrer)
  cadrer(id) {
    const ch = (this.st.routes_mer || []).find(r => r.id === id)?.chemin;
    if (!ch?.length) return;
    const m = this.ui.map, xs = ch.map(p => p[0]), ys = ch.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    m.moveTo((x0 + x1) / 2 + 0.5, (y0 + y1) / 2 + 0.5, Math.min(m.vw / ((x1 - x0 + 4) * 1.3), m.vh / ((y1 - y0 + 4) * 1.3 * (m.K || 1))));
    this.ui.closeModal();
  }

  // ------------------------------------------------------------------ chantier naval (ui.nodePanel, place portuaire à soi)
  chantierHtml(id, gn, ns) {
    const R = this.R, N = R.navires;
    if (!N || !(gn.spec || []).includes('port')) return '';
    const lv = (ns.sl || []).find(s => s[0] === 'port')?.[1] || 0, q = ns.q || [], techs = this.st.me.techs;
    const btns = (R.navire_ordre || Object.keys(N)).map(t => {
      const n = N[t], tech = n.tech && !techs.includes(n.tech) ? R.techs?.find?.(x => x.id === n.tech)?.name || n.tech : null;
      if (tech && n.port > 2) return '';   // (les navires d'une autre ère : seulement quand on s'en approche)
      const why = lv < n.port ? `Il faut un ${PORTS[n.port]} dans la place (chaîne « port »)` : tech ? `Il faut la découverte « ${tech} »`
        : ns.sg ? 'La place est assiégée' : q.length >= 4 ? 'File de production pleine (4 maximum)' : !this.ui.canPay(n.cout) ? 'Ressources insuffisantes' : '';
      return `<button class="btn unit-card" data-act="fl-construire" data-v="${esc(t)}" ${why ? 'disabled' : ''} title="${esc(why || n.desc || '')}">
        ${ICON.anchor}<span class="un">${esc(n.nom)} <span class="muted" style="font-weight:400">(${n.canons} canons)</span></span>
        <span class="uc">${this.ui.costHtml(n.cout)}, ${partTour(n.jours)}${why ? ` — ${esc(why)}` : ''}</span></button>`;
    }).join('');
    return `<div class="section-t">Chantier naval${lv ? '' : ' <span class="muted small">(bâtissez d’abord un port)</span>'}</div><div class="units-grid">${btns}</div>`;
  }

  // ------------------------------------------------------------------ actions (ui.action, data-act="fl-…")
  action(act, d) {
    const id = d.id;
    switch (act) {
      case 'fl-construire': this.cmd('construire', { node: this.ui.sel.id, type: d.v }); break;
      case 'fl-viser': this.viser(id, d.v, { voile: 'Touchez la mer, ou un port où mouiller.', blocus: 'Touchez le port ennemi à bloquer.', debarquer: 'Touchez la côte où débarquer.' }[d.v]); break;
      case 'fl-debarquer': this.cmd('debarquer', { flotte: id }); break;
      case 'fl-embarquer': this.cmd('embarquer', { flotte: id, army: d.v }); break;
      case 'fl-fusionner': this.cmd('fusionner', { flotte: id, autre: d.v }); break;
      case 'fl-separer': this.cmd('separer', { flotte: id, navires: { [d.v]: 1 } }, false).then(r => { if (r.ok && r.id) this.ui.select({ kind: 'flotte', id: r.id }); }); break;
      case 'fl-ordre': this.cmd('ordre', { flotte: id, ordre: d.v }); break;
      case 'fl-commerce': this.cmd('ordre', { flotte: id, ordre: 'commerce', cible: d.v }); break;
      case 'fl-cadrer': this.cadrer(d.v); break;
      case 'fl-voir': this.ui.closeModal(); this.ui.select({ kind: 'flotte', id: d.v }); break;
      case 'fl-passer': this.finir(); break;
      default: return false;
    }
    return true;
  }
  // les listes déroulantes d'ordres (commerce, corsaire, route)
  choix(el) {
    const o = el.dataset.flOrdre;
    if (!el.value) return;
    this.cmd('ordre', { flotte: el.dataset.id, ordre: o, ...(o === 'route' ? { route: el.value } : { cible: el.value }) });
  }

  // ------------------------------------------------------------------ bataille navale
  get marine() { return this.ui.map.plateau?.marine || null; }
  // à chaque état : une bataille navale qui attend le joueur se prépare à l'écran (caméra, flottes cachées, approche)
  majBataille(st) {
    const b = (st.navales || []).find(x => x.mode === 'attente');
    if (!b && this.scene && !this.scene.ev && !this.ui.btSuivies.has(String(this.scene.bid))) {   // (réglée sans nous : on range la scène)
      this.scene = null; this.marine?.scene(null); this.marine?.cacher([]);
    }
    if (!b || this.scene?.ev) return;
    const mar = this.marine, neuf = this.scene?.bid !== b.id;
    this.scene = { bid: b.id, b };
    // (de près : un hexagone du plateau, 4 cases, fait 70 px ; la scène un peu au-dessus du centre, la fenêtre de la scène
    // se pose en bas)
    if (neuf) { const m = this.ui.map, z = 30; m.moveTo(b.x, b.y + m.vh * 0.16 / (z * m.K), z); }
    if (!mar) return;
    mar.ignorer.add(String(b.id));
    if (neuf) mar.cacher(b.sides.flatMap(s => s.flottes || []));
    mar.scene(this.etape(b, 'approche'));
  }
  etape(b, phase, ev = null, k = 0) {
    // coulés et pris cumulés jusqu'à cette phase (journal : navires perdus par phase), le total à la fin
    const cumul = i => Math.min(ev?.coules?.[i] || 0, (ev?.journal || []).filter(j => SCENE.findIndex(s => s[0] === j.ph) <= k).reduce((s, j) => s + (j.l?.[i] || 0), 0));
    return { x: b.x, y: b.y, phase, vent: b.vent, camps: b.sides.map(s => ({ o: s.o, navires: s.navires })),
      coules: ev ? [0, 1].map(i => phase === 'fin' ? ev.coules?.[i] || 0 : cumul(i)) : [0, 0], pris: ev && k >= 2 ? ev.pris || [0, 0] : [0, 0] };
  }
  // la fin d'une bataille navale suivie par le joueur (battle_end) : la scène par phases, puis le résultat
  fin(ev) {
    const sc = this.scene?.bid === ev.bid ? this.scene : null;
    if (!sc || !this.marine || !this.ui.map.ambient?.on) { this.scene = null; this.marine?.cacher([]); this.ui.finBt = ev; return; }
    sc.ev = ev; sc.k = -1;
    this.suivante();
    this.ui.openModal('navale');
  }
  suivante() {
    const sc = this.scene;
    if (!sc) return;
    sc.k++;
    if (sc.k >= SCENE.length) { this.finir(); return; }
    const [ph, ms] = SCENE[sc.k];
    this.marine.scene(this.etape(sc.b, ph, sc.ev, sc.k));
    clearTimeout(sc.t); sc.t = setTimeout(() => this.suivante(), ms);
    if (this.ui.modal === 'navale') this.ui.renderModal(true);
  }
  finir() {
    const sc = this.scene;
    if (!sc) return;
    clearTimeout(sc.t);
    this.scene = null;
    this.marine?.scene(null);
    this.marine?.cacher([]);
    this.ui.finBt = sc.ev;
    if (this.ui.modal === 'navale') this.ui.closeModal();
  }
  // la fenêtre de la scène (posée en bas, la mer reste visible)
  sceneHtml() {
    const sc = this.scene;
    if (!sc?.ev) return ['<p class="muted">Aucune bataille navale en cours.</p>', 'none'];
    const C = this.ui.ctxBt(), ph = SCENE[Math.min(sc.k, SCENE.length - 1)][0], ev = sc.ev;
    const journal = (ev.journal || []).filter(j => SCENE.findIndex(s => s[0] === j.ph) <= sc.k);
    return [`<h2 class="m-title" id="m-title">Bataille navale — ${esc(BT.PHASES_NAV[ph])}</h2>
      <p class="m-sub">${b2(C, sc.b)}</p>${BT.journalHtml(C, journal, [], [ev.a, ev.d])}
      <div class="btns"><button class="btn" data-act="fl-passer">Passer au résultat</button></div>`, sc.bid + '|' + sc.k];
  }
}
// les deux flottes face à face : « France : 2 frégates contre Grande-Bretagne : 1 vaisseau de ligne »
const b2 = (C, b) => b.sides.map(s => `${esc(BT.nomCamp(C, s.o))} : ${esc(BT.naviresTxt(C, s.navires))}`).join(' contre ');
