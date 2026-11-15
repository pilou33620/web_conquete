//! Banc des généraux qui évoluent (SPEC-GENERAUX.md) : portage de tests/test_generaux.py.
//!
//! POURQUOI CE BANC EXISTE. Un général se suit d'une bataille à l'autre (grades jusqu'à maréchal, talents, médailles,
//! blessures, captivité) : ces règles ne se voient qu'au bout de plusieurs batailles, ici jouées en appelant le moteur.

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::tactics::bridge as TB;
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{armee, armee_de, bataille_de_campagne, partie, partie_avec};

fn xp(g: &mut Game, a: &Val, n: f64) {
    g.general_xp(a, &Val::from(n), false);
}

fn victoire(g: &mut Game, a: &Val) {
    g.general_xp(a, &Val::from(0), true);
}

/// `g.create_army(g.player, a['x'], a['y'], [g.new_reg('ligne', code=g.player)], node=a['at_node'])`
fn nouvelle_armee(g: &mut Game, a: &Val) -> Val {
    let p = g.player.clone();
    let r = g.new_reg("ligne", &Val::None, &Val::from(p.as_str()));
    g.create_army(&p, a.atf("x"), a.atf("y"), &list![r], &a.at("at_node"), &Val::None, &Val::None)
}

// ------------------------------------------------------------------ Grades

#[test]
fn de_colonel_a_marechal() {
    let mut g = partie();
    let a = armee(&g);
    let gen = a.at("gen");
    assert_eq!((gen.at("lvl"), gen.at("talents"), gen.at("medailles")), (Val::from(1), list![], list![]));
    xp(&mut g, &a, 12.0);
    assert_eq!(gen.at("lvl"), 4);
    assert!(Game::gen_title(&gen).starts_with("Lieutenant général"));
    xp(&mut g, &a, 10.0);
    assert_eq!(gen.at("lvl"), 4, "pas de bâton sans victoires");
    for _ in 0..R::MARECHAL_VICTOIRES {
        victoire(&mut g, &a);
    }
    assert_eq!(gen.at("lvl"), 5);
    assert!(Game::gen_title(&gen).starts_with("Maréchal"));
    json::dumps(&V::player_state(&mut g, 0)); // (l'état envoyé au client supporte le cinquième grade)
}

#[test]
fn un_seul_marechal_par_camp() {
    let mut g = partie();
    let a = armee(&g);
    let b = nouvelle_armee(&mut g, &a);
    for x in [&a, &b] {
        xp(&mut g, x, 30.0);
        for _ in 0..R::MARECHAL_VICTOIRES {
            victoire(&mut g, x);
        }
    }
    let mut l = vec![a.at("gen").ati("lvl"), b.at("gen").ati("lvl")];
    l.sort();
    assert_eq!(l, vec![4, 5]);
}

#[test]
fn ancienne_sauvegarde() {
    let mut g = partie();
    let a = armee(&g);
    a.set("gen", dict! {"name" => "Labat", "trait" => "prudent", "lvl" => 2, "xp" => 4.0});
    V::migrate(&mut g);
    let gen = a.at("gen");
    assert_eq!((gen.at("talents"), gen.at("etats"), gen.at("vic")), (list![], list![], Val::from(0)));
    assert!(gen.at("id").truthy());
}

// ------------------------------------------------------------------ Reserve

#[test]
fn fusion_reserve_et_nomination() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    let b = nouvelle_armee(&mut g, &a);
    xp(&mut g, &b, 4.0); // (général de brigade)
    let gb = b.at("gen");
    let (ok, _) = g.merge(&p, &a.at("id"), &b.at("id"));
    assert!(ok);
    assert!(a.at("gen").is(&gb), "le meilleur prend la tête");
    assert_eq!(g.factions.at(&p).get_or("generaux", list![]), list![], "le colonel sans états de service se retire");
    // le général de brigade écarté par une fusion attend en réserve ; une armée nouvelle le prend
    let c = nouvelle_armee(&mut g, &a);
    xp(&mut g, &c, 8.0);
    g.merge(&p, &c.at("id"), &a.at("id"));
    assert_eq!(g.factions.at(&p).at("generaux"), list![&gb]);
    let d = nouvelle_armee(&mut g, &a);
    assert!(d.at("gen").is(&gb));
    // nomination : le général de la réserve à la tête d'une armée dans une place du joueur
    g.reserver(&p, &d.at("gen"));
    let ng = g.new_general(&p);
    d.set("gen", ng);
    let (ok, msg) = g.nommer(&p, &d.at("id"), gb.at("id").s());
    assert!(ok, "{msg}");
    assert!(d.at("gen").is(&gb));
    assert!(!g.nommer(&p, &d.at("id"), "g-inconnu").0);
}

