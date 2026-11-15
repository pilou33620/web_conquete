//! Porte game/tactics/battle.py, lignes 1099 à 1702 : déploiement ; ordres ; boucle.
//! Conventions : l'en-tête de battle/mod.rs. Les petites aides `pmax`, `pmin`, `dans`, `okind`, `tk` (ce que le
//! Python écrit en ligne : `max(a, b)`, `x in (…)`, `u.order and u.order.get('kind')`, `U.TYPE.get(…)[k]`) servent
//! aussi à unite.rs et combat.rs.

use super::*;

/// `max(a, b)` de Python : a, sauf si b est plus grand (le premier gagne).
pub(super) fn pmax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// `min(a, b)` de Python : a, sauf si b est plus petit.
pub(super) fn pmin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
/// `v in ('a', 'b', …)` pour des textes.
pub(super) fn dans(v: &Val, l: &[&str]) -> bool {
    l.iter().any(|s| v == s)
}
/// `u.order.get('kind') if u.order else None`.
pub(super) fn okind(u: &Val) -> Val {
    let o = u.at("order");
    if o.truthy() {
        o.get("kind")
    } else {
        Val::None
    }
}
/// `U.TYPE.get(u.type, U.TYPE['ligne'])[k]`.
pub(super) fn tk(u: &Val, k: &str) -> f64 {
    let t = U::TYPE();
    t.get_or(&u.at("type"), t.at("ligne")).atf(k)
}
/// `(float(p['x']), float(p['y']))` sous `try / except (KeyError, TypeError, ValueError)` : None si l'un échoue.
/// shortcut: un texte est lu par `str::parse` (Python lit aussi « 1_000 »), sans conséquence pour un client honnête.
fn float_xy(p: &Val) -> Option<(f64, f64)> {
    let f = |k: &str| -> Option<f64> {
        if !p.has(k) {
            return None;
        }
        match p.at(k) {
            Val::Str(s) => s.trim().parse().ok(),
            v => v.num().map(|n| n.f()),
        }
    };
    Some((f("x")?, f("y")?))
}

impl TacticalBattle {
    // ================================================================== déploiement
    /// Python (battle.py, l. 1100-1136) : `def deploy(self, side, ids, x, y, dir=None, form=None, who='ia')`
    /// ids : liste d'ids (les inconnus sont ignorés) ; dir : angle (rad) ou None (défaut : front_dir(side)) ;
    /// form : formation (texte) ou None (défaut ; une valeur inconnue est ignorée) ; who : 'ia' (défaut),
    /// 'joueur' ou 'any'.
    pub fn deploy(&mut self, side: i64, ids: &Val, x: f64, y: f64, dir: &Val, form: &Val, who: &str) -> (bool, String) {
        if self.phase != "deploiement" {
            return (false, "Le déploiement est terminé.".to_string());
        }
        let us: Vec<Val> = ids
            .iter()
            .map(|i| self.by_id.get(&i))
            .filter(|u| u.is_some() && u.at("side") == side && U::alive(u) && (who == "any" || u.at("ctrl") == who))
            .collect();
        if us.is_empty() {
            return (false, "Aucune unité à placer.".to_string());
        }
        let z = self.zones.at(side);
        let dir = if dir.is_none() { Val::from(self.front_dir(side)) } else { dir.clone() };
        let (z0, z1, z2, z3) = (z.atf(0), z.atf(1), z.atf(2), z.atf(3));
        let x = pmin(pmax(x, z0 + 10.0), z2 - 10.0);
        let y = pmin(pmax(y, z1 + 10.0), z3 - 10.0);
        // côte à côte, perpendiculairement au front
        let (px, py) = (-dir.f().sin(), dir.f().cos());
        let mut widths = Vec::new();
        for u in &us {
            if u.at("src") == "rempart" {
                u.set("form", "batterie"); // canons du rempart : toujours en batterie
            } else if form.truthy() && U::FORMS().get(&u.at("cls")).or(tup![]).has(form) && *form != "batterie" {
                u.set("form", form);
            } else if *form == "batterie" && u.at("cls") == "artillerie" {
                u.set("form", "batterie");
            }
            widths.push(U::footprint(u).0 + 12.0);
        }
        let tot = py::sum(widths.iter().copied());
        let mut off = -tot / 2.0;
        for (u, w) in us.iter().zip(widths.iter()) {
            let ox = off + w / 2.0;
            off += w;
            let ux = pmin(pmax(x + px * ox, z0 + 5.0), z2 - 5.0);
            let uy = pmin(pmax(y + py * ox, z1 + 5.0), z3 - 5.0);
            let (ux, uy) = self.nearest_passable(u, side, ux, uy, 12, false);
            u.set("x", ux);
            u.set("y", uy);
            u.set("dir", &dir);
            if side == 1 && u.at("cls") == "artillerie" {
                self._to_rampart(u);
            }
            u.set("path", list![]);
            u.set("goal", Val::None);
            u.set("order", Val::None);
            u.set("state", "repos");
        }
        let n = us.len();
        (true, format!("{} unité{} en place.", n, if n > 1 { "s" } else { "" }))
    }

    /// Canon du défenseur sur l'enceinte (ou canons du rempart de la place) : il tire, il ne bouge pas.
    ///
    /// Python (battle.py, l. 1138-1140) : `def on_rampart(self, u)`
    pub fn on_rampart(&self, u: &Val) -> bool {
        u.at("src") == "rempart"
            || (u.at("side") == 1i64
                && u.at("cls") == "artillerie"
                && self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64 == T_MUR)
    }

