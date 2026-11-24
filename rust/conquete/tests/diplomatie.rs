//! La diplomatie profonde (SPEC-POLITIQUE, module 6), sur l'Aquitaine (géographie 2, cinq départements) : caractère
//! stable, mémoire qui s'efface, attitude et ses raisons, propositions composées (acceptée, refusée, contre-proposée),
//! diplomate présent, ultimatum, appel aux armes, protectorat, sauvegarde. Les IA sont retirées : on joue leurs réponses.

use conquete::diplomacy as D;
use conquete::engine::memoire as MEM;
use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::views as V;
use conquete::{dict, list};
use std::rc::Rc;
use std::sync::Mutex;

static VERROU: Mutex<()> = Mutex::new(());

fn carte() -> Rc<GeoMap> {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    std::env::set_var("WEB_CONQUETE_NOLOG", "1");
    Rc::new(GeoMap::new(2))
}

/// Une partie de 1790 où le joueur tient la Gironde, sans IA.
fn partie(geo: &Rc<GeoMap>, graine: i64) -> Game {
    let mut g = Game::new(geo.clone(), "33", &Val::from("normal"), &Val::from(graine), &Val::from("1790"));
    g.ais.clear();
    g
}

fn raisons(g: &Game, a: &str, b: &str) -> Vec<String> {
    MEM::vue(g, a, b).at("raisons").iter().map(|r| r.ats("texte")).collect()
}

/// Une place de `code` qui n'est pas sa capitale.
fn place(g: &Game, code: &str) -> i64 {
    g.owned_nodes(code).iter().map(|n| n.ati("id")).find(|&n| !g.geo.nodes.at(n).at_is("type", "capitale")).unwrap()
}

#[test]
fn le_caractere_est_stable_et_tire_selon_le_pays() {
    let geo = carte();
    let (mut g, h) = (partie(&geo, 7), partie(&geo, 7));
    for (c, f) in g.factions.items() {
        let car = f.ats("caractere");
        assert!(R::CARACTERES().has(&car), "{c} : {car}");
        assert_eq!(car, h.factions.at(&c).ats("caractere"), "même graine, même caractère");
        assert_eq!(car, MEM::tirer_caractere(7, c.s()));
    }
    // la sauvegarde le garde ; une sauvegarde d'avant le retrouve
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    for f in d.at("factions").values() {
        f.pop("caractere");
    }
    let r = V::from_dict(geo.clone(), &d).unwrap();
    for (c, f) in g.factions.items() {
        assert_eq!(r.factions.at(&c).ats("caractere"), f.ats("caractere"));
    }
    // sur l'Europe, l'histoire pèse : la Prusse est agressive, la Grande-Bretagne marchande, presque toujours
    let (mut pr, mut gb) = (0, 0);
    for s in 0..40 {
        pr += (MEM::tirer_caractere(s, "PR") == "agressif") as i32;
        gb += (MEM::tirer_caractere(s, "GB") == "marchand") as i32;
    }
    assert!(pr >= 30 && gb >= 30, "Prusse agressive {pr}/40, Grande-Bretagne marchande {gb}/40");
    // et le caractère pèse : un marchand vaut plus l'argent qu'un agressif
    assert!(R::CARACTERES().at("marchand").atf("argent") > R::CARACTERES().at("agressif").atf("argent"));
}

#[test]
fn un_traite_rompu_laisse_une_memoire_qui_s_efface() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    D::make_alliance(&mut g, "33", "24");
    let avant = MEM::valeur(&g, "24", "33");
    let (ok, _) = D::act(&mut g, "33", &Val::from("24"), &Val::from("rompre"), &Val::from(0), &Val::None, &Val::None);
    assert_eq!(ok, Some(true));
    let m = MEM::somme(&g, "24", "33");
    assert!(m <= -40.0, "souvenir de la trahison : {m}");
    assert!(MEM::valeur(&g, "24", "33") < avant - 40.0);
    assert!(raisons(&g, "24", "33").iter().any(|t| t.starts_with("A rompu notre alliance")));
    // cinq ans plus tard, la moitié ; quinze ans, presque rien (et le mois le purge)
    g.t += 1825.0;
    let m5 = MEM::somme(&g, "24", "33");
    assert!((m5 - m / 2.0).abs() < 0.5, "{m5} contre {m}");
    g.t += 3650.0 * 5.0;
    MEM::purger(&g);
    assert_eq!(MEM::somme(&g, "24", "33"), 0.0);
    assert!(!raisons(&g, "24", "33").iter().any(|t| t.starts_with("A rompu")));
}

