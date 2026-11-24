//! Banc d'essai de la politique intérieure (SPEC-POLITIQUE, module 5) : régime de départ selon l'histoire, impôts par
//! classe, émeutes et révolution, réprimer ou céder, révolution victorieuse et guerre civile (camp rebelle, places
//! partagées, le joueur prend la tête des rebelles), ministres nommés et renvoyés, élections, sauvegarde et ancienne
//! sauvegarde. Sur la carte d'Aquitaine, et celle d'Europe pour les pays.
#![allow(non_snake_case)]

mod fabrique_campagne;

use conquete::engine::politique as PO;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::views as V;
use conquete::dict;
use fabrique_campagne::{geo, jouer_mois, partie_avec, play_month, GEO};

fn pol(g: &Game, code: &str) -> Val {
    g.factions.at(code).at("politique")
}

fn mec(g: &Game, code: &str, c: &str) -> f64 {
    pol(g, code).at("classes").at(c).atf("mecontentement")
}

/// Le camp tient assez de places pour une guerre civile (les villages autour de sa capitale lui sont donnés).
fn agrandir(g: &mut Game, code: &str, n: usize) {
    let cap = g.capital_of(code);
    let (cx, cy) = (g.geo.nodes.at(&cap).atf("x"), g.geo.nodes.at(&cap).atf("y"));
    let mut libres: Vec<(f64, i64)> = g.nodes.iter().filter(|n| n.at("owner") == R::NEUTRAL)
        .map(|n| { let gn = g.geo.nodes.at(n.at("id")); ((gn.atf("x") - cx).hypot(gn.atf("y") - cy), n.ati("id")) }).collect();
    libres.sort_by(|a, b| a.partial_cmp(b).unwrap());
    for (_, nid) in libres.into_iter().take(n) {
        g.nodes.at(nid).set("owner", code);
    }
}

fn recharger(g: &mut Game) -> Game {
    let d = V::to_dict(g);
    V::from_dict(g.geo.clone(), &json::loads(&json::dumps(&d)).unwrap()).unwrap()
}

#[test]
fn regime_de_depart_selon_l_histoire() {
    assert_eq!(R::regime_historique("FR", 1700), "absolue");
    assert_eq!(R::regime_historique("FR", 1790), "constitutionnelle");
    assert_eq!(R::regime_historique("FR", 1813), "absolue");
    assert_eq!(R::regime_historique("FR", 1870), "republique");
    assert_eq!(R::regime_historique("33", 1700), "absolue"); // un département suit la France
    assert_eq!(R::regime_historique("AGB", 1700), "constitutionnelle"); // une colonie, sa métropole
    assert_eq!(R::regime_historique("ATC", 1790), "republique");
    let g = partie_avec("33", "1700", 1, "normal");
    assert_eq!(pol(&g, "33").at("regime"), "absolue");
    assert!(pol(&g, "33").at("cabinet").at("chef").is_dict() && pol(&g, "33").at("candidats").len() == R::CANDIDATS as usize);
    let g = partie_avec("33", "1790", 1, "normal");
    assert_eq!(pol(&g, "24").at("regime"), "constitutionnelle");
    let g = Game::new(geo(5), "FR", &Val::from("normal"), &Val::from(1), &Val::from("1700"));
    for (c, r) in [("FR", "absolue"), ("GB", "constitutionnelle"), ("NL", "republique"), ("VE", "republique"), ("RU", "absolue")] {
        assert_eq!(pol(&g, c).at("regime"), r, "{c}");
    }
    // les noms des ministres sont ceux du pays
    let nom = pol(&g, "GB").at("cabinet").at("finances").ats("nom");
    assert!(R::surnames("GB").iter().any(|s| nom.ends_with(s.s())), "{nom}");
    // la vue : complète pour le joueur, un résumé pour les autres
    let mut g = g;
    let vue = V::player_state(&mut g, 0);
    let me = vue.at("me").at("politique");
    assert_eq!(me.at("regime"), "absolue");
    assert!(me.at("classes").at("peuple").at("raisons").len() >= 2);
    let gb = vue.at("factions").iter().find(|f| f.at("code") == "GB").unwrap();
    assert_eq!(gb.at("politique").at("regime"), "constitutionnelle");
    let regles = V::rules_payload_carte(5);
    assert!(regles.at("regimes").has("republique") && regles.at("postes").has("finances"));
}

