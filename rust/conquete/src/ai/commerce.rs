//! L'IA du commerce maritime (SPEC-EMPIRE, module 7), appelée à chaque pas de l'IA mais qui ne regarde que tous les dix
//! jours : des flûtes vers les comptoirs libres du théâtre où elle a un port, des corsaires contre un rival quand elle
//! n'ose pas la guerre (rare), et sur la carte monde, de temps en temps, une flotte (et une petite armée) vers une colonie
//! en guerre, par l'ordre « route » ; à l'arrivée, l'armée gagne le port ami le plus proche et débarque. Les accords
//! commerciaux, eux, viennent de la diplomatie des IA (gouvernement.rs) : chaque accord fait sa route.
//! Peu coûteuse : quelques boucles sur ses flottes et sur les comptoirs, une recherche de chemin au plus par ordre donné,
//! et une destination injoignable n'est pas recherchée de nouveau avant trois mois. Son hasard lui est propre (graine de
//! la partie, du camp et du jour) : il ne dérange pas celui des autres décisions.

use super::AI;
use crate::engine::commerce as C;
use crate::engine::marine as M;
use crate::engine::Game;
use crate::geo::VERSION_MONDE;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::{dict, list, tup};

const PAS: f64 = 10.0; // jours entre deux coups d'œil
const OUBLI: f64 = 90.0; // jours avant de rechercher un chemin vers une destination injoignable
const CORSAIRE_JOURS: f64 = 180.0; // durée d'une campagne de course
const EXPEDITION_JOURS: f64 = 360.0; // au plus une expédition par an

pub fn jouer(g: &mut Game, ai: &mut AI) {
    if ai.commerce_clock > g.t {
        return;
    }
    ai.commerce_clock = g.t + PAS;
    let code = ai.code.clone();
    let mut rng = Random::new_str(&format!("{}-ia-commerce-{code}-{}", g.seed, py::int(g.t)));
    for f in mes_flottes(g, &code) {
        debarquer(g, ai, &code, &f);
    }
    marchands(g, ai, &code);
    corsaires(g, ai, &code, &mut rng);
    expedition(g, ai, &code, &mut rng);
}

fn mes_flottes(g: &Game, code: &str) -> Vec<Val> {
    g.flottes.values().into_iter().filter(|f| f.at("owner") == code && !f.getb("bataille")).collect()
}

fn refroidi(ai: &AI, g: &Game, k: &Val) -> bool {
    ai.cool.get_or(k, 0.0).f() > g.t
}

/// Une flotte arrivée avec une armée à bord : au port ami le plus proche de son théâtre, puis l'armée débarque.
fn debarquer(g: &mut Game, ai: &mut AI, code: &str, f: &Val) {
    if !M::armee_a_bord(f).truthy() || f.atb("chemin") || f.get("ordre") == "route" {
        return;
    }
    let fid = f.at("id");
    if f.get("a_quai").is_some() {
        M::debarquer(g, code, &fid, &Val::None, &Val::None);
        return;
    }
    let t = g.geo.theatre_case(f.atf("x") + 0.5, f.atf("y") + 0.5);
    let mut best: Option<(f64, i64)> = None;
    for n in g.nodes.iter() {
        let nid = n.ati("id");
        if !g.friendly(code, n.at("owner").s()) || g.geo.theatre_de(nid) != t || refroidi(ai, g, &tup!["marine", nid]) {
            continue;
        }
        if let Some((cx, cy)) = M::case_port(&g.geo, nid) {
            let d = M::dist(f, cx as f64 + 0.5, cy as f64 + 0.5);
            if best.is_none_or(|b| d < b.0) {
                best = Some((d, nid));
            }
        }
    }
    match best {
        Some((_, nid)) => {
            if !M::deplacer(g, code, &fid, &Val::from(nid), &Val::None, &Val::None).0 {
                ai.cool.set(tup!["marine", nid], g.t + OUBLI);
            }
        }
        None => {
            M::debarquer(g, code, &fid, &Val::None, &Val::None); // (aucun port ami : sur la côte, si elle est proche)
        }
    }
}

/// Un comptoir où il reste une place (marchands installés ou en route).
fn libre(g: &Game, cp: &Val) -> bool {
    let n = g.flottes.values().iter().filter(|f| f.get("ordre") == "commerce" && f.get("cible") == cp.at("id")).count() as i64;
    n < cp.ati("places")
}

