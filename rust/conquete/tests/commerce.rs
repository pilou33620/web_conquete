//! Le commerce maritime (SPEC-EMPIRE, module 7), sur la carte monde : plantations et prix des denrées, flûtes sur un
//! comptoir, route commerciale née d'un accord puis coupée par un blocus et par un corsaire, incident diplomatique et
//! casus belli, traversée de l'Europe à l'Amérique avec une armée qui débarque et prend une place, IA, sauvegarde.
//! Les IA sont retirées des parties (sauf pour l'essai de l'IA) : un mois s'y joue vite.

use conquete::cities as CT;
use conquete::diplomacy as D;
use conquete::engine::commerce as C;
use conquete::engine::marine as M;
use conquete::engine::Game;
use conquete::geo::{self, GeoMap, VERSION_MONDE};
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::turns as TT;
use conquete::views as V;
use conquete::{dict, list};
use std::rc::Rc;
use std::sync::Mutex;

fn carte() -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    thread_local! {
        static MONDE: std::cell::OnceCell<Rc<GeoMap>> = const { std::cell::OnceCell::new() };
    }
    MONDE.with(|c| {
        c.get_or_init(|| {
            let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("WEB_CONQUETE_NOLOG", "1");
            let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
            std::fs::create_dir_all(&d).unwrap();
            std::env::set_var("CONQUETE_DATA", &d);
            Rc::new(GeoMap::new(VERSION_MONDE))
        })
        .clone()
    })
}

