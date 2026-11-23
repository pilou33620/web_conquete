//! Le commerce maritime (SPEC-EMPIRE, module 7) : denrées coloniales et leur prix mondial, comptoirs en mer, routes
//! commerciales nées des accords, corsaires et incidents, traversées d'un théâtre à l'autre (ordre « route »).
//!
//! `g.commerce` (sauvegardé) : dict(
//! - comptoirs : [{id, nom, x, y, theatre, denree, places, navires: [{flotte, owner}]}], faits de `g.geo.comptoirs` ;
//! - routes : {id: {id, proprio, partenaire, de, vers (places, ou None : pas de chemin), chemin [[x, y]…], boite [x0, y0,
//!   x1, y1], ports (nombre de ports des deux camps quand on a cherché), valeur (livres par jour pour chacun), coupee
//!   (None | "blocus" | "ennemi" | "corsaire")}}, une par accord commercial (`id` = "a-b", a < b) ;
//! - marche : {denrée: {prix, offre, demande}}, refait chaque mois ;
//! - en_mer : {fid: flotte} : les flottes en traversée, sorties de g.flottes (rien ne les voit ni ne les combat), avec
//!   `en_mer` {route, arrivee (jour de la partie)}).
//!
//! Le revenu se calcule une fois par mois (`mois`) en livres par jour, rangé dans `f._mer` {plantations, comptoirs, routes,
//! corsaires} ; compute_income l'ajoute au commerce du camp. Le calcul reste léger : les chemins des routes ne se
//! recherchent que quand l'accord naît ou qu'un de leurs ports change de main. Sur les théâtres seulement (l'Europe, les
//! colonies, le monde) : l'Aquitaine n'a ni routes ni denrées.

use super::marine as M;
use super::*;

// ================================================================== l'état
/// `g.commerce`, complété au besoin (les comptoirs de la carte, les dicts vides).
pub fn etat(g: &mut Game) -> Val {
    if !g.commerce.is_dict() {
        g.commerce = dict! {};
    }
    let c = g.commerce.clone();
    if !c.has("comptoirs") {
        let l: Val = g.geo.comptoirs.iter().map(|k| {
            dict! {"id" => k.at("id"), "nom" => k.at("nom"), "x" => k.at("x"), "y" => k.at("y"), "theatre" => k.at("theatre"),
                   "denree" => k.at("denree"), "places" => R::COMPTOIR_PLACES, "navires" => list![]}
        }).collect();
        c.set("comptoirs", l);
    }
    for k in ["routes", "marche", "en_mer"] {
        if !c.has(k) {
            c.set(k, dict! {});
        }
    }
    c
}

fn partie(g: &Game, k: &str) -> Val {
    if g.commerce.is_dict() { g.commerce.get_or(k, dict! {}) } else { dict! {} }
}

/// Les flottes en traversée (hors de g.flottes).
pub fn en_mer(g: &Game) -> Vec<Val> {
    partie(g, "en_mer").values()
}

/// La flotte fid est-elle en traversée ?
pub fn est_en_mer(g: &Game, fid: &Val) -> bool {
    fid.is_str() && partie(g, "en_mer").has(fid)
}

// ================================================================== denrées et plantations
/// La denrée coloniale d'une place, d'après sa géographie (théâtre, latitude, longitude) : stable d'une partie à
/// l'autre. None en Europe et en Aquitaine.
pub fn denree_place(geo: &GeoMap, nid: i64) -> Option<&'static str> {
    let t = geo.theatre_de(nid)?;
    let gn = geo.nodes.at(nid);
    let (lat, lon) = (geo.lat_of(gn.atf("y")), geo.lon_of(gn.atf("x")));
    Some(match t {
        "amerique" if lat >= 44.0 => "fourrures",
        "amerique" if lat >= 35.0 => "tabac",
        "amerique" if lat >= 29.0 => "coton",
        "amerique" if lat >= 23.0 => "indigo",
        "amerique" => if lon < -72.0 { "cafe" } else { "sucre" },
        "bresil" if lat >= -10.0 => "sucre",
        "bresil" if lat >= -16.0 => "tabac",
        "bresil" => "cafe",
        "inde" if lat >= 25.0 => "the",
        "inde" if lat >= 20.0 => "indigo",
        "inde" if lat >= 14.0 => "coton",
        "inde" => "epices",
        "guinee" => "ivoire",
        "madagascar" => if lon < 41.0 { "ivoire" } else { "epices" },
        "indes_orientales" => if lat < -5.0 { "cafe" } else { "epices" },
        _ => return None,
    })
}

