//! Politique intérieure (SPEC-POLITIQUE, module 5) : régime, cabinet de ministres, noblesse et peuple (impôt et
//! mécontentement de chaque classe), émeutes, révolutions et guerres civiles.
//!
//!     f['politique'] = dict(regime='absolue'|'constitutionnelle'|'republique',
//!                           cabinet={poste: ministre | None}, candidats=[ministre],
//!                           classes={'noblesse'|'peuple': dict(mecontentement (0 à 100), impot (0 à 1), mois)},
//!                           choc={classe: points} (défaites, renvois, événements ; s'efface), mandat=jour du prochain
//!                           renouvellement (None en monarchie absolue), revolution=None | dict(classe, chance),
//!                           repit=jour, seq, _lost, revolutions, guerres_civiles
//!                           [, rebelle_de=pays, capitale=nid, nom] (un camp rebelle))
//!     ministre = dict(id, nom, poste (None pour un candidat), competence (1 à 5), traits=[clé de R::MINISTRE_TRAITS], ne, depuis)
//!
//! L'impôt d'un camp (`f['tax']`, que lisent l'économie et l'ordre public) est la moyenne des deux classes : l'ancien
//! réglage (`Game::set_tax`) déplace les deux d'autant. Les chiffres sont dans rules.rs (REGIMES, POSTES, POL_…). Le
//! hasard de la politique est le sien (`_rng` : `Random::new_str`, comme les familles) : il ne décale pas celui de la
//! partie. Une révolution est une décision (events.rs) : le joueur choisit dans la fenêtre des événements ou par la
//! commande `politique` ; l'IA aussitôt, selon son caractère (ai/politique.rs).

use super::{Date, Game};
use crate::ai::AI;
use crate::events as EV;
use crate::familles as FM;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list};

const CLASSES: [&str; 2] = ["noblesse", "peuple"];
/// Les révolutions de l'histoire : (id, date, pays (« FR » : la France et ses départements), régimes concernés, texte).
/// À la date, un camp de ce pays encore sous l'un de ces régimes, dont le peuple gronde (mécontentement de 40 ou plus),
/// fait face à une révolution du peuple, comme les autres.
const HISTOIRE: &[(&str, (i64, i64, i64), &[&str], &[&str], &str)] = &[
    ("pol1789", (1789, 7, 14), &["FR"], &["absolue"], "La Bastille est prise : le peuple se soulève contre l'absolutisme."),
    ("pol1848", (1848, 2, 22), &["FR", "AU", "PR", "SA", "NA", "BA", "SX", "WU", "DK", "HA", "IT", "PO"], &["absolue", "constitutionnelle"],
     "Le printemps des peuples : barricades dans la capitale, on réclame une constitution et le suffrage."),
    ("pol1870", (1870, 9, 4), &["FR"], &["absolue"], "Après la défaite, la foule envahit le palais : on proclame la République."),
];

/// Les choix des événements datés (events.rs) qui pèsent sur les classes : (événement, rang du choix, {classe: points}).
const EVENEMENTS: &[(&str, usize, &[(&str, f64)])] = &[
    ("doleances", 0, &[("peuple", -10.0), ("noblesse", 8.0)]), ("doleances", 1, &[("peuple", 20.0), ("noblesse", -8.0)]),
    ("glorieuses", 0, &[("peuple", -8.0)]), ("glorieuses", 1, &[("peuple", 12.0), ("noblesse", -5.0)]),
    ("rev1848", 0, &[("peuple", -10.0)]), ("rev1848", 1, &[("peuple", 12.0)]),
    ("commune", 0, &[("peuple", 10.0)]), ("commune", 1, &[("noblesse", 6.0)]),
];

/// Un choix d'événement a été fait (events.fire pour une IA, events.resolve pour le joueur) : ses effets sur les classes.
pub fn evenement(g: &Game, code: &str, ev: &str, choix: usize) {
    for (_, _, d) in EVENEMENTS.iter().filter(|e| e.0 == ev && e.1 == choix) {
        choc(g, code, &Val::dict_from(d.iter().map(|(c, v)| (Val::from(*c), Val::from(*v))).collect()));
    }
}

/// Le hasard de la politique d'un camp, fixé par la partie, le jour et le camp.
fn _rng(g: &Game, code: &str, quoi: &str) -> Random {
    Random::new_str(&format!("{}-{}-{code}-pol-{quoi}", g.seed, py::int(g.t)))
}

/// « du peuple », « de la noblesse ».
pub fn de_classe(c: &str) -> &'static str {
    if c == "peuple" { "du peuple" } else { "de la noblesse" }
}

fn borne(x: f64, a: f64, b: f64) -> f64 {
    x.max(a).min(b)
}

/// Un ministre neuf (poste None : un candidat).
fn ministre(g: &Game, code: &str, p: &Val, poste: &Val, rnd: &mut Random) -> Val {
    let pays = R::pays_de(code);
    let nom = format!("{} {}", rnd.choice(&R::prenoms(pays).vec()), rnd.choice(&R::surnames(pays).vec()));
    let cles = R::MINISTRE_TRAITS().keys();
    let traits = list![];
    if rnd.random() < 0.8 {
        traits.push(rnd.choice(&cles));
        if rnd.random() < 0.25 {
            let t = rnd.choice(&cles);
            if !traits.has(&t) {
                traits.push(t);
            }
        }
    }
    p.inc("seq", 1);
    let y = g.date(&Val::None).year;
    dict! {"id" => format!("{code}-m{}", p.ati("seq")), "nom" => nom, "poste" => poste, "competence" => rnd.randint(1, 5),
           "traits" => traits, "ne" => y - rnd.randint(30, 62), "depuis" => g.t}
}

/// Le meilleur de n ministres tirés pour ce poste (le chef du gouvernement qu'appelle le roi, l'élu des urnes).
fn meilleur(g: &Game, code: &str, p: &Val, poste: &str, n: usize, rnd: &mut Random) -> Val {
    let tires: Vec<Val> = (0..n).map(|_| ministre(g, code, p, &Val::from(poste), rnd)).collect();
    py::max_by_key(tires, |m| m.ati("competence")).unwrap()
}

/// Les candidats de l'année.
fn candidats(g: &Game, code: &str, p: &Val, rnd: &mut Random) {
    let c: Val = (0..R::CANDIDATS).map(|_| ministre(g, code, p, &Val::None, rnd)).collect();
    p.set("candidats", c);
}

