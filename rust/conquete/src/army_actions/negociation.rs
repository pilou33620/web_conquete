//! Porte game/army_actions.py, lignes 859 à 1582 : délai de grâce et droits de passage, ralliement négocié,
//! contribution, blocus, commandes, vues, IA.
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

/// Les arguments `x, y, who` de `g.log` pris à l'armée a (`a['x'], a['y']`).
fn chez(a: &Val, who: impl Into<Val>, important: bool) -> Val {
    dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => who.into(), "important" => important}
}

/// Les arguments `gn['x'], gn['y'], who=…` de `g.log` pris au lieu gn.
fn au_lieu(gn: &Val, who: impl Into<Val>, important: bool) -> Val {
    dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => who.into(), "important" => important}
}

/// Réserves d'une place bloquée (jours) : `BLOC_FOOD[gn['type']] + (BLOC_DEPOT if n.get('depot') else 0) + 4 * n['fort']`.
fn bloc_food(gn: &Val, n: &Val) -> Val {
    &(&BLOC_FOOD().at(gn.at("type")) + if n.getb("depot") { BLOC_DEPOT } else { 0 }) + &(4i64 * &n.at("fort"))
}

// ------------------------------------------------------------------ délai de grâce
pub const GRACE_TOURS: i64 = 1;  // pour sortir de terres fermées où l'on se retrouve sans l'avoir voulu

/// Armée sur des terres qui lui sont fermées (droit échu ou retiré en chemin, place passée en d'autres mains,
/// paix signée en territoire ennemi, retraite) : chemin de sortie et délai de grâce, puis incidents.
/// Python : `land_tick(g, a, dt)`.
// game/army_actions.py, lignes 863 à 900
pub fn land_tick(g: &mut Game, a: &Val, dt: f64) {
    let st = a.ats("state");
    if a.getb("boat") || !(st == "move" || st == "idle" || st == "retreat") {
        return; // à bord, le fleuve est libre ; en bataille ou en siège, on ne compte pas
    }
    let code = a.ats("owner");
    let o = if a.at("at_node").is_some() { g.nodes.at(a.at("at_node")).at("owner") } else { land_owner(g, a.atf("x"), a.atf("y")) };
    if o.is_none() || o == code || o == R::NEUTRAL || !g.factions.has(&o) {
        a.pop("cl");
        return;
    }
    let o = o.string();
    if !closed_to(g, &code, &o) {
        a.pop("cl");
        if o == g.player && g.status(&code, &o) == "paix" && a.setdefault("_ntc", dict! {}).get_or(&o, -1) <= g.t {
            a.at("_ntc").set(&o, g.t + NOTICE_CD as f64);
            let texte = format!("Des troupes {} traversent vos terres (droit de passage).", R::de(&g.fname(&code)));
            g.log("diplo", &texte, &dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &code});
        }
        return;
    }
    if a.at("state") == "move" && a.at("edge").truthy() && a.get("ex") != o {
        // une route entre deux places ouvertes peut frôler ses campagnes : ce n'est pas y entrer
        let e = g.geo.edges.at(a.at("edge").at("e"));
        if !closed_to(g, &code, &g.nodes.at(e.at("a")).ats("owner")) && !closed_to(g, &code, &g.nodes.at(e.at("b")).ats("owner")) {
            return;
        }
    }
    let mut cl = a.get("cl");
    if !cl.truthy() || cl.at("o") != o {
        // (une IA garde ses cinq jours d'avant)
        let until = if code == g.player { TT::deadline(g, GRACE_TOURS, &[]) } else { g.t + 5.0 };
        cl = dict! {"o" => &o, "until" => until, "rt" => 0.0};
        a.set("cl", &cl);
        if code == g.player {
            let texte = format!(
                "La {} se trouve sur les terres {} sans droit de passage : elle a jusqu'au {} pour en sortir.",
                a.at("name"),
                R::de(&g.fname(&o)),
                g.date_str(&cl.at("until"))
            );
            g.log("armee", &texte, &chez(a, &o, true));
        }
    }
    if cl.at("rt") <= g.t && !(a.at("state") == "move" && a.get("ex") == o) {
        cl.set("rt", py::round_n(g.t + 1.0, 2)); // au plus une tentative par jour
        way_out(g, a, &o);
    }
    if cl.at("until") < g.t {
        // au-delà du délai de grâce : les relations se dégradent, et l'on peut lui déclarer la guerre
        let rel = g.factions.at(&o).at("rel");
        rel.set(&code, vmax(-100, &rel.at(&code) - 1.2 * dt));
        a.set("viol", &a.get_or("viol", 0.0) + dt);
        trespassed(g, a, &o);
    }
}

/// Itinéraire de sortie : vers la même destination par un détour si l'on marchait, sinon vers les terres
/// les plus proches où l'armée a le droit d'être. Une retraite garde son chemin.
/// Python : `way_out(g, a, o)`.
// game/army_actions.py, lignes 903 à 920
pub fn way_out(g: &mut Game, a: &Val, o: &str) -> bool {
    if a.at("state") == "retreat" {
        return true;
    }
    let code = a.ats("owner");
    let mine = code == g.player;
    if a.at("state") == "move" && g.reroute(a) {
        if mine {
            let texte = format!("La {} change d'itinéraire pour quitter les terres {}.", a.at("name"), R::de(&g.fname(o)));
            g.log("armee", &texte, &dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &code});
        }
        return true;
    }
    if !g.exit_path(a, o) {
        return false;
    }
    if mine {
        let texte = format!("La {} quitte les terres {} par le plus court.", a.at("name"), R::de(&g.fname(o)));
        g.log("armee", &texte, &dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &code});
    }
    true
}

/// Incident, au plus un par armée et par voisin tous les deux mois.
/// Python : `trespassed(g, a, o)`.
// game/army_actions.py, lignes 923 à 928
pub fn trespassed(g: &mut Game, a: &Val, o: &str) {
    let inc = a.setdefault("_inc", dict! {});
    if inc.get_or(o, -1) <= g.t {
        inc.set(o, py::round_n(g.t + INCIDENT_CD as f64, 2));
        incident(g, a, o);
    }
}

