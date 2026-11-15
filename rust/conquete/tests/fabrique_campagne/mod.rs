//! Fabrique de situations pour les bancs de la campagne et du serveur (portage de tests/fabrique.py) : une partie, un
//! mois joué, une bataille de campagne qui attend le choix du joueur… en une ligne, sans jouer des heures pour y arriver.
//!
//! (Une version complète de la fabrique, celle des bancs de la bataille, est dans tests/fabrique/mod.rs ; ce qui fait
//! doublon sera fusionné.)
#![allow(dead_code, non_snake_case)]

use conquete::diplomacy as D;
use conquete::engine::Game;
use conquete::events as E;
use conquete::geo::GeoMap;
use conquete::py::{self, Val};
use conquete::turns as TT;
use conquete::dict;
use std::cell::OnceCell;
use std::rc::Rc;
use std::sync::Mutex;

/// La géographie v, relue du cache de la carte que les essais partagent (CARGO_TARGET_TMPDIR/geo : tests/geo.rs
/// l'écrit ; une seule à la fois : deux fils n'écrivent pas le cache ensemble). Coupe aussi le journal des batailles,
/// comme fabrique.py (`WEB_CONQUETE_NOLOG=1` : les essais n'écrivent pas dans logs/batailles.jsonl).
pub fn geo(v: i64) -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    std::env::set_var("WEB_CONQUETE_NOLOG", "1");
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(v))
}

thread_local! {
    static GEO2: OnceCell<Rc<GeoMap>> = const { OnceCell::new() };
}

/// `GEO = GeoMap(2)` : la carte du Sud-Ouest (géographie 2), relue une fois par fil d'essai.
pub fn GEO() -> Rc<GeoMap> {
    GEO2.with(|c| c.get_or_init(|| geo(2)).clone())
}

// ------------------------------------------------------------------ campagne
/// Une partie neuve, au tour du joueur. joueur : '33' Gironde, '24', '40', '47', '64' ; epoque : '1700', '1790',
/// '1813', '1870'. (fabrique.py : `partie(joueur='33', epoque='1790', seed=1, difficulte='normal')`.)
pub fn partie_avec(joueur: &str, epoque: &str, seed: i64, difficulte: &str) -> Game {
    Game::new(GEO(), joueur, &Val::from(difficulte), &Val::from(seed), &Val::from(epoque))
}

/// `partie()` : la Gironde en 1790, graine 1.
pub fn partie() -> Game {
    partie_avec("33", "1790", 1, "normal")
}

/// Une armée du joueur.
pub fn armee(g: &Game) -> Val {
    let p = g.player.clone();
    armee_de(g, &p)
}

