//! Porte game/engine.py, lignes 3612 à 4376 : prise d'une place, usure et ravitaillement, fleuves (feu des berges, blocus), espions, impôts et ordre public, ordres du joueur.
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::batailles::{py_max, py_min, somme};
use super::*;
use crate::diplomacy as D;

/// `float(v)` d'une valeur venue du navigateur. Le serveur Python rattrapait l'exception (ValueError, TypeError) et
/// répondait « Commande invalide (…) » : même réponse ici, au lieu d'un arrêt.
fn float_cmd(v: &Val) -> Result<f64, String> {
    match v {
        Val::Str(s) => s
            .trim()
            .parse()
            .map_err(|_| format!("Commande invalide (could not convert string to float: {}).", v.repr())),
        Val::Int(_) | Val::Float(_) | Val::Bool(_) => Ok(v.f()),
        _ => Err(format!("Commande invalide (float() argument must be a string or a real number, not '{}').", v.type_name())),
    }
}

/// `', '.join(…)` de textes.
fn joindre(v: impl IntoIterator<Item = String>) -> String {
    v.into_iter().collect::<Vec<_>>().join(", ")
}

impl Game {
    // ------------------------------------------------------------------ prise d'une place
    /// Python : `capture(self, nid, code, peaceful=False)`.
    // engine.py, lignes 3613 à 3678
    pub fn capture(&mut self, nid: i64, code: &str, peaceful: bool) {
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        let old = n.ats("owner");
        if old == code {
            return;
        }
        AA::on_capture(self, nid);
        n.set("owner", code);
        n.set("assim", if gn.at("dept") == code { 1.0 } else if peaceful { 0.3 } else { 0.0 });
        n.set("stab", if peaceful { 0.6 } else { 0.35 });
        n.set("garrison", list![]);
        n.set("queue", list![]);
        n.set("siege", Val::None);
        for b in self.armies.values() {
            // (ses assiégeants ne restent pas en siège devant une place qui n'en est plus)
            if b.at("at_node") == nid && b.at("state") == "siege" {
                b.set("state", if b.atb("path") { "move" } else { "idle" });
            }
        }
        if !peaceful && n.at("dev") > 0i64 && old != R::NEUTRAL && self.rng.random() < 0.35 {
            n.dec("dev", 1);
            let mm = &n.at("milice_max") - &(&R::NODE_BASE().at(gn.at("type")).at("milice") * 0.15);
            n.set("milice_max", py_max(20.0, mm));
        }
        let mut lost = 0.0;
        if !peaceful && n.has("pop") {
            // pillage : on saccage d'autant plus la ville qu'elle a résisté ; une partie des habitants s'enfuit
            // chez son ancien maître et gagne ses places sûres le mois suivant
            let k = R::POP_SACK + R::POP_SACK_FORT * n.atf("fort");
            let pop = n.atf("pop");
            lost = pop * (if k < 0.15 { k } else { 0.15 });
            let plafond = pop - self.pop_norm(&n) * R::POP_FLOOR_SIEGE;
            let l = if plafond < lost { plafond } else { lost };
            lost = if l > 0.0 { l } else { 0.0 };
            n.dec("pop", lost);
            if self.factions.has(old.as_str()) && self.factions.at(old.as_str()).atb("alive") {
                let fo = self.factions.at(old.as_str());
                fo.set("refu", &fo.get_or("refu", 0.0) + lost * R::POP_REFUGE);
            }
        }
        let breached = !peaceful && self.lose_fort_level(nid);
        let (gx, gy, name) = (gn.at("x"), gn.at("y"), gn.ats("name"));
        if n.getb("depot") {
            n.set("depot", 0);
            if self.factions.has(code) {
                self.factions.at(code).at("res").inc("vivres", 150);
            }
            if self.player == code || self.player == old {
                let t = format!("Le magasin aux vivres de {name} est pillé par {}.", self.fname(code));
                self.log("eco", &t, &dict! {"x" => &gx, "y" => &gy, "who" => code});
            }
        }
        n.set("milice", &n.at("milice_max") * (if peaceful { 0.5 } else { 0.15 }));
        self._dirty_income = true;
        if self.factions.has(code) {
            self.factions.at(code).at("stats").inc("captured", 1);
        }
        if self.factions.has(old.as_str()) {
            let rel = self.factions.at(old.as_str()).at("rel");
            rel.set(code, py_max(-100, &rel.at(code) - 12));
        }
        let sack = if lost >= 50.0 {
            format!(" Pillage : {} habitants fuient ou périssent.", R::nb(py::round_n(lost, -1)))
        } else {
            String::new()
        };
        let mains = R::de(&self.fname(code));
        let joueur = code == self.player || old == self.player;
        if breached && joueur {
            let t = format!("{name} tombe aux mains {mains} ; ses remparts éventrés retombent au niveau {}.{sack}", n.at("fort"));
            self.log("capture", &t, &dict! {"x" => &gx, "y" => &gy, "who" => code, "important" => true});
        } else if !peaceful && joueur {
            let t = format!("{name} tombe aux mains {mains}.{sack}");
            self.log("capture", &t, &dict! {"x" => &gx, "y" => &gy, "who" => code, "important" => true});
        } else if !peaceful {
            let t = format!("{name} tombe aux mains {mains}.");
            self.log("capture", &t, &dict! {"x" => &gx, "y" => &gy, "who" => code});
        }
        // pénalité pour l'expansion près des voisins
        if old == R::NEUTRAL && self.factions.has(code) {
            for o in self.factions.keys() {
                if o != code && gn.at("dept") == o {
                    let rel = self.factions.at(&o).at("rel");
                    rel.set(code, py_max(-100, &rel.at(code) - 3));
                }
            }
        }
        if gn.at("type") == "capitale" && self.factions.has(old.as_str()) && gn.at("dept") == old {
            let lf = self.factions.at(old.as_str());
            let left = self.owned_nodes(&old).len() as i64;
            let crushed = py_max(3, &lf.at("start_nodes") * R::TREATY_CRUSHED);
            let tr = lf.get_or("treaties", dict! {}).get_or(code, -1e9);
            // (un théâtre : une seconde défaite face au même vainqueur n'est fatale qu'à un pays déjà réduit de moitié ; la
            // France qui garde soixante places signe un traité, elle ne passe pas tout entière à l'Angleterre)
            let encore = self.t - tr.f() < R::TREATY_AGAIN as f64 && (!self.theatre() || Val::from(left) <= &lf.at("start_nodes") * 0.5);
            if Val::from(left) <= crushed || encore || !self.factions.has(code) {
                self.capitulate(&old, code);
            } else {
                self.treaty(&old, code, nid);
            }
        }
        self.check_end();
    }

