//! Banc d'essai de la campagne : tour par tour, marche, retraite, sièges, événements, sauvegarde. Portage de
//! tests/test_campagne.py (les classes du Python sont les sections commentées ; chaque test_xxx est ici xxx).
//!
//! POURQUOI CE BANC EXISTE. Un mois de jeu se joue en 15 secondes à l'écran, mais une règle de campagne (jours de
//! marche, retraite, dettes, sauvegarde des IA) ne se vérifie qu'au bout de plusieurs mois. Ici : une partie neuve
//! (fabrique::partie), un ordre, un mois joué en une seconde (jouer_mois). Bugs déjà rattrapés, à ne pas revoir :
//! - une armée en retraite repartait de 4 jours à chaque ordre donné, et marchait pendant le tour des IA ;
//! - un siège commencé au bout d'une marche était daté dans le futur (famine retardée) ;
//! - un événement effaçait la dette d'une faction en banqueroute ;
//! - l'état des IA (impôts, dépenses) n'était qu'à moitié sauvegardé.
//!
//! Ce que le Python remplaçait le temps d'un essai (`mock`, une méthode écrasée sur l'objet) ne se remplace pas en
//! Rust : chaque essai concerné dit comment il s'en passe, ou pourquoi il est ignoré.
#![allow(non_snake_case, clippy::bool_assert_comparison)]

mod fabrique_campagne;

use conquete::ai::{self as AIM, AI};
use conquete::army_actions as AA;
use conquete::cities as CT;
use conquete::crue as CR;
use conquete::diplomacy as D;
use conquete::engine::{Date, Game, SITE_DAYS};
use conquete::events as E;
use conquete::py::{self, json, Random, Val};
use conquete::rails as RL;
use conquete::rules as R;
use conquete::engine::raccord as TB;
use conquete::turns as TT;
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{armee, armee_de, bataille_de_campagne, jouer_mois, partie, partie_avec, simuler, GEO};
use std::collections::{BTreeMap, BTreeSet, HashSet};

// ------------------------------------------------------------------ outils du banc

/// Finit le tour des IA en cours ; renvoie le genre des arrêts rencontrés (acceptés d'office).
fn jouer_reste(g: &mut Game) -> Vec<String> {
    let mut kinds = Vec::new();
    for _ in 0..300 {
        if g.tour.at("end").is_none() {
            break;
        }
        TT::advance(g, 0.1);
        if g.tour.at("stop").truthy() && g.speed_idx == 0 {
            kinds.push(g.tour.at("stop").ats("kind"));
            for bt in g.battles.values() {
                if bt.get("mode") == "attente" {
                    TB::command(g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "auto"});
                }
                if bt.get("mode") == "poursuite" {
                    TB::command(g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => true});
                }
            }
            TT::go(g);
        }
    }
    kinds
}

#[track_caller]
fn presque(a: f64, b: f64, places: i32) {
    assert!(a == b || ((a - b).abs() * 10f64.powi(places)).round() == 0.0, "{a} != {b} à {places} décimales");
}

#[track_caller]
fn proche(a: f64, b: f64, delta: f64) {
    assert!((a - b).abs() <= delta, "{a} != {b} à {delta} près");
}

/// La date d'un jour de la partie (`g.date_str(t)`).
fn ds(g: &Game, t: f64) -> String {
    g.date_str(&Val::from(t))
}

/// `g.date_str()` : aujourd'hui.
fn ds0(g: &Game) -> String {
    g.date_str(&Val::None)
}

fn date(g: &Game) -> Date {
    g.date(&Val::None)
}

fn ordinal(y: i64, m: i64, d: i64) -> i64 {
    Date { year: y, month: m, day: d }.toordinal()
}

/// `g.order_move(code, aid, x, y)`
fn vers(g: &mut Game, code: &str, a: &Val, x: f64, y: f64) -> (Option<bool>, String) {
    g.order_move(code, &a.at("id"), &dict! {"x" => x, "y" => y})
}

/// `g.order_move(code, aid, node=nid)`
fn vers_place(g: &mut Game, code: &str, a: &Val, nid: i64) -> (Option<bool>, String) {
    g.order_move(code, &a.at("id"), &dict! {"node" => nid})
}

/// `g.order_move(code, aid, None, None, nid, 'route', tr, False)`
fn par_la_route(g: &mut Game, code: &str, a: &Val, nid: i64, tr: Val) -> (Option<bool>, String) {
    g.order_move(code, &a.at("id"), &dict! {"node" => nid, "mode" => "route", "tr" => tr, "force" => false})
}

/// `{gn['name']: i for i, gn in enumerate(g.geo.nodes)}[nom]`
fn idx(g: &Game, nom: &str) -> i64 {
    g.geo.nodes.iter().enumerate().filter(|(_, gn)| gn.at("name") == nom).map(|(i, _)| i as i64).last().unwrap_or_else(|| panic!("KeyError: {nom:?}"))
}

/// `GEO.by_name[nom]`
fn par_nom(nom: &str) -> i64 {
    GEO().by_name.ati(nom)
}

/// Place la partie à cette date, 0 h (sans jouer les jours qui précèdent).
fn au(g: &mut Game, y: i64, m: i64, d: i64) {
    g.t = (ordinal(y, m, d) - g.start_ord) as f64;
}

/// La vue d'une place (`next(x for x in V.player_state(g)['nodes'] if x['id'] == nid)`).
fn vue_place(g: &mut Game, nid: i64) -> Val {
    V::player_state(g, 0).at("nodes").iter().find(|x| x.at("id") == nid).unwrap()
}

/// La vue d'une armée.
fn vue_armee(g: &mut Game, aid: &Val) -> Val {
    V::player_state(g, 0).at("armies").iter().find(|x| x.at("id") == *aid).unwrap()
}

fn sauver_relire(g: &mut Game) -> Game {
    V::from_dict(GEO(), &json::loads(&json::dumps(&V::to_dict(g))).unwrap()).unwrap()
}

fn vide() -> Val {
    Val::list(vec![])
}

fn decision(id: &str, titre: &str, g: &Game) -> Val {
    dict! {"id" => id, "ev" => "essai", "kind" => "hist", "title" => titre, "text" => "", "town" => Val::None,
        "base" => "", "until" => g.t + 30.0, "date" => ds0(g),
        "choices" => list![dict! {"label" => "Oui", "fx" => dict! {}, "desc" => vide()}]}
}

// ================================================================== TourParTour

#[test]
fn votre_tour_puis_celui_des_ia() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let (x0, y0, d0) = (a.atf("x"), a.atf("y"), ds0(&g));
    assert_eq!(vers(&mut g, &p, &a, x0 + 40.0, y0 + 10.0).0, Some(true));
    TT::settle(&mut g);
    assert_ne!((a.atf("x"), a.atf("y")), (x0, y0), "votre tour : l'armée part tout de suite");
    assert_eq!(ds0(&g), d0, "votre tour : la date ne bouge pas");
    jouer_mois(&mut g, 2);
    assert_eq!(date(&g).day, 1);
    assert!(TT::planning(&g), "après le tour des IA, c'est de nouveau à vous");
    for n in g.nodes.iter() {
        // sièges commencés en chemin : datés au plus tard d'aujourd'hui
        if n.get("siege").truthy() {
            assert!(n.at("siege").atf("since") <= g.t + 1e-6);
        }
    }
}

#[test]
fn le_tour_des_ia_se_joue_d_un_coup() {
    let mut g = partie();
    TT::go(&mut g);
    let mut n = 0;
    for i in 1..200 {
        n = i;
        TT::advance(&mut g, 0.1); // un appel de la boucle du serveur (toutes les 0,1 s)
        if g.tour.at("stop").truthy() {
            TT::go(&mut g);
        }
        if g.tour.at("end").is_none() {
            break;
        }
    }
    assert_eq!(date(&g).day, 1);
    assert!(n < 30, "le mois des IA se calcule aussi vite que possible, pas au rythme de 15 s");
}

#[test]
fn plus_de_rythme() {
    let mut g = partie();
    g.tour.set("pace", "lent"); // ancienne sauvegarde
    TT::migrate(&mut g);
    assert!(!g.tour.has("pace"));
    assert!(!TT::view(&g).has("pace"));
    assert!(!TT::command(&mut g, "pace", &Val::from("lent")).0);
}

#[test]
fn une_attaque_contre_vous_arrete_le_tour_des_ia_puis_il_reprend() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let b = armee_de(&g, "24");
    D::declare_war(&mut g, "24", &p, true);
    b.set("x", a.atf("x") + 1.0); // au contact : la bataille s'engage au premier pas
    b.set("y", a.at("y"));
    vers(&mut g, "24", &b, a.atf("x"), a.atf("y"));
    TT::go(&mut g);
    for _ in 0..50 {
        TT::advance(&mut g, 0.1);
        if g.tour.at("stop").truthy() {
            break;
        }
    }
    assert_eq!(g.tour.at("stop").at("kind"), "bataille");
    let bt = g.battles.values().into_iter().find(|bt| bt.get("mode") == "attente").unwrap();
    assert!(TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "auto"}).atb("ok"));
    TT::advance(&mut g, 0.1);
    let st = g.tour.at("stop");
    assert!(
        g.speed_idx != 0 || (st.truthy() && st.get("sel") != list!["battle", bt.at("id")]),
        "le choix fait, le tour des IA reprend tout seul (sans « Continuer »)"
    );
    // (un imprévu qui demande une décision peut aussi tomber ce mois-là, selon le tirage : il n'a rien à voir ici)
    let reste: BTreeSet<String> = jouer_reste(&mut g).into_iter().filter(|k| k != "bataille" && k != "decision").collect();
    assert!(reste.is_empty(), "seules d'autres attaques l'arrêtent encore : {reste:?}");
    assert_eq!(date(&g).day, 1);
}

#[test]
fn une_decision_arrete_le_tour_des_ia_puis_il_reprend() {
    let mut g = partie();
    TT::go(&mut g);
    let d = decision("e1", "Les états généraux", &g);
    g.pending_ev.push(d);
    TT::advance(&mut g, 0.1);
    assert_eq!(g.tour.at("stop").at("kind"), "decision");
    assert!(E::resolve(&mut g, "e1", 0, false).0);
    TT::advance(&mut g, 0.1);
    let st = g.tour.at("stop"); // (le tour reprend : plus d'arrêt du tout, ou un arrêt pour autre chose)
    // (un imprévu tiré pendant le tour des IA peut demander à son tour une décision : il n'a rien à voir ici)
    assert!(g.speed_idx != 0 || !st.truthy() || st.get("ev") != "e1", "la décision prise, le tour reprend seul");
}

#[test]
fn deux_decisions_au_meme_moment() {
    let mut g = partie();
    TT::go(&mut g);
    for i in [1, 2] {
        let d = decision(&format!("e{i}"), &format!("Décision {i}"), &g);
        g.pending_ev.push(d);
    }
    TT::advance(&mut g, 0.1);
    assert_eq!(g.tour.at("stop").at("ev"), "e1");
    E::resolve(&mut g, "e1", 0, false);
    TT::advance(&mut g, 0.1);
    assert_eq!((g.speed_idx, g.tour.at("stop").ats("ev")), (0, "e2".to_string()), "la seconde arrête aussi le tour");
    E::resolve(&mut g, "e2", 0, false);
    TT::advance(&mut g, 0.1);
    let st = g.tour.at("stop");
    assert!(g.speed_idx != 0 || !st.truthy() || !(st.get("ev") == "e1" || st.get("ev") == "e2"));
}

#[test]
fn une_guerre_n_arrete_plus_le_tour_des_ia() {
    let mut g = partie();
    let p = g.player.clone();
    TT::go(&mut g);
    D::declare_war(&mut g, "24", &p, false);
    let kinds = jouer_reste(&mut g);
    assert!(!kinds.contains(&"guerre".to_string()));
    assert!(g.tour.at("recap").at("facts").iter().any(|f| f.ats("text").contains("guerre")), "la guerre est dans le récap");
}

#[test]
fn les_armees_ennemies_sur_vos_terres_sont_dans_le_recap() {
    let mut g = partie();
    let p = g.player.clone();
    let b = armee_de(&g, "24");
    D::declare_war(&mut g, "24", &p, true);
    let cap = g.owned_nodes(&p).at(0);
    let (cx, cy) = g.node_xy(cap.ati("id"));
    b.set("x", cx + 3.0);
    b.set("y", cy);
    if g.geo.node_of_cell(b.atf("x"), b.atf("y")) != Some(cap.ati("id")) {
        b.set("x", cx);
        b.set("y", cy);
    }
    g.tour.set("acc", TT::_new_acc(&g));
    let foes = TT::_recap(&mut g).at("foes");
    assert_eq!(foes.iter().map(|f| f.at("id")).collect::<Vec<_>>(), vec![b.at("id")]);
}

#[test]
fn une_ville_neutre_se_rallie_pendant_votre_tour() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    D::declare_war(&mut g, &p, "24", true);
    let (foy, berg) = (idx(&g, "Sainte-Foy-la-Grande"), idx(&g, "Bergerac"));
    assert_eq!(g.nodes.at(foy).at("owner"), R::NEUTRAL);
    let d0 = ds0(&g);
    let (bx, by) = g.node_xy(berg);
    assert_eq!(vers(&mut g, &p, &a, bx, by).0, Some(true));
    TT::settle(&mut g);
    assert_eq!(a.at("at_node"), foy, "en chemin vers Bergerac, l'armée s'arrête à Sainte-Foy…");
    assert_eq!(a.at("ask").at("node"), foy, "… et attend le choix du joueur (évolution du 18/10/2026)");
    assert_eq!(ds0(&g), d0);
    assert!(a.at("ask").at("path").truthy(), "la route vers Bergerac est gardée");
}

#[test]
fn arrivee_annoncee() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    a.set("mp", 1.0); // presque plus de marche ce tour
    a.set("tr", true);
    assert_eq!(vers(&mut g, &p, &a, a.atf("x") + 40.0, a.atf("y") + 10.0).0, Some(true));
    TT::settle(&mut g);
    assert!(a.at("path").truthy());
    assert_eq!(TT::eta(&g, &a, &Val::None), Some(1), "arrivée annoncée au prochain tour");
    jouer_mois(&mut g, 1); // au début du tour suivant, l'armée repart
    assert!(!a.at("path").truthy(), "elle est arrivée au tour annoncé");
}

#[test]
fn rallier_apres_une_halte() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let neutres: Vec<i64> = g.nodes.iter().filter(|n| n.at("owner") == R::NEUTRAL).map(|n| n.ati("id")).collect();
    let forces: Vec<(i64, f64)> = neutres.into_iter().map(|i| (i, g.node_defense_power(i, true))).collect();
    let nid = py::min_by_key(forces, |x| x.1).unwrap().0; // la plus faible
    // halte devant ses portes
    a.set("at_node", nid);
    a.set("path", vide());
    a.set("state", "idle");
    a.set("hold", true);
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
    let (ok, msg) = AA::conquer(&mut g, &p, &a);
    assert!(ok, "{msg}");
    assert_eq!(a.at("ask").at("node"), nid, "« Rallier ou attaquer » rouvre le choix (évolution du 18/10/2026)");
    let (ok, msg) = AA::choose(&mut g, &p, &a, "rallier");
    assert!(ok, "{msg}");
    assert_eq!(g.nodes.at(nid).at("owner"), p.as_str(), "ralliée tout de suite, pendant votre tour");
    jouer_mois(&mut g, 1);
    a.set("tr", true); // retour chez soi, sans rallier d'autres places en chemin
    let (cx, cy) = g.node_xy(g.capital_of(&p).i());
    assert_eq!(vers(&mut g, &p, &a, cx, cy).0, Some(true));
    TT::settle(&mut g);
    assert!(!a.at("path").truthy(), "au tour suivant, elle marche jusqu'au bout (pas arrêtée au premier pas)");
}

#[test]
fn premier_tour_entame_marche_reduite() {
    let mut g = partie(); // 4 mars : 28 jours jusqu'au 1er avril
    assert_eq!(TT::march_days(&g), 28.0);
    jouer_mois(&mut g, 1);
    assert_eq!(TT::march_days(&g), 30.0, "avril, un tour entier");
}

#[test]
fn arrivee_estimee_sur_la_vraie_route() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let (ax, ay) = (a.atf("x"), a.atf("y"));
    let ids: Vec<i64> = g.nodes.iter().map(|n| n.ati("id")).collect();
    let d = |g: &Game, i: i64| {
        let (x, y) = g.node_xy(i);
        py::dist(x, y, ax, ay)
    };
    let far = py::max_by_key(ids.clone(), |&i| d(&g, i)).unwrap();
    let near = py::min_by_key(ids.into_iter().filter(|&i| a.at("at_node") != i), |&i| d(&g, i)).unwrap();
    a.set("mp", 1.0);
    let (tn, msg) = TT::preview(&mut g, &p, &a.at("id"), &Val::None, &Val::None, &Val::from(far), &Val::from("route"));
    assert!(tn.expect("tn") >= 1, "{msg:?}");
    assert_eq!((a.at("path"), a.at("mp")), (vide(), Val::from(1.0)), "une estimation ne donne aucun ordre");
    a.set("mp", Val::None);
    assert_eq!(TT::preview(&mut g, &p, &a.at("id"), &Val::None, &Val::None, &Val::from(near), &Val::from("route")).0, Some(0), "arrivée ce tour-ci");
    assert_eq!(TT::preview(&mut g, &p, &Val::from("a999"), &Val::from(10), &Val::from(10), &Val::None, &Val::from("route")).0, None);
}

#[test]
fn plus_de_marche_plus_de_mouvement() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    a.set("mp", 0.0); // jours de marche du mois épuisés
    let (x0, y0) = (a.atf("x"), a.atf("y"));
    vers(&mut g, &p, &a, x0 + 40.0, y0 + 10.0);
    TT::settle(&mut g);
    assert_eq!((a.atf("x"), a.atf("y")), (x0, y0));
}

#[test]
fn ordres_de_marche_bloques_pendant_le_tour_des_ia() {
    let g = partie();
    assert_eq!(TT::lock_reason(&g), None);
    g.tour.set("end", TT::month_end(&g, &Val::None, 1)); // le tour des IA a commencé
    assert!(TT::lock_reason(&g).unwrap().contains("tour des IA"));
}

#[test]
fn retraite_une_fois_par_tour() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    a.set("tr", true); // traverse sans rallier les places neutres : elle reste loin de chez elle
    vers(&mut g, &p, &a, a.atf("x") + 40.0, a.atf("y") + 10.0); // loin de chez elle (une retraite a où aller)
    TT::settle(&mut g);
    assert!(g.order_retreat(&p, &a.at("id")).0);
    TT::settle(&mut g);
    let p1 = (a.atf("x"), a.atf("y"));
    TT::settle(&mut g); // un nouvel ordre ailleurs ne la fait pas repartir
    assert_eq!((a.atf("x"), a.atf("y")), p1);
    assert!(a.at("rt").truthy());
    assert_eq!(a.at("mp"), 0.0);
    jouer_mois(&mut g, 1);
    assert!(!a.at("rt").truthy(), "nouveau tour : la retraite est de nouveau possible");
}

// ================================================================== TempsEnTours
// 1 tour = 1 mois. Une durée de N tours laisse au joueur N tours entiers, et finit pile au début d'un tour.

#[test]
fn echeance_pendant_votre_tour() {
    let mut g = partie(); // 4 mars 1790, votre premier tour
    assert_eq!(ds(&g, TT::deadline(&g, 1, &[])), "1er avril 1790", "fin de ce tour");
    assert_eq!(ds(&g, TT::deadline(&g, 4, &[])), "1er juillet 1790");
    au(&mut g, 1790, 12, 1);
    assert_eq!(ds(&g, TT::deadline(&g, 2, &[])), "1er février 1791");
}

#[test]
fn echeance_pendant_le_tour_des_ia() {
    let mut g = partie();
    TT::go(&mut g);
    au(&mut g, 1790, 3, 20); // au milieu du tour des IA de mars
    assert_eq!(ds(&g, TT::deadline(&g, 1, &[])), "1er mai 1790", "vous avez encore tout votre tour d'avril");
}

