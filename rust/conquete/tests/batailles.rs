//! Batailles entières contre game/tactics/ (battle, ai, units, orders, terrain…) : tests/references/batailles.json
//! est écrit par le jumeau outils/jumeau/batailles_ref.py (voir son en-tête). Chaque bataille repart de son état de
//! départ (TacticalBattle::from_dict), l'engage si besoin (déploiement de l'IA, ou « Donner mes ordres »), puis fait
//! les mêmes pas que le Python, avec les mêmes actes du joueur (dont les réponses doivent être les mêmes) ;
//! l'empreinte ordonnée de to_dict et de la vue du camp 0 tous les PAS pas doit tomber juste, et le résultat à la fin.
//!
//! Pour chercher un écart : `CONQUETE_DIAG_BATAILLE=<nom>:<pas> CONQUETE_DIAG=<dossier>` écrit la forme complète
//! (dumps_ref_ordre) de l'empreinte au pas donné dans `<dossier>/<nom>_<pas>_rs.json`, à comparer à celle que
//! `python3 outils/jumeau/batailles_ref.py <nom> <pas>` écrit (`_py.json`) ; avec `CONQUETE_TRACE_HASARD`, la trace
//! des tirages de cette bataille seule (lancer alors le seul essai de la bataille).

use conquete::geo::GeoMap;
use conquete::dict;
use conquete::py::{json, Val};
use conquete::tactics::ai as AI;
use conquete::tactics::battle::TacticalBattle;
use conquete::tactics::bridge as TB;
use conquete::tactics::orders as OR;
use std::rc::Rc;
use std::sync::Mutex;

const PAS: i64 = 10;
const LIMITE: i64 = 3000;
const LIVRES: i64 = 100;
const DESERTEURS: &str = "des déserteurs annoncent l'attaque sur l'aile : la réserve et la cavalerie s'y portent.";

fn reference() -> Val {
    json::loads(include_str!("references/batailles.json")).unwrap()
}

/// La géographie 2, relue du cache que tests/geo.rs écrit (une seule à la fois : deux fils n'écrivent pas le cache
/// ensemble).
fn geo() -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(2))
}

/// bridge.set_orders(g, tb, raw, go=True), sans la partie (outils/jumeau/batailles_ref.py : engager).
fn engager(tb: &mut TacticalBattle, raw: &Val) {
    let me = tb.me.i();
    let o = OR::clean(tb, me, raw, &Val::from(LIVRES));
    tb.spec.at("orders").set(me, &o);
    TB::default_deploy(tb, me);
    tb.start();
    OR::setup(tb, me, &o);
    if o.get("ruse") == "deserteurs" {
        AI::shift_reserve(tb, 1 - me, OR::wing_sign(&o), &Val::from(DESERTEURS));
    }
    tb.replay = dict! {"real" => 0.0, "k" => 1, "skip" => false};
    tb.log("Vos officiers engagent la bataille selon vos ordres.", &Val::None, &Val::None);
}

/// Un acte du joueur (outils/jumeau/batailles_ref.py : faire) : sa réponse.
fn faire(tb: &mut TacticalBattle, a: &Val) -> Val {
    let (ok, msg) = match a.ats(1).as_str() {
        "order" => tb.order(a.ati(2), &a.at(3), a.at(4).s(), a.at(6).s(), &a.at(5)),
        "autofinish" => tb.autofinish(),
        "resume" => tb.resume(),
        _ => tb.withdraw(a.ati(2)),
    };
    conquete::list![ok, msg]
}

fn empreinte(tb: &TacticalBattle, since: i64) -> Val {
    dict! {"etat" => tb.to_dict(), "vue" => tb.view(&Val::from(0), since)}
}

/// La fenêtre des ordres et le plan (outils/jumeau/batailles_ref.py : fenetre).
fn fenetre(tb: &mut TacticalBattle, raw: &Val) -> Val {
    let me = tb.me.i();
    let o = OR::clean(tb, me, raw, &Val::from(LIVRES));
    let groups = OR::groups(tb, me, &Val::from(LIVRES));
    let advice = OR::advise(tb, me, &o);
    let report = OR::report(tb, me);
    let place = tb.place_info().truthy();
    let arrows = OR::arrows(tb, me, &o);
    let plan = TB::plan_view(tb);
    dict! {"groups" => groups, "tabs" => OR::TABS(), "orders" => &o, "advice" => advice, "report" => report,
        "place" => place, "side" => me, "arrows" => arrows, "plan" => plan}
}

