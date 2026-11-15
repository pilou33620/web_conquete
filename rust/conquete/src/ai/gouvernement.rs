//! Porte game/ai.py, lignes 281 à 1177 : économie, trésor (dépenser ce qui dort), recherche, recrutement,
//! militaire, diplomatie.
//!
//! L'IA ne garde pas la partie (`self.g` du Python) : chaque méthode la reçoit, `g: &Game` ou `g: &mut Game`, juste
//! après `self` ; `self.f` (propriété) s'écrit `self.f(g)`, `self.rally` (propriété) `self.rally(g)`. Pour la faire
//! agir, la partie la sort de `g.ais` (voir `Game::ais`). `a` = une armée ; `n` = une place ; `nid` = un numéro de
//! place ; `o` = un autre camp ; `wars` = la liste des camps en guerre avec nous (self.wars(g)) ; `res` = le trésor de
//! guerre (self.reserve(g)) ; `budget`, `excess` = des livres. `self.cool` : {tuple: échéance} (clés de 2 ou 3
//! éléments : `tup![o, "passage"]`, `tup!["go", aid, node]`…).

use super::*;

impl AI {
    // ------------------------------------------------------------------ économie

    /// Python : `economy(self)`.
    // game/ai.py, lignes 282 à 335
    pub fn economy(&mut self, g: &mut Game) {
        let (f, code) = (self.f(g), self.code.clone());
        let r = f.at("res");
        let mut s = if r.at("armes") < 150i64 { 0.8 } else if f.get_or("_cov", 1) < 0.6 { 0.3 } else { 0.55 };
        if r.at("armes") > 1000i64 {
            s = if r.at("outils") < 600i64 { 0.15 } else { 0.5 };
        }
        if (s - f.atf("slider")).abs() > 0.01 {
            g.set_slider(&code, &Val::from(s));
        }
        // impôts : on presse le contribuable en cas de besoin, on desserre l'étau si l'ordre public vacille
        let mine = g.owned_nodes(&code);
        let avg = py::sum_v(mine.iter().map(|n| n.at("stab"))).f() / (if mine.len() > 1 { mine.len() } else { 1 }) as f64;
        let mut tax = self.relief; // 0,5 d'ordinaire, moins quand le trésor déborde (voir spend)
        if avg < 0.62 {
            tax = if 0.3 < tax { 0.3 } else { tax };
        } else if r.at("livres") < 150i64 && avg > 0.8 {
            tax = 0.7;
        } else if self.wars(g).truthy() && r.at("livres") < 500i64 && avg > 0.85 {
            tax = 0.62;
        }
        if (tax - f.get_or("tax", 0.5).f()).abs() > 0.01 {
            g.set_tax(&code, &Val::from(tax));
        }
        if g.t >= self.tarif_clock {
            self.tarif_clock = g.t + 30.0;
            self.douane(g);
        }
        if r.at("livres") < 120i64 {
            for (res, keep) in [("vivres", 500), ("bois", 350), ("fer", 300)] {
                if r.at(res) > keep + 50 {
                    g.market_trade(&code, &Val::from(res), &Val::from(py::int(r.atf(res) - keep as f64)), &Val::from("sell"));
                }
            }
        }
        // surplus de l'atelier : au-delà de ce qu'exigent le réarmement et les levées, on vend aux négociants
        // (le produit part ensuite en agrandissements, remparts ou impôts allégés, voir spend)
        for (res, keep) in [("armes", 2500 + 40 * self.regs_total(g)), ("outils", 1500)] {
            // pas de bradage : on attend que les cours se refassent (le marché est commun à tous, joueur compris)
            if r.at(res) > keep + 200 && g.market.atf(res) > 0.85 * D::BASE_VALUE().atf(res) {
                let x = r.atf(res) - keep as f64;
                g.market_trade(&code, &Val::from(res), &Val::from(py::int(if x < 150.0 { x } else { 150.0 })), &Val::from("sell"));
            }
        }
        // matières premières : un trésor qui dort achète le fer et le bois des remparts et des agrandissements
        if r.at("livres") > 1500i64 {
            for (res, low) in [("bois", 250), ("fer", 150)] {
                if r.at(res) < low {
                    let q = py::int((r.atf("livres") - 1200.0) / (4.0 * g.market.atf(res)));
                    g.market_trade(&code, &Val::from(res), &Val::from(if q < 400 { q } else { 400 }), &Val::from("buy"));
                }
            }
        }
        self.build_depot(g);
        if r.at("livres") > 900i64 {
            let own: Vec<Val> = g.owned_nodes(&code).iter().filter(|n| !n.at("queue").truthy() && !n.at("siege").truthy()).collect();
            let own = py::sorted_by_key(own, |n| {
                let gn = g.geo.nodes.at(n.at("id"));
                (-VALUE().at(gn.at("type")).i(), -(gn.at("spec").len() as i64))
            });
            let mut built = 0;
            for n in own.iter().take(8) {
                if built >= (if r.at("livres") > 3000i64 { 3 } else { 1 }) {
                    break;
                }
                let nid = n.ati("id");
                let gn = g.geo.nodes.at(nid);
                if (gn.at("type") == "capitale" || gn.at("type") == "ville" || gn.at("spec").truthy())
                    && n.at("dev") < (if r.at("livres") > 3000i64 { 3i64 } else { 2 })
                {
                    if g.build(&code, nid, &Val::from("dev")).0 {
                        built += 1;
                        continue;
                    }
                }
                if (self.threat_at(g, nid, 35.0, &Val::None, &Val::None) > 0.0 || gn.at("type") == "capitale")
                    && n.at("fort") < g.fort_max(&code, nid)
                {
                    if g.build(&code, nid, &Val::from("fort")).0 {
                        built += 1;
                    }
                }
            }
        }
    }

    /// En guerre, un magasin aux vivres dans la place la plus avancée vers l'ennemi.
    /// Python : `build_depot(self)`.
    // game/ai.py, lignes 337 à 349
    pub fn build_depot(&self, g: &mut Game) {
        let (f, code) = (self.f(g), self.code.as_str());
        let wars = self.wars(g);
        if !wars.truthy() || f.at("res").at("livres") < 600i64 || f.at("res").at("bois") < 80i64 {
            return;
        }
        let own: Vec<Val> = g.owned_nodes(code).iter().filter(|n| !n.at("siege").truthy() && n.at("queue").len() < 3).collect();
        if own.is_empty() || own.iter().any(|n| self.threat_at(g, n.ati("id"), 60.0, &Val::None, &Val::None) > 0.0 && n.get("depot").truthy()) {
            return;
        }
        let foes: Vec<(f64, f64)> = wars.iter().map(|o| g.node_xy(g.capital_of(o.s()).i())).collect();
        let front = py::min_by_key(own, |n| {
            let (x, y) = g.node_xy(n.ati("id"));
            py::min_f(foes.iter().map(|p| py::dist(x, y, p.0, p.1))).expect("ValueError: min() arg is an empty sequence")
        })
        .unwrap();
        if !front.get("depot").truthy() && !front.at("queue").iter().any(|q| q.at("what") == "depot") {
            g.build(code, front.ati("id"), &Val::from("depot"));
        }
    }

    // ------------------------------------------------------------------ trésor : dépenser ce qui dort

    /// Revenu brut en livres ramené à des impôts normaux (0,5), pour ne pas mesurer le trésor à l'aune de ses propres allègements.
    /// Python : `gross_norm(self)`.
    // game/ai.py, lignes 352 à 355
    pub fn gross_norm(&self, g: &Game) -> f64 {
        let f = self.f(g);
        f.get_or("_gross_livres", 20).f() / (0.6 + 0.8 * f.get_or("tax", 0.5).f()) // voir Game.compute_income
    }

    /// Chaque mois (SPEC-MERCENAIRES.md) : un camp marchand garde un tarif bas, un camp pauvre ou en guerre le monte ;
    /// des douaniers quand la contrebande coûte plus que leur solde.
    /// Python : `douane(self)`.
    /// Piège : `bool(self.wars()) + pauvre` et `t + (t > 0)` additionnent des booléens (des entiers).
    // game/ai.py, lignes 357 à 370
    pub fn douane(&self, g: &mut Game) {
        let (f, code) = (self.f(g), self.code.as_str());
        let marchand = self.pers.atf("trade") >= 0.8;
        let pauvre = f.at("income").atf("livres") < 0.15 * self.gross_norm(g);
        let t = self.wars(g).truthy() as i64 + pauvre as i64;
        // libre en paix et à l'aise ; jusqu'à élevé sinon (banc 1700)
        let t = if marchand { t.min(1) } else { (t + (t > 0) as i64).min(2) };
        if f.at("tarif") != t {
            g.set_tarif(code, &Val::from(t));
        }
        let dn = f.get("_douane");
        let on = dn.truthy() && dn.atf("perte") / 2.0 > dn.atf("front") * R::DOUANIERS_L;
        if dn.truthy() && f.at("douaniers") != on {
            g.set_douaniers(code, &Val::from(on));
        }
    }

