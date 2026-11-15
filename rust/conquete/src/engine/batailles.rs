//! Porte game/engine.py, lignes 2707 à 3610 : visibilité, contacts et batailles, tactique.
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::*;

/// `max(a, b)` de Python : a, sauf si b est plus grand (garde le type de celui qui gagne : `max(5, x)` peut rendre 5).
pub(super) fn py_max(a: impl Into<Val>, b: impl Into<Val>) -> Val {
    let (a, b) = (a.into(), b.into());
    if b > a { b } else { a }
}

/// `min(a, b)` de Python : a, sauf si b est plus petit.
pub(super) fn py_min(a: impl Into<Val>, b: impl Into<Val>) -> Val {
    let (a, b) = (a.into(), b.into());
    if b < a { b } else { a }
}

/// `sum(…)` de valeurs (entiers ou flottants), en flottant.
pub(super) fn somme(it: impl IntoIterator<Item = Val>) -> f64 {
    py::sum_v(it).f()
}

/// `sum(…) or 1` en flottant.
fn somme_ou_1(it: impl IntoIterator<Item = Val>) -> f64 {
    let s = somme(it);
    if s == 0.0 { 1.0 } else { s }
}

/// Rang d'une arme dans les dict de puissance d'update_battles (ordre d'insertion du Python).
const ARMES: [&str; 3] = ["artillerie", "inf", "cavalerie"];
fn rang_arme(cls: &str) -> usize {
    match cls {
        "artillerie" => 0,
        "inf" => 1,
        "cavalerie" => 2,
        _ => panic!("KeyError: {}", py::repr_s(cls)),
    }
}

impl Game {
    // ------------------------------------------------------------------ visibilité
    /// Python : `update_hidden(self)`.
    // engine.py, lignes 2708 à 2725
    pub fn update_hidden(&mut self) {
        for a in self.armies.values() {
            let st = a.at("state");
            if st == "battle" || st == "siege" || a.atb("onroad") || a.at("at_node").is_some() {
                a.set("hidden", false);
                continue;
            }
            let (x, y) = (a.atf("x"), a.atf("y"));
            let ter = self.geo.terrain_at(x, y);
            let cover = TERRAIN().at(ter).atb(2);
            let fog = self.weather.at(self.zone_of(x, y)).at("kind") == "brouillard";
            let has_art = a.at("regs").iter().any(|r| r.at("type") == "artillerie");
            let stealth = self.mod_(&a.ats("owner"), "stealth", 0.0) > 0.0;
            let stance = a.at("stance");
            if cover && (stance == "embuscade" || !has_art || stealth) {
                a.set("hidden", true);
            } else if fog && !has_art {
                a.set("hidden", true);
            } else if stealth && (ter == T_LANDE || ter == T_MARAIS) && stance == "embuscade" {
                a.set("hidden", true);
            } else {
                a.set("hidden", false);
            }
        }
    }

    /// Python : `vision_sources(self, code)`.
    /// Rend (side, srcs) : le set des codes de son côté, la liste des sources de vision, des tuples (x, y, rayon).
    // engine.py, lignes 2727 à 2747
    pub fn vision_sources(&self, code: &str) -> (Val, Val) {
        let srcs = list![];
        let ov_code = self.factions.at(code).at("overlord");
        let side: Val = Val::set_from(
            self.factions
                .keys()
                .into_iter()
                .filter(|c| {
                    let cs = c.s();
                    self.friendly(code, cs) || self.factions.at(c).at("overlord") == code || ov_code == *c
                })
                .collect(),
        );
        side.push(code);
        let nv = self.mod_(code, "node_vision", 0.0);
        let av = self.mod_(code, "vision", 0.0);
        for n in self.nodes.iter() {
            if side.has(&n.at("owner")) {
                let gn = self.geo.nodes.at(n.at("id"));
                let r = &R::NODE_BASE().at(gn.at("type")).at("vision") + nv;
                let (x, y) = (gn.atf("x"), gn.atf("y"));
                srcs.push(tup![gn.at("x"), gn.at("y"), &r * self.wx(x, y).at("vision")]);
            }
        }
        for a in self.armies.values() {
            if side.has(&a.at("owner")) {
                let cav = if a.at("regs").iter().any(|rg| rg.at("type") == "cavalerie") { 8.0 } else { 0.0 };
                let r = 15.0 + av + cav;
                let (x, y) = (a.atf("x"), a.atf("y"));
                srcs.push(tup![a.at("x"), a.at("y"), r * self.wx(x, y).atf("vision")]);
            }
        }
        for (k, until) in self.factions.at(code).get_or("intel", dict! {}).items() {
            if until > self.t {
                let (x, y) = self.node_xy(py::int_v(&k));
                srcs.push(tup![x, y, 14.0]);
            }
        }
        (side, srcs)
    }

    /// Python : `visible_armies(self, code)`.
    /// Rend (vis, srcs) : le set des identifiants des armées vues, et les sources de vision_sources.
    // engine.py, lignes 2749 à 2767
    pub fn visible_armies(&self, code: &str) -> (Val, Val) {
        let (side, srcs) = self.vision_sources(code);
        let det = BASE_DETECT + self.mod_(code, "detect", 0.0) + 1.5;
        let scouts: Vec<(f64, f64)> = self
            .armies
            .values()
            .into_iter()
            .filter(|b| side.has(&b.at("owner")) && self.gen_trait(b) == "eclaireur")
            .map(|b| (b.atf("x"), b.atf("y")))
            .collect();
        let srcs_f: Vec<(f64, f64, f64)> = srcs.iter().map(|s| (s.atf(0), s.atf(1), s.atf(2))).collect();
        let vis = pyset![];
        for a in self.armies.values() {
            if side.has(&a.at("owner")) {
                vis.push(a.at("id"));
                continue;
            }
            let (ax, ay) = (a.atf("x"), a.atf("y"));
            let hidden = a.atb("hidden");
            let mut vu = false;
            for &(x, y, r) in &srcs_f {
                let d2 = py::pow(ax - x, 2.0) + py::pow(ay - y, 2.0);
                let rr = if hidden { det } else { r };
                if d2 <= rr * rr {
                    vis.push(a.at("id"));
                    vu = true;
                    break;
                }
            }
            if !vu && hidden && scouts.iter().any(|&(x, y)| py::pow(ax - x, 2.0) + py::pow(ay - y, 2.0) <= py::pow(det + 2.0, 2.0)) {
                vis.push(a.at("id"));
            }
        }
        (vis, srcs)
    }

    // ------------------------------------------------------------------ contacts et batailles
    /// only : n'examine que les rencontres de cette armée (marche instantanée du joueur, tour par tour).
    /// les armées à bord des gabares ne livrent pas bataille en chemin (elles essuient le feu des berges : river_fire)
    /// Python : `detect_contacts(self, only=None)`.
    /// only : None, ou un identifiant d'armée.
    // engine.py, lignes 2770 à 2827
    pub fn detect_contacts(&mut self, only: &Val) {
        // les armées à bord des gabares ne livrent pas bataille en chemin (elles essuient le feu des berges : river_fire)
        let mut arr: Vec<Val> = self
            .armies
            .values()
            .into_iter()
            .filter(|a| {
                a.at("state") != "battle"
                    && self.t >= a.atf("grace")
                    && a.atb("regs")
                    && !(a.getb("boat") && a.at("at_node").is_none())
            })
            .collect();
        let n = arr.len();
        let mut outer = n;
        if only.is_some() {
            // l'armée examinée en tête, et elle seule contre toutes les autres (n paires au lieu de n²/2)
            arr.sort_by_key(|x| x.at("id") != *only); // (tri stable, comme list.sort)
            outer = if !arr.is_empty() && arr[0].at("id") == *only { 1 } else { 0 };
        }
        for i in 0..outer {
            let a = arr[i].clone();
            if a.at("state") == "battle" {
                continue;
            }
            for j in i + 1..n {
                let b = arr[j].clone();
                if b.at("state") == "battle" || a.at("state") == "battle" {
                    continue;
                }
                let (dx, dy) = (a.atf("x") - b.atf("x"), a.atf("y") - b.atf("y"));
                let d2 = dx * dx + dy * dy;
                if d2 > AMBUSH_KM * AMBUSH_KM {
                    // (la distance d'abord : des centaines d'armées sur toute la France)
                    continue;
                }
                if !self.at_war(&a.ats("owner"), &b.ats("owner")) {
                    continue;
                }
                let mut amb: Option<(Val, Val)> = None;
                for (x, y) in [(&a, &b), (&b, &a)] {
                    let ys = y.at("state");
                    if x.at("stance") == "embuscade"
                        && x.atb("hidden")
                        && x.at("state") == "idle"
                        && (ys == "move" || ys == "retreat")
                        && !y.atb("hidden")
                    {
                        let det = BASE_DETECT
                            + self.mod_(&y.ats("owner"), "detect", 0.0)
                            + (if self.gen_trait(y) == "eclaireur" { 2.0 } else { 0.0 });
                        if d2 > det * det || d2 <= CONTACT_KM * CONTACT_KM {
                            amb = Some((x.clone(), y.clone()));
                        }
                    }
                }
                if let Some((x, y)) = amb {
                    let (gx, gy) = (y.atf("x"), y.atf("y"));
                    self.start_battle(&list![x], &list![y], gx, gy, &Val::None, true, false);
                } else if d2 <= CONTACT_KM * CONTACT_KM {
                    if a.at("state") == "siege" && b.at("state") == "siege" {
                        continue;
                    }
                    if self.behind_walls(&a, &b) || self.behind_walls(&b, &a) {
                        continue;
                    }
                    let surprise = a.atb("hidden") || b.atb("hidden");
                    let (att, de) = if a.at("state") == "move" || a.atb("hidden") { (&a, &b) } else { (&b, &a) };
                    let (gx, gy) = ((a.atf("x") + b.atf("x")) / 2.0, (a.atf("y") + b.atf("y")) / 2.0);
                    let sur = surprise && att.atb("hidden");
                    self.start_battle(&list![att], &list![de], gx, gy, &Val::None, false, sur);
                }
            }
        }
        // renforts : armées proches d'une bataille en cours
        for bt in self.battles.values() {
            for a in self.armies.values() {
                if only.is_some() && a.at("id") != *only {
                    continue;
                }
                if a.at("state") == "battle"
                    || !a.atb("regs")
                    || self.t < a.atf("grace")
                    || (a.getb("boat") && a.at("at_node").is_none())
                {
                    continue;
                }
                if py::pow(a.atf("x") - bt.atf("x"), 2.0) + py::pow(a.atf("y") - bt.atf("y"), 2.0) > 9.0 {
                    continue;
                }
                let sides = bt.at("sides");
                for si in 0..2i64 {
                    let side = sides.at(si);
                    let other = sides.at(1 - si);
                    let ao = a.ats("owner");
                    if self.friendly(&ao, &side.ats("owner")) && self.hostile(&ao, &other.ats("owner")) {
                        self.join_battle(&a, &bt, si);
                        break;
                    }
                }
            }
        }
    }