    /// Siège ou assaut d'une place à enceinte : la batterie du défenseur va sur la case de mur la plus proche,
    /// à REMPART_GAP au moins des autres, tournée vers le dehors. Rien hors d'une place à enceinte.
    ///
    /// Python (battle.py, l. 1142-1163) : `def _to_rampart(self, u)`
    /// `o is not u` → `!o.is(u)`.
    pub fn _to_rampart(&mut self, u: &Val) {
        let pl = self.map.place.clone();
        let t = &self.map.t;
        if !(pl.truthy() && pl.get("battle").truthy()) || t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64 == T_MUR {
            return;
        }
        let others: Vec<(f64, f64)> = self
            .units
            .iter()
            .filter(|o| {
                !o.is(u) && o.at("side") == 1i64 && o.at("cls") == "artillerie" && t[Self::cell(o.atf("x"), o.atf("y")) as usize] as i64 == T_MUR
            })
            .map(|o| (o.atf("x"), o.atf("y")))
            .collect();
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let mut best: Option<(f64, f64, f64)> = None;
        for c in 0..N as usize {
            if t[c] as i64 != T_MUR {
                continue;
            }
            let (cx, cy) = TR::center_of(c);
            let mut d = py::pow(cx - ux, 2.0) + py::pow(cy - uy, 2.0);
            if others.iter().any(|&(ox, oy)| py::pow(cx - ox, 2.0) + py::pow(cy - oy, 2.0) < py::pow(REMPART_GAP, 2.0)) {
                d += 1e12; // (la place est prise : seulement s'il n'en reste aucune autre)
            }
            if best.is_none() || d < best.unwrap().0 {
                best = Some((d, cx, cy));
            }
        }
        if let Some((_, bx, by)) = best {
            u.set("x", bx);
            u.set("y", by);
            u.set("dir", (by - pl.atf("y")).atan2(bx - pl.atf("x")));
            u.set("form", "batterie");
        }
    }

    /// Python (battle.py, l. 1165-1175) : `def start(self)`
    pub fn start(&mut self) -> (bool, String) {
        if self.phase != "deploiement" {
            return (false, "La bataille est déjà engagée.".to_string());
        }
        for u in self.units.iter() {
            if u.at("side") == 1i64 && u.at("cls") == "artillerie" && U::alive(&u) {
                self._to_rampart(&u); // (aussi celles que personne n'a déployées)
            }
        }
        self.phase = "combat".to_string();
        self.warm();
        self._update_vision();
        self.log("La bataille commence.", &Val::None, &Val::None);
        (true, "La bataille commence !".to_string())
    }