    /// Trésor de guerre à garder sous la main : quarante jours de revenu brut, plus un fonds fixe.
    /// Au-delà, l'argent qui dort est dépensé (impôts allégés, faubourgs, remparts, présents).
    /// Python : `reserve(self)`.
    // game/ai.py, lignes 372 à 375
    pub fn reserve(&self, g: &Game) -> f64 {
        (1000.0 + 40.0 * self.gross_norm(g)) * (if self.menace { 1.5 } else { 1.0 }) // un voisin menaçant : on garde davantage
    }

    /// L'argent qui dort au-delà de deux trésors de guerre : il paie des régiments de plus (quatre ans de solde), plus
    /// de remparts (cinq ans d'entretien) et des bâtiments plus lents à rembourser.
    /// Python : `idle_money(self)`.
    // game/ai.py, lignes 377 à 380
    pub fn idle_money(&self, g: &Game) -> f64 {
        let x = self.f(g).at("res").atf("livres") - 2.0 * self.reserve(g);
        if x > 0.0 { x } else { 0.0 }
    }

    /// Tous les cinq jours environ : un trésor qui déborde se dépense, utilement et sans tout miser sur l'armée.
    /// Python : `spend(self)`.
    // game/ai.py, lignes 382 à 403
    pub fn spend(&mut self, g: &mut Game) {
        let f = self.f(g);
        let r = f.at("res");
        let wars = self.wars(g);
        self.menace = self.menaced(g, &wars);
        CT::ai_policies(g, self); // orientation des villes (game/cities.py)
        let res = self.reserve(g);
        self.relieve_taxes(g, res, &wars);
        let excess = r.atf("livres") - res;
        if excess <= 0.0 {
            return;
        }
        // en guerre, on garde davantage pour lever des troupes ; en paix, on bâtit
        let mut budget = excess * (if wars.truthy() { 0.3 } else { 0.6 });
        budget -= self.stock_up(g, budget, res);
        budget = self.repair_towns(g, budget);
        budget = self.expand_towns(g, budget, &wars);
        budget = self.fortify_frontier(g, budget, &wars, res);
        budget = self.build_rails(g, budget, &wars);
        budget = CT::ai_build(g, self, budget, &wars); // bâtiments d'emplacement
        let _ = budget;
        if !wars.truthy() && excess > 1500.0 {
            self.gift(g, excess);
        }
    }

    /// Voies ferrées : en paix, un tronçon à la fois depuis le chef-lieu, les lignes les plus anciennes d'abord.
    /// Python : `build_rails(self, budget, wars)`.
    /// Rend le budget restant.
    // game/ai.py, lignes 405 à 418
    pub fn build_rails(&self, g: &mut Game, budget: f64, wars: &Val) -> f64 {
        let code = self.code.as_str();
        if wars.truthy() || !self.f(g).at("techs").has("chemins_fer") || RL::works(g, code).truthy() {
            return budget;
        }
        let secs = RL::sections(&g.geo);
        let cands: Vec<Val> = secs.keys().into_iter().filter(|sid| RL::openable(g, code, sid.s()).0).collect();
        let cands = py::sorted_by_key(cands, |s| (secs.at(s).at("year"), secs.at(s).at("km")));
        for sid in &cands {
            let (price, _) = RL::cost(g, code, sid.s());
            let extra = match self.provide(g, &price, budget) {
                None => continue,
                Some(e) => e,
            };
            if RL::start(g, code, sid.s()).0 {
                return budget - price.get_or("livres", 0).f() - extra;
            }
        }
        budget
    }

    /// Un danger à nos portes : une guerre, ou une frontière avec plus fort que soi ou avec un voisin hostile.
    /// Python : `menaced(self, wars)`.
    /// (&mut : D.borders.)
    // game/ai.py, lignes 420 à 431
    pub fn menaced(&self, g: &mut Game, wars: &Val) -> bool {
        if wars.truthy() {
            return true;
        }
        let (code, f) = (self.code.as_str(), self.f(g));
        let fp = g.faction_power(code);
        let pa = if fp > 1.0 { fp } else { 1.0 };
        for (o, of) in g.factions.items() {
            let o = o.s();
            if o == code || !of.at("alive").truthy() || g.friendly(code, o) || of.at("overlord") == code {
                continue;
            }
            if (f.at("rel").at(o) < -30i64 || g.faction_power(o) > 0.8 * pa) && D::borders(g, code, o) {
                return true;
            }
        }
        false
    }

    /// Un mois sur l'autre, alléger les impôts quand le trésor déborde, les relever quand il fond.
    /// Des impôts légers coûtent des livres mais calment les villes, attirent les habitants et donnent des recrues.
    /// Python : `relieve_taxes(self, res, wars)`.
    // game/ai.py, lignes 433 à 447
    pub fn relieve_taxes(&mut self, g: &Game, res: f64, wars: &Val) {
        if g.t < self.tax_clock {
            return;
        }
        self.tax_clock = g.t + 30.0;
        let liv = self.f(g).at("res").atf("livres");
        let flood = liv > FLOOD * res; // trop-plein : on va jusqu'à remettre l'impôt, le temps que le trésor fonde
        if wars.truthy() && liv < 3.0 * res {
            let x = self.relief + 0.1; // la guerre coûte : on revient vite aux impôts normaux
            self.relief = if x < 0.5 { x } else { 0.5 };
        } else if liv > 1.5 * res && (flood || self.f(g).at("income").atf("livres") > -0.05 * self.gross_norm(g)) {
            let lo = if flood { 0.0 } else { TAX_FLOOR };
            let x = self.relief - 0.1;
            self.relief = if x > lo { x } else { lo };
        } else if liv < res || (self.relief < TAX_FLOOR && !flood) {
            let x = self.relief + 0.1;
            self.relief = if x < 0.5 { x } else { 0.5 };
        }
    }

    /// Achète au marché si le cours reste raisonnable ; renvoie les livres dépensées.
    /// Python : `buy(self, res, qty, max_price=1.5)`.
    /// max_price : 1.5 par défaut. Rend les livres dépensées.
    // game/ai.py, lignes 449 à 457
    pub fn buy(&self, g: &mut Game, res: &str, qty: f64, max_price: f64) -> f64 {
        let code = self.code.as_str();
        let qty = py::int(qty);
        if qty < 10 || g.market.atf(res) > MARKET_BASE().at(res).f() * max_price {
            return 0.0;
        }
        let before = self.f(g).at("res").atf("livres");
        g.market_trade(code, &Val::from(res), &Val::from(qty), &Val::from("buy"));
        before - self.f(g).at("res").atf("livres")
    }

    /// Outils pour l'atelier de chaque place (jusqu'à +30 % de production), vivres si la famine menace,
    /// et recrues pour compléter des régiments clairsemés quand le danger guette ou que le trésor déborde.
    /// Python : `stock_up(self, budget, res)`.
    /// Rend les livres dépensées.
    // game/ai.py, lignes 459 à 478
    pub fn stock_up(&self, g: &mut Game, budget: f64, res: f64) -> f64 {
        let (f, code) = (self.f(g), self.code.as_str());
        let r = f.at("res");
        let mut spent = 0.0;
        let nn = g.owned_nodes(code).len().max(1);
        let want = 3.2 * nn as f64; // la couverture d'outils est complète à 3 par place
        if r.atf("outils") < 0.9 * want && budget > 300.0 {
            let q = py::min_f([300.0, want - r.atf("outils"), budget * 0.3 / g.market.atf("outils")]).unwrap();
            spent += self.buy(g, "outils", q, 1.5);
        }
        if r.at("vivres") < 250i64 && f.at("income").at("vivres") < 0i64 && budget - spent > 300.0 {
            let room = g.granary_cap(code) - r.atf("vivres");
            let q = py::min_f([500.0, room, (budget - spent) * 0.3 / g.market.atf("vivres")]).unwrap();
            spent += self.buy(g, "vivres", q, 1.3);
        }
        if (self.menace || r.atf("livres") > FLOOD * res) && r.at("recrues") < 600i64 && budget - spent > 300.0 {
            let regs: Vec<Val> = g.all_regs(code).iter().filter(|x| !R::UNITS().at(x.at("type")).at("garrison_only").truthy()).collect();
            let short = py::sum_v(regs.iter().map(|x| &x.at("max") - &x.at("n"))).f();
            if short > 0.15 * py::sum_v(regs.iter().map(|x| x.at("max"))).f() {
                let room = (g.recruit_cap(code) as f64) - r.atf("recrues");
                let q = py::min_f([800.0, short, room, (budget - spent) * 0.4 / g.market.atf("recrues")]).unwrap();
                spent += self.buy(g, "recrues", q, 1.5);
            }
        }
        spent
    }

