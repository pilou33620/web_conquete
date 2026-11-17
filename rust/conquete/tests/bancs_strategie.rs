//! Banc d'essai de la bataille par stratégie (SPEC-BATAILLE.md) : situations, armes, stratégies et contres, phases et
//! journal, terrain, temps, moral et fatigue, renforts, reconnaissance, poursuite, prises, vétérans, sièges et
//! capitulation, aperçu, traces, anciennes sauvegardes. Écrit en Rust (pas de jumeau Python).
//!
//! Le duel : l'armée du joueur (Gironde) et celle de la Dordogne, posées en rase campagne loin de toute place, la
//! guerre déclarée, la bataille engagée par start_battle. Pour mesurer une règle, on fixe les stratégies des deux
//! camps, on fait un pas (un_pas) et on lit la puissance de chaque camp par arme dans le journal en cours (bt['jp']).
#![allow(non_snake_case)]

mod fabrique_campagne;

use conquete::army_actions as AA;
use conquete::diplomacy as D;
use conquete::engine::{Game, SUBSTEP};
use conquete::py::{self, json, Val};
use conquete::rules as R;
use conquete::engine::raccord as TB;
use conquete::turns as TT;
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{armee, armee_de, bataille_de_campagne, partie, partie_avec, GEO};

const FOE: &str = "24";

/// Un point de plaine loin de toute place, près de l'armée a.
fn plaine(g: &Game, a: &Val) -> (f64, f64) {
    for d in 3..60 {
        for (dx, dy) in [(d, 0), (0, d), (-d, 0), (0, -d), (d, d), (-d, -d)] {
            let (x, y) = (a.atf("x") + dx as f64 * 2.0, a.atf("y") + dy as f64 * 2.0);
            let loin = g.geo.nodes.iter().all(|n| py::hypot(n.atf("x") - x, n.atf("y") - y) > 12.0);
            if loin && g.geo.cell(x, y) >= 0 && conquete::geo::TERRAIN().at(g.geo.terrain_at(x, y)).at(0) == "Plaine" {
                return (x, y);
            }
        }
    }
    panic!("pas de plaine");
}

/// Les deux armées du duel, en rase campagne, en guerre ; chacune reçoit un régiment de chaque arme en plus.
fn camps(g: &mut Game) -> (Val, Val) {
    let p = g.player.clone();
    let (a, b) = (armee(g), armee_de(g, FOE));
    let (x, y) = plaine(g, &a);
    for (k, code, dx) in [(&a, p.as_str(), 0.0), (&b, FOE, 1.0)] {
        for typ in ["ligne", "legere", "cavalerie", "artillerie"] {
            k.at("regs").push(g.new_reg(typ, &Val::None, &Val::from(code)));
        }
        k.set("at_node", Val::None);
        k.set("state", "idle");
        k.set("x", x + dx);
        k.set("y", y);
    }
    D::declare_war(g, FOE, &p, true);
    for w in g.weather.values() {
        w.set("kind", "soleil");
        w.set("mud", 0);
    }
    (a, b)
}

/// Le duel engagé : le joueur attaque (si attaque) ou défend. Rend (g, bt, mon armée, la sienne).
fn duel_de(mut g: Game, attaque: bool) -> (Game, Val, Val, Val) {
    let (a, b) = camps(&mut g);
    let (att, de) = if attaque { (&a, &b) } else { (&b, &a) };
    g.start_battle(&list![att], &list![de], a.atf("x"), a.atf("y"), &Val::None, false, false);
    let bt = g.battles.at(a.at("battle"));
    (g, bt, a, b)
}
fn duel(attaque: bool) -> (Game, Val, Val, Val) {
    duel_de(partie(), attaque)
}

/// Fixe les stratégies et fait un pas de bataille ; rend la puissance de chaque camp par arme pendant ce pas
/// ([[art, inf, cav, tir, grenadiers] × 2], rules.ARMES_RANG).
fn un_pas(g: &mut Game, bt: &Val, s0: &str, s1: &str) -> [[f64; 5]; 2] {
    bt.at("sides").at(0).set("strat", s0);
    bt.at("sides").at(1).set("strat", s1);
    bt.set("mode", "auto");
    g.t += SUBSTEP;
    g.update_battles(SUBSTEP, &bt.at("id"));
    let jp = bt.at("jp");
    let n = bt.atf("jn");
    [0, 1].map(|si| [0, 1, 2, 3, 4].map(|i| jp.at(si).atf(i) / n))
}

/// La même mesure sur deux duels identiques, l'un préparé par `f` : (témoin, essai).
fn compare(attaque: bool, s0: &str, s1: &str, age: f64, f: impl Fn(&mut Game, &Val, &Val, &Val)) -> ([[f64; 5]; 2], [[f64; 5]; 2]) {
    let mesure = |prepare: bool| {
        let (mut g, bt, a, b) = duel(attaque);
        if prepare {
            f(&mut g, &bt, &a, &b);
        }
        bt.set("t0", g.t - age); // (l'âge de la bataille fait la phase)
        un_pas(&mut g, &bt, s0, s1)
    };
    (mesure(false), mesure(true))
}

fn somme(p: &[f64; 5]) -> f64 {
    p.iter().sum()
}
#[track_caller]
fn proche(a: f64, b: f64, quoi: &str) {
    assert!((a - b).abs() <= 1e-6 * b.abs().max(1.0), "{quoi} : {a} au lieu de {b}");
}

// ================================================================== 2. quatre armes
#[test]
fn chaque_sorte_de_regiment_a_son_arme() {
    for (typ, arme) in [("ligne", "inf"), ("grenadiers", "grenadiers"), ("sapeurs", "inf"), ("garde", "inf"), ("suisses", "inf"), ("irlandais", "inf"),
                        ("legion", "inf"), ("legere", "tir"), ("chasseurs", "tir"), ("cavalerie", "cav"), ("royal_allemand", "cav"),
                        ("artillerie", "art"), ("mitrailleuses", "art")] {
        assert_eq!(R::arme_de(typ), arme, "{typ}");
    }
    let regles = V::rules_payload();
    for u in R::UNITS().keys() {
        assert!(R::ARMES().has(&regles.at("arme_de").at(&u)), "{u} : classé dans une des quatre armes");
    }
    assert_eq!(R::arme_de("milice"), "inf");
    // les vues donnent pour chaque armée ses effectifs par arme
    let mut g = partie();
    let a = armee(&g);
    a.at("regs").push(g.new_reg("cavalerie", &Val::None, &Val::from("33")));
    a.at("regs").push(g.new_reg("chasseurs", &Val::None, &Val::from("33")));
    let st = V::player_state(&mut g, 0);
    let vue = st.at("armies").iter().find(|x| x.at("id") == a.at("id")).unwrap();
    let armes = vue.at("armes");
    assert_eq!(armes.keys().iter().map(|k| k.string()).collect::<Vec<_>>(), ["inf", "cav", "art", "tir", "grenadiers"]);
    assert_eq!(armes.values().iter().map(|v| v.i()).sum::<i64>(), vue.ati("men"));
    assert!(armes.ati("cav") >= 200 && armes.ati("tir") >= 200);
}

// ================================================================== 3. situations
#[test]
fn la_situation_se_deduit_de_l_etat() {
    let (mut g, bt, _a, b) = duel(true);
    assert_eq!(bt.at("sit"), "campagne");
    assert!(g.ouvrage(&bt).is_none());
    // le défenseur retranché : prise de position, avec sa redoute
    b.set("stance", "retranche");
    assert_eq!(g.situation(&bt), "position");
    bt.set("sit", "position");
    let o = g.ouvrage(&bt);
    assert_eq!((o.at("type"), o.at("camp")), (Val::from("redoute"), Val::from(1)));
    // devant une place : ouverte (rase campagne), barricadée (position), à remparts (ville), fort
    let faux = |nid: i64| dict! {"node" => nid, "sides" => list![dict! {"armies" => list![]}, dict! {"armies" => list![]}]};
    let ouverte = g.nodes.iter().find(|n| n.at("fort") == 0i64 && AA::works_level(n) == 0.0).unwrap();
    assert_eq!(g.situation(&faux(ouverte.ati("id"))), "campagne");
    AA::aa(&ouverte).set("bar", 1.0);
    assert_eq!(g.situation(&faux(ouverte.ati("id"))), "position");
    let de_type = |g: &Game, t: &str| g.nodes.iter().find(|n| n.at("fort") >= 1i64 && g.geo.nodes.at(n.at("id")).at("type") == t).map(|n| n.ati("id"));
    let ville = de_type(&g, "ville").or_else(|| de_type(&g, "capitale")).unwrap();
    assert_eq!(g.situation(&faux(ville)), "ville");
    if let Some(fort) = de_type(&g, "fort") {
        assert_eq!(g.situation(&faux(fort)), "fort");
        let bf = faux(fort);
        bf.set("sit", "fort");
        assert_eq!(g.ouvrage(&bf).at("type"), "fort");
    }
    let bv = faux(ville);
    bv.set("sit", "ville");
    let o = g.ouvrage(&bv);
    assert!(o.at("type") == "remparts" && o.atf("niv") >= 1.0 && o.at("camp") == 1i64);
    // le joueur ne la choisit jamais : aucune commande ne la change
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "frontal", "sit" => "fort"});
    assert!(!r.atb("ok"), "« frontal » n'est pas une stratégie de la prise de position");
    assert_eq!(bt.at("sit"), "position");
}

