//! Banc de la douane (SPEC-MERCENAIRES.md, décisions 5 à 9) : portage de tests/test_douane.py.
//!
//! POURQUOI CE BANC EXISTE. Le tarif aux frontières touche les recettes, le commerce des partenaires, les relations des
//! voisins et la contrebande : des effets croisés entre camps qu'une partie ne montre qu'au bout de plusieurs mois.

mod fabrique_campagne;

use conquete::ai::AI;
use conquete::engine::{Date, Game};
use conquete::events as EV;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::serveur::{App, Reseau};
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{partie, partie_avec, GEO};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn recette(g: &mut Game, code: &str) -> Val {
    g.compute_income();
    g.factions.at(code).at("_douane").at("recette")
}

#[track_caller]
fn presque(a: f64, b: f64, places: i32) {
    assert!((a - b).abs() * 10f64.powi(places) < 0.5, "{a} != {b} à {places} décimales");
}

/// Les codes d'un set de camps, rangés (`sorted(nb)`).
fn ranges(nb: &Val) -> Vec<String> {
    let mut v: Vec<String> = nb.iter().map(|c| c.string()).collect();
    v.sort();
    v
}

// ------------------------------------------------------------------ Recettes

#[test]
fn le_tarif_rapporte_davantage_a_chaque_niveau() {
    let mut g = partie();
    let p = g.player.clone();
    let mut r = Vec::new();
    for t in 0..R::TARIFS().len() as i64 {
        g.factions.at(&p).set("tarif", t);
        r.push(recette(&mut g, &p).f());
    }
    assert_eq!(r[0], 0.0);
    let mut tri = r.clone();
    tri.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(r, tri);
    assert!(r[r.len() - 1] > r[1]);
}

#[test]
fn moins_de_voisins_moins_de_recettes() {
    let mut g = partie();
    let p = g.player.clone();
    g.factions.at(&p).set("tarif", 2);
    let nb = g.frontieres().0.at(&p);
    assert!(nb.len() >= 2);
    let r0 = recette(&mut g, &p).f();
    let o = ranges(&nb)[0].clone();
    for n in g.nodes.iter() {
        if n.at("owner") == o {
            n.set("owner", R::NEUTRAL); // un voisin de moins (ses terres passent aux insurgés)
        }
    }
    assert!(!g.frontieres().0.at(&p).has(o.as_str()));
    assert!(recette(&mut g, &p).f() < r0);
}

// ------------------------------------------------------------------ Contrebande

#[test]
fn la_part_suit_le_tarif_et_les_douaniers_la_divisent_par_deux() {
    let g = partie();
    let f = g.factions.at(&g.player);
    for (t, x) in R::TARIFS().iter().enumerate() {
        let taux = x.atf(1);
        f.set("tarif", t);
        f.set("douaniers", false);
        let m = if 1.5 * taux < 0.9 { 1.5 * taux } else { 0.9 };
        presque(g.contrebande(&g.player), m, 7);
        f.set("douaniers", true);
        presque(g.contrebande(&g.player), m / 2.0, 7);
    }
}

#[test]
fn les_douaniers_coutent_par_place_frontaliere() {
    let mut g = partie();
    let p = g.player.clone();
    let f = g.factions.at(&p);
    g.compute_income();
    let sans = f.at("income").atf("livres");
    assert_eq!(f.at("_upkeep").at("douaniers"), 0);
    assert!(g.set_douaniers(&p, &Val::from(true)).0);
    g.compute_income();
    let cout = g.frontieres().1.at(&p).len() as f64 * R::DOUANIERS_L;
    assert!(cout > 0.0);
    presque(f.at("_upkeep").atf("douaniers"), cout, 7);
    presque(f.at("income").atf("livres"), sans - cout, 6);
}

#[test]
fn les_contrebandiers_viennent_plus_souvent() {
    let g = partie();
    let e = EV::RANDOM_BY_ID().at("contrebande");
    let w = EV::_RANDOM_W(e.at("w").s());
    let cond = EV::_RANDOM_COND(e.at("cond").s());
    let w0 = w(&g, &g.player);
    g.factions.at(&g.player).set("tarif", 3);
    assert!(cond(&g, &g.player));
    assert!(w(&g, &g.player) > 2.0 * w0);
}

// ------------------------------------------------------------------ Prix