#[test]
fn l_attitude_liste_ses_raisons() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    g.factions.at("24").at("rel").set("33", 20);
    D::declare_war(&mut g, "33", "24", false);
    g.factions.at("24").set("diplomates", list!["33"]); // (un diplomate du 24 chez le 33 ne compte pas pour le 24)
    g.factions.at("33").set("diplomates", list!["24"]);
    let v = MEM::vue(&g, "24", "33");
    let r = v.at("raisons");
    let textes: Vec<String> = r.iter().map(|x| x.ats("texte")).collect();
    assert_eq!(textes[0], "Relations");
    assert!(textes.iter().any(|t| t.starts_with("Nous a déclaré la guerre")), "{textes:?}");
    assert!(textes.contains(&"Un diplomate à notre cour".to_string()));
    let somme: i64 = r.iter().map(|x| x.ati("valeur")).sum();
    assert!((somme.clamp(-100, 100) - v.ati("valeur")).abs() <= 2, "{somme} contre {}", v.at("valeur"));
    // la vue de la partie la montre, avec le caractère
    let mut g = g;
    let vue = V::player_state(&mut g, 0);
    let f24 = vue.at("factions").iter().find(|f| f.at_is("code", "24")).unwrap();
    assert!(f24.at("attitude").at("raisons").len() >= 3 && f24.at("caractere").is_str());
    assert!(V::rules_payload_carte(2).at("CLAUSES").has("tribut") && V::rules_payload_carte(2).at("CARACTERES").has("loyal"));
}

#[test]
fn une_proposition_composee_acceptee_refusee_contre_proposee() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    let f = g.factions.at("33");
    f.at("res").set("livres", 100000);
    // acceptée : de l'argent pour ses cartes
    let cl = dict! {"donner" => list![dict! {"type" => "argent", "montant" => 3000}], "recevoir" => list![dict! {"type" => "cartes"}]};
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("24"), &cl);
    assert_eq!(ok, Some(true), "{msg}");
    assert_eq!(f.at("res").ati("livres"), 97000);
    assert!(f.at("intel").len() > 0, "les cartes montrent ses villes");
    // une région pour rien : refusée, avec une contre-proposition en argent
    let nid = place(&g, "24");
    let cl = dict! {"donner" => list![], "recevoir" => list![dict! {"type" => "region", "node" => nid}]};
    let (ok, msg) = D::commande(&mut g, "33", &dict! {"sub" => "proposer", "cible" => "24", "clauses" => &cl});
    assert_eq!(ok, Some(false));
    assert!(msg.contains("en fait une autre"), "{msg}");
    let p = g.proposals.iter().find(|p| p.at_is("frm", "24")).expect("contre-proposition");
    assert!(p.atb("contre_proposition") && p.at_is("action", "proposition"));
    assert!(p.at("clauses").at("donner").iter().any(|c| c.at_is("type", "region")));
    assert!(p.at("clauses").at("recevoir").iter().any(|c| c.at_is("type", "argent")));
    let vue = V::player_state(&mut g, 0);
    let pv = vue.at("proposals").iter().find(|x| x.at("id") == p.at("id")).unwrap();
    assert!(pv.at("texte").s().contains("Il donne") && pv.at("clauses").at("donner").at(0).at("texte").is_str());
    // le joueur l'accepte : la place change de maître
    let (ok, msg) = D::commande(&mut g, "33", &dict! {"sub" => "repondre", "id" => p.at("id"), "accepte" => true});
    assert_eq!(ok, Some(true), "{msg}");
    assert!(g.nodes.at(nid).at_is("owner", "33"));
    assert!(raisons(&g, "24", "33").iter().any(|t| t.starts_with("Accord conclu")));
    // sans le sou : une région pour rien est refusée tout court
    f.at("res").set("livres", 0);
    f.at("income").set("livres", 0.0);
    let nid = place(&g, "24");
    let cl = dict! {"recevoir" => list![dict! {"type" => "region", "node" => nid}]};
    let n = g.proposals.len();
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("24"), &cl);
    assert_eq!(ok, Some(false));
    assert!(msg.contains("refuse"), "{msg}");
    assert_eq!(g.proposals.len(), n);
    // une capitale ne se cède pas ; une clause inconnue non plus
    let cap = g.capital_of("24").i();
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("24"), &dict! {"recevoir" => list![dict! {"type" => "region", "node" => cap}]});
    assert!(ok == Some(false) && msg.contains("capitale"), "{msg}");
    let (ok, _) = D::proposer(&mut g, "33", &Val::from("24"), &dict! {"recevoir" => list![dict! {"type" => "lune"}]});
    assert_eq!(ok, Some(false));
    // l'ancienne commande marche toujours
    let (ok, _) = D::act(&mut g, "33", &Val::from("24"), &Val::from("cadeau"), &Val::from(0), &Val::None, &Val::None);
    assert_eq!(ok, Some(false));
}

