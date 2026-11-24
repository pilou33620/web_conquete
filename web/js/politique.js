// La politique intérieure côté page (SPEC-POLITIQUE, module 5, page P9) : la fenêtre « Gouvernement » (régime, cabinet de
// ministres à nommer ou renvoyer, noblesse et peuple avec leur mécontentement, ses raisons et l'impôt de chaque classe),
// l'alerte d'une révolution (bouton du rail en rouge), le contexte d'une révolution ou d'une guerre civile dans la fenêtre
// des décisions (un seul chemin : les choix restent ceux de l'événement), les camps rebelles inscrits parmi les camps
// de la page (nom et couleur), le résumé politique d'un camp étranger.
// Contrat du moteur : me.politique, factions[i].politique = {regime, noblesse, peuple [, rebelle]}, pending[i].ev
// ('revolution', 'guerre_civile') ; commandes {cmd: "politique", sub: "impot"|"nommer"|"renvoyer"} ; rules.regimes,
// rules.postes, rules.ministre_traits, rules.classes.
import { esc, clamp } from './battle/formes.js';
import { portraitGeneral } from './portraits.js';
import { coat } from './icons.js';

const CLASSES = ['noblesse', 'peuple'];
const ETAT = { calme: 'Calme', agitation: 'Agitation', emeutes: 'Émeutes', revolution: 'Révolution' };
const DE = { noblesse: 'de la noblesse', peuple: 'du peuple' };
// rules.rs POL_IMPOT et POL_INJUSTICE (absents des règles envoyées à la page) : l'estimation de l'effet d'un impôt
const POL_IMPOT = 70, POL_INJUSTICE = 15;
const signe = v => (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.round(Math.abs(v) * 10) / 10).toLocaleString('fr-FR');
// les effets des postes (rules.postes[k].fx, par point de compétence), en clair
const FX = { order: 'ordre public', livres: 'livres', recrues: 'recrues', port: 'ports et arsenaux', trade: 'commerce', research_speed: 'recherche' };
const effetPoste = (poste, comp) => [...Object.entries(poste.fx || {}).map(([k, v]) => `${FX[k] || k} ${signe(v * comp * 100)} %`),
  ...(poste.mec ? [`mécontentement des deux classes ${signe(poste.mec * comp)}`] : [])].join(', ').replace(/^./, c => c.toUpperCase());
const etoiles = n => `<span class="stars" title="Compétence ${n} sur 5">${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 5 - n))}</span>`;

// L'effet attendu d'un impôt de classe (sans le cadastre, qui adoucit les impôts lourds) : le rendement des impôts
// (comme la fenêtre Production : 0,6 + 0,8 × l'impôt moyen) et la cible du mécontentement de chaque classe.
// P : me.politique ; reg : rules.regimes[P.regime] ; v : le nouvel impôt de la classe (0 à 1).
export function estimeImpot(P, reg, classe, v) {
  const imp = { noblesse: P.classes.noblesse.impot, peuple: P.classes.peuple.impot }, neuf = { ...imp, [classe]: v };
  const inj = i => Math.max(0, i.peuple - i.noblesse) * POL_INJUSTICE;
  const cibles = {};
  for (const k of CLASSES) {
    cibles[k] = clamp(P.classes[k].cible + (neuf[k] - imp[k]) * POL_IMPOT * (reg?.sensible?.[k] ?? 1) + (k === 'peuple' ? inj(neuf) - inj(imp) : 0), 0, 100);
  }
  return { rendement: 0.6 + 0.8 * (neuf.noblesse + neuf.peuple) / 2, cibles };
}

export class Politique {
  constructor(ui) {
    this.ui = ui;
    this.poste = null;     // le poste dont on regarde les candidats (« Nommer… »)
    this.moi = null;       // le camp du joueur au dernier état (il peut prendre la tête des rebelles)
    this.niveau = 0;       // l'alerte montrée : 0 rien, 1 agitation, 2 émeutes, 3 révolution
    this.portraits = new Map();
  }
  get st() { return this.ui.st; }
  get R() { return this.ui.rules; }
  get P() { return this.st?.me?.politique; }
  regime(k) { return this.R.regimes?.[k] || { label: k, desc: '' }; }

