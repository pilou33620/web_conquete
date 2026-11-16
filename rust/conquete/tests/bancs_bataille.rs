//! Banc d'essai des batailles tactiques (tactics/) : porté de tests/test_bataille.py.
//!
//! POURQUOI CE BANC EXISTE. Une bataille dure plusieurs minutes à l'écran, et un ordre qui ne fait rien ou une unité
//! coincée ne se voit qu'en la jouant. Ici chaque situation se fabrique en une ligne (fabrique::bataille, face_a_face)
//! et se vérifie en quelques secondes. Bugs déjà rattrapés, à ne pas revoir :
//! - « Salve puis baïonnette » restait planté si l'on avait ordonné « cessez le feu » entre-temps ;
//! - un canon sans munitions restait « au feu » ;
//! - un régiment « anéanti » (moins de 8 hommes) revenait sur la carte de campagne.
//!
//! Les classes du Python sont des sections ; une méthode d'aide d'une classe (defense, attaque, place, tir…) est une
//! fonction de la section. `self.skipTest(…)` : l'essai le dit et s'arrête là (il passe).
#![allow(non_snake_case)] // (les noms du Python : L, TB…)

#[macro_use]
mod fabrique;

use conquete::engine::Game;
use conquete::py::{self, json, Val};
use conquete::rules as R;
use conquete::tactics::ai as AI;
use conquete::tactics::battle::{self as BT, TacticalBattle};
use conquete::tactics::bridge as TB;
use conquete::tactics::orders as OR;
use conquete::tactics::stats as ST;
use conquete::tactics::terrain::{self as TR, CELL, COLS, ROWS, T_BARRICADE, T_BOIS, T_BRECHE, T_CHAMP, T_MUR, T_PRE};
use conquete::tactics::units as U;
use conquete::{dict, list};
use fabrique::*;
use std::f64::consts::PI;

fn ids(u: &Val) -> Val {
    list![u.at("id")]
}
fn nul() -> Val {
    dict! {}
}
fn recharge(tb: &TacticalBattle) -> Box<TacticalBattle> {
    Box::new(TacticalBattle::from_dict(geo(), &par_json(&tb.to_dict())).unwrap())
}
fn vue_par_id(v: &Val) -> Val {
    let d = dict! {};
    for x in v.at("units").iter() {
        d.set(x.at("id"), &x);
    }
    d
}
/// `mock.patch.dict(R.TECH_YEAR, …)` le temps de `f` (TECH_YEAR est une constante partagée du fil de l'essai).
fn avec_tech_year<T>(annees: &[(&str, i64)], f: impl FnOnce() -> T) -> T {
    let ty = R::TECH_YEAR();
    let avant = ty.copy();
    for (k, a) in annees {
        ty.set(*k, *a);
    }
    let r = f();
    ty.clear();
    ty.update(&avant);
    r
}

// ==================================================================================================== OrdresParArme
// Chaque arme a ses ordres (l'IA les donne par battle.order) ; le moteur refuse ceux qui ne sont pas les siens.

#[test]
fn ordres_acceptes_et_refuses() {
    let (mut tb, u) = bataille(Val::None);
    let cible = ennemi(&tb, &u.at("ligne"), None);
    face_a_face(&mut tb, &u.at("ligne"), &cible, 300.0);
    let c = cible.at("id");
    let attendu = [
        ("ligne", "fire", dict! {"mode" => "volley"}, true),
        ("ligne", "volley_charge", dict! {"target" => &c}, true),
        ("ligne", "charge", dict! {"target" => &c}, true),
        ("legere", "harass", nul(), true),
        ("legere", "cover", nul(), true),
        ("cavalerie", "charge", dict! {"target" => &c}, true),
        ("cavalerie", "volley_charge", dict! {"target" => &c}, false), // la cavalerie ne tire pas
        ("cavalerie", "harass", nul(), false),
        ("cavalerie", "pursue", nul(), false), // personne ne fuit encore
        ("artillerie", "shot", dict! {"mode" => "mitraille"}, true),
        ("artillerie", "counter", dict! {"mode" => "on"}, true),
        ("ligne", "shot", dict! {"mode" => "boulet"}, false), // réservé aux canons
    ];
    for (typ, k, p, ok) in attendu {
        let res = ordre(&mut tb, &u.at(typ), k, p);
        assert_eq!(res.0, ok, "arme={typ} ordre={k} : {}", res.1);
    }
}

#[test]
fn ordres_refuses_pendant_le_deploiement() {
    let (mut tb, u) = bataille_ex(Val::None, "1790", "33", "24", false, 1);
    assert!(!ordre(&mut tb, &u.at("ligne"), "harass", nul()).0);
    assert!(ordre(&mut tb, &u.at("artillerie"), "shot", dict! {"mode" => "boulet"}).0); // mais le projectile se règle avant
}

#[test]
fn salve_puis_baionnette_finit_en_charge() {
    let (mut tb, u) = bataille(dict! {"ligne" => 1});
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    face_a_face(&mut tb, &L, &cible, 80.0); // déjà à portée de salve : on ne teste que « tirer puis charger »
    assert!(ordre(&mut tb, &L, "volley_charge", dict! {"target" => cible.at("id")}).0);
    ordre(&mut tb, &L, "fire", dict! {"mode" => "hold"}); // « cessez le feu » donné ensuite : la salve part quand même
    avancer_jusqua(&mut tb, 120.0, |_| kind(&L) != "volley_charge");
    assert_eq!(kind(&L), "charge");
}

/// (les ennemis restent sur place : on ne mesure que l'approche)
fn ennemis_immobiles(tb: &TacticalBattle, cible: &Val) {
    for x in tb.units.iter() {
        if x.at("side") == cible.at("side") {
            x.set("ctrl", "joueur");
        }
    }
}

#[test]
fn attaquer_s_arrete_a_portee_de_tir() {
    let (mut tb, u) = bataille(Val::None);
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    let e = U::ranges(&L).0 as f64;
    face_a_face(&mut tb, &L, &cible, e * 2.5);
    ennemis_immobiles(&tb, &cible);
    assert!(ordre(&mut tb, &L, "attack", dict! {"target" => cible.at("id")}).0);
    avancer_jusqua(&mut tb, 900.0, |_| !L.at("path").truthy() && TacticalBattle::dist(&L, &cible) < e);
    assert!(TacticalBattle::dist(&L, &cible) < e); // à bonne portée, il fait feu…
    assert!(TacticalBattle::dist(&L, &cible) > e * 0.8); // … sans aller se coller à l'ennemi
}

/// « Bonne portée » : arrêt entre 85 et 95 % de la portée efficace, puis on tient (pas de poursuite) ; « portée
/// max » : arrêt près de la portée maximale. Le profil survit à la sauvegarde.
#[test]
fn profils_d_arret_puis_tenir() {
    for (stop, lo, hi) in [("bonne", 0.85, 0.95), ("max", 0.88, 1.0)] {
        let (mut tb, u) = bataille(Val::None);
        let L = u.at("ligne");
        let cible = ennemi(&tb, &L, None);
        let (e, mx, _) = U::ranges(&L);
        let (e, mx) = (e as f64, mx as f64);
        let rf = if stop == "bonne" { e } else { mx };
        face_a_face(&mut tb, &L, &cible, e * 2.5);
        ennemis_immobiles(&tb, &cible);
        assert!(ordre(&mut tb, &L, "stop", dict! {"mode" => stop}).0, "profil={stop}");
        assert!(ordre(&mut tb, &L, "attack", dict! {"target" => cible.at("id")}).0, "profil={stop}");
        assert_eq!(L.at("order").get("stop"), stop, "profil={stop}");
        avancer_jusqua(&mut tb, 900.0, |_| !L.at("path").truthy() && L.atf("busy") <= 0.0 && TacticalBattle::dist(&L, &cible) < mx * 1.1);
        let d = TacticalBattle::dist(&L, &cible);
        assert!(lo * rf <= d && d <= hi * rf, "profil={stop} : {d} pour {rf}");
        // la cible recule (elle reste en vue) : on ne la poursuit pas
        let pos = (L.atf("x"), L.atf("y"));
        face_a_face(&mut tb, &L, &cible, d + 120.0);
        avancer(&mut tb, 120.0);
        assert!(py::hypot(L.atf("x") - pos.0, L.atf("y") - pos.1) < 5.0, "profil={stop}");
        assert_eq!(kind(&L), "attack", "profil={stop}");
        let tb2 = recharge(&tb);
        let l2 = tb2.by_id.at(L.at("id"));
        assert_eq!((l2.at("stop"), l2.at("order").get("stop")), (Val::from(stop), Val::from(stop)), "profil={stop}");
    }
}

/// L'ordre du joueur corrige sa marche si la cible recule avant l'arrivée : il arrive à portée, pas avant.
#[test]
fn la_cible_recule_pendant_l_approche() {
    let (mut tb, u) = bataille(Val::None);
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    let e = U::ranges(&L).0 as f64;
    face_a_face(&mut tb, &L, &cible, e * 3.0);
    ennemis_immobiles(&tb, &cible);
    assert!(ordre(&mut tb, &L, "attack", dict! {"target" => cible.at("id")}).0);
    avancer(&mut tb, 30.0);
    assert!(L.at("path").truthy());
    let d = TacticalBattle::dist(&L, &cible) + 200.0;
    face_a_face(&mut tb, &L, &cible, d);
    avancer_jusqua(&mut tb, 1200.0, |_| !L.at("path").truthy() && L.atf("busy") <= 0.0);
    let d = TacticalBattle::dist(&L, &cible);
    assert!(0.8 * e <= d && d <= e, "{d} {e}");
}

#[test]
fn zones_de_tir_dans_la_vue() {
    let (tb, u) = bataille(Val::None);
    let v = vue_par_id(&tb.view(&Val::None, 0));
    let vl = v.at(u.at("ligne").at("id"));
    let z = vl.at("zones");
    assert_eq!(z.iter().map(|k| k.at(0)).collect::<Val>(), list!["bout", "efficace", "longue"]);
    assert_eq!(z.at(-1).at(2), vl.at("range").at(1));
    assert!(z.at(0).atf(3) > z.at(1).atf(3) && z.at(1).atf(3) > z.at(2).atf(3)); // plus loin, moins d'effet
    assert_eq!(v.at(u.at("artillerie").at("id")).at("zones").at(0).at(0), "mitraille");
}

#[test]
fn harceler_passe_en_tirailleurs() {
    let (mut tb, u) = bataille(dict! {"legere" => 1});
    assert!(ordre(&mut tb, &u.at("legere"), "harass", nul()).0);
    avancer(&mut tb, 60.0);
    assert_eq!(u.at("legere").at("form"), "tirailleurs");
}

#[test]
fn artillerie_sans_munitions_au_repos() {
    let (mut tb, u) = bataille(dict! {"artillerie" => 1});
    let A = u.at("artillerie");
    regle!(A, state = "feu", ammo = 0);
    avancer(&mut tb, 10.0);
    assert!(A.at("state") != "feu" && A.at("state") != "recharge");
}

#[test]
fn regiment_aneanti_ne_revient_pas() {
    let (mut tb, u) = bataille(dict! {"ligne" => 1});
    let L = u.at("ligne");
    tb._damage(&L, L.atf("men") - 6.0, &Val::None, "feu"); // 6 hommes : « anéanti »
    assert_eq!(L.at("state"), "hors");
    assert_eq!(L.at("men"), 0);
}

// ==================================================================================================== NomsDesRegiments
#[test]
fn la_cavalerie_a_ses_dragons_de_1760_a_1860() {
    // (étape 8 : les dragons portent l'habit vert ; il en faut dans les vraies batailles, pas seulement la maquette)
    let (tb, _) = bataille_ex(dict! {"cavalerie" => 3}, "1790", "33", "24", true, 1);
    let mut noms: Vec<String> = tb.units.iter().filter(|x| x.at("owner") == "33" && x.at("type") == "cavalerie").map(|x| x.ats("name")).collect();
    noms.sort();
    assert_eq!(noms, ["1er dragons", "2e ch. à cheval", "3e hussards"]);
    for ep in ["1700", "1870"] {
        let (tb, _) = bataille_ex(dict! {"cavalerie" => 1}, ep, "33", "24", true, 1);
        assert!(tb.units.iter().filter(|x| x.at("owner") == "33" && x.at("type") == "cavalerie").all(|x| x.ats("name").contains("Cavalerie")), "{ep}");
    }
}

