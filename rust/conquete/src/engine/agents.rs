//! Les agents sur la carte (SPEC-POLITIQUE, module 4) : espion, gentilhomme, prêtre, diplomate. Recrutement dans la file
//! d'une place (kind agent) selon ses bâtiments, avec un plafond par camp ; mouvement par la route, plus vite qu'une armée,
//! jusque dans les places étrangères ; espion caché, vu seulement de près ; missions à la chance calculée d'avance ;
//! expérience, niveaux et traits ; commandes du joueur et vue pour la page.
//!
//! `g.agents` : {id: agent}, un agent étant dict(id, owner, type ("espion" | "gentilhomme" | "pretre" | "diplomate"), nom,
//! x, y (sa position), at_node (la place où il se tient, ou None en chemin), de (la dernière place quittée), dest (la place
//! visée, ou None), chemin ([nid…] : les places qui restent, sans celle où il est), prog (avance sur le tronçon en cours),
//! mp (jours de route qui restent ce tour, tour par tour ; None : tout le tour), xp, niveau (1 à 5), traits ([clé de
//! R::AGENT_TRAITS()…]), mission (None, ou dict(type, cible, tours, chance) : une mission en poste ; les autres se jouent
//! sur-le-champ), cache (bool), repos (jour avant lequel il ne mène pas d'autre mission)), sauvegardé.
//!
//! Une mission se donne à un agent arrêté dans une place : la cible est cette place (numéro), une armée à moins de
//! AGENT_PORTEE (identifiant « a… ») ou un agent à moins de AGENT_PORTEE (identifiant « ag… »). Une mission par tour.

use super::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Les types de cible d'une mission : « place », « armee », « agent ».
fn genre_cible(g: &Game, cible: &Val) -> Option<&'static str> {
    if cible.is_int() {
        return g.valid_node(cible).then_some("place");
    }
    if !cible.is_str() {
        return None;
    }
    if g.agents.has(cible) {
        Some("agent")
    } else if g.armies.has(cible) {
        Some("armee")
    } else {
        None
    }
}

/// Les agents du camp.
pub fn agents_de(g: &Game, code: &str) -> Vec<Val> {
    g.agents.values().into_iter().filter(|a| a.at_is("owner", code)).collect()
}

fn niveau_de(xp: i64) -> i64 {
    R::AGENT_XP.iter().filter(|&&x| xp >= x).count() as i64
}

fn xy(a: &Val) -> (f64, f64) {
    (a.atf("x"), a.atf("y"))
}

fn dist(a: &Val, x: f64, y: f64) -> f64 {
    py::hypot(a.atf("x") - x, a.atf("y") - y)
}

/// Un diplomate du camp `code` est-il en ambassade chez `chez` (dans une place que ce camp tient) ? Pour R9 : un bonus
/// d'acceptation des propositions.
pub fn diplomate_present(g: &Game, code: &str, chez: &str) -> bool {
    g.agents.values().iter().any(|a| {
        a.at_is("owner", code) && a.at_is("type", "diplomate") && a.get("mission").is_dict() && a.at("mission").at_is("type", "ambassade")
            && g.nodes.at(a.at("mission").at("cible")).at_is("owner", chez)
    })
}

// ================================================================== recrutement
/// La place a-t-elle un bâtiment qui forme ce type d'agent (au niveau voulu ; « capitale » : la capitale du camp) ?
fn forme_ici(g: &Game, code: &str, nid: i64, typ: &str, lvl_min: i64) -> bool {
    let n = g.nodes.at(nid);
    R::AGENTS().at(typ).at("batiments").iter().any(|b| {
        let (ch, lvl) = b.pair();
        if ch == "capitale" {
            lvl_min <= 1 && g.capital_of(code) == nid
        } else {
            CT::niveau(&n, ch.s()) >= lvl.i().max(lvl_min)
        }
    })
}

/// Plafond du camp pour ce type : 1, plus 1 par place qui a un des bâtiments du type au niveau 2 ou plus.
pub fn plafond(g: &Game, code: &str, typ: &str) -> i64 {
    let max = R::AGENTS().at(typ).ati("plafond");
    let n = g.owned_nodes(code).iter().filter(|n| forme_ici(g, code, n.ati("id"), typ, 2)).count() as i64;
    (1 + n).min(max)
}

/// Agents du camp de ce type, en service et en formation.
pub fn effectif(g: &Game, code: &str, typ: &str) -> i64 {
    let actifs = g.agents.values().iter().filter(|a| a.at_is("owner", code) && a.at_is("type", typ)).count();
    let files: usize = g.owned_nodes(code).iter().map(|n| n.at("queue").iter().filter(|q| q.at_is("kind", "agent") && q.at_is("what", typ)).count()).sum();
    (actifs + files) as i64
}

