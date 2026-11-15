//! Le portage de game/tactics/plan_organique.py.
//!
//! Le plan organique d'une ville, celui de la carte (web/js/carte/plan-organique.js : genererPlan, tissu ; ses entrées
//! faites par planOrganique de web/js/carte/villes.js), porté au bit près pour les batailles : mêmes rues,
//! mêmes îlots, même enceinte que la carte (tests/test_plan_organique.py le vérifie contre Node).
//!
//! Tout est en km, repère de la carte. Les entrées viennent du plan V de plan_ville.rs (profil : rayon, rMur, graine,
//! citadelle, gare) et de sa Carte (routes, rivières, eauK).
//!
//! Ce qui change du Python (PORTAGE.md) : les calculs sont en nombres natifs, les points des `[f64; 2]`, une ligne
//! (axe, rivière, rempart) un struct `Ligne` ; ce qui est rendu (le plan P, ses îlots, ses axes, son mur) reste en
//! `Val`, mêmes clés, mêmes listes.

use std::cell::Cell;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::jsmath::{atan2, cos, hash2, hypot, jround, sin};
use super::plan_ville as PV;
use crate::py::{self, Val};
use crate::{dict, list};

pub const TAU: f64 = std::f64::consts::PI * 2.0;
pub const HG: f64 = 0.08; // pas de l'index des graines (km)
pub const LARG_RIVIERE: [f64; 5] = [0.0, 0.32, 0.16, 0.09, 0.06]; // terre.js
pub const DEMI_ROUTE: [f64; 2] = [0.03, 0.045]; // villes.js : demi-largeur des chemins et des routes royales
pub const RUE_VILLE: f64 = 0.012; // demi-largeur d'une route dans la ville
/// demi-largeur de rue (km)
pub const QUARTIERS: [(&str, f64); 9] = [
    ("vieux", 0.0032),
    ("faubourg", 0.0025),
    ("maraichers", 0.002),
    ("place", 0.0035),
    ("eglise", 0.0032),
    ("jardin", 0.004),
    ("ouvrier", 0.004),
    ("immeubles", 0.006),
    ("usine", 0.006),
];
/// QUARTIERS[t]
fn quartier(t: &str) -> f64 {
    QUARTIERS.iter().find(|q| q.0 == t).unwrap_or_else(|| panic!("KeyError: '{t}'")).1
}

const SF: f64 = PV::S as f64;
const INF: f64 = f64::INFINITY;

/// Un point (une liste `[x, y]` de Python).
pub type Pt = [f64; 2];

