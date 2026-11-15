//! Les routes que la crue de la Garonne et de la Dordogne coupe (SPEC-CARTE-2D, lot H) : là où une route passe plus de
//! 240 m dans les prés noyés, loin des places. Même critère que la carte (web/js/carte/terre.js `inonde`, relief approché
//! d'après le terrain ; travaux.js), recalculé ici d'après les mêmes données (client_payload) : le serveur est seul à
//! décider, la carte dessine sa liste (`cut` de l'état). Calculé une fois par carte (sur geo._crue).
//!
//! Porte game/crue.py (PORTAGE.md). SQUELETTE : les constantes sont portées ; les corps sont des `todo!()`. Une
//! signature ne se change pas sans le signaler.
#![allow(unused_imports, unused_variables)] // squelette : à retirer quand les corps sont portés

use crate::geo::GeoMap;
use crate::py::{self, Val};
use crate::tactics::jsmath;
use crate::{dict, list, py_const, tup};

pub const DELAY: f64 = 1.0;  // jours : passer la partie noyée d'une route coupée, à gué ou par un détour (quelle que soit sa longueur)
pub const HT: [f64; 11] = [-0.1, -0.05, 0.04, 0.1, 0.05, 0.0, 0.38, 0.9, 1.6, 0.14, 0.16]; // altitude approchée par terrain (terre.js)
// (un tableau natif : il ne sert que dans des calculs ; HT[0] = -.1, comme en Python)
pub const M32: i64 = 0xffffffff;

/// Python : `_hash2(i, j, k)`.
/// Les produits dépassent 32 bits : calculer en u64 (ou i128) avant de masquer par M32.
// game/crue.py, lignes 14 à 17
pub fn _hash2(i: i64, j: i64, k: i64) -> f64 {
    todo!()
}

/// le sinus rapide de terre.js (Math.round arrondit les moitiés vers le haut)
/// Python : `_sn(x)`.
// game/crue.py, lignes 20 à 23
pub fn _sn(x: f64) -> f64 {
    todo!()
}

/// Python : `_bruit(i, j, s)`.
// game/crue.py, lignes 26 à 27
pub fn _bruit(i: f64, j: f64, s: f64) -> f64 {
    todo!()
}

/// Python : `_lerp(a, b, t)`.
// game/crue.py, lignes 30 à 31
pub fn _lerp(a: f64, b: f64, t: f64) -> f64 {
    todo!()
}

/// Python : `_clamp(v, a, b)`.
/// Sert aussi sur des entiers (`_clamp(math.floor(x - .5), 0, W - 2)` dans _bil) : l'appelant convertit
/// (le résultat y est un indice entier).
// game/crue.py, lignes 34 à 35
pub fn _clamp(v: f64, a: f64, b: f64) -> f64 {
    todo!()
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
        todo!()
    }

    /// Python : `_bil(self, G, x, y)`.
    /// G : self.ALT ou self.CRUE.
    // game/crue.py, lignes 74 à 78
    pub fn _bil(&self, G: &[f32], x: f64, y: f64) -> f64 {
        todo!()
    }

    /// Python : `inonde(self, x, y)`.
    // game/crue.py, lignes 80 à 85
    pub fn inonde(&self, x: f64, y: f64) -> bool {
        todo!()
    }
}

/// surChemin (lib.js) : le point à s km le long du tracé
/// Python : `_sur(pts, s)`.
/// pts : une liste de points [x, y] (au moins deux : spans ne l'appelle pas autrement).
// game/crue.py, lignes 88 à 95
pub fn _sur(pts: &Val, s: f64) -> (f64, f64) {
    todo!()
}

/// rayonPlace (guerre.js), d'après la population de départ
/// Python : `_rayon(n)`.
/// n : un lieu de geo.client_payload()["nodes"] (dict avec pop0).
// game/crue.py, lignes 98 à 101
pub fn _rayon(n: &Val) -> f64 {
    todo!()
}

/// {arête : [(début, fin) en km le long de son tracé, …]} : les routes que la crue coupe.
/// Python : `spans(geo)`.
/// Rend {numéro d'arête: liste de tuples (début, fin)} ; rangé dans `geo._crue` (un `RefCell<Val>`) : le même dict
/// à chaque appel.
// game/crue.py, lignes 104 à 130
pub fn spans(geo: &GeoMap) -> Val {
    todo!()
}
