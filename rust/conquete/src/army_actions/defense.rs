//! Porte game/army_actions.py, lignes 121 à 858 : défense des places, tic, fortification de fortune, quartiers,
//! compléter les rangs, relever, garde bourgeoise, réquisition, traverser et droit de passage, arrivée devant une
//! place.
//!
//! Dans tout le module : `a`, `b` = une armée (dict de g.armies) ; `n` = une place (dict de g.nodes) ; `gn` = son lieu
//! (dict de geo.nodes) ; `x` = n['aa'] ; `r` = un régiment ; `code` = le camp qui agit ; `o` = un autre camp (ou
//! R::NEUTRAL) ; `nid` = un numéro de place ; `ai` = l'IA de campagne (ai::AI), dont `ai.g` est le `g` passé à côté.
//! `(bool, String)` : (ok, message) d'une commande.
#![allow(unused_imports, unused_variables)] // (des paramètres du Python ne servent pas : g, dt…)

use super::*;
use crate::ai::AI;
use crate::diplomacy as D;
use crate::tactics::bridge as TB;
use crate::tactics::units as U;

/// Le nom du terrain en (x, y) d'un lieu : `TERRAIN[g.geo.terrain_at(gn['x'], gn['y'])][0]`.
fn terrain_name(g: &Game, gn: &Val) -> String {
    TERRAIN().at(g.geo.terrain_at(gn.atf("x"), gn.atf("y"))).ats(0)
}

/// `sum(r['max'] - r['n'] for r in regs)` (somme de Python : entiers exacts, puis flottants).
fn manque(regs: &Val) -> f64 {
    py::sum_v(regs.iter().map(|r| &r.at("max") - &r.at("n"))).f()
}

/// `sum(r['max'] for r in regs)`.
fn effectif(regs: &Val) -> f64 {
    py::sum_v(regs.iter().map(|r| r.at("max"))).f()
}

// ================================================================== défense des places

/// Niveau de défense provisoire : barricades d'une place sans remparts, redoutes devant des remparts.
/// Python : `works_level(n)`.
// game/army_actions.py, lignes 122 à 127
pub fn works_level(n: &Val) -> f64 {
    let s = node_aa(n).get_or("bar", 0.0);
    if s <= 0i64 {
        return 0.0;
    }
    (if n.at("fort") <= 0i64 { BAR_LEVEL } else { RED_LEVEL }) * s.f()
}

/// Brèche ouverte par un siège (un blocus n'abîme pas les murs).
/// Python : `breach(n)`.
// game/army_actions.py, lignes 130 à 133
pub fn breach(n: &Val) -> f64 {
    let s = n.at("siege");
    if s.truthy() && !s.getb("blocus") { s.atf("dmg") } else { 0.0 }
}

pub const BREACH_STEP: f64 = 1.0 / 2.4; // une brèche de plus sur la carte de la bataille (tactics/terrain.py, _walls) : autant de murs en moins

/// Remparts moins la brèche, et ouvrages de fortune ; att : l'assaillant, dont la dynamite ouvre une brèche de plus.
/// Python : `fort_eff(g, n, att=None)`.
/// att : None par défaut, ou le code de l'assaillant.
// game/army_actions.py, lignes 139 à 144
pub fn fort_eff(g: &Game, n: &Val, att: &Val) -> f64 {
    let mut b = breach(n);
    if g.factions.has(att) {
        let v = b + BREACH_STEP * g.mod_(att.s(), "breach", 0.0);
        b = if v < 1.0 { v } else { 1.0 };
    }
    (n.atf("fort") + works_level(n)) * (1.0 - b)
}

/// La place se prend-elle par un siège plutôt que d'emblée ?
/// Python : `walled(n)`.
// game/army_actions.py, lignes 147 à 149
pub fn walled(n: &Val) -> bool {
    n.at("fort") >= 1i64 || works_level(n) >= BAR_LEVEL * BAR_MIN
}

/// Python : `siege_k(n)`.
// game/army_actions.py, lignes 152 à 153
pub fn siege_k(n: &Val) -> f64 {
    if n.at("fort") <= 0i64 && works_level(n) > 0.0 { BAR_SIEGE } else { 1.0 }
}

/// Python : `output_k(g, n)`.
// game/army_actions.py, lignes 156 à 157
pub fn output_k(g: &Game, n: &Val) -> f64 {
    if node_aa(n).has("gd") { GARDE_PROD } else { 1.0 }
}

/// Python : `stab_bonus(g, n)`.
/// `getattr(g, '_aa_qn', ())` : le champ g._aa_qn (un set).
// game/army_actions.py, lignes 160 à 161
pub fn stab_bonus(g: &Game, n: &Val) -> f64 {
    if g._aa_qn.has(n.at("id")) { QRT_STAB } else { 0.0 }
}

/// Vivres consommés en plus par les armées en quartiers (par jour, avant les technologies).
/// Python : `extra_food(g, code)`.
// game/army_actions.py, lignes 164 à 170
pub fn extra_food(g: &Game, code: &str) -> f64 {
    let mut v = 0.0;
    for a in g.armies.values() {
        if a.at("owner") == code && a.getb("qrt") {
            v += py::sum_v(a.at("regs").iter().map(|r| &R::UNITS().at(r.at("type")).at("upkeep_v") * &r.at("n") / 100i64)).f() * QRT_FOOD;
        }
    }
    v
}

/// Rapport de forces entre nos armées devant la place et ses défenseurs.
/// Python : `force_ratio(g, code, nid)`.
/// (&mut : node_defense_power.)
// game/army_actions.py, lignes 173 à 179
pub fn force_ratio(g: &mut Game, code: &str, nid: i64) -> f64 {
    let gn = g.geo.nodes.at(nid);
    let tname = terrain_name(g, &gn);
    let mine = py::sum(
        g.armies
            .values()
            .iter()
            .filter(|b| b.at("owner") == code && b.at("at_node") == nid && (b.at("state") == "idle" || b.at("state") == "siege"))
            .map(|b| g.army_power(b, &tname)),
    );
    let d = g.node_defense_power(nid, true);
    mine / if d > 1.0 { d } else { 1.0 }
}

/// La place change de mains : ouvrages rasés, travaux et pourparlers abandonnés, bourgeois désarmés.
/// Python : `on_capture(g, nid)`.
// game/army_actions.py, lignes 182 à 193
pub fn on_capture(g: &mut Game, nid: i64) {
    let n = g.nodes.at(nid);
    let x = node_aa(&n);
    if !x.truthy() {
        return;
    }
    let ng = x.pop("ng");
    if ng.truthy() && g.factions.has(ng.at("by")) {
        g.factions.at(ng.at("by")).at("res").inc("livres", ng.at("price"));
    }
    end_garde(g, &n, true);
    x.pop("bw");
    x.pop("bar");
}

