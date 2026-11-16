//! La géographie (places, geo, waterways) contre Python : tests/references/geo.json est écrit par le jumeau
//! outils/jumeau/geo_ref.py. Les trois cartes sont GÉNÉRÉES (dans un dossier de travail vide de tout cache), comparées,
//! puis relues du cache qu'elles viennent d'écrire et comparées encore.
//!
//! - CONQUETE_CACHE_PYTHON=dossier : relit aussi les caches écrits par Python (geo_ref.py --caches dossier) ;
//! - les caches écrits par le Rust restent dans target/tmp/geo : `geo_ref.py --relire target/tmp/geo` les fait relire
//!   par Python ;
//! - CONQUETE_GEO_COMPLET=dossier : écrit la forme complète de chaque attribut (rs_<v>_<attribut>.txt), à comparer à
//!   celles du jumeau (--complet dossier) pour chercher un écart.

use conquete::geo::{self, GeoMap, Info, Pairs, Pt};
use conquete::py::{json, Val};
use conquete::{dict, list, places, waterways};
use std::path::{Path, PathBuf};

fn reference() -> Val {
    json::loads(include_str!("references/geo.json")).unwrap()
}
fn canon(v: &Val) -> String {
    json::dumps_ref_ordre(v)
}
/// Les deux valeurs s'écrivent pareil (forme ordonnée des références) : mêmes clés dans le même ordre, mêmes bits.
#[track_caller]
fn pareil(quoi: &str, vu: &Val, attendu: &Val) {
    let (a, b) = (canon(vu), canon(attendu));
    if a != b {
        let k = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
        let coupe = |s: &str| String::from_utf8_lossy(&s.as_bytes()[k.saturating_sub(150)..(k + 150).min(s.len())]).to_string();
        panic!("{quoi} : écart au caractère {k}\n vu      …{}…\n attendu …{}…", coupe(&a), coupe(&b));
    }
}
fn pt(v: &Val) -> Pt {
    v.xy()
}
fn pts(v: &Val) -> Vec<Pt> {
    v.iter().map(|p| p.xy()).collect()
}
fn pts_val(l: &[Pt]) -> Val {
    l.iter().map(|&(x, y)| list![x, y]).collect()
}
fn opt_pts(l: Option<Vec<Pt>>) -> Val {
    l.map_or(Val::None, |l| pts_val(&l))
}
fn entiers<T: Copy + Into<Val>>(l: &[T]) -> Val {
    l.iter().map(|&x| x.into()).collect()
}
fn u16s(l: &[u16]) -> Val {
    l.iter().map(|&x| Val::from(x as i64)).collect()
}
fn t3(l: &[(f64, f64, f64)]) -> Val {
    l.iter().map(|&(a, b, c)| list![a, b, c]).collect()
}
fn t4(l: &[(f64, f64, f64, f64)]) -> Val {
    l.iter().map(|&(a, b, c, d)| list![a, b, c, d]).collect()
}
fn sha256(s: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(s.as_bytes()).iter().map(|o| format!("{o:02x}")).collect()
}
/// Le masque de army_actions.cell_mask : une marque par lieu interdit.
fn masque(marques: &Val) -> Vec<u8> {
    let mut m = vec![0u8; 65536];
    for nt in marques.iter() {
        m[nt.at(0).u()] = nt.at(1).i() as u8;
    }
    m
}

