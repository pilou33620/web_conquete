//! Bancs des plans des villes, portés de tests/test_plan_ville.py et tests/test_plan_organique.py.
//!
//! test_plan_ville.py — Banc des batailles sur le plan des villes (SPEC-CARTE-2D.md, « Livré — E »).
//! POURQUOI CE BANC EXISTE. Une bataille à une place se livre dans la ville de « Voir l'intérieur » : le serveur refait
//! le plan de web/js/carte/villes.js (tactics/plan_ville.rs) et le pose sur la grille de la bataille
//! (terrain_ville.rs). Le portage doit rendre exactement la même ville que le navigateur (même tirage, mêmes hachages,
//! mêmes sinus que V8) : on le vérifie contre Node pour toutes les places. Puis la bataille : le tracé bastionné de
//! Bayonne et ses portes sont ceux du plan, un village a ses maisons le long de ses rues, et la carte se fait vite.
//!
//! test_plan_organique.py — Banc du plan organique des villes (SPEC-VILLES-BATAILLE.md, T1).
//! POURQUOI CE BANC EXISTE. Une bataille en ville doit se livrer sur les rues, les îlots et l'enceinte de la carte : le
//! serveur refait le plan organique de web/js/carte/plan-organique.js (planOrganique de villes.js)
//! (tactics/plan_organique.rs). Le portage doit rendre les mêmes flottants, au bit près : on le vérifie contre Node
//! pour un éventail de places (grande ville, port bastionné, bastide, place forte, bourg, castrum, enceinte devenue
//! cours), avant et après 1860.
//!
//! Les comparaisons avec le navigateur lancent node (tests/plan_ville_js.mjs, tests/plan_organique_js.mjs) ; sans node,
//! l'essai le dit et passe (comme tests/lancer.py le faisait).

#![allow(non_snake_case)] // (les noms du Python : K, V, O, P)

mod fabrique;

use conquete::geo::GeoMap;
use conquete::py::{self, json, Val};
use conquete::tactics::plan_organique as PO;
use conquete::tactics::plan_ville as PV;
use conquete::tactics::terrain::{self as TR, BattleMap, COLS, N, ROWS, T_BATI, T_BRECHE, T_CHEMIN, T_EAU, T_GUE, T_MARAIS_T, T_MUR, T_PORTE, T_PRE, T_ROUTE, T_VIGNE_T};
use conquete::tactics::terrain_ville as TV;
use conquete::{dict, list};
use std::collections::{BTreeSet, HashSet};
use std::path::PathBuf;
use std::time::Instant;

fn racine() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn nom(geo: &GeoMap, x: &str) -> Val {
    geo.nodes.iter().find(|n| n.at("name") == x).unwrap_or_else(|| panic!("pas de nœud {x}"))
}

/// Lance `node <script> carte.json états.json` (la carte : GeoMap.client_payload()) et relit sa sortie JSON ; None si
/// node manque.
fn node(script: &str, geo: &GeoMap, etats: &Val, nom_essai: &str) -> Option<Val> {
    if std::process::Command::new("node").arg("--version").output().is_err() {
        println!("Node absent : pas de comparaison avec {script} ({nom_essai} sauté).");
        return None;
    }
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{nom_essai}_{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("m.json"), json::dumps_compact(&geo.client_payload())).unwrap();
    std::fs::write(d.join("e.json"), json::dumps_compact(etats)).unwrap();
    let out = std::process::Command::new("node").arg(racine().join("tests").join(script)).arg(d.join("m.json")).arg(d.join("e.json")).output().unwrap();
    std::fs::remove_dir_all(&d).ok();
    assert!(out.status.success(), "node {script} : {}", String::from_utf8_lossy(&out.stderr));
    Some(json::loads(&String::from_utf8(out.stdout).unwrap()).unwrap())
}

