//! Porte game/engine.py, lignes 1857 à 2705 : chemins (routes et voies d'eau, ordres de marche, marche des armées, sièges).
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::*;
use crate::geo::Pt;

impl Game {
    // ------------------------------------------------------------------ chemins
    /// block : propriétaires dont les terres sont fermées (voir AA.closed_owners) ; None : comme avant, selon tr.
    /// Python : `passable_node(self, code, nid, target, tr=0, block=None)`.
    /// target : la destination (numéro de place ou None ; ne sert pas) ; tr : 0 ou 1 (AA.route_level) ;
    /// block : None, ou un set de codes (AA.closed_owners).
    // engine.py, lignes 1858 à 1869
    pub fn passable_node(&mut self, code: &str, nid: i64, target: &Val, tr: i64, block: &Val) -> bool {
        let o = self.nodes.at(nid).ats("owner");
        if block.is_some() {
            return !block.has(o.as_str());
        }
        if o == code || o == R::NEUTRAL {
            return true;
        }
        let st = self.status(code, &o);
        if st == "guerre" || st == "alliance" {
            return true;
        }
        // en traversant : avec un droit de passage
        tr != 0 && AA::has_passage(self, code, &o)
    }

    /// Coût d'un tronçon en « km de route équivalents » pour une armée marchant à `speed` km/j.
    /// Python : `edge_cost(self, code, e, frm=None, speed=22.0)`.
    /// frm : numéro de la place d'où l'on part, ou None.
    // engine.py, lignes 1871 à 1881
    pub fn edge_cost(&self, code: &str, e: &Val, frm: &Val, speed: f64) -> f64 {
        if e.get("kind") == "water" {
            let ws = self.water_speed(e, frm, &Val::None, &Val::None, true, &Val::from(code));
            return e.atf("len") * 22.0 / (if ws > 5.0 { ws } else { 5.0 });
        }
        let sp = if e.atb("royal") { 1.15 } else { 1.0 };
        let mut c = e.atf("len") / sp;
        let vit = if speed > 5.0 { speed } else { 5.0 }; // max(5.0, speed)
        if self.cut_edges().has(&e.at("id")) {
            c += vit * CR::DELAY; // route coupée par la crue : un jour de plus
        }
        if e.at("rrank") == 1i64 && self.mod_(code, "bridges", 0.0) == 0.0 {
            c += if !e.atb("ferry") { 8.0 } else { 20.0 };
        }
        c * 22.0 / vit
    }

    /// Vitesse des gabares (km/j) : courant, crues, basses eaux d'été, tempêtes sur la côte.
    /// Python : `water_speed(self, e, frm, x=None, y=None, estimate=False, code=None)`.
    /// frm : numéro de place ou None ; x, y : la position (nombres) ou None ; code : un camp ou None.
    /// (Paramètres gardés un par un, sans dict : la recherche de chemin l'appelle pour chaque arête d'eau.)
    // engine.py, lignes 1883 à 1886
    pub fn water_speed(&self, e: &Val, frm: &Val, x: &Val, y: &Val, estimate: bool, code: &Val) -> f64 {
        let k = 1.0 + if code.truthy() { self.mod_(code.s(), "river_speed", 0.0) } else { 0.0 };
        let steam = code.truthy() && self.mod_(code.s(), "upstream", 0.0) != 0.0;
        k * self._water_speed(e, frm, x, y, estimate, steam)
    }

    /// Python : `_water_speed(self, e, frm, x=None, y=None, estimate=False, steam=False)`.
    // engine.py, lignes 1888 à 1911
    pub fn _water_speed(&self, e: &Val, frm: &Val, x: &Val, y: &Val, estimate: bool, steam: bool) -> f64 {
        let way = self.geo.ways.at(&e.at("way"));
        if e.atb("sea") {
            let mut sp = R::SEA_SPEED as f64;
            let kind = self.weather.at("cote").at("kind");
            if !estimate {
                sp *= match kind.s() {
                    "tempete" => 0.12,
                    "orage" => 0.5,
                    "brouillard" => 0.7,
                    "pluie" => 0.9,
                    _ => 1.0,
                };
            }
            return sp;
        }
        let mut sp = R::WATER_SPEED as f64;
        let down = e.at("down");
        if down.is_some() && frm.is_some() {
            let downstream = down != *frm || steam; // le bateau à vapeur remonte aussi vite qu'il descend
            let flood = self.t < self.flood_until;
            if downstream {
                sp *= 1.25 * (if flood { 1.2 } else { 1.0 });
            } else {
                sp *= 0.75 * (if flood { 0.5 } else { 1.0 });
            }
        }
        let season = self.season();
        if way.atb("low_water") && season == "été" {
            sp *= 0.75;
        }
        if season == "hiver" {
            sp *= 0.9;
        }
        if !estimate && x.is_some() {
            sp *= 0.5 + 0.5 * self.wx(x.f(), y.f()).atf("move");
        }
        sp
    }