  // Les camps rebelles parmi les camps de la page (rules.factions, couleurs de la carte) : le moteur les nomme et les
  // colore dans factions[i].politique.rebelle. Vrai quand l'en-tête est à refaire (camp neuf, ou le joueur a changé de camp).
  camps(st) {
    const F = this.R.factions;
    let neuf = this.moi !== st.me.code;
    this.moi = st.me.code;
    for (const f of st.factions || []) {
      const r = f.politique?.rebelle;
      if (!r) continue;
      const nom = st.names?.[f.code] || r.nom, couleur = r.couleur || '#c8423a';
      if (F[f.code]?.rebelle && F[f.code].color === couleur) continue;
      const pays = F[r.de] || {};
      F[f.code] = { ...pays, name: nom, short: nom, title: `Rebelles ${de(pays.short || pays.name || r.de)}`, color: couleur,
                    capital: this.ui.md.nodes[r.capitale]?.name || pays.capital, rebelle: r.de };
      this.ui.map.colors[f.code] = couleur;
      neuf = true;
    }
    return neuf;
  }

  // l'alerte : le bouton « Gouvernement » du rail en rouge (émeutes, révolution), un avis quand elle monte
  alerte(st) {
    const P = st.me.politique, b = this.ui.$('badge-gouvernement'), btn = b?.parentElement;
    if (!b) return;
    const decision = (st.pending || []).some(p => p.ev === 'revolution' || p.ev === 'guerre_civile');
    const etats = P ? CLASSES.map(c => P.classes[c].etat) : [];
    const n = decision || etats.includes('revolution') ? 3 : etats.includes('emeutes') ? 2 : etats.includes('agitation') ? 1 : 0;
    b.hidden = !n;
    b.textContent = '!';
    b.classList.toggle('pol-orange', n === 1);
    btn.classList.toggle('pol-alarme', n >= 2);
    btn.setAttribute('aria-label', n >= 2 ? 'Gouvernement : la révolution menace' : 'Gouvernement');
    if (n >= 2 && n > this.niveau && P) {
      const c = CLASSES.reduce((a, k) => P.classes[k].mecontentement > P.classes[a].mecontentement ? k : a);
      this.ui.toast(n === 3 ? `Révolution : la colère ${DE[c]} éclate. Voyez la fenêtre Gouvernement.` : `Émeutes : la colère ${DE[c]} monte. Baissez ses impôts ou changez de ministres (Gouvernement).`, 'bad');
    }
    this.niveau = n;
  }

