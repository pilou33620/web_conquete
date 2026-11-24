//! La carte monde, géographie 13 (SPEC-EMPIRE.md, module 3) : l'Europe, l'Amérique et l'Inde sur une seule grille, leurs
//! routes maritimes et les comptoirs en mer ; une partie s'y crée et ses IA jouent quelques tours.
//! (Le cache des cartes dans CARGO_TARGET_TMPDIR/geo, comme tests/theatres.rs : la carte monde se fait des trois caches.)
//! `cargo test --release -p conquete --test monde -- --nocapture` imprime les temps.

use conquete::ai::AI;
use conquete::engine::Game;
use conquete::events as E;
use conquete::geo::{self, GeoMap, T_OCEAN, VERSION_MONDE};
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::turns as TT;
use conquete::views as V;
use std::rc::Rc;
use std::sync::Mutex;

static VERROU: Mutex<()> = Mutex::new(());

fn carte(v: i64) -> Rc<GeoMap> {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(v))
}

/// Les grilles compactées de /api/map (carte monde) : le format que map.js `deRle` déplie (tests/marine.test.mjs lit les
/// mêmes octets).
#[test]
fn grilles_compactees() {
    assert_eq!(geo::rle(&[0, 0, 0, 5, 5, 7], 1), "AAMFAgcB");
    assert_eq!(geo::rle(&[0; 200], 1), "AMgB"); // (200 en LEB128 : 0xC8 0x01)
    assert_eq!(geo::rle(&[1, 2, 1, 2, 0, 0], 2), "AQICAAAB");
}

#[test]
fn la_carte_monde_reunit_trois_theatres() {
    let t = std::time::Instant::now();
    let g = carte(VERSION_MONDE);
    eprintln!("carte monde : {:.1} s, {} × {} cases, {} places, {} arêtes", t.elapsed().as_secs_f64(), g.W, g.H, g.nodes.len(), g.edges.len());
    assert!(geo::connue(VERSION_MONDE) && g.theatre.is_some_and(|t| t.id == "monde") && g.km_case == 5.0);
    let ids: Vec<&str> = g.parties.iter().map(|p| p.theatre.id).collect();
    assert_eq!(ids, ["amerique", "europe", "inde"], "d'ouest en est");
    let mut n = 0;
    for p in &g.parties {
        let sub = carte(p.theatre.geo);
        // la grille du théâtre, recopiée telle quelle à son décalage
        for j in (0..sub.H).step_by(7) {
            for i in (0..sub.W).step_by(5) {
                let (a, b) = ((j * sub.W + i) as usize, ((j + p.oy) * g.W + i + p.ox) as usize);
                assert_eq!((sub.terrain[a], sub.river[a], sub.road[a]), (g.terrain[b], g.river[b], g.road[b]), "{} ({i}, {j})", p.theatre.id);
                assert_eq!(sub.dept_at(i as f64, j as f64), g.dept_at((i + p.ox) as f64, (j + p.oy) as f64));
            }
        }
        // ses places, décalées, avec leur théâtre ; ses arêtes ne sortent pas de chez lui
        assert_eq!(p.noeuds, n..n + sub.nodes.len() as i64);
        for s in sub.nodes.iter() {
            let id = s.ati("id") + p.noeuds.start;
            let m = g.nodes.at(id);
            assert_eq!((m.ati("id"), m.at("name"), m.at("theatre")), (id, s.at("name"), Val::from(p.theatre.id)));
            assert!((m.atf("x") - s.atf("x") - p.ox as f64).abs() < 0.006 && (m.atf("y") - s.atf("y") - p.oy as f64).abs() < 0.006);
            assert_eq!(g.theatre_de(id), Some(p.theatre.id));
            assert_eq!(g.theatre_case(m.atf("x"), m.atf("y")), Some(p.theatre.id));
            assert_eq!(sub.node_of_cell(s.atf("x"), s.atf("y")).map(|v| v + p.noeuds.start), g.node_of_cell(m.atf("x"), m.atf("y")));
        }
        assert_eq!(sub.theatre_de(0), Some(p.theatre.id));
        n += sub.nodes.len() as i64;
        // ses pays
        for c in &p.pays {
            assert!(g.playable_codes.has(c.as_str()) && R::theatre_du_pays(c) == Some(p.theatre.id), "{c}");
        }
        // la projection du théâtre : une place se retrouve par sa latitude et sa longitude
        let lieu = sub.nodes.at(0);
        let (lat, lon) = (sub.lat_of(lieu.atf("y")), sub.lon_of(lieu.atf("x")));
        let (x, y) = g.xy(lat, lon);
        assert!((x - g.nodes.at(p.noeuds.start).atf("x")).abs() < 0.01 && (y - g.nodes.at(p.noeuds.start).atf("y")).abs() < 0.01);
        assert!((g.lon_of(x) - lon).abs() < 1e-6 && (g.lat_of(y) - lat).abs() < 0.5 / g.KY, "latitude à une demi-case près");
    }
    assert_eq!(n, g.nodes.len() as i64);
    for e in g.edges.iter() {
        assert_eq!(g.theatre_de(e.ati("a")), g.theatre_de(e.ati("b")), "une arête relie deux théâtres : {e}");
    }
    assert_eq!(geo::theatre(VERSION_MONDE).unwrap().id, "monde");
    assert!(R::MODES().iter().any(|m| m.at("geo") == VERSION_MONDE && m.at("nom") == "Monde"), "la carte monde à l'écran de départ");
    // entre deux cartes, l'océan, à personne
    let p = &g.parties[0];
    let x = (p.ox + p.W + geo::MER_MONDE / 2) as f64;
    for y in (0..g.H).step_by(10) {
        assert!(g.terrain_at(x, y as f64) == T_OCEAN && g.dept_at(x, y as f64).is_none() && g.theatre_case(x, y as f64).is_none());
    }
}