    /// Plus court chemin par les routes et les voies d'eau.
    /// start_nodes : dict nœud -> coût initial. Retourne (coût, [nœuds], [arêtes]).
    /// L'état « à bord » est suivi : embarquer et débarquer prennent du temps.
    /// block : propriétaires dont les terres sont fermées (None : places traversables selon passable_node).
    /// Leurs places ne se franchissent qu'à bord, devant le quai, sans y débarquer ni embarquer ; partie de
    /// l'une d'elles, une armée peut d'abord sortir par les routes de ce même département.
    /// rail : l'armée est déjà dans un train. modes : liste remplie avec le mode de chaque arête du chemin (0 à pied,
    /// 1 à bord, 2 en train : « Chemins de fer militaires », sur les tronçons utilisables ; monter coûte RAIL_EMBARK).
    /// Python : `road_route(self, code, start_nodes, goal, speed=22.0, boat=False, tr=0, block=None, afloat=False, rail=False, modes=None)`.
    /// start_nodes : dict {numéro de place: coût initial} ; block : None ou un set de codes ; modes : None, ou une liste
    /// que la fonction remplit (`modes.replace_all(…)`). Rend Some((coût, liste des nœuds, liste des arêtes)).
    /// (Paramètres gardés un par un : chemin chaud.)
    // engine.py, lignes 1913 à 1994
    pub fn road_route(&mut self, code: &str, start_nodes: &Val, goal: i64, speed: f64, boat: bool, tr: i64, block: &Val, afloat: bool, rail: bool, modes: &Val) -> Option<(f64, Val, Val)> {
        let bloque = block.is_some();
        if bloque && block.has(&self.nodes.at(goal).at("owner")) {
            return None;
        }
        let b0: i64 = if boat { 1 } else if rail { 2 } else { 0 };
        let rails = RL::rail_edges(self, code);
        let geo = self.geo.clone();
        let goal_v = Val::from(goal);
        let mut dist: HashMap<(i64, i64), f64> = HashMap::new();
        let mut prev: HashMap<(i64, i64), ((i64, i64), i64)> = HashMap::new();
        let mut pq: Vec<(f64, i64, i64)> = vec![];
        for (s, c0) in start_nodes.items() {
            let (s, c0) = (s.i(), c0.f());
            dist.insert((s, b0), c0);
            heapq::heappush(&mut pq, (c0, s, b0));
        }
        let mut best_goal = None;
        while let Some((mut d, u, b)) = heapq::heappop(&mut pq) {
            if d > *dist.get(&(u, b)).unwrap_or(&1e18) {
                continue;
            }
            if u == goal {
                best_goal = Some((u, b));
                break;
            }
            let ou = self.nodes.at(u).ats("owner");
            let u_start = start_nodes.has(u);
            if !u_start && ou != code && !self.friendly(code, &ou) {
                // on peut traverser un nœud hostile/neutre mais on s'y arrêtera : coût dissuasif
                // (en traversant, on ne s'arrête qu'aux places ennemies ; chez un voisin en paix, on passe)
                if (ou == R::NEUTRAL && tr == 0) || (ou != R::NEUTRAL && self.at_war(code, &ou)) {
                    d += 25.0;
                }
            }
            // place fermée : de passage seulement (une armée à flot n'y débarque pas, même au premier quai)
            let ub = bloque && block.has(ou.as_str()) && (afloat || !u_start);
            if ub && b == 0 {
                d += 30.0; // en sortant de ses terres par la route, au plus court
            }
            for eid in geo.adj.at(u).iter() {
                let e = geo.edges.at(&eid);
                let v = if e.at("a") == u { e.ati("b") } else { e.ati("a") };
                let water = e.get("kind") == "water";
                if bloque {
                    if ub && b == 1 && !water {
                        continue; // à bord devant des terres fermées : pas de débarquement
                    }
                    let ov = self.nodes.at(v).ats("owner");
                    if block.has(ov.as_str()) && !water && !(ov == ou && (u_start || ub)) {
                        continue; // on n'y entre pas par la route (sauf pour sortir de chez lui)
                    }
                } else if !self.passable_node(code, v, &goal_v, tr, &Val::None) {
                    continue;
                }
                let nb = if water { 1 } else { 0 };
                let mut nd = d + self.edge_cost(code, &e, &Val::from(u), speed);
                if water && b != 1 {
                    nd += R::EMBARK_DAYS * 22.0;
                } else if b == 1 && !water {
                    nd += R::DISEMBARK_DAYS * 22.0;
                }
                if nd < *dist.get(&(v, nb)).unwrap_or(&1e18) {
                    dist.insert((v, nb), nd);
                    prev.insert((v, nb), ((u, b), eid.i()));
                    heapq::heappush(&mut pq, (nd, v, nb));
                }
                if rails.has(&eid) {
                    // en train : le même tronçon, bien plus vite, après l'embarquement en gare
                    let nd = d + e.atf("len") * 22.0 / R::RAIL_SPEED
                        + (if b == 2 { 0.0 } else { R::RAIL_EMBARK * 22.0 })
                        + (if b == 1 { R::DISEMBARK_DAYS * 22.0 } else { 0.0 });
                    if nd < *dist.get(&(v, 2)).unwrap_or(&1e18) {
                        dist.insert((v, 2), nd);
                        prev.insert((v, 2), ((u, b), eid.i()));
                        heapq::heappush(&mut pq, (nd, v, 2));
                    }
                }
            }
        }
        let best_goal = best_goal?;
        let (mut nodes, mut eids, mut ms) = (vec![best_goal.0], vec![], vec![]);
        let mut cur = best_goal;
        while let Some(&(p, eid)) = prev.get(&cur) {
            eids.push(eid);
            ms.push(cur.1);
            nodes.push(p.0);
            cur = p;
        }
        nodes.reverse();
        eids.reverse();
        if modes.is_some() {
            ms.reverse();
            modes.replace_all(ms.into_iter().map(Val::from).collect());
        }
        Some((dist[&best_goal], nodes.into_iter().map(Val::from).collect(), eids.into_iter().map(Val::from).collect()))
    }

    /// Python : `nearest_node(self, x, y, pred=None, maxd=1000000000.0)`.
    /// pred : None, ou le filtre des places (le lambda du Python ; il reçoit la partie, que la méthode tient pendant
    /// l'appel : `Some(&mut |g, i| g.passable_node(code, i, &goal, tr, &block))`).
    /// Rend le numéro de la place la plus proche (Int), ou None.
    // engine.py, lignes 1996 à 2004
    pub fn nearest_node(&mut self, x: f64, y: f64, pred: Option<&mut dyn FnMut(&mut Game, i64) -> bool>, maxd: f64) -> Val {
        let mut pred = pred;
        let (mut best, mut bi) = (maxd, Val::None);
        let geo = self.geo.clone();
        for gn in geo.nodes.iter() {
            if let Some(p) = pred.as_deref_mut() {
                if !p(self, gn.ati("id")) {
                    continue;
                }
            }
            let d = py::hypot(gn.atf("x") - x, gn.atf("y") - y);
            if d < best {
                best = d;
                bi = gn.at("id");
            }
        }
        bi
    }

    /// Python : `edge_between(self, a, b)`.
    /// Rend l'arête (dict de geo.edges), ou None.
    // engine.py, lignes 2006 à 2011
    pub fn edge_between(&self, a: i64, b: i64) -> Val {
        for eid in self.geo.adj.at(a).iter() {
            let e = self.geo.edges.at(&eid);
            if (e.at("a") == a && e.at("b") == b) || (e.at("a") == b && e.at("b") == a) {
                return e;
            }
        }
        Val::None
    }

    /// block : propriétaires dont les terres sont fermées (None : comme avant, selon passable_node).
    /// Python : `plan_route(self, a, goal, block=None)`.
    /// block : None ou un set de codes. Rend None, ou la liste des étapes : dict(kind='off', pts, i) et
    /// dict(kind='road', e, frm, to, pos[, rail]).
    // engine.py, lignes 2013 à 2066
    pub fn plan_route(&mut self, a: &Val, goal: i64, block: &Val) -> Val {
        let code = a.ats("owner");
        let tr = AA::route_level(self, a);
        let legs = list![];
        let mut afloat = false;
        let goal_v = Val::from(goal);
        let an = a.at("at_node");
        let edge = a.at("edge");
        let starts;
        if an.is_some() {
            starts = dict! {&an => 0.0};
        } else if edge.truthy() {
            let e = self.geo.edges.at(&edge.at("e"));
            let (frm, pos) = (edge.at("frm"), edge.at("pos"));
            let to = if e.at("a") == frm { e.at("b") } else { e.at("a") };
            let here = if block.truthy() { AA::land_owner(self, a.atf("x"), a.atf("y")) } else { Val::None };
            // à bord, sur le fleuve ou la côte : l'eau est libre, on peut repartir par un bout comme par l'autre,
            // même devant une place fermée (sans y débarquer) ; sinon l'armée resterait immobilisée entre deux
            afloat = block.truthy() && a.getb("boat") && e.get("kind") == "water";
            starts = Val::dict();
            // sur la route d'une place fermée, là où l'on se trouve : on peut toujours en repartir pour sortir
            if self.passable_node(&code, frm.i(), &goal_v, tr, block) || (block.truthy() && self.nodes.at(&frm).at("owner") == here) || afloat {
                starts.set(&frm, &pos);
            }
            if self.passable_node(&code, to.i(), &goal_v, tr, block) || (block.truthy() && self.nodes.at(&to).at("owner") == here) || afloat {
                starts.set(&to, &e.at("len") - &pos);
            }
            if !starts.truthy() {
                return Val::None;
            }
        } else {
            let near =
                self.nearest_node(a.atf("x"), a.atf("y"), Some(&mut |g: &mut Game, i| g.passable_node(&code, i, &goal_v, tr, block)), 60.0);
            if near.is_none() {
                return Val::None;
            }
            let (nx, ny) = self.node_xy(near.i());
            let mask = AA::cell_mask(self, block);
            match self.geo.astar(a.atf("x"), a.atf("y"), nx, ny, 120000, mask.as_deref()) {
                Some(pts) if !pts.is_empty() => legs.push(off_leg(&pts)),
                _ => return Val::None,
            }
            starts = dict! {&near => 0.0};
        }
        let modes = list![];
        let sp = self.army_speed(a);
        let r = self.road_route(&code, &starts, goal, sp, a.getb("boat"), tr, block, afloat, a.getb("rail"), &modes);
        let Some((_, nodes, eids)) = r else {
            return Val::None;
        };
        if edge.truthy() && an.is_none() {
            let e = self.geo.edges.at(&edge.at("e"));
            let (frm, pos) = (edge.at("frm"), edge.at("pos"));
            let to = if e.at("a") == frm { e.at("b") } else { e.at("a") };
            let first = nodes.at(0);
            // (dans un train, il finit le tronçon en train s'il le peut encore)
            let on = a.getb("rail") && RL::rail_edges(self, &code).has(&e.at("id"));
            let leg = if first == to {
                dict! {"kind" => "road", "e" => e.at("id"), "frm" => &frm, "to" => &to, "pos" => &pos}
            } else {
                dict! {"kind" => "road", "e" => e.at("id"), "frm" => &to, "to" => &frm, "pos" => &e.at("len") - &pos}
            };
            if on {
                leg.set("rail", true);
            }
            legs.push(leg);
        }
        for i in 0..eids.len().min(modes.len()) {
            let leg = dict! {"kind" => "road", "e" => eids.at(i), "frm" => nodes.at(i), "to" => nodes.at(i + 1), "pos" => 0.0};
            if modes.at(i) == 2i64 {
                leg.set("rail", true);
            }
            legs.push(leg);
        }
        legs
    }