#[test]
fn tours_restants() {
    let mut g = partie();
    assert_eq!(TT::tours_left(&g, TT::deadline(&g, 1, &[])), 1);
    assert_eq!(TT::tours_left(&g, TT::deadline(&g, 3, &[])), 3);
    au(&mut g, 1790, 4, 1);
    assert_eq!(TT::tours_left(&g, g.t + 12.5), 1, "fini pendant ce tour des IA : vu au prochain tour");
    assert_eq!(TT::tours_left(&g, g.t + 40.0), 2);
    assert_eq!(TT::tours_left(&g, g.t), 0);
}

#[test]
fn debut_de_tour_suivant() {
    let mut g = partie();
    au(&mut g, 1790, 4, 12);
    assert_eq!(ds(&g, TT::turn_start_after(&g, g.t)), "1er mai 1790");
    au(&mut g, 1790, 5, 1);
    assert_eq!(ds(&g, TT::turn_start_after(&g, g.t)), "1er mai 1790", "déjà au début d'un tour");
}

#[test]
fn un_tour_de_travail_quelle_que_soit_la_longueur_du_mois() {
    // (assertAlmostEqual reçoit le message à la place de `places` : il ne passe que si les deux sont égaux)
    let mut g = partie();
    au(&mut g, 1791, 3, 1);
    assert_eq!(TT::work(&g, 28.0), TT::TOUR_DAYS, "le mois de février qui vient de passer");
    au(&mut g, 1791, 4, 1);
    assert_eq!(TT::work(&g, 31.0), TT::TOUR_DAYS, "le mois de mars");
}

// ================================================================== Production
// Règle A : une ville fait un mois de travail par tour ; sa file avance dans l'ordre, le surplus passe au suivant.

/// `Production.lever(g, k, days=6.0)`
fn lever(g: &Game, k: usize, days: f64) -> Val {
    let cap = g.capital_of(&g.player);
    let n = g.owned_nodes(&g.player).iter().find(|n| n.at("id") == cap).unwrap();
    n.set("queue", Val::list((0..k).map(|_| dict! {"kind" => "unit", "what" => "ligne", "left" => days, "total" => days}).collect()));
    n
}

#[test]
fn cinq_regiments_d_un_cinquieme_de_tour() {
    let mut g = partie();
    jouer_mois(&mut g, 1); // 1er avril : un tour entier devant soi
    let n = lever(&g, 5, 6.0);
    assert_eq!((0..5).map(|i| TT::ready_in(&g, 6.0 * (i + 1) as f64)).collect::<Vec<_>>(), vec![1; 5], "tous annoncés au prochain tour");
    let g0 = n.at("garrison").len();
    jouer_mois(&mut g, 1);
    assert_eq!(n.at("queue"), vide());
    assert_eq!(n.at("garrison").len() - g0, 5);
}

#[test]
fn le_surplus_passe_au_suivant() {
    let mut g = partie();
    jouer_mois(&mut g, 1);
    let n = lever(&g, 29, 1.01); // 29,3 jours de travail : un tour, sans rien perdre entre deux éléments
    jouer_mois(&mut g, 1);
    assert_eq!(n.at("queue"), vide());
}

#[test]
fn premier_tour_entame() {
    let mut g = partie(); // 4 mars : il ne reste que 28 jours de mars
    let n = lever(&g, 5, 6.0);
    assert_eq!((0..5).map(|i| TT::ready_in(&g, 6.0 * (i + 1) as f64)).collect::<Vec<_>>(), vec![1, 1, 1, 1, 2]);
    jouer_mois(&mut g, 1);
    assert_eq!(n.at("queue").len(), 1, "le cinquième est pour le tour suivant, comme annoncé");
    jouer_mois(&mut g, 1);
    assert_eq!(n.at("queue"), vide());
}

#[test]
fn deux_chantiers_de_24_jours() {
    let g = partie();
    lever(&g, 2, 24.0);
    assert_eq!([TT::ready_in(&g, 24.0), TT::ready_in(&g, 48.0)], [1, 2]);
}

// ================================================================== RechercheEtPolitiques

#[test]
fn technologies_en_tours_entiers() {
    for t in R::TECH().values() {
        assert!(t.at("days") >= 30i64 && t.at("days").py_rem(&Val::from(30)) == 0i64, "{}", t.at("id"));
    }
}

#[test]
fn une_technologie_d_un_tour_est_decouverte_au_tour_suivant() {
    let mut g = partie();
    jouer_mois(&mut g, 1); // 1er avril
    let p = g.player.clone();
    let f = g.factions.at(&p);
    f.at("res").set("livres", 1e5);
    let t = R::TECH()
        .values()
        .into_iter()
        .find(|t| !f.at("techs").has(t.at("id")) && !f.at("research").at(t.at("branch")).truthy() && t.at("req").iter().all(|r| f.at("techs").has(&r)))
        .unwrap();
    assert!(g.research(&p, &t.at("id")).0);
    f.at("research").at(t.at("branch")).update(&dict! {"left" => 30, "total" => 30}); // (les vraies durées se comptent en années)
    jouer_mois(&mut g, 1);
    assert!(f.at("techs").has(t.at("id")), "un tour de travail : découverte au tour suivant");
}

#[test]
fn politique_en_place_au_prochain_tour() {
    let mut g = partie();
    let p = g.player.clone();
    let n = g.owned_nodes(&p).at(0);
    let k = CT::POLICIES().keys().into_iter().find(|k| *k != "equilibre").unwrap();
    assert!(CT::set_policy(&mut g, &p, n.ati("id"), k.s(), false).0);
    assert_eq!(n.at("pol").at("u"), TT::deadline(&g, 1, &[]));
    jouer_mois(&mut g, 1);
    assert_eq!(CT::policy_w(&g, &n), 1.0);
}

fn chef_lieu(g: &Game) -> Val {
    g.owned_nodes(&g.player).iter().find(|n| g.geo.nodes.at(n.at("id")).at("type") == "capitale").unwrap()
}

#[test]
fn ville_endommagee_produit_moins() {
    let mut g = partie();
    let p = g.player.clone();
    let n = chef_lieu(&g);
    let avant = g.node_output(&n, &p).atf("livres");
    g.damage_town(&n, 0.5);
    presque(g.node_output(&n, &p).atf("livres"), avant * (1.0 - R::DEG_PROD * 0.5), 6);
    g.damage_town(&n, 0.5);
    // (assertAlmostEqual reçoit le message à la place de `places` : il ne passe que si les deux sont égaux)
    assert_eq!(n.at("deg"), 0.75, "les nouveaux dégâts tombent sur ce qui reste debout");
    let d = vue_place(&mut g, n.ati("id"));
    assert_eq!(d.at("dg"), 0.75);
    assert_eq!(d.at("rp").at("tn"), 5, "trois quarts de la ville : cinq tours de réparations");
}

#[test]
fn reparer_la_ville_en_tours() {
    let mut g = partie();
    let p = g.player.clone();
    let n = chef_lieu(&g);
    let nid = n.ati("id");
    let repar = Val::from("repar");
    assert!(!g.build(&p, nid, &repar).0, "rien à réparer");
    n.set("queue", vide());
    g.damage_town(&n, 0.4);
    let (tours, cout) = g.repair_quote(&p, &n).unwrap();
    assert_eq!(tours, 3);
    let livres = g.factions.at(&p).at("res").atf("livres");
    let (ok, msg) = g.build(&p, nid, &repar);
    assert!(ok, "{msg}");
    presque(g.factions.at(&p).at("res").atf("livres"), livres - cout.atf("livres"), 7);
    assert!(!g.build(&p, nid, &repar).0, "déjà en chantier");
    let q = vue_place(&mut g, nid).at("q").iter().find(|q| q.at("what") == "repar").unwrap();
    assert!(q.at("tn") == tours || q.at("tn") == tours + 1, "prête dans ses tours (le tour en cours ne compte que ce qui reste du mois)");
    let tours = q.ati("tn");
    jouer_mois(&mut g, tours - 1);
    assert!(n.get_or("deg", 0) > 0i64, "pas encore rebâtie");
    jouer_mois(&mut g, 1);
    assert_eq!(n.get_or("deg", 0), 0, "rebâtie au bout de ses tours");
}

#[test]
fn pas_de_reparations_pendant_un_siege() {
    let mut g = partie();
    let p = g.player.clone();
    let n = g.owned_nodes(&p).at(0);
    g.damage_town(&n, 0.5 * R::DEG_SIEGE); // (la moitié d'un bombardement complet)
    presque(n.atf("deg"), 0.15, 7);
    n.set("siege", dict! {"by" => "24", "dmg" => 0.5, "since" => g.t});
    assert!(!g.build(&p, n.ati("id"), &Val::from("repar")).0, "on ne rebâtit pas une ville assiégée");
}

#[test]
fn evenement_local_visible_sur_la_carte() {
    let mut g = partie();
    let p = g.player.clone();
    let n = g.owned_nodes(&p).at(0);
    assert!(CT::fire(&mut g, &p, &n, &CT::LOCAL_BY_ID().at("foire")));
    let d = vue_place(&mut g, n.ati("id"));
    assert_eq!(d.at("lv"), list!["foire", 0], "la carte montre la foire de la ville");
    g.t += (V::LEV_DAYS + 1) as f64;
    let d = vue_place(&mut g, n.ati("id"));
    assert!(!d.has("lv"), "passé trois mois, la carte l'oublie");
}

#[test]
fn ancienne_politique_en_jours() {
    let mut g = partie();
    let p = g.player.clone();
    let n = g.owned_nodes(&p).at(0);
    au(&mut g, 1790, 4, 20);
    n.set("pol", dict! {"k" => "equilibre", "p" => "equilibre", "t" => g.t - 5.0, "o" => p.as_str()}); // sauvegarde d'avant les tours
    assert!(CT::policy_w(&g, &n) < 1.0);
    au(&mut g, 1790, 6, 1);
    assert_eq!(CT::policy_w(&g, &n), 1.0, "les 18 jours (jusqu'au 3 mai) finis au début du tour suivant");
}

// ================================================================== EcheancesEnTours
// Règle B : trêves, droits de passage, propositions, décisions et effets d'événements en tours entiers.

#[test]
fn treve_de_quatre_tours() {
    let mut g = partie(); // 4 mars 1790, votre tour
    let p = g.player.clone();
    D::declare_war(&mut g, &p, "24", true);
    D::make_peace(&mut g, &p, "24");
    assert_eq!(ds(&g, g.factions.at(&p).at("truce").atf("24")), "1er juillet 1790");
}

#[test]
fn droit_de_passage_de_douze_tours() {
    let mut g = partie();
    let p = g.player.clone();
    AA::grant_passage(&mut g, "24", &p, AA::PASSAGE_TOURS);
    assert_eq!(ds(&g, g.factions.at("24").at("passage").atf(&p)), "1er mars 1791");
}

#[test]
fn proposition_recue_pendant_le_tour_des_ia() {
    let mut g = partie();
    let p = g.player.clone();
    TT::go(&mut g);
    au(&mut g, 1790, 3, 20);
    let n = g.proposals.len();
    D::act(&mut g, "24", &Val::from(p.as_str()), &Val::from("commerce"), &Val::from(0), &Val::None, &Val::None);
    assert_eq!(g.proposals.len(), n + 1);
    assert_eq!(ds(&g, g.proposals.at(-1).atf("expires")), "1er mai 1790", "tout votre tour d'avril pour répondre");
}

#[test]
fn decision_d_un_tour() {
    let mut g = partie();
    let p = g.player.clone();
    let ev = dict! {"id" => "essai", "title" => "Essai", "text" => "",
        "choices" => list![dict! {"label" => "Oui", "fx" => dict! {}}, dict! {"label" => "Non", "fx" => dict! {}}]};
    E::fire(&mut g, &p, &ev, "hist");
    assert_eq!(ds(&g, g.pending_ev.at(-1).atf("until")), "1er avril 1790");
}

#[test]
fn anciennes_echeances_ramenees_au_debut_d_un_tour() {
    let mut g = partie();
    let p = g.player.clone();
    g.factions.at(&p).at("truce").set("24", g.t + 50.5); // 23 avril 1790 et des poussières
    TT::migrate(&mut g);
    assert_eq!(ds(&g, g.factions.at(&p).at("truce").atf("24")), "1er mai 1790");
}

// ================================================================== ActionsEnTours

#[test]
fn delai_d_attente_en_tours() {
    let mut g = partie(); // 4 mars 1790
    let p = g.player.clone();
    let n = g.owned_nodes(&p).at(0);
    AA::set_cd(&mut g, &n, "req", AA::REQ_CD, &p);
    assert_eq!(AA::cd_left(&g, &n, "req"), 4, "quatre tours, celui-ci compris");
    let m = g.owned_nodes("24").at(0);
    AA::set_cd(&mut g, &m, "req", AA::REQ_CD, "24");
    presque(m.at("aa").at("cd").atf("req"), g.t + 120.0, 7); // une IA garde son rythme d'avant (120 jours)
    au(&mut g, 1790, 7, 1);
    assert_eq!(AA::cd_left(&g, &n, "req"), 0, "fini au début du 4e tour suivant");
}

/// `a['at_node'], a['path'], a['state'], a['hold'] = nid, [], 'idle', True` puis `a['x'], a['y'] = g.node_xy(nid)`.
fn halte(g: &Game, a: &Val, nid: i64) {
    a.set("at_node", nid);
    a.set("path", vide());
    a.set("state", "idle");
    a.set("hold", true);
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
}

#[test]
fn ralliement_negocie_au_tour_suivant() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let nid = g.nodes.iter().find(|n| n.at("owner") == R::NEUTRAL).unwrap().ati("id");
    halte(&g, &a, nid); // halte devant ses portes
    g.factions.at(&p).at("res").set("livres", 1e5);
    let (ok, msg) = AA::negotiate(&mut g, &p, &a);
    assert!(ok, "{msg}");
    assert!(msg.contains("au prochain tour"));
    g.nodes.at(nid).at("aa").at("ng").set("risk", 0.0);
    jouer_mois(&mut g, 1);
    assert_eq!(g.nodes.at(nid).at("owner"), p.as_str());
}

#[test]
fn espion_rapport_au_tour_suivant_valable_deux_tours() {
    // `g.rng.random = lambda: 0.0` (la mission réussit à coup sûr) : ici, le hasard de la partie est remplacé par un
    // hasard dont le premier tirage est presque nul (le seul tirage de update_spies, celui de la réussite)
    let mut g = partie();
    let p = g.player.clone();
    let nid = g.nodes.iter().find(|n| n.at("owner") == "24").unwrap().ati("id");
    g.factions.at(&p).at("res").set("livres", 1e5);
    assert!(g.spy(&p, nid, &Val::from("espionner")).0);
    let s = g.spies.at(-1);
    assert_eq!(ds(&g, s.atf("done")), "1er avril 1790");
    TT::go(&mut g);
    g.t = s.atf("done") + 1e-9; // le dernier pas du tour des IA, qui franchit minuit
    g.rng = (0..).map(Random::new).find(|r| r.clone().random() < 1e-3).unwrap();
    g.update_spies();
    assert_eq!(ds(&g, g.factions.at(&p).at("intel").atf(nid.to_string())), "1er juin 1790", "avril et mai");
}

// ================================================================== SiegesEnTours
// Règle C : vitesse des sièges inchangée, brèche et vivres annoncés en tours, et l'annonce est tenue.

fn assieger() -> (Game, Val) {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    D::declare_war(&mut g, &p, "24", true);
    let nid = idx(&g, "Bergerac");
    let n = g.nodes.at(nid);
    a.set("at_node", nid);
    a.set("path", vide());
    a.set("state", "siege");
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
    n.set("siege", dict! {"by" => p.as_str(), "dmg" => 0.0, "since" => g.t});
    (g, n)
}

#[test]
fn breche_annoncee() {
    let (mut g, n) = assieger();
    let sg = vue_place(&mut g, n.ati("id")).at("sg");
    assert!(sg.at("br") >= 1i64);
    for _ in 0..sg.ati("br") {
        if n.at("siege").is_none() || n.at("siege").at("dmg") >= 0.85 {
            break;
        }
        jouer_mois(&mut g, 1);
    }
    assert!(
        n.at("siege").is_none() || n.at("siege").at("dmg") >= 0.85 || n.at("owner") == g.player,
        "brèche ouverte (ou place prise) au tour annoncé"
    );
}

#[test]
fn place_a_remparts_pendant_votre_tour() {
    // (rapport du 18/10/2026 : « en plein tour, il ne propose pas la bataille, en fin de tour oui ») : la place à
    // remparts est assiégée, pas attaquée, et la bulle dit comment l'attaquer tout de suite ; l'assaut demandé
    // pendant le tour attend aussitôt le choix du joueur
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    D::declare_war(&mut g, &p, "24", true);
    let nid = idx(&g, "Bergerac");
    assert!(AA::walled(&g.nodes.at(nid)));
    let (x, y) = g.node_xy(nid);
    a.set("x", x + 3.0);
    a.set("y", y);
    a.set("at_node", Val::None);
    a.set("edge", Val::None);
    a.set("tr", false);
    assert_eq!(vers(&mut g, &p, &a, x, y).0, Some(true));
    TT::settle(&mut g);
    // (évolution du 18/10/2026 : à l'arrivée, le joueur choisit ; ici, « Assiéger »)
    assert_eq!(a.at("ask").at("node"), nid);
    let (ok, msg) = AA::choose(&mut g, &p, &a, "assieger");
    assert!(ok, "{msg}");
    assert_eq!(a.at("state"), "siege");
    assert!(!g.battles.truthy());
    assert!(g.events.at(-1).ats("text").contains("Donner l’assaut"));
    assert!(g.events.at(-1).at("important").truthy(), "annoncé en bulle");
    assert!(g.assault(&p, &a.at("id")).0);
    TT::settle(&mut g);
    assert_eq!(g.battles.values().iter().map(|bt| bt.get("mode")).collect::<Vec<_>>(), vec![Val::from("attente")], "la fenêtre « Commander la bataille »");
}

#[test]
fn blocus_en_tours() {
    let (mut g, n) = assieger();
    n.at("siege").update(&dict! {"blocus" => true, "food" => 30, "m0" => 100});
    let sg = vue_place(&mut g, n.ati("id")).at("sg");
    assert_eq!(sg.at("food"), TT::tours_left(&g, g.t + 30.0));
}

// ================================================================== ArriveeDevantUneVille
// Évolution du 18/10/2026 (SPEC-TOURS.md) : une armée du joueur qui arrive devant une ville qui n'est pas à lui
// (sa cible, ou une ville en chemin) s'arrête, et le joueur choisit, toujours.

/// setUp : la Gironde en 1700.
fn arrivee() -> Game {
    partie_avec("33", "1700", 1, "normal")
}

/// L'armée de Bordeaux scindée en n détachements (le rapport du joueur).
fn detachements(g: &mut Game, n: usize) -> Vec<Val> {
    let p = g.player.clone();
    let a = armee(g);
    let mut ids = vec![a.at("id")];
    let regs: Vec<Val> = a.at("regs").iter().map(|x| x.at("id")).collect();
    for r in regs.into_iter().take(n.saturating_sub(1)) {
        let (ok, aid) = g.split(&p, &a.at("id"), &list![r]);
        assert!(ok, "{aid}");
        ids.push(Val::from(aid));
    }
    ids.iter().map(|i| g.armies.at(i)).collect()
}

fn marcher(g: &mut Game, a: &Val, nom: &str, tr: Val) {
    let p = g.player.clone();
    let nid = idx(g, nom);
    let (ok, msg) = par_la_route(g, &p, a, nid, tr);
    assert_eq!(ok, Some(true), "{msg}");
    TT::settle(g);
}

fn choisir(g: &mut Game, a: &Val, quoi: &str) -> (bool, String) {
    let p = g.player.clone();
    AA::choose(g, &p, a, quoi)
}

/// L'assaut depuis la fenêtre d'arrivée, puis, si la bataille attend le joueur, « le général décide » (stratégie, et
/// pas de poursuite) : la bataille se règle sur-le-champ, comme l'ancien choix « automatique ».
fn assaut(g: &mut Game, a: &Val) -> (bool, String) {
    let r = choisir(g, a, "assaut");
    let bid = a.get("battle");
    if r.0 && bid.truthy() {
        if g.battles.get(&bid).truthy() && g.battles.at(&bid).get("mode") == "attente" {
            assert!(TB::command(g, &dict! {"sub" => "choose", "bid" => &bid, "mode" => "auto"}).atb("ok"));
        }
        if g.battles.get(&bid).truthy() && g.battles.at(&bid).get("mode") == "poursuite" {
            assert!(TB::command(g, &dict! {"sub" => "pursue", "bid" => &bid, "v" => false}).atb("ok"));
        }
    }
    r
}

