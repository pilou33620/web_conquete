//! Porte game/engine.py, lignes 154 à 817 : utilitaires, armement et noms d'époque, boucle, jours / météo / événements.
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::*;

impl Game {
    // ================================================================== utilitaires
    /// Python : `nid(self, prefix)`.
    /// Un identifiant neuf : 'a12', 'r13', 'b14'…
    // engine.py, lignes 155 à 157
    pub fn nid(&mut self, prefix: &str) -> String {
        self.uid += 1;
        format!("{prefix}{}", self.uid)
    }

    /// Python : `new_reg(self, typ, n=None, code=None)`.
    /// n : l'effectif (None : celui du type) ; code : le camp, ou None (pas d'armes ni de manœuvres de camp).
    /// Rend le régiment : dict(id, type, n, max, xp, morale, ammo, fat[, arm], man).
    // engine.py, lignes 159 à 166
    pub fn new_reg(&mut self, typ: &str, n: &Val, code: &Val) -> Val {
        let u = R::UNITS().at(typ);
        let reg = dict! {
            "id" => self.nid("r"), "type" => typ, "n" => py::float_v(&if n.is_none() { u.at("men") } else { n.clone() }),
            "max" => u.at("men"), "xp" => py::float_v(&u.get_or("xp0", 0)), "morale" => 80.0 + u.get_or("morale0", 0).f(),
            "ammo" => 100.0, "fat" => 0.0
        };
        let cls = u.ats("cls");
        if R::ARMS().has(&cls) {
            // les armes du moment, gardées jusqu'au réarmement
            reg.set("arm", if code.truthy() { self.arm_level(code.s(), &cls) } else { 0 });
        }
        reg.set("man", self.known_man(code, &cls)); // et les manœuvres du moment
        reg
    }

    // ------------------------------------------------------------------ armement et noms d'époque
    /// Meilleure génération d'armes que ce camp sait fabriquer (0 = mousquet et piques, canons de bronze).
    /// Python : `arm_level(self, code, cls)`.
    /// cls : 'inf', 'cavalerie' ou 'artillerie' (une clé de R::ARMS()). Rend le rang dans R::ARMS()[cls].
    // engine.py, lignes 169 à 176
    pub fn arm_level(&self, code: &str, cls: &str) -> i64 {
        let arms = R::ARMS().at(cls).vec();
        if !self.factions.has(code) {
            // villages insurgés : les armes d'une génération déjà répandue (une dizaine d'années de retard)
            let y = self.date(&Val::None).year - 10;
            let ty = R::TECH_YEAR();
            return arms.iter().enumerate().filter(|(_, a)| {
                let t = a.at(0);
                t.is_none() || ty.get_or(&t, 0) <= y
            }).map(|(i, _)| i as i64).max().unwrap();
        }
        let techs = self.factions.at(code).at("techs");
        arms.iter().enumerate().filter(|(_, a)| {
            let t = a.at(0);
            t.is_none() || techs.has(&t)
        }).map(|(i, _)| i as i64).max().unwrap()
    }

    /// Python : `arm_k(self, code, cls, level=None)`.
    /// level : None (le niveau du camp) ou un entier (borné à la dernière génération). Rend le coefficient de l'arme.
    // engine.py, lignes 178 à 179
    pub fn arm_k(&self, code: &str, cls: &str, level: &Val) -> f64 {
        let arms = R::ARMS().at(cls);
        let i = if level.is_none() {
            self.arm_level(code, cls)
        } else {
            let top = arms.len() as i64 - 1;
            let l = level.i();
            if top < l { top } else { l }
        };
        arms.at(i).atf(2)
    }

    /// Manœuvres de cette classe de troupe que le camp connaît.
    /// Python : `known_man(self, code, cls)`.
    /// code : peut être None (new_reg sans camp) ou un camp inconnu : liste vide. Rend une liste de technologies.
    // engine.py, lignes 181 à 184
    pub fn known_man(&self, code: &Val, cls: &str) -> Val {
        let techs = if self.factions.has(code) { self.factions.at(code).at("techs") } else { tup![] };
        R::MANEUVERS().items().into_iter().filter(|(t, c)| *c == cls && techs.has(t)).map(|(t, _)| t).collect()
    }

    /// Technologies du camp qui ne servent pas encore à ce régiment : manœuvres pas apprises, armes plus récentes
    /// que les siennes. (La Garde nationale a toujours celles de son camp, comme la milice.)
    /// Python : `reg_lag(self, code, r)`.
    /// Rend une liste de technologies (vide si rien ne manque).
    // engine.py, lignes 186 à 196
    pub fn reg_lag(&self, code: &str, r: &Val) -> Val {
        let u = R::UNITS().get(r.at("type"));
        if !self.factions.has(code) || !u.truthy() || u.atb("garrison_only") {
            return list![];
        }
        let (techs, cls, man) = (self.factions.at(code).at("techs"), u.at("cls"), r.get_or("man", tup![]));
        let lag: Val = R::MANEUVERS().items().into_iter().filter(|(t, c)| *c == cls && techs.has(t) && !man.has(t)).map(|(t, _)| t).collect();
        if R::ARMS().has(&cls) && !u.atb("arm_name") {
            let arm = r.get_or("arm", 0);
            for (i, a) in R::ARMS().at(&cls).iter().enumerate() {
                let t = a.at(0);
                if techs.has(&t) && Val::from(i) > arm {
                    lag.push(t);
                }
            }
        }
        lag
    }

    /// Effets de technologie de ce régiment : ceux du camp, moins les effets de régiment (R.REG_KEYS) de ce qui ne
    /// lui sert pas encore (reg_lag), plus les talents du général de son armée a (SPEC-GENERAUX.md).
    /// Python : `reg_mods(self, code, r, a=None)`.
    /// a : l'armée du régiment, ou None. Rend un dict {effet: valeur} : le dict `mods` du camp LUI-MÊME quand rien
    /// ne change (ne pas l'écrire), sinon une copie.
    // engine.py, lignes 198 à 214
    pub fn reg_mods(&self, code: &str, r: &Val, a: &Val) -> Val {
        let md = if self.factions.has(code) { self.factions.at(code).at("mods") } else { dict! {} };
        let mut out = md.clone();
        for t in self.reg_lag(code, r).iter() {
            for (k, v) in R::TECH().at(&t).at("fx").items() {
                if R::REG_KEYS().has(&k) {
                    if out.is(&md) {
                        out = md.copy();
                    }
                    out.set(&k, &out.get_or(&k, 0.0) - &v);
                }
            }
        }
        let gen = if a.truthy() { a.get("gen") } else { Val::None };
        let talents = if gen.truthy() { gen.get_or("talents", tup![]) } else { tup![] };
        for t in talents.iter() {
            for (k, v) in R::GENERAL_TALENTS().at(&t).at("fx").items() {
                if out.is(&md) {
                    out = md.copy();
                }
                out.set(&k, &out.get_or(&k, 0.0) + &v);
            }
        }
        out
    }

    /// La milice se rééquipe à l'arsenal de sa ville : elle a toujours les armes de son camp.
    /// Python : `milice_k(self, code)`.
    // engine.py, lignes 216 à 218
    pub fn milice_k(&self, code: &str) -> f64 {
        self.arm_k(code, "inf", &Val::None)
    }