    /// Une armée à bord, au milieu d'une voie d'eau, doit d'abord gagner le prochain quai.
    /// Python : `boat_prefix(self, a)`.
    /// Rend une liste d'étapes (vide, ou une seule).
    // engine.py, lignes 2068 à 2075
    pub fn boat_prefix(&self, a: &Val) -> Val {
        if !a.getb("boat") || !a.atb("edge") || a.at("at_node").is_some() {
            return list![];
        }
        let edge = a.at("edge");
        let e = self.geo.edges.at(&edge.at("e"));
        let (frm, pos) = (edge.at("frm"), edge.at("pos"));
        let to = if e.at("a") == frm { e.at("b") } else { e.at("a") };
        list![dict! {"kind" => "road", "e" => e.at("id"), "frm" => frm, "to" => to, "pos" => pos}]
    }

    /// Position (x, y) à `pos` km du nœud `frm` le long d'une arête (tracé de la route ou voie d'eau).
    /// Python : `edge_xy(self, e, frm, pos)`.
    // engine.py, lignes 2077 à 2093
    pub fn edge_xy(&self, e: &Val, frm: i64, pos: f64) -> (f64, f64) {
        let pts = e.at("pts");
        let cum = self.geo.edge_cum.at(&e.at("id"));
        let l = e.atf("len");
        let s = if e.at("a") == frm { pos } else { l - pos };
        let s = if s < l { s } else { l };
        let s = if s > 0.0 { s } else { 0.0 };
        let (mut lo, mut hi) = (0i64, cum.len() as i64 - 1);
        while hi - lo > 1 {
            let mid = (lo + hi) / 2;
            if cum.atf(mid) <= s {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let (clo, chi) = (cum.atf(lo), cum.atf(hi));
        let mut seg = chi - clo;
        if seg == 0.0 {
            seg = 1e-9;
        }
        let f = (s - clo) / seg;
        let (plo, phi) = (pts.at(lo).xy(), pts.at(hi).xy());
        (plo.0 + (phi.0 - plo.0) * f, plo.1 + (phi.1 - plo.1) * f)
    }

    /// tr : traverser (True) ou conquérir en chemin (False), None pour garder le choix de l'armée ;
    /// force : le joueur, prévenu, passe en force sur des terres fermées (déclaration de guerre). Retourne
    /// (None, question) quand il faut d'abord sa confirmation.
    /// Python : `order_move(self, code, aid, x=None, y=None, node=None, mode=None, tr=None, force=False)`.
    /// kw : dict des arguments optionnels du Python — x, y (None ; des nombres), node (None ; int(node) est appliqué),
    /// mode (None, 'route' ou 'champs'), tr (None, ou un bool), force (False).
    // engine.py, lignes 2095 à 2125
    pub fn order_move(&mut self, code: &str, aid: &Val, kw: &Val) -> (Option<bool>, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (Some(false), "Armée introuvable.".to_string());
        }
        if a.at("state") == "battle" {
            return (Some(false), "Cette armée est engagée dans une bataille (ordonnez la retraite).".to_string());
        }
        let (x, y, mut node, mode, tr) = (kw.get("x"), kw.get("y"), kw.get("node"), kw.get("mode"), kw.get("tr"));
        let force = kw.getb("force");
        if !(mode.is_none() || mode == "route" || mode == "champs") {
            return (Some(false), "Itinéraire inconnu.".to_string());
        }
        if node.is_some() {
            node = Val::from(py::int_v(&node));
            if !self.valid_node(&node) {
                return (Some(false), "Lieu inconnu.".to_string());
            }
            let o = self.nodes.at(&node).ats("owner");
            let traverse = if tr.is_none() { a.get("tr") } else { tr.clone() };
            if o != code && o != R::NEUTRAL && self.status(code, &o) == "paix" && !traverse.truthy() && !AA::closed_to(self, code, &o) {
                return (Some(false), format!("{} appartient à {} (en paix) : on n'y entre qu'en traversant.",
                    self.geo.nodes.at(&node).at("name"), self.fname(&o)));
            }
        } else if x.is_none() || y.is_none() || !(x.f().is_finite() && y.f().is_finite()) {
            return (Some(false), "Destination invalide.".to_string());
        }
        // un ordre refusé ne doit ni lever le siège en cours ni changer l'itinéraire choisi
        let old = (a.at("mode"), a.get_or("tr", false));
        if mode.truthy() {
            a.set("mode", &mode);
        }
        if tr.is_some() {
            a.set("tr", tr.truthy());
        }
        let (ok, msg) = self._order_move(code, &a, &x, &y, &node, force);
        if ok != Some(true) {
            a.set("mode", old.0);
            a.set("tr", old.1);
        }
        (ok, msg)
    }

    /// Itinéraire selon le mode de marche de l'armée : (étapes, destination, None) ou (None, None, raison).
    /// block : propriétaires dont les terres sont fermées (None : comme avant).
    /// Python : `plan_legs(self, a, x, y, node, block=None)`.
    /// x, y : nombres ou None ; node : numéro de place ou None ; block : None ou un set de codes (vide : rien de fermé).
    /// Rend (liste d'étapes, dict(node=…) ou dict(x=…, y=…), None) ou (None, None, raison).
    // engine.py, lignes 2127 à 2168
    pub fn plan_legs(&mut self, a: &Val, x: &Val, y: &Val, node: &Val, block: &Val) -> (Val, Val, Val) {
        let code = a.ats("owner");
        let mask = AA::cell_mask(self, block);
        let mut node = node.clone();
        let err = |m: &str| (Val::None, Val::None, Val::from(m));
        if a.at("mode") == "route" {
            if node.is_none() {
                let node_near = self.nearest_node(x.f(), y.f(), None, 6.0);
                if node_near.is_some() {
                    node = node_near;
                }
            }
            if node.is_some() {
                if node == a.at("at_node") {
                    return err("L'armée y est déjà.");
                }
                let legs = self.plan_route(a, node.i(), block);
                if !legs.truthy() {
                    let terr = if self.departements() { "d’un département" } else { "d’une province" };
                    return err(&format!("Aucun chemin par les routes (territoire {terr} en paix ?). Essayez à travers champs."));
                }
                return (legs, dict! {"node" => &node}, Val::None);
            }
            // route jusqu'au nœud le plus proche puis hors route
            let near = self.nearest_node(x.f(), y.f(), Some(&mut |g: &mut Game, i| g.passable_node(&code, i, &Val::None, 0, block)), 40.0);
            let legs = if near.is_some() && near != a.at("at_node") { self.plan_route(a, near.i(), block) } else { self.boat_prefix(a) };
            if legs.is_none() {
                return err("Aucun chemin praticable.");
            }
            let (sx, sy) = if near.is_some() {
                self.node_xy(near.i())
            } else if legs.truthy() {
                self.node_xy(legs.at(-1).ati("to"))
            } else {
                (a.atf("x"), a.atf("y"))
            };
            let Some(pts) = self.geo.astar(sx, sy, x.f(), y.f(), 120000, mask.as_deref()).filter(|p| !p.is_empty()) else {
                return err("Destination inaccessible (eau, montagne ou hors de la région).");
            };
            legs.push(off_leg(&pts));
            return (legs, dict! {"x" => x, "y" => y}, Val::None);
        }
        let (x, y) = if node.is_some() {
            let (nx, ny) = self.node_xy(node.i());
            (Val::from(nx), Val::from(ny))
        } else {
            (x.clone(), y.clone())
        };
        let pre = self.boat_prefix(a);
        let (sx, sy) = if pre.truthy() { self.node_xy(pre.at(0).ati("to")) } else { (a.atf("x"), a.atf("y")) };
        let Some(pts) = self.geo.astar(sx, sy, x.f(), y.f(), 120000, mask.as_deref()).filter(|p| !p.is_empty()) else {
            return err("Destination inaccessible à travers champs (fleuve sans pont, eau ou hors région).");
        };
        let target = if node.is_some() { dict! {"node" => &node} } else { dict! {"x" => &x, "y" => &y} };
        (&pre + &list![off_leg(&pts)], target, Val::None)
    }

    /// Terres fermées où se trouve l'armée (elle peut toujours en sortir), sinon None.
    /// Python : `start_land(self, a, block)`.
    /// block : un set de codes. Rend un code ou None.
    // engine.py, lignes 2170 à 2173
    pub fn start_land(&mut self, a: &Val, block: &Val) -> Val {
        let an = a.at("at_node");
        let o = if an.is_some() { self.nodes.at(&an).at("owner") } else { AA::land_owner(self, a.atf("x"), a.atf("y")) };
        if block.has(&o) { o } else { Val::None }
    }

    /// Python : `_order_move(self, code, a, x, y, node, force=False)`.
    /// x, y, node : comme plan_legs.
    // engine.py, lignes 2175 à 2219
    pub fn _order_move(&mut self, code: &str, a: &Val, x: &Val, y: &Val, node: &Val, force: bool) -> (Option<bool>, String) {
        let mut block = AA::closed_owners(self, code);
        let mut here = self.start_land(a, &block);
        let ask = code == self.player && !self.ais.contains_key(code); // le joueur : contournement signalé, passage en force proposé
        let (mut legs, mut target, mut err) = self.plan_legs(a, x, y, node, &block);
        let (mut detour, mut war) = (list![], String::new());
        let deja = "L'armée y est déjà.";
        if block.truthy() && ask && err != deja {
            // le même ordre, terres fermées comprises : contourne-t-on, ou faut-il passer en force ?
            let (fl, ft, _) = self.plan_legs(a, x, y, node, &Val::new_set());
            let who = if fl.truthy() { AA::crossed(self, &fl, &ft, &block, &here) } else { list![] };
            if legs.is_none() && who.truthy() {
                if !force {
                    return (None, AA::force_question(self, &who));
                }
                let (ok, w) = AA::force_passage(self, code, &who);
                war = w;
                if !ok {
                    return (Some(false), war);
                }
                block = AA::closed_owners(self, code);
                here = self.start_land(a, &block);
                (legs, target, err) = self.plan_legs(a, x, y, node, &block);
            } else if legs.is_none() && fl.truthy() {
                (legs, target) = (fl, ft); // rien de fermé en chemin (seulement les terres d'où l'on sort)
            } else if legs.is_some() {
                detour = who;
            }
        } else if legs.is_none() && block.truthy() && err != deja {
            let fermes = block.to_list();
            fermes.sort();
            err = Val::from(format!("{err} Terres fermées (sans droit de passage) : {}.", AA::names_of(self, &fermes)));
        }
        if legs.is_none() {
            return (Some(false), if !war.is_empty() { format!("{war} {err}") } else { format!("{err}") });
        }
        if a.at("state") == "siege" {
            self.end_siege_for(a);
        }
        a.set("path", legs);
        a.set("target", target);
        a.set("ex", &here); // terres fermées dont on sort (le délai de grâce court, sans détour imposé)
        a.set("dt", &detour); // terres fermées contournées
        a.set("hold", false);
        a.set("qrt", false);
        a.set("state", "move");
        a.set("assault", false);
        if a.at("stance") == "embuscade" {
            a.set("stance", "normal");
        }
        if a.at("at_node").is_some() {
            a.set("at_node", Val::None);
        }
        let mut msg = if !war.is_empty() { war } else { "En marche.".to_string() };
        if detour.truthy() {
            msg = format!("En marche, en contournant les terres {} (sans droit de passage).", R::de(&AA::names_of(self, &detour)));
        }
        if here.truthy() {
            msg += &format!(" L'armée sort d'abord des terres {}.", R::de(&self.fname(here.s())));
        }
        (Some(true), msg)
    }

    /// Même destination, par un itinéraire qui évite les terres fermées (en sortant de celles où l'on se trouve).
    /// Python : `reroute(self, a)`.
    // engine.py, lignes 2221 à 2233
    pub fn reroute(&mut self, a: &Val) -> bool {
        let tgt = a.get("target").or(dict! {});
        let (node, x, y) = (tgt.get("node"), tgt.get("x"), tgt.get("y"));
        if node.is_none() && x.is_none() {
            return false;
        }
        let block = AA::closed_owners(self, &a.ats("owner"));
        let (legs, target, _) = self.plan_legs(a, &x, &y, &node, &block);
        if !legs.truthy() {
            return false;
        }
        a.set("path", legs);
        a.set("target", target);
        let ex = self.start_land(a, &block);
        a.set("ex", ex);
        true
    }

    /// Sortie au plus court des terres fermées de o, vers les terres les plus proches où l'armée a le droit d'être.
    /// Python : `exit_path(self, a, o)`.
    /// o : le camp dont on quitte les terres.
    // engine.py, lignes 2235 à 2253
    pub fn exit_path(&mut self, a: &Val, o: &str) -> bool {
        let Some(mask) = AA::cell_mask(self, &AA::closed_owners(self, &a.ats("owner"))) else {
            return false;
        };
        let (x, y) = (a.atf("x"), a.atf("y"));
        let pts = self.geo.nearest_open(x, y, &mask, true, 40000).filter(|p| !p.is_empty()).or_else(|| self.geo.nearest_open(x, y, &mask, false, 40000));
        let Some(pts) = pts.filter(|p| p.len() >= 2) else {
            return false;
        };
        let fin = pts[pts.len() - 1];
        a.set("path", list![off_leg(&pts)]);
        a.set("target", dict! {"x" => fin.0, "y" => fin.1});
        a.set("ex", o);
        a.set("dt", list![]);
        a.set("state", "move");
        a.set("at_node", Val::None);
        a.set("hold", false);
        a.set("qrt", false);
        a.set("assault", false);
        if a.at("stance") == "embuscade" {
            a.set("stance", "normal");
        }
        true
    }

    /// Itinéraire tracé au doigt ou au stylet : l'armée passe par les points dessinés, à travers champs, en
    /// contournant les terres fermées. force : le joueur, prévenu, passe en force (déclaration de guerre).
    /// Python : `order_path(self, code, aid, pts, tr=None, force=False)`.
    /// pts : la liste envoyée par le navigateur (seuls ses éléments [x, y, …] comptent, 400 au plus) ; tr : None ou un bool.
    // engine.py, lignes 2255 à 2333
    pub fn order_path(&mut self, code: &str, aid: &Val, pts: &Val, tr: &Val, force: bool) -> (Option<bool>, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (Some(false), "Armée introuvable.".to_string());
        }
        if a.at("state") == "battle" {
            return (Some(false), "Cette armée est engagée dans une bataille (ordonnez la retraite).".to_string());
        }
        let mut pl: Vec<Pt> = vec![];
        for p in pts.iter() {
            if (p.is_list() || p.is_tuple()) && p.len() >= 2 {
                pl.push((py::float_v(&p.at(0)), py::float_v(&p.at(1))));
            }
        }
        pl.truncate(400);
        pl.retain(|p| p.0.is_finite() && p.1.is_finite());
        if pl.is_empty() {
            return (Some(false), "Tracé vide.".to_string());
        }
        let pre = self.boat_prefix(&a);
        let mut way: Vec<Pt> = vec![if pre.truthy() { self.node_xy(pre.at(0).ati("to")) } else { (a.atf("x"), a.atf("y")) }];
        for p in &pl {
            let w = way[way.len() - 1];
            if py::dist(p.0, p.1, w.0, w.1) >= 3.0 {
                way.push(*p);
            }
        }
        let (p, w) = (pl[pl.len() - 1], way[way.len() - 1]);
        if py::dist(p.0, p.1, w.0, w.1) > 0.4 {
            way.push(p);
        }
        way.truncate(45);

        let geo = self.geo.clone();
        let trace = |mask: Option<Vec<u8>>| -> (Vec<Pt>, i64) {
            let (mut full, mut skipped) = (vec![way[0]], 0);
            for p in &way[1..] {
                let f = full[full.len() - 1];
                match geo.astar(f.0, f.1, p.0, p.1, 40000, mask.as_deref()) {
                    Some(seg) if !seg.is_empty() => full.extend_from_slice(&seg[1..]),
                    _ => skipped += 1,
                }
            }
            (full, skipped)
        };
        let mut block = AA::closed_owners(self, code);
        let mut here = if !pre.truthy() { self.start_land(&a, &block) } else { Val::None };
        let (mut full, mut skipped) = trace(AA::cell_mask(self, &block));
        // le tracé dessiné passe-t-il sur des terres fermées ?
        let wl = way[way.len() - 1];
        let trace_v: Val = way.iter().map(|p| tup![p.0, p.1]).collect();
        let mut who = AA::crossed(self, &list![dict! {"kind" => "off", "pts" => trace_v}], &dict! {"x" => wl.0, "y" => wl.1}, &block, &here);
        let mut war = String::new();
        if who.truthy() && (full.len() < 2 || { let f = full[full.len() - 1]; py::dist(f.0, f.1, wl.0, wl.1) > 2.0 }) {
            // impossible d'arriver au bout sans y passer
            if code != self.player || self.ais.contains_key(code) {
                return (Some(false), AA::closed_msg(self, &who));
            }
            if !force {
                return (None, AA::force_question(self, &who));
            }
            let (ok, w) = AA::force_passage(self, code, &who);
            war = w;
            if !ok {
                return (Some(false), war);
            }
            block = AA::closed_owners(self, code);
            here = if !pre.truthy() { self.start_land(&a, &block) } else { Val::None };
            who = list![];
            (full, skipped) = trace(AA::cell_mask(self, &block));
        }
        if full.len() < 2 {
            return (Some(false), "Tracé impraticable (eau, fleuve sans pont ou hors de la région).".to_string());
        }
        let (ex, ey) = full[full.len() - 1];
        let mut node = self.nearest_node(ex, ey, None, 1.6);
        if node.is_some() {
            let o = self.nodes.at(&node).ats("owner");
            if o != code && o != R::NEUTRAL && self.status(code, &o) == "paix" {
                node = Val::None;
            }
        }
        let path = &pre + &list![off_leg(&full)];
        let target = if node.is_some() { dict! {"node" => &node} } else { dict! {"x" => ex, "y" => ey} };
        if tr.is_some() {
            a.set("tr", tr.truthy());
        }
        if a.at("state") == "siege" {
            self.end_siege_for(&a);
        }
        a.set("hold", false);
        a.set("qrt", false);
        a.set("path", path);
        a.set("target", target);
        a.set("ex", &here);
        a.set("dt", &who);
        a.set("state", "move");
        a.set("assault", false);
        if a.at("stance") == "embuscade" {
            a.set("stance", "normal");
        }
        a.set("at_node", Val::None);
        let mut msg = if !war.is_empty() { war } else { "En marche le long du tracé.".to_string() };
        if who.truthy() {
            msg += &format!(" Le tracé contourne les terres {} (sans droit de passage).", R::de(&AA::names_of(self, &who)));
        }
        if skipped != 0 {
            msg += " Les passages impossibles ont été contournés.";
        }
        (Some(true), msg)
    }

