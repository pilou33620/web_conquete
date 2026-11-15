//! Exporte des batailles du jeu sur une grille d'hexagones pour la maquette web/js/dev/bataille-hex.html.
//!
//! Même échelle que le jeu : le champ de bataille garde ses 3 000 × 2 000 m et ses positions en mètres ; un hexagone fait
//! HEX_M de large. Chaque hexagone prend le type de case majoritaire des cases de 20 m qu'il couvre (routes, chemins et gués
//! mis à part : ils sont tracés à leur place) et leur hauteur moyenne. Les batailles viennent du mode Bataille
//! (skirmish::new), une par style (SCENARIOS : rase campagne, place forte, ville, village barricadé, collines).
//! Usage : target/release/bataille_hex > web/js/dev/bataille-hex-data.js
//! Portage de outils/bataille_hex.py (même fichier, à l'octet).

mod commun;

use conquete::geo::{GeoMap, VERSION};
use conquete::py::{self, json, Val};
use conquete::rules as R;
use conquete::tactics::skirmish as SK;
use conquete::tactics::terrain as TT;
use conquete::tactics::units as U;
use conquete::{dict, list};
use std::io::Write;
use std::rc::Rc;

const HEX_M: f64 = 40.0;
const TRACES: [i64; 3] = [TT::T_ROUTE, TT::T_CHEMIN, TT::T_GUE]; // tracés à part : l'hexagone prend le terrain d'à côté
const UNITS: [(&str, i64); 5] = [("ligne", 3), ("cavalerie", 1), ("artillerie", 2), ("legere", 1), ("grenadiers", 1)];
// (id, style, lieu ou None, kind, saison, temps, graine) ; graines choisies pour un terrain lisible
#[allow(clippy::type_complexity)]
const SCENARIOS: [(&str, &str, Option<&str>, &str, Option<&str>, Option<&str>, i64); 5] = [
    ("plaine", "Rase campagne", Some("Marmande"), "bataille", Some("été"), Some("soleil"), 1),
    ("place", "Siège d’une place forte", Some("Navarrenx"), "forteresse", Some("été"), Some("soleil"), 1),
    ("ville", "Devant la ville", None, "bataille", None, None, 5),
    ("village", "Village barricadé", Some("Villeréal"), "village", Some("automne"), Some("soleil"), 1),
    ("collines", "Dans les collines", Some("Oloron-Sainte-Marie"), "bataille", Some("printemps"), Some("soleil"), 2),
];

/// `Counter` réduit à ce qui sert ici : dans l'ordre du premier compté ; `most_common(1)[0][0]` : à égalité, le premier.
fn plus_frequent(c: &[(i64, i64)]) -> i64 {
    let mut best = c[0];
    for &e in &c[1..] {
        if e.1 > best.1 {
            best = e;
        }
    }
    best.0
}

fn r1(p: &Val) -> Val {
    let (x, y) = p.xy();
    list![py::round(x), py::round(y)]
}

