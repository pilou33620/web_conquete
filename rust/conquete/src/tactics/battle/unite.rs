//! Porte game/tactics/battle.py, lignes 1704 à 2293 : repérage ; une unité ; feu (le temps, la fumée, le choix de la cible) ; maisons touchées, en feu, en ruine ; maisons occupées, barricades.
//! Conventions : l'en-tête de battle/mod.rs ; les aides `pmax`, `pmin`, `dans`, `okind`, `tk` : ordres.rs.

use super::ordres::{dans, okind, pmax, pmin};
use super::*;
use std::f64::consts::PI;

impl TacticalBattle {
    // ------------------------------------------------------------------ repérage
    /// Python (battle.py, l. 1705-1711) : `def _view_range(self, o)`
    /// o : l'unité qui regarde. Portée de sa vue (m).
    pub fn _view_range(&mut self, o: &Val) -> f64 {
        let mut r = VIEW().get_or(self.weather.as_str(), 1800).f() * pmax(0.25, self.light);
        if dans(&o.at("cls"), &["cavalerie", "general"]) {
            r *= 1.15;
        }
        if self.r#trait(o.ati("side")) == "eclaireur" {
            r *= 1.25;
        }
        r
    }

    /// Python (battle.py, l. 1713-1755) : `def _update_vision(self)`
    /// Refait self.seen_by (deux sets d'ids : `self.seen_by.set(side, seen)`) et `u.seen` de chaque unité.
    pub fn _update_vision(&mut self) {
        self._vis_t = self.clock;
        for side in [0i64, 1] {
            let mine: Vec<Val> =
                self.units.iter().filter(|o| o.at("side") == side && U::alive(o) && o.at("state") != "hors").collect();
            let seen = Val::new_set();
            let bal = self.spec.get_or("balloon", list![0, 0]).at(side); // aérostiers : le ballon captif de l'état-major voit tout
            let obs: Vec<Val> = if bal.truthy() {
                mine.iter().filter(|o| o.at("cls") == "general" && !o.atb("wounded")).cloned().collect()
            } else {
                vec![]
            };
            let eclaireur = self.r#trait(side) == "eclaireur";
            for e in self.units.iter() {
                if e.at("side") == side || !U::alive(&e) {
                    continue;
                }
                let (ex, ey) = (e.atf("x"), e.atf("y"));
                if obs.iter().any(|o| py::pow(o.atf("x") - ex, 2.0) + py::pow(o.atf("y") - ey, 2.0) <= bal.f() * bal.f()) {
                    seen.push(e.at("id"));
                    continue;
                }
                let recent = self.clock - e.atf("fired_t") < 60.0;
                let ce = Self::cell(ex, ey) as usize;
                let tce = self.map.t[ce] as i64;
                let hidden = WOODS.contains(&tce) || (tce == T_BATI && e.at("cls") != "general");
                let camo = e.at("cls") == "artillerie" && WOODS.contains(&tce);
                let inside = e.at("form") == "maisons" && self._maisons(&e).0 >= MAISON_HIDE;
                let near = (if e.atb("light") { 100.0 } else { 150.0 }) + (if eclaireur { 100.0 } else { 0.0 });
                let he = self.map.h[ce] as i64;
                for o in &mine {
                    let d2 = py::pow(o.atf("x") - ex, 2.0) + py::pow(o.atf("y") - ey, 2.0);
                    let mut vr = self._view_range(o);
                    if self.map.h[Self::cell(o.atf("x"), o.atf("y")) as usize] as i64 > he + 10 {
                        vr *= 1.2;
                    }
                    if d2 > vr * vr {
                        continue;
                    }
                    if camo && d2 > py::pow(if recent { CAMO_FIRE } else { CAMO_SEEN }, 2.0) {
                        continue; // (canons camouflés dans un bois)
                    }
                    if recent {
                        seen.push(e.at("id"));
                        break;
                    }
                    if inside && d2 > MAISON_SEEN * MAISON_SEEN {
                        continue; // (dans les maisons, derrière les volets)
                    }
                    if hidden && d2 > near * near && (e.atb("light") || self._deep(&e, o, d2)) {
                        continue; // (un bataillon posté à la lisière, face à qui regarde, se voit ; les légers non)
                    }
                    if d2 < (60 * 60) as f64 || self.los_units(o, &e) {
                        seen.push(e.at("id"));
                        break;
                    }
                }
            }
            self.seen_by.set(side, seen);
        }
        for u in self.units.iter() {
            let s = self.seen_by.at(1 - u.ati("side")).has(&u.at("id"));
            u.set("seen", s);
        }
    }

    /// L'unité e est-elle enfoncée dans son bois ou ses maisons du côté de l'observateur o (la case à 40 m vers lui
    /// est encore du bois ou du bâti) ? Sinon elle est à la lisière, et se voit comme en terrain découvert.
    ///
    /// Python (battle.py, l. 1757-1762) : `def _deep(self, e, o, d2)`
    /// d2 : carré de la distance entre e et o.
    pub fn _deep(&self, e: &Val, o: &Val, d2: f64) -> bool {
        let d = d2.sqrt();
        let d = if d != 0.0 { d } else { 1.0 };
        let (ex, ey) = (e.atf("x"), e.atf("y"));
        let t = self.map.t[Self::cell(ex + (o.atf("x") - ex) / d * 2.0 * CELL as f64, ey + (o.atf("y") - ey) / d * 2.0 * CELL as f64) as usize] as i64;
        WOODS.contains(&t) || t == T_BATI
    }

    // ------------------------------------------------------------------ une unité
    /// Python (battle.py, l. 1765-1868) : `def _update_unit(self, u, dt)`
    pub fn _update_unit(&mut self, u: &Val, dt: f64) {
        if u.atf("busy") > 0.0 {
            u.set("busy", u.atf("busy") - dt);
            if u.atf("busy") <= 0.0 {
                u.set("busy", 0.0);
                if u.atb("next_form") {
                    u.set("form", u.at("next_form"));
                    u.set("next_form", Val::None);
                }
                if u.at("state") == "ralliement" {
                    u.set("state", "repos");
                    self.log(&format!("{} s'est rallié.", u.at("name")), &u.at("side"), &Val::None);
                }
            }
        }
        if u.atf("reload") > 0.0 {
            u.set("reload", u.atf("reload") - dt);
        }
        let st = u.at("state");
        if st == "deroute" {
            if u.atb("halt") {
                // près du général au calme (ou, sans général, loin de tout ennemi) : les fuyards s'arrêtent et leurs
                // officiers les reforment (voir _morale)
                self._fatigue(u, dt, "repos", 1.0);
                return;
            }
            self._move(u, dt, true);
            if self.off_map(u.ati("side"), u.atf("x"), u.atf("y")) {
                u.set("state", "hors");
                self.log(&format!("{} a fui le champ de bataille.", u.at("name")), &u.at("side"), &Val::None);
            }
            return;
        }
        if st == "melee" || st == "ralliement" {
            self._fatigue(u, dt, if st == "melee" { "melee" } else { "repos" }, 1.0);
            return;
        }
        if st == "charge" {
            self._charge(u, dt);
            return;
        }
        if okind(u) == "retreat" {
            if u.atf("busy") <= 0.0 {
                u.set("still_t", self.clock);
                let dist = self._speed(u, false, false) * dt;
                let cost = self.costs(move_class(u), u.ati("side"));
                self._flee(u, dist, &cost);
                u.set("state", "marche");
                if self.off_map(u.ati("side"), u.atf("x"), u.atf("y")) {
                    u.set("state", "hors");
                    self.log(&format!("{} s'est retiré du champ de bataille.", u.at("name")), &u.at("side"), &Val::None);
                }
            }
            return;
        }
        let kind = okind(u);
        if kind == "volley_charge" && self._volley_charge(u, dt) {
            return;
        }
        if kind == "harass" {
            self._harass(u, dt);
        }
        if okind(u) == "attack" {
            let tg = self.by_id.get(&u.at("target"));
            if tg.is_some() && U::alive(&tg) && tg.at("state") != "hors" && self.seen_by.at(u.ati("side")).has(&tg.at("id")) {
                let (e, mx, _) = U::ranges(u);
                let (e, mx) = (e as f64, mx as f64);
                let d = Self::dist(u, &tg);
                let order = u.at("order");
                if order.get("stop").truthy() {
                    // ordre du joueur : on s'arrête dès la distance du profil (la cible s'est approchée en chemin),
                    // puis on tient et l'on tire ; pas de poursuite d'une cible qui recule (au joueur de redonner
                    // l'ordre), mais on lui fait face
                    if u.atb("path") {
                        let want = U::stop_dist(u, order.at("stop").s());
                        if d < want && u.atf("busy") <= 0.0 {
                            self._approach(u, &tg);
                        } else if u.atb("goal")
                            && u.atf("busy") <= 0.0
                            && self.clock - order.get_or("t_re", -99).f() > 10.0
                            && py::hypot(u.at("goal").at(0).f() - tg.atf("x"), u.at("goal").at(1).f() - tg.atf("y")) > want * 1.1
                        {
                            // la cible a reculé pendant la marche : on corrige l'approche (toutes les 10 s au plus)
                            // pour arriver à portée ; une fois arrivé, plus de poursuite
                            order.set("t_re", self.clock);
                            self._approach(u, &tg);
                        }
                    } else if d > mx && u.atf("busy") <= 0.0 {
                        let b = Self::bearing(u, &tg);
                        let dir = u.atf("dir");
                        if ang_diff(dir, b) > ARC().get_or(&u.at("form"), 1.0).f() {
                            let delta = py::mod_f(b - dir + PI, 2.0 * PI) - PI;
                            let turn = TURN().get_or(&u.at("form"), 0.1).f();
                            u.set("dir", dir + pmax(-turn * dt, pmin(turn * dt, delta)));
                        }
                    }
                } else if (d > e * 0.95 && !u.atb("path")) || (u.atb("path") && d < e * 0.9) {
                    if u.atf("busy") <= 0.0 && (!u.atb("path") || d < e * 0.9) {
                        self._approach(u, &tg);
                    }
                }
            } else if u.at("path") == list![] && u.at("order").get("kind") == "attack" {
                u.set("order", dict! {"kind" => "hold"});
            }
        }
        if u.atb("path") && u.atf("busy") <= 0.0 {
            self._move(u, dt, false);
            if u.atb("path") {
                if kind == "harass" && u.at("order").get("face").is_some() {
                    u.set("dir", u.at("order").at("face")); // le tirailleur qui recule garde l'ennemi en face
                }
                if u.at("cls") == "inf" && u.at("form") == "tirailleurs" {
                    self._fire(u, dt, true);
                }
                return;
            }
            // arrivée
            if u.atb("goal") && u.at("goal").at(2).is_some() {
                u.set("dir", u.at("goal").at(2));
            }
            if okind(u) == "retreat" && self.off_map(u.ati("side"), u.atf("x"), u.atf("y")) {
                u.set("state", "hors");
                self.log(&format!("{} s'est retiré du champ de bataille.", u.at("name")), &u.at("side"), &Val::None);
                return;
            }
            u.set("state", "repos");
            if okind(u) == "attack" && u.at("cls") == "artillerie" {
                self._change_form(u, "batterie");
            }
        } else if !u.atb("path") && u.at("state") == "marche" {
            u.set("state", "repos");
        }
        if kind == "maisons" && !u.atb("path") && u.atf("busy") <= 0.0 && u.at("form") != "maisons" && u.at("order").get("kind") == kind {
            if self._maisons(u).0 > 0.0 {
                // arrivée : on entre (MAISON_IN)
                self._change_form(u, "maisons");
            } else {
                u.set("order", dict! {"kind" => "hold"}); // (chemin introuvable : pas de maison ici)
            }
        } else if kind == "barricade" && u.at("order").get("kind") == kind {
            self._barricading(u);
        }
        self._fatigue(u, dt, "repos", 1.0);
        if u.atf("busy") <= 0.0 {
            self._fire(u, dt, false);
        }
    }

    /// « Salve puis baïonnette » : approche, volée à bout portant, charge. Vrai si l'unité a fini son tour.
    ///
    /// Python (battle.py, l. 1870-1902) : `def _volley_charge(self, u, dt)`
    pub fn _volley_charge(&mut self, u: &Val, dt: f64) -> bool {
        let o = u.at("order");
        let tg = self.by_id.get(&o.get("target"));
        if !(tg.is_some() && U::alive(&tg) && tg.at("state") != "hors" && self.seen_by.at(u.ati("side")).has(&tg.at("id"))) {
            u.set("order", dict! {"kind" => "hold"});
            u.set("fire_mode", "free");
            u.set("path", list![]);
            u.set("goal", Val::None);
            return false;
        }
        let (e, _mx, _) = U::ranges(u);
        let e = e as f64;
        if u.atf("ammo") >= 1.0 && u.atf("fired_t") <= o.get_or("f0", o.at("t0")).f() {
            u.set("fire_mode", "volley"); // (un « cessez le feu » donné entre-temps ne bloque pas la volée)
            let d = Self::dist(u, &tg);
            if d > e * (VOLLEY_CHARGE_AT + 0.1) {
                o.pop("ready");
                if u.atf("busy") <= 0.0 && !u.atb("path") {
                    self._approach_to(u, &tg, e * VOLLEY_CHARGE_AT);
                }
                return false; // (en marche : le mouvement et le tir suivent leur cours normal)
            }
            u.set("path", list![]); // à bonne portée : on s'arrête et la volée part dès que les fusils sont chargés
            u.set("goal", Val::None);
            o.setdefault("ready", self.clock);
            if self.clock - o.atf("ready") < VOLLEY_WAIT {
                return false; // (pas de ligne de tir : on n'attend pas indéfiniment, on charge)
            }
        }
        // salve tirée (ou plus de cartouches) : à la baïonnette
        u.set("fire_mode", "free");
        u.set("order", dict! {"kind" => "charge", "target" => tg.at("id")});
        u.set("target", tg.at("id"));
        if u.at("form") == "carre" {
            u.set("form", "colonne");
        }
        u.set("state", "charge");
        u.set("charge_v", 0.0);
        u.set("path", list![]);
        self.emit("charge", u.atf("x"), u.atf("y"), &tg.at("x"), &tg.at("y"), &Val::None, &u.at("id"));
        true
    }

    /// Tirailleurs qui harcèlent : à portée efficace de l'ennemi, ils reculent s'il approche, avancent s'il s'éloigne.
    ///
    /// Python (battle.py, l. 1904-1926) : `def _harass(self, u, dt)`
    pub fn _harass(&mut self, u: &Val, dt: f64) {
        let o = u.at("order");
        if self.clock < o.get_or("next", 0.0).f() || u.atf("busy") > 0.0 || dans(&u.at("state"), &["melee", "charge"]) {
            return;
        }
        o.set("next", self.clock + HARASS_EVERY);
        let foe = self.nearest_foe(u);
        let (e, mx, _) = U::ranges(u);
        let (e, mx) = (e as f64, mx as f64);
        if foe.is_none() || Self::dist(u, &foe) > mx * 1.6 {
            return;
        }
        let d = Self::dist(u, &foe);
        let b = Self::bearing(u, &foe);
        o.set("face", b);
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        if d < e * HARASS_NEAR {
            let back = e * 0.95 - d + 30.0;
            self._go(u, ux - b.cos() * back, uy - b.sin() * back, &Val::from(b), true, false);
            o.set("face", b);
        } else if d > e * HARASS_FAR {
            let step = d - e * 0.9;
            self._go(u, ux + b.cos() * step, uy + b.sin() * step, &Val::from(b), false, false);
        } else {
            u.set("path", list![]);
            u.set("goal", Val::None);
            u.set("dir", b);
        }
    }

    /// Python (battle.py, l. 1928-1941) : `def _speed(self, u, run=False, rout=False)`
    /// Vitesse (m/s de bataille) ; défauts : run = false, rout = false.
    pub fn _speed(&mut self, u: &Val, run: bool, rout: bool) -> f64 {
        let mut base = super::ordres::tk(u, "speed");
        let cls = u.at("cls");
        if cls == "artillerie" && u.at("form") == "batterie" {
            return 0.0;
        }
        if run || rout {
            base = match cls.s() {
                "cavalerie" | "general" => 5.0,
                "artillerie" => 2.0,
                _ => 2.2,
            };
            if run && cls == "cavalerie" {
                base = 3.5;
            }
        } else {
            base *= if cls == "inf" {
                U::FORM_SPEED().get_or(&u.at("form"), 1.0).f()
            } else if u.at("form") != "ligne" || cls != "cavalerie" {
                1.0
            } else {
                0.85
            };
        }
        let tr = self.r#trait(u.ati("side"));
        if tr == "cavalier" && cls == "cavalerie" {
            base *= 1.1;
        }
        base * (1.0 - 0.35 * u.atf("fat") / 100.0)
    }

    /// Python (battle.py, l. 1943-1992) : `def _move(self, u, dt, rout=False)`
    /// rout : défaut false. `u.path.pop(0)` : la liste de l'unité elle-même (`u.at("path").pop(0)`).
    pub fn _move(&mut self, u: &Val, dt: f64, rout: bool) {
        u.set("still_t", self.clock);
        let side = u.ati("side");
        let cost = self.costs(move_class(u), side);
        let run = u.atb("goal") && u.at("goal").at(3).truthy();
        let sp = self._speed(u, run, rout);
        if sp <= 0.0 {
            return;
        }
        if rout && !u.atb("path") {
            self._flee(u, sp * dt, &cost);
            return;
        }
        let mut budget = sp * dt;
        let mut steps = 0;
        let mut moved = 0.0;
        while budget > 0.01 && u.atb("path") && steps < 6 {
            steps += 1;
            let (ux, uy) = (u.atf("x"), u.atf("y"));
            let c = Self::cell(ux, uy) as usize;
            let cc = cost[c].unwrap_or(1.5);
            // pente
            let (tx, ty) = u.at("path").at(0).xy();
            let (dx, dy) = (tx - ux, ty - uy);
            let l = py::hypot(dx, dy);
            if l < 1.0 {
                u.at("path").pop(0);
                continue;
            }
            let cl = pmin(l, CELL as f64);
            let (nxp, nyp) = (ux + dx / l * cl, uy + dy / l * cl);
            let dh = self.map.h[Self::cell(nxp, nyp) as usize] as i64 - self.map.h[c] as i64;
            let slope = 1.0 + pmax(0.0, dh as f64) / CELL as f64 * (if self.r#trait(side) == "montagnard" { 2.0 } else { 4.0 });
            let k = cc * slope;
            let step = pmin(l, budget / k);
            let (nx, ny) = (ux + dx / l * step, uy + dy / l * step);
            let inside = 0.0 <= nx && nx < W as f64 && 0.0 <= ny && ny < H as f64;
            if inside && cost[Self::cell(nx, ny) as usize].is_none() && cost[c].is_some() {
                u.set("stuck", u.ati("stuck") + 1);
                if u.ati("stuck") <= 2 && u.atb("goal") {
                    let g = u.at("goal");
                    let p = self.plan_path(u, g.at(0).f(), g.at(1).f());
                    u.set("path", p);
                    continue;
                }
                u.set("path", list![]);
                break;
            }
            // (`u.dir = atan2 if not rout else u.dir`, puis `if rout: u.dir = atan2` : atan2 dans les deux cas)
            u.set("dir", dy.atan2(dx));
            u.set("x", nx);
            u.set("y", ny);
            if !inside {
                u.set("x", pmin(pmax(nx, -40.0), (W + 40) as f64));
                u.set("y", pmin(pmax(ny, -40.0), (H + 40) as f64));
            }
            budget -= step * k;
            moved += step;
            if step >= l - 0.01 {
                u.at("path").pop(0);
            }
        }
        if moved > 0.0 {
            let c2 = self.costs(move_class(u), side)[Self::cell(u.atf("x"), u.atf("y")) as usize].unwrap_or(1.0);
            self._fatigue(u, dt, if run || rout { "run" } else { "marche" }, c2);
        }
    }

    /// Fuite d'une troupe en déroute : vers son bord, en obliquant devant l'eau, les murs ou les bois épais.
    ///
    /// Python (battle.py, l. 1994-2009) : `def _flee(self, u, dist, cost)`
    /// dist : mètres à parcourir ce pas-ci ; cost : table de costs (`&cost` d'un `Couts`).
    pub fn _flee(&mut self, u: &Val, dist: f64, cost: &[Option<f64>]) {
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let (ex, ey) = self.edge_point(u.ati("side"), ux, uy);
        let base = (ey - uy).atan2(ex - ux);
        let c0 = cost[Self::cell(ux, uy) as usize].unwrap_or(1.5);
        let step = pmin(CELL as f64, dist / c0);
        for da in [0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2] {
            let a = base + da;
            let (nx, ny) = (ux + a.cos() * step, uy + a.sin() * step);
            if !(0.0 <= nx && nx < W as f64 && 0.0 <= ny && ny < H as f64) {
                // il sort de la carte
                u.set("x", nx);
                u.set("y", ny);
                u.set("dir", a);
                return;
            }
            if cost[Self::cell(nx, ny) as usize].is_some() {
                u.set("x", nx);
                u.set("y", ny);
                u.set("dir", a);
                self._fatigue(u, DT, "run", 1.0);
                return;
            }
        }
    }

    /// Python (battle.py, l. 2011-2023) : `def _fatigue(self, u, dt, what, cost=1.0)`
    /// what : 'marche', 'run', 'melee', 'feu' ou 'repos' (toute autre valeur) ; cost : coût de la case, défaut 1.0.
    pub fn _fatigue(&mut self, u: &Val, dt: f64, what: &str, cost: f64) {
        let k = if self.weather == "canicule" { 1.5 } else { 1.0 };
        let d = match what {
            "marche" => 0.005 * pmin(3.0, cost) * k,
            "run" => {
                if u.at("cls") != "cavalerie" {
                    0.015 * k
                } else {
                    0.02 * k
                }
            }
            "melee" => 0.03 * k,
            "feu" => 0.002 * k,
            _ => {
                if self.clock - u.atf("hit_t") > 30.0 {
                    -0.007
                } else {
                    -0.002
                }
            }
        };
        u.set("fat", pmin(100.0, pmax(0.0, u.atf("fat") + d * dt)));
    }

    // ------------------------------------------------------------------ feu
    /// Le temps tourne : la vue, le tir et la marche suivent aussitôt (ils lisent self.weather).
    ///
    /// Python (battle.py, l. 2026-2031) : `def _wx_turn(self)`
    pub fn _wx_turn(&mut self) {
        self.weather = self.wx_next.string();
        self.wx_at = Val::None;
        self.emit("meteo", W as f64 / 2.0, H as f64 / 2.0, &Val::None, &Val::None, &Val::None, &Val::None);
        let txt = WX_TXT().get_or(self.weather.as_str(), "Le temps change.");
        self.log(txt.s(), &Val::None, &Val::None);
        self._update_vision();
    }

    /// Python (battle.py, l. 2033-2034) : `def _smoke_i(self, x, y)`
    /// Rang du carré de fumée dans self.smoke (`self.smoke[i as usize]`).
    pub fn _smoke_i(&self, x: f64, y: f64) -> i64 {
        (SMOKE_ROWS - 1).min(0i64.max(py::int(py::floordiv_f(y, SMOKE_CELL)))) * SMOKE_COLS
            + (SMOKE_COLS - 1).min(0i64.max(py::int(py::floordiv_f(x, SMOKE_CELL))))
    }

    /// Python (battle.py, l. 2036-2037) : `def smoke_at(self, x, y)`
    pub fn smoke_at(&self, x: f64, y: f64) -> f64 {
        self.smoke[self._smoke_i(x, y) as usize]
    }

    /// Poudre sans fumée : le fusil Lebel (arme 7) ; l'artillerie et les mitrailleuses si leur camp l'a
    /// (rules.VISUALS, comme l'affichage : battle/effets.js, smokeless).
    ///
    /// Python (battle.py, l. 2039-2044) : `def _smokeless(self, u)`
    pub fn _smokeless(&self, u: &Val) -> bool {
        if u.at("cls") == "artillerie" {
            return self.spec.get("marks").or(list![tup![], tup![]]).at(u.ati("side")).or(tup![]).has("sans_fumee");
        }
        u.at("cls") == "inf" && u.ati("arm") >= 7
    }

    /// Ce que la fumée laisse du feu de u sur tg : celle où il se tient, celle qu'il traverse, celle qui cache la
    /// cible.
    ///
    /// Python (battle.py, l. 2046-2052) : `def _smoke_k(self, u, tg)`
    pub fn _smoke_k(&self, u: &Val, tg: &Val) -> f64 {
        if !self._smoke_on {
            return 1.0;
        }
        let (ux, uy, tx, ty) = (u.atf("x"), u.atf("y"), tg.atf("x"), tg.atf("y"));
        let s = self.smoke_at(ux, uy) + 0.5 * self.smoke_at((ux + tx) / 2.0, (uy + ty) / 2.0) + 0.5 * self.smoke_at(tx, ty);
        1.0 - pmin(SMOKE_MAX, SMOKE_K * s)
    }

    /// Python (battle.py, l. 2054-2064) : `def _wx_k(self, u)`
    /// Ce que le temps laisse du feu de u.
    pub fn _wx_k(&self, u: &Val) -> f64 {
        let w = self.weather.as_str();
        let inf = u.at("cls") == "inf";
        if ["pluie", "orage", "tempete"].contains(&w) {
            if inf {
                return if u.ati("arm") <= 2 { 0.5 } else { 0.85 };
            }
            return 0.85;
        }
        if w == "neige" {
            return if inf && u.ati("arm") <= 2 { 0.8 } else { 0.9 };
        }
        if w == "brouillard" {
            return 0.9;
        }
        1.0
    }

    /// Python (battle.py, l. 2066-2092) : `def _pick_target(self, u, mx)`
    /// mx : portée au plus (m). Rend l'unité visée (et pose `u.target`) ou None.
    pub fn _pick_target(&mut self, u: &Val, mx: f64) -> Val {
        let seen = self.seen_by.at(u.ati("side"));
        let cur = self.by_id.get(&u.at("target"));
        if cur.is_some() && U::alive(&cur) && seen.has(&cur.at("id")) && cur.at("state") != "hors" {
            if Self::dist(u, &cur) <= mx && self.los_units(u, &cur) {
                return cur;
            }
        }
        let (mut best, mut bv) = (Val::None, -1e9);
        let (ux, uy, udir) = (u.atf("x"), u.atf("y"), u.atf("dir"));
        for e in self.units.iter() {
            if e.at("side") == u.at("side") || !U::alive(&e) || !seen.has(&e.at("id")) {
                continue;
            }
            let (ex, ey) = (e.atf("x"), e.atf("y"));
            let d = py::hypot(ex - ux, ey - uy);
            if d > mx {
                continue;
            }
            let mut v = -d - ang_diff(udir, (ey - uy).atan2(ex - ux)) * 150.0;
            if e.at("state") == "deroute" {
                v -= 400.0;
            }
            if dans(&e.at("cls"), &["chariot", "general"]) {
                v -= 300.0;
            }
            if u.at("cls") == "artillerie" && dans(&e.at("form"), &["colonne", "carre"]) {
                v += 250.0;
            }
            if u.at("prio") == "artillerie" && e.at("cls") == "artillerie" {
                v += 700.0; // contre-batterie : les canons ennemis d'abord
            }
            if v > bv && self.los_units(u, &e) {
                best = e;
                bv = v;
            }
        }
        if best.is_some() {
            u.set("target", best.at("id"));
        }
        best
    }

    // ================================================================== maisons touchées, en feu, en ruine
    /// Où tombe le boulet de u tiré sur (x, y) : court ou long dans l'axe du tir (BOULET_LONG), un peu de côté
    /// (BOULET_COTE), d'autant plus que la cible est loin. Tiré de battle.rng : même graine, mêmes points de chute.
    ///
    /// Python (battle.py, l. 2095-2105) : `def _chute(self, u, x, y)`
    /// Deux `self.rng.gauss`, dans l'ordre (long, puis côté) ; aucun si la cible est à moins d'un mètre.
    pub fn _chute(&mut self, u: &Val, x: f64, y: f64) -> (f64, f64) {
        let (dx, dy) = (x - u.atf("x"), y - u.atf("y"));
        let d = py::hypot(dx, dy);
        if d < 1.0 {
            return (x, y);
        }
        let (ux, uy) = (dx / d, dy / d);
        let a = self.rng.gauss(0.0, pmin(BOULET_LONG[2], BOULET_LONG[0] + BOULET_LONG[1] * d));
        let b = self.rng.gauss(0.0, pmin(BOULET_COTE[2], BOULET_COTE[0] + BOULET_COTE[1] * d));
        (x + ux * a - uy * b, y + uy * a + ux * b)
    }

    /// Un boulet de u tombe en (x, y) : la case bâtie s'entame ou prend feu (BATI_*), la barricade dressée pendant la
    /// bataille se renverse (BARR_CASSE).
    ///
    /// Python (battle.py, l. 2107-2121) : `def _bati_hit(self, x, y, u)`
    /// Tirages de self.rng : seulement ceux que les `if` / `and` du Python évaluent.
    pub fn _bati_hit(&mut self, x: f64, y: f64, u: &Val) {
        let c = Self::cell(x, y);
        if self.barr_prev.has(c) {
            if self.rng.random() < BARR_CASSE {
                let prev = self.barr_prev.ati(c);
                self._barr_set(c, prev);
            }
            return;
        }
        let cu = c as usize;
        if self.map.t[cu] as i64 != T_BATI || self.bati[cu] >= 2 {
            return;
        }
        let p = (if self.chaume.has(c) { BATI_FEU_CHAUME } else { BATI_FEU }) * (1.0 + 2.0 * self.ufx(u, "shell"));
        if self.rng.random() < p {
            self._bati_set(c, 2);
        } else if self.bati[cu] == 0 && self.rng.random() < BATI_TOUCHE {
            self._bati_set(c, 1);
        }
    }

    /// Python (battle.py, l. 2123-2126) : `def _bati_set(self, c, e)`
    /// c : case ; e : état (0 à 3).
    pub fn _bati_set(&mut self, c: i64, e: i64) {
        self.seq += 1;
        self.bati_log.push(list![self.seq, c, e, py::round(self.clock)]);
        self._bati_mark(c, e, self.clock);
    }

    /// Python (battle.py, l. 2128-2135) : `def _bati_mark(self, c, e, t0)`
    /// t0 : heure de bataille (s) où le feu a pris.
    pub fn _bati_mark(&mut self, c: i64, e: i64, t0: f64) {
        self.bati[c as usize] = e as u8;
        if e == 2 {
            self.feu.set(c, t0);
        } else {
            self.feu.pop(c);
        }
        if e == 3 {
            self._los_cache.clear(); // (une ruine laisse passer la vue)
        }
    }

    /// Toutes les FEU_DT : les maisons brûlées tombent en ruine, le feu gagne les voisines, et la troupe qui est
    /// dans une maison en feu en sort.
    ///
    /// Python (battle.py, l. 2137-2159) : `def _incendie(self)`
    /// Parcourt `self.feu` dans l'ordre d'insertion (copie des items prise au début) ; le tirage de self.rng
    /// n'a lieu que si les conditions qui le précèdent sont vraies.
    pub fn _incendie(&mut self) {
        let wet = if ["pluie", "orage", "tempete", "neige"].contains(&self.weather.as_str()) { 0.4 } else { 1.0 };
        for (c, t0) in self.feu.items() {
            // (ordre d'arrivée : même graine, même incendie)
            let c = c.i();
            if self.clock - t0.f() >= FEU_DUREE {
                self._bati_set(c, 3);
                continue;
            }
            let (i, j) = (c % COLS, c / COLS);
            for cc in [
                if i > 0 { c - 1 } else { -1 },
                if i < COLS - 1 { c + 1 } else { -1 },
                if j > 0 { c - COLS } else { -1 },
                if j < ROWS - 1 { c + COLS } else { -1 },
            ] {
                if cc >= 0
                    && self.map.t[cc as usize] as i64 == T_BATI
                    && self.bati[cc as usize] < 2
                    && self.rng.random() < FEU_PROPAG * wet * (if self.chaume.has(cc) { 2.5 } else { 1.0 })
                {
                    self._bati_set(cc, 2);
                }
            }
        }
        for u in self.units.iter() {
            let c = Self::cell(u.atf("x"), u.atf("y")) as usize;
            if self.bati[c] == 2 && self.map.t[c] as i64 == T_BATI && U::alive(&u) && u.at("state") != "melee" {
                let (nx, ny) = self.nearest_passable(&u, u.ati("side"), u.atf("x"), u.atf("y"), 12, true);
                u.set("x", nx);
                u.set("y", ny);
                u.set("morale", pmax(0.0, u.atf("morale") - FEU_MOR));
                if u.at("form") == "maisons" || u.at("next_form") == "maisons" {
                    u.set("form", Self::_dehors(&u));
                    u.set("next_form", Val::None);
                    u.set("busy", 0.0);
                    u.set("order", dict! {"kind" => "hold"});
                }
                self.log(&format!("{} quitte une maison en feu.", u.at("name")), &u.at("side"), &u.at("side"));
            }
        }
    }

    // ================================================================== maisons occupées, barricades
    /// La formation que reprend la troupe qui sort des maisons.
    ///
    /// Python (battle.py, l. 2162-2165) : `def _dehors(u)`
    /// Méthode statique : `Self::_dehors(&u)`. Rend 'tirailleurs' ou 'ligne'.
    pub fn _dehors(u: &Val) -> &'static str {
        if u.atb("light") {
            "tirailleurs"
        } else {
            "ligne"
        }
    }

    /// Pourquoi u ne peut pas occuper les maisons près de (x, y) ('' si elle le peut), et la case bâtie où elle va
    /// (la plus proche du point, qui ne brûle pas ; une ruine abrite moins : BATI_COVER).
    ///
    /// Python (battle.py, l. 2167-2186) : `def why_maisons(self, u, x, y)`
    /// Rend (raison, où) : raison '' si elle le peut ; où : tuple (x, y) du centre de la case bâtie, ou None.
    /// `min(ok, key=…)` : le premier gagne (`py::min_by_key`).
    pub fn why_maisons(&self, u: &Val, x: f64, y: f64) -> (String, Val) {
        let non = |m: &str| (m.to_string(), Val::None);
        if self.phase != "combat" {
            return non("La bataille n'est pas engagée.");
        }
        if u.at("cls") != "inf" {
            return non("Seule l'infanterie occupe les maisons.");
        }
        if u.at("state") == "deroute" {
            return non("Ces troupes sont en déroute : il faut d'abord les rallier.");
        }
        if dans(&u.at("state"), &["melee", "charge"]) {
            return non("Elle est aux prises : impossible d'occuper les maisons.");
        }
        let cs: Vec<i64> = self.cells_near(x, y, MAISON_R).into_iter().filter(|&c| self.map.t[c as usize] as i64 == T_BATI).collect();
        let ok: Vec<i64> = cs.iter().copied().filter(|&c| self.bati[c as usize] != 2).collect();
        if ok.is_empty() {
            return non(if !cs.is_empty() { "Ces maisons brûlent." } else { "Aucune maison à moins de 60 m." });
        }
        let cf = CELL as f64;
        let c = py::min_by_key(ok, |&c| {
            py::pow(((c % COLS) as f64 + 0.5) * cf - x, 2.0) + py::pow(((c / COLS) as f64 + 0.5) * cf - y, 2.0)
        })
        .unwrap();
        let spot = (((c % COLS) as f64 + 0.5) * cf, ((c / COLS) as f64 + 0.5) * cf);
        if u.at("form") == "maisons" && py::hypot(spot.0 - u.atf("x"), spot.1 - u.atf("y")) < MAISON_CAP_R {
            return ("Elle tient déjà ces maisons.".to_string(), tup![spot.0, spot.1]);
        }
        (String::new(), tup![spot.0, spot.1])
    }

    /// Les maisons que tient u (forme 'maisons') : (part de ses hommes à l'abri, couvert moyen de leurs cases). Chaque
    /// case bâtie qui ne brûle pas, à moins de MAISON_CAP_R, abrite MAISON_MEN hommes, les mieux couvertes d'abord.
    ///
    /// Python (battle.py, l. 2188-2196) : `def _maisons(self, u)`
    pub fn _maisons(&self, u: &Val) -> (f64, f64) {
        let covs: Vec<f64> = self
            .cells_near(u.atf("x"), u.atf("y"), MAISON_CAP_R)
            .into_iter()
            .filter(|&c| self.map.t[c as usize] as i64 == T_BATI && self.bati[c as usize] != 2)
            .map(|c| BATI_COVER[self.bati[c as usize] as usize])
            .collect();
        let covs = py::sorted_by_key_rev(covs, |x| *x);
        let men = u.atf("men");
        let ceil = (men / MAISON_MEN).ceil() as i64;
        let n = if ceil < covs.len() as i64 { ceil } else { covs.len() as i64 };
        if n == 0 {
            return (0.0, 0.0);
        }
        (pmin(1.0, n as f64 * MAISON_MEN / pmax(1.0, men)), py::sum(covs[..n as usize].iter().copied()) / n as f64)
    }

    /// Pourquoi u ne peut pas se barricader ('' si elle le peut).
    ///
    /// Python (battle.py, l. 2198-2221) : `def why_barricade(self, u)`
    pub fn why_barricade(&self, u: &Val) -> String {
        let s = |m: &str| m.to_string();
        if self.phase != "combat" {
            return s("La bataille n'est pas engagée.");
        }
        if u.at("cls") != "inf" {
            return s("Seule l'infanterie dresse des barricades.");
        }
        if u.at("state") == "deroute" {
            return s("Ces troupes sont en déroute : il faut d'abord les rallier.");
        }
        if u.at("form") == "maisons" {
            return s("Elle tient les maisons : qu'elle en sorte d'abord.");
        }
        if u.at("order").or(dict! {}).get("kind") == "barricade" {
            return s("Elle s'y emploie déjà.");
        }
        if !dans(&u.at("state"), &["repos", "feu", "recharge"]) || u.atb("path") || u.atf("busy") > 0.0 {
            return s("Il faut d'abord qu'elle s'arrête.");
        }
        let uid = u.at("id");
        if self.barr.iter().any(|b| b.at("u") == uid && b.at("c").iter().any(|cp| self.barr_prev.has(&cp.at(0)))) {
            return s("Elle a déjà sa barricade.");
        }
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        if self
            .visible_enemies(u.ati("side"))
            .iter()
            .any(|e| U::valid(&e) && py::pow(e.atf("x") - ux, 2.0) + py::pow(e.atf("y") - uy, 2.0) < py::pow(BARR_FOE, 2.0))
        {
            return s("L'ennemi est trop près : pas le temps de se barricader.");
        }
        if matches!(self._barr_style(u), Val::Bool(false)) {
            return s("Rien pour se barricader ici : ni maisons à moins de 80 m, ni bois à moins de 40 m (les sapeurs en dressent partout).");
        }
        if self._barr_line(u).0.is_empty() {
            return s("Pas de terrain où la dresser devant elle (découvert ou route, hors de la zone de l'assaillant).");
        }
        String::new()
    }

    /// De quoi se barricader : 'v' (maisons à BARR_HOUSE : charrettes, tonneaux, meubles), 'b' (bois à BARR_WOOD :
    /// abattis), None (des sapeurs, partout : gabions et terre), False (rien).
    ///
    /// Python (battle.py, l. 2223-2230) : `def _barr_style(self, u)`
    /// Rend 'v', 'b', None ou False (`style == false` / `style.is_none()` : None et False ne se confondent pas).
    pub fn _barr_style(&self, u: &Val) -> Val {
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        if self.cells_near(ux, uy, BARR_HOUSE).iter().any(|&c| self.map.t[c as usize] as i64 == T_BATI) {
            return Val::from("v");
        }
        if self.cells_near(ux, uy, BARR_WOOD).iter().any(|&c| WOODS.contains(&(self.map.t[c as usize] as i64))) {
            return Val::from("b");
        }
        if u.at("type") == "sapeurs" {
            Val::None
        } else {
            Val::Bool(false)
        }
    }

    /// Cases de la barricade de u : une ligne à BARR_D m devant son front, de sa largeur, sur le découvert et les
    /// routes (BARR_ON), hors de la zone de déploiement de l'assaillant ; et ses deux bouts [[x, y], [x, y]].
    ///
    /// Python (battle.py, l. 2232-2255) : `def _barr_line(self, u)`
    /// Rend (cases, bouts) : bouts est la liste [[x, y], [x, y]] (entiers), rangée dans self.barr.
    pub fn _barr_line(&self, u: &Val) -> (Vec<i64>, Val) {
        let (w, d) = U::footprint(u);
        let dir = u.atf("dir");
        let (ca, sa) = (dir.cos(), dir.sin());
        let (cx, cy) = (u.atf("x") + ca * (d / 2.0 + BARR_D), u.atf("y") + sa * (d / 2.0 + BARR_D));
        let z = self.zones.at(0);
        let (z0, z1, z2, z3) = (z.atf(0), z.atf(1), z.atf(2), z.atf(3));
        let mut out: Vec<i64> = Vec::new();
        let mut last: Option<i64> = None;
        let n = 1i64.max(py::int(py::floordiv_f(w, 5.0)));
        let cf = CELL as f64;
        for k in 0..=n {
            let s = (k as f64 / n as f64 - 0.5) * w;
            let (x, y) = (cx - sa * s, cy + ca * s);
            if !(0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64) {
                last = None;
                continue;
            }
            let c = Self::cell(x, y);
            // (en biais, la case du coin aussi : pas de trou en diagonale)
            let cs: Vec<i64> = match last {
                Some(l) if !(c % COLS == l % COLS || c / COLS == l / COLS) => vec![l / COLS * COLS + c % COLS, c],
                _ => vec![c],
            };
            for cc in cs {
                let (xc, yc) = (((cc % COLS) as f64 + 0.5) * cf, ((cc / COLS) as f64 + 0.5) * cf);
                if !out.contains(&cc) && BARR_ON.contains(&(self.map.t[cc as usize] as i64)) && !(z0 <= xc && xc <= z2 && z1 <= yc && yc <= z3) {
                    out.push(cc);
                }
            }
            last = Some(c);
        }
        let pts = list![
            list![py::round(cx + sa * w / 2.0), py::round(cy - ca * w / 2.0)],
            list![py::round(cx - sa * w / 2.0), py::round(cy + ca * w / 2.0)]
        ];
        (out, pts)
    }

    /// Le travail de la barricade : l'ennemi qui approche l'interrompt ; au bout du temps voulu, elle est debout.
    ///
    /// Python (battle.py, l. 2257-2274) : `def _barricading(self, u)`
    pub fn _barricading(&mut self, u: &Val) {
        let o = u.at("order");
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        if self
            .visible_enemies(u.ati("side"))
            .iter()
            .any(|e| U::valid(&e) && py::pow(e.atf("x") - ux, 2.0) + py::pow(e.atf("y") - uy, 2.0) < py::pow(BARR_STOP, 2.0))
        {
            u.set("order", dict! {"kind" => "hold"});
            self.log(&format!("{} abandonne sa barricade : l'ennemi approche.", u.at("name")), &u.at("side"), &Val::None);
            return;
        }
        if self.clock - o.atf("t0") < o.atf("need") {
            return;
        }
        u.set("order", dict! {"kind" => "hold"});
        let (style, (cells, pts)) = (self._barr_style(u), self._barr_line(u));
        if matches!(style, Val::Bool(false)) || cells.is_empty() {
            return;
        }
        let c_list: Val = cells.iter().map(|&c| list![c, self.map.t[c as usize] as i64]).collect();
        self.barr.push(dict! {"u" => u.at("id"), "s" => &style, "pts" => pts, "c" => c_list});
        for &c in &cells {
            self._barr_set(c, T_BARRICADE);
        }
        let fin = if style == "v" {
            " (charrettes, tonneaux, meubles)."
        } else if style == "b" {
            " (un abattis d'arbres)."
        } else {
            "."
        };
        self.log(&format!("{} s'est barricadé{}", u.at("name"), fin), &u.at("side"), &Val::None);
    }

    /// Python (battle.py, l. 2276-2279) : `def _barr_set(self, c, t)`
    /// c : case ; t : son nouveau type (T_BARRICADE, ou le type d'avant pour la renverser).
    pub fn _barr_set(&mut self, c: i64, t: i64) {
        self.seq += 1;
        let prev = self.map.t[c as usize] as i64;
        self.barr_log.push(list![self.seq, c, t, prev]);
        self._barr_mark(c, t, prev);
    }

    /// Python (battle.py, l. 2281-2287) : `def _barr_mark(self, c, t, prev)`
    /// Écrit `self.map.t[c]` et vide les trois caches.
    pub fn _barr_mark(&mut self, c: i64, t: i64, prev: i64) {
        if t == T_BARRICADE {
            self.barr_prev.set(c, prev);
        } else {
            self.barr_prev.pop(c);
        }
        self.map.t[c as usize] = t as u8;
        self._cost_cache.clear();
        self._path_cache.clear();
        self._los_cache.clear();
    }

    /// Une barricade juste devant tg, face à src (à une, deux ou trois cases) ?
    ///
    /// Python (battle.py, l. 2289-2293) : `def _barr_front(self, tg, src)`
    pub fn _barr_front(&self, tg: &Val, src: &Val) -> bool {
        let (tx, ty) = (tg.atf("x"), tg.atf("y"));
        let (dx, dy) = (src.atf("x") - tx, src.atf("y") - ty);
        let l = py::hypot(dx, dy);
        let l = if l != 0.0 { l } else { 1.0 };
        let cf = CELL as f64;
        [1.0, 2.0, 3.0].iter().any(|&k| self.map.t[Self::cell(tx + dx / l * cf * k, ty + dy / l * cf * k) as usize] as i64 == T_BARRICADE)
    }
}
