// Qualité automatique du plateau (SPEC-EMPIRE, « Chargement et fluidité de la page ») : si les images du plateau se suivent
// trop lentement pendant quelques secondes, la qualité baisse d'un palier ; si tout va bien assez longtemps, elle remonte.
// Sans three.js ni page : testé par tests/hex.test.mjs. Le plateau (plateau.js) applique les paliers ; le réglage manuel
// (menu ☰, « Qualité du plateau ») coupe ce régulateur.

// Du meilleur au plus sobre. echelle : part de la définition de rendu du moteur ; ombres : celles du réglage du moteur
// (faux : coupées) ; habitants : les habitants et pièces mobiles des bâtiments des emplacements ; decor : décor complet
// (faux : décor clairsemé de web_engine, un arbre par hexagone de forêt, ni arbres épars, ni buissons, ni fleurs ; et pas de
// parcelles, plateau.js batir) ; vie : passants, charrettes, troupeaux ;
// cases : part du nombre de cases de la fenêtre (carte-moteur.js, NIVEAUX : des hexagones plus grands plus tôt, de loin) ;
// cadence : intervalle minimal entre deux images (ms, 0 : celui du moteur).
export const PALIERS = [
  { echelle: 1, ombres: true, habitants: true, decor: true, vie: true, cases: 1, cadence: 0 },
  { echelle: 1, ombres: false, habitants: true, decor: true, vie: true, cases: 1, cadence: 0 },
  { echelle: 0.85, ombres: false, habitants: false, decor: true, vie: true, cases: 1, cadence: 0 },
  { echelle: 0.7, ombres: false, habitants: false, decor: false, vie: true, cases: 0.5, cadence: 0 },
  { echelle: 0.6, ombres: false, habitants: false, decor: false, vie: false, cases: 0.3, cadence: 50 },
];

// Seuils (ms) sur la médiane des intervalles entre deux images du plateau, sur la dernière seconde et demie (quatre images au
// moins) :
// lent au-delà de LENT (moins de 18 images/s), à l'aise en deçà de AISE (28 images/s et plus, la cadence du réglage léger
// étant de 30) ; il faut être lent ATTENTE ms d'affilée pour baisser, à l'aise REMONTE ms pour remonter (doublé à chaque
// remontée suivie d'une rechute dans les 15 s, jusqu'à une minute). Après un changement, CALME ms sans mesure (la fenêtre
// et le décor se refont).
export const SEUILS = { LENT: 55, AISE: 36, ATTENTE: 3000, REMONTE: 10000, CALME: 2000, FENETRE: 1500 };

export class Regulateur {
  constructor(max = PALIERS.length - 1, s = SEUILS) {
    this.s = s; this.max = max; this.palier = 0;
    this.iv = []; this.tLent = null; this.tAise = null; this.tCalme = 0; this.remonte = s.REMONTE; this.tMonte = -1e9;
  }
  // une image du plateau dessinée à l'instant now (ms) ; dt : temps depuis la précédente. Rend le palier à prendre (le même
  // le plus souvent). Un intervalle de plus de 5 s (onglet caché) ne compte pas.
  noter(now, dt) {
    const s = this.s;
    if (now < this.tCalme || dt > 5000) return this.palier;
    this.iv.push([now, dt]);
    while (this.iv.length > 4 && this.iv[0][0] < now - s.FENETRE) this.iv.shift();   // (au moins quatre images, même lentes)
    if (this.iv.length < 4) return this.palier;
    const tri = this.iv.map(v => v[1]).sort((a, b) => a - b), med = tri[tri.length >> 1];
    this.tLent = med > s.LENT ? this.tLent ?? now : null;
    this.tAise = med < s.AISE ? this.tAise ?? now : null;
    if (this.tLent != null && now - this.tLent >= s.ATTENTE && this.palier < this.max) {
      if (now - this.tMonte < 15000) this.remonte = Math.min(60000, this.remonte * 2);   // (la remontée n'a pas tenu)
      return this.changer(now, this.palier + 1);
    }
    if (this.tAise != null && now - this.tAise >= this.remonte && this.palier > 0) { this.tMonte = now; return this.changer(now, this.palier - 1); }
    return this.palier;
  }
  // la fenêtre vient d'être rebâtie : l'image suivante, longue, ne compte pas
  attendre(now) { this.tCalme = Math.max(this.tCalme, now + this.s.CALME / 2); }
  // (saute : les paliers qui ne changent rien sur cet appareil, passés d'un coup)
  changer(now, p) {
    const sens = Math.sign(p - this.palier);
    while (this.saute?.has(p) && p > 0 && p < this.max) p += sens;
    this.palier = p; this.iv = []; this.tLent = this.tAise = null; this.tCalme = now + this.s.CALME;
    return p;
  }
}