fn bataille(geo: &Rc<GeoMap>, sc: &(&str, &str, Option<&str>, &str, Option<&str>, Option<&str>, i64)) -> Val {
    let (sid, style, lieu, kind, season, weather, seed) = *sc;
    let place = lieu.and_then(|l| geo.nodes.iter().find(|n| n.at("name") == l).map(|n| n.at("id")));
    let units = Val::dict();
    for (k, n) in UNITS {
        units.set(k, n);
    }
    let (g, bid) = SK::new(
        geo.clone(),
        &dict! {"me" => "33", "era" => "1790", "kind" => kind, "place" => Val::from(place), "season" => Val::from(season),
        "weather" => Val::from(weather), "seed" => seed, "mode" => "manuel", "units" => units},
    );
    let mut g = g.unwrap_or_else(|| panic!("AssertionError: {bid}"));
    let tb = g.tactical.take().unwrap();
    let m = &tb.map;
    let rk = HEX_M / 3f64.sqrt();
    let cell = TT::CELL as f64;
    let (cols, rows) = (py::int(TT::W as f64 / HEX_M) + 1, py::int(TT::H as f64 / (1.5 * rk)) + 1);
    let (mut ter, hau) = (String::new(), list![]);
    for row in 0..rows {
        for col in 0..cols {
            let (cx, cy) = ((col as f64 + 0.5 * (row & 1) as f64) * HEX_M, row as f64 * 1.5 * rk);
            let (mut t, mut hs): (Vec<(i64, i64)>, Vec<i64>) = (vec![], vec![]);
            for j in py::int(py::floordiv_f(cy - rk, cell))..py::int(py::floordiv_f(cy + rk, cell)) + 1 {
                for i in py::int(py::floordiv_f(cx - rk, cell))..py::int(py::floordiv_f(cx + rk, cell)) + 1 {
                    if !(0 <= i && i < TT::COLS && 0 <= j && j < TT::ROWS) {
                        continue;
                    }
                    if py::hypot((i as f64 + 0.5) * cell - cx, (j as f64 + 0.5) * cell - cy) > rk + cell * 0.5 {
                        continue;
                    }
                    let c = (j * TT::COLS + i) as usize;
                    hs.push(m.h[c] as i64);
                    let k = m.t[c] as i64;
                    match t.iter_mut().find(|e| e.0 == k) {
                        Some(e) => e.1 += 1,
                        None => t.push((k, 1)),
                    }
                }
            }
            let fond: Vec<(i64, i64)> = t.iter().copied().filter(|e| !TRACES.contains(&e.0)).collect();
            let choix = if !fond.is_empty() { plus_frequent(&fond) } else if !t.is_empty() { plus_frequent(&t) } else { TT::T_PRE };
            ter.push(char::from_u32(65 + choix as u32).unwrap()); // 'A' + type de case (terrain.TYPE_NAMES)
            hau.push(if hs.is_empty() { 0 } else { py::round(hs.iter().sum::<i64>() as f64 / hs.len() as f64) });
        }
    }
    let side_owner = |k: i64| tb.units.iter().find(|u| u.at("side") == k).expect("StopIteration").at("owner");
    let sides = list![side_owner(0), side_owner(1)]; // le camp de chaque côté (0 : l'assaillant)
    let barr: Val = (0..TT::N)
        .filter(|&c| m.t[c as usize] as i64 == TT::T_BARRICADE)
        .map(|c| list![((c % TT::COLS) as f64 + 0.5) * cell, ((c / TT::COLS) as f64 + 0.5) * cell])
        .collect();
    let nom_place = if m.place.truthy() { m.place.at("name") } else { m.place.clone() }; // `m.place and m.place['name']`
    let pts = |l: &Val| -> Val { l.iter().map(|p| r1(&p)).collect() };
    let noms = |l: &[&str]| -> Val { l.iter().map(|s| Val::from(*s)).collect() };
    let factions = Val::dict();
    for (k, f) in R::FACTIONS().items() {
        factions.set(k, dict! {"nom" => f.at("name"), "col" => f.at("color")});
    }
    dict! {
        "id" => sid, "style" => style, "kind" => kind, "lieu" => lieu.map_or(nom_place.clone(), Val::from), "barr" => barr,
        "hexM" => HEX_M, "cols" => cols, "rows" => rows, "W" => TT::W, "H" => TT::H,
        "ter" => ter,
        "h" => hau, "types" => noms(&TT::TYPE_NAMES), "labels" => noms(&TT::TYPE_LABEL),
        "roads" => m.roads.iter().map(|r| dict!{"k" => r.at("kind"), "p" => pts(&r.at("pts"))}).collect::<Val>(),
        "rivers" => m.rivers.iter().map(|r| dict!{"w" => r.at("w"), "p" => pts(&r.at("pts"))}).collect::<Val>(),
        "batis" => m.batis.iter().map(|b| dict!{"k" => b.at("kind"), "x" => b.at("x"), "y" => b.at("y"), "n" => b.at("c").len() as i64}).collect::<Val>(),
        "walls" => m.walls.iter().map(|w| if w.is_dict() { pts(&w.at("pts")) } else { pts(&w) }).collect::<Val>(),
        "hedges" => m.hedges.iter().map(|hd| pts(&hd)).collect::<Val>(),
        "town" => &m.town, "place" => nom_place, "region" => m.region.as_str(), "date" => tb.spec.get("date"),
        "season" => tb.spec.at("season"), "weather" => tb.spec.at("weather"),
        "sides" => sides, "units" => tb.units.iter().map(|u| U::view(&u, true, false)).collect::<Val>(),
        "factions" => factions,
    }
}

fn main() {
    let _ = commun::Args::parse("Exporte des batailles du jeu sur une grille d'hexagones (web/js/dev/bataille-hex.html).\nUsage : target/release/bataille_hex > web/js/dev/bataille-hex-data.js", &[]);
    let geo = Rc::new(GeoMap::new(VERSION));
    let data: Val = SCENARIOS.iter().map(|sc| bataille(&geo, sc)).collect();
    let mut out = std::io::stdout().lock();
    out.write_all("// Généré par outils/bataille_hex.py : des batailles du jeu sur une grille d'hexagones.\n".as_bytes()).unwrap();
    out.write_all(format!("const BATAILLES_HEX = {};\n", json::dumps_compact(&data)).as_bytes()).unwrap();
}
