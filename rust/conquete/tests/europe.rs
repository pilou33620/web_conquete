//! La géographie 5, la carte du mode « Europe » (SPEC-FRANCE.md, étape 2) : game/data/europe.json, places_europe.json,
//! pays_europe.json, epoques_europe.json (outils/europe.mjs). La carte se fait et se relit, ses 32 pays se jouent, une
//! campagne va au bout, une sauvegarde se relit.
//! (Le cache de la carte dans CARGO_TARGET_TMPDIR/geo, comme tests/geo4.rs ; le serveur : tests/bancs_serveur.rs.)

use conquete::ai::AI;
use conquete::engine::Game;
use conquete::events as E;
use conquete::geo::{GeoMap, T_EAU, T_OCEAN, VERSION_EUROPE};
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::turns as TT;
use conquete::views as V;
use conquete::dict;
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Mutex;

static VERROU: Mutex<()> = Mutex::new(());

fn dossier() -> std::path::PathBuf {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    d
}

/// Une carte, relue du cache que les essais partagent (ou générée la première fois) ; une seule à la fois.
fn carte(v: i64) -> Rc<GeoMap> {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    dossier();
    Rc::new(GeoMap::new(v))
}

/// La carte d'Europe.
fn geo() -> Rc<GeoMap> {
    carte(VERSION_EUROPE)
}

/// Une partie où le camp du joueur est gouverné par une IA, comme les 31 autres.
fn partie(geo: &Rc<GeoMap>, pays: &str, graine: i64, debut: &str) -> Game {
    let mut g = Game::new(geo.clone(), pays, &Val::from("normal"), &Val::from(graine), &Val::from(debut));
    let ai = AI::new(&g, pays);
    g.ais.insert(pays.to_string(), Some(ai));
    g
}

/// Un « Tour suivant » : les décisions du joueur prises comme son IA (tests/campagnes.rs, mode 'ia').
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

/// Les places qu'on atteint depuis la première par les arêtes (toutes, ou les routes seulement).
fn atteintes(geo: &GeoMap, eau: bool) -> HashSet<usize> {
    let mut vus: HashSet<usize> = HashSet::from([0]);
    let mut pile: Vec<usize> = vec![0];
    while let Some(n) = pile.pop() {
        for eid in geo.adj.at(n).iter() {
            let e = geo.edges.at(&eid);
            if !eau && e.get("kind") == "water" {
                continue;
            }
            let m = if e.at("a").u() == n { e.at("b").u() } else { e.at("a").u() };
            if vus.insert(m) {
                pile.push(m);
            }
        }
    }
    vus
}

#[test]
fn la_carte_se_fait_et_se_relit() {
    let (faite, relue) = {
        let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
        let cache = dossier().join("map_cache_v5.json");
        let _ = std::fs::remove_file(&cache);
        let t = std::time::Instant::now();
        let faite = GeoMap::new(VERSION_EUROPE);
        eprintln!("carte 5 générée en {:.1} s", t.elapsed().as_secs_f64());
        assert!(cache.exists(), "le cache de la carte 5 : map_cache_v5.json");
        let avant = std::fs::metadata(&cache).unwrap().modified().unwrap();
        let relue = GeoMap::new(VERSION_EUROPE);
        assert_eq!(std::fs::metadata(&cache).unwrap().modified().unwrap(), avant, "la seconde fois, le cache est relu, pas refait");
        (faite, relue)
    };
    assert_eq!((faite.version, faite.suffixe.as_str(), faite.km_case), (5, "_v5", 5.0));
    assert_ne!(faite._src_hash(), carte(4)._src_hash());
    assert_eq!((faite.W, faite.H), (867, 733), "la grille visée par outils/europe.mjs");
    assert_eq!(faite._src_hash(), relue._src_hash());
    assert!(faite.terrain == relue.terrain && faite.dept == relue.dept && faite.river == relue.river && faite.road == relue.road && faite.cellnode == relue.cellnode);
    assert_eq!(json::dumps(&faite.edges), json::dumps(&relue.edges));
    assert_eq!(json::dumps(&faite.client_payload()), json::dumps(&relue.client_payload()), "la page reçoit la même carte");
    // la projection : Paris, à 5 km par case
    let (x, y) = faite.xy(48.8566, 2.3522);
    assert!((x - 1032.3 / 5.0).abs() < 0.5 && (y - 1458.2 / 5.0).abs() < 0.5, "Paris en ({x}, {y})");
    assert!((faite.lat_of(y) - 48.8566).abs() < 1e-9 && (faite.lon_of(x) - 2.3522).abs() < 1e-9);
    // tous les types de terrain du jeu y sont, et aucun autre
    let mut vus = [0usize; 11];
    for &t in &faite.terrain {
        vus[t as usize] += 1;
    }
    assert!(vus.iter().all(|&n| n > 1000), "terrains : {vus:?}");
}

