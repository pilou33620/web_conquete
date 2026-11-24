//! L'IA des agents (SPEC-POLITIQUE, module 4), appelée à chaque pas de l'IA (AI::step) mais qui ne regarde que tous les
//! quinze jours : elle forme un agent quand elle en a les moyens (un espion d'abord en guerre, un prêtre si une place
//! s'agite, puis un gentilhomme et un diplomate ; deux au plus de chaque type), mène la meilleure mission possible là où
//! l'agent se tient, sinon l'envoie vers sa cible : espion vers la place forte ennemie que ses armées convoitent (ce que
//! faisait l'ancienne `espionage`), prêtre vers la place la plus agitée, gentilhomme vers une université, diplomate vers
//! la capitale d'un allié ou d'un voisin en paix. Léger : une recherche de chemin au plus par agent et par coup d'œil,
//! et les agents en poste n'en bougent plus.

use super::{AI, VALUE};
use crate::engine::agents as AG;
use crate::engine::Game;
use crate::py::{self, Val};
use crate::rules as R;
use crate::cities as CT;
use crate::tup;

const PAS: f64 = 15.0; // jours entre deux coups d'œil
const PAR_TYPE: i64 = 2; // agents de chaque type au plus
const OUBLI: f64 = 90.0; // jours avant de chercher de nouveau un chemin vers une cible injoignable

pub fn jouer(g: &mut Game, ai: &mut AI) {
    if ai.agents_clock > g.t {
        return;
    }
    ai.agents_clock = g.t + PAS;
    let code = ai.code.clone();
    let wars = ai.wars(g);
    recruter(g, &code, wars.truthy());
    for a in AG::agents_de(g, &code) {
        if g.agents.has(a.at("id")) && !a.atb("chemin") && !a.get("mission").is_dict() {
            agir(g, ai, &code, &a, &wars);
        }
    }
}

/// Un agent de plus, s'il y a de quoi le payer en gardant une réserve.
fn recruter(g: &mut Game, code: &str, guerre: bool) {
    let livres = g.factions.at(code).at("res").atf("livres");
    let agitee = g.owned_nodes(code).iter().any(|n| n.atf("stab") < 0.55);
    let mut ordre = vec![];
    if guerre {
        ordre.push("espion");
    }
    if agitee {
        ordre.push("pretre");
    }
    ordre.extend(["gentilhomme", "diplomate", "espion"]);
    for typ in ordre {
        if livres < R::AGENTS().at(typ).atf("cout") + 400.0 || AG::effectif(g, code, typ) >= PAR_TYPE {
            continue;
        }
        let ici = g.owned_nodes(code).iter().map(|n| n.ati("id")).find(|&nid| AG::peut_recruter(g, code, nid, &Val::from(typ)).0);
        if let Some(nid) = ici {
            AG::recruter(g, code, nid, &Val::from(typ));
            return;
        }
    }
}

/// La meilleure mission là où il est, sinon la route vers sa cible.
fn agir(g: &mut Game, ai: &mut AI, code: &str, a: &Val, wars: &Val) {
    let typ = a.ats("type");
    let poss = AG::possibles(g, a);
    let prefs: &[(&str, f64)] = match typ.as_str() {
        "espion" => &[("saboter_remparts", 0.3), ("saboter_armee", 0.3), ("espionner", 0.5), ("inciter", 0.4)],
        "gentilhomme" => &[("duel", 0.5), ("voler_tech", 0.35), ("universite", 0.0)],
        "pretre" => &[("denoncer", 0.4), ("apaiser", 0.0)],
        _ => &[("ambassade", 0.0)],
    };
    for (mi, seuil) in prefs {
        let choix = poss.iter().find(|(m, c, ch)| {
            m == mi && *ch >= *seuil
                && match *mi {
                    "espionner" => c.is_int() && !g.intel_active(code, c.i()),
                    "inciter" => wars.has(g.nodes.at(c).at("owner")),
                    "apaiser" => g.nodes.at(c).atf("stab") < 0.8,
                    _ => true,
                }
        });
        if let Some((m, c, _)) = choix {
            let (m, c) = (Val::from(m.as_str()), c.clone());
            AG::ordonner(g, code, &a.at("id"), &m, &c);
            return;
        }
    }
    // une cible injoignable (une autre partie du monde) n'est pas recherchée de nouveau avant OUBLI jours
    let oubli = |ai: &AI, nid: i64| Val::from(g.t) < ai.cool.get_or(tup!["agent", a.at("id"), nid], -1);
    let Some(nid) = cible(g, code, a, wars).into_iter().find(|&n| !oubli(ai, n)) else { return };
    if a.get("at_node") != nid && !AG::aller(g, a, nid).0 {
        ai.cool.set(tup!["agent", a.at("id"), nid], g.t + OUBLI);
    }
}

