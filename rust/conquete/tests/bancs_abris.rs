//! Banc d'essai des maisons occupées et des barricades (battle : ordres 'maisons' et 'barricade') : porté de
//! tests/test_abris.py.
//!
//! « Occuper les maisons » : l'infanterie va au bâti, y entre en 40 s, en sort en 30 s ; 25 hommes par case bâtie à moins
//! de 40 m, les autres restent dehors ; couvert des maisons, cachée au-delà de 120 m tant qu'elle ne tire pas, feu par les
//! fenêtres ×0,6, corps à corps ×1,6, les cavaliers n'y chargent pas, une maison en feu l'en chasse.
//! « Barricader » : l'infanterie arrêtée, sans ennemi à 200 m, avec de quoi faire (maisons, bois, sapeurs) dresse en 4 min
//! une ligne de cases de barricade devant elle, sur le découvert ; cavaliers et canons n'y passent pas, la charge s'y brise,
//! le boulet la renverse ; la sauvegarde la garde. L'IA s'en sert en défense.

#[macro_use]
mod fabrique;

use conquete::py::{self, Val};
use conquete::tactics::ai as AI;
use conquete::tactics::battle::{self as BT, TacticalBattle};
use conquete::tactics::terrain::{CELL, COLS, T_BARRICADE, T_BATI, T_BOIS, T_EAU, T_MUR, T_PRE, T_ROUTE};
use conquete::tactics::units as U;
use conquete::{dict, list, tup};
use fabrique::*;
use std::collections::HashSet;
use std::f64::consts::PI;

const X0: f64 = 1510.0; // le bourg (au milieu de la carte, loin des zones de déploiement ; au centre d'une case)
const Y0: f64 = 1010.0;
const CELLF: f64 = CELL as f64;

/// Une bataille engagée sans IA, l'ennemi rangé loin de tout (au bord de la carte) : rien ne bouge seul.
fn calme(mes: Val) -> (Box<TacticalBattle>, Val) {
    let mes = if mes.truthy() { mes } else { dict! {"ligne" => 1, "cavalerie" => 1, "sapeurs" => 1} };
    let (mut tb, us) = bataille(mes);
    tb.ai_sides = list![];
    for (k, u) in tb.units.iter().enumerate() {
        regle!(u, ctrl = "joueur", path = list![], goal = Val::None, state = "repos");
        if u.at("side") != tb.me {
            regle!(u, x = 100.0 + 30.0 * k as f64, y = 60.0);
        }
    }
    (tb, us)
}

fn case(x: f64, y: f64) -> i64 {
    py::int(py::floordiv_f(y, CELLF)) * COLS + py::int(py::floordiv_f(x, CELLF))
}

/// Les cases à moins de r m de (x, y) deviennent du type t (sans haie ni muret).
fn peindre(tb: &mut TacticalBattle, x: f64, y: f64, r: f64, t: i64) {
    for c in tb.cells_near(x, y, r) {
        let c = c as usize;
        tb.map.t[c] = t as u8;
        tb.map.f[c] = 0;
        tb.bati[c] = 0;
    }
    tb._cost_cache.clear();
    tb._path_cache.clear();
    tb._los_cache.clear();
}

/// Un champ dégagé (400 m) et, au milieu, un bourg de 13 cases bâties à moins de 40 m (capacité : 325 hommes) ;
/// rue : la case du milieu est une rue (12 maisons, 300 hommes ; le couvert ne vient alors que des maisons).
fn bourg(tb: &mut TacticalBattle, rue: bool) {
    peindre(tb, X0, Y0, 400.0, T_PRE);
    peindre(tb, X0, Y0, 40.0, T_BATI);
    if rue {
        tb.map.t[case(X0, Y0) as usize] = T_ROUTE as u8;
    }
}

/// (Python : `poser(u, x, y, d=0.0, men=None)`.)
fn poser(u: &Val, x: f64, y: f64, d: f64, men: Option<f64>) {
    regle!(u, x = x, y = y, dir = d, path = list![], goal = Val::None, state = "repos", busy = 0.0, next_form = Val::None);
    if let Some(m) = men {
        regle!(u, men = m, men0 = m);
    }
}
fn poser0(u: &Val, x: f64, y: f64) {
    poser(u, x, y, 0.0, None)
}

/// (Python : `foe(tb, u, cls='inf')`.)
fn foe(tb: &TacticalBattle, u: &Val, cls: &str) -> Val {
    tb.units.iter().find(|e| e.at("side") != u.at("side") && e.at("cls") == cls).unwrap()
}

/// u dans les maisons du bourg, tout de suite. (Python : `dedans(tb, u, men=200, rue=False)`.)
fn dedans(tb: &mut TacticalBattle, u: &Val, men: f64, rue: bool) {
    bourg(tb, rue);
    poser(u, X0, Y0, 0.0, Some(men));
    u.set("form", "maisons");
    u.set("order", dict! {"kind" => "maisons", "x" => X0, "y" => Y0});
}

fn ids(u: &Val) -> Val {
    list![u.at("id")]
}
fn me(tb: &TacticalBattle) -> i64 {
    tb.me.i()
}
fn vu(tb: &TacticalBattle, side: &Val, u: &Val) -> bool {
    tb.seen_by.at(side).has(u.at("id"))
}