fn est_liste(v: &Val) -> bool {
    matches!(v, Val::List(_) | Val::Tuple(_))
}
fn est_nombre(v: &Val) -> bool {
    matches!(v, Val::Int(_) | Val::Float(_))
}
fn cles(v: &Val) -> BTreeSet<String> {
    v.keys().iter().map(|k| k.string()).collect()
}

/// Premier écart entre deux résumés, ou None. tol : les nombres à tol près (relatif, 1e-9 pour plan_ville), ou égaux
/// (None : plan_organique, au bit près ; un booléen n'y vaut pas un nombre).
fn ecart(a: &Val, b: &Val, path: &str, tol: Option<f64>) -> Option<String> {
    if matches!(a, Val::Dict(_)) && matches!(b, Val::Dict(_)) {
        if cles(a) != cles(b) {
            return Some(format!("{path} : clés"));
        }
        return a.keys().iter().find_map(|k| ecart(&a.at(k), &b.at(k), &format!("{path}.{k}"), tol));
    }
    if est_liste(a) && est_liste(b) {
        if a.len() != b.len() {
            return Some(format!("{path} : {} contre {}", a.len(), b.len()));
        }
        return a.iter().zip(b.iter()).enumerate().find_map(|(i, (x, y))| ecart(&x, &y, &format!("{path}[{i}]"), tol));
    }
    let egal = match tol {
        Some(t) if est_nombre(a) && (est_nombre(b) || matches!(b, Val::Bool(_))) => (a.f() - b.f()).abs() <= t * 1f64.max(a.f().abs()),
        Some(_) => a == b,
        None if est_nombre(a) && est_nombre(b) => a.f() == b.f(),
        None => a == b && matches!(a, Val::Bool(_)) == matches!(b, Val::Bool(_)),
    };
    if egal {
        None
    } else {
        Some(format!("{path} : {} contre {}", a.repr(), b.repr()))
    }
}

// ==================================================================================================== plan_ville
fn carte(geo: &GeoMap, n: &Val, fort: Option<i64>, battle: bool, att: f64, seed: i64, dmg: f64, year: i64, cx: Option<f64>, cy: Option<f64>) -> BattleMap {
    let pl = dict! {"nid" => n.at("id"), "name" => n.at("name"), "type" => n.at("type"), "fort" => fort.map(Val::from).unwrap_or(n.at("fort")),
    "dmg" => dmg, "bar" => 0.0, "pop" => n.at("pop0"), "x" => n.at("x"), "y" => n.at("y"), "battle" => battle};
    let spec = dict! {"seed" => seed, "cx" => cx.map(Val::from).unwrap_or(n.at("x")), "cy" => cy.map(Val::from).unwrap_or(n.at("y")),
    "season" => "ete", "weather" => "soleil", "year" => year, "place" => if battle { pl } else { Val::None }, "att_angle" => att, "carte" => TR::VERSION};
    TR::generate(geo, &spec)
}
/// `carte(n, fort)` avec les autres défauts du Python (battle=True, att=0.5, seed=700, dmg=0.0, year=1790).
fn carte_f(geo: &GeoMap, n: &Val, fort: Option<i64>) -> BattleMap {
    carte(geo, n, fort, true, 0.5, 700, 0.0, 1790, None, None)
}

fn p2(p: &Val) -> Val {
    list![p.at(0), p.at(1)]
}