    // ================================================================== ordres
    /// Ordre à des unités du camp side (voir l'aide-mémoire en tête du fichier). Renvoie (ok, msg).
    ///
    /// Python (battle.py, l. 1178-1480) : `def order(self, side, ids, kind, who='ia', **p)`
    /// ids : liste d'ids, ou un seul id (texte), ou None ; kind : l'ordre (une valeur inconnue : « Ordre inconnu. » ;
    /// l'appelant qui reçoit du client autre chose qu'un texte passe "") ; who : 'ia' (défaut), 'joueur' ou 'any' ;
    /// p : les `**p`, un dict (vide s'il n'y en a pas) : x, y, dir, run ('move') ; target ('attack', 'charge',
    /// 'volley_charge') ; mode, fire, value, v ('fire', 'stop', 'shot', 'counter') ; form ('form') ; x, y
    /// ('maisons' : facultatifs ; 'bombard'). Les valeurs viennent du client : `float(p['x'])` → `py::float_v`
    /// (KeyError si absent, pour 'move') ; pour 'maisons' et 'bombard', le try / except se porte par un test.
    /// 'hold' range LE MÊME dict `rec` dans `u.order` de toutes les unités de l'ordre. 'pursue' rappelle
    /// `self.order(side, [u.id], 'charge', who, {target})`.
    pub fn order(&mut self, side: i64, ids: &Val, kind: &str, who: &str, p: &Val) -> (bool, String) {
        let ko = |m: &str| (false, m.to_string());
        let ok = |m: &str| (true, m.to_string());
        if self.phase == "fin" {
            return ko("La bataille est terminée.");
        }
        if self.accel && who == "joueur" {
            return ko(ACCEL_BUSY);
        }
        let ids = if ids.is_str() { list![ids] } else { ids.or(list![]) };
        let mut us: Vec<Val> = ids
            .iter()
            .map(|i| self.by_id.get(&i))
            .filter(|u| u.is_some() && u.at("side") == side && U::alive(u) && (who == "any" || u.at("ctrl") == who))
            .collect();
        if us.is_empty() {
            return ko("Aucune unité à commander.");
        }
        if !["fire", "hold", "rally", "shot", "counter", "stop"].contains(&kind) && us.iter().any(|u| self.on_rampart(u)) {
            us.retain(|u| !self.on_rampart(u)); // les canons du rempart ne bougent pas
            if us.is_empty() {
                return ko("Les canons du rempart sont fixés sur la muraille : ils tirent, mais ne bougent pas.");
            }
        }
        if self.phase == "deploiement" && !["form", "fire", "shot", "counter", "stop"].contains(&kind) {
            return ko("Déployez d'abord vos troupes, puis lancez la bataille.");
        }
        if kind == "rally" || kind == "retreat" {
        } else {
            let us2: Vec<Val> = us.iter().filter(|u| u.at("state") != "deroute").cloned().collect();
            if us2.is_empty() {
                return ko("Ces troupes sont en déroute : il faut d'abord les rallier.");
            }
            us = us2;
        }
        let rec = dict! {"kind" => kind};
        if kind == "move" {
            let (x, y) = (py::float_v(&p.at("x")), py::float_v(&p.at("y")));
            if !(x.is_finite() && y.is_finite()) {
                return ko("Destination invalide.");
            }
            let (x, y) = (pmin(pmax(x, 5.0), (W - 5) as f64), pmin(pmax(y, 5.0), (H - 5) as f64));
            let d = p.get("dir");
            let run = p.get("run").truthy();
            let n = us.len() as f64;
            let cx = py::sum(us.iter().map(|u| u.atf("x"))) / n;
            let cy = py::sum(us.iter().map(|u| u.atf("y"))) / n;
            let mut rot = 0.0;
            if d.is_some() && us.len() > 1 {
                let cur = py::sum(us.iter().map(|u| u.atf("dir").sin())).atan2(py::sum(us.iter().map(|u| u.atf("dir").cos())));
                rot = py::float_v(&d) - cur;
            }
            let (cr, sr) = (rot.cos(), rot.sin());
            for u in &us {
                let (ox, oy) = if us.len() > 1 { (u.atf("x") - cx, u.atf("y") - cy) } else { (0.0, 0.0) };
                let (ox, oy) = (ox * cr - oy * sr, ox * sr + oy * cr);
                let (gx, gy) = (pmin(pmax(x + ox, 5.0), (W - 5) as f64), pmin(pmax(y + oy, 5.0), (H - 5) as f64));
                let dd = if d.is_none() { Val::None } else { Val::from(py::float_v(&d)) };
                self._go(u, gx, gy, &dd, run, false);
                let o = rec.copy();
                o.update(&dict! {"x" => py::round(gx), "y" => py::round(gy), "dir" => &d, "run" => run});
                u.set("order", o);
                u.set("target", Val::None);
            }
            return ok("En marche.");
        }
        if kind == "attack" || kind == "charge" {
            let tg = self.by_id.get(&p.get("target"));
            if tg.is_none() || tg.at("side") == side || !U::alive(&tg) || !self.seen_by.at(side).has(&tg.at("id")) {
                return ko("Cible invisible ou introuvable.");
            }
            if kind == "charge" && tg.at("form") == "maisons" && us.iter().all(|u| u.at("cls") == "cavalerie") {
                return ko("Des cavaliers ne chargent pas des maisons : l'ennemi s'y est retranché.");
            }
            let tid = tg.at("id");
            for u in &us {
                if kind == "charge"
                    && (dans(&u.at("cls"), &["artillerie", "general", "chariot"]) || (u.at("cls") == "cavalerie" && tg.at("form") == "maisons"))
                {
                    continue;
                }
                if u.at("state") == "melee" {
                    if u.at("melee_with") == tid {
                        // déjà au corps à corps avec cette cible : la mêlée continue, sans nouveau choc
                        u.set("target", &tid);
                        u.set("order", dict! {"kind" => kind, "target" => &tid});
                        continue;
                    }
                    self._end_melee(u); // on se dégage pour aller ailleurs (sans élan : il faudra le reprendre)
                }
                if kind == "charge" && u.at("state") == "charge" && u.at("target") == tid {
                    continue; // la charge est déjà lancée sur cette cible : elle garde son élan
                }
                if kind == "charge" && dans(&u.at("form"), &["carre", "maisons"]) {
                    u.set("form", "colonne");
                }
                u.set("target", &tid);
                u.set("order", dict! {"kind" => kind, "target" => &tid});
                if kind == "attack" && who == "joueur" && u.at("cls") != "cavalerie" {
                    // (le joueur : arrêt selon le profil, puis on tient ; l'IA et la cavalerie gardent leur suivi)
                    u.at("order").set("stop", u.at("stop"));
                }
                if kind == "charge" {
                    u.set("state", "charge");
                    u.set("charge_v", 0.0);
                    u.set("path", list![]);
                    self.emit("charge", u.atf("x"), u.atf("y"), &tg.at("x"), &tg.at("y"), &Val::None, &u.at("id"));
                } else {
                    self._approach(u, &tg);
                }
            }
            return ok(if kind == "attack" { "À l'attaque !" } else { "Chargez !" });
        }
        if kind == "hold" {
            for u in &us {
                u.set("path", list![]);
                u.set("goal", Val::None);
                u.set("order", &rec);
                if dans(&u.at("state"), &["marche", "charge"]) {
                    u.set("state", "repos");
                }
                if u.at("fire_mode") == "hold" {
                    u.set("fire_mode", "free");
                }
            }
            return ok("Tenez la position.");
        }
        if kind == "fire" {
            let mode = p.get("mode").or_else(|| p.get("fire")).or_else(|| p.get("value")).or_else(|| p.get("v")).or("free");
            let mode = if mode == "hold" || mode == "cesser" || mode == false || mode == 0i64 {
                "hold"
            } else if mode == "volley" {
                "volley"
            } else {
                "free"
            };
            for u in &us {
                // (le feu de salve est affaire d'infanterie ; ailleurs, c'est le feu à volonté)
                u.set("fire_mode", if mode == "volley" && u.at("cls") != "inf" { "free" } else { mode });
            }
            if mode == "volley" {
                return ok("Feu de salve : à mon commandement, à bonne portée.");
            }
            return ok(if mode == "free" { "Feu à volonté !" } else { "Cessez le feu." });
        }
        if kind == "stop" {
            // profil d'arrêt de l'ordre « attaquer » (units.stop_dist) : il vaut pour les prochains ordres d'attaque
            let mode = p.get("mode").or_else(|| p.get("value")).or_else(|| p.get("v"));
            if !U::STOPS().has(&mode) {
                return ko("Profil d'arrêt inconnu.");
            }
            for u in &us {
                u.set("stop", &mode);
            }
            return ok(match mode.s() {
                "max" => "À l'attaque, on s'arrêtera à portée maximale.",
                "bonne" => "À l'attaque, on s'arrêtera à bonne portée.",
                _ => "À l'attaque, on s'avancera jusqu'au bout portant.",
            });
        }
        if kind == "volley_charge" {
            // « salve puis baïonnette » : l'infanterie s'approche, lâche une volée à bout portant, puis charge
            let tg = self.by_id.get(&p.get("target"));
            if tg.is_none() || tg.at("side") == side || !U::alive(&tg) || !self.seen_by.at(side).has(&tg.at("id")) {
                return ko("Cible invisible ou introuvable.");
            }
            let mut n = 0;
            for u in &us {
                if u.at("cls") != "inf" || u.atb("light") || u.at("type") == "sapeurs" {
                    continue;
                }
                if u.at("state") == "melee" {
                    self._end_melee(u);
                }
                if dans(&u.at("form"), &["carre", "tirailleurs"]) {
                    self._change_form(u, "ligne");
                }
                u.set("target", tg.at("id"));
                u.set("fire_mode", "volley");
                u.set("order", dict! {"kind" => "volley_charge", "target" => tg.at("id"), "t0" => self.clock, "f0" => u.at("fired_t")});
                self._approach_to(u, &tg, U::ranges(u).0 as f64 * VOLLEY_CHARGE_AT);
                n += 1;
            }
            if n == 0 {
                return ko("Seule l'infanterie de ligne et les grenadiers donnent la salve et la baïonnette.");
            }
            return ok("Salve, puis à la baïonnette !");
        }
        if kind == "harass" {
            // voltigeurs, chasseurs : ils tiraillent à portée efficace et reculent devant l'ennemi qui approche
            let mut n = 0;
            for u in &us {
                if u.at("cls") != "inf" {
                    continue;
                }
                if u.at("state") == "melee" {
                    self._end_melee(u);
                }
                u.set("target", Val::None);
                u.set("fire_mode", "free");
                u.set("order", dict! {"kind" => "harass", "next" => 0.0});
                if u.at("form") != "tirailleurs" {
                    self._change_form(u, "tirailleurs");
                }
                n += 1;
            }
            if n == 0 {
                return ko("Seule l'infanterie harcèle.");
            }
            return ok("Harcelez l'ennemi : feu et repli.");
        }
        if kind == "cover" {
            let mut n = 0;
            for u in &us {
                if u.at("cls") != "inf" {
                    continue;
                }
                let foe = self.nearest_foe(u);
                let (sx, sy) = self.best_spot(u.atf("x"), u.atf("y"), COVER_RADIUS, "cover", side, &Val::None, move_class(u));
                let face = if foe.is_some() { Val::from(Self::bearing(u, &foe)) } else { u.at("dir") };
                self._go(u, sx, sy, &face, false, false);
                u.set("order", dict! {"kind" => "move", "x" => py::round(sx), "y" => py::round(sy), "dir" => &face, "run" => false});
                u.set("target", Val::None);
                n += 1;
            }
            if n == 0 {
                return ko("Seule l'infanterie se met à couvert.");
            }
            return ok("Au couvert !");
        }
        if kind == "maisons" {
            // « Occuper les maisons » : l'infanterie va au bâti le plus proche du point (par défaut, le sien) et y entre
            let pt: Option<(f64, f64)> =
                if p.has("x") { Some(float_xy(p).unwrap_or((f64::NAN, f64::NAN))) } else { None };
            if let Some((a, b)) = pt {
                if !(a.is_finite() && b.is_finite()) {
                    return ko("Destination invalide.");
                }
            }
            let (mut n, mut why) = (0, String::new());
            for u in &us {
                let (px, py_) = pt.unwrap_or((u.atf("x"), u.atf("y")));
                let (w, spot) = self.why_maisons(u, px, py_);
                if !w.is_empty() {
                    if why.is_empty() {
                        why = w;
                    }
                    continue;
                }
                let (sx, sy) = spot.xy();
                self._go(u, sx, sy, &Val::None, false, false);
                u.set("order", dict! {"kind" => "maisons", "x" => py::round(sx), "y" => py::round(sy)});
                u.set("target", Val::None);
                n += 1;
            }
            return if n > 0 { ok("Aux maisons !") } else { (false, why) };
        }
        if kind == "barricade" {
            let (mut n, mut why) = (0, String::new());
            for u in &us {
                let w = self.why_barricade(u);
                if !w.is_empty() {
                    if why.is_empty() {
                        why = w;
                    }
                    continue;
                }
                let k = (if u.at("type") == "sapeurs" { BARR_T_SAP } else { BARR_T }) * (if u.atf("fat") >= 50.0 { BARR_FAT } else { 1.0 });
                u.set("order", dict! {"kind" => "barricade", "t0" => self.clock, "need" => k});
                u.set("target", Val::None);
                n += 1;
            }
            return if n > 0 { ok("On se barricade.") } else { (false, why) };
        }
        if kind == "pursue" {
            // la cavalerie court sus aux fuyards (le plus proche d'abord)
            let seen = self.seen_by.at(side);
            let (mut n, why) = (0, "Aucune troupe en fuite à poursuivre.");
            for u in &us {
                if u.at("cls") != "cavalerie" {
                    continue;
                }
                let (mut best, mut bd) = (Val::None, PURSUIT_RADIUS);
                for f in self.units.iter() {
                    if f.at("side") != side && U::alive(&f) && f.at("state") == "deroute" && seen.has(&f.at("id")) {
                        let d = Self::dist(u, &f);
                        if d < bd {
                            best = f;
                            bd = d;
                        }
                    }
                }
                if best.is_none() {
                    continue;
                }
                let (r, _) = self.order(side, &list![u.at("id")], "charge", who, &dict! {"target" => best.at("id")});
                n += if r { 1 } else { 0 };
            }
            return if n > 0 { ok("À la poursuite des fuyards !") } else { ko(why) };
        }
        if kind == "shot" {
            let mode = p.get("mode").or_else(|| p.get("value")).or_else(|| p.get("v")).or("auto");
            let mode = if dans(&mode, &["auto", "boulet", "mitraille"]) { mode } else { Val::from("auto") };
            let mut n = 0;
            for u in &us {
                if u.at("cls") == "artillerie" {
                    u.set("shot", &mode);
                    n += 1;
                }
            }
            if n == 0 {
                return ko("Seule l'artillerie choisit son projectile.");
            }
            return ok(match mode.s() {
                "auto" => "Les pièces choisissent leur projectile.",
                "boulet" => "Boulets sur toute la portée.",
                _ => "Mitraille : on attend l'ennemi à bout portant.",
            });
        }
        if kind == "counter" {
            let m = p.get("mode").or_else(|| p.get("value")).or_else(|| p.get("v")).or("on");
            let on = !(m == "off" || m == false || m == 0i64);
            let mut n = 0;
            for u in &us {
                if u.at("cls") == "artillerie" {
                    u.set("prio", if on { Val::from("artillerie") } else { Val::None });
                    u.set("target", Val::None);
                    n += 1;
                }
            }
            if n == 0 {
                return ko("Seule l'artillerie fait de la contre-batterie.");
            }
            return ok(if on { "Contre-batterie : les canons ennemis d'abord." } else { "Les pièces tirent sur le plus proche." });
        }
        if kind == "form" {
            let f = p.get("form");
            let mut n = 0;
            for u in &us {
                if U::FORMS().get(&u.at("cls")).or(tup![]).has(&f) {
                    if f != u.at("form") || (u.atf("busy") > 0.0 && u.at("next_form") != f) {
                        if self.phase == "deploiement" {
                            u.set("form", &f);
                        } else {
                            self._change_form(u, f.s());
                        }
                    }
                    n += 1;
                }
            }
            return if n > 0 { ok("Changement de formation.") } else { ko("Formation impossible.") };
        }
        if kind == "rally" {
            // même règle que le ralliement de lui-même (voir RALLY_*) : il faut le général auprès des fuyards (ou les
            // maisons d'une place, ou, sans général sur le terrain, être loin de l'ennemi)
            let (mut n, mut why): (i64, Option<&str>) = (0, None);
            for u in &us {
                if u.at("state") != "deroute" {
                    continue;
                }
                let (mut k, qui) = self._rally_k(u, &Val::None, true);
                k *= if u.atb("flag") { 1.0 } else { FLAG_RALLY };
                if k == 0.0 {
                    why = why.or(Some(qui));
                    continue;
                }
                if self.clock < u.atf("rally_t") {
                    why = why.or(Some("tot"));
                    continue;
                }
                let m = u.atf("morale") + 12.0;
                let m = m + if self.rally_general(u).truthy() { 6.0 } else { 0.0 };
                u.set("morale", pmin(100.0, m));
                u.set("rally_t", self.clock + 300.0);
                if u.atf("morale") >= 30.0 {
                    self._start_rally(u);
                    n += 1;
                } else {
                    why = why.or(Some("sourds"));
                }
            }
            if n > 0 {
                return ok("Les officiers rallient leurs hommes.");
            }
            return ko(match why {
                Some("general_loin") => "Le général est trop loin pour rallier ces hommes.",
                Some("ennemi") => "Impossible de rallier : l'ennemi est trop près.",
                Some("seuls") => "Sans général sur le terrain, les officiers ne rallieront ces hommes que loin de l'ennemi.",
                Some("tot") => "Les officiers s'y emploient déjà : laissez-leur le temps.",
                _ => "Les hommes ne veulent rien entendre.",
            });
        }
        if kind == "retreat" {
            for u in &us {
                self._retreat(u);
            }
            return ok("Retraite !");
        }
        if kind == "bombard" {
            // (ou une barricade dressée pendant la bataille, à BARR_AIM du point : de n'importe quel camp)
            let (x, y) = float_xy(p).unwrap_or((f64::NAN, f64::NAN));
            let fini = x.is_finite() && y.is_finite();
            let barr = fini && self.cells_near(x, y, BARR_AIM).iter().any(|&c| self.barr_prev.has(c));
            let pl = self.map.place.clone();
            if !barr
                && (side != 0
                    || !pl.truthy()
                    || !pl.get("battle").truthy()
                    || !self.map.walls.or(list![]).iter().any(|w| w.get("kind") != "barricade"))
            {
                return ko("Il n'y a pas de rempart à battre ici.");
            }
            us.retain(|u| u.at("cls") == "artillerie" && u.at("type") != "mitrailleuses");
            if us.is_empty() {
                return ko("Seuls les canons battent un rempart.");
            }
            if !fini {
                return ko("Touchez le rempart à battre.");
            }
            for u in &us {
                u.set("order", dict! {"kind" => "bombard", "x" => py::round(x), "y" => py::round(y)});
                u.set("target", Val::None);
            }
            return ok(if barr { "On bat la barricade." } else { "Batterie de brèche : on bat le rempart." });
        }
        ko("Ordre inconnu.")
    }