// ------------------------------------------------------------------ Maisons
#[test]
fn maisons_refus() {
    // (Python : Maisons.test_refus)
    let (mut tb, us) = calme(Val::None);
    bourg(&mut tb, false);
    let (u, cav) = (us.at("ligne"), us.at("cavalerie"));
    poser0(&cav, X0 + 80.0, Y0);
    assert_eq!(tb.order(me(&tb), &ids(&cav), "maisons", "any", &dict! {}), (false, "Seule l'infanterie occupe les maisons.".to_string()));
    poser0(&u, X0 + 400.0, Y0);
    assert_eq!(tb.order(me(&tb), &ids(&u), "maisons", "any", &dict! {}).1, "Aucune maison à moins de 60 m.");
    u.set("state", "melee");
    assert!(tb.why_maisons(&u, X0, Y0).0.contains("aux prises"));
    poser0(&u, X0 + 80.0, Y0);
    for c in tb.cells_near(X0, Y0, 60.0) {
        if tb.map.t[c as usize] as i64 == T_BATI {
            tb._bati_set(c, 2);
        }
    }
    assert_eq!(tb.why_maisons(&u, X0, Y0).0, "Ces maisons brûlent.");
}

#[test]
fn entrer_puis_sortir() {
    let (mut tb, us) = calme(Val::None);
    bourg(&mut tb, false);
    let u = us.at("ligne");
    poser(&u, X0 + 90.0, Y0, 0.0, Some(200.0));
    let (ok, msg) = tb.order(me(&tb), &ids(&u), "maisons", "any", &dict! {"x" => X0, "y" => Y0});
    assert!(ok, "{msg}");
    assert!(u.at("path").truthy());
    let (t0, mut entre) = (tb.clock, None);
    while tb.clock - t0 < 400.0 && u.at("form") != "maisons" {
        tb.step(BT::DT);
        if entre.is_none() && u.at("next_form") == "maisons" {
            entre = Some((tb.clock, u.atf("busy")));
        }
    }
    assert_eq!(u.at("form"), "maisons");
    let entre = entre.unwrap();
    assert!(15.0 <= entre.1 && entre.1 <= BT::MAISON_IN, "{entre:?}"); // 40 s au plus (moins pour des vétérans)
    assert!(py::hypot(u.atf("x") - X0, u.atf("y") - Y0) < 40.0);
    // tout ordre de marche l'en fait sortir : 30 s au plus avant de bouger
    let (x, y) = (u.atf("x"), u.atf("y"));
    tb.order(me(&tb), &ids(&u), "move", "any", &dict! {"x" => X0 + 300.0, "y" => Y0});
    assert_eq!(u.at("next_form"), "ligne");
    assert!(10.0 <= u.atf("busy") && u.atf("busy") <= BT::MAISON_OUT, "{}", u.at("busy"));
    tb.step(BT::DT);
    assert_eq!((u.atf("x"), u.atf("y")), (x, y));
    for _ in 0..py::int(BT::MAISON_OUT / BT::DT) + 2 {
        tb.step(BT::DT);
    }
    assert_eq!(u.at("form"), "ligne");
    assert!(py::hypot(u.atf("x") - x, u.atf("y") - y) > 1.0);
}

#[test]
fn capacite_et_couvert() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, true);
    let e = foe(&tb, &u, "inf");
    poser0(&e, X0 + 300.0, Y0);
    assert_eq!(tb._maisons(&u), (1.0, BT::BATI_COVER[0]));
    presque(tb._cover_vs(&u, &e), BT::BATI_COVER[0], 7, "couvert");
    u.set("men", 600.0); // 12 cases × 25 = 300 à l'abri
    let (occ, _cov) = tb._maisons(&u);
    presque(occ, 0.5, 7, "occupation");
    presque(tb._cover_vs(&u, &e), 0.5 * BT::BATI_COVER[0], 7, "couvert à moitié");
    u.set("men", 200.0);
    for c in tb.cells_near(X0, Y0, 60.0) {
        if tb.map.t[c as usize] as i64 == T_BATI {
            tb.bati[c as usize] = 3; // en ruine : on s'y tient, moins bien
        }
    }
    assert_eq!(tb._maisons(&u), (1.0, BT::BATI_COVER[3]));
    u.set("form", "ligne");
    assert_eq!(tb._cover_vs(&u, &e), 0.0); // (dans la rue, sans les maisons)
}

#[test]
fn cachee() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, false);
    let e = foe(&tb, &u, "inf");
    let es = e.at("side");
    poser0(&e, X0 + 140.0, Y0);
    u.set("form", "ligne");
    tb._update_vision();
    assert!(vu(&tb, &es, &u)); // en lisière : on la voit
    u.set("form", "maisons");
    tb._update_vision();
    assert!(!vu(&tb, &es, &u)); // derrière les volets, à 140 m
    u.set("fired_t", tb.clock - 30.0);
    tb._update_vision();
    assert!(vu(&tb, &es, &u)); // elle a tiré : vue 60 s
    u.set("fired_t", tb.clock - 61.0);
    poser0(&e, X0 + 100.0, Y0);
    tb._update_vision();
    assert!(vu(&tb, &es, &u)); // à moins de 120 m
    u.set("men", 650.0);
    poser0(&e, X0 + 140.0, Y0);
    tb._update_vision();
    assert!(vu(&tb, &es, &u)); // la moitié dans la rue : elle se voit
}

