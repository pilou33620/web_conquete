//! Banc d'essai des dégâts aux bâtiments et des canons sur les murailles (SPEC-2D § 5) : porté de tests/test_degats.py.
//!
//! Une maison sous le canon s'entame, brûle, gagne ses voisines et tombe en ruine ; une maison en feu ne couvre plus et
//! chasse ses occupants ; une ruine couvre moins qu'une maison et laisse mieux passer la vue. Le client reçoit les
//! changements dans `bati` (depuis since), l'état complet avec la carte ; la sauvegarde les garde. Dans une place à
//! enceinte, l'artillerie du défenseur est sur le rempart, tournée vers le dehors, et n'en bouge pas.

mod fabrique;

use conquete::py::{self, Val};
use conquete::tactics::battle::{self as BT, TacticalBattle};
use conquete::tactics::terrain::{cell_of, center_of, COLS, N, T_BATI, T_MUR, T_PRE};
use conquete::{dict, list};
use fabrique::*;
use std::f64::consts::PI;

/// Un siège (mode Bataille, place forte de 1790) : la TacticalBattle. (Python : `place(role='att', seed=1, demarree=True)`.)
fn place(role: &str, seed: i64, demarree: bool) -> Box<TacticalBattle> {
    let (_g, mut tb) = escarmouche(&dict! {"me" => "33", "foe" => "24", "era" => "1790", "kind" => "forteresse", "role" => role, "seed" => seed,
    "units" => dict!{"ligne" => 2, "artillerie" => 2}});
    if demarree {
        tb.start();
    }
    tb
}
fn place0() -> Box<TacticalBattle> {
    place("att", 1, true)
}

/// Une case bâtie sans haie ni muret qui a au moins `voisines` cases bâties autour d'elle (dans le bourg).
fn maison(tb: &TacticalBattle, voisines: usize) -> usize {
    let t = &tb.map.t;
    let c0 = COLS as usize;
    for c in c0..N as usize - c0 {
        if t[c] as i64 == T_BATI && tb.map.f[c] == 0 && [c - 1, c + 1, c - c0, c + c0].iter().filter(|&&cc| t[cc] as i64 == T_BATI).count() >= voisines {
            return c;
        }
    }
    panic!("pas de maison dans la place")
}

/// Fait passer `duree` secondes de bataille à l'incendie seul (sans le reste de la bataille).
fn brule(tb: &mut TacticalBattle, duree: f64) {
    for _ in 0..py::int(py::floordiv_f(duree, BT::FEU_DT)) {
        tb.clock += BT::FEU_DT;
        tb._incendie();
    }
}

fn artillerie(tb: &TacticalBattle, side: i64) -> Val {
    tb.units.iter().find(|u| u.at("cls") == "artillerie" && u.at("side") == side).unwrap()
}

/// Toujours la même suite de coups : vingt boulets sur une maison, puis deux heures d'incendie.
fn scenario(tb: &mut TacticalBattle) -> Val {
    let art = artillerie(tb, 0);
    let c = maison(tb, 2);
    for _ in 0..20 {
        let (x, y) = center_of(c);
        tb._bati_hit(x, y, &art);
    }
    tb._bati_set(c as i64, 2);
    brule(tb, 7200.0);
    tb.bati_log.clone()
}

// ------------------------------------------------------------------ Maisons
#[test]
fn un_boulet_sur_une_maison() {
    let mut tb = place0();
    let art = artillerie(&tb, 0);
    let cible = tb.units.iter().find(|u| u.at("side") == 1 && u.at("cls") == "inf").unwrap();
    let c = maison(&tb, 2);
    let (cx, cy) = center_of(c);
    cible.set("x", cx);
    cible.set("y", cy);
    art.set("x", cx + 300.0);
    art.set("y", cy);
    art.set("dir", PI);
    for (k, v) in [("form", Val::from("batterie")), ("shot", "boulet".into()), ("fire_mode", "free".into()), ("ammo", 50.into()), ("state", "repos".into()), ("order", Val::None)] {
        art.set(k, v);
    }
    // (on ne teste que le boulet, pas le repérage : le Python remplace tb._pick_target par `lambda u, mx: cible` ; ici
    // la cible est celle de la batterie, repérée, en vue — _pick_target la garde)
    art.set("target", cible.at("id"));
    tb.seen_by.at(0).push(cible.at("id"));
    let (c1, c2) = (BT::TacticalBattle::cell(art.atf("x"), art.atf("y")).min(c as i64), BT::TacticalBattle::cell(art.atf("x"), art.atf("y")).max(c as i64));
    let h = BT::HEIGHT();
    let (e1, e2) = if c1 == c as i64 { (h.at("inf").f(), h.at("artillerie").f()) } else { (h.at("artillerie").f(), h.at("inf").f()) };
    tb._los_cache.insert((c1, c2, e1.to_bits(), e2.to_bits()), true);
    let autour: Vec<usize> = (0..N as usize).filter(|&cc| tb.map.t[cc] as i64 == T_BATI && { let p = center_of(cc); py::dist(p.0, p.1, cx, cy) < 80.0 }).collect();
    for _ in 0..60 {
        art.set("reload", 0.0);
        tb._fire(&art, BT::DT, false);
        if autour.iter().any(|&cc| tb.bati[cc] != 0) {
            break;
        }
    }
    assert!(autour.iter().any(|&cc| tb.bati[cc] != 0), "la maison visée ou une voisine est touchée");
    assert!(tb.fx.iter().any(|e| e.at("k") == "canon"));
}

