//! Porte game/waterways.py (PORTAGE.md).
//!
//! Voies navigables : gabares sur la Garonne, la Dordogne, l'Isle, le Lot, la Baïse, la Midouze et l'Adour,
//! cabotage le long de la côte atlantique.
//!
//! Les voies d'eau deviennent des arêtes du graphe (kind='water') entre les ports et quais riverains ;
//! elles sont construites à chaque démarrage (rapide) et ne touchent pas au cache de la carte.
//!
//! En Rust : les voies se calculent en nombres natifs (`Voie`, `Port`), puis sont rangées sur la carte en `Val`
//! (geo.ways, geo.ports…), comme le reste du moteur les lit.

use crate::geo::{GeoMap, Pt};
use crate::py::{self, Val};
use crate::{dict, list, py_const};
use std::collections::HashMap;

// Gironde : axe de l'estuaire, du bec d'Ambès à la pointe de Grave (lat, lon)
pub const ESTUARY: [(f64, f64); 10] =
    [(45.05, -0.62), (45.09, -0.675), (45.13, -0.70), (45.19, -0.715), (45.27, -0.745), (45.35, -0.784), (45.43, -0.85), (45.51, -0.945), (45.59, -1.02), (45.615, -1.06)];
// route côtière, de l'embouchure de la Gironde à la Bidassoa
pub const COAST: [(f64, f64); 14] = [
    (45.615, -1.06),
    (45.62, -1.20),
    (45.40, -1.27),
    (45.10, -1.30),
    (44.80, -1.32),
    (44.60, -1.30),
    (44.40, -1.33),
    (44.10, -1.38),
    (43.80, -1.45),
    (43.66, -1.47),
    (43.53, -1.55),
    (43.47, -1.59),
    (43.40, -1.70),
    (43.38, -1.80),
];

/// Une ligne de WAYS (un dict en Python ; `clip` y est une fonction : ici une structure native).
pub struct Way {
    pub name: &'static str,
    /// rivière de geo.json
    pub river: Option<&'static str>,
    /// découpe (lon, lat) -> navigable ?
    pub clip: Option<fn(f64, f64) -> bool>,
    /// se jette dans
    pub into: Option<&'static str>,
    pub tidal_lat: Option<f64>,
    pub low_water: bool,
    pub sea: bool,
}
const fn way(name: &'static str, clip: fn(f64, f64) -> bool, into: &'static str, tidal_lat: Option<f64>, low_water: bool) -> Way {
    Way { name, river: Some(name), clip: Some(clip), into: Some(into), tidal_lat, low_water, sea: false }
}
pub const WAYS: [Way; 8] = [
    // nom, rivière de geo.json, découpe (lon, lat) -> navigable ?, se jette dans
    way("Garonne", |_lon, lat| lat >= 44.08, "Côte", Some(44.55), false),
    way("Dordogne", |lon, _lat| lon <= 1.42, "Garonne", None, true),
    way("Isle", |lon, _lat| lon <= 0.37, "Dordogne", None, true),
    way("Lot", |lon, _lat| lon <= 1.08, "Garonne", None, true),
    way("Baïse", |_lon, lat| lat >= 44.10, "Garonne", None, true),
    way("Midouze", |_lon, _lat| true, "Adour", None, true),
    way("Adour", |lon, _lat| lon <= -0.55, "Côte", None, false),
    Way { name: "Côte", river: None, clip: None, into: None, tidal_lat: None, low_water: false, sea: true },
];
py_const!(LABEL, dict! {"Garonne" => "Garonne et Gironde", "Côte" => "Côte atlantique"});
// port : détour par la passe (lat, lon) depuis la route du large
pub const SEA_PORTS: [(&str, &[(f64, f64)]); 5] = [("La Teste-de-Buch", &[(44.61, -1.24), (44.635, -1.19)]), ("Capbreton", &[]), ("Biarritz", &[]), ("Saint-Jean-de-Luz", &[]), ("Hendaye", &[])];
pub const RIVER_PORT_KM: f64 = 3.0;
py_const!(EXCLUDE, dict! {"Fort Médoc" => "Garonne"}); // le fort reste sur sa rive (bac de Blaye)

/// `math.dist(p, q)`.
fn dist(p: Pt, q: Pt) -> f64 {
    py::dist(p.0, p.1, q.0, q.1)
}
/// Une liste de points en `Val` : des tuples (x, y), comme le Python les range.
fn pts_val(pts: &[Pt]) -> Val {
    pts.iter().map(|&p| Val::from(p)).collect()
}

pub fn _seglen(pts: &[Pt]) -> f64 {
    py::sum(pts.windows(2).map(|pq| dist(pq[0], pq[1])))
}

