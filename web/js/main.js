import { MapView } from './map.js';
import { UI } from './ui.js';

const api = {
  get: u => fetch(u, { cache: 'no-store' }).then(r => r.json()),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()),
};

// Safari (iPad) : empêche le zoom de la page entière, la carte gère elle-même le pincement
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

let ui, map, seq = 0, polling = false, running = false, timer = null;
let epoch = 0, lost = false;   // epoch : change à chaque resetUI, pour jeter les réponses d'une ancienne partie

async function poll() {
  if (!running || polling) return;
  polling = true;
  const ep = epoch;
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
  if (st && st.game === null) {   // le serveur n'a plus de partie : retour à l'écran de départ
    resetUI();
    showStart();
    ui.toast('Aucune partie en cours sur le serveur.');
    return;
  }
  if (!st || !st.me) return;
  seq = st.seq;
  try { ui.update(st); } catch (e) { console.error(e); }
}

function startPolling() {
  running = true;
  if (!timer) timer = setInterval(poll, 250);
  poll();
}

function resetUI() {
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
  lt.textContent = 'Peinture du terrain…';
  await new Promise(r => setTimeout(r, 30));
  map = new MapView(document.getElementById('map'), payload);
  ui = new UI(map, payload.rules, payload.map, api);
  ui.onRefresh = () => setTimeout(poll, 60);
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
    ui.toast('La partie est en pause. Choisissez une vitesse en haut pour lancer le temps.');
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
    if (e.hit && e.hit.kind === 'node') ui.pickDept(payload.map.nodes[e.hit.id].dept);
  };
  let info;
  try { info = await api.get('/api/saves'); } catch (e) {
    lt.textContent = 'Le serveur ne répond plus. Relancez « python server.py » puis rechargez la page.';
    return;
  }
  document.getElementById('loading').hidden = true;
  await showStart(info);
}

boot().then(() => { window.__ui = ui; });
