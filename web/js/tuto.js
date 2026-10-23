// Tutoriel de la campagne (SPEC.md) : une bulle à la fois, qui pointe un élément de l'écran et attend que le joueur
// fasse l'action demandée. Les bulles qui informent seulement ont « Suivant ». Propre à chaque appareil (localStorage).
import { esc, clamp } from './battle/formes.js';

const KEY = 'conquete.tuto';

// étapes : at (sélecteur visé, ou rien : en haut de la carte), go (centrer la carte), unsel (désélectionner d'abord),
// done (l'action est faite ? rien : bouton « Suivant »), need (l'action est-elle possible ? sinon « Suivant »),
// opt (« Suivant » quand même : l'action peut manquer de ressources)
function etapes(ui) {
  const st = ui.st, me = st.me.code;
  const mine = st.armies.find(a => a.o === me && a.st !== 'battle');
  const cap = ui.md.nodes.find(n => n.type === 'capitale' && n.dept === me);
  const selMine = k => ui.sel?.kind === k && (k === 'army' ? ui.armyById(ui.sel.id)?.o : st.nodes[ui.sel.id]?.o) === me;
  const nom = ui.rules.factions[me].name;
  const tour = st.tour && st.tour.on;
  return [
    { at: '#topbar', txt: `Bienvenue ! Vous gouvernez ${nom}. En haut : la date et vos ressources (touchez-en une pour le détail). Ce guide vous montre l’essentiel ; « Passer » le ferme, le menu ☰ le rouvre.` },
    { txt: 'Touchez une de vos armées pour la choisir.', go: mine && [mine.x, mine.y], need: () => !!mine, done: () => selMine('army') },
    { txt: 'Touchez maintenant un lieu sur la carte, puis « Marcher par les routes ». Glisser depuis l’armée trace votre propre itinéraire.', need: () => selMine('army'), done: f => f.has('move') || f.has('path') },
    { txt: `Touchez votre chef-lieu, ${cap ? cap.name : ''}.`, go: cap && [cap.x, cap.y], unsel: true, need: () => !!cap && st.nodes[cap.id]?.o === me, done: () => selMine('node') },
    { at: '#panel', txt: 'Le panneau de la ville : bâtissez dans ses emplacements, levez des régiments, choisissez sa politique. Essayez : levez un régiment ou lancez une construction.', opt: true, need: () => ui.sel?.kind === 'node' && ui.sel.id === cap?.id, done: f => f.has('recruit') || f.has('build') || f.has('slot_build') },
    { at: '#rail [data-v="tech"]', txt: 'Ouvrez les Technologies : vos savants y cherchent une découverte à la fois, des armes aux routes.', done: () => ui.modal === 'tech' },
    { at: '#rail', txt: 'À côté : Diplomatie (paix, alliances, droits de passage), Commerce (le marché), Production et le Journal.' },
    { at: '#rail [data-v="production"]', txt: 'Ouvrez la Production : c’est là que se règlent les impôts.', done: () => ui.modal === 'production' },
    { at: '#rail', txt: 'Plus d’impôts, c’est plus d’argent tout de suite, mais l’ordre public baisse : une ville agitée sans garnison peut se révolter.' },
    { at: '#zb-fog', txt: 'Vous ne voyez que ce que voient vos villes, vos armées, vos alliés et vos espions. Touchez l’œil pour afficher ou masquer le brouillard. Pour espionner, choisissez une place étrangère proche de vos armées.', need: () => !!document.querySelector('#zb-fog')?.getClientRects?.().length, done: f => f.has('fog') },
    { txt: 'Fleuves : par les routes, vos armées embarquent d’elles-mêmes sur les gabares de la Garonne, de la Dordogne, de l’Adour… Tenir une place en aval coupe le commerce de l’amont (blocus).' },
    ...(tour ? [
      { at: '#tb-turn', txt: 'Vos ordres sont donnés. Touchez « Tour suivant » : les IA jouent le mois, puis c’est de nouveau à vous.', done: () => st.tour.phase !== 'ordres' },
      { at: '#tb-turn', txt: 'Les IA jouent leur tour d’un coup. Si une IA vous attaque ou si une décision vous attend, faites votre choix : le tour reprend tout seul.', done: () => st.tour.phase === 'ordres' },
      { at: '#recap', txt: 'Le récapitulatif du mois : revenus, batailles, constructions. Touchez une ligne pour y aller.', need: () => !ui.$('recap').hidden },
    ] : [
      { at: '#tb-speed', txt: 'Temps réel : la pause et les vitesses sont ici (espace, touches 1 à 6).' },
    ]),
    { txt: 'Les batailles : « Donner mes ordres » pour choisir votre plan, vos ruses et l’heure, puis regarder vos officiers la livrer ; ou laissez-la à votre général. Bonne campagne !' },
  ];
}