/// Python : `incident(g, a, o)`.
// game/army_actions.py, lignes 931 à 952
pub fn incident(g: &mut Game, a: &Val, o: &str) {
    let code = a.ats("owner");
    let fo = g.factions.at(o);
    let pen = Val::from(INCIDENT_REL) + vmin(15, g.army_men(a) / 400.0);
    fo.at("rel").set(&code, vmax(-100, &fo.at("rel").at(&code) - &pen));
    if code == g.player {
        let texte = format!(
            "Incident diplomatique : la {} s'attarde sans droit de passage sur les terres {} (relation −{}).",
            a.at("name"),
            R::de(&g.fname(o)),
            py::int_v(&pen)
        );
        g.log("diplo", &texte, &chez(a, o, true));
    } else if o == g.player {
        let texte = format!("Incident : des troupes {} s'attardent sur vos terres sans droit de passage.", R::de(&g.fname(&code)));
        g.log("diplo", &texte, &chez(a, &code, true));
    }
    if o == g.player || fo.at("overlord").truthy() || fo.at("truce").has(&code) {
        return;
    }
    // l'IA peut très mal le prendre
    let aggr = R::FACTIONS().at(o).at("personality").atf("aggr");
    if fo.at("rel").at(&code) < -40i64 && g.faction_power(o) > 0.7 * g.faction_power(&code) && g.rng.random() < 0.15 + 0.4 * aggr {
        let (ok, _) = D::declare_war(g, o, &code, false);
        if ok {
            let texte = format!("{} ne tolère pas cette violation de ses frontières.", g.fname(o));
            g.log("diplo", &texte, &chez(a, o, true));
        }
    }
}

/// Une armée à l'arrêt chez un voisin en paix peut y rester si ses terres lui sont ouvertes (droit de passage).
/// Python : `may_stay(g, a, o)`.
// game/army_actions.py, lignes 955 à 957
pub fn may_stay(g: &Game, a: &Val, o: &str) -> bool {
    g.factions.has(o) && !closed_to(g, &a.ats("owner"), o)
}

/// Python : `grant_passage(g, grantor, grantee, tours=PASSAGE_TOURS)`.
/// tours : PASSAGE_TOURS par défaut.
// game/army_actions.py, lignes 960 à 964
pub fn grant_passage(g: &mut Game, grantor: &str, grantee: &str, tours: i64) {
    let until = TT::deadline(g, tours, &[grantor, grantee]);
    g.factions.at(grantor).setdefault("passage", dict! {}).set(grantee, until);
    let texte = format!(
        "{} accorde le droit de passage à {} jusqu'au {}.",
        g.fname(grantor),
        g.fname(grantee),
        g.date_str(&Val::from(until))
    );
    let important = g.player == grantor || g.player == grantee;
    g.log("diplo", &texte, &dict! {"who" => grantor, "important" => important});
}

/// Python : `revoke_passage(g, grantor, grantee)`.
// game/army_actions.py, lignes 967 à 975
pub fn revoke_passage(g: &mut Game, grantor: &str, grantee: &str) -> (bool, String) {
    let f = g.factions.at(grantor).setdefault("passage", dict! {});
    if f.get_or(grantee, -1) <= g.t {
        return (false, "Aucun droit de passage à retirer.".to_string());
    }
    f.del(grantee);
    let rel = g.factions.at(grantee).at("rel");
    rel.set(grantor, vmax(-100, &rel.at(grantor) - 5i64));
    let texte = format!("{} retire le droit de passage à {}.", g.fname(grantor), g.fname(grantee));
    let important = g.player == grantor || g.player == grantee;
    g.log("diplo", &texte, &dict! {"who" => grantor, "important" => important});
    (true, "Droit de passage retiré.".to_string())
}

/// Une IA accorde-t-elle le passage ? Selon la relation, sa personnalité, la peur d'être envahie
/// et contre qui l'armée va marcher.
/// Python : `eval_passage(g, ai, frm, amount=0)`.
/// ai : le camp qui répond (un code) ; amount : 0 par défaut. Piège : `amount / 8` est une division de flottants.
// game/army_actions.py, lignes 978 à 1006
pub fn eval_passage(g: &Game, ai: &str, frm: &str, amount: i64) -> (bool, String) {
    let st = g.status(ai, frm);
    if st == "guerre" {
        return (false, "Nous sommes en guerre.".to_string());
    }
    if st == "alliance" {
        return (false, "Nos alliés passent déjà librement.".to_string());
    }
    if has_passage(g, frm, ai) {
        return (false, "Droit de passage déjà accordé.".to_string());
    }
    let f = g.factions.at(ai);
    let pers = R::FACTIONS().at(ai).at("personality");
    let (fa, fb) = (g.faction_power(ai), g.faction_power(frm));
    let (pa, pb) = (if fa > 1.0 { fa } else { 1.0 }, if fb > 1.0 { fb } else { 1.0 });
    let rel = f.at("rel");
    let mut score = rel.atf(frm) + amount as f64 / 8.0 + g.mod_(frm, "diplo", 0.0) + g.mod_(frm, "prestige", 0.0)
        + if f.at("trade").has(frm) { 10.0 } else { 0.0 }
        + 30.0 * (pers.atf("trade") - 0.5)
        - 30.0 * (pers.atf("aggr") - 0.5);
    if pb > 1.5 * pa {
        score -= 15.0; // on craint de laisser entrer plus fort que soi
    }
    if g.hegemon() == frm {
        score -= 25.0;
    }
    let foes: Vec<String> = g
        .factions
        .keys()
        .into_iter()
        .map(|x| x.string())
        .filter(|x| x != ai && x != frm && g.factions.at(x).atb("alive") && g.at_war(frm, x))
        .collect();
    if foes.iter().any(|x| g.at_war(ai, x)) {
        score += 20.0; // il va frapper notre ennemi : tant mieux
    }
    if foes.iter().any(|x| g.friendly(ai, x) || rel.at(x) > 40i64) {
        score -= 30.0; // il va frapper un ami : non
    }
    if rel.at(frm) > 20i64 {
        score += 8.0; // sans ce droit, ses armées ne passent pas du tout : on l'accorde plus volontiers aux amis
    }
    if score >= 10.0 {
        return (true, format!("{} accorde le droit de passage pour un an.", g.fname(ai)));
    }
    (false, format!("{} refuse de laisser passer vos troupes (relation {}).", g.fname(ai), py::int_v(&rel.at(frm))))
}

/// Chaque jour : droits de passage échus ou devenus sans objet (guerre).
/// Python : `passage_tick(g)`.
// game/army_actions.py, lignes 1009 à 1019
pub fn passage_tick(g: &mut Game) {
    for (o, f) in g.factions.items() {
        let ps = f.get("passage");
        if !ps.truthy() {
            continue;
        }
        let o = o.string();
        for c in ps.keys() {
            let cs = c.string();
            if ps.at(&c) <= g.t || !g.factions.has(&c) || !g.factions.at(&c).atb("alive") || g.at_war(&o, &cs) {
                if ps.at(&c) <= g.t && (g.player == o || g.player == cs) {
                    let texte = format!("Le droit de passage accordé par {} à {} expire.", g.fname(&o), g.fname(&cs));
                    g.log("diplo", &texte, &dict! {"who" => &o});
                }
                ps.del(&c);
            }
        }
    }
}

// ================================================================== 6. ralliement négocié