    /// Acheter au marché le bois, le fer ou les outils qui manquent à une construction, si le budget le permet.
    /// Python : `provide(self, cost, budget)`.
    /// Rend les livres dépensées au marché, ou None si l'on ne peut pas payer.
    // game/ai.py, lignes 480 à 490
    pub fn provide(&self, g: &mut Game, cost: &Val, budget: f64) -> Option<f64> {
        let r = self.f(g).at("res");
        let need: Vec<(Val, f64)> = cost
            .items()
            .into_iter()
            .filter(|(k, v)| MARKET_BASE().has(k) && *v > r.get_or(k, 0))
            .map(|(k, v)| {
                let q = (&v - &r.get_or(&k, 0)).f();
                (k, q)
            })
            .collect();
        let price = cost.get_or("livres", 0).f() + py::sum(need.iter().map(|(k, q)| q * g.market.atf(k) * 1.5));
        if price > budget || need.iter().any(|(k, _)| g.market.atf(k) > MARKET_BASE().atf(k) * 1.5) {
            return None;
        }
        let mut spent = 0.0;
        for (k, q) in &need {
            let x = q + 5.0;
            spent += self.buy(g, k.s(), if x > 10.0 { x } else { 10.0 }, 1.5);
        }
        if g.can_pay(&self.code, cost) { Some(spent) } else { None }
    }

    /// Rebâtir d'abord les places les plus abîmées (nodes[].deg), dès qu'il y a de quoi : elles produisent moins.
    /// Python : `repair_towns(self, budget)`.
    /// Rend le budget restant.
    // game/ai.py, lignes 492 à 506
    pub fn repair_towns(&self, g: &mut Game, budget: f64) -> f64 {
        let code = self.code.as_str();
        let mut budget = budget;
        let cands: Vec<Val> = g
            .owned_nodes(code)
            .iter()
            .filter(|n| {
                n.get_or("deg", 0) >= 0.1
                    && !n.at("siege").truthy()
                    && n.at("queue").len() < 3
                    && !n.at("queue").iter().any(|q| q.at("kind") == "build" && q.at("what") == "repar")
            })
            .collect();
        for n in py::sorted_by_key(cands, |n| -n.atf("deg")) {
            let q = match g.repair_quote(code, &n) {
                Some(q) => q,
                None => continue,
            };
            if budget < q.1.get_or("livres", 0).f() {
                continue;
            }
            let extra = match self.provide(g, &q.1, budget) {
                None => continue,
                Some(e) => e,
            };
            if g.build(code, n.ati("id"), &Val::from("repar")).0 {
                budget -= q.1.get_or("livres", 0).f() + extra;
            }
        }
        budget
    }

    /// Agrandir les villes et les bourgs à spécialité dont la population touche aux murs : plus d'habitants,
    /// plus de production. Les simples villages restent des villages (sinon les grandes puissances s'emballent).
    /// Python : `expand_towns(self, budget, wars)`.
    /// Rend le budget restant. `getattr(g, 'pop_cap', None)` : g.pop_cap existe toujours.
    // game/ai.py, lignes 508 à 541
    pub fn expand_towns(&self, g: &mut Game, budget: f64, wars: &Val) -> f64 {
        let code = self.code.as_str();
        let mut budget = budget;
        let mut cands: Vec<(f64, Val)> = vec![];
        for n in g.owned_nodes(code).iter() {
            let nid = n.ati("id");
            let gn = g.geo.nodes.at(nid);
            if gn.at("type") == "village" && !gn.at("spec").truthy() {
                continue;
            }
            if n.at("dev") >= R::BUILD().at("dev").at("max")
                || n.at("siege").truthy()
                || n.at("queue").len() >= 2
                || n.at("queue").iter().any(|q| q.at("kind") == "build" && q.at("what") == "dev")
            {
                continue;
            }
            // (getattr(g, 'pop_cap', None) : la méthode existe toujours)
            if n.get_or("pop", 0).f() < 0.88 * g.pop_cap(&n) {
                continue; // il reste de la place : inutile de bâtir des faubourgs vides
            }
            if self.threat_at(g, nid, 45.0, &Val::None, &Val::None) > 0.0 {
                continue;
            }
            let o = g.node_output(&n, code);
            let mut val = o.atf("livres") + 0.4 * o.atf("vivres") + 0.4 * o.atf("recrues") + 0.5 * o.atf("industrie")
                + 0.6 * (o.atf("fer") + o.atf("bois"));
            val *= g.assim(&n); // une place conquise d'hier peut se révolter : on bâtit d'abord chez soi
            cands.push((val / (1.0 + n.atf("dev")), n));
        }
        let cands = py::sorted_by_key(cands, |c| -c.0);
        let mut built = 0;
        for (_, n) in &cands {
            if built >= (if wars.truthy() { 1 } else { 2 }) || budget < 150.0 {
                break;
            }
            let cost = g.build_cost(code, &R::BUILD_cost("dev", n.ati("dev")));
            let extra = match self.provide(g, &cost, budget) {
                None => continue,
                Some(e) => e,
            };
            if g.build(code, n.ati("id"), &Val::from("dev")).0 {
                budget -= cost.atf("livres") + extra;
                built += 1;
            }
        }
        budget
    }

    /// Places voisines par les chemins (calculé une fois : la carte ne change pas).
    /// Python : `neighbours(self)`.
    /// Rend self._nb (fait au premier appel).
    // game/ai.py, lignes 543 à 550
    pub fn neighbours(&mut self, g: &Game) -> Val {
        if self._nb.is_none() {
            let nb = dict! {};
            for e in g.geo.edges.iter() {
                nb.setdefault(e.at("a"), pyset![]).push(e.at("b"));
                nb.setdefault(e.at("b"), pyset![]).push(e.at("a"));
            }
            self._nb = nb;
        }
        self._nb.clone()
    }

    /// Fortifier les places qui bordent un voisin dangereux (en guerre, hostile ou plus fort que nous),
    /// sans que l'entretien des remparts dépasse une petite part du revenu.
    /// Python : `fortify_frontier(self, budget, wars, res)`.
    /// Rend le budget restant. Piège : danger et foes sont des sets de textes (codes) : seulement des tests
    /// (appartenance, vide ou non).
    // game/ai.py, lignes 552 à 598
    pub fn fortify_frontier(&mut self, g: &mut Game, budget: f64, wars: &Val, res: f64) -> f64 {
        let (f, code) = (self.f(g), self.code.clone());
        let fp = g.faction_power(&code);
        let pa = if fp > 1.0 { fp } else { 1.0 };
        let flood = f.at("res").atf("livres") > FLOOD * res; // trop-plein : toutes les frontières, et plus de remparts à entretenir
        let mut danger: Vec<String> = vec![]; // (un set de codes : seulement l'appartenance et le vide)
        for (o, of) in g.factions.items() {
            let o = o.s();
            if o != code
                && of.at("alive").truthy()
                && !g.friendly(&code, o)
                && of.at("overlord") != code.as_str()
                && f.at("overlord") != o
                && (flood || wars.has(o) || f.at("rel").at(o) < -10i64 || g.faction_power(o) > 0.9 * pa)
            {
                danger.push(o.to_string());
            }
        }
        if danger.is_empty() {
            return budget;
        }
        let mut budget = budget;
        let own = g.owned_nodes(&code);
        let up_f = py::sum(own.iter().map(|n| {
            let lvl = n.ati("fort");
            R::FORT_UPKEEP().at(if lvl < R::BASTION_LEVEL { lvl } else { R::BASTION_LEVEL }).f()
        }));
        if up_f > (if flood { 0.18 } else { 0.1 }) * self.gross_norm(g) + self.idle_money(g) / (5 * 365) as f64 {
            return budget;
        }
        let nb = self.neighbours(g);
        let mut cands: Vec<(f64, Val)> = vec![];
        for n in own.iter() {
            let nid = n.ati("id");
            let typ = g.geo.nodes.at(nid).ats("type");
            if n.at("siege").truthy()
                || n.at("queue").len() >= 2
                || n.at("queue").iter().any(|q| q.at("kind") == "build" && q.at("what") == "fort")
            {
                continue;
            }
            // foes = {maîtres des places voisines} & danger
            let voisins = nb.get(nid);
            let foes: Vec<String> = if voisins.is_none() {
                vec![]
            } else {
                voisins.iter().map(|m| g.nodes.at(m).ats("owner")).filter(|o| danger.contains(o)).collect()
            };
            let mut top;
            if typ == "village" {
                top = if flood && !foes.is_empty() { 1 } else { 0 }; // un mur d'enceinte aux villages de la frontière, quand l'argent abonde
            } else if !foes.is_empty() || flood {
                // en trop-plein, les villes de l'intérieur aussi
                top = if typ == "capitale" || typ == "fort" { 3 } else { 2 };
                if typ == "capitale" && f.at("res").atf("livres") > 2.0 * res {
                    top = g.fort_max(&code, nid); // bastions à la Vauban pour un chef-lieu riche
                }
            } else {
                continue;
            }
            let fm = g.fort_max(&code, nid);
            if n.at("fort") >= (if fm < top { fm } else { top }) {
                continue;
            }
            let k = if foes.iter().any(|o| wars.has(o.as_str())) { 2.0 } else if !foes.is_empty() { 1.0 } else { 0.4 };
            let val = VALUE().atf(&typ) * k / (1.0 + n.atf("fort"));
            cands.push((val, n));
        }
        let cands = py::sorted_by_key(cands, |c| -c.0);
        let mut built = 0;
        for (_, n) in &cands {
            if built >= 2 || budget < 150.0 {
                break;
            }
            let cost = g.build_cost(&code, &R::BUILD_cost("fort", n.ati("fort")));
            let extra = match self.provide(g, &cost, budget) {
                None => continue,
                Some(e) => e,
            };
            if g.build(&code, n.ati("id"), &Val::from("fort")).0 {
                budget -= cost.atf("livres") + extra;
                built += 1;
            }
        }
        budget
    }