/// Unités de denrée que la place produit (chaîne `plantation` : `fx.denree` 1, 2, 3), 0 sans plantation.
pub fn production(n: &Val) -> f64 {
    if CT::niveau(n, "plantation") == 0 { 0.0 } else { CT::bfx(n).get_or("denree", 0).f() }
}

/// Le prix d'une denrée pour une offre donnée (en unités) : base × (demande / offre)^0,5, borné.
pub fn prix(denree: &str, offre: f64) -> f64 {
    let base = R::DENREES().at(denree).atf("prix");
    let (lo, hi) = R::DENREE_PRIX;
    base * (R::DENREE_DEMANDE / offre.max(1e-3)).sqrt().clamp(lo, hi)
}

/// Le prix du marché (celui du dernier mois, sinon le prix de base).
pub fn prix_du_mois(g: &Game, denree: &str) -> f64 {
    let m = partie(g, "marche").get(denree);
    if m.truthy() { m.atf("prix") } else { R::DENREES().at(denree).atf("prix") }
}

// ================================================================== ports et routes
/// Un port de mer (cities::port_de_mer : un mouillage des flottes, ou un quai sur une voie d’eau marine).
pub fn port_de_mer(g: &Game, nid: i64) -> bool {
    CT::port_de_mer(g, nid)
}

thread_local! {
    /// Les ports de mer de la dernière carte vue (la géographie ne change pas) : (la carte, ses ports).
    static PORTS: std::cell::RefCell<(std::rc::Weak<GeoMap>, Rc<Vec<i64>>)> = std::cell::RefCell::new((std::rc::Weak::new(), Rc::new(vec![])));
}

/// Tous les ports de mer de la carte, relevés une fois par carte (chaque accord en a besoin).
fn ports_de_mer(g: &Game) -> Rc<Vec<i64>> {
    PORTS.with(|c| {
        let mut c = c.borrow_mut();
        if !c.0.upgrade().is_some_and(|m| Rc::ptr_eq(&m, &g.geo)) {
            let l = (0..g.geo.nodes.len() as i64).filter(|&nid| g.geo.nodes.at(nid).at("spec").has("port") && port_de_mer(g, nid)).collect();
            *c = (Rc::downgrade(&g.geo), Rc::new(l));
        }
        c.1.clone()
    })
}

/// Les ports de mer de chaque camp : {camp: [places, des plus peuplées aux moins peuplées]}.
fn ports_par_camp(g: &Game) -> HashMap<String, Vec<i64>> {
    let mut out: HashMap<String, Vec<(f64, i64)>> = HashMap::new();
    for &nid in ports_de_mer(g).iter() {
        let n = g.nodes.at(nid);
        out.entry(n.ats("owner")).or_default().push((n.get_or("pop", 0).f(), nid));
    }
    out.into_iter()
        .map(|(k, mut v)| {
            v.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
            (k, v.into_iter().map(|x| x.1).collect())
        })
        .collect()
}