/// Python : `neg_info(g, a, nid)`.
/// Rend (prix, risque).
// game/army_actions.py, lignes 1023 à 1034
pub fn neg_info(g: &mut Game, a: &Val, nid: i64) -> (i64, f64) {
    let (n, gn) = (g.nodes.at(nid), g.geo.nodes.at(nid));
    let ratio = force_ratio(g, &a.ats("owner"), nid);
    let k = clamp(1.25 - 0.22 * ratio, 0.35, 1.2); // une armée imposante fait baisser le prix
    let price = py::round((NEG_BASE as f64 + NEG_POP * n.get_or("pop", 0).f() + NEG_MIL * n.atf("milice")) * k / 5.0) * 5;
    let home = gn.at("dept");
    let mut risk = 0.12 + (if ratio < 1.0 { 0.25 } else { 0.0 }) - (if ratio > 3.0 { 0.08 } else { 0.0 })
        + (if n.at("fort") >= 2i64 { 0.1 } else { 0.0 });
    if g.factions.has(&home) && g.factions.at(&home).atb("alive") && home != a.at("owner") {
        risk += 0.12; // elle préférerait se donner à son propre pays
    } else if home == a.at("owner") {
        risk -= 0.06;
    }
    (price, py::round_n(clamp(risk, 0.05, 0.6), 2))
}

/// Python : `negotiate(g, code, a)`.
// game/army_actions.py, lignes 1037 à 1058
pub fn negotiate(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = foreign_place(g, code, a, false);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    if n.at("owner") != R::NEUTRAL {
        return (false, "On ne négocie le ralliement que d'une place indépendante.".to_string());
    }
    if n.at("siege").truthy() {
        return (false, "La place est déjà investie.".to_string());
    }
    if node_aa(&n).has("ng") {
        return (false, "Les pourparlers sont déjà engagés.".to_string());
    }
    let left = cd_left(g, &n, "neg");
    if left > 0 {
        return (false, format!("Les notables ne vous recevront pas avant {}.", R::pl(left, "tour", None)));
    }
    let (price, risk) = neg_info(g, a, nid);
    let f = g.factions.at(code);
    if f.at("res").at("livres") < price {
        return (false, format!("Il faut {price} livres."));
    }
    f.at("res").dec("livres", price);
    aa(&n).set("ng", dict! {"by" => code, "army" => a.at("id"), "until" => TT::deadline(g, NEG_TOURS, &[]), "price" => price, "risk" => risk});
    (
        true,
        format!(
            "Pourparlers avec les notables {} : {price} livres engagées, réponse au prochain tour (risque de refus {} %).",
            R::de(&place(g, nid)),
            py::int(risk * 100.0)
        ),
    )
}

/// Python : `neg_tick(g, n, x, dt)`.
/// Hasard : g.rng.random() à l'échéance.
// game/army_actions.py, lignes 1061 à 1093
pub fn neg_tick(g: &mut Game, n: &Val, x: &Val, dt: f64) {
    let ng = x.at("ng");
    let nid = n.ati("id");
    let a = g.armies.get(ng.at("army"));
    let code = ng.ats("by");
    let f = g.factions.get(&code);
    if !f.truthy() || !f.atb("alive") {
        x.del("ng");
        return;
    }
    if !a.truthy() || a.at("at_node") != nid || a.at("state") != "idle" || n.at("owner") != R::NEUTRAL || n.at("siege").truthy() {
        x.del("ng");
        f.at("res").inc("livres", ng.at("price"));
        if code == g.player {
            let texte = format!("Pourparlers rompus à {} : vos livres vous sont rendues.", place(g, nid));
            g.log("armee", &texte, &lieu(g.node_xy(nid), &code));
        }
        return;
    }
    if !ng.has("until") {
        // (sauvegarde d'avant les tours : jours restants)
        let left = ng.pop("left");
        let left = if left.is_none() { 0.0 } else { left.f() };
        ng.set("until", TT::turn_start_after(g, g.t + left));
    }
    if g.t < ng.atf("until") - 1e-6 {
        return;
    }
    x.del("ng");
    if g.rng.random() < ng.atf("risk") {
        f.at("res").inc("livres", ng.at("price"));
        set_cd(g, n, "neg", NEG_CD, &code);
        if code == g.player {
            let texte = format!("Les notables {} refusent vos offres.", R::de(&place(g, nid)));
            g.log("armee", &texte, &lieu_imp(g.node_xy(nid), &code, true));
        }
        return;
    }
    let texte = format!("{} se rallie à {} après négociation ({} livres).", place(g, nid), g.fname(&code), ng.at("price"));
    let important = code == g.player;
    g.log("capture", &texte, &lieu_imp(g.node_xy(nid), &code, important));
    g.capture(nid, &code, true);
    for b in g.armies.values() {
        if b.at("at_node") == nid && b.at("owner") == code {
            b.set("hold", false);
        }
    }
}

// ================================================================== 7. contribution

/// Python : `ctb_info(g, a, nid)`.
/// Rend (gain : {ressource: int}, rapport de forces).
// game/army_actions.py, lignes 1097 à 1103
pub fn ctb_info(g: &mut Game, a: &Val, nid: i64) -> (Val, f64) {
    let n = g.nodes.at(nid);
    let ratio = force_ratio(g, &a.ats("owner"), nid);
    let kf = clamp(0.3 + 0.3 * ratio, 0.3, 1.3);
    let pop = n.get_or("pop", 0).f();
    let gain = dict! {};
    for (k, t) in CTB().items() {
        let (c, per, top) = t.triple();
        let v = (c.f() + pop * per.f()) * kf;
        gain.set(&k, py::round(if v < top.f() { v } else { top.f() }));
    }
    (gain, ratio)
}

