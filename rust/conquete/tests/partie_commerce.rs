//! Une partie d'essai pour la page du commerce maritime (SPEC-EMPIRE, page P3), sur la carte Monde (1700, la France) :
//! un accord commercial (sa route), des flûtes françaises au comptoir de Mogador et des flûtes d'un autre camp, un
//! corsaire de ce camp qui coupe la route française près de son port (sans guerre), un casus belli de la France contre lui, et à Brest
//! (ou au port le plus proche de la route Europe → Amérique) une frégate et deux flûtes avec une armée à bord, prêtes à
//! traverser. La page y montre comptoirs, routes, corsaire (qui prend un marchand dès le premier tour), la fenêtre de flotte,
//! le panneau « Commerce maritime ».
//! Écrit la sauvegarde là où le dit CONQUETE_PARTIE_COMMERCE (un chemin de fichier .json, par exemple saves/essai-commerce.json) :
//! `CONQUETE_PARTIE_COMMERCE=$PWD/saves/essai-commerce.json cargo test --release -p conquete --test partie_commerce -- --ignored`

mod fabrique_campagne;

use conquete::cities as CT;
use conquete::diplomacy as D;
use conquete::engine::commerce as C;
use conquete::engine::marine as M;
use conquete::engine::Game;
use conquete::py::{self, json, Random, Val};
use conquete::rules as R;
use conquete::views as V;
use conquete::{dict, geo};

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

/// Le port de mer du camp le plus proche de la case (x, y), d'où la mer y mène.
fn port_vers(g: &Game, code: &str, (x, y): (i64, i64)) -> i64 {
    let mut ports: Vec<(i64, i64)> = g.owned_nodes(code).iter().map(|n| n.ati("id")).filter(|&n| C::port_de_mer(g, n))
        .map(|n| {
            let (cx, cy) = M::case_port(&g.geo, n).unwrap();
            ((cx - x).pow(2) + (cy - y).pow(2), n)
        })
        .collect();
    ports.sort();
    ports.into_iter().map(|p| p.1).find(|&n| M::chemin_mer(&g.geo, M::case_port(&g.geo, n).unwrap(), (x, y)).is_some()).expect("pas de port")
}

/// Une flotte de flûtes posée sur un comptoir, qui y prend une place.
fn au_comptoir(g: &mut Game, code: &str, id: &str, n: usize) {
    let c = g.geo.comptoirs.iter().find(|c| c.at("id") == id).unwrap();
    let (x, y) = (c.ati("x"), c.ati("y"));
    let p = port_vers(g, code, (x, y));
    let f = flotte(g, code, p, &vec!["flute"; n]);
    f.update(&dict! {"x" => x, "y" => y, "a_quai" => Val::None});
    let r = M::commande(g, code, &dict! {"sub" => "ordre", "flotte" => f.at("id"), "ordre" => "commerce", "cible" => id});
    assert!(r.atb("ok"), "{}", r.at("msg"));
}

#[test]
#[ignore]
fn partie_commerce() {
    let Some(chemin) = std::env::var_os("CONQUETE_PARTIE_COMMERCE") else { return };
    let mut g = Game::new(fabrique_campagne::geo(geo::VERSION_MONDE), "FR", &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    // l'accord commercial et sa route : avec le premier camp d'Europe qui a un port de mer
    let b = ["GB", "ES", "PT", "NL", "SE", "DK"].into_iter()
        .find(|c| g.factions.has(*c) && g.owned_nodes(c).iter().any(|n| C::port_de_mer(&g, n.ati("id")))).unwrap();
    D::apply(&mut g, "FR", b, "commerce", 0, &Val::None, &Val::None);
    let id = if "FR" < b { format!("FR-{b}") } else { format!("{b}-FR") };
    let r = g.commerce.at("routes").at(&id);
    assert!(r.at("chemin").len() > 3, "pas de route : {r}");
    // des flûtes françaises et d'un autre camp au comptoir de Mogador
    au_comptoir(&mut g, "FR", "mogador", 2);
    let x = ["NL", "PT", "ES", "SE", "DK"].into_iter()
        .find(|c| *c != b && g.factions.has(*c) && g.owned_nodes(c).iter().any(|n| C::port_de_mer(&g, n.ati("id")))).unwrap();
    au_comptoir(&mut g, x, "mogador", 1);
    // un corsaire de ce camp au milieu de la route française (sans guerre), et un incident : la France tient un casus belli
    let xp = g.owned_nodes(x).iter().map(|n| n.ati("id")).find(|&n| C::port_de_mer(&g, n)).unwrap();
    let e = flotte(&mut g, x, xp, &["corvette"]);
    let (ok, msg) = M::ordre(&mut g, x, &e.at("id"), &dict! {"ordre" => "corsaire", "cible" => "FR"});
    assert!(ok, "{msg}");
    // (près du port français, où la France le voit)
    let ch = r.at("chemin");
    let m = ch.at(if r.at("proprio") == "FR" { 10 } else { ch.len() as i64 - 11 });
    e.update(&dict! {"x" => m.at(0), "y" => m.at(1), "a_quai" => Val::None});
    C::incident(&mut g, x, "FR");
    // un abordage garanti au premier tour (vérification de la page) : l'IA ne rappelle pas son corsaire (course en cours,
    // rancune contre la France), et la graine de la partie est celle qui fait réussir le tirage de la prise au 1er du mois
    // (le même que commerce::mois)
    e.set("jusqua", g.t + 180.0);
    g.factions.at(x).at("rel").set("FR", -60);
    let t1 = py::int(conquete::turns::month_end(&g, &Val::None, 1));
    g.seed = (g.seed..)
        .find(|s| Random::new_str(&format!("{s}-corsaire-{}-{}-{t1}", e.at("id"), r.at("id"))).random() < R::CORSAIRE_PRISE)
        .unwrap();
    // la frégate et deux flûtes, une armée à bord, au port le plus proche de la route vers l'Amérique
    let route = geo::route_mer(&g.geo, "europe-amerique").unwrap();
    let p = port_vers(&g, "FR", (route.at("de").at(0).i(), route.at("de").at(1).i()));
    let f = flotte(&mut g, "FR", p, &["fregate", "flute", "flute"]);
    let regs: Val = (0..3).map(|_| g.new_reg("ligne", &Val::None, &Val::from("FR"))).collect();
    let (nx, ny) = g.node_xy(p);
    let a = g.create_army("FR", nx, ny, &regs, &Val::from(p), &Val::None, &Val::None);
    let (ok, msg) = M::embarquer(&mut g, "FR", &f.at("id"), &a.at("id"));
    assert!(ok, "{msg}");
    C::revenus(&mut g);
    g.factions.at("FR").at("res").set("livres", 20000);
    // (vérifié sur une copie relue : le premier tour joué donne l'abordage)
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let mut h = V::from_dict(g.geo.clone(), &d).unwrap();
    fabrique_campagne::jouer_mois(&mut h, 1);
    assert!(h.events.iter().any(|ev| ev.get("corsaire") == e.at("id") && ev.get("victime") == "FR"), "pas d'abordage au premier tour");
    println!("route {id}, autre camp {x}, port de la traversée {}", g.geo.nodes.at(p).at("name"));
    let meta = dict! {"player" => "FR", "faction" => g.fname("FR"), "date" => g.date_str(&Val::None), "t" => g.t, "difficulty" => "normal", "auto" => false};
    let data = dict! {"meta" => meta, "game" => V::to_dict(&mut g)};
    std::fs::write(chemin, json::dumps_avec(&data, json::Ecriture::default())).unwrap();
}