    /// Le camp décroche : toutes ses unités quittent la carte par leur bord ; la bataille finit quand c'est fait.
    ///
    /// Python (battle.py, l. 1482-1495) : `def withdraw(self, side)`
    pub fn withdraw(&mut self, side: i64) -> (bool, String) {
        if self.phase == "fin" {
            return (false, "La bataille est terminée.".to_string());
        }
        if self.withdrawing.at(side).truthy() {
            return (true, "Le camp décroche déjà.".to_string());
        }
        if self.phase == "deploiement" {
            self.start();
        }
        self.withdrawing.set(side, true);
        self.withdraw_t.set(side, self.clock);
        for u in self.units_of(side).iter() {
            self._retreat(&u);
        }
        self.log("Ordre de décrocher : l'armée se retire du champ de bataille.", &Val::None, &Val::None);
        (true, "Le camp décroche.".to_string())
    }

    /// Retraite en ordre vers son bord (sans recherche de chemin : on oblique devant les obstacles).
    ///
    /// Python (battle.py, l. 1497-1509) : `def _retreat(self, u)`
    pub fn _retreat(&mut self, u: &Val) {
        if u.at("state") == "melee" {
            self._end_melee(u);
        }
        if u.at("cls") == "artillerie" && u.at("form") == "batterie" {
            self._change_form(u, "attelee");
        }
        if u.at("form") == "maisons" || u.at("next_form") == "maisons" {
            self._change_form(u, Self::_dehors(u));
        }
        u.set("order", dict! {"kind" => "retreat"});
        u.set("target", Val::None);
        u.set("path", list![]);
        u.set("goal", Val::None);
        if !dans(&u.at("state"), &["deroute", "ralliement"]) {
            u.set("state", "marche");
        }
    }

