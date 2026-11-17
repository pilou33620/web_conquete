//! Banc des régiments étrangers (SPEC-MERCENAIRES.md, décisions 1 à 4) : portage de tests/test_mercenaires.py.
//!
//! POURQUOI CE BANC EXISTE. Les mercenaires ne se lèvent qu'à leur époque, au chef-lieu ou dans un port, trois au plus,
//! contre des livres seulement ; sans solde ils filent vite ; les IA en louent en guerre quand les recrues manquent.

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::{Date, Game};
use conquete::py::Val;
use conquete::rules as R;
use conquete::views as V;
use fabrique_campagne::{armee, partie_avec};
use std::collections::BTreeSet;

/// Avance le calendrier de la partie au 1er juin de cette année.
fn au(g: &mut Game, annee: i64) {
    g.start_ord = Date { year: annee, month: 6, day: 1 }.toordinal() - g.t as i64;
}

fn port(g: &Game, code: &str) -> i64 {
    g.owned_nodes(code)
        .iter()
        .map(|n| n.ati("id"))
        .find(|&i| g.geo.nodes.at(i).at("spec").has("port") && Val::from(i) != g.capital_of(code))
        .expect("StopIteration : pas de port")
}

fn reg(g: &mut Game, typ: &str, code: &str) -> Val {
    g.new_reg(typ, &Val::None, &Val::from(code))
}

// ------------------------------------------------------------------ Epoques

#[test]
fn chacun_a_son_epoque() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let cap = g.capital_of(&g.player).i();
    let attendu: [(i64, &[&str]); 8] = [
        (1700, &["suisses", "irlandais", "royal_allemand"]),
        (1791, &["suisses", "irlandais", "royal_allemand"]),
        (1792, &["suisses"]),
        (1800, &[]),
        (1815, &["suisses"]),
        (1830, &["suisses"]),
        (1831, &["legion"]),
        (1870, &["legion"]),
    ];
    for (annee, ok) in attendu {
        au(&mut g, annee);
        let p = g.player.clone();
        let got: BTreeSet<String> = R::MERCS().iter().filter(|t| g.can_recruit(&p, cap, t).0).map(|t| t.string()).collect();
        let ok: BTreeSet<String> = ok.iter().map(|s| s.to_string()).collect();
        assert_eq!(got, ok, "{annee}");
    }
}

// ------------------------------------------------------------------ Levee

#[test]
fn livres_seulement_veterans_rapides() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let units = R::UNITS();
    let ligne = units.at("ligne");
    for t in R::MERCS().iter() {
        let u = units.at(&t);
        let cles: Vec<String> = u.at("cost").keys().iter().map(|k| k.string()).collect();
        assert_eq!(cles, vec!["livres".to_string()], "{t}");
        assert_eq!(u.at("cost").at("livres"), ligne.at("cost").at("livres").py_mul(&Val::from(2)));
        assert_eq!(u.at("upkeep_l"), ligne.at("upkeep_l").py_mul(&Val::from(2)));
        assert!(u.at("xp0") > ligne.get_or("xp0", 0));
    }
    assert!(units.at("suisses").at("days") < units.at("ligne").at("days"));
    assert_eq!(units.at("royal_allemand").at("cls"), "cavalerie");
    let p = g.player.clone();
    let r = g.factions.at(&p).at("res");
    r.set("recrues", 0);
    r.set("armes", 0);
    r.set("livres", 10000);
    let cap = g.capital_of(&p).i();
    let (ok, why) = g.recruit(&p, cap, &Val::from("suisses"));
    assert!(ok, "{why}");
    assert_eq!(r.at("livres"), Val::from(10000).py_sub(&g.unit_cost(&p, "suisses").at("livres")));
    assert_eq!(reg(&mut g, "suisses", &p).at("xp"), 30);
}