/// Ce que les deux générateurs doivent rendre à l'identique (unités de l'intérieur).
fn resume_ville(V: &Val) -> Val {
    let enc = |t: &Val| {
        if !t.truthy() {
            return t.clone();
        }
        dict! {"poly" => t.at("poly").iter().map(|p| p2(&p)).collect::<Val>(),
        "ravs" => t.at("ravs").iter().map(|r| list![p2(&r.at("b1")), p2(&r.at("apex")), p2(&r.at("b2"))]).collect::<Val>()}
    };
    let pf = V.at("Pf");
    dict! {"modele" => pf.at("modele"), "murs" => pf.at("murs"), "R" => pf.at("R"), "routes" => pf.at("routes").iter().map(|r| r.at("a")).collect::<Val>(),
    "ilots" => V.at("ilots").iter().map(|b| dict!{"q" => b.at("q").iter().map(|p| p2(&p)).collect::<Val>(), "role" => b.get("role"),
        "zone" => b.at("zone"), "main" => b.at("main").truthy()}).collect::<Val>(),
    "rues" => V.at("rues").len(), "trace" => enc(&V.at("trace")), "citadelle" => enc(&V.at("citadelle")), "rect" => V.at("rect"),
    "murLigne" => V.at("murLigne"), "rMur" => V.at("rMur"),
    "plus" => V.at("plus").iter().map(|p| dict!{"k" => p.at("k"), "x" => p.get("x"), "y" => p.get("y"), "a" => p.get("a")}).collect::<Val>()}
}

// ------------------------------------------------------------------ LeMemePlan (plan_ville)
#[test]
fn le_plan_de_python_est_celui_du_navigateur() {
    let geo = fabrique::geo();
    let K = PV::carte_de(&*geo);
    let etats = list![];
    for n in geo.nodes.iter() {
        etats.push(list![n.at("id"), 1789, Val::None, Val::None, 0]);
        etats.push(list![n.at("id"), 1870, Val::None, Val::None, 0]);
        etats.push(list![n.at("id"), 1789, 3, &n.at("pop0").or(Val::from(700)) * 3, 2]);
    }
    let Some(js) = node("plan_ville_js.mjs", &geo, &etats, "plan_ville") else { return };
    let mut faux = vec![];
    for (e, j) in etats.iter().zip(js.iter()) {
        let nid = e.ati(0);
        let V = PV::generer_interieur(&K, &PV::profil_ville(&K, &K.noeud.at(nid), e.at(1), e.at(2), e.at(3), e.at(4)));
        if let Some(r) = ecart(&resume_ville(&V), &j, "", Some(1e-9)) {
            faux.push(format!("{} ({}, f={}) {r}", K.noeud.at(nid).at("name"), e.at(1), e.at(2).repr()));
        }
    }
    assert!(faux.is_empty(), "{} plans sur {} diffèrent : {faux:?}", faux.len(), etats.len());
}

#[test]
fn l_arithmetique_de_v8() {
    // (valeurs de Node 22 : Math.imul, mulberry32, Math.hypot, Math.sin, Math.atan2, Math.round)
    let mut R = PV::alea(1234567);
    assert_eq!([R.R(), R.R(), R.R()], [0.6074679309967905, 0.19144689152017236, 0.43751312675885856]);
    assert_eq!(PV::hashS("bayonne"), 2881610187);
    assert_eq!(PV::hash2(3, -7, 2881610187), 0.812592493603006);
    assert_eq!(PV::hypot(3.1, 4.7), 5.630275304103699);
    assert_eq!(PV::sin(2.8966139904629276), 0.24253562503633447);
    assert_eq!(PV::atan2(0.25, -0.97), 2.8893501956999748);
    assert_eq!((PV::jround(2.5), PV::jround(-2.5)), (3, -2));
}

// ------------------------------------------------------------------ BatailleSurLePlan
fn types(m: &BattleMap, c: usize, ts: &[i64]) -> bool {
    ts.contains(&(m.t[c] as i64))
}

