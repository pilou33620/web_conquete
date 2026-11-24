//! Intelligence artificielle d'un département.
//!
//! Porte game/ai.py, lignes 1 à 280 : constantes, la classe `AI` (ses attributs, sa création, son pas), réarmement et
//! espionnage. Le reste de la classe est dans une partie, dans l'ordre du Python, avec son `impl AI` :
//!
//!     gouvernement.rs   lignes 281 à 1177   économie, trésor, recherche, recrutement, militaire, diplomatie
//!
//! Une signature ne se change pas sans le signaler (PORTAGE.md).
//!
//! L'IA ne garde pas la partie (`self.g` du Python) : chaque méthode la reçoit, `g: &Game` ou `g: &mut Game`, juste
//! après `self` ; `self.f` (propriété) s'écrit `self.f(g)`, `self.rally` (propriété) `self.rally(g)`. Pour la faire
//! agir, la partie la sort de `g.ais` (voir `Game::ais`). `a` = une armée ; `n` = une place ; `nid` = un numéro de
//! place ; `o` = un autre camp ; `wars` = la liste des camps en guerre avec nous (self.wars(g)) ; `res` = le trésor de
//! guerre (self.reserve(g)) ; `budget`, `excess` = des livres. `self.cool` : {tuple: échéance} (clés de 2 ou 3
//! éléments : `tup![o, "passage"]`, `tup!["go", aid, node]`…).

use crate::army_actions as AA;
use crate::cities as CT;
use crate::diplomacy as D;
use crate::engine::Game;
use crate::familles as FM;
use crate::geo::TERRAIN;
use crate::py::{self, Random, Val};
use crate::rails as RL;
use crate::rules as R;
use crate::{dict, list, py_const, pyset, tup};

mod gouvernement;
pub mod marine; // les flottes des IA (SPEC-EMPIRE, module 2)
pub mod commerce; // marchands, corsaires, expéditions des IA (SPEC-EMPIRE, module 7)
pub mod politique; // impôts par classe, ministres, révolutions (SPEC-POLITIQUE, module 5)

pub const AI_AHEAD: i64 = 5;  // ans d'avance au plus sur l'histoire pour une recherche des IA (SPEC-ARBRE.md)

py_const!(MIX, {
    let MIX = dict! {
        "33" => list!["ligne", "ligne", "ligne", "ligne", "ligne", "legere", "legere", "cavalerie", "cavalerie", "artillerie", "grenadiers", "sapeurs"],
        "24" => list!["ligne", "ligne", "ligne", "ligne", "legere", "legere", "cavalerie", "artillerie", "artillerie", "grenadiers", "sapeurs"],
        "40" => list!["ligne", "ligne", "ligne", "legere", "legere", "legere", "legere", "cavalerie", "cavalerie", "artillerie", "grenadiers"],
        "47" => list!["ligne", "ligne", "ligne", "ligne", "legere", "cavalerie", "cavalerie", "cavalerie", "artillerie", "grenadiers"],
        "64" => list!["ligne", "ligne", "ligne", "ligne", "ligne", "legere", "chasseurs", "chasseurs", "chasseurs", "cavalerie", "artillerie", "grenadiers"],
    };
    // (les départements générés : l'armée du profil le plus proche ; la même liste que celle du profil)
    for (_c, _f) in R::FACTIONS().items() {
        let sp = _f.at("specialty");
        let p = if sp == "recrues" { "64" } else if sp == "fer" { "24" } else if sp == "vivres" { "47" } else { "33" };
        MIX.setdefault(_c, MIX.at(p));
    }
    MIX
}); // (`['ligne'] * 5 + ['legere'] * 2 + …` en Python : les mêmes listes, développées)
py_const!(VALUE, dict!{"capitale" => 12, "ville" => 5, "fort" => 3, "village" => 2});
// cours ordinaires du marché (voir Game.new_day) : on n'achète pas quand les prix s'envolent
py_const!(MARKET_BASE, {
    let d = dict! {};
    for (k, v) in R::MARKET_BASE().items() {
        if k != "armes" {
            d.set(k, v);
        }
    }
    d
}); // (les armes s'achètent à part : arms_room)
pub const TAX_FLOOR: f64 = 0.1;  // impôts les plus légers qu'une IA consente quand son trésor déborde
pub const FLOOD: f64 = 4.0;  // au-delà de ce multiple du trésor de guerre, c'est le trop-plein : impôts remis, remparts partout