// ==================================================================================================== BatailleEntiere
#[test]
fn jusqu_au_bout_puis_rechargement() {
    let (mut tb, _u) = bataille(dict! {"ligne" => 2, "cavalerie" => 1, "artillerie" => 1});
    tb.autofinish();
    tb.run_to_end();
    assert_eq!(tb.phase, "fin");
    for x in tb.units.iter() {
        let men = x.atf("men");
        assert!(!(x.at("state") == "hors" && 0.0 < men && men < 8.0 && x.atf("lost") > x.atf("men0") / 2.0), "{} {}", x.at("name"), men);
    }
    let tb2 = recharge(&tb);
    assert_eq!(tb2.phase, "fin");
}

#[test]
fn rechargement_en_plein_combat() {
    let (mut tb, u) = bataille(Val::None);
    let cible = ennemi(&tb, &u.at("ligne"), None);
    face_a_face(&mut tb, &u.at("ligne"), &cible, 300.0);
    ordre(&mut tb, &u.at("ligne"), "volley_charge", dict! {"target" => cible.at("id")});
    let mut tb2 = recharge(&tb);
    avancer(&mut tb2, 20.0); // la bataille reprend sans erreur
    assert!(tb2.phase == "combat" || tb2.phase == "fin");
    assert_eq!(BT::DT, 2.0);
}

// ==================================================================================================== BoueEnregistree
// La boue laissée par les troupes (SPEC-SUITE F8) : le navigateur l'envoie, la sauvegarde la garde.
const PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";

#[test]
fn la_boue_suit_la_sauvegarde() {
    let (mut tb, _u) = bataille(Val::None);
    assert!(BT::valid_piet(&Val::from(PNG)));
    assert!(!BT::valid_piet(&Val::from("data:text/html;base64,AAAA")));
    assert!(!BT::valid_piet(&Val::from(format!("data:image/png;base64,{}", "A".repeat(BT::PIET_MAX as usize)))));
    tb.piet = Val::from(PNG);
    let tb2 = recharge(&tb);
    assert_eq!(tb2.piet, PNG);
    assert_eq!(tb2.map_view().at("piet"), PNG);
    let old = tb.to_dict();
    old.pop("piet");
    let t3 = TacticalBattle::from_dict(geo(), &par_json(&old)).unwrap();
    assert!(t3.piet.is_none(), "ancienne sauvegarde : un sol neuf");
    assert!(!t3.map_view().has("piet"));
}

// ==================================================================================================== MarquesVisibles
// SPEC-TECH.md, module visuels : la bataille reçoit les marques de chaque camp et l'arme de chaque régiment.

#[test]
fn marques_d_un_camp() {
    assert!(R::marks(&list!["lebel", "gras"]).has("sans_fumee"));
    assert!(!R::marks(&list!["gras"]).has("sans_fumee"));
    assert_eq!(R::marks(&list![]), list![]);
}

#[test]
fn la_spec_porte_les_marques_des_deux_camps() {
    let (tb, _) = bataille_ex(Val::None, "1870", "33", "24", true, 1);
    let m = tb.spec.at("marks");
    assert_eq!(m.len(), 2);
    assert!(m.at(0).has("reffye"), "en 1870, la mitrailleuse est connue (techs_before 1866)");
    assert!(!m.at(0).has("sans_fumee"), "pas encore de poudre B en 1870");
    assert_eq!(tb.map_view().at("marks"), m, "le client les lit avec la carte");
}

#[test]
fn la_vue_porte_l_arme_de_chaque_unite() {
    let (tb, mes) = bataille_ex(Val::None, "1870", "33", "24", true, 1);
    let vue = vue_par_id(&tb.view(&Val::from(0), 0));
    let l = mes.at("ligne");
    assert_eq!(vue.at(l.at("id")).at("arm"), l.at("arm"));
    assert!(l.ati("arm") > 0, "en 1870, la ligne a mieux que le mousquet");
}

// ==================================================================================================== DynamiteALAssaut
// SPEC-TECH.md : à l'assaut, la dynamite de l'assaillant ouvre une brèche de plus dans les remparts.

fn breches(annee_dynamite: i64) -> Vec<Val> {
    // (en 1870, dynamite connue ou non)
    let (_g, tb) = avec_tech_year(&[("dynamite", annee_dynamite)], || {
        escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1870", "kind" => "forteresse", "role" => "att", "seed" => 3,
        "units" => dict!{"ligne" => 2, "artillerie" => 1}})
    });
    tb.map_view().at("walls").iter().flat_map(|w| w.at("breach").iter().collect::<Vec<Val>>()).collect()
}

#[test]
fn une_place_intacte_a_une_breche_avec_la_dynamite() {
    assert!(breches(1867).is_empty(), "place intacte, pas de dynamite : pas de brèche");
    assert_eq!(breches(1860).len(), 1);
}

// ==================================================================================================== TechnologiesEnBataille
// SPEC-TECH.md : ballon des aérostiers, retranchements, obus à la mélinite.

#[test]
fn le_ballon_voit_a_1500_metres_du_general() {
    let (mut tb, mes) = bataille(Val::None);
    let gs = mes.at("ligne").at("side");
    let gen = tb.units.iter().find(|u| u.at("side") == gs && u.at("cls") == "general").unwrap();
    let foe = ennemi(&tb, &mes.at("ligne"), Some("inf"));
    tb.weather = "brouillard".to_string();
    regle!(foe, x = gen.atf("x") + 1200.0, y = gen.atf("y"));
    for u in tb.units.iter() {
        if u.at("side") == gs && !u.is(&gen) {
            regle!(u, x = gen.atf("x") - 3000.0, y = gen.atf("y")); // (personne d'autre pour voir)
        }
    }
    tb._update_vision();
    assert!(!tb.seen_by.at(&gs).has(foe.at("id")), "dans le brouillard, à 1 200 m, on ne le voit pas");
    tb.spec.set("balloon", list![1500, 1500]);
    tb._update_vision();
    assert!(tb.seen_by.at(&gs).has(foe.at("id")), "le ballon, si");
    gen.set("wounded", true);
    tb._update_vision();
    assert!(!tb.seen_by.at(&gs).has(foe.at("id")), "général blessé : plus d'observateur");
}

#[test]
fn l_infanterie_arretee_se_retranche() {
    let (tb, mes) = bataille(Val::None);
    let (u, foe) = (mes.at("ligne"), ennemi(&tb, &mes.at("ligne"), Some("inf")));
    tb.spec.set("entrench", list![0.25, 0.25]);
    u.set("still_t", tb.clock - 400.0);
    presque(tb._entrench_k(&u, &foe), 0.75, 7, "retranchée");
    u.set("still_t", tb.clock - 100.0);
    assert_eq!(tb._entrench_k(&u, &foe), 1.0, "arrêtée depuis moins de cinq minutes");
    u.set("still_t", tb.clock - 400.0);
    tb.spec.set("entrench", list![0.0, 0.0]);
    assert_eq!(tb._entrench_k(&u, &foe), 1.0, "sans la technologie");
}

#[test]
fn la_melinite_perce_le_couvert() {
    let (tb, mes) = bataille(Val::None);
    let (art, foe) = (mes.at("artillerie"), ennemi(&tb, &mes.at("artillerie"), Some("inf")));
    tb.spec.set("entrench", list![0.25, 0.25]);
    foe.set("still_t", tb.clock - 400.0);
    let cov = tb._cover_vs(&foe, &art);
    tb.spec.set("shell", list![0.5, 0.5]);
    presque(tb._fire_cover(&foe, &art), cov * 0.5, 7, "couvert percé");
    presque(tb._entrench_k(&foe, &art), 1.0 - 0.25 * 0.5, 7, "retranchement percé");
    presque(tb._fire_cover(&foe, &mes.at("ligne")), tb._cover_vs(&foe, &mes.at("ligne")), 7, "pas pour les fusils");
}

#[test]
fn une_charge_defait_le_retranchement() {
    let (mut tb, mes) = bataille(Val::None);
    let (u, foe) = (mes.at("ligne"), ennemi(&tb, &mes.at("ligne"), Some("inf")));
    face_a_face(&mut tb, &u, &foe, 150.0);
    u.set("still_t", -999.0);
    let (ok, why) = ordre(&mut tb, &u, "charge", dict! {"target" => foe.at("id")});
    assert!(ok, "{why}");
    avancer(&mut tb, 5.0);
    assert!(u.atf("still_t") > tb.clock - 10.0, "qui charge ne reste pas enterré");
}

#[test]
fn la_melinite_ne_sert_pas_aux_mitrailleuses() {
    let (tb, mes) = bataille_ex(dict! {"mitrailleuses" => 1}, "1870", "33", "24", true, 1);
    let (m, foe) = (mes.at("mitrailleuses"), ennemi(&tb, &mes.at("mitrailleuses"), None));
    tb.spec.set("shell", list![0.5, 0.5]);
    tb.spec.set("entrench", list![0.25, 0.25]);
    regle!(foe, still_t = tb.clock - 400.0, cls = "inf");
    assert_eq!(tb._fire_cover(&foe, &m), tb._cover_vs(&foe, &m));
    presque(tb._entrench_k(&foe, &m), 0.75, 7, "retranchement");
}

#[test]
fn marques_et_effets_dans_la_spec() {
    let (tb, _) = avec_tech_year(&[("aerostiers", 1700), ("genie", 1700)], || bataille_ex(Val::None, "1790", "33", "24", true, 1));
    assert_eq!(tb.spec.at("balloon"), list![1500, 1500]);
    assert_eq!(tb.spec.at("entrench"), list![0.0, 0.0]);
}

// ==================================================================================================== MitrailleusesEnBataille
// SPEC-TECH.md : six pièces de Reffye, 1 200 et 2 000 m, feu roulant ; redoutables contre l'infanterie à découvert,
// faibles contre les pièces et les remparts.

/// (Python : `pertes(self, typ, cible_cls, distance=1000, secondes=240)`)
fn pertes(typ: &str, cible_cls: &str) -> (f64, f64) {
    let (distance, secondes) = (1000.0, 240.0);
    let mes = dict! {};
    mes.set(typ, 1);
    let (mut tb, mes) = bataille_ex(mes, "1870", "33", "24", true, 2);
    let u = mes.at(typ);
    let cible = ennemi(&tb, &u, None);
    if cible_cls == "artillerie" {
        // (la cible fabriquée : une batterie de huit pièces, ou une ligne de 300 hommes)
        cible.set("type", "artillerie");
        regle!(cible, cls = "artillerie", form = "batterie", men = 120.0);
    } else {
        cible.set("type", "ligne");
        regle!(cible, cls = "inf", form = "ligne", men = 300.0);
    }
    cible.set("men0", cible.at("men"));
    tb.ai_sides = list![];
    for x in tb.units.iter() {
        if !x.is(&u) {
            regle!(x, fire_mode = "hold", ctrl = "joueur");
        }
    }
    let mut vue = false;
    for da in [0.0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2] {
        let a = u.atf("dir") + da;
        regle!(cible, x = u.atf("x") + a.cos() * distance, y = u.atf("y") + a.sin() * distance, dir = a + PI);
        tb._update_vision();
        if tb.seen_by.at(u.at("side")).has(cible.at("id")) && tb.los_units(&u, &cible) {
            vue = true;
            break;
        }
    }
    assert!(vue, "pas de vue dégagée à cette distance");
    let (avant, munitions) = (cible.atf("men"), u.atf("ammo"));
    avancer(&mut tb, secondes);
    (avant - cible.atf("men"), munitions - u.atf("ammo"))
}

#[test]
fn six_pieces_et_leurs_portees() {
    let (_tb, mes) = bataille_ex(dict! {"mitrailleuses" => 1}, "1870", "33", "24", true, 1);
    let u = mes.at("mitrailleuses");
    assert_eq!(u.at("cls"), "artillerie");
    assert_eq!(U::pieces(&u), 6);
    let (e, m, g) = U::ranges(&u);
    assert_eq!((e, m), (1200, 2000));
    assert!(g.is_none());
}

#[test]
fn contre_une_ligne_plus_que_les_canons() {
    let (m, mun_m) = pertes("mitrailleuses", "inf");
    let (c, mun_c) = pertes("artillerie", "inf");
    assert!(m > c, "contre une ligne en plaine, à 1 000 m");
    assert!(mun_m > mun_c, "les munitions fondent plus vite");
}

#[test]
fn contre_une_batterie_moins_que_les_canons() {
    let (m, _) = pertes("mitrailleuses", "artillerie");
    let (c, _) = pertes("artillerie", "artillerie");
    assert!(m < c);
}

