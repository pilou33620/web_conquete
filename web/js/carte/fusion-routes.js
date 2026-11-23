// Routes presque confondues sur la carte de secours (sans WebGL, map.js drawRoads) : deux routes qui vont côte à côte à
// quelques centaines de mètres (les troncs communs de geo.rs, _troncs, s'arrêtent au premier écart : 86 paires en Aquitaine)
// se dessinent en une seule. Chaque route (royales d'abord) reprend le tracé d'une route déjà dessinée partout où elle la
// longe, à moins d'`ecart` et à peu près parallèle, sur au moins `mini`. Seul le dessin change : le jeu (e.pts, abscisses des
// travaux, passants) garde le tracé du serveur. (Le moteur fait de même pour les théâtres, geo.rs _fusionne ; l'Aquitaine y
// reste figée : une sauvegarde refait sa carte au chargement.)

const PAS = 0.2, PARALLELE = 0.9;

// abscisses curvilignes d'une polyligne
const abscisses = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };

// le morceau de la polyligne entre les abscisses s0 et s1 (à rebours si s1 < s0)
function morceau(pts, cum, s0, s1) {
  const [a, b] = s0 <= s1 ? [s0, s1] : [s1, s0], out = [];
  const en = s => { let i = 0; while (i < pts.length - 2 && cum[i + 1] < s) i++; const L = cum[i + 1] - cum[i] || 1e-9, t = Math.min(1, Math.max(0, (s - cum[i]) / L)); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; };
  out.push(en(a));
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]);
  out.push(en(b));
  return s0 <= s1 ? out : out.reverse();
}

// Les tracés à dessiner, un par arête, dans l'ordre de edges (voies d'eau et bacs : leur tracé tel quel).
export function fusionRoutes(edges, ecart = 0.6, mini = 0.5) {
  const traces = edges.map(e => e.pts), poses = [], grille = new Map(), cle = (i, j) => i + ',' + j;
  const ordre = edges.map((e, k) => k).filter(k => edges[k].kind !== 'water' && !edges[k].ferry && edges[k].pts.length > 1)
    .sort((a, b) => (!edges[a].royal - !edges[b].royal) || a - b);
  for (const k of ordre) {
    const line = edges[k].pts, cum = abscisses(line), ech = [];   // ech : [abscisse, route posée longée ou -1, abscisse sur elle, point]
    let prec = -1;
    for (let i = 1; i < line.length; i++) {
      const [qx, qy] = line[i - 1], L = cum[i] - cum[i - 1];
      if (!L) continue;
      const ux = (line[i][0] - qx) / L, uy = (line[i][1] - qy) / L, n = Math.ceil(L / PAS);
      for (let s = 0; s < n; s++) {
        const px = qx + ux * L * s / n, py = qy + uy * L * s / n, ci = Math.floor(px), cj = Math.floor(py);
        let best = null;   // [route, distance, abscisse]
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const [r, g] of grille.get(cle(ci + di, cj + dj)) || []) {
          const P = poses[r], [ax, ay] = P.pts[g], lg = P.cum[g + 1] - P.cum[g];
          if (!lg) continue;
          const vx = (P.pts[g + 1][0] - ax) / lg, vy = (P.pts[g + 1][1] - ay) / lg;
          if (Math.abs(ux * vx + uy * vy) < PARALLELE) continue;
          const t = Math.min(lg, Math.max(0, (px - ax) * vx + (py - ay) * vy)), d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
          if (d > ecart) continue;
          // (la route déjà suivie l'emporte tant qu'elle reste assez près : deux routes déjà confondues alterneraient)
          const pref = (r === prec) - (best && best[0] === prec);
          if (!best || pref > 0 || (pref === 0 && d < best[1])) best = [r, d, P.cum[g] + t];
        }
        prec = best ? best[0] : -1;
        ech.push([cum[i - 1] + L * s / n, prec, best ? best[2] : 0, [px, py]]);
      }
    }
    // les passages qui longent une même route sur au moins mini prennent son tracé
    const runs = [];
    for (let i = 0; i < ech.length;) {
      if (ech[i][1] < 0) { i++; continue; }
      let j = i;
      while (j + 1 < ech.length && ech[j + 1][1] === ech[i][1]) j++;
      if (ech[j][0] - ech[i][0] >= mini) runs.push([i, j]);
      i = j + 1;
    }
    let trace = line;
    if (runs.length) {
      trace = [line[0]];
      const pousse = p => { const q = trace[trace.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) trace.push(p); };
      // (on quitte le tracé à son point d'échantillon et on y revient par un court raccord, presque en travers : un long
      // biseau vers l'autre route la longerait encore ; entre deux passages qui se suivent, pas de raccord)
      let fin = 0, sortie = null, dernier = -2;
      for (const [i, j] of runs) {
        const [s0, r, sf0, p0] = ech[i], [s1, , sf1, p1] = ech[j];
        if (dernier + 1 !== i) {
          if (sortie) pousse(sortie);
          for (let v = 1; v < line.length - 1; v++) if (cum[v] > fin && cum[v] < s0) pousse(line[v]);
          pousse(p0);
        }
        for (const p of morceau(poses[r].pts, poses[r].cum, sf0, sf1)) pousse(p);
        fin = s1; sortie = p1; dernier = j;
      }
      if (sortie) pousse(sortie);
      for (let v = 1; v < line.length; v++) if (cum[v] > fin) pousse(line[v]);
      if (trace.length < 2) trace.push(line[line.length - 1]);
      else trace[trace.length - 1] = line[line.length - 1];
      traces[k] = trace;
    }
    const r = poses.length, tc = abscisses(trace);
    poses.push({ pts: trace, cum: tc });
    for (let g = 0; g < trace.length - 1; g++) {
      const [ax, ay] = trace[g], [bx, by] = trace[g + 1];
      for (let i = Math.floor(Math.min(ax, bx)); i <= Math.floor(Math.max(ax, bx)); i++) for (let j = Math.floor(Math.min(ay, by)); j <= Math.floor(Math.max(ay, by)); j++) {
        const c = cle(i, j); if (!grille.has(c)) grille.set(c, []); grille.get(c).push([r, g]);
      }
    }
  }
  return traces;
}

// Le point de la polyligne le plus proche de (x, y) : un pont du serveur reporté sur le tracé dessiné.
export function surTrace(pts, x, y) {
  let best = [1e18, x, y];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best[0]) best = [d, ax + dx * t, ay + dy * t];
  }
  return { x: best[1], y: best[2] };
}
