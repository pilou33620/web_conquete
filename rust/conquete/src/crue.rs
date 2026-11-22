//! Les routes que la crue de la Garonne et de la Dordogne coupe (SPEC-CARTE-2D, lot H) : là où une route passe plus de
//! 240 m dans les prés noyés, loin des places. Même critère que la carte (web/js/carte/terre.js `inonde`, relief approché
//! d'après le terrain ; travaux.js), recalculé ici d'après les mêmes données (client_payload) : le serveur est seul à
//! décider, la carte dessine sa liste (`cut` de l'état). Calculé une fois par carte (sur geo._crue).
//!
//! Porte game/crue.py (PORTAGE.md).
#![allow(non_snake_case)]

use crate::geo::GeoMap;
use crate::py::{self, Val};
use crate::{dict, list, tup};

pub const DELAY: f64 = 1.0;  // jours : passer la partie noyée d'une route coupée, à gué ou par un détour (quelle que soit sa longueur)
pub const HT: [f64; 11] = [-0.1, -0.05, 0.04, 0.1, 0.05, 0.0, 0.38, 0.9, 1.6, 0.14, 0.16]; // altitude approchée par terrain (terre.js)
// (un tableau natif : il ne sert que dans des calculs ; HT[0] = -.1, comme en Python)
pub const M32: i64 = 0xffffffff;

/// Python : `_hash2(i, j, k)`.
/// Les produits dépassent 32 bits : calculer en u64 (ou i128) avant de masquer par M32.
// game/crue.py, lignes 14 à 17
pub fn _hash2(i: i64, j: i64, k: i64) -> f64 {
    // (entiers de Python sans borne : en i128 avant le masque, puis en u64)
    let n = ((i as i128 * 374761393 + j as i128 * 668265263 + k as i128 * 1442695041) & M32 as i128) as u64;
    let n = ((n ^ (n >> 13)) * 1274126177) & M32 as u64;
    (n ^ (n >> 16)) as f64 / 4294967296.0
}

/// le sinus rapide de terre.js (Math.round arrondit les moitiés vers le haut)
/// Python : `_sn(x)`.
// game/crue.py, lignes 20 à 23
pub fn _sn(x: f64) -> f64 {
    let x = x - 6.283185307179586 * (x * 0.15915494309189535 + 0.5).floor();
    let y = 1.2732395447351628 * x - 0.4052847345693511 * x * x.abs();
    0.225 * (y * y.abs() - y) + y
}

/// Python : `_bruit(i, j, s)`.
// game/crue.py, lignes 26 à 27
pub fn _bruit(i: f64, j: f64, s: f64) -> f64 {
    0.5 + 0.25 * _sn(i * 0.31 + s) * _sn(j * 0.27 - s * 0.6 + 1.5707963267948966) + 0.25 * _sn((i * 0.13 - j * 0.17) + s * 2.3)
}

/// Python : `_lerp(a, b, t)`.
// game/crue.py, lignes 30 à 31
pub fn _lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Python : `_clamp(v, a, b)`.
/// Sert aussi sur des entiers (`_clamp(math.floor(x - .5), 0, W - 2)` dans _bil) : l'appelant convertit
/// (le résultat y est un indice entier).
// game/crue.py, lignes 34 à 35
pub fn _clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}

/// Le relief approché et la distance au fleuve, par case, en flottants 32 bits comme les Float32Array du client.
/// Python : `class _Terre`. W, H : la taille de la grille de la carte ; ALT : le relief approché, CRUE : la
/// distance (km) au lit de la Garonne ou de la Dordogne, par case, en `array('f')` (arrondis en f32 à
/// l'écriture, relus en f64).
pub struct _Terre {
    pub W: i64,
    pub H: i64,
    pub ALT: Vec<f32>,
    pub CRUE: Vec<f32>,
}

