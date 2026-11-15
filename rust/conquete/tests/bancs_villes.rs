//! Banc des villes et des places du générateur de cartes (tactics/terrain.rs, SPEC-2D § 6) : portage de
//! tests/test_villes.py.
//!
//! POURQUOI CE BANC EXISTE. Le client dessine les bourgs, les villes et les places fortes d'après la carte du moteur :
//! îlots de maisons sur rue, grand-place et église, enceinte médiévale ou tracé bastionné, et chaque bâtiment avec sa
//! nature (`batis[].kind`) et sa couverture (`toit`). Les cases doivent rester cohérentes avec les règles du moteur
//! (murs, portes, rues, maisons) : l'assaillant entre par les portes ou les brèches, jamais par un trou du mur.

mod fabrique_campagne;

use conquete::dict;
use conquete::geo::GeoMap;
use conquete::py::{self, Val};
use conquete::tactics::terrain::{self as TR, BattleMap};
use fabrique_campagne::GEO; // (le Sud-Ouest des anciennes parties ; toute la France : bancs_france.rs)
use std::collections::{BTreeSet, HashMap};

const RUE: [i64; 4] = [TR::T_ROUTE, TR::T_CHEMIN, TR::T_PORTE, TR::T_BRECHE];

fn noeud(geo: &GeoMap, typ: &str, k: usize) -> Val {
    geo.nodes.iter().filter(|n| n.at("type") == typ).nth(k).unwrap()
}

/// `carte(n, fort=0, seed=700, battle=True, dmg=0.0)`
fn carte(geo: &GeoMap, n: &Val, fort: i64, seed: i64, battle: bool, dmg: f64) -> BattleMap {
    let pl = dict! {"nid" => n.at("id"), "name" => n.at("name"), "type" => n.at("type"), "fort" => fort, "dmg" => dmg, "bar" => 0.0,
        "pop" => n.at("pop0"), "x" => n.at("x"), "y" => n.at("y"), "battle" => battle};
    let spec = dict! {"seed" => seed, "cx" => n.at("x"), "cy" => n.at("y"), "season" => "ete", "weather" => "soleil", "year" => 1790,
        "place" => pl, "att_angle" => 0.5, "carte" => TR::VERSION};
    TR::generate(geo, &spec)
}

fn c(geo: &GeoMap, n: &Val, fort: i64) -> BattleMap {
    carte(geo, n, fort, 700, true, 0.0)
}

fn voisins(c: i64, diag: bool) -> Vec<i64> {
    let i = c % TR::COLS;
    let mut out = vec![c - TR::COLS, c + TR::COLS];
    if i != 0 {
        out.push(c - 1);
    }
    if i < TR::COLS - 1 {
        out.push(c + 1);
    }
    if diag {
        if i != 0 {
            out.extend([c - TR::COLS - 1, c + TR::COLS - 1]);
        }
        if i < TR::COLS - 1 {
            out.extend([c - TR::COLS + 1, c + TR::COLS + 1]);
        }
    }
    out.into_iter().filter(|&v| 0 <= v && v < TR::N).collect()
}

fn flood(m: &BattleMap, c0: i64, ok: impl Fn(i64) -> bool, diag: bool) -> BTreeSet<i64> {
    let mut seen = BTreeSet::from([c0]);
    let mut todo = vec![c0];
    while let Some(c) = todo.pop() {
        for v in voisins(c, diag) {
            if !seen.contains(&v) && ok(m.t[v as usize] as i64) {
                seen.insert(v);
                todo.push(v);
            }
        }
    }
    seen
}

fn bati_en_ville(m: &BattleMap) -> Vec<i64> {
    let pl = &m.place;
    (0..TR::N)
        .filter(|&c| {
            let (x, y) = TR::center_of(c as usize);
            m.t[c as usize] as i64 == TR::T_BATI
                && py::pow(py::pow(x - pl.atf("x"), 2.0) + py::pow(y - pl.atf("y"), 2.0), 0.5) < m.town_r * 1.05
        })
        .collect()
}

fn forts(geo: &GeoMap) -> Vec<Val> {
    let mut v: Vec<Val> = geo.nodes.iter().filter(|n| n.at("type") == "fort").take(4).collect();
    v.push(noeud(geo, "capitale", 1));
    v.push(noeud(geo, "capitale", 3));
    v
}

fn cases(m: &BattleMap, t: i64) -> BTreeSet<i64> {
    (0..TR::N).filter(|&c| m.t[c as usize] as i64 == t).collect()
}

// ------------------------------------------------------------------ Villes