// ================================================================== 4. stratégies et contres
#[test]
fn les_strategies_de_chaque_situation_et_de_chaque_role() {
    let (g, bt, _a, _b) = duel(true);
    let ids = |g: &Game, bt: &Val, si: i64, code: &str| g.strats_dispo(bt, si, code).into_iter().map(|x| x.0).collect::<Vec<_>>();
    assert_eq!(ids(&g, &bt, 0, "33"), ["frontal", "prep", "debord", "harcel", "colonnes"]);
    assert_eq!(ids(&g, &bt, 1, FOE), ["tenir", "carres", "contre", "embus", "repli"]);
    for (sit, att, def) in [("position", "coup", "tenir"), ("ville", "frontal", "remparts"), ("fort", "frontal", "bastions")] {
        bt.set("sit", sit);
        assert_eq!((ids(&g, &bt, 0, "33")[0].as_str(), ids(&g, &bt, 1, FOE)[0].as_str()), (att, def), "{sit}");
    }
    // toutes les stratégies citées existent, et leurs contres aussi
    for s in R::SITUATIONS().values() {
        for id in s.at("s_att").iter().chain(s.at("s_def").iter()) {
            assert!(R::STRATS().has(&id), "{id}");
        }
    }
    for (id, s) in R::STRATS().items() {
        assert!(s.at("bat").iter().all(|b| R::STRATS().has(&b)), "{id}");
        assert!(s.at("tech").is_none() || R::TECH().has(s.at("tech")), "{id}");
    }
    // une stratégie peut exiger une découverte : l'attaque en colonnes, l'ordre mixte
    bt.set("sit", "campagne");
    let why = |g: &Game| g.strats_dispo(&bt, 0, "33").into_iter().find(|x| x.0 == "colonnes").unwrap().1;
    g.factions.at("33").set("techs", list![]);
    assert!(why(&g).contains("Ordre mixte"), "{}", why(&g));
    g.factions.at("33").at("techs").push("ordre_mixte");
    assert_eq!(why(&g), "");
    // le défenseur d'une place ne peut pas choisir le repli
    bt.at("sides").at(1).set("node", 0);
    assert!(!g.strats_dispo(&bt, 1, FOE).into_iter().find(|x| x.0 == "repli").unwrap().1.is_empty());
}

#[test]
fn le_joueur_choisit_sa_strategie_quand_la_bataille_s_engage() {
    let (mut g, bt, _a, _b) = duel(true);
    assert_eq!(bt.at("mode"), "attente", "la bataille attend le joueur");
    assert!(TB::frozen(&g) && bt.atb("demande"));
    let (s0, s1) = bt.at("sides").pair();
    assert!(s0.at("strat").is_none(), "la sienne n'est pas choisie");
    assert!(R::SITUATIONS().at("campagne").at("s_def").has(&s1.at("strat")), "l'IA a déjà choisi la sienne");
    // la vue : ses choix, celui que son général ferait, la stratégie ennemie cachée
    let st = V::player_state(&mut g, 0);
    let vue = st.at("battles").at(0);
    assert_eq!((vue.at("sit"), vue.at("moi"), vue.at("mode")), (Val::from("campagne"), Val::from(0), Val::from("attente")));
    assert_eq!(vue.at("choix").len(), 5);
    assert!(vue.at("choix").iter().any(|c| c.at("id") == vue.at("defaut") && c.at("why") == ""));
    assert!(vue.at("sides").at(1).at("strat").is_none() && vue.at("sides").at(0).at("strat").is_none());
    assert!(!json::dumps(&vue).contains(&format!("\"{}\"", s1.ats("strat"))) || vue.get("reco").truthy(), "rien ne trahit l'ennemi hors reconnaissance");
    // refus : stratégie d'une autre situation, découverte manquante, anciens modes
    let choisir = |g: &mut Game, corps: Val| {
        corps.set("sub", "choose");
        corps.set("bid", bt.at("id"));
        TB::command(g, &corps)
    };
    g.factions.at("33").set("techs", list![]);
    for corps in [dict! {"strat" => "remparts"}, dict! {"strat" => "colonnes"}, dict! {"mode" => "manuel"}, dict! {"mode" => "ordres"}, dict! {}, dict! {"strat" => 3}] {
        assert!(!choisir(&mut g, corps.clone()).atb("ok"), "{corps}");
        assert_eq!(bt.at("mode"), "attente");
    }
    let r = choisir(&mut g, dict! {"strat" => "debord"});
    assert!(r.atb("ok"), "{r}");
    assert_eq!(s0.at("strat"), "debord");
    assert!(!g.battles.has(bt.at("id")) || bt.at("mode") == "poursuite", "tour du joueur : réglée sur-le-champ");
}

#[test]
fn sans_reponse_le_general_choisit_une_strategie_raisonnable() {
    let (mut g, bt, _a, _b) = duel(true);
    let defaut = g.choose_strategy(&bt, 0);
    assert!(R::SITUATIONS().at("campagne").at("s_att").has(defaut.as_str()) && defaut != "harcel");
    assert_eq!(g.choose_strategy(&bt, 0), defaut, "même bataille, même choix");
    assert!(TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => "auto"}).atb("ok"));
    assert_eq!(bt.at("sides").at(0).at("strat"), defaut.as_str());
    // réglage « toujours automatique » : rien n'est demandé
    let g = partie();
    g.settings.set("battles", "auto");
    let (_g, bt, _a, _b) = duel_de(g, true);
    assert!(bt.at("mode") == "auto" && bt.at("sides").at(0).at("strat").is_some() && !bt.atb("demande"));
}

#[test]
fn les_ia_choisissent_selon_leur_composition_et_leur_general() {
    let (g, bt, a, b) = duel(true);
    let seul = |x: &Val, typ: &str, n: usize| {
        let regs: Vec<Val> = x.at("regs").iter().filter(|r| r.at("type") == typ).take(n).collect();
        x.set("regs", Val::list(regs));
    };
    // beaucoup de canons : la préparation d'artillerie ; beaucoup de cavaliers en plaine : le débordement
    let mut gg = g;
    for _ in 0..6 {
        a.at("regs").push(gg.new_reg("artillerie", &Val::None, &Val::from("33")));
    }
    a.at("gen").set("trait", "artilleur");
    assert_eq!(gg.choose_strategy(&bt, 0), "prep");
    seul(&a, "cavalerie", 9);
    for _ in 0..6 {
        a.at("regs").push(gg.new_reg("cavalerie", &Val::None, &Val::from("33")));
    }
    a.at("gen").set("trait", "cavalier");
    assert_eq!(gg.choose_strategy(&bt, 0), "debord");
    // face à une masse de cavalerie, le défenseur forme les carrés (général prudent)
    seul(&b, "ligne", 9);
    for r in b.at("regs").iter() {
        r.set("n", 3000.0);
    }
    b.at("gen").set("trait", "prudent");
    assert_eq!(gg.choose_strategy(&bt, 1), "carres");
    // très inférieur en rase campagne, on se dérobe : repli en défense, harcèlement en attaque
    for r in b.at("regs").iter() {
        r.set("n", 20.0);
    }
    assert_eq!(gg.choose_strategy(&bt, 1), "repli");
    for r in b.at("regs").iter() {
        r.set("n", 2000.0);
    }
    for r in a.at("regs").iter() {
        r.set("n", 20.0);
    }
    assert_eq!(gg.choose_strategy(&bt, 0), "harcel");
}