pub fn peut_recruter(g: &Game, code: &str, nid: i64, typ: &Val) -> (bool, String) {
    let n = g.nodes.at(nid);
    if n.at("owner") != code {
        return (false, "Cette place ne vous appartient pas.".to_string());
    }
    let ag = if typ.is_str() { R::AGENTS().get(typ) } else { Val::None };
    if !ag.truthy() {
        return (false, "Agent inconnu.".to_string());
    }
    let typ = typ.s();
    if !forme_ici(g, code, nid, typ, 1) {
        let noms: Vec<String> = ag.at("batiments").iter().map(|b| {
            let (ch, lvl) = b.pair();
            if ch == "capitale" { "votre capitale".to_string() } else { CT::level_name(g, nid, ch.s(), lvl.i()).to_lowercase() }
        }).collect();
        return (false, format!("Il faut dans la place : {}.", noms.join(" ou ")));
    }
    let pl = plafond(g, code, typ);
    if effectif(g, code, typ) >= pl {
        return (false, format!("Plafond atteint ({pl}) : bâtissez d'autres {} de niveau 2 pour en avoir plus.",
            if typ == "diplomate" { "comptoirs" } else { "bâtiments" }));
    }
    if n.atb("siege") {
        return (false, "La place est assiégée.".to_string());
    }
    if n.at("queue").len() >= 4 {
        return (false, "File de production pleine (4 maximum).".to_string());
    }
    if !g.can_pay(code, &dict! {"livres" => ag.at("cout")}) {
        return (false, "Livres insuffisantes.".to_string());
    }
    (true, String::new())
}

/// Commande « recruter » : l'agent entre dans la file de la place (kind agent), payé tout de suite.
pub fn recruter(g: &mut Game, code: &str, nid: i64, typ: &Val) -> (bool, String) {
    let (ok, why) = peut_recruter(g, code, nid, typ);
    if !ok {
        return (false, why);
    }
    let ag = R::AGENTS().at(typ);
    g.pay(code, &dict! {"livres" => ag.at("cout")});
    let jours = ag.atf("jours");
    g.nodes.at(nid).at("queue").push(dict! {"kind" => "agent", "what" => typ, "left" => jours, "total" => jours});
    (true, format!("{} en formation à {}.", ag.at("nom"), g.geo.nodes.at(nid).at("name")))
}

/// Un agent neuf du camp dans la place (fin de formation, ou les essais).
pub fn nouvel_agent(g: &mut Game, owner: &str, typ: &str, nid: i64) -> Val {
    let id = g.nid("ag");
    let nom = format!("{} {}", g.rng.choice(&R::prenoms(owner).vec()), g.rng.choice(&R::surnames(owner).vec()));
    let (x, y) = g.node_xy(nid);
    let a = dict! {"id" => &id, "owner" => owner, "type" => typ, "nom" => nom, "x" => x, "y" => y, "at_node" => nid, "de" => nid,
                   "dest" => Val::None, "chemin" => list![], "prog" => 0.0, "xp" => 0, "niveau" => 1, "traits" => list![],
                   "mission" => Val::None, "cache" => R::AGENTS().at(typ).atb("cache"), "repos" => 0.0};
    g.agents.set(&id, &a);
    a
}

