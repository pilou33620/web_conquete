// Vue tactique : le décor de la bataille selon l'époque (SPEC-SUITE, partie J ; SPEC-TECH, phase 4). D'après l'année
// et les marques de chaque camp (rules.VISUALS, reçues avec la carte) :
//   - poteaux et fil du télégraphe le long de la grand-route ; une voie ferrée à côté (ballast, traverses, rails) ;
//   - au loin, hors du champ, des cheminées d'usine qui fument ;
//   - à l'arrière de chaque armée, l'ambulance : tentes et voitures de Larrey (dès 1797), à croix rouge avec la
//     convention de Genève ;
//   - le ballon captif au-dessus de l'état-major d'un camp qui a les aérostiers, au bout de son câble ;
//   - devant l'infanterie retranchée (le moteur la dit « dug »), une tranchée de terre et des gabions.
// Rien de cela ne change les règles : c'est le décor de l'époque. Les cases de la carte ne bougent pas.
import * as THREE from '../../vendor/three/three.module.js';
import { clsOf, isGeneral } from './formes.js';

const has = (marks, k) => (marks || []).some(m => (m || []).includes(k));

// points tous les pas m le long d'une polyligne, avec la direction
function jalons(pts, pas, off = 0) {
  const out = [];
  let reste = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    for (let s = reste; s < L; s += pas) out.push([ax + ux * s - uy * off, ay + uy * s + ux * off, Math.atan2(uy, ux)]);
    reste = (reste - L) % pas; if (reste < 0) reste += pas;
  }
  return out;
}

