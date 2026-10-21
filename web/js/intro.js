// Cinématique d'ouverture (≈ 11,5 s) : une bataille aux portes de Bordeaux en 1700, les trains de 1870 entre les villes, puis toute l'Aquitaine
// et le titre. Un appui ou une touche la passe ; « mouvement réduit » la saute.
const DUREE = 11500;

export function intro(map, nodes) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const bx = nodes.find(n => n.type === 'capitale' && n.dept === '33') || nodes.find(n => n.type === 'capitale');
  // la bataille : à mi-chemin de Bordeaux et de la place étrangère la plus proche
  const ennemi = nodes.filter(n => n.dept !== bx.dept).sort((p, q) => Math.hypot(p.x - bx.x, p.y - bx.y) - Math.hypot(q.x - bx.x, q.y - bx.y))[0];
  const bat = { x: (bx.x + ennemi.x) / 2, y: (bx.y + ennemi.y) / 2 };
  const z0 = Math.min(map.vw / map.W, map.vh / map.H);

  map.showPreview('1700');
  // une ligne de front entre les deux, et chaque armée qui y marche
  const d = Math.hypot(ennemi.x - bx.x, ennemi.y - bx.y), ux = (ennemi.x - bx.x) / d, uy = (ennemi.y - bx.y) / d;
  for (let i = -2; i <= 2; i++) map.preview.battles.push({ x: bat.x - uy * i * 1.4, y: bat.y + ux * i * 1.4 });
  const regs = ['ligne', 'ligne', 'ligne', 'cavalerie', 'artillerie'].map(t => [0, t]);
  map.preview.tokens = [[bx.dept, -1], [ennemi.dept, 1]].map(([o, k]) =>
    ({ id: o, o, men: 6400, regs, st: 'move', x: bat.x + ux * k * 5, y: bat.y + uy * k * 5, head: Math.atan2(-uy * k, -ux * k) }));
  map.moveTo(bat.x - 3, bat.y + 2, 18, true);
  map.moveTo(bat.x + 1, bat.y, 14, false, 4500);
  const scenes = [
    setTimeout(() => {   // (sous le fondu au noir)
      map.showPreview('1870');
      map.particles = [];   // (la fumée de 1700)
      map.moveTo(bx.x + 4, bx.y + 3, 18, true);
      map.moveTo(bx.x, bx.y + 2, 14, false, 4000);
    }, 4500),
    setTimeout(() => map.moveTo(map.W / 2, map.H / 2, z0 * 0.96, false, 2600), 8600),
  ];

  const el = document.createElement('div');
  el.id = 'intro';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Introduction — touchez pour passer');
  el.innerHTML = `
    <div class="in-noir"></div>
    <div class="in-bande"></div><div class="in-bande bas"></div>
    <p class="in-carton" style="--d:.6s"><b>Aquitaine, 1700</b><br>Cinq provinces se disputent le Sud-Ouest.</p>
    <p class="in-carton" style="--d:5s"><b>1870</b><br>Le chemin de fer relie les villes.</p>
    <h1 class="in-titre">Conquête</h1>
    <span class="in-passer">Touchez pour passer</span>`;
  document.getElementById('app').appendChild(el);

  return new Promise(done => {
    let fini = false;
    const fin = () => {
      if (fini) return;
      fini = true;
      clearTimeout(t);
      scenes.forEach(clearTimeout);
      removeEventListener('keydown', fin);
      map.showPreview(map.rules.scenario_order?.[0]);
      map.particles = [];   // (l'époque que l'écran de départ propose d'abord)
      el.classList.add('sortie');
      setTimeout(() => el.remove(), 500);
      done();
    };
    const t = setTimeout(fin, DUREE);
    el.addEventListener('pointerdown', fin);
    addEventListener('keydown', fin);
  });
}
