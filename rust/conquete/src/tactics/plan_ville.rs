//! Le portage de game/tactics/plan_ville.py.
//!
//! Le plan d'une ville, celui de « Voir l'intérieur » (web/js/carte/villes.js : profilVille, genererInterieur), porté
//! pour les batailles (terrain.rs) : mêmes rues, mêmes îlots, mêmes murs, mêmes lieux.
//!
//! Portage fidèle de la géométrie : même tirage (alea : mulberry32), mêmes hachages (hash2, hashS : FNV-1a), même calcul
//! entier sur 32 bits, même Math.hypot que V8 et même arrondi que Math.round ; la même ville sort des deux côtés (au
//! millième d'unité près, tests/test_plan_ville.py le vérifie pour toutes les places). Ce que le plan ne dessine que dans
//! l'intérieur (fermes, métiers, peinture) n'est pas porté : rien de ce qui suit le tirage des îlots ne le consomme.
//!
//! Repère : unités de l'intérieur, S = 180 par km, centre de la ville en IC ; x vers l'est, y vers le sud (comme la carte).
//! L'état qui change la géométrie : l'année (avant ou après 1860), f (l'enceinte), pop (la taille, par paliers), d (les
//! faubourgs).
//!
//! Ce qui change du Python (PORTAGE.md) : les calculs sont en nombres natifs, les points des `(f64, f64)` ; ce qui est
//! rendu (le profil Pf, le plan V, le tracé de `bastions`) reste en `Val`, mêmes clés, mêmes tuples. La fonction
//! `V['eau']` du plan ne tient pas dans une `Val` : c'est `eau(K, V, x, y)`. La carte se lit par le trait `Geo`
//! (ce que `Carte` lit d'une GeoMap).

use std::cell::RefCell;
use std::rc::Rc;

use super::jsmath::Alea;
pub use super::jsmath::{alea, atan2, cos, hash2, hashS, hypot, jround, sin};
use crate::py::{self, Val};
use crate::{dict, list, tup};

pub const S: i64 = 180;
pub const IW: i64 = 1000;
pub const IH: i64 = 760;
pub const IC: (f64, f64) = (500.0, 380.0);
pub const TAU: f64 = std::f64::consts::PI * 2.0;
pub const M: f64 = 1000.0 / S as f64; // mètres par unité

const SF: f64 = S as f64;
const PI: f64 = std::f64::consts::PI;

/// Un point du plan (un tuple `(x, y)` de Python).
pub type Pt = (f64, f64);

/// Les points d'une `Val` (liste de `[x, y]` ou de `(x, y)`).
pub fn pts_de(v: &Val) -> Vec<Pt> {
    v.iter().map(|p| p.xy()).collect()
}
/// Une liste de tuples `(x, y)`.
fn pts_val(pts: &[Pt]) -> Val {
    pts.iter().map(|p| Val::from(*p)).collect()
}

/// `mod(a, n)` du Python (`mod` est un mot réservé en Rust).
pub fn mod_(a: f64, n: f64) -> f64 {
    ((a % n) + n) % n
}

