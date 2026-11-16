//! Le portage de game/tactics/terrain_ville.py.
//!
//! Batailles sur le plan des villes (SPEC-VILLES-BATAILLE.md) : une bataille à une place, ou tout près, se livre dans
//! la ville de la carte de campagne (plan_organique.py, le portage de web/js/carte/plan-organique.js) : mêmes rues, mêmes
//! îlots, mêmes routes et mêmes remparts, à l'échelle et dans le bon sens.
//!
//! Le plan est posé sur la grille de 20 m (cartes de version 9) :
//! - l'enceinte des remparts de la carte (map.js : wallGeom ; douze pans à tours, tracé bastionné, demi-lunes ; la
//!   citadelle de plan_ville) en MUR, percée de PORTE là où passent les routes ; brèches, glacis et canons du rempart
//!   comme avant (terrain._enceinte) ;
//! - les rues (une rangée de cases sur l'axe de chaque rue entre deux îlots, les routes du plan) en ROUTE (CHEMIN au
//!   village), la grand-place, les parvis ; le boulevard des murs abattus ;
//! - les îlots à n côtés : maisons (BATI) le long de leurs côtés sur rue, sur la profondeur d'une parcelle, cours et
//!   jardins (PRE) au milieu, maraîchers en pré ; les édifices (église, cathédrale, couvent, hôpital, hôtel, caserne,
//!   halle, château, gare) sur l'emprise de leur modèle, que le client dessine au même endroit (to_client : plan) ;
//! - quais ; la mer et les étangs autour de la ville d'après la campagne (sans le tremblé).
//!
//! Une place trop grande pour le champ de bataille (3 × 2 km, l'assaillant doit pouvoir se déployer hors des murs) fait
//! réduire toute la carte (échelle k < 1 : la campagne autour aussi, pour que rivières et côtes restent à leur place).
//!
//! Ce qui change de forme en Rust (le reste se lit côte à côte avec le Python) :
//! - `t` est `m.t` (comme dans terrain.rs) : `ville` et `_metiers` ne reçoivent plus la grille à part ;
//! - un îlot du `Lieu` est un struct `Ilot` (mêmes champs que le dict du Python), un ensemble de cases un `BTreeSet` ;
//! - `V['eau'](x, y)` est `PV::eau(&L.K, &L.V, x, y)` : le `Lieu` garde la carte `K` de plan_ville ;
//! - un édifice d'un îlot (`id(b)` en Python) est désigné par le rang de l'îlot (c'est ce que le client reçoit).
#![allow(non_snake_case)]

use crate::geo::GeoMap;
use crate::py::{self, Random, Val};
use crate::tactics::plan_organique as PO;
use crate::tactics::plan_ville as PV;
use crate::tactics::terrain::{
    _barricades, _causeway, _dedans, _densify, _enceinte, _line4, _mainland, _poly_cells, _redoubts, _seg_dist, bfs, cell_of, center_of, cherche, dans,
    pmax, pmin, pts_de, pts_ronds, pts_val, BattleMap, Pt, CELL, COLS, H, N, RUE, ROWS, T_BATI, T_BOIS, T_CHAMP, T_CHEMIN, T_EAU, T_FORET_T, T_GUE,
    T_LANDE_T, T_MARAIS_T, T_MUR, T_PORTE, T_PRE, T_ROCHE, T_ROUTE, T_SABLE, T_VERGER, T_VIGNE_T, VILLES, W,
};
use crate::{dict, list, tup};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::f64::consts::PI;
use std::rc::Rc;

const NU: usize = N as usize;
const WF: f64 = W as f64;
const HF: f64 = H as f64;
const CELLF: f64 = CELL as f64;
const IC: Pt = PV::IC;
const SF: f64 = PV::S as f64;

// emprises des modèles de bâtiments (web/js/battle/decor2d-dessin.js, D.boite, en unités du modèle)
pub const BOITE: [(&str, (f64, f64, f64, f64)); 12] = [
    ("cathedrale", (-53.0, -26.0, 55.4, 26.0)),
    ("egliseRomane", (-27.0, -7.3, 15.0, 7.3)),
    ("egliseDome", (-36.0, -20.0, 29.0, 20.0)),
    ("halle", (-24.0, -13.0, 24.0, 13.0)),
    ("caserne", (-42.0, -26.0, 42.0, 20.5)),
    ("hotel", (-28.0, -11.0, 28.0, 27.0)),
    ("hopital", (-26.0, -20.0, 26.0, 20.0)),
    ("hotelDeVille", (-24.0, -8.0, 24.0, 8.0)),
    ("couvent", (-31.0, -34.3, 18.0, 18.0)),
    ("poudriere", (-10.0, -7.6, 10.0, 7.6)),
    ("chateau", (-44.0, -14.0, 44.0, 34.0)),
    ("gare", (-50.0, -30.0, 28.0, 16.0)),
];
pub const COUR: [&str; 4] = ["caserne", "hotel", "couvent", "hopital"]; // bâtis autour d'une cour : la cour reste un pré
pub const SOL: [i64; 8] = [T_BOIS, T_FORET_T, T_MARAIS_T, T_LANDE_T, T_ROCHE, T_SABLE, T_VIGNE_T, T_VERGER]; // rasé dans la ville
// les métiers du plan (genererInterieur : plus) : modèle du client (decor2d.js, METIERS), nature du bâtiment, emprise
// (unités du modèle) et échelle (m par unité du modèle : à leur vraie taille, comme les maisons)
pub const METIERS: [(&str, (&str, &str, (f64, f64, f64, f64), f64)); 9] = [
    ("ferme", ("fermeCour", "ferme", (-31.0, -27.0, 30.0, 27.0), 0.6)),
    ("mas", ("mas", "ferme", (-21.0, -7.0, 18.0, 5.0), 0.7)),
    ("chateauVin", ("chateau", "chateau", (-44.0, -14.0, 44.0, 34.0), 0.4)),
    ("scierie", ("scierie", "scierie", (-12.0, -7.0, 12.0, 7.0), 0.8)),
    ("forge", ("forge", "forge", (-14.0, -8.0, 14.0, 8.0), 0.8)),
    ("sechoir", ("sechoir", "sechoir", (-20.0, -5.0, 20.0, 5.0), 0.8)),
    ("moulin", ("moulin", "moulin", (-7.0, -7.0, 7.0, 7.0), 0.5)),
    ("moulinEau", ("moulinEau", "moulin", (-6.0, -22.0, 28.0, -9.0), 0.5)),
    ("airial", ("airial", "ferme", (-18.0, -6.0, 24.0, 10.0), 0.8)),
];
pub const PROF: f64 = 16.0; // m : profondeur d'une maison sur rue (le client les dessine à cette taille, pas à celle de l'intérieur)
pub const DEPLOI: f64 = 400.0; // m entre l'enceinte et le bord de l'assaillant (sa bande de déploiement, battle._zones)

pub const RUES_O: [&str; 4] = ["rue", "axe", "riviere", "boulevard"]; // (côtés d'un îlot organique qui donnent sur une rue, une route, un quai)

fn boite(cle: &str) -> (f64, f64, f64, f64) {
    cherche(&BOITE, cle).unwrap_or_else(|| panic!("KeyError: '{cle}'"))
}

/// Les quatre voisines d'une case (sans garde de bord, comme le Python : `c - 1` peut être au bout de la rangée d'avant).
fn voisins(c: i64) -> [i64; 4] {
    [c - 1, c + 1, c - COLS, c + COLS]
}

fn r1(p: Pt) -> Val {
    list![py::round_n(p.0, 1), py::round_n(p.1, 1)]
}

/// Les remparts de la carte (map.js : wallGeom) au rayon r (km) : (anneau, demi-lunes, tours ou None), en km. Le
/// plan organique bâtit jusqu'à leur courtine (villes.js : enceinteCarte, mêmes angles).
pub fn enceinte_carte(n: &Val, f: i64, r: f64) -> (Vec<Pt>, Vec<Vec<Pt>>, Option<Vec<Pt>>) {
    let a0 = py::mod_f(n.at("id").f() * 2.399, PV::TAU);
    let (nx, ny) = (n.atf("x"), n.atf("y"));
    let P = |a: f64, rr: f64| -> Pt { (nx + a.cos() * rr, ny + a.sin() * rr * 0.86) };
    if f <= 2 {
        let ring: Vec<Pt> = (0..12).map(|i| P(a0 + i as f64 * PV::TAU / 12.0, r)).collect();
        let tours = ring.iter().copied().step_by(if f == 1 { 3 } else { 2 }).collect();
        return (ring, vec![], Some(tours));
    }
    let m = if f >= 4 { 6 } else { 5 };
    let (mut ring, mut lunes) = (vec![], vec![]);
    let w = PI / m as f64 * 0.42;
    for k in 0..m {
        let a = a0 + (k as f64 + 0.5) * PV::TAU / m as f64;
        ring.extend([P(a - w, r), P(a - w, r * 1.13), P(a, r * 1.42), P(a + w, r * 1.13), P(a + w, r)]);
    }
    if f >= 4 {
        let d = PI / m as f64 * 0.32;
        lunes = (0..m)
            .map(|k| a0 + k as f64 * PV::TAU / m as f64)
            .map(|a| vec![P(a - d, r * 1.22), P(a, r * 1.62), P(a + d, r * 1.22)])
            .collect();
    }
    (ring, lunes, None)
}