#[test]
fn routes_maritimes_et_comptoirs() {
    let g = carte(VERSION_MONDE);
    let mer = |x: i64, y: i64| g.terrain_at(x as f64 + 0.5, y as f64 + 0.5) == T_OCEAN;
    let case = |v: &Val| (v.at(0).i(), v.at(1).i());
    assert_eq!(g.routes_mer.len(), 6);
    for (de, vers, tours) in [("europe", "amerique", 2), ("europe", "inde", 4), ("amerique", "inde", 5)] {
        for (a, b) in [(de, vers), (vers, de)] {
            let r = geo::route_mer(&g, &format!("{a}-{b}")).unwrap_or_else(|| panic!("route {a}-{b}"));
            let ((x0, y0), (x1, y1)) = (case(&r.at("de")), case(&r.at("vers")));
            assert!(mer(x0, y0) && mer(x1, y1), "{r} : des cases d'océan");
            assert_eq!(g.theatre_case(x0 as f64, y0 as f64), Some(a), "{r}");
            assert_eq!(g.theatre_case(x1 as f64, y1 as f64), Some(b), "{r}");
            assert!(r.ati("tours") == tours && r.ats("nom").starts_with("vers l'"), "{r}");
            // au bord de sa carte : à moins de 12 cases du bord de son cadre
            let p = g.parties.iter().find(|p| p.theatre.id == a).unwrap();
            let bord = (x0 - p.ox).min(p.ox + p.W - 1 - x0).min(y0 - p.oy).min(p.oy + p.H - 1 - y0);
            assert!(bord <= 12, "{r} : à {bord} cases du bord");
            assert!(g.sorties.iter().any(|s| s.at("route") == r.at("id") && s.at("case") == r.at("de") && s.at("nom") == r.at("nom")));
        }
    }
    assert_eq!(geo::route_mer(&g, "europe-europe"), None);
    assert_eq!(g.sorties.len(), 6);
    assert_eq!(geo::route_mer(&carte(geo::VERSION_EUROPE), "europe-amerique"), None, "une carte de théâtre seule n'a pas de route");
    // les comptoirs : en mer, près d'une côte, dans leur théâtre, une denrée connue
    let n = g.comptoirs.len();
    assert!((6..=10).contains(&n), "{n} comptoirs");
    for c in g.comptoirs.iter() {
        let (x, y) = (c.ati("x"), c.ati("y"));
        assert!(mer(x, y), "{c} : en mer");
        assert_eq!(g.theatre_case(x as f64, y as f64), Some(c.ats("theatre").as_str()), "{c}");
        let cote = (-4..=4).any(|j| (-4..=4).any(|i| g.terrain_at((x + i) as f64, (y + j) as f64) > geo::T_EAU));
        assert!(cote, "{c} : loin des côtes");
        assert!(["sucre", "tabac", "cafe", "coton", "the", "epices", "indigo", "ivoire", "fourrures"].contains(&c.ats("denree").as_str()), "{c}");
    }
    for t in ["amerique", "inde"] {
        assert!(g.comptoirs.iter().filter(|c| c.at("theatre") == t).count() >= 3, "{t} : des comptoirs");
    }
    // la page : les théâtres et leur cadre, les routes, les balises, les comptoirs
    let m = g.client_payload();
    assert_eq!(m.at("theatres").len(), 3);
    assert_eq!(m.at("theatres").at(1).at("cadre").at(2), g.parties[1].W);
    assert!(m.at("routes_mer").len() == 6 && m.at("sorties").len() == 6 && m.at("comptoirs").len() == n);
    assert_eq!(m.at("depts").len() as usize, g.dept_codes.len());
    let brut = json::dumps_compact(&m).len();
    eprintln!("/api/map de la carte monde : {:.1} Mo (avant gzip)", brut as f64 / 1e6);
    assert!(!carte(geo::VERSION_EUROPE).client_payload().has("theatres"), "une carte de théâtre seule ne change pas");
}