pub fn clamp<T: PartialOrd>(v: T, a: T, b: T) -> T {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

pub fn ang_diff(a: f64, b: f64) -> f64 {
    atan2(sin(a - b), cos(a - b))
}

pub fn aire(q: &[Pt]) -> f64 {
    let mut s = 0.0;
    for k in 0..q.len() {
        let (a, b) = (q[k], q[(k + 1) % q.len()]);
        s += a.0 * b.1 - b.0 * a.1;
    }
    s / 2.0
}

pub fn dist_poly(pts: &[Pt], x: f64, y: f64) -> f64 {
    let mut d = 1e9;
    for i in 1..pts.len() {
        let (ax, ay) = pts[i - 1];
        let (bx, by) = pts[i];
        let (dx, dy) = (bx - ax, by - ay);
        let den = dx * dx + dy * dy;
        if den == 0.0 {
            return f64::NAN; // (comme en JS : 0/0, et Math.min garde le NaN)
        }
        let k = clamp(((x - ax) * dx + (y - ay) * dy) / den, 0.0, 1.0);
        let h = hypot(x - ax - k * dx, y - ay - k * dy);
        if h < d {
            d = h;
        }
    }
    d
}

/// Le tracé bastionné de lib.js (premier système de Vauban) : sommets V, escarpe poly, demi-lunes ravs, côtés.
pub fn bastions(cx: f64, cy: f64, N: i64, Rb: f64, rot: f64) -> Val {
    let (mut V, mut poly): (Vec<Pt>, Vec<Pt>) = (vec![], vec![]);
    let (ravs, cotes) = (list![], list![]);
    for i in 0..N {
        let a = rot + i as f64 * TAU / N as f64;
        V.push((cx + cos(a) * Rb, cy + sin(a) * Rb));
    }
    for i in 0..N as usize {
        let (A, B) = (V[i], V[(i + 1) % N as usize]);
        let L = hypot(B.0 - A.0, B.1 - A.1);
        let Mi = ((A.0 + B.0) / 2.0, (A.1 + B.1) / 2.0);
        let nl = hypot(cx - Mi.0, cy - Mi.1);
        let nin = ((cx - Mi.0) / nl, (cy - Mi.1) / nl);
        let perp = L / (if N <= 4 { 8.0 } else if N == 5 { 7.0 } else { 6.0 });
        let D = (Mi.0 + nin.0 * perp, Mi.1 + nin.1 * perp);
        let uA = (D.0 - A.0, D.1 - A.1);
        let lA = hypot(uA.0, uA.1);
        let uB = (D.0 - B.0, D.1 - B.1);
        let lB = hypot(uB.0, uB.1);
        let uA = (uA.0 / lA, uA.1 / lA);
        let uB = (uB.0 / lB, uB.1 / lB);
        let FA = (A.0 + uA.0 * 2.0 * L / 7.0, A.1 + uA.1 * 2.0 * L / 7.0);
        let FB = (B.0 + uB.0 * 2.0 * L / 7.0, B.1 + uB.1 * 2.0 * L / 7.0);
        let r = hypot(FA.0 - FB.0, FA.1 - FB.1);
        let GA = (FB.0 + uB.0 * r, FB.1 + uB.1 * r);
        let GB = (FA.0 + uA.0 * r, FA.1 + uA.1 * r);
        poly.extend([FA, GA, GB, FB, B]);
        let u = ((B.0 - A.0) / L, (B.1 - A.1) / L);
        let out = (-nin.0, -nin.1);
        ravs.push(dict! {
            "apex" => (Mi.0 + out.0 * L * 0.34, Mi.1 + out.1 * L * 0.34),
            "b1" => (Mi.0 + out.0 * L * 0.04 - u.0 * L * 0.2, Mi.1 + out.1 * L * 0.04 - u.1 * L * 0.2),
            "b2" => (Mi.0 + out.0 * L * 0.04 + u.0 * L * 0.2, Mi.1 + out.1 * L * 0.04 + u.1 * L * 0.2),
            "M" => Mi, "out" => out, "u" => u,
        });
        cotes.push(dict! {
            "A" => A, "B" => B, "FA" => FA, "FB" => FB, "GA" => GA, "GB" => GB, "M" => Mi, "nin" => nin,
            "porte" => ((GA.0 + GB.0) / 2.0, (GA.1 + GB.1) / 2.0),
        });
    }
    dict! { "V" => pts_val(&V), "poly" => pts_val(&poly), "ravs" => ravs, "cotes" => cotes, "C" => (cx, cy), "N" => N, "Rb" => Rb }
}

// ---------------------------------------------------------------------- la carte du jeu, comme carteDe(map.m)
/// Ce que `Carte` lit d'une GeoMap (game/geo.py) : ses dimensions, son terrain, ses places, ses arêtes, ses données
/// d'origine (`src['rivers']`) et sa projection. Le struct GeoMap de geo.rs n'a qu'à le mettre en œuvre.
pub trait Geo {
    fn W(&self) -> i64;
    fn H(&self) -> i64;
    fn terrain(&self) -> &[u8];
    fn nodes(&self) -> Val;
    fn edges(&self) -> Val;
    fn src(&self) -> Val;
    fn xy(&self, lat: f64, lon: f64) -> (f64, f64);
}

/// Ce que villes.js lit dans map.m (client_payload) : places, routes, rivières (en km, arrondies au centième comme
/// la charge envoyée au navigateur), terrain. (Le Python garde aussi `geo` : ici, ses listes `nodes` et `edges`
/// suffisent à la reconnaître ; le terrain est copié.)
pub struct Carte {
    pub GW: i64,
    pub GH: i64,
    pub TER: Vec<u8>,
    pub nodes: Val,
    pub edges: Val,
    pub rivers: Val,
    pub noeud: Val,
    pub y_mont: f64,
    pub plans: Val,
}

impl Carte {
    pub fn new(geo: &impl Geo) -> Carte {
        let rivers = Val::list(vec![]);
        for r in geo.src().at("rivers").iter() {
            let pts = Val::list(vec![]);
            for q in r.at("pts").iter() {
                let (lon, lat) = q.xy();
                let (x, y) = geo.xy(lat, lon);
                pts.push(list![py::round_n(x, 2), py::round_n(y, 2)]);
            }
            rivers.push(dict! { "name" => r.at("name"), "rank" => r.at("rank"), "pts" => pts });
        }
        let nodes = geo.nodes();
        let noeud = Val::dict();
        for n in nodes.iter() {
            noeud.set(n.at("id"), &n);
        }
        Carte { GW: geo.W(), GH: geo.H(), TER: geo.terrain().to_vec(), nodes, edges: geo.edges(), rivers, noeud, y_mont: geo.xy(43.2, 0.0).1, plans: Val::dict() }
    }

    pub fn ter(&self, x: f64, y: f64) -> i64 {
        let (i, j) = (py::int(x), py::int(y));
        if 0 <= i && i < self.GW && 0 <= j && j < self.GH {
            self.TER[(j * self.GW + i) as usize] as i64
        } else {
            0
        }
    }

    pub fn eauK(&self, x: f64, y: f64) -> f64 {
        let (i, j) = ((x - 0.5).floor(), (y - 0.5).floor());
        let (fx, fy) = (x - 0.5 - i, y - 0.5 - j);
        let w = |a: f64, b: f64| -> f64 {
            if matches!(self.ter(a + 0.5, b + 0.5), 0 | 1) {
                1.0
            } else {
                0.0
            }
        };
        lerp(lerp(w(i, j), w(i + 1.0, j), fx), lerp(w(i, j + 1.0), w(i + 1.0, j + 1.0), fx), fy)
    }
}

thread_local! {
    static _CARTES: RefCell<Vec<Rc<Carte>>> = const { RefCell::new(Vec::new()) };
}

/// La Carte d'une GeoMap, gardée (une par fil). Le Python la range sous `id(geo)` ; ici elle se reconnaît aux listes
/// `nodes` et `edges` de la GeoMap, que la Carte tient en vie.
pub fn carte_de(geo: &impl Geo) -> Rc<Carte> {
    let (nodes, edges) = (geo.nodes(), geo.edges());
    if let Some(K) = _CARTES.with(|c| c.borrow().iter().find(|K| K.nodes.is(&nodes) && K.edges.is(&edges)).cloned()) {
        return K;
    }
    let K = Rc::new(Carte::new(geo));
    _CARTES.with(|c| c.borrow_mut().push(K.clone()));
    K
}

pub const BASQUES: [&str; 11] = [
    "Bayonne", "Biarritz", "Hendaye", "Saint-Jean-de-Luz", "Hasparren", "Saint-Jean-Pied-de-Port", "Mauléon", "Ustaritz", "Espelette",
    "Cambo-les-Bains", "Saint-Palais",
];
pub const BASTIDES: [&str; 21] = [
    "Libourne", "Sainte-Foy-la-Grande", "Sauveterre-de-Guyenne", "Créon", "Villeréal", "Eymet", "Domme", "Lalinde", "Villeneuve-sur-Lot",
    "Monflanquin", "Castillonnès", "Tournon-d'Agenais", "Miramont", "Cadillac", "Sauveterre-de-Béarn", "Navarrenx", "Beaumont-du-Périgord",
    "Villefranche-du-Périgord", "Monpazier", "Vianne", "Hastingues",
];

pub fn style_de(n: &Val) -> &'static str {
    let dept = n.at("dept");
    if dept == "64" {
        return if BASQUES.contains(&n.at("name").s()) || n.at("x").f() < 75.0 { "basque" } else { "bearn" };
    }
    match dept.s() {
        "33" => "bordelais",
        "24" => "perigord",
        "40" => "landes",
        "47" => "agenais",
        _ => "bordelais",
    }
}