    /// (nom, nom court) de ce type de troupe pour ce camp, selon l'époque et ses technologies.
    /// Python : `unit_name(self, code, typ)`.
    // engine.py, lignes 220 à 229
    pub fn unit_name(&self, code: &str, typ: &str) -> (String, String) {
        let u = R::UNITS().at(typ);
        let (mut name, mut short) = (u.ats("name"), u.ats("short"));
        let techs = if self.factions.has(code) { self.factions.at(code).at("techs") } else { list![] };
        let y = self.date(&Val::None).year;
        for e in R::UNIT_NAMES().get_or(typ, list![]).iter() {
            let (y0, tech, nm, sh) = e.quad();
            if Val::from(y) >= y0 && (tech.is_none() || techs.has(&tech)) {
                name = nm.string();
                short = sh.string();
            }
        }
        (name, short)
    }

    /// Prix de « Moderniser » ces régiments (SPEC-ARBRE.md) : les armes du moment (armes, fer pour l'artillerie) et
    /// MAN_COST livres par homme et par manœuvre à apprendre. Les régiments déjà à l'exercice ne comptent pas.
    /// Python : `modernize_cost(self, code, regs)`.
    /// regs : une liste de régiments. Rend un dict {ressource: entier} (vide : rien à payer).
    // engine.py, lignes 231 à 243
    pub fn modernize_cost(&self, code: &str, regs: &Val) -> Val {
        let need = dict! {};
        for r in regs.iter() {
            let lag = if r.getb("drill") { list![] } else { self.reg_lag(code, &r) };
            if lag.iter().any(|t| !R::MANEUVERS().has(&t)) {
                // une arme plus récente
                for (k, v) in R::REARM().at(R::UNITS().at(r.at("type")).at("cls")).items() {
                    need.set(&k, &need.get_or(&k, 0) + &(&v * &r.at("max")));
                }
            }
            let nm = lag.iter().filter(|t| R::MANEUVERS().has(t)).count() as i64;
            if nm != 0 {
                need.set("livres", &need.get_or("livres", 0) + &(&(Val::from(R::MAN_COST) * &r.at("max")) * nm));
            }
        }
        Val::dict_from(need.items().into_iter().filter(|(_, v)| py::round(v.f()) != 0).map(|(k, v)| (k, Val::from(py::round(v.f())))).collect())
    }

    /// Les régiments d'une armée au repos dans une place amie, ou d'une garnison, prennent les armes et apprennent
    /// les manœuvres du moment : MAN_DAYS jours d'exercice (drill_tick), payés d'avance ; partir les interrompt.
    /// Python : `modernize(self, code, army_id=None, nid=None)`.
    /// army_id : identifiant d'armée ou None ; nid : numéro de place ou None (l'un des deux).
    // engine.py, lignes 245 à 279
    pub fn modernize(&mut self, code: &str, army_id: &Val, nid: &Val) -> (bool, String) {
        let f = self.factions.at(code);
        let (regs, where_);
        if army_id.is_some() {
            let a = self.armies.get(army_id);
            if !a.truthy() || a.at("owner") != code {
                return (false, "Armée introuvable.".to_string());
            }
            let an = a.at("at_node");
            if a.at("state") != "idle" || an.is_none() || self.nodes.at(&an).at("owner") != code || self.nodes.at(&an).atb("siege") {
                return (false, "Il faut un arsenal : l'armée doit être au repos dans une de vos places, hors siège.".to_string());
            }
            regs = a.at("regs");
            where_ = self.geo.nodes.at(&an).ats("name");
        } else {
            let n = self.nodes.at(nid);
            if n.at("owner") != code || n.atb("siege") {
                return (false, "Place indisponible.".to_string());
            }
            regs = n.at("garrison");
            where_ = self.geo.nodes.at(nid).ats("name");
        }
        let cost = self.modernize_cost(code, &regs);
        if !cost.truthy() {
            return (false, "Ces régiments ont déjà les armes et les manœuvres du moment.".to_string());
        }
        let res = f.at("res");
        if cost.items().iter().any(|(k, v)| res.at(k) < *v) {
            let manque: Vec<String> = cost.items().iter().filter(|(k, v)| res.at(k) < *v).map(|(k, _)| R::de(k.s())).collect();
            return (false, format!("Pas assez {} pour moderniser.", manque.join(" ni ")));
        }
        for (k, v) in cost.items() {
            res.dec(&k, &v);
        }
        let mut cnt = 0i64;
        for r in regs.iter() {
            let lag = if r.getb("drill") { list![] } else { self.reg_lag(code, &r) };
            if lag.truthy() {
                let cls = R::UNITS().at(r.at("type")).ats("cls");
                let man: Val = lag.iter().filter(|t| R::MANEUVERS().has(t)).collect();
                let arm = if lag.iter().any(|t| !R::MANEUVERS().has(&t)) { Val::from(self.arm_level(code, &cls)) } else { Val::None };
                r.set("drill", dict! {"t" => self.t + R::MAN_DAYS as f64, "man" => man, "arm" => arm});
                cnt += 1;
            }
        }
        self._dirty_income = true;
        let couts: Vec<String> = cost.items().iter().map(|(k, v)| format!("{v} {k}")).collect();
        (
            true,
            format!(
                "{} à l'exercice à {where_} pour un tiers de tour ({}) : partir avant la fin l'interrompt.",
                R::pl(cnt, "régiment", Some("régiments")),
                couts.join(", ")
            ),
        )
    }

    /// Chaque jour : les régiments qui ont fini leur exercice prennent leurs armes (et perdent un peu d'expérience
    /// à réapprendre à tirer) et leurs manœuvres ; une armée qui a quitté sa place abandonne le sien (sans
    /// remboursement).
    /// Python : `drill_tick(self)`.
    // engine.py, lignes 281 à 293
    pub fn drill_tick(&mut self) {
        for a in self.armies.values() {
            if a.at("regs").iter().any(|r| r.has("drill")) {
                let n = a.at("at_node");
                let gone = ["move", "retreat", "siege"].iter().any(|s| a.at("state") == *s)
                    || n.is_none()
                    || self.nodes.at(&n).at("owner") != a.at("owner");
                self._drill_end(&a.ats("owner"), &a.at("regs"), &a.ats("name"), a.atf("x"), a.atf("y"), gone);
            }
        }
        for n in self.nodes.iter() {
            if n.at("garrison").iter().any(|r| r.has("drill")) {
                let gn = self.geo.nodes.at(n.at("id"));
                let who = format!("La garnison de {}", gn.at("name"));
                self._drill_end(&n.ats("owner"), &n.at("garrison"), &who, gn.atf("x"), gn.atf("y"), false);
            }
        }
    }