impl _Terre {
    /// Python : `__init__(self, geo, rivers)`.
    /// `_Terre(geo, rivers)`. rivers : la liste `rivers` de geo.client_payload() (dict(rank, name, pts)).
    // game/crue.py, lignes 41 à 72
    pub fn new(geo: &GeoMap, rivers: &Val) -> _Terre {
        let (W, H) = (geo.W, geo.H);
        let TER = &geo.terrain;
        let mut A: Vec<f32> =
            (0..W * H).map(|k| (HT[TER[k as usize] as usize] + 0.06 * _hash2(k % W, k / W, 7)) as f32).collect();
        for _ in 0..3 {
            let mut t = vec![0f32; (W * H) as usize];
            for j in 0..H {
                let rows: Vec<i64> = [j - 1, j, j + 1].into_iter().filter(|&r| 0 <= r && r < H).collect();
                for i in 0..W {
                    let (mut s, mut n) = (0.0f64, 0i64);
                    for &r in &rows {
                        for x in [i - 1, i, i + 1] {
                            if 0 <= x && x < W {
                                s += A[(r * W + x) as usize] as f64;
                                n += 1;
                            }
                        }
                    }
                    t[(j * W + i) as usize] = (s / n as f64) as f32;
                }
            }
            A = t;
        }
        let mut C = vec![3.0f32; (W * H) as usize];
        for r in rivers.iter() {
            let name = r.get("name");
            let name = if name.truthy() { name.string() } else { String::new() };
            if r.at("rank") != 1 || !(name.contains("Garonne") || name.contains("Dordogne")) {
                continue;
            }
            let p = r.at("pts");
            for k in 1..p.len() as i64 {
                let ((ax, ay), (bx, by)) = (p.at(k - 1).xy(), p.at(k).xy());
                let l2 = py::pow(bx - ax, 2.0) + py::pow(by - ay, 2.0);
                let l2 = if l2 != 0.0 { l2 } else { 1e-9 };
                let (j0, j1) = (0i64.max((ay.min(by) - 3.0).floor() as i64), (H - 1).min((ay.max(by) + 3.0).ceil() as i64));
                for j in j0..=j1 {
                    let (i0, i1) = (0i64.max((ax.min(bx) - 3.0).floor() as i64), (W - 1).min((ax.max(bx) + 3.0).ceil() as i64));
                    for i in i0..=i1 {
                        let (fi, fj) = (i as f64, j as f64);
                        let u = _clamp(((fi + 0.5 - ax) * (bx - ax) + (fj + 0.5 - ay) * (by - ay)) / l2, 0.0, 1.0);
                        let d = py::hypot(fi + 0.5 - ax - u * (bx - ax), fj + 0.5 - ay - u * (by - ay));
                        let c = &mut C[(j * W + i) as usize];
                        if d < *c as f64 {
                            *c = d as f32;
                        }
                    }
                }
            }
        }
        _Terre { W, H, ALT: A, CRUE: C }
    }

    /// Python : `_bil(self, G, x, y)`.
    /// G : self.ALT ou self.CRUE.
    // game/crue.py, lignes 74 à 78
    pub fn _bil(&self, G: &[f32], x: f64, y: f64) -> f64 {
        let W = self.W;
        let i = ((x - 0.5).floor() as i64).clamp(0, W - 2);
        let j = ((y - 0.5).floor() as i64).clamp(0, self.H - 2);
        let (fx, fy, k) = (_clamp(x - 0.5 - i as f64, 0.0, 1.0), _clamp(y - 0.5 - j as f64, 0.0, 1.0), (j * W + i) as usize);
        let g = |k: usize| G[k] as f64;
        let W = W as usize;
        _lerp(_lerp(g(k), g(k + 1), fx), _lerp(g(k + W), g(k + W + 1), fx), fy)
    }

    /// Python : `inonde(self, x, y)`.
    // game/crue.py, lignes 80 à 85
    pub fn inonde(&self, x: f64, y: f64) -> bool {
        let d = self._bil(&self.CRUE, x, y);
        if d >= 2.1 {
            return false; // (plus loin, jamais noyé : le seuil ne dépasse pas 2,01 km)
        }
        let a = self._bil(&self.ALT, x, y);
        a <= 0.11 && d < 0.25 + 1.1 * _bruit(x * 0.9, y * 0.9, 3.3) * (1.0 - a * 6.0)
    }
}

