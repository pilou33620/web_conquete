// La diplomatie profonde côté page (SPEC-POLITIQUE, module 6 ; page P10) : fiche d'un camp (caractère, attitude et ses
// raisons, régime, relations, puissance, diplomate en ambassade), proposition composée (« Vous donnez / Vous recevez »)
// et contre-proposition, ultimatum, appel aux armes, propositions reçues de ces sortes, protectorats.
// Branché par ui.js : fenêtre « negocier » (html), actions « dp-… » (action), clic d'une place sur la carte (tap),
// propositions reçues (recueHtml), fiche dans les cartes de la fenêtre Diplomatie (ficheHtml, boutonsHtml).
import { esc } from './battle/formes.js';
import { coat } from './icons.js';

const fmt = n => (Math.round(n) || 0).toLocaleString('fr-FR').replace(/^-/, '−');
const signe = n => (Math.round(n) > 0 ? '+' : '') + fmt(n);

// la couleur d'une attitude (−100 à +100) : rouge, gris, vert (comme .relbar)
export function couleurAttitude(v) {
  const t = Math.max(-1, Math.min(1, (v || 0) / 100));
  const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const [r, g, b] = t < 0 ? mix([107, 106, 92], [168, 57, 45], -t) : mix([107, 106, 92], [95, 154, 78], t);
  return `rgb(${r},${g},${b})`;
}

// les raisons d'une attitude, de la plus favorable à la plus hostile
export const raisonsTriees = att => [...(att?.raisons || [])].sort((a, b) => b.valeur - a.valeur);

// une clause de la page vers le moteur : son type et ses seuls champs (rules.CLAUSES[type].champs), en nombres
export function clausePourMoteur(c, CLAUSES) {
  const out = { type: c.type };
  for (const k of CLAUSES[c.type]?.champs || []) out[k] = k === 'tech' ? c[k] : Math.round(+c[k] || 0);
  return out;
}

// ce que chacun voit d'une proposition reçue : frm donne `donner`, demande `recevoir` ; pour le joueur, c'est l'inverse
export const vuJoueur = p => ({ recoit: p.clauses?.donner || [], donne: p.clauses?.recevoir || [] });

export class Diplomatie {
  constructor(ui) {
    this.ui = ui;
    this.cible = null;      // le camp de la fenêtre « negocier »
    this.onglet = 'proposer';
    this.prop = { donner: [], recevoir: [] };
    this.ult = { type: 'tribut', montant: 50, tours: 12 };
    this.reponse = null;    // {cible, ok, msg} : la dernière réponse à une proposition
    this.vise = null;       // {cote, i} : une place de la clause à toucher sur la carte
  }
  get st() { return this.ui.st; }
  get R() { return this.ui.rules; }
  nom(c) { return this.R.factions[c]?.name || c; }
  fac(c) { return this.st.factions.find(f => f.code === c); }
  moi() { return this.fac(this.st.me.code); }
  place(n) { return this.ui.md.nodes[n]?.name || `place ${n}`; }

