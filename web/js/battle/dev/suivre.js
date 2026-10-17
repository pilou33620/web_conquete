// Scénario pour dev/capture.mjs (--js "$(cat web/js/battle/dev/suivre.js)") : relance le temps, fait marcher une ligne
// de ses troupes (a) et charger ou courir un autre régiment (b), puis suit l'un d'eux de près. Réglages, à poser avant
// dans --js : __focus 'b' (suivre b), __zoom (part du zoom maximal, 0,6), __yaw (écart au cap qui le regarde de face),
// __wait (ms avant de suivre), __speed (vitesse du jeu).
// La caméra est posée directement (sur le Pi, une image toutes les 2 à 4 s : moveCam n'arriverait pas à temps), et
// focusMine est neutralisé (il recadrerait toutes les troupes). La maquette ne bouge que sur ordre ; l'ennemi caché par
// le brouillard ne peut pas être chargé (b court alors droit devant).
const v = __btView; v.focusMine = () => {}; await v.cmd('speed', { v: +(window.__speed || 1) });
const inf = s => v.st.units.filter(u => u.side === s && !['artillerie', 'general', 'cavalerie'].includes(u.cls) && u.state !== 'hors');
const mine = inf(0), foes = inf(1), a = mine.find(u => u.form === 'ligne') || mine[0], b = mine.find(u => u !== a && u.form !== 'tirailleurs') || mine[1];
await v.cmd('order', { units: [a.id], kind: 'move', x: a.x + Math.cos(a.dir) * 600, y: a.y + Math.sin(a.dir) * 600 });
const t = foes.reduce((p, e) => (!p || Math.hypot(e.x - b.x, e.y - b.y) < Math.hypot(p.x - b.x, p.y - b.y) ? e : p), null);
if (t) await v.cmd('order', { units: [b.id], kind: 'charge', target: t.id });
else await v.cmd('order', { units: [b.id], kind: 'move', run: true, x: b.x + Math.cos(b.dir) * 600, y: b.y + Math.sin(b.dir) * 600 });
await new Promise(r => setTimeout(r, +(window.__wait || 1500)));
const id = String(window.__focus === 'b' ? b.id : a.id);
// suivre : la caméra posée sur lui à chaque demi-seconde (sur le Pi, une image toutes les 2 à 4 s)
for (let k = 0; k < 12; k++) {
  const w = v.units.get(id);
  v.camAnim = null; v.cam = { x: w.x, y: w.y, z: v.maxZ() * (window.__zoom || 0.6), yaw: Math.atan2(Math.cos(w.dir), -Math.sin(w.dir)) + Math.PI + (window.__yaw ?? 0.6) }; v.clampCam();
  await new Promise(r => setTimeout(r, 500));
}
const w = v.units.get(id);
return [w.name, w.state, w.form];
