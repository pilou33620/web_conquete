//! Voies ferrées (SPEC-TECH.md, phase 2a) : les tronçons des lignes historiques (rules.RAIL_LINES), leurs chantiers, ce
//! qu'ils rapportent, le train et le sabotage.
//!
//! Un tronçon va d'une ville à la suivante d'une ligne, par la route la plus courte (routes royales d'abord). Il
//! n'appartient à personne : un camp s'en sert s'il est achevé, pas coupé, et si ses deux villes sont à lui ou à un allié.
//! L'état de chacun est dans g.rails = {id: dict(done, cut)} (sauvegardé) ; un chantier est un élément de la file d'une
//! des deux villes (kind 'rail').
//!
//! Porte game/rails.py (PORTAGE.md). `sid` : l'identifiant d'un tronçon (« a-b »), `sec` : un tronçon
//! (dict de sections), `st` : son état (dict de g.rails).

use crate::engine::Game;
use crate::geo::{GeoMap, VERSION_EUROPE};
use crate::py::{self, heapq, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};
use std::collections::HashMap;

py_const!(_SECTIONS, dict!{}); // carte → tronçons (calculés une fois) ; clé : `id(geo)`, l'adresse de la carte (`geo as *const GeoMap as usize`)

/// Arêtes de la route la plus courte de a à b (km, les routes royales comptant un peu moins), sans eau.
/// Python : `_path(geo, a, b)`.
/// Rend la liste des numéros d'arêtes (vide sans chemin). heapq : py::heapq (tas de tuples (distance, place)).
// game/rails.py, lignes 16 à 40
pub fn _path(geo: &GeoMap, a: i64, b: i64) -> Val {
    let mut dist: HashMap<i64, f64> = HashMap::from([(a, 0.0)]);
    let mut prev: HashMap<i64, (i64, i64)> = HashMap::new();
    let mut heap: Vec<(f64, i64)> = vec![(0.0, a)];
    while let Some((d, n)) = heapq::heappop(&mut heap) {
        if n == b {
            break;
        }
        if d > *dist.get(&n).unwrap_or(&1e18) {
            continue;
        }
        for eid in geo.adj.at(n).iter() {
            let e = geo.edges.at(&eid);
            if e.get("kind") == "water" {
                continue;
            }
            let m = if e.at("a") == n { e.ati("b") } else { e.ati("a") };
            let nd = d + e.atf("len") / (if e.getb("royal") { 1.15 } else { 1.0 });
            if nd < *dist.get(&m).unwrap_or(&1e18) {
                dist.insert(m, nd);
                prev.insert(m, (n, eid.i()));
                heapq::heappush(&mut heap, (nd, m));
            }
        }
    }
    if !prev.contains_key(&b) {
        return list![];
    }
    let (mut out, mut n) = (vec![], b);
    while n != a {
        let (p, eid) = prev[&n];
        n = p;
        out.push(Val::from(eid));
    }
    out.reverse();
    Val::list(out)
}

/// Tronçons des lignes : {id: dict(id, a, b, edges, km, line, year)} ; id « a-b » (numéros des villes).
/// Python : `sections(geo)`.
/// Le même dict à chaque appel pour une même carte (_SECTIONS).
// game/rails.py, lignes 43 à 58
pub fn sections(geo: &GeoMap) -> Val {
    let cle = geo as *const GeoMap as usize;
    if _SECTIONS().has(cle) {
        return _SECTIONS().at(cle);
    }
    let out = dict! {};
    // (géographie 5 : les lignes historiques sont celles du Sud-Ouest ; chaque pays reçoit les siennes)
    let lignes = if geo.version == VERSION_EUROPE { _lignes_europe(geo) } else { R::RAIL_LINES() };
    for line in lignes.iter() {
        let (name, towns, _) = line.triple();
        let towns = towns.vec();
        for w in towns.windows(2) {
            let (ta, tb, year) = (w[0].at(0), w[1].at(0), w[1].at(1));
            let (a, b) = if ta.is_str() { (geo.by_name.ati(&ta), geo.by_name.ati(&tb)) } else { (ta.i(), tb.i()) };
            let sid = format!("{}-{}", a.min(b), a.max(b));
            if out.has(&sid) {
                continue;
            }
            let edges = _path(geo, a, b);
            // (sans tronçon, sum() rend l'entier 0 et round(0, 1) le garde : « 0 » et non « 0.0 » dans /api/map)
            let km: Val = if edges.is_empty() { Val::Int(0) } else { py::round_n(py::sum(edges.iter().map(|e| geo.edges.at(&e).atf("len"))), 1).into() };
            out.set(&sid, dict! {"id" => &sid, "a" => a, "b" => b, "edges" => edges, "km" => km, "line" => &name, "year" => year});
        }
    }
    _SECTIONS().set(cle, out.clone());
    out
}