#[test]
fn feu_par_les_fenetres() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, true);
    let e = foe(&tb, &u, "inf");
    poser(&e, X0 + 90.0, Y0, PI, None);
    tb._update_vision();
    let salve = |tb: &mut TacticalBattle, form: &str| {
        regle!(u, form = form, reload = 0.0, ammo = 50.0, target = e.at("id"), dir = 0.0, fat = 0.0);
        regle!(e, men = 500.0, men0 = 500.0);
        let lost = e.atf("lost");
        tb.smoke.iter_mut().for_each(|s| *s = 0.0); // (l'air clair : la fumée de la salve d'avant fausserait le rapport)
        tb._fire(&u, BT::DT, false);
        e.atf("lost") - lost
    };
    let k = salve(&mut tb, "maisons") / salve(&mut tb, "ligne");
    presque(k, 0.6 / (1.0 + tb.tech_of(&u).get_or("ligne_fire", 0.0).f()), 6, "feu par les fenêtres");
}

#[test]
fn corps_a_corps() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, true);
    let e = foe(&tb, &u, "inf");
    poser0(&e, X0 + 20.0, Y0);
    let k = tb._melee_k(&u, &e);
    u.set("form", "ligne");
    presque(k / tb._melee_k(&u, &e), BT::MAISON_MELEE, 7, "maisons");
    regle!(u, form = "maisons", men = 600.0);
    presque(k / tb._melee_k(&u, &e), BT::MAISON_MELEE / (1.0 + 0.6 * 0.5), 7, "à moitié dans la rue");
}

#[test]
fn pas_de_charge_de_cavaliers() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, false);
    let cav = foe(&tb, &u, "cavalerie");
    poser0(&cav, X0 + 150.0, Y0);
    tb._update_vision();
    u.set("fired_t", tb.clock); // (repérée : elle tire)
    tb._update_vision();
    let (ok, msg) = tb.order(cav.ati("side"), &ids(&cav), "charge", "any", &dict! {"target" => u.at("id")});
    assert!(!ok);
    assert!(msg.contains("ne chargent pas des maisons"), "{msg}");
    assert!(!AI::_charge_ok(&mut tb, cav.ati("side"), &cav, &u));
    // une charge déjà lancée (avant qu'elle n'y entre) meurt au pied des maisons
    let (men, mor) = (u.at("men"), u.at("morale"));
    cav.set("charge_v", 110.0);
    tb._impact(&cav, &u);
    assert_eq!((u.at("men"), u.at("morale"), u.at("state")), (men, mor, Val::from("repos")));
    assert_eq!(cav.at("order"), dict! {"kind" => "hold"});
}

#[test]
fn maison_en_feu() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, false);
    tb._bati_set(case(u.atf("x"), u.atf("y")), 2);
    tb._incendie();
    assert_eq!(u.at("form"), "ligne");
    assert_eq!(u.at("order"), dict! {"kind" => "hold"});
}

#[test]
fn deroute_et_retraite() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, false);
    tb._rout(&u);
    assert_eq!(u.at("form"), "ligne");
    dedans(&mut tb, &u, 200.0, false);
    tb._retreat(&u);
    assert_eq!(u.at("next_form"), "ligne");
}

/// u arrêtée face à l'est, le bourg 40 m derrière elle (de quoi se barricader) ; le front est dégagé.
/// (Python : `front(tb, u, d=0.0, men=300)`.)
fn front(tb: &mut TacticalBattle, u: &Val) {
    bourg(tb, false);
    poser(u, X0 + 80.0, Y0, 0.0, Some(300.0));
    regle!(u, form = "ligne", fat = 0.0, order = dict! {"kind" => "hold"});
}

fn cases_barr(b: &Val) -> Vec<i64> {
    b.at("c").iter().map(|cp| cp.ati(0)).collect()
}
fn centre(c: i64) -> (f64, f64) {
    ((py::mod_i(c, COLS) as f64 + 0.5) * CELLF, (py::floordiv_i(c, COLS) as f64 + 0.5) * CELLF)
}

