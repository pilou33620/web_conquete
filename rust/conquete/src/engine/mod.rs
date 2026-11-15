//! Moteur de simulation de Conquête, campagne Aquitaine 1790 (temps réel, piloté par le serveur).
//! Porte game/engine.py, lignes 1 à 152 : constantes, fonctions de module, la classe `Game` et sa création.
//! Le reste de la classe est découpé en parties, dans l'ordre du Python, chacune avec son `impl Game` :
//!
//!     utilitaires.rs   lignes  154 à  817   utilitaires, armement et noms d'époque, boucle, jours / météo / événements
//!     economie.rs      lignes  819 à 1523   économie, recrutement & construction, dégâts des villes
//!     armees.rs        lignes 1525 à 1855   armées, généraux, canons des remparts
//!     chemins.rs       lignes 1857 à 2705   chemins (routes, ordres de marche, marche, sièges)
//!     batailles.rs     lignes 2707 à 3610   visibilité, contacts et batailles, tactique
//!     prise.rs         lignes 3612 à 4376   prise d'une place, usure, fleuves, espions, impôts, ordres du joueur
//!
//! SQUELETTE : les constantes, `Date`, `Paire`, le struct `Game` et `Game::__new__` sont portés ; tous les autres
//! corps sont des `todo!()`. Une signature ne se change pas sans le signaler (PORTAGE.md).
//!
//! Conventions de ce module (en plus de PORTAGE.md) :
//! - `&self` : une lecture pure, qui n'appelle aucun autre module avec la partie. Les caches que ces lectures
//!   remplissent sont des `Cell` / `RefCell` (`self._cache_date.set(…)`) : on peut donc écrire
//!   `self.log("eco", &format!("… {}", self.fname(code)), &kw)`. Tout le reste est `&mut self`, en particulier toute
//!   méthode qui passe `self` à un autre module (AA, CT, TT, TB, RL, EV, FM, BL), tire au hasard ou écrit dans le journal.
//! - `code` : le code d'un camp (`"33"`), ou `R::NEUTRAL` ; `&str`, sauf là où le Python peut passer `None` (`&Val`).
//! - `nid` : numéro de place (`i64`) ; `aid` : identifiant d'armée (`"a12"`), `&Val` car il vient tel quel du navigateur.
//! - `(bool, String)` : `(ok, message)` d'un ordre. `(Option<bool>, String)` : `None` quand l'ordre attend la
//!   confirmation du joueur (le texte est alors la question).
//! - `Game.mod` s'appelle `mod_` (`mod` est un mot réservé de Rust).
//! - `datetime.date` est `Date` (ci-dessous : le socle n'a pas de date).
#![allow(unused_imports, unused_variables)] // squelette : à retirer quand les corps sont portés

use crate::ai::AI;
use crate::army_actions as AA;
use crate::battle_log as BL;
use crate::cities as CT;
use crate::crue as CR;
use crate::events as EV;
use crate::familles as FM;
use crate::geo::{GeoMap, TERRAIN, T_LANDE, T_MARAIS, T_PLAINE};
use crate::py::{self, heapq, Random, Val};
use crate::rails as RL;
use crate::rules as R;
use crate::tactics::battle::TacticalBattle;
use crate::tactics::bridge as TB;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};
use indexmap::{IndexMap, IndexSet};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

mod armees;
mod batailles;
mod chemins;
mod economie;
mod prise;
mod utilitaires;

pub const SUBSTEP: f64 = 0.05; // jours
pub const ATTRITION_STEP: f64 = 0.25; // jours : pas de l'usure, des désertions et du ravitaillement des armées
pub const CONTACT_KM: f64 = 2.6;
pub const AMBUSH_KM: f64 = 5.0;
pub const BASE_DETECT: f64 = 2.5;
pub const SITE_DAYS: i64 = 120; // jours qu'un champ de bataille reste sur la carte (Game.sites)
pub const START_DATE: Date = Date::new(1790, 3, 4);
pub const START_ORD: i64 = START_DATE.toordinal();
py_const!(PROD_KEYS, tup!["livres", "vivres", "recrues", "industrie", "fer", "bois"]);

// ------------------------------------------------------------------ datetime.date (absent du socle)
/// `datetime.date` : une date du calendrier grégorien. `d.year`, `d.month`, `d.day` ; `<`, `>=`, `==` comme en
/// Python ; `d.toordinal()`, `Date::fromordinal(n)`, `d.yday()` pour `d.timetuple().tm_yday`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    pub year: i64,
    pub month: i64,
    pub day: i64,
}