/// L'état de départ relu, engagé si besoin (outils/jumeau/batailles_ref.py : relue) ; la fenêtre des ordres
/// ('ordres') dans fen.
fn relue(geo: &Rc<GeoMap>, depart: &Val, ordres: &Val, fen: &mut Option<Val>) -> TacticalBattle {
    let mut tb = TacticalBattle::from_dict(geo.clone(), depart).unwrap();
    if tb.phase == "deploiement" {
        if tb.spec.get("mode") == "ordres" {
            *fen = Some(fenetre(&mut tb, ordres));
            engager(&mut tb, ordres);
            return tb;
        }
        for s in 0..2 {
            TB::default_deploy(&mut tb, s);
        }
        tb.warm();
        tb.start();
    }
    tb
}

fn bataille(nom: &str) {
    let r = reference();
    rejouer(&geo(), &r.iter().find(|c| c.at("nom") == nom).unwrap());
}

/// Rejoue une bataille de la référence (ou du balayage) et la compare.
fn rejouer(geo: &Rc<GeoMap>, c: &Val) {
    let nom = c.ats("nom");
    let nom = nom.as_str();
    let depart = json::loads(c.at("depart").s()).unwrap();
    // l'aller-retour des sauvegardes : relue puis réécrite, comme le Python
    let tb = TacticalBattle::from_dict(geo.clone(), &json::loads(c.at("depart").s()).unwrap()).unwrap();
    assert_eq!(json::empreinte_ordre(&tb.to_dict()), c.ats("relu"), "{nom} : from_dict puis to_dict");
    drop(tb);

    let diag = std::env::var("CONQUETE_DIAG_BATAILLE").ok().and_then(|v| {
        let (n, p) = v.split_once(':')?;
        (n == nom).then(|| p.parse::<i64>().unwrap())
    });
    let mut fen = None;
    let mut tb = relue(geo, &depart, &c.at("ordres"), &mut fen);
    if let Some(f) = &fen {
        assert_eq!(json::empreinte_ordre(f), c.ats("fenetre"), "{nom} : fenêtre des ordres ({})", json::dumps_ref_ordre(f));
    }
    let emp = c.at("emp");
    let actes = c.at("actes");
    let limite = c.get_or("limite", LIMITE).i();
    let mut ia = 0;
    let (mut n, mut since) = (0i64, 0i64);
    loop {
        if diag == Some(n) {
            let dossier = std::env::var("CONQUETE_DIAG").unwrap_or_else(|_| "/tmp".into());
            let f = format!("{dossier}/{nom}_{n}_rs.json");
            std::fs::write(&f, json::dumps_ref_ordre(&empreinte(&tb, since))).unwrap();
            conquete::py::vider_trace();
            panic!("diagnostic écrit : {f}");
        }
        if n % PAS == 0 {
            let e = json::empreinte_ordre(&empreinte(&tb, since));
            since = tb.seq;
            let k = n / PAS;
            assert!(k < emp.len() as i64, "{nom} : la bataille dure plus longtemps qu'en Python (pas {n})");
            let attendu = emp.at(k);
            if e[..16] != *attendu.s() {
                panic!("{nom} : premier écart entre le pas {} et le pas {n} (empreinte {} au lieu de {attendu})", n - PAS, &e[..16]);
            }
        }
        if tb.phase != "combat" || n >= limite {
            break;
        }
        if tb.ask.truthy() {
            OR::answer(&mut tb, if (n / PAS) % 2 == 1 { "go" } else { "wait" });
        }
        while ia < actes.len() && actes.at(ia as i64).ati(0) == n {
            let a = actes.at(ia as i64);
            let r = faire(&mut tb, &a);
            assert_eq!(json::dumps_ref(&r), json::dumps_ref(&a.at(-1)), "{nom} : réponse à l'acte {a} au pas {n}");
            ia += 1;
        }
        tb.step(2.0);
        n += 1;
    }
    assert_eq!(ia, actes.len(), "{nom} : actes du joueur");
    assert_eq!(n, c.ati("pas"), "{nom} : nombre de pas");
    assert_eq!(tb.phase, c.ats("phase"), "{nom} : phase");
    assert_eq!(tb.clock.to_bits(), c.atf("clock").to_bits(), "{nom} : heure");
    assert_eq!(json::empreinte_ordre(&tb.to_dict()), c.ats("fin"), "{nom} : état final");
    assert_eq!(json::empreinte_ordre(&tb.map_view()), c.ats("carte"), "{nom} : map_view");
    assert_eq!(json::dumps_ref_ordre(&tb.result), json::dumps_ref_ordre(&c.at("result")), "{nom} : résultat");
    if tb.result.truthy() {
        assert_eq!(json::dumps_ref_ordre(&tb.result_view(&Val::from(0))), json::dumps_ref_ordre(&c.at("view")), "{nom} : result_view");
    }
}

