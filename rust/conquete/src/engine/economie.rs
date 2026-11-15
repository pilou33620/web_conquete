//! Porte game/engine.py, lignes 819 à 1523 : économie, recrutement & construction, dégâts des villes.
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::*;

impl Game {
    // ================================================================== économie
    /// Python : `tools_bonus(self, code)`.
    /// Rend (multiplicateur des outils, couverture de 0 à 1).
    // engine.py, lignes 820 à 824
    pub fn tools_bonus(&self, code: &str) -> (f64, f64) {
        let f = self.factions.at(code);
        let nn = self.owned(code).len().max(1);
        let x = f.at("res").atf("outils") / (3.0 * nn as f64);
        let cov = if x < 1.0 { x } else { 1.0 };
        (1.0 + (0.30 + self.mod_(code, "tools_max", 0.0)) * cov, cov)
    }

    /// Ce qui ne change jamais d'une place (la carte est fixe), relevé une fois : production de base de son
    /// type, quai, terrain (landes et marais, collines et montagnes).
    /// Python : `node_static(self, nid)`.
    /// Rend (gn, {clé de PROD_KEYS: production de base}, quai, landes ou marais, collines ou montagnes), gardé dans _cache_ns.
    // engine.py, lignes 826 à 839
    pub fn node_static(&self, nid: i64) -> NodeStatic {
        let mut c = self._cache_ns.borrow_mut();
        if !matches!(&*c, Some((geo, _)) if Rc::ptr_eq(geo, &self.geo)) {
            *c = Some((self.geo.clone(), HashMap::new()));
        }
        let m = &mut c.as_mut().unwrap().1;
        if let Some(st) = m.get(&nid) {
            return st.clone();
        }
        let gn = self.geo.nodes.at(nid);
        let base = R::NODE_BASE().at(gn.at("type"));
        let ter = self.geo.terrain_at(gn.atf("x"), gn.atf("y"));
        let b0 = Val::dict_from(PROD_KEYS().iter().map(|k| (k.clone(), base.get_or(&k, 0))).collect());
        let nom = TERRAIN().at(ter).at(0);
        let st = (
            gn.clone(),
            b0,
            self.geo.ports.has(nid) && gn.at("type") != "fort",
            ter == T_LANDE || ter == T_MARAIS,
            nom == "Montagne" || nom == "Collines" || nom == "Haute montagne",
        );
        m.insert(nid, st.clone());
        st
    }