const DAYS_BEFORE_MONTH: [i64; 13] = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

impl Date {
    /// `datetime.date(year, month, day)` (une date impossible n'est pas refusée : le jeu n'en construit pas).
    pub const fn new(year: i64, month: i64, day: i64) -> Date {
        Date { year, month, day }
    }
    /// `datetime.date(*t)` d'un tuple ou d'une liste (année, mois, jour) : `Date::de(&R::DEPT_DATE())`.
    pub fn de(t: &Val) -> Date {
        Date::new(t.ati(0), t.ati(1), t.ati(2))
    }
    pub const fn bissextile(year: i64) -> bool {
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    }
    /// `calendar.monthrange(year, month)[1]` : le nombre de jours du mois.
    pub const fn days_in_month(year: i64, month: i64) -> i64 {
        match month {
            2 => 28 + Date::bissextile(year) as i64,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        }
    }
    /// `d.timetuple().tm_yday` : le rang du jour dans l'année (1er janvier : 1).
    pub const fn yday(&self) -> i64 {
        DAYS_BEFORE_MONTH[self.month as usize] + (self.month > 2 && Date::bissextile(self.year)) as i64 + self.day
    }
    /// `d.toordinal()` : le 1er janvier de l'an 1 vaut 1.
    pub const fn toordinal(&self) -> i64 {
        let y = self.year - 1;
        y * 365 + y / 4 - y / 100 + y / 400 + self.yday()
    }
    /// `datetime.date.fromordinal(n)`.
    pub fn fromordinal(n: i64) -> Date {
        let n = n - 1;
        let (n400, n) = (n.div_euclid(146097), n.rem_euclid(146097));
        let (n100, n) = (n / 36524, n % 36524);
        let (n4, n) = (n / 1461, n % 1461);
        let (n1, n) = (n / 365, n % 365);
        let year = n400 * 400 + 1 + n100 * 100 + n4 * 4 + n1;
        if n1 == 4 || n100 == 4 {
            return Date::new(year - 1, 12, 31);
        }
        let leap = n1 == 3 && (n4 != 24 || n100 == 3);
        let mut month = (n + 50) >> 5;
        let mut preceding = DAYS_BEFORE_MONTH[month as usize] + (month > 2 && leap) as i64;
        if preceding > n {
            month -= 1;
            preceding -= Date::days_in_month(year, month);
        }
        Date::new(year, month, n - preceding + 1)
    }
}

// ------------------------------------------------------------------ fonctions de module
pub fn ordinal(n: i64) -> String {
    if n == 1 { "1re".to_string() } else { format!("{n}e") }
}

/// Valeur d'une courbe [(année, valeur, …)] interpolée à l'année y, et l'étiquette du segment en cours.
/// pts : une liste de tuples (année, valeur) ou (année, valeur, étiquette) — `R::POP_ERA()`, `R::pop_curve(gn)`.
/// Rend (valeur, étiquette) ; l'étiquette est `Val::None` quand le point n'en a pas.
pub fn curve_at(pts: &Val, y: f64) -> (f64, Val) {
    let etiquette = |p: &Val| if p.len() > 2 { p.at(2) } else { Val::None };
    let p0 = pts.at(0);
    if y <= p0.atf(0) {
        return (p0.atf(1), etiquette(&p0));
    }
    let v = pts.vec();
    for w in v.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if y < b.atf(0) {
            return (a.atf(1) + (b.atf(1) - a.atf(1)) * (y - a.atf(0)) / (b.atf(0) - a.atf(0)), etiquette(a));
        }
    }
    let p = pts.at(-1);
    (p.atf(1), etiquette(&p))
}

// ------------------------------------------------------------------ la partie
/// Une paire de codes, pour chercher dans `Game::diplo` (et `Game::_frontieres`) sans rien allouer :
/// `self.diplo.get(&Paire(a, b))`. (Même hachage que la clé `(String, String)`.)
#[derive(Clone, Copy, Hash, PartialEq, Eq)]
pub struct Paire<'a>(pub &'a str, pub &'a str);
impl indexmap::Equivalent<(String, String)> for Paire<'_> {
    fn equivalent(&self, k: &(String, String)) -> bool {
        self.0 == k.0 && self.1 == k.1
    }
}