// ==================================================================================================== ValeursChiffrees
// Les valeurs chiffrées de la fiche du régiment (tactics/stats.rs), à la manière d'Empire: Total War : les chiffres
// disent la vérité. Deux fois plus en Précision ou en Mêlée, deux fois plus de pertes infligées, sur le moteur
// lui-même (_fire, _melee_k), le tir ramené au bout portant par la courbe de distance propre à chaque arme.

/// (Python : setUp) La bataille, la ligne et sa cible à 80 m.
fn chiffrees() -> (Box<TacticalBattle>, Val, Val) {
    let (mut tb, u) = bataille(Val::None);
    let l = u.at("ligne");
    let c = ennemi(&tb, &l, Some("inf"));
    face_a_face(&mut tb, &l, &c, 80.0);
    (tb, l, c)
}

/// (Python : `tir(self, xp, typ='ligne', arm=1)`)
fn tir(tb: &mut TacticalBattle, l: &Val, c: &Val, xp: i64, typ: &str, arm: i64) -> f64 {
    regle!(l, xp = xp, arm = arm);
    l.set("type", typ);
    regle!(l, fat = 0.0, reload = 0.0, state = "repos", ammo = 60.0, morale = 80.0, form = "ligne");
    regle!(l, target = c.at("id"), order = dict! {"kind" => "attack", "target" => c.at("id")}, fire_mode = "free");
    regle!(c, men = 500.0, state = "repos", morale = 80.0);
    tb.smoke.iter_mut().for_each(|s| *s = 0.0); // (l'air clair à chaque essai : la fumée de la salve d'avant fausserait la mesure)
    tb._fire(l, 2.0, false);
    // la Précision affichée vaut au bout portant : on y ramène le tir (la demi-justesse D50 change avec l'arme)
    (500.0 - c.atf("men")) / U::precision(l, TacticalBattle::dist(l, c))
}

/// `ST.stats(typ, arm, xp, mods=…)` avec les autres défauts du Python.
fn stats(typ: &str, arm: i64, xp: f64, mods: &Val) -> Val {
    ST::stats(typ, &Val::from(arm), xp, &Val::None, false, 0.0, mods)
}
fn somme2(v: &Val) -> f64 {
    v.atf(0) + v.atf(1)
}

fn pre(xp: i64, typ: &str, arm: i64) -> f64 {
    somme2(&stats(typ, arm, xp as f64, &Val::None).at("pre"))
}

#[test]
fn la_precision_dit_vrai() {
    let (mut tb, l, c) = chiffrees();
    let p0 = tir(&mut tb, &l, &c, 0, "ligne", 1);
    assert!(p0 > 0.0, "la ligne doit tirer");
    for ((xa, ta, aa), (xb, tb_, ab)) in [((100, "ligne", 1), (0, "ligne", 1)), ((0, "legere", 1), (0, "ligne", 1)), ((0, "ligne", 4), (0, "ligne", 1))] {
        let quoi = format!("a={:?} b={:?}", (xa, ta, aa), (xb, tb_, ab));
        let vrai = tir(&mut tb, &l, &c, xa, ta, aa) / tir(&mut tb, &l, &c, xb, tb_, ab);
        // (rapport des totaux non arrondis)
        let f = |x: i64, t: &str, a: i64| ST::K * U::TYPE().at(t).atf("fire") * py::pow(R::ARMS().at("inf").at(a).atf(2), 0.5) * ST::xp_k(x as f64);
        let (fa, fb) = (f(xa, ta, aa), f(xb, tb_, ab));
        proche(vrai, fa / fb, 0.02 * fa / fb, &quoi);
        proche(pre(xa, ta, aa) / pre(xb, tb_, ab), fa / fb, 0.04 * fa / fb, &quoi);
    }
}

#[test]
fn la_melee_dit_vrai() {
    let (mut tb, l, c) = chiffrees();
    regle!(l, fat = 0.0, morale = 80.0, form = "ligne");
    l.set("type", "ligne");
    l.set("xp", 0);
    let k0 = tb._melee_k(&l, &c);
    l.set("type", "grenadiers");
    l.set("xp", 100);
    let k1 = tb._melee_k(&l, &c);
    let m = |typ: &str, xp: f64| somme2(&stats(typ, 1, xp, &Val::None).at("mel"));
    presque(k1 / k0, 2.25, 3, "mêlée du moteur");
    proche(m("grenadiers", 100.0) / m("ligne", 0.0), 2.25, 0.05, "mêlée de la fiche");
}

#[test]
fn le_rechargement_est_celui_du_moteur() {
    for typ in U::TYPE().keys() {
        let typ = typ.string();
        let cls = U::cls_of(&typ);
        for arm in 0..8 {
            let s = stats(&typ, arm, 50.0, &Val::None);
            if !s.has("rec") {
                continue;
            }
            let u = U::Unit(&dict! {"type" => typ.as_str(), "cls" => cls.as_str(), "arm" => arm, "xp" => 50});
            assert_eq!(py::sum_v(s.at("rec").iter()).f(), py::round(U::reload_time(&u)) as f64, "typ={typ} arm={arm}");
        }
    }
}

#[test]
fn toutes_les_armes() {
    let (mut tb, l, _c) = chiffrees();
    for typ in U::TYPE().keys() {
        let typ = typ.string();
        let cls = U::cls_of(&typ);
        for arm in 0..8 {
            let quoi = format!("typ={typ} arm={arm}");
            let s = stats(&typ, arm, 0.0, &Val::None);
            for k in ["mel", "vit", "dis"] {
                assert!(s.has(k), "{quoi} {k}");
            }
            let tire = typ != "general" && typ != "chariot";
            for k in ["pre", "rec", "por", "mun"] {
                assert_eq!(s.has(k), tire, "{quoi} {k}");
            }
            assert_eq!(s.has("chg"), cls == "inf" || cls == "cavalerie", "{quoi}");
            assert_eq!(s.has("car"), cls == "inf", "{quoi}");
            for (k, v) in s.items() {
                if !["por", "jus", "mun"].contains(&k.s()) {
                    assert_eq!(v.at(1), 0, "{quoi} {k}"); // une recrue : aucun bonus d'expérience
                }
            }
            let v = ST::stats(&typ, &Val::from(arm), 100.0, &Val::from("audacieux"), false, 0.0, &Val::None);
            assert_eq!(v.at("dis").at(1), 0, "{quoi}");
            if v.has("chg") {
                assert_eq!(v.at("chg").at(1), 0, "{quoi}");
            }
            if typ != "chariot" {
                // (le chariot : 8 % de 10, l'arrondi l'efface)
                assert!(v.at("mel").atf(2) > 0.0, "{quoi}");
            }
        }
    }
    // (le Python remplace tb.trait par un mock ; ici, le trait que la bataille garde en mémoire est posé)
    tb._traits = list!["audacieux", "audacieux"];
    assert!(ST::of_unit(&l, &mut tb).at("mel").atf(2) > 0.0);
    tb._traits = list![Val::None, Val::None]; // le général blessé : plus rien
    assert!(ST::of_unit(&l, &mut tb).items().iter().filter(|(k, _)| !["por", "jus", "mun"].contains(&k.s())).all(|(_, v)| v.at(2) == 0));
}

#[test]
fn la_vue_de_bataille() {
    let (mut g, bid) = escarmouche_g(&dict! {"me" => "33", "foe" => "24", "era" => "1790", "units" => dict!{"ligne" => 1, "cavalerie" => 1}, "seed" => 1});
    tb(&mut g).start();
    let v = TB::battle_view(&mut g, &Val::from(bid.as_str()), 0);
    let me = tb(&mut g).me.clone();
    let mes: Vec<Val> = v.at("units").iter().filter(|d| d.at("side") == me).collect();
    let autres: Vec<Val> = v.at("units").iter().filter(|d| d.at("side") != me).collect();
    assert!(!mes.is_empty() && mes.iter().all(|d| d.has("stats") && d.at("stats").has("mel")));
    assert!(autres.iter().all(|d| !d.has("stats")));
    json::dumps_compact(&v); // (le serveur l'envoie tel quel)
}

// ==================================================================================================== JustesseDuFeu
// Le feu est d'autant plus juste qu'on est près : à 90 % de la portée efficace, bien moins qu'à 30 m.

#[test]
fn plus_juste_de_pres_pour_chaque_arme() {
    for (arm, &(e, mx)) in U::INF_RANGE.iter().enumerate() {
        let u = U::Unit(&dict! {"type" => "ligne", "cls" => "inf", "arm" => arm as i64});
        let quoi = format!("arme={}", R::ARMS().at("inf").at(arm as i64).at(1));
        let (e, mx) = (e as f64, mx as f64);
        let p: Vec<f64> = [0.0, 30.0, 0.9 * e, e, 1.3 * e, mx].iter().map(|&d| U::precision(&u, d)).collect();
        assert_eq!(p[0], 1.0, "{quoi}");
        assert!(p.windows(2).all(|w| w[0] >= w[1]), "{quoi}"); // toujours moins juste en s'éloignant
        assert!(p[1] > 2.0 * p[2], "{quoi}"); // deux fois plus juste à 30 m qu'à 90 % de la portée efficace
    }
}

// ==================================================================================================== DefenseVivante
// Le défenseur en rase campagne (l'IA, camp 1, au niveau normal) : contre-attaques locales sur l'assaillant qui
// flotte, cavalerie sur les troupes désorganisées, écran de tirailleurs, retour offensif, arrière-garde.

/// (Python : la méthode DefenseVivante.defense et ses fonctions pense, a_moi, a_lui)
struct Defense {
    tb: Box<TacticalBattle>,
    mem: Val,
    mes: Vec<Val>,
}

impl Defense {
    /// (Python : `defense(self, era='1813', seed=1)`)
    fn new(era: &str, seed: i64) -> Defense {
        let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => era, "units" => dict!{"ligne" => 2, "legere" => 1, "cavalerie" => 1},
        "seed" => seed, "role" => "att"});
        tb.start();
        let mem = tb.ai_mem.at("s1");
        regle!(mem, plan = "tenir", mode = "poste");
        let mes: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 0 && U::alive(u)).collect();
        let z = tb.ai_zone(0);
        for (k, u) in mes.iter().enumerate() {
            // (le joueur au fond de sa zone, loin de tout)
            regle!(u, x = (z.atf(0) + z.atf(2)) / 2.0 + 40.0 * k as f64, y = (z.atf(1) + z.atf(3)) / 2.0);
        }
        tb._update_vision();
        Defense { tb, mem, mes }
    }
    fn pense(&mut self) {
        regle!(self.mem, next = 0.0, rnext = 0.0);
        AI::think(&mut self.tb, 1, 2.0);
    }
    fn a_moi(&self, cls: &str, light: bool) -> Val {
        self.mes.iter().find(|u| u.at("cls") == cls && u.at("light").truthy() == light).unwrap().clone()
    }
    fn a_lui(&self, role: &str) -> Val {
        self.tb.units.iter().find(|u| u.at("side") == 1 && self.mem.at("role").get(u.at("id")) == role && U::valid(u)).unwrap()
    }
}

fn journal_dit(mem: &Val, texte: &str) -> bool {
    mem.at("journal").iter().any(|n| n.at(1).s().contains(texte))
}

#[test]
fn contre_attaque_sur_un_bataillon_ebranle() {
    let mut d = Defense::new("1813", 1);
    let (u, e) = (d.a_lui("ligne"), d.a_moi("inf", false));
    u.set("morale", 80.0);
    e.set("men", u.at("men"));
    face_a_face(&mut d.tb, &u, &e, 140.0);
    e.set("morale", 85.0);
    d.pense();
    assert_ne!(u.at("state"), "charge"); // une ligne fraîche, munitions pleines : on la fusille
    e.set("morale", 38.0);
    d.pense();
    assert_eq!((u.at("state"), u.at("target")), (Val::from("charge"), e.at("id")));
    assert!(journal_dit(&d.mem, "contre-attaque"));
    e.set("state", "deroute");
    d.pense();
    let p = d.mem.at("post").at(u.at("id"));
    assert_eq!(u.at("order").get("kind"), "move"); // pas de poursuite : il reprend sa place
    assert!((u.at("goal").atf(0) - p.atf(0)).abs() + (u.at("goal").atf(1) - p.atf(1)).abs() < 1.0);
}