/// Jusqu'où porte la place, en unités depuis IC : les remparts de la carte (bastions et demi-lunes compris), la
/// citadelle, sinon le rayon du mur.
pub fn rayon_enceinte(V: &Val) -> f64 {
    let f = V.at("Pf").ati("f");
    let mut r = V.atf("rMur") * (if f >= 4 { 1.62 } else if f >= 3 { 1.42 } else { 1.0 });
    let ct = V.at("citadelle");
    if ct.truthy() {
        for p in ct.at("poly").iter() {
            let (x, y) = p.xy();
            r = pmax(r, PV::hypot(x - IC.0, y - IC.1));
        }
        for rv in ct.at("ravs").iter() {
            let (x, y) = rv.at("apex").xy();
            r = pmax(r, PV::hypot(x - IC.0, y - IC.1));
        }
    }
    r
}

/// Un îlot du plan organique posé dans le repère du plan (le dict de `Lieu.ilots` du Python, mêmes champs).
#[derive(Clone, Debug)]
pub struct Ilot {
    pub q: Vec<Pt>,
    pub ins: Vec<Pt>,
    pub c: Pt,
    pub typ: String,
    pub zone: &'static str,
    pub main: bool,
    pub cotes: Vec<bool>,
    pub kinds: Vec<String>,
    pub sd: i64,
    pub role: Option<&'static str>,
}

/// Le plan d'une place posé sur la carte : V (plan_ville : profil, rayon du mur, citadelle, gare, métiers), O (le
/// plan organique de la carte : îlots, routes, enceinte), k (échelle de la carte), pos (centre en m). Tout est rendu
/// en unités du plan (S par km, centrées sur IC) : tf les pose en mètres.
pub struct Lieu {
    pub V: Val,
    pub O: Val,
    /// échelle de la carte
    pub k: f64,
    pub nid: Val,
    pub Mk: f64,
    /// centre de la place, en mètres
    pub pos: Pt,
    /// (la place sur la carte de campagne, en km : le repère de `u`)
    pub nx: f64,
    pub ny: f64,
    pub ilots: Vec<Ilot>,
    /// (anneau, demi-lunes, bastionné ?, tours ou None), en unités du plan
    pub enceinte: Option<(Vec<Pt>, Vec<Vec<Pt>>, bool, Option<Vec<Pt>>)>,
    pub cours: Option<Vec<Pt>>,
    pub r_eau: f64,
    pub r_calme: f64,
    pub r_mur: f64,
    pub r_ville: f64,
    /// les noms des rivières du plan (un set de textes)
    pub rivieres: Val,
    /// (la carte de plan_ville, pour `V['eau']`)
    pub K: Rc<PV::Carte>,
}

impl Lieu {
    /// km : ce que vaut une case de la carte de campagne (1 km, ou 5 en Europe : GeoMap::km_case).
    pub fn new(V: Val, O: Val, k: f64, km: f64, n: &Val, cx: f64, cy: f64, K: Rc<PV::Carte>) -> Lieu {
        let Mk = PV::M * k;
        let (nx, ny) = (n.atf("x"), n.atf("y"));
        let pos = (WF / 2.0 + (nx - cx) * 1000.0 * k * km, HF / 2.0 + (ny - cy) * 1000.0 * k * km);
        let u = |p: Pt| -> Pt { (IC.0 + (p.0 - nx) * SF, IC.1 + (p.1 - ny) * SF) };
        let mut ilots = vec![];
        if O.truthy() {
            for il in O.at("ilots").iter() {
                let typ = il.ats("type");
                let kinds: Vec<String> = il.at("kinds").iter().map(|kd| kd.string()).collect();
                ilots.push(Ilot {
                    q: pts_de(&il.at("pts")).into_iter().map(u).collect(),
                    ins: pts_de(&il.at("bloc")).into_iter().map(u).collect(),
                    c: u(il.at("c").xy()),
                    zone: if typ == "faubourg" || typ == "maraichers" { "faubourg" } else { "ville" },
                    main: kinds.iter().any(|kd| kd == "axe"),
                    cotes: kinds.iter().map(|kd| RUES_O.contains(&kd.as_str())).collect(),
                    kinds,
                    typ,
                    sd: py::int(il.atf("graine") * 2147483648.0),
                    role: None,
                });
            }
        }
        _roles(&mut ilots, &V);
        let f = V.at("Pf").ati("f");
        let enceinte = if f > 0 {
            let (ring, lunes, tours) = enceinte_carte(n, f, V.atf("rMur") / SF);
            Some((
                ring.into_iter().map(u).collect(),
                lunes.into_iter().map(|l| l.into_iter().map(u).collect()).collect(),
                f >= 3,
                tours.filter(|t| !t.is_empty()).map(|t| t.into_iter().map(u).collect()),
            ))
        } else {
            None
        };
        let mur = if O.truthy() { O.at("mur") } else { Val::None };
        let cours = if mur.truthy() && mur.at("kind") == "boulevard" { Some(pts_de(&mur.at("pts")).into_iter().map(u).collect()) } else { None };
        let portee = |b: &Ilot| py::max_f(b.q.iter().map(|p| PV::hypot(p.0 - IC.0, p.1 - IC.1))).expect("ValueError: max() arg is an empty sequence");
        let ext = ilots.iter().fold(60.0, |a, b| pmax(a, portee(b)));
        let r_eau = pmax(ext, rayon_enceinte(&V)) * Mk + 120.0; // (la mer et les étangs, d'après le plan)
        let r_calme = r_eau + 200.0; // (les rivières sans méandres : celles du plan)
        let r_mur = rayon_enceinte(&V) * Mk;
        let ext_v = ilots.iter().filter(|b| b.zone == "ville").fold(0.0, |a, b| pmax(a, portee(b)));
        let r_ville = pmax(r_mur, ext_v * Mk); // (rien ne traverse la ville que les rivières du plan)
        let rivieres = Val::set_from(V.at("Pf").at("rivs").iter().map(|r| r.at("name")).collect());
        Lieu { nid: n.at("id"), V, O, k, Mk, pos, nx, ny, ilots, enceinte, cours, r_eau, r_calme, r_mur, r_ville, rivieres, K }
    }

    /// `L.u(p)` : un point de la carte de campagne (km) en unités du plan.
    pub fn u(&self, p: Pt) -> Pt {
        (IC.0 + (p.0 - self.nx) * SF, IC.1 + (p.1 - self.ny) * SF)
    }

    pub fn tf(&self, p: Pt) -> Pt {
        (self.pos.0 + (p.0 - IC.0) * self.Mk, self.pos.1 + (p.1 - IC.1) * self.Mk)
    }

    pub fn unites(&self, x: f64, y: f64) -> Pt {
        (IC.0 + (x - self.pos.0) / self.Mk, IC.1 + (y - self.pos.1) / self.Mk)
    }
}

/// Le bord d'où vient l'assaillant (battle._zones, sans le repli vers un bord plus sec).
pub fn bord_assaillant(a: f64) -> &'static str {
    let (ca, sa) = (a.cos(), a.sin());
    if ca.abs() * HF >= sa.abs() * WF * 0.66 {
        return if ca > 0.0 { "E" } else { "O" };
    }
    if sa > 0.0 {
        "S"
    } else {
        "N"
    }
}

/// Avant la carte : le plan de la place pl dans son état (année, f, pop, d) et l'échelle k de la carte. Une place
/// assiégée tient avec ses murs à DEPLOI m du bord de l'assaillant et à 20 m des autres ; près d'une bataille rangée,
/// elle ne dépasse pas 600 m de rayon.
pub fn preparer(geo: &GeoMap, spec: &Val, pl: &Val, cx: f64, cy: f64) -> Lieu {
    let n = geo.nodes.at(&pl.at("nid"));
    let nid = pl.ati("nid");
    let etat = || (spec.get_or("year", 1790), pl.get_or("f", pl.get_or("fort", n.at("fort"))), pl.get("pop").or(n.at("pop0")), pl.get_or("d", 0));
    let (a, f, p, d) = etat();
    let V = PV::plan(geo, nid, a, f, p, d);
    let (a, f, p, d) = etat();
    let O = PO::plan(geo, nid, a, f, p, d);
    let r = rayon_enceinte(&V) * PV::M + 30.0; // (fossé, chemin couvert)
    let (e0, mut k) = (bord_assaillant(spec.get_or("att_angle", 0.0).f()), 1.0);
    // (près de l'eau, battle._zones peut faire venir l'assaillant par un autre bord, plus sec : place pour lui partout)
    let K = PV::carte_de(geo);
    let (nx, ny) = (n.atf("x"), n.atf("y"));
    let km = geo.km_case; // (une case : 1 km, ou 5 en Europe)
    let mouille = [0.8, 1.6, 2.4].iter().any(|&d| (0..12).map(|q| q as f64 * PI / 6.0).any(|a| K.eauK(nx + a.cos() * d / km, ny + a.sin() * d / km) > 0.5));
    for _ in 0..4 {
        // (la place se rapproche du centre quand la carte rétrécit)
        let (px, py_) = (WF / 2.0 + (nx - cx) * 1000.0 * k * km, HF / 2.0 + (ny - cy) * 1000.0 * k * km);
        let lim = if pl.get("battle").truthy() {
            let room = [("O", px), ("E", WF - px), ("N", py_), ("S", HF - py_)];
            py::min_f(room.iter().map(|&(e, v)| v - (if e == e0 || mouille { DEPLOI } else { 20.0 }))).unwrap()
        } else {
            600.0
        };
        k = pmax(0.12, pmin(1.0, lim / r));
    }
    Lieu::new(V, O, k, km, &n, cx, cy, K)
}

