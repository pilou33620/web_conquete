//! jsmath, plan_ville et plan_organique contre Python : tests/references/plans.json est écrit par le jumeau
//! outils/jumeau/plans_ref.py. Tout est comparé exactement (bits des flottants, empreintes ordonnées des plans).
//!
//! Pour chercher un écart dans un plan : `PLANS_FORMES=dossier` des deux côtés (le jumeau et cet essai) range la forme
//! complète de chaque plan de `plan_organique` (`<rang>.v.json`, `<rang>.o.json`), à comparer.
#![allow(non_snake_case)]

use conquete::py::{self, json, Random, Val};
use conquete::tactics::{jsmath as JM, plan_organique as PO, plan_ville as PV};
use conquete::{dict, list};

fn reference() -> Val {
    json::loads(include_str!("references/plans.json")).unwrap()
}

/// Égalité stricte de deux valeurs : mêmes bits pour les nombres (5 vaut 5.0, mais 0.0 n'est pas -0.0), mêmes clés
/// dans le même ordre ; une liste vaut un tuple (la référence est passée par JSON).
fn egal(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::None, Val::None) => true,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        (Val::Str(x), Val::Str(y)) => x == y,
        (Val::List(_) | Val::Tuple(_), Val::List(_) | Val::Tuple(_)) => a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| egal(&x, &y)),
        (Val::Dict(_), Val::Dict(_)) => a.len() == b.len() && a.items().iter().zip(b.items().iter()).all(|((k, x), (l, y))| k == l && egal(x, y)),
        (Val::Int(_) | Val::Float(_), Val::Int(_) | Val::Float(_)) => a.f().to_bits() == b.f().to_bits(),
        _ => false,
    }
}
#[track_caller]
fn verifier(quoi: &str, vu: impl Into<Val>, attendu: &Val) {
    let vu = vu.into();
    assert!(egal(&vu, attendu), "{quoi} :\n vu      {}\n attendu {}", vu.repr(), attendu.repr());
}
fn nombres(v: &[f64]) -> Val {
    v.iter().map(|x| Val::from(*x)).collect()
}

// ---------------------------------------------------------------------- jsmath
fn echelle(g: &mut Random, a: i64, b: i64) -> f64 {
    let u = g.uniform(-1.0, 1.0);
    u * py::ldexp(1.0, g.randint(a, b) as i32)
}

#[test]
fn jsmath_sur_des_milliers_de_cas() {
    let r = reference().at("jsmath");
    // les mêmes tirages, dans le même ordre, que le jumeau
    let mut g = Random::new(20261115);
    let angles: Vec<f64> = (0..2000).map(|_| echelle(&mut g, -30, 21)).collect();
    let paires: Vec<[f64; 2]> = (0..2000).map(|_| [echelle(&mut g, -20, 20), echelle(&mut g, -20, 20)]).collect();
    let triples: Vec<[f64; 3]> = (0..500).map(|_| [g.uniform(-1000.0, 1000.0), g.uniform(-1000.0, 1000.0), g.uniform(-1000.0, 1000.0)]).collect();
    let mut ronds: Vec<f64> = (0..1500).map(|_| g.uniform(-1e6, 1e6)).collect();
    ronds.extend((0..500).map(|_| g.randint(-1_000_000, 1_000_000) as f64 + 0.5));
    let mut h2: Vec<[i64; 3]> = (0..1500).map(|_| [g.randint(-(1 << 31), (1 << 31) - 1), g.randint(-1_000_000, 1_000_000), g.randint(0, (1 << 32) - 1)]).collect();
    h2.extend((0..500).map(|_| [g.randint(-(1 << 40), 1 << 40), g.randint(-(1 << 33), 1 << 33), g.randint(0, 1 << 34)]));
    let graines: Vec<i64> = (0..40).map(|_| g.randint(0, (1 << 32) - 1)).collect();
    let entrees = list![
        nombres(&angles),
        paires.iter().map(|p| nombres(p)).collect::<Val>(),
        triples.iter().map(|t| nombres(t)).collect::<Val>(),
        nombres(&ronds),
        h2.iter().map(|t| t.iter().map(|x| Val::from(*x)).collect::<Val>()).collect::<Val>(),
        graines.iter().map(|x| Val::from(*x)).collect::<Val>(),
    ];
    assert_eq!(json::empreinte(&entrees), r.at("entrees").s(), "les entrées tirées ne sont pas celles du jumeau");

    let liste = |nom: &str, vu: Vec<f64>| {
        let att = r.at(nom);
        assert_eq!(vu.len(), att.len(), "{nom}");
        for (k, x) in vu.iter().enumerate() {
            assert!(x.to_bits() == att.at(k).f().to_bits(), "{nom}[{k}] : vu {x:?}, attendu {:?}", att.at(k).f());
        }
    };
    liste("sin", angles.iter().map(|x| JM::sin(*x)).collect());
    liste("cos", angles.iter().map(|x| JM::cos(*x)).collect());
    liste("atan", angles.iter().map(|x| JM::atan(*x)).collect());
    liste("atan2", paires.iter().map(|p| JM::atan2(p[0], p[1])).collect());
    liste("hypot", paires.iter().map(|p| JM::hypot(p[0], p[1])).collect());
    liste("hypot_n", triples.iter().map(|t| JM::hypot_n(t)).collect());
    liste("hash2", h2.iter().map(|t| JM::hash2(t[0], t[1], t[2])).collect());
    for (k, x) in ronds.iter().enumerate() {
        assert_eq!(JM::jround(*x), r.at("jround").at(k).i(), "jround({x:?})");
    }
    for (k, a) in graines.iter().enumerate() {
        let mut R = JM::alea(*a);
        verifier(&format!("alea({a})"), nombres(&(0..25).map(|_| R.R()).collect::<Vec<f64>>()), &r.at("alea").at(k));
    }
}

