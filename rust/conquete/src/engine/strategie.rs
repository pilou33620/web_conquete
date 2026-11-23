//! La bataille par stratégie (SPEC-BATAILLE.md) : situation, stratégies et contres, reconnaissance, renforts, journal
//! par phase, prises, aperçu du rapport de forces. Écrit en Rust (pas de jumeau Python) ; la résolution elle-même
//! reste celle de batailles.rs (update_battles, end_battle), qui appelle ces fonctions.
//!
//! Une bataille (dict de self.battles) porte en plus : `sit` (rules.SITUATIONS), `demande` (le joueur a été consulté),
//! `reco` ([stratégie annoncée, chance qu'elle soit vraie] ou None), `journal` (une ligne par phase finie), `jph`, `jl`,
//! `jp`, `jn`, `jw` (la phase en cours : son nom, les pertes à son début, la puissance cumulée par arme, le temps
//! cumulé, ce qui a pesé), `pese` (ce qui pèse sur toute la bataille), `renf` (les renforts ont été appelés), `fin`
//! ([vainqueur, décrochage] quand elle attend le choix de la poursuite) et `pursue` (ce choix). Chaque camp
//! (bt['sides'][i]) : `strat` (rules.STRATS, ou None tant que le joueur n'a pas choisi) et `renf` (les armées venues en
//! renfort).

use super::*;

/// Les stratégies que préfère un général selon son trait (choose_strategy : +15 %).
fn gout(trait_: &Val, id: &str) -> bool {
    let l: &[&str] = match if trait_.is_str() { trait_.s() } else { "" } {
        "audacieux" => &["frontal", "colonnes", "coup", "sortie", "contre"],
        "prudent" => &["tenir", "remparts", "bastions", "carres", "bombarder"],
        "cavalier" => &["debord", "tourner", "contre", "sortie"],
        "artilleur" => &["prep", "bombarder", "feurem"],
        "eclaireur" => &["embus", "harcel", "coup", "nuit", "faubourgs"],
        "montagnard" => &["embus", "tenir"],
        _ => &[],
    };
    l.contains(&id)
}

/// « +15 % », « −25 % » : un multiplicateur dit en pour cent.
fn pct(k: f64) -> String {
    let p = py::round((k - 1.0) * 100.0);
    if p >= 0 { format!("+{p} %") } else { format!("−{} %", -p) }
}