/// Python : `contribution(g, code, a)`.
// game/army_actions.py, lignes 1106 à 1158
pub fn contribution(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = foreign_place(g, code, a, true);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    let o = n.ats("owner");
    if o != R::NEUTRAL && !g.at_war(code, &o) {
        return (false, "On ne rançonne qu'une place indépendante ou ennemie.".to_string());
    }
    let s = n.at("siege");
    if s.truthy() && (s.at("by") != code || s.getb("occupy")) {
        return (false, if s.at("by") != code { "La place est déjà investie." } else { "La place est en train de se rallier." }.to_string());
    }
    let left = cd_left(g, &n, "ctb");
    if left > 0 {
        return (false, format!("La place vient d'être rançonnée : encore {}.", R::pl(left, "tour", None)));
    }
    let (gain, ratio) = ctb_info(g, a, nid);
    if ratio < CTB_MIN {
        return (false, "Vos troupes ne font pas assez peur pour se faire payer.".to_string());
    }
    let f = g.factions.at(code);
    f.at("res").inc("livres", gain.at("livres"));
    f.at("res").inc("vivres", gain.at("vivres"));
    let gn = g.geo.nodes.at(nid);
    if g.factions.has(&o) {
        let fo = g.factions.at(&o);
        let r = fo.at("res");
        r.dec("livres", vmin(vmax(0.0, r.at("livres")), gain.atf("livres") * 0.6)); // le reste sort des coffres de la ville
        r.dec("vivres", vmin(vmax(0.0, r.at("vivres")), gain.atf("vivres") * 0.5));
        fo.at("rel").set(code, vmax(-100, &fo.at("rel").at(code) - CTB_REL_OWNER));
        n.set("stab", vmax(0.05, &n.at("stab") - CTB_STAB));
        for (c, fc) in g.factions.items() {
            if c != code && c != o && fc.atb("alive") {
                fc.at("rel").set(code, vmax(-100, &fc.at("rel").at(code) - 3i64));
            }
        }
    } else {
        for (c, fc) in g.factions.items() {
            if c != code && fc.atb("alive") {
                let home = if gn.at("dept") == c { CTB_REL_HOME } else { 0 };
                fc.at("rel").set(code, vmax(-100, &fc.at("rel").at(code) - CTB_REL_ALL - home));
            }
        }
    }
    set_cd(g, &n, "ctb", CTB_CD, code);
    // puis on laisse la place : siège levé, halte devant ses portes
    for b in g.armies.values() {
        if b.at("at_node") == nid && b.at("owner") == code && (b.at("state") == "idle" || b.at("state") == "siege") {
            if b.at("state") == "siege" {
                g.end_siege_for(&b);
            }
            b.set("hold", true);
            b.set("assault", false);
            b.set("grace", g.t + 1.0);
        }
    }
    let s = n.at("siege");
    if s.truthy() && s.at("by") == code {
        n.set("siege", Val::None);
    }
    let txt = format!("{} livres et {} vivres", gain.at("livres"), gain.at("vivres"));
    if o == g.player {
        let texte = format!("{} rançonne {} : {txt} extorqués.", g.fname(code), place(g, nid));
        g.log("siege", &texte, &au_lieu(&gn, code, true));
    } else if code != g.player && g.factions.has(&o) {
        let texte = format!("{} rançonne {}.", g.fname(code), place(g, nid));
        g.log("siege", &texte, &au_lieu(&gn, code, false));
    }
    let who = if o == R::NEUTRAL { "Tous les départements s'en indignent".to_string() } else { format!("{} ne l'oubliera pas", g.fname(&o)) };
    (true, format!("Contribution exigée {} : {txt}. {who}.", R::de(&place(g, nid))))
}

// ================================================================== 8. blocus

/// Python : `defenders(g, n)`.
// game/army_actions.py, lignes 1162 à 1166
pub fn defenders(g: &Game, n: &Val) -> f64 {
    let mut men = (&n.at("milice") + &py::sum_v(n.at("garrison").iter().map(|r| r.at("n")))).f();
    let o = n.ats("owner");
    men += py::sum(
        g.armies
            .values()
            .iter()
            .filter(|b| b.at("at_node") == n.at("id") && b.at("state") == "idle" && g.friendly(&b.ats("owner"), &o))
            .map(|b| g.army_men(b)),
    );
    men
}

/// Python : `blockade(g, code, a)`.
// game/army_actions.py, lignes 1169 à 1203
pub fn blockade(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = foreign_place(g, code, a, true);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let n = g.nodes.at(nid);
    let o = n.ats("owner");
    if o != R::NEUTRAL && !g.at_war(code, &o) {
        return (false, "On ne bloque qu'une place indépendante ou ennemie.".to_string());
    }
    let s = n.at("siege");
    if s.truthy() && s.at("by") != code {
        return (false, "La place est déjà investie par un autre camp.".to_string());
    }
    if s.truthy() && s.getb("blocus") {
        return (false, "La place est déjà bloquée.".to_string());
    }
    if s.truthy() && s.getb("occupy") {
        return (false, "La place est en train de se rallier.".to_string());
    }
    if g.battles.values().iter().any(|bt| bt.at("node") == nid) {
        return (false, "On se bat devant la place.".to_string());
    }
    if force_ratio(g, code, nid) < BLOC_MIN {
        return (false, "Trop peu de troupes pour investir la place.".to_string());
    }
    let gn = g.geo.nodes.at(nid);
    let food = bloc_food(&gn, &n);
    let m0 = py::round(defenders(g, &n));
    n.set("siege", dict! {"by" => code, "dmg" => 0.0, "since" => py::round_n(g.t, 2), "blocus" => true, "food" => &food, "m0" => m0});
    for b in g.armies.values() {
        if b.at("at_node") == nid && b.at("owner") == code && (b.at("state") == "idle" || b.at("state") == "siege") {
            b.set("state", "siege");
            b.set("hold", false);
            b.set("assault", false);
        }
    }
    let nom = R::de(&gn.ats("name"));
    if o == g.player {
        g.alert_pause(false);
        let texte = format!(
            "Blocus {nom} par {} : plus rien n'entre ni ne sort. Ses réserves dureront environ {}.",
            g.fname(code),
            R::pl(TT::tours_left(g, g.t + food.f()), "tour", None)
        );
        g.log("siege", &texte, &au_lieu(&gn, code, true));
    } else if code != g.player && g.factions.has(&o) {
        let texte = format!("Blocus {nom} par {}.", g.fname(code));
        g.log("siege", &texte, &au_lieu(&gn, code, false));
    }
    (
        true,
        format!(
            "Blocus {nom} : ni bombardement ni assaut, la place est coupée de tout. Ses réserves tiendront environ {}, puis la faim et \
             les désertions la pousseront à se rendre.",
            R::pl(TT::tours_left(g, g.t + food.f()), "tour", None)
        ),
    )
}

/// Python : `bombard(g, code, a)`.
// game/army_actions.py, lignes 1206 à 1214
pub fn bombard(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let nid = a.at("at_node");
    let n = if nid.is_some() { g.nodes.at(&nid) } else { Val::None };
    if !n.truthy() || !n.at("siege").truthy() || n.at("siege").at("by") != code || !n.at("siege").getb("blocus") {
        return (false, "Cette armée ne bloque aucune place.".to_string());
    }
    if !walled(&n) {
        return (false, "La place n'a pas de remparts à battre : donnez l'assaut.".to_string());
    }
    n.set("siege", dict! {"by" => code, "dmg" => 0.0, "since" => n.at("siege").at("since")});
    (true, format!("Les batteries ouvrent le feu sur {} : le blocus devient un siège.", place(g, nid.i())))
}