pub fn ere(a: i64) -> i64 {
    if a >= 1860 {
        1860
    } else {
        1789
    }
}

pub fn rayon(pop: f64) -> i64 {
    jround(clamp(46.0 + 1.55 * pop.sqrt(), 56.0, 262.0) / 8.0) * 8
}

fn _loc(nx: f64, ny: f64, x: f64, y: f64) -> Pt {
    (IC.0 + (x - nx) * SF, IC.1 + (y - ny) * SF)
}

/// profil_ville(K, n, annee=1789, f=None, pop=None, d=0) : `Val::None` vaut le défaut du Python.
pub fn profil_ville(K: &Carte, n: &Val, annee: impl Into<Val>, f: impl Into<Val>, pop: impl Into<Val>, d: impl Into<Val>) -> Val {
    let (annee, f, pop, d): (Val, Val, Val, Val) = (annee.into(), f.into(), pop.into(), d.into());
    let pop0 = n.get("pop0").or(700);
    let pop = pop.or(&pop0);
    let spec = n.get("spec").or(list![]);
    let annee = ere(annee.or(1789).i());
    let f = if f.is_none() { n.get("fort").or(0) } else { f };
    let d = d.or(0);
    let R = rayon(pop.f());
    let (nid, nx, ny) = (n.at("id"), n.at("x").f(), n.at("y").f());
    let mut routes: Vec<(f64, bool, Val)> = vec![];
    for ed in K.edges.iter() {
        let de_a = ed.at("a") == nid;
        if !de_a && ed.at("b") != nid {
            continue;
        }
        let mut pts = pts_de(&ed.at("pts"));
        if !de_a {
            pts.reverse();
        }
        let p = pts.iter().find(|q| hypot(q.0 - nx, q.1 - ny) > 0.9).copied().unwrap_or(pts[pts.len() - 1]);
        let a = atan2(p.1 - ny, p.0 - nx);
        let autre = K.noeud.get(if de_a { ed.at("b") } else { ed.at("a") });
        if !routes.iter().any(|r| ang_diff(r.0, a).abs() < 0.4) {
            routes.push((a, ed.get("royal").truthy(), if autre.truthy() { autre.at("name") } else { autre }));
        }
    }
    let routes = py::sorted_by_key(routes, |r| -(r.1 as i64));
    let rivs = list![];
    for r in K.rivers.iter() {
        let rpts = pts_de(&r.at("pts"));
        let proches: Vec<usize> = (0..rpts.len()).filter(|&k| hypot(rpts[k].0 - nx, rpts[k].1 - ny) < 4.6).collect();
        if proches.len() < 2 || !rpts.iter().any(|q| hypot(q.0 - nx, q.1 - ny) < 2.6) {
            continue;
        }
        let (i0, i1) = (proches[0], proches[proches.len() - 1]);
        let rank = r.at("rank");
        let w = (if 0 <= rank.i() && rank.i() <= 4 { [0, 74, 34, 20, 13][rank.u()] } else { 0 }) as i64;
        let pts: Vec<Pt> = rpts[i0.saturating_sub(1)..(i1 + 2).min(rpts.len())].iter().map(|q| _loc(nx, ny, q.0, q.1)).collect();
        rivs.push(dict! { "name" => r.at("name"), "rank" => rank, "w" => if w != 0 { w } else { 11 }, "pts" => pts_val(&pts) });
    }
    let mut mer = Val::None;
    let (mut sx, mut sy) = (0.0, 0.0);
    let mut c = 0i64;
    let mut a = 0.0;
    while a < TAU {
        for dd in [1.0, 2.0, 3.0] {
            if K.eauK(nx + cos(a) * dd, ny + sin(a) * dd) > 0.5 {
                sx += cos(a) / dd;
                sy += sin(a) / dd;
                c += 1;
            }
        }
        a += TAU / 24.0;
    }
    if c != 0 {
        mer = dict! { "a" => atan2(sy, sx), "n" => c };
    }
    let mut comptes = [0i64; 11];
    for dx in -4..5 {
        for dy in -4..5 {
            comptes[K.ter(nx + dx as f64, ny + dy as f64) as usize] += 1;
        }
    }
    let relief = (comptes[6] + comptes[7] * 2 + comptes[8] * 3) as f64 / 81.0;
    let style = style_de(n);
    let port = spec.has("port") && (mer.truthy() || rivs.iter().any(|r| r.at("rank") <= 2));
    let (typ, nf, name) = (n.at("type"), n.get("fort").or(0), n.at("name"));
    let modele = if typ == "fort" && (name.s().starts_with("Fort") || pop0 <= 450) {
        "fortin"
    } else if nf >= 3 && pop0 < 4000 && !port {
        "place"
    } else if BASTIDES.contains(&name.s()) {
        "bastide"
    } else if typ == "capitale" || pop0 >= 6000 {
        "grande"
    } else if typ == "fort" {
        "castrum"
    } else if typ == "ville" {
        if port && mer.truthy() {
            "port"
        } else {
            "ville"
        }
    } else if relief > 0.55 || (n.at("dept") == "64" && ny > K.y_mont - 25.0) {
        "montagne"
    } else if n.at("dept") == "40" && comptes[3] + comptes[4] > 34 {
        "airial"
    } else if routes.len() <= 2 {
        "rue"
    } else {
        "rond"
    };
    let demoli = annee >= 1860 && f < 3 && matches!(modele, "grande" | "ville" | "port");
    let murs: Val = if matches!(modele, "fortin" | "place") {
        "bastions".into()
    } else if demoli {
        if nf > 0 || f > 0 {
            "cours".into()
        } else {
            Val::None
        }
    } else if f >= 3 {
        "bastions".into()
    } else if f >= 1 {
        "medieval".into()
    } else {
        Val::None
    };
    let routes: Val = routes.into_iter().map(|(a, royal, vers)| dict! { "a" => a, "royal" => royal, "vers" => vers }).collect();
    dict! {
        "n" => n, "pop" => &pop, "spec" => spec, "R" => R, "routes" => routes, "rivs" => rivs, "mer" => mer,
        "comptes" => comptes.iter().map(|c| Val::from(*c)).collect::<Val>(), "relief" => relief,
        "style" => style, "port" => port, "modele" => modele, "murs" => murs, "annee" => annee, "f" => &f, "d" => &d,
        "sd" => hashS(n.get("slug").or(&name).s()),
        "citadelle" => f >= 2 && !matches!(modele, "fortin" | "place") && pop0 > 2000,
        "fau" => 1.0 + 0.18 * d.f(), "dfau" => 0.08 * d.f(),
    }
}