    /// Syndicats : en janvier, chaque ville à l'ordre bas fait grève et perd un tour d'industrie.
    /// Python : `strikes(self, code, mine)`.
    /// mine : la liste des places du camp.
    // engine.py, lignes 841 à 850
    pub fn strikes(&mut self, code: &str, mine: &Val) {
        for n in mine.iter() {
            let gn = self.geo.nodes.at(n.at("id"));
            if (gn.at("type") == "ville" || gn.at("type") == "capitale") && n.atf("stab") < R::STRIKE_STAB {
                let until = TT::deadline(self, 1, &[code]);
                n.setdefault("tm", list![]).push(dict! {"k" => "industrie", "v" => -1.0, "until" => until});
                self._dirty_income = true;
                if code == self.player {
                    let t = format!(
                        "Grève à {} (ordre public {} %) : les ateliers sont presque arrêtés pour un tour.",
                        gn.at("name"), py::int(n.atf("stab") * 100.0)
                    );
                    self.log("revolte", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "important" => true});
                }
            }
        }
    }

    /// Python : `node_output(self, n, code)`.
    /// Rend un dict {ressource: production par jour} (les clés de PROD_KEYS, plus celles des spécialités).
    // engine.py, lignes 852 à 896
    pub fn node_output(&mut self, n: &Val, code: &str) -> Val {
        let nid = n.ati("id");
        let (gn, b0, quai, lande, mont) = self.node_static(nid);
        let out = b0.copy();
        let mut trade = 0.0;
        for s in gn.at("spec").iter() {
            for (k, v) in R::SPEC().at(&s).items() {
                if k != "label" {
                    let mut bonus = 1.0;
                    if s == "vin" {
                        bonus += self.mod_(code, "vin", 0.0);
                    }
                    if s == "port" {
                        bonus += self.mod_(code, "port", 0.0);
                        trade += v.f() * bonus;
                    }
                    out.set(&k, &out.get_or(&k, 0) + &(&v * bonus));
                }
            }
        }
        let star = gn.get("star");
        if star.truthy() {
            let sp = R::SPECIALTY().at(star.at(0));
            let boost = sp.get("boost");
            let a = if boost.truthy() { Val::from(1.0 + self.mod_(code, boost.s(), 0.0)) } else { Val::from(1) };
            let k = &a * &(if gn.at("type") == "capitale" { Val::from(R::SPECIALTY_CAPITAL) } else { Val::from(1) });
            for r in ["livres", "vivres", "recrues", "industrie", "fer", "bois"] {
                if sp.has(r) {
                    out.set(r, &out.at(r) + &(&sp.at(r) * &k));
                }
            }
            if boost == "port" {
                trade += (&sp.get_or("livres", 0) * &k).f();
            }
        }
        if quai {
            out.inc("livres", R::QUAI_LIVRES);
            trade += R::QUAI_LIVRES;
        }
        let trade = CT::node_extra(self, n, code, &out, trade); // bâtiments, politique, événements de la ville
        if gn.at("type") == "ville" || gn.at("type") == "capitale" {
            out.scale("livres", 1.0 + self.mod_(code, "city_livres", 0.0)); // éclairage au gaz : les villes travaillent le soir
        }
        let rb = RL::town_bonus(self, nid); // voies ferrées ouvertes : industrie et commerce
        if rb != 0.0 {
            out.scale("industrie", 1.0 + rb);
            out.scale("livres", 1.0 + rb);
        }
        if self._blockade.has(nid) {
            out.dec("livres", trade * (1.0 - R::BLOCKADE_K));
        }
        let stab = n.atf("stab");
        let mut mult = self.pop_factor(n) * (if stab > 0.3 { stab } else { 0.3 }) * (0.7 + 0.3 * self.assim(n));
        mult *= 1.0 - R::DEG_PROD * n.get_or("deg", 0.0).f(); // maisons en ruine : moins de bras et d'ateliers
        if n.atb("siege") {
            mult = 0.0;
        }
        mult *= AA::output_k(self, n); // bourgeois sous les armes
        if lande {
            mult *= 1.0 + self.mod_(code, "lande_prod", 0.0);
        }
        if mont {
            mult *= 1.0 + self.mod_(code, "mountain_prod", 0.0);
        }
        Val::dict_from(out.items().into_iter().map(|(k, v)| (k, &v * mult)).collect())
    }

    /// Douane : les camps voisins de chacun (frontière commune) et ses places frontalières.
    /// Python : `frontieres(self)`.
    /// Rend (nb, front) : {code: set de codes voisins}, {code: set de numéros de places frontalières}.
    // engine.py, lignes 898 à 908
    pub fn frontieres(&self) -> (Val, Val) {
        let (nb, front) = (dict! {}, dict! {});
        for e in self.geo.edges.iter() {
            let (oa, ob) = (self.nodes.at(e.at("a")).at("owner"), self.nodes.at(e.at("b")).at("owner"));
            if oa != ob && self.factions.has(&oa) && self.factions.has(&ob) {
                nb.setdefault(&oa, pyset![]).push(&ob);
                nb.setdefault(&ob, pyset![]).push(&oa);
                front.setdefault(&oa, pyset![]).push(e.at("a"));
                front.setdefault(&ob, pyset![]).push(e.at("b"));
            }
        }
        (nb, front)
    }

    /// Part du commerce frontalier qui échappe à la douane : grandit avec le tarif, moitié moins avec des douaniers.
    /// Python : `contrebande(self, code)`.
    // engine.py, lignes 910 à 913
    pub fn contrebande(&self, code: &str) -> f64 {
        let f = self.factions.at(code);
        let x = 1.5 * R::TARIFS().at(f.at("tarif")).atf(1);
        (if x < 0.9 { x } else { 0.9 }) * (if f.atb("douaniers") { 0.5 } else { 1.0 })
    }

    /// Python : `compute_income(self)`.
    // engine.py, lignes 915 à 1035
    pub fn compute_income(&mut self) {
        self._dirty_income = false;
        let season = self.season();
        self.compute_blockades();
        let (nb, front) = self.frontieres();
        // (les places de chaque camp en un seul passage : toute la France a 2 000 places et 89 camps)
        let mut par_camp: HashMap<String, Vec<Val>> = HashMap::new();
        for n in self.nodes.iter() {
            par_camp.entry(n.ats("owner")).or_default().push(n);
        }
        for (code_v, f) in self.factions.items() {
            let code = code_v.s();
            if !f.atb("alive") {
                continue;
            }
            let (tb, cov) = self.tools_bonus(code);
            let ai = 1.0 + self.mod_(code, "ai_income", 0.0);
            let tot = dict! {"livres" => 0.0, "vivres" => 0.0, "recrues" => 0.0, "industrie" => 0.0, "fer" => 0.0, "bois" => 0.0};
            let own = par_camp.get(code).cloned().unwrap_or_default();
            let mut food0 = R::SEASON_FOOD().atf(&season);
            if season == "hiver" {
                food0 += self.mod_(code, "winter_food", 0.0);
            }
            let (mut t_l, mut t_v, mut t_r, mut t_i, mut t_f, mut t_b) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
            for n in &own {
                let gn = self.geo.nodes.at(n.at("id"));
                let o = self.node_output(n, code);
                let food = food0 * self.wx(gn.atf("x"), gn.atf("y")).atf("food");
                t_l += o.atf("livres") * tb;
                t_v += o.atf("vivres") * food * tb;
                t_r += o.atf("recrues");
                t_i += o.atf("industrie") * tb;
                t_f += o.atf("fer");
                t_b += o.atf("bois");
            }
            let tax = f.get_or("tax", 0.5).f();
            t_l *= (1.0 + self.mod_(code, "livres", 0.0)) * ai * (0.6 + 0.8 * tax);
            t_v *= (1.0 + self.mod_(code, "vivres", 0.0)) * ai;
            t_r *= 1.0 + self.mod_(code, "recrues", 0.0) + 0.3 * (0.5 - tax);
            t_i *= (1.0 + self.mod_(code, "industrie", 0.0)) * ai;
            t_f *= 1.0 + self.mod_(code, "fer", 0.0);
            t_b *= 1.0 + self.mod_(code, "bois", 0.0);
            for (k, v) in [("livres", t_l), ("vivres", t_v), ("recrues", t_r), ("industrie", t_i), ("fer", t_f), ("bois", t_b)] {
                tot.set(k, v);
            }
            // minimum garanti par le département (tant que le chef-lieu tient)
            f.set("_floor", dict! {});
            if self.nodes.at(self.capital_of(code)).at("owner") == code {
                let food = R::SEASON_FOOD().atf(&season) + if season == "hiver" { self.mod_(code, "winter_food", 0.0) } else { 0.0 };
                let traits = R::FACTIONS().at(code).at("mods");
                for (k, v) in R::FLOOR().items() {
                    let mn = &(&v * &(1 + &traits.get_or(&k, 0))) * &(if k == "vivres" { Val::from(food) } else { Val::from(1) });
                    let d = (&mn - &tot.at(&k)).f();
                    let mn_r = if mn.is_int() { mn.clone() } else { Val::from(py::round_n(mn.f(), 2)) };
                    f.at("_floor").set(&k, dict! {"min" => mn_r, "add" => py::round_n(if d > 0.0 { d } else { 0.0 }, 2)});
                    let tk = tot.at(&k);
                    tot.set(&k, if mn > tk { mn } else { tk });
                }
            }
            // commerce
            let mut trade_l = 0.0;
            let trade_s = dict! {};
            for o in f.at("trade").iter() {
                let of = self.factions.get(&o);
                if !of.truthy() || !of.atb("alive") {
                    continue;
                }
                // sa douane rogne nos gains
                let m = (1.0 + self.mod_(code, "trade", 0.0)) * (1.0 - 1.5 * R::TARIFS().at(of.at("tarif")).atf(1));
                let gl = of.get_or("_gross_livres", 0).f();
                trade_l += 0.06 * (if gl > 0.0 { gl } else { 0.0 }) * m + 1.0 * m;
                let sp = R::FACTIONS().at(&o).ats("specialty");
                let gs = of.get_or(format!("_gross_{sp}"), 0).f();
                trade_s.set(&sp, &trade_s.get_or(&sp, 0) + 0.05 * (if gs > 0.0 { gs } else { 0.0 }) * m);
            }
            f.set("_gross_livres", tot.at("livres"));
            for k in ["vivres", "fer", "bois", "recrues"] {
                f.set(format!("_gross_{k}"), tot.at(k));
            }
            tot.inc("livres", trade_l);
            for (k, v) in trade_s.items() {
                tot.set(&k, &tot.get_or(&k, 0) + &v);
            }
            // douane : le taux sur le commerce frontalier de chaque voisin, moins la contrebande
            let t = R::TARIFS().at(f.at("tarif")).atf(1);
            let vol = py::sum_v(nb.get_or(code, tup![]).iter().map(|o| {
                let g = self.factions.at(&o).get_or("_gross_livres", 0).f();
                Val::from(R::DOUANE_VOL * if g > 0.0 { g } else { 0.0 })
            }))
            .f();
            let smug = self.contrebande(code);
            let x = 1.5 * t;
            f.set(
                "_douane",
                dict! {"recette" => t * vol * (1.0 - smug), "contrebande" => t * vol * smug,
                "perte" => t * vol * (if x < 0.9 { x } else { 0.9 }), "front" => front.get_or(code, tup![]).len()},
            );
            tot.inc("livres", f.at("_douane").at("recette"));
            // tribut de vassal
            if f.atb("overlord") {
                let trib = &tot.at("livres") * 0.15;
                tot.dec("livres", &trib);
                f.set("_tribute", trib);
            } else {
                f.set("_tribute", 0);
            }
            let tribs = py::sum_v(
                self.factions.values().into_iter().filter(|v| v.at("overlord") == code && v.atb("alive")).map(|v| v.at("_tribute")),
            );
            tot.inc("livres", tribs);
            // entretien
            let (mut up_v, mut up_l) = (0.0, 0.0);
            for reg in self.all_regs(code).iter() {
                let u = R::UNITS().at(reg.at("type"));
                up_v += (&u.at("upkeep_v") * &reg.at("n")).f() / 100.0;
                up_l += (&u.at("upkeep_l") * &reg.at("n")).f() / 100.0;
            }
            up_v += AA::extra_food(self, code); // armées en quartiers
            let k_up = 1.0 + self.mod_(code, "upkeep", 0.0);
            tot.dec("vivres", up_v * k_up);
            tot.dec("livres", up_l * k_up);
            let up_f = py::sum_v(own.iter().map(|n| {
                let fo = n.ati("fort");
                R::FORT_UPKEEP().at(if R::BASTION_LEVEL < fo { R::BASTION_LEVEL } else { fo })
            }));
            tot.dec("livres", &up_f);
            let up_b = CT::upkeep(self, code); // bâtiments d'emplacement
            tot.dec("livres", up_b);
            let up_p = py::sum_v(f.get_or("prisoners", dict! {}).values()).f() * R::PRISONER_FOOD;
            tot.dec("vivres", up_p);
            let up_d = if f.atb("douaniers") { front.get_or(code, tup![]).len() as f64 * R::DOUANIERS_L } else { 0.0 };
            tot.dec("livres", up_d);
            // industrie
            let cap = tot.at("industrie");
            let s = f.atf("slider");
            let mut arm_rate = cap.f() * s * (1.0 + self.mod_(code, "armes_eff", 0.0)) * 0.5;
            let mut tool_rate = cap.f() * (1.0 - s) * 0.5;
            // les ateliers ne mangent pas la réserve (R.WORKSHOP_RESERVE) : en dessous, ils tournent avec le fer et le
            // bois du jour (une partie neuve n'est pas en déficit) ; au-dessus (achats, échanges), l'excédent aussi
            let kc = 1.0 + self.mod_(code, "tools_cost", 0.0);
            let need = [("fer", arm_rate + 0.5 * tool_rate * kc), ("bois", 0.5 * arm_rate + tool_rate * kc)];
            // (ce qui dépasse la réserve se travaille en un jour : compute_income revient chaque jour)
            let res = f.at("res");
            let mut short: Vec<(&str, f64)> = vec![];
            for (k, nd) in need {
                let r = (&res.at(k) - &R::WORKSHOP_RESERVE().at(k)).f();
                let avail = tot.atf(k) + if r > 0.0 { r } else { 0.0 };
                if nd > avail {
                    short.push((k, avail / nd));
                }
            }
            let mut work = 1.0;
            for &(_, v) in &short {
                if v < work {
                    work = v;
                }
            }
            arm_rate *= work;
            tool_rate *= work;
            f.set("_arm_rate", arm_rate);
            f.set("_tool_rate", tool_rate);
            // (la fiche du joueur : ce qui manque)
            let manque = py::min_by_key(short.iter(), |e| e.1).map(|e| e.0);
            f.set("_work", list![py::round_n(work, 2), manque]);
            f.set("_cap", &cap);
            f.set("_cov", cov);
            f.set(
                "_upkeep",
                dict! {"vivres" => up_v * k_up, "livres" => up_l * k_up, "forts" => &up_f, "prisoners" => up_p, "batiments" => up_b},
            );
            f.at("_upkeep").set("douaniers", up_d);
            f.set("_trade", trade_s.copy());
            let tr = f.at("_trade");
            tr.set("livres", &tr.get_or("livres", 0) + trade_l);
            f.set(
                "income",
                dict! {"livres" => tot.at("livres"), "vivres" => tot.at("vivres"), "fer" => &tot.at("fer") - need[0].1 * work,
                "bois" => &tot.at("bois") - need[1].1 * work, "armes" => arm_rate, "outils" => tool_rate,
                "recrues" => tot.at("recrues"), "industrie" => &cap},
            );
            f.set("_in", dict! {"fer" => tot.at("fer"), "bois" => tot.at("bois")}); // (le fer et le bois qui rentrent, avant les ateliers)
            let mes = f.get("_measured");
            if mes.truthy() {
                f.at("income").update(&mes);
            }
        }
    }

    /// places tenues par chacun (plafond des casernes, voir recruit_cap) : un seul passage sur la carte
    /// Python : `economy(self, dt)`.
    // engine.py, lignes 1037 à 1150
    pub fn economy(&mut self, dt: f64) {
        // places tenues par chacun (plafond des casernes, voir recruit_cap) : un seul passage sur la carte
        let mut held_n: HashMap<String, i64> = HashMap::new();
        for n in self.nodes.iter() {
            *held_n.entry(n.ats("owner")).or_insert(0) += 1;
        }
        for (code_v, f) in self.factions.items() {
            let code = code_v.s();
            if !f.atb("alive") {
                continue;
            }
            let r = f.at("res");
            let inc = f.at("income");
            r.inc("livres", &inc.at("livres") * dt);
            r.inc("vivres", &inc.at("vivres") * dt);
            // au-delà du plafond des casernes, plus de nouvelles recrues (mais on ne perd pas celles reçues par échange)
            let a = &r.at("recrues") + &(&inc.at("recrues") * dt);
            let plafond = Val::from(3000 + 250 * held_n.get(code).copied().unwrap_or(0));
            let rr = r.at("recrues");
            let b = if rr > plafond { rr } else { plafond };
            r.set("recrues", if b < a { b } else { a });
            let kc = 1.0 + self.mod_(code, "tools_cost", 0.0);
            // (pas d'après income, que remplace la variation mesurée la veille : un jour en baisse se répétait chaque jour)
            let (gross_fer, gross_bois) = (f.at("_in").at("fer"), f.at("_in").at("bois"));
            r.inc("fer", &gross_fer * dt);
            r.inc("bois", &gross_bois * dt);
            // fabrication limitée par les stocks
            let want_a = f.atf("_arm_rate") * dt;
            let want_t = f.atf("_tool_rate") * dt;
            let ka = if (want_a + want_t) > 0.0 {
                let mx = |x: f64| if x > 1e-9 { x } else { 1e-9 };
                let x1 = r.atf("fer") / mx(want_a * 1.0 + want_t * 0.5 * kc);
                let x2 = r.atf("bois") / mx(want_a * 0.5 + want_t * kc);
                let m = if x1 < 1.0 { x1 } else { 1.0 };
                if x2 < m { x2 } else { m }
            } else {
                0.0
            };
            let ka = if ka > 0.0 { ka } else { 0.0 };
            r.inc("armes", want_a * ka);
            r.inc("outils", want_t * ka);
            r.dec("fer", (want_a + want_t * 0.5 * kc) * ka);
            r.dec("bois", (want_a * 0.5 + want_t * kc) * ka);
            let acc = f.setdefault("_acc", dict! {"dt" => 0.0, "fer" => 0.0, "bois" => 0.0, "armes" => 0.0, "outils" => 0.0});
            acc.inc("dt", dt);
            acc.inc("fer", &(&gross_fer * dt) - (want_a + want_t * 0.5 * kc) * ka);
            acc.inc("bois", &(&gross_bois * dt) - (want_a * 0.5 + want_t * kc) * ka);
            acc.inc("armes", want_a * ka);
            acc.inc("outils", want_t * ka);
            let usure = &(&(&r.at("outils") * 0.004) * (1.0 + self.mod_(code, "tools_wear", 0.0))) * dt;
            r.dec("outils", usure);
            self._granary_dirty(code);
            let cap = self.granary_cap(code);
            if r.at("vivres") > cap {
                let k = 0.5 * dt;
                r.dec("vivres", &(&r.at("vivres") - cap) * (if k < 1.0 { k } else { 1.0 }));
            }
            for k in ["vivres", "fer", "bois"] {
                if r.at(k) < 0i64 {
                    r.set(k, 0.0);
                }
            }
            f.set("famine", r.at("vivres") <= 0.5 && inc.at("vivres") < 0i64);
            f.set("banqueroute", r.at("livres") < 0i64);
            // recherche
            for (b, cur) in f.at("research").items() {
                if cur.truthy() {
                    let w = TT::work(self, dt) * (1.0 + self.mod_(code, "research_speed", 0.0));
                    cur.dec("left", w);
                    if cur.at("left") <= 0i64 {
                        let tech = cur.at("tech");
                        f.at("research").set(&b, Val::None);
                        f.at("techs").push(&tech);
                        // (la frise des découvertes)
                        f.setdefault("tech_dates", dict! {}).set(&tech, list![self.date_str(&Val::None), py::round_n(self.t, 2)]);
                        self.recompute_mods(code);
                        if code == self.player {
                            let mut arm = Val::None;
                            'cherche: for c in R::ARMS().iter() {
                                let l = R::ARMS().at(&c);
                                for i in 0..l.len() {
                                    if l.at(i).at(0) == tech {
                                        arm = l.at(i).at(1);
                                        break 'cherche;
                                    }
                                }
                            }
                            let suite = if arm.truthy() {
                                format!(
                                    " Nouvel armement ({arm}) pour les régiments levés désormais ; réarmez les anciens dans vos places (bouton « Réarmer »)."
                                )
                            } else {
                                String::new()
                            };
                            let t = format!("Découverte : {}.{suite}", R::TECH().at(&tech).at("name"));
                            self.log("tech", &t, &dict! {"important" => true, "extra" => dict! {"tech" => &tech}});
                        } else if R::NOTABLE_TECHS().has(&tech) {
                            // une découverte d'une IA qui se voit (sur la carte, en bataille) : un bandeau, sans arrêter le jeu
                            let t = format!("{} découvre : {}.", self.faction_name(code), R::TECH().at(&tech).at("name"));
                            self.log("tech_ia", &t, &dict! {"who" => code, "extra" => dict! {"tech" => &tech}});
                        }
                    }
                }
            }
        }
        // milice et stabilité (l'ordre public tend vers une cible : impôts, famine, banqueroute, garnison) :
        // évolutions lentes, calculées par paquets d'un quart de jour pour ménager les petites machines
        self._slow_dt += dt;
        if self._slow_dt < 0.25 {
            return;
        }
        let dt = self._slow_dt;
        self._slow_dt = 0.0;
        let targets = self.stab_targets();
        let mut held: HashMap<i64, Vec<Val>> = HashMap::new();
        for a in self.armies.values() {
            let an = a.at("at_node");
            if an.is_some() {
                let s = held.entry(an.i()).or_default();
                let o = a.at("owner");
                if !s.contains(&o) {
                    s.push(o);
                }
            }
        }
        // ce qui ne dépend que du maître de la place (rien ne le change dans cette boucle)
        let mut per: HashMap<String, (Val, f64, f64, f64, f64)> = HashMap::new();
        for n in self.nodes.iter() {
            if n.atb("siege") {
                continue;
            }
            let code = n.ats("owner");
            let pc = match per.get(&code) {
                Some(pc) => pc.clone(),
                None => {
                    let pc = if code == R::NEUTRAL {
                        (Val::from(1 + 0), 1.0, 0.0, 1.0, 1.0)
                    } else {
                        let fc = self.factions.at(&code);
                        let x = 0.5 - fc.get_or("tax", 0.5).f();
                        (
                            Val::from(1.0 + self.mod_(&code, "milice", 0.0)),
                            targets.get_or(&code, 1.0).f(),
                            fc.get_or("weary", 0).f() / 250.0,
                            1.0 + (if x > 0.0 { x } else { 0.0 }) * 2.0,
                            1.0 + self.mod_(&code, "stab", 0.0),
                        )
                    };
                    per.insert(code.clone(), pc.clone());
                    pc
                }
            };
            let (k, tgt0, weary, boost0, kstab) = pc;
            let mm = &n.at("milice_max") * &k;
            if n.at("milice") < mm {
                let x = &n.at("milice") + &(&(&mm * 0.012) * dt);
                n.set("milice", if x < mm { x } else { mm });
            }
            let (tgt, boost);
            if code == R::NEUTRAL {
                (tgt, boost) = (1.0, 1.0);
            } else {
                let mut t = tgt0;
                t -= 0.2 * (1.0 - self.assim(&n)) + weary;
                let friends = held.get(&n.ati("id")).is_some_and(|s| s.iter().any(|o| self.friendly(&code, o.s())));
                if n.atb("garrison") || friends || self.geo.nodes.at(n.at("id")).at("type") == "capitale" {
                    t += 0.15;
                }
                t += AA::stab_bonus(self, &n);
                t += CT::stab_bonus(self, &n); // hospices, politique de la ville
                let t1 = if t < 1.0 { t } else { 1.0 };
                tgt = if t1 > 0.1 { t1 } else { 0.1 };
                boost = boost0;
            }
            let stab = n.atf("stab");
            if stab < tgt {
                let rate = 0.012 * boost * kstab;
                let x = stab + rate * dt;
                n.set("stab", if x < tgt { x } else { tgt });
            } else if stab > tgt {
                let x = stab - 0.01 * dt;
                n.set("stab", if x > tgt { x } else { tgt });
            }
            // renfort des garnisons
            if code != R::NEUTRAL && n.atb("garrison") {
                self.replenish(&code, &n.at("garrison"), dt, 0.04);
            }
        }
    }

    /// Attachement à son nouveau maître : 1 dans sa province d'origine, de 0 à 1 en une génération ailleurs.
    /// Python : `assim(self, n)`.
    // engine.py, lignes 1152 à 1156
    pub fn assim(&self, n: &Val) -> f64 {
        let owner = n.at("owner");
        if owner == self.geo.nodes.at(n.at("id")).at("dept") || owner == R::NEUTRAL {
            return 1.0;
        }
        n.get_or("assim", 1.0).f()
    }

    /// Multiplicateur de production d'une place : il suit sa population.
    /// Python : `pop_factor(self, n)`.
    /// (Garde dans _cache_rel la part de chaque place, tant que _pcache est le même dict.)
    // engine.py, lignes 1158 à 1174
    pub fn pop_factor(&self, n: &Val) -> f64 {
        if !n.has("pop") {
            return 1.0 + 0.25 * n.at("dev").f();
        }
        // remplissage de la place (au plus 110 %, réfugiés compris), multiplié par ce que ses faubourgs font produire
        // (30 % de la production de 1790 par agrandissement) ; la croissance séculaire n'en donne que la racine
        // (les métiers suivent), et une place qui grandit plus vite que les autres n'en tire qu'un peu plus
        // (racine quatrième de sa trajectoire, moyenne normalisée à 1 sur toute la carte)
        let c = self._pop_curves();
        let rel = {
            let mut r = self._cache_rel.borrow_mut();
            if !matches!(&*r, Some((c0, _)) if c0.is(&c)) {
                // part de chaque place dans la croissance (ne change qu'avec les courbes, une fois par mois)
                let mean_k = c.atf("mean_k");
                let v = c.at("mult").iter().map(|m| py::pow(m.f(), R::POP_TREND_K) / mean_k).collect();
                *r = Some((c.clone(), v));
            }
            r.as_ref().unwrap().1[n.ati("id") as usize]
        };
        let era = self.pop_era(&Val::None);
        let cap = self.pop_cap(n);
        let x = n.atf("pop") / (if cap > 1.0 { cap } else { 1.0 });
        let fill = if x < 1.1 { x } else { 1.1 };
        fill * (1.0 + (R::POP_NATURAL + R::DEV_PROD * n.at("dev").f()) / era) * py::pow(era, 0.5) * rel
    }

    /// Population que la place peut loger : sa normale de l'époque, plus 10 % par agrandissement.
    /// Python : `pop_cap(self, n)`.
    // engine.py, lignes 1176 à 1178
    pub fn pop_cap(&self, n: &Val) -> f64 {
        self.pop_norm(n) * (1.0 + R::POP_NATURAL + R::POP_PER_LEVEL * n.at("dev").f())
    }

    /// Part de la place libre comblée en un mois (négative : part des habitants qui s'en vont).
    /// Python : `pop_growth(self, n)`.
    // engine.py, lignes 1180 à 1202
    pub fn pop_growth(&mut self, n: &Val) -> f64 {
        let o = n.at("owner");
        let s = n.at("siege");
        if s.truthy() {
            if s.getb("occupy") {
                return 0.0; // ralliement : on attend de voir
            }
            // plus le siège dure, plus on fuit (ou on meurt de faim derrière les remparts)
            let months = py::int((self.t - s.get_or("since", self.t).f()) / 30.0);
            let x = R::POP_SIEGE + 0.01 * months as f64;
            return if self.pop_above_floor(n) { -(if x < 0.05 { x } else { 0.05 }) } else { 0.0 };
        }
        let f = self.factions.get(&o);
        if f.truthy() && (f.getb("famine") || n.atf("stab") < R::POP_UNREST) {
            if !self.pop_above_floor(n) {
                // la place a touché le fond : les familles reviennent peu à peu, malgré tout
                return if n.atf("pop") < self.pop_norm(n) * R::POP_FLOOR { R::POP_RETURN } else { 0.0 };
            }
            return if f.getb("famine") { -R::POP_FAMINE } else { -R::POP_UNREST_RATE };
        }
        let x = (n.atf("stab") - 0.3) / 0.7;
        let x = if x < 1.0 { x } else { 1.0 };
        let mut rate = R::POP_RATE * (if x > 0.0 { x } else { 0.0 });
        if f.truthy() && f.get_or("tax", 0.5) > 0.6 {
            let y = 1.0 - (f.atf("tax") - 0.6) * 2.5;
            rate *= if y > 0.0 { y } else { 0.0 };
        }
        rate *= CT::growth_k(self, n); // hospices, politique de la ville
        if n.atf("pop") < self.pop_norm(n) * R::POP_FLOOR {
            rate = if R::POP_RETURN > rate { R::POP_RETURN } else { rate };
        }
        rate
    }

    /// Reste-t-il des habitants à faire fuir ? (plancher : 50 % de la normale, 30 % sous un siège)
    /// Python : `pop_above_floor(self, n)`.
    // engine.py, lignes 1204 à 1206
    pub fn pop_above_floor(&self, n: &Val) -> bool {
        n.atf("pop") > self.pop_norm(n) * (if n.atb("siege") { R::POP_FLOOR_SIEGE } else { R::POP_FLOOR }) + 1.0
    }

    /// Chaque mois, chaque place tend vers sa population normale (sa trajectoire, plus la place gagnée par ses
    /// agrandissements). Sièges et désordre font fuir les habitants vers les places sûres du même camp ;
    /// la disette les chasse au loin.
    /// Python : `grow_population(self)`.
    // engine.py, lignes 1208 à 1239
    pub fn grow_population(&mut self) {
        let mut fled: HashMap<String, f64> = HashMap::new();
        for n in self.nodes.iter() {
            n.set("rf", 0);
            let cap = self.pop_cap(&n);
            let g = self.pop_growth(&n);
            let pop = n.atf("pop");
            if g < 0.0 {
                // la fuite ralentit à l'approche du plancher : une disette qui dure ne vide pas tout le pays
                let floor = self.pop_norm(&n) * (if n.atb("siege") { R::POP_FLOOR_SIEGE } else { R::POP_FLOOR });
                let (a, b) = (pop * -g, pop - floor);
                let m = if b < a { b } else { a };
                let lost = if m > 0.0 { m } else { 0.0 };
                n.set("pop", pop - lost);
                let owner = n.ats("owner");
                let f = self.factions.get(&owner);
                if f.truthy() && !f.getb("famine") {
                    *fled.entry(owner).or_insert(0.0) += lost * R::POP_REFUGE;
                }
            } else if pop < cap {
                n.set("pop", pop + (cap - pop) * g);
            } else {
                // trop de monde pour la place (campagne qui se vide, réfugiés) : le surplus s'en va peu à peu
                n.set("pop", pop - (pop - cap) * R::POP_EXCESS);
            }
        }
        for (code, f) in self.factions.items() {
            let k = fled.get(code.s()).copied().unwrap_or(0.0) + f.get_or("refu", 0.0).f();
            f.set("refu", 0.0);
            if k >= 1.0 && f.atb("alive") {
                self.shelter(code.s(), k);
            }
        }
        for n in self.nodes.iter() {
            let ph = n.setdefault("ph", list![]);
            ph.push(py::int(n.atf("pop")));
            let garde = ph.slice(Some(-13), None).vec();
            ph.replace_all(garde);
        }
        self._dirty_income = true;
    }

    /// Des réfugiés gagnent les places sûres de leur camp, au prorata de la place libre ; les autres s'exilent.
    /// Python : `shelter(self, code, k)`.
    /// k : le nombre de réfugiés. Rend ceux qui ont trouvé place (0.0 : aucune place sûre).
    // engine.py, lignes 1241 à 1253
    pub fn shelter(&mut self, code: &str, k: f64) -> f64 {
        let mut room = vec![];
        for n in self.owned_nodes(code).iter() {
            if !n.atb("siege") && n.atf("stab") >= R::POP_SAFE_STAB {
                let x = self.pop_cap(&n) * 1.1 - n.atf("pop");
                room.push((n, if x > 0.0 { x } else { 0.0 }));
            }
        }
        let tot = py::sum(room.iter().map(|e| e.1));
        if tot < 1.0 {
            return 0.0;
        }
        let k = if tot < k { tot } else { k };
        for (n, r) in &room {
            let add = k * r / tot;
            n.inc("pop", add);
            n.set("rf", &n.get_or("rf", 0) + py::int(add));
        }
        k
    }

    /// Population de ces places aujourd'hui et il y a un an (ou au plus loin dont on se souvienne).
    /// Python : `pop_year(self, nodes)`.
    /// nodes : une liste de places. Rend (aujourd'hui, il y a un an).
    // engine.py, lignes 1255 à 1259
    pub fn pop_year(&self, nodes: &Val) -> (f64, f64) {
        let now = py::sum_v(nodes.iter().map(|n| n.get_or("pop", 0))).f();
        let before = py::sum_v(nodes.iter().map(|n| n.get("ph").or(list![n.get_or("pop", 0)]).at(0))).f();
        (now, before)
    }

    /// Python : `recruit_cap(self, code)`.
    // engine.py, lignes 1261 à 1262
    pub fn recruit_cap(&self, code: &str) -> i64 {
        3000 + 250 * self.owned(code).len() as i64
    }

    /// Recrues venues d'ailleurs (échange, prisonniers) : pas au-delà de ce que les casernes peuvent loger.
    /// Python : `add_recrues(self, code, n)`.
    /// Rend ce qui a été accueilli.
    // engine.py, lignes 1264 à 1270
    pub fn add_recrues(&mut self, code: &str, n: f64) -> f64 {
        let r = self.factions.at(code).at("res");
        let d = Val::from(self.recruit_cap(code)) - r.at("recrues");
        let room = if d > 0.0 { d } else { Val::from(0.0) };
        let nf = Val::from(n);
        let got = if room < nf { room } else { nf };
        r.inc("recrues", &got);
        got.f()
    }

    /// Python : `_granary_dirty(self, code)`.
    /// (Rend toujours False.)
    // engine.py, lignes 1272 à 1277
    pub fn _granary_dirty(&mut self, code: &str) -> bool {
        let f = self.factions.at(code);
        if f.get_or("_nn_t", -1) != py::int(self.t) {
            f.set("_nn_t", py::int(self.t));
            f.set("_nn", self.owned(code).len().max(1));
        }
        false
    }

    /// Python : `granary_cap(self, code)`.
    // engine.py, lignes 1279 à 1280
    pub fn granary_cap(&self, code: &str) -> f64 {
        (600 + 70 * self.factions.at(code).get_or("_nn", 1).i()) as f64 * (1.0 + self.mod_(code, "granary", 0.0))
    }

    /// Python : `replenish(self, code, regs, dt, rate)`.
    /// regs : une liste de régiments (garnison ou armée).
    // engine.py, lignes 1282 à 1288
    pub fn replenish(&mut self, code: &str, regs: &Val, dt: f64, rate: f64) {
        let top = 100.0 + self.mod_(code, "morale", 0.0);
        for reg in regs.iter() {
            if reg.at("n") < reg.at("max") {
                let k = if AA::monte(&reg) { R::REPL_MONTE } else { 1.0 };
                let a = (&reg.at("max") - &reg.at("n")).f();
                let b = reg.atf("max") * rate * k * dt;
                self.reinforce(code, &reg, if b < a { b } else { a });
            }
            let x = reg.atf("morale") + 6.0 * dt;
            reg.set("morale", if x < top { x } else { top });
        }
    }

    /// Verse add recrues au régiment s'il y a de quoi les armer ; les conscrits diluent l'expérience des anciens.
    /// Python : `reinforce(self, code, reg, add)`.
    // engine.py, lignes 1290 à 1299
    pub fn reinforce(&mut self, code: &str, reg: &Val, add: f64) -> bool {
        let r = self.factions.at(code).at("res");
        if add <= 0.0 || r.at("recrues") < add || r.at("armes") < add * R::REPL_ARMES {
            return false;
        }
        r.dec("recrues", add);
        r.dec("armes", add * R::REPL_ARMES);
        let xp0 = R::UNITS().at(reg.at("type")).get_or("xp0", 0).f();
        let n = reg.atf("n");
        reg.set("xp", (reg.atf("xp") * n + xp0 * add) / (n + add));
        reg.inc("n", add);
        true
    }

    /// Retire de l'armée les régiments réduits à rien (moins de 5 hommes), en gardant leur souvenir (bury).
    /// Python : `prune(self, a)`.
    // engine.py, lignes 1301 à 1306
    pub fn prune(&mut self, a: &Val) {
        if a.at("regs").iter().any(|r| r.at("n") < 5i64) {
            let ro: Val = a.at("regs").iter().map(|r| list![r.at("id"), r.at("type")]).collect();
            a.set("regs", Val::list(a.at("regs").iter().filter(|r| r.at("n") >= 5i64).collect()));
            self.bury(a, &ro);
        }
    }

    /// Régiments de la liste ro ([id, type], dans l'ordre de l'armée) qui n'y sont plus : on note leur rang, donc leur
    /// numéro, pour pouvoir les relever (army_actions.relever) ; les plus anciens sont oubliés.
    /// Python : `bury(self, a, ro)`.
    /// ro : une liste de [id, type].
    // engine.py, lignes 1308 à 1316
    pub fn bury(&mut self, a: &Val, ro: &Val) {
        let ids = Val::set_from(a.at("regs").iter().map(|r| r.at("id")).collect());
        let old: Vec<Val> = a
            .get("morts")
            .or(list![])
            .iter()
            .filter(|m| m.atf(3) > self.t - AA::MORTS_JOURS as f64 && !ids.has(m.at(2)))
            .collect();
        let seen = Val::set_from(old.iter().map(|m| m.at(2)).collect());
        let mut morts = old;
        for (i, e) in ro.iter().enumerate() {
            let (rid, typ) = e.pair();
            if !ids.has(&rid) && !seen.has(&rid) {
                morts.push(list![i, typ, rid, self.t]);
            }
        }
        a.set("morts", Val::list(morts));
        if !a.atb("morts") {
            a.del("morts");
        }
    }

    /// Python : `all_regs(self, code)`.
    /// Un générateur en Python ; ici la liste (neuve) des régiments du camp : garnisons de ses places, puis armées.
    // engine.py, lignes 1318 à 1324
    pub fn all_regs(&self, code: &str) -> Val {
        let mut v = vec![];
        for n in self.owned(code) {
            v.extend(n.at("garrison").iter());
        }
        for a in self.armies.values() {
            if a.at("owner") == code {
                v.extend(a.at("regs").iter());
            }
        }
        Val::list(v)
    }

    // ================================================================== recrutement & construction
    /// Python : `unit_cost(self, code, typ)`.
    /// Rend un dict {ressource: quantité} (une copie).
    // engine.py, lignes 1327 à 1339
    pub fn unit_cost(&self, code: &str, typ: &str) -> Val {
        let c = R::UNITS().at(typ).at("cost").copy();
        let mut k = 1.0 + self.mod_(code, "recruit_cost", 0.0);
        if typ == "artillerie" {
            k += self.mod_(code, "art_cost", 0.0);
        }
        if typ == "cavalerie" {
            k += self.mod_(code, "cav_cost", 0.0);
        }
        c.set("livres", py::round(c.atf("livres") * (if k > 0.4 { k } else { 0.4 })));
        if typ == "ligne" {
            c.set("armes", py::round(c.atf("armes") * (1.0 + self.mod_(code, "ligne_armes", 0.0))));
        }
        if typ == "artillerie" {
            let k = 1.0 + self.mod_(code, "art_cost", 0.0);
            c.set("fer", py::round(c.atf("fer") * (if k > 0.4 { k } else { 0.4 })));
        }
        c
    }

    /// Python : `unit_days(self, code, typ)`.
    /// (Au moins 3 : un entier en Python dans ce cas.)
    // engine.py, lignes 1341 à 1347
    pub fn unit_days(&self, code: &str, typ: &str) -> f64 {
        let mut d = R::UNITS().at(typ).atf("days") * (1.0 + self.mod_(code, "train", 0.0));
        if typ == "artillerie" {
            d *= 1.0 + self.mod_(code, "art_train", 0.0);
        }
        if typ == "cavalerie" {
            d *= 1.0 + self.mod_(code, "cav_train", 0.0);
        }
        if d > 3.0 { d } else { 3.0 }
    }

    /// Python : `can_pay(self, code, cost)`.
    /// cost : un dict {ressource: quantité}.
    // engine.py, lignes 1349 à 1351
    pub fn can_pay(&self, code: &str, cost: &Val) -> bool {
        let r = self.factions.at(code).at("res");
        cost.items().iter().all(|(k, v)| r.get_or(k, 0) >= *v)
    }

    /// Python : `pay(self, code, cost)`.
    /// cost : un dict {ressource: quantité}.
    // engine.py, lignes 1353 à 1356
    pub fn pay(&mut self, code: &str, cost: &Val) {
        let r = self.factions.at(code).at("res");
        for (k, v) in cost.items() {
            r.dec(&k, &v);
        }
    }

    /// Python : `recruit(self, code, nid, typ)`.
    /// typ : vient tel quel du navigateur.
    // engine.py, lignes 1358 à 1376
    pub fn recruit(&mut self, code: &str, nid: i64, typ: &Val) -> (bool, String) {
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        if n.at("owner") != code {
            return (false, "Cette ville ne vous appartient pas.".to_string());
        }
        let (ok, why) = self.can_recruit(code, nid, typ);
        if !ok {
            return (false, why);
        }
        if n.atb("siege") {
            return (false, "La place est assiégée.".to_string());
        }
        if n.at("queue").len() >= 4 {
            return (false, "File de production pleine (4 maximum).".to_string());
        }
        let typ = typ.s();
        let cost = self.unit_cost(code, typ);
        if !self.can_pay(code, &cost) {
            return (false, "Ressources insuffisantes.".to_string());
        }
        self.pay(code, &cost);
        let days = self.unit_days(code, typ) * CT::train_k(self, &n, typ); // casernes, place d'armes
        n.at("queue").push(dict! {"kind" => "unit", "what" => typ, "left" => days, "total" => days});
        (true, format!("{} en formation à {}.", self.unit_name(code, typ).0, gn.at("name")))
    }

    /// Prix d'une construction pour ce camp (le ciment le réduit) ; l'interface fait le même calcul (ui.js, buildK).
    /// Python : `build_cost(self, code, cost)`.
    /// cost : un dict {ressource: quantité} (R::BUILD_cost(quoi, lvl)…). Rend un dict {ressource: entier}.
    // engine.py, lignes 1378 à 1381
    pub fn build_cost(&self, code: &str, cost: &Val) -> Val {
        let k = 1.0 + self.mod_(code, "build_cost", 0.0);
        Val::dict_from(cost.items().into_iter().map(|(r, v)| (r, Val::from((v.f() * k).ceil() as i64))).collect())
    }

    /// Python : `build_days(self, code, days)`.
    // engine.py, lignes 1383 à 1384
    pub fn build_days(&self, code: &str, days: f64) -> f64 {
        days * (1.0 + self.mod_(code, "build_cost", 0.0))
    }

    /// Python : `build(self, code, nid, what)`.
    /// what : vient tel quel du navigateur ('fort', 'dev', 'depot', 'repar'… ; b['cost'](l) : R::BUILD_cost).
    // engine.py, lignes 1386 à 1417
    pub fn build(&mut self, code: &str, nid: i64, what: &Val) -> (bool, String) {
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        if n.at("owner") != code {
            return (false, "Cette ville ne vous appartient pas.".to_string());
        }
        if *what == "depot" {
            return CT::slot_build(self, code, nid, "depot"); // le magasin aux vivres occupe un emplacement
        }
        if *what == "repar" {
            return self.repair(code, nid);
        }
        let b = R::BUILD().get(what);
        if !b.truthy() {
            return (false, "Construction inconnue.".to_string());
        }
        let what = what.s();
        let lvl = if what == "fort" { n.ati("fort") } else { n.ati("dev") };
        let pending = n.at("queue").iter().filter(|q| q.at("kind") == "build" && q.at("what") == what).count() as i64;
        let top = if what == "fort" { self.fort_max(code, nid) } else { b.ati("max") };
        if lvl + pending >= top {
            if what == "fort" && top < R::BASTION_LEVEL && R::BASTION_TYPES().has(gn.at("type")) {
                return (false, "Niveau maximal : les bastions demandent la technologie « Fortifications à la Vauban ».".to_string());
            }
            return (false, "Niveau maximal atteint.".to_string());
        }
        if n.at("queue").len() >= 4 {
            return (false, "File de production pleine.".to_string());
        }
        let cost = self.build_cost(code, &R::BUILD_cost(what, lvl + pending));
        if !self.can_pay(code, &cost) {
            return (false, "Ressources insuffisantes.".to_string());
        }
        self.pay(code, &cost);
        let days = self.build_days(code, R::BUILD_days(what, lvl + pending).f());
        n.at("queue").push(dict! {"kind" => "build", "what" => what, "left" => days, "total" => days});
        if what == "fort" && lvl + pending + 1 == R::BASTION_LEVEL {
            return (true, format!("Bastions à la Vauban lancés à {}.", gn.at("name")));
        }
        if what == "dev" {
            let nom = R::DEV_NAMES().at(gn.at("type")).at(lvl + pending + 1).s().to_lowercase();
            return (true, format!("Agrandissement de {} lancé : {nom}.", gn.at("name")));
        }
        (true, format!("{} lancées à {}.", b.at("name"), gn.at("name")))
    }

    // ------------------------------------------------------------------ dégâts des villes
    /// La ville prend x de dégâts de plus (0 à 1) : les nouveaux tombent sur ce qui reste debout.
    /// Python : `damage_town(self, n, x)`.
    // engine.py, lignes 1420 à 1425
    pub fn damage_town(&mut self, n: &Val, x: f64) {
        if x <= 0.0 {
            return;
        }
        let v = 1.0 - (1.0 - n.get_or("deg", 0.0).f()) * (1.0 - x);
        n.set("deg", py::round_n(if v < 1.0 { v } else { 1.0 }, 4));
        self._dirty_income = true;
    }

    /// Réparations de la ville : (tours, coût), ou None s'il n'y a rien à réparer.
    /// Python : `repair_quote(self, code, n)`.
    /// Rend Some((tours, dict du coût)).
    // engine.py, lignes 1427 à 1434
    pub fn repair_quote(&self, code: &str, n: &Val) -> Option<(i64, Val)> {
        let deg = n.get_or("deg", 0.0).f();
        if deg < 0.02 {
            return None;
        }
        let k = deg * CT::SIZE_COST().atf(self.geo.nodes.at(n.at("id")).at("type"));
        let c = (deg * R::REPAR_TOURS as f64 - 1e-9).ceil() as i64;
        let tours = if c > 1 { c } else { 1 };
        let cost = Val::dict_from(R::REPAR_COST().items().into_iter().map(|(r, v)| (r, &v * k)).collect());
        Some((tours, self.build_cost(code, &cost)))
    }

    /// Python : `repair(self, code, nid)`.
    // engine.py, lignes 1436 à 1454
    pub fn repair(&mut self, code: &str, nid: i64) -> (bool, String) {
        let n = self.nodes.at(nid);
        let gn = self.geo.nodes.at(nid);
        let q = self.repair_quote(code, &n);
        let Some((tours, cost)) = q else {
            return (false, "Il n'y a rien à réparer.".to_string());
        };
        if n.atb("siege") {
            return (false, "On ne rebâtit pas une ville assiégée.".to_string());
        }
        if n.at("queue").iter().any(|x| x.at("kind") == "build" && x.at("what") == "repar") {
            return (false, "Les réparations sont déjà en chantier.".to_string());
        }
        if n.at("queue").len() >= 4 {
            return (false, "File de production pleine.".to_string());
        }
        if !self.can_pay(code, &cost) {
            return (false, "Ressources insuffisantes.".to_string());
        }
        self.pay(code, &cost);
        let days = TT::TOUR_DAYS * tours as f64; // (un tour de travail par tour : la file n'en fait pas plus)
        n.at("queue").push(dict! {"kind" => "build", "what" => "repar", "left" => days, "total" => days});
        (true, format!("Réparations lancées à {} : {tours} tour{}.", gn.at("name"), if tours > 1 { "s" } else { "" }))
    }

    /// Python : `update_queues(self, dt)`.
    // engine.py, lignes 1456 à 1506
    pub fn update_queues(&mut self, dt: f64) {
        let w0 = TT::work(self, dt); // capacité par tour : un mois de travail, quelle que soit sa longueur
        RL::tick(self, w0); // chantiers des voies ferrées, menés à part (game/rails.py)
        for n in self.nodes.iter() {
            if !n.atb("queue") || n.atb("siege") || n.at("owner") == R::NEUTRAL {
                continue;
            }
            let mut w = w0;
            while w > 1e-9 && n.atb("queue") {
                let q = n.at("queue").at(0);
                q.dec("left", w);
                if q.atf("left") > 1e-6 {
                    break;
                }
                let x = -q.atf("left");
                w = if x > 0.0 { x } else { 0.0 }; // le surplus passe à l'élément suivant de la file
                n.at("queue").pop(0);
                let gn = self.geo.nodes.at(n.at("id"));
                let (gx, gy) = (gn.at("x"), gn.at("y"));
                if q.at("kind") == "unit" {
                    let owner = n.ats("owner");
                    let what = q.ats("what");
                    let reg = self.new_reg(&what, &Val::None, &Val::from(&owner));
                    let morale = &(70 + &R::UNITS().at(&what).get_or("morale0", 0)) + self.mod_(&owner, "morale", 0.0);
                    reg.set("morale", morale);
                    reg.inc("xp", CT::train_xp(self, &n)); // école militaire, place d'armes
                    n.at("garrison").push(&reg);
                    if owner == self.player {
                        let t = format!("Régiment levé à {} : {}.", gn.at("name"), self.unit_name(&owner, &what).0.to_lowercase());
                        self.log("armee", &t, &dict! {"x" => &gx, "y" => &gy});
                    }
                } else if q.at("kind") == "slot" {
                    CT::finish(self, &n, &q); // bâtiment d'emplacement
                } else {
                    let what = q.ats("what");
                    if what == "fort" {
                        let f1 = n.ati("fort") + 1;
                        n.set("fort", if f1 < R::BASTION_LEVEL { f1 } else { R::BASTION_LEVEL });
                        n.inc("milice_max", 40);
                    } else if what == "repar" {
                        n.set("deg", 0.0);
                        self._dirty_income = true;
                        if n.at("owner") == self.player.as_str() {
                            let t = format!("{} est rebâtie : la ville retrouve toute sa production.", gn.at("name"));
                            self.log("eco", &t, &dict! {"x" => &gx, "y" => &gy});
                        }
                        continue;
                    } else if what == "depot" {
                        n.set("depot", 1);
                        if n.at("owner") == self.player.as_str() {
                            let t = format!("Magasin aux vivres construit à {}.", gn.at("name"));
                            self.log("eco", &t, &dict! {"x" => &gx, "y" => &gy});
                        }
                        continue;
                    } else {
                        let d1 = n.ati("dev") + 1;
                        n.set("dev", if d1 < 3 { d1 } else { 3 });
                        n.inc("milice_max", &R::NODE_BASE().at(gn.at("type")).at("milice") * 0.15);
                        self._dirty_income = true;
                        if n.at("owner") == self.player.as_str() {
                            let t = format!(
                                "{} s'agrandit ({}) : de nouveaux habitants vont venir s'y installer.",
                                gn.at("name"),
                                R::DEV_NAMES().at(gn.at("type")).at(n.at("dev")).s().to_lowercase()
                            );
                            self.log("eco", &t, &dict! {"x" => &gx, "y" => &gy});
                        }
                        continue;
                    }
                    self._dirty_income = true;
                    if n.at("owner") == self.player.as_str() {
                        let t = format!("{} terminées à {}.", R::BUILD().at(&what).at("name"), gn.at("name"));
                        self.log("eco", &t, &dict! {"x" => &gx, "y" => &gy});
                    }
                }
            }
        }
    }

    /// Python : `research(self, code, tech)`.
    /// tech : vient tel quel du navigateur.
    // engine.py, lignes 1508 à 1523
    pub fn research(&mut self, code: &str, tech: &Val) -> (bool, String) {
        let f = self.factions.at(code);
        let t = R::TECH().get(tech);
        if !t.truthy() {
            return (false, "Technologie inconnue.".to_string());
        }
        if f.at("techs").has(tech) {
            return (false, "Déjà connue.".to_string());
        }
        if f.at("research").atb(t.at("branch")) {
            return (false, "Une recherche est déjà en cours dans cette branche.".to_string());
        }
        if t.at("req").iter().any(|r| !f.at("techs").has(&r)) {
            return (false, "Prérequis manquants.".to_string());
        }
        if f.at("res").at("livres") < t.at("cost") {
            return (false, "Livres insuffisantes.".to_string());
        }
        f.at("res").dec("livres", t.at("cost"));
        f.at("research").set(t.at("branch"), dict! {"tech" => tech, "left" => t.at("days"), "total" => t.at("days")});
        (true, format!("Recherche lancée : {}.", t.at("name")))
    }
}