// ================================================================== tic

/// (par quarts de jour ; flush : le reste aussi, à la fin du tour des IA, pour que ce qui est dû au 1er du mois s'y
/// règle, comme une réponse de pourparlers annoncée « au prochain tour »)
/// Python : `tick(g, dt, flush=False)`.
/// flush : False par défaut. `getattr(g, '_aa_dt', 0.0)`, `getattr(g, '_aa_day', -1)` : les champs g._aa_dt, g._aa_day.
// game/army_actions.py, lignes 197 à 221
pub fn tick(g: &mut Game, dt: f64, flush: bool) {
    g._aa_dt += dt;
    if g._aa_dt < 0.25 && !(flush && g._aa_dt > 0.0) {
        return;
    }
    let dt = g._aa_dt;
    g._aa_dt = 0.0;
    quarters_tick(g, dt);
    rangs_tick(g, dt);
    for n in g.nodes.iter() {
        let x = n.get("aa");
        if !x.truthy() {
            continue;
        }
        if x.has("bw") {
            works_tick(g, &n, &x, dt);
        }
        if x.getb("bar") {
            wear_tick(g, &n, &x, dt);
        }
        if x.has("gd") && x.at("gd").at("until") <= g.t {
            end_garde(g, &n, false);
        }
        if x.has("ng") {
            neg_tick(g, &n, &x, dt);
        }
    }
    let day = py::int(g.t);
    if day != g._aa_day {
        g._aa_day = day;
        passage_tick(g);
    }
}

// ================================================================== 1. fortification de fortune

/// Python : `fortify_info(g, a, nid)`.
/// Rend (sorte : 'bar' ou 'red', jours, bois, solidité actuelle).
// game/army_actions.py, lignes 225 à 235
pub fn fortify_info(g: &Game, a: &Val, nid: i64) -> (&'static str, f64, i64, f64) {
    let (n, gn) = (g.nodes.at(nid), g.geo.nodes.at(nid));
    let kind = if n.at("fort") <= 0i64 { "bar" } else { "red" };
    let cur = node_aa(&n).get_or("bar", 0.0).f();
    let frac = if 1.0 - cur > 0.3 { 1.0 - cur } else { 0.3 };
    let men = g.army_men(a);
    let sap = py::sum_v(a.at("regs").iter().filter(|r| r.at("type") == "sapeurs").map(|r| r.at("n"))).f();
    let work = BAR_WORK().atf(gn.at("type")) * (if kind == "red" { RED_WORK } else { 1.0 }) * frac;
    let m = men + BAR_SAPEUR as f64 * sap;
    let days = clamp(work / if m > 1.0 { m } else { 1.0 }, BAR_DAYS.0, BAR_DAYS.1);
    let bois = py::round(BAR_BOIS().atf(gn.at("type")) * frac);
    (kind, py::round_n(days, 1), bois, cur)
}

/// Python : `works_name(n, kind=None)`.
/// kind : None par défaut (selon la place), ou 'bar' / 'red'.
// game/army_actions.py, lignes 238 à 240
pub fn works_name(n: &Val, kind: &Val) -> &'static str {
    let bar = if kind.truthy() { *kind == "bar" } else { n.at("fort") <= 0i64 };
    if bar { "barricades et palissades" } else { "redoutes et ouvrages de campagne" }
}

/// Python : `fortify(g, code, a)`.
// game/army_actions.py, lignes 243 à 258
pub fn fortify(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = own_place(g, code, a, true);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    let x = aa(&n);
    if x.has("bw") {
        return (false, "Des travaux sont déjà en cours dans cette place.".to_string());
    }
    let (kind, days, bois, cur) = fortify_info(g, a, nid);
    let k = Val::from(kind);
    if cur >= BAR_REDO {
        return (false, format!("Les {} tiennent encore ({} %).", works_name(&n, &k), py::int(cur * 100.0)));
    }
    let res = g.factions.at(code).at("res");
    if res.at("bois") < bois {
        return (false, format!("Il faut {bois} bois."));
    }
    res.dec("bois", bois);
    x.set("bw", dict! {"by" => a.at("id"), "code" => code, "kind" => kind, "left" => days, "total" => days});
    (true, format!("La troupe élève des {} à {} ({}, {bois} bois).", works_name(&n, &k), place(g, nid), TT::part_tour(days)))
}

/// Python : `works_tick(g, n, x, dt)`.
// game/army_actions.py, lignes 261 à 278
pub fn works_tick(g: &mut Game, n: &Val, x: &Val, dt: f64) {
    let w = x.at("bw");
    let a = g.armies.get(w.at("by"));
    let nid = n.ati("id");
    let wc = w.ats("code");
    if !a.truthy() || a.at("at_node") != nid || a.at("state") != "idle" || n.at("owner") != wc || a.at("owner") != wc {
        x.del("bw");
        if wc == g.player {
            g.log("armee", &format!("Travaux abandonnés à {} : la troupe est partie.", place(g, nid)), &lieu(g.node_xy(nid), &wc));
        }
        return;
    }
    w.dec("left", dt);
    if w.at("left") > 0i64 {
        return;
    }
    x.del("bw");
    x.set("bar", 1.0);
    if wc == g.player {
        let txt = if w.at("kind") == "bar" { "la place pourra soutenir un siège" } else { "la défense en est un peu renforcée" };
        let texte = format!(
            "{} achevées à {} : {txt}, le temps qu'elles durent (environ trois tours).",
            py::capitalize(works_name(n, &w.at("kind"))),
            place(g, nid)
        );
        g.log("armee", &texte, &lieu_imp(g.node_xy(nid), &wc, true));
    }
}

/// Python : `wear_tick(g, n, x, dt)`.
// game/army_actions.py, lignes 281 à 298
pub fn wear_tick(g: &mut Game, n: &Val, x: &Val, dt: f64) {
    let nid = n.ati("id");
    let (gx, gy) = g.node_xy(nid);
    let mut k = BAR_WEAR;
    if ["pluie", "orage", "neige", "tempete"].contains(&g.weather.at(g.zone_of(gx, gy)).ats("kind").as_str()) {
        k *= BAR_WET;
    }
    if g.season() == "hiver" {
        k *= BAR_WINTER;
    }
    let s = n.at("siege");
    if s.truthy() && !s.getb("blocus") && !s.getb("occupy") {
        let mut guns = 0i64;
        for b in g.armies.values() {
            if b.at("at_node") == nid && b.at("owner") == s.at("by") && (b.at("state") == "siege" || b.at("state") == "battle") {
                for r in b.at("regs").iter() {
                    if r.at("type") == "artillerie" {
                        guns += 1;
                    }
                }
            }
        }
        k += BAR_GUN * guns as f64;
    }
    let v = x.atf("bar") - k * dt;
    x.set("bar", if v > 0.0 { v } else { 0.0 });
    if x.atf("bar") < 0.05 {
        x.del("bar");
        if n.at("owner") == g.player {
            let texte = format!("Les {} {} ne sont plus que des débris.", works_name(n, &Val::None), R::de(&place(g, nid)));
            g.log("armee", &texte, &lieu((gx, gy), n.at("owner")));
        }
    }
}