/// Fin de formation (Game::update_queues, kind agent).
pub fn former(g: &mut Game, n: &Val, q: &Val) {
    let (owner, nid, typ) = (n.ats("owner"), n.ati("id"), q.ats("what"));
    let a = nouvel_agent(g, &owner, &typ, nid);
    if owner == g.player {
        let gn = g.geo.nodes.at(nid);
        let t = format!("{} formé à {} : {}.", R::AGENTS().at(&typ).at("nom"), gn.at("name"), a.at("nom"));
        g.log("espion", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y")});
    }
}

/// Entretien des agents d'un camp (livres par mois).
pub fn entretien(g: &Game, code: &str) -> f64 {
    agents_de(g, code).iter().map(|a| R::AGENTS().at(a.at("type")).atf("entretien")).sum()
}

// ================================================================== mouvement
/// Le plus court chemin par les routes et les voies d'eau, de place en place (sans celle de départ) ; None : aucun.
fn chemin(g: &Game, de: i64, vers: i64) -> Option<Vec<i64>> {
    let fixe = g.geo_fixe();
    let n = fixe.xy.len();
    let (mut d, mut prev) = (vec![f64::INFINITY; n], vec![usize::MAX; n]);
    let mut tas = BinaryHeap::new();
    d[de as usize] = 0.0;
    tas.push(Reverse((0u64, de as usize)));
    while let Some(Reverse((db, u))) = tas.pop() {
        let du = f64::from_bits(db); // (un flottant positif garde son ordre dans ses bits)
        if du > d[u] {
            continue;
        }
        if u == vers as usize {
            let mut out = vec![];
            let mut c = u;
            while c != de as usize {
                out.push(c as i64);
                c = prev[c];
            }
            out.reverse();
            return Some(out);
        }
        for eid in g.geo.adj.at(u as i64).iter() {
            let (a, b, _) = fixe.aretes[eid.u()];
            let v = if a == u { b } else { a };
            let nd = du + g.geo.edges.at(&eid).atf("len").max(0.1);
            if nd < d[v] {
                d[v] = nd;
                prev[v] = u;
                tas.push(Reverse((nd.to_bits(), v)));
            }
        }
    }
    None
}

/// Longueur du tronçon entre deux places voisines (à vol d'oiseau s'il n'y en a pas).
fn longueur(g: &Game, a: i64, b: i64) -> f64 {
    let e = g.edge_between(a, b);
    if e.is_some() {
        return e.atf("len").max(0.1);
    }
    let ((ax, ay), (bx, by)) = (g.node_xy(a), g.node_xy(b));
    py::hypot(ax - bx, ay - by).max(0.1)
}

/// Tour par tour, pendant le tour des IA : les agents du joueur ont déjà joué.
fn en_pause(g: &Game, a: &Val) -> bool {
    a.at("owner") == g.player && g.tour.atb("on") && g.tour.at("end").is_some()
}

/// Jours de route qui restent ce tour à un agent du joueur.
pub fn jours_restants(g: &Game, a: &Val) -> f64 {
    let mp = a.get("mp");
    if mp.is_none() { TT::march_days(g) } else { mp.f().max(0.0) }
}

/// Avance l'agent le long de son chemin pendant `jours` jours. Rend les jours employés.
pub fn avancer(g: &mut Game, a: &Val, jours: f64) -> f64 {
    if !a.atb("chemin") {
        return 0.0;
    }
    let mut reste = a.get_or("prog", 0.0).f() + jours * R::AGENT_VITESSE;
    let mut fait = 0.0;
    a.set("at_node", Val::None);
    while a.atb("chemin") {
        let (de, vers) = (a.ati("de"), a.at("chemin").ati(0));
        let l = longueur(g, de, vers);
        let ((x0, y0), (x1, y1)) = (g.node_xy(de), g.node_xy(vers));
        if reste < l {
            let k = reste / l;
            a.set("x", py::round_n(x0 + (x1 - x0) * k, 3));
            a.set("y", py::round_n(y0 + (y1 - y0) * k, 3));
            a.set("prog", py::round_n(reste, 3));
            return jours;
        }
        reste -= l;
        fait += l;
        a.at("chemin").pop(0);
        a.set("de", vers);
        a.set("x", x1);
        a.set("y", y1);
    }
    a.set("prog", 0.0);
    a.set("at_node", a.at("de"));
    a.set("dest", Val::None);
    jours.min(fait / R::AGENT_VITESSE)
}

/// Pendant le tour du joueur : son agent part tout de suite, dans la limite de ses jours de route.
fn partir(g: &mut Game, a: &Val) {
    if !TT::planning(g) || a.at("owner") != g.player {
        return;
    }
    let mp = jours_restants(g, a);
    let used = avancer(g, a, mp);
    a.set("mp", py::round_n((mp - used).max(0.0), 3));
}

/// Un agent du camp, ou l'erreur à rendre au joueur.
fn a_moi(g: &Game, code: &str, id: &Val) -> Result<Val, (bool, String)> {
    let a = if id.is_str() { g.agents.get(id) } else { Val::None };
    if !a.truthy() || a.at("owner") != code {
        return Err((false, "Agent introuvable.".to_string()));
    }
    Ok(a)
}

/// Ordre de route vers une place (le poste qu'il tenait est quitté). Pour la commande et pour l'IA.
pub fn aller(g: &mut Game, a: &Val, vers: i64) -> (bool, String) {
    // en chemin, on finit le tronçon commencé avant de prendre la nouvelle route
    let depart = if a.atb("chemin") && a.atf("prog") > 0.0 { a.at("chemin").ati(0) } else { a.ati("de") };
    let Some(mut ch) = chemin(g, depart, vers) else {
        return (false, "Aucune route ne mène là.".to_string());
    };
    if depart != a.ati("de") {
        ch.insert(0, depart);
    } else {
        a.set("prog", 0.0);
    }
    a.set("chemin", ch.into_iter().map(Val::from).collect::<Val>());
    a.set("mission", Val::None);
    if !a.atb("chemin") {
        a.set("at_node", vers);
        a.set("dest", Val::None);
        return (true, "L'agent est déjà sur place.".to_string());
    }
    a.set("dest", vers);
    if TT::planning(g) && a.at("owner") == g.player && jours_restants(g, a) <= 1e-6 {
        return (true, "Route tracée : l'agent partira au prochain tour.".to_string());
    }
    partir(g, a);
    if a.atb("chemin") { (true, "L'agent fait route ; il arrivera dans un prochain tour.".to_string()) } else { (true, "L'agent est arrivé.".to_string()) }
}

/// Commande « deplacer » {agent, node}.
pub fn deplacer(g: &mut Game, code: &str, id: &Val, node: &Val) -> (bool, String) {
    let a = match a_moi(g, code, id) {
        Ok(a) => a,
        Err(e) => return e,
    };
    if !g.valid_node(node) {
        return (false, "Lieu inconnu.".to_string());
    }
    aller(g, &a, node.i())
}

/// Commande « annuler » {agent} : quitte son poste, ou s'arrête à la prochaine place.
pub fn annuler(g: &mut Game, code: &str, id: &Val) -> (bool, String) {
    let a = match a_moi(g, code, id) {
        Ok(a) => a,
        Err(e) => return e,
    };
    if a.get("mission").is_dict() {
        a.set("mission", Val::None);
        return (true, "L'agent quitte son poste.".to_string());
    }
    if a.atb("chemin") {
        let ch = a.at("chemin");
        let reste = if a.atf("prog") > 0.0 { list![ch.at(0)] } else { list![] };
        a.set("chemin", &reste);
        if !reste.truthy() {
            a.set("at_node", a.at("de"));
        }
        a.set("dest", if reste.truthy() { reste.at(0) } else { Val::None });
        return (true, "L'agent s'arrête à la prochaine place.".to_string());
    }
    (false, "L'agent n'a ni poste ni route à quitter.".to_string())
}

// ================================================================== détection
fn cavalier(a: &Val) -> bool {
    a.at("regs").iter().any(|r| R::UNITS().at(r.at("type")).at_is("cls", "cavalerie"))
}

/// Le camp `par` voit-il cet agent caché ? Dans une de ses places fortes (remparts 2 ou plus), ou à moins de
/// AGENT_DETECTE d'un de ses espions, gentilshommes ou cavaliers. Un agent qui n'est pas caché : toujours.
pub fn detecte(g: &Game, a: &Val, par: &str) -> bool {
    if !a.getb("cache") || a.at_is("owner", par) {
        return true;
    }
    let n = a.get("at_node");
    if n.is_some() && g.nodes.at(&n).at_is("owner", par) && g.nodes.at(&n).at("fort") >= 2i64 {
        return true;
    }
    let (x, y) = xy(a);
    g.agents.values().iter().any(|b| b.at_is("owner", par) && (b.at_is("type", "espion") || b.at_is("type", "gentilhomme")) && dist(b, x, y) <= R::AGENT_DETECTE)
        || g.armies.values().iter().any(|ar| ar.at_is("owner", par) && dist(ar, x, y) <= R::AGENT_DETECTE && cavalier(ar))
}

// ================================================================== missions
/// La chance de réussite de la mission (1 pour un poste), ou pourquoi elle est impossible ; avec le camp visé (None : une
/// place neutre).
pub fn verifier(g: &Game, a: &Val, mission: &Val, cible: &Val) -> Result<(f64, Option<String>), String> {
    let m = if mission.is_str() { R::MISSIONS().get(mission) } else { Val::None };
    if !m.truthy() {
        return Err("Mission inconnue.".to_string());
    }
    let mi = mission.s();
    if m.at("agent") != a.at("type") {
        return Err("Cet agent ne mène pas cette mission.".to_string());
    }
    if a.atb("chemin") {
        return Err("L'agent est en route.".to_string());
    }
    if a.get_or("repos", 0.0).f() > g.t {
        return Err("L'agent se remet de sa dernière mission : il agira au prochain tour.".to_string());
    }
    let ici = a.get("at_node");
    if ici.is_none() {
        return Err("L'agent doit se tenir dans une place.".to_string());
    }
    let code = a.ats("owner");
    let genre = genre_cible(g, cible).ok_or_else(|| "Cible inconnue.".to_string())?;
    if !m.ats("cible").split('|').any(|c| c == genre) {
        return Err("Cette mission ne vise pas cette cible.".to_string());
    }
    let (x, y) = xy(a);
    let n = g.nodes.at(&ici);
    let (o, cn) = match genre {
        "place" => {
            if *cible != ici {
                return Err("L'agent doit être dans la place visée.".to_string());
            }
            (n.ats("owner"), n.clone())
        }
        "armee" => {
            let ar = g.armies.at(cible);
            if dist(&ar, x, y) > R::AGENT_PORTEE {
                return Err("L'armée est trop loin de l'agent.".to_string());
            }
            (ar.ats("owner"), n.clone())
        }
        _ => {
            let b = g.agents.at(cible);
            if b.at("id") == a.at("id") || dist(&b, x, y) > R::AGENT_PORTEE {
                return Err("L'agent visé est trop loin.".to_string());
            }
            if !detecte(g, &b, &code) {
                return Err("Cet agent se cache : il faut d'abord le démasquer.".to_string());
            }
            (b.ats("owner"), n.clone())
        }
    };
    let camp = (o != R::NEUTRAL).then(|| o.clone());
    if m.getb("chez_soi") && n.at("owner") != code.as_str() {
        return Err("Seulement dans une de vos places.".to_string());
    }
    if (m.getb("etranger") || genre != "place") && o == code {
        return Err("La cible est à vous.".to_string());
    }
    if m.getb("guerre") && !camp.as_ref().is_some_and(|c| g.at_war(&code, c)) {
        return Err("Seulement contre un camp avec lequel vous êtes en guerre.".to_string());
    }
    let poste = |t: &str| g.agents.values().iter().any(|b| b.at("id") != a.at("id") && b.get("mission").is_dict() && b.at("mission").at_is("type", t) && b.at("mission").at("cible") == *cible);
    match mi {
        "saboter_remparts" if cn.at("fort") <= 0i64 => return Err("Cette place n'a pas de remparts à saboter.".to_string()),
        "inciter" if camp.is_none() => return Err("Une place neutre n'a pas d'autorités à chasser.".to_string()),
        "assassiner" if genre == "armee" && !(g.armies.at(cible).getb("gen") && !g.armies.at(cible).at("gen").getb("interim")) => {
            return Err("Cette armée n'a pas de général à abattre.".to_string());
        }
        "duel" if !g.agents.at(cible).at_is("type", "gentilhomme") => return Err("On ne se bat en duel qu'entre gentilshommes.".to_string()),
        "universite" | "voler_tech" if CT::niveau(&cn, "universite") < 1 => return Err("Il faut un collège ou mieux dans la ville.".to_string()),
        "universite" if poste("universite") => return Err("Un gentilhomme y est déjà en poste.".to_string()),
        "voler_tech" if camp.is_none() || techs_a_voler(g, &code, &o).is_empty() => return Err("Rien à apprendre ici.".to_string()),
        "apaiser" if poste("apaiser") => return Err("Un prêtre y est déjà en poste.".to_string()),
        "ambassade" => {
            if camp.is_none() || !g.geo.nodes.at(&ici).at_is("type", "capitale") {
                return Err("Une ambassade se tient dans la capitale d'un autre camp.".to_string());
            }
            if g.at_war(&code, &o) {
                return Err("Pas d'ambassade chez un ennemi.".to_string());
            }
            if diplomate_present(g, &code, &o) {
                return Err("Vous avez déjà un diplomate chez ce camp.".to_string());
            }
        }
        _ => {}
    }
    if m.getb("poste") {
        return Ok((1.0, camp));
    }
    // chance = base + niveau + traits − défense de la cible
    let mut c = m.atf("base") + R::AGENT_NIVEAU * (a.ati("niveau") - 1) as f64 + bonus_traits(a, mi);
    if g.factions.at(&code).at("techs").has("diplomates") {
        c += 0.1;
    }
    if let Some(o) = &camp {
        if genre == "place" && g.factions.has(o.as_str()) && g.factions.at(o.as_str()).at("techs").has("chappe") {
            c -= 0.15;
        }
        // contre-espionnage : les espions, gentilshommes et prêtres du camp visé dans la place
        let gardes = g.agents.values().iter().filter(|b| b.at_is("owner", o.as_str()) && b.at("at_node") == ici && !b.at_is("type", "diplomate")).count();
        c -= (0.05 * gardes as f64).min(0.15);
    }
    match genre {
        "place" => c -= 0.03 * cn.atf("fort"),
        "armee" if cavalier(&g.armies.at(cible)) => c -= 0.05,
        "agent" => {
            let b = g.agents.at(cible);
            c -= R::AGENT_NIVEAU * (b.ati("niveau") - 1) as f64 + if mi == "duel" { bonus_traits(&b, "duel") } else { 0.0 };
        }
        _ => {}
    }
    Ok((py::round_n(c.clamp(0.05, 0.95), 2), camp))
}

fn bonus_traits(a: &Val, mission: &str) -> f64 {
    a.at("traits").iter().map(|t| {
        let fx = R::AGENT_TRAITS().at(&t).at("fx");
        fx.get_or(mission, 0.0).f() + fx.get_or("*", 0.0).f()
    }).sum()
}

/// Les découvertes du camp `o` que `code` n'a pas mais pourrait chercher (prérequis connus).
fn techs_a_voler(g: &Game, code: &str, o: &str) -> Vec<Val> {
    let (mine, siennes) = (g.factions.at(code).at("techs"), g.factions.at(o).at("techs"));
    siennes.iter().filter(|t| !mine.has(t) && R::TECH().at(t).at("req").iter().all(|r| mine.has(&r))).collect()
}

/// Les missions que l'agent peut mener là où il est : (mission, cible, chance). Pour la page et pour l'IA.
pub fn possibles(g: &Game, a: &Val) -> Vec<(String, Val, f64)> {
    let ici = a.get("at_node");
    if ici.is_none() || a.atb("chemin") || a.get_or("repos", 0.0).f() > g.t {
        return vec![];
    }
    let (x, y) = xy(a);
    let mut cibles = vec![ici.clone()];
    cibles.extend(g.armies.values().into_iter().filter(|ar| ar.at("owner") != a.at("owner") && dist(ar, x, y) <= R::AGENT_PORTEE).map(|ar| ar.at("id")));
    cibles.extend(g.agents.values().into_iter().filter(|b| b.at("owner") != a.at("owner") && dist(b, x, y) <= R::AGENT_PORTEE).map(|b| b.at("id")));
    let mut out = vec![];
    for (mi, m) in R::MISSIONS().items() {
        if m.at("agent") != a.at("type") {
            continue;
        }
        for c in &cibles {
            if let Ok((ch, _)) = verifier(g, a, &mi, c) {
                out.push((mi.string(), c.clone(), ch));
            }
        }
    }
    out
}

/// Commande « mission » {agent, mission, cible} : un poste commence, une autre mission se joue sur-le-champ.
pub fn ordonner(g: &mut Game, code: &str, id: &Val, mission: &Val, cible: &Val) -> (bool, String) {
    let a = match a_moi(g, code, id) {
        Ok(a) => a,
        Err(e) => return e,
    };
    let (chance, camp) = match verifier(g, &a, mission, cible) {
        Ok(r) => r,
        Err(e) => return (false, e),
    };
    let mi = mission.string();
    let m = R::MISSIONS().at(&mi);
    if m.getb("poste") {
        a.set("mission", dict! {"type" => &mi, "cible" => cible, "tours" => 0, "chance" => 1.0});
        let lieu = g.geo.nodes.at(a.at("at_node")).ats("name");
        return (true, format!("{} : {} prend son poste à {lieu}.", m.at("nom"), a.at("nom")));
    }
    a.set("mission", Val::None);
    a.set("repos", TT::deadline(g, 1, &[code]));
    let ok = g.rng.random() < chance;
    // (SPEC-POLITIQUE, module 8) missions tentées et réussies par type, pour l'outil d'équilibre : dans g.city_stats,
    // jamais sauvegardé ; ne change rien à la partie (un dict, pas de hasard)
    let st = g.city_stats.setdefault("missions", dict! {}).setdefault(mi.as_str(), dict! {"n" => 0, "ok" => 0});
    st.inc("n", 1);
    st.inc("ok", ok as i64);
    if ok {
        let msg = reussir(g, &a, &mi, cible, camp.as_deref());
        gagner_xp(g, &a, if m.atf("base") < 0.5 { 2 } else { 1 });
        (true, msg)
    } else {
        (true, echouer(g, &a, &mi, cible, camp.as_deref()))
    }
}

/// Expérience gagnée ; un niveau gagné apporte un trait du type de l'agent qu'il n'a pas encore.
fn gagner_xp(g: &mut Game, a: &Val, n: i64) {
    a.inc("xp", n);
    let niv = niveau_de(a.ati("xp")).min(5);
    if niv > a.ati("niveau") {
        a.set("niveau", niv);
        let libres: Vec<Val> = R::AGENTS().at(a.at("type")).at("traits").iter().filter(|t| !a.at("traits").has(t)).collect();
        if !libres.is_empty() {
            let t = g.rng.choice(&libres);
            a.at("traits").push(&t);
        }
    }
}

fn lieu(g: &Game, a: &Val) -> (Val, Val, String) {
    let n = a.get("at_node");
    let gn = g.geo.nodes.at(if n.is_some() { n } else { a.at("de") });
    (gn.at("x"), gn.at("y"), gn.ats("name"))
}

/// Une mission réussie : ses effets ; rend le message du joueur.
fn reussir(g: &mut Game, a: &Val, mi: &str, cible: &Val, camp: Option<&str>) -> String {
    let code = a.ats("owner");
    let (gx, gy, name) = lieu(g, a);
    let journal = |g: &mut Game, t: &str, imp: bool| {
        let concerne = code == g.player || camp == Some(g.player.as_str());
        if concerne {
            g.log("espion", t, &dict! {"x" => &gx, "y" => &gy, "who" => &code, "important" => imp});
        }
    };
    match mi {
        "espionner" => {
            if cible.is_int() {
                g.rapport_espion(&code, cible.i());
                return format!("Rapport d'espion sur {name}.");
            }
            let ar = g.armies.at(cible);
            let nid = g.nearest_node(ar.atf("x"), ar.atf("y"), None, 1e9);
            if nid.is_some() {
                let until = TT::deadline(g, R::SPY_INTEL_TOURS, &[&code]);
                g.factions.at(&code).setdefault("intel", dict! {}).set(nid.i().to_string(), until);
            }
            let hommes = py::int(py::sum(ar.at("regs").iter().map(|r| r.atf("n"))));
            let gen = if ar.getb("gen") { Game::gen_title(&ar.at("gen")) } else { "sans général".to_string() };
            let t = format!("Rapport d'espion : la {} compte {hommes} hommes ({gen}).", ar.at("name"));
            if code == g.player {
                g.log("espion", &t, &dict! {"x" => ar.at("x"), "y" => ar.at("y"), "who" => ar.at("owner"), "important" => true});
            }
            t
        }
        "saboter_remparts" => {
            g.saboter_remparts(&code, cible.i());
            format!("Sabotage réussi à {name}.")
        }
        "saboter_batiment" => {
            let n = g.nodes.at(cible);
            let meilleur = n.get_or("slots", dict! {}).items().into_iter().filter(|(_, l)| l.i() >= 2).max_by_key(|(_, l)| l.i());
            let t = if let Some((ch, l)) = meilleur {
                CT::slots(&n).set(&ch, l.i() - 1);
                CT::_milice(&n, ch.s(), l.i(), l.i() - 1);
                format!("Sabotage à {name} : {} ruiné.", CT::level_name(g, cible.i(), ch.s(), l.i()).to_lowercase())
            } else {
                n.set("deg", (n.get_or("deg", 0.0).f() + 0.25).min(1.0));
                format!("Sabotage à {name} : ateliers et magasins incendiés.")
            };
            g._dirty_income = true;
            journal(g, &t, true);
            t
        }
        "saboter_armee" => {
            let ar = g.armies.at(cible);
            for r in ar.at("regs").iter() {
                r.set("morale", (r.atf("morale") - 20.0).max(10.0));
                r.set("ammo", py::round_n(r.atf("ammo") * 0.6, 1));
            }
            let t = format!("Sabotage dans la {} : poudre mouillée, désertions, moral en berne.", ar.at("name"));
            journal(g, &t, true);
            t
        }
        "assassiner" => {
            let t = if g.agents.has(cible) {
                let b = g.agents.pop(cible);
                format!("{} ({}) a été assassiné près de {name}.", b.at("nom"), R::AGENTS().at(b.at("type")).ats("nom").to_lowercase())
            } else {
                let ar = g.armies.at(cible);
                let t = format!("Le {} a été assassiné.", Game::gen_title(&ar.at("gen")).to_lowercase());
                g.tuer_general(&ar);
                t
            };
            journal(g, &t, true);
            t
        }
        "inciter" => {
            let n = g.nodes.at(cible);
            n.set("stab", py::round_n((n.atf("stab") - R::AGENT_INCITE).max(0.0), 3));
            let t = format!("Agitation à {name} : des meneurs soulèvent la population.");
            journal(g, &t, true);
            t
        }
        "duel" => {
            let b = g.agents.at(cible);
            let t = blesser_ou_tuer(g, &b, &a.at("nom"));
            journal(g, &t, true);
            t
        }
        "voler_tech" => {
            let o = camp.unwrap();
            let tech = g.rng.choice(&techs_a_voler(g, &code, o));
            let f = g.factions.at(&code);
            f.at("techs").push(&tech);
            f.setdefault("tech_dates", dict! {}).set(&tech, list![g.date_str(&Val::None), py::round_n(g.t, 2)]);
            let br = R::TECH().at(&tech).at("branch");
            if f.at("research").get(&br).is_dict() && f.at("research").at(&br).at("tech") == tech {
                f.at("research").set(&br, Val::None);
            }
            g.recompute_mods(&code);
            let t = format!("Technologie volée à {name} : {}.", R::TECH().at(&tech).at("name"));
            journal(g, &t, true);
            t
        }
        "denoncer" => {
            let b = g.agents.at(cible);
            prendre(g, &b, &code);
            format!("{} est arrêté.", b.at("nom"))
        }
        _ => String::new(),
    }
}

/// Le vaincu d'un duel : tué, ou blessé (deux tours de repos).
fn blesser_ou_tuer(g: &mut Game, b: &Val, vainqueur: &Val) -> String {
    if g.rng.random() < 0.5 {
        g.agents.pop(b.at("id"));
        format!("Duel : {vainqueur} tue {} en duel.", b.at("nom"))
    } else {
        b.set("repos", TT::deadline(g, 2, &[b.ats("owner").as_str()]));
        b.set("mission", Val::None);
        format!("Duel : {vainqueur} blesse {} ; il gardera la chambre deux tours.", b.at("nom"))
    }
}

/// L'agent est pris par le camp `par` : il disparaît, et son camp perd la confiance de `par` (incident diplomatique).
fn prendre(g: &mut Game, a: &Val, par: &str) {
    g.agents.pop(a.at("id"));
    let code = a.ats("owner");
    let (gx, gy, name) = lieu(g, a);
    if g.factions.has(par) {
        incident(g, par, &code);
    }
    let qui = R::AGENTS().at(a.at("type")).ats("nom").to_lowercase();
    if code == g.player {
        let suite = if g.factions.has(par) { format!(" {} s'en offusque.", g.fname(par)) } else { String::new() };
        let t = format!("Votre {qui} {} a été pris à {name}.{suite}", a.at("nom"));
        g.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => par, "important" => true});
    }
    if par == g.player {
        let t = format!("Un {qui} de {} a été arrêté à {name}.", g.fname(&code));
        g.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &code, "important" => true});
    }
}

