//! Les flottes (SPEC-EMPIRE, module 2) : construction au port, mouvement sur les cases de mer, transport d'une armée,
//! blocus, réparation, ordres (blocus, commerce, corsaire, route), commandes du joueur et vue pour la page.
//!
//! `g.flottes` : {fid: flotte}, une flotte étant dict(id, owner, x, y (la case, des entiers), navires {type: n},
//! pv {type: [coque de chaque navire, 0 à 1]}, amiral (un général, ou None), dest ([x, y] ou None), chemin ([[x, y]…],
//! les cases qui restent, sans celle où elle est), a_quai (numéro de la place où elle mouille, ou None), armee (identifiant
//! de l'armée embarquée, ou None), ordre ("" | "blocus" | "commerce" | "corsaire" | "route"), route (route maritime, R4),
//! cible (la place bloquée, le camp chassé par un corsaire, le comptoir…)). Clés de travail : bord (le dict de l'armée
//! embarquée, sortie de g.armies le temps de la traversée), vers (la place où mouiller à l'arrivée), mp (jours de mer
//! qui restent ce tour, tour par tour), prog (avance entre deux cases), bataille (la bataille navale en cours), bloque
//! (la place qu'elle bloque, pour le journal).
//!
//! Le mouvement : une recherche de chemin (A*) sur les cases d'eau de la carte (océan et eau), la vitesse du plus lent
//! navire, la météo (tempêtes). Tour par tour, comme les armées : pendant le tour du joueur ses flottes partent tout de
//! suite (jours de mer du mois), pendant le tour des IA elles restent en place.

use super::*;
use crate::geo::T_EAU;
use crate::turns as TT;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Les ordres qu'une flotte accepte.
pub const ORDRES: [&str; 5] = ["", "blocus", "commerce", "corsaire", "route"];
/// Navires à vapeur : le calme et la tempête les gênent moins.
const VAPEURS: [&str; 4] = ["vapeur", "fregate_helice", "vaisseau_helice", "cuirasse"];

// ================================================================== la mer
/// Une case d'eau navigable (océan, mer, estuaire).
pub fn est_mer(geo: &GeoMap, x: i64, y: i64) -> bool {
    x >= 0 && y >= 0 && x < geo.W && y < geo.H && geo.terrain[(y * geo.W + x) as usize] as i64 <= T_EAU
}

