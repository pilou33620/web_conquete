//! L'IA des flottes (SPEC-EMPIRE, module 2), appelée à chaque pas de l'IA (AI::step), mais qui ne regarde que tous les
//! dix jours : une petite flotte de guerre si le camp a des ports et de l'argent qui dort, l'escorte de ses armées qui
//! font du cabotage, le blocus du port ennemi le plus riche en guerre, le retour au port à la paix. Simple et peu
//! coûteuse : une recherche de chemin au plus par coup d'œil, et un port injoignable n'est pas recherché de nouveau
//! avant trois mois.

use super::AI;
use crate::engine::marine as M;
use crate::engine::Game;
use crate::py::Val;
use crate::rules as R;
use crate::{dict, tup};

const PAS: f64 = 10.0; // jours entre deux coups d'œil
const OUBLI: f64 = 90.0; // jours avant de rechercher un chemin vers un port injoignable
/// Les navires de guerre, du plus fort au plus faible : l'IA met en chantier le premier qu'elle peut.
const GUERRE: [&str; 6] = ["cuirasse", "vaisseau_helice", "vaisseau", "fregate_helice", "fregate", "corvette"];

fn de_guerre(f: &Val) -> i64 {
    f.at("navires").items().iter().filter(|(t, _)| t != "flute").map(|(_, n)| n.i()).sum()
}

pub fn jouer(g: &mut Game, ai: &mut AI) {
    let cle = tup!["marine", "pas"];
    if ai.cool.get_or(&cle, 0.0).f() > g.t {
        return;
    }
    ai.cool.set(&cle, g.t + PAS);
    let code = ai.code.clone();
    let ports: Vec<(i64, i64)> = g
        .owned_nodes(&code)
        .iter()
        .filter(|n| !n.atb("siege"))
        .map(|n| (n.ati("id"), M::niveau_port(g, n.ati("id"))))
        .filter(|x| x.1 > 0)
        .collect();
    let mes: Vec<Val> = g.flottes.values().into_iter().filter(|f| f.at("owner") == code.as_str()).collect();
    if ports.is_empty() && mes.is_empty() {
        return;
    }
    let wars = ai.wars(g);
    construire(g, ai, &code, &ports, &mes, wars.truthy());
    // une flotte libre (ni au combat, ni en route) à la fois : escorte, blocus, retour au port
    let libre = |f: &Val| !f.getb("bataille") && !f.atb("chemin") && de_guerre(f) > 0;
    for f in mes.iter() {
        if !g.flottes.has(f.at("id")) || !libre(f) {
            continue;
        }
        let o = f.at("ordre");
        let cible = f.get("cible");
        if o == "blocus" && cible.is_some() && g.at_war(&code, g.nodes.at(&cible).at("owner").s()) {
            continue; // (blocus en cours)
        }
        if o == "blocus" {
            f.set("ordre", "");
        }
        if wars.truthy() && (escorter(g, ai, &code, f) || bloquer(g, ai, &code, f, &wars)) {
            return;
        }
        // rien à faire : au port
        if f.get("a_quai").is_none() {
            if let Some(&(nid, _)) = ports.iter().min_by_key(|(nid, _)| {
                let gn = g.geo.nodes.at(*nid);
                (M::dist(f, gn.atf("x"), gn.atf("y")) * 10.0) as i64
            }) {
                if ai.cool.get_or(tup!["marine", nid], 0.0).f() <= g.t && !M::deplacer(g, &code, &f.at("id"), &Val::from(nid), &Val::None, &Val::None).0 {
                    ai.cool.set(tup!["marine", nid], g.t + OUBLI);
                }
            }
            return;
        }
    }
}

/// Une petite flotte de guerre : 2 navires de guerre (+1 par cinq ports, +1 en guerre, 6 au plus), mis en chantier dans
/// le meilleur port quand l'argent dort (AI::idle_money).
fn construire(g: &mut Game, ai: &AI, code: &str, ports: &[(i64, i64)], mes: &[Val], guerre: bool) {
    if ports.is_empty() {
        return;
    }
    let en_chantier: i64 = ports
        .iter()
        .map(|(nid, _)| g.nodes.at(*nid).at("queue").iter().filter(|q| q.at("kind") == "navire").count() as i64)
        .sum();
    let n = mes.iter().map(de_guerre).sum::<i64>() + en_chantier;
    let voulu = (2 + ports.len() as i64 / 5 + guerre as i64).min(6);
    if n >= voulu || en_chantier > 0 {
        return;
    }
    let Some(&(nid, _)) = ports.iter().filter(|(nid, _)| g.nodes.at(*nid).at("queue").len() < 2).max_by_key(|(nid, niv)| (*niv, -nid)) else {
        return;
    };
    let argent = ai.idle_money(g);
    for t in GUERRE {
        let cout = R::NAVIRES().at(t).at("cout").get_or("livres", 0).f();
        if cout <= argent && M::peut_construire(g, code, nid, &Val::from(t)).0 {
            M::construire(g, code, nid, &Val::from(t));
            return;
        }
    }
}

/// Une armée du camp fait du cabotage en guerre : la flotte part l'attendre au port où elle va.
fn escorter(g: &mut Game, ai: &mut AI, code: &str, f: &Val) -> bool {
    for a in g.armies.values() {
        if a.at("owner") != code || !a.getb("boat") {
            continue;
        }
        let leg = if a.atb("path") { a.at("path").at(0) } else { Val::None };
        let to = if leg.is_some() { leg.get("to") } else { Val::None };
        if to.is_none() || M::case_port(&g.geo, to.i()).is_none() || ai.cool.get_or(tup!["marine", &to], 0.0).f() > g.t {
            continue;
        }
        if M::deplacer(g, code, &f.at("id"), &to, &Val::None, &Val::None).0 {
            return true;
        }
        ai.cool.set(tup!["marine", &to], g.t + OUBLI);
    }
    false
}

/// Le blocus du port ennemi le plus riche (le plus peuplé) qu'on peut joindre.
fn bloquer(g: &mut Game, ai: &mut AI, code: &str, f: &Val, wars: &Val) -> bool {
    let mut cibles: Vec<(i64, i64)> = vec![];
    for o in wars.iter() {
        for n in g.owned_nodes(o.s()).iter() {
            let nid = n.ati("id");
            if ai.cool.get_or(tup!["marine", nid], 0.0).f() <= g.t && M::case_port(&g.geo, nid).is_some() {
                cibles.push((n.get_or("pop", 0).f() as i64, nid));
            }
        }
    }
    cibles.sort_by_key(|c| (-c.0, c.1));
    let Some(&(_, nid)) = cibles.first() else { return false };
    let ok = M::ordre(g, code, &f.at("id"), &dict! {"ordre" => "blocus", "node" => nid}).0;
    if !ok {
        ai.cool.set(tup!["marine", nid], g.t + OUBLI);
    }
    ok
}