  // ------------------------------------------------------------------ la fenêtre « Gouvernement »
  modal() {
    const P = this.P;
    if (!P) return ['<h2 class="m-title" id="m-title">Gouvernement</h2><p class="muted">Ce camp n’a pas de gouvernement à régler.</p>', 'none'];
    const reg = this.regime(P.regime), st = this.st;
    const attente = (st.pending || []).find(p => p.ev === 'revolution' || p.ev === 'guerre_civile');
    const mandat = P.mandat == null ? 'Ministres nommés à vie : ils ne quittent leur poste qu’à leur mort, ou renvoyés.'
      : P.regime === 'republique' ? `Prochaines élections ${this.tours(P.mandat)} : un peuple mécontent porte l’opposition au pouvoir.`
      : `Le Premier ministre sera renouvelé ${this.tours(P.mandat)}, ou plus tôt après une défaite.`;
    let h = `<h2 class="m-title" id="m-title">Gouvernement</h2>
      <p class="m-sub">${esc(reg.label)}${P.rebelle_de ? ` · camp rebelle né ${de(this.R.factions[P.rebelle_de]?.short || P.rebelle_de)}` : ''}${P.revolutions ? ` · ${P.revolutions} révolution${P.revolutions > 1 ? 's' : ''}` : ''}${P.guerres_civiles ? `, ${P.guerres_civiles} guerre${P.guerres_civiles > 1 ? 's' : ''} civile${P.guerres_civiles > 1 ? 's' : ''}` : ''}</p>`;
    if (attente) {
      h += `<div class="pol-alerte"><b>${esc(attente.title)}</b> : une décision vous attend.
        <button class="btn danger" data-act="modal" data-v="event">Décider</button></div>`;
    }
    if (P.rebelles && P.rebelles !== st.me.code) {
      const f = this.R.factions[P.rebelles];
      h += `<div class="pol-alerte">${coat(f?.color || '#c8423a', '')}<span>Guerre civile : <b>${esc(f?.name || P.rebelles)}</b> tient ${st.factions.find(x => x.code === P.rebelles)?.nodes ?? '?'} places. Reprenez sa capitale ou toutes ses places pour le faire capituler.</span></div>`;
    }
    h += `<div class="pol-regime"><p>${esc(reg.desc)}</p><p class="small">${mandat}${P.repit > 0 ? ` Aucune nouvelle révolution ${this.tours(P.repit)}.` : ''}</p>
      <p class="muted small">Une classe soulevée réclame son régime : la noblesse la ${esc(this.regime('absolue').label.toLowerCase())}, le peuple la ${esc(this.regime('republique').label.toLowerCase())}.</p></div>`;
    h += `<h3 class="section-t">Noblesse et peuple</h3><div class="two pol-classes">${CLASSES.map(c => this.classeHtml(P, c)).join('')}</div>`;
    h += `<h3 class="section-t">Cabinet</h3><div class="pol-cabinet">${Object.keys(this.R.postes || {}).map(k => this.posteHtml(P, k)).join('')}</div>`;
    return [h, JSON.stringify([P, this.poste, attente?.id, st.year])];
  }

  tours(n) { return n <= 0 ? 'ce tour-ci' : n === 1 ? 'au prochain tour' : `dans ${n} tours`; }

  // une classe : jauge et seuils, état, raisons, impôt
  classeHtml(P, c) {
    const k = P.classes[c], S = P.seuils || { agitation: 55, emeute: 70, revolution: 80, mois: 4 }, m = k.mecontentement;
    const vers = k.cible > m + 0.5 ? `monte vers ${Math.round(k.cible)}` : k.cible < m - 0.5 ? `descend vers ${Math.round(k.cible)}` : 'stable';
    const raisons = (k.raisons || []).map(r => `<tr><td>${esc(r.texte)}</td><td class="${r.valeur > 0 ? 'pol-mal' : 'pol-bien'}">${signe(r.valeur)}</td></tr>`).join('');
    return `<div class="pol-classe">
      <div class="row"><b>${esc(this.R.classes?.[c]?.label || c)}</b><span class="chip pol-${k.etat}">${ETAT[k.etat] || k.etat}</span><span class="muted small">mécontentement ${Math.round(m)} / 100, ${vers}</span></div>
      ${jauge(m, k.cible, S)}
      ${m >= S.revolution ? `<div class="warnline">Au-delà de ${S.revolution} depuis ${k.mois} mois sur ${S.mois} : la révolution éclate au bout de ${S.mois}.</div>` : m >= S.emeute ? '<div class="warnline">Émeutes : l’ordre public s’effondre dans vos places.</div>' : m >= S.agitation ? '<div class="small" style="color:#ffcf85">Agitation : l’ordre public baisse.</div>' : ''}
      <table class="grid pol-raisons"><tbody>${raisons || '<tr><td class="muted">Aucune raison particulière.</td></tr>'}</tbody><tfoot><tr><td>Mécontentement visé</td><td>${Math.round(k.cible)}</td></tr></tfoot></table>
      ${this.impotHtml(P, c)}</div>`;
  }

