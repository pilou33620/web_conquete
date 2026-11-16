//! Carte d'une bataille tactique : 3 000 × 2 000 m, grille de 20 m (150 × 100 cases). Le portage de
//! game/tactics/terrain.py.
//!
//! Construite à partir des cases de campagne autour de la bataille (terrain, rivières, routes, places proches),
//! puis enrichie de bruit procédural déterministe (graine) : bosquets, haies, champs en lanières, vignes en rangs,
//! fermes, chemins, ruisseaux, mares, relief.
//!
//! Composée comme les cartes d'Ultimate General (SPEC-CARTES.md) : les parcelles sont des îlots aux formes variées
//! (cellules de Voronoï), coupés en lanières dans le sens de la route voisine ou des courbes de niveau ; le terroir
//! s'organise autour des maisons (vergers, petits champs), le long de l'eau (prés) et selon la pente (pas de labours sur
//! les pentes fortes) ; les bois ont des lisières découpées, des clairières, et des bosquets parsèment les champs ; les
//! haies suivent les bords des îlots, les chemins des fermes les longent. Une place forte ou une ville occupe le centre quand la bataille s'y livre,
//! avec ses rues, son enceinte, ses portes, la brèche du siège et ses barricades.
//!
//! Coordonnées en mètres : x vers l'est (0 à 3 000), y vers le sud (0 à 2 000), comme la carte de campagne.
//! Case (i, j) : centre en ((i + 0,5) × 20, (j + 0,5) × 20), indice c = j × 150 + i.
//!
//! Ce qui change de forme en Rust (le reste se lit côte à côte avec le Python) :
//! - `t` est `m.t` : une fonction qui recevait la carte `m` et sa grille `t` ne reçoit plus que `m` ;
//! - un tracé est un `Vec<Pt>` pendant les calculs, une liste de tuples (`Val`) une fois rangé dans la carte ;
//! - un ensemble de cases est un `BTreeSet<usize>` (parcouru dans l'ordre des cases) ;

use crate::geo::{GeoMap, T_COLLINES, T_DUNES, T_EAU as G_EAU, T_FORET, T_HAUTE, T_LANDE, T_MARAIS, T_MONTAGNE, T_OCEAN, T_PLAINE, T_VIGNE};
use crate::py::{self, heapq, Random, Val};
use crate::tactics::plan_ville as PV;
use crate::tactics::terrain_v1;
use crate::tactics::terrain_ville as TV;
use crate::{dict, list, py_const, tup};
use indexmap::IndexMap;
use std::collections::{BTreeSet, HashMap};
use std::f64::consts::PI;

// version du générateur : écrite dans la description de chaque nouvelle bataille (bridge.make_spec). Une bataille sans
// version (ancienne sauvegarde) est refabriquée par le générateur d'avant (terrain_v1.py, figé) : même carte qu'au début.
// Version 9 : la place sur le plan organique de la carte de campagne (terrain_ville.py, plan_organique.py) ; le client
// reçoit ce plan (to_client : plan). Les versions 2 à 8 (plans de « Voir l'intérieur ») ne sont plus gardées : une
// bataille en ville de ces versions se refait sur le plan organique (SPEC-VILLES-BATAILLE.md).
pub const VERSION: i64 = 9;

// les ponts datés (ville, rivière, année ; comme villes.js, PONTS_DATES) : avant, la route passe sur un pont de bateaux
pub const PONTS_DATES: [(&str, &str, i64); 11] = [
    ("Bordeaux", "Garonne", 1822), // (le pont de pierre)
    ("Libourne", "Dordogne", 1824),
    ("Agen", "Garonne", 1827),
    ("Bergerac", "Dordogne", 1825), // (Bergerac : vers 1825)
    ("Saint-André-de-Cubzac", "Dordogne", 1839), // (ponts suspendus : Cubzac, 1839)
    ("Sainte-Foy-la-Grande", "Dordogne", 1829),
    ("Langon", "Garonne", 1831),
    ("Tonneins", "Garonne", 1833),
    ("La Réole", "Garonne", 1835),
    ("Marmande", "Garonne", 1838), // (Marmande : 1836 selon d'autres sources)
    ("Cadillac", "Garonne", 1835), // (date approximative : non trouvée)
];

pub const W: i64 = 3000;
pub const H: i64 = 2000;
pub const CELL: i64 = 20;
pub const COLS: i64 = W / CELL;
pub const ROWS: i64 = H / CELL;
pub const N: i64 = COLS * ROWS;
// (les mêmes, pour les indices et pour les calculs flottants)
const NU: usize = N as usize;
const CU: usize = COLS as usize;
const RU: usize = ROWS as usize;
const WF: f64 = W as f64;
const HF: f64 = H as f64;
const CELLF: f64 = CELL as f64;

// Types de case (ordre du contrat) ; BARRICADE est un ajout (ouvrages de fortune : muret franchissable lentement)
// VERGER est le dernier venu (SPEC-CARTES.md) : prés plantés d'arbres fruitiers autour des maisons, couvert léger ; ajouté
// à la fin, les numéros des autres ne changent pas (sauvegardes)
pub const T_PRE: i64 = 0;
pub const T_CHAMP: i64 = 1;
pub const T_VIGNE_T: i64 = 2;
pub const T_LANDE_T: i64 = 3;
pub const T_BOIS: i64 = 4;
pub const T_FORET_T: i64 = 5;
pub const T_MARAIS_T: i64 = 6;
pub const T_EAU: i64 = 7;
pub const T_GUE: i64 = 8;
pub const T_ROUTE: i64 = 9;
pub const T_CHEMIN: i64 = 10;
pub const T_BATI: i64 = 11;
pub const T_MUR: i64 = 12;
pub const T_BRECHE: i64 = 13;
pub const T_PORTE: i64 = 14;
pub const T_SABLE: i64 = 15;
pub const T_ROCHE: i64 = 16;
pub const T_BARRICADE: i64 = 17;
pub const T_VERGER: i64 = 18;
pub const TYPE_NAMES: [&str; 19] = [
    "PRE", "CHAMP", "VIGNE", "LANDE", "BOIS", "FORET", "MARAIS", "EAU", "GUE", "ROUTE", "CHEMIN", "BATI", "MUR", "BRECHE", "PORTE", "SABLE", "ROCHE", "BARRICADE",
    "VERGER",
];
// Éléments linéaires (couche à part, `f`) : bordent champs et chemins, donnent un couvert léger à moyen
pub const F_NONE: i64 = 0;
pub const F_CLOTURE: i64 = 1;
pub const F_HAIE: i64 = 2;
pub const F_MURET: i64 = 3;
pub const FEAT_NAMES: [&str; 4] = ["", "cloture", "haie", "muret"];
// probabilité qu'un bord de parcelle porte une clôture ou un muret (en plus des haies du bocage)
pub const FENCE: [(i64, f64); 9] =
    [(T_PLAINE, 0.22), (T_COLLINES, 0.30), (T_VIGNE, 0.32), (T_MONTAGNE, 0.30), (T_HAUTE, 0.15), (T_LANDE, 0.08), (T_MARAIS, 0.12), (T_FORET, 0.05), (T_DUNES, 0.0)];
pub const STONY: [&str; 2] = ["24", "64"]; // pays de pierre : murets plutôt que clôtures
pub const TYPE_LABEL: [&str; 19] = [
    "Prairie", "Champs", "Vignes", "Lande", "Bois", "Forêt", "Marais", "Eau", "Gué", "Route", "Chemin", "Maisons", "Rempart", "Brèche", "Porte", "Sable", "Rochers",
    "Barricade", "Verger",
];
pub const CULTIVE: [i64; 4] = [T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T]; // ce que le terroir peut réattribuer (C2)

// amplitude du relief (m) selon le terrain de campagne
pub const AMP: [(i64, i64); 11] = [
    (T_OCEAN, 0),
    (G_EAU, 0),
    (T_PLAINE, 7),
    (T_FORET, 14),
    (T_LANDE, 4),
    (T_MARAIS, 1),
    (T_COLLINES, 38),
    (T_MONTAGNE, 66),
    (T_HAUTE, 80),
    (T_DUNES, 18),
    (T_VIGNE, 16),
];
// seuil du bruit au-dessus duquel pousse un bois (plus bas = plus boisé)
pub const WOOD: [(i64, f64); 9] =
    [(T_PLAINE, 0.70), (T_FORET, 0.30), (T_LANDE, 0.56), (T_MARAIS, 0.78), (T_COLLINES, 0.60), (T_MONTAGNE, 0.47), (T_HAUTE, 0.72), (T_DUNES, 0.50), (T_VIGNE, 0.80)];
// cultures des parcelles : [(type, poids)]
pub const CROPS: [(i64, &[(i64, i64)]); 9] = [
    (T_PLAINE, &[(T_CHAMP, 55), (T_PRE, 30), (T_VIGNE_T, 5), (T_LANDE_T, 4)]),
    (T_VIGNE, &[(T_VIGNE_T, 66), (T_CHAMP, 14), (T_PRE, 14)]),
    (T_COLLINES, &[(T_CHAMP, 38), (T_PRE, 38), (T_VIGNE_T, 8), (T_LANDE_T, 6)]),
    (T_LANDE, &[(T_LANDE_T, 70), (T_PRE, 10), (T_CHAMP, 6)]),
    (T_FORET, &[(T_PRE, 50), (T_CHAMP, 30), (T_LANDE_T, 20)]),
    (T_MARAIS, &[(T_MARAIS_T, 55), (T_PRE, 40)]),
    (T_MONTAGNE, &[(T_PRE, 45), (T_LANDE_T, 40), (T_ROCHE, 6)]),
    (T_HAUTE, &[(T_ROCHE, 45), (T_LANDE_T, 35), (T_PRE, 20)]),
    (T_DUNES, &[(T_SABLE, 70), (T_LANDE_T, 30)]),
];
// bocage : part des bords de parcelles plantés de haies, selon le département
pub const BOCAGE: [(&str, f64); 5] = [("64", 0.38), ("24", 0.26), ("47", 0.14), ("40", 0.10), ("33", 0.04)];
// cultures supplémentaires selon le pays (vignes du Bordelais et de Bergerac, prés du Béarn…)
pub const DEPT_CROPS: [(&str, &[(i64, i64)]); 5] =
    [("33", &[(T_VIGNE_T, 20)]), ("24", &[(T_PRE, 10)]), ("47", &[(T_CHAMP, 15)]), ("64", &[(T_PRE, 20)]), ("40", &[(T_LANDE_T, 10)])];
pub const FARMS: [(i64, i64); 9] =
    [(T_PLAINE, 6), (T_VIGNE, 5), (T_COLLINES, 5), (T_LANDE, 3), (T_FORET, 2), (T_MARAIS, 2), (T_MONTAGNE, 3), (T_HAUTE, 1), (T_DUNES, 1)];
pub const RIVER_W: [(i64, i64); 3] = [(1, 130), (2, 50), (3, 22)]; // largeur des cours d'eau (m) selon leur rang

/// Un point d'un tracé, en mètres.
pub type Pt = (f64, f64);