/// `class AI` : l'IA de campagne d'un camp. Les attributs de `__init__`, ceux que ai.py pose en route
/// (`getattr(self, …, défaut)` : ils ont ici leur défaut dès la création) et celui que cities.py lui pose
/// (`_ct_clock`). La sauvegarde (views) lit et rend diplo_clock, cool, spend_clock, tax_clock, relief, refused.
pub struct AI {
    pub code: String,
    /// R::FACTIONS()[code]['personality'] (le même dict) : aggr, expand, trade, tech.
    pub pers: Val,
    /// Le hasard propre de l'IA : `random.Random(game.seed * 7 + int(code) + int(game.t * 1000))`.
    pub rng: Random,
    pub diplo_clock: f64,
    pub spend_clock: f64,
    pub tax_clock: f64,
    /// impôts allégés quand le trésor déborde (repris d'une sauvegarde : on garde le niveau atteint)
    pub relief: f64,
    pub menace: bool,
    /// {tuple: échéance} : délais (ordres refusés, cadeaux, propositions, passages…).
    pub cool: Val,
    /// destinations refusées (terres fermées en chemin ?) : nœud -> date, pour demander le passage
    pub refused: Val,
    /// step : prochaine purge de cool (`getattr(self, 'cool_purge', 0)`).
    pub cool_purge: f64,
    /// step : prochain AA.ai_step (`getattr(self, 'aa_clock', 0)`).
    pub aa_clock: f64,
    /// economy : prochaine révision de la douane (`getattr(self, 'tarif_clock', 0)`).
    pub tarif_clock: f64,
    /// cities.ai_build : prochain coup d'œil sur les chantiers (`getattr(ai, '_ct_clock', 0)`).
    pub _ct_clock: f64,
    /// rally : le point de ralliement est à recalculer (`getattr(self, '_rally_stale', False)`).
    pub _rally_stale: bool,
    /// rally : le dernier point de ralliement (numéro de place), ou None (`getattr(self, '_rally', None)`).
    pub _rally: Val,
    /// neighbours : {place: set des places voisines par les chemins}, ou None tant qu'il n'est pas fait (`hasattr(self, '_nb')`).
    pub _nb: Val,
    /// `_cache_reach` (attribut de classe à None, puis de l'instance) : composantes des places accessibles (voir reach),
    /// recalculées quand la carte politique change : (terres fermées : un set, places des camps fermés, composante de
    /// chaque place : une liste).
    pub _cache_reach: Option<(Val, Vec<i64>, Val)>,
    /// (SPEC-EMPIRE, module 2) prochain coup d'œil sur les flottes (ai/marine.rs ; pas sauvegardé).
    pub marine_clock: f64,
    /// (SPEC-EMPIRE, module 7) prochain coup d'œil sur le commerce maritime (ai/commerce.rs ; pas sauvegardé).
    pub commerce_clock: f64,
}

