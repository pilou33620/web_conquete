//! Porte game/geo.py (PORTAGE.md).
//!
//! Carte de l'Aquitaine : projection, grilles (terrain, départements, cours d'eau),
//! réseau routier et recherche de chemin hors route (A*).
//!
//! Tout est calculé en kilomètres. Une cellule de grille = 1 km x 1 km.
//! Le résultat est mis en cache dans data/map_cache.json (régénéré si la source change).
//!
//! Versions de la géographie (VERSION, notée dans la sauvegarde : une partie garde la sienne, ses routes, ses crues et ses
//! cartes de bataille) : 1, les données d'avant (data/geo_v1.json, figé, avec la place d'alors des villes déplacées depuis) ;
//! 2, l'Aquitaine (la carte par défaut) : les rivières d'OpenStreetMap (Overture, octobre 2026 : leur cours principal,
//! simplifié à 60 m, chaque affluent raccordé à sa rivière) et les villes au bord de l'eau à leur vraie place (places.py).
//! Une modification du calcul de ce fichier change aussi la carte des anciennes parties. 3 et 4, toute la France, sont
//! retirées depuis le 22/11/2026 (historique git) : leurs sauvegardes ne se chargent plus. À partir de 5, les théâtres
//! (THEATRES : l'Europe, 5, puis les autres), chacun une carte à part de cases de 5 km, un pays par camp. Le moteur compte
//! toujours en cases : seule la projection (KX, KY de la carte, km_case) sait qu'une case y vaut 5 km. Un théâtre ne se
//! fait qu'à la demande. 13, la carte monde (VERSION_MONDE, SPEC-EMPIRE.md) : l'Amérique, l'Europe et l'Inde posées sur une
//! même grille (GeoMap::monde), chacune avec sa projection (parties).
//!
//! En Rust : les nœuds, les arêtes et ce que le reste du moteur lit par clé restent des `Val` ; les grilles sont des
//! `Vec` natifs et toute la génération se calcule en nombres natifs. Les fichiers de données sources sont embarqués ;
//! seul le cache (map_cache*.json, le même fichier et le même format que le Python) se lit et s'écrit dans `data_dir()`.

use crate::places::{CITY_POP, CITY_SPECIALTIES, EXTRA_ROADS, EXTRA_ROADS_2, FERRIES, NO_ROADS_2, PLACES, ROYAL_ROUTES};
use crate::py::{self, heapq, json, Val};
use crate::{dict, list, py_const, tup};
use indexmap::IndexMap;
use std::cell::{OnceCell, RefCell};
use std::collections::{HashMap, HashSet};

/// Un point (x, y) ou (lat, lon) : le tuple de deux flottants du Python.
pub type Pt = (f64, f64);

/// DATA_DIR du Python (game/data, à côté de geo.py) : ici le dossier du cache de la carte, donné par la variable
/// d'environnement CONQUETE_DATA si elle existe, sinon game/data sous le répertoire courant.
pub fn data_dir() -> std::path::PathBuf {
    match std::env::var_os("CONQUETE_DATA") {
        Some(d) => d.into(),
        None => std::path::Path::new("game").join("data"),
    }
}
// les fichiers de données sources (game/data), embarqués
const GEO_V1: &str = include_str!("../../../game/data/geo_v1.json");
const GEO_V2: &str = include_str!("../../../game/data/geo_v2.json");

pub const CACHE_VERSION: i64 = 8;
pub const VERSION: i64 = 2; // 2 : l'Aquitaine (la carte par défaut) ; 1 : le Sud-Ouest des anciennes parties ; 3 et 4 (toute la France) retirées le 22/11/2026

pub const VERSION_EUROPE: i64 = 5; // le théâtre d'Europe (SPEC-FRANCE.md, étape 2) : ce qui ne vaut que pour lui (BACS_5, relief et climats écrits à la main, MERS_5)
pub const GEN_THEATRE: i64 = 3; // (3 : routes hors de l'eau, ponts sur leur tracé, routes doublées confondues, 23/11/2026)
// (à augmenter quand le calcul de la carte d'un théâtre change : relief, végétation, routes ; son cache est alors refait)

// ---------------------------------------------------------------- les théâtres
// Un théâtre : une carte à part, à 5 km la case, un pays par camp ; le joueur le choisit sur l'écran de départ (R::MODES).
// Pour ajouter un théâtre <id> :
//   1. outils/theatre.mjs écrit ses fichiers dans game/data : <id>.json (la carte, même forme que europe.json),
//      places_<id>.json, pays_<id>.json (les clés d'un camp, puis "moyens", "maisons", "culture"), epoques_<id>.json et
//      cultures_<id>.json (ses cultures nouvelles, ou {}) ; codes des pays : trois lettres, la première celle du théâtre ;
//   2. une ligne dans THEATRES ci-dessous : le numéro de géographie suivant, l'id, le nom affiché, « pays », « d'<nom> »,
//      « l’<nom> », « Toute l'<nom> » et les cinq fichiers par include_str! ;
//   3. recompiler : ses pays entrent dans R::FACTIONS, le théâtre à l'écran de départ ; sa carte se fait à la première
//      demande (cache game/data/map_cache_v<geo>.json, empreinte sur ses fichiers). `cargo test -p conquete --test
//      theatres` vérifie qu'il se charge.
// Ce qui est propre à l'Europe (bacs BACS_5, traversées MERS_5, relief et climats de _terrain5) reste attaché à
// VERSION_EUROPE ; un autre théâtre prend le calcul générique (_terrain_theatre, réseaux de routes et de rails générés).
pub struct Theatre {
    pub geo: i64,
    pub id: &'static str,
    pub nom: &'static str,
    /// Le mot d'un camp à l'écran de départ.
    pub mot: &'static str,
    /// « d'Europe » (Game::pays_de).
    pub de: &'static str,
    /// « l’Europe » (la page : « Vous dominez l’Europe »).
    pub le: &'static str,
    /// « Toute l'Europe » (la fin de la partie).
    pub tout: &'static str,
    pub carte: &'static str,
    pub places: &'static str,
    pub pays: &'static str,
    pub epoques: &'static str,
    pub cultures: &'static str,
}
pub const THEATRES: &[Theatre] = &[
    Theatre { geo: 5, id: "europe", nom: "Europe", mot: "pays", de: "d'Europe", le: "l’Europe", tout: "Toute l'Europe",
        carte: include_str!("../../../game/data/europe.json"), places: include_str!("../../../game/data/places_europe.json"),
        pays: include_str!("../../../game/data/pays_europe.json"), epoques: include_str!("../../../game/data/epoques_europe.json"),
        cultures: include_str!("../../../game/data/cultures_europe.json") },
    Theatre { geo: 6, id: "amerique", nom: "Amérique", mot: "pays", de: "d'Amérique", le: "l’Amérique", tout: "Toute l'Amérique",
        carte: include_str!("../../../game/data/amerique.json"), places: include_str!("../../../game/data/places_amerique.json"),
        pays: include_str!("../../../game/data/pays_amerique.json"), epoques: include_str!("../../../game/data/epoques_amerique.json"),
        cultures: include_str!("../../../game/data/cultures_amerique.json") },
    Theatre { geo: 7, id: "inde", nom: "Inde", mot: "pays", de: "de l'Inde", le: "l’Inde", tout: "Toute l'Inde",
        carte: include_str!("../../../game/data/inde.json"), places: include_str!("../../../game/data/places_inde.json"),
        pays: include_str!("../../../game/data/pays_inde.json"), epoques: include_str!("../../../game/data/epoques_inde.json"),
        cultures: include_str!("../../../game/data/cultures_inde.json") },
    Theatre { geo: 8, id: "guinee", nom: "Côte de l'Ivoire", mot: "pays", de: "de la Côte de l'Ivoire", le: "la Côte de l’Ivoire", tout: "Toute la Côte de l'Ivoire",
        carte: include_str!("../../../game/data/guinee.json"), places: include_str!("../../../game/data/places_guinee.json"),
        pays: include_str!("../../../game/data/pays_guinee.json"), epoques: include_str!("../../../game/data/epoques_guinee.json"),
        cultures: include_str!("../../../game/data/cultures_guinee.json") },
    Theatre { geo: 9, id: "bresil", nom: "Côte du Brésil", mot: "pays", de: "de la Côte du Brésil", le: "la Côte du Brésil", tout: "Toute la Côte du Brésil",
        carte: include_str!("../../../game/data/bresil.json"), places: include_str!("../../../game/data/places_bresil.json"),
        pays: include_str!("../../../game/data/pays_bresil.json"), epoques: include_str!("../../../game/data/epoques_bresil.json"),
        cultures: include_str!("../../../game/data/cultures_bresil.json") },
    Theatre { geo: 10, id: "madagascar", nom: "Détroit de Madagascar", mot: "pays", de: "du détroit de Madagascar", le: "le détroit de Madagascar", tout: "Tout le détroit de Madagascar",
        carte: include_str!("../../../game/data/madagascar.json"), places: include_str!("../../../game/data/places_madagascar.json"),
        pays: include_str!("../../../game/data/pays_madagascar.json"), epoques: include_str!("../../../game/data/epoques_madagascar.json"),
        cultures: include_str!("../../../game/data/cultures_madagascar.json") },
    Theatre { geo: 11, id: "indes_orientales", nom: "Indes orientales", mot: "pays", de: "des Indes orientales", le: "les Indes orientales", tout: "Toutes les Indes orientales",
        carte: include_str!("../../../game/data/indes_orientales.json"), places: include_str!("../../../game/data/places_indes_orientales.json"),
        pays: include_str!("../../../game/data/pays_indes_orientales.json"), epoques: include_str!("../../../game/data/epoques_indes_orientales.json"),
        cultures: include_str!("../../../game/data/cultures_indes_orientales.json") },
];

/// Le théâtre de cette géographie (None pour l'Aquitaine et les anciennes cartes ; MONDE pour la carte monde).
pub fn theatre(version: i64) -> Option<&'static Theatre> {
    if version == VERSION_MONDE {
        return Some(&MONDE);
    }
    THEATRES.iter().find(|t| t.geo == version)
}

// ---------------------------------------------------------------- la carte monde (SPEC-EMPIRE, module 3)
// Une seule partie pour les théâtres de THEATRES_MONDE : leurs cartes, faites (ou relues de leur cache) comme pour une partie
// à part, posées côte à côte sur une même grille, d'ouest en est, chacune à sa latitude (KY est le même partout : la ligne y
// d'une case dit sa latitude, à une demi-case près), avec MER_MONDE cases d'océan vide entre deux. Le moteur compte en
// cases et n'en sait rien : aucune route ni voie d'eau ne relie deux cartes ; seules les routes maritimes (routes_mer, que
// suivent les flottes) passent de l'une à l'autre. Chaque place porte son théâtre ("theatre"), chaque case aussi
// (theatre_case), chaque pays (rules::theatre_du_pays).
pub const VERSION_MONDE: i64 = 13; // (12 : la carte inconnue des essais, tests/bancs_serveur.rs)
/// Les théâtres de la carte monde, d'ouest en est (et l'ordre de leurs places dans geo.nodes).
pub const THEATRES_MONDE: [i64; 3] = [6, 5, 7];
pub const MER_MONDE: i64 = 20; // cases d'océan vide entre deux cartes (100 km)
/// Le « théâtre » de la carte monde, pour ce qui ne veut qu'un nom (Game::pays_de, la fin de la partie, l'écran de
/// départ) : ses fichiers sont ceux des trois théâtres réunis.
pub static MONDE: Theatre = Theatre { geo: VERSION_MONDE, id: "monde", nom: "Monde", mot: "pays", de: "du monde", le: "le monde",
    tout: "Le monde entier", carte: "", places: "", pays: "{}", epoques: "{}", cultures: "{}" };
/// Les routes maritimes entre les théâtres : (théâtre, lat, lon au bord de sa carte) des deux bouts, tours de mer, nom à
/// l'aller, nom au retour. Chaque bout est la case d'océan la plus proche du point ; chaque route se fait dans les deux sens.
pub const ROUTES_MER: &[((&str, f64, f64), (&str, f64, f64), i64, &str, &str)] = &[
    (("europe", 47.0, -10.6), ("amerique", 42.0, -52.5), 2, "vers l'Amérique", "vers l'Europe"),
    (("europe", 29.6, -10.8), ("inde", 6.2, 60.4), 4, "vers l'Inde (route du Cap)", "vers l'Europe (route du Cap)"),
    (("amerique", 7.6, -52.5), ("inde", 6.2, 92.5), 5, "vers l'Inde", "vers l'Amérique"),
];
/// Les comptoirs en mer (le commerce, SPEC-EMPIRE module 7) : (id, nom, théâtre, lat, lon d'une côte, denrée) ; le comptoir
/// est sur la case d'océan la plus proche. Les denrées d'après les productions d'époque.
pub const COMPTOIRS: &[(&str, &str, &str, f64, f64, &str)] = &[
    ("antilles", "Îles du Vent", "amerique", 14.6, -61.0, "sucre"),
    ("saint-domingue", "Saint-Domingue", "amerique", 19.9, -72.8, "cafe"),
    ("chesapeake", "Baie de la Chesapeake", "amerique", 37.0, -75.9, "tabac"),
    ("georgie", "Côte de Géorgie", "amerique", 31.5, -81.1, "coton"),
    ("saint-laurent", "Golfe du Saint-Laurent", "amerique", 49.2, -64.5, "fourrures"),
    ("malabar", "Côte de Malabar", "inde", 11.0, 75.8, "epices"),
    ("ceylan", "Côte de Ceylan", "inde", 6.9, 79.85, "epices"),
    ("gujarat", "Golfe de Cambay", "inde", 21.2, 72.6, "indigo"),
    ("bengale", "Bouches du Gange", "inde", 21.8, 89.0, "the"),
    ("mogador", "Mogador", "europe", 31.5, -9.8, "ivoire"),
];

/// (la carte monde) Un théâtre posé sur la grille : son décalage en cases, sa taille, sa projection, ses places.
pub struct Partie {
    pub theatre: &'static Theatre,
    pub ox: i64,
    pub oy: i64,
    pub W: i64,
    pub H: i64,
    pub lon0: f64,
    pub lon1: f64,
    pub lat1: f64,
    pub KX: f64,
    /// Les numéros de ses places dans geo.nodes.
    pub noeuds: std::ops::Range<i64>,
    /// Les codes de ses pays, triés.
    pub pays: Vec<String>,
}

/// La route maritime de ce numéro (geo.routes_mer : {id, de: [x, y], vers: [x, y], tours, nom}), ou None.
pub fn route_mer(geo: &GeoMap, id: &str) -> Option<Val> {
    geo.routes_mer.iter().find(|r| r.at("id") == id)
}

/// Une géographie que le jeu sait encore faire (1, 2, les théâtres et le monde) : une sauvegarde d'une autre est refusée.
pub fn connue(version: i64) -> bool {
    version == 1 || version == 2 || theatre(version).is_some()
}

pub const LAT_REF: f64 = 44.25;
/// `KX` du module Python (cos n'est pas une fonction constante en Rust : c'est une fonction).
pub fn KX() -> f64 {
    111.32 * radians(LAT_REF).cos()
}
pub const KY: f64 = 110.95;

// Types de terrain
pub const T_OCEAN: i64 = 0;
pub const T_EAU: i64 = 1;
pub const T_PLAINE: i64 = 2;
pub const T_FORET: i64 = 3;
pub const T_LANDE: i64 = 4;
pub const T_MARAIS: i64 = 5;
pub const T_COLLINES: i64 = 6;
pub const T_MONTAGNE: i64 = 7;
pub const T_HAUTE: i64 = 8;
pub const T_DUNES: i64 = 9;
pub const T_VIGNE: i64 = 10;
py_const!(TERRAIN, dict!{
    // id: (nom, vitesse hors route, couvert pour embuscade, bonus défense)
    T_OCEAN => tup!["Océan", 0.0, false, 1.0],
    T_EAU => tup!["Eau", 0.0, false, 1.0],
    T_PLAINE => tup!["Plaine", 0.70, false, 1.0],
    T_FORET => tup!["Forêt", 0.42, true, 1.10],
    T_LANDE => tup!["Lande", 0.55, true, 1.0],
    T_MARAIS => tup!["Marais", 0.30, true, 1.05],
    T_COLLINES => tup!["Collines", 0.55, false, 1.15],
    T_MONTAGNE => tup!["Montagne", 0.30, true, 1.30],
    T_HAUTE => tup!["Haute montagne", 0.12, false, 1.45],
    T_DUNES => tup!["Dunes", 0.35, false, 1.0],
    T_VIGNE => tup!["Vignoble", 0.60, false, 1.05],
});
py_const!(PLAYABLE, list!["33", "24", "40", "47", "64"]); // (géographies 1 et 2 ; un théâtre : GeoMap.playable_codes)
pub const NONE: i64 = 0xFFFF; // cellnode : case sans lieu (eau, hors du jeu)

// les types de terrain dans une grille d'octets
const OCEAN: u8 = T_OCEAN as u8;
const EAU: u8 = T_EAU as u8;
const PLAINE: u8 = T_PLAINE as u8;
const FORET: u8 = T_FORET as u8;
const LANDE: u8 = T_LANDE as u8;
const MARAIS: u8 = T_MARAIS as u8;
const COLLINES: u8 = T_COLLINES as u8;
const MONTAGNE: u8 = T_MONTAGNE as u8;
const HAUTE: u8 = T_HAUTE as u8;
const DUNES: u8 = T_DUNES as u8;
const VIGNE: u8 = T_VIGNE as u8;