pub const RAIL_VILLES_5: usize = 8; // (géographie 5) villes de chaque pays que ses lignes desservent, les plus peuplées

/// (géographie 5) Les lignes d'un réseau généré, dans la forme de R::RAIL_LINES : dans chaque pays, de la capitale à ses
/// plus grandes villes, la plus peuplée d'abord, chacune raccordée à la ville déjà desservie la plus proche ; ouverture
/// de 1837 (la première) à 1885, cinq ans plus tard à chaque ville.
fn _lignes_europe(geo: &GeoMap) -> Val {
    let out = list![];
    for code in &geo.dept_codes {
        let du_pays: Vec<Val> = geo.nodes.iter().filter(|n| n.at("dept") == code.as_str()).collect();
        let Some(cap) = du_pays.iter().find(|n| n.at("type") == "capitale") else { continue };
        let villes = py::sorted_by_key(du_pays.iter().filter(|n| n.at("type") == "ville").cloned().collect::<Vec<_>>(), |n| (-n.ati("pop0"), n.ati("id")));
        let mut desservies = vec![cap.clone()];
        for (k, v) in villes.into_iter().take(RAIL_VILLES_5).enumerate() {
            let d2 = |n: &Val| py::pow(n.atf("x") - v.atf("x"), 2.0) + py::pow(n.atf("y") - v.atf("y"), 2.0);
            let de = desservies.iter().min_by(|a, b| d2(a).partial_cmp(&d2(b)).unwrap()).unwrap().clone();
            if _path(geo, de.ati("id"), v.ati("id")).is_empty() {
                continue; // (une île : pas de voie sous la mer)
            }
            let an = (1837 + 5 * k as i64).min(1885);
            // (les villes par leur numéro : sur cette carte, deux places peuvent porter le même nom)
            out.push(tup![format!("{}–{}", cap.at("name").s(), v.at("name").s()), list![tup![de.at("id"), 0], tup![v.at("id"), an]], list![]]);
            desservies.push(v);
        }
    }
    out
}

/// Sorties des lignes vers le bord de la carte : [(ville, (vers, direction))] (dessinées seulement).
/// Python : `exits()`.
/// Rend une liste de tuples (ville, (vers, direction)).
// game/rails.py, lignes 61 à 63
pub fn exits() -> Val {
    let mut out = vec![];
    for line in R::RAIL_LINES().iter() {
        for x in line.at(2).iter() {
            let (t, to, d) = x.triple();
            out.push(tup![t, tup![to, d]]);
        }
    }
    Val::list(out)
}

// ------------------------------------------------------------------ réseau et chantiers
pub const RAIL_MAX_WORKS: i64 = 2;  // chantiers de voie ferrée menés en même temps par un camp

/// Python : `_owned(g, code, sec)`.
// game/rails.py, lignes 70 à 71
pub fn _owned(g: &Game, code: &str, sec: &Val) -> bool {
    g.nodes.at(sec.at("a")).at("owner") == code && g.nodes.at(sec.at("b")).at("owner") == code
}

