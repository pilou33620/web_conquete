// Le plan de l'intérieur rejoué plus fin, de près (SPEC-CARTE-2D.md, « Livré — échelle réelle »). La peinture de
// l'intérieur (villes.js, peindreInterieurPas) s'enregistre pendant qu'elle se fait, appel par appel, dans des tableaux
// typés (envoyés tels quels à un worker, peintre-tuiles.js) ; chaque tuile ne rejoue que ce qui la touche, à sa
// résolution. Chaque tracé garde sa boîte (unités du dessin) ; les changements de repère se rejouent toujours, les
// couleurs et réglages juste avant un tracé rejoué. (setTransform n'est pas suivi : les peintres n'en font pas.)

const INF = Infinity;
// bx (boîte de chaque appel) : ≥ 0 sa boîte, -1 toujours (repère, save…), -2 réglage (posé avant le tracé suivant),
// -3 partout (clip, Path2D, texte)
export function enregistrer(g) {
  const nm = [], code = new Map(), txt = [], tcode = new Map(), img = [], op = [], kd = [], a0 = [], na = [], N = [], bx = [], BX = [], sg = [], SG = [], pile = [];
  let M = [1, 0, 0, 1, 0, 0], lw = 1, tiret = false, b = -1, X = 0, Y = 0;
  const nom = k => { let c = code.get(k); if (c === undefined) code.set(k, c = nm.push(k) - 1); return c; };
  const chaine = s => { let c = tcode.get(s); if (c === undefined) tcode.set(s, c = txt.push(s) - 1); return c; };
  const ech = () => Math.max(Math.hypot(M[0], M[1]), Math.hypot(M[2], M[3]));
  const neuve = () => BX.push(INF, INF, -INF, -INF, 0, 0) / 6 - 1;
  const pt = (x, y, r = 0) => {
    X = M[0] * x + M[2] * y + M[4]; Y = M[1] * x + M[3] * y + M[5]; r *= ech();
    const o = b * 6; if (X - r < BX[o]) BX[o] = X - r; if (Y - r < BX[o + 1]) BX[o + 1] = Y - r; if (X + r > BX[o + 2]) BX[o + 2] = X + r; if (Y + r > BX[o + 3]) BX[o + 3] = Y + r;
  };
  const rect = (x, y, w, h) => { pt(x, y); pt(x + w, y); pt(x, y + h); pt(x + w, y + h); };
  // un chemin rempli, fermé, en tirets ou fait d'autre chose que de segments se rejoue entier ; une ligne brisée qu'on
  // trace seulement, par segments
  const entier = () => { BX[b * 6 + 5] = 1; return b; };
  const seule = (f, ...a) => { const b0 = b; b = neuve(); f(...a); const o = b; b = b0; return o; };   // (la boîte d'un tracé hors chemin)
  // kd : 0 nombres, 1 une chaîne, 2 un tableau de nombres (setLineDash), 3 un objet d'abord (image, dégradé)
  const ajouter = (k, a, box) => {
    op.push(nom(k)); a0.push(N.length); bx.push(box); sg.push(-1);
    if (typeof a[0] === 'string') { kd.push(1); N.push(chaine(a[0])); na.push(1); }
    else if (Array.isArray(a[0])) { kd.push(2); N.push(...a[0]); na.push(a[0].length); }
    else if (a[0] && typeof a[0] === 'object') { kd.push(3); N.push(img.push(a[0]) - 1, ...a.slice(1)); na.push(a.length); }
    else { kd.push(0); N.push(...a); na.push(a.length); }
  };
  const rec = (k, a) => {
    let o = -1;
    switch (k) {
      case 'save': pile.push([M, lw, tiret]); break;
      case 'restore': if (pile.length) [M, lw, tiret] = pile.pop(); break;
      case 'translate': M = [M[0], M[1], M[2], M[3], M[0] * a[0] + M[2] * a[1] + M[4], M[1] * a[0] + M[3] * a[1] + M[5]]; break;
      case 'scale': M = [M[0] * a[0], M[1] * a[0], M[2] * a[1], M[3] * a[1], M[4], M[5]]; break;
      case 'rotate': { const c = Math.cos(a[0]), s = Math.sin(a[0]); M = [M[0] * c + M[2] * s, M[1] * c + M[3] * s, M[2] * c - M[0] * s, M[3] * c - M[1] * s, M[4], M[5]]; break; }
      case 'transform': M = [M[0] * a[0] + M[2] * a[1], M[1] * a[0] + M[3] * a[1], M[0] * a[2] + M[2] * a[3], M[1] * a[2] + M[3] * a[3], M[0] * a[4] + M[2] * a[5] + M[4], M[1] * a[4] + M[3] * a[5] + M[5]]; break;
      case 'beginPath': o = b = neuve(); break;
      case 'moveTo': if (b < 0) b = neuve(); pt(a[0], a[1]); o = b; break;
      case 'lineTo': { if (b < 0) b = neuve(); const x = X, y = Y; pt(a[0], a[1]); o = b; ajouter(k, a, o); sg[sg.length - 1] = SG.push(Math.min(x, X), Math.min(y, Y), Math.max(x, X), Math.max(y, Y)) / 4 - 1; return; }
      case 'quadraticCurveTo': case 'bezierCurveTo': if (b < 0) b = neuve(); for (let i = 0; i < a.length; i += 2) pt(a[i], a[i + 1]); o = entier(); break;
      case 'arcTo': if (b < 0) b = neuve(); pt(a[0], a[1], a[4]); pt(a[2], a[3], a[4]); o = entier(); break;
      case 'arc': if (b < 0) b = neuve(); pt(a[0], a[1], a[2]); o = entier(); break;
      case 'ellipse': if (b < 0) b = neuve(); pt(a[0], a[1], Math.max(a[2], a[3])); o = entier(); break;
      case 'rect': case 'roundRect': if (b < 0) b = neuve(); rect(a[0], a[1], a[2], a[3]); o = entier(); break;
      case 'closePath': o = b < 0 ? -1 : entier(); break;
      case 'clip': o = -3; if (b >= 0) BX.splice(b * 6, 4, -INF, -INF, INF, INF); break;   // (le chemin du clip se rejoue partout)
      case 'fill': case 'stroke':
        if (b < 0 || (a[0] && typeof a[0] === 'object')) o = -3;
        else if (k === 'stroke') { const r = lw * ech() / 2, q = b * 6; BX[q] -= r; BX[q + 1] -= r; BX[q + 2] += r; BX[q + 3] += r; BX[q + 4] = Math.max(BX[q + 4], r); o = tiret ? entier() : b; }
        else o = entier();
        break;
      case 'fillRect': case 'strokeRect': case 'clearRect': o = seule(rect, a[0] - lw, a[1] - lw, a[2] + 2 * lw, a[3] + 2 * lw); break;
      case 'drawImage': { const n = a.length; o = n === 3 ? seule(rect, a[1], a[2], a[0].width, a[0].height) : seule(rect, a[n - 4], a[n - 3], a[n - 2], a[n - 1]); break; }
      case 'fillText': case 'strokeText': o = -3; break;
      case 'setLineDash': o = -2; tiret = a[0].length > 0; break;
      default: if (/^(create|get|is|measure)/.test(k)) return;
    }
    ajouter(k, a, o);
  };
  const P = {}, proto = Object.getPrototypeOf(g);
  for (const k of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, k);
    if (typeof d.value === 'function') P[k] = (...a) => { rec(k, a); return d.value.apply(g, a); };
    else if (d.get) Object.defineProperty(P, k, { get: () => g[k], set: v => { g[k] = v; if (k === 'lineWidth') lw = g.lineWidth; ajouter(k, [v], -2); } });
  }
  const fin = () => ({
    nm, txt, img, op: Uint8Array.from(op), kd: Uint8Array.from(kd), a0: Uint32Array.from(a0), na: Uint16Array.from(na), N: Float32Array.from(N),
    bx: Int32Array.from(bx), BX: Float32Array.from(BX), sg: Int32Array.from(sg), SG: Float32Array.from(SG),
  });
  return [P, fin];
}