/// Le chemin d'une route entre les camps a et b : leurs ports principaux (les plus peuplés) dans un théâtre où ils ont
/// tous deux un port, de préférence celui de la capitale de a, puis de b. (de, vers, chemin) ou None.
fn tracer(g: &Game, pa: &[i64], pb: &[i64], a: &str, b: &str) -> Option<(i64, i64, Vec<(i64, i64)>)> {
    let geo = &g.geo;
    let mut theatres: Vec<Option<&'static str>> = vec![];
    for code in [a, b] {
        let cap = g.capital_of(code);
        if cap.is_some() {
            theatres.push(geo.theatre_de(cap.i()));
        }
    }
    theatres.extend(pa.iter().map(|&n| geo.theatre_de(n)));
    let mut vus: Vec<Option<&'static str>> = vec![];
    for t in theatres {
        if vus.contains(&t) {
            continue;
        }
        vus.push(t);
        let (Some(&x), Some(&y)) = (pa.iter().find(|&&n| geo.theatre_de(n) == t), pb.iter().find(|&&n| geo.theatre_de(n) == t)) else {
            continue;
        };
        if let (Some(cx), Some(cy)) = (M::case_port(geo, x), M::case_port(geo, y)) {
            if let Some(ch) = M::chemin_mer(geo, cx, cy) {
                let mut ch = ch;
                ch.insert(0, cx);
                return Some((x, y, ch));
            }
        }
    }
    None
}

/// La route de l'accord entre a et b, (re)faite : chemin cherché, ou une route sans chemin (de = None) qu'on ne
/// recherche plus tant que le nombre de ports des deux camps ne change pas.
fn faire_route(g: &mut Game, a: &str, b: &str, ports: &HashMap<String, Vec<i64>>) -> Val {
    let (a, b) = if a < b { (a, b) } else { (b, a) };
    let vide = vec![];
    let (pa, pb) = (ports.get(a).unwrap_or(&vide), ports.get(b).unwrap_or(&vide));
    let r = dict! {"id" => format!("{a}-{b}"), "proprio" => a, "partenaire" => b, "de" => Val::None, "vers" => Val::None,
                   "chemin" => list![], "boite" => Val::None, "ports" => pa.len() + pb.len(), "valeur" => 0.0, "coupee" => Val::None};
    if !pa.is_empty() && !pb.is_empty() {
        if let Some((x, y, ch)) = tracer(g, pa, pb, a, b) {
            let (x0, y0) = ch.iter().fold((i64::MAX, i64::MAX), |m, c| (m.0.min(c.0), m.1.min(c.1)));
            let (x1, y1) = ch.iter().fold((i64::MIN, i64::MIN), |m, c| (m.0.max(c.0), m.1.max(c.1)));
            r.update(&dict! {"de" => x, "vers" => y, "chemin" => ch.iter().map(|&(cx, cy)| list![cx, cy]).collect::<Val>(),
                             "boite" => list![x0, y0, x1, y1]});
        }
    }
    let c = etat(g);
    c.at("routes").set(r.at("id"), &r);
    r
}

/// Un accord commercial vient d'être signé (diplomacy::apply) : sa route naît tout de suite.
pub fn accord(g: &mut Game, a: &str, b: &str) {
    if !g.theatre() {
        return; // (le commerce maritime est celui des théâtres : l'Aquitaine n'a ni routes ni denrées)
    }
    let ports = ports_par_camp(g);
    faire_route(g, a, b, &ports);
    if a == g.player || b == g.player {
        revenus(g); // (le joueur voit tout de suite ce que lui rapporte la route ; les IA attendent le mois)
    }
}

/// La route est-elle à refaire ? (un de ses ports a changé de main, ou les ports des camps ont changé alors qu'elle n'avait
/// pas de chemin)
fn a_refaire(g: &Game, r: &Val, ports: &HashMap<String, Vec<i64>>) -> bool {
    if r.at("de").is_none() {
        let n = ports.get(r.at("proprio").s()).map_or(0, Vec::len) + ports.get(r.at("partenaire").s()).map_or(0, Vec::len);
        return r.ati("ports") as usize != n;
    }
    g.nodes.at(r.at("de")).at("owner") != r.at("proprio") || g.nodes.at(r.at("vers")).at("owner") != r.at("partenaire")
}

/// Une flotte de guerre (au moins un navire armé : les flûtes ne coupent rien).
pub fn de_guerre(f: &Val) -> bool {
    f.at("navires").keys().iter().any(|t| t != "flute")
}

