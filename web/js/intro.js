// Cinématique d'ouverture (≈ 11 s) : la caméra s'élève de Bordeaux à toute l'Aquitaine, trois cartons, puis le titre.
// Un appui ou une touche la passe ; « mouvement réduit » la saute.
const DUREE = 11000;

export function intro(map, nodes) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const cap = nodes.find(n => n.type === 'capitale' && n.dept === '33') || nodes.find(n => n.type === 'capitale');
  const z0 = Math.min(map.vw / map.W, map.vh / map.H);
  map.moveTo(cap.x, cap.y, z0 * 4, true);
  map.moveTo(map.W / 2, map.H / 2, z0 * 0.96, false, DUREE - 1500);

  const el = document.createElement('div');
  el.id = 'intro';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Introduction — touchez pour passer');
  el.innerHTML = `
    <div class="in-bande"></div><div class="in-bande bas"></div>
    <p class="in-carton" style="--d:.5s">Aquitaine, 1700</p>
    <p class="in-carton" style="--d:3s">Seigneurs, villes et provinces se disputent le Sud-Ouest.</p>
    <p class="in-carton" style="--d:5.5s">Deux siècles de guerres, d’alliances et de révolutions.</p>
    <h1 class="in-titre">Conquête</h1>
    <span class="in-passer">Touchez pour passer</span>`;
  document.getElementById('app').appendChild(el);

  return new Promise(done => {
    let fini = false;
    const fin = () => {
      if (fini) return;
      fini = true;
      clearTimeout(t);
      removeEventListener('keydown', fin);
      el.classList.add('sortie');
      setTimeout(() => el.remove(), 500);
      done();
    };
    const t = setTimeout(fin, DUREE);
    el.addEventListener('pointerdown', fin);
    addEventListener('keydown', fin);
  });
}