/// (SPEC-BATAILLE.md) L'assaut engage la bataille, qui attend la stratégie du joueur ; les anciens choix du champ de
/// bataille (« ordres », « manuel ») ne sont plus proposés ni acceptés.
#[test]
fn l_assaut_attend_la_strategie() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    let c = AA::ask_choices(&mut g, &a);
    assert!(c.get("assaut") == "" && !c.has("ordres") && !c.has("manuel") && !c.has("auto"));
    for vieux in ["ordres", "manuel", "auto"] {
        assert_eq!(choisir(&mut g, &a, vieux), (false, "Choix inconnu.".to_string()));
    }
    let (ok, msg) = choisir(&mut g, &a, "assaut");
    assert!(ok && msg.contains("stratégie"), "{msg}");
    let bt = g.battles.at(a.at("battle"));
    assert_eq!(bt.get("mode"), "attente");
    assert!(!a.get("ask").truthy());
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "ordres"});
    assert!(!r.atb("ok"), "le champ de bataille n'existe plus");
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "frontal"});
    assert!(r.atb("ok"), "{}", r.get("msg"));
    assert!(bt.get("mode") != "attente");
    // réglage « toujours automatique » : l'assaut ne demande rien
    let mut g = arrivee();
    g.settings.set("battles", "auto");
    let a = devant(&mut g, "Mérignac", 1);
    let (ok, msg) = choisir(&mut g, &a, "assaut");
    assert!(ok, "{msg}");
    assert!(!g.battles.values().iter().any(|b| TB::en_attente(b)));
}

#[test]
fn le_cas_du_rapport() {
    // Bordeaux scindée en trois, une marche par détachement, dans les deux ordres : chaque arrivée devant une ville
    // attend le choix du joueur, même en chemin (Léognan d'abord : Villenave-d'Ornon est sur la route)
    let mut g = arrivee();
    for ordre in [["Mérignac", "Cestas", "Léognan"], ["Léognan", "Cestas", "Mérignac"]] {
        g = arrivee();
        let d0 = ds0(&g);
        for (a, nom) in detachements(&mut g, 3).into_iter().zip(ordre) {
            marcher(&mut g, &a, nom, Val::None);
            assert!(a.get("ask").truthy(), "{} vers {nom} : un choix attend", a.at("name"));
            let nid = a.at("ask").at("node");
            assert_eq!((a.at("at_node"), a.at("state")), (nid.clone(), Val::from("idle")));
            assert!(g.nodes.at(&nid).at("owner") != g.player, "la ville ne se rallie pas d'elle-même");
            assert!(!g.battles.truthy(), "aucune bataille sans le choix du joueur");
        }
        assert_eq!(ds0(&g), d0);
    }
    let vil = idx(&g, "Villenave-d'Ornon");
    let a = g.armies.values().into_iter().find(|a| a.get_or("ask", dict! {}).get("node") == vil).unwrap();
    assert!(a.at("ask").at("path").truthy(), "la route vers Léognan est mise de côté");
    assert!(TT::march_left(&g, &a) > 0.0, "la marche qui reste est gardée");
}

#[test]
fn traverser_en_chemin_la_cible_demande() {
    let mut g = arrivee();
    let a = detachements(&mut g, 1).remove(0);
    marcher(&mut g, &a, "Léognan", Val::from(true));
    assert_eq!(a.at("ask").at("node"), idx(&g, "Léognan"), "Villenave-d'Ornon traversée ; Léognan, la cible, demande");
}

#[test]
fn meme_en_resolution_automatique() {
    let mut g = arrivee();
    g.settings.set("battles", "auto");
    let a = detachements(&mut g, 1).remove(0);
    marcher(&mut g, &a, "Mérignac", Val::None);
    assert!(a.get("ask").truthy());
    assert!(!g.battles.truthy());
}

#[test]
fn attendre() {
    let mut g = arrivee();
    let a = detachements(&mut g, 1).remove(0);
    marcher(&mut g, &a, "Mérignac", Val::None);
    let (ok, why) = TB::on_speed(&mut g, 1);
    assert!(!ok, "« Tour suivant » attend le choix");
    assert!(why.contains("Mérignac"));
    let (ok, msg) = choisir(&mut g, &a, "attendre");
    assert!(ok, "{msg}");
    assert!(!a.get("ask").truthy());
    assert_eq!((a.at("state"), a.at("hold")), (Val::from("idle"), Val::from(true)), "halte devant la place, actions dans le panneau");
    assert!(TB::on_speed(&mut g, 1).0);
    jouer_mois(&mut g, 1);
    assert_eq!(a.at("at_node"), idx(&g, "Mérignac"), "elle n'a pas bougé");
    assert!(g.nodes.at(idx(&g, "Mérignac")).at("owner") != g.player);
}

// ---------------------------------------------------------------- les choix (T2)

/// Un détachement (toute l'armée de Bordeaux si n = 1) arrêté devant sa première ville en marchant vers nom.
fn devant(g: &mut Game, nom: &str, n: usize) -> Val {
    let a = detachements(g, n).remove(0);
    g.factions.at(&g.player).at("res").set("livres", 1e5);
    marcher(g, &a, nom, Val::None);
    assert!(a.get("ask").truthy());
    a
}

#[test]
fn resolution_automatique() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    let (ok, msg) = assaut(&mut g, &a);
    assert!(ok, "{msg}");
    TT::settle(&mut g);
    assert!(!g.battles.truthy(), "réglée sur-le-champ");
    if g.armies.has(a.at("id")) {
        assert_eq!(TT::march_left(&g, &a), 0.0, "une bataille finit la marche du tour");
        assert!(!a.at("path").truthy());
    }
}

#[test]
fn rallier_puis_reprendre_la_route() {
    let mut g = arrivee();
    let a = devant(&mut g, "Léognan", 1);
    let vil = idx(&g, "Villenave-d'Ornon");
    assert_eq!(a.at("ask").at("node"), vil);
    let (ok, msg) = choisir(&mut g, &a, "rallier");
    assert!(ok, "{msg}");
    assert_eq!(g.nodes.at(vil).at("owner"), g.player);
    TT::settle(&mut g);
    assert_eq!(a.at("ask").at("node"), idx(&g, "Léognan"), "elle reprend sa route jusqu’à Léognan, qui demande à son tour");
}

#[test]
fn rallier_refuse_si_l_armee_est_trop_faible() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    let mer = idx(&g, "Mérignac");
    // (deux fois la défense : pas assez) ; army_power(a, 1.0) : le nom du terrain est un nombre en Python, ici "1.0"
    let f = 2.0 * g.node_defense_power(mer, true) / g.army_power(&a, "1.0");
    for r in a.at("regs").iter() {
        r.scale("n", f);
    }
    assert!(g.army_power(&a, "1.0") < 3.0 * g.node_defense_power(mer, true));
    let (ok, msg) = choisir(&mut g, &a, "rallier");
    assert!(!ok);
    assert!(msg.contains("trop faible"));
    assert!(a.get("ask").truthy(), "le choix reste ouvert");
}

#[test]
fn assieger_seulement_une_place_a_remparts() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    assert!(!AA::walled(&g.nodes.at(idx(&g, "Mérignac"))));
    assert!(!choisir(&mut g, &a, "assieger").0);
    assert!(!AA::ask_choices(&mut g, &a).has("assieger"));
}

#[test]
fn bloquer() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    let (ok, msg) = choisir(&mut g, &a, "bloquer");
    assert!(ok, "{msg}");
    assert!(g.nodes.at(idx(&g, "Mérignac")).at("siege").get("blocus").truthy());
    assert_eq!(a.at("state"), "siege");
}

#[test]
fn contribution_puis_reprendre_la_route() {
    let mut g = arrivee();
    let a = devant(&mut g, "Léognan", 1);
    let (ok, msg) = choisir(&mut g, &a, "contribution");
    assert!(ok, "{msg}");
    TT::settle(&mut g);
    assert_eq!(a.at("ask").at("node"), idx(&g, "Léognan"));
}

#[test]
fn negocier_l_armee_reste_devant_la_place() {
    // (revue : les pourparlers exigent l'armée devant la place ; repartie, ils seraient rompus)
    let mut g = arrivee();
    let a = devant(&mut g, "Léognan", 1);
    let vil = idx(&g, "Villenave-d'Ornon");
    let (ok, msg) = choisir(&mut g, &a, "negocier");
    assert!(ok, "{msg}");
    assert!(msg.contains("au prochain tour"));
    TT::settle(&mut g);
    assert_eq!((a.at("at_node"), a.at("path")), (Val::from(vil), vide()));
    g.nodes.at(vil).at("aa").at("ng").set("risk", 0.0);
    jouer_mois(&mut g, 1);
    assert_eq!(g.nodes.at(vil).at("owner"), g.player, "les notables rallient la place");
}

#[test]
fn le_rapport_de_bout_en_bout() {
    // chaque détachement choisit à chaque ville (ici : rallier quand c'est permis, sinon l'assaut automatique) ;
    // à la fin, plus rien n'attend, « Tour suivant » part, et aucune bataille n'a été engagée sans choix
    let mut g = arrivee();
    for (a, nom) in detachements(&mut g, 3).into_iter().zip(["Léognan", "Cestas", "Mérignac"]) {
        marcher(&mut g, &a, nom, Val::None);
        for _ in 0..10 {
            if !a.get("ask").truthy() {
                break;
            }
            assert!(!g.battles.values().iter().any(|bt| bt.get("mode") == "attente"));
            let quoi = if AA::ask_choices(&mut g, &a).get("rallier") == "" { "rallier" } else { "assaut" };
            let (ok, msg) = if quoi == "assaut" { assaut(&mut g, &a) } else { choisir(&mut g, &a, quoi) };
            assert!(ok, "{msg}");
            TT::settle(&mut g);
        }
    }
    assert!(AA::asking(&mut g).is_none());
    assert!(TB::on_speed(&mut g, 1).0);
}

// ---------------------------------------------------------------- après la revue

#[test]
fn un_choix_perime_est_leve() {
    let mut g = arrivee();
    let p = g.player.clone();
    // l'armée reçoit un autre ordre de marche
    let a = devant(&mut g, "Mérignac", 1);
    let cap = g.capital_of(&p).i();
    assert_eq!(par_la_route(&mut g, &p, &a, cap, Val::None).0, Some(true));
    TT::settle(&mut g);
    assert!(AA::asking(&mut g).is_none());
    assert!(!choisir(&mut g, &a, "assaut").0);
    assert!(!g.battles.truthy());
    // deux détachements devant Mérignac : l'un la rallie, le choix de l'autre tombe (la ville est à nous)
    let mut g = arrivee();
    let mut d = detachements(&mut g, 2);
    let (a, b) = (d.remove(0), d.remove(0));
    marcher(&mut g, &a, "Mérignac", Val::None);
    marcher(&mut g, &b, "Mérignac", Val::None);
    assert!(a.get("ask").truthy() && b.get("ask").truthy());
    if AA::ask_choices(&mut g, &a).at("rallier").truthy() {
        for r in a.at("regs").iter() {
            r.scale("n", 10);
        }
    }
    assert!(choisir(&mut g, &a, "rallier").0);
    assert!(AA::asking(&mut g).is_none());
    assert!(!choisir(&mut g, &b, "assaut").0, "pas d’assaut contre sa propre ville");
}

/// `a['at_node'], a['path'], a['state'], a['tr'], a['hold'] = None, [], state, tr, False` puis la position de nid.
fn en_marche(g: &Game, a: &Val, nid: i64, state: &str, tr: bool) {
    a.set("at_node", Val::None);
    a.set("path", vide());
    a.set("state", state);
    a.set("tr", tr);
    a.set("hold", false);
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
}

#[test]
fn pas_de_choix_pendant_le_tour_des_ia() {
    // (un choix posé pendant le tour des IA bloquerait la partie : on fait comme avant)
    let mut g = arrivee();
    let a = detachements(&mut g, 1).remove(0);
    let mer = idx(&g, "Mérignac");
    g.tour.set("end", g.t + 20.0);
    en_marche(&g, &a, mer, "move", false);
    g.arrive_node(&a, mer, true);
    assert!(!a.get("ask").truthy());
}

#[test]
fn une_armee_en_retraite_ne_demande_rien() {
    let mut g = arrivee();
    let a = detachements(&mut g, 1).remove(0);
    let mer = idx(&g, "Mérignac");
    en_marche(&g, &a, mer, "retreat", false);
    g.arrive_node(&a, mer, true);
    assert!(!a.get("ask").truthy());
}

#[test]
fn en_temps_reel_la_campagne_attend() {
    let mut g = arrivee();
    g.tour.set("on", false);
    g.speed_idx = 1;
    let a = detachements(&mut g, 1).remove(0);
    let mer = idx(&g, "Mérignac");
    en_marche(&g, &a, mer, "move", false);
    g.arrive_node(&a, mer, true);
    assert!(a.get("ask").truthy());
    assert_eq!(g.speed_idx, 0, "le temps s’arrête");
}

#[test]
fn apres_un_assaut_en_chemin_elle_repart_au_tour_suivant() {
    let mut g = arrivee();
    let a = devant(&mut g, "Léognan", 1);
    let vil = idx(&g, "Villenave-d'Ornon");
    for r in a.at("regs").iter() {
        r.scale("n", 4); // (une victoire nette)
    }
    assert!(assaut(&mut g, &a).0);
    TT::settle(&mut g);
    assert_eq!(g.nodes.at(vil).at("owner"), g.player);
    assert_eq!(TT::march_left(&g, &a), 0.0, "la bataille finit la marche du tour");
    assert!(a.at("path").truthy(), "la route vers Léognan est gardée");
    jouer_mois(&mut g, 1);
    assert_eq!(a.at("ask").at("node"), idx(&g, "Léognan"), "au tour suivant, elle repart et Léognan demande");
}

#[test]
fn un_assaut_sur_une_bataille_en_cours_la_rejoint() {
    let mut g = arrivee();
    let mut d = detachements(&mut g, 2);
    let (a, b) = (d.remove(0), d.remove(0));
    marcher(&mut g, &a, "Mérignac", Val::None);
    marcher(&mut g, &b, "Mérignac", Val::None);
    assert!(choisir(&mut g, &a, "assaut").0);
    assert!(choisir(&mut g, &b, "assaut").0);
    assert_eq!(g.battles.len(), 1, "une seule bataille devant Mérignac");
    assert_eq!(b.at("battle"), a.at("battle"));
}

#[test]
fn rallier_ou_attaquer_pendant_le_choix_garde_la_route() {
    let mut g = arrivee();
    let p = g.player.clone();
    let a = devant(&mut g, "Léognan", 1);
    assert!(AA::conquer(&mut g, &p, &a).0);
    assert!(a.at("ask").at("path").truthy(), "la route vers Léognan n’est pas perdue");
}

#[test]
fn assieger_assiege_sans_rallier() {
    let mut g = arrivee();
    let a = detachements(&mut g, 1).remove(0);
    let nid = g.nodes.iter().find(|n| n.at("owner") == R::NEUTRAL && AA::walled(n) && n.at("fort") >= 2i64).unwrap().ati("id");
    en_marche(&g, &a, nid, "move", true);
    for r in a.at("regs").iter() {
        r.scale("n", 50); // (assez forte pour la rallier : elle choisit pourtant le siège)
    }
    g.arrive_node(&a, nid, true);
    assert_eq!(a.at("ask").at("node"), nid);
    let (ok, msg) = choisir(&mut g, &a, "assieger");
    assert!(ok, "{msg}");
    assert_eq!(a.at("state"), "siege");
    assert_eq!(g.nodes.at(nid).at("owner"), R::NEUTRAL);
    assert!(a.at("tr").truthy(), "la conduite est gardée");
}

#[test]
fn un_detachement_d_une_armee_en_halte_reste_en_halte() {
    let mut g = arrivee();
    let p = g.player.clone();
    let a = devant(&mut g, "Mérignac", 1);
    assert!(choisir(&mut g, &a, "attendre").0);
    let (ok, bid) = g.split(&p, &a.at("id"), &list![a.at("regs").at(0).at("id")]);
    assert!(ok, "{bid}");
    assert!(g.armies.at(bid.as_str()).get("hold").truthy());
}

// ---------------------------------------------------------------- chasse aux bugs du 18/10/2026

#[test]
fn un_autre_prend_la_ville_d_assaut_l_armee_qui_attendait_repart() {
    let mut g = arrivee();
    let mut d = detachements(&mut g, 2);
    let (a, b) = (d.remove(0), d.remove(0));
    marcher(&mut g, &a, "Léognan", Val::None); // (arrêtée devant Villenave-d'Ornon)
    marcher(&mut g, &b, "Villenave-d'Ornon", Val::None);
    for r in b.at("regs").iter() {
        r.scale("n", 4);
    }
    assert!(assaut(&mut g, &b).0);
    TT::settle(&mut g); // (comme le serveur après la commande)
    assert_eq!(g.nodes.at(idx(&g, "Villenave-d'Ornon")).at("owner"), g.player);
    assert_eq!(a.at("ask").at("node"), idx(&g, "Léognan"), "la ville prise, elle reprend sa route tout de suite");
}

#[test]
fn la_place_prise_les_assiegeants_sont_liberes() {
    let mut g = arrivee();
    let mut d = detachements(&mut g, 2);
    let (a, b) = (d.remove(0), d.remove(0));
    marcher(&mut g, &a, "Mérignac", Val::None);
    assert!(choisir(&mut g, &a, "bloquer").0);
    for r in b.at("regs").iter() {
        r.scale("n", 10); // (assez forte pour la rallier en arrivant)
    }
    marcher(&mut g, &b, "Mérignac", Val::None);
    assert_eq!(g.nodes.at(idx(&g, "Mérignac")).at("owner"), g.player);
    assert_eq!(a.at("state"), "idle", "plus de siège devant sa propre ville");
}

#[test]
fn retraite_d_une_bataille_qui_ne_vous_concerne_plus() {
    let mut g = arrivee();
    let p = g.player.clone();
    let (ally, foe) = ("24", "47");
    g.set_status(&p, ally, "alliance");
    g.set_status(ally, foe, "guerre");
    g.set_status(&p, foe, "guerre");
    let city = g.capital_of(ally).i();
    let (cx, cy) = g.node_xy(city);
    let a = armee(&g);
    a.set("x", cx);
    a.set("y", cy);
    a.set("at_node", city);
    a.set("state", "idle");
    a.set("path", vide());
    let e = armee_de(&g, foe);
    e.set("x", cx);
    e.set("y", cy);
    g.start_battle(&list![&e], &vide(), cx, cy, &Val::from(city), false, false);
    let bt = g.battles.values().remove(0);
    assert_eq!(bt.at("mode"), "attente");
    assert!(g.order_retreat(&p, &a.at("id")).0);
    assert!(!TB::involves_player(&g, &bt));
    assert_eq!(bt.at("mode"), "auto", "elle se règle sans vous : la campagne n’attend plus");
}

#[test]
fn recharger_ne_decale_pas_les_echeances_entre_ia() {
    let mut g = arrivee();
    let p = g.player.clone();
    let mine = g.nodes.iter().find(|n| n.at("owner") == p.as_str()).unwrap();
    let other = g.nodes.iter().find(|n| !(n.at("owner") == p.as_str() || n.at("owner") == R::NEUTRAL)).unwrap();
    for n in [&mine, &other] {
        n.set("tm", list![dict! {"until" => g.t + 37.1}]);
    }
    g.factions.at("24").at("truce").set("47", g.t + 41.3); // (une trêve entre IA)
    TT::migrate(&mut g);
    presque(other.at("tm").at(0).atf("until"), g.t + 37.1, 7); // ville d’une IA : son échéance ne bouge pas
    presque(g.factions.at("24").at("truce").atf("47"), g.t + 41.3, 7);
    assert_eq!(mine.at("tm").at(0).at("until"), TT::turn_start_after(&g, g.t + 37.1), "les vôtres : au début d’un tour");
}