/// Un îlot en cours de plan : le dict `b` de genererInterieur (q, c, d, zone, main, aire, puis ce que donne
/// l'appelant, puis role, voisin, supprime).
struct Ilot {
    q: [Pt; 4],
    c: Pt,
    d: f64,
    zone: &'static str,
    main: bool,
    aire: f64,
    /// les autres clés données à ajout (anneau, secteur, cotes, gi, gj), dans leur ordre
    o: Vec<(&'static str, Val)>,
    role: Option<&'static str>,
    voisin: Option<usize>,
    supprime: bool,
}

impl Ilot {
    fn entier(&self, cle: &str) -> Option<i64> {
        self.o.iter().find(|(k, _)| *k == cle).map(|(_, v)| v.i())
    }
    /// Le plus loin de IC des quatre coins.
    fn portee(&self) -> f64 {
        py::max_f(self.q.iter().map(|p| hypot(p.0 - IC.0, p.1 - IC.1))).unwrap()
    }
    fn val(&self, ilots: &[Ilot]) -> Val {
        let b = dict! { "q" => pts_val(&self.q), "c" => self.c, "d" => self.d, "zone" => self.zone, "main" => self.main, "aire" => self.aire };
        for (k, v) in &self.o {
            b.set(*k, v);
        }
        if let Some(r) = self.role {
            b.set("role", r);
        }
        if let Some(nb) = self.voisin {
            b.set("voisin", ilots[nb].val(ilots));
        }
        if self.supprime {
            b.set("supprime", true);
        }
        b
    }
}

/// L'eau du plan : les rivières du profil (leurs boîtes : loin de la boîte, loin de la rivière, sans calcul) et le
/// terrain de la carte. C'est `pres` et `eauL` de genererInterieur.
struct Eaux<'a> {
    K: &'a Carte,
    nx: f64,
    ny: f64,
    rivs: Vec<Vec<Pt>>,
    boites: Vec<(f64, f64, f64, f64, f64)>,
}

impl<'a> Eaux<'a> {
    fn de(K: &'a Carte, Pf: &Val) -> Eaux<'a> {
        let n = Pf.at("n");
        let (mut rivs, mut boites) = (vec![], vec![]);
        for r in Pf.at("rivs").iter() {
            let pts = pts_de(&r.at("pts"));
            boites.push((
                py::min_f(pts.iter().map(|p| p.0)).unwrap(),
                py::min_f(pts.iter().map(|p| p.1)).unwrap(),
                py::max_f(pts.iter().map(|p| p.0)).unwrap(),
                py::max_f(pts.iter().map(|p| p.1)).unwrap(),
                r.at("w").f() / 2.0,
            ));
            rivs.push(pts);
        }
        Eaux { K, nx: n.at("x").f(), ny: n.at("y").f(), rivs, boites }
    }

    fn eauL(&self, x: f64, y: f64) -> f64 {
        self.K.eauK(self.nx + (x - IC.0) / SF, self.ny + (y - IC.1) / SF)
    }

    /// pres(x, y, m=7)
    fn pres(&self, x: f64, y: f64, m: f64) -> bool {
        for (r, &(x0, y0, x1, y1, w)) in self.rivs.iter().zip(&self.boites) {
            let e = w + m + 1e-6; // (loin de la boîte de la rivière : loin de la rivière, sans calcul)
            if x0 - e < x && x < x1 + e && y0 - e < y && y < y1 + e && dist_poly(r, x, y) < w + m {
                return true;
            }
        }
        self.eauL(x, y) > 0.42
    }
}

/// `V['eau'](x, y)` du Python : le point du plan V est-il dans l'eau (rivière du profil ou terrain de la carte) ?
pub fn eau(K: &Carte, V: &Val, x: f64, y: f64) -> bool {
    Eaux::de(K, &V.at("Pf")).pres(x, y, 0.0)
}

fn tourne(a: f64, u: f64, v: f64) -> Pt {
    (cos(a) * u - sin(a) * v, sin(a) * u + cos(a) * v)
}

/// L'état de genererInterieur, que ses fonctions internes se partagent.
struct Interieur<'a> {
    eaux: Eaux<'a>,
    R: Alea,
    sd: i64,
    ang_routes: Vec<f64>,
    ilots: Vec<Ilot>,
    rues: Val,
    V: Val,
}