/// Les points d'une `Val` (liste de `[x, y]`).
pub fn pts_de(v: &Val) -> Vec<Pt> {
    v.iter().map(|p| [p.at(0).f(), p.at(1).f()]).collect()
}
/// Une liste de listes `[x, y]`.
pub fn pts_val(pts: &[Pt]) -> Val {
    pts.iter().map(|p| list![p[0], p[1]]).collect()
}
fn nombres(v: &[f64]) -> Val {
    v.iter().map(|x| Val::from(*x)).collect()
}
/// `x or d` de Python.
fn ou(x: f64, d: f64) -> f64 {
    if x != 0.0 {
        x
    } else {
        d
    }
}
/// `min(a, b)` de Python : le premier gagne.
fn mn(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
/// `max(a, b)` de Python : le premier gagne.
fn mx(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

/// (Float32Array de JS : chaque valeur arrondie en simple précision)
pub fn TABLE() -> &'static [f64] {
    static T: OnceLock<Vec<f64>> = OnceLock::new();
    T.get_or_init(|| (0..65536).map(|i| hash2(i, 7, 3) as f32 as f64).collect())
}

/// bruit(x, y, f, d=0)
pub fn bruit(x: f64, y: f64, f: f64, d: f64) -> f64 {
    let T = TABLE();
    let x = x / f + d;
    let y = y / f + d * 1.7;
    let (i, j) = (x.floor(), y.floor());
    let (fx, fy) = (x - i, y - j);
    let (i, j) = (i as i64, j as i64);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (a00, a10) = (T[(((j & 255) << 8) | (i & 255)) as usize], T[(((j & 255) << 8) | ((i + 1) & 255)) as usize]);
    let (a01, a11) = (T[((((j + 1) & 255) << 8) | (i & 255)) as usize], T[((((j + 1) & 255) << 8) | ((i + 1) & 255)) as usize]);
    let h = a00 + (a10 - a00) * sx;
    let b = a01 + (a11 - a01) * sx;
    h + (b - h) * sy
}

// ---------------------------------------------------------------------- géométrie (polygones = listes de [x, y])
pub fn aire(P: &[Pt]) -> f64 {
    let mut s = 0.0;
    for i in 0..P.len() {
        let (a, b) = (P[i], P[(i + 1) % P.len()]);
        s += a[0] * b[1] - b[0] * a[1];
    }
    s / 2.0
}

pub fn centre(P: &[Pt]) -> Pt {
    let (mut sx, mut sy) = (0.0, 0.0); // (pas sum() : Python 3.12+ compense la somme, JS non)
    for p in P {
        sx += p[0];
    }
    for p in P {
        sy += p[1];
    }
    [sx / P.len() as f64, sy / P.len() as f64]
}

pub fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// distSeg, et la position du point projeté (le tSeg du module JS).
pub fn dist_seg(x: f64, y: f64, a: Pt, b: Pt) -> (f64, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let t = mx(0.0, mn(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / ou(dx * dx + dy * dy, 1.0)));
    let (ex, ey) = (x - a[0] - t * dx, y - a[1] - t * dy);
    ((ex * ex + ey * ey).sqrt(), t)
}

pub fn dans_poly(P: &[Pt], x: f64, y: f64) -> bool {
    let mut d = false;
    let mut j = P.len().wrapping_sub(1);
    for i in 0..P.len() {
        let [xi, yi] = P[i];
        let [xj, yj] = P[j];
        if (yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi {
            d = !d;
        }
        j = i;
    }
    d
}

/// Le polygone P coupé au demi-plan nx·x + ny·y ≤ c ; T marque chaque côté, le côté neuf prend `tag`.
pub fn couper<E: Clone>(P: &[Pt], T: &[E], nx: f64, ny: f64, c: f64, tag: E) -> (Vec<Pt>, Vec<E>) {
    let (mut Q, mut U) = (vec![], vec![]);
    let n = P.len();
    for i in 0..n {
        let (a, b) = (P[i], P[(i + 1) % n]);
        let (da, db) = (nx * a[0] + ny * a[1] - c, nx * b[0] + ny * b[1] - c);
        if da <= 0.0 {
            Q.push(a);
            U.push(T[i].clone());
        }
        if (da <= 0.0) != (db <= 0.0) {
            let k = da / (da - db);
            Q.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
            U.push(if da <= 0.0 { tag.clone() } else { T[i].clone() });
        }
    }
    (Q, U)
}

pub fn normales(P: &[Pt]) -> Vec<(f64, f64)> {
    let ar = aire(P);
    let s = ((ar > 0.0) as i64 - (ar < 0.0) as i64) as f64;
    let mut out = vec![];
    for (i, a) in P.iter().enumerate() {
        let b = P[(i + 1) % P.len()];
        let l = ou(hypot(b[0] - a[0], b[1] - a[1]), 1.0);
        out.push(((-(b[1] - a[1]) / l) * s, ((b[0] - a[0]) / l) * s));
    }
    out
}

/// Chaque côté i de P rentre de d(i) ; None s'il ne reste rien.
pub fn rentrer<E: Clone>(P: &[Pt], T: &[E], d: impl Fn(usize) -> f64) -> Option<(Vec<Pt>, Vec<E>)> {
    let N = normales(P);
    let (mut Q, mut U) = (P.to_vec(), T.to_vec());
    for i in 0..P.len() {
        if Q.len() <= 2 {
            break;
        }
        let (nx, ny) = N[i];
        let a = P[i];
        (Q, U) = couper(&Q, &U, -nx, -ny, -(nx * a[0] + ny * a[1]) - d(i), T[i].clone());
    }
    if Q.len() > 2 {
        Some((Q, U))
    } else {
        None
    }
}

/// Une ligne du plan : un axe (route), une rivière, un rempart. C'est le dict `l` du Python (pts, ws, demi, kind,
/// et la boîte, gardée au premier `ecart`).
pub struct Ligne {
    pub pts: Vec<Pt>,
    pub ws: Option<Vec<f64>>,
    pub demi: Option<f64>,
    pub kind: String,
    pub boite: Cell<Option<[f64; 4]>>,
}

impl Ligne {
    pub fn new(pts: Vec<Pt>, ws: Option<Vec<f64>>, demi: Option<f64>, kind: &str) -> Ligne {
        Ligne { pts, ws, demi, kind: kind.to_string(), boite: Cell::new(None) }
    }
}

/// Écart d'un point au bord de la chaussée, de l'eau ou du rempart d'une ligne (boîte gardée sur la ligne).
pub fn ecart(l: &Ligne, x: f64, y: f64) -> f64 {
    let b = match l.boite.get() {
        Some(b) => b,
        None => {
            let w = match &l.ws {
                Some(ws) => py::max_f(ws.iter().copied()).unwrap(),
                None => l.demi.unwrap(),
            };
            let (xs, ys) = (l.pts.iter().map(|p| p[0]), l.pts.iter().map(|p| p[1]));
            let b = [py::min_f(xs.clone()).unwrap() - w, py::min_f(ys.clone()).unwrap() - w, py::max_f(xs).unwrap() + w, py::max_f(ys).unwrap() + w];
            l.boite.set(Some(b));
            b
        }
    };
    let hors = mx(mx(mx(b[0] - x, x - b[2]), b[1] - y), y - b[3]);
    if hors > 0.5 {
        return hors;
    }
    let mut m = INF;
    let pts = &l.pts;
    // (dist_seg en ligne, même arithmétique : c'est la boucle la plus chaude du plan)
    for k in 1..pts.len() {
        let [ax, ay] = pts[k - 1];
        let [bx, by] = pts[k];
        let (dx, dy) = (bx - ax, by - ay);
        let t = ((x - ax) * dx + (y - ay) * dy) / ou(dx * dx + dy * dy, 1.0);
        let t = if t <= 0.0 {
            0.0
        } else if t >= 1.0 {
            1.0
        } else {
            t
        };
        let (ex, ey) = (x - ax - t * dx, y - ay - t * dy);
        let d = (ex * ex + ey * ey).sqrt()
            - match &l.ws {
                Some(ws) => ws[k - 1] + (ws[k] - ws[k - 1]) * t,
                None => l.demi.unwrap(),
            };
        if d < m {
            m = d;
        }
    }
    m
}

pub fn demi_en(l: &Ligne, x: f64, y: f64) -> f64 {
    let Some(ws) = &l.ws else { return l.demi.unwrap() };
    let (mut m, mut w) = (INF, 0.0);
    let pts = &l.pts;
    for k in 1..pts.len() {
        let (d, t) = dist_seg(x, y, pts[k - 1], pts[k]);
        if d < m {
            (m, w) = (d, ws[k - 1] + (ws[k] - ws[k - 1]) * t);
        }
    }
    w
}

// ---------------------------------------------------------------------- génération
/// genererPlan : {ilots: [{pts, bloc, kinds, type, c, graine, sec, boite}], mur, axes, boite}.
pub fn generer_plan(v: &Val, eau: &dyn Fn(f64, f64) -> bool) -> Val {
    let P = dict! { "ilots" => list![], "mur" => Val::None, "axes" => list![] };
    tissu(&P, v, eau);
    let mut b = [INF, INF, -INF, -INF];
    for il in P.at("ilots").iter() {
        let bloc = pts_de(&il.at("bloc"));
        let (xs, ys) = (bloc.iter().map(|p| p[0]), bloc.iter().map(|p| p[1]));
        let mut bo = [py::min_f(xs.clone()).unwrap(), py::min_f(ys.clone()).unwrap(), py::max_f(xs).unwrap(), py::max_f(ys).unwrap()];
        for p in pts_de(&il.at("pts")) {
            bo = [mn(bo[0], p[0]), mn(bo[1], p[1]), mx(bo[2], p[0]), mx(bo[3], p[1])];
        }
        il.set("boite", nombres(&bo));
        b = [mn(b[0], bo[0]), mn(b[1], bo[1]), mx(b[2], bo[2]), mx(b[3], bo[3])];
    }
    P.set("boite", nombres(&b));
    P
}

/// Une graine de la trame : le dict `sd` du Python (x, y, s, ligne, cote, o, b, garde, cellule).
struct Graine {
    x: f64,
    y: f64,
    s: f64,
    ligne: Option<usize>,
    cote: i64,
    o: f64,
    b: f64,
    garde: bool,
    cellule: Option<usize>,
}

struct Cellule {
    pts: Vec<Pt>,
    tags: Vec<i64>,
    k: usize,
    c: Pt,
    typ: &'static str,
}

struct Ilot {
    pts: Vec<Pt>,
    bloc: Vec<Pt>,
    kinds: Vec<String>,
    typ: &'static str,
    c: Pt,
    graine: f64,
    sec: bool,
}

/// Les mesures de la ville que les fonctions internes de tissu se partagent.
struct Trame {
    cx: f64,
    cy: f64,
    R: f64,
    Rh: f64,
    g: i64,
    classique: bool,
    damier: bool,
    co: f64,
    si: f64,
    asp: f64,
    lim: f64,
}

impl Trame {
    fn D(&self, x: f64, y: f64) -> f64 {
        hypot(x - self.cx, y - self.cy)
    }

    fn base(&self, x: f64, y: f64) -> f64 {
        let (cx, cy, R, g) = (self.cx, self.cy, self.R, self.g);
        if self.damier {
            let (u, w) = ((x - cx) * self.co + (y - cy) * self.si, -(x - cx) * self.si + (y - cy) * self.co);
            1.0 - mx(u.abs(), w.abs() * 1.2) / (R * 0.9 * (0.9 + 0.2 * bruit(x, y, 0.4, (g % 97) as f64)))
        } else {
            let (f1, f2, d2) = (mx(0.3, R * 0.8), mx(0.12, R * 0.3), ((g % 241) + 50) as f64);
            let forme = 0.82 + 0.5 * (bruit(x, y, f1, (g % 251) as f64) - 0.5) + 0.3 * (bruit(x, y, f2, d2) - 0.5);
            1.0 - self.D(x, y) / (R * forme)
        }
    }

    /// esp(d, fin=False)
    fn esp(&self, d: f64, fin: bool) -> f64 {
        if !fin && d > self.lim {
            return 0.25;
        }
        if self.damier {
            return 0.075;
        }
        if d < self.Rh || self.classique {
            return mn(0.09, 0.05 + (0.035 * d) / mx(self.Rh, 0.6));
        }
        0.08
    }

    fn deform(&self, d: f64) -> f64 {
        if self.damier {
            0.0
        } else if d < self.Rh || self.classique {
            0.45
        } else {
            0.12
        }
    }

    fn vers_monde(&self, u: f64, w: f64) -> (f64, f64) {
        (self.cx + u * self.asp * self.co - w * self.si, self.cy + u * self.asp * self.si + w * self.co)
    }

    fn semer(&self, seeds: &mut Vec<Graine>, u: f64, w: f64, t: f64) {
        let g = self.g;
        let (x, y) = self.vers_monde(u + t / 2.0, w + t / 2.0);
        let d = self.D(x, y);
        let s = self.esp(d, false);
        if t > 1.3 * s && t > 0.03 {
            let h = t / 2.0;
            self.semer(seeds, u, w, h);
            self.semer(seeds, u + h, w, h);
            self.semer(seeds, u, w + h, h);
            self.semer(seeds, u + h, w + h, h);
            return;
        }
        let (i, j) = (jround(u / 0.005), jround(w / 0.005));
        let jit = if self.damier {
            0.0
        } else if d < self.Rh || self.classique {
            0.22
        } else {
            0.08
        };
        let (mut px, mut qy) = self.vers_monde(u + t * (0.5 + (hash2(i, j, g) - 0.5) * jit), w + t * (0.5 + (hash2(j, i, g + 1) - 0.5) * jit));
        let A = self.deform(d) * s;
        if A != 0.0 {
            let dx = (bruit(px, qy, 0.45, 3.0) - 0.5) * 2.0 + 0.35 * (bruit(px, qy, 0.17, 5.0) - 0.5) * 2.0;
            let dy = (bruit(px, qy, 0.45, 6.0) - 0.5) * 2.0 + 0.35 * (bruit(px, qy, 0.17, 8.0) - 0.5) * 2.0;
            px += A * dx;
            qy += A * dy;
        }
        seeds.push(Graine { x: px, y: qy, s: mn(t, 1.3 * s), ligne: None, cote: 0, o: 0.0, b: 0.0, garde: false, cellule: None });
    }
}

/// Les graines à moins de r du point, par l'index `grille`.
fn voisins(seeds: &[Graine], grille: &HashMap<i64, Vec<usize>>, x: f64, y: f64, r: f64) -> Vec<usize> {
    let mut out = vec![];
    for i in ((x - r) / HG).floor() as i64..((x + r) / HG).floor() as i64 + 1 {
        for j in ((y - r) / HG).floor() as i64..((y + r) / HG).floor() as i64 + 1 {
            if let Some(l) = grille.get(&(i * 100003 + j)) {
                for &k in l {
                    let q = &seeds[k];
                    if (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y) < r * r {
                        out.push(k);
                    }
                }
            }
        }
    }
    out
}

pub fn tissu(P: &Val, v: &Val, eau: &dyn Fn(f64, f64) -> bool) {
    // shortcut: ères romaine, celte, moderne et futur non portées, seules classique et industrielle servent au jeu
    let (R, g, cx, cy) = (v.at("r").f(), v.at("graine").i(), v.at("x").f(), v.at("y").f());
    let (classique, damier) = (v.at("ere") == "classique", v.get("damier").truthy());
    let rh = v.get("rh");
    let Rh = mn(if rh.is_some() { rh.f() } else { R }, R);
    let B = 1.75 * R + 0.15;
    let axes_v = list![];
    let mut axes: Vec<Ligne> = vec![];
    for a in v.at("axes").iter() {
        if a.at("pts").len() > 1 {
            let ws = a.at("ws");
            axes.push(Ligne::new(pts_de(&a.at("pts")), ws.is_some().then(|| ws.iter().map(|w| w.f()).collect()), Some(a.at("demi").f()), "axe"));
            axes_v.push(dict! { "pts" => a.at("pts"), "demi" => a.at("demi"), "ws" => ws, "kind" => "axe" });
        }
    }
    P.set("axes", &axes_v);
    // (v.toutes : toutes les routes tracent des rues) ; lignes commence par les axes triés (traces), et
    // pos_axe dit où chaque axe de P['axes'] s'y trouve
    let n_axes = axes.len();
    let ordre = py::sorted_by_key((0..n_axes).collect::<Vec<usize>>(), |&i| -axes[i].demi.unwrap());
    let mut pos_axe = vec![0usize; n_axes];
    for (pos, &i) in ordre.iter().enumerate() {
        pos_axe[i] = pos;
    }
    let mut tmp: Vec<Option<Ligne>> = axes.into_iter().map(Some).collect();
    let mut lignes: Vec<Ligne> = ordre.iter().map(|&i| tmp[i].take().unwrap()).collect();
    for r in v.at("rivieres").iter() {
        lignes.push(Ligne::new(pts_de(&r.at("pts")), Some(r.at("ws").iter().map(|w| w.f() + 0.012).collect()), None, "riviere"));
    }
    let dirAxe = if n_axes > 0 { atan2(lignes[0].pts[1][1] - cy, lignes[0].pts[1][0] - cx) } else { hash2(g, 1, 0) * TAU };
    let (co, si) = (cos(dirAxe), sin(dirAxe));

    let mur_v = v.get("mur");
    let mut mur: Option<Vec<Pt>> = None;
    if mur_v.truthy() {
        P.set("mur", &mur_v);
        let pts = pts_de(&mur_v.at("pts"));
        lignes.push(Ligne::new(pts.clone(), None, Some(mur_v.get_or("demi", 0.011).f()), mur_v.at("kind").s()));
        mur = Some(pts);
    }
    let lignes = lignes;
    let s0 = if damier { 0.075 } else { 0.05 };
    // graines : trame (quadtree dans le repère de l'axe principal), déformée, plus fine au cœur
    let asp = if damier { 1.0 } else { 1.4 };
    let tr = Trame { cx, cy, R, Rh, g, classique, damier, co, si, asp, lim: R * 1.3 + 0.1 };
    let fa = |x: f64, y: f64| -> f64 {
        let mut m = 0.0;
        for &i in &pos_axe {
            m = mx(m, 1.0 - ecart(&lignes[i], x, y) / 0.1);
        }
        m * (1.0 - tr.D(x, y) / B)
    };
    let mut seeds: Vec<Graine> = vec![];
    let racine = s0 * 2f64.powi((0.3f64 / s0).log2().ceil() as i32); // (0,3 ou 0,4 : les mêmes que V8)
    let (nu, nw) = ((B / asp / racine).ceil() as i64, (B / racine).ceil() as i64);
    for a in -nu..nu {
        for b in -nw..nw {
            tr.semer(&mut seeds, a as f64 * racine, b as f64 * racine, racine);
        }
    }
    // pas de trame sur l'eau ni sur les lignes (serre : les cellules sont coupées au tracé)
    let mut seeds: Vec<Graine> = seeds.into_iter().filter(|sd| !eau(sd.x, sd.y) && !lignes.iter().any(|l| ecart(l, sd.x, sd.y) < 0.6 * sd.s)).collect();
    // graines en miroir de part et d'autre de chaque ligne : la ligne devient une rue (ou un quai, un rempart)
    for (li, l) in lignes.iter().enumerate() {
        let mut reste = 0.0;
        let pts = &l.pts;
        for k in 1..pts.len() {
            let (a, b) = (pts[k - 1], pts[k]);
            let L = ou(hypot(b[0] - a[0], b[1] - a[1]), 1e-9);
            let (ux, uy) = ((b[0] - a[0]) / L, (b[1] - a[1]) / L);
            let mut t = reste;
            while t < L {
                let (x, y) = (a[0] + ux * t, a[1] + uy * t);
                let d = tr.D(x, y);
                let s = tr.esp(d, true);
                let demi = match &l.ws {
                    Some(ws) => ws[k - 1] + ((ws[k] - ws[k - 1]) * t) / L,
                    None => l.demi.unwrap(),
                };
                if d > 0.9 * s0 {
                    let o = demi + 0.5 * s;
                    for c in [1.0, -1.0] {
                        let (sx, sy) = (x - uy * o * c, y + ux * o * c);
                        if !eau(sx, sy) && !lignes.iter().enumerate().any(|(mi, m)| mi != li && ecart(m, sx, sy) < 0.6 * s) {
                            seeds.push(Graine { x: sx, y: sy, s, ligne: Some(li), cote: c as i64, o, b: 0.0, garde: false, cellule: None });
                        }
                    }
                }
                t += s * asp * 0.95;
            }
            reste = t - L;
        }
    }
    // qui fait partie de la ville : le cœur, les faubourgs le long des routes
    for k in 0..seeds.len() {
        let (x, y) = (seeds[k].x, seeds[k].y);
        let b = tr.base(x, y);
        let f = if seeds[k].ligne.is_some_and(|li| lignes[li].kind == "axe") { fa(x, y) } else { 0.0 };
        seeds[k].b = b;
        seeds[k].garde = b > 0.0 || (f > 0.12 && hash2(k as i64, g, 4) < 0.85);
    }
    let mut grille: HashMap<i64, Vec<usize>> = HashMap::new();
    for (k, sd) in seeds.iter().enumerate() {
        grille.entry((sd.x / HG).floor() as i64 * 100003 + (sd.y / HG).floor() as i64).or_default().push(k);
    }
    // cellules de Voronoï des graines gardées ; chaque côté retient la graine voisine
    let mut cellules: Vec<Cellule> = vec![];
    for k in 0..seeds.len() {
        if !seeds[k].garde {
            continue;
        }
        let (x0, y0, s) = (seeds[k].x, seeds[k].y, seeds[k].s);
        let h = if seeds[k].ligne.is_none() { 1.5 * s * asp } else { mx(0.8 * s * asp, 1.15 * seeds[k].o) };
        let mut r0 = 2.4 * s * asp;
        let mut vide = false;
        let (mut Q, mut U): (Vec<Pt>, Vec<i64>) = (vec![], vec![]);
        for _essai in 0..2 {
            Q = vec![[x0 - h, y0 - h], [x0 + h, y0 - h], [x0 + h, y0 + h], [x0 - h, y0 + h]];
            U = vec![-1, -1, -1, -1];
            let mut vs: Vec<(f64, usize)> = vec![];
            for j in voisins(&seeds, &grille, x0, y0, r0) {
                if j != k {
                    vs.push(((seeds[j].x - x0) * (seeds[j].x - x0) + (seeds[j].y - y0) * (seeds[j].y - y0), j));
                }
            }
            let vs = py::sorted_by_key(vs, |e| e.0);
            let mut rho2 = 2.0 * h * h;
            for (d2, j) in vs {
                if d2 > 4.0 * rho2 {
                    break;
                }
                let q = &seeds[j];
                let (nx, ny) = (q.x - x0, q.y - y0);
                (Q, U) = couper(&Q, &U, nx, ny, (nx * (x0 + q.x)) / 2.0 + (ny * (y0 + q.y)) / 2.0, j as i64);
                if Q.len() < 3 {
                    vide = true;
                    break;
                }
                rho2 = 0.0;
                for p in &Q {
                    rho2 = mx(rho2, (p[0] - x0) * (p[0] - x0) + (p[1] - y0) * (p[1] - y0));
                }
            }
            if vide || 4.0 * rho2 <= r0 * r0 {
                break;
            }
            r0 = 2.0 * rho2.sqrt() + 0.01;
        }
        if vide {
            continue;
        }
        // chaque ligne à portée coupe la cellule au tracé, du côté de sa graine (côté -10 - li)
        for (li, l) in lignes.iter().enumerate() {
            if ecart(l, x0, y0) > 3.0 * h {
                continue;
            }
            let (mut m, mut Pp) = (INF, [0.0, 0.0]);
            let pts = &l.pts;
            for q in 1..pts.len() {
                let (d, t) = dist_seg(x0, y0, pts[q - 1], pts[q]);
                if d < m {
                    (m, Pp) = (d, lerp(pts[q - 1], pts[q], t));
                }
            }
            if m < 1e-9 {
                continue;
            }
            let (nx, ny) = ((x0 - Pp[0]) / m, (y0 - Pp[1]) / m);
            (Q, U) = couper(&Q, &U, -nx, -ny, -(nx * Pp[0] + ny * Pp[1]), -10 - li as i64);
            if Q.len() < 3 {
                vide = true;
                break;
            }
        }
        if vide {
            continue;
        }
        let c = centre(&Q);
        seeds[k].cellule = Some(cellules.len());
        cellules.push(Cellule { pts: Q, tags: U, k, c, typ: "" });
    }
    // quartier de chaque îlot selon l'ère
    let dedans = |x: f64, y: f64| -> bool {
        match &mur {
            Some(pts) => dans_poly(pts, x, y),
            None => tr.D(x, y) < Rh * 0.8,
        }
    };
    for ce in cellules.iter_mut() {
        let [x, y] = ce.c;
        let (d, b, n, f) = (tr.D(x, y), seeds[ce.k].b, hash2(ce.k as i64, g, 11), fa(x, y));
        ce.typ = if classique {
            if if mur.is_some() { dedans(x, y) } else { b > (if R < 0.3 { 0.12 } else { 0.3 }) } {
                "vieux"
            } else if b > 0.1 || f > 0.3 {
                "faubourg"
            } else {
                "maraichers"
            }
        } else if dedans(x, y) || d < Rh * 0.85 {
            "vieux"
        } else if b < 0.08 {
            if f > 0.3 {
                "faubourg"
            } else {
                "maraichers"
            }
        } else if n < 0.1 {
            "usine"
        } else if d < Rh * 1.3 && n < 0.5 {
            "immeubles"
        } else {
            "ouvrier"
        };
    }
    // rues : chaque côté rentre de la demi-largeur de sa rue (ou de la route, du quai, du rempart)
    let mut ilots: Vec<Ilot> = vec![];
    for ce in &cellules {
        let sd = &seeds[ce.k];
        let (tags, cp) = (&ce.tags, &ce.pts);
        let sorte = |j: i64| -> String {
            if j <= -10 {
                return lignes[(-10 - j) as usize].kind.clone();
            }
            if j >= 0 && sd.ligne.is_some() && seeds[j as usize].ligne == sd.ligne && seeds[j as usize].cote != sd.cote {
                return lignes[sd.ligne.unwrap()].kind.clone();
            }
            (if j < 0 || seeds[j as usize].cellule.is_none() { "bord" } else { "rue" }).to_string()
        };
        let kinds: Vec<String> = tags.iter().map(|&j| sorte(j)).collect();
        let ligne_de = |i: usize| -> &Ligne { &lignes[if tags[i] <= -10 { (-10 - tags[i]) as usize } else { sd.ligne.unwrap() }] };
        let milieu = |i: usize| -> (f64, f64) {
            let (a, b) = (cp[i], cp[(i + 1) % cp.len()]);
            ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
        };
        let dbloc = |i: usize| -> f64 {
            let kd = kinds[i].as_str();
            if kd == "bord" {
                return 0.0;
            }
            if kd == "rue" {
                return mx(quartier(ce.typ), quartier(cellules[seeds[tags[i] as usize].cellule.unwrap()].typ));
            }
            let (x, y) = milieu(i);
            demi_en(ligne_de(i), x, y)
        };
        let Some((bloc, bk)) = rentrer(cp, &kinds, dbloc) else { continue };
        if aire(&bloc).abs() < 0.00015 {
            continue;
        }
        let mouille = bloc.iter().filter(|p| eau(p[0], p[1])).count();
        if mouille >= 2 || {
            let c = centre(&bloc);
            eau(c[0], c[1])
        } {
            continue;
        }
        let dsol = |i: usize| -> f64 {
            let kd = kinds[i].as_str();
            if kd == "bord" || kd == "rue" {
                return 0.0;
            }
            let (x, y) = milieu(i);
            demi_en(ligne_de(i), x, y) - (if kd == "riviere" { 0.012 } else { 0.0 })
        };
        let sol = rentrer(cp, &kinds, dsol);
        let c = centre(&bloc);
        ilots.push(Ilot { pts: sol.map_or_else(|| bloc.clone(), |s| s.0), bloc, kinds: bk, typ: ce.typ, c, graine: hash2(ce.k as i64, g, 77), sec: mouille == 0 });
    }
    // lieux : place, églises du vieux centre, jardin public (pas de gare : celle du jeu)
    let (mut place, mut m) = (None, INF);
    for (i, il) in ilots.iter().enumerate() {
        let dd = (il.c[0] - cx) * (il.c[0] - cx) + (il.c[1] - cy) * (il.c[1] - cy);
        if dd < m {
            (m, place) = (dd, Some(i));
        }
    }
    if let Some(i) = place {
        ilots[i].typ = "place";
    }
    let mut choix: Vec<usize> = vec![];
    let nmax = mn(12.0, ((Rh / 0.33) * (Rh / 0.33)).floor());
    let vieux: Vec<usize> = (0..ilots.len()).filter(|&i| ilots[i].typ == "vieux" && aire(&ilots[i].bloc).abs() > 0.0022).collect();
    for i in py::sorted_by_key(vieux, |&i| ilots[i].graine) {
        if choix.len() as f64 >= nmax {
            break;
        }
        let c = ilots[i].c;
        if std::iter::once([cx, cy]).chain(choix.iter().map(|&j| ilots[j].c)).all(|p| hypot(p[0] - c[0], p[1] - c[1]) > 0.25) {
            choix.push(i);
        }
    }
    for i in choix {
        ilots[i].typ = "eglise";
    }
    if Rh > 0.6 {
        let vieux: Vec<usize> = (0..ilots.len()).filter(|&i| ilots[i].typ == "vieux" && tr.D(ilots[i].c[0], ilots[i].c[1]) > Rh * 0.4).collect();
        if let Some(i) = py::max_by_key(vieux, |&i| aire(&ilots[i].bloc).abs()) {
            ilots[i].typ = "jardin";
        }
    }
    // (la boîte d'un axe n'est rangée sur son dict qu'au premier `ecart`, comme en Python)
    for (i, a) in axes_v.iter().enumerate() {
        if let Some(b) = lignes[pos_axe[i]].boite.get() {
            a.set("boite", nombres(&b));
        }
    }
    let ilots_v = list![];
    for il in ilots {
        ilots_v.push(dict! {
            "pts" => pts_val(&il.pts), "bloc" => pts_val(&il.bloc), "kinds" => il.kinds.iter().map(Val::from).collect::<Val>(),
            "type" => il.typ, "c" => list![il.c[0], il.c[1]], "graine" => il.graine, "sec" => il.sec,
        });
    }
    P.set("ilots", ilots_v);
}

// ---------------------------------------------------------------------- les entrées, comme planOrganique (villes.js)
pub fn d_seg(x: f64, y: f64, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let t = PV::clamp(((x - a[0]) * dx + (y - a[1]) * dy) / ou(dx * dx + dy * dy, 1.0), 0.0, 1.0);
    hypot(a[0] + dx * t - x, a[1] + dy * t - y)
}

/// La partie d'une polyligne à moins de B du point (du premier au dernier segment proche).
pub fn autour(pts: &[Pt], x: f64, y: f64, B: f64) -> Option<Vec<Pt>> {
    let (mut i0, mut i1) = (None, 0);
    for k in 1..pts.len() {
        if d_seg(x, y, pts[k - 1], pts[k]) < B {
            if i0.is_none() {
                i0 = Some(k - 1);
            }
            i1 = k;
        }
    }
    i0.map(|i0| pts[i0..i1 + 1].to_vec())
}

/// La courtine des remparts de map.js (wallGeom) au rayon r (km).
pub fn enceinte_carte(n: &Val, f: f64, r: f64) -> Vec<Pt> {
    let a0 = (n.at("id").f() * 2.399) % TAU;
    let (nx, ny) = (n.at("x").f(), n.at("y").f());
    let mut pts = vec![];
    let P = |a: f64| -> Pt { [nx + cos(a) * r, ny + sin(a) * r * 0.86] };
    if f <= 2.0 {
        for i in 0..13 {
            pts.push(P(a0 + i as f64 * TAU / 12.0));
        }
    } else {
        let m = if f >= 4.0 { 6.0 } else { 5.0 };
        let w = std::f64::consts::PI / m * 0.42;
        for k in 0..m as i64 {
            let a = a0 + (k as f64 + 0.5) * TAU / m;
            pts.extend([P(a - w), P(a + w)]);
        }
        pts.push(pts[0]);
    }
    pts
}

/// planOrganique : le plan organique du plan V (gardé dans V['org']), None pour un fortin.
pub fn plan_organique(K: &PV::Carte, V: &Val) -> Val {
    if V.has("org") {
        return V.at("org");
    }
    let Pf = V.at("Pf");
    let n = Pf.at("n");
    if Pf.at("modele") == "fortin" {
        V.set("org", Val::None);
        return Val::None;
    }
    let (nid, nx_, ny_) = (n.at("id"), n.at("x").f(), n.at("y").f());
    let ere = if Pf.at("annee") >= 1860 { "industrielle" } else { "classique" };
    let r = Pf.at("R").f() / SF * (1.0 + 0.05 * Pf.at("d").or(0).f());
    let rMur = V.at("rMur").f() / SF;
    let B = 1.75 * r + 0.3;
    struct Axe {
        pts: Vec<Pt>,
        ws: Vec<f64>,
        grand: bool,
        demi: f64,
    }
    let mut axes: Vec<Axe> = vec![];
    let pres = |axes: &[Axe], q: Pt| -> bool { axes.iter().any(|a| (1..a.pts.len()).any(|k| d_seg(q[0], q[1], a.pts[k - 1], a.pts[k]) < 0.03)) };
    for ed in py::sorted_by_key(K.edges.vec(), |e| -(e.get("royal").truthy() as i64)) {
        let mut epts = pts_de(&ed.at("pts"));
        if ed.at("b") == nid {
            epts.reverse();
        }
        let Some(pts) = autour(&epts, nx_, ny_, B) else { continue };
        let mut ech: Vec<Pt> = vec![];
        for k in 1..pts.len() {
            let (a, b) = (pts[k - 1], pts[k]);
            let (mut t, pas) = (0.0, 0.05 / ou(hypot(b[0] - a[0], b[1] - a[1]), 1.0));
            while t < 1.0 {
                ech.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
                t += pas;
            }
        }
        ech.push(pts[pts.len() - 1]);
        let ech: Vec<Pt> = ech.into_iter().filter(|q| hypot(q[0] - nx_, q[1] - ny_) < B + 0.3).collect();
        let mut i0 = 0;
        while i0 < ech.len() && pres(&axes, ech[i0]) {
            i0 += 1;
        }
        let mut i1 = ech.len();
        while i1 > i0 && pres(&axes, ech[i1 - 1]) {
            i1 -= 1;
        }
        let sl = &ech[i0.saturating_sub(1)..(i1 + 1).min(ech.len())];
        let dense: Vec<Pt> = sl.iter().enumerate().filter(|(k, _)| k % 5 == 0 || *k == sl.len() - 1).map(|(_, q)| *q).collect();
        if dense.len() < 2 || (ech[i0..i1].iter().any(|q| pres(&axes, *q)) && ((i1 - i0) as f64) < 0.5 * ech.len() as f64) {
            continue;
        }
        let royal = ed.get("royal").truthy();
        let Dr = DEMI_ROUTE[if royal { 1 } else { 0 }];
        let ws = dense.iter().map(|q| Dr + (RUE_VILLE - Dr) * PV::clamp((1.25 * r - hypot(q[0] - nx_, q[1] - ny_)) / (0.35 * r), 0.0, 1.0)).collect();
        axes.push(Axe { pts: dense, ws, grand: royal, demi: Dr });
    }
    struct Riviere {
        pts: Vec<Pt>,
        w: f64,
    }
    let mut rivieres: Vec<Riviere> = vec![];
    for rv in K.rivers.iter() {
        let pts = autour(&pts_de(&rv.at("pts")), nx_, ny_, B + 0.3);
        let rank = rv.at("rank").i();
        let w = ou(if 0 <= rank && rank < LARG_RIVIERE.len() as i64 { LARG_RIVIERE[rank as usize] } else { 0.0 }, 0.05) / 2.0;
        if let Some(pts) = pts {
            rivieres.push(Riviere { pts, w });
        }
    }
    // ni îlot sur l'eau, ni sous la citadelle, la gare, le château
    let km = |x: f64, y: f64| -> Pt { [nx_ + (x - PV::IC.0) / SF, ny_ + (y - PV::IC.1) / SF] };
    let mut libres: Vec<(Pt, f64)> = vec![];
    if V.at("citadelle").truthy() {
        let C = V.at("citadelle").at("C").xy();
        libres.push((km(C.0, C.1), 90.0 / SF));
    }
    if V.at("gare").truthy() {
        libres.push((km(V.at("gare").at("x").f(), V.at("gare").at("y").f()), 50.0 / SF));
    }
    if Pf.at("modele") == "castrum" {
        libres.push(([nx_, ny_], 30.0 / SF));
    }
    // (boîte de chaque rivière, élargie : écarte vite les points loin de l'eau sans changer la réponse)
    let rbo: Vec<[f64; 4]> = rivieres
        .iter()
        .map(|rv| {
            let (xs, ys) = (rv.pts.iter().map(|p| p[0]), rv.pts.iter().map(|p| p[1]));
            [
                py::min_f(xs.clone()).unwrap() - 2.0 * rv.w,
                py::min_f(ys.clone()).unwrap() - 2.0 * rv.w,
                py::max_f(xs).unwrap() + 2.0 * rv.w,
                py::max_f(ys).unwrap() + 2.0 * rv.w,
            ]
        })
        .collect();
    let eau = |x: f64, y: f64| -> bool {
        if K.eauK(x, y) > 0.42 {
            return true;
        }
        for (rv, bo) in rivieres.iter().zip(&rbo) {
            if bo[0] <= x && x <= bo[2] && bo[1] <= y && y <= bo[3] {
                let p = &rv.pts;
                if (1..p.len()).any(|k| d_seg(x, y, p[k - 1], p[k]) < rv.w) {
                    return true;
                }
            }
        }
        libres.iter().any(|(c, d)| hypot(x - c[0], y - c[1]) < *d)
    };
    let f = Pf.at("f");
    let mur = if f > 0 {
        dict! { "pts" => pts_val(&enceinte_carte(&n, f.f(), rMur)), "kind" => "mur", "demi" => 0.012, "dessine" => false }
    } else if Pf.at("murs") == "cours" {
        dict! { "pts" => pts_val(&enceinte_carte(&n, 1.0, rMur)), "kind" => "boulevard", "demi" => 0.015 }
    } else {
        Val::None
    };
    let axes_v: Val = axes.iter().map(|a| dict! { "pts" => pts_val(&a.pts), "ws" => nombres(&a.ws), "libre" => true, "grand" => a.grand, "demi" => a.demi }).collect();
    let rivieres_v: Val = rivieres.iter().map(|rv| dict! { "pts" => pts_val(&rv.pts), "ws" => nombres(&vec![rv.w; rv.pts.len()]), "w" => rv.w }).collect();
    let v = dict! {
        "x" => nx_, "y" => ny_, "pop" => Pf.at("pop"), "ere" => ere, "r" => r, "rh" => if mur.truthy() { rMur } else { r * 0.5 },
        "graine" => Pf.at("sd"), "axes" => axes_v, "rivieres" => rivieres_v, "mur" => mur, "toutes" => true, "gare" => false, "serre" => true,
        "damier" => matches!(Pf.at("modele").s(), "bastide" | "place"),
    };
    let O = generer_plan(&v, &eau);
    V.set("org", &O);
    O
}

/// Le plan organique de la place nid dans cet état (celui de la carte), None pour un fortin ; gardé avec PV.plan.
/// plan(geo, nid, annee=1789, f=None, pop=None, d=0) : `Val::None` vaut le défaut du Python.
pub fn plan(geo: &impl PV::Geo, nid: i64, annee: impl Into<Val>, f: impl Into<Val>, pop: impl Into<Val>, d: impl Into<Val>) -> Val {
    plan_organique(&PV::carte_de(geo), &PV::plan(geo, nid, annee, f, pop, d))
}
