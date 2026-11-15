//! Porte game/tactics/battle.py, lignes 2295 à 2988 : brèches ouvertes au canon ; le tir et ses pertes (_fire, _damage) ; charges et mêlées.
//! Conventions : l'en-tête de battle/mod.rs ; les aides `pmax`, `pmin`, `dans`, `okind`, `tk` : ordres.rs.

use super::ordres::{dans, okind, pmax, pmin, tk};
use super::*;
use indexmap::IndexMap;
use std::f64::consts::PI;

/// `R.ARMS[cls][min(u.arm, len(R.ARMS[cls]) - 1)][2]` : le multiplicateur de l'arme.
fn arm_mult(cls: &str, u: &Val) -> f64 {
    let a = R::ARMS().at(cls);
    let n = a.len() as i64 - 1;
    let arm = u.ati("arm");
    a.at(if n < arm { n } else { arm }).atf(2)
}

impl TacticalBattle {
    // ================================================================== brèches ouvertes au canon
    /// Point de l'enceinte d'une place le plus proche du canon (ou, avec aim, du point visé), à portée :
    /// (mur, x, y, distance) ou None.
    ///
    /// Python (battle.py, l. 2296-2311) : `def _wall_target(self, u, mx, aim=None)`
    /// aim : tuple (x, y) du point visé, ou None (défaut). Rend le tuple (rang du mur dans self.map.walls, x, y,
    /// distance) ou None.
    pub fn _wall_target(&self, u: &Val, mx: f64, aim: &Val) -> Val {
        let pl = &self.map.place;
        if u.at("side") != 0i64 || u.at("cls") != "artillerie" || !pl.truthy() || !pl.get("battle").truthy() {
            return Val::None;
        }
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let (mut best, mut bv) = (Val::None, 1e18);
        for (wi, w) in self.map.walls.iter().enumerate() {
            if w.get("kind") == "barricade" {
                continue;
            }
            for p in w.at("pts").iter() {
                let (x, y) = p.pair();
                let d = py::hypot(x.f() - ux, y.f() - uy);
                let v = if aim.is_none() { d } else { py::hypot(x.f() - aim.at(0).f(), y.f() - aim.at(1).f()) };
                if d < mx && v < bv {
                    best = tup![wi, x, y, d];
                    bv = v;
                }
            }
        }
        best
    }

    /// Case de barricade debout à BARR_AIM du point visé, à portée du canon : (None, x, y, distance) ou None.
    ///
    /// Python (battle.py, l. 2313-2323) : `def _barr_aim(self, u, mx, aim)`
    /// aim : tuple (x, y). Rend le tuple (None, x, y, distance) ou None.
    pub fn _barr_aim(&self, u: &Val, mx: f64, aim: &Val) -> Val {
        let (ax, ay) = (aim.at(0).f(), aim.at(1).f());
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let cf = CELL as f64;
        let mut best: Option<(f64, Val)> = None;
        for c in self.cells_near(ax, ay, BARR_AIM) {
            if self.barr_prev.has(c) {
                let (x, y) = (((c % COLS) as f64 + 0.5) * cf, ((c / COLS) as f64 + 0.5) * cf);
                let d = py::hypot(x - ux, y - uy);
                let v = py::hypot(x - ax, y - ay);
                if d < mx && (best.is_none() || v < best.as_ref().unwrap().0) {
                    best = Some((v, tup![Val::None, x, y, d]));
                }
            }
        }
        best.map_or(Val::None, |b| b.1)
    }

    /// Canon sans cible : il bat le rempart à portée (l'assaillant), ou la barricade visée. Vrai s'il s'en occupe.
    ///
    /// Python (battle.py, l. 2325-2353) : `def _bombard(self, u, e, mx, aim=None)`
    /// e, mx : portées efficace et maximale (m) ; aim : tuple (x, y) ou None (défaut).
    pub fn _bombard(&mut self, u: &Val, e: f64, mx: f64, aim: &Val) -> bool {
        let bt = if aim.truthy() { self._barr_aim(u, mx, aim) } else { aim.clone() };
        let wt = if bt.truthy() { bt.clone() } else { self._wall_target(u, mx, aim) };
        if !wt.truthy() {
            return false;
        }
        let (wi, x, y, d) = wt.quad();
        let (xf, yf) = (x.f(), y.f());
        let b = (yf - u.atf("y")).atan2(xf - u.atf("x"));
        let dir = u.atf("dir");
        if ang_diff(dir, b) > ARC().get_or(&u.at("form"), 1.0).f() {
            let rate = TURN().get_or(&u.at("form"), 0.1).f();
            let delta = py::mod_f(b - dir + PI, 2.0 * PI) - PI;
            u.set("dir", dir + pmax(-rate * DT, pmin(rate * DT, delta)));
            return true;
        }
        if u.atf("reload") > 0.0 {
            u.set("state", "recharge");
            return true;
        }
        u.set("ammo", pmax(0.0, u.atf("ammo") - 1.0));
        u.set("reload", U::reload_time(u));
        u.set("fired_t", self.clock);
        u.set("state", "feu");
        self._fatigue(u, u.atf("reload"), "feu", 1.0);
        self.emit("canon", u.atf("x"), u.atf("y"), &x, &y, &Val::from(0i64), &u.at("id"));
        if bt.truthy() {
            for _ in 0..U::pieces(u) {
                // (sur une barricade, chaque boulet compte : BARR_CASSE)
                let (cx, cy) = self._chute(u, xf, yf);
                self._bati_hit(cx, cy, u);
            }
            return true;
        }
        let (cx, cy) = self._chute(u, xf, yf); // (un boulet trop long passe le rempart et tombe sur les maisons)
        self._bati_hit(cx, cy, u);
        self._pound(u, wi.i(), xf, yf, d.f(), e, mx);
        true
    }

