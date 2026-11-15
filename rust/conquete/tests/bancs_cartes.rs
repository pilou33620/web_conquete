//! Banc du générateur de cartes de bataille (tactics/terrain.rs, SPEC-CARTES.md) : porté de tests/test_cartes.py.
//!
//! POURQUOI CE BANC EXISTE. Les cartes doivent rester les mêmes pour une graine donnée (une bataille rechargée, la
//! maquette, les bancs d'équilibre en dépendent), ne plus être quadrillées, organiser le terroir (vergers près des
//! maisons, jamais sur le glacis d'une place forte) et se calculer vite, même sur un Raspberry Pi.

mod fabrique;

use conquete::dict;
use conquete::geo::GeoMap;
use conquete::py::{self, Val};
use conquete::tactics::terrain::{self as TR, BattleMap, COLS, N, ROWS, T_BATI, T_CHAMP, T_LANDE_T, T_PRE, T_VERGER, T_VIGNE_T};
use conquete::tactics::{terrain_v1 as V1, terrain_ville as TV};
use std::collections::HashSet;
use std::time::Instant;

// (le Sud-Ouest des anciennes parties ; toute la France : test_france.py)
fn villages(geo: &GeoMap) -> Vec<Val> {
    let v: Vec<Val> = geo.nodes.iter().filter(|n| ["village", "bourg", "ville"].contains(&n.ats("type").as_str())).collect();
    v.into_iter().step_by(9).take(10).collect()
}
const CROP: [i64; 5] = [T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T, T_VERGER];

fn carte(geo: &GeoMap, k: i64, n: &Val, place: &Val) -> BattleMap {
    let spec = dict! {"seed" => 500 + k * 31, "cx" => n.atf("x") + 0.6, "cy" => n.atf("y") + 0.4, "season" => "ete", "weather" => "soleil",
    "year" => 1790, "place" => place, "carte" => TR::VERSION};
    TR::generate(geo, &spec)
}

/// Part des bords entre deux cultures différentes qui forment des droites de 5 cases (100 m) ou plus.
fn droites(m: &BattleMap) -> f64 {
    let t = &m.t;
    let crop = |v: u8| CROP.contains(&(v as i64));
    let (mut tot, mut al) = (0i64, 0i64);
    for vertical in [true, false] {
        let (outer, inner) = if vertical { (COLS - 1, ROWS) } else { (ROWS - 1, COLS) };
        for a in 0..outer {
            let mut run = 0;
            for b in 0..inner + 1 {
                let mut edge = false;
                if b < inner {
                    let (c, d) = if vertical { (b * COLS + a, b * COLS + a + 1) } else { (a * COLS + b, (a + 1) * COLS + b) };
                    let (c, d) = (c as usize, d as usize);
                    edge = t[c] != t[d] && crop(t[c]) && crop(t[d]);
                }
                if edge {
                    run += 1;
                } else {
                    tot += run;
                    al += if run >= 5 { run } else { 0 };
                    run = 0;
                }
            }
        }
    }
    al as f64 / 1.max(tot) as f64
}

// ------------------------------------------------------------------ Cartes
#[test]
fn meme_graine_meme_carte() {
    let geo = fabrique::geo();
    let v = villages(&geo);
    let (a, b) = (carte(&geo, 1, &v[0], &Val::None), carte(&geo, 1, &v[0], &Val::None));
    assert_eq!(a.t, b.t);
    assert_eq!(a.h, b.h);
    assert_eq!(a.roads, b.roads);
}

#[test]
fn plus_de_quadrillage() {
    let geo = fabrique::geo();
    let parts: Vec<f64> = villages(&geo).iter().enumerate().map(|(k, n)| droites(&carte(&geo, k as i64, n, &Val::None))).collect();
    let moy = py::sum(parts.iter().copied()) / parts.len() as f64;
    assert!(moy < 0.30, "{:.0}% des bords de parcelles en longues droites alignées", moy * 100.0);
}

#[test]
fn vergers_pres_des_maisons() {
    let geo = fabrique::geo();
    let (mut n_verger, mut loin) = (0, 0);
    for (k, n) in villages(&geo).iter().enumerate() {
        let m = carte(&geo, k as i64, n, &Val::None);
        let maisons: Vec<(f64, f64)> = (0..N as usize).filter(|&c| m.t[c] as i64 == T_BATI).map(TR::center_of).collect();
        for c in 0..N as usize {
            if m.t[c] as i64 != T_VERGER {
                continue;
            }
            n_verger += 1;
            let (x, y) = TR::center_of(c);
            if maisons.iter().map(|&(a, b)| py::hypot(x - a, y - b)).fold(f64::INFINITY, f64::min) > 300.0 {
                loin += 1;
            }
        }
    }
    assert!(n_verger > 0, "des vergers à la campagne");
    assert!((loin as f64 / n_verger as f64) < 0.05, "les vergers sont près des maisons");
}

#[test]
fn glacis_degage() {
    let geo = fabrique::geo();
    let n = geo.nodes.iter().find(|g| ["ville", "fort"].contains(&g.ats("type").as_str())).unwrap();
    let pl = dict! {"nid" => n.at("id"), "name" => n.at("name"), "type" => n.at("type"), "fort" => 2, "dmg" => 0.0, "bar" => 0.0,
    "pop" => n.at("pop0"), "x" => n.at("x"), "y" => n.at("y"), "battle" => true};
    for k in 0..3 {
        let spec = dict! {"seed" => 900 + k, "cx" => n.at("x"), "cy" => n.at("y"), "season" => "ete", "weather" => "soleil", "year" => 1790,
        "place" => &pl, "att_angle" => 0.0, "carte" => TR::VERSION};
        let m = TR::generate(&geo, &spec);
        let (px, py_, r) = (m.place.atf("x"), m.place.atf("y"), m.town_r + 300.0);
        // (les vergers de la ville)
        let clos: HashSet<usize> = m.plan.at("ilots").iter().filter(|il| il.at(1) == "verger").flat_map(|il| TV::_dans(&TR::pts_de(&il.at(0)))).collect();
        for c in 0..N as usize {
            if m.t[c] as i64 == T_VERGER && !clos.contains(&c) {
                let (x, y) = TR::center_of(c);
                assert!(py::hypot(x - px, y - py_) > r - TR::CELL as f64, "pas de verger sur le glacis");
            }
        }
    }
}

#[test]
fn ancienne_sauvegarde_meme_carte() {
    // une bataille en cours d'une sauvegarde d'avant la version 2 (pas de « carte ») garde la carte de son début
    let geo = fabrique::geo();
    let n = &villages(&geo)[0];
    let spec = dict! {"seed" => 77, "cx" => n.atf("x") + 0.6, "cy" => n.atf("y") + 0.4, "season" => "ete", "weather" => "soleil", "year" => 1790,
    "place" => Val::None};
    assert_eq!(TR::generate(&geo, &spec.copy()).t, V1::generate(&geo, &spec.copy()).t);
    let s2 = spec.copy();
    s2.set("carte", TR::VERSION);
    assert_ne!(TR::generate(&geo, &s2).t, V1::generate(&geo, &spec.copy()).t);
}

#[test]
fn vite() {
    let geo = fabrique::geo();
    let t0 = Instant::now();
    for (k, n) in villages(&geo).iter().take(5).enumerate() {
        carte(&geo, k as i64, n, &Val::None);
    }
    assert!(t0.elapsed().as_secs_f64() / 5.0 < 0.5, "moins d’une demi-seconde par carte sur un PC");
}