// ------------------------------------------------------------------ Barricades
#[test]
fn barricades_refus() {
    // (Python : Barricades.test_refus)
    let (mut tb, us) = calme(Val::None);
    let (u, cav, sap) = (us.at("ligne"), us.at("cavalerie"), us.at("sapeurs"));
    front(&mut tb, &u);
    poser0(&cav, X0 + 100.0, Y0 + 100.0);
    assert_eq!(tb.why_barricade(&cav), "Seule l'infanterie dresse des barricades.");
    u.set("path", list![tup![X0 + 300.0, Y0]]);
    u.set("state", "marche");
    assert_eq!(tb.why_barricade(&u), "Il faut d'abord qu'elle s'arrête.");
    poser0(&u, X0 + 100.0, Y0);
    let e = foe(&tb, &u, "inf");
    poser0(&e, X0 + 280.0, Y0);
    tb._update_vision();
    assert!(tb.why_barricade(&u).contains("L'ennemi est trop près"));
    poser0(&e, 100.0, 60.0);
    tb._update_vision();
    assert_eq!(tb.why_barricade(&u), "");
    poser0(&u, X0 + 300.0, Y0); // en rase campagne, loin de tout
    assert!(tb.order(me(&tb), &ids(&u), "barricade", "any", &dict! {}).1.contains("Rien pour se barricader"));
    poser0(&sap, X0 + 300.0, Y0 + 100.0);
    assert_eq!(tb.why_barricade(&sap), ""); // les sapeurs, partout
    poser0(&u, X0 + 100.0, Y0);
    peindre(&mut tb, X0 + 125.0, Y0, 80.0, T_EAU);
    assert!(tb.why_barricade(&u).contains("Pas de terrain"));
}

#[test]
fn abattis_pres_des_bois() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    peindre(&mut tb, X0, Y0, 400.0, T_PRE);
    peindre(&mut tb, X0 - 40.0, Y0, 25.0, T_BOIS);
    poser0(&u, X0, Y0);
    assert_eq!(tb._barr_style(&u), "b");
    poser0(&u, X0 + 100.0, Y0);
    assert!(matches!(tb._barr_style(&u), Val::Bool(false)));
}

#[test]
fn duree_et_cases() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let (ok, msg) = tb.order(me(&tb), &ids(&u), "barricade", "any", &dict! {});
    assert!(ok, "{msg}");
    assert_eq!(u.at("order").at("need"), BT::BARR_T);
    while tb.clock - u.at("order").atf("t0") < BT::BARR_T - 4.0 {
        tb.step(BT::DT);
    }
    assert!(!tb.barr.truthy());
    for _ in 0..3 {
        tb.step(BT::DT);
    }
    assert_eq!(tb.barr.len(), 1);
    let b = tb.barr.at(0);
    assert_eq!((b.at("u"), b.at("s")), (u.at("id"), Val::from("v")));
    let cells = cases_barr(&b);
    let w = U::footprint(&u).0;
    assert!(cells.len() as i64 >= py::int(py::floordiv_f(w, CELLF))); // toute la largeur du front
    for &c in &cells {
        assert_eq!(tb.map.t[c as usize] as i64, T_BARRICADE);
        let x = (py::mod_i(c, COLS) as f64 + 0.5) * CELLF;
        assert!(u.atf("x") + 10.0 <= x && x <= u.atf("x") + 40.0, "{x}"); // 10 à 20 m devant le front (6 m)
    }
    assert_eq!(kind(&u), "hold");
    assert_eq!(tb.why_barricade(&u), "Elle a déjà sa barricade.");
    // sapeurs : deux minutes ; fatigués : ×1,3
    let sap = us.at("sapeurs");
    poser0(&sap, X0 + 100.0, Y0 + 300.0);
    sap.set("fat", 60.0);
    assert!(tb.order(me(&tb), &ids(&sap), "barricade", "any", &dict! {}).0);
    presque(sap.at("order").atf("need"), BT::BARR_T_SAP * BT::BARR_FAT, 7, "sapeurs fatigués");
}

#[test]
fn interrompue() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    tb.order(me(&tb), &ids(&u), "barricade", "any", &dict! {});
    tb.step(BT::DT);
    let e = foe(&tb, &u, "inf");
    poser0(&e, u.atf("x") + 140.0, u.atf("y"));
    tb._update_vision();
    tb.step(BT::DT);
    assert_eq!(kind(&u), "hold");
    poser0(&e, 100.0, 60.0);
    tb._update_vision();
    tb.order(me(&tb), &ids(&u), "barricade", "any", &dict! {});
    tb.order(me(&tb), &ids(&u), "move", "any", &dict! {"x" => u.at("x"), "y" => u.atf("y") + 100.0});
    for _ in 0..py::int(BT::BARR_T / BT::DT) + 5 {
        tb.step(BT::DT);
    }
    assert!(!tb.barr.truthy());
}

#[test]
fn seulement_sur_le_decouvert() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let ahead = u.atf("x") + 6.0 + BT::BARR_D;
    let mut interdits = HashSet::new();
    for (k, t) in [T_EAU, T_BATI, T_MUR, T_BOIS].into_iter().enumerate() {
        let c = case(ahead, u.atf("y") - 45.0 + 30.0 * k as f64);
        tb.map.t[c as usize] = t as u8;
        interdits.insert(c);
    }
    let (cells, _pts) = tb._barr_line(&u);
    assert!(!cells.is_empty());
    for &c in &cells {
        assert!(BT::BARR_ON.contains(&(tb.map.t[c as usize] as i64)));
    }
    assert!(!cells.iter().any(|c| interdits.contains(c)));
    // jamais dans la zone de déploiement de l'assaillant
    let z = tb.zones.at(0);
    poser0(&u, (z.atf(0) + z.atf(2)) / 2.0, (z.atf(1) + z.atf(3)) / 2.0);
    peindre(&mut tb, u.atf("x"), u.atf("y"), 100.0, T_PRE);
    assert_eq!(tb._barr_line(&u).0, Vec::<i64>::new());
}

