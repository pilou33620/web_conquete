//! Banc des familles dirigeantes et des mariages (SPEC-MERCENAIRES.md, décisions 10-14) : portage de
//! tests/test_familles.py.
//!
//! POURQUOI CE BANC EXISTE. Les chefs vieillissent, meurent et se succèdent d'année en année : ces règles ne se voient
//! qu'au bout de décennies de jeu. Ici, on vieillit le chef, on vide ses héritiers et l'on appelle le moteur directement.

mod fabrique_campagne;

use conquete::diplomacy as D;
use conquete::engine::Game;
use conquete::events as EV;
use conquete::familles as FM;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{partie, partie_avec, GEO};

#[track_caller]
fn presque(a: f64, b: f64) {
    assert!((a - b).abs() < 5e-8, "{a} != {b}");
}

fn vieillir(g: &Game, code: &str, age: i64) {
    g.factions.at(code).at("maison").at("chef").set("ne", g.date(&Val::None).year - age);
}

/// n mois de janvier de suite, sans jouer le reste de l'année.
fn annees(g: &mut Game, n: i64) {
    for _ in 0..n {
        g.t += 365.0;
        FM::annuel(g);
    }
}

/// Le chef de code n'a pas d'héritier (ni trait d'ordre public) ; lien : une maison unie à la sienne par mariage.
fn sans_heritier(g: &mut Game, code: &str, lien: Option<&str>) -> Val {
    let m = g.factions.at(code).at("maison");
    m.set("heritiers", list![]);
    m.set("liens", dict! {});
    m.at("chef").set("trait", "econome");
    if let Some(lien) = lien {
        m.at("liens").set(lien, 1780);
        g.factions.at(lien).at("maison").at("liens").set(code, 1780);
    }
    g.recompute_mods(code);
    m
}

fn ordre_du_trait(g: &Game, code: &str) -> f64 {
    R::MAISON_TRAITS().at(g.factions.at(code).at("maison").at("chef").at("trait")).at("fx").get_or("order", 0).f()
}

/// `FM.mort(g, code, g.rng)` : le hasard de la partie lui-même (sorti de g le temps de l'appel, puis remis).
fn mort(g: &mut Game, code: &str) {
    let mut rng = g.rng.clone();
    FM::mort(g, code, &mut rng);
    g.rng = rng;
}

fn evaluer(g: &Game, ai: &str, frm: &str, action: &str, amount: i64) -> bool {
    D::ai_evaluate(g, ai, frm, action, amount, &Val::None, &Val::None).0
}

// ------------------------------------------------------------------ Maisons

#[test]
fn une_maison_par_camp_au_depart_et_au_chargement() {
    let mut g = partie();
    for (code, f) in g.factions.items() {
        assert!(R::MAISON_NOMS().at(&code).has(f.at("maison").at("nom")));
        assert!(R::MAISON_TRAITS().has(f.at("maison").at("chef").at("trait")));
    }
    json::dumps(&V::player_state(&mut g, 0));
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    for f in d.at("factions").values() {
        f.del("maison"); // une sauvegarde d'avant les familles
    }
    let g2 = V::from_dict(GEO(), &d).unwrap();
    assert!(g2.factions.values().iter().all(|f| f.at("maison").at("chef").truthy()));
    assert_eq!(g.factions.at("33").at("maison").at("nom"), g2.factions.at("33").at("maison").at("nom"), "tirage fixé par la partie");
}

#[test]
fn trait_par_les_modificateurs() {
    let mut g = partie();
    let ch = g.factions.at("24").at("maison").at("chef");
    for (trait_, k, v) in [("savant", "research_speed", 0.08), ("populaire", "order", 0.05), ("batisseur", "build_cost", -0.10), ("belliqueux", "recrues", 0.10)] {
        ch.set("trait", "econome");
        g.recompute_mods("24");
        let avant = g.mod_("24", k, 0.0);
        ch.set("trait", trait_);
        g.recompute_mods("24");
        presque(g.mod_("24", k, 0.0) - avant, v);
    }
}

// ------------------------------------------------------------------ Successions