/// Prochain renouvellement du gouvernement (None en monarchie absolue).
fn mandat(g: &Game, regime: &str) -> Val {
    let m = R::REGIMES().at(regime).ati("mandat");
    if m > 0 { Val::from(g.t + (m * 30) as f64) } else { Val::None }
}

/// La politique d'un camp en début de partie, ou d'une ancienne sauvegarde au chargement (son impôt unique réparti
/// sur les deux classes) : le régime de son pays à cette date, un cabinet complet, des mécontentements de départ.
pub fn nouvelle(g: &Game, code: &str, regime: Option<&str>) -> Val {
    let regime = regime.unwrap_or_else(|| R::regime_historique(R::pays_de(code), g.date(&Val::None).year));
    let tax = g.factions.at(code).get_or("tax", 0.5).f();
    let base = R::REGIMES().at(regime).at("base");
    let classes = Val::dict_from(CLASSES.iter().map(|c| (Val::from(*c), dict! {"mecontentement" => base.atf(*c), "impot" => tax, "mois" => 0})).collect());
    let p = dict! {"regime" => regime, "cabinet" => dict! {}, "candidats" => list![], "classes" => classes,
                   "choc" => dict! {"noblesse" => 0.0, "peuple" => 0.0}, "mandat" => mandat(g, regime), "revolution" => Val::None,
                   "repit" => 0.0, "seq" => 0, "_lost" => g.factions.at(code).at("stats").get_or("lost", 0),
                   "revolutions" => 0, "guerres_civiles" => 0};
    let mut rnd = _rng(g, code, "cabinet");
    for poste in R::POSTES().keys() {
        let m = meilleur(g, code, &p, poste.s(), 2, &mut rnd);
        p.at("cabinet").set(&poste, m);
    }
    candidats(g, code, &p, &mut rnd);
    p
}

/// Ce qui manque à une ancienne sauvegarde ; les camps rebelles réinscrits dans les tables des camps (R::inscrire_rebelle).
/// Appelé au début de views::migrate.
pub fn migrer(g: &mut Game) {
    for (code, f) in g.factions.items() {
        if !f.has("politique") {
            f.set("politique", nouvelle(g, code.s(), None));
        }
        let p = f.at("politique");
        if p.has("rebelle_de") {
            inscrire(code.s(), &p.ats("nom"), &p.get_or("couleur", couleur(p.ats("regime").as_str())).string());
        }
    }
}

/// Un camp rebelle dans les tables des camps (R::inscrire_rebelle) et l'armée type des IA (ai::MIX).
fn inscrire(r: &str, nom: &str, couleur: &str) {
    R::inscrire_rebelle(r, nom, couleur);
    let mix = crate::ai::MIX();
    mix.set(r, mix.get_or(R::pays_de(r), mix.at("33")));
}

/// La couleur d'un camp rebelle, selon le régime qu'il porte.
fn couleur(regime: &str) -> String {
    match regime {
        "republique" => "#c8423a",
        "absolue" => "#e9e2c8",
        _ => "#5b7fc4",
    }
    .to_string()
}

// ------------------------------------------------------------------ effets

/// Les effets du régime et du cabinet sur les modificateurs du camp (Game::recompute_mods).
pub fn mods(f: &Val, m: &Val) {
    let p = f.get("politique");
    if !p.is_dict() {
        return;
    }
    let ajoute = |k: &Val, v: f64| m.set(k, m.get_or(k, 0.0).f() + v);
    for (k, v) in R::REGIMES().at(p.at("regime")).at("fx").items() {
        ajoute(&k, v.f());
    }
    for (poste, mi) in p.at("cabinet").items() {
        if !mi.is_dict() {
            continue;
        }
        for (k, v) in R::POSTES().at(&poste).at("fx").items() {
            ajoute(&k, v.f() * mi.atf("competence"));
        }
        for t in mi.at("traits").iter() {
            for (k, v) in R::MINISTRE_TRAITS().at(&t).at("fx").items() {
                ajoute(&k, v.f());
            }
        }
    }
}

/// Ce que le mécontentement des classes ôte à l'ordre public visé (Game::stab_targets).
pub fn malus_ordre(f: &Val) -> f64 {
    let p = f.get("politique");
    if !p.is_dict() {
        return 0.0;
    }
    CLASSES.iter().map(|c| (p.at("classes").at(*c).atf("mecontentement") - R::POL_ORDRE).max(0.0) / R::POL_ORDRE_K).sum()
}

/// L'impôt moyen a changé (Game::set_tax, l'ancien réglage unique) : les deux classes bougent d'autant, pour que leur
/// moyenne soit `f['tax']` (si l'une bute sur 0 ou 1, l'autre compense).
pub fn regler_impot_moyen(f: &Val) {
    let p = f.get("politique");
    if !p.is_dict() {
        return;
    }
    let (cn, cp) = (p.at("classes").at("noblesse"), p.at("classes").at("peuple"));
    let t = f.atf("tax");
    let d = t - (cn.atf("impot") + cp.atf("impot")) / 2.0;
    let n = borne(cn.atf("impot") + d, 0.0, 1.0);
    let pe = borne(2.0 * t - n, 0.0, 1.0);
    let n = borne(2.0 * t - pe, 0.0, 1.0);
    cn.set("impot", py::round_n(n, 3));
    cp.set("impot", py::round_n(pe, 3));
}

/// L'impôt d'une classe (commande `politique`, IA) ; l'impôt du camp devient la moyenne des deux.
pub fn regler_impot(g: &mut Game, code: &str, classe: &str, v: f64) {
    let f = g.factions.at(code);
    let cl = f.at("politique").at("classes");
    cl.at(classe).set("impot", py::round_n(borne(v, 0.0, 1.0), 2));
    f.set("tax", py::round_n((cl.at("noblesse").atf("impot") + cl.at("peuple").atf("impot")) / 2.0, 3));
    g._dirty_income = true;
}

/// Un choc sur le mécontentement des classes ({classe: points}) : événement, renvoi, concession.
pub fn choc(g: &Game, code: &str, d: &Val) {
    let p = g.factions.at(code).get("politique");
    if !p.is_dict() {
        return; // (une partie posée à la main, sans politique)
    }
    let ch = p.at("choc");
    for (c, v) in d.items() {
        if ch.has(&c) {
            ch.set(&c, ch.atf(&c) + v.f());
        }
    }
}