#[test]
fn les_cartes_au_kilometre_gardent_leur_projection() {
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    dossier();
    let g = GeoMap::new(2);
    assert_eq!((g.km_case, g.KY.to_bits(), g.KX.to_bits()), (1.0, conquete::geo::KY.to_bits(), conquete::geo::KX().to_bits()));
}

#[test]
fn trente_deux_pays_une_capitale_chacun_et_tout_est_relie() {
    let geo = geo();
    assert_eq!(geo.nodes.len(), 1258);
    assert_eq!(geo.playable_codes.len(), 32);
    let pays = R::camps(true);
    assert_eq!(pays.len(), 32);
    for c in &pays {
        assert!(geo.playable_codes.has(c), "{c} n'est pas jouable");
        let caps: Vec<Val> = geo.nodes.iter().filter(|n| n.at("dept") == *c && n.at("type") == "capitale").collect();
        assert_eq!(caps.len(), 1, "{c} : une capitale");
        assert_eq!(caps[0].at("name"), R::FACTIONS().at(c).at("capital"), "{c}");
        assert!(geo.nodes.iter().filter(|n| n.at("dept") == *c).count() >= 3, "{c} : au moins trois places");
    }
    // un camp de France n'est pas de cette carte, et inversement
    assert!(R::camps(false).iter().all(|c| !geo.playable_codes.has(c)));
    assert_eq!(R::camps(false).len(), 89);
    // chaque place est sur une case de terre de son pays, et dans une étiquette que le jeu connaît ou ignore sans planter
    for n in geo.nodes.iter() {
        let (x, y) = (n.atf("x"), n.atf("y"));
        assert!(geo.terrain_at(x, y) != T_OCEAN && geo.terrain_at(x, y) != T_EAU, "{} dans l'eau", n.at("name"));
        assert_eq!(geo.dept_at(x, y), Some(n.at("dept").s()), "{}", n.at("name"));
        assert_eq!(geo.node_of_cell(x, y).is_some(), true, "{}", n.at("name"));
    }
    // tout le réseau d'un seul tenant, voies d'eau comprises ; par la route seule, il reste les îles
    assert_eq!(atteintes(&geo, true).len(), geo.nodes.len(), "des places ne sont reliées à rien");
    let par_route = atteintes(&geo, false);
    let iles: Vec<String> = geo.nodes.iter().filter(|n| !par_route.contains(&n.at("id").u())).map(|n| n.ats("name")).collect();
    eprintln!("{} places hors du réseau des routes du continent (îles, reliées par mer) : {}", iles.len(), iles.join(", "));
    for nom in ["La Valette", "Candie", "Palma", "Cagliari", "Ajaccio", "Dublin", "Londres", "Nicosie"] {
        assert!(iles.iter().any(|i| i == nom), "{nom} devrait être sur une île");
    }
    for nom in ["Paris", "Moscou", "Constantinople", "Lisbonne", "Naples", "Alger", "Le Caire", "Messine", "Copenhague", "Stockholm"] {
        let id = geo.by_name.at(nom).u();
        assert!(par_route.contains(&id), "{nom} n'est pas relié au continent par la route (bacs compris)");
        assert!(geo.adj.at(id).len() >= 1);
    }
    // les voies de mer sont des arêtes d'eau, de port à port ; les fleuves de rang 1 sont navigables
    let mers: Vec<Val> = geo.edges.iter().filter(|e| e.get("kind") == "water" && e.atb("sea")).collect();
    assert!(mers.len() >= 20 && mers.len() <= 45, "{} voies de mer", mers.len());
    for nom in ["Danube", "Rhin", "Volga", "Nil"] {
        assert!(geo.ways.has(nom) && geo.ways.at(nom).at("ports").len() >= 2, "{nom} n'est pas navigable");
    }
    // les routes de poste partent des capitales
    let paris = geo.by_name.at("Paris");
    assert!(geo.adj.at(&paris).iter().any(|e| geo.edges.at(&e).atb("royal")), "pas de route royale à Paris");
    // les chemins de fer : un réseau par pays, de 1837 à 1885
    let secs = conquete::rails::sections(&geo);
    assert!(secs.len() >= 150, "{} tronçons", secs.len());
    assert!(secs.values().iter().all(|s| (1837..=1885).contains(&s.ati("year")) && !s.at("edges").is_empty()));
    assert!(conquete::rails::client_payload(&geo).at("exits").is_empty());
    // la crue (Garonne, Dordogne) ne coupe rien ici
    assert!(conquete::crue::spans(&geo).is_empty());
}