#[test]
fn contre_attaque_courte_1870() {
    // (Python : test_1870_contre_attaque_courte ; un nom Rust ne commence pas par un chiffre)
    let mut d = Defense::new("1870", 1);
    let (u, e) = (d.a_lui("ligne"), d.a_moi("inf", false));
    u.set("morale", 80.0);
    e.set("men", u.at("men"));
    face_a_face(&mut d.tb, &u, &e, 150.0);
    e.set("morale", 45.0);
    d.pense();
    assert_ne!(u.at("state"), "charge"); // trop loin pour sortir de son couvert sous le fusil rayé
    u.set("busy", 0.0); // (il a fini de se déployer en tirailleurs)
    face_a_face(&mut d.tb, &u, &e, 90.0);
    regle!(e, morale = 35.0, men = py::round(0.45 * e.atf("men0"))); // ébranlé et décimé, à bout portant
    d.pense();
    assert_eq!((u.at("state"), u.at("target")), (Val::from("charge"), e.at("id")));
}

#[test]
fn cavalerie_sur_troupe_en_marche() {
    for (era, form, charge) in [("1813", "ligne", true), ("1813", "carre", false), ("1870", "ligne", false)] {
        let mut d = Defense::new(era, 1);
        let (c, e) = (d.a_lui("cav"), d.a_moi("inf", false));
        face_a_face(&mut d.tb, &c, &e, 300.0);
        regle!(e, state = "marche", form = form, morale = 80.0);
        e.set("dir", (c.atf("y") - e.atf("y")).atan2(c.atf("x") - e.atf("x")) + PI / 2.0); // elle prête le flanc
        d.pense();
        assert_eq!(c.at("state") == "charge" && c.at("target") == e.at("id"), charge, "époque={era} formation={form}");
    }
}

#[test]
fn cavalerie_sur_colonne_qui_charge() {
    let mut d = Defense::new("1813", 1);
    let (c, u, e) = (d.a_lui("cav"), d.a_lui("ligne"), d.a_moi("inf", false));
    face_a_face(&mut d.tb, &u, &e, 160.0);
    let h = py::hypot(c.atf("x") - e.atf("x"), c.atf("y") - e.atf("y"));
    if h > 450.0 {
        let (cx, cy) = (e.atf("x") + (c.atf("x") - e.atf("x")) * 400.0 / h, e.atf("y") + (c.atf("y") - e.atf("y")) * 400.0 / h);
        regle!(c, x = cx, y = cy);
        d.tb._update_vision();
    }
    d.tb.order(0, &ids(&e), "charge", "any", &dict! {"target" => u.at("id")});
    d.pense();
    assert_eq!((c.at("state"), c.at("target")), (Val::from("charge"), e.at("id")));
}

#[test]
fn ecran_de_tirailleurs() {
    let mut d = Defense::new("1813", 4); // (une graine où l'IA a des légers)
    let (lt, e) = (d.a_lui("avant"), d.a_moi("inf", false));
    let mem = d.mem.clone();
    let p = mem.at("post").at(lt.at("id"));
    assert!(AI::_rel(p.atf(0), p.atf(1), mem.atf("ax"), mem.atf("ay"), mem.atf("fd")).0 >= 1.4 * d.tb.ranges(&lt).0 as f64);
    regle!(lt, x = p.at(0), y = p.at(1));
    e.set("form", "ligne");
    face_a_face(&mut d.tb, &lt, &e, 150.0);
    d.pense();
    assert_eq!(mem.at("scr").at(lt.at("id")).at(0), 1); // il recule d'un palier
    let z = d.tb.ai_zone(0);
    regle!(e, x = (z.atf(0) + z.atf(2)) / 2.0, y = (z.atf(1) + z.atf(3)) / 2.0);
    d.tb._update_vision();
    mem.set("phase", "combat");
    d.tb.clock += 160.0;
    d.pense();
    assert_eq!(mem.at("scr").at(lt.at("id")).at(0), 0); // l'assaut a reflué : il revient
}

#[test]
fn retour_offensif_et_arret() {
    let mut d = Defense::new("1813", 1);
    let mem = d.mem.clone();
    let mes: Vec<Val> = d.tb.units.iter().filter(|u| u.at("side") == 0 && U::alive(u) && (u.at("cls") == "inf" || u.at("cls") == "cavalerie")).collect();
    let u = d.a_lui("ligne");
    for (k, e) in mes.iter().enumerate() {
        // (en vue, à 400 m : l'assaut est venu, puis il a reflué)
        face_a_face(&mut d.tb, &u, e, 400.0 + 30.0 * k as f64);
        regle!(e, morale = 50.0, men = py::round(0.6 * e.atf("men0")));
    }
    mes[0].set("state", "deroute");
    mem.update(&dict! {"phase" => "combat", "pressed" => 1, "near_t" => d.tb.clock - 400.0, "t_contact" => 0});
    d.pense();
    assert_eq!(mem.at("plan"), "frontal");
    assert!(mem.has("ro"));
    for v in d.tb.units.iter() {
        if v.at("side") == 1 && ["inf", "cavalerie", "artillerie"].contains(&v.ats("cls").as_str()) {
            v.set("men", py::round(v.atf("men") * 0.9));
        }
    }
    d.pense();
    assert_eq!((mem.at("plan"), mem.at("mode")), (Val::from("tenir"), Val::from("poste")));
    assert!(!mem.has("ro"));
}

#[test]
fn arriere_garde() {
    let mut d = Defense::new("1813", 1);
    d.tb.withdraw(1);
    d.pense();
    let rg: Vec<Val> = d.mem.get("rg").or(list![]).iter().collect();
    assert!(1 <= rg.len() && rg.len() <= 3);
    assert!(rg.iter().all(|i| d.tb.unit(i).at("order").get("kind") != "retreat"));
    d.tb.clock += 620.0;
    d.pense();
    assert!(rg.iter().all(|i| d.tb.unit(i).at("order").get("kind") == "retreat"));
}

#[test]
fn memoire_json() {
    for era in ["1700", "1790", "1813", "1870"] {
        let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => era, "units" => dict!{"ligne" => 2, "legere" => 1, "cavalerie" => 1},
        "seed" => 1, "role" => "att"});
        tb.autofinish();
        tb.run_to_end();
        json::dumps_compact(&tb.ai_mem);
    }
}

// ==================================================================================================== IAAttaqueRaseCampagne
// L'assaillant en rase campagne (l'IA, camp 0, troupes tirées au sort) : ordre selon l'époque, ligne hors du feu du
// Chassepot, point de rupture et grande batterie, masse jetée sur le point, poursuite par la cavalerie, bonds par
// moitiés en 1870.

/// (Python : la méthode IAAttaqueRaseCampagne.attaque et ses fonctions pense, a_moi, a_lui)
struct Attaque {
    tb: Box<TacticalBattle>,
    mem: Val,
    lui: Vec<Val>,
}

impl Attaque {
    /// (Python : `attaque(self, era='1813', units=None, lvl='normal')`)
    fn new(era: &str, units: Val, lvl: &str) -> Attaque {
        let units = if units.truthy() { units } else { dict! {"ligne" => 3, "legere" => 1, "cavalerie" => 2, "artillerie" => 2} };
        let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => era, "seed" => 1, "role" => "def", "units" => units});
        tb.spec.set("ai_levels", list![lvl, "normal"]);
        AI::deploy(&mut tb, 0);
        tb.start();
        let mem = tb.ai_mem.at("s0");
        let lui: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 1 && U::alive(u)).collect();
        let z = tb.ai_zone(1);
        for (k, u) in lui.iter().enumerate() {
            // (le défenseur au fond de sa zone, loin de tout)
            regle!(u, x = (z.atf(0) + z.atf(2)) / 2.0 + 40.0 * k as f64, y = (z.atf(1) + z.atf(3)) / 2.0);
        }
        tb._update_vision();
        Attaque { tb, mem, lui }
    }
    fn pense(&mut self, n: i64) {
        for _ in 0..n {
            regle!(self.mem, next = 0.0, rnext = 0.0);
            AI::think(&mut self.tb, 0, 2.0);
        }
    }
    fn a_moi(&self, role: &str) -> Val {
        self.tb.units.iter().find(|u| u.at("side") == 0 && self.mem.at("role").get(u.at("id")) == role && U::valid(u)).unwrap()
    }
    fn a_lui(&self, cls: &str, light: bool) -> Val {
        self.lui.iter().find(|u| u.at("cls") == cls && u.at("light").truthy() == light).unwrap().clone()
    }
}

#[test]
fn pas_d_ordre_disperse_avant_le_fusil_raye() {
    for (era, forme) in [("1790", "ligne"), ("1870", "tirailleurs")] {
        let a = Attaque::new(era, Val::None, "normal");
        let u = a.a_moi("ligne");
        a.mem.set("vu", dict! {});
        let L = AI::LEVELS().at("normal");
        assert_eq!(AI::_march_form(&a.tb, &a.mem, &L, &u, u.atf("x"), u.atf("y"), 300.0, false), forme, "époque={era}");
        // (la défense garde ses règles)
        assert_eq!(AI::_march_form(&a.tb, &a.mem, &L, &u, u.atf("x"), u.atf("y"), 250.0, true), if era == "1790" { "ligne" } else { "tirailleurs" }, "époque={era}");
    }
}

#[test]
fn la_ligne_attend_hors_du_chassepot() {
    let mut a = Attaque::new("1870", Val::None, "normal");
    let e = a.a_lui("inf", false);
    let u = a.a_moi("ligne");
    face_a_face(&mut a.tb, &u, &e, 900.0);
    a.pense(6);
    let e_fo = a.tb.ranges(&e).0;
    let mem = &a.mem;
    assert_eq!(mem.at("e_fo"), e_fo);
    let d = AI::_rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd")).0;
    assert!(d > 1.3 * e_fo as f64); // (la ligne attend la préparation hors de portée du fusil ennemi)
    assert!(mem.at("phase") == "marche" || mem.at("phase") == "prepa");
}

#[test]
fn point_de_rupture_et_grande_batterie() {
    let mut a = Attaque::new("1813", Val::None, "normal");
    let e = a.a_lui("inf", false);
    let l = a.a_moi("ligne");
    face_a_face(&mut a.tb, &l, &e, 600.0);
    let mem = a.mem.clone();
    regle!(mem, phase = "prepa", t_phase = a.tb.clock);
    a.pense(1);
    assert!(mem.get("pt").truthy() && mem.get("pt_id").truthy());
    assert_eq!(a.tb.unit(&mem.at("pt_id")).at("cls"), "inf");
    assert!(journal_dit(&mem, "point de rupture"));
    // le feu des batteries s'y concentre (poids pt_k sur les cibles à moins de 260 m du point)
    let tb = &mut a.tb;
    let g = tb.units.iter().find(|o| o.at("side") == 1 && o.at("cls") == "artillerie").unwrap();
    let ee: Vec<Val> = tb.units.iter().filter(|o| o.at("side") == 0 && o.at("cls") == "inf").take(2).collect(); // (le canon du camp 1 sur deux cibles)
    let (e, e2) = (&ee[0], &ee[1]);
    for (k, v) in [e, e2].into_iter().enumerate() {
        face_a_face(tb, &g, v, 300.0);
        let k = k as f64;
        let (x, y) = (v.atf("x") + (k - 0.5) * 600.0 * g.atf("dir").sin(), v.atf("y") - (k - 0.5) * 600.0 * g.atf("dir").cos());
        regle!(v, x = x, y = y);
    }
    if !(tb.los_units(&g, e) && tb.los_units(&g, e2)) {
        println!("sauté : pas de vue sur les deux cibles avec cette graine");
        return;
    }
    for v in [e, e2] {
        mem.set("pt", list![v.at("x"), v.at("y")]);
        assert!(AI::_art_target(tb, &g, &list![e, e2], &list![], &mem, 9e9, 9e9, &Val::from(0), 50.0).is(v));
    }
}

#[test]
fn la_masse_se_jette_sur_le_point() {
    let mut a = Attaque::new("1813", dict! {"ligne" => 4, "grenadiers" => 1, "cavalerie" => 1, "artillerie" => 1}, "normal");
    let mem = a.mem.clone();
    let res: Vec<Val> = a.tb.units.iter().filter(|u| u.at("side") == 0 && mem.at("role").get(u.at("id")) == "res").collect();
    assert!(!res.is_empty());
    let e = a.a_lui("inf", false);
    let l = a.a_moi("ligne");
    face_a_face(&mut a.tb, &l, &e, 300.0);
    e.set("morale", 60.0);
    mem.update(&dict! {"phase" => "combat", "t_phase" => a.tb.clock - 400.0, "pt" => list![e.at("x"), e.at("y")], "pt_id" => e.at("id"), "t_contact" => 0});
    a.pense(1);
    let masse = a.tb.units.iter().filter(|u| u.at("side") == 0 && mem.at("role").get(u.at("id")) == "masse").count();
    assert!(masse > 0);
    assert!(journal_dit(&mem, "assaut de la masse"));
    if res.len() >= 3 {
        assert!(res.iter().any(|u| mem.at("role").get(u.at("id")) == "res")); // (un bataillon gardé pour les trous)
    }
    json::dumps_compact(&a.tb.ai_mem);
}