/// Villes reliées au réseau de ce camp : son chef-lieu, et les villes des tronçons achevés qu'il tient en entier.
/// Python : `network(g, code)`.
/// Rend un set de numéros de places (le chef-lieu peut y être None : capital_of).
// game/rails.py, lignes 74 à 81
pub fn network(g: &Game, code: &str) -> Val {
    let out = pyset![g.capital_of(code)];
    let secs = sections(&g.geo);
    for (sid, st) in g.rails.items() {
        let sec = secs.get(&sid);
        if sec.truthy() && st.getb("done") && _owned(g, code, &sec) {
            out.update(&pyset![sec.at("a"), sec.at("b")]);
        }
    }
    out
}

/// Python : `works(g, code)`.
/// Rend la liste des sid des chantiers de ce camp.
// game/rails.py, lignes 84 à 85
pub fn works(g: &Game, code: &str) -> Val {
    g.rails.items().into_iter().filter(|(_, st)| !st.getb("done") && st.get("by") == code).map(|(sid, _)| sid).collect()
}

/// (possible, raison) : ce camp peut-il ouvrir le chantier de ce tronçon ?
/// Python : `openable(g, code, sid)`.
// game/rails.py, lignes 88 à 103
pub fn openable(g: &Game, code: &str, sid: &str) -> (bool, String) {
    let sec = sections(&g.geo).get(sid);
    if sec.is_none() {
        return (false, "Tronçon inconnu.".to_string());
    }
    if !g.factions.at(code).at("techs").has("chemins_fer") {
        return (false, "Technologie requise : Chemins de fer.".to_string());
    }
    if g.rails.has(sid) {
        let m = if g.rails.at(sid).getb("done") { "Voie déjà construite." } else { "Chantier déjà en cours." };
        return (false, m.to_string());
    }
    if !_owned(g, code, &sec) {
        return (false, "Les deux villes doivent être à vous.".to_string());
    }
    let net = network(g, code);
    if !(net.has(sec.at("a")) || net.has(sec.at("b"))) {
        return (false, format!("Le réseau part de votre {} : reliez d'abord l'une des deux villes.", if g.europe() { "capitale" } else { "chef-lieu" }));
    }
    if works(g, code).len() as i64 >= RAIL_MAX_WORKS {
        return (false, format!("Déjà {RAIL_MAX_WORKS} chantiers de voie ferrée en cours."));
    }
    (true, String::new())
}

/// Prix et durée (jours de travail à industrie moyenne) d'un tronçon pour ce camp : le ciment les réduit aussi.
/// Python : `cost(g, code, sid)`.
/// Rend (prix : dict {ressource: quantité}, jours).
// game/rails.py, lignes 106 à 109
pub fn cost(g: &Game, code: &str, sid: &str) -> (Val, f64) {
    let km = sections(&g.geo).at(sid).at("km");
    let prix = Val::dict_from(R::RAIL_KM_COST().items().into_iter().map(|(r, v)| (r, &v * &km)).collect());
    (g.build_cost(code, &prix), g.build_days(code, km.f() * R::RAIL_KM_DAYS))
}

/// Python : `start(g, code, sid)`.
// game/rails.py, lignes 112 à 122
pub fn start(g: &mut Game, code: &str, sid: &str) -> (bool, String) {
    let (ok, why) = openable(g, code, sid);
    if !ok {
        return (false, why);
    }
    let (price, days) = cost(g, code, sid);
    if !g.can_pay(code, &price) {
        return (false, "Ressources insuffisantes.".to_string());
    }
    g.pay(code, &price);
    g.rails.set(sid, dict! {"done" => false, "cut" => Val::None, "by" => code, "left" => days, "total" => days});
    let sec = sections(&g.geo).at(sid);
    let (na, nb) = (g.geo.nodes.at(sec.at("a")), g.geo.nodes.at(sec.at("b")));
    (true, format!("Chantier de la voie {}–{} lancé.", na.at("name"), nb.at("name")))
}