#[test]
fn les_ruines_restent_apres_la_bataille() {
    let tb = place0();
    let mut tb = tb;
    let cs = tb.cases_ville();
    assert!(!cs.is_empty());
    assert_eq!(tb.degats_ville(), 0.0);
    for &c in &cs[..cs.len() / 2] {
        tb.bati[c as usize] = 3;
    }
    assert!((tb.degats_ville() - (cs.len() / 2) as f64 / cs.len() as f64).abs() < 1e-7);
    // la bataille suivante dans la même place commence avec ses ruines (nodes[].deg)
    let d = par_json(&tb.to_dict());
    let pl = d.at("spec").get("place").or(dict! {}).copy();
    pl.set("deg", 0.5);
    d.at("spec").set("place", pl);
    d.set("bati", list![]);
    let tb2 = TacticalBattle::from_dict(geo(), &d).unwrap();
    let cs2 = tb2.cases_ville();
    let part = cs2.iter().filter(|&&c| tb2.bati[c as usize] == 3).count() as f64 / cs2.len() as f64;
    assert!((part - 0.5).abs() <= 0.1, "{part}");
}

#[test]
fn les_boulets_tombent_court_ou_long() {
    let mut tb = place0();
    let art = artillerie(&tb, 0);
    let (x, y) = center_of(maison(&tb, 2));
    art.set("x", x + 400.0);
    art.set("y", y);
    let pts: Vec<(f64, f64)> = (0..400).map(|_| tb._chute(&art, x, y)).collect();
    let axe: Vec<f64> = pts.iter().map(|p| p.0 - x).collect();
    let cote: Vec<f64> = pts.iter().map(|p| p.1 - y).collect();
    let sd = |v: &[f64]| (py::sum(v.iter().map(|a| a * a)) / v.len() as f64).sqrt();
    assert!((sd(&axe) - (15.0 + 0.07 * 400.0)).abs() <= 8.0); // dans l'axe du tir…
    assert!((sd(&cote) - (5.0 + 0.02 * 400.0)).abs() <= 4.0); // … et moins de côté
    let mut tb2 = place0();
    let art2 = artillerie(&tb2, 0);
    art2.set("x", art.at("x"));
    art2.set("y", art.at("y"));
    let pts2: Vec<(f64, f64)> = (0..20).map(|_| tb2._chute(&art2, x, y)).collect();
    assert_eq!(pts[..20].to_vec(), pts2, "même graine, mêmes points de chute");
}

#[test]
fn les_coups_longs_tombent_dans_la_ville() {
    let mut tb = place0();
    let pl = tb.map.place.clone();
    let (plx, ply) = (pl.atf("x"), pl.atf("y"));
    let art = artillerie(&tb, 0);
    let murs: Vec<usize> = (0..N as usize).filter(|&c| tb.map.t[c] as i64 == T_MUR).collect();
    // la case à 40 m derrière le mur c, vers le centre de la place
    let derriere = |c: usize| {
        let (x, y) = center_of(c);
        let k = 40.0 / py::hypot(x - plx, y - ply);
        cell_of(x - (x - plx) * k, y - (y - ply) * k)
    };
    // le mur le plus à l'est, des maisons derrière lui (max : le premier gagne)
    let mut w: Option<usize> = None;
    for &c in murs.iter().filter(|&&c| tb.map.t[derriere(c) as usize] as i64 == T_BATI) {
        if w.is_none_or(|w| center_of(c).0 > center_of(w).0) {
            w = Some(c);
        }
    }
    let (wx, wy) = center_of(w.unwrap());
    let a = (wy - ply).atan2(wx - plx);
    art.set("x", wx + a.cos() * 350.0); // dehors, face au mur
    art.set("y", wy + a.sin() * 350.0);
    for _ in 0..400 {
        let (x, y) = tb._chute(&art, wx, wy);
        tb._bati_hit(x, y, &art);
    }
    let dedans = (0..N as usize).any(|c| tb.bati[c] != 0 && { let p = center_of(c); py::dist(p.0, p.1, plx, ply) < py::dist(wx, wy, plx, ply) });
    assert!(dedans, "des boulets trop longs passent le rempart et frappent les maisons derrière");
}