/// Les routes de la place jusqu'au bord de la scène, en mètres, pour chaque arête de la place : le tracé même de
/// l'arête, que le plan organique suit (ses axes, ses rues maîtresses). {indice de l'arête : points}.
pub fn routes(L: &Lieu, geo: &GeoMap, nid: &Val) -> HashMap<usize, Vec<Pt>> {
    let mut out = HashMap::new();
    for (ei, ed) in geo.edges.iter().enumerate() {
        if (ed.at("a") != *nid && ed.at("b") != *nid) || ed.get("kind") == "water" || ed.get("ferry").truthy() {
            continue;
        }
        let mut p = pts_de(&ed.at("pts"));
        if ed.at("a") != *nid {
            p.reverse();
        }
        out.insert(ei, _densify(&p.into_iter().map(|q| L.tf(L.u(q))).collect::<Vec<Pt>>(), 40.0));
    }
    out
}

/// Le tracé densifié pts écarté du point C jusqu'à Rp au moins : décalé en travers là où il passe au plus près,
/// de moins en moins loin le long du tracé (sur 2 Rp + 800 m).
pub fn ecarter(pts: &[Pt], C: Pt, Rp: f64) -> Vec<Pt> {
    if pts.len() < 2 {
        return pts.to_vec();
    }
    let k0 = py::min_by_key(0..pts.len(), |&k| py::pow(pts[k].0 - C.0, 2.0) + py::pow(pts[k].1 - C.1, 2.0)).unwrap();
    let (x0, y0) = pts[k0];
    let d0 = py::hypot(x0 - C.0, y0 - C.1);
    if d0 >= Rp {
        return pts.to_vec();
    }
    let (nx, ny) = if d0 > 1.0 {
        ((x0 - C.0) / d0, (y0 - C.1) / d0)
    } else {
        // (droit sur le centre : de côté)
        let ((ax, ay), (bx, by)) = (pts[k0.saturating_sub(1)], pts[(k0 + 1).min(pts.len() - 1)]);
        let ll = py::hypot(bx - ax, by - ay);
        let ll = if ll == 0.0 { 1.0 } else { ll };
        (-(by - ay) / ll, (bx - ax) / ll)
    };
    let (dec, fade) = (Rp - d0, 2.0 * Rp + 800.0);
    let mut s = vec![0.0; pts.len()];
    for k in k0 + 1..pts.len() {
        s[k] = s[k - 1] + py::hypot(pts[k].0 - pts[k - 1].0, pts[k].1 - pts[k - 1].1);
    }
    for k in (0..k0).rev() {
        s[k] = s[k + 1] + py::hypot(pts[k].0 - pts[k + 1].0, pts[k].1 - pts[k + 1].1);
    }
    let mut out = vec![];
    for (&(x, y), &sk) in pts.iter().zip(&s) {
        let u = pmax(0.0, 1.0 - sk / fade);
        let wgt = u * u * (3.0 - 2.0 * u);
        out.push((x + nx * dec * wgt, y + ny * dec * wgt));
    }
    out
}

/// Cases dont le centre est dans le polygone (balayage des rangées de sa boîte).
pub fn _dans(poly: &[Pt]) -> Vec<usize> {
    let vide = "ValueError: min() arg is an empty sequence";
    let (y0, y1) = (py::min_f(poly.iter().map(|p| p.1)).expect(vide), py::max_f(poly.iter().map(|p| p.1)).expect(vide));
    let (j0, j1) = (py::int(py::floordiv_f(y0, CELLF)).max(0), py::int(py::floordiv_f(y1, CELLF)).min(ROWS - 1));
    let n = poly.len();
    let mut out = vec![];
    for j in j0..=j1 {
        let y = (j as f64 + 0.5) * CELLF;
        let mut xs = vec![];
        for k in 0..n {
            let ((x1, y1), (x2, y2)) = (poly[k], poly[(k + 1) % n]);
            if (y1 <= y) != (y2 <= y) {
                xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).expect("TypeError: sort"));
        for ab in xs.chunks_exact(2) {
            let (a, b) = (ab[0], ab[1]);
            for i in py::int((a / CELLF - 0.5).ceil()).max(0)..=py::int((b / CELLF - 0.5).floor()).min(COLS - 1) {
                out.push((j * COLS + i) as usize);
            }
        }
    }
    out
}

/// Côtés d'un polygone : (a, longueur, u, n vers l'intérieur), comme remplirIlot.
pub fn _cotes(poly: &[Pt], c: Pt) -> Vec<(Pt, f64, Pt, Pt)> {
    let mut out = vec![];
    for k in 0..poly.len() {
        let (a, e) = (poly[k], poly[(k + 1) % poly.len()]);
        let l = PV::hypot(e.0 - a.0, e.1 - a.1);
        let l = if l == 0.0 { 1e-9 } else { l };
        let u = ((e.0 - a.0) / l, (e.1 - a.1) / l);
        let mut nn = (-u.1, u.0);
        if (c.0 - a.0) * nn.0 + (c.1 - a.1) * nn.1 < 0.0 {
            nn = (-nn.0, -nn.1);
        }
        out.push((a, l, u, nn));
    }
    out
}

/// Le repère d'un îlot : angle de son plus long côté, étendues le long de ce côté et en travers, centre de la boîte.
pub fn _repere(poly: &[Pt]) -> (f64, f64, f64, Pt) {
    let n = poly.len();
    let (a, e) = py::max_by_key((0..n).map(|k| (poly[k], poly[(k + 1) % n])), |s| PV::hypot(s.1 .0 - s.0 .0, s.1 .1 - s.0 .1))
        .expect("ValueError: max() arg is an empty sequence");
    let ang = (e.1 - a.1).atan2(e.0 - a.0);
    let (ux, uy) = (ang.cos(), ang.sin());
    let pu: Vec<f64> = poly.iter().map(|p| p.0 * ux + p.1 * uy).collect();
    let pn: Vec<f64> = poly.iter().map(|p| -p.0 * uy + p.1 * ux).collect();
    let mn_mx = |v: &[f64]| (py::min_f(v.iter().copied()).unwrap(), py::max_f(v.iter().copied()).unwrap());
    let ((pu0, pu1), (pn0, pn1)) = (mn_mx(&pu), mn_mx(&pn));
    let (mu, mn) = ((pu0 + pu1) / 2.0, (pn0 + pn1) / 2.0);
    (ang, pu1 - pu0, pn1 - pn0, (ux * mu - uy * mn, uy * mu + ux * mn))
}

/// Les édifices des îlots organiques, d'après le modèle de la place (comme genererInterieur les posait) : la place,
/// les églises et le jardin du plan de la carte, puis cathédrale, couvents, hôpital, hôtels et casernes.
pub fn _roles(ilots: &mut [Ilot], V: &Val) {
    let Pf = V.at("Pf");
    let (m, Rv) = (Pf.ats("modele"), Pf.atf("R"));
    let d = |b: &Ilot| PV::hypot(b.c.0 - IC.0, b.c.1 - IC.1);
    for b in ilots.iter_mut() {
        b.role = match b.typ.as_str() {
            "place" => Some("place"),
            "eglise" => Some("eglise"),
            "jardin" => Some("jardin"),
            _ => b.role,
        };
    }
    let villes: Vec<usize> = (0..ilots.len()).filter(|&i| ilots[i].zone == "ville" && matches!(ilots[i].typ.as_str(), "vieux" | "immeubles" | "ouvrier")).collect();
    let libres = |ilots: &[Ilot], d0: f64, d1: f64| -> Vec<usize> {
        villes.iter().copied().filter(|&i| ilots[i].role.is_none() && Rv * d0 < d(&ilots[i]) && d(&ilots[i]) < Rv * d1).collect()
    };
    let sans_role = |ilots: &[Ilot]| -> Vec<usize> { villes.iter().copied().filter(|&i| ilots[i].role.is_none()).collect() };
    let role = |ilots: &mut [Ilot], b: Option<usize>, r: &'static str| {
        if let Some(b) = b {
            ilots[b].role = Some(r);
        }
    };
    let eglises = py::sorted_by_key((0..ilots.len()).filter(|&i| ilots[i].role == Some("eglise")).collect(), |&i| d(&ilots[i]));
    if m == "grande" {
        if let Some(&e) = eglises.first() {
            ilots[e].role = Some("cathedrale");
        }
        for &b in eglises.iter().skip(2).step_by(2) {
            ilots[b].role = Some("egliseDome");
        }
        let l = libres(ilots, 0.4, 0.95);
        role(ilots, l.get(2).copied(), "couvent");
        let l = libres(ilots, 0.5, 1.0);
        role(ilots, l.get(5).copied(), "couvent");
        if Pf.at("rivs").truthy() {
            let rp = pts_de(&Pf.at("rivs").at(0).at("pts"));
            let l = py::sorted_by_key(sans_role(ilots), |&i| {
                let c = ilots[i].c;
                py::min_f(rp.windows(2).map(|w| _seg_dist(c.0, c.1, w[0].0, w[0].1, w[1].0, w[1].1))).expect("ValueError: min() arg is an empty sequence")
            });
            let r = if Pf.at("port").truthy() && Pf.at("n").at("type") == "capitale" { "royale" } else { "hopital" };
            role(ilots, l.first().copied(), r);
        }
        let hotels: Vec<usize> = libres(ilots, 0.2, 0.55).into_iter().enumerate().filter(|(k, _)| k % 5 == 2).map(|p| p.1).take(4).collect();
        for b in hotels {
            ilots[b].role = Some("hotel");
        }
        for b in py::sorted_by_key(sans_role(ilots), |&i| -d(&ilots[i])).into_iter().take(2) {
            ilots[b].role = Some("caserne");
        }
    } else if m == "ville" || m == "port" {
        let cands: Vec<usize> = villes.iter().copied().filter(|&i| ilots[i].role.is_none() && d(&ilots[i]) > Rv * 0.5).collect();
        let l = py::sorted_by_key(cands, |&i| {
            let r = _repere(&ilots[i].ins);
            -r.1 * r.2
        });
        role(ilots, l.first().copied(), "couvent");
    } else if m == "place" {
        for b in py::sorted_by_key(sans_role(ilots), |&i| -d(&ilots[i])).into_iter().take(3) {
            ilots[b].role = Some("caserne");
        }
    }
    if eglises.is_empty() && !ilots.is_empty() && m != "fortin" {
        // (un bourg sans église au plan de la carte : l'îlot du centre)
        let b = py::min_by_key((0..ilots.len()).filter(|&i| ilots[i].role.is_none()), |&i| d(&ilots[i]));
        role(ilots, b, "eglise");
    }
}