    /// Python (battle.py, l. 1511-1526) : `def _go(self, u, gx, gy, d, run=False, allow_out=False)`
    /// Met l'unité en marche vers (gx, gy) : pose u.path, u.goal = [gx, gy, d, run], u.state. d : angle (rad) à
    /// prendre à l'arrivée, ou None ; défauts : run = false, allow_out = false.
    pub fn _go(&mut self, u: &Val, gx: f64, gy: f64, d: &Val, run: bool, allow_out: bool) {
        if u.at("cls") == "artillerie" && u.at("form") == "batterie" {
            self._change_form(u, "attelee");
        }
        if u.at("form") == "maisons" || u.at("next_form") == "maisons" {
            self._change_form(u, Self::_dehors(u)); // (on sort des maisons : MAISON_OUT)
        }
        if u.at("state") == "melee" {
            self._end_melee(u);
        }
        if allow_out {
            let (ix, iy) = (pmin(pmax(gx, 1.0), (W - 1) as f64), pmin(pmax(gy, 1.0), (H - 1) as f64));
            let p = self.plan_path(u, ix, iy);
            p.push(tup![gx, gy]);
            u.set("path", p);
        } else {
            let p = self.plan_path(u, gx, gy);
            u.set("path", p);
        }
        u.set("goal", list![gx, gy, d, run]);
        u.set("stuck", 0);
        if !dans(&u.at("state"), &["deroute", "ralliement"]) {
            u.set("state", if u.atb("path") { "marche" } else { "repos" });
        }
    }

