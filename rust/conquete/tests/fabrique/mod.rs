//! Fabrique de situations pour les bancs d'essai (portage de tests/fabrique.py) : une partie, un mois joué, une
//! bataille déjà engagée, deux régiments face à face… en une ligne, sans jouer des heures pour y arriver.
//!
//!     mod fabrique;
//!     use fabrique::*;
//!
//! Les bancs (`bancs_*.rs`) s'en servent ; un nouveau banc pour une nouvelle fonctionnalité aussi.
//!
//! Différences avec le Python : Rust n'a pas d'arguments par défaut (`bataille(mes)` prend les défauts du Python,
//! `bataille_ex` les prend tous) ; la bataille est sortie de sa partie (`Box<TacticalBattle>`, comme `g.tactical[bid]`) ;
//! les unités sont des dict `Val` (`u.at("men")`, `u.set("x", 1.0)`).
#![allow(dead_code)]

use conquete::diplomacy as D;
use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{self, Val};
use conquete::tactics::battle::{self as BT, TacticalBattle};
use conquete::tactics::skirmish as S;
use conquete::turns as TT;
use conquete::{dict, list};
use std::rc::Rc;
use std::sync::Mutex;

/// `u.x, u.y, u.state = 1.0, 2.0, 'repos'` → `regle!(u, x = 1.0, y = 2.0, state = "repos")` (avec `#[macro_use] mod
/// fabrique;`). Les valeurs sont posées une à une, dans l'ordre : une valeur qui lit un attribut déjà reposé se calcule
/// avant (le Python évalue toute la droite d'abord).
#[allow(unused_macros)]
macro_rules! regle {
    ($u:expr, $($k:ident = $v:expr),+ $(,)?) => { $( $u.set(stringify!($k), $v); )+ };
}

/// `assertAlmostEqual(a, b, places=n)` : round(a - b, n) == 0.
#[track_caller]
pub fn presque(a: f64, b: f64, places: i32, quoi: &str) {
    assert!(conquete::py::round_n(a - b, places) == 0.0, "{quoi} : {a} != {b} à {places} décimales");
}

/// `assertAlmostEqual(a, b, delta=d)`.
#[track_caller]
pub fn proche(a: f64, b: f64, delta: f64, quoi: &str) {
    assert!((a - b).abs() <= delta, "{quoi} : {a} != {b} à {delta} près");
}

/// La carte du Sud-Ouest (géographie 2), relue du cache des essais (le premier qui la calcule l'y écrit ; une seule
/// à la fois). Les essais n'écrivent pas dans logs/batailles.jsonl (outils/bilan.py) : WEB_CONQUETE_NOLOG est posé.
pub fn geo() -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    std::env::set_var("WEB_CONQUETE_NOLOG", "1");
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(2))
}

// ------------------------------------------------------------------ campagne
/// Une partie neuve, au tour du joueur. joueur : "33" Gironde, "24", "40", "47", "64" ; epoque : "1700", "1790",
/// "1813", "1870". (Python : `partie(joueur='33', epoque='1790', seed=1, difficulte='normal')`.)
pub fn partie(joueur: &str, epoque: &str, seed: i64, difficulte: &str) -> Game {
    Game::new(geo(), joueur, &Val::from(difficulte), &Val::from(seed), &Val::from(epoque))
}

/// Une armée du joueur (ou du camp owner).
pub fn armee(g: &Game, owner: Option<&str>) -> Val {
    let owner = owner.map(str::to_string).unwrap_or_else(|| g.player.clone());
    g.armies.values().into_iter().find(|a| a.at("owner") == owner.as_str()).expect("StopIteration : pas d'armée")
}

/// « Tour suivant » n fois : le tour des IA va jusqu'au 1er du mois suivant (interruptions acceptées d'office).
pub fn jouer_mois(g: &mut Game, n: i64) {
    for _ in 0..n {
        TT::go(g);
        let mut fini = false;
        for _ in 0..600 {
            if g.tour.at("end").is_none() {
                fini = true;
                break;
            }
            TT::advance(g, 1.0);
            if g.tour.at("stop").truthy() {
                TT::go(g);
            }
        }
        assert!(fini, "le tour des IA ne finit pas");
    }
}