/// (Python : la méthode Barricades.bati) La barricade de u, faite tout de suite par un pas de la bataille : ses cases.
fn bati(tb: &mut TacticalBattle, u: &Val) -> Vec<i64> {
    tb.order(me(tb), &ids(u), "barricade", "any", &dict! {});
    u.at("order").set("t0", tb.clock - BT::BARR_T);
    tb.step(BT::DT);
    assert_eq!(tb.barr.len(), 1);
    cases_barr(&tb.barr.at(0))
}

#[test]
fn cavaliers_et_canons_ne_passent_pas() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let c = bati(&mut tb, &u)[0];
    let (x, y) = centre(c);
    assert!(tb.passable(x, y, "inf", 0));
    assert!(!tb.passable(x, y, "cavalerie", 0));
    assert!(!tb.passable(x, y, "artillerie", 0));
}

#[test]
fn la_charge_se_brise() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let cav = foe(&tb, &u, "cavalerie");
    let choc = |tb: &mut TacticalBattle| {
        regle!(u, men = 300.0, men0 = 300.0);
        regle!(u, morale = 30.0, ammo = 0.0, state = "repos", lost = 0.0); // ébranlée, sans cartouches : elle romprait
        poser(&cav, u.atf("x") + 60.0, u.atf("y"), PI, Some(300.0));
        regle!(cav, morale = 80.0, fat = 0.0, charge_v = 110.0, state = "charge");
        tb._impact(&cav, &u);
        u.atf("lost")
    };
    let sans = choc(&mut tb);
    assert_eq!(u.at("state"), "deroute");
    regle!(u, state = "repos", order = dict! {"kind" => "hold"});
    bati(&mut tb, &u);
    let avec = choc(&mut tb);
    assert_ne!(u.at("state"), "deroute"); // elle ne la rompt pas
    assert_eq!(cav.at("order"), dict! {"kind" => "hold"}); // les cavaliers tournent bride
    presque(avec / sans, BT::BARR_CHOC, 3, "choc derrière la barricade");
}

/// Avance le hasard de la bataille jusqu'à ce que son prochain tirage (`rng.random()`) vérifie `voulu`.
/// (Le Python remplace `tb.rng` par un dé qui rend toujours la même valeur ; `Random` ne se remplace pas en Rust.)
fn de_qui_rend(tb: &mut TacticalBattle, voulu: impl Fn(f64) -> bool) {
    while !voulu(tb.rng.clone().random()) {
        tb.rng.random();
    }
}

#[test]
fn le_boulet_la_renverse() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let cells = bati(&mut tb, &u);
    let art = foe(&tb, &u, "inf"); // (le tireur : pour l'obus seulement)
    let seq = tb.seq;
    let (x, y) = centre(cells[0]);
    de_qui_rend(&mut tb, |v| v >= BT::BARR_CASSE); // (le dé du Python : 0,3)
    tb._bati_hit(x, y, &art);
    assert_eq!(tb.map.t[cells[0] as usize] as i64, T_BARRICADE); // trois fois sur quatre, elle tient
    de_qui_rend(&mut tb, |v| v < BT::BARR_CASSE); // (0,2)
    tb._bati_hit(x, y, &art);
    assert_eq!(tb.map.t[cells[0] as usize] as i64, T_PRE);
    assert!(tb.passable(x, y, "cavalerie", 0));
    let v = tb.view(&tb.me.clone(), seq);
    assert_eq!(v.at("barr_t"), list![list![cells[0], T_PRE]]);
    assert_eq!(v.at("barr").len(), 1);
    assert_eq!(tb.why_barricade(&u), "Elle a déjà sa barricade."); // (il en reste)
}

#[test]
fn sauvegarde() {
    let (mut tb, us) = calme(Val::None);
    let (u, v) = (us.at("ligne"), us.at("sapeurs"));
    front(&mut tb, &u);
    poser0(&v, X0, Y0);
    v.set("form", "maisons");
    let cells = bati(&mut tb, &u);
    tb._barr_set(cells[0], T_PRE); // (un boulet l'a renversée là)
    let d = par_json(&tb.to_dict());
    let mut tb2 = TacticalBattle::from_dict(geo(), &d).unwrap();
    assert_eq!(tb2.barr_prev, tb.barr_prev);
    let t = |tb: &TacticalBattle| cells.iter().map(|&c| tb.map.t[c as usize]).collect::<Vec<u8>>();
    assert_eq!(t(&tb2), t(&tb));
    assert_eq!(tb2.map.t[cells[1] as usize] as i64, T_BARRICADE);
    assert_eq!(tb2.map.t[cells[0] as usize], tb.map.t[cells[0] as usize]);
    let (x, y) = centre(cells[1]);
    assert!(!tb2.passable(x, y, "cavalerie", 0));
    assert_eq!(tb2.by_id.at(v.at("id")).at("form"), "maisons");
    assert_eq!(tb2.map_view().at("barr"), tb.barr);
}