#[test]
fn choix_inconnu() {
    let mut g = arrivee();
    let a = devant(&mut g, "Mérignac", 1);
    assert!(!choisir(&mut g, &a, "piller").0);
    assert!(a.get("ask").truthy());
}

#[test]
fn une_ia_fait_comme_avant() {
    let mut g = arrivee();
    let p = g.player.clone();
    D::declare_war(&mut g, "24", &p, true);
    let b = armee_de(&g, "24");
    let nid = idx(&g, "Libourne");
    en_marche(&g, &b, nid, "move", false);
    g.arrive_node(&b, nid, true);
    assert!(!b.get("ask").truthy());
    assert!(b.at("state") == "siege" || b.at("state") == "battle");
}

// ================================================================== TempsReel

#[test]
fn effets_par_jour_en_temps_reel() {
    assert!(CT::fx_text(&dict! {"livres" => 0.1}, &Val::None, false).contains("/tour"));
    assert!(CT::fx_text(&dict! {"livres" => 0.1}, &Val::None, true).contains("/j"));
    let mut g = partie();
    let nid = g.capital_of(&g.player);
    let v = dict! {"nid" => nid, "add" => dict! {"fer" => 0.2}};
    assert!(CT::describe_local(&g, &v).at(0).s().contains("par tour"));
    TT::command(&mut g, "mode", &Val::from(false));
    assert!(CT::describe_local(&g, &v).at(0).s().contains("par jour"));
}

// ================================================================== Regles

#[test]
fn un_evenement_n_efface_pas_une_dette() {
    // (le Python passe un faux objet partie, dont toute autre méthode ne fait rien ; ici, une vraie partie dont le
    // trésor du camp est remplacé : recompute_mods, appelé à la fin d'events.apply, y trouve ce qu'il lit)
    for (liv, fx, want) in [
        (-1000, dict! {"res" => dict! {"livres" => -60}}, -1000.0),
        (-1000, dict! {"res" => dict! {"livres" => 40}}, -960.0),
        (100, dict! {"res" => dict! {"livres" => -160}}, 0.0),
        (-1000, dict! {"res_pct" => dict! {"livres" => 0.2}}, -1000.0),
        (100, dict! {"res_pct" => dict! {"livres" => 0.2}}, 120.0),
    ] {
        let mut g = partie();
        g.factions.at("24").set("res", dict! {"livres" => liv});
        E::apply(&mut g, "24", &fx, &Val::None);
        presque(g.factions.at("24").at("res").at("livres").f(), want, 7);
    }
}

#[test]
fn prix_du_marche_une_seule_source() {
    let g = partie();
    assert_eq!(g.market, R::MARKET_BASE());
}

// ================================================================== TraceDesRoutes

/// Bug vu sur la carte : Bordeaux–Cadillac, tirée droit, roulait sur la Garonne en la franchissant plusieurs
/// fois. Le tracé contourne l'eau et ne la franchit pas plus souvent que la ligne droite (hors des villes
/// bâties sur la rive).
#[test]
fn les_routes_ne_suivent_pas_les_fleuves() {
    use conquete::geo::_seg_inter;
    let geo = GEO();
    let rivers: Vec<Vec<(f64, f64)>> = geo
        .src
        .at("rivers")
        .iter()
        .filter(|r| r.at("rank") <= 2i64)
        .map(|r| r.at("pts").iter().map(|p| geo.xy(p.atf(1), p.atf(0))).collect())
        .collect();
    let pts = |v: &Val| -> Vec<(f64, f64)> { v.iter().map(|p| p.xy()).collect() };
    let crossings = |path: &[(f64, f64)], a: (f64, f64), b: (f64, f64), marge: f64| -> usize {
        let mut n = 0;
        for w in path.windows(2) {
            for r in &rivers {
                for s in r.windows(2) {
                    if let Some((_, it)) = _seg_inter(w[0], w[1], s[0], s[1]) {
                        let d = py::dist(it.0, it.1, a.0, a.1).min(py::dist(it.0, it.1, b.0, b.1));
                        if d > marge {
                            n += 1;
                        }
                    }
                }
            }
        }
        n
    };
    let xy = |i: Val| (geo.nodes.at(&i).atf("x"), geo.nodes.at(&i).atf("y"));
    let nom = |i: Val| geo.nodes.at(&i).ats("name");
    for e in geo.edges.iter() {
        if e.get("kind") == "water" {
            continue;
        }
        let (a, b) = (xy(e.at("a")), xy(e.at("b")));
        let route = (nom(e.at("a")), nom(e.at("b")));
        let p = pts(&e.at("pts"));
        let (p0, pn) = (p[0], p[p.len() - 1]);
        assert!(py::dist(p0.0, p0.1, a.0, a.1) + py::dist(pn.0, pn.1, b.0, b.1) < 0.02, "{route:?}");
        assert!(crossings(&p, a, b, 0.6) <= 1.max(crossings(&[a, b], a, b, 0.6)), "{route:?}");
        let long = py::sum(p.windows(2).map(|w| py::dist(w[0].0, w[0].1, w[1].0, w[1].1)));
        assert!(long < 2.2 * py::dist(a.0, a.1, b.0, b.1) + 1.0, "{route:?}");
    }
    let paire = |e: &Val, x: &str, y: &str| {
        let (u, v) = (nom(e.at("a")), nom(e.at("b")));
        (u == x && v == y) || (u == y && v == x)
    };
    assert!(!geo.edges.iter().any(|e| paire(&e, "Urdos", "Laruns")), "pas de route par la montagne entre les vallées d’Aspe et d’Ossau");
    let bc = geo.edges.iter().find(|e| paire(e, "Bordeaux", "Cadillac")).unwrap();
    let p = pts(&bc.at("pts"));
    assert_eq!(crossings(&p, p[0], p[p.len() - 1], 0.0), 1); // (au pied de Cadillac)
}

// ================================================================== RoutesCoupeesParLaCrue

/// La grande crue (tirée un printemps sur cinq environ) coupe les routes des prés noyés (le critère de la carte,
/// game/crue.py) : la vue les envoie, l'armée y perd un jour sur l'arête, la recherche de chemin le sait.
#[test]
fn coupee_en_avril_pas_en_juin_et_l_armee_y_marche_lentement() {
    let mut g = partie();
    let p = g.player.clone();
    g.flood_until = -1.0;
    let an = date(&g).year + 1;
    let cut = CR::spans(&GEO());
    assert_eq!(cut.len(), 27, "les rivières affinées et les troncs communs des routes (geo._troncs)");
    let eid = py::max_by_key(cut.iter().collect::<Vec<_>>(), |k| GEO().edges.at(k).atf("len")).unwrap();
    let e = GEO().edges.at(&eid);
    // `g.has_sapeurs = lambda a: True` (sans l'attente au bac : ces routes passent toutes le fleuve) : ici, le camp
    // franchit les fleuves sans bac (`mods['bridges']`, l'autre condition de la même attente dans move_army) ; le coût
    // d'edge_cost perd alors son attente au bac des deux côtés de la comparaison
    g.factions.at(&p).at("mods").set("bridges", 1);
    g.t = (ordinal(an, 4, 15) - g.start_ord) as f64;
    assert_eq!(g.cut_edges(), dict! {}, "pas de crue tirée : avril ne coupe rien");
    g.flood_until = g.t + 30.0;
    assert!(g.cut_edges().has(&eid));
    assert!(V::player_state(&mut g, 0).at("cut").iter().any(|c| c.at(0) == eid));
    g.t = (ordinal(an, 6, 15) - g.start_ord) as f64;
    assert_eq!(g.cut_edges(), dict! {}, "la crue passée");
    assert!(!V::player_state(&mut g, 0).has("cut"));
    let a = armee(&g);
    let marche = |g: &mut Game| -> f64 {
        a.update(&dict! {"state" => "move", "edge" => Val::None, "rail" => false, "emb" => 0.0,
            "path" => list![dict! {"kind" => "road", "e" => &eid, "frm" => e.at("a"), "to" => e.at("b"), "pos" => 0.0}]});
        let (x, y) = g.node_xy(e.ati("a"));
        a.set("x", x);
        a.set("y", y);
        g.move_army(&a, 0.2);
        a.at("path").at(0).atf("pos")
    };
    let sec = marche(&mut g);
    let c0 = g.edge_cost(&p, &e, &Val::None, 22.0);
    assert!(sec > 1.0);
    g.flood_until = g.t + 10.0; // la crue tirée au printemps dure encore
    let sp = sec / 0.2;
    let len = e.atf("len");
    presque(marche(&mut g), 0.2 * len / (len / sp + CR::DELAY), 7);
    presque(g.edge_cost(&p, &e, &Val::None, 22.0), c0 + 22.0 * CR::DELAY, 7);
}

// ================================================================== DepartSansDeficit

/// Les ateliers d'une partie neuve dépassaient le fer et le bois du département (dès 1790 : Gironde −29 fer par
/// tour, à 0 en trois tours) : sous la réserve, ils ne travaillent que ce qui est produit chaque jour.
#[test]
fn aucune_ressource_en_baisse_au_depart() {
    let mut dernier = None;
    for ep in ["1700", "1790", "1813", "1870"] {
        for code in ["33", "64"] {
            let mut g = partie_avec(code, ep, 1, "normal");
            let f = g.factions.at(code);
            let neg: Vec<String> = f.at("income").items().into_iter().filter(|(_, v)| *v < 0i64).map(|(k, _)| k.string()).collect();
            assert!(neg.is_empty(), "{ep} {code} : {neg:?}");
            let r0 = f.at("res").copy();
            jouer_mois(&mut g, 1);
            let bas: Vec<String> = r0.keys().into_iter().filter(|k| f.at("res").atf(k) < r0.atf(k) - 0.5).map(|k| k.string()).collect();
            assert!(bas.is_empty(), "{ep} {code} : en baisse après un tour : {bas:?}");
            dernier = Some((g, f));
        }
    }
    let (mut g, f) = dernier.unwrap();
    let me = V::player_state(&mut g, 0).at("me");
    assert_eq!(me.at("work").at(1), "fer", "1870 : les ateliers manquent de fer, la fiche le dit");
    assert!(me.at("work").at(0) < 1.0);
    f.at("res").set("fer", 400); // au-dessus de la réserve (achat au marché) : pleine capacité, le stock baisse
    g.compute_income();
    assert_eq!(f.at("_work").at(0), 1.0);
    assert!(f.at("income").at("fer") < 0i64);
}

/// 81 fer en 1870 : les ateliers travaillaient un jour à pleine capacité et descendaient à 66 ; ils ne
/// prennent plus que ce qui dépasse la réserve.
#[test]
fn un_stock_juste_au_dessus_de_la_reserve_n_y_descend_pas() {
    let mut g = partie_avec("33", "1870", 1, "normal");
    let f = g.factions.at("33");
    let wr = R::WORKSHOP_RESERVE();
    f.at("res").set("fer", &wr.at("fer") + 1);
    f.at("res").set("bois", &wr.at("bois") + 1);
    g.compute_income();
    TT::go(&mut g);
    let (mut fer, mut bois) = (f.at("res").atf("fer"), f.at("res").atf("bois"));
    while g.t < 3.0 {
        TT::advance(&mut g, 0.5);
        if g.tour.at("stop").truthy() || g.tour.at("end").is_none() {
            TT::go(&mut g);
        }
        fer = fer.min(f.at("res").atf("fer"));
        bois = bois.min(f.at("res").atf("bois"));
    }
    assert!(fer >= wr.atf("fer") - 0.5);
    assert!(bois >= wr.atf("bois") - 0.5);
}

// ================================================================== IADepenseSonTresor

/// Les IA amassaient 60 000 livres en 1802 et 280 000 en 1878 (outils/simuler.py) : bâtiments et remparts faits,
/// l'armée plafonnait au revenu. L'argent qui dort au-delà de deux trésors de guerre (AI.idle_money) paie des
/// régiments de plus (quatre ans de solde et de rations), tant que le revenu en livres et en vivres reste positif :
/// revenu négatif, pas un de plus (personne ne les licencierait) ; la réserve reste.
///
/// Le Python remplace, le temps de six mois de jeu, g.compute_income (un revenu en livres amputé d'un déficit),
/// AI.idle_money (rendu nul) et AI.relieve_taxes (sans effet) : des méthodes que le moteur appelle lui-même, qu'on ne
/// remplace pas en Rust sans toucher au moteur.
#[test]
#[ignore = "non portable : le Python remplace g.compute_income, AI.idle_money et AI.relieve_taxes (mock) pendant six mois de jeu"]
fn au_dela_de_deux_tresors_de_guerre_l_ia_arme_davantage() {}

// ================================================================== CruesDesVilles

/// L'événement « crue » d'une place suit la grande crue (engine : flood_until, tirée en mars un printemps sur
/// cinq) : jamais l'été, jamais loin de la Garonne et de la Dordogne, presque jamais hors des années de crue.
#[test]
fn au_printemps_au_bord_des_grands_fleuves_surtout_l_annee_de_la_grande_crue() {
    let mut g = partie();
    let w = |g: &Game, n: &Val| -> f64 {
        let mut x = 0.0;
        for (e, v) in CT::weights(g, n) {
            if e.at("id") == "crue" {
                x = v;
            }
        }
        x
    };
    let grand = |g: &Game, nid: i64| CT::_river(g, nid).iter().any(|r| CT::GRANDS().has(&r));
    let bord = g.nodes.iter().find(|n| GEO().nodes.at(n.at("id")).at("name") == "Langon").unwrap();
    let loin: Vec<Val> = g.nodes.iter().filter(|n| g.factions.has(n.at("owner")) && !grand(&g, n.ati("id"))).collect();
    let an = date(&g).year + 1;
    g.flood_until = -1.0;
    au(&mut g, an, 4, 10);
    let calme = w(&g, &bord);
    assert!(calme > 0.0);
    g.flood_until = g.t + 20.0;
    assert!(w(&g, &bord) > 20.0 * calme, "pendant la grande crue");
    assert_eq!(py::max_f(loin.iter().map(|n| w(&g, n))).unwrap(), 0.0, "loin des grands fleuves (Lot, Adour, côte…)");
    au(&mut g, an, 5, 20);
    assert!(w(&g, &bord) > 5.0 * calme, "l'année de la grande crue");
    for m in [7, 8, 10, 1] {
        au(&mut g, an, m, 5);
        assert_eq!(w(&g, &bord), 0.0, "hors du printemps (mois {m})");
    }
    assert!(CT::LOCAL_BY_ID().at("crue").ats("text").contains("printemps"));
    g.pending_ev.clear();
    let avant = g.pending_ev.len() as i64;
    for _ in 0..8 {
        // la grande crue tirée : une place du camp au bord du fleuve, une fois sur deux
        for n in g.nodes.iter() {
            n.pop("evt");
        }
        CT::grande_crue(&mut g);
    }
    let ev: Vec<Val> = g.pending_ev.slice(Some(avant), None).iter().filter(|p| p.at("ev") == "crue").collect();
    assert!(!ev.is_empty());
    assert!(ev.iter().all(|p| grand(&g, p.ati("town"))));
}

// ================================================================== Sauvegarde

#[test]
fn aller_retour() {
    let mut g = partie();
    jouer_mois(&mut g, 1);
    g.ais.get_mut("24").unwrap().as_mut().unwrap().relief = 0.1; // une IA qui a baissé ses impôts…
    let d1 = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let mut g2 = V::from_dict(GEO(), &d1).unwrap();
    assert_eq!(g2.ais["24"].as_ref().unwrap().relief, 0.1); // … les garde après un chargement
    let d2 = json::loads(&json::dumps(&V::to_dict(&mut g2))).unwrap();
    assert_eq!(d1.at("t"), d2.at("t"));
    let cles = |d: &Val| {
        let mut v: Vec<String> = d.at("armies").keys().iter().map(|k| k.string()).collect();
        v.sort();
        v
    };
    assert_eq!(cles(&d1), cles(&d2));
    let owners = |d: &Val| d.at("nodes").iter().map(|n| n.at("owner")).collect::<Vec<_>>();
    assert_eq!(owners(&d1), owners(&d2));
    assert_eq!(d1.at("ai_state"), d2.at("ai_state"));
}

// ================================================================== CompleterLesRangs
// « Compléter les rangs » : les conscrits du dépôt rejoignent l'armée dans une de nos villes, en 1 tour (2 au-delà
// de 30 % de pertes) ; ils diluent l'expérience des anciens ; un régiment anéanti ne revient pas tout seul.

/// `CompleterLesRangs.prete(g, a, part, code=None)`
fn prete(g: &Game, a: &Val, part: f64, code: Option<&str>) -> i64 {
    let code = code.map(str::to_string).unwrap_or_else(|| g.player.clone());
    let nid = g
        .owned_nodes(&code)
        .iter()
        .find(|n| g.geo.nodes.at(n.at("id")).at("type") != "village" && !n.at("siege").truthy())
        .unwrap()
        .ati("id");
    a.set("at_node", nid);
    a.set("path", vide());
    a.set("state", "idle");
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
    let res = g.factions.at(code.as_str()).at("res");
    res.set("recrues", 1e4);
    res.set("armes", 1e4);
    for r in a.at("regs").iter() {
        r.set("n", part * r.atf("max"));
    }
    nid
}

fn plein(a: &Val) -> f64 {
    py::sum(a.at("regs").iter().map(|r| r.atf("n"))) / py::sum(a.at("regs").iter().map(|r| r.atf("max")))
}

/// Cavalerie et artillerie au complet : seules les pertes de l'infanterie comptent (pas de remontes).
fn pied(a: &Val) {
    for r in a.at("regs").iter() {
        if AA::monte(&r) {
            r.set("n", r.at("max"));
        }
    }
}

fn rangs(g: &mut Game, a: &Val) -> (bool, String) {
    let p = g.player.clone();
    AA::command(g, &p, &a.at("id"), &Val::from("rangs"))
}

#[test]
fn un_tour_si_peu_de_pertes() {
    let mut g = partie();
    let a = armee(&g);
    let nid = prete(&g, &a, 0.8, None);
    pied(&a);
    let rg = AA::options(&mut g, &a, nid).at("rg");
    assert_eq!((rg.at("t"), rg.at("why")), (Val::from(1), Val::from("")));
    let (ok, msg) = rangs(&mut g, &a);
    assert!(ok, "{msg}");
    assert!(msg.contains("au prochain tour"));
    jouer_mois(&mut g, 1);
    assert!(!a.at("rg").truthy());
    for r in a.at("regs").iter() {
        proche(r.atf("n"), r.atf("max"), 1.0);
    }
    let men = rg.atf("men");
    proche(g.factions.at(&g.player).at("res").atf("recrues"), 1e4 - men, 0.05 * men);
}

#[test]
fn deux_tours_si_lourdes_pertes() {
    let mut g = partie();
    let a = armee(&g);
    let nid = prete(&g, &a, 0.5, None);
    pied(&a);
    let o = AA::options(&mut g, &a, nid);
    assert_eq!(o.at("rg").at("t"), 2);
    assert_eq!(o.at("garde").at("armes"), AA::garde_info(&g.nodes.at(nid)).1, "le prix de la garde ne prend pas celui des renforts");
    assert_eq!(o.at("rg").at("armes"), AA::rangs_info(&g, &a).1);
    assert!(rangs(&mut g, &a).0);
    jouer_mois(&mut g, 1);
    assert!(0.6 < plein(&a) && plein(&a) < 0.98, "{}", plein(&a));
    assert!(a.at("rg").truthy(), "à moitié refaite");
    jouer_mois(&mut g, 1);
    assert!(!a.at("rg").truthy());
    proche(plein(&a), 1.0, 0.01);
}

#[test]
fn experience_diluee() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    prete(&g, &a, 1.0, None);
    let r = a.at("regs").iter().find(|r| r.at("type") == "ligne").unwrap();
    r.set("n", 150.0);
    r.set("xp", 60.0);
    assert!(rangs(&mut g, &a).0);
    jouer_mois(&mut g, 1);
    proche(r.atf("n"), 300.0, 1.0);
    proche(r.atf("xp"), 30.0, 3.0);
    let reg = dict! {"type" => "ligne", "n" => 100.0, "max" => 300, "xp" => 60.0}; // le renfort ordinaire (replenish) dilue de même
    assert!(g.reinforce(&p, &reg, 100.0));
    presque(reg.atf("xp"), 30.0, 7);
    g.factions.at(&p).at("res").set("recrues", 0);
    assert!(!g.reinforce(&p, &reg, 10.0), "sans recrues, rien");
}