#[test]
fn les_partenaires_gagnent_moins() {
    let mut g = partie();
    let p = g.player.clone();
    let o = ranges(&g.frontieres().0.at(&p))[0].clone();
    g.factions.at(&p).at("trade").set(o.as_str(), true);
    g.factions.at(&o).at("trade").set(p.as_str(), true);
    g.compute_income();
    g.compute_income(); // (les revenus bruts de chacun sont connus au second passage)
    let avant = g.factions.at(&o).at("_trade").atf("livres");
    g.factions.at(&p).set("tarif", 3);
    g.compute_income();
    let apres = g.factions.at(&o).at("_trade").atf("livres");
    presque(apres, avant * (1.0 - 1.5 * R::TARIFS().at(3).atf(1)), 6);
}

#[test]
fn les_voisins_l_aiment_moins_chaque_mois() {
    let mut g = partie();
    let p = g.player.clone();
    let nb = g.frontieres().0.at(&p);
    let loin: Vec<Val> = g.factions.keys().into_iter().filter(|o| *o != p && !nb.has(o)).collect();
    g.factions.at(&p).set("tarif", 2);
    let avant = dict! {};
    for o in g.factions.keys() {
        if o != p {
            avant.set(&o, g.factions.at(&o).at("rel").at(&p));
        }
    }
    g.monthly(Date { year: 1790, month: 3, day: 1 });
    for o in nb.iter() {
        presque(g.factions.at(&o).at("rel").atf(&p), avant.atf(&o) - 2.0 * R::DOUANE_REL, 7);
    }
    for o in loin {
        assert_eq!(g.factions.at(&o).at("rel").at(&p), avant.at(&o));
    }
}

// ------------------------------------------------------------------ IA

#[test]
fn marchand_bas_pauvre_en_guerre_haut() {
    let mut g = partie_avec("64", "1790", 1, "normal");
    g.compute_income();
    for code in ["33", "24"] {
        // Gironde marchande (0,9), Dordogne non (0,5)
        let ai = AI::new(&g, code);
        let f = g.factions.at(code);
        ai.douane(&mut g);
        assert_eq!(f.at("tarif"), 0, "en paix et à l’aise : libre");
        g.set_status(code, "40", "guerre");
        ai.douane(&mut g);
        assert_eq!(f.at("tarif"), if code == "33" { 1 } else { 2 });
        f.at("income").set("livres", -5.0);
        ai.douane(&mut g);
        assert_eq!(f.at("tarif"), if code == "33" { 1 } else { 2 }, "un marchand ne dépasse pas « modéré », les autres « élevé »");
    }
}

// ------------------------------------------------------------------ Commandes

/// `server.App.__new__(server.App)` : une App sans préparer la carte ni charger de sauvegarde.
fn app_vide() -> App {
    App {
        geos: HashMap::new(),
        static_: HashMap::new(),
        geo: GEO(),
        game: None,
        reseau: Arc::new(Mutex::new(Reseau::default())),
        _auto_key: None,
    }
}

#[test]
fn validation() {
    let mut app = app_vide();
    app.game = Some(Box::new(partie()));
    let f = { let g = app.game.as_ref().unwrap(); g.factions.at(&g.player) };
    for bad in [Val::from(-1), Val::from(4), Val::from(1.5), Val::from("2"), Val::from(true), Val::None, list![1]] {
        assert!(!app.command(&dict! {"cmd" => "tarif", "value" => &bad}).atb("ok"), "{bad:?}");
    }
    assert_eq!(f.at("tarif"), 0);
    assert!(app.command(&dict! {"cmd" => "tarif", "value" => 3}).atb("ok"));
    assert_eq!(f.at("tarif"), 3);
    for bad in [Val::from(1), Val::from("oui"), Val::None] {
        assert!(!app.command(&dict! {"cmd" => "douaniers", "value" => &bad}).atb("ok"), "{bad:?}");
    }
    assert!(app.command(&dict! {"cmd" => "douaniers", "value" => true}).atb("ok"));
    assert!(f.atb("douaniers"));
    let d = json::loads(&json::dumps(&V::player_state(app.game.as_mut().unwrap(), 0))).unwrap().at("me").at("douane");
    assert_eq!((d.at("tarif"), d.at("on"), d.at("niveaux").len()), (Val::from(3), Val::from(true), 4));
}

#[test]
fn ancienne_sauvegarde() {
    let mut g = partie();
    for f in g.factions.values() {
        f.del("tarif");
        f.del("douaniers");
    }
    V::migrate(&mut g);
    assert!(g.factions.values().iter().all(|f| f.at("tarif") == 0 && matches!(f.at("douaniers"), Val::Bool(false))));
    g.compute_income();
}
