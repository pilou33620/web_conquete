//! Banc d'essai de la marine (SPEC-EMPIRE, module 2) : construction d'une flotte, mouvement sur la mer, armée
//! embarquée puis débarquée, blocus, bataille navale (joueur et IA), sauvegarde et rechargement, interception d'une
//! armée qui fait du cabotage. Sur la carte d'Aquitaine (ses ports de la côte atlantique).
#![allow(non_snake_case)]

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::marine as M;
use conquete::engine::navale as N;
use conquete::engine::raccord as TB;
use conquete::engine::Game;
use conquete::py::{json, Val};
use conquete::turns as TT;
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{armee, armee_de, partie, GEO};

const FOE: &str = "40";

/// Deux ports reliés par la mer (le premier au joueur, le second à `autre`, de force) : (p, q).
fn deux_ports(g: &mut Game, autre: &str) -> (i64, i64) {
    let ports: Vec<i64> = (0..g.nodes.len() as i64).filter(|&n| M::case_port(&g.geo, n).is_some()).collect();
    for &p in &ports {
        for &q in &ports {
            if p != q && M::chemin_mer(&g.geo, M::case_port(&g.geo, p).unwrap(), M::case_port(&g.geo, q).unwrap()).is_some_and(|c| c.len() > 4) {
                let pl = g.player.clone();
                g.nodes.at(p).set("owner", pl.as_str());
                g.nodes.at(q).set("owner", autre);
                // un port de commerce achevé de part et d'autre (chaîne `port`, SPEC-EMPIRE module 4)
                for n in [p, q] {
                    conquete::cities::slots(&g.nodes.at(n)).set("port", 1);
                }
                return (p, q);
            }
        }
    }
    panic!("pas deux ports reliés par la mer");
}

/// Une flotte du camp au port nid, faite de ces navires (à pleine coque), par le chantier de la place.
fn flotte(g: &mut Game, code: &str, nid: i64, navires: &[&str]) -> Val {
    conquete::cities::slots(&g.nodes.at(nid)).set("port", 3); // un arsenal de marine : tous les navires
    for t in navires {
        g.factions.at(code).at("res").set("livres", 100000);
        g.factions.at(code).at("res").set("bois", 10000);
        g.factions.at(code).at("res").set("fer", 10000);
        let (ok, msg) = M::construire(g, code, nid, &Val::from(*t));
        assert!(ok, "{msg}");
        let n = g.nodes.at(nid);
        let q = n.at("queue").at(-1);
        assert_eq!(q.at("kind"), "navire");
        q.set("left", 0.0001);
        for e in n.at("queue").iter() {
            e.set("left", 0.0001);
        }
        g.update_queues(0.01);
    }
    let f = g.flottes.values().into_iter().find(|f| f.at("owner") == code && f.at("a_quai") == nid).expect("pas de flotte au port");
    f
}

fn guerre(g: &mut Game) {
    let p = g.player.clone();
    D::declare_war(g, FOE, &p, true);
}

#[test]
fn une_flotte_se_construit_puis_se_deplace() {
    let mut g = partie();
    let p = g.player.clone();
    let (a, b) = deux_ports(&mut g, &p);
    // un navire inconnu, une place sans port, une découverte manquante : refusés
    assert!(!M::construire(&mut g, &p, a, &Val::from("galion")).0);
    assert!(!M::peut_construire(&g, &p, a, &Val::from("cuirasse")).0);
    let f = flotte(&mut g, &p, a, &["corvette", "corvette"]);
    assert_eq!(f.at("navires").at("corvette"), 2i64);
    assert_eq!(M::nb_navires(&f), 2);
    // l'entretien entre dans l'économie du mois
    g.compute_income();
    assert!(g.factions.at(&p).at("_upkeep").atf("navires") > 0.0);
    // tour par tour : l'ordre s'exécute tout de suite
    assert!(TT::planning(&g));
    let (x0, y0) = (f.ati("x"), f.ati("y"));
    let r = V::player_state(&mut g, 0);
    assert_eq!(r.at("flottes").len(), 1);
    let res = M::commande(&mut g, &p, &dict! {"sub" => "deplacer", "flotte" => f.at("id"), "node" => b});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    assert!((f.ati("x"), f.ati("y")) != (x0, y0), "la flotte n'a pas bougé");
    assert_eq!(f.at("a_quai"), b, "{}", res.at("msg"));
    let vue = V::player_state(&mut g, 0);
    let vf = vue.at("flottes").at(0);
    for k in ["id", "proprio", "case", "navires", "chemin", "a_quai", "armee", "ordre"] {
        assert!(vf.has(k), "vue : {k}");
    }
    assert!(vue.has("blocus"));
    let rules = V::rules_payload();
    assert!(rules.at("navires").has("vaisseau") && rules.at("strats_nav").has("couper"));
}