#[test]
fn trajectoires_des_villes() {
    let geo = geo();
    let pop = |cle: &str, an: f64| {
        let (nom, pays) = cle.split_once('|').unwrap();
        let n = geo.nodes.iter().find(|n| n.at("name") == nom && n.at("dept") == pays).unwrap_or_else(|| panic!("{cle}"));
        n.atf("pop0") * conquete::engine::curve_at(&R::pop_curve(&n), an).0
    };
    // (habitants de 1900 : outils/europe/epoques.json ; le coefficient est arrondi au millième)
    for (cle, attendu) in [("Londres|GB", 6_200_000.0), ("Odessa|OT", 405_000.0), ("Lodz|PL", 300_000.0), ("Saint-Pétersbourg|RU", 1_250_000.0)] {
        let p = pop(cle, 1900.0);
        assert!((p - attendu).abs() < attendu * 0.001, "{cle} : {p} habitants en 1900");
        assert!((pop(cle, 1790.0) - geo.nodes.iter().find(|n| format!("{}|{}", n.at("name").s(), n.at("dept").s()) == cle).unwrap().atf("pop0")).abs() < 1e-6);
    }
    assert!((pop("Saint-Pétersbourg|RU", 1700.0) - 440.0).abs() < 1.0, "Saint-Pétersbourg n'est qu'un hameau en 1700");
    // une place sans trajectoire : la courbe ordinaire d'Europe, jamais celles de la France (Bordeaux, Paris ont la leur ici)
    for n in geo.nodes.iter() {
        let cv = R::pop_curve(&n);
        let cle = format!("{}|{}", n.at("name").s(), n.at("dept").s());
        if !R::EPOQUES_EUROPE().has(cle.as_str()) {
            assert!(cv.is(&R::POP_EUROPE().at(if n.at("type") == "village" { "rural" } else { "ville" })), "{cle}");
        }
        // toutes les étiquettes sont connues de la page, tous les coefficients sont positifs et finis
        for p in cv.iter() {
            assert!(R::POP_WHY().has(p.at(2)), "{cle} : étiquette {}", p.at(2));
            assert!(p.atf(1) > 0.0 && p.atf(1) <= 1000.0, "{cle} : {}", p.at(1));
        }
    }
    assert!(!R::pop_curve(&geo.nodes.at(geo.by_name.at("Bordeaux"))).is(&R::POP_CURVES().at("bordeaux")));
    // chaque clé d'epoques_europe.json est une place de la carte
    for cle in R::EPOQUES_EUROPE().keys() {
        assert!(geo.nodes.iter().any(|n| format!("{}|{}", n.at("name").s(), n.at("dept").s()) == cle.s()), "{cle} : place inconnue");
    }
    // la production suit la racine quatrième de la trajectoire : même Lodz en 1900 (× 1 000) reste dans un ordre sensé
    let mut g = partie(&geo, "PL", 1, "1870");
    let lodz = g.nodes.at(geo.nodes.iter().find(|n| n.at("name") == "Lodz").unwrap().at("id"));
    let f = g.pop_factor(&lodz);
    assert!(f.is_finite() && f > 0.2 && f < 8.0, "Lodz en 1870 : production × {f}");
    jouer_mois(&mut g);
    assert!(g.nodes.iter().all(|n| n.atf("pop").is_finite() && n.atf("pop") >= 1.0));
}