    /// Python (battle.py, l. 2355-2373) : `def _pound(self, u, wi, x, y, d, e, mx)`
    /// Un coup de la batterie u sur le rempart : wi, x, y, d : le tuple de _wall_target (rang du mur, point,
    /// distance) ; e, mx : portées. Les clés de self.pound sont des textes ('0' à '15' : le secteur).
    pub fn _pound(&mut self, u: &Val, wi: i64, x: f64, y: f64, d: f64, e: f64, mx: f64) {
        let pl = self.map.place.clone();
        let a = (y - pl.atf("y")).atan2(x - pl.atf("x"));
        let k = py::mod_i(py::int(py::mod_f(a, 2.0 * PI) / (2.0 * PI) * BREACH_SECT as f64), BREACH_SECT).to_string();
        if self.pound.get_or(&k, 0.0).f() < 0.0 {
            return; // ce pan est déjà à terre
        }
        if self.siege_t.is_none() {
            self.siege_t = Val::from(self.clock);
        }
        let mult = arm_mult("artillerie", u);
        let dk = if d <= e { 1.0 } else { pmax(0.3, 1.0 - 0.7 * (d - e) / pmax(1.0, mx - e)) };
        let v = &self.pound.get_or(&k, 0.0) + Val::from(U::pieces(u) as f64 * mult * dk);
        self.pound.set(&k, v);
        if self.pound.atf(&k) >= BREACH_PTS * pmax(1.0, pl.get_or("fort", 1).f()) {
            self.pound.set(&k, -1.0);
            self._apply_breach(wi, x, y, BREACH_R);
            self.breach_t.push(list![py::round(self.clock), &k]);
            self.log("Les canons ont ouvert une brèche dans le rempart !", &Val::None, &Val::None);
            let mem = self.ai_mem.get("s1");
            if mem.is_dict() && mem.has("breach") {
                // la garnison (IA) la défendra
                mem.at("breach").push(list![py::round(x - a.cos() * 40.0), py::round(y - a.sin() * 40.0), py::round_n(a, 3)]);
            }
        }
    }

    /// Python (battle.py, l. 2375-2395) : `def _apply_breach(self, wi, x, y, r)`
    /// Ouvre la brèche : écrit `self.map.t`, `self.map.walls[wi]['breach']`, self.breaches, et vide les caches.
    pub fn _apply_breach(&mut self, wi: i64, x: f64, y: f64, r: f64) {
        // le rempart éboulé de part en part : un rempart épais (bastion, terre-plein) s'ouvre sur toute son épaisseur,
        // le long de l'axe de la place (sinon la brèche restait borgne et les colonnes attendaient au pied)
        let pl = self.map.place.clone();
        let a = if pl.truthy() { (y - pl.atf("y")).atan2(x - pl.atf("x")) } else { 0.0 };
        let mut pts = vec![(x, y)];
        for sg in [1.0, -1.0] {
            for k in (10..160).step_by(10) {
                let k = k as f64;
                let q = (x + sg * a.cos() * k, y + sg * a.sin() * k);
                let t = self.terrain_at(q.0, q.1);
                if t != T_MUR && t != T_BRECHE {
                    break;
                }
                pts.push(q);
            }
        }
        for (px_, py_) in pts {
            for c in self.cells_near(px_, py_, r + 10.0) {
                if self.map.t[c as usize] as i64 == T_MUR {
                    self.map.t[c as usize] = T_BRECHE as u8;
                }
            }
        }
        self.map.walls.at(wi).setdefault("breach", list![]).push(list![py::round(x), py::round(y), py::round(r)]);
        self.breaches.push(list![wi, py::round(x), py::round(y), py::round(r)]);
        self._cost_cache.clear();
        self._path_cache.clear();
        self._los_cache.clear();
    }

