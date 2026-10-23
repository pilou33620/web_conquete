// Banc de la carte de campagne, sur la machine du joueur : adresse terminée par #banc. Il mesure les images par
// seconde en coupant les couches une à une (vue fixe puis zoom continu), et affiche le tableau à recopier.
// Le temps entre deux images dit ce que coûte la carte graphique ; le « dessin » ce que coûte le processeur.
const PALIERS = [
  ['tout', m => m],
  ['sans animations', m => { m.ambient.under = m.ambient.over = m.ambient.drawTrains = () => {}; }],
  ['sans villes', m => { m.drawNodes = () => {}; }],
  ['sans noms des eaux', m => { m.drawWaterNames = () => {}; }],
  ['sans époque ni rails', m => { m.epoque.draw = () => {}; m.drawRails = () => {}; }],
  ['sans vignettage ni teinte', m => { m.drawVignette = () => {}; m.drawSeasonTint = () => {}; }],
  ['rien que le fond', m => { m.draw = function () { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.fillStyle = '#141618'; this.ctx.fillRect(0, 0, 50, 50); }; }],
];

function mesure(m, ms) {
  return new Promise(res => {
    let n = 0, dessin = 0;
    const d = m.draw, t0 = performance.now();
    m.draw = function (...a) { const t = performance.now(); d.apply(this, a); dessin += performance.now() - t; n++; };
    setTimeout(() => { m.draw = d; res({ ips: n / ((performance.now() - t0) / 1000), dessin: dessin / Math.max(1, n) }); }, ms);
  });
}

export async function banc(m) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;right:12px;top:48px;z-index:999;margin:0;padding:10px 14px;background:rgba(20,22,24,.94);color:#f1ead8;font:13px/1.5 monospace;border:1px solid #8a7a50;border-radius:4px;user-select:text';
  document.body.appendChild(box);
  const lignes = [`Banc de la carte — écran ${m.cv.width}×${m.cv.height}, ${m.painters.filter(w => w.ready).length} peintres`, ''];
  const montre = t => { box.textContent = lignes.concat(t || []).join('\n'); };
  const centre = { x: m.W * 0.45, y: m.H * 0.45 };
  m.cam = { ...centre, z: 8 }; m.camAnim = null;
  montre('préparation…');
  await new Promise(r => setTimeout(r, 4000));
  for (const [vue, zoom] of [['vue fixe', false], ['zoom continu', true]]) {
    lignes.push(`— ${vue} —`);
    for (const [nom, coupe] of PALIERS) {
      montre(`mesure : ${nom}…`);
      coupe(m);
      let anim = null;
      if (zoom) { let k = 0; anim = setInterval(() => { m.moveTo(centre.x, centre.y, k++ % 2 ? 4 : 16); }, 700); }
      const r = await mesure(m, 2500);
      clearInterval(anim);
      lignes.push(`${nom.padEnd(28)} ${r.ips.toFixed(0).padStart(3)} img/s   dessin ${r.dessin.toFixed(1).padStart(5)} ms`);
    }
    // tout remettre : les méthodes coupées reviennent à celles de leur classe
    for (const k of ['draw', 'drawNodes', 'drawWaterNames', 'drawRails', 'drawVignette', 'drawSeasonTint']) delete m[k];
    for (const k of ['under', 'over', 'drawTrains']) delete m.ambient[k];
    delete m.epoque.draw;
    m.cam = { ...centre, z: 8 }; m.camAnim = null;
    await new Promise(r => setTimeout(r, 2500));
  }
  lignes.push('', 'Fini : une capture de ce cadre suffit.');
  montre();
}