/// Ce que `Game::node_static` garde d'une place : (gn, production de base {clé de PROD_KEYS: valeur}, quai,
/// landes ou marais, collines ou montagnes).
pub type NodeStatic = (Val, Val, bool, bool, bool);

/// `class Game`. Les attributs de `__init__`, les attributs de classe (`_cache_…`), ceux que engine.py pose en
/// route (`getattr(self, …, défaut)` : ils ont ici leur défaut dès la création) et ceux que les autres fichiers
/// lui posent (bridge, army_actions, cities, diplomacy, outils/simuler). Les attributs sauvegardés sont ceux de
/// `views::SAVE_KEYS`, plus `diplo` et `_blockade`.
/// Les places de chaque camp, relevées d'un seul passage sur la carte (Game::owned) : bonnes tant qu'aucune clé
/// « owner » n'a été écrite (`py::generation_owner`) et que `nodes` est la même liste, des mêmes dicts.
pub struct Proprios {
    pub gen: u64,
    pub nodes: Val,
    pub vus: Vec<Val>,
    pub par_camp: HashMap<Rc<str>, Vec<usize>>,
}

pub struct Game {
    // caches de calcul (jamais sauvegardés) : date du jour, année et croissance séculaire du jour, chefs-lieux
    /// (ordinal du jour, sa date) ; None : à refaire. (skirmish.py le remet à None : `g._cache_date.set(None)`.)
    pub _cache_date: Cell<Option<(i64, Date)>>,
    /// (date, année décimale).
    pub _cache_year: Cell<Option<(Date, f64)>>,
    /// (année décimale, croissance séculaire).
    pub _cache_era: Cell<Option<(f64, f64)>>,
    /// (la carte, {code: numéro du chef-lieu ou None}) ; refait si la carte n'est plus la même (`Rc::ptr_eq`).
    pub _cache_cap: RefCell<Option<(Rc<GeoMap>, Val)>>,
    /// (la carte, {nid: NodeStatic}) : voir node_static.
    pub _cache_ns: RefCell<Option<(Rc<GeoMap>, HashMap<i64, NodeStatic>)>>,
    /// (le dict de `_pcache` qui a servi, la part de chaque place dans la croissance) : voir pop_factor ;
    /// refait quand `_pcache` n'est plus ce dict-là (`Val::is`).
    pub _cache_rel: RefCell<Option<(Val, Vec<f64>)>>,
    /// Les places de chaque camp : voir owned.
    pub _cache_owned: RefCell<Option<Proprios>>,

    // ================================================================== création
    /// La carte (partagée avec le serveur et les batailles).
    pub geo: Rc<GeoMap>,
    /// Le code du camp du joueur.
    pub player: String,
    /// Une clé de R::SCENARIOS() ('1790' par défaut).
    pub scenario: String,
    /// Ordinal de la date du premier jour (t = 0).
    pub start_ord: i64,
    /// Une clé de R::DIFFICULTY() ('normal' par défaut).
    pub difficulty: String,
    pub seed: i64,
    pub rng: Random,
    /// Le temps de la partie, en jours depuis start_ord.
    pub t: f64,
    /// Rang dans R::SPEEDS() ; 0 : en pause.
    pub speed_idx: i64,
    /// Compteur commun des identifiants (nid) : armées, régiments, batailles, propositions…
    pub uid: i64,
    /// Numéro du dernier événement du journal.
    pub seq: i64,
    /// Le journal : liste de dict(seq, t, date, kind, text, x, y, who, important, …) ; 400 au plus (log).
    pub events: Val,
    /// Propositions diplomatiques en attente : liste de dict (game/diplomacy.py).
    pub proposals: Val,
    /// {aid: armée} (voir create_army pour les clés d'une armée).
    pub armies: Val,
    /// {bid: bataille} (voir start_battle pour les clés d'une bataille).
    pub battles: Val,
    /// champs de bataille récents, pour la carte (blessés, tombes) : dict(x, y, t, l, o, w, p)
    pub sites: Val,
    /// Espions en route : liste de dict(by, node, kind, done).
    pub spies: Val,
    /// Un set de numéros de places (ports et quais bloqués) : voir compute_blockades.
    pub _blockade: Val,
    /// None, ou dict(result, t, text) quand la partie est finie.
    pub over: Val,
    /// Fin de la grande crue (jour de la partie) ; -1 au départ (un entier en Python, un flottant ensuite).
    pub flood_until: f64,
    /// {(a, b) avec a < b: 'paix' | 'guerre' | 'alliance'}, dans l'ordre d'insertion (la sauvegarde le suit).
    /// Table native : at_war est appelé des millions de fois par mois. Chercher avec `Paire(a, b)`.
    pub diplo: IndexMap<(String, String), String>,
    /// Prix du marché : {ressource: prix} (copie de R::MARKET_BASE()).
    pub market: Val,
    pub _dirty_income: bool,
    pub _last_day: i64,
    /// {code: jour de la prochaine réflexion de son IA}.
    pub _ai_clock: Val,
    /// {zone de R::ZONES(): dict(kind, left[, mud])}.
    pub weather: Val,
    pub y_mont: f64,
    pub x_cote: f64,