impl AI {
    /// Python : `__init__(self, game, code)`.
    /// `AI(game, code)`.
    // game/ai.py, lignes 34 à 46
    pub fn new(g: &Game, code: &str) -> AI {
        // (un pays d'Europe a un code de deux lettres : ses octets font le nombre)
        let num = if code.bytes().all(|o| o.is_ascii_digit()) { py::int_v(&Val::from(code)) } else { code.bytes().fold(0i64, |n, o| n * 256 + o as i64) };
        let mut rng = Random::new(g.seed * 7 + num + py::int(g.t * 1000.0)); // (un chargement ne rejoue pas les mêmes dés)
        let diplo_clock = 5.0 + rng.random() * 5.0;
        let spend_clock = 3.0 + rng.random() * 3.0;
        // impôts allégés quand le trésor déborde (repris d'une sauvegarde : on garde le niveau atteint)
        let tax = g.factions.at(code).get_or("tax", 0.5).f();
        AI {
            code: code.to_string(),
            pers: R::FACTIONS().at(code).at("personality"),
            rng,
            diplo_clock,
            spend_clock,
            tax_clock: 30.0,
            relief: if tax < 0.5 { tax } else { 0.5 },
            menace: true,
            cool: dict! {},
            refused: dict! {}, // destinations refusées (terres fermées en chemin ?) : nœud -> date, pour demander le passage
            cool_purge: 0.0,
            aa_clock: 0.0,
            tarif_clock: 0.0,
            _ct_clock: 0.0,
            _rally_stale: false,
            _rally: Val::None,
            _nb: Val::None,
            _cache_reach: None,
            marine_clock: 0.0,
            commerce_clock: 0.0,
        }
    }

    /// Python : `f(self)`.
    /// (propriété) g.factions[self.code].
    // game/ai.py, lignes 48 à 50
    pub fn f(&self, g: &Game) -> Val {
        g.factions.at(&self.code)
    }

    /// après un ordre de marche refusé, cette armée laisse cette destination un mois
    pub const GO_CD: i64 = 30;

    /// Python : `go_cooled(self, a, node)`.
    /// node : un numéro de place, ou None.
    // game/ai.py, lignes 54 à 55
    pub fn go_cooled(&self, g: &Game, a: &Val, node: &Val) -> bool {
        Val::from(g.t) < self.cool.get_or(tup!["go", a.at("id"), node], -1)
    }

    /// Ordre de marche d'une IA, jamais en force : refusé (terres fermées, pas de chemin), elle n'insiste pas
    /// avant un mois et pourra demander un droit de passage.
    /// Python : `go(self, a, node, **kw)`.
    /// node : un numéro de place (ou None) ; kw : les `**kw` passés à g.order_move (dict, par exemple `dict!{"tr" => true}`),
    /// auxquels s'ajoute node.
    // game/ai.py, lignes 57 à 72
    pub fn go(&mut self, g: &mut Game, a: &Val, node: &Val, kw: &Val) -> bool {
        if self.go_cooled(g, a, node) {
            return false;
        }
        let (comp, starts) = if node.is_int() { self.reach_from(g, a) } else { (Val::None, Val::None) };
        let ok = if starts.is_some() && !starts.has(comp.at(node)) {
            false // aucune route n'y mène sans entrer dans des terres fermées : refusé sans chercher de chemin
        } else {
            let kw = kw.copy();
            kw.set("node", node);
            g.order_move(&self.code, &a.at("id"), &kw).0 == Some(true)
        };
        if !ok {
            self.cool.set(tup!["go", a.at("id"), node], g.t + Self::GO_CD as f64);
            if node.is_some() && g.nodes.at(node).at("owner") != self.code {
                self.refused.set(node, g.t);
            }
        }
        ok
    }

    /// Python : `step(self)`.
    // game/ai.py, lignes 74 à 95
    pub fn step(&mut self, g: &mut Game) {
        if !self.f(g).atb("alive") {
            return;
        }
        if g.t >= self.cool_purge {
            // les délais échus ne servent plus à rien : sans cette purge, la table grossit toute la partie
            self.cool_purge = g.t + 30.0;
            self.cool = Val::dict_from(self.cool.items().into_iter().filter(|(_, v)| *v > g.t).collect());
        }
        self.economy(g);
        self.research(g);
        self.recruit(g);
        self.military(g);
        if g.t >= self.aa_clock {
            self.aa_clock = g.t + 3.0; // barricades, garde bourgeoise, quartiers, réquisition, droit de passage
            AA::ai_step(g, self);
        }
        if g.t >= self.spend_clock {
            self.spend_clock = g.t + 4.0 + self.rng.random() * 2.0;
            self.spend(g);
        }
        marine::jouer(g, self); // les flottes (SPEC-EMPIRE, module 2)
        commerce::jouer(g, self); // marchands, corsaires, expéditions (SPEC-EMPIRE, module 7)
        if g.t >= self.diplo_clock {
            self.diplo_clock = g.t + 8.0 + self.rng.random() * 5.0;
            self.diplomacy(g);
            self.espionage(g);
            self.rearm(g);
        }
    }