#[test]
fn siege_de_bayonne_sur_son_plan() {
    let geo = fabrique::geo();
    let n = nom(&geo, "Bayonne");
    let m = carte(&geo, &n, Some(3), true, 0.5, 700, 0.3, 1790, None, None);
    let V = PV::plan(&*geo, n.ati("id"), 1790, 3, n.at("pop0"), 0);
    let O = PO::plan(&*geo, n.ati("id"), 1790, 3, n.at("pop0"), 0);
    let P = &m.plan;
    assert_eq!(P.at("ilots").len(), O.at("ilots").len(), "les îlots du plan organique de la carte");
    let k = P.atf("k");
    let S = PV::S as f64;
    let tf = |p: (f64, f64)| (P.at("c").atf(0) + (p.0 - n.atf("x")) * S * k, P.at("c").atf(1) + (p.1 - n.atf("y")) * S * k);
    // le tracé bastionné et les demi-lunes de la bataille sont les remparts de la carte (map.js : wallGeom), à
    // l'échelle de la carte (à un mètre près : l'échelle du plan envoyé au client, k, est arrondie)
    let (ring, _lunes, _) = TV::enceinte_carte(&n, 3, V.atf("rMur") / S);
    assert_eq!(m.bastions.len(), ring.len());
    for (p, q) in m.bastions.iter().zip(ring.iter().map(|&q| tf(q))) {
        assert!((p.atf(0) - py::round(q.0) as f64).abs() <= 1.0 && (p.atf(1) - py::round(q.1) as f64).abs() <= 1.0);
    }
    assert_eq!(m.demi_lunes, list![]); // (f = 3 : pas de demi-lunes, comme sur la carte)
    assert_eq!(m.walls.at(0).at("kind"), "bastion");
    assert!(m.walls.at(0).at("breach").truthy(), "le siège a ouvert une brèche");
    if V.at("citadelle").truthy() {
        assert_eq!(m.walls.len(), 2, "la citadelle a son enceinte");
    }
    // chaque route qui entre dans les murs y passe par une porte
    let dedans = TR::_dedans(&TR::pts_de(&m.bastions));
    let mut entrees = 0;
    for r in m.roads.iter() {
        let cells = TR::_poly_cells(&TR::pts_de(&r.at("pts")));
        if r.at("kind") != "chemin" && cells.iter().any(|&c| dedans(c)) && !cells.iter().all(|&c| dedans(c)) {
            entrees += 1;
            assert!(cells.iter().any(|&c| types(&m, c, &[T_PORTE, T_BRECHE])), "route sans porte");
        }
    }
    assert!(entrees >= 2);
    // des maisons dans les îlots, des rues entre eux ; le cœur est l'église du plan
    assert!(m.stats.at("hist").at("BATI").i() > 100);
    let coeur = TR::cell_of(m.heart.atf(0), m.heart.atf(1));
    assert!(coeur >= 0 && types(&m, coeur as usize, &[T_BATI, T_ROUTE, T_PRE]));
    let kinds: HashSet<String> = m.batis.iter().map(|b| b.ats("kind")).collect();
    assert!(kinds.contains("maison") && (kinds.contains("eglise") || kinds.contains("cathedrale")), "{kinds:?}");
    // l'assaillant a la place de se déployer hors des murs (DEPLOI m au moins entre l'enceinte et son bord)
    let px = m.place.atf("x");
    assert!(m.place.atf("r") + 400.0 <= px.max(TR::W as f64 - px) + 1.0);
    let d = m.to_client(&dict! {"seed" => 1, "season" => "ete", "weather" => "soleil", "cx" => 0, "cy" => 0});
    assert_eq!(d.at("plan").at("modele"), "grande");
    assert!(d.at("plan").at("ilots").iter().any(|il| il.at(6).len() != 4), "des îlots à n côtés");
    json::dumps_compact(&d);
}

#[test]
fn une_place_a_demi_lunes() {
    let geo = fabrique::geo();
    let n = nom(&geo, "Navarrenx");
    let m = carte_f(&geo, &n, Some(4));
    let V = PV::plan(&*geo, n.ati("id"), 1790, 4, n.at("pop0"), 0);
    assert_eq!(m.demi_lunes.len(), TV::enceinte_carte(&n, 4, V.atf("rMur") / PV::S as f64).1.len());
}