#[test]
fn une_strategie_qui_contre_l_autre_gagne_vingt_pour_cent() {
    // « frontal » contre « faubourgs » mais pas « tenir » : la puissance de l'assaillant ne change que du contre
    let p = |s1: &str| {
        let (mut g, bt, _a, _b) = duel(true);
        un_pas(&mut g, &bt, "frontal", s1)
    };
    let (sans, avec) = (p("tenir"), p("faubourgs"));
    proche(somme(&avec[0]) / somme(&sans[0]), R::CONTRE, "le contre de l'assaillant");
    // et dans l'autre sens : « tenir » contre « frontal », pas « prep »
    let q = |s0: &str| {
        let (mut g, bt, _a, _b) = duel(true);
        un_pas(&mut g, &bt, s0, "tenir")
    };
    let (sans, avec) = (q("prep"), q("frontal"));
    proche(somme(&avec[1]) / somme(&sans[1]), R::CONTRE, "le contre du défenseur");
}

#[test]
fn une_strategie_change_le_poids_de_chaque_arme_et_ses_propres_pertes() {
    let (mut g, bt, _a, _b) = duel(true);
    let frontal = un_pas(&mut g, &bt, "frontal", "contre");
    let (mut g, bt, _a, _b) = duel(true);
    let prep = un_pas(&mut g, &bt, "prep", "contre");
    // (ni l'une ni l'autre ne contre « contre » ; « contre » contre « prep » : cela ne touche que le défenseur)
    proche(prep[0][0] / frontal[0][0], 1.45 / 1.1, "l'artillerie de la préparation");
    proche(prep[0][1] / frontal[0][1], 0.95 / 1.1, "son infanterie attend");
    // les pertes propres : « harcèlement » (×0,6) perd moins que « frontal » (×1) sous le même feu
    let pertes = |s0: &str| {
        let (mut g, bt, _a, _b) = duel(true);
        un_pas(&mut g, &bt, s0, "carres"); // (« carrés » ne contre ni l'une ni l'autre)
        bt.at("sides").at(0).atf("lost")
    };
    proche(pertes("harcel") / pertes("frontal"), 0.6, "pertes du harcèlement");
}

// ================================================================== 5. phases et journal
#[test]
fn les_quatre_phases_et_le_poids_de_chaque_arme() {
    let (mut g, bt, _a, _b) = duel(true);
    let phase = |g: &mut Game, age: f64| {
        bt.set("t0", g.t - age);
        g.battle_phase(&bt)
    };
    assert_eq!([0.0, 0.05, 0.15, 0.5, 2.0].map(|age| phase(&mut g, age)), ["escarmouche", "escarmouche", "canonnade", "fusillade", "charge"]);
    bt.set("ambush", true);
    assert_eq!(phase(&mut g, 0.0), "fusillade", "une embuscade commence au contact");
    assert_eq!(R::PHASES().keys().iter().map(|k| k.string()).collect::<Vec<_>>(), ["escarmouche", "canonnade", "fusillade", "charge"]);
    // chaque arme pèse surtout dans sa phase
    for (ph, arme) in [("escarmouche", "tir"), ("canonnade", "art"), ("fusillade", "inf"), ("charge", "cav"), ("charge", "grenadiers")] {
        let w = R::PHASE_W().at(ph);
        assert!(R::ARMES_RANG.iter().all(|a| w.atf(arme) >= w.atf(*a) || (ph == "charge" && *a == "grenadiers")), "{ph}");
        for autre in ["escarmouche", "canonnade", "fusillade", "charge"] {
            assert!(w.atf(arme) >= R::PHASE_W().at(autre).atf(arme), "{arme} pèse le plus en {ph}");
        }
    }
    // dans la bataille : la part des tirailleurs dans la puissance d'un camp est la plus forte à l'escarmouche, etc.
    let part = |age: f64, i: usize| {
        let (mut g, bt, _a, _b) = duel(true);
        bt.set("t0", g.t - age);
        let p = un_pas(&mut g, &bt, "frontal", "contre");
        p[0][i] / somme(&p[0])
    };
    let ages = [0.0, 0.15, 0.5, 2.0];
    for (i, k) in [(3usize, 0usize), (0, 1), (1, 2), (2, 3)] {
        let parts = ages.map(|age| part(age, i));
        assert!((0..4).all(|j| parts[k] >= parts[j]), "{} : {parts:?}", R::ARMES_RANG[i]);
    }
}

#[test]
fn le_journal_a_une_ligne_par_phase_avec_les_pertes_et_ce_qui_a_pese() {
    let (mut g, bt, _a, _b) = duel(true);
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "prep"});
    assert!(r.atb("ok"), "{r}");
    if bt.get("mode") == "poursuite" {
        // la bataille est gagnée : le journal est déjà complet, la stratégie ennemie se découvre
        let st = V::player_state(&mut g, 0);
        let vue = st.at("battles").at(0);
        assert!(vue.at("sides").at(1).at("strat").is_some() && vue.at("fin").at("w") == 0i64);
        assert!(TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => false}).atb("ok"));
    }
    assert!(!g.battles.truthy());
    let fin = g.events.iter().filter(|e| e.at("kind") == "battle_end").last().expect("le résultat");
    let journal = fin.at("journal");
    let phases: Vec<String> = journal.iter().map(|l| l.ats("ph")).collect();
    let ordre = ["escarmouche", "canonnade", "fusillade", "charge"];
    assert!(phases.len() >= 2 && phases[0] == "escarmouche", "{phases:?}");
    assert!(phases.windows(2).all(|w| ordre.iter().position(|p| *p == w[0]) < ordre.iter().position(|p| *p == w[1])), "{phases:?}");
    // les pertes des lignes font les pertes de la bataille
    for (si, k) in [(0, "la"), (1, "ld")] {
        let s: i64 = journal.iter().map(|l| l.at("l").ati(si)).sum();
        assert!((s - fin.ati(k)).abs() <= journal.len() as i64, "pertes du camp {si} : {s} / {}", fin.at(k));
    }
    for l in journal.iter() {
        assert!(l.at("w").len() >= 1 && l.at("w").iter().all(|n| n.at("t").is_str()), "ce qui a pesé : {l}");
        assert_eq!(l.at("p").at(0).keys().iter().map(|k| k.string()).collect::<Vec<_>>(), ["art", "inf", "cav", "tir", "grenadiers"]);
    }
    // le résultat : situation, stratégies des deux camps (celle de l'ennemi se découvre), ce qui a pesé
    assert_eq!((fin.at("sit"), fin.at("strats").at(0)), (Val::from("campagne"), Val::from("prep")));
    assert!(R::STRATS().has(&fin.at("strats").at(1)));
    assert!(fin.at("pese").iter().any(|n| n.ats("t").starts_with("Découvertes") || n.ats("t").contains("★")), "{}", fin.at("pese"));
    assert!(fin.has("prises") && fin.has("poursuite") && fin.has("generaux") && fin.has("prisonniers"));
}

// ================================================================== 7. terrain
#[test]
fn le_terrain_pese() {
    // la colline au défenseur : +15 %
    let (plat, colline) = compare(true, "frontal", "contre", 0.5, |_g, bt, _a, _b| bt.set("defbonus", 1.15));
    proche(somme(&colline[1]) / somme(&plat[1]), 1.15, "défenseur sur la colline");
    proche(somme(&colline[0]), somme(&plat[0]), "l'assaillant n'y gagne rien");
    // la rivière à franchir pénalise l'assaillant
    let (sec, riviere) = compare(true, "frontal", "contre", 0.5, |_g, bt, _a, _b| bt.set("river", 2));
    proche(somme(&riviere[0]) / somme(&sec[0]), 0.85, "assaillant qui franchit la rivière");
    // la forêt : favorable aux tirailleurs, mauvaise pour la cavalerie et les canons ; les vignes gênent la cavalerie
    let g = partie();
    let (a, _b) = (armee(&g), armee_de(&g, FOE));
    let mut g = g;
    let reg = |g: &mut Game, typ: &str| g.new_reg(typ, &Val::None, &Val::from("33"));
    let (leg, cav, art) = (reg(&mut g, "legere"), reg(&mut g, "cavalerie"), reg(&mut g, "artillerie"));
    let p = |g: &Game, r: &Val, t: &str| g.reg_power("33", r, t, 1.0, false, &a);
    assert!(p(&g, &leg, "Forêt") > 1.2 * p(&g, &leg, "Plaine"));
    assert!(p(&g, &cav, "Forêt") < 0.5 * p(&g, &cav, "Plaine") && p(&g, &art, "Forêt") < 0.5 * p(&g, &art, "Plaine"));
    assert!(p(&g, &cav, "Vignoble") < 0.8 * p(&g, &cav, "Plaine"));
    // la forêt au défenseur (geo.TERRAIN : bonus de défense, couvert)
    let t = conquete::geo::TERRAIN();
    let de = |nom: &str| t.values().into_iter().find(|x| x.at(0) == nom).unwrap();
    assert!(de("Forêt").atf(3) > 1.0 && de("Forêt").atb(2) && de("Collines").atf(3) > de("Plaine").atf(3));
    // hors terrain ouvert, la cavalerie qui déborde s'empêtre
    assert_eq!((Game::strat_m("debord", "cav", true), Game::strat_m("debord", "cav", false)), (1.6, 0.8));
}