#[test]
fn fonctions_et_constantes() {
    let r = reference().at("fonctions");
    // constantes
    let vu = dict! {
        "CACHE_VERSION" => geo::CACHE_VERSION, "VERSION" => geo::VERSION, "LAT_REF" => geo::LAT_REF, "KX" => geo::KX(), "KY" => geo::KY, "NONE" => geo::NONE,
        "TERRAIN" => geo::TERRAIN(), "PLAYABLE" => geo::PLAYABLE(), "LANDES_POLY" => pts_val(&geo::LANDES_POLY), "FORESTS" => t4(&geo::FORESTS),
        "VINEYARDS" => t3(&geo::VINEYARDS),
        "CRETES" => geo::CRETES.iter().map(|&(a, w, l)| list![a, w, pts_val(l)]).collect::<Val>(),
        "MASSIFS" => t4(&geo::MASSIFS), "FORETS_3" => t4(&geo::FORETS_3), "VIGNES_3" => t3(&geo::VIGNES_3),
        "ROUTES_ROYALES_3" => geo::ROUTES_ROYALES_3.iter().map(|l| l.iter().map(|&s| Val::from(s)).collect::<Val>()).collect::<Val>(),
        "MARAIS_3" => t3(&geo::MARAIS_3),
        "T" => list![geo::T_OCEAN, geo::T_EAU, geo::T_PLAINE, geo::T_FORET, geo::T_LANDE, geo::T_MARAIS, geo::T_COLLINES, geo::T_MONTAGNE, geo::T_HAUTE, geo::T_DUNES, geo::T_VIGNE],
        "ESTUARY" => pts_val(&waterways::ESTUARY), "COAST" => pts_val(&waterways::COAST), "LABEL" => waterways::LABEL(),
        "SEA_PORTS" => Val::dict_from(waterways::SEA_PORTS.iter().map(|&(n, l)| (Val::from(n), pts_val(l))).collect()),
        "RIVER_PORT_KM" => waterways::RIVER_PORT_KM, "EXCLUDE" => waterways::EXCLUDE(),
        "WAYS" => waterways::WAYS.iter().map(|w| list![w.name, w.river, w.into, w.tidal_lat, w.low_water, w.sea]).collect::<Val>(),
    };
    let attendu = r.at("constantes");
    assert_eq!(vu.len(), attendu.len());
    for (k, a) in attendu.items() {
        pareil(&format!("constante {k}"), &vu.at(&k), &a);
    }
    // places
    let p = r.at("places");
    let tables = [
        ("PLACES", places::PLACES()),
        ("ROYAL_ROUTES", places::ROYAL_ROUTES()),
        ("EXTRA_ROADS", places::EXTRA_ROADS()),
        ("EXTRA_ROADS_2", places::EXTRA_ROADS_2()),
        ("NO_ROADS_2", places::NO_ROADS_2()),
        ("CITY_SPECIALTIES", places::CITY_SPECIALTIES()),
        ("CITY_POP", places::CITY_POP()),
        ("FERRIES", places::FERRIES()),
    ];
    for (nom, t) in &tables {
        assert_eq!(json::empreinte_ordre(t), p.at(*nom).s(), "places.{nom}");
    }
    for (nom, t) in &tables[..3] {
        assert_eq!(sha256(&t.repr()), p.at("repr").at(*nom).s(), "repr(places.{nom})");
    }
    let pl = places::PLACES();
    pareil("places", &list![pl.at(0), pl.at(-1), pl.len(), places::ROYAL_ROUTES().at(0), places::CITY_POP().at("Bordeaux"), places::CITY_SPECIALTIES().at("Pau")], &p.at("lisible"));
    for cas in r.at("clip").iter() {
        let (lon, lat) = (cas.at(0).f(), cas.at(1).f());
        pareil("clip", &waterways::WAYS.iter().map(|w| Val::from(w.clip.map(|f| f(lon, lat)))).collect::<Val>(), &cas.at(2));
    }
    // bruit, géométrie
    for c in r.at("_h").iter() {
        pareil("_h", &geo::_h(c.at(0).i(), c.at(1).i(), c.at(2).i()).into(), &c.at(3));
    }
    for c in r.at("vnoise").iter() {
        pareil("vnoise", &geo::vnoise(c.at(0).f(), c.at(1).f(), c.at(2).i()).into(), &c.at(3));
    }
    for c in r.at("fbm").iter() {
        pareil("fbm", &geo::fbm(c.at(0).f(), c.at(1).f(), c.at(2).i(), c.at(3).i()).into(), &c.at(4));
    }
    for c in r.at("_dseg").iter() {
        let a: Vec<f64> = c.iter().map(|x| x.f()).collect();
        pareil("_dseg", &geo::_dseg(a[0], a[1], a[2], a[3], a[4], a[5]).into(), &c.at(6));
    }
    for c in r.at("slugify").iter() {
        assert_eq!(geo::slugify(c.at(0).s()), c.at(1).s(), "slugify({})", c.at(0));
    }
    for c in r.at("_seg_inter").iter() {
        let p = pts(&c.at(0));
        let vu = geo::_seg_inter(p[0], p[1], p[2], p[3]).map_or(Val::None, |(t, (x, y))| list![t, list![x, y]]);
        pareil("_seg_inter", &vu, &c.at(1));
    }
    for c in r.at("_proj").iter() {
        let (d, s) = geo::_proj(pt(&c.at(0)), &pts(&c.at(1)));
        pareil("_proj", &list![d, s], &c.at(2));
    }
    for c in r.at("_jusqua").iter() {
        pareil("_jusqua", &pts_val(&geo::_jusqua(&pts(&c.at(0)), c.at(1).f())), &c.at(2));
    }
    for c in r.at("ww").iter() {
        let (ligne, cum, p) = (pts(&c.at(0)), c.at(1).iter().map(|x| x.f()).collect::<Vec<_>>(), pt(&c.at(2)));
        pareil("_seglen", &waterways::_seglen(&ligne).into(), &c.at(5));
        let (d, s, q) = waterways::_project(&ligne, &cum, p);
        pareil("_project", &list![d, s, list![q.0, q.1]], &c.at(6));
        pareil("_cut", &pts_val(&waterways::_cut(&ligne, &cum, c.at(3).f(), c.at(4).f())), &c.at(7));
    }
    for c in r.at("_elev").iter() {
        let (la, lo) = (c.at(0).f(), c.at(1).f());
        pareil("_elev", &list![GeoMap::_elev(la, lo), GeoMap::_elev3(la, lo)], &list![c.at(2), c.at(3)]);
    }
    let c = r.at("_b16");
    let l16: Vec<u16> = c.at(0).iter().map(|x| x.i() as u16).collect();
    pareil("_b16", &entiers(&geo::_b16(&l16)), &c.at(1));
    pareil("_h16", &u16s(&geo::_h16(&geo::_b16(&l16))), &c.at(2));
    for (i, c) in r.at("_troncs").iter().enumerate() {
        let paires: Vec<((usize, usize), Info)> =
            c.at(0).iter().map(|p| ((p.at(0).at(0).u(), p.at(0).at(1).u()), Info { royal: p.at(1).at("royal").truthy(), ferry: p.at(1).at("ferry").truthy(), drop: false })).collect();
        let mut paths: Vec<Vec<Pt>> = c.at(1).iter().map(|l| pts(&l)).collect();
        geo::_troncs(&paires, &mut paths, 0.35, 0.5);
        pareil(&format!("_troncs {i}"), &paths.iter().map(|l| pts_val(l)).collect::<Val>(), &c.at(2));
    }
}