#[test]
fn un_village_et_ses_rues() {
    let geo = fabrique::geo();
    let n = nom(&geo, "Belin");
    let m = carte(&geo, &n, None, false, 0.5, 700, 0.0, 1790, Some(n.atf("x") + 0.4), Some(n.atf("y"))); // (une bataille rangée à 400 m du village)
    assert_eq!(m.place.at("name"), "Belin");
    assert!(!m.place.at("battle").truthy());
    assert_eq!(m.plan.at("echelle"), 1.0, "un village tient sur le champ : à la vraie échelle");
    assert_eq!(m.plan.at("ilots").len(), PO::plan(&*geo, n.ati("id"), 1790, n.at("fort"), n.at("pop0"), 0).at("ilots").len());
    assert!(!m.walls.truthy());
    assert!((m.place.atf("x") - (1500.0 - 400.0)).abs() <= 1.0);
    // des maisons sur les rues du plan, une église
    let (px, py_) = (m.place.atf("x"), m.place.atf("y"));
    let bati: Vec<usize> = (0..N as usize)
        .filter(|&c| m.t[c] as i64 == T_BATI && py::pow(py::pow(TR::center_of(c).0 - px, 2.0) + py::pow(TR::center_of(c).1 - py_, 2.0), 0.5) < m.town_r)
        .collect();
    assert!(bati.len() > 50);
    let voisins = |c: i64| [c - 1, c + 1, c - COLS, c + COLS];
    let sur_rue = bati.iter().filter(|&&c| voisins(c as i64).iter().any(|&v| types(&m, v as usize, &[T_ROUTE, T_CHEMIN]))).count();
    assert!(sur_rue as f64 / bati.len() as f64 > 0.95);
    assert!(m.batis.iter().any(|b| b.at("kind") == "eglise"));
    // les rues tiennent aux routes (en 8 voisins, comme les troupes : hors du village, une route va en biais)
    let c0 = TR::cell_of(px, py_);
    let mut vus: HashSet<i64> = HashSet::from([c0]);
    let mut todo = vec![c0];
    while let Some(c) = todo.pop() {
        let mut vs = voisins(c).to_vec();
        if 0 < c % COLS && c % COLS < COLS - 1 {
            vs.extend([c - COLS - 1, c - COLS + 1, c + COLS - 1, c + COLS + 1]);
        }
        for v in vs {
            if 0 <= v && v < N && !vus.contains(&v) && types(&m, v as usize, &[T_ROUTE, T_CHEMIN, T_PORTE]) {
                vus.insert(v);
                todo.push(v);
            }
        }
    }
    let bord = vus.iter().any(|&c| [0, COLS - 1].contains(&(c % COLS)) || [0, ROWS - 1].contains(&(c / COLS)));
    assert!(bord, "du village, on gagne le bord de la carte par les rues et les routes");
}