#[test]
fn une_armee_embarque_puis_debarque() {
    let mut g = partie();
    let p = g.player.clone();
    let (a, b) = deux_ports(&mut g, &p);
    let f = flotte(&mut g, &p, a, &["flute", "flute", "flute", "flute", "flute"]);
    let ar = armee(&g);
    let (nx, ny) = g.node_xy(a);
    ar.update(&dict! {"at_node" => a, "x" => nx, "y" => ny, "state" => "idle", "path" => list![]});
    let aid = ar.at("id");
    let men = M::effectif(&ar);
    let res = M::commande(&mut g, &p, &dict! {"sub" => "embarquer", "flotte" => f.at("id"), "army" => &aid});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    assert!(!g.armies.has(&aid) && f.at("armee") == aid);
    let vf = V::player_state(&mut g, 0).at("flottes").at(0);
    assert_eq!(vf.at("armee").at("id"), aid);
    assert!(M::commande(&mut g, &p, &dict! {"sub" => "deplacer", "flotte" => f.at("id"), "node" => b}).atb("ok"));
    assert_eq!(f.at("a_quai"), b);
    let res = M::commande(&mut g, &p, &dict! {"sub" => "debarquer", "flotte" => f.at("id")});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    let ar = g.armies.at(&aid);
    assert_eq!(ar.at("at_node"), b);
    assert_eq!(M::effectif(&ar), men);
    assert!(f.at("armee").is_none());
}

#[test]
fn un_blocus_coupe_le_commerce_et_garde_les_navires_au_port() {
    let mut g = partie();
    let p = g.player.clone();
    let (a, b) = deux_ports(&mut g, FOE);
    guerre(&mut g);
    let f = flotte(&mut g, &p, a, &["fregate", "fregate"]);
    let e = flotte(&mut g, FOE, b, &["corvette"]);
    let res = M::commande(&mut g, &p, &dict! {"sub" => "ordre", "flotte" => f.at("id"), "ordre" => "blocus", "node" => b});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    assert_eq!(f.at("ordre"), "blocus");
    assert!(M::bloque(&g, b), "le port n'est pas bloqué");
    g.compute_income();
    assert!(g._blockade.has(b), "le port bloqué commerce encore");
    let r = V::player_state(&mut g, 0);
    assert_eq!(r.at("blocus").at(0).at("ville"), b);
    // les navires du port bloqué ne sortent que pour attaquer les bloqueurs
    let (ok, msg) = M::deplacer(&mut g, FOE, &e.at("id"), &Val::from(a), &Val::None, &Val::None);
    assert!(!ok, "{msg}");
    // un siège terrestre en même temps : les vivres s'épuisent deux fois plus vite
    let n = g.nodes.at(b);
    n.set("siege", dict! {"by" => p.as_str(), "dmg" => 0.0, "since" => g.t, "blocus" => true, "food" => 100.0, "m0" => 100});
    conquete::army_actions::blockade_tick(&mut g, &n, &list![], 1.0);
    assert!(n.at("siege").atf("food") < 100.0);
}