#[test]
fn une_partie_pour_trois_pays_a_chaque_debut() {
    let geo = geo();
    for pays in ["RU", "ML", "TU"] {
        for debut in ["1700", "1790", "1813", "1870"] {
            let mut g = Game::new(geo.clone(), pays, &Val::from("normal"), &Val::from(7), &Val::from(debut));
            assert_eq!(g.factions.len(), 32, "{pays} {debut}");
            assert_eq!(g.ais.len(), 31);
            assert_eq!((g.dept_word(), g.pays_de()), ("pays", "d'Europe"));
            for (c, f) in g.factions.items() {
                let cap = g.capital_of(c.s());
                assert_eq!(g.nodes.at(&cap).at("owner"), c, "{c} tient sa capitale");
                assert!(g.nodes.at(&cap).at("garrison").len() >= 1, "{c} : une garnison à sa capitale");
                assert!(g.armies.values().iter().any(|a| a.at("owner") == c), "{c} a son armée");
                assert!(f.ati("start_nodes") >= 1 && f.at("maison").at("chef").ats("nom").len() > 3);
                assert!(f.at("income").values().iter().all(|v| v.f().is_finite()), "{c} : revenus");
            }
            assert_eq!(g.fname(pays), R::FACTIONS().at(pays).ats("name"));
            // des noms de chez eux, écrits à la française : maisons et généraux russes en Russie, français en France
            for a in g.armies.values().iter().filter(|a| a.at("owner") == "RU" && a.get("gen").truthy()) {
                assert!(R::surnames("RU").has(a.at("gen").at("name")) && R::surnames("RU").has("Souvorov"), "{}", a.at("gen").at("name"));
            }
            assert!(R::MAISON_NOMS().at("RU").has(g.factions.at("RU").at("maison").at("nom")));
            assert!(R::prenoms("RU").has("Pierre") && R::surnames("FR").is(&R::SURNAMES()) && R::surnames("33").is(&R::SURNAMES()));
            let journal = json::dumps(&g.events);
            assert!(!journal.contains("département") && !journal.contains("chefs-lieux"), "{pays} {debut} : {journal}");
            // les lignes ouvertes avant le début de la partie le sont déjà (les premières : 1837)
            if debut == "1870" {
                assert!(g.rails.len() > 100, "{} tronçons ouverts en 1870", g.rails.len());
            } else {
                assert!(g.rails.is_empty(), "{pays} {debut}");
            }
            // la vue du joueur et la sauvegarde se font
            let vue = V::player_state(&mut g, 0);
            assert_eq!(vue.at("word"), "pays");
            assert!(V::to_dict(&mut g).at("geo") == 5);
        }
    }
    // un camp d'une autre carte n'entre pas dans la partie
    let g = Game::new(geo.clone(), "FR", &Val::from("normal"), &Val::from(1), &Val::from("1700"));
    assert!(!g.factions.has("33") && !g.factions.has("75"));
}

const MOIS: i64 = 24;