#[test]
fn les_metiers_et_les_quais() {
    let geo = fabrique::geo();
    let cellv = |m: &BattleMap, e: &Val| m.t[TR::cell_of(e.atf("x"), e.atf("y")) as usize] as i64;
    // les métiers du plan (comme « Voir l'intérieur ») : château viticole et ses vignes, airiaux landais, salines
    let m = carte_f(&geo, &nom(&geo, "Saint-Émilion"), None);
    let ks: Vec<Val> = m.plan.at("metiers").iter().map(|e| e.at("k")).collect();
    assert!(ks.iter().any(|k| *k == "chateauVin"));
    let ch = m.plan.at("metiers").iter().find(|e| e.at("k") == "chateauVin").unwrap();
    assert_eq!(cellv(&m, &ch), T_BATI);
    assert!(m.batis.iter().any(|b| b.at("kind") == "chateau"));
    let vignes = m.plan.at("vignes").iter().flat_map(|q| TV::_dans(&TR::pts_de(&q))).filter(|&c| m.t[c] as i64 == T_VIGNE_T).count();
    assert!(vignes > 20, "les vignes du château");
    let m = carte_f(&geo, &nom(&geo, "Sabres"), None);
    let airiaux: Vec<Val> = m.plan.at("metiers").iter().filter(|e| e.at("k") == "airial").collect();
    assert!(!airiaux.is_empty());
    assert!(airiaux.iter().all(|e| cellv(&m, e) == T_BATI));
    // (un assaillant dont la bande laisse les salines hors de son chemin)
    let m = carte(&geo, &nom(&geo, "Salies-de-Béarn"), None, true, 1.57, 700, 0.0, 1790, None, None);
    assert!(m.plan.at("salines").truthy());
    assert!(m.plan.at("salines").at(0).iter().any(|q| TV::_dans(&TR::pts_de(&q)).iter().any(|&c| m.t[c] as i64 == T_MARAIS_T)));
    // rien sur le glacis ni devant une porte ; les quais d'un port le long de l'eau, des bateaux
    for (x, f) in [("Libourne", 1), ("Bordeaux", 2), ("Navarrenx", 3)] {
        let m = carte_f(&geo, &nom(&geo, x), Some(f));
        let murs: Vec<usize> = (0..N as usize).filter(|&c| types(&m, c, &[T_MUR, T_PORTE, T_BRECHE])).collect();
        let dg = TR::bfs(&murs, 7, None);
        for e in m.plan.at("metiers").iter() {
            assert!(dg[TR::cell_of(e.atf("x"), e.atf("y")) as usize] > 7, "{x} : {} sur le glacis", e.at("k"));
        }
    }
    let m = carte_f(&geo, &nom(&geo, "Bordeaux"), Some(2));
    assert!(m.plan.at("quais").truthy() && m.plan.at("bateaux").truthy());
    // (la rive, hors les murs)
    let quai: Vec<usize> = m.plan.at("quais").iter().flat_map(|q| TR::_line4(&TR::pts_de(&q))).filter(|&c| !types(&m, c, &[T_EAU, T_GUE, T_MUR, T_PORTE, T_BRECHE])).collect();
    assert!(quai.len() > 40);
    assert!(quai.iter().filter(|&&c| m.t[c] as i64 == T_ROUTE).count() as f64 / quai.len() as f64 > 0.9, "on passe sur les quais");
    assert!(m.plan.at("bateaux").iter().all(|b| m.t[TR::cell_of(b.atf(0), b.atf(1)) as usize] as i64 == T_EAU));
}

#[test]
fn meme_graine_meme_ville() {
    let geo = fabrique::geo();
    let n = nom(&geo, "Navarrenx");
    let (a, b) = (carte(&geo, &n, Some(3), true, 0.5, 4, 0.0, 1790, None, None), carte(&geo, &n, Some(3), true, 0.5, 4, 0.0, 1790, None, None));
    assert_eq!(a.t, b.t);
    assert!(a.plan == b.plan && a.walls == b.walls && a.batis == b.batis);
}

fn kinds_ponts(geo: &GeoMap, ville: &str, riviere: &str, y: i64) -> Vec<Val> {
    let m = carte(geo, &nom(geo, ville), None, true, 0.5, 700, 0.0, y, None, None);
    let mut ks: Vec<Val> = vec![];
    for b in m.bridges.iter().filter(|b| b.get("river") == riviere) {
        if !ks.contains(&b.get("kind")) {
            ks.push(b.get("kind"));
        }
    }
    ks
}

#[test]
fn pas_de_pont_de_pierre_a_bordeaux_avant_1822() {
    let geo = fabrique::geo();
    assert_eq!(kinds_ponts(&geo, "Bordeaux", "Garonne", 1800), vec![Val::from("bateaux")]);
    assert_eq!(kinds_ponts(&geo, "Bordeaux", "Garonne", 1830), vec![Val::None]);
}