    /// {code: camp} (voir __init__ pour les clés d'un camp), dans l'ordre de R::FACTIONS().
    pub factions: Val,
    /// Liste des places, dans l'ordre de geo.nodes (`self.nodes[nid]`) : dict(id, owner, milice, milice_max, fort,
    /// dev, pop, assim, stab, garrison, queue, siege, last_seen, depot, rf, ph, …).
    pub nodes: Val,
    /// Identifiant de l'époque en cours (R::ERAS()) ; None dans une très ancienne sauvegarde (check_era le pose).
    pub era_id: Val,
    /// décisions qui attendent le joueur
    pub pending_ev: Val,
    /// tour par tour, mois par mois (game/turns.py) ; None le temps d'un chargement (TT.migrate le pose)
    pub tour: Val,
    /// voies ferrées : {tronçon: dict(done, cut[, by, left, total])} (game/rails.py)
    pub rails: Val,
    /// événements datés déjà passés ; None dans une sauvegarde d'avant les événements (views.migrate le pose)
    pub ev_done: Val,
    /// Les IA de campagne, {code: AI} dans l'ordre des camps (le joueur n'en a pas, sauf dans les simulations).
    /// `None` le temps où une IA est sortie pour agir sur la partie : dans step,
    /// `let mut ai = self.ais[code].take().unwrap(); ai.step(self); self.ais[code] = Some(ai);`.
    /// La clé reste : `code in self.ais` s'écrit `self.ais.contains_key(code)`, même pendant le pas de cette IA.
    pub ais: IndexMap<String, Option<AI>>,

    // ------------------------------------------------------------------ posés en route par engine.py
    /// _pop_curves : None, puis dict(key, mult, rate, why, mean_k), refait chaque mois.
    pub _pcache: RefCell<Val>,
    /// Jour du dernier compute_income (step) ; -1.0 au départ.
    pub _income_t: f64,
    /// Temps écoulé depuis la dernière usure (step).
    pub _att_dt: f64,
    /// Temps écoulé depuis le dernier paquet d'évolutions lentes (economy).
    pub _slow_dt: f64,
    /// faction_power : (quart de journée, {code: puissance}).
    pub _forces: RefCell<Option<(i64, HashMap<String, f64>)>>,

    // ------------------------------------------------------------------ posés par les autres fichiers
    /// bridge.py : la bataille tactique en cours (`g.tactical = {bid: tb}` en Python : une seule à la fois, sa clé
    /// est `tb.bid`). On la sort de son champ le temps de la faire avancer avec la partie.
    pub tactical: Option<Box<TacticalBattle>>,
    /// bridge.py : la bataille tactique finie, gardée pour être relue (`g.tac_done = {bid: tb}`).
    pub tac_done: Option<Box<TacticalBattle>>,
    /// bridge.py : la bataille préparée pour le plan de la fenêtre de bataille, jamais enregistrée
    /// (`g.tac_preview = {bid: tb}`).
    pub tac_preview: Option<Box<TacticalBattle>>,
    /// bridge.py : réglages du joueur, dict(battles=…) ; None avant TB.ensure.
    pub settings: Val,
    /// army_actions.py (tick) : temps écoulé depuis le dernier quart de jour.
    pub _aa_dt: f64,
    /// army_actions.py (tick) : dernier jour traité ; -1 au départ.
    pub _aa_day: i64,
    /// army_actions.py : set des numéros des places où une armée est en quartiers (vide au départ).
    pub _aa_qn: Val,
    /// diplomacy.py (borders) : (quart de journée, paires (a, b) de camps voisins, dans les deux sens).
    pub _frontieres: Option<(i64, IndexSet<(String, String)>)>,
    /// cities.py : compteurs des événements de ville (dict, vide au départ ; jamais sauvegardé).
    pub city_stats: Val,
    /// outils/simuler.py : le joueur d'origine a été éliminé.
    pub lost_player: bool,
}