  // ------------------------------------------------------------------ fiche d'un camp
  // complet : la fenêtre « negocier » (raisons dépliées) ; sinon la carte de la fenêtre Diplomatie (raisons repliées)
  ficheHtml(f, complet = false) {
    const car = this.R.CARACTERES?.[f.caractere], att = f.attitude;
    let h = '';
    if (car) h += `<div class="small dp-car"><span class="chip" title="${esc(car.desc)}">${esc(car.nom)}</span> <span class="muted">${esc(car.desc)}</span></div>`;
    if (att) {
      const v = att.valeur, l = raisonsTriees(att);
      const jauge = `<div class="dp-att"><span class="lab">Attitude</span><div class="dp-jauge" role="meter" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${v}" aria-label="Attitude envers vous">
        <i style="${v < 0 ? `right:50%;width:${-v / 2}%` : `left:50%;width:${v / 2}%`};background:${couleurAttitude(v)}"></i></div><b style="color:${couleurAttitude(v * 1.6)}">${signe(v)}</b></div>`;
      const ul = `<ul class="dp-raisons">${l.map(r => `<li><span>${esc(r.texte)}</span><b class="${r.valeur < 0 ? 'neg' : r.valeur > 0 ? 'pos' : ''}">${signe(r.valeur)}</b></li>`).join('')}</ul>`;
      h += complet ? jauge + ul : `<details class="dp-det"><summary>${jauge}</summary>${ul}</details>`;
    }
    const reg = f.politique?.regime && this.R.regimes?.[f.politique.regime];
    if (reg) h += `<div class="small">Régime : <span title="${esc(reg.desc || '')}">${esc(reg.label)}</span></div>`;
    const me = this.st.me.code, moi = this.moi();
    if (f.over && f.over !== me) h += `<div class="small">Protectorat ${esc(deNom(this.nom(f.over)))} : on traite avec son protecteur.</div>`;
    if (moi?.over === f.code) h += '<div class="small">Votre protecteur : il parle pour vous à l’étranger.</div>';
    const dip = this.diplomateChez(f.code);
    if (this.st.agents) h += `<div class="small">${dip ? `Votre diplomate ${esc(dip.nom || '')} est en ambassade à ${esc(this.place(dip.mission.cible))} : il facilite les accords.` : '<span class="muted">Aucun de vos diplomates à sa cour.</span>'}</div>`;
    if (complet) {
      const k = moi.power ? f.power / moi.power : 0;
      h = `<div class="row">${this.chipsHtml(f)}</div>${h}<div class="small">Puissance estimée ${fmt(f.power)} (vous ${fmt(moi.power)}${k ? `, ${k > 0.9 && k < 1.1 ? 'à peu près la vôtre' : k >= 1 ? `${(Math.round(k * 10) / 10).toLocaleString('fr-FR')} fois la vôtre` : `${Math.round(k * 100)} % de la vôtre`}` : ''}), ${f.nodes} villes et villages, ${f.techs} technologies.</div>`;
    }
    return `<div class="dp-fiche">${h}</div>`;
  }
  // l'un de vos diplomates en ambassade chez ce camp (SPEC-POLITIQUE, module 4 : vue agents, mission ambassade)
  diplomateChez(code) {
    return (this.st.agents || []).find(a => a.proprio === this.st.me.code && a.type === 'diplomate' && a.mission?.type === 'ambassade'
      && this.st.nodes[a.mission.cible]?.o === code);
  }
  chipsHtml(f) {
    const me = this.st.me.code, ST = { paix: 'En paix', guerre: 'En guerre', alliance: 'Alliés' };
    const c = [`<span class="chip ${f.st === 'guerre' ? 'war' : f.st === 'alliance' ? 'ally' : ''}">${ST[f.st] || f.st}</span>`];
    if (f.over === me) c.push('<span class="chip ally">Votre protectorat</span>');
    if (f.trade) c.push('<span class="chip ally">Accord commercial</span>');
    if (f.truce) c.push(`<span class="chip">Trêve jusqu’au ${esc(f.truce)}</span>`);
    if (f.ps) c.push(`<span class="chip ally">Passage chez lui jusqu’au ${esc(f.ps)}</span>`);
    if (f.pg) c.push(`<span class="chip">Vous lui accordez le passage jusqu’au ${esc(f.pg)}</span>`);
    if (f.cb) c.push('<span class="chip war" title="Lui déclarer la guerre ne fâcherait personne">Casus belli</span>');
    const wars = (f.wars || []).filter(w => w !== me);
    if (wars.length) c.push(`<span class="chip war">En guerre contre ${wars.map(w => esc(this.nom(w))).join(', ')}</span>`);
    return c.join('');
  }
  // les boutons de la carte d'un camp (fenêtre Diplomatie) vers la fenêtre « negocier »
  boutonsHtml(f) {
    const moi = this.moi();
    if ((f.over && f.over !== this.st.me.code) || (moi?.over && moi.over !== f.code)) return '';   // (un protecteur parle pour son protectorat)
    const b = (o, l) => `<button class="btn" data-act="dp-ouvrir" data-c="${f.code}" data-v="${o}">${l}</button>`;
    return `<div class="btns">${b('proposer', 'Négocier un accord…')}${f.st !== 'guerre' ? b('ultimatum', 'Ultimatum…') : ''}${f.st === 'alliance' ? b('appel', 'Appel aux armes…') : ''}</div>`;
  }
  // de quoi refaire la fenêtre Diplomatie quand l'attitude ou le caractère change
  sig() { return this.st.factions.map(f => [f.attitude?.valeur, f.caractere, f.politique?.regime, f.over]); }