/// Les bras d'eau étroits des sources gardés par la grille (outils/theatre.mjs) : sur la carte monde, les ports du fond du
/// Saint-Laurent, de la Chesapeake, de la Delaware et de l'Hooghly mouillent sur une mer reliée au large de leur théâtre.
#[test]
fn les_ports_d_estuaire_ont_la_mer() {
    let g = carte(VERSION_MONDE);
    let port = |nom: &str| conquete::engine::marine::case_port(&g, g.by_name.at(nom).i()).unwrap_or_else(|| panic!("{nom} n'a pas la mer"));
    // (et les fleuves remontés par les navires de mer : le Saint-Laurent jusqu'à Montréal, l'Hudson jusqu'à Albany, le bas
    // Mississippi jusqu'à Bâton-Rouge, l'Hooghly jusqu'à Chandernagor)
    for (large, noms) in [
        ("Boston", &["Québec", "Baltimore", "Philadelphie", "Montréal", "Trois-Rivières", "Albany"][..]),
        ("La Havane", &["La Nouvelle-Orléans", "Bâton-Rouge"][..]),
        ("Bombay", &["Calcutta", "Surate", "Chandernagor", "Kalyan"][..]),
    ] {
        for nom in noms {
            assert!(conquete::engine::marine::chemin_mer(&g, port(nom), port(large)).is_some(), "{nom} : sa mer n'est pas reliée au large");
        }
    }
}

