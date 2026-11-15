//! Les champs de bataille (tactics/terrain.rs, terrain_v1.rs) contre Python : tests/references/terrain.json est écrit
//! par le jumeau outils/jumeau/terrain_ref.py. Chaque carte est refaite sur la GeoMap de sa géographie (geo.rs) et
//! comparée attribut par attribut, to_client compris.
//!
//! Pour chercher un écart :
//!   CONQUETE_FORMES=dossier cargo test -p conquete --test terrain cartes      (formes complètes : <nom>.rs.txt, à
//!       comparer aux <nom>.py.txt de `terrain_ref.py --formes dossier`)
//!   CONQUETE_CARTE=nom CONQUETE_TRACE_HASARD=fichier cargo test -p conquete --test terrain cartes   (une seule carte,
//!       et la trace de son hasard, à comparer à celle de `terrain_ref.py --trace fichier nom`)
#![allow(non_snake_case)]

use conquete::py::json::{dumps_ref_ordre, empreinte_ordre, loads};
use conquete::py::{self, Random, Val};
use conquete::geo::GeoMap;
use conquete::tactics::terrain::{self as TR, BattleMap, Pt};
use conquete::{dict, list};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

const N: usize = TR::N as usize;

fn reference() -> Val {
    loads(include_str!("references/terrain.json")).unwrap()
}

// ====================================================================== la carte de campagne
/// La GeoMap de la géographie v (3 ou 2), faite une fois par fil (relue du cache que tests/geo.rs écrit dans le même
/// dossier ; une seule à la fois : deux fils n'écrivent pas le cache ensemble).
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