  // les propositions reçues en haut de la fenêtre Diplomatie (la liste flottante s'efface alors : body.modal-diplo)
  recuesHtml() {
    const l = this.st.proposals;
    return l.length ? `<div class="dp-recues"><b>Propositions reçues</b><div class="dp-recues-l">${l.map(p => this.ui.proposalHtml(p)).join('')}</div></div>` : '';
  }

  // ------------------------------------------------------------------ protectorats (haut de la fenêtre Diplomatie)
  protectoratsHtml() {
    const me = this.st.me.code, moi = this.moi();
    const miens = this.st.factions.filter(f => f.alive && f.over === me);
    let h = miens.map(f => `<div class="row"><span class="small"><b>${esc(this.nom(f.code))}</b>, votre protectorat, vous verse un tribut (15 % de ses livres) et suit vos guerres.</span>
      <button class="btn" data-act="dp-liberer" data-c="${f.code}">Accorder l’indépendance</button></div>`).join('');
    if (moi?.over) h += `<div class="row"><span class="small">Vous êtes un protectorat ${esc(deNom(this.nom(moi.over)))} : vous lui versez un tribut (15 % de vos livres), suivez ses guerres, et il mène votre diplomatie.</span>
      <button class="btn" data-act="dp-independance" data-c="${moi.over}">Demander l’indépendance…</button></div>`;
    return h ? `<div class="dp-protect"><b>Protectorats</b>${h}</div>` : '';
  }

  // ------------------------------------------------------------------ propositions reçues (ui.renderProposals)
  // les sortes du module 6 ; null : une action d'avant, que ui.js affiche comme avant
  recueHtml(p) {
    if (!['proposition', 'ultimatum', 'appel'].includes(p.action)) return null;
    const f = this.R.factions[p.frm] || {}, nf = esc(f.name || p.frm);
    const bt = (v, l, cls = '') => `<button class="btn ${cls}" data-act="dp-rep" data-id="${p.id}" data-v="${v}">${l}</button>`;
    let titre, corps, btns;
    if (p.action === 'proposition') {
      titre = p.contre_proposition ? 'vous fait une contre-proposition' : 'vous propose un accord';
      corps = this.clausesHtml(vuJoueur(p));
      btns = bt(1, 'Accepter', 'primary') + bt(0, 'Refuser');
    } else if (p.action === 'ultimatum') {
      const fr = this.fac(p.frm), moi = this.moi();
      titre = 'vous adresse un ultimatum';
      corps = `<p><b>Il exige ${esc(this.texteExigence(p.exigence))}</b>, sous peine de guerre.</p>
        <p class="small">Céder : vous perdez ${esc(this.texteExigence(p.exigence))}. Refuser : il tient un casus belli contre vous et peut vous déclarer la guerre sans que personne ne s’en offusque.${fr && moi ? ` Sa puissance : ${fmt(fr.power)} (vous ${fmt(moi.power)}).` : ''}</p>`;
      btns = bt(1, 'Céder') + bt(0, 'Refuser l’ultimatum', 'danger');
    } else {
      titre = 'vous appelle aux armes';
      corps = `<p>Contre <b>${esc(this.nom(p.contre))}</b>.</p><p class="small">Accepter : vous entrez en guerre contre ${esc(this.nom(p.contre))}. Refuser : il s’en souviendra longtemps et votre alliance peut se rompre.</p>`;
      btns = bt(1, 'Entrer en guerre', 'primary') + bt(0, 'Refuser');
    }
    return `<div class="sheet proposal dp-recue dp-${p.action}" style="border-left-color:${p.action === 'ultimatum' ? '#c8322c' : f.color}"><div class="pt">${nf} ${titre}</div>
      ${corps}<div class="btns">${btns}</div></div>`;
  }
  clausesHtml({ recoit, donne }) {
    const l = cl => cl.length ? `<ul>${cl.map(c => `<li>${esc(c.texte || c.type)}</li>`).join('')}</ul>` : '<p class="muted small">rien</p>';
    return `<div class="dp-cols dp-lu"><div><b>Vous recevez</b>${l(recoit)}</div><div><b>Vous donnez</b>${l(donne)}</div></div>`;
  }
  texteExigence(e) {
    if (!e) return '?';
    if (e.type === 'region') return this.place(e.node);
    if (e.type === 'tribut') return `${fmt(e.montant)} livres par tour pendant ${e.tours} tours`;
    if (e.type === 'rompre') return `la rupture de votre alliance avec ${this.nom(e.allie)}`;
    return e.type;
  }
  // un ultimatum ou un appel aux armes attend : le badge de la Diplomatie passe au rouge
  urgent(st) { return (st.proposals || []).some(p => p.action === 'ultimatum' || p.action === 'appel'); }