    /// Python : `move_armies(self, dt)`.
    // engine.py, lignes 2335 à 2339
    pub fn move_armies(&mut self, dt: f64) {
        for a in self.armies.values() {
            if self.paused(&a) {
                continue;
            }
            self.move_army(&a, dt);
        }
    }

    /// Tour par tour, pendant le tour des IA : les armées du joueur ont déjà marché à leur tour, elles restent en place
    /// (sauf une retraite forcée).
    /// Python : `paused(self, a)`.
    // engine.py, lignes 2341 à 2345
    pub fn paused(&self, a: &Val) -> bool {
        // (sauf pour sortir de terres fermées : délai de grâce)
        a.at("owner") == self.player
            && (a.at("state") != "retreat" || a.getb("rt"))
            && !a.getb("cl")
            && self.tour.atb("on")
            && self.tour.at("end").is_some()
    }

    /// Python : `marching(self, a)`.
    // engine.py, lignes 2347 à 2348
    pub fn marching(&self, a: &Val) -> bool {
        let st = a.at("state");
        (st == "move" || st == "retreat") && !self.paused(a)
    }

    /// Monter dans le train (une journée en gare) ou en descendre (moral −5 : l'armée se reforme sur le quai).
    /// Python : `rail_switch(self, a, on)`.
    // engine.py, lignes 2350 à 2359
    pub fn rail_switch(&mut self, a: &Val, on: bool) {
        a.set("rail", on);
        if on {
            a.set("emb", &a.get_or("emb", 0.0) + R::RAIL_EMBARK); // (après le débarquement d'une gabare, s'il y en a un)
        } else if a.get_or("emb", 0.0) > 0i64 {
            a.set("emb", 0.0); // (descendu avant le départ : pas de voyage, pas de désordre)
        } else {
            for r in a.at("regs").iter() {
                let m = &r.at("morale") - 5;
                r.set("morale", if m > 0.0 { m } else { Val::from(0.0) });
            }
        }
    }