    /// Un présent à un voisin plus fort qui nous regarde de travers : mieux vaut payer que se battre.
    /// Python : `gift(self, excess)`.
    // game/ai.py, lignes 600 à 615
    pub fn gift(&mut self, g: &mut Game, excess: f64) {
        let code = self.code.clone();
        let fp = g.faction_power(&code);
        let pa = if fp > 1.0 { fp } else { 1.0 };
        let heg = g.hegemon();
        for (o, of) in g.factions.items() {
            let o = o.string();
            if o == code || !of.at("alive").truthy() || g.status(&code, &o) != "paix" || Val::from(g.t) < self.cool.get_or(tup![&o, "cadeau"], 0) {
                continue;
            }
            if of.at("rel").at(&code) >= 0i64 || !(g.faction_power(&o) > 1.2 * pa || heg == o) || !D::borders(g, &code, &o) {
                continue;
            }
            let x = excess * 0.05;
            let amount = py::int(if x < 240.0 { x } else { 240.0 });
            self.cool.set(tup![&o, "cadeau"], g.t + 240.0);
            if amount >= 80
                && D::act(g, &code, &Val::from(&o), &Val::from("cadeau"), &Val::from(amount), &Val::None, &Val::None).0 == Some(true)
            {
                if o == g.player {
                    let t = format!("{} vous fait présent de {} livres en gage d'amitié.", g.fname(&code), amount);
                    g.log("diplo", &t, &dict! {"who" => &code});
                }
                return;
            }
        }
    }

    /// Python : `research(self)`.
    /// Hasard : self.rng, dans la clé de tri des branches (un tirage par branche, dans l'ordre de R.BRANCHES) puis
    /// dans la clé de min (un tirage par technologie disponible).
    // game/ai.py, lignes 617 à 637
    pub fn research(&mut self, g: &mut Game) {
        let f = self.f(g);
        let busy = f.at("research").values().iter().filter(|v| v.truthy()).count();
        let rich = f.at("res").atf("livres") > self.reserve(g); // un trésor plein fait chercher dans toutes les branches
        if busy >= (if rich { 5 } else if f.at("res").at("livres") > 1200i64 { 3 } else { 2 }) {
            return;
        }
        let tech = self.pers.at("tech");
        let taste = R::TASTE_BRANCHES().get_or(&tech, tup![&tech]);
        // (une clé par branche, calculée une fois, dans l'ordre de R.BRANCHES : un tirage chacune)
        let rng = &mut self.rng;
        let branches = py::sorted_by_key(R::BRANCHES().vec(), |b| (!taste.has(b), rng.random()));
        for b in &branches {
            if f.at("research").at(b).truthy() {
                continue;
            }
            // l'IA suit l'histoire (choix du 24/10/2026) : dans l'ordre des dates d'invention, et elle ne lance une
            // recherche que pour la finir vers sa date (à AI_AHEAD ans près) ; le joueur, lui, peut foncer
            let year = g.date(&Val::None).year;
            let techs = f.at("techs");
            let avail: Vec<Val> = R::TECH()
                .values()
                .into_iter()
                .filter(|t| {
                    t.at("branch") == *b
                        && !techs.has(t.at("id"))
                        && t.at("req").iter().all(|q| techs.has(&q))
                        && R::TECH_YEAR().atf(t.at("id")) - t.atf("days") / 360.0 - AI_AHEAD as f64 <= year as f64
                })
                .collect();
            if avail.is_empty() {
                continue;
            }
            let rng = &mut self.rng;
            let t = py::min_by_key(avail, |t| R::TECH_YEAR().atf(t.at("id")) + 8.0 * rng.random()).unwrap();
            if f.at("res").atf("livres") > t.atf("cost") + 180.0 {
                g.research(&self.code, &t.at("id"));
                return;
            }
        }
    }

    /// Régiments de campagne (la Garde nationale, qui ne quitte pas sa ville, ne compte pas).
    /// Python : `regs_total(self)`.
    // game/ai.py, lignes 639 à 641
    pub fn regs_total(&self, g: &Game) -> i64 {
        g.all_regs(&self.code).iter().filter(|r| !R::UNITS().at(r.at("type")).at("garrison_only").truthy()).count() as i64
    }

    /// Python : `wars(self)`.
    /// Rend la liste des codes, dans l'ordre de g.factions.
    // game/ai.py, lignes 643 à 644
    pub fn wars(&self, g: &Game) -> Val {
        g.factions
            .keys()
            .into_iter()
            .filter(|o| *o != self.code.as_str() && g.at_war(&self.code, o.s()) && g.factions.at(o).at("alive").truthy())
            .collect()
    }

    /// Python : `recruit(self)`.
    // game/ai.py, lignes 646 à 693
    pub fn recruit(&mut self, g: &mut Game) {
        let (f, code) = (self.f(g), self.code.clone());
        self.raise_garde(g);
        let aggr = self.pers.atf("aggr") * R::DIFFICULTY().at(&g.difficulty).atf("ai_aggr");
        let gross = self.gross_norm(g); // des impôts allégés ne doivent pas désarmer le pays
        let time_target = 4 + py::int(g.t / 90.0) + py::int(5.0 * aggr) + if self.wars(g).truthy() { 4 } else { 0 };
        // trésor qui dort : on arme, mais en paix seulement au-delà du trésor de guerre (le reste va aux
        // agrandissements et aux remparts) ; en guerre, on puise dans ce trésor de guerre
        let base = if self.wars(g).truthy() { 1000.0 } else { self.reserve(g) };
        let x = f.at("res").atf("livres") - base;
        let mut surplus = py::int((if x > 0.0 { x } else { 0.0 }) / 400.0).min(25);
        if !self.menace && f.at("res").atf("livres") < FLOOD * self.reserve(g) {
            surplus = 0; // en paix et sans voisin menaçant, l'armée s'en tient à ce que paie le revenu
        }
        let income_cap = py::int(gross * (0.5 + 0.25 * aggr) / 2.6).max(5);
        // régiments que l'argent qui dort paie quatre ans (solde et rations moyennes de l'armée), tant que le revenu en
        // livres et en vivres reste positif (personne ne les licencie ensuite)
        let up = f.get("_upkeep").or(dict! {});
        let n = (g.all_regs(&code).len() as i64).max(1);
        let pr = (up.get_or("livres", 0).f() + up.get_or("vivres", 0).f() * g.market.atf("vivres")) / n as f64;
        let per_reg = if pr > 1.0 { pr } else { 1.0 };
        let rich = f.at("income").at("livres") > 3i64 && f.at("income").at("vivres") > 0i64;
        let funded = if rich { py::int(self.idle_money(g) / ((4 * 365) as f64 * per_reg)) } else { 0 };
        let target = (time_target + surplus).min(income_cap + surplus / 2) + funded;
        if self.regs_total(g) >= target {
            return;
        }
        if f.at("income").at("livres") < 0.5 && f.at("res").at("livres") < 400i64 {
            return;
        }
        // en guerre, sans recrues mais riche : des régiments étrangers (g.recruit vérifie époque, lieu, plafond, coût)
        if self.wars(g).truthy()
            && f.at("res").at("recrues") < R::UNITS().at("ligne").at("cost").at("recrues")
            && f.at("res").atf("livres") > 6.0 * self.reserve(g)
        {
            for n in g.owned_nodes(&code).iter() {
                if n.at("queue").len() < 2 && R::MERCS().iter().any(|t| g.recruit(&code, n.ati("id"), &t).0) {
                    return;
                }
            }
        }
        let mut typ = self.rng.choice(&MIX().at(&code).vec()).string();
        if typ == "artillerie" && f.at("techs").has("mitrailleuse") && self.rng.random() < 0.35 {
            typ = "mitrailleuses".to_string(); // (avant la technologie, le tirage ne change pas)
        }
        let cost = g.unit_cost(&code, &typ);
        let reserve = cost.copy();
        reserve.set("livres", &cost.at("livres") + 60);
        if !g.can_pay(&code, &reserve) {
            typ = "ligne".to_string();
            if !g.can_pay(&code, &g.unit_cost(&code, &typ)) {
                return;
            }
        }
        let cands: Vec<Val> = g
            .owned_nodes(&code)
            .iter()
            .filter(|n| {
                let t = g.geo.nodes.at(n.at("id")).at("type");
                (t == "capitale" || t == "ville") && !n.at("siege").truthy() && n.at("queue").len() < 2
            })
            .collect();
        let vt = Val::from(&typ);
        if typ != "ligne" && !cands.iter().any(|n| g.can_recruit(&code, n.ati("id"), &vt).0) {
            typ = "ligne".to_string(); // technologie manquante, ou unité régionale levée ailleurs
        }
        let vt = Val::from(&typ);
        let cands: Vec<Val> = cands.into_iter().filter(|n| g.can_recruit(&code, n.ati("id"), &vt).0).collect();
        if cands.is_empty() {
            return;
        }
        let cands = py::sorted_by_key(cands, |n| {
            let nid = n.ati("id");
            (n.at("queue").len(), g.geo.nodes.at(nid).at("type") != "capitale", -self.threat_at(g, nid, 35.0, &Val::None, &Val::None))
        });
        g.recruit(&code, cands[0].ati("id"), &vt);
    }

