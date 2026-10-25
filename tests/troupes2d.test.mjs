// Banc des troupes 2D vues de dessus (web/js/battle/troupes2d.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque figure du champ de bataille est placée par disposition() puis posée à chaque image :
// rangs de la ligne, carré à quatre faces tournées vers l'extérieur, tirailleurs par deux, déroute éparpillée,
// porte-drapeau, batterie avec ou sans avant-train. Une erreur (une face qui manque, un drapeau absent, des hommes
// hors de l'emprise, des éclairs qui partent du mauvais rang, des tués qui tombent ailleurs) se voit mal au milieu de
// milliers de figures et ne fait rien planter. Ici on compte et on mesure, sans navigateur (le dessin n'est pas testé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Troupes2D, disposition, hommesParFigure, tenue, coiffure, R, CAP } from '../web/js/battle/troupes2d.js';

// régiment comme le garde vue.js (w, d : emprise en m ; dir : cap, l'avant en (cos dir, sin dir))
const reg = (extra = {}) => ({ id: 'r1', side: 0, type: 'ligne', cls: 'inf', men: 450, form: 'ligne', state: 'repos', x: 500, y: 300, dir: 0, w: 180, d: 12, ...extra });
const count = (figs, role) => figs.filter(f => f.role === role).length;
const hommes = figs => count(figs, R.H) + count(figs, R.PIQUE) + count(figs, R.DRAPEAU);

test('ligne : un homme par figure, trois rangs, porte-drapeau au milieu, officier et tambour, dans l’emprise', () => {
  const figs = disposition(reg());
  assert.equal(hommes(figs), 450);
  assert.equal(count(figs, R.DRAPEAU), 1);
  assert.ok(count(figs, R.OFFICIER) >= 1 && count(figs, R.TAMBOUR) === 1);
  const rangs = new Set(figs.filter(f => f.rang >= 0).map(f => f.rang));
  assert.deepEqual([...rangs].sort(), [0, 1, 2]);
  // le premier rang devant (ox le plus grand), puis les autres
  const ox = r => figs.find(f => f.rang === r).ox;
  assert.ok(ox(0) > ox(1) && ox(1) > ox(2));
  const flag = figs.find(f => f.role === R.DRAPEAU);
  assert.ok(Math.abs(flag.oy) < 2, 'le drapeau est au milieu du front');
  for (const f of figs.filter(f => f.rang >= 0)) assert.ok(Math.abs(f.oy) <= 91 && Math.abs(f.ox) <= 6, `figure en (${f.ox}, ${f.oy})`);
});

test('plafond par régiment, et une figure pour plusieurs hommes au-delà du budget', () => {
  assert.equal(hommes(disposition(reg({ men: 900, w: 360 }))), CAP.inf);
  assert.equal(hommesParFigure(9000, 10000), 1);
  const per = hommesParFigure(9000, 3000);
  assert.ok(per >= 3 && per < 3.8, `${per} hommes par figure`);
  assert.equal(hommes(disposition(reg(), 4)), 113);
  // la vue applique le budget à toute la bataille (qualité Basse : 3 000 figures)
  const t = new Troupes2D({ troupes: 3000 }, 1810);
  t.budget(Array.from({ length: 20 }, (_, i) => reg({ id: 'r' + i })));
  assert.ok(t.per > 2 && t.fs > 1);
});

test('carré : quatre faces tournées vers l’extérieur, drapeau au milieu', () => {
  const figs = disposition(reg({ form: 'carre', w: 40, d: 40 }));
  assert.equal(hommes(figs), 450);
  const faces = figs.filter(f => f.role === R.H);
  for (const fo of [0, 1, 2, 3]) {
    const face = faces.filter(f => Math.abs(f.fa - fo * Math.PI / 2) < 1e-9);
    assert.ok(face.length > 100, `face ${fo} : ${face.length}`);
    // chacun est du côté où il regarde
    for (const f of face) assert.ok(f.ox * Math.cos(f.fa) + f.oy * Math.sin(f.fa) > 10);
  }
  const flag = figs.find(f => f.role === R.DRAPEAU);
  assert.ok(Math.hypot(flag.ox, flag.oy) < 1);
});

