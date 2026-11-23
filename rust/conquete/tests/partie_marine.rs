//! Une partie d'essai pour la page de la marine (SPEC-EMPIRE, page P2) : la France (Europe, 1790) en guerre contre la
//! Grande-Bretagne, Brest avec un chantier naval (chaîne « port » au niveau 2) et de quoi payer des frégates, une
//! corvette anglaise au large de Brest. La page y bâtit une frégate, la déplace et livre une bataille navale.
//! Écrit la sauvegarde là où le dit CONQUETE_PARTIE_MARINE (un chemin de fichier .json, par exemple saves/essai-marine.json) :
//! `CONQUETE_PARTIE_MARINE=$PWD/saves/essai-marine.json cargo test --release -p conquete --test partie_marine -- --ignored`

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::marine as M;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::views as V;
use conquete::{dict, geo};

#[test]
#[ignore]
fn partie_marine() {
    let Some(chemin) = std::env::var_os("CONQUETE_PARTIE_MARINE") else { return };
    let carte = fabrique_campagne::geo(geo::VERSION_EUROPE);
    let mut g = Game::new(carte, "FR", &Val::from("normal"), &Val::from(1), &Val::from("1790"));
    let nom = |g: &Game, n: &str| (0..g.nodes.len() as i64).find(|&i| g.geo.nodes.at(i).at("name") == n).unwrap();
    let (brest, plymouth) = (nom(&g, "Brest"), nom(&g, "Plymouth"));
    conquete::cities::slots(&g.nodes.at(brest)).set("port", 2);
    conquete::cities::slots(&g.nodes.at(plymouth)).set("port", 3);
    D::declare_war(&mut g, "GB", "FR", true);
    for (code, l) in [("FR", 20000), ("GB", 100000)] {
        let r = g.factions.at(code).at("res");
        r.set("livres", l);
        r.set("bois", 5000);
        r.set("fer", 2000);
    }
    // la corvette anglaise : bâtie à Plymouth, posée au large de Brest
    let (ok, msg) = M::construire(&mut g, "GB", plymouth, &Val::from("corvette"));
    assert!(ok, "{msg}");
    for e in g.nodes.at(plymouth).at("queue").iter() {
        e.set("left", 0.0001);
    }
    g.update_queues(0.01);
    let f = g.flottes.values().into_iter().find(|f| f.at("owner") == "GB").expect("pas de corvette");
    let ch = M::chemin_mer(&g.geo, M::case_port(&g.geo, brest).unwrap(), M::case_port(&g.geo, plymouth).unwrap()).unwrap();
    let (x, y) = ch[ch.len() / 3];
    f.update(&dict! {"x" => x, "y" => y, "a_quai" => Val::None});
    let meta = dict! {"player" => "FR", "faction" => g.fname("FR"), "date" => g.date_str(&Val::None), "t" => g.t, "difficulty" => "normal", "auto" => false};
    let data = dict! {"meta" => meta, "game" => V::to_dict(&mut g)};
    std::fs::write(chemin, json::dumps_avec(&data, json::Ecriture::default())).unwrap();
}
