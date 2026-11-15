//! engine/armees.rs et engine/chemins.rs contre game/engine.py (lignes 1525 à 2705), pour ce qui tourne sans le reste
//! de la partie : tests/references/campagne2.json est écrit par le jumeau outils/jumeau/campagne2_ref.py, qui joue
//! une suite d'opérations sur un état de départ ; on la rejoue ici sur le même état et l'on compare chaque résultat,
//! l'état final (ordre des clés compris) et le tirage suivant du hasard de la partie.

use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Random, Val};
use std::rc::Rc;

fn reference() -> Val {
    json::loads(include_str!("references/campagne2.json")).unwrap()
}

/// La géographie 3, relue du cache que tests/geo.rs écrit (ou générée).
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(3))
}

/// Une opération du jumeau (même nom, mêmes arguments) ; rend son résultat.
fn jouer(g: &mut Game, op: &Val) -> Val {
    let nom = op.ats(0);
    let arg = |i: i64| op.at(i + 1);
    let armee = |g: &Game, aid: &Val| if aid.is_none() { Val::None } else { g.armies.at(aid) };
    match nom.as_str() {
        "gid" => Val::from(g.gid(arg(0).s())),
        "new_general" => g.new_general(arg(0).s()),
        "prendre_general" => g.prendre_general(arg(0).s()),
        "generaux" => g.generaux(arg(0).s()).iter().map(|x| x.at("id")).collect(),
        "blesser" => {
            let a = armee(g, &arg(0));
            g.blesser_general(&a, &arg(1));
            Val::None
        }
        "tuer" => {
            let a = armee(g, &arg(0));
            g.tuer_general(&a);
            Val::None
        }
        "risques" => g.risques_general(&armee(g, &arg(0)), arg(1).s(), arg(2).truthy()),
        "set_t" => {
            g.t = arg(0).f();
            Val::None
        }
        "general_xp" => {
            let a = armee(g, &arg(0));
            g.general_xp(&a, &arg(1), arg(2).truthy());
            Val::None
        }
        "offres_talent" => {
            let gen = armee(g, &arg(0)).at("gen");
            g.offres_talent(&gen)
        }
        "offrir_talent" => {
            let a = armee(g, &arg(0));
            g.offrir_talent(&a);
            Val::None
        }
        "choisir_talent" => {
            let mut cle = arg(2);
            if cle == "@promo" {
                cle = armee(g, &arg(1)).at("gen").get("promo").or(conquete::list!["?"]).at(0);
            }
            let (ok, msg) = g.choisir_talent(arg(0).s(), &arg(1), cle.s());
            conquete::list![ok, msg]
        }
        "reserver" => {
            g.reserver(arg(0).s(), &arg(1).deepcopy());
            Val::None
        }
        "reserver_armee" => {
            let gen = armee(g, &arg(1)).at("gen");
            g.reserver(arg(0).s(), &gen);
            Val::None
        }
        "soigner" => {
            g.soigner_generaux();
            Val::None
        }
        "nommer" => {
            let (ok, msg) = g.nommer(arg(0).s(), &arg(1), arg(2).s());
            conquete::list![ok, msg]
        }
        "moral" => Val::from(g.moral_medailles(&armee(g, &arg(0)))),
        "hegemon" => g.hegemon(),
        "army_men" => Val::from(g.army_men(&armee(g, &arg(0)))),
        "army_pos_node" => g.army_pos_node(&armee(g, &arg(0))),
        "fort_guns" => Val::from(g.fort_guns(&g.nodes.at(&arg(0)))),
        "passable" => {
            let block = if arg(3).is_none() { Val::None } else { arg(3).to_set() };
            Val::from(g.passable_node(arg(0).s(), arg(1).i(), &Val::None, arg(2).i(), &block))
        }
        "edge_xy" => {
            let e = g.geo.edges.at(&arg(0));
            let frm = if arg(1).truthy() { e.ati("a") } else { e.ati("b") };
            let (x, y) = g.edge_xy(&e, frm, arg(2).f());
            conquete::list![x, y]
        }
        "edge_between" => {
            let e = g.edge_between(arg(0).i(), arg(1).i());
            if e.is_none() { Val::None } else { e.at("id") }
        }
        "nearest" => {
            let (x, y, maxd) = (arg(0).f(), arg(1).f(), arg(2).f());
            if arg(3).truthy() {
                g.nearest_node(x, y, Some(&mut |_: &mut Game, i: i64| i % 3 == 0), maxd)
            } else {
                g.nearest_node(x, y, None, maxd)
            }
        }
        "boat_prefix" => g.boat_prefix(&armee(g, &arg(0))),
        "besiegers" => g.besiegers(&g.nodes.at(&arg(0))).iter().map(|a| a.at("id")).collect(),
        "end_siege" => {
            let a = armee(g, &arg(0));
            g.end_siege_for(&a);
            Val::None
        }
        "paused" => {
            g.tour = arg(1);
            let a = armee(g, &arg(0));
            conquete::list![g.paused(&a), g.marching(&a)]
        }
        "set_state" => {
            armee(g, &arg(0)).set("state", arg(1));
            Val::None
        }
        "rail_switch" => {
            let a = armee(g, &arg(0));
            g.rail_switch(&a, arg(1).truthy());
            Val::None
        }
        "start_land" => g.start_land(&armee(g, &arg(0)), &arg(1).to_set()),
        "rng" => Val::from(g.rng.random()),
        _ => panic!("opération inconnue {nom}"),
    }
}

#[test]
fn generaux_chemins_sieges() {
    let r = reference();
    let geo = geo();
    for cas in r.at("cas").iter() {
        let seed = cas.ati("seed");
        let etat = cas.at("etat").deepcopy();
        let mut g = Game::__new__(geo.clone());
        g.seed = seed;
        g.rng = Random::new(seed);
        g.t = 0.0;
        g.player = "33".to_string();
        g.factions = etat.at("factions");
        g.armies = etat.at("armies");
        g.nodes = etat.at("nodes");
        g.tour = conquete::dict! {"on" => false, "end" => Val::None};
        for (op, attendu) in cas.at("ops").iter().zip(cas.at("res").iter()) {
            let obtenu = jouer(&mut g, &op);
            assert_eq!(json::dumps_ref_ordre(&obtenu), json::dumps_ref_ordre(&attendu), "graine {seed}, {op:?}");
        }
        let fin = cas.at("fin");
        for k in ["factions", "armies", "nodes"] {
            let obtenu = match k {
                "factions" => &g.factions,
                "armies" => &g.armies,
                _ => &g.nodes,
            };
            assert_eq!(json::dumps_ref_ordre(obtenu), json::dumps_ref_ordre(&fin.at(k)), "graine {seed}, état final : {k}");
        }
    }
}