/// Un jour de blocus : les réserves s'épuisent, puis la faim et les désertions minent les défenseurs.
/// Python : `blockade_tick(g, n, bes, dt)`.
/// bes : la liste des armées qui bloquent (engine.besiegers).
// game/army_actions.py, lignes 1217 à 1258
pub fn blockade_tick(g: &mut Game, n: &Val, bes: &Val, dt: f64) {
    let s = n.at("siege");
    let nid = n.ati("id");
    let gn = g.geo.nodes.at(nid);
    if bes.iter().any(|b| b.atb("assault")) {
        for b in bes.iter() {
            b.set("state", "idle");
            b.set("assault", true);
        }
        g.start_battle(bes, &list![], gn.atf("x"), gn.atf("y"), &Val::from(nid), false, false);
        return;
    }
    let el = g.t - s.atf("since");
    let famine = s.at("food") < el;
    let (km, kg, kmor) = if famine { (0.03, 0.025, 3.0) } else { (0.004, 0.002, 0.5) };
    let v = n.atf("milice") * (1.0 - km * dt);
    n.set("milice", if v > 0.0 { v } else { 0.0 });
    for r in n.at("garrison").iter() {
        r.scale("n", 1.0 - kg * dt);
        r.set("morale", vmax(5, &r.at("morale") - kmor * dt));
    }
    n.set("garrison", Val::list(n.at("garrison").iter().filter(|r| r.at("n") >= 5i64).collect()));
    let o = n.ats("owner");
    if famine {
        for b in g.armies.values() {
            if b.at("at_node") == nid && b.at("state") == "idle" && g.friendly(&b.ats("owner"), &o) {
                for r in b.at("regs").iter() {
                    r.scale("n", 1.0 - 0.01 * dt);
                    r.set("morale", vmax(5, &r.at("morale") - 2.0 * dt));
                }
            }
        }
    }
    let k = el / (s.atf("food") + BLOC_STARVE as f64);
    s.set("dmg", if k < 1.0 { k } else { 1.0 });
    if s.atf("dmg") < 1.0 && !(famine && defenders(g, n) < 0.2 * vmax(1, s.get_or("m0", 1)).f()) {
        return;
    }
    // reddition : la garnison obtient les honneurs de la guerre et se retire
    let by = s.ats("by");
    for b in g.armies.values() {
        if b.at("at_node") == nid && b.at("state") == "idle" && g.friendly(&b.ats("owner"), &o) {
            for r in b.at("regs").iter() {
                r.scale("n", 0.75);
            }
            g.retreat(&b);
        }
    }
    n.set("siege", Val::None);
    if g.player == by || g.player == o || (g.factions.has(&o) && g.friendly(&g.player, &o)) {
        let texte = format!("{}, affamée, ouvre ses portes à {}.", gn.at("name"), g.fname(&by));
        g.log("capture", &texte, &au_lieu(&gn, &by, true));
    }
    g.capture(nid, &by, true);
    for b in bes.iter() {
        b.set("state", "idle");
    }
}

// ================================================================== commandes

/// (place, raison) : l'armée est-elle à l'arrêt dans une de nos places ?
/// Python : `own_place(g, code, a, siege_ok=False)`.
/// siege_ok : False par défaut. Rend (place, None) ou (None, raison).
// game/army_actions.py, lignes 1262 à 1272
pub fn own_place(g: &Game, code: &str, a: &Val, siege_ok: bool) -> (Option<i64>, Option<String>) {
    let nid = a.at("at_node");
    if nid.is_none() || a.at("state") != "idle" || a.getb("boat") || a.at("battle").truthy() {
        return (None, Some("L'armée doit être à l'arrêt dans une de vos places.".to_string()));
    }
    let n = g.nodes.at(&nid);
    if n.at("owner") != code {
        return (None, Some("L'armée doit être à l'arrêt dans une de vos places.".to_string()));
    }
    if n.at("siege").truthy() && !siege_ok {
        return (None, Some("La place est assiégée.".to_string()));
    }
    (Some(nid.i()), None)
}

/// (place, raison) : l'armée se tient-elle devant une place qui n'est pas à nous (ni alliée) ?
/// Python : `foreign_place(g, code, a, siege_ok=False)`.
/// siege_ok : False par défaut. Rend (place, None) ou (None, raison).
// game/army_actions.py, lignes 1275 à 1284
pub fn foreign_place(g: &Game, code: &str, a: &Val, siege_ok: bool) -> (Option<i64>, Option<String>) {
    let nid = a.at("at_node");
    let etat = a.at("state") == "idle" || (siege_ok && a.at("state") == "siege");
    if nid.is_none() || !etat || a.getb("boat") || a.at("battle").truthy() {
        return (None, Some("L'armée doit se tenir devant la place.".to_string()));
    }
    let o = g.nodes.at(&nid).ats("owner");
    if o == code || g.friendly(code, &o) {
        return (None, Some("Cette place est à vous ou à un allié.".to_string()));
    }
    (Some(nid.i()), None)
}

/// Fin de la halte : rallier ou attaquer la place, comme une armée en conquête.
/// Python : `conquer(g, code, a)`.
// game/army_actions.py, lignes 1287 à 1306
pub fn conquer(g: &mut Game, code: &str, a: &Val) -> (bool, String) {
    let (nid, why) = foreign_place(g, code, a, false);
    if let Some(why) = why {
        return (false, why);
    }
    let nid = nid.unwrap();
    let o = g.nodes.at(nid).ats("owner");
    if o != R::NEUTRAL && !g.at_war(code, &o) {
        return (false, format!("{} appartient à {} (en paix). Déclarez la guerre d'abord.", place(g, nid), g.fname(&o)));
    }
    if ask_alive(g, a).truthy() {
        return (true, format!("Devant {} : à vous de choisir.", place(g, nid)));
    }
    a.set("hold", false);
    a.set("tr", false);
    g.arrive_node(a, nid, true);
    if a.getb("ask") {
        return (true, format!("Devant {} : à vous de choisir.", place(g, nid)));
    }
    if a.pop("took").truthy() {
        // tour du joueur : la place s'est ralliée tout de suite, la marche du tour s'arrête là
        a.set("mp", 0.0);
        return (true, format!("{} se rallie à vous.", place(g, nid)));
    }
    let s = g.nodes.at(nid).at("siege");
    (true, if a.at("state") == "siege" && s.truthy() && s.getb("occupy") { "Ralliement en cours." } else { "À l'attaque !" }.to_string())
}

/// `ACTIONS = dict(fortify=fortify, garde=garde, req=requisition, neg=negotiate, ctb=contribution, blocus=blockade,
/// bombard=bombard, conquer=conquer)` : `ACTIONS.get(what)` s'écrit `ACTIONS(what)`.
pub fn ACTIONS(what: &str) -> Option<fn(&mut Game, &str, &Val) -> (bool, String)> {
    Some(match what {
        "fortify" => fortify,
        "garde" => garde,
        "req" => requisition,
        "neg" => negotiate,
        "ctb" => contribution,
        "blocus" => blockade,
        "bombard" => bombard,
        "conquer" => conquer,
        _ => return None,
    })
}