    /// d est retranchée dans une place amie que s assiège ou devant laquelle s attend : on ne sort pas se battre,
    /// les défenseurs combattront avec la garnison et les remparts quand l'assaut viendra.
    /// Python : `behind_walls(self, d, s)`.
    /// d, s : deux armées.
    // engine.py, lignes 2829 à 2836
    pub fn behind_walls(&self, d: &Val, s: &Val) -> bool {
        let nid = d.at("at_node");
        let (ds, ss) = (d.at("state"), s.at("state"));
        if nid.is_none() || !(ds == "idle" || ds == "siege") || ss == "move" || ss == "retreat" {
            return false;
        }
        let n = self.nodes.at(&nid);
        self.friendly(&d.ats("owner"), &n.ats("owner")) && s.at("at_node") == nid
    }

    /// Python : `join_battle(self, a, bt, si)`.
    /// si : 0 (assaillants) ou 1 (défenseurs).
    // engine.py, lignes 2838 à 2851
    pub fn join_battle(&mut self, a: &Val, bt: &Val, si: i64) {
        let side = bt.at("sides").at(si);
        if side.at("armies").has(&a.at("id")) {
            return;
        }
        side.at("armies").push(a.at("id"));
        side.inc("men0", self.army_men(a));
        a.set("ro", a.at("regs").iter().map(|r| list![r.at("id"), r.at("type")]).collect::<Val>());
        a.set("state", "battle");
        a.set("battle", bt.at("id"));
        if a.at("owner") != self.player.as_str() || a.get_or("tac_auto", true).truthy() {
            self.choose_tactics(a, bt, si);
        }
        if a.at("owner") == self.player.as_str() {
            let pn = self.place_name(bt.atf("x"), bt.atf("y"));
            let t = format!("{} rejoint la bataille {}.", a.at("name"), pn);
            self.log("battle", &t, &dict! {"x" => bt.at("x"), "y" => bt.at("y"), "who" => a.at("owner")});
        }
    }

    /// Réflexe du carré : une infanterie commandée à la main forme d'elle-même le carré quand les escadrons chargent.
    /// Les vétérans le forment vite ; les conscrits tardent, et la manœuvre est le moment le plus dangereux.
    /// Python : `square_reflex(self, bt, phase, cav_share, dt)`.
    /// cav_share : liste [part de cavalerie du camp 0, du camp 1].
    // engine.py, lignes 2853 à 2877
    pub fn square_reflex(&mut self, bt: &Val, phase: &str, cav_share: &Val, dt: f64) {
        if phase == "canonnade" {
            return;
        }
        for si in 0..2i64 {
            if cav_share.atf(1 - si) < 0.3 {
                continue;
            }
            for aid in bt.at("sides").at(si).at("armies").iter() {
                let a = self.armies.get(&aid);
                if !a.truthy() || a.get_or("tac_auto", true).truthy() || !a.get_or("rx", true).truthy() || a.get("fm") == "carre" {
                    continue;
                }
                let inf: Vec<Val> = a.at("regs").iter().filter(|r| Game::arm_class(r.at("type").s()) == "inf").collect();
                if inf.is_empty() {
                    continue;
                }
                let men = py::sum_v(inf.iter().map(|r| r.at("n"))).or(1.0).f();
                let xp = somme(inf.iter().map(|r| &r.at("n") * &r.at("xp"))) / men;
                let mor = somme(inf.iter().map(|r| &r.at("n") * &r.at("morale"))) / men;
                if self.rng.random() < dt * 4.0 * (0.5 + xp / 100.0 + mor / 200.0) {
                    a.set("fm", "carre");
                    let k = xp / 100.0;
                    a.set("fm_t", self.t - 0.1 * (if k < 0.8 { k } else { 0.8 })); // les vétérans se forment plus vite
                    if a.at("owner") == self.player.as_str() && a.get("_rx_bt") != bt.at("id") {
                        a.set("_rx_bt", bt.at("id"));
                        let t = format!("Les escadrons chargent : l'infanterie de la {} forme le carré !", a.at("name"));
                        self.log("battle", &t, &dict! {"x" => bt.at("x"), "y" => bt.at("y"), "who" => a.at("owner")});
                    }
                }
            }
        }
    }

    /// Fin sans vainqueur : paix signée, capitulation ou place passée à un autre camp en cours de combat.
    /// Python : `dissolve_battle(self, bt)`.
    // engine.py, lignes 2879 à 2889
    pub fn dissolve_battle(&mut self, bt: &Val) {
        for side in bt.at("sides").iter() {
            for aid in side.at("armies").iter() {
                let a = self.armies.get(&aid);
                if a.truthy() && a.at("battle") == bt.at("id") {
                    a.set("battle", Val::None);
                    a.set("assault", false);
                    a.set("state", if a.atb("path") { "move" } else { "idle" });
                    a.set("grace", self.t + 1.0);
                }
            }
        }
        self.battles.pop(bt.at("id"));
    }

    /// Remet d'aplomb batailles, sièges et armées que la diplomatie ou une prise ont laissés sans objet.
    /// Python : `settle_conflicts(self)`.
    // engine.py, lignes 2891 à 2923
    pub fn settle_conflicts(&mut self) {
        for bt in self.battles.values() {
            let (s0, s1) = bt.at("sides").pair();
            if !self.hostile(&s0.ats("owner"), &s1.ats("owner"))
                || (s1.at("node").is_some() && self.nodes.at(s1.at("node")).at("owner") != s1.at("owner"))
            {
                self.dissolve_battle(&bt);
            }
        }
        for n in self.nodes.iter() {
            let s = n.at("siege");
            if s.truthy() {
                let by = s.at("by");
                if !self.factions.has(&by) || !self.factions.at(&by).atb("alive") || !self.hostile(by.s(), &n.ats("owner")) {
                    n.set("siege", Val::None);
                }
            }
        }
        let battle_nodes = Val::set_from(self.battles.values().into_iter().map(|bt| bt.at("node")).filter(|x| x.is_some()).collect());
        for a in self.armies.values() {
            let nid = a.at("at_node");
            let st = a.at("state");
            if nid.is_none() || !(st == "idle" || st == "siege") || a.atb("battle") || !a.atb("regs") || a.getb("boat") {
                continue;
            }
            let n = self.nodes.at(&nid);
            let ns = n.at("siege");
            let (ao, no) = (a.ats("owner"), n.ats("owner"));
            if ns.truthy() && ns.at("by") == ao && st == "siege" {
                continue;
            }
            if st == "idle" && !self.hostile(&ao, &no) {
                if !self.friendly(&ao, &no) && self.t >= a.get_or("grace", 0).f() && !AA::may_stay(self, &a, &no) {
                    self.retreat(&a); // la paix (ou un traité) l'a laissée chez un voisin : elle rentre chez elle
                }
                continue;
            }
            if battle_nodes.has(&nid) || (ns.truthy() && ns.at("by") != ao) || self.t < a.get_or("grace", 0).f() {
                a.set("state", "idle");
                continue;
            }
            // armée restée sur une place hostile sans siège (relève battue, siège levé...) : on reprend comme à l'arrivée
            // (sans fenêtre de choix : ce n'est pas une arrivée en marche)
            a.set("state", "idle");
            self.arrive_node(&a, nid.i(), false);
            if a.at("state") == "siege" || a.atb("battle") {
                for bt in self.battles.values() {
                    if bt.at("node").is_some() {
                        battle_nodes.push(bt.at("node"));
                    }
                }
            }
        }
    }