#[test]
fn les_autres_ponts_dates() {
    let geo = fabrique::geo();
    // (le Python lit PONTS_DATES de villes.js à l'expression régulière : r'PONTS_DATES = \[(.*?)\];' puis
    // r"\['([^']+)', '([^']+)', (\d+)\]")
    let src = std::fs::read_to_string(racine().join("web/js/carte/villes.js")).unwrap();
    let debut = src.find("PONTS_DATES = [").unwrap() + "PONTS_DATES = [".len();
    let js = &src[debut..debut + src[debut..].find("];").unwrap()];
    let mut vus: Vec<(String, String, i64)> = vec![];
    for morceau in js.split("['").skip(1) {
        let champs: Vec<&str> = morceau.splitn(3, "', ").collect();
        let (v, r) = (champs[0], champs[1].trim_start_matches('\''));
        let a: String = champs[2].chars().take_while(|c| c.is_ascii_digit()).collect();
        vus.push((v.to_string(), r.to_string(), a.parse().unwrap()));
    }
    vus.sort();
    let mut tr: Vec<(String, String, i64)> = TR::PONTS_DATES.iter().map(|&(v, r, a)| (v.to_string(), r.to_string(), a)).collect();
    tr.sort();
    assert_eq!(vus, tr, "villes.js et terrain.py : les mêmes ponts");
    assert_eq!(kinds_ponts(&geo, "Libourne", "Dordogne", 1800), vec![Val::from("bateaux")]);
    assert_eq!(kinds_ponts(&geo, "Libourne", "Dordogne", 1830), vec![Val::None]);
    // la route de Bordeaux à Libourne passe la Garonne et la Dordogne : un pont (ou un bac) sur chacune
    let noms = |e: &Val| BTreeSet::from([geo.nodes.at(e.at("a")).ats("name"), geo.nodes.at(e.at("b")).ats("name")]);
    let e = geo.edges.iter().find(|e| noms(e) == BTreeSet::from(["Bordeaux".to_string(), "Libourne".to_string()])).unwrap();
    let mut rivs = BTreeSet::from([e.ats("river")]);
    rivs.extend(e.at("ponts").iter().map(|p| p.ats(2)));
    assert_eq!(rivs, BTreeSet::from(["Garonne".to_string(), "Dordogne".to_string()]));
    // (géographie 2 : les routes de Bordeaux, Créon et Izon passent la Dordogne au pont de Libourne, pas en amont)
    let lib = nom(&geo, "Libourne");
    for e in geo.edges.iter() {
        let ns = noms(&e);
        if (e.at("a") == lib.at("id") || e.at("b") == lib.at("id")) && e.get("kind") != "water" && ["Bordeaux", "Créon", "Izon"].iter().any(|x| ns.contains(*x)) {
            let mut ps = vec![list![e.at("bx"), e.at("by"), e.at("river")]];
            ps.extend(e.get_or("ponts", list![]).iter());
            let p = ps.iter().find(|p| p.at(2) == "Dordogne").unwrap();
            let (x, y) = (p.atf(0), p.atf(1));
            assert!(py::pow(py::pow(x - lib.atf("x"), 2.0) + py::pow(y - lib.atf("y"), 2.0), 0.5) < 1.0, "au pied de Libourne");
        }
    }
}

#[test]
fn vite() {
    let geo = fabrique::geo();
    let K = PV::carte_de(&*geo);
    let cas = [("Bayonne", 3), ("Bordeaux", 2), ("Navarrenx", 3), ("Belin", 0)];
    let t0 = Instant::now();
    for (x, f) in cas {
        K.plans.clear(); // (sans le plan gardé en mémoire)
        carte_f(&geo, &nom(&geo, x), Some(f));
    }
    let dt = t0.elapsed().as_secs_f64() / cas.len() as f64;
    assert!(dt < 0.5, "moins d’une demi-seconde par carte sur un PC (deux à trois fois plus sur un Raspberry Pi)");
}