/// Vitesse des chantiers : l'industrie du camp comparée à celle des camps en vie (× 0,5 à 2).
/// Python : `industry_k(g, code)`.
// game/rails.py, lignes 125 à 129
pub fn industry_k(g: &Game, code: &str) -> f64 {
    let alive: Vec<Val> =
        g.factions.values().into_iter().filter(|f| f.atb("alive")).map(|f| f.at("income").get_or("industrie", 0.0)).collect();
    let n = alive.len().max(1);
    let mean = py::sum_v(alive).f() / n as f64;
    let k = g.factions.at(code).at("income").get_or("industrie", 0.0).f() / (if mean > 1e-6 { mean } else { 1e-6 });
    let k = if k < 2.0 { k } else { 2.0 };
    if k > 0.5 { k } else { 0.5 }
}

/// Fait avancer les chantiers de w jours de travail (Game.update_queues) ; un chantier dont une ville est perdue ou
/// assiégée attend.
/// Python : `tick(g, w)`.
/// w : jours de travail (TT.work).
// game/rails.py, lignes 132 à 151
pub fn tick(g: &mut Game, w: f64) {
    let secs = sections(&g.geo);
    for (sid, st) in g.rails.items() {
        if st.getb("done") {
            continue;
        }
        let (sec, code) = (secs.at(&sid), st.ats("by"));
        let (oa, ob) = (g.nodes.at(sec.at("a")).at("owner"), g.nodes.at(sec.at("b")).at("owner"));
        if !g.factions.has(&code) || !g.factions.at(&code).atb("alive") || !(oa == code.as_str() || ob == code.as_str()) {
            g.rails.del(&sid); // le camp a disparu, ou les deux villes sont prises : chantier abandonné, tronçon libéré
            continue;
        }
        if !_owned(g, &code, &sec) || g.nodes.at(sec.at("a")).atb("siege") || g.nodes.at(sec.at("b")).atb("siege") {
            continue; // une ville perdue ou assiégée : le chantier attend
        }
        st.dec("left", w * industry_k(g, &code));
        if st.atf("left") <= 1e-6 {
            g.rails.set(&sid, dict! {"done" => true, "cut" => Val::None});
            g._dirty_income = true;
            let (a, b) = (g.geo.nodes.at(sec.at("a")), g.geo.nodes.at(sec.at("b")));
            let txt = format!(
                "La voie ferrée {}–{} est ouverte : les deux villes gagnent en industrie et en commerce.",
                a.at("name"),
                b.at("name")
            );
            let kw = dict! {"x" => (&a.at("x") + &b.at("x")) / Val::from(2), "y" => (&a.at("y") + &b.at("y")) / Val::from(2),
                            "who" => &code, "important" => code == g.player};
            g.log("rail", &txt, &kw);
        }
    }
}

// ------------------------------------------------------------------ ce que les lignes rapportent
py_const!(_BY_TOWN, dict!{}); // (clé : l'adresse de la carte, comme _SECTIONS)

/// {ville: [tronçons qui la desservent]}
/// Python : `by_town(geo)`.
/// Rend {numéro de ville: liste de sid} (le même dict à chaque appel : _BY_TOWN).
// game/rails.py, lignes 158 à 166
pub fn by_town(geo: &GeoMap) -> Val {
    let cle = geo as *const GeoMap as usize;
    if !_BY_TOWN().has(cle) {
        let out = dict! {};
        for (sid, sec) in sections(geo).items() {
            out.setdefault(sec.at("a"), list![]).push(&sid);
            out.setdefault(sec.at("b"), list![]).push(&sid);
        }
        _BY_TOWN().set(cle, out);
    }
    _BY_TOWN().at(cle)
}

/// Achevé et pas coupé.
/// Python : `open_(g, sid)`.
// game/rails.py, lignes 169 à 172
pub fn open_(g: &Game, sid: &str) -> bool {
    let st = g.rails.get(sid);
    st.truthy() && st.getb("done") && !(st.getb("cut") && g.t < st.atf("cut"))
}

/// Ce camp peut-il s'en servir ? Ouvert, et ses deux villes à lui ou à un allié.
/// Python : `usable(g, code, sid)`.
// game/rails.py, lignes 175 à 180
pub fn usable(g: &Game, code: &str, sid: &str) -> bool {
    if !open_(g, sid) {
        return false;
    }
    let sec = sections(&g.geo).at(sid);
    g.friendly(code, g.nodes.at(sec.at("a")).at("owner").s()) && g.friendly(code, g.nodes.at(sec.at("b")).at("owner").s())
}