/// `table.get(k)` d'un dict de Python écrit en tableau de paires (FENCE, AMP, WOOD, CROPS…).
pub fn cherche<K: PartialEq + Copy, V: Copy>(table: &[(K, V)], k: K) -> Option<V> {
    table.iter().find(|p| p.0 == k).map(|p| p.1)
}
/// `v in (T_A, T_B…)` : les types de case sont des `i64` (constantes), les grilles des octets.
#[inline]
pub fn dans(v: u8, types: &[i64]) -> bool {
    types.contains(&(v as i64))
}
/// `min(a, b)` et `max(a, b)` de Python entre flottants : le premier gagne en cas d'égalité (0.0 contre −0.0).
#[inline]
pub fn pmin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
#[inline]
pub fn pmax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// Un tracé rangé dans la carte : une liste de tuples (x, y).
pub fn pts_val(pts: &[Pt]) -> Val {
    Val::list(pts.iter().map(|&p| Val::from(p)).collect())
}
/// Un tracé relu de la carte (`r['pts']`).
pub fn pts_de(v: &Val) -> Vec<Pt> {
    v.iter().map(|p| p.xy()).collect()
}
/// Un tracé venu de `_random_crossing` : son dernier point garde la coordonnée entière que Python lui laisse
/// (W + 40 ou H + 40 : `tuple(pts[-1])` de `_densify`, gardé par `_meander`) ; to_client l'écrit « 3040 », pas « 3040.0 ».
pub fn pts_val_traverse(pts: &[Pt]) -> Val {
    let v = pts_val(pts);
    let (x, y) = pts[pts.len() - 1];
    v.set(-1, if x == (W + 40) as f64 { tup![W + 40, y] } else { tup![x, H + 40] });
    v
}
/// `[[round(x), round(y)] for x, y in pts]`.
pub fn pts_ronds(pts: &[Pt]) -> Val {
    Val::list(pts.iter().map(|&(x, y)| list![py::round(x), py::round(y)]).collect())
}
/// `base64.b64encode(octets).decode()` (aide hors du socle).
pub fn b64(octets: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(octets.len().div_ceil(3) * 4);
    for m in octets.chunks(3) {
        let n = (m[0] as u32) << 16 | (*m.get(1).unwrap_or(&0) as u32) << 8 | *m.get(2).unwrap_or(&0) as u32;
        s.push(A[(n >> 18) as usize & 63] as char);
        s.push(A[(n >> 12) as usize & 63] as char);
        s.push(if m.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if m.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    s
}

/// `TV.PV.carte_de(geo)` : plan_ville lit la carte de campagne par son trait `Geo` ; la GeoMap le porte ici, où le
/// Python s'en sert (aide hors des modules de la carte : geo.rs et plan_ville.rs ne la donnent pas).
impl PV::Geo for GeoMap {
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
        GeoMap::xy(self, lat, lon)
    }
}

pub fn _hash(a: i64, b: i64, seed: i64) -> f64 {
    // (seuls les 32 bits bas sont gardés : les produits peuvent déborder sans dommage)
    let n = (a.wrapping_mul(374761393).wrapping_add(b.wrapping_mul(668265263)).wrapping_add(seed.wrapping_mul(1442695041)) as u64) & 0xFFFFFFFF;
    let n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF;
    ((n ^ (n >> 16)) & 0xFFFF) as f64 / 65535.0
}

/// Bruit de valeurs lissé sur toute la grille (liste de N flottants entre 0 et 1). scale : taille d'un motif en cases.
/// (défauts de Python : octaves=2, persist=0.5)
pub fn noise(rng: &mut Random, scale: f64, octaves: usize, persist: f64) -> Vec<f64> {
    let mut out = vec![0.0; NU];
    let (mut amp, mut tot) = (1.0, 0.0);
    let mut s = scale;
    for _ in 0..octaves {
        let (gw, gh) = (py::int(COLS as f64 / s) as usize + 3, py::int(ROWS as f64 / s) as usize + 3);
        let lat: Vec<f64> = (0..gw * gh).map(|_| rng.random()).collect();
        let mut xs = Vec::with_capacity(CU);
        for i in 0..CU {
            let f = (i as f64 + 0.5) / s;
            let ix = py::int(f);
            let t = f - ix as f64;
            xs.push((ix as usize, t * t * (3.0 - 2.0 * t)));
        }
        for j in 0..RU {
            let f = (j as f64 + 0.5) / s;
            let iy = py::int(f);
            let u = f - iy as f64;
            let u = u * u * (3.0 - 2.0 * u);
            let (r0, r1) = (iy as usize * gw, (iy as usize + 1) * gw);
            let row: Vec<f64> = (0..gw).map(|k| lat[r0 + k] + (lat[r1 + k] - lat[r0 + k]) * u).collect();
            let base = j * CU;
            for (i, &(ix, t)) in xs.iter().enumerate() {
                let a = row[ix];
                out[base + i] += (a + (row[ix + 1] - a) * t) * amp;
            }
        }
        tot += amp;
        amp *= persist;
        s /= 2.0;
    }
    let inv = 1.0 / tot;
    out.iter().map(|v| v * inv).collect()
}

/// Flou de boîte séparable (rayon r cases).
pub fn blur(vals: &[f64], r: usize) -> Vec<f64> {
    let mut tmp = vec![0.0; NU];
    let k = 1.0 / (2 * r + 1) as f64;
    let glisse = |ligne: &[f64], sortie: &mut dyn FnMut(usize, f64)| {
        let mut pad = vec![ligne[0]; r];
        pad.extend_from_slice(ligne);
        pad.extend(std::iter::repeat(ligne[ligne.len() - 1]).take(r));
        let mut s = py::sum(pad[..2 * r + 1].iter().copied());
        for i in 0..ligne.len() {
            sortie(i, s * k);
            s += if i + 2 * r + 1 < pad.len() { pad[i + 2 * r + 1] - pad[i] } else { 0.0 };
        }
    };
    for j in 0..RU {
        let base = j * CU;
        glisse(&vals[base..base + CU], &mut |i, v| tmp[base + i] = v);
    }
    let mut out = vec![0.0; NU];
    for i in 0..CU {
        let col: Vec<f64> = (0..RU).map(|j| tmp[j * CU + i]).collect();
        glisse(&col, &mut |j, v| out[j * CU + i] = v);
    }
    out
}

/// Distance en cases (4-voisinage) depuis des cases sources, plafonnée à maxd (255 au-delà).
pub fn bfs(sources: &[usize], maxd: i64, passable: Option<&dyn Fn(usize) -> bool>) -> Vec<u8> {
    let mut dist = vec![255u8; NU];
    let mut q: Vec<usize> = sources.to_vec();
    for &c in &q {
        dist[c] = 0;
    }
    let mut k = 0;
    while k < q.len() {
        let c = q[k];
        k += 1;
        let d = dist[c] as i64 + 1;
        if d > maxd {
            continue;
        }
        let i = c % CU;
        let c = c as i64;
        for nc in [if i < CU - 1 { c + 1 } else { -1 }, if i > 0 { c - 1 } else { -1 }, c + COLS, c - COLS] {
            if 0 <= nc && nc < N && dist[nc as usize] as i64 > d && passable.is_none_or(|p| p(nc as usize)) {
                dist[nc as usize] = u8::try_from(d).expect("ValueError: byte must be in range(0, 256)");
                q.push(nc as usize);
            }
        }
    }
    dist
}

/// La case du point (x, y), ou -1 hors du champ.
pub fn cell_of(x: f64, y: f64) -> i64 {
    let (i, j) = (py::int(py::floordiv_f(x, CELLF)), py::int(py::floordiv_f(y, CELLF)));
    if 0 <= i && i < COLS && 0 <= j && j < ROWS {
        return j * COLS + i;
    }
    -1
}

pub fn center_of(c: usize) -> Pt {
    (((c % CU) as f64 + 0.5) * CELLF, ((c / CU) as f64 + 0.5) * CELLF)
}

/// Carte générée : t (types), h (altitudes), et les objets dessinés par le client.
pub struct BattleMap {
    pub t: Vec<u8>,
    pub h: Vec<u8>,
    pub roads: Val,
    pub rivers: Val,
    pub buildings: Val,
    pub walls: Val,
    pub hedges: Val,
    pub f: Vec<u8>,
    pub fences: Val,
    pub bridges: Val,
    pub place: Val,
    pub heart: Val,
    pub town_r: f64,
    pub biome: Option<Vec<u8>>,
    pub region: String,
    pub stats: Val,
    pub town: Val,                   // la place : {type, x, y, r, siecle, enceinte} (SPEC-2D § 6)
    pub bastions: Val,               // sommets du tracé magistral d'une place bastionnée
    pub demi_lunes: Val,             // [[b1, saillant, b2], …] devant les courtines
    pub batis: Val,                  // un par bâtiment (groupe de cases bâties d'un seul tenant) : {kind, toit, x, y, c}
    pub kinds: HashMap<usize, String>, // (génération) case bâtie → nature du bâtiment
    pub plan: Val,                   // (version 4) le plan de la ville pour le client (terrain_ville.py)
    pub garder: IndexMap<usize, u8>, // (génération, version 4) cases des métiers du plan que le terroir ne change pas
    /// (génération) le numéro de l'îlot et de la lanière de chaque case : `m.ilot`, `m.strip` de Python.
    pub ilot: Option<Vec<i64>>,
    pub strip: Option<Vec<i64>>,
    /// Une carte du générateur d'avant (terrain_v1) : la classe BattleMap de terrain_v1.py n'a pas town, bastions,
    /// demi_lunes, batis, kinds, plan ni garder (ils restent vides ici) et son to_client est celui de terrain_v1.
    pub v1: bool,
}

impl Default for BattleMap {
    fn default() -> Self {
        Self::new()
    }
}

impl BattleMap {
    pub fn new() -> BattleMap {
        BattleMap {
            t: vec![0; NU],
            h: vec![0; NU],
            roads: list![],
            rivers: list![],
            buildings: list![],
            walls: list![],
            hedges: list![],
            f: vec![0; NU],
            fences: list![],
            bridges: list![],
            place: Val::None,
            heart: Val::None,
            town_r: 0.0,
            biome: None,
            region: String::new(),
            stats: dict! {},
            town: Val::None,
            bastions: list![],
            demi_lunes: list![],
            batis: list![],
            kinds: HashMap::new(),
            plan: Val::None,
            garder: IndexMap::new(),
            ilot: None,
            strip: None,
            v1: false,
        }
    }

    pub fn to_client(&self, spec: &Val) -> Val {
        if self.v1 {
            return terrain_v1::to_client(self, spec);
        }
        dict! {
            "W" => W, "H" => H, "cell" => CELL, "cols" => COLS, "rows" => ROWS,
            "t" => b64(&self.t), "h" => b64(&self.h),
            "roads" => Val::list(self.roads.iter().map(|r| r2_pts(&r.at("pts"))).collect()),
            "road_kinds" => Val::list(self.roads.iter().map(|r| r.at("kind")).collect()),
            "rivers" => Val::list(self.rivers.iter().map(|r| dict!{"w" => r.at("w"), "pts" => r2_pts(&r.at("pts")), "kind" => r.at("kind"), "name" => r.get("name")}).collect()),
            "buildings" => &self.buildings, "walls" => &self.walls, "place" => &self.place,
            "hedges" => Val::list(self.hedges.iter().map(|hd| r2_pts(&hd)).collect()), "bridges" => &self.bridges,
            "f" => b64(&self.f), "feature_names" => noms(&FEAT_NAMES),
            "fences" => Val::list(self.fences.iter().map(|f| dict!{"kind" => f.at(0), "pts" => r2_pts(&f.at(1))}).collect()),
            "heart" => if self.heart.truthy() { self.heart.to_list() } else { Val::None },
            "town" => &self.town, "bastions" => &self.bastions, "demi_lunes" => &self.demi_lunes, "batis" => &self.batis, "plan" => &self.plan,
            "seed" => spec.at("seed"), "season" => spec.at("season"), "weather" => spec.at("weather"), "year" => spec.get("year"),
            "marks" => spec.get_or("marks", list![list![], list![]]), "balloon" => spec.get_or("balloon", list![0, 0]),   // (le ballon captif : SPEC-SUITE J)
            "camp" => dict!{"x" => spec.at("cx"), "y" => spec.at("cy")}, "region" => &self.region,
            "types" => noms(&TYPE_NAMES), "labels" => noms(&TYPE_LABEL),
        }
    }
}

/// `[r2(p) for p in pts]` de to_client, avec `r2 = lambda p: [round(p[0], 1), round(p[1], 1)]` (un entier reste entier).
pub fn r2_pts(pts: &Val) -> Val {
    let r1 = |v: Val| match v {
        Val::Float(x) => Val::Float(py::round_n(x, 1)),
        autre => autre,
    };
    Val::list(pts.iter().map(|p| list![r1(p.at(0)), r1(p.at(1))]).collect())
}
/// Une liste de textes (TYPE_NAMES, FEAT_NAMES…) en valeur de Python.
pub fn noms(l: &[&str]) -> Val {
    Val::list(l.iter().map(|s| Val::str(s)).collect())
}

// ====================================================================== tracés
pub fn _densify(pts: &[Pt], step: f64) -> Vec<Pt> {
    let mut out = vec![];
    for q in pts.windows(2) {
        let ((x1, y1), (x2, y2)) = (q[0], q[1]);
        let L = py::hypot(x2 - x1, y2 - y1);
        let n = py::int(L / step).max(1);
        for s in 0..n {
            let t = s as f64 / n as f64;
            out.push((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t));
        }
    }
    if let Some(&p) = pts.last() {
        out.push(p);
    }
    out
}

/// Méandres : décalage perpendiculaire lisse le long d'un tracé densifié. calme ((x, y), r) : pas de méandre à
/// moins de r de ce point (la ville du plan : la rivière y suit son tracé de campagne), peu à peu sur 400 m.
pub fn _meander(pts: Vec<Pt>, rng: &mut Random, amp: f64, wave: f64, calme: Option<(Pt, f64)>) -> Vec<Pt> {
    if pts.len() < 3 || amp <= 0.0 {
        return pts;
    }
    let (ph1, ph2) = (rng.random() * 6.28, rng.random() * 6.28);
    let w2 = wave * (0.37 + rng.random() * 0.2);
    let mut out = vec![pts[0]];
    let mut s = 0.0;
    let n = pts.len();
    for k in 1..n - 1 {
        let ((x0, y0), (x1, y1), (x2, y2)) = (pts[k - 1], pts[k], pts[k + 1]);
        s += py::hypot(x1 - x0, y1 - y0);
        let (dx, dy) = (x2 - x0, y2 - y0);
        let mut L = py::hypot(dx, dy);
        if L == 0.0 {
            L = 1.0;
        }
        let (nx, ny) = (-dy / L, dx / L);
        let off = amp * (0.7 * (s / wave * 6.283 + ph1).sin() + 0.3 * (s / w2 * 6.283 + ph2).sin());
        // les extrémités restent en place (raccord aux villes)
        let mut k_end = pmin(pmin(1.0, k as f64 / 4.0), (n - 1 - k) as f64 / 4.0);
        if let Some(((qx, qy), r)) = calme {
            let u = pmin(1.0, pmax(0.0, (py::hypot(x1 - qx, y1 - qy) - r) / 400.0));
            k_end *= u * u * (3.0 - 2.0 * u);
        }
        out.push((x1 + nx * off * k_end, y1 + ny * off * k_end));
    }
    out.push(pts[n - 1]);
    out
}

/// Garde la partie d'un tracé qui passe sur le champ de bataille (morceaux successifs).
pub fn _clip_poly(pts: &[Pt], margin: f64) -> Vec<Vec<Pt>> {
    let (mut parts, mut cur): (Vec<Vec<Pt>>, Vec<Pt>) = (vec![], vec![]);
    let (x0, y0, x1, y1) = (-margin, -margin, WF + margin, HF + margin);
    for &p in pts {
        if x0 <= p.0 && p.0 <= x1 && y0 <= p.1 && p.1 <= y1 {
            cur.push(p);
        } else if !cur.is_empty() {
            cur.push(p);
            parts.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    // raccroche le point précédent l'entrée sur la carte
    parts.into_iter().filter(|part| part.len() >= 2).collect()
}

/// Applique f(c) à toutes les cases à moins de radius (m) du tracé. Rend ces cases, dans l'ordre où elles sont
/// touchées (un set en Python, que personne ne parcourt). (défaut de Python : step=8.0 ; le paramètre m, inutile, a disparu)
pub fn _stamp(pts: &[Pt], radius: f64, f: &mut dyn FnMut(usize), step: f64) -> Vec<usize> {
    let rc = py::int(py::floordiv_f(radius, CELLF)) + 1;
    let r2 = radius * radius;
    let mut seen = vec![false; NU];
    let mut ordre = vec![];
    for (x, y) in _densify(pts, step) {
        let (ci, cj) = (py::int(py::floordiv_f(x, CELLF)), py::int(py::floordiv_f(y, CELLF)));
        for dj in -rc..=rc {
            let j = cj + dj;
            if j < 0 || j >= ROWS {
                continue;
            }
            let cy = (j as f64 + 0.5) * CELLF - y;
            for di in -rc..=rc {
                let i = ci + di;
                if i < 0 || i >= COLS {
                    continue;
                }
                let c = (j * COLS + i) as usize;
                if seen[c] {
                    continue;
                }
                let cx = (i as f64 + 0.5) * CELLF - x;
                if cx * cx + cy * cy <= r2 {
                    seen[c] = true;
                    ordre.push(c);
                    f(c);
                }
            }
        }
    }
    ordre
}

/// Cases traversées par un segment (pas d'une demi-case).
pub fn _line_cells(x1: f64, y1: f64, x2: f64, y2: f64) -> Vec<usize> {
    let L = py::hypot(x2 - x1, y2 - y1);
    let n = py::int(L / (CELLF * 0.5)).max(1);
    let mut out = vec![];
    let mut last = -1;
    for s in 0..=n {
        let t = s as f64 / n as f64;
        let c = cell_of(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
        if c >= 0 && c != last {
            out.push(c as usize);
            last = c;
        }
    }
    out
}

pub fn _poly_cells(pts: &[Pt]) -> Vec<usize> {
    let mut out = vec![];
    for q in pts.windows(2) {
        out.extend(_line_cells(q[0].0, q[0].1, q[1].0, q[1].1));
    }
    out
}

/// `to_m` de generate : de la carte de campagne (km) au champ (m), à l'échelle k.
fn to_m(xk: f64, yk: f64, cx: f64, cy: f64, k: f64) -> Pt {
    ((xk - cx) * 1000.0 * k + WF / 2.0, (yk - cy) * 1000.0 * k + HF / 2.0)
}

// ====================================================================== génération
/// Carte de la bataille décrite par spec (voir bridge.make_spec) ; déterministe pour une graine donnée.
pub fn generate(geo: &GeoMap, spec: &Val) -> BattleMap {
    if spec.get_or("carte", 1) < 2 {
        return terrain_v1::generate(geo, spec);
    }
    let seed = py::int_v(&spec.at("seed")) & 0x7FFFFFFF;
    let mut rng = Random::new(seed);
    let mut m = BattleMap::new();
    let (cx, cy) = (spec.at("cx").f(), spec.at("cy").f());
    // (ce que vaut une case de la carte de campagne : 1 km, ou 5 en Europe ; le champ se lit à cette échelle)
    let km = geo.km_case;

    // ---------------------------------------------------------- la place, ou le lieu tout près d'une bataille rangée
    let mut pl = spec.get("place");
    if pl.is_none() {
        let mut best: Option<(f64, Val)> = None;
        for gn in geo.nodes.clone().iter() {
            let d = py::hypot(gn.at("x").f() - cx, gn.at("y").f() - cy);
            if d < 1.3 / km && best.as_ref().is_none_or(|b| d < b.0) {
                best = Some((d, gn));
            }
        }
        if let Some((_, gn)) = best {
            pl = dict! {"nid" => gn.at("id"), "name" => gn.at("name"), "type" => gn.at("type"), "fort" => 0, "dmg" => 0.0, "bar" => 0.0, "pop" => gn.at("pop0"),
            "x" => gn.at("x"), "y" => gn.at("y"), "battle" => false};
            let lieu = spec.get("lieu").or(dict! {});
            if lieu.get("nid") == gn.at("id") {
                // (son état dans la partie : enceinte, taille, faubourgs)
                pl.set("f", lieu.get_or("f", gn.at("fort")));
                pl.set("pop", lieu.get("pop").or(gn.at("pop0")));
                pl.set("d", lieu.get_or("d", 0));
            } else {
                pl.set("f", gn.at("fort"));
            }
        }
    }
    // version 4 : la place sur son plan (celui de « Voir l'intérieur », terrain_ville.py) ; une place trop grande pour
    // le champ réduit toute la carte (k)
    let L: Option<TV::Lieu> = if pl.truthy() { Some(TV::preparer(geo, spec, &pl, cx, cy)) } else { None };
    // (BOGUE DU PYTHON, porté tel quel : la boucle du relief range son propre « k » dans cette variable ; to_m, les
    // routes à moins de 2 km et les bacs lisent ensuite cette valeur au lieu de l'échelle de la carte)
    let mut k = L.as_ref().map_or(1.0, |l| l.k);
    let eau_plan = L.as_ref().map(|_| PV::carte_de(geo));

    // ---------------------------------------------------------- terrain de campagne sous chaque case
    let (jx, jy) = (noise(&mut rng, 16.0, 2, 0.5), noise(&mut rng, 16.0, 2, 0.5));
    let (gt, gW, gH) = (&geo.terrain[..], geo.W, geo.H);
    let mut biome = vec![0u8; NU];
    for j in 0..RU {
        let yk0 = cy + ((j as f64 + 0.5) * CELLF - HF / 2.0) / (1000.0 * k * km);
        let base = j * CU;
        for i in 0..CU {
            let c = base + i;
            let mut X = cx + ((i as f64 + 0.5) * CELLF - WF / 2.0) / (1000.0 * k * km) + (jx[c] - 0.5) * 0.9 / km;
            let mut Y = yk0 + (jy[c] - 0.5) * 0.9 / km;
            if let Some(l) = &L {
                if py::hypot((i as f64 + 0.5) * CELLF - l.pos.0, (j as f64 + 0.5) * CELLF - l.pos.1) < l.r_eau {
                    // (autour de la ville, la mer et les étangs du plan : sans le tremblé, le rivage lissé de l'intérieur)
                    (X, Y) = (X - (jx[c] - 0.5) * 0.9 / km, Y - (jy[c] - 0.5) * 0.9 / km);
                    let (ii, jj) = (py::int(X), py::int(Y));
                    let b = if 0 <= ii && ii < gW && 0 <= jj && jj < gH { gt[(jj * gW + ii) as usize] as i64 } else { T_OCEAN };
                    let eau = b == T_OCEAN || b == G_EAU;
                    biome[c] = (if eau_plan.as_ref().unwrap().eauK(X, Y) > 0.5 {
                        if eau {
                            b
                        } else {
                            G_EAU
                        }
                    } else if eau {
                        T_PLAINE
                    } else {
                        b
                    }) as u8;
                    continue;
                }
            }
            let (ii, jj) = (py::int(X), py::int(Y));
            biome[c] = if 0 <= ii && ii < gW && 0 <= jj && jj < gH { gt[(jj * gW + ii) as usize] } else { T_OCEAN as u8 };
        }
    }
    m.biome = Some(biome.clone());
    let mut hist: Vec<(u8, i64)> = vec![]; // (dans l'ordre de première rencontre, comme le dict de Python)
    for &b in &biome {
        match hist.iter_mut().find(|p| p.0 == b) {
            Some(p) => p.1 += 1,
            None => hist.push((b, 1)),
        }
    }
    let land: Vec<(u8, i64)> = hist.iter().copied().filter(|p| !dans(p.0, &[T_OCEAN, G_EAU])).collect();
    let main = py::max_by_key(land, |p| p.1).map_or(T_PLAINE, |p| p.0 as i64);
    let dept = geo.dept_at(cx, cy).unwrap_or_default().to_string();
    m.region = _region_name(geo, cx, cy, main, &dept);

    // ---------------------------------------------------------- relief
    let amp = blur(&biome.iter().map(|&b| cherche(&AMP, b as i64).unwrap_or(8) as f64).collect::<Vec<f64>>(), 7);
    let nh = noise(&mut rng, 34.0, 3, 0.45);
    let mut hf = vec![0.0; NU];
    for c in 0..NU {
        let a = amp[c];
        let mut v = nh[c];
        if a > 30.0 {
            // montagne : crêtes marquées (passage progressif depuis les collines)
            k = pmin(1.0, (a - 30.0) / 30.0);
            v = v * (1.0 - k) + (1.0 - (2.0 * v - 1.0).abs() * 0.8) * k;
        }
        hf[c] = 3.0 + a * v;
    }

    // ---------------------------------------------------------- eau : rivières de campagne, lacs, océan
    for c in 0..NU {
        if dans(biome[c], &[T_OCEAN, G_EAU]) {
            m.t[c] = T_EAU as u8;
        }
    }
    let mut water_src: Vec<usize> = vec![]; // (jamais relu, comme en Python)
    for r in geo.src.at("rivers").iter() {
        let pts: Vec<Pt> = r
            .at("pts")
            .iter()
            .map(|p| {
                let (lon, lat) = p.xy();
                let (x, y) = geo.xy(lat, lon);
                to_m(x, y, cx, cy, k * km)
            })
            .collect();
        // segments qui approchent du champ de bataille
        let near: Vec<usize> = (0..pts.len()).filter(|&q| -2500.0 <= pts[q].0 && pts[q].0 <= WF + 2500.0 && -2500.0 <= pts[q].1 && pts[q].1 <= HF + 2500.0).collect();
        if near.is_empty() {
            continue;
        }
        let (k0, k1) = (near[0].saturating_sub(1), (near[near.len() - 1] + 2).min(pts.len()));
        let sub = &pts[k0..k1];
        if sub.len() < 2 || !_poly_near_field(sub) {
            continue;
        }
        let (name, rank) = (r.at("name"), r.at("rank"));
        let w = cherche(&RIVER_W, rank.i()).unwrap_or(22) as f64 * (if name == "Adour" || name == "Lot" || name == "Isle" { 0.75 } else { 1.0 });
        let mut dense = _densify(sub, 40.0);
        if let Some(l) = &L {
            if !l.rivieres.has(&name) {
                // (une rivière que le plan ne voit pas passe hors de la ville)
                dense = TV::ecarter(&dense, l.pos, l.r_ville + w / 2.0 + 40.0);
            }
        }
        let dense = _meander(dense, &mut rng, 35.0 + w * 0.4, 520.0 + w * 2.0, L.as_ref().map(|l| (l.pos, l.r_calme)));
        for part in _clip_poly(&dense, 200.0) {
            m.rivers.push(dict! {"w" => py::round(w), "pts" => pts_val(&part), "kind" => if rank.i() > 1 { "riviere" } else { "fleuve" }, "name" => &name, "rank" => &rank});
            let t = &mut m.t;
            water_src.extend(_stamp(&part, w / 2.0, &mut |c| t[c] = T_EAU as u8, 8.0));
        }
    }
    // ruisseaux procéduraux (gués sur toute leur longueur)
    if main != T_DUNES && rng.random() < (if m.rivers.is_empty() { 0.75 } else { 0.35 }) {
        for _ in 0..(if rng.random() < 0.7 { 1 } else { 2 }) {
            let mut pts = _densify(&_random_crossing(&mut rng), 40.0);
            let mut traverse = true; // (le dernier point garde sa coordonnée entière tant qu'il n'est pas recalculé)
            if let Some(l) = &L {
                let ecarte = TV::ecarter(&pts, l.pos, l.r_ville + 40.0);
                traverse = ecarte == pts;
                pts = ecarte;
            }
            let pts = _meander(pts, &mut rng, 45.0, 300.0, None);
            m.rivers.push(dict! {"w" => 8, "pts" => if traverse { pts_val_traverse(&pts) } else { pts_val(&pts) }, "kind" => "ruisseau", "name" => Val::None, "rank" => 4});
            for c in _poly_cells(&pts) {
                if m.t[c] as i64 != T_EAU {
                    m.t[c] = T_GUE as u8;
                    water_src.push(c);
                }
            }
        }
    }
    let _ = water_src;
    // vallées : le relief se creuse vers l'eau
    let wsrc: Vec<usize> = (0..NU).filter(|&c| dans(m.t[c], &[T_EAU, T_GUE])).collect();
    let dwat = if !wsrc.is_empty() { bfs(&wsrc, 14, None) } else { vec![255u8; NU] };
    for c in 0..NU {
        let d = dwat[c];
        if d < 14 {
            hf[c] *= 0.18 + 0.82 * py::pow(d as f64 / 14.0, 1.4);
        }
    }
    // gués des rivières (rang 2 et 3) : 1 à 3 passages peu profonds
    for r in m.rivers.iter() {
        if r.at("kind") != "riviere" {
            continue;
        }
        let nf = 1 + py::int(rng.random() * (if r.at("rank") == 3 { 3.0 } else { 2.0 }));
        let dense = _densify(&pts_de(&r.at("pts")), 20.0);
        let inside: Vec<Pt> = dense.into_iter().filter(|p| 60.0 < p.0 && p.0 < WF - 60.0 && 60.0 < p.1 && p.1 < HF - 60.0).collect();
        for _ in 0..nf {
            if inside.is_empty() {
                break;
            }
            let p = inside[rng.randrange(inside.len() as i64) as usize];
            let t = &mut m.t;
            _stamp(
                &[p, p],
                r.at("w").f() / 2.0 + 12.0,
                &mut |c| {
                    if t[c] as i64 == T_EAU {
                        t[c] = T_GUE as u8
                    }
                },
                8.0,
            );
            r.setdefault("fords", list![]).push(list![py::round(p.0), py::round(p.1)]);
        }
    }

    // ---------------------------------------------------------- tracé des routes de campagne (à moins de 2 km) : avant les
    // parcelles, dont les sillons les suivent (posées sur la carte plus bas)
    let plan_routes = match &L {
        Some(l) => TV::routes(l, geo, &pl.at("nid")),
        None => HashMap::new(),
    };
    let nodes = geo.nodes.clone();
    for (ei, e) in geo.edges.iter().enumerate() {
        if e.get("kind") == "water" || e.get("ferry").truthy() {
            continue;
        }
        let (A, B) = (nodes.at(&e.at("a")), nodes.at(&e.at("b")));
        let dense = if let Some(route) = plan_routes.get(&ei) {
            // (la route du plan, par ses rues et sa porte, puis tout droit vers l'autre lieu)
            let l = L.as_ref().unwrap();
            let Q = if e.at("a") == pl.at("nid") { &B } else { &A };
            let pb = to_m(Q.at("x").f(), Q.at("y").f(), cx, cy, k * km);
            let loin = py::hypot(pb.0 - l.pos.0, pb.1 - l.pos.1) * 0.85;
            let mut head: Vec<Pt> = route.iter().copied().filter(|p| py::hypot(p.0 - l.pos.0, p.1 - l.pos.1) < loin).collect();
            let suite = _meander(_densify(&[head[head.len() - 1], pb], 50.0), &mut rng, 18.0, 700.0, None);
            head.extend_from_slice(&suite[1..]);
            head
        } else {
            if _seg_dist(cx, cy, A.at("x").f(), A.at("y").f(), B.at("x").f(), B.at("y").f()) > 2.0 / (k * km) {
                continue;
            }
            let (pa, pb) = (to_m(A.at("x").f(), A.at("y").f(), cx, cy, k * km), to_m(B.at("x").f(), B.at("y").f(), cx, cy, k * km));
            let dense = _densify(&[pa, pb], 50.0);
            _meander(dense, &mut rng, 18.0, 700.0, None)
        };
        for part in _clip_poly(&dense, 100.0) {
            m.roads.push(dict! {"pts" => pts_val(&part), "kind" => if e.get("royal").truthy() { "royale" } else { "route" }});
        }
    }
    if m.roads.is_empty() {
        let pts = _meander(_densify(&_random_crossing(&mut rng), 50.0), &mut rng, 40.0, 500.0, None);
        m.roads.push(dict! {"pts" => pts_val_traverse(&pts), "kind" => "chemin"});
    }

    // ---------------------------------------------------------- couvert : bois, marais, parcelles
    let nw = noise(&mut rng, 13.0, 3, 0.55);
    let nlis = noise(&mut rng, 3.0, 1, 0.5); // (lisières découpées : le seuil des bois bousculé de près, C3)
    let (ilot, strip) = _ilots(seed, &hf, &m.roads, main);
    let year = spec.get_or("year", 1790).i();
    let nwet = noise(&mut rng, 9.0, 2, 0.5);
    let crops_extra: &[(i64, i64)] = cherche(&DEPT_CROPS, dept.as_str()).unwrap_or(&[]);
    let mut bocage = cherche(&BOCAGE, dept.as_str()).unwrap_or(0.1) * (if main == T_COLLINES || main == T_PLAINE { 1.4 } else { 0.6 });
    if main == T_LANDE {
        bocage *= 0.3;
    }
    let fence_p = cherche(&FENCE, main).unwrap_or(0.2);
    let wall_kind = if STONY.contains(&dept.as_str()) || [T_MONTAGNE, T_HAUTE, T_VIGNE].contains(&main) { F_MURET } else { F_CLOTURE };
    for j in 0..RU {
        let base = j * CU;
        for i in 0..CU {
            let c = base + i;
            if dans(m.t[c], &[T_EAU, T_GUE]) {
                continue;
            }
            let b = biome[c] as i64;
            let mut wthr = cherche(&WOOD, b).unwrap_or(0.7);
            if b == T_LANDE && year < 1857 {
                wthr += 0.12; // avant la loi de 1857, la lande rase domine : les pins sont encore rares
            }
            if dwat[c] <= 2 && b != T_MARAIS {
                wthr += 0.05;
            }
            let v = nw[c] + (nlis[c] - 0.5) * 0.12;
            if v > wthr {
                let dense = (b == T_FORET || b == T_MONTAGNE) && v > wthr + 0.18;
                m.t[c] = (if dense { T_FORET_T } else { T_BOIS }) as u8;
                continue;
            }
            if b == T_MARAIS && nwet[c] > 0.45 || (b == T_LANDE && nwet[c] > 0.74) || (dwat[c] <= 3 && nwet[c] > 0.66 && (b == T_PLAINE || b == T_LANDE)) {
                m.t[c] = T_MARAIS_T as u8;
                continue;
            }
            if (b == T_MONTAGNE || b == T_HAUTE) && hf[c] > 0.86 * amp[c] + 3.0 {
                m.t[c] = T_ROCHE as u8;
                continue;
            }
            // parcelle : la lanière de son îlot (C1), sa culture tirée d'après son numéro
            let crops = cherche(&CROPS, b).unwrap_or_else(|| cherche(&CROPS, T_PLAINE).unwrap());
            let tot: i64 = crops.iter().chain(crops_extra).map(|p| p.1).sum();
            let mut x = _hash(strip[c], 5, seed) * tot as f64;
            let mut ty = 0;
            for &(ty_, w) in crops.iter().chain(crops_extra) {
                ty = ty_;
                x -= w as f64;
                if x <= 0.0 {
                    break;
                }
            }
            m.t[c] = ty as u8;
            // haies et clôtures sur les bords des îlots (C4) : tout un bord a le même sort (les deux îlots qu'il sépare)
            let il = ilot[c];
            let other = if i < CU - 1 && ilot[c + 1] != il {
                ilot[c + 1]
            } else if j < RU - 1 && ilot[c + CU] != il {
                ilot[c + CU]
            } else {
                -1
            };
            if other >= 0 && CULTIVE.contains(&ty) && _hash(i as i64, j as i64, seed + 7) > 0.12 {
                // (des trouées, des barrières ouvertes)
                let (a, bb) = (il.min(other), il.max(other));
                let hv = _hash(a, bb + 11, seed);
                if hv < bocage && ty != T_VIGNE_T {
                    m.f[c] = F_HAIE as u8;
                } else if hv < bocage + fence_p {
                    m.f[c] = (if ty == T_VIGNE_T || _hash(a, bb, seed + 3) < 0.7 {
                        wall_kind
                    } else if wall_kind == F_MURET {
                        F_CLOTURE
                    } else {
                        F_MURET
                    }) as u8;
                }
            }
        }
    }
    (m.ilot, m.strip) = (Some(ilot), Some(strip));

    // mares
    if [T_PLAINE, T_LANDE, T_MARAIS, T_COLLINES].contains(&main) {
        for _ in 0..rng.randrange(4) {
            let c = rng.randrange(N) as usize;
            if dans(m.t[c], &[T_PRE, T_LANDE_T, T_CHAMP, T_MARAIS_T]) {
                m.t[c] = T_EAU as u8;
            }
        }
    }

    _bois_details(&mut rng, &mut m.t);

    // ---------------------------------------------------------- routes de campagne : tracées plus haut, posées ici
    let mut road_cells: BTreeSet<usize> = BTreeSet::new();
    let mut bacs: Vec<(Pt, &str)> = vec![];
    for (v, rv, an) in PONTS_DATES {
        if year < an {
            for gn in nodes.iter() {
                if gn.at("name") == v {
                    bacs.push((to_m(gn.at("x").f(), gn.at("y").f(), cx, cy, k * km), rv));
                }
            }
        }
    }
    for r in m.roads.iter() {
        road_cells.extend(_poly_cells(&pts_de(&r.at("pts"))));
    }
    for r in m.roads.iter() {
        let cells = _poly_cells(&pts_de(&r.at("pts")));
        let sol = (if r.at("kind") != "chemin" { T_ROUTE } else { T_CHEMIN }) as u8;
        let mut wet_run: Vec<usize> = vec![];
        for &c in &cells {
            if dans(m.t[c], &[T_EAU, T_GUE]) {
                wet_run.push(c);
            } else if !wet_run.is_empty() {
                _add_bridge(&mut m, &wet_run);
                let b = m.bridges.at(-1);
                if bacs.iter().any(|(p, rv)| b.at("river") == *rv && py::hypot(b.at("x").f() - p.0, b.at("y").f() - p.1) < 5000.0 * k) {
                    b.set("kind", "bateaux"); // (pas encore de pont : les troupes passent sur des bateaux)
                }
                wet_run.clear();
            }
            m.t[c] = sol;
        }
        for &c in &wet_run {
            m.t[c] = sol;
        }
    }
    // un grand fleuve sans pont ni gué sur la carte : un pont de bateaux, pour que la bataille ait un passage
    for r in m.rivers.iter() {
        if r.at("kind") == "fleuve" && !r.get("fords").truthy() && !m.bridges.iter().any(|b| b.get("river") == r.at("name")) {
            _force_bridge(&mut m, &r, &mut rng);
        }
    }

    // ---------------------------------------------------------- place, ville ou village
    // (bataille rangée près d'un lieu : son village apparaît sur la carte ; pl est choisi plus haut)
    if let Some(l) = &L {
        TV::ville(&mut m, &pl, l, &mut rng, spec, &road_cells);
    }

    // ---------------------------------------------------------- fermes, moulin, chemins
    _farms(&mut m, &mut rng, cherche(&FARMS, main).unwrap_or(3), &hf, main);
    _mill(&mut m, &mut rng, &hf, main);
    _terroir(&mut m, seed, &hf, &dwat, &biome, &dept);
    for (&c, &ty) in &m.garder {
        // (vignes et salines des métiers du plan : le terroir ne les réattribue pas)
        if dans(m.t[c], &[T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T, T_VERGER, T_MARAIS_T]) {
            m.t[c] = ty;
        }
    }
    _batis(&mut m, seed, &dept, year);

    // ---------------------------------------------------------- altitude finale
    for c in 0..NU {
        let mut v = hf[c];
        if m.t[c] as i64 == T_EAU {
            v = pmin(v, 2.0);
        }
        m.h[c] = if v < 0.0 {
            0
        } else if v > 80.0 {
            80
        } else {
            py::int(v) as u8
        };
    }
    // éléments linéaires : pas sur les routes, l'eau ni le bâti ; les chemins creux du bocage sont bordés de haies
    for c in 0..NU {
        if dans(m.t[c], &[T_ROUTE, T_CHEMIN, T_EAU, T_GUE, T_BATI, T_MUR, T_BRECHE, T_PORTE, T_BARRICADE, T_BOIS, T_FORET_T]) {
            m.f[c] = F_NONE as u8;
        }
    }
    (m.ilot, m.strip) = (None, None); // (seulement pour la génération)
    if bocage > 0.12 {
        for c in CU..NU - CU {
            if m.t[c] as i64 == T_CHEMIN && _hash(c as i64, 17, seed) < bocage {
                for nc in [c - 1, c + 1, c - CU, c + CU] {
                    if dans(m.t[nc], &[T_CHAMP, T_PRE, T_LANDE_T]) {
                        m.f[nc] = F_HAIE as u8;
                    }
                }
            }
        }
    }
    for k in [F_CLOTURE, F_HAIE, F_MURET] {
        let cells: Vec<usize> = (0..NU).filter(|&c| m.f[c] as i64 == k).collect();
        for (a, b) in _hedge_lines(&cells) {
            m.fences.push(tup![FEAT_NAMES[k as usize], list![a, b]]);
        }
    }
    m.hedges = Val::list(m.fences.iter().filter(|f| f.at(0) == "haie").map(|f| f.at(1)).collect());
    m.stats = dict! {"main" => main, "dept" => &dept, "hist" => _compte(&m.t, &TYPE_NAMES, 0, false), "feat" => _compte(&m.f, &FEAT_NAMES, 1, true)};
    m
}

/// `{noms[k]: grille.count(k) for k in range(debut, len(noms))}` de m.stats ; sans les zéros si `tous` est faux.
pub fn _compte(grille: &[u8], noms: &[&str], debut: usize, tous: bool) -> Val {
    let d = dict! {};
    for (k, nom) in noms.iter().enumerate().skip(debut) {
        let n = grille.iter().filter(|&&v| v as usize == k).count();
        if n > 0 || tous {
            d.set(*nom, n);
        }
    }
    d
}

pub fn _region_name(_geo: &GeoMap, _cx: f64, _cy: f64, main: i64, dept: &str) -> String {
    let names = [
        (T_PLAINE, "plaine"),
        (T_FORET, "forêt"),
        (T_LANDE, "landes"),
        (T_MARAIS, "marais"),
        (T_COLLINES, "collines"),
        (T_MONTAGNE, "montagne"),
        (T_HAUTE, "haute montagne"),
        (T_DUNES, "dunes"),
        (T_VIGNE, "vignoble"),
    ];
    format!("{} ({})", cherche(&names, main).unwrap_or("plaine"), if dept.is_empty() { "?" } else { dept })
}

pub fn _poly_near_field(pts: &[Pt]) -> bool {
    pts.windows(2).any(|q| _seg_dist(WF / 2.0, HF / 2.0, q[0].0, q[0].1, q[1].0, q[1].1) < 1900.0)
}

pub fn _seg_dist(px: f64, py_: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let (dx, dy) = (x2 - x1, y2 - y1);
    let L2 = dx * dx + dy * dy;
    let t = if L2 <= 0.0 { 0.0 } else { pmax(0.0, pmin(1.0, ((px - x1) * dx + (py_ - y1) * dy) / L2)) };
    py::hypot(px - x1 - t * dx, py_ - y1 - t * dy)
}

/// Tracé d'un bord de la carte au bord opposé.
pub fn _random_crossing(rng: &mut Random) -> Vec<Pt> {
    if rng.random() < 0.5 {
        let a = (-40.0, rng.uniform(200.0, HF - 200.0));
        let b = (WF / 2.0 + rng.uniform(-500.0, 500.0), rng.uniform(300.0, HF - 300.0));
        return vec![a, b, (WF + 40.0, rng.uniform(200.0, HF - 200.0))];
    }
    let a = (rng.uniform(300.0, WF - 300.0), -40.0);
    let b = (rng.uniform(600.0, WF - 600.0), HF / 2.0 + rng.uniform(-300.0, 300.0));
    vec![a, b, (rng.uniform(300.0, WF - 300.0), HF + 40.0)]
}

/// Haies en tronçons (pour le dessin) : cases voisines alignées regroupées.
pub fn _hedge_lines(cells: &[usize]) -> Vec<(Pt, Pt)> {
    let mut s = vec![false; NU];
    for &c in cells {
        s[c] = true;
    }
    let mut out = vec![];
    let mut done = vec![false; NU];
    for &c in cells {
        if done[c] {
            continue;
        }
        for step in [1, CU] {
            if c >= step && s[c - step] && (step == CU || c % CU != 0) {
                continue;
            }
            let mut run = vec![c];
            let mut k = c;
            while k + step < NU && s[k + step] && (step == CU || (k + 1) % CU != 0) {
                k += step;
                run.push(k);
            }
            if run.len() >= 2 {
                for &q in &run {
                    done[q] = true;
                }
                out.push((center_of(run[0]), center_of(run[run.len() - 1])));
                break;
            }
        }
    }
    out
}

pub fn _add_bridge(m: &mut BattleMap, cells: &[usize]) {
    if cells.is_empty() {
        return;
    }
    let ((x1, y1), (x2, y2)) = (center_of(cells[0]), center_of(cells[cells.len() - 1]));
    let mut name = Val::None;
    let mut best = 1e9;
    for r in m.rivers.iter() {
        for p in pts_de(&r.at("pts")).into_iter().step_by(3) {
            let d = py::pow(p.0 - x1, 2.0) + py::pow(p.1 - y1, 2.0);
            if d < best {
                (best, name) = (d, r.get("name"));
            }
        }
    }
    m.bridges.push(dict! {"x" => py::round((x1 + x2) / 2.0), "y" => py::round((y1 + y2) / 2.0), "a" => py::round_n((y2 - y1).atan2(x2 - x1), 2),
    "len" => py::round(py::hypot(x2 - x1, y2 - y1) + CELLF), "river" => name});
}

pub fn _force_bridge(m: &mut BattleMap, r: &Val, rng: &mut Random) {
    let dense = _densify(&pts_de(&r.at("pts")), 20.0);
    let inside: Vec<usize> = (0..dense.len()).filter(|&k| 400.0 < dense[k].0 && dense[k].0 < WF - 400.0 && 300.0 < dense[k].1 && dense[k].1 < HF - 300.0).collect();
    if inside.is_empty() {
        return;
    }
    let n = inside.len() as i64;
    // (un indice négatif de Python part de la fin : il arrive ici pour cinq points)
    let q = if n > 4 { n / 2 + rng.randrange2(py::floordiv_i(-n, 4) - 1, n / 4 + 1) } else { 0 };
    let k = inside[q.rem_euclid(n) as usize] as i64;
    let k = (dense.len() as i64 - 2).min(k).max(1) as usize;
    let ((x0, y0), (x1, y1)) = (dense[k - 1], dense[k + 1]);
    let mut L = py::hypot(x1 - x0, y1 - y0);
    if L == 0.0 {
        L = 1.0;
    }
    let (nx, ny) = (-(y1 - y0) / L, (x1 - x0) / L);
    let (px, py_) = dense[k];
    let half = r.at("w").f() / 2.0 + 50.0;
    let pts = [(px - nx * half, py_ - ny * half), (px + nx * half, py_ + ny * half)];
    let cells = _poly_cells(&pts);
    let wet: Vec<usize> = cells.iter().copied().filter(|&c| dans(m.t[c], &[T_EAU, T_GUE])).collect();
    for &c in &cells {
        if dans(m.t[c], &[T_EAU, T_GUE, T_MARAIS_T, T_BOIS, T_FORET_T]) {
            m.t[c] = T_ROUTE as u8;
        }
    }
    _add_bridge(m, if wet.is_empty() { &cells } else { &wet });
    m.bridges.at(-1).set("kind", "bateaux");
    m.roads.push(dict! {"pts" => pts_val(&pts), "kind" => "chemin"});
}

// ---------------------------------------------------------------------- place
/// La terre ferme : la plus grande étendue de cases sans eau d'un seul tenant.
pub fn _mainland(t: &[u8]) -> BTreeSet<usize> {
    let mut seen = vec![false; NU];
    let mut best: Vec<usize> = vec![];
    for s in 0..NU {
        if seen[s] || t[s] as i64 == T_EAU {
            continue;
        }
        let (mut comp, mut todo) = (vec![s], vec![s]);
        seen[s] = true;
        while let Some(c) = todo.pop() {
            let i = c % CU;
            let c = c as i64;
            for nc in [c - COLS, c + COLS, if i > 0 { c - 1 } else { -1 }, if i < CU - 1 { c + 1 } else { -1 }] {
                if 0 <= nc && nc < N && !seen[nc as usize] && t[nc as usize] as i64 != T_EAU {
                    seen[nc as usize] = true;
                    comp.push(nc as usize);
                    todo.push(nc as usize);
                }
            }
        }
        if comp.len() > best.len() {
            best = comp;
        }
    }
    best.into_iter().collect()
}

/// Chaussée et pont de la place à la terre ferme (land) : la traversée la plus courte, de préférence du côté de
/// l'assaillant. Renvoie ses cases (rues de la place : la porte s'y ouvre).
/// (Python parcourt le set `land` : à égalité exacte de v, la première case de SON ordre gagne ; ici, la plus petite.)
pub fn _causeway(m: &mut BattleMap, px: f64, py_: f64, att_a: f64, land: &BTreeSet<usize>) -> BTreeSet<usize> {
    let (mut best, mut bv): (Option<Pt>, f64) = (None, 1e18);
    for &c in land {
        let (x, y) = center_of(c);
        let d = py::hypot(x - px, y - py_);
        let v = d * (1.5 - 0.5 * ((y - py_).atan2(x - px) - att_a).cos());
        if v < bv {
            (best, bv) = (Some((x, y)), v);
        }
    }
    let Some(best) = best else { return BTreeSet::new() };
    let pts = [(px, py_), best];
    // (deux cases de large : une ligne en biais ne se touche que par les coins, et l'on n'y passerait pas)
    let cells: BTreeSet<usize> = _poly_cells(&pts).into_iter().flat_map(|c| [c, c + 1, c + CU]).filter(|&k| k < NU).collect();
    let wet: Vec<usize> = _poly_cells(&pts).into_iter().filter(|&c| m.t[c] as i64 == T_EAU).collect();
    for &c in &cells {
        if dans(m.t[c], &[T_EAU, T_MARAIS_T, T_BOIS, T_FORET_T]) {
            m.t[c] = T_ROUTE as u8;
        }
    }
    if !wet.is_empty() {
        _add_bridge(m, &wet);
    }
    m.roads.push(dict! {"pts" => pts_val(&pts), "kind" => "chemin"});
    cells
}

// ---------------------------------------------------------------------- villes et places (SPEC-2D § 6)
// selon le type de la place : pas des rues en cases (tirés au sort ; None : un bourg le long de ses routes), part des
// cases sur rue qui sont bâties, côté de la grand-place (cases), bâtiments publics en plus de l'église
py_const!(
    VILLES,
    dict! {
        "village" => dict!{"pas" => Val::None, "dens" => 0.95, "place" => 3, "egl" => 0, "couvent" => 0, "hotel" => 0, "caserne" => 0, "hopital" => 0},
        "fort" => dict!{"pas" => tup![5, 5, 6], "dens" => 0.9, "place" => 3, "egl" => 0, "couvent" => 0, "hotel" => 0, "caserne" => 2, "hopital" => 0},
        "ville" => dict!{"pas" => tup![5, 6, 6], "dens" => 0.92, "place" => 3, "egl" => 1, "couvent" => 1, "hotel" => 2, "caserne" => 0, "hopital" => 1},
        "capitale" => dict!{"pas" => tup![5, 5, 6], "dens" => 0.98, "place" => 5, "egl" => 3, "couvent" => 2, "hotel" => 4, "caserne" => 2, "hopital" => 1},
    }
);
// nature d'un bâtiment fait de cases de natures différentes : la première de la liste
pub const KINDS: [&str; 15] =
    ["cathedrale", "eglise", "caserne", "poudriere", "hopital", "couvent", "hotel", "halle", "chateau", "forge", "scierie", "sechoir", "moulin", "ferme", "maison"]; // (château viticole, forge… : les métiers du plan, version 4)
pub const NOBLE: [&str; 6] = ["eglise", "cathedrale", "hotel", "caserne", "couvent", "hopital"];
pub const RUE: [i64; 2] = [T_ROUTE, T_CHEMIN];

/// Cases d'un tracé, d'un seul tenant par les côtés (une case d'angle à chaque pas en diagonale : un mur ainsi tracé
/// ne se passe pas en diagonale, une porte ainsi ouverte se passe sans couper de coin).
pub fn _line4(pts: &[Pt]) -> Vec<usize> {
    let mut out: Vec<usize> = vec![];
    for c in _poly_cells(pts) {
        if let Some(&p) = out.last() {
            if p == c {
                continue;
            }
            if (p % CU).abs_diff(c % CU) == 1 && (p / CU).abs_diff(c / CU) == 1 {
                out.push(p / CU * CU + c % CU);
            }
        }
        out.push(c);
    }
    out
}

/// Fonction case → vrai si son centre est dans le polygone fermé (balayage par rangées).
pub fn _dedans(poly: &[Pt]) -> impl Fn(usize) -> bool {
    let mut rows: Vec<Vec<f64>> = vec![vec![]; RU];
    let n = poly.len();
    for (j, row) in rows.iter_mut().enumerate() {
        let y = (j as f64 + 0.5) * CELLF;
        let mut xs = vec![];
        for k in 0..n {
            let ((x1, y1), (x2, y2)) = (poly[k], poly[(k + 1) % n]);
            if (y1 <= y) != (y2 <= y) {
                xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).expect("TypeError: sort"));
        *row = xs;
    }
    move |c: usize| {
        let Some(xs) = rows.get(c / CU) else { return false };
        if xs.is_empty() {
            return false;
        }
        let x = ((c % CU) as f64 + 0.5) * CELLF;
        xs.iter().filter(|&&v| v < x).count() % 2 == 1
    }
}

/// Premier système de Vauban (maquette-2d.html, bastions) : polygone de nb côtés extérieurs inscrit dans Rb ; faces
/// aux 2/7 du côté, perpendiculaire au 1/8 (carré), 1/7 (pentagone), 1/6 au-delà. Renvoie le tracé magistral (sommets),
/// les demi-lunes [b1, saillant, b2] et le milieu de chaque courtine.
pub fn _vauban(px: f64, py_: f64, nb: i64, Rb: f64, rot: f64) -> (Vec<Pt>, Vec<Vec<Pt>>, Vec<Pt>) {
    let V: Vec<Pt> = (0..nb)
        .map(|k| {
            let a = rot + (k * 2) as f64 * PI / nb as f64;
            (px + a.cos() * Rb, py_ + a.sin() * Rb)
        })
        .collect();
    let (mut poly, mut ravs, mut mids) = (vec![], vec![], vec![]);
    for k in 0..nb as usize {
        let ((ax, ay), (bx, by)) = (V[k], V[(k + 1) % nb as usize]);
        let L = py::hypot(bx - ax, by - ay);
        let (mx, my) = ((ax + bx) / 2.0, (ay + by) / 2.0);
        let nl = py::hypot(px - mx, py_ - my);
        let (nx, ny) = ((px - mx) / nl, (py_ - my) / nl);
        let perp = L / (if nb <= 4 {
            8.0
        } else if nb == 5 {
            7.0
        } else {
            6.0
        });
        let (dx, dy) = (mx + nx * perp, my + ny * perp);
        let (la, lb) = (py::hypot(dx - ax, dy - ay), py::hypot(dx - bx, dy - by));
        let (ua, ub) = (((dx - ax) / la, (dy - ay) / la), ((dx - bx) / lb, (dy - by) / lb));
        let fa = (ax + ua.0 * 2.0 * L / 7.0, ay + ua.1 * 2.0 * L / 7.0);
        let fb = (bx + ub.0 * 2.0 * L / 7.0, by + ub.1 * 2.0 * L / 7.0);
        let r = py::hypot(fa.0 - fb.0, fa.1 - fb.1);
        let (ga, gb) = ((fb.0 + ub.0 * r, fb.1 + ub.1 * r), (fa.0 + ua.0 * r, fa.1 + ua.1 * r));
        poly.extend([fa, ga, gb, fb, (bx, by)]);
        let u = ((bx - ax) / L, (by - ay) / L);
        ravs.push(vec![
            (mx - nx * L * 0.04 - u.0 * L * 0.2, my - ny * L * 0.04 - u.1 * L * 0.2),
            (mx - nx * L * 0.34, my - ny * L * 0.34),
            (mx - nx * L * 0.04 + u.0 * L * 0.2, my - ny * L * 0.04 + u.1 * L * 0.2),
        ]);
        mids.push(((ga.0 + gb.0) / 2.0, (ga.1 + gb.1) / 2.0));
    }
    (poly, ravs, mids)
}

/// Tracé de l'enceinte : (sommets du polygone, demi-lunes). Mur médiéval : un cercle irrégulier à
/// R + 25 m ; tracé bastionné : une route arrive au milieu d'une courtine, la courtine reste à R + 30 m au moins.
pub fn _trace(pos: Pt, R: f64, bast: bool, rng: &mut Random, road_a: f64) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    let (px, py_) = pos;
    if !bast {
        let wob: Vec<f64> = (0..12).map(|_| rng.uniform(-0.06, 0.06)).collect();
        let mut pts = vec![];
        for k in 0..48 {
            let f = k as f64 / 4.0;
            let fi = py::int(f);
            let i0 = (fi % 12) as usize;
            let r = (R + 25.0) * (1.0 + wob[i0] * (1.0 - f + fi as f64) + wob[(i0 + 1) % 12] * (f - fi as f64));
            let a = (k * 2) as f64 * PI / 48.0;
            pts.push((px + a.cos() * r, py_ + a.sin() * r));
        }
        return (pts, vec![]);
    }
    let nb = py::round(2.0 * PI * (R + 80.0) / 260.0).min(9).max(5);
    let rot = road_a - PI / nb as f64;
    let mut Rb = (R + 40.0) / (PI / nb as f64).cos();
    loop {
        let (poly, ravs, _mids) = _vauban(px, py_, nb, Rb, rot);
        if py::min_f(poly.iter().map(|&(x, y)| py::hypot(x - px, y - py_))).unwrap() >= R + 30.0 {
            return (poly, ravs);
        }
        Rb += 10.0;
    }
}

/// Bâtiment public d'un seul tenant (w × h cases, est-ouest) au plus près de near ; ses abords (une case autour)
/// deviennent parvis (rue) ou enclos (pré) : il ne touche aucune maison. Renvoie ses cases (vide s'il n'y a pas la
/// place).
pub fn _poser(
    t: &mut [u8], cells_ok: &dyn Fn(usize) -> bool, near: Pt, w: i64, h: i64, kind: &str, kinds: &mut HashMap<usize, String>, reserve: &mut BTreeSet<usize>, parvis: i64,
) -> Vec<usize> {
    let (nx, ny) = near;
    let (i0, j0) = (py::int(py::floordiv_f(nx, CELLF)), py::int(py::floordiv_f(ny, CELLF)));
    let mut cand = vec![];
    for dj in -4..5 {
        for di in -4..5 {
            cand.push((di * di + dj * dj, i0 + di - py::floordiv_i(w, 2), j0 + dj - py::floordiv_i(h, 2)));
        }
    }
    cand.sort();
    for (_, i, j) in cand {
        if i < 1 || j < 1 || i + w >= COLS - 1 || j + h >= ROWS - 1 {
            continue;
        }
        let foot: Vec<usize> = (0..h).flat_map(|b| (0..w).map(move |a| ((j + b) * COLS + i + a) as usize)).collect();
        if !foot.iter().all(|&c| cells_ok(c)) {
            continue;
        }
        for b in -1..h + 1 {
            for a in -1..w + 1 {
                let c = ((j + b) * COLS + i + a) as usize;
                if reserve.contains(&c) || dans(t[c], &[T_EAU, T_GUE, T_MUR, T_PORTE]) {
                    continue;
                }
                reserve.insert(c);
                if 0 <= a && a < w && 0 <= b && b < h {
                    t[c] = T_BATI as u8;
                    kinds.insert(c, kind.to_string());
                } else if !dans(t[c], &RUE) {
                    t[c] = parvis as u8;
                }
            }
        }
        return foot;
    }
    vec![]
}

/// L'écart d'un angle à un autre, entre 0 et π : `abs(((a - b + pi) % (2 * pi)) - pi)`.
pub fn ecart_angle(a: f64, b: f64) -> f64 {
    (py::mod_f(a - b + PI, 2.0 * PI) - PI).abs()
}

/// Pose l'enceinte tracée par _town : murs (T_MUR), portes (T_PORTE) sur les routes et les rues qui la traversent,
/// glacis dégagé (140 m), brèches du siège du côté de l'assaillant ; le dessin (m.walls, m.bastions, m.demi_lunes).
/// Pour le plan des villes (terrain_ville) : kind et tours donnés ; une seconde enceinte (la citadelle, principal
/// faux) garde son tracé et ses demi-lunes dans son enregistrement.
/// (défauts de Python : kind=None, tours=None, principal=True)
pub fn _enceinte(
    m: &mut BattleMap, pl: &Val, pos: Pt, _R: f64, fort: i64, bast: bool, poly: &[Pt], ravs: &[Vec<Pt>], wall: &BTreeSet<usize>, inside: &dyn Fn(usize) -> bool,
    streets: &BTreeSet<usize>, rng: &mut Random, att_a: f64, kind: Option<&str>, tours: Option<Val>, principal: bool,
) {
    let (px, py_) = pos;
    let mut gates: Vec<usize> = wall.iter().copied().filter(|c| streets.contains(c)).collect();
    for &c in wall {
        m.t[c] = (if streets.contains(&c) { T_PORTE } else { T_MUR }) as u8;
    }
    // passage d'une porte : là où la route franchit le mur en diagonale, la case d'angle est ouverte aussi
    for r in m.roads.iter() {
        let cells = _poly_cells(&pts_de(&r.at("pts")));
        for q in cells.windows(2) {
            let (a, b) = (q[0], q[1]);
            if (wall.contains(&a) || wall.contains(&b)) && (a % CU).abs_diff(b % CU) == 1 && (a / CU).abs_diff(b / CU) == 1 {
                let k = a / CU * CU + b % CU;
                if m.t[k] as i64 == T_MUR {
                    m.t[k] = T_PORTE as u8;
                    gates.push(k);
                } else if !dans(m.t[k], &[T_PORTE, T_EAU]) {
                    m.t[k] = T_ROUTE as u8;
                }
            }
        }
    }
    if gates.is_empty() {
        // au moins une porte, du côté de l'assaillant, et sa rue jusqu'à la grand-place
        let best = py::min_by_key(wall.iter().copied(), |&c| {
            let (x, y) = center_of(c);
            ecart_angle((y - py_).atan2(x - px), att_a)
        })
        .expect("ValueError: min() arg is an empty sequence");
        m.t[best] = T_PORTE as u8;
        gates.push(best);
        let (x, y) = center_of(best);
        for c in _line4(&[(px, py_), (x, y), (x + (x - px) * 0.3, y + (y - py_) * 0.3)]) {
            if !dans(m.t[c], &[T_PORTE, T_EAU, T_MUR]) {
                m.t[c] = T_ROUTE as u8;
            } else if m.t[c] as i64 == T_MUR {
                m.t[c] = T_PORTE as u8;
            }
        }
    }
    // glacis : rien qui cache l'assaillant à moins de 140 m des murs
    let dg = bfs(&wall.iter().copied().collect::<Vec<usize>>(), 7, None);
    for c in 0..NU {
        if dg[c] <= 7 && dans(m.t[c], &[T_BOIS, T_FORET_T, T_VIGNE_T, T_VERGER]) && !inside(c) {
            m.t[c] = T_PRE as u8;
        }
    }
    let thick = CELL * (if fort <= 1 { 1 } else { 2 }) + 2;
    let kind = match kind {
        Some(k) if !k.is_empty() => k,
        _ => {
            if bast {
                "bastion"
            } else if fort == 1 {
                "mur"
            } else {
                "rempart"
            }
        }
    };
    let mut ferme = poly.to_vec();
    ferme.extend_from_slice(&poly[..1.min(poly.len())]);
    let trace = _densify(&ferme, 25.0);
    let wpts = pts_ronds(&trace);
    let tours = tours.unwrap_or_else(|| {
        if !bast {
            // tours rondes du mur médiéval, tous les 50 m environ
            let d = _densify(&ferme, 50.0);
            pts_ronds(&d[..d.len().saturating_sub(1)])
        } else {
            list![]
        }
    });
    gates.sort();
    gates.dedup();
    let portes = Val::list(
        gates
            .iter()
            .map(|&c| {
                let (x, y) = center_of(c);
                list![py::round(x), py::round(y)]
            })
            .collect(),
    );
    let wall_rec = dict! {"pts" => wpts, "kind" => kind, "breach" => list![], "thick" => thick, "tours" => tours, "portes" => portes, "fosse" => if bast { 22 } else { 10 }};
    if bast {
        let trace_b = pts_ronds(poly);
        let dl = Val::list(ravs.iter().map(|rv| pts_ronds(rv)).collect());
        if principal {
            (m.bastions, m.demi_lunes) = (trace_b, dl);
        } else {
            wall_rec.set("bastions", trace_b);
            wall_rec.set("demi_lunes", dl);
        }
    }
    // brèches du siège, du côté de l'assaillant
    let bataille = pl.get("battle").truthy();
    let mut dmg = if bataille { pl.get_or("dmg", 0.0).f() } else { 0.0 };
    let dyn_ = if bataille && principal { pl.get_or("dyn", 0).i() } else { 0 }; // la dynamite de l'assaillant : une brèche de plus (à l'enceinte)
    if dmg >= 0.12 || dyn_ != 0 {
        let nbr = (if dmg >= 0.12 { 1 + py::int(dmg * 2.4) } else { 0 }) + dyn_;
        dmg = pmax(dmg, 0.12);
        for k in 0..(3 + dyn_).min(nbr) {
            let a = att_a + (k as f64 - (nbr - 1) as f64 / 2.0) * 0.55 + rng.uniform(-0.15, 0.15);
            let (bx, by) = py::min_by_key(trace.iter().copied(), |p| ecart_angle((p.1 - py_).atan2(p.0 - px), a)).expect("ValueError: min() arg is an empty sequence");
            let br = 16.0 + dmg * 34.0;
            for &c in wall {
                let (x, y) = center_of(c);
                if m.t[c] as i64 == T_MUR && py::hypot(x - bx, y - by) <= br + 10.0 {
                    m.t[c] = T_BRECHE as u8;
                }
            }
            wall_rec.at("breach").push(list![py::round(bx), py::round(by), py::round(br)]);
        }
    }
    m.walls.push(wall_rec);
}

/// Couverture d'un bâtiment (indice de dessin ; le chaume brûle plus vite) : ardoise des édifices et des grandes
/// villes (et du Béarn), tuile plate du Périgord, tuile canal du Midi, chaume des campagnes de l'ouest (Landes,
/// Médoc) jusqu'au milieu du XIXe siècle.
pub fn _toit(kind: &str, dept: &str, ville: Option<&str>, year: i64, h: f64) -> &'static str {
    if NOBLE.contains(&kind) || dept == "64" {
        return "ardoise";
    }
    if dept == "24" {
        return "tuile";
    }
    if let Some(ville) = ville.filter(|v| !v.is_empty()) {
        return if h < (if ville == "capitale" { 0.5 } else { 0.25 }) { "ardoise" } else { "canal" };
    }
    if (dept == "40" || dept == "33") && year < 1860 && (kind == "ferme" || kind == "maison") && h < 0.55 {
        return "chaume";
    }
    "canal"
}

/// Bâtiments : chaque groupe de cases bâties d'un seul tenant (4 voisins) reçoit sa nature (la plus noble de ses
/// cases, sinon celle du bâtiment dessiné le plus proche) et sa couverture ; les bâtiments dessinés reçoivent la leur.
pub fn _batis(m: &mut BattleMap, seed: i64, dept: &str, year: i64) {
    let batiments = m.buildings.vec();
    for b in &batiments {
        let c = cell_of(b.at("x").f(), b.at("y").f());
        if c >= 0 && m.t[c as usize] as i64 == T_BATI && !m.kinds.contains_key(&(c as usize)) {
            m.kinds.insert(c as usize, b.at("kind").string());
        }
    }
    let pl = m.place.clone();
    let reach = if pl.truthy() { m.town_r * 1.8 + 150.0 } else { 0.0 };
    let mut group: HashMap<usize, usize> = HashMap::new();
    let mut seen = vec![false; NU];
    for c0 in 0..NU {
        if seen[c0] || m.t[c0] as i64 != T_BATI {
            continue;
        }
        let (mut comp, mut todo) = (vec![], vec![c0]);
        seen[c0] = true;
        while let Some(c) = todo.pop() {
            comp.push(c);
            let i = c % CU;
            let c = c as i64;
            for nc in [if i < CU - 1 { c + 1 } else { -1 }, if i > 0 { c - 1 } else { -1 }, c + COLS, c - COLS] {
                if 0 <= nc && nc < N && !seen[nc as usize] && m.t[nc as usize] as i64 == T_BATI {
                    seen[nc as usize] = true;
                    todo.push(nc as usize);
                }
            }
        }
        comp.sort();
        let (x, y) = (py::sum(comp.iter().map(|&c| center_of(c).0)) / comp.len() as f64, py::sum(comp.iter().map(|&c| center_of(c).1)) / comp.len() as f64);
        let ks: Vec<&String> = comp.iter().filter_map(|c| m.kinds.get(c)).collect();
        let kind: String = if !ks.is_empty() {
            py::min_by_key(ks, |k| KINDS.iter().position(|q| q == k).unwrap_or_else(|| panic!("ValueError: tuple.index(x): x not in tuple ({k})"))).unwrap().clone()
        } else {
            let near = py::min_by_key(batiments.iter(), |b| py::pow(b.at("x").f() - x, 2.0) + py::pow(b.at("y").f() - y, 2.0));
            match near {
                Some(near) if near.truthy() && py::hypot(near.at("x").f() - x, near.at("y").f() - y) < 60.0 => near.at("kind").string(),
                _ => "maison".to_string(),
            }
        };
        let ville = if pl.truthy() && pl.at("type") != "village" && py::hypot(x - pl.at("x").f(), y - pl.at("y").f()) < reach { Some(pl.at("type").string()) } else { None };
        let toit = _toit(&kind, dept, ville.as_deref(), year, _hash(comp[0] as i64, 47, seed));
        for &c in &comp {
            group.insert(c, m.batis.len());
        }
        m.batis.push(dict! {"kind" => kind, "toit" => toit, "x" => py::round(x), "y" => py::round(y), "c" => Val::list(comp.iter().map(|&c| Val::from(c)).collect())});
    }
    for b in &batiments {
        let c = cell_of(b.at("x").f(), b.at("y").f());
        match if c >= 0 { group.get(&(c as usize)) } else { None } {
            Some(&g) => {
                b.set("g", g);
                b.set("toit", m.batis.at(g).at("toit"));
            }
            None => b.set("toit", _toit(b.at("kind").s(), dept, None, year, 0.9)),
        }
    }
    m.kinds = HashMap::new();
}

/// Barricades d'une place sans remparts : un anneau de murets aux entrées, ouvert par endroits.
pub fn _barricades(m: &mut BattleMap, pos: Pt, R: f64, bar: f64, _rng: &mut Random, _att_a: f64) {
    let (px, py_) = pos;
    let rb = R + 15.0;
    let mut pts = vec![];
    for k in 0..49 {
        let a = k as f64 * 6.283 / 48.0;
        pts.push((px + a.cos() * rb, py_ + a.sin() * rb));
    }
    let gap = 1.0 - bar;
    for (k, q) in pts.windows(2).enumerate() {
        if _hash(k as i64, 1, py::int(R)) < gap * 0.8 {
            continue;
        }
        for c in _line_cells(q[0].0, q[0].1, q[1].0, q[1].1) {
            if !dans(m.t[c], &[T_EAU, T_BATI]) {
                m.t[c] = T_BARRICADE as u8;
            }
        }
    }
    m.walls.push(dict! {"pts" => pts_ronds(&pts), "kind" => "barricade", "breach" => list![], "thick" => CELL});
}

/// Redoutes devant des remparts : petits ouvrages de terre face à l'assaillant.
pub fn _redoubts(m: &mut BattleMap, pos: Pt, R: f64, bar: f64, _rng: &mut Random, att_a: f64) {
    let (px, py_) = pos;
    for k in 0..1 + py::int(bar * 2.5) {
        let a = att_a + (k - 1) as f64 * 0.6;
        let d = R + 170.0;
        let (x, y) = (px + a.cos() * d, py_ + a.sin() * d);
        let sq = [(x - 30.0, y - 30.0), (x + 30.0, y - 30.0), (x + 30.0, y + 30.0), (x - 30.0, y + 30.0), (x - 30.0, y - 30.0)];
        for c in _poly_cells(&sq) {
            if !dans(m.t[c], &[T_EAU, T_BATI, T_ROUTE]) {
                m.t[c] = T_BARRICADE as u8;
            }
        }
        m.walls.push(dict! {"pts" => pts_ronds(&sq), "kind" => "barricade", "breach" => list![], "thick" => CELL});
    }
}

// ---------------------------------------------------------------------- fermes et moulins
pub fn _farms(m: &mut BattleMap, rng: &mut Random, n: i64, _hf: &[f64], main: i64) {
    let mut placed: Vec<Pt> = vec![];
    let mut tries = 0;
    while (placed.len() as i64) < n && tries < n * 30 {
        tries += 1;
        let (i, j) = (rng.randrange2(4, COLS - 6), rng.randrange2(4, ROWS - 6));
        let c = j * COLS + i;
        if !dans(m.t[c as usize], &[T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T]) {
            continue;
        }
        let (x, y) = center_of(c as usize);
        if m.place.truthy() && py::hypot(x - m.place.at("x").f(), y - m.place.at("y").f()) < m.town_r + 280.0 {
            continue;
        }
        if placed.iter().any(|&(a, b)| py::hypot(x - a, y - b) < 380.0) {
            continue;
        }
        let (fw, fh) = (2 + rng.randrange(2), 2);
        let ok = (-1..fh + 1).all(|dj| (-1..fw + 1).all(|di| !dans(m.t[(c + dj * COLS + di) as usize], &[T_EAU, T_ROUTE, T_GUE])));
        if !ok {
            continue;
        }
        for dj in -1..fh + 1 {
            for di in -1..fw + 1 {
                let cc = (c + dj * COLS + di) as usize;
                let inside = 0 <= di && di < fw && 0 <= dj && dj < fh;
                m.t[cc] = (if inside && py::mod_i(di + dj, 3) != 2 {
                    T_BATI
                } else if m.t[cc] as i64 != T_CHEMIN {
                    T_PRE
                } else {
                    T_CHEMIN
                }) as u8;
            }
        }
        placed.push((x, y));
        let a = if rng.random() < 0.5 { 0.0 } else { 1.5708 };
        let big = main == T_VIGNE && rng.random() < 0.4; // château viticole
        m.buildings.push(dict! {"x" => py::round(x + (CELL * (fw - 1)) as f64 / 2.0), "y" => py::round(y + (CELL * (fh - 1)) as f64 / 2.0),
        "w" => py::round(rng.uniform(22.0, 30.0) * (if big { 1.4 } else { 1.0 })), "h" => py::round(rng.uniform(10.0, 14.0)),
        "a" => py::round_n(a, 2), "kind" => "ferme"});
        m.buildings.push(dict! {"x" => py::round(x + (CELL * fw) as f64 - 6.0), "y" => py::round(y + 4.0), "w" => 12, "h" => 8, "a" => py::round_n(1.5708 - a, 2), "kind" => "ferme"});
        _path_to_road(m, rng, x, y);
        // hameau (C4) : une fois sur quatre, une ou deux maisons de plus autour de la ferme, sur son chemin
        if rng.random() < 0.25 {
            for _ in 0..1 + (rng.random() < 0.5) as i64 {
                let a2 = rng.random() * 6.283;
                let hx = x + a2.cos() * rng.uniform(60.0, 100.0);
                let hy = y + a2.sin() * rng.uniform(60.0, 100.0);
                let hc = cell_of(hx, hy);
                if hc < 0 || !dans(m.t[hc as usize], &CULTIVE) {
                    continue;
                }
                m.t[hc as usize] = T_BATI as u8;
                m.buildings.push(dict! {"x" => py::round(hx), "y" => py::round(hy), "w" => py::round(rng.uniform(12.0, 18.0)), "h" => py::round(rng.uniform(8.0, 11.0)),
                "a" => py::round_n(a2, 2), "kind" => "maison"});
            }
        }
    }
}

/// Chemin de la ferme à la route (ou au chemin) la plus proche : il longe les bords des parcelles (C4), comme les
/// chemins de terre qui séparent les champs, au lieu de les couper en biais.
pub fn _path_to_road(m: &mut BattleMap, rng: &mut Random, x: f64, y: f64) {
    if m.ilot.as_ref().is_some_and(|il| !il.is_empty()) {
        if let Some(pts) = _path_on_edges(m, x, y + CELLF * 1.5, 45) {
            for c in _poly_cells(&pts) {
                if !dans(m.t[c], &[T_ROUTE, T_BATI, T_GUE]) {
                    m.t[c] = T_CHEMIN as u8;
                }
            }
            m.roads.push(dict! {"pts" => pts_val(&pts), "kind" => "chemin"});
            return;
        }
    }
    let mut best: Option<(f64, Val)> = None;
    for r in m.roads.iter() {
        for p in r.at("pts").iter().step_by(2) {
            let d = py::pow(p.at(0).f() - x, 2.0) + py::pow(p.at(1).f() - y, 2.0);
            if best.as_ref().is_none_or(|b| d < b.0) {
                best = Some((d, p));
            }
        }
    }
    let Some((d, but)) = best else { return };
    if d > 810000.0 || d < 1600.0 {
        return;
    }
    let pts = _meander(_densify(&[(x, y + CELLF * 1.5), but.xy()], 40.0), rng, 20.0, 300.0, None);
    let cells = _poly_cells(&pts);
    for &c in &cells {
        if dans(m.t[c], &[T_EAU, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE]) {
            return;
        }
    }
    for &c in &cells {
        if m.t[c] as i64 == T_GUE {
            continue;
        }
        if !dans(m.t[c], &[T_ROUTE, T_BATI]) {
            m.t[c] = T_CHEMIN as u8;
        }
    }
    // (le dernier point du chemin est le point même de la route, `tuple(best[1])` : il garde ses entiers s'il en a)
    let v = pts_val(&pts);
    v.set(-1, but.to_tuple());
    m.roads.push(dict! {"pts" => v, "kind" => "chemin"});
}

pub fn _mill(m: &mut BattleMap, rng: &mut Random, hf: &[f64], main: i64) {
    if rng.random() < 0.3 {
        return;
    }
    let riv: Vec<Val> = m.rivers.iter().filter(|r| r.at("kind") == "riviere" || r.at("kind") == "ruisseau").collect();
    if !riv.is_empty() && rng.random() < 0.6 {
        let r = &riv[rng.randrange(riv.len() as i64) as usize];
        let dense = _densify(&pts_de(&r.at("pts")), 20.0);
        let w = r.at("w").f();
        for _ in 0..20 {
            let p = dense[rng.randrange(dense.len() as i64) as usize];
            for (dx, dy) in [(w / 2.0 + 20.0, 0.0), (-w / 2.0 - 20.0, 0.0), (0.0, w / 2.0 + 20.0), (0.0, -w / 2.0 - 20.0)] {
                let c = cell_of(p.0 + dx, p.1 + dy);
                if m.plan.truthy() && py::hypot(p.0 + dx - m.place.at("x").f(), p.1 + dy - m.place.at("y").f()) < m.town_r + 150.0 {
                    continue; // (version 4 : pas de moulin dans la ville ni sur son glacis)
                }
                if c >= 0 && dans(m.t[c as usize], &[T_PRE, T_CHAMP, T_LANDE_T, T_VIGNE_T]) {
                    m.t[c as usize] = T_BATI as u8;
                    let (x, y) = center_of(c as usize);
                    m.buildings.push(dict! {"x" => py::round(x), "y" => py::round(y), "w" => 12, "h" => 10, "a" => 0, "kind" => "moulin", "water" => true});
                    return;
                }
            }
        }
        return;
    }
    if [T_PLAINE, T_COLLINES, T_VIGNE, T_LANDE].contains(&main) {
        let mut best: Option<usize> = None;
        for _ in 0..60 {
            let c = rng.randrange(N) as usize;
            if m.plan.truthy() {
                let (x, y) = center_of(c);
                if py::hypot(x - m.place.at("x").f(), y - m.place.at("y").f()) < m.town_r + 150.0 {
                    continue;
                }
            }
            if dans(m.t[c], &[T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T]) && 3 < c % CU && c % CU < CU - 3 && best.is_none_or(|b| hf[c] > hf[b]) {
                best = Some(c);
            }
        }
        if let Some(best) = best {
            m.t[best] = T_BATI as u8;
            let (x, y) = center_of(best);
            m.buildings.push(dict! {"x" => py::round(x), "y" => py::round(y), "w" => 9, "h" => 9, "a" => 0, "kind" => "moulin", "water" => false});
        }
    }
}

// ====================================================================== composition (SPEC-CARTES.md)
/// C1. Îlots : la cellule de Voronoï d'un germe (germes à 9 cases, environ 180 m ; 12 en lande, 7 dans les vignes),
/// coupée en lanières de 2 à 5 cases dans le sens des sillons : celui de la route ou du chemin le plus proche (à moins
/// de 250 m), sinon les courbes de niveau, sinon un angle au hasard ; une lanière sur trois est recoupée en travers.
/// Renvoie, pour chaque case, le numéro de son îlot et celui de sa lanière (deux cases d'une même lanière ont le même).
pub fn _ilots(seed: i64, hf: &[f64], roads: &Val, main: i64) -> (Vec<i64>, Vec<i64>) {
    let S: i64 = if main == T_LANDE || main == T_DUNES {
        12
    } else if main == T_VIGNE {
        7
    } else {
        9
    };
    let Sf = S as f64;
    let (gw, gh) = (COLS / S + 2, ROWS / S + 2);
    let mut germs: Vec<Pt> = vec![];
    for b in 0..gh {
        for a in 0..gw {
            germs.push(((a as f64 + 0.15 + _hash(a, b, seed + 31) * 0.7) * Sf, (b as f64 + 0.15 + _hash(a, b, seed + 32) * 0.7) * Sf));
        }
    }
    // (points des routes, tous les 40 m, avec leur direction)
    let mut rp: Vec<(f64, f64, f64)> = vec![];
    for r in roads.iter() {
        let d = _densify(&pts_de(&r.at("pts")), 40.0);
        for k in 1..d.len() {
            let ((x0, y0), (x1, y1)) = (d[k - 1], d[k]);
            rp.push(((x0 + x1) / 2.0, (y0 + y1) / 2.0, (y1 - y0).atan2(x1 - x0)));
        }
    }
    let (mut ang, mut sw): (Vec<Pt>, Vec<i64>) = (vec![], vec![]);
    for (k, &(gx, gy)) in germs.iter().enumerate() {
        let (x, y) = (gx * CELLF, gy * CELLF);
        let mut best: Option<(f64, f64)> = None;
        for &(px, py_, a) in &rp {
            let dd = py::pow(px - x, 2.0) + py::pow(py_ - y, 2.0);
            if best.is_none_or(|b| dd < b.0) {
                best = Some((dd, a));
            }
        }
        let a = match best {
            Some((dd, a)) if dd < 62500.0 => a,
            _ => {
                let (i, j) = ((COLS - 3).min(py::int(gx).max(2)) as usize, (ROWS - 3).min(py::int(gy).max(2)) as usize);
                let (gx_, gy_) = ((hf[j * CU + i + 2] - hf[j * CU + i - 2]) / 80.0, (hf[(j + 2) * CU + i] - hf[(j - 2) * CU + i]) / 80.0);
                // (sur une pente, les sillons suivent les courbes de niveau : perpendiculaires à la pente)
                if py::hypot(gx_, gy_) > 0.03 {
                    gy_.atan2(gx_) + PI / 2.0
                } else {
                    _hash(k as i64, 77, seed) * PI
                }
            }
        };
        ang.push((a.cos(), a.sin()));
        sw.push(2 + py::int(_hash(k as i64, 78, seed) * 3.99));
    }
    let mut ilot = vec![0i64; NU];
    let mut strip = vec![0i64; NU];
    for j in 0..ROWS {
        let b0 = py::int(j as f64 / Sf);
        let jf = j as f64;
        for i in 0..COLS {
            let a0 = py::int(i as f64 / Sf);
            let fi = i as f64;
            let (mut best, mut bk) = (1e18, 0usize);
            for b in [b0 - 1, b0, b0 + 1] {
                if b < 0 || b >= gh {
                    continue;
                }
                for a in [a0 - 1, a0, a0 + 1] {
                    if a < 0 || a >= gw {
                        continue;
                    }
                    let k = (b * gw + a) as usize;
                    let (gx, gy) = germs[k];
                    let dd = py::pow(gx - fi - 0.5, 2.0) + py::pow(gy - jf - 0.5, 2.0);
                    if dd < best {
                        (best, bk) = (dd, k);
                    }
                }
            }
            let (gx, gy) = germs[bk];
            let (ca, sa) = ang[bk];
            let u = (fi + 0.5 - gx) * ca + (jf + 0.5 - gy) * sa;
            let v = -(fi + 0.5 - gx) * sa + (jf + 0.5 - gy) * ca;
            let si = (v / sw[bk] as f64).floor() as i64;
            let sub = if _hash(bk as i64, si + 200, seed) < 0.33 { (u / (6 + py::int(_hash(bk as i64, si + 300, seed) * 5.0)) as f64).floor() as i64 } else { 0 };
            let c = (j * COLS + i) as usize;
            ilot[c] = bk as i64;
            strip[c] = bk as i64 * 4096 + (si + 64) * 32 + (sub + 16);
        }
    }
    (ilot, strip)
}

/// C3. Clairières dans les grands bois (plus de 30 hectares : une ou deux, en pré) ; bosquets dans les champs.
pub fn _bois_details(rng: &mut Random, t: &mut [u8]) {
    let mut seen = vec![false; NU];
    for c0 in 0..NU {
        if seen[c0] || !dans(t[c0], &[T_BOIS, T_FORET_T]) {
            continue;
        }
        let (mut comp, mut q) = (vec![], vec![c0]);
        seen[c0] = true;
        while let Some(c) = q.pop() {
            comp.push(c);
            let i = c % CU;
            let c = c as i64;
            for nc in [if i < CU - 1 { c + 1 } else { -1 }, if i > 0 { c - 1 } else { -1 }, c + COLS, c - COLS] {
                if 0 <= nc && nc < N && !seen[nc as usize] && dans(t[nc as usize], &[T_BOIS, T_FORET_T]) {
                    seen[nc as usize] = true;
                    q.push(nc as usize);
                }
            }
        }
        if comp.len() < 750 {
            continue;
        }
        let mut inside = vec![false; NU];
        for &c in &comp {
            inside[c] = true;
        }
        for _ in 0..1 + (comp.len() > 2000) as usize {
            let ci = comp[rng.randrange(comp.len() as i64) as usize] as i64;
            let r = 2 + rng.randrange(3);
            let (x0, y0) = (ci % COLS, ci / COLS);
            for dj in -r..r + 1 {
                for di in -r..r + 1 {
                    if (di * di + dj * dj) as f64 <= (r * r) as f64 + rng.random() * 2.0 {
                        let cc = (y0 + dj) * COLS + x0 + di;
                        if 0 <= cc && cc < N && inside[cc as usize] {
                            t[cc as usize] = T_PRE as u8;
                        }
                    }
                }
            }
        }
    }
    for _ in 0..5 + rng.randrange(6) {
        let mut c = rng.randrange(N);
        if !dans(t[c as usize], &[T_CHAMP, T_PRE]) {
            continue;
        }
        for _ in 0..2 + rng.randrange(5) {
            t[c as usize] = T_BOIS as u8;
            let i = c % COLS;
            let nc = c + [1, -1, COLS, -COLS][rng.randrange(4) as usize];
            if 0 <= nc && nc < N && (nc % COLS - i).abs() <= 1 && dans(t[nc as usize], &[T_CHAMP, T_PRE]) {
                c = nc;
            }
        }
    }
}

/// C2. Le terroir : chaque lanière cultivée est réattribuée selon sa place. Près des maisons, des vergers ; le long de
/// l'eau, des prés ; sur les pentes fortes, pas de labours (prés, landes ; vignes sur les coteaux exposés au sud dans le
/// Bordelais) ; loin des maisons, des prés plutôt que des champs. Le glacis d'une place forte reste dégagé : pas de
/// verger à moins de 300 m de l'enceinte.
pub fn _terroir(m: &mut BattleMap, seed: i64, hf: &[f64], dwat: &[u8], biome: &[u8], dept: &str) {
    let t = &mut m.t;
    let strip = m.strip.as_ref().expect("TypeError: 'NoneType' object is not subscriptable (m.strip)");
    let bati: Vec<usize> = (0..NU).filter(|&c| t[c] as i64 == T_BATI).collect();
    let dh = if !bati.is_empty() { bfs(&bati, 32, None) } else { vec![255u8; NU] };
    let mut glacis: Option<(f64, f64, f64)> = None;
    if m.place.truthy() && m.place.get_or("fort", 0) >= 1 {
        glacis = Some((m.place.at("x").f(), m.place.at("y").f(), m.town_r + 300.0));
    }
    let mut groups: IndexMap<i64, Vec<usize>> = IndexMap::new();
    for c in 0..NU {
        if dans(t[c], &CULTIVE) {
            groups.entry(strip[c]).or_default().push(c);
        }
    }
    for (&key, cells) in &groups {
        let n = cells.len() as f64;
        let mh = cells.iter().map(|&c| dh[c] as i64).sum::<i64>() as f64 / n;
        let mw = cells.iter().map(|&c| dwat[c] as i64).sum::<i64>() as f64 / n;
        // pente moyenne (m par m) et exposition (vers le sud : l'altitude baisse quand y croît)
        let (mut sl, mut south) = (0.0, 0.0);
        for &c in cells {
            let (i, j) = (c % CU, c / CU);
            if 0 < i && i < CU - 1 && 0 < j && j < RU - 1 {
                let gx = (hf[c + 1] - hf[c - 1]) / (2 * CELL) as f64;
                let gy = (hf[c + CU] - hf[c - CU]) / (2 * CELL) as f64;
                sl += py::hypot(gx, gy);
                south -= gy;
            }
        }
        sl /= n;
        south /= n;
        let cur = t[cells[0]] as i64;
        let mut new = cur;
        let (r1, r2) = (_hash(key, 401, seed), _hash(key, 402, seed));
        let lande = dans(biome[cells[0]], &[T_LANDE, T_DUNES]);
        if mh <= 6.0 && r1 < (if lande { 0.25 } else { 0.5 }) {
            new = T_VERGER;
        } else if mw <= 4.0 && (cur == T_CHAMP || cur == T_VIGNE_T) && r1 < 0.75 {
            new = T_PRE;
        } else if sl > 0.12 && cur == T_CHAMP {
            new = if dept == "33" && south > 0.03 && r2 < 0.6 {
                T_VIGNE_T
            } else if lande || r2 < 0.3 {
                T_LANDE_T
            } else {
                T_PRE
            };
        } else if mh >= 30.0 && cur == T_CHAMP && r2 < 0.12 {
            new = if lande { T_LANDE_T } else { T_PRE };
        }
        if new != cur {
            for &c in cells {
                // (glacis : la part de la lanière qui y entre reste ce qu'elle était)
                if new == T_VERGER {
                    if let Some((gx, gy, gr)) = glacis {
                        let (x, y) = center_of(c);
                        if py::hypot(x - gx, y - gy) < gr {
                            continue;
                        }
                    }
                }
                t[c] = new as u8;
            }
        }
    }
}

/// Plus court chemin (en cases) d'un point à la route ou au chemin le plus proche, moins coûteux sur les bords des
/// îlots : le chemin longe les champs. None si rien à moins de maxd cases, ou si l'eau barre le passage.
/// (défaut de Python : maxd=45)
pub fn _path_on_edges(m: &BattleMap, x: f64, y: f64, maxd: i64) -> Option<Vec<Pt>> {
    let t = &m.t;
    let ilot = m.ilot.as_ref().expect("TypeError: 'NoneType' object is not subscriptable (m.ilot)");
    let start = cell_of(x, y);
    if start < 0 {
        return None;
    }
    let start = start as usize;
    let mut dist = vec![1e18; NU];
    dist[start] = 0.0;
    let mut prev = vec![usize::MAX; NU];
    let mut q: Vec<(f64, usize)> = vec![(0.0, start)];
    let mut end = None;
    while let Some((d, c)) = heapq::heappop(&mut q) {
        if d > dist[c] {
            continue;
        }
        if dans(t[c], &[T_ROUTE, T_CHEMIN]) && c != start {
            end = Some(c);
            break;
        }
        if d > maxd as f64 * 2.5 {
            break;
        }
        let i = c % CU;
        let ci = c as i64;
        for nc in [if i < CU - 1 { ci + 1 } else { -1 }, if i > 0 { ci - 1 } else { -1 }, ci + COLS, ci - COLS] {
            if !(0 <= nc && nc < N) {
                continue;
            }
            let nc = nc as usize;
            let tn = t[nc];
            if dans(tn, &[T_EAU, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE]) || (tn as i64 == T_BATI && nc != start) {
                continue;
            }
            let ni = nc % CU;
            let edge = (ni < CU - 1 && ilot[nc + 1] != ilot[nc])
                || (ni > 0 && ilot[nc - 1] != ilot[nc])
                || (nc + CU < NU && ilot[nc + CU] != ilot[nc])
                || (nc >= CU && ilot[nc - CU] != ilot[nc]);
            let mut w = if edge { 1.0 } else { 2.6 };
            if tn as i64 == T_GUE {
                w += 4.0;
            }
            let nd = d + w;
            if nd < dist[nc] {
                dist[nc] = nd;
                prev[nc] = c;
                heapq::heappush(&mut q, (nd, nc));
            }
        }
    }
    let end = end?;
    let mut path = vec![end];
    while path[path.len() - 1] != start {
        path.push(prev[path[path.len() - 1]]);
    }
    path.reverse();
    if path.len() < 3 {
        return None;
    }
    Some(path.into_iter().map(center_of).collect())
}