/// Un édifice : (îlot ou None, rôle du moteur, modèle, x, y, angle, échelle).
pub type Edifice = (Option<usize>, &'static str, &'static str, f64, f64, f64, f64);

/// Les édifices de la place : sur leur îlot (à sa mesure, le long de son plus long côté), et ceux du plan
/// (château, fortin, citadelle, gare) : [îlot ou None, rôle du moteur, modèle, x, y, angle, échelle (unités du plan
/// par unité du modèle)].
pub fn _edifices(L: &Lieu) -> Vec<Edifice> {
    let (V, Pf) = (&L.V, L.V.at("Pf"));
    let mut out: Vec<Edifice> = vec![];
    let vtype = V.at("type");
    for (i, b) in L.ilots.iter().enumerate() {
        let Some(sp) = b.role else { continue };
        if matches!(sp, "parvis" | "jardin" | "royale") {
            continue;
        }
        let (kind, cle, fit) = if sp == "place" {
            if vtype == "grande" {
                ("hotel", "hotelDeVille", 0.5)
            } else {
                ("halle", "halle", 0.6)
            }
        } else if matches!(sp, "cathedrale" | "eglise" | "egliseDome") {
            (
                if sp == "cathedrale" { "cathedrale" } else { "eglise" },
                if sp == "eglise" && vtype == "bourg" {
                    "egliseRomane"
                } else if sp == "egliseDome" {
                    "egliseDome"
                } else {
                    "cathedrale"
                },
                0.9,
            )
        } else {
            (sp, sp, 0.9)
        };
        let (mut ang, lu, ln, c) = _repere(&b.ins);
        let (u0, v0, u1, v1) = boite(cle);
        if sp == "hotel" {
            ang += PI;
        }
        out.push((Some(i), kind, cle, c.0, c.1, ang, pmin(lu / (u1 - u0), ln / (v1 - v0)) * fit));
    }
    let m = Pf.ats("modele");
    if m == "castrum" {
        out.push((None, "hotel", "chateau", IC.0, IC.1 - 8.0, 0.2, 38.0 / 88.0));
    }
    if m == "fortin" {
        out.extend([
            (None, "caserne", "caserne", IC.0, IC.1, 0.0, 0.5),
            (None, "poudriere", "poudriere", IC.0 + 40.0, IC.1 - 30.0, 0.6, 0.7),
            (None, "eglise", "egliseRomane", IC.0 - 36.0, IC.1 + 36.0, 0.0, 0.45),
        ]);
    }
    let ct = V.at("citadelle");
    if ct.truthy() {
        let C2 = ct.at("C").xy();
        out.push((None, "caserne", "caserne", C2.0, C2.1, 0.0, 0.45));
    }
    let g = V.at("gare");
    if g.truthy() {
        out.push((None, "halle", "gare", g.atf("x"), g.atf("y"), g.atf("a"), 0.55));
    }
    out
}

/// Le tracé de l'enceinte en mètres : (sommets, demi-lunes, bastionné ?, tours), celui des remparts de la carte.
pub fn _enceinte_poly(L: &Lieu) -> (Vec<Pt>, Vec<Vec<Pt>>, bool, Option<Val>) {
    let Some((ring, lunes, bast, tours)) = &L.enceinte else { return (vec![], vec![], false, None) };
    let tf = |p: &Pt| L.tf(*p);
    (
        ring.iter().map(tf).collect(),
        lunes.iter().map(|l| l.iter().map(tf).collect()).collect(),
        *bast,
        tours.as_ref().map(|t| pts_ronds(&t.iter().map(tf).collect::<Vec<Pt>>())),
    )
}