/// surChemin (lib.js) : le point à s km le long du tracé
/// Python : `_sur(pts, s)`.
/// pts : une liste de points [x, y] (au moins deux : spans ne l'appelle pas autrement).
// game/crue.py, lignes 88 à 95
pub fn _sur(pts: &Val, s: f64) -> (f64, f64) {
    let n = pts.len() as i64;
    let mut s = s;
    for i in 1..n {
        let ((x0, y0), (x1, y1)) = (pts.at(i - 1).xy(), pts.at(i).xy());
        let l = py::hypot(x1 - x0, y1 - y0);
        if s <= l || i == n - 1 {
            let k = if l != 0.0 { _clamp(s / l, 0.0, 1.0) } else { 0.0 };
            return (_lerp(x0, x1, k), _lerp(y0, y1, k));
        }
        s -= l;
    }
    panic!("_sur : il faut au moins deux points")
}

/// rayonPlace (guerre.js), d'après la population de départ
/// Python : `_rayon(n)`.
/// n : un lieu de geo.client_payload()["nodes"] (dict avec pop0).
// game/crue.py, lignes 98 à 101
pub fn _rayon(n: &Val) -> f64 {
    // (figé sur le rayon des cartes de version 5 : la règle de la crue des parties en cours ne suit pas le dessin des villes)
    let p = n.get("pop0");
    let p = if p.truthy() { p.f() } else { 700.0 };
    let v = 2.1 * p.sqrt() - 36.0;
    let v = if 20.0 >= v { 20.0 } else { v };
    let v = if 262.0 <= v { 262.0 } else { v };
    let (q, f) = (v / 4.0, (v / 4.0).floor());
    (if q - f >= 0.5 { f + 1.0 } else { f }) * 4.0 / 180.0 // (Math.round : au plus proche, les moitiés vers +∞)
}

/// {arête : [(début, fin) en km le long de son tracé, …]} : les routes que la crue coupe.
/// Python : `spans(geo)`.
/// Rend {numéro d'arête: liste de tuples (début, fin)} ; rangé dans `geo._crue` (un `RefCell<Val>`) : le même dict
/// à chaque appel.
// game/crue.py, lignes 104 à 130
pub fn spans(geo: &GeoMap) -> Val {
    if geo._crue.borrow().is_some() {
        return geo._crue.borrow().clone();
    }
    if geo.theatre.is_some() {
        *geo._crue.borrow_mut() = dict! {}; // (un théâtre : aucune route coupée, la crue est celle de la Garonne et de la Dordogne)
        return geo._crue.borrow().clone();
    }
    let m = geo.client_payload();
    let T = _Terre::new(geo, &m.at("rivers"));
    let places: Vec<(f64, f64, f64)> = m.at("nodes").iter().map(|n| (n.atf("x"), n.atf("y"), _rayon(&n) + 0.5)).collect();
    let out = dict! {};
    for e in m.at("edges").iter() {
        let pts = e.at("pts");
        if e.get("kind") == "water" || e.getb("ferry") || pts.len() < 2 {
            continue;
        }
        let np = pts.len() as i64;
        let L = py::sum((1..np).map(|i| {
            let (a, b) = (pts.at(i).xy(), pts.at(i - 1).xy());
            py::hypot(a.0 - b.0, a.1 - b.1)
        }));
        let (mut s, mut s0): (f64, Option<f64>) = (0.2, None);
        while s <= L {
            let (x, y) = _sur(&pts, if L < s { L } else { s });
            let noye = s < L - 0.2
                && T.inonde(x, y)
                && !places.iter().any(|&(px, qy, r)| (px - x).abs() < 3.0 && py::hypot(px - x, qy - y) < r);
            if noye && s0.is_none() {
                s0 = Some(s);
            }
            if !noye {
                if let Some(d) = s0 {
                    if s - d >= 0.24 {
                        out.setdefault(e.at("id"), list![]).push(tup![py::round_n(d, 3), py::round_n(s, 3)]);
                    }
                    s0 = None;
                }
            }
            s += 0.12;
        }
    }
    *geo._crue.borrow_mut() = out.clone();
    out
}