    // ------------------------------------------------------------------ réarmement

    /// Généraliser au plus vite un nouveau fusil ou un nouveau canon : les régiments les plus en retard d'abord,
    /// garnisons comprises, en gardant de quoi lever et compléter des troupes ; le marché comble ce qui manque.
    /// Python : `rearm(self)`.
    /// Piège : le tri `(-gap, -men)` est stable.
    // game/ai.py, lignes 98 à 113
    pub fn rearm(&self, g: &mut Game) {
        let code = self.code.as_str();
        let mut groups: Vec<(&str, Val, Val)> = vec![];
        for a in g.armies.values() {
            if a.at_is("owner", &code) && a.at_is("state", "idle") && a.at("at_node").is_some() {
                let n = g.nodes.at(a.at("at_node"));
                if n.at_is("owner", &code) && !n.atb("siege") {
                    groups.push(("army", a.at("id"), a.at("regs")));
                }
            }
        }
        for n in g.nodes.iter() {
            if n.at_is("owner", &code) && n.atb("garrison") && !n.atb("siege") {
                groups.push(("node", n.at("id"), n.at("garrison")));
            }
        }
        // les plus démodés d'abord (écart de générations, puis nombre d'hommes concernés)
        let groups: Vec<((i64, f64), &str, Val, Val)> =
            groups.into_iter().map(|(kind, ident, regs)| (self.arm_gap(g, &regs), kind, ident, regs)).collect();
        let groups = py::sorted_by_key(groups, |x| (-x.0 .0, -x.0 .1));
        for ((gap, _men), kind, ident, regs) in groups {
            if gap == 0 {
                break;
            }
            self.rearm_group(g, kind, &ident, &regs);
        }
        self.stock_arms(g);
    }

    /// (plus grand retard : générations d'armes, au moins 1 s'il manque des manœuvres ; hommes à moderniser) d'un
    /// groupe de régiments (ceux déjà à l'exercice ne comptent pas).
    /// Python : `arm_gap(self, regs)`.
    /// Rend (générations de retard, hommes à moderniser).
    // game/ai.py, lignes 115 à 127
    pub fn arm_gap(&self, g: &Game, regs: &Val) -> (i64, f64) {
        let code = self.code.as_str();
        let lv = dict! {};
        for cls in R::ARMS().keys() {
            lv.set(&cls, g.arm_level(code, cls.s()));
        }
        let (mut gap, mut men) = (0i64, 0.0f64);
        for r in regs.iter() {
            if r.get("drill").truthy() || !g.reg_lag(code, &r).truthy() {
                continue;
            }
            let u = R::UNITS().at(r.at("type"));
            let d = if u.atb("arm_name") { 0 } else { lv.get_or(u.at("cls"), 0).i() - r.get_or("arm", 0).i() };
            gap = gap.max(d).max(1);
            men += r.atf("max");
        }
        (gap, men)
    }

    /// Stock à ne pas entamer pour réarmer : de quoi lever et compléter des régiments (davantage en guerre).
    /// Python : `arms_floor(self)`.
    /// Rend dict(armes, fer).
    // game/ai.py, lignes 129 à 131
    pub fn arms_floor(&self, g: &Game) -> Val {
        dict! {"armes" => if self.wars(g).truthy() { 220 } else { 120 }, "fer" => 120}
    }

    /// Livres que l'on peut consacrer à acheter des armes sans compromettre la solde ni le recrutement.
    /// Python : `arms_purse(self)`.
    // game/ai.py, lignes 133 à 135
    pub fn arms_purse(&self, g: &Game) -> f64 {
        self.f(g).at("res").atf("livres") - (1000 + if self.wars(g).truthy() { 500 } else { 0 }) as f64
    }

