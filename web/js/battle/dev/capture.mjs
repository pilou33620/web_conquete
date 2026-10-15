#!/usr/bin/env node
// Capture d'écran du banc d'essai de la bataille, par Chromium sans écran (sans dépendance : le protocole DevTools
// passe par un tube, --remote-debugging-pipe). Lance sa propre maquette (dev/maquette.mjs) sur un port libre.
//
//   node web/js/battle/dev/capture.mjs bocage /tmp/bocage.png
//   node web/js/battle/dev/capture.mjs vignes /tmp/v.png --q "season=automne&hour=18&avance=600" --wait 6000 \
//        --js "__btView.moveCam(1500, 1000, 3)" --size 1280x800
//
// Options : --q (paramètres de banc.html, en plus de scen et start=1 ; start=0 pour le déploiement), --js (code lancé quand la bataille est prête ;
// window.__btView est la vue), --wait (ms avant la capture, défaut 4000), --size (défaut 1400x800), --dpr (densité de pixels, défaut 1 ; 2 comme un écran Retina), --gpu (essayer la
// carte graphique au lieu de SwiftShader), --nogl (sans WebGL : le message et la résolution automatique), --qualite basse|moyenne|haute|ultra (défaut haute, choisie « à la main » : la
// mesure des images par seconde, très lente sans carte graphique, ne la fait pas descendre).
// Gestes, après --js (de vrais événements, comme une souris ou des doigts) :
//   --drag x0,y0,x1,y1 (ou --drag js : les coordonnées sont lues dans window.__drag), --button left|right|middle,
//   --hold (capture avant de relâcher : la flèche d'ordre est encore tracée) ;
//   --pinch cx,cy,r0,r1,da : deux doigts autour de (cx, cy), écartés de r0 à r1 px, tournés de da radians.
// Les erreurs de la page sont recopiées dans le terminal ; code de sortie 1 s'il y en a eu.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const scen = argv[0] || 'bocage', out = path.resolve(argv[1] || `/tmp/${scen}.png`);
const [W, H] = (opt('--size') || '1400x800').split('x').map(Number);
const wait = +(opt('--wait') || 4000), js = opt('--js'), extra = opt('--q') || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// port 0 : le système en donne un libre (plusieurs captures peuvent tourner ensemble), que la maquette annonce
const maq = spawn(process.execPath, [path.join(here, 'maquette.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((ok, ko) => { maq.stdout.once('data', d => ok(+String(d).match(/127\.0\.0\.1:(\d+)/)[1])); maq.once('exit', () => ko(new Error('maquette arrêtée'))); });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'));
const gl = argv.includes('--nogl') ? ['--disable-3d-apis'] : argv.includes('--gpu') ? ['--use-angle=gles', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// (--password-store=basic : sans lui, Chromium attend le trousseau du bureau, verrouillé, avant toute requête)
const chrome = spawn(process.env.CHROMIUM || 'chromium', ['--headless=new', '--no-sandbox', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--password-store=basic',
  `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', ...gl], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

// protocole DevTools : messages JSON terminés par un octet nul
let seq = 0, buf = '';
const waiting = new Map(), errors = [];
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', d => {
  buf += d;
  for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.ko(new Error(m.error.message)) : w.ok(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(`[console.${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description).join(' '));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon\.ico$/.test(m.params.entry.url || '')) errors.push(`[log] ${m.params.entry.text} ${m.params.entry.url || ''}`);
  }
});
const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
  const id = ++seq;
  waiting.set(id, { ok, ko });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const done = code => {
  maq.kill();
  chrome.once('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { console.error('profil laissé :', profile); }   // (encore occupé quand le Pi est chargé)
    process.exit(code);
  });
  chrome.kill();
};
setTimeout(() => { console.error('Délai dépassé.'); done(2); }, +(opt('--timeout') || 300000));

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Runtime.enable'); await s('Log.enable'); await s('Page.enable');
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('conquete.bataille.qualite', '${opt('--qualite') || 'haute'}'); } catch (e) {}` });
  await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +(opt('--dpr') || 1), mobile: false });
  const q = new URLSearchParams(`scen=${scen}${/(^|&)start=/.test(extra) ? '' : '&start=1'}${extra ? '&' + extra : ''}`);   // (start=0 : déploiement)
  await s('Page.navigate', { url: `http://127.0.0.1:${port}/js/battle/dev/banc.html?${q}` });
  const evalJs = async expr => (await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  for (let t = 0; (await evalJs('document.title')) !== 'pret'; t += 250) {
    if (t > 120000) throw new Error('le banc ne s’est pas ouvert');
    await sleep(250);
  }
  console.log('WebGL 2 :', (await evalJs("!!document.createElement('canvas').getContext('webgl2')")) ? 'oui' : 'non');
  await sleep(wait);
  if (js) { const r = await evalJs(`(async () => { ${js.includes('return') ? js : 'return ' + js} })()`); if (r !== undefined) console.log('js →', JSON.stringify(r)); await sleep(1500); }
  const drag = opt('--drag');
  if (drag) {
    const [x0, y0, x1, y1] = drag === 'js' ? await evalJs('window.__drag') : drag.split(',').map(Number);
    const button = opt('--button') || 'left', buttons = { left: 1, right: 2, middle: 4 }[button];
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button, buttons, clickCount: 1 });
    for (let k = 1; k <= 12; k++) { await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * k / 12, y: y0 + (y1 - y0) * k / 12, button, buttons }); await sleep(40); }
    if (!argv.includes('--hold')) await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button, buttons: 0, clickCount: 1 });
    await sleep(2000);
  }
  const pinch = opt('--pinch');
  if (pinch) {
    const [cx, cy, r0, r1, da] = pinch.split(',').map(Number);
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const pts = k => { const r = r0 + (r1 - r0) * k, a = da * k; return [{ x: cx - Math.cos(a) * r, y: cy - Math.sin(a) * r, id: 1 }, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, id: 2 }]; };
    await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    for (let k = 1; k <= 15; k++) { await s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k / 15) }); await sleep(40); }
    await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(2000);
  }
  const shot = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`Capture : ${out}`);
} catch (e) { errors.push('capture : ' + e.message); }
for (const e of errors) console.error('ERREUR', e);
done(errors.length ? 1 : 0);