#[test]
fn chef_lieu_ou_port() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let code = g.player.clone();
    let cap = g.capital_of(&code).i();
    let autre = g
        .owned_nodes(&code)
        .iter()
        .map(|n| n.ati("id"))
        .find(|&i| i != cap && !g.geo.nodes.at(i).at("spec").has("port") && g.geo.nodes.at(i).at("type") == "ville")
        .unwrap();
    let s = Val::from("suisses");
    assert!(g.can_recruit(&code, cap, &s).0);
    assert!(g.can_recruit(&code, port(&g, &code), &s).0);
    assert!(!g.can_recruit(&code, autre, &s).0);
    // la liste de recrutement des places
    let nodes = V::player_state(&mut g, 0).at("nodes");
    let ru = |nid: i64| nodes.iter().find(|d| d.at("id") == nid).unwrap().get("ru");
    assert!(ru(cap).has("royal_allemand"));
    assert!(!ru(autre).has("suisses"));
}

#[test]
fn plafond() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let code = g.player.clone();
    let cap = g.capital_of(&code).i();
    g.factions.at(&code).at("res").set("livres", 10000);
    g.nodes.at(cap).set("queue", Val::list(vec![]));
    let r = reg(&mut g, "irlandais", &code);
    armee(&g).at("regs").push(r); // en campagne
    assert!(g.recruit(&code, cap, &Val::from("royal_allemand")).0); // en file
    assert_eq!(g.merc_count(&code), R::MERC_MAX);
    let (ok, why) = g.can_recruit(&code, port(&g, &code), &Val::from("suisses"));
    assert!(!ok);
    assert!(why.contains(&R::MERC_MAX.to_string()));
    let r = reg(&mut g, "suisses", &code);
    g.nodes.at(cap).at("garrison").push(r); // (en garnison, il compte aussi)
    assert_eq!(g.merc_count(&code), R::MERC_MAX + 1);
}

// ------------------------------------------------------------------ Solde

#[test]
fn desertent_trois_fois_plus_vite() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let a = armee(&g);
    let p = g.player.clone();
    let regs = Val::list(vec![reg(&mut g, "ligne", &p), reg(&mut g, "suisses", &p)]);
    a.set("regs", &regs);
    for r in regs.iter() {
        r.set("morale", 80.0); // (même moral : seule la solde compte)
    }
    a.set("state", "idle");
    g.factions.at(&p).set("banqueroute", true);
    g.factions.at(&p).at("res").set("livres", -1000);
    let n0: Vec<f64> = regs.iter().map(|r| r.atf("n")).collect();
    g.attrition(1.0);
    let (lig, sui) = (n0[0] - regs.at(0).atf("n"), n0[1] - regs.at(1).atf("n"));
    assert!(lig > 0.0);
    assert!((sui - 3.0 * lig).abs() <= 0.5, "{sui} contre 3 × {lig}"); // (l'usure du terrain, la même pour tous, en plus)
    g.factions.at(&p).set("banqueroute", false);
    a.set("state", "move"); // (pas de renforts au repos)
    for r in regs.iter() {
        r.set("morale", 30.0); // (des départs dus au moral seul : pareils pour tous)
    }
    let n0: Vec<f64> = regs.iter().map(|r| r.atf("n")).collect();
    g.attrition(1.0);
    let (x, y) = (1.0 - regs.at(0).atf("n") / n0[0], 1.0 - regs.at(1).atf("n") / n0[1]);
    assert!((x - y).abs() < 5e-8, "payés, pas plus de départs : {x} {y}");
}

// ------------------------------------------------------------------ IA

#[test]
fn loue_en_guerre_sans_recrues() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let (code, autre) = ("24", "40");
    let mut ai = g.ais[code].take().unwrap();
    let f = g.factions.at(code);
    f.at("res").set("recrues", 0);
    f.at("res").set("livres", 6.0 * ai.reserve(&g) - 1.0);
    for n in g.owned_nodes(code).iter() {
        n.set("queue", Val::list(vec![]));
    }
    ai.recruit(&mut g);
    assert_eq!(g.merc_count(code), 0, "en paix, pas de mercenaires");
    D::declare_war(&mut g, code, autre, true);
    ai.recruit(&mut g);
    assert_eq!(g.merc_count(code), 0, "trésor trop maigre");
    f.at("res").set("livres", 7.0 * ai.reserve(&g));
    ai.recruit(&mut g);
    assert_eq!(g.merc_count(code), 1);
    f.at("res").set("recrues", 1000);
    ai.recruit(&mut g);
    assert_eq!(g.merc_count(code), 1, "des recrues : la troupe ordinaire");
    g.ais[code] = Some(ai);
}