#[test]
fn naissances() {
    let mut g = partie();
    let m = g.factions.at("40").at("maison");
    m.set("conjoint", dict! {"nom" => "Marie Labat", "de" => Val::None});
    m.set("heritiers", list![]);
    for _ in 0..20 {
        vieillir(&g, "40", 25);
        annees(&mut g, 1);
    }
    let n = m.at("heritiers").len() as i64;
    assert!(1 <= n && n <= R::HERITIERS_MAX);
    m.set("conjoint", Val::None);
    for _ in 0..8 {
        vieillir(&g, "40", 25);
        annees(&mut g, 1);
    }
    assert_eq!(m.at("heritiers").len() as i64, n, "pas de naissance sans mariage");
}

#[test]
fn mort_et_succession_de_l_aine() {
    let mut g = partie();
    let m = g.factions.at("47").at("maison");
    let y = g.date(&Val::None).year;
    m.set("heritiers", list![dict! {"nom" => "Pierre X", "ne" => y - 10}, dict! {"nom" => "Jean X", "ne" => y - 20, "conjoint" => dict! {"nom" => "Anne Y", "de" => "33"}}]);
    for _ in 0..30 {
        if m.at("chef").at("nom") == "Jean X" {
            break;
        }
        vieillir(&g, "47", 95);
        annees(&mut g, 1);
    }
    assert_eq!(m.at("chef").at("nom"), "Jean X", "l'aîné succède");
    assert_eq!(m.at("conjoint").at("nom"), "Anne Y", "avec son épouse");
    assert_eq!(m.at("heritiers").iter().map(|h| h.ats("nom")).collect::<Vec<_>>(), vec!["Pierre X"]);
    let mut morts = 0;
    for _ in 0..40 {
        let c = m.at("chef").at("nom");
        vieillir(&g, "47", 30);
        annees(&mut g, 1);
        morts += (m.at("chef").is_none() || m.at("chef").at("nom") != c) as i64;
    }
    assert!(morts <= 2, "mort rare avant 50 ans");
}

#[test]
fn crise_desordre() {
    let mut g = partie_avec("33", "1790", 1, "normal");
    let f = g.factions.at("64");
    sans_heritier(&mut g, "64", None);
    let cible0 = g.stab_targets().atf("64");
    mort(&mut g, "64");
    assert!(f.at("maison").at("chef").is_some(), "l'IA choisit aussitôt un successeur");
    presque(g.stab_targets().atf("64"), cible0 - 0.1 + ordre_du_trait(&g, "64"));
    g.t += (R::CRISE_JOURS + 1) as f64;
    g.recompute_mods("64");
    presque(g.stab_targets().atf("64"), cible0 + ordre_du_trait(&g, "64")); // six mois seulement
}

#[test]
fn crise_pretendant_etranger() {
    // le joueur décide : le prétendant vient en premier, le cousin (le plus prudent) en dernier
    let mut g = partie_avec("24", "1790", 1, "normal");
    sans_heritier(&mut g, "24", Some("40"));
    mort(&mut g, "24");
    let p = g.pending_ev.at(-1);
    assert_eq!(p.at("ev"), "crise_succession");
    assert_eq!(p.at("choices").len(), 3);
    assert_eq!(p.at("choices").at(0).at("fx").at("vassal"), "40");
    assert!(p.at("choices").at(-1).ats("label").starts_with("Appeler un cousin"));
    assert!(g.factions.at("24").at("maison").at("chef").is_none(), "succession disputée en attendant");
    json::dumps(&V::player_state(&mut g, 0));
    let (ok, _) = EV::resolve(&mut g, p.at("id").s(), 0, false);
    assert!(ok);
    assert_eq!(g.factions.at("24").at("overlord"), "40");
    assert_eq!(g.factions.at("24").at("maison").at("nom"), g.factions.at("40").at("maison").at("nom"));
}

#[test]
fn pretendant_econduit_guerre_de_succession() {
    let mut guerres = 0;
    for s in 0..10 {
        let mut g = partie_avec("24", "1790", s, "normal");
        sans_heritier(&mut g, "24", Some("40"));
        mort(&mut g, "24");
        let p = g.pending_ev.at(-1);
        assert_eq!(p.at("choices").at(-1).at("fx").at("refus"), "40");
        EV::resolve(&mut g, p.at("id").s(), p.at("choices").len() as i64 - 1, false);
        assert!(g.factions.at("24").at("overlord").is_none());
        guerres += g.at_war("40", "24") as i64;
    }
    assert!(0 < guerres && guerres < 10, "{guerres}");
}