impl Game {
    // ------------------------------------------------------------------ situation
    /// La situation d'une bataille, déduite de l'état (rules.SITUATIONS) : 'fort' ou 'ville' devant une place à
    /// remparts, 'position' si le défenseur est retranché (barricades d'une place ouverte, armée en posture
    /// « retranchée »), sinon 'campagne'.
    pub fn situation(&self, bt: &Val) -> &'static str {
        let nd = bt.at("node");
        if nd.is_some() {
            let n = self.nodes.at(&nd);
            if n.at("fort") >= 1i64 {
                return if self.geo.nodes.at(&nd).at_is("type", "fort") { "fort" } else { "ville" };
            }
            if AA::works_level(&n) > 0.0 {
                return "position";
            }
        }
        let retranche = bt.at("sides").at(1).at("armies").iter().any(|aid| self.armies.get(&aid).get("stance") == "retranche");
        if retranche && !bt.getb("ambush") { "position" } else { "campagne" }
    }

    /// L'ouvrage du défenseur, pour la scène : dict(type, camp, niv, breche) ou None. type : 'fort', 'remparts',
    /// 'barricade' (place ouverte barricadée) ou 'redoute' (armée retranchée en rase campagne) ; niv : ce qu'il vaut
    /// (remparts moins la brèche, ouvrages de fortune compris) ; breche : part des murs ouverte (0 à 1).
    pub fn ouvrage(&self, bt: &Val) -> Val {
        let nd = bt.at("node");
        let sit = bt.get_or("sit", "campagne");
        if nd.is_some() && sit != "campagne" {
            let n = self.nodes.at(&nd);
            let typ = if sit == "fort" { "fort" } else if sit == "ville" { "remparts" } else { "barricade" };
            return dict! {"type" => typ, "camp" => 1, "niv" => py::round_n(AA::fort_eff(self, &n, &Val::None), 2),
                          "breche" => py::round_n(AA::breach(&n), 2)};
        }
        if sit == "position" {
            return dict! {"type" => "redoute", "camp" => 1, "niv" => 0.2, "breche" => 0.0};
        }
        Val::None
    }

    /// Effectifs par arme (rules.ARMES) d'une liste de régiments : dict(inf, cav, art, tir), en hommes.
    pub fn armes_de(regs: &Val) -> Val {
        let out = dict! {"inf" => 0, "cav" => 0, "art" => 0, "tir" => 0, "grenadiers" => 0};
        for r in regs.iter() {
            out.inc(R::arme_de(r.at("type").s()), py::round(r.atf("n")));
        }
        out
    }

    /// Effectifs par arme d'un camp d'une bataille : ses armées, la garnison et la milice (infanterie) de sa place.
    pub fn armes_camp(&self, bt: &Val, si: i64) -> Val {
        let regs: Val = self.side_units(bt, si).iter().map(|u| u.at(1)).collect();
        let out = Game::armes_de(&regs);
        let nd = bt.at("sides").at(si).at("node");
        if nd.is_some() {
            let n = self.nodes.at(&nd);
            for (k, v) in Game::armes_de(&n.at("garrison")).items() {
                out.inc(k.s(), v);
            }
            out.inc("inf", py::round(n.atf("milice")));
        }
        out
    }

    /// Le camp (0 ou 1) où le joueur a des troupes ou sa place, ou None.
    pub fn camp_du_joueur(&self, bt: &Val) -> Option<i64> {
        let p = self.player.as_str();
        (0..2i64).find(|&si| {
            let s = bt.at("sides").at(si);
            s.at_is("owner", &p) || s.at("armies").iter().any(|aid| self.armies.get(&aid).get("owner") == p)
        })
    }

    // ------------------------------------------------------------------ stratégies
    /// Les stratégies d'un camp dans cette bataille : liste de (stratégie, '' si elle est permise, sinon la raison).
    /// `code` : le camp qui choisit (ses découvertes comptent).
    pub fn strats_dispo(&self, bt: &Val, si: i64, code: &str) -> Vec<(String, String)> {
        let sit = R::SITUATIONS().at(bt.get_or("sit", "campagne"));
        let side = bt.at("sides").at(si);
        let techs = if self.factions.has(code) { self.factions.at(code).at("techs") } else { list![] };
        sit.at(if si == 0 { "s_att" } else { "s_def" })
            .iter()
            .map(|id| {
                let tech = R::STRATS().at(&id).at("tech");
                let why = if tech.is_some() && !techs.has(&tech) {
                    format!("Découverte requise : {}", R::TECH().at(&tech).at("name"))
                } else if id == "repli" && side.at("node").is_some() {
                    "Une place ne se quitte pas en pleine bataille".to_string()
                } else {
                    String::new()
                };
                (id.string(), why)
            })
            .collect()
    }

    /// Puissance d'un camp par arme (rules.ARMES_RANG : artillerie, infanterie, cavalerie, tirailleurs), terrain
    /// compris, avant phase et stratégie : ses armées, la milice et la garnison de sa place, les canons du rempart.
    pub fn puissance_armes(&self, bt: &Val, si: i64) -> [f64; R::N_ARMES] {
        let terrain = bt.get_or("terrain", "Plaine").string();
        let mut p = [0.0f64; R::N_ARMES];
        for u in self.side_units(bt, si).iter() {
            let (o, r, a) = u.triple();
            p[R::rang_arme(R::arme_de(r.at("type").s()))] += self.reg_power(o.s(), &r, &terrain, 1.0, false, &a);
        }
        let nd = bt.at("sides").at(si).at("node");
        if nd.is_some() {
            let n = self.nodes.at(&nd);
            let o = n.ats("owner");
            p[1] += n.atf("milice") * R::MILICE_POWER * self.milice_k(&o);
            if o != R::NEUTRAL {
                for r in n.at("garrison").iter() {
                    p[R::rang_arme(R::arme_de(r.at("type").s()))] += self.reg_power(&o, &r, &terrain, 1.0, false, &Val::None);
                }
            }
            p[0] += self.fort_guns_power(&n, &terrain, 1.0) * R::FORT_GUNS_AUTO;
        }
        p
    }

    /// Ce qu'une stratégie change à une arme : rules.STRATS, sauf la cavalerie qui déborde hors terrain ouvert (elle
    /// s'empêtre : ×0,8, comme l'ancien plan « débordement »).
    pub fn strat_m(id: &str, arme: &str, ouvert: bool) -> f64 {
        if arme == "cav" && !ouvert && R::STRATS_FLANC().has(id) {
            return 0.8;
        }
        R::STRATS().at(id).at("m").get_or(arme, 1.0).f()
    }

    /// Ce que vaut une stratégie pour un camp : sa composition (part de chaque arme × ce que la stratégie lui
    /// change), ses propres pertes, la stratégie adverse probable `devine` (contre : rules.CONTRE, dans les deux
    /// sens), le goût de son général, le couvert, et la cavalerie d'en face (`foe` : sa puissance par
    /// arme) pour les carrés, qui ne valent que contre elle.
    fn note_strat(&self, bt: &Val, id: &str, parts: &[f64; R::N_ARMES], foe: &[f64; R::N_ARMES], devine: Option<&str>, trait_: &Val) -> f64 {
        let s = R::STRATS().at(id);
        let ouvert = R::OPEN_TERRAIN().has(&bt.get("terrain"));
        let tot: f64 = parts.iter().sum::<f64>().max(1e-9);
        let mut v: f64 = (0..R::N_ARMES).map(|i| parts[i] * Game::strat_m(id, R::ARMES_RANG[i], ouvert)).sum::<f64>() / tot;
        v /= s.atf("pertes").sqrt();
        if let Some(d) = devine {
            if s.at("bat").has(d) {
                v *= R::CONTRE;
            }
            if R::STRATS().at(d).at("bat").has(id) {
                v /= R::CONTRE;
            }
        }
        if gout(trait_, id) {
            v *= 1.15;
        }
        if id == "embus" && bt.getb("cover") {
            v *= 1.1;
        }
        if id == "carres" {
            v *= 0.9 + 1.5 * foe[2] / foe.iter().sum::<f64>().max(1e-9);
        }
        v
    }

    /// La stratégie d'un camp, choisie par son général (IA, ou joueur qui laisse faire) : selon sa composition, son
    /// trait et la situation, avec une part de hasard propre à la bataille (elle ne décale pas le hasard de la partie).
    /// Très inférieur en rase campagne (moins de la moitié de la puissance d'en face), il se dérobe : repli s'il
    /// défend, harcèlement s'il attaque.
    pub fn choose_strategy(&self, bt: &Val, si: i64) -> String {
        let side = bt.at("sides").at(si);
        let code = side.ats("owner");
        let dispo: Vec<String> = self.strats_dispo(bt, si, &code).into_iter().filter(|(_, why)| why.is_empty()).map(|(id, _)| id).collect();
        let mine = self.puissance_armes(bt, si);
        let foe = self.puissance_armes(bt, 1 - si);
        let (pm, pf): (f64, f64) = (mine.iter().sum(), foe.iter().sum());
        let faible = pm < 0.5 * pf && side.at("node").is_none();
        if faible {
            for id in ["repli", "harcel"] {
                if dispo.iter().any(|d| d == id) {
                    return id.to_string();
                }
            }
        }
        // le général du camp : celui de sa plus grosse armée
        let chef = side
            .at("armies")
            .iter()
            .map(|aid| self.armies.get(&aid))
            .filter(|a| a.truthy())
            .fold(Val::None, |m: Val, a| if m.is_none() || self.army_men(&a) > self.army_men(&m) { a } else { m });
        let trait_ = self.gen_trait(&chef);
        // ce que l'ennemi fera sans doute : ce que sa seule composition lui conseille
        let foe_code = bt.at("sides").at(1 - si).ats("owner");
        let devine = self
            .strats_dispo(bt, 1 - si, &foe_code)
            .into_iter()
            .filter(|(id, why)| why.is_empty() && id != "repli")
            .map(|(id, _)| (self.note_strat(bt, &id, &foe, &mine, None, &Val::None), id))
            .fold(None, |m: Option<(f64, String)>, x| if m.as_ref().is_none_or(|m| x.0 > m.0) { Some(x) } else { m })
            .map(|x| x.1);
        let tir = mine[3] / pm.max(1e-9);
        // (la milice d'une place ne sait pas former le carré : sans armée, la cavalerie d'en face n'y pousse pas)
        let foe_vu = if side.atb("armies") { foe } else { [0.0; R::N_ARMES] };
        let mut rng = Random::new_str(&format!("{}-strat-{}-{si}", self.seed, bt.at("id")));
        let mut best: Option<(f64, String)> = None;
        for id in dispo {
            // on ne se dérobe pas sans raison : le repli aux faibles, le harcèlement aux armées de tirailleurs
            if id == "repli" || (id == "harcel" && tir < 0.35) {
                continue;
            }
            let v = self.note_strat(bt, &id, &mine, &foe_vu, devine.as_deref(), &trait_) * (0.92 + 0.16 * rng.random());
            if best.as_ref().is_none_or(|b| v > b.0) {
                best = Some((v, id));
            }
        }
        best.map_or_else(|| R::SITUATIONS().at(bt.get_or("sit", "campagne")).at(if si == 0 { "s_att" } else { "s_def" }).ats(0), |b| b.1)
    }

    /// Au début d'une bataille (start_battle, après TB::on_battle_start) : la situation, la stratégie des camps que
    /// le joueur ne commande pas (tous, si la bataille se règle sans lui), ce qui pèse d'emblée, la reconnaissance.
    pub fn engager_strategies(&mut self, bt: &Val) {
        bt.set("sit", self.situation(bt));
        bt.set("journal", list![]);
        let attend = bt.get("mode") == "attente";
        bt.set("demande", attend);
        let moi = if attend { self.camp_du_joueur(bt) } else { None };
        for si in 0..2i64 {
            let side = bt.at("sides").at(si);
            side.set("strat", if Some(si) == moi { Val::None } else { Val::from(self.choose_strategy(bt, si)) });
        }
        bt.set("pese", self.pese_depart(bt));
        bt.set("reco", if let Some(si) = moi { self.reconnaissance(bt, si) } else { Val::None });
    }

    /// Une bataille sans stratégie (ancienne sauvegarde, bataille tactique abandonnée, joueur qui laisse faire) : ses
    /// champs sont complétés et les généraux choisissent.
    pub fn completer_strategies(&mut self, bt: &Val) {
        if !bt.has("sit") {
            bt.set("sit", self.situation(bt));
        }
        bt.setdefault("journal", list![]);
        bt.setdefault("demande", false);
        bt.setdefault("reco", Val::None);
        if !bt.has("pese") {
            bt.set("pese", self.pese_depart(bt));
        }
        for si in 0..2i64 {
            let side = bt.at("sides").at(si);
            if !side.get("strat").truthy() || !R::STRATS().has(&side.at("strat")) {
                side.set("strat", self.choose_strategy(bt, si));
            }
        }
    }

    /// Reconnaissance : ce que le joueur (camp `si`) apprend de la stratégie ennemie avant de choisir la sienne, selon
    /// sa cavalerie, ses hussards, un général éclaireur, ou un espion dans la place (rules.RECO_*). Rend
    /// [stratégie annoncée, chance qu'elle soit la vraie], ou None s'il n'a ni cavalerie ni espion. Le tirage est
    /// propre à la bataille : le rapport ne change pas d'une lecture à l'autre.
    pub fn reconnaissance(&self, bt: &Val, si: i64) -> Val {
        let foe = bt.at("sides").at(1 - si);
        let vraie = foe.get("strat");
        if !vraie.truthy() {
            return Val::None;
        }
        let armes = self.armes_camp(bt, si);
        let tot: f64 = armes.values().iter().map(|v| v.f()).sum::<f64>().max(1.0);
        let cav = armes.atf("cav") / tot;
        let mut p = 0.0;
        // (les aérostiers : le ballon voit sans cavalerie, et mieux avec elle)
        let ballon = self.effet_camp(&self.player, "reco");
        if cav > 0.0 || ballon.is_some() {
            p = R::RECO_BASE + R::RECO_CAV * (cav / R::RECO_CAV_PART).min(1.0) + if ballon.is_some() { ballon.atf("reco") } else { 0.0 };
            if cav > 0.0 && self.factions.at(&self.player).at("techs").has("hussards") {
                p += R::RECO_HUSSARDS;
            }
            if bt.at("sides").at(si).at("armies").iter().any(|aid| self.gen_trait(&self.armies.get(&aid)) == "eclaireur") {
                p += R::RECO_ECLAIREUR;
            }
            if self.weather.at(self.zone_of(bt.atf("x"), bt.atf("y"))).at_is("kind", "brouillard") {
                p -= R::RECO_BROUILLARD;
            }
        }
        let nd = bt.at("node");
        if nd.is_some() && self.intel_active(&self.player, nd.i()) {
            p = p.max(R::RECO_ESPION);
        }
        if p <= 0.0 {
            return Val::None;
        }
        let p = p.min(R::RECO_MAX);
        let mut rng = Random::new_str(&format!("{}-reco-{}", self.seed, bt.at("id")));
        let mut annonce = vraie.clone();
        if rng.random() >= p {
            let autres: Vec<String> =
                self.strats_dispo(bt, 1 - si, &foe.ats("owner")).into_iter().map(|(id, _)| id).filter(|id| vraie != id.as_str()).collect();
            if !autres.is_empty() {
                annonce = Val::from(autres[rng.choice_i(autres.len())].clone());
            }
        }
        list![annonce, py::round_n(p, 2)]
    }

    // ------------------------------------------------------------------ journal
    /// Ce qui pèse dès le départ : terrain, ouvrage, rivière, débarquement, surprise, temps et sol. Liste de
    /// dict(c, t) : c, le camp que cela sert (0, 1) ou None ; t, le texte.
    fn pese_depart(&self, bt: &Val) -> Val {
        let out = list![];
        let note = |c: Val, t: String| out.push(dict! {"c" => c, "t" => t});
        let def = bt.get_or("defbonus", 1.0).f();
        if def > 1.0 {
            note(Val::from(1), format!("Terrain ({}) : défenseur {}", bt.get("terrain"), pct(def)));
        }
        if bt.getb("cover") {
            note(Val::None, format!("Couvert ({}) : favorable aux tirailleurs", bt.get("terrain")));
        }
        let ouv = self.ouvrage(bt);
        if ouv.truthy() {
            let nom = match ouv.ats("type").as_str() {
                "fort" => "Bastions du fort",
                "remparts" => "Remparts",
                "barricade" => "Barricades",
                _ => "Retranchements",
            };
            let breche = if ouv.atf("breche") > 0.0 { format!(", brèche ouverte à {} %", py::round(ouv.atf("breche") * 100.0)) } else { String::new() };
            note(Val::from(1), format!("{nom} : le défenseur est à couvert{breche}"));
        }
        if bt.get_or("river", 0).f() >= 2.0 {
            note(Val::from(1), "Rivière à franchir : assaillant −15 %".to_string());
        }
        if bt.getb("landing") {
            note(Val::from(1), "Débarquement sous le feu : assaillant −20 % au début".to_string());
        }
        if bt.getb("ambush") {
            note(Val::from(0), "Embuscade : l’assaillant frappe par surprise".to_string());
        } else if bt.getb("surprise") {
            note(Val::from(0), "Attaque par surprise".to_string());
        }
        let w = self.weather.at(self.zone_of(bt.atf("x"), bt.atf("y")));
        let wx = R::WEATHER().at(w.at("kind"));
        if wx.atf("fire") < 1.0 {
            note(Val::None, format!("{} : feu {}", wx.at("label"), pct(wx.atf("fire"))));
        }
        if self.sol_charge(bt) < 1.0 {
            let quoi = if w.at_is("kind", "neige") { "Neige" } else { "Boue" };
            note(Val::None, format!("{quoi} : charge de cavalerie {}", pct(self.sol_charge(bt))));
        }
        if w.at_is("kind", "brouillard") {
            note(Val::None, "Brouillard : embuscades favorisées, reconnaissance gênée".to_string());
        }
        out
    }

    /// Ce que le sol laisse à une charge de cavalerie (rules.BOUE_CHARGE, NEIGE_CHARGE) : boue après la pluie ou sous
    /// la pluie, neige.
    pub fn sol_charge(&self, bt: &Val) -> f64 {
        let w = self.weather.at(self.zone_of(bt.atf("x"), bt.atf("y")));
        if w.at_is("kind", "neige") {
            R::NEIGE_CHARGE
        } else if w.getb("mud") || R::MUD_WET().has(w.at("kind")) {
            R::BOUE_CHARGE
        } else {
            1.0
        }
    }

    /// Une note de plus pour la phase en cours (renforts, prise de flanc…).
    pub fn journal_note(&self, bt: &Val, camp: Val, texte: &str) {
        let jw = bt.setdefault("jw", list![]);
        if !jw.iter().any(|n| n.at("t") == texte && n.at("c") == camp) {
            jw.push(dict! {"c" => camp, "t" => texte});
        }
    }

    /// Avant les pertes d'un pas : si la phase a changé, la précédente est close (journal_clore) et la nouvelle
    /// s'ouvre, avec les pertes de chaque camp à cet instant.
    pub fn journal_phase(&mut self, bt: &Val, phase: &str) {
        if bt.get("jph") != phase {
            self.journal_clore(bt);
            bt.set("jph", phase);
            bt.set("jl", bt.at("sides").iter().map(|s| s.at("lost")).collect::<Val>());
            bt.set("jp", list![Val::list(vec![Val::from(0.0); R::N_ARMES]), Val::list(vec![Val::from(0.0); R::N_ARMES])]);
            bt.set("jn", 0.0);
        }
    }

    /// Un pas de bataille dans le journal : la puissance de chaque arme (P, déjà pesée par la phase et la stratégie)
    /// est cumulée sur dt.
    pub fn journal_pas(&mut self, bt: &Val, P: &[[f64; R::N_ARMES]; 2], dt: f64) {
        let jp = bt.at("jp");
        for (si, p) in P.iter().enumerate() {
            let l = jp.at(si);
            for (i, v) in p.iter().enumerate() {
                l.set(i, l.atf(i) + v * dt);
            }
        }
        bt.inc("jn", dt);
    }

    /// Clôt la phase en cours : une ligne du journal, dict(ph, l, p, w) — la phase, les pertes de chaque camp pendant
    /// elle, la puissance moyenne de chaque camp par arme (dict inf, cav, art, tir), ce qui a pesé (dict(c, t)).
    pub fn journal_clore(&mut self, bt: &Val) {
        let ph = bt.get("jph");
        if !ph.truthy() {
            return;
        }
        let sides = bt.at("sides");
        let l: Val = (0..2i64).map(|si| Val::from(py::round(sides.at(si).atf("lost") - bt.at("jl").atf(si)))).collect();
        let n = bt.atf("jn").max(1e-9);
        let moy = |si: i64, i: usize| bt.at("jp").at(si).atf(i) / n;
        let p: Val = (0..2i64)
            .map(|si| Val::dict_from(R::ARMES_RANG.iter().enumerate().map(|(i, a)| (Val::from(*a), Val::from(py::round(moy(si, i))))).collect()))
            .collect();
        let w = list![];
        // l'arme qui a fait pencher la phase : là où l'écart entre les deux camps est le plus grand
        let (mut ecart, mut qui, mut arme) = (0.0, 0i64, 0usize);
        for i in 0..R::N_ARMES {
            let d = moy(0, i) - moy(1, i);
            if d.abs() > ecart {
                (ecart, qui, arme) = (d.abs(), if d > 0.0 { 0 } else { 1 }, i);
            }
        }
        if ecart > 0.0 {
            let nom = R::ARMES().ats(R::ARMES_RANG[arme]);
            // (« à les insurgés », « à le Portugal » : aux, au)
            let t = format!("{nom} : avantage à {}", self.fname(&sides.at(qui).ats("owner"))).replace(" à les ", " aux ").replace(" à le ", " au ");
            w.push(dict! {"c" => qui, "t" => t});
        }
        w.extend(&bt.get_or("jw", list![]));
        bt.at("journal").push(dict! {"ph" => &ph, "l" => l, "p" => p, "w" => w});
        bt.set("jph", Val::None);
        bt.set("jw", list![]);
    }

    /// Ce qui a pesé sur toute la bataille, à sa fin : le départ (pese_depart), les stratégies et leurs contres, les
    /// découvertes de chaque camp, ses généraux, la fatigue et la faim, les renforts.
    pub fn pese_final(&self, bt: &Val) -> Val {
        let out = bt.get_or("pese", list![]).copy();
        let sides = bt.at("sides");
        let strat = |si: i64| sides.at(si).get("strat");
        for si in 0..2i64 {
            let (s, o) = (strat(si), strat(1 - si));
            // (éventé par les aérostiers d'en face, le contre ne joue pas : leur ligne le dit déjà)
            if s.truthy() && o.truthy() && R::STRATS().at(&s).at("bat").has(&o) && self.effet_camp(&sides.at(1 - si).ats("owner"), "evente").is_none() {
                let t = format!("« {} » contre « {} » ({})", R::STRATS().at(&s).at("label"), R::STRATS().at(&o).at("label"), pct(R::CONTRE));
                out.push(dict! {"c" => si, "t" => t});
            }
        }
        for si in 0..2i64 {
            let side = sides.at(si);
            let code = side.ats("owner");
            if self.factions.has(&code) {
                let techs = self.factions.at(&code).at("techs");
                // la dernière découverte de chaque arme : c'est elle qui arme et instruit ses régiments
                let noms: Vec<String> = R::TECH_ARME()
                    .values()
                    .iter()
                    .filter_map(|l| l.iter().filter(|t| techs.has(t)).last())
                    .map(|t| R::TECH().at(&t).ats("name"))
                    .fold(vec![], |mut v, n| {
                        if !v.contains(&n) {
                            v.push(n);
                        }
                        v
                    });
                if !noms.is_empty() {
                    out.push(dict! {"c" => si, "t" => format!("Découvertes : {}", noms.join(", "))});
                }
            }
            let armees: Vec<Val> = side.at("armies").iter().map(|aid| self.armies.get(&aid)).filter(|a| a.truthy()).collect();
            for a in &armees {
                let g = a.get("gen");
                if g.truthy() {
                    out.push(dict! {"c" => si, "t" => format!("{} {}", g.at("name"), "★".repeat(g.ati("lvl").max(1) as usize))});
                }
            }
            let regs: Vec<Val> = armees.iter().flat_map(|a| a.at("regs").vec()).collect();
            let men = py::sum(regs.iter().map(|r| r.atf("n"))).max(1.0);
            let fat = py::sum(regs.iter().map(|r| r.get_or("fat", 0.0).f() * r.atf("n"))) / men;
            if fat >= 40.0 {
                out.push(dict! {"c" => 1 - si, "t" => format!("Troupes fourbues ({})", self.fname(&code))});
            }
            if armees.iter().any(|a| a.get_or("supply", 1.0).f() < 0.6) {
                out.push(dict! {"c" => 1 - si, "t" => format!("Troupes mal ravitaillées ({})", self.fname(&code))});
            }
            let renf = side.get_or("renf", list![]);
            if renf.truthy() {
                out.push(dict! {"c" => si, "t" => format!("Renforts : {}", renf.iter().map(|n| n.string()).collect::<Vec<_>>().join(", "))});
            }
        }
        out
    }

    // ------------------------------------------------------------------ découvertes (rules.TECH_BATAILLE)
    /// La ligne de rules.TECH_BATAILLE qui donne l'effet de camp `cle` (evente, reco, renfort) à ce camp, ou None.
    pub fn effet_camp(&self, code: &str, cle: &str) -> Val {
        if !self.factions.has(code) {
            return Val::None;
        }
        let (techs, mods) = (self.factions.at(code).at("techs"), self.factions.at(code).at("mods"));
        // (une ligne liée à un effet chiffré de la découverte, `fx`, joue tant que cet effet vaut pour le camp)
        let a = |l: &Val| if l.has("fx") { mods.get_or(l.at("fx"), 0.0).f() > 0.0 } else { techs.has(&l.at("tech")) };
        R::TECH_BATAILLE().iter().find(|l| l.has(cle) && a(l)).unwrap_or(Val::None)
    }

    /// Ce que les découvertes du camp `code` changent à son régiment r dans une bataille : ([puissance, pertes,
    /// moral], les lignes de rules.TECH_BATAILLE qui ont joué : un bit par ligne). role : 0 assaillant, 1 défenseur ;
    /// phase et strat : None avant la bataille (aperçu) : les lignes qui en dépendent ne jouent pas. Une manœuvre que
    /// le régiment n'a pas apprise ne joue pas pour lui (reg_mods : l'effet `fx` de la ligne lui manque).
    pub fn effets_tech(&self, code: &str, r: &Val, role: i64, sit: &str, phase: Option<&str>, strat: Option<&str>) -> ([f64; 3], u32) {
        let (mut k, mut vus) = ([1.0f64; 3], 0u32);
        if !self.factions.has(code) {
            return (k, vus);
        }
        let techs = self.factions.at(code).at("techs");
        let typ = r.ats("type");
        let mut rm: Option<Val> = None;
        for (i, l) in R::TECH_BATAILLE().iter().enumerate() {
            if !techs.has(&l.at("tech")) || !(l.has("k") || l.has("pertes") || l.has("moral")) {
                continue;
            }
            let parmi = |cle: &str, v: Option<&str>| !l.has(cle) || v.is_some_and(|v| l.at(cle).has(v));
            if !parmi("armes", Some(R::arme_de(&typ))) || !parmi("types", Some(&typ)) || !parmi("sit", Some(sit)) || !parmi("strat", strat) {
                continue;
            }
            if (l.has("phase") && phase.is_none_or(|p| l.at("phase") != p)) || (l.has("role") && l.at("role") != role) {
                continue;
            }
            if l.has("fx") && rm.get_or_insert_with(|| self.reg_mods(code, r, &Val::None)).get_or(l.at("fx"), 0.0).f() <= 0.0 {
                continue;
            }
            for (j, cle) in ["k", "pertes", "moral"].iter().enumerate() {
                k[j] *= l.get_or(*cle, 1.0).f();
            }
            vus |= 1 << i;
        }
        (k, vus)
    }

    /// Une découverte a joué pour le camp `si` : la phase en cours du journal et « ce qui a pesé » le disent, une
    /// fois par camp (la page y ajoute le nom du camp). `l` : la ligne de rules.TECH_BATAILLE. (Ce qui dessert le camp
    /// sert l'autre.)
    pub fn note_effet(&self, bt: &Val, si: i64, l: &Val) {
        let t = l.at("t");
        let c = Val::from(if l.get_or("k", 1.0).f() < 1.0 { 1 - si } else { si });
        self.journal_note(bt, c.clone(), t.s());
        let pese = bt.setdefault("pese", list![]);
        if !pese.iter().any(|n| n.at("t") == t && n.at("c") == c) {
            pese.push(dict! {"c" => c, "t" => t});
        }
    }

    /// La puissance d'une armée (army_power) avec ce que ses découvertes y changent d'emblée dans cette situation.
    fn army_power_bataille(&self, a: &Val, tname: &str, role: i64, sit: &str) -> f64 {
        let o = a.ats("owner");
        py::sum(a.at("regs").iter().map(|r| self.reg_power(&o, &r, tname, 1.0, false, a) * self.effets_tech(&o, &r, role, sit, None, None).0[0]))
    }

    // ------------------------------------------------------------------ renforts
    /// Quand la charge commence : les armées amies libres à moins de rules.RENFORT_KM rejoignent la bataille (une
    /// fois par bataille). Libres : à l'arrêt ou en marche, ni en siège, ni en retraite, ni à bord, ni enfermées dans
    /// une place investie.
    pub fn renforts(&mut self, bt: &Val) {
        if bt.getb("renf") {
            return;
        }
        bt.set("renf", true);
        let sides = bt.at("sides");
        let (bx, by) = (bt.atf("x"), bt.atf("y"));
        for a in self.armies.values() {
            let st = a.at("state");
            if !(st == "idle" || st == "move") || !a.atb("regs") || self.t < a.atf("grace") || a.getb("boat") || a.getb("rail") {
                continue;
            }
            let (dx, dy) = (a.atf("x") - bx, a.atf("y") - by);
            let ao = a.ats("owner");
            // shortcut: on ne regarde pas si une voie ferrée du camp passe près du champ de bataille ; à lier à rails.rs si cela compte
            let rail = self.effet_camp(&ao, "renfort"); // (chemins de fer militaires : on accourt de plus loin)
            let km = R::RENFORT_KM * if rail.is_some() { rail.atf("renfort") } else { 1.0 };
            let d2 = dx * dx + dy * dy;
            if d2 > km * km {
                continue;
            }
            let nid = a.at("at_node");
            if nid.is_some() && self.nodes.at(&nid).atb("siege") {
                continue;
            }
            for si in 0..2i64 {
                let (side, other) = (sides.at(si), sides.at(1 - si));
                if self.friendly(&ao, &side.ats("owner")) && self.hostile(&ao, &other.ats("owner")) {
                    self.join_battle(&a, bt, si);
                    side.setdefault("renf", list![]).push(a.at("name"));
                    let t = format!("Renforts : la {} entre en ligne ({})", a.at("name"), self.fname(&ao));
                    self.journal_note(bt, Val::from(si), &t);
                    if d2 > R::RENFORT_KM * R::RENFORT_KM {
                        self.note_effet(bt, si, &rail);
                    }
                    break;
                }
            }
        }
    }

    // ------------------------------------------------------------------ poursuite et prises
    /// Le vainqueur a-t-il de la cavalerie, et reste-t-il des vaincus à poursuivre ?
    pub fn poursuite_possible(&self, bt: &Val, winner: i64) -> bool {
        let cav = self.side_units(bt, winner).iter().any(|u| R::arme_de(u.at(1).at("type").s()) == "cav");
        cav && self.side_units(bt, 1 - winner).len() > 0
    }

    /// La poursuite est-elle à demander au joueur ? Il a été consulté pour cette bataille, il est du camp vainqueur
    /// et la poursuite est possible.
    pub fn poursuite_a_choisir(&self, bt: &Val, winner: i64) -> bool {
        bt.getb("demande")
            && bt.get("pursue").is_none()
            && !self.ais.contains_key(&self.player)
            && !self.over.truthy()
            && self.camp_du_joueur(bt) == Some(winner)
            && self.poursuite_possible(bt, winner)
    }

    /// Le général vainqueur décide seul (IA, ou joueur qui laisse faire) : il poursuit si ses hommes ne sont pas
    /// fourbus (fatigue moyenne sous rules.POURSUITE_FAT_MAX).
    pub fn poursuite_ia(&self, bt: &Val, winner: i64) -> bool {
        if !self.poursuite_possible(bt, winner) {
            return false;
        }
        let regs: Vec<Val> = self.side_units(bt, winner).iter().map(|u| u.at(1)).collect();
        let men = py::sum(regs.iter().map(|r| r.atf("n"))).max(1.0);
        py::sum(regs.iter().map(|r| r.get_or("fat", 0.0).f() * r.atf("n"))) / men < R::POURSUITE_FAT_MAX
    }

    // ------------------------------------------------------------------ aperçu
    /// Aperçu du rapport de forces avant de donner l'ordre : l'armée `aid` du camp `code` contre une armée ennemie
    /// (`cible['army']`, si elle est en vue) ou une place (`cible['node']`). Rend dict(ok, ratio, mot, sit, terrain,
    /// moi, lui, sur) : ratio, notre puissance sur la sienne (terrain, retranchement, remparts et garnison compris,
    /// avant stratégies) ; mot, ce qu'il faut en penser ; moi et lui : dict(men, armes) ; sur : faux si la garnison
    /// n'est qu'estimée (place hors de vue et sans espion).
    pub fn apercu(&mut self, code: &str, aid: &Val, cible: &Val) -> Val {
        let non = |m: &str| dict! {"ok" => false, "msg" => m};
        let a = if aid.is_str() { self.armies.get(aid) } else { Val::None };
        if !a.truthy() || a.at("owner") != code {
            return non("Armée introuvable.");
        }
        let (lui, theirs, sit, x, y, sur);
        let b = if cible.is_dict() && cible.get("army").is_str() { self.armies.get(cible.at("army")) } else { Val::None };
        if b.truthy() {
            if b.at_is("owner", &code) || !self.visible_armies(code).0.has(b.at("id")) {
                return non("Armée ennemie hors de vue.");
            }
            (x, y) = (b.atf("x"), b.atf("y"));
            let tt = TERRAIN().at(self.geo.terrain_at(x, y));
            let retranche = b.at_is("stance", "retranche");
            sit = if retranche { "position" } else { "campagne" };
            theirs = self.army_power_bataille(&b, tt.at(0).s(), 1, sit) * tt.atf(3) * (if retranche { 1.2 } else { 1.0 });
            lui = dict! {"men" => py::round(self.army_men(&b)), "armes" => Game::armes_de(&b.at("regs"))};
            sur = true;
        } else if cible.is_dict() && self.valid_node(&cible.get("node")) {
            let nid = cible.at("node").i();
            let n = self.nodes.at(nid);
            let o = n.ats("owner");
            if o == code || self.friendly(code, &o) {
                return non("Cette place est à vous ou à un allié.");
            }
            (x, y) = self.node_xy(nid);
            theirs = self.node_defense_power(nid, true);
            let armes = Game::armes_de(&n.at("garrison"));
            armes.inc("inf", py::round(n.atf("milice")));
            let mut men = n.atf("milice") + py::sum(n.at("garrison").iter().map(|r| r.atf("n")));
            for d in self.armies.values() {
                if d.at("at_node") == nid && d.at_is("state", "idle") && self.friendly(&d.ats("owner"), &o) {
                    men += self.army_men(&d);
                    for (k, v) in Game::armes_de(&d.at("regs")).items() {
                        armes.inc(k.s(), v);
                    }
                }
            }
            lui = dict! {"men" => py::round(men), "armes" => armes};
            sit = self.situation(&dict! {"node" => nid, "sides" => list![dict! {"armies" => list![]}, dict! {"armies" => list![]}]});
            let (ax, ay) = (a.atf("x"), a.atf("y"));
            sur = self.intel_active(code, nid) || py::hypot(ax - x, ay - y) <= BASE_DETECT + self.mod_(code, "vision", 0.0);
        } else {
            return non("Cible inconnue.");
        }
        let tname = TERRAIN().at(self.geo.terrain_at(x, y)).ats(0);
        // (avec ce que les découvertes y changent d'emblée : rules.TECH_BATAILLE, hors phase et stratégie)
        let mine = self.army_power_bataille(&a, &tname, 0, sit);
        let ratio = mine / theirs.max(1.0);
        let mot = if ratio >= 1.4 {
            "net avantage"
        } else if ratio >= 1.1 {
            "avantage"
        } else if ratio >= 0.9 {
            "issue incertaine"
        } else if ratio >= 0.7 {
            "désavantage"
        } else {
            "très risqué"
        };
        dict! {"ok" => true, "ratio" => py::round_n(ratio, if sur { 2 } else { 1 }), "mot" => mot, "sit" => sit, "terrain" => tname,
               "moi" => dict! {"men" => py::round(self.army_men(&a)), "armes" => Game::armes_de(&a.at("regs"))}, "lui" => lui, "sur" => sur}
    }
}