/// Projection d'un point sur une polyligne : (distance, abscisse curviligne, point projeté).
pub fn _project(pts: &[Pt], cum: &[f64], p: Pt) -> (f64, f64, Pt) {
    let mut best = (1e18, 0.0, pts[0]);
    for (i, ab) in pts.windows(2).enumerate() {
        let (a, b) = (ab[0], ab[1]);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let L2 = dx * dx + dy * dy;
        let t = if L2 == 0.0 {
            0.0
        } else {
            let v = ((p.0 - a.0) * dx + (p.1 - a.1) * dy) / L2;
            let v = if v < 1.0 { v } else { 1.0 }; // min(1.0, v)
            if v > 0.0 {
                v
            } else {
                0.0
            } // max(0.0, …)
        };
        let q = (a.0 + t * dx, a.1 + t * dy);
        let d = dist(p, q);
        if d < best.0 {
            best = (d, cum[i] + t * L2.sqrt(), q);
        }
    }
    best
}

/// Morceau de polyligne entre deux abscisses (s0 < s1).
pub fn _cut(pts: &[Pt], cum: &[f64], s0: f64, s1: f64) -> Vec<Pt> {
    let mut out: Vec<Pt> = vec![];
    for i in 0..pts.len().saturating_sub(1) {
        let (a, b) = (cum[i], cum[i + 1]);
        if b < s0 || a > s1 {
            continue;
        }
        let L = if b - a != 0.0 { b - a } else { 1e-9 };
        let p0 = if a > s0 { a } else { s0 }; // max(s0, a)
        let p1 = if b < s1 { b } else { s1 }; // min(s1, b)
        let P = (pts[i].0 + (pts[i + 1].0 - pts[i].0) * (p0 - a) / L, pts[i].1 + (pts[i + 1].1 - pts[i].1) * (p0 - a) / L);
        let Q = (pts[i].0 + (pts[i + 1].0 - pts[i].0) * (p1 - a) / L, pts[i].1 + (pts[i + 1].1 - pts[i].1) * (p1 - a) / L);
        if out.is_empty() || dist(*out.last().unwrap(), P) > 1e-6 {
            out.push(P);
        }
        out.push(Q);
    }
    out
}

/// (privé) Un port ou un quai d'une voie : `dict(node=, s=, q=, spur=)` en Python.
#[derive(Clone)]
struct Port {
    node: usize,
    s: f64,
    q: Pt,
    spur: Vec<Pt>,
}
/// (privé) Une voie en cours de construction : le dict de `ways` en Python.
struct Voie {
    name: &'static str,
    label: String,
    pts: Vec<Pt>,
    cum: Vec<f64>,
    into: Option<&'static str>,
    sea: bool,
    low_water: bool,
    tidal_s: Option<f64>,
    ports: Vec<Port>,
}
/// (privé) Une arête d'eau, avec ce que le tri des doublons relit.
struct Arete {
    e: Val,
    a: usize,
    b: usize,
    len: f64,
}