/// La route est-elle coupée, et par qui : ("blocus", None), ("ennemi" | "corsaire", la flotte). Un port bloqué, ou une
/// flotte armée en guerre avec l'un des deux camps (ou un corsaire qui vise l'un d'eux) à une case près du chemin.
pub fn coupure(g: &Game, r: &Val) -> Option<(&'static str, Val)> {
    if r.at("de").is_none() {
        return None;
    }
    if g._blockade.has(r.at("de")) || g._blockade.has(r.at("vers")) {
        return Some(("blocus", Val::None));
    }
    let (a, b) = (r.ats("proprio"), r.ats("partenaire"));
    let bx = r.at("boite");
    let (x0, y0, x1, y1) = (bx.ati(0), bx.ati(1), bx.ati(2), bx.ati(3));
    for f in g.flottes.values() {
        if f.get("a_quai").is_some() || !de_guerre(&f) {
            continue;
        }
        let o = f.ats("owner");
        let corsaire = f.get("ordre") == "corsaire" && (f.get("cible") == a.as_str() || f.get("cible") == b.as_str());
        if !corsaire && !g.at_war(&o, &a) && !g.at_war(&o, &b) {
            continue;
        }
        let (fx, fy) = (f.ati("x"), f.ati("y"));
        if fx < x0 - 1 || fx > x1 + 1 || fy < y0 - 1 || fy > y1 + 1 {
            continue;
        }
        if r.at("chemin").iter().any(|c| (c.at(0).i() - fx).abs() <= 1 && (c.at(1).i() - fy).abs() <= 1) {
            return Some((if corsaire { "corsaire" } else { "ennemi" }, f));
        }
    }
    None
}

/// La route que ce corsaire coupe en ce moment, s'il en coupe une.
pub fn coupure_par(g: &Game, f: &Val) -> Option<Val> {
    partie(g, "routes").values().into_iter().find(|r| coupure(g, r).is_some_and(|(_, x)| x.is(f)))
}

// ================================================================== comptoirs
/// Le comptoir de cet identifiant (dans g.commerce), ou None.
pub fn comptoir(g: &mut Game, id: &Val) -> Val {
    if !id.is_str() {
        return Val::None;
    }
    etat(g).at("comptoirs").iter().find(|c| c.at("id") == *id).unwrap_or(Val::None)
}

fn sur_place(f: &Val, c: &Val) -> bool {
    M::dist(f, c.atf("x") + 0.5, c.atf("y") + 0.5) <= 1.5
}

/// Les flottes qui occupent vraiment le comptoir (en ordre commerce, sur sa case, pas au combat) ; la liste est remise à
/// jour.
fn occupants(g: &Game, c: &Val) -> Vec<Val> {
    let mut out = vec![];
    let garde = list![];
    for e in c.at("navires").iter() {
        let f = g.flottes.get(e.at("flotte"));
        if f.truthy() && f.get("ordre") == "commerce" && f.get("cible") == c.at("id") && sur_place(&f, c) && f.at("navires").has("flute") {
            out.push(f);
            garde.push(e);
        }
    }
    c.set("navires", garde);
    out
}

/// Une flotte marchande arrive sur son comptoir : elle y prend une place s'il en reste.
fn occuper(g: &mut Game, f: &Val) {
    let c = comptoir(g, &f.get("cible"));
    if !c.truthy() || !sur_place(f, &c) {
        return;
    }
    let occ = occupants(g, &c);
    if occ.iter().any(|o| o.is(f)) {
        return;
    }
    let o = f.ats("owner");
    if (occ.len() as i64) < c.ati("places") {
        c.at("navires").push(dict! {"flotte" => f.at("id"), "owner" => &o});
        if o == g.player {
            let t = format!("Vos marchands s'installent au comptoir {} ({}).", R::de(&c.ats("nom")), R::DENREES().at(c.at("denree")).ats("nom").to_lowercase());
            g.log("eco", &t, &dict! {"x" => c.at("x"), "y" => c.at("y")});
        }
        revenus(g);
    } else if o == g.player {
        let t = format!("Le comptoir {} est plein : vos marchands attendent qu'une place se libère.", R::de(&c.ats("nom")));
        g.log("eco", &t, &dict! {"x" => c.at("x"), "y" => c.at("y")});
    }
}