    /// Une place menacée et mal défendue lève sa Garde nationale.
    /// Python : `raise_garde(self)`.
    // game/ai.py, lignes 695 à 709
    pub fn raise_garde(&self, g: &mut Game) {
        let (f, code) = (self.f(g), self.code.as_str());
        if f.at("res").at("livres") < 250i64 || !self.wars(g).truthy() {
            return;
        }
        let gardes = g.all_regs(code).iter().filter(|r| r.at("type") == "garde").count();
        if gardes >= 3.max(g.owned_nodes(code).len() / 5) {
            return;
        }
        for n in g.owned_nodes(code).iter() {
            if n.at("siege").truthy() || n.at("queue").truthy() || n.at("garrison").iter().filter(|r| r.at("type") == "garde").count() >= 2 {
                continue;
            }
            let nid = n.ati("id");
            let th = self.threat_at(g, nid, 30.0, &Val::None, &Val::None);
            if th > 0.0 && th > g.node_defense_power(nid, true) * 0.7 {
                if g.recruit(code, nid, &Val::from("garde")).0 {
                    return;
                }
            }
        }
    }

    // ------------------------------------------------------------------ militaire

    /// Armées ennemies visibles (en guerre avec nous, pas cachées), dans l'ordre de g.armies.
    /// Python : `foes(self)`.
    /// Rend une liste d'armées.
    // game/ai.py, lignes 712 à 715
    pub fn foes(&self, g: &Game) -> Val {
        let code = self.code.as_str();
        g.armies.values().into_iter().filter(|a| !a.at("hidden").truthy() && g.at_war(code, a.at("owner").s())).collect()
    }

    /// Puissance des armées ennemies à moins de radius km de la place. foes : self.foes() déjà relevé, et power :
    /// puissances déjà calculées (id -> army_power), quand on passe toutes nos places en revue sans rien changer.
    /// Python : `threat_at(self, nid, radius=35, foes=None, power=None)`.
    /// radius : 35 par défaut ; foes : None par défaut, ou self.foes(g) ; power : None par défaut, ou un dict
    /// {aid: puissance} rempli au passage (le même dict d'un appel à l'autre).
    // game/ai.py, lignes 717 à 738
    pub fn threat_at(&self, g: &Game, nid: i64, radius: f64, foes: &Val, power: &Val) -> f64 {
        let (x, y) = g.node_xy(nid);
        let mut p = 0.0;
        let r2 = radius * radius;
        if foes.is_some() {
            for a in foes.iter() {
                if py::pow(a.atf("x") - x, 2.0) + py::pow(a.atf("y") - y, 2.0) < r2 {
                    let mut pw = power.get(a.at("id"));
                    if pw.is_none() {
                        pw = Val::from(g.army_power(&a, "Plaine"));
                        power.set(a.at("id"), &pw);
                    }
                    p += pw.f();
                }
            }
            return p;
        }
        let code = self.code.as_str();
        for a in g.armies.values() {
            // la distance d'abord (appelée pour chaque place à chaque réflexion : l'état de guerre coûte plus cher)
            if a.at("hidden").truthy()
                || !(py::pow(a.atf("x") - x, 2.0) + py::pow(a.atf("y") - y, 2.0) < r2)
                || !g.at_war(code, a.at("owner").s())
            {
                continue;
            }
            p += g.army_power(&a, "Plaine");
        }
        p
    }