#[test]
fn jsmath_aux_limites() {
    let l = reference().at("jsmath").at("limites");
    for c in l.at("un").iter() {
        let x = c.at(0).f();
        verifier(&format!("sin, cos, atan de {x:?}"), list![x, JM::sin(x), JM::cos(x), JM::atan(x)], &c);
    }
    for c in l.at("deux").iter() {
        let (y, x) = (c.at(0).f(), c.at(1).f());
        verifier(&format!("atan2, hypot de {y:?}, {x:?}"), list![y, x, JM::atan2(y, x), JM::hypot(y, x)], &c);
    }
    for c in l.at("hypot_n").iter() {
        let t: Vec<f64> = c.at(0).iter().map(|x| x.f()).collect();
        verifier(&format!("hypot_n {t:?}"), JM::hypot_n(&t), &c.at(1));
    }
    for c in l.at("jround").iter() {
        assert_eq!(JM::jround(c.at(0).f()), c.at(1).i(), "jround({:?})", c.at(0).f());
    }
    for c in l.at("hash2").iter() {
        verifier(&format!("hash2 {c:?}"), JM::hash2(c.at(0).i(), c.at(1).i(), c.at(2).i()), &c.at(3));
    }
    for c in l.at("alea").iter() {
        let mut R = JM::alea(c.at(0).i());
        verifier(&format!("alea({})", c.at(0)), nombres(&(0..5).map(|_| R.R()).collect::<Vec<f64>>()), &c.at(1));
    }
    for c in l.at("hashS").iter() {
        assert_eq!(JM::hashS(c.at(0).s()), c.at(1).i(), "hashS({:?})", c.at(0));
    }
    // (valeurs de Node 22, celles du banc tests/test_plan_ville.py)
    let mut R = JM::alea(1234567);
    assert_eq!([R.R(), R.R(), R.R()], [0.6074679309967905, 0.19144689152017236, 0.43751312675885856]);
    assert_eq!(JM::hashS("bayonne"), 2881610187);
    assert_eq!(JM::hash2(3, -7, 2881610187), 0.812592493603006);
    assert_eq!(JM::hypot(3.1, 4.7), 5.630275304103699);
    assert_eq!(JM::sin(2.8966139904629276), 0.24253562503633447);
    assert_eq!(JM::atan2(0.25, -0.97), 2.8893501956999748);
    assert_eq!((JM::jround(2.5), JM::jround(-2.5)), (3, -2));
}

// ---------------------------------------------------------------------- la carte relue de sa forme rangée
/// Ce que plan_ville::Carte lit d'une GeoMap : la classe Geo du jumeau.
struct GeoEssai {
    W: i64,
    H: i64,
    terrain: Vec<u8>,
    nodes: Val,
    edges: Val,
    src: Val,
    lon0: f64,
    lat1: f64,
    KX: f64,
    KY: f64,
}