// ------------------------------------------------------------------ Mariages

#[test]
fn regle_d_acceptation_de_l_ia() {
    let mut g = partie_avec("33", "1790", 1, "normal");
    for c in ["33", "24"] {
        sans_heritier(&mut g, c, None).set("conjoint", Val::None); // deux chefs seuls
    }
    let diplo = g.mod_("33", "diplo", 0.0) + g.mod_("33", "prestige", 0.0);
    g.factions.at("24").at("rel").set("33", 20.0 - diplo);
    assert!(!evaluer(&g, "24", "33", "mariage", 0), "relation trop basse");
    assert!(evaluer(&g, "24", "33", "mariage", 30), "une dot aide");
    g.factions.at("24").at("rel").set("33", 21.0 - diplo);
    assert!(evaluer(&g, "24", "33", "mariage", 0));
    D::declare_war(&mut g, "33", "24", false);
    assert!(!evaluer(&g, "24", "33", "mariage", 0), "pas avec un ennemi");
}

#[test]
fn dot_relations_liens() {
    let mut g = partie_avec("33", "1790", 1, "normal");
    let (f, o) = (g.factions.at("33"), g.factions.at("24"));
    o.at("rel").set("33", 30);
    f.at("rel").set("24", 0);
    f.at("maison").set("conjoint", Val::None); // le chef girondin est seul : c'est lui qui se marie
    o.at("maison").set("conjoint", dict! {"nom" => "X", "de" => Val::None});
    o.at("maison").set("heritiers", list![dict! {"nom" => "Louis Z", "ne" => 1770}]);
    let (l0, l1) = (f.at("res").at("livres"), o.at("res").at("livres"));
    let (ok, _) = D::act(&mut g, "33", &Val::from("24"), &Val::from("mariage"), &Val::from(200), &Val::None, &Val::None);
    assert_eq!(ok, Some(true));
    assert_eq!((f.at("res").at("livres"), o.at("res").at("livres")), (l0.py_sub(&Val::from(200)), l1.py_add(&Val::from(200))), "la dot");
    assert_eq!((o.at("rel").at("33"), f.at("rel").at("24")), (Val::from(30 + R::MARIAGE_REL), Val::from(R::MARIAGE_REL)));
    assert!(FM::lie(&g, "33", "24") && FM::lie(&g, "24", "33"));
    assert_eq!(f.at("maison").at("conjoint").at("de"), "24");
    assert_eq!(o.at("maison").at("heritiers").at(0).at("conjoint").at("de"), "33", "l'héritier, le chef étant déjà marié");
    assert!(D::act(&mut g, "33", &Val::from("24"), &Val::from("mariage"), &Val::from(0), &Val::None, &Val::None).0 != Some(true), "une seule fois");
    // l'alliance devient plus facile : il faut 20 points de relation de moins
    let seuil = |g: &Game| -> i64 {
        (-100..101).find(|&r| {
            o.at("rel").set("33", r);
            evaluer(g, "24", "33", "alliance", 0)
        }).unwrap()
    };
    let lie = seuil(&g);
    o.at("maison").at("liens").pop("33");
    assert_eq!(seuil(&g) - lie, 20);
}

#[test]
fn guerre_a_une_maison_liee_coute_l_ordre() {
    let mut g = partie_avec("33", "1790", 1, "normal");
    sans_heritier(&mut g, "33", Some("47"));
    sans_heritier(&mut g, "24", None);
    let cible0 = g.stab_targets().atf("33");
    D::declare_war(&mut g, "33", "24", false);
    presque(g.stab_targets().atf("33"), cible0); // sans lien : rien
    D::declare_war(&mut g, "33", "47", false);
    presque(g.stab_targets().atf("33"), cible0 - 0.1);
}

// ------------------------------------------------------------------ MariageEnfant

#[test]
fn pas_de_mariage_avant_seize_ans() {
    let g = partie();
    let m = g.factions.at(&g.player).at("maison");
    m.set("conjoint", Val::None);
    m.set("heritiers", list![]);
    m.at("chef").set("ne", g.date(&Val::None).year - 2); // (l'aîné, enfant, a succédé)
    assert!(FM::epoux(&g, &g.player).is_none());
    m.at("chef").set("ne", g.date(&Val::None).year - 20);
    assert!(FM::epoux(&g, &g.player).is(&m.at("chef")));
}