#[test]
fn une_bataille_navale_attend_le_choix_du_joueur() {
    let mut g = partie();
    let p = g.player.clone();
    let (a, b) = deux_ports(&mut g, FOE);
    guerre(&mut g);
    let f = flotte(&mut g, &p, a, &["fregate", "fregate", "fregate"]);
    let e = flotte(&mut g, FOE, b, &["corvette"]);
    // la corvette ennemie sort au large : la flotte du joueur va droit sur elle
    let ch = M::chemin_mer(&g.geo, M::case_port(&g.geo, b).unwrap(), M::case_port(&g.geo, a).unwrap()).unwrap();
    let (mx, my) = ch[ch.len() / 2];
    e.update(&dict! {"x" => mx, "y" => my, "a_quai" => Val::None});
    let res = M::commande(&mut g, &p, &dict! {"sub" => "deplacer", "flotte" => f.at("id"), "x" => mx as f64 + 0.5, "y" => my as f64 + 0.5});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    let bid = f.at("bataille");
    assert!(bid.is_some(), "pas de bataille : {}", res.at("msg"));
    assert!(TB::frozen(&g), "la campagne n'attend pas le joueur");
    let vb = V::player_state(&mut g, 0).at("battles").iter().find(|b| b.getb("naval")).expect("pas de bataille navale dans la vue");
    assert_eq!(vb.at("mode"), "attente");
    assert!(vb.at("choix").len() == 6 && vb.at("defaut").is_str());
    assert!(!TB::command(&mut g, &dict! {"sub" => "choose", "bid" => &bid, "strat" => "galop"}).atb("ok"));
    let res = TB::command(&mut g, &dict! {"cmd" => "tac", "sub" => "choose", "bid" => &bid, "strat" => "ligne"});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    assert!(!g.navales.truthy() && !TB::frozen(&g));
    let ev = g.events.iter().rev().find(|e| e.at("kind") == "battle_end").expect("pas de fin de bataille");
    assert!(ev.getb("naval") && ev.at("journal").len() >= 2, "{}", ev.at("text"));
    assert!(ev.atb("win"), "trois frégates battent une corvette : {}", ev.at("text"));
    assert!(!g.flottes.has(e.at("id")) || M::nb_navires(&e) == 0 || e.at("x") != mx, "l'ennemi vaincu ne reste pas là");
    assert!(f.at("amiral").atf("xp") > 0.0);
}

#[test]
fn une_bataille_navale_entre_ia_se_regle_seule() {
    let mut g = partie();
    let (a, b) = deux_ports(&mut g, FOE);
    g.nodes.at(a).set("owner", "24");
    D::declare_war(&mut g, FOE, "24", true);
    let f = flotte(&mut g, "24", a, &["fregate", "fregate"]);
    let e = flotte(&mut g, FOE, b, &["corvette", "corvette"]);
    for x in [&f, &e] {
        x.set("a_quai", Val::None);
    }
    e.update(&dict! {"x" => f.at("x"), "y" => f.at("y")});
    let seq = g.seq;
    let bt = N::engager(&mut g, &list![f.at("id")], &list![e.at("id")], f.atf("x"), f.atf("y"));
    assert_eq!(bt.at("mode"), "auto");
    assert!(!g.navales.truthy(), "la bataille entre IA attend");
    assert!(bt.at("journal").len() >= 2);
    for s in bt.at("sides").iter() {
        assert!(conquete::rules::STRATS_NAV().has(s.at("strat")), "stratégie de l'IA : {}", s.at("strat"));
    }
    assert!(g.seq >= seq);
    assert!(M::nb_navires(&f) + M::nb_navires(&e) < 4 || f.at("pv").values().iter().chain(e.at("pv").values().iter()).any(|l| l.iter().any(|h| h.f() < 1.0)));
}

#[test]
fn les_flottes_se_sauvegardent_et_se_rechargent() {
    let mut g = partie();
    let p = g.player.clone();
    let (a, _b) = deux_ports(&mut g, &p);
    let f = flotte(&mut g, &p, a, &["flute", "flute", "flute", "flute", "flute"]);
    let ar = armee(&g);
    let (nx, ny) = g.node_xy(a);
    ar.update(&dict! {"at_node" => a, "x" => nx, "y" => ny, "state" => "idle", "path" => list![]});
    assert!(M::embarquer(&mut g, &p, &f.at("id"), &ar.at("id")).0);
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let h = V::from_dict(GEO(), &d).unwrap();
    let f2 = h.flottes.at(f.at("id"));
    assert_eq!(f2.at("navires"), f.at("navires"));
    assert_eq!(f2.at("armee"), ar.at("id"));
    assert_eq!(M::effectif(&M::armee_a_bord(&f2)), M::effectif(&ar));
    // une sauvegarde d'avant la marine
    d.pop("flottes");
    d.pop("navales");
    let mut h = V::from_dict(GEO(), &d).unwrap();
    assert!(!h.flottes.truthy());
    V::player_state(&mut h, 0);
}