/// La cible du mécontentement de chaque classe et ses raisons [(texte, valeur)].
pub fn cible(g: &Game, code: &str) -> Vec<(f64, Vec<(String, f64)>)> {
    let f = g.factions.at(code);
    let p = f.at("politique");
    let reg = R::REGIMES().at(p.at("regime"));
    let mine = g.owned(code);
    let places = mine.len().max(1) as f64;
    let (mut eglises, mut univ) = (0, 0);
    for n in &mine {
        eglises += crate::cities::niveau(n, "eglise");
        univ += crate::cities::niveau(n, "universite");
    }
    let guerres = g.factions.keys().iter().filter(|o| o.s() != code && g.factions.at(*o).atb("alive") && g.at_war(code, o.s())).count() as f64;
    let weary = f.get_or("weary", 0.0).f();
    let k_impot = (1.0 + g.mod_(code, "tax_unrest", 0.0)).max(0.0); // (le cadastre adoucit les impôts lourds)
    let (imp_n, imp_p) = (p.at("classes").at("noblesse").atf("impot"), p.at("classes").at("peuple").atf("impot"));
    let mut out = vec![];
    for c in CLASSES {
        let mut r: Vec<(String, f64)> = vec![(format!("Régime : {}", reg.at("label").s().to_lowercase()), reg.at("base").atf(c))];
        let imp = p.at("classes").at(c).atf("impot");
        let x = (imp - 0.5) * R::POL_IMPOT * reg.at("sensible").atf(c);
        r.push(("Impôts".to_string(), if x > 0.0 { x * k_impot } else { x }));
        if c == "peuple" && imp_p > imp_n {
            r.push(("Injustice fiscale (la noblesse paie moins)".to_string(), (imp_p - imp_n) * R::POL_INJUSTICE));
        }
        if guerres > 0.0 {
            r.push(("Guerres".to_string(), if c == "peuple" { (2.0 * guerres).min(6.0) } else { guerres.min(3.0) }));
        }
        if weary > 0.0 {
            r.push(("Lassitude de la guerre".to_string(), weary * if c == "peuple" { 0.25 } else { 0.12 }));
        }
        if f.getb("famine") && c == "peuple" {
            r.push(("Famine".to_string(), 15.0));
        }
        if f.getb("banqueroute") {
            r.push(("Trésor vide".to_string(), if c == "peuple" { 5.0 } else { 10.0 }));
        }
        if eglises > 0 && c == "peuple" {
            r.push(("Églises".to_string(), -12.0 * (eglises as f64 / places).min(1.0)));
        }
        if univ > 0 {
            let u = univ as f64;
            r.push(("Universités (idées nouvelles)".to_string(), if c == "peuple" { (2.0 * u).min(6.0) } else { -(1.5 * u).min(4.0) }));
        }
        let mut mi = 0.0;
        for (poste, m) in p.at("cabinet").items() {
            if m.is_dict() {
                mi += R::POSTES().at(&poste).atf("mec") * m.atf("competence");
                for t in m.at("traits").iter() {
                    mi += R::MINISTRE_TRAITS().at(&t).at("mec").get_or(c, 0.0).f();
                }
            }
        }
        if mi != 0.0 {
            r.push(("Ministres".to_string(), mi));
        }
        let ch = p.at("choc").atf(c);
        if ch.abs() >= 0.5 {
            r.push(("Défaites, renvois et événements".to_string(), ch));
        }
        let t: f64 = r.iter().map(|x| x.1).sum();
        out.push((borne(t, 0.0, 100.0), r));
    }
    out
}

// ------------------------------------------------------------------ chaque mois

/// En fin de mois (Game::monthly) : IA, mécontentements, gouvernement, émeutes et révolutions, révolutions de l'histoire,
/// fin des guerres civiles.
pub fn mois(g: &mut Game, d: Date) {
    histoire(g, d);
    let codes: Vec<String> = g.factions.items().into_iter().filter(|(_, f)| f.atb("alive") && f.get("politique").is_dict()).map(|(c, _)| c.string()).collect();
    for code in &codes {
        if !g.factions.at(code).atb("alive") {
            continue;
        }
        if *code != g.player {
            crate::ai::politique::mois(g, code, d);
        }
        mois_camp(g, code, d);
    }
    fin_des_guerres_civiles(g);
}