#[test]
fn la_ville_a_la_taille_de_son_plan() {
    // (version 4 : la taille est celle du plan de « Voir l'intérieur » ; le générateur d'avant faisait grandir le
    // rayon du village à la capitale, ce que les vrais plans, réduits pour tenir sur le champ, ne promettent plus)
    let geo = GEO();
    let mut nb = Vec::new();
    for typ in ["village", "ville", "capitale"] {
        // (géographie 2 : Mont-de-Marsan, la troisième capitale, n'a plus que 45 îlots sur le champ)
        let m = carte(&geo, &noeud(&geo, typ, 0), 0, 700, false, 0.0);
        assert_eq!(m.town.at("type"), typ);
        assert!(m.plan.truthy() && m.plan.at("ilots").truthy(), "{typ}");
        assert!(!bati_en_ville(&m).is_empty(), "{typ}");
        nb.push(m.plan.at("ilots").len());
    }
    assert!(nb[0] < nb[2], "îlots {nb:?}");
}

#[test]
fn chaque_batiment_a_sa_nature_et_son_toit() {
    let geo = GEO();
    let f = forts(&geo);
    for (n, fort) in [(noeud(&geo, "village", 5), 0), (noeud(&geo, "ville", 3), 1), (noeud(&geo, "capitale", 1), 4), (f[2].clone(), 2)] {
        let m = c(&geo, &n, fort);
        let d = m.to_client(&dict! {"seed" => 1, "season" => "ete", "weather" => "soleil", "cx" => 0, "cy" => 0});
        let mut vus = BTreeSet::new();
        for b in d.at("batis").iter() {
            assert!(TR::KINDS.contains(&b.at("kind").s()));
            assert!(["ardoise", "tuile", "canal", "chaume"].contains(&b.at("toit").s()));
            assert!(b.at("c").iter().all(|c| m.t[c.u()] as i64 == TR::T_BATI));
            vus.extend(b.at("c").iter().map(|c| c.i()));
        }
        assert_eq!(vus, cases(&m, TR::T_BATI), "toute case bâtie a son bâtiment");
        assert!(d.at("buildings").iter().all(|b| b.has("toit")));
        let kinds: BTreeSet<String> = d.at("batis").iter().map(|b| b.ats("kind")).collect();
        assert!(kinds.contains("eglise") || kinds.contains("cathedrale"), "{} : une église", n.at("name"));
        if n.at("type") == "capitale" {
            // (version 4 : les édifices du plan ; ni poudrière, ni toujours la cathédrale)
            assert!(["hotel", "caserne", "couvent"].iter().all(|k| kinds.contains(*k)), "{kinds:?}");
        }
        assert_eq!(d.at("town").at("siecle"), 18);
    }
}

#[test]
fn place_forte_bastionnee() {
    let geo = GEO();
    for n in forts(&geo) {
        let name = n.ats("name");
        let m = c(&geo, &n, 3);
        assert_eq!(m.walls.at(-1).at("kind"), "bastion", "{name}");
        assert!(m.bastions.len() >= 25, "cinq sommets par front au moins");
        assert_eq!(m.demi_lunes.len(), 0, "pas de demi-lune au niveau 3, comme sur la carte");
        let m = c(&geo, &n, 4);
        assert_eq!(m.demi_lunes.len(), m.bastions.len() / 5, "au niveau 4, une demi-lune devant chaque front");
        let portes = cases(&m, TR::T_PORTE);
        assert!(!portes.is_empty(), "{name}");
        // chaque route qui entre dans la place passe une porte
        let dedans = TR::_dedans(&TR::pts_de(&m.bastions));
        let dd = |c: i64| dedans(c as usize);
        for r in m.roads.iter() {
            let cells = TR::_poly_cells(&TR::pts_de(&r.at("pts")));
            if cells.iter().any(|&c| dedans(c)) && !cells.iter().all(|&c| dedans(c)) {
                assert!(cells.iter().any(|&c| m.t[c] as i64 == TR::T_PORTE), "{name} : route sans porte");
            }
        }
        // les rues tiennent ensemble : de la grand-place, on gagne chaque porte et presque toute la ville
        let c0 = TR::cell_of(m.place.atf("x"), m.place.atf("y"));
        let mut reseau = flood(&m, c0, |tc| RUE.contains(&tc), false);
        // (les portes du corps de place ; celles d'une demi-lune peuvent être sur une route qui longe la place)
        let corps: BTreeSet<i64> = portes.iter().copied().filter(|&c| dd(c) || voisins(c, false).into_iter().any(dd)).collect();
        assert!(!corps.is_empty(), "{name}");
        assert!(corps.is_subset(&reseau), "{name} : {} portes hors des rues", corps.difference(&reseau).count());
        let rues: Vec<i64> = (0..TR::N).filter(|&c| m.t[c as usize] as i64 == TR::T_ROUTE && dd(c)).collect();
        // (la Dordogne passe dans la place à Domme : les rues d'en face)
        reseau.extend(flood(&m, c0, |tc| RUE.contains(&tc) || tc == TR::T_EAU, false));
        let k = rues.iter().filter(|c| reseau.contains(c)).count() as f64 / rues.len() as f64;
        assert!(k > 0.95, "{name}");
    }
}

