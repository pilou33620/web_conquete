//! Les villes posées sur les champs de bataille (tactics/terrain_ville.rs) contre Python : tests/references/terrain_ville.json
//! est écrit par le jumeau outils/jumeau/terrain_ville_ref.py. Chaque carte (version 9, avec une place) est refaite sur
//! la GeoMap de sa géographie (geo.rs) et comparée attribut par attribut, to_client compris.
//!
//! Pour chercher un écart :
//!   CONQUETE_FORMES=dossier cargo test -p conquete --test terrain_ville cartes      (formes complètes : <nom>.rs.txt, à
//!       comparer aux <nom>.py.txt de `terrain_ville_ref.py --formes dossier`)
//!   CONQUETE_CARTE=nom CONQUETE_TRACE_HASARD=fichier cargo test -p conquete --test terrain_ville cartes   (une seule
//!       carte, et la trace de son hasard, à comparer à celle de `terrain_ville_ref.py --trace fichier nom`)
#![allow(non_snake_case)]

use conquete::geo::GeoMap;
use conquete::py::json::{dumps_ref_ordre, empreinte_ordre, loads};
use conquete::py::{self, Val};
use conquete::tactics::terrain::{self as TR, BattleMap, Pt};
use conquete::tactics::terrain_ville as TV;
use conquete::list;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;

fn reference() -> Val {
    loads(include_str!("references/terrain_ville.json")).unwrap()
}

/// La GeoMap de la géographie v (3 ou 2), faite une fois par fil (comme tests/terrain.rs).
fn geo(v: i64) -> &'static GeoMap {
    static VERROU: Mutex<()> = Mutex::new(());
    thread_local! {
        static GEOS: RefCell<HashMap<i64, &'static GeoMap>> = RefCell::new(HashMap::new());
    }
    GEOS.with(|g| {
        *g.borrow_mut().entry(v).or_insert_with(|| {
            let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
            let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
            std::fs::create_dir_all(&d).unwrap();
            std::env::set_var("CONQUETE_DATA", &d);
            Box::leak(Box::new(GeoMap::new(v)))
        })
    })
}

fn octets(g: &[u8]) -> Val {
    Val::list(g.iter().map(|&v| Val::from(v)).collect())
}
fn pts(p: &[Pt]) -> Val {
    Val::list(p.iter().map(|&q| Val::from(q)).collect())
}
fn points(v: &Val) -> Vec<Pt> {
    v.iter().map(|p| p.xy()).collect()
}
/// Les mêmes clés que `etat(m, spec)` du jumeau.
fn etat(m: &BattleMap, spec: &Val) -> Vec<(&'static str, Val)> {
    vec![
        ("t", octets(&m.t)),
        ("h", octets(&m.h)),
        ("f", octets(&m.f)),
        ("biome", octets(m.biome.as_ref().unwrap())),
        ("roads", m.roads.clone()),
        ("rivers", m.rivers.clone()),
        ("buildings", m.buildings.clone()),
        ("walls", m.walls.clone()),
        ("hedges", m.hedges.clone()),
        ("fences", m.fences.clone()),
        ("bridges", m.bridges.clone()),
        ("place", m.place.clone()),
        ("heart", m.heart.clone()),
        ("town_r", Val::from(m.town_r)),
        ("region", Val::from(&m.region)),
        ("stats", m.stats.clone()),
        ("town", m.town.clone()),
        ("bastions", m.bastions.clone()),
        ("demi_lunes", m.demi_lunes.clone()),
        ("batis", m.batis.clone()),
        ("plan", m.plan.clone()),
        ("client", m.to_client(spec)),
    ]
}
fn pareil(vu: &Val, attendu: &Val, quoi: &str) {
    assert_eq!(dumps_ref_ordre(vu), dumps_ref_ordre(attendu), "{quoi}");
}
fn bits(vu: f64, attendu: &Val, quoi: &str) {
    assert_eq!(vu.to_bits(), attendu.f().to_bits(), "{quoi} : {vu} au lieu de {attendu}");
}

#[test]
fn cartes() {
    let r = reference();
    let seule = std::env::var("CONQUETE_CARTE").ok();
    let (mut mauvaises, mut faites, mut temps) = (vec![], 0, 0.0);
    for c in r.at("cartes").iter() {
        let nom = c.at("nom").string();
        if seule.as_ref().is_some_and(|s| *s != nom) {
            continue;
        }
        let (geo, spec) = (geo(c.at("gv").i()), c.at("spec"));
        let t0 = std::time::Instant::now();
        let m = TR::generate(geo, &spec);
        temps += t0.elapsed().as_secs_f64();
        let et = etat(&m, &spec);
        if let Some(dossier) = std::env::var_os("CONQUETE_FORMES") {
            let texte: String = et.iter().map(|(k, v)| format!("{k} {}\n", dumps_ref_ordre(v))).collect();
            std::fs::create_dir_all(&dossier).unwrap();
            std::fs::write(std::path::Path::new(&dossier).join(format!("{nom}.rs.txt")), texte).unwrap();
        }
        let attendu = c.at("etat");
        assert_eq!(attendu.len(), et.len(), "{nom} : pas les mêmes attributs");
        let e: Vec<&str> = et.iter().filter(|(k, v)| empreinte_ordre(v) != attendu.at(*k).s()).map(|p| p.0).collect();
        if !e.is_empty() {
            mauvaises.push(format!("{nom} : {}", e.join(", ")));
        }
        faites += 1;
    }
    py::vider_trace();
    eprintln!("{faites} cartes ; temps Rust par carte : {:.2} ms", 1000.0 * temps / faites.max(1) as f64);
    assert!(faites > 0, "aucune carte de ce nom");
    assert!(mauvaises.is_empty(), "{} cartes sur {faites} diffèrent de Python :\n{}", mauvaises.len(), mauvaises.join("\n"));
}