fn mois_camp(g: &mut Game, code: &str, d: Date) {
    let f = g.factions.at(code);
    let p = f.at("politique");
    let regime = p.ats("regime");
    let joueur = code == g.player;
    // défaites du mois : un choc sur les deux classes ; en monarchie constitutionnelle, le gouvernement peut tomber
    let lost = f.at("stats").get_or("lost", 0).f();
    let defaites = (lost - p.get_or("_lost", 0).f()).clamp(0.0, 5.0);
    p.set("_lost", lost);
    let ch = p.at("choc");
    for c in CLASSES {
        ch.set(c, ch.atf(c) * R::POL_CHOC_OUBLI + 2.0 * defaites);
    }
    let cibles = cible(g, code);
    let mut changement = false;
    for (c, (t, _)) in CLASSES.iter().zip(&cibles) {
        let cl = p.at("classes").at(*c);
        let avant = cl.atf("mecontentement");
        let m = avant + (t - avant) * R::POL_VITESSE;
        cl.set("mecontentement", py::round_n(m, 2));
        cl.set("mois", if m >= R::SEUIL_REVOLUTION { cl.ati("mois") + 1 } else { 0 });
        if avant < R::SEUIL_EMEUTE && m >= R::SEUIL_EMEUTE {
            let t = format!(
                "Émeutes : {} gronde (mécontentement {} %). L'ordre public se dégrade ; au-delà de {} %, une révolution menace.",
                R::CLASSES().at(*c).ats("label").to_lowercase().replace("noblesse", "la noblesse").replace("peuple", "le peuple"),
                py::int(m),
                R::SEUIL_REVOLUTION
            );
            if joueur {
                g.log("revolte", &t, &dict! {"who" => code, "important" => true});
            }
        }
    }
    // renouvellement du gouvernement : chef du gouvernement (monarchie constitutionnelle), élections (république)
    let echu = p.at("mandat").is_some() && g.t >= p.atf("mandat");
    if regime == "constitutionnelle" && (echu || defaites >= 2.0) {
        let mut rnd = _rng(g, code, "chef");
        let m = meilleur(g, code, &p, "chef", 2, &mut rnd);
        let t = format!("Nouveau Premier ministre : {}{}.", m.at("nom"), if echu { "" } else { ", après les défaites" });
        p.at("cabinet").set("chef", m);
        p.set("mandat", mandat(g, &regime));
        changement = true;
        if joueur {
            g.log("info", &t, &dict! {"who" => code, "important" => true});
        }
    } else if regime == "republique" && echu {
        elections(g, code);
        changement = true;
    }
    if d.month == 1 {
        let mut rnd = _rng(g, code, "annee");
        candidats(g, code, &p, &mut rnd);
        if regime == "absolue" {
            // ministres à vie : la mort de l'un d'eux appelle son successeur
            let y = d.year;
            for (poste, m) in p.at("cabinet").items() {
                if m.is_dict() && rnd.random() < ((y - m.ati("ne") - 50) as f64 * 0.012).clamp(0.005, 0.6) {
                    let n = meilleur(g, code, &p, poste.s(), 2, &mut rnd);
                    let t = format!("Mort du ministre {} ({}) ; {} lui succède.", m.at("nom"), R::POSTES().at(&poste).ats("label").to_lowercase(), n.at("nom"));
                    p.at("cabinet").set(&poste, n);
                    changement = true;
                    if joueur {
                        g.log("info", &t, &dict! {"who" => code});
                    }
                }
            }
        }
    }
    if changement {
        g.recompute_mods(code);
    }
    // révolution : une classe au-delà du seuil depuis assez longtemps
    if p.get("revolution").is_none() && g.t >= p.get_or("repit", 0.0).f() {
        let c = CLASSES.into_iter().find(|c| p.at("classes").at(*c).ati("mois") >= R::REVOLUTION_MOIS);
        if let Some(c) = c {
            revolution(g, code, c, None);
        }
    }
}

/// Élections (république) : un nouveau cabinet ; un peuple mécontent porte l'opposition au pouvoir (ministres populaires
/// ou réformateurs). Les urnes apaisent un peu le peuple.
fn elections(g: &mut Game, code: &str) {
    let p = g.factions.at(code).at("politique");
    let mut rnd = _rng(g, code, "elections");
    let opposition = p.at("classes").at("peuple").atf("mecontentement") > 50.0;
    for poste in R::POSTES().keys() {
        let m = meilleur(g, code, &p, poste.s(), 2, &mut rnd);
        if opposition && !m.at("traits").has("populaire") && !m.at("traits").has("reformateur") {
            m.at("traits").push(if rnd.random() < 0.5 { "populaire" } else { "reformateur" });
        }
        p.at("cabinet").set(&poste, m);
    }
    choc(g, code, &dict! {"peuple" => -8});
    p.set("mandat", mandat(g, "republique"));
    let t = format!(
        "Élections {} : {} ; nouveau chef du gouvernement, {}.",
        R::de(&g.fname(code)),
        if opposition { "l'opposition l'emporte" } else { "la majorité est reconduite" },
        p.at("cabinet").at("chef").at("nom")
    );
    let imp = code == g.player;
    g.log("info", &t, &dict! {"who" => code, "important" => imp});
}

/// Les révolutions de l'histoire (HISTOIRE) passent par le mécanisme commun.
fn histoire(g: &mut Game, d: Date) {
    let jour = d.toordinal();
    for &(id, (a, m, j), pays, regimes, texte) in HISTOIRE {
        let o = Date::new(a, m, j).toordinal();
        if jour < o || g.ev_done.has(id) {
            continue;
        }
        g.ev_done.push(id);
        if jour - o > 62 {
            continue; // (une partie commencée après, ou une ancienne sauvegarde : c'est de l'histoire ancienne)
        }
        for (code, f) in g.factions.items() {
            let code = code.string();
            let p = f.get("politique");
            let du_pays = pays.contains(&code.as_str()) || (pays.contains(&"FR") && !R::est_pays(&Val::from(code.as_str())) && !R::est_rebelle(&code));
            if f.atb("alive") && du_pays && p.is_dict() && regimes.contains(&p.ats("regime").as_str())
                && p.get("revolution").is_none() && p.at("classes").at("peuple").atf("mecontentement") >= 40.0
            {
                revolution(g, &code, "peuple", Some(texte));
            }
        }
    }
}

// ------------------------------------------------------------------ révolutions

/// La chance de réprimer une révolution : le régime, le ministre de la Justice, les garnisons, la colère de la classe.
pub fn chance_repression(g: &Game, code: &str, classe: &str) -> f64 {
    let p = g.factions.at(code).at("politique");
    let mine = g.owned(code);
    let tenues = mine.iter().filter(|n| n.atb("garrison")).count() as f64 / mine.len().max(1) as f64;
    let just = p.at("cabinet").get("justice");
    let comp = if just.is_dict() { just.atf("competence") } else { 0.0 };
    let m = p.at("classes").at(classe).atf("mecontentement");
    let x = 0.35 + R::REGIMES().at(p.at("regime")).atf("repression") + 0.04 * comp + 0.2 * tenues - (m - R::SEUIL_REVOLUTION).max(0.0) / 100.0;
    py::round_n(borne(x, 0.1, 0.85), 2)
}

/// Le régime qu'obtient une classe qui l'emporte (ou un pas vers lui quand on lui cède).
fn but(classe: &str) -> &'static str {
    if classe == "noblesse" { "absolue" } else { "republique" }
}
fn pas_vers(regime: &str, cible: &str) -> &'static str {
    const ORDRE: [&str; 3] = ["absolue", "constitutionnelle", "republique"];
    let (i, j) = (ORDRE.iter().position(|r| *r == regime).unwrap_or(0), ORDRE.iter().position(|r| *r == cible).unwrap_or(0));
    ORDRE[if j > i { i + 1 } else if j < i { i - 1 } else { i }]
}