#[test]
fn impots_lourds_emeutes_puis_revolution() {
    let mut g = partie_avec("33", "1700", 2, "normal");
    // l'ancien réglage unique : la moyenne des deux classes
    let (ok, _) = g.set_tax("33", &Val::from(0.7));
    assert!(ok);
    let cl = pol(&g, "33").at("classes");
    assert!((cl.at("noblesse").atf("impot") + cl.at("peuple").atf("impot") - 1.4).abs() < 1e-6);
    // tout sur le peuple, rien sur la noblesse
    for (c, v) in [("peuple", 1.0), ("noblesse", 0.0)] {
        let r = PO::commande(&mut g, "33", &dict! {"sub" => "impot", "classe" => c, "value" => v});
        assert!(r.getb("ok"), "{r}");
    }
    assert!((g.factions.at("33").atf("tax") - 0.5).abs() < 1e-6);
    let mut emeutes = false;
    for _ in 0..24 {
        jouer_mois(&mut g, 1);
        emeutes |= g.events.iter().any(|e| e.ats("text").starts_with("Émeutes"));
        if g.pending_ev.iter().any(|x| x.at("ev") == "revolution") {
            break;
        }
    }
    assert!(emeutes, "pas d'émeutes");
    assert!(mec(&g, "33", "peuple") >= R::SEUIL_REVOLUTION, "{}", mec(&g, "33", "peuple"));
    let x = g.pending_ev.iter().find(|x| x.at("ev") == "revolution").expect("pas de révolution");
    assert_eq!(x.at("choices").len(), 3);
    assert!(V::player_state(&mut g, 0).at("me").at("politique").at("revolution").is_dict());
    // céder : un pas vers la république, le peuple s'apaise
    let avant = mec(&g, "33", "peuple");
    let r = PO::commande(&mut g, "33", &dict! {"sub" => "revolution", "choix" => "ceder"});
    assert!(r.getb("ok"), "{r}");
    assert_eq!(pol(&g, "33").at("regime"), "constitutionnelle");
    assert!(mec(&g, "33", "peuple") <= avant - 29.0);
    assert!(pol(&g, "33").at("revolution").is_none() && !g.pending_ev.iter().any(|x| x.at("ev") == "revolution"));
}

#[test]
fn reprimer_reussi_ou_rate() {
    let mut g = partie_avec("33", "1700", 3, "normal");
    pol(&g, "33").at("classes").at("peuple").set("mecontentement", 90.0);
    PO::appliquer(&mut g, "33", &dict! {"revolution" => "reprimer", "classe" => "peuple", "chance" => 1.0});
    assert_eq!(pol(&g, "33").at("regime"), "absolue");
    assert!((mec(&g, "33", "peuple") - 60.0).abs() < 1e-6);
    // ratée, chez un petit camp : le régime tombe sans guerre civile
    pol(&g, "33").at("classes").at("peuple").set("mecontentement", 90.0);
    let cap = g.capital_of("33");
    for n in g.owned("33").into_iter().filter(|n| n.at("id") != cap).skip(2) {
        n.set("owner", R::NEUTRAL);
    }
    let places = g.owned("33").len() as i64;
    assert!(places < R::GUERRE_CIVILE_PLACES, "{places}");
    PO::appliquer(&mut g, "33", &dict! {"revolution" => "reprimer", "classe" => "peuple", "chance" => 0.0});
    assert_eq!(pol(&g, "33").at("regime"), "republique");
    assert!(!g.factions.has("33r"));
}

#[test]
fn revolution_gagnante_republique_et_guerre_civile() {
    let mut g = partie_avec("33", "1700", 4, "normal");
    agrandir(&mut g, "33", 12);
    let avant = g.owned("33").len();
    pol(&g, "33").at("classes").at("peuple").set("mecontentement", 92.0);
    PO::revolution(&mut g, "33", "peuple", None);
    let x = g.pending_ev.iter().find(|x| x.at("ev") == "revolution").unwrap();
    // la répression échoue : on remplace sa chance par zéro
    x.at("choices").at(0).at("fx").at("politique").set("chance", 0.0);
    let r = PO::commande(&mut g, "33", &dict! {"sub" => "revolution", "choix" => "reprimer"});
    assert!(r.getb("ok"), "{r}");
    // le camp rebelle porte la république, tient une part des places, en guerre avec son pays
    assert!(g.factions.has("33r") && g.factions.at("33r").atb("alive"));
    assert_eq!(pol(&g, "33r").at("regime"), "republique");
    assert_eq!(pol(&g, "33").at("regime"), "absolue");
    let (a, b) = (g.owned("33").len(), g.owned("33r").len());
    assert!(b >= 2 && a >= 1 && a + b == avant, "{a} + {b} != {avant}");
    assert!(g.at_war("33", "33r"));
    assert_eq!(g.capital_of("33r"), pol(&g, "33r").at("capitale"));
    assert!(g.fname("33r").contains("républicains"));
    assert!(g.ais.contains_key("33r"));
    let vue = V::player_state(&mut g, 0);
    let fr = vue.at("factions").iter().find(|f| f.at("code") == "33r").unwrap();
    assert_eq!(fr.at("politique").at("rebelle").at("de"), "33");
    assert_eq!(vue.at("me").at("politique").at("rebelles"), "33r");
    // le joueur prend la tête des révolutionnaires
    let r = PO::commande(&mut g, "33", &dict! {"sub" => "revolution", "choix" => "rejoindre"});
    assert!(r.getb("ok"), "{r}");
    assert_eq!(g.player, "33r");
    assert!(g.ais.contains_key("33") && !g.ais.contains_key("33r"));
    // la guerre civile se joue, se sauve et se recharge (le camp rebelle réinscrit)
    jouer_mois(&mut g, 3);
    let mut h = recharger(&mut g);
    assert_eq!(h.player, "33r");
    assert_eq!(pol(&h, "33r").at("rebelle_de"), "33");
    jouer_mois(&mut h, 3);
    let _ = V::player_state(&mut h, 0);
}

