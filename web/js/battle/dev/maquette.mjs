#!/usr/bin/env node
// Serveur de maquette pour développer la vue de bataille sans le moteur Python.
//
//   node web/js/battle/dev/maquette.mjs [--port 8816] [--jeu 8817]
//
// - sert le dossier web/ ;
// - répond à /api/tactic_map, /api/tactic et à POST /api/cmd {cmd: 'tac', …} avec une bataille simulée ;
// - avec --jeu PORT, relaie tout le reste (/api/map, /api/state…) au vrai serveur (python server.py --port PORT)
//   et ajoute `tac: {bid, phase}` à /api/state quand une bataille simulée est armée : la transition depuis la
//   carte de campagne se teste alors de bout en bout ;
// - sans --jeu, la page dev/banc.html ouvre directement une bataille.
//
// Routes de développement :
//   /__maquette/nouvelle?scen=bocage|landes|vignes|montagne|assaut&season=…&weather=…&hour=…&start=1&avance=600
//   /__maquette/avance?s=120     fait avancer la bataille de 120 s de bataille d'un coup
//   /__maquette/fin              termine la bataille (victoire du joueur)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockBattle } from './simulation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', 8816), JEU = arg('--jeu', null);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const battles = new Map();
let active = null;     // bataille armée : signalée à /api/state
let pending = null;    // bataille en attente du choix manuel / automatique
const get = (bid) => {
  bid = String(bid || 'bocage');
  if (!battles.has(bid)) battles.set(bid, new MockBattle(bid));
  return battles.get(bid);
};
// comme le serveur : à ×1, une seconde réelle vaut 18 s de bataille (battle.TIME_K)
// (« Finir automatiquement » : la maquette avance la bataille d'une minute et demie par dixième de seconde)
setInterval(() => { for (const b of battles.values()) if (b.accel) b.advance(90); else if (b.speed) b.advance(0.1 * 18 * b.speed); }, 100);

const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch (e) { r({}); } }); });

function proxy(req, res, raw, patch) {
  const opt = { host: '127.0.0.1', port: +JEU, path: req.url, method: req.method, headers: { ...req.headers, 'accept-encoding': 'identity' } };
  const p = http.request(opt, r => {
    if (!patch) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    let s = ''; r.setEncoding('utf8'); r.on('data', c => s += c);
    r.on('end', () => { let o; try { o = JSON.parse(s); } catch (e) { o = null; } if (o) patch(o); json(res, o ?? {}, r.statusCode); });
  });
  p.on('error', () => json(res, { ok: false, msg: 'Jeu injoignable' }, 502));
  p.end(raw);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = Object.fromEntries(u.searchParams);
  if (u.pathname.startsWith('/__maquette/')) {
    const what = u.pathname.slice(12);
    if (what === 'nouvelle') {
      const bid = q.bid || [q.scen || 'bocage', q.season || '', q.weather || '', q.hour || ''].join('-').replace(/-+$/, '');
      const b = new MockBattle(bid, q);
      battles.set(bid, b);
      if (q.start && q.start !== '0') b.command({ sub: 'start' });
      if (q.avance) { b.speed = 0; b.advance(+q.avance); }
      if (q.speed != null) b.speed = +q.speed;
      if (q.attente) pending = b; else active = b;
      return json(res, { ok: true, bid, camp: b.map.camp });
    }
    if (what === 'avance') { const b = active || get(q.bid); const sp = b.speed; b.advance(+q.s || 60); b.speed = sp; return json(res, { ok: true, clock: b.clock }); }
    if (what === 'fin') { const b = active || get(q.bid); b.finish(+(q.winner ?? 0), !!q.disengage); return json(res, { ok: true }); }
    if (what === 'desarmer') { active = null; pending = null; return json(res, { ok: true }); }
    return json(res, { ok: false }, 404);
  }
  if (u.pathname === '/api/tactic_map') return json(res, get(q.bid).mapPayload());
  if (u.pathname === '/api/tactic') return json(res, get(q.bid).state(+q.since || 0));
  if (u.pathname === '/api/cmd' && req.method === 'POST') {
    const raw = await new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)); });
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { /* rien */ }
    if (b.cmd === 'tac') {
      if (b.sub === 'choose' && pending) { if (b.mode === 'manuel') active = pending; pending = null; return json(res, { ok: true, msg: '' }); }
      const bt = b.bid != null ? get(b.bid) : active;
      if (!bt) return json(res, { ok: false, msg: 'Aucune bataille.' });
      const r = bt.command(b);
      return json(res, r);
    }
    if (JEU) return proxy(req, res, raw);
    return json(res, { ok: true, msg: '' });
  }
  if (u.pathname === '/api/state' && JEU) {
    return proxy(req, res, null, st => {
      if (!st || !st.me) return;
      st.speed = active || pending ? 0 : st.speed;
      const b = active || pending;
      if (active && active.phase !== 'fin_vue') st.tac = { bid: active.bid, phase: active.phase };
      if (b) {
        st.battles = st.battles || [];
        st.battles.push({ id: b.bid, x: b.map.camp.x, y: b.map.camp.y, mode: active === b ? 'manuel' : 'attente', phase: 'canonnade', terrain: 'plaine', age: 0,
          node: null, amb: false, sides: [{ o: st.me.code, men: 5000, lost: 0, mor: 70, mix: {}, tac: [] }, { o: '24', men: 5000, lost: 0, mor: 70, mix: {}, tac: [] }] });
      }
    });
  }
  if (u.pathname.startsWith('/api/') && JEU) return proxy(req, res, null);
  if (u.pathname.startsWith('/api/')) return json(res, { ok: false, msg: 'Maquette : route non simulée.' }, 404);
  // fichiers statiques
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(WEB, p));
  if (!full.startsWith(WEB) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('Introuvable'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => console.log(`Maquette de bataille : http://127.0.0.1:${PORT}/  (banc : /js/battle/dev/banc.html)${JEU ? `, jeu relayé sur le port ${JEU}` : ''}`));

// fin de partie : quand la vue a montré le récapitulatif et rendu la main, la bataille cesse d'être signalée
export function _desarmer() { active = null; }
// le client signale la fin en interrogeant /api/tactic après la phase 'fin' : la maquette désarme après 30 s
setInterval(() => { if (active && active.phase === 'fin') { active._finT = (active._finT || 0) + 1; if (active._finT > 300) active = null; } }, 100);