  // ------------------------------------------------------------------ fenêtre « negocier »
  ouvrir(code, onglet = 'proposer') {
    if (code !== this.cible) { this.prop = { donner: [], recevoir: [] }; this.reponse = null; this.ult = { type: 'tribut', montant: 50, tours: 12 }; }
    this.cible = code;
    this.onglet = onglet;
    this.ui.openModal('negocier');
  }
  html() {
    const f = this.fac(this.cible);
    if (!f || !f.alive) return ['<p class="muted">Ce camp n’existe plus.</p>', 'mort'];
    const R = this.R.factions[f.code];
    const tabs = [['proposer', 'Proposition'], ['ultimatum', 'Ultimatum'], ['appel', 'Appel aux armes']].map(([k, l]) =>
      `<button class="btn ${k === this.onglet ? 'primary' : ''}" role="tab" aria-selected="${k === this.onglet}" data-act="dp-onglet" data-v="${k}">${l}</button>`).join('');
    const corps = this.onglet === 'ultimatum' ? this.ultimatumHtml(f) : this.onglet === 'appel' ? this.appelHtml(f) : this.proposerHtml(f);
    const html = `<button class="btn dp-retour" data-act="modal" data-v="diplo">← Diplomatie</button>
      <h2 class="m-title" id="m-title"><span class="dp-coat">${coat(R.color, f.code)}</span>${esc(R.name)}</h2>${this.ficheHtml(f, true)}
      <div class="tabs" role="tablist">${tabs}</div>${corps}`;
    const contres = this.st.proposals.filter(p => p.frm === f.code).map(p => p.id);
    return [html, JSON.stringify([f, this.onglet, this.prop, this.ult, this.reponse, contres, this.st.me.techs.length, this.diplomateChez(f.code)?.id])];
  }