#[test]
fn refus() {
    let mut g = partie();
    let a = armee(&g);
    let p = g.player.clone();
    let nid = prete(&g, &a, 0.7, None);
    let why = |g: &Game| AA::rangs_why(g, &p, &a);
    a.set("at_node", Val::None);
    assert!(why(&g).contains("à l'arrêt dans une de vos places"));
    let vil = g.nodes.iter().find(|n| g.geo.nodes.at(n.at("id")).at("type") == "village" && !n.get("depot").truthy()).unwrap();
    vil.set("owner", p.as_str());
    vil.set("siege", Val::None);
    a.set("at_node", vil.at("id"));
    assert!(why(&g).contains("Il faut une ville ou un magasin"));
    a.set("at_node", nid);
    g.nodes.at(nid).set("siege", dict! {"by" => "24", "dmg" => 0.0});
    assert!(why(&g).contains("assiégée"));
    g.nodes.at(nid).set("siege", Val::None);
    g.factions.at(&p).at("res").set("recrues", 0);
    assert!(why(&g).contains("Il faut"));
    assert!(!rangs(&mut g, &a).0);
    g.factions.at(&p).at("res").set("recrues", 1e4);
    assert_eq!(why(&g), "");
    assert!(rangs(&mut g, &a).0);
    assert!(why(&g).contains("déjà en route"));
    for r in a.at("regs").iter() {
        r.set("n", r.at("max"));
    }
    a.set("rg", false);
    assert!(why(&g).contains("au complet"));
}

#[test]
fn annule_si_l_armee_part() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let nid = prete(&g, &a, 0.5, None);
    assert!(rangs(&mut g, &a).0);
    AA::tick(&mut g, 5.0, false);
    let avant = g.army_men(&a);
    assert!(avant > 0.5 * py::sum(a.at("regs").iter().map(|r| r.atf("max"))) + 1.0, "des hommes sont déjà arrivés");
    let autre = g.owned_nodes(&p).iter().find(|n| n.at("id") != nid).unwrap().ati("id");
    vers_place(&mut g, &p, &a, autre);
    TT::settle(&mut g);
    AA::tick(&mut g, 1.0, false);
    assert!(!a.at("rg").truthy());
    assert!(g.army_men(&a) >= avant - 5.0, "les hommes arrivés restent");
    assert!(g.events.slice(Some(-5), None).iter().any(|e| e.ats("text").contains("s'arrêtent")));
}

#[test]
fn regiment_aneanti_pas_recree() {
    let mut g = partie();
    let a = armee(&g);
    prete(&g, &a, 0.8, None);
    a.at("regs").pop_last();
    let nb = a.at("regs").len();
    assert!(rangs(&mut g, &a).0);
    jouer_mois(&mut g, 1);
    assert_eq!(a.at("regs").len(), nb);
}

#[test]
fn ia_complete_ses_rangs() {
    // (`ai.wars = lambda: []` : le Périgord n'est en guerre avec personne au départ, ai.wars() est déjà vide)
    let mut g = partie();
    let mut ai = g.ais["24"].take().unwrap();
    let a = armee_de(&g, "24");
    prete(&g, &a, 0.6, Some("24"));
    assert_eq!(ai.wars(&g), vide());
    AA::ai_step(&mut g, &mut ai);
    assert!(a.at("rg").truthy());
    g.ais["24"] = Some(ai);
}

#[test]
fn vue() {
    let mut g = partie();
    let a = armee(&g);
    prete(&g, &a, 0.8, None);
    pied(&a);
    let d = vue_armee(&mut g, &a.at("id"));
    assert_eq!(d.at("ax").at("rg").at("why"), "");
    assert!(rangs(&mut g, &a).0);
    let d = vue_armee(&mut g, &a.at("id"));
    assert_eq!(d.at("rg").at(0), 1);
    assert_eq!(d.at("ax").at("rg").at("w"), 1);
    let g2 = sauver_relire(&mut g); // la sauvegarde garde les renforts en route
    assert_eq!(g2.armies.at(a.at("id")).at("rg").at("node"), a.at("rg").at("node"));
}

// ================================================================== BancEquilibre
// outils/simuler.py : des parties jouées par les IA seules, pour mesurer l'équilibre (SPEC-TECH.md).

#[test]
fn meme_graine_meme_partie() {
    let (a, b) = (simuler(5, "1790", 2, "33"), simuler(5, "1790", 2, "33"));
    assert!(a.at("err").is_none(), "{}", a.at("err"));
    assert_eq!(a, b, "même graine : mêmes mesures");
}

// ================================================================== ArbreDesTechnologies
// SPEC-TECH.md, module arbre : 94 technologies datées, prérequis cohérents, chaque effet lu par le moteur.

#[test]
fn prerequis_existants_sans_cycle_ni_anachronisme() {
    let tech = R::TECH();
    assert_eq!(tech.len(), 94);
    for t in tech.values() {
        assert!(R::TECH_YEAR().has(t.at("id")), "{}", t.at("id"));
        for q in t.at("req").iter() {
            assert!(tech.has(&q), "{} : prérequis {q}", t.at("id"));
        }
    }
    fn depth(tech: &Val, tid: &Val, seen: &mut Vec<Val>) -> i64 {
        assert!(!seen.contains(tid), "cycle : {seen:?}");
        seen.push(tid.clone());
        let d = 1 + tech.at(tid).at("req").iter().map(|q| depth(tech, &q, seen)).max().unwrap_or(0);
        seen.pop();
        d
    }
    for tid in tech.keys() {
        depth(&tech, &tid, &mut Vec::new());
    }
}

#[test]
fn recherche_libre_seuls_les_prerequis_comptent() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let p = g.player.clone();
    let f = g.factions.at(&p);
    f.at("res").set("livres", 1e5);
    assert!(!g.research(&p, &Val::from("lebel")).0, "sans le fusil Gras ni la dynamite");
    f.at("techs").extend(&list!["gras", "dynamite"]);
    assert!(g.research(&p, &Val::from("lebel")).0, "en 1700 si les prérequis y sont (SPEC-ARBRE.md)");
}

#[test]
fn prerequis_ajoutes_jamais_plus_recents() {
    for (t, qs) in R::REQ_PLUS().items() {
        for q in qs.iter() {
            assert!(R::TECH().at(&t).at("req").has(&q));
            assert!(R::TECH_YEAR().at(&q) <= R::TECH_YEAR().at(&t), "{t} ← {q}");
        }
    }
}

#[test]
fn chaque_branche_dure_190_ans() {
    for b in R::BRANCHES().iter() {
        let jours = py::sum(R::TECH().values().iter().filter(|t| t.at("branch") == b).map(|t| t.atf("days")));
        proche(jours / 360.0, R::BRANCH_YEARS as f64, 1.5); // (arrondis au tour)
    }
    assert!(R::TECH().at("baionnette").at("days") < R::TECH().at("lebel").at("days"), "plus loin dans l’arbre, plus long");
}

#[test]
fn departs_avec_les_prerequis_de_leurs_technologies() {
    for ep in ["1790", "1813", "1870"] {
        let g = partie_avec("33", ep, 1, "normal");
        for (c, f) in g.factions.items() {
            for t in f.at("techs").iter() {
                for q in R::TECH().at(&t).at("req").iter() {
                    assert!(f.at("techs").has(&q), "{ep} {c} : {t} sans {q}");
                }
            }
        }
    }
}

#[test]
fn branche_civil_et_sociale() {
    assert!(R::BRANCHES().has("civil"), "l'identifiant reste « civil » (sauvegardes, goûts des IA)");
    assert_eq!(R::TECH().at("suffrage").at("branch"), "civil");
}

#[test]
fn deux_branches_militaires_en_parallele() {
    let mut g = partie();
    let p = g.player.clone();
    let f = g.factions.at(&p);
    f.at("res").set("livres", 1e5);
    f.set("techs", f.at("techs").iter().filter(|t| !(*t == "baionnette" || *t == "vauban")).collect::<Val>());
    assert_eq!((R::TECH().at("baionnette").at("branch"), R::TECH().at("vauban").at("branch")), (Val::from("infanterie"), Val::from("artillerie")));
    assert!(g.research(&p, &Val::from("baionnette")).0);
    assert!(g.research(&p, &Val::from("vauban")).0, "artillerie et infanterie se cherchent en même temps");
}

#[test]
fn sauvegarde_d_une_recherche_militaire() {
    let mut g = partie();
    let p = g.player.clone();
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    for f in d.at("factions").values() {
        f.set("research", dict! {"militaire" => Val::None, "civil" => Val::None, "industriel" => Val::None, "agricole" => Val::None});
    }
    d.at("factions").at(&p).at("research").set("militaire", dict! {"tech" => "valliere", "left" => 12.0, "total" => 30});
    let g2 = V::from_dict(GEO(), &d).unwrap();
    let r = g2.factions.at(&p).at("research");
    let cles: BTreeSet<String> = r.keys().iter().map(|k| k.string()).collect();
    assert_eq!(cles, R::BRANCHES().iter().map(|b| b.string()).collect::<BTreeSet<_>>());
    assert_eq!(r.at("artillerie").at("tech"), "valliere");
    assert!(r.at("infanterie").is_none());
}