// ------------------------------------------------------------------ batailles
/// Une escarmouche (mode Bataille), avec les défauts du Python : `bataille(mes)` = `bataille_ex(mes, "1790", "33",
/// "24", true, 1)`. mes : dict {type: nombre}, ou `Val::None` pour une unité de chaque arme.
pub fn bataille(mes: Val) -> (Box<TacticalBattle>, Val) {
    bataille_ex(mes, "1790", "33", "24", true, 1)
}

/// Une escarmouche (mode Bataille) : mes = {type: nombre}, par défaut (`Val::None`) une unité de chaque arme.
/// Renvoie (tb, unites) : la TacticalBattle et mes unités par type (dict : la première de chaque type).
/// demarree : déploiement fini, le combat a commencé. seed : même graine, même bataille (ennemis, terrain, météo).
pub fn bataille_ex(mes: Val, epoque: &str, joueur: &str, ennemi: &str, demarree: bool, seed: i64) -> (Box<TacticalBattle>, Val) {
    let mes = if mes.truthy() { mes } else { dict! {"ligne" => 1, "legere" => 1, "cavalerie" => 1, "artillerie" => 1} };
    let (g, bid) = S::new(geo(), &dict! {"me" => joueur, "foe" => ennemi, "era" => epoque, "units" => &mes, "seed" => seed});
    let mut g = g.unwrap_or_else(|| panic!("{bid}")); // (bid est alors le message d'erreur)
    let mut tb = g.tactical.take().unwrap();
    // (le jeu livre ses batailles sur ordres ; ces bancs du moteur commandent eux-mêmes chaque régiment du joueur)
    let me = tb.me.i();
    for u in tb.units.iter() {
        if u.ati("side") == me {
            u.set("ctrl", "joueur");
        }
    }
    tb.ai_sides = list![1 - me];
    tb.ai_mem.pop(format!("s{me}"));
    tb.spec.pop("mode");
    tb.spec.set("orders", Val::None);
    if demarree {
        tb.start();
    }
    let unites = dict! {};
    for u in tb.units.iter() {
        if u.at("owner") == joueur && mes.has(u.at("type")) && !unites.has(u.at("type")) {
            unites.set(u.at("type"), &u);
        }
    }
    (tb, unites)
}

/// Une escarmouche de `S::new` telle quelle (le corps de la requête du mode Bataille) : (la partie, la bataille
/// sortie de `g.tactical`). Pour les bancs qui écrivent `g, bid = S.new(GEO, dict(...)); tb = g.tactical[bid]`.
pub fn escarmouche(corps: &Val) -> (Game, Box<TacticalBattle>) {
    let (g, bid) = S::new(geo(), corps);
    let mut g = g.unwrap_or_else(|| panic!("{bid}"));
    let tb = g.tactical.take().unwrap();
    (g, tb)
}

/// `g, bid = S.new(GEO, corps)` : la partie, la bataille restée dans `g.tactical` (pour les bancs qui passent par
/// bridge : battle_view, command, tick…). `tb(&mut g)` la donne.
pub fn escarmouche_g(corps: &Val) -> (Game, String) {
    let (g, bid) = S::new(geo(), corps);
    (g.unwrap_or_else(|| panic!("{bid}")), bid)
}

/// La bataille en cours de la partie (`g.tactical[bid]`).
pub fn tb(g: &mut Game) -> &mut TacticalBattle {
    g.tactical.as_mut().expect("KeyError : pas de bataille en cours")
}