/// 24 mois avec les 32 IA, deux fois à la même graine : la même partie, au bit près ; la sauvegarde se relit.
#[test]
fn campagne_de_24_mois_deux_fois_la_meme() {
    let geo = geo();
    let jouer = || {
        let mut g = partie(&geo, "FR", 1700, "1700");
        let t = std::time::Instant::now();
        for _ in 0..MOIS {
            jouer_mois(&mut g);
        }
        eprintln!("24 mois d'Europe en {:.1} s", t.elapsed().as_secs_f64());
        g
    };
    let (mut a, mut b) = (jouer(), jouer());
    assert_eq!(a.date(&Val::None).year, 1700 + (2 + MOIS) / 12);
    let (da, db) = (V::to_dict(&mut a), V::to_dict(&mut b));
    assert_eq!(json::empreinte_ordre(&da), json::empreinte_ordre(&db), "la même graine ne donne pas la même partie");
    assert!(a.factions.values().iter().filter(|f| f.atb("alive")).count() >= 24, "des pays ont disparu en deux ans");
    for (c, f) in a.factions.items() {
        for (r, v) in f.at("res").items() {
            assert!(v.f().is_finite() && v.f() > -1e6 && v.f() < 1e8, "{c} : {r} = {v}");
        }
    }
    // la sauvegarde : relue, c'est l'état sauvegardé. (Le chargement complète une sauvegarde, emplacements des places,
    // champs par défaut des armées, recalcule les revenus du jour et ne rend pas d'IA au camp du joueur : on compare ce
    // qui a été écrit, hors revenus (income, _gross_livres…) et compteur des généraux (gid).)
    fn premier(a: &Val, b: &Val, chemin: String) -> Option<String> {
        if a.is_dict() && b.is_dict() {
            return a.items().into_iter().filter(|(k, _)| *k != "income" && *k != "gid" && !k.s().starts_with('_')).find_map(|(k, v)| premier(&v, &b.get(&k), format!("{chemin}.{k}")));
        }
        if a.is_list() && b.is_list() && a.len() == b.len() {
            return a.iter().zip(b.iter()).enumerate().find_map(|(i, (x, y))| premier(&x, &y, format!("{chemin}[{i}]")));
        }
        (json::dumps(a) != json::dumps(b)).then(|| format!("{chemin} : {} / {}", json::dumps(a).chars().take(200).collect::<String>(), json::dumps(b).chars().take(200).collect::<String>()))
    }
    let texte = json::dumps(&da);
    let mut relue = V::from_dict(geo.clone(), &json::loads(&texte).unwrap()).unwrap();
    let dr = V::to_dict(&mut relue);
    let ecarts: Vec<String> = da.keys().iter().filter(|k| *k != "ai_state").filter_map(|k| premier(&da.at(k), &dr.get(k), k.string())).collect();
    assert!(ecarts.is_empty() && da.len() == dr.len(), "une sauvegarde relue n'est pas l'état sauvegardé : {ecarts:?}");
    assert!(dr.at("ai_state").len() == 31 && dr.at("ai_state").items().iter().all(|(c, v)| json::dumps(v) == json::dumps(&da.at("ai_state").at(c))), "les IA relues");
    assert!(V::from_dict(carte(4), &json::loads(&texte).unwrap()).is_err(), "jamais sur la carte de France");
    // et la partie relue continue
    jouer_mois(&mut relue);
    assert!(relue.t > a.t);
}

#[test]
fn les_regles_d_une_carte_ne_donnent_que_ses_camps() {
    let (fr, eu) = (V::rules_payload_carte(false), V::rules_payload_carte(true));
    assert_eq!(json::dumps(&fr), json::dumps(&V::rules_payload()));
    assert_eq!((fr.at("factions").len(), eu.at("factions").len()), (89, 32));
    assert!(eu.at("factions").has("RU") && !eu.at("factions").has("33") && !fr.at("factions").has("RU"));
    assert_eq!(eu.at("scenario_order"), fr.at("scenario_order"));
    for (k, sc) in eu.at("scenarios").items() {
        assert_eq!(sc.at("word"), "pays");
        assert_eq!(sc.ats("title"), format!("Europe, {k}"));
        assert_eq!(sc.at("names").len(), 32);
        assert_eq!(sc.at("techs_before"), fr.at("scenarios").at(&k).at("techs_before"));
        assert_eq!(sc.at("year"), fr.at("scenarios").at(&k).at("year"));
        assert!(fr.at("scenarios").at(&k).ats("title").starts_with("France"));
    }
    assert_eq!(eu.at("eras").len(), fr.at("eras").len());
    for (a, b) in eu.at("eras").iter().zip(fr.at("eras").iter()) {
        assert_eq!((a.at("id"), a.at("year")), (b.at("id"), b.at("year")));
    }
    // les distances des règles sont des cases : 5 km en Europe (le texte de la France ne change pas) ; la portée des
    // canons La Hitte se compte sur le champ de bataille, en vrais kilomètres
    let desc = |p: &Val, id: &str| p.at("techs").iter().find(|t| t.at("id") == id).unwrap().ats("desc");
    for (id, fr_, eu_) in [("hussards", "vision +6 km", "vision +30 km"), ("aerostiers", "vision +3 km", "vision +15 km"), ("chappe", "villes +10 km", "villes +50 km"),
        ("telegraphe", "villes +15 km, des armées +4 km", "villes +75 km, des armées +20 km"), ("telephone", "villes +10 km", "villes +50 km"), ("lahitte", "à 3 km", "à 3 km"),
        ("vauban", "dans le chef-lieu", "dans la capitale")] {
        assert!(desc(&fr, id).contains(fr_) && desc(&eu, id).contains(eu_), "{id} : {} / {}", desc(&fr, id), desc(&eu, id));
    }
    assert!(eu.at("spy").at("espionner").ats("desc").contains("(70 km)") && fr.at("spy").at("espionner").ats("desc").contains("(14 km)"));
    assert!(eu.at("build").at("depot").ats("desc").contains("moins de 150 km") && fr.at("build").at("depot").ats("desc").contains("moins de 30 km"));
    let depot = |p: &Val| p.at("cities").at("chains").at("depot").at("levels").at(0).ats("txt");
    assert!(depot(&eu).contains("150 km") && depot(&fr).contains("30 km"), "{}", depot(&eu));
    assert!(R::SPY().at("espionner").ats("desc").contains("(14 km)"), "la table des règles n'est pas touchée");
    assert_eq!(V::km_carte("vision +6 km, à 3 km, (14 km), à moins de 30 km, 1 500 mètres", 5.0), "vision +30 km, à 3 km, (70 km), à moins de 150 km, 1 500 mètres");
    // chaque pays a tout ce qu'un camp reçoit
    for c in R::camps(true) {
        let f = R::FACTIONS().at(&c);
        for k in ["name", "short", "capital", "color", "adj", "title", "pros", "cons", "mods", "personality", "specialty"] {
            assert!(f.has(k), "{c} : {k}");
        }
        assert!(R::MAISON_NOMS().at(&c).len() == 8 && R::PROVINCES().has(&c) && conquete::ai::MIX().has(&c), "{c}");
    }
}