macro_rules! batailles {
    ($($f:ident => $nom:literal),* $(,)?) => { $(#[test] fn $f() { bataille($nom); })* };
}

batailles! {
    b1790_campagne => "1790_campagne",
    b1700_hiver_facile => "1700_hiver_facile",
    b1813_defense_pluie => "1813_defense_pluie",
    b1870_canicule => "1870_canicule",
    b1870_assaut_place => "1870_assaut_place",
    b1790_defense_place => "1790_defense_place",
    b1813_assaut_village => "1813_assaut_village",
    b1700_defense_village => "1700_defense_village",
    b1790_brouillard_facile => "1790_brouillard_facile",
    b1813_orage_difficile => "1813_orage_difficile",
    b1870_defense_tempete => "1870_defense_tempete",
    b1790_assaut_difficile => "1790_assaut_difficile",
    b1790_reprise => "1790_reprise",
    b1870_place_reprise => "1870_place_reprise",
    b1813_joueur => "1813_joueur",
    b1870_joueur_place => "1870_joueur_place",
    b1790_joueur_village_def => "1790_joueur_village_def",
    b1700_ordres => "1700_ordres",
    b1813_ordres_def => "1813_ordres_def",
    b1870_ordres_place => "1870_ordres_place",
    b1790_ordres_reprise => "1790_ordres_reprise",
    b1813_campagne => "1813_campagne",
    b1870_campagne => "1870_campagne",
    bx5034_longue => "x5034",
    bx5035_nuit => "x5035",
}

/// Des batailles tirées au sort, hors de la référence : `python3 outils/jumeau/batailles_ref.py balayage <n> <k0>
/// <fichier>` puis `CONQUETE_BALAYAGE=<fichier> cargo test --release --test batailles balayage -- --ignored`.
#[test]
#[ignore]
fn balayage() {
    let f = std::env::var("CONQUETE_BALAYAGE").expect("CONQUETE_BALAYAGE=<fichier>");
    let r = json::loads(&std::fs::read_to_string(f).unwrap()).unwrap();
    let geo = geo();
    let mut ko = vec![];
    for c in r.iter() {
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rejouer(&geo, &c))) {
            let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            ko.push(format!("{} : {m}", c.ats("nom")));
        }
    }
    assert!(ko.is_empty(), "{} sur {} :\n{}", ko.len(), r.len(), ko.join("\n"));
}

/// Le temps des batailles de la référence (sans joueur), pas seuls, sans empreinte : `cargo test --release --test
/// batailles chrono -- --ignored --nocapture` (à comparer à la même mesure en Python).
#[test]
#[ignore]
fn chrono() {
    let geo = geo();
    let (mut tot, mut npas) = (0.0, 0);
    let seule = std::env::var("CONQUETE_CHRONO").ok(); // (une seule bataille : pour un profileur)
    for c in reference().iter().filter(|c| c.at("actes").len() == 0 && seule.as_ref().map_or(true, |s| c.at("nom") == s.as_str())) {
        let t0 = std::time::Instant::now();
        let mut tb = relue(&geo, &json::loads(c.at("depart").s()).unwrap(), &c.at("ordres"), &mut None);
        let mut n = 0;
        while tb.phase == "combat" && n < LIMITE {
            if tb.ask.truthy() {
                OR::answer(&mut tb, if (n / PAS) % 2 == 1 { "go" } else { "wait" });
            }
            tb.step(2.0);
            n += 1;
        }
        let dt = t0.elapsed().as_secs_f64();
        println!("{} {n} {dt:.3}", c.ats("nom"));
        tot += dt;
        npas += n;
    }
    println!("total {tot:.2} s {npas} pas {:.3} ms/pas", tot / npas as f64 * 1000.0);
}

#[test]
fn toutes_les_batailles_ont_leur_essai() {
    assert_eq!(reference().len(), 25);
}