// ================================================================== 2. quartiers

/// Python : `quarters(g, code, a, on)`.
// game/army_actions.py, lignes 302 à 317
pub fn quarters(g: &mut Game, code: &str, a: &Val, on: bool) -> (bool, String) {
    if !on {
        if !a.getb("qrt") {
            return (false, "L'armée n'a pas pris ses quartiers.".to_string());
        }
        a.set("qrt", false);
        g._dirty_income = true;
        return (true, "L'armée lève le camp.".to_string());
    }
    let (nid, why) = own_place(g, code, a, false);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    if a.getb("qrt") {
        return (false, "L'armée a déjà pris ses quartiers.".to_string());
    }
    a.set("qrt", true);
    g._dirty_income = true;
    (
        true,
        format!(
            "La {} prend ses quartiers à {} : renforts et moral plus rapides, ordre public en hausse, mais elle mange davantage.",
            a.at("name"),
            place(g, nid)
        ),
    )
}

/// Python : `quarters_tick(g, dt)`.
/// Piège : qn est un set d'entiers rangé dans g._aa_qn ; il ne sert qu'aux tests d'appartenance.
// game/army_actions.py, lignes 320 à 335
pub fn quarters_tick(g: &mut Game, dt: f64) {
    let qn = pyset![];
    for a in g.armies.values() {
        if !a.getb("qrt") {
            continue;
        }
        let nid = a.at("at_node");
        let code = a.ats("owner");
        if nid.is_none()
            || a.at("state") != "idle"
            || a.getb("boat")
            || g.nodes.at(&nid).at("owner") != code
            || g.nodes.at(&nid).at("siege").truthy()
        {
            a.set("qrt", false);
            g._dirty_income = true;
            continue;
        }
        qn.push(nid);
        let f = g.factions.at(&code);
        if !(f.getb("banqueroute") || f.getb("famine")) {
            g.replenish(&code, &a.at("regs"), dt, QRT_REPL);
        }
    }
    g._aa_qn = qn;
}

// ================================================================== 2 bis. compléter les rangs

/// Régiment monté ou attelé (cavalerie, artillerie, mitrailleuses) : ses pertes se comblent en chevaux dressés.
/// Python : `monte(r)`.
// game/army_actions.py, lignes 339 à 341
pub fn monte(r: &Val) -> bool {
    R::UNITS().at(r.at("type")).at("cls") != "inf"
}

/// (hommes à lever, armes, tours, tours de l'infanterie) pour remettre au complet les régiments présents ; les
/// régiments montés qui ont perdu plus de RNG_REMONTE attendent leurs remontes un tour de plus.
/// Python : `rangs_info(g, a)`.
/// Rend (hommes, armes, tours, tours de l'infanterie).
// game/army_actions.py, lignes 344 à 352
pub fn rangs_info(g: &Game, a: &Val) -> (f64, i64, i64, i64) {
    let regs = a.at("regs");
    let need = manque(&regs);
    let s = effectif(&regs);
    let mx = if s != 0.0 { s } else { 1.0 };
    let t = if need / mx <= RNG_LOURD { 1 } else { 2 };
    let m = Val::list(regs.iter().filter(monte).collect());
    let rm = manque(&m) > RNG_REMONTE * effectif(&m);
    (need, (need * R::REPL_ARMES).ceil() as i64, t + rm as i64, t)
}

/// (place, raison) : à l'arrêt dans une de nos villes, ou un village qui a un magasin ; trésor en état.
/// Python : `rangs_place(g, code, a)`.
/// Rend (place, '') ou (None, raison).
// game/army_actions.py, lignes 355 à 365
pub fn rangs_place(g: &Game, code: &str, a: &Val) -> (Option<i64>, String) {
    let (nid, why) = own_place(g, code, a, false);
    if let Some(why) = why {
        return (None, why);
    }
    let nid = nid.unwrap();
    if g.geo.nodes.at(nid).at("type") == "village" && !g.nodes.at(nid).getb("depot") {
        return (None, "Il faut une ville ou un magasin : les conscrits se rassemblent au dépôt.".to_string());
    }
    let f = g.factions.at(code);
    if f.getb("banqueroute") || f.getb("famine") {
        return (None, "Le trésor ne peut lever ni habiller de recrues.".to_string());
    }
    (Some(nid), String::new())
}

/// Python : `rangs_why(g, code, a)`.
/// Rend la raison du refus, '' si c'est possible.
// game/army_actions.py, lignes 368 à 380
pub fn rangs_why(g: &Game, code: &str, a: &Val) -> String {
    let (_, why) = rangs_place(g, code, a);
    if !why.is_empty() {
        return why;
    }
    if a.getb("rg") {
        return "Les renforts sont déjà en route.".to_string();
    }
    let (need, armes, _, _) = rangs_info(g, a);
    let s = effectif(&a.at("regs"));
    if need < RNG_MIN * if s != 0.0 { s } else { 1.0 } {
        return "Les rangs sont au complet.".to_string();
    }
    let res = g.factions.at(code).at("res");
    if res.at("recrues") < need || res.at("armes") < armes {
        return format!("Il faut {} recrues et {armes} armes.", py::int(need));
    }
    String::new()
}

/// (ok, raison) : les renforts peuvent-ils continuer d'arriver ?
/// Python : `rangs_ok(g, a)`.
// game/army_actions.py, lignes 383 à 392
pub fn rangs_ok(g: &Game, a: &Val) -> (bool, String) {
    if !g.armies.has(a.at("id")) {
        return (false, "l'armée n'est plus".to_string());
    }
    let (nid, why) = rangs_place(g, &a.ats("owner"), a);
    if !why.is_empty() {
        let mut c = why.chars();
        let premier: String = c.next().map(|p| p.to_lowercase().collect()).unwrap_or_default();
        return (false, format!("{premier}{}", c.as_str().trim_end_matches('.')));
    }
    if a.at("rg").at("node") != Val::from(nid) {
        return (false, "l'armée a changé de place".to_string());
    }
    (true, String::new())
}