/// Une bataille de campagne livrée sur le champ de bataille (« Donner mes ordres »), jusqu'au bout : les armées de départ
/// de la France et des Pays-Bas du Sud, doublées, se rencontrent en rase campagne (tests/fabrique_campagne :
/// bataille_de_campagne). Le champ est tiré de la carte à son échelle : une case y vaut 5 km (voir
/// le_champ_de_bataille_lit_la_carte_a_cinq_km_par_case).
#[test]
fn bataille_de_campagne_jouee_jusqu_au_bout() {
    use conquete::engine::raccord as TB;
    let geo = geo();
    let mut g = Game::new(geo.clone(), "FR", &Val::from("normal"), &Val::from(3), &Val::from("1813"));
    let armee = |g: &Game, c: &str| g.armies.values().into_iter().find(|a| a.at("owner") == c).unwrap();
    let (a, b) = (armee(&g, "FR"), armee(&g, "BE"));
    // un point de plaine à plus de cinq cases de toute place, au plus près de l'armée française
    let mut ou: Option<(f64, f64, f64)> = None;
    for dx in (-30..31).step_by(2) {
        for dy in (-30..31).step_by(2) {
            let (x, y) = (a.atf("x") + dx as f64, a.atf("y") + dy as f64);
            let pres = geo.nodes.iter().map(|n| (n.atf("x") - x).powi(2) + (n.atf("y") - y).powi(2)).fold(f64::MAX, f64::min);
            let d = (dx * dx + dy * dy) as f64;
            if pres > 25.0 && geo.playable_at(x, y) && geo.playable_at(x + 1.0, y) && ou.is_none_or(|o| d < o.0) {
                ou = Some((d, x, y));
            }
        }
    }
    let (_, x, y) = ou.unwrap();
    for k in [&a, &b] {
        let plus: Vec<Val> = k.at("regs").iter().map(|r| { let c = r.deepcopy(); c.set("id", format!("{}b", r.at("id"))); c }).collect();
        k.at("regs").extend(&Val::list(plus));
        k.set("at_node", Val::None);
        k.set("state", "idle");
    }
    (a.set("x", x), a.set("y", y), b.set("x", x + 1.0), b.set("y", y));
    conquete::diplomacy::declare_war(&mut g, "BE", "FR", true);
    g.order_move("FR", &a.at("id"), &dict! {"x" => b.at("x"), "y" => b.at("y")});
    TT::go(&mut g);
    for _ in 0..80 {
        TT::advance(&mut g, 0.1);
        if g.tour.at("stop").truthy() {
            break;
        }
    }
    let bt = g.battles.values().into_iter().find(|bt| bt.get("mode") == "attente").expect("pas de bataille en attente");
    // (SPEC-BATAILLE.md) plus de champ de bataille : le joueur choisit sa stratégie, la bataille se règle par phases
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "ordres"});
    assert!(!r.atb("ok"), "{r}");
    assert_eq!(bt.at("sit"), "campagne");
    let st = V::player_state(&mut g, 0);
    let vue = st.at("battles").iter().find(|b| b.at("id") == bt.at("id")).unwrap();
    let choix = vue.at("choix").iter().find(|c| c.at("why") == "").unwrap().at("id");
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => &choix});
    assert!(r.atb("ok"), "{r}");
    let mut n = 0;
    while g.battles.has(bt.at("id")) {
        if bt.get("mode") == "poursuite" {
            assert!(TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => true}).atb("ok"));
        } else {
            TT::advance(&mut g, 0.1);
            if g.tour.at("stop").truthy() && g.speed_idx == 0 && !TB::en_attente(&bt) {
                TT::go(&mut g);
            }
        }
        n += 1;
        assert!(n < 100000, "la bataille ne finit pas");
    }
    let fin = g.events.iter().filter(|e| e.at("kind") == "battle_end" && e.get("bid") == bt.at("id")).last().expect("le résultat au journal");
    assert!(fin.at("journal").len() >= 1 && fin.at("strats").at(0) == choix, "{fin}");
    assert!(!g.battles.has(bt.at("id")) || g.battles.at(bt.at("id")).get("mode") != "attente", "la bataille est finie");
    // et le mois reprend
    TT::go(&mut g);
    jouer_mois(&mut g);
}