/// Une flotte de guerre ennemie (en guerre avec un des marchands) sur le comptoir : la flotte, ou None.
fn disputeur(g: &Game, c: &Val, occ: &[Val]) -> Option<Val> {
    g.flottes.values().into_iter().find(|f| {
        f.get("a_quai").is_none() && !f.getb("bataille") && de_guerre(f) && sur_place(f, c)
            && occ.iter().any(|o| g.at_war(f.at("owner").s(), o.at("owner").s()))
    })
}

/// Unités de denrée que la flotte vend au comptoir : ses flûtes (COMPTOIR_FLUTES au plus).
fn unites(f: &Val) -> f64 {
    f.at("navires").get_or("flute", 0).i().min(R::COMPTOIR_FLUTES) as f64
}

// ================================================================== le mois
/// Le mois du commerce (Game::monthly) : routes tenues à jour, comptoirs disputés (bataille navale), corsaires (pillage,
/// marchands pris, incidents), marché et revenus.
pub fn mois(g: &mut Game) {
    if !g.theatre() {
        return; // (pas en Aquitaine)
    }
    let c = etat(g);
    let ports = ports_par_camp(g);
    // les routes : une par accord commercial vivant ; refaite si un port a changé de main
    let mut accords: Vec<(String, String)> = vec![];
    for (a, f) in g.factions.items() {
        if !f.atb("alive") {
            continue;
        }
        for b in f.at("trade").iter() {
            if a.s() < b.s() && g.factions.has(&b) && g.factions.at(&b).atb("alive") {
                accords.push((a.string(), b.string()));
            }
        }
    }
    let routes = c.at("routes");
    for id in routes.keys() {
        if !accords.iter().any(|(a, b)| format!("{a}-{b}") == id.s()) {
            routes.del(&id);
        }
    }
    for (a, b) in &accords {
        let r = routes.get(format!("{a}-{b}"));
        if !r.truthy() || a_refaire(g, &r, &ports) {
            faire_route(g, a, b, &ports);
        }
    }
    // les comptoirs disputés : la flotte ennemie attaque les marchands (bataille navale) ; les flottes en attente
    // prennent les places libres
    for cp in c.at("comptoirs").iter() {
        let occ = occupants(g, &cp);
        if let Some(e) = disputeur(g, &cp, &occ) {
            navale::rencontre(g, &e);
        }
        let attente: Vec<Val> = g.flottes.values().into_iter()
            .filter(|f| f.get("ordre") == "commerce" && f.get("cible") == cp.at("id") && f.get("chemin").len() == 0)
            .collect();
        for f in attente {
            occuper(g, &f);
        }
    }
    // les corsaires : part du revenu des routes qu'ils coupent, marchands pris, incidents
    revenus(g);
    let mut pilleurs: Vec<(Val, String)> = vec![];
    for r in routes.values() {
        let Some(("corsaire", f)) = coupure(g, &r) else { continue };
        let cible = f.ats("cible");
        if !pilleurs.iter().any(|(p, _)| p.is(&f)) {
            pilleurs.push((f.clone(), cible.clone()));
        }
        let mut rng = Random::new_str(&format!("{}-corsaire-{}-{}-{}", g.seed, f.at("id"), r.at("id"), py::int(g.t)));
        if rng.random() < R::CORSAIRE_PRISE {
            M::ajouter(&f, "flute", 0.5);
            let o = f.ats("owner");
            if o == g.player || cible == g.player {
                let t = format!("Des corsaires {} prennent un navire marchand {} sur la route {} – {}.", R::de(&g.fname(&o)),
                    R::de(&g.fname(&cible)), g.fname(&r.ats("proprio")), g.fname(&r.ats("partenaire")));
                // (page P3) corsaire, route et victime : la page y joue l'abordage (hex/marine.js scenesCommerce)
                g.log("eco", &t, &dict! {"x" => f.at("x"), "y" => f.at("y"), "who" => &o, "important" => cible == g.player,
                    "extra" => dict!{"corsaire" => f.at("id"), "route" => r.at("id"), "victime" => &cible}});
            }
        }
    }
    for (f, cible) in pilleurs {
        let o = f.ats("owner");
        if g.at_war(&o, &cible) || !g.factions.has(&cible) {
            continue;
        }
        let mut rng = Random::new_str(&format!("{}-incident-{}-{}", g.seed, f.at("id"), py::int(g.t)));
        if rng.random() < R::CORSAIRE_INCIDENT {
            incident(g, &o, &cible);
        }
    }
}

