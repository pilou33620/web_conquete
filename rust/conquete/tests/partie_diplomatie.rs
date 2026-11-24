//! Une partie d'essai pour la page de la diplomatie profonde (SPEC-POLITIQUE, page P10) : la Gironde (Aquitaine, 1790)
//! alliée à la Dordogne (souvenirs, diplomate girondin en ambassade à son chef-lieu), qui l'appelle aux armes contre les
//! Landes ; le Lot-et-Garonne lui adresse un ultimatum ; les Landes lui proposent un accord composé ; les
//! Pyrénées-Atlantiques sont son protectorat. La page y lit les fiches, répond, et négocie avec le Lot-et-Garonne.
//! Écrit la sauvegarde là où le dit CONQUETE_PARTIE_DIPLO (un chemin de fichier .json, par exemple saves/essai-diplomatie.json) :
//! `CONQUETE_PARTIE_DIPLO=$PWD/saves/essai-diplomatie.json cargo test --release -p conquete --test partie_diplomatie -- --ignored`

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::agents as AG;
use conquete::engine::memoire as MEM;
use conquete::py::{json, Val};
use conquete::views as V;
use conquete::{dict, list};

#[test]
#[ignore]
fn partie_diplomatie() {
    let Some(chemin) = std::env::var_os("CONQUETE_PARTIE_DIPLO") else { return };
    let mut g = fabrique_campagne::partie();
    let p = g.player.clone();
    for c in ["33", "24", "40", "47", "64"] {
        g.factions.at(c).at("res").set("livres", 5000);
    }
    // l'allié : souvenirs, diplomate en ambassade, en guerre contre les Landes ; il appelle la Gironde aux armes
    D::make_alliance(&mut g, &p, "24");
    MEM::retenir(&g, "24", &p, "cadeau", None);
    MEM::retenir(&g, "24", &p, "aide", None);
    MEM::retenir(&g, "24", &p, "mariage", None);
    let cap24 = g.capital_of("24").i();
    let a = AG::nouvel_agent(&mut g, &p, "diplomate", cap24);
    let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("ambassade"), &Val::from(cap24));
    assert!(ok, "{msg}");
    D::declare_war(&mut g, "24", "40", true);
    let (r, msg) = D::appel(&mut g, "24", &Val::from(p.as_str()), &Val::from("40"));
    assert!(r.is_none(), "{msg}");
    // le Lot-et-Garonne, fâché, exige une place girondine
    MEM::retenir(&g, "47", &p, "incident", None);
    let place = g.owned_nodes(&p).iter().map(|n| n.ati("id")).find(|&n| !g.geo.nodes.at(n).at_is("type", "capitale")).unwrap();
    let (r, msg) = D::ultimatum(&mut g, "47", &Val::from(p.as_str()), &dict! {"type" => "region", "node" => place});
    assert!(r.is_none(), "{msg}");
    // les Landes proposent un accord composé : de l'argent et leurs cartes contre le droit de passage
    let cl = dict! {"donner" => list![dict! {"type" => "argent", "montant" => 300}, dict! {"type" => "cartes"}],
                    "recevoir" => list![dict! {"type" => "passage"}]};
    let (r, msg) = D::proposer(&mut g, "40", &Val::from(p.as_str()), &cl);
    assert!(r.is_none(), "{msg}");
    // le protectorat
    D::make_vassal(&mut g, "64", &p);
    let actions: Vec<String> = g.proposals.iter().map(|x| x.ats("action")).collect();
    for a in ["appel", "ultimatum", "proposition"] {
        assert!(actions.iter().any(|x| x == a), "{a} manque : {actions:?}");
    }
    let meta = dict! {"player" => &p, "faction" => g.fname(&p), "date" => g.date_str(&Val::None), "t" => g.t, "difficulty" => "normal", "auto" => false};
    let data = dict! {"meta" => meta, "game" => V::to_dict(&mut g)};
    std::fs::write(chemin, json::dumps_avec(&data, json::Ecriture::default())).unwrap();
}