// ================================================================== 8. temps, moral, fatigue
#[test]
fn le_temps_et_le_sol_pesent() {
    let meteo = |kind: &'static str, mud: i64| move |g: &mut Game, _bt: &Val, _a: &Val, _b: &Val| {
        for w in g.weather.values() {
            w.set("kind", kind);
            w.set("mud", mud);
        }
    };
    // la pluie : moins de feu (canons ×0,75)
    let (sec, pluie) = compare(true, "frontal", "contre", 0.15, meteo("pluie", 0));
    proche(pluie[0][0] / sec[0][0], R::WEATHER().at("pluie").atf("fire"), "canons sous la pluie");
    assert!(pluie[0][1] < sec[0][1], "et les fusils");
    // la boue : la charge de cavalerie ralentie (le feu, lui, n'y perd rien)
    let (sec, boue) = compare(true, "frontal", "contre", 2.0, meteo("nuages", 2));
    proche(boue[0][2] / sec[0][2], R::BOUE_CHARGE, "charge dans la boue");
    proche(boue[0][1], sec[0][1], "l'infanterie n'en souffre pas");
    let (sec, boue) = compare(true, "frontal", "contre", 0.5, meteo("nuages", 2));
    proche(boue[0][2], sec[0][2], "hors de la charge, la boue ne compte pas");
    // la neige : feu réduit et charge freinée
    let (sec, neige) = compare(true, "frontal", "contre", 2.0, meteo("neige", 0));
    assert!(neige[0][2] < sec[0][2] * R::NEIGE_CHARGE + 1e-9 && neige[0][0] < sec[0][0]);
    // le brouillard : les embuscades de tirailleurs favorisées
    let (clair, brume) = compare(false, "frontal", "embus", 0.5, meteo("brouillard", 0));
    let feu = R::WEATHER().at("brouillard").atf("fire");
    assert!(brume[1][3] / clair[1][3] > feu * 1.1, "tirailleurs embusqués dans le brouillard : {}", brume[1][3] / clair[1][3]);
    // … et l'attaque en embuscade
    let amb = |brouillard: bool| {
        let (mut g, bt, _a, _b) = duel(true);
        bt.set("ambush", true);
        if brouillard {
            meteo("brouillard", 0)(&mut g, &bt, &Val::None, &Val::None);
        }
        somme(&un_pas(&mut g, &bt, "frontal", "contre")[0])
    };
    assert!(amb(true) / amb(false) > feu * 1.1);
    // le journal le dit
    let mut g2 = partie();
    let (a, b) = camps(&mut g2);
    meteo("pluie", 0)(&mut g2, &Val::None, &Val::None, &Val::None);
    g2.start_battle(&list![&a], &list![&b], a.atf("x"), a.atf("y"), &Val::None, false, false);
    let bt = g2.battles.at(a.at("battle"));
    assert!(bt.at("pese").iter().any(|n| n.ats("t").starts_with("Pluie")), "{}", bt.at("pese"));
    assert!(bt.at("pese").iter().any(|n| n.ats("t").starts_with("Boue")), "{}", bt.at("pese"));
}

#[test]
fn le_moral_la_fatigue_et_la_faim_pesent() {
    // longue marche : des troupes fourbues se battent moins bien
    let (frais, fourbus) = compare(true, "frontal", "contre", 0.5, |_g, _bt, a, _b| {
        for r in a.at("regs").iter() {
            r.set("fat", 100.0);
        }
    });
    assert!(somme(&fourbus[0]) < 0.9 * somme(&frais[0]));
    proche(somme(&fourbus[1]), somme(&frais[1]), "l'ennemi n'y gagne pas de puissance");
    // la faim : une armée mal ravitaillée
    let (nourris, affames) = compare(true, "frontal", "contre", 0.5, |_g, _bt, a, _b| a.set("supply", 0.0));
    proche(somme(&affames[0]) / somme(&nourris[0]), 0.75, "ventre vide");
    // défaite récente : le moral bas
    let (fiers, battus) = compare(true, "frontal", "contre", 0.5, |_g, _bt, a, _b| {
        for r in a.at("regs").iter() {
            r.set("morale", 18.0);
        }
    });
    assert!(somme(&battus[0]) < 0.8 * somme(&fiers[0]));
}

// ================================================================== 9. renforts et reconnaissance
/// Une autre armée du camp `code`, à `km` du champ de bataille.
fn autre_armee(g: &mut Game, code: &str, bt: &Val, km: f64) -> Val {
    let regs = list![g.new_reg("ligne", &Val::None, &Val::from(code)), g.new_reg("cavalerie", &Val::None, &Val::from(code))];
    g.create_army(code, bt.atf("x") + km, bt.atf("y"), &regs, &Val::None, &Val::None, &Val::None)
}

#[test]
fn une_armee_amie_proche_rejoint_la_bataille_pour_la_charge() {
    let (mut g, bt, _a, _b) = duel(true);
    let pres = autre_armee(&mut g, "33", &bt, R::RENFORT_KM - 1.0);
    let loin = autre_armee(&mut g, "33", &bt, R::RENFORT_KM + 4.0);
    let sienne = autre_armee(&mut g, FOE, &bt, -(R::RENFORT_KM - 1.0));
    let en_siege = autre_armee(&mut g, "33", &bt, 5.0);
    en_siege.set("state", "siege");
    // avant la charge : personne ne bouge
    bt.set("t0", g.t - 0.4);
    un_pas(&mut g, &bt, "frontal", "contre");
    assert!(pres.at("battle").is_none() && !bt.getb("renf"));
    // la charge commence : les armées libres à portée entrent en ligne, chacune dans son camp
    bt.set("t0", g.t - 2.0);
    for r in g.armies.values().iter().flat_map(|a| a.at("regs").vec()) {
        r.set("n", r.atf("n") * 50.0); // (la bataille dure : personne ne cède à ce pas)
        r.set("max", r.atf("n"));
    }
    for si in 0..2 {
        bt.at("sides").at(si).set("men0", g.side_men(&bt, si));
    }
    un_pas(&mut g, &bt, "frontal", "contre");
    assert_eq!(bt.at("phase"), "charge");
    assert!(g.battles.has(bt.at("id")), "la bataille continue");
    let (s0, s1) = bt.at("sides").pair();
    assert!(s0.at("armies").has(pres.at("id")) && pres.at("battle") == bt.at("id") && pres.at("state") == "battle");
    assert!(s1.at("armies").has(sienne.at("id")), "l'ennemi aussi reçoit les siens");
    assert!(loin.at("battle").is_none(), "trop loin");
    assert!(en_siege.at("battle").is_none() && en_siege.at("state") == "siege", "une armée de siège ne quitte pas ses lignes");
    assert_eq!((s0.at("renf"), s1.at("renf")), (list![pres.at("name")], list![sienne.at("name")]));
    assert!(bt.at("jw").iter().any(|n| n.ats("t").starts_with("Renforts")), "le journal de la charge le dit : {}", bt.at("jw"));
    // une seule fois par bataille
    let tard = autre_armee(&mut g, "33", &bt, 2.0);
    tard.set("x", bt.atf("x") + 5.0); // (hors du contact direct)
    un_pas(&mut g, &bt, "frontal", "contre");
    assert!(!s0.at("renf").has(tard.at("name")));
}