    /// Python (battle.py, l. 2397-2541) : `def _fire(self, u, dt, moving=False)`
    /// moving : défaut false. `self._pick_target(u, grape)` : grape est un entier pour les canons (seuls à
    /// recevoir 'bombard'). `self.light ** 0.5` → `py::pow(self.light, 0.5)`.
    pub fn _fire(&mut self, u: &Val, dt: f64, moving: bool) {
        if u.atf("ammo") < 1.0 && dans(&u.at("state"), &["feu", "recharge"]) {
            u.set("state", "repos"); // plus de munitions : on ne reste pas en position de tir
        }
        if u.at("fire_mode") == "hold" && okind(u) != "attack" {
            return;
        }
        let cls = u.at("cls");
        let volley = u.at("fire_mode") == "volley" && cls == "inf";
        if u.atf("ammo") < 1.0
            || dans(&cls, &["general", "chariot"])
            || dans(&u.at("state"), &["deroute", "hors", "melee", "charge", "ralliement"])
        {
            return;
        }
        if cls == "artillerie" && u.at("form") != "batterie" {
            return;
        }
        if u.atf("reload") > DT * 1.5 && !moving {
            // en plein rechargement : on garde sa cible et on pivote vers elle
            let tg = self.by_id.get(&u.at("target"));
            if tg.is_some() && U::alive(&tg) && cls != "cavalerie" {
                let b = Self::bearing(u, &tg);
                let dir = u.atf("dir");
                if ang_diff(dir, b) > ARC().get_or(&u.at("form"), 1.0).f() {
                    let rate = TURN().get_or(&u.at("form"), 0.1).f();
                    let delta = py::mod_f(b - dir + PI, 2.0 * PI) - PI;
                    u.set("dir", dir + pmax(-rate * DT, pmin(rate * DT, delta)));
                }
            }
            return;
        }
        let (e, mx, grape) = U::ranges(u);
        let e = e as f64;
        let mut mx = mx as f64;
        if volley {
            mx = pmin(mx, e * VOLLEY_RANGE); // feu de salve : seulement quand tout porte
        } else if cls == "inf" && okind(u) != "attack" {
            // feu à volonté : l'infanterie attend que l'ennemi soit à bonne portée (on ménage les cartouches)
            mx = pmin(mx, e * 1.3);
        }
        let hu = self.height_at(u.atf("x"), u.atf("y"));
        let tg;
        if okind(u) == "bombard" {
            // batterie de brèche : elle ne se détourne du rempart que pour se défendre à mitraille
            tg = self._pick_target(u, grape.f());
            let o = u.at("order");
            if tg.is_none() && self._bombard(u, e, mx, &tup![o.at("x"), o.at("y")]) {
                return;
            }
        } else {
            tg = self._pick_target(u, mx * 1.15);
            if tg.is_none() && u.at("type") != "mitrailleuses" && self._bombard(u, e, mx, &Val::None) {
                return;
            }
        }
        if tg.is_none() {
            if dans(&u.at("state"), &["feu", "recharge"]) {
                u.set("state", "repos");
            }
            return;
        }
        let d = Self::dist(u, &tg);
        let ht = self.height_at(tg.atf("x"), tg.atf("y"));
        let mx_eff = mx * (if hu > ht + 8 { 1.15 } else { 1.0 });
        if d > mx_eff {
            return;
        }
        let b = Self::bearing(u, &tg);
        let arc = if cls != "cavalerie" { ARC().get_or(&u.at("form"), 1.0).f() } else { 1.2 };
        let dir = u.atf("dir");
        if ang_diff(dir, b) > arc {
            // la troupe pivote vers sa cible
            let rate = TURN().get_or(&u.at("form"), 0.1).f() * (if cls == "cavalerie" { 2.0 } else { 1.0 });
            let delta = py::mod_f(b - dir + PI, 2.0 * PI) - PI;
            u.set("dir", dir + pmax(-rate * dt, pmin(rate * dt, delta)));
            return;
        }
        if u.atf("reload") > 0.0 {
            if !moving {
                u.set("state", "recharge");
            }
            return;
        }
        // salve
        let tr = self.r#trait(u.ati("side"));
        let fat_k = 1.0 - 0.3 * u.atf("fat") / 100.0;
        let mor_k = 0.6 + 0.4 * u.atf("morale") / 100.0;
        let xp_k = ST::xp_k(u.atf("xp"));
        let cov = self._fire_cover(&tg, u);
        let pr = U::precision(u, d);
        let tkf = tk(u, "fire");
        let tform = tg.at("form");
        let mut cas;
        let kind;
        if u.at("type") == "mitrailleuses" {
            // feu roulant : une gerbe de balles sur une bande étroite, comme une salve ; ni boulet, ni mitraille
            cas = U::pieces(u) as f64 * P_REFFYE * pr * VUL_FIRE().get_or(&tform, 1.0).f() * (1.0 - cov);
            if tg.at("cls") == "artillerie" {
                cas *= REFFYE_VS_PIECE;
            }
            if tg.at("cls") == "general" {
                cas *= 0.3;
            }
            cas *= fat_k * mor_k * xp_k * self._wx_k(u) * py::pow(self.light, 0.5);
            kind = "salve";
            u.set("ammo", u.atf("ammo") - 1.0);
        } else if cls == "artillerie" {
            let pcs = U::pieces(u) as f64;
            let mut mult = arm_mult("artillerie", u);
            if tr == "artilleur" {
                mult *= 1.25;
            }
            let use_grape = grape.truthy() && d <= grape.f() && u.at("shot") != "boulet";
            if u.at("shot") == "mitraille" && !use_grape {
                return; // (mitraille ordonnée : les canons attendent l'ennemi à portée de gerbe)
            }
            if use_grape {
                cas = pcs * P_MITRAILLE * grape_k(d, grape.f()) * mult * VUL_GRAPE().get_or(&tform, 1.0).f() * (1.0 - cov);
                kind = "mitraille";
            } else {
                cas = pcs * P_BOULET * mult * ball_k(d, e) * VUL_BALL().get_or(&tform, 1.0).f() * (1.0 - cov * 0.6);
                kind = "canon";
            }
            if tg.at("cls") == "general" {
                cas *= 0.2;
            }
            cas *= fat_k * mor_k * xp_k * self._wx_k(u) * py::pow(self.light, 0.5);
            u.set("ammo", u.atf("ammo") - 1.0);
        } else {
            let mut shooters = u.atf("men") * (if cls == "inf" { U::FRONT().get_or(&u.at("form"), 1.0).f() } else { 0.5 });
            if moving {
                shooters *= 0.5;
            }
            let mult = if cls == "inf" { arm_mult("inf", u) } else { 0.8 };
            let p0 = P_FUSIL * tkf * mult.sqrt();
            cas = shooters * p0 * pr * fat_k * mor_k * xp_k * self._wx_k(u) * (1.0 - cov) * VUL_FIRE().get_or(&tform, 1.0).f();
            cas *= py::pow(self.light, 0.5);
            if tg.at("cls") == "general" {
                cas *= 0.3;
            }
            if u.atb("light") && WOODS.contains(&(self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64)) {
                cas *= 1.15;
            }
            kind = "salve";
            u.set("ammo", u.atf("ammo") - 1.0);
            if volley {
                cas *= VOLLEY_POWER;
            }
        }
        // technologies de l'armée, comme en résolution automatique (engine.reg_power, phases) : toutes armes, l'arme ;
        // feu de rang et de peloton en ligne ; feu de peloton du carré sur les escadrons ; artillerie à cheval à mitraille
        let md = self.tech_of(u);
        cas *= ST::power_k(&md, cls.s());
        if cls == "artillerie" && WOODS.contains(&(self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64)) {
            cas *= CAMO_FIRE_K; // (les troncs gênent le tir des canons camouflés)
        }
        if cls == "inf" && u.at("form") == "ligne" {
            cas *= 1.0 + md.get_or("ligne_fire", 0.0).f();
        } else if cls == "inf" && u.at("form") == "carre" && tg.at("cls") == "cavalerie" {
            cas *= 1.0 + md.get_or("carre_fire", 0.0).f();
        } else if kind == "mitraille" {
            cas *= 1.0 + md.get_or("art_charge", 0.0).f();
        }
        cas *= self._smoke_k(u, &tg);
        if !self._smokeless(u) {
            let i = self._smoke_i(u.atf("x"), u.atf("y")) as usize;
            self.smoke[i] += if cls == "artillerie" {
                U::pieces(u) as f64 * SMOKE_PIECE
            } else {
                u.atf("men") * U::FRONT().get_or(&u.at("form"), 1.0).f() / 300.0 * SMOKE_SALVE
            };
            self._smoke_on = true;
        }
        u.set("ammo", pmax(0.0, u.atf("ammo")));
        u.set("reload", U::reload_time(u) * (if volley { VOLLEY_RELOAD } else { 1.0 }));
        u.set("fired_t", self.clock);
        if !moving {
            u.set("state", "feu");
        }
        u.set("fought", u.atf("fought") + u.atf("reload"));
        self._fatigue(u, u.atf("reload"), "feu", 1.0);
        cas *= self._entrench_k(&tg, u);
        self.emit(kind, u.atf("x"), u.atf("y"), &tg.at("x"), &tg.at("y"), &Val::from(cas), &u.at("id"));
        if kind == "canon" {
            let (cx, cy) = self._chute(u, tg.atf("x"), tg.atf("y"));
            self._bati_hit(cx, cy, u);
        }
        if kind == "canon" && u.at("side") == 0i64 && self.in_place(tg.atf("x"), tg.atf("y"), 0.0) {
            // les boulets tirés sur les défenseurs de la place frappent aussi son rempart
            let wt = self._wall_target(u, mx, &Val::None);
            if wt.truthy() {
                let (wi, x, y, d2) = wt.quad();
                self._pound(u, wi.i(), x.f(), y.f(), d2.f(), e, mx);
            }
        }
        if self._in_breach(&tg) {
            cas *= BRECHE_FEU; // (les feux croisés des flancs de la brèche)
        }
        self._damage(&tg, cas, u, kind);
        if u.atf("ammo") < 1.0 {
            self.log(&format!("{} n'a plus de munitions !", u.at("name")), &u.at("side"), &Val::None);
        }
    }

    /// Couvert de la cible sous le feu : l'obus à la mélinite de l'artillerie le perce à moitié.
    ///
    /// Python (battle.py, l. 2543-2548) : `def _fire_cover(self, tg, shooter)`
    pub fn _fire_cover(&self, tg: &Val, shooter: &Val) -> f64 {
        let mut cov = self._cover_vs(tg, shooter);
        if shooter.at("cls") == "artillerie" && shooter.at("type") != "mitrailleuses" {
            // (des obus : pas les mitrailleuses)
            cov *= 1.0 - self.ufx(shooter, "shell");
        }
        cov
    }