#[test]
fn la_cavalerie_poursuit() {
    let mut a = Attaque::new("1813", Val::None, "normal");
    let c = a.a_moi("cav");
    let e = a.a_lui("inf", false);
    face_a_face(&mut a.tb, &c, &e, 450.0);
    regle!(e, state = "deroute", morale = 10.0);
    regle!(c, morale = 90.0, fat = 0.0);
    a.pense(1);
    assert!(a.mem.get("pours").or(dict! {}).has(c.at("id")));
    assert_eq!(c.at("state"), "charge");
    let cav = |t: &TacticalBattle| t.units.iter().filter(|u| u.at("side") == 0 && u.at("cls") == "cavalerie").collect::<Vec<Val>>();
    let cavs = cav(&a.tb).iter().filter(|u| u.at("state") == "charge").count();
    assert!(cavs <= 1.max(cav(&a.tb).len() / 2));
}

#[test]
fn bonds_par_moities_en_1870() {
    let mut a = Attaque::new("1870", Val::None, "difficile");
    let L = AI::LEVELS().at("difficile");
    let mem = a.mem.clone();
    let (x0, y0) = (mem.atf("ax"), mem.atf("ay"));
    AI::_advance(&mut a.tb, &mem, &L, &list![], 500.0, &L.at("bound_feu"));
    proche(py::hypot(mem.atf("ax") - x0, mem.atf("ay") - y0), L.atf("bound_feu"), 2.0, "bond");
    let h = mem.at("half");
    a.tb.clock += 200.0;
    AI::_advance(&mut a.tb, &mem, &L, &list![], 500.0, &L.at("bound_feu"));
    assert_eq!(mem.at("half").f(), -h.f()); // (l'autre moitié bondit à son tour)
}

// ==================================================================================================== IAPlaces
// Attaque et défense des places (IA contre IA, troupes tirées au sort) : batterie de brèche, regroupement qui dure,
// place investie puis abandonnée, coupure et contre-attaque dans la brèche, sorties, combats de rue.

/// (Python : `place(self, role='att', lvl='normal')`)
fn place(role: &str, lvl: &str) -> Box<TacticalBattle> {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1790", "kind" => "forteresse", "role" => role, "seed" => 1,
    "units" => dict!{"ligne" => 4, "legere" => 1, "cavalerie" => 1, "artillerie" => 2}});
    tb.spec.set("ai_levels", list![lvl, lvl]);
    tb.autofinish(); // (IA des deux côtés ; le combat commence)
    tb
}

/// (Python : la fonction pense de IAPlaces.place)
fn pense(tb: &mut TacticalBattle, side: i64, n: i64) {
    for _ in 0..n {
        let m = tb.ai_mem.at(format!("s{side}"));
        regle!(m, next = 0.0, rnext = 0.0);
        AI::think(tb, side, 2.0);
    }
}

#[test]
fn ordre_bombard() {
    let mut tb = place("att", "normal");
    let art = tb.units.iter().find(|u| u.at("side") == 0 && u.at("cls") == "artillerie" && u.at("type") != "mitrailleuses").unwrap();
    let inf = tb.units.iter().find(|u| u.at("side") == 0 && u.at("cls") == "inf").unwrap();
    art.set("ctrl", "joueur"); // (l'IA ne les commande plus ; en accéléré, l'ordre passe par who='any')
    inf.set("ctrl", "joueur");
    let pl = tb.place_info();
    assert!(!tb.order(0, &ids(&inf), "bombard", "any", &dict! {"x" => pl.at("x"), "y" => pl.at("y")}).0);
    // la batterie à bonne portée du rempart : elle bat ce pan, et lui seul
    let w = tb.map.walls.iter().find(|w| w.get("kind") != "barricade").unwrap();
    let mut best: Option<(f64, f64, f64)> = None; // (min : le premier gagne)
    for q in w.at("pts").iter() {
        let d = py::hypot(q.atf(0) - art.atf("x"), q.atf(1) - art.atf("y"));
        if best.is_none_or(|b| d < b.0) {
            best = Some((d, q.atf(0), q.atf(1)));
        }
    }
    let (_, ax, ay) = best.unwrap();
    let a = (ay - pl.atf("y")).atan2(ax - pl.atf("x"));
    let e = tb.ranges(&art).0 as f64;
    regle!(art, x = ax + a.cos() * 0.7 * e, y = ay + a.sin() * 0.7 * e);
    regle!(art, dir = a + PI, form = "batterie", path = list![], goal = Val::None, reload = 0.0);
    assert!(tb.order(0, &ids(&art), "bombard", "any", &dict! {"x" => ax, "y" => ay}).0);
    let before = tb.pound.copy();
    avancer(&mut tb, 300.0);
    assert_eq!(kind(&art), "bombard");
    let k = py::int(py::mod_f((ay - pl.atf("y")).atan2(ax - pl.atf("x")), 2.0 * PI) / (2.0 * PI) * BT::BREACH_SECT as f64).to_string();
    assert_ne!(tb.pound.get_or(k.as_str(), 0.0), before.get_or(k.as_str(), 0.0)); // (son pan, à terre ou entamé)
    assert!(art.atf("fired_t") > 0.0);
    let (mut tc, _) = bataille(Val::None);
    let a2 = tc.units.iter().find(|u| u.at("cls") == "artillerie" && u.at("ctrl") == "joueur").unwrap();
    assert!(!ordre(&mut tc, &a2, "bombard", dict! {"x" => 100, "y" => 100}).0);
}

#[test]
fn batterie_de_breche_et_garde() {
    let mut tb = place("att", "normal");
    let mem = tb.ai_mem.at("s0");
    assert!(mem.at("batter").truthy());
    assert!(mem.at("role").values().iter().any(|r| *r == "garde"));
    for uid in mem.at("batter").iter() {
        let p = mem.at("post").at(&uid);
        regle!(tb.unit(&uid), x = p.at(0), y = p.at(1), form = "batterie");
    }
    pense(&mut tb, 0, 1);
    assert!(mem.at("batter").iter().all(|uid| kind(&tb.unit(&uid)) == "bombard"));
    assert!(journal_dit(&mem, "batterie de brèche"));
}

#[test]
fn regroupement_dure_puis_place_investie_puis_retraite() {
    let mut tb = place("att", "normal");
    let mem = tb.ai_mem.at("s0");
    mem.update(&dict! {"phase" => "assaut", "t_phase" => tb.clock - 400.0, "t_breach" => 10, "waves" => 0, "n_assault" => 1_000_000});
    pense(&mut tb, 0, 1);
    assert_eq!(mem.at("phase"), "regroupe");
    mem.dec("t_phase", 300);
    pense(&mut tb, 0, 1);
    assert_eq!(mem.at("phase"), "regroupe"); // (une vieille brèche ne relance plus l'assaut au bout de 2 min)
    mem.update(&dict! {"phase" => "assaut", "t_phase" => tb.clock - 400.0, "waves" => 1, "n_assault" => 1_000_000});
    pense(&mut tb, 0, 1);
    assert_eq!(mem.at("phase"), "investi");
    mem.update(&dict! {"t_phase" => tb.clock - 1900.0, "bonus" => 1, "extra" => 1});
    pense(&mut tb, 0, 1);
    assert!(tb.withdrawing.at(0).truthy());
    assert!(journal_dit(&mem, "se retire dans les lignes"));
    json::dumps_compact(&tb.ai_mem);
}

#[test]
fn coupure_et_contre_attaque_dans_la_breche() {
    let mut tb = place("def", "normal");
    let mem = tb.ai_mem.at("s1");
    let coupures = |m: &Val| m.at("role").values().iter().filter(|r| **r == "coupure").count();
    let n0 = coupures(&mem);
    let pl = tb.place_info();
    let a = mem.atf("fd");
    let ri = mem.atf("r_in");
    let q = list![py::round(pl.atf("x") + a.cos() * (ri - 30.0)), py::round(pl.atf("y") + a.sin() * (ri - 30.0)), py::round_n(a, 3)];
    mem.at("breach").push(&q);
    pense(&mut tb, 1, 1);
    assert_eq!(coupures(&mem), n0 + 1);
    // un assaillant ébranlé dans la brèche : on le rejette à la baïonnette
    let e = tb.units.iter().find(|u| u.at("side") == 0 && u.at("cls") == "inf" && U::valid(u)).unwrap();
    regle!(e, x = q.at(0), y = q.at(1), morale = 45.0, path = list![], goal = Val::None);
    // (les défenseurs à 90 m, du côté de la ville d'où une charge va droit à la brèche : à Oloron, le gave passe
    // entre la brèche et le centre)
    let dfs: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 1 && ["coupure", "breche", "res"].iter().any(|r| mem.at("role").get(u.at("id")) == *r)).collect();
    for da in [0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5] {
        let (x, y) = (q.atf(0) - (a + da).cos() * 90.0, q.atf(1) - (a + da).sin() * 90.0);
        for u in &dfs {
            regle!(u, x = x, y = y);
        }
        if !dfs.is_empty() && AI::_charge_ok(&mut tb, 1, &dfs[0], &e) {
            break;
        }
    }
    for u in &dfs {
        regle!(u, morale = 90.0, state = "repos");
    }
    tb._update_vision();
    pense(&mut tb, 1, 1);
    assert!(journal_dit(&mem, "dans la brèche"));
}

#[test]
fn sortie_contre_une_batterie_isolee() {
    let mut tb = place("def", "normal");
    let mem = tb.ai_mem.at("s1");
    let pl = tb.place_info();
    let a = mem.atf("fd");
    let cav = tb.units.iter().find(|u| u.at("side") == 1 && mem.at("role").get(u.at("id")) == "cav").unwrap();
    regle!(cav, morale = 90.0, fat = 0.0);
    let z = tb.ai_zone(0);
    let mut g: Option<Val> = None;
    for u in tb.units.iter() {
        if u.at("side") != 0 {
            continue;
        }
        if u.at("cls") == "artillerie" && g.is_none() {
            g = Some(u.clone());
            let d = mem.atf("r_in") + 500.0;
            regle!(u, x = pl.atf("x") + a.cos() * d, y = pl.atf("y") + a.sin() * d, form = "batterie", dir = a + PI);
        } else {
            // (les autres loin derrière : la batterie est isolée)
            let (x, y) = ((z.atf(0) + z.atf(2)) / 2.0 + a.cos() * 1500.0, (z.atf(1) + z.atf(3)) / 2.0 + a.sin() * 1500.0);
            regle!(u, x = x.max(20.0).min(TR::W as f64 - 20.0), y = y.max(20.0).min(TR::H as f64 - 20.0));
        }
        regle!(u, path = list![], goal = Val::None);
    }
    tb._update_vision();
    if !tb.seen_by.at(1).has(g.unwrap().at("id")) {
        println!("sauté : batterie invisible depuis la place avec cette graine");
        return;
    }
    pense(&mut tb, 1, 1);
    assert!(mem.get("sortie").or(dict! {}).has(cav.at("id")));
    assert!(journal_dit(&mem, "sortie de la garnison"));
    let st = mem.at("sortie").at(cav.at("id"));
    regle!(cav, x = st.at(3), y = st.at(4), path = list![], goal = Val::None);
    tb._update_vision();
    pense(&mut tb, 1, 1);
    assert_eq!(mem.at("sortie").at(cav.at("id")).at(0), "charger");
    assert_eq!(cav.at("state"), "charge");
    json::dumps_compact(&tb.ai_mem);
}

#[test]
fn niveaux_facile_et_difficile() {
    for lvl in ["facile", "difficile"] {
        for role in ["att", "def"] {
            // (l'IA du joueur garde ACCEL_LEVEL : l'autre camp joue à ce niveau)
            let mut tb = place(role, lvl);
            avancer(&mut tb, 2400.0);
            json::dumps_compact(&tb.ai_mem);
        }
    }
}