    /// Python : `_drill_end(self, code, regs, who, x, y, gone)`.
    /// who : le nom à écrire dans le journal ; x, y : où le montrer.
    // engine.py, lignes 295 à 311
    pub fn _drill_end(&mut self, code: &str, regs: &Val, who: &str, x: f64, y: f64, gone: bool) {
        let mut done = 0i64;
        for r in regs.iter() {
            let d = r.get("drill");
            if !d.truthy() || (!gone && self.t < d.atf("t")) {
                continue;
            }
            r.del("drill");
            if gone {
                continue;
            }
            if d.at("arm").is_some() && d.at("arm") > r.get_or("arm", 0) {
                r.set("arm", d.at("arm"));
                r.scale("xp", 0.85); // il faut réapprendre à tirer
            }
            let man = r.get_or("man", list![]).vec();
            let mut nouv = man.clone();
            nouv.extend(d.at("man").iter().filter(|t| !r.get_or("man", list![]).has(t)));
            r.set("man", Val::list(nouv));
            done += 1;
        }
        if code == self.player && (done != 0 || gone) {
            let t = if gone {
                format!("{who} a quitté sa place : modernisation abandonnée.")
            } else {
                format!("{who} : {}.", R::pl(done, "régiment modernisé", Some("régiments modernisés")))
            };
            self.log("armee", &t, &dict! {"x" => x, "y" => y, "who" => code});
        }
    }

    /// Python : `has_sapeurs(self, a)`.
    // engine.py, lignes 313 à 314
    pub fn has_sapeurs(&self, a: &Val) -> bool {
        a.at("regs").iter().any(|r| r.at("type") == "sapeurs")
    }

    /// (possible, raison) : ce lieu peut-il lever ce régiment (sans compter le coût) ?
    /// Python : `can_recruit(self, code, nid, typ)`.
    /// typ : vient tel quel du navigateur (None ou inconnu : « Unité inconnue. »).
    // engine.py, lignes 316 à 339
    pub fn can_recruit(&self, code: &str, nid: i64, typ: &Val) -> (bool, String) {
        let u = R::UNITS().get(typ);
        if !u.truthy() {
            return (false, "Unité inconnue.".to_string());
        }
        let typ_s = typ.s();
        let gn = self.geo.nodes.at(nid);
        if gn.at("type") == "village" && typ_s != "garde" {
            return (false, "Un village ne lève que la Garde nationale.".to_string());
        }
        if gn.at("type") == "fort" && u.at("cls") != "inf" {
            return (false, "Un fort ne lève que de l'infanterie.".to_string());
        }
        let y = self.date(&Val::None).year;
        if R::UNIT_YEAR().get_or(typ, 0) > y {
            return (false, format!("N'existe pas encore (vers {}).", R::UNIT_YEAR().at(typ)));
        }
        if R::hors_service(typ_s, y) {
            return (false, "Plus au service de France.".to_string());
        }
        if R::MERCS().has(typ) {
            if Val::from(nid) != self.capital_of(code) && !gn.at("spec").has("port") {
                return (false, "Se loue au chef-lieu ou dans un port.".to_string());
            }
            if self.merc_count(code) >= R::MERC_MAX {
                return (false, format!("Au plus {} régiments étrangers.", R::MERC_MAX));
            }
        }
        if u.atb("req") && !self.factions.at(code).at("techs").has(u.at("req")) {
            return (false, format!("Technologie requise : {}.", R::TECH().at(u.at("req")).at("name")));
        }
        if u.getb("where") && !u.at("where").has(gn.at("dept")) {
            return (false, "Se lève seulement en Pays basque et en Béarn.".to_string());
        }
        (true, String::new())
    }

    /// Régiments étrangers du camp : armées, garnisons et files des places.
    /// Python : `merc_count(self, code)`.
    // engine.py, lignes 341 à 344
    pub fn merc_count(&self, code: &str) -> i64 {
        let a = self.all_regs(code).iter().filter(|r| R::MERCS().has(r.at("type"))).count() as i64;
        let mut b = 0i64;
        for n in self.nodes.iter() {
            if n.at("owner") == code {
                b += n.at("queue").iter().filter(|q| q.at("kind") == "unit" && R::MERCS().has(q.at("what"))).count() as i64;
            }
        }
        a + b
    }

    /// la carte ne change pas : le chef-lieu de chaque camp n'est cherché qu'une fois
    /// Python : `capital_of(self, code)`.
    /// Rend le numéro de la place (Int), ou None si ce code n'a pas de chef-lieu sur la carte.
    // engine.py, lignes 346 à 353
    pub fn capital_of(&self, code: &str) -> Val {
        let mut c = self._cache_cap.borrow_mut();
        if !matches!(&*c, Some((geo, _)) if Rc::ptr_eq(geo, &self.geo)) {
            *c = Some((self.geo.clone(), dict! {}));
        }
        let d = &c.as_ref().unwrap().1;
        if !d.has(code) {
            let cap = self.geo.nodes.iter().find(|n| n.at("dept") == code && n.at("type") == "capitale").map(|n| n.at("id"));
            d.set(code, Val::from(cap));
        }
        d.at(code)
    }

    /// Python : `date(self, t=None)`.
    /// t : None (la date du jour, gardée dans _cache_date) ou un jour de la partie (entier ou flottant, tronqué).
    // engine.py, lignes 355 à 365
    pub fn date(&self, t: &Val) -> Date {
        if t.is_some() {
            return Date::fromordinal(self.start_ord + py::int_v(t));
        }
        // la date du jour, très demandée (saisons, courbes de population…) : calculée une fois par jour
        let o = self.start_ord + py::int(self.t);
        if let Some((o0, d)) = self._cache_date.get() {
            if o0 == o {
                return d;
            }
        }
        let d = Date::fromordinal(o);
        self._cache_date.set(Some((o, d)));
        d
    }

    /// Python : `date_str(self, t=None)`.
    /// t : comme date.
    // engine.py, lignes 367 à 369
    pub fn date_str(&self, t: &Val) -> String {
        let d = self.date(t);
        let jour = if d.day > 1 { d.day.to_string() } else { "1er".to_string() };
        format!("{jour} {} {}", R::MONTHS().at(d.month - 1), d.year)
    }

    /// Python : `year(self)`.
    /// L'année décimale (1790.17…), gardée dans _cache_year.
    // engine.py, lignes 371 à 378
    pub fn year(&self) -> f64 {
        let d = self.date(&Val::None);
        if let Some((d0, y)) = self._cache_year.get() {
            if d0 == d {
                return y;
            }
        }
        let y = d.year as f64 + (d.yday() - 1) as f64 / 365.25;
        self._cache_year.set(Some((d, y)));
        y
    }

    /// Python : `era(self)`.
    /// Rend le dict de l'époque en cours (un élément de R::ERAS()).
    // engine.py, lignes 380 à 382
    pub fn era(&self) -> Val {
        let y = self.date(&Val::None).year;
        let eras = R::ERAS();
        if Val::from(y) >= eras.at(0).at("year") {
            eras.iter().filter(|e| e.at("year") <= y).last().unwrap()
        } else {
            eras.at(0)
        }
    }

    /// Croissance séculaire de l'économie à cette date, par rapport à 1790.
    /// Python : `pop_era(self, year=None)`.
    /// year : None (aujourd'hui, gardé dans _cache_era) ou une année (nombre).
    // engine.py, lignes 384 à 394
    pub fn pop_era(&self, year: &Val) -> f64 {
        if year.is_some() {
            return curve_at(&R::POP_ERA(), year.f()).0;
        }
        let y = self.year();
        if let Some((y0, v)) = self._cache_era.get() {
            if y0 == y {
                return v;
            }
        }
        let v = curve_at(&R::POP_ERA(), y).0;
        self._cache_era.set(Some((y, v)));
        v
    }

