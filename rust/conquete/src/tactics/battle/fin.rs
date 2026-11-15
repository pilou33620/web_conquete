//! Porte game/tactics/battle.py, lignes 2990 à 3394 : moral ; fin ; « Finir automatiquement » : la bataille en accéléré ; vue client ; sauvegarde.
//! Conventions : l'en-tête de battle/mod.rs.

use super::*;
use crate::pyset;

/// `max(a, b)` de Python : a, sauf si b est plus grand (le premier gagne, -0.0 et NaN compris).
fn max2(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// `min(a, b)` de Python : a, sauf si b est plus petit.
fn min2(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
/// `v in ('a', 'b', …)` pour un texte.
fn est(v: &Val, l: &[&str]) -> bool {
    l.iter().any(|s| *v == *s)
}
/// `(ax - bx) ** 2 + (ay - by) ** 2`.
fn d2(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    py::pow(ax - bx, 2.0) + py::pow(ay - by, 2.0)
}

impl TacticalBattle {
    // ------------------------------------------------------------------ moral
    /// Le bataillon qui lâche pied au contact abandonne son drapeau au plus proche ennemi.
    ///
    /// Python (battle.py, l. 2991-3010) : `def _flag_lost(self, u)`
    pub fn _flag_lost(&mut self, u: &Val) {
        if u.at("cls") != "inf" || !u.atb("flag") {
            return;
        }
        let (mut by, mut bd) = (Val::None, FLAG_R * FLAG_R);
        for o in self.units.iter() {
            if o.at("side") != u.at("side") && U::valid(&o) {
                let d = d2(o.atf("x"), o.atf("y"), u.atf("x"), u.atf("y"));
                if d < bd {
                    by = o;
                    bd = d;
                }
            }
        }
        if by.is_none() {
            return;
        }
        u.set("flag", false);
        u.set("morale", max2(0.0, u.atf("morale") - FLAG_SHOCK));
        by.set("morale", min2(100.0, by.atf("morale") + FLAG_GAIN));
        for o in self.units.iter() {
            if o.at("side") == u.at("side") && !o.is(u) && U::valid(&o) && d2(o.atf("x"), o.atf("y"), u.atf("x"), u.atf("y")) < ROUT_R * ROUT_R {
                let k = if self.general_near(&o, 400.0).truthy() { 0.5 } else { 1.0 };
                o.set("morale", max2(0.0, o.atf("morale") - FLAG_AMIS * k));
            }
        }
        self.emit("drapeau", u.atf("x"), u.atf("y"), &Val::None, &Val::None, &Val::None, &by.at("id"));
        self.log(&format!("{} prend le drapeau de {} !", by.at("name"), u.at("name")), &Val::None, &by.at("side"));
    }

    /// Python (battle.py, l. 3012-3039) : `def _rout(self, u)`
    /// Met l'unité en déroute.
    pub fn _rout(&mut self, u: &Val) {
        if est(&u.at("state"), &["deroute", "hors"]) {
            return;
        }
        if u.at("state") == "melee" {
            self._end_melee(u);
        }
        u.set("state", "deroute");
        u.set("halt", false);
        if u.at("form") == "maisons" {
            u.set("form", Self::_dehors(u)); // (les fuyards se sauvent par les rues)
        }
        u.set("order", dict! {"kind" => "deroute"});
        u.set("target", Val::None);
        u.set("busy", 0.0);
        u.set("next_form", Val::None);
        u.set("path", list![]); // la fuite se fait droit vers son bord, en contournant les obstacles (voir _flee)
        u.set("goal", Val::None);
        self.emit("deroute", u.atf("x"), u.atf("y"), &Val::None, &Val::None, &Val::None, &u.at("id"));
        self.log(&format!("{} est en déroute !", u.at("name")), &Val::None, &u.at("side"));
        self._flag_lost(u);
        // la déroute ébranle les voisins déjà éprouvés (une troupe ferme la laisse passer), d'autant plus que la troupe
        // qui fuit est nombreuse ; moins près du général
        let k = ROUT_MOR * min2(1.5, u.atf("men") / 250.0);
        for o in self.units.iter() {
            if o.at("side") == u.at("side") && !o.is(u) && U::valid(&o) && d2(o.atf("x"), o.atf("y"), u.atf("x"), u.atf("y")) < ROUT_R * ROUT_R {
                let shaken = min2(1.0, max2(0.0, (ROUT_STEADY as f64 - o.atf("morale")) / 30.0));
                let mut hit = k * shaken / U::TYPE().get_or(&o.at("type"), U::TYPE().at("ligne")).atf("steady");
                if self.general_near(&o, 400.0).truthy() {
                    hit *= 0.5;
                }
                o.set("morale", max2(0.0, o.atf("morale") - hit));
            }
        }
    }

    /// Python (battle.py, l. 3041-3068) : `def _morale(self, u, dt)`
    pub fn _morale(&mut self, u: &Val, dt: f64) {
        if u.at("state") == "hors" {
            return;
        }
        let gen = self.general_near(u, 400.0);
        let bonus = if gen.truthy() {
            if gen.at("gen").or(dict! {}).get("trait") == "inspirant" {
                15.0
            } else {
                10.0
            }
        } else {
            0.0
        };
        let calm = self.clock - u.atf("hit_t") > 30.0 && u.at("state") != "melee";
        let cap = min2(100.0, max2(u.atf("morale0"), 60.0) + 5.0 + bonus - u.atf("fat") / 4.0);
        if u.at("state") == "deroute" {
            // (seulement près du général, au calme ; dans une place, par ses officiers ; sans général sur le terrain,
            // loin de l'ennemi : voir RALLY_*)
            let (mut k, who) = self._rally_k(u, &Val::None, false);
            k *= if u.atb("flag") { 1.0 } else { FLAG_RALLY };
            // (les fuyards s'arrêtent auprès du général ou, loin de tout, de leurs officiers ; dans une place, ils se
            // reprennent en courant se mettre à l'abri au fond de la ville, comme avant)
            u.set("halt", k > 0.0 && who != "place");
            if k != 0.0 {
                u.set("morale", min2(cap, u.atf("morale") + k * dt));
                if u.atf("morale") >= 40.0 {
                    self._start_rally(u);
                    let txt = format!("{} se rallie{}", u.at("name"), if who == "general" { " autour du général." } else { "." });
                    self.log(&txt, &u.at("side"), &Val::None);
                }
            }
            return;
        }
        if calm && u.atf("morale") < cap {
            let rec = MOR_REC + (if gen.truthy() { MOR_REC_GEN } else { 0.0 }) + 0.01 * self.cover_at(u.atf("x"), u.atf("y"));
            u.set("morale", min2(cap, u.atf("morale") + rec * dt));
        }
        if u.atf("ammo") < 1.0 && u.at("cls") != "cavalerie" && self._nearest_foe_dist(u, true) < 400.0 {
            u.set("morale", max2(0.0, u.atf("morale") - 0.01 * dt));
        }
        if !est(&u.at("cls"), &["general", "chariot"]) && u.atf("morale") + bonus < 25.0 {
            self._rout(u);
        }
    }

    // ------------------------------------------------------------------ fin
    /// Python (battle.py, l. 3071-3104) : `def _check_end(self)`
    pub fn _check_end(&mut self) {
        let mut v = [0i64, 1].map(|s| self.units.iter().any(|u| u.at("side") == s && U::valid(&u)));
        let mut res: Option<(i64, bool, &str)> = None;
        if self.objective().is_some() {
            let (hx, hy) = self.objective().xy();
            let att = py::sum(
                self.units
                    .iter()
                    .filter(|u| U::valid(u) && u.at("side") == 0 && d2(u.atf("x"), u.atf("y"), hx, hy) < HEART_R * HEART_R)
                    .map(|u| u.atf("men")),
            );
            let dfd = self.units.iter().any(|u| U::valid(&u) && u.at("side") == 1 && d2(u.atf("x"), u.atf("y"), hx, hy) < HEART_FREE * HEART_FREE);
            self.hold_t = if att >= HEART_MEN && !dfd { self.hold_t + DT } else { 0.0 };
            if self.hold_t >= HEART_HOLD {
                res = Some((0, false, "L'assaillant tient le cœur de la place."));
            } else if self._surrender() {
                res = Some((0, false, "La garnison capitule : la brèche est ouverte, elle se rend prisonnière."));
            }
        }
        for s in 0..2usize {
            if self.withdrawing.atb(s) && self.clock - self.withdraw_t.atf(s) > 1800.0 && v[s] {
                // une demi-heure après l'ordre de décrocher, l'arrière-garde a filé
                for u in self.units.iter() {
                    if u.at("side") == s as i64 && U::valid(&u) {
                        u.set("state", "hors");
                    }
                }
                v[s] = false;
            }
        }
        if res.is_none() {
            let w0 = self.withdrawing.atb(0);
            let w1 = self.withdrawing.atb(1);
            if !v[0] && !v[1] {
                res = Some((1, true, "Les deux armées se sont débandées."));
            } else if !v[0] {
                res = Some((1, w0, if w0 { "L'assaillant a décroché." } else { "L'assaillant est en déroute." }));
            } else if !v[1] {
                res = Some((0, w1, if w1 { "Le défenseur a décroché." } else { "Le défenseur est en déroute." }));
            } else if self.clock >= self.dusk {
                res = Some((1, true, "La nuit tombe : l'assaillant n'a pas emporté la décision et se retire."));
            }
        }
        if let Some((w, d, why)) = res {
            self.finish(w, d, why);
        }
    }

    /// La garnison d'une place battue en brèche capitule (SURR_*) : elle est prisonnière.
    ///
    /// Python (battle.py, l. 3106-3125) : `def _surrender(self)`
    pub fn _surrender(&mut self) -> bool {
        if !self.breach_t.truthy()
            || self.siege_t.is_none()
            || self.clock - self.breach_t.at(0).atf(0) < SURR_BREACH_T
            || self.clock - self.siege_t.f() < SURR_POUND_T
        {
            return false;
        }
        let gar: Vec<Val> = self.units.iter().filter(|u| u.at("side") == 1 && !est(&u.at("cls"), &["general", "chariot"])).collect();
        let men0 = py::sum(gar.iter().map(|u| u.atf("men0")));
        let here: Vec<&Val> = gar.iter().filter(|u| u.at("state") != "hors" && u.atf("men") > 0.0).collect(); // (les fuyards encore là comptent au moral)
        let men = py::sum(here.iter().filter(|u| U::valid(u)).map(|u| u.atf("men")));
        if men == 0.0
            || py::sum(gar.iter().map(|u| u.atf("men0") - u.atf("men"))) < SURR_LOSS * men0
            || py::sum(here.iter().map(|u| u.atf("morale") * u.atf("men"))) >= SURR_MOR * py::sum(here.iter().map(|u| u.atf("men")))
            || self.strength(0) < SURR_RATIO * men
        {
            return false;
        }
        for u in self.units.iter() {
            if u.at("side") == 1 && u.atf("men") > 0.0 && u.at("cls") != "general" {
                u.inc("captured", u.at("men"));
                self.prisoners.inc(1, u.at("men"));
                u.set("men", 0.0);
                u.set("state", "hors");
            }
        }
        true
    }

    /// Python (battle.py, l. 3127-3135) : `def finish(self, winner, disengage, why)`
    /// winner : camp vainqueur (0 ou 1) ; disengage : le vaincu a décroché (ou la nuit est tombée). Pose
    /// self.winner, self.disengage, self.why, self.result.
    pub fn finish(&mut self, winner: i64, disengage: bool, why: &str) {
        if self.phase == "fin" {
            return;
        }
        self.phase = "fin".to_string();
        self.winner = Val::from(winner);
        self.disengage = Val::from(disengage);
        self.why = Val::from(why);
        let mut c = why.chars();
        let txt = match c.next() {
            Some(p) => p.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        };
        self.log(&txt, &Val::None, &Val::None);
        self.result = self._result();
    }

    /// Python (battle.py, l. 3137-3148) : `def _result(self)`
    /// Rend le dict {winner, disengage, why, units: {id: {men, lost, morale, xp, fat, ammo, captured, state,
    /// wounded}}, lost: [a, d], men0: [a, d], prisoners: [a, d]}.
    pub fn _result(&self) -> Val {
        let res = dict! {"winner" => &self.winner, "disengage" => &self.disengage, "why" => &self.why, "units" => dict!{},
            "lost" => list![0.0, 0.0], "men0" => list![0.0, 0.0],
            "prisoners" => list![py::round(self.prisoners.atf(0)), py::round(self.prisoners.atf(1))]};
        for u in self.units.iter() {
            let fought = u.atf("fought");
            let gain = if fought <= 0.0 { 0.0 } else { 2.0 + 10.0 * min2(1.0, fought / 1800.0) };
            res.at("units").set(
                u.at("id"),
                dict! {"men" => u.at("men"), "lost" => &u.at("men0") - &u.at("men"), "morale" => u.at("morale"), "xp" => gain,
                "fat" => u.at("fat"), "ammo" => u.atf("ammo") / max2(1.0, u.atf("ammo0")) * 100.0, "captured" => u.at("captured"),
                "state" => u.at("state"), "wounded" => u.at("wounded")},
            );
            if !est(&u.at("cls"), &["general", "chariot"]) {
                res.at("lost").inc(u.at("side"), &u.at("men0") - &u.at("men"));
                res.at("men0").inc(u.at("side"), u.at("men0"));
            }
        }
        res
    }

    // ================================================================== « Finir automatiquement » : la bataille en accéléré
    /// « Finir automatiquement » : les officiers du joueur (l'IA, au niveau ACCEL_LEVEL) prennent le commandement de
    /// ses unités et la suite se joue jusqu'au bout, IA contre IA, avec les mêmes règles et les mêmes pas DT qu'une
    /// bataille commandée, aussi vite que le serveur le permet (bridge.tick : budget de calcul par appel ; run_to_end
    /// pour les essais). Pendant le déploiement, les officiers déploient le camp à leur idée, puis engagent la bataille ;
    /// en plein combat, l'IA reprend la situation telle qu'elle est (ai._adopt) : les charges et mêlées en cours
    /// continuent, les troupes que le joueur a envoyées en retraite poursuivent leur retraite (elles restent à lui),
    /// celles à qui il avait fait cesser le feu le rouvrent, et un camp qui décroche continue de décrocher. Le joueur
    /// peut reprendre le commandement (resume).
    ///
    /// Python (battle.py, l. 3151-3193) : `def autofinish(self)`
    /// `AI.deploy(self, me)` → `crate::tactics::ai::deploy(self, me)`.
    pub fn autofinish(&mut self) -> (bool, String) {
        if self.phase == "fin" {
            return (false, "La bataille est terminée.".to_string());
        }
        if self.accel {
            return (true, "Vos officiers poursuivent déjà la bataille.".to_string());
        }
        let me = self.me.clone();
        if tup![0, 1].has(&me) {
            let lv = self.spec.get("ai_levels");
            let lv = if (lv.is_list() || lv.is_tuple()) && lv.len() == 2 { lv.to_list() } else { list![&self.difficulty, &self.difficulty] };
            lv.set(&me, ACCEL_LEVEL); // (l'adversaire garde le sien : spec['ai_levels'], sinon la difficulté de la partie)
            self.spec.set("ai_levels", lv);
            let took = list![];
            for u in self.units.iter() {
                if u.at("side") != me || u.at("ctrl") != "joueur" {
                    continue;
                }
                if self.phase == "combat" && u.at("order").truthy() && u.at("order").get("kind") == "retreat" {
                    continue;
                }
                u.set("ctrl", "ia");
                u.set("fire_mode", "free");
                took.push(u.at("id"));
            }
            self.accel_ids = took;
            if !self.ai_sides.has(&me) {
                self.ai_sides.push(&me);
            }
            // l'IA n'a rien gardé du camp du joueur (bridge.default_deploy) : elle repart de son propre déploiement, ou
            // de la situation présente à sa première réflexion
            self.ai_mem.pop(format!("s{me}"));
            if self.phase == "deploiement" {
                crate::tactics::ai::deploy(self, me.i());
            }
        }
        if self.phase == "deploiement" {
            self.start();
        }
        self.accel = true;
        self.accel_t = self.clock;
        self.log("Vos officiers prennent le commandement : la bataille se poursuit en accéléré.", &me, &Val::None);
        (true, "Vos officiers poursuivent la bataille.".to_string())
    }

    /// Le joueur reprend le commandement pendant l'accéléré : ses unités repassent sous ses ordres (avec les chariots
    /// pris à l'ennemi entre-temps), la bataille se met en pause pour qu'il voie où en sont les choses.
    ///
    /// Python (battle.py, l. 3195-3216) : `def resume(self)`
    /// Les sets `back` et `owners` ne servent qu'à des tests d'appartenance.
    pub fn resume(&mut self) -> (bool, String) {
        if self.phase == "fin" {
            return (false, "La bataille est terminée.".to_string());
        }
        if !self.accel {
            return (false, "Vous avez déjà le commandement.".to_string());
        }
        let me = self.me.clone();
        self.accel = false;
        if tup![0, 1].has(&me) {
            let back = self.accel_ids.to_set();
            let owners = pyset![];
            for i in back.iter() {
                if self.by_id.has(&i) && self.by_id.at(&i).at("cls") != "chariot" {
                    owners.push(self.by_id.at(&i).at("owner"));
                }
            }
            for u in self.units.iter() {
                if u.at("side") == me && (back.has(u.at("id")) || (u.at("cls") == "chariot" && owners.has(u.at("owner")))) {
                    u.set("ctrl", "joueur");
                }
            }
            if self.ai_sides.has(&me) {
                self.ai_sides.remove(&me);
            }
            self.ai_mem.pop(format!("s{me}")); // (si les officiers reprennent la main, ils repartiront de la situation)
        }
        self.accel_ids = list![];
        self.speed = 0;
        self.log("Vous reprenez le commandement.", &me, &Val::None);
        (true, "Vous reprenez le commandement : la bataille est en pause.".to_string())
    }

    // ================================================================== vue client
    /// Python (battle.py, l. 3219-3289) : `def view(self, me=None, since=0)`
    /// me : camp de qui regarde (0, 1), ou None (défaut : self.me ; s'il est None aussi, tout est montré) ;
    /// since : numéro du dernier effet déjà reçu (défaut 0). Rend le dict de la vue ; `barr`, `breaches`, `wind`
    /// y sont les objets mêmes de la bataille.
    pub fn view(&self, me: &Val, since: i64) -> Val {
        let me = if me.is_none() { self.me.clone() } else { me.clone() };
        let seen = if tup![0, 1].has(&me) { self.seen_by.at(&me) } else { Val::None };
        let units = list![];
        for u in self.units.iter() {
            if u.at("state") == "hors" && u.at("side") != me {
                continue;
            }
            let mine = me.is_none() || u.at("side") == me;
            if !mine && (seen.is_none() || !seen.has(u.at("id"))) && self.phase != "fin" {
                continue;
            }
            let d = U::view(&u, mine, u.atb("seen"));
            units.push(&d);
            let (x, y, cls) = (u.atf("x"), u.atf("y"), u.at("cls"));
            if mine && self._smoke_on && est(&cls, &["inf", "artillerie"]) && self.smoke_at(x, y) > 0.4 {
                d.set("smoke", py::round(min2(SMOKE_MAX, SMOKE_K * self.smoke_at(x, y)) * 100.0)); // (% de feu perdu dans sa propre fumée)
            }
            if cls == "inf"
                && (self.ufx(&u, "entrench") != 0.0 || self.spec.get("logement").or(tup![]).has(u.at("id")))
                && self.clock - u.atf("still_t") >= ENTRENCH_T
            {
                d.set("dug", 1); // retranchée : le client dessine sa tranchée et ses gabions (SPEC-SUITE J)
            }
            if cls == "artillerie" && self.on_rampart(&u) {
                d.set("rempart", true); // sur l'enceinte : le client la dessine sans avant-train
            }
            if mine && cls == "general" && U::alive(&u) {
                d.set("rally", py::round(self.rally_radius(&u))); // (zone où il rallie les fuyards)
            }
            if mine && est(&cls, &["inf", "cavalerie", "artillerie"]) && U::alive(&u) {
                d.set("zones", fire_zones(&u)); // (zones de tir, dessinées à la sélection)
                if cls != "cavalerie" {
                    d.set("stop_d", py::round(U::stop_dist(&u, &u.ats("stop")))); // (où l'ordre « attaquer » s'arrêtera)
                }
            }
            if mine && cls == "inf" && U::alive(&u) {
                // « Occuper les maisons » (là où elle est), « Barricader » : True, ou pourquoi c'est impossible
                let why = self.why_maisons(&u, x, y).0;
                d.set("can_occupy", if why.is_empty() { Val::from(true) } else { Val::from(why) });
                let why = self.why_barricade(&u);
                d.set("can_barricade", if why.is_empty() { Val::from(true) } else { Val::from(why) });
            }
        }
        let sides = list![];
        for s in 0..2i64 {
            let us: Vec<Val> = self.units.iter().filter(|u| u.at("side") == s && !est(&u.at("cls"), &["general", "chariot"])).collect();
            let men = py::sum(us.iter().filter(|u| u.at("state") != "hors").map(|u| u.atf("men")));
            let mut m0 = py::sum(us.iter().map(|u| u.atf("men0")));
            if m0 == 0.0 {
                m0 = 1.0;
            }
            let vivants = || us.iter().filter(|u| U::alive(u));
            let mor = py::sum(vivants().map(|u| u.atf("morale") * u.atf("men"))) / max2(1.0, py::sum(vivants().map(|u| u.atf("men"))));
            let sd = dict! {"owner" => self.spec.at("owners").at(s), "name" => self.spec.at("names").at(s),
                "color" => self.spec.at("colors").at(s), "men" => py::round(men), "men0" => py::round(m0), "morale" => py::round(mor),
                "routed" => us.iter().filter(|u| u.at("state") == "deroute").count(),
                "out" => us.iter().filter(|u| u.at("state") == "hors").count()};
            if me.is_some() && me != s && self.phase != "fin" {
                // l'ennemi : seulement ce qu'on en voit, et l'effectif de départ annoncé par les éclaireurs
                let vis: Vec<&Val> = us.iter().filter(|u| seen.truthy() && seen.has(u.at("id")) && U::alive(u)).collect();
                sd.set("men", py::round(py::sum(vis.iter().map(|u| u.atf("men")))));
                // moral apparent : celui des troupes qu'on voit (0 si l'on ne voit personne)
                let m = py::sum(vis.iter().map(|u| u.atf("morale") * u.atf("men"))) / max2(1.0, py::sum(vis.iter().map(|u| u.atf("men"))));
                sd.set("morale", py::round(m));
                sd.set("seen", true);
            }
            sides.push(sd);
        }
        let h_off = self.spec.get_or("h_off", 0.0);
        let bati: Val = self
            .bati_log
            .iter()
            .filter(|x| x.at(0) > since)
            .map(|x| list![x.at(1), x.at(2)])
            .collect();
        let barr_t: Val = self.barr_log.iter().filter(|x| x.at(0) > since).map(|x| list![x.at(1), x.at(2)]).collect();
        let fx: Val = self.fx.iter().filter(|e| e.at("s") > since).collect();
        let mut log = vec![];
        for x in self.logs.iter() {
            let (s, sd, txt, ab) = x.quad();
            if s > since && (sd.is_none() || me.is_none() || sd == me) {
                log.push(if ab.is_none() || me.is_none() || ab == me { txt } else { Val::from("Ennemi : ") + txt });
            }
        }
        let out = dict! {"bid" => &self.bid, "seq" => self.seq, "phase" => &self.phase, "speed" => self.speed,
            "clock" => py::round(self.clock), "hour" => fmt_hour(self.clock + h_off.f()), "h_off" => &h_off,
            "weather" => &self.weather, "season" => &self.season, "light" => py::round_n(self.light, 2), "wind" => &self.wind,
            "me" => &me, "sides" => sides, "units" => units, "dusk" => py::round(self.dusk), "title" => self.spec.get("title"),
            "place" => self.spec.get("place_name"),
            "skirmish" => self.spec.get("skirmish").truthy(), // mode Bataille : « Retour au menu »
            "breaches" => &self.breaches,                     // brèches ouvertes au canon pendant la bataille
            "bati" => bati,                                   // maisons touchées, en feu, en ruine
            "barr" => &self.barr, "barr_t" => barr_t,         // barricades
            "fx" => fx, "log" => Val::list(log)};
        if self.phase == "deploiement" && tup![0, 1].has(&me) {
            out.set("zone", self.zone(me.i()));
        }
        if self.accel {
            // « Finir automatiquement » : les officiers commandent, la bataille défile ; seuls les derniers effets
            // partent (les autres ont eu lieu trop vite pour être vus)
            out.set("accel", true);
            out.set("accel_t", py::round(self.accel_t));
            out.set("fx", out.at("fx").slice(Some(-ACCEL_FX), None));
        }
        if self.objective().truthy() {
            out.set("objective", self.objective().to_list());
            out.set("hold", py::round(self.hold_t));
            out.set("hold_need", py::round(HEART_HOLD));
        }
        if self.phase == "fin" && self.result.truthy() {
            out.set("result", self.result_view(&me));
        }
        out
    }

    /// Python (battle.py, l. 3291-3327) : `def result_view(self, me)`
    /// me : 0, 1 ou None (alors vu du camp 0). Rend un dict.
    pub fn result_view(&self, me: &Val) -> Val {
        let r = &self.result;
        let m = if me.is_none() { 0 } else { me.i() };
        let won = r.at("winner") == m;
        let title = if !r.atb("disengage") {
            if won {
                "Victoire"
            } else {
                "Défaite"
            }
        } else if won {
            "L'ennemi décroche"
        } else {
            "Retraite"
        };
        let h_off = self.spec.get_or("h_off", 0.0).f();
        let lines = list![r.at("why"), format!("Bataille terminée à {}.", fmt_hour(self.clock + h_off))];
        if self.accel && tup![0, 1].has(me) {
            lines.push(format!("Vos officiers ont mené la bataille à partir de {}.", fmt_hour(self.accel_t)));
        }
        let names = self.spec.at("names");
        let (lost, pris) = (r.at("lost"), r.at("prisoners"));
        lines.push(format!(
            "Pertes : {} {}, {} {}.",
            names.at(m),
            py::int_v(&lost.at(m)),
            names.at(1 - m),
            py::int_v(&lost.at(1 - m))
        ));
        if pris.at(1 - m).truthy() || pris.at(m).truthy() {
            lines.push(format!("Prisonniers faits : {} ; perdus : {}.", py::int_v(&pris.at(1 - m)), py::int_v(&pris.at(m))));
        }
        // expérience réellement gagnée : celle de la bataille, au moins les +8 que la campagne donne aux vainqueurs
        let mut per = vec![];
        for (k, v) in r.at("units").items() {
            let u = self.by_id.at(&k);
            if u.at("side") != m || est(&u.at("cls"), &["general", "chariot"]) || u.at("type") == "milice" {
                continue;
            }
            let gain = if r.at("winner") == m { max2(v.atf("xp"), 8.0) } else { v.atf("xp") };
            per.push(dict! {"id" => k, "name" => u.at("name"), "lost" => py::int_v(&v.at("lost")), "xp" => py::round(gain)});
        }
        let xp = if per.is_empty() {
            Val::from(0)
        } else {
            Val::from(py::round_n(per.iter().map(|p| p.ati("xp")).sum::<i64>() as f64 / per.len() as f64, 1))
        };
        let out = dict! {"winner" => r.at("winner"), "won" => won, "disengage" => r.at("disengage"), "title" => title, "lines" => lines,
            "losses" => list![list![py::int_v(&lost.at(m)), py::int_v(&lost.at(1 - m))]],
            "prisoners" => list![py::int_v(&pris.at(m)), py::int_v(&pris.at(1 - m))], "xp" => xp, "units" => Val::list(per)};
        if self.spec.get("mode") == "ordres" {
            // « Donner mes ordres » : les pertes par arme des deux camps, et ce qui a décidé la journée (le journal de
            // ses officiers)
            let arms: Val = [("inf", "Infanterie"), ("cavalerie", "Cavalerie"), ("artillerie", "Artillerie")]
                .iter()
                .map(|(c, lab)| {
                    let l = list![*lab];
                    for s in [m, 1 - m] {
                        let p = py::sum(
                            self.units
                                .iter()
                                .filter(|u| u.at("side") == s && u.at("cls") == *c)
                                .map(|u| u.atf("men0") - max2(0.0, u.atf("men"))),
                        );
                        l.push(py::int(p));
                    }
                    l
                })
                .collect();
            out.set("arms", arms);
            let j = self.ai_mem.get(format!("s{m}")).or(dict! {}).get("journal").or(list![]);
            let keys = [
                "feinte", "masse", "débordement", "tournante", "raid", "brèche", "contre-attaque", "percée", "assaut général", "presse",
                "poursuite", "décroche", "fausse retraite", "réserve", "grande batterie",
            ];
            let dec: Val = j
                .iter()
                .map(|e| e.pair().1)
                .filter(|txt| keys.iter().any(|k| txt.has(*k)))
                .collect();
            out.set("decisive", dec.slice(Some(-5), None));
        }
        out
    }

    /// Python (battle.py, l. 3329-3336) : `def map_view(self)`
    /// `self.map.to_client(&self.spec)` plus nbreach, bati, barr, piet.
    pub fn map_view(&self) -> Val {
        let d = self.map.to_client(&self.spec);
        d.set("nbreach", self.breaches.len()); // (déjà dans les remparts envoyés : le client ne les rajoute pas)
        let bati: Val = self.bati.iter().enumerate().filter(|(_, &e)| e != 0).map(|(c, &e)| list![c, e]).collect();
        d.set("bati", bati); // état des maisons (SPEC-2D § 5), au chargement
        d.set("barr", &self.barr); // (leurs cases sont déjà dans t)
        if self.piet.truthy() {
            d.set("piet", &self.piet); // la boue laissée par les troupes (SPEC-SUITE F8), redessinée au rechargement
        }
        d
    }

    // ================================================================== sauvegarde
    /// Python (battle.py, l. 3339-3348) : `def to_dict(self)`
    /// Rend le dict de la sauvegarde ; spec, ai_sides, withdrawing, ai_mem, pound… y sont les objets mêmes de la
    /// bataille (pas des copies).
    pub fn to_dict(&self) -> Val {
        let units: Val = self.units.iter().map(|u| U::to_dict(&u)).collect();
        let logs: Val = self.logs.slice(Some(-60), None).iter().map(|x| x.to_list()).collect();
        let smoke = if self._smoke_on { self.smoke.iter().map(|&v| Val::from(py::round_n(v, 2))).collect() } else { Val::None };
        dict! {"spec" => &self.spec, "units" => units, "phase" => &self.phase, "clock" => self.clock, "speed" => self.speed,
            "seq" => self.seq, "logs" => logs, "ai_sides" => &self.ai_sides, "withdrawing" => &self.withdrawing,
            "withdraw_t" => &self.withdraw_t, "hold_t" => self.hold_t, "siege_t" => &self.siege_t, "prisoners" => &self.prisoners,
            "acc" => self._acc, "ai_mem" => &self.ai_mem, "result" => &self.result, "pound" => &self.pound,
            "breaches" => &self.breaches, "breach_t" => &self.breach_t, "bati" => &self.bati_log, "barr" => &self.barr,
            "barr_log" => &self.barr_log, "accel" => self.accel, "accel_ids" => &self.accel_ids, "accel_t" => self.accel_t,
            "replay" => &self.replay, "ask" => &self.ask, "end" => list![&self.winner, &self.disengage, &self.why],
            "piet" => &self.piet, "weather" => &self.weather, "wx" => list![&self.wx_at, &self.wx_next], "smoke" => smoke}
    }

    /// Python (battle.py, l. 3350-3394) : `def from_dict(cls, geo, d)`
    /// Méthode de classe : `TacticalBattle::from_dict(geo, &d)`. Repasse par `new` (la carte se refait de la
    /// graine, self.rng repart de sa graine), puis rejoue les journaux (bati, brèches, barricades).
    /// SIGNATURE CHANGÉE : rend `Err(message)` si la sauvegarde est illisible, comme l'exception que
    /// bridge.load_from rattrape (`except Exception`) : toute erreur de lecture (une panique du socle : KeyError,
    /// TypeError…) est rattrapée ici.
    pub fn from_dict(geo: Rc<GeoMap>, d: &Val) -> Result<TacticalBattle, String> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| Self::_from_dict(geo, d))).map_err(|e| {
            e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
        })
    }

    fn _from_dict(geo: Rc<GeoMap>, d: &Val) -> TacticalBattle {
        let units: Val = d.at("units").iter().map(|x| U::from_dict(&x)).collect();
        let mut tb = TacticalBattle::new(geo, &d.at("spec"), &units, &d.get_or("ai_sides", tup![0, 1]));
        tb.phase = d.get_or("phase", "combat").string();
        tb.clock = d.get_or("clock", 0.0).f();
        tb.speed = py::int_v(&d.get_or("speed", 1));
        tb.seq = d.get_or("seq", 0).i();
        tb.logs = d
            .get_or("logs", list![])
            .iter()
            .map(|x| {
                let mut v = x.vec();
                while v.len() < 4 {
                    v.push(Val::None);
                }
                Val::tuple(v)
            })
            .collect();
        tb.withdrawing = d.get_or("withdrawing", list![false, false]);
        tb.withdraw_t = d.get_or("withdraw_t", list![0.0, 0.0]);
        tb.hold_t = d.get_or("hold_t", 0.0).f();
        tb.siege_t = d.get("siege_t");
        tb.prisoners = d.get_or("prisoners", list![0.0, 0.0]);
        tb._acc = d.get_or("acc", 0.0).f();
        tb.ai_mem = d.get("ai_mem").or(dict! {});
        tb.result = d.get("result");
        tb.piet = if valid_piet(&d.get("piet")) { d.get("piet") } else { Val::None }; // (anciennes sauvegardes : un sol neuf)
        tb.accel = d.getb("accel"); // (anciennes sauvegardes : pas d'accéléré)
        tb.accel_ids = d.get("accel_ids").or(list![]).to_list();
        tb.accel_t = d.get_or("accel_t", 0.0).f();
        tb.replay = d.get("replay");
        tb.ask = d.get("ask");
        if d.getb("weather") {
            // (le temps a pu tourner depuis le début ; anciennes sauvegardes : celui du début)
            tb.weather = d.ats("weather");
            let (a, n) = d.get("wx").or(tup![Val::None, Val::None]).pair();
            tb.wx_at = a;
            tb.wx_next = n;
        }
        if d.getb("smoke") && d.at("smoke").len() == tb.smoke.len() {
            tb.smoke = d.at("smoke").iter().map(|v| v.f()).collect();
            tb._smoke_on = true;
        }
        tb.pound = d.get("pound").or(dict! {}).copy();
        tb.breach_t = d.get("breach_t").or(list![]).iter().map(|x| x.to_list()).collect();
        let dans = |x: &Val| x.at(1) >= 0 && x.at(1) < N;
        tb.bati_log = d.get("bati").or(list![]).iter().filter(dans).map(|x| x.to_list()).collect(); // (anciennes sauvegardes : intact)
        for x in tb.bati_log.iter() {
            let (_s, c, e, t0) = x.quad();
            tb._bati_mark(c.i(), e.i(), t0.f());
        }
        for x in d.get("breaches").or(list![]).iter() {
            let (wi, x, y, r) = x.quad();
            tb._apply_breach(wi.i(), x.f(), y.f(), r.f());
        }
        tb.barr = d.get("barr").or(list![]).to_list(); // (anciennes sauvegardes : pas de barricade)
        tb.barr_log = d.get("barr_log").or(list![]).iter().filter(dans).map(|x| x.to_list()).collect();
        for x in tb.barr_log.iter() {
            let (_s, c, t, prev) = x.quad();
            tb._barr_mark(c.i(), t.i(), prev.i());
        }
        let e = d.get("end").or(list![Val::None, Val::None, Val::None]);
        if e.at(0).is_some() {
            let (w, dis, why) = e.triple();
            tb.winner = w;
            tb.disengage = dis;
            tb.why = why;
        }
        let left = tb.dusk - tb.clock;
        tb.light = if left > 3600.0 { 1.0 } else { max2(0.15, 0.15 + 0.85 * left / 3600.0) };
        tb._update_vision();
        tb
    }
}