/// Les Grands Lacs, des eaux intérieures (outils/releve-cotes.mjs) : les lacs Érié, Huron, Michigan et Supérieur se tiennent,
/// sans lien avec l'océan ni avec le lac Ontario (les chutes du Niagara) ; une flotte se bâtit à Sandusky (lac Érié) et
/// peut gagner Amherstburg, pas Boston.
#[test]
fn les_grands_lacs_sont_des_eaux_interieures() {
    use conquete::engine::marine as M;
    let geo = carte(6); // l'Amérique
    let port = |nom: &str| M::case_port(&geo, geo.by_name.at(nom).i()).unwrap_or_else(|| panic!("{nom} n'a pas d'eau"));
    let (sandusky, amherstburg) = (port("Sandusky"), port("Amherstburg"));
    assert!(M::chemin_mer(&geo, sandusky, amherstburg).is_some(), "Sandusky et Amherstburg : le lac Érié coupé");
    for nom in ["Michilimackinac", "La Baie", "Kaministiquia"] {
        assert!(M::chemin_mer(&geo, sandusky, port(nom)).is_some(), "le lac Érié et {nom} : les lacs ne se tiennent pas");
    }
    for nom in ["Boston", "Québec", "Toronto"] {
        assert!(M::chemin_mer(&geo, sandusky, port(nom)).is_none(), "le lac Érié mène à {nom}");
    }
    assert!(M::chemin_mer(&geo, port("Toronto"), port("Boston")).is_none(), "le lac Ontario mène à la mer");
    // le chantier naval de Sandusky lance une flotte, sur le lac
    let mut g = Game::new(geo.clone(), "AIR", &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    let n = geo.by_name.at("Sandusky").i();
    g.nodes.at(n).set("owner", "AIR");
    assert!(conquete::cities::fits(&g, n, "port"), "Sandusky ne peut pas bâtir de port");
    conquete::cities::slots(&g.nodes.at(n)).set("port", 3);
    for (k, v) in [("livres", 100000), ("bois", 10000), ("fer", 10000)] {
        g.factions.at("AIR").at("res").set(k, v);
    }
    let (ok, msg) = M::construire(&mut g, "AIR", n, &Val::from("fregate"));
    assert!(ok, "{msg}");
    g.nodes.at(n).at("queue").at(-1).set("left", 0.0001);
    g.update_queues(0.01);
    let f = g.flottes.values().into_iter().find(|f| f.at("owner") == "AIR" && f.at("a_quai") == n).expect("pas de flotte à Sandusky");
    assert_eq!((f.ati("x"), f.ati("y")), sandusky);
}

#[test]
fn les_camps_du_monde() {
    let camps = R::camps(VERSION_MONDE);
    let n: usize = geo::THEATRES_MONDE.iter().map(|&v| R::camps(v).len()).sum();
    assert_eq!(camps.len(), n);
    let regles = V::rules_payload_carte(VERSION_MONDE);
    let c = regles.at("factions");
    assert_eq!(c.len(), n);
    assert_eq!((c.at("FR").at("theatre"), c.at("AFR").at("theatre"), c.at("IMO").at("theatre")), (Val::from("europe"), Val::from("amerique"), Val::from("inde")));
    assert_eq!((c.at("AFR").at("metropole"), c.at("FR").at("metropole")), (Val::from("FR"), Val::None));
    assert!(!R::FACTIONS().at("FR").has("theatre"), "FACTIONS n'est pas touché");
    for (col, met) in R::COLONIES {
        assert!(camps.iter().any(|x| x == col) && camps.iter().any(|x| x == met), "{col} {met}");
        assert_ne!(R::theatre_du_pays(col), Some("europe"));
        assert_eq!(R::theatre_du_pays(met), Some("europe"));
    }
}

/// Un « Tour suivant » : les décisions du joueur prises comme son IA (tests/europe.rs).
fn jouer_mois(g: &mut Game) {
    TT::go(g);
    for _ in 0..1000000 {
        if g.tour.at("end").is_none() || g.over.truthy() {
            return;
        }
        for x in g.pending_ev.iter() {
            let choices = x.at("choices");
            let n = choices.len() as i64;
            let ok = (0..n).find(|&i| E::affordable(g, &g.player.clone(), &choices.at(i).at("fx")));
            E::resolve(g, x.at("id").s(), ok.unwrap_or(n - 1), true);
        }
        TT::advance(g, 1.0);
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
    }
    panic!("le tour des IA ne finit pas");
}

/// Une partie monde se crée (les colonies vassales de leur métropole), ses IA jouent quatre tours, elle se sauve et se relit.
#[test]
fn une_partie_monde_se_joue() {
    let geo = carte(VERSION_MONDE);
    let t = std::time::Instant::now();
    let mut g = Game::new(geo.clone(), "FR", &Val::from("normal"), &Val::from(13), &Val::from("1700"));
    eprintln!("partie monde créée en {:.2} s ({} camps)", t.elapsed().as_secs_f64(), g.factions.len());
    assert_eq!(g.factions.len(), R::camps(VERSION_MONDE).len());
    assert_eq!(g.pays_de(), "du monde");
    for (col, met) in R::COLONIES {
        assert_eq!(g.factions.at(*col).at("overlord"), *met, "{col}");
        assert!(g.friendly(col, met));
    }
    assert!(g.factions.at("IMO").at("overlord").is_none());
    for (c, _) in g.factions.items() {
        let cap = g.capital_of(c.s());
        assert_eq!(g.nodes.at(&cap).at("owner"), c, "{c} tient sa capitale");
        assert_eq!(geo.theatre_de(cap.i()), R::theatre_du_pays(c.s()), "{c}");
    }
    let ai = AI::new(&g, "FR");
    g.ais.insert("FR".to_string(), Some(ai));
    for m in 0..4 {
        let t = std::time::Instant::now();
        jouer_mois(&mut g);
        eprintln!("tour {} des IA : {:.2} s", m + 1, t.elapsed().as_secs_f64());
    }
    assert!(g.factions.values().iter().filter(|f| f.atb("alive")).count() >= g.factions.len() - 4);
    let d = V::to_dict(&mut g);
    assert_eq!(d.at("geo"), VERSION_MONDE);
    let mut relue = V::from_dict(geo.clone(), &json::loads(&json::dumps(&d)).unwrap()).unwrap();
    jouer_mois(&mut relue);
    assert!(relue.t > g.t);
    let vue = V::player_state(&mut relue, 0);
    assert_eq!(vue.at("word"), "pays");
}

/// Banc : le temps d'un tour des IA sur chaque théâtre seul et sur la carte monde.
/// `cargo test --release -p conquete --test monde banc -- --ignored --nocapture`
#[test]
#[ignore]
fn banc_tours_des_ia() {
    // (CONQUETE_BANC_GEO=13 : une seule carte)
    let seule: Option<i64> = std::env::var("CONQUETE_BANC_GEO").ok().and_then(|s| s.parse().ok());
    let mois: usize = std::env::var("CONQUETE_BANC_MOIS").ok().and_then(|s| s.parse().ok()).unwrap_or(6); // (6 par défaut)
    for v in [2, 5, 6, 7, VERSION_MONDE].into_iter().filter(|v| seule.is_none_or(|s| s == *v)) {
        let geo = carte(v);
        let pays = match v { 2 => "33", 6 => "AFR", 7 => "IMO", _ => "FR" }; // (2 : l'Aquitaine, la Gironde)
        let t = std::time::Instant::now();
        let mut g = Game::new(geo.clone(), pays, &Val::from("normal"), &Val::from(13), &Val::from("1700"));
        let creee = t.elapsed().as_secs_f64();
        let ai = AI::new(&g, pays);
        g.ais.insert(pays.to_string(), Some(ai));
        let (mut tps, mut cpu) = (vec![], 0.0);
        for _ in 0..mois {
            let (t, c) = (std::time::Instant::now(), temps_processeur());
            jouer_mois(&mut g);
            tps.push(format!("{:.2}", t.elapsed().as_secs_f64()));
            cpu += temps_processeur() - c;
        }
        let moy = tps.iter().map(|s| s.parse::<f64>().unwrap()).sum::<f64>() / tps.len() as f64;
        // (l'empreinte de la sauvegarde : une optimisation ne doit pas la changer)
        let emp = json::empreinte_ordre(&V::to_dict(&mut g));
        eprintln!(
            "géographie {v} ({} camps) : partie créée en {creee:.2} s, tours des IA {} s (moyenne {moy:.2} s, processeur {:.2} s), empreinte {emp}",
            g.factions.len(),
            tps.join(", "),
            cpu / mois as f64
        );
    }
}

/// Le temps passé sur le processeur par ce fil, en secondes (/proc/thread-self/schedstat ; 0 ailleurs que sous Linux) :
/// moins sensible que l'horloge aux autres programmes de la machine.
fn temps_processeur() -> f64 {
    let s = std::fs::read_to_string("/proc/thread-self/schedstat").unwrap_or_default();
    s.split_whitespace().next().and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0) / 1e9
}