export class DecorEpoque {
  // terrain : Terrain ; relief : Relief (heightAt, ombrage) ; m : la carte reçue (year, marks, balloon)
  constructor(terrain, relief, m) {
    this.t = terrain; this.r = relief; this.year = m.year || 1790;
    this.marks = m.marks || [[], []]; this.balloon = m.balloon || [0, 0];
    this.group = new THREE.Group();
    this.disposables = [];
    this.mat = c => { const mat = this.r.ombrage?.(new THREE.MeshLambertMaterial({ color: c })) || new THREE.MeshLambertMaterial({ color: c }); this.disposables.push(mat); return mat; };
    const road = [...(terrain.roadPts || [])].sort((a, b) => b.length - a.length)[0];
    if (road && road.length > 3) {
      if (has(this.marks, 'telegraphe')) this.telegraphe(road);
      if (has(this.marks, 'rail') && this.year >= 1845) this.voie(road);
    }
    if (has(this.marks, 'usines')) this.usines();
    this.balloons = [];
    this.tents = null;
    this.dug = null;
  }
  // une géométrie répétée aux places données (InstancedMesh), chacune [x, y, angle, hauteur au-dessus du sol]
  semis(geo, mat, places) {
    if (!places.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, places.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    places.forEach(([x, y, a, dy = 0], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, this.r.heightAt(x, y) + dy, y), q.setFromAxisAngle(up, -a), new THREE.Vector3(1, 1, 1))));
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh); this.disposables.push(geo);
    return mesh;
  }
  // poteaux tous les 50 m, à 9 m du bord de la route, et le fil
  telegraphe(road) {
    const P = jalons(road, 50, 9);
    this.semis(new THREE.CylinderGeometry(0.09, 0.12, 6, 5).translate(0, 3, 0), this.mat('#5a4430'), P);
    this.semis(new THREE.BoxGeometry(0.08, 0.08, 1.1).translate(0, 5.6, 0), this.mat('#5a4430'), P);
    const pos = [];
    for (let k = 1; k < P.length; k++) {
      const [ax, ay] = P[k - 1], [bx, by] = P[k], ha = this.r.heightAt(ax, ay) + 5.6, hb = this.r.heightAt(bx, by) + 5.6;
      for (let s = 0; s < 6; s++) {
        const u0 = s / 6, u1 = (s + 1) / 6, sag = u => -1.2 * 4 * u * (1 - u);
        pos.push(ax + (bx - ax) * u0, ha + (hb - ha) * u0 + sag(u0), ay + (by - ay) * u0, ax + (bx - ax) * u1, ha + (hb - ha) * u1 + sag(u1), ay + (by - ay) * u1);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lm = new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.7 });
    this.group.add(new THREE.LineSegments(g, lm)); this.disposables.push(g, lm);
  }
  // voie ferrée à 24 m de la route : ballast, traverses tous les 2,5 m, deux rails
  voie(road) {
    const B = jalons(road, 6, 24), T = jalons(road, 2.5, 24);
    this.semis(new THREE.BoxGeometry(6.4, 0.5, 3.2).translate(0, 0.15, 0), this.mat('#8a8274'), B.map(([x, y, a]) => [x, y, a]));
    this.semis(new THREE.BoxGeometry(0.25, 0.12, 2.4).translate(0, 0.45, 0), this.mat('#4a3626'), T);
    for (const s of [-0.72, 0.72]) this.semis(new THREE.BoxGeometry(6.2, 0.1, 0.08).translate(0, 0.56, s), this.mat('#5c6064'), B);
  }
  // trois cheminées d'usine au loin, hors du champ (au-delà d'un bord), et leur fumée immobile
  usines() {
    const W = this.t.W, H = this.t.H, P = [[W * 0.18, -420, 0], [W * 0.62, -560, 0], [W + 380, H * 0.35, 0]];
    this.semis(new THREE.CylinderGeometry(1.4, 2.2, 38, 8).translate(0, 19, 0), this.mat('#8a4a34'), P);
    const smoke = new THREE.MeshLambertMaterial({ color: '#76716a', transparent: true, opacity: 0.45, depthWrite: false });
    this.disposables.push(smoke);
    const puffs = [];
    for (const [x, y] of P) for (let k = 0; k < 5; k++) puffs.push([x + k * 9, y + k * 3, 0, 40 + k * 7]);
    this.semis(new THREE.SphereGeometry(6, 8, 6), smoke, puffs);
  }
  // à chaque relevé : ambulances (une fois, à l'arrière de chaque état-major), ballons et retranchements
  update(units) {
    const gens = [0, 1].map(s => units.find(u => u.side === s && isGeneral(u) && u.state !== 'hors'));
    if (!this.tents && gens.some(Boolean) && this.year >= 1797) this.ambulances(gens);
    this.ballons(gens);
    this.retranchements(units.filter(u => u.dug && u.state !== 'hors' && clsOf(u) !== 'general'));
  }
  ambulances(gens) {
    const croix = s => (this.marks[s] || []).includes('ambulances'), places = [[], []], wag = [];
    gens.forEach((g, s) => {
      if (!g) return;
      // derrière l'état-major (à l'opposé de son front), 180 m
      const bx = g.x - Math.cos(g.dir || 0) * 180, by = g.y - Math.sin(g.dir || 0) * 180;
      for (let k = 0; k < 3; k++) places[croix(s) ? 1 : 0].push([bx + (k - 1) * 9, by + (k % 2) * 6, g.dir || 0]);
      wag.push([bx + 16, by - 8, (g.dir || 0) + 0.4]);
    });
    const tent = () => new THREE.ConeGeometry(3.2, 3.4, 4).rotateY(Math.PI / 4).translate(0, 1.7, 0);
    this.semis(tent(), this.mat('#e8e0cc'), places[0]);
    if (places[1].length) {
      this.semis(tent(), this.mat('#f2ece0'), places[1]);
      this.semis(new THREE.BoxGeometry(0.3, 1.2, 0.3).translate(0, 3.5, 0), this.mat('#c0392b'), places[1]);
      this.semis(new THREE.BoxGeometry(1.0, 0.3, 0.3).translate(0, 3.6, 0), this.mat('#c0392b'), places[1]);
    }
    this.semis(new THREE.BoxGeometry(3.2, 1.3, 1.6).translate(0, 1.2, 0), this.mat('#5a4430'), wag);
    this.tents = true;
  }
  // le ballon captif : enveloppe rayée, nacelle, câble jusqu'au sol, 140 m au-dessus de l'arrière de l'état-major
  ballons(gens) {
    gens.forEach((g, s) => {
      if (!(this.balloon[s] > 0) || !g) return;
      let b = this.balloons[s];
      if (!b) {
        b = new THREE.Group();
        const env = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12).scale(1, 1.15, 1), this.mat(s ? '#c9b48a' : '#d9c79a'));
        const band = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.35, 6, 24).rotateX(Math.PI / 2), this.mat('#8a2a22'));
        const nac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6).translate(0, -10.5, 0), this.mat('#5a4430'));
        const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute([0, -11, 0, 0, -150, 0], 3));
        const cm = new THREE.LineBasicMaterial({ color: '#3a322a' });
        b.add(env, band, nac, new THREE.LineSegments(cg, cm));
        b.children.forEach(o => { o.castShadow = true; });
        this.disposables.push(env.geometry, band.geometry, nac.geometry, cg, cm);
        this.group.add(b); this.balloons[s] = b;
      }
      const t = performance.now() / 1000, bx = g.x - Math.cos(g.dir || 0) * 60, by = g.y - Math.sin(g.dir || 0) * 60;
      b.position.set(bx + Math.sin(t * 0.3 + s) * 3, this.r.heightAt(bx, by) + 140 + Math.sin(t * 0.5 + s) * 1.5, by);
      b.children[3].scale.y = (b.position.y - this.r.heightAt(bx, by)) / 139;
    });
  }
  // tranchée et gabions devant chaque régiment retranché (jusqu'à 64)
  retranchements(list) {
    if (!this.dug) {
      // (les figurines sont grandies, SCALE de troupes.js : le parapet aussi, sinon elles le cachent)
      const geo = new THREE.BoxGeometry(1, 1.5, 3).translate(0, 0.5, 0);
      this.dug = new THREE.InstancedMesh(geo, this.mat('#7d6440'), 64);
      this.dug.count = 0; this.dug.receiveShadow = this.dug.castShadow = true;
      this.group.add(this.dug); this.disposables.push(geo);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const u of list.slice(0, 64)) {
      const c = Math.cos(u.dir || 0), s = Math.sin(u.dir || 0), f = (u.d || 10) / 2 + 6, x = u.x + c * f, y = u.y + s * f;
      // (le long du front : la boîte s'étire sur la largeur du régiment)
      m.compose(new THREE.Vector3(x, this.r.heightAt(x, y), y), q.setFromAxisAngle(up, -(u.dir || 0) + Math.PI / 2), new THREE.Vector3((u.w || 40) + 4, 1, 1));
      this.dug.setMatrixAt(n++, m);
    }
    this.dug.count = n; this.dug.instanceMatrix.needsUpdate = true;
  }
  dispose() { for (const d of this.disposables) d.dispose(); for (const o of this.group.children) o.dispose?.(); }
}