#[test]
fn la_reconnaissance_annonce_la_strategie_probable_de_l_ennemi() {
    // avec de la cavalerie : une annonce, vraie avec une certaine probabilité
    let (mut g, bt, a, _b) = duel(true);
    let reco = bt.at("reco");
    assert!(reco.truthy(), "l'armée a de la cavalerie");
    let p = reco.atf(1);
    assert!((R::RECO_BASE..=R::RECO_MAX).contains(&p), "{p}");
    assert!(R::SITUATIONS().at("campagne").at("s_def").has(&reco.at(0)), "une stratégie du rôle ennemi");
    let st = V::player_state(&mut g, 0);
    assert_eq!(st.at("battles").at(0).at("reco"), dict! {"strat" => reco.at(0), "p" => reco.at(1)});
    assert_eq!(g.reconnaissance(&bt, 0), reco, "le rapport ne change pas d'une lecture à l'autre");
    // plus de cavalerie, des hussards, un général éclaireur : plus sûr
    let p0 = {
        a.set("regs", a.at("regs").iter().filter(|r| r.at("type") != "cavalerie").collect::<Val>());
        a.at("regs").push(g.new_reg("cavalerie", &Val::from(30), &Val::from("33")));
        g.reconnaissance(&bt, 0).atf(1)
    };
    for _ in 0..3 {
        a.at("regs").push(g.new_reg("cavalerie", &Val::None, &Val::from("33")));
    }
    let p1 = g.reconnaissance(&bt, 0).atf(1);
    a.at("gen").set("trait", "eclaireur");
    let p2 = g.reconnaissance(&bt, 0).atf(1);
    assert!(p0 < p1 && p1 < p2, "{p0} {p1} {p2}");
    // le brouillard la gêne
    for w in g.weather.values() {
        w.set("kind", "brouillard");
    }
    assert!(g.reconnaissance(&bt, 0).atf(1) < p2);
    // sans cavalerie ni espion : rien
    a.set("regs", a.at("regs").iter().filter(|r| r.at("type") != "cavalerie").collect::<Val>());
    assert!(g.reconnaissance(&bt, 0).is_none());
    // un espion dans la place attaquée : presque sûr
    bt.set("node", 0);
    g.factions.at("33").at("intel").set("0", g.t + 10.0);
    assert_eq!(g.reconnaissance(&bt, 0).atf(1), R::RECO_ESPION);
    // sur beaucoup de batailles, l'annonce est vraie à peu près p fois sur cent
    let vraie = bt.at("sides").at(1).at("strat");
    let n = 400;
    let justes = (0..n)
        .filter(|i| {
            bt.set("id", format!("essai{i}"));
            g.reconnaissance(&bt, 0).at(0) == vraie
        })
        .count();
    let part = justes as f64 / n as f64;
    assert!((part - R::RECO_ESPION).abs() < 0.07, "{part}");
}

// ================================================================== 10. après la bataille
/// Le duel gagné par le joueur (ses effectifs décuplés), stratégie choisie : la bataille attend le choix de la poursuite.
fn victoire() -> (Game, Val, Val, Val) {
    let (mut g, bt, a, b) = duel(true);
    for r in a.at("regs").iter() {
        r.set("n", r.atf("n") * 6.0);
        r.set("max", r.atf("n"));
    }
    assert!(TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "frontal"}).atb("ok"));
    (g, bt, a, b)
}
fn hommes(a: &Val) -> f64 {
    a.at("regs").iter().map(|r| r.atf("n")).sum()
}

#[test]
fn le_vainqueur_qui_a_de_la_cavalerie_choisit_de_poursuivre() {
    let issue = |poursuivre: bool| {
        let (mut g, bt, a, b) = victoire();
        assert_eq!(bt.at("mode"), "poursuite", "la bataille gagnée attend le choix");
        assert!(TB::frozen(&g) && !TB::on_speed(&mut g, 1).0, "la campagne attend");
        let st = V::player_state(&mut g, 0);
        assert_eq!(st.at("battles").at(0).at("fin").at("w"), 0);
        let avant = hommes(&b);
        let fat0: f64 = a.at("regs").iter().map(|r| r.atf("fat")).sum::<f64>() / a.at("regs").len() as f64;
        let r = TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => poursuivre});
        assert!(r.atb("ok"), "{r}");
        assert!(!g.battles.has(bt.at("id")) && !TB::frozen(&g));
        assert!(!TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => true}).atb("ok"), "une seule fois");
        let fat1: f64 = a.at("regs").iter().map(|r| r.atf("fat")).sum::<f64>() / a.at("regs").len() as f64;
        let fin = g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap();
        assert_eq!(fin.at("poursuite"), poursuivre);
        let reste = if g.armies.has(b.at("id")) { hommes(&b) } else { 0.0 };
        ((avant - reste) / avant, fat1 - fat0, fin.ati("prisonniers"))
    };
    let (pris, fatigue, prisonniers) = issue(true);
    let (pris_sans, fatigue_sans, prisonniers_sans) = issue(false);
    assert!(pris > pris_sans + 0.03, "plus de pertes ennemies : {pris} contre {pris_sans}");
    proche(fatigue - fatigue_sans, R::POURSUITE_FAT, "mais son armée se fatigue");
    assert!(prisonniers > prisonniers_sans);
}

#[test]
fn sans_cavalerie_pas_de_poursuite_et_les_ia_decident_seules() {
    // sans cavalerie : rien n'est demandé
    let (mut g, bt, a, _b) = duel(true);
    a.set("regs", a.at("regs").iter().filter(|r| r.at("type") != "cavalerie").collect::<Val>());
    for r in a.at("regs").iter() {
        r.set("n", r.atf("n") * 6.0);
    }
    assert!(TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "frontal"}).atb("ok"));
    assert!(!g.battles.truthy(), "réglée sans question");
    assert_eq!(g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap().at("poursuite"), false);
    // un général (IA, ou joueur qui laisse faire) poursuit si ses hommes ne sont pas fourbus
    let (g, bt, a, _b) = duel(true);
    assert!(g.poursuite_ia(&bt, 0));
    for r in a.at("regs").iter() {
        r.set("fat", R::POURSUITE_FAT_MAX + 5.0);
    }
    assert!(!g.poursuite_ia(&bt, 0));
    assert!(!g.poursuite_a_choisir(&bt, 1), "le vaincu ne choisit rien");
}

#[test]
fn prises_drapeaux_canons_et_prestige() {
    let (mut g, bt, _a, b) = duel(true);
    let (gloire0, st) = (g.factions.at("33").get_or("glory", 0.0).f(), g.factions.at("33").at("stats"));
    // deux régiments ennemis anéantis pendant la bataille, dont une batterie
    let (art, ligne) = (b.at("regs").iter().find(|r| r.at("type") == "artillerie").unwrap(), b.at("regs").iter().find(|r| r.at("type") == "ligne").unwrap());
    b.set("regs", b.at("regs").iter().filter(|r| !r.is(&art) && !r.is(&ligne)).collect::<Val>());
    bt.set("pursue", false);
    g.end_battle(&bt, 0, false);
    let fin = g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap();
    assert_eq!(fin.at("prises"), dict! {"drapeaux" => 2, "canons" => R::PRISE_CANONS});
    assert!(fin.ats("text").contains("Prises : 2 drapeaux, 8 canons"), "{}", fin.at("text"));
    proche(g.factions.at("33").atf("glory") - gloire0, 2.0 * R::PRESTIGE_DRAPEAU + R::PRISE_CANONS as f64 * R::PRESTIGE_CANON, "au prestige");
    assert_eq!((st.at("drapeaux"), st.at("canons")), (Val::from(2), Val::from(R::PRISE_CANONS)));
    assert!(fin.ati("prisonniers") >= 0 && g.factions.at("33").at("prisoners").has(FOE) || fin.ati("prisonniers") == 0);
    // un ennemi qui décroche en bon ordre emmène ses canons
    let (mut g, bt, _a, b) = duel(true);
    let art = b.at("regs").iter().find(|r| r.at("type") == "artillerie").unwrap();
    b.set("regs", b.at("regs").iter().filter(|r| !r.is(&art)).collect::<Val>());
    bt.set("pursue", false);
    g.end_battle(&bt, 0, true);
    assert_eq!(g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap().at("prises"), dict! {"drapeaux" => 1, "canons" => 0});
}