/// Une bataille de campagne en rase campagne qui attend le choix du joueur (« Donner mes ordres », commander,
/// automatique) : les deux armées de départ, doublées, se rencontrent loin de toute place. Renvoie (g, bt).
/// (Python : `bataille_de_campagne(epoque='1813', attaque=True, seed=3)`.)
pub fn bataille_de_campagne(epoque: &str, attaque: bool, seed: i64) -> (Game, Val) {
    let mut g = partie("33", epoque, seed, "normal");
    let (a, b) = (armee(&g, None), armee(&g, Some("24")));
    let mut best: Option<(i64, f64, f64)> = None;
    for dx in (-30..31).step_by(2) {
        for dy in (-30..31).step_by(2) {
            let (x, y) = (a.atf("x") + dx as f64, a.atf("y") + dy as f64);
            let loin = g.geo.nodes.iter().map(|n| py::pow(n.atf("x") - x, 2.0) + py::pow(n.atf("y") - y, 2.0)).fold(f64::INFINITY, f64::min) > 25.0;
            // (le Python ajoute `and g.geo.terrain_at(x, y) != 'eau'` : un entier comparé à un texte, toujours vrai)
            if loin {
                let d = dx * dx + dy * dy;
                if best.is_none_or(|b| d < b.0) {
                    best = Some((d, x, y));
                }
            }
        }
    }
    let best = best.unwrap();
    for k in [&a, &b] {
        let doubles: Val = k.at("regs").iter().map(|r| {
            let c = r.deepcopy();
            c.set("id", format!("{}b", r.at("id")));
            c
        }).collect();
        k.at("regs").extend(&doubles);
        k.set("at_node", Val::None);
        k.set("state", "idle");
    }
    a.set("x", best.1);
    a.set("y", best.2);
    b.set("x", best.1 + 1.0);
    b.set("y", best.2);
    let joueur = g.player.clone();
    D::declare_war(&mut g, "24", &joueur, true);
    let (mover, target) = if attaque { (&a, &b) } else { (&b, &a) };
    g.order_move(mover.at("owner").s(), &mover.at("id"), &dict! {"x" => target.at("x"), "y" => target.at("y")});
    TT::go(&mut g);
    for _ in 0..80 {
        TT::advance(&mut g, 0.1);
        if g.tour.at("stop").truthy() {
            break;
        }
    }
    let bt = g.battles.values().into_iter().find(|bt| bt.get("mode") == "attente").expect("StopIteration : pas de bataille en attente");
    assert!(bt.at("node").is_none());
    (g, bt)
}

/// Un ennemi vivant de u (de l'arme cls si demandée : "inf", "cavalerie", "artillerie").
pub fn ennemi(tb: &TacticalBattle, u: &Val, cls: Option<&str>) -> Val {
    tb.units
        .iter()
        .find(|e| e.at("side") != u.at("side") && conquete::tactics::units::alive(e) && e.at("state") != "hors" && cls.is_none_or(|c| e.at("cls") == c))
        .expect("StopIteration : pas d'ennemi")
}

/// Place la cible à environ `distance` mètres devant u, là où u la voit (pas dans un bois ni derrière une crête :
/// on essaie quelques directions et distances voisines), et met la vision à jour tout de suite. Renvoie la distance.
pub fn face_a_face(tb: &mut TacticalBattle, u: &Val, cible: &Val, distance: f64) -> f64 {
    for k in [1.0, 0.8, 1.2, 0.6, 1.4] {
        for da in [0.0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9] {
            let (a, d) = (u.atf("dir") + da, distance * k);
            cible.set("x", u.atf("x") + a.cos() * d);
            cible.set("y", u.atf("y") + a.sin() * d);
            cible.set("path", list![]);
            cible.set("goal", Val::None);
            tb._update_vision();
            if tb.seen_by.at(u.at("side")).has(cible.at("id")) {
                return d;
            }
        }
    }
    panic!("la cible reste invisible près de cette distance : essayer une autre graine")
}

/// Fait tourner la bataille `secondes` secondes de bataille. Renvoie le temps écoulé.
pub fn avancer(tb: &mut TacticalBattle, secondes: f64) -> f64 {
    avancer_jusqua(tb, secondes, |_| false)
}

/// Fait tourner la bataille `secondes` secondes de bataille, ou jusqu'à ce que jusqua(tb) soit vrai. Renvoie le temps
/// écoulé.
pub fn avancer_jusqua(tb: &mut TacticalBattle, secondes: f64, jusqua: impl Fn(&TacticalBattle) -> bool) -> f64 {
    let mut t = 0.0;
    while t < secondes && tb.phase != "fin" {
        if jusqua(tb) {
            break;
        }
        tb.step(BT::DT);
        t += BT::DT;
    }
    t
}

/// Ordre du joueur à une unité, comme depuis le panneau : (ok, message). p : dict des paramètres (`dict!{}` sinon).
pub fn ordre(tb: &mut TacticalBattle, u: &Val, kind: &str, p: Val) -> (bool, String) {
    tb.order(u.ati("side"), &list![u.at("id")], kind, "joueur", &p)
}

/// Nom de l'ordre en cours d'une unité ("charge", "harass"…), ou None.
pub fn kind(u: &Val) -> Val {
    let o = u.at("order");
    if matches!(o, Val::Dict(_)) {
        o.get("kind")
    } else {
        o
    }
}

/// `json.loads(json.dumps(x))` : la valeur passée par le texte d'une sauvegarde.
pub fn par_json(v: &Val) -> Val {
    conquete::py::json::loads(&conquete::py::json::dumps_compact(v)).unwrap()
}