/// La case de mer où mouillent les navires d'une place : la plus proche à moins de 10 km, ou None (place sans accès à la
/// mer, ou qui n'est pas un port).
pub fn case_port(geo: &GeoMap, nid: i64) -> Option<(i64, i64)> {
    let gn = geo.nodes.at(nid);
    if !gn.at("spec").has("port") {
        return None;
    }
    let (x, y) = (gn.atf("x") as i64, gn.atf("y") as i64);
    let r = (10.0 / geo.km_case).ceil() as i64;
    let mut best: Option<(i64, i64, i64)> = None;
    for dy in -r..=r {
        for dx in -r..=r {
            let d = dx * dx + dy * dy;
            if est_mer(geo, x + dx, y + dy) && best.is_none_or(|b| d < b.0) {
                best = Some((d, x + dx, y + dy));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}

/// Niveau de la chaîne « port » de la place (SPEC-EMPIRE, module 4 : `cities.rs`).
pub fn niveau_port(g: &Game, nid: i64) -> i64 {
    if case_port(&g.geo, nid).is_none() { 0 } else { CT::niveau(&g.nodes.at(nid), "port") }
}

thread_local! {
    /// Tampons de la recherche de chemin (coût, case d'où l'on vient, numéro de la recherche qui les a écrits), gardés
    /// d'une recherche à l'autre : une carte de 600 000 cases ne se réalloue pas à chaque ordre.
    static TAMPON: std::cell::RefCell<(Vec<u32>, Vec<u32>, Vec<u32>, u32)> = const { std::cell::RefCell::new((vec![], vec![], vec![], 0)) };
}

/// Plus court chemin sur l'eau, d'une case à l'autre (8 voisins, A*) : les cases à parcourir sans celle du départ, ou
/// None. La case de départ peut être à terre (une flotte au quai), pas celle d'arrivée.
pub fn chemin_mer(geo: &GeoMap, de: (i64, i64), vers: (i64, i64)) -> Option<Vec<(i64, i64)>> {
    if !est_mer(geo, vers.0, vers.1) {
        return None;
    }
    if de == vers {
        return Some(vec![]);
    }
    let w = geo.W;
    let n = (geo.W * geo.H) as usize;
    let s = (de.1 * w + de.0) as usize;
    let but = (vers.1 * w + vers.0) as usize;
    if de.0 < 0 || de.1 < 0 || de.0 >= geo.W || de.1 >= geo.H {
        return None;
    }
    let h = |c: usize| {
        let (dx, dy) = (((c as i64 % w) - vers.0).unsigned_abs() as u32, ((c as i64 / w) - vers.1).unsigned_abs() as u32);
        10 * dx.max(dy) + 4 * dx.min(dy)
    };
    TAMPON.with(|t| {
        let mut t = t.borrow_mut();
        let (cout, venu, marque, num) = &mut *t;
        if cout.len() != n {
            *cout = vec![0; n];
            *venu = vec![0; n];
            *marque = vec![0; n];
            *num = 0;
        }
        *num = num.wrapping_add(1);
        if *num == 0 {
            marque.iter_mut().for_each(|m| *m = 0);
            *num = 1;
        }
        let num = *num;
        let mut tas = BinaryHeap::new();
        cout[s] = 0;
        marque[s] = num;
        tas.push(Reverse((h(s), s as u32)));
        let mut vus = 0;
        while let Some(Reverse((_, c))) = tas.pop() {
            let c = c as usize;
            if c == but {
                let mut out = vec![];
                let mut k = but;
                while k != s {
                    out.push(((k as i64) % w, (k as i64) / w));
                    k = venu[k] as usize;
                }
                out.reverse();
                return Some(out);
            }
            vus += 1;
            if vus > 400_000 {
                return None;
            }
            let (x, y) = ((c as i64) % w, (c as i64) / w);
            for (dx, dy, pas) in [(1, 0, 10), (-1, 0, 10), (0, 1, 10), (0, -1, 10), (1, 1, 14), (1, -1, 14), (-1, 1, 14), (-1, -1, 14)] {
                if !est_mer(geo, x + dx, y + dy) {
                    continue;
                }
                let v = ((y + dy) * w + x + dx) as usize;
                let nc = cout[c] + pas;
                if marque[v] != num || nc < cout[v] {
                    marque[v] = num;
                    cout[v] = nc;
                    venu[v] = c as u32;
                    tas.push(Reverse((nc + h(v), v as u32)));
                }
            }
        }
        None
    })
}

/// La case d'eau la plus proche d'un point (à moins de r cases), ou None.
pub fn mer_pres(geo: &GeoMap, x: f64, y: f64, r: i64) -> Option<(i64, i64)> {
    let (cx, cy) = (x.floor() as i64, y.floor() as i64);
    let mut best: Option<(i64, i64, i64)> = None;
    for dy in -r..=r {
        for dx in -r..=r {
            let d = dx * dx + dy * dy;
            if est_mer(geo, cx + dx, cy + dy) && best.is_none_or(|b| d < b.0) {
                best = Some((d, cx + dx, cy + dy));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}

// ================================================================== une flotte
fn case(f: &Val) -> (i64, i64) {
    (f.ati("x"), f.ati("y"))
}

/// Distance en cases entre deux flottes (ou une flotte et un point du moteur : `(x + 0.5, y + 0.5)` est le centre).
pub fn dist(f: &Val, x: f64, y: f64) -> f64 {
    py::hypot(f.atf("x") + 0.5 - x, f.atf("y") + 0.5 - y)
}

pub fn nb_navires(f: &Val) -> i64 {
    f.at("navires").values().iter().map(|n| n.i()).sum()
}

/// Les navires (type, rang, coque) d'une flotte.
pub fn liste(f: &Val) -> Vec<(String, usize, f64)> {
    let mut out = vec![];
    for (t, l) in f.at("pv").items() {
        for (i, hp) in l.iter().enumerate() {
            out.push((t.string(), i, hp.f()));
        }
    }
    out
}

/// Ajoute un navire (coque hp, de 0 à 1).
pub fn ajouter(f: &Val, typ: &str, hp: f64) {
    f.at("navires").set(typ, f.at("navires").get_or(typ, 0).i() + 1);
    f.at("pv").setdefault(typ, list![]).push(py::round_n(hp, 3));
}

/// Retire des navires : `rangs` = [(type, rang)] ; rend ce qui est retiré, avec la coque.
pub fn retirer(f: &Val, rangs: &[(String, usize)]) -> Vec<(String, f64)> {
    let mut out = vec![];
    for (t, l) in f.at("pv").items() {
        let mut garde = vec![];
        for (i, hp) in l.iter().enumerate() {
            if rangs.iter().any(|(rt, ri)| rt == t.s() && *ri == i) {
                out.push((t.string(), hp.f()));
            } else {
                garde.push(hp);
            }
        }
        if garde.is_empty() {
            f.at("pv").del(&t);
            f.at("navires").del(&t);
        } else {
            f.at("navires").set(&t, garde.len());
            f.at("pv").set(&t, Val::list(garde));
        }
    }
    out
}

/// Hommes que la flotte peut porter (navires à flot).
pub fn capacite(f: &Val) -> f64 {
    f.at("navires").items().iter().map(|(t, n)| R::NAVIRES().at(t).atf("transport") * n.f()).sum()
}

/// L'armée embarquée (son dict), ou None.
pub fn armee_a_bord(f: &Val) -> Val {
    f.get("bord")
}

pub fn effectif(a: &Val) -> f64 {
    if a.is_none() { 0.0 } else { py::sum(a.at("regs").iter().map(|r| r.atf("n"))) }
}

/// Vitesse de la flotte (cases par jour) : celle de son navire le plus lent, ce que la météo lui laisse (les vapeurs
/// craignent moins le calme et la tempête).
pub fn vitesse(g: &Game, f: &Val) -> f64 {
    let types = f.at("navires").keys();
    if types.is_empty() {
        return 0.0;
    }
    let v = types.iter().map(|t| R::NAVIRES().at(t).atf("vitesse")).fold(f64::INFINITY, f64::min);
    let kind = g.weather.at(g.zone_of(f.atf("x") + 0.5, f.atf("y") + 0.5)).ats("kind");
    let k: f64 = match kind.as_str() {
        "tempete" => 0.12,
        "orage" => 0.5,
        "brouillard" => 0.7,
        "pluie" => 0.9,
        _ => 1.0,
    };
    let vapeur = types.iter().all(|t| VAPEURS.contains(&t.s()));
    v * if vapeur { k.max(0.5) } else { k }
}

/// Tour par tour, pendant le tour des IA : les flottes du joueur ont déjà joué (comme Game::paused pour les armées).
pub fn en_pause(g: &Game, f: &Val) -> bool {
    f.at("owner") == g.player && g.tour.atb("on") && g.tour.at("end").is_some()
}

/// Jours de mer qui restent ce tour à une flotte du joueur.
pub fn jours_restants(g: &Game, f: &Val) -> f64 {
    let mp = f.get("mp");
    if mp.is_none() { TT::march_days(g) } else { mp.f().max(0.0) }
}

fn nouvelle(g: &mut Game, owner: &str, (x, y): (i64, i64), a_quai: &Val) -> Val {
    let fid = g.nid("f");
    let amiral = g.new_general(owner);
    let f = dict! {"id" => &fid, "owner" => owner, "x" => x, "y" => y, "navires" => dict!{}, "pv" => dict!{}, "amiral" => amiral,
                   "dest" => Val::None, "chemin" => list![], "a_quai" => a_quai, "armee" => Val::None, "ordre" => "", "route" => Val::None,
                   "cible" => Val::None};
    g.flottes.set(&fid, &f);
    f
}

/// Une flotte du camp, ou l'erreur à rendre au joueur.
fn a_moi(g: &Game, code: &str, fid: &Val) -> Result<Val, (bool, String)> {
    let f = if fid.is_str() { g.flottes.get(fid) } else { Val::None };
    if !f.truthy() || f.at("owner") != code {
        return Err((false, "Flotte introuvable.".to_string()));
    }
    if f.getb("bataille") {
        return Err((false, "La flotte est au combat.".to_string()));
    }
    Ok(f)
}

/// Supprime une flotte (coulée, prise ou fusionnée) ; l'armée à bord, s'il y en a une, disparaît avec elle.
pub fn supprimer(g: &mut Game, f: &Val) {
    let a = armee_a_bord(f);
    if a.truthy() && a.getb("gen") && !a.at("gen").getb("interim") {
        let o = a.ats("owner");
        g.reserver(&o, &a.at("gen"));
    }
    g.flottes.pop(f.at("id"));
}

// ================================================================== construction
/// Peut-on mettre ce navire en chantier dans cette place ?
pub fn peut_construire(g: &Game, code: &str, nid: i64, typ: &Val) -> (bool, String) {
    let n = g.nodes.at(nid);
    if n.at("owner") != code {
        return (false, "Cette place ne vous appartient pas.".to_string());
    }
    let nv = if typ.is_str() { R::NAVIRES().get(typ) } else { Val::None };
    if !nv.truthy() {
        return (false, "Navire inconnu.".to_string());
    }
    let niv = niveau_port(g, nid);
    if niv == 0 {
        return (false, "Il faut un port de mer.".to_string());
    }
    if niv < nv.ati("port") {
        let nom = ["", "port de commerce", "chantier naval", "arsenal de marine"][nv.ati("port") as usize];
        return (false, format!("Il faut un {nom} dans la place."));
    }
    let tech = nv.at("tech");
    if tech.is_some() && !g.factions.at(code).at("techs").has(&tech) {
        return (false, format!("Il faut la découverte « {} ».", R::TECH().at(&tech).at("name")));
    }
    if n.atb("siege") {
        return (false, "La place est assiégée.".to_string());
    }
    if n.at("queue").len() >= 4 {
        return (false, "File de production pleine (4 maximum).".to_string());
    }
    if !g.can_pay(code, &nv.at("cout")) {
        return (false, "Ressources insuffisantes.".to_string());
    }
    (true, String::new())
}

/// Commande « construire » : le navire entre dans la file de la place (kind navire), payé tout de suite.
pub fn construire(g: &mut Game, code: &str, nid: i64, typ: &Val) -> (bool, String) {
    let (ok, why) = peut_construire(g, code, nid, typ);
    if !ok {
        return (false, why);
    }
    let nv = R::NAVIRES().at(typ);
    g.pay(code, &nv.at("cout"));
    let jours = nv.atf("jours");
    g.nodes.at(nid).at("queue").push(dict! {"kind" => "navire", "what" => typ, "left" => jours, "total" => jours});
    (true, format!("{} en chantier à {}.", nv.at("nom"), g.geo.nodes.at(nid).at("name")))
}

/// Fin de chantier (Game::update_queues, kind navire) : le navire rejoint la flotte qui mouille dans la place, sinon
/// une flotte neuve.
pub fn lancer(g: &mut Game, n: &Val, q: &Val) {
    let nid = n.ati("id");
    let owner = n.ats("owner");
    let Some(c) = case_port(&g.geo, nid) else { return };
    let typ = q.ats("what");
    let f = g.flottes.values().into_iter().find(|f| f.at("owner") == owner.as_str() && f.at("a_quai") == nid && !f.getb("bataille"));
    let f = match f {
        Some(f) => f,
        None => nouvelle(g, &owner, c, &Val::from(nid)),
    };
    ajouter(&f, &typ, 1.0);
    if owner == g.player {
        let gn = g.geo.nodes.at(nid);
        let t = format!("Navire lancé à {} : {}.", gn.at("name"), R::NAVIRES().at(&typ).ats("nom").to_lowercase());
        g.log("armee", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y")});
    }
}

/// Entretien de la marine d'un camp (livres par jour) : ses navires, et la solde de l'armée embarquée (sortie de
/// g.armies le temps de la traversée).
pub fn entretien(g: &Game, code: &str) -> f64 {
    let mut s = 0.0;
    for f in g.flottes.values() {
        if f.at("owner") != code {
            continue;
        }
        for (t, n) in f.at("navires").items() {
            s += R::NAVIRES().at(&t).atf("entretien") * n.f();
        }
        let a = armee_a_bord(&f);
        if a.truthy() {
            s += a.at("regs").iter().map(|r| (&R::UNITS().at(r.at("type")).at("upkeep_l") * &r.at("n")).f() / 100.0).sum::<f64>();
        }
    }
    s * (1.0 + g.mod_(code, "upkeep", 0.0))
}

// ================================================================== mouvement
/// Avance la flotte le long de son chemin pendant `jours` jours ; s'arrête à la rencontre d'une flotte ennemie (bataille)
/// ou au bout du chemin (au quai de la place visée, si elle est amie). Rend les jours employés.
pub fn avancer(g: &mut Game, f: &Val, jours: f64) -> f64 {
    let v = vitesse(g, f);
    if v <= 0.0 || !f.atb("chemin") || f.getb("bataille") {
        return 0.0;
    }
    let mut reste = f.get_or("prog", 0.0).f() + jours * v;
    let mut fait = 0.0;
    while f.atb("chemin") {
        let (nx, ny) = f.at("chemin").at(0).xy();
        let (nx, ny) = (nx as i64, ny as i64);
        let pas = if nx != f.ati("x") && ny != f.ati("y") { std::f64::consts::SQRT_2 } else { 1.0 };
        if reste < pas {
            break;
        }
        reste -= pas;
        fait += pas;
        f.at("chemin").pop(0);
        f.set("x", nx);
        f.set("y", ny);
        f.set("a_quai", Val::None);
        if navale::rencontre(g, f) {
            f.set("prog", 0.0);
            return jours.min(fait / v);
        }
    }
    if f.atb("chemin") {
        f.set("prog", py::round_n(reste, 3));
        return jours;
    }
    f.set("prog", 0.0);
    f.set("dest", Val::None);
    let vers = f.get("vers");
    if vers.is_some() {
        let o = g.nodes.at(&vers).ats("owner");
        if g.friendly(&f.ats("owner"), &o) {
            f.set("a_quai", &vers);
        }
        f.pop("vers");
    }
    jours.min(fait / v)
}

/// Pendant le tour du joueur : sa flotte part tout de suite, dans la limite de ses jours de mer.
fn partir(g: &mut Game, f: &Val) {
    if !TT::planning(g) || f.at("owner") != g.player {
        return;
    }
    let mp = jours_restants(g, f);
    let used = avancer(g, f, mp);
    if g.flottes.has(f.at("id")) {
        f.set("mp", if f.getb("bataille") { 0.0 } else { py::round_n((mp - used).max(0.0), 3) });
    }
}

/// Les flottes ennemies qui bloquent le port où mouille cette flotte (« ses navires ne sortent pas »).
fn bloqueurs(g: &Game, f: &Val) -> Vec<Val> {
    let q = f.get("a_quai");
    if q.is_none() {
        return vec![];
    }
    blocus_actifs(g).into_iter().filter(|(_, nid)| q == *nid).map(|(b, _)| b).collect()
}

/// Commande « déplacer » : vers une place (son mouillage) ou une case de mer.
pub fn deplacer(g: &mut Game, code: &str, fid: &Val, node: &Val, x: &Val, y: &Val) -> (bool, String) {
    let f = match a_moi(g, code, fid) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let geo = g.geo.clone();
    let (but, vers) = if node.is_some() {
        if !g.valid_node(node) {
            return (false, "Lieu inconnu.".to_string());
        }
        match case_port(&geo, node.i()) {
            Some(c) => (c, node.clone()),
            None => return (false, "Cette place n'a pas de port de mer.".to_string()),
        }
    } else {
        let fini = |v: &Val| v.num().is_some_and(|n| n.f().is_finite());
        if !(fini(x) && fini(y)) {
            return (false, "Destination invalide.".to_string());
        }
        match mer_pres(&geo, x.f(), y.f(), 3) {
            Some(c) => (c, Val::None),
            None => return (false, "Ce n'est pas la mer.".to_string()),
        }
    };
    // un port bloqué : on ne sort que pour attaquer les bloqueurs
    let bl = bloqueurs(g, &f);
    if !bl.is_empty() && !bl.iter().any(|b| dist(b, but.0 as f64 + 0.5, but.1 as f64 + 0.5) <= R::CONTACT_MER + 1.0) {
        return (false, "Le port est bloqué : la flotte ne sort que pour attaquer les bloqueurs.".to_string());
    }
    let Some(ch) = chemin_mer(&geo, case(&f), but) else {
        return (false, "Aucune route de mer ne mène là.".to_string());
    };
    if ch.is_empty() && vers.is_none() && f.get("a_quai").is_some() {
        // (sortir du port sur la case même du mouillage : attaquer les bloqueurs qui y sont)
        f.set("a_quai", Val::None);
        if navale::rencontre(g, &f) {
            return (true, "L'ennemi en vue : la bataille navale s'engage.".to_string());
        }
    }
    f.set("chemin", ch.iter().map(|&(cx, cy)| list![cx, cy]).collect::<Val>());
    f.set("dest", list![but.0, but.1]);
    f.set("prog", 0.0);
    if vers.is_some() {
        f.set("vers", &vers);
    } else {
        f.pop("vers");
    }
    if TT::planning(g) && jours_restants(g, &f) <= 1e-6 {
        return (true, "Route tracée : la flotte appareillera au prochain tour.".to_string());
    }
    partir(g, &f);
    if !g.flottes.has(f.at("id")) {
        return (true, "La flotte a été détruite en chemin.".to_string());
    }
    if f.getb("bataille") {
        return (true, "L'ennemi en vue : la bataille navale s'engage.".to_string());
    }
    if f.atb("chemin") {
        return (true, "La flotte fait route ; elle arrivera dans un prochain tour.".to_string());
    }
    (true, "La flotte est arrivée.".to_string())
}

/// Une flotte vaincue se replie vers le port ami le plus proche (dix cases tout de suite, le reste en chemin).
pub fn replier(g: &mut Game, f: &Val) {
    let owner = f.ats("owner");
    let (fx, fy) = (f.atf("x"), f.atf("y"));
    let mut ports: Vec<(f64, i64, (i64, i64))> = vec![];
    for n in g.nodes.iter() {
        if g.friendly(&owner, n.at("owner").s()) {
            if let Some(c) = case_port(&g.geo, n.ati("id")) {
                ports.push((py::hypot(c.0 as f64 - fx, c.1 as f64 - fy), n.ati("id"), c));
            }
        }
    }
    ports.sort_by(|a, b| a.0.total_cmp(&b.0));
    f.set("ordre", "");
    for (_, nid, c) in ports.into_iter().take(3) {
        if let Some(ch) = chemin_mer(&g.geo, case(f), c) {
            let mut ch = ch;
            for _ in 0..10 {
                if ch.is_empty() {
                    break;
                }
                let (x, y) = ch.remove(0);
                f.set("x", x);
                f.set("y", y);
            }
            f.set("chemin", ch.iter().map(|&(cx, cy)| list![cx, cy]).collect::<Val>());
            f.set("dest", list![c.0, c.1]);
            f.set("vers", nid);
            f.set("a_quai", if ch.is_empty() { Val::from(nid) } else { Val::None });
            return;
        }
    }
    f.set("chemin", list![]);
}

/// Le pas de la campagne (Game::step) : les flottes qui ne sont pas en pause avancent, celles qui mouillent dans un port
/// ami se réparent, celles qui mouillent dans un port perdu en sortent ; le journal note les blocus qui commencent.
pub fn tick(g: &mut Game, dt: f64) {
    if !g.flottes.truthy() {
        return;
    }
    for f in g.flottes.values() {
        if !g.flottes.has(f.at("id")) {
            continue;
        }
        let q = f.get("a_quai");
        if q.is_some() {
            let o = g.nodes.at(&q).ats("owner");
            if !g.friendly(&f.ats("owner"), &o) {
                f.set("a_quai", Val::None);
            } else {
                let k = R::REPARE_JOUR * dt * (1.0 + 0.5 * (niveau_port(g, q.i()) - 1).max(0) as f64);
                for l in f.at("pv").values() {
                    for i in 0..l.len() {
                        l.set(i, py::round_n((l.atf(i) + k).min(1.0), 3));
                    }
                }
            }
        }
        if !en_pause(g, &f) {
            avancer(g, &f, dt);
        }
    }
    journal_blocus(g);
}

/// Début du tour du joueur (TT::begin_turn) : ses flottes retrouvent leurs jours de mer et reprennent leur route.
pub fn debut_tour(g: &mut Game) {
    for f in g.flottes.values() {
        f.set("mp", Val::None);
        if f.at("owner") == g.player && f.atb("chemin") && g.flottes.has(f.at("id")) {
            partir(g, &f);
        }
    }
}

// ================================================================== transport
/// Commande « embarquer » : l'armée, au repos dans la place où la flotte mouille, monte à bord (capacité de la flotte).
pub fn embarquer(g: &mut Game, code: &str, fid: &Val, aid: &Val) -> (bool, String) {
    let f = match a_moi(g, code, fid) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let a = if aid.is_str() { g.armies.get(aid) } else { Val::None };
    if !a.truthy() || a.at("owner") != code {
        return (false, "Armée introuvable.".to_string());
    }
    if f.get("bord").truthy() {
        return (false, "Une armée est déjà à bord.".to_string());
    }
    if f.get("a_quai").is_none() || a.at("at_node") != f.at("a_quai") {
        return (false, "La flotte doit mouiller dans la place où se trouve l'armée.".to_string());
    }
    if a.at("state") != "idle" || a.atb("battle") {
        return (false, "L'armée doit être au repos.".to_string());
    }
    let men = effectif(&a);
    let cap = capacite(&f);
    if men > cap {
        return (false, format!("Pas assez de place à bord : {} hommes pour {} places.", py::round(men), py::round(cap)));
    }
    if a.getb("rg") {
        AA::rangs_stop(g, &a, "l'armée embarque");
    }
    g.armies.del(aid);
    a.update(&dict! {"path" => list![], "target" => Val::None, "at_node" => Val::None, "edge" => Val::None, "boat" => false, "rail" => false});
    f.set("bord", &a);
    f.set("armee", aid);
    (true, format!("La {} embarque ({} hommes).", a.at("name"), py::round(men)))
}

/// Commande « débarquer » : dans la place où la flotte mouille, sinon sur la côte la plus proche (à deux cases), vers
/// (x, y) si on le donne. L'armée débarquée ne marche plus ce tour.
pub fn debarquer(g: &mut Game, code: &str, fid: &Val, x: &Val, y: &Val) -> (bool, String) {
    let f = match a_moi(g, code, fid) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let a = armee_a_bord(&f);
    if !a.truthy() {
        return (false, "Aucune armée à bord.".to_string());
    }
    let q = f.get("a_quai");
    let (px, py_, node) = if q.is_some() {
        let (nx, ny) = g.node_xy(q.i());
        (nx, ny, q.clone())
    } else {
        let geo = g.geo.clone();
        let couts = geo.cell_costs();
        let (fx, fy) = (f.ati("x"), f.ati("y"));
        let (vx, vy) = if x.num().is_some() && y.num().is_some() { (x.f(), y.f()) } else { (fx as f64 + 0.5, fy as f64 + 0.5) };
        let mut best: Option<(f64, i64, i64)> = None;
        for dy in -2..=2i64 {
            for dx in -2..=2i64 {
                let c = geo.cell((fx + dx) as f64 + 0.5, (fy + dy) as f64 + 0.5);
                if c >= 0 && couts[c as usize].is_some() {
                    let d = py::hypot((fx + dx) as f64 + 0.5 - vx, (fy + dy) as f64 + 0.5 - vy);
                    if best.is_none_or(|b| d < b.0) {
                        best = Some((d, fx + dx, fy + dy));
                    }
                }
            }
        }
        let Some((_, cx, cy)) = best else {
            return (false, "Aucune côte où débarquer ici : approchez la flotte du rivage.".to_string());
        };
        (cx as f64 + 0.5, cy as f64 + 0.5, Val::None)
    };
    f.pop("bord");
    f.set("armee", Val::None);
    a.update(&dict! {"x" => px, "y" => py_, "at_node" => &node, "state" => "idle", "onroad" => node.is_some(), "path" => list![]});
    if TT::planning(g) && code == g.player {
        a.set("mp", 0.0); // le débarquement prend le tour
    }
    g.armies.set(a.at("id"), &a);
    let ou = if node.is_some() { format!("à {}", AA::place(g, node.i())) } else { "sur la côte".to_string() };
    (true, format!("La {} débarque {ou}.", a.at("name")))
}

/// Une armée qui fait du cabotage seule (Game::move_army, sur une voie de mer) croise une flotte ennemie : elle est
/// interceptée (navale::interception) et regagne le port d'où elle venait. Rend vrai si c'est arrivé.
pub fn intercepte(g: &mut Game, a: &Val) -> bool {
    if !g.flottes.truthy() || !a.getb("boat") {
        return false;
    }
    let owner = a.ats("owner");
    let (ax, ay) = (a.atf("x"), a.atf("y"));
    let f = g.flottes.values().into_iter().find(|f| {
        f.get("a_quai").is_none() && !f.getb("bataille") && g.at_war(f.at("owner").s(), &owner) && dist(f, ax, ay) <= R::CONTACT_MER
    });
    let Some(f) = f else { return false };
    let leg = if a.atb("path") { a.at("path").at(0) } else { Val::None };
    navale::interception(g, &f, a);
    if g.armies.has(a.at("id")) {
        let frm = if leg.is_some() { leg.get("frm") } else { Val::None };
        let frm = if frm.is_some() { frm } else { g.nearest_node(ax, ay, None, 1e9) };
        let (nx, ny) = g.node_xy(frm.i());
        a.update(&dict! {"path" => list![], "target" => Val::None, "x" => nx, "y" => ny, "at_node" => &frm, "edge" => Val::None,
                         "boat" => false, "emb" => 0.0, "state" => "idle", "onroad" => true});
        if TT::planning(g) && owner == g.player {
            a.set("mp", 0.0);
        }
    }
    true
}

// ================================================================== flottes : fusion, séparation, ordres
/// Commande « fusionner » : deux flottes du camp sur la même case (ou voisines) n'en font plus qu'une.
pub fn fusionner(g: &mut Game, code: &str, fid: &Val, autre: &Val) -> (bool, String) {
    let (f, o) = match (a_moi(g, code, fid), a_moi(g, code, autre)) {
        (Ok(f), Ok(o)) => (f, o),
        (Err(e), _) | (_, Err(e)) => return e,
    };
    if f.at("id") == o.at("id") {
        return (false, "C'est la même flotte.".to_string());
    }
    if py::hypot(f.atf("x") - o.atf("x"), f.atf("y") - o.atf("y")) > 1.5 {
        return (false, "Les deux flottes doivent être côte à côte.".to_string());
    }
    if f.get("bord").truthy() && o.get("bord").truthy() {
        return (false, "Deux armées à bord : débarquez-en une d'abord.".to_string());
    }
    for (t, hp) in retirer(&o, &liste(&o).iter().map(|(t, i, _)| (t.clone(), *i)).collect::<Vec<_>>()) {
        ajouter(&f, &t, hp);
    }
    if o.get("bord").truthy() {
        f.set("bord", o.get("bord"));
        f.set("armee", o.get("armee"));
        o.pop("bord");
    }
    if !f.getb("amiral") || (o.getb("amiral") && o.at("amiral").ati("lvl") > f.at("amiral").ati("lvl")) {
        let (fa, oa) = (f.get("amiral"), o.get("amiral"));
        f.set("amiral", &oa);
        g.reserver(code, &fa);
    } else {
        g.reserver(code, &o.get("amiral"));
    }
    g.flottes.pop(o.at("id"));
    (true, format!("Les flottes ne font plus qu'une : {} navires.", nb_navires(&f)))
}

/// Commande « séparer » : `navires` {type: n} forment une nouvelle flotte sur la même case (l'armée reste à bord de
/// l'ancienne, qui doit pouvoir la porter). Rend l'identifiant de la nouvelle flotte en cas de succès.
pub fn separer(g: &mut Game, code: &str, fid: &Val, navires: &Val) -> (bool, String, Val) {
    let f = match a_moi(g, code, fid) {
        Ok(f) => f,
        Err(e) => return (e.0, e.1, Val::None),
    };
    if !navires.is_dict() || !navires.truthy() {
        return (false, "Choisissez les navires à détacher.".to_string(), Val::None);
    }
    let mut rangs: Vec<(String, usize)> = vec![];
    let mut cap = capacite(&f);
    for (t, n) in navires.items() {
        let k = if n.num().is_some() { n.i() } else { -1 };
        let l = f.at("pv").get(&t);
        if !t.is_str() || !l.truthy() || k < 0 || k as usize > l.len() {
            return (false, "Navires invalides.".to_string(), Val::None);
        }
        // les derniers de chaque type (les plus récents)
        for i in (l.len() - k as usize)..l.len() {
            rangs.push((t.string(), i));
        }
        cap -= R::NAVIRES().at(&t).atf("transport") * k as f64;
    }
    if rangs.is_empty() || rangs.len() as i64 >= nb_navires(&f) {
        return (false, "Il faut laisser au moins un navire et en détacher au moins un.".to_string(), Val::None);
    }
    if effectif(&armee_a_bord(&f)) > cap {
        return (false, "La flotte ne pourrait plus porter son armée.".to_string(), Val::None);
    }
    let n = nouvelle(g, code, case(&f), &f.get("a_quai"));
    for (t, hp) in retirer(&f, &rangs) {
        ajouter(&n, &t, hp);
    }
    (true, format!("Nouvelle flotte de {} navires.", nb_navires(&n)), n.at("id"))
}

/// Commande « ordre » : blocus (node : le port ennemi visé, la flotte s'y rend), commerce (cible : un comptoir, R3),
/// corsaire (cible : le camp dont on pille les routes, R3 ; pas avec des flûtes seules), route (route : une route
/// maritime vers un autre théâtre, R4), ou "" pour aucun. Les ordres commerce, corsaire et route sont gardés tels quels :
/// les modules commerce et monde les exécutent.
pub fn ordre(g: &mut Game, code: &str, fid: &Val, body: &Val) -> (bool, String) {
    let f = match a_moi(g, code, fid) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let o = body.get("ordre");
    let o = if o.is_str() { o.string() } else { String::new() };
    if !ORDRES.contains(&o.as_str()) {
        return (false, "Ordre inconnu.".to_string());
    }
    match o.as_str() {
        "" => {
            f.update(&dict! {"ordre" => "", "cible" => Val::None, "route" => Val::None});
            (true, "La flotte n'a plus d'ordre.".to_string())
        }
        "blocus" => {
            let node = body.get("node");
            if !g.valid_node(&node) || case_port(&g.geo, node.i()).is_none() {
                return (false, "Choisissez un port de mer.".to_string());
            }
            let po = g.nodes.at(&node).ats("owner");
            if !g.at_war(code, &po) {
                return (false, "On ne bloque que le port d'un ennemi.".to_string());
            }
            let c = case_port(&g.geo, node.i()).unwrap();
            let (ok, msg) = deplacer(g, code, fid, &Val::None, &Val::from(c.0 as f64 + 0.5), &Val::from(c.1 as f64 + 0.5));
            if !ok {
                return (false, msg);
            }
            if g.flottes.has(fid) {
                f.update(&dict! {"ordre" => "blocus", "cible" => &node, "route" => Val::None});
            }
            (true, format!("Blocus {} : {}", R::de(&AA::place(g, node.i())), msg))
        }
        "corsaire" => {
            if f.at("navires").keys().iter().all(|t| t == "flute") {
                return (false, "Des flûtes ne font pas la course : il faut des navires armés.".to_string());
            }
            let c = body.get("cible");
            if c.is_some() && (!g.factions.has(&c) || c == code) {
                return (false, "Camp inconnu.".to_string());
            }
            f.update(&dict! {"ordre" => "corsaire", "cible" => c, "route" => Val::None});
            (true, "La flotte fait la course.".to_string())
        }
        _ => {
            // commerce et route : gardés pour les modules commerce (R3) et monde (R4)
            let r = body.get("route");
            f.update(&dict! {"ordre" => &o, "cible" => body.get("cible"), "route" => if r.is_str() { r } else { Val::None }});
            (true, if o == "commerce" { "La flotte part commercer.".to_string() } else { "La flotte prend la route.".to_string() })
        }
    }
}

// ================================================================== blocus
/// Les blocus en cours : (flotte, place) pour chaque flotte en ordre blocus, en guerre avec le maître du port et à moins
/// de BLOCUS_CASES de son mouillage.
pub fn blocus_actifs(g: &Game) -> Vec<(Val, i64)> {
    let mut out = vec![];
    for f in g.flottes.values() {
        if f.at("ordre") != "blocus" || f.getb("bataille") || !f.at("cible").is_some() {
            continue;
        }
        let nid = f.ati("cible");
        if !g.at_war(f.at("owner").s(), g.nodes.at(nid).at("owner").s()) {
            continue;
        }
        if let Some((cx, cy)) = case_port(&g.geo, nid) {
            if dist(&f, cx as f64 + 0.5, cy as f64 + 0.5) <= R::BLOCUS_CASES {
                out.push((f, nid));
            }
        }
    }
    out
}

/// La place est-elle bloquée par mer ?
pub fn bloque(g: &Game, nid: i64) -> bool {
    blocus_actifs(g).iter().any(|(_, n)| *n == nid)
}

/// Les ports bloqués par mer (un set de numéros de places), pour Game::compute_blockades : ils ne commercent plus.
pub fn blocus_ports(g: &Game) -> Val {
    let s = pyset![];
    for (_, nid) in blocus_actifs(g) {
        s.push(nid);
    }
    s
}

/// Le journal : un blocus qui commence ou qui finit, pour le joueur (son port, ou sa flotte).
fn journal_blocus(g: &mut Game) {
    let actifs = blocus_actifs(g);
    for f in g.flottes.values() {
        let now = actifs.iter().find(|(b, _)| b.is(&f)).map(|x| x.1);
        let avant = f.get("bloque");
        if now.map(Val::from).unwrap_or(Val::None) == avant {
            continue;
        }
        f.set("bloque", now);
        let Some(nid) = now else { continue };
        let po = g.nodes.at(nid).ats("owner");
        let fo = f.ats("owner");
        if po == g.player || fo == g.player {
            let gn = g.geo.nodes.at(nid);
            let t = format!("Blocus {} par la flotte {} : le port ne commerce plus par mer, ses navires ne sortent plus.",
                R::de(&gn.ats("name")), R::de(&g.fname(&fo)));
            g.log("siege", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &fo, "important" => po == g.player});
        }
    }
}

// ================================================================== commandes et vue
/// `{cmd: "flotte", sub, …}` (serveur) : construire {node, type}, deplacer {flotte, node | x, y}, fusionner {flotte,
/// autre}, separer {flotte, navires}, embarquer {flotte, army}, debarquer {flotte, x?, y?}, ordre {flotte, ordre, node?,
/// cible?, route?}. Rend {ok, msg} (et id : la nouvelle flotte de « separer »).
pub fn commande(g: &mut Game, code: &str, body: &Val) -> Val {
    let sub = body.get("sub");
    let sub = if sub.is_str() { sub.string() } else { String::new() };
    let fid = body.get("flotte");
    if sub != "construire" {
        if let Some(why) = TT::lock_reason(g) {
            return dict! {"ok" => false, "msg" => why};
        }
    }
    let (ok, msg) = match sub.as_str() {
        "construire" => {
            let node = body.get("node");
            if !g.valid_node(&node) {
                return dict! {"ok" => false, "msg" => "Lieu inconnu."};
            }
            construire(g, code, node.i(), &body.get("type"))
        }
        "deplacer" => deplacer(g, code, &fid, &body.get("node"), &body.get("x"), &body.get("y")),
        "fusionner" => fusionner(g, code, &fid, &body.get("autre")),
        "separer" => {
            let (ok, msg, id) = separer(g, code, &fid, &body.get("navires"));
            return dict! {"ok" => ok, "msg" => msg, "id" => id};
        }
        "embarquer" => embarquer(g, code, &fid, &body.get("army")),
        "debarquer" => debarquer(g, code, &fid, &body.get("x"), &body.get("y")),
        "ordre" => ordre(g, code, &fid, body),
        _ => (false, "Commande de flotte inconnue.".to_string()),
    };
    if ok && TT::planning(g) {
        TT::settle(g); // (une bataille réglée par le général, des armées débarquées : comme après un ordre de marche)
    }
    dict! {"ok" => ok, "msg" => msg}
}

/// La vue pour la page (views::player_state) : `flottes`, `blocus`, et les batailles navales ajoutées à `battles`.
/// seen : ce que le joueur voit (views::_seer).
pub fn vue(g: &mut Game, out: &Val, seen: &dyn Fn(f64, f64) -> bool) {
    let p = g.player.clone();
    let flottes = list![];
    for f in g.flottes.values() {
        let o = f.ats("owner");
        let moi = o == p;
        let ami = g.friendly(&p, &o);
        if !ami && !seen(f.atf("x") + 0.5, f.atf("y") + 0.5) {
            continue;
        }
        let a = armee_a_bord(&f);
        let hp = liste(&f);
        let pv = if hp.is_empty() { 0.0 } else { hp.iter().map(|x| x.2).sum::<f64>() / hp.len() as f64 };
        let d = dict! {"id" => f.at("id"), "proprio" => &o, "case" => list![f.at("x"), f.at("y")], "navires" => f.at("navires"),
                       "chemin" => if moi { f.at("chemin") } else { list![] }, "a_quai" => f.get("a_quai"),
                       "armee" => if a.truthy() { dict!{"id" => a.at("id"), "effectif" => py::round(effectif(&a))} } else { Val::None },
                       "ordre" => f.get_or("ordre", ""), "pv" => py::round_n(pv, 2), "bataille" => f.get("bataille")};
        if moi {
            d.update(&dict! {"cible" => f.get("cible"), "route" => f.get("route"), "mp" => py::round_n(jours_restants(g, &f), 1),
                             "amiral" => crate::views::_gen(&f.get("amiral")), "vitesse" => py::round_n(vitesse(g, &f), 1),
                             "capacite" => py::round(capacite(&f))});
        }
        flottes.push(d);
    }
    let blocus = list![];
    for (f, nid) in blocus_actifs(g) {
        let o = f.ats("owner");
        if g.friendly(&p, &o) || g.nodes.at(nid).at("owner") == p || seen(f.atf("x") + 0.5, f.atf("y") + 0.5) {
            blocus.push(dict! {"flotte" => f.at("id"), "ville" => nid, "lieu" => list![f.at("x"), f.at("y")]});
        }
    }
    out.set("flottes", flottes);
    out.set("blocus", blocus);
    let battles = out.at("battles");
    for bt in g.navales.values() {
        if navale::concerne(g, &bt) || seen(bt.atf("x"), bt.atf("y")) {
            battles.push(navale::vue(g, &bt));
        }
    }
}