/// La place sur son plan : cases, enceinte, édifices, et ce que le client en dessine (m.plan).
/// (`ville(m, pl, L, rng, spec, t, road_cells)` du Python : t est m.t)
pub fn ville(m: &mut BattleMap, pl: &Val, L: &Lieu, rng: &mut Random, spec: &Val, road_cells: &BTreeSet<usize>) {
    let (V, Pf) = (&L.V, L.V.at("Pf"));
    let pos = L.pos;
    let (px, py_) = pos;
    let Mk = L.Mk;
    let tf = |p: Pt| L.tf(p);
    let typ = if VILLES().has(&pl.at("type")) { pl.at("type") } else { Val::str("village") };
    let _seed = py::int_v(&spec.at("seed")) & 0x7FFFFFFF;
    let year = spec.get_or("year", 1790).i();
    let _fort = if pl.get("battle").truthy() { pl.get_or("fort", 0) } else { Val::from(0) }; // (le jeu : brèches, portes fermées à l'assaillant)
    let f_plan = Pf.ati("f");
    let att_a = spec.get_or("att_angle", 0.0).f();
    let urbain = !matches!(Pf.at("modele").s(), "rue" | "airial" | "montagne");
    let rue_t = (if urbain { T_ROUTE } else { T_CHEMIN }) as u8;
    let dist = |c: usize| {
        let (x, y) = center_of(c);
        py::hypot(x - px, y - py_)
    };
    let est = |t: &[u8], c: usize, types: &[i64]| dans(t[c], types);

    // la grille de campagne, grossière sur les côtes et l'estuaire, peut poser la place dans l'eau, coupée de la terre
    // ferme : elle est bâtie au sec, remparts et glacis compris, et une chaussée et son pont l'y relient (comme _town)
    let mut road_cells: BTreeSet<usize> = road_cells.clone();
    let dry = L.r_mur + 60.0;
    let rc = py::int(py::floordiv_f(dry, CELLF)) + 1;
    let (ci, cj) = (py::int(py::floordiv_f(px, CELLF)), py::int(py::floordiv_f(py_, CELLF)));
    let (ja, jb, ia, ib) = ((cj - rc).max(0), (cj + rc + 1).min(ROWS), (ci - rc).max(0), (ci + rc + 1).min(COLS));
    let mouille = (ja..jb).any(|j| (ia..ib).any(|i| m.t[(j * COLS + i) as usize] as i64 == T_EAU));
    if mouille {
        // (sans eau autour, la place est sur la terre ferme)
        let land = _mainland(&m.t);
        let c0 = cell_of(px, py_);
        if c0 < 0 || !land.contains(&(c0 as usize)) {
            for j in ja..jb {
                for i in ia..ib {
                    let c = (j * COLS + i) as usize;
                    if m.t[c] as i64 == T_EAU && dist(c) < dry {
                        m.t[c] = T_PRE as u8;
                    }
                }
            }
            let chaussee: BTreeSet<usize> = _causeway(m, px, py_, att_a, &land).into_iter().filter(|&c| m.t[c] as i64 != T_EAU).collect();
            for &c in &chaussee {
                m.t[c] = T_ROUTE as u8;
            }
            road_cells.extend(chaussee);
        }
    }

    // en ville et aux portes, les routes d'un seul tenant par les côtés (pas de maison en travers, pas de pont qu'on ne
    // passe qu'en diagonale)
    let loin = L.r_ville + 150.0;
    for r in m.roads.iter() {
        let sol = (if r.at("kind") != "chemin" { T_ROUTE } else { T_CHEMIN }) as u8;
        for c in _line4(&pts_de(&r.at("pts"))) {
            if dist(c) < loin {
                if !est(&m.t, c, &RUE) {
                    m.t[c] = sol;
                }
                road_cells.insert(c);
            }
        }
    }

    // ------------------------------------------------ l'enceinte (cases des murs : rues et maisons s'y arrêtent)
    let (poly, ravs, bast, tours) = _enceinte_poly(L);
    let ct = V.at("citadelle");
    let cpoly: Vec<Pt> = if ct.truthy() { pts_de(&ct.at("poly")).into_iter().map(tf).collect() } else { vec![] };
    let cinside: Box<dyn Fn(usize) -> bool> = if !cpoly.is_empty() { Box::new(_dedans(&cpoly)) } else { Box::new(|_| false) };
    let mut wall: BTreeSet<usize> = BTreeSet::new();
    let mut inside: Option<Box<dyn Fn(usize) -> bool>> = None;
    if !poly.is_empty() {
        let dedans_p = _dedans(&poly);
        let mut ferme = poly.clone();
        ferme.push(poly[0]);
        let outer = _line4(&ferme);
        wall = outer.iter().copied().collect();
        if f_plan >= 2 {
            // (rempart épais : une seconde rangée de cases en dedans)
            for &c in &outer {
                for nc in voisins(c as i64) {
                    if 0 <= nc && nc < N && !wall.contains(&(nc as usize)) && dedans_p(nc as usize) {
                        wall.insert(nc as usize);
                    }
                }
            }
        }
        for rv in &ravs {
            wall.extend(_line4(rv).into_iter().filter(|&c| !dedans_p(c)));
        }
        wall = wall.into_iter().filter(|&c| c < NU && m.t[c] as i64 != T_EAU && !cinside(c)).collect();
        inside = Some(Box::new(dedans_p));
    }
    let mut cwall: BTreeSet<usize> = BTreeSet::new();
    if !cpoly.is_empty() {
        let mut ferme = cpoly.clone();
        ferme.push(cpoly[0]);
        cwall = _line4(&ferme).into_iter().collect();
        for c in cwall.clone() {
            for nc in voisins(c as i64) {
                if 0 <= nc && nc < N && !cwall.contains(&(nc as usize)) && cinside(nc as usize) {
                    cwall.insert(nc as usize);
                }
            }
        }
        for rv in ct.at("ravs").iter() {
            let tri = [tf(rv.at("b1").xy()), tf(rv.at("apex").xy()), tf(rv.at("b2").xy())];
            cwall.extend(_line4(&tri).into_iter().filter(|&c| !cinside(c)));
        }
        cwall = cwall.into_iter().filter(|&c| c < NU && m.t[c] as i64 != T_EAU).collect();
    }
    let murs: BTreeSet<usize> = wall.union(&cwall).copied().collect();
    let dedans = |c: usize| inside.as_ref().is_some_and(|f| f(c)) || cinside(c);

    // ------------------------------------------------ îlots en mètres ; le sol de la ville (bois, landes… rasés)
    let blocs: Vec<(Vec<Pt>, Vec<Pt>)> = L.ilots.iter().map(|b| (b.q.iter().map(|&p| tf(p)).collect(), b.ins.iter().map(|&p| tf(p)).collect())).collect();
    let mut sol: BTreeSet<usize> = BTreeSet::new();
    for (k, (q, _)) in blocs.iter().enumerate() {
        if L.ilots[k].zone == "ville" && urbain {
            sol.extend(_dans(q));
        }
    }
    if inside.is_some() {
        let rc = py::int(py::floordiv_f(rayon_enceinte(V) * Mk, CELLF)) + 2;
        for j in (cj - rc).max(0)..(cj + rc + 1).min(ROWS) {
            for i in (ci - rc).max(0)..(ci + rc + 1).min(COLS) {
                let c = (j * COLS + i) as usize;
                if dedans(c) {
                    sol.insert(c);
                }
            }
        }
    }
    for &c in &sol {
        if est(&m.t, c, &SOL) {
            m.t[c] = T_PRE as u8;
        }
    }

    // ------------------------------------------------ rues : entre les îlots, les routes du plan (ses axes), le boulevard
    let (mut streets, mut bandes): (BTreeSet<usize>, BTreeSet<usize>) = (BTreeSet::new(), BTreeSet::new()); // (bandes : entre les îlots ; un édifice peut y déborder, pas sur les axes)
    if urbain {
        for (k, (q, ins)) in blocs.iter().enumerate() {
            if L.ilots[k].zone == "ville" && !ins.is_empty() {
                let dans_ins: BTreeSet<usize> = _dans(ins).into_iter().collect();
                bandes.extend(_dans(q).into_iter().filter(|c| !dans_ins.contains(c)));
            }
        }
    }
    // (une rue du plan organique, de 4 à 12 m, est plus étroite qu'une case : une rangée de cases sur l'axe de chaque
    // rue entre deux îlots, le bord de leur sol q, commun aux deux, qui donne les mêmes cases des deux côtés ; seulement
    // les rues de 45 m et plus, et le plus long côté sur rue de chaque îlot : sur la grille de 20 m, toutes les ruelles
    // du plan paveraient la moitié de la ville)
    for (k, (q, ins)) in blocs.iter().enumerate() {
        let kd = &L.ilots[k].kinds;
        let mut rues_q: Vec<(f64, Pt, Pt)> = vec![];
        for x in 0..q.len() {
            let (p, r) = (q[x], q[(x + 1) % q.len()]);
            let (mx, my) = ((p.0 + r.0) / 2.0, (p.1 + r.1) / 2.0);
            let ni = ins.len();
            let seg = |j: usize| _seg_dist(mx, my, ins[j].0, ins[j].1, ins[(j + 1) % ni].0, ins[(j + 1) % ni].1);
            let j = py::min_by_key(0..ni, |&j| seg(j)).expect("ValueError: min() arg is an empty sequence");
            let d = seg(j);
            if kd[j] == "rue" && d > 0.5 * L.k {
                rues_q.push((py::hypot(r.0 - p.0, r.1 - p.1), p, r));
            }
        }
        let lmax = rues_q.iter().fold(f64::NEG_INFINITY, |a, e| pmax(a, e.0));
        for &(l, p, r) in &rues_q {
            if l >= 45.0 || l == lmax {
                // (45 m sur la grille de la bataille)
                bandes.extend(_poly_cells(&[p, r]));
            }
        }
    }
    let mut seaux: HashMap<(i64, i64), Vec<Pt>> = HashMap::new();
    for b in &L.ilots {
        seaux.entry((py::int(py::floordiv_f(b.c.0, 34.0)), py::int(py::floordiv_f(b.c.1, 34.0)))).or_default().push(b.c);
    }
    let pres_ilot = |x: f64, y: f64| -> bool {
        let (i0, j0) = (py::int(py::floordiv_f(x, 34.0)), py::int(py::floordiv_f(y, 34.0)));
        [-1, 0, 1].iter().any(|di| [-1, 0, 1].iter().any(|dj| seaux.get(&(i0 + di, j0 + dj)).is_some_and(|l| l.iter().any(|c| PV::hypot(c.0 - x, c.1 - y) < 34.0))))
    };
    let mut rues_cl: Vec<Val> = vec![];
    let axes = if L.O.truthy() { L.O.at("axes").vec() } else { vec![] };
    for rr in axes {
        let pts0: Vec<Pt> = pts_de(&rr.at("pts")).into_iter().map(|p| L.u(p)).collect();
        let mut pts: Vec<Pt> = vec![];
        for w in pts0.windows(2) {
            let d = _densify(&[w[0], w[1]], 10.0);
            pts.extend_from_slice(&d[..d.len() - 1]);
        }
        pts.extend(pts0.last()); // (10 unités : 55 m)
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let (mx, my) = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
            if !pres_ilot(mx, my) {
                continue;
            }
            if PV::eau(&L.K, V, mx, my) {
                // (la route y passe déjà sur son pont, daté : terrain.py)
                continue;
            }
            let (A, B_) = (tf(a), tf(b));
            let cm = cell_of((A.0 + B_.0) / 2.0, (A.1 + B_.1) / 2.0);
            if cm < 0 || est(&m.t, cm as usize, &[T_EAU, T_GUE]) {
                // (l'eau de la bataille, plus large que celle du plan par endroits)
                continue;
            }
            rues_cl.push(list![py::round_n(A.0, 1), py::round_n(A.1, 1), py::round_n(B_.0, 1), py::round_n(B_.1, 1), 1]);
            streets.extend(_line4(&[A, B_]));
        }
    }
    if let Some(cours) = L.cours.as_ref().filter(|c| !c.is_empty()) {
        // (les murs abattus : un boulevard planté)
        streets.extend(_line4(&cours.iter().map(|&p| tf(p)).collect::<Vec<Pt>>()));
    }
    bandes = bandes.difference(&streets).copied().collect();
    streets = streets.union(&bandes).copied().filter(|&c| c < NU && !murs.contains(&c) && !est(&m.t, c, &[T_EAU, T_GUE])).collect();
    for &c in &streets {
        if m.t[c] as i64 != T_ROUTE {
            m.t[c] = rue_t;
        }
    }

    // ------------------------------------------------ édifices sur l'emprise de leur modèle
    let murs_routes: BTreeSet<usize> = murs.union(&road_cells).copied().collect();
    let reserve: BTreeSet<usize> = murs_routes.iter().copied().chain(streets.difference(&bandes).copied()).collect();
    let mut eds: Vec<Val> = vec![];
    for (b, kind, cle, x, y, a, s) in _edifices(L) {
        let (X, Y) = tf((x, y));
        let sm = s * Mk; // (m par unité du modèle)
        let (u0, v0, u1, v1) = boite(cle);
        let (ca, sa) = (a.cos(), a.sin());
        let corners: Vec<Pt> = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)].iter().map(|&(u, v)| (X + (u * ca - v * sa) * sm, Y + (u * sa + v * ca) * sm)).collect();
        let cour = CELLF / sm; // (une case : l'épaisseur des bâtiments autour de la cour)
        let mut foot = vec![];
        for c in _dans(&corners) {
            if reserve.contains(&c) || est(&m.t, c, &[T_EAU, T_GUE]) || m.kinds.contains_key(&c) {
                continue;
            }
            let (cx, cy) = center_of(c);
            let (dx, dy) = (cx - X, cy - Y);
            let (u, v) = ((dx * ca + dy * sa) / sm, (-dx * sa + dy * ca) / sm);
            if COUR.contains(&kind) && u0 + cour < u && u < u1 - cour && v0 + cour < v && v < v1 - cour {
                m.t[c] = T_PRE as u8;
                continue;
            }
            m.t[c] = T_BATI as u8;
            m.kinds.insert(c, kind.to_string());
            foot.push(c);
        }
        if foot.is_empty() {
            // (trop petit pour une case : la case de son milieu, ou une voisine libre ; à défaut, une case de
            // rue, jamais une route, un mur ni l'eau : un îlot plus étroit qu'une rue de la bataille garde son édifice)
            let c0 = cell_of(X, Y);
            let mut autour: Vec<i64> = vec![];
            if c0 >= 0 {
                autour.push(c0);
                for dj in [-1, 0, 1] {
                    for di in [-1, 0, 1] {
                        autour.push(c0 + dj * COLS + di);
                    }
                }
            }
            for interdit in [&reserve, &murs_routes] {
                let libre = autour.iter().copied().find(|&c| {
                    0 <= c && c < N && !interdit.contains(&(c as usize)) && !est(&m.t, c as usize, &[T_EAU, T_GUE]) && !m.kinds.contains_key(&(c as usize))
                });
                if let Some(c) = libre {
                    m.t[c as usize] = T_BATI as u8;
                    m.kinds.insert(c as usize, kind.to_string());
                    foot.push(c as usize);
                    break;
                }
            }
        }
        // (b : le rang de l'îlot dans blocs, ce que le Python retrouve par id(b))
        eds.push(dict! {"cle" => cle, "kind" => kind, "x" => py::round_n(X, 1), "y" => py::round_n(Y, 1), "a" => py::round_n(a, 3), "s" => py::round_n(sm, 4), "b" => b});
    }

    // ------------------------------------------------ îlots : maisons sur rue, cours et jardins au milieu
    streets.retain(|&c| m.t[c] as i64 != T_BATI);
    let reserve: BTreeSet<usize> = murs_routes.union(&streets).copied().collect();
    let pres_mur = if !murs.is_empty() { bfs(&murs.iter().copied().collect::<Vec<usize>>(), 2, None) } else { vec![255u8; NU] }; // (pas de maison du faubourg contre le mur)
    let vtype = V.at("type");
    for (k, (_, ins)) in blocs.iter().enumerate() {
        let b = &L.ilots[k];
        if ins.is_empty() {
            continue;
        }
        let (sp, fau) = (b.role, b.zone == "faubourg");
        let cells: Vec<usize> = _dans(ins).into_iter().filter(|c| !reserve.contains(c) && !est(&m.t, *c, &[T_EAU, T_GUE]) && !m.kinds.contains_key(c)).collect();
        if matches!(sp, Some("place" | "parvis")) || (matches!(sp, Some("eglise" | "egliseDome" | "cathedrale")) && urbain && vtype != "bourg") {
            for &c in &cells {
                m.t[c] = T_ROUTE as u8; // (pavé : la place, le parvis)
            }
            continue;
        }
        let nf = ins.len() as f64;
        let ed = _cotes(ins, (py::sum(ins.iter().map(|p| p.0)) / nf, py::sum(ins.iter().map(|p| p.1)) / nf));
        let fronts: Vec<(Pt, f64, Pt, Pt)> = ed.into_iter().zip(&b.cotes).filter(|p| *p.1).map(|p| p.0).collect();
        if matches!(sp, Some("jardin" | "eglise" | "egliseDome" | "cathedrale")) || sp.is_some_and(|s| COUR.contains(&s)) || b.typ == "maraichers" || fronts.is_empty() {
            for &c in &cells {
                m.t[c] = T_PRE as u8; // (jardin public, cimetière du bourg, cours des couvents, casernes…, maraîchers)
            }
            continue;
        }
        let prof = pmax(CELLF, PROF);
        let royale = sp == Some("royale");
        for &c in &cells {
            let (x, y) = center_of(c);
            let d = py::min_f(fronts.iter().map(|&(a, l, u, _)| _seg_dist(x, y, a.0, a.1, a.0 + u.0 * l, a.1 + u.1 * l))).unwrap();
            if d <= prof && !(fau && pres_mur[c] <= 2 && !dedans(c)) {
                m.t[c] = T_BATI as u8;
                m.kinds.insert(c, (if royale { "hotel" } else { "maison" }).to_string());
            } else {
                m.t[c] = (if royale { T_ROUTE } else { T_PRE }) as u8;
            }
        }
        for &c in &cells {
            // (une maison donne sur la rue : sans rue à côté, c'est la cour)
            if m.t[c] as i64 == T_BATI && !voisins(c as i64).iter().any(|&nc| 0 <= nc && nc < N && est(&m.t, nc as usize, &RUE)) {
                m.t[c] = T_PRE as u8;
                m.kinds.remove(&c).expect("KeyError");
            }
        }
    }

    // ------------------------------------------------ quais
    let rq = V.atf("rMur") * Mk * 1.15;
    if Pf.at("port").truthy() {
        let liste: Vec<usize> = sol.iter().chain(streets.iter()).copied().collect();
        for c in liste {
            if (m.t[c] == T_PRE as u8 || m.t[c] == rue_t)
                && !murs.contains(&c)
                && dist(c) < rq
                && voisins(c as i64).iter().any(|&nc| 0 <= nc && nc < N && m.t[nc as usize] as i64 == T_EAU)
            {
                m.t[c] = T_ROUTE as u8;
                streets.insert(c);
            }
        }
    }
    // les quais du plan (peindreInterieur) : le long de la première rivière d'un port, des deux côtés, jusqu'à 1,15 R
    let (mut quais, mut bateaux, mut quai_c): (Vec<Val>, Vec<Val>, BTreeSet<usize>) = (vec![], vec![], BTreeSet::new());
    let sd = Pf.ati("sd");
    if Pf.at("port").truthy() && Pf.at("rivs").truthy() {
        let (nomr, rq2) = (Pf.at("rivs").at(0).at("name"), Pf.atf("R") * 1.15 * Mk);
        for rv in m.rivers.iter() {
            if rv.get("name") != nomr {
                continue;
            }
            let (rpts, w) = (pts_de(&rv.at("pts")), rv.atf("w"));
            for sg in [-1i64, 1] {
                let sgf = sg as f64;
                let pts: Vec<Pt> = _decaler(&rpts, sgf * (w / 2.0 + 5.0)).into_iter().filter(|p| py::hypot(p.0 - px, p.1 - py_) < rq2).collect();
                let (mut runs, mut cur): (Vec<Vec<Pt>>, Vec<Pt>) = (vec![], vec![]); // (le quai sur la rive seulement : pas où la mer ou l'estuaire la noient)
                for p in pts {
                    let c = cell_of(p.0, p.1);
                    if c >= 0 && !est(&m.t, c as usize, &[T_EAU, T_GUE]) {
                        cur.push(p);
                    } else {
                        if cur.len() > 1 {
                            runs.push(cur);
                        }
                        cur = vec![];
                    }
                }
                if cur.len() > 1 {
                    runs.push(cur);
                }
                for ligne in &runs {
                    quais.push(Val::list(ligne.iter().map(|&p| r1(p)).collect()));
                }
                for ligne in &runs {
                    for c in _line4(ligne) {
                        if !est(&m.t, c, &[T_EAU, T_GUE, T_BATI]) && !murs.contains(&c) {
                            m.t[c] = T_ROUTE as u8;
                            streets.insert(c);
                            quai_c.insert(c);
                        }
                    }
                }
                // des bateaux amarrés le long du quai (côté de l'eau)
                let bord = _decaler(&rpts, sgf * pmax(4.0, w / 2.0 - 7.0));
                for k in (1..bord.len().saturating_sub(1)).step_by(2) {
                    let (x, y) = bord[k];
                    // (BOGUE DU PYTHON, porté tel quel : hors du champ, cell_of rend -1 et t[-1] lit la dernière case)
                    let c = cell_of(x, y);
                    let c = if c < 0 { NU - 1 } else { c as usize };
                    if py::hypot(x - px, y - py_) < rq2 && PV::hash2(k as i64, sg, sd) < 0.45 && m.t[c] as i64 == T_EAU {
                        let a = (bord[k + 1].1 - bord[k - 1].1).atan2(bord[k + 1].0 - bord[k - 1].0);
                        let gros = if rv.ati("rank") <= 1 && PV::hash2(k as i64, 3, sd) < 0.5 { 1 } else { 0 };
                        bateaux.push(list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(a, 2), gros]);
                    }
                }
            }
        }
    }
    if Pf.at("port").truthy() && Pf.at("mer").truthy() {
        // (au mouillage, au large : comme la vue de l'intérieur)
        for i in 0..6 {
            let a = Pf.at("mer").atf("a") + (PV::hash2(i, 1, sd) - 0.5) * 0.8;
            let d = Pf.atf("R") * (1.1 + PV::hash2(i, 2, sd) * 0.8);
            let (x, y) = tf((IC.0 + a.cos() * d, IC.1 + a.sin() * d));
            let c = cell_of(x, y);
            if c >= 0 && m.t[c as usize] as i64 == T_EAU {
                bateaux.push(list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(PV::hash2(i, 3, sd) * 6.28, 2), if PV::hash2(i, 4, sd) < 0.4 { 1 } else { 0 }]);
            }
        }
    }

    // ------------------------------------------------ dans les murs : terre-plein, rue du rempart
    let mut ring: BTreeSet<usize> = BTreeSet::new();
    if let Some(ins_f) = &inside {
        for &c in &sol {
            if !est(&m.t, c, &RUE) && !est(&m.t, c, &[T_EAU, T_GUE, T_BATI]) && !murs.contains(&c) {
                m.t[c] = T_PRE as u8;
            }
        }
        for &c in &wall {
            for nc in voisins(c as i64) {
                if 0 <= nc && nc < N {
                    let nc = nc as usize;
                    if !murs.contains(&nc) && ins_f(nc) && m.t[nc] as i64 == T_PRE && !m.kinds.contains_key(&nc) {
                        ring.insert(nc);
                        m.t[nc] = T_ROUTE as u8;
                        streets.insert(nc);
                    }
                }
            }
        }
    }
    let _ = ring;
    // le centre tient aux routes (un fort sans route du plan : un chemin jusqu'à la route la plus proche)
    let colonne = |c: i64| py::mod_i(c, COLS);
    let c0 = cell_of(px, py_);
    let (mut vus, mut todo, mut relie) = (HashSet::from([c0]), vec![c0], false);
    while !todo.is_empty() && !relie {
        let c = todo.pop().unwrap();
        for nc in voisins(c) {
            if 0 <= nc && nc < N && !vus.contains(&nc) && (colonne(nc) - colonne(c)).abs() <= 1 && (est(&m.t, nc as usize, &RUE) || road_cells.contains(&(nc as usize))) {
                let ncu = nc as usize;
                relie = relie || (road_cells.contains(&ncu) && !murs.contains(&ncu) && !dedans(ncu)); // (une route qui sort de la place)
                vus.insert(nc);
                todo.push(nc);
            }
        }
    }
    if !relie && !road_cells.is_empty() {
        // (le Python parcourt le set road_cells : à égalité exacte de distance, la première case de SON ordre gagne ; ici la plus petite)
        let but = py::min_by_key(road_cells.iter().copied().filter(|c| !murs.contains(c) && !dedans(*c)), |&c| dist(c));
        if let Some(but) = but {
            let pts = [(px, py_), center_of(but)];
            for c in _line4(&pts) {
                // (à travers le rempart : _enceinte y ouvre une porte)
                if est(&m.t, c, &[T_EAU, T_GUE]) {
                    continue;
                }
                m.t[c] = T_ROUTE as u8;
                m.kinds.remove(&c);
                streets.insert(c);
            }
            m.roads.push(dict! {"pts" => pts_val(&pts), "kind" => "chemin"});
        }
    }
    // (une rue sans issue, coupée du réseau par un édifice ou au fond d'un bastion, redevient jardin)
    let mut net: HashSet<i64> = road_cells.iter().map(|&c| c as i64).collect();
    net.insert(cell_of(px, py_));
    let mut todo: Vec<i64> = net.iter().copied().collect();
    while let Some(c) = todo.pop() {
        for nc in voisins(c) {
            if 0 <= nc && nc < N && !net.contains(&nc) && (colonne(nc) - colonne(c)).abs() <= 1 && est(&m.t, nc as usize, &RUE) {
                net.insert(nc);
                todo.push(nc);
            }
        }
    }
    for &c in &streets {
        if !net.contains(&(c as i64)) && m.t[c] as i64 == T_ROUTE && !road_cells.contains(&c) && !quai_c.contains(&c) {
            m.t[c] = T_PRE as u8;
            for nc in voisins(c as i64) {
                // (la maison qui ne donnait que sur elle : une cour)
                if 0 <= nc && nc < N {
                    let nc = nc as usize;
                    if m.t[nc] as i64 == T_BATI
                        && m.kinds.get(&nc).is_some_and(|k| k == "maison")
                        && !voisins(nc as i64).iter().any(|&v| 0 <= v && v < N && est(&m.t, v as usize, &RUE))
                    {
                        m.t[nc] = T_PRE as u8;
                        m.kinds.remove(&nc);
                    }
                }
            }
        }
    }

    let rues_tout: BTreeSet<usize> = road_cells.union(&streets).copied().collect();
    let (metiers, vignes, salines) = _metiers(m, pl, L, &murs, &rues_tout, att_a);

    // ------------------------------------------------ l'enceinte sur la carte : murs, portes, glacis, brèches
    let allst = rues_tout;
    let R = V.atf("rMur") * Mk;
    if !wall.is_empty() {
        _enceinte(m, pl, pos, R, f_plan, bast, &poly, &ravs, &wall, inside.as_ref().unwrap().as_ref(), &allst, rng, att_a, if bast { None } else { Some("mur") }, tours, true);
    }
    if !cwall.is_empty() {
        let cravs: Vec<Vec<Pt>> = ct.at("ravs").iter().map(|rv| vec![tf(rv.at("b1").xy()), tf(rv.at("apex").xy()), tf(rv.at("b2").xy())]).collect();
        _enceinte(m, pl, tf(ct.at("C").xy()), R, f_plan.max(2), true, &cpoly, &cravs, &cwall, cinside.as_ref(), &allst, rng, att_a, None, None, wall.is_empty());
    }
    // (les cases de ville en dehors des îlots et des rues : pré)
    let r_mur = rayon_enceinte(V) * Mk;
    let muree = !wall.is_empty() || !cwall.is_empty();
    m.town_r = pmax(if muree { r_mur } else { R }, 60.0); // (fermes et vergers se tiennent au-delà, glacis compris)
    m.place = dict! {"name" => pl.at("name"), "x" => py::round(px), "y" => py::round(py_), "type" => &typ, "r" => py::round(if muree { r_mur } else { R }),
    "fort" => pl.get_or("fort", 0), "battle" => pl.get("battle").truthy()};
    // le cœur (l'objectif) : l'église ou la cathédrale, sinon la place, le château, le centre
    let lieux = V.at("lieux");
    let tries = py::sorted_by_key(L.ilots.iter().collect::<Vec<&Ilot>>(), |b| PV::hypot(b.c.0 - IC.0, b.c.1 - IC.1));
    let coeur = ["cathedrale", "eglise", "place"].iter().find_map(|&r| tries.iter().find(|b| b.role == Some(r)).map(|b| b.c));
    let (lc, lct) = (lieux.get("chateau"), lieux.get("citadelle"));
    let (hx, hy) = tf(if lc.truthy() {
        lc.xy()
    } else if lct.truthy() {
        lct.xy()
    } else {
        coeur.unwrap_or(IC)
    });
    m.heart = tup![py::round(hx), py::round(hy)];
    m.town = dict! {"type" => &typ, "x" => py::round(px), "y" => py::round(py_), "r" => py::round(pmax(R, 60.0)), "siecle" => py::floordiv_i(year - 1, 100) + 1,
    "enceinte" => if muree { m.walls.at(-1).at("kind") } else { Val::None }};
    let bar = if pl.get("battle").truthy() { pl.get_or("bar", 0.0).f() } else { 0.0 };
    if bar > 0.05 {
        if !muree {
            _barricades(m, pos, R, bar, rng, att_a);
        } else {
            _redoubts(m, pos, r_mur, bar, rng, att_a);
        }
    }
    // ------------------------------------------------ pour le client : le plan en mètres (decor2d.js le dessine)
    let ilots_cl: Vec<Val> = blocs
        .iter()
        .zip(&L.ilots)
        .map(|((q, ins), b)| {
            list![
                Val::list(q.iter().map(|&p| r1(p)).collect()),
                b.role.unwrap_or(if b.typ == "maraichers" { "maraichers" } else { "" }),
                if b.zone == "faubourg" { 1 } else { 0 },
                if b.main { 1 } else { 0 },
                b.sd,
                b.cotes.iter().enumerate().filter(|p| *p.1).map(|(i, _)| 1i64 << i).sum::<i64>(),
                Val::list(ins.iter().map(|&p| r1(p)).collect())
            ]
        })
        .collect();
    let cours_cl = match &L.cours {
        Some(c) if !c.is_empty() => Val::list(c.iter().map(|&p| r1(tf(p))).collect()),
        _ => Val::None,
    };
    m.plan = dict! {
        "k" => py::round_n(Mk, 5), "c" => list![py::round_n(px, 1), py::round_n(py_, 1)], "style" => Pf.at("style"), "modele" => Pf.at("modele"), "type" => V.at("type"),
        "murs" => Pf.at("murs"), "echelle" => py::round_n(L.k, 4), "nid" => &L.nid, "f" => Pf.at("f"), "pop" => Pf.at("pop"), "d" => Pf.at("d"),   // (l'état du plan)
        "ilots" => ilots_cl,
        "rues" => rues_cl, "edifices" => eds, "place" => Val::None, "cours" => cours_cl,
        "metiers" => metiers, "vignes" => vignes, "salines" => salines, "quais" => quais, "bateaux" => bateaux,
    };
}