/// Les textes entre guillemets droits d'une ligne (`re.findall(r"'([a-z_]+)'", line)`, guillemets du Rust).
fn cles_entre_guillemets(ligne: &str) -> Vec<String> {
    let b = ligne.as_bytes();
    let (mut out, mut i) = (Vec::new(), 0);
    while i < b.len() {
        if b[i] == b'"' {
            let mut j = i + 1;
            while j < b.len() && (b[j].is_ascii_lowercase() || b[j] == b'_') {
                j += 1;
            }
            if j > i + 1 && j < b.len() && b[j] == b'"' {
                out.push(ligne[i + 1..j].to_string());
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// `re.search(r"\bmod\(|md\.get\(|mods'?\]?\.get\(|boost=|reg_mods\(|\brm\.get\(", line)`, ce qu'elle devient dans
/// le Rust : `mod_(`, `md.get(` / `md.get_or(`, `.at("mods").get(`, `boost`, `reg_mods(`, `rm.get(`.
fn lit_un_effet(ligne: &str) -> bool {
    let mot = |motif: &str| {
        ligne.match_indices(motif).any(|(i, _)| i == 0 || !ligne.as_bytes()[i - 1].is_ascii_alphanumeric() && ligne.as_bytes()[i - 1] != b'_')
    };
    mot("mod_(")
        || ["md.get(", "md.get_or(", "mods.get(", "mods.get_or(", "mods\").get(", "mods\").get_or(", "mods).get(", "mods).get_or(", "boost", "reg_mods("]
            .iter()
            .any(|m| ligne.contains(m))
        || mot("rm.get(")
        || mot("rm.get_or(")
        || mot("rmg(") // (update_battles : `rmg = |k| rm.get_or(k, 0.0)`)
}

fn sources(d: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(d).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            sources(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// (le Python lit game/*.py et game/tactics/*.py ; ici, le moteur Rust : rust/conquete/src)
#[test]
fn chaque_effet_est_lu_par_le_moteur() {
    let mut fichiers = Vec::new();
    sources(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut fichiers);
    let mut lus: BTreeSet<String> = BTreeSet::new();
    for f in fichiers {
        for ligne in std::fs::read_to_string(&f).unwrap().lines() {
            if lit_un_effet(ligne) {
                lus.extend(cles_entre_guillemets(ligne));
            }
        }
    }
    lus.extend(E::ATTENUE().values().iter().map(|v| v.string())); // (lus par events.soften et recompute_mods, par la table)
    lus.insert("rail_troops".into()); // (les armées prendront le train en phase 2, avec les voies ferrées de la carte)
    // le champ de bataille tactique lisait ces trois effets ; la bataille par stratégie ne les reprend pas encore
    // (SPEC-BATAILLE.md, « Suite ») : aérostiers (hors sa vision), retranchements de campagne, obus à la mélinite
    lus.extend(["balloon", "entrench", "shell"].map(String::from));
    let oublies: BTreeSet<String> =
        R::TECH().values().iter().flat_map(|t| t.at("fx").keys()).map(|k| k.string()).filter(|k| !lus.contains(k)).collect();
    assert!(oublies.is_empty(), "effets de technologies que le moteur ne lit nulle part : {oublies:?}");
}

/// Donne ces technologies au camp et recalcule ses effets.
fn avec(g: &mut Game, code: &str, techs: &[&str]) {
    let l = g.factions.at(code).at("techs");
    for t in techs {
        if !l.has(*t) {
            l.push(*t);
        }
    }
    g.recompute_mods(code);
}

/// `avec(partie(), code, *techs)` : la partie, rendue.
fn avec_g(mut g: Game, code: &str, techs: &[&str]) -> Game {
    avec(&mut g, code, techs);
    g
}

// ================================================================== EffetsEconomiques
// SPEC-TECH.md : caisse d'épargne, éclairage au gaz, ciment, bateau à vapeur, Fresnel.

#[test]
fn le_tresor_rapporte_deux_pour_cent_l_an() {
    let (mut a, mut b) = (partie_avec("33", "1790", 4, "normal"), avec_g(partie_avec("33", "1790", 4, "normal"), "33", &["caisse_epargne"]));
    for g in [&mut a, &mut b] {
        g.factions.at("33").at("res").set("livres", 12000.0);
        g.monthly(Date { year: 1790, month: 4, day: 1 });
    }
    presque(b.factions.at("33").at("res").atf("livres") - a.factions.at("33").at("res").atf("livres"), 20.0, 3);
}

#[test]
fn le_gaz_eclaire_les_villes_pas_les_villages() {
    let (mut a, mut b) = (partie(), avec_g(partie(), "33", &["gaz"]));
    let ville = a.nodes.iter().find(|n| n.at("owner") == "33" && a.geo.nodes.at(n.at("id")).at("type") == "capitale").unwrap();
    let village = a.nodes.iter().find(|n| a.geo.nodes.at(n.at("id")).at("type") == "village").unwrap();
    village.set("owner", "33");
    b.nodes.at(village.at("id")).set("owner", "33");
    let k = b.node_output(&b.nodes.at(ville.at("id")), "33").atf("livres") / a.node_output(&ville, "33").atf("livres");
    presque(k, 1.05, 6);
    assert_eq!(b.node_output(&b.nodes.at(village.at("id")), "33"), a.node_output(&village, "33"));
}

#[test]
fn le_ciment_construit_moins_cher_et_plus_vite() {
    let (mut a, mut b) = (partie(), avec_g(partie(), "33", &["ciment"]));
    let nid = a.nodes.iter().find(|n| n.at("owner") == "33" && a.geo.nodes.at(n.at("id")).at("type") == "capitale").unwrap().ati("id");
    let mut res = Vec::new();
    for g in [&mut a, &mut b] {
        g.factions.at("33").at("res").update(&dict! {"livres" => 5000, "bois" => 500, "fer" => 500, "outils" => 500});
        let avant = g.factions.at("33").at("res").copy();
        let (ok, why) = g.build("33", nid, &Val::from("dev"));
        assert!(ok, "{why}");
        res.push((avant.at("livres").py_sub(&g.factions.at("33").at("res").at("livres")).f(), g.nodes.at(nid).at("queue").at(-1).atf("total")));
    }
    assert_eq!(res[1].0, (res[0].0 * 0.85).ceil());
    presque(res[1].1, res[0].1 * 0.85, 7);
}

#[test]
fn le_vapeur_remonte_aussi_vite_qu_il_descend() {
    let g = avec_g(partie(), "33", &["vapeur_fluviale"]);
    let e = g.geo.edges.iter().find(|e| e.get("kind") == "water" && !e.at("sea").truthy() && e.at("down").is_some()).unwrap();
    let haut = if e.at("down") == e.at("b") { e.at("a") } else { e.at("b") }; // (on part de l'amont : on descend)
    let bas = e.at("down");
    let ws = |frm: &Val, code: &str| g.water_speed(&e, frm, &Val::None, &Val::None, true, &Val::from(code));
    presque(ws(&bas, "33"), ws(&haut, "33"), 7);
    assert!(ws(&bas, "24") < ws(&haut, "24"));
}

// ================================================================== EffetsSurLaSociete
// SPEC-TECH.md : vaccine, betterave, bouillie (et le mildiou), suffrage, mutuelles, syndicats.

fn pop(g: &Game, code: &str) -> f64 {
    py::sum(g.owned_nodes(code).iter().map(|n| n.get_or("pop", 0).f()))
}

#[test]
fn la_vaccine_divise_par_deux_le_cholera() {
    let (mut a, mut b) = (partie(), avec_g(partie(), "33", &["vaccine"]));
    let p0 = pop(&a, "33");
    for g in [&mut a, &mut b] {
        E::fire(g, "33", &E::HIST_BY_ID().at("cholera"), "hist");
    }
    presque((p0 - pop(&b, "33")) / (p0 - pop(&a, "33")), 0.5, 6);
}

#[test]
fn la_fievre_d_une_ville_aussi() {
    let (mut a, mut b) = (partie(), avec_g(partie(), "33", &["vaccine"]));
    let ev = CT::LOCAL().iter().find(|e| e.at("id") == "epidemie").unwrap();
    let nid = a.nodes.iter().find(|n| n.at("owner") == "33" && a.geo.nodes.at(n.at("id")).at("type") == "capitale").unwrap().ati("id");
    let p0 = a.nodes.at(nid).atf("pop");
    for g in [&mut a, &mut b] {
        let n = g.nodes.at(nid);
        CT::fire(g, "33", &n, &ev);
    }
    presque((p0 - b.nodes.at(nid).atf("pop")) / (p0 - a.nodes.at(nid).atf("pop")), 0.5, 6);
}

#[test]
fn la_betterave_trouvee_apres_le_blocus_le_leve() {
    let mut g = partie();
    let sans = g.mod_("33", "port", 0.0);
    E::fire(&mut g, "33", &E::HIST_BY_ID().at("blocus"), "hist");
    g.recompute_mods("33");
    presque(g.mod_("33", "port", 0.0), sans - 0.4, 7);
    avec(&mut g, "33", &["betterave"]);
    presque(g.mod_("33", "port", 0.0), sans, 7); // le blocus ne coûte plus rien aux ports
    assert!(!V::_effects(&g, &g.factions.at("33")).iter().any(|x| x.has("ort")), "le panneau ne le montre plus");
}

#[test]
fn un_ancien_effet_sans_etiquette_reste_entier() {
    let mut g = partie();
    let sans = g.mod_("33", "port", 0.0);
    g.factions.at("33").setdefault("tmods", list![]).push(dict! {"k" => "port", "v" => -0.4, "until" => g.t + 999.0});
    avec(&mut g, "33", &["betterave"]);
    presque(g.mod_("33", "port", 0.0), sans - 0.4, 7);
}

#[test]
fn le_mildiou_frappe_les_vignes_et_la_bouillie_l_attenue() {
    let mut g = partie();
    let sans = g.mod_("33", "vin", 0.0);
    E::fire(&mut g, "33", &E::HIST_BY_ID().at("mildiou"), "hist");
    g.recompute_mods("33");
    assert!(g.mod_("33", "vin", 0.0) < sans);
    let coup = sans - g.mod_("33", "vin", 0.0);
    avec(&mut g, "33", &["bouillie"]);
    presque(sans + 0.15 - g.mod_("33", "vin", 0.0), coup / 2.0, 7);
}

#[test]
fn le_suffrage_ralentit_la_lassitude() {
    let mut res = Vec::new();
    for techs in [&[][..], &["suffrage"][..]] {
        let mut g = avec_g(partie_avec("33", "1790", 2, "normal"), "33", techs);
        D::declare_war(&mut g, "33", "24", false);
        let avant = g.factions.at("33").get_or("weary", 0.0).f();
        g.monthly(Date { year: 1790, month: 4, day: 1 });
        res.push(g.factions.at("33").atf("weary") - avant);
    }
    assert!(res[0] > 0.0);
    presque(res[1], res[0] * 0.75, 7);
}

#[test]
fn les_mutuelles_calment_les_revoltes() {
    let mut revoltes: Vec<BTreeSet<i64>> = Vec::new();
    for techs in [&[][..], &["mutuelles"][..]] {
        let mut g = avec_g(partie_avec("33", "1790", 6, "normal"), "24", techs);
        let places: Vec<Val> = g.nodes.iter().filter(|n| n.at("owner") == "24" && g.geo.nodes.at(n.at("id")).at("type") != "capitale").collect();
        for n in &places {
            n.set("stab", 0.05);
            n.set("garrison", vide());
        }
        for a in g.armies.values().iter().filter(|a| a.at("owner") == "24") {
            a.set("at_node", Val::None);
        }
        g.monthly(Date { year: 1790, month: 4, day: 1 });
        revoltes.push(places.iter().filter(|n| n.at("owner") != "24").map(|n| n.ati("id")).collect());
    }
    assert!(revoltes[1].is_subset(&revoltes[0]));
    assert!(revoltes[1].len() < revoltes[0].len());
}

#[test]
fn greve_dans_une_ville_a_l_ordre_bas() {
    let mut g = avec_g(partie(), "33", &["syndicats"]);
    let villes: Vec<Val> =
        g.nodes.iter().filter(|n| n.at("owner") == "33" && ["ville", "capitale"].contains(&g.geo.nodes.at(n.at("id")).at("type").s())).collect();
    let (basse, haute) = (villes[0].clone(), villes.get(1).cloned());
    basse.set("stab", 0.3);
    if let Some(h) = &haute {
        h.set("stab", 0.9);
    }
    g.monthly(Date { year: 1791, month: 1, day: 1 });
    assert!(basse.get_or("tm", list![]).iter().any(|t| t.at("k") == "industrie" && t.at("v") <= -1i64));
    if let Some(h) = &haute {
        assert!(!h.get_or("tm", list![]).iter().any(|t| t.at("k") == "industrie"));
    }
}

// ================================================================== Renseignement
// SPEC-TECH.md : photographie, téléphone.

fn ennemi_en_vue(g: &Game) -> Val {
    let a = armee_de(g, "24");
    let cap = g.geo.nodes.at(g.capital_of("33"));
    a.set("x", cap.atf("x") + 3.0);
    a.set("y", cap.atf("y") + 3.0);
    a
}

fn regs_vus(g: &mut Game, a: &Val) -> Val {
    vue_armee(g, &a.at("id")).at("regs")
}

#[test]
fn la_photographie_montre_l_experience_et_l_arme() {
    let mut g = partie();
    let a = ennemi_en_vue(&g);
    a.at("regs").at(0).set("xp", 40);
    let sans = regs_vus(&mut g, &a).at(0);
    assert_eq!(sans.at(4), 0);
    assert_eq!(sans.len(), 6, "sans photographie : ni l'expérience, ni l'arme");
    avec(&mut g, "33", &["photographie"]);
    let vu = regs_vus(&mut g, &a).at(0);
    assert_eq!(vu.at(4), 40);
    assert_eq!(vu.at(6), a.at("regs").at(0).get("arm"));
    assert_eq!(vu.at(5), 0, "le moral reste caché");
}

#[test]
fn le_telephone_annonce_l_armee_qui_arrive() {
    let mut res = Vec::new();
    for techs in [&[][..], &["telephone"][..]] {
        let mut g = avec_g(partie(), "33", techs);
        D::declare_war(&mut g, "24", "33", false);
        let a = armee_de(&g, "24");
        let cap = g.geo.nodes.at(g.capital_of("33"));
        let (cx, cy) = (cap.atf("x"), cap.atf("y"));
        let dehors = py::min_by_key(g.geo.nodes.iter().filter(|n| g.nodes.at(n.at("id")).at("owner") != "33").collect::<Vec<_>>(), |n| {
            (py::hypot(n.atf("x") - cx, n.atf("y") - cy) - 30.0).abs() // (à 30 km)
        })
        .unwrap();
        a.set("x", dehors.at("x"));
        a.set("y", dehors.at("y"));
        a.set("at_node", dehors.at("id"));
        let cap = g.capital_of("33").i();
        let (ok, why) = vers_place(&mut g, "24", &a, cap);
        assert_eq!(ok, Some(true), "{why}");
        assert!(TT::eta(&g, &a, &Val::None).expect("eta") <= 1);
        res.push(TT::incoming(&g, "33").iter().map(|x| x.at("id")).collect::<Vec<_>>());
    }
    assert!(res[0].is_empty(), "sans téléphone, rien");
    assert!(res[1].contains(&armee_de(&partie(), "24").at("id")));
}

// ================================================================== ApresLaBataille
// SPEC-TECH.md : Croix-Rouge (blessés qui reviennent), dynamite (une brèche de plus à l'assaut).

/// `combat(*techs, emods=None)`
fn combat(techs: &[&str], emods: Val) -> (Game, Val, f64) {
    let mut g = partie_avec("33", "1790", 3, "normal");
    g.factions.at("33").set("emods", if emods.truthy() { emods.copy() } else { dict! {} });
    avec(&mut g, "33", techs);
    D::declare_war(&mut g, "33", "24", false);
    let (a, e) = (armee_de(&g, "33"), armee_de(&g, "24"));
    e.set("x", a.atf("x") + 0.5);
    e.set("y", a.at("y"));
    e.set("at_node", Val::None);
    e.set("path", vide());
    e.set("state", "idle");
    a.set("tac_auto", true);
    g.start_battle(&list![&e], &list![&a], (a.atf("x") + e.atf("x")) / 2.0, a.atf("y"), &Val::None, false, false);
    let bt = g.battles.values().remove(0);
    bt.set("mode", "auto");
    g.resolve_battle_now(&bt);
    if bt.get("mode") == "poursuite" {
        // (le joueur vainqueur a de la cavalerie : la bataille attend son choix ; il tient le terrain)
        assert!(TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => false}).atb("ok"));
    }
    let n = py::sum(a.at("regs").iter().map(|r| r.atf("n")));
    (g, a, n)
}

#[test]
fn la_croix_rouge_rend_un_quart_des_blesses() {
    let (_g0, _a0, sans) = combat(&[], dict! {"casualties" => -0.05}); // (les mêmes pertes, sans les blessés qui reviennent)
    let (_g1, a1, avec_cr) = combat(&["croix_rouge"], Val::None);
    assert!(avec_cr > sans, "les blessés soignés reviennent aux régiments : {avec_cr} / {sans}");
    for r in a1.at("regs").iter() {
        assert!(r.at("n") <= r.at("max"));
        assert!(!r.has("wnd"));
    }
}

#[test]
fn les_blesses_d_une_garnison_lui_reviennent() {
    let mut g = avec_g(partie_avec("33", "1790", 3, "normal"), "33", &["croix_rouge"]);
    D::declare_war(&mut g, "33", "24", false);
    let cap = g.capital_of("33").i();
    let gar = list![g.new_reg("ligne", &Val::None, &Val::from("33")), g.new_reg("ligne", &Val::None, &Val::from("33"))];
    g.nodes.at(cap).set("garrison", gar);
    let e = armee_de(&g, "24");
    let (cx, cy) = g.node_xy(cap);
    e.set("x", cx);
    e.set("y", cy);
    e.set("at_node", Val::None);
    e.set("path", vide());
    e.set("state", "idle");
    for a in g.armies.values().iter().filter(|a| a.at("owner") == "33") {
        a.set("x", a.atf("x") + 200.0); // (la garnison seule)
        a.set("at_node", Val::None);
    }
    g.start_battle(&list![&e], &vide(), cx, cy, &Val::from(cap), false, false);
    let bt = g.battles.values().remove(0);
    bt.set("mode", "auto");
    g.resolve_battle_now(&bt);
    for n in g.nodes.iter() {
        for r in n.at("garrison").iter() {
            assert!(!r.has("wnd"), "les blessés soignés sont rendus à la fin de la bataille");
        }
    }
}

#[test]
fn une_mitrailleuse_n_attire_pas_l_ia_au_reamement() {
    let mut g = avec_g(partie_avec("33", "1870", 1, "normal"), "33", &["mitrailleuse", "debange"]);
    let r = g.new_reg("mitrailleuses", &Val::None, &Val::from("33"));
    r.set("arm", 0);
    assert_eq!(AI::new(&g, "33").arm_gap(&g, &list![r]), (0, 0.0));
}

#[test]
fn la_dynamite_ouvre_une_breche_de_plus() {
    let g = avec_g(partie(), "24", &["dynamite"]);
    let n = g.nodes.at(g.capital_of("33"));
    presque(AA::fort_eff(&g, &n, &Val::from("24")), AA::fort_eff(&g, &n, &Val::None) * (1.0 - AA::BREACH_STEP), 7);
    assert_eq!(AA::fort_eff(&g, &n, &Val::from("47")), AA::fort_eff(&g, &n, &Val::None), "sans dynamite, rien ne change");
}

// ================================================================== Mitrailleuses
// SPEC-TECH.md : la batterie de mitrailleuses, levée avec la technologie, de la classe de l'artillerie.

fn ville(g: &Game, code: &str) -> i64 {
    g.nodes.iter().find(|n| n.at("owner") == code && g.geo.nodes.at(n.at("id")).at("type") == "capitale").unwrap().ati("id")
}

#[test]
fn levee_avec_la_technologie_seulement() {
    let mut g = partie_avec("33", "1870", 1, "normal");
    let techs = g.factions.at("33").at("techs");
    if techs.has("mitrailleuse") {
        techs.remove(&Val::from("mitrailleuse"));
    }
    let m = Val::from("mitrailleuses");
    let (ok, why) = g.can_recruit("33", ville(&g, "33"), &m);
    assert!(!ok);
    assert!(why.contains("Mitrailleuse"));
    avec(&mut g, "33", &["mitrailleuse"]);
    assert!(g.can_recruit("33", ville(&g, "33"), &m).0);
    assert_eq!(R::UNITS().at("mitrailleuses").at("cls"), "artillerie");
}

#[test]
fn pas_de_reamement_pour_une_mitrailleuse() {
    let mut g = avec_g(partie_avec("33", "1870", 1, "normal"), "33", &["mitrailleuse", "debange"]);
    let r = g.new_reg("mitrailleuses", &Val::None, &Val::from("33"));
    r.set("arm", 0);
    assert_eq!(g.modernize_cost("33", &list![r]), dict! {}, "la pièce de Reffye ne se réarme pas en canons");
}

#[test]
fn une_armee_de_mitrailleuses_se_sauvegarde() {
    let mut g = avec_g(partie_avec("33", "1870", 1, "normal"), "33", &["mitrailleuse"]);
    let a = armee(&g);
    let r = g.new_reg("mitrailleuses", &Val::None, &Val::from("33"));
    a.at("regs").push(r);
    let mut g2 = sauver_relire(&mut g);
    assert!(g2.armies.at(a.at("id")).at("regs").iter().any(|r| r.at("type") == "mitrailleuses"));
    jouer_mois(&mut g2, 1);
}

#[test]
fn les_mitrailleuses_n_ouvrent_pas_de_breche() {
    let mut g = partie_avec("33", "1870", 1, "normal");
    let a = armee(&g);
    let n = g.nodes.at(g.capital_of("24"));
    n.set("siege", dict! {"by" => "33", "dmg" => 0.0});
    a.set("regs", list![g.new_reg("ligne", &Val::None, &Val::from("33"))]);
    let sans = g.siege_rate(&n, &list![&a]);
    for _ in 0..3 {
        let r = g.new_reg("mitrailleuses", &Val::None, &Val::from("33"));
        a.at("regs").push(r);
    }
    assert_eq!(g.siege_rate(&n, &list![&a]), sans, "les sièges ne comptent que les canons");
}

// ================================================================== VoiesFerrees
// SPEC-TECH.md, phase 2a : les lignes historiques, leurs tronçons, leurs chantiers, le train.

/// Une partie de 1870 sans ses voies ferrées d'origine : pour suivre un chantier depuis le début.
fn sans_rails(mut g: Game) -> Game {
    g.rails.clear();
    g.compute_income();
    g
}

#[test]
fn les_troncons_des_lignes_historiques() {
    let geo = GEO();
    let secs = RL::sections(&geo);
    assert!(secs.len() >= 50);
    let mut paires = HashSet::new();
    for s in secs.values() {
        assert!(s.at("edges").truthy(), "{} : une route entre les deux villes", s.at("line"));
        assert!(s.at("km") > 3i64);
        let (a, b) = (geo.nodes.at(s.at("a")), geo.nodes.at(s.at("b")));
        assert!(["capitale", "ville", "fort"].contains(&a.at("type").s()));
        assert!(["capitale", "ville", "fort"].contains(&b.at("type").s()));
        let (x, y) = (s.ati("a"), s.ati("b"));
        let p = (x.min(y), x.max(y));
        assert!(!paires.contains(&p), "{}–{} en double", a.at("name"), b.at("name"));
        paires.insert(p);
        // la route va bien de a à b, arête après arête
        let mut n = s.at("a");
        for eid in s.at("edges").iter() {
            let e = geo.edges.at(&eid);
            assert!(e.get("kind") != "water");
            n = if e.at("a") == n { e.at("b") } else { e.at("a") };
        }
        assert_eq!(n, s.at("b"));
    }
    let byname: HashSet<(String, String)> = secs.values().iter().map(|x| (geo.nodes.at(x.at("a")).ats("name"), geo.nodes.at(x.at("b")).ats("name"))).collect();
    assert!(byname.contains(&("Bordeaux".to_string(), "La Teste-de-Buch".to_string())));
    assert!(
        RL::exits().iter().all(|tx| {
            let t = geo.by_name.at(tx.at(0));
            secs.values().iter().any(|x| x.at("a") == t || x.at("b") == t)
        }),
        "chaque sortie vers le bord part d’une ville desservie"
    );
}

/// `VoiesFerrees.troncon(g, a, b)`
fn troncon(a: &str, b: &str) -> String {
    let (ia, ib) = (par_nom(a), par_nom(b));
    RL::sections(&GEO()).at(format!("{}-{}", ia.min(ib), ia.max(ib))).ats("id")
}

#[test]
fn un_chantier_s_ouvre_depuis_le_chef_lieu() {
    let mut g = sans_rails(partie_avec("33", "1870", 1, "normal"));
    let f = g.factions.at("33");
    f.set("techs", f.at("techs").iter().filter(|t| *t != "chemins_fer").collect::<Val>());
    let lt = troncon("Bordeaux", "La Teste-de-Buch");
    g.nodes.at(par_nom("La Teste-de-Buch")).set("owner", "33");
    assert!(!RL::openable(&g, "33", &lt).0, "sans la technologie");
    avec(&mut g, "33", &["chemins_fer"]);
    let (ok, why) = RL::openable(&g, "33", &lt);
    assert!(ok, "{why}");
    let loin = troncon("Libourne", "Coutras");
    for t in ["Libourne", "Coutras"] {
        g.nodes.at(par_nom(t)).set("owner", "33");
    }
    assert!(!RL::openable(&g, "33", &loin).0, "pas relié au chef-lieu ni au réseau");
    f.at("res").update(&dict! {"livres" => 99999, "fer" => 9999, "bois" => 9999});
    let avant = f.at("res").copy();
    let (ok, why) = RL::start(&mut g, "33", &lt);
    assert!(ok, "{why}");
    let km = RL::sections(&GEO()).at(lt.as_str()).atf("km");
    let attendu = (km * R::RAIL_KM_COST().atf("livres") * (1.0 + g.mod_("33", "build_cost", 0.0))).ceil();
    assert_eq!(avant.at("livres").py_sub(&f.at("res").at("livres")), attendu);
    assert!(!RL::start(&mut g, "33", &lt).0, "un seul chantier par tronçon");
}

#[test]
fn le_chantier_avance_plus_vite_avec_l_industrie_puis_s_acheve() {
    let mut res = Vec::new();
    let mut dernier = None;
    let lt = troncon("Bordeaux", "La Teste-de-Buch");
    for ind in [5.0, 80.0] {
        let mut g = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
        g.nodes.at(par_nom("La Teste-de-Buch")).set("owner", "33");
        g.factions.at("33").at("res").update(&dict! {"livres" => 99999, "fer" => 9999, "bois" => 9999});
        RL::start(&mut g, "33", &lt);
        g.factions.at("33").at("income").set("industrie", ind);
        let left0 = g.rails.at(lt.as_str()).atf("left");
        RL::tick(&mut g, 30.0);
        res.push(left0 - g.rails.at(lt.as_str()).atf("left"));
        dernier = Some(g);
    }
    assert!(res[1] > res[0]);
    let mut g = dernier.unwrap();
    g.rails.at(lt.as_str()).set("left", 0.5);
    RL::tick(&mut g, 30.0);
    assert!(g.rails.at(lt.as_str()).at("done").truthy());
    assert!(!g.rails.at(lt.as_str()).has("left"));
}

#[test]
fn une_ligne_ouverte_dope_ses_villes_et_ravitaille() {
    let mut a = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
    let mut b = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
    let lt = troncon("Bordeaux", "La Teste-de-Buch");
    b.rails.set(lt.as_str(), dict! {"done" => true, "cut" => Val::None});
    let bx = par_nom("Bordeaux");
    let (oa, ob) = (a.node_output(&a.nodes.at(bx), "33"), b.node_output(&b.nodes.at(bx), "33"));
    presque(ob.atf("industrie") / oa.atf("industrie"), 1.0 + R::RAIL_TOWN_BONUS, 7);
    presque(ob.atf("livres") / oa.atf("livres"), 1.0 + R::RAIL_TOWN_BONUS, 7);
    let gn = GEO().nodes.at(bx);
    let (x, y) = (gn.atf("x") + 10.0, gn.atf("y"));
    assert!(RL::near_station(&b, "33", x, y));
    assert!(!RL::near_station(&a, "33", x, y), "sans ligne, pas de gare");
    assert!(!RL::near_station(&b, "24", x, y), "la gare d’un ennemi ne sert pas");
    b.rails.at(lt.as_str()).set("cut", b.t + 99.0);
    assert!(!RL::near_station(&b, "33", x, y), "ligne coupée");
}

#[test]
fn les_chemins_de_fer_ne_pressent_plus_toutes_les_routes() {
    assert_eq!(R::TECH().at("chemins_fer").at("fx"), dict! {});
    let g = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
    let somme = py::sum_v(g.factions.at("33").at("techs").iter().map(|t| R::TECH().at(&t).at("fx").get_or("road_speed", 0)));
    assert_eq!(Val::from(g.mod_("33", "road_speed", 0.0)), somme);
}

/// Une partie où Bordeaux–Langon–La Réole est ouverte et à soi, et une armée à Bordeaux.
/// (`ligne_ouverte(*techs, owner_b='33')`)
fn ligne_ouverte(techs: &[&str], owner_b: &str) -> (Game, Val) {
    let mut g = sans_rails(partie_avec("33", "1870", 1, "normal"));
    let f = g.factions.at("33");
    f.set("techs", f.at("techs").iter().filter(|t| *t != "rail_militaire").collect::<Val>()); // (déjà là en 1870)
    let mut tt = vec!["chemins_fer"];
    tt.extend_from_slice(techs);
    avec(&mut g, "33", &tt);
    let geo = GEO();
    for (x, y) in [("Bordeaux", "Langon"), ("Langon", "La Réole"), ("La Réole", "Marmande"), ("Marmande", "Tonneins"), ("Tonneins", "Aiguillon"), ("Aiguillon", "Agen")] {
        let sid = troncon(x, y);
        g.rails.set(sid.as_str(), dict! {"done" => true, "cut" => Val::None});
        for eid in RL::sections(&geo).at(sid.as_str()).at("edges").iter() {
            // (les villages traversés aussi : pas de halte en route)
            for n in [geo.edges.at(&eid).at("a"), geo.edges.at(&eid).at("b")] {
                g.nodes.at(&n).set("owner", "33");
            }
        }
    }
    g.nodes.at(par_nom("La Réole")).set("owner", owner_b);
    let a = armee(&g);
    let bx = par_nom("Bordeaux");
    let (x, y) = g.node_xy(bx);
    a.update(&dict! {"x" => x, "y" => y, "at_node" => bx, "edge" => Val::None, "path" => vide(), "state" => "idle"});
    (g, a)
}

/// `VoiesFerrees.duree(g, a, cible='Agen')`
fn duree(g: &mut Game, a: &Val, cible: &str) -> f64 {
    let (ok, why) = vers_place(g, &a.ats("owner"), a, par_nom(cible));
    assert_eq!(ok, Some(true), "{why}");
    let mut t = 0.0;
    while a.at("path").truthy() && t < 60.0 {
        g.move_army(a, 0.05);
        t += 0.05;
    }
    assert_eq!(a.at("at_node"), par_nom(cible));
    t
}

fn en_train(a: &Val) -> bool {
    a.at("path").iter().any(|l| l.get("rail").truthy())
}

#[test]
fn le_train_va_plus_vite_que_la_marche() {
    let (mut g, a) = ligne_ouverte(&[], "33");
    let a_pied = duree(&mut g, &a, "Agen");
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    vers_place(&mut g, "33", &a, par_nom("Agen"));
    assert!(en_train(&a), "le trajet prend le train");
    let eta = TT::eta(&g, &a, &Val::None);
    let moral: Vec<Val> = a.at("regs").iter().map(|r| r.at("morale")).collect();
    let train = duree(&mut g, &a, "Agen");
    assert!(train < a_pied * 0.6, "{train:.2} j en train, {a_pied:.2} j à pied");
    assert!(train > R::RAIL_EMBARK, "une journée pour embarquer");
    assert!(!a.get("rail").truthy());
    assert_eq!(
        a.at("regs").iter().map(|r| r.at("morale")).collect::<Vec<_>>(),
        moral.iter().map(|m| m.py_sub(&Val::from(5))).collect::<Vec<_>>(),
        "un peu désorganisée à la descente"
    );
    assert!(eta.is_some());
}

#[test]
fn pas_de_train_sur_la_ligne_d_un_ennemi() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "24");
    g.set_status("33", "24", "paix");
    vers_place(&mut g, "33", &a, par_nom("Langon"));
    assert!(en_train(&a), "Bordeaux–Langon est à nous");
    vers_place(&mut g, "33", &a, par_nom("La Réole"));
    let lr = par_nom("La Réole");
    assert!(!a.at("path").iter().any(|l| l.get("rail").truthy() && l.at("to") == lr), "Langon–La Réole : La Réole est au Périgord");
}

#[test]
fn une_ligne_perdue_en_route_fait_descendre() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    vers_place(&mut g, "33", &a, par_nom("Agen"));
    g.move_army(&a, R::RAIL_EMBARK + 0.02);
    assert!(a.get("rail").truthy());
    g.nodes.at(par_nom("Marmande")).set("owner", "24");
    let mut t = 0.0;
    while a.at("path").truthy() && t < 30.0 {
        g.move_army(&a, 0.05);
        t += 0.05;
    }
    assert!(!a.get("rail").truthy(), "à pied jusqu’au bout");
}

#[test]
fn une_armee_ennemie_coupe_la_ligne_trois_tours() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    let geo = GEO();
    let sid = troncon("Bordeaux", "Langon");
    let aretes = RL::sections(&geo).at(sid.as_str()).at("edges");
    let village = aretes
        .iter()
        .flat_map(|eid| [geo.edges.at(&eid).at("a"), geo.edges.at(&eid).at("b")])
        .find(|n| geo.nodes.at(n).at("type") == "village")
        .unwrap();
    let e = armee_de(&g, "24");
    let (x, y) = g.node_xy(village.i());
    e.update(&dict! {"x" => x, "y" => y, "at_node" => &village, "edge" => Val::None, "path" => vide(), "state" => "idle"});
    g.monthly(Date { year: 1870, month: 9, day: 1 });
    assert!(RL::usable(&g, "33", &sid), "en paix, on ne coupe rien");
    D::declare_war(&mut g, "24", "33", false);
    g.monthly(Date { year: 1870, month: 10, day: 1 });
    assert!(!RL::usable(&g, "33", &sid), "coupée");
    vers_place(&mut g, "33", &a, par_nom("Agen"));
    assert!(!a.at("path").iter().any(|l| l.get("rail").truthy() && aretes.has(l.at("e"))));
    g.t = g.rails.at(sid.as_str()).atf("cut") + 0.1;
    assert!(RL::usable(&g, "33", &sid), "réparée au bout de trois tours");
}