/// Les hommes d'un camp, armées et garnisons.
fn hommes(g: &Game, c: &str) -> f64 {
    let regs = |l: Val| l.iter().map(|r| r.atf("n")).sum::<f64>();
    g.armies.values().iter().filter(|a| a.at("owner") == c).map(|a| regs(a.at("regs"))).sum::<f64>()
        + g.nodes.iter().filter(|n| n.at("owner") == c).map(|n| regs(n.at("garrison"))).sum::<f64>()
}

/// Les moyens de départ suivent la puissance des pays (R::MOYENS_EUROPE) : la Russie arme bien plus que Malte, la
/// Grande-Bretagne a le plus gros trésor, la Prusse grandit entre 1700 et 1790 ; le plancher de production suit le poids
/// du pays. Une partie de France ne change pas : six régiments et 500 livres par département.
#[test]
fn moyens_de_depart_a_l_echelle_des_pays() {
    let geo = geo();
    let g = Game::new(geo.clone(), "FR", &Val::from("normal"), &Val::from(1), &Val::from("1700"));
    let livres = |g: &Game, c: &str| g.factions.at(c).at("res").atf("livres");
    let (ru, ml, fr, pr, gb) = (hommes(&g, "RU"), hommes(&g, "ML"), hommes(&g, "FR"), hommes(&g, "PR"), hommes(&g, "GB"));
    eprintln!("1700 : RU {ru}, ML {ml}, FR {fr}, PR {pr}, GB {gb} hommes");
    assert!(ru > 12.0 * ml && fr > 2.0 * pr && fr > 3.0 * gb && ru > 2.0 * pr, "RU {ru}, ML {ml}, FR {fr}, PR {pr}, GB {gb}");
    assert!(ml <= 400.0 && fr >= 3500.0, "Malte {ml}, France {fr}");
    assert!(livres(&g, "GB") > livres(&g, "FR") && livres(&g, "FR") > 5.0 * livres(&g, "ML") && livres(&g, "NL") > livres(&g, "RU"));
    let plancher = |c: &str| g.factions.at(c).at("_floor").at("livres").atf("min");
    assert!(plancher("ML") * 5.0 <= plancher("RU") && plancher("RU") == 20.0, "plancher : Malte {}, Russie {}", plancher("ML"), plancher("RU"));
    // en 1790, la Prusse et la Russie ont grandi, la Suède a baissé
    let g90 = Game::new(geo.clone(), "FR", &Val::from("normal"), &Val::from(1), &Val::from("1790"));
    assert!(hommes(&g90, "PR") > 3.0 * pr && hommes(&g90, "RU") > 1.5 * ru && hommes(&g90, "SE") < hommes(&g, "SE"));
    // chaque pays a une armée en campagne et une garnison à sa capitale, et les grandes villes produisent plus
    for c in R::camps(true) {
        assert!(g.armies.values().iter().any(|a| a.at("owner") == c) && g.nodes.at(g.capital_of(c.s())).at("garrison").len() >= 1, "{c}");
    }
    let mut g = g;
    let prod = |g: &mut Game, nom: &str| { let n = g.nodes.at(geo.by_name.at(nom)); let o = n.at("owner").string(); g.node_output(&n, &o).atf("livres") };
    assert!(prod(&mut g, "Paris") > 3.0 * prod(&mut g, "Bakhtchissaraï"), "Paris {} / Bakhtchissaraï {}", prod(&mut g, "Paris"), prod(&mut g, "Bakhtchissaraï"));
    // la France des départements : rien de changé
    let gf = Game::new(carte(4), "33", &Val::from("normal"), &Val::from(1), &Val::from("1790"));
    for c in ["33", "75", "13"] {
        assert_eq!((hommes(&gf, c), livres(&gf, c)), (1540.0, 500.0), "{c}");
    }
}