#[test]
fn combats_de_rue() {
    let mut tb = place("def", "normal");
    let mem = tb.ai_mem.at("s1");
    if !mem.get("ilots").truthy() {
        println!("sauté : pas de maisons à tenir dans cette place");
        return;
    }
    let pl = tb.place_info();
    let a = mem.atf("fd");
    // 400 hommes dans la place, depuis plus d'une minute
    let es: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 0 && u.at("cls") == "inf" && U::valid(u)).take(2).collect();
    for (k, e) in es.iter().enumerate() {
        regle!(e, x = pl.atf("x") + a.cos() * (mem.atf("r_in") - 60.0) + 20.0 * k as f64, y = pl.atf("y") + a.sin() * (mem.atf("r_in") - 60.0));
        regle!(e, path = list![], goal = Val::None);
    }
    tb._update_vision();
    pense(&mut tb, 1, 1);
    tb.clock += 90.0;
    pense(&mut tb, 1, 1);
    let il = mem.at("role").items().iter().filter(|(_, r)| *r == "ilot").count();
    assert!(il > 0);
    assert!(il as i64 <= AI::LEVELS().at("normal").ati("ilots"));
    assert!(journal_dit(&mem, "tient les maisons"));
}

#[test]
fn l_assaut_chasse_a_la_baionnette_les_gardiens_du_coeur() {
    // au cœur de la place, l'assaillant ne se contente pas de fusiller : il charge ceux qui le tiennent encore,
    // cavaliers compris, et relance une charge arrêtée court
    let mut tb = place("att", "normal");
    let mem = tb.ai_mem.at("s0");
    mem.update(&dict! {"phase" => "assaut", "t_phase" => tb.clock - 400.0, "t_go" => tb.clock - 1000.0, "n_assault" => 1});
    let (hx, hy) = (mem.at("heart").atf(0), mem.at("heart").atf(1));
    let u = tb.units.iter().find(|v| v.at("side") == 0 && mem.at("role").get(v.at("id")) == "assaut" && U::valid(v)).unwrap();
    let cav = tb.units.iter().find(|v| v.at("side") == 1 && v.at("cls") == "cavalerie" && U::valid(v)).unwrap();
    for v in tb.units.iter() {
        if v.at("side") == 1 && !v.is(&cav) {
            v.set("state", "hors");
        }
    }
    regle!(cav, x = hx + 50.0, y = hy, state = "repos", path = list![], goal = Val::None);
    regle!(u, x = hx, y = hy, morale = 90.0, state = "repos", path = list![], goal = Val::None);
    tb._update_vision();
    pense(&mut tb, 0, 1);
    assert_eq!((u.at("state"), u.at("target")), (Val::from("charge"), cav.at("id")));
    u.set("state", "repos"); // (la charge s'est arrêtée court ; l'ordre est resté)
    pense(&mut tb, 0, 1);
    assert_eq!(u.at("state"), "charge");
}

// ==================================================================================================== PlaceAuMilieuDeLEau
// Fort Médoc (graine 2) : la carte de campagne, grossière sur l'estuaire, posait la place dans l'eau, sans un pont
// pour y aller ; l'assaillant se déployait sur l'eau. La place est bâtie au sec, reliée par une chaussée et son pont,
// et l'assaillant arrive par le bord le plus sec.

#[test]
fn on_va_au_pied_du_rempart_par_le_pont() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1790", "kind" => "forteresse", "role" => "def",
    "units" => dict!{"ligne" => 2, "artillerie" => 1}, "seed" => 2});
    let pl = tb.map.place.clone();
    assert_eq!(pl.at("name"), "Fort Médoc");
    // (le pont de la chaussée)
    assert!(tb.map.bridges.iter().any(|b| py::hypot(b.atf("x") - pl.atf("x"), b.atf("y") - pl.atf("y")) < pl.atf("r") + 300.0));
    assert!(tb._dry(&tb.zone(0)) > 0.3);
    let u = tb.units.iter().find(|u| u.at("side") == 0 && u.at("cls") == "inf").unwrap();
    let (a, r) = ((u.atf("y") - pl.atf("y")).atan2(u.atf("x") - pl.atf("x")), pl.atf("r") + 80.0);
    assert!(tb.path_cost(u.atf("x"), u.atf("y"), pl.atf("x") + a.cos() * r, pl.atf("y") + a.sin() * r, "inf", 0).is_some());
}

// ==================================================================================================== BrecheDePartEnPart
// Fort Médoc (graine 2) : ses remparts ont 60 à 90 m d'épaisseur ; la brèche, d'un rayon de 24 m, restait borgne (le
// mur derrière intact) et les colonnes attendaient au pied des heures durant (banc : 7 h, 2 à 8 % de pertes). Elle
// s'ouvre maintenant sur toute l'épaisseur du rempart.

#[test]
fn on_passe_la_breche_d_un_rempart_epais() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1700", "kind" => "forteresse", "role" => "att",
    "units" => dict!{"ligne" => 2, "artillerie" => 1}, "seed" => 2});
    let pl = tb.map.place.clone();
    let (x, y) = (1590.0, 798.0); // (un pan du nord-est ; avant : 17 des 30 pans essayés restaient borgnes)
    let a = (y - pl.atf("y")).atan2(x - pl.atf("x"));
    let inf = Val::from("inf");
    let bout = tb.nearest_passable(&inf, 0, x + a.cos() * 60.0, y + a.sin() * 60.0, 12, false);
    let bin_ = tb.nearest_passable(&inf, 0, x - a.cos() * 50.0, y - a.sin() * 50.0, 12, false);
    let walls = tb.map.walls.clone();
    let dmin = |i: usize| walls.at(i as i64).at("pts").iter().map(|p| py::hypot(p.atf(0) - x, p.atf(1) - y)).fold(f64::INFINITY, f64::min);
    let mut wi = 0; // (min : le premier gagne)
    for i in 1..walls.len() {
        if dmin(i) < dmin(wi) {
            wi = i;
        }
    }
    tb._apply_breach(wi as i64, x, y, BT::BREACH_R);
    assert!(tb.path_cost(bout.0, bout.1, bin_.0, bin_.1, "inf", 0).or(Val::from(1e9)).f() < 500.0);
}

// ==================================================================================================== RedditionDUnePlace
// Une garnison battue en brèche, éprouvée et débordée capitule sans assaut (SURR_*) : elle est prisonnière et la place
// est prise sur la carte de campagne ; une garnison encore solide tient.

#[test]
fn la_garnison_capitule_et_la_place_est_prise() {
    let (mut g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1870", "kind" => "forteresse", "role" => "att", "seed" => 1,
    "units" => dict!{"ligne" => 4, "artillerie" => 2}});
    let bid = tb.bid.clone();
    tb.autofinish();
    let gar: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 1 && u.at("cls") != "general" && u.at("cls") != "chariot").collect();
    tb.clock = 4000.0;
    tb.siege_t = Val::from(0.0);
    tb.breach_t = list![list![1000, "0"]];
    for u in &gar {
        regle!(u, men = u.atf("men0") * 0.4, morale = 80.0);
    }
    tb._check_end();
    assert_ne!(tb.phase, "fin"); // (moral encore ferme : elle tient)
    for u in &gar {
        u.set("morale", 40.0);
    }
    tb._check_end();
    assert_eq!((tb.phase.as_str(), tb.winner.clone()), ("fin", Val::from(0)));
    assert!(tb.why.s().starts_with("La garnison capitule"));
    assert!(gar.iter().all(|u| u.at("men") == 0));
    assert!(tb.result.at("prisoners").atf(1) >= 0.4 * py::sum(gar.iter().map(|u| u.atf("men0"))) - 1.0);
    // la campagne : la place change de mains
    let de = g.armies.values().into_iter().find(|a| a.get("at_node").is_some()).unwrap();
    let att = g.armies.values().into_iter().find(|a| !a.is(&de)).unwrap();
    let nid = de.at("at_node");
    g.battles.set(
        bid.as_str(),
        dict! {"id" => bid.as_str(), "x" => att.at("x"), "y" => att.at("y"), "node" => &nid, "ambush" => false, "surprise" => false, "recent" => list![0.0, 0.0],
        "sides" => list![dict!{"owner" => att.at("owner"), "armies" => list![att.at("id")], "men0" => 1.0, "lost" => 0.0, "node" => Val::None},
                         dict!{"owner" => de.at("owner"), "armies" => list![de.at("id")], "men0" => 1.0, "lost" => 0.0, "node" => &nid}]},
    );
    TB::finish(&mut g, tb);
    assert_eq!(g.nodes.at(&nid).at("owner"), att.at("owner"));
    assert!(!g.armies.has(de.at("id"))); // (la garnison prisonnière ne revient pas)
}

// ==================================================================================================== LaBrecheEstUnGoulet
// Sur une brèche et à une case de ses bords, l'assaillant n'engage que BRECHE_FRONT hommes en mêlée, s'y bat moins bien
// et prend les feux croisés ; pas le défenseur, ni l'assaillant à deux cases.

#[test]
fn front_etroit_et_feux_croises() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "kind" => "forteresse", "role" => "att", "seed" => 1,
    "units" => dict!{"ligne" => 2}});
    let a = tb.units.iter().find(|u| u.at("side") == 0 && u.at("cls") == "inf" && u.atf("men") > BT::BRECHE_FRONT).unwrap();
    let d = tb.units.iter().find(|u| u.at("side") == 1 && u.at("cls") == "inf").unwrap();
    let c = tb.map.t.iter().position(|&t| t as i64 == T_MUR).unwrap() as i64;
    let cf = CELL as f64;
    let (x, y) = ((py::mod_i(c, COLS) as f64 + 0.5) * cf, (py::floordiv_i(c, COLS) as f64 + 0.5) * cf);
    regle!(a, x = x + cf, y = y);
    let k0 = tb._melee_k(&a, &d);
    assert_eq!(tb._melee_men(&a), a.atf("men"));
    tb.map.t[c as usize] = T_BRECHE as u8;
    assert!(tb._in_breach(&a));
    assert_eq!(tb._melee_men(&a), BT::BRECHE_FRONT);
    presque(tb._melee_k(&a, &d), k0 * BT::BRECHE_MELEE, 7, "mêlée dans la brèche");
    a.set("x", x + 2.0 * cf);
    assert!(!tb._in_breach(&a));
    regle!(d, x = x, y = y);
    assert!(!tb._in_breach(&d));
}

// ==================================================================================================== VillageBarricade
// Le lieu « village » du mode Bataille (et du banc) : un village sans remparts, barricadé, que l'IA attaque (plan
// 'assaut') et défend (plan 'place').

#[test]
fn village_barricade_attaque_et_defendu() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "kind" => "village", "role" => "att", "seed" => 1,
    "units" => dict!{"ligne" => 2}});
    assert_eq!((tb.map.place.at("type"), tb.place_info().at("fort")), (Val::from("village"), Val::from(0)));
    assert!(tb.map.t.iter().filter(|&&t| t as i64 == T_BARRICADE).count() > 10);
    assert!(tb.objective().is_some());
    tb.autofinish();
    assert_eq!((tb.ai_mem.at("s0").at("plan"), tb.ai_mem.at("s1").at("plan")), (Val::from("assaut"), Val::from("place")));
}

// ==================================================================================================== TechnologiesDeCombat
// Feu de rang, ordre mixte, cuirassiers, artillerie à cheval, toutes armes… : la spec de la bataille les porte
// (bridge.make_spec), le moteur les applique comme la résolution automatique, et la fiche les compte.
// (setUp et tir : ceux de ValeursChiffrees, chiffrees() et tir())

/// (Python : `tech(self, **md)`)
fn tech(tb: &TacticalBattle, l: &Val, md: Val) {
    tb.spec.set("tech", if l.at("side") == 0 { list![md, dict! {}] } else { list![dict! {}, md] });
}

#[test]
fn la_spec_porte_les_technologies() {
    let (tb, l, _c) = chiffrees();
    let md = tb.tech(l.ati("side"));
    assert!(md.keys().iter().all(|k| ST::TECH_MODS().has(k)));
    assert!(md.get_or("ligne_fire", 0).f() > 0.0, "en 1790, le feu de rang est connu");
    tb.spec.del("tech");
    assert_eq!(tb.tech(0), dict! {}, "une ancienne sauvegarde : rien");
}

#[test]
fn un_regiment_sans_feu_de_rang() {
    // SPEC-ARBRE.md : la spec porte les effets propres des régiments en retard (umd), la bataille les préfère
    let (mut tb, l, c) = chiffrees();
    tech(&tb, &l, dict! {"ligne_fire" => 0.22});
    let p_avec = tir(&mut tb, &l, &c, 50, "ligne", 1);
    let umd = dict! {};
    umd.set(l.at("id"), dict! {});
    tb.spec.set("umd", umd);
    proche(p_avec / tir(&mut tb, &l, &c, 50, "ligne", 1), 1.22, 0.02, "feu de rang");
    assert_eq!(tb.tech_of(&c), tb.tech(c.ati("side")), "les autres gardent ceux du camp");
}