    /// Armes et fer disponibles pour réarmer : le stock au-dessus du plancher, plus ce que le marché peut fournir
    /// à un prix raisonnable.
    /// Python : `arms_room(self)`.
    /// Rend {'armes': …, 'fer': …}.
    // game/ai.py, lignes 137 à 147
    pub fn arms_room(&self, g: &Game) -> Val {
        let (r, floor, purse) = (self.f(g).at("res"), self.arms_floor(g), self.arms_purse(g));
        let room = dict! {};
        for k in ["armes", "fer"] {
            let base = R::MARKET_BASE().atf(k);
            let p = g.market.atf(k);
            let buy = if purse > 0.0 && p <= 1.35 * base {
                let x = purse / (1.5 * p);
                if x < 1000.0 { x } else { 1000.0 }
            } else {
                0.0
            };
            room.set(k, r.atf(k) - floor.atf(k) + buy);
        }
        room
    }

    /// Réunir de quoi payer ce réarmement sans descendre sous le plancher, en achetant au marché ce qui manque.
    /// Python : `arm_supply(self, cost)`.
    // game/ai.py, lignes 149 à 161
    pub fn arm_supply(&self, g: &mut Game, cost: &Val) -> bool {
        let (r, floor) = (self.f(g).at("res"), self.arms_floor(g));
        if !cost.truthy() || cost.get_or("livres", 0) > self.arms_purse(g) {
            // (les manœuvres se paient en livres)
            return false;
        }
        let cost: Vec<(Val, Val)> = cost.items().into_iter().filter(|(k, _)| *k != "livres").collect();
        if cost.iter().any(|(k, v)| *v > self.arms_room(g).get_or(k, 0)) {
            return false;
        }
        for (k, v) in &cost {
            let short = v.f() + floor.atf(k) - r.atf(k);
            if short > 0.0 {
                let q = py::int(short) + 1;
                g.market_trade(&self.code, k, &Val::from(if q > 20 { q } else { 20 }), &Val::from("buy"));
            }
        }
        cost.iter().all(|(k, v)| r.atf(k) - v.f() >= floor.atf(k))
    }

    /// Réarmer une armée au repos dans une de nos places, ou une garnison. Si l'arsenal ne suffit pas pour tous,
    /// l'armée détache ses régiments les plus démodés, les réarme et les reprend aussitôt.
    /// Python : `rearm_group(self, kind, ident, regs)`.
    /// kind : 'army' ou 'node' ; ident : l'identifiant de l'armée, ou le numéro de la place.
    /// Piège : `a.get('gen') is not gen` et `gen in res` / `res.remove(gen)` portent sur le même dict.
    // game/ai.py, lignes 163 à 200
    pub fn rearm_group(&self, g: &mut Game, kind: &str, ident: &Val, regs: &Val) -> bool {
        let code = self.code.as_str();
        let cost = g.modernize_cost(code, regs);
        if !cost.truthy() {
            return false;
        }
        if self.arm_supply(g, &cost) {
            return if kind == "army" { g.modernize(code, ident, &Val::None) } else { g.modernize(code, &Val::None, ident) }.0;
        }
        if kind != "army" {
            return false;
        }
        let room = self.arms_room(g);
        let lv = dict! {};
        for cls in R::ARMS().keys() {
            lv.set(&cls, g.arm_level(code, cls.s()));
        }
        let old: Vec<Val> = regs
            .iter()
            .filter(|r| {
                let u = R::UNITS().at(r.at("type"));
                r.get_or("arm", 0) < lv.get_or(u.at("cls"), 0) && !u.atb("arm_name")
            })
            .collect();
        let old = py::sorted_by_key(old, |r| r.get_or("arm", 0).i() - lv.at(R::UNITS().at(r.at("type")).at("cls")).i());
        let (pick, tot) = (list![], dict! {});
        for r in &old {
            let add: Vec<(Val, Val)> =
                R::REARM().at(R::UNITS().at(r.at("type")).at("cls")).items().into_iter().map(|(k, v)| (k, &v * &r.at("max"))).collect();
            if add.iter().all(|(k, v)| &tot.get_or(k, 0) + v <= room.get_or(k, 0)) {
                pick.push(r);
                for (k, v) in &add {
                    tot.set(k, &tot.get_or(k, 0) + v);
                }
            }
        }
        if !pick.truthy() || pick.len() == regs.len() || !self.arm_supply(g, &g.modernize_cost(code, &pick)) {
            return false;
        }
        let a = g.armies.at(ident);
        let gen = a.get("gen");
        let ids: Val = pick.iter().map(|r| r.at("id")).collect();
        let (ok, bid) = g.split(code, ident, &ids);
        if !ok {
            return false;
        }
        let bid = Val::from(bid);
        let done = g.modernize(code, &bid, &Val::None).0;
        g.merge(code, ident, &bid);
        if !a.get("gen").is(&gen) {
            // le détachement n'a duré qu'un instant : ni nouveau général ni nouveau numéro
            let res = self.f(g).get_or("generaux", list![]);
            if res.has(&gen) {
                res.remove(&gen);
            }
            a.set("gen", gen);
        }
        self.f(g).dec("army_count", 1);
        done
    }

