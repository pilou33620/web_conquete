import { MapView } from './map.js';
import { UI } from './ui.js';
import { Bataille } from './battle/bataille.js';

const api = {
  get: u => fetch(u, { cache: 'no-store' }).then(r => r.json()),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()),
};

// Safari (iPad) : empêche le zoom de la page entière, la carte gère elle-même le pincement
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

let ui, map, seq = 0, polling = false, running = false, timer = null;
let bataille = null;   // vue de bataille tactique : pendant qu'elle est ouverte, la campagne n'est plus interrogée
let skirmishBid = null;   // mode Bataille : la bataille isolée en cours (au retour, l'écran de départ)
let epoch = 0, lost = false;   // epoch : change à chaque resetUI, pour jeter les réponses d'une ancienne partie
let bootVer, reloading = false;  // version du serveur au chargement de la page

// le serveur a été relancé sur une nouvelle version : cette page tourne encore avec l'ancien code
function checkVersion(ver) {
  if (!ver || bootVer === undefined || ver === bootVer || reloading) return reloading;
  reloading = true;
  ui && ui.toast('Nouvelle version du jeu installée : la page va se recharger.', 'good');
  setTimeout(() => location.reload(), 2500);   // la partie est sur le serveur : rien n'est perdu
  return true;
}

async function poll() {
  if (!running || polling || (bataille && bataille.active)) return;
  polling = true;
  const ep = epoch, cs = ui.cmdSeq;   // cs : un ordre envoyé pendant la requête rend cet état périmé
  let st;
  try {
    st = await api.get(`/api/state?since=${seq}`);
  } catch (e) {
    // un seul message par coupure
    if (!lost && ep === epoch) ui && ui.toast('Connexion au serveur perdue. Relancez « python server.py ».', 'bad');
    lost = true;
    return;
  } finally {
    polling = false;
  }
  if (lost) { lost = false; ui.toast('Connexion au serveur rétablie.', 'good'); }
  if (ep !== epoch || !running) return;
  if (ui.cmdSeq !== cs) { setTimeout(poll, 40); return; }   // état d’avant l’ordre (fin du mois…) : on le redemande
  if (st && checkVersion(st.ver)) return;
  if (st && st.game === null) {   // le serveur n'a plus de partie : retour à l'écran de départ
    resetUI();
    showStart();
    ui.toast('Aucune partie en cours sur le serveur.');
    return;
  }
  if (!st || !st.me) return;
  seq = st.seq;
  try { ui.update(st); } catch (e) { console.error(e); }
  // une bataille tactique du joueur se livre : la carte zoome vers elle et la vue de bataille prend la main
  if (bataille && bataille.wants(st.tac)) bataille.enter(st.tac, st);
}

function startPolling() {
  running = true;
  if (!timer) timer = setInterval(poll, 250);
  poll();
}

function resetUI() {
  if (bataille && bataille.active) bataille.abort();
  epoch++;
  running = false;
  seq = 0;
  ui.st = null;
  ui.events = [];
  ui.overShown = false;
  ui.select(null);
  ui.closeModal();
  map.selection = null;
  map.showPreview();
  for (const id of ['topbar', 'rail', 'feed', 'zoombar']) document.getElementById(id).hidden = true;
  document.getElementById('proposals').innerHTML = '';
  document.getElementById('proposals').dataset.sig = '';
  document.getElementById('feed').dataset.sig = '';
}

async function showStart(info) {
  if (!info) try { info = await api.get('/api/saves'); } catch (e) { info = null; }
  if (!info) ui.toast('Serveur injoignable : liste des sauvegardes indisponible.', 'bad');
  if (info && info.update) checkVersion(info.update.version);
  ui.showStart(info || { saves: [], running: false });
  const side = window.innerWidth > 760 ? Math.min(470, Math.max(320, window.innerWidth * 0.33)) : 0;
  map.fitAll(false, side, 20);
}