#[test]
fn les_survivants_s_aguerrissent_et_le_general_gagne_de_l_experience() {
    let (mut g, bt, a, b) = duel(true);
    let xp = |x: &Val| x.at("regs").iter().map(|r| r.atf("xp")).collect::<Vec<_>>();
    let (xa, xb, gxp) = (xp(&a), xp(&b), a.at("gen").atf("xp"));
    bt.set("pursue", false);
    g.end_battle(&bt, 0, true);
    for (avant, apres) in xa.iter().zip(xp(&a)) {
        proche(apres, (avant + R::VETERANS_XP as f64).min(100.0), "vétérans du vainqueur");
    }
    for (avant, apres) in xb.iter().zip(xp(&b)) {
        proche(apres, (avant + R::VETERANS_XP_VAINCU as f64).min(100.0), "les vaincus apprennent aussi");
    }
    assert!(a.at("gen").atf("xp") > gxp, "le général vainqueur gagne de l'expérience");
    assert_eq!(a.at("gen").at("etats").at(-1).at(2), "victoire");
    assert_eq!(b.at("gen").at("etats").at(-1).at(2), "décroché");
    // blessé, tué ou pris : le sort des généraux est au résultat (risques_general, selon la graine et le jour)
    let mut vus = std::collections::BTreeSet::new();
    for jour in 0..400 {
        let (mut g, bt, _a, _b) = duel(true);
        g.t = jour as f64 + 0.5;
        bt.set("t0", g.t);
        bt.set("pursue", false);
        g.end_battle(&bt, 0, false);
        let fin = g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap();
        for s in fin.at("generaux").iter() {
            assert!(s.len() == 3 && (s.at(0) == 0i64 || s.at(0) == 1i64));
            vus.insert(s.ats(2));
        }
        if vus.len() == 3 {
            break;
        }
    }
    assert_eq!(vus.into_iter().collect::<Vec<_>>(), ["blesse", "pris", "tue"]);
}

// ================================================================== 11. sièges et capitulation
#[test]
fn l_assiegeant_choisit_blocus_breche_ou_escalade() {
    let mut g = partie_avec("33", "1700", 1, "normal");
    let a = armee(&g);
    let n = g.nodes.iter().find(|n| n.at("owner") == R::NEUTRAL && n.at("fort") >= 2i64).unwrap();
    let nid = n.ati("id");
    let (x, y) = g.node_xy(nid);
    for r in a.at("regs").iter() {
        r.set("n", r.atf("n") * 3.0);
    }
    a.set("x", x);
    a.set("y", y);
    a.set("at_node", Val::None);
    a.set("state", "move");
    g.arrive_node(&a, nid, true);
    let c = AA::ask_choices(&mut g, &a);
    for k in ["assaut", "assieger", "bloquer", "attendre"] {
        assert!(c.has(k), "{k} : {c}");
    }
    assert!(!c.has("ordres") && !c.has("manuel"));
    // l'état le dit à la page
    let st = V::player_state(&mut g, 0);
    let vue = st.at("armies").iter().find(|x| x.at("id") == a.at("id")).unwrap();
    assert!(vue.at("ask").at("c").has("assaut") && vue.at("ask").at("n") == nid);
    // la brèche au canon : un siège qui dure ; le blocus : la faim ; l'escalade : la bataille tout de suite
    let devant = |quoi: &str| {
        let mut g = partie_avec("33", "1700", 1, "normal");
        let a = armee(&g);
        for r in a.at("regs").iter() {
            r.set("n", r.atf("n") * 3.0);
        }
        a.set("x", x);
        a.set("y", y);
        a.set("at_node", Val::None);
        a.set("state", "move");
        g.arrive_node(&a, nid, true);
        let p = g.player.clone();
        let (ok, msg) = AA::choose(&mut g, &p, &a, quoi);
        assert!(ok, "{quoi} : {msg}");
        (g, a)
    };
    let (g, a) = devant("assieger");
    let s = g.nodes.at(nid).at("siege");
    assert!(a.at("state") == "siege" && s.truthy() && !s.getb("blocus") && s.at("dmg") == 0.0);
    let (g, a) = devant("bloquer");
    let s = g.nodes.at(nid).at("siege");
    assert!(a.at("state") == "siege" && s.getb("blocus") && s.atf("food") > 0.0);
    let (g, a) = devant("assaut");
    let bt = g.battles.at(a.at("battle"));
    assert_eq!((bt.at("mode"), bt.at("node")), (Val::from("attente"), Val::from(nid)));
    assert!(bt.at("sit") == "ville" || bt.at("sit") == "fort");
    assert_eq!(g.strats_dispo(&bt, 0, "33")[0].0, "frontal");
}

#[test]
fn une_garnison_sans_vivres_capitule_avec_les_honneurs() {
    let mut g = partie();
    let p = g.player.clone();
    let a = armee(&g);
    D::declare_war(&mut g, FOE, &p, true);
    // une ville à remparts de la Dordogne, avec une garnison, une autre place amie où se replier
    let n = g.nodes.iter().find(|n| n.at("owner") == FOE && n.at("fort") >= 1i64 && g.capital_of(FOE) != n.at("id")).unwrap();
    let nid = n.ati("id");
    let gar = list![g.new_reg("ligne", &Val::None, &Val::from(FOE)), g.new_reg("ligne", &Val::None, &Val::from(FOE))];
    n.set("garrison", &gar);
    let (x, y) = g.node_xy(nid);
    for r in a.at("regs").iter() {
        r.set("n", r.atf("n") * 5.0);
    }
    a.set("x", x);
    a.set("y", y);
    a.set("at_node", nid);
    a.set("state", "idle");
    let (ok, msg) = AA::blockade(&mut g, &p, &a);
    assert!(ok, "{msg}");
    let s = n.at("siege");
    // les vivres épuisés, puis la famine : la place se rend
    s.set("since", g.t - s.atf("food") - conquete::army_actions::BLOC_STARVE as f64 - 1.0);
    let avant: f64 = gar.iter().map(|r| r.atf("n")).sum();
    let bes = g.besiegers(&n);
    AA::blockade_tick(&mut g, &n, &bes, 0.05);
    assert_eq!(n.at("owner"), p.as_str(), "la place est rendue");
    assert!(n.at("siege").is_none() && !n.at("garrison").truthy());
    // ses hommes sont sauvés : la garnison sort en armée et se replie vers une place amie
    let sortie = g.armies.values().into_iter().find(|b| b.at("owner") == FOE && b.at("regs").iter().any(|r| r.is(&gar.at(0)))).expect("la garnison est sortie");
    let apres: f64 = sortie.at("regs").iter().map(|r| r.atf("n")).sum();
    assert!(apres > 0.95 * avant, "{apres} / {avant}");
    assert!(sortie.at("state") == "retreat" && sortie.at("at_node").is_none() && sortie.at("path").truthy());
    let ev = g.events.iter().filter(|e| e.at("kind") == "capture").last().unwrap();
    let c = ev.at("capitulation");
    assert_eq!((c.at("node"), c.at("par"), c.at("de"), c.at("honneurs")), (Val::from(nid), Val::from(p.as_str()), Val::from(FOE), Val::from(true)));
    assert_eq!(c.ati("saufs"), py::round(apres));
    assert!(ev.ats("text").contains("honneurs de la guerre"), "{}", ev.at("text"));
}

// ================================================================== 12. pour l'écran
#[test]
fn apercu_du_rapport_de_forces() {
    let mut g = partie();
    let (a, b) = camps(&mut g);
    let p = g.player.clone();
    // contre une armée en vue
    let r = g.apercu(&p, &a.at("id"), &dict! {"army" => b.at("id")});
    assert!(r.atb("ok"), "{r}");
    let attendu = g.army_power(&a, "Plaine") / g.army_power(&b, "Plaine");
    proche(r.atf("ratio"), py::round_n(attendu, 2), "le rapport");
    assert_eq!((r.at("sit"), r.at("sur"), r.at("terrain")), (Val::from("campagne"), Val::from(true), Val::from("Plaine")));
    assert_eq!(r.at("moi").at("armes").values().iter().map(|v| v.i()).sum::<i64>(), r.at("moi").ati("men"));
    assert_eq!(r.at("lui").ati("men"), py::round(hommes(&b)));
    assert!(["net avantage", "avantage", "issue incertaine", "désavantage", "très risqué"].contains(&r.ats("mot").as_str()));
    // plus forte, le rapport monte ; l'ennemi retranché, il baisse
    for x in a.at("regs").iter() {
        x.set("n", x.atf("n") * 3.0);
    }
    let fort = g.apercu(&p, &a.at("id"), &dict! {"army" => b.at("id")});
    assert!(fort.atf("ratio") > 2.5 * r.atf("ratio") && fort.at("mot") == "net avantage");
    b.set("stance", "retranche");
    let retranche = g.apercu(&p, &a.at("id"), &dict! {"army" => b.at("id")});
    assert!(retranche.atf("ratio") < fort.atf("ratio") && retranche.at("sit") == "position");
    // contre une place ennemie : garnison, milice et remparts comptés
    let n = g.nodes.iter().find(|n| n.at("owner") == FOE && n.at("fort") >= 1i64).unwrap();
    let r = g.apercu(&p, &a.at("id"), &dict! {"node" => n.at("id")});
    assert!(r.atb("ok") && r.atf("ratio") > 0.0 && (r.at("sit") == "ville" || r.at("sit") == "fort"), "{r}");
    assert!(r.at("lui").ati("men") >= py::round(n.atf("milice")));
    // refus : armée d'un autre, cible inconnue, armée hors de vue, place amie ; rien n'est changé
    let avant = json::dumps(&V::to_dict(&mut g));
    b.set("x", b.atf("x") + 300.0);
    let mienne = g.nodes.iter().find(|n| n.at("owner") == p.as_str()).unwrap().at("id");
    for (aid, cible) in [(b.at("id"), dict! {"army" => a.at("id")}), (a.at("id"), dict! {}), (a.at("id"), dict! {"army" => "zz"}),
                         (a.at("id"), dict! {"army" => b.at("id")}), (a.at("id"), dict! {"node" => mienne}), (a.at("id"), dict! {"node" => 99999}),
                         (Val::None, Val::None)] {
        assert!(!g.apercu(&p, &aid, &cible).atb("ok"), "{aid} {cible}");
    }
    b.set("x", b.atf("x") - 300.0);
    assert_eq!(json::dumps(&V::to_dict(&mut g)), avant, "l'aperçu ne change rien à la partie");
}