/// Incident diplomatique : un agent de `coupable` pris chez `victime` (la relation de la victime baisse, comme pour les
/// corsaires du commerce).
pub fn incident(g: &mut Game, victime: &str, coupable: &str) {
    let rel = g.factions.at(victime).at("rel");
    rel.set(coupable, super::batailles::py_max(-100, &rel.get_or(coupable, 0) - R::AGENT_REL));
    super::memoire::retenir(g, victime, coupable, "incident", None); // la victime s'en souviendra (module 6)
}

/// Une mission ratée : pris (incident), tué, ou démasqué ; au duel, il est blessé ou tué par son adversaire.
fn echouer(g: &mut Game, a: &Val, mi: &str, cible: &Val, camp: Option<&str>) -> String {
    let code = a.ats("owner");
    if mi == "duel" {
        let b = g.agents.at(cible);
        let t = blesser_ou_tuer(g, a, &b.at("nom"));
        if code == g.player || camp == Some(g.player.as_str()) {
            let (gx, gy, _) = lieu(g, &b);
            g.log("espion", &t, &dict! {"x" => gx, "y" => gy, "who" => &code, "important" => true});
        }
        return t;
    }
    let r = g.rng.random();
    if r < R::AGENT_PRIS {
        prendre(g, a, camp.unwrap_or(R::NEUTRAL));
        return format!("Échec : {} a été pris.", a.at("nom"));
    }
    if r < R::AGENT_PRIS + R::AGENT_TUE {
        g.agents.pop(a.at("id"));
        let (gx, gy, name) = lieu(g, a);
        let t = format!("Échec : {} a été tué à {name}.", a.at("nom"));
        if code == g.player {
            g.log("espion", &t, &dict! {"x" => gx, "y" => gy, "important" => true});
        }
        return t;
    }
    a.set("cache", false);
    if g.rng.random() < 0.25 && !a.at("traits").has("bavard") {
        a.at("traits").push("bavard");
    }
    format!("Échec : {} s'est échappé, démasqué.", a.at("nom"))
}