/// Python : `rangs(g, code, a, on)`.
// game/army_actions.py, lignes 395 à 410
pub fn rangs(g: &mut Game, code: &str, a: &Val, on: bool) -> (bool, String) {
    if !on {
        if !a.getb("rg") {
            return (false, "Aucun renfort n'est en route.".to_string());
        }
        rangs_stop(g, a, "ordre de l'état-major");
        return (true, "Les renforts sont arrêtés.".to_string());
    }
    let why = rangs_why(g, code, a);
    if !why.is_empty() {
        return (false, why);
    }
    let nid = a.ati("at_node");
    let (need, armes, tours, ti) = rangs_info(g, a);
    a.set(
        "rg",
        dict! {"node" => nid, "until" => TT::deadline(g, tours, &[code]), "ui" => TT::deadline(g, ti, &[code]), "men" => need, "t0" => g.t},
    );
    let when = if tours == 1 { "au prochain tour".to_string() } else { format!("dans {tours} tours") };
    let rm = if tours > ti { " (les remontes de chevaux prennent un tour de plus)" } else { "" };
    (
        true,
        format!(
            "La {} complète ses rangs à {} : {} recrues et {armes} armes, au complet {when}{rm}. Elle doit rester sur place.",
            a.at("name"),
            place(g, nid),
            py::int(need)
        ),
    )
}

/// Python : `rangs_stop(g, a, why)`.
// game/army_actions.py, lignes 413 à 418
pub fn rangs_stop(g: &mut Game, a: &Val, why: &str) {
    let nid = a.at("rg").ati("node");
    a.set("rg", false);
    if a.at("owner") == g.player {
        let texte = format!(
            "Les renforts destinés à la {} s'arrêtent à {} : {why}. Les hommes déjà arrivés restent dans les rangs.",
            a.at("name"),
            place(g, nid)
        );
        g.log("armee", &texte, &lieu(g.node_xy(nid), a.at("owner")));
    }
}

/// Les détachements du dépôt arrivent au fil des jours ; le dernier pas, à l'échéance, comble tout.
/// Python : `rangs_tick(g, dt)`.
// game/army_actions.py, lignes 421 à 447
pub fn rangs_tick(g: &mut Game, dt: f64) {
    for a in g.armies.values() {
        let rg = a.get("rg");
        if !rg.truthy() {
            continue;
        }
        let (ok, why) = rangs_ok(g, &a);
        if !ok {
            rangs_stop(g, &a, &why);
            continue;
        }
        let code = a.ats("owner");
        let t = g.t;
        let kk = |until: f64| {
            if until <= t + 1e-6 {
                1.0
            } else {
                let d = until - t + dt;
                let v = dt / if d > dt { d } else { dt };
                if v < 1.0 { v } else { 1.0 }
            }
        };
        let (k, ki) = (kk(rg.atf("until")), kk(rg.get_or("ui", rg.at("until")).f())); // (l'infanterie n'attend pas les remontes)
        let mut full = true;
        for r in a.at("regs").iter() {
            if r.at("n") < r.at("max") {
                let add = (&r.at("max") - &r.at("n")).f() * if monte(&r) { k } else { ki };
                g.reinforce(&code, &r, add);
                full = full && r.atf("n") >= r.atf("max") - 1e-6;
            }
        }
        if k < 1.0 {
            continue;
        }
        a.set("rg", false);
        if code == g.player {
            let nm = place(g, rg.ati("node"));
            let got = py::round(rg.atf("men") - manque(&a.at("regs")));
            let texte = if full {
                format!("La {} a complété ses rangs à {nm} (+{} hommes, l'expérience des anciens diluée).", a.at("name"), if got > 0 { got } else { 0 })
            } else {
                format!("Rangs incomplets à {nm} : il manque des recrues ou des armes.")
            };
            g.log("armee", &texte, &lieu_imp(g.node_xy(rg.ati("node")), &code, true));
        }
    }
}

/// Régiments de l'armée anéantis depuis peu (engine.bury) : [[rang dans l'armée, type, id, date], ...].
/// Python : `morts(g, a)`.
/// Rend la liste triée des [rang, type, id, date] (tri des listes de Python : élément par élément).
// game/army_actions.py, lignes 450 à 452
pub fn morts(g: &Game, a: &Val) -> Val {
    let l = Val::list(a.get("morts").or(list![]).iter().filter(|m| m.at(3) > g.t - MORTS_JOURS as f64).collect());
    l.sort();
    l
}

/// (régiments à relever, prix de leur levée hors recrues et armes, que les renforts versent comme aux autres).
/// Python : `relever_info(g, code, a)`.
/// Rend (morts, prix : dict).
// game/army_actions.py, lignes 455 à 462
pub fn relever_info(g: &Game, code: &str, a: &Val) -> (Val, Val) {
    let (ms, cost) = (morts(g, a), dict! {});
    for m in ms.iter() {
        for (k, v) in g.unit_cost(code, m.at(1).s()).items() {
            if k != "recrues" && k != "armes" {
                cost.set(&k, &cost.get_or(&k, 0) + &v);
            }
        }
    }
    (ms, cost)
}

/// Python : `relever_why(g, code, a)`.
/// Rend la raison du refus, '' si c'est possible.
// game/army_actions.py, lignes 465 à 478
pub fn relever_why(g: &Game, code: &str, a: &Val) -> String {
    let (_, why) = rangs_place(g, code, a);
    if !why.is_empty() {
        return why;
    }
    if a.getb("rg") {
        return "Les renforts sont déjà en route.".to_string();
    }
    let (ms, cost) = relever_info(g, code, a);
    if !ms.truthy() {
        return "Aucun régiment anéanti à relever.".to_string();
    }
    let need = py::sum_v(a.at("regs").iter().map(|r| &r.at("max") - &r.at("n")))
        + py::sum_v(ms.iter().map(|m| R::UNITS().at(m.at(1)).at("men")));
    let cost = cost.copy();
    cost.set("recrues", &need);
    cost.set("armes", (need.f() * R::REPL_ARMES).ceil() as i64);
    if !g.can_pay(code, &cost) {
        let parts: Vec<String> = cost.items().iter().map(|(k, v)| format!("{} {k}", v.f().ceil() as i64)).collect();
        return format!("Il faut {}.", parts.join(", "));
    }
    String::new()
}