/// Ajoute les arêtes fluviales et maritimes à geo.edges ; renseigne geo.ways, geo.ports, geo.down_nodes.
pub fn build(geo: &mut GeoMap) -> Val {
    let mut rivers: HashMap<String, Vec<Val>> = HashMap::new();
    for r in geo.src.at("rivers").iter() {
        rivers.entry(r.at("name").string()).or_default().push(r);
    }
    let mut ways: Vec<Voie> = vec![]; // (un dict en Python, dans l'ordre de WAYS : `voie(&ways, nom)` y cherche)
    for w in WAYS.iter() {
        let ll: Vec<Pt> = if w.sea {
            COAST.to_vec()
        } else {
            let (clip, mut segs) = (w.clip.unwrap(), vec![]);
            for r in rivers.get(w.river.unwrap()).map_or(&[][..], |l| &l[..]) {
                let ll: Vec<Pt> = r.at("pts").iter().map(|p| (p.at(1).f(), p.at(0).f())).filter(|&(lat, lon)| clip(lon, lat)).collect();
                segs.push(ll);
            }
            let mut ll = py::max_by_key(segs, |s| s.len()).expect("ValueError: max() arg is an empty sequence");
            if w.name == "Garonne" {
                ll.extend(ESTUARY);
            }
            ll
        };
        let pts: Vec<Pt> = ll.iter().map(|&(lat, lon)| geo.xy(lat, lon)).collect();
        let mut cum = vec![0.0];
        for pq in pts.windows(2) {
            cum.push(cum.last().unwrap() + dist(pq[0], pq[1]));
        }
        let mut tidal_s = None;
        if let Some(tidal_lat) = w.tidal_lat {
            let ty = geo.xy(tidal_lat, 0.0).1;
            tidal_s = pts.iter().position(|p| p.1 <= ty).map(|i| cum[i]);
        }
        ways.push(Voie { name: w.name, label: LABEL().get_or(w.name, w.name).string(), pts, cum, into: w.into, sea: w.sea, low_water: w.low_water, tidal_s, ports: vec![] });
    }
    fn voie<'a>(ways: &'a [Voie], nom: &str) -> &'a Voie {
        ways.iter().find(|w| w.name == nom).unwrap_or_else(|| panic!("KeyError: {nom:?}"))
    }
    let P: Vec<Pt> = geo.nodes.iter().map(|n| (n.at("x").f(), n.at("y").f())).collect();
    // ports et quais
    // (`taken`, le set des (lieu, voie) déjà pris en Python, ne refuse jamais rien : chaque paire n'est vue qu'une fois)
    for name in ["Garonne", "Dordogne", "Isle", "Lot", "Baïse", "Midouze", "Adour"] {
        let w = ways.iter_mut().find(|w| w.name == name).unwrap();
        for (id, n) in geo.nodes.iter().enumerate() {
            if EXCLUDE().get(&n.at("name")) == name {
                continue;
            }
            let (d, s, q) = _project(&w.pts, &w.cum, P[id]);
            if d <= RIVER_PORT_KM {
                w.ports.push(Port { node: id, s, q, spur: vec![] });
            }
        }
    }
    for (nm, spur) in SEA_PORTS.iter() {
        let nid = geo.by_name.get(*nm);
        if nid.is_none() {
            continue;
        }
        let nid = nid.u();
        let sp: Vec<Pt> = spur.iter().map(|&(lat, lon)| geo.xy(lat, lon)).collect();
        let anchor = if sp.is_empty() { P[nid] } else { sp[0] };
        let sea = ways.iter_mut().find(|w| w.name == "Côte").unwrap();
        let (_d, s, q) = _project(&sea.pts, &sea.cum, anchor);
        sea.ports.push(Port { node: nid, s, q, spur: sp });
    }
    for w in ways.iter_mut() {
        w.ports = py::sorted_by_key(std::mem::take(&mut w.ports), |p| p.s);
        // deux lieux au même endroit de la rive : on garde l'ordre, rien à faire
    }
    // arêtes
    let mut eid = geo.edges.len();
    let mut new: Vec<Arete> = vec![];

    let piece = |port_a: &Port, port_b: &Port, way: &Voie| -> Vec<Pt> {
        let mid = if port_a.s < port_b.s {
            _cut(&way.pts, &way.cum, port_a.s, port_b.s)
        } else {
            let mut m = _cut(&way.pts, &way.cum, port_b.s, port_a.s);
            m.reverse();
            m
        };
        let mut out = vec![P[port_a.node]];
        out.extend(port_a.spur.iter().rev());
        out.extend(mid);
        out.extend(&port_b.spur);
        out.push(P[port_b.node]);
        out
    };

    let mut add = |a: usize, b: usize, pts: Vec<Pt>, way: &Voie, down: Option<usize>| {
        let mut clean = vec![pts[0]];
        for &p in &pts[1..] {
            if dist(p, *clean.last().unwrap()) > 0.05 {
                clean.push(p);
            }
        }
        if clean.len() < 2 {
            clean.push(*pts.last().unwrap());
        }
        let l = _seglen(&clean);
        let len = py::round_n(if l > 0.5 { l } else { 0.5 }, 2);
        let e = dict! {"id" => eid, "a" => a, "b" => b, "len" => len, "kind" => "water", "way" => way.name,
        "sea" => way.sea, "down" => down, "royal" => false, "ferry" => false, "river" => Val::None, "rrank" => 0, "cx" => Val::None, "cy" => Val::None,
        "pts" => clean.iter().map(|&(x, y)| list![py::round_n(x, 2), py::round_n(y, 2)]).collect::<Val>()};
        new.push(Arete { e, a, b, len });
        eid += 1;
    };

    for w in ways.iter() {
        for ab in w.ports.windows(2) {
            let (pa, pb) = (&ab[0], &ab[1]);
            if pa.node == pb.node {
                continue;
            }
            let tidal = w.sea || w.tidal_s.is_some_and(|t| pa.s >= t);
            add(pa.node, pb.node, piece(pa, pb, w), w, if tidal { None } else { Some(pb.node) });
        }
    }
    // confluences
    for w in ways.iter() {
        let Some(into) = w.into else { continue };
        if w.ports.is_empty() {
            continue;
        }
        let parent = voie(&ways, into);
        let last = w.ports.last().unwrap();
        let (_d, sj, _q) = _project(&parent.pts, &parent.cum, *w.pts.last().unwrap());
        let up: Vec<&Port> = parent.ports.iter().filter(|p| p.s < sj).collect();
        let dn: Vec<&Port> = parent.ports.iter().filter(|p| p.s >= sj).collect();
        let tail = _cut(&w.pts, &w.cum, last.s, *w.cum.last().unwrap());
        for (other, is_down) in [(up.last().copied(), false), (dn.first().copied(), true)] {
            let Some(other) = other else { continue };
            if other.node == last.node {
                continue;
            }
            let mid = if is_down {
                _cut(&parent.pts, &parent.cum, sj, other.s)
            } else {
                let mut m = _cut(&parent.pts, &parent.cum, other.s, sj);
                m.reverse();
                m
            };
            let mut pts = vec![P[last.node]];
            pts.extend(&tail);
            pts.extend(mid);
            pts.extend(&other.spur);
            pts.push(P[other.node]);
            add(last.node, other.node, pts, w, if is_down && !parent.sea { Some(other.node) } else { None });
        }
    }
    // pas de doublon (deux voies reliant les mêmes lieux) : on garde la plus courte
    let mut best: HashMap<(usize, usize), usize> = HashMap::new(); // (le rang dans new ; new est dans l'ordre des id)
    for (i, e) in new.iter().enumerate() {
        let k = (e.a.min(e.b), e.a.max(e.b));
        if best.get(&k).is_none_or(|&j| e.len < new[j].len) {
            best.insert(k, i);
        }
    }
    let mut rangs: Vec<usize> = best.into_values().collect();
    rangs.sort(); // sorted(best.values(), key=lambda e: e['id'])
    let keep: Vec<Val> = rangs.iter().map(|&i| new[i].e.clone()).collect();
    let base = geo.edges.len();
    for (i, e) in keep.iter().enumerate() {
        e.set("id", base + i);
        geo.edges.push(e);
    }
    let ways_v = Val::dict();
    for w in ways.iter() {
        let ports: Val = w.ports.iter().map(|p| dict! {"node" => p.node, "s" => p.s, "q" => p.q, "spur" => pts_val(&p.spur)}).collect();
        ways_v.set(
            w.name,
            dict! {"name" => w.name, "label" => &w.label, "pts" => pts_val(&w.pts), "cum" => w.cum.iter().map(|&c| Val::from(c)).collect::<Val>(), "into" => w.into,
            "sea" => w.sea, "low_water" => w.low_water,
            "tidal_s" => w.tidal_s, "ports" => ports},
        );
    }
    geo.ways = ways_v;
    // cumul des longueurs pour placer gabares et armées le long des arêtes (voies d'eau et tracés des routes)
    geo.edge_cum = Val::dict();
    for e in geo.edges.iter() {
        let pts: Vec<Pt> = e.at("pts").iter().map(|p| p.xy()).collect();
        let mut cum = vec![0.0];
        for pq in pts.windows(2) {
            cum.push(cum.last().unwrap() + dist(pq[0], pq[1]));
        }
        let dernier = *cum.last().unwrap();
        let k = if dernier > 0.0 { e.at("len").f() / dernier } else { 1.0 };
        geo.edge_cum.set(&e.at("id"), cum.iter().map(|c| Val::from(c * k)).collect::<Val>());
    }
    // quais : lieux desservis par une voie d'eau ; et, pour le blocus, les lieux à franchir pour gagner la mer
    geo.ports = Val::dict();
    for w in ways.iter() {
        for p in &w.ports {
            geo.ports.setdefault(p.node, list![]).push(w.name);
        }
    }
    for (nid, lst) in geo.ports.items() {
        geo.nodes.at(&nid).set("quai", lst.iter().map(|x| Val::from(&voie(&ways, x.s()).label)).collect::<Val>());
    }
    let down = Val::dict();

    fn downstream(ways: &[Voie], wname: &str, s: f64) -> Vec<usize> {
        let w = voie(ways, wname);
        let mut out: Vec<usize> = w.ports.iter().filter(|p| p.s > s + 0.01).map(|p| p.node).collect();
        if let Some(into) = w.into {
            let parent = voie(ways, into);
            if !parent.sea {
                let (_, sj, _) = _project(&parent.pts, &parent.cum, *w.pts.last().unwrap());
                out.extend(downstream(ways, into, sj));
            }
        }
        out
    }
    for w in ways.iter() {
        if w.sea {
            continue;
        }
        for p in &w.ports {
            let l = down.setdefault(p.node, list![]);
            for x in downstream(&ways, w.name, p.s) {
                if x != p.node && !l.has(x) {
                    l.push(x);
                }
            }
        }
    }
    geo.down_nodes = down;
    Val::list(keep)
}