export class Tuto {
  constructor(ui) { this.ui = ui; this.i = -1; this.flags = new Set(); this.shown = -1; }
  // vu jusqu'au bout ou passé (un tutoriel abandonné en route reprend à la prochaine partie)
  static vu() { try { return localStorage.getItem(KEY) === 'fin'; } catch (e) { return true; } }
  get on() { return this.i >= 0; }
  start() { this.i = 0; this.shown = -1; this.flags.clear(); this.check(); }
  stop() { this.i = -1; this.hide(); try { localStorage.setItem(KEY, 'fin'); } catch (e) { /* stockage indisponible : tant pis */ } }
  hide() { const b = this.ui.$('tuto'); if (b) b.hidden = true; }
  // un ordre accepté par le serveur (move, path, recruit, build…), ou le bouton du brouillard
  signal(f) { if (this.on) { this.flags.add(f); this.check(); } }
  next() { this.i++; this.flags.clear(); this.check(); }
  // appelé à chaque état du serveur, sélection ou fenêtre : passe à la suite si l'action est faite, et place la bulle
  check() {
    const ui = this.ui;
    if (!this.on || !ui.st) return;
    const steps = etapes(ui);
    if (this.i >= steps.length) return this.stop();
    const s = steps[this.i];
    const can = !s.need || s.need();
    if (s.done && can && s.done(this.flags)) return this.next();
    // une fenêtre ouverte (ou une décision) passe avant : la bulle revient quand elle se ferme
    if (ui.modal) return this.hide();
    const b = ui.$('tuto');
    const last = this.i === steps.length - 1, wait = s.done && can && !s.opt;
    if (this.shown !== this.i || b.dataset.wait !== String(wait)) {
      if (this.shown !== this.i && s.go) ui.map.moveTo(s.go[0], s.go[1], Math.max(ui.map.cam.z, 6));
      const fresh = this.shown !== this.i;
      this.shown = this.i;
      if (fresh && s.unsel) ui.select(null);   // (une armée choisie transformerait le toucher en ordre de marche)
      b.dataset.wait = String(wait);
      b.innerHTML = `<p>${esc(s.txt)}</p><div class="btns">${last ? '' : '<button class="btn" data-act="tuto-skip">Passer</button>'}${wait ? '' : `<button class="btn primary" data-act="tuto-next">${last ? 'Compris' : 'Suivant'}</button>`}</div><span class="tuto-n">${this.i + 1} / ${steps.length}</span>`;
    }
    b.hidden = false;
    placer(b, s.at && document.querySelector(s.at));
  }
}

// la bulle sous l'élément visé (ou au-dessus s'il est en bas de l'écran), la flèche pointée sur lui ; à côté du
// panneau sur grand écran, au-dessus de lui sur petit écran ; sans élément visible : en haut de la carte, sous la barre
function placer(b, el) {
  const W = window.innerWidth, H = window.innerHeight, tw = Math.min(340, W - 24);
  b.style.width = tw + 'px';
  const r = el && !el.hidden ? el.getBoundingClientRect() : null;
  if (!r || !r.width) {
    b.classList.remove('up'); b.classList.add('free');
    const bar = document.getElementById('topbar')?.getBoundingClientRect?.();
    b.style.left = (W - tw) / 2 + 'px'; b.style.top = ((bar && bar.bottom) || 84) + 12 + 'px'; b.style.bottom = '';
    return;
  }
  if (r.height > H * 0.4 && r.width < W * 0.6) {   // le panneau sur le côté : la bulle à côté de lui
    b.classList.remove('up'); b.classList.add('free');
    b.style.left = clamp(r.left > W / 2 ? r.left - tw - 12 : r.right + 12, 12, W - tw - 12) + 'px';
    b.style.top = (r.top + 24) + 'px'; b.style.bottom = '';
    return;
  }
  b.classList.remove('free');
  const below = r.top + r.height / 2 < H / 2 && r.height < H * 0.4;   // (au-dessus d'une feuille pleine largeur)
  const x = clamp(r.left + r.width / 2 - tw / 2, 12, W - tw - 12);
  b.style.left = x + 'px';
  b.classList.toggle('up', below);
  if (below) { b.style.top = (r.bottom + 12) + 'px'; b.style.bottom = ''; }
  else { b.style.bottom = (H - r.top + 12) + 'px'; b.style.top = ''; }
  b.style.setProperty('--ax', clamp(r.left + r.width / 2 - x, 20, tw - 20) + 'px');
}
