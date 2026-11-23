//! Chaque théâtre de geo::THEATRES se charge : sa carte se fait, ses pays ont leurs moyens, leurs maisons et leur culture,
//! une capitale chacun, et ils sont à l'écran de départ (R::MODES) ; ses routes restent hors de l'eau, sans doublon, avec leurs
//! ponts (routes_des_theatres). (Le cache des cartes dans CARGO_TARGET_TMPDIR/geo,
//! comme tests/geo.rs ; l'Europe en détail : tests/europe.rs.)

use conquete::geo::{self, GeoMap, Pt};
use conquete::py::Val;
use conquete::rules as R;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

// (les deux essais partagent le cache des cartes : une carte se fait une fois, l'un après l'autre)
static VERROU: Mutex<()> = Mutex::new(());

fn dossier() {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
}

#[test]
fn chaque_theatre_se_charge() {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    dossier();
    let mut codes: HashSet<String> = HashSet::new();
    let mut ids: HashSet<&str> = HashSet::new();
    for t in geo::THEATRES {
        assert!(t.geo >= 5 && ids.insert(t.id), "{} : numéro ou id déjà pris", t.id);
        assert!(R::MODES().iter().any(|m| m.at("geo") == t.geo && m.at("nom") == t.nom), "{} : pas à l'écran de départ", t.id);
        let g = GeoMap::new(t.geo);
        assert_eq!((g.km_case, g.suffixe.clone()), (5.0, format!("_v{}", t.geo)), "{}", t.id);
        assert!(g.theatre.is_some_and(|x| x.id == t.id));
        let pays = R::pays(t.geo);
        assert!(!pays.is_empty(), "{} : aucun pays", t.id);
        assert_eq!(R::camps(t.geo).len(), pays.len(), "{}", t.id);
        for (c, p) in pays.items() {
            let c = c.string();
            // codes : deux lettres en Europe, trois majuscules ailleurs, uniques sur tous les théâtres
            let n = if t.geo == geo::VERSION_EUROPE { 2 } else { 3 };
            assert!(c.len() == n && c.chars().all(|x| x.is_ascii_uppercase()), "{} : code {c}", t.id);
            assert!(codes.insert(c.clone()), "{c} : code pris par deux théâtres");
            assert!(g.playable_codes.has(c.as_str()), "{c} n'est pas jouable sur sa carte");
            // moyens : [[armée de 1700, 1790, 1813, 1870], trésor] ; huit maisons ; une culture connue
            let m = p.at("moyens");
            assert!(m.len() == 2 && m.at(0).len() == 4 && m.at(0).iter().all(|a| a.f() >= 0.0) && m.atf(1) > 0.0, "{c} : moyens {m}");
            assert!(R::moyens_pays(&c, "1790").is_some(), "{c}");
            assert!(p.at("maisons").len() == 8 && R::MAISON_NOMS().at(c.as_str()).len() == 8, "{c} : maisons");
            assert!(R::culture_connue(p.at("culture").s()), "{c} : culture {}", p.at("culture"));
            assert!(!R::prenoms(&c).is_empty() && !R::prenoms_f(&c).is_empty() && !R::surnames(&c).is_empty(), "{c} : noms");
            // une capitale, celle de pays_<id>.json, dans son pays
            let caps: Vec<_> = g.nodes.iter().filter(|n| n.at("dept") == c.as_str() && n.at("type") == "capitale").collect();
            assert_eq!(caps.len(), 1, "{c} : une capitale");
            assert_eq!(caps[0].at("name"), p.at("capital"), "{c}");
        }
    }
}

/// Les cases d'une grille (de côté 1) que touche la boîte du segment a-b.
fn cases(a: Pt, b: Pt) -> impl Iterator<Item = (i64, i64)> {
    let (i0, i1, j0, j1) = (a.0.min(b.0).floor() as i64, a.0.max(b.0).floor() as i64, a.1.min(b.1).floor() as i64, a.1.max(b.1).floor() as i64);
    (i0..=i1).flat_map(move |i| (j0..=j1).map(move |j| (i, j)))
}

/// Paires de routes doublées : côte à côte (de 0,05 à 0,5 case du tracé de l'autre, parallèles) sur plus de 2 cases, comptées
/// des deux côtés comme tests/mesure-villes-chemins.mjs ; deux tracés confondus ne comptent pas.
fn doubles(traces: &[Vec<Pt>]) -> Vec<(usize, usize, f64)> {
    let mut segs: HashMap<(i64, i64), Vec<(usize, Pt, Pt)>> = HashMap::new();
    for (k, tr) in traces.iter().enumerate() {
        for w in tr.windows(2) {
            for c in cases(w[0], w[1]) {
                segs.entry(c).or_default().push((k, w[0], w[1]));
            }
        }
    }
    let mut long: HashMap<(usize, usize), f64> = HashMap::new();
    for (k, tr) in traces.iter().enumerate() {
        for w in tr.windows(2) {
            let (a, b) = (w[0], w[1]);
            let l = (b.0 - a.0).hypot(b.1 - a.1);
            if l == 0.0 {
                continue;
            }
            let n = (l / 0.25).ceil();
            for s in 0..n as usize {
                let (x, y) = (a.0 + (b.0 - a.0) * s as f64 / n, a.1 + (b.1 - a.1) * s as f64 / n);
                let mut pres: HashMap<usize, (f64, f64)> = HashMap::new(); // autre route -> (distance, cosinus)
                for di in -1..=1 {
                    for dj in -1..=1 {
                        for &(q, c, d) in segs.get(&(x.floor() as i64 + di, y.floor() as i64 + dj)).map_or(&[][..], |v| v.as_slice()) {
                            if q == k {
                                continue;
                            }
                            let (dx, dy) = (d.0 - c.0, d.1 - c.1);
                            let lq = dx.hypot(dy).max(1e-9);
                            let t = (((x - c.0) * dx + (y - c.1) * dy) / (lq * lq)).clamp(0.0, 1.0);
                            let e = (c.0 + dx * t - x).hypot(c.1 + dy * t - y);
                            let cos = (((b.0 - a.0) * dx + (b.1 - a.1) * dy) / l / lq).abs();
                            let v = pres.entry(q).or_insert((e, cos));
                            if e < v.0 {
                                *v = (e, cos);
                            }
                        }
                    }
                }
                for (q, (e, cos)) in pres {
                    if e > 0.05 && e < 0.5 && cos > 0.95 {
                        *long.entry((k.min(q), k.max(q))).or_default() += l / n;
                    }
                }
            }
        }
    }
    long.into_iter().filter(|(_, l)| *l > 2.0 * 2.0).map(|((a, b), l)| (a, b, l / 2.0)).collect()
}