/// Incident diplomatique : la victime des corsaires de o s'en fâche et tient un casus belli contre o.
pub fn incident(g: &mut Game, o: &str, victime: &str) {
    let rel = g.factions.at(victime).at("rel");
    rel.set(o, (rel.get_or(o, 0).i() - R::INCIDENT_REL).max(-100));
    let until = TT::deadline(g, R::CASUS_BELLI_TOURS, &[victime, o]);
    g.factions.at(victime).setdefault("cb", dict! {}).set(o, until);
    let t = format!("Incident en mer : des corsaires {} pillent les marchands {}. {} tient un casus belli contre {} : une déclaration de guerre ne fâcherait personne.",
        R::de(&g.fname(o)), R::de(&g.fname(victime)), g.fname(victime), g.fname(o));
    let important = o == g.player || victime == g.player;
    g.log("diplo", &t, &dict! {"who" => victime, "important" => important});
}

/// a tient-il un casus belli contre b (incident de corsaires) ?
pub fn casus_belli(g: &Game, a: &str, b: &str) -> bool {
    g.factions.at(a).get_or("cb", dict! {}).get_or(b, -1.0).f() > g.t
}

/// Le marché et le revenu de chaque camp (livres par jour, `f._mer`) : plantations vendues (par un port de mer libre ou une
/// route ouverte), comptoirs, routes ouvertes, pillage des corsaires. Refait chaque mois, et quand un accord naît ou
/// qu'un marchand s'installe.
pub fn revenus(g: &mut Game) {
    if !g.theatre() {
        return;
    }
    let c = etat(g);
    let routes = c.at("routes");
    let mut ouvertes: HashMap<String, f64> = HashMap::new(); // revenu des routes ouvertes, par camp
    let mut pille: HashMap<String, f64> = HashMap::new(); // pris par les corsaires, par camp
    for r in routes.values() {
        if r.at("de").is_none() {
            continue;
        }
        let (a, b) = (r.ats("proprio"), r.ats("partenaire"));
        let gross = |x: &str| g.factions.at(x).get_or("_gross_livres", 0).f().max(0.0);
        let v = R::ROUTE_BASE + R::ROUTE_PART * gross(&a).min(gross(&b));
        r.set("valeur", py::round_n(v, 2));
        match coupure(g, &r) {
            None => {
                r.set("coupee", Val::None);
                *ouvertes.entry(a).or_default() += v;
                *ouvertes.entry(b).or_default() += v;
            }
            Some((raison, f)) => {
                r.set("coupee", raison);
                if raison == "corsaire" {
                    *pille.entry(f.ats("owner")).or_default() += R::CORSAIRE_PART * v;
                }
            }
        }
    }
    // qui peut vendre : un port de mer qui n'est pas bloqué, ou une route ouverte
    let mut vend: IndexSet<String> = ouvertes.keys().cloned().collect();
    for (o, l) in ports_par_camp(g) {
        if l.iter().any(|n| !g._blockade.has(*n)) {
            vend.insert(o);
        }
    }
    // l'offre : plantations des camps qui vendent, flûtes aux comptoirs
    let denrees = R::DENREES();
    let mut offre: HashMap<String, f64> = denrees.keys().iter().map(|d| (d.string(), 0.0)).collect();
    let mut plant: Vec<(String, String, f64)> = vec![]; // (camp, denrée, unités)
    for n in g.nodes.iter() {
        let u = production(&n);
        let o = n.ats("owner");
        if u <= 0.0 || !vend.contains(&o) {
            continue;
        }
        let Some(d) = denree_place(&g.geo, n.ati("id")) else { continue };
        *offre.get_mut(d).unwrap() += u;
        plant.push((o, d.to_string(), u));
    }
    let mut compt: Vec<(String, String, f64)> = vec![];
    for cp in c.at("comptoirs").iter() {
        let occ = occupants(g, &cp);
        let disp = disputeur(g, &cp, &occ).is_some();
        for f in occ {
            if !disp {
                let u = unites(&f);
                *offre.get_mut(cp.at("denree").s()).unwrap() += u;
                compt.push((f.ats("owner"), cp.ats("denree"), u));
            }
        }
    }
    let marche = dict! {};
    for d in denrees.keys() {
        let o = offre[d.s()];
        marche.set(&d, dict! {"prix" => py::round_n(prix(d.s(), o), 2), "offre" => py::round_n(o, 1), "demande" => R::DENREE_DEMANDE});
    }
    c.set("marche", &marche);
    let px = |d: &str| marche.at(d).atf("prix");
    for (code, f) in g.factions.items() {
        let code = code.string();
        let pl: f64 = plant.iter().filter(|x| x.0 == code).map(|x| x.2 * px(&x.1) * R::PLANTATION_K).sum();
        let co: f64 = compt.iter().filter(|x| x.0 == code).map(|x| x.2 * px(&x.1)).sum();
        let ro = ouvertes.get(&code).copied().unwrap_or(0.0);
        let cs = pille.get(&code).copied().unwrap_or(0.0);
        if pl + co + ro + cs > 0.0 || f.has("_mer") {
            f.set("_mer", dict! {"plantations" => py::round_n(pl, 2), "comptoirs" => py::round_n(co, 2), "routes" => py::round_n(ro, 2),
                                 "corsaires" => py::round_n(cs, 2)});
        }
    }
    g._dirty_income = true;
}