impl PV::Geo for GeoEssai {
    fn W(&self) -> i64 {
        self.W
    }
    fn H(&self) -> i64 {
        self.H
    }
    fn terrain(&self) -> &[u8] {
        &self.terrain
    }
    fn nodes(&self) -> Val {
        self.nodes.clone()
    }
    fn edges(&self) -> Val {
        self.edges.clone()
    }
    fn src(&self) -> Val {
        self.src.clone()
    }
    fn xy(&self, lat: f64, lon: f64) -> (f64, f64) {
        ((lon - self.lon0) * self.KX, (self.lat1 - lat) * self.KY)
    }
}

/// Des entiers de proche en proche aux points [x, y] (`decode` du jumeau).
fn decode(d: &Val, k: f64) -> Val {
    let pts = list![];
    let (mut x, mut y) = (0i64, 0i64);
    let d: Vec<i64> = d.iter().map(|v| v.i()).collect();
    for p in d.chunks(2) {
        x += p[0];
        y += p[1];
        pts.push(list![x as f64 / k, y as f64 / k]);
    }
    pts
}

fn geo(r: &Val) -> GeoEssai {
    let c = r.at("carte");
    let mut terrain = vec![];
    let plages: Vec<i64> = c.at("terrain").iter().map(|v| v.i()).collect();
    for p in plages.chunks(2) {
        terrain.extend(std::iter::repeat(p[0] as u8).take(p[1] as usize));
    }
    let edges: Val = c.at("edges").iter().map(|e| dict! { "a" => e.at("a"), "b" => e.at("b"), "royal" => e.at("royal"), "pts" => decode(&e.at("d"), 100.0) }).collect();
    let rivers: Val = c.at("rivers").iter().map(|e| dict! { "name" => e.at("name"), "rank" => e.at("rank"), "pts" => decode(&e.at("d"), 10000.0) }).collect();
    GeoEssai {
        W: c.at("W").i(),
        H: c.at("H").i(),
        terrain,
        nodes: c.at("nodes"),
        edges,
        src: dict! { "rivers" => rivers },
        lon0: c.at("lon0").f(),
        lat1: c.at("lat1").f(),
        KX: c.at("KX").f(),
        KY: c.at("KY").f(),
    }
}

#[test]
fn la_carte() {
    let r = reference();
    let G = geo(&r);
    let K = PV::carte_de(&G);
    assert!(std::rc::Rc::ptr_eq(&K, &PV::carte_de(&G)), "la même carte pour la même GeoMap");
    let c = r.at("Carte");
    assert_eq!(K.TER.len() as i64, K.GW * K.GH);
    assert_eq!(json::empreinte_ordre(&K.rivers), c.at("rivers").s());
    verifier("les premiers points de la première rivière", K.rivers.at(0).at("pts").slice(None, Some(5)), &c.at("riviere0"));
    verifier("y_mont", K.y_mont, &c.at("y_mont"));
    assert_eq!(K.noeud.len() as i64, c.at("noeuds").i());
    for t in c.at("ter").iter() {
        let (x, y) = t.xy();
        verifier(&format!("ter et eauK en {x}, {y}"), list![x, y, K.ter(x, y), K.eauK(x, y)], &t);
    }
}

// ---------------------------------------------------------------------- les plans
/// Le plan sans le plan organique qu'il garde (`sans` du jumeau ; la fonction V['eau'] du Python est PV::eau).
fn sans(V: &Val) -> Val {
    let c = V.copy();
    c.pop("org");
    c
}

fn formes(nom: &str, v: &Val) {
    if let Ok(d) = std::env::var("PLANS_FORMES") {
        std::fs::write(format!("{d}/{nom}.json"), json::dumps_ref_ordre(v)).unwrap();
    }
}