    /// Fait marcher une armée pendant dt jours. Renvoie ce qu'il reste de ce temps (armée arrivée ou arrêtée).
    /// Python : `move_army(self, a, dt)`.
    // engine.py, lignes 2361 à 2536
    pub fn move_army(&mut self, a: &Val, dt: f64) -> f64 {
        let season = self.season();
        let st = a.at("state");
        let marche = st == "move" || st == "retreat";
        if !marche || !a.atb("path") {
            if marche && !a.atb("path") {
                a.set("state", "idle");
            }
            if !a.atb("path") && a.getb("rail") {
                self.rail_switch(a, false); // trajet annulé ailleurs (bataille, diplomatie, IA) : on descend du train
            }
            return dt;
        }
        let mut budget = dt;
        let mut base = self.army_speed(a);
        if a.at("state") == "retreat" {
            base *= 1.15;
        }
        let wx = self.wx(a.atf("x"), a.atf("y"));
        let mut rails: Option<Val> = None;
        let geo = self.geo.clone();
        let owner = a.ats("owner");
        while budget > 1e-9 && a.atb("path") {
            let leg = a.at("path").at(0);
            let is_water = leg.at("kind") == "road" && geo.edges.at(&leg.at("e")).get("kind") == "water";
            if is_water != a.getb("boat") {
                // embarquement sur les gabares / débarquement sur le quai
                a.set("boat", is_water);
                a.set("emb", if is_water { R::EMBARK_DAYS } else { R::DISEMBARK_DAYS });
                let an = a.at("at_node");
                if an.is_some() && geo.nodes.at(&an).at("spec").has("port") {
                    a.scale("emb", 0.6);
                }
            }
            // le train : on monte en gare (une journée), on descend un peu désorganisé ; un tronçon devenu inutilisable
            // en route (coupé, pris) fait finir à pied
            if leg.getb("rail") {
                if rails.is_none() {
                    rails = Some(RL::rail_edges(self, &owner)); // (une fois par appel : tout le pas se joue sur le même réseau)
                }
                if !rails.as_ref().unwrap().has(&leg.at("e")) {
                    leg.pop("rail");
                }
            }
            if leg.getb("rail") != a.getb("rail") {
                self.rail_switch(a, leg.getb("rail"));
            }
            if a.get_or("emb", 0).f() > 0.0 {
                let emb = a.atf("emb");
                let use_ = if emb < budget { emb } else { budget };
                a.dec("emb", use_);
                budget -= use_;
                continue;
            }
            if is_water {
                let e = geo.edges.at(&leg.at("e"));
                let ws = self.water_speed(&e, &leg.at("frm"), &a.at("x"), &a.at("y"), false, &Val::from(owner.as_str()));
                let sp = if ws > 1.0 { ws } else { 1.0 };
                let remaining = e.atf("len") - leg.atf("pos");
                let step = sp * budget;
                if step >= remaining {
                    budget -= remaining / sp;
                    leg.set("pos", e.at("len"));
                    a.at("path").pop(0);
                    let to = leg.ati("to");
                    let (nx, ny) = self.node_xy(to);
                    a.set("x", nx);
                    a.set("y", ny);
                    a.set("edge", Val::None);
                    a.set("onroad", true);
                    a.set("landing", true);
                    let stop = self.arrive_node(a, to, true);
                    let st = a.at("state");
                    if !(st == "move" || st == "retreat") {
                        a.set("boat", false);
                    }
                    if a.at("state") != "battle" {
                        a.set("landing", false);
                    }
                    if stop {
                        break;
                    }
                } else {
                    leg.inc("pos", step);
                    budget = 0.0;
                    let (ex, ey) = self.edge_xy(&e, leg.ati("frm"), leg.atf("pos"));
                    a.set("x", ex);
                    a.set("y", ey);
                    a.set("edge", dict! {"e" => e.at("id"), "frm" => leg.at("frm"), "pos" => leg.at("pos")});
                    a.set("onroad", true);
                    a.set("at_node", Val::None);
                }
                continue;
            }
            if leg.at("kind") == "road" {
                let e = geo.edges.at(&leg.at("e"));
                let royal = e.atb("royal");
                let (ax, ay) = (a.atf("x"), a.atf("y"));
                let mut sp = base
                    * (if royal { 1.15 } else { 1.0 })
                    * R::SEASON_ROAD().atf(season.as_str())
                    * wx.atf("move")
                    * (1.0 + self.mod_(&owner, "road_speed", 0.0))
                    * self.mud_k(ax, ay, royal);
                if self.wx(ax, ay).is(&R::WEATHER().at("neige")) && self.zone_of(ax, ay) == "montagne" {
                    sp *= 0.6;
                }
                let len = e.atf("len");
                if self.cut_edges().has(&e.at("id")) {
                    sp = len / (len / sp + CR::DELAY); // route coupée par la crue : un jour de plus sur l'arête (à gué ou par un détour ; jamais bloquée)
                }
                if a.getb("rail") {
                    sp = R::RAIL_SPEED; // (le train passe les fleuves sur ses ponts)
                }
                let mut zone_end = len;
                if e.at("rrank") == 1i64 && self.mod_(&owner, "bridges", 0.0) == 0.0 && !self.has_sapeurs(a) && !a.getb("rail") {
                    if e.atb("ferry") {
                        sp *= 0.35; // bac sur l'estuaire : toute la traversée est lente
                    } else {
                        // attente au bac : seul le passage du fleuve est lent (~0,3 jour pour l'infanterie)
                        let cp = self.cross_pos(&e, leg.ati("frm"));
                        let c0 = if cp - 0.8 > 0.0 { cp - 0.8 } else { 0.0 };
                        let c1 = if cp + 0.8 < len { cp + 0.8 } else { len };
                        let pos = leg.atf("pos");
                        if pos < c0 {
                            zone_end = c0;
                        } else if pos < c1 {
                            zone_end = c1;
                            sp *= 0.22 * (if self.t < self.flood_until { 0.5 } else { 1.0 });
                        }
                    }
                }
                let step = sp * budget;
                if zone_end < len - 1e-9 && step >= zone_end - leg.atf("pos") {
                    budget -= (zone_end - leg.atf("pos")) / sp;
                    leg.set("pos", zone_end + 1e-6);
                    self.place_sur_route(a, &leg, &e);
                    continue;
                }
                let remaining = len - leg.atf("pos");
                if step >= remaining {
                    budget -= remaining / sp;
                    leg.set("pos", e.at("len"));
                    a.at("path").pop(0);
                    let to = leg.ati("to");
                    let (nx, ny) = self.node_xy(to);
                    a.set("x", nx);
                    a.set("y", ny);
                    a.set("edge", Val::None);
                    a.set("onroad", true);
                    if self.arrive_node(a, to, true) {
                        break;
                    }
                } else {
                    leg.inc("pos", step);
                    budget = 0.0;
                    self.place_sur_route(a, &leg, &e);
                }
            } else {
                let pts = leg.at("pts");
                let i = leg.ati("i");
                if i >= pts.len() as i64 {
                    a.at("path").pop(0);
                    continue;
                }
                let (tx, ty) = pts.at(i).xy();
                let (ax, ay) = (a.atf("x"), a.atf("y"));
                let d = py::hypot(tx - ax, ty - ay);
                let ter = geo.terrain_at(ax, ay);
                let tinfo = TERRAIN().at(ter);
                let tname = tinfo.ats(0);
                let tname = tname.as_str();
                let mut mult = tinfo.atf(1);
                if mult == 0.0 {
                    mult = 0.3;
                }
                let regs = a.at("regs");
                for r in regs.iter() {
                    if r.at("type") == "cavalerie" && (tname == "Forêt" || tname == "Marais") {
                        mult *= 0.85;
                        break;
                    }
                }
                if regs.iter().any(|r| Game::arm_class(r.at("type").s()) == "artillerie")
                    && ["Forêt", "Marais", "Montagne", "Haute montagne", "Dunes"].contains(&tname)
                {
                    mult *= 0.6;
                }
                if ["Montagne", "Haute montagne", "Collines"].contains(&tname) {
                    mult *= 1.0 + self.mod_(&owner, "mountain", 0.0);
                    if self.gen_trait(a) == "montagnard" {
                        mult *= 1.3;
                    }
                }
                let c = geo.cell(ax, ay);
                let rv = if c >= 0 { geo.river[c as usize] } else { 0 };
                if rv != 0 {
                    mult *= if rv >= 2 { 0.5 } else { 0.75 };
                }
                let mut sp = base * mult * R::SEASON_OFF().atf(season.as_str()) * wx.atf("move") * self.mud_k(ax, ay, false);
                if season == "hiver" && (tname == "Montagne" || tname == "Haute montagne") {
                    sp *= 0.5;
                }
                if 1.0 > sp {
                    sp = 1.0; // max(sp, 1.0)
                }
                let step = if 1.0 < sp * budget { 1.0 } else { sp * budget }; // min(sp * budget, 1.0)
                if step >= d {
                    budget -= d / sp;
                    a.set("x", tx);
                    a.set("y", ty);
                    leg.inc("i", 1);
                    if leg.ati("i") >= pts.len() as i64 {
                        a.at("path").pop(0);
                        // arrivée sur un nœud ?
                        let tgt = a.at("target").or(dict! {});
                        if !a.atb("path") && tgt.get("node").is_some() && self.arrive_node(a, tgt.ati("node"), true) {
                            break;
                        }
                    }
                } else {
                    a.set("x", ax + (tx - ax) / d * step);
                    a.set("y", ay + (ty - ay) / d * step);
                    budget -= step / sp;
                }
                a.set("onroad", false);
                a.set("edge", Val::None);
                a.set("at_node", Val::None);
            }
        }
        if !a.atb("path") && a.getb("boat") && a.at("at_node").is_some() {
            a.set("boat", false);
            a.set("emb", 0.0);
        }
        if !a.atb("path") && a.getb("rail") {
            self.rail_switch(a, false); // terminus
        }
        let st = a.at("state");
        if !a.atb("path") && (st == "move" || st == "retreat") {
            a.set("state", "idle"); // (`'idle' if a['state'] != 'battle' else a['state']` : ici toujours 'idle')
            let ai = a.at("ai");
            if ai.truthy() && ai.get("then") == "embuscade" {
                a.set("stance", "embuscade");
                ai.set("then", Val::None);
            }
        }
        budget
    }

