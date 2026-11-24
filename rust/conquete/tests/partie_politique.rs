//! Des parties d'essai pour la page de la politique intérieure (SPEC-POLITIQUE, page P9), sur la carte d'Europe en 1790 :
//! - `essai-politique-bord.json` : la France remise en monarchie absolue (comme en 1788), le peuple écrasé d'impôts au
//!   bord de la révolution (85 depuis trois mois) : le mois suivant, la révolution éclate ;
//! - `essai-politique-guerre.json` : la répression a échoué, la guerre civile éclate (« France (républicains) ») et
//!   la décision « rejoindre ou rester fidèle » attend le joueur.
//! Écrit les sauvegardes dans le dossier que donne CONQUETE_PARTIE_POLITIQUE (par exemple saves/) :
//! `CONQUETE_PARTIE_POLITIQUE=$PWD/saves cargo test --release -p conquete --test partie_politique -- --ignored`

mod fabrique_campagne;

use conquete::engine::politique as PO;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::views as V;
use conquete::{dict, geo};

fn ecrire(g: &mut Game, chemin: std::path::PathBuf) {
    let meta = dict! {"player" => "FR", "faction" => g.fname("FR"), "date" => g.date_str(&Val::None), "t" => g.t, "difficulty" => "normal", "auto" => false};
    let data = dict! {"meta" => meta, "game" => V::to_dict(g)};
    std::fs::write(chemin, json::dumps_avec(&data, json::Ecriture::default())).unwrap();
}

/// La France de 1790 remise en monarchie absolue, le peuple au bord de la révolution.
fn au_bord() -> Game {
    let carte = fabrique_campagne::geo(geo::VERSION_EUROPE);
    let mut g = Game::new(carte, "FR", &Val::from("normal"), &Val::from(1), &Val::from("1790"));
    let p = g.factions.at("FR").at("politique");
    p.set("regime", "absolue");
    p.set("mandat", Val::None);
    for (c, imp, m, mois) in [("peuple", 0.8, 85.0, 3), ("noblesse", 0.2, 30.0, 0)] {
        PO::regler_impot(&mut g, "FR", c, imp);
        let cl = p.at("classes").at(c);
        cl.set("mecontentement", m);
        cl.set("mois", mois);
    }
    g.recompute_mods("FR");
    g
}

#[test]
#[ignore]
fn partie_politique() {
    let Some(dossier) = std::env::var_os("CONQUETE_PARTIE_POLITIQUE") else { return };
    let dossier = std::path::PathBuf::from(dossier);
    let mut g = au_bord();
    ecrire(&mut g, dossier.join("essai-politique-bord.json"));
    // la révolution éclate, la répression échoue (sa chance remplacée par zéro) : la guerre civile
    let mut g = au_bord();
    PO::revolution(&mut g, "FR", "peuple", None);
    let x = g.pending_ev.iter().find(|x| x.at("ev") == "revolution").expect("pas de révolution");
    x.at("choices").at(0).at("fx").at("politique").set("chance", 0.0);
    let r = PO::commande(&mut g, "FR", &dict! {"sub" => "revolution", "choix" => "reprimer"});
    assert!(r.getb("ok"), "{r}");
    assert!(g.factions.has("FRr"), "pas de guerre civile");
    assert!(g.pending_ev.iter().any(|x| x.at("ev") == "guerre_civile"));
    ecrire(&mut g, dossier.join("essai-politique-guerre.json"));
}