#[test]
fn le_detachement_des_ia_ne_vole_pas_de_general() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    xp(&mut g, &a, 4.0);
    let gen = a.at("gen");
    let (ok, bid) = g.split(&p, &a.at("id"), &list![a.at("regs").at(0).at("id")]);
    assert!(ok);
    assert!(!g.armies.at(bid.as_str()).at("gen").is(&gen));
    assert_eq!(g.factions.at(&p).get_or("generaux", list![]), list![], "un détachement prend un colonel neuf");
}

// ------------------------------------------------------------------ Risques

#[test]
fn blesse_remplace_puis_revient() {
    let mut g = partie();
    let a = armee(&g);
    xp(&mut g, &a, 4.0);
    let gen = a.at("gen");
    g.blesser_general(&a, &Val::from(2));
    assert!(a.at("gen").get("interim").truthy());
    g.t += 59.0;
    g.soigner_generaux();
    assert!(a.at("gen").get("interim").truthy(), "encore en convalescence");
    g.t += 2.0;
    g.soigner_generaux();
    assert!(a.at("gen").is(&gen));
}

#[test]
fn tirage_selon_le_trait() {
    let mut g = partie();
    let a = armee(&g);
    let mut compte = std::collections::HashMap::new();
    for trait_ in ["audacieux", "prudent"] {
        a.at("gen").set("trait", trait_);
        let mut n = 0;
        for j in 0..600 {
            // (le tirage est fixé par le jour : un jour différent à chaque essai)
            g.t = j as f64;
            n += g.risques_general(&a, "aneantie", false).is_some() as i64;
        }
        compte.insert(trait_, n);
    }
    assert!(compte["audacieux"] as f64 > compte["prudent"] as f64 * 1.6);
}

/// Le sort de l'état-major décide de celui du général (bridge.finish) : pris, il part chez le vainqueur.
#[test]
fn etat_major_pris_en_bataille_commandee() {
    let (mut g, bt) = bataille_de_campagne("1813", true, 3);
    assert!(TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "manuel"}).atb("ok"));
    let mut tb = g.tactical.take().unwrap();
    assert_eq!(tb.bid, bt.ats("id"));
    let em = tb.units.iter().find(|u| u.at("cls") == "general" && u.at("side") == 0).unwrap();
    let a = g.armies.at(em.at("army"));
    let gen = a.at("gen");
    em.set("captured", 30.0);
    em.set("men", 0.0);
    tb.finish(1, false, "essai");
    let vainqueur = tb.units.iter().find(|x| x.at("side") == 1).unwrap().at("owner");
    TB::finish(&mut g, tb);
    let captifs: Vec<Val> = g.factions.at(&vainqueur).get_or("captifs", list![]).iter().map(|c| c.at("gen")).collect();
    assert!(captifs.contains(&gen));
}

// ------------------------------------------------------------------ Captifs

#[test]
fn echange_rachat_et_paix() {
    let mut g = partie();
    let (moi, eux) = (g.player.clone(), "24");
    let (a, b) = (armee(&g), armee_de(&g, eux));
    xp(&mut g, &a, 4.0);
    xp(&mut g, &b, 8.0);
    let (ga, gb) = (a.at("gen"), b.at("gen"));
    g.capturer_general(&a, &Val::from(eux), true);
    g.capturer_general(&b, &Val::from(moi.as_str()), true);
    let gens = |g: &Game| D::captifs(g, eux, &moi).iter().map(|c| c.at("gen")).collect::<Vec<_>>();
    assert_eq!(gens(&g), vec![ga.clone()]);
    D::exchange_prisoners(&mut g, &moi, eux);
    assert!(g.factions.at(&moi).at("generaux").has(&ga));
    assert!(g.factions.at(eux).at("generaux").has(&gb));
    // un général sans contrepartie se rachète selon son grade
    let x = armee(&g);
    g.capturer_general(&x, &Val::from(eux), true);
    g.factions.at(&moi).at("res").set("livres", 1000);
    let livres = 1000;
    D::exchange_prisoners(&mut g, &moi, eux);
    assert_eq!(D::captifs(&g, eux, &moi), list![]);
    assert_eq!(g.factions.at(&moi).at("res").at("livres"), Val::from(livres).py_sub(&R::GENERAL_RANCON().at(0)));
    // à la paix, les captifs rentrent chez eux
    let x = armee(&g);
    g.capturer_general(&x, &Val::from(eux), true);
    D::make_peace(&mut g, &moi, eux);
    assert_eq!(D::captifs(&g, eux, &moi), list![]);
}