/// Où envoyer l'agent : ses cibles, la meilleure d'abord (aucune : il reste où il est).
fn cible(g: &Game, code: &str, a: &Val, wars: &Val) -> Vec<i64> {
    let (x, y) = (a.atf("x"), a.atf("y"));
    let d = |nid: i64| {
        let (nx, ny) = g.node_xy(nid);
        py::hypot(nx - x, ny - y)
    };
    let posts = |t: &str| -> Vec<Val> {
        g.agents.values().into_iter().filter(|b| b.get("mission").is_dict() && b.at("mission").at_is("type", t)).map(|b| b.at("mission").at("cible")).collect()
    };
    let par_distance = |mut l: Vec<i64>| {
        l.sort_by(|&p, &q| d(p).total_cmp(&d(q)));
        l
    };
    match a.ats("type").as_str() {
        "espion" => {
            if !wars.truthy() {
                return vec![];
            }
            // la place forte ennemie la plus précieuse près de nos armées (l'ancienne `espionage`)
            let mine: Vec<Val> = g.armies.values().into_iter().filter(|ar| ar.at_is("owner", code)).collect();
            let mut l: Vec<(f64, i64)> = vec![];
            for n in g.nodes.iter() {
                if !wars.has(n.at("owner")) || n.at("fort") < 2i64 {
                    continue;
                }
                let (nx, ny) = g.node_xy(n.ati("id"));
                let dm = py::min_f(mine.iter().map(|ar| py::hypot(ar.atf("x") - nx, ar.atf("y") - ny))).unwrap_or(999.0);
                if dm < 70.0 {
                    let val = (VALUE().at(g.geo.nodes.at(n.at("id")).at("type")) * n.at("fort")).f() / (dm + 10.0);
                    l.push((-val, n.ati("id")));
                }
            }
            l.sort_by(|p, q| p.0.total_cmp(&q.0));
            l.into_iter().map(|p| p.1).collect()
        }
        "gentilhomme" => {
            let pris = posts("universite");
            par_distance(g.owned_nodes(code).iter().filter(|n| CT::niveau(n, "universite") >= 1 && !pris.contains(&n.at("id"))).map(|n| n.ati("id")).collect())
        }
        "pretre" => {
            let pris = posts("apaiser");
            let mut l: Vec<Val> = g.owned_nodes(code).iter().filter(|n| n.atf("stab") < 0.6 && !pris.contains(&n.at("id"))).collect();
            l.sort_by(|p, q| p.atf("stab").total_cmp(&q.atf("stab")));
            l.into_iter().map(|n| n.ati("id")).collect()
        }
        _ => {
            // la capitale d'un allié d'abord, sinon d'un camp en paix, où nous n'avons pas encore de diplomate
            let mut l: Vec<(bool, i64)> = vec![];
            for (c, f) in g.factions.items() {
                let c = c.s();
                if c == code || !f.atb("alive") || g.at_war(code, c) || AG::diplomate_present(g, code, c) {
                    continue;
                }
                let cap = g.capital_of(c);
                if cap.is_some() && g.nodes.at(&cap).at_is("owner", c) {
                    l.push((g.status(code, c) != "alliance", cap.i()));
                }
            }
            l.sort_by(|p, q| p.0.cmp(&q.0).then(d(p.1).total_cmp(&d(q.1))));
            l.into_iter().map(|p| p.1).collect()
        }
    }
}