/// (Le Python remplace la constante BT.FEU_PROPAG par 0,2 le temps de l'essai, « un feu qui gagne à coup sûr : on ne
/// mesure pas la chance ici » ; une `const` Rust ne se remplace pas : on garde la vraie propagation et l'on prend la
/// première graine où le feu a gagné une voisine avant de tomber en ruine.)
#[test]
fn le_feu_gagne_puis_laisse_des_ruines() {
    for seed in 1..40 {
        let mut tb = place("att", seed, true);
        let c = maison(&tb, 3);
        tb._bati_set(c as i64, 2);
        brule(&mut tb, BT::FEU_DUREE - BT::FEU_DT);
        assert_eq!(tb.bati[c], 2); // il brûle encore…
        if ![c - 1, c + 1, c - COLS as usize, c + COLS as usize].iter().any(|&cc| tb.bati[cc] == 2) {
            continue; // (pas gagné avec cette graine)
        }
        brule(&mut tb, 2.0 * BT::FEU_DT);
        assert_eq!(tb.bati[c], 3); // … puis tombe en ruine
        brule(&mut tb, 4.0 * 3600.0);
        let etats: Vec<u8> = (0..N as usize).filter(|&x| tb.map.t[x] as i64 == T_BATI).map(|x| tb.bati[x]).collect();
        assert!(!etats.contains(&2), "graine {seed} : tout ce qui a brûlé est en ruine");
        assert!(!tb.feu.truthy());
        return;
    }
    panic!("le feu n'a gagné aucune voisine en 39 graines");
}

#[test]
fn la_maison_en_feu_chasse_ses_occupants() {
    let mut tb = place0();
    let u = tb.units.iter().find(|u| u.at("side") == 1 && u.at("cls") == "inf").unwrap();
    let c = maison(&tb, 2);
    let (cx, cy) = center_of(c);
    u.set("x", cx);
    u.set("y", cy);
    u.set("morale", 70.0);
    tb._bati_set(c as i64, 2);
    brule(&mut tb, BT::FEU_DT);
    let cu = TacticalBattle::cell(u.atf("x"), u.atf("y"));
    assert_ne!(cu, c as i64);
    assert_ne!(tb.bati[cu as usize], 2);
    assert!(py::hypot(u.atf("x") - cx, u.atf("y") - cy) < 100.0); // juste à côté
    assert_eq!(u.atf("morale"), 70.0 - BT::FEU_MOR);
}

#[test]
fn couvert_selon_l_etat() {
    let mut tb = place0();
    let c = maison(&tb, 2);
    let (x, y) = center_of(c);
    let mut vus = vec![];
    for e in 0..4 {
        tb.bati[c] = e;
        vus.push(tb.cover_at(x, y));
    }
    assert_eq!(vus, BT::BATI_COVER.to_vec());
    let (intacte, _touchee, feu, ruine) = (vus[0], vus[1], vus[2], vus[3]);
    assert_eq!(intacte, BT::COVER[T_BATI as usize]);
    assert_eq!(feu, 0.0);
    assert!(intacte > ruine);
    assert!(ruine > BT::COVER[T_PRE as usize]);
}

#[test]
fn une_ruine_laisse_passer_la_vue() {
    let mut tb = place0();
    // deux maisons sur un regard à plat, en plein champ : elles le bouchent ; en ruine, plus
    let (j, i0) = (5, 10);
    let cs: Vec<usize> = (i0..i0 + 12).map(|i| (j * COLS + i) as usize).collect();
    for &c in &cs {
        tb.map.t[c] = T_PRE as u8;
        tb.map.h[c] = 10;
        tb.map.f[c] = 0;
    }
    for &c in &cs[5..7] {
        tb.map.t[c] = T_BATI as u8;
    }
    let (a, b) = (center_of(cs[0]), center_of(*cs.last().unwrap()));
    tb._los_cache.clear();
    assert!(!tb.los(a.0, a.1, b.0, b.1, BT::EYE, BT::EYE));
    for &c in &cs[5..7] {
        tb._bati_set(c as i64, 3);
    }
    assert!(tb.los(a.0, a.1, b.0, b.1, BT::EYE, BT::EYE));
}

#[test]
fn meme_graine_meme_incendie() {
    let (un, deux) = (scenario(&mut place("att", 4, true)), scenario(&mut place("att", 4, true)));
    assert!(un.truthy());
    assert_eq!(un, deux);
}