#[test]
fn un_diplomate_present_fait_accepter() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    let cl = dict! {"donner" => list![dict! {"type" => "commerce"}]};
    // une relation qui laisse le commerce juste en dessous du seuil (marge de −50 livres)
    let v = D::valeur_clause(&g, "24", "33", &cl.at("donner").at(0), false);
    let rel = g.factions.at("24").at("rel");
    rel.set("33", rel.atf("33") - (v + 50.0) / 10.0);
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("24"), &cl);
    assert_eq!(ok, Some(false), "{msg}");
    g.factions.at("33").set("diplomates", list!["24"]);
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("24"), &cl);
    assert_eq!(ok, Some(true), "{msg}");
    assert!(g.factions.at("24").at("trade").getb("33"));
}

#[test]
fn un_ultimatum_refuse_donne_un_casus_belli() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    // du joueur à une IA de même force : refusé
    let e = dict! {"type" => "tribut", "montant" => 50, "tours" => 12};
    let (ok, msg) = D::commande(&mut g, "33", &dict! {"sub" => "ultimatum", "cible" => "24", "exigence" => &e});
    assert_eq!(ok, Some(false), "{msg}");
    assert!(conquete::engine::commerce::casus_belli(&g, "33", "24"));
    assert!(raisons(&g, "24", "33").iter().any(|t| t.starts_with("Nous a adressé un ultimatum")));
    // d'une IA au joueur : il le reçoit ; refusé, l'IA tient un casus belli
    let (ok, _) = D::ultimatum(&mut g, "40", &Val::from("33"), &e);
    assert_eq!(ok, None);
    let p = g.proposals.iter().find(|p| p.at_is("action", "ultimatum")).unwrap();
    let (ok, _) = D::answer(&mut g, &p.at("id"), false);
    assert!(ok && conquete::engine::commerce::casus_belli(&g, "40", "33"));
    // accepté, le tribut se paie chaque mois
    D::ultimatum(&mut g, "47", &Val::from("33"), &e);
    let p = g.proposals.iter().find(|p| p.at_is("action", "ultimatum")).unwrap();
    assert!(D::answer(&mut g, &p.at("id"), true).0);
    let (a, b) = (g.factions.at("33").at("res").atf("livres"), g.factions.at("47").at("res").atf("livres"));
    D::mois(&mut g);
    assert_eq!(g.factions.at("33").at("res").atf("livres"), a - 50.0);
    assert_eq!(g.factions.at("47").at("res").atf("livres"), b + 50.0);
    assert_eq!(g.factions.at("33").at("tributs").at(0).ati("reste"), 11);
}