    /// Python : `start_battle(self, att, de, gx, gy, node=None, ambush=False, surprise=False)`.
    /// att, de : listes d'armées (de est complétée sur place des armées amies présentes dans la place) ;
    /// node : numéro de la place attaquée, ou None. La bataille : dict(id, x, y, node, t0, ambush, surprise, terrain,
    /// cover, defbonus, river, sides=[dict(owner, armies, men0, lost, node) × 2], recent, landing, phase, mor, log0…).
    // engine.py, lignes 2925 à 2978
    pub fn start_battle(&mut self, att: &Val, de: &Val, gx: f64, gy: f64, node: &Val, ambush: bool, surprise: bool) {
        let bid = self.nid("b");
        let code_a = att.at(0).ats("owner");
        let code_d;
        if node.is_some() {
            code_d = self.nodes.at(node).ats("owner");
            for a in self.armies.values() {
                if a.at("at_node") == *node
                    && a.at("state") == "idle"
                    && a.at("owner") != code_a
                    && self.friendly(&a.ats("owner"), &code_d)
                    && !de.has(&a)
                {
                    de.push(a);
                }
            }
        } else {
            code_d = de.at(0).ats("owner");
        }
        let ter = self.geo.terrain_at(gx, gy);
        let c = self.geo.cell(gx, gy);
        let tt = TERRAIN().at(ter);
        let bt = dict! {
            "id" => &bid, "x" => gx, "y" => gy, "node" => node, "t0" => self.t, "ambush" => ambush, "surprise" => surprise,
            "terrain" => tt.at(0), "cover" => tt.at(2), "defbonus" => tt.at(3),
            "river" => if c >= 0 { self.geo.river[c as usize] as i64 } else { 0 },
            "sides" => list![
                dict! {"owner" => &code_a, "armies" => att.iter().map(|a| a.at("id")).collect::<Val>(), "men0" => 0.0, "lost" => 0.0, "node" => Val::None},
                dict! {"owner" => &code_d, "armies" => de.iter().map(|a| a.at("id")).collect::<Val>(), "men0" => 0.0, "lost" => 0.0, "node" => node}
            ],
            "recent" => list![0.0, 0.0]
        };
        let sides = bt.at("sides");
        for (side, lst) in [(sides.at(0), att), (sides.at(1), de)] {
            for a in lst.iter() {
                a.set("state", "battle");
                a.set("battle", &bid);
                // ordre de bataille, pour les régiments anéantis (bury)
                a.set("ro", a.at("regs").iter().map(|r| list![r.at("id"), r.at("type")]).collect::<Val>());
                let p = if de.has(&a) || ambush { list![] } else { a.at("path") };
                a.set("path", p);
                side.inc("men0", self.army_men(&a));
            }
            if side.at("node").is_some() {
                let n = self.nodes.at(side.at("node"));
                side.inc("men0", &n.at("milice") + &py::sum_v(n.at("garrison").iter().map(|r| r.at("n"))));
            }
        }
        if ambush {
            for a in de.iter() {
                for r in a.at("regs").iter() {
                    let v = &r.at("morale") - 25.0 * (1.0 + self.mod_(&code_a, "ambush", 0.0));
                    r.set("morale", py_max(5, v));
                }
            }
        }
        bt.set("landing", att.iter().any(|a| a.getb("landing")));
        for lst in [att, de] {
            for a in lst.iter() {
                if self.gen_trait(&a) == "inspirant" {
                    for r in a.at("regs").iter() {
                        let top = 100.0 + self.mod_(&a.ats("owner"), "morale", 0.0);
                        r.set("morale", py_min(top, &r.at("morale") + 10));
                    }
                }
            }
        }
        let ph = self.battle_phase(&bt);
        bt.set("phase", ph);
        bt.set("mor", list![100, 100]);
        for (si, lst) in [(0i64, att), (1, de)] {
            for a in lst.iter() {
                if a.at("owner") != self.player.as_str() || a.get_or("tac_auto", true).truthy() {
                    self.choose_tactics(&a, &bt, si);
                }
            }
        }
        self.battles.set(&bid, &bt);
        bt.set("log0", BL::snapshot(self, &bt)); // forces au début, pour le journal des batailles (logs/)
        TB::on_battle_start(self, &bt); // bataille du joueur : elle attend son choix (à la main, sur ordres ou automatique)
        let gname = self.place_name(gx, gy);
        let p = self.player.clone();
        if code_a == p || code_d == p || p == code_a || p == code_d {
            self.alert_pause(false);
            let kind = if ambush { "Embuscade" } else if node.is_some() { "Assaut" } else { "Bataille" };
            let t = format!("{kind} {gname} : {} attaque {}.", self.fname(&code_a), self.fname(&code_d));
            self.log("battle", &t, &dict! {"x" => gx, "y" => gy, "who" => &code_a, "important" => true});
        }
    }

    /// Python : `fname(self, code)`.
    // engine.py, lignes 2980 à 2981
    pub fn fname(&self, code: &str) -> String {
        if code == R::NEUTRAL { "les insurgés".to_string() } else { self.faction_name(code) }
    }

    /// Python : `place_name(self, x, y)`.
    /// (`&mut self` à cause de nearest_node : à calculer avant le `self.log(…)` qui s'en sert.)
    // engine.py, lignes 2983 à 2989
    pub fn place_name(&mut self, x: f64, y: f64) -> String {
        let nid = self.nearest_node(x, y, None, 1000000000.0);
        let gn = self.geo.nodes.at(&nid);
        let d = py::hypot(gn.atf("x") - x, gn.atf("y") - y);
        let name = gn.ats("name");
        if d < 3.0 {
            let c0 = name.chars().next().expect("IndexError: string index out of range");
            return if !"AEIOUÉÈH".contains(c0) { format!("de {name}") } else { format!("d'{name}") };
        }
        format!("près de {name}")
    }

    /// Python : `side_units(self, bt, si)`.
    /// Rend une liste de tuples (code du propriétaire, régiment, armée).
    // engine.py, lignes 2991 à 2999
    pub fn side_units(&self, bt: &Val, si: i64) -> Val {
        let side = bt.at("sides").at(si);
        let units = list![];
        for aid in side.at("armies").iter() {
            let a = self.armies.get(&aid);
            if a.truthy() {
                for r in a.at("regs").iter() {
                    units.push(tup![a.at("owner"), r, &a]);
                }
            }
        }
        units
    }

    // ------------------------------------------------------------------ tactique
    /// Python : `arm_class(typ)`.
    /// `Game::arm_class(typ)` (staticmethod) : 'inf', 'cavalerie' ou 'artillerie'.
    // engine.py, lignes 3003 à 3004
    pub fn arm_class(typ: &str) -> String {
        let u = R::UNITS();
        if u.has(typ) { u.at(typ).ats("cls") } else { "inf".to_string() }
    }

