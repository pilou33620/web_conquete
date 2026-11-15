//! Porte game/engine.py, lignes 1525 à 1855 : armées, généraux, canons des remparts.
//!
//! Dans tout le fichier : `a`, `b` = une armée (dict de self.armies) ; `n` = une place (dict de self.nodes) ; `gn` = un
//! lieu de la carte (dict de geo.nodes) ; `r`, `reg` = un régiment ; `bt` = une bataille (dict de self.battles) ;
//! `e` = une arête (dict de geo.edges) ; `f` = un camp (dict de self.factions) ; `code` = le code d'un camp ;
//! `nid` = un numéro de place ; `aid` = un identifiant d'armée. Conventions : en tête de engine/mod.rs.

use super::*;

impl Game {
    // ================================================================== armées
    /// Python : `create_army(self, code, x, y, regs, node=None, name=None, gen=None)`.
    /// regs : la liste des régiments (gardée telle quelle : le même objet) ; node : numéro de place ou None ;
    /// name : texte ou None (« 1re Armée ») ; gen : un général ou None (prendre_general). Rend l'armée (rangée dans self.armies).
    // engine.py, lignes 1526 à 1537
    pub fn create_army(&mut self, code: &str, x: f64, y: f64, regs: &Val, node: &Val, name: &Val, gen: &Val) -> Val {
        let f = self.factions.at(code);
        f.inc("army_count", 1);
        let aid = self.nid("a");
        let name = name.or_else(|| Val::from(format!("{} Armée", ordinal(f.ati("army_count")))));
        let gen = if gen.truthy() { gen.clone() } else { self.prendre_general(code) };
        // mp : jours de marche qui restent ce tour (None : tout le mois), en tour par tour
        let a = dict! {"id" => &aid, "owner" => code, "name" => name, "regs" => regs, "x" => x, "y" => y, "at_node" => node,
            "path" => list![], "target" => Val::None, "state" => "idle", "stance" => "normal", "mode" => "route",
            "supply" => 1.0, "battle" => Val::None, "grace" => 0.0, "hidden" => false, "onroad" => node.is_some(),
            "edge" => Val::None, "assault" => false, "ai" => Val::None, "viol" => 0.0, "gen" => gen, "fm" => "ligne",
            "pl" => "frontal", "fm_t" => -9.0, "tac_auto" => true, "landing" => false, "boat" => false, "rx" => true,
            "des" => 0.0, "depot" => Val::None, "tr" => false, "hold" => false, "qrt" => false, "mp" => Val::None};
        self.armies.set(&aid, &a);
        a
    }

    /// Python : `army_men(self, a)`.
    // engine.py, lignes 1539 à 1540
    pub fn army_men(&self, a: &Val) -> f64 {
        py::sum_v(a.at("regs").iter().map(|r| r.at("n"))).f()
    }

    /// Python : `army_speed(self, a)`.
    // engine.py, lignes 1542 à 1550
    pub fn army_speed(&self, a: &Val) -> f64 {
        let regs = a.at("regs");
        let owner = a.ats("owner");
        let mut sp = if regs.truthy() {
            py::min_f(regs.iter().map(|r| {
                let typ = r.at("type");
                let k = if typ == "artillerie" { self.reg_mods(&owner, &r, a).get_or("art_speed", 0.0).f() } else { 0.0 };
                R::UNITS().at(&typ).atf("speed") * (1.0 + k)
            }))
            .unwrap()
        } else {
            20.0
        };
        if a.atf("supply") < 0.35 {
            sp *= 0.9;
        }
        sp *= R::FORMATION_SPEED().get_or(&a.get_or("fm", "ligne"), 1.0).f();
        if self.gen_trait(a) == "cavalier" {
            sp *= 1.1;
        }
        sp * TB::march_k(a) // des troupes fourbues marchent moins vite
    }

