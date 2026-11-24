// Les armées de près sur le plateau (SPEC-HEX.md, « Armées de près ») : chacune en petit groupe de figurines 3D de web_engine
// (graphismes/rendu/modeles.js, maillageTroupe) d'après ce qu'elle compte, aux couleurs de son camp et à l'uniforme de l'année ;
// au repos en carré au bivouac sur un hexagone voisin de sa place, en marche en colonne courte tournée vers où elle va, qui glisse
// sur son trajet pendant la marche du tour (map.js, disp : d.anim) en marchant au pas. De loin, le jeton 2D de map.js reste.
// Ce fichier ne dessine rien : il pose et oriente les groupes du moteur. Un groupe par armée, gardé tant que sa composition, son
// allure, son camp et son époque ne changent pas (rien n'est rebâti à chaque image).

export const TROUPES_PX = 64;   // largeur d'un hexagone à l'écran (px) à partir de laquelle les armées sont des figurines
const ECH = 0.18;               // échelle des figurines (les bâtiments : 0,1) : lisibles dès TROUPES_PX, la troupe au repos tient dans son hexagone
const ANS = [1703, 1765, 1793, 1825, 1832];   // les paliers d'uniforme de web_engine (PALIERS : silex, Gribeauval, levée en masse…)
export const palierDeAn = an => ANS.filter(a => an >= a).length;
// ce que compte l'armée, dans le vocabulaire de maillageTroupe (les grenadiers avec la ligne, les tirailleurs en infanterie légère)
export const armesTroupe = ar => ({ inf: (ar.inf || 0) + (ar.grenadiers || 0), leg: ar.tir || 0, cav: ar.cav || 0, art: ar.art || 0 });

export class ArmeesPlateau {
  // pl : le plateau (hex/plateau.js) ; E : les modules du moteur
  constructor(pl, E) {
    this.pl = pl; this.E = E;
    this.groupe = new E.S.THREE.Group(); E.S.scene.add(this.groupe);
    this.vues = new Map();   // id de l'armée → { grp, cle, x, y } (x, y : où elle est posée, en unités du jeu)
    this.pres = false;       // les armées sont-elles des figurines (lu par map.js après image())
    this.rayonPx = 0;        // demi-largeur d'une troupe à l'écran (anneau de sélection, étiquette)
  }
  // chaque image, avant le rendu : rend vrai si quelque chose a bougé
  maj(cam) {
    const pl = this.pl, mp = pl.mp, N = pl.N, f = pl.fen, st = mp.state;
    const pres = !!(st && f && N && !N.leger && !mp.papierVu?.() && N.pas * cam.z >= TROUPES_PX);
    let bouge = pres !== this.pres;
    this.pres = pres; this.groupe.visible = pres;
    if (!pres) return bouge;
    const E = this.E, M = E.M, an = st.year || 1700, palier = palierDeAn(an), leger = E.S.qualite.niveau === 'leger' || !pl.q.habitants;
    this.rayonPx = 3.6 * ECH * cam.z * f.u;   // (la troupe : environ 7 unités du modèle de large)
    const vus = new Set();
    for (const d of mp.disp.values()) {
      const a = d.a;
      if (!a || !this.montre(a)) continue;
      vus.add(a.id);
      const marche = a.st === 'move' || a.st === 'retreat' || !!d.anim, armes = armesTroupe(mp.armesDe(a));
      const couleur = mp.colors[a.o] || '#999999', c = M.compoTroupe(armes, leger);
      const cle = `${couleur}|${palier}|${c.ligne},${c.leg},${c.cav},${c.art}|${marche}|${leger}`;
      let v = this.vues.get(a.id);
      if (!v || v.cle !== cle) {
        if (v) M.jeterTroupe(v.grp);
        v = { grp: M.maillageTroupe({ couleur, palier, armes, marche, leger }), cle, x: v?.x, y: v?.y };
        v.grp.scale.setScalar(ECH); this.groupe.add(v.grp); this.vues.set(a.id, v);
        bouge = true;
      }
      v.grp.userData.avance = !!d.anim;
      // (de la route à son hexagone près de la place, ou d'un hexagone à l'autre : elle y glisse en un quart de seconde environ)
      let [x, y] = this.place(d);
      if (!d.anim && v.x != null && Math.hypot(x - v.x, y - v.y) > 1e-3) { x = v.x + (x - v.x) * 0.25; y = v.y + (y - v.y) * 0.25; }
      const X = x / f.u - f.ox, Z = y / f.u - f.oz, ry = a.n != null && !marche ? 0.35 : Math.PI / 2 - d.head;   // (rangée près de sa place : face à la caméra, le bivouac derrière)
      const Y = Math.max(E.P.hauteurEn(X, Z), 0);
      const g = v.grp;
      if (g.position.x !== X || g.position.z !== Z || g.rotation.y !== ry || g.position.y !== Y) { g.position.set(X, Y, Z); g.rotation.y = ry; bouge = true; }
      v.x = x; v.y = y;
    }
    for (const [id, v] of this.vues) if (!vus.has(id)) { this.E.M.jeterTroupe(v.grp); this.vues.delete(id); bouge = true; }
    return bouge;
  }
  // en figurines : ni en train, ni en bateau, ni dans une bataille ou un siège que montre la petite scène (carte/combat.js)
  montre(a) { return !(a.rail && a.n == null) && !(a.boat && a.n == null) && a.st !== 'battle' && a.st !== 'siege' && !this.pl.mp.combatDe?.().montre(a); }
  // où poser l'armée (unités du jeu) : sur la route ou en campagne, là où elle est ; dans une place, au centre d'un hexagone libre
  // (ni eau, ni bâtiment, ni emplacement) qui touche ses bâtiments, ou au plus un cran plus loin ; au sud d'abord (devant la place,
  // vue de la caméra), hors des rivières, des bois et des montagnes si possible ; plusieurs armées : un hexagone chacune
  place(d) {
    const a = d.a, pl = this.pl, N = pl.N, u = pl.fen.u, n = a.n != null && pl.mp.nodes[a.n], p = n && N.places.get(n.id);
    if (!p || d.anim) return [d.x, d.y];
    const g = N.g, pris = new Set(pl.emp.map(e => e[1])), vu = new Set(p.hex), libres = [], loin = new Set();
    let bord = p.hex;
    for (let r = 0; r < 2; r++) {
      const suivant = [];
      for (const k of bord) for (const v of g.voisins(g.liste[k])) if (!vu.has(v.i)) {
        vu.add(v.i); suivant.push(v.i);
        if (!N.estEau(v.i) && !N.ville.has(v.i) && !pris.has(v.i)) { libres.push(v.i); if (r) loin.add(v.i); }
      }
      bord = suivant;
    }
    if (!libres.length) return [d.x, d.y];
    const c = g.liste[p.hex[0]], note = k => ((g.liste[k].gy - c.gy) - Math.abs(g.liste[k].gx - c.gx) * 0.3) / N.pas - (N.riviere[k] ? 2 : 0) - (loin.has(k) ? 1 : 0)
      - (N.foret[k] ? 1 : N.arbres[k] ? 0.3 : 0) - (N.terrain[k] >= 5 ? 0.5 : 0);   // (à découvert plutôt qu'au bois ou en montagne)
    libres.sort((i, j) => note(j) - note(i));
    const [cx, cz] = pl.centre(N, libres[(d.slot || 0) % libres.length]);
    return [cx * u, cz * u];
  }
  // l'armée posée en figurines : où elle est (unités du jeu), ou null
  pos(id) { const v = this.pres && this.vues.get(id); return v ? [v.x, v.y] : null; }
}