/// Python : `command(g, code, aid, what)`.
/// aid, what : tels que le navigateur les envoie.
// game/army_actions.py, lignes 1313 à 1326
pub fn command(g: &mut Game, code: &str, aid: &Val, what: &Val) -> (bool, String) {
    // (un identifiant qui n'est pas un texte n'est pas une clé de g.armies ; une liste n'y est pas cherchée : en
    // Python, elle lèverait TypeError, que le serveur rend en « Commande invalide »)
    let a = if aid.is_str() { g.armies.get(aid) } else { Val::None };
    if !a.truthy() || a.at("owner") != code {
        return (false, "Armée introuvable.".to_string());
    }
    if *what == "quarters" || *what == "camp" {
        return quarters(g, code, &a, *what == "quarters");
    }
    if *what == "rangs" || *what == "rangs_stop" {
        return rangs(g, code, &a, *what == "rangs");
    }
    if *what == "relever" {
        return relever(g, code, &a);
    }
    let fun = if what.is_str() { ACTIONS(what.s()) } else { None };
    match fun {
        None => (false, "Action inconnue.".to_string()),
        Some(fun) => fun(g, code, &a),
    }
}

// ================================================================== vues (état envoyé au navigateur)

/// Ouvrages, travaux et garde d'une place ; blocus. mine : place de notre camp ; visible() : vue d'ici.
/// Python : `view_node(g, n, d, mine, visible)`.
/// d : la vue de la place (modifiée) ; visible : la fermeture `lambda: g.intel_active(p, nid) or seen(x, y)` de
/// views.player_state, qui ne s'appelle que si besoin (elle peut capturer la partie : `&Game` des deux côtés).
// game/army_actions.py, lignes 1330 à 1345
pub fn view_node(g: &Game, n: &Val, d: &Val, mine: bool, visible: &dyn Fn() -> bool) {
    let s = n.at("siege");
    if s.truthy() && s.getb("blocus") && d.get("sg").truthy() {
        d.at("sg").set("bl", 1);
    }
    let x = n.get("aa");
    if !x.truthy() {
        return;
    }
    if x.getb("bar") && (mine || visible()) {
        d.set("bar", py::round_n(x.atf("bar"), 2));
    }
    if !mine {
        return;
    }
    if x.has("bw") {
        let w = x.at("bw");
        let total = w.atf("total");
        d.set(
            "bw",
            list![py::round_n(1.0 - w.atf("left") / if total > 0.1 { total } else { 0.1 }, 2), py::round_n(w.atf("left"), 1), w.at("kind")],
        );
    }
    if x.has("gd") {
        d.set("gd", list![g.date_str(&x.at("gd").at("until")), x.at("gd").at("add")]);
    }
}

/// Python : `view_army(g, a, d, own)`.
/// d : la vue de l'armée (modifiée). (&mut : ask_alive, options.)
// game/army_actions.py, lignes 1348 à 1369
pub fn view_army(g: &mut Game, a: &Val, d: &Val, own: bool) {
    if a.getb("qrt") {
        d.set("qr", 1);
    }
    if !own {
        return;
    }
    if a.getb("tr") {
        d.set("tr", 1);
    }
    if a.getb("hold") {
        d.set("hold", 1);
    }
    if a.getb("rg") && rangs_ok(g, a).0 {
        let manque = py::sum_v(a.at("regs").iter().map(|r| &r.at("max") - &r.at("n"))).f();
        d.set("rg", list![TT::tours_left(g, a.at("rg").atf("until")), py::round(manque)]);
    }
    if ask_alive(g, a).truthy() {
        let nd = a.at("ask").at("node");
        let c = ask_choices(g, a);
        d.set("ask", dict! {"n" => nd, "c" => c}); // fenêtre d'arrivée devant une place (ui.js)
    }
    if a.getb("dt") && a.at("path").truthy() {
        d.set("dt", a.at("dt").iter().map(|o| Val::from(g.fname(o.s()))).collect::<Val>()); // terres fermées contournées
    }
    let cl = a.get("cl");
    if cl.truthy() {
        d.set("cl", list![g.fname(cl.at("o").s()), TT::tours_left(g, cl.atf("until"))]); // sur des terres fermées : tours de grâce
    }
    let nid = a.at("at_node");
    if nid.is_none() || !(a.at("state") == "idle" || a.at("state") == "siege") || a.getb("boat") || a.at("battle").truthy() {
        return;
    }
    let ax = options(g, a, nid.i());
    d.set("ax", ax);
}