impl Interieur<'_> {
    /// ajout(q, **o) : main et zone sont à part, o tient le reste.
    fn ajout(&mut self, q: [Pt; 4], main: bool, zone: &'static str, o: Vec<(&'static str, Val)>) {
        if q.iter().any(|p| self.eaux.pres(p.0, p.1, 7.0)) || self.eaux.pres((q[0].0 + q[2].0) / 2.0, (q[0].1 + q[2].1) / 2.0, 10.0) {
            return;
        }
        let c = ((q[0].0 + q[1].0 + q[2].0 + q[3].0) / 4.0, (q[0].1 + q[1].1 + q[2].1 + q[3].1) / 4.0);
        self.ilots.push(Ilot { q, c, d: hypot(c.0 - IC.0, c.1 - IC.1), zone, main, aire: aire(&q).abs(), o, role: None, voisin: None, supprime: false });
    }

    /// polaire(R0, R1, pasA=.55, pasR=34, tord=.1, zone='ville', cotes=None)
    fn polaire(&mut self, R0: f64, R1: f64, pasA: f64, pasR: f64, tord: f64, zone: &'static str, cotes: Val) -> Vec<f64> {
        let mut angs = self.ang_routes.clone();
        while angs.len() < 3 {
            let a = (if angs.is_empty() { 0.0 } else { angs[0] }) + TAU * (angs.len() as f64 / 3.0) + 0.4;
            angs.push(a);
        }
        let angs = py::sorted_by_key(angs.iter().map(|a| mod_(*a, TAU)).collect::<Vec<f64>>(), |a| *a);
        let (mut routes_idx, mut full): (Vec<usize>, Vec<f64>) = (vec![], vec![]);
        for k in 0..angs.len() {
            let a0 = angs[k];
            let a1 = if k + 1 < angs.len() { angs[k + 1] } else { angs[0] + TAU };
            let n_ins = (jround((a1 - a0) / pasA) - 1).max(0);
            routes_idx.push(full.len());
            full.push(a0);
            for q in 1..n_ins + 1 {
                full.push(a0 + (a1 - a0) * q as f64 / (n_ins + 1) as f64 + (self.R.R() - 0.5) * 0.08);
            }
        }
        let na = full.len();
        full.push(full[0] + TAU);
        let mut rings = vec![];
        let mut r = R0;
        while r < R1 - pasR * 0.6 {
            rings.push(r);
            r += pasR * (0.85 + self.R.R() * 0.3);
        }
        rings.push(R1);

        // (le Python garde chaque point dans un memo : le calcul est le même à chaque appel)
        let sd = self.sd;
        let P = |m: usize, k: usize| -> Pt {
            let a = full[k] + tord * sin(k as f64 * 1.7 + m as f64 * 0.9 + (sd % 11) as f64);
            let rr = rings[m] * (1.0 + 0.06 * sin(full[k] * 3.0 + (sd % 5) as f64));
            (IC.0 + cos(a) * rr, IC.1 + sin(a) * rr)
        };
        for m in 0..rings.len() - 1 {
            for k in 0..na {
                let main = routes_idx.contains(&k) || routes_idx.contains(&((k + 1) % na));
                let o = vec![("anneau", Val::from(m)), ("secteur", Val::from(k)), ("cotes", cotes.clone())];
                self.ajout([P(m, k + 1), P(m, k), P(m + 1, k), P(m + 1, k + 1)], main, zone, o);
            }
        }
        for k in 0..na {
            let pts = pts_val(&(0..rings.len()).map(|m| P(m, k)).collect::<Vec<Pt>>());
            self.rues.push(dict! { "pts" => &pts, "main" => routes_idx.contains(&k) });
            if routes_idx.contains(&k) {
                // (pour les batailles : les rues maîtresses qui mènent aux routes)
                self.V.setdefault("radiales", list![]).push(tup![full[k], pts]);
            }
        }
        for m in 0..rings.len() {
            let pts = pts_val(&(0..na + 1).map(|k| P(m, k)).collect::<Vec<Pt>>());
            self.rues.push(dict! { "pts" => pts, "anneau" => true, "main" => false });
        }
        rings
    }

    /// grille(cx, cy, a, nx, ny, pas, jit=0, garder=None, zone='ville')
    fn grille(&mut self, cx: f64, cy: f64, a: f64, nx: i64, ny: i64, pas: f64, jit: f64, garder: Option<&dyn Fn(Pt) -> bool>) {
        // (le Python garde chaque point dans un memo : le calcul est le même à chaque appel)
        let sd = self.sd;
        let P = |i: i64, j: i64| -> Pt {
            let (u, v) = tourne(a, (i as f64 - nx as f64 / 2.0) * pas, (j as f64 - ny as f64 / 2.0) * pas);
            if jit != 0.0 {
                (cx + u + (hash2(i, j, sd) - 0.5) * jit, cy + v + (hash2(j, i, sd) - 0.5) * jit)
            } else {
                (cx + u, cy + v)
            }
        };
        let (hx, hy) = (py::floordiv_i(nx, 2), py::floordiv_i(ny, 2));
        for i in 0..nx {
            for j in 0..ny {
                let q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
                let c = ((q[0].0 + q[2].0) / 2.0, (q[0].1 + q[2].1) / 2.0);
                if let Some(g) = garder {
                    if !g(c) {
                        continue;
                    }
                }
                let main = i as f64 == nx as f64 / 2.0 || i + 1 == hx || j == hy || j + 1 == hy;
                self.ajout(q, main, "ville", vec![("gi", Val::from(i)), ("gj", Val::from(j))]);
            }
        }
        for i in 0..nx + 1 {
            self.rues.push(dict! { "pts" => pts_val(&[P(i, 0), P(i, ny)]), "main" => i == hx });
        }
        for j in 0..ny + 1 {
            self.rues.push(dict! { "pts" => pts_val(&[P(0, j), P(nx, j)]), "main" => j == hy });
        }
    }

    /// le_plus_pres(liste, x, y, filtre) : le filtre du Python n'écarte jamais qu'un îlot (`sauf`).
    fn le_plus_pres(&self, liste: &[usize], x: f64, y: f64, sauf: Option<usize>) -> Option<usize> {
        let l: Vec<usize> = liste.iter().copied().filter(|&b| self.ilots[b].role.is_none() && Some(b) != sauf).collect();
        let l = py::sorted_by_key(l, |&b| hypot(self.ilots[b].c.0 - x, self.ilots[b].c.1 - y));
        l.first().copied()
    }

    fn role(&mut self, b: Option<usize>, r: &'static str) -> Option<usize> {
        if let Some(i) = b {
            self.ilots[i].role = Some(r);
            self.V.at("lieux").setdefault(r, self.ilots[i].c);
        }
        b
    }

    /// ruban(route, d0, d1, prof=42, seg=34, densite=None) : de la route, seul l'angle sert.
    fn ruban(&mut self, a0: f64, d0: f64, d1: f64, prof: f64, seg: f64, densite: Option<f64>) {
        let mut d = d0;
        while d < d1 {
            for s in [-1.0, 1.0] {
                if let Some(dn) = densite {
                    if dn != 0.0 && self.R.R() > dn {
                        continue;
                    }
                }
                let p = |t: f64, off: f64| -> Pt {
                    let a = a0 + 0.06 * sin(t / 90.0);
                    (IC.0 + cos(a) * t - sin(a) * off * s, IC.1 + sin(a) * t + cos(a) * off * s)
                };
                let q = if s > 0.0 { [p(d, 6.0), p(d + seg, 6.0), p(d + seg, prof), p(d, prof)] } else { [p(d + seg, 6.0), p(d, 6.0), p(d, prof), p(d + seg, prof)] };
                self.ajout(q, false, "faubourg", vec![("cotes", list![true, false, false, false])]);
            }
            d += seg * (0.85 + self.R.R() * 0.3);
        }
    }

    // --- les métiers de la ville (plus : {k, x, y, a})
    fn autour(&mut self, dmin: f64, dmax: f64, k: &str) -> Val {
        for _ in 0..40 {
            let a = self.R.R() * TAU;
            let d = dmin + self.R.R() * (dmax - dmin);
            let (x, y) = (IC.0 + cos(a) * d, IC.1 + sin(a) * d);
            if !self.eaux.pres(x, y, 16.0) && !self.ilots.iter().any(|b| hypot(b.c.0 - x, b.c.1 - y) < 40.0) {
                return dict! { "k" => k, "x" => x, "y" => y, "a" => self.R.R() * TAU };
            }
        }
        Val::None
    }
}