/// Les marchands : flûtes séparées de la flotte de guerre où le chantier les a mises, envoyées au comptoir libre le plus
/// proche de leur théâtre ; une flûte de plus en chantier quand un comptoir libre attend et que l'argent dort.
fn marchands(g: &mut Game, ai: &mut AI, code: &str) {
    let comptoirs = g.commerce.get_or("comptoirs", list![]); // (faits au premier mois sur un théâtre : commerce::mois)
    if !comptoirs.truthy() {
        return;
    }
    for f in mes_flottes(g, code) {
        let fl = f.at("navires").get_or("flute", 0).i();
        if fl > 0 && C::de_guerre(&f) && f.get("a_quai").is_some() && f.get("ordre") == "" && !M::armee_a_bord(&f).truthy() {
            M::separer(g, code, &f.at("id"), &dict! {"flute" => fl});
        }
    }
    let marchands: Vec<Val> = mes_flottes(g, code).into_iter().filter(|f| !C::de_guerre(f) && f.at("navires").has("flute")).collect();
    for f in &marchands {
        if f.get("ordre") == "commerce" || f.atb("chemin") || M::armee_a_bord(f).truthy() {
            continue;
        }
        let t = g.geo.theatre_case(f.atf("x") + 0.5, f.atf("y") + 0.5);
        let mut cands: Vec<(f64, Val)> = comptoirs
            .iter()
            .filter(|cp| t == Some(cp.ats("theatre").as_str()) && libre(g, cp) && !refroidi(ai, g, &tup!["comptoir", cp.at("id")]))
            .map(|cp| (M::dist(f, cp.atf("x") + 0.5, cp.atf("y") + 0.5), cp))
            .collect();
        cands.sort_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((_, cp)) = cands.first() {
            if !M::ordre(g, code, &f.at("id"), &dict! {"ordre" => "commerce", "cible" => cp.at("id")}).0 {
                ai.cool.set(tup!["comptoir", cp.at("id")], g.t + OUBLI);
            }
        }
    }
    // une flûte de plus : dans le port (de mer, avec un port de commerce) d'un théâtre où un comptoir est libre
    let ports: Vec<i64> = g
        .owned_nodes(code)
        .iter()
        .map(|n| n.ati("id"))
        .filter(|&nid| M::niveau_port(g, nid) > 0 && !g.nodes.at(nid).atb("siege"))
        .collect();
    let en_chantier = ports.iter().any(|&nid| g.nodes.at(nid).at("queue").iter().any(|q| q.at("kind") == "navire" && q.at("what") == "flute"));
    let voulu = (1 + ports.len() / 8).min(3);
    if en_chantier || marchands.len() >= voulu || ai.idle_money(g) < 2.0 * R::NAVIRES().at("flute").at("cout").atf("livres") {
        return;
    }
    let port = ports.iter().copied().find(|&nid| {
        let t = g.geo.theatre_de(nid);
        g.nodes.at(nid).at("queue").len() < 2 && comptoirs.iter().any(|cp| t == Some(cp.ats("theatre").as_str()) && libre(g, &cp))
    });
    if let Some(nid) = port {
        if M::peut_construire(g, code, nid, &Val::from("flute")).0 {
            M::construire(g, code, nid, &Val::from("flute"));
        }
    }
}

/// Une route commerciale de ce camp (avec un chemin) dans le théâtre t : son milieu, ou None.
fn route_de(g: &Game, camp: &str, t: Option<&'static str>) -> Option<(i64, i64)> {
    let routes = g.commerce.get_or("routes", dict! {});
    for r in routes.values() {
        if r.at("de").is_none() || (r.at("proprio") != camp && r.at("partenaire") != camp) {
            continue;
        }
        let ch = r.at("chemin");
        let m = ch.at(ch.len() as i64 / 2);
        let (x, y) = (m.at(0).i(), m.at(1).i());
        if g.geo.theatre_case(x as f64 + 0.5, y as f64 + 0.5) == t {
            return Some((x, y));
        }
    }
    None
}