impl Game {
    /// `Game.__new__(Game)` : une partie vide, que `Game::new` et `views::from_dict` remplissent. Chaque attribut
    /// a le défaut que le Python lui donne à la création ou par `getattr(self, …, défaut)` ; le hasard est à
    /// remplacer (`g.rng = Random::new(…)`).
    pub fn __new__(geo: Rc<GeoMap>) -> Game {
        Game {
            _cache_date: Cell::new(None),
            _cache_year: Cell::new(None),
            _cache_era: Cell::new(None),
            _cache_cap: RefCell::new(None),
            _cache_ns: RefCell::new(None),
            _cache_rel: RefCell::new(None),
            _cache_owned: RefCell::new(None),
            geo,
            player: String::new(),
            scenario: "1790".to_string(),
            start_ord: START_ORD,
            difficulty: "normal".to_string(),
            seed: 0,
            rng: Random::new(0),
            t: 0.0,
            speed_idx: 0,
            uid: 1,
            seq: 0,
            events: list![],
            proposals: list![],
            armies: dict! {},
            battles: dict! {},
            sites: list![],
            spies: list![],
            _blockade: pyset![],
            over: Val::None,
            flood_until: -1.0,
            diplo: IndexMap::new(),
            market: dict! {},
            _dirty_income: true,
            _last_day: -1,
            _ai_clock: dict! {},
            weather: dict! {},
            y_mont: 0.0,
            x_cote: 0.0,
            factions: dict! {},
            nodes: list![],
            era_id: Val::None,
            pending_ev: list![],
            tour: Val::None,
            rails: dict! {},
            ev_done: Val::None,
            ais: IndexMap::new(),
            _pcache: RefCell::new(Val::None),
            _income_t: -1.0,
            _att_dt: 0.0,
            _slow_dt: 0.0,
            _forces: RefCell::new(None),
            tactical: None,
            tac_done: None,
            tac_preview: None,
            settings: Val::None,
            _aa_dt: 0.0,
            _aa_day: -1,
            _aa_qn: pyset![],
            _frontieres: None,
            city_stats: dict! {},
            lost_player: false,
        }
    }