/// Une révolution éclate : une décision (réprimer, abdiquer, céder ; sans réponse, on cède), comme un événement daté.
/// texte : celui d'une révolution de l'histoire.
pub fn revolution(g: &mut Game, code: &str, classe: &str, texte: Option<&str>) {
    let f = g.factions.at(code);
    let p = f.at("politique");
    let chance = chance_repression(g, code, classe);
    let regime = p.ats("regime");
    let vers = pas_vers(&regime, but(classe));
    p.set("revolution", dict! {"classe" => classe, "chance" => chance});
    p.set("repit", g.t + (R::REVOLUTION_REPIT * 30) as f64);
    p.inc("revolutions", 1);
    let places = g.owned(code).len() as i64;
    let cout = 100 + 15 * places;
    let fx = |choix: &str| dict! {"politique" => dict! {"revolution" => choix, "classe" => classe, "chance" => chance}};
    let ceder = fx("ceder");
    ceder.set("res", dict! {"livres" => -cout});
    let abdiquer = fx("abdiquer");
    abdiquer.set("glory", -5);
    let [w_rep, w_abd, w_ced] = crate::ai::politique::poids_revolution(g, code, chance);
    let qui = if classe == "peuple" { "Le peuple" } else { "La noblesse" };
    let text = format!(
        "{}{qui} se soulève contre le gouvernement et réclame {}. Réprimer peut réussir ({} %) ; sinon la révolution l'emporte{}.",
        texte.map_or(String::new(), |t| format!("{t} ")),
        if vers == regime { "d'autres ministres et moins d'impôts".to_string() } else { format!("la {}", R::REGIMES().at(vers).ats("label").to_lowercase()) },
        py::int(chance * 100.0),
        if places >= R::GUERRE_CIVILE_PLACES { " et la guerre civile éclate" } else { "" }
    );
    let ev = dict! {
        "id" => "revolution", "who" => list![code], "title" => format!("Révolution {}", R::de(&g.fname(code))), "text" => text,
        "choices" => list![
            dict! {"label" => "Réprimer : envoyer la troupe", "fx" => fx("reprimer"), "ai" => w_rep},
            dict! {"label" => format!("Abdiquer : la {}", R::REGIMES().at(but(classe)).ats("label").to_lowercase()), "fx" => abdiquer, "ai" => w_abd},
            dict! {"label" => "Céder : des concessions", "fx" => ceder, "ai" => w_ced}
        ]
    };
    EV::fire(g, code, &ev, "hist");
}

/// Les effets politiques d'un choix (events.apply) : fx['politique'] = dict(revolution=choix, classe, chance) ou dict(jouer=camp).
pub fn appliquer(g: &mut Game, code: &str, fx: &Val) {
    let jouer_ = fx.get("jouer");
    if jouer_.is_str() {
        jouer(g, jouer_.s());
        return;
    }
    let (choix, classe) = (fx.ats("revolution"), fx.ats("classe"));
    let f = g.factions.at(code);
    let p = f.at("politique");
    p.set("revolution", Val::None);
    for c in CLASSES {
        p.at("classes").at(c).set("mois", 0);
    }
    let cl = p.at("classes").at(&classe);
    let baisse = |cl: &Val, x: f64| cl.set("mecontentement", (cl.atf("mecontentement") - x).max(0.0));
    let nom = g.fname(code);
    let qui = if classe == "peuple" { "le peuple" } else { "la noblesse" };
    let imp = code == g.player || g.theatre();
    match choix.as_str() {
        "reprimer" => {
            if _rng(g, code, "repression").random() < fx.atf("chance") {
                baisse(&cl, 30.0);
                for n in g.owned(code) {
                    n.set("stab", (n.atf("stab") - 0.05).max(0.0));
                }
                f.set("weary", (f.get_or("weary", 0.0).f() + 5.0).min(100.0));
                let t = format!("{nom} : la troupe écrase la révolution ; {qui} se tait, pour un temps.");
                g.log("revolte", &t, &dict! {"who" => code, "important" => imp});
            } else {
                victoire(g, code, &classe);
            }
        }
        "ceder" => {
            let regime = p.ats("regime");
            let vers = pas_vers(&regime, but(&classe));
            baisse(&cl, 30.0);
            let autre = if classe == "peuple" { "noblesse" } else { "peuple" };
            choc(g, code, &dict! {autre => 10});
            let t = if vers != regime {
                changer_regime(g, code, vers);
                format!("{nom} cède à {qui} et devient une {}.", R::REGIMES().at(vers).ats("label").to_lowercase())
            } else {
                regler_impot(g, code, &classe, cl.atf("impot") - 0.2);
                format!("{nom} cède à {qui} : de nouveaux ministres et moins d'impôts.")
            };
            g.log("revolte", &t, &dict! {"who" => code, "important" => imp});
        }
        "abdiquer" => {
            baisse(&cl, 40.0);
            let m = f.at("maison");
            let chef = if m.is_dict() { m.get("chef") } else { Val::None };
            if chef.is_dict() && m.atb("heritiers") {
                let h = py::min_by_key(m.at("heritiers").vec(), |x| x.ati("ne")).unwrap();
                m.at("heritiers").remove(&h);
                m.set("chef", dict! {"nom" => h.at("nom"), "ne" => h.at("ne"), "trait" => chef.at("trait")});
                m.set("conjoint", h.get("conjoint"));
            }
            changer_regime(g, code, but(&classe));
            let t = format!(
                "{} abdique devant {qui} : {nom} devient une {}.",
                if chef.is_dict() { chef.ats("nom") } else { "Le souverain".to_string() },
                R::REGIMES().at(but(&classe)).ats("label").to_lowercase()
            );
            g.log("revolte", &t, &dict! {"who" => code, "important" => imp});
        }
        _ => {}
    }
    g.recompute_mods(code);
}

/// Un nouveau régime : le gouvernement tombe avec l'ancien.
fn changer_regime(g: &mut Game, code: &str, regime: &str) {
    let p = g.factions.at(code).at("politique");
    p.set("regime", regime);
    p.set("mandat", mandat(g, regime));
    let mut rnd = _rng(g, code, "regime");
    let m = meilleur(g, code, &p, "chef", 2, &mut rnd);
    p.at("cabinet").set("chef", m);
    g.recompute_mods(code);
}