/// Le revenu du commerce maritime d'un camp (livres par jour), pour compute_income.
pub fn revenu(f: &Val) -> f64 {
    let m = f.get("_mer");
    if m.truthy() { m.values().iter().map(|v| v.f()).sum() } else { 0.0 }
}

// ================================================================== traversées (ordre « route »)
/// Une flotte arrive au bout de son chemin (marine::avancer) : en ordre « route » sur la case de départ, elle quitte la
/// carte ; en ordre « commerce » sur son comptoir, elle y prend une place.
pub fn au_bout(g: &mut Game, f: &Val) {
    match f.get("ordre").s() {
        "route" => {
            partir(g, f);
        }
        "commerce" => occuper(g, f),
        _ => {}
    }
}

/// La flotte en ordre « route », sur la case de départ de sa route : elle disparaît en mer (g.commerce.en_mer) jusqu'au
/// début du tour d'arrivée, `tours` tours plus tard. Rend vrai si elle est partie.
pub fn partir(g: &mut Game, f: &Val) -> bool {
    let r = f.get("route");
    let Some(route) = (if r.is_str() { crate::geo::route_mer(&g.geo, r.s()) } else { None }) else { return false };
    if (f.ati("x"), f.ati("y")) != (route.at("de").at(0).i(), route.at("de").at(1).i()) || f.getb("bataille") {
        return false;
    }
    let arrivee = TT::month_end(g, &Val::None, route.ati("tours"));
    f.update(&dict! {"en_mer" => dict!{"route" => route.at("id"), "arrivee" => arrivee}, "chemin" => list![], "dest" => Val::None,
                     "a_quai" => Val::None, "prog" => 0.0});
    f.pop("vers");
    let c = etat(g);
    g.flottes.pop(f.at("id"));
    c.at("en_mer").set(f.at("id"), f);
    let o = f.ats("owner");
    if o == g.player {
        let t = format!("Votre flotte prend la mer {} : arrivée le {}.", route.ats("nom"), g.date_str(&Val::from(arrivee)));
        g.log("armee", &t, &dict! {"x" => f.at("x"), "y" => f.at("y")});
    }
    true
}