    /// Python : `battle_phase(self, bt)`.
    /// 'canonnade', 'fusillade' ou 'charge'.
    // engine.py, lignes 3006 à 3014
    pub fn battle_phase(&self, bt: &Val) -> &'static str {
        let age = self.t - bt.atf("t0");
        let mor = bt.get_or("mor", list![100, 100]);
        if age < 0.25 && !bt.atb("ambush") {
            return "canonnade";
        }
        // une armée surtout montée n'attend pas : elle charge dès que les canons se sont tus
        let (m0, m1) = (mor.atf(0), mor.atf(1));
        let mn = if m1 < m0 { m1 } else { m0 };
        let cav = bt.get_or("cav", list![0, 0]);
        let (c0, c1) = (cav.atf(0), cav.atf(1));
        let mx = if c1 > c0 { c1 } else { c0 };
        if age < 1.0 && mn > 45.0 && !(age >= 0.4 && mx >= 0.55) {
            return "fusillade";
        }
        "charge"
    }

    /// Python : `gen_trait(self, a)`.
    /// a : une armée, ou None. Rend le trait de son général (texte), ou None.
    // engine.py, lignes 3016 à 3018
    pub fn gen_trait(&self, a: &Val) -> Val {
        let g = if a.truthy() { a.get("gen") } else { Val::None };
        if g.truthy() { g.at("trait") } else { Val::None }
    }

    /// Python : `gen_level_k(self, a)`.
    /// a : une armée, ou None.
    // engine.py, lignes 3020 à 3024
    pub fn gen_level_k(&self, a: &Val) -> f64 {
        let g = if a.truthy() { a.get("gen") } else { Val::None };
        // (+5 % par grade jusqu'au général de division ; lieutenant général et maréchal sont des titres : au banc du
        // 31/10/2026, +20 % au maréchal creusait l'écart entre camps de 48 %)
        let lvl = if g.truthy() { g.atf("lvl") } else { 1.0 };
        1.0 + 0.05 * ((if lvl < 3.0 { lvl } else { 3.0 }) - 1.0)
    }

    /// Vulnérabilité d'une unité cible face à une arme donnée.
    /// Python : `unit_vul(self, cls_att, typ, fm, protected, phase='charge')`.
    /// typ : un type d'unité, ou 'milice' ; fm : la formation ('ligne', 'colonne', 'carre', 'carre_forme', 'tirailleurs').
    // engine.py, lignes 3026 à 3047
    pub fn unit_vul(&self, cls_att: &str, typ: &str, fm: &str, protected: bool, phase: &str) -> f64 {
        let par_arme = |art: f64, cav: f64, inf: f64| match cls_att {
            "artillerie" => art,
            "cavalerie" => cav,
            "inf" => inf,
            _ => panic!("KeyError: {}", py::repr_s(cls_att)),
        };
        let mut v;
        if typ == "artillerie" {
            v = if protected { 0.6 } else if cls_att == "cavalerie" { 1.6 } else { 1.2 };
        } else if typ == "cavalerie" {
            v = if phase == "charge" { 0.9 } else { 0.5 }; // tenue en réserve, hors de portée, jusqu'à la charge
        } else if typ == "milice" {
            v = 1.1;
        } else {
            v = 1.0;
            if fm == "ligne" {
                v *= if cls_att == "cavalerie" { 1.3 } else { 1.0 };
            } else if fm == "colonne" {
                v *= if cls_att == "artillerie" { 1.35 } else { 1.0 };
            } else if fm == "carre" {
                v *= par_arme(1.6, 0.35, 1.1);
            } else if fm == "carre_forme" {
                // surprise pendant qu'elle forme le carré : l'infanterie est à la merci des cavaliers
                v *= par_arme(1.3, 1.7, 1.2);
            } else if fm == "tirailleurs" {
                v *= par_arme(0.75, 1.4, 0.85);
            }
        }
        v
    }

    /// Python : `foe_mix(self, bt, si)`.
    /// Rend (les unités ennemies comme side_units, part de cavalerie, part d'artillerie).
    // engine.py, lignes 3049 à 3054
    pub fn foe_mix(&self, bt: &Val, si: i64) -> (Val, f64, f64) {
        let foe = self.side_units(bt, 1 - si);
        let regs: Vec<Val> = foe.iter().map(|u| u.at(1)).collect();
        let tot = somme_ou_1(regs.iter().map(|r| r.at("n")));
        let cav = somme(regs.iter().filter(|r| r.at("type") == "cavalerie").map(|r| r.at("n"))) / tot;
        let art = somme(regs.iter().filter(|r| r.at("type") == "artillerie").map(|r| r.at("n"))) / tot;
        (foe, cav, art)
    }

    /// Formation adaptée à la phase et aux armes de l'ennemi (IA ou général laissé libre).
    /// Python : `choose_formation(self, a, bt, si, phase)`.
    // engine.py, lignes 3056 à 3065
    pub fn choose_formation(&self, a: &Val, bt: &Val, si: i64, phase: &str) -> &'static str {
        let (_, cav, art) = self.foe_mix(bt, si);
        if phase == "canonnade" {
            return if art > 0.12 { "tirailleurs" } else { "ligne" };
        }
        if phase == "fusillade" {
            return if cav > 0.4 {
                "carre"
            } else if bt.atb("cover") && art > 0.2 {
                "tirailleurs"
            } else {
                "ligne"
            };
        }
        if cav > 0.25 {
            return "carre";
        }
        if si == 0 { "colonne" } else { "ligne" }
    }

    /// Formation et plan choisis par l'IA (ou le général) au début d'une bataille.
    /// Python : `choose_tactics(self, a, bt, si)`.
    // engine.py, lignes 3067 à 3089
    pub fn choose_tactics(&mut self, a: &Val, bt: &Val, si: i64) {
        let (foe, _cav, _art) = self.foe_mix(bt, si);
        let regs = a.at("regs").vec();
        let mine = somme_ou_1(regs.iter().map(|r| r.at("n")));
        let my_art = somme(regs.iter().filter(|r| r.at("type") == "artillerie").map(|r| r.at("n"))) / mine;
        let my_cav = somme(regs.iter().filter(|r| r.at("type") == "cavalerie").map(|r| r.at("n"))) / mine;
        let ph = bt.get("phase");
        let phase = if ph.truthy() { ph.string() } else { self.battle_phase(bt).to_string() };
        let fm = self.choose_formation(a, bt, si, &phase);
        let terrain = bt.ats("terrain");
        let my_pow = self.army_power(a, &terrain);
        let mut foe_pow = py::sum(foe.iter().map(|u| {
            let (o, r, x) = u.triple();
            self.reg_power(o.s(), &r, &terrain, 1.0, false, &x)
        })) + 1.0;
        let sides = bt.at("sides");
        if sides.at(1 - si).at("node").is_some() {
            let n = self.nodes.at(sides.at(1 - si).at("node"));
            foe_pow += n.atf("milice") * R::MILICE_POWER * self.milice_k(&n.ats("owner")) * (1.0 + 0.35 * n.atf("fort"));
        }
        let pl = if my_pow < 0.5 * foe_pow && sides.at(si).at("node").is_none() {
            "harcelement"
        } else if my_art >= 0.08 && (si == 0 || bt.at("node").is_some()) {
            "artillerie"
        } else if my_cav >= 0.25 && R::OPEN_TERRAIN().has(&bt.at("terrain")) {
            "debordement"
        } else if si == 1 && my_pow < foe_pow {
            "tenir"
        } else {
            "frontal"
        };
        a.set("fm", fm);
        a.set("pl", pl);
    }

    /// Résolution automatique (choix « Automatique », batailles sans le joueur), par pas de campagne : pertes typées
    /// selon la phase, les formations et les plans, puis la fin, recalée sur les batailles jouées sur le champ de
    /// bataille. En rase campagne, le camp dominé (battle_yield) ou dont le moral casse se retire en bon ordre ; seule une
    /// armée presque anéantie (moins de 18 % de ses hommes) est mise en déroute et poursuivie. Devant une place,
    /// l'assaillant dominé décroche, mais un assaut brisé reflue en désordre ; le défenseur ne décroche jamais : il rend
    /// la place s'il cède. Au bout de 4 jours, le plus puissant l'emporte.
    /// Python : `update_battles(self, dt, only=None)`.
    /// only : None, ou l'identifiant de la seule bataille à faire avancer.
    // engine.py, lignes 3091 à 3283
    pub fn update_battles(&mut self, dt: f64, only: &Val) {
        const K: f64 = 0.20;
        for bid in self.battles.keys() {
            if only.is_some() && bid != *only {
                continue;
            }
            let bt = self.battles.get(&bid);
            if !bt.truthy() || !TB::is_auto(&bt) {
                continue; // (bataille en attente du choix, ou commandée sur le champ de bataille)
            }
            let sides = bt.at("sides");
            let (s0, s1) = sides.pair();
            if !self.hostile(&s0.ats("owner"), &s1.ats("owner"))
                || (s1.at("node").is_some() && self.nodes.at(s1.at("node")).at("owner") != s1.at("owner"))
            {
                self.dissolve_battle(&bt); // capitulation ou paix survenue pendant ce même pas de temps
                continue;
            }
            let age = self.t - bt.atf("t0");
            let phase = self.battle_phase(&bt);
            if bt.get("phase") != phase {
                // les généraux laissés libres adaptent leur formation à la nouvelle phase
                for si in 0..2i64 {
                    for aid in sides.at(si).at("armies").iter() {
                        let a = self.armies.get(&aid);
                        if a.truthy() && (a.at("owner") != self.player.as_str() || a.get_or("tac_auto", true).truthy()) {
                            let fm = self.choose_formation(&a, &bt, si, phase);
                            if a.get("fm") != fm {
                                a.set("fm", fm);
                                a.set("fm_t", self.t - 0.05);
                            }
                        }
                    }
                }
            }
            bt.set("phase", phase);
            TB::auto_battle_tick(self, &bt, dt); // munitions consommées, fatigue
            let wxf = self.wx(bt.atf("x"), bt.atf("y")).atf("fire");
            let terrain = bt.ats("terrain");
            let open_ground = R::OPEN_TERRAIN().has(&bt.at("terrain"));
            let cover = bt.atb("cover");
            let pw_ph = R::PHASE_W().at(phase);
            let phw: [f64; 3] = [pw_ph.atf("artillerie"), pw_ph.atf("inf"), pw_ph.atf("cavalerie")];
            // P : puissance par arme (artillerie, inf, cavalerie), dans l'ordre des dict du Python
            let mut P = [[0.0f64; 3]; 2];
            let targets = [list![], list![]]; // (poids, type, formation, protégé, objet, armée)
            let mut men = [0.0f64, 0.0];
            // part de cavalerie de chaque camp (le carré fusille les escadrons qui le chargent)
            let mut cs = [0.0f64; 2];
            for si in 0..2i64 {
                let us = self.side_units(&bt, si);
                let regs: Vec<Val> = us.iter().map(|u| u.at(1)).collect();
                let tot = somme_ou_1(regs.iter().map(|r| r.at("n")));
                cs[si as usize] = somme(regs.iter().filter(|r| r.at("type") == "cavalerie").map(|r| r.at("n"))) / tot;
            }
            let cav_share = list![cs[0], cs[1]];
            bt.set("cav", &cav_share);
            self.square_reflex(&bt, phase, &cav_share, dt);
            let mut flank = [false, false];
            for si in 0..2i64 {
                let su = si as usize;
                let side = sides.at(si);
                let kept: Val = side
                    .at("armies")
                    .iter()
                    .filter(|aid| self.armies.has(aid) && self.armies.at(aid).atb("regs"))
                    .collect();
                side.set("armies", kept);
                let units = self.side_units(&bt, si);
                let node = if side.at("node").is_some() { self.nodes.at(side.at("node")) } else { Val::None };
                let protected = units.iter().any(|u| Game::arm_class(u.at(1).at("type").s()) != "artillerie")
                    || (node.is_some() && node.at("milice") > 0i64);
                let (mut fb, mut wall) = (1.0, 1.0);
                if node.is_some() {
                    let o = node.ats("owner");
                    let fort_eff = AA::fort_eff(self, &node, &sides.at(1 - si).at("owner"));
                    fb = 1.0 + 0.35 * fort_eff + (if o != R::NEUTRAL { self.mod_(&o, "fort_bonus", 0.0) } else { 0.0 });
                    wall = 1.0 / (1.0 + 0.55 * fort_eff); // les remparts abritent les défenseurs
                }
                for u in units.iter() {
                    let (owner_v, r, a) = u.triple();
                    let owner = owner_v.s();
                    let cls = Game::arm_class(r.at("type").s());
                    let ci = rang_arme(&cls);
                    let (fm, pl, tr) = (a.get_or("fm", "ligne"), a.get_or("pl", "frontal"), self.gen_trait(&a));
                    let mut rp = self.reg_power(owner, &r, &terrain, wxf, cover, &a);
                    let rm = self.reg_mods(owner, &r, &Val::None);
                    let rmg = |k: &str| rm.get_or(k, 0.0).f();
                    rp *= (0.75 + 0.25 * a.atf("supply")) * phw[ci] * fb;
                    if cls == "inf" {
                        if fm == "ligne" {
                            rp *= if phase == "fusillade" { 1.2 + rmg("ligne_fire") } else { 1.05 };
                        } else if fm == "colonne" {
                            rp *= if phase == "charge" { 1.25 + rmg("colonne_charge") } else { 0.85 };
                        } else if fm == "carre" {
                            rp *= 0.9 * (1.0 + (0.6 + rmg("carre_fire")) * cs[1 - su]);
                        } else if fm == "tirailleurs" && cover {
                            rp *= 1.15;
                        }
                    } else if phase == "charge" {
                        rp *= 1.0 + rmg(if cls == "cavalerie" { "cav_charge" } else { "art_charge" });
                    }
                    if pl == "artillerie" {
                        if cls == "artillerie" && phase != "charge" {
                            rp *= 1.4;
                        } else if cls == "inf" && phase == "canonnade" {
                            rp *= 0.8;
                        }
                    } else if pl == "debordement" {
                        if cls == "cavalerie" && phase != "canonnade" {
                            rp *= if open_ground { 1.6 } else { 0.8 };
                            if open_ground && cs[su] > cs[1 - su] * 1.2 {
                                flank[su] = true;
                            }
                        } else if cls == "inf" {
                            rp *= 0.92;
                        }
                    } else if pl == "tenir" {
                        rp *= if si == 1 || bt.at("node").is_some() { 0.9 } else { 0.65 };
                    } else if pl == "harcelement" {
                        rp *= 0.6;
                    }
                    if tr == "audacieux" && si == 0 {
                        rp *= 1.12;
                    }
                    if si == 1 {
                        rp *= bt.atf("defbonus") * (if a.at("stance") == "retranche" { 1.2 } else { 1.0 });
                    } else {
                        if bt.atf("river") >= 2.0 {
                            rp *= 0.85;
                        }
                        if bt.getb("landing") && age < 0.5 {
                            rp *= 0.8;
                        }
                        if bt.atb("ambush") && age < 0.35 {
                            rp *= 1.8 + self.mod_(owner, "ambush", 0.0) + (if tr == "eclaireur" { 0.25 } else { 0.0 });
                        } else if bt.atb("surprise") && age < 0.2 {
                            rp *= 1.3;
                        }
                    }
                    let swift = 1.0 - self.mod_(owner, "fm_swift", 0.0);
                    let reorg = self.t - a.get_or("fm_t", -9).f() < 0.1 * (if swift > 0.2 { swift } else { 0.2 });
                    if reorg {
                        rp *= 0.6; // réorganisation en cours
                    }
                    P[su][ci] += rp;
                    men[su] += r.atf("n");
                    let mut recv = 1.0;
                    if pl == "tenir" {
                        recv *= if si == 1 { 0.8 } else { 0.9 };
                    } else if pl == "harcelement" {
                        recv *= 0.6;
                    } else if pl == "artillerie" && phase == "canonnade" {
                        recv *= 0.85;
                    }
                    if tr == "prudent" && si == 1 {
                        recv *= 0.88;
                    } else if tr == "audacieux" {
                        recv *= 1.05;
                    }
                    // (le même calcul que plus haut : fm_t n'a pas bougé entre-temps)
                    let fm_t = if fm == "carre" && reorg { Val::from("carre_forme") } else { fm.clone() };
                    targets[su].push(tup![r.at("n"), r.at("type"), fm_t, protected, &r, &a, recv * wall]);
                }
                if node.is_some() {
                    let o = node.ats("owner");
                    P[su][1] += node.atf("milice") * R::MILICE_POWER * self.milice_k(&o) * fb * phw[1] * 1.05;
                    men[su] += node.atf("milice");
                    targets[su].push(tup![node.at("milice"), "milice", "ligne", protected, &node, Val::None, wall]);
                    if o != R::NEUTRAL {
                        for r in node.at("garrison").iter() {
                            let cls = Game::arm_class(r.at("type").s());
                            let ci = rang_arme(&cls);
                            P[su][ci] += self.reg_power(&o, &r, &terrain, wxf, false, &Val::None) * fb * phw[ci]
                                * (if r.at("type") == "garde" { R::GARDE_HOME } else { 1.0 });
                            men[su] += r.atf("n");
                            targets[su].push(tup![r.at("n"), r.at("type"), "ligne", protected, &r, Val::None, wall]);
                        }
                    }
                    // les canons du rempart (servants à l'abri des murs : ils ne comptent pas parmi les pertes)
                    P[su][0] += self.fort_guns_power(&node, &terrain, wxf) * R::FORT_GUNS_AUTO * phw[0];
                }
            }
            // pertes typées : chaque arme frappe selon la vulnérabilité des cibles
            let mut _lost_now = [0.0f64, 0.0];
            for si in 0..2i64 {
                let su = si as usize;
                let tg = &targets[su];
                let tgv = tg.vec();
                let W = somme(tgv.iter().map(|t| t.at(0)));
                if W <= 0.0 {
                    continue;
                }
                let owner_si = sides.at(si).ats("owner");
                let cas = 1.0 + (if owner_si != R::NEUTRAL { self.mod_(&owner_si, "casualties", 0.0) } else { 0.0 });
                let mut dmg_j = vec![0.0f64; tgv.len()];
                for (ci, cls) in ARMES.iter().enumerate() {
                    let pw = P[1 - su][ci];
                    if pw <= 0.0 {
                        continue;
                    }
                    let vul: Vec<f64> = tgv
                        .iter()
                        .map(|t| t.atf(0) * self.unit_vul(cls, t.at(1).s(), t.at(2).s(), t.atb(3), phase))
                        .collect();
                    let V = py::sum(vul.iter().copied());
                    if V <= 0.0 {
                        continue;
                    }
                    let D = K * pw * dt * (V / W);
                    for (j, v) in vul.iter().enumerate() {
                        dmg_j[j] += D * v / V;
                    }
                }
                for (j, t) in tgv.iter().enumerate() {
                    dmg_j[j] *= t.atf(6) * cas;
                }
                let mt = if men[su] > 1.0 { men[su] } else { 1.0 };
                _lost_now[su] = self.apply_typed_losses(&bt, si, tg, &dmg_j, mt, if flank[1 - su] { 1.35 } else { 1.0 });
            }
            let mor = list![self.side_morale(&bt, 0), self.side_morale(&bt, 1)];
            bt.set("mor", &mor);
            // fin ?
            let (mut res, mut disengage) = (Val::None, false);
            for si in 0..2i64 {
                let side = sides.at(si);
                let m_now = self.side_men(&bt, si);
                let wiped = m_now < 10.0 || m_now < side.atf("men0") * 0.18;
                if wiped || mor.atf(si) < 12.0 {
                    res = Val::from(1 - si);
                    // en rase campagne, une armée ébranlée se retire comme dans les batailles commandées (ses fuyards la
                    // rejoignent) : seuls les débris d'une armée presque anéantie sont poursuivis ; devant une place,
                    // l'assaut brisé reflue en désordre
                    disengage = bt.at("node").is_none() && !wiped;
                    break;
                }
            }
            let pv = || {
                let d = |p: &[f64; 3]| dict! {"artillerie" => p[0], "inf" => p[1], "cavalerie" => p[2]};
                list![d(&P[0]), d(&P[1])]
            };
            if res.is_none() {
                (res, disengage) = self.battle_yield(&bt, &pv());
            }
            if res.is_none() && age > 1.0 {
                for si in 0..2i64 {
                    let side = sides.at(si);
                    let arms: Vec<Val> =
                        side.at("armies").iter().filter(|x| self.armies.has(x)).map(|x| self.armies.at(&x)).collect();
                    if side.at("node").is_none()
                        && !arms.is_empty()
                        && arms.iter().all(|x| x.get("pl") == "harcelement")
                        && mor.at(si) <= mor.at(1 - si)
                    {
                        (res, disengage) = (Val::from(1 - si), true);
                        break;
                    }
                }
            }
            if res.is_none() && age > 4.0 {
                let tot = [py::sum(P[0]), py::sum(P[1])];
                let w = if tot[0] >= tot[1] { 0 } else { 1 };
                res = Val::from(w);
                disengage = sides.at(1 - w).at("node").is_none();
            }
            if res.is_some() {
                self.end_battle(&bt, res.i(), disengage);
            }
        }
    }

    /// Tour par tour : une bataille automatique du joueur se règle sur-le-champ. Elle se joue en temps virtuel (la
    /// date de la campagne ne bouge pas), comme les jours qu'elle durerait.
    /// Python : `resolve_battle_now(self, bt)`.
    /// (try / finally en Python : l'horloge est remise même si la bataille échoue.)
    // engine.py, lignes 3285 à 3296
    pub fn resolve_battle_now(&mut self, bt: &Val) {
        let (bid, t0) = (bt.at("id"), self.t);
        let essai = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            for _ in 0..py::int(8.0 / SUBSTEP) {
                if !self.battles.has(&bid) {
                    break;
                }
                self.t += SUBSTEP;
                self.update_battles(SUBSTEP, &bid);
            }
        }));
        self.restore_clock(t0);
        if let Err(e) = essai {
            std::panic::resume_unwind(e);
        }
    }

    /// Fin d'un temps virtuel (marche ou bataille réglée dans le tour du joueur) : la date reprend où elle était.
    /// Python : `restore_clock(self, t0)`.
    // engine.py, lignes 3298 à 3308
    pub fn restore_clock(&mut self, t0: f64) {
        self.t = t0;
        for b in self.battles.values() {
            b.set("t0", py_min(b.at("t0"), t0));
        }
        for a in self.armies.values() {
            if a.get_or("grace", 0.0).f() > t0 + 1.0 {
                a.set("grace", t0 + 1.0);
            }
        }
        for n in self.nodes.iter() {
            let s = n.get("siege");
            if s.truthy() && s.get_or("since", t0).f() > t0 {
                s.set("since", t0); // siège commencé en chemin : il commence aujourd'hui
            }
        }
    }

    /// Un camp dominé cède avant la déroute, comme dans les batailles commandées (rules.WD_*) : hors d'une place, il
    /// décroche en bon ordre ; le défenseur d'une place la rend. P : puissance de chaque camp à cet instant, par arme.
    /// Renvoie (vainqueur, décrochage), ou (None, False) si le combat continue.
    /// Python : `battle_yield(self, bt, P)`.
    /// P : liste de deux dict(artillerie, inf, cavalerie). Rend (0, 1 ou None ; décrochage).
    // engine.py, lignes 3310 à 3324
    pub fn battle_yield(&self, bt: &Val, P: &Val) -> (Val, bool) {
        let ps = |i: i64| py::sum(P.at(i).values().iter().map(|v| v.f()));
        let tot = [ps(0), ps(1) * R::WD_DEF]; // (le défenseur tient mieux que sa puissance)
        let sides = bt.at("sides");
        let loss: Vec<f64> = sides
            .iter()
            .map(|s| {
                let m0 = s.atf("men0");
                s.atf("lost") / (if m0 > 1.0 { m0 } else { 1.0 })
            })
            .collect();
        for si in py::sorted_by_key(vec![0usize, 1], |&i| -loss[i]) {
            // le plus éprouvé d'abord
            let o = tot[1 - si];
            let ratio = tot[si] / (if o > 1e-9 { o } else { 1e-9 });
            if sides.at(si).at("node").is_some() {
                if loss[si] > R::WD_PLACE_LOSS && ratio < R::WD_RATIO {
                    return (Val::from(1 - si as i64), false);
                }
                continue;
            }
            if (loss[si] > R::WD_LOSS && ratio < R::WD_RATIO) || (loss[si] > R::WD_EVEN_LOSS && ratio < 1.0) {
                return (Val::from(1 - si as i64), true);
            }
        }
        (Val::None, false)
    }

    /// Python : `apply_typed_losses(self, bt, si, tg, dmg_j, men_total, shock=1.0)`.
    /// tg : la liste des cibles du camp, des tuples (poids, type, formation, protégé, objet, armée ou None, recv) où
    /// l'objet est le régiment ou, pour 'milice', la place ; dmg_j : les pertes de chacune (même ordre). Rend le total des pertes.
    // engine.py, lignes 3326 à 3356
    pub fn apply_typed_losses(&mut self, bt: &Val, si: i64, tg: &Val, dmg_j: &[f64], men_total: f64, shock: f64) -> f64 {
        let side = bt.at("sides").at(si);
        let frac_side = py::sum(dmg_j.iter().copied()) / men_total * shock; // pris de flanc, le moral s'effondre plus vite
        let mut total = 0.0;
        for (t, &d) in tg.iter().zip(dmg_j) {
            let (typ, obj, a) = (t.at(1), t.at(4), t.at(5));
            let loss;
            if typ == "milice" {
                loss = py_min(obj.at("milice"), d);
                obj.dec("milice", &loss);
            } else {
                loss = py_min(obj.at("n"), d);
                obj.dec("n", &loss);
                // (un régiment allié : la Croix-Rouge de son camp)
                let o = if a.is_some() { a.ats("owner") } else { side.ats("owner") };
                if self.factions.has(o.as_str()) {
                    // Croix-Rouge : une part des blessés rejoindra le régiment (end_battle)
                    obj.set("wnd", &obj.get_or("wnd", 0.0) + &(&loss * self.mod_(&o, "wounded", 0.0)));
                }
                let mut k = if a.is_some() { 230.0 } else { 150.0 };
                if a.is_some() {
                    if a.get("pl") == "tenir" {
                        k *= 0.7;
                    }
                    if self.gen_trait(&a) == "inspirant" {
                        k *= 0.85;
                    }
                }
                obj.set("morale", py_max(0.0, &obj.at("morale") - frac_side * k));
            }
            total += loss.f();
        }
        side.inc("lost", total);
        if side.at("node").is_some() {
            let n = self.nodes.at(side.at("node"));
            n.set("garrison", n.at("garrison").iter().filter(|r| r.at("n") >= 5i64).collect::<Val>());
        }
        for aid in side.at("armies").iter() {
            let a = self.armies.get(&aid);
            if a.truthy() {
                a.set("regs", a.at("regs").iter().filter(|r| r.at("n") >= 5i64).collect::<Val>());
            }
        }
        total
    }

    /// Python : `side_men(self, bt, si)`.
    // engine.py, lignes 3358 à 3364
    pub fn side_men(&self, bt: &Val, si: i64) -> f64 {
        let mut m = py::sum_v(self.side_units(bt, si).iter().map(|u| u.at(1).at("n")));
        let nd = bt.at("sides").at(si).at("node");
        if nd.is_some() {
            let n = self.nodes.at(&nd);
            m = &m + &(&n.at("milice") + &py::sum_v(n.at("garrison").iter().map(|r| r.at("n"))));
        }
        m.f()
    }

    /// Python : `side_morale(self, bt, si)`.
    // engine.py, lignes 3366 à 3381
    pub fn side_morale(&mut self, bt: &Val, si: i64) -> f64 {
        let (mut tot, mut w) = (0.0, 0.0);
        for u in self.side_units(bt, si).iter() {
            let r = u.at(1);
            tot += (&r.at("morale") * &r.at("n")).f();
            w += r.atf("n");
        }
        let nd = bt.at("sides").at(si).at("node");
        if nd.is_some() {
            let n = self.nodes.at(&nd);
            for r in n.at("garrison").iter() {
                tot += (&r.at("morale") * &r.at("n")).f();
                w += r.atf("n");
            }
            let fort = AA::fort_eff(self, &n, &Val::None);
            let x = 55.0 + 15.0 * fort;
            let mm = if x < 100.0 { x } else { 100.0 };
            tot += mm * n.atf("milice");
            w += n.atf("milice");
        }
        if w > 0.0 { tot / w } else { 0.0 }
    }

    /// La bataille tactique de ce bid, sortie de son champ (TB.find : en cours, puis finie) : (où elle était, elle).
    /// (bt['id'] n'est jamais vide : le cas `not bid` de find ne se présente pas.)
    fn sortir_tac(&mut self, bid: &Val) -> (u8, Option<Box<TacticalBattle>>) {
        TB::ensure(self);
        if self.tactical.as_ref().is_some_and(|tb| *bid == tb.bid.as_str()) {
            return (1, self.tactical.take());
        }
        if self.tac_done.as_ref().is_some_and(|tb| *bid == tb.bid.as_str()) {
            return (2, self.tac_done.take());
        }
        (0, None)
    }

    /// Fin d'une bataille, automatique ou commandée (bridge.finish) : prise de la place (sauf décrochage), retraite du
    /// vaincu (poursuivi s'il est rompu, en bon ordre s'il décroche ; il y perd des traînards : rules.LOSER_STRAGGLE),
    /// prisonniers (ceux du champ de bataille pour une bataille commandée), lassitude et bilan des deux camps, journal.
    /// Python : `end_battle(self, bt, winner, disengage=False)`.
    /// winner : 0 ou 1.
    // engine.py, lignes 3383 à 3535
    pub fn end_battle(&mut self, bt: &Val, winner: i64, disengage: bool) {
        let loser = 1 - winner;
        let sides = bt.at("sides");
        let (W, L) = (sides.at(winner), sides.at(loser));
        let nd = sides.iter().map(|s| s.at("node")).find(|n| n.is_some()).unwrap_or(Val::None);
        if nd.is_some() && !bt.has("tac") {
            let n = self.nodes.at(&nd);
            self.damage_town(&n, R::DEG_ASSAUT); // (une bataille commandée a compté ses maisons : bridge.finish)
        }
        // régiments restés sur le champ de bataille (bataille commandée ou non)
        let mut tous = W.at("armies").vec();
        tous.extend(L.at("armies").vec());
        for aid in &tous {
            let a = self.armies.get(aid);
            if a.truthy() && a.has("ro") {
                let ro = a.pop("ro");
                self.bury(&a, &ro);
            }
        }
        for si in 0..2i64 {
            // Croix-Rouge : les blessés soignés reviennent aux régiments (wnd, compté pendant la bataille)
            let nd = sides.at(si).at("node");
            let mut regs: Vec<Val> = self.side_units(bt, si).iter().map(|u| u.at(1)).collect();
            if nd.is_some() {
                regs.extend(self.nodes.at(&nd).at("garrison").vec());
            }
            for r in regs {
                if r.has("wnd") {
                    let mx = r.at("max");
                    let s = &r.at("n") + &r.pop("wnd");
                    r.set("n", py_min(mx, s));
                }
            }
        }
        let mut caught = 0.0; // hommes rattrapés pendant la poursuite
        let gname = self.place_name(bt.atf("x"), bt.atf("y"));
        let has_cav = self.side_units(bt, winner).iter().any(|u| u.at(1).at("type") == "cavalerie");
        let w_owner = W.ats("owner");
        if !disengage && L.at("node").is_some() {
            // prise de la place, avant la retraite des vaincus (sinon ils se replieraient dans la place perdue)
            let nid = L.ati("node");
            self.nodes.at(nid).set("milice", 0);
            self.nodes.at(nid).set("garrison", list![]);
            self.capture(nid, &w_owner, false);
            for aid in W.at("armies").iter() {
                let a = self.armies.get(&aid);
                if a.truthy() {
                    a.set("at_node", nid);
                    let (x, y) = self.node_xy(nid);
                    a.set("x", x);
                    a.set("y", y);
                    a.set("edge", Val::None);
                    a.set("onroad", true);
                }
            }
        }
        let tac_bt = bt.getb("tac");
        for si in 0..2i64 {
            for aid in sides.at(si).at("armies").iter() {
                let a = self.armies.get(&aid);
                if !a.truthy() {
                    continue;
                }
                a.set("battle", Val::None);
                a.set("landing", false);
                if a.getb("gen") {
                    // (ses états de service : les douze dernières batailles)
                    let issue = if si == winner { "victoire" } else if disengage { "décroché" } else { "défaite" };
                    let gen = a.at("gen");
                    let etats = gen.get_or("etats", list![]).copy();
                    etats.push(list![self.date_str(&Val::None), &gname, issue]);
                    gen.set("etats", etats.slice(Some(-12), None));
                    if !tac_bt {
                        // (une bataille commandée : le sort de l'état-major, bridge.finish)
                        let assaut = sides.at(si).at("node").is_none() && sides.at(1 - si).at("node").is_some();
                        let quoi = if si == winner || disengage { "victoire" } else { "defaite" };
                        let sort = self.risques_general(&a, quoi, assaut);
                        if sort == "blesse" {
                            self.blesser_general(&a, &Val::None);
                        } else if sort == "tue" {
                            self.tuer_general(&a);
                        } else if sort == "pris" {
                            self.capturer_general(&a, &sides.at(1 - si).at("owner"), true);
                        }
                    }
                }
                if si == winner {
                    for r in a.at("regs").iter() {
                        r.set("xp", py_min(100, &r.at("xp") + 8));
                        r.set("morale", py_max(r.at("morale"), 35));
                    }
                    a.set("state", if a.atb("path") { "move" } else { "idle" });
                    a.set("assault", false);
                    // (l'ennemi qui décroche en bon ordre lui laisse aussi le terrain : c'est une victoire)
                    // une vraie bataille rangée compte plus qu'une escarmouche contre la milice d'un village
                    let foe_armies = L.atb("armies") || (L.at("node").is_some() && {
                        let ty = self.geo.nodes.at(L.at("node")).at("type");
                        ty == "capitale" || ty == "ville" || ty == "fort"
                    });
                    let vraie = foe_armies && L.at("men0") >= 300i64;
                    self.general_xp(&a, &(if vraie { Val::from(1) } else { Val::from(0.34) }), vraie);
                    if vraie && !disengage {
                        // médailles (SPEC-GENERAUX.md)
                        if L.at("men0") >= &W.at("men0") * 2 {
                            self.decorer(&a, "victoire à un contre deux");
                        } else if L.at("node").is_some()
                            && self.nodes.at(L.at("node")).at("fort") >= 1i64
                            && self.geo.nodes.at(L.at("node")).at("type") != "village"
                        {
                            let t = format!("prise de {}", self.geo.nodes.at(L.at("node")).at("name"));
                            self.decorer(&a, &t);
                        } else if W.at("node").is_some() {
                            let t = format!("siège de {} repoussé", self.geo.nodes.at(W.at("node")).at("name"));
                            self.decorer(&a, &t);
                        } else if !L.at("armies").iter().any(|x| self.armies.has(&x)) {
                            self.decorer(&a, "armée ennemie anéantie");
                        }
                    }
                } else {
                    // poursuite d'un vaincu rompu (déjà faite sur le champ de bataille d'une bataille commandée)
                    let mut pursuit = if disengage || tac_bt {
                        0.0
                    } else {
                        (if has_cav { R::PURSUIT_CAV } else { R::PURSUIT_FOOT }) * (1.0 + self.mod_(&a.ats("owner"), "retreat", 0.0))
                    };
                    if self.gen_trait(&a) == "prudent" {
                        pursuit *= 0.5;
                    }
                    // battu, même en bon ordre, il sème des traînards dans la retraite (comptés avec les désertions du mois)
                    let mut gone = 0.0;
                    for r in a.at("regs").iter() {
                        caught += r.atf("n") * pursuit;
                        r.scale("n", 1.0 - pursuit);
                        gone += r.atf("n") * R::LOSER_STRAGGLE;
                        r.scale("n", 1.0 - R::LOSER_STRAGGLE);
                        r.set("morale", py_max(r.at("morale"), 18));
                    }
                    if gone > 0.0 {
                        a.set("des", &a.get_or("des", 0.0) + gone);
                        a.set("des_why", a.get("des_why").or("traînards de la retraite"));
                    }
                    self.prune(&a);
                    if !a.atb("regs") {
                        // (armée anéantie : son général tombe, est pris, ou rentre blessé à la réserve)
                        let sort = if !tac_bt { self.risques_general(&a, "aneantie", false) } else { Val::None };
                        if sort == "pris" {
                            self.capturer_general(&a, &W.at("owner"), false);
                        } else if sort != "tue" && a.getb("gen") && !a.at("gen").getb("interim") {
                            if sort == "blesse" {
                                let bm = R::BLESSURE_MOIS();
                                let mois = self.rng.randint(bm.ati(0), bm.ati(1));
                                a.at("gen").set("retour", self.t + (30 * mois) as f64);
                            }
                            self.reserver(&a.ats("owner"), &a.at("gen"));
                        }
                        self.armies.del(&aid);
                        continue;
                    }
                    self.retreat(&a);
                }
            }
        }
        let tac = bt.get("tac"); // bataille menée à la main : ses prisonniers, déjà faits sur le champ de bataille
        if tac.truthy() {
            for si in 0..2i64 {
                let (taker, n_) = (sides.at(1 - si).at("owner"), tac.at("prisoners").at(si));
                if n_ > 0i64 && self.factions.has(&taker) {
                    let pr = self.factions.at(&taker).setdefault("prisoners", dict! {});
                    let o = sides.at(si).at("owner");
                    pr.set(&o, &pr.get_or(&o, 0) + &n_);
                }
            }
        }
        // (dans les rues d'une place, assaillants repoussés ou défenseurs cernés se rendent plus souvent)
        let prisoners = if tac.truthy() {
            tac.at("prisoners").at(loser)
        } else {
            let k = if bt.at("node").is_none() { R::PRISON_LOSS } else { R::PRISON_ASSAULT };
            Val::from(py::int(L.atf("lost") * k + caught * R::PRISON_CAUGHT))
        };
        if prisoners > 0i64 && self.factions.has(&W.at("owner")) && !tac.truthy() {
            let pr = self.factions.at(&W.at("owner")).setdefault("prisoners", dict! {});
            let o = L.at("owner");
            pr.set(&o, &pr.get_or(&o, 0) + &prisoners);
        }
        // toute bataille lasse le pays et compte au bilan, qu'elle finisse par une déroute ou par un décrochage
        for (si, side) in [(winner, &W), (loser, &L)] {
            if self.factions.has(&side.at("owner")) {
                let f_ = self.factions.at(&side.at("owner"));
                f_.set("_lost_m", &f_.get_or("_lost_m", 0.0) + &side.at("lost"));
                let st = f_.at("stats");
                st.inc(if si == winner { "won" } else { "lost" }, 1);
                st.inc("killed", sides.at(1 - si).at("lost"));
                // dernière bataille et son lieu, pour la carte (estafettes, fêtes, deuil)
                f_.set(
                    "lb",
                    list![(si == winner) as i64, py::round_n(self.t, 2), py::round_n(bt.atf("x"), 2), py::round_n(bt.atf("y"), 2)],
                );
            }
        }
        if bt.at("node").is_none() {
            // champ de bataille : la carte y montre blessés et tombes (décor seulement)
            let t = self.t;
            self.sites = self.sites.iter().filter(|x| t - x.atf("t") < SITE_DAYS as f64).collect();
            // (le vainqueur et ses prisonniers : la colonne vers l'arrière)
            self.sites.push(dict! {
                "x" => py::round_n(bt.atf("x"), 2), "y" => py::round_n(bt.atf("y"), 2), "t" => py::round_n(self.t, 2),
                "l" => sides.iter().map(|x| Val::from(py::int(x.atf("lost")))).collect::<Val>(),
                "o" => sides.iter().map(|x| x.at("owner")).collect::<Val>(),
                "w" => winner, "p" => py::int_v(&py_max(0, &prisoners))
            });
        }
        if W.at("node").is_some() {
            // la place a tenu : le siège des vaincus est levé (pas celui d'un autre camp)
            let n = self.nodes.at(W.at("node"));
            let s = n.at("siege");
            if s.truthy() && s.at("by") == L.at("owner") {
                n.set("siege", Val::None);
            }
        }
        self.battles.pop(bt.at("id"));
        // journal des batailles (logs/)
        let (ou, tb) = if tac_bt { self.sortir_tac(&bt.at("id")) } else { (0, None) };
        BL::campaign_end(self, bt, winner, disengage, prisoners.f(), tb.as_deref());
        match ou {
            1 => self.tactical = tb,
            2 => self.tac_done = tb,
            _ => {}
        }
        let p = self.player.clone();
        let (wo, lo) = (W.ats("owner"), L.ats("owner"));
        if p == wo || p == lo || [&W, &L].iter().any(|s| self.friendly(&p, &s.ats("owner"))) {
            let won = self.friendly(&p, &wo);
            let nt = if (if disengage { &lo } else { &wo }) == R::NEUTRAL { "nt" } else { "" };
            let head = if disengage {
                let kind = if bt.at("node").is_some() {
                    "Assaut"
                } else if bt.atb("ambush") {
                    "Embuscade"
                } else {
                    "Bataille"
                };
                format!("{kind} {gname} : {} se replie{nt} en bon ordre devant {}.", self.fname(&lo), self.fname(&wo))
            } else {
                format!("{} {gname} — {} l'emporte{nt}.", if won { "Victoire" } else { "Défaite" }, self.fname(&wo))
            };
            let (s0, s1) = sides.pair();
            let (la, ld) = (py::int(s0.atf("lost")), py::int(s1.atf("lost")));
            let mut txt = format!("{head} Pertes : {} {la}, {} {ld}.", self.fname(&s0.ats("owner")), self.fname(&s1.ats("owner")));
            if prisoners > 0i64 {
                txt += &format!(" Prisonniers : {prisoners}.");
            }
            let extra = dict! {"win" => won, "a" => s0.at("owner"), "d" => s1.at("owner"), "la" => la, "ld" => ld};
            self.log(
                "battle_end",
                &txt,
                &dict! {"x" => bt.at("x"), "y" => bt.at("y"), "who" => &wo, "important" => true, "extra" => extra},
            );
        }
    }

    /// Python : `retreat(self, a)`.
    // engine.py, lignes 3537 à 3576
    pub fn retreat(&mut self, a: &Val) {
        let code = a.ats("owner");
        a.set("state", "retreat");
        a.set("grace", self.t + 1.0);
        a.set("stance", "normal");
        a.set("hold", false);
        a.set("qrt", false);
        a.set("assault", false);
        let mut best: Option<(f64, i64)> = None;
        let (ax, ay) = (a.atf("x"), a.atf("y"));
        for gn in self.geo.nodes.iter() {
            let n = self.nodes.at(gn.at("id"));
            let no = n.ats("owner");
            let s = n.at("siege");
            if (no == code || self.friendly(&code, &no)) && !(s.truthy() && s.at("by") != code) {
                let d = py::hypot(gn.atf("x") - ax, gn.atf("y") - ay);
                if best.is_none() || d < best.unwrap().0 {
                    best = Some((d, gn.ati("id")));
                }
            }
        }
        let Some((_, goal)) = best else {
            self.armies.del(a.at("id"));
            return;
        };
        if a.at("at_node") == goal {
            a.set("state", "idle");
            return;
        }
        a.set("mode", "route");
        // d'abord sans traverser de terres fermées ; une retraite ne doit jamais piéger l'armée : au besoin, elle
        // passe quand même, et le délai de grâce s'applique
        let block = AA::closed_owners(self, &code);
        let mut legs = Val::None;
        for blk in [block.clone(), Val::new_set()] {
            legs = self.plan_route(a, goal, &blk);
            if !legs.truthy() {
                let (gx, gy) = self.node_xy(goal);
                let mask = AA::cell_mask(self, &blk);
                let pts = self.geo.astar(a.atf("x"), a.atf("y"), gx, gy, 120000, mask.as_deref());
                legs = match pts {
                    Some(pts) if !pts.is_empty() => {
                        let pts: Val = pts.iter().map(|&(x, y)| list![x, y]).collect();
                        list![dict! {"kind" => "off", "pts" => pts, "i" => 1}]
                    }
                    _ => Val::None,
                };
            }
            if legs.truthy() || !block.truthy() {
                break;
            }
        }
        if !legs.truthy() {
            for r in a.at("regs").iter() {
                r.scale("n", 0.6);
            }
            a.set("state", "idle");
            return;
        }
        a.set("path", legs);
        a.set("target", dict! {"node" => goal});
        a.set("at_node", Val::None);
    }

    /// Python : `order_retreat(self, code, aid)`.
    // engine.py, lignes 3578 à 3610
    pub fn order_retreat(&mut self, code: &str, aid: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (false, "Armée introuvable.".to_string());
        }
        if a.at("state") == "battle" {
            let bt = self.battles.get(a.at("battle"));
            if bt.truthy() && bt.atb("ambush") && self.t - bt.atf("t0") < 0.3 {
                return (false, "Prise en embuscade, l'armée ne peut pas encore se dégager !".to_string());
            }
            if bt.truthy() {
                for side in bt.at("sides").iter() {
                    if side.at("armies").has(aid) {
                        side.at("armies").remove(aid);
                        side.dec("men0", self.army_men(&a));
                    }
                }
                for r in a.at("regs").iter() {
                    r.scale("n", 0.9);
                }
                a.set("battle", Val::None);
                self.retreat(&a);
                if bt.get("mode") == "attente" && !TB::involves_player(self, &bt) {
                    bt.set("mode", "auto"); // (elle ne le concerne plus : la campagne ne l'attend plus)
                }
                let sides = bt.at("sides");
                if !sides.at(0).atb("armies") && sides.at(0).at("node").is_none() {
                    self.end_battle(&bt, 1, false);
                } else if !sides.at(1).atb("armies") && sides.at(1).at("node").is_none() {
                    self.end_battle(&bt, 0, false);
                }
                return (true, "Retraite ordonnée.".to_string());
            }
        }
        if a.at("state") == "siege" {
            self.end_siege_for(&a);
        }
        let here = a.at("at_node");
        self.retreat(&a);
        if !self.armies.has(aid) {
            return (true, "L'armée, cernée, se débande.".to_string());
        }
        if a.at("state") == "idle" && a.at("at_node") == here {
            return (false, "Aucune place amie libre où se replier : l'armée reste sur place.".to_string());
        }
        (true, "Retraite ordonnée.".to_string())
    }
}