#[test]
fn les_murs_ferment_la_ville() {
    let geo = GEO();
    let f = forts(&geo);
    let mut cas: Vec<(Val, i64)> = f[..3].iter().map(|n| (n.clone(), 2)).collect();
    cas.push((noeud(&geo, "ville", 4), 1));
    cas.push((noeud(&geo, "ville", 6), 2));
    for (n, fort) in cas {
        let m = c(&geo, &n, fort);
        let c0 = TR::cell_of(m.place.atf("x"), m.place.atf("y"));
        // (en 8 voisins, comme les troupes : pas de trou en diagonale ; l'eau est un obstacle à part)
        let ville = flood(&m, c0, |tc| ![TR::T_MUR, TR::T_PORTE, TR::T_EAU].contains(&tc), true);
        let bord = ville.iter().filter(|&&c| [0, TR::COLS - 1].contains(&(c % TR::COLS)) || [0, TR::ROWS - 1].contains(&(c / TR::COLS))).count();
        assert_eq!(bord, 0, "{} : l'enceinte a un trou", n.at("name"));
        // (les maisons de la ville dans les murs ; les faubourgs les touchent dehors, version 7 : bastide de Domme)
        let pl = &m.place;
        let coeur: Vec<i64> = bati_en_ville(&m)
            .into_iter()
            .filter(|&c| {
                let (x, y) = TR::center_of(c as usize);
                py::hypot(x - pl.atf("x"), y - pl.atf("y")) < 0.5 * m.town_r
            })
            .collect();
        assert!(coeur.iter().all(|c| ville.contains(c)), "{} : des maisons hors les murs", n.at("name"));
    }
}

#[test]
fn pas_de_maison_sur_une_rue() {
    let geo = GEO();
    let f = forts(&geo);
    // (pas Beynac : au pied du château, la Dordogne prend sa place bastionnée ; ni La Réole, au bord de la Garonne : 94,9 % sur rue)
    for (n, fort) in [(noeud(&geo, "village", 7), 0), (noeud(&geo, "ville", 0), 1), (noeud(&geo, "capitale", 0), 4), (f[3].clone(), 3)] {
        let m = c(&geo, &n, fort);
        for r in m.roads.iter() {
            if r.at("kind") != "chemin" {
                let sur: Vec<usize> = TR::_poly_cells(&TR::pts_de(&r.at("pts"))).into_iter().filter(|&c| m.t[c] as i64 == TR::T_BATI).collect();
                assert!(sur.is_empty(), "{}", n.at("name"));
            }
        }
        // les maisons de la ville sont sur rue (les cours et jardins au milieu des îlots)
        let mut g: HashMap<i64, String> = HashMap::new();
        for b in m.batis.iter() {
            for c in b.at("c").iter() {
                g.insert(c.i(), b.ats("kind"));
            }
        }
        let maisons: Vec<i64> = bati_en_ville(&m).into_iter().filter(|c| g[c] == "maison").collect();
        let sur_rue = maisons.iter().filter(|&&c| voisins(c, false).iter().any(|&v| [TR::T_ROUTE, TR::T_CHEMIN].contains(&(m.t[v as usize] as i64)))).count();
        assert!(sur_rue as f64 / maisons.len() as f64 > 0.95, "{}", n.at("name"));
    }
}

#[test]
fn breche_du_siege() {
    let geo = GEO();
    let m = carte(&geo, &forts(&geo)[2], 3, 700, true, 0.5);
    assert!(m.walls.at(-1).at("breach").truthy());
    assert!(m.t.contains(&(TR::T_BRECHE as u8)));
}

#[test]
fn meme_graine_meme_ville() {
    let geo = GEO();
    let n = noeud(&geo, "capitale", 1);
    let (a, b) = (carte(&geo, &n, 4, 9, true, 0.0), carte(&geo, &n, 4, 9, true, 0.0));
    assert_eq!(a.t, b.t);
    assert_eq!(
        (&a.batis, &a.bastions, &a.demi_lunes, &a.walls, &a.buildings),
        (&b.batis, &b.bastions, &b.demi_lunes, &b.walls, &b.buildings)
    );
    assert_ne!(a.t, carte(&geo, &n, 4, 10, true, 0.0).t);
}

#[test]
fn vite() {
    let geo = GEO();
    let f = forts(&geo);
    let t0 = std::time::Instant::now();
    let cas = [(noeud(&geo, "village", 1), 0), (noeud(&geo, "ville", 1), 2), (f[0].clone(), 4), (noeud(&geo, "capitale", 0), 4)];
    for (n, fort) in &cas {
        c(&geo, n, *fort);
    }
    assert!(t0.elapsed().as_secs_f64() / (cas.len() as f64) < 0.5, "moins d’une demi-seconde par carte sur un PC");
}