async function boot() {
  const lt = document.getElementById('loading-text');
  let payload;
  try {
    payload = await api.get('/api/map');
  } catch (e) {
    lt.textContent = 'Impossible de joindre le serveur. Lancez « python server.py » puis rechargez la page.';
    return;
  }
  bootVer = payload.ver;
  lt.textContent = 'Peinture du terrain…';
  await new Promise(r => setTimeout(r, 30));
  map = new MapView(document.getElementById('map'), payload);
  ui = new UI(map, payload.rules, payload.map, api);
  ui.onRefresh = () => setTimeout(poll, 60);
  // bataille tactique : ouverte au choix « Commander la bataille » (ui.js) ou quand l'état l'annonce (poll)
  bataille = new Bataille({
    api, map,
    onEnd: (res, bid, msg) => {
      if (skirmishBid && bid === skirmishBid) {
        skirmishBid = null;
        if (msg) ui.toast(msg, 'bad');
        showStart();
        return;
      }
      if (msg) ui.toast(msg, 'bad');
      else if (res && res.title) ui.toast(`${res.title} — la campagne attend vos ordres.`, res.won ? 'good' : '');
      setTimeout(poll, 60);
    },
  });
  ui.onTactic = bid => { if (bid != null && bataille.wants({ bid, phase: 'deploiement' })) bataille.enter({ bid, phase: 'deploiement' }, ui.st); };
  ui.onStartGame = async (dept, difficulty, scenario) => {
    if (!dept) return;
    let r;
    try { r = await api.post('/api/new', { dept, difficulty, scenario }); } catch (e) { return ui.toast('Serveur injoignable : la partie n’a pas pu commencer.', 'bad'); }
    if (!r.ok) return ui.toast(r.msg, 'bad');
    resetUI();
    ui.hideStart();
    const cap = payload.map.nodes.find(n => n.type === 'capitale' && n.dept === dept);
    map.moveTo(cap.x, cap.y, 7);
    startPolling();
    setTimeout(() => ui.select({ kind: 'node', id: cap.id }), 600);
    ui.toast('Donnez vos ordres : ils s’exécutent tout de suite. Puis touchez « Tour suivant » en haut : les IA jouent, et c’est le mois suivant.');
  };
  const focusCapital = async () => {
    let st;
    try { st = await api.get('/api/state'); } catch (e) { return; }
    if (!st || !st.me) return;
    const cap = payload.map.nodes.find(n => n.type === 'capitale' && n.dept === st.me.code);
    if (cap) map.moveTo(cap.x, cap.y, 5, true);
  };
  ui.onResume = async () => { resetUI(); ui.hideStart(); await focusCapital(); startPolling(); };
  ui.onLoad = async name => {
    let r;
    try { r = await api.post('/api/load', { name }); } catch (e) { return ui.toast('Serveur injoignable : sauvegarde non chargée.', 'bad'); }
    ui.toast(r.msg, r.ok ? 'good' : 'bad');
    if (!r.ok) return;
    resetUI();
    ui.hideStart();
    await focusCapital();
    startPolling();
  };
  ui.onNewGame = async () => {
    try { await api.post('/api/cmd', { cmd: 'speed', value: 0 }); } catch (e) { return ui.toast('Serveur injoignable : impossible de quitter la partie.', 'bad'); }
    resetUI();
    showStart();
  };
  ui.onStartTap = e => {
    if (!e.hit || e.hit.kind !== 'node') return;
    if (ui.startMode === 'bataille') ui.skPickNode(e.hit.id);
    else ui.pickDept(payload.map.nodes[e.hit.id].dept);
  };
  // mode Bataille : une bataille isolée, sans campagne (la campagne en cours reste telle quelle sur le serveur)
  ui.skOpts = payload.skirmish || null;
  ui.onStartSkirmish = async cfg => {
    let r;
    try { r = await api.post('/api/skirmish', cfg); } catch (e) { return ui.toast('Serveur injoignable : la bataille n’a pas pu commencer.', 'bad'); }
    if (!r.ok) return ui.toast(r.msg, 'bad');
    resetUI();
    ui.hideStart();
    skirmishBid = String(r.bid);
    bataille.closed.delete(skirmishBid);
    bataille.enter({ bid: r.bid, phase: 'deploiement' }, null);
  };
  let info;
  try { info = await api.get('/api/saves'); } catch (e) {
    lt.textContent = 'Le serveur ne répond plus. Relancez « python server.py » puis rechargez la page.';
    return;
  }
  document.getElementById('loading').hidden = true;
  await showStart(info);
  announceUpdate(info.update);
}

// « Jeu mis à jour » : une seule fois par version sur cet appareil
function announceUpdate(u) {
  if (!u || u.status !== 'mis_a_jour') return;
  let seen = null;
  try { seen = localStorage.getItem('conquete-maj-vue'); } catch (e) { /* stockage indisponible */ }
  if (seen === u.version) return;
  ui.toast(`Jeu mis à jour : ${u.n} ${u.n > 1 ? 'nouveautés' : 'nouveauté'}.`, 'good');
  try { localStorage.setItem('conquete-maj-vue', u.version); } catch (e) { /* tant pis */ }
}

boot().then(() => { window.__ui = ui; });