/// Relève les régiments anéantis depuis peu, sous leur nom et leur numéro (leur rang dans l'armée), autour d'un cadre
/// du dépôt : la levée se paie comme un régiment neuf, puis les recrues arrivent comme pour « Compléter les rangs ».
/// Python : `relever(g, code, a)`.
/// Piège : `ids` est un set de textes (identifiants) : seulement des tests d'appartenance.
// game/army_actions.py, lignes 481 à 500
pub fn relever(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let why = relever_why(g, code, a);
    if !why.is_empty() {
        return (false, why);
    }
    let (ms, cost) = relever_info(g, code, a);
    g.pay(code, &cost);
    for m in ms.iter() {
        // dans l'ordre des rangs : chacun reprend sa place, donc son numéro de bataille
        let (i, typ, rid, _) = m.quad();
        let reg = g.new_reg(typ.s(), &Val::from(0), &Val::from(code));
        reg.set("id", rid);
        let add = RNG_CADRE * reg.atf("max");
        g.reinforce(code, &reg, add);
        let regs = a.at("regs");
        let len = regs.len() as i64;
        regs.insert(if len < i.i() { len } else { i.i() }, reg);
    }
    a.pop("morts");
    let ids = Val::set_from(ms.iter().map(|m| m.at(2)).collect());
    let regs = a.at("regs").vec();
    let mut nms = vec![];
    for (i, r) in regs.iter().enumerate() {
        if ids.has(r.at("id")) {
            // le nom que lui donnera la bataille
            let rang = 1 + regs[..i].iter().filter(|q| q.at("type") == r.at("type")).count() as i64;
            nms.push(U::unit_name(Some(&*g), &Val::from(code), r.at("type").s(), rang));
        }
    }
    let (_ok, msg) = rangs(g, code, a, true);
    (true, format!("{} : relevé{} autour du cadre du dépôt. {msg}", nms.join(", "), if ms.len() > 1 { "s" } else { "" }))
}

// ================================================================== 3. garde bourgeoise

/// Python : `garde_info(n)`.
/// Rend (hommes, armes).
// game/army_actions.py, lignes 504 à 506
pub fn garde_info(n: &Val) -> (i64, i64) {
    let v = GARDE_MM * n.atf("milice_max") + GARDE_POP * n.get_or("pop", 0).f();
    let add = py::round(if v < GARDE_MAX as f64 { v } else { GARDE_MAX as f64 });
    (add, py::round(add as f64 * GARDE_ARMES))
}

/// Python : `garde(g, code, a)`.
// game/army_actions.py, lignes 509 à 531
pub fn garde(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = own_place(g, code, a, true);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    if node_aa(&n).has("gd") {
        return (false, "Les bourgeois sont déjà sous les armes.".to_string());
    }
    let left = cd_left(g, &n, "garde");
    if left > 0 {
        return (false, format!("Les habitants ont rendu leurs armes il y a peu : encore {}.", R::pl(left, "tour", None)));
    }
    let (add, armes) = garde_info(&n);
    let f = g.factions.at(code);
    if f.at("res").at("armes") < armes {
        return (false, format!("Il faut {armes} armes."));
    }
    f.at("res").dec("armes", armes);
    aa(&n).set("gd", dict! {"until" => TT::deadline(g, GARDE_TOURS, &[code]), "add" => add});
    n.inc("milice_max", add);
    n.inc("milice", add);
    set_cd(g, &n, "garde", GARDE_CD, code);
    g._dirty_income = true;
    let gname = g.unit_name(code, "garde").0.to_lowercase();
    (
        true,
        format!(
            "{} habitants de {} prennent les armes ({gname}) pour {GARDE_TOURS} tours ({armes} armes). La production de la place baisse un peu.",
            R::nb(add as f64),
            place(g, nid)
        ),
    )
}

/// Python : `end_garde(g, n, quiet=False)`.
/// quiet : False par défaut.
// game/army_actions.py, lignes 534 à 543
pub fn end_garde(g: &mut Game, n: &Val, quiet: bool) {
    let gd = node_aa(n).get("gd");
    if !gd.truthy() {
        return;
    }
    n.at("aa").del("gd");
    n.set("milice_max", vmax(20.0, &n.at("milice_max") - &gd.at("add")));
    n.set("milice", vmin(n.at("milice"), n.at("milice_max")));
    g._dirty_income = true;
    if !quiet && n.at("owner") == g.player {
        let nid = n.ati("id");
        g.log("armee", &format!("Les bourgeois {} rendent leurs armes.", R::de(&place(g, nid))), &lieu(g.node_xy(nid), n.at("owner")));
    }
}

// ================================================================== 4. réquisition

/// Python : `req_info(n)`.
/// Rend {ressource: quantité (int)}, dans l'ordre de REQ.
// game/army_actions.py, lignes 547 à 549
pub fn req_info(n: &Val) -> Val {
    let pop = n.get_or("pop", 0).f();
    let out = dict! {};
    for (k, t) in REQ().items() {
        let (c, per, top) = t.triple();
        let v = c.f() + pop * per.f();
        out.set(&k, py::round(if v < top.f() { v } else { top.f() }));
    }
    out
}

/// Python : `requisition(g, code, a)`.
// game/army_actions.py, lignes 552 à 569
pub fn requisition(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = own_place(g, code, a, false);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    let left = cd_left(g, &n, "req");
    if left > 0 {
        return (false, format!("La place a déjà été réquisitionnée : encore {}.", R::pl(left, "tour", None)));
    }
    let gain = req_info(&n);
    let f = g.factions.at(code);
    f.at("res").inc("vivres", gain.at("vivres"));
    f.at("res").inc("livres", gain.at("livres"));
    let rec = py::int(g.add_recrues(code, gain.atf("recrues")));
    n.set("stab", vmax(0.05, &n.at("stab") - REQ_STAB));
    set_cd(g, &n, "req", REQ_CD, code);
    let mut got = vec![format!("{} vivres", gain.at("vivres"))];
    if rec != 0 {
        got.push(format!("{rec} recrues"));
    }
    if gain.at("livres").truthy() {
        got.push(format!("{} livres", gain.at("livres")));
    }
    (
        true,
        format!(
            "Réquisition à {} : {}. La population gronde (ordre public −{} %).",
            place(g, nid),
            got.join(", "),
            py::int(REQ_STAB * 100.0)
        ),
    )
}

// ================================================================== 5. traverser, droit de passage
// Terres fermées : celles d'un département qui n'est ni nous, ni un allié (suzerain, vassal, vassal du même suzerain),
// ni en guerre avec nous, et qui ne nous accorde pas le droit de passage. On ne les traverse pas : ni ses places par
// la route, ni ses campagnes (cellules rattachées à ses places, voir geo.node_of_cell). Les places indépendantes et
// les terres d'un ennemi se traversent. Sur les fleuves, les gabares passent librement devant ses quais, sans y
// débarquer. Une armée qui s'y trouve sans l'avoir voulu a quelques jours de grâce pour en sortir.