    /// Trajectoires de population de tous les lieux à la date du jour (recalculées une fois par mois) :
    /// multiplicateurs de 1790, croissance annuelle et sa raison, et la moyenne qui sert à normaliser la production.
    /// Python : `_pop_curves(self)`.
    /// Rend dict(key, mult, rate, why, mean_k) : mult, rate, why sont des listes indexées par numéro de place (gardé dans _pcache).
    // engine.py, lignes 396 à 421
    pub fn _pop_curves(&self) -> Val {
        let d = self.date(&Val::None);
        let key = d.year * 12 + d.month;
        let c = self._pcache.borrow().clone();
        if c.is_none() || c.at("key") != key {
            let y = self.year();
            let (mut mult, mut rate, mut why) = (vec![], vec![], vec![]);
            let (mut num, mut den) = (0.0, 0.0);
            for gn in self.geo.nodes.iter() {
                let cv = R::pop_curve(&gn);
                let (m, w) = curve_at(&cv, y);
                mult.push(Val::from(m));
                rate.push(Val::from(curve_at(&cv, y + 1.0).0 / m - 1.0));
                why.push(w);
                // poids : ce que la place produit d'ordinaire (de base, ses spécialités et sa spécialité phare)
                let base = R::NODE_BASE().at(gn.at("type"));
                let mut k = py::sum_v(["livres", "vivres", "industrie"].iter().map(|r| base.at(*r)));
                let mut sp = vec![];
                for s in gn.at("spec").iter() {
                    for (r, v) in R::SPEC().at(&s).items() {
                        if r != "label" {
                            sp.push(v);
                        }
                    }
                }
                k = &k + &py::sum_v(sp);
                let star = gn.get("star");
                if star.truthy() {
                    let s = py::sum_v(
                        R::SPECIALTY().at(star.at(0)).items().into_iter()
                            .filter(|(r, _)| *r == "livres" || *r == "vivres" || *r == "industrie")
                            .map(|(_, v)| v),
                    );
                    let mul = if gn.at("type") == "capitale" { Val::from(R::SPECIALTY_CAPITAL) } else { Val::from(1) };
                    k = &k + &(&s * &mul);
                }
                num += k.f() * py::pow(m, R::POP_TREND_K);
                den += k.f();
            }
            let c = dict! {"key" => key, "mult" => Val::list(mult), "rate" => Val::list(rate), "why" => Val::list(why), "mean_k" => num / den};
            *self._pcache.borrow_mut() = c.clone();
            return c;
        }
        c
    }

    /// Population « normale » d'un lieu à cette date, en multiple de celle de 1790 (sa trajectoire propre).
    /// Python : `pop_trend(self, nid, year=None)`.
    /// year : None (aujourd'hui) ou une année (nombre).
    // engine.py, lignes 423 à 427
    pub fn pop_trend(&self, nid: i64, year: &Val) -> f64 {
        if year.is_some() {
            return curve_at(&R::pop_curve(&self.geo.nodes.at(nid)), year.f()).0;
        }
        self._pop_curves().at("mult").atf(nid)
    }

    /// Python : `pop_norm(self, n)`.
    // engine.py, lignes 429 à 430
    pub fn pop_norm(&self, n: &Val) -> f64 {
        self.geo.nodes.at(n.at("id")).atf("pop0") * self.pop_trend(n.ati("id"), &Val::None)
    }

    /// Python : `departements(self)`.
    // engine.py, lignes 432 à 433
    pub fn departements(&self) -> bool {
        self.date(&Val::None) >= Date::de(&R::DEPT_DATE())
    }