/// La Scandinavie tient au continent par ses détroits (bacs du Grand et du Petit Belt, de l'Øresund) et la Suède à la
/// Finlande par la mer d'Åland ; la Finlande tient à la Russie par la terre (Carélie). (La carte s'arrête au 62e parallèle :
/// le fond du golfe de Botnie, par où la Suède touche la Finlande, est hors du cadre.)
#[test]
fn la_scandinavie_tient_au_continent_par_ses_detroits() {
    let geo = geo();
    let id = |nom: &str| geo.by_name.at(nom).u();
    let arete = |a: &str, b: &str| geo.edges.iter().find(|e| { let (x, y) = (e.at("a").u(), e.at("b").u()); (x, y) == (id(a), id(b)) || (x, y) == (id(b), id(a)) });
    for (detroit, a, b) in conquete::geo::BACS_5 {
        let e = arete(a, b).unwrap_or_else(|| panic!("pas de bac {a} – {b}"));
        assert!(e.atb("ferry") && e.at("river") == detroit, "{a} – {b} : {e}");
    }
    for (a, b) in [("Stockholm", "Mariehamn"), ("Mariehamn", "Åbo"), ("Kiel", "Copenhague"), ("Stralsund", "Ystad")] {
        let e = arete(a, b).unwrap_or_else(|| panic!("pas de voie de mer {a} – {b}"));
        assert!(e.get("kind") == "water" && e.get("sea").truthy(), "{a} – {b}");
    }
    assert!(arete("Revel", "Helsingfors").is_none(), "pas de route à travers le golfe de Finlande");
    // par la route, bacs compris (sans les voies de mer)
    let par_route = atteintes(&geo, false);
    for nom in ["Copenhague", "Stockholm", "Christiania", "Göteborg", "Bergen", "Malmö", "Helsingfors", "Åbo"] {
        assert!(par_route.contains(&id(nom)), "{nom} n'est pas relié au continent par la route");
    }
    // la Finlande par la terre seule, sans bac : de Moscou à Helsingfors
    let mut vus: HashSet<usize> = HashSet::from([id("Moscou")]);
    let mut pile = vec![id("Moscou")];
    while let Some(n) = pile.pop() {
        for eid in geo.adj.at(n).iter() {
            let e = geo.edges.at(&eid);
            if e.get("kind") == "water" || e.atb("ferry") {
                continue;
            }
            let m = if e.at("a").u() == n { e.at("b").u() } else { e.at("a").u() };
            if vus.insert(m) {
                pile.push(m);
            }
        }
    }
    assert!(vus.contains(&id("Helsingfors")) && vus.contains(&id("Åbo")) && !vus.contains(&id("Stockholm")));
    // Bornholm n'est plus le seul lien : une voie de mer de Rønne, et pas vers Colberg
    assert!(arete("Rønne", "Colberg").is_none());
}