    /// Faire provision au marché des armes qui manquent pour réarmer tout le monde, si le trésor le permet
    /// (le fer des canons s'achète au moment du réarmement : en magasin, l'atelier le consommerait).
    /// Python : `stock_arms(self)`.
    // game/ai.py, lignes 202 à 212
    pub fn stock_arms(&self, g: &mut Game) {
        let (code, r) = (self.code.as_str(), self.f(g).at("res"));
        let need = g.modernize_cost(code, &g.all_regs(code)).get_or("armes", 0).f();
        let short = need + self.arms_floor(g).atf("armes") - r.atf("armes");
        let p = g.market.atf("armes");
        if short >= 20.0 && p <= 1.35 * 3.5 {
            // min(1000, short, purse / (1.5 * p)) : le premier des plus petits
            let bourse = self.arms_purse(g) / (1.5 * p);
            let mut m = 1000.0;
            if short < m {
                m = short;
            }
            if bourse < m {
                m = bourse;
            }
            let qty = py::int(m);
            if qty >= 20 {
                g.market_trade(code, &Val::from("armes"), &Val::from(qty), &Val::from("buy"));
            }
        }
    }

    /// Une armée au repos dans une de nos places reçoit les armes du moment, si l'arsenal peut les fournir.
    /// Python : `rearm_here(self, a)`.
    // game/ai.py, lignes 214 à 223
    pub fn rearm_here(&self, g: &mut Game, a: &Val) {
        let code = self.code.as_str();
        if a.atb("ai") && a.at("ai").get("then") == "rearm" {
            a.set("ai", Val::None); // détour accompli (ou impossible) : l'armée reprend le cours de ses ordres
        }
        let nid = a.at("at_node");
        if nid.is_none() || g.nodes.at(&nid).at("owner") != code || g.nodes.at(&nid).atb("siege") {
            return;
        }
        if self.arm_gap(g, &a.at("regs")).0 != 0 {
            self.rearm_group(g, "army", &a.at("id"), &a.at("regs"));
        }
    }