/// genererInterieur : les îlots (q, c, d, zone, main, aire, rôle…), les rues, l'enceinte (trace, rect, murLigne),
/// la citadelle, la gare, les routes jusqu'au bord de la scène.
pub fn generer_interieur(K: &Carte, Pf: &Val) -> Val {
    let (n, Rv, sd) = (Pf.at("n"), Pf.at("R").i(), Pf.at("sd").i());
    let Rf = Rv as f64;
    let (rues, plus) = (list![], list![]);
    let V = dict! {
        "Pf" => Pf, "type" => if Rv > 190 { "grande" } else if Rv > 110 { "moyenne" } else { "bourg" },
        "larg" => if Rv > 190 { list![4.5, 8] } else if Rv > 110 { list![5, 9] } else { list![6, 11] },
        "rues" => &rues, "lieux" => Val::dict(), "placeCentre" => false,
        "murLigne" => Val::None, "rect" => Val::None, "trace" => Val::None, "citadelle" => Val::None, "gare" => Val::None, "murInt" => Val::None,
        "plus" => &plus,
    };
    // (V['eau'] du Python : la fonction `eau` de ce module)
    let ang_routes: Vec<f64> = Pf.at("routes").iter().map(|r| r.at("a").f()).collect();
    let routesL = list![];
    for (k, r) in Pf.at("routes").iter().enumerate() {
        let mut pts = vec![];
        for d in (0..761).step_by(20) {
            let a = r.at("a").f() + 0.06 * sin(d as f64 / 90.0 + k as f64 * 2.1 + (sd % 7) as f64);
            pts.push((IC.0 + cos(a) * d as f64, IC.1 + sin(a) * d as f64));
        }
        let rl = r.copy();
        rl.set("pts", pts_val(&pts));
        routesL.push(rl);
    }
    V.set("routesL", routesL);
    let mut G = Interieur { eaux: Eaux::de(K, Pf), R: alea(sd), sd, ang_routes: ang_routes.clone(), ilots: vec![], rues, V: V.clone() };

    let m_val = Pf.at("modele");
    let m = m_val.s();
    let a_main = if ang_routes.is_empty() { 0.0 } else { ang_routes[0] };
    let fau = Pf.at("fau").or(1).f();
    let dfau = Pf.at("dfau").or(0).f();
    let dens = |x: f64| -> f64 {
        let v = x + dfau;
        if v < 1.0 {
            v
        } else {
            1.0
        }
    };
    let annee = Pf.at("annee").i();
    let rivs = Pf.at("rivs");
    if m == "grande" {
        let rings = G.polaire(26.0, Rf * 0.58, 0.34, 24.0, 0.1, "ville", Val::None);
        let ml = rings[rings.len() - 1] + 8.0;
        V.set("murLigne", ml);
        let ax = if rivs.truthy() {
            let rp = pts_de(&rivs.at(0).at("pts"));
            let (p0, p1) = (rp[0], rp[rp.len() - 1]);
            atan2(p1.1 - p0.1, p1.0 - p0.0)
        } else {
            a_main
        };
        let n2 = (Rf * 2.1 / 34.0).ceil() as i64;
        let garder = |c: Pt| -> bool {
            let d = hypot(c.0 - IC.0, c.1 - IC.1);
            d > ml + 16.0 && d < Rf * (1.0 + 0.1 * sin(atan2(c.1 - IC.1, c.0 - IC.0) * 3.0))
        };
        G.grille(IC.0, IC.1, ax, n2, n2, 34.0, 7.0, Some(&garder));
        for &a in &ang_routes {
            G.ruban(a, Rf + 10.0, Rf * 1.5 * fau, 40.0, 30.0, Some(dens(if annee >= 1860 { 0.95 } else { 0.7 })));
        }
    } else if matches!(m, "ville" | "port" | "castrum" | "rond" | "montagne") {
        let r1 = if m == "montagne" { Rf * 0.95 } else { Rf };
        G.polaire(
            if m == "castrum" { 30.0 } else { 18.0 },
            r1,
            if m == "montagne" { 0.7 } else { 0.36 },
            if matches!(m, "rond" | "castrum") { 22.0 } else { 26.0 },
            if m == "montagne" { 0.35 } else { 0.1 },
            if m == "montagne" { "faubourg" } else { "ville" },
            if m == "montagne" { list![true, true, true, true] } else { Val::None },
        );
        V.set("murLigne", if m == "montagne" { Val::from(r1 + 9.0) } else { Val::from(Rv + 9) });
        for &a in &ang_routes {
            G.ruban(a, r1 + 12.0, r1 * (if annee >= 1860 { 1.7 } else { 1.4 }) * fau, 40.0, 32.0, Some(dens(0.75)));
        }
    } else if matches!(m, "bastide" | "place") {
        let nx = clamp(jround(Rf / 19.0), 4, 9);
        let pas: i64 = if m == "place" { 30 } else { 33 };
        let ny = nx - (if m == "bastide" { 1 } else { 0 });
        G.grille(IC.0, IC.1, a_main, nx, ny, pas as f64, 0.0, None);
        V.set("rect", dict! { "a" => a_main, "w" => nx * pas, "h" => ny * pas });
        for &a in &ang_routes {
            G.ruban(a, (nx * pas) as f64 * 0.75 + 34.0, (nx * pas) as f64 * 1.25 * fau, 40.0, 32.0, Some(dens(0.6)));
        }
    } else if m == "rue" {
        let r = if ang_routes.is_empty() { 0.0 } else { ang_routes[0] };
        let r2 = if ang_routes.len() > 1 { ang_routes[1] } else { r + PI };
        G.ruban(r, 0.0, Rf * 1.5 * fau, 46.0, 30.0, None);
        G.ruban(r2, 30.0, Rf * 1.5 * fau, 46.0, 30.0, None);
    } else if m == "airial" {
        for &a in &ang_routes {
            G.ruban(a, 22.0, 70.0 * fau, 36.0, 30.0, Some(dens(0.8)));
        }
        for _ in 0..9 {
            let a = G.R.R() * TAU;
            let d = 120.0 + G.R.R() * 220.0;
            plus.push(dict! { "k" => "airial", "x" => IC.0 + cos(a) * d, "y" => IC.1 + sin(a) * d, "a" => G.R.R() * TAU });
        }
    }
    // --- les lieux
    let lieux = V.at("lieux");
    let villes: Vec<usize> = (0..G.ilots.len()).filter(|&b| G.ilots[b].zone == "ville").collect();
    if matches!(m, "bastide" | "place") {
        let c = G.le_plus_pres(&villes, IC.0, IC.1, None);
        G.role(c, "place");
        // (le filtre du Python, `b is not c` : sans place, rien n'est écarté)
        let e = G.le_plus_pres(&villes, IC.0 + 30.0, IC.1 + 30.0, c);
        G.role(e, "eglise");
        if m == "place" {
            let l: Vec<usize> = villes.iter().copied().filter(|&b| G.ilots[b].role.is_none()).collect();
            for b in py::sorted_by_key(l, |&b| -G.ilots[b].d).into_iter().take(3) {
                G.role(Some(b), "caserne");
            }
        }
    } else if !matches!(m, "rue" | "airial" | "fortin") {
        V.set("placeCentre", true);
        lieux.set("place", IC);
        let l0: Vec<usize> = villes.iter().copied().filter(|&b| G.ilots[b].entier("anneau") == Some(0)).collect();
        let l0 = py::sorted_by_key(l0, |&b| -G.ilots[b].aire);
        let cath = G.role(l0.first().copied(), if m == "grande" { "cathedrale" } else { "eglise" });
        if let (Some(cath), true) = (cath, m == "grande") {
            let sc = G.ilots[cath].entier("secteur").unwrap();
            let nb = villes.iter().copied().find(|&b| {
                let il = &G.ilots[b];
                il.role.is_none() && il.entier("anneau") == Some(0) && il.entier("secteur").is_some_and(|s| (s - sc).abs() == 1)
            });
            if let Some(nb) = nb {
                G.ilots[nb].role = Some("parvis");
                G.ilots[cath].voisin = Some(nb);
            }
        }
        if m == "grande" {
            let libres = |G: &Interieur, d0: f64, d1: f64| -> Vec<usize> {
                villes.iter().copied().filter(|&b| G.ilots[b].role.is_none() && Rf * d0 < G.ilots[b].d && G.ilots[b].d < Rf * d1).collect()
            };
            let sans_role = |G: &Interieur| -> Vec<usize> { villes.iter().copied().filter(|&b| G.ilots[b].role.is_none()).collect() };
            for k in 0..4 {
                let ta = k as f64 * TAU / 4.0 + 0.6;
                let l = py::sorted_by_key(libres(&G, 0.25, 0.9), |&b| ang_diff(atan2(G.ilots[b].c.1 - IC.1, G.ilots[b].c.0 - IC.0), ta).abs());
                G.role(l.first().copied(), if k % 2 != 0 { "egliseDome" } else { "eglise" });
            }
            let l = libres(&G, 0.4, 0.95);
            G.role(l.get(2).copied(), "couvent");
            let l = libres(&G, 0.5, 1.0);
            G.role(l.get(5).copied(), "couvent");
            if rivs.truthy() {
                let rp = pts_de(&rivs.at(0).at("pts"));
                let l = sans_role(&G);
                // (une rivière à deux points confondus : dist_poly rend NaN pour tous, et le tri de Python, dont
                // aucune comparaison n'est vraie, laisse la liste telle quelle)
                let l = if dist_poly(&rp, IC.0, IC.1).is_nan() { l } else { py::sorted_by_key(l, |&b| dist_poly(&rp, G.ilots[b].c.0, G.ilots[b].c.1)) };
                G.role(l.first().copied(), if Pf.at("port").truthy() && n.at("type") == "capitale" { "royale" } else { "hopital" });
            }
            let l = py::sorted_by_key(libres(&G, 0.6, 1.1), |&b| -G.ilots[b].aire);
            G.role(l.first().copied(), "jardin");
            for b in libres(&G, 0.2, 0.55).into_iter().skip(2).step_by(5).take(4) {
                G.role(Some(b), "hotel");
            }
            for b in py::sorted_by_key(sans_role(&G), |&b| -G.ilots[b].d).into_iter().take(2) {
                G.role(Some(b), "caserne");
            }
        } else if matches!(m, "ville" | "port") {
            let l: Vec<usize> = villes.iter().copied().filter(|&b| G.ilots[b].role.is_none() && G.ilots[b].d > Rf * 0.5).collect();
            let l = py::sorted_by_key(l, |&b| -G.ilots[b].aire);
            G.role(l.first().copied(), "couvent");
        }
    } else if matches!(m, "rue" | "airial") {
        if let Some(b) = G.ilots.iter_mut().find(|b| b.d < 80.0) {
            b.role = Some("eglise");
            lieux.set("eglise", b.c);
        }
    }
    // --- les métiers de la ville (plus : {k, x, y, a})
    let add = |o: Val| {
        if o.truthy() {
            plus.push(o);
        }
    };
    let spec = Pf.at("spec");
    if spec.has("vin") {
        for _ in 0..3 {
            add(G.autour(Rf + 60.0, Rf + 300.0, "chateauVin"));
        }
    }
    if spec.has("bois") {
        add(G.autour(Rf + 30.0, Rf + 140.0, "scierie"));
    }
    if spec.has("fer") {
        add(G.autour(Rf + 30.0, Rf + 160.0, "forge"));
    }
    if spec.has("sel") {
        add(G.autour(Rf + 20.0, Rf + 120.0, "salines"));
    }
    if spec.has("tabac") {
        for _ in 0..2 {
            add(G.autour(Rf + 30.0, Rf + 200.0, "sechoir"));
        }
    }
    if spec.has("ble") || matches!(m, "rond" | "rue") {
        for _ in 0..2 {
            add(G.autour(Rf + 40.0, Rf + 220.0, "moulin"));
        }
    }
    for _ in 0..(if n.at("type") == "village" { 5 } else { 8 }) {
        add(G.autour(Rf + 50.0, 460.0, if Pf.at("style") == "landes" { "airial" } else { "ferme" }));
    }
    if Pf.at("citadelle").truthy() {
        let a1 = if ang_routes.len() > 1 { ang_routes[1] } else { 1.0 };
        let a = if rivs.truthy() {
            if Pf.at("mer").truthy() {
                Pf.at("mer").at("a").f()
            } else {
                a1
            }
        } else {
            a1 + 0.4
        };
        let d = V.at("murLigne").or(Rv).f() + 60.0;
        let ct = bastions(IC.0 + cos(a) * d, IC.1 + sin(a) * d, 5, if n.at("type") == "capitale" { 70.0 } else { 56.0 }, a + PI);
        V.set("citadelle", &ct);
        lieux.set("citadelle", ct.at("C"));
        let C = ct.at("C").xy();
        for b in G.ilots.iter_mut() {
            if hypot(b.c.0 - C.0, b.c.1 - C.1) < 150.0 {
                b.supprime = true;
            }
        }
    }
    if Pf.at("murs") == "bastions" {
        let N = if m == "fortin" { 5 } else { clamp(jround(Rf / 32.0), 5, 9) };
        let besoin = if m == "fortin" {
            60.0
        } else {
            py::max_f(std::iter::once(60.0).chain(G.ilots.iter().filter(|b| b.zone == "ville" && !b.supprime).map(|b| b.portee()))).unwrap() + 4.0
        };
        let (mut Rb, mut interieur) = (besoin, 0.0);
        let mut k = 0;
        while k < 30 && interieur < besoin {
            let trace = bastions(IC.0, IC.1, N, Rb, a_main + PI / N as f64);
            interieur = py::min_f(trace.at("cotes").iter().map(|c| {
                let GA = c.at("GA").xy();
                hypot(GA.0 - IC.0, GA.1 - IC.1)
            }))
            .unwrap()
                - 20.0;
            V.set("trace", trace);
            Rb *= 1.05;
            k += 1;
        }
        V.set("Rb", Rb / 1.05);
        V.set("murInt", interieur);
        for b in G.ilots.iter_mut() {
            if b.zone == "ville" && b.portee() > interieur {
                b.supprime = true;
            } else if b.zone == "faubourg" && b.d < Rb + 110.0 {
                b.supprime = true;
            }
        }
        if m == "fortin" {
            plus.push(dict! { "k" => "fortin" });
            lieux.set("place", IC);
        }
    }
    if annee >= 1860 && Pf.at("pop") > 3000 {
        let a = (if ang_routes.len() > 1 { ang_routes[1] } else { a_main }) + 0.5;
        let d = V.at("murLigne").or(Rv).f() + 70.0;
        let g = (IC.0 + cos(a) * d, IC.1 + sin(a) * d);
        V.set("gare", dict! { "x" => g.0, "y" => g.1, "a" => a + PI / 2.0 });
        for b in G.ilots.iter_mut() {
            if hypot(b.c.0 - g.0, b.c.1 - g.1) < 80.0 {
                b.supprime = true;
            }
        }
    }
    if m == "castrum" {
        lieux.set("chateau", IC);
    }
    let ilots = &G.ilots;
    V.set("ilots", ilots.iter().filter(|b| !b.supprime).map(|b| b.val(ilots)).collect::<Val>());
    let bord = py::max_f(std::iter::once(40.0).chain(ilots.iter().filter(|b| !b.supprime && b.zone == "ville").map(|b| b.portee()))).unwrap();
    if V.at("murInt").truthy() {
        V.set("rMur", V.at("murInt") + 10);
    } else if V.at("rect").truthy() {
        V.set("rMur", hypot(V.at("rect").at("w").f(), V.at("rect").at("h").f()) / 2.0 + 6.0);
    } else if V.at("murLigne").truthy() && m != "montagne" {
        V.set("rMur", V.at("murLigne"));
    } else {
        V.set("rMur", bord + 9.0);
    }
    V
}

/// Le plan de la place nid dans cet état (gardé : le même état rend le même objet).
/// plan(geo, nid, annee=1789, f=None, pop=None, d=0) : `Val::None` vaut le défaut du Python.
pub fn plan(geo: &impl Geo, nid: i64, annee: impl Into<Val>, f: impl Into<Val>, pop: impl Into<Val>, d: impl Into<Val>) -> Val {
    let K = carte_de(geo);
    let n = K.noeud.at(nid);
    let Pf = profil_ville(&K, &n, annee, f, pop, d);
    let cle = tup![nid, Pf.at("annee"), Pf.at("f"), Pf.at("R"), Pf.at("d")];
    let mut V = K.plans.get(&cle);
    if V.is_none() {
        V = generer_interieur(&K, &Pf);
        K.plans.set(&cle, &V);
        if K.plans.len() > 64 {
            K.plans.pop(&K.plans.keys()[0]);
        }
    }
    V
}