/// La valeur d'un attribut de la carte, comme le jumeau la range (les grilles en listes d'entiers).
fn attribut(g: &GeoMap, nom: &str) -> Option<Val> {
    Some(match nom {
        "nodes" => g.nodes.clone(),
        "edges" => g.edges.clone(),
        "adj" => g.adj.clone(),
        "by_name" => g.by_name.clone(),
        "terrain" => entiers(&g.terrain),
        "dept" => entiers(&g.dept),
        "river" => entiers(&g.river),
        "road" => entiers(&g.road),
        "cellnode" => u16s(&g.cellnode),
        "ways" => g.ways.clone(),
        "edge_cum" => g.edge_cum.clone(),
        "ports" => g.ports.clone(),
        "down_nodes" => g.down_nodes.clone(),
        "dept_codes" => g.dept_codes.iter().map(Val::from).collect(),
        "playable_codes" => g.playable_codes.clone(),
        "client_payload" => g.client_payload(),
        "cell_costs" => g.cell_costs().iter().map(|&c| Val::from(c)).collect(),
        "_rivf" => entiers(g._rivf.as_ref()?),
        _ => panic!("attribut inconnu de l'essai : {nom}"),
    })
}

/// Compare une carte à sa référence : attributs (empreintes), valeurs lisibles, méthodes sur les cas du jumeau.
fn verifie(g: &GeoMap, r: &Val, d_ou: &str) {
    let v = g.version;
    let quoi = |nom: &str| format!("géographie {v} ({d_ou}) : {nom}");
    // valeurs lisibles
    let mut histo = vec![0i64; 11];
    for &t in &g.terrain {
        histo[t as usize] += 1;
    }
    let routes: Vec<Val> = g.edges.iter().filter(|e| e.get("kind") != "water").collect();
    let compte = |cle: &str| routes.iter().filter(|e| e.at(cle).truthy()).count();
    let mut playable = g.playable_codes.vec();
    playable.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let voies = Val::dict();
    for (k, w) in g.ways.items() {
        voies.set(&k, list![w.at("pts").len(), w.at("cum").at(-1), w.at("ports").len(), w.at("tidal_s")]);
    }
    let lisible = dict! {
        "version" => g.version, "suffixe" => &g.suffixe, "W" => g.W, "H" => g.H, "KX" => g.KX, "lon0" => g.lon0, "lon1" => g.lon1, "lat0" => g.lat0, "lat1" => g.lat1,
        "hash" => g._src_hash(), "noeuds" => g.nodes.len(), "aretes" => g.edges.len(), "routes" => routes.len(),
        "royales" => compte("royal"), "bacs" => compte("ferry"), "ponts" => compte("river"), "terrains" => entiers(&histo),
        "dept_codes" => attribut(g, "dept_codes"), "playable" => playable, "premiers_noeuds" => g.nodes.slice(None, Some(3)),
        "derniers_noeuds" => g.nodes.slice(Some(-2), None), "premieres_aretes" => g.edges.slice(None, Some(2)),
        "derniere_route" => routes.last().unwrap(), "derniere_arete" => g.edges.at(-1), "voies" => voies,
    };
    for (k, a) in r.at("lisible").items() {
        pareil(&quoi(&format!("{k} (lisible)")), &lisible.at(&k), &a);
    }
    assert_eq!(lisible.len(), r.at("lisible").len());
    // attributs
    let complet = std::env::var_os("CONQUETE_GEO_COMPLET").map(PathBuf::from);
    if let Some(d) = &complet {
        std::fs::create_dir_all(d).unwrap();
    }
    let mut ecarts = vec![];
    for (nom, e) in r.at("empreintes").items() {
        let Some(val) = attribut(g, nom.s()) else { continue }; // (_rivf : absent d'une carte relue du cache)
        if let Some(d) = &complet {
            std::fs::write(d.join(format!("rs_{v}_{nom}.txt")), canon(&val).replace("},{", "},\n{")).unwrap();
        }
        if json::empreinte_ordre(&val) != e.s() {
            ecarts.push(nom.string());
        }
    }
    assert!(ecarts.is_empty(), "{}", quoi(&format!("attributs différents de la référence : {ecarts:?}")));

    // projection, cases, terrain
    for c in r.at("points").iter() {
        let (x, y) = (c.at(0).f(), c.at(1).f());
        let cell = g.cell(x, y);
        let vu = list![c.at(0), c.at(1), cell, g.terrain_at(x, y), g.playable_at(x, y), g.dept_at(x, y), g.node_of_cell(x, y), g.lat_of(y), g.lon_of(x),
            pts_val(&[g.xy(g.lat_of(y), g.lon_of(x))]).at(0), if cell >= 0 { g.cell_cost(cell) } else { None }];
        pareil(&quoi("points"), &vu, &c);
    }
    for c in r.at("xy").iter() {
        let (x, y) = g.xy(c.at(0).f(), c.at(1).f());
        pareil(&quoi("xy"), &list![x, y], &c.at(2));
    }
    // tracés élémentaires
    for c in r.at("raster_line").iter() {
        let mut acc: Vec<usize> = vec![];
        g._raster_line(&pts(&c.at(0)), &mut |k| acc.push(k), c.at(1).f(), c.at(2).i());
        pareil(&quoi("_raster_line"), &entiers(&acc), &c.at(3));
    }
    for c in r.at("raster_ring").iter() {
        let mut acc: Vec<usize> = vec![];
        g._raster_ring(&pts(&c.at(0)), &mut |k| acc.push(k));
        pareil(&quoi("_raster_ring"), &entiers(&acc), &c.at(1));
    }
    let b = r.at("bfs");
    let src: Vec<usize> = b.at(0).at(0).iter().map(|x| x.u()).collect();
    assert_eq!(json::empreinte_ordre(&entiers(&g._bfs(&src, 6, None, 1))), b.at(0).at(2).s(), "{}", quoi("_bfs"));
    assert_eq!(json::empreinte_ordre(&entiers(&g._bfs(&src, 9, Some(&|c| g.terrain[c] as i64 > geo::T_EAU), 1))), b.at(1).at(2).s(), "{}", quoi("_bfs (passable)"));
    let src2: Vec<usize> = src[..5].iter().map(|c| c * 2).collect();
    assert_eq!(json::empreinte_ordre(&entiers(&g._bfs(&src2, 4, None, 2))), b.at(2).at(2).s(), "{}", quoi("_bfs (f=2)"));

    // l'eau entre deux lieux, le plus court chemin du réseau
    let lieux: Vec<Pt> = g.nodes.iter().map(|n| (n.at("x").f(), n.at("y").f())).collect();
    for c in r.at("water").iter() {
        let (a, b) = (lieux[c.at(0).u()], lieux[c.at(1).u()]);
        pareil(&quoi("_water_on_segment"), &list![g._water_on_segment(a, b, 1.2), g._water_on_segment(a, b, c.at(2).f())], &list![c.at(3), c.at(4)]);
    }
    let pairs: Pairs = routes.iter().map(|e| ((e.at("a").u(), e.at("b").u()), Info::default())).collect();
    for c in r.at("chemin").iter() {
        let vu: Val = GeoMap::_chemin(&pairs, &lieux, c.at(0).u(), c.at(1).u()).into_iter().map(|(a, b)| list![a, b]).collect();
        pareil(&quoi("_chemin"), &vu, &c.at(2));
    }

    // A* hors route
    let m = masque(&r.at("marques"));
    let bloc = |b: &Val| if b.truthy() { Some(&m[..]) } else { None };
    for (i, c) in r.at("astar").iter().enumerate() {
        let vu = g.astar(c.at(0).f(), c.at(1).f(), c.at(2).f(), c.at(3).f(), c.at(4).i(), bloc(&c.at(5)));
        pareil(&quoi(&format!("astar {i}")), &opt_pts(vu), &c.at(6));
    }
    for (i, c) in r.at("nearest_open").iter().enumerate() {
        let vu = g.nearest_open(c.at(0).f(), c.at(1).f(), &m, c.at(2).truthy(), c.at(3).i());
        pareil(&quoi(&format!("nearest_open {i}")), &opt_pts(vu), &c.at(4));
    }
    for c in r.at("line_ok").iter() {
        assert_eq!(g._line_ok(pt(&c.at(0)), pt(&c.at(1)), c.at(2).f(), bloc(&c.at(3))), c.at(4).truthy(), "{}", quoi("_line_ok"));
    }
    for c in r.at("smooth").iter() {
        pareil(&quoi("_smooth"), &pts_val(&g._smooth(pts(&c.at(0)), bloc(&c.at(1)))), &c.at(2));
    }
}