// ==================================================================================================== plan_organique
// (nom, f, pop, d) : f=None garde l'enceinte de la place
const VILLES: [(&str, Option<i64>, Option<i64>, i64); 10] = [
    ("Bordeaux", None, None, 0), ("Bayonne", None, None, 0), ("Libourne", None, None, 0), ("Navarrenx", None, None, 0), ("Belin", None, None, 0),
    ("Dax", Some(3), None, 0), ("Bazas", Some(0), None, 0), ("Beynac", None, None, 0), ("Agen", None, Some(30000), 2), ("Fort Médoc", None, None, 0),
];

fn resume_organique(O: &Val) -> Val {
    if O.is_none() {
        return Val::None;
    }
    // (JSON : Infinity devient null)
    let nb = |b: &Val| b.iter().map(|v| if v.f().is_infinite() { Val::None } else { v }).collect::<Val>();
    let mur = O.at("mur");
    dict! {"ilots" => O.at("ilots").iter().map(|il| dict!{"pts" => il.at("pts"), "bloc" => il.at("bloc"), "kinds" => il.at("kinds"),
        "type" => il.at("type"), "c" => il.at("c"), "graine" => il.at("graine"), "sec" => il.at("sec"), "boite" => il.at("boite")}).collect::<Val>(),
    "mur" => if mur.truthy() { dict!{"pts" => mur.at("pts"), "kind" => mur.at("kind"), "demi" => mur.at("demi")} } else { mur },
    "axes" => O.at("axes").iter().map(|a| dict!{"pts" => a.at("pts"), "ws" => a.at("ws"), "demi" => a.at("demi"), "kind" => a.at("kind")}).collect::<Val>(),
    "boite" => nb(&O.at("boite"))}
}

// ------------------------------------------------------------------ LeMemePlan (plan_organique)
#[test]
fn le_plan_de_python_est_celui_de_la_carte() {
    let geo = fabrique::geo();
    let K = PV::carte_de(&*geo);
    let etats = list![];
    for (x, f, pop, d) in VILLES {
        for an in [1789, 1870] {
            etats.push(list![nom(&geo, x).at("id"), an, f, pop, d]);
        }
    }
    let Some(js) = node("plan_organique_js.mjs", &geo, &etats, "plan_organique") else { return };
    let (mut faux, mut ilots) = (vec![], 0);
    for (e, j) in etats.iter().zip(js.iter()) {
        let nid = e.ati(0);
        let O = PO::plan(&*geo, nid, e.at(1), e.at(2), e.at(3), e.at(4));
        ilots += if O.truthy() { O.at("ilots").len() } else { 0 };
        if let Some(r) = ecart(&resume_organique(&O), &j, "", None) {
            faux.push(format!("{} ({}, f={}) {r}", K.noeud.at(nid).at("name"), e.at(1), e.at(2).repr()));
        }
    }
    println!("plan organique : {}/{} plans identiques à Node ({ilots} îlots)", etats.len() - faux.len(), etats.len());
    assert!(faux.is_empty(), "{} plans sur {} diffèrent : {faux:?}", faux.len(), etats.len());
}

#[test]
fn cache_et_fortin() {
    let geo = fabrique::geo();
    let n = nom(&geo, "Bordeaux");
    assert!(PO::plan(&*geo, n.ati("id"), 1789, Val::None, Val::None, 0).is(&PO::plan(&*geo, n.ati("id"), 1789, Val::None, Val::None, 0)));
    assert!(PO::plan(&*geo, nom(&geo, "Fort Médoc").ati("id"), 1789, Val::None, Val::None, 0).is_none());
}

#[test]
fn duree_bordeaux() {
    let geo = fabrique::geo();
    let K = PV::carte_de(&*geo);
    let n = nom(&geo, "Bordeaux");
    let V = PV::plan(&*geo, n.ati("id"), 1870, Val::None, Val::None, 0);
    V.pop("org");
    let t = Instant::now();
    PO::plan_organique(&K, &V);
    println!("plan organique de Bordeaux (1870) : {:.2} s", t.elapsed().as_secs_f64());
}