/// Le tracé décalé de d sur sa gauche (lib.js : decaler).
pub fn _decaler(pts: &[Pt], d: f64) -> Vec<Pt> {
    let n = pts.len();
    let mut out = vec![];
    for (i, p) in pts.iter().enumerate() {
        let (a, b) = (pts[i.saturating_sub(1)], pts[(i + 1).min(n - 1)]);
        let l = py::hypot(b.0 - a.0, b.1 - a.1);
        let l = if l == 0.0 { 1.0 } else { l };
        out.push((p.0 - (b.1 - a.1) / l * d, p.1 + (b.0 - a.0) / l * d));
    }
    out
}

/// Les métiers du plan (châteaux viticoles et leurs vignes, scieries, forges, salines, séchoirs, moulins, fermes,
/// airiaux) sur la carte, à leur place (à l'échelle) et à leur vraie taille : bâtiments en BATI, vignes en VIGNE,
/// salines en MARAIS. Rien sur le glacis (140 m), à moins de 80 m d'une porte, dans la bande de l'assaillant, sur
/// une route, l'eau ou une maison. Renvoie ce que le client dessine.
/// (`_metiers(m, pl, L, t, kinds, murs, rues, att_a)` du Python : t et kinds sont m.t et m.kinds)
pub fn _metiers(m: &mut BattleMap, pl: &Val, L: &Lieu, murs: &BTreeSet<usize>, rues: &BTreeSet<usize>, att_a: f64) -> (Vec<Val>, Vec<Val>, Vec<Val>) {
    let (V, Pf) = (&L.V, L.V.at("Pf"));
    let (Mk, tf) = (L.Mk, |p: Pt| L.tf(p));
    let (px, py_) = L.pos;
    let pres = if !murs.is_empty() { bfs(&murs.iter().copied().collect::<Vec<usize>>(), 7, None) } else { vec![255u8; NU] };
    // (le Python parcourt le set murs : bfs rend les mêmes distances dans tout ordre des sources)
    let portes: Vec<usize> = murs.iter().copied().filter(|c| rues.contains(c)).collect();
    let pres_p = if !portes.is_empty() { bfs(&portes, 4, None) } else { vec![255u8; NU] };
    let mut bandes: Vec<(f64, f64, f64, f64)> = vec![];
    if pl.get("battle").truthy() {
        // (la bande de déploiement de l'assaillant, comme battle._zones ; de tous les bords près de l'eau)
        let r = rayon_enceinte(V) * Mk;
        let room = |e: &str| match e {
            "O" => px,
            "E" => WF - px,
            "N" => py_,
            _ => HF - py_,
        };
        // (le bord de l'assaillant comme battle._zones le choisira : le plus sec si le sien est noyé)
        let band = |e: &str, dep: f64| match e {
            "O" => (0.0, 100.0, dep, HF - 100.0),
            "E" => (WF - dep, 100.0, WF, HF - 100.0),
            "N" => (150.0, 0.0, WF - 150.0, dep),
            _ => (150.0, HF - dep, WF - 150.0, HF),
        };
        let t = &m.t;
        let sec = |bx: (f64, f64, f64, f64)| -> f64 {
            let (mut n, mut secs) = (0i64, 0i64);
            for j in py::int(py::floordiv_f(bx.1, CELLF))..py::int(py::floordiv_f(bx.3, CELLF)).min(ROWS) {
                for i in py::int(py::floordiv_f(bx.0, CELLF))..py::int(py::floordiv_f(bx.2, CELLF)).min(COLS) {
                    n += 1;
                    secs += (t[(j * COLS + i) as usize] as i64 != T_EAU) as i64;
                }
            }
            secs as f64 / n.max(1) as f64
        };
        let mut e0 = bord_assaillant(att_a);
        if sec(band(e0, 600.0)) < 0.4 {
            let e_av = e0;
            e0 = py::max_by_key(["O", "N", "E", "S"], |&e| (sec(band(e, 600.0)), e == e_av)).unwrap();
        }
        for e in [e0] {
            let d = room(e) - r;
            // (au plus les 250 premiers mètres : là où il entre et se range ; plus loin, les fermes de la campagne
            // y sont aussi, comme sur toute carte)
            let dep = pmin(250.0, pmax(pmax(200.0, pmin(500.0, d - 150.0)), d - 450.0));
            bandes.push(band(e, dep));
        }
    }
    let ok_c = |t: &[u8], c: i64| -> bool {
        0 <= c && c < N && !dans(t[c as usize], &[T_EAU, T_GUE, T_BATI, T_MUR, T_PORTE]) && !rues.contains(&(c as usize)) && !murs.contains(&(c as usize)) && pres[c as usize] > 7 && pres_p[c as usize] > 4
    };
    let r_in = if !murs.is_empty() { L.r_mur * 1.05 + 20.0 } else { 0.0 }; // (rien entre les bastions : hors de l'enceinte, au-delà de ses pointes)
    let dans_bande = |x: f64, y: f64| py::hypot(x - px, y - py_) < r_in || bandes.iter().any(|b| b.0 <= x && x <= b.2 && b.1 <= y && y <= b.3);
    let eaux: Vec<Val> = m.rivers.iter().filter(|r| r.at("kind") != "ruisseau").collect();
    let pres_eau = |r: &Val, X: f64, Y: f64| -> f64 {
        let p = pts_de(&r.at("pts"));
        py::min_f(p.windows(2).map(|w| _seg_dist(X, Y, w[0].0, w[0].1, w[1].0, w[1].1))).expect("ValueError: min() arg is an empty sequence")
    };
    let carre = |q: &[Pt]| Val::list(q.iter().map(|&p| r1(p)).collect());
    let (mut out, mut vignes, mut salines) = (vec![], vec![], vec![]);
    for p in V.at("plus").iter() {
        if !p.has("x") {
            continue;
        }
        let (ppx, ppy) = (p.atf("x"), p.atf("y"));
        let (X, Y) = tf((ppx, ppy));
        if !(40.0 < X && X < WF - 40.0 && 40.0 < Y && Y < HF - 40.0) || dans_bande(X, Y) {
            continue;
        }
        let mut k = p.ats("k");
        if k == "salines" {
            // (douze bassins, comme l'intérieur, à l'échelle du plan)
            let mut bas = vec![];
            for i in 0..12 {
                let (x0, y0) = (ppx - 40.0 + ((i % 4) * 20) as f64, ppy - 24.0 + ((i / 4) * 16) as f64);
                let q = [tf((x0, y0)), tf((x0 + 17.0, y0)), tf((x0 + 17.0, y0 + 13.0)), tf((x0, y0 + 13.0))];
                let dq = _dans(&q);
                let cs: Vec<usize> = dq.iter().copied().filter(|&c| ok_c(&m.t, c as i64)).collect();
                if cs.is_empty() && !dq.is_empty() {
                    continue;
                }
                for c in cs {
                    m.t[c] = T_MARAIS_T as u8;
                    m.garder.insert(c, T_MARAIS_T as u8);
                }
                bas.push(carre(&q));
            }
            if !bas.is_empty() {
                salines.push(Val::list(bas));
            }
            continue;
        }
        if k == "moulin" && eaux.iter().any(|r| pres_eau(r, X, Y) < r.atf("w") / 2.0 + 60.0) {
            k = "moulinEau".to_string(); // (au bord de l'eau, un moulin à roue)
        }
        if k == "ferme" && matches!(Pf.at("style").s(), "bearn" | "basque") {
            k = "mas".to_string();
        }
        let (cle, kind, (u0, v0, u1, v1), s) = cherche(&METIERS, k.as_str()).unwrap_or_else(|| panic!("KeyError: '{k}'"));
        let mut a = p.atf("a");
        if k == "moulinEau" {
            // (la roue tournée vers la rivière la plus proche)
            let r = py::min_by_key(eaux.iter(), |r| pres_eau(r, X, Y)).expect("ValueError: min() arg is an empty sequence");
            let q = py::min_by_key(pts_de(&r.at("pts")), |q| py::pow(q.0 - X, 2.0) + py::pow(q.1 - Y, 2.0)).expect("ValueError: min() arg is an empty sequence");
            a = (q.1 - Y).atan2(q.0 - X) + PI / 2.0;
        }
        let (ca, sa) = (a.cos(), a.sin());
        let (X0, Y0) = (X, Y);
        let mut pose = None;
        for (dx, dy) in [(0, 0), (20, 0), (-20, 0), (0, 20), (0, -20), (30, 30), (-30, 30), (30, -30), (-30, -30), (50, 0), (-50, 0), (0, 50), (0, -50)] {
            // (une route ou une maison à sa place : un peu à côté)
            let (X, Y) = (X0 + dx as f64, Y0 + dy as f64);
            let coins: Vec<Pt> = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)].iter().map(|&(u, v)| (X + (u * ca - v * sa) * s, Y + (u * sa + v * ca) * s)).collect();
            let mut foot: BTreeSet<i64> = _dans(&coins).into_iter().map(|c| c as i64).collect();
            foot.insert(cell_of(X, Y)); // (la case de son milieu, au moins)
            if foot.iter().all(|&c| ok_c(&m.t, c)) && !dans_bande(X, Y) {
                pose = Some((X, Y, foot));
                break;
            }
        }
        let Some((X, Y, foot)) = pose else { continue };
        for c in foot {
            m.t[c as usize] = T_BATI as u8;
            m.kinds.insert(c as usize, kind.to_string());
        }
        out.push(dict! {"k" => &k, "cle" => cle, "kind" => kind, "x" => py::round_n(X, 1), "y" => py::round_n(Y, 1), "a" => py::round_n(a, 3), "s" => s});
        if k == "chateauVin" {
            // ses quatre vignes (peindreInterieur), à l'échelle du plan
            for i in 0..4 {
                let (x0, y0) = (ppx - 70.0 + ((i % 2) * 74) as f64, ppy + (if i < 2 { -70.0 } else { 34.0 }));
                let q = [tf((x0, y0)), tf((x0 + 66.0, y0)), tf((x0 + 66.0, y0 + 34.0)), tf((x0, y0 + 34.0))];
                for c in _dans(&q) {
                    if ok_c(&m.t, c as i64) && dans(m.t[c], &[T_PRE, T_CHAMP, T_LANDE_T, T_VERGER]) {
                        m.t[c] = T_VIGNE_T as u8;
                        m.garder.insert(c, T_VIGNE_T as u8);
                    }
                }
                vignes.push(carre(&q));
            }
        }
    }
    (out, vignes, salines)
}
