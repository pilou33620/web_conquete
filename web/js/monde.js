// La carte Monde (SPEC-EMPIRE, module 3, page P2) : le sélecteur de théâtre (Amérique, Europe, Inde : la caméra va sur
// le cadre du théâtre, map.theatres) et la mini-carte des trois (terres, cadres, la vue en cours ; un toucher y mène).
// Les balises des routes maritimes et les comptoirs sont dessinés sur le plateau par marine.js (hex/marine.js).
const LW = 210, LH = 100;   // la mini-carte, en pixels

export class Monde {
  constructor(map, md) {
    this.map = map; this.T = md.theatres || [];
    if (!this.T.length) return;
    const box = this.box = document.createElement('div');
    box.id = 'monde';
    box.innerHTML = `<span class="seg" role="group" aria-label="Théâtre">${this.T.map(t => `<button data-th="${t.id}" title="Aller en ${t.nom}">${t.nom}</button>`).join('')}</span>
      <canvas width="${LW}" height="${LH}" role="img" aria-label="Mini-carte des trois théâtres : touchez pour y aller"></canvas>`;
    document.getElementById('app').appendChild(box);
    this.cv = box.querySelector('canvas');
    box.addEventListener('click', e => { const b = e.target.closest('[data-th]'); if (b) this.aller(b.dataset.th); });
    this.cv.addEventListener('click', e => {
      const r = this.cv.getBoundingClientRect();
      this.map.moveTo((e.clientX - r.left) / r.width * map.W, (e.clientY - r.top) / r.height * map.H, this.map.cam.z);
    });
    this.fond = this.peindre();
    this.cle = '';
    setInterval(() => this.vue(), 300);
  }
  // la caméra sur tout le théâtre
  aller(id) {
    const t = this.T.find(x => x.id === id), m = this.map;
    if (!t) return;
    const [x, y, w, h] = t.cadre;
    m.moveTo(x + w / 2, y + h / 2, Math.min(m.vw / w, m.vh / (h * m.K)) * 0.92);
  }
  // les terres de la grille, une case sur quelques-unes (une fois)
  peindre() {
    const m = this.map, img = new ImageData(LW, LH);
    for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
      const x = Math.floor((i + 0.5) * m.W / LW), y = Math.floor((j + 0.5) * m.H / LH), terre = m.terrain[y * m.W + x] > 1, k = (j * LW + i) * 4;
      [img.data[k], img.data[k + 1], img.data[k + 2], img.data[k + 3]] = terre ? [176, 164, 120, 255] : [29, 58, 82, 255];
    }
    return img;
  }
  // les cadres des théâtres et la vue en cours (refaits quand la caméra bouge) ; le bouton du théâtre regardé allumé
  vue() {
    const m = this.map, [x0, y0] = m.toWorld(0, 0), [x1, y1] = m.toWorld(m.vw, m.vh), cle = [x0, y0, x1, y1].map(v => Math.round(v)).join();
    if (cle === this.cle || this.box.offsetParent === null) return;
    this.cle = cle;
    const g = this.cv.getContext('2d'), kx = LW / m.W, ky = LH / m.H, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    g.putImageData(this.fond, 0, 0);
    g.font = '600 10px sans-serif'; g.textBaseline = 'top';
    let ici = null;
    for (const t of this.T) {
      const [x, y, w, h] = t.cadre;
      if (cx >= x && cx < x + w && cy >= y && cy < y + h) ici = t.id;
      g.strokeStyle = 'rgba(230,201,127,0.7)'; g.lineWidth = 1; g.strokeRect(x * kx + 0.5, y * ky + 0.5, w * kx - 1, h * ky - 1);
      g.fillStyle = '#f1ead8'; g.fillText(t.nom, x * kx + 3, y * ky + 2);
    }
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.strokeRect(Math.max(0, x0 * kx), Math.max(0, y0 * ky), Math.max(3, (Math.min(m.W, x1) - Math.max(0, x0)) * kx), Math.max(3, (Math.min(m.H, y1) - Math.max(0, y0)) * ky));
    for (const b of this.box.querySelectorAll('[data-th]')) b.classList.toggle('on', b.dataset.th === ici);
  }
}