/// o laisse-t-il passer les armées de code ?
/// Python : `has_passage(g, code, o)`.
// game/army_actions.py, lignes 578 à 581
pub fn has_passage(g: &Game, code: &str, o: &str) -> bool {
    let f = g.factions.get(o);
    f.truthy() && f.get_or("passage", dict! {}).get_or(code, -1) > g.t
}

/// Les terres de o sont-elles fermées aux armées de code ?
/// Python : `closed_to(g, code, o)`.
// game/army_actions.py, lignes 584 à 593
pub fn closed_to(g: &Game, code: &str, o: &str) -> bool {
    if o == code || o == R::NEUTRAL || !g.factions.has(o) || !g.factions.has(code) {
        return false;
    }
    let st = g.status(code, o);
    if st == "guerre" || st == "alliance" {
        return false;
    }
    let ov = g.factions.at(code).at("overlord");
    if ov.truthy() && ov == g.factions.at(o).at("overlord") {
        return false; // vassaux du même suzerain
    }
    !has_passage(g, code, o)
}

/// Départements dont les terres sont fermées à code (à passer à la recherche de chemin).
/// Python : `closed_owners(g, code)`.
/// Rend un set (frozenset) de codes, dans l'ordre de g.factions.
// game/army_actions.py, lignes 596 à 598
pub fn closed_owners(g: &Game, code: &str) -> Val {
    Val::set_from(g.factions.keys().into_iter().filter(|o| closed_to(g, code, o.s())).collect())
}

/// Pour geo.astar : une marque par propriétaire interdit, indexée par lieu (valeurs de geo.cellnode) ; None si aucun.
/// Python : `cell_mask(g, owners)`.
/// owners : un set de codes (ou vide). Rend None si aucun.
// game/army_actions.py, lignes 601 à 611
pub fn cell_mask(g: &Game, owners: &Val) -> Option<Vec<u8>> {
    if !owners.truthy() {
        return None;
    }
    let tag = dict! {};
    for (i, o) in py::sorted_by_key(owners.vec(), |o| o.clone()).into_iter().enumerate() {
        tag.set(o, i + 1);
    }
    let mut m = vec![0u8; 65536]; // (indexé par les valeurs de geo.cellnode, sur deux octets ; geo.NONE compris)
    for (i, o) in g.maitres().iter().enumerate() {
        let t = tag.get(o);
        if t.truthy() {
            m[g.nodes.at(i).ati("id") as usize] = t.i() as u8;
        }
    }
    Some(m)
}

/// Maître des terres en (x, y) : celui de la place dont relève la cellule (None : eau, hors région).
/// Python : `land_owner(g, x, y)`.
/// Rend le code du maître, ou None.
// game/army_actions.py, lignes 614 à 617
pub fn land_owner(g: &Game, x: f64, y: f64) -> Val {
    match g.geo.node_of_cell(x, y) {
        None => Val::None,
        Some(nd) => g.nodes.at(nd).at("owner"),
    }
}

/// Places traversables par la route : 0 en conquérant, 1 en traversant (une retraite garde ses chemins d'avant).
/// Python : `route_level(g, a)`.
// game/army_actions.py, lignes 620 à 622
pub fn route_level(g: &Game, a: &Val) -> i64 {
    if a.getb("tr") && a.at("state") != "retreat" { 1 } else { 0 }
}

/// Arrivée d'une armée sur une place ni à elle ni alliée. None : comme avant (rallier, assiéger, combattre) ;
/// False : elle passe son chemin ; True : elle s'arrête devant la place, sans l'attaquer (le joueur choisit, si ask).
/// Python : `arrive(g, a, nid, ask=True)`.
/// ask : True par défaut.
// game/army_actions.py, lignes 625 à 658
pub fn arrive(g: &mut Game, a: &Val, nid: i64, ask: bool) -> Option<bool> {
    let n = g.nodes.at(nid);
    let (o, code) = (n.ats("owner"), a.ats("owner"));
    let war = o != R::NEUTRAL && g.at_war(&code, &o);
    if o != R::NEUTRAL && !war {
        // voisin en paix (droit de passage, gabare devant ses quais, sortie de ses terres) : on ne fait que passer
        if a.at("path").truthy() {
            return Some(false);
        }
        a.set("state", "idle");
        if a.getb("tr") && !a.getb("hold") {
            a.set("hold", true);
            if code == g.player {
                let texte = format!("La {} fait halte devant {} (en paix, elle n'y entre pas).", a.at("name"), place(g, nid));
                g.log("armee", &texte, &lieu(g.node_xy(nid), &code));
            }
        }
        return Some(true);
    }
    if a.at("state") == "retreat" || !(a.getb("tr") || a.getb("hold")) {
        return None;
    }
    if a.at("path").truthy() && a.getb("tr") {
        return if war { None } else { Some(false) }; // une place ennemie tenue barre la route ; les neutres se traversent
    }
    let s = n.at("siege");
    if s.truthy() && s.at("by") == code {
        return None; // nos troupes l'investissent déjà : on se joint à elles
    }
    if ask && asks(g, a) {
        pose(g, a, nid); // sa cible, en conduite « Traverser » : le joueur choisit
        return Some(true);
    }
    a.set("path", list![]);
    a.set("state", "idle");
    if !a.getb("hold") {
        a.set("hold", true);
        if code == g.player {
            let texte = format!("La {} fait halte devant {} (négociez, rançonnez, bloquez ou attaquez).", a.at("name"), place(g, nid));
            g.log("armee", &texte, &lieu(g.node_xy(nid), &code));
        }
    }
    Some(true)
}

// ================================================================== arrivée devant une place : le joueur choisit
// (SPEC-TOURS.md, évolution du 18/10/2026) : l'armée s'arrête, son chemin mis de côté (a['ask']), et une fenêtre
// propose l'assaut (à la main ou automatique), rallier, négocier, assiéger ou bloquer, la contribution, ou d'attendre

/// Cette armée demande-t-elle au joueur ce qu'elle doit faire devant une place ? Les siennes, pas les IA ; et pas
/// pendant le tour des IA (le mois ne s'arrête pas pour ça : une fenêtre y bloquerait la partie).
/// Python : `asks(g, a)`.
/// `g.player not in getattr(g, 'ais', {})` : `!g.ais.contains_key(&g.player)`.
// game/army_actions.py, lignes 664 à 668
pub fn asks(g: &Game, a: &Val) -> bool {
    a.at("owner") == g.player
        && !g.ais.contains_key(&g.player)
        && !g.over.truthy()
        && !(g.tour.atb("on") && g.tour.at("end").is_some())
}