/// La révolution l'emporte : le régime que veut la classe ; un grand camp se déchire en guerre civile.
fn victoire(g: &mut Game, code: &str, classe: &str) {
    let p = g.factions.at(code).at("politique");
    let regime = but(classe);
    if regime != p.ats("regime") && g.owned(code).len() as i64 >= R::GUERRE_CIVILE_PLACES {
        if let Some(r) = guerre_civile(g, code, classe, regime) {
            p.inc("guerres_civiles", 1);
            if code == g.player {
                // le joueur peut prendre la tête des révolutionnaires
                let ev = dict! {
                    "id" => "guerre_civile", "who" => list![code], "title" => "Guerre civile",
                    "text" => format!("{} se dresse contre vous. Vous pouvez rester fidèle au gouvernement, ou prendre la tête des révolutionnaires.", g.fname(&r)),
                    "choices" => list![
                        dict! {"label" => format!("Prendre la tête {}", R::de(&g.fname(&r))), "fx" => dict! {"politique" => dict! {"jouer" => &r}}, "ai" => 0},
                        dict! {"label" => "Rester fidèle au gouvernement", "fx" => dict! {}, "ai" => 1}
                    ]
                };
                EV::fire(g, code, &ev, "hist");
            }
            return;
        }
    }
    // sans guerre civile : le gouvernement tombe, la classe obtient son régime
    let cl = p.at("classes").at(classe);
    cl.set("mecontentement", cl.atf("mecontentement").min(40.0));
    changer_regime(g, code, regime);
    let t = format!("La révolution l'emporte : {} devient une {}.", g.fname(code), R::REGIMES().at(regime).ats("label").to_lowercase());
    let imp = code == g.player || g.theatre();
    g.log("revolte", &t, &dict! {"who" => code, "important" => imp});
}

/// La guerre civile : une part des places (autour de la plus grande ville après la capitale) et des armées qui s'y
/// trouvent passe à un camp rebelle (« FRr ») qui porte le nouveau régime. Rend son code (None : pas de guerre civile).
pub fn guerre_civile(g: &mut Game, code: &str, classe: &str, regime: &str) -> Option<String> {
    let r = format!("{code}r");
    if g.factions.has(&r) && g.factions.at(&r).atb("alive") {
        return None; // (les rebelles d'une guerre en cours)
    }
    let cap = g.capital_of(code);
    let mine: Vec<Val> = g.owned(code).into_iter().filter(|n| n.at("id") != cap && !n.atb("siege")).collect();
    let k = ((g.owned(code).len() as f64 * R::GUERRE_CIVILE_PART).round() as usize).max(2);
    if mine.len() < k {
        return None;
    }
    let xy = |n: &Val| {
        let gn = g.geo.nodes.at(n.at("id"));
        (gn.atf("x"), gn.atf("y"))
    };
    let siege = py::max_by_key(mine.clone(), |n| (py::int(n.get_or("pop", 0).f()), -n.ati("id"))).unwrap();
    let (sx, sy) = xy(&siege);
    let prises: Vec<Val> = py::sorted_by_key(mine, |n| {
        let (x, y) = xy(n);
        (py::int((x - sx).powi(2) + (y - sy).powi(2)), n.ati("id"))
    })
    .into_iter()
    .take(k)
    .collect();
    let ids = Val::set_from(prises.iter().map(|n| n.at("id")).collect());
    let f = g.factions.at(code);
    let p0 = f.at("politique");
    let nom = format!(
        "{} ({})",
        g.fname(code),
        match regime { "republique" => "républicains", "absolue" => "royalistes", _ => "constitutionnels" }
    );
    inscrire(&r, &nom, &couleur(regime));
    // le camp rebelle : une part du trésor, les techniques du pays, ses relations
    let res = dict! {};
    for (k_, v) in f.at("res").items() {
        let part = (v.f() * 0.3).max(0.0);
        res.set(&k_, py::round_n(part, 1));
        f.at("res").set(&k_, v.f() - part);
    }
    let rel = dict! {};
    for (o, v) in f.at("rel").items() {
        rel.set(&o, v);
    }
    rel.set(code, -100);
    let nf = dict! {
        "code" => &r, "alive" => true, "res" => res, "income" => f.at("income").copy(), "slider" => 0.5,
        "research" => Val::dict_from(R::BRANCHES().iter().map(|b| (b, Val::None)).collect()), "techs" => f.at("techs").copy(),
        "rel" => rel, "trade" => dict! {}, "truce" => dict! {}, "overlord" => Val::None, "war_since" => dict! {code => g.t},
        "mods" => dict! {}, "army_count" => 0, "stats" => dict! {"won" => 0, "lost" => 0, "captured" => 0, "killed" => 0},
        "start_nodes" => k, "alerts" => dict! {}, "tax" => f.at("tax"), "intel" => dict! {}, "prisoners" => dict! {},
        "weary" => 0.0, "prestige" => 0.0, "treaties" => dict! {}, "tarif" => 0, "douaniers" => false, "last_war" => g.t, "refu" => 0.0
    };
    g.factions.set(&r, &nf);
    let maison = FM::nouvelle(g, &r);
    nf.set("maison", maison);
    let p = nouvelle(g, &r, Some(regime));
    for c in CLASSES {
        p.at("classes").at(c).set("impot", p0.at("classes").at(c).at("impot"));
        p.at("classes").at(c).set("mecontentement", if c == classe { 20.0 } else { 50.0 });
    }
    p.update(&dict! {"rebelle_de" => code, "capitale" => siege.at("id"), "nom" => &nom, "couleur" => couleur(regime)});
    nf.set("politique", p);
    for (o, of) in g.factions.items() {
        if o != r.as_str() && o != code {
            of.at("rel").set(&r, of.at("rel").get_or(code, 0));
        }
    }
    f.at("rel").set(&r, -100);
    f.at("war_since").set(&r, g.t);
    f.set("last_war", g.t);
    g.set_status(code, &r, "guerre");
    // les places, et les armées qui s'y trouvent (hors bataille)
    for n in &prises {
        n.set("owner", r.as_str());
        n.set("stab", 0.6);
        n.set("assim", 0.7);
    }
    for a in g.armies.values() {
        if a.at_is("owner", &code) && !a.atb("battle") && ids.has(a.at("at_node")) {
            a.set("owner", r.as_str());
            a.set("path", list![]);
            a.set("state", "idle");
        }
    }
    // la mère patrie : la classe en colère est partie avec les rebelles
    let cl = p0.at("classes").at(classe);
    cl.set("mecontentement", (cl.atf("mecontentement") - 25.0).max(0.0));
    oublier_capitale(g, &r);
    if r != g.player {
        let ai = AI::new(g, &r);
        g.ais.insert(r.clone(), Some(ai));
    }
    g.recompute_mods(&r);
    g.recompute_mods(code);
    g._dirty_income = true;
    let gn = g.geo.nodes.at(siege.at("id"));
    let t = format!(
        "Guerre civile {} : la révolution l'emporte à {} ; {} prend {} et proclame la {}.",
        R::de(&g.fname(code)),
        gn.at("name"),
        nom,
        R::pl(k, "place", None),
        R::REGIMES().at(regime).ats("label").to_lowercase()
    );
    g.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &r, "important" => true});
    g.alert_pause(code == g.player);
    Some(r)
}