    // ------------------------------------------------------------------ généraux
    /// Python : `new_general(self, code)`.
    /// Rend dict(id, name, trait, lvl, xp, vic, talents, medailles, etats).
    // engine.py, lignes 1553 à 1562
    pub fn new_general(&mut self, code: &str) -> Val {
        let traits = R::GENERAL_TRAITS().keys();
        let mut w = vec![1.0; traits.len()];
        let fav = R::GENERAL_FAVORITE().get(code);
        if fav.truthy() {
            let i = traits.iter().position(|t| *t == fav).expect("ValueError: trait favori inconnu");
            w[i] = 3.0;
        }
        let used = Val::new_set();
        for a in self.armies.values() {
            if a.getb("gen") {
                used.push(a.at("gen").at("name"));
            }
        }
        let mut names: Vec<Val> = R::SURNAMES().iter().filter(|s| !used.has(s)).collect();
        if names.is_empty() {
            names = R::SURNAMES().vec();
        }
        let id = self.gid(code);
        let name = self.rng.choice(&names);
        let tr = self.rng.choix_pondere(&traits, &w);
        dict! {"id" => id, "name" => name, "trait" => tr, "lvl" => 1, "xp" => 0, "vic" => 0,
            "talents" => list![], "medailles" => list![], "etats" => list![]}
    }

    /// Identifiant d'un général : un compteur par camp (le compteur commun, nid, numérote armées et régiments).
    /// Python : `gid(self, code)`.
    /// (Un camp inconnu : le compteur n'est pas gardé.)
    // engine.py, lignes 1564 à 1568
    pub fn gid(&mut self, code: &str) -> String {
        let f = self.factions.get_or(code, dict! {});
        f.set("gid", &f.get_or("gid", 0) + 1);
        format!("g{code}-{}", f.at("gid"))
    }

    /// Python : `gen_title(g)`.
    /// g : un général (dict). `Game::gen_title(&gen)` (staticmethod).
    // engine.py, lignes 1571 à 1572
    pub fn gen_title(g: &Val) -> String {
        format!("{} {}", R::GENERAL_RANKS().at(g.ati("lvl") - 1), g.at("name"))
    }

    /// Les généraux d'un camp : à la tête de ses armées, en réserve, blessés.
    /// Python : `generaux(self, code)`.
    /// Rend une liste neuve de généraux (les mêmes dict).
    // engine.py, lignes 1574 à 1578
    pub fn generaux(&self, code: &str) -> Val {
        let f = self.factions.at(code);
        let out = list![];
        for a in self.armies.values() {
            if a.at("owner") == code && a.getb("gen") && !a.at("gen").getb("interim") {
                out.push(a.at("gen"));
            }
        }
        out.extend(&f.get_or("generaux", list![]));
        for b in f.get_or("blesses", list![]).iter() {
            out.push(b.at("gen"));
        }
        out
    }