    /// Retranchements : l'infanterie arrêtée depuis ENTRENCH_T s'est enterrée et perd moins d'hommes au feu (moitié
    /// moins d'abri contre les obus à la mélinite).
    ///
    /// Python (battle.py, l. 2550-2560) : `def _entrench_k(self, tg, shooter)`
    pub fn _entrench_k(&self, tg: &Val, shooter: &Val) -> f64 {
        let mut k = self.ufx(tg, "entrench");
        if self.spec.get("logement").or(tup![]).has(&tg.at("id")) {
            k = pmax(k, LOGEMENT_K);
        }
        if k == 0.0 || tg.at("cls") != "inf" || self.clock - tg.atf("still_t") < ENTRENCH_T {
            return 1.0;
        }
        if shooter.at("cls") == "artillerie" && shooter.at("type") != "mitrailleuses" {
            k *= 1.0 - self.ufx(shooter, "shell");
        }
        1.0 - k
    }

    /// Couvert de la cible face à ce tireur : sa case, et un mur ou une barricade juste devant elle.
    ///
    /// Python (battle.py, l. 2562-2582) : `def _cover_vs(self, tg, shooter)`
    pub fn _cover_vs(&self, tg: &Val, shooter: &Val) -> f64 {
        let (tx, ty) = (tg.atf("x"), tg.atf("y"));
        let mut c = self.cover_at(tx, ty);
        if tg.at("cls") == "chariot" {
            return 0.0;
        }
        if tg.at("form") == "maisons" {
            let (occ, cm) = self._maisons(tg);
            c += occ * pmax(0.0, cm - c); // (ceux qui sont restés dans la rue n'en profitent pas)
        }
        if tg.atb("light") && WOODS.contains(&(self.map.t[Self::cell(tx, ty) as usize] as i64)) {
            c += 0.1;
        }
        let (dx, dy) = (shooter.atf("x") - tx, shooter.atf("y") - ty);
        let l = py::hypot(dx, dy);
        let l = if l != 0.0 { l } else { 1.0 };
        let cf = CELL as f64;
        let wallish = WALLISH();
        for k in [1i64, 2, 3] {
            let cc = Self::cell(tx + dx / l * cf * k as f64, ty + dy / l * cf * k as f64) as usize;
            let t = self.map.t[cc] as i64;
            if wallish.has(t) {
                c = pmax(c, wallish.atf(t));
                break;
            }
            if k == 1 && self.map.f[cc] != 0 {
                // derrière une haie, un muret, une clôture
                c = pmax(c, FCOVER[self.map.f[cc] as usize]);
            }
        }
        pmin(0.75, c)
    }

    /// Python (battle.py, l. 2584-2621) : `def _damage(self, tg, cas, src, kind)`
    /// Inflige cas pertes à tg (hommes, moral, anéantissement). src : l'unité qui les cause, ou None ; kind :
    /// 'salve', 'canon', 'mitraille', 'impact', 'melee' (il ne sert pas au calcul).
    pub fn _damage(&mut self, tg: &Val, cas: f64, src: &Val, kind: &str) {
        if cas <= 0.0 || !U::alive(tg) {
            return;
        }
        let cas = pmin(tg.atf("men"), cas);
        tg.set("men", tg.atf("men") - cas);
        tg.set("lost", tg.atf("lost") + cas);
        tg.set("hit_t", self.clock);
        tg.set("fought", tg.atf("fought") + 2.0);
        if src.is_some() {
            src.set("killed", src.atf("killed") + cas);
        }
        // moral : pertes (surtout brutales), feu de flanc ou de dos
        let mut shock = if cas > 0.03 * pmax(1.0, tg.atf("men") + cas) { 1.5 } else { 1.0 };
        if src.is_some() && okind(tg) != "retreat" {
            // (une troupe qui se retire en ordre tourne le dos à l'ennemi sans être surprise)
            let a = ang_diff(tg.atf("dir"), (src.atf("y") - tg.atf("y")).atan2(src.atf("x") - tg.atf("x")));
            if a > 2.3 {
                shock *= 1.8;
            } else if a > 1.2 && tg.at("form") != "carre" {
                shock *= 1.4;
            }
        }
        let steady = tk(tg, "steady");
        let mut k = 140.0 / steady;
        let tr = self.r#trait(tg.ati("side"));
        if tr == "inspirant" {
            k *= 0.85;
        } else if tr == "prudent" && tg.at("side") == 1i64 {
            k *= 0.9;
        }
        if self.general_near(tg, 400.0).truthy() {
            k *= 0.85;
        }
        tg.set("morale", pmax(0.0, tg.atf("morale") - cas / pmax(30.0, tg.atf("men0")) * k * shock));
        if tg.at("cls") == "general" && tg.atf("men") < 22.0 && !tg.atb("wounded") {
            tg.set("wounded", true);
            tg.set("state", "hors");
            let name = tg.at("gen").or(dict! {}).get_or("name", "");
            self.log(&format!("Le général {} est blessé et emporté loin du feu !", name), &Val::None, &Val::None);
        }
        if tg.atf("men") < 8.0 && tg.at("state") != "hors" {
            tg.set("state", "hors");
            tg.set("lost", tg.atf("lost") + pmax(0.0, tg.atf("men"))); // les derniers hommes sont dispersés : le régiment ne revient pas en campagne
            tg.set("men", 0.0);
            self.log(&format!("{} est anéanti.", tg.at("name")), &Val::None, &tg.at("side"));
        }
    }