/// Le dossier de travail des caches (CONQUETE_DATA), le même pour les trois essais.
fn dossier() -> PathBuf {
    static UNE_FOIS: std::sync::Once = std::sync::Once::new();
    let d = Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    UNE_FOIS.call_once(|| {
        std::fs::create_dir_all(&d).unwrap();
        std::env::set_var("CONQUETE_DATA", &d);
    });
    d
}

/// Une géographie : générée, puis relue de son cache, puis (si on l'a) relue du cache écrit par Python.
fn geographie(v: i64) {
    let r = reference().at("cartes").at(v.to_string());
    let cache = dossier().join(format!("map_cache{}.json", if v == 3 { String::new() } else { format!("_v{v}") }));
    let _ = std::fs::remove_file(&cache); // (jamais de cache : la carte comparée est une carte générée)
    assert_eq!(geo::data_dir(), dossier());
    let t = std::time::Instant::now();
    let g = GeoMap::new(v);
    eprintln!("géographie {v} : générée en {:.2} s ({} x {}, {} lieux, {} arêtes)", t.elapsed().as_secs_f64(), g.W, g.H, g.nodes.len(), g.edges.len());
    verifie(&g, &r, "générée");
    drop(g);

    // relue du cache que le Rust vient d'écrire (le fichier n'est pas refait)
    let date = std::fs::metadata(&cache).expect("le cache n'a pas été écrit").modified().unwrap();
    let t = std::time::Instant::now();
    let g = GeoMap::new(v);
    eprintln!("géographie {v} : relue du cache en {:.2} s", t.elapsed().as_secs_f64());
    assert_eq!(std::fs::metadata(&cache).unwrap().modified().unwrap(), date, "géographie {v} : le cache du Rust n'a pas été relu");
    assert!(g._rivf.is_none());
    verifie(&g, &r, "relue du cache du Rust");
    drop(g);

    // relue du cache écrit par Python (geo_ref.py --caches dossier), puis le cache du Rust est remis
    if let Some(d) = std::env::var_os("CONQUETE_CACHE_PYTHON") {
        let du_rust = std::fs::read(&cache).unwrap();
        let de_python = std::fs::read(Path::new(&d).join(cache.file_name().unwrap())).expect("le cache de Python manque");
        std::fs::write(&cache, &de_python).unwrap();
        let date = std::fs::metadata(&cache).unwrap().modified().unwrap();
        let g = GeoMap::new(v);
        assert_eq!(std::fs::metadata(&cache).unwrap().modified().unwrap(), date, "géographie {v} : le cache de Python n'a pas été relu (empreinte des sources différente ?)");
        assert!(g._rivf.is_none());
        verifie(&g, &r, "relue du cache de Python");
        std::fs::write(&cache, du_rust).unwrap();
        eprintln!("géographie {v} : relue du cache de Python, identique");
    }
}

#[test]
fn geographie_1() {
    geographie(1)
}
#[test]
fn geographie_2() {
    geographie(2)
}
#[test]
fn geographie_3() {
    geographie(3)
}