    /// Python : `_journal_gen(self, a, texte)`.
    // engine.py, lignes 1580 à 1582
    pub fn _journal_gen(&mut self, a: &Val, texte: &str) {
        if a.at("owner") == self.player {
            let kw = dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => a.at("owner"), "important" => true};
            self.log("armee", texte, &kw);
        }
    }

    /// Le général est emporté blessé : un colonel le remplace jusqu'à son retour (1 à 3 mois).
    /// Python : `blesser_general(self, a, gravite=None)`.
    /// gravite : None (tirée au sort dans R::BLESSURE_MOIS()) ou un nombre de mois.
    // engine.py, lignes 1584 à 1595
    pub fn blesser_general(&mut self, a: &Val, gravite: &Val) {
        let gen = a.get("gen");
        if !gen.truthy() || gen.getb("interim") {
            return;
        }
        let mois = if gravite.truthy() {
            gravite.clone()
        } else {
            let bm = R::BLESSURE_MOIS();
            Val::from(self.rng.randint(bm.ati(0), bm.ati(1)))
        };
        gen.set("retour", Val::from(self.t) + Val::Int(30) * &mois);
        let owner = a.ats("owner");
        self.factions.at(&owner).setdefault("blesses", list![]).push(dict! {"gen" => &gen, "armee" => a.at("id")});
        let interim = self.new_general(&owner).copy();
        interim.set("interim", true);
        a.set("gen", interim);
        let t = Game::gen_title(&gen);
        let texte = format!("Le {} est blessé ({mois} mois de convalescence). Le colonel {} commande la {} en attendant.",
            minuscule_initiale(&t), a.at("gen").at("name"), a.at("name"));
        self._journal_gen(a, &texte);
    }

    /// Python : `tuer_general(self, a)`.
    // engine.py, lignes 1597 à 1604
    pub fn tuer_general(&mut self, a: &Val) {
        let gen = a.get("gen");
        if !gen.truthy() {
            return;
        }
        let g = self.prendre_general(&a.ats("owner"));
        a.set("gen", g);
        let t = Game::gen_title(&gen);
        let texte = format!("Le {} est tombé au combat. Le {} prend la tête de la {}.", minuscule_initiale(&t),
            Game::gen_title(&a.at("gen")).to_lowercase(), a.at("name"));
        self._journal_gen(a, &texte);
    }

    /// Le général est pris par le camp vainqueur ; l'armée, si elle survit, reçoit un autre chef.
    /// Python : `capturer_general(self, a, vainqueur, reste=True)`.
    /// vainqueur : un code, ou None (bridge.py, quand il n'y a plus d'ennemi sur le champ de bataille).
    // engine.py, lignes 1606 à 1616
    pub fn capturer_general(&mut self, a: &Val, vainqueur: &Val, reste: bool) {
        let gen = a.get("gen");
        if !gen.truthy() {
            return;
        }
        gen.pop("interim");
        if self.factions.has(vainqueur) {
            self.factions.at(vainqueur).setdefault("captifs", list![]).push(dict! {"gen" => &gen, "de" => a.at("owner")});
        }
        let g = if reste { self.prendre_general(&a.ats("owner")) } else { Val::None };
        a.set("gen", g);
        let t = Game::gen_title(&gen);
        // (vainqueur None : fname(None) lève KeyError en Python ; ici, l'arrêt de `s()`)
        let texte = format!("Le {} est fait prisonnier par {}.", minuscule_initiale(&t), self.fname(vainqueur.s()));
        self._journal_gen(a, &texte);
    }

    /// Le sort du général après une bataille de campagne (résolution automatique) : 'victoire', 'defaite',
    /// 'aneantie' (rules.GENERAL_RISQUES). Renvoie 'blesse', 'tue', 'pris' ou None.
    /// Python : `risques_general(self, a, issue, assaut=False)`.
    /// Rend 'blesse', 'tue', 'pris' ou None. Son propre hasard : `Random::new_str("{seed}-{jour}-{aid}")`.
    // engine.py, lignes 1618 à 1628
    pub fn risques_general(&self, a: &Val, issue: &str, assaut: bool) -> Val {
        let gen = a.get("gen");
        if !gen.truthy() {
            return Val::None;
        }
        let k = R::GENERAL_RISQUE_TRAIT().get_or(&gen.at("trait"), 1.0).f() * (if assaut { 1.5 } else { 1.0 });
        let p = R::GENERAL_RISQUES().at(issue);
        let (pb, pt, pp) = (p.atf(0) * k, p.atf(1) * k, p.atf(2) * k);
        // (son propre tirage, fixé par la partie, le jour et l'armée : le hasard commun de la partie n'est pas décalé)
        let x = Random::new_str(&format!("{}-{}-{}", self.seed, py::int(self.t), a.at("id"))).random();
        if x < pp {
            Val::from("pris")
        } else if x < pp + pt {
            Val::from("tue")
        } else if x < pp + pt + pb {
            Val::from("blesse")
        } else {
            Val::None
        }
    }

    /// Chaque jour : le général guéri reprend son armée, ou attend dans la réserve si elle n'est plus.
    /// Python : `soigner_generaux(self)`.
    // engine.py, lignes 1630 à 1645
    pub fn soigner_generaux(&mut self) {
        for (code, f) in self.factions.items() {
            let code = code.string();
            let gueris: Vec<Val> = f.get_or("blesses", list![]).iter().filter(|b| self.t >= b.at("gen").atf("retour")).collect();
            for b in gueris {
                f.at("blesses").remove(&b);
                let gen = b.at("gen");
                gen.pop("retour");
                let a = self.armies.get(&b.at("armee"));
                if a.truthy() && a.at("owner") == code.as_str() {
                    let ag = a.get("gen");
                    if ag.truthy() && !ag.getb("interim") {
                        self.reserver(&code, &ag);
                    }
                    a.set("gen", &gen);
                    let t = Game::gen_title(&gen);
                    let texte = format!("Guéri, le {} reprend la tête de la {}.", minuscule_initiale(&t), a.at("name"));
                    self._journal_gen(&a, &texte);
                } else {
                    self.reserver(&code, &gen);
                }
            }
        }
    }

    /// Un général sans armée passe dans la réserve de son camp (un colonel sans états de service se retire).
    /// Python : `reserver(self, code, gen)`.
    /// gen : un général, ou None (rien).
    // engine.py, lignes 1647 à 1653
    pub fn reserver(&mut self, code: &str, gen: &Val) {
        if !gen.truthy() || !self.factions.has(code) || (gen.at("lvl") < 2i64 && !gen.getb("talents") && !gen.getb("medailles")) {
            return;
        }
        let res = self.factions.at(code).setdefault("generaux", list![]);
        res.push(gen);
        res.replace_all(res.slice(Some(-R::RESERVE_MAX), None).vec());
    }

    /// Le meilleur général de la réserve (prêt à servir), sinon un colonel nouveau.
    /// Python : `prendre_general(self, code)`.
    // engine.py, lignes 1655 à 1662
    pub fn prendre_general(&mut self, code: &str) -> Val {
        let res: Vec<Val> =
            self.factions.get_or(code, dict! {}).get_or("generaux", list![]).iter().filter(|x| !x.getb("retour")).collect();
        if res.is_empty() {
            return self.new_general(code);
        }
        let gen = py::max_by_key(res, |x| tup![x.at("lvl"), x.at("xp")]).unwrap();
        self.factions.at(code).at("generaux").remove(&gen);
        gen
    }

    /// Une médaille pour un exploit (SPEC-GENERAUX.md) : son nom selon l'époque ; +1 point d'expérience.
    /// Python : `decorer(self, a, exploit)`.
    // engine.py, lignes 1664 à 1672
    pub fn decorer(&mut self, a: &Val, exploit: &str) {
        let g = a.get("gen");
        if !g.truthy() || g.getb("interim") {
            return;
        }
        let annee = self.date(&Val::None).year;
        let nom = R::MEDAILLES().iter().find(|m| annee < m.ati(0)).expect("StopIteration").at(1);
        let quand = self.date_str(&Val::None);
        g.setdefault("medailles", list![]).push(list![&nom, exploit, quand]);
        let texte = format!("{} est décoré : {nom} ({exploit}).", Game::gen_title(&g));
        self._journal_gen(a, &texte);
        self.general_xp(a, &Val::from(1.0), false);
    }

    /// Python : `moral_medailles(self, a)`.
    /// a : une armée, ou None (0).
    // engine.py, lignes 1674 à 1675
    pub fn moral_medailles(&self, a: &Val) -> f64 {
        let g = if a.truthy() { a.get("gen") } else { Val::None };
        let n = if g.truthy() { g.get_or("medailles", list![]).len() } else { 0 };
        (R::MEDAILLE_MORAL * (if n < 3 { n as i64 } else { 3 })) as f64
    }

    /// Les talents proposés à une promotion : deux de l'arbre de son trait encore libres (le second étage s'ouvre
    /// avec l'un des deux premiers), et un commun tiré au sort.
    /// Python : `offres_talent(self, g)`.
    /// g : un général. Rend une liste de clés de R::GENERAL_TALENTS().
    // engine.py, lignes 1677 à 1684
    pub fn offres_talent(&mut self, g: &Val) -> Val {
        let pris = g.get_or("talents", list![]).to_set();
        let tal = R::GENERAL_TALENTS();
        let tr = g.at("trait");
        let mut arbre = vec![];
        let mut communs = vec![];
        for (k, t) in tal.items() {
            if t.at("trait") == tr && !pris.has(&k) && (t.at("etage") == 1i64 || pris.iter().any(|p| tal.at(&p).at("trait") == tr)) {
                arbre.push(k.clone());
            }
            if t.at("trait").is_none() && !pris.has(&k) {
                communs.push(k);
            }
        }
        arbre.truncate(2);
        if !communs.is_empty() {
            arbre.push(self.rng.choice(&communs));
        }
        Val::list(arbre)
    }

    /// Une promotion : un talent par grade gagné ; le joueur choisit (fenêtre de promotion), une IA aussitôt.
    /// Python : `offrir_talent(self, a)`.
    // engine.py, lignes 1686 à 1696
    pub fn offrir_talent(&mut self, a: &Val) {
        let g = a.at("gen");
        while (g.get_or("talents", list![]).len() as i64) < g.ati("lvl") - 1 {
            let offres = self.offres_talent(&g);
            if !offres.truthy() {
                return;
            }
            if a.at("owner") == self.player && !g.getb("interim") {
                g.set("promo", offres);
                return;
            }
            let choix = if self.rng.random() < 0.7 { offres.at(0) } else { offres.at(-1) };
            g.setdefault("talents", list![]).push(choix);
        }
    }

    /// Python : `choisir_talent(self, code, aid, cle)`.
    // engine.py, lignes 1698 à 1706
    pub fn choisir_talent(&mut self, code: &str, aid: &Val, cle: &str) -> (bool, String) {
        let a = self.armies.get(aid);
        let g = if a.truthy() { a.get("gen") } else { a.clone() };
        if !g.truthy() || a.at("owner") != code || !g.get("promo").or(list![]).has(cle) {
            return (false, "Ce talent n'est pas proposé.".to_string());
        }
        g.at("talents").push(cle);
        g.del("promo");
        self.offrir_talent(&a); // (deux grades d'un coup : le talent suivant)
        (true, format!("{} : {}.", g.at("name"), R::GENERAL_TALENTS().at(cle).at("label")))
    }

    /// Le joueur met un général de la réserve à la tête d'une armée qui est dans une de ses places.
    /// Python : `nommer(self, code, aid, gid)`.
    /// gid : l'identifiant du général.
    // engine.py, lignes 1708 à 1721
    pub fn nommer(&mut self, code: &str, aid: &Val, gid: &str) -> (bool, String) {
        let a = self.armies.get(aid);
        let res = self.factions.at(code).get_or("generaux", list![]);
        let gen = res.iter().find(|x| x.get("id") == gid && !x.getb("retour"));
        let Some(gen) = gen.filter(|_| a.truthy() && a.at("owner") == code) else {
            return (false, "Général ou armée introuvable.".to_string());
        };
        let an = a.at("at_node");
        if an.is_none() || self.nodes.at(&an).at("owner") != code || a.atb("battle") {
            return (false, "L'armée doit être dans une de vos places, hors combat.".to_string());
        }
        res.remove(&gen);
        self.reserver(code, &a.get("gen"));
        a.set("gen", &gen);
        let t = Game::gen_title(&gen);
        (true, format!("Le {} prend la tête de la {}.", minuscule_initiale(&t), a.at("name")))
    }

    /// Python : `general_xp(self, a, n, victoire=False)`.
    /// n : les points gagnés, ajoutés tels quels à gen['xp'] (1 entier ou 0.34 depuis end_battle, 1.0 depuis decorer).
    // engine.py, lignes 1723 à 1738
    pub fn general_xp(&mut self, a: &Val, n: &Val, victoire: bool) {
        let g = a.get("gen");
        if !g.truthy() {
            return;
        }
        g.inc("xp", n);
        g.set("vic", &g.get_or("vic", 0) + (if victoire { 1 } else { 0 }));
        let xp = g.at("xp");
        let mut lvl = R::GENERAL_XP()
            .iter()
            .enumerate()
            .filter(|(_, x)| xp >= *x)
            .map(|(i, _)| i as i64 + 1)
            .max()
            .expect("ValueError: max() arg is an empty sequence");
        let owner = a.ats("owner");
        if lvl == R::GENERAL_RANKS().len() as i64
            && (g.at("vic") < R::MARECHAL_VICTOIRES || self.generaux(&owner).iter().any(|o| !o.is(&g) && o.at("lvl") == lvl))
        {
            lvl -= 1; // (le bâton de maréchal : assez de victoires, et pas déjà un maréchal dans le camp)
        }
        if lvl > g.ati("lvl") {
            g.set("lvl", lvl);
            self.offrir_talent(a);
            if owner == self.player {
                let texte = format!("{} est promu {} ({}).", g.at("name"), R::GENERAL_RANKS().at(lvl - 1).s().to_lowercase(), a.at("name"));
                let kw = dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &owner, "important" => true};
                self.log("armee", &texte, &kw);
            }
        }
    }

    /// Python : `army_power(self, a, terrain_name='Plaine')`.
    // engine.py, lignes 1740 à 1741
    pub fn army_power(&self, a: &Val, terrain_name: &str) -> f64 {
        let owner = a.ats("owner");
        py::sum(a.at("regs").iter().map(|r| self.reg_power(&owner, &r, terrain_name, 1.0, false, a)).collect::<Vec<_>>())
    }

    /// Python : `reg_power(self, code, r, tname, wx_fire=1.0, cover=False, a=None)`.
    /// tname : le nom du terrain ('Plaine', 'Forêt'…) ; a : l'armée du régiment, ou None.
    // engine.py, lignes 1743 à 1778
    pub fn reg_power(&self, code: &str, r: &Val, tname: &str, wx_fire: f64, cover: bool, a: &Val) -> f64 {
        let u = R::UNITS().at(&r.at("type"));
        let md = self.reg_mods(code, r, a); // ce que le régiment a appris (SPEC-ARBRE.md), les talents de son général
        let mut p = r.atf("n") * u.atf("power") * u.at("terrain").get_or(tname, 1.0).f();
        let mut k = 1.0 + md.get_or("all_power", 0.0).f();
        let cls = u.ats("cls");
        let arms = R::ARMS();
        if arms.has(cls.as_str()) {
            let l = arms.at(cls.as_str());
            let (arm, dernier) = (r.get_or("arm", 0).i(), l.len() as i64 - 1);
            p *= l.at(if dernier < arm { dernier } else { arm }).atf(2);
        }
        p *= TB::reg_k(r, &Val::from(cls.as_str())); // fatigue et munitions (effet modéré)
        if cls == "inf" {
            k += md.get_or("inf_power", 0.0).f();
            p *= 1.0 - (1.0 - wx_fire) * (1.0 - md.get_or("rain", 0.0).f()); // l'amorce à percussion ne craint plus la pluie
        } else if cls == "artillerie" {
            k += md.get_or("art_power", 0.0).f();
            p *= wx_fire;
        } else {
            k += md.get_or("cav_power", 0.0).f();
            p *= (1.0 + wx_fire) / 2.0;
        }
        if u.atb("light") && cover {
            k += md.get_or("legere_cover", 0.0).f();
        }
        let mountain = tname == "Montagne" || tname == "Collines" || tname == "Haute montagne";
        if mountain {
            k += md.get_or("mountain", 0.0).f();
        }
        if a.is_some() && a.getb("gen") {
            let tr = a.at("gen").at("trait");
            let typ = r.at("type");
            if tr == "cavalier" && typ == "cavalerie" {
                k += 0.20;
            } else if tr == "artilleur" && typ == "artillerie" {
                k += 0.25;
            } else if tr == "montagnard" && mountain {
                k += 0.15;
            } else if tr == "eclaireur" && u.atb("light") {
                k += 0.10;
            }
            k *= self.gen_level_k(a);
        }
        let m = r.atf("morale") + self.moral_medailles(a);
        let m = if m < 100.0 { m } else { 100.0 };
        p *= k * (0.55 + 0.45 * m / 100.0) * (1.0 + r.atf("xp") / 250.0);
        if p > 0.0 { p } else { 0.0 }
    }

    // ------------------------------------------------------------------ canons des remparts
    /// Batteries fixes d'une place forte : une par niveau de fortification (au plus rules.FORT_MAX).
    /// Python : `fort_guns(self, n)`.
    // engine.py, lignes 1781 à 1783
    pub fn fort_guns(&self, n: &Val) -> i64 {
        let f = py::int_v(&n.at("fort"));
        let f = if f < R::FORT_MAX { f } else { R::FORT_MAX };
        if f > 0 { f } else { 0 }
    }

    /// Une batterie du rempart, comme un régiment (pour la bataille commandée et le calcul de puissance).
    /// Python : `fort_gun_reg(self, n, i)`.
    // engine.py, lignes 1785 à 1789
    pub fn fort_gun_reg(&self, n: &Val, i: i64) -> Val {
        let men = R::UNITS().at("artillerie").atf("men");
        let owner = n.at("owner");
        dict! {"id" => format!("c{}-{}", n.at("id"), i + 1), "type" => "artillerie", "n" => men, "max" => men, "xp" => 30.0,
            "morale" => 75.0, "ammo" => 100.0, "fat" => 0.0, "arm" => self.arm_level(owner.s(), "artillerie"),
            "man" => self.known_man(&owner, "artillerie")}
    }

    /// Python : `fort_guns_power(self, n, tname, wx_fire=1.0)`.
    // engine.py, lignes 1791 à 1798
    pub fn fort_guns_power(&self, n: &Val, tname: &str, wx_fire: f64) -> f64 {
        let k = self.fort_guns(n);
        if k == 0 {
            return 0.0;
        }
        let r = self.fort_gun_reg(n, 0);
        let owner = n.ats("owner");
        if self.factions.has(owner.as_str()) {
            return k as f64 * self.reg_power(&owner, &r, tname, wx_fire, false, &Val::None);
        }
        k as f64 * r.atf("n") * R::UNITS().at("artillerie").atf("power") * R::ARMS().at("artillerie").at(&r.at("arm")).atf(2) * wx_fire
    }

    /// Python : `node_defense_power(self, nid, include_armies=True)`.
    // engine.py, lignes 1800 à 1816
    pub fn node_defense_power(&mut self, nid: i64, include_armies: bool) -> f64 {
        let n = self.nodes.at(nid);
        let code = n.ats("owner");
        let gn = self.geo.nodes.at(nid);
        let fort_eff = AA::fort_eff(self, &n, &Val::None); // remparts moins la brèche, et ouvrages de fortune
        let fb = 1.0 + 0.35 * fort_eff + (if code != R::NEUTRAL { self.mod_(&code, "fort_bonus", 0.0) } else { 0.0 });
        let tname = TERRAIN().at(self.geo.terrain_at(gn.atf("x"), gn.atf("y"))).ats(0);
        let mut p = n.atf("milice") * R::MILICE_POWER * self.milice_k(&code);
        if code != R::NEUTRAL {
            let garde = |r: &Val| if r.at("type") == "garde" { R::GARDE_HOME } else { 1.0 };
            p += py::sum(
                n.at("garrison").iter().map(|r| self.reg_power(&code, &r, &tname, 1.0, false, &Val::None) * garde(&r)).collect::<Vec<_>>(),
            );
        }
        p *= fb;
        p += self.fort_guns_power(&n, &tname, 1.0) * R::FORT_GUNS_AUTO; // les canons du rempart
        if include_armies {
            for a in self.armies.values() {
                if a.at("at_node") == nid && a.at("state") == "idle" && self.friendly(&a.ats("owner"), &code) {
                    p += self.army_power(&a, &tname) * fb;
                }
            }
        }
        p
    }

    /// La puissance qui domine l'Aquitaine (plus de 40 % des places tenues), contre laquelle les autres se liguent.
    /// Python : `hegemon(self)`.
    /// Rend un code, ou None.
    // engine.py, lignes 1818 à 1827
    pub fn hegemon(&self) -> Val {
        let cnt = Val::dict();
        for n in self.nodes.iter() {
            let o = n.at("owner");
            if self.factions.has(&o) {
                cnt.set(&o, &cnt.get_or(&o, 0) + 1);
            }
        }
        if cnt.len() < 3 {
            return Val::None;
        }
        let top = py::max_by_key(cnt.keys(), |k| cnt.at(k)).unwrap();
        if cnt.ati(&top) as f64 > 0.4 * py::sum_v(cnt.values()).f() { top } else { Val::None }
    }

    /// (toute la France : les forces de tous les camps d'un coup, gardées un quart de journée ; l'IA s'en sert pour juger)
    /// Python : `faction_power(self, code)`.
    /// (Gardé dans _forces.)
    // engine.py, lignes 1829 à 1837
    pub fn faction_power(&self, code: &str) -> f64 {
        let k = py::int(self.t * 4.0);
        {
            let mut c = self._forces.borrow_mut();
            if c.as_ref().map_or(true, |c| c.0 != k) {
                *c = Some((k, HashMap::new()));
            }
            if let Some(p) = c.as_ref().unwrap().1.get(code) {
                return *p;
            }
        }
        let p = self._faction_power(code);
        self._forces.borrow_mut().as_mut().unwrap().1.insert(code.to_string(), p);
        p
    }

    /// Python : `_faction_power(self, code)`.
    // engine.py, lignes 1839 à 1850
    pub fn _faction_power(&self, code: &str) -> f64 {
        let mut p = 0.0;
        for a in self.armies.values() {
            if a.at("owner") == code {
                p += self.army_power(&a, "Plaine");
            }
        }
        let mut mk: Option<f64> = None;
        for n in self.owned(code) {
            // les armes de la milice : les mêmes dans toutes ses places
            let m = *mk.get_or_insert_with(|| self.milice_k(code));
            let gar = py::sum(n.at("garrison").iter().map(|r| self.reg_power(code, &r, "Plaine", 1.0, false, &Val::None)).collect::<Vec<_>>());
            p += n.atf("milice") * R::MILICE_POWER * m * 0.5 + gar;
        }
        p
    }

    /// Python : `army_pos_node(self, a)`.
    /// Rend a['at_node'] (numéro de place ou None).
    // engine.py, lignes 1852 à 1855
    pub fn army_pos_node(&self, a: &Val) -> Val {
        a.at("at_node")
    }
}

/// `t[0].lower() + t[1:]` : l'initiale en minuscule (« Général de brigade X » → « général de brigade X »).
fn minuscule_initiale(t: &str) -> String {
    let mut c = t.chars();
    match c.next() {
        Some(p) => p.to_lowercase().chain(c).collect(),
        None => String::new(),
    }
}