// ====================================================================== l'état d'une carte
fn octets(g: &[u8]) -> Val {
    Val::list(g.iter().map(|&v| Val::from(v)).collect())
}
fn cases(g: impl IntoIterator<Item = usize>) -> Val {
    Val::list(g.into_iter().map(Val::from).collect())
}
fn flottants(g: &[f64]) -> Val {
    Val::list(g.iter().map(|&v| Val::from(v)).collect())
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
/// Les attributs de la carte dont l'empreinte n'est pas celle de la référence (une carte de version 1 n'a pas town,
/// bastions… : la référence ne les a pas non plus).
fn ecarts(nom: &str, m: &BattleMap, spec: &Val, attendu: &Val) -> Vec<String> {
    let et = etat(m, spec);
    if let Some(dossier) = std::env::var_os("CONQUETE_FORMES") {
        let texte: String = et.iter().filter(|(k, _)| attendu.has(*k)).map(|(k, v)| format!("{k} {}\n", dumps_ref_ordre(v))).collect();
        std::fs::create_dir_all(&dossier).unwrap();
        std::fs::write(std::path::Path::new(&dossier).join(format!("{nom}.rs.txt")), texte).unwrap();
    }
    let vus: Vec<&str> = et.iter().map(|p| p.0).collect();
    for k in attendu.keys() {
        assert!(vus.contains(&k.s()), "{nom} : l'attribut {k} de la référence n'est pas comparé");
    }
    et.iter().filter(|(k, v)| attendu.has(*k) && empreinte_ordre(v) != attendu.at(*k).s()).map(|(k, _)| k.to_string()).collect()
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
    let (mut mauvaises, mut faites) = (vec![], 0);
    let mut temps = [(0.0, 0), (0.0, 0)];
    for c in r.at("cartes").iter() {
        let nom = c.at("nom").string();
        if seule.as_ref().is_some_and(|s| *s != nom) {
            continue;
        }
        let (geo, spec) = (geo(c.at("gv").i()), c.at("spec"));
        let t0 = std::time::Instant::now();
        let m = TR::generate(geo, &spec);
        let v9 = (spec.get_or("carte", 1) == TR::VERSION) as usize;
        temps[v9] = (temps[v9].0 + t0.elapsed().as_secs_f64(), temps[v9].1 + 1);
        assert_eq!(m.v1, v9 == 0);
        let e = ecarts(&nom, &m, &spec, &c.at("etat"));
        if !e.is_empty() {
            mauvaises.push(format!("{nom} : {}", e.join(", ")));
        }
        faites += 1;
    }
    py::vider_trace();
    eprintln!(
        "{faites} cartes ; temps Rust par carte : version 9 {:.2} ms, version 1 {:.2} ms",
        1000.0 * temps[1].0 / temps[1].1.max(1) as f64,
        1000.0 * temps[0].0 / temps[0].1.max(1) as f64
    );
    assert!(faites > 0, "aucune carte de ce nom");
    assert!(mauvaises.is_empty(), "{} cartes sur {faites} diffèrent de Python :\n{}", mauvaises.len(), mauvaises.join("\n"));
}

/// `echant(v)` du jumeau : l'empreinte d'une grille de flottants et trois de ses valeurs.
fn echant(vu: &[f64], attendu: &Val, quoi: &str) {
    for (k, c) in [0, 7777, N - 1].into_iter().enumerate() {
        bits(vu[c], &attendu.at("v").at(k), quoi);
    }
    assert_eq!(empreinte_ordre(&flottants(vu)), attendu.at("e").s(), "{quoi}");
}

#[test]
fn bruit_flou_distances_et_cases() {
    let r = reference().at("fonctions");
    for c in r.at("hash").iter() {
        bits(TR::_hash(c.at(0).i(), c.at(1).i(), c.at(2).i()), &c.at(3), &format!("_hash{c}"));
    }
    for c in r.at("noise").iter() {
        let v = TR::noise(&mut Random::new(c.at(0).i()), c.at(1).f(), c.at(2).u(), c.at(3).f());
        echant(&v, &c.at(4), &format!("noise {c}"));
    }
    let bruit = TR::noise(&mut Random::new(7), 16.0, 2, 0.5);
    for (k, c) in r.at("blur").iter().enumerate() {
        let source: Vec<f64> = if k < 3 { bruit.clone() } else { bruit.iter().map(|v| (py::int(v * 9.0) * 9) as f64).collect() };
        echant(&TR::blur(&source, c.at(0).u()), &c.at(1), &format!("blur {k}"));
    }
    let masque: Vec<bool> = TR::noise(&mut Random::new(8), 9.0, 2, 0.5).iter().map(|&v| v > 0.42).collect();
    for c in r.at("bfs").iter() {
        let src: Vec<usize> = c.at(0).iter().map(|v| v.u()).collect();
        let passe = |q: usize| masque[q];
        let d = TR::bfs(&src, c.at(1).i(), if c.at(2).truthy() { Some(&passe) } else { None });
        assert_eq!(empreinte_ordre(&octets(&d)), c.at(3).s(), "bfs {}", c.at(1));
    }
    for c in r.at("cell_of").iter() {
        assert_eq!(TR::cell_of(c.at(0).f(), c.at(1).f()), c.at(2).i(), "cell_of{c}");
    }
    for c in r.at("center_of").iter() {
        let (x, y) = TR::center_of(c.at(0).u());
        pareil(&list![x, y], &c.at(1), "center_of");
    }
    for c in r.at("seg_dist").iter() {
        let a: Vec<f64> = c.iter().map(|v| v.f()).collect();
        bits(TR::_seg_dist(a[0], a[1], a[2], a[3], a[4], a[5]), &c.at(6), "_seg_dist");
    }
    for c in r.at("hedge_lines").iter() {
        let cells: Vec<usize> = (0..N).filter(|&q| bruit[q] > c.at(0).f() && TR::_hash(q as i64, 3, 5) < 0.6).collect();
        assert_eq!(cells.len(), c.at(1).u());
        let lignes = Val::list(TR::_hedge_lines(&cells).into_iter().map(|(a, b)| list![a, b]).collect());
        assert_eq!(empreinte_ordre(&lignes), c.at(2).s(), "_hedge_lines {}", c.at(0));
    }
    // les constantes que les autres modules lisent
    assert_eq!((TR::W, TR::H, TR::CELL, TR::COLS, TR::ROWS, TR::N, TR::VERSION), (3000, 2000, 20, 150, 100, 15000, 9));
    assert_eq!(TR::b64(b"a"), "YQ==");
    assert_eq!(TR::b64(b"ab"), "YWI=");
    assert_eq!(TR::b64(&[0xfb, 0xff, 0xbe]), "+/++");
}

#[test]
fn traces() {
    let r = reference().at("fonctions");
    for (q, c) in r.at("traces").iter().enumerate() {
        let p = points(&c.at("pts"));
        let d = TR::_densify(&p, c.at("pas").f());
        assert_eq!(empreinte_ordre(&TR::pts_val(&d)), c.at("densify").s(), "_densify {q}");
        let calme = if c.at("calme").is_none() { None } else { Some((c.at("calme").at(0).xy(), c.at("calme").at(1).f())) };
        let md = TR::_meander(d, &mut Random::new(c.at("graine").i()), c.at("amp").f(), c.at("wave").f(), calme);
        assert_eq!(empreinte_ordre(&TR::pts_val(&md)), c.at("meander").s(), "_meander {q}");
        let clip = TR::_clip_poly(&md, c.at("marge").f());
        assert_eq!(clip.len(), c.at("n_clip").u(), "_clip_poly {q}");
        assert_eq!(empreinte_ordre(&Val::list(clip.iter().map(|part| TR::pts_val(part)).collect())), c.at("clip").s(), "_clip_poly {q}");
        assert_eq!(empreinte_ordre(&cases(TR::_poly_cells(&md))), c.at("poly_cells").s(), "_poly_cells {q}");
        assert_eq!(empreinte_ordre(&cases(TR::_line4(&p))), c.at("line4").s(), "_line4 {q}");
        pareil(&cases(TR::_line_cells(p[0].0, p[0].1, p[1].0, p[1].1)), &c.at("line_cells"), "_line_cells");
        assert_eq!(TR::_poly_near_field(&p), c.at("near").truthy(), "_poly_near_field {q}");
    }
    let court = TR::_meander(vec![(0.0, 0.0), (10.0, 5.0)], &mut Random::new(1), 45.0, 300.0, None);
    pareil(&TR::pts_val(&court), &r.at("meander_court").at(0), "_meander court");
    for c in r.at("random_crossing").iter() {
        pareil(&TR::pts_val(&TR::_random_crossing(&mut Random::new(c.at(0).i()))), &c.at(1), "_random_crossing");
    }
    for c in r.at("stamp").iter() {
        let mut ordre = vec![];
        let vu = TR::_stamp(&points(&c.at(0)), c.at(1).f(), &mut |q| ordre.push(q), c.at(2).f());
        assert_eq!(vu, ordre);
        assert_eq!(ordre.len(), c.at(3).u(), "_stamp");
        assert_eq!(empreinte_ordre(&cases(ordre)), c.at(4).s(), "_stamp");
    }
    let lunes = |ravs: &[Vec<Pt>]| Val::list(ravs.iter().map(|rv| TR::pts_val(rv)).collect());
    for c in r.at("vauban").iter() {
        let (poly, ravs, mids) = TR::_vauban(c.at(0).f(), c.at(1).f(), c.at(2).i(), c.at(3).f(), c.at(4).f());
        assert_eq!(empreinte_ordre(&list![TR::pts_val(&poly), lunes(&ravs), TR::pts_val(&mids)]), c.at(5).s(), "_vauban {}", c.at(2));
    }
    for (q, c) in r.at("trace").iter().enumerate() {
        let pos = (1480.0 + q as f64, 1010.0 - q as f64);
        let (poly, ravs) = TR::_trace(pos, c.at(0).f(), c.at(1).truthy(), &mut Random::new(c.at(3).i()), c.at(2).f());
        assert_eq!(poly.len(), c.at(4).u(), "_trace {q}");
        assert_eq!(empreinte_ordre(&list![TR::pts_val(&poly), lunes(&ravs)]), c.at(5).s(), "_trace {q}");
        let ded = TR::_dedans(&poly);
        assert_eq!(empreinte_ordre(&Val::list((0..N).map(|k| Val::from(ded(k) as i64)).collect())), c.at(6).s(), "_dedans {q}");
    }
    let toits = list![];
    for kd in ["maison", "ferme", "eglise", "moulin", "hotel"] {
        for dp in ["33", "24", "40", "64", "47", ""] {
            for vl in [None, Some("ville"), Some("capitale"), Some("fort")] {
                for an in [1790, 1860] {
                    for hh in [0.1, 0.3, 0.52, 0.6] {
                        toits.push(TR::_toit(kd, dp, vl, an, hh));
                    }
                }
            }
        }
    }
    assert_eq!(empreinte_ordre(&toits), r.at("toit").s(), "_toit");
    let hf: Vec<f64> = TR::noise(&mut Random::new(3), 34.0, 3, 0.45).iter().map(|v| 3.0 + 30.0 * v).collect();
    for c in r.at("ilots").iter() {
        let routes = Val::list(c.at(2).iter().map(|p| dict! {"pts" => TR::pts_val(&points(&p)), "kind" => "route"}).collect());
        let (ilot, strip) = TR::_ilots(c.at(1).i(), &hf, &routes, c.at(0).i());
        let v = |g: Vec<i64>| Val::list(g.into_iter().map(Val::from).collect());
        assert_eq!(empreinte_ordre(&list![v(ilot), v(strip)]), c.at(3).s(), "_ilots {}", c.at(0));
    }
}

/// La carte d'un cas des références, refaite (les scènes la modifient).
fn base(r: &Val, nom: &Val) -> (BattleMap, Val) {
    let c = r.at("cartes").iter().find(|c| c.at("nom") == *nom).unwrap();
    (TR::generate(geo(c.at("gv").i()), &c.at("spec")), c.at("spec"))
}

/// Ce que terrain_ville appellera : enceintes, barricades, redoutes, bâtiments publics, chaussée.
#[test]
fn scenes_de_place() {
    let r = reference();
    let f = r.at("fonctions");
    for (q, c) in f.at("enceinte").iter().enumerate() {
        let (mut m, spec) = base(&r, &c.at("nom"));
        let qf = q as f64;
        let mut rng = Random::new(300 + q as i64);
        let (pos, R, att_a) = ((1450.0 + 20.0 * qf, 1020.0 - 10.0 * qf), 150.0 + 25.0 * qf, 0.5 * qf - 1.0);
        let (fort, bast) = (c.at("fort").i(), c.at("bast").truthy());
        if c.at("sans_route").truthy() {
            m.roads = list![];
        }
        if c.at("sans_route") == "diagonale" {
            let route = [(pos.0 - R - 207.0, pos.1 - R - 181.0), (pos.0 + R + 203.0, pos.1 + R + 190.0)];
            m.roads = list![dict! {"pts" => TR::pts_val(&route), "kind" => "route"}];
        }
        let (poly, ravs) = TR::_trace(pos, R, bast, &mut rng, 0.3 * qf);
        let inside = TR::_dedans(&poly);
        let mut ferme = poly.clone();
        ferme.push(poly[0]);
        let mut wall: BTreeSet<usize> = TR::_line4(&ferme).into_iter().collect();
        for rv in &ravs {
            wall.extend(TR::_line4(rv).into_iter().filter(|&k| !inside(k)));
        }
        let streets: BTreeSet<usize> = m.roads.iter().flat_map(|rt| TR::_poly_cells(&points(&rt.at("pts")))).collect();
        let pl = dict! {"battle" => true, "dmg" => c.at("dmg"), "dyn" => c.at("dyn")};
        let kind = c.at("kind");
        let tours = if c.at("tours").is_none() { None } else { Some(c.at("tours")) };
        TR::_enceinte(
            &mut m,
            &pl,
            pos,
            R,
            fort,
            bast,
            &poly,
            &ravs,
            &wall,
            &inside,
            &streets,
            &mut rng,
            att_a,
            if kind.is_none() { None } else { Some(kind.s()) },
            tours,
            c.at("principal").truthy(),
        );
        m.place = dict! {"name" => "Essai", "x" => py::round(pos.0), "y" => py::round(pos.1), "type" => if q % 2 == 1 { "ville" } else { "capitale" }, "r" => py::round(R),
        "fort" => fort, "battle" => true};
        m.town_r = R;
        TR::_barricades(&mut m, pos, R, 0.2 + 0.15 * qf, &mut rng, att_a);
        TR::_redoubts(&mut m, pos, R, 0.15 * qf, &mut rng, att_a);
        TR::_batis(&mut m, 5 + q as i64, ["33", "24", "40"][q % 3], 1790 + 20 * q as i64);
        let e = ecarts(&format!("enceinte-{q}"), &m, &spec, &c.at("etat"));
        assert!(e.is_empty(), "enceinte {q} ({}) : {}", c.at("nom"), e.join(", "));
    }
    for (q, c) in f.at("poser").iter().enumerate() {
        let (mut m, _) = base(&r, &c.at("nom"));
        let (mut kinds, mut reserve, pieds) = (HashMap::new(), BTreeSet::new(), list![]);
        for (qq, (w, hh, kind, parvis)) in
            [(3, 2, "eglise", TR::T_ROUTE), (2, 2, "hotel", TR::T_PRE), (4, 3, "caserne", TR::T_ROUTE), (1, 1, "halle", TR::T_PRE), (5, 4, "couvent", TR::T_PRE), (2, 2, "hopital", TR::T_PRE)].into_iter().enumerate()
        {
            let near = if qq < 5 { (300.0 + 550.0 * qq as f64 + 40.0 * q as f64, 400.0 + 280.0 * qq as f64) } else { (15.0 + 30.0 * q as f64, 12.0) };
            let avant = m.t.clone(); // (cells_ok lit la grille telle qu'elle est avant la pose : _poser n'écrit qu'après)
            let ok = |k: usize| TR::dans(avant[k], &TR::CULTIVE);
            pieds.push(cases(TR::_poser(&mut m.t, &ok, near, w, hh, kind, &mut kinds, &mut reserve, parvis)));
        }
        pareil(&pieds, &c.at("pieds"), "_poser : les emprises");
        assert_eq!(empreinte_ordre(&octets(&m.t)), c.at("t").s(), "_poser {q} : t");
        assert_eq!(empreinte_ordre(&cases(reserve)), c.at("reserve").s(), "_poser {q} : reserve");
        let mut ks: Vec<(usize, String)> = kinds.into_iter().collect();
        ks.sort();
        pareil(&Val::list(ks.into_iter().map(|(k, v)| list![k, v]).collect()), &c.at("kinds"), "_poser : kinds");
    }
    let hf: Vec<f64> = TR::noise(&mut Random::new(3), 34.0, 3, 0.45).iter().map(|v| 3.0 + 30.0 * v).collect();
    for (q, c) in f.at("chemins").iter().enumerate() {
        let (mut m, spec) = base(&r, &c.at("nom"));
        let mut rng = Random::new(700 + q as i64);
        for _ in 0..8 {
            // (sans m.ilot : droit vers la route, comme l'ancien générateur)
            let (x, y) = TR::center_of(rng.randrange(TR::N) as usize);
            TR::_path_to_road(&mut m, &mut rng, x, y);
        }
        // le terroir autour d'une place forte : pas de verger sur son glacis
        let b = m.buildings.at(0);
        m.place = dict! {"name" => "Essai", "x" => b.at("x"), "y" => b.at("y"), "type" => "ville", "r" => 100, "fort" => 2, "battle" => true};
        m.town_r = 100.0;
        let seed = 900 + q as i64;
        let (ilot, strip) = TR::_ilots(seed, &hf, &m.roads, m.stats.at("main").i());
        (m.ilot, m.strip) = (Some(ilot), Some(strip));
        let eau: Vec<usize> = (0..N).filter(|&k| TR::dans(m.t[k], &[TR::T_EAU, TR::T_GUE])).collect();
        let dwat = if eau.is_empty() { vec![255u8; N] } else { TR::bfs(&eau, 14, None) };
        for k in 0..N {
            if m.t[k] as i64 == TR::T_VERGER {
                m.t[k] = TR::T_CHAMP as u8;
            }
        }
        let biome = m.biome.clone().unwrap();
        let dept = m.stats.at("dept").string();
        TR::_terroir(&mut m, seed, &hf, &dwat, &biome, &dept);
        TR::_path_to_road(&mut m, &mut rng, b.at("x").f() + 0.0, b.at("y").f() + 90.0); // (avec m.ilot : le chemin longe les parcelles)
        if q >= 2 {
            m.plan = dict! {"essai" => 1}; // (une carte à plan : pas de moulin dans la ville ni sur son glacis)
            m.town_r = 600.0;
        }
        if q == 3 {
            // (la place au bord de la rivière : le moulin à eau se pose plus loin)
            let riv = m.rivers.iter().find(|rv| rv.at("kind") == "riviere" || rv.at("kind") == "ruisseau").unwrap();
            let p = riv.at("pts").at(riv.at("pts").len() / 2);
            m.place = m.place.copy();
            m.place.set("x", py::round(p.at(0).f()));
            m.place.set("y", py::round(p.at(1).f()));
        }
        let main = m.stats.at("main").i();
        TR::_farms(&mut m, &mut rng, 4, &hf, main); // (les fermes se tiennent loin de la place)
        for _ in 0..12 {
            TR::_mill(&mut m, &mut rng, &hf, main);
        }
        TR::_batis(&mut m, seed, &dept, 1850);
        (m.ilot, m.strip) = (None, None);
        let e = ecarts(&format!("chemins-{q}"), &m, &spec, &c.at("etat"));
        assert!(e.is_empty(), "chemins {q} ({}) : {}", c.at("nom"), e.join(", "));
    }
    for (q, c) in f.at("chaussee").iter().enumerate() {
        let (mut m, spec) = base(&r, &c.at("nom"));
        let land = TR::_mainland(&m.t);
        assert_eq!(land.len(), c.at("n_land").u(), "_mainland {q}");
        assert_eq!(empreinte_ordre(&cases(land.iter().copied())), c.at("land").s(), "_mainland {q}");
        let cells = TR::_causeway(&mut m, c.at("px").f(), c.at("py").f(), c.at("att_a").f(), &land);
        pareil(&cases(cells), &c.at("cells"), "_causeway : ses cases");
        let e = ecarts(&format!("chaussee-{q}"), &m, &spec, &c.at("etat"));
        assert!(e.is_empty(), "chaussée {q} ({}) : {}", c.at("nom"), e.join(", "));
    }
}