#[test]
fn on_ne_coupe_pas_sa_propre_ligne() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    let sid = troncon("Bordeaux", "Langon");
    let n = RL::sections(&GEO()).at(sid.as_str()).ati("b");
    let (x, y) = g.node_xy(n);
    a.update(&dict! {"x" => x, "y" => y, "at_node" => n});
    g.monthly(Date { year: 1870, month: 10, day: 1 });
    assert!(RL::usable(&g, "33", &sid));
}

#[test]
fn une_ia_lance_un_troncon() {
    let mut g = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "24", &["chemins_fer"]);
    let ai = g.ais["24"].take().unwrap();
    for o in g.factions.keys() {
        if o != "24" && g.at_war("24", o.s()) {
            g.set_status("24", o.s(), "paix");
        }
    }
    g.factions.at("24").at("res").update(&dict! {"livres" => 20000, "fer" => 3000, "bois" => 3000});
    if !RL::sections(&GEO()).keys().iter().any(|sid| RL::openable(&g, "24", sid.s()).0) {
        eprintln!("pas de tronçon ouvrable pour le Périgord à cette date (skipTest)");
        return;
    }
    ai.build_rails(&mut g, 15000.0, &vide());
    assert_eq!(RL::works(&g, "24").len(), 1);
}

#[test]
fn un_trajet_annule_fait_descendre_du_train() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    vers_place(&mut g, "33", &a, par_nom("Agen"));
    g.move_army(&a, R::RAIL_EMBARK + 0.3);
    assert!(a.get("rail").truthy());
    a.set("path", vide()); // (comme une bataille, la diplomatie ou une IA qui annule l'ordre)
    a.set("state", "idle");
    g.move_army(&a, 0.1);
    assert!(!a.get("rail").truthy(), "à l’arrêt, plus dans le train");
    vers_place(&mut g, "33", &a, par_nom("Agen"));
    g.move_army(&a, 0.5);
    assert!(a.get_or("emb", 0) > 0i64, "il faut réembarquer");
}

#[test]
fn un_chantier_abandonne_libere_le_troncon() {
    let mut g = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
    avec(&mut g, "40", &["chemins_fer"]);
    let lt = troncon("Bordeaux", "La Teste-de-Buch");
    g.nodes.at(par_nom("La Teste-de-Buch")).set("owner", "33");
    g.factions.at("33").at("res").update(&dict! {"livres" => 99999, "fer" => 9999, "bois" => 9999});
    RL::start(&mut g, "33", &lt);
    for t in ["Bordeaux", "La Teste-de-Buch"] {
        g.nodes.at(par_nom(t)).set("owner", "40");
    }
    RL::tick(&mut g, 1.0);
    assert!(!g.rails.has(lt.as_str()), "les deux villes prises : le chantier est abandonné");
    assert_eq!(RL::works(&g, "33"), vide());
}

#[test]
fn une_armee_chez_elle_ne_coupe_pas_sa_ligne() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "24");
    D::declare_war(&mut g, "24", "33", false);
    let sid = troncon("Langon", "La Réole");
    let n = par_nom("Langon");
    let (x, y) = g.node_xy(n);
    a.update(&dict! {"x" => x, "y" => y, "at_node" => n});
    g.monthly(Date { year: 1870, month: 10, day: 1 });
    assert!(!g.rails.at(sid.as_str()).get("cut").truthy(), "dans sa propre ville, on ne coupe pas la voie");
}

#[test]
fn de_la_gabare_au_train_les_deux_attentes() {
    let (mut g, a) = ligne_ouverte(&["rail_militaire"], "33");
    a.set("boat", true);
    a.set("emb", 0.0);
    g.rail_switch(&a, true);
    presque(a.atf("emb"), R::RAIL_EMBARK, 7);
    a.set("emb", R::DISEMBARK_DAYS);
    g.rail_switch(&a, true);
    presque(a.atf("emb"), R::DISEMBARK_DAYS + R::RAIL_EMBARK, 7); // débarquer, puis embarquer
}

#[test]
fn un_chantier_se_sauvegarde() {
    let mut g = avec_g(sans_rails(partie_avec("33", "1870", 1, "normal")), "33", &["chemins_fer"]);
    g.nodes.at(par_nom("La Teste-de-Buch")).set("owner", "33");
    g.factions.at("33").at("res").update(&dict! {"livres" => 99999, "fer" => 9999, "bois" => 9999});
    let lt = troncon("Bordeaux", "La Teste-de-Buch");
    RL::start(&mut g, "33", &lt);
    let g2 = sauver_relire(&mut g);
    assert_eq!(g2.rails, g.rails);
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    d.del("rails");
    assert_eq!(V::from_dict(GEO(), &d).unwrap().rails, dict! {});
}

// ================================================================== DepartSelonLEpoque
// Une partie qui commence tard (1813, 1870) part avec les techniques de son époque et, en 1870, les voies ferrées
// déjà ouvertes : sans quoi la carte de 1870 n'aurait pas un rail.

#[test]
fn voies_ferrees_et_techniques_du_depart() {
    for ep in ["1700", "1790", "1813"] {
        assert_eq!(partie_avec("33", ep, 1, "normal").rails, dict! {}, "{ep}");
    }
    let g = partie_avec("33", "1870", 1, "normal");
    let secs = RL::sections(&GEO());
    let opened: BTreeSet<String> = g.rails.items().into_iter().filter(|(_, st)| st.at("done").truthy()).map(|(s, _)| s.string()).collect();
    let attendu: BTreeSet<String> =
        secs.items().into_iter().filter(|(_, s)| s.at("year") > 0i64 && s.at("year") < 1870i64).map(|(s, _)| s.string()).collect();
    assert_eq!(opened, attendu);
    assert!(g.factions.at("33").at("techs").has("chemins_fer"));
    assert!(R::marks(&g.factions.at("24").at("techs")).has("telegraphe"));
    assert_eq!(V::rules_payload().at("scenarios").at("1870").at("techs_before"), 1866);
}

// ================================================================== Decouvertes
// La fenêtre et la frise des découvertes (SPEC-SUITE I) : chaque découverte est datée, celles du joueur portent
// leur technologie, les découvertes marquantes des IA sont annoncées.

#[test]
fn decouvertes_datees_et_annoncees() {
    let mut g = partie_avec("33", "1790", 1, "normal");
    let (me, ia) = (g.factions.at("33"), g.factions.at("24"));
    for (f, tech) in [(&me, "assolement"), (&ia, "pins")] {
        f.set("techs", f.at("techs").iter().filter(|t| *t != tech).collect::<Val>());
        let r = dict! {};
        for b in f.at("research").keys() {
            r.set(&b, Val::None);
        }
        f.set("research", &r);
        r.set(R::TECH().at(tech).at("branch"), dict! {"tech" => tech, "left" => 0.001, "total" => 10});
    }
    let seq0 = g.seq;
    jouer_mois(&mut g, 1);
    let evs: Vec<Val> = g.events.iter().filter(|e| e.at("seq") > seq0).collect();
    let mine: Vec<&Val> = evs.iter().filter(|e| e.at("kind") == "tech" && e.get("tech") == "assolement").collect();
    let theirs: Vec<&Val> = evs.iter().filter(|e| e.at("kind") == "tech_ia" && e.get("tech") == "pins").collect();
    assert!(!mine.is_empty(), "ma découverte porte sa technologie");
    assert!(!theirs.is_empty() && theirs[0].at("who") == "24", "la découverte de l’IA est annoncée");
    assert!(me.at("tech_dates").has("assolement"));
    let (date, _t) = me.at("tech_dates").at("assolement").pair();
    assert!(date.s().contains("1790"));
    assert_eq!(V::player_state(&mut g, 0).at("me").at("tech_dates").at("assolement").at(0), date);
}

// ================================================================== ValeursEnCampagne
// Les valeurs chiffrées des régiments (game/tactics/stats.py) : celles de mes armées, de mes garnisons et des
// troupes à lever ; rien pour l'ennemi (le brouillard), même photographié ou espionné.

#[test]
fn mes_regiments_et_leur_general() {
    let mut g = partie();
    let a = armee(&g);
    let gen = a.get("gen").or_else(|| dict! {"name" => "Essai", "lvl" => 1, "xp" => 0.0}).copy();
    gen.set("trait", "inspirant");
    a.set("gen", gen);
    let d = vue_armee(&mut g, &a.at("id"));
    assert!(d.at("regs").iter().all(|r| r.at(10).has("mel")));
    assert!(d.at("regs").iter().all(|r| r.at(10).at("dis").at(2) > 0i64), "un général inspirant tient ses hommes");
    let nid = g.capital_of(&g.player).i();
    let cap = vue_place(&mut g, nid);
    assert!(
        cap.at("g").truthy() && cap.at("g").iter().all(|r| r.at(10).has("mel") && r.at(10).at("dis").at(2) == 0i64),
        "garnison sans général"
    );
    json::dumps(&d);
}

#[test]
fn rien_pour_l_ennemi() {
    let mut g = partie();
    let a = ennemi_en_vue(&g);
    avec(&mut g, "33", &["photographie"]);
    let d = vue_armee(&mut g, &a.at("id"));
    assert!(d.at("regs").truthy() && d.at("regs").iter().all(|r| r.len() < 11));
    let n = g.nodes.iter().find(|n| n.at("owner") == "24" && n.at("garrison").truthy()).unwrap();
    g.factions.at("33").at("intel").set(n.ati("id").to_string(), g.t + 100.0);
    let dn = vue_place(&mut g, n.ati("id"));
    assert!(dn.get("g").truthy() && dn.at("g").iter().all(|r| r.len() < 11));
}

#[test]
fn les_troupes_a_lever_sont_celles_qui_sortent() {
    let mut g = partie();
    jouer_mois(&mut g, 1);
    let cap = g.capital_of(&g.player).i();
    let d = vue_place(&mut g, cap);
    let rs: BTreeSet<String> = d.at("rs").keys().iter().map(|k| k.string()).collect();
    let ru: BTreeSet<String> = d.at("ru").iter().map(|k| k.string()).collect();
    assert_eq!(rs, ru);
    let n = lever(&g, 1, 1.0);
    let ids: HashSet<String> = n.at("garrison").iter().map(|r| r.ats("id")).collect();
    jouer_mois(&mut g, 1);
    let neuf = n.at("garrison").iter().find(|r| !ids.contains(&r.ats("id"))).unwrap();
    let d2 = vue_place(&mut g, cap);
    assert_eq!(d2.at("g").iter().find(|r| r.at(0) == neuf.at("id")).unwrap().at(10), d.at("rs").at("ligne"));
}

// ================================================================== RemontesEtRegimentsReleves
// Remontes : cavalerie et attelages attendent leurs chevaux un tour de plus. Régiments anéantis : relevés sous leur
// numéro autour d'un cadre du dépôt, pendant environ un mois après leur perte.

#[test]
fn remontes_un_tour_de_plus() {
    let mut g = partie();
    let a = armee(&g);
    let nid = prete(&g, &a, 0.8, None);
    let rg = AA::options(&mut g, &a, nid).at("rg");
    assert_eq!((rg.at("t"), rg.at("rm")), (Val::from(2), Val::from(1)));
    let (_ok, msg) = rangs(&mut g, &a);
    assert!(msg.contains("remontes"));
    jouer_mois(&mut g, 1);
    for r in a.at("regs").iter() {
        if AA::monte(&r) {
            assert!(r.atf("n") < r.atf("max") - 5.0, "les chevaux ne sont pas encore là");
        } else {
            proche(r.atf("n"), r.atf("max"), 1.0); // l'infanterie n'attend pas
        }
    }
    assert!(a.at("rg").truthy());
    jouer_mois(&mut g, 1);
    assert!(!a.at("rg").truthy());
    proche(plein(&a), 1.0, 0.01);
    a.set("rg", dict! {"node" => nid, "until" => g.t, "men" => 0, "t0" => g.t}); // renforts d'une ancienne sauvegarde (sans 'ui'), arrivés
    AA::tick(&mut g, 2.0, false);
    assert!(!a.at("rg").truthy());
}

#[test]
fn renfort_passif_plus_lent_a_cheval() {
    let mut g = partie();
    let p = g.player.clone();
    let (cav, inf) = (g.new_reg("cavalerie", &Val::from(100), &Val::None), g.new_reg("ligne", &Val::from(150), &Val::None));
    g.replenish(&p, &list![&cav, &inf], 1.0, 0.04);
    presque((cav.atf("n") - 100.0) / cav.atf("max"), R::REPL_MONTE * (inf.atf("n") - 150.0) / inf.atf("max"), 7);
}

#[test]
fn releve_sous_son_numero() {
    let mut g = partie();
    let a = armee(&g);
    let p = g.player.clone();
    let nid = prete(&g, &a, 1.0, None);
    g.factions.at(&p).at("res").set("livres", 1e4);
    let r = a.at("regs").at(1);
    let (rid, typ) = (r.at("id"), r.at("type"));
    assert!(AA::relever_why(&g, &p, &a).contains("Aucun régiment"));
    r.set("n", 2.0);
    g.prune(&a);
    assert_eq!(a.at("regs").len(), 2);
    assert_eq!(a.at("morts"), list![list![1, &typ, &rid, g.t]]);
    let rv = AA::options(&mut g, &a, nid).at("rv");
    assert_eq!((rv.at("why"), rv.at("regs")), (Val::from(""), list![list![1, &typ]]));
    assert_eq!(rv.at("cost").at("livres"), g.unit_cost(&p, typ.s()).at("livres"));
    let av = g.factions.at(&p).at("res").atf("livres");
    let g2 = sauver_relire(&mut g); // la sauvegarde garde les régiments à relever
    assert_eq!(g2.armies.at(a.at("id")).at("morts"), a.at("morts"));
    let (ok, msg) = AA::command(&mut g, &p, &a.at("id"), &Val::from("relever"));
    assert!(ok, "{msg}");
    assert!(msg.contains("1er "));
    presque(g.factions.at(&p).at("res").atf("livres"), av - rv.at("cost").atf("livres"), 7);
    let neuf = a.at("regs").at(1);
    assert_eq!((neuf.at("id"), neuf.at("type")), (rid.clone(), typ.clone()), "même rang, même numéro");
    presque(neuf.atf("n"), AA::RNG_CADRE * neuf.atf("max"), 7);
    assert_eq!(neuf.at("xp"), R::UNITS().at(&typ).get_or("xp0", 0));
    assert!(a.at("rg").truthy(), "les recrues arrivent comme pour compléter les rangs");
    assert!(!a.has("morts"));
    jouer_mois(&mut g, 2);
    proche(neuf.atf("n"), neuf.atf("max"), 1.0);
}

#[test]
fn refus_et_oubli() {
    let mut g = partie();
    let a = armee(&g);
    let p = g.player.clone();
    prete(&g, &a, 1.0, None);
    let ro: Val = a.at("regs").iter().map(|r| list![r.at("id"), r.at("type")]).collect();
    a.at("regs").pop_last();
    g.bury(&a, &ro);
    g.bury(&a, &ro);
    assert_eq!(a.at("morts").len(), 1, "noté une seule fois");
    g.factions.at(&p).at("res").set("livres", 0);
    assert!(AA::relever_why(&g, &p, &a).contains("Il faut"));
    g.factions.at(&p).at("res").set("livres", 1e4);
    a.set("at_node", Val::None);
    assert!(AA::relever_why(&g, &p, &a).contains("à l'arrêt"));
    prete(&g, &a, 1.0, None);
    assert_eq!(AA::relever_why(&g, &p, &a), "");
    a.at("morts").at(0).set(3, g.t - AA::MORTS_JOURS as f64 - 1.0);
    assert!(AA::relever_why(&g, &p, &a).contains("Aucun régiment"), "trop ancien : oublié");
}