// des morceaux d'une soixantaine d'appels, chacun avec sa boîte : un morceau hors de la fenêtre se saute d'un coup,
// sauf les réglages qu'il laisse (au niveau 0 de save/restore), s'il ne change pas le repère
function morceaux({ op, nm, bx, BX }) {
  const SAVE = nm.indexOf('save'), REST = nm.indexOf('restore'), c0 = [], c1 = [], cq = [], ok = [], net = [];
  let i0 = 0, d = 0, q = [INF, INF, -INF, -INF], bon = true, nt = new Map();
  for (let i = 0; i < op.length; i++) {
    const o = op[i], k = bx[i];
    if (o === SAVE) d++;
    else if (o === REST) { if (--d < 0) bon = false; }
    else if (k === -2) { if (!d) nt.set(o, i); }
    else if (k >= 0) { const j = k * 6; q[0] = Math.min(q[0], BX[j]); q[1] = Math.min(q[1], BX[j + 1]); q[2] = Math.max(q[2], BX[j + 2]); q[3] = Math.max(q[3], BX[j + 3]); }
    else if (k === -3) q = [-INF, -INF, INF, INF];
    else if (!d) bon = false;
    if ((d <= 0 && i - i0 >= 63) || i === op.length - 1) { c0.push(i0); c1.push(i + 1); cq.push(...q); ok.push(bon && !d); net.push([...nt.values()]); i0 = i + 1; d = 0; q = [INF, INF, -INF, -INF]; bon = true; nt = new Map(); }
  }
  return { c0, c1, cq: Float32Array.from(cq), ok, net };
}
const TRACE = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'clip', 'save']);
// rejoue sur g ce qui touche la fenêtre [x0, y0, x1, y1] (unités du dessin ; g porte déjà l'échelle et le décalage) ;
// d'un long trait (rivière, route, mur) seuls les segments de la fenêtre : le tracer en entier coûtait 20 ms par tuile
export function rejouer(g, R, x0, y0, x1, y1) {
  const { op, kd, a0, na, N, nm, txt, img, bx, BX, sg, SG } = R, att = new Map(), { c0, c1, cq, ok, net } = R.ch ??= morceaux(R);
  const args = i => {
    const j = a0[i], k = kd[i];
    if (k === 1) return [txt[N[j]]];
    const a = Array.from(N.subarray(j, j + na[i]));
    return k === 2 ? [a] : k === 3 ? (a[0] = img[a[0]], a) : a;
  };
  const touche = (q, o) => q[o] < x1 && q[o + 2] > x0 && q[o + 1] < y1 && q[o + 3] > y0;
  let saut = false;
  for (let c = 0; c < c0.length; c++) {
    if (ok[c] && !touche(cq, c * 4)) { for (const i of net[c]) att.set(op[i], i); continue; }
    for (let i = c0[c]; i < c1[c]; i++) {
      const k = bx[i];
      if (k === -2) { att.set(op[i], i); continue; }
      if (k >= 0 && !touche(BX, k * 6)) continue;
      const f = nm[op[i]];
      if (f === 'restore') att.clear();
      else if (att.size && TRACE.has(f)) { for (const j of att.values()) { const p = nm[op[j]], a = args(j); p === 'setLineDash' ? g.setLineDash(...a) : g[p] = a[0]; } att.clear(); }
      const s = sg[i] * 4;
      if (s >= 0 && BX[k * 6 + 5] !== 1) {
        const r = BX[k * 6 + 4];
        if (SG[s] > x1 + r || SG[s + 2] < x0 - r || SG[s + 1] > y1 + r || SG[s + 3] < y0 - r) { saut = true; continue; }
        if (saut && /^(move|line)To$/.test(nm[op[i - 1]])) g.moveTo(...args(i - 1));
        saut = false;
      }
      g[f](...args(i));
    }
  }
}