// ================================================================== le temps
/// Le pas de la campagne (Game::step) : les agents qui ne sont pas en pause avancent ; les gentilshommes en poste à
/// l'université font avancer les recherches de leur camp.
pub fn tick(g: &mut Game, dt: f64) {
    if !g.agents.truthy() {
        return;
    }
    for a in g.agents.values() {
        if a.atb("chemin") && !en_pause(g, &a) {
            avancer(g, &a, dt);
        }
        let m = a.get("mission");
        if m.is_dict() && m.at_is("type", "universite") {
            let k = R::AGENT_RECHERCHE * (1.0 + 0.25 * (a.ati("niveau") - 1) as f64);
            let w = TT::work(g, dt) * k;
            for cur in g.factions.at(a.at("owner")).at("research").values() {
                if cur.truthy() {
                    cur.dec("left", w);
                }
            }
        }
    }
}

/// Début du tour du joueur (TT::begin_turn) : ses agents retrouvent leurs jours de route et reprennent leur chemin.
pub fn debut_tour(g: &mut Game) {
    for a in g.agents.values() {
        a.set("mp", Val::None);
        if a.at("owner") == g.player && a.atb("chemin") {
            partir(g, &a);
        }
    }
}

/// Chaque mois (Game::monthly) : entretien, agents des camps disparus, effets des postes (ordre public, relations),
/// ambassades fermées par la guerre, postes perdus avec la place.
pub fn mois(g: &mut Game) {
    if !g.agents.truthy() {
        return;
    }
    let mut payer: IndexMap<String, f64> = IndexMap::new();
    for a in g.agents.values() {
        let code = a.ats("owner");
        if !g.factions.has(code.as_str()) || !g.factions.at(&code).atb("alive") {
            g.agents.pop(a.at("id"));
            continue;
        }
        *payer.entry(code.clone()).or_default() += R::AGENTS().at(a.at("type")).atf("entretien");
        let m = a.get("mission");
        if !m.is_dict() {
            continue;
        }
        let n = g.nodes.at(m.at("cible"));
        let o = n.ats("owner");
        let typ = m.ats("type");
        let k = 1.0 + 0.25 * (a.ati("niveau") - 1) as f64 + bonus_traits(&a, &typ);
        let fini = match typ.as_str() {
            "ambassade" => o == code || o == R::NEUTRAL || g.at_war(&code, &o),
            _ => o != code,
        };
        if fini {
            a.set("mission", Val::None);
            if code == g.player {
                let (gx, gy, name) = lieu(g, &a);
                let t = if typ == "ambassade" { format!("Ambassade fermée à {name} : {} est expulsé.", a.at("nom")) } else { format!("{} quitte son poste à {name}.", a.at("nom")) };
                g.log("espion", &t, &dict! {"x" => gx, "y" => gy, "important" => true});
            }
            continue;
        }
        m.inc("tours", 1);
        if m.ati("tours") % 6 == 0 {
            gagner_xp(g, &a, 1);
        }
        match typ.as_str() {
            "apaiser" => n.set("stab", py::round_n((n.atf("stab") + R::AGENT_APAISE * k).min(1.0), 3)),
            "ambassade" => {
                let rel = g.factions.at(&o).at("rel");
                let r = rel.get_or(code.as_str(), 0).f();
                if r < 60.0 {
                    rel.set(code.as_str(), (r + R::AGENT_AMBASSADE as f64 * k.round()).min(60.0));
                }
            }
            _ => {}
        }
    }
    for (code, l) in payer {
        g.factions.at(&code).at("res").dec("livres", l);
    }
}