    // ------------------------------------------------------------------ charges et mêlées
    /// Python (battle.py, l. 2624-2666) : `def _charge(self, u, dt)`
    pub fn _charge(&mut self, u: &Val, dt: f64) {
        let tg = self.by_id.get(&u.at("target"));
        if tg.is_none() || !U::alive(&tg) || tg.at("state") == "hors" {
            u.set("state", "repos");
            u.set("order", dict! {"kind" => "hold"});
            return;
        }
        let d = Self::dist(u, &tg);
        let cav = u.at("cls") == "cavalerie";
        let mut sp = if cav {
            if d > 250.0 {
                3.5
            } else {
                7.0
            }
        } else if d > 150.0 {
            1.4
        } else {
            2.5
        };
        sp *= 1.0 - 0.35 * u.atf("fat") / 100.0;
        let mc = move_class(u);
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let c0 = Self::cell(ux, uy) as usize;
        let cc = self.costs(mc, u.ati("side"))[c0].unwrap_or(2.0);
        sp /= cc;
        let step = pmin(d, sp * dt);
        let b = Self::bearing(u, &tg);
        let (nx, ny) = (ux + b.cos() * step, uy + b.sin() * step);
        if !self._passable_u(u, nx, ny) {
            // obstacle : on contourne par un chemin, puis on reprend la charge
            u.set("state", "marche");
            u.set("order", dict! {"kind" => "attack", "target" => tg.at("id")});
            u.set("charge_v", 0.0);
            self._go(u, tg.atf("x"), tg.atf("y"), &Val::from(b), false, false);
            return;
        }
        // élan (charge_v, en mètres de course utile) : il se gagne en courant ; le terrain difficile, les haies et la
        // montée le brisent, la descente l'augmente un peu
        let mut brake = (if cav { BRAKE_CAV() } else { BRAKE_INF() }).get_or(self.map.t[c0] as i64, 1.0).f();
        if self.map.f[c0] != 0 {
            brake *= if cav { 0.75 } else { 0.9 };
        }
        let grade = (self.map.h[Self::cell(nx, ny) as usize] as i64 - self.map.h[c0] as i64) as f64 / CELL as f64;
        let slope = if grade > 0.0 { pmax(0.3, 1.0 - 4.0 * grade) } else { pmin(1.2, 1.0 - 2.0 * grade) };
        let full = ELAN_M().atf(if cav { "cav" } else { "inf" });
        u.set("charge_v", pmin(full, u.atf("charge_v") * (0.5 + 0.5 * brake) + step * brake * slope));
        u.set("x", nx);
        u.set("y", ny);
        u.set("dir", b);
        u.set("still_t", self.clock); // (qui charge sort de ses retranchements)
        self._fatigue(u, dt, "run", 1.0);
        let (wt, dtg) = U::footprint(&tg);
        let (wu, _) = U::footprint(u);
        if Self::dist(u, &tg) <= 12.0 + (wt + wu) / 5.0 + dtg / 2.0 {
            self._impact(u, &tg);
        }
    }