  // le curseur de l'impôt d'une classe et son effet attendu (mis à jour en glissant : apercu)
  impotHtml(P, c) {
    const v = Math.round(P.classes[c].impot * 100);
    return `<label class="small muted" for="pol-imp-${c}">Impôt ${DE[c]}</label>
      <input id="pol-imp-${c}" class="slider" type="range" min="0" max="100" step="5" value="${v}" data-pol-impot="${c}" aria-label="Impôt ${DE[c]}">
      <div class="big-slider-labels"><span>Légers</span><span id="pol-imp-${c}-val">${esc(this.ui.taxLabel(v / 100))}</span><span>Écrasants</span></div>
      <div class="small muted" id="pol-imp-${c}-fx">${this.effetTxt(P, c, v / 100)}</div>`;
  }
  effetTxt(P, c, v) {
    const e = estimeImpot(P, this.regime(P.regime), c, v);
    return `Rendement des impôts ${Math.round(e.rendement * 100)} % des livres · mécontentement visé : noblesse ${Math.round(e.cibles.noblesse)}, peuple ${Math.round(e.cibles.peuple)}`;
  }
  // les deux curseurs (fenêtre Production : ils remplacent le curseur unique, dont l'impôt moyen garde le rendement)
  impotsHtml() {
    const P = this.P;
    if (!P) return '';
    return `<div class="pol-impots">${CLASSES.map(c => this.impotHtml(P, c)).join('')}<p class="muted small">Impôt moyen : ${esc(this.ui.taxLabel(this.st.me.tax).toLowerCase())}. Chaque classe a son impôt ; leur colère se voit dans la fenêtre <button class="linkish" data-act="modal" data-v="gouvernement">Gouvernement</button>.</p></div>`;
  }
  // curseur relâché : l'ordre ; en glissant : le libellé et l'effet attendu
  impot(el) { this.ui.cmd({ cmd: 'politique', sub: 'impot', classe: el.dataset.polImpot, value: el.value / 100 }, false); }
  apercu(el) {
    const c = el.dataset.polImpot, P = this.P;
    const l = document.getElementById(`pol-imp-${c}-val`), fx = document.getElementById(`pol-imp-${c}-fx`);
    if (l) l.textContent = this.ui.taxLabel(el.value / 100);
    if (fx && P) fx.textContent = this.effetTxt(P, c, el.value / 100);
  }