    /// Se porter à portée de tir de la cible : on s'arrête dès qu'elle est à bonne portée (90 % de la
    /// portée efficace : la distance d'ouverture du feu des règlements), sans aller au contact. Ordre du joueur :
    /// selon son profil d'arrêt (units.stop_dist), sans jamais reculer.
    ///
    /// Python (battle.py, l. 1528-1549) : `def _approach(self, u, tg)`
    pub fn _approach(&mut self, u: &Val, tg: &Val) {
        let (e, mx, _g) = U::ranges(u);
        let (e, mx) = (e as f64, mx as f64);
        let d = Self::dist(u, tg);
        let mut want = e * 0.9;
        let o = u.at("order");
        let stop = if o.truthy() { o.get("stop") } else { Val::None };
        if stop.truthy() {
            want = U::stop_dist(u, stop.s());
        } else if u.at("cls") == "artillerie" {
            // les canons tirent dès qu'ils portent : ils ne s'approchent que hors de portée
            want = if d > mx { mx * 0.95 } else { d };
        } else if u.at("cls") == "cavalerie" {
            want = 120.0;
        }
        if d > want {
            let k = (d - want) / d;
            let (ux, uy, tx, ty) = (u.atf("x"), u.atf("y"), tg.atf("x"), tg.atf("y"));
            self._go(u, ux + (tx - ux) * k, uy + (ty - uy) * k, &Val::from(Self::bearing(u, tg)), false, false);
        } else {
            u.set("path", list![]);
            u.set("goal", Val::None);
            if u.at("cls") == "artillerie" && u.at("form") != "batterie" {
                self._change_form(u, "batterie");
            }
        }
    }