#[test]
fn le_marechal_libere_ne_fait_pas_un_second_marechal() {
    let mut g = partie();
    let (moi, eux) = (g.player.clone(), "24");
    let a = armee(&g);
    a.at("gen").set("lvl", 5);
    g.capturer_general(&a, &Val::from(eux), true);
    a.at("gen").set("lvl", 5); // (un autre maréchal pendant sa captivité)
    D::make_peace(&mut g, &moi, eux);
    let mut l: Vec<i64> = g.generaux(&moi).iter().map(|x| x.ati("lvl")).collect();
    l.sort();
    assert_eq!(l, vec![4, 5]);
}

// ------------------------------------------------------------------ Talents

#[test]
fn promotion_du_joueur_et_effet() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    a.at("gen").set("trait", "artilleur");
    xp(&mut g, &a, 3.0);
    let offres = a.at("gen").at("promo");
    assert_eq!(offres.slice(None, Some(2)), list!["pointeurs", "attelages"], "les deux talents du premier étage de son arbre");
    assert!(R::GENERAL_TALENTS().at(offres.at(2)).at("trait").is_none(), "et un commun");
    let art = match a.at("regs").iter().find(|r| r.at("type") == "artillerie") {
        Some(r) => r,
        None => {
            let r = g.new_reg("artillerie", &Val::None, &Val::from(p.as_str()));
            a.at("regs").push(&r);
            r
        }
    };
    let p0 = g.reg_power(&p, &art, "Plaine", 1.0, false, &a);
    let (ok, _) = g.choisir_talent(&p, &a.at("id"), "pointeurs");
    assert!(ok);
    assert!(!a.at("gen").has("promo"));
    assert!(g.reg_power(&p, &art, "Plaine", 1.0, false, &a) > p0 * 1.03);
    assert!(!g.choisir_talent(&p, &a.at("id"), "pointeurs").0, "plus de choix en attente");
    // le second étage s'ouvre
    xp(&mut g, &a, 4.0);
    assert!(a.at("gen").at("promo").has("grande_batterie"));
}

#[test]
fn les_ia_choisissent_seules() {
    let mut g = partie();
    let b = armee_de(&g, "24");
    xp(&mut g, &b, 12.0);
    assert_eq!(b.at("gen").at("talents").len(), 3);
    assert!(!b.at("gen").has("promo"));
}

// ------------------------------------------------------------------ Medailles

#[test]
fn nom_selon_l_epoque_et_moral() {
    for (epoque, nom) in [("1700", "Ordre de Saint-Louis"), ("1813", "Légion d’honneur")] {
        let mut g = partie_avec("33", epoque, 1, "normal");
        let p = g.player.clone();
        let a = armee(&g);
        let r = a.at("regs").at(0);
        r.set("morale", 60.0);
        let p0 = g.reg_power(&p, &r, "Plaine", 1.0, false, &a);
        g.decorer(&a, "victoire à un contre deux");
        assert_eq!(a.at("gen").at("medailles").at(0).slice(None, Some(2)), list![nom, "victoire à un contre deux"]);
        assert_eq!(a.at("gen").at("xp"), 1.0);
        assert!(g.reg_power(&p, &r, "Plaine", 1.0, false, &a) > p0);
        for _ in 0..5 {
            g.decorer(&a, "x");
        }
        assert_eq!(g.moral_medailles(&a), (3 * R::MEDAILLE_MORAL) as f64, "trois médailles comptent au plus");
    }
}