// ================================================================== commandes et vue
/// `{cmd: "agent", sub, …}` (serveur) : recruter {node, type}, deplacer {agent, node}, mission {agent, mission, cible},
/// chance {agent, mission, cible} (la chance, sans donner l'ordre), annuler {agent}. Rend {ok, msg} (et chance).
pub fn commande(g: &mut Game, code: &str, body: &Val) -> Val {
    let sub = body.get("sub");
    let sub = if sub.is_str() { sub.string() } else { String::new() };
    let id = body.get("agent");
    if sub != "recruter" && sub != "chance" {
        if let Some(why) = TT::lock_reason(g) {
            return dict! {"ok" => false, "msg" => why};
        }
    }
    let (ok, msg) = match sub.as_str() {
        "recruter" => {
            let node = body.get("node");
            if !g.valid_node(&node) {
                return dict! {"ok" => false, "msg" => "Lieu inconnu."};
            }
            recruter(g, code, node.i(), &body.get("type"))
        }
        "deplacer" => deplacer(g, code, &id, &body.get("node")),
        "mission" => ordonner(g, code, &id, &body.get("mission"), &body.get("cible")),
        "chance" => {
            let r = a_moi(g, code, &id).map_err(|e| e.1).and_then(|a| verifier(g, &a, &body.get("mission"), &body.get("cible")));
            return match r {
                Ok((c, _)) => dict! {"ok" => true, "chance" => c, "msg" => format!("{} % de réussite.", py::round(c * 100.0))},
                Err(e) => dict! {"ok" => false, "msg" => e},
            };
        }
        "annuler" => annuler(g, code, &id),
        _ => (false, "Commande d'agent inconnue.".to_string()),
    };
    dict! {"ok" => ok, "msg" => msg}
}

