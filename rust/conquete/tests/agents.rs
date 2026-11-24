//! Banc d'essai des agents (SPEC-POLITIQUE, module 4) : recrutement (bâtiment, plafond), espion caché qui sabote des
//! remparts, duel, prêtre qui apaise, diplomate posté, agent pris (incident diplomatique), sauvegarde et rechargement,
//! IA qui recrute et mène une mission. Sur la carte d'Aquitaine (la Gironde contre les Landes).
#![allow(non_snake_case)]

mod fabrique_campagne;

use conquete::cities as CT;
use conquete::diplomacy as D;
use conquete::engine::agents as AG;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::views as V;
use conquete::dict;
use fabrique_campagne::{jouer_mois, partie, GEO};

const FOE: &str = "40";

fn capitale(g: &Game, code: &str) -> i64 {
    g.capital_of(code).i()
}

fn riche(g: &Game, code: &str) {
    g.factions.at(code).at("res").set("livres", 100000);
}

/// Un agent du camp posé dans la place, prêt à agir.
fn agent(g: &mut Game, code: &str, typ: &str, nid: i64) -> Val {
    AG::nouvel_agent(g, code, typ, nid)
}

#[test]
fn recrutement_par_les_batiments_avec_un_plafond() {
    let mut g = partie();
    let p = g.player.clone();
    riche(&g, &p);
    let cap = capitale(&g, &p);
    let n = g.nodes.at(cap);
    n.set("slots", dict! {});
    // sans église : pas de prêtre ; un agent inconnu, une place étrangère : refusés
    let (ok, why) = AG::recruter(&mut g, &p, cap, &Val::from("pretre"));
    assert!(!ok && why.contains("Il faut"), "{why}");
    assert!(!AG::recruter(&mut g, &p, cap, &Val::from("moine")).0);
    let chez_lui = capitale(&g, FOE);
    assert!(!AG::recruter(&mut g, &p, chez_lui, &Val::from("espion")).0);
    // une paroisse : un prêtre (plafond 1), le second refusé ; un séminaire (niveau 2) ouvre une place de plus
    CT::slots(&n).set("eglise", 1);
    assert_eq!(AG::plafond(&g, &p, "pretre"), 1);
    let (ok, msg) = AG::recruter(&mut g, &p, cap, &Val::from("pretre"));
    assert!(ok, "{msg}");
    assert_eq!(n.at("queue").at(-1).at("kind"), "agent");
    let (ok, why) = AG::recruter(&mut g, &p, cap, &Val::from("pretre"));
    assert!(!ok && why.contains("Plafond"), "{why}");
    CT::slots(&n).set("eglise", 2);
    assert_eq!(AG::plafond(&g, &p, "pretre"), 2);
    assert!(AG::recruter(&mut g, &p, cap, &Val::from("pretre")).0);
    // la capitale forme un diplomate ; la formation finie, l'agent est dans la place
    assert!(AG::recruter(&mut g, &p, cap, &Val::from("diplomate")).0);
    for q in n.at("queue").iter() {
        q.set("left", 0.0001);
    }
    g.update_queues(0.01);
    let mes = AG::agents_de(&g, &p);
    assert_eq!(mes.len(), 3);
    assert!(mes.iter().all(|a| a.at("at_node") == cap));
    // l'entretien se paie chaque mois
    let avant = g.factions.at(&p).at("res").atf("livres");
    AG::mois(&mut g);
    let du = 2.0 * R::AGENTS().at("pretre").atf("entretien") + R::AGENTS().at("diplomate").atf("entretien");
    assert!((avant - g.factions.at(&p).at("res").atf("livres") - du).abs() < 1e-6);
}