/// Ce que la référence garde de la carte monde : sa taille, ses théâtres, ses routes, balises et comptoirs en clair, et
/// l'empreinte de tout ce que la page en reçoit (/api/map : grilles, places, arêtes, tracés).
fn releve_monde() -> Val {
    let g = carte(VERSION_MONDE);
    let m = g.client_payload();
    conquete::dict! {"W" => g.W, "H" => g.H, "places" => g.nodes.len(), "aretes" => g.edges.len(), "theatres" => m.at("theatres"),
        "routes_mer" => &g.routes_mer, "sorties" => &g.sorties, "comptoirs" => &g.comptoirs, "empreinte" => json::empreinte_ordre(&m)}
}

/// La carte monde ne change pas sans qu'on le veuille (tests/references/monde.json, refaite par `refaire_monde`).
#[test]
fn reference_de_la_carte_monde() {
    let r = json::loads(include_str!("references/monde.json")).unwrap();
    assert!(r.len() == 9, "référence incomplète");
    let v = releve_monde();
    for (k, a) in r.items() {
        assert_eq!(json::dumps(&v.at(&k)), json::dumps(&a), "{k} a changé : refaire la référence si c'est voulu");
    }
}

/// `CONQUETE_REFAIRE_MONDE=1 cargo test --release -p conquete --test monde refaire_monde -- --ignored`
#[test]
#[ignore]
fn refaire_monde() {
    if std::env::var_os("CONQUETE_REFAIRE_MONDE").is_none() {
        return;
    }
    let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/monde.json");
    std::fs::write(chemin, json::dumps(&releve_monde()) + "\n").unwrap();
}