/// Un cas du jumeau, [nid, année, f, pop, d, résultats] : ses écarts.
fn cas(K: &PV::Carte, rang: usize, c: &Val) -> Vec<String> {
    let (nid, r) = (c.at(0).i(), c.at(5));
    let n = K.noeud.at(nid);
    let Pf = PV::profil_ville(K, &n, c.at(1), c.at(2), c.at(3), c.at(4));
    let V = PV::generer_interieur(K, &Pf);
    let vus = dict! { "v" => json::empreinte_ordre(&sans(&V)), "modele" => Pf.at("modele"), "R" => Pf.at("R"), "ilots" => V.at("ilots").len() };
    if r.has("o") {
        formes(&format!("{rang}.v"), &sans(&V));
        let sondes: Vec<(f64, f64)> =
            [-320.0, -150.0, -40.0, 0.0, 40.0, 150.0, 320.0].iter().flat_map(|dx| [-240.0, -60.0, 0.0, 60.0, 240.0].map(|dy| (PV::IC.0 + dx, PV::IC.1 + dy))).collect();
        vus.update(&dict! {
            "pf" => json::empreinte_ordre(&Pf), "murs" => Pf.at("murs"), "rMur" => V.at("rMur"), "rues" => V.at("rues").len(), "plus" => V.at("plus").len(),
            "eau" => sondes.iter().map(|(x, y)| if PV::eau(K, &V, *x, *y) { '1' } else { '0' }).collect::<String>(),
        });
        let O = PO::plan_organique(K, &V);
        assert!(O.is(&V.at("org")), "le plan organique est gardé dans V");
        formes(&format!("{rang}.o"), &O);
        vus.set("o", json::empreinte_ordre(&O));
        if O.truthy() {
            let types = Val::dict();
            for il in O.at("ilots").iter() {
                types.set(il.at("type"), types.get_or(il.at("type"), 0) + 1);
            }
            let tries = Val::dict();
            for k in py::sorted_by_key(types.keys(), |k| k.string()) {
                tries.set(&k, types.at(&k));
            }
            let mur = O.at("mur");
            vus.update(&dict! { "o_ilots" => O.at("ilots").len(), "o_types" => tries, "o_axes" => O.at("axes").len(), "o_mur" => if mur.truthy() { mur.at("kind") } else { mur } });
        }
    }
    let mut ecarts = vec![];
    for (k, att) in r.items() {
        if !vus.has(&k) || !egal(&vus.at(&k), &att) {
            ecarts.push(format!("{} ({}, {}) {k} : vu {}, attendu {}", n.at("name"), c.at(1), c.slice(Some(2), Some(5)), vus.get(&k).repr(), att.repr()));
        }
    }
    if vus.len() != r.len() {
        ecarts.push(format!("{} : {} valeurs vues, {} attendues", n.at("name"), vus.len(), r.len()));
    }
    ecarts
}