#[test]
fn un_espion_cache_sabote_des_remparts() {
    let mut g = partie();
    let p = g.player.clone();
    D::declare_war(&mut g, FOE, &p, true);
    let cible = capitale(&g, FOE);
    g.nodes.at(cible).set("fort", 1); // (des remparts faibles : la place ne démasque pas)
    let fort0 = g.nodes.at(cible).ati("fort");
    // l'espion part de chez nous, caché, et va jusque dans la place ennemie
    let chez_moi = capitale(&g, &p);
    let a = agent(&mut g, &p, "espion", chez_moi);
    assert!(a.atb("cache"));
    let (ok, msg) = AG::deplacer(&mut g, &p, &a.at("id"), &Val::from(cible));
    assert!(ok, "{msg}");
    for _ in 0..400 {
        if !a.atb("chemin") {
            break;
        }
        AG::tick(&mut g, 0.25);
    }
    assert_eq!(a.at("at_node"), cible);
    // l'ennemi ne le voit pas (ni la vue du joueur ennemi)
    let espions_ennemis = g.agents.values().into_iter().filter(|b| b.at("owner") == FOE).count();
    assert_eq!(espions_ennemis, 0);
    // (ses cavaliers le verraient : les armées landaises sont en campagne ailleurs)
    let pres: Vec<Val> = g.armies.values().into_iter().filter(|ar| ar.at("owner") == FOE).collect();
    for ar in &pres {
        g.armies.del(&ar.at("id"));
    }
    assert!(!AG::detecte(&g, &a, FOE));
    // la chance est connue avant l'ordre
    let (ch, _) = AG::verifier(&g, &a, &Val::from("saboter_remparts"), &Val::from(cible)).unwrap();
    assert!(ch > 0.0 && ch < 1.0);
    let mut fait = false;
    for _ in 0..60 {
        let a = agent(&mut g, &p, "espion", cible);
        let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("saboter_remparts"), &Val::from(cible));
        assert!(ok, "{msg}");
        if g.nodes.at(cible).ati("fort") < fort0 {
            fait = true;
            assert!(msg.contains("Sabotage"), "{msg}");
            // une mission par tour
            if g.agents.has(a.at("id")) {
                assert!(AG::verifier(&g, &a, &Val::from("espionner"), &Val::from(cible)).is_err());
            }
            break;
        }
    }
    assert!(fait, "le sabotage n'a jamais réussi");
    // hors de la guerre, plus de sabotage
    let paix = capitale(&g, "24");
    let b = agent(&mut g, &p, "espion", paix);
    assert!(AG::verifier(&g, &b, &Val::from("saboter_remparts"), &Val::from(paix)).is_err());
}

#[test]
fn un_duel_entre_gentilshommes() {
    let mut g = partie();
    let p = g.player.clone();
    let lieu = capitale(&g, &p);
    let mut issue = String::new();
    for _ in 0..30 {
        let a = agent(&mut g, &p, "gentilhomme", lieu);
        let b = agent(&mut g, FOE, "gentilhomme", lieu);
        let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("duel"), &b.at("id"));
        assert!(ok, "{msg}");
        assert!(msg.starts_with("Duel"), "{msg}");
        // l'un des deux est mort ou blessé
        let blesse = |x: &Val| g.agents.has(x.at("id")) && x.atf("repos") > g.t + 31.0;
        let mort = |x: &Val| !g.agents.has(x.at("id"));
        assert!(mort(&a) || mort(&b) || blesse(&a) || blesse(&b), "{msg}");
        if mort(&b) || blesse(&b) {
            issue = msg;
            assert!(g.agents.get(a.at("id")).truthy() && a.ati("xp") >= 1);
            break;
        }
        g.agents = dict! {};
    }
    assert!(!issue.is_empty(), "le gentilhomme n'a jamais gagné");
    // pas de duel contre un prêtre
    let c = agent(&mut g, &p, "gentilhomme", lieu);
    let d = agent(&mut g, FOE, "pretre", lieu);
    assert!(AG::verifier(&g, &c, &Val::from("duel"), &d.at("id")).is_err());
}

#[test]
fn un_pretre_apaise_une_place_agitee() {
    let mut g = partie();
    let p = g.player.clone();
    let lieu = capitale(&g, &p);
    let n = g.nodes.at(lieu);
    n.set("stab", 0.3);
    let a = agent(&mut g, &p, "pretre", lieu);
    // chez un autre, pas de poste
    assert!(AG::verifier(&g, &a, &Val::from("apaiser"), &Val::from(capitale(&g, FOE))).is_err());
    let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("apaiser"), &Val::from(lieu));
    assert!(ok, "{msg}");
    assert_eq!(a.at("mission").at("type"), "apaiser");
    AG::mois(&mut g);
    AG::mois(&mut g);
    assert!(n.atf("stab") >= 0.3 + 2.0 * R::AGENT_APAISE - 1e-9, "{}", n.atf("stab"));
    assert_eq!(a.at("mission").at("tours"), 2i64);
    // un second prêtre n'y a pas de poste ; annuler libère le premier
    let b = agent(&mut g, &p, "pretre", lieu);
    assert!(AG::verifier(&g, &b, &Val::from("apaiser"), &Val::from(lieu)).is_err());
    assert!(AG::annuler(&mut g, &p, &a.at("id")).0);
    assert!(a.at("mission").is_none());
}