fn vue_de(tb: &TacticalBattle, u: &Val) -> Val {
    tb.view(&tb.me, 0).at("units").iter().find(|x| x.at("id") == u.at("id")).unwrap()
}

#[test]
fn vue() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    front(&mut tb, &u);
    let d = vue_de(&tb, &u);
    assert!(matches!(d.at("can_barricade"), Val::Bool(true)));
    assert!(matches!(d.at("can_occupy"), Val::Bool(true))); // (le bourg à 100 m : maisons à 60 m)
    poser0(&u, X0 + 300.0, Y0);
    let d = vue_de(&tb, &u);
    assert!(d.at("can_barricade").s().contains("Rien pour se barricader"));
    assert_eq!(d.at("can_occupy"), "Aucune maison à moins de 60 m.");
    assert!(!vue_de(&tb, &us.at("cavalerie")).has("can_occupy"));
}

// ------------------------------------------------------------------ IA
#[test]
fn la_garnison_occupe_les_maisons() {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1790", "kind" => "forteresse", "role" => "att", "seed" => 1,
    "units" => dict!{"ligne" => 2, "artillerie" => 1}});
    tb.start();
    let mem = tb.ai_mem.at("s1");
    let gar: Vec<Val> = tb
        .units
        .iter()
        .filter(|u| u.at("side") == 1 && u.at("cls") == "inf" && AI::ABRI_ROLES().has(mem.at("role").get(u.at("id"))) && tb.why_maisons(u, u.atf("x"), u.atf("y")).0.is_empty())
        .collect();
    assert!(!gar.is_empty(), "pas de garnison près des maisons");
    let u = &gar[0];
    poser0(u, u.atf("x"), u.atf("y"));
    let att = tb.units.iter().find(|e| e.at("side") == 0 && e.at("cls") == "inf").unwrap();
    poser0(&att, u.atf("x") + 2000.0, u.atf("y"));
    AI::_abris(&mut tb, 1, &mem, &list![u], &list![&att], &Val::new_set());
    assert_ne!(kind(u), "maisons"); // l'ennemi est loin : rien
    poser0(&att, u.atf("x") + 500.0, u.atf("y"));
    let busy = Val::new_set();
    AI::_abris(&mut tb, 1, &mem, &list![u], &list![&att], &busy);
    assert_eq!(kind(u), "maisons");
    assert!(busy.has(u.at("id")));
    assert!(AI::_tenue(u));
}

#[test]
fn le_defenseur_se_barricade_devant_des_cavaliers() {
    let (mut tb, us) = calme(Val::None);
    let cav = us.at("cavalerie");
    let u = foe(&tb, &cav, "inf"); // (une infanterie du défenseur)
    u.set("ctrl", "ia");
    front(&mut tb, &u);
    poser0(&cav, u.atf("x") + 600.0, u.atf("y"));
    let mem = dict! {"plan" => "tenir", "role" => dict!{}};
    assert_eq!(u.at("side"), 1);
    AI::_abris(&mut tb, 1, &mem, &list![&u], &list![], &Val::new_set());
    assert_eq!(kind(&u), "hold"); // pas de cavaliers en vue : rien
    regle!(cav, state = "marche", dir = PI); // (ils viennent droit sur elle)
    AI::_abris(&mut tb, 1, &mem, &list![&u], &list![&cav], &Val::new_set());
    assert_eq!(kind(&u), "barricade");
}

#[test]
fn l_assaillant_ne_se_barricade_pas() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    u.set("ctrl", "ia");
    front(&mut tb, &u);
    let cav = foe(&tb, &u, "cavalerie");
    poser0(&cav, u.atf("x") + 600.0, u.atf("y"));
    regle!(cav, state = "marche", dir = PI);
    AI::_abris(&mut tb, 0, &dict! {"plan" => "assaut", "role" => dict!{}}, &list![&u], &list![&cav], &Val::new_set());
    assert_eq!(kind(&u), "hold");
}

#[test]
fn les_legers_ne_se_barricadent_pas() {
    let (mut tb, us) = calme(Val::None);
    let cav = us.at("cavalerie");
    let d = foe(&tb, &cav, "inf");
    regle!(d, ctrl = "ia", light = true); // (des légers du défenseur)
    front(&mut tb, &d);
    poser0(&cav, d.atf("x") + 600.0, d.atf("y"));
    regle!(cav, state = "marche", dir = PI);
    assert_eq!(tb.why_barricade(&d), "");
    AI::_abris(&mut tb, 1, &dict! {"plan" => "tenir", "role" => dict!{}}, &list![&d], &list![&cav], &Val::new_set());
    assert_eq!(kind(&d), "hold");
}

#[test]
fn l_ia_laisse_les_troupes_a_l_abri() {
    let (mut tb, us) = calme(Val::None);
    let u = us.at("ligne");
    dedans(&mut tb, &u, 200.0, false);
    let mem = dict! {"blocked" => dict!{}};
    AI::_goto(&mut tb, u.ati("side"), &mem, &u, u.atf("x") + 400.0, u.atf("y"), &Val::None, false, 22.0);
    assert_eq!(u.at("form"), "maisons");
    assert!(!u.at("path").truthy());
}