/// Industrie et commerce en plus pour une ville desservie par des tronçons ouverts (à qui qu'ils soient).
/// Python : `town_bonus(g, nid)`.
// game/rails.py, lignes 183 à 186
pub fn town_bonus(g: &Game, nid: i64) -> f64 {
    let k = by_town(&g.geo).get(nid).or(list![]).iter().filter(|sid| open_(g, sid.s())).count();
    let v = R::RAIL_TOWN_BONUS * k as f64;
    if v < R::RAIL_TOWN_MAX { v } else { R::RAIL_TOWN_MAX }
}

/// Une gare utilisable par ce camp est-elle à moins de RAIL_STATION_KM ?
/// Python : `near_station(g, code, x, y)`.
// game/rails.py, lignes 189 à 196
pub fn near_station(g: &Game, code: &str, x: f64, y: f64) -> bool {
    let r2 = py::pow(R::RAIL_STATION_KM, 2.0);
    for (nid, sids) in by_town(&g.geo).items() {
        let gn = g.geo.nodes.at(&nid);
        if py::pow(gn.atf("x") - x, 2.0) + py::pow(gn.atf("y") - y, 2.0) <= r2 && sids.iter().any(|sid| usable(g, code, sid.s())) {
            return true;
        }
    }
    false
}

// ------------------------------------------------------------------ le train

/// Arêtes où ce camp peut prendre le train (« Chemins de fer militaires », tronçons utilisables), sinon vide.
/// Python : `rail_edges(g, code)`.
/// Rend un set (frozenset) de numéros d'arêtes, vide si le camp n'a pas le train.
// game/rails.py, lignes 200 à 204
pub fn rail_edges(g: &Game, code: &str) -> Val {
    if !g.factions.has(code) || g.mod_(code, "rail_troops", 0.0) == 0.0 {
        return pyset![];
    }
    let out = pyset![];
    for (sid, sec) in sections(&g.geo).items() {
        if usable(g, code, sid.s()) {
            out.update(&sec.at("edges"));
        }
    }
    out
}

// ------------------------------------------------------------------ sabotage

/// Tronçons sur la route desquels cette armée se tient (sur une de leurs arêtes, ou dans une de leurs places).
/// Python : `_on_section(g, a)`.
/// Rend une liste de tronçons (dict de sections).
// game/rails.py, lignes 208 à 216
pub fn _on_section(g: &Game, a: &Val) -> Val {
    let secs = sections(&g.geo).values();
    if a.getb("edge") {
        let e = a.at("edge").at("e");
        return secs.into_iter().filter(|s| s.at("edges").has(&e)).collect();
    }
    if a.at("at_node").is_some() {
        let n = a.at("at_node");
        return secs
            .into_iter()
            .filter(|s| s.at("edges").iter().any(|eid| {
                let e = g.geo.edges.at(&eid);
                n == e.at("a") || n == e.at("b")
            }))
            .collect();
    }
    list![]
}