/// Une partie monde de 1700, sans IA.
fn partie(joueur: &str) -> Game {
    let mut g = Game::new(carte(), joueur, &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    g.ais.clear();
    g
}

/// « Tour suivant » : le mois se joue jusqu'au tour suivant du joueur.
fn jouer_mois(g: &mut Game) {
    TT::go(g);
    for _ in 0..2000 {
        if g.tour.at("end").is_none() {
            return;
        }
        TT::advance(g, 1.0);
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
    }
    panic!("le mois ne finit pas");
}

/// Le port de mer du camp le plus proche de la case (x, y), d'où la mer y mène.
fn port_vers(g: &Game, code: &str, (x, y): (i64, i64)) -> i64 {
    let mut ports: Vec<(f64, i64)> = g
        .owned_nodes(code)
        .iter()
        .map(|n| n.ati("id"))
        .filter(|&n| C::port_de_mer(g, n))
        .map(|n| {
            let (cx, cy) = M::case_port(&g.geo, n).unwrap();
            (((cx - x).pow(2) + (cy - y).pow(2)) as f64, n)
        })
        .collect();
    ports.sort_by(|a, b| a.0.total_cmp(&b.0));
    ports.into_iter().map(|p| p.1).find(|&n| M::chemin_mer(&g.geo, M::case_port(&g.geo, n).unwrap(), (x, y)).is_some()).expect("pas de port")
}

/// Une flotte du camp au port nid, faite de ces navires, par le chantier de la place.
fn flotte(g: &mut Game, code: &str, nid: i64, navires: &[&str]) -> Val {
    CT::slots(&g.nodes.at(nid)).set("port", 3);
    for t in navires {
        for (k, v) in [("livres", 100000), ("bois", 10000), ("fer", 10000)] {
            g.factions.at(code).at("res").set(k, v);
        }
        let (ok, msg) = M::construire(g, code, nid, &Val::from(*t));
        assert!(ok, "{msg}");
        for e in g.nodes.at(nid).at("queue").iter() {
            e.set("left", 0.0001);
        }
        g.update_queues(0.01);
    }
    g.flottes.values().into_iter().find(|f| f.at("owner") == code && f.at("a_quai") == nid).expect("pas de flotte au port")
}

fn comptoir(g: &Game, id: &str) -> (i64, i64) {
    let c = g.geo.comptoirs.iter().find(|c| c.at("id") == id).unwrap();
    (c.ati("x"), c.ati("y"))
}

/// Un port de mer colonial (une place qui a sa denrée) tenu par un camp : (place, camp, denrée).
fn port_colonial(g: &Game) -> (i64, String, &'static str) {
    for n in g.nodes.iter() {
        let nid = n.ati("id");
        let o = n.ats("owner");
        if o != R::NEUTRAL && CT::est_colonie(g, nid) && C::port_de_mer(g, nid) {
            if let Some(d) = C::denree_place(&g.geo, nid) {
                return (nid, o, d);
            }
        }
    }
    panic!("pas de port colonial");
}

#[test]
fn une_plantation_produit_la_denree_de_sa_place() {
    let mut g = partie("FR");
    let (nid, o, d) = port_colonial(&g);
    assert_eq!(CT::bat_de(&g, nid, "plantation", 1), format!("plantation_{d}"), "le bâtiment montre la denrée de la place");
    // la géographie : le Saint-Laurent donne des fourrures, le sud de l'Inde des épices
    let mut lieu = |lat: f64, lon: f64| {
        let (x, y) = g.geo.xy(lat, lon);
        g.nearest_node(x, y, None, 1e9).i()
    };
    let (quebec, cochin, paris) = (lieu(46.8, -71.2), lieu(9.9, 76.3), lieu(48.85, 2.35));
    assert_eq!(C::denree_place(&g.geo, quebec), Some("fourrures"), "Québec");
    assert_eq!(C::denree_place(&g.geo, cochin), Some("epices"), "Cochin");
    assert_eq!(C::denree_place(&g.geo, paris), None, "Paris");
    C::revenus(&mut g);
    assert_eq!(g.commerce.at("marche").at(d).atf("offre"), 0.0);
    CT::slots(&g.nodes.at(nid)).set("plantation", 1);
    assert_eq!(C::production(&g.nodes.at(nid)), 1.0);
    C::revenus(&mut g);
    let m = g.commerce.at("marche").at(d);
    assert_eq!(m.atf("offre"), 1.0);
    let attendu = C::prix(d, 1.0) * R::PLANTATION_K;
    let mer = g.factions.at(&o).at("_mer");
    assert!((mer.atf("plantations") - attendu).abs() < 0.01, "{mer} : {attendu}");
    // le revenu entre dans le commerce du camp
    g.compute_income();
    assert!(g.factions.at(&o).at("_trade").atf("livres") >= attendu - 0.01);
    CT::slots(&g.nodes.at(nid)).set("plantation", 3);
    assert_eq!(C::production(&g.nodes.at(nid)), 3.0, "la sucrerie produit trois unités");
}

#[test]
fn le_prix_baisse_quand_l_offre_monte() {
    let (lo, hi) = R::DENREE_PRIX;
    let base = R::DENREES().at("sucre").atf("prix");
    assert!(C::prix("sucre", 1.0) > C::prix("sucre", 6.0) && C::prix("sucre", 6.0) > C::prix("sucre", 20.0));
    assert!((C::prix("sucre", R::DENREE_DEMANDE) - base).abs() < 1e-9, "à l'équilibre, le prix de base");
    assert!((C::prix("sucre", 0.0) - base * hi).abs() < 1e-9 && (C::prix("sucre", 1e6) - base * lo).abs() < 1e-9, "bornes");
    // dans la partie : tout le monde plante la même denrée, son prix tombe
    let mut g = partie("FR");
    let (nid, o, d) = port_colonial(&g);
    CT::slots(&g.nodes.at(nid)).set("plantation", 1);
    C::revenus(&mut g);
    let p1 = g.commerce.at("marche").at(d).atf("prix");
    let autres: Vec<i64> = (0..g.nodes.len() as i64).filter(|&n| n != nid && C::denree_place(&g.geo, n) == Some(d)).take(8).collect();
    assert!(autres.len() >= 4, "{d} : trop peu de places");
    for n in &autres {
        g.nodes.at(*n).set("owner", o.as_str());
        CT::slots(&g.nodes.at(*n)).set("plantation", 3);
    }
    C::revenus(&mut g);
    let m = g.commerce.at("marche").at(d);
    assert!(m.atf("prix") < p1, "le prix ne baisse pas : {p1} puis {m}");
    assert!(m.atf("offre") > 10.0);
    let vue = V::player_state(&mut g, 0);
    assert_eq!(vue.at("marche").at(d).at("prix"), m.at("prix"));
    assert!(V::rules_payload().at("denrees").has("epices"));
}

#[test]
fn des_flutes_sur_un_comptoir_rapportent() {
    let mut g = partie("FR");
    let c = comptoir(&g, "mogador");
    let p = port_vers(&g, "FR", c);
    let f = flotte(&mut g, "FR", p, &["flute", "flute"]);
    let fid = f.at("id");
    // un comptoir inconnu, une flotte sans flûte : refusés
    assert!(!M::commande(&mut g, "FR", &dict! {"sub" => "ordre", "flotte" => &fid, "ordre" => "commerce", "cible" => "atlantide"}).atb("ok"));
    let res = M::commande(&mut g, "FR", &dict! {"sub" => "ordre", "flotte" => &fid, "ordre" => "commerce", "cible" => "mogador"});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    assert_eq!((f.at("ordre"), f.at("cible")), (Val::from("commerce"), Val::from("mogador")));
    let occupe = |g: &mut Game| {
        V::player_state(g, 0).at("comptoirs").iter().find(|c| c.at("id") == "mogador").unwrap().at("navires").iter().any(|n| n.at("flotte") == fid)
    };
    for _ in 0..8 {
        if occupe(&mut g) {
            break;
        }
        jouer_mois(&mut g);
    }
    assert!(occupe(&mut g), "la flotte n'a pas pris place au comptoir ({}, {} ; comptoir {c:?})", f.at("x"), f.at("y"));
    let vc = V::player_state(&mut g, 0).at("comptoirs").iter().find(|c| c.at("id") == "mogador").unwrap();
    assert_eq!(vc.at("denree"), "ivoire");
    assert!(!vc.atb("dispute") && vc.at("case") == list![c.0, c.1]);
    C::revenus(&mut g);
    let attendu = 2.0 * C::prix_du_mois(&g, "ivoire");
    let mer = g.factions.at("FR").at("_mer");
    assert!((mer.atf("comptoirs") - attendu).abs() < 0.02, "{mer} : {attendu}");
    let vue = V::player_state(&mut g, 0);
    assert!(vue.at("me").at("mer").atf("comptoirs") > 0.0, "le revenu dans la vue du joueur");
}

/// Un autre camp d'Europe qui a un port de mer, ni le joueur ni ceux qu'on écarte.
fn autre_port(g: &Game, sauf: &[&str]) -> String {
    for c in ["ES", "GB", "PT", "NL", "SE", "DK"] {
        if g.factions.has(c) && !sauf.contains(&c) && g.owned_nodes(c).iter().any(|n| C::port_de_mer(g, n.ati("id"))) {
            return c.to_string();
        }
    }
    panic!("pas d'autre port");
}

#[test]
fn une_route_commerciale_nait_d_un_accord_puis_se_coupe() {
    let mut g = partie("FR");
    let b = autre_port(&g, &["FR"]);
    D::apply(&mut g, "FR", &b, "commerce", 0, &Val::None, &Val::None);
    let id = if "FR" < b.as_str() { format!("FR-{b}") } else { format!("{b}-FR") };
    let r = g.commerce.at("routes").at(&id);
    assert!(r.at("de").is_some() && r.at("chemin").len() > 3, "pas de chemin : {r}");
    let vr = |g: &mut Game| V::player_state(g, 0).at("routes_mer").iter().find(|x| x.at("id") == id.as_str()).expect("route absente de la vue");
    let v = vr(&mut g);
    assert!(v.at("coupee").is_none() && v.atf("valeur") > 0.0, "{v}");
    assert!(g.factions.at("FR").at("_mer").atf("routes") > 0.0);
    // un blocus d'un des deux ports la coupe
    g._blockade.push(r.at("de"));
    assert_eq!(vr(&mut g).at("coupee"), "blocus");
    g._blockade = conquete::pyset![];
    assert!(vr(&mut g).at("coupee").is_none());
    // un corsaire d'un troisième camp sur son chemin la coupe et prend sa part, sans guerre
    let x = autre_port(&g, &["FR", &b]);
    let xp = g.owned_nodes(&x).iter().map(|n| n.ati("id")).find(|&n| C::port_de_mer(&g, n)).unwrap();
    let fl = flotte(&mut g, &x, xp, &["flute"]);
    assert!(!M::ordre(&mut g, &x, &fl.at("id"), &dict! {"ordre" => "corsaire", "cible" => "FR"}).0, "des flûtes ne font pas la course");
    let e = flotte(&mut g, &x, xp, &["corvette"]);
    let (ok, msg) = M::ordre(&mut g, &x, &e.at("id"), &dict! {"ordre" => "corsaire", "cible" => "FR"});
    assert!(ok, "{msg}");
    let ch = r.at("chemin");
    let m = ch.at(ch.len() as i64 / 2);
    e.update(&dict! {"x" => m.at(0), "y" => m.at(1), "a_quai" => Val::None});
    assert!(!g.at_war(&x, "FR"));
    assert_eq!(vr(&mut g).at("coupee"), "corsaire");
    C::revenus(&mut g);
    assert!(g.factions.at(&x).at("_mer").atf("corsaires") > 0.0);
    assert_eq!(g.factions.at("FR").at("_mer").atf("routes"), 0.0);
    // chaque mois de course, le risque d'un incident : la victime se fâche et tient un casus belli
    let rel0 = g.factions.at("FR").at("rel").at(&x).f();
    for _ in 0..40 {
        if C::casus_belli(&g, "FR", &x) {
            break;
        }
        g.t += 30.0;
        C::mois(&mut g);
    }
    assert!(C::casus_belli(&g, "FR", &x), "aucun incident en quarante mois");
    assert!(g.factions.at("FR").at("rel").at(&x).f() < rel0);
    assert!(g.events.iter().any(|e| e.ats("text").contains("casus belli")));
    let fx = V::player_state(&mut g, 0).at("factions").iter().find(|f| f.at("code") == x.as_str()).unwrap();
    assert!(fx.getb("cb"), "la vue montre le casus belli");
    // la route et le marché se sauvegardent
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let h = V::from_dict(carte(), &d).unwrap();
    assert_eq!(json::dumps(&h.commerce), json::dumps(&g.commerce));
    // la guerre déclarée avec un casus belli ne fâche pas un camp lointain
    let z = "IMO";
    let rz = g.factions.at(z).at("rel").at("FR").f();
    let (ok, msg) = D::declare_war(&mut g, "FR", &x, false);
    assert!(ok, "{msg}");
    assert_eq!(g.factions.at(z).at("rel").at("FR").f(), rz);
    assert!(!C::casus_belli(&g, "FR", &x), "le casus belli sert une fois");
}

/// Dans une partie, sans rien forcer : un corsaire posé sur une route commerciale y prend un marchand en quelques tours,
/// et l'événement porte ce que la page joue (le corsaire, la route, la victime).
#[test]
fn un_corsaire_sur_une_route_prend_un_marchand_en_quelques_tours() {
    let mut g = partie("FR");
    let b = autre_port(&g, &["FR"]);
    D::apply(&mut g, "FR", &b, "commerce", 0, &Val::None, &Val::None);
    let id = if "FR" < b.as_str() { format!("FR-{b}") } else { format!("{b}-FR") };
    let r = g.commerce.at("routes").at(&id);
    let x = autre_port(&g, &["FR", &b]);
    let xp = g.owned_nodes(&x).iter().map(|n| n.ati("id")).find(|&n| C::port_de_mer(&g, n)).unwrap();
    let e = flotte(&mut g, &x, xp, &["corvette"]);
    let (ok, msg) = M::ordre(&mut g, &x, &e.at("id"), &dict! {"ordre" => "corsaire", "cible" => "FR"});
    assert!(ok, "{msg}");
    let ch = r.at("chemin");
    let m = ch.at(ch.len() as i64 / 2);
    e.update(&dict! {"x" => m.at(0), "y" => m.at(1), "a_quai" => Val::None});
    let pris = |g: &Game| g.events.iter().find(|ev| ev.ats("text").contains("prennent un navire marchand"));
    let mut tours = 0;
    while pris(&g).is_none() {
        tours += 1;
        assert!(tours <= 6, "aucun marchand pris en six tours");
        jouer_mois(&mut g);
    }
    let ev = pris(&g).unwrap();
    assert_eq!((ev.at("corsaire"), ev.at("route"), ev.at("victime")), (e.at("id"), Val::from(id.as_str()), Val::from("FR")), "{ev}");
    assert!(e.at("navires").at("flute").i() >= 1, "le marchand pris rejoint la flotte du corsaire");
    eprintln!("marchand pris au tour {tours}");
}

#[test]
fn traversee_de_l_europe_a_l_amerique_avec_une_armee() {
    let mut g = partie("FR");
    let route = geo::route_mer(&g.geo, "europe-amerique").unwrap();
    let (dx, dy) = (route.at("de").at(0).i(), route.at("de").at(1).i());
    let (vx, vy) = (route.at("vers").at(0).i(), route.at("vers").at(1).i());
    let p = port_vers(&g, "FR", (dx, dy));
    let f = flotte(&mut g, "FR", p, &["fregate", "flute", "flute"]);
    let fid = f.at("id");
    let regs: Val = (0..3).map(|_| g.new_reg("ligne", &Val::None, &Val::from("FR"))).collect();
    let (nx, ny) = g.node_xy(p);
    let a = g.create_army("FR", nx, ny, &regs, &Val::from(p), &Val::None, &Val::None);
    let aid = a.at("id");
    let (ok, msg) = M::embarquer(&mut g, "FR", &fid, &aid);
    assert!(ok, "{msg}");
    // une route inconnue : refusée
    assert!(!M::commande(&mut g, "FR", &dict! {"sub" => "ordre", "flotte" => &fid, "ordre" => "route", "route" => "europe-lune"}).atb("ok"));
    let res = M::commande(&mut g, "FR", &dict! {"sub" => "ordre", "flotte" => &fid, "ordre" => "route", "route" => "europe-amerique"});
    assert!(res.atb("ok"), "{}", res.at("msg"));
    // la flotte gagne le large, puis quitte la carte
    let mut n = 0;
    while g.flottes.has(&fid) {
        jouer_mois(&mut g);
        n += 1;
        assert!(n < 4, "la flotte n'a pas pris la mer ({}, {})", f.at("x"), f.at("y"));
    }
    assert!(C::est_en_mer(&g, &fid) && !g.armies.has(&aid));
    // la vue montre le départ (ceux de tout camp que le joueur voit), pour que la page le joue
    let dep = V::player_state(&mut g, 0).at("departs");
    let d = dep.iter().find(|d| d.at("id") == fid).expect("le départ n'est pas dans la vue");
    assert_eq!(json::dumps(&d.at("case")), json::dumps(&list![dx, dy]));
    assert_eq!((d.at("proprio"), d.at("route")), (Val::from("FR"), Val::from("europe-amerique")));
    assert_eq!(d.at("navires").at("flute"), 2i64);
    assert!(!M::commande(&mut g, "FR", &dict! {"sub" => "deplacer", "flotte" => &fid, "x" => 10.0, "y" => 10.0}).atb("ok"), "en mer, pas d'ordre");
    let em = V::player_state(&mut g, 0).at("en_mer");
    let e = em.iter().find(|e| e.at("id") == fid).expect("la flotte en mer n'est pas dans la vue");
    let tours = e.ati("arrivee");
    assert!((1..=2).contains(&tours), "{e}");
    assert_eq!(e.at("route"), "europe-amerique");
    g.compute_income();
    assert!(g.factions.at("FR").at("_upkeep").get_or("navires", 0.0).f() > 0.0, "l'entretien des navires en mer");
    // sauvegarde en pleine traversée
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let mut h = V::from_dict(carte(), &d).unwrap();
    h.ais.clear();
    assert!(C::est_en_mer(&h, &fid));
    for g in [&mut g, &mut h] {
        for _ in 0..tours {
            assert!(!g.flottes.has(&fid), "arrivée trop tôt");
            jouer_mois(g);
        }
        let f = g.flottes.get(&fid);
        assert!(f.truthy(), "la flotte n'est pas arrivée");
        assert_eq!((f.ati("x"), f.ati("y")), (vx, vy));
        assert_eq!(f.at("armee"), aid, "l'armée arrive avec la flotte");
        assert!(!C::est_en_mer(g, &fid));
        // l'arrivée dans la vue ; le départ, d'avant le dernier tour des IA, n'y est plus
        let v = V::player_state(g, 0);
        let a = v.at("arrivees").iter().find(|a| a.at("id") == fid).expect("l'arrivée n'est pas dans la vue");
        assert_eq!(json::dumps(&a.at("case")), json::dumps(&list![vx, vy]));
        assert_eq!((a.at("proprio"), a.at("route")), (Val::from("FR"), Val::from("europe-amerique")));
        assert!(!v.at("departs").iter().any(|d| d.at("id") == fid));
    }
    // en Amérique : la flotte gagne la côte devant une place (sans défense), l'armée débarque et la prend
    let f = g.flottes.at(&fid);
    let cible = (0..g.nodes.len() as i64)
        .filter(|&n| g.geo.theatre_de(n) == Some("amerique") && M::case_port(&g.geo, n).is_some())
        .filter_map(|n| {
            let c = M::case_port(&g.geo, n).unwrap();
            M::chemin_mer(&g.geo, (vx, vy), c).map(|ch| (ch.len(), n))
        })
        .min()
        .expect("aucun port d'Amérique joignable")
        .1;
    let nd = g.nodes.at(cible);
    nd.update(&dict! {"owner" => R::NEUTRAL, "milice" => 0.0, "milice_max" => 0, "garrison" => list![], "fort" => 0});
    let (ok, msg) = M::deplacer(&mut g, "FR", &fid, &Val::from(cible), &Val::None, &Val::None);
    assert!(ok, "{msg}");
    for _ in 0..4 {
        if !f.atb("chemin") {
            break;
        }
        jouer_mois(&mut g);
    }
    assert!(!f.atb("chemin"), "la flotte n'arrive pas devant {}", g.geo.nodes.at(cible).at("name"));
    // (sur la case même de la place)
    let (px, py) = g.node_xy(cible);
    let (ok, msg) = M::debarquer(&mut g, "FR", &fid, &Val::from(px), &Val::from(py));
    assert!(ok, "{msg}");
    let a = g.armies.at(&aid);
    assert_eq!(g.geo.cell(a.atf("x"), a.atf("y")), g.geo.cell(px, py), "l'armée n'a pas débarqué sur la case de la place");
    jouer_mois(&mut g);
    for _ in 0..3 {
        if g.nodes.at(cible).at("owner") == "FR" {
            break;
        }
        nd.update(&dict! {"milice" => 0.0, "milice_max" => 0});
        let (ok, msg) = g.order_move("FR", &aid, &dict! {"node" => cible, "mode" => "champs"});
        assert!(ok != Some(false), "{msg}");
        TT::settle(&mut g); // (comme le serveur après un ordre : l'armée marche tout de suite)
        if g.nodes.at(cible).at("owner") == "FR" {
            break;
        }
        jouer_mois(&mut g);
    }
    assert_eq!(g.nodes.at(cible).at("owner"), "FR", "la place n'est pas prise");
}

#[test]
fn l_ia_envoie_ses_flutes_au_comptoir_et_une_expedition_aux_colonies() {
    let mut g = Game::new(carte(), "IMO", &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    let c = comptoir(&g, "mogador");
    let p = port_vers(&g, "FR", c);
    let f = flotte(&mut g, "FR", p, &["flute"]);
    C::mois(&mut g); // (les comptoirs se posent au premier mois)
    let mut ai = g.ais.get_mut("FR").unwrap().take().unwrap();
    conquete::ai::commerce::jouer(&mut g, &mut ai);
    assert_eq!((f.at("ordre"), f.at("cible")), (Val::from("commerce"), Val::from("mogador")), "les flûtes de l'IA ne vont pas au comptoir");
    *g.ais.get_mut("FR").unwrap() = Some(ai);
    // une colonie en guerre : la métropole y envoie une flotte de guerre et l'armée qui attend au port
    let mut g = Game::new(carte(), "IMO", &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    let mut ai = g.ais.get_mut("FR").unwrap().take().unwrap();
    g.set_status("AFR", "AGB", "guerre");
    let q = p;
    let w = flotte(&mut g, "FR", q, &["fregate", "fregate"]);
    let regs: Val = (0..1).map(|_| g.new_reg("ligne", &Val::None, &Val::from("FR"))).collect();
    let (nx, ny) = g.node_xy(q);
    let a = g.create_army("FR", nx, ny, &regs, &Val::from(q), &Val::None, &Val::None);
    for _ in 0..200 {
        if w.get("ordre") == "route" || C::est_en_mer(&g, &w.at("id")) {
            break;
        }
        g.t += 1.0;
        ai.commerce_clock = 0.0;
        conquete::ai::commerce::jouer(&mut g, &mut ai);
    }
    *g.ais.get_mut("FR").unwrap() = Some(ai);
    assert!(w.get("ordre") == "route" || C::est_en_mer(&g, &w.at("id")), "pas d'expédition");
    assert_eq!(w.at("route"), "europe-amerique");
    assert_eq!(w.at("armee"), a.at("id"), "l'armée du port n'a pas embarqué");
}

/// Un port de lac, même le plus peuplé du camp, ne porte pas la route commerciale : on prend le port suivant, relié à
/// celui du partenaire par la mer (Sandusky, sur le lac Érié, puis un port des Antilles, pour une route avec une colonie
/// anglaise qui n'a de ports qu'en Amérique).
#[test]
fn la_route_commerciale_evite_un_port_de_lac() {
    let mut g = partie("FR");
    let place = |g: &Game, nom: &str| (0..g.nodes.len() as i64).find(|&n| g.geo.nodes.at(n).at("name") == nom).unwrap();
    let b = "AGB";
    let kingston = M::case_port(&g.geo, place(&g, "Kingston")).unwrap();
    // un port de mer des Antilles qui n'est pas anglais, à moins de 200 cases de Kingston par la mer
    let antilles = (0..g.nodes.len() as i64)
        .find(|&n| {
            g.nodes.at(n).at("owner") != b
                && g.geo.theatre_de(n) == Some("amerique")
                && C::port_de_mer(&g, n)
                && M::case_port(&g.geo, n).and_then(|c| M::chemin_mer(&g.geo, c, kingston)).is_some_and(|ch| ch.len() < 200)
        })
        .expect("pas de port des Antilles");
    let sandusky = place(&g, "Sandusky");
    for (n, pop) in [(sandusky, 10_000_000), (antilles, 5_000_000)] {
        g.nodes.at(n).update(&dict! {"owner" => "FR", "pop" => pop});
    }
    D::apply(&mut g, "FR", b, "commerce", 0, &Val::None, &Val::None);
    let r = g.commerce.at("routes").at("AGB-FR");
    assert!(r.at("de").is_some(), "pas de route : {r}");
    assert!(r.at("de") != sandusky && r.at("vers") != sandusky, "la route part du lac Érié : {r}");
}