    /// Python : `military(self)`.
    /// Le `try / except Exception` autour de army_think : une erreur y arrête l'armée (path vide, idle) sans arrêter
    /// l'IA ; en Rust, `catch_unwind` (une panique est l'exception de Python ; le message part quand même sur la
    /// sortie d'erreur). Un `todo!()` d'une partie pas encore portée n'est pas rattrapé.
    // game/ai.py, lignes 740 à 780
    pub fn military(&mut self, g: &mut Game) {
        let code = self.code.clone();
        // 1) former des armées avec les garnisons
        for n in g.owned_nodes(&code).iter() {
            if !n.at("garrison").truthy() || n.at("siege").truthy() {
                continue;
            }
            let nid = n.ati("id");
            let gn = g.geo.nodes.at(nid);
            let threat = self.threat_at(g, nid, 35.0, &Val::None, &Val::None);
            let at_war = self.wars(g).truthy();
            let keep = if gn.at("type") == "capitale" {
                if threat > 0.0 || at_war { 3 } else { 2 }
            } else if threat > 0.0 {
                1
            } else {
                0
            };
            let regs = py::sorted_by_key(n.at("garrison").vec(), |r| -r.atf("n"));
            let movable: Vec<Val> = regs.into_iter().filter(|r| r.atf("n") > r.atf("max") * 0.6).skip(keep).collect();
            if movable.is_empty() {
                continue;
            }
            let ids: Val = movable.iter().map(|r| r.at("id")).collect();
            let here: Vec<Val> = g
                .armies
                .values()
                .into_iter()
                .filter(|a| a.at("owner") == code && a.at("at_node") == nid && a.at("state") == "idle")
                .collect();
            if !here.is_empty() {
                g.form_army(&code, nid, &ids, &here[0].at("id"));
            } else if movable.len() >= 2 || gn.at("type") != "capitale" {
                g.form_army(&code, nid, &ids, &Val::None);
            }
        }
        // 2) regrouper les armées au repos côte à côte
        let idle: Vec<Val> =
            g.armies.values().into_iter().filter(|a| a.at("owner") == code && a.at("state") == "idle" && a.at("stance") != "embuscade").collect();
        for (i, a) in idle.iter().enumerate() {
            if !g.armies.has(a.at("id")) {
                continue;
            }
            for b in &idle[i + 1..] {
                if g.armies.has(b.at("id")) && (a.atf("x") - b.atf("x")).abs() < 1.5 && (a.atf("y") - b.atf("y")).abs() < 1.5 {
                    g.merge(&code, &a.at("id"), &b.at("id"));
                }
            }
        }
        self._rally_stale = true; // point de ralliement recalculé seulement s'il sert (voir rally)
        let mine: Vec<Val> = g.armies.values().into_iter().filter(|a| a.at("owner") == code).collect();
        let taken = dict! {};
        for a in &mine {
            if a.at("target").truthy() && a.at("state") == "move" && a.at("target").get("node").is_some() {
                let nd = a.at("target").at("node");
                taken.set(&nd, &taken.get_or(&nd, 0) + 1);
            }
        }
        for a in &mine {
            if !g.armies.has(a.at("id")) {
                continue;
            }
            // `try / except Exception` : une erreur arrête l'armée sans arrêter l'IA. (Un todo!() d'une partie pas
            // encore portée n'est pas une erreur du jeu : il remonte.)
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.army_think(g, a, &taken)));
            if let Err(e) = r {
                if e.downcast_ref::<&str>().is_some_and(|m| *m == "not yet implemented")
                    || e.downcast_ref::<String>().is_some_and(|m| m == "not yet implemented")
                {
                    std::panic::resume_unwind(e);
                }
                a.set("path", list![]);
                a.set("state", "idle");
            }
        }
    }

    /// Python : `army_think(self, a, taken)`.
    /// taken : {place: armées qui la visent} (modifié).
    // game/ai.py, lignes 782 à 876
    pub fn army_think(&mut self, g: &mut Game, a: &Val, taken: &Val) {
        let code = self.code.clone();
        if a.at("state") == "battle" {
            let bt = g.battles.get(a.at("battle"));
            if bt.truthy() {
                let si = if bt.at("sides").at(0).at("armies").has(a.at("id")) { 0 } else { 1 };
                let mine = g.side_men(&bt, si);
                let theirs = g.side_men(&bt, 1 - si);
                if theirs > 3.0 * mine && g.side_morale(&bt, si) < 40.0 {
                    g.order_retreat(&code, &a.at("id"));
                }
            }
            return;
        }
        if a.at("state") == "siege" {
            let nid = a.at("at_node");
            if nid.is_none() {
                return;
            }
            let nid = nid.i();
            let n = g.nodes.at(nid);
            let dp = g.node_defense_power(nid, true);
            let ratio = g.army_power(a, "Plaine") / if dp > 1.0 { dp } else { 1.0 };
            let _has_art = a.at("regs").iter().any(|r| r.at("type") == "artillerie");
            let s = n.at("siege");
            let dur = g.t - if s.truthy() { s.atf("since") } else { g.t };
            let dmg = if s.truthy() { s.atf("dmg") } else { 0.0 };
            if AA::ai_siege(g, self, a, ratio) {
                // rançonner avant de partir, ou affamer plutôt qu'attendre la brèche
                return;
            }
            if (n.at("fort") == 0i64 && ratio > 1.5) || (dmg >= 0.6 && ratio > 1.5) || (dur > 45.0 && ratio > 1.2) || (ratio > 6.0 && dmg >= 0.3) {
                g.assault(&code, &a.at("id"));
            } else if ratio < 0.6 {
                g.order_retreat(&code, &a.at("id"));
            }
            return;
        }
        if a.at("state") == "move" || a.at("state") == "retreat" {
            let tgt = a.at("target").or(dict! {});
            let nid = tgt.get("node");
            if nid.is_some() && a.at("state") == "move" {
                let o = g.nodes.at(&nid).ats("owner");
                if o != code && o != R::NEUTRAL && !g.at_war(&code, &o) && !g.friendly(&code, &o) {
                    a.set("path", list![]);
                    a.set("state", "idle");
                }
            }
            return;
        }
        // au repos
        let ai = a.at("ai").or(dict! {});
        if a.at("stance") == "embuscade" {
            if Val::from(g.t) < ai.get_or("until", 0) && self.wars(g).truthy() {
                return;
            }
            a.set("stance", "normal");
        }
        let men = g.army_men(a);
        let mx = py::sum_v(a.at("regs").iter().map(|r| r.at("max"))).f();
        if ai.get("then") == "garrison" && a.at("at_node").is_some() && g.nodes.at(a.at("at_node")).at("owner") == code {
            g.to_garrison(&code, &a.at("id"));
            return;
        }
        self.rearm_here(g, a);
        if a.at("regs").iter().any(|r| r.get("drill").truthy()) {
            return; // à l'exercice (armes, manœuvres) : partir l'interromprait
        }
        if a.get("rg").truthy() || (a.get("qrt").truthy() && (men < 0.8 * mx || !self.wars(g).truthy())) {
            return; // renforts en route, ou en quartiers : on se refait avant de repartir
        }
        if men < 0.45 * mx || a.at("supply") < 0.25 {
            let home = self.home_node(g, a);
            if home.is_some() && home != a.at("at_node") {
                if self.go(g, a, &home, &dict! {"tr" => true}) {
                    a.set("ai", dict! {"then" => "garrison"});
                    return;
                }
            } else if home.is_some() {
                g.to_garrison(&code, &a.at("id"));
                return;
            }
        }
        // défense
        let mut best: Option<(f64, i64)> = None;
        let (foes, power) = (self.foes(g), dict! {});
        for n in g.owned_nodes(&code).iter() {
            let nid = n.ati("id");
            let th = self.threat_at(g, nid, 30.0, &foes, &power);
            if th <= 0.0 {
                continue;
            }
            let dfn = g.node_defense_power(nid, false);
            if th > dfn * 0.8 {
                let (nx, ny) = g.node_xy(nid);
                let d = py::hypot(nx - a.atf("x"), ny - a.atf("y"));
                let typ = g.geo.nodes.at(nid).ats("type");
                let val = VALUE().atf(&typ) * th / (d + 10.0) * (if typ == "capitale" { 3.0 } else { 1.0 });
                if d < (if typ == "capitale" { 160.0 } else { 90.0 }) && best.map_or(true, |b| val > b.0) {
                    best = Some((val, nid));
                }
            }
        }
        if let Some((_, bn)) = best {
            if a.at("at_node") != bn {
                if self.go(g, a, &Val::from(bn), &dict! {"tr" => true}) {
                    // secourir une place : pas de détour
                    return;
                }
            } else {
                return;
            }
        }
        let wars = self.wars(g);
        if self.rearm_detour(g, a, &wars) {
            return;
        }
        // embuscade
        let n_legere = a.at("regs").iter().filter(|r| r.at("type") == "legere").count();
        let amb_chance = 0.12 + (if code == "40" { 0.25 } else { 0.0 }) + 0.08 * n_legere as f64;
        if wars.truthy()
            && self.rng.random() < amb_chance
            && !a.at("regs").iter().any(|r| R::UNITS().at(r.at("type")).at("cls") == "artillerie")
        {
            if self.try_ambush(g, a, &wars) {
                return;
            }
        }
        // conquête / expansion, sinon ralliement au front
        if !self.pick_target(g, a, taken, &wars) {
            let r = self.rally(g);
            if r.is_some() && r != a.at("at_node") {
                self.go(g, a, &r, &dict! {"tr" => !wars.truthy()}); // en guerre, le front se gagne en chemin
            }
        }
    }

    /// Point de ralliement des armées sans objectif, calculé à la demande une fois par revue militaire
    /// (le calcul compare chaque place à chaque cible : inutile quand toutes les armées ont un objectif).
    /// Python : `rally(self)`.
    /// (propriété) Rend un numéro de place, ou None.
    // game/ai.py, lignes 878 à 885
    pub fn rally(&mut self, g: &mut Game) -> Val {
        if self._rally_stale {
            self._rally_stale = false;
            self._rally = self.rally_node(g);
        }
        self._rally.clone()
    }

    /// Python : `rally_node(self)`.
    /// Rend un numéro de place, ou None.
    // game/ai.py, lignes 887 à 911
    pub fn rally_node(&self, g: &Game) -> Val {
        let code = self.code.as_str();
        let wars = self.wars(g);
        let own: Vec<i64> = g.owned_nodes(code).iter().filter(|n| !n.at("siege").truthy()).map(|n| n.ati("id")).collect();
        if own.is_empty() {
            return Val::None;
        }
        let targets: Vec<i64>;
        if !wars.truthy() {
            let neutral: Vec<i64> = g.nodes.iter().filter(|n| n.at("owner") == R::NEUTRAL).map(|n| n.ati("id")).collect();
            if neutral.is_empty() {
                let cap = g.capital_of(code);
                return if g.nodes.at(&cap).at("owner") == code { cap } else { Val::from(own[0]) };
            }
            targets = neutral;
        } else {
            targets = g.nodes.iter().filter(|n| wars.has(n.at("owner"))).map(|n| n.ati("id")).collect();
            if targets.is_empty() {
                return Val::None;
            }
        }
        let mut best: Option<(f64, i64)> = None;
        let pts: Vec<(f64, f64)> = targets.iter().map(|&t| g.node_xy(t)).collect();
        for &i in &own {
            let (x, y) = g.node_xy(i);
            let mut d = py::min_f(pts.iter().map(|&(tx, ty)| py::hypot(x - tx, y - ty))).unwrap();
            let typ = g.geo.nodes.at(i).ats("type");
            d -= match typ.as_str() {
                "capitale" => 6.0,
                "ville" => 4.0,
                "fort" => 3.0,
                "village" => 0.0,
                _ => panic!("KeyError: {}", py::repr_s(&typ)),
            };
            if best.map_or(true, |b| d < b.0) {
                best = Some((d, i));
            }
        }
        Val::from(best.unwrap().1)
    }

    /// Python : `home_node(self, a)`.
    /// Rend un numéro de place, ou None.
    // game/ai.py, lignes 913 à 923
    pub fn home_node(&self, g: &Game, a: &Val) -> Val {
        let mut best: Option<(f64, i64)> = None;
        for n in g.owned_nodes(&self.code).iter() {
            let gn = g.geo.nodes.at(n.at("id"));
            if !(gn.at("type") == "capitale" || gn.at("type") == "ville") || n.at("siege").truthy() {
                continue;
            }
            let d = py::hypot(gn.atf("x") - a.atf("x"), gn.atf("y") - a.atf("y"));
            if best.map_or(true, |b| d < b.0) {
                best = Some((d, n.ati("id")));
            }
        }
        best.map_or(Val::None, |b| Val::from(b.1))
    }

    /// Python : `pick_target(self, a, taken, wars)`.
    /// Piège : `cands.sort(reverse=True)` trie des tuples (score, place) : à score égal, la plus grande place d'abord.
    // game/ai.py, lignes 925 à 984
    pub fn pick_target(&mut self, g: &mut Game, a: &Val, taken: &Val, wars: &Val) -> bool {
        let code = self.code.clone();
        let p_army = g.army_power(a, "Plaine");
        let expand = self.pers.atf("expand");
        let mut cands: Vec<(f64, i64)> = vec![];
        let portee = if g.factions.len() > 5 { 150.0 } else { 220.0 };
        for n in g.nodes.iter() {
            let o = n.at("owner");
            if o == code {
                continue;
            }
            if o != R::NEUTRAL && !wars.has(&o) {
                continue;
            }
            let nid = n.ati("id");
            let gn = g.geo.nodes.at(nid);
            let d = py::hypot(gn.atf("x") - a.atf("x"), gn.atf("y") - a.atf("y"));
            if d > portee {
                // (toute la France : pas des milliers de places à juger)
                continue;
            }
            let dfn = g.node_defense_power(nid, true);
            let mut need = dfn * (if o == R::NEUTRAL { 1.25 } else { 1.3 });
            if n.at("fort") >= 1i64 && a.at("regs").iter().any(|r| r.at("type") == "artillerie") {
                need /= 1.0 + 0.25 * n.atf("fort");
            }
            if n.at("siege").truthy() && n.at("siege").at("by") == code.as_str() {
                need *= 0.5;
            }
            if p_army < need {
                continue;
            }
            let mut val = VALUE().atf(gn.at("type")) + 1.5 * gn.at("spec").len() as f64;
            if o == R::NEUTRAL {
                if gn.at("dept") != code.as_str() && g.factions.has(gn.at("dept")) && g.t < 45.0 {
                    continue; // les premières semaines, chacun rallie d'abord ses propres villages
                }
                val *= 0.8 + expand;
                if gn.at("dept") == code.as_str() {
                    val *= 1.6;
                }
            } else {
                val *= 1.3;
                if gn.at("type") == "capitale" {
                    val *= 1.8;
                }
            }
            let mut sc = val / (d + 15.0);
            let k = taken.get_or(nid, 0);
            if k.truthy() && gn.at("type") != "capitale" {
                sc *= 0.25 / k.f();
            }
            cands.push((sc, nid));
        }
        // (cands.sort(reverse=True) : à score égal, la plus grande place d'abord)
        let cands = py::sorted_by_key_rev(cands, |c| *c);
        let cands: Vec<(f64, i64)> = cands.into_iter().filter(|c| !self.go_cooled(g, a, &Val::from(c.1))).collect(); // destinations refusées naguère : on passe
        // destinations qu'aucune route ne permet d'atteindre (terres fermées tout autour) : écartées sans chercher de
        // chemin ; parmi les quatre premières, notées comme un ordre refusé (pour demander un droit de passage)
        let (comp, starts) = if !cands.is_empty() { self.reach_from(g, a) } else { (Val::None, Val::None) };
        let mut tries = 0;
        for (i, &(_sc, nid)) in cands.iter().enumerate() {
            if tries >= 4 {
                break;
            }
            if starts.is_some() && !starts.has(comp.at(nid)) {
                if i < 4 {
                    self.cool.set(tup!["go", a.at("id"), nid], g.t + Self::GO_CD as f64);
                    self.refused.set(nid, g.t);
                }
                continue;
            }
            tries += 1;
            let ok = self.go(g, a, &Val::from(nid), &dict! {"tr" => false});
            if ok {
                taken.set(nid, &taken.get_or(nid, 0) + 1);
                a.set("ai", Val::None);
                return true;
            }
        }
        false
    }

    /// (terres fermées, composante de chaque place) : deux places de même composante se rejoignent par les routes
    /// et les fleuves sans entrer dans des terres fermées à ce camp (règle d'engine.road_route : on n'entre pas par la
    /// route dans une place fermée, les gabares passent devant ses quais sans y débarquer). Recalculé seulement quand
    /// les terres fermées (diplomatie, droits de passage) ou les maîtres des places changent.
    /// Python : `reach(self)`.
    /// Rend (terres fermées : un set de codes, composantes : une liste indexée par place, ou None quand rien n'est fermé).
    // game/ai.py, lignes 986 à 1014
    pub fn reach(&mut self, g: &Game) -> (Val, Val) {
        let block = AA::closed_owners(g, &self.code);
        if !block.truthy() {
            return (block, Val::None); // rien de fermé : tout se rejoint (le réseau des routes est d'un seul tenant)
        }
        // (seules comptent les places des camps fermés : les villages qui changent de main ailleurs n'y font rien)
        let mut fermees: Vec<i64> = block.iter().flat_map(|o| g.owned_ix(o.s())).map(|i| i as i64).collect();
        fermees.sort_unstable(); // (l'ordre des places : chacune n'a qu'un maître)
        if let Some(c) = &self._cache_reach {
            if c.0 == block && c.1 == fermees {
                return (block, c.2.clone());
            }
        }
        let owners: Vec<Val> = g.nodes.iter().map(|n| n.at("owner")).collect();
        let mut parent: Vec<usize> = (0..g.nodes.len()).collect();

        fn find(parent: &mut [usize], mut x: usize) -> usize {
            while parent[x] != x {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            x
        }
        for e in g.geo.edges.iter() {
            let (ea, eb) = (e.at("a").u(), e.at("b").u());
            if e.get("kind") != "water" && (block.has(&owners[ea]) || block.has(&owners[eb])) {
                continue;
            }
            // (`parent[find(a)] = find(b)` : Python évalue d'abord la droite)
            let rb = find(&mut parent, eb);
            let ra = find(&mut parent, ea);
            parent[ra] = rb;
        }
        let comp: Val = (0..parent.len()).map(|i| Val::from(find(&mut parent, i))).collect();
        self._cache_reach = Some((block.clone(), fermees, comp.clone()));
        (block, comp)
    }

    /// (composantes, celles d'où partirait par la route un ordre de marche de cette armée), ou (None, None) quand
    /// on ne peut le dire à coup sûr (armée sortant de terres fermées par leurs routes…) : rien n'est alors écarté.
    /// Une destination d'une autre composante serait refusée par engine.plan_route (mêmes points de départ).
    /// Python : `reach_from(self, a)`.
    /// Rend (composantes, set des composantes de départ), ou (None, None). (&mut : g.nearest_node.)
    // game/ai.py, lignes 1016 à 1049
    pub fn reach_from(&mut self, g: &mut Game, a: &Val) -> (Val, Val) {
        if a.get_or("mode", "route") != "route" {
            return (Val::None, Val::None);
        }
        let (block, comp) = self.reach(g);
        if comp.is_none() {
            return (Val::None, Val::None);
        }
        if a.at("at_node").is_some() {
            if block.has(g.nodes.at(a.at("at_node")).at("owner")) {
                return (Val::None, Val::None);
            }
            let starts = pyset![comp.at(a.at("at_node"))];
            return (comp, starts);
        }
        if a.at("edge").truthy() && a.get("boat").truthy() && g.geo.edges.at(a.at("edge").at("e")).get("kind") == "water" {
            return (Val::None, Val::None); // à flot : l'eau est libre, engine.plan_route en décidera
        }
        if a.at("edge").truthy() {
            // sur une route ou un fleuve : on repart par un bout ouvert ; un bout fermé ne sert que pour sortir des
            // terres où l'on se trouve (cas non filtré) ; sans aucun bout praticable, tout ordre serait refusé
            let e = g.geo.edges.at(a.at("edge").at("e"));
            let here = AA::land_owner(g, a.atf("x"), a.atf("y"));
            let starts = pyset![];
            for v in [e.at("a"), e.at("b")] {
                let o = g.nodes.at(&v).at("owner");
                if !block.has(&o) {
                    starts.push(comp.at(&v));
                } else if o == here {
                    return (Val::None, Val::None);
                }
            }
            return (comp, starts);
        }
        let near = g.nearest_node(a.atf("x"), a.atf("y"), Some(&mut |g: &mut Game, i: i64| !block.has(g.nodes.at(i).at("owner"))), 60.0);
        if near.is_none() {
            return (Val::None, Val::None);
        }
        let starts = pyset![comp.at(&near)];
        (comp, starts)
    }

    /// Python : `try_ambush(self, a, wars)`.
    /// Hasard : self.rng (shuffle, uniform, choice).
    // game/ai.py, lignes 1051 à 1085
    pub fn try_ambush(&mut self, g: &mut Game, a: &Val, wars: &Val) -> bool {
        let code = self.code.clone();
        // un chemin qui relie une de nos villes à une ville ennemie
        let mut front: Vec<(i64, i64)> = vec![]; // (mine, theirs) ; l'arête elle-même ne sert plus
        for e in g.geo.edges.iter() {
            if e.get("kind") == "water" {
                continue;
            }
            let (oa, ob) = (g.nodes.at(e.at("a")).at("owner"), g.nodes.at(e.at("b")).at("owner"));
            if oa == code.as_str() && wars.has(&ob) {
                front.push((e.ati("a"), e.ati("b")));
            } else if ob == code.as_str() && wars.has(&oa) {
                front.push((e.ati("b"), e.ati("a")));
            }
        }
        if front.is_empty() {
            return false;
        }
        self.rng.shuffle(&mut front);
        for &(mine, theirs) in front.iter().take(6) {
            let (mx, my) = g.node_xy(mine);
            let (tx, ty) = g.node_xy(theirs);
            if py::hypot(mx - a.atf("x"), my - a.atf("y")) > 60.0 {
                continue;
            }
            for _ in 0..10 {
                let f = self.rng.uniform(0.3, 0.6);
                let (mut px, mut py_) = (mx + (tx - mx) * f, my + (ty - my) * f);
                let h = py::hypot(tx - mx, ty - my);
                let l = if h != 0.0 { h } else { 1.0 };
                let signe = self.rng.choice(&[-1.0, 1.0]);
                let off = signe * self.rng.uniform(1.5, 3.2);
                px += -(ty - my) / l * off;
                py_ += (tx - mx) / l * off;
                let ter = g.geo.terrain_at(px, py_);
                if TERRAIN().at(ter).at(2).truthy() && g.geo.playable_at(px, py_) && g.geo.road[g.geo.cell(px, py_) as usize] == 0 {
                    let (ok, _) = g.order_move(&code, &a.at("id"), &dict! {"x" => px, "y" => py_, "mode" => "champs", "tr" => false});
                    a.set("mode", "route");
                    if ok == Some(true) {
                        a.set("ai", dict! {"then" => "embuscade", "until" => g.t + 30.0});
                        return true;
                    }
                }
            }
        }
        false
    }

    // ------------------------------------------------------------------ diplomatie

    /// Python : `diplomacy(self)`.
    /// Piège : le hasard (self.rng) n'est tiré que si les conditions qui le précèdent sont vraies (`and` / `or`).
    // game/ai.py, lignes 1088 à 1167
    pub fn diplomacy(&mut self, g: &mut Game) {
        let (code, f) = (self.code.clone(), self.f(g));
        let aggr = self.pers.atf("aggr") * R::DIFFICULTY().at(&g.difficulty).atf("ai_aggr");
        let fp = g.faction_power(&code);
        let pa = if fp > 1.0 { fp } else { 1.0 };
        let mut wars = self.wars(g);
        let heg = g.hegemon();
        for (o, of) in g.factions.items() {
            let o = o.string();
            if o == code || !of.at("alive").truthy() {
                continue;
            }
            let rel = f.at("rel").at(&o);
            let st = g.status(&code, &o);
            // dérive des relations
            let mut delta = -0.03 * rel.f();
            if f.at("trade").has(&o) {
                delta += 1.5;
            }
            if wars.iter().any(|x| g.at_war(&code, x.s()) && g.at_war(&o, x.s())) {
                delta += 2.0;
            }
            if st == "guerre" {
                delta -= 1.0;
            }
            if st == "paix" && D::borders(g, &code, &o) {
                delta -= 1.2;
            }
            if heg.truthy() && heg == o.as_str() {
                delta -= 1.5; // équilibre des puissances : on se méfie de qui domine l'Aquitaine
            } else if heg.truthy() && heg != code.as_str() && g.at_war(&o, heg.s()) {
                delta += 1.5;
            }
            // max(-100, min(100, rel + delta)) (les bornes restent des entiers, comme en Python)
            let v = &rel + delta;
            let v = if v < 100i64 { v } else { Val::from(100) };
            let v = if v > -100i64 { v } else { Val::from(-100) };
            f.at("rel").set(&o, v);
            let rel = f.at("rel").at(&o).f();
            // cartel d'échange : on récupère ses hommes prisonniers
            if (D::held(g, &o, &code) >= 40 || D::captifs(g, &o, &code).truthy()) && rel > -70.0 && self.rng.random() < 0.3 {
                self.propose(g, &o, "prisonniers", 0, &Val::None, &Val::None);
            }
            // mariages : on unit sa maison à celle d'un voisin ami, avec une petite dot
            if rel > 20.0
                && st != "guerre"
                && !FM::refus_mariage(g, &code, &o).is_some_and(|s| !s.is_empty())
                && self.rng.random() < 0.005
                && D::borders(g, &code, &o)
            {
                let x = f.at("res").atf("livres") * 0.1;
                self.propose(g, &o, "mariage", py::int(if 150.0 < x { 150.0 } else { x }), &Val::None, &Val::None);
            }
            if f.at("overlord").truthy() {
                continue;
            }
            let fo = g.faction_power(&o);
            let po = if fo > 1.0 { fo } else { 1.0 };
            let weary = f.get_or("weary", 0).f();
            // années depuis la dernière paix : l'envie de guerre revient peu à peu (deux siècles à jouer)
            let calm = (g.t - f.get_or("last_war", 0.0).f()) / 365.0;
            let z = calm / R::WAR_REST;
            let pace = R::WAR_PACE * (if z < 1.0 { z } else { 1.0 });
            if st == "guerre" {
                let days = g.t - f.at("war_since").get_or(&o, g.t).f();
                if (pa < 0.65 * po && days > 25.0)
                    || (days > 180.0 && self.rng.random() < 0.25)
                    || (weary > 55.0 && days > 60.0 && self.rng.random() < weary / 150.0)
                {
                    let trib = if pa < 0.5 * po {
                        let x = f.at("res").atf("livres") * 0.3;
                        py::int(if 250.0 < x { 250.0 } else { x })
                    } else {
                        0
                    };
                    self.propose(g, &o, "paix", trib, &Val::None, &Val::None);
                } else if po < 0.3 * pa && D::lost_nodes(g, &o) >= 2 && o != g.player && self.rng.random() < 0.5 {
                    D::act(g, &code, &Val::from(&o), &Val::from("soumission"), &Val::from(0), &Val::None, &Val::None);
                }
            } else if st == "paix" {
                if g.t > 120.0
                    && wars.len() < 2
                    && !f.at("truce").has(&o)
                    && D::borders(g, &code, &o)
                    && !(of.at("overlord") == code.as_str())
                    && weary < 35.0
                {
                    let c = calm / 80.0;
                    let want = (rel < -20.0 && pa > 1.15 * po && self.rng.random() < aggr * 0.55 * pace)
                        || (rel < 15.0 && pa > 1.7 * po && self.rng.random() < aggr * 0.3 * pace)
                        || (calm > 8.0 && rel < 25.0 && pa > 1.05 * po && self.rng.random() < aggr * (if c < 0.1 { c } else { 0.1 }));
                    let en_guerre = |g: &Game| g.factions.keys().iter().any(|x| *x != code.as_str() && g.at_war(&o, x.s()));
                    let weak_target = en_guerre(g) && pa > 1.3 * po && self.rng.random() < aggr * 0.25 * pace;
                    // coalition : quand la puissance dominante est déjà en guerre, ses voisins se joignent à l'hallali
                    let coalition = heg == o.as_str() && en_guerre(g) && self.rng.random() < aggr * 0.2;
                    let want = want || coalition;
                    if want || weak_target {
                        D::declare_war(g, &code, &o, false);
                        wars = self.wars(g);
                        continue;
                    }
                }
                if !f.at("trade").has(&o) && rel > 5.0 && self.rng.random() < self.pers.atf("trade") * 0.5 {
                    self.propose(g, &o, "commerce", 0, &Val::None, &Val::None);
                } else if (rel > 40.0 || (heg.truthy() && heg != code.as_str() && heg != o.as_str() && rel > 0.0))
                    && self.rng.random() < 0.35
                    && g.factions.keys().iter().any(|x| g.at_war(&code, x.s()) && g.at_war(&o, x.s()))
                {
                    self.propose(g, &o, "alliance", 0, &Val::None, &Val::None);
                }
            }
            // échange de ressources avec le joueur de temps en temps
            if o == g.player && st != "guerre" && rel > 10.0 && self.rng.random() < 0.12 {
                let r = f.at("res");
                let surplus = py::max_by_key(["vivres", "fer", "bois", "outils"], |k| r.at(*k)).unwrap();
                let need = py::min_by_key(["vivres", "fer", "bois", "armes"], |k| {
                    let b = D::BASE_VALUE().atf(*k);
                    r.atf(*k) / if b > 0.1 { b } else { 0.1 }
                })
                .unwrap();
                if surplus != need && r.at(surplus) > 200i64 {
                    let x = r.atf(surplus) * 0.25;
                    let q = py::int(if 150.0 < x { 150.0 } else { x });
                    let want_q = py::int(q as f64 * D::BASE_VALUE().atf(surplus) / D::BASE_VALUE().atf(need) * 0.9);
                    if want_q > 0 {
                        self.propose(g, &o, "echange", 0, &tup![surplus, q], &tup![need, want_q]);
                    }
                }
            }
        }
    }

    /// Python : `propose(self, o, action, amount=0, give=None, get=None)`.
    /// amount : 0 par défaut ; give, get : None par défaut, ou des tuples (ressource, quantité).
    // game/ai.py, lignes 1169 à 1177
    pub fn propose(&mut self, g: &mut Game, o: &str, action: &str, amount: i64, give: &Val, get: &Val) {
        let k = tup![o, action];
        if Val::from(g.t) < self.cool.get_or(&k, -1) {
            return;
        }
        self.cool.set(&k, g.t + if o == g.player { 40.0 } else { 20.0 });
        if o == g.player && g.proposals.iter().any(|p| p.at("frm") == self.code.as_str() && p.at("action") == action) {
            return;
        }
        D::act(g, &self.code, &Val::from(o), &Val::from(action), &Val::from(amount), give, get);
    }
}