test('colonne : une masse plus profonde que large, dans l’emprise', () => {
  const figs = disposition(reg({ form: 'colonne', w: 30, d: 60 })).filter(f => f.role === R.H);
  const rangs = new Set(figs.map(f => f.rang)), ext = k => Math.max(...figs.map(f => f[k])) - Math.min(...figs.map(f => f[k]));
  assert.ok(rangs.size > 10, `${rangs.size} rangs`);
  assert.ok(ext('ox') > ext('oy'), `${ext('ox')} m de profondeur, ${ext('oy')} m de front`);
  for (const f of figs) assert.ok(Math.abs(f.ox) <= 31 && Math.abs(f.oy) <= 15.5);
});

test('tirailleurs : par deux, étalés sur le front', () => {
  const figs = disposition(reg({ type: 'legere', form: 'tirailleurs', w: 250, d: 30, men: 300 })).filter(f => f.role === R.H);
  assert.equal(figs.length, 300);
  const oy = figs.map(f => f.oy);
  assert.ok(Math.max(...oy) - Math.min(...oy) > 200, 'étalés sur le front');
  for (let k = 0; k < figs.length; k += 2) assert.ok(Math.hypot(figs[k].ox - figs[k + 1].ox, figs[k].oy - figs[k + 1].oy) < 2.5, 'deux à deux');
  for (const f of figs) assert.ok(Math.abs(f.ox) <= 15);
});

test('déroute : éparpillés bien au-delà de l’emprise, dos à l’ennemi ; le ralliement les ramène', () => {
  const t = new Troupes2D({}, 1810), u = reg({ dir: 0.3 });
  t.figures(u, 0);
  u.state = 'deroute';
  t.figures(u, 1);   // (la déroute commence)
  const figs = t.figures(u, 9).filter(f => f.role === R.H);
  const c = Math.cos(u.dir), s = Math.sin(u.dir), v = figs.map(f => (f.x - u.x) * c + (f.y - u.y) * s);
  assert.ok(Math.max(...v) - Math.min(...v) > 30, 'dispersés en profondeur');
  assert.ok(figs.every(f => Math.cos(f.a - u.dir) < -0.5), 'dos à l’ennemi');
  u.state = 'ralliement';
  t.figures(u, 10);
  const back = t.figures(u, 20).filter(f => f.role === R.H), v2 = back.map(f => (f.x - u.x) * c + (f.y - u.y) * s);
  assert.ok(Math.max(...v2) - Math.min(...v2) < 8, 'revenus dans le rang');
});

test('cavalerie, batterie, général, chariot : chacun ses figures', () => {
  const cav = disposition(reg({ type: 'cavalerie', cls: 'cavalerie', men: 200, w: 80, d: 15 }));
  assert.equal(count(cav, R.CAV), 200);
  assert.equal(count(disposition(reg({ type: 'cavalerie', cls: 'cavalerie', men: 500, w: 200, d: 15 })), R.CAV), CAP.cav);
  assert.equal(cav.filter(f => f.fanion).length, 1);
  const bat = disposition(reg({ type: 'artillerie', cls: 'artillerie', form: 'batterie', men: 160, pieces: 8, w: 80, d: 30 }));
  assert.equal(count(bat, R.PIECE), 8);
  assert.equal(count(bat, R.AVANT), 8);
  assert.equal(count(bat, R.CHEVAL), 16);
  assert.ok(bat.filter(f => f.role === R.PIECE).every(p => p.ox > bat.find(f => f.role === R.AVANT).ox), 'les pièces devant leurs avant-trains');
  const mur = disposition(reg({ type: 'artillerie', cls: 'artillerie', form: 'batterie', men: 160, pieces: 8, w: 80, d: 30, rempart: true }));
  assert.equal(count(mur, R.PIECE), 8);
  assert.equal(count(mur, R.AVANT) + count(mur, R.CHEVAL), 0, 'sur un rempart : ni avant-train ni chevaux');
  const gen = disposition(reg({ type: 'general', cls: 'general', men: 20 }));
  assert.equal(count(gen, R.CAV_GEN), 1);
  assert.ok(gen.some(f => f.fanion) && gen.length >= 3);
  const ch = disposition(reg({ type: 'chariot', cls: 'chariot', men: 8 }));
  assert.equal(count(ch, R.CAISSON), 1);
  assert.equal(count(ch, R.CHEVAL), 4);
});