/// Les octets d'un tableau d'entiers de 16 bits, petit-boutiste (array('H').tobytes()).
pub fn _b16(a: &[u16]) -> Vec<u8> {
    a.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// (SPEC-EMPIRE, module 3) Une grille compactée pour la page (carte monde) : des suites (valeur sur `w` octets, longueur
/// en LEB128), en base64 ; map.js `deRle` la déplie.
pub fn rle(d: &[u8], w: usize) -> String {
    let mut out = Vec::with_capacity(d.len() / 16);
    let mut i = 0;
    while i < d.len() {
        let v = &d[i..i + w];
        let mut n = 1;
        while i + (n + 1) * w <= d.len() && &d[i + n * w..i + (n + 1) * w] == v {
            n += 1;
        }
        out.extend_from_slice(v);
        let mut k = n;
        while k >= 128 {
            out.push((k & 127) as u8 | 128);
            k >>= 7;
        }
        out.push(k as u8);
        i += n * w;
    }
    b64encode(&out)
}

/// Le tableau d'entiers de 16 bits de ces octets (array('H').frombytes : un nombre pair d'octets).
pub fn _h16(b: &[u8]) -> Vec<u16> {
    assert!(b.len() % 2 == 0, "ValueError: bytes length not a multiple of item size");
    b.chunks(2).map(|o| u16::from_le_bytes([o[0], o[1]])).collect()
}

pub const LANDES_POLY: [(f64, f64); 16] = [(45.48, -1.12), (45.20, -0.95), (45.02, -0.82), (44.80, -0.70), (44.55, -0.44), (44.30, -0.18),
               (44.08, 0.06), (43.93, -0.30), (43.90, -0.62), (43.82, -0.95), (43.72, -1.22), (43.66, -1.40),
               (44.20, -1.30), (44.60, -1.27), (45.00, -1.20), (45.50, -1.18)];
pub const FORESTS: [(f64, f64, f64, f64); 14] = [  // (lat, lon, rayon km, densité)
    (45.12, 0.22, 17.0, 0.85), (44.98, 0.55, 11.0, 0.8), (44.76, 0.98, 11.0, 0.8), (45.10, 0.98, 9.0, 0.75),
    (45.00, 0.73, 8.0, 0.7), (45.48, 0.72, 16.0, 0.55), (44.85, 1.20, 14.0, 0.5), (44.28, 0.06, 15.0, 0.6),
    (43.05, -1.05, 11.0, 0.8), (43.10, -0.75, 9.0, 0.6), (44.42, 0.12, 8.0, 0.5), (45.40, 1.10, 12.0, 0.5),
    (44.60, 0.95, 10.0, 0.5), (43.25, -0.62, 7.0, 0.45),
];
pub const VINEYARDS: [(f64, f64, f64); 13] = [
    (44.90, -0.17, 8.0), (44.60, -0.38, 9.0), (44.75, -0.30, 11.0), (45.08, -0.56, 8.0), (44.82, 0.47, 9.0),
    (44.25, 0.30, 6.0), (44.67, 0.18, 6.0), (43.28, -0.45, 7.0), (43.55, -0.05, 6.0), (43.18, -1.30, 4.0),
    (45.14, -0.76, 7.0), (44.70, -0.47, 5.0), (43.88, -0.25, 6.0),
];


// ---------------------------------------------------------------- géographie 5 : l'Europe et l'Afrique du Nord (outils/europe.mjs), cases de 5 km
// relief : des lignes de crête (lat, lon) et des massifs isolés, en « hauteur » du jeu (> 0,42 collines, > 0,80 montagne,
// > 1,55 haute montagne), en degrés ; écrit à la main d'après la géographie réelle
pub const CRETES_5: &[(f64, f64, &[(f64, f64)])] = &[   // (amplitude, demi-largeur en degrés, crête)
    (1.60, 0.50, &[(44.10, 7.60), (44.60, 6.90), (45.30, 6.90), (45.90, 7.30), (46.40, 8.30), (46.60, 9.80), (46.90, 11.20), (47.10, 12.60), (47.30, 14.00), (47.50, 15.30)]),   // Alpes
    (1.45, 0.30, &[(43.20, -1.60), (42.80, -0.30), (42.65, 1.00), (42.45, 2.50)]),   // Pyrénées
    (0.95, 0.28, &[(42.90, -7.20), (43.10, -5.00), (43.00, -3.50)]),   // monts Cantabriques
    (0.85, 0.22, &[(40.30, -6.00), (40.60, -4.50), (41.10, -3.30)]),   // Système central (Gredos, Guadarrama)
    (0.75, 0.28, &[(42.00, -3.00), (41.00, -2.00), (40.30, -1.20)]),   // Système ibérique
    (1.05, 0.28, &[(36.80, -5.20), (37.05, -3.30), (37.60, -2.20), (38.30, -1.00)]),   // cordillères Bétiques, Sierra Nevada
    (0.55, 0.22, &[(38.00, -6.50), (38.40, -4.00), (38.50, -2.80)]),   // Sierra Morena
    (0.95, 0.28, &[(44.40, 8.80), (44.30, 10.00), (43.80, 11.60), (43.00, 12.90), (42.30, 13.60), (41.50, 14.50), (40.60, 15.60), (39.80, 16.20), (38.90, 16.50), (38.10, 15.90)]),   // Apennins
    (0.75, 0.22, &[(37.90, 13.30), (37.85, 14.60)]),   // Sicile (Madonies, Nébrodes)
    (1.10, 0.18, &[(41.70, 9.15), (42.00, 9.05), (42.40, 9.00), (42.70, 9.20)]),   // Corse
    (1.00, 0.45, &[(45.60, 14.30), (44.80, 15.60), (44.00, 16.80), (43.30, 18.20), (42.60, 19.50), (41.80, 20.20), (40.50, 20.80), (39.50, 21.30), (38.60, 22.00)]),   // Alpes dinariques, Pinde
    (0.90, 0.25, &[(43.40, 22.50), (42.80, 24.00), (42.75, 25.50), (42.80, 27.00)]),   // Balkans (Stara Planina)
    (1.00, 0.38, &[(48.30, 17.30), (49.20, 19.50), (49.20, 21.00), (48.90, 22.50), (48.20, 24.30), (47.30, 25.30), (46.30, 26.10), (45.60, 26.20), (45.40, 25.00), (45.40, 23.50), (44.90, 22.30)]),   // Carpates
    (0.60, 0.20, &[(50.40, 12.40), (50.70, 13.90)]),   // monts Métallifères
    (0.70, 0.22, &[(50.80, 15.00), (50.30, 16.70), (50.10, 17.30)]),   // Sudètes
    (0.65, 0.22, &[(49.60, 12.60), (48.80, 13.80)]),   // forêt de Bohême
    (1.25, 0.60, &[(58.60, 7.30), (59.80, 7.60), (61.00, 8.30), (62.00, 9.50), (63.00, 12.00)]),   // Alpes scandinaves
    (0.80, 0.45, &[(56.40, -4.80), (57.00, -4.50), (57.80, -4.80)]),   // Highlands
    (0.50, 0.25, &[(53.30, -1.80), (54.60, -2.30)]),   // Pennines
    (0.65, 0.20, &[(46.25, 5.95), (46.60, 6.15), (47.00, 6.55), (47.40, 7.00)]),   // Jura
    (0.65, 0.18, &[(47.85, 7.00), (48.10, 7.05), (48.40, 7.18), (48.70, 7.20)]),   // Vosges
    (0.65, 0.18, &[(47.80, 8.00), (48.70, 8.30)]),   // Forêt-Noire
    (1.40, 0.42, &[(30.90, -8.80), (31.40, -7.00), (32.20, -5.00), (32.60, -3.80)]),   // Haut Atlas
    (0.90, 0.28, &[(35.00, -5.20), (35.00, -3.80)]),   // Rif
    (0.80, 0.32, &[(35.00, -1.00), (36.00, 2.00), (36.50, 4.50), (36.60, 6.50), (36.50, 8.50)]),   // Atlas tellien
    (0.80, 0.28, &[(32.80, -0.50), (34.00, 2.50), (35.20, 6.00)]),   // Atlas saharien
    (1.20, 0.38, &[(36.80, 29.50), (37.00, 31.50), (36.90, 33.50), (37.50, 35.30), (38.00, 37.00), (38.50, 39.50), (38.30, 42.00), (37.80, 44.50)]),   // Taurus
    (1.10, 0.38, &[(41.20, 32.50), (41.00, 35.00), (40.60, 37.50), (40.60, 39.50), (40.90, 41.50)]),   // chaîne Pontique
    (1.70, 0.45, &[(44.30, 38.50), (43.60, 40.80), (43.10, 43.00), (42.60, 45.50)]),   // Caucase
    (1.00, 0.18, &[(33.30, 35.70), (34.50, 36.20)]),   // mont Liban
    (0.90, 0.15, &[(35.25, 23.90), (35.20, 25.50)]),   // Crète
];
pub const MASSIFS_5: &[(f64, f64, f64, f64)] = &[   // (lat, lon, amplitude, rayon en degrés)
    (45.30, 3.00, 0.55, 1.20), (45.06, 2.75, 0.80, 0.30), (44.40, 3.80, 0.70, 0.40),   // Massif central, Cantal, Cévennes
    (50.20, 5.80, 0.55, 0.70), (51.75, 10.70, 0.80, 0.20), (50.60, 10.80, 0.60, 0.30), (48.40, 9.50, 0.50, 0.40),   // Ardenne et Eifel, Harz, Thuringe, Jura souabe
    (49.20, 20.00, 0.70, 0.25), (46.50, 22.80, 0.90, 0.50),   // Tatras, monts Apuseni
    (41.70, 24.30, 1.00, 0.70), (42.10, 23.50, 1.10, 0.30), (41.50, 21.50, 0.80, 0.80), (37.50, 22.20, 0.90, 0.50),   // Rhodopes, Rila, Macédoine, Péloponnèse
    (37.75, 15.00, 1.20, 0.20), (40.00, 9.30, 0.90, 0.50),   // Etna, Sardaigne
    (56.90, -3.50, 0.90, 0.50), (52.50, -3.60, 0.85, 0.50), (54.50, -3.10, 0.80, 0.20), (53.00, -6.40, 0.60, 0.20), (52.00, -9.70, 0.80, 0.30),   // Grampians, Galles, Cumbria, Wicklow, Kerry
    (61.50, 14.00, 0.50, 1.50),   // Norrland
    (40.00, -4.00, 0.30, 2.30),   // Meseta
    (33.30, -5.00, 1.00, 0.60), (35.30, 6.60, 1.00, 0.40), (34.30, 2.00, 0.30, 2.00), (35.60, 9.00, 0.70, 0.50),   // Moyen Atlas, Aurès, hauts plateaux, dorsale tunisienne
    (39.00, 33.50, 0.50, 3.00), (39.50, 41.50, 0.80, 2.00), (41.00, 43.50, 0.90, 0.80),   // plateau anatolien, hautes terres d'Arménie, Petit Caucase
    (44.60, 34.20, 1.00, 0.25), (34.90, 32.90, 0.90, 0.25), (29.00, 34.00, 0.90, 0.70),   // monts de Crimée, Troodos, Sinaï
    (45.10, 10.50, -0.35, 1.00), (47.00, 20.50, -0.30, 1.50), (44.30, 26.00, -0.30, 1.00), (48.50, 7.75, -0.50, 0.20),   // plaine du Pô, plaine hongroise, Valachie, fossé rhénan
    (41.60, -0.80, -0.40, 0.60), (37.50, -5.50, -0.40, 0.60),   // vallées de l'Èbre et du Guadalquivir
];
pub const MARAIS_5: &[(f64, f64, f64)] = &[   // (lat, lon, rayon en km)
    (52.00, 27.50, 150.0), (45.20, 29.30, 55.0), (52.30, 4.90, 70.0), (43.50, 4.55, 25.0), (44.95, 12.30, 30.0), (37.00, -6.35, 30.0),   // Pripet, delta du Danube, Pays-Bas, Camargue, delta du Pô, Marismas
    (52.60, 0.10, 30.0), (53.80, 21.50, 60.0), (42.60, 11.10, 25.0), (41.40, 13.00, 18.0), (59.80, 30.80, 40.0), (31.35, 31.20, 35.0),   // Fens, Mazurie, Maremme, marais Pontins, Ingrie, lacs du delta du Nil
    (45.30, 37.80, 40.0), (46.50, 32.60, 35.0), (53.40, 7.50, 35.0), (54.20, 19.00, 25.0), (53.30, -8.00, 60.0),   // delta du Kouban, bouches du Dniepr, Frise, delta de la Vistule, tourbières d'Irlande
];
pub const LANDES_5: &[(f64, f64, f64)] = &[(44.20, -0.80, 65.0), (53.00, 10.20, 35.0), (56.00, 8.80, 50.0), (57.20, -4.50, 90.0)];   // landes de Gascogne, de Lunebourg, du Jutland, Highlands
pub const VIGNES_5: &[(f64, f64, f64)] = &[   // (lat, lon, rayon en km)
    (44.90, -0.40, 60.0), (47.00, 4.80, 40.0), (49.00, 4.00, 35.0), (47.30, 0.50, 50.0), (49.90, 7.50, 50.0), (48.20, 7.40, 30.0),   // Bordelais, Bourgogne, Champagne, Loire, Rhin et Moselle, Alsace
    (41.15, -7.60, 45.0), (42.40, -2.50, 40.0), (36.70, -6.10, 30.0), (48.10, 21.40, 30.0), (43.40, 11.30, 60.0), (44.70, 8.00, 45.0), (45.50, 11.50, 40.0),   // Douro, Rioja, Xérès, Tokaj, Toscane, Piémont, Vénétie
];
pub const ROYALES_5: usize = 6; // routes de poste : de chaque capitale à ses six plus grandes villes
/// (géographie 5) Les bacs des détroits connus, d'une place à l'autre (le passage le plus court entre deux terres ne se
/// trouve pas toujours entre deux places voisines : le Grand Belt de Korsør à Nyborg relie Roskilde à Odense) ; leur nom
/// remplace « Détroit » sur l'arête.
pub const BACS_5: [(&str, &str, &str); 4] =
    [("Grand Belt", "Roskilde", "Odense"), ("Petit Belt", "Odense", "Fredericia"), ("Øresund", "Copenhague", "Malmö"), ("Øresund", "Elseneur", "Helsingborg")];
pub const GABRIEL_5: f64 = 100.0; // (cases) les places voisines se cherchent jusque-là (40 sur les cartes au kilomètre) : la Russie, le Sahara
pub const RELIER_5: f64 = 250.0; // (cases) et un morceau du réseau se raccorde jusque-là, par la terre (60 ailleurs)
pub const EAU_ROUTE_5: f64 = 400.0; // (un théâtre) coût d'une demi-case d'eau pour le tracé d'une route (40 ailleurs : elle coupait les baies)
pub const EAU_MAX_5: f64 = 0.3; // (cases) une route d'un théâtre ne passe pas plus sur l'eau, hors de ses bouts ; sinon c'est un bac
pub const FUSION_5: (f64, f64) = (0.6, 0.5); // (cases) écart et longueur à partir desquels deux routes d'un théâtre se confondent (_fusionne)

// ------------------------------------------------------------------ aides hors du socle (privées)
/// `math.radians(x)`.
fn radians(x: f64) -> f64 {
    x * (std::f64::consts::PI / 180.0)
}
/// `min(a, b)` de Python entre flottants : le premier gagne en cas d'égalité.
fn min2(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
/// `max(a, b)` de Python entre flottants.
fn max2(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// `v or 1`.
fn ou1(v: f64) -> f64 {
    if v != 0.0 {
        v
    } else {
        1.0
    }
}
/// `math.dist(p, q)`.
fn dist(p: Pt, q: Pt) -> f64 {
    py::dist(p.0, p.1, q.0, q.1)
}
/// `[round(x, 2), round(y, 2)]`.
fn l2(p: Pt) -> Val {
    list![py::round_n(p.0, 2), py::round_n(p.1, 2)]
}
/// `hashlib.sha1(octets).hexdigest()`.
fn sha1_hex(donnees: &[u8]) -> String {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut m = donnees.to_vec();
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0)
    }
    m.extend_from_slice(&((donnees.len() as u64) * 8).to_be_bytes());
    for bloc in m.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([bloc[4 * i], bloc[4 * i + 1], bloc[4 * i + 2], bloc[4 * i + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y)
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/// `base64.b64encode(octets).decode()`.
pub fn b64encode(d: &[u8]) -> String {
    let mut s = String::with_capacity(d.len().div_ceil(3) * 4);
    for c in d.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(B64[(n >> 18) as usize] as char);
        s.push(B64[(n >> 12 & 63) as usize] as char);
        s.push(if c.len() > 1 { B64[(n >> 6 & 63) as usize] as char } else { '=' });
        s.push(if c.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    s
}
/// `base64.b64decode(texte)` (None : le texte n'est pas du base64, le cache est refait).
fn b64decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for o in s.bytes() {
        let v = match o {
            b'A'..=b'Z' => o - b'A',
            b'a'..=b'z' => o - b'a' + 26,
            b'0'..=b'9' => o - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        acc = acc << 6 | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

// ------------------------------------------------------------------ bruit, géométrie
pub fn _h(ix: i64, iy: i64, seed: i64) -> f64 {
    // (un int de Python n'a pas de borne ; seuls les 32 bits bas sont gardés : le calcul peut déborder sans rien changer)
    let n = (ix.wrapping_mul(374761393).wrapping_add(iy.wrapping_mul(668265263)).wrapping_add(seed.wrapping_mul(1442695041)) as u64) & 0xFFFFFFFF;
    let n = ((n ^ (n >> 13)).wrapping_mul(1274126177)) & 0xFFFFFFFF;
    ((n ^ (n >> 16)) & 0xFFFF) as f64 / 65535.0
}

pub fn vnoise(x: f64, y: f64, seed: i64) -> f64 {
    let (ix, iy) = (x.floor() as i64, y.floor() as i64);
    let (fx, fy) = (x - ix as f64, y - iy as f64);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (a, b) = (_h(ix, iy, seed), _h(ix + 1, iy, seed));
    let (c, d) = (_h(ix, iy + 1, seed), _h(ix + 1, iy + 1, seed));
    a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/// (octaves=3 en Python quand il n'est pas donné)
pub fn fbm(mut x: f64, mut y: f64, seed: i64, octaves: i64) -> f64 {
    let (mut t, mut amp, mut norm) = (0.0, 1.0, 0.0);
    for o in 0..octaves {
        t += vnoise(x, y, seed + o * 17) * amp;
        norm += amp;
        amp *= 0.5;
        x *= 2.03;
        y *= 2.03;
    }
    t / norm
}

/// Distance du point (y, x) au segment a-b (mêmes unités).
pub fn _dseg(y: f64, x: f64, ay: f64, ax: f64, by: f64, bx: f64) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let t = max2(0.0, min2(1.0, ((x - ax) * dx + (y - ay) * dy) / ou1(dx * dx + dy * dy)));
    py::hypot(ax + dx * t - x, ay + dy * t - y)
}

pub fn slugify(name: &str) -> String {
    const DE: &str = "éèêëàâäîïôöûüùçœÉÈÊÀÂÎÔÛÇ' -";
    const VERS: &[u8] = b"eeeeaaaiioouuucoEEEAAIOUC___";
    name.chars()
        .map(|ch| DE.chars().position(|c| c == ch).map_or(ch, |k| VERS[k] as char))
        .flat_map(|ch| ch.to_lowercase())
        .filter(|ch| ch.is_alphanumeric() || *ch == '_')
        .collect()
}

pub fn _seg_inter(p1: Pt, p2: Pt, p3: Pt, p4: Pt) -> Option<(f64, Pt)> {
    let ((x1, y1), (x2, y2), (x3, y3), (x4, y4)) = (p1, p2, p3, p4);
    let d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if d.abs() < 1e-12 {
        return None;
    }
    let t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    let u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    if 0.0 <= t && t <= 1.0 && 0.0 <= u && u <= 1.0 {
        return Some((t, (x1 + t * (x2 - x1), y1 + t * (y2 - y1))));
    }
    None
}

/// (distance, abscisse) du point le plus proche de p sur la polyligne line.
pub fn _proj(p: Pt, line: &[Pt]) -> (f64, f64) {
    let (mut best, mut s0) = ((1e18, 0.0), 0.0);
    for qr in line.windows(2) {
        let (q, r) = (qr[0], qr[1]);
        let (dx, dy) = (r.0 - q.0, r.1 - q.1);
        let L = py::hypot(dx, dy);
        let t = max2(0.0, min2(1.0, ((p.0 - q.0) * dx + (p.1 - q.1) * dy) / ou1(L * L)));
        let d = py::hypot(q.0 + dx * t - p.0, q.1 + dy * t - p.1);
        if d < best.0 {
            best = (d, s0 + t * L);
        }
        s0 += L;
    }
    best
}

/// La polyligne line du début jusqu'à l'abscisse s.
pub fn _jusqua(line: &[Pt], s: f64) -> Vec<Pt> {
    let (mut out, mut s0) = (vec![line[0]], 0.0);
    for qr in line.windows(2) {
        let (q, r) = (qr[0], qr[1]);
        let L = dist(q, r);
        if s0 + L >= s {
            let t = (s - s0) / ou1(L);
            out.push((q.0 + (r.0 - q.0) * t, q.1 + (r.1 - q.1) * t));
            return out;
        }
        out.push(r);
        s0 += L;
    }
    out
}

/// Ce que le Python range pour chaque route en projet (`dict(royal=…, ferry=…)`, plus `drop` à l'élagage).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Info {
    pub royal: bool,
    pub ferry: bool,
    pub drop: bool,
}
/// `pairs` du Python : les routes en projet, (a, b) -> Info, dans l'ordre où elles ont été posées (un dict).
pub type Pairs = IndexMap<(usize, usize), Info>;

/// Deux routes qui sortent d'une même ville côte à côte (moins de 0,35 km l'une de l'autre) se dessinaient en
/// double : la seconde reprend le tracé de la première (royales d'abord) jusqu'où elles se séparent, puis bifurque.
/// paths : les tracés de chaque paire (a, b), modifiés sur place. (En Python : ecart=0.35, mini=0.5.)
pub fn _troncs(paires: &[((usize, usize), Info)], paths: &mut [Vec<Pt>], ecart: f64, mini: f64) {
    let ordre = py::sorted_by_key((0..paires.len()).collect::<Vec<_>>(), |&k| (!paires[k].1.royal, k));
    let mut faits: HashMap<usize, Vec<Vec<Pt>>> = HashMap::new(); // lieu -> tracés déjà posés qui en partent, orientés depuis lui
    for k in ordre {
        let ((a, b), info) = paires[k];
        if info.ferry {
            continue;
        }
        for bout in [a, b] {
            let mut line: Vec<Pt> = if bout == a { paths[k].clone() } else { paths[k].iter().rev().copied().collect() };
            // échantillons tous les 100 m depuis le lieu : jusqu'où la route longe une route déjà posée
            let (mut ech, mut s): (Vec<(f64, Pt)>, f64) = (vec![], 0.0);
            for qr in line.windows(2) {
                let (q, r) = (qr[0], qr[1]);
                let L = dist(q, r);
                let n = py::int(L / 0.1).max(1);
                for i in 0..n {
                    let (i, n) = (i as f64, n as f64);
                    ech.push((s + L * i / n, (q.0 + (r.0 - q.0) * i / n, q.1 + (r.1 - q.1) * i / n)));
                }
                s += L;
            }
            let mut meilleur: Option<((f64, f64), usize)> = None; // (fin, rang du tracé parmi ceux du lieu)
            if let Some(poses) = faits.get(&bout) {
                for (rang, f) in poses.iter().enumerate() {
                    let mut fin = None;
                    for &(se, p) in ech.iter().skip(1) {
                        let (d, sf) = _proj(p, f);
                        if d > ecart {
                            break;
                        }
                        fin = Some((se, sf));
                    }
                    if let Some(fin) = fin {
                        if fin.0 >= mini && meilleur.is_none_or(|m| fin.0 > m.0 .0) {
                            meilleur = Some((fin, rang));
                        }
                    }
                }
            }
            if let Some(((se, sf), rang)) = meilleur {
                let mut neuve = _jusqua(&faits[&bout][rang], sf);
                neuve.extend(ech.iter().filter(|(s2, _)| *s2 > se + 0.05).map(|(_, p)| *p));
                neuve.push(*line.last().unwrap());
                line = neuve;
                paths[k] = if bout == a { line.clone() } else { line.iter().rev().copied().collect() };
            }
            faits.entry(bout).or_default().push(line);
        }
    }
}

/// (un théâtre) Deux routes qui vont côte à côte sur des kilomètres se dessinaient en double : _troncs (géographie 2, figée)
/// ne les fusionne que depuis leur place commune et s'arrête au premier écart. Ici chaque route (royales d'abord) reprend le
/// tracé d'une route déjà posée partout où elle la longe, à moins d'`ecart` et à peu près parallèle, sur au moins `mini`,
/// où qu'elles se rejoignent et autant de fois qu'il le faut. (web/js/carte/fusion-routes.js fait de même au dessin de la
/// carte de secours, pour l'Aquitaine.)
pub fn _fusionne(paires: &[((usize, usize), Info)], paths: &mut [Vec<Pt>], ecart: f64, mini: f64) {
    let abscisses = |pts: &[Pt]| -> Vec<f64> {
        let mut cum = vec![0.0];
        for q in pts.windows(2) {
            cum.push(cum.last().unwrap() + dist(q[0], q[1]));
        }
        cum
    };
    let ordre = py::sorted_by_key((0..paires.len()).collect::<Vec<_>>(), |&k| (!paires[k].1.royal, k));
    let mut poses: Vec<(Vec<Pt>, Vec<f64>)> = vec![]; // les tracés posés et leurs abscisses
    let mut grille: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new(); // case -> (tracé posé, segment) qui la touchent
    for k in ordre {
        if paires[k].1.ferry {
            continue;
        }
        let line = paths[k].clone();
        let cum = abscisses(&line);
        // échantillons tous les 0,2 case : (abscisse, point, tracé posé longé, abscisse sur lui)
        let mut ech: Vec<(f64, Pt, Option<(usize, f64)>)> = vec![];
        let mut prec: Option<usize> = None;
        for (i, qr) in line.windows(2).enumerate() {
            let (q, r) = (qr[0], qr[1]);
            let L = cum[i + 1] - cum[i];
            if L == 0.0 {
                continue;
            }
            let (ux, uy) = ((r.0 - q.0) / L, (r.1 - q.1) / L);
            let n = (L / 0.2).ceil() as usize;
            for s in 0..n {
                let t = L * s as f64 / n as f64;
                let p = (q.0 + ux * t, q.1 + uy * t);
                let (ci, cj) = (p.0.floor() as i64, p.1.floor() as i64);
                let mut best: Option<(usize, f64, f64)> = None; // (tracé, distance, abscisse sur lui)
                for di in -1..=1 {
                    for dj in -1..=1 {
                        for &(ro, sg) in grille.get(&(ci + di, cj + dj)).map_or(&[][..], |v| v.as_slice()) {
                            let (pts, pc) = &poses[ro];
                            let (a, lg) = (pts[sg], pc[sg + 1] - pc[sg]);
                            if lg == 0.0 {
                                continue;
                            }
                            let (vx, vy) = ((pts[sg + 1].0 - a.0) / lg, (pts[sg + 1].1 - a.1) / lg);
                            if (ux * vx + uy * vy).abs() < 0.9 {
                                continue;
                            }
                            let u = ((p.0 - a.0) * vx + (p.1 - a.1) * vy).clamp(0.0, lg);
                            let d = py::hypot(a.0 + vx * u - p.0, a.1 + vy * u - p.1);
                            // (le tracé déjà suivi l'emporte tant qu'il reste assez près : deux tracés déjà confondus alterneraient)
                            let pref = |r: usize| (Some(r) == prec) as i8;
                            if d <= ecart && best.is_none_or(|(br, bd, _)| pref(ro) > pref(br) || pref(ro) == pref(br) && d < bd) {
                                best = Some((ro, d, pc[sg] + u));
                            }
                        }
                    }
                }
                prec = best.map(|b| b.0);
                ech.push((cum[i] + t, p, best.map(|(ro, _, sf)| (ro, sf))));
            }
        }
        // les passages qui longent un même tracé sur au moins mini prennent ce tracé : (premier et dernier échantillon)
        let mut runs: Vec<(usize, usize)> = vec![];
        let mut i = 0;
        while i < ech.len() {
            let Some((ro, _)) = ech[i].2 else {
                i += 1;
                continue;
            };
            let mut j = i;
            while j + 1 < ech.len() && ech[j + 1].2.is_some_and(|(r, _)| r == ro) {
                j += 1;
            }
            if ech[j].0 - ech[i].0 >= mini {
                runs.push((i, j));
            }
            i = j + 1;
        }
        if !runs.is_empty() {
            let mut out = vec![line[0]];
            let pousse = |out: &mut Vec<Pt>, p: Pt| {
                if dist(*out.last().unwrap(), p) > 1e-9 {
                    out.push(p);
                }
            };
            // (on quitte le tracé à son point d'échantillon et on y revient par un court raccord, presque en travers : un
            // long biseau vers l'autre route la longerait encore ; entre deux passages qui se suivent, pas de raccord)
            let (mut fin, mut sortie, mut dernier): (f64, Option<Pt>, Option<usize>) = (0.0, None, None);
            for &(i, j) in &runs {
                let ((s0, p0, a), (s1, p1, b)) = (ech[i], ech[j]);
                let ((ro, sf0), (_, sf1)) = (a.unwrap(), b.unwrap());
                if dernier.is_none_or(|d| d + 1 != i) {
                    if let Some(q) = sortie {
                        pousse(&mut out, q);
                    }
                    for v in 1..line.len() - 1 {
                        if cum[v] > fin && cum[v] < s0 {
                            pousse(&mut out, line[v]);
                        }
                    }
                    pousse(&mut out, p0);
                }
                let (pts, pc) = &poses[ro];
                let mut m = crate::waterways::_cut(pts, pc, sf0.min(sf1), sf0.max(sf1));
                if sf1 < sf0 {
                    m.reverse();
                }
                for p in m {
                    pousse(&mut out, p);
                }
                (fin, sortie, dernier) = (s1, Some(p1), Some(j));
            }
            if let Some(q) = sortie {
                pousse(&mut out, q);
            }
            for v in 1..line.len() {
                if cum[v] > fin {
                    pousse(&mut out, line[v]);
                }
            }
            // (les bouts restent sur leurs places)
            if out.len() < 2 {
                out.push(*line.last().unwrap());
            } else {
                *out.last_mut().unwrap() = *line.last().unwrap();
            }
            paths[k] = out;
        }
        let ro = poses.len();
        let pts = paths[k].clone();
        for sg in 0..pts.len().saturating_sub(1) {
            let (a, b) = (pts[sg], pts[sg + 1]);
            for ci in a.0.min(b.0).floor() as i64..=a.0.max(b.0).floor() as i64 {
                for cj in a.1.min(b.1).floor() as i64..=a.1.max(b.1).floor() as i64 {
                    grille.entry((ci, cj)).or_default().push((ro, sg));
                }
            }
        }
        let pc = abscisses(&pts);
        poses.push((pts, pc));
    }
}

// ------------------------------------------------------------------ tracés sur une grille (W x H cases)
// (les méthodes _raster_ring, _raster_line et _bfs du Python : fonctions libres, pour que `fn` puisse écrire dans une
// grille de la carte pendant le tracé)
fn raster_ring(W: i64, H: i64, ring: &[Pt], fn_: &mut dyn FnMut(usize)) {
    let ymin = py::min_f(ring.iter().map(|p| p.1)).expect("ValueError: min() arg is an empty sequence");
    let ymax = py::max_f(ring.iter().map(|p| p.1)).unwrap();
    let (j0, j1) = (py::int(ymin).max(0), (py::int(ymax) + 1).min(H - 1));
    let n = ring.len();
    let mut xs: Vec<f64> = vec![];
    for j in j0..=j1 {
        let yc = j as f64 + 0.5;
        xs.clear();
        for k in 0..n {
            let (x1, y1) = ring[k];
            let (x2, y2) = ring[(k + 1) % n];
            if (y1 <= yc) != (y2 <= yc) {
                xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1));
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        for ab in xs.chunks_exact(2) {
            let i0 = py::int((ab[0] - 0.5).ceil()).max(0);
            let i1 = py::int((ab[1] - 0.5).floor()).min(W - 1);
            let base = j * W;
            for i in i0..=i1 {
                fn_((base + i) as usize);
            }
        }
    }
}

/// Les cases que la ligne traverse (f : cases par km).
fn raster_line(W: i64, H: i64, pts: &[Pt], fn_: &mut dyn FnMut(usize), step: f64, f: i64) {
    let (W, H) = (W * f, H * f);
    for seg in pts.windows(2) {
        let ((x1, y1), (x2, y2)) = (seg[0], seg[1]);
        let L = py::hypot(x2 - x1, y2 - y1);
        let n = py::int(L / step).max(1);
        for s in 0..=n {
            let t = s as f64 / n as f64;
            let (i, j) = (py::int((x1 + (x2 - x1) * t) * f as f64), py::int((y1 + (y2 - y1) * t) * f as f64));
            if 0 <= i && i < W && 0 <= j && j < H {
                fn_((j * W + i) as usize);
            }
        }
    }
}

fn bfs(W: i64, H: i64, sources: &[usize], maxd: i64, passable: Option<&dyn Fn(usize) -> bool>, f: i64) -> Vec<u8> {
    let (W, H) = (W * f, H * f);
    let mut dist = vec![255u8; (W * H) as usize];
    let mut q: Vec<usize> = sources.to_vec();
    for &c in &q {
        dist[c] = 0;
    }
    let mut head = 0;
    while head < q.len() {
        let c = q[head];
        head += 1;
        let d = dist[c] as i64 + 1;
        if d > maxd {
            continue;
        }
        let (i, j) = (c as i64 % W, c as i64 / W);
        for (ni, nj) in [(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)] {
            if 0 <= ni && ni < W && 0 <= nj && nj < H {
                let nc = (nj * W + ni) as usize;
                if dist[nc] as i64 > d && passable.is_none_or(|p| p(nc)) {
                    dist[nc] = d as u8;
                    q.push(nc);
                }
            }
        }
    }
    dist
}

// les huit voisins d'une case et le pas pour y aller (1, ou la diagonale)
const D2: f64 = std::f64::consts::SQRT_2; // math.sqrt(2)
const NBRS: [(i64, i64, f64); 8] = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)];

pub struct GeoMap {
    pub version: i64,
    /// Le théâtre de cette carte (None : l'Aquitaine, les anciennes cartes).
    pub theatre: Option<&'static Theatre>,
    pub suffixe: String,
    pub src: Val,
    pub lon0: f64,
    pub lon1: f64,
    pub lat0: f64,
    pub lat1: f64,
    pub KX: f64,
    /// (cases par degré de latitude : KY du module, divisé par km_case)
    pub KY: f64,
    /// Kilomètres par case : 1, ou 5 pour un théâtre. Le moteur compte en cases ; seule la projection en tient compte.
    pub km_case: f64,
    /// Un set de codes de départements (textes).
    pub playable_codes: Val,
    pub W: i64,
    pub H: i64,
    pub dept_codes: Vec<String>,
    pub nodes: Val,
    pub by_name: Val,
    pub terrain: Vec<u8>,
    pub dept: Vec<u8>,
    pub river: Vec<u8>,
    pub road: Vec<u8>,
    pub cellnode: Vec<u16>,
    pub edges: Val,
    // (posés par waterways.build)
    pub ways: Val,
    pub edge_cum: Val,
    pub ports: Val,
    pub down_nodes: Val,
    pub adj: Val,
    /// La grille des rivières à la demi-case (_route_f) : seulement sur une carte générée, pas relue du cache.
    pub _rivf: Option<Vec<u8>>,
    /// cell_costs : calculé une fois.
    pub _ccost: OnceCell<Vec<Option<f64>>>,
    /// Les étendues d'eau (marine::etendues) : calculées une fois, à la première recherche de chemin sur l'eau.
    pub _etendues: OnceCell<Option<Vec<u32>>>,
    /// Le calcul de crue.py (`geo._crue`), rangé sur la carte : None tant qu'il n'est pas fait.
    pub _crue: RefCell<Val>,
    /// (privé, pour la vitesse) `dept_codes[d - 1] in playable_codes` pour chaque valeur d de la grille dept (faux pour 0).
    jouable: Vec<bool>,
    // (SPEC-EMPIRE, module 3 : la carte monde ; vides sur les autres cartes)
    /// Les théâtres posés sur la grille, d'ouest en est.
    pub parties: Vec<Partie>,
    /// Les routes maritimes entre théâtres : [{id, de: [x, y], vers: [x, y], tours, nom}] (cases de la grille).
    pub routes_mer: Val,
    /// Les balises d'horizon (un départ de route maritime) : [{case: [x, y], nom, route}].
    pub sorties: Val,
    /// Les comptoirs en mer : [{id, nom, x, y, theatre, denree}] (une case d'océan).
    pub comptoirs: Val,
}

impl GeoMap {
    /// `GeoMap(version)` ; `GeoMap()` : `GeoMap::new(VERSION)`.
    pub fn new(version: i64) -> GeoMap {
        if version == VERSION_MONDE {
            return GeoMap::monde();
        }
        let suffixe = format!("_v{version}");
        let theatre = theatre(version);
        let texte = match (version, theatre) {
            (1, _) => GEO_V1,
            (2, _) => GEO_V2,
            (_, Some(t)) => t.carte,
            // (3 et 4 : la carte de France, retirée le 22/11/2026 ; le serveur refuse ces sauvegardes avant : geo::connue)
            _ => panic!("FileNotFoundError: géographie {version} inconnue"),
        };
        let src = json::loads(texte).unwrap_or_else(|e| panic!("carte de la géographie {version} : {e}"));
        let b = src.at("bounds");
        let (lon0, lon1, lat0, lat1) = (b.at("lon0").f(), b.at("lon1").f(), b.at("lat0").f(), b.at("lat1").f());
        let km_case = src.get_or("km_case", 1).f();
        // (le parallèle de référence de la carte ; cases par degré : pour les cartes au kilomètre, x / 1.0 ne change pas un bit)
        let KX = 111.32 * radians(src.get_or("lat_ref", LAT_REF).f()).cos() / km_case;
        let KY_ = KY / km_case;
        let playable_codes = Val::new_set();
        for (c, d) in src.at("depts").items() {
            if d.get("playable").truthy() {
                playable_codes.push(c)
            }
        }
        let W = py::int(((lon1 - lon0) * KX).ceil());
        let H = py::int(((lat1 - lat0) * KY_).ceil());
        let mut dept_codes: Vec<String> = src.at("depts").keys().iter().map(Val::string).collect();
        dept_codes.sort();
        assert!(dept_codes.len() <= 255, "ValueError: byte must be in range(0, 256)");
        let mut jouable = vec![false];
        jouable.extend(dept_codes.iter().map(|c| playable_codes.has(c)));
        let mut g = GeoMap {
            version,
            theatre,
            suffixe,
            src,
            lon0,
            lon1,
            lat0,
            lat1,
            KX,
            KY: KY_,
            km_case,
            playable_codes,
            W,
            H,
            dept_codes,
            nodes: list![],
            by_name: Val::dict(),
            terrain: vec![],
            dept: vec![],
            river: vec![],
            road: vec![],
            cellnode: vec![],
            edges: list![],
            ways: Val::dict(),
            edge_cum: Val::dict(),
            ports: Val::dict(),
            down_nodes: Val::dict(),
            adj: Val::dict(),
            _rivf: None,
            _ccost: OnceCell::new(),
            _etendues: OnceCell::new(),
            _crue: RefCell::new(Val::None),
            jouable,
            parties: vec![],
            routes_mer: list![],
            sorties: list![],
            comptoirs: list![],
        };
        g._build_nodes();
        g._load_or_generate();
        crate::waterways::build(&mut g);
        for i in 0..g.nodes.len() {
            g.adj.set(i, list![]);
        }
        for e in g.edges.iter() {
            g.adj.at(&e.at("a")).push(e.at("id"));
            g.adj.at(&e.at("b")).push(e.at("id"));
        }
        g
    }

    /// (SPEC-EMPIRE, module 3) La carte monde : celles de THEATRES_MONDE, faites ou relues de leur cache (GeoMap::new), posées
    /// sur une grille ; leurs places, arêtes, voies d'eau et tracés décalés, sans rien recalculer. Elle n'a pas de cache à elle.
    fn monde() -> GeoMap {
        let cartes: Vec<GeoMap> = THEATRES_MONDE.iter().map(|&v| GeoMap::new(v)).collect();
        let (KY_, km_case) = (cartes[0].KY, cartes[0].km_case);
        let lat1 = cartes.iter().map(|c| c.lat1).fold(f64::MIN, f64::max);
        let (mut ox, mut n0) = (0, 0);
        let mut parties = vec![];
        for c in &cartes {
            assert!(c.km_case == km_case && c.KY == KY_, "{} : une autre échelle", c.version);
            let n = c.nodes.len() as i64;
            let mut pays: Vec<String> = c.playable_codes.iter().map(|v| v.string()).collect();
            pays.sort();
            parties.push(Partie { theatre: c.theatre.unwrap(), ox, oy: py::int(((lat1 - c.lat1) * KY_).round()), W: c.W, H: c.H,
                lon0: c.lon0, lon1: c.lon1, lat1: c.lat1, KX: c.KX, noeuds: n0..n0 + n, pays });
            ox += c.W + MER_MONDE;
            n0 += n;
        }
        assert!(n0 < NONE, "trop de places pour cellnode");
        let (W, H) = (ox - MER_MONDE, parties.iter().map(|p| p.oy + p.H).max().unwrap());
        let mut dept_codes: Vec<String> = cartes.iter().flat_map(|c| c.dept_codes.iter().cloned()).collect();
        dept_codes.sort();
        let n_codes = dept_codes.len();
        dept_codes.dedup();
        assert!(dept_codes.len() == n_codes && n_codes <= 255, "codes des pays : pris deux fois, ou plus de 255");
        let N = (W * H) as usize;
        let (mut terrain, mut dept, mut river, mut road, mut cellnode) = (vec![OCEAN; N], vec![0u8; N], vec![0u8; N], vec![0u8; N], vec![NONE as u16; N]);
        let playable_codes = Val::new_set();
        let (nodes, by_name, edges, ways, edge_cum, ports, down_nodes) = (list![], Val::dict(), list![], Val::dict(), Val::dict(), Val::dict(), Val::dict());
        let (depts, rivers, waters) = (Val::dict(), list![], list![]);
        let mut slugs: HashSet<String> = HashSet::new();
        // (un point [x, y, …] décalé : arrondi au centième comme les tracés des arêtes ; un point (x, y) des voies, tel quel)
        let decale = |q: &Val, dx: f64, dy: f64| -> Val {
            let v = q.vec();
            let mut out = vec![Val::from(py::round_n(v[0].f() + dx, 2)), Val::from(py::round_n(v[1].f() + dy, 2))];
            out.extend(v[2..].iter().cloned());
            Val::list(out)
        };
        let decale_pt = |q: &Val, dx: f64, dy: f64| -> Val { Val::from((q.at(0).f() + dx, q.at(1).f() + dy)) };
        for (c, p) in cartes.iter().zip(&parties) {
            let (dx, dy, noff, eoff) = (p.ox as f64, p.oy as f64, p.noeuds.start, edges.len() as i64);
            // les grilles, chaque pays à son rang parmi tous les codes
            let rang: Vec<u8> = std::iter::once(0).chain(c.dept_codes.iter().map(|d| dept_codes.binary_search(d).unwrap() as u8 + 1)).collect();
            for j in 0..c.H {
                let (s, d) = ((j * c.W) as usize, ((j + p.oy) * W + p.ox) as usize);
                for i in 0..c.W as usize {
                    terrain[d + i] = c.terrain[s + i];
                    dept[d + i] = rang[c.dept[s + i] as usize];
                    river[d + i] = c.river[s + i];
                    road[d + i] = c.road[s + i];
                    let v = c.cellnode[s + i];
                    cellnode[d + i] = if v as i64 == NONE { v } else { v + noff as u16 };
                }
            }
            for code in c.playable_codes.iter() {
                playable_codes.push(code);
            }
            // les places (deux homonymes de théâtres différents : Guadalajara, Valladolid… le second slug prend le théâtre)
            for n in c.nodes.iter() {
                let m = n.copy();
                let id = n.ati("id") + noff;
                let mut slug = n.ats("slug");
                if !slugs.insert(slug.clone()) {
                    slug = format!("{slug}-{}", p.theatre.id);
                    assert!(slugs.insert(slug.clone()), "deux places « {slug} »");
                }
                for (k, v) in [("id", Val::from(id)), ("slug", Val::from(slug)), ("x", Val::from(py::round_n(n.atf("x") + dx, 2))),
                    ("y", Val::from(py::round_n(n.atf("y") + dy, 2))), ("theatre", Val::from(p.theatre.id))] {
                    m.set(k, v);
                }
                by_name.setdefault(&n.at("name"), id);
                nodes.push(m);
            }
            // les arêtes (routes, bacs, voies d'eau) et leurs longueurs cumulées
            for (k, e) in c.edges.iter().enumerate() {
                assert!(e.ati("id") == k as i64, "arêtes : numéros");
                let f = e.copy();
                f.set("id", k as i64 + eoff);
                f.set("a", e.ati("a") + noff);
                f.set("b", e.ati("b") + noff);
                if e.get("down").is_some() {
                    f.set("down", e.ati("down") + noff);
                }
                for (cx, d) in [("cx", dx), ("cy", dy), ("bx", dx), ("by", dy)] {
                    if e.get(cx).is_some() {
                        f.set(cx, py::round_n(e.atf(cx) + d, 2));
                    }
                }
                if e.has("ponts") {
                    f.set("ponts", e.at("ponts").iter().map(|q| decale(&q, dx, dy)).collect::<Val>());
                }
                f.set("pts", e.at("pts").iter().map(|q| decale(&q, dx, dy)).collect::<Val>());
                edge_cum.set(k as i64 + eoff, c.edge_cum.at(k as i64));
                edges.push(f);
            }
            for (nom, w) in c.ways.items() {
                assert!(!ways.has(&nom), "deux voies d'eau « {nom} »");
                let v = w.copy();
                v.set("pts", w.at("pts").iter().map(|q| decale_pt(&q, dx, dy)).collect::<Val>());
                v.set("ports", w.at("ports").iter().map(|q| {
                    let r = q.copy();
                    r.set("node", q.ati("node") + noff);
                    r.set("q", decale_pt(&q.at("q"), dx, dy));
                    r.set("spur", q.at("spur").iter().map(|s| decale_pt(&s, dx, dy)).collect::<Val>());
                    r
                }).collect::<Val>());
                ways.set(nom, v);
            }
            for (nid, l) in c.ports.items() {
                ports.set(nid.i() + noff, l);
            }
            for (nid, l) in c.down_nodes.items() {
                down_nodes.set(nid.i() + noff, l.iter().map(|x| Val::from(x.i() + noff)).collect::<Val>());
            }
            // les tracés pour la page (frontières, fleuves, lacs), déjà projetés par le théâtre
            let (d0, r0, w0) = c.traces_client();
            for (code, d) in d0.items() {
                let e = d.copy();
                e.set("rings", d.at("rings").iter().map(|r| r.iter().map(|q| decale(&q, dx, dy)).collect::<Val>()).collect::<Val>());
                depts.set(code, e);
            }
            for r in r0.iter() {
                let e = r.copy();
                e.set("pts", r.at("pts").iter().map(|q| decale(&q, dx, dy)).collect::<Val>());
                rivers.push(e);
            }
            for w in w0.iter() {
                let e = w.copy();
                e.set("ring", w.at("ring").iter().map(|q| decale(&q, dx, dy)).collect::<Val>());
                waters.push(e);
            }
        }
        let mut jouable = vec![false];
        jouable.extend(dept_codes.iter().map(|c| playable_codes.has(c)));
        let lat0 = cartes.iter().map(|c| c.lat0).fold(f64::MAX, f64::min);
        let (lon0, lon1) = (parties[0].lon0, parties[parties.len() - 1].lon1);
        // (bounds et KX n'ont pas de sens sur toute la grille : ceux du premier théâtre ; chaque partie a sa projection, xy)
        let src = dict! {"bounds" => dict!{"lon0" => lon0, "lon1" => lon1, "lat0" => lat0, "lat1" => lat1}, "depts" => depts, "rivers" => rivers, "waters" => waters};
        let g = GeoMap {
            version: VERSION_MONDE,
            theatre: Some(&MONDE),
            suffixe: format!("_v{VERSION_MONDE}"),
            src,
            lon0,
            lon1,
            lat0,
            lat1,
            KX: parties[0].KX,
            KY: KY_,
            km_case,
            playable_codes,
            W,
            H,
            dept_codes,
            nodes,
            by_name,
            terrain,
            dept,
            river,
            road,
            cellnode,
            edges,
            ways,
            edge_cum,
            ports,
            down_nodes,
            adj: Val::dict(),
            _rivf: None,
            _ccost: OnceCell::new(),
            _etendues: OnceCell::new(),
            _crue: RefCell::new(Val::None),
            jouable,
            parties,
            routes_mer: list![],
            sorties: list![],
            comptoirs: list![],
        };
        for i in 0..g.nodes.len() {
            g.adj.set(i, list![]);
        }
        for e in g.edges.iter() {
            g.adj.at(&e.at("a")).push(e.at("id"));
            g.adj.at(&e.at("b")).push(e.at("id"));
        }
        // les routes maritimes (dans les deux sens), leurs balises d'horizon, les comptoirs
        for &((ta, la, oa), (tb, lb, ob), tours, aller, retour) in ROUTES_MER {
            let (ca, cb) = (g.case_de_mer(ta, la, oa), g.case_de_mer(tb, lb, ob));
            for (de, vers, a, b, nom) in [(ca, cb, ta, tb, aller), (cb, ca, tb, ta, retour)] {
                let id = format!("{a}-{b}");
                g.routes_mer.push(dict! {"id" => &id, "de" => list![de.0, de.1], "vers" => list![vers.0, vers.1], "tours" => tours, "nom" => nom});
                g.sorties.push(dict! {"case" => list![de.0, de.1], "nom" => nom, "route" => id});
            }
        }
        for &(id, nom, t, lat, lon, denree) in COMPTOIRS {
            let (x, y) = g.case_de_mer(t, lat, lon);
            g.comptoirs.push(dict! {"id" => id, "nom" => nom, "x" => x, "y" => y, "theatre" => t, "denree" => denree});
        }
        g
    }

    /// (la carte monde) La case d'océan la plus proche de ce point (lat, lon) du théâtre, dans son cadre : [colonne, ligne].
    fn case_de_mer(&self, theatre: &str, lat: f64, lon: f64) -> (i64, i64) {
        let p = self.parties.iter().find(|p| p.theatre.id == theatre).unwrap_or_else(|| panic!("théâtre {theatre} absent"));
        let (i0, j0) = (py::int(p.ox as f64 + (lon - p.lon0) * p.KX), py::int(p.oy as f64 + (p.lat1 - lat) * self.KY));
        for r in 0..80 {
            let mut best: Option<(i64, i64, i64)> = None; // (distance², ligne, colonne) : la plus proche, puis la première
            for j in j0 - r..=j0 + r {
                for i in i0 - r..=i0 + r {
                    let dedans = p.ox <= i && i < p.ox + p.W && p.oy <= j && j < p.oy + p.H;
                    if (i - i0).abs().max((j - j0).abs()) != r || !dedans || self.terrain[(j * self.W + i) as usize] != OCEAN {
                        continue;
                    }
                    let d2 = (i - i0).pow(2) + (j - j0).pow(2);
                    if best.is_none_or(|b| (d2, j, i) < b) {
                        best = Some((d2, j, i));
                    }
                }
            }
            if let Some((_, j, i)) = best {
                return (i, j);
            }
        }
        panic!("pas d'océan près de ({lat}, {lon}) en {theatre}")
    }

    /// Le théâtre d'une place (« europe », « amerique »…) : celui de sa carte, ou sur la carte monde celui de la partie où elle
    /// est (son champ "theatre") ; None sur la carte d'Aquitaine.
    pub fn theatre_de(&self, nid: i64) -> Option<&'static str> {
        if self.parties.is_empty() {
            return self.theatre.map(|t| t.id);
        }
        self.parties.iter().find(|p| p.noeuds.contains(&nid)).map(|p| p.theatre.id)
    }

    /// Le théâtre d'une case (x, y) : celui de la carte, ou sur la carte monde celui de la partie (None entre deux cartes).
    pub fn theatre_case(&self, x: f64, y: f64) -> Option<&'static str> {
        if self.cell(x, y) < 0 {
            return None;
        }
        if self.parties.is_empty() {
            return self.theatre.map(|t| t.id);
        }
        self.parties.iter().find(|p| p.ox as f64 <= x && x < (p.ox + p.W) as f64 && p.oy as f64 <= y && y < (p.oy + p.H) as f64).map(|p| p.theatre.id)
    }

    // ------------------------------------------------------------ projection
    pub fn xy(&self, lat: f64, lon: f64) -> Pt {
        // (la carte monde : la projection du théâtre de cette longitude, décalée ; leurs longitudes ne se chevauchent pas)
        if let Some(p) = self.parties.iter().find(|p| p.lon0 <= lon && lon <= p.lon1) {
            return (p.ox as f64 + (lon - p.lon0) * p.KX, p.oy as f64 + (p.lat1 - lat) * self.KY);
        }
        ((lon - self.lon0) * self.KX, (self.lat1 - lat) * self.KY)
    }

    /// (la carte monde : la latitude à une demi-case près, les théâtres étant posés à leur latitude)
    pub fn lat_of(&self, y: f64) -> f64 {
        self.lat1 - y / self.KY
    }

    pub fn lon_of(&self, x: f64) -> f64 {
        if let Some(p) = self.parties.iter().find(|p| p.ox as f64 <= x && x < (p.ox + p.W) as f64) {
            return p.lon0 + (x - p.ox as f64) / p.KX;
        }
        self.lon0 + x / self.KX
    }

    pub fn cell(&self, x: f64, y: f64) -> i64 {
        let (i, j) = (py::int(x), py::int(y));
        if 0 <= i && i < self.W && 0 <= j && j < self.H {
            return j * self.W + i;
        }
        -1
    }

    pub fn terrain_at(&self, x: f64, y: f64) -> i64 {
        let c = self.cell(x, y);
        if c >= 0 {
            self.terrain[c as usize] as i64
        } else {
            T_OCEAN
        }
    }

    pub fn playable_at(&self, x: f64, y: f64) -> bool {
        let c = self.cell(x, y);
        if c < 0 {
            return false;
        }
        let d = self.dept[c as usize];
        d > 0 && self.jouable[d as usize] && self.terrain[c as usize] > EAU
    }

    pub fn dept_at(&self, x: f64, y: f64) -> Option<&str> {
        let c = self.cell(x, y);
        if c < 0 || self.dept[c as usize] == 0 {
            return None;
        }
        Some(&self.dept_codes[self.dept[c as usize] as usize - 1])
    }

    // ------------------------------------------------------------ nœuds
    fn _build_nodes(&mut self) {
        self.nodes = list![];
        self.by_name = Val::dict();
        if let Some(t) = self.theatre {
            // (un théâtre) ses places, faites par outils/europe.mjs ou outils/theatre.mjs : les seules de cette carte
            let mut slugs: HashSet<String> = HashSet::new();
            for (k, place) in json::loads(t.places).unwrap_or_else(|e| panic!("places_{}.json : {e}", t.id)).iter().enumerate() {
                let p = place.vec(); // (name, lat, lon, pays, typ, spec, fort, pop0)
                assert!(p.len() == 8, "ValueError: 8 valeurs attendues, {} reçues", p.len());
                let name = &p[0];
                let (x, y) = self.xy(p[1].f(), p[2].f());
                let mut slug = slugify(name.s());
                if slugs.contains(&slug) {
                    slug = format!("{slug}-{}", p[3].s().to_lowercase()); // (homonymes : Alexandrie, Monastir, Gallipoli, Marbourg)
                }
                assert!(slugs.insert(slug.clone()), "ValueError: deux places « {slug} »");
                // (spec : les spécialités que le jeu connaît, R::SPEC ; les autres étiquettes, arsenal, commerce, peche, le
                // rôle d'un port en vue d'un mode naval, sont gardées à part dans « roles » et ne comptent pour rien)
                let (spec, roles): (Vec<Val>, Vec<Val>) = p[5].iter().partition(|t| crate::rules::SPEC().has(t));
                self.nodes.push(dict! {"id" => k, "slug" => slug, "name" => name, "x" => py::round_n(x, 2), "y" => py::round_n(y, 2), "dept" => &p[3], "type" => &p[4],
                "spec" => Val::list(spec), "roles" => Val::list(roles), "fort" => &p[6], "pop0" => &p[7]});
                self.by_name.setdefault(name, k);
            }
            return;
        }
        let places = self.src.get_or("places", Val::dict());
        for (k, place) in PLACES().iter().enumerate() {
            let p = place.vec(); // (name, lat, lon, dept, typ, spec, fort)
            let name = &p[0];
            let ll = places.get_or(name, tup![&p[1], &p[2]]); // (une ancienne géographie : la place d'alors)
            let (x, y) = self.xy(ll.at(0).f(), ll.at(1).f());
            let n = dict! {"id" => k, "slug" => slugify(name.s()), "name" => name, "x" => py::round_n(x, 2), "y" => py::round_n(y, 2), "dept" => &p[3],
            "type" => &p[4], "spec" => p[5].to_list(), "fort" => &p[6]};
            if CITY_SPECIALTIES().has(name) {
                n.set("star", CITY_SPECIALTIES().at(name).to_list()); // spécialité phare : [type, nom]
            }
            // population de départ : chiffres d'époque pour les villes, 300 à 1 600 âmes pour un village
            let h = i64::from_str_radix(&sha1_hex(name.s().as_bytes())[..6], 16).unwrap();
            n.set("pop0", CITY_POP().get_or(name, 300 + (h % 1301)));
            self.nodes.push(n);
            self.by_name.set(name, k);
        }
    }

    /// (privé) Les (x, y) des lieux, en nombres natifs.
    fn noeuds_xy(&self) -> Vec<Pt> {
        self.nodes.iter().map(|n| (n.at("x").f(), n.at("y").f())).collect()
    }

    // ------------------------------------------------------------ cache
    pub fn _src_hash(&self) -> String {
        let mut h: Vec<u8> = vec![];
        h.extend(json::dumps_avec(&self.src, json::Ecriture { ascii: true, sort_keys: true, ..Default::default() }).as_bytes());
        if let Some(t) = self.theatre {
            // (un théâtre : sa source, ses places, la version de son calcul ; aucune table du Sud-Ouest)
            h.extend(t.places.as_bytes());
            h.extend(format!("{}{GEN_THEATRE}/{CACHE_VERSION}", t.id).as_bytes());
            return sha1_hex(&h);
        }
        h.extend(PLACES().repr().as_bytes());
        h.extend(ROYAL_ROUTES().repr().as_bytes());
        h.extend(EXTRA_ROADS().repr().as_bytes());
        h.extend((&EXTRA_ROADS_2() + &NO_ROADS_2()).repr().as_bytes());
        h.extend(CACHE_VERSION.to_string().as_bytes());
        // (le Python comptait aussi le texte de geo.py : depuis son retrait, le 15/11/2026, l'empreinte change une fois et
        // les caches écrits avant sont refaits au premier lancement, quelques secondes)
        sha1_hex(&h)
    }

    fn _load_or_generate(&mut self) {
        let path = data_dir().join(format!("map_cache{}.json", self.suffixe));
        let hsh = self._src_hash();
        if path.exists() {
            // (try / except Exception du Python : au moindre défaut du fichier, la carte est refaite)
            let lu = (|| {
                let c = json::loads(&std::fs::read_to_string(&path).ok()?).ok()?;
                if !c.is_dict() || c.get("hash") != hsh.as_str() {
                    return None;
                }
                let octets = |cle: &str| -> Option<Vec<u8>> {
                    match c.get(cle) {
                        Val::Str(s) => b64decode(&s),
                        _ => None,
                    }
                };
                let cn = octets("cellnode")?;
                if cn.len() % 2 != 0 || !c.has("edges") {
                    return None;
                }
                Some((octets("terrain")?, octets("dept")?, octets("river")?, octets("road")?, _h16(&cn), c.at("edges")))
            })();
            if let Some((terrain, dept, river, road, cellnode, edges)) = lu {
                (self.terrain, self.dept, self.river, self.road, self.cellnode, self.edges) = (terrain, dept, river, road, cellnode, edges);
                return;
            }
        }
        self._generate();
        let c = dict! {"hash" => hsh,
        "terrain" => b64encode(&self.terrain),
        "dept" => b64encode(&self.dept),
        "river" => b64encode(&self.river),
        "road" => b64encode(&self.road),
        "cellnode" => b64encode(&_b16(&self.cellnode)),
        "edges" => &self.edges};
        let _ = std::fs::write(&path, json::dumps(&c)); // (OSError : tant pis, la carte sera refaite au prochain lancement)
    }

    // ------------------------------------------------------------ génération
    /// (privé) `[self.xy(lat, lon) for lon, lat in pts]` : une ligne de la source, en km.
    fn pts_lonlat(&self, pts: &Val) -> Vec<Pt> {
        pts.iter().map(|p| self.xy(p.at(1).f(), p.at(0).f())).collect()
    }

    fn _rings_xy(&self, rings: &Val) -> Vec<Vec<Pt>> {
        rings.iter().map(|r| self.pts_lonlat(&r)).collect()
    }

    pub fn _raster_ring(&self, ring: &[Pt], fn_: &mut dyn FnMut(usize)) {
        raster_ring(self.W, self.H, ring, fn_)
    }

    /// Les cases que la ligne traverse (f : cases par km). (En Python : step=0.35, f=1.)
    pub fn _raster_line(&self, pts: &[Pt], fn_: &mut dyn FnMut(usize), step: f64, f: i64) {
        raster_line(self.W, self.H, pts, fn_, step, f)
    }

    /// (En Python : passable=None, f=1.)
    pub fn _bfs(&self, sources: &[usize], maxd: i64, passable: Option<&dyn Fn(usize) -> bool>, f: i64) -> Vec<u8> {
        bfs(self.W, self.H, sources, maxd, passable, f)
    }

    fn _generate(&mut self) {
        let (W, H) = (self.W, self.H);
        let (Wu, Hu) = (W as usize, H as usize);
        let N = Wu * Hu;
        let voisins = |c: usize| {
            let (i, j) = ((c % Wu) as i64, (c / Wu) as i64);
            [(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)].into_iter().filter(move |&(ni, nj)| 0 <= ni && ni < W && 0 <= nj && nj < H).map(move |(ni, nj)| (nj * W + ni) as usize)
        };
        let mut dept = vec![0u8; N];
        for (idx, code) in self.dept_codes.iter().enumerate() {
            for ring in self._rings_xy(&self.src.at("depts").at(code).at("rings")) {
                let v = (idx + 1) as u8;
                raster_ring(W, H, &ring, &mut |c| dept[c] = v);
            }
        }

        // bouche les trous de rastérisation (cellules isolées hors département)
        let mut outside = vec![0u8; N];
        let mut q: Vec<usize> = (0..N).filter(|&c| dept[c] == 0 && (c % Wu == 0 || c % Wu == Wu - 1 || c / Wu == 0 || c / Wu == Hu - 1)).collect();
        for &c in &q {
            outside[c] = 1;
        }
        let mut k = 0;
        while k < q.len() {
            let c = q[k];
            k += 1;
            for nc in voisins(c) {
                if outside[nc] == 0 && dept[nc] == 0 {
                    outside[nc] = 1;
                    q.push(nc);
                }
            }
        }
        for _ in 0..4 {
            for c in 0..N {
                if dept[c] == 0 && outside[c] == 0 {
                    for nc in voisins(c) {
                        if dept[nc] != 0 {
                            dept[c] = dept[nc];
                            break;
                        }
                    }
                }
            }
        }

        let mut water = vec![0u8; N]; // 1 = lac/estuaire/bassin
        let mut estuary: Vec<usize> = vec![];
        for w in self.src.at("waters").iter() {
            let ring = self.pts_lonlat(&w.at("ring"));
            let mut acc: Vec<usize> = vec![];
            raster_ring(W, H, &ring, &mut |c| acc.push(c));
            for &c in &acc {
                water[c] = 1;
            }
            if w.at("name").has("Gironde") {
                estuary = acc;
            }
        }

        let y_spain = self.xy(43.36, 0.0).1;
        let mut hors = vec![0u8; N]; // (un théâtre) les terres hors du jeu
        for l in self.src.get_or("lands", list![]).iter() {
            raster_ring(W, H, &self.pts_lonlat(&l.at("ring")), &mut |c| hors[c] = 1);
        }
        let mut terrain = vec![0u8; N];
        let mut ocean_src: Vec<usize> = vec![];
        for c in 0..N {
            let j = c / Wu;
            if water[c] != 0 {
                terrain[c] = EAU;
            } else if dept[c] == 0 {
                if self.theatre.is_some() {
                    if hors[c] != 0 {
                        terrain[c] = PLAINE;
                    } else {
                        terrain[c] = OCEAN;
                        ocean_src.push(c);
                    }
                } else if j as f64 + 0.5 > y_spain && (c % Wu) > 3 {
                    terrain[c] = PLAINE; // Espagne (hors jeu)
                } else {
                    terrain[c] = OCEAN;
                    ocean_src.push(c);
                }
            } else {
                terrain[c] = PLAINE;
            }
        }
        // Espagne : marquée hors jeu par dept=0 (déjà)

        let d_ocean = bfs(W, H, &ocean_src, 12, Some(&|c| terrain[c] != OCEAN), 1);
        let d_estu = bfs(W, H, &estuary, 8, Some(&|c| terrain[c] != OCEAN && terrain[c] != EAU), 1);

        // Rivières
        let mut river = vec![0u8; N];
        let mut adour: Vec<usize> = vec![];
        for r in self.src.at("rivers").iter() {
            let pts = self.pts_lonlat(&r.at("pts"));
            let lvl = niveau(&r.at("rank"));
            raster_line(
                W,
                H,
                &pts,
                &mut |c| {
                    if river[c] < lvl {
                        river[c] = lvl
                    }
                },
                0.35,
                1,
            );
            if r.at_is("name", "Adour") {
                raster_line(W, H, &pts, &mut |c| adour.push(c), 0.35, 1);
            }
        }
        let d_adour = bfs(W, H, &adour, 3, None, 1);
        let d_riv = bfs(W, H, &(0..N).filter(|&c| river[c] != 0).collect::<Vec<_>>(), 5, None, 1);

        let landes: Vec<Pt> = LANDES_POLY.iter().map(|&(lat, lon)| self.xy(lat, lon)).collect();
        let mut in_landes = vec![0u8; N];
        raster_ring(W, H, &landes, &mut |c| in_landes[c] = 1);

        let forests: Vec<(Pt, f64, f64)> = FORESTS.iter().map(|&(la, lo, r, d)| (self.xy(la, lo), r, d)).collect();
        let vines: Vec<(Pt, f64)> = VINEYARDS.iter().map(|&(la, lo, r)| (self.xy(la, lo), r)).collect();

        for c in 0..N {
            if terrain[c] == OCEAN || terrain[c] == EAU {
                continue;
            }
            let (i, j) = (c % Wu, c / Wu);
            let (x, y) = (i as f64 + 0.5, j as f64 + 0.5);
            let (lat, lon) = (self.lat_of(y), self.lon_of(x));
            if self.theatre.is_some() {
                terrain[c] = if self.version == VERSION_EUROPE { GeoMap::_terrain5(x, y, lat, lon, d_ocean[c], d_riv[c]) } else { GeoMap::_terrain_theatre(x, y) };
                continue;
            }
            let mut e = GeoMap::_elev(lat, lon) + (fbm(x / 22.0, y / 22.0, 11, 4) - 0.5) * 0.42;
            if lat < 43.35 {
                // (les vallées des montagnes sont creusées par leurs rivières)
                e -= 0.6 * (-py::pow(d_riv[c] as f64 / 2.6, 2.0)).exp();
            } else {
                e = min2(e, 0.78);
            }
            if e > 1.55 {
                terrain[c] = HAUTE;
                continue;
            }
            if e > 0.80 {
                terrain[c] = MONTAGNE;
                continue;
            }
            let mut t = if e > 0.42 { COLLINES } else { PLAINE };
            let n1 = fbm(x / 7.0, y / 7.0, 3, 3);
            let do_ = d_ocean[c];
            if do_ <= 2 && lat > 43.55 {
                terrain[c] = DUNES;
                continue;
            }
            if do_ <= 7 && lat > 43.6 && n1 > 0.22 {
                terrain[c] = FORET;
                continue;
            }
            if in_landes[c] != 0 {
                let n2 = fbm(x / 9.0, y / 9.0, 5, 3);
                if n2 > 0.60 {
                    t = FORET;
                } else if n2 < 0.33 {
                    t = MARAIS;
                } else {
                    t = LANDE;
                }
            }
            if d_estu[c] <= 1 {
                t = MARAIS;
            } else if d_estu[c] <= 6 && lon < -0.6 && lat > 44.95 && lat < 45.35 {
                t = if n1 > 0.3 { VIGNE } else { PLAINE };
            }
            if d_adour[c] <= 2 && lon < -0.55 && (t == PLAINE || t == LANDE) {
                t = if n1 > 0.35 { MARAIS } else { t };
            }
            if t == PLAINE || t == COLLINES {
                for &((fx, fy), r, dens) in &forests {
                    let dd = py::hypot(x - fx, y - fy);
                    if dd < r && fbm(x / 5.0, y / 5.0, 7, 3) < dens * (1.0 - 0.5 * dd / r) + 0.15 {
                        t = FORET;
                        break;
                    }
                }
            }
            if t == PLAINE || t == COLLINES {
                for &((vx, vy), r) in &vines {
                    if py::hypot(x - vx, y - vy) < r && fbm(x / 4.0, y / 4.0, 9, 3) > 0.42 {
                        t = VIGNE;
                        break;
                    }
                }
            }
            if (t == PLAINE || t == COLLINES) && fbm(x / 6.0, y / 6.0, 13, 3) > 0.70 {
                t = FORET;
            }
            terrain[c] = t;
        }

        // Les villes sont en plaine (vallées), jamais dans l'eau
        for n in self.nodes.iter() {
            let (ci, cj) = (py::int(n.at("x").f()), py::int(n.at("y").f()));
            for dj in [-1, 0, 1] {
                for di in [-1, 0, 1] {
                    let c = self.cell((ci + di) as f64, (cj + dj) as f64);
                    if c < 0 {
                        continue;
                    }
                    let c = c as usize;
                    if di == 0 && dj == 0 {
                        if matches!(terrain[c], OCEAN | EAU | MONTAGNE | HAUTE | MARAIS | DUNES) {
                            terrain[c] = PLAINE;
                        }
                        if dept[c] == 0 {
                            dept[c] = self.rang_dept(&n.at("dept")) as u8;
                        }
                    } else if terrain[c] == MONTAGNE || terrain[c] == HAUTE {
                        terrain[c] = COLLINES;
                    }
                }
            }
        }
        self.dept = dept;
        self.river = river;
        self.terrain = terrain;
        self._build_roads();
        self._build_cellnode();
    }

    /// (privé) `self.dept_codes.index(code) + 1` : la valeur d'un département dans la grille dept.
    fn rang_dept(&self, code: &Val) -> usize {
        self.dept_codes.iter().position(|c| code == c).unwrap_or_else(|| panic!("ValueError: {} is not in list", code.repr())) + 1
    }

    pub fn _elev(lat: f64, lon: f64) -> f64 {
        let mut e = 0.0;
        if lon > -1.0 {
            let base = 43.20 + 0.03 * (lon + 1.0) + 0.05 * (lon * 7.3).sin() + 0.03 * (lon * 19.0 + 1.0).sin();
            e += max2(0.0, base - lat) / 0.21;
        } else {
            let base = 43.36 + 0.04 * (lon * 9.0).sin();
            e += max2(0.0, base - lat) / 0.30;
            if lat < 43.45 {
                e += 0.18;
            }
        }
        // Périgord / Limousin
        e += 0.62 * min2(1.0, max2(0.0, (lat - 44.95) / 0.55)) * min2(1.0, max2(0.0, (lon - 0.35) / 0.8));
        // Sarladais / Quercy
        e += 0.5 * (-(py::pow((lat - 44.82) / 0.22, 2.0) + py::pow((lon - 1.18) / 0.30, 2.0))).exp();
        // Entre-deux-Mers
        e += 0.32 * (-(py::pow((lat - 44.72) / 0.12, 2.0) + py::pow((lon + 0.22) / 0.22, 2.0))).exp();
        // Coteaux du Gers / Agenais sud
        e += 0.40 * min2(1.0, max2(0.0, (44.12 - lat) / 0.35)) * min2(1.0, max2(0.0, (lon - 0.05) / 0.25));
        // Chalosse / Tursan
        e += 0.40 * (-(py::pow((lat - 43.64) / 0.10, 2.0) + py::pow((lon + 0.62) / 0.30, 2.0))).exp();
        // Haut-Agenais (nord du Lot)
        e += 0.34 * (-(py::pow((lat - 44.55) / 0.15, 2.0) + py::pow((lon - 0.85) / 0.25, 2.0))).exp();
        e
    }

    /// (géographie 5) Le relief de l'Europe et de l'Afrique du Nord : lignes de crête et massifs
    /// (CRETES_5, MASSIFS_5), en « hauteur » du jeu.
    pub fn _elev5(lat: f64, lon: f64) -> f64 {
        let cl = radians(lat).cos();
        let mut e = 0.0;
        for &(amp, w, pts) in CRETES_5.iter() {
            let d = py::min_f(pts.windows(2).map(|ab| _dseg(lat, lon * cl, ab[0].0, ab[0].1 * cl, ab[1].0, ab[1].1 * cl))).unwrap();
            e += amp * (-py::pow(d / w, 2.0)).exp() + amp * 0.3 * (-py::pow(d / (w * 2.2), 2.0)).exp();
        }
        for &(la, lo, amp, r) in MASSIFS_5.iter() {
            e += amp * (-((py::pow(lat - la, 2.0) + py::pow((lon - lo) * cl, 2.0)) / (r * r))).exp();
        }
        e
    }

    /// (géographie 5) Le terrain d'une case de 5 km : relief (_elev5), puis végétation par grandes régions, avec les seuls
    /// types de terrain du jeu : dunes pour le désert, lande pour la steppe, marais, forêts (taïga, forêts d'Europe
    /// centrale), vigne autour de la Méditerranée. (x, y) : le centre de la case ; d_ocean, d_riv : distance en cases à
    /// la mer (12 au plus) et à une rivière (5 au plus).
    pub fn _terrain5(x: f64, y: f64, lat: f64, lon: f64, d_ocean: u8, d_riv: u8) -> u8 {
        // (le relief se creuse de cols et se hérisse de sommets : un bruit le module)
        let mut e = GeoMap::_elev5(lat, lon) * (0.7 + 0.6 * fbm(x / 5.0, y / 5.0, 17, 2)) + (fbm(x / 7.0, y / 7.0, 11, 4) - 0.5) * 0.5;
        if e > 0.8 {
            e -= 0.6 * (-py::pow(d_riv as f64 / 1.2, 2.0)).exp(); // (les vallées des montagnes sont creusées par leurs rivières)
        }
        if e > 1.55 {
            return HAUTE;
        }
        if e > 0.80 {
            return MONTAGNE;
        }
        let t = if e > 0.42 { COLLINES } else { PLAINE };
        let n1 = fbm(x / 7.0, y / 7.0, 3, 3);
        let n2 = fbm(x / 9.0, y / 9.0, 7, 4); // (les forêts : par grandes taches)
        // (les limites des climats ondulent : un degré de bruit)
        let la = lat + (fbm(x / 9.0, y / 9.0, 5, 3) - 0.5) * 1.2;
        let lo = lon + (fbm(x / 9.0, y / 9.0, 6, 3) - 0.5) * 1.5;
        let dans = |v: f64, a: f64, b: f64| a <= v && v < b;
        let km = |la0: f64, lo0: f64| py::hypot((lat - la0) * KY, (lon - lo0) * 111.32 * radians(lat).cos()); // (distance à un point, en km)
        // le désert : Sahara au sud de l'Atlas, Libye hors du littoral, Égypte hors de la vallée et du delta du Nil,
        // Sinaï, Arabie et désert de Syrie ; une rivière y fait une oasis
        let delta_nil = dans(lat, 30.0, 31.6) && dans(lon, 30.0, 32.3) && (lon - 31.2).abs() < (lat - 29.9) * 0.9;
        let limite = if lo < -6.0 { 30.6 } else if lo < 0.0 { 30.6 + (lo + 6.0) / 6.0 * 3.0 } else if lo < 9.0 { 33.6 } else { 33.2 }; // (le pied sud de l'Atlas)
        let desert = if lo < 11.5 {
            la < limite && d_ocean > 6
        } else if lo < 25.0 {
            la < 32.2 && d_ocean > 6 && km(32.6, 21.6) > 150.0 // (Tripolitaine et Cyrénaïque : la côte reste verte)
        } else if lo < 34.3 {
            la < 31.4 && d_ocean > 2 && !delta_nil
        } else {
            (la < 31.0 && d_ocean > 8) || (lo > 37.0 && la < 35.4 && lat < 36.0) || (lo > 39.5 && la < 36.2 && lat < 36.4)
        };
        if desert && d_riv > 2 {
            return DUNES;
        }
        // les marais (lat, lon, rayon en km)
        if t == PLAINE {
            for &(la0, lo0, r) in MARAIS_5.iter() {
                let dd = km(la0, lo0);
                if dd < r && n1 > 0.34 + 0.25 * dd / r {
                    return MARAIS;
                }
            }
            if la > 60.0 && lo > 21.0 && n2 > 0.66 {
                return MARAIS; // (tourbières de Finlande et de Carélie)
            }
        }
        // la steppe (lande) : steppe pontique et caspienne, puszta de Hongrie, Meseta, plateau anatolien, hauts plateaux
        // du Maghreb, steppe de Syrie ; landes de Gascogne, de Lunebourg, du Jutland, des Highlands
        let steppe = (lo > 28.5 && dans(la, 44.4, 49.2 + (lo - 28.5) * 0.1) && e < 0.42)
            || (lo > 38.0 && dans(la, 43.6, 46.5) && e < 0.42)
            || (dans(la, 46.0, 48.0) && dans(lo, 19.3, 21.9) && e < 0.3)
            || (dans(la, 38.7, 41.9) && dans(lo, -6.2, -1.4))
            || (dans(la, 37.4, 40.1) && dans(lo, 30.8, 36.4) && d_ocean > 10)
            || (lo < 11.5 && la < 35.3 && lon < 10.0 && d_ocean > 8)
            || (lo > 36.6 && dans(la, 33.0, 37.0) && d_ocean > 10)
            || (dans(lo, 11.5, 34.3) && la < 32.2 && d_ocean > 2 && !delta_nil && d_riv > 2);
        if steppe && n1 > 0.32 {
            return LANDE;
        }
        for &(la0, lo0, r) in LANDES_5.iter() {
            if km(la0, lo0) < r && n1 > 0.38 {
                return LANDE;
            }
        }
        // les forêts : taïga du nord, forêts mêlées d'Europe centrale et de Russie, massifs boisés
        if !steppe && !desert {
            let taiga = la > 57.6 && lo > 4.0;
            let centrale = dans(la, 47.5, 57.6) && lo > 8.0;
            if taiga && n2 < 0.64 {
                return FORET;
            }
            if centrale && n2 < 0.36 + 0.10 * min2(1.0, max2(0.0, (lo - 10.0) / 20.0)) {
                return FORET;
            }
            if t == COLLINES && dans(la, 42.0, 57.0) && dans(lo, -9.0, 32.0) && n2 < 0.52 {
                return FORET;
            }
        }
        // la vigne : les rivages de la Méditerranée (pas le golfe de Gascogne, ni la mer Noire au nord), et les grands
        // vignobles de l'intérieur
        if !desert {
            let v = fbm(x / 4.0, y / 4.0, 9, 3);
            let med = d_ocean <= 10 && dans(la, 35.0, 45.3) && dans(lo, -9.6, 36.6) && !(la > 42.9 && lo < -1.0) && !(lo > 27.5 && la > 41.6) && !(la < 37.3 && lo > 11.5);
            if med && v > (if la < 37.3 { 0.62 } else { 0.50 }) {
                return VIGNE;
            }
            for &(la0, lo0, r) in VIGNES_5.iter() {
                if km(la0, lo0) < r && v > 0.46 {
                    return VIGNE;
                }
            }
        }
        if !steppe && !desert && fbm(x / 6.0, y / 6.0, 13, 3) > 0.70 {
            return FORET;
        }
        t
    }

    /// (un théâtre sans relief ni climats écrits à la main) Le terrain d'une case de 5 km : plaine, collines et forêts par
    /// taches, au gré du bruit.
    pub fn _terrain_theatre(x: f64, y: f64) -> u8 {
        if fbm(x / 6.0, y / 6.0, 13, 3) > 0.66 {
            return FORET;
        }
        if fbm(x / 12.0, y / 12.0, 19, 3) > 0.62 { COLLINES } else { PLAINE }
    }

    // ------------------------------------------------------------ routes
    /// (En Python : margin=1.2. Rend un entier ou un flottant : ici toujours un flottant, de même valeur.)
    pub fn _water_on_segment(&self, a: Pt, b: Pt, margin: f64) -> f64 {
        let ((x1, y1), (x2, y2)) = (a, b);
        let L = py::hypot(x2 - x1, y2 - y1);
        let n = py::int(L / 0.4).max(2);
        let mut bad = 0.0;
        for s in 0..=n {
            let t = s as f64 / n as f64;
            if t * L < margin || (1.0 - t) * L < margin {
                continue;
            }
            let c = self.cell(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
            if c < 0 || matches!(self.terrain[c as usize], OCEAN | EAU) || !self.jouable[self.dept[c as usize] as usize] {
                bad += 1.0;
            } else if self.terrain[c as usize] == HAUTE && self.theatre.is_none() {
                bad += 0.25; // (un théâtre : une case de haute montagne de 5 km a ses cols, la route y passe)
            }
        }
        bad
    }

    /// (un théâtre) La plus longue traversée d'eau (mer, lac) d'un tracé, en cases, hors de sa première et de sa dernière case
    /// (un port au bord de l'eau) ; échantillons tous les 0,2 case, comme tests/mesure-villes-chemins.mjs.
    pub fn eau_du_trace(&self, pts: &[Pt]) -> f64 {
        let total: f64 = pts.windows(2).map(|q| dist(q[0], q[1])).sum();
        let (mut d, mut run, mut pire) = (0.0, 0.0, 0.0f64);
        for q in pts.windows(2) {
            let l = dist(q[0], q[1]);
            let n = (l / 0.2).ceil().max(1.0);
            for s in 0..n as usize {
                let t = s as f64 / n;
                let c = self.cell(q[0].0 + (q[1].0 - q[0].0) * t, q[0].1 + (q[1].1 - q[0].1) * t);
                if d >= 1.0 && total - d >= 1.0 && c >= 0 && matches!(self.terrain[c as usize], OCEAN | EAU) {
                    run += l / n;
                } else {
                    pire = pire.max(run);
                    run = 0.0;
                }
                d += l / n;
            }
        }
        pire.max(run)
    }

    fn _build_roads(&mut self) {
        let P = self.noeuds_xy();
        let mut pairs: Pairs = IndexMap::new();
        let n = P.len();
        // le graphe de Gabriel des places à moins de 40 km : par cases de 20 km (toute la France : 2 000 places et plus)
        const G: f64 = 20.0;
        let case = |v: f64| py::int(py::floordiv_f(v, G));
        let mut cases: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, &(x, y)) in P.iter().enumerate() {
            cases.entry((case(x), case(y))).or_default().push(i);
        }
        let proches = |x: f64, y: f64, r: f64| -> Vec<usize> {
            let mut out = vec![];
            for ci in case(x - r)..=case(x + r) {
                for cj in case(y - r)..=case(y + r) {
                    if let Some(l) = cases.get(&(ci, cj)) {
                        out.extend_from_slice(l);
                    }
                }
            }
            out
        };
        let theatre = self.theatre.is_some();
        // (les bacs nommés des détroits : l'Europe seulement)
        let bacs: &[(&str, &str, &str)] = if self.version == VERSION_EUROPE { &BACS_5 } else { &[] };
        let portee = if theatre { GABRIEL_5 } else { 40.0 };
        let terres: Vec<u32> = if theatre { self._terres(&P) } else { vec![] };
        for a in 0..n {
            for b in proches(P[a].0, P[a].1, portee) {
                if b <= a {
                    continue;
                }
                let d = dist(P[a], P[b]);
                if d > portee {
                    continue;
                }
                let (mx, my) = ((P[a].0 + P[b].0) / 2.0, (P[a].1 + P[b].1) / 2.0);
                let r2 = py::pow(d / 2.0, 2.0);
                if proches(mx, my, d / 2.0).into_iter().any(|c| c != a && c != b && py::pow(P[c].0 - mx, 2.0) + py::pow(P[c].1 - my, 2.0) < r2) {
                    continue;
                }
                // (un théâtre : un seul point d'eau sur le trajet, le fond d'une baie, n'empêche pas la route ; entre deux
                // terres, un détroit d'une case, Sund, Messine, Bosphore : un bac)
                if self._water_on_segment(P[a], P[b], 1.2) < (if theatre { 2.0 } else { 1.0 }) {
                    pairs.insert((a, b), Info { royal: false, ferry: theatre && terres[a] != terres[b], drop: false });
                }
            }
        }
        if theatre {
            // (un théâtre) les routes de poste : de chaque capitale à ses plus grandes villes, par le plus court chemin
            // du réseau (une île que la terre ne relie pas n'en a pas : voies de mer, waterways.rs)
            for (_, na, nb) in bacs {
                let (a, b) = (self.by_name.at(*na).u(), self.by_name.at(*nb).u());
                pairs.insert((a.min(b), a.max(b)), Info { royal: false, ferry: true, drop: false });
            }
            self._ensure_connected(&mut pairs, &P);
            for code in &self.dept_codes {
                let du_pays: Vec<Val> = self.nodes.iter().filter(|n| n.at("dept") == code.as_str()).collect();
                let Some(cap) = du_pays.iter().find(|n| n.at_is("type", "capitale")).map(|n| n.at("id").u()) else { continue };
                let villes = py::sorted_by_key(du_pays.iter().filter(|n| n.at_is("type", "ville")).collect::<Vec<_>>(), |n| (-n.at("pop0").i(), n.at("id").i()));
                for v in villes.into_iter().take(ROYALES_5) {
                    for k in GeoMap::_chemin(&pairs, &P, cap, v.at("id").u()) {
                        pairs[&k].royal = true;
                    }
                }
            }
        }
        // (un théâtre : aucune des tables du Sud-Ouest, routes royales, chemins ajoutés ou retirés, bac de Blaye)
        let sud_ouest = |t: Val| if theatre { list![] } else { t };
        for route in sud_ouest(ROYAL_ROUTES()).iter() {
            let ids: Vec<usize> = route.iter().map(|nm| self.by_name.at(&nm).u()).collect();
            for ab in ids.windows(2) {
                let (a, b) = (ab[0], ab[1]);
                let k = (a.min(b), a.max(b));
                if let Some(info) = pairs.get_mut(&k) {
                    info.royal = true;
                }
                // (géographie 2 : une route royale passe une case de côte, Bayonne – Saint-Jean-de-Luz)
                else if self._water_on_segment(P[a], P[b], 1.2) < (if self.version >= 2 { 2.0 } else { 1.0 }) {
                    pairs.insert(k, Info { royal: true, ferry: false, drop: false });
                }
            }
        }
        let mut extra = sud_ouest(EXTRA_ROADS()).vec();
        if self.version >= 2 {
            extra.extend(sud_ouest(EXTRA_ROADS_2()).vec());
        }
        for route in extra {
            let (na, nb) = route.pair();
            let (a, b) = (self.by_name.at(&na).u(), self.by_name.at(&nb).u());
            let k = (a.min(b), a.max(b));
            let fer = FERRIES().has(tup![&na, &nb]) || FERRIES().has(tup![&nb, &na]);
            if fer || self._water_on_segment(P[a], P[b], 1.2) < 1.0 {
                pairs.entry(k).or_insert(Info { royal: false, ferry: fer, drop: false }).ferry = fer;
            }
        }
        if self.version >= 2 {
            for route in sud_ouest(NO_ROADS_2()).iter() {
                let (na, nb) = route.pair();
                let (a, b) = (self.by_name.at(&na).u(), self.by_name.at(&nb).u());
                pairs.shift_remove(&(a.min(b), a.max(b)));
            }
        }
        // élague les chemins redondants (un détour par une autre ville est presque aussi court)
        let mut nb: Vec<HashSet<usize>> = vec![HashSet::new(); n];
        for &(a, b) in pairs.keys() {
            nb[a].insert(b);
            nb[b].insert(a);
        }
        for (a, b) in py::sorted_by_key(pairs.keys().copied().collect::<Vec<_>>(), |k| -dist(P[k.0], P[k.1])) {
            let info = pairs[&(a, b)];
            if info.royal || info.ferry {
                continue;
            }
            let d = dist(P[a], P[b]);
            // (le Python parcourt le set nb[a] & nb[b] et s'arrête au premier détour assez court : quel que soit l'ordre,
            // la route tombe si un tel détour existe, et rien d'autre ne dépend du lieu trouvé)
            if nb[a].iter().any(|c| nb[b].contains(c) && dist(P[a], P[*c]) + dist(P[*c], P[b]) < 1.13 * d) {
                nb[a].remove(&b);
                nb[b].remove(&a);
                pairs[&(a, b)].drop = true;
            }
        }
        pairs.retain(|_, v| !v.drop);
        // connexité
        self._ensure_connected(&mut pairs, &P);

        // (nom, rang, morceaux de 48 segments avec leur emprise : on ne cherche l'eau que là où passe la route)
        struct Riviere {
            name: String,
            rank: i64,
            parts: Vec<(Vec<Pt>, f64, f64, f64, f64)>,
        }
        let mut rivers: Vec<Riviere> = vec![];
        for r in self.src.at("rivers").iter() {
            if r.at("rank").i() <= 2 {
                let pts = self.pts_lonlat(&r.at("pts"));
                let mut parts = vec![];
                let mut k = 0;
                while k + 1 < pts.len() {
                    let q = pts[k..(k + 49).min(pts.len())].to_vec();
                    let (x0, y0) = (py::min_f(q.iter().map(|p| p.0)).unwrap(), py::min_f(q.iter().map(|p| p.1)).unwrap());
                    let (x1, y1) = (py::max_f(q.iter().map(|p| p.0)).unwrap(), py::max_f(q.iter().map(|p| p.1)).unwrap());
                    parts.push((q, x0, y0, x1, y1));
                    k += 48;
                }
                rivers.push(Riviere { name: r.at("name").string(), rank: r.at("rank").i(), parts });
            }
        }

        // où le segment p1-p2 coupe les rivières : (rivière, point), rivière par rivière
        let coupes = |p1: Pt, p2: Pt| -> Vec<(usize, Pt)> {
            let (x0, y0, x1, y1) = (min2(p1.0, p2.0), min2(p1.1, p2.1), max2(p1.0, p2.0), max2(p1.1, p2.1));
            let mut out = vec![];
            for (ri, riv) in rivers.iter().enumerate() {
                for (pts, a, b, c, d) in &riv.parts {
                    if *a <= x1 && *c >= x0 && *b <= y1 && *d >= y0 {
                        for pq in pts.windows(2) {
                            if let Some((_, it)) = _seg_inter(p1, p2, pq[0], pq[1]) {
                                out.push((ri, it));
                            }
                        }
                    }
                }
            }
            out
        };

        // (pair : les noms des rivières à ne pas compter ; rend (rivière, point))
        let crossing = |path: &[Pt], pair: &dyn Fn(&str) -> bool| -> Option<(usize, Pt)> {
            let mut best: Option<(usize, Pt)> = None;
            for seg in path.windows(2) {
                for (ri, it) in coupes(seg[0], seg[1]) {
                    if best.is_none_or(|b| rivers[ri].rank < rivers[b.0].rank) && !pair(&rivers[ri].name) {
                        best = Some((ri, it));
                    }
                }
            }
            best
        };

        // (géographie 2) les rivières que la ligne coupe un nombre pair de fois : leurs méandres, sans passage
        let pair = |path: &[Pt]| -> HashSet<&str> {
            let mut n: HashMap<&str, i64> = rivers.iter().map(|r| (r.name.as_str(), 0)).collect();
            for seg in path.windows(2) {
                for (ri, _) in coupes(seg[0], seg[1]) {
                    *n.get_mut(rivers[ri].name.as_str()).unwrap() += 1;
                }
            }
            n.into_iter().filter(|(_, v)| v % 2 == 0).map(|(k, _)| k).collect()
        };

        let mut edges: Vec<Val> = vec![];
        let mut road = vec![0u8; (self.W * self.H) as usize];
        let cost_chemin = self._road_costs(0.4);
        let cost_royal = self._road_costs(0.0); // routes royales : tirées au cordeau
        let mut paires: Vec<((usize, usize), Info)> = pairs.iter().map(|(k, v)| (*k, *v)).collect();
        paires.sort_by_key(|p| p.0);
        let cout_de = |info: Info| if info.royal { &cost_royal } else { &cost_chemin };
        let mut paths: Vec<Vec<Pt>> = paires.iter().map(|&((a, b), info)| if info.ferry { vec![P[a], P[b]] } else { self._road_path(P[a], P[b], cout_de(info), 0.35) }).collect();
        if theatre {
            // (un théâtre) une route qui passe encore sur l'eau : refaite dans une fenêtre plus large (le tour de la baie en
            // sortait) ; si l'eau reste, c'est une traversée (un îlot que _terres rattache à la terre voisine, Gozo) : un bac
            for k in 0..paires.len() {
                let ((a, b), info) = paires[k];
                if info.ferry || self.eau_du_trace(&paths[k]) <= EAU_MAX_5 {
                    continue;
                }
                paths[k] = self._road_path(P[a], P[b], cout_de(info), 1.5);
                if self.eau_du_trace(&paths[k]) > EAU_MAX_5 {
                    paires[k].1.ferry = true;
                    paths[k] = vec![P[a], P[b]];
                }
            }
            _fusionne(&paires, &mut paths, FUSION_5.0, FUSION_5.1);
        } else if self.version >= 2 {
            _troncs(&paires, &mut paths, 0.35, 0.5);
        }
        let aucune = |_: &str| false;
        for (eid, &((a, b), info)) in paires.iter().enumerate() {
            let d = dist(P[a], P[b]);
            let e = dict! {"id" => eid, "a" => a, "b" => b, "len" => py::round_n(d * 1.12, 2), "royal" => info.royal, "ferry" => info.ferry,
            "river" => Val::None, "rrank" => 0, "cx" => Val::None, "cy" => Val::None};
            // le jeu (rivière à franchir, longueur) reste celui de la ligne droite ; seul le tracé dessiné change
            let droite = [P[a], P[b]];
            let path = &paths[eid];
            let best = if self.version >= 2 {
                let p = pair(&droite);
                crossing(&droite, &|nom| p.contains(nom))
            } else {
                crossing(&droite, &aucune)
            };
            // (un théâtre : la ligne droite ne franchit rien, ou une rivière un nombre pair de fois, mais le tracé passe un
            // fleuve, Le Havre – Honfleur et la Seine, Hanovre – Brême et la Weser : c'est ce passage qui compte, avec son pont)
            let best = best.or_else(|| if theatre && !info.ferry { crossing(path, &aucune) } else { None });
            if info.ferry {
                let (na, nb) = (self.nodes.at(a).ats("name"), self.nodes.at(b).ats("name"));
                let nomme = bacs.iter().find(|t| [t.1, t.2] == [na.as_str(), nb.as_str()] || [t.2, t.1] == [na.as_str(), nb.as_str()]);
                e.set("river", if theatre { nomme.map_or("Détroit", |t| t.0) } else { "Gironde" });
                e.set("rrank", 1);
                e.set("cx", py::round_n((P[a].0 + P[b].0) / 2.0, 2));
                e.set("cy", py::round_n((P[a].1 + P[b].1) / 2.0, 2));
            } else if let Some((ri, it)) = best {
                e.set("river", &rivers[ri].name);
                e.set("rrank", rivers[ri].rank);
                e.set("cx", py::round_n(it.0, 2));
                e.set("cy", py::round_n(it.1, 2));
            }
            // le pont dessiné, là où le tracé franchit l'eau (cx, cy : le passage pour les règles)
            if info.ferry {
                e.set("bx", e.at("cx"));
                e.set("by", e.at("cy"));
            } else if let Some((bri, _)) = best {
                // (géographie 2 : le pont dessiné est celui de la rivière de la règle, s'il est sur le tracé)
                let on = (if self.version >= 2 { crossing(path, &|nom| nom != rivers[bri].name) } else { crossing(path, &aucune) }).or_else(|| crossing(path, &aucune));
                if let Some((ori, oit)) = on {
                    e.set("bx", py::round_n(oit.0, 2));
                    e.set("by", py::round_n(oit.1, 2));
                    // (les autres grandes rivières que le tracé passe, une fois chacune : leurs ponts ou leurs bacs ; la règle du
                    // passage reste celle de la ligne droite)
                    let ponts = list![];
                    e.set("ponts", &ponts);
                    for seg in path.windows(2) {
                        for (ri, it) in coupes(seg[0], seg[1]) {
                            let name = rivers[ri].name.as_str();
                            // (un théâtre : chaque passage a son pont, même d'une rivière déjà passée à plus d'une case et demie)
                            let pres = |x: f64, y: f64| !theatre || py::hypot(x - it.0, y - it.1) < 1.5;
                            if !(name == rivers[ori].name && pres(oit.0, oit.1)) && !ponts.iter().any(|q| q.at(2) == name && pres(q.at(0).f(), q.at(1).f())) {
                                ponts.push(list![py::round_n(it.0, 2), py::round_n(it.1, 2), name, rivers[ri].rank]);
                            }
                        }
                    }
                }
            }
            e.set("pts", path.iter().map(|&p| l2(p)).collect::<Val>());
            edges.push(e);

            raster_line(self.W, self.H, path, &mut |c| road[c] = 1, 0.3, 1);
        }
        self.road = road;
        self.edges = Val::list(edges);
    }

    /// Les arêtes (clés de pairs) du plus court chemin de a à b dans le réseau des routes.
    pub fn _chemin(pairs: &Pairs, P: &[Pt], a: usize, b: usize) -> Vec<(usize, usize)> {
        let mut nb: Vec<Vec<usize>> = vec![vec![]; P.len()];
        for &(u, v) in pairs.keys() {
            nb[u].push(v);
            nb[v].push(u);
        }
        // (dist.get(v, 1e18) et prev : des tableaux au lieu des dict, mêmes valeurs)
        let mut dist_ = vec![1e18; P.len()];
        let mut prev: Vec<Option<usize>> = vec![None; P.len()];
        dist_[a] = 0.0;
        let mut pq = vec![(0.0, a)];
        while let Some((d, u)) = heapq::heappop(&mut pq) {
            if u == b {
                break;
            }
            if d > dist_[u] {
                continue;
            }
            for &v in &nb[u] {
                let nd = d + dist(P[u], P[v]);
                if nd < dist_[v] {
                    dist_[v] = nd;
                    prev[v] = Some(u);
                    heapq::heappush(&mut pq, (nd, v));
                }
            }
        }
        let (mut out, mut u) = (vec![], b);
        while let Some(p) = prev[u] {
            out.push((u.min(p), u.max(p)));
            u = p;
        }
        out
    }

    /// La grille des tracés de routes : f cases par km et les rivières qui y passent. Géographie 2 : à la demi-case, pour
    /// que les routes passent entre les méandres serrés (Libourne) au lieu de les contourner.
    /// (Rend f ; la grille des rivières se lit ensuite par `riv_route`.)
    fn _route_f(&mut self) -> i64 {
        let f = if self.version >= 2 { 2 } else { 1 };
        if f == 1 {
            return f;
        }
        if self._rivf.is_none() {
            let mut riv = vec![0u8; (self.W * self.H * f * f) as usize];
            for r in self.src.at("rivers").iter() {
                let v = niveau(&r.at("rank"));
                raster_line(
                    self.W,
                    self.H,
                    &self.pts_lonlat(&r.at("pts")),
                    &mut |c| {
                        if riv[c] < v {
                            riv[c] = v
                        }
                    },
                    0.35 / f as f64,
                    f,
                );
            }
            self._rivf = Some(riv);
        }
        f
    }

    /// (privé) Le second résultat de _route_f : (f, la grille des rivières des tracés), une fois _route_f appelée.
    fn riv_route(&self) -> (i64, &[u8]) {
        if self.version >= 2 {
            (2, self._rivf.as_deref().expect("_route_f d'abord"))
        } else {
            (1, &self.river)
        }
    }

    /// Coût d'une cellule pour tracer une route : le relief, l'eau à éviter (on ne la franchit qu'une fois, sur un
    /// pont), les berges, et un bruit doux pour que les routes ondulent au lieu d'aller à la règle.
    fn _road_costs(&mut self, wobble: f64) -> Vec<f64> {
        self._route_f();
        let (f, riv) = self.riv_route();
        let (W0, H0) = (self.W as usize, self.H as usize);
        let fu = f as usize;
        let (W, N) = (W0 * fu, W0 * H0 * fu * fu);
        let near = bfs(self.W, self.H, &(0..N).filter(|&c| riv[c] >= 2).collect::<Vec<_>>(), 2, None, f);
        let terr = |t: u8| match t {
            PLAINE | VIGNE => 1.0,
            LANDE => 1.1,
            FORET => 1.3,
            COLLINES => 1.5,
            DUNES => 2.0,
            MARAIS => 2.5,
            MONTAGNE => 2.4,
            HAUTE => 4.0,
            _ => 40.0,
        };
        let bruit: Option<Vec<f64>> = (wobble != 0.0).then(|| (0..W0 * H0).map(|c| vnoise((c % W0) as f64 / 7.0, (c / W0) as f64 / 7.0, 91)).collect()); // (au km)
        let mut cost = vec![0.0; N];
        for c in 0..N {
            let (i, j) = (c % W, c / W);
            let c1 = j / fu * W0 + i / fu; // (la case du km : terrain, département, bruit)
            let t = self.terrain[c1];
            // (un théâtre : l'eau presque interdite ; à 40, une route de 5 km la case coupait une baie plutôt que d'en faire le tour)
            let mut k = if self.theatre.is_some() && matches!(t, OCEAN | EAU) {
                EAU_ROUTE_5
            } else if self.jouable[self.dept[c1] as usize] {
                terr(t)
            } else {
                40.0
            };
            k += if riv[c] != 0 {
                [25.0, 10.0, 3.0][3 - riv[c] as usize]
            } else if near[c] <= 2 {
                // ((1.5, 0.4, 0.0)[near[c] - 1] : pour 0, l'indice −1 du Python est le dernier)
                match near[c] {
                    1 => 1.5,
                    2 => 0.4,
                    _ => 0.0,
                }
            } else {
                0.0
            };
            cost[c] = match &bruit {
                Some(bruit) => k * (1.0 - wobble / 2.0 + wobble * bruit[c1]),
                None => k,
            };
        }
        cost
    }

    /// Tracé d'une route de A à B : A* sur la grille (coûts de _road_costs), puis simplifié et lissé. marge : la fenêtre de
    /// recherche déborde de la boîte de A et B de marge fois leur distance (0,35 ; un théâtre en reprend une plus grande).
    fn _road_path(&self, A: Pt, B: Pt, cost: &[f64], marge: f64) -> Vec<Pt> {
        let (fr, riv) = self.riv_route();
        let frf = fr as f64;
        let (W, H) = (self.W * fr, self.H * fr);
        let (si, sj, gi, gj) = (py::int(A.0 * frf), py::int(A.1 * frf), py::int(B.0 * frf), py::int(B.1 * frf));
        let m = py::int(marge * dist(A, B)).max(6) * fr;
        let (i0, i1) = ((si.min(gi) - m).max(0), (si.max(gi) + m).min(W - 1));
        let (j0, j1) = ((sj.min(gj) - m).max(0), (sj.max(gj) + m).min(H - 1));
        let (start, goal) = (sj * W + si, gj * W + gi);
        // (g et prev : des dict en Python ; ici des tableaux sur la fenêtre de recherche, mêmes valeurs)
        assert!(i0 <= si && si <= i1 && j0 <= sj && sj <= j1 && i0 <= gi && gi <= i1 && j0 <= gj && gj <= j1, "_road_path : un lieu est hors de la carte");
        let lw = i1 - i0 + 1;
        let ici = |i: i64, j: i64| ((j - j0) * lw + (i - i0)) as usize;
        let mut g = vec![1e18; (lw * (j1 - j0 + 1)) as usize];
        let mut prev: Vec<i64> = vec![-1; g.len()];
        // (un théâtre : à moins d'une case de ses bouts, la route garde l'ancien coût de l'eau, un port au bord de l'eau)
        let theatre = self.theatre.is_some();
        let cout = |n: i64| -> f64 {
            let k = cost[n as usize];
            if theatre && k > EAU_ROUTE_5 / 2.0 {
                let (i, j) = (n % W, n / W);
                if py::hypot((i - si) as f64, (j - sj) as f64) <= frf || py::hypot((i - gi) as f64, (j - gj) as f64) <= frf {
                    return 40.0;
                }
            }
            k
        };
        g[ici(si, sj)] = 0.0;
        let mut pq = vec![(0.0, start)];
        while let Some((_f, c)) = heapq::heappop(&mut pq) {
            if c == goal {
                break;
            }
            let (i, j) = (c % W, c / W);
            let gc = g[ici(i, j)];
            for &(di, dj, s) in &[(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)] {
                let (ni, nj) = (i + di, j + dj);
                if !(i0 <= ni && ni <= i1 && j0 <= nj && nj <= j1) {
                    continue;
                }
                let n = nj * W + ni;
                let mut k = if n != goal { cout(n) } else { 1.0 };
                if di != 0 && dj != 0 {
                    // en diagonale, on ne se glisse pas entre deux cases d'un fleuve
                    k = max2(max2(k, cout(j * W + ni)), cout(nj * W + i));
                }
                let ng = gc + s * k;
                if ng < g[ici(ni, nj)] {
                    g[ici(ni, nj)] = ng;
                    prev[ici(ni, nj)] = c;
                    heapq::heappush(&mut pq, (ng + 0.85 * py::hypot((gi - ni) as f64, (gj - nj) as f64), n));
                }
            }
        }
        if prev[ici(gi, gj)] < 0 && goal != start {
            return vec![A, B];
        }
        let mut cells = vec![goal];
        while *cells.last().unwrap() != start {
            let c = *cells.last().unwrap();
            cells.push(prev[ici(c % W, c / W)]);
        }
        cells.reverse();
        let mut pts = vec![A];
        if cells.len() > 2 {
            pts.extend(cells[1..cells.len() - 1].iter().map(|&c| (((c % W) as f64 + 0.5) / frf, ((c / W) as f64 + 0.5) / frf)));
        }
        pts.push(B);

        // (hors de la grille : −1, et cost[−1] est la dernière case en Python)
        let cel = |x: f64, y: f64| -> usize {
            let (i, j) = (py::int(x * frf), py::int(y * frf));
            if 0 <= i && i < W && 0 <= j && j < H {
                (j * W + i) as usize
            } else {
                cost.len() - 1
            }
        };

        // coût d'un segment droit, échantillonné tous les 0,25 km
        let along = |p: Pt, q: Pt| -> f64 {
            let n = py::int(dist(p, q) / 0.25).max(1);
            let nf = n as f64;
            py::sum((0..n).map(|s| cost[cel(p.0 + (q.0 - p.0) * (s as f64 + 0.5) / nf, p.1 + (q.1 - p.1) * (s as f64 + 0.5) / nf)])) * dist(p, q) / nf
        };
        let seg: Vec<f64> = pts.windows(2).map(|pq| along(pq[0], pq[1])).collect();
        // corde tendue : du point i, on va en ligne droite au point le plus loin qui ne coûte guère plus que le
        // chemin de la grille ; les routes perdent ainsi les angles à 45° et 90° de la grille
        let (mut out, mut i) = (vec![pts[0]], 0);
        while i < pts.len() - 1 {
            let (mut k, mut run) = (i + 1, seg[i]);
            for j in i + 2..pts.len() {
                run += seg[j - 1];
                if along(pts[i], pts[j]) <= 1.01 * run + 0.1 {
                    k = j;
                }
            }
            out.push(pts[k]);
            i = k;
        }
        let pts = out;

        // échantillons sur un fleuve (un théâtre : ou sur l'eau, ses coins arrondis coupaient les baies) : le lissage ne
        // doit pas en ajouter
        let mouille = |c: usize| theatre && matches!(self.terrain[((c as i64 / W) / fr * self.W + (c as i64 % W) / fr) as usize], OCEAN | EAU);
        let wet = |line: &[Pt]| -> i64 {
            let mut n = 0;
            raster_line(self.W, self.H, line, &mut |c| n += (riv[c] >= 2 || mouille(c)) as i64, 0.3 / frf, fr);
            n
        };
        let mut smooth = pts.clone();
        for _ in 0..3 {
            // Chaikin : coins arrondis, extrémités fixes
            let mut neuf = vec![smooth[0]];
            let coins: Vec<Pt> = smooth.windows(2).flat_map(|pr| {
                let (p, r) = (pr[0], pr[1]);
                [(0.75 * p.0 + 0.25 * r.0, 0.75 * p.1 + 0.25 * r.1), (0.25 * p.0 + 0.75 * r.0, 0.25 * p.1 + 0.75 * r.1)]
            }).collect();
            if coins.len() > 2 {
                neuf.extend_from_slice(&coins[1..coins.len() - 1]);
            }
            neuf.push(*smooth.last().unwrap());
            smooth = neuf;
        }
        if wet(&smooth) <= wet(&pts) {
            smooth
        } else {
            pts
        }
    }

    /// (géographie 5) La terre de chaque place : les cases sèches du jeu numérotées par remplissage (0 : dans l'eau).
    fn _terres(&self, P: &[Pt]) -> Vec<u32> {
        let (W, H) = (self.W as usize, self.H as usize);
        let sec = |c: usize| !matches!(self.terrain[c], OCEAN | EAU) && self.jouable[self.dept[c] as usize];
        let mut lab = vec![0u32; W * H];
        let mut suivant = 0;
        let mut taille: Vec<usize> = vec![0]; // (cases de chaque terre)
        for c0 in 0..W * H {
            if lab[c0] != 0 || !sec(c0) {
                continue;
            }
            suivant += 1;
            lab[c0] = suivant;
            taille.push(0);
            let mut pile = vec![c0];
            while let Some(c) = pile.pop() {
                taille[suivant as usize] += 1;
                let (i, j) = (c % W, c / W);
                for nc in [(i + 1 < W).then(|| c + 1), (i > 0).then(|| c - 1), (j + 1 < H).then(|| c + W), (j > 0).then(|| c - W)].into_iter().flatten() {
                    if lab[nc] == 0 && sec(nc) {
                        lab[nc] = suivant;
                        pile.push(nc);
                    }
                }
            }
        }
        // une place sur un îlot de moins de six cases (une ville dans sa lagune, sur une flèche de sable, à un détroit que
        // la grille a ouvert sous elle) tient à la plus grande terre à deux cases d'elle
        P.iter()
            .map(|&(x, y)| {
                let c = self.cell(x, y);
                if c < 0 {
                    return 0;
                }
                let mut l = lab[c as usize];
                if taille[l as usize] < 6 {
                    let (i, j) = (c % self.W, c / self.W);
                    for dj in -2..=2 {
                        for di in -2..=2 {
                            let v = self.cell((i + di) as f64, (j + dj) as f64);
                            if v >= 0 && taille[lab[v as usize] as usize] >= 6 && taille[lab[v as usize] as usize] > taille[l as usize] {
                                l = lab[v as usize];
                            }
                        }
                    }
                }
                l
            })
            .collect()
    }

    fn _ensure_connected(&self, pairs: &mut Pairs, P: &[Pt]) {
        if self.theatre.is_some() {
            return self._relier(pairs, P);
        }
        let n = P.len();
        loop {
            let mut parent: Vec<usize> = (0..n).collect();
            for &(a, b) in pairs.keys() {
                let rb = find(&mut parent, b);
                let ra = find(&mut parent, a);
                parent[ra] = rb;
            }
            let roots: HashSet<usize> = (0..n).map(|i| find(&mut parent, i)).collect();
            if roots.len() == 1 {
                return;
            }
            let mut best: Option<(f64, usize, usize)> = None;
            for a in 0..n {
                for b in 0..n {
                    if find(&mut parent, a) != find(&mut parent, b) {
                        let d = dist(P[a], P[b]);
                        if best.is_none_or(|m| d < m.0) && self._water_on_segment(P[a], P[b], 1.2) < 1.0 {
                            best = Some((d, a, b));
                        }
                    }
                }
            }
            let Some((_, a, b)) = best else { return };
            pairs.insert((a.min(b), a.max(b)), Info::default());
        }
    }

    /// (un théâtre) Relie les morceaux du réseau : le plus petit d'abord, à la place la plus proche d'un autre morceau (à moins de
    /// RELIER_5 cases, sur la même terre) ; une île que rien ne relie reste à part (voies de mer : waterways.rs).
    fn _relier(&self, pairs: &mut Pairs, P: &[Pt]) {
        let n = P.len();
        const G: f64 = 20.0;
        let case = |v: f64| py::int(py::floordiv_f(v, G));
        let mut cases: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, &(x, y)) in P.iter().enumerate() {
            cases.entry((case(x), case(y))).or_default().push(i);
        }
        let portee = RELIER_5;
        // deux places se raccordent si elles sont sur la même terre, même si la ligne droite passe sur une baie ou un fjord
        // (le tracé de la route fait le tour) : la terre de chaque place, numérotée par remplissage
        let terre: Vec<u32> = self._terres(P);
        let mut isoles: HashSet<usize> = HashSet::new();
        loop {
            let mut parent: Vec<usize> = (0..n).collect();
            for &(a, b) in pairs.keys() {
                let rb = find(&mut parent, b);
                let ra = find(&mut parent, a);
                parent[ra] = rb;
            }
            let mut comps: IndexMap<usize, Vec<usize>> = IndexMap::new();
            for i in 0..n {
                comps.entry(find(&mut parent, i)).or_default().push(i);
            }
            if comps.len() == 1 {
                return;
            }
            let mut relie = false;
            let plus_grand = comps.values().map(Vec::len).max().unwrap();
            for (r, membres) in py::sorted_by_key(comps.iter().collect::<Vec<_>>(), |kv| kv.1.len()) {
                let r = *r;
                if isoles.contains(&r) || membres.len() == plus_grand && comps.len() as i64 - isoles.len() as i64 <= 1 {
                    continue;
                }
                let mut cand: Vec<(f64, usize, usize)> = vec![];
                for &a in membres {
                    let (x, y) = P[a];
                    for ci in case(x - portee)..=case(x + portee) {
                        for cj in case(y - portee)..=case(y + portee) {
                            if let Some(l) = cases.get(&(ci, cj)) {
                                for &b in l {
                                    if find(&mut parent, b) != r {
                                        let d = dist(P[a], P[b]);
                                        if d < portee {
                                            cand.push((d, a, b));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                cand.sort_by(|x, y| x.partial_cmp(y).unwrap());
                // (la route fait le tour de la baie, mais le jeu compte la ligne droite : entre deux places de la même terre,
                // celle qui passe le moins sur l'eau, chaque case d'eau comptant triple ; pas de Revel – Helsingfors à
                // travers le golfe de Finlande quand la Carélie relie la Finlande par la terre)
                // shortcut: seuls les 200 plus proches candidats sont pesés (le calcul de l'eau est long) ; à élargir si une
                // terre lointaine reste mal raccordée
                let cout = |&&(d, a, b): &&(f64, usize, usize)| d + 1.2 * self._water_on_segment(P[a], P[b], 1.2);
                let ok = cand.iter().filter(|&&(_, a, b)| terre[a] != 0 && terre[a] == terre[b]).take(200).min_by(|x, y| cout(x).partial_cmp(&cout(y)).unwrap());
                if let Some(&(_, a, b)) = ok {
                    pairs.insert((a.min(b), a.max(b)), Info::default());
                    relie = true;
                    break;
                }
                isoles.insert(r);
            }
            if !relie {
                return;
            }
        }
    }

    /// Zone d'influence de chaque lieu : distance par la terre (l'eau sépare), dans son département.
    fn _build_cellnode(&mut self) {
        let (W, H) = (self.W, self.H);
        let Wu = W as usize;
        let N = (W * H) as usize;
        let mut cn = vec![NONE as u16; N];
        let mut dist = vec![1e18; N];
        let mut pq: Vec<(f64, usize)> = vec![];
        for n in self.nodes.iter() {
            let c = self.cell(n.at("x").f(), n.at("y").f());
            if c < 0 {
                continue;
            }
            let c = c as usize;
            let d0 = match n.at("type").s() {
                "capitale" => -6.0,
                "ville" => -3.0,
                "village" => 0.0,
                "fort" => 1.0,
                t => panic!("KeyError: {t:?}"),
            };
            if d0 < dist[c] {
                dist[c] = d0;
                cn[c] = u16::try_from(n.at("id").i()).expect("OverflowError: unsigned short is greater than maximum");
                heapq::heappush(&mut pq, (d0, c));
            }
        }
        let jit: Vec<f64> = (0..N).map(|c| 0.55 * fbm((c % Wu) as f64 / 5.0, (c / Wu) as f64 / 5.0, 23, 3)).collect();
        while let Some((d, c)) = heapq::heappop(&mut pq) {
            if d > dist[c] {
                continue;
            }
            let dep = self.dept[c];
            let (i, j) = ((c % Wu) as i64, (c / Wu) as i64);
            for &(di, dj, m) in &NBRS {
                let (ni, nj) = (i + di, j + dj);
                if !(0 <= ni && ni < W && 0 <= nj && nj < H) {
                    continue;
                }
                let nc = (nj * W + ni) as usize;
                if self.dept[nc] != dep || matches!(self.terrain[nc], OCEAN | EAU) {
                    continue;
                }
                let nd = d + m * (0.75 + jit[nc]);
                if nd < dist[nc] {
                    dist[nc] = nd;
                    cn[nc] = cn[c];
                    heapq::heappush(&mut pq, (nd, nc));
                }
            }
        }
        // cellules isolées (îlots) : lieu le plus proche à vol d'oiseau
        self.cellnode = cn;
        self._fill_cellnode_rest();
    }

    fn _fill_cellnode_rest(&mut self) {
        let (W, H) = (self.W as usize, self.H as usize);
        let mut by_dept: Vec<Vec<(u16, f64, f64)>> = vec![vec![]; self.dept_codes.len() + 1];
        for n in self.nodes.iter() {
            by_dept[self.rang_dept(&n.at("dept"))].push((n.at("id").i() as u16, n.at("x").f(), n.at("y").f()));
        }
        for c in 0..W * H {
            if self.cellnode[c] as i64 != NONE {
                continue;
            }
            let d = self.dept[c] as usize;
            if d == 0 || matches!(self.terrain[c], OCEAN | EAU) || by_dept[d].is_empty() {
                continue;
            }
            let (x, y) = ((c % W) as f64 + 0.5, (c / W) as f64 + 0.5);
            self.cellnode[c] = py::min_by_key(by_dept[d].iter(), |t| py::pow(t.1 - x, 2.0) + py::pow(t.2 - y, 2.0)).unwrap().0;
        }
    }

    pub fn node_of_cell(&self, x: f64, y: f64) -> Option<i64> {
        let c = self.cell(x, y);
        if c < 0 {
            return None;
        }
        let v = self.cellnode[c as usize] as i64;
        if v == NONE {
            None
        } else {
            Some(v)
        }
    }

    // ------------------------------------------------------------ A* hors route
    /// cell_cost de toutes les cellules, calculé une fois (la carte ne change pas) : la recherche de chemin y lit
    /// directement au lieu d'appeler cell_cost pour chaque voisin.
    pub fn cell_costs(&self) -> &Vec<Option<f64>> {
        self._ccost.get_or_init(|| {
            let sp = vitesses();
            (0..self.terrain.len()).map(|c| self.cout(c, &sp)).collect()
        })
    }

    pub fn cell_cost(&self, c: i64) -> Option<f64> {
        // (un indice négatif part de la fin, comme en Python)
        self.cout(if c < 0 { (c + self.terrain.len() as i64) as usize } else { c as usize }, &vitesses())
    }

    /// (privé) cell_cost, les vitesses de TERRAIN déjà lues.
    fn cout(&self, c: usize, vitesse: &[f64]) -> Option<f64> {
        let t = self.terrain[c];
        let sp = vitesse[t as usize];
        if sp <= 0.0 || !self.jouable[self.dept[c] as usize] {
            return None;
        }
        let mut cost = 1.0 / sp;
        let r = self.river[c];
        if r == 3 && self.road[c] == 0 {
            return None;
        }
        if r == 3 {
            cost += 6.0;
        } else if r == 2 {
            cost += 2.5;
        } else if r == 1 {
            cost += 0.8;
        }
        Some(cost)
    }

    /// Chemin à travers champs. block : terres interdites, une marque par lieu (indice de self.cellnode, 0 : libre ;
    /// voir army_actions.cell_mask). Une cellule marquée ne s'atteint que depuis une cellule de même marque :
    /// on peut sortir des terres où l'on se trouve, pas y entrer. (En Python : max_nodes=120000, block=None.)
    pub fn astar(&self, sx: f64, sy: f64, gx: f64, gy: f64, max_nodes: i64, block: Option<&[u8]>) -> Option<Vec<Pt>> {
        let (W, H) = (self.W, self.H);
        let (s, g) = (self.cell(sx, sy), self.cell(gx, gy));
        let ccost = self.cell_costs();
        if s < 0 || g < 0 || ccost[g as usize].is_none() {
            return None;
        }
        let cn = &self.cellnode;
        if block.is_some_and(|block| block[cn[g as usize] as usize] != 0) {
            return None;
        }
        let (gi, gj) = (g % W, g / W);
        let hmin = 1.0 / 0.70;
        let mut openh = vec![(0.0, s)];
        let mut gs: HashMap<i64, f64> = HashMap::from([(s, 0.0)]);
        let mut came: HashMap<i64, i64> = HashMap::new();
        let mut seen = 0;
        while let Some((_f, c)) = heapq::heappop(&mut openh) {
            if c == g {
                break;
            }
            seen += 1;
            if seen > max_nodes {
                return None;
            }
            let gc = gs[&c];
            let (i, j) = (c % W, c / W);
            let bc = block.map_or(0, |block| block[cn[c as usize] as usize]);
            for &(di, dj, m) in &NBRS {
                let (ni, nj) = (i + di, j + dj);
                if !(0 <= ni && ni < W && 0 <= nj && nj < H) {
                    continue;
                }
                let nc = nj * W + ni;
                let mut cc = match ccost[nc as usize] {
                    Some(cc) => cc,
                    None => {
                        if nc != s {
                            continue;
                        }
                        2.0
                    }
                };
                if let Some(block) = block {
                    let bk = block[cn[nc as usize] as usize];
                    if bk != 0 {
                        if bk != bc {
                            continue;
                        }
                        cc *= 3.0; // en sortant de terres fermées, au plus court
                    }
                }
                let ng = gc + cc * m;
                if ng < gs.get(&nc).copied().unwrap_or(1e18) {
                    gs.insert(nc, ng);
                    came.insert(nc, c);
                    let hh = py::hypot((ni - gi) as f64, (nj - gj) as f64) * hmin;
                    heapq::heappush(&mut openh, (ng + hh, nc));
                }
            }
        }
        if !came.contains_key(&g) && g != s {
            return None;
        }
        let mut path = vec![g];
        while *path.last().unwrap() != s {
            path.push(came[path.last().unwrap()]);
        }
        path.reverse();
        let mut pts: Vec<Pt> = path.iter().map(|&c| ((c % W) as f64 + 0.5, (c / W) as f64 + 0.5)).collect();
        pts[0] = (sx, sy);
        *pts.last_mut().unwrap() = (gx, gy);
        Some(self._smooth(pts, block))
    }

    /// Sortie de terres interdites (marques de block) : chemin lissé vers la cellule libre la plus proche
    /// en temps de marche, ou None. strict : sans passer par d'autres terres interdites que celles où l'on est.
    /// (En Python : strict=True, max_nodes=40000.)
    pub fn nearest_open(&self, x: f64, y: f64, block: &[u8], strict: bool, max_nodes: i64) -> Option<Vec<Pt>> {
        let (W, H) = (self.W, self.H);
        let s = self.cell(x, y);
        if s < 0 {
            return None;
        }
        let cn = &self.cellnode;
        let ccost = self.cell_costs();
        let t0 = block[cn[s as usize] as usize];
        let mut dist: HashMap<i64, f64> = HashMap::from([(s, 0.0)]);
        let mut came: HashMap<i64, i64> = HashMap::new();
        let mut pq = vec![(0.0, s)];
        let mut seen = 0;
        while let Some((d, c)) = heapq::heappop(&mut pq) {
            if d > dist[&c] {
                continue;
            }
            if c != s && block[cn[c as usize] as usize] == 0 && cn[c as usize] as i64 != NONE {
                let mut path = vec![c];
                while *path.last().unwrap() != s {
                    path.push(came[path.last().unwrap()]);
                }
                path.reverse();
                let mut pts: Vec<Pt> = path.iter().map(|&p| ((p % W) as f64 + 0.5, (p / W) as f64 + 0.5)).collect();
                pts[0] = (x, y);
                return Some(self._smooth(pts, if strict { Some(block) } else { None }));
            }
            seen += 1;
            if seen > max_nodes {
                return None;
            }
            let (i, j) = (c % W, c / W);
            for &(di, dj, m) in &NBRS {
                let (ni, nj) = (i + di, j + dj);
                if !(0 <= ni && ni < W && 0 <= nj && nj < H) {
                    continue;
                }
                let nc = nj * W + ni;
                let Some(cc) = ccost[nc as usize] else { continue };
                let bk = block[cn[nc as usize] as usize];
                if strict && bk != 0 && bk != t0 {
                    continue;
                }
                let nd = d + cc * m;
                if nd < dist.get(&nc).copied().unwrap_or(1e18) {
                    dist.insert(nc, nd);
                    came.insert(nc, c);
                    heapq::heappush(&mut pq, (nd, nc));
                }
            }
        }
        None
    }

    pub fn _line_ok(&self, a: Pt, b: Pt, maxcost: f64, block: Option<&[u8]>) -> bool {
        let L = dist(a, b);
        let n = py::int(L / 0.5).max(1);
        let mut t0 = 0;
        if let Some(block) = block {
            let c0 = self.cell(a.0, a.1);
            t0 = if c0 >= 0 { block[self.cellnode[c0 as usize] as usize] } else { 0 };
        }
        let ccost = self.cell_costs();
        for s in 1..n {
            let t = s as f64 / n as f64;
            let c = self.cell(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
            let cc = if c >= 0 { ccost[c as usize] } else { None };
            match cc {
                None => return false,
                Some(cc) if cc > maxcost + 0.01 => return false,
                _ => {}
            }
            if let Some(block) = block {
                let bk = block[self.cellnode[c as usize] as usize];
                if bk != 0 && bk != t0 {
                    return false; // le raccourci ne coupe pas par des terres interdites
                }
            }
        }
        true
    }

    pub fn _smooth(&self, pts: Vec<Pt>, block: Option<&[u8]>) -> Vec<Pt> {
        if pts.len() <= 2 {
            return pts;
        }
        let ccost = self.cell_costs();
        let costs: Vec<f64> = pts
            .iter()
            .map(|p| {
                let c = self.cell(p.0, p.1);
                let cc = if c >= 0 { ccost[c as usize] } else { None };
                cc.unwrap_or(2.0)
            })
            .collect();
        let mut out = vec![pts[0]];
        let mut i = 0;
        while i < pts.len() - 1 {
            let j = i + 1;
            let mut mc = max2(costs[i], costs[j]);
            let mut k = j;
            while k + 1 < pts.len() {
                let mc2 = max2(mc, costs[k + 1]);
                if self._line_ok(pts[i], pts[k + 1], mc2, block) {
                    k += 1;
                    mc = mc2;
                } else {
                    break;
                }
            }
            out.push(pts[k]);
            i = k;
        }
        out
    }

    // ------------------------------------------------------------ export client
    /// (privé) Les tracés de la page, en cases : départements ou pays (leurs contours), fleuves, lacs. (La carte monde les a
    /// déjà, faits par ses théâtres.)
    fn traces_client(&self) -> (Val, Val, Val) {
        if !self.parties.is_empty() {
            return (self.src.at("depts"), self.src.at("rivers"), self.src.at("waters"));
        }
        let depts = Val::dict();
        for (code, d) in self.src.at("depts").items() {
            depts.set(
                &code,
                dict! {"name" => d.at("name"), "playable" => d.at("playable"),
                "rings" => self._rings_xy(&d.at("rings")).iter().map(|r| r.iter().map(|&p| l2(p)).collect::<Val>()).collect::<Val>()},
            );
        }
        let rivers: Val =
            self.src.at("rivers").iter().map(|r| dict! {"name" => r.at("name"), "rank" => r.at("rank"), "pts" => self.pts_lonlat(&r.at("pts")).iter().map(|&p| l2(p)).collect::<Val>()}).collect();
        let waters: Val = self.src.at("waters").iter().map(|w| dict! {"name" => w.at("name"), "ring" => self.pts_lonlat(&w.at("ring")).iter().map(|&p| l2(p)).collect::<Val>()}).collect();
        (depts, rivers, waters)
    }

    pub fn client_payload(&self) -> Val {
        let (depts, rivers, waters) = self.traces_client();
        let mut playable = self.playable_codes.vec();
        playable.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let b = self.src.at("bounds");
        // (SPEC-EMPIRE, module 3) la carte monde, surtout de l'océan, envoie ses grilles compactées (rle) : 1 Mo au lieu de 22
        let monde = !self.parties.is_empty();
        let grille = |d: &[u8], w: usize| if monde { rle(d, w) } else { b64encode(d) };
        let out = dict! {"W" => self.W, "H" => self.H, "lon0" => b.at("lon0"), "lat1" => b.at("lat1"), "KX" => self.KX, "KY" => self.KY, "playable" => playable,
        "y_mont" => self.xy(43.2, 0.0).1, "x_cote" => self.xy(44.0, -0.95).0, "y_spain" => self.xy(43.36, 0.0).1,
        "terrain" => grille(&self.terrain, 1),
        "dept" => grille(&self.dept, 1),
        "cellnode" => grille(&_b16(&self.cellnode), 2),   // (deux octets par case, petit-boutiste)
        "river" => grille(&self.river, 1),
        "dept_codes" => self.dept_codes.iter().map(Val::from).collect::<Val>(), "depts" => depts, "rivers" => rivers, "waters" => waters,
        "nodes" => &self.nodes, "edges" => &self.edges,
        "ways" => self.ways.values().iter().map(|w| dict!{"name" => w.at("name"), "label" => w.at("label"), "sea" => w.at("sea"),
                   "pts" => w.at("pts").iter().map(|p| l2(p.xy())).collect::<Val>()}).collect::<Val>(),
        "terrain_names" => Val::dict_from(TERRAIN().items().into_iter().map(|(k, v)| (k, v.at(0))).collect())};
        // (SPEC-EMPIRE, module 3) la carte monde : ses théâtres et leur cadre en cases [x, y, largeur, hauteur] (le sélecteur de
        // théâtre de la page), leur projection, leurs pays ; les routes maritimes, leurs balises d'horizon, les comptoirs
        if monde {
            out.set("rle", true);
            out.set("theatres", self.parties.iter().map(|p| dict! {"id" => p.theatre.id, "nom" => p.theatre.nom, "cadre" => list![p.ox, p.oy, p.W, p.H],
                "lon0" => p.lon0, "lat1" => p.lat1, "KX" => p.KX, "pays" => p.pays.iter().map(Val::from).collect::<Val>()}).collect::<Val>());
            for (k, v) in [("routes_mer", &self.routes_mer), ("sorties", &self.sorties), ("comptoirs", &self.comptoirs)] {
                out.set(k, v);
            }
        }
        out
    }
}

/// (privé) `{1: 3, 2: 2, 3: 1}[rank]` : la marque d'une rivière dans la grille, selon son rang.
fn niveau(rank: &Val) -> u8 {
    match rank.i() {
        1 => 3,
        2 => 2,
        3 => 1,
        k => panic!("KeyError: {k}"),
    }
}

/// (privé) `find` de _ensure_connected et de _relier : la racine de x, le chemin raccourci au passage.
fn find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// (privé) `TERRAIN[t][1]` pour chaque type de terrain : la vitesse hors route.
fn vitesses() -> Vec<f64> {
    TERRAIN().values().iter().map(|v| v.at(1).f()).collect()
}