    /// Le choc d'une charge : élan (course utile, terrain, pente), flanc ou dos, ordre de la cible. Une troupe en bon
    /// ordre, de face, reçoit la charge par un feu à bout portant et, si elle tient, la repousse ; prise de flanc, de
    /// dos, en désordre, en tirailleurs ou en pleine manœuvre, elle est culbutée.
    ///
    /// Python (battle.py, l. 2668-2791) : `def _impact(self, a, tg)`
    /// a : l'unité qui charge ; tg : sa cible.
    pub fn _impact(&mut self, a: &Val, tg: &Val) {
        let cav = a.at("cls") == "cavalerie";
        let ck = if cav { "cav" } else { "inf" };
        let ek = if cav { "cavalerie" } else { "inf" };
        let mut mom = ST::ELAN().atf(ek);
        if cav || a.at("form") == "colonne" {
            mom *= ST::charge_k(&self.tech_of(a), a.at("cls").s()); // cuirassiers ; ordre mixte (la colonne)
        }
        mom *= 1.0 - a.atf("fat") / (if cav { 120.0 } else { 150.0 }); // des chevaux essoufflés chargent mal
        let elan = pmin(1.0, pmax(0.0, a.atf("charge_v")) / ELAN_M().atf(ck));
        a.set("charge_v", 0.0);
        a.set("fat", pmin(100.0, a.atf("fat") + CHARGE_FAT().atf(ck)));
        mom *= 0.3 + 0.7 * elan;
        let tt = self.map.t[Self::cell(tg.atf("x"), tg.atf("y")) as usize] as i64;
        // bois, rochers, marais, maisons, murs : la charge s'y brise
        mom *= (if cav { BRAKE_CAV() } else { BRAKE_INF() }).get_or(tt, 1.0).f();
        let aside = a.ati("side");
        if cav && self.r#trait(aside) == "cavalier" {
            mom *= 1.2;
        }
        if self.r#trait(aside) == "audacieux" {
            mom *= 1.12;
        }
        let ang = ang_diff(tg.atf("dir"), (a.atf("y") - tg.atf("y")).atan2(a.atf("x") - tg.atf("x")));
        let flank = if ang > 2.3 {
            2.0
        } else if ang > 1.2 && tg.at("form") != "carre" {
            1.5
        } else {
            1.0
        };
        self.emit("impact", tg.atf("x"), tg.atf("y"), &Val::None, &Val::None, &a.at("men"), &a.at("id"));
        if tg.at("cls") == "chariot" {
            self._take_wagon(tg, a);
            a.set("state", "repos");
            return;
        }
        if tg.at("state") == "deroute" {
            // (des chevaux essoufflés, une charge sans élan ramassent moins de fuyards)
            let frac = CAPTURE().atf(if cav { "choc_cav" } else { "choc_inf" });
            self._capture(a, tg, frac * pmin(1.0, mom / ST::ELAN().atf(ek)));
            a.set("state", "repos");
            return;
        }
        if cav && tg.at("form") == "maisons" {
            // des cavaliers ne prennent pas des maisons : ils tournent bride sous le feu des fenêtres
            a.set("morale", pmax(0.0, a.atf("morale") - 5.0));
            self._repulse(a, tg, 120.0);
            self.log(&format!("La charge de {} vient mourir au pied des maisons que tient {}.", a.at("name"), tg.at("name")), &Val::None, &a.at("side"));
            return;
        }
        let barr = self._barr_front(tg, a);
        if barr {
            mom *= BARR_CHOC; // (charrettes, abattis : on s'y empêtre)
        }
        if cav && tg.at("form") == "carre" && tg.atf("busy") <= 0.0 {
            // le carré brise la charge
            let back = self._melee_k(tg, a) * tg.atf("men") * 0.04;
            self._damage(a, back, tg, "impact");
            a.set("morale", pmax(0.0, a.atf("morale") - 18.0));
            self._damage(tg, a.atf("men") * 0.01, a, "impact");
            self._repulse(a, tg, 120.0);
            self.log(&format!("La charge de {} se brise sur le carré de {} !", a.at("name"), tg.at("name")), &Val::None, &a.at("side"));
            return;
        }
        // feu de défense : de face, une troupe en ordre (ou une batterie chargée) tire à bout portant sur ceux qui
        // chargent
        let tcls = tg.at("cls");
        let ready = flank == 1.0
            && tg.atf("busy") <= 0.0
            && tg.atf("ammo") >= 1.0
            && !dans(&tg.at("state"), &["melee", "ralliement", "charge"])
            && ((tcls == "inf" && dans(&tg.at("form"), &["ligne", "colonne", "tirailleurs", "maisons"]))
                || (tcls == "artillerie" && tg.at("form") == "batterie"));
        if ready {
            let mut vol;
            let kind;
            if tg.at("type") == "mitrailleuses" {
                // la mitrailleuse : trois gerbes à bout portant, sans mitraille (si serrées qu'elles ne fauchent qu'une
                // file ou deux)
                vol = U::pieces(tg) as f64 * P_REFFYE * 1.2 * (0.6 + 0.4 * tg.atf("morale") / 100.0);
                kind = "salve";
            } else if tcls == "artillerie" {
                // deux décharges de mitraille à bout portant pendant que la charge arrive (la gerbe serrée : ×2,2) ;
                // aborder une batterie de face coûte très cher, la prendre de flanc ou de dos ne coûte rien
                vol = U::pieces(tg) as f64 * P_MITRAILLE * GRAPE_POINT * 1.4 * (0.6 + 0.4 * tg.atf("morale") / 100.0)
                    * (1.0 + self.tech_of(tg).get_or("art_charge", 0.0).f());
                kind = "mitraille";
            } else {
                vol = tg.atf("men") * U::FRONT().get_or(&tg.at("form"), 1.0).f() * P_RECEPTION * (0.5 + 0.5 * tg.atf("morale") / 100.0)
                    * ST::xp_k(tg.atf("xp"))
                    * self._wx_k(tg);
                kind = "salve";
            }
            vol *= ST::power_k(&self.tech_of(tg), tcls.s());
            vol *= (if tcls == "inf" { VUL_FIRE() } else { VUL_GRAPE() }).get_or(&a.at("form"), 1.0).f();
            tg.set("ammo", pmax(0.0, tg.atf("ammo") - 1.0));
            tg.set("reload", pmax(tg.atf("reload"), U::reload_time(tg)));
            tg.set("fired_t", self.clock);
            self.emit(kind, tg.atf("x"), tg.atf("y"), &a.at("x"), &a.at("y"), &Val::from(vol), &tg.at("id"));
            self._damage(a, vol, tg, kind);
            if !U::alive(a) {
                return;
            }
            if !cav && a.atf("morale") < FALTER as f64 {
                // la colonne hésite sous le feu et s'arrête court
                self._repulse(a, tg, 60.0);
                self.log(&format!("La charge de {} s'arrête sous le feu de {}.", a.at("name"), tg.at("name")), &Val::None, &a.at("side"));
                return;
            }
        }
        // une troupe en bon ordre, de face, encaisse le choc sans se rompre
        let formed = flank == 1.0
            && tg.atf("busy") <= 0.0
            && tg.atf("morale") >= FORMED as f64
            && tg.at("state") != "ralliement"
            && tcls == "inf"
            && dans(&tg.at("form"), &["ligne", "colonne", "maisons"]);
        let mut vul = 1.0;
        if cav {
            vul = match tg.at("form").to_string().as_str() {
                "ligne" => 1.2,
                "tirailleurs" => 1.6,
                "colonne" => 1.0,
                "attelee" => 1.7,
                "batterie" => 1.4,
                _ => 1.0,
            };
            if tcls == "cavalerie" {
                vul = 0.8; // escadrons contre escadrons : on se sabre moins qu'on ne se bouscule
            }
            if tg.atf("busy") > 0.0 && tg.at("next_form") == "carre" {
                vul = 1.9; // pris en pleine manœuvre
            }
        }
        if formed {
            vul *= 0.4;
        }
        let mut cas = a.atf("men") * CHOC * mom * flank * vul * tk(a, "melee") * (0.5 + a.atf("morale") / 200.0);
        cas *= ST::power_k(&self.tech_of(a), a.at("cls").s());
        self._damage(tg, cas, a, "impact");
        let shock = 6.0 * mom * flank * (if cav && dans(&tg.at("form"), &["ligne", "tirailleurs"]) { 1.3 } else { 1.0 });
        tg.set("morale", pmax(0.0, tg.atf("morale") - shock * (if formed { 0.5 } else { 1.0 })));
        if tg.atf("morale") < 25.0 && !barr {
            self._rout(tg);
            if cav {
                self._capture(a, tg, CAPTURE().atf("rupture_cav"));
            }
            a.set("state", "repos");
            return;
        }
        if barr && cav {
            // la barricade tient : les cavaliers ne passent pas
            a.set("morale", pmax(0.0, a.atf("morale") - 8.0));
            self._repulse(a, tg, 120.0);
            self.log(&format!("La charge de {} se brise sur la barricade de {}.", a.at("name"), tg.at("name")), &Val::None, &a.at("side"));
            return;
        }
        if formed && cav && tg.atf("morale") >= HOLD as f64 {
            // la ligne a tenu : les cavaliers tournent bride
            a.set("morale", pmax(0.0, a.atf("morale") - 8.0));
            self._repulse(a, tg, 120.0);
            self.log(&format!("{} repousse la charge de {}.", tg.at("name"), a.at("name")), &Val::None, &a.at("side"));
            return;
        }
        a.set("state", "melee");
        tg.set("state", "melee");
        a.set("melee_with", tg.at("id"));
        tg.set("melee_with", a.at("id"));
        a.set("path", list![]);
        tg.set("path", list![]);
    }

    /// Charge repoussée : la troupe se replie de dist mètres face à l'ennemi, puis attend les ordres.
    ///
    /// Python (battle.py, l. 2793-2800) : `def _repulse(self, a, tg, dist=120.0)`
    /// dist : défaut 120.0.
    pub fn _repulse(&mut self, a: &Val, tg: &Val, dist: f64) {
        a.set("state", "repos");
        a.set("order", dict! {"kind" => "hold"});
        a.set("charge_v", 0.0);
        let (ax, ay) = (a.atf("x"), a.atf("y"));
        let b = (ay - tg.atf("y")).atan2(ax - tg.atf("x"));
        let (gx, gy) = (pmin(pmax(ax + b.cos() * dist, 10.0), (W - 10) as f64), pmin(pmax(ay + b.sin() * dist, 10.0), (H - 10) as f64));
        self._go(a, gx, gy, &Val::from(b + PI), false, false);
    }

    /// Python (battle.py, l. 2802-2824) : `def _melee_k(self, u, foe)`
    /// Force de u au corps à corps contre foe, par homme.
    pub fn _melee_k(&mut self, u: &Val, foe: &Val) -> f64 {
        let mut k = tk(u, "melee");
        k *= (0.5 + u.atf("morale") / 200.0) * ST::xp_k(u.atf("xp")) * (1.0 - u.atf("fat") / 250.0) * ST::power_k(&self.tech_of(u), u.at("cls").s());
        if u.at("form") == "carre" && foe.at("cls") == "cavalerie" {
            k *= 2.5;
        } else if u.at("form") == "tirailleurs" {
            k *= 0.7;
        }
        let tt = self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64;
        if u.at("form") == "maisons" {
            k *= 1.0 + (MAISON_MELEE - 1.0) * self._maisons(u).0; // (aux fenêtres, aux portes)
        } else if [T_MUR, T_PORTE, T_BARRICADE].contains(&tt) && u.at("side") == 0i64 {
            k *= 0.6; // l'assaillant à cheval sur l'obstacle (à l'échelle, sur la barricade) se bat mal
        } else if tt == T_BATI {
            k *= 1.4;
        } else if tt != T_BRECHE && self._cover_vs(u, foe) >= 0.5 {
            k *= 1.5; // derrière un mur, une barricade, une haie épaisse
        }
        if foe.at("cls") == "cavalerie" && [T_BOIS, T_FORET_T, T_MARAIS_T, T_VIGNE_T].contains(&tt) {
            k *= 1.4;
        }
        if self._in_breach(u) {
            k *= BRECHE_MELEE;
        }
        if self.r#trait(u.ati("side")) == "audacieux" {
            k *= 1.08;
        }
        k
    }

    /// L'assaillant sur une brèche ou à une case de ses bords (BRECHE_*).
    ///
    /// Python (battle.py, l. 2826-2833) : `def _in_breach(self, u)`
    pub fn _in_breach(&self, u: &Val) -> bool {
        if u.at("side") != 0i64 || !self.map.place.truthy() {
            return false;
        }
        let cf = CELL as f64;
        let (i, j) = (py::int(py::floordiv_f(u.atf("x"), cf)), py::int(py::floordiv_f(u.atf("y"), cf)));
        let t = &self.map.t;
        (0i64.max(j - 1)..ROWS.min(j + 2)).any(|jj| (0i64.max(i - 1)..COLS.min(i + 2)).any(|ii| t[(jj * COLS + ii) as usize] as i64 == T_BRECHE))
    }

    /// Hommes engagés en mêlée : pas plus de BRECHE_FRONT de front dans une brèche.
    ///
    /// Python (battle.py, l. 2835-2837) : `def _melee_men(self, u)`
    pub fn _melee_men(&self, u: &Val) -> f64 {
        if self._in_breach(u) {
            pmin(u.atf("men"), BRECHE_FRONT)
        } else {
            u.atf("men")
        }
    }

    /// Python (battle.py, l. 2839-2847) : `def _end_melee(self, u)`
    pub fn _end_melee(&mut self, u: &Val) {
        let f = self.by_id.get(&u.at("melee_with"));
        u.set("melee_with", Val::None);
        if u.at("state") == "melee" {
            u.set("state", "repos");
        }
        if f.is_some() && f.at("melee_with") == u.at("id") {
            f.set("melee_with", Val::None);
            if f.at("state") == "melee" {
                f.set("state", "repos");
            }
        }
    }

    /// Python (battle.py, l. 2849-2929) : `def _contacts(self, alive, dt)`
    /// alive : liste des unités en vie au début du pas. `press` et surtout `bins` (clés : tuples (int, int)) se
    /// parcourent dans l'ordre d'insertion : un dict `Val` ou un IndexMap, jamais un HashMap.
    pub fn _contacts(&mut self, alive: &Val, dt: f64) {
        // mêlées en cours ; plusieurs troupes peuvent s'acharner sur une même : leurs forces s'additionnent
        let mut fights: Vec<(Val, Val, f64)> = Vec::new();
        let press = Val::dict();
        for u in alive.iter() {
            if u.at("state") != "melee" {
                continue;
            }
            let f = self.by_id.get(&u.at("melee_with"));
            if f.is_none() || !U::alive(&f) || f.at("state") != "melee" {
                self._end_melee(&u); // (l'adversaire a fui, cédé du terrain ou s'est dégagé)
                continue;
            }
            let ku = self._melee_k(&u, &f) * self._melee_men(&u);
            let fid = f.at("id");
            press.set(&fid, press.get_or(&fid, 0.0).f() + ku);
            fights.push((u, f, ku));
        }
        for (u, f, ku) in fights {
            if u.at("state") != "melee" || f.at("state") != "melee" {
                continue;
            }
            let kf = self._melee_k(&f, &u) * self._melee_men(&f);
            let tot = press.get_or(&f.at("id"), ku).f();
            self._damage(&f, MELEE_K * ku * dt, &u, "melee");
            // la mêlée se décide surtout au moral : le plus faible plie le premier ; à plusieurs contre un, la pression
            // s'additionne, sauf dans une brèche, une rue, des maisons, derrière un mur, où l'on ne se bat pas à plus de
            // front que le passage (elle ne dépasse alors pas MELEE_MOR par seconde)
            let (fx, fy) = (f.atf("x"), f.atf("y"));
            let narrow = NARROW.contains(&(self.map.t[Self::cell(fx, fy) as usize] as i64))
                || NARROW.contains(&(self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64))
                || self.cover_at(fx, fy) >= 0.5;
            let share = if narrow { (ku / pmax(1.0, tot)) * tot / pmax(1.0, tot + kf) } else { ku / pmax(1.0, ku + kf) };
            f.set("morale", pmax(0.0, f.atf("morale") - MELEE_MOR * dt * share));
            u.set("fought", u.atf("fought") + dt);
            // (on ne se replie pas en ordre devant des cavaliers qui sont dans les rangs : fantassins hors du carré et
            // canonniers se débandent)
            let ridden = u.at("cls") == "cavalerie" && f.at("form") != "carre" && dans(&f.at("cls"), &["inf", "artillerie"]);
            let fm = f.atf("morale");
            if (fm < 25.0 || (ridden && fm < GIVE_WAY as f64)) && f.at("state") != "deroute" {
                self._rout(&f);
                if u.at("cls") == "cavalerie" {
                    self._capture(&u, &f, CAPTURE().atf("melee_cav"));
                }
                self._end_melee(&u);
            } else if fm < GIVE_WAY as f64 && f.at("state") == "melee" && kf < tot {
                // le plus faible cède du terrain sans se débander : il se replie et se reforme
                self._end_melee(&f);
                self._repulse(&f, &u, 100.0);
                self.log(&format!("{} cède du terrain devant {}.", f.at("name"), u.at("name")), &Val::None, &f.at("side"));
            }
        }
        // déroutés rattrapés, et troupes qui se heurtent (baïonnette) : seulement les voisines (cases de 40 m)
        let mut bins: IndexMap<(i64, i64), Vec<Val>> = IndexMap::new();
        for u in alive.iter() {
            if u.at("state") != "hors" {
                let k = (py::int(py::floordiv_f(u.atf("x"), 40.0)), py::int(py::floordiv_f(u.atf("y"), 40.0)));
                bins.entry(k).or_default().push(u);
            }
        }
        let mut pairs: Vec<(Val, Val)> = Vec::new();
        for (&(bx, by), lst) in &bins {
            for (k, a) in lst.iter().enumerate() {
                for b in &lst[k + 1..] {
                    pairs.push((a.clone(), b.clone()));
                }
            }
            for nb in [(bx + 1, by), (bx - 1, by + 1), (bx, by + 1), (bx + 1, by + 1)] {
                if let Some(o) = bins.get(&nb) {
                    for a in lst {
                        for b in o {
                            pairs.push((a.clone(), b.clone()));
                        }
                    }
                }
            }
        }
        for (a, b) in pairs {
            if !U::alive(&a) || !U::alive(&b) {
                continue;
            }
            let (dx, dy) = (b.atf("x") - a.atf("x"), b.atf("y") - a.atf("y"));
            let d2 = dx * dx + dy * dy;
            if d2 > 900.0 {
                continue;
            }
            if a.at("side") == b.at("side") {
                if d2 < 400.0 && a.at("state") != "melee" && b.at("state") != "melee" {
                    let d = d2.sqrt();
                    let d = if d != 0.0 { d } else { 1.0 };
                    let push = (20.0 - d) / 2.0;
                    for (u, s) in [(&a, -1.0), (&b, 1.0)] {
                        let (nx, ny) = (u.atf("x") + s * dx / d * push, u.atf("y") + s * dy / d * push);
                        if 0.0 <= nx && nx < W as f64 && 0.0 <= ny && ny < H as f64 && self._passable_u(u, nx, ny) {
                            u.set("x", nx);
                            u.set("y", ny);
                            u.set("still_t", self.clock);
                        }
                    }
                }
                continue;
            }
            for (x, y) in [(&a, &b), (&b, &a)] {
                if y.at("state") == "deroute" && U::valid(x) && x.at("state") != "melee" {
                    let frac = CAPTURE().atf(if x.at("cls") == "cavalerie" { "contact_cav" } else { "contact_inf" });
                    self._capture(x, y, frac);
                }
            }
            if U::valid(&a)
                && U::valid(&b)
                && !dans(&a.at("state"), &["melee", "charge"])
                && !dans(&b.at("state"), &["melee", "charge"])
                && !dans(&a.at("cls"), &["general", "chariot"])
                && !dans(&b.at("cls"), &["general", "chariot"])
                && d2 < 400.0
            {
                a.set("state", "melee");
                b.set("state", "melee");
                a.set("melee_with", b.at("id"));
                b.set("melee_with", a.at("id"));
                a.set("path", list![]);
                b.set("path", list![]);
            }
        }
    }

    /// Chariots de munitions : recomplètent les régiments proches, se font prendre s'ils restent sans escorte.
    ///
    /// Python (battle.py, l. 2931-2963) : `def _wagons(self, dt)`
    pub fn _wagons(&mut self, dt: f64) {
        for w in self.units.iter() {
            if w.at("cls") != "chariot" || !U::alive(&w) {
                continue;
            }
            let (mut foe, mut friend) = (Val::None, false);
            let (wx, wy) = (w.atf("x"), w.atf("y"));
            for o in self.units.iter() {
                if !U::valid(&o) {
                    continue;
                }
                let d2 = py::pow(o.atf("x") - wx, 2.0) + py::pow(o.atf("y") - wy, 2.0);
                if o.at("side") != w.at("side") && d2 < (40 * 40) as f64 {
                    foe = o;
                } else if o.at("side") == w.at("side") && d2 < (80 * 80) as f64 {
                    friend = true;
                }
            }
            if foe.is_some() && !friend {
                self._take_wagon(&w, &foe);
                continue;
            }
            if w.atf("ammo") <= 0.0 || w.atb("path") {
                continue;
            }
            let side = w.at("side");
            let tot = py::sum(
                self.units
                    .iter()
                    .filter(|u| u.at("side") == side && dans(&u.at("cls"), &["inf", "artillerie", "cavalerie"]))
                    .map(|u| u.atf("men0")),
            );
            let tot = if tot != 0.0 { tot } else { 1.0 };
            let r2 = py::pow(U::WAGON_RANGE, 2.0);
            for u in self.units.iter() {
                if u.at("side") != w.at("side")
                    || !U::alive(&u)
                    || dans(&u.at("cls"), &["general", "chariot"])
                    || u.atf("ammo") >= u.atf("ammo0")
                    || dans(&u.at("state"), &["deroute", "melee"])
                {
                    continue;
                }
                if py::pow(u.atf("x") - wx, 2.0) + py::pow(u.atf("y") - wy, 2.0) > r2 {
                    continue;
                }
                let ammo0 = u.atf("ammo0");
                let add = pmin(ammo0 - u.atf("ammo"), ammo0 * U::WAGON_RATE / 60.0 * dt);
                u.set("ammo", u.atf("ammo") + add);
                w.set("ammo", pmax(0.0, w.atf("ammo") - add / ammo0 * u.atf("men0") / tot * U::WAGON_LOAD));
                if w.atf("ammo") <= 0.0 {
                    self.log(&format!("{} est vide.", w.at("name")), &w.at("side"), &Val::None);
                    break;
                }
            }
        }
    }

    /// Python (battle.py, l. 2965-2973) : `def _take_wagon(self, w, by)`
    /// w : le chariot ; by : l'unité qui le prend.
    pub fn _take_wagon(&mut self, w: &Val, by: &Val) {
        let old = w.at("side");
        for k in ["side", "owner", "ctrl", "army", "group", "gname"] {
            w.set(k, by.at(k));
        }
        w.set("path", list![]);
        w.set("goal", Val::None);
        w.set("order", Val::None);
        w.set("target", Val::None);
        w.set("state", "repos");
        self.emit("impact", w.atf("x"), w.atf("y"), &Val::None, &Val::None, &Val::None, &by.at("id"));
        self.log(&format!("{} s'empare d'un chariot de munitions ennemi !", by.at("name")), &by.at("side"), &Val::None);
        self.log("Un de nos chariots de munitions est tombé aux mains de l'ennemi !", &old, &Val::None);
    }

    /// Des hommes en déroute rattrapés par l'ennemi sont faits prisonniers.
    ///
    /// Python (battle.py, l. 2975-2988) : `def _capture(self, x, y, frac)`
    /// x : l'unité qui capture ; y : l'unité en déroute ; frac : part des fuyards rattrapés.
    pub fn _capture(&mut self, x: &Val, y: &Val, frac: f64) {
        let men = y.atf("men");
        if men <= 0.0 {
            return;
        }
        let k = if men > 25.0 { men * frac } else { men };
        y.set("men", men - k);
        y.set("captured", y.atf("captured") + k);
        let side = y.ati("side");
        self.prisoners.inc(side, k);
        if y.atf("men") < 8.0 {
            y.set("state", "hors");
            y.set("captured", y.atf("captured") + y.atf("men")); // les derniers aussi : le régiment ne revient pas en campagne
            self.prisoners.inc(side, y.at("men"));
            y.set("men", 0.0);
            self.log(&format!("{} est capturé.", y.at("name")), &Val::None, &y.at("side"));
        }
    }
}