    /// Terres fermées : délai de grâce, chemin de sortie, puis incidents (voir AA.land_tick).
    /// Python : `land_check(self, dt)`.
    // engine.py, lignes 2538 à 2541
    pub fn land_check(&mut self, dt: f64) {
        for a in self.armies.values() {
            AA::land_tick(self, &a, dt);
        }
    }

    /// Retourne True si l'armée doit s'arrêter (combat, siège...).
    /// Python : `arrive_node(self, a, nid, ask=True)`.
    // engine.py, lignes 2543 à 2608
    pub fn arrive_node(&mut self, a: &Val, nid: i64, ask: bool) -> bool {
        let n = self.nodes.at(nid);
        let code = a.ats("owner");
        a.set("at_node", nid);
        let (nx, ny) = self.node_xy(nid);
        a.set("x", nx);
        a.set("y", ny);
        a.set("edge", Val::None);
        let o = n.ats("owner");
        if o == code || self.friendly(&code, &o) {
            if !a.atb("path") {
                a.set("state", "idle"); // ('idle' if a['state'] != 'retreat' else 'idle')
            }
            return false;
        }
        let fled = a.at("state") == "retreat";
        // chez un voisin en paix, ou en traversant : on passe, ou l'on fait halte
        if let Some(stop) = AA::arrive(self, a, nid, ask) {
            return stop;
        }
        if a.at("state") == "retreat" {
            a.set("path", list![]);
            a.set("state", "idle");
        }
        // une bataille s'y livre déjà : on rejoint les assaillants s'ils sont des nôtres, sinon on attend
        let bt = self.battles.values().into_iter().find(|b| b.at("node") == nid);
        if let Some(bt) = bt {
            a.set("path", list![]);
            let sides = bt.at("sides");
            if self.friendly(&code, &sides.at(0).ats("owner")) && self.hostile(&code, &sides.at(1).ats("owner")) {
                self.join_battle(a, &bt, 0);
            } else {
                a.set("state", "idle");
            }
            return true;
        }
        // nœud hostile ou neutre : combat ou siège
        let defense = self.node_defense_power(nid, true);
        let gn = self.geo.nodes.at(nid);
        let lieu = |gn: &Val| dict! {"x" => gn.at("x"), "y" => gn.at("y")};
        if defense < 1.0 {
            self.capture(nid, &code, false);
            return !a.atb("path");
        }
        let siege = n.at("siege");
        if siege.truthy() && siege.at("by") != code.as_str() {
            a.set("path", list![]);
            a.set("state", "idle");
            if code == self.player {
                let texte = format!("{} est déjà investie par {}.", gn.at("name"), self.fname(siege.at("by").s()));
                self.log("siege", &texte, &lieu(&gn));
            }
            return true;
        }
        let assiege_par_nous = siege.truthy() && siege.at("by") == code.as_str();
        if ask && !fled && !assiege_par_nous && AA::asks(self, a) {
            AA::pose(self, a, nid); // le joueur choisit : assaut, ralliement, siège… (army_actions)
            return true;
        }
        // (n['siege'] relu après AA.strong, comme le Python)
        if o == R::NEUTRAL
            && (AA::strong(self, a, nid) || {
                let siege = n.at("siege");
                siege.truthy() && siege.getb("occupy") && siege.at("by") == code.as_str()
            })
        {
            if code == self.player && TT::planning(self) {
                // tour du joueur : la place se rallie tout de suite, et l'armée finit là sa marche du tour (comme une
                // prise de ville dans Total War) ; elle reprend sa route au tour suivant
                let texte = format!("{} se rallie à {}.", gn.at("name"), self.fname(&code));
                let kw = dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &code, "important" => true};
                self.log("capture", &texte, &kw);
                self.capture(nid, &code, true);
                a.set("took", true);
                return true;
            }
            if !n.atb("siege") {
                n.set("siege", dict! {"by" => &code, "dmg" => 0.0, "since" => self.t, "occupy" => true});
                if code == self.player {
                    let texte = format!("Vos troupes occupent {} : ralliement en cours…", gn.at("name"));
                    let kw = dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &code};
                    self.log("siege", &texte, &kw);
                }
            }
            a.set("state", "siege");
            return true;
        }
        if AA::walled(&n) && !a.atb("assault") && n.at("siege").is_none() && (o != R::NEUTRAL || n.at("fort") >= 2i64) {
            self.begin_siege(a, nid);
            return true;
        }
        let siege = n.at("siege");
        if siege.truthy() && siege.at("by") == code.as_str() && !a.atb("assault") {
            a.set("state", "siege");
            return true;
        }
        self.start_battle(&list![a], &list![], gn.atf("x"), gn.atf("y"), &Val::from(nid), false, false);
        true
    }

    /// L'armée met le siège devant une place à remparts (journal ; alerte si la place est au joueur).
    /// Python : `begin_siege(self, a, nid)`.
    // engine.py, lignes 2610 à 2624
    pub fn begin_siege(&mut self, a: &Val, nid: i64) {
        let (n, gn, code) = (self.nodes.at(nid), self.geo.nodes.at(nid), a.ats("owner"));
        let o = n.ats("owner");
        n.set("siege", dict! {"by" => &code, "dmg" => 0.0, "since" => self.t});
        a.set("state", "siege");
        if code == self.player || o == self.player {
            if o == self.player {
                self.alert_pause(false);
            }
            let mut txt = format!("Siège {} par {}.", R::de(gn.at("name").s()), self.fname(&code));
            if code == self.player && TT::planning(self) {
                // (votre tour : pas de bataille avant la brèche, au tour des IA, sauf assaut ordonné)
                txt = format!(
                    "{} a des remparts : siège commencé. « Donner l’assaut » pour l’attaquer tout de suite ; sinon l’assaut partira de lui-même à la brèche.",
                    gn.at("name")
                );
            }
            let kw = dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &code, "important" => true};
            self.log("siege", &txt, &kw);
        }
    }

    /// Distance (km, le long de la route) entre le nœud de départ et le passage du fleuve.
    /// Python : `cross_pos(self, e, frm)`.
    // engine.py, lignes 2626 à 2633
    pub fn cross_pos(&self, e: &Val, frm: i64) -> f64 {
        let (pa, pb) = (self.node_xy(e.ati("a")), self.node_xy(e.ati("b")));
        let (dx, dy) = (pb.0 - pa.0, pb.1 - pa.1);
        let mut l2 = dx * dx + dy * dy;
        if l2 == 0.0 {
            l2 = 1.0;
        }
        let f = ((e.atf("cx") - pa.0) * dx + (e.atf("cy") - pa.1) * dy) / l2;
        let f = if f < 1.0 { f } else { 1.0 };
        let f = if f > 0.0 { f } else { 0.0 };
        (if frm == e.ati("a") { f } else { 1.0 - f }) * e.atf("len")
    }

    /// Python : `end_siege_for(self, a)`.
    // engine.py, lignes 2635 à 2645
    pub fn end_siege_for(&mut self, a: &Val) {
        let nid = a.at("at_node");
        if nid.is_none() {
            return;
        }
        let n = self.nodes.at(&nid);
        let siege = n.at("siege");
        if siege.truthy() && siege.at("by") == a.at("owner") {
            let others = self.armies.values().into_iter().any(|b| {
                !b.is(a) && b.at("at_node") == nid && b.at("owner") == a.at("owner") && b.at("state") == "siege"
            });
            if !others {
                n.set("siege", Val::None);
            }
        }
        a.set("state", "idle");
    }

    /// Python : `besiegers(self, n)`.
    /// n : une place assiégée (n['siege'] n'est pas None). Rend une liste d'armées.
    // engine.py, lignes 2647 à 2649
    pub fn besiegers(&self, n: &Val) -> Val {
        let s = n.at("siege");
        self.armies
            .values()
            .into_iter()
            .filter(|a| a.at("at_node") == n.at("id") && a.at("state") == "siege" && a.at("owner") == s.at("by"))
            .collect()
    }

    /// Avancée de la brèche par jour (assaut à 0,85) : artillerie, sapeurs, remparts, général artilleur.
    /// Python : `siege_rate(self, n, bes)`.
    /// bes : la liste des armées assiégeantes.
    // engine.py, lignes 2651 à 2659
    pub fn siege_rate(&self, n: &Val, bes: &Val) -> f64 {
        let by = n.at("siege").ats("by");
        let mut arts = vec![];
        let mut n_sap = 0i64;
        for a in bes.iter() {
            for r in a.at("regs").iter() {
                if r.at("type") == "artillerie" {
                    arts.push(1.0 + self.reg_mods(&by, &r, &Val::None).get_or("art_power", 0.0).f());
                }
            }
        }
        for a in bes.iter() {
            for r in a.at("regs").iter() {
                if r.at("type") == "sapeurs" {
                    n_sap += 1;
                }
            }
        }
        let art = py::sum(arts);
        let fort = n.at("fort");
        let mf = if fort > 1i64 { fort.f() } else { 1.0 }; // max(1, n['fort'])
        let mut rate = (0.02 + 0.06 * art + R::SAPEUR_SIEGE * n_sap as f64) / mf * AA::siege_k(n);
        if bes.iter().any(|a| self.gen_trait(&a) == "artilleur") {
            rate *= 1.4;
        }
        rate * (1.0 + self.mod_(&by, "siege_speed", 0.0))
    }

    /// Python : `update_sieges(self, dt)`.
    // engine.py, lignes 2661 à 2705
    pub fn update_sieges(&mut self, dt: f64) {
        for n in self.nodes.iter() {
            let s = n.at("siege");
            if !s.truthy() {
                continue;
            }
            let nid = n.ati("id");
            let by = s.ats("by");
            let bes = self.besiegers(&n);
            if !bes.truthy() {
                // assiégeants occupés à repousser une armée de secours : le siège est suspendu, pas levé
                if !self.armies.values().iter().any(|a| a.at("at_node") == nid && a.at("owner") == by.as_str() && a.at("state") == "battle") {
                    n.set("siege", Val::None);
                }
                continue;
            }
            if s.getb("blocus") {
                AA::blockade_tick(self, &n, &bes, dt); // ni bombardement ni assaut : la faim
                continue;
            }
            if s.getb("occupy") {
                let gtyp = self.geo.nodes.at(nid).at("type");
                let jours = if gtyp == "village" { 3.0 } else { 5.0 }; // {'village': 3.0, 'fort': 5.0}.get(gtyp, 5.0)
                let dmg = s.atf("dmg") + dt / jours;
                s.set("dmg", if dmg < 1.0 { dmg } else { 1.0 });
                if s.atf("dmg") >= 1.0 {
                    n.set("siege", Val::None);
                    let gn = self.geo.nodes.at(nid);
                    let texte = format!("{} se rallie à {}.", gn.at("name"), self.fname(&by));
                    let kw = dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &by, "important" => by == self.player};
                    self.log("capture", &texte, &kw);
                    self.capture(nid, &by, true);
                    for a in bes.iter() {
                        a.set("state", if a.atb("path") { "move" } else { "idle" });
                    }
                }
                continue;
            }
            let d0 = s.atf("dmg");
            let dmg = s.atf("dmg") + self.siege_rate(&n, &bes) * dt;
            s.set("dmg", if dmg < 1.0 { dmg } else { 1.0 });
            self.damage_town(&n, (s.atf("dmg") - d0) * R::DEG_SIEGE); // le bombardement touche aussi les maisons
            let mil = n.atf("milice") - n.atf("milice") * 0.015 * dt;
            n.set("milice", if mil > 0.0 { mil } else { 0.0 });
            for r in n.at("garrison").iter() {
                let m = r.atf("morale") - 2.0 * dt;
                r.set("morale", if m > 10.0 { Val::from(m) } else { Val::Int(10) });
            }
            if s.atf("dmg") >= 0.85 || bes.iter().any(|a| a.atb("assault")) {
                let gn = self.geo.nodes.at(nid);
                if self.node_defense_power(nid, true) < 1.0 {
                    n.set("siege", Val::None);
                    self.capture(nid, &by, false);
                    for a in bes.iter() {
                        a.set("state", "idle");
                    }
                    continue;
                }
                for a in bes.iter() {
                    a.set("state", "idle");
                    a.set("assault", true);
                }
                self.start_battle(&bes, &list![], gn.atf("x"), gn.atf("y"), &Val::from(nid), false, false);
            }
        }
    }

    /// (aide du portage) Les six lignes que move_army répète pour poser l'armée à leg['pos'] km le long de la route,
    /// entre les deux places (en ligne droite) : x, y, edge, onroad, at_node.
    fn place_sur_route(&mut self, a: &Val, leg: &Val, e: &Val) {
        let (pa, pb) = (self.node_xy(leg.ati("frm")), self.node_xy(leg.ati("to")));
        let f = leg.atf("pos") / e.atf("len");
        a.set("x", pa.0 + (pb.0 - pa.0) * f);
        a.set("y", pa.1 + (pb.1 - pa.1) * f);
        a.set("edge", dict! {"e" => e.at("id"), "frm" => leg.at("frm"), "pos" => leg.at("pos")});
        a.set("onroad", true);
        a.set("at_node", Val::None);
    }
}

/// `dict(kind='off', pts=[list(p) for p in pts], i=1)` : une étape à travers champs.
fn off_leg(pts: &[Pt]) -> Val {
    dict! {"kind" => "off", "pts" => pts.iter().map(|p| list![p.0, p.1]).collect::<Val>(), "i" => 1}
}