/// Python : `pose(g, a, nid)`.
// game/army_actions.py, lignes 671 à 677
pub fn pose(g: &mut Game, a: &Val, nid: i64) {
    a.set("ask", dict! {"node" => nid, "path" => a.at("path"), "target" => a.get("target")});
    a.set("path", list![]);
    a.set("state", "idle");
    a.set("hold", true);
    if !TT::planning(g) {
        g.speed_idx = 0; // temps réel : la campagne attend le choix
    }
}

/// Le choix en attente de cette armée, s'il vaut encore ; sinon il est levé (elle est repartie, en retraite ou au
/// combat, la place a changé de mains, la paix est signée). La place passée au joueur : elle reprend sa route.
/// Python : `ask_alive(g, a)`.
/// Rend a['ask'] (le même dict), ou None.
// game/army_actions.py, lignes 680 à 693
pub fn ask_alive(g: &mut Game, a: &Val) -> Val {
    let k = a.get("ask");
    if !k.truthy() {
        return Val::None;
    }
    let (code, o) = (a.ats("owner"), g.nodes.at(k.at("node")).ats("owner"));
    let here = a.at("at_node") == k.at("node") && a.at("state") == "idle" && !a.at("battle").truthy();
    if here && !g.friendly(&code, &o) && (o == R::NEUTRAL || g.at_war(&code, &o)) {
        return k;
    }
    a.pop("ask");
    if here && g.friendly(&code, &o) {
        resume(g, a, &k);
    }
    Val::None
}

/// La première armée du joueur qui attend son choix devant une place, ou None (les choix périmés sont levés).
/// Python : `asking(g)`.
/// Rend une armée, ou None. (La liste entière est faite avant de prendre la première : ask_alive lève tous les choix périmés.)
// game/army_actions.py, lignes 696 à 698
pub fn asking(g: &mut Game) -> Val {
    let mut l = vec![];
    for a in g.armies.values() {
        if a.at("owner") == g.player && ask_alive(g, &a).truthy() {
            l.push(a);
        }
    }
    l.into_iter().next().unwrap_or(Val::None)
}

/// Assez forte pour qu'une place neutre se rallie sans combat (trois fois sa défense, comme engine.arrive_node).
/// Python : `strong(g, a, nid)`.
// game/army_actions.py, lignes 701 à 704
pub fn strong(g: &mut Game, a: &Val, nid: i64) -> bool {
    let gn = g.geo.nodes.at(nid);
    let p = g.army_power(a, &terrain_name(g, &gn));
    p > 3.0 * g.node_defense_power(nid, true)
}

/// Les choix de la fenêtre d'arrivée : {choix: '' s'il est permis, sinon la raison}. L'assaut (à la main, sur
/// ordres ou automatique) et l'attente le sont toujours ; les autres selon la place, comme dans le panneau de l'armée.
/// Python : `ask_choices(g, a)`.
/// Rend {choix: '' ou raison}, dans l'ordre du Python.
// game/army_actions.py, lignes 707 à 726
pub fn ask_choices(g: &mut Game, a: &Val) -> Val {
    let nid = a.at("ask").ati("node");
    let n = g.nodes.at(nid);
    let neutral = n.at("owner") == R::NEUTRAL;
    let x = options(g, a, nid).or(dict! {});
    let out = dict! {"assaut" => ""}; // (l'escalade d'une place à remparts ; la stratégie se choisit quand la bataille s'engage)
    if neutral {
        let fort = strong(g, a, nid);
        out.set("rallier", if fort { "" } else { "Armée trop faible : il faut trois fois la défense de la place" });
    }
    if x.has("neg") {
        out.set("negocier", x.at("neg").at("why"));
    }
    if walled(&n) && (!neutral || n.at("fort") >= 2i64) {
        out.set("assieger", "");
    }
    if x.has("blq") {
        out.set("bloquer", x.at("blq").at("why"));
    }
    if x.has("ctb") {
        out.set("contribution", x.at("ctb").at("why"));
    }
    out.set("attendre", "");
    out
}

/// Après un choix sans combat : l'armée reprend sa route avec la marche qui lui reste (turns.settle la fait partir).
/// Python : `resume(g, a, k)`.
/// k : le choix en attente (a['ask']).
// game/army_actions.py, lignes 729 à 732
pub fn resume(g: &mut Game, a: &Val, k: &Val) {
    if k.at("path").truthy() && g.armies.has(a.at("id")) && a.at("state") == "idle" {
        a.set("path", k.at("path"));
        a.set("target", k.at("target"));
        a.set("state", "move");
        a.set("hold", false);
    }
}