    // ================================================================== création
    /// `Game(geo, player, difficulty='normal', seed=None, scenario='1790')`.
    /// difficulty, scenario : ce que le navigateur envoie (un texte en principe ; toute valeur inconnue donne
    /// 'normal' et '1790') ; seed : un entier, ou None pour une graine au hasard (`py::graine_hasard`).
    /// (Le Python finit par `from .ai import AI` : `self.ais = {c: AI(self, c) …}` pour tous les camps sauf le joueur.)
    // engine.py, lignes 54 à 152
    pub fn new(geo: Rc<GeoMap>, player: &str, difficulty: &Val, seed: &Val, scenario: &Val) -> Game {
        let mut g = Game::__new__(geo.clone());
        g.player = player.to_string();
        g.scenario = if R::SCENARIOS().has(scenario) { scenario.string() } else { "1790".to_string() };
        g.start_ord = Date::de(&R::SCENARIOS().at(&g.scenario).at("date")).toordinal();
        g.difficulty = if R::DIFFICULTY().has(difficulty) { difficulty.string() } else { "normal".to_string() };
        g.seed = if seed.is_some() { seed.i() } else { py::graine_hasard() };
        g.rng = Random::new(g.seed);
        g.t = 0.0;
        g.speed_idx = 0;
        g.uid = 1;
        g.seq = 0;
        g.flood_until = -1.0;
        g.market = R::MARKET_BASE().copy();
        g._dirty_income = true;
        g._last_day = -1;
        g.weather = Val::dict_from(R::ZONES().keys().into_iter().map(|z| (z, dict! {"kind" => "soleil", "left" => 2})).collect());
        g.y_mont = geo.xy(43.2, 0.0).1;
        g.x_cote = geo.xy(44.0, -0.95).0;

        g.factions = dict! {};
        // les camps de cette carte : toute la France (géographie 3), ou les cinq départements du Sud-Ouest (1 et 2)
        let codes: Vec<String> = R::FACTIONS().keys().into_iter().filter(|c| geo.playable_codes.has(c)).map(|c| c.string()).collect();
        for code in &codes {
            let res = dict! {"livres" => 500, "vivres" => 400, "fer" => 80, "bois" => 120, "armes" => 160, "outils" => 40, "recrues" => 900};
            let income = Val::dict_from(R::RESOURCES().iter().map(|r| (r, Val::from(0.0))).collect());
            let research = Val::dict_from(R::BRANCHES().iter().map(|b| (b, Val::None)).collect());
            let mut rel = vec![];
            for o in &codes {
                if o != code {
                    rel.push((Val::from(o), Val::from(g.rng.randint(-15, 25))));
                }
            }
            let f = dict! {
                "code" => code, "alive" => true, "res" => res, "income" => income, "slider" => 0.5, "research" => research,
                "techs" => list![], "rel" => Val::dict_from(rel), "trade" => dict! {}, "truce" => dict! {},
                "overlord" => Val::None, "war_since" => dict! {}, "mods" => dict! {}, "army_count" => 0,
                "stats" => dict! {"won" => 0, "lost" => 0, "captured" => 0, "killed" => 0},
                "start_nodes" => 0, "alerts" => dict! {}, "tax" => 0.5, "intel" => dict! {}, "prisoners" => dict! {},
                "weary" => 0.0, "prestige" => 0.0, "treaties" => dict! {},
                "tarif" => 0, "douaniers" => false,   // douane (SPEC-MERCENAIRES.md)
                "last_war" => -2.0 * 365.0, "refu" => 0.0   // au départ, de vieilles rancunes : les premières guerres viennent vite
            };
            g.factions.set(code, f);
            let maison = FM::nouvelle(&g, code); // famille dirigeante (game/familles.py)
            g.factions.at(code).set("maison", maison);
        }
        for a in &codes {
            for b in &codes {
                if a < b {
                    g.diplo.insert((a.clone(), b.clone()), "paix".to_string());
                }
            }
        }

        g.nodes = list![];
        for n in geo.nodes.iter() {
            let typ = n.at("type");
            let base = R::NODE_BASE().at(&typ);
            let owner = if typ == "capitale" || typ == "ville" { n.at("dept") } else { Val::from(R::NEUTRAL) };
            let fort0 = if typ == "capitale" {
                let f = n.at("fort");
                if Val::from(2) > f { Val::from(2) } else { f }
            } else {
                n.at("fort")
            };
            let mm = &base.at("milice") + &(40 * &fort0);
            let milice = if owner != R::NEUTRAL { mm.clone() } else { Val::from(py::int(mm.f() * g.rng.uniform(0.55, 1.0))) };
            let nid = n.ati("id");
            let nd = dict! {
                "id" => n.at("id"), "owner" => &owner, "milice" => milice.f(), "milice_max" => &mm, "fort" => fort0,
                "dev" => 0, "pop" => n.atf("pop0") * g.pop_trend(nid, &Val::None), "assim" => 1.0,
                "stab" => 1.0, "garrison" => list![], "queue" => list![], "siege" => Val::None, "last_seen" => dict! {},
                "depot" => 0, "rf" => 0
            };
            nd.set("ph", list![py::int(nd.atf("pop"))]); // population des douze derniers mois
            g.nodes.push(nd);
            if owner != R::NEUTRAL {
                g.factions.at(&owner).inc("start_nodes", 1);
            }
        }
        let sc = R::SCENARIOS().at(&g.scenario);
        if sc.getb("techs_before") {
            let tb = sc.at("techs_before");
            for f in g.factions.values() {
                // avec leurs prérequis, même datés après (le gemmage de 1740 suppose les semis de pins)
                let tech = R::TECH();
                let mut known: IndexSet<Val> = tech.keys().into_iter().filter(|t| R::TECH_YEAR().at(t) <= tb).collect();
                loop {
                    let missing: Vec<Val> = known
                        .iter()
                        .flat_map(|t| tech.at(t).at("req").vec())
                        .filter(|q| !known.contains(q))
                        .collect();
                    if missing.is_empty() {
                        break;
                    }
                    known.extend(missing);
                }
                f.set("techs", Val::list(tech.keys().into_iter().filter(|t| known.contains(t)).collect()));
            }
        }
        // (les techniques de l'époque d'abord : les premières troupes en ont les armes)
        for code in &codes {
            let cap = g.capital_of(code);
            let c = Val::from(code);
            let garrison = list![g.new_reg("ligne", &Val::None, &c), g.new_reg("ligne", &Val::None, &c), g.new_reg("cavalerie", &Val::None, &c)];
            g.nodes.at(&cap).set("garrison", garrison);
            let gn = geo.nodes.at(&cap);
            let (gx, gy) = (gn.atf("x"), gn.atf("y"));
            let regs: Val = ["ligne", "legere", "cavalerie"].iter().map(|t| g.new_reg(t, &Val::None, &c)).collect();
            g.create_army(code, gx, gy, &regs, &cap, &Val::None, &Val::None);
            g.recompute_mods(code);
        }
        g.era_id = g.era().at("id");
        TB::ensure(&mut g); // batailles tactiques : réglage, bataille en cours
        g.pending_ev = list![]; // décisions qui attendent le joueur
        g.tour = TT::new_state(true); // tour par tour, mois par mois (game/turns.py)
        g.rails = dict! {}; // voies ferrées : {tronçon: dict(done, cut[, by, left, total])} (game/rails.py)
        // une partie qui commence tard trouve ouvertes les lignes de son époque (en 1870 : Bordeaux–Bayonne, –Sète…)
        if sc.getb("techs_before") {
            for (sid, sec) in RL::sections(&g.geo).items() {
                let y = sec.at("year");
                if y > 0i64 && y < sc.at("date").at(0) {
                    g.rails.set(sid, dict! {"done" => true, "cut" => Val::None});
                }
            }
        }
        g.ev_done = list![]; // événements datés déjà passés
        if g.scenario == "1790" {
            let t = format!("4 mars 1790 : l'Assemblée crée les départements. Vous gouvernez {}.", g.fname(player));
            g.log("info", &t, &dict! {"important" => true});
        } else {
            let t = format!("{} — {}. Vous gouvernez {}.", g.date_str(&Val::None), g.era().at("name"), g.fname(player));
            g.log("info", &t, &dict! {"important" => true});
        }
        let t = format!(
            "Objectif : prendre tous les chefs-lieux (ou obtenir la soumission de leurs {}s), ou être le plus prestigieux à la fin de 1899.",
            g.dept_word()
        );
        g.log("info", &t, &dict! {});
        let mut ais = IndexMap::new();
        for c in codes.iter().filter(|c| *c != player) {
            ais.insert(c.clone(), Some(AI::new(&g, c)));
        }
        g.ais = ais;
        g.compute_income();
        g
    }
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn dates_de_python() {
        // (toordinal, année, mois, jour, tm_yday) relevés de datetime.date
        let cas = [
            (653482, 1790, 3, 4, 63), (620607, 1700, 3, 1, 60), (657130, 1800, 2, 28, 59), (657131, 1800, 3, 1, 60),
            (658591, 1804, 2, 29, 60), (693595, 1899, 12, 31, 365), (693596, 1900, 1, 1, 1), (730179, 2000, 2, 29, 60),
            (730485, 2000, 12, 31, 366), (1, 1, 1, 1, 1), (668844, 1832, 3, 26, 86),
        ];
        for (o, y, m, j, yd) in cas {
            let d = Date::new(y, m, j);
            assert_eq!((d.toordinal(), d.yday()), (o, yd));
            assert_eq!(Date::fromordinal(o), d);
        }
        assert_eq!(START_ORD, 653482);
        assert_eq!(Date::fromordinal(653833 + 40000), Date::new(1900, 8, 26));
        let mut d = Date::new(1699, 12, 31); // chaque jour de deux siècles, dans l'ordre
        for o in d.toordinal() + 1..Date::new(1901, 1, 1).toordinal() {
            let e = Date::fromordinal(o);
            assert!(e > d && e.toordinal() == o && e.day <= Date::days_in_month(e.year, e.month));
            d = e;
        }
    }

    #[test]
    fn paire_trouve_la_cle() {
        let mut diplo: IndexMap<(String, String), String> = IndexMap::new();
        diplo.insert(("24".to_string(), "33".to_string()), "guerre".to_string());
        assert_eq!(diplo.get(&Paire("24", "33")).map(String::as_str), Some("guerre"));
        assert!(diplo.get(&Paire("33", "24")).is_none());
    }
}