/// Fin du mois (Game.monthly) : une armée en guerre avec le camp d'une ville d'un tronçon ouvert, posée sur sa route,
/// le coupe pour RAIL_CUT_TOURS ; personne ne s'en sert plus jusque-là (il se répare de lui-même).
/// Python : `sabotage(g)`.
/// Piège : `for who in {code} | {…}` parcourt un set de textes (codes) : l'ordre des lignes du journal n'y est
/// pas fixé en Python ; garder code d'abord, puis les autres dans l'ordre de foes.
// game/rails.py, lignes 219 à 240
pub fn sabotage(g: &mut Game) {
    for a in g.armies.values() {
        let code = a.ats("owner");
        if !g.factions.has(&code) || a.getb("boat") || a.getb("rail") || a.at("state") == "retreat" {
            continue;
        }
        if a.at("at_node").is_some() && g.friendly(&code, g.nodes.at(a.at("at_node")).at("owner").s()) {
            continue; // chez soi ou chez un allié : on ne coupe pas les voies qui en partent
        }
        for sec in _on_section(g, &a).iter() {
            let sid = sec.ats("id");
            let st = g.rails.get(&sid);
            if !open_(g, &sid) {
                continue;
            }
            let foes = pyset![g.nodes.at(sec.at("a")).at("owner"), g.nodes.at(sec.at("b")).at("owner")];
            if !foes.iter().any(|o| g.factions.has(&o) && g.at_war(&code, o.s())) {
                continue;
            }
            st.set("cut", TT::deadline(g, R::RAIL_CUT_TOURS, &[]));
            let (na, nb) = (g.geo.nodes.at(sec.at("a")), g.geo.nodes.at(sec.at("b")));
            // (un set de textes en Python : ordre libre ; ici le camp de l'armée, puis ceux des villes)
            let who_all = pyset![&code];
            for o in foes.iter() {
                if g.factions.has(&o) {
                    who_all.push(o);
                }
            }
            for who in who_all.iter() {
                let txt = format!(
                    "{} coupe la voie ferrée {}–{} : plus de train pendant {} tours.",
                    g.fname(&code),
                    na.at("name"),
                    nb.at("name"),
                    R::RAIL_CUT_TOURS
                );
                let kw = dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &who, "important" => who == g.player.as_str()};
                g.log("rail", &txt, &kw);
            }
        }
    }
}

// ------------------------------------------------------------------ pour le navigateur

/// Avec la carte (statique) : les tronçons [id, a, b, arêtes, km, ligne, année] et les sorties [ville, vers, direction].
/// Python : `client_payload(geo)`.
// game/rails.py, lignes 244 à 247
pub fn client_payload(geo: &GeoMap) -> Val {
    let sections_ = sections(geo)
        .values()
        .into_iter()
        .map(|s| list![s.at("id"), s.at("a"), s.at("b"), s.at("edges"), if geo.km_case == 1.0 { s.at("km") } else { Val::from(py::round_n(s.atf("km") * geo.km_case, 1)) }, s.at("line"), s.at("year")]) // (affiché en km : des cases de 5 km en Europe)
        .collect::<Val>();
    let exits_ = (if geo.version == VERSION_EUROPE { list![] } else { exits() }) // (géographie 5 : aucune sortie dessinée)
        .iter()
        .map(|x| {
            let (t, td) = x.pair();
            let (to, d) = td.pair();
            list![geo.by_name.at(&t), to, d]
        })
        .collect::<Val>();
    dict! {"sections" => sections_, "exits" => exits_}
}

/// Avec l'état du joueur : chaque tronçon [id, 'fait' | 'coupe' | 'chantier', avancement, camp du chantier], les
/// tronçons qu'il peut ouvrir [id, prix, tours estimés à son industrie] et ses chantiers en cours.
/// Python : `player_view(g, p)`.
// game/rails.py, lignes 250 à 267
pub fn player_view(g: &Game, p: &str) -> Val {
    let state = list![];
    for (sid, st) in g.rails.items() {
        if st.getb("done") {
            state.push(list![&sid, if open_(g, sid.s()) { "fait" } else { "coupe" }, 1.0, Val::None]);
        } else {
            let total = st.atf("total");
            let p = py::round_n(1.0 - st.atf("left") / (if total > 1e-6 { total } else { 1e-6 }), 3);
            state.push(list![&sid, "chantier", p, st.get("by")]);
        }
    }
    let opens = list![];
    if g.factions.has(p) {
        let k = industry_k(g, p);
        for sid in sections(&g.geo).keys() {
            if openable(g, p, sid.s()).0 {
                let (price, days) = cost(g, p, sid.s());
                opens.push(list![&sid, price, py::round_n(days / k / TT::TOUR_DAYS, 1)]);
            }
        }
    }
    let n = if g.factions.has(p) { works(g, p).len() } else { 0 };
    dict! {"state" => state, "open" => opens, "works" => n, "max" => RAIL_MAX_WORKS}
}