    /// Une armée démodée fait un crochet par la place amie la plus proche pour y toucher ses nouvelles armes :
    /// en paix ou loin de l'ennemi ; en guerre près du front, seulement si elle a deux générations de retard
    /// ou si la place est sur son chemin.
    /// Python : `rearm_detour(self, a, wars)`.
    // game/ai.py, lignes 225 à 259
    pub fn rearm_detour(&mut self, g: &mut Game, a: &Val, wars: &Val) -> bool {
        let code = self.code.clone();
        let (gap, _) = self.arm_gap(g, &a.at("regs"));
        if gap == 0 || Val::from(g.t) < self.cool.get_or(tup!["rearm", a.at("id")], -1) {
            return false;
        }
        if a.at("at_node").is_some() && g.nodes.at(a.at("at_node")).at_is("owner", &code) {
            return false; // déjà dans une de nos places : l'arsenal y a donné ce qu'il pouvait
        }
        // le détour n'en vaut la peine que si l'arsenal peut réarmer une bonne part de l'armée
        let (cost, room) = (g.modernize_cost(&code, &a.at("regs")), self.arms_room(g));
        if cost.items().iter().any(|(k, v)| *k != "livres" && *v > 0i64 && room.get_or(k, 0) < 0.4 * v) {
            return false;
        }
        let (x, y) = (a.atf("x"), a.atf("y"));
        let reach = if wars.truthy() {
            let mut foes: Vec<f64> = g
                .armies
                .values()
                .iter()
                .filter(|b| wars.has(b.at("owner")) && !b.atb("hidden"))
                .map(|b| py::hypot(b.atf("x") - x, b.atf("y") - y))
                .collect();
            for (n, gn) in g.nodes.iter().zip(g.geo.nodes.iter()) {
                if wars.has(n.at("owner")) {
                    foes.push(py::hypot(gn.atf("x") - x, gn.atf("y") - y));
                }
            }
            let far = py::min_f(foes).unwrap_or(999.0) > 90.0;
            if far { 150.0 } else if gap >= 2 { 80.0 } else { 15.0 }
        } else {
            180.0
        };
        let mut best: Option<(f64, Val)> = None;
        for n in g.owned_nodes(&code).iter() {
            if n.atb("siege") || (wars.truthy() && self.threat_at(g, n.ati("id"), 25.0, &Val::None, &Val::None) > 0.0) {
                continue;
            }
            let gn = g.geo.nodes.at(n.at("id"));
            let d = py::hypot(gn.atf("x") - x, gn.atf("y") - y);
            if d <= reach && best.as_ref().map_or(true, |b| d < b.0) {
                best = Some((d, n.at("id")));
            }
        }
        self.cool.set(tup!["rearm", a.at("id")], g.t + 45.0); // pas de va-et-vient : un essai par mois et demi
        match best {
            Some((_, nid)) if self.go(g, a, &nid, &dict! {"tr" => true}) => {}
            _ => return false,
        }
        a.set("ai", dict! {"then" => "rearm"});
        true
    }

    /// Saboter les remparts d'une place ennemie que nos armées convoitent, ou espionner un voisin.
    /// Python : `espionage(self)`.
    /// Hasard : self.rng. `cands.sort(reverse=True)` trie des tuples (valeur, place).
    // game/ai.py, lignes 261 à 279
    pub fn espionage(&mut self, g: &mut Game) {
        let (code, f) = (self.code.clone(), self.f(g));
        let wars = self.wars(g);
        if !wars.truthy() || f.at("res").at("livres") < 450i64 || self.rng.random() > 0.35 {
            return;
        }
        let mine: Vec<Val> = g.armies.values().into_iter().filter(|a| a.at_is("owner", &code)).collect();
        let mut cands: Vec<(f64, i64)> = vec![];
        for n in g.nodes.iter() {
            if !wars.has(n.at("owner")) || n.at("fort") < 2i64 {
                continue;
            }
            let (x, y) = g.node_xy(n.ati("id"));
            let d = py::min_f(mine.iter().map(|a| py::hypot(a.atf("x") - x, a.atf("y") - y))).unwrap_or(999.0);
            if d < 70.0 {
                let val = (VALUE().at(g.geo.nodes.at(n.at("id")).at("type")) * n.at("fort")).f() / (d + 10.0);
                cands.push((val, n.ati("id")));
            }
        }
        if !cands.is_empty() {
            let cands = py::sorted_by_key_rev(cands, |c| *c);
            g.spy(&code, cands[0].1, &Val::from("saboter"));
        }
    }
}