    /// Le chef-lieu est tombé : le vaincu signe la paix, cède les places que le vainqueur occupe, paie un tribut
    /// et récupère son chef-lieu. Il peut se relever ; une seconde défaite face au même vainqueur avant 25 ans lui sera fatale.
    /// Python : `treaty(self, loser, winner, cap)`.
    /// cap : le numéro du chef-lieu tombé.
    // engine.py, lignes 3680 à 3718
    pub fn treaty(&mut self, loser: &str, winner: &str, cap: i64) {
        let (lf, wf) = (self.factions.at(loser), self.factions.at(winner));
        let n = self.nodes.at(cap);
        let gn = self.geo.nodes.at(cap);
        n.set("owner", loser);
        n.set("assim", 1.0);
        n.set("siege", Val::None);
        n.set("garrison", list![]);
        n.set("milice", &n.at("milice_max") * 0.4);
        for a in self.armies.values() {
            if a.at("at_node") == cap && a.at("owner") != loser && a.at("state") != "battle" {
                self.retreat(&a); // l'occupant évacue la ville rendue
            }
        }
        let ceded = self
            .nodes
            .iter()
            .filter(|x| x.at("owner") == winner && self.geo.nodes.at(x.at("id")).at("dept") == loser)
            .count();
        let livres = lf.at("res").atf("livres");
        let l0 = if 0.0 < livres { livres } else { 0.0 };
        let mut pay = py::int(l0 * 0.4) + 150;
        let plafond = py::int(l0);
        if plafond < pay {
            pay = plafond;
        }
        lf.at("res").dec("livres", pay);
        wf.at("res").inc("livres", pay);
        D::make_peace(self, winner, loser);
        let until = TT::deadline(self, R::TREATY_TRUCE, &[winner, loser]);
        lf.at("truce").set(winner, until);
        wf.at("truce").set(loser, until);
        lf.setdefault("treaties", dict! {}).set(winner, self.t); // le même vainqueur n'accorde pas deux traités en 25 ans
        lf.set("weary", py_max(0.0, &lf.get_or("weary", 0) - 40));
        let rel = lf.at("rel");
        rel.set(winner, py_max(-100, &rel.at(winner) - 20));
        // le congrès règle aussi les autres guerres du vaincu : sans cela, ses voisins l'achèvent en quelques semaines
        let others: Vec<String> = self
            .factions
            .items()
            .into_iter()
            .filter(|(o, f)| f.atb("alive") && o != loser && o != winner && self.at_war(o.s(), loser))
            .map(|(o, _)| o.string())
            .collect();
        for o in &others {
            D::make_peace(self, o, loser);
            let until = TT::deadline(self, R::TREATY_CONGRESS, &[o, loser]);
            let v = py_max(until, lf.at("truce").get_or(o, 0));
            lf.at("truce").set(o, &v);
            self.factions.at(o).at("truce").set(loser, &v);
        }
        self._dirty_income = true;
        let cede = if ceded > 0 {
            format!("cède {} à {} et lui verse", R::pl(ceded, "place", None), self.fname(winner))
        } else {
            format!("verse à {}", self.fname(winner))
        };
        let mut t = format!("Traité {} : {} {cede} {pay} livres. Trêve de cinq ans.", R::de(&gn.ats("name")), self.fname(loser));
        if !others.is_empty() {
            t += &format!(
                " Le congrès rétablit aussi la paix avec {} pour deux ans.",
                joindre(others.iter().map(|o| self.fname(o)))
            );
        }
        self.log("capitulation", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => winner, "important" => true});
        self.alert_pause(true);
    }

    /// Chaque année, un pays absorbé depuis dix ans peut se soulever et recouvrer sa liberté si son ancien
    /// chef-lieu, mal tenu, n'a pas oublié qui il était.
    /// Python : `uprisings(self)`.
    // engine.py, lignes 3720 à 3762
    pub fn uprisings(&mut self) {
        for (code_v, f) in self.factions.items() {
            let code = code_v.string();
            if f.atb("alive") || code == self.player || self.t - f.get_or("dead_t", self.t).f() < (R::REVIVE_YEARS * 365) as f64 {
                continue;
            }
            let cap = self
                .nodes
                .iter()
                .find(|n| {
                    let gn = self.geo.nodes.at(n.at("id"));
                    gn.at("type") == "capitale" && gn.at("dept") == code
                })
                .expect("StopIteration");
            let owner = cap.ats("owner");
            if !self.factions.has(owner.as_str()) || cap.get_or("assim", 1.0) >= 0.6 {
                continue;
            }
            let held = Val::set_from(
                self.armies
                    .values()
                    .into_iter()
                    .filter(|a| a.at("owner") == owner && a.at("at_node").is_some())
                    .map(|a| a.at("at_node"))
                    .collect(),
            );
            let ow = self.factions.at(owner.as_str());
            if held.has(&cap.at("id"))
                || cap.atb("garrison")
                || cap.atb("siege")
                || self.rng.random() > 0.25 + ow.get_or("weary", 0).f() / 200.0
            {
                continue;
            }
            let mut freed: Vec<(String, Val)> = vec![];
            for n in self.nodes.iter() {
                let no = n.at("owner");
                if self.geo.nodes.at(n.at("id")).at("dept") != code
                    || no == code
                    || no == R::NEUTRAL
                    || n.get_or("assim", 1.0) >= 0.6
                {
                    continue;
                }
                if n.at("id") != cap.at("id") && (held.has(&n.at("id")) || n.atb("garrison") || n.atb("siege")) {
                    continue;
                }
                let o = no.string();
                let milice = &n.at("milice_max") * 0.6;
                n.update(&dict! {"owner" => &code, "assim" => 1.0, "stab" => 0.8, "queue" => list![], "depot" => 0, "milice" => milice});
                freed.push((o, n));
            }
            f.update(&dict! {
                "alive" => true, "overlord" => Val::None, "trade" => dict! {}, "war_since" => dict! {}, "prisoners" => dict! {},
                "weary" => 0.0, "treaties" => dict! {}, "last_war" => self.t,
                "res" => dict! {"livres" => 400, "vivres" => 400, "fer" => 60, "bois" => 100, "armes" => 150, "outils" => 30, "recrues" => 800}
            });
            for o in self.factions.keys() {
                if o != code {
                    self.set_status(&code, o.s(), "paix");
                    f.at("rel").set(&o, 0);
                }
            }
            // {o for o, _ in freed} : un set de textes (son ordre ne compte pas : deadline ne regarde que le joueur)
            let mut anciens: Vec<String> = vec![];
            for (o, _) in &freed {
                if !anciens.contains(o) {
                    anciens.push(o.clone());
                }
            }
            let mut who: Vec<&str> = vec![code.as_str()];
            who.extend(anciens.iter().map(String::as_str));
            let until = TT::deadline(self, 36, &who); // (trois ans) l'ancien maître, épuisé, laisse faire... pour un temps
            for o in &anciens {
                f.at("truce").set(o, until);
                self.factions.at(o).at("truce").set(&code, until);
                f.at("rel").set(o, -40);
                self.factions.at(o).at("rel").set(&code, -40);
            }
            self._dirty_income = true;
            let gn = self.geo.nodes.at(cap.at("id"));
            let t = format!(
                "Soulèvement {} : {} recouvre sa liberté et chasse {} de {}. Trêve de trois ans.",
                R::de(&gn.ats("name")),
                self.fname(&code),
                self.fname(&owner),
                R::pl(freed.len(), "place", None)
            );
            self.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &code, "important" => true});
            if owner == self.player {
                self.alert_pause(true);
            }
        }
    }

    /// Python : `capitulate(self, loser, winner)`.
    /// winner : peut être R::NEUTRAL.
    // engine.py, lignes 3764 à 3800
    pub fn capitulate(&mut self, loser: &str, winner: &str) {
        let lf = self.factions.at(loser);
        if !lf.atb("alive") {
            return;
        }
        lf.set("alive", false);
        lf.set("dead_t", self.t);
        lf.set("prisoners", dict! {});
        for f in self.factions.values() {
            let p = f.get("prisoners");
            if p.is_dict() {
                p.pop(loser);
            }
        }
        for n in self.nodes.iter() {
            if n.at("owner") == loser {
                n.set("owner", winner);
                if self.geo.nodes.at(n.at("id")).at("dept") != winner {
                    n.set("assim", 0.0); // le pays absorbé garde le souvenir de sa liberté
                }
                n.set("stab", 0.4);
                n.set("milice", &n.at("milice_max") * 0.2);
                n.set("garrison", list![]);
                n.set("queue", list![]);
                n.set("siege", Val::None);
            }
        }
        let ids: Vec<Val> = self.armies.values().into_iter().filter(|a| a.at("owner") == loser).map(|a| a.at("id")).collect();
        for aid in ids {
            let a = self.armies.pop(&aid);
            if a.atb("battle") && self.battles.has(&a.at("battle")) {
                for s in self.battles.at(a.at("battle")).at("sides").iter() {
                    if s.at("armies").has(&aid) {
                        s.at("armies").remove(&aid);
                    }
                }
            }
        }
        for f in self.factions.values() {
            f.at("trade").pop(loser);
            if f.at("overlord") == loser {
                f.set("overlord", Val::None);
            }
        }
        lf.set("trade", dict! {});
        for o in self.factions.keys() {
            if o != loser {
                self.set_status(loser, o.s(), "paix");
            }
        }
        self._dirty_income = true;
        self.alert_pause(true);
        let t = format!("{} capitule ! Ses villes passent à {}.", self.fname(loser), self.fname(winner));
        self.log("capitulation", &t, &dict! {"who" => winner, "important" => true});
    }

    /// Python : `check_era(self, d)`.
    // engine.py, lignes 3802 à 3815
    pub fn check_era(&mut self, d: Date) {
        if !self.era_id.truthy() {
            self.era_id = self.era().at("id");
        }
        if d == Date::de(&R::DEPT_DATE()) && self.t > 0.5 && !self.theatre() {
            self.log(
                "info",
                "4 mars 1790 : l'Assemblée crée les départements. Les provinces deviennent la Gironde, \
                 la Dordogne, les Landes, le Lot-et-Garonne et les Basses-Pyrénées.",
                &dict! {"important" => true},
            );
            self.alert_pause(true);
        }
        let e = self.era();
        if e.at("id") != self.era_id {
            self.era_id = e.at("id");
            let t = format!("Nouvelle époque : {}. {}", e.at("name"), e.at("desc"));
            self.log("epoque", &t, &dict! {"important" => true});
            self.alert_pause(true);
        }
        if d >= Date::de(&R::CAMPAIGN_END()) && !self.over.truthy() {
            self.end_campaign();
        }
    }

    /// Rayonnement actuel d'un camp, par rubrique : la paix et le développement comptent autant que la guerre.
    /// Python : `prestige_parts(self, code)`.
    /// Rend dict(territoire, population, richesse, villes, savoir, armes, histoire).
    // engine.py, lignes 3817 à 3831
    pub fn prestige_parts(&self, code: &str) -> Val {
        let f = self.factions.at(code);
        if !f.atb("alive") {
            return dict! {"territoire" => 0, "population" => 0, "richesse" => 0, "villes" => 0, "savoir" => 0, "armes" => 0, "histoire" => 0};
        }
        let mine = self.owned_nodes(code);
        let caps = mine.iter().filter(|n| self.geo.nodes.at(n.at("id")).at("type") == "capitale").count() as i64;
        let livres = f.at("res").atf("livres");
        let inc = f.at("income").get_or("livres", 0).f();
        let rich = (if 0.0 < livres { livres } else { 0.0 }) / 1500.0;
        let st = f.at("stats");
        dict! {
            "territoire" => mine.len() as i64 * 3 + caps * 25,
            "population" => py::sum_v(mine.iter().map(|n| py_min(n.get_or("pop", 0), 25000))) / 4000,   // une métropole ne fait pas tout
            "richesse" => (if rich < 40.0 { rich } else { 40.0 }) + (if 0.0 < inc { inc } else { 0.0 }) * 0.25,
            "villes" => &(&py::sum_v(mine.iter().map(|n| n.at("dev"))) * 4 + &py::sum_v(mine.iter().map(|n| n.at("fort"))) * 2)
                + CT::prestige(&mine),
            "savoir" => f.at("techs").len() as i64 * 3,
            "armes" => &(&st.at("won") * 2) + &(&st.at("captured") * 0.5),
            "histoire" => f.get_or("glory", 0.0)
        }
    }

    /// Python : `prestige_now(self, code)`.
    // engine.py, lignes 3833 à 3834
    pub fn prestige_now(&self, code: &str) -> f64 {
        py::sum_v(self.prestige_parts(code).values()).f()
    }

    /// Prestige total : la gloire accumulée année après année, plus le rayonnement présent.
    /// Python : `prestige(self, code)`.
    // engine.py, lignes 3836 à 3839
    pub fn prestige(&self, code: &str) -> i64 {
        let f = self.factions.at(code);
        if f.atb("alive") { py::int((&f.get_or("prestige", 0.0) + self.prestige_now(code)).f()) } else { 0 }
    }

    /// Python : `end_campaign(self)`.
    // engine.py, lignes 3841 à 3849
    pub fn end_campaign(&mut self) {
        let ranks = py::sorted_by_key(self.factions.keys(), |c| -self.prestige(c.s()));
        let first = ranks[0].string();
        let win = first == self.player || self.factions.at(&first).at("overlord") == self.player;
        let text = if win {
            format!("Le siècle s'achève : votre {} est le plus prestigieux {}.", self.dept_word(), self.pays_de())
        } else {
            format!("Le siècle s'achève : {} est le plus prestigieux {}.", self.fname(&first), self.pays_de())
        };
        self.over = dict! {"result" => if win { "victoire" } else { "defaite" }, "t" => self.t, "text" => &text};
        self.speed_idx = 0;
        self.log("fin", &text, &dict! {"important" => true});
    }

    /// Python : `check_end(self)`.
    // engine.py, lignes 3851 à 3873
    pub fn check_end(&mut self) {
        if self.over.truthy() {
            return;
        }
        let p = self.player.clone();
        if !self.factions.at(&p).atb("alive") || self.nodes.at(self.capital_of(&p)).at("owner") != p {
            let text = format!(
                "Votre {} a été {} de la carte : la partie est perdue.",
                self.dept_word(),
                if self.departements() || self.theatre() { "rayé" } else { "rayée" }
            );
            self.over = dict! {"result" => "defaite", "t" => self.t, "text" => &text};
            self.speed_idx = 0;
            self.log("fin", &text, &dict! {"important" => true});
            return;
        }
        let mut ok = true;
        for code in self.factions.keys() {
            let cap = self.capital_of(code.s());
            let o = self.nodes.at(cap).at("owner");
            if o == p || (self.factions.has(&o) && self.factions.at(&o).at("overlord") == p) {
                continue;
            }
            ok = false;
        }
        if ok {
            let years = self.t / 365.25;
            let tout = self.geo.theatre.map_or("Toute l'Aquitaine", |t| t.tout);
            let text = format!("{tout} reconnaît votre autorité ({years:.1} ans de campagne).");
            self.over = dict! {"result" => "victoire", "t" => self.t, "text" => &text};
            self.speed_idx = 0;
            self.log("fin", &text, &dict! {"important" => true});
        }
    }

    // ------------------------------------------------------------------ usure, ravitaillement
    /// Magasin aux vivres (à soi ou à un allié) assez proche pour ravitailler l'armée, sinon None.
    /// depots : les places à magasin hors siège, déjà relevées (même ordre que self.nodes).
    /// Python : `depot_near(self, a, depots=None)`.
    /// depots : None (toutes les places) ou une liste de places. Rend un numéro de place, ou None.
    // engine.py, lignes 3876 à 3886
    pub fn depot_near(&self, a: &Val, depots: &Val) -> Val {
        let (mut best, mut bd) = (Val::None, py::pow(R::DEPOT_KM, 2.0));
        let ao = a.ats("owner");
        let (ax, ay) = (a.atf("x"), a.atf("y"));
        for n in (if depots.is_none() { &self.nodes } else { depots }).iter() {
            if n.getb("depot") && !n.atb("siege") && self.friendly(&ao, &n.ats("owner")) {
                let (x, y) = self.node_xy(n.ati("id"));
                let d = py::pow(x - ax, 2.0) + py::pow(y - ay, 2.0);
                if d <= bd {
                    (best, bd) = (n.at("id"), d);
                }
            }
        }
        best
    }

    /// Python : `attrition(self, dt)`.
    // engine.py, lignes 3888 à 3984
    pub fn attrition(&mut self, dt: f64) {
        let season = self.season();
        let mut depots = Val::None; // places à magasin hors siège : relevées une fois, si une armée en cherche un
        for a in self.armies.values() {
            let code = a.ats("owner");
            let f = self.factions.at(code.as_str());
            let (ax, ay) = (a.atf("x"), a.atf("y"));
            let nd = self.geo.node_of_cell(ax, ay);
            let mut friendly_land = match nd {
                Some(nd) => {
                    let no = self.nodes.at(nd).ats("owner");
                    no == code || self.friendly(&code, &no)
                }
                None => false,
            };
            if a.getb("boat") {
                friendly_land = true; // les gabares emportent leurs vivres
            }
            let logi = self.gen_trait(&a) == "logisticien";
            a.set("depot", Val::None);
            let res = f.at("res");
            if !friendly_land && res.at("vivres") > 1i64 {
                if depots.is_none() {
                    depots = self.nodes.iter().filter(|n| n.getb("depot") && !n.atb("siege")).collect();
                }
                let dep = self.depot_near(&a, &depots);
                if dep.is_some() {
                    // les charrois du magasin suivent l'armée : ravitaillée, mais aux frais du grenier
                    a.set("depot", &dep);
                    let v = res.atf("vivres") - self.army_men(&a) / 100.0 * R::DEPOT_FOOD * dt;
                    res.set("vivres", py_max(0.0, v));
                }
            }
            if friendly_land {
                a.set("supply", py_min(1.0, &a.at("supply") + 0.3 * dt));
            } else if a.at("depot").is_some() {
                a.set("supply", py_min(1.0, &a.at("supply") + 0.15 * dt));
            } else {
                let k = if season == "hiver" { 1.8 } else if season == "été" || season == "automne" { 0.6 } else { 1.0 };
                // une gare proche
                let near = if RL::near_station(self, &code, ax, ay) { R::RAIL_STATION_DRAIN } else { 0.0 };
                let x = 1.0 + self.mod_(&code, "supply_drain", 0.0) + near;
                let v = &a.at("supply") - 0.035 * k * dt * (if logi { 0.5 } else { 1.0 }) * (if x > 0.2 { x } else { 0.2 });
                a.set("supply", py_max(0.0, v));
            }
            let mut rate = 0.0;
            if !a.atb("onroad") && a.at("at_node").is_none() {
                let ter = self.geo.terrain_at(ax, ay);
                let tname = TERRAIN().at(ter).ats(0);
                let tn = tname.as_str();
                let mut base = match tn {
                    "Marais" => 0.006,
                    "Montagne" => 0.004,
                    "Haute montagne" => 0.012,
                    "Forêt" => 0.0015,
                    "Lande" => 0.002,
                    "Dunes" => 0.002,
                    _ => 0.0005,
                };
                if tn == "Marais" || tn == "Lande" {
                    let x = 1.0 + self.mod_(&code, "marsh_attr", 0.0);
                    base *= if x > 0.0 { x } else { 0.0 };
                }
                if season == "hiver" {
                    base *= if tn == "Montagne" || tn == "Haute montagne" { 3.0 } else { 1.6 };
                }
                if tn == "Montagne" || tn == "Haute montagne" || tn == "Collines" {
                    let regs = a.at("regs").vec();
                    let men = py::sum_v(regs.iter().map(|r| r.at("n"))).or(1.0).f();
                    let share = somme(regs.iter().filter(|r| r.at("type") == "chasseurs").map(|r| r.at("n"))) / men;
                    base *= 1.0 - 0.7 * share; // les montagnards connaissent les cols
                }
                if season == "été" && tn == "Marais" {
                    base *= 1.5;
                }
                rate += base;
            }
            let unpaid = f.getb("banqueroute");
            let famine = f.getb("famine");
            let hungry = famine || a.atf("supply") < 0.35;
            if unpaid || hungry {
                let why = if unpaid {
                    "solde impayée"
                } else if famine {
                    "disette dans le pays"
                } else {
                    "ravitaillement épuisé"
                };
                a.set("des_why", why);
            }
            if a.atf("supply") < 0.35 {
                rate += 0.012;
            }
            if famine {
                rate += 0.012;
            }
            if self.weather.at(self.zone_of(ax, ay)).at("kind") == "canicule" && a.at("state") == "move" {
                rate += 0.002;
            }
            let x = 1.0 + self.mod_(&code, "attrition", 0.0);
            rate *= (if x > 0.2 { x } else { 0.2 }) * (if logi { 0.6 } else { 1.0 });
            // moral et désertions : une armée mal payée ou affamée fond
            if unpaid || hungry {
                let perte = (2.5 * unpaid as i64 as f64 + 2.5 * hungry as i64 as f64) * dt;
                for r in a.at("regs").iter() {
                    r.set("morale", py_max(5, &r.at("morale") - perte));
                }
            }
            let men = py::sum_v(a.at("regs").iter().map(|r| r.at("n")));
            if men > 0i64 && a.at("state") != "battle" {
                let mor = somme(a.at("regs").iter().map(|r| &r.at("n") * &r.at("morale"))) / men.f();
                let y = (45.0 - mor) / 45.0;
                let drate = (if y > 0.0 { y } else { 0.0 }) * 0.014 + (if unpaid { 0.003 } else { 0.0 });
                if drate > 0.0 {
                    let mut gone = 0.0;
                    for r in a.at("regs").iter() {
                        // pas de solde, pas de service
                        let m = if unpaid && R::MERCS().has(&r.at("type")) { 3.0 } else { 1.0 };
                        let g_ = r.atf("n") * drate * dt * m;
                        r.dec("n", g_);
                        gone += g_;
                    }
                    a.set("des", &a.get_or("des", 0.0) + gone);
                }
            }
            if rate > 0.0 {
                for r in a.at("regs").iter() {
                    r.dec("n", r.atf("n") * rate * dt);
                }
            }
            self.prune(&a);
            if a.at("state") == "idle" && !(unpaid || hungry) {
                if friendly_land {
                    let top = 100.0 + self.mod_(&code, "morale", 0.0);
                    for r in a.at("regs").iter() {
                        r.set("morale", py_min(top, &r.at("morale") + 5.0 * dt));
                    }
                    let an = a.at("at_node");
                    if an.is_some() && self.geo.nodes.at(&an).at("type") != "village" {
                        self.replenish(&code, &a.at("regs"), dt, R::REPL_ARMY);
                    }
                } else {
                    for r in a.at("regs").iter() {
                        let m = r.at("morale");
                        r.set("morale", py_max(&m, py_min(90, &m + 1.5 * dt)));
                    }
                }
            }
            if !a.atb("regs") {
                if a.atb("battle") && self.battles.has(&a.at("battle")) {
                    for s in self.battles.at(a.at("battle")).at("sides").iter() {
                        if s.at("armies").has(&a.at("id")) {
                            s.at("armies").remove(&a.at("id"));
                        }
                    }
                }
                self.armies.del(a.at("id"));
            }
        }
        TB::campaign_tick(self, dt); // munitions recomplétées, fatigue de la marche et du repos
        // sièges : les assiégeants s'usent aussi
        if !self.factions.at(self.player.as_str()).atb("alive") {
            self.check_end();
        }
    }

    // ------------------------------------------------------------------ fleuves : feu des berges, blocus
    /// Les gabares qui passent à portée de canons ennemis (armées ou forts riverains) essuient des pertes.
    /// Python : `river_fire(self, dt)`.
    // engine.py, lignes 3987 à 4035
    pub fn river_fire(&mut self, dt: f64) {
        // places à remparts (rien ne les change pendant ce pas) : relevées s'il y a des gabares en route
        let mut forts: Option<Vec<(Val, f64, f64)>> = None;
        for b in self.armies.values() {
            if !b.getb("boat") || b.at("at_node").is_some() || !b.atb("edge") || !b.atb("regs") {
                continue;
            }
            let e = self.geo.edges.at(b.at("edge").at("e"));
            if e.get("kind") != "water" || e.getb("sea") {
                continue;
            }
            let (mut fire, mut who) = (0.0, Val::None);
            let r2 = py::pow(R::RIVER_FIRE_KM, 2.0);
            let (bx, by) = (b.atf("x"), b.atf("y"));
            let bo = b.ats("owner");
            for x in self.armies.values() {
                if x.is(&b) || x.getb("boat") || x.at("state") == "battle" {
                    continue;
                }
                if py::pow(x.atf("x") - bx, 2.0) + py::pow(x.atf("y") - by, 2.0) > r2 || !self.at_war(&x.ats("owner"), &bo) {
                    continue;
                }
                let f = somme(x.at("regs").iter().map(|r| {
                    if r.at("type") == "artillerie" {
                        Val::from(1.0)
                    } else if Game::arm_class(r.at("type").s()) == "inf" {
                        Val::from(0.15)
                    } else {
                        Val::from(0)
                    }
                }));
                if f != 0.0 {
                    fire += f;
                    who = x.at("owner");
                }
            }
            let rn2 = py::pow(R::RIVER_FIRE_KM + 0.5, 2.0);
            if forts.is_none() {
                forts = Some(
                    self.nodes
                        .iter()
                        .filter(|n| n.at("fort") >= 1i64)
                        .map(|n| {
                            let (x, y) = self.node_xy(n.ati("id"));
                            (n, x, y)
                        })
                        .collect(),
                );
            }
            for (n, nx, ny) in forts.as_ref().unwrap() {
                let no = n.at("owner");
                if py::pow(nx - bx, 2.0) + py::pow(ny - by, 2.0) <= rn2 && self.factions.has(&no) && self.at_war(no.s(), &bo) {
                    fire += n.atf("fort");
                    who = no;
                }
            }
            if fire == 0.0 {
                b.set("_fire", false);
                continue;
            }
            let k = 0.12 * fire;
            let rate = if k < 0.4 { k } else { 0.4 };
            for r in b.at("regs").iter() {
                r.dec("n", r.atf("n") * rate * dt);
                r.set("morale", py_max(10, &r.at("morale") - 8.0 * dt));
            }
            b.set("regs", b.at("regs").iter().filter(|r| r.at("n") >= 5i64).collect::<Val>());
            if !b.getb("_fire") {
                b.set("_fire", true);
                let where_ = self.place_name(bx, by);
                if bo == self.player {
                    let t = format!("Les gabares de la {} essuient le feu de {} {where_} !", b.at("name"), self.fname(who.s()));
                    self.log("battle", &t, &dict! {"x" => b.at("x"), "y" => b.at("y"), "who" => &who, "important" => true});
                } else if who == self.player {
                    let t = format!("Vos canons prennent pour cible les gabares de {} {where_}.", self.fname(&bo));
                    self.log("battle", &t, &dict! {"x" => b.at("x"), "y" => b.at("y"), "who" => &who});
                }
            }
            if !b.atb("regs") {
                self.armies.del(b.at("id"));
                if bo == self.player {
                    let t = format!("La {} a sombré sous le feu ennemi.", b.at("name"));
                    self.log("battle_end", &t, &dict! {"x" => b.at("x"), "y" => b.at("y"), "important" => true});
                }
            }
        }
    }

    /// Un port ou un quai est bloqué si une place en aval, sur la route de la mer, est tenue par un ennemi.
    /// Python : `compute_blockades(self)`.
    // engine.py, lignes 4037 à 4059
    pub fn compute_blockades(&mut self) {
        let out = pyset![];
        for (nid, down) in self.geo.down_nodes.items() {
            let o = self.nodes.at(&nid).at("owner");
            if !self.factions.has(&o) {
                continue;
            }
            for d in down.iter() {
                let od = self.nodes.at(&d).at("owner");
                if self.factions.has(&od) && self.at_war(o.s(), od.s()) {
                    out.push(&nid);
                    break;
                }
            }
        }
        let old = self._blockade.clone();
        let au_joueur = |n: &i64| self.nodes.at(*n).at("owner") == self.player;
        let mut cut: Vec<i64> = out.iter().filter(|n| !old.has(n)).map(|n| n.i()).collect();
        cut.sort();
        let cut: Vec<Val> = cut.iter().filter(|n| au_joueur(n)).map(|n| self.geo.nodes.at(*n)).collect();
        let mut freed: Vec<i64> = old.iter().filter(|n| !out.has(n)).map(|n| n.i()).collect();
        freed.sort();
        let freed: Vec<Val> = freed.iter().filter(|n| au_joueur(n)).map(|n| self.geo.nodes.at(*n)).collect();
        let names = |gs: &[Val]| {
            joindre(gs.iter().take(4).map(|g| g.ats("name")))
                + &(if gs.len() > 4 { format!(" et {} autres", gs.len() - 4) } else { String::new() })
        };
        if !cut.is_empty() {
            let t = format!("Blocus : l'ennemi en aval coupe le commerce fluvial {}.", R::de(&names(&cut)));
            self.log("eco", &t, &dict! {"x" => cut[0].at("x"), "y" => cut[0].at("y"), "important" => true});
        }
        if !freed.is_empty() {
            let t = format!("Blocus levé pour {} : les gabares descendent de nouveau vers la mer.", names(&freed));
            self.log("eco", &t, &dict! {"x" => freed[0].at("x"), "y" => freed[0].at("y")});
        }
        self._blockade = out;
    }

    // ------------------------------------------------------------------ espions
    /// Python : `spy(self, code, nid, kind)`.
    /// kind : vient tel quel du navigateur ('espionner', 'saboter').
    // engine.py, lignes 4062 à 4084
    pub fn spy(&mut self, code: &str, nid: i64, kind: &Val) -> (bool, String) {
        if !R::SPY().has(kind) {
            return (false, "Mission inconnue.".to_string());
        }
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        let o = n.ats("owner");
        if o == code {
            return (false, "Cette place vous appartient déjà.".to_string());
        }
        if *kind == "saboter" {
            if o == R::NEUTRAL || !self.at_war(code, &o) {
                return (false, "Le sabotage n'est possible que contre un camp avec lequel vous êtes en guerre.".to_string());
            }
            if n.at("fort") <= 0i64 {
                return (false, "Cette place n'a pas de remparts à saboter.".to_string());
            }
        }
        if self.spies.iter().any(|s| s.at("by") == code && s.at("node") == nid) {
            return (false, "Un de vos agents est déjà en route pour cette place.".to_string());
        }
        let cost = R::SPY().at(kind).at("cost");
        let f = self.factions.at(code);
        if f.at("res").at("livres") < cost {
            return (false, "Livres insuffisantes.".to_string());
        }
        f.at("res").dec("livres", &cost);
        // rapport au tour suivant (une IA : en trois jours, comme avant)
        let done = if code == self.player { TT::deadline(self, 1, &[]) } else { self.t + 3.0 };
        self.spies.push(dict! {"by" => code, "node" => nid, "kind" => kind, "done" => done});
        (true, format!("Un agent part pour {} : son rapport au prochain tour.", gn.at("name")))
    }

    /// Python : `update_spies(self)`.
    // engine.py, lignes 4086 à 4094
    pub fn update_spies(&mut self) {
        if !self.spies.truthy() {
            return;
        }
        let t = self.t;
        let due: Vec<Val> = self.spies.iter().filter(|s| s.atf("done") <= t).collect();
        if due.is_empty() {
            return;
        }
        self.spies = self.spies.iter().filter(|s| s.atf("done") > t).collect();
        for s in due {
            self.resolve_spy(&s);
        }
    }

    /// Python : `resolve_spy(self, s)`.
    /// s : dict(by, node, kind, done).
    // engine.py, lignes 4096 à 4143
    pub fn resolve_spy(&mut self, s: &Val) {
        let (code, nid, kind) = (s.ats("by"), s.ati("node"), s.ats("kind"));
        let f = self.factions.get(code.as_str());
        if !f.truthy() || !f.atb("alive") {
            return;
        }
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        let o = n.ats("owner");
        if o == code {
            return;
        }
        let (gx, gy, name) = (gn.at("x"), gn.at("y"), gn.ats("name"));
        let sp = R::SPY().at(kind.as_str());
        let mut chance = sp.atf("chance") + (if f.at("techs").has("diplomates") { 0.1 } else { 0.0 });
        if self.factions.has(o.as_str()) && self.factions.at(o.as_str()).at("techs").has("chappe") {
            chance -= 0.15;
        }
        if kind == "saboter" && (o == R::NEUTRAL || !self.at_war(&code, &o) || n.at("fort") <= 0i64) {
            if code == self.player {
                self.log("espion", &format!("Mission annulée à {name} : la situation a changé."), &dict! {"x" => &gx, "y" => &gy});
            }
            f.at("res").inc("livres", &sp.at("cost") * 0.5);
            return;
        }
        if self.rng.random() < chance {
            if kind == "espionner" {
                let until = TT::deadline(self, R::SPY_INTEL_TOURS, &[&code]);
                f.setdefault("intel", dict! {}).set(nid.to_string(), until);
                if code == self.player {
                    let gm = py::sum_v(n.at("garrison").iter().map(|r| r.at("n")));
                    let (x0, y0) = (gn.atf("x"), gn.atf("y"));
                    let near = self
                        .armies
                        .values()
                        .iter()
                        .filter(|a| a.at("owner") == o && py::hypot(a.atf("x") - x0, a.atf("y") - y0) < 14.0)
                        .count();
                    let t = format!(
                        "Rapport d'espion sur {name} : milice {}, garnison {}, remparts niveau {}, {near} armée(s) aux environs.",
                        py::int_v(&n.at("milice")),
                        py::int_v(&gm),
                        n.at("fort")
                    );
                    self.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &o, "important" => true});
                }
            } else {
                n.set("fort", py_max(0, &n.at("fort") - 1));
                let mm = py_max(R::NODE_BASE().at(gn.at("type")).at("milice"), &n.at("milice_max") - 40);
                n.set("milice_max", &mm);
                n.set("milice", py_min(n.at("milice"), &mm));
                if code == self.player {
                    let t = format!("Sabotage réussi : une brèche s'ouvre dans les remparts de {name}.");
                    self.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &code, "important" => true});
                }
                if o == self.player {
                    let t = format!("Des saboteurs ont endommagé les remparts de {name} !");
                    self.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &code, "important" => true});
                }
            }
        } else {
            let pen = if kind == "espionner" { 10 } else { 20 };
            if self.factions.has(o.as_str()) {
                let rel = self.factions.at(o.as_str()).at("rel");
                rel.set(code.as_str(), py_max(-100, &rel.at(code.as_str()) - pen));
            }
            if code == self.player {
                let suite = if self.factions.has(o.as_str()) { format!(" {} s'en offusque.", self.fname(&o)) } else { String::new() };
                let t = format!("Votre agent a été démasqué à {name}.{suite}");
                self.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &o, "important" => true});
            }
            if o == self.player {
                let t = format!("Un espion de {} a été arrêté à {name}.", self.fname(&code));
                self.log("espion", &t, &dict! {"x" => &gx, "y" => &gy, "who" => &code, "important" => true});
            }
        }
    }

    /// Python : `intel_active(self, code, nid)`.
    // engine.py, lignes 4145 à 4147
    pub fn intel_active(&self, code: &str, nid: i64) -> bool {
        let f = self.factions.get(code);
        f.truthy() && f.get_or("intel", dict! {}).get_or(nid.to_string(), -1) > self.t
    }

    // ------------------------------------------------------------------ impôts et ordre public
    /// Python : `set_tax(self, code, v)`.
    /// v : vient tel quel du navigateur ; float(v) lève une exception s'il n'est pas un nombre (py::float_v).
    // engine.py, lignes 4150 à 4157
    pub fn set_tax(&mut self, code: &str, v: &Val) -> (bool, String) {
        let v = match float_cmd(v) {
            Ok(v) => v,
            Err(m) => return (false, m),
        };
        if !v.is_finite() {
            return (false, "Niveau d'impôts invalide.".to_string());
        }
        let f = self.factions.at(code);
        let x = py::round_n(v, 2);
        let x = if x < 1.0 { x } else { 1.0 };
        f.set("tax", if 0.0 < x { x } else { 0.0 });
        self._dirty_income = true;
        (true, format!("Impôts : {}.", R::tax_label(f.atf("tax")).to_lowercase()))
    }

    /// Python : `set_tarif(self, code, v)`.
    /// v : vient tel quel du navigateur ; `type(v) is not int` : un bool est refusé (Val::Int seulement).
    // engine.py, lignes 4159 à 4165
    pub fn set_tarif(&mut self, code: &str, v: &Val) -> (bool, String) {
        let Val::Int(i) = *v else { return (false, "Tarif invalide.".to_string()) };
        let tarifs = R::TARIFS();
        if !(0 <= i && (i as usize) < tarifs.len()) {
            return (false, "Tarif invalide.".to_string());
        }
        self.factions.at(code).set("tarif", i);
        self._dirty_income = true;
        let (nom, t) = tarifs.at(i).pair();
        (true, format!("Douane : tarif {} ({} %).", nom.s().to_lowercase(), py::round(t.f() * 100.0)))
    }

    /// Python : `set_douaniers(self, code, v)`.
    /// v : vient tel quel du navigateur ; un bool, sinon refusé.
    // engine.py, lignes 4167 à 4172
    pub fn set_douaniers(&mut self, code: &str, v: &Val) -> (bool, String) {
        let Val::Bool(b) = *v else { return (false, "Réglage invalide.".to_string()) };
        self.factions.at(code).set("douaniers", b);
        self._dirty_income = true;
        (true, if b { "Douaniers postés aux frontières." } else { "Douaniers rappelés." }.to_string())
    }

    /// Stabilité vers laquelle tend chaque place d'un département.
    /// Python : `stab_targets(self)`.
    /// Rend un dict {code: stabilité visée}.
    // engine.py, lignes 4174 à 4187
    pub fn stab_targets(&self) -> Val {
        let out = dict! {};
        for (code_v, f) in self.factions.items() {
            if !f.atb("alive") {
                continue;
            }
            let code = code_v.s();
            let tax = f.get_or("tax", 0.5).f();
            let (x, y) = (tax - 0.5, 1.0 + self.mod_(code, "tax_unrest", 0.0));
            let mut t = 1.0 - (if x > 0.0 { x } else { 0.0 }) * 1.2 * (if y > 0.0 { y } else { 0.0 }) + self.mod_(code, "order", 0.0);
            if f.getb("famine") {
                t -= 0.3;
            }
            if f.getb("banqueroute") {
                t -= 0.2;
            }
            out.set(&code_v, t);
        }
        out
    }

    // ================================================================== ordres du joueur
    /// Python : `form_army(self, code, nid, reg_ids, into=None)`.
    /// reg_ids : vient tel quel du navigateur (une liste d'identifiants, sinon refusé) ; into : None, ou l'identifiant
    /// de l'armée à compléter. Rend (True, identifiant de l'armée).
    // engine.py, lignes 4190 à 4212
    pub fn form_army(&mut self, code: &str, nid: i64, reg_ids: &Val, into: &Val) -> (bool, String) {
        let n = self.nodes.at(nid);
        if n.at("owner") != code {
            return (false, "Garnison introuvable.".to_string());
        }
        if !(reg_ids.is_list() || reg_ids.is_tuple()) {
            return (false, "Choisissez au moins un régiment.".to_string());
        }
        let go = |r: &Val| R::UNITS().at(r.at("type")).atb("garrison_only");
        let regs: Vec<Val> = n.at("garrison").iter().filter(|r| reg_ids.has(&r.at("id"))).collect();
        if !regs.is_empty() && regs.iter().all(go) {
            return (false, "La Garde nationale ne quitte pas sa ville.".to_string());
        }
        let regs: Val = regs.into_iter().filter(|r| !go(r)).collect();
        let reg_ids: Val = regs.iter().map(|r| r.at("id")).collect();
        if !regs.truthy() {
            return (false, "Choisissez au moins un régiment.".to_string());
        }
        let a;
        if into.truthy() {
            a = self.armies.get(into);
            if !a.truthy()
                || a.at("owner") != code
                || a.at("at_node") != nid
                || a.at("state") != "idle"
                || a.getb("boat")
            {
                return (false, "L'armée doit être sur place et au repos.".to_string());
            }
            a.at("regs").extend(&regs);
        } else {
            let (gx, gy) = self.node_xy(nid);
            a = self.create_army(code, gx, gy, &regs, &Val::from(nid), &Val::None, &Val::None);
        }
        n.set("garrison", n.at("garrison").iter().filter(|r| !reg_ids.has(&r.at("id"))).collect::<Val>());
        (true, a.ats("id"))
    }

    /// Enrôle les prisonniers d'une origine : une partie seulement accepte de servir, leur département s'en fâche.
    /// Python : `enroll(self, code, frm)`.
    /// frm : le camp d'origine des prisonniers (ou R::NEUTRAL).
    // engine.py, lignes 4214 à 4227
    pub fn enroll(&mut self, code: &str, frm: &str) -> (bool, String) {
        let f = self.factions.at(code);
        let n = py::int_v(&f.setdefault("prisoners", dict! {}).get_or(frm, 0));
        if n <= 0 {
            return (false, "Aucun prisonnier de cette origine.".to_string());
        }
        let gain = py::int(self.add_recrues(code, py::int(n as f64 * 0.6) as f64));
        f.at("prisoners").del(frm);
        if self.factions.has(frm) {
            let rel = self.factions.at(frm).at("rel");
            rel.set(code, py_max(-100, &rel.at(code) - 8));
        }
        if code == self.player {
            let t = format!("{gain} prisonniers ({}) acceptent de servir sous vos drapeaux ; les autres sont renvoyés.", self.fname(frm));
            self.log("armee", &t, &dict! {"who" => code});
        }
        (true, format!("{gain} prisonniers enrôlés comme recrues."))
    }

    /// Python : `to_garrison(self, code, aid)`.
    // engine.py, lignes 4229 à 4238
    pub fn to_garrison(&mut self, code: &str, aid: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (false, "Armée introuvable.".to_string());
        }
        let an = a.at("at_node");
        if an.is_none() || self.nodes.at(&an).at("owner") != code || a.at("state") != "idle" {
            return (false, "L'armée doit être au repos dans une de vos villes.".to_string());
        }
        self.nodes.at(&an).at("garrison").extend(&a.at("regs"));
        self.armies.del(aid);
        (
            true,
            "Régiments placés en garnison. Pour les en sortir : panneau de la ville, section Garnison, « Sortir de la garnison »."
                .to_string(),
        )
    }

    /// Python : `split(self, code, aid, reg_ids)`.
    /// reg_ids : comme form_army. Rend (True, identifiant de la nouvelle armée).
    // engine.py, lignes 4240 à 4263
    pub fn split(&mut self, code: &str, aid: &Val, reg_ids: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code || a.at("state") == "battle" {
            return (false, "Impossible de scinder cette armée maintenant.".to_string());
        }
        if a.getb("boat") && a.at("at_node").is_none() {
            return (false, "Impossible de scinder une armée embarquée : attendez qu'elle accoste.".to_string());
        }
        if !(reg_ids.is_list() || reg_ids.is_tuple()) {
            return (false, "Choisissez une partie des régiments.".to_string());
        }
        let regs: Val = a.at("regs").iter().filter(|r| reg_ids.has(&r.at("id"))).collect();
        if !regs.truthy() || regs.len() == a.at("regs").len() {
            return (false, "Choisissez une partie des régiments.".to_string());
        }
        a.set("regs", a.at("regs").iter().filter(|r| !reg_ids.has(&r.at("id"))).collect::<Val>());
        let gen = self.new_general(code);
        let b = self.create_army(code, a.atf("x"), a.atf("y"), &regs, &a.at("at_node"), &Val::None, &gen);
        b.set("onroad", a.at("onroad"));
        b.set("edge", if a.atb("edge") { a.at("edge").copy() } else { Val::None });
        b.set("fm", a.get_or("fm", "ligne"));
        b.set("stance", a.at("stance"));
        b.set("supply", a.at("supply"));
        b.set("mp", a.get("mp"));
        b.set("hold", a.get_or("hold", false)); // (détachée d'une armée en halte devant une place : en halte aussi)
        if a.at("state") == "siege" {
            b.set("state", "siege");
        }
        (true, b.ats("id"))
    }

    /// Détache d'un coup toute la cavalerie, l'infanterie ou l'artillerie d'une armée.
    /// Python : `split_by_type(self, code, aid, kind)`.
    /// kind : vient tel quel du navigateur ('cavalerie', 'artillerie', 'inf').
    // engine.py, lignes 4265 à 4281
    pub fn split_by_type(&mut self, code: &str, aid: &Val, kind: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (false, "Armée introuvable.".to_string());
        }
        let ids: Val = a.at("regs").iter().filter(|r| *kind == Game::arm_class(r.at("type").s())).map(|r| r.at("id")).collect();
        if !ids.truthy() {
            return (false, "Aucun régiment de ce type dans l'armée.".to_string());
        }
        let (ok, res) = self.split(code, aid, &ids);
        if ok {
            let b = self.armies.at(res.as_str());
            let name = a.ats("name");
            let base = match name.split_once(" de la ") {
                Some((_, reste)) => reste.to_string(),
                None => name.clone(),
            };
            let tete = match kind.s() {
                "cavalerie" => "Cavalerie",
                "artillerie" => "Batterie",
                "inf" => "Infanterie",
                k => panic!("KeyError: {}", py::repr_s(k)),
            };
            b.set("name", format!("{tete} de la {base}"));
            self.factions.at(code).dec("army_count", 1);
            if *kind == "cavalerie" && self.gen_trait(&b) != "cavalier" && self.rng.random() < 0.5 {
                b.at("gen").set("trait", "cavalier");
            }
        }
        (ok, res)
    }

    /// Python : `merge(self, code, aid, bid)`.
    /// bid : l'identifiant de l'autre armée (tel quel du navigateur).
    // engine.py, lignes 4283 à 4304
    pub fn merge(&mut self, code: &str, aid: &Val, bid: &Val) -> (bool, String) {
        let (a, b) = (self.armies.get(aid), self.armies.get(bid));
        if !a.truthy() || !b.truthy() || a.at("owner") != code || b.at("owner") != code || a.is(&b) {
            return (false, "Armées introuvables.".to_string());
        }
        if py::hypot(a.atf("x") - b.atf("x"), a.atf("y") - b.atf("y")) > 3.0 || a.at("state") == "battle" || b.at("state") == "battle" {
            return (false, "Les armées doivent être côte à côte et hors combat.".to_string());
        }
        if b.getb("boat") || a.getb("boat") {
            return (false, "Impossible de réunir des armées embarquées.".to_string());
        }
        a.at("regs").extend(&b.at("regs"));
        let (ga, mut gb) = (a.get("gen"), b.get("gen"));
        if gb.truthy() && (!ga.truthy() || tup![gb.at("lvl"), gb.at("xp")] > tup![ga.at("lvl"), ga.at("xp")]) {
            a.set("gen", &gb);
            gb = ga;
        }
        self.reserver(code, &gb); // (l'autre général attend dans la réserve)
        a.set("supply", py_min(a.at("supply"), b.at("supply")));
        if a.get("mp").is_some() || b.get("mp").is_some() {
            let full = TT::march_days(self);
            let ma = if a.get("mp").is_none() { Val::from(full) } else { a.at("mp") };
            let mb = if b.get("mp").is_none() { Val::from(full) } else { b.at("mp") };
            a.set("mp", py_min(ma, mb));
        }
        self.armies.del(bid);
        if !a.getb("gen") {
            return (true, "Armées réunies.".to_string());
        }
        let t = Game::gen_title(&a.at("gen"));
        let mut c = t.chars();
        let tl = match c.next() {
            Some(c0) => c0.to_lowercase().collect::<String>() + c.as_str(),
            None => String::new(),
        };
        (true, format!("Armées réunies sous le commandement du {tl}."))
    }

    /// Python : `set_stance(self, code, aid, stance)`.
    /// stance : vient tel quel du navigateur.
    // engine.py, lignes 4306 à 4321
    pub fn set_stance(&mut self, code: &str, aid: &Val, stance: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code {
            return (false, "Armée introuvable.".to_string());
        }
        if !(*stance == "normal" || *stance == "embuscade" || *stance == "retranche") {
            return (false, "Posture inconnue.".to_string());
        }
        if *stance == "embuscade" && (a.atb("onroad") || a.at("at_node").is_some()) {
            return (
                false,
                "Une embuscade se tend hors des routes : marchez à travers champs vers un bois, une lande ou un marais.".to_string(),
            );
        }
        if *stance == "embuscade" && !TERRAIN().at(self.geo.terrain_at(a.atf("x"), a.atf("y"))).atb(2) {
            return (false, "Il faut un couvert (forêt, lande, marais, montagne) pour tendre une embuscade.".to_string());
        }
        if a.at("state") == "move" {
            a.set("path", list![]);
            a.set("state", "idle");
        }
        a.set("stance", stance);
        let msg = match stance.s() {
            "normal" => "Posture normale.",
            "embuscade" => "Embuscade tendue : restez invisibles et attendez.",
            _ => "Les troupes se retranchent (+20 % en défense).",
        };
        (true, msg.to_string())
    }

    /// Python : `assault(self, code, aid)`.
    // engine.py, lignes 4323 à 4330
    pub fn assault(&mut self, code: &str, aid: &Val) -> (bool, String) {
        let a = self.armies.get(aid);
        if !a.truthy() || a.at("owner") != code || a.at("state") != "siege" {
            return (false, "Cette armée n'assiège rien.".to_string());
        }
        a.set("assault", true);
        if self.tour.atb("on") && self.tour.at("end").is_none() {
            self.update_sieges(0.0); // tour par tour : l'assaut se livre tout de suite
        }
        (true, "Assaut ordonné !".to_string())
    }

    /// Python : `set_slider(self, code, v)`.
    /// v : comme set_tax.
    // engine.py, lignes 4332 à 4338
    pub fn set_slider(&mut self, code: &str, v: &Val) -> (bool, String) {
        let v = match float_cmd(v) {
            Ok(v) => v,
            Err(m) => return (false, m),
        };
        if !v.is_finite() {
            return (false, "Réglage invalide.".to_string());
        }
        let x = if v < 1.0 { v } else { 1.0 };
        self.factions.at(code).set("slider", if 0.0 < x { x } else { 0.0 });
        self._dirty_income = true;
        (true, "Production ajustée.".to_string())
    }

    /// Python : `market_trade(self, code, res, qty, side)`.
    /// res, qty, side : tels quels du navigateur (float(qty) lève une exception s'il n'est pas un nombre).
    // engine.py, lignes 4340 à 4376
    pub fn market_trade(&mut self, code: &str, res: &Val, qty: &Val, side: &Val) -> (bool, String) {
        if !self.market.has(res) {
            return (false, "Ressource non négociable.".to_string());
        }
        if !(*side == "buy" || *side == "sell") {
            return (false, "Opération inconnue.".to_string());
        }
        let q = match float_cmd(qty) {
            Ok(v) => v,
            Err(m) => return (false, m),
        };
        if !q.is_finite() {
            return (false, "Quantité invalide.".to_string());
        }
        if q < 1.0 {
            return (false, "Indiquez une quantité.".to_string());
        }
        let qi = py::int(q);
        let mut qty: i64 = if qi < 1000 { qi } else { 1000 };
        let has_port = self.owned_nodes(code).iter().any(|n| self.geo.nodes.at(n.at("id")).at("spec").has("port"));
        let spread = if has_port { (1.15, 0.85) } else { (1.4, 0.6) };
        let m = self.mod_(code, "market", 0.0);
        let (s0, s1) = (spread.0 - m, spread.1 + m);
        let spread = (if s0 > 1.02 { s0 } else { 1.02 }, if s1 < 0.98 { s1 } else { 0.98 });
        let p = self.market.atf(res);
        let r = self.factions.at(code).at("res");
        let label = || R::RES_LABEL().at(res).s().to_lowercase();
        let q = qty as f64;
        if *side == "buy" {
            if *res == "recrues" {
                let room = py::int(self.recruit_cap(code) as f64 - r.atf("recrues"));
                if room <= 0 {
                    return (false, "Vos casernes sont pleines : aucune recrue de plus ne peut être accueillie.".to_string());
                }
                if room < qty {
                    qty = room;
                }
            }
            let q = qty as f64;
            let cost = q * p * (1.0 + 0.0002 * q) * spread.0;
            if r.atf("livres") < cost {
                return (false, "Livres insuffisantes.".to_string());
            }
            r.dec("livres", cost);
            r.inc(res, qty);
            self.market.set(res, py::round_n(p * (1.0 + 0.0004 * q), 3));
            return (true, format!("Acheté {qty} {} pour {} livres.", label(), py::int(cost)));
        }
        if r.at(res) < qty {
            return (false, "Stock insuffisant.".to_string());
        }
        let gain = q * p * (1.0 - 0.0002 * q) * spread.1;
        r.dec(res, qty);
        r.inc("livres", gain);
        let x = p * (1.0 - 0.0004 * q);
        self.market.set(res, py::round_n(if x > 0.05 { x } else { 0.05 }, 3));
        (true, format!("Vendu {qty} {} pour {} livres.", label(), py::int(gain)))
    }
}