/// Les corsaires : la course finit à la guerre, quand la relation remonte ou au bout de six mois ; en course, la flotte
/// va sur une route de la cible. Rarement, un camp en paix avec tous arme une flotte libre contre son pire rival.
fn corsaires(g: &mut Game, ai: &mut AI, code: &str, rng: &mut Random) {
    let rel = g.factions.at(code).at("rel");
    for f in mes_flottes(g, code) {
        if f.get("ordre") != "corsaire" {
            continue;
        }
        let cible = f.ats("cible");
        let vivant = g.factions.has(cible.as_str()) && g.factions.at(cible.as_str()).atb("alive");
        if !vivant || g.at_war(code, &cible) || rel.get_or(cible.as_str(), 0).f() >= 0.0 || f.get_or("jusqua", 0.0).f() < g.t {
            f.update(&dict! {"ordre" => "", "cible" => Val::None});
            f.pop("jusqua");
            continue;
        }
        if !f.atb("chemin") && C::coupure_par(g, &f).is_none() {
            let t = g.geo.theatre_case(f.atf("x") + 0.5, f.atf("y") + 0.5);
            if let Some((x, y)) = route_de(g, &cible, t) {
                M::deplacer(g, code, &f.at("id"), &Val::None, &Val::from(x as f64 + 0.5), &Val::from(y as f64 + 0.5));
            }
        }
    }
    if ai.wars(g).truthy() || g.factions.at(code).at("overlord").truthy() || rng.random() >= 0.05 {
        return;
    }
    let Some(f) = mes_flottes(g, code).into_iter().find(|f| {
        C::de_guerre(f) && f.get("a_quai").is_some() && f.get("ordre") == "" && !f.atb("chemin") && !M::armee_a_bord(f).truthy()
    }) else {
        return;
    };
    let t = g.geo.theatre_case(f.atf("x") + 0.5, f.atf("y") + 0.5);
    let truce = g.factions.at(code).at("truce");
    let mut rivaux: Vec<(f64, String, (i64, i64))> = vec![];
    for (o, of) in g.factions.items() {
        let r = rel.get_or(&o, 0).f();
        if o == code || !of.atb("alive") || r >= -25.0 || truce.has(&o) || g.friendly(code, o.s()) {
            continue;
        }
        if let Some(m) = route_de(g, o.s(), t) {
            rivaux.push((r, o.string(), m));
        }
    }
    rivaux.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let Some((_, o, (x, y))) = rivaux.into_iter().next() else { return };
    if M::ordre(g, code, &f.at("id"), &dict! {"ordre" => "corsaire", "cible" => &o}).0 {
        f.set("jusqua", g.t + CORSAIRE_JOURS);
        M::deplacer(g, code, &f.at("id"), &Val::None, &Val::from(x as f64 + 0.5), &Val::from(y as f64 + 0.5));
    }
}

/// (carte monde) Une grande puissance d'Europe dont une colonie est en guerre y envoie de temps en temps une flotte de
/// guerre, avec l'armée qui attend au port si elle tient à bord.
fn expedition(g: &mut Game, ai: &mut AI, code: &str, rng: &mut Random) {
    if g.geo.version != VERSION_MONDE || refroidi(ai, g, &tup!["expedition", code]) {
        return;
    }
    let col = R::COLONIES.iter().map(|x| x.0).find(|&c| {
        g.factions.has(c) && g.factions.at(c).atb("alive") && g.factions.at(c).at("overlord") == code
            && g.factions.keys().iter().any(|x| g.at_war(c, x.s()))
    });
    let Some(col) = col else { return };
    if C::en_mer(g).iter().any(|f| f.at("owner") == code) || rng.random() >= 0.25 {
        return;
    }
    let Some(t) = R::theatre_du_pays(col) else { return };
    let rid = format!("europe-{t}");
    if crate::geo::route_mer(&g.geo, &rid).is_none() {
        return;
    }
    let Some(f) = mes_flottes(g, code).into_iter().find(|f| {
        let q = f.get("a_quai");
        C::de_guerre(f) && q.is_some() && f.get("ordre") == "" && !M::armee_a_bord(f).truthy() && g.geo.theatre_de(q.i()) == Some("europe")
    }) else {
        return;
    };
    let fid = f.at("id");
    let cap = M::capacite(&f);
    let a = g.armies.values().into_iter().find(|a| {
        let men = M::effectif(a);
        a.at("owner") == code && a.at("at_node") == f.at("a_quai") && a.at("state") == "idle" && !a.atb("battle") && men > 0.0 && men <= cap
    });
    if let Some(a) = a {
        M::embarquer(g, code, &fid, &a.at("id"));
    }
    ai.cool.set(tup!["expedition", code], g.t + EXPEDITION_JOURS);
    M::ordre(g, code, &fid, &dict! {"ordre" => "route", "route" => rid});
}