/// Le choix du joueur devant la place (fenêtre d'arrivée).
/// Python : `choose(g, code, a, what)`.
/// a : l'armée, ou None (identifiant inconnu) ; what : `str(body.get('value'))`.
/// TB.command rend un dict(ok, msg).
// game/army_actions.py, lignes 735 à 790
pub fn choose(g: &mut Game, code: &str, a: &Val, what: &str) -> (bool, String) {
    let k = if a.truthy() && a.at("owner") == code { ask_alive(g, a) } else { Val::None };
    if !k.truthy() {
        return (false, "Cette armée n'attend pas d'ordre devant une place.".to_string());
    }
    let why = ask_choices(g, a).get(what);
    if why.is_none() {
        return (false, "Choix inconnu.".to_string());
    }
    if why.truthy() {
        return (false, format!("{why}"));
    }
    let nid = k.ati("node");
    let gn = g.geo.nodes.at(nid);
    if what == "attendre" {
        a.pop("ask");
        return (true, format!("La {} attend devant {}.", a.at("name"), place(g, nid)));
    }
    if what == "assaut" {
        // l'assaut tout de suite, même sur une place à remparts (l'escalade) : la bataille s'engage et attend la
        // stratégie du joueur, comme toute bataille (SPEC-BATAILLE.md). Une bataille finit la marche du tour
        let bt = g.battles.values().into_iter().find(|b| b.at("node") == nid).unwrap_or(Val::None);
        if bt.truthy()
            && !(g.friendly(code, &bt.at("sides").at(0).ats("owner")) && g.hostile(code, &bt.at("sides").at(1).ats("owner")))
        {
            return (false, format!("Une bataille se livre déjà devant {}.", place(g, nid)));
        }
        a.pop("ask");
        a.set("hold", false);
        a.set("assault", true);
        a.set("path", k.at("path")); // (vainqueur, elle repart vers sa cible au tour suivant)
        a.set("target", k.at("target"));
        if TT::planning(g) {
            a.set("mp", 0.0);
        }
        if bt.truthy() {
            // un assaut se livre déjà devant la place : on le rejoint, comme en marche (engine.arrive_node)
            g.join_battle(a, &bt, 0);
            return (true, format!("La {} rejoint l'assaut {}.", a.at("name"), R::de(&gn.ats("name"))));
        }
        g.start_battle(&list![a], &list![], gn.atf("x"), gn.atf("y"), &Val::from(nid), false, false);
        let attend = g.battles.get(a.at("battle")).get("mode") == "attente";
        return (true, if attend { format!("Assaut {} : choisissez votre stratégie.", R::de(&gn.ats("name"))) } else { "À l'assaut !".to_string() });
    }
    if what == "rallier" {
        a.pop("ask");
        let texte = format!("{} se rallie à {}.", gn.at("name"), g.fname(code));
        g.log("capture", &texte, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => code, "important" => true});
        g.capture(nid, code, true);
        resume(g, a, &k);
        asking(g); // (les autres armées devant la place : leur choix tombe, elles reprennent leur route)
        return (true, format!("{} se rallie à vous.", gn.at("name")));
    }
    if what == "assieger" {
        a.pop("ask");
        a.set("hold", false);
        g.begin_siege(a, nid);
        return (true, format!("Le siège {} commence.", R::de(&gn.ats("name"))));
    }
    let f: fn(&mut Game, &str, &Val) -> (bool, String) = match what {
        "negocier" => negotiate,
        "contribution" => contribution,
        "bloquer" => blockade,
        _ => panic!("KeyError: {what:?}"),
    };
    let (ok, msg) = f(g, code, a);
    if ok {
        a.pop("ask");
        if what == "contribution" {
            // (pourparlers et blocus exigent l'armée devant la place)
            resume(g, a, &k);
        }
    }
    (ok, msg)
}

/// Départements de `owners` dont l'itinéraire traverse les terres : places par la route (une gabare passe devant
/// les quais sans y débarquer), campagnes à travers champs, destination. skip : celui dont on sort.
/// Python : `crossed(g, path, target, owners, skip=None)`.
/// path : une liste d'étapes ; target : None ou dict(node | x, y) ; owners : un set de codes ; skip : None par défaut,
/// ou un code. Rend la liste triée des codes traversés.
// game/army_actions.py, lignes 793 à 824
pub fn crossed(g: &Game, path: &Val, target: &Val, owners: &Val, skip: &Val) -> Val {
    if !owners.truthy() {
        return list![];
    }
    let seen = pyset![];
    let chk = |o: &Val| {
        if owners.has(o) && o != skip {
            seen.push(o);
        }
    };
    let legs = path.vec();
    for (i, leg) in legs.iter().enumerate() {
        if leg.at("kind") == "road" {
            if g.geo.edges.at(leg.at("e")).get("kind") == "water" {
                let nxt = if i + 1 < legs.len() { legs[i + 1].clone() } else { Val::None };
                if nxt.truthy() && nxt.at("kind") == "road" && g.geo.edges.at(nxt.at("e")).get("kind") == "water" {
                    continue; // toujours à bord
                }
            }
            chk(&g.nodes.at(leg.at("to")).at("owner"));
        } else {
            let pts = leg.at("pts").vec();
            for w in pts.windows(2) {
                let ((px, py_), (qx, qy)) = (w[0].xy(), w[1].xy());
                let d = py::int(py::dist(px, py_, qx, qy));
                let k = if d > 1 { d } else { 1 };
                for s in 0..k {
                    chk(&land_owner(g, px + (qx - px) * s as f64 / k as f64, py_ + (qy - py_) * s as f64 / k as f64));
                }
            }
            if let Some(p) = pts.last() {
                let (x, y) = p.xy();
                chk(&land_owner(g, x, y));
            }
        }
    }
    if target.truthy() {
        // la destination elle-même, même chez celui dont on sort
        let o = if target.get("node").is_some() {
            g.nodes.at(target.at("node")).at("owner")
        } else if target.get("x").is_some() {
            land_owner(g, target.atf("x"), target.atf("y"))
        } else {
            Val::None
        };
        if owners.has(&o) {
            seen.push(o);
        }
    }
    Val::list(py::sorted_by_key(seen.vec(), |o| o.clone()))
}

/// Python : `names_of(g, who)`.
/// who : une liste de codes.
// game/army_actions.py, lignes 827 à 828
pub fn names_of(g: &Game, who: &Val) -> String {
    who.iter().map(|o| g.fname(o.s())).collect::<Vec<_>>().join(" et ")
}

/// Python : `closed_msg(g, who)`.
// game/army_actions.py, lignes 831 à 833
pub fn closed_msg(g: &Game, who: &Val) -> String {
    format!(
        "Aucun chemin sans traverser les terres {} : demandez un droit de passage (Diplomatie), ou passez en force (déclaration de guerre).",
        R::de(&names_of(g, who))
    )
}

/// Python : `force_question(g, who)`.
// game/army_actions.py, lignes 836 à 841
pub fn force_question(g: &Game, who: &Val) -> String {
    let n = names_of(g, who);
    format!(
        "Aucun chemin sans traverser les terres {}, qui ne vous {} pas accordé le droit de passage.\n\nPasser en force, c'est \
         DÉCLARER LA GUERRE à {n} (ses alliés peuvent s'en mêler). Sinon, annulez et demandez un droit de passage dans la \
         fenêtre Diplomatie.\n\nDéclarer la guerre à {n} et passer en force ?",
        R::de(&n),
        if who.len() > 1 { "ont" } else { "a" }
    )
}

/// Passage en force : la guerre à chacun, selon les règles ordinaires (trêve, suzerain…). (ok, message).
/// Python : `force_passage(g, code, who)`.
// game/army_actions.py, lignes 844 à 856
pub fn force_passage(g: &mut Game, code: &str, who: &Val) -> (bool, String) {
    for o in who.iter() {
        if let Some(why) = D::war_refusal(g, code, o.s()) {
            return (false, format!("Passage en force impossible : {why}"));
        }
    }
    for o in who.iter() {
        let o = o.string();
        if !g.at_war(code, &o) {
            D::declare_war(g, code, &o, false);
            let texte = format!("{} force le passage sur les terres {}.", g.fname(code), R::de(&g.fname(&o)));
            let important = g.player == code || g.player == o;
            g.log("diplo", &texte, &dict! {"who" => code, "important" => important});
        }
    }
    (true, format!("Guerre déclarée à {} : l'armée passe en force.", names_of(g, who)))
}