/// Une armée du camp owner.
pub fn armee_de(g: &Game, owner: &str) -> Val {
    g.armies.values().into_iter().find(|a| a.at("owner") == owner).expect("StopIteration : aucune armée")
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

/// outils/simuler.py carry_on : le camp du joueur rayé de la carte, le monde continue, vu d'un autre camp en vie.
pub fn carry_on(g: &mut Game) -> bool {
    if !(g.over.is_dict() && g.over.get("result") == "defaite") {
        return false;
    }
    let mut alive: Vec<String> = g.factions.items().into_iter().filter(|(_, f)| f.atb("alive")).map(|(c, _)| c.string()).collect();
    alive.sort();
    if alive.len() < 2 {
        return false;
    }
    g.player = alive[0].clone();
    g.over = Val::None;
    g.lost_player = true;
    true
}

/// outils/simuler.py play_month : un « Tour suivant » ; les décisions qui attendent le joueur, c'est son IA qui les
/// prend (le premier choix qu'il peut payer, comme les IA).
pub fn play_month(g: &mut Game) {
    TT::go(g);
    for _ in 0..3000 {
        if carry_on(g) {
            TT::go(g);
        }
        if g.tour.at("end").is_none() || g.over.truthy() {
            return;
        }
        for x in g.pending_ev.iter() {
            let choices = x.at("choices");
            let n = choices.len() as i64;
            let p = g.player.clone();
            let ok = (0..n).find(|&i| E::affordable(g, &p, &choices.at(i).at("fx")));
            E::resolve(g, x.at("id").s(), ok.unwrap_or(n - 1), true);
        }
        TT::advance(g, 1.0);
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
    }
    panic!("le tour des IA ne finit pas");
}

// ------------------------------------------------------------------ batailles
/// Une bataille de campagne en rase campagne qui attend le choix du joueur (« Donner mes ordres », commander,
/// automatique) : les deux armées de départ, doublées, se rencontrent loin de toute place. Renvoie (g, bt).
/// (fabrique.py : `bataille_de_campagne(epoque='1813', attaque=True, seed=3)`.)
pub fn bataille_de_campagne(epoque: &str, attaque: bool, seed: i64) -> (Game, Val) {
    let mut g = partie_avec("33", epoque, seed, "normal");
    let (a, b) = (armee(&g), armee_de(&g, "24"));
    let mut best: Option<(f64, f64, f64)> = None;
    for dx in (-30..31).step_by(2) {
        for dy in (-30..31).step_by(2) {
            let (dx, dy) = (dx as f64, dy as f64);
            let (x, y) = (a.atf("x") + dx, a.atf("y") + dy);
            let m = py::min_by_key(g.geo.nodes.iter().map(|n| py::pow(n.atf("x") - x, 2.0) + py::pow(n.atf("y") - y, 2.0)), |d| *d).unwrap();
            // (le Python compare g.geo.terrain_at(x, y), un numéro de terrain, au texte 'eau' : toujours différent)
            if m > 25.0 {
                let d = dx * dx + dy * dy;
                if best.is_none() || d < best.unwrap().0 {
                    best = Some((d, x, y));
                }
            }
        }
    }
    let best = best.unwrap();
    for k in [&a, &b] {
        let plus: Vec<Val> = k.at("regs").iter().map(|r| {
            let c = r.deepcopy();
            c.set("id", format!("{}b", r.at("id")));
            c
        }).collect();
        k.at("regs").extend(&Val::list(plus));
        k.set("at_node", Val::None);
        k.set("state", "idle");
    }
    a.set("x", best.1);
    a.set("y", best.2);
    b.set("x", best.1 + 1.0);
    b.set("y", best.2);
    let p = g.player.clone();
    D::declare_war(&mut g, "24", &p, true);
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

// ------------------------------------------------------------------ outils/simuler.py
const GRANDES_ARMES: [&str; 4] = ["gribeauval", "percussion", "lahitte", "chassepot"];

/// outils/simuler.py simulate : une partie de `mois` tours jouée par les IA seules (le camp du joueur aussi) ; rend ses
/// mesures (un dict). Une erreur (panique du moteur) est une mesure : la partie s'arrête là.
pub fn simuler(seed: i64, epoque: &str, mois: i64, joueur: &str) -> Val {
    use conquete::ai::AI;
    use conquete::dict;
    let mut g = partie_avec(joueur, epoque, seed, "normal");
    let ai = AI::new(&g, &g.player.clone());
    g.ais.insert(g.player.clone(), Some(ai)); // le camp du joueur joué par une IA, comme les autres
    let mut codes: Vec<String> = g.factions.keys().iter().map(|c| c.string()).collect();
    codes.sort();
    let pairs: Vec<(String, String)> =
        codes.iter().enumerate().flat_map(|(i, a)| codes[i + 1..].iter().map(move |b| (a.clone(), b.clone()))).collect();
    let (mut starts, mut war_months, mut bq, mut fam) = (0i64, 0i64, 0i64, 0i64);
    let mut before: Vec<bool> = pairs.iter().map(|(a, b)| g.at_war(a, b)).collect();
    let mut err = Val::None;
    for _ in 0..mois {
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| play_month(&mut g))) {
            let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            err = Val::from(m);
            break;
        }
        carry_on(&mut g);
        if g.over.truthy() {
            break;
        }
        let vivant = |c: &String, k: &str| g.factions.at(c.as_str()).atb("alive") && g.factions.at(c.as_str()).get(k).truthy();
        bq += codes.iter().filter(|c| vivant(c, "banqueroute")).count() as i64;
        fam += codes.iter().filter(|c| vivant(c, "famine")).count() as i64;
        let now: Vec<bool> = pairs.iter().map(|(a, b)| g.at_war(a, b)).collect();
        starts += now.iter().zip(&before).filter(|(n, b)| **n && !**b).count() as i64;
        war_months += now.iter().filter(|n| **n).count() as i64;
        before = now;
    }
    let places = dict! {};
    for c in &codes {
        places.set(c.as_str(), g.nodes.iter().filter(|n| n.at("owner") == c.as_str()).count());
    }
    if err.is_none() && g.over.truthy() {
        let t = if g.over.is_dict() { g.over.get_or("text", "").string() } else { "partie terminée".to_string() };
        err = Val::from(format!("fin : {t}")); // (pas une erreur)
    } else if err.is_none() && g.lost_player {
        err = Val::from(format!("fin : la Gironde a disparu, vu ensuite depuis {}", g.player)); // (pas une erreur)
    }
    let pv: Vec<i64> = places.values().iter().map(|v| v.i()).collect();
    let n = codes.len() as f64;
    let armes = dict! {};
    for t in GRANDES_ARMES {
        armes.set(
            t,
            codes
                .iter()
                .filter(|c| g.factions.at(c.as_str()).get_or("tech_dates", dict! {}).has(t))
                .map(|c| Val::from(g.date(&g.factions.at(c.as_str()).at("tech_dates").at(t).at(1)).year))
                .collect::<Val>(),
        );
    }
    dict! {"seed" => seed, "epoque" => epoque, "date" => g.date_str(&Val::None), "err" => err, "guerres" => starts,
        "duree" => if starts != 0 { py::round_n(war_months as f64 / starts as f64, 1) } else { 0.0 }, "places" => &places,
        "ecart" => pv.iter().max().unwrap() - pv.iter().min().unwrap(),
        "vivants" => codes.iter().filter(|c| g.factions.at(c.as_str()).atb("alive")).count(),
        "techs" => py::round_n(codes.iter().map(|c| g.factions.at(c.as_str()).at("techs").len()).sum::<usize>() as f64 / n, 1),
        "tresor" => py::round(py::sum(codes.iter().map(|c| g.factions.at(c.as_str()).at("res").atf("livres"))) / n),
        "hommes" => py::round(py::sum(g.armies.values().iter().map(|a| g.army_men(a))) / n),
        "lignes" => g.rails.values().iter().filter(|st| st.get("done").truthy()).count(),
        "bq" => bq, "fam" => fam,
        "crues" => g.city_stats.get_or("quoi", dict! {}).get_or("crue", 0),
        "armes" => armes}
}