    /// Python (battle.py, l. 1551-1576) : `def _change_form(self, u, f)`
    /// f : la formation à prendre (units::FORMS, ou 'maisons').
    pub fn _change_form(&mut self, u: &Val, f: &str) {
        let busy = u.atf("busy");
        if u.at("form") == f && busy <= 0.0 {
            return;
        }
        if busy > 0.0 && u.at("next_form") == f {
            return; // déjà en train de prendre cette formation : redonner l'ordre ne relance pas la manœuvre
        }
        if busy > 0.0 && u.at("form") == f && u.at("state") != "ralliement" {
            // contrordre : on revient à la formation qu'on quittait, le temps de défaire ce qui est fait
            u.set("next_form", f);
            return;
        }
        let mut base = FORM_TIME().get_or(f, 50).f();
        let side = u.ati("side");
        let tr = self.r#trait(side);
        let mut k = 1.0 - 0.4 * u.atf("xp") / 100.0 - self.spec.get_or("fm_swift", list![0, 0]).at(side).f();
        if u.at("cls") == "artillerie" {
            k = 1.0
                - (if self.spec.get_or("art_cheval", list![0, 0]).at(side).truthy() { 0.33 } else { 0.0 })
                - (if tr == "artilleur" { 0.2 } else { 0.0 });
            if f == "batterie" && WOODS.contains(&(self.map.t[Self::cell(u.atf("x"), u.atf("y")) as usize] as i64)) {
                base *= CAMO_SETUP; // (mise en batterie entre les arbres)
            }
        } else if u.at("cls") == "cavalerie" {
            base = 30.0;
        }
        if u.at("form") == "maisons" {
            base = MAISON_OUT;
        }
        u.set("next_form", f);
        // (pendant un ralliement, les officiers reforment d'abord les rangs : pas de raccourci)
        let b3 = if u.at("state") == "ralliement" { u.atf("busy") } else { 0.0 };
        u.set("busy", pmax(pmax(10.0, base * pmax(0.4, k)), b3));
        if u.at("state") != "deroute" && u.atb("path") && f == "batterie" {
            u.set("path", list![]);
        }
    }

    /// Python (battle.py, l. 1578-1586) : `def _start_rally(self, u)`
    pub fn _start_rally(&mut self, u: &Val) {
        u.set("state", "ralliement");
        u.set("halt", false);
        u.set("busy", 60.0);
        u.set("path", list![]);
        u.set("goal", Val::None);
        let cls = u.at("cls");
        let nf = if dans(&cls, &["inf", "cavalerie"]) {
            Val::from("ligne")
        } else if cls == "artillerie" {
            Val::from("attelee")
        } else {
            u.at("form")
        };
        u.set("next_form", nf);
        if u.atb("light") {
            u.set("next_form", "tirailleurs");
        }
    }

    /// L'ennemi repéré le plus proche (en état de combattre), ou None.
    ///
    /// Python (battle.py, l. 1588-1596) : `def nearest_foe(self, u)`
    /// Rend une unité ou None.
    pub fn nearest_foe(&self, u: &Val) -> Val {
        let (mut best, mut bd) = (Val::None, 1e18);
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        for f in self.visible_enemies(u.ati("side")).iter() {
            if U::valid(&f) {
                let d = py::pow(f.atf("x") - ux, 2.0) + py::pow(f.atf("y") - uy, 2.0);
                if d < bd {
                    best = f;
                    bd = d;
                }
            }
        }
        best
    }

    /// Se porter à la distance want de la cible (sans reculer).
    ///
    /// Python (battle.py, l. 1598-1605) : `def _approach_to(self, u, tg, want)`
    pub fn _approach_to(&mut self, u: &Val, tg: &Val, want: f64) {
        let d = Self::dist(u, tg);
        if d > want {
            let k = (d - want) / d;
            let (ux, uy, tx, ty) = (u.atf("x"), u.atf("y"), tg.atf("x"), tg.atf("y"));
            self._go(u, ux + (tx - ux) * k, uy + (ty - uy) * k, &Val::from(Self::bearing(u, tg)), false, false);
        } else {
            u.set("path", list![]);
            u.set("goal", Val::None);
        }
    }

    /// Python (battle.py, l. 1607-1614) : `def _nearest_foe_dist(self, u, valid=True)`
    /// Distance (m) de l'ennemi en vie le plus proche, repéré ou non (valid, défaut true : en état de combattre) ;
    /// 31 623 m (√1e9) s'il n'y en a pas.
    pub fn _nearest_foe_dist(&self, u: &Val, valid: bool) -> f64 {
        let mut best = 1e9;
        let (ux, uy, side) = (u.atf("x"), u.atf("y"), u.at("side"));
        for e in self.units.iter() {
            if e.at("side") != side && U::alive(&e) && (!valid || U::valid(&e)) {
                let d = py::pow(e.atf("x") - ux, 2.0) + py::pow(e.atf("y") - uy, 2.0);
                if d < best {
                    best = d;
                }
            }
        }
        best.sqrt()
    }