/// u se barricade tout de suite (le travail est fait) : ses cases.
fn barricade_faite(tb: &mut TacticalBattle, u: &Val) -> Vec<i64> {
    tb.order(u.ati("side"), &ids(u), "barricade", "any", &dict! {});
    u.at("order").set("t0", tb.clock - BT::BARR_T);
    tb._barricading(u);
    cases_barr(&tb.barr.at(-1))
}

// ------------------------------------------------------------------ Assaillant
// L'IA devant une barricade ou des maisons : canons, cavalerie, infanterie ; le défenseur ne s'en sert pas partout.

/// (Python : la méthode Assaillant.scene)
fn scene() -> (Box<TacticalBattle>, Val, Val, Vec<i64>) {
    let (mut tb, us) = calme(Val::None);
    let cav = us.at("cavalerie");
    let d = foe(&tb, &cav, "inf"); // (le défenseur, face à l'est)
    front(&mut tb, &d);
    let cells = barricade_faite(&mut tb, &d);
    (tb, us, d, cells)
}

/// Les deux bouts de la barricade de d fermés par l'eau.
fn bouts_fermes(tb: &mut TacticalBattle, d: &Val) {
    let w = U::footprint(d).0;
    for s in [-1.0, 1.0] {
        peindre(tb, d.atf("x"), d.atf("y") + s * (w / 2.0 + 60.0), 50.0, T_EAU);
    }
}

#[test]
fn le_boulet_ouvre_une_breche() {
    let (mut tb, us) = calme(dict! {"ligne" => 1, "cavalerie" => 1, "artillerie" => 1});
    let gun = us.at("artillerie");
    let gs = gun.ati("side");
    let d = foe(&tb, &gun, "inf");
    front(&mut tb, &d);
    let cells = barricade_faite(&mut tb, &d);
    poser(&gun, d.atf("x") + 400.0, d.atf("y"), PI, None);
    gun.set("form", "batterie");
    let (x, y) = centre(cells[2]);
    assert_eq!(tb.order(gs, &ids(&gun), "bombard", "any", &dict! {"x" => x, "y" => y}), (true, "On bat la barricade.".to_string()));
    let (e, mx, _g) = tb.ranges(&gun);
    let (e, mx) = (e as f64, mx as f64);
    assert!(AI::_barr_cible(&tb, gs, &gun, &list![&gun], e).is_none()); // (pas de fantassin devant elle)
    let inf = us.at("ligne");
    poser(&inf, d.atf("x") + 250.0, d.atf("y"), PI, None);
    assert!(AI::_barr_cible(&tb, gs, &gun, &list![&inf], e).is_some());
    let breche = |tb: &TacticalBattle| cells.iter().any(|&c| !tb.barr_prev.has(c));
    for _ in 0..12 {
        regle!(gun, reload = 0.0, ammo = 50.0);
        assert!(tb._bombard(&gun, e, mx, &tup![x, y]));
        if breche(&tb) {
            break;
        }
    }
    assert!(breche(&tb), "une brèche en douze volées");
    assert!(AI::_barr_cible(&tb, gs, &gun, &list![&inf], e).is_none()); // (la brèche est ouverte : on cesse)
}

#[test]
fn la_cavalerie_ne_charge_pas_de_face_et_tourne_la_barricade() {
    let (mut tb, us, d, _cells) = scene();
    let cav = us.at("cavalerie");
    let cs = cav.ati("side");
    poser(&cav, d.atf("x") + 250.0, d.atf("y"), PI, None);
    assert!(!AI::_charge_ok(&mut tb, cs, &cav, &d)); // derrière sa barricade
    let pt = AI::_barrage(&mut tb, cs, &cav, &d, 0.0);
    assert!(pt.is_tuple()); // par un bout, à hauteur de la troupe
    assert!((pt.atf(0) - d.atf("x")).abs() < 40.0);
    poser(&cav, pt.atf(0), pt.atf(1), (d.atf("y") - pt.atf(1)).atan2(d.atf("x") - pt.atf(0)), None);
    assert!(AI::_charge_ok(&mut tb, cs, &cav, &d)); // de là, de flanc : elle charge
    // les deux bouts fermés (l'eau) : elle attend l'infanterie
    poser(&cav, d.atf("x") + 250.0, d.atf("y"), PI, None);
    bouts_fermes(&mut tb, &d);
    assert!(AI::_barrage(&mut tb, cs, &cav, &d, 0.0).is_none());
    // des maisons : jamais
    let e = foe(&tb, &cav, "inf");
    dedans(&mut tb, &e, 200.0, false);
    poser0(&cav, e.atf("x") + 200.0, e.atf("y"));
    assert!(!AI::_charge_ok(&mut tb, cs, &cav, &e));
}