/// La capitale d'un camp rebelle (Game::capital_of : la carte ne la connaît pas). None pour un autre camp.
pub fn capitale_rebelle(g: &Game, code: &str) -> Option<Val> {
    if !R::est_rebelle(code) {
        return None;
    }
    let p = g.factions.get(code).get("politique");
    if p.is_dict() { Some(p.at("capitale")) } else { None }
}

/// La capitale d'un camp rebelle a changé : Game::capital_of la relira.
fn oublier_capitale(g: &Game, r: &str) {
    if let Some((_, d)) = &*g._cache_cap.borrow() {
        d.pop(r);
    }
}

/// La fin d'une guerre civile : des rebelles sans place, ou qui perdent leur capitale face à leur pays, capitulent ; une
/// capitale prise par un tiers est remplacée par leur plus grande ville.
fn fin_des_guerres_civiles(g: &mut Game) {
    for (r, f) in g.factions.items() {
        let r = r.string();
        if !R::est_rebelle(&r) || !f.atb("alive") {
            continue;
        }
        let pays = R::pays_de(&r).to_string();
        let p = f.at("politique");
        let mine = g.owned(&r);
        let tenant = g.nodes.at(p.at("capitale")).ats("owner");
        let vainqueur = if g.factions.has(pays.as_str()) && g.factions.at(pays.as_str()).atb("alive") { pays.clone() } else { R::NEUTRAL.to_string() };
        if mine.is_empty() || tenant == pays {
            g.capitulate(&r, &vainqueur);
        } else if tenant != r {
            let n = py::max_by_key(mine, |n| (py::int(n.get_or("pop", 0).f()), -n.ati("id"))).unwrap();
            p.set("capitale", n.at("id"));
            oublier_capitale(g, &r);
        }
    }
}

/// Le joueur prend la tête d'un autre camp (le camp rebelle de son pays) : son ancien camp passe à une IA.
pub fn jouer(g: &mut Game, r: &str) {
    let old = g.player.clone();
    if old == r || !g.factions.has(r) || !g.factions.at(r).atb("alive") {
        return;
    }
    g.ais.shift_remove(r);
    g.player = r.to_string();
    let ai = AI::new(g, &old);
    g.ais.insert(old.clone(), Some(ai));
    g.recompute_mods(r);
    g.recompute_mods(&old);
    let t = format!("Vous prenez la tête {} ; {} passe à d'autres mains.", R::de(&g.fname(r)), g.fname(&old));
    g.log("info", &t, &dict! {"who" => r, "important" => true});
}

/// Les effets d'un choix politique en clair (events.describe).
pub fn decrire(g: &Game, code: &str, fx: &Val) -> Val {
    let out = list![];
    let p = fx.at("politique");
    if p.has("jouer") {
        out.push(format!("vous jouez désormais {}", g.fname(p.at("jouer").s())));
        return out;
    }
    let classe = p.ats("classe");
    let regime = if g.factions.has(code) { g.factions.at(code).at("politique").ats("regime") } else { "absolue".to_string() };
    let lab = |r: &str| R::REGIMES().at(r).ats("label").to_lowercase();
    match p.ats("revolution").as_str() {
        "reprimer" => out.push(format!("{} % de chances d'écraser la révolte ; sinon la {} l'emporte", py::int(p.atf("chance") * 100.0), lab(but(&classe)))),
        "abdiquer" => out.push(format!("la {} est proclamée ; l'héritier succède au souverain", lab(but(&classe)))),
        "ceder" => {
            let vers = pas_vers(&regime, but(&classe));
            out.push(if vers != regime { format!("la {} est proclamée", lab(vers)) } else { format!("impôt {} −20 %", de_classe(&classe)) });
        }
        _ => {}
    }
    out
}

// ------------------------------------------------------------------ ordres du joueur, vue

/// Nommer un candidat à un poste (celui qui l'occupe est renvoyé).
pub fn nommer(g: &mut Game, code: &str, poste: &str, id: &str) -> (bool, String) {
    if !R::POSTES().has(poste) {
        return (false, "Poste inconnu.".to_string());
    }
    let p = g.factions.at(code).at("politique");
    let Some(m) = p.at("candidats").iter().find(|m| m.at_is("id", &id)) else {
        return (false, "Candidat introuvable.".to_string());
    };
    if p.at("cabinet").get(poste).is_dict() {
        renvoyer(g, code, poste);
    }
    p.at("candidats").remove(&m);
    m.set("poste", poste);
    m.set("depuis", g.t);
    p.at("cabinet").set(poste, &m);
    g.recompute_mods(code);
    (true, format!("{} : {}.", R::POSTES().at(poste).ats("label"), m.at("nom")))
}

/// Renvoyer le ministre d'un poste : la noblesse s'en offusque (le peuple, pour un ministre populaire).
pub fn renvoyer(g: &mut Game, code: &str, poste: &str) -> (bool, String) {
    let p = g.factions.at(code).at("politique");
    let m = p.at("cabinet").get(poste);
    if !m.is_dict() {
        return (false, "Ce poste est vacant.".to_string());
    }
    let cout = R::REGIMES().at(p.at("regime")).atf("renvoi");
    let classe = if m.at("traits").has("populaire") { "peuple" } else { "noblesse" };
    choc(g, code, &dict! {classe => cout});
    p.at("cabinet").set(poste, Val::None);
    g.recompute_mods(code);
    (true, format!("{} est renvoyé ; {} s'en offusque (+{}).", m.at("nom"), if classe == "peuple" { "le peuple" } else { "la noblesse" }, py::int(cout)))
}