/// La vue pour la page (views::player_state) : `agents` (ceux du joueur, de ses alliés, et les étrangers qu'il voit ; un
/// espion caché seulement s'il est démasqué) et `agents_camp` ({type: {n, plafond}}).
pub fn vue(g: &mut Game, out: &Val, seen: &dyn Fn(f64, f64) -> bool) {
    let p = g.player.clone();
    let l = list![];
    for a in g.agents.values() {
        let o = a.ats("owner");
        let moi = o == p;
        let (x, y) = xy(&a);
        if !moi && !g.friendly(&p, &o) && !(if a.getb("cache") { detecte(g, &a, &p) } else { seen(x, y) }) {
            continue;
        }
        let d = dict! {"id" => a.at("id"), "proprio" => &o, "type" => a.at("type"), "nom" => a.at("nom"), "case" => list![x, y],
                       "niveau" => a.at("niveau"), "traits" => a.at("traits"), "mission" => a.get("mission"), "cache" => a.getb("cache")};
        if moi {
            let poss: Val = possibles(g, &a).into_iter().map(|(m, c, ch)| dict! {"mission" => m, "cible" => c, "chance" => ch}).collect();
            d.update(&dict! {"xp" => a.at("xp"), "at_node" => a.get("at_node"), "dest" => a.get("dest"), "chemin" => a.at("chemin"),
                             "mp" => py::round_n(jours_restants(g, &a), 1), "repos" => TT::tours_left(g, a.get_or("repos", 0.0).f()),
                             "possibles" => poss});
        }
        l.push(d);
    }
    out.set("agents", l);
    if g.factions.has(p.as_str()) {
        let camp = Val::dict_from(R::AGENT_ORDRE().iter().map(|t| {
            let d = dict! {"n" => effectif(g, &p, t.s()), "plafond" => plafond(g, &p, t.s())};
            (t, d)
        }).collect());
        out.set("agents_camp", camp);
    }
}