    // ================================================================== boucle
    /// Avance d'un intervalle réel (s) à la vitesse tactique ; pas fixes de DT. Renvoie le nombre de pas.
    ///
    /// Python (battle.py, l. 1617-1628) : `def advance(self, real_dt, speed=None)`
    /// speed : nombre, ou None (défaut : self.speed).
    pub fn advance(&mut self, real_dt: f64, speed: &Val) -> i64 {
        let sp = if speed.is_none() { self.speed as f64 } else { speed.f() };
        if self.phase != "combat" || sp <= 0.0 {
            return 0;
        }
        self._acc += real_dt * sp * TIME_K;
        let mut n = 0;
        while self._acc >= DT && self.phase == "combat" && n < 40 {
            self._acc -= DT;
            self.step(DT);
            n += 1;
        }
        n
    }

    /// Bataille accélérée (« Finir automatiquement ») : des pas DT ordinaires, le même déroulé qu'à ×1, autant que
    /// le permet budget (secondes de calcul réelles ; au moins un pas), sans dépasser l'heure until (« Donner mes
    /// ordres » : la bataille défile à l'allure du film) ni le moment décisif (ask). Renvoie le nombre de pas.
    ///
    /// Python (battle.py, l. 1630-1643) : `def run_for(self, budget, until=None)`
    /// until : heure de bataille (s) ou None (défaut). `time.perf_counter()` → `std::time::Instant`.
    pub fn run_for(&mut self, budget: f64, until: &Val) -> i64 {
        if self.phase != "combat" || self.ask.truthy() {
            return 0;
        }
        let t0 = std::time::Instant::now();
        let mut n = 0;
        while self.phase == "combat" && !self.ask.truthy() && (until.is_none() || self.clock < until.f()) {
            self.step(DT);
            n += 1;
            if t0.elapsed().as_secs_f64() >= budget {
                break;
            }
        }
        n
    }

    /// Synchrone, sans budget de temps (essais, bancs) : joue la bataille jusqu'au bout par pas DT (la nuit y met
    /// fin au plus tard). Renvoie le nombre de pas.
    ///
    /// Python (battle.py, l. 1645-1656) : `def run_to_end(self)`
    /// `OR.answer(self, 'go')` → `crate::tactics::orders::answer(self, "go")`.
    pub fn run_to_end(&mut self) -> i64 {
        if self.phase == "deploiement" {
            self.start();
        }
        let mut n = 0;
        while self.phase == "combat" {
            if self.ask.truthy() {
                OR::answer(self, "go"); // (essais, bancs : le moment décisif ne s'attend pas)
            }
            self.step(DT);
            n += 1;
        }
        n
    }

    /// Python (battle.py, l. 1658-1693) : `def step(self, dt=DT)`
    /// dt : défaut DT. `alive` : la liste des unités en vie au début du pas, passée à `_contacts(&alive, dt)`.
    pub fn step(&mut self, dt: f64) {
        if self.phase != "combat" {
            return;
        }
        self.clock += dt;
        let left = self.dusk - self.clock;
        self.light = if left > 3600.0 { 1.0 } else { pmax(0.15, 0.15 + 0.85 * left / 3600.0) };
        if self.wx_at.is_some() && self.clock >= self.wx_at.f() {
            self._wx_turn();
        }
        if self._smoke_on {
            let k = (-dt / SMOKE_TAU().get_or(self.weather.as_str(), 120.0).f()).exp();
            let mut mx = 0.0;
            for v in self.smoke.iter_mut() {
                if *v != 0.0 {
                    *v = if *v > 0.01 { *v * k } else { 0.0 };
                    mx = pmax(mx, *v);
                }
            }
            self._smoke_on = mx > 0.0;
        }
        self._refresh_gens();
        self._astar_left = 3;
        if self.clock - self._vis_t >= VIS_DT {
            self._update_vision();
        }
        if self.clock - self._ai_t >= AI_DT {
            self._ai_t = self.clock;
            self._think();
        }
        let alive: Val = self.units.iter().filter(U::alive).collect();
        for u in alive.iter() {
            self._update_unit(&u, dt);
        }
        self._contacts(&alive, dt);
        self._wagons(dt);
        if self.feu.truthy() && self.clock - self._feu_t >= FEU_DT {
            self._feu_t = self.clock;
            self._incendie();
        }
        for u in alive.iter() {
            if U::alive(&u) {
                self._morale(&u, dt);
            }
        }
        self._check_end();
    }

    /// Python (battle.py, l. 1695-1702) : `def _think(self)`
    /// `AI.think(self, side, AI_DT)` → `crate::tactics::ai::think(self, side, AI_DT)` (le try / except de l'import
    /// ne se porte pas).
    pub fn _think(&mut self) {
        for side in [0i64, 1] {
            if self.ai_sides.has(side) || self.units.iter().any(|u| u.at("side") == side && U::alive(&u) && u.at("ctrl") == "ia") {
                crate::tactics::ai::think(self, side, AI_DT);
            }
        }
    }
}