  // un poste du cabinet : portrait, nom, compétence, traits, effet du poste ; renvoyer, nommer (candidats)
  posteHtml(P, k) {
    const poste = this.R.postes[k], m = P.cabinet[k], ouvert = this.poste === k;
    let h = `<div class="pol-poste${m ? '' : ' vacant'}"><div class="pol-ph">${m ? this.portrait(m.nom) : '<div class="pol-vide">?</div>'}<div>
      <div class="pol-pl">${esc(poste.label)}</div><div class="small muted">${esc(poste.desc)}</div>
      ${m ? `<div><b>${esc(m.nom)}</b>, ${m.age} ans ${etoiles(m.competence)}</div><div class="small">${esc(effetPoste(poste, m.competence))}</div>${this.traitsHtml(m)}` : '<div class="warnline">Poste vacant</div>'}</div></div>
      <div class="btns">${m ? `<button class="btn danger" data-act="pol-renvoyer" data-v="${k}" title="${esc(this.renvoiTxt(P, m))}">Renvoyer</button>` : ''}
        <button class="btn${ouvert ? ' primary' : ''}" data-act="pol-poste" data-v="${k}" ${P.candidats?.length ? '' : 'disabled title="Aucun candidat cette année : de nouveaux se présentent en janvier"'}>Nommer…</button></div>
      ${m ? `<div class="small muted">Renvoi : ${esc(this.renvoiTxt(P, m))}</div>` : ''}`;
    if (ouvert) {
      h += `<div class="pol-cands">${(P.candidats || []).map(c => `<div class="pol-cand">${this.portrait(c.nom)}<div><b>${esc(c.nom)}</b>, ${c.age} ans ${etoiles(c.competence)}${this.traitsHtml(c)}</div>
        <button class="btn primary" data-act="pol-nommer" data-v="${k}" data-id="${esc(c.id)}">Nommer</button></div>`).join('')}
        ${m ? `<div class="small muted">${esc(m.nom)} sera renvoyé : ${esc(this.renvoiTxt(P, m))}.</div>` : ''}</div>`;
    }
    return h + '</div>';
  }
  traitsHtml(m) {
    const T = this.R.ministre_traits || {};
    return `<div class="chips">${(m.traits || []).map(t => `<span class="chip" title="${esc(T[t]?.desc || '')}">${esc(T[t]?.label || t)}</span>`).join('')}</div>
      ${(m.traits || []).length ? `<div class="small muted">${(m.traits || []).map(t => esc(T[t]?.desc || '')).join(' ')}</div>` : ''}`;
  }
  // le coût d'un renvoi : la noblesse s'offusque (le peuple, pour un ministre populaire)
  renvoiTxt(P, m) {
    const c = (m.traits || []).includes('populaire') ? 'peuple' : 'noblesse';
    return `mécontentement ${DE[c]} +${this.regime(P.regime).renvoi ?? 0}`;
  }
  portrait(nom) {
    const cle = `${nom}|${this.st.year}|${this.moi}`;
    if (!this.portraits.has(cle)) {
      let url = '';
      try { url = portraitGeneral(nom, this.st.year || 1790, this.ui.map.colors[this.moi] || '#2b3d7a').toDataURL(); } catch (e) { /* sans canevas (essais) */ }
      this.portraits.set(cle, url);
    }
    const url = this.portraits.get(cle);
    return url ? `<img class="pol-portrait" src="${url}" alt="">` : '<div class="pol-vide"></div>';
  }

  action(act, d) {
    switch (act) {
      case 'pol-poste': this.poste = this.poste === d.v ? null : d.v; this.ui.renderModal(true); break;
      case 'pol-renvoyer': {
        const m = this.P?.cabinet?.[d.v];
        if (m && confirm(`Renvoyer ${m.nom} ? (${this.renvoiTxt(this.P, m)})`)) this.ui.cmd({ cmd: 'politique', sub: 'renvoyer', poste: d.v });
        break;
      }
      case 'pol-nommer':
        this.ui.cmd({ cmd: 'politique', sub: 'nommer', poste: d.v, ministre: d.id }).then(r => { if (r?.ok) { this.poste = null; this.ui.renderModal(true); } });
        break;
    }
  }