/// `{cmd: "politique", sub: "impot"|"nommer"|"renvoyer"|"revolution", …}` (serveur.rs).
/// impot : classe, value (0 à 1) ; nommer : poste, ministre (id d'un candidat) ; renvoyer : poste ;
/// revolution : choix ('reprimer', 'abdiquer', 'ceder' ; 'rejoindre' ou 'fidele' quand la guerre civile éclate).
pub fn commande(g: &mut Game, code: &str, body: &Val) -> Val {
    let txt = |k: &str| { let v = body.get(k); if v.is_str() { v.string() } else { String::new() } };
    let (ok, msg) = match txt("sub").as_str() {
        "impot" => {
            let c = txt("classe");
            let v = body.get("value");
            if !CLASSES.contains(&c.as_str()) {
                (false, "Classe inconnue.".to_string())
            } else if !(matches!(v, Val::Int(_) | Val::Float(_)) && v.f().is_finite()) {
                (false, "Niveau d'impôts invalide.".to_string())
            } else {
                regler_impot(g, code, &c, v.f());
                let i = g.factions.at(code).at("politique").at("classes").at(&c).atf("impot");
                (true, format!("Impôt {} : {}.", de_classe(&c), R::tax_label(i).to_lowercase()))
            }
        }
        "nommer" => nommer(g, code, &txt("poste"), &txt("ministre")),
        "renvoyer" => renvoyer(g, code, &txt("poste")),
        "revolution" => {
            let choix = txt("choix");
            let (ev, i) = match choix.as_str() {
                "reprimer" => ("revolution", 0),
                "abdiquer" => ("revolution", 1),
                "ceder" => ("revolution", 2),
                "rejoindre" => ("guerre_civile", 0),
                "fidele" => ("guerre_civile", 1),
                _ => ("", 0),
            };
            match g.pending_ev.iter().find(|x| !ev.is_empty() && x.at_is("ev", &ev)) {
                Some(x) => EV::resolve(g, x.at("id").s(), i, false),
                None => (false, "Aucune révolution n'attend votre décision.".to_string()),
            }
        }
        _ => (false, "Commande inconnue.".to_string()),
    };
    dict! {"ok" => ok, "msg" => msg}
}

fn vue_ministre(g: &Game, m: &Val) -> Val {
    if !m.is_dict() {
        return Val::None;
    }
    dict! {"id" => m.at("id"), "nom" => m.at("nom"), "poste" => m.get("poste"), "competence" => m.at("competence"),
           "traits" => m.at("traits"), "age" => g.date(&Val::None).year - m.ati("ne")}
}

/// La politique du joueur, complète (me.politique).
pub fn vue(g: &Game, code: &str) -> Val {
    let p = g.factions.at(code).get("politique");
    if !p.is_dict() {
        return Val::None;
    }
    let cibles = cible(g, code);
    let classes = dict! {};
    for (c, (t, raisons)) in CLASSES.iter().zip(cibles) {
        let cl = p.at("classes").at(*c);
        let m = cl.atf("mecontentement");
        let etat = if m >= R::SEUIL_REVOLUTION { "revolution" } else if m >= R::SEUIL_EMEUTE { "emeutes" } else if m >= R::POL_ORDRE { "agitation" } else { "calme" };
        let raisons: Val = raisons.into_iter().filter(|r| r.1.abs() >= 0.5).map(|(t, v)| dict! {"texte" => t, "valeur" => py::round_n(v, 1)}).collect();
        classes.set(*c, dict! {"mecontentement" => py::round_n(m, 1), "impot" => cl.at("impot"), "cible" => py::round_n(t, 1),
                              "mois" => cl.at("mois"), "etat" => etat, "raisons" => raisons});
    }
    let cabinet = Val::dict_from(R::POSTES().keys().into_iter().map(|k| { let m = vue_ministre(g, &p.at("cabinet").get(&k)); (k, m) }).collect());
    let rebelles = format!("{code}r");
    let rev = p.get("revolution");
    let attente = g.pending_ev.iter().find(|x| x.at_is("ev", "revolution") || x.at_is("ev", "guerre_civile")).map(|x| x.at("ev"));
    dict! {
        "regime" => p.at("regime"), "cabinet" => cabinet,
        "candidats" => p.at("candidats").iter().map(|m| vue_ministre(g, &m)).collect::<Val>(),
        "classes" => classes,
        "mandat" => if p.at("mandat").is_some() { Val::from(TT::tours_left(g, p.atf("mandat"))) } else { Val::None },
        "revolution" => if rev.is_dict() { dict! {"classe" => rev.at("classe"), "chance" => rev.at("chance"), "decision" => attente} } else { Val::None },
        "repit" => TT::tours_left(g, p.get_or("repit", 0.0).f()),
        "rebelle_de" => p.get("rebelle_de"),
        "rebelles" => if g.factions.has(rebelles.as_str()) && g.factions.at(rebelles.as_str()).atb("alive") { Val::from(rebelles) } else { Val::None },
        "seuils" => dict! {"agitation" => R::POL_ORDRE, "emeute" => R::SEUIL_EMEUTE, "revolution" => R::SEUIL_REVOLUTION, "mois" => R::REVOLUTION_MOIS},
        "revolutions" => p.get_or("revolutions", 0), "guerres_civiles" => p.get_or("guerres_civiles", 0)
    }
}

/// Le résumé pour les autres camps : régime, mécontentement de chaque classe ; et, pour un camp rebelle, de quoi le
/// dessiner (son pays, son nom, sa couleur : la page ne le trouve pas dans rules.factions).
pub fn resume(g: &Game, code: &str) -> Val {
    let p = g.factions.at(code).get("politique");
    if !p.is_dict() {
        return Val::None;
    }
    let cl = p.at("classes");
    let d = dict! {"regime" => p.at("regime"), "noblesse" => py::int(cl.at("noblesse").atf("mecontentement")),
                   "peuple" => py::int(cl.at("peuple").atf("mecontentement"))};
    if p.has("rebelle_de") {
        let fiche = R::FACTIONS().get(code);
        d.set("rebelle", dict! {"de" => p.at("rebelle_de"), "nom" => p.at("nom"), "couleur" => fiche.get("color"), "capitale" => p.at("capitale")});
    }
    d
}