#[test]
fn fonctions() {
    let r = reference();
    let F = r.at("fonctions");
    for c in F.at("bord_assaillant").iter() {
        assert_eq!(TV::bord_assaillant(c.at(0).f()), c.at(1).s(), "bord_assaillant({})", c.at(0));
    }
    let g2 = geo(2);
    for c in F.at("enceinte_carte").iter() {
        let n = g2.nodes.at(c.at(0).i());
        let (ring, lunes, tours) = TV::enceinte_carte(&n, c.at(1).i(), c.at(2).f());
        let v = list![pts(&ring), Val::list(lunes.iter().map(|l| pts(l)).collect()), tours.map(|t| pts(&t))];
        assert_eq!(empreinte_ordre(&v), c.at(3).s(), "enceinte_carte {c}");
    }
    for c in F.at("ecarter").iter() {
        let p = points(&c.at(0));
        let out = TV::ecarter(&p, c.at(1).xy(), c.at(2).f());
        assert_eq!(empreinte_ordre(&pts(&out)), c.at(3).s(), "ecarter {}", c.at(2));
    }
    for (q, c) in F.at("preparer").iter().enumerate() {
        let geo = geo(c.at("gv").i());
        let pl = c.at("pl");
        let L = TV::preparer(geo, &c.at("spec"), &pl, c.at("cx").f(), c.at("cy").f());
        let quoi = format!("preparer {q}");
        for (k, v) in [("k", L.k), ("Mk", L.Mk), ("r_eau", L.r_eau), ("r_calme", L.r_calme), ("r_mur", L.r_mur), ("r_ville", L.r_ville), ("rayon", TV::rayon_enceinte(&L.V))] {
            bits(v, &c.at(k), &format!("{quoi} : {k}"));
        }
        pareil(&list![L.pos.0, L.pos.1], &c.at("pos"), &format!("{quoi} : pos"));
        let mut riv: Vec<String> = L.rivieres.iter().map(|s| s.string()).collect();
        riv.sort();
        pareil(&Val::list(riv.iter().map(Val::from).collect()), &c.at("rivieres"), &format!("{quoi} : rivieres"));
        let ilots = Val::list(
            L.ilots
                .iter()
                .map(|b| {
                    list![
                        pts(&b.q),
                        pts(&b.ins),
                        b.c,
                        &b.typ,
                        b.zone,
                        b.main,
                        Val::list(b.cotes.iter().map(|&x| Val::from(x)).collect()),
                        Val::list(b.kinds.iter().map(Val::from).collect()),
                        b.sd,
                        b.role
                    ]
                })
                .collect(),
        );
        assert_eq!(L.ilots.len() as i64, c.at("n_ilots").i(), "{quoi} : nombre d'îlots");
        assert_eq!(empreinte_ordre(&ilots), c.at("ilots").s(), "{quoi} : ilots");
        let enc = match &L.enceinte {
            Some((ring, lunes, bast, tours)) => list![pts(ring), Val::list(lunes.iter().map(|l| pts(l)).collect()), *bast, tours.as_ref().map(|t| pts(t))],
            None => Val::None,
        };
        assert_eq!(empreinte_ordre(&enc), c.at("enceinte").s(), "{quoi} : enceinte");
        assert_eq!(empreinte_ordre(&L.cours.as_ref().map(|c| pts(c)).into()), c.at("cours").s(), "{quoi} : cours");
        let mut routes: Vec<(usize, Vec<Pt>)> = TV::routes(&L, geo, &pl.at("nid")).into_iter().collect();
        routes.sort_by_key(|p| p.0);
        let rv = Val::dict_from(routes.iter().map(|(ei, p)| (Val::from(ei.to_string()), pts(p))).collect());
        assert_eq!(empreinte_ordre(&rv), c.at("routes").s(), "{quoi} : routes");
        pareil(&Val::from(L.tf((512.25, 371.5))), &c.at("tf"), &format!("{quoi} : tf"));
        pareil(&Val::from(L.unites(1500.0, 1000.0)), &c.at("unites"), &format!("{quoi} : unites"));
    }
}