    /// « de France » (toute la France) ou « d'Aquitaine » (les anciennes parties du Sud-Ouest).
    /// Python : `pays_de(self)`.
    // engine.py, lignes 435 à 437
    pub fn pays_de(&self) -> &'static str {
        if self.factions.len() > 5 { "de France" } else { "d'Aquitaine" }
    }

    /// Python : `dept_word(self)`.
    // engine.py, lignes 439 à 440
    pub fn dept_word(&self) -> &'static str {
        if self.departements() { "département" } else { "province" }
    }

    /// Python : `faction_name(self, code)`.
    // engine.py, lignes 442 à 443
    pub fn faction_name(&self, code: &str) -> String {
        if self.departements() { R::FACTIONS().at(code).ats("name") } else { R::PROVINCES().at(code).ats("name") }
    }

    /// Aux vitesses rapides, une guerre, une bataille ou une proposition arrête le temps ; un grand moment
    /// de l'histoire l'arrête toujours.
    /// Python : `alert_pause(self, big=False)`.
    // engine.py, lignes 445 à 449
    pub fn alert_pause(&mut self, big: bool) {
        if big || self.speed_idx >= R::FAST_SPEED {
            self.speed_idx = 0;
        }
    }

    /// Python : `season(self)`.
    /// 'hiver', 'printemps', 'été' ou 'automne'.
    // engine.py, lignes 451 à 452
    pub fn season(&self) -> String {
        R::SEASONS().at(self.date(&Val::None).month - 1).string()
    }

    /// La grande crue de la Garonne et de la Dordogne : tirée un printemps sur cinq environ (monthly), 3 à 6 semaines.
    /// Python : `flooded(self)`.
    // engine.py, lignes 454 à 456
    pub fn flooded(&self) -> bool {
        self.t < self.flood_until
    }

    /// Les routes que la crue coupe en ce moment ({arête : tronçons noyés}), vide hors crue.
    /// Python : `cut_edges(self)`.
    /// Rend un dict {numéro d'arête: liste de tronçons} (CR.spans(self.geo)).
    // engine.py, lignes 458 à 460
    pub fn cut_edges(&self) -> Val {
        if self.flooded() { CR::spans(&self.geo) } else { dict! {} }
    }

    /// Python : `zone_of(self, x, y)`.
    /// 'montagne', 'cote' ou 'interieur'.
    // engine.py, lignes 462 à 467
    pub fn zone_of(&self, x: f64, y: f64) -> &'static str {
        if y > self.y_mont {
            return "montagne";
        }
        if x < self.x_cote {
            return "cote";
        }
        "interieur"
    }

    /// Python : `wx(self, x, y)`.
    /// Rend le dict de R::WEATHER() du temps qu'il fait là (le même objet : `.is(&R::WEATHER().at("neige"))`).
    // engine.py, lignes 469 à 470
    pub fn wx(&self, x: f64, y: f64) -> Val {
        R::WEATHER().at(self.weather.at(self.zone_of(x, y)).at("kind"))
    }

    /// Ce que la boue laisse de la vitesse de marche ici (rules.MUD_*) : rien sur une route royale, ni sous la
    /// pluie même (la météo le compte déjà).
    /// Python : `mud_k(self, x, y, paved=False)`.
    // engine.py, lignes 472 à 476
    pub fn mud_k(&self, x: f64, y: f64, paved: bool) -> f64 {
        let w = self.weather.at(self.zone_of(x, y));
        if w.getb("mud") && !paved && !R::MUD_WET().has(w.at("kind")) { R::MUD_MOVE } else { 1.0 }
    }

    /// Python : `log(self, kind, text, x=None, y=None, who=None, important=False, extra=None)`.
    /// kw : dict des arguments optionnels du Python — x, y (None), who (None), important (False), extra (None : un dict
    /// dont les clés s'ajoutent à l'événement). `self.log("eco", &txt, &dict!{"important" => true})` ; rien : `&dict!{}`.
    /// x, y et who sont rangés tels quels dans l'événement.
    // engine.py, lignes 478 à 486
    pub fn log(&mut self, kind: &str, text: &str, kw: &Val) {
        self.seq += 1;
        let ev = dict! {
            "seq" => self.seq, "t" => py::round_n(self.t, 2), "date" => self.date_str(&Val::None), "kind" => kind, "text" => text,
            "x" => kw.get("x"), "y" => kw.get("y"), "who" => kw.get("who"), "important" => kw.get_or("important", false)
        };
        let extra = kw.get("extra");
        if extra.truthy() {
            ev.update(&extra);
        }
        self.events.push(ev);
        if self.events.len() > 400 {
            self.events = self.events.slice(Some(-300), None);
        }
    }

    /// Python : `status(self, a, b)`.
    /// 'self', 'neutre', 'paix', 'guerre' ou 'alliance'.
    // engine.py, lignes 488 à 493
    pub fn status(&self, a: &str, b: &str) -> String {
        if a == b {
            return "self".to_string();
        }
        if a == R::NEUTRAL || b == R::NEUTRAL {
            return "neutre".to_string();
        }
        let k = if a < b { Paire(a, b) } else { Paire(b, a) };
        self.diplo.get(&k).cloned().unwrap_or_else(|| "paix".to_string())
    }

    /// Python : `set_status(self, a, b, s)`.
    // engine.py, lignes 495 à 497
    pub fn set_status(&mut self, a: &str, b: &str, s: &str) {
        let (x, y) = if b < a { (b, a) } else { (a, b) };
        self.diplo.insert((x.to_string(), y.to_string()), s.to_string());
        self._dirty_income = true; // un blocus fluvial dépend de l'état de guerre
    }

    /// (appelé des millions de fois par mois sur toute la France : sans passer par status)
    /// Python : `at_war(self, a, b)`.
    // engine.py, lignes 499 à 501
    pub fn at_war(&self, a: &str, b: &str) -> bool {
        // (appelé des millions de fois par mois sur toute la France : sans passer par status)
        a != b && self.diplo.get(&if a < b { Paire(a, b) } else { Paire(b, a) }).is_some_and(|s| s == "guerre")
    }

    /// Python : `friendly(self, a, b)`.
    // engine.py, lignes 503 à 504
    pub fn friendly(&self, a: &str, b: &str) -> bool {
        a == b || self.status(a, b) == "alliance"
    }

    /// Deux camps qui peuvent se battre : en guerre, ou l'un des deux est la milice d'une place indépendante.
    /// Python : `hostile(self, a, b)`.
    // engine.py, lignes 506 à 508
    pub fn hostile(&self, a: &str, b: &str) -> bool {
        a != b && (a == R::NEUTRAL || b == R::NEUTRAL || self.at_war(a, b))
    }

    /// Python : `valid_node(self, nid)`.
    /// nid : n'importe quelle valeur (isinstance(nid, int) : un bool est un entier en Python).
    // engine.py, lignes 510 à 511
    pub fn valid_node(&self, nid: &Val) -> bool {
        nid.is_int() && Val::from(0) <= *nid && *nid < Val::from(self.nodes.len())
    }

    /// Niveau de fortification le plus haut qu'on peut bâtir ici : bastions à la Vauban réservés aux grandes places.
    /// Python : `fort_max(self, code, nid)`.
    // engine.py, lignes 513 à 517
    pub fn fort_max(&self, code: &str, nid: i64) -> i64 {
        if R::BASTION_TYPES().has(self.geo.nodes.at(nid).at("type"))
            && self.factions.has(code)
            && self.factions.at(code).at("techs").has("vauban")
        {
            return R::BASTION_LEVEL;
        }
        R::FORT_MAX
    }

    /// Python : `lose_fort_level(self, nid)`.
    // engine.py, lignes 519 à 526
    pub fn lose_fort_level(&mut self, nid: i64) -> bool {
        let n = self.nodes.at(nid);
        if n.at("fort") <= 0i64 {
            return false;
        }
        n.dec("fort", 1);
        let mm = &n.at("milice_max") - 40i64;
        n.set("milice_max", if mm > 20.0 { mm } else { Val::from(20.0) });
        let (mi, mm) = (n.at("milice"), n.at("milice_max"));
        n.set("milice", if mm < mi { mm } else { mi });
        true
    }

    /// Python : `node_xy(self, nid)`.
    // engine.py, lignes 528 à 530
    pub fn node_xy(&self, nid: i64) -> (f64, f64) {
        let n = self.geo.nodes.at(nid);
        (n.atf("x"), n.atf("y"))
    }

    /// Python : `owned_nodes(self, code)`.
    /// Rend une liste neuve de places (dict de self.nodes).
    // engine.py, lignes 532 à 533
    pub fn owned_nodes(&self, code: &str) -> Val {
        Val::list(self.owned(code))
    }

    /// Les places du camp, dans l'ordre de self.nodes (`[n for n in self.nodes if n['owner'] == code]`), sans
    /// reparcourir les 3 555 places de la carte à chaque fois : gardées dans _cache_owned (voir Proprios).
    pub fn owned(&self, code: &str) -> Vec<Val> {
        let p = self.proprios();
        p.par_camp.get(code).map_or(vec![], |ix| ix.iter().map(|&i| p.vus[i].clone()).collect())
    }

    /// Les rangs dans self.nodes des places du camp, croissants (voir owned).
    pub fn owned_ix(&self, code: &str) -> Vec<usize> {
        self.proprios().par_camp.get(code).cloned().unwrap_or_default()
    }

    /// Les tableaux de la carte (voir GeoFixe), refaits si la carte n'est plus la même (`Rc::ptr_eq`).
    pub fn geo_fixe(&self) -> Rc<GeoFixe> {
        let mut c = self._cache_geo.borrow_mut();
        if !matches!(&*c, Some((geo, _)) if Rc::ptr_eq(geo, &self.geo)) {
            let xy = self.geo.nodes.iter().map(|gn| (gn.atf("x"), gn.atf("y"))).collect();
            let aretes = self.geo.edges.iter().map(|e| (e.at("a").u(), e.at("b").u(), e.get("kind") == "water")).collect();
            *c = Some((self.geo.clone(), Rc::new(GeoFixe { xy, aretes })));
        }
        c.as_ref().unwrap().1.clone()
    }

    /// Les places de chaque camp, à jour (voir Proprios) : à lâcher avant tout appel qui pourrait les redemander.
    pub fn proprios(&self) -> std::cell::Ref<'_, Proprios> {
        fn adresse(v: &Val) -> usize {
            match v {
                Val::Dict(d) => Rc::as_ptr(d) as *const u8 as usize,
                _ => 0,
            }
        }
        fn releve(vus: &[Val]) -> HashMap<Rc<str>, Vec<usize>, py::Fx> {
            let mut par_camp: HashMap<Rc<str>, Vec<usize>, py::Fx> = HashMap::default();
            for (i, n) in vus.iter().enumerate() {
                if let Val::Str(o) = n.at("owner") {
                    par_camp.entry(o).or_default().push(i);
                }
            }
            par_camp
        }
        let gen = py::generation_owner();
        {
            let mut c = self._cache_owned.borrow_mut();
            let bon = c.as_ref().is_some_and(|c| {
                c.gen == gen && c.nodes.is(&self.nodes) && {
                    let l = self.nodes.liste();
                    l.len() == c.adresses.len() && l.iter().zip(&c.adresses).all(|(a, &b)| adresse(a) == b)
                }
            });
            if !bon {
                // (vus garde les dicts en vie : une adresse relevée ne peut pas servir à un autre dict)
                let vus = self.nodes.liste().clone();
                let adresses = vus.iter().map(adresse).collect();
                let par_camp = releve(&vus);
                *c = Some(Proprios { gen, nodes: self.nodes.clone(), vus, adresses, par_camp });
            }
        }
        let p = std::cell::Ref::map(self._cache_owned.borrow(), |c| c.as_ref().unwrap());
        debug_assert!(p.par_camp == releve(&self.nodes.liste()), "une clé owner a changé sans passer par Val");
        p
    }

    /// Python : `mod(self, code, key, default=0.0)`.
    /// `Game.mod` du Python (mot réservé en Rust). default : 0.0 partout dans le Python.
    // engine.py, lignes 535 à 536
    pub fn mod_(&self, code: &str, key: &str, default: f64) -> f64 {
        self.factions.at(code).at("mods").get_or(key, default).f()
    }

    /// Python : `recompute_mods(self, code)`.
    // engine.py, lignes 538 à 559
    pub fn recompute_mods(&mut self, code: &str) {
        let f = self.factions.at(code);
        let m = R::FACTIONS().at(code).at("mods").copy();
        for t in f.at("techs").iter() {
            for (k, v) in R::TECH().at(&t).at("fx").items() {
                m.set(&k, &m.get_or(&k, 0) + &v);
            }
        }
        // effets des événements : durables (classement de 1855…) ou temporaires (blocus, phylloxéra…)
        for (k, v) in f.get_or("emods", dict! {}).items() {
            m.set(&k, &m.get_or(&k, 0) + &v);
        }
        for e in f.get_or("tmods", list![]).iter() {
            if e.atf("until") > self.t {
                // (blocus, phylloxéra… atténués par les technologies du camp)
                let k = e.at("k");
                let v = &m.get_or(&k, 0) + EV::tmod_value(&e, &m);
                m.set(&k, v);
            }
        }
        let maison = f.get("maison");
        let ch = if maison.truthy() { maison.get("chef") } else { Val::None };
        if ch.truthy() {
            // le trait du chef de la maison (game/familles.py)
            for (k, v) in R::MAISON_TRAITS().at(ch.at("trait")).at("fx").items() {
                m.set(&k, &m.get_or(&k, 0) + &v);
            }
        }
        if code != self.player {
            let d = R::DIFFICULTY().at(&self.difficulty);
            m.set("ai_income", &d.at("ai_income") - 1i64);
        }
        f.set("mods", m);
        self._dirty_income = true;
    }

    // ================================================================== boucle
    /// Python : `advance(self, real_dt)`.
    // engine.py, lignes 562 à 574
    pub fn advance(&mut self, real_dt: f64) {
        if TB::frozen(self) {
            return; // bataille en attente du choix du joueur, ou bataille tactique en cours : campagne figée
        }
        if self.tour.atb("on") {
            return TT::advance(self, real_dt); // tour par tour : jusqu'au 1er du mois suivant ou à une alerte
        }
        if self.over.truthy() || self.speed_idx == 0 {
            return;
        }
        let mut days = R::SPEEDS().atf(self.speed_idx) * real_dt;
        while days > 1e-9 && !self.over.truthy() && self.speed_idx != 0 {
            let sub = if self.battles.truthy() || self.speed_idx < R::FAST_SPEED { SUBSTEP } else { SUBSTEP * 2.0 };
            let dt = if days < sub { days } else { sub };
            self.step(dt);
            days -= dt;
        }
    }

    /// Python : `step(self, dt)`.
    /// Les IA : chacune est sortie de self.ais le temps de son pas (voir le champ `ais`).
    // engine.py, lignes 576 à 611
    pub fn step(&mut self, dt: f64) {
        self.t += dt;
        let day = py::int(self.t);
        if day != self._last_day {
            self._last_day = day;
            self.new_day();
            self.drill_tick();
        }
        // (les revenus refaits au plus tous les quarts de journée, chaque jour sur toute la France : 89 camps agissent sans
        // cesse et salissaient tout)
        if self._dirty_income && self.t - self._income_t >= (if self.factions.len() > 5 { 1.0 } else { 0.25 }) {
            self._income_t = self.t;
            self.compute_income();
        }
        self.economy(dt);
        self.update_queues(dt);
        self.move_armies(dt);
        self.land_check(dt);
        self.river_fire(dt);
        self.update_spies();
        self.update_hidden();
        self.detect_contacts(&Val::None);
        self.settle_conflicts();
        self.update_sieges(dt);
        AA::tick(self, dt, false);
        self.update_battles(dt, &Val::None);
        // l'usure varie de quelques millièmes par jour : réglée par quarts de jour (40 % du coût d'un mois sinon)
        self._att_dt += dt;
        if self._att_dt >= ATTRITION_STEP - 1e-9 {
            self.attrition(self._att_dt);
            self._att_dt = 0.0;
        }
        let codes: Vec<String> = self.ais.keys().cloned().collect();
        for code in codes {
            if !self.factions.at(&code).atb("alive") {
                continue;
            }
            let nxt = self._ai_clock.get_or(&code, 0.3 + 0.25 * self._ai_clock.len() as f64).f();
            if self.t >= nxt {
                let pas = self.ai_pas(&code);
                self._ai_clock.set(&code, self.t + pas);
                let mut ai = self.ais.get_mut(&code).unwrap().take().unwrap();
                ai.step(self);
                *self.ais.get_mut(&code).unwrap() = Some(ai);
            }
        }
    }

    /// Jours entre deux réflexions d'une IA : 1,5 ; toute la France, un camp à plus de 300 km du joueur (de chef-lieu à
    /// chef-lieu) et en paix avec lui : 3 (89 camps, c'était l'essentiel du temps d'un mois).
    /// Python : `ai_pas(self, code)`.
    // engine.py, lignes 613 à 619
    pub fn ai_pas(&self, code: &str) -> f64 {
        if self.factions.len() <= 5 || self.at_war(code, &self.player) {
            return 1.5;
        }
        let (a, b) = (self.geo.nodes.at(self.capital_of(code)), self.geo.nodes.at(self.capital_of(&self.player)));
        if py::hypot(a.atf("x") - b.atf("x"), a.atf("y") - b.atf("y")) > 300.0 { 3.0 } else { 1.5 }
    }

    // ================================================================== jours, météo, événements
    /// Python : `new_day(self)`.
    // engine.py, lignes 622 à 685
    pub fn new_day(&mut self) {
        self._dirty_income = true;
        self.soigner_generaux();
        for f in self.factions.values() {
            let acc = f.get("_acc");
            if acc.truthy() && acc.atf("dt") > 0.5 {
                let dt = acc.at("dt");
                f.set("_measured", Val::dict_from(["fer", "bois", "armes", "outils"].iter().map(|k| (Val::from(*k), &acc.at(*k) / &dt)).collect()));
                f.set("_acc", dict! {"dt" => 0.0, "fer" => 0.0, "bois" => 0.0, "armes" => 0.0, "outils" => 0.0});
            }
        }
        let season = self.season();
        for (z, w) in self.weather.items() {
            // (la boue : refaite par chaque jour de pluie, elle sèche d'un jour par jour sans pluie)
            if R::MUD_WET().has(w.at("kind")) {
                w.set("mud", if season == "été" { 1 } else { R::MUD_DAYS });
            } else if w.getb("mud") {
                w.dec("mud", 1);
            }
            w.dec("left", 1);
            if w.at("left") <= 0i64 {
                let weights = R::WEATHER_W().at(&season).copy();
                if z == "montagne" {
                    if weights.has("neige") {
                        weights.scale("neige", 3);
                    } else if season == "printemps" || season == "automne" {
                        weights.set("neige", 8);
                    }
                    weights.pop("canicule");
                } else if z == "cote" {
                    weights.set("tempete", &weights.get_or("tempete", 2) * 2i64);
                    if self.rng.random() < 0.5 {
                        weights.pop("canicule");
                    }
                }
                if season != "hiver" && z != "montagne" {
                    weights.pop("neige");
                }
                let (kinds, ws): (Vec<Val>, Vec<f64>) = weights.items().into_iter().map(|(k, v)| (k, v.f())).unzip();
                w.set("kind", self.rng.choix_pondere(&kinds, &ws));
                w.set("left", self.rng.randint(1, 4));
            }
        }
        let d = self.date(&Val::None);
        self.check_era(d);
        for (code, f) in self.factions.items() {
            let tmods = f.get("tmods");
            if tmods.truthy() && tmods.iter().any(|e| e.atf("until") <= self.t) {
                f.set("tmods", Val::list(tmods.iter().filter(|e| e.atf("until") > self.t).collect()));
                self.recompute_mods(code.s());
            }
        }
        if !self.over.truthy() {
            EV::tick(self, d);
            EV::expire(self);
        }
        CT::daily(self, d); // emplacements, collèges, événements locaux
        if d.day == 1 && py::int(self.t) > 0 {
            // (pas au premier jour de la partie : aucun mois n'a encore été joué)
            self.grow_population();
            self.monthly(d);
        }
        for f in self.factions.values() {
            if !f.atb("alive") {
                continue;
            }
            let truce = f.at("truce");
            for o in truce.iter() {
                if truce.atf(&o) < self.t {
                    truce.del(&o);
                }
            }
        }
        // propositions expirées : on le dit au joueur au lieu de les laisser disparaître
        for p in self.proposals.iter() {
            if p.atf("expires") <= self.t {
                let t = format!("La proposition de {} est restée sans réponse et a expiré.", R::FACTIONS().at(p.at("frm")).at("name"));
                self.log("diplo", &t, &dict! {"who" => p.at("frm")});
            }
        }
        self.proposals = self.proposals.iter().filter(|p| p.atf("expires") > self.t).collect();
        // prix du marché
        for r in self.market.iter() {
            let mut base = R::MARKET_BASE().atf(&r);
            if r == "vivres" {
                base *= match season.as_str() {
                    "hiver" => 1.5,
                    "printemps" => 1.1,
                    "été" => 0.85,
                    "automne" => 0.8,
                    s => panic!("KeyError: {}", py::repr_s(s)),
                };
            }
            let p = self.market.atf(&r) * (1.0 + self.rng.uniform(-0.04, 0.04));
            let (hi, x) = (base * 1.6, p * 0.9 + base * 0.1);
            let m = if x < hi { x } else { hi };
            let lo = base * 0.6;
            self.market.set(&r, py::round_n(if m > lo { m } else { lo }, 3));
        }
    }

    /// Python : `monthly(self, d)`.
    /// d : la date du jour (le 1er du mois).
    // engine.py, lignes 687 à 817
    pub fn monthly(&mut self, d: Date) {
        let season = self.season();
        RL::sabotage(self); // armées ennemies posées sur une voie ferrée
        for (code, f) in self.factions.items() {
            let code = code.s();
            if !f.atb("alive") {
                continue;
            }
            let res = f.at("res");
            if res.at("livres") > 0i64 {
                res.scale("livres", 1.0 + self.mod_(code, "interest", 0.0) / 12.0); // caisse d'épargne : tant l'an, au mois
            }
            let mine = self.owned_nodes(code);
            if d.month == 1 && self.mod_(code, "strikes", 0.0) != 0.0 {
                self.strikes(code, &mine);
            }
            if d.month == 9 || d.month == 10 {
                let mut vin = mine.iter().filter(|n| self.geo.nodes.at(n.at("id")).at("spec").has("vin")).count() as i64;
                for n in mine.iter() {
                    let star = self.geo.nodes.at(n.at("id")).get("star");
                    let s = if star.truthy() { star.at(0) } else { Val::from("") };
                    vin += R::VIN_KINDS().get_or(&s, 0).i();
                }
                if vin != 0 {
                    let gain = (18 * vin) as f64 * (1.0 + self.mod_(code, "vin", 0.0));
                    res.inc("livres", gain);
                    if code == self.player {
                        let t = format!("Vendanges : vos {} rapportent {} livres.", R::pl(vin, "vignoble", None), py::int(gain));
                        self.log("eco", &t, &dict! {"important" => true});
                    }
                }
            }
            if season == "été" && self.rng.random() < 0.10 {
                let loss = &res.at("vivres") * 0.12;
                res.dec("vivres", &loss);
                if code == self.player {
                    let t = format!("Orage de grêle : {} vivres perdus dans les champs.", py::int(loss.f()));
                    self.log("meteo", &t, &dict! {"important" => true});
                }
            }
            let held = Val::new_set();
            for a in self.armies.values() {
                if a.at("owner") == code && a.at("at_node").is_some() {
                    held.push(a.at("at_node"));
                }
            }
            for n in mine.iter() {
                let gn = self.geo.nodes.at(n.at("id"));
                if gn.at("type") == "capitale" || n.atb("garrison") || held.has(n.at("id")) || n.atb("siege") {
                    continue;
                }
                if n.atf("stab") < 0.45 && self.rng.random() < (0.45 - n.atf("stab")) * 0.5 * (1.0 + self.mod_(code, "revolt", 0.0)) {
                    let home = gn.ats("dept");
                    let back = home != code && self.factions.has(&home) && self.factions.at(&home).atb("alive");
                    n.set("owner", if back { home.as_str() } else { R::NEUTRAL });
                    n.set("assim", 1.0);
                    n.set("depot", 0);
                    n.set("milice", &n.at("milice_max") * 0.6);
                    n.set("stab", 0.8);
                    n.set("queue", list![]);
                    self._dirty_income = true;
                    if back {
                        // attachement régional : la ville se donne à sa province d'origine
                        let t = format!(
                            "Révolte à {} : fidèle à son pays, la ville chasse les autorités ({}) et retourne à {}.",
                            gn.at("name"), self.fname(code), self.fname(&home)
                        );
                        let imp = self.player == code || self.player == home;
                        self.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => &home, "important" => imp});
                    } else {
                        let why = if f.get_or("tax", 0.5) > 0.6 { "écrasée d'impôts" } else { "lasse de l'occupant" };
                        let t = format!("Révolte à {} : la population, {why}, chasse les autorités ({}).", gn.at("name"), self.fname(code));
                        let imp = code == self.player;
                        self.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => code, "important" => imp});
                    }
                } else if n.atf("stab") < 0.5 && code == self.player && self.rng.random() < 0.3 {
                    let mut cure = if f.get_or("tax", 0.5) > 0.05 { "une garnison ou des impôts plus légers" } else { "une garnison" }.to_string();
                    if f.getb("famine") {
                        cure = format!("des vivres et {cure}");
                    }
                    let t = format!(
                        "Agitation à {} (ordre public {} %) : {cure} calmeraient la population.",
                        gn.at("name"), py::int(n.atf("stab") * 100.0)
                    );
                    self.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => code});
                }
            }
            if f.getb("banqueroute") {
                let forts: Vec<Val> = mine.iter().filter(|n| n.at("fort") > 0i64 && !n.atb("siege")).collect();
                if !forts.is_empty() {
                    let n = py::max_by_key(forts, |x| {
                        (x.ati("fort"), -(self.geo.nodes.at(x.at("id")).ats("type").starts_with("cap") as i64))
                    }).unwrap();
                    self.lose_fort_level(n.ati("id"));
                    self._dirty_income = true;
                    if code == self.player {
                        let gn = self.geo.nodes.at(n.at("id"));
                        let t = format!(
                            "Trésor vide : faute d'entretien, les remparts de {} se délabrent (niveau {}).",
                            gn.at("name"), n.at("fort")
                        );
                        self.log("eco", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => code, "important" => true});
                    }
                }
            }
            for (k, v) in f.get_or("intel", dict! {}).items() {
                if v < self.t {
                    f.at("intel").del(&k);
                }
            }
            // prisonniers : quelques évasions, davantage quand le grenier est vide ; les IA enrôlent
            let pr = f.setdefault("prisoners", dict! {});
            for o in pr.iter() {
                let k = if f.getb("famine") { 0.88 } else { 0.97 };
                pr.set(&o, py::int(pr.atf(&o) * k));
                if pr.at(&o) <= 0i64 {
                    pr.del(&o);
                }
            }
            if code != self.player && pr.truthy() {
                for o in pr.iter() {
                    if o == R::NEUTRAL || f.at("res").at("recrues") < 500i64 || pr.at(&o) > 300i64 {
                        self.enroll(code, o.s());
                    }
                }
            }
        }
        // une génération pour faire sienne une place conquise
        for n in self.nodes.iter() {
            if n.at("owner") != R::NEUTRAL && n.get_or("assim", 1.0) < 1.0 {
                let x = n.atf("assim") + 1.0 / (12 * R::ASSIM_YEARS) as f64;
                n.set("assim", if x < 1.0 { x } else { 1.0 });
            }
        }
        // lassitude de la guerre : chaque mois de guerre et chaque homme perdu pèsent, la paix apaise
        for (code, f) in self.factions.items() {
            let code = code.s();
            if !f.atb("alive") {
                continue;
            }
            let wars = self
                .factions
                .keys()
                .iter()
                .filter(|o| *o != code && self.factions.at(*o).atb("alive") && self.at_war(code, o.s()))
                .count() as i64;
            let before = f.get_or("weary", 0.0).f();
            let mut delta = if wars != 0 {
                R::WEARY_PER_WAR * wars as f64 + f.get_or("_lost_m", 0.0).f() * R::WEARY_PER_LOSS
            } else {
                -R::WEARY_PEACE
            };
            // surextension : tenir des pays qui ne vous aiment pas épuise
            let unruly = self.nodes.iter().filter(|n| n.at("owner") == code && n.get_or("assim", 1.0) < 0.5).count();
            delta += R::WEARY_PER_UNRULY * unruly as f64;
            if delta > 0.0 {
                delta *= 1.0 + self.mod_(code, "weariness", 0.0); // suffrage universel
            }
            let x = before + delta;
            let x = if x < 100.0 { x } else { 100.0 };
            f.set("weary", if x > 0.0 { x } else { 0.0 });
            f.set("_lost_m", 0.0);
            let weary = f.atf("weary");
            if code == self.player && [60.0, 80.0].iter().any(|&s_| before < s_ && s_ <= weary) {
                let t = format!(
                    "Le pays est las de la guerre (lassitude {} %) : l'ordre public se dégrade partout. Songez à la paix.",
                    py::int(weary)
                );
                self.log("revolte", &t, &dict! {"important" => true});
            }
        }
        // douane : les voisins d'un camp qui taxe ses frontières l'aiment moins
        let nb = self.frontieres().0;
        for (code, f) in self.factions.items() {
            let voisins = if f.atb("alive") && f.atb("tarif") { nb.get_or(&code, tup![]) } else { tup![] };
            for o in voisins.iter() {
                let rel = self.factions.at(&o).at("rel");
                let x = &rel.at(&code) - R::DOUANE_REL * f.atf("tarif");
                rel.set(&code, if x > -100i64 { x } else { Val::from(-100) });
            }
        }
        // prestige : chaque année, le rayonnement de chacun s'ajoute à sa gloire
        if d.month == 1 {
            for (code, f) in self.factions.items() {
                if f.atb("alive") {
                    let p = &f.get_or("prestige", 0.0) + self.prestige_now(code.s()) / 10.0;
                    f.set("prestige", p);
                }
            }
            self.uprisings();
            FM::annuel(self); // naissances, morts et successions des familles dirigeantes
        }
        // désertions du mois écoulé
        for a in self.armies.values() {
            let des = py::int_v(&a.get_or("des", 0));
            if des >= 10 && a.at("owner") == self.player.as_str() {
                let why = a.get("des_why").or("moral au plus bas");
                let t = format!("Désertions dans la {} : {des} hommes ont quitté les rangs ({why}).", a.at("name"));
                self.log("armee", &t, &dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => a.at("owner"), "important" => des >= 50});
            }
            a.set("des", 0.0);
            a.set("des_why", Val::None);
        }
        if d.month == 3 && self.rng.random() < 0.2 {
            // une grande crue un printemps sur cinq environ
            self.flood_until = self.t + self.rng.randint(21, 42) as f64;
            self.log(
                "meteo",
                "Grande crue de la Garonne et de la Dordogne : bacs ralentis et routes coupées pendant quelques semaines.",
                &dict! {"important" => true},
            );
            CT::grande_crue(self);
        }
        if self.factions.at(&self.player).atb("alive") {
            let f = self.factions.at(&self.player);
            let inc = f.at("income");
            let mois = if d.month > 1 { R::MONTHS().ats(d.month - 2) } else { "décembre".to_string() };
            let t = format!(
                "Bilan {} : {} livres et {} vivres par tour.",
                R::de(&mois),
                R::num(inc.atf("livres") * TT::TOUR_DAYS, 1),
                R::num(inc.atf("vivres") * TT::TOUR_DAYS, 1)
            );
            self.log("eco", &t, &dict! {"extra" => dict! {"coins" => true}});
        }
    }
}