#[test]
fn bataille_note_les_regiments_perdus() {
    let mut g = partie();
    let (a, b) = (armee_de(&g, "24"), armee_de(&g, "40"));
    a.set("state", "idle");
    b.set("state", "idle");
    g.start_battle(&list![&a], &list![&b], a.atf("x"), a.atf("y"), &Val::None, false, false);
    let bt = g.battles.at(a.at("battle"));
    assert_eq!(a.at("ro").len(), a.at("regs").len());
    let lost = a.at("regs").pop(0); // (le bilan d'une bataille commandée les retire avant end_battle : bridge.finish)
    g.end_battle(&bt, 1, false);
    assert!(g.armies.has(a.at("id")));
    let morts: Vec<Val> = a.get_or("morts", list![]).iter().map(|m| m.slice(None, Some(3))).collect();
    assert!(morts.contains(&list![0, lost.at("type"), lost.at("id")]));
    assert!(!a.has("ro"));
}

// ================================================================== ChampsDeBataille
// La carte montre les blessés et les tombes d'une bataille rangée, les fêtes ou le deuil après une bataille : le
// serveur garde les champs de bataille récents (Game.sites) et la dernière bataille de chaque camp (factions[].lb).

#[test]
fn champ_de_bataille_et_derniere_bataille() {
    let (mut g, bt) = bataille_de_campagne("1813", true, 3);
    let p = g.player.clone();
    bt.at("sides").at(0).set("lost", 320.0);
    bt.at("sides").at(1).set("lost", 150.0);
    let foe = bt.at("sides").at(1).ats("owner");
    g.end_battle(&bt, 1, false);
    assert_eq!(g.sites.len(), 1);
    let s = g.sites.at(0);
    assert_eq!((s.at("x"), s.at("y"), s.at("l")), (Val::from(py::round_n(bt.atf("x"), 2)), Val::from(py::round_n(bt.atf("y"), 2)), list![320, 150]));
    assert_eq!(s.at("o"), bt.at("sides").iter().map(|x| x.at("owner")).collect::<Val>());
    let st = V::player_state(&mut g, 0);
    assert!(s.at("w") == 1i64 && s.at("p") >= py::int(320.0 * R::PRISON_LOSS), "le vainqueur et ses prisonniers");
    assert_eq!(st.at("sites"), list![list![s.at("x"), s.at("y"), 0, 320, 150, s.at("o").at(0), s.at("o").at(1), 1, s.at("p"), Val::None, "campagne"]], "sa propre bataille : vue");
    let lb: BTreeMap<String, Val> = st.at("factions").iter().map(|f| (f.ats("code"), f.get("lb"))).collect();
    let moi_vaincu = if s.at("o").at(1) != p.as_str() { 0 } else { 1 };
    assert_eq!(lb[&p], list![moi_vaincu, 0, s.at("x"), s.at("y")], "avec son lieu (estafettes)");
    assert_eq!(lb[&foe], list![1, 0, s.at("x"), s.at("y")], "le vainqueur");
    assert!(lb.iter().filter(|(c, _)| !s.at("o").has(c.as_str())).all(|(_, v)| v.is_none()), "les autres camps : rien");
    // sauvegarde : gardés ; une ancienne sauvegarde n'en a pas
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let g2 = V::from_dict(GEO(), &d).unwrap();
    assert_eq!(g2.sites, g.sites);
    assert_eq!(g2.factions.at(&foe).at("lb"), g.factions.at(&foe).at("lb"));
    d.del("sites");
    assert_eq!(V::from_dict(GEO(), &d).unwrap().sites, vide());
    // une ancienne sauvegarde : ni vainqueur, ni lieu de la dernière bataille
    let mut g3 = V::from_dict(GEO(), &d).unwrap();
    g3.sites = list![dict! {"x" => 1.0, "y" => 2.0, "t" => g3.t, "l" => list![5, 5], "o" => s.at("o")}];
    g3.factions.at(&foe).set("lb", list![1, g3.t]);
    let st3 = V::player_state(&mut g3, 0);
    assert_eq!(st3.at("sites").at(0).slice(Some(7), None), list![Val::None, 0, Val::None, "campagne"]);
    assert_eq!(st3.at("factions").iter().find(|f| f.at("code") == foe).unwrap().at("lb"), list![1, 0]);
    // la bataille de deux autres camps : vue seulement à portée de vue
    g.sites.push(dict! {"x" => -500.0, "y" => -500.0, "t" => g.t, "l" => list![10, 10], "o" => list!["40", "47"]});
    assert_eq!(V::player_state(&mut g, 0).at("sites").len(), 1, "loin de tout regard : cachée");
    g.sites.at(-1).set("x", s.at("x"));
    g.sites.at(-1).set("y", s.at("y"));
    assert_eq!(V::player_state(&mut g, 0).at("sites").len(), 2, "sous les yeux du joueur : vue");
    // passé un mois, plus de fête ; passé SITE_DAYS, plus de tombes (et oubliée à la bataille suivante)
    g.t += (V::LB_DAYS - 1) as f64;
    assert!(V::player_state(&mut g, 0).at("factions").iter().any(|f| f.has("lb")), "un tour (30 jours) et le temps des estafettes");
    g.t += 2.0;
    let st = V::player_state(&mut g, 0);
    assert!(st.at("factions").iter().all(|f| !f.has("lb")));
    assert_eq!(st.at("sites").len(), 2);
    g.t += SITE_DAYS as f64;
    assert_eq!(V::player_state(&mut g, 0).at("sites"), vide());
    let b2 = bt.copy();
    b2.set("id", "b2");
    g.end_battle(&b2, 0, false);
    assert_eq!(g.sites.len(), 1, "les vieux champs de bataille sont oubliés");
}

/// Le choléra de 1832 (événement daté) : trois mois d'épidémie dans les villes (lv, comme une épidémie locale), le
/// cordon sanitaire de la carte ; rien dans les villages, rien avant ni après.
#[test]
fn cholera_dans_les_villes() {
    let mut g = partie();
    let t0 = (V::CHOLERA_T() - g.start_ord) as f64;
    g.t = t0 + 5.0;
    let ev = if g.ev_done.truthy() { g.ev_done.to_list() } else { vide() };
    ev.push("cholera");
    g.ev_done = ev;
    for n in g.nodes.iter() {
        n.pop("lev");
    }
    let lv: BTreeMap<i64, Val> = V::player_state(&mut g, 0).at("nodes").iter().map(|n| (n.ati("id"), n.get("lv"))).collect();
    let geo = GEO();
    let villes: Vec<i64> = geo.nodes.iter().filter(|n| n.at("type") == "ville" || n.at("type") == "capitale").map(|n| n.ati("id")).collect();
    assert!(!villes.is_empty() && villes.iter().all(|i| lv[i] == list!["epidemie", 5]));
    assert!(geo.nodes.iter().filter(|n| n.at("type") == "village").all(|n| lv[&n.ati("id")].is_none()));
    g.t = t0 + (V::LEV_DAYS + 1) as f64;
    assert!(V::player_state(&mut g, 0).at("nodes").iter().all(|n| n.get("lv").is_none()), "trois mois après : fini");
    g.t = t0 + 5.0;
    g.ev_done = vide();
    assert!(V::player_state(&mut g, 0).at("nodes").iter().all(|n| n.get("lv").is_none()), "l'événement n'a pas eu lieu");
}

// ================================================================== BoueApresLaPluie
// Après la pluie, chemins et routes de terre restent boueux quelques jours : on y marche moins vite.

#[test]
fn la_boue_dure_puis_seche() {
    let mut g = partie();
    let (x, y) = (g.geo.nodes.at(0).atf("x"), g.geo.nodes.at(0).atf("y"));
    let z = g.zone_of(x, y);
    assert_eq!(g.mud_k(x, y, false), 1.0);
    g.weather.set(z, dict! {"kind" => "pluie", "left" => 1});
    g.new_day(); // un jour de pluie : la boue est là, mais c'est la pluie qui ralentit (pas deux fois)
    assert_eq!(g.weather.at(z).get("mud"), if g.season() == "été" { 1 } else { R::MUD_DAYS });
    g.weather.at(z).update(&dict! {"kind" => "soleil", "left" => 9, "mud" => R::MUD_DAYS});
    assert_eq!(g.mud_k(x, y, false), R::MUD_MOVE);
    assert_eq!(g.mud_k(x, y, true), 1.0, "une route royale est empierrée");
    g.weather.at(z).set("kind", "pluie");
    assert_eq!(g.mud_k(x, y, false), 1.0, "sous la pluie, la météo le compte déjà");
    g.weather.at(z).set("kind", "soleil");
    for _ in 0..R::MUD_DAYS {
        g.new_day();
        g.weather.at(z).update(&dict! {"kind" => "soleil", "left" => 9}); // (le tirage du temps ne doit pas ramener la pluie dans l'essai)
    }
    assert_eq!(g.mud_k(x, y, false), 1.0, "trois jours de soleil : les chemins ont séché");
}

// ================================================================== ManoeuvresParRegiment
// SPEC-ARBRE.md, module moderniser : une manœuvre ou une arme nouvelle ne sert qu'aux régiments qui l'ont.
// (Ces deux classes et la suivante sont, dans le Python, écrites après `if __name__ == '__main__'` : unittest les
// trouve quand même.)

/// setUp : (g, f, ligne).
fn manoeuvres() -> (Game, Val, Val) {
    let mut g = partie_avec("33", "1790", 1, "normal");
    let p = g.player.clone();
    let f = g.factions.at(&p);
    let ligne = g.new_reg("ligne", &Val::None, &Val::from(p.as_str()));
    (g, f, ligne)
}

fn ligne_fire(g: &Game, r: &Val) -> f64 {
    g.reg_mods(&g.player, r, &Val::None).get_or("ligne_fire", 0).f()
}

#[test]
fn un_regiment_leve_a_les_manoeuvres_de_son_camp() {
    let (g, f, ligne) = manoeuvres();
    assert!(f.at("techs").has("tir_rang"));
    let man: BTreeSet<String> = ligne.at("man").iter().map(|t| t.string()).collect();
    let attendu: BTreeSet<String> = R::MANEUVERS().items().into_iter().filter(|(t, c)| *c == "inf" && f.at("techs").has(t)).map(|(t, _)| t.string()).collect();
    assert_eq!(man, attendu);
    assert_eq!(g.reg_lag(&g.player, &ligne), vide());
}

#[test]
fn sans_feu_de_rang_pas_de_bonus() {
    let (g, _f, r) = manoeuvres();
    let avec_ = ligne_fire(&g, &r);
    r.set("man", r.at("man").iter().filter(|t| *t != "tir_rang").collect::<Val>());
    let sans = ligne_fire(&g, &r);
    presque(avec_ - sans, R::TECH().at("tir_rang").at("fx").atf("ligne_fire"), 7);
    assert!(g.reg_lag(&g.player, &r).has("tir_rang"));
}

#[test]
fn une_arme_plus_recente_ne_sert_pas_au_vieux_fusil() {
    let (mut g, f, r) = manoeuvres();
    let p = g.player.clone();
    f.at("techs").extend(&list!["percussion", "minie", "chassepot"]);
    g.recompute_mods(&p);
    assert!(r.at("arm") < 5i64);
    // le +10 % du Chassepot est pour les Chassepot
    presque(ligne_fire(&g, &r) + R::TECH().at("chassepot").at("fx").atf("ligne_fire"), f.at("mods").get_or("ligne_fire", 0).f(), 7);
    r.set("arm", g.arm_level(&p, "inf"));
    presque(ligne_fire(&g, &r), f.at("mods").get_or("ligne_fire", 0).f(), 7);
}

#[test]
fn la_resolution_automatique_compte_les_manoeuvres() {
    let (mut g, f, _) = manoeuvres();
    let p = g.player.clone();
    f.at("techs").push("voltigeurs");
    g.recompute_mods(&p);
    let leg = g.new_reg("legere", &Val::None, &Val::from(p.as_str()));
    assert!(leg.at("man").has("voltigeurs"));
    let p_avec = g.reg_power(&p, &leg, "Forêt", 1.0, true, &Val::None);
    leg.at("man").remove(&Val::from("voltigeurs"));
    assert!(g.reg_power(&p, &leg, "Forêt", 1.0, true, &Val::None) < p_avec, "couvert des voltigeurs : appris ou pas");
}

#[test]
fn une_sauvegarde_d_avant_garde_ses_manoeuvres() {
    let (mut g, _, _) = manoeuvres();
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    for a in d.at("armies").values() {
        for r in a.at("regs").iter() {
            r.pop("man");
        }
    }
    let g2 = V::from_dict(GEO(), &d).unwrap();
    for a in g2.armies.values() {
        for r in a.at("regs").iter() {
            assert!(!g2.reg_lag(&a.ats("owner"), &r).iter().any(|t| R::MANEUVERS().has(&t)), "les manœuvres connues sont données");
        }
    }
}

#[test]
fn la_garde_nationale_a_toujours_celles_de_son_camp() {
    let (mut g, _, _) = manoeuvres();
    let p = g.player.clone();
    let r = g.new_reg("garde", &Val::None, &Val::from(p.as_str()));
    r.set("man", vide());
    assert_eq!(g.reg_lag(&p, &r), vide());
}

// ================================================================== Moderniser
// SPEC-ARBRE.md : le bouton « Moderniser » (armes et manœuvres, prix, dix jours d'exercice, annulé en partant).

/// setUp : (g, f, a, r).
fn moderniser() -> (Game, Val, Val, Val) {
    let g = partie_avec("33", "1790", 1, "normal");
    let f = g.factions.at(&g.player);
    f.at("res").update(&dict! {"livres" => 1e5, "armes" => 1e4, "fer" => 1e4});
    let a = armee(&g);
    if a.at("at_node").is_none() || g.nodes.at(a.at("at_node")).at("owner") != g.player {
        a.set("at_node", g.capital_of(&g.player));
    }
    a.set("state", "idle");
    let r = a.at("regs").iter().find(|r| r.at("type") == "ligne").unwrap();
    for r in a.at("regs").iter() {
        r.pop("drill");
    }
    (g, f, a, r)
}

fn jours(g: &mut Game, n: i64) {
    for _ in 0..n {
        g.step(1.0);
    }
}

fn sans_tir_rang(r: &Val) {
    r.at("man").remove(&Val::from("tir_rang"));
}

#[test]
fn prix_armes_et_manoeuvres() {
    let (g, _f, _a, r) = moderniser();
    r.dec("arm", 1);
    sans_tir_rang(&r);
    let cost = g.modernize_cost(&g.player, &list![&r]);
    let max = r.atf("max");
    assert_eq!(cost, dict! {"armes" => py::round(R::REARM().at("inf").atf("armes") * max), "livres" => py::round(R::MAN_COST * max)});
}

#[test]
fn dix_jours_puis_les_armes_et_les_manoeuvres() {
    let (mut g, f, a, r) = moderniser();
    let p = g.player.clone();
    r.dec("arm", 1);
    sans_tir_rang(&r);
    let (xp, livres) = (r.atf("xp"), f.at("res").atf("livres"));
    let (ok, msg) = g.modernize(&p, &a.at("id"), &Val::None);
    assert!(ok, "{msg}");
    assert!(f.at("res").atf("livres") < livres);
    assert_eq!(g.modernize_cost(&p, &list![&r]), dict! {}, "à l’exercice : on ne paie pas deux fois");
    jours(&mut g, R::MAN_DAYS - 2);
    assert!(!r.at("man").has("tir_rang"));
    jours(&mut g, 3);
    assert!(!r.has("drill"));
    assert!(r.at("man").has("tir_rang"));
    assert_eq!(r.at("arm"), g.arm_level(&p, "inf"));
    proche(r.atf("xp"), xp * 0.85, 1.0);
    assert_eq!(g.reg_lag(&p, &r), vide());
}

#[test]
fn les_manoeuvres_seules_ne_coutent_pas_d_experience() {
    let (mut g, _f, a, r) = moderniser();
    let p = g.player.clone();
    sans_tir_rang(&r);
    let xp = r.atf("xp");
    assert!(g.modernize(&p, &a.at("id"), &Val::None).0);
    jours(&mut g, R::MAN_DAYS + 1);
    assert!(r.at("man").has("tir_rang"));
    assert!(r.atf("xp") >= xp - 0.5);
}

#[test]
fn partir_interrompt_l_exercice() {
    let (mut g, _f, a, r) = moderniser();
    let p = g.player.clone();
    sans_tir_rang(&r);
    assert!(g.modernize(&p, &a.at("id"), &Val::None).0);
    let far = g.owned_nodes(&p).iter().find(|n| n.at("id") != a.at("at_node")).unwrap();
    assert_eq!(vers_place(&mut g, &p, &a, far.ati("id")).0, Some(true));
    jours(&mut g, R::MAN_DAYS + 1);
    assert!(!r.has("drill"));
    assert!(!r.at("man").has("tir_rang"), "parti avant la fin : rien appris");
}

#[test]
fn une_garnison_se_modernise() {
    let (mut g, _f, _a, _r) = moderniser();
    let p = g.player.clone();
    let units = R::UNITS();
    let ok_reg = |r: &Val| !units.at(r.at("type")).at("garrison_only").truthy() && units.at(r.at("type")).at("cls") == "inf";
    let n = g
        .owned_nodes(&p)
        .iter()
        .find(|n| n.at("garrison").truthy() && !n.at("siege").truthy() && n.at("garrison").iter().any(|r| ok_reg(&r)))
        .unwrap();
    let r = n.at("garrison").iter().find(|r| ok_reg(r)).unwrap();
    r.set("man", vide());
    assert!(g.modernize(&p, &Val::None, &n.at("id")).0);
    jours(&mut g, R::MAN_DAYS + 1);
    assert_eq!(g.reg_lag(&p, &r), vide());
}

#[test]
fn la_vue_dit_quoi_et_combien() {
    let (mut g, _f, a, r) = moderniser();
    sans_tir_rang(&r);
    let d = vue_armee(&mut g, &a.at("id"));
    assert_eq!(d.at("mz").at("n"), 1);
    assert_eq!(d.at("mz").at("man"), list![list![R::TECH().at("tir_rang").at("name"), 1]]);
    assert_eq!(d.at("regs").iter().find(|x| x.at(0) == r.at("id")).unwrap().at(12), 1, "à moderniser");
}

#[test]
fn une_ia_modernise_ses_armees() {
    let mut g = partie_avec("33", "1790", 2, "normal");
    let code = "24";
    let f = g.factions.at(code);
    let l = f.at("res").atf("livres");
    f.at("res").update(&dict! {"livres" => if l > 8000.0 { f.at("res").at("livres") } else { Val::from(8000) }});
    avec(&mut g, code, &["voltigeurs"]);
    let units = R::UNITS();
    let inf: Vec<Val> = g
        .armies
        .values()
        .iter()
        .filter(|a| a.at("owner") == code)
        .flat_map(|a| a.at("regs").iter())
        .filter(|r| units.at(r.at("type")).at("cls") == "inf" && !units.at(r.at("type")).at("garrison_only").truthy())
        .collect();
    assert!(!inf.is_empty() && inf.iter().all(|r| !r.at("man").has("voltigeurs")));
    jouer_mois(&mut g, 3);
    let appris = g
        .armies
        .values()
        .iter()
        .filter(|a| a.at("owner") == code)
        .flat_map(|a| a.at("regs").iter())
        .filter(|r| r.get_or("man", list![]).has("voltigeurs"))
        .count();
    assert!(appris > 0, "en trois mois, l’IA a modernisé au moins une armée");
}

// ================================================================== RechercheDesIA
// Choix du 24/10/2026 : l'IA cherche dans l'ordre des dates et finit vers la date historique (le joueur fonce).

#[test]
fn l_ia_ne_fonce_pas_sur_la_percussion() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let code = "24";
    let f = g.factions.at(code);
    f.at("res").set("livres", 1e6);
    f.at("techs").extend(&list!["baionnette", "fusil1777", "poudreries"]);
    let mut ai = g.ais[code].take().unwrap();
    for _ in 0..5 {
        ai.research(&mut g);
    }
    g.ais[code] = Some(ai);
    let cours: BTreeSet<String> = f.at("research").values().iter().filter(|v| v.truthy()).map(|v| v.ats("tech")).collect();
    assert!(!cours.is_empty(), "elle cherche");
    assert!(!cours.contains("percussion"), "la percussion (1840) ne se lance pas en 1700");
    for t in &cours {
        let annee = R::TECH_YEAR().atf(t.as_str()) - R::TECH().at(t.as_str()).atf("days") / 360.0 - AIM::AI_AHEAD as f64;
        assert!(annee <= 1700.0, "{t}");
    }
}
