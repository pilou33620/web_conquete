// Ce qui erre sur le champ de bataille après les coups : chevaux sans cavalier qui s'enfuient puis broutent, blessés
// qui rampent vers l'arrière ou se relèvent et s'en vont en boitant, brancardiers qui viennent ramasser ceux qui ne
// bougent plus. Affichage seul : rien ici ne touche aux règles (les pertes sont celles du moteur). La logique est à
// part du dessin (hex/troupes3d.js, errants) pour se tester sans écran (tests/errants.test.mjs).
export const E = { CHEVAL: 0, RAMPE: 1, BOITE: 2, GISANT: 3, BRANCARD: 4 };
const MAX_CHEVAUX = 30, MAX_BLESSES = 60, MAX_BRANCARDS = 2;
const P_CHEVAL = 0.4, P_BLESSE = 0.14;   // part des tués qui laissent un cheval sans cavalier, un blessé
const V_BRANCARD = 1.8, V_RAMPE = 0.35, V_BOITE = 0.9;   // m/s

export class Errants {
  // W, H : le champ (m) ; hasard : Math.random, ou un tirage fixé pour les essais
  constructor(W, H, hasard = Math.random) { this.W = W; this.H = H; this.rnd = hasard; this.liste = []; }
  compte(k) { let n = 0; for (const e of this.liste) if (e.k === k) n++; return n; }
  blesses() { return this.compte(E.RAMPE) + this.compte(E.BOITE) + this.compte(E.GISANT); }
  // les tués d'un régiment à l'instant (decals 'mort' de troupes2d.kill) ; u : le régiment (dir, side) ; cav : cavalerie
  pertes(u, decals, cav) {
    const r = this.rnd, arriere = (u.dir || 0) + Math.PI;
    for (const d of decals) {
      if (d.k !== 'mort') continue;
      if (cav) { if (r() < P_CHEVAL && this.compte(E.CHEVAL) < MAX_CHEVAUX) this.liste.push({ k: E.CHEVAL, x: d.x, y: d.y, a: arriere + (r() - 0.5) * 1.8, v: 9, age: 0, ph: r() * 6, side: u.side }); }
      else if (r() < P_BLESSE && this.blesses() < MAX_BLESSES) {
        const rampe = r() < 0.6;
        this.liste.push({ k: rampe ? E.RAMPE : E.BOITE, x: d.x, y: d.y, a: arriere + (r() - 0.5), v: rampe ? V_RAMPE : V_BOITE, age: 0, ph: r() * 6, vie: 25 + r() * 50, side: u.side });
      }
    }
  }
  dehors(e, m = 30) { return e.x < -m || e.y < -m || e.x > this.W + m || e.y > this.H + m; }
  // dt : secondes de bataille écoulées (0 en pause)
  pas(dt) {
    if (dt <= 0) return;
    const r = this.rnd, L = this.liste;
    for (const e of L) {
      e.age += dt;
      if (e.k === E.CHEVAL) {
        // l'affolement passe : au galop, puis au trot, au pas, et il broute
        e.v = e.age < 12 ? 9 : e.age < 25 ? 4 : e.age < 45 ? 1.2 : 0;
        if (e.v) e.a += (r() - 0.5) * dt * 0.9;
      } else if (e.k === E.RAMPE && e.age > e.vie) { e.k = E.GISANT; e.v = 0; }
      else if (e.k === E.BRANCARD) this.brancard(e, dt);
      if (e.v) { e.x += Math.cos(e.a) * e.v * dt; e.y += Math.sin(e.a) * e.v * dt; e.ph += e.v * dt * (e.k === E.CHEVAL ? 1.1 : 3); }
    }
    // un gisant sans secours appelle une équipe, qui arrive de l'arrière
    if (this.compte(E.BRANCARD) < MAX_BRANCARDS) {
      const g = L.find(e => e.k === E.GISANT && !e.pris);
      if (g) { g.pris = true; L.push({ k: E.BRANCARD, x: g.x + Math.cos(g.a) * 160, y: g.y + Math.sin(g.a) * 160, a: g.a + Math.PI, v: V_BRANCARD, age: 0, ph: 0, side: g.side, cible: g, charge: false }); }
    }
    // partis : les chevaux et les boiteux sortis du champ, les brancardiers rentrés, les blessés emportés
    this.liste = L.filter(e => !e.fini && !(this.dehors(e) && e.k !== E.GISANT));
  }
  brancard(e, dt) {
    const g = e.cible;
    if (!e.charge) {
      e.a = Math.atan2(g.y - e.y, g.x - e.x);
      if (Math.hypot(g.x - e.x, g.y - e.y) < 1.5) { e.charge = true; g.fini = true; e.a = g.a; e.retour = 220; }   // chargé : demi-tour
    } else if ((e.retour -= e.v * dt) <= 0 || e.age > 400) e.fini = true;
  }
}