#[test]
fn bati_depuis_since_et_carte_complete() {
    let mut tb = place0();
    let c = maison(&tb, 2) as i64;
    let s0 = tb.view(&Val::None, 0).ati("seq");
    tb._bati_set(c, 1);
    let s1 = tb.seq;
    tb._bati_set(c, 2);
    assert_eq!(tb.view(&Val::None, s0).at("bati"), list![list![c, 1], list![c, 2]]);
    assert_eq!(tb.view(&Val::None, s1).at("bati"), list![list![c, 2]]);
    assert_eq!(tb.view(&Val::None, tb.seq).at("bati"), list![]);
    assert!(tb.map_view().at("bati").has(list![c, 2]));
    assert_eq!(tb.map_view().at("bati").len(), 1);
}

#[test]
fn sauvegarde_et_ancienne_sauvegarde() {
    let mut tb = place0();
    scenario(&mut tb);
    let d = par_json(&tb.to_dict());
    let tc = TacticalBattle::from_dict(geo(), &d).unwrap();
    assert_eq!(tc.bati, tb.bati);
    assert_eq!(tc.feu, tb.feu);
    assert_eq!(tc.map_view().at("bati"), tb.map_view().at("bati"));
    assert_eq!(tc.view(&Val::None, 0).at("bati"), tb.view(&Val::None, 0).at("bati"));
    d.del("bati"); // (sauvegarde d'avant les dégâts : tout est intact)
    let old = TacticalBattle::from_dict(geo(), &d).unwrap();
    assert!(!old.bati.iter().any(|&e| e != 0));
    assert_eq!(old.map_view().at("bati"), list![]);
}

// ------------------------------------------------------------------ CanonsSurLeRempart
#[test]
fn les_canons_du_defenseur_sont_sur_l_enceinte() {
    let mut tb = place("att", 1, false);
    let pl = tb.map.place.clone();
    let canons: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 1 && u.at("cls") == "artillerie").collect();
    assert!(!canons.is_empty());
    // même déployée loin dehors, une batterie du défenseur va sur le mur
    let z = tb.zone(1);
    let u = &canons[0];
    assert!(tb.deploy(1, &list![u.at("id")], z.atf(0), z.atf(1), &Val::None, &Val::None, "any").0);
    assert_eq!(tb.map.t[TacticalBattle::cell(u.atf("x"), u.atf("y")) as usize] as i64, T_MUR);
    tb.start();
    // (la vue du défenseur : l'assaillant ne les voit pas toujours)
    let vus = dict! {};
    for d in tb.view(&Val::from(1), 0).at("units").iter() {
        vus.set(d.at("id"), d);
    }
    for u in &canons {
        let canon = u.at("id");
        assert_eq!(tb.map.t[TacticalBattle::cell(u.atf("x"), u.atf("y")) as usize] as i64, T_MUR, "canon {canon}");
        assert!(vus.at(&canon).get("rempart").truthy(), "canon {canon}");
        assert_eq!(u.at("form"), "batterie", "canon {canon}");
        let dehors = (u.atf("y") - pl.atf("y")).atan2(u.atf("x") - pl.atf("x"));
        assert!((u.atf("dir") - dehors).cos() > 0.99, "canon {canon}"); // tournée vers le dehors
        let (ok, msg) = tb.order(1, &list![u.at("id")], "move", "any", &dict! {"x" => pl.at("x"), "y" => pl.at("y")});
        assert!(!ok, "{msg}"); // elle ne quitte pas le mur
    }
    for a in &canons {
        for b in &canons {
            if !a.is(b) {
                assert!(py::hypot(a.atf("x") - b.atf("x"), a.atf("y") - b.atf("y")) >= BT::REMPART_GAP);
            }
        }
    }
    let att: Vec<Val> = tb.units.iter().filter(|u| u.at("side") == 0 && u.at("cls") == "artillerie").map(|u| u.at("id")).collect();
    assert!(!vus.items().iter().any(|(k, d)| att.contains(k) && d.get("rempart").truthy()));
}

#[test]
fn le_canon_du_rempart_tire() {
    let mut tb = place0();
    tb.autofinish();
    let u = artillerie(&tb, 1);
    let (x, y) = (u.atf("x"), u.atf("y"));
    avancer_jusqua(&mut tb, 3600.0, |_| u.atf("fired_t") > 0.0);
    assert!(u.atf("fired_t") > 0.0);
    if u.at("state") != "deroute" {
        assert_eq!((u.atf("x"), u.atf("y")), (x, y));
    }
}

#[test]
fn en_rase_campagne_rien_ne_change() {
    let (tb, _mes) = bataille(Val::None);
    assert!(!tb.view(&Val::None, 0).at("units").iter().any(|d| d.get("rempart").truthy()));
    assert_eq!(tb.view(&Val::None, 0).at("bati"), list![]);
}