#[test]
fn la_spec_porte_les_regiments_en_retard() {
    let (mut g, bt) = bataille_de_campagne("1790", true, 3);
    let joueur = g.player.clone();
    let a = bt.at("sides").iter().flat_map(|s| s.at("armies").iter().collect::<Vec<Val>>()).map(|aid| g.armies.at(&aid)).find(|a| a.at("owner") == joueur.as_str()).unwrap();
    let r = a.at("regs").iter().find(|r| R::UNITS().at(r.at("type")).at("cls") == "inf").unwrap();
    r.set("man", list![]);
    let spec = TB::make_spec(&mut g, &bt);
    assert_eq!(spec.at("umd").keys(), vec![r.at("id")], "seul le régiment qui n’a rien appris");
    let i = bt.at("sides").iter().position(|s| s.at("owner") == joueur.as_str()).unwrap() as i64;
    assert!(spec.at("umd").at(r.at("id")).get_or("ligne_fire", 0).f() < spec.at("tech").at(i).atf("ligne_fire"));
}

#[test]
fn le_feu_de_rang_et_toutes_armes_au_tir() {
    let (mut tb, l, c) = chiffrees();
    tech(&tb, &l, dict! {});
    let p0 = tir(&mut tb, &l, &c, 50, "ligne", 1);
    tech(&tb, &l, dict! {"ligne_fire" => 0.22, "all_power" => 0.08, "inf_power" => 0.05});
    proche(tir(&mut tb, &l, &c, 50, "ligne", 1) / p0, 1.22 * 1.13, 0.02, "au tir");
    let f = |md: Val| somme2(&stats("ligne", 1, 50.0, &md).at("pre"));
    proche(f(dict! {"ligne_fire" => 0.22, "all_power" => 0.08, "inf_power" => 0.05}) / f(dict! {}), 1.22 * 1.13, 0.03, "sur la fiche");
}

#[test]
fn la_melee_et_la_charge() {
    let (mut tb, l, c) = chiffrees();
    regle!(l, fat = 0.0, morale = 80.0, form = "ligne");
    tech(&tb, &l, dict! {});
    let k0 = tb._melee_k(&l, &c);
    tech(&tb, &l, dict! {"all_power" => 0.08, "cav_power" => 0.15});
    presque(tb._melee_k(&l, &c) / k0, 1.08, 6, "l'infanterie : pas les hussards");
    let s = |typ: &str, md: Val| stats(typ, 1, 0.0, &md);
    proche(s("cavalerie", dict! {"cav_charge" => 0.2}).at("chg").atf(0) / s("cavalerie", dict! {}).at("chg").atf(0), 1.2, 0.04, "cavalerie");
    proche(s("ligne", dict! {"colonne_charge" => 0.15}).at("chg").atf(0) / s("ligne", dict! {}).at("chg").atf(0), 1.15, 0.04, "colonne");
    assert_eq!(s("ligne", dict! {"cav_charge" => 0.2}).at("chg"), s("ligne", dict! {}).at("chg"));
}

#[test]
fn les_cuirassiers_au_choc() {
    let (mut tb, l, c) = chiffrees();
    let cav = tb.units.iter().find(|u| u.at("side") == l.at("side") && u.at("cls") == "cavalerie").unwrap();
    let men = cav.at("men");
    // (le Python remplace tb._damage par un mock et lit les pertes qu'on lui demande d'infliger à la cible ; ici les
    // pertes de la cible, qui a 500 hommes, sont celles-là : la cavalerie garde ses hommes d'un choc à l'autre, comme
    // sous le mock)
    let mut choc = |md: Val| {
        tech(&tb, &l, md);
        regle!(cav, men = &men, fat = 0.0, morale = 90.0, charge_v = 999.0, state = "charge");
        regle!(c, busy = 5.0, men = 500.0, morale = 90.0, state = "repos"); // pris en manœuvre
        regle!(cav, x = c.atf("x") + 10.0, y = c.at("y"));
        let lost = c.atf("lost");
        tb._impact(&cav, &c);
        c.atf("lost") - lost
    };
    presque(choc(dict! {"cav_charge" => 0.2}) / choc(dict! {}), 1.2, 6, "cuirassiers");
}

#[test]
fn la_portee_de_justesse() {
    let j = |arm: i64| stats("ligne", arm, 0.0, &Val::None).at("jus");
    assert_eq!((j(1), j(4)), (Val::from(U::INF_D50[1]), Val::from(U::INF_D50[4])));
    let u = U::Unit(&dict! {"type" => "ligne", "cls" => "inf", "arm" => 4});
    presque(U::precision(&u, j(4).f()), 0.5, 3, "demi-justesse");
    assert!(!stats("artillerie", 2, 0.0, &Val::None).has("jus"), "les canons : boulet et mitraille, pas cette courbe");
    assert!(stats("mitrailleuses", 0, 0.0, &Val::None).has("jus"));
}

// ==================================================================================================== IAFinirAutomatiquementEtLogement
// « Finir automatiquement » en défense reprend les réglages du déploiement ; le logement dans la brèche.

/// La clé du cache de la vue de `los` (battle/aides.rs) pour ce regard, posée à `vu`.
fn poser_vue(tb: &mut TacticalBattle, x1: f64, y1: f64, x2: f64, y2: f64, eye1: f64, eye2: f64, vu: bool) {
    let (mut c1, mut c2) = (TacticalBattle::cell(x1, y1), TacticalBattle::cell(x2, y2));
    let (mut eye1, mut eye2) = (eye1, eye2);
    if c2 < c1 {
        (c1, c2, eye1, eye2) = (c2, c1, eye2, eye1);
    }
    tb._los_cache.insert((c1, c2, eye1.to_bits(), eye2.to_bits()), vu);
}

/// Ce que le Python obtient par `mock.patch.object(ai, '_hidden', lambda b, s, x, y: (x, y) != (x0, y0))` et
/// `mock.patch.object(tb, 'height_at', lambda x, y: 10.0 if (x, y) == (x0, y0) else 0.0)` : une fonction ni une
/// méthode ne se remplacent en Rust ; on pose donc la hauteur de la case de (x0, y0) à 10 et celle des cases que
/// _reverse_slope essaie derrière elle à 0, et l'on remplit le cache de la vue pour que les cinq regards de _hidden
/// voient (x0, y0) et ne voient aucune de ces cases. (Une case essayée qui serait celle de (x0, y0) reste vue.)
fn crete_et_contre_pente(tb: &mut TacticalBattle, side: i64, x0: f64, y0: f64, fd: f64) {
    let z = tb.ai_zone(1 - side);
    let a = tb.front_dir(1 - side);
    let (c, s) = (a.cos(), a.sin());
    let (cx, cy) = ((&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0);
    let (hw, hh) = ((&z.at(2) - &z.at(0)).f() / 2.0, (&z.at(3) - &z.at(1)).f() / 2.0);
    let (reach, half) = (c.abs() * hw + s.abs() * hh, s.abs() * hw + c.abs() * hh);
    let eye = AI::EYES().atf("inf");
    let regards: Vec<(f64, f64)> = [-0.4, -0.2, 0.0, 0.2, 0.4]
        .iter()
        .map(|k| {
            let (qx, qy) = AI::_at(cx, cy, a, reach, k * 2.0 * half);
            AI::_clamp(qx, qy, 5.0)
        })
        .collect();
    let c0 = TacticalBattle::cell(x0, y0);
    tb.map.h[c0 as usize] = 10;
    for &(px, py_) in &regards {
        poser_vue(tb, px, py_, x0, y0, AI::GUN_EYE, eye, true);
    }
    for d in [20.0, 35.0, 50.0, 65.0, 80.0] {
        for lat in [0.0, 20.0, -20.0] {
            let (x, y) = AI::_at(x0, y0, fd, -d, lat);
            let cc = TacticalBattle::cell(x, y);
            if cc < 0 || cc == c0 {
                continue;
            }
            tb.map.h[cc as usize] = 0;
            for &(px, py_) in &regards {
                poser_vue(tb, px, py_, x, y, AI::GUN_EYE, eye, false);
            }
        }
    }
}

#[test]
fn finir_automatiquement_en_defense() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "seed" => 1, "role" => "def",
    "units" => dict!{"ligne" => 3, "legere" => 1, "artillerie" => 2}});
    tb.start();
    let z = tb.ai_zone(0);
    for (k, u) in tb.units.iter().filter(|u| u.at("side") == 0).enumerate() {
        // (l'assaillant au fond de sa zone, loin)
        regle!(u, x = (z.atf(0) + z.atf(2)) / 2.0 + 40.0 * k as f64, y = (z.atf(1) + z.atf(3)) / 2.0);
    }
    let mes: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 1 && U::alive(u)).collect();
    let line: Vec<Val> = mes.iter().filter(|u| u.at("cls") == "inf" && !u.at("light").truthy()).cloned().collect();
    let light = mes.iter().find(|u| u.at("light").truthy()).unwrap().clone();
    regle!(light, x = line[0].atf("x") + 30.0, y = line[0].at("y")); // (le joueur avait ramené ses tirailleurs dans la ligne)
    tb._update_vision();
    tb.autofinish();
    AI::think(&mut tb, 1, 2.0);
    let mem = tb.ai_mem.at("s1");
    assert!(line.iter().all(|u| u.at("fire_mode") == "volley"));
    assert!(mem.at("scr").has(light.at("id")));
    let p = mem.at("post").at(light.at("id"));
    assert!(AI::_rel(p.atf(0), p.atf(1), light.atf("x"), light.atf("y"), mem.atf("fd")).0 > 80.0); // l'écran repart en avant
    if mem.at("plan") == "tenir" {
        let mut lats: Vec<f64> = mes.iter().filter(|u| u.at("cls") == "artillerie").map(|u| mem.at("lat").atf(u.at("id"))).collect();
        lats.sort_by(f64::total_cmp);
        let ll: Vec<f64> = line.iter().map(|u| mem.at("lat").atf(u.at("id"))).collect();
        let (mn, mx) = (ll.iter().cloned().fold(f64::INFINITY, f64::min), ll.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
        assert_eq!((lats[0], lats[lats.len() - 1]), (py::round_n(mn, 1), py::round_n(mx, 1))); // feux croisés
    }
    // contre-pente en plein combat : le bataillon vu de l'ennemi garde sa place sur la crête et s'en va attendre
    // derrière (son poste), sans être redéployé
    let u = &line[0];
    let (x0, y0) = (u.atf("x"), u.atf("y"));
    crete_et_contre_pente(&mut tb, 1, x0, y0, mem.atf("fd"));
    AI::_reverse_slope(&mut tb, 1, &mem, &AI::LEVELS().at("normal"), &list![u], mem.atf("fd"));
    assert_eq!((u.atf("x"), u.atf("y")), (x0, y0));
    assert_eq!(mem.at("crest").at(u.at("id")), list![py::round_n(x0, 1), py::round_n(y0, 1)]);
    let q = mem.at("post").at(u.at("id"));
    assert!(AI::_rel(q.atf(0), q.atf(1), x0, y0, mem.atf("fd")).0 < -10.0);
}

#[test]
fn logement_dans_la_breche() {
    let mut tb = place("att", "normal");
    let mem = tb.ai_mem.at("s0");
    mem.update(&dict! {"phase" => "assaut", "t_phase" => tb.clock - 400.0, "t_go" => tb.clock - 1000.0, "n_assault" => 1});
    let (bx, by) = (mem.at("bin").atf(0), mem.at("bin").atf(1));
    let ass: Vec<Val> = tb.units.iter().filter(|v| v.at("side") == 0 && mem.at("role").get(v.at("id")) == "assaut" && U::valid(v)).collect();
    for (k, v) in ass.iter().take(2).enumerate() {
        regle!(v, x = bx + 30.0 * k as f64, y = by, morale = 90.0, state = "repos", path = list![], goal = Val::None);
    }
    for v in tb.units.iter() {
        // (plus un défenseur sur la brèche)
        if v.at("side") == 1 && py::hypot(v.atf("x") - bx, v.atf("y") - by) < 120.0 {
            regle!(v, x = mem.at("heart").at(0), y = mem.at("heart").at(1));
        }
    }
    tb._update_vision();
    pense(&mut tb, 0, 1);
    let u = tb.unit(&mem.at("lodge").at(0));
    assert_eq!(u, ass[0]);
    assert!(tb.spec.at("logement").has(u.at("id")));
    assert_eq!(kind(&u), "hold");
    assert!(journal_dit(&mem, "s'y loge"));
    // retranché : gabions et sacs à terre au bout de ENTRENCH_T à l'arrêt
    u.set("still_t", tb.clock - BT::ENTRENCH_T - 1.0);
    presque(tb._entrench_k(&u, &ass[1]), 1.0 - BT::LOGEMENT_K, 7, "logement");
    // la garnison l'en chasse : il s'est arrêté au débouché, on le rejette à la baïonnette
    let md = tb.ai_mem.at("s1");
    let fd = mem.atf("fd");
    let (qx, qy) = AI::_at(bx, by, fd, -20.0, 0.0);
    let q = list![py::round(qx), py::round(qy), py::round_n(fd + PI, 3)];
    md.setdefault("breach", list![]).push(&q);
    regle!(u, state = "feu", morale = 90.0);
    let res = tb.units.iter().find(|v| v.at("side") == 1 && md.at("role").get(v.at("id")) == "res" && v.at("cls") == "inf").unwrap();
    regle!(res, x = bx - fd.cos() * 90.0, y = by - fd.sin() * 90.0, morale = 90.0, state = "repos", men = 2.0 * u.atf("men"));
    tb._update_vision();
    pense(&mut tb, 1, 1);
    assert_eq!((res.at("state"), res.at("target")), (Val::from("charge"), u.at("id")));
    // en déroute, le logement est perdu (la réserve qui l'a chargé tient la brèche : on n'y en loge pas un autre)
    u.set("state", "deroute");
    regle!(res, x = bx, y = by);
    tb._update_vision();
    pense(&mut tb, 0, 1);
    assert!(mem.at("lodge").is_none());
    assert!(!tb.spec.at("logement").has(u.at("id")));
}