#[test]
fn l_infanterie_passe_par_la_breche_sinon_par_un_bout_sinon_en_force() {
    let (mut tb, us, d, cells) = scene();
    let inf = us.at("ligne");
    let is = inf.ati("side");
    poser(&inf, d.atf("x") + 200.0, d.atf("y"), PI, None);
    let pt = AI::_barrage(&mut tb, is, &inf, &d, 1.0);
    assert!(pt.is_tuple());
    assert!((pt.atf(0) - d.atf("x")).abs() < 40.0); // (la barricade ne ferme pas le passage)
    bouts_fermes(&mut tb, &d);
    assert!(AI::_barrage(&mut tb, is, &inf, &d, 1.0).is_none()); // elle ferme la route : on attend les canons
    assert_eq!(AI::_barrage(&mut tb, is, &inf, &d, 3.0), "front"); // … sauf à trois contre un
    tb._barr_set(cells[cells.len() / 2], T_PRE); // un boulet y ouvre une brèche
    poser(&inf, d.atf("x") + 150.0, d.atf("y") + 100.0, PI, None); // (face à une case encore debout)
    let pt = AI::_barrage(&mut tb, is, &inf, &d, 1.0);
    assert!(pt.is_tuple());
    assert!(pt.atf(0) > d.atf("x") + 40.0); // devant la brèche, dans son axe
    assert!(AI::_barr_libre(&tb, pt.atf(0), pt.atf(1), &d));
    poser(&inf, pt.atf(0), pt.atf(1), PI, None);
    assert_eq!(AI::_barrage(&mut tb, is, &inf, &d, 1.0), "ok"); // de là, plus rien devant elle
}

#[test]
fn la_baionnette_tourne_la_barricade() {
    let (mut tb, us, d, _cells) = scene();
    let inf = us.at("ligne");
    let is = inf.ati("side");
    inf.set("ctrl", "ia");
    poser(&inf, d.atf("x") + 110.0, d.atf("y"), PI, Some(400.0));
    inf.set("order", dict! {"kind" => "hold"});
    let role = dict! {};
    role.set(inf.at("id"), "assaut");
    let mem = dict! {"role" => role, "plan" => "assaut", "blocked" => dict!{}};
    let lv = AI::LEVELS().at("normal");
    AI::_bayonets(&mut tb, is, &mem, &lv, &list![&inf], &list![&d], &dict! {}, &Val::new_set());
    assert_eq!(kind(&inf), "move"); // elle va au bout, pas à la baïonnette
    assert!((inf.at("goal").atf(0) - d.atf("x")).abs() < 40.0);
    bouts_fermes(&mut tb, &d);
    poser(&inf, d.atf("x") + 110.0, d.atf("y"), PI, Some(400.0));
    inf.set("order", dict! {"kind" => "hold"});
    AI::_bayonets(&mut tb, is, &mem, &lv, &list![&inf], &list![&d], &dict! {}, &Val::new_set());
    assert_eq!(kind(&inf), "hold"); // la route fermée : on attend les canons
}

#[test]
fn les_canons_visent_les_maisons_reperees() {
    let (mut tb, us) = calme(dict! {"ligne" => 2, "artillerie" => 1});
    let gun = us.at("artillerie");
    let ab: Vec<Val> = tb.units.iter().filter(|x| x.at("side") != gun.at("side") && x.at("cls") == "inf").take(2).collect();
    let (a, b2) = (&ab[0], &ab[1]);
    bourg(&mut tb, false);
    poser0(a, X0, Y0);
    a.set("form", "maisons");
    poser0(b2, X0, Y0 + 300.0);
    poser(&gun, X0 + 500.0, Y0 + 150.0, PI, None);
    let mem = dict! {"plan" => "tenir", "ord" => dict!{}, "pt" => Val::None};
    let (e, mx, g) = tb.ranges(&gun);
    let tgt = AI::_art_target(&mut tb, &gun, &list![a, b2], &list![], &mem, mx as f64, e as f64, &g, 1.6);
    assert!(tgt.is(a));
}

#[test]
fn le_defenseur_ne_se_barricade_pas_partout() {
    let (mut tb, us) = calme(dict! {"ligne" => 4, "cavalerie" => 1});
    let cav = us.at("cavalerie");
    let ds: Vec<Val> = tb.units.iter().filter(|x| x.at("side") != cav.at("side") && x.at("cls") == "inf" && !x.at("light").truthy()).collect();
    peindre(&mut tb, X0, Y0, 600.0, T_PRE);
    for (k, d) in ds.iter().enumerate() {
        poser0(d, X0, Y0 + 150.0 * k as f64); // (hors de la zone de l'assaillant)
        regle!(d, ctrl = "ia", order = dict! {"kind" => "hold"});
        peindre(&mut tb, d.atf("x") - 60.0, d.atf("y"), 20.0, T_BATI); // (des maisons derrière chacun)
    }
    assert!(ds.iter().filter(|d| tb.why_barricade(d).is_empty()).count() >= 2);
    poser0(&cav, X0 + 350.0, Y0);
    regle!(cav, state = "marche", dir = PI);
    let lds: Val = ds.iter().cloned().collect();
    AI::_abris(&mut tb, 1, &dict! {"plan" => "tenir", "role" => dict!{}}, &lds, &list![&cav], &Val::new_set());
    assert_eq!(ds.iter().filter(|d| kind(d) == "barricade").count() as i64, 1.max(ds.len() as i64 / AI::ABRI_PART));
}