  // les places qu'un camp peut céder (pas son chef-lieu), triées par nom
  places(code) {
    return this.st.nodes.filter(n => n && n.o === code && !(this.ui.md.nodes[n.id]?.type === 'capitale' && this.ui.md.nodes[n.id]?.dept === code))
      .map(n => n.id).sort((a, b) => this.place(a).localeCompare(this.place(b), 'fr'));
  }
  // shortcut: la vue ne dit pas quelles technologies ont les autres camps ; on propose les nôtres (donner) et celles dont
  // nous avons les prérequis (recevoir), le moteur refuse le reste ; à revoir si la vue donne un jour leurs listes
  techs(cote) {
    const mine = new Set(this.st.me.techs);
    return this.R.techs.filter(t => cote === 'donner' ? mine.has(t.id) : !mine.has(t.id) && (t.req || []).every(q => mine.has(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  // les clauses qu'un côté peut ajouter, selon la situation (le moteur revérifie tout)
  typesPossibles(f, cote) {
    const me = this.st.me.code, moi = this.moi(), donne = cote === 'donner';
    const protege = c => this.st.factions.some(x => x.alive && x.over === c);
    const ok = {
      region: true, technologie: true, argent: true, tribut: true, cartes: true,
      passage: f.st === 'paix' && !(donne ? f.pg : f.ps),
      commerce: donne && f.st !== 'guerre' && !f.trade, alliance: donne && f.st === 'paix', paix: donne && f.st === 'guerre',
      protectorat: !moi.over && !f.over && !protege(donne ? me : f.code),
      independance: donne ? f.over === me : moi.over === f.code,
    };
    return Object.keys(this.R.CLAUSES || {}).filter(t => ok[t]);
  }
  clauseHtml(f, cote, c, i) {
    const C = this.R.CLAUSES[c.type], id = k => `dp-c-${cote}-${i}-${k}`;
    let champs = '';
    if (c.type === 'region') {
      const l = this.places(cote === 'donner' ? this.st.me.code : f.code);
      champs = `<select class="amount" id="${id('node')}" aria-label="Place">${l.map(n => `<option value="${n}" ${n === +c.node ? 'selected' : ''}>${esc(this.place(n))}</option>`).join('')}</select>
        <button class="btn" data-act="dp-carte" data-cote="${cote}" data-i="${i}" title="Toucher la place sur la carte">Sur la carte</button>`;
    } else if (c.type === 'technologie') {
      const l = this.techs(cote);
      champs = l.length ? `<select class="amount" id="${id('tech')}" aria-label="Technologie">${l.map(t => `<option value="${t.id}" ${t.id === c.tech ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : '<span class="muted small">aucune</span>';
    } else if (c.type === 'argent') {
      champs = `<input class="amount" type="number" min="1" step="50" id="${id('montant')}" value="${c.montant}" aria-label="Livres"><span class="small">livres</span>`;
    } else if (c.type === 'tribut') {
      champs = `<input class="amount" type="number" min="1" step="10" id="${id('montant')}" value="${c.montant}" aria-label="Livres par tour"><span class="small">livres ×</span>
        <input class="amount" type="number" min="1" max="60" step="1" id="${id('tours')}" value="${c.tours}" aria-label="Tours"><span class="small">tours</span>`;
    }
    return `<div class="dp-clause"><b title="${esc(C.desc)}">${esc(C.nom)}</b>${C.mutuelle ? '<span class="muted small">(des deux côtés)</span>' : ''}${champs}
      <button class="btn dp-x" data-act="dp-retirer" data-cote="${cote}" data-i="${i}" aria-label="Retirer la clause">×</button></div>`;
  }
  proposerHtml(f) {
    const col = (cote, titre) => {
      const l = this.prop[cote], pris = new Set(l.map(c => c.type));
      const plus = this.typesPossibles(f, cote).filter(t => t === 'region' || t === 'technologie' || !pris.has(t))
        .map(t => `<button class="btn dp-plus" data-act="dp-ajouter" data-cote="${cote}" data-v="${t}" title="${esc(this.R.CLAUSES[t].desc)}">+ ${esc(this.R.CLAUSES[t].nom)}</button>`).join('');
      return `<div class="dp-col"><h3>${titre}</h3>${l.map((c, i) => this.clauseHtml(f, cote, c, i)).join('') || '<p class="muted small">Aucune clause.</p>'}<div class="dp-palette">${plus}</div></div>`;
    };
    const vide = !this.prop.donner.length && !this.prop.recevoir.length;
    const rep = this.reponse?.cible === f.code ? `<p class="dp-rep ${this.reponse.ok ? 'ok' : 'non'}">${esc(this.reponse.msg)}</p>` : '';
    // (pas d'estimation de l'accueil : le moteur n'en donne pas, rien n'est inventé ici)
    const contres = this.st.proposals.filter(p => p.frm === f.code).map(p => this.ui.proposalHtml(p)).join('');
    return `<p class="small muted">Composez un paquet : ce que vous cédez et ce que vous demandez. Il juge l’accord sur ce qu’il y gagne, son attitude envers vous et son caractère ; s’il refuse, il peut vous faire une contre-proposition.</p>
      <div class="dp-cols">${col('donner', 'Vous donnez')}${col('recevoir', 'Vous recevez')}</div>
      <div class="btns"><button class="btn primary" data-act="dp-proposer" ${vide ? 'disabled' : ''}>Proposer</button><button class="btn" data-act="dp-effacer" ${vide ? 'disabled' : ''}>Tout effacer</button></div>
      ${rep}${contres ? `<div class="dp-contres"><b>Ses propositions en attente</b>${contres}</div>` : ''}`;
  }
  ultimatumHtml(f) {
    if (f.st === 'guerre') return '<p class="muted">Vous êtes en guerre : exigez plutôt sa soumission, ou la paix à vos conditions.</p>';
    const u = this.ult, seg = [['region', 'Une région'], ['tribut', 'Un tribut'], ['rompre', 'Rompre une alliance']].map(([k, l]) =>
      `<button class="btn ${u.type === k ? 'primary' : ''}" data-act="dp-ult-type" data-v="${k}">${l}</button>`).join('');
    let champ;
    if (u.type === 'region') {
      const l = this.places(f.code);
      champ = l.length ? `<select class="amount" id="dp-u-node" aria-label="Place exigée">${l.map(n => `<option value="${n}" ${n === +u.node ? 'selected' : ''}>${esc(this.place(n))}</option>`).join('')}</select>` : '<span class="muted">Aucune de ses places n’est en vue.</span>';
    } else if (u.type === 'tribut') {
      champ = `<input class="amount" type="number" min="1" step="10" id="dp-u-montant" value="${u.montant}" aria-label="Livres par tour"><span class="small">livres par tour pendant</span>
        <input class="amount" type="number" min="1" max="60" id="dp-u-tours" value="${u.tours}" aria-label="Tours"><span class="small">tours</span>`;
    } else {
      // (la vue ne dit pas qui est allié de qui chez les autres : le moteur refuse une alliance qui n'existe pas)
      const l = this.st.factions.filter(x => x.alive && x.code !== f.code && x.code !== this.st.me.code);
      champ = `<span class="small">son alliance avec</span><select class="amount" id="dp-u-allie" aria-label="Allié">${l.map(x => `<option value="${x.code}" ${x.code === u.allie ? 'selected' : ''}>${esc(this.nom(x.code))}</option>`).join('')}</select>`;
    }
    return `<p class="small muted">Exigez sous menace de guerre. Il cède s’il vous craint assez ; sinon il refuse.</p>
      <div class="row">${seg}</div><div class="row">${champ}</div>
      <p class="dp-avert">Un refus vous donne un casus belli : vous pourrez lui déclarer la guerre sans fâcher personne. Mais il s’en souviendra, qu’il cède ou non.</p>
      <div class="btns"><button class="btn danger" data-act="dp-ultimatum">Adresser l’ultimatum</button></div>`;
  }
  appelHtml(f) {
    if (f.st !== 'alliance') return '<p class="muted">Seul un allié peut être appelé aux armes.</p>';
    const ennemis = (this.moi().wars || []).filter(w => !(f.wars || []).includes(w) && w !== f.code);
    if (!ennemis.length) return `<p class="muted">Vous n’avez pas d’ennemi qu’il ne combatte déjà.</p>`;
    return `<p class="small muted">Votre allié répond selon son attitude envers vous et sa fidélité. S’il refuse, vous vous en souviendrez, et l’alliance peut en souffrir.</p>
      <div class="row"><span class="small">Contre</span><select class="amount" id="dp-a-contre" aria-label="Ennemi">${ennemis.map(w => `<option value="${w}">${esc(this.nom(w))}</option>`).join('')}</select>
      <button class="btn primary" data-act="dp-appel">Appeler aux armes</button></div>`;
  }

  // ------------------------------------------------------------------ actions
  // les champs saisis repassent dans l'état avant tout changement (la fenêtre se refait)
  lire() {
    const v = id => document.getElementById(id)?.value;
    for (const cote of ['donner', 'recevoir']) {
      this.prop[cote].forEach((c, i) => {
        for (const k of ['node', 'tech', 'montant', 'tours']) { const x = v(`dp-c-${cote}-${i}-${k}`); if (x != null) c[k] = k === 'tech' ? x : +x; }
      });
    }
    for (const k of ['node', 'montant', 'tours', 'allie']) { const x = v(`dp-u-${k}`); if (x != null) this.ult[k] = k === 'allie' ? x : +x; }
  }
  // la fenêtre se refait depuis l'état (lire) : ui.renderModal ne doit pas y remettre les anciennes saisies, dont les
  // identifiants ont pu glisser (une clause retirée, une place touchée sur la carte)
  oublier() { this.ui.$('modal').firstElementChild?.querySelectorAll('[id^="dp-"]').forEach(e => e.removeAttribute('id')); }
  refaire() { this.oublier(); this.ui.modalSig = ''; this.ui.renderModal(true); }
  async envoyer(body) {
    const r = await this.ui.cmd({ cmd: 'diplo', cible: this.cible, ...body });
    this.refaire();
    return r;
  }
  async action(act, d) {
    this.lire();
    const f = this.cible && this.fac(this.cible);
    switch (act) {
      case 'dp-ouvrir': this.ouvrir(d.c, d.v); break;
      case 'dp-onglet': this.onglet = d.v; this.refaire(); break;
      case 'dp-ajouter': {
        const c = { type: d.v };
        if (d.v === 'region') c.node = this.places(d.cote === 'donner' ? this.st.me.code : f.code)[0];
        if (d.v === 'technologie') c.tech = this.techs(d.cote)[0]?.id;
        if (d.v === 'argent') c.montant = 100;
        if (d.v === 'tribut') Object.assign(c, { montant: 20, tours: 12 });
        this.prop[d.cote].push(c);
        this.refaire();
        break;
      }
      case 'dp-retirer': this.prop[d.cote].splice(+d.i, 1); this.refaire(); break;
      case 'dp-effacer': this.prop = { donner: [], recevoir: [] }; this.reponse = null; this.refaire(); break;
      case 'dp-carte':
        this.vise = { cote: d.cote, i: +d.i };
        this.ui.closeModal();
        this.ui.map.cv.classList.add('targeting');
        this.ui.toast(`Touchez une place ${d.cote === 'donner' ? 'à vous' : deNom(this.nom(this.cible))}.`);
        break;
      case 'dp-proposer': {
        const C = this.R.CLAUSES, clauses = { donner: this.prop.donner.map(c => clausePourMoteur(c, C)), recevoir: this.prop.recevoir.map(c => clausePourMoteur(c, C)) };
        this.reponse = null;
        const r = await this.envoyer({ sub: 'proposer', clauses });
        this.reponse = { cible: this.cible, ok: !!r.ok, msg: r.msg || '' };
        if (r.ok) this.prop = { donner: [], recevoir: [] };
        this.refaire();
        break;
      }
      case 'dp-ult-type': this.ult.type = d.v; this.refaire(); break;
      case 'dp-ultimatum': {
        const u = this.ult, e = u.type === 'region' ? { type: 'region', node: u.node } : u.type === 'tribut' ? { type: 'tribut', montant: u.montant, tours: u.tours } : { type: 'rompre', allie: u.allie };
        if (e.node == null && u.type === 'region') break;
        if (!confirm(`Adresser un ultimatum à ${this.nom(this.cible)} : ${this.texteExigence(e).replace('votre alliance', 'son alliance')} ?`)) break;
        this.envoyer({ sub: 'ultimatum', exigence: e });
        break;
      }
      case 'dp-appel': this.envoyer({ sub: 'appel', contre: document.getElementById('dp-a-contre')?.value }); break;
      case 'dp-rep': {
        const p = this.st.proposals.find(x => x.id === d.id);
        if (p?.action === 'appel' && d.v === '1' && !confirm(`Déclarer la guerre à ${this.nom(p.contre)} ?`)) break;
        await this.ui.cmd({ cmd: 'diplo', sub: 'repondre', id: d.id, accepte: d.v === '1' });
        if (this.ui.modal === 'negocier') this.refaire();
        break;
      }
      case 'dp-liberer':
        if (!confirm(`Rendre sa liberté à ${this.nom(d.c)} ? Son tribut cesse.`)) break;
        this.ui.cmd({ cmd: 'diplo', sub: 'proposer', cible: d.c, clauses: { donner: [{ type: 'independance' }], recevoir: [] } });
        break;
      case 'dp-independance':
        // la demande d'indépendance : une proposition à son protecteur, à compléter (argent, tribut…)
        this.ouvrir(d.c, 'proposer');
        if (!this.prop.recevoir.some(c => c.type === 'independance')) this.prop.recevoir.push({ type: 'independance' });
        this.refaire();
        break;
    }
  }
  // la place touchée sur la carte pour une clause « région » (true : le toucher est pris)
  tap(e) {
    const v = this.vise;
    if (!v) return false;
    this.vise = null;
    this.ui.map.cv.classList.remove('targeting');
    const c = this.prop[v.cote]?.[v.i];
    const n = e.hit?.kind === 'node' ? e.hit.id : null;
    const qui = v.cote === 'donner' ? this.st.me.code : this.cible;
    if (c && n != null && this.places(qui).includes(n)) c.node = n;
    else this.ui.toast(`Ce n’est pas une place ${v.cote === 'donner' ? 'que vous pouvez céder' : `que ${this.nom(this.cible)} peut céder`}.`, 'bad');
    this.oublier();
    this.ui.openModal('negocier');
    return true;
  }
}

// « de » élidé, comme rules.de : de Prusse, d’Espagne, du Portugal
function deNom(n) {
  return /^Le /.test(n) ? 'du ' + n.slice(3) : /^Les /.test(n) ? 'des ' + n.slice(4) : /^[aeiouyhâàéèêîïôöûü]/i.test(n) ? `d’${n}` : `de ${n}`;
}