#[test]
fn un_appel_aux_armes_refuse_coute_de_l_attitude() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    D::make_alliance(&mut g, "24", "33");
    g.factions.at("24").at("rel").set("33", 70);
    // le 40 attaque notre allié : il nous appelle (le joueur n'entre plus en guerre tout seul)
    D::declare_war(&mut g, "40", "24", false);
    assert!(!g.at_war("33", "40"));
    let p = g.proposals.iter().find(|p| p.at_is("action", "appel")).expect("appel aux armes");
    assert_eq!(p.ats("contre"), "40");
    let avant = MEM::valeur(&g, "24", "33");
    let (ok, _) = D::answer(&mut g, &p.at("id"), false);
    assert!(ok);
    assert!(MEM::valeur(&g, "24", "33") <= avant - 25.0);
    assert!(raisons(&g, "24", "33").iter().any(|t| t.starts_with("A refusé notre appel aux armes")));
    assert_eq!(g.status("24", "33"), "alliance", "une attitude encore bonne garde l'alliance");
    // un second refus la rompt
    g.factions.at("24").at("rel").set("33", -20);
    D::appel(&mut g, "24", &Val::from("33"), &Val::from("40"));
    let p = g.proposals.iter().find(|p| p.at_is("action", "appel")).unwrap();
    D::answer(&mut g, &p.at("id"), false);
    assert_eq!(g.status("24", "33"), "paix");
    // une IA alliée qui nous aime répond à notre appel
    D::make_alliance(&mut g, "33", "64");
    g.factions.at("64").at("rel").set("33", 60);
    D::declare_war(&mut g, "33", "47", false);
    let (ok, msg) = D::appel(&mut g, "33", &Val::from("64"), &Val::from("47"));
    assert_eq!(ok, Some(true), "{msg}");
    assert!(g.at_war("64", "47"));
}

#[test]
fn un_protectorat_paie_et_suit_les_guerres() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    D::make_vassal(&mut g, "40", "24");
    g.compute_income();
    assert!(g.factions.at("40").atf("_tribute") > 0.0, "il paie son tribut");
    // il suit la guerre de son protecteur, et la paix
    D::declare_war(&mut g, "24", "47", false);
    assert!(g.at_war("40", "47"));
    // pas de diplomatie propre
    let (ok, msg) = D::act(&mut g, "40", &Val::from("64"), &Val::from("commerce"), &Val::from(0), &Val::None, &Val::None);
    assert!(ok == Some(false) && msg.contains("protectorat"), "{msg}");
    let (ok, msg) = D::proposer(&mut g, "33", &Val::from("40"), &dict! {"donner" => list![dict! {"type" => "cartes"}]});
    assert!(ok == Some(false) && msg.contains("protecteur"), "{msg}");
    D::make_peace(&mut g, "24", "47");
    assert!(!g.at_war("40", "47"));
    // l'indépendance se demande à son protecteur ; rendue, il est libre
    let cl = dict! {"recevoir" => list![dict! {"type" => "independance"}]};
    assert!(D::lire_clauses(&g, "40", "24", &cl).is_ok());
    D::liberer(&mut g, "40");
    assert!(!g.factions.at("40").atb("overlord"));
    // le joueur peut placer une IA sous son protectorat par une clause
    let cl = dict! {"recevoir" => list![dict! {"type" => "protectorat"}]};
    assert!(D::lire_clauses(&g, "33", "64", &cl).is_ok());
}

#[test]
fn sauvegarde_et_rechargement() {
    let geo = carte();
    let mut g = partie(&geo, 3);
    D::make_alliance(&mut g, "33", "24");
    D::act(&mut g, "33", &Val::from("24"), &Val::from("rompre"), &Val::from(0), &Val::None, &Val::None);
    let e = dict! {"type" => "tribut", "montant" => 20, "tours" => 6};
    D::ultimatum(&mut g, "40", &Val::from("33"), &e);
    D::proposer(&mut g, "47", &Val::from("33"), &dict! {"donner" => list![dict! {"type" => "cartes"}], "recevoir" => list![dict! {"type" => "argent", "montant" => 10}]});
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let mut h = V::from_dict(geo.clone(), &d).unwrap();
    assert_eq!(json::dumps(&MEM::vue(&h, "24", "33")), json::dumps(&MEM::vue(&g, "24", "33")));
    assert_eq!(h.proposals.len(), 2);
    let p = h.proposals.iter().find(|p| p.at_is("action", "proposition")).unwrap();
    let (ok, msg) = D::answer(&mut h, &p.at("id"), true);
    assert!(ok, "{msg}");
    assert!(h.factions.at("33").at("intel").len() > 0);
    let p = h.proposals.iter().find(|p| p.at_is("action", "ultimatum")).unwrap();
    assert!(D::answer(&mut h, &p.at("id"), true).0);
    let d = json::loads(&json::dumps(&V::to_dict(&mut h))).unwrap();
    let r = V::from_dict(geo, &d).unwrap();
    assert_eq!(r.factions.at("33").at("tributs").at(0).ati("montant"), 20);
}
