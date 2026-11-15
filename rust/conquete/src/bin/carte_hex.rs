//! Exporte la carte du jeu sur une grille d'hexagones pour la maquette web/js/dev/carte-hex.html.
//!
//! Même échelle que le jeu : les positions restent en km (1 case de la géographie = 1 km), un hexagone fait
//! HEX_KM de large (d'un côté plat à l'autre). Chaque hexagone prend le terrain et le département majoritaires
//! des cases de 1 km qu'il couvre. Usage : target/release/carte_hex > web/js/dev/carte-hex-data.js
//! Portage de outils/carte_hex.py (même fichier, à l'octet).

mod commun;

use conquete::geo::{GeoMap, T_OCEAN, VERSION};
use conquete::py::{self, json, Val};
use conquete::{dict, list};
use std::io::Write;

const HEX_KM: f64 = 4.0;
const SIMPL: f64 = 0.6; // km : pas minimal des rivières exportées

/// `Counter` réduit à ce qui sert ici : `c[k] += 1` puis `c.most_common(1)[0][0]` (à égalité, le premier compté).
#[derive(Default)]
pub struct Compte(Vec<(i64, i64)>);

impl Compte {
    pub fn ajoute(&mut self, k: i64) {
        match self.0.iter_mut().find(|e| e.0 == k) {
            Some(e) => e.1 += 1,
            None => self.0.push((k, 1)),
        }
    }
    pub fn premier(&self) -> Option<i64> {
        let mut best: Option<(i64, i64)> = None;
        for &(k, n) in &self.0 {
            if best.is_none_or(|b| n > b.1) {
                best = Some((k, n));
            }
        }
        best.map(|b| b.0)
    }
}

fn main() {
    let _ = commun::Args::parse("Exporte la carte du jeu sur une grille d'hexagones (web/js/dev/carte-hex.html).\nUsage : target/release/carte_hex > web/js/dev/carte-hex-data.js", &[]);
    let g = GeoMap::new(VERSION);
    let rk = HEX_KM / 3f64.sqrt(); // rayon (centre → sommet), hexagones pointe en haut comme web_power
    let cols = py::int(g.W as f64 / HEX_KM) + 1;
    let rows = py::int(g.H as f64 / (1.5 * rk)) + 1;
    let (mut ter, mut dep, mut riv) = (String::new(), String::new(), String::new());
    for row in 0..rows {
        for col in 0..cols {
            let (cx, cy) = ((col as f64 + 0.5 * (row & 1) as f64) * HEX_KM, row as f64 * 1.5 * rk);
            let (mut t, mut d, mut rv) = (Compte::default(), Compte::default(), 0u8);
            for j in py::int(cy - rk)..py::int(cy + rk) + 1 {
                for i in py::int(cx - rk)..py::int(cx + rk) + 1 {
                    if py::hypot(i as f64 + 0.5 - cx, j as f64 + 0.5 - cy) > rk * 0.95 {
                        continue;
                    }
                    let c = g.cell(i as f64 + 0.5, j as f64 + 0.5);
                    if c < 0 {
                        t.ajoute(T_OCEAN);
                        continue;
                    }
                    let c = c as usize;
                    t.ajoute(g.terrain[c] as i64);
                    d.ajoute(g.dept[c] as i64);
                    if g.river[c] != 0 {
                        let a = if rv != 0 { rv } else { 9 };
                        rv = if g.river[c] < a { g.river[c] } else { a };
                    }
                }
            }
            ter.push(char::from_u32(48 + t.premier().unwrap_or(T_OCEAN) as u32).unwrap()); // '0' océan … ':' vigne (geo T_*)
            dep.push(char::from_u32(64 + d.premier().unwrap_or(0) as u32).unwrap()); // '@' hors de France, 'A' + index dans depts
            riv.push_str(&rv.to_string()); // 0 : sans rivière, sinon le rang le plus fort
        }
    }
    let km = |lat: f64, lon: f64| {
        let (x, y) = g.xy(lat, lon);
        (py::round_n(x, 2), py::round_n(y, 2))
    };
    let rivers = list![];
    for r in g.src.at("rivers").iter() {
        let mut pts: Vec<(f64, f64)> = vec![];
        for p in r.at("pts").iter() {
            let (lon, lat) = p.xy();
            let q = km(lat, lon);
            if pts.last().is_none_or(|l| py::dist(q.0, q.1, l.0, l.1) >= SIMPL) {
                pts.push(q);
            }
        }
        let p: Val = pts.iter().map(|q| list![q.0, q.1]).collect();
        rivers.push(dict! {"n" => r.at("name"), "k" => r.at("rank"), "p" => p});
    }
    let nodes: Val = g
        .nodes
        .iter()
        .map(|n| dict! {"n" => n.at("name"), "x" => n.at("x"), "y" => n.at("y"), "t" => n.at("type"), "d" => n.at("dept"), "f" => n.at("fort"), "p" => n.at("pop0")})
        .collect();
    let roads: Val =
        g.edges.iter().map(|e| dict! {"a" => e.at("a"), "b" => e.at("b"), "r" => if e.get("royal").truthy() { 1 } else { 0 }, "p" => e.at("pts")}).collect();
    let depts: Val = g.dept_codes.iter().map(|c| Val::from(c.as_str())).collect();
    let data = dict! {
        "hexKm" => HEX_KM, "cols" => cols, "rows" => rows, "W" => g.W, "H" => g.H,
        "ter" => ter, "dep" => dep, "riv" => riv, "depts" => depts, "nodes" => nodes, "roads" => roads, "rivers" => rivers,
    };
    let mut out = std::io::stdout().lock();
    out.write_all("// Généré par outils/carte_hex.py : la géographie du jeu sur une grille d'hexagones.\n".as_bytes()).unwrap();
    out.write_all(format!("const CARTE_HEX = {};\n", json::dumps_compact(&data)).as_bytes()).unwrap();
}