#[test]
fn une_bataille_laisse_sa_trace_quelques_tours() {
    let (mut g, bt, _a, _b) = duel(true);
    bt.set("pursue", false);
    bt.at("sides").at(0).set("strat", "prep");
    g.end_battle(&bt, 0, true);
    let s = g.sites.at(-1);
    assert_eq!((s.at("n"), s.at("s"), s.at("w"), s.at("d")), (Val::None, Val::from("campagne"), Val::from(0), Val::from(true)));
    assert_eq!(s.at("st").at(0), "prep");
    // devant une place aussi (l'ancienne résolution n'y laissait rien)
    let mut g = partie_avec("33", "1700", 1, "normal");
    let a = armee(&g);
    let n = g.nodes.iter().find(|n| n.at("owner") == R::NEUTRAL).unwrap();
    let nid = n.ati("id");
    let (x, y) = g.node_xy(nid);
    a.set("x", x);
    a.set("y", y);
    a.set("at_node", nid);
    a.set("assault", true);
    g.start_battle(&list![&a], &list![], x, y, &Val::from(nid), false, false);
    let bt = g.battles.at(a.at("battle"));
    bt.set("pursue", false);
    g.end_battle(&bt, 1, false);
    let s = g.sites.at(-1);
    assert_eq!((s.at("n"), s.at("x"), s.at("y")), (Val::from(nid), Val::from(py::round_n(x, 2)), Val::from(py::round_n(y, 2))));
    // la vue : la liste des lieux récents, avec leur âge ; elle s'efface après SITE_DAYS jours
    let st = V::player_state(&mut g, 0);
    let t = st.at("sites").at(-1);
    assert_eq!(t.len(), 11);
    assert_eq!((t.at(2), t.at(9), t.at(10)), (Val::from(0), Val::from(nid), s.at("s")));
    g.t += conquete::engine::SITE_DAYS as f64 + 1.0;
    assert_eq!(V::player_state(&mut g, 0).at("sites").len(), 0);
}

#[test]
fn la_vue_d_une_bataille_en_cours_donne_de_quoi_animer_la_scene() {
    let (mut g, bt, a, b) = duel(false);
    a.set("stance", "retranche");
    bt.set("sit", g.situation(&bt));
    let st = V::player_state(&mut g, 0);
    let v = st.at("battles").at(0);
    for k in ["id", "x", "y", "node", "sit", "moi", "phase", "mode", "ouvrage", "meteo", "terrain", "journal", "pese", "sides", "choix", "defaut", "reco"] {
        assert!(v.has(k), "{k}");
    }
    assert_eq!((v.at("sit"), v.at("moi"), v.at("phase")), (Val::from("position"), Val::from(1), Val::from("escarmouche")));
    assert_eq!(v.at("ouvrage"), dict! {"type" => "redoute", "camp" => 1, "niv" => 0.2, "breche" => 0.0});
    let (s0, s1) = v.at("sides").pair();
    assert_eq!((s0.at("o"), s1.at("o")), (Val::from(FOE), Val::from("33")));
    for (s, x) in [(&s0, &b), (&s1, &a)] {
        assert_eq!(s.at("armes"), Game::armes_de(&x.at("regs")), "armes engagées");
        assert!(s.at("armes").ati("cav") > 0 && s.at("armes").ati("art") > 0 && s.at("armes").ati("tir") > 0);
    }
    assert_eq!(v.at("choix").iter().map(|c| c.ats("id")).collect::<Vec<_>>(), ["tenir", "carres", "contre", "embus"]);
    // les règles envoyées à la page : armes, phases, stratégies, situations
    let regles = V::rules_payload();
    for k in ["armes", "arme_de", "strats", "situations", "contre", "phases", "phase_w", "tech_arme", "renfort_km", "poursuite"] {
        assert!(regles.has(k), "{k}");
    }
    assert_eq!(regles.at("strats").len(), 20);
    assert!(regles.at("situations").at("fort").at("s_def").has("bastions"));
}

// ================================================================== 13. les IA entre elles
#[test]
fn les_batailles_entre_ia_suivent_les_memes_regles() {
    let mut g = partie();
    let (a, b) = (armee_de(&g, "40"), armee_de(&g, "47"));
    let (x, y) = plaine(&g, &a);
    for (k, dx) in [(&a, 0.0), (&b, 1.0)] {
        k.set("at_node", Val::None);
        k.set("state", "idle");
        k.set("x", x + dx);
        k.set("y", y);
    }
    D::declare_war(&mut g, "40", "47", true);
    g.start_battle(&list![&a], &list![&b], x, y, &Val::None, false, false);
    let bt = g.battles.at(a.at("battle"));
    assert_eq!((bt.at("mode"), bt.at("sit"), bt.at("demande")), (Val::from("auto"), Val::from("campagne"), Val::from(false)));
    let (s0, s1) = bt.at("sides").pair();
    assert!(R::SITUATIONS().at("campagne").at("s_att").has(&s0.at("strat")) && R::SITUATIONS().at("campagne").at("s_def").has(&s1.at("strat")));
    assert!(bt.at("reco").is_none());
    g.resolve_battle_now(&bt);
    assert!(!g.battles.truthy(), "réglée sans le joueur, poursuite comprise");
    let s = g.sites.at(-1);
    assert_eq!(s.at("st"), list![s0.at("strat"), s1.at("strat")]);
    assert!(bt.at("journal").len() >= 1 && bt.at("journal").at(0).at("ph") == "escarmouche");
    // le joueur, simple témoin : la stratégie de personne ne lui est montrée pendant la bataille
    let (mut g, bt, _a, _b) = duel(true);
    g.player = "64".to_string();
    let st = V::player_state(&mut g, 0);
    if let Some(v) = st.at("battles").iter().find(|v| v.at("id") == bt.at("id")) {
        assert!(v.at("moi").is_none() && v.at("sides").iter().all(|s| s.at("strat").is_none()) && !v.has("choix"));
    }
}