#[test]
fn une_flotte_intercepte_une_armee_qui_fait_du_cabotage() {
    let mut g = partie();
    let p = g.player.clone();
    guerre(&mut g);
    // une voie de mer et l'armée ennemie qui l'emprunte
    let e = g.geo.edges.iter().find(|e| e.get("kind") == "water" && e.getb("sea") && e.atf("len") > 8.0).expect("pas de voie de mer");
    let (na, nb) = (e.ati("a"), e.ati("b"));
    let ar = armee_de(&g, FOE);
    let (ax, ay) = g.node_xy(na);
    ar.update(&dict! {"at_node" => na, "x" => ax, "y" => ay, "state" => "move", "edge" => Val::None,
                      "path" => list![dict!{"kind" => "road", "e" => e.at("id"), "frm" => na, "to" => nb, "pos" => 0.0}]});
    let men = M::effectif(&ar);
    // la flotte du joueur au milieu de la voie
    let pts = e.at("pts");
    let (mx, my) = pts.at(pts.len() as i64 / 2).xy();
    let c = M::mer_pres(&g.geo, mx, my, 3).expect("pas de mer au milieu de la voie");
    let port = (0..g.nodes.len() as i64).find(|&n| M::case_port(&g.geo, n).is_some()).unwrap();
    g.nodes.at(port).set("owner", p.as_str());
    let f = flotte(&mut g, &p, port, &["fregate"]);
    f.update(&dict! {"x" => c.0, "y" => c.1, "a_quai" => Val::None});
    for _ in 0..200 {
        g.move_army(&ar, 0.02);
        if !ar.atb("path") {
            break;
        }
    }
    assert!(M::effectif(&ar) < men, "l'armée n'a pas été interceptée");
    assert_eq!(ar.at("at_node"), na, "l'armée interceptée regagne son port");
    assert!(g.events.iter().any(|e| e.getb("interception")));
}

#[test]
fn l_ia_arme_une_flotte_et_bloque_le_port_ennemi() {
    let mut g = partie();
    deux_ports(&mut g, FOE);
    guerre(&mut g);
    for (k, v) in [("livres", 1_000_000), ("bois", 10_000), ("fer", 10_000)] {
        g.factions.at(FOE).at("res").set(k, v);
    }
    let mut ai = g.ais.get_mut(FOE).unwrap().take().unwrap();
    conquete::ai::marine::jouer(&mut g, &mut ai);
    let chantier: Vec<Val> =
        g.nodes.iter().filter(|n| n.at("owner") == FOE && n.at("queue").iter().any(|q| q.at("kind") == "navire")).collect();
    assert!(!chantier.is_empty(), "l'IA n'a mis aucun navire en chantier");
    for n in &chantier {
        for q in n.at("queue").iter() {
            q.set("left", 0.0001);
        }
    }
    g.update_queues(0.01);
    let f = g.flottes.values().into_iter().find(|f| f.at("owner") == FOE).expect("pas de flotte de l'IA");
    ai.marine_clock = 0.0;
    conquete::ai::marine::jouer(&mut g, &mut ai);
    *g.ais.get_mut(FOE).unwrap() = Some(ai);
    assert_eq!(f.at("ordre"), "blocus", "l'IA en guerre ne bloque pas");
    assert_eq!(g.nodes.at(f.at("cible")).at("owner"), g.player.as_str());
}

#[test]
fn tout_mouillage_peut_batir_un_port() {
    // (un port de mer sans quai sur une voie d'eau marine, comme Brest sur la carte d'Europe, bâtit quand même son port)
    let g = partie();
    let mouillages: Vec<i64> = (0..g.nodes.len() as i64)
        .filter(|&n| M::case_port(&g.geo, n).is_some() && g.geo.nodes.at(n).at("type") != "fort")
        .collect();
    assert!(!mouillages.is_empty());
    for n in mouillages {
        assert!(conquete::cities::fits(&g, n, "port"), "{} ne peut pas bâtir de port", g.geo.nodes.at(n).at("name"));
    }
}