/// Actions possibles là où se tient l'armée, avec leurs coûts et leurs raisons.
/// Python : `options(g, a, nid)`.
/// Rend un dict, ou None.
// game/army_actions.py, lignes 1372 à 1441
pub fn options(g: &mut Game, a: &Val, nid: i64) -> Val {
    let code = a.ats("owner");
    let n = g.nodes.at(nid);
    let res = g.factions.at(&code).at("res");
    let x = node_aa(&n);
    if n.at("owner") == code {
        if a.at("state") != "idle" {
            return Val::None;
        }
        let (_, why_s) = own_place(g, &code, a, false);
        let (kind, days, bois, cur) = fortify_info(g, a, nid);
        let w = x.get("bw");
        let fwhy = if w.truthy() {
            "Travaux en cours".to_string()
        } else if cur >= BAR_REDO {
            format!("Ouvrage encore solide ({} %)", py::int(cur * 100.0))
        } else if res.at("bois") < bois {
            format!("Il faut {bois} bois")
        } else {
            String::new()
        };
        let (add, armes) = garde_info(&n);
        let gl = cd_left(g, &n, "garde");
        let gwhy = if x.has("gd") {
            "Déjà sous les armes".to_string()
        } else if gl > 0 {
            format!("Encore {}", R::pl(gl, "tour", None))
        } else if res.at("armes") < armes {
            format!("Il faut {armes} armes")
        } else {
            String::new()
        };
        let rl = cd_left(g, &n, "req");
        let rq = req_info(&n);
        let food = py::sum_v(a.at("regs").iter().map(|r| &R::UNITS().at(r.at("type")).at("upkeep_v") * &r.at("n") / 100i64)).f()
            * QRT_FOOD
            * (1.0 + g.mod_(&code, "upkeep", 0.0));
        let (need, rarmes, tours, ti) = rangs_info(g, a);
        let (ms, rcost) = relever_info(g, &code, a);
        let rg = a.get("rg");
        let fort = dict! {
            "why" => fwhy, "k" => kind, "d" => days, "b" => bois, "s" => py::round_n(cur, 2),
            "w" => if w.truthy() && w.at("by") == a.at("id") { list![py::round_n(w.atf("left"), 1), py::round_n(w.atf("total"), 1)] } else { Val::None }
        };
        let qrt = dict! {"on" => a.getb("qrt"), "why" => why_s.clone().unwrap_or_default(), "food" => py::round_n(food, 1)};
        let rgv = dict! {
            "why" => if rg.truthy() { String::new() } else { rangs_why(g, &code, a) }, "t" => tours, "rm" => tours - ti,
            "men" => py::int(need), "armes" => rarmes, "w" => if rg.truthy() { Val::from(TT::tours_left(g, rg.atf("until"))) } else { Val::None }
        };
        let rv = if ms.truthy() {
            dict! {
                "why" => relever_why(g, &code, a), "regs" => ms.iter().map(|m| list![m.at(0), m.at(1)]).collect::<Val>(),
                "cost" => Val::dict_from(rcost.items().into_iter().map(|(k, v)| (k, Val::from(py::round(v.f())))).collect())
            }
        } else {
            Val::None
        };
        let gardev = dict! {"why" => gwhy, "add" => add, "armes" => armes, "t" => GARDE_TOURS};
        let reqwhy = match why_s {
            Some(w) if !w.is_empty() => w,
            _ => if rl > 0 { format!("Encore {}", R::pl(rl, "tour", None)) } else { String::new() },
        };
        let req = dict! {"why" => reqwhy, "g" => rq, "stab" => py::int(REQ_STAB * 100.0)};
        return dict! {"own" => 1, "fort" => fort, "qrt" => qrt, "rg" => rgv, "rv" => rv, "garde" => gardev, "req" => req};
    }
    if g.friendly(&code, &n.ats("owner")) {
        return Val::None;
    }
    let o = n.ats("owner");
    let war = o != R::NEUTRAL && g.at_war(&code, &o);
    let s = n.at("siege");
    let out = dict! {"own" => 0, "o" => &o, "hold" => a.getb("hold")};
    if o != R::NEUTRAL && !war {
        return out; // chez un voisin en paix : seulement passer
    }
    if s.truthy() && s.at("by") != code {
        out.set("busy", 1);
        return out;
    }
    let occ = s.truthy() && s.getb("occupy");
    if o == R::NEUTRAL && !s.truthy() {
        let (price, risk) = neg_info(g, a, nid);
        let ng = x.get("ng");
        let nl = cd_left(g, &n, "neg");
        let why = if ng.truthy() {
            "Pourparlers en cours".to_string()
        } else if nl > 0 {
            format!("Pas reçus avant {}", R::pl(nl, "tour", None))
        } else if res.at("livres") < price {
            format!("Il faut {price} livres")
        } else {
            String::new()
        };
        let w = if ng.truthy() && ng.has("until") { Val::from(TT::tours_left(g, ng.atf("until"))) } else { Val::None };
        out.set("neg", dict! {"why" => why, "p" => price, "r" => risk, "w" => w});
    }
    if !occ {
        let (gain, ratio) = ctb_info(g, a, nid);
        let cl = cd_left(g, &n, "ctb");
        let why = if cl > 0 {
            format!("Encore {}", R::pl(cl, "tour", None))
        } else if ratio < CTB_MIN {
            "Trop peu de troupes pour l'exiger".to_string()
        } else {
            String::new()
        };
        out.set("ctb", dict! {"why" => why, "g" => gain, "all" => o == R::NEUTRAL});
        let bl = s.truthy() && s.getb("blocus");
        if !bl {
            let gn = g.geo.nodes.at(nid);
            let food = bloc_food(&gn, &n);
            out.set(
                "blq",
                dict! {
                    "why" => if ratio >= BLOC_MIN { "" } else { "Trop peu de troupes pour investir la place" },
                    "t" => TT::tours_left(g, g.t + food.f() + BLOC_STARVE as f64), "dp" => n.getb("depot")
                },
            );
        } else {
            out.set("bl", dict! {"food" => TT::tours_left(g, s.atf("since") + s.atf("food")), "walled" => walled(&n)});
        }
    }
    if a.getb("hold") && a.at("state") == "idle" {
        out.set("conq", 1);
    }
    out
}

/// Droits de passage entre le joueur et ce département : ps (il nous l'accorde), pg (nous le lui accordons) ;
/// cl : ses terres nous sont fermées ; cg : les nôtres lui sont fermées.
/// Python : `view_passage(g, p, code)`.
// game/army_actions.py, lignes 1444 à 1458
pub fn view_passage(g: &Game, p: &str, code: &str) -> Val {
    if code == p {
        return dict! {};
    }
    let out = dict! {};
    if has_passage(g, p, code) {
        out.set("ps", g.date_str(&g.factions.at(code).at("passage").at(p)));
    }
    if has_passage(g, code, p) {
        out.set("pg", g.date_str(&g.factions.at(p).at("passage").at(code)));
    }
    if closed_to(g, p, code) {
        out.set("cl", 1);
    }
    if closed_to(g, code, p) {
        out.set("cg", 1);
    }
    out
}

// ================================================================== IA

/// Tous les trois jours environ : barricades, garde bourgeoise, quartiers, réquisition, droits de passage.
/// Python : `ai_step(ai)`.
/// `ai.f` : `ai.f(g)`, `ai.wars()` : `ai.wars(g)`… (l'IA ne garde pas la partie).
// game/army_actions.py, lignes 1462 à 1515
pub fn ai_step(g: &mut Game, ai: &mut AI) {
    let code = ai.code.clone();
    let f = ai.f(g);
    let res = f.at("res");
    let wars = ai.wars(g);
    let mut works = 0;
    for a in g.armies.values() {
        if a.at("owner") != code {
            continue;
        }
        let nid = a.at("at_node");
        if nid.is_none() || a.at("state") != "idle" || a.getb("boat") || a.at("battle").truthy() {
            continue;
        }
        let nid = nid.i();
        let n = g.nodes.at(nid);
        if n.at("owner") != code {
            continue;
        }
        let threat = if wars.truthy() { ai.threat_at(g, nid, 40.0, &Val::None, &Val::None) } else { 0.0 };
        let x = node_aa(&n);
        if threat > 0.0 {
            a.set("qrt", false);
            let dfn = g.node_defense_power(nid, true);
            // une place qui compte, menacée et sans remparts, se barricade (un chantier à la fois)
            let typ = g.geo.nodes.at(nid).ats("type");
            if works == 0
                && !x.has("bw")
                && x.get_or("bar", 0) < 0.4
                && threat > 0.5 * dfn
                && (typ != "village" || n.getb("depot") || threat > dfn)
                && (n.at("fort") <= 0i64 || threat > 1.5 * dfn)
            {
                let (_, _, bois, _) = fortify_info(g, &a, nid);
                if res.at("bois") >= bois + 80 && fortify(g, &code, &a).0 {
                    works += 1;
                }
            }
            // face à une menace sérieuse, les bourgeois prennent les armes
            if threat > 0.8 * dfn && !x.has("gd") && cd_left(g, &n, "garde") <= 0 {
                if res.at("armes") >= &Val::from(garde_info(&n).1) + &ai.arms_floor(g).at("armes") {
                    garde(g, &code, &a);
                }
            }
            continue;
        }
        // loin de l'ennemi, une armée éprouvée prend ses quartiers ; refaite, elle lève le camp
        let regs = a.at("regs");
        let men = g.army_men(&a);
        let s = py::sum_v(regs.iter().map(|r| r.at("max"))).f();
        let mx = if s != 0.0 { s } else { 1.0 };
        let mor = py::sum_v(regs.iter().map(|r| &r.at("morale") * &r.at("n"))).f() / if men > 1.0 { men } else { 1.0 };
        let tired = men < 0.85 * mx || mor < 70.0;
        if a.getb("qrt") {
            if !tired || res.at("vivres") < 120i64 || f.getb("famine") {
                quarters(g, &code, &a, false);
            }
        } else if tired && !n.at("siege").truthy() && res.at("vivres") > 300i64 && !f.getb("famine") && f.at("income").at("vivres") > -3i64 {
            quarters(g, &code, &a, true);
        }
        if a.getb("morts") && !a.getb("rg") && res.at("livres") > 800i64 {
            // (une réserve pour la solde)
            relever(g, &code, &a); // (la commande fait elle-même les contrôles)
        }
        if tired && men < 0.9 * mx && !a.getb("rg") {
            rangs(g, &code, &a, true);
        }
    }
    // disette : on réquisitionne la plus grosse place tranquille où campe une armée
    if f.getb("famine") || (res.at("vivres") < 100i64 && f.at("income").at("vivres") < 0i64) {
        let mut cands: Vec<(Val, Val)> = vec![];
        for a in g.armies.values() {
            if a.at("owner") == code && a.at("state") == "idle" && a.at("at_node").is_some() && !a.getb("boat") {
                let n = g.nodes.at(a.at("at_node"));
                if n.at("owner") == code && !n.at("siege").truthy() && n.at("stab") >= 0.65 && cd_left(g, &n, "req") <= 0 {
                    cands.push((n.get_or("pop", 0), a));
                }
            }
        }
        if let Some((_, a)) = py::max_by_key(cands, |c| c.0.clone()) {
            requisition(g, &code, &a);
        }
    }
    ai_passage(g, ai, &wars);
}

