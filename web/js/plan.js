// Le plan de la position ennemie, dans la fenêtre de bataille de la campagne (ui.js, battleModal) : la vraie carte de
// la bataille en petites cases, tournée pour que vos troupes soient en bas, vos régiments, et l'ennemi tel que vos
// éclaireurs le voient (sinon sa zone, hachurée : position devinée). Données : bridge.plan_view (commande tac preview).

// couleurs des cases, dans l'ordre des types du terrain (game/tactics/terrain.py, TYPE_NAMES)
const SOL = ['#7e8c56', '#a39c62', '#8a8350', '#8f8a5e', '#3f5a32', '#2f4628', '#5f7060', '#3d6178', '#6f8fa0', '#c2ae84',
  '#a8946a', '#a4553f', '#6e5a48', '#8a6a50', '#6e5a48', '#c9b98a', '#8a8a80', '#7a5a40', '#6a8a48'];

// angle (multiple d'un quart de tour) qui met la zone du joueur en bas et celle de l'ennemi en haut
export function planAngle(p) {
  const c = z => [(z[0] + z[2]) / 2, (z[1] + z[3]) / 2];
  const [mx, my] = c(p.zones[p.me]), [ex, ey] = c(p.zones[1 - p.me]);
  const a = Math.atan2(ex - mx, -(ey - my));   // cap de vos troupes vers l'ennemi (0 : vers le haut)
  return -Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
}

export function drawPlan(cv, p) {
  const rot0 = planAngle(p), tall = Math.abs(Math.round(rot0 / (Math.PI / 2))) % 2 === 1;
  cv.classList.toggle('tall', tall);   // (un quart de tour : le plan en hauteur)
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const W = Math.round((r.width || 360) * dpr), H = Math.round((r.height || 240) * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  const mw = p.cols * p.cell, mh = p.rows * p.cell, rot = planAngle(p);
  const quarter = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
  const k = Math.min(W / (quarter ? mh : mw), H / (quarter ? mw : mh));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#1d2226'; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(rot); g.scale(k, k); g.translate(-mw / 2, -mh / 2);
  for (let j = 0; j < p.rows; j++) {
    for (let i = 0; i < p.cols; i++) {
      g.fillStyle = SOL[p.t.charCodeAt(j * p.cols + i) - 97] || SOL[0];
      g.fillRect(i * p.cell, j * p.cell, p.cell + 1, p.cell + 1);
    }
  }
  const foe = 1 - p.me, z = p.zones[foe];
  if (!p.seen) {
    // position devinée : la zone de l'ennemi, hachurée
    g.save();
    g.beginPath(); g.rect(z[0], z[1], z[2] - z[0], z[3] - z[1]); g.clip();
    g.strokeStyle = 'rgba(230,110,90,0.55)'; g.lineWidth = 2 * dpr / k;
    for (let x = z[0] - mh; x < z[2] + mh; x += 90) { g.beginPath(); g.moveTo(x, z[1]); g.lineTo(x + (z[3] - z[1]), z[3]); g.stroke(); }
    g.restore();
  }
  g.setLineDash([60, 40]); g.lineWidth = 2.5 * dpr / k; g.strokeStyle = 'rgba(230,110,90,0.9)';
  g.strokeRect(z[0], z[1], z[2] - z[0], z[3] - z[1]); g.setLineDash([]);
  for (const u of p.units) {
    const col = p.colors[u.s] || (u.s === p.me ? '#3f6fb5' : '#b8352a');
    const w = Math.max(u.w, 60), d = Math.max(u.d, 24);
    g.save(); g.translate(u.x, u.y); g.rotate(u.r + Math.PI / 2);
    g.fillStyle = col; g.strokeStyle = 'rgba(10,10,10,0.85)'; g.lineWidth = 1.5 * dpr / k;
    g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d);
    // le signe de l'arme, comme sur les cartes d'état-major : une diagonale (cavalerie), un point (artillerie)
    g.strokeStyle = g.fillStyle = 'rgba(255,255,255,0.9)';
    if (u.c === 'cavalerie') { g.beginPath(); g.moveTo(-w / 2, d / 2); g.lineTo(w / 2, -d / 2); g.stroke(); }
    else if (u.c === 'artillerie') { g.beginPath(); g.arc(0, 0, d / 3, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}
