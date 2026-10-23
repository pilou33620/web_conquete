// Lot de dessins de la carte de campagne : il imite le contexte 2D (le peu qu'emploient moulins, voyageurs, habitants
// et drapeaux) mais range chaque trait dans un tracé commun, par style et par rang dans sa figure, puis dessine chaque
// tracé d'un coup. Des milliers de petits fill et stroke débordaient la carte graphique (Intel Iris Xe, 3440×1440 :
// 6 000 opérations par image). Le rang garde l'ordre de chaque figure (le toit sur le mur, l'aile sur le toit) ;
// seules deux figures qui se chevauchent peuvent changer d'ordre entre elles.
// Les points sont mis dans le repère final au fur et à mesure (déplacement, rotation, échelle uniforme, miroir).
export class Lot {
  constructor() {
    this.m = new DOMMatrix(); this.stack = []; this.ranks = []; this.k = 0; this.c = [];
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter'; this.globalAlpha = 1;
  }
  next() { this.k = 0; }   // nouvelle figure
  save() { this.stack.push([this.m, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.globalAlpha]); }
  restore() {
    const s = this.stack.pop();
    if (s) [this.m, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.globalAlpha] = s;
  }
  translate(x, y) { this.m = this.m.translate(x, y); }
  scale(x, y) { this.m = this.m.scale(x, y); }
  rotate(a) { this.m = this.m.rotate(a * 180 / Math.PI); }
  getTransform() { return this.m; }
  beginPath() { this.c = []; }
  moveTo(x, y) { const m = this.m; this.c.push(0, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f); }
  lineTo(x, y) { const m = this.m; this.c.push(1, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f); }
  quadraticCurveTo(cx, cy, x, y) {
    const m = this.m;
    this.c.push(2, m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  }
  closePath() { this.c.push(3); }
  arc(x, y, r, a0, a1, ccw = false) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
    // (dans un miroir, l'angle φ devient π − φ et le sens s'inverse)
    const m = this.m, det = m.a * m.d - m.b * m.c, s = Math.sqrt(Math.abs(det));
    const mir = det < 0, th = mir ? Math.atan2(-m.b, -m.a) : Math.atan2(m.b, m.a);
    this.c.push(4, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, rx * s, ry * s,
      mir ? th - rot : th + rot, mir ? Math.PI - a0 : a0, mir ? Math.PI - a1 : a1, mir ? !ccw : ccw);
  }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  fillRect(x, y, w, h) { const keep = this.c; this.c = []; this.rect(x, y, w, h); this.put(true); this.c = keep; }
  fill() { this.put(true); }
  stroke() { this.put(false); }

  put(fill) {
    const m = this.m, style = fill ? this.fillStyle : this.strokeStyle, a = this.globalAlpha;
    const lw = fill ? 0 : this.lineWidth * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), cap = this.lineCap, join = this.lineJoin;
    const list = this.ranks[this.k] || (this.ranks[this.k] = []);
    // (un dégradé est un objet : comparé par identité, il n'est jamais mis en commun avec un autre)
    let b = list.find(b => b.fill === fill && b.style === style && b.alpha === a && (fill || (b.lw === lw && b.cap === cap && b.join === join)));
    if (!b) list.push(b = { fill, style, alpha: a, lw, cap, join, p: new Path2D() });
    // (le tracé commun continue celui d'autres figures : le premier point de celle-ci ouvre un nouveau morceau)
    const p = b.p, c = this.c;
    for (let i = 0; i < c.length;) {
      const op = c[i];
      if (op === 0 || (op === 1 && i === 0)) { p.moveTo(c[i + 1], c[i + 2]); i += 3; }
      else if (op === 1) { p.lineTo(c[i + 1], c[i + 2]); i += 3; }
      else if (op === 2) { p.quadraticCurveTo(c[i + 1], c[i + 2], c[i + 3], c[i + 4]); i += 5; }
      else if (op === 3) { p.closePath(); i += 1; }
      else {
        const [x, y, rx, ry, rot, a0] = c.slice(i + 1, i + 7);
        if (i === 0) p.moveTo(x + rx * Math.cos(a0) * Math.cos(rot) - ry * Math.sin(a0) * Math.sin(rot), y + rx * Math.cos(a0) * Math.sin(rot) + ry * Math.sin(a0) * Math.cos(rot));
        p.ellipse(x, y, rx, ry, rot, a0, c[i + 7], c[i + 8]); i += 9;
      }
    }
    this.k++;
  }

  // dessine tout, rang après rang, dans le repère courant de ctx ; le lot repart vide
  flush(ctx) {
    const ranks = this.ranks;
    this.ranks = [];
    if (!ranks.length) return;
    ctx.save();
    for (const list of ranks) for (const b of list || []) {
      ctx.globalAlpha = b.alpha;
      if (b.fill) { ctx.fillStyle = b.style; ctx.fill(b.p); continue; }
      ctx.strokeStyle = b.style; ctx.lineWidth = b.lw; ctx.lineCap = b.cap; ctx.lineJoin = b.join; ctx.stroke(b.p);
    }
    ctx.restore();
  }
}