test('bouches à feu : les deux premiers rangs, devant la ligne ; une par pièce', () => {
  const t = new Troupes2D({}, 1810), u = reg({ state: 'feu', dir: Math.PI / 2 });
  const mz = t.muzzles(u, 3), figs = disposition(u);
  const tireurs = figs.filter(f => f.role === R.H && f.rang < 2).length;
  assert.equal(mz.length, tireurs);
  // (cap vers le sud : les bouches au sud du centre, tournées vers lui)
  for (const [x, y, a] of mz) { assert.ok(y > u.y + 1 && Math.abs(x - u.x) < 92); assert.ok(Math.abs(Math.sin(a) - 1) < 0.1); }
  const bat = reg({ id: 'b', type: 'artillerie', cls: 'artillerie', form: 'batterie', state: 'feu', men: 160, pieces: 6, w: 60, d: 30 });
  const mb = t.muzzles(bat, 3);
  assert.equal(mb.length, 6);
  for (const [x] of mb) assert.ok(x > bat.x + 3, 'devant la batterie');
  assert.equal(t.muzzles({ ...bat, id: 'c', form: 'attelee' }, 3).length, 0, 'attelée : pas de feu');
  const carre = t.muzzles(reg({ id: 'q', form: 'carre', w: 40, d: 40, state: 'feu' }), 3);
  assert.ok(carre.length > 100 && carre.length < 200, `carré : le rang extérieur (${carre.length})`);
});

test('kill : autant de tués que de pertes, au sol dans l’emprise, au contrat des décalques', () => {
  const t = new Troupes2D({}, 1810), u = reg();
  const out = t.kill(u, 7, () => true, '#b8352a');
  assert.equal(out.length, 7);
  for (const d of out) {
    assert.equal(d.k, 'mort'); assert.equal(d.c, '#b8352a');
    assert.ok(Number.isFinite(d.a) && Math.abs(d.y - u.y) < 92 && Math.abs(d.x - u.x) < 8);
  }
  assert.deepEqual(t.kill(reg({ id: 'r2' }), 7, () => false, '#b8352a'), [], 'pas de corps dans l’eau ni sur un toit');
  // une figure pour quatre hommes : deux pertes ne couchent personne, la troisième (8 au total) en couche deux
  const t4 = new Troupes2D({ troupes: 1 }, 1810), v = reg({ id: 'r3' });
  t4.budget([{ men: 450 * 4 * 4 }]);
  t4.per = 4;
  assert.equal(t4.kill(v, 2, null, '#000').length, 0);
  assert.equal(t4.kill(v, 6, null, '#000').length, 2);
  // un cavalier : son cheval et lui
  const cav = t.kill(reg({ id: 'c', type: 'cavalerie', cls: 'cavalerie', men: 200, w: 80, d: 15 }), 1, () => true, '#00f');
  assert.deepEqual(cav.map(d => d.k).sort(), ['cheval', 'mort']);
  // un boulet couche la file qu'il traverse (repère du régiment : u vers la droite, v vers l'avant)
  const ball = t.kill(reg({ id: 'b' }), 6, () => true, '#000', [[40, 30], [40, -30]]);
  assert.equal(ball.length, 6);
  for (const d of ball) assert.ok(Math.abs(d.y - (u.y + 40)) < 4, `tué en ${d.y - u.y}`);
});

test('tenues : la couleur du camp fait l’habit, l’époque la coiffure', () => {
  assert.equal(tenue('#b8352a', 'ligne', 1810).habit, '#b8352a');
  assert.notEqual(tenue('#3f6fb5', 'ligne', 1810).habit, tenue('#b8352a', 'ligne', 1810).habit);
  assert.equal(tenue('#b8352a', 'ligne', 1750).tete, 'tricorne');
  assert.equal(tenue('#b8352a', 'ligne', 1810).tete, 'shako');
  assert.equal(tenue('#b8352a', 'grenadiers', 1810).tete, 'ourson');
  assert.equal(tenue('#b8352a', 'ligne', 1870).tete, 'kepi');
  assert.equal(coiffure('officier', 1805), 'bicorne');
  assert.equal(tenue('#b8352a', 'ligne', 1840).culotte, '#9e2b28', 'pantalon garance');
});

test('la disposition est la même d’une image à l’autre ; une perte ne déplace qu’un peu chacun', () => {
  assert.deepEqual(disposition(reg()), disposition(reg()));
  const a = disposition(reg()), b = disposition(reg({ men: 447, w: 179 }));
  let max = 0;
  for (let i = 0; i < b.length - 3; i++) if (a[i].role === R.H && b[i].role === R.H) max = Math.max(max, Math.hypot(a[i].ox - b[i].ox, a[i].oy - b[i].oy));
  assert.ok(max < 2, `${max.toFixed(2)} m au plus`);
});