/// Le commerce maritime en Aquitaine aussi (SPEC-EMPIRE, module 7) : un accord commercial entre deux camps qui ont un
/// port de mer fait sa route, qu'un corsaire coupe ; le marché a ses prix ; ni comptoir ni plantation.
#[test]
fn le_commerce_maritime_en_aquitaine() {
    use conquete::engine::commerce as C;
    let mut g = partie();
    let p = g.player.clone();
    let a_un_port = |g: &Game, c: &str| g.owned_nodes(c).iter().any(|n| C::port_de_mer(g, n.ati("id")));
    assert!(a_un_port(&g, &p));
    let b = g.factions.keys().into_iter().map(|c| c.string()).find(|c| *c != p && a_un_port(&g, c)).expect("pas d'autre camp avec un port de mer");
    D::apply(&mut g, &p, &b, "commerce", 0, &Val::None, &Val::None);
    let vue = V::player_state(&mut g, 0);
    let r = vue.at("routes_mer").iter().find(|r| r.at("proprio") == p.as_str() || r.at("partenaire") == p.as_str()).expect("pas de route commerciale");
    assert!(r.at("chemin").len() > 1 && r.at("coupee").is_none() && r.atf("valeur") > 0.0, "{r}");
    assert!(g.factions.at(&p).at("_mer").atf("routes") > 0.0);
    assert!(vue.at("comptoirs").len() == 0 && vue.at("marche").at("sucre").atf("prix") > 0.0, "ni comptoir, un marché");
    assert!(vue.has("en_mer") && vue.has("departs") && vue.has("arrivees"));
    assert!(C::denree_place(&g.geo, g.capital_of(&p).i()).is_none(), "pas de plantation en Aquitaine");
    // un corsaire d'un troisième camp sur la route la coupe
    let x = g.factions.keys().into_iter().map(|c| c.string()).find(|c| *c != p && *c != b && a_un_port(&g, c));
    if let Some(x) = x {
        let xp = g.owned_nodes(&x).iter().map(|n| n.ati("id")).find(|&n| M::case_port(&g.geo, n).is_some()).unwrap();
        let e = flotte(&mut g, &x, xp, &["corvette"]);
        assert!(M::ordre(&mut g, &x, &e.at("id"), &dict! {"ordre" => "corsaire", "cible" => p.as_str()}).0);
        let m = r.at("chemin").at(r.at("chemin").len() as i64 / 2);
        e.update(&dict! {"x" => m.at(0), "y" => m.at(1), "a_quai" => Val::None});
        let r2 = V::player_state(&mut g, 0).at("routes_mer").iter().find(|q| q.at("id") == r.at("id")).unwrap();
        assert_eq!(r2.at("coupee"), "corsaire");
    }
}

/// Une armée posée sur la case même d'une place (débarquée là) y arrive quand on l'y envoie, et la prend si elle est
/// ennemie et sans défense, comme une armée qui arrive par la route (avant, son chemin hors route d'un seul point
/// s'achevait sans arrivée).
#[test]
fn une_armee_debarquee_sur_la_case_d_une_place_y_arrive_et_la_prend() {
    let mut g = partie();
    let p = g.player.clone();
    guerre(&mut g);
    let ar = armee(&g);
    let nid = (0..g.nodes.len() as i64)
        .find(|&n| {
            g.nodes.at(n).at("owner") == FOE && g.geo.nodes.at(n).at("type") != "capitale"
                && !g.armies.values().iter().any(|a| a.at("at_node") == n)
        })
        .expect("pas de place ennemie");
    g.nodes.at(nid).update(&dict! {"milice" => 0.0, "milice_max" => 0, "garrison" => list![], "fort" => 0});
    let (nx, ny) = g.node_xy(nid);
    // au milieu de la case de la place, hors du nœud (comme marine::debarquer sur la côte)
    ar.update(&dict! {"x" => nx.floor() + 0.5, "y" => ny.floor() + 0.5, "at_node" => Val::None, "state" => "idle", "path" => list![], "onroad" => false});
    let (ok, msg) = g.order_move(&p, &ar.at("id"), &dict! {"node" => nid, "mode" => "champs"});
    assert_eq!(ok, Some(true), "{msg}");
    assert_eq!(ar.at("path").at(-1).at("pts").len(), 1, "le chemin hors route n'a qu'un point");
    TT::settle(&mut g);
    assert_eq!(ar.at("at_node"), nid, "l'armée n'est pas arrivée sur la place");
    assert_eq!(g.nodes.at(nid).at("owner"), p.as_str(), "la place n'est pas prise");
}