#[test]
fn les_rebelles_sans_place_capitulent() {
    let mut g = partie_avec("24", "1700", 5, "normal");
    agrandir(&mut g, "33", 12);
    let r = PO::guerre_civile(&mut g, "33", "peuple", "republique").expect("pas de guerre civile");
    let siege = pol(&g, "33r").at("capitale");
    g.nodes.at(&siege).set("owner", "33"); // le pays reprend la capitale des rebelles
    for _ in 0..2 {
        play_month(&mut g);
    }
    assert!(!g.factions.at(&r).atb("alive"));
    assert!(g.owned(&r).is_empty());
}

#[test]
fn nommer_et_renvoyer_un_ministre() {
    let mut g = partie_avec("33", "1790", 6, "normal");
    let p = pol(&g, "33");
    let m = p.at("cabinet").at("finances");
    let livres = |g: &Game| g.factions.at("33").at("mods").get_or("livres", 0.0).f();
    let avant = livres(&g);
    let r = PO::commande(&mut g, "33", &dict! {"sub" => "renvoyer", "poste" => "finances"});
    assert!(r.getb("ok"), "{r}");
    assert!(p.at("cabinet").at("finances").is_none());
    let classe = if m.at("traits").has("populaire") { "peuple" } else { "noblesse" };
    assert!((p.at("choc").atf(classe) - 6.0).abs() < 1e-6); // monarchie constitutionnelle : renvoyer coûte 6
    let sans = livres(&g);
    assert!(sans < avant - 0.005, "{avant} → {sans}");
    let c = p.at("candidats").at(0);
    let r = PO::commande(&mut g, "33", &dict! {"sub" => "nommer", "poste" => "finances", "ministre" => c.at("id")});
    assert!(r.getb("ok"), "{r}");
    assert_eq!(p.at("cabinet").at("finances").at("id"), c.at("id"));
    assert_eq!(p.at("candidats").len(), R::CANDIDATS as usize - 1);
    let k = c.atf("competence") * 0.012;
    assert!((livres(&g) - sans - k).abs() < 0.035, "{} {}", livres(&g) - sans, k);
    assert!(!PO::commande(&mut g, "33", &dict! {"sub" => "nommer", "poste" => "finances", "ministre" => "x"}).getb("ok"));
}

#[test]
fn elections_en_republique() {
    let mut g = partie_avec("33", "1700", 7, "normal");
    let p = pol(&g, "33");
    p.set("regime", "republique");
    p.set("mandat", g.t + 1.0);
    let chef = p.at("cabinet").at("chef").at("id");
    jouer_mois(&mut g, 1);
    assert_ne!(p.at("cabinet").at("chef").at("id"), chef);
    assert!(g.events.iter().any(|e| e.ats("text").starts_with("Élections")));
    assert!(p.atf("mandat") > g.t + 40.0 * 30.0);
}

#[test]
fn sauvegarde_et_ancienne_sauvegarde() {
    let mut g = partie_avec("33", "1700", 8, "normal");
    PO::commande(&mut g, "33", &dict! {"sub" => "impot", "classe" => "peuple", "value" => 0.8});
    jouer_mois(&mut g, 2);
    let avant = json::dumps(&pol(&g, "33"));
    let h = recharger(&mut g);
    assert_eq!(json::dumps(&pol(&h, "33")), avant);
    // une sauvegarde d'avant la politique : le régime de l'époque, l'impôt unique réparti sur les deux classes
    let d = V::to_dict(&mut g);
    let d = json::loads(&json::dumps(&d)).unwrap();
    for f in d.at("factions").values() {
        f.pop("politique");
        f.set("tax", 0.6);
    }
    let h = V::from_dict(GEO(), &d).unwrap();
    assert_eq!(pol(&h, "24").at("regime"), "absolue");
    assert_eq!(pol(&h, "24").at("classes").at("peuple").atf("impot"), 0.6);
    assert_eq!(pol(&h, "24").at("classes").at("noblesse").atf("impot"), 0.6);
}