/// Demander le passage chez un voisin dont les terres sont fermées quand le contournement est trop long ou
/// impossible (vers l'ennemi, ou vers une destination refusée naguère) ; retirer le sien à qui nous déteste.
/// Python : `ai_passage(ai, wars)`.
/// wars : la liste des camps en guerre. `getattr(ai, 'refused', {})` : ai.refused ; `ai.rally` : `ai.rally(g)`.
/// Piège : `{g.nodes[v]['owner'] for v in free[1]} & block` est trié avant d'être parcouru (sorted).
// game/army_actions.py, lignes 1518 à 1554
pub fn ai_passage(g: &mut Game, ai: &mut AI, wars: &Val) {
    let code = ai.code.clone();
    let f = ai.f(g);
    for o in f.get_or("passage", dict! {}).keys() {
        if f.at("passage").at(&o) > g.t && f.at("rel").get_or(&o, 0) < -25i64 {
            revoke_passage(g, &code, o.s());
        }
    }
    let refused = ai.refused.clone();
    let vieux: Vec<Val> = refused.items().into_iter().filter(|(_, t)| g.t - t.f() > 90.0).map(|(k, _)| k).collect();
    for nid in vieux {
        refused.del(&nid); // vieux refus : oubliés
    }
    if (!wars.truthy() && !refused.truthy()) || f.at("overlord").truthy() || ai.cool.get_or(tup!["aa", "route"], -1) > g.t {
        return;
    }
    ai.cool.set(tup!["aa", "route"], g.t + 15.0);
    // (`ai.rally if getattr(ai, 'rally', None) is not None` : la propriété est lue deux fois, la seconde rend ce que
    // la première a gardé)
    let rally = ai.rally(g);
    let start = if rally.is_some() { rally } else { g.capital_of(&code) };
    if start.is_none() || g.nodes.at(&start).at("owner") != code {
        return;
    }
    let block = closed_owners(g, &code);
    if !block.truthy() {
        return;
    }
    let goals: Vec<Val> = wars.slice(None, Some(2)).iter().map(|x| g.capital_of(x.s())).collect();
    let mut goals: Vec<Val> = goals.into_iter().filter(|v| wars.has(g.nodes.at(v).at("owner"))).collect();
    goals.extend(py::sorted_by_key(refused.keys(), |v| -refused.at(v)).into_iter().take(2));
    for goal in goals {
        if block.has(g.nodes.at(&goal).at("owner")) {
            continue; // la destination elle-même est fermée : ce n'est pas un passage qu'il faut
        }
        let gi = goal.i();
        let Some(free) = g.road_route(&code, &dict! {start.clone() => 0.0}, gi, 22.0, false, 1, &pyset![], false, false, &Val::None) else {
            continue;
        };
        let r = g.road_route(&code, &dict! {start.clone() => 0.0}, gi, 22.0, false, 1, &block, false, false, &Val::None);
        if let Some(r) = &r {
            if r.0 <= 1.3 * free.0 {
                continue; // le détour est court : pas besoin de demander
            }
        }
        let proprios = Val::set_from(free.1.iter().map(|v| g.nodes.at(&v).at("owner")).collect());
        let fermes: Vec<Val> = proprios.iter().filter(|o| block.has(o)).collect();
        for o in py::sorted_by_key(fermes, |o| o.clone()) {
            let cle = tup![o.clone(), "passage"];
            if ai.cool.get_or(&cle, -1) > g.t {
                continue;
            }
            ai.cool.set(&cle, g.t + 120.0);
            D::act(g, &code, &o, &Val::from("passage"), &Val::from(0), &Val::None, &Val::None);
        }
    }
}

/// Devant une place assiégée : rançonner avant de partir, ou affamer plutôt que d'attendre la brèche.
/// True si la décision est prise (l'IA ne fait rien d'autre ce tour-ci).
/// Python : `ai_siege(ai, a, ratio)`.
// game/army_actions.py, lignes 1557 à 1582
pub fn ai_siege(g: &mut Game, ai: &mut AI, a: &Val, ratio: f64) -> bool {
    let code = ai.code.clone();
    let nid = a.ati("at_node");
    let n = g.nodes.at(nid);
    let s = n.at("siege");
    if !s.truthy() || s.at("by") != code || s.getb("occupy") {
        return false;
    }
    if s.getb("blocus") {
        if ratio < 0.6 {
            return false; // secours trop fort : on se replie
        }
        if s.atf("dmg") >= 0.7 && ratio > 2.5 {
            g.assault(&code, &a.at("id"));
        }
        return true;
    }
    let dur = g.t - s.get_or("since", g.t).f();
    if ((0.5 <= ratio && ratio < 0.6) || (ai.f(g).at("res").at("livres") < 300i64 && dur > 20.0 && ratio < 1.3)) && cd_left(g, &n, "ctb") <= 0 {
        if contribution(g, &code, a).0 {
            return true;
        }
    }
    let besiegers: Vec<Val> = g
        .armies
        .values()
        .into_iter()
        .filter(|b| b.at("at_node") == nid && b.at("owner") == code && b.at("state") == "siege")
        .collect();
    if dur > 2.0
        && n.at("fort") >= 2i64
        && 0.9 <= ratio
        && ratio < 3.0
        && !besiegers.iter().any(|b| b.at("regs").iter().any(|r| r.at("type") == "artillerie"))
    {
        if blockade(g, &code, a).0 {
            return true;
        }
    }
    false
}