#[test]
fn un_diplomate_poste_dans_une_capitale_etrangere() {
    let mut g = partie();
    let p = g.player.clone();
    let cap = capitale(&g, FOE);
    let a = agent(&mut g, &p, "diplomate", cap);
    assert!(!AG::diplomate_present(&g, &p, FOE));
    let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("ambassade"), &Val::from(cap));
    assert!(ok, "{msg}");
    assert!(AG::diplomate_present(&g, &p, FOE));
    assert!(!AG::diplomate_present(&g, &p, "24"));
    let r0 = g.factions.at(FOE).at("rel").get_or(p.as_str(), 0).f();
    AG::mois(&mut g);
    assert!(g.factions.at(FOE).at("rel").at(p.as_str()).f() > r0);
    // la guerre ferme l'ambassade
    D::declare_war(&mut g, FOE, &p, true);
    AG::mois(&mut g);
    assert!(!AG::diplomate_present(&g, &p, FOE));
}

#[test]
fn un_agent_pris_cause_un_incident() {
    let mut g = partie();
    let p = g.player.clone();
    let cap = capitale(&g, FOE);
    g.nodes.at(cap).set("fort", 0);
    for _ in 0..300 {
        g.factions.at(FOE).at("rel").set(p.as_str(), 0);
        let a = agent(&mut g, &p, "espion", cap);
        let (ok, msg) = AG::ordonner(&mut g, &p, &a.at("id"), &Val::from("inciter"), &Val::from(cap));
        assert!(ok, "{msg}");
        if msg.contains("pris") {
            assert!(!g.agents.has(a.at("id")));
            assert_eq!(g.factions.at(FOE).at("rel").at(p.as_str()).f(), -(R::AGENT_REL as f64));
            assert!(g.events.iter().any(|e| e.ats("text").contains("a été pris")));
            return;
        }
        g.agents = dict! {};
    }
    panic!("l'espion n'a jamais été pris");
}

#[test]
fn les_agents_se_sauvegardent() {
    let mut g = partie();
    let p = g.player.clone();
    let (chez_moi, chez_lui) = (capitale(&g, &p), capitale(&g, FOE));
    let a = agent(&mut g, &p, "espion", chez_moi);
    AG::deplacer(&mut g, &p, &a.at("id"), &Val::from(chez_lui));
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let mut h = V::from_dict(GEO(), &d).unwrap();
    assert_eq!(json::dumps(&h.agents), json::dumps(&g.agents));
    // la vue : l'agent du joueur, avec ses missions possibles ; les plafonds du camp
    let vue = V::player_state(&mut h, 0);
    assert_eq!(vue.at("agents").len(), 1);
    assert!(vue.at("agents_camp").at("espion").at("plafond") >= 1i64);
    // un espion ennemi caché n'apparaît pas dans la vue
    let cachee = capitale(&h, "24");
    AG::nouvel_agent(&mut h, "24", "espion", cachee);
    assert_eq!(V::player_state(&mut h, 0).at("agents").len(), 1);
    // une sauvegarde d'avant les agents se charge
    d.del("agents");
    let k = V::from_dict(GEO(), &d).unwrap();
    assert!(!k.agents.truthy());
}

#[test]
fn l_ia_recrute_et_mene_une_mission() {
    let mut g = partie();
    // les Landes ont un collège et de quoi payer : un gentilhomme, posté à l'université
    let cap = capitale(&g, FOE);
    CT::slots(&g.nodes.at(cap)).set("universite", 1);
    riche(&g, FOE);
    jouer_mois(&mut g, 3);
    let siens = AG::agents_de(&g, FOE);
    assert!(!siens.is_empty(), "l'IA n'a recruté personne");
    assert!(
        g.agents.values().iter().any(|a| a.at("owner") == FOE && a.get("mission").is_dict()),
        "aucun agent de l'IA en poste : {:?}",
        siens.iter().map(|a| (a.ats("type"), a.get("mission"))).collect::<Vec<_>>()
    );
}