#[test]
fn revolution_historique_1789() {
    // une partie de 1700 arrivée en juillet 1789 : les départements encore sous la monarchie absolue, dont le peuple
    // gronde, font face à la révolution (le joueur décide, les IA aussitôt)
    let mut g = partie_avec("33", "1700", 9, "normal");
    for c in ["33", "24"] {
        pol(&g, c).at("classes").at("peuple").set("mecontentement", 55.0);
    }
    PO::mois(&mut g, conquete::engine::Date::new(1789, 7, 20));
    assert!(g.ev_done.has("pol1789"));
    assert!(g.pending_ev.iter().any(|x| x.at("ev") == "revolution"));
    assert!(pol(&g, "24").atf("revolutions") >= 1.0 && pol(&g, "24").at("revolution").is_none()); // (l'IA a choisi)
    assert_eq!(pol(&g, "40").get_or("revolutions", 0), 0); // (un peuple calme : pas de révolution)
}

#[test]
fn une_guerre_civile_entre_ia_se_joue() {
    // la Gironde (IA) se déchire ; les deux camps se font la guerre deux ans, sauvegarde comprise
    let mut g = partie_avec("24", "1790", 10, "normal");
    agrandir(&mut g, "33", 10);
    PO::guerre_civile(&mut g, "33", "noblesse", "absolue").expect("pas de guerre civile");
    assert!(g.fname("33r").contains("royalistes"));
    for m in 0..24 {
        play_month(&mut g);
        if m == 11 {
            g = recharger(&mut g);
        }
    }
    let _ = V::player_state(&mut g, 0);
}

/// Banc : des parties entre IA sur 30 ans, combien de révolutions et de guerres civiles ?
/// `cargo test --release -p conquete --test politique banc -- --ignored --nocapture` (CONQUETE_BANC_GEO=5 : l'Europe ;
/// CONQUETE_BANC_ANNEES, CONQUETE_BANC_PARTIES ; CONQUETE_BANC_GUERRE_CIVILE=RU : ce camp se déchire au départ).
#[test]
#[ignore]
fn banc_revolutions() {
    let v: i64 = std::env::var("CONQUETE_BANC_GEO").ok().and_then(|s| s.parse().ok()).unwrap_or(2);
    let annees: i64 = std::env::var("CONQUETE_BANC_ANNEES").ok().and_then(|s| s.parse().ok()).unwrap_or(30);
    let parties: i64 = std::env::var("CONQUETE_BANC_PARTIES").ok().and_then(|s| s.parse().ok()).unwrap_or(3);
    let carte = geo(v);
    let joueur = if v == 2 { "33" } else { "FR" };
    for (seed, epoque) in (1..=parties).map(|s| (s, if s % 2 == 1 { "1700" } else { "1790" })) {
        let mut g = Game::new(carte.clone(), joueur, &Val::from("normal"), &Val::from(seed), &Val::from(epoque));
        let ai = conquete::ai::AI::new(&g, joueur);
        g.ais.insert(joueur.to_string(), Some(ai));
        if let Ok(c) = std::env::var("CONQUETE_BANC_GUERRE_CIVILE") {
            PO::guerre_civile(&mut g, &c, "peuple", "republique").expect("pas de guerre civile"); // (l'essai de robustesse)
        }
        for _ in 0..annees * 12 {
            play_month(&mut g);
            if g.over.truthy() {
                break;
            }
        }
        let (mut rev, mut gc, mut pic) = (0, 0, [0.0f64, 0.0]);
        let mut regimes = std::collections::BTreeMap::new();
        for f in g.factions.values() {
            let p = f.at("politique");
            rev += p.get_or("revolutions", 0).i();
            gc += p.get_or("guerres_civiles", 0).i();
            if f.atb("alive") {
                *regimes.entry(p.ats("regime")).or_insert(0) += 1;
                for (i, c) in ["noblesse", "peuple"].iter().enumerate() {
                    pic[i] = pic[i].max(p.at("classes").at(*c).atf("mecontentement"));
                }
            }
        }
        let textes: Vec<String> = g.events.iter().filter(|e| e.ats("text").contains("évolution") || e.ats("text").contains("Guerre civile")).map(|e| format!("{} {}", e.at("date"), e.at("text"))).collect();
        eprintln!("géographie {v}, {epoque}, graine {seed}, {} : {rev} révolutions, {gc} guerres civiles, {} camps ; régimes {regimes:?} ; \
                   mécontentement le plus haut à la fin : noblesse {:.0}, peuple {:.0}", g.date_str(&Val::None), g.factions.len(), pic[0], pic[1]);
        for t in textes.iter().rev().take(12) {
            eprintln!("    {t}");
        }
    }
}