/// Les routes de chaque théâtre (geo.rs, _build_roads) : aucune ne passe sur l'eau hors de ses bouts (une traversée voulue
/// est un bac), aucune paire n'est doublée côte à côte, et chaque fleuve (rang 1 ou 2) que passe un tracé y a son pont.
/// (`cargo test -p conquete --test theatres -- --nocapture` imprime les comptes.)
#[test]
fn routes_des_theatres() {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    dossier();
    let mut defauts: Vec<String> = vec![];
    for t in geo::THEATRES {
        let g = GeoMap::new(t.geo);
        let titre = |e: &Val| format!("{} – {}", g.nodes.at(&e.at("a")).ats("name"), g.nodes.at(&e.at("b")).ats("name"));
        let routes: Vec<Val> = g.edges.iter().filter(|e| e.get("kind") != "water").collect();
        let terre: Vec<Val> = routes.iter().filter(|e| !e.getb("ferry")).cloned().collect();
        let traces: Vec<Vec<Pt>> = terre.iter().map(|e| e.at("pts").iter().map(|p| (p.at(0).f(), p.at(1).f())).collect()).collect();
        // sur l'eau
        let mut eau: Vec<String> = vec![];
        for k in 0..terre.len() {
            let w = g.eau_du_trace(&traces[k]);
            if w > geo::EAU_MAX_5 {
                eau.push(format!("{} ({w:.1} case)", titre(&terre[k])));
            }
        }
        // doublées
        let dbl: Vec<String> = doubles(&traces).iter().map(|&(a, b, l)| format!("{} // {} ({l:.1} cases)", titre(&terre[a]), titre(&terre[b]))).collect();
        // fleuves passés sans pont : les segments des rivières de rang 1 et 2 rangés par case
        let rivs: Vec<(String, Vec<Pt>)> = g.src.at("rivers").iter().filter(|r| r.at("rank").i() <= 2).map(|r| (r.ats("name"), r.at("pts").iter().map(|p| g.xy(p.at(1).f(), p.at(0).f())).collect())).collect();
        let mut grille: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new();
        for (ri, (_, pts)) in rivs.iter().enumerate() {
            for (si, w) in pts.windows(2).enumerate() {
                for c in cases(w[0], w[1]) {
                    grille.entry(c).or_default().push((ri, si));
                }
            }
        }
        let mut sans_pont: Vec<String> = vec![];
        for k in 0..terre.len() {
            let (e, tr) = (&terre[k], &traces[k]);
            let bout = |n: &str| (g.nodes.at(&e.at(n)).atf("x"), g.nodes.at(&e.at(n)).atf("y"));
            let (pa, pb) = (bout("a"), bout("b"));
            let mut ponts: Vec<Pt> = vec![];
            if e.has("bx") && !e.get("bx").is_none() {
                ponts.push((e.atf("bx"), e.atf("by")));
            }
            if e.has("ponts") {
                ponts.extend(e.at("ponts").iter().map(|q| (q.at(0).f(), q.at(1).f())));
            }
            let mut vus: HashSet<(usize, usize, usize)> = HashSet::new();
            for (gi, w) in tr.windows(2).enumerate() {
                for c in cases(w[0], w[1]) {
                    for &(ri, si) in grille.get(&c).map_or(&[][..], |v| v.as_slice()) {
                        let r = &rivs[ri].1;
                        let Some((_, x)) = geo::_seg_inter(w[0], w[1], r[si], r[si + 1]) else { continue };
                        let loin = |p: Pt| (x.0 - p.0).hypot(x.1 - p.1) >= 1.5;
                        if vus.insert((gi, ri, si)) && loin(pa) && loin(pb) && ponts.iter().all(|&p| loin(p)) {
                            sans_pont.push(format!("{} × {} ({:.1}, {:.1})", titre(e), rivs[ri].0, x.0, x.1));
                        }
                    }
                }
            }
        }
        let bacs = routes.len() - terre.len();
        eprintln!("{} : {} routes, dont {bacs} bacs ; sur l'eau {}, doublées {}, fleuves sans pont {}", t.id, routes.len(), eau.len(), dbl.len(), sans_pont.len());
        for (quoi, l) in [("sur l'eau", &eau), ("doublées", &dbl), ("sans pont", &sans_pont)] {
            if !l.is_empty() {
                defauts.push(format!("{} : {} routes {quoi} : {}", t.id, l.len(), l.iter().take(6).cloned().collect::<Vec<_>>().join(", ")));
            }
        }
    }
    assert!(defauts.is_empty(), "{}", defauts.join("\n"));
}