// ==================================================================================================== CommanderLaBataille
// « Commander la bataille » (mode manuel) : le joueur déploie et mène lui-même chaque régiment (commandes `tac`
// deploy, start, order, speed), « Finir automatiquement » et reprise du commandement, « Décrocher ».

fn TB_view(g: &mut Game, bid: &str) -> Val {
    TB::battle_view(g, &Val::from(bid), 0)
}

#[test]
fn mode_bataille_a_la_main() {
    let (mut g, bid) = escarmouche_g(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "units" => dict!{"ligne" => 2, "cavalerie" => 1}, "seed" => 1, "mode" => "manuel"});
    let t = tb(&mut g);
    assert_ne!(t.spec.get("mode"), "ordres");
    assert!(t.units.iter().filter(|u| u.at("side") == t.me).all(|u| u.at("ctrl") == "joueur"));
    assert!(!TB_view(&mut g, &bid).has("ordres"));
}

// ==================================================================================================== DonnerMesOrdres
// « Donner mes ordres » (tactics/orders.rs) : le joueur choisit ses ordres, ses officiers livrent la bataille selon
// eux, sous ses yeux, et s'arrêtent au moment décisif s'il l'a demandé.

#[test]
fn le_mode_bataille_se_livre_sur_ordres() {
    let (mut g, bid) = escarmouche_g(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "units" => dict!{"ligne" => 2, "cavalerie" => 1}, "seed" => 1});
    let t = tb(&mut g);
    assert_eq!(t.spec.at("mode"), "ordres");
    assert!(t.units.iter().all(|u| u.at("ctrl") == "ia"));
    assert!(TB_view(&mut g, &bid).has("ordres"));
}

/// Quelques jeux d'ordres joués jusqu'au bout, IA contre IA : pas d'erreur, une issue.
#[test]
fn banc_des_ordres() {
    let jeux = [
        ("att", dict! {"man" => "double", "cav" => "raid", "leg" => "bois", "ruse" => "bois", "obj" => "retraite", "vsCav" => "contre", "hour" => "aube"}),
        ("att", dict! {"man" => "percee", "art" => "grande", "inf" => "mixte", "vsRes" => "presser", "ruse" => "feux", "hour" => "midi"}),
        ("def", dict! {"man" => "contrepente", "ruse" => "deserteurs", "wing" => "gauche", "obj" => "cle", "vsRes" => "canons"}),
    ];
    for (role, o) in jeux {
        let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1813", "kind" => "bataille", "role" => role,
        "units" => dict!{"ligne" => 4, "legere" => 2, "cavalerie" => 2, "artillerie" => 2}, "seed" => 2});
        let me = tb.me.i();
        tb.spec.set("orders", list![Val::None, Val::None]);
        let oc = OR::clean(&tb, me, &o, &Val::None);
        tb.spec.at("orders").set(me, &oc);
        tb.autofinish();
        let om = tb.spec.at("orders").at(me);
        OR::setup(&mut tb, me, &om);
        if o.get("ruse") == "deserteurs" {
            AI::shift_reserve(&mut tb, 1 - me, OR::wing_sign(&o), &Val::None);
        }
        tb.run_to_end();
        assert_eq!(tb.phase, "fin", "{}", o.repr());
        let w = tb.result.at("winner");
        assert!(w == 0 || w == 1 || w.is_none());
    }
}

// ==================================================================================================== CanonsCamoufles
// Des canons dans un bois : l'ennemi ne les voit qu'à moins de 250 m (500 m quand ils tirent) ; en échange, ils
// tirent moins bien (×0,65) et se mettent en batterie plus lentement (×1,6).

/// Une case de bois avec 400 m de prairie ou de champs à l'est.
fn lisiere(tb: &TacticalBattle) -> Option<(f64, f64)> {
    let (t, h) = (&tb.map.t, &tb.map.h);
    let cf = CELL as f64;
    for j in 10..ROWS - 10 {
        for i in 5..COLS - 25 {
            let c = (j * COLS + i) as usize;
            if t[c] as i64 == T_BOIS && (1..21).all(|k| [T_PRE, T_CHAMP].contains(&(t[c + k] as i64)) && h[c + k] <= h[c] + 1) {
                return Some(((i as f64 + 0.5) * cf, (j as f64 + 0.5) * cf));
            }
        }
    }
    None // (le Python : AssertionError('pas de lisière dégagée sur cette carte'))
}

#[test]
fn vus_de_pres_seulement() {
    let mut trouve = None;
    for seed in [1, 2, 3, 4, 5] {
        let (tb, mes) = bataille_ex(dict! {"artillerie" => 1, "ligne" => 1}, "1813", "33", "24", true, seed);
        if let Some(p) = lisiere(&tb) {
            trouve = Some((tb, mes, p));
            break;
        }
    }
    let (mut tb, mes, (x, y)) = trouve.expect("pas de lisière dégagée sur ces cartes");
    let gun = mes.at("artillerie");
    let obs = ennemi(&tb, &gun, None);
    for u in tb.units.iter() {
        // (les autres loin de là)
        if !u.is(&gun) && !u.is(&obs) {
            regle!(u, x = 20.0 + 3.0 * (u.atf("side") * 2900.0), y = 20.0);
        }
    }
    regle!(gun, x = x, y = y);
    let vu = |tb: &mut TacticalBattle, d: f64, tire: bool| {
        regle!(obs, x = x + d, y = y);
        gun.set("fired_t", if tire { tb.clock } else { -1e9 });
        tb._update_vision();
        tb.seen_by.at(obs.at("side")).has(gun.at("id"))
    };
    assert!(!vu(&mut tb, 300.0, false));
    assert!(!vu(&mut tb, 600.0, true), "la fumée sous les arbres ne trahit pas la batterie de loin");
    assert!(vu(&mut tb, 400.0, true));
    assert!(vu(&mut tb, 200.0, false) || vu(&mut tb, 150.0, false));
    // hors du bois, la même batterie qui tire se voit de loin
    gun.set("x", x + 40.0);
    assert!(vu(&mut tb, 600.0, true));
    // mise en batterie plus lente entre les arbres
    regle!(gun, x = x, form = "attelee", busy = 0.0);
    tb._change_form(&gun, "batterie");
    let t_bois = gun.atf("busy");
    regle!(gun, x = x + 100.0, form = "attelee", busy = 0.0);
    tb._change_form(&gun, "batterie");
    proche(t_bois, gun.atf("busy") * BT::CAMO_SETUP, 0.5, "mise en batterie");
}

// ==================================================================================================== FumeeDrapeauMeteo
// La fumée de la poudre noire gêne le tir, le drapeau se perd dans la déroute au contact, le temps tourne.

fn max_fumee(tb: &TacticalBattle) -> f64 {
    tb.smoke.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
}

#[test]
fn la_fumee_gene_le_tir_puis_se_dissipe() {
    let (mut tb, u) = bataille(dict! {"ligne" => 1});
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    face_a_face(&mut tb, &L, &cible, 250.0); // (tireur et cible dans deux carrés de fumée différents)
    assert_eq!(tb._smoke_k(&L, &cible), 1.0); // pas un coup tiré : l'air est clair
    let i = tb._smoke_i(L.atf("x"), L.atf("y")) as usize;
    tb.smoke[i] = 1.0;
    tb._smoke_on = true;
    proche(tb._smoke_k(&L, &cible), 1.0 - BT::SMOKE_K, BT::SMOKE_K * 0.55, "fumée"); // (± la moitié, si le milieu y est aussi)
    tb.smoke[i] = 50.0;
    presque(tb._smoke_k(&L, &cible), 1.0 - BT::SMOKE_MAX, 7, "plafond"); // jamais plus que le plafond
    // plus personne ne tire : un quart d'heure après, elle est partie
    tb.smoke[i] = 1.0;
    for x in tb.units.iter() {
        x.set("ammo", 0);
    }
    avancer(&mut tb, 900.0);
    assert!(max_fumee(&tb) < 0.05);
}

#[test]
fn une_salve_laisse_de_la_fumee_sauf_la_poudre_sans_fumee() {
    let (mut tb, u) = bataille(dict! {"ligne" => 1});
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    face_a_face(&mut tb, &L, &cible, 100.0);
    avancer_jusqua(&mut tb, 90.0, |tb| max_fumee(tb) > 0.0);
    assert!(max_fumee(&tb) > 0.0);
    L.set("arm", 7);
    assert!(tb._smokeless(&L));
    L.set("arm", 2);
    assert!(!tb._smokeless(&L));
}

#[test]
fn le_drapeau_est_pris_dans_la_deroute_au_contact() {
    let (mut tb, u) = bataille(dict! {"ligne" => 2});
    let L = u.at("ligne");
    let cible = ennemi(&tb, &L, None);
    face_a_face(&mut tb, &L, &cible, 40.0);
    for e in tb.units.iter() {
        // (lui seul au contact : c'est lui qui prend le drapeau)
        if e.at("side") != L.at("side") && !e.is(&cible) {
            regle!(e, x = L.atf("x") - 900.0, y = L.at("y"));
        }
    }
    if !U::valid(&cible) {
        // (un état-major ou un chariot ne prend pas de drapeau)
        cible.set("cls", "inf");
        cible.set("type", "ligne");
    }
    let m0 = cible.atf("morale");
    tb._rout(&L);
    assert!(!L.at("flag").truthy());
    assert_eq!(cible.atf("morale"), 100.0f64.min(m0 + BT::FLAG_GAIN));
    assert!(matches!(U::view(&L, true, false).get("flag"), Val::Bool(false)));
    assert!(tb.fx.iter().any(|e| e.at("k") == "drapeau"));
}

#[test]
fn le_drapeau_reste_si_l_ennemi_est_loin() {
    let (mut tb, u) = bataille(dict! {"ligne" => 1});
    let L = u.at("ligne");
    for e in tb.units.iter() {
        if e.at("side") != L.at("side") {
            regle!(e, x = L.atf("x") + 900.0, y = L.at("y"));
        }
    }
    tb._rout(&L);
    assert!(L.at("flag").truthy());
    assert!(!U::view(&L, true, false).has("flag"));
}

#[test]
fn le_brouillard_se_leve() {
    let (mut tb, _u) = bataille(dict! {"ligne" => 1});
    tb.weather = "brouillard".to_string();
    tb.wx_at = Val::from(tb.clock + 10.0);
    tb.wx_next = Val::from("soleil");
    avancer(&mut tb, 20.0);
    assert_eq!(tb.weather, "soleil");
    assert!(tb.wx_at.is_none());
    assert!(tb.fx.iter().any(|e| e.at("k") == "meteo"));
    // le temps qui a tourné survit à la sauvegarde
    let tb2 = recharge(&tb);
    assert_eq!(tb2.weather, "soleil");
}

#[test]
fn le_temps_prevu_ne_depend_que_de_la_graine() {
    let (a, _) = bataille_ex(dict! {"ligne" => 1}, "1790", "33", "24", true, 7);
    let (b, _) = bataille_ex(dict! {"ligne" => 1}, "1790", "33", "24", true, 7);
    assert_eq!((a.wx_at.clone(), a.wx_next.clone()), (b.wx_at.clone(), b.wx_next.clone()));
}