// ================================================================== anciennes sauvegardes
#[test]
fn une_ancienne_sauvegarde_se_charge_et_ses_batailles_finissent_par_strategie() {
    // une bataille que le joueur menait sur le champ de bataille (« Donner mes ordres ») : la sauvegarde d'avant
    let (mut g, bt) = bataille_de_campagne("1813", true, 3);
    let bid = bt.at("id");
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let vieille = d.at("battles").at(&bid);
    for k in ["sit", "journal", "demande", "reco", "pese", "jph", "jl", "jp", "jn", "jw", "renf", "fin", "pursue"] {
        vieille.pop(k);
    }
    for s in vieille.at("sides").iter() {
        s.pop("strat");
        s.pop("renf");
    }
    vieille.set("mode", "ordres");
    vieille.set("tac", dict! {"prisoners" => list![0, 0]});
    d.set("tactical", dict! {bid.s() => dict! {"bid" => &bid, "phase" => "combat", "units" => list![]}});
    for a in d.at("armies").values() {
        // (les anciens réglages du champ de bataille : retirés au chargement)
        a.set("pl", "debordement");
        a.set("tac_auto", false);
        a.set("rx", true);
    }
    for s in d.at("sites").iter() {
        s.pop("n");
        s.pop("s");
        s.pop("st");
        s.pop("d");
    }
    let mut g2 = V::from_dict(GEO(), &d).expect("la sauvegarde se charge");
    assert!(g2.armies.values().iter().all(|a| !a.has("pl") && !a.has("tac_auto") && !a.has("rx")), "anciens réglages retirés");
    assert!(!V::to_dict(&mut g2).has("tactical"), "la bataille tactique n'est ni relue ni réécrite");
    let bt2 = g2.battles.at(&bid);
    assert_eq!((bt2.at("mode"), bt2.at("sit")), (Val::from("attente"), Val::from("campagne")));
    assert!(!bt2.has("tac") && bt2.at("sides").at(1).at("strat").is_some() && bt2.at("sides").at(0).at("strat").is_none());
    let st = V::player_state(&mut g2, 0);
    assert!(st.at("battles").iter().any(|v| v.at("id") == bid && v.at("choix").len() == 5));
    assert!(!st.has("tac"));
    // elle finit en résolution par stratégie
    let r = TB::command(&mut g2, &dict! {"sub" => "choose", "bid" => &bid, "strat" => "frontal"});
    assert!(r.atb("ok"), "{r}");
    for _ in 0..2000 {
        if !g2.battles.has(&bid) {
            break;
        }
        if bt2.get("mode") == "poursuite" {
            assert!(TB::command(&mut g2, &dict! {"sub" => "pursue", "bid" => &bid, "v" => false}).atb("ok"));
        } else {
            TT::advance(&mut g2, 0.1);
        }
    }
    assert!(!g2.battles.has(&bid), "la bataille est finie");
    assert!(g2.events.iter().any(|e| e.at("kind") == "battle_end" && e.get("bid") == bid && e.at("journal").len() >= 1));
    // une bataille automatique d'avant (ni situation ni stratégie) : complétée au premier pas
    let (mut g, bt) = bataille_de_campagne("1813", false, 3);
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    let vieille = d.at("battles").at(bt.at("id"));
    for k in ["sit", "journal", "demande", "reco", "pese"] {
        vieille.pop(k);
    }
    for s in vieille.at("sides").iter() {
        s.pop("strat");
    }
    vieille.set("mode", "auto");
    let mut g2 = V::from_dict(GEO(), &d).unwrap();
    let bt2 = g2.battles.at(bt.at("id"));
    assert!(V::player_state(&mut g2, 0).at("battles").len() >= 1, "la vue ne dépend pas des champs nouveaux");
    g2.t += SUBSTEP;
    g2.update_battles(SUBSTEP, &bt.at("id"));
    assert!(bt2.at("sit") == "campagne" && bt2.at("sides").iter().all(|s| R::STRATS().has(&s.at("strat"))));
}

// ================================================================== les grenadiers, cinquième arme
#[test]
fn les_grenadiers_infanterie_d_elite_de_choc() {
    // peu nombreux, chers, moral élevé au départ
    let (u, l) = (R::UNITS().at("grenadiers"), R::UNITS().at("ligne"));
    assert!(u.ati("men") < l.ati("men") && u.at("cost").ati("livres") > l.at("cost").ati("livres") && u.ati("morale0") > 0);
    // feu de ligne égal à l'infanterie, choc à la charge
    assert_eq!(R::PHASE_W().at("fusillade").at("grenadiers"), R::PHASE_W().at("fusillade").at("inf"));
    assert!(R::PHASE_W().at("charge").atf("grenadiers") > R::PHASE_W().at("charge").atf("inf"));
    // médiocres en harcèlement, forts dans les stratégies d'assaut et de tenue d'ouvrage
    let m = |s: &str| R::STRATS().at(s).at("m").get_or("grenadiers", 1.0).f();
    assert!(m("harcel") < 0.7 && m("colonnes") >= 1.5 && m("bastions") > 1.3 && m("remparts") >= 1.3 && m("bombarder") >= 1.3);
    // les découvertes de l'infanterie les touchent aussi
    assert_eq!(R::TECH_ARME().at("grenadiers"), R::TECH_ARME().at("inf"));
    assert_eq!(R::UNITS().at("grenadiers").at("cls"), "inf");
    // dans la bataille : à part dans la puissance par arme ; bonus à l'assaut d'une place, d'une position, et pour y tenir
    let mesure = |attaque: bool, sit: &str| {
        let (mut g, bt, a, _b) = duel(attaque);
        for _ in 0..2 {
            a.at("regs").push(g.new_reg("grenadiers", &Val::None, &Val::from("33")));
        }
        bt.set("sit", sit);
        bt.set("t0", g.t - 0.5);
        let (s0, s1) = if sit == "campagne" { ("frontal", "contre") } else { ("frontal", "remparts") };
        un_pas(&mut g, &bt, s0, s1)[if attaque { 0 } else { 1 }][4]
    };
    let (camp, assaut) = (mesure(true, "campagne"), mesure(true, "ville"));
    assert!(camp > 0.0);
    proche(assaut / camp, R::GREN_ASSAUT * R::CONTRE.powi(0), "grenadiers à l'assaut d'une ville");
    let (camp, ouvrage) = (mesure(false, "campagne"), mesure(false, "ville"));
    proche(ouvrage / camp, R::GREN_OUVRAGE * 1.3 / 1.25 * R::CONTRE, "grenadiers sur les remparts (stratégie, ouvrage, contre de « frontal »)");
    // ils plient en dernier : sous les mêmes pertes, leur moral baisse moins
    let (mut g, bt, a, _b) = duel(true);
    a.at("regs").push(g.new_reg("grenadiers", &Val::None, &Val::from("33")));
    for r in a.at("regs").iter() {
        r.set("morale", 80.0);
    }
    bt.set("t0", g.t - 0.5);
    un_pas(&mut g, &bt, "frontal", "contre");
    let moral = |typ: &str| a.at("regs").iter().find(|r| r.at("type") == typ).unwrap().atf("morale");
    proche((80.0 - moral("grenadiers")) / (80.0 - moral("ligne")), R::GREN_MORAL, "moral des grenadiers");
    // les vues, l'aperçu et une ancienne sauvegarde : la clé « grenadiers », 0 par défaut
    let st = V::player_state(&mut g, 0);
    assert!((150..=200).contains(&st.at("battles").at(0).at("sides").at(0).at("armes").ati("grenadiers")));
    assert_eq!(st.at("battles").at(0).at("sides").at(1).at("armes").ati("grenadiers"), 0);
    let mut g = partie();
    let a = armee(&g);
    a.set("regs", a.at("regs").iter().filter(|r| r.at("type") != "grenadiers").collect::<Val>());
    assert_eq!(Game::armes_de(&a.at("regs")).ati("grenadiers"), 0);
    // on les recrute comme avant (la baïonnette), et les IA en lèvent un peu
    assert_eq!(R::UNITS().at("grenadiers").at("req"), "baionnette");
    assert!(conquete::ai::MIX().values().iter().all(|l| l.iter().filter(|t| *t == "grenadiers").count() <= 1));
    assert!(conquete::ai::MIX().at("33").has("grenadiers"));
    let _ = &mut g;
}

/// Les exemples du contrat (SPEC-BATAILLE.md), imprimés tels que le serveur les envoie :
/// `cargo test --release -p conquete --test bancs_strategie exemples_du_contrat -- --ignored --nocapture`
#[test]
#[ignore]
fn exemples_du_contrat() {
    let (mut g, bt, a, b) = duel(true);
    for r in a.at("regs").iter() {
        r.set("n", r.atf("n") * 3.0);
    }
    let vue = |g: &mut Game| V::player_state(g, 0).at("battles").at(0);
    println!("ATTENTE {}", json::dumps_compact(&vue(&mut g)));
    println!("APERCU {}", json::dumps_compact(&g.apercu("33", &a.at("id"), &dict! {"node" => g.capital_of(FOE)})));
    let r = TB::command(&mut g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "strat" => "prep"});
    println!("CHOOSE {}", json::dumps_compact(&r));
    println!("POURSUITE {}", json::dumps_compact(&vue(&mut g)));
    let r = TB::command(&mut g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => true});
    println!("PURSUE {}", json::dumps_compact(&r));
    println!("RESULTAT {}", json::dumps_compact(&g.events.iter().filter(|e| e.at("kind") == "battle_end").last().unwrap()));
    println!("TRACES {}", json::dumps_compact(&V::player_state(&mut g, 0).at("sites")));
    println!("ARMEE.armes {}", json::dumps_compact(&V::player_state(&mut g, 0).at("armies").at(0).at("armes")));
    let _ = b;
    // une bataille en cours (entre IA, vue du joueur)
    let (mut g, bt, _a, _b) = duel(false);
    bt.set("t0", g.t - 0.5);
    un_pas(&mut g, &bt, "prep", "tenir");
    println!("EN_COURS {}", json::dumps_compact(&vue(&mut g)));
}