  // ------------------------------------------------------------------ révolution et guerre civile (fenêtre des décisions)
  // ce qui précède les choix d'une décision 'revolution' ou 'guerre_civile' : la classe soulevée, la chance de la
  // répression, ce que chaque issue change ; '' pour un autre événement
  contexte(p) {
    const P = this.P, st = this.st;
    if (!P || (p.ev !== 'revolution' && p.ev !== 'guerre_civile')) return '';
    if (p.ev === 'revolution') {
      const rv = P.revolution || {}, c = rv.classe || 'peuple', k = P.classes[c], ch = Math.round((rv.chance || 0) * 100);
      const but = this.regime(this.R.classes?.[c]?.but || (c === 'peuple' ? 'republique' : 'absolue')).label.toLowerCase();
      const places = st.factions.find(f => f.code === st.me.code)?.nodes || 0;
      return `<div class="pol-alerte pol-rev"><div class="row"><b>${esc(this.R.classes?.[c]?.label || c)}</b><span class="chip pol-revolution">Révolution</span><span class="small">mécontentement ${Math.round(k.mecontentement)} / 100</span></div>
        ${jauge(k.mecontentement, k.cible, P.seuils || { agitation: 55, emeute: 70, revolution: 80 })}
        <div class="row" style="margin-top:6px"><span>Chance de réprimer : <b>${ch} %</b></span><div class="bar ${ch >= 50 ? 'green' : 'red'}" style="flex:1;min-width:100px"><i style="width:${ch}%"></i></div></div>
        <p class="small muted" style="margin:4px 0 0">La chance tient au régime, au ministre de la Justice, aux garnisons de vos places et à la colère de la classe.
        Si la répression échoue, la ${esc(but)} l’emporte${places >= 6 ? ', et une part de vos places et de vos armées passe aux révolutionnaires : c’est la guerre civile' : ''}.</p></div>`;
    }
    const r = P.rebelles && this.R.factions[P.rebelles], f = P.rebelles && st.factions.find(x => x.code === P.rebelles);
    if (!r) return '';
    return `<div class="pol-alerte pol-rev"><div class="row">${coat(r.color, '')}<span><b>${esc(r.name)}</b> : ${f?.nodes ?? '?'} places, ${esc(this.regime(f?.politique?.regime).label.toLowerCase())}.</span></div>
      <p class="small" style="margin:4px 0 0">Prendre leur tête : vous jouez désormais ce camp et ${esc(this.R.factions[st.me.code]?.name || '')} passe à une IA. Rester fidèle : la guerre civile se gagne en reprenant leur capitale, ${esc(r.capital || '')}, ou toutes leurs places.</p></div>`;
  }

  // ------------------------------------------------------------------ les autres camps
  // une ligne pour la fiche d'un camp étranger : régime et mécontentement des classes (f : une entrée de state.factions)
  resumeCamp(f) {
    const p = f?.politique;
    if (!p) return '';
    const S = this.P?.seuils || { agitation: 55, emeute: 70, revolution: 80 };
    const cl = v => v >= S.revolution ? 'pol-mal' : v >= S.emeute ? 'pol-mal' : v >= S.agitation ? 'pol-moyen' : '';
    const reb = p.rebelle ? ` · rebelles ${esc(de(this.R.factions[p.rebelle.de]?.short || p.rebelle.de))}` : '';
    return `<div class="small pol-resume">${esc(this.regime(p.regime).label)}${reb} · noblesse <span class="${cl(p.noblesse)}">${p.noblesse}</span>, peuple <span class="${cl(p.peuple)}">${p.peuple}</span> de mécontentement${p.peuple >= S.emeute || p.noblesse >= S.emeute ? ' (émeutes)' : ''}</div>`;
  }
}

// « de » élidé, comme ui.js
const de = n => /^Le /.test(n) ? 'du ' + n.slice(3) : /^Les /.test(n) ? 'des ' + n.slice(4) : /^[aeiouyhâàéèêîïôöûü]/i.test(n) ? `d’${n}` : `de ${n}`;

// la jauge du mécontentement : la valeur, la cible (trait), les seuils (agitation, émeutes, révolution)
function jauge(m, cible, S) {
  const marque = (v, t) => `<span class="pol-seuil" style="left:${v}%" title="${t} (${v})"></span>`;
  return `<div class="pol-jauge" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m)}" aria-label="Mécontentement">
    <i style="width:${clamp(m, 0, 100)}%" class="${m >= S.emeute ? 'rouge' : m >= S.agitation ? 'orange' : ''}"></i>
    ${marque(S.agitation, 'Agitation')}${marque(S.emeute, 'Émeutes')}${marque(S.revolution, 'Révolution')}
    <span class="pol-cible" style="left:${clamp(cible, 0, 100)}%" title="Mécontentement visé (${Math.round(cible)})"></span></div>
    <div class="pol-graduation">seuils : agitation ${S.agitation}, émeutes ${S.emeute}, révolution ${S.revolution} · trait clair : mécontentement visé</div>`;
}