/// Les traversées finies (marine::tick, marine::debut_tour) : la flotte réapparaît sur la case d'arrivée de sa route, avec
/// l'armée embarquée s'il y en a une ; une flotte ennemie qui l'attend l'attaque.
pub fn traversees(g: &mut Game) {
    let em = if g.commerce.is_dict() { g.commerce.get("en_mer") } else { Val::None }; // (à chaque pas : sans rien allouer)
    if !em.truthy() {
        return;
    }
    for f in em.values() {
        if f.at("en_mer").atf("arrivee") > g.t + 1e-6 {
            continue;
        }
        let route = crate::geo::route_mer(&g.geo, f.at("en_mer").at("route").s());
        em.del(f.at("id"));
        f.pop("en_mer");
        if let Some(r) = &route {
            f.update(&dict! {"x" => r.at("vers").at(0), "y" => r.at("vers").at(1)});
        }
        f.update(&dict! {"ordre" => "", "route" => Val::None, "cible" => Val::None, "chemin" => list![], "dest" => Val::None});
        if TT::planning(g) && f.at("owner") == g.player {
            f.set("mp", Val::None);
        }
        g.flottes.set(f.at("id"), &f);
        let o = f.ats("owner");
        if o == g.player {
            let nom = route.map_or(String::new(), |r| format!(" ({})", r.ats("nom")));
            let t = format!("Votre flotte arrive au bout de sa traversée{nom}.");
            g.log("armee", &t, &dict! {"x" => f.at("x"), "y" => f.at("y"), "important" => true});
        }
        navale::rencontre(g, &f);
    }
}

// ================================================================== vue
/// La vue pour la page (views::player_state) : `comptoirs`, `routes_mer` (les routes commerciales), `marche`, `en_mer`
/// (les flottes en traversée du joueur et de ses alliés), et `me.mer` (le revenu du commerce maritime, livres par jour).
pub fn vue(g: &mut Game, out: &Val) {
    let c = if g.theatre() { etat(g) } else { dict! {"comptoirs" => list![], "routes" => dict!{}, "marche" => dict!{}, "en_mer" => dict!{}} };
    let p = g.player.clone();
    let comptoirs = list![];
    for cp in c.at("comptoirs").iter() {
        let occ = occupants(g, &cp);
        let disp = disputeur(g, &cp, &occ).is_some();
        comptoirs.push(dict! {"id" => cp.at("id"), "nom" => cp.at("nom"), "case" => list![cp.at("x"), cp.at("y")],
            "denree" => cp.at("denree"), "places" => cp.at("places"),
            "navires" => occ.iter().map(|f| dict!{"flotte" => f.at("id"), "proprio" => f.at("owner")}).collect::<Val>(),
            "dispute" => disp});
    }
    let routes = list![];
    for r in c.at("routes").values() {
        if r.at("de").is_none() {
            continue;
        }
        let coupee = coupure(g, &r).map(|x| x.0);
        routes.push(dict! {"id" => r.at("id"), "chemin" => r.at("chemin"), "proprio" => r.at("proprio"), "partenaire" => r.at("partenaire"),
            "de" => r.at("de"), "vers" => r.at("vers"), "valeur" => r.at("valeur"), "coupee" => coupee});
    }
    let marche = c.at("marche");
    let marche = if marche.truthy() {
        marche.copy()
    } else {
        Val::dict_from(R::DENREES().keys().into_iter().map(|d| {
            let px = R::DENREES().at(&d).at("prix");
            (d, dict! {"prix" => px, "offre" => 0.0, "demande" => R::DENREE_DEMANDE})
        }).collect())
    };
    let mer = list![];
    for f in c.at("en_mer").values() {
        let o = f.ats("owner");
        if !g.friendly(&p, &o) {
            continue;
        }
        let a = M::armee_a_bord(&f);
        let t = f.at("en_mer").at("arrivee");
        mer.push(dict! {"id" => f.at("id"), "proprio" => &o, "route" => f.at("en_mer").at("route"), "arrivee" => TT::tours_left(g, t.f()),
            "date" => g.date_str(&t), "navires" => f.at("navires"),
            "armee" => if a.truthy() { dict!{"id" => a.at("id"), "effectif" => py::round(M::effectif(&a))} } else { Val::None }});
    }
    out.set("comptoirs", comptoirs);
    out.set("routes_mer", routes);
    out.set("marche", marche);
    out.set("en_mer", mer);
    let m = g.factions.at(&p).get_or("_mer", dict! {});
    out.at("me").set("mer", m.copy());
}