fn tous_les_cas(nom: &str) {
    let r = reference();
    let G = geo(&r);
    let K = PV::carte_de(&G);
    let liste = r.at(nom);
    let ecarts: Vec<String> = liste.iter().enumerate().flat_map(|(rang, c)| cas(&K, rang, &c)).collect();
    assert!(ecarts.is_empty(), "{} écarts sur {} plans :\n{}", ecarts.len(), liste.len(), ecarts.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
}

#[test]
fn plan_ville_de_toutes_les_places() {
    tous_les_cas("plan_ville");
}

#[test]
fn plan_organique_des_villes() {
    tous_les_cas("plan_organique");
}

/// dist_poly rend NaN (comme en JS) et le tri des îlots au bord de l'eau laisse la liste telle quelle : Bordeaux sur
/// sa rivière, un point doublé (le jumeau fait la même carte).
#[test]
fn une_riviere_a_deux_points_confondus() {
    let r = reference();
    let G = geo(&r);
    let d = r.at("point_double");
    let pts = G.src.at("rivers").at(d.at("riviere").i()).at("pts");
    pts.insert(d.at("rang").i(), pts.at(d.at("rang").i()).copy());
    let K = PV::Carte::new(&G);
    let Pf = PV::profil_ville(&K, &K.noeud.at(0), 1789, Val::None, Val::None, 0);
    assert!(PV::dist_poly(&PV::pts_de(&Pf.at("rivs").at(0).at("pts")), PV::IC.0, PV::IC.1).is_nan());
    let ecarts: Vec<String> = d.at("cas").iter().enumerate().flat_map(|(k, c)| cas(&K, 1000 + k, &c)).collect();
    assert!(ecarts.is_empty(), "{}", ecarts.join("\n"));
}

#[test]
fn les_plans_gardes() {
    let r = reference();
    let G = geo(&r);
    let K = PV::carte_de(&G);
    let g = r.at("gardes");
    let tous = r.at("plan_ville");
    for nid in 0..70 {
        let V = PV::plan(&G, nid, 1789, Val::None, Val::None, 0);
        let meme = V.is(&PV::plan(&G, nid, 1795, Val::None, Val::None, 0)) && json::empreinte_ordre(&sans(&V)) == tous.at(3 * nid).at(5).at("v").s();
        assert_eq!(meme, g.at("memes").at(nid).truthy(), "le plan gardé de la place {nid}");
    }
    assert_eq!(json::dumps_ref_ordre(&Val::list(K.plans.keys())), json::dumps_ref_ordre(&g.at("cles")), "les 64 plans gardés");
    for c in g.at("organiques").iter() {
        let nid = c.at(0).i();
        let O = PO::plan(&G, nid, 1870, 1, Val::None, 0);
        let vu = list![nid, O.is(&PO::plan(&G, nid, 1870, 1, Val::None, 0)), O.is(&PV::plan(&G, nid, 1870, 1, Val::None, 0).at("org")), json::empreinte_ordre(&O)];
        verifier("le plan organique gardé", vu, &c);
    }
}

// ---------------------------------------------------------------------- les fonctions intermédiaires
#[test]
fn plan_ville_fonctions() {
    let r = reference();
    let p = r.at("pv");
    for c in p.at("mod").iter() {
        verifier("mod", PV::mod_(c.at(0).f(), c.at(1).f()), &c.at(2));
    }
    for c in p.at("clamp").iter() {
        verifier("clamp", PV::clamp(c.at(0).f(), c.at(1).f(), c.at(2).f()), &c.at(3));
    }
    assert_eq!((PV::clamp(5, 4, 9), PV::clamp(12, 4, 9), PV::clamp(1, 4, 9)), (5, 9, 4));
    for c in p.at("lerp").iter() {
        verifier("lerp", PV::lerp(c.at(0).f(), c.at(1).f(), c.at(2).f()), &c.at(3));
    }
    for c in p.at("ang_diff").iter() {
        verifier("ang_diff", PV::ang_diff(c.at(0).f(), c.at(1).f()), &c.at(2));
    }
    for c in p.at("aire").iter() {
        verifier("aire", PV::aire(&PV::pts_de(&c.at(0))), &c.at(1));
    }
    for c in p.at("dist_poly").iter() {
        let d = PV::dist_poly(&PV::pts_de(&c.at(0)), c.at(1).f(), c.at(2).f());
        if c.at(3).is_none() {
            assert!(d.is_nan(), "dist_poly sur deux points confondus");
        } else {
            verifier("dist_poly", d, &c.at(3));
        }
    }
    for c in p.at("bastions").iter() {
        let t = PV::bastions(c.at(0).f(), c.at(1).f(), c.at(2).i(), c.at(3).f(), c.at(4).f());
        assert_eq!(json::empreinte_ordre(&t), c.at(5).s(), "bastions à {} côtés", c.at(2));
        verifier("bastions", list![t.at("poly").slice(None, Some(3)), t.at("ravs").at(0), t.at("cotes").at(-1)], &c.slice(Some(6), None));
    }
    let G = geo(&r);
    verifier("style_de", G.nodes.iter().map(|n| Val::from(PV::style_de(&n))).collect::<Val>(), &p.at("style_de"));
    for c in p.at("ere").iter() {
        assert_eq!(PV::ere(c.at(0).i()), c.at(1).i());
    }
    for c in p.at("rayon").iter() {
        assert_eq!(PV::rayon(c.at(0).f()), c.at(1).i(), "rayon({})", c.at(0));
    }
    verifier("constantes", dict! { "S" => PV::S, "IW" => PV::IW, "IH" => PV::IH, "IC" => PV::IC, "TAU" => PV::TAU, "M" => PV::M }, &p.at("constantes"));
}

#[test]
fn plan_organique_fonctions() {
    let r = reference();
    let p = r.at("po");
    let pts = |v: &Val| PO::pts_de(v);
    let pt = |v: &Val| -> PO::Pt { [v.at(0).f(), v.at(1).f()] };
    let t = p.at("TABLE");
    // (la somme pondérée des 65 536 valeurs, exacte : voir le jumeau)
    let somme: i64 = PO::TABLE().iter().enumerate().map(|(i, v)| (i as i64 % 251 + 1) * (v * 4294967296.0) as i64).sum();
    assert_eq!(somme, t.at("somme").i(), "TABLE");
    verifier("TABLE", list![nombres(&PO::TABLE()[..8]), nombres(&PO::TABLE()[65532..])], &list![t.at("debut"), t.at("fin")]);
    for c in p.at("bruit").iter() {
        verifier("bruit", PO::bruit(c.at(0).f(), c.at(1).f(), c.at(2).f(), c.at(3).f()), &c.at(4));
    }
    for c in p.at("bruit0").iter() {
        verifier("bruit", PO::bruit(c.at(0).f(), c.at(1).f(), 0.4, 0.0), &c.at(2));
    }
    for c in p.at("aire").iter() {
        verifier("aire", PO::aire(&pts(&c.at(0))), &c.at(1));
    }
    for c in p.at("centre").iter() {
        verifier("centre", nombres(&PO::centre(&pts(&c.at(0)))), &c.at(1));
    }
    for c in p.at("normales").iter() {
        verifier("normales", PO::normales(&pts(&c.at(0))).into_iter().map(Val::from).collect::<Val>(), &c.at(1));
    }
    for c in p.at("lerp").iter() {
        verifier("lerp", nombres(&PO::lerp(pt(&c.at(0)), pt(&c.at(1)), c.at(2).f())), &c.at(3));
    }
    for c in p.at("dist_seg").iter() {
        let (x, y, a, b) = (c.at(0).f(), c.at(1).f(), pt(&c.at(2)), pt(&c.at(3)));
        verifier("dist_seg, d_seg", list![PO::dist_seg(x, y, a, b), PO::d_seg(x, y, a, b)], &c.slice(Some(4), None));
    }
    for c in p.at("dans_poly").iter() {
        let q = pts(&c.at(0));
        for s in c.at(1).iter() {
            assert_eq!(PO::dans_poly(&q, s.at(0).f(), s.at(1).f()), s.at(2).truthy(), "dans_poly");
        }
    }
    for c in p.at("couper").iter() {
        let (q, nx, ny, k) = (pts(&c.at(0)), c.at(2).f(), c.at(3).f(), c.at(4).f());
        let (Q, U) = PO::couper(&q, &c.at(1).vec(), nx, ny, k, c.at(5));
        verifier("couper", list![PO::pts_val(&Q), U], &c.at(6));
    }
    for c in p.at("rentrer").iter() {
        let ds: Vec<f64> = c.at(2).iter().map(|d| d.f()).collect();
        let vu = match PO::rentrer(&pts(&c.at(0)), &c.at(1).vec(), |i| ds[i]) {
            Some((Q, U)) => list![PO::pts_val(&Q), U],
            None => Val::None,
        };
        verifier("rentrer", vu, &c.at(3));
    }
    for c in p.at("ecart").iter() {
        let (ws, demi) = (c.at(1), c.at(2));
        let l = PO::Ligne::new(pts(&c.at(0)), ws.is_some().then(|| ws.iter().map(|w| w.f()).collect()), demi.is_some().then(|| demi.f()), "axe");
        assert!(l.boite.get().is_none());
        for s in c.at(3).iter() {
            let (x, y) = s.xy();
            verifier("ecart, demi_en", list![x, y, PO::ecart(&l, x, y), PO::demi_en(&l, x, y)], &s);
        }
        verifier("la boîte gardée", nombres(&l.boite.get().unwrap()), &c.at(4));
    }
    for c in p.at("autour").iter() {
        let vu = PO::autour(&pts(&c.at(0)), c.at(1).f(), c.at(2).f(), c.at(3).f()).map(|q| PO::pts_val(&q));
        verifier("autour", vu, &c.at(4));
    }
    let G = geo(&r);
    for c in p.at("enceinte_carte").iter() {
        verifier("enceinte_carte", PO::pts_val(&PO::enceinte_carte(&G.nodes.at(c.at(0).i()), c.at(1).f(), c.at(2).f())), &c.at(3));
    }
    let k = p.at("constantes");
    let quartiers: Val = Val::dict_from(PO::QUARTIERS.iter().map(|(q, d)| (Val::from(*q), Val::from(*d))).collect());
    let vu = dict! {
        "TAU" => PO::TAU, "HG" => PO::HG, "LARG_RIVIERE" => nombres(&PO::LARG_RIVIERE), "DEMI_ROUTE" => nombres(&PO::DEMI_ROUTE),
        "RUE_VILLE" => PO::RUE_VILLE, "QUARTIERS" => quartiers,
    };
    verifier("constantes", vu, &k);
    for (rang, c) in p.at("generer_plan").iter().enumerate() {
        let P = PO::generer_plan(&c.at(0), &|_, _| false);
        formes(&format!("generer_plan.{rang}"), &P);
        assert_eq!(json::empreinte_ordre(&P), c.at(1).s(), "generer_plan {rang}");
        verifier("generer_plan", list![P.at("ilots").len(), P.at("boite")], &c.slice(Some(2), None));
    }
}
