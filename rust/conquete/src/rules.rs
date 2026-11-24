//! Règles du jeu : départements, unités, technologies, bâtiments, météo. Le portage de game/rules.py.
//!
//! Les constantes portent le nom du Python. Un nombre ou un texte est un `pub const` (`R::FORT_MAX`, `R::NEUTRAL`) ;
//! un dict, une liste, un tuple ou un set est un `py_const!`, qu'on appelle (`R::UNITS()`, `R::TECH()`) : il rend à
//! chaque appel le même objet, tel que le Python le laisse à la fin de l'import (FACTIONS avec les pays des théâtres,
//! UNITS avec les régiments étrangers, TECH avec ses étages et ses durées…). `constantes()` les rend toutes.
//!
//! Une exception : BUILD. Ses entrées tenaient deux lambdas (`cost`, `days`), qu'une valeur ne peut pas tenir :
//! `BUILD()` garde `name`, `max` et `desc`, et `BUILD[quoi]['cost'](lvl)` s'écrit `BUILD_cost(quoi, lvl)`,
//! `BUILD[quoi]['days'](lvl)` s'écrit `BUILD_days(quoi, lvl)`.
//!
//! Les fonctions (Rust n'a pas d'argument par défaut : ceux du Python sont entre parenthèses) :
//!
//!     de(nom: &str) -> String
//!     num(x: f64, dec: usize) -> String                                   (dec = 1)
//!     nb(x: f64) -> String
//!     pl(n: impl Into<Val>, sing: &str, plur: Option<&str>) -> String     (plur = None)
//!     BUILD_cost(quoi: &str, lvl: i64) -> Val                             (un dict)
//!     BUILD_days(quoi: &str, lvl: i64) -> Val                             (un entier ; un flottant pour 'repar')
//!     marks(techs: &Val) -> Val                                           (une liste)
//!     pop_curve(gn: &Val) -> Val                                          (une liste de tuples)
//!     hors_service(typ: &str, y: i64) -> bool
//!     tax_label(v: f64) -> String
//!     _etage(TECH: &Val, t: &str, seen: &Val) -> i64                      (seen = tup![] ; TECH : la table, qui se construit avec)
//!     _town(e1850: f64, e1900: f64, late: &str) -> Val                    (late = "ville")
//!     _rural(peak_year: i64, peak: f64, e1900: f64, late: &str, early: &str) -> Val     (early = "plein")
//!     _t(label: &str, desc: &str, trait_: impl Into<Val>, etage: i64, fx: Val) -> Val   (fx : les **fx, en dict)

use crate::py::{self, Val};
use crate::{dict, list, py_const, pyset, tup};

py_const!(RESOURCES, list!["livres", "vivres", "fer", "bois", "armes", "outils", "recrues"]);
py_const!(RES_LABEL, dict!{"livres" => "Livres", "vivres" => "Vivres", "fer" => "Fer", "bois" => "Bois", "armes" => "Armes", "outils" => "Outils", "recrues" => "Recrues"});

// ------------------------------------------------------------------ départements
// (la table telle qu'elle est écrite ici ; FACTIONS() la rend complétée par les pays des théâtres, plus bas)
fn FACTIONS_base() -> Val { dict!{
    "33" => dict!{"name" => "Gironde", "short" => "Gironde", "capital" => "Bordeaux", "color" => "#c0392b", "adj" => "girondin",
               "title" => "Le Négoce bordelais",
               "pros" => list!["Port de Bordeaux : +25 % de livres", "Accords commerciaux +25 %", "Vins : +30 % de revenus viticoles"],
               "cons" => list!["Milice bourgeoise : infanterie −8 %", "Recrues −15 %"],
               "mods" => dict!{"livres" => 0.25, "trade" => 0.25, "vin" => 0.3, "inf_power" => -0.08, "recrues" => -0.15},
               "personality" => dict!{"aggr" => 0.45, "trade" => 0.9, "expand" => 0.6, "tech" => "civil"}, "specialty" => "livres"},
    "24" => dict!{"name" => "Dordogne", "short" => "Dordogne", "capital" => "Périgueux", "color" => "#2e8b3a", "adj" => "périgourdin",
               "title" => "Les Forges du Périgord",
               "pros" => list!["Forges : +40 % de fer", "Canons coulés sur place : artillerie −20 %", "Châteaux : fortifications +10 %"],
               "cons" => list!["Pays rural : livres −10 %", "Relief : routes −5 %"],
               "mods" => dict!{"fer" => 0.4, "art_cost" => -0.2, "fort_bonus" => 0.1, "livres" => -0.1, "road_speed" => -0.05},
               "personality" => dict!{"aggr" => 0.55, "trade" => 0.5, "expand" => 0.7, "tech" => "industriel"}, "specialty" => "fer"},
    "40" => dict!{"name" => "Landes", "short" => "Landes", "capital" => "Mont-de-Marsan", "color" => "#e0a526", "adj" => "landais",
               "title" => "Les Échassiers des Landes",
               "pros" => list!["Embuscades +35 %", "Usure dans landes et marais −60 %", "Résine et pins : +30 % de bois", "Cachés plus facilement"],
               "cons" => list!["Sol pauvre : vivres −25 %", "Livres −10 %"],
               "mods" => dict!{"ambush" => 0.35, "marsh_attr" => -0.6, "bois" => 0.3, "stealth" => 1, "vivres" => -0.25, "livres" => -0.1},
               "personality" => dict!{"aggr" => 0.6, "trade" => 0.5, "expand" => 0.8, "tech" => "militaire"}, "specialty" => "bois"},
    "47" => dict!{"name" => "Lot-et-Garonne", "short" => "Lot-et-G.", "capital" => "Agen", "color" => "#8e44ad", "adj" => "agenais",
               "title" => "Le Grenier de l'Aquitaine",
               "pros" => list!["Blé et prunes : +35 % de vivres", "Recrues +15 %", "Entretien des troupes −20 %"],
               "cons" => list!["Plaine ouverte : fortifications −10 %", "Industrie −15 %"],
               "mods" => dict!{"vivres" => 0.35, "recrues" => 0.15, "upkeep" => -0.2, "fort_bonus" => -0.1, "industrie" => -0.15},
               "personality" => dict!{"aggr" => 0.35, "trade" => 0.8, "expand" => 0.6, "tech" => "agricole"}, "specialty" => "vivres"},
    "64" => dict!{"name" => "Basses-Pyrénées", "short" => "B.-Pyrénées", "capital" => "Pau", "color" => "#2b3fc4", "adj" => "béarnais",
               "title" => "Les Montagnards basques et béarnais",
               "pros" => list!["Infanterie +12 %", "Combat et marche en montagne +25 %", "Port de Bayonne : livres +10 %"],
               "cons" => list!["Isolement : industrie −10 %", "Commerce −15 %", "Vivres −10 %"],
               "mods" => dict!{"inf_power" => 0.12, "mountain" => 0.25, "livres" => 0.1, "industrie" => -0.1, "trade" => -0.15, "vivres" => -0.1},
               "personality" => dict!{"aggr" => 0.7, "trade" => 0.4, "expand" => 0.7, "tech" => "militaire"}, "specialty" => "recrues"}
} }
// (les théâtres, geo::THEATRES : 3 et 4, toute la France et ses départements générés, retirées le 22/11/2026) les pays de
// chaque théâtre, par numéro de géographie : game/data/pays_<id>.json, écrit par outils/europe.mjs ou outils/theatre.mjs ;
// chaque pays a les clés d'un camp, puis "moyens" (moyens_pays), "maisons" (MAISON_NOMS) et "culture" (prenoms…)
py_const!(PAYS, Val::dict_from(crate::geo::THEATRES.iter().map(|t| (Val::from(t.geo), py::json::loads(t.pays).unwrap_or_else(|e| panic!("pays_{}.json : {e}", t.id)))).collect()));
/// Les pays du théâtre de cette géographie (un dict vide ailleurs).
pub fn pays(geo: i64) -> Val {
    if geo == crate::geo::VERSION_MONDE {
        return PAYS_MONDE(); // (SPEC-EMPIRE, module 3)
    }
    PAYS().get_or(geo, Val::dict())
}
// (SPEC-EMPIRE, module 3) la carte monde : les pays de ses trois théâtres réunis (dans l'ordre de THEATRES, comme FACTIONS)
py_const!(PAYS_MONDE, {
    let d = Val::dict();
    for t in crate::geo::THEATRES.iter().filter(|t| crate::geo::THEATRES_MONDE.contains(&t.geo)) {
        d.update(&pays(t.geo));
    }
    d
});
/// (SPEC-EMPIRE, module 3) Le théâtre d'un pays (« europe », « amerique »…), None pour un département.
pub fn theatre_du_pays(code: &str) -> Option<&'static str> {
    crate::geo::THEATRES.iter().find(|t| pays(t.geo).has(code)).map(|t| t.id)
}
/// (SPEC-EMPIRE, module 3) La carte monde : chaque colonie d'Amérique et d'Inde (colonie, métropole d'Europe) y commence
/// vassale de sa métropole (engine::Game::new) : elle garde son gouvernement (une IA, ou le joueur), son armée et ses
/// places, paie le tribut et suit la métropole dans ses guerres. Les autres pays des théâtres restent indépendants.
pub const COLONIES: &[(&str, &str)] = &[
    ("AFR", "FR"), ("ALO", "FR"),   // Nouvelle-France, Louisiane
    ("AGB", "GB"), ("ATC", "GB"),   // Amérique de la couronne britannique, Treize Colonies
    ("AES", "ES"), ("ACU", "ES"),   // Nouvelle-Espagne, Cuba
    ("ANL", "NL"), ("ICY", "NL"),   // Antilles des Provinces-Unies, Ceylan néerlandais
    ("IGO", "PT"),                  // État portugais des Indes
];
/// Ce code est-il celui d'un pays (d'un théâtre) ? Les codes sont uniques sur tous les théâtres.
pub fn est_pays(code: &Val) -> bool {
    PAYS().values().iter().any(|p| p.has(code))
}
py_const!(FACTIONS, {
    let FACTIONS = FACTIONS_base();
    // (les pays après les départements : ceux-ci gardent leur rang ; une partie ne connaît que les camps de sa carte)
    for p in PAYS().values() {
        for (c, f) in p.items() {
            assert!(!FACTIONS.has(&c), "pays : le code {c} est déjà pris");
            FACTIONS.set(c, f);
        }
    }
    FACTIONS
});

// Production minimale garantie par jour tant que le département tient son chef-lieu
// (modulée par ses traits : forges du Périgord, pins des Landes, grenier agenais… ; les vivres suivent les saisons)
py_const!(FLOOR, dict!{"livres" => 20, "vivres" => 16, "fer" => 9, "bois" => 9, "recrues" => 8});
py_const!(WORKSHOP_RESERVE, dict!{"fer" => 80, "bois" => 120});   // les ateliers n'y touchent pas (le stock de départ : un atelier, une batterie)

// cours ordinaires du marché (Game.new_day les fait varier autour) : la seule source de ces prix
py_const!(MARKET_BASE, dict!{"vivres" => 0.6, "fer" => 2.0, "bois" => 1.0, "armes" => 3.5, "outils" => 3.0, "recrues" => 0.5});

pub const NEUTRAL: &str = "neutre";
pub const NEUTRAL_COLOR: &str = "#8d8a7a";

// ------------------------------------------------------------------ unités
pub const REPL_ARMES: f64 = 0.13;   // armes par recrue versée dans un régiment (renforts)
pub const REPL_ARMY: f64 = 0.005;   // renfort passif d'une armée au repos en ville, par jour : convalescents, traînards, petits détachements
pub const REPL_MONTE: f64 = 0.5;   // cavalerie et attelages se recomplètent deux fois moins vite : il faut des chevaux dressés
// (la table telle qu'elle est écrite ici ; UNITS() la rend complétée plus bas : régiments étrangers, valeurs par défaut)
fn UNITS_base() -> Val { dict!{
    "ligne" => dict!{"name" => "Infanterie de ligne", "short" => "Ligne", "men" => 300, "speed" => 22, "power" => 1.0,
                  "cost" => dict!{"livres" => 150, "armes" => 40, "recrues" => 300}, "days" => 12, "upkeep_v" => 0.6, "upkeep_l" => 1.0,
                  "terrain" => dict!{"Plaine" => 1.0, "Forêt" => 0.9, "Marais" => 0.85, "Montagne" => 0.9}},
    "legere" => dict!{"name" => "Infanterie légère (voltigeurs)", "short" => "Légère", "men" => 240, "speed" => 26, "power" => 0.95,
                   "cost" => dict!{"livres" => 170, "armes" => 35, "recrues" => 240}, "days" => 14, "upkeep_v" => 0.6, "upkeep_l" => 1.15,
                   "terrain" => dict!{"Plaine" => 0.9, "Forêt" => 1.3, "Lande" => 1.2, "Marais" => 1.2, "Montagne" => 1.25, "Collines" => 1.1, "Vignoble" => 1.1}},
    "cavalerie" => dict!{"name" => "Cavalerie (dragons, hussards)", "short" => "Cavalerie", "men" => 200, "speed" => 40, "power" => 1.35,
                      "cost" => dict!{"livres" => 260, "armes" => 25, "recrues" => 200, "vivres" => 60}, "days" => 18, "upkeep_v" => 1.1, "upkeep_l" => 1.6,
                      "terrain" => dict!{"Plaine" => 1.4, "Lande" => 1.1, "Vignoble" => 1.0, "Forêt" => 0.55, "Marais" => 0.45, "Montagne" => 0.5,
                               "Haute montagne" => 0.3, "Collines" => 0.9, "Dunes" => 0.6}},
    "artillerie" => dict!{"name" => "Artillerie (batterie de 8 pièces)", "short" => "Artillerie", "men" => 120, "speed" => 16, "power" => 2.6,
                       "cost" => dict!{"livres" => 300, "armes" => 60, "fer" => 40, "bois" => 30, "recrues" => 120}, "days" => 24, "upkeep_v" => 0.8, "upkeep_l" => 2.2,
                       "terrain" => dict!{"Plaine" => 1.3, "Collines" => 1.15, "Vignoble" => 1.0, "Forêt" => 0.5, "Marais" => 0.5, "Montagne" => 0.6,
                                "Haute montagne" => 0.4, "Lande" => 0.9}},
    "grenadiers" => dict!{"name" => "Grenadiers (compagnies d'élite)", "short" => "Grenadiers", "men" => 200, "speed" => 22, "power" => 1.45,
                       "cost" => dict!{"livres" => 260, "armes" => 45, "recrues" => 200}, "days" => 20, "upkeep_v" => 0.7, "upkeep_l" => 1.7,
                       "terrain" => dict!{"Plaine" => 1.0, "Forêt" => 0.9, "Marais" => 0.85, "Montagne" => 0.9}, "xp0" => 30, "morale0" => 10,
                       "req" => "baionnette", "desc" => "Infanterie d’élite : frappe fort, tient sous le feu, coûte cher."},
    "chasseurs" => dict!{"name" => "Chasseurs basques (montagnards)", "short" => "Chasseurs", "men" => 200, "speed" => 27, "power" => 0.95,
                      "cost" => dict!{"livres" => 160, "armes" => 30, "recrues" => 200}, "days" => 14, "upkeep_v" => 0.6, "upkeep_l" => 1.1,
                      "terrain" => dict!{"Plaine" => 0.85, "Forêt" => 1.25, "Lande" => 1.0, "Marais" => 1.0, "Vignoble" => 1.05, "Collines" => 1.35,
                               "Montagne" => 1.6, "Haute montagne" => 1.7},
                      "where" => tup!["64"], "desc" => concat!("Infanterie légère des montagnes : redoutable en relief, s’use peu dans les cols. ",
                                          "Levée seulement en Pays basque et en Béarn.")},
    "mitrailleuses" => dict!{"name" => "Mitrailleuses (batterie de Reffye)", "short" => "Mitrailleuses", "men" => 90, "speed" => 16, "power" => 2.2,
                          "cost" => dict!{"livres" => 320, "armes" => 70, "fer" => 40, "bois" => 20, "recrues" => 90}, "days" => 24, "upkeep_v" => 0.7, "upkeep_l" => 2.0,
                          "terrain" => dict!{"Plaine" => 1.3, "Collines" => 1.15, "Vignoble" => 1.0, "Forêt" => 0.5, "Marais" => 0.5,
                                   "Montagne" => 0.6, "Haute montagne" => 0.4, "Lande" => 0.9},
                          "req" => "mitrailleuse", "arm_name" => "Reffye",
                          "desc" => concat!("Six mitrailleuses de Reffye : un feu roulant à 1 200 mètres, redoutable contre l’infanterie ",
                               "à découvert, mais impuissant contre les remparts.")},
    "sapeurs" => dict!{"name" => "Sapeurs du génie", "short" => "Sapeurs", "men" => 150, "speed" => 20, "power" => 0.55,
                    "cost" => dict!{"livres" => 200, "armes" => 20, "outils" => 30, "recrues" => 150}, "days" => 16, "upkeep_v" => 0.6, "upkeep_l" => 1.3,
                    "terrain" => dict!{"Plaine" => 1.0, "Forêt" => 0.9, "Marais" => 0.9, "Montagne" => 0.9},
                    "desc" => concat!("Peu combatifs, mais chaque compagnie accélère les sièges et jette des ponts : ",
                         "l’armée franchit les fleuves sans attendre le bac.")},
    "garde" => dict!{"name" => "Garde nationale", "short" => "Garde nat.", "men" => 300, "speed" => 20, "power" => 0.55,
                  "cost" => dict!{"livres" => 50, "armes" => 15, "recrues" => 200}, "days" => 6, "upkeep_v" => 0.3, "upkeep_l" => 0.3,
                  "terrain" => dict!{"Plaine" => 1.0, "Forêt" => 0.9, "Marais" => 0.9, "Montagne" => 0.9}, "garrison_only" => true,
                  "desc" => concat!("Milice citoyenne bon marché, levée même dans un village : elle ne quitte pas sa ville, ",
                       "mais la défend avec ardeur (+30 %).")}
} }
// régiments étrangers (SPEC-MERCENAIRES.md) : loués contre des livres seulement (prime et solde doubles de la ligne),
// vétérans, prêts deux fois plus vite ; levés au chef-lieu ou dans un port, MERC_MAX par camp
pub const MERC_MAX: i64 = 2;


fn _merc(UNITS: &Val, base: &str, name: &str, short: &str, desc: &str) -> Val {
    let u = UNITS.at(base).copy();   // dict(UNITS[base], …) : une copie ; une clé déjà là garde sa place, une neuve va au bout
    u.set("name", name);
    u.set("short", short);
    u.set("desc", desc);
    u.set("cost", dict!{"livres" => 2 * UNITS.at("ligne").at("cost").at("livres")});
    u.set("upkeep_l", 2 * UNITS.at("ligne").at("upkeep_l"));
    u.set("days", UNITS.at(base).at("days").floordiv(2));
    u.set("xp0", 30);
    u
}


fn UNITS_update(UNITS: &Val) {
    let suisses = _merc(UNITS, "ligne", "Régiment suisse", "Suisses", "Infanterie suisse au service du roi : solide et fidèle, si la solde suit.");
    let irlandais = _merc(UNITS, "ligne", "Brigade irlandaise", "Irlandais", "Jacobites exilés, vétérans des guerres du roi : ardents à l’assaut.");
    let royal_allemand = _merc(UNITS, "cavalerie", "Royal-Allemand (cavalerie)", "Royal-All.", "Cavaliers allemands au service de France : une cavalerie aguerrie, louée à prix d’or.");
    let legion = _merc(UNITS, "ligne", "Légion étrangère", "Légion", "Volontaires étrangers sous le drapeau français : une troupe dure, qui marche partout.");
    UNITS.update(&dict!{"suisses" => suisses, "irlandais" => irlandais, "royal_allemand" => royal_allemand, "legion" => legion});
}
py_const!(MERCS, tup!["suisses", "irlandais", "royal_allemand", "legion"]);
py_const!(UNIT_ORDER, {
    let l = list!["ligne", "legere", "grenadiers", "chasseurs", "cavalerie", "artillerie", "mitrailleuses", "sapeurs", "garde"];
    l.extend(&MERCS());   // *MERCS
    l
});
// (SPEC-EMPIRE, module 4) bâtiment exigé pour lever un type d'unité : (chaîne de cities::CHAINS, niveau) ; la ligne,
// la Garde nationale (la milice) et les régiments étrangers n'en demandent aucun
py_const!(UNIT_REQ, dict!{
    "cavalerie" => tup!["haras", 1], "artillerie" => tup!["fonderie", 1], "mitrailleuses" => tup!["fonderie", 3],
    "legere" => tup!["ecole_militaire", 1], "chasseurs" => tup!["ecole_militaire", 1], "grenadiers" => tup!["ecole_militaire", 1],
    "sapeurs" => tup!["ecole_militaire", 1],
});
py_const!(UNIT_CLS, dict!{"cavalerie" => "cavalerie", "artillerie" => "artillerie", "mitrailleuses" => "artillerie",
            "royal_allemand" => "cavalerie"});   // tout le reste est de l'infanterie
py_const!(LIGHT_UNITS, tup!["legere", "chasseurs"]);
py_const!(READY, dict!{"grenadiers" => "prêts", "chasseurs" => "prêts", "sapeurs" => "prêts", "mitrailleuses" => "prêtes", "suisses" => "prêt",
         "royal_allemand" => "prêt"});   // les autres noms sont féminins
py_const!(UNITS, {
    let UNITS = UNITS_base();
    UNITS_update(&UNITS);
    for (_k, _u) in UNITS.items() {
        _u.setdefault("ready", READY().get_or(&_k, "prête"));
        _u.setdefault("cls", UNIT_CLS().get_or(&_k, "inf"));
        _u.setdefault("light", LIGHT_UNITS().has(&_k));
        _u.setdefault("garrison_only", false);
        _u.setdefault("req", Val::None);
        _u.setdefault("desc", "");
        _u.setdefault("arm_name", Val::None);   // armement fixe (pas de réarmement) : la pièce de Reffye
    }
    UNITS.at("ligne").set("desc", "Le gros de l’armée : feu de ligne, colonne d’assaut ou carré.");
    UNITS.at("legere").set("desc", "Voltigeurs : rapides, à l’aise en forêt, en lande et en marais, tendent des embuscades.");
    UNITS.at("cavalerie").set("desc", "Dragons et hussards : charge en terrain ouvert, poursuite, éclairage.");
    UNITS.at("artillerie").set("desc", "Batterie de 8 pièces : domine la canonnade et ouvre les brèches.");
    UNITS
});
// Population : chaque agrandissement ouvre de la place (+10 %), que les habitants remplissent mois après mois
// si la ville est sûre, nourrie et pas trop imposée ; ses ateliers produisent davantage une fois les faubourgs
// remplis. La production suit la population (son remplissage), la taille des villes suit l'histoire (POP_CURVES).
pub const POP_NATURAL: f64 = 0.05;   // croissance possible sans agrandissement
pub const POP_PER_LEVEL: f64 = 0.1;   // place gagnée à chaque agrandissement
pub const DEV_PROD: f64 = 0.3;   // production gagnée à chaque agrandissement, faubourgs remplis (aux prix de 1790 : un
                             // faubourg compte un peu plus en 1700, un peu moins en 1890, quand tout a grandi)
pub const POP_RATE: f64 = 0.12;   // part de la place libre comblée chaque mois, dans de bonnes conditions
py_const!(DEV_NAMES, dict!{
    "village" => list!["Village", "Village agrandi", "Gros bourg", "Bourg prospère"],
    "fort" => list!["Place forte", "Quartier neuf", "Ville de garnison", "Ville forte prospère"],
    "ville" => list!["Ville close", "Premiers faubourgs", "Nouveaux quartiers", "Grande ville"],
    "capitale" => list!["Ville close", "Premiers faubourgs", "Nouveaux quartiers", "Métropole"]
});
pub const DEPOT_KM: f64 = 30.0;   // rayon d'action d'un magasin aux vivres
pub const DEPOT_FOOD: f64 = 0.15;   // vivres par jour et par centaine d'hommes ravitaillés par un magasin
pub const PRISONER_FOOD: f64 = 0.003;   // vivres par jour et par prisonnier
pub const PRISONER_RANSOM: i64 = 2;   // livres par prisonnier racheté
py_const!(GENERAL_RANCON, list![60, 120, 200, 320, 500]);   // rançon d'un général selon son grade (livres)
pub const SAPEUR_SIEGE: f64 = 0.04;
pub const PROPOSAL_TOURS: i64 = 1;   // validité d'une proposition reçue : le tour qui suit (turns.deadline)
pub const PEACE_TRUCE: i64 = 4;   // trêve après une paix signée (tours)


/// « de » élidé devant une voyelle ou un h muet : d'Agen, d'avril, de Bordeaux.
pub fn de(nom: &str) -> String {
    if let Some(reste) = nom.strip_prefix("Le ") {
        return format!("du {reste}");       // le Bugue → du Bugue
    }
    if let Some(reste) = nom.strip_prefix("Les ") {
        return format!("des {reste}");
    }
    // nom[:1].lower() in '…' : un nom vide passe aussi (le texte vide est dans tout texte)
    let initiale: String = nom.chars().take(1).flat_map(char::to_lowercase).collect();
    if "aeiouyhâàéèêîïôöûü".contains(&initiale) {
        format!("d'{nom}")
    } else {
        format!("de {nom}")
    }
}


/// Nombre à la française : virgule décimale, signe moins typographique.
pub fn num(x: f64, dec: usize) -> String {
    let s = format!("{:.*}", dec, x.abs()).replace('.', ",");
    format!("{}{s}", if x < 0.0 { '−' } else { '+' })
}


/// Entier à la française, milliers séparés par une espace fine insécable : « 5 350 habitants ».
pub fn nb(x: f64) -> String {
    let s = py::milliers(py::round(x).abs()).replace(',', "\u{202f}");
    format!("{}{s}", if x < -0.5 { "−" } else { "" })
}


/// « 1 vignoble », « 3 vignobles ».
pub fn pl(n: impl Into<Val>, sing: &str, plur: Option<&str>) -> String {
    let n = n.into();
    let mot = if n.abs() < 2 {
        sing.to_string()
    } else {
        match plur {
            Some(p) if !p.is_empty() => p.to_string(),   // plur or sing + 's'
            _ => format!("{sing}s"),
        }
    };
    format!("{n} {mot}")          // avancée du siège par jour et par compagnie de sapeurs
}
pub const GARDE_HOME: f64 = 1.3;   // la Garde nationale défend sa propre ville

pub const MILICE_POWER: f64 = 0.6;

// ------------------------------------------------------------------ nœuds
py_const!(NODE_BASE, dict!{
    "capitale" => dict!{"livres" => 5, "vivres" => 1.8, "recrues" => 2.2, "industrie" => 3, "fer" => 0.2, "bois" => 0.3, "milice" => 600, "vision" => 26},
    "ville" => dict!{"livres" => 1.9, "vivres" => 1.3, "recrues" => 1.1, "industrie" => 1.1, "fer" => 0.1, "bois" => 0.25, "milice" => 220, "vision" => 20},
    "village" => dict!{"livres" => 0.6, "vivres" => 1.5, "recrues" => 0.6, "industrie" => 0.15, "fer" => 0, "bois" => 0.3, "milice" => 130, "vision" => 15},
    "fort" => dict!{"livres" => 0.3, "vivres" => 0.4, "recrues" => 0.4, "industrie" => 0.1, "fer" => 0, "bois" => 0.15, "milice" => 220, "vision" => 22}
});
py_const!(SPEC, dict!{
    "vin" => dict!{"livres" => 1.2, "label" => "Vignoble"},
    "port" => dict!{"livres" => 2.0, "label" => "Port"},
    "fer" => dict!{"fer" => 1.6, "label" => "Forges / mines"},
    "bois" => dict!{"bois" => 1.6, "label" => "Forêt exploitée"},
    "ble" => dict!{"vivres" => 1.2, "label" => "Blé"},
    "sel" => dict!{"livres" => 1.2, "label" => "Salines"},
    "tabac" => dict!{"livres" => 0.9, "label" => "Tabac & prunes"}
});
// Spécialités phares des villes principales (voir places.CITY_SPECIALTIES) : production par jour,
// et le modificateur (technologies) qui l'augmente.
py_const!(SPECIALTY, dict!{
    "grand_vin" => dict!{"label" => "Grand vin", "livres" => 0.85, "boost" => "vin"},
    "vin" => dict!{"label" => "Vin", "livres" => 0.55, "boost" => "vin"},
    "eau_de_vie" => dict!{"label" => "Eau-de-vie", "livres" => 0.6, "boost" => "vin"},
    "negoce" => dict!{"label" => "Négoce", "livres" => 0.85, "boost" => "port"},
    "peche" => dict!{"label" => "Pêche", "livres" => 0.3, "vivres" => 0.8, "boost" => "port"},
    "sel" => dict!{"label" => "Sel", "livres" => 0.6},
    "prune" => dict!{"label" => "Pruneaux", "livres" => 0.5, "vivres" => 0.3, "boost" => "terroir"},
    "terroir" => dict!{"label" => "Terroir", "livres" => 0.45, "vivres" => 0.3, "boost" => "terroir"},
    "salaisons" => dict!{"label" => "Salaisons", "livres" => 0.35, "vivres" => 0.4, "boost" => "terroir"},
    "betail" => dict!{"label" => "Élevage", "livres" => 0.25, "vivres" => 0.6, "recrues" => 0.2, "boost" => "terroir"},
    "ble" => dict!{"label" => "Grains", "livres" => 0.2, "vivres" => 0.9},
    "resine" => dict!{"label" => "Résine", "livres" => 0.3, "bois" => 0.6, "boost" => "resine"},
    "textile" => dict!{"label" => "Manufacture", "livres" => 0.35, "industrie" => 0.5, "boost" => "manuf"},
    "tabac" => dict!{"label" => "Tabacs", "livres" => 0.55, "industrie" => 0.3, "boost" => "manuf"},
    "forge" => dict!{"label" => "Forges", "fer" => 0.6, "industrie" => 0.4, "boost" => "manuf"}
});
pub const SPECIALTY_CAPITAL: f64 = 2.0;   // un chef-lieu produit davantage de sa spécialité
py_const!(VIN_KINDS, dict!{"grand_vin" => 2, "vin" => 1, "eau_de_vie" => 1});   // comptent aux vendanges (nombre de vignobles)

// Fortifications : niveaux 1 à 3 partout, niveau 4 (bastions à la Vauban) dans les chefs-lieux et les places fortes,
// après la technologie « Fortifications à la Vauban ». Chaque niveau s'entretient (livres par jour et par place).
pub const FORT_MAX: i64 = 3;
// canons du rempart (une batterie par niveau de fortification) : en résolution automatique, ils ne comptent qu'à
// moitié (mal placés contre un assaut en masse, et les murs donnent déjà leur bonus) ; entiers en bataille commandée
pub const FORT_GUNS_AUTO: f64 = 0.5;
pub const BASTION_LEVEL: i64 = 4;
// dégâts d'une ville (nodes[].deg, de 0 à 1 : part des maisons détruites) : batailles et bombardements des sièges
pub const DEG_PROD: f64 = 0.8;   // une ville détruite ne produit plus que 20 % (production × (1 − 0,8 × dégâts))
pub const DEG_SIEGE: f64 = 0.3;   // le bombardement d'un siège : 30 % de dégâts quand la brèche est complète (dmg 1)
pub const DEG_ASSAUT: f64 = 0.08;   // une bataille réglée sans carte tactique dans une place : 8 % de dégâts
pub const REPAR_TOURS: i64 = 6;   // réparer une ville entièrement détruite : 6 tours (au prorata, un tour au moins)
py_const!(REPAR_COST, dict!{"livres" => 420, "bois" => 160});   // … et ce prix, au prorata des dégâts et de la taille (cities.SIZE_COST)
py_const!(BASTION_TYPES, tup!["capitale", "fort"]);
py_const!(FORT_UPKEEP, list![0.0, 0.3, 0.7, 1.2, 2.0]);
py_const!(FORT_NAMES, list!["Sans remparts", "Mur d’enceinte", "Remparts", "Remparts bastionnés", "Bastions à la Vauban"]);
// (les lambdas `cost` et `days` de chaque entrée : BUILD_cost(quoi, lvl) et BUILD_days(quoi, lvl), juste après)
py_const!(BUILD, dict!{
    "fort" => dict!{"name" => "Fortifications", "max" => BASTION_LEVEL,
                 "desc" => "+1 niveau de fortification : défense accrue, sièges plus longs, mais entretien plus cher"},
    "depot" => dict!{"name" => "Magasin aux vivres", "max" => 1,
                  "desc" => concat!("Entrepôt et charrois : les armées en campagne à moins de 30 km restent ravitaillées, ",
                       "en puisant dans vos vivres")},
    "repar" => dict!{"name" => "Réparations", "max" => 1,
                  "desc" => "Relever les maisons brûlées et en ruine : la ville retrouve toute sa production"},
    "dev" => dict!{"name" => "Agrandissement", "max" => 3,
                "desc" => concat!("Nouveaux faubourgs : la ville peut accueillir 10 % d’habitants de plus, qui viennent s’y installer ",
                     "peu à peu, et ses ateliers s’étendent : plus de production, de recrues et de milice")}
});
/// `BUILD[quoi]['cost'](lvl)`.
pub fn BUILD_cost(quoi: &str, lvl: i64) -> Val {
    match quoi {
        "fort" => {
            if lvl < 3 {
                dict!{"livres" => 120 * (lvl + 1), "bois" => 40 * (lvl + 1), "fer" => 15 * (lvl + 1)}
            } else {
                dict!{"livres" => 650, "bois" => 180, "fer" => 90}
            }
        }
        "depot" => dict!{"livres" => 150, "bois" => 60},
        "repar" => REPAR_COST().copy(),
        "dev" => dict!{"livres" => 100 * (lvl + 1), "bois" => 50 * (lvl + 1), "outils" => 15 * (lvl + 1)},
        _ => panic!("KeyError: {}", py::repr_s(quoi)),
    }
}
/// `BUILD[quoi]['days'](lvl)`.
pub fn BUILD_days(quoi: &str, lvl: i64) -> Val {
    match quoi {
        "fort" => Val::from(if lvl < 3 { 20 + 12 * lvl } else { 70 }),
        "depot" => Val::from(12),
        "repar" => Val::from(30.0 * REPAR_TOURS as f64),
        "dev" => Val::from(18 + 10 * lvl),
        _ => panic!("KeyError: {}", py::repr_s(quoi)),
    }
}

// ------------------------------------------------------------------ technologies
py_const!(TECHS, list![
    // id, branche, nom, description, coût, jours, prérequis, effets
    tup!["baionnette", "militaire", "Fusil et baïonnette à douille", "Inventée à Bayonne : la pique disparaît, chaque fantassin tire et charge. Armement de l'infanterie : fusil à silex (×1,00 au lieu de ×0,85).", 375, 28, list![], dict!{}],
    tup!["fusil1777", "militaire", "Fusil modèle 1777", "Platine fiable, tir plus nourri (armement ×1,10). Ligne −10 % armes.", 750, 42, list!["baionnette"], dict!{"ligne_armes" => -0.1}],
    tup!["valliere", "militaire", "Système Vallière", "Calibres réglementés de 4 à 24 : artillerie ×0,95 au lieu de ×0,85.", 625, 35, list![], dict!{}],
    tup!["gribeauval", "militaire", "Système Gribeauval", "Canons standardisés et légers : artillerie ×1,15, plus rapide.", 875, 49, list!["valliere"], dict!{"art_speed" => 0.25}],
    tup!["etat_major", "militaire", "École d'état-major", "Officiers formés aux cartes et à la logistique : toutes armes +5 %, moral +5.", 1125, 56, list!["divisions"], dict!{"all_power" => 0.05, "morale" => 5}],
    tup!["valee", "militaire", "Système Valée", "Affûts à flèche, caissons montés : artillerie ×1,30, +10 % de vitesse.", 1125, 56, list!["gribeauval"], dict!{"art_speed" => 0.1}],
    tup!["percussion", "militaire", "Fusil à percussion", "L'amorce au fulminate ne craint plus l'humidité : armement ×1,22, la pluie gêne 60 % moins le tir.", 1125, 56, list!["fusil1777"], dict!{"rain" => 0.6}],
    tup!["minie", "militaire", "Fusil rayé (balle Minié)", "Le canon rayé porte à 400 mètres : armement ×1,40, tirailleurs +10 % à couvert.", 1375, 63, list!["percussion"], dict!{"legere_cover" => 0.1}],
    tup!["lahitte", "militaire", "Canons rayés La Hitte", "Obus oblongs, tir précis à 3 km : artillerie ×1,55.", 1375, 63, list!["valee"], dict!{}],
    tup!["chassepot", "militaire", "Fusil Chassepot", "Chargement par la culasse, 1 200 mètres : armement ×1,70. On tire couché, cinq coups à la minute.", 1625, 70, list!["minie"], dict!{"ligne_fire" => 0.1}],
    tup!["mitrailleuse", "militaire", "Mitrailleuse de Reffye", "25 canons tournés à la manivelle : on peut lever des batteries de mitrailleuses, feu roulant à 1 200 mètres, redoutable contre l’infanterie à découvert (+50 % à la fusillade en rase campagne et devant une position), impuissant contre les remparts (−40 % à l'assaut d'une ville ou d'un fort).", 1250, 56, list!["lahitte"], dict!{}],
    tup!["service_mil", "militaire", "Service militaire obligatoire", "Loi de 1872 : chaque classe passe sous les drapeaux. Recrues +25 %, recrutement −15 % de livres, moral +5. En bataille, des classes instruites et encadrées : le moral cède 20 % moins vite sous les pertes.", 1375, 63, list!["levee"], dict!{"recrues" => 0.25, "recruit_cost" => -0.15, "morale" => 5}],
    tup!["gras", "militaire", "Fusil Gras (cartouche métallique)", "La douille de laiton ne s'enraye plus : armement ×1,82.", 1500, 63, list!["chassepot"], dict!{}],
    tup!["debange", "militaire", "Canons de Bange", "Acier et culasse étanche : artillerie ×1,85, les sièges avancent 25 % plus vite.", 1750, 70, list!["lahitte"], dict!{"siege_speed" => 0.25}],
    tup!["lebel", "militaire", "Fusil Lebel et poudre sans fumée", "Magasin de huit cartouches, poudre B de Vieille : armement ×2,05, plus de nuage pour trahir le tireur (embuscades +20 %).", 1875, 77, list!["gras"], dict!{"ambush" => 0.2}],
    tup!["canon75", "militaire", "Canon de 75", "Frein hydropneumatique, tir rapide : artillerie ×2,30.", 2000, 84, list!["debange"], dict!{}],
    tup!["hussards", "militaire", "Hussards et éclaireurs", "Cavalerie +15 %, vision +6 km, débusque les embuscades.", 625, 35, list![], dict!{"cav_power" => 0.15, "vision" => 6, "detect" => 3}],
    tup!["voltigeurs", "militaire", "Tirailleurs et voltigeurs", "Embuscades +30 %, infanterie légère +20 % à couvert.", 750, 42, list!["baionnette"], dict!{"ambush" => 0.3, "legere_cover" => 0.2}],
    tup!["vauban", "militaire", "Fortifications à la Vauban", "Défense des places +15 %, milice +25 %, bastions (fortifications niveau 4) dans le chef-lieu et les places fortes.", 750, 42, list![], dict!{"fort_bonus" => 0.15, "milice" => 0.25}],
    tup!["levee", "militaire", "Levée en masse", "Recrutement −25 % de livres, formation −30 %, recrues +20 %. En bataille, la masse emporte tout : infanterie +15 % à la charge.", 1125, 56, list!["fusil1777"], dict!{"recruit_cost" => -0.25, "train" => -0.3, "recrues" => 0.2}],
    tup!["divisions", "militaire", "Système divisionnaire", "Toutes armes +8 %, moral +10, retraites moins coûteuses.", 1500, 70, list!["gribeauval", "levee"], dict!{"all_power" => 0.08, "morale" => 10, "retreat" => -0.5}],
    tup!["tir_rang", "militaire", "Feu de rang (tir en ligne)", "Les trois rangs tirent ensemble : infanterie en ligne +12 % en fusillade.", 625, 35, list!["baionnette"], dict!{"ligne_fire" => 0.12}],
    tup!["feu_peloton", "militaire", "Feu de peloton", "Feux roulants par pelotons : ligne encore +10 % en fusillade, le carré fusille mieux les escadrons (+30 %).", 875, 49, list!["tir_rang"], dict!{"ligne_fire" => 0.1, "carre_fire" => 0.3}],
    tup!["ordre_mixte", "militaire", "Ordre mixte (Guibert)", "Lignes et colonnes combinées : colonne +15 % à la charge, changements de formation deux fois plus rapides.", 750, 42, list!["tir_rang"], dict!{"colonne_charge" => 0.15, "fm_swift" => 0.5}],
    tup!["cuirassiers", "militaire", "Cuirassiers et carabiniers", "Cavalerie lourde cuirassée : cavalerie +20 % pendant la charge.", 875, 49, list!["hussards"], dict!{"cav_charge" => 0.2}],
    tup!["art_cheval", "militaire", "Artillerie à cheval", "Batteries montées : artillerie +10 %, plus rapide, et efficace jusque dans la charge (+30 %).", 1000, 56, list!["gribeauval"], dict!{"art_power" => 0.1, "art_speed" => 0.2, "art_charge" => 0.3}],
    tup!["genie", "militaire", "Corps du génie et sapeurs", "Tranchées et mines : les sièges avancent 40 % plus vite. À l'assaut d'une position, d'une ville ou d'un fort, les approches sont couvertes : pertes de l'assaillant −20 %.", 875, 49, list!["vauban"], dict!{"siege_speed" => 0.4}],
    tup!["aerostiers", "militaire", "Aérostiers (Fleurus)", "Un ballon captif au-dessus de l'état-major : en bataille, la manœuvre ennemie est éventée (sa stratégie ne contre plus la vôtre : il perd ses +20 %) ; la reconnaissance est plus sûre (+20 %) et possible sans cavalerie ; vision +3 km.", 875, 49, list!["genie"], dict!{"balloon" => 1500, "vision" => 3}],
    tup!["retranchements", "militaire", "Retranchements de campagne", "La pelle avant le fusil : l'infanterie qui défend une position, une ville ou un fort se retranche (+20 %, pertes −25 %) ; en rase campagne, « Tenir la ligne » creuse ses tranchées-abris (pertes −20 %).", 1250, 56, list!["genie"], dict!{"entrench" => 0.25}],
    tup!["dynamite", "militaire", "Dynamite (Nobel)", "Les sapeurs font sauter les murs : à l'assaut, une brèche de plus ; les sièges avancent 20 % plus vite.", 1250, 56, list!["genie"], dict!{"breach" => 1, "siege_speed" => 0.2}],
    tup!["melinite", "militaire", "Obus à la mélinite", "L'obus explosif perce murs et abris : à l'assaut d'une position, d'une ville ou d'un fort, artillerie +50 %.", 1625, 70, list!["dynamite", "debange"], dict!{"shell" => 0.5}],
    tup!["rail_militaire", "militaire", "Chemins de fer militaires", "Les régiments voyagent en wagons : les armées prendront le train sur les lignes de leur camp (avec les voies ferrées de la carte). En bataille, les renforts accourent de deux fois plus loin (16 km au lieu de 8).", 1375, 63, list!["chemins_fer"], dict!{"rail_troops" => 1}],

    tup!["ponts_chaussees", "civil", "Corps des Ponts et Chaussées", "Routes entretenues : +15 % de vitesse sur route.", 500, 35, list![], dict!{"road_speed" => 0.15}],
    tup!["ponts", "civil", "Ponts de pierre", "Plus de bac : les fleuves se franchissent sans délai.", 750, 42, list!["ponts_chaussees"], dict!{"bridges" => 1}],
    tup!["prefectures", "civil", "Administration préfectorale", "Livres +10 %, villes conquises pacifiées 2× plus vite.", 625, 42, list![], dict!{"livres" => 0.1, "stab" => 1.0}],
    tup!["chappe", "civil", "Télégraphe Chappe", "Vision des villes +10 km, alertes plus tôt.", 875, 49, list!["prefectures"], dict!{"node_vision" => 10}],
    tup!["larrey", "civil", "Ambulances de Larrey", "Pertes au combat −15 %, usure −40 %.", 750, 42, list![], dict!{"casualties" => -0.15, "attrition" => -0.4}],
    tup!["codecivil", "civil", "Code civil", "Livres +10 %, recrues +10 %, prestige diplomatique.", 1250, 62, list!["prefectures"], dict!{"livres" => 0.1, "recrues" => 0.1, "prestige" => 10}],
    tup!["diplomates", "civil", "Corps diplomatique", "Accords commerciaux +30 %, propositions mieux reçues.", 625, 35, list![], dict!{"trade" => 0.3, "diplo" => 15}],
    tup!["gendarmerie", "civil", "Gendarmerie nationale", "Brigades dans chaque canton : ordre public +8 %, moins de révoltes.", 625, 35, list![], dict!{"order" => 0.08}],
    tup!["cadastre", "civil", "Cadastre et contribution foncière", "Impôt juste et bien réparti : livres +6 %, les impôts lourds fâchent 40 % moins.", 750, 42, list!["prefectures"], dict!{"livres" => 0.06, "tax_unrest" => -0.4}],
    tup!["poste", "civil", "Poste aux chevaux et relais", "Relais sur les grandes routes : +8 % sur route, les armées s’épuisent 35 % moins vite hors de chez elles.", 625, 35, list!["ponts_chaussees"], dict!{"road_speed" => 0.08, "supply_drain" => -0.35}],
    tup!["canal", "civil", "Balisage de la Garonne et canaux", "Chenaux balisés, chemins de halage : gabares +25 % plus rapides, ports +10 %.", 875, 49, list!["ponts_chaussees"], dict!{"river_speed" => 0.25, "port" => 0.1}],
    tup!["ecoles", "civil", "Écoles centrales", "Savants et ingénieurs formés : toutes les recherches 25 % plus rapides.", 1000, 56, list!["codecivil"], dict!{"research_speed" => 0.25}],
    tup!["escompte", "civil", "Caisse d'escompte", "Crédit aux négociants : meilleurs prix au marché, commerce +10 %.", 750, 42, list!["diplomates"], dict!{"market" => 0.08, "trade" => 0.1}],
    tup!["chemins_fer", "civil", "Chemins de fer", "Bordeaux–La Teste en 1841, puis Paris : on peut construire des voies ferrées sur les tracés historiques (panneau des villes). Chaque ligne ouverte dope l’industrie et le commerce de ses villes, et ravitaille les armées proches de ses gares.", 1500, 70, list!["ponts"], dict!{}],
    tup!["telegraphe", "civil", "Télégraphe électrique", "Les nouvelles vont à la vitesse de l’éclair : vision des villes +15 km, des armées +4 km.", 1125, 56, list!["chappe"], dict!{"node_vision" => 15, "vision" => 4}],
    tup!["ferry", "civil", "Écoles de Jules Ferry", "École gratuite, laïque et obligatoire : recherches +20 %, ordre public +5 %, recrues +5 %.", 1375, 63, list!["ecoles"], dict!{"research_speed" => 0.2, "order" => 0.05, "recrues" => 0.05}],
    tup!["hygiene", "civil", "Hygiène pastorienne", "Vaccins, eau saine, asepsie : usure des armées −30 %, pertes −10 %.", 1250, 56, list!["larrey"], dict!{"attrition" => -0.3, "casualties" => -0.1}],
    tup!["vaccine", "civil", "Vaccine (Jenner)", "La vaccination contre la variole : usure des armées −15 %, les épidémies (choléra, fièvres) tuent moitié moins.", 750, 42, list![], dict!{"attrition" => -0.15, "epidemics" => -0.5}],
    tup!["caisse_epargne", "civil", "Caisse d'épargne", "L'épargne des humbles à l'abri : le trésor rapporte 2 % l'an.", 875, 49, list!["escompte"], dict!{"interest" => 0.02}],
    tup!["gaz", "civil", "Éclairage au gaz", "Réverbères et ateliers ouverts le soir : ordre public +6 %, les villes produisent 5 % de livres de plus.", 1000, 56, list!["vapeur"], dict!{"order" => 0.06, "city_livres" => 0.05}],
    tup!["photographie", "civil", "Photographie", "Daguerréotypes et reconnaissances : les armées ennemies repérées montrent l'expérience et l'armement de leurs régiments.", 1000, 56, list!["ecoles"], dict!{"intel" => 1}],
    tup!["suffrage", "civil", "Suffrage universel", "Chaque homme vote : la lassitude de la guerre monte 25 % moins vite, ordre public +5 %.", 1125, 56, list!["codecivil"], dict!{"weariness" => -0.25, "order" => 0.05}],
    tup!["mutuelles", "civil", "Sociétés de secours mutuels", "On cotise pour les malades et les veuves : les places mal assimilées se révoltent moitié moins, recrues +5 %.", 1000, 49, list!["suffrage"], dict!{"revolt" => -0.5, "recrues" => 0.05}],
    tup!["croix_rouge", "civil", "Croix-Rouge (convention de Genève)", "Les blessés sont soignés des deux côtés : un quart des pertes d'une bataille rejoint ses régiments ; pertes −5 %.", 1250, 56, list!["larrey"], dict!{"wounded" => 0.25, "casualties" => -0.05}],
    tup!["telephone", "civil", "Téléphone", "Le fil parle : vision des villes +10 km, les armées ennemies sont annoncées un tour avant d'entrer chez vous.", 1375, 63, list!["telegraphe"], dict!{"node_vision" => 10, "alert" => 1}],
    tup!["syndicats", "civil", "Syndicats (loi de 1884)", "Les ouvriers s'organisent : industrie +10 %, mais une ville à l'ordre bas peut faire grève (en janvier, ses ateliers presque arrêtés pendant un tour).", 1375, 63, list!["mutuelles"], dict!{"industrie" => 0.1, "strikes" => 1}],

    tup!["hauts_fourneaux", "industriel", "Hauts fourneaux", "Production de fer +30 %.", 500, 35, list![], dict!{"fer" => 0.3}],
    tup!["manufactures", "industriel", "Manufactures royales", "Capacité industrielle +25 %.", 625, 42, list![], dict!{"industrie" => 0.25}],
    tup!["fonderie", "industriel", "Fonderie de canons", "Artillerie −30 % de coût et de délai.", 750, 42, list!["hauts_fourneaux"], dict!{"art_cost" => -0.3, "art_train" => -0.3}],
    tup!["vapeur", "industriel", "Machine à vapeur", "Capacité industrielle +35 %.", 1250, 62, list!["manufactures"], dict!{"industrie" => 0.35}],
    tup!["outillage", "industriel", "Outillage standardisé", "Bonus des outils jusqu’à +45 %, usure −40 %, outils moins chers.", 875, 49, list!["manufactures"], dict!{"tools_max" => 0.15, "tools_wear" => -0.4, "tools_cost" => -0.3}],
    tup!["armureries", "industriel", "Armureries d'État", "Fabrication des armes +40 %.", 875, 49, list!["hauts_fourneaux"], dict!{"armes_eff" => 0.4}],
    tup!["poudreries", "industriel", "Poudreries nationales", "Salpêtre raffiné, poudre régulière : infanterie et artillerie +5 %.", 625, 35, list![], dict!{"inf_power" => 0.05, "art_power" => 0.05}],
    tup!["coke", "industriel", "Forges à l’anglaise (coke)", "Fonte au coke : fer +25 %, capacité industrielle +10 %.", 1000, 56, list!["hauts_fourneaux"], dict!{"fer" => 0.25, "industrie" => 0.1}],
    tup!["pieces", "industriel", "Pièces interchangeables (Honoré Blanc)", "Platines identiques : armes +30 %, la ligne coûte 10 % d’armes en moins.", 1125, 56, list!["armureries"], dict!{"armes_eff" => 0.3, "ligne_armes" => -0.1}],
    tup!["draperies", "industriel", "Draperies et manufactures de province", "Draps, cuirs, tabacs et forges des villes +40 % ; uniformes : moral +5.", 750, 42, list!["manufactures"], dict!{"manuf" => 0.4, "morale" => 5}],
    tup!["acier", "industriel", "Acier Bessemer et Martin", "Convertisseurs et fours Martin : fer +30 %, armes +20 %.", 1375, 63, list!["coke"], dict!{"fer" => 0.3, "armes_eff" => 0.2}],
    tup!["electricite", "industriel", "Électricité", "Dynamos et moteurs : capacité industrielle +30 %.", 1625, 70, list!["vapeur"], dict!{"industrie" => 0.3}],
    tup!["gabares", "industriel", "Chantiers de gabares", "Gabares et couraux plus grands : transport fluvial +15 %, ports +10 %.", 625, 35, list![], dict!{"river_speed" => 0.15, "port" => 0.1}],
    tup!["vapeur_fluviale", "industriel", "Bateau à vapeur", "Les vapeurs à roues de la Garonne (1818) : on remonte les fleuves aussi vite qu'on les descend, ports +10 %.", 1000, 56, list!["vapeur"], dict!{"upstream" => 1, "port" => 0.1}],
    tup!["ciment", "industriel", "Ciment (Vicat)", "Le ciment hydraulique de Louis Vicat : constructions −15 % de coût et de délai.", 875, 49, list!["manufactures"], dict!{"build_cost" => -0.15}],
    tup!["fresnel", "industriel", "Phares à lentille de Fresnel", "Cordouan reçoit la lentille d'Augustin Fresnel en 1823 : commerce +10 %, ports +15 %.", 750, 42, list!["gabares"], dict!{"trade" => 0.1, "port" => 0.15}],

    tup!["assolement", "agricole", "Assolement sans jachère", "Vivres +20 %.", 375, 28, list![], dict!{"vivres" => 0.2}],
    tup!["pomme_de_terre", "agricole", "Pomme de terre (Parmentier)", "L'hiver ne vide plus les greniers.", 500, 35, list![], dict!{"winter_food" => 0.3}],
    tup!["drainage", "agricole", "Drainage des marais", "Villages en lande/marais +30 %, fièvres −50 %.", 750, 42, list!["assolement"], dict!{"lande_prod" => 0.3, "marsh_attr" => -0.5}],
    tup!["pins", "agricole", "Semis de pins (Brémontier)", "Bois +40 %.", 625, 35, list![], dict!{"bois" => 0.4}],
    tup!["haras", "agricole", "Haras et élevage", "Cavalerie −25 % de coût et de délai, vivres +5 %.", 750, 42, list!["assolement"], dict!{"cav_cost" => -0.25, "cav_train" => -0.25, "vivres" => 0.05}],
    tup!["chais", "agricole", "Chais et négoce du vin", "Revenus du vin +40 %, ports +15 %.", 625, 35, list![], dict!{"vin" => 0.4, "port" => 0.15}],
    tup!["engrais", "agricole", "Prairies artificielles", "Vivres +25 %, recrues +10 %.", 1125, 56, list!["pomme_de_terre", "drainage"], dict!{"vivres" => 0.25, "recrues" => 0.1}],
    tup!["mais", "agricole", "Maïs de Chalosse et du Béarn", "Le « blé d’Espagne » : vivres +12 %, hivers moins durs.", 500, 35, list![], dict!{"vivres" => 0.12, "winter_food" => 0.1}],
    tup!["foires", "agricole", "Foires et marchés agricoles", "Pruneaux, foie gras, jambons, bœufs : produits du terroir des villes +35 %.", 625, 35, list![], dict!{"terroir" => 0.35}],
    tup!["gemmage", "agricole", "Gemmage et résiniers", "Les pins saignés donnent la résine : spécialités résinières +50 %, landes +10 %.", 625, 35, list!["pins"], dict!{"resine" => 0.5, "lande_prod" => 0.1}],
    tup!["transhumance", "agricole", "Transhumance et estives", "Troupeaux aux estives : places en montagne et en collines +30 %.", 625, 35, list![], dict!{"mountain_prod" => 0.3}],
    tup!["greniers", "agricole", "Greniers publics", "Réserves de la nation : greniers +50 %.", 750, 42, list!["assolement"], dict!{"granary" => 0.5}],
    tup!["engrais_chim", "agricole", "Engrais chimiques", "Guano, phosphates, superphosphates : vivres +20 %.", 1250, 56, list!["engrais"], dict!{"vivres" => 0.2}],
    tup!["landes1857", "agricole", "Assainissement des Landes (loi de 1857)", "Les communes plantent et drainent la lande : landes et marais +40 %, bois +20 %.", 1125, 56, list!["drainage", "pins"], dict!{"lande_prod" => 0.4, "bois" => 0.2}],
    tup!["greffe", "agricole", "Vignes greffées sur plants américains", "Après le phylloxéra, le vignoble renaît : revenus du vin +30 %.", 1125, 56, list!["chais"], dict!{"vin" => 0.3}],
    tup!["conserves", "agricole", "Conserves d’Appert", "Vivres en bocaux : les armées s’épuisent 40 % moins vite loin de chez elles.", 1000, 56, list!["pomme_de_terre"], dict!{"supply_drain" => -0.4}],
    tup!["betterave", "agricole", "Sucre de betterave", "Le sucre ne vient plus des îles : vivres +5 %, le Blocus continental ne coûte plus rien aux ports.", 625, 35, list!["assolement"], dict!{"vivres" => 0.05, "blockade" => -1.0}],
    tup!["dombasle", "agricole", "Charrue Dombasle", "Le soc de fer de Mathieu de Dombasle : vivres +10 %.", 750, 42, list!["assolement"], dict!{"vivres" => 0.1}],
    tup!["moissonneuses", "agricole", "Moissonneuses et batteuses à vapeur", "Les machines aux champs : vivres +15 %, recrues +10 % (les bras libérés).", 1250, 56, list!["dombasle", "vapeur"], dict!{"vivres" => 0.15, "recrues" => 0.1}],
    tup!["bouillie", "agricole", "Bouillie bordelaise (Millardet)", "Sulfate de cuivre et chaux, trouvés à Bordeaux : vin +15 %, le phylloxéra et le mildiou frappent moitié moins.", 1125, 56, list!["greffe"], dict!{"vin" => 0.15, "vine_blight" => -0.5}]
]);
// durée en jours de travail, arrondie au tour (30 jours de travail ; SPEC-TOURS.md, règle B) : 28 à 84 jours → 1 à 3 tours
// (TECH() se construit en plusieurs temps, comme à l'import du Python : TECH_base, TECH_branches, TECH_req_plus,
// puis les étages et les durées, plus bas)
fn TECH_base() -> Val {
    Val::dict_from(TECHS().iter().map(|t| (t.at(0), dict!{"id" => t.at(0), "branch" => t.at(1), "name" => t.at(2), "desc" => t.at(3), "cost" => t.at(4), "days" => 30 * py::int(t.at(5).f() / 30.0 + 0.5).max(1), "req" => t.at(6),
                   "fx" => t.at(7)})).collect())
}
// la branche militaire en deux (SPEC-ARBRE.md) : infanterie et cavalerie d'un côté, artillerie et génie de l'autre
py_const!(MILITAIRE_INF, pyset!["baionnette", "fusil1777", "percussion", "minie", "chassepot", "gras", "lebel", "hussards", "cuirassiers",
                 "voltigeurs", "tir_rang", "feu_peloton", "ordre_mixte", "retranchements", "levee", "divisions",
                 "etat_major", "service_mil", "rail_militaire"]);
fn TECH_branches(TECH: &Val) {
    for _t in TECH.values() {
        if _t.at_is("branch", "militaire") {
            _t.set("branch", if MILITAIRE_INF().has(_t.at("id")) { "infanterie" } else { "artillerie" });
        }
    }
}
py_const!(BRANCHES, list!["infanterie", "artillerie", "civil", "industriel", "agricole"]);
// recherche libre (SPEC-ARBRE.md) : plus de date, mais l'arme suit l'industrie et la science ; aucun de ces prérequis
// n'est plus récent que la technologie qui le demande (les départs 1790, 1813 et 1870 restent cohérents)
py_const!(REQ_PLUS, dict!{
    "percussion" => list!["poudreries"], "chassepot" => list!["outillage"], "gras" => list!["acier"], "lebel" => list!["dynamite"], "gribeauval" => list!["fonderie"],
    "lahitte" => list!["coke"], "mitrailleuse" => list!["pieces"], "debange" => list!["acier"], "dynamite" => list!["acier"], "chemins_fer" => list!["vapeur"],
    "vapeur" => list!["coke"], "acier" => list!["vapeur"], "outillage" => list!["pieces"], "electricite" => list!["telegraphe"], "service_mil" => list!["chemins_fer"],
    "retranchements" => list!["minie"], "prefectures" => list!["ponts_chaussees"], "gendarmerie" => list!["ponts_chaussees"], "pins" => list!["ponts_chaussees"],
    "canal" => list!["ponts"], "larrey" => list!["ecoles"], "vaccine" => list!["ecoles"], "hygiene" => list!["vaccine"], "pomme_de_terre" => list!["assolement"],
    "engrais_chim" => list!["vapeur"], "greffe" => list!["engrais_chim"]});
fn TECH_req_plus(TECH: &Val) {
    for (_k, _v) in REQ_PLUS().items() {
        TECH.at(&_k).set("req", TECH.at(&_k).at("req") + _v);
    }
}


/// Plus longue chaîne de prérequis, toutes branches comprises (0 : sans prérequis).
/// (TECH est passée : la fonction sert pendant que la table se construit ; `seen` est un tuple, `tup![]` au départ.)
pub fn _etage(TECH: &Val, t: &str, seen: &Val) -> i64 {
    assert!(!seen.has(t), "cycle de prérequis : {}", seen + &tup![t]);
    let req = TECH.at(t).at("req");
    if req.truthy() {
        1 + req.iter().map(|q| _etage(TECH, q.s(), &(seen + &tup![t]))).max().unwrap()
    } else {
        0
    }
}


// durée selon l'étage : une branche cherchée sans arrêt, sans bonus, dure BRANCH_YEARS ans (de 1700 à 1890 environ),
// chaque technologie au prorata de (1 + étage) ; arrondie au tour (30 jours de travail, 12 tours par an)
pub const BRANCH_YEARS: i64 = 190;
py_const!(TECH, {
    let TECH = TECH_base();
    TECH_branches(&TECH);
    TECH_req_plus(&TECH);
    for _t in TECH.values() {
        _t.set("etage", _etage(&TECH, _t.at("id").s(), &tup![]));
    }
    for _b in BRANCHES().iter() {
        let _ts: Vec<Val> = TECH.values().into_iter().filter(|t| t.at("branch") == _b).collect();
        let _sum: i64 = _ts.iter().map(|t| 1 + t.at("etage").i()).sum();
        for _t in &_ts {
            _t.set("days", 30 * py::round((BRANCH_YEARS * 12 * (1 + _t.at("etage").i())) as f64 / _sum as f64).max(1));
        }
    }
    TECH
});
// goût de recherche des IA (personality['tech']) → branches préférées
py_const!(TASTE_BRANCHES, dict!{"militaire" => tup!["infanterie", "artillerie"]});

// marques visibles (SPEC-TECH.md, module visuels) : la technologie du camp qui les fait apparaître ; la bataille et la
// carte lisent cette table au lieu de comparer des années partout
py_const!(VISUALS, dict!{
    "sans_fumee" => dict!{"tech" => "lebel"},   // poudre B : l'artillerie et les mitrailleuses du camp tirent sans fumée
    "reffye" => dict!{"tech" => "mitrailleuse"},
    // la carte selon l'époque (SPEC-SUITE, partie H) : ce que la carte de campagne dessine chez le camp qui les a
    "chappe" => dict!{"tech" => "chappe"},   // tours Chappe aux bras mobiles près des villes
    "telegraphe" => dict!{"tech" => "telegraphe"},   // poteaux et fil le long des routes royales et des voies ferrées
    "usines" => dict!{"tech" => "vapeur"},   // cheminées d'usine qui fument dans les villes
    "vapeurs" => dict!{"tech" => "vapeur_fluviale"},   // vapeurs à roues parmi les gabares
    "forges" => dict!{"tech" => "hauts_fourneaux"},   // lueur rouge des forges
    "gaz" => dict!{"tech" => "gaz"},   // réverbères des villes
    "fresnel" => dict!{"tech" => "fresnel"},   // faisceau de Cordouan plus long
    "pins" => dict!{"tech" => "pins"},   // les pins gagnent la lande
    "landes1857" => dict!{"tech" => "landes1857"},   // la forêt de pins des Landes
    "gemmage" => dict!{"tech" => "gemmage"},   // pots de résine
    "drainage" => dict!{"tech" => "drainage"},   // les marais rétrécissent
    "greffe" => dict!{"tech" => "greffe"},   // vignes replantées en rangs après le phylloxéra
    "mais" => dict!{"tech" => "mais"},   // maïs en Chalosse et en Béarn
    "assolement" => dict!{"tech" => "assolement"},   // champs plus variés
    "moissonneuses" => dict!{"tech" => "moissonneuses"},
    // le décor des batailles selon l'époque (SPEC-SUITE, partie J)
    "rail" => dict!{"tech" => "chemins_fer"},   // une voie ferrée près du champ de bataille
    "ambulances" => dict!{"tech" => "croix_rouge"}   // ambulances à croix rouge (avant : celles de Larrey, sans croix)
});


// découvertes des IA annoncées au joueur (un bandeau) : ce qui se voit sur la carte ou en bataille
py_const!(NOTABLE_TECHS, {
    let s = Val::set_from(VISUALS().values().iter().map(|v| v.at("tech")).collect());
    s.update(&pyset!["chemins_fer", "rail_militaire"]);
    s
});


/// Marques visibles d'un camp qui a ces technologies.
pub fn marks(techs: &Val) -> Val {
    VISUALS().items().into_iter().filter(|(_, v)| techs.has(v.at("tech"))).map(|(k, _)| k).collect()
}

// ------------------------------------------------------------------ saisons & météo
py_const!(SEASONS, list!["hiver", "hiver", "printemps", "printemps", "printemps", "été", "été", "été", "automne", "automne", "automne", "hiver"]);
py_const!(SEASON_LABEL, dict!{"printemps" => "Printemps", "été" => "Été", "automne" => "Automne", "hiver" => "Hiver"});
py_const!(SEASON_FOOD, dict!{"printemps" => 0.9, "été" => 1.25, "automne" => 1.35, "hiver" => 0.45});
py_const!(SEASON_ROAD, dict!{"printemps" => 0.95, "été" => 1.0, "automne" => 0.95, "hiver" => 0.82});
py_const!(SEASON_OFF, dict!{"printemps" => 0.92, "été" => 1.0, "automne" => 0.9, "hiver" => 0.72});

// la boue : après la pluie, l'orage ou la tempête, routes de terre et chemins restent boueux MUD_DAYS jours (un seul
// l'été, où tout sèche vite) et l'on y marche à MUD_MOVE de sa vitesse ; les routes royales, empierrées, n'en souffrent
// pas. Sous la pluie même, c'est déjà compté (WEATHER, move).
py_const!(MUD_WET, tup!["pluie", "orage", "tempete"]);
pub const MUD_DAYS: i64 = 3; pub const MUD_MOVE: f64 = 0.9;

py_const!(WEATHER, dict!{
    "soleil" => dict!{"label" => "Ensoleillé", "icon" => "☀️", "fire" => 1.0, "move" => 1.0, "food" => 1.0, "vision" => 1.0},
    "nuages" => dict!{"label" => "Nuageux", "icon" => "⛅", "fire" => 1.0, "move" => 1.0, "food" => 1.0, "vision" => 1.0},
    "pluie" => dict!{"label" => "Pluie", "icon" => "🌧️", "fire" => 0.75, "move" => 0.85, "food" => 1.0, "vision" => 0.85},
    "orage" => dict!{"label" => "Orage", "icon" => "⛈️", "fire" => 0.6, "move" => 0.75, "food" => 0.9, "vision" => 0.7},
    "brouillard" => dict!{"label" => "Brouillard", "icon" => "🌫️", "fire" => 0.85, "move" => 0.95, "food" => 1.0, "vision" => 0.45},
    "neige" => dict!{"label" => "Neige", "icon" => "❄️", "fire" => 0.8, "move" => 0.55, "food" => 0.8, "vision" => 0.8},
    "canicule" => dict!{"label" => "Canicule", "icon" => "🔥", "fire" => 1.0, "move" => 0.85, "food" => 0.8, "vision" => 1.0},
    "tempete" => dict!{"label" => "Tempête", "icon" => "🌬️", "fire" => 0.7, "move" => 0.8, "food" => 0.95, "vision" => 0.75}
});
py_const!(WEATHER_W, dict!{
    "printemps" => dict!{"soleil" => 35, "nuages" => 25, "pluie" => 25, "orage" => 5, "brouillard" => 10},
    "été" => dict!{"soleil" => 50, "nuages" => 15, "pluie" => 8, "orage" => 12, "canicule" => 15},
    "automne" => dict!{"soleil" => 25, "nuages" => 25, "pluie" => 30, "brouillard" => 15, "tempete" => 5},
    "hiver" => dict!{"soleil" => 15, "nuages" => 30, "pluie" => 25, "brouillard" => 15, "neige" => 15}
});
py_const!(ZONES, dict!{"cote" => "Côte atlantique", "interieur" => "Intérieur", "montagne" => "Pyrénées"});

py_const!(MONTHS, list!["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]);

py_const!(DIFFICULTY, dict!{
    "facile" => dict!{"label" => "Facile", "ai_income" => 0.8, "ai_aggr" => 0.75},
    "normal" => dict!{"label" => "Normal", "ai_income" => 1.0, "ai_aggr" => 1.0},
    "difficile" => dict!{"label" => "Difficile", "ai_income" => 1.25, "ai_aggr" => 1.25}
});
py_const!(SPEEDS, list![0, 0.5, 1.0, 2.0, 4.0, 10.0, 30.0]);   // jours de jeu par seconde réelle (×10 et ×30 : années de paix)
pub const FAST_SPEED: i64 = 5;   // à partir de cette vitesse, guerres, batailles et propositions mettent le jeu en pause

// ------------------------------------------------------------------ grande campagne 1700-1899
py_const!(CAMPAIGN_END, tup![1900, 1, 1]);
py_const!(DEPT_DATE, tup![1790, 3, 4]);   // l'Assemblée crée les départements : les provinces deviennent départements
fn PROVINCES_base() -> Val { dict!{
    "33" => dict!{"name" => "Guyenne", "title" => "Guyenne (Bordelais)"},
    "24" => dict!{"name" => "Périgord", "title" => "Périgord"},
    "40" => dict!{"name" => "Landes de Gascogne", "title" => "Landes de Gascogne"},
    "47" => dict!{"name" => "Agenais", "title" => "Agenais"},
    "64" => dict!{"name" => "Béarn et Pays basque", "title" => "Béarn, Labourd et Soule"}
} }
py_const!(PROVINCES, {
    let PROVINCES = PROVINCES_base();
    for (_c, _f) in FACTIONS().items() {   // (les pays des théâtres : la province porte le nom du pays)
        PROVINCES.setdefault(&_c, dict!{"name" => _f.at("name"), "title" => _f.at("name")});
    }
    PROVINCES
});
py_const!(ERAS, list![
    dict!{"id" => "louis14", "year" => 1700, "name" => "Le Grand Siècle finissant",
         "desc" => "Louis XIV règne encore. Mousquets à mèche et à silex, derniers piquiers, places de Vauban."},
    dict!{"id" => "lumieres", "year" => 1715, "name" => "Le siècle des Lumières",
         "desc" => "Régence puis Louis XV et Louis XVI. Âge d’or du négoce bordelais, l’intendant Tourny embellit Bordeaux."},
    dict!{"id" => "revolution", "year" => 1789, "name" => "La Révolution",
         "desc" => "États généraux, départements, Garde nationale, levée en masse : la nation en armes."},
    dict!{"id" => "empire", "year" => 1804, "name" => "Le Consulat et l’Empire",
         "desc" => "Napoléon. Guerre d’Espagne : les Pyrénées redeviennent une frontière en armes."},
    dict!{"id" => "restauration", "year" => 1815, "name" => "La Restauration",
         "desc" => "Retour des Bourbons, puis monarchie de Juillet. Premières gabares à vapeur sur la Garonne."},
    dict!{"id" => "second_empire", "year" => 1848, "name" => "La IIe République et le Second Empire",
         "desc" => "Chemins de fer, télégraphe électrique, pins des Landes, Arcachon et Biarritz."},
    dict!{"id" => "troisieme", "year" => 1870, "name" => "La IIIe République",
         "desc" => "Guerre de 1870, armée moderne, phylloxéra dans les vignes."}
]);
py_const!(SCENARIOS, dict!{
    "1700" => dict!{"date" => tup![1700, 3, 1], "title" => "France, 1700", "campaign" => "Grande campagne 1700 – 1899",
                 "intro" => concat!("Louis XIV règne. Les provinces du royaume se disputent la France : traversez deux siècles, ",
                       "de la Guerre de Succession d’Espagne à la IIIe République. Le plus prestigieux en 1900 l’emporte."),
                 "techs_before" => Val::None},
    "1790" => dict!{"date" => tup![1790, 3, 4], "title" => "France, 1790", "campaign" => "Depuis la Révolution",
                 "intro" => concat!("L’Assemblée vient de créer les départements. Choisissez le vôtre, ralliez ses villages, ",
                       "puis prenez les chefs-lieux voisins par les armes, le commerce ou la diplomatie."),
                 "techs_before" => 1778},
    "1813" => dict!{"date" => tup![1813, 6, 1], "title" => "France, 1813", "campaign" => "La fin de l’Empire",
                 "intro" => "L’Empire vacille, la guerre d’Espagne tourne mal : la frontière des Pyrénées s’embrase.",
                 "techs_before" => 1806},
    "1870" => dict!{"date" => tup![1870, 7, 19], "title" => "France, 1870", "campaign" => "La guerre de 1870",
                 "intro" => concat!("La France déclare la guerre à la Prusse. Chemins de fer et fusils Chassepot : ",
                       "un autre siècle commence."), "techs_before" => 1866}
});
// (les théâtres) les époques et les débuts de partie vus d'Europe (les autres théâtres aussi, INTRO_THEATRE à part) : mêmes clés, mêmes dates et mêmes techniques que
// ERAS et SCENARIOS (le moteur lit celles-là) ; seuls les textes changent
py_const!(ERAS_EUROPE, list![
    dict!{"id" => "louis14", "year" => 1700, "name" => "Le Grand Siècle finissant",
         "desc" => "Louis XIV, Pierre le Grand, Charles XII : mousquets à mèche et à silex, derniers piquiers, places de Vauban et de Coehoorn."},
    dict!{"id" => "lumieres", "year" => 1715, "name" => "Le siècle des Lumières",
         "desc" => "Guerres de succession et guerre de Sept Ans : l’équilibre des puissances, le négoce des ports, les despotes éclairés."},
    dict!{"id" => "revolution", "year" => 1789, "name" => "La Révolution",
         "desc" => "La France en révolution contre les rois coalisés : levée en masse, la nation en armes."},
    dict!{"id" => "empire", "year" => 1804, "name" => "L’Europe de Napoléon",
         "desc" => "D’Austerlitz à Moscou : les aigles traversent le continent, l’Espagne et la Russie se soulèvent."},
    dict!{"id" => "restauration", "year" => 1815, "name" => "Le Concert européen",
         "desc" => "Le congrès de Vienne redessine les frontières ; premiers bateaux à vapeur, premiers chemins de fer."},
    dict!{"id" => "second_empire", "year" => 1848, "name" => "Le printemps des peuples",
         "desc" => "Révolutions de 1848, guerre de Crimée, unités italienne et allemande : chemins de fer et télégraphe électrique."},
    dict!{"id" => "troisieme", "year" => 1870, "name" => "L’âge des empires",
         "desc" => "Guerre de 1870, armées de conscrits, acier et canons se chargeant par la culasse."}
]);
py_const!(SCENARIOS_EUROPE, dict!{
    "1700" => dict!{"title" => "Europe, 1700", "campaign" => "Grande campagne 1700 – 1899",
                 "intro" => concat!("Le roi d’Espagne va mourir sans héritier et Charles XII de Suède entre en guerre : menez votre pays à travers deux siècles, ",
                       "de la Succession d’Espagne à l’âge des empires. Le plus prestigieux en 1900 l’emporte.")},
    "1790" => dict!{"title" => "Europe, 1790", "campaign" => "Depuis la Révolution",
                 "intro" => concat!("La Révolution ébranle la France et les rois s’inquiètent. Choisissez votre pays, ralliez ses campagnes, ",
                       "puis prenez les capitales voisines par les armes, le commerce ou la diplomatie.")},
    "1813" => dict!{"title" => "Europe, 1813", "campaign" => "La fin de l’Empire",
                 "intro" => "La Grande Armée revient de Russie ; l’Europe entière se lève pour la bataille des Nations."},
    "1870" => dict!{"title" => "Europe, 1870", "campaign" => "La guerre de 1870",
                 "intro" => concat!("La France déclare la guerre à la Prusse. Chemins de fer et fusils se chargeant par la culasse : ",
                       "un autre siècle commence.")}
});
// (un théâtre autre que l'Europe : le titre « <nom>, <année> » et ce texte, au lieu de ceux de SCENARIOS_EUROPE)
pub const INTRO_THEATRE: &str = "Choisissez votre pays, ralliez ses campagnes, puis prenez les capitales voisines par les armes, le commerce ou la diplomatie. Le plus prestigieux en 1900 l’emporte.";
// (les modes de jeu, pour l'écran de départ : la carte, son nom, le mot d'un camp ; l'Aquitaine, puis les théâtres, avec
// « l’Europe » pour les textes de la page)
py_const!(MODES, {
    let m = list![dict!{"geo" => 2, "nom" => "Aquitaine", "mot" => "département"}];
    for t in crate::geo::THEATRES {
        m.push(dict!{"geo" => t.geo, "nom" => t.nom, "mot" => t.mot, "le" => t.le});
    }
    // (SPEC-EMPIRE, module 3) la carte monde, après les théâtres
    let t = &crate::geo::MONDE;
    m.push(dict!{"geo" => t.geo, "nom" => t.nom, "mot" => t.mot, "le" => t.le});
    m
});

/// Les camps d'une carte, dans l'ordre de FACTIONS : les pays de son théâtre, ou les départements (l'Aquitaine, les
/// anciennes cartes).
pub fn camps(geo: i64) -> Vec<Val> {
    let p = pays(geo);
    if crate::geo::theatre(geo).is_some() {
        FACTIONS().keys().into_iter().filter(|c| p.has(c)).collect()
    } else {
        FACTIONS().keys().into_iter().filter(|c| !est_pays(c) && !est_rebelle(c.s())).collect() // (SPEC-POLITIQUE, module 5) sans les camps rebelles inscrits
    }
}

/// Les moyens de départ d'un pays (un théâtre) : (armée en milliers d'hommes au début choisi, trésor, poids), d'après son
/// champ "moyens" de pays_<id>.json : [[armée sur pied en temps de paix, en milliers d'hommes, au début de 1700, 1790,
/// 1813 et 1870], trésor (multiple des 500 livres d'un département)] ; estimations, ordres de grandeur (les pays de 1700
/// restent tous en jeu aux débuts plus tardifs : on leur donne l'armée de leur dernier état connu). Dans le jeu, un
/// régiment (~300 hommes) pour 10 000 hommes réels : voir engine::regiments_pays. Le poids, de 0,1 à 1, mesure le pays de
/// 1700 (60 000 hommes et plus : 1) ; il règle le plancher de production (FLOOR). None pour un département.
pub fn moyens_pays(code: &str, scenario: &str) -> Option<(f64, f64, f64)> {
    let f = FACTIONS().get(code);
    let m = if f.is_dict() { f.get("moyens") } else { Val::None };
    if !m.is_list() {
        return None;
    }
    let k = ["1700", "1790", "1813", "1870"].iter().position(|s| *s == scenario).unwrap_or(1);
    let armee = m.at(0);
    Some((armee.atf(k), m.atf(1), (armee.atf(0) / 60.0).clamp(0.1, 1.0)))
}

// traités : un camp dont le chef-lieu tombe signe la paix au lieu de disparaître, sauf s'il est déjà écrasé
pub const TREATY_TRUCE: i64 = 60;   // trêve imposée par un traité (tours : cinq ans)
pub const TREATY_CRUSHED: f64 = 0.25;   // absorbé si ce camp ne tient plus que ce quart de ses places de départ (ou 3 places)
pub const WEARY_PER_UNRULY: f64 = 0.08;   // lassitude mensuelle par place conquise encore mal assimilée
pub const REVIVE_YEARS: i64 = 10;   // un pays absorbé peut se soulever après dix ans
pub const WAR_PACE: f64 = 0.12;   // appétit de guerre des IA (1 = celui de l'ancienne partie courte de 1790)
pub const WAR_REST: f64 = 3.0;   // années de paix avant que cet appétit soit entier
pub const TREATY_CONGRESS: i64 = 24;   // le congrès impose aussi la paix aux autres ennemis du vaincu (tours : deux ans)
pub const TREATY_AGAIN: i64 = 25 * 365;   // second traité avec le même vainqueur en moins de 25 ans : absorbé
// attachement régional : une place conquise reste fidèle à sa province d'origine pendant une génération
pub const ASSIM_YEARS: i64 = 25;
// lassitude de la guerre (0 à 100)
pub const WEARY_PER_WAR: f64 = 3.0;   // par mois et par guerre
pub const WEARY_PER_LOSS: f64 = 1.0 / 150.0;   // par homme perdu
pub const WEARY_PEACE: f64 = 5.0;   // baisse mensuelle en paix
pub const STRIKE_STAB: f64 = 0.5;   // syndicats : sous cet ordre public, une ville fait grève en janvier (un tour sans industrie)

// croissance séculaire de l'économie, par rapport à 1790 : la production d'une place n'en suit que la racine
py_const!(POP_ERA, list![tup![1700, 0.72], tup![1790, 1.0], tup![1850, 1.3], tup![1900, 1.6]]);

// ------------------------------------------------------------------ population sur deux siècles
// Chaque place suit sa propre trajectoire « normale » : un multiplicateur de sa population de 1790
// (places.CITY_POP), interpolé entre des années repères. Chaque repère porte la raison de l'évolution jusqu'au
// repère suivant (affichée dans le panneau de la ville). Les villes s'envolent avec le chemin de fer et l'industrie ;
// les campagnes se remplissent jusque vers 1850 puis se vident (exode rural, émigration basque et béarnaise),
// sauf la lande plantée de pins après la loi de 1857.
py_const!(POP_WHY, dict!{
    "paix" => "la paix et le commerce font grandir la ville",
    "guerres" => "Révolution et guerres freinent la ville",
    "ville" => "routes neuves et chemin de fer animent le marché",
    "bourg" => "petite ville de marché, qui grandit lentement",
    "declin" => "le marché languit, les jeunes partent pour la grande ville",
    "iles" => "le commerce des Îles et du vin enrichit le port",
    "revolution" => "Terreur et guerre sur mer ruinent le négoce",
    "blocus" => "le blocus anglais étouffe le port",
    "reprise" => "le négoce se relève lentement",
    "metropole" => "chemins de fer, usines et faubourgs : tout le Sud-Ouest y afflue",
    "prefecture" => "préfecture, routes neuves puis chemin de fer",
    "ateliers" => "préfecture, puis ateliers du chemin de fer d’Orléans",
    "hivernants" => "les hivernants anglais en font une ville d’hiver",
    "port" => "le port et le chemin de fer d’Espagne",
    "bains" => "les bains de mer attirent baigneurs et villas",
    "imperiale" => "station impériale, puis rendez-vous de l’Europe",
    "teste" => "résiniers et pêcheurs du Bassin",
    "arcachon" => "Arcachon sort des dunes : ville d’hiver et bains de mer",
    "ostreicole" => "huîtres et bains de mer font vivre le Bassin",
    "terreneuve" => "la perte de Terre-Neuve ruine armateurs et pêcheurs",
    "thermes" => "les eaux chaudes et le chemin de fer amènent les curistes",
    "gare" => "carrefour du chemin de fer",
    "frontiere" => "la gare frontière avec l’Espagne",
    "forges" => "les forges et les hauts fourneaux embauchent",
    "espadrilles" => "les fabriques d’espadrilles embauchent",
    "banlieue" => "Bordeaux déborde : maraîchers et ouvriers s’y installent",
    "defrichement" => "défrichements et maïs nourrissent plus de bouches",
    "plein" => "les campagnes n’ont jamais été si peuplées",
    "exode" => "l’exode rural vide les campagnes vers les villes",
    "phylloxera" => "le phylloxéra ruine les vignerons",
    "ameriques" => "on émigre vers les Amériques",
    "lande" => "bergers et échassiers vivent chichement de la lande",
    "pins" => "les pins et la résine font vivre la lande",
    "remparts" => "les remparts ne font plus vivre la place",
    // (carte de France : les villes qui naissent ou explosent au XIXe siècle)
    "capitale_fr" => "gares, usines et grands travaux : la France entière monte à Paris",
    "grande_ville" => "chemins de fer, usines et faubourgs : toute la région y afflue",
    "industrie" => "filatures et usines vident les campagnes alentour",
    "mines" => "houillères et hauts fourneaux font sortir une ville de terre",
    "grand_port" => "paquebots, docks et chemin de fer font la fortune du port",
    "port_neuf" => "un port neuf et ses chantiers navals sortent des marais",
    "arsenal" => "l’arsenal et la flotte de guerre font grandir le port",
    "ville_neuve" => "ville neuve tracée sur ordre de l’Empereur, préfecture",
    "pelerinage" => "les apparitions de 1858 amènent les pèlerins par trains entiers",
    "banlieue_paris" => "Paris déborde : usines, gares et lotissements gagnent la banlieue"
});


/// Ville ordinaire : croissance lente au XVIIIe siècle, pause sous la Révolution, puis le chemin de fer.
pub fn _town(e1850: f64, e1900: f64, late: &str) -> Val {
    list![tup![1700, 0.82, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "paix"], tup![1831, 1.07, late],
            tup![1851, e1850, late], tup![1900, e1900, late]]
}


/// Campagne : défrichements, apogée vers 1850, puis exode.
pub fn _rural(peak_year: i64, peak: f64, e1900: f64, late: &str, early: &str) -> Val {
    list![tup![1700, 0.81, "defrichement"], tup![1790, 1.0, early], tup![peak_year, peak, late], tup![1900, e1900, late]]
}


// (la table telle qu'elle est écrite ici ; POP_CURVES() la rend complétée plus bas : ville_fr, rural_fr)
fn POP_CURVES_base() -> Val { dict!{
    // Bordeaux : ~45 000 âmes en 1700, ~110 000 en 1790, ~91 000 en 1801, ~130 000 en 1851, ~256 000 en 1901
    "bordeaux" => list![tup![1700, 0.41, "iles"], tup![1750, 0.58, "iles"], tup![1790, 1.0, "revolution"], tup![1801, 0.83, "blocus"],
              tup![1815, 0.84, "reprise"], tup![1831, 0.92, "metropole"], tup![1851, 1.18, "metropole"], tup![1872, 1.76, "metropole"],
              tup![1900, 2.3, "metropole"]],
    "libourne" => list![tup![1700, 0.75, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.95, "ville"], tup![1851, 1.65, "ville"], tup![1900, 2.3, "ville"]],
    // La Teste porte aussi Arcachon, détachée en 1857 : quelques cabanes de pêcheurs, puis la ville d'hiver des Pereire
    "teste" => list![tup![1700, 0.85, "teste"], tup![1790, 1.0, "teste"], tup![1841, 1.25, "bains"], tup![1857, 1.6, "arcachon"],
           tup![1880, 3.4, "arcachon"], tup![1900, 5.0, "arcachon"]],
    "bassin" => list![tup![1700, 0.85, "teste"], tup![1790, 1.0, "teste"], tup![1857, 1.2, "ostreicole"], tup![1900, 2.0, "ostreicole"]],
    "soulac" => list![tup![1700, 0.9, "lande"], tup![1790, 1.0, "lande"], tup![1874, 1.05, "bains"], tup![1900, 1.9, "bains"]],
    "banlieue" => list![tup![1700, 0.8, "defrichement"], tup![1790, 1.0, "plein"], tup![1831, 1.15, "banlieue"], tup![1851, 1.45, "banlieue"],
              tup![1900, 3.0, "banlieue"]],
    "perigueux" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.95, "ateliers"], tup![1831, 1.43, "ateliers"],
               tup![1851, 2.2, "ateliers"], tup![1872, 3.6, "ateliers"], tup![1900, 5.2, "ateliers"]],
    "bergerac" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "ville"], tup![1851, 1.45, "ville"], tup![1900, 1.95, "ville"]],
    "montdemarsan" => list![tup![1700, 0.75, "paix"], tup![1790, 1.0, "prefecture"], tup![1851, 1.45, "prefecture"], tup![1900, 3.0, "prefecture"]],
    "dax" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "thermes"], tup![1851, 1.3, "thermes"], tup![1900, 2.35, "thermes"]],
    "salies" => list![tup![1700, 0.9, "paix"], tup![1790, 1.0, "bourg"], tup![1857, 1.05, "thermes"], tup![1900, 1.25, "thermes"]],
    "gare" => list![tup![1700, 0.85, "lande"], tup![1790, 1.0, "lande"], tup![1854, 1.2, "gare"], tup![1900, 3.0, "gare"]],
    "agen" => list![tup![1700, 0.8, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "prefecture"], tup![1851, 1.4, "prefecture"],
          tup![1900, 2.1, "prefecture"]],
    "villeneuve" => list![tup![1700, 0.82, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "ville"], tup![1851, 1.35, "ville"], tup![1900, 1.55, "ville"]],
    "marmande" => list![tup![1700, 0.82, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "ville"], tup![1851, 1.35, "ville"], tup![1900, 1.6, "ville"]],
    "forges" => list![tup![1700, 0.8, "forges"], tup![1790, 1.0, "forges"], tup![1851, 1.3, "forges"], tup![1900, 1.6, "forges"]],
    // Pau : ~9 000 en 1790, ~16 000 en 1851, ~34 000 en 1901 (les Anglais y passent l'hiver dès les années 1840)
    "pau" => list![tup![1700, 0.8, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.95, "prefecture"], tup![1836, 1.4, "hivernants"],
         tup![1851, 1.8, "hivernants"], tup![1872, 2.85, "hivernants"], tup![1900, 3.8, "hivernants"]],
    "bayonne" => list![tup![1700, 0.95, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "port"], tup![1851, 1.45, "port"], tup![1900, 2.05, "port"]],
    // Biarritz : village de pêcheurs (~2 000 âmes), plage de l'impératrice en 1854, ~12 000 habitants en 1901
    "biarritz" => list![tup![1700, 0.8, "terreneuve"], tup![1790, 1.0, "bains"], tup![1854, 1.4, "imperiale"], tup![1872, 2.6, "imperiale"],
              tup![1900, 6.0, "imperiale"]],
    // Saint-Jean-de-Luz : grand port baleinier vers 1700, ruiné par le traité d'Utrecht et les tempêtes
    "stjeandeluz" => list![tup![1700, 2.2, "terreneuve"], tup![1750, 1.4, "terreneuve"], tup![1790, 1.0, "terreneuve"], tup![1851, 0.9, "bains"],
                 tup![1900, 1.25, "bains"]],
    "hendaye" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1864, 1.4, "frontiere"], tup![1900, 3.5, "frontiere"]],
    "mauleon" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1851, 1.4, "espadrilles"], tup![1900, 2.8, "espadrilles"]],
    "oloron" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.97, "ville"], tup![1851, 1.3, "ville"], tup![1900, 1.4, "ville"]],
    // villes ordinaires, selon le pays (les petites villes du Périgord et de l'Agenais végètent après 1860)
    "ville_33" => _town(1.2, 1.45, "ville"), "ville_24" => _town(1.15, 1.22, "bourg"), "ville_40" => _town(1.25, 1.4, "ville"),
    "ville_47" => _town(1.15, 1.1, "declin"), "ville_64" => _town(1.15, 1.3, "ville"),
    // campagnes : la Dordogne, l'Agenais et le Béarn se vident après 1850, le vignoble girondin souffre du phylloxéra
    "rural_33" => _rural(1875, 1.17, 1.05, "phylloxera", "plein"), "rural_24" => _rural(1851, 1.2, 1.0, "exode", "plein"),
    "rural_40" => _rural(1857, 1.25, 1.18, "exode", "plein"), "rural_47" => _rural(1846, 1.12, 0.85, "exode", "plein"),
    "rural_64" => _rural(1846, 1.18, 0.98, "ameriques", "plein"),
    "pins" => list![tup![1700, 0.85, "lande"], tup![1790, 1.0, "lande"], tup![1857, 1.15, "pins"], tup![1900, 1.6, "pins"]],
    "fort" => list![tup![1700, 1.05, "remparts"], tup![1790, 1.0, "remparts"], tup![1900, 0.92, "remparts"]],
    // --- carte de France : rapport à 1790 d'après les recensements (1801, 1831, 1851, 1872, 1901), à quelques % près ---
    // Paris : ~510 000 en 1700, 600 000 en 1790, 1 050 000 en 1851, 1 700 000 après l'annexion de 1860, 2 700 000 en 1901
    "paris" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.91, "paix"], tup![1831, 1.3, "capitale_fr"],
             tup![1851, 1.75, "capitale_fr"], tup![1861, 2.8, "capitale_fr"], tup![1872, 3.0, "capitale_fr"], tup![1900, 4.5, "capitale_fr"]],
    "lyon" => list![tup![1700, 0.67, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.75, "paix"], tup![1831, 1.03, "industrie"],
            tup![1852, 1.75, "grande_ville"], tup![1872, 2.2, "grande_ville"], tup![1900, 3.2, "grande_ville"]],
    "marseille" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 1.05, "paix"], tup![1831, 1.4, "grand_port"],
                 tup![1851, 1.85, "grand_port"], tup![1872, 2.95, "grand_port"], tup![1900, 4.6, "grand_port"]],
    "grande_ville" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.95, "paix"], tup![1831, 1.2, "grande_ville"],
                    tup![1851, 1.5, "grande_ville"], tup![1872, 2.0, "grande_ville"], tup![1900, 2.8, "grande_ville"]],
    "lille" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.9, "paix"], tup![1851, 1.22, "industrie"],
             tup![1860, 2.0, "industrie"], tup![1872, 2.5, "industrie"], tup![1900, 3.4, "industrie"]],
    "industrie" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 1.0, "paix"], tup![1831, 1.6, "industrie"],
                 tup![1851, 2.4, "industrie"], tup![1872, 3.6, "industrie"], tup![1900, 5.0, "industrie"]],
    // Mulhouse : ~6 000 âmes à sa réunion (1798), 30 000 en 1851, 90 000 en 1901 (indiennes et filatures)
    "mulhouse" => list![tup![1700, 0.6, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 1.0, "industrie"], tup![1831, 2.2, "industrie"],
                tup![1851, 4.8, "industrie"], tup![1872, 9.0, "industrie"], tup![1900, 15.0, "industrie"]],
    // Saint-Étienne : 18 000 en 1790, 56 000 en 1851, 147 000 en 1901 (houille, armes, rubans)
    "saint_etienne" => list![tup![1700, 0.7, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.9, "mines"], tup![1831, 1.85, "mines"],
                     tup![1851, 3.1, "mines"], tup![1872, 6.0, "mines"], tup![1900, 8.2, "mines"]],
    // bourgs devenus villes de la mine ou des forges (Le Creusot des Schneider, Decazeville, Montceau, le bassin du Nord)
    "mines" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1831, 1.6, "mines"], tup![1851, 5.0, "mines"],
             tup![1872, 12.0, "mines"], tup![1900, 18.0, "mines"]],
    "mines_tard" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1851, 1.4, "bourg"], tup![1872, 4.0, "mines"],
                  tup![1900, 13.0, "mines"]],
    "forges_fr" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1831, 1.4, "forges"], tup![1851, 3.0, "forges"],
                 tup![1872, 5.0, "forges"], tup![1900, 8.5, "forges"]],
    // Le Havre : 20 000 en 1790, 130 000 en 1901 (paquebots transatlantiques, coton) ; Boulogne, Calais (tulles)
    "grand_port" => list![tup![1700, 0.8, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.85, "blocus"], tup![1831, 1.3, "grand_port"],
                  tup![1851, 2.2, "grand_port"], tup![1872, 4.0, "grand_port"], tup![1900, 6.0, "grand_port"]],
    // Saint-Nazaire : un bourg de 3 000 âmes, puis les bassins (1856) et les chantiers de Penhoët : 35 000 en 1901
    "saint_nazaire" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1851, 1.3, "bourg"], tup![1857, 2.0, "port_neuf"],
                     tup![1872, 6.0, "port_neuf"], tup![1900, 12.0, "port_neuf"]],
    "arsenal" => list![tup![1700, 0.9, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.8, "blocus"], tup![1831, 1.5, "arsenal"],
               tup![1851, 2.2, "arsenal"], tup![1872, 2.6, "arsenal"], tup![1900, 3.4, "arsenal"]],
    // Cherbourg : 11 000 en 1790, la digue et l'arsenal (1803-1858) : 28 000 en 1851, 43 000 en 1901
    "cherbourg" => list![tup![1700, 0.7, "paix"], tup![1790, 1.0, "arsenal"], tup![1801, 1.05, "arsenal"], tup![1831, 1.65, "arsenal"],
                 tup![1851, 2.55, "arsenal"], tup![1872, 3.2, "arsenal"], tup![1900, 3.9, "arsenal"]],
    // La Roche-sur-Yon : un village jusqu'à la ville neuve de Napoléon (1804), 13 000 habitants en 1901
    "roche_sur_yon" => list![tup![1700, 1.0, "bourg"], tup![1790, 1.0, "bourg"], tup![1804, 1.0, "ville_neuve"], tup![1811, 2.5, "ville_neuve"],
                     tup![1851, 6.5, "ville_neuve"], tup![1900, 13.0, "ville_neuve"]],
    // Nice, Menton : comté de Nice ; les hivernants anglais et russes, puis le chemin de fer (1864)
    "riviera" => list![tup![1700, 0.85, "paix"], tup![1790, 1.0, "guerres"], tup![1801, 0.75, "paix"], tup![1851, 1.35, "hivernants"],
               tup![1872, 2.1, "hivernants"], tup![1900, 4.2, "hivernants"]],
    // Cannes : un bourg de pêcheurs de 3 000 âmes, lord Brougham en 1834, le chemin de fer en 1863 : 10 000 en 1872, 30 000 en 1901
    "cannes" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1834, 1.3, "hivernants"], tup![1851, 1.8, "hivernants"],
              tup![1872, 3.4, "hivernants"], tup![1900, 10.0, "hivernants"]],
    "thermes_fr" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1831, 1.2, "thermes"], tup![1851, 1.6, "thermes"],
                  tup![1872, 4.0, "thermes"], tup![1900, 12.0, "thermes"]],
    "bains_fr" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1851, 1.6, "bains"], tup![1872, 3.0, "bains"], tup![1900, 4.5, "bains"]],
    "lourdes" => list![tup![1700, 0.9, "bourg"], tup![1790, 1.0, "bourg"], tup![1851, 1.4, "bourg"], tup![1858, 1.4, "pelerinage"],
               tup![1872, 1.8, "pelerinage"], tup![1900, 2.9, "pelerinage"]],
    "banlieue_paris" => list![tup![1700, 0.8, "defrichement"], tup![1790, 1.0, "plein"], tup![1831, 1.3, "banlieue_paris"],
                      tup![1851, 1.9, "banlieue_paris"], tup![1872, 3.4, "banlieue_paris"], tup![1900, 6.0, "banlieue_paris"]],
    // Saint-Denis, Boulogne-Billancourt : les usines de la Plaine et des bords de Seine (60 000 et 30 000 en 1901)
    "banlieue_usines" => list![tup![1700, 0.8, "defrichement"], tup![1790, 1.0, "plein"], tup![1831, 1.6, "banlieue_paris"],
                       tup![1851, 3.0, "banlieue_paris"], tup![1872, 6.5, "banlieue_paris"], tup![1900, 12.0, "banlieue_paris"]]
} }
// trajectoires particulières (les autres places suivent celle de leur type et de leur pays)
py_const!(POP_PLACE, dict!{
    "Bordeaux" => "bordeaux", "Libourne" => "libourne", "La Teste-de-Buch" => "teste", "Soulac" => "soulac",
    "Gujan-Mestras" => "bassin", "Andernos" => "bassin", "Lanton" => "bassin", "Lège" => "bassin", "Biganos" => "bassin",
    "Mérignac" => "banlieue", "Lormont" => "banlieue", "Villenave-d'Ornon" => "banlieue", "Ambarès-et-Lagrave" => "banlieue",
    "Blanquefort" => "banlieue", "Saint-Médard-en-Jalles" => "banlieue", "Cestas" => "banlieue",
    "Belin" => "pins", "Captieux" => "pins", "Mios" => "pins", "Salles" => "pins", "Saint-Symphorien" => "pins",
    "Lacanau" => "pins", "Saint-Jean-d'Illac" => "pins", "Houeillès" => "pins",
    "Périgueux" => "perigueux", "Bergerac" => "bergerac", "Mont-de-Marsan" => "montdemarsan", "Dax" => "dax",
    "Morcenx" => "gare", "Labouheyre" => "gare", "Agen" => "agen", "Villeneuve-sur-Lot" => "villeneuve", "Marmande" => "marmande",
    "Fumel" => "forges", "Pau" => "pau", "Bayonne" => "bayonne", "Biarritz" => "biarritz", "Saint-Jean-de-Luz" => "stjeandeluz",
    "Hendaye" => "hendaye", "Mauléon" => "mauleon", "Oloron-Sainte-Marie" => "oloron", "Salies-de-Béarn" => "salies",
    // carte de France (clé « nom|département » : des homonymes d'un département à l'autre)
    "Paris|75" => "paris", "Lyon|69" => "lyon", "Marseille|13" => "marseille", "Lille|59" => "lille",
    "Toulouse|31" => "grande_ville", "Reims|51" => "grande_ville",
    "Limoges|87" => "grande_ville", "Nancy|54" => "grande_ville", "Grenoble|38" => "grande_ville", "Le Mans|72" => "grande_ville",
    "Tourcoing|59" => "industrie", "Roanne|42" => "industrie", "Calais|62" => "industrie", "Rive-de-Gier|42" => "industrie",
    "Mulhouse|68" => "mulhouse", "Saint-Étienne|42" => "saint_etienne",
    "Roubaix|59" => "mulhouse", "Cherbourg|50" => "cherbourg", "Cannes|06" => "cannes", // (géographie 4 ; Roubaix, 8 000 âmes en 1790 et 124 000 en 1901, suit la courbe de Mulhouse)
    "Le Creusot|71" => "mines", "Decazeville|12" => "mines",
    "Montceau-les-Mines|71" => "mines_tard", "Lens|62" => "mines_tard", "Montluçon|03" => "forges_fr",
    "Le Havre|76" => "grand_port", "Boulogne-sur-Mer|62" => "grand_port", "Saint-Nazaire|44" => "saint_nazaire",
    "Toulon|83" => "arsenal", "Brest|29" => "arsenal", "Lorient|56" => "arsenal", "La Roche-sur-Yon|85" => "roche_sur_yon",
    "Nice|06" => "riviera", "Menton|06" => "riviera", "Vichy|03" => "thermes_fr", "Aix-les-Bains|73" => "bains_fr",
    "Royan|17" => "bains_fr", "Trouville-sur-Mer|14" => "bains_fr", "Lourdes|65" => "lourdes",
    "Saint-Denis|75" => "banlieue_usines", "Boulogne-Billancourt|75" => "banlieue_usines", "Argenteuil|78" => "banlieue_paris",
    "Aulnay-sous-Bois|75" => "banlieue_paris", "Rueil-Malmaison|75" => "banlieue_paris", "Saint-Maur-des-Fossés|75" => "banlieue_paris",
    "Noisy-le-Grand|75" => "banlieue_paris", "Antony|75" => "banlieue_paris", "Cergy|78" => "banlieue_paris",
    "Massy|78" => "banlieue_paris", "Corbeil-Essonnes|78" => "banlieue_paris", "Chelles|77" => "banlieue_paris"
});
pub const POP_TREND_K: f64 = 0.25;   // une place qui grandit plus vite que la moyenne produit un peu plus (racine quatrième)
pub const POP_EXCESS: f64 = 0.05;   // part de l'excédent qui s'en va chaque mois quand la place est trop pleine
pub const POP_SIEGE: f64 = 0.02;   // fuite mensuelle sous un siège, aggravée de 1 % par mois de siège (jusqu'à 5 %)
pub const POP_FAMINE: f64 = 0.015;   // fuite mensuelle quand le grenier est vide
pub const POP_UNREST: f64 = 0.35;   // sous cet ordre public, des habitants partent vers les places sûres…
pub const POP_UNREST_RATE: f64 = 0.006;   // … à ce rythme mensuel
pub const POP_SACK: f64 = 0.06;   // place prise de force : habitants tués ou en fuite…
pub const POP_SACK_FORT: f64 = 0.025;   // … davantage par niveau de remparts (on pille la ville qui a résisté)
pub const POP_REFUGE: f64 = 0.5;   // part des fuyards qui gagnent une place sûre de leur camp
pub const POP_FLOOR: f64 = 0.5;   // la disette et le désordre ne vident pas une place sous la moitié de sa normale…
pub const POP_FLOOR_SIEGE: f64 = 0.3;   // … un siège ou un sac, pas sous 30 % : il reste toujours des habitants
pub const POP_RETURN: f64 = 0.02;   // sous ce plancher, hors siège, les familles reviennent peu à peu (part du vide comblée par mois)
pub const POP_SAFE_STAB: f64 = 0.6;   // ordre public d'une place sûre, qui accueille les réfugiés


py_const!(POP_CURVES, {
    let POP_CURVES = POP_CURVES_base();
    POP_CURVES.setdefault("ville_fr", _town(1.18, 1.4, "ville"));   // (les départements générés : une ville, un village ordinaires)
    POP_CURVES.setdefault("rural_fr", _rural(1851, 1.15, 0.95, "exode", "plein"));
    POP_CURVES
});


// (les théâtres) les trajectoires de leurs villes, par « nom|pays » : [[année, population / celle de 1790, étiquette de
// POP_WHY], …] (game/data/epoques_<id>.json, tous les théâtres ensemble : les codes des pays sont uniques) ; les autres
// places : une ville, une campagne ordinaires d'un continent dont la population double au XIXe siècle
py_const!(EPOQUES, {
    let d = Val::dict();
    for t in crate::geo::THEATRES {
        d.update(&py::json::loads(t.epoques).unwrap_or_else(|e| panic!("epoques_{}.json : {e}", t.id)));
    }
    d
});
py_const!(POP_PAYS, dict!{"ville" => _town(1.35, 1.9, "ville"), "rural" => _rural(1871, 1.4, 1.5, "plein", "plein")});

/// Trajectoire de population d'un lieu (nœud de la carte).
pub fn pop_curve(gn: &Val) -> Val {
    if est_pays(&gn.at("dept")) {
        // (un théâtre : jamais les tables de la France, même pour Bordeaux ou Paris)
        let cv = EPOQUES().get(format!("{}|{}", gn.at("name").s(), gn.at("dept").s()).as_str());
        return cv.or_else(|| POP_PAYS().at(if gn.at_is("type", "village") { "rural" } else { "ville" }));
    }
    let mut key = POP_PLACE().get(format!("{}|{}", gn.at("name").s(), gn.at("dept").s()).as_str());
    if key.is_none() {
        key = POP_PLACE().get(gn.at("name"));
    }
    if key.is_none() {
        let (typ, dept) = (gn.at("type"), gn.at("dept"));
        if typ == "fort" {
            key = Val::from("fort");
        } else if typ == "village" {
            key = if dept == "40" && (gn.at("spec").has("bois") || gn.at("spec").has("fer")) { Val::from("pins") } else { Val::from(format!("rural_{dept}")) };
        } else {
            key = Val::from(format!("ville_{dept}"));
        }
    }
    POP_CURVES().get(&key).or_else(|| POP_CURVES().at(if key.s().starts_with("ville_") { "ville_fr" } else { "rural_fr" }))
}
// années à partir desquelles une technologie est connue (on ne recherche pas la machine à vapeur en 1700)
py_const!(TECH_YEAR, dict!{
    "baionnette" => 1700, "vauban" => 1700, "tir_rang" => 1700, "cuirassiers" => 1700, "diplomates" => 1700, "manufactures" => 1700, "gabares" => 1700,
    "mais" => 1700, "foires" => 1700, "transhumance" => 1700, "haras" => 1700, "ponts_chaussees" => 1716, "hussards" => 1720, "feu_peloton" => 1720,
    "armureries" => 1720, "hauts_fourneaux" => 1720, "chais" => 1720, "draperies" => 1710, "gemmage" => 1740, "genie" => 1748, "fonderie" => 1750,
    "gribeauval" => 1765, "assolement" => 1760, "fusil1777" => 1777, "escompte" => 1776, "poudreries" => 1775, "ordre_mixte" => 1772,
    "pomme_de_terre" => 1785, "coke" => 1785, "pins" => 1787, "ponts" => 1770, "gendarmerie" => 1791, "levee" => 1793, "chappe" => 1794, "pieces" => 1790,
    "voltigeurs" => 1795, "ecoles" => 1795, "divisions" => 1796, "art_cheval" => 1792, "larrey" => 1797, "prefectures" => 1800, "drainage" => 1800,
    "greniers" => 1790, "codecivil" => 1804, "cadastre" => 1807, "conserves" => 1810, "vapeur" => 1820, "engrais" => 1820, "outillage" => 1830,
    "canal" => 1838, "poste" => 1700, "valliere" => 1732, "etat_major" => 1818, "valee" => 1827, "percussion" => 1840, "minie" => 1849, "lahitte" => 1858,
    "chassepot" => 1866, "mitrailleuse" => 1866, "service_mil" => 1872, "gras" => 1874, "debange" => 1877, "lebel" => 1886, "canon75" => 1897,
    "chemins_fer" => 1841, "telegraphe" => 1850, "ferry" => 1881, "hygiene" => 1885, "acier" => 1860, "electricite" => 1882, "engrais_chim" => 1850,
    "landes1857" => 1857, "greffe" => 1880,
    // SPEC-TECH.md : Fleurus 1794 ; tranchées de la guerre de Sécession, 1860 ; Nobel 1867 ; mélinite 1885 ; transport des
    // troupes par le rail (Italie) 1859 ; Jenner 1800 ; caisse d'épargne de Bordeaux 1819 ; gaz à Bordeaux vers 1830 ;
    // Daguerre 1839 ; suffrage 1848 ; décret sur les mutuelles 1852 ; Genève 1864 ; téléphone 1879 ; loi Waldeck-Rousseau
    // 1884 ; premier vapeur de la Garonne 1818 ; Vicat 1817 ; Cordouan 1823 ; Delessert 1812 ; Dombasle 1820 ;
    // moissonneuses en France vers 1855 ; Millardet 1885
    "aerostiers" => 1794, "retranchements" => 1860, "dynamite" => 1867, "melinite" => 1885, "rail_militaire" => 1859, "vaccine" => 1800,
    "caisse_epargne" => 1819, "gaz" => 1830, "photographie" => 1839, "suffrage" => 1848, "mutuelles" => 1852, "croix_rouge" => 1864, "telephone" => 1879,
    "syndicats" => 1884, "vapeur_fluviale" => 1818, "ciment" => 1817, "fresnel" => 1823, "betterave" => 1812, "dombasle" => 1820, "moissonneuses" => 1855,
    "bouillie" => 1885});
// unités apparues en cours de route (la milice bourgeoise et les miquelets existent dès 1700 sous d'autres noms)
py_const!(UNIT_YEAR, dict!{"legion" => 1831});
// et disparues : les régiments étrangers du roi, licenciés en 1791-1792 ; les Suisses, revenus en 1815, renvoyés en 1830
py_const!(UNIT_UNTIL, dict!{"suisses" => 1830, "irlandais" => 1791, "royal_allemand" => 1791});
py_const!(UNIT_GAP, dict!{"suisses" => tup![1793, 1814]});


/// Ce type de troupe n'existe pas cette année-là (pas encore, ou plus).
pub fn hors_service(typ: &str, y: i64) -> bool {
    let gap = UNIT_GAP().get(typ);
    UNIT_YEAR().get_or(typ, 0) > y || UNIT_UNTIL().get_or(typ, 9999) < y || (gap.truthy() && gap.at(0) <= y && gap.at(1) >= y)
}

// ------------------------------------------------------------------ voies ferrées (SPEC-TECH.md, phase 2a)
// Lignes historiques, vérifiées le 19/10/2026 sur les articles « Ligne de… » de Wikipédia : (nom, villes de la carte
// dans l'ordre avec l'année où la ligne les atteint, sorties vers le bord [(ville, vers, direction)]). Chaque tronçon va
// d'une ville à la suivante, par la route la plus courte (game/rails.py) ; l'année ne sert qu'à l'ordre (les IA, le
// panneau) : un camp en avance construit plus tôt.
py_const!(RAIL_LINES, list![
    tup!["Bordeaux–La Teste", list![tup!["Bordeaux", 0], tup!["La Teste-de-Buch", 1841]], list![]],
    tup!["Paris–Bordeaux", list![tup!["Bordeaux", 0], tup!["Libourne", 1852], tup!["Coutras", 1852]], list![tup!["Coutras", "Angoulême", "N"]]],
    tup!["Bordeaux–Bayonne", list![tup!["Bordeaux", 0], tup!["Morcenx", 1854], tup!["Dax", 1854], tup!["Bayonne", 1855]], list![]],
    tup!["Bordeaux–Sète", list![tup!["Bordeaux", 0], tup!["Langon", 1855], tup!["La Réole", 1855], tup!["Marmande", 1855], tup!["Tonneins", 1855],
                       tup!["Aiguillon", 1856], tup!["Agen", 1856]], list![tup!["Agen", "Toulouse", "E"]]],
    tup!["Morcenx–Tarbes", list![tup!["Morcenx", 0], tup!["Mont-de-Marsan", 1857], tup!["Aire-sur-l'Adour", 1859]], list![tup!["Aire-sur-l'Adour", "Tarbes", "SE"]]],
    tup!["Coutras–Périgueux", list![tup!["Coutras", 0], tup!["Montpon", 1857], tup!["Mussidan", 1857], tup!["Périgueux", 1857]], list![]],
    tup!["Périgueux–Brive", list![tup!["Périgueux", 0], tup!["Terrasson", 1860]], list![tup!["Terrasson", "Brive", "E"]]],
    tup!["Périgueux–Limoges", list![tup!["Périgueux", 0], tup!["Thiviers", 1861]], list![tup!["Thiviers", "Limoges", "NE"]]],
    tup!["Toulouse–Bayonne", list![tup!["Pau", 0], tup!["Orthez", 1863], tup!["Peyrehorade", 1864], tup!["Bayonne", 1864]], list![tup!["Pau", "Tarbes", "E"]]],
    tup!["Puyoô–Dax", list![tup!["Orthez", 0], tup!["Dax", 1863]], list![]],
    tup!["Agen–Périgueux", list![tup!["Agen", 0], tup!["Fumel", 1863], tup!["Périgueux", 1863]], list![]],
    tup!["Bayonne–Irun", list![tup!["Bayonne", 0], tup!["Biarritz", 1864], tup!["Saint-Jean-de-Luz", 1864], tup!["Hendaye", 1864]], list![tup!["Hendaye", "Irun", "S"]]],
    tup!["Langon–Bazas", list![tup!["Langon", 0], tup!["Bazas", 1866]], list![]],
    tup!["Penne–Villeneuve–Tonneins", list![tup!["Fumel", 0], tup!["Villeneuve-sur-Lot", 1869], tup!["Sainte-Livrade", 1894], tup!["Tonneins", 1894]], list![]],
    tup!["Médoc", list![tup!["Bordeaux", 0], tup!["Lesparre-Médoc", 1873]], list![]],
    tup!["Libourne–Le Buisson", list![tup!["Libourne", 0], tup!["Bergerac", 1875], tup!["Lalinde", 1879]], list![]],
    tup!["Port-Sainte-Marie–Condom", list![tup!["Aiguillon", 0], tup!["Nérac", 1880]], list![]],
    tup!["La Cave–Ribérac", list![tup!["Périgueux", 0], tup!["Ribérac", 1881]], list![]],
    tup!["Le Buisson–Sarlat", list![tup!["Lalinde", 0], tup!["Sarlat", 1882]], list![]],
    tup!["Pau–Oloron", list![tup!["Pau", 0], tup!["Oloron-Sainte-Marie", 1883]], list![]],
    tup!["Puyoô–Mauléon", list![tup!["Orthez", 0], tup!["Salies-de-Béarn", 1884], tup!["Mauléon", 1887]], list![]],
    tup!["Marmande–Angoulême", list![tup!["Marmande", 0], tup!["Miramont", 1886], tup!["Bergerac", 1886], tup!["Mussidan", 1888], tup!["Ribérac", 1890]], list![]],
    tup!["Saintes–Bordeaux", list![tup!["Bordeaux", 0], tup!["Saint-André-de-Cubzac", 1886]], list![tup!["Saint-André-de-Cubzac", "Saintes", "N"]]],
    tup!["Saint-André–Blaye", list![tup!["Saint-André-de-Cubzac", 0], tup!["Blaye", 1889]], list![tup!["Blaye", "Saint-Mariens", "NE"]]],
    tup!["Labouheyre–Mimizan", list![tup!["Morcenx", 0], tup!["Mimizan", 1889]], list![]],   // (par Labouheyre, sur Bordeaux–Bayonne : approché)
    tup!["Marmande–Mont-de-Marsan", list![tup!["Marmande", 0], tup!["Casteljaloux", 1891], tup!["Mont-de-Marsan", 1893]], list![]],
    tup!["Thiviers–Nontron", list![tup!["Thiviers", 0], tup!["Nontron", 1892]], list![tup!["Nontron", "Angoulême", "N"]]],
    tup!["Nérac–Mont-de-Marsan", list![tup!["Nérac", 0], tup!["Mont-de-Marsan", 1897]], list![]],
    tup!["Dax–Mont-de-Marsan", list![tup!["Mont-de-Marsan", 0], tup!["Saint-Sever", 1891], tup!["Dax", 1899]], list![]]
]);
py_const!(RAIL_KM_COST, dict!{"livres" => 30, "fer" => 8, "bois" => 6});   // prix d'un km de voie
pub const RAIL_KM_DAYS: f64 = 4.0;   // jours de travail par km, à industrie moyenne (× 0,5 à 2 selon l'industrie du camp)
pub const RAIL_SPEED: f64 = 130.0;   // km par jour en train (chemins de fer militaires)
pub const RAIL_EMBARK: f64 = 1.0;   // jours pour embarquer en gare
pub const RAIL_TOWN_BONUS: f64 = 0.05;   // industrie et commerce d'une ville desservie, par tronçon…
pub const RAIL_TOWN_MAX: f64 = 0.15;   // … jusqu'à ce plafond
pub const RAIL_STATION_KM: f64 = 30.0;   // une armée à moins de cette distance d'une gare de son camp s'use moins vite…
pub const RAIL_STATION_DRAIN: f64 = -0.3;   // … de tant
pub const RAIL_CUT_TOURS: i64 = 3;   // tours pendant lesquels un tronçon coupé ne sert à personne

// ------------------------------------------------------------------ armement
// Chaque régiment garde les armes reçues à sa levée ; il faut le réarmer pour profiter d'un nouveau fusil.
// (technologie, nom, multiplicateur de puissance)
py_const!(ARMS, dict!{
    "inf" => list![tup![Val::None, "mousquet et piques", 0.85], tup!["baionnette", "fusil à silex", 1.0], tup!["fusil1777", "fusil 1777", 1.1],
            tup!["percussion", "fusil à percussion", 1.22], tup!["minie", "fusil rayé", 1.4], tup!["chassepot", "Chassepot", 1.7],
            tup!["gras", "fusil Gras", 1.82], tup!["lebel", "Lebel", 2.05]],
    "artillerie" => list![tup![Val::None, "canons de bronze", 0.85], tup!["valliere", "système Vallière", 0.95], tup!["gribeauval", "Gribeauval", 1.15],
                   tup!["valee", "système Valée", 1.3], tup!["lahitte", "canons rayés", 1.55], tup!["debange", "de Bange", 1.85],
                   tup!["canon75", "canon de 75", 2.3]]
});
py_const!(REARM, dict!{"inf" => dict!{"armes" => 0.12}, "artillerie" => dict!{"armes" => 0.25, "fer" => 0.25}});   // par homme du régiment
// manœuvres apprises par régiment (SPEC-ARBRE.md, « Moderniser ») : technologie → classe de troupe qui l'apprend.
// Les autres technologies (levée, divisions, génie…) jouent pour tout le camp dès leur découverte.
py_const!(MANEUVERS, dict!{"tir_rang" => "inf", "feu_peloton" => "inf", "ordre_mixte" => "inf", "retranchements" => "inf", "voltigeurs" => "inf",
                 "hussards" => "cavalerie", "cuirassiers" => "cavalerie", "art_cheval" => "artillerie", "melinite" => "artillerie"});
// effets « de régiment » : ceux d'une manœuvre non apprise, ou d'une arme plus récente que la sienne, ne jouent pas
// pour lui (vision, embuscades, pluie, sièges, coûts… restent au camp)
py_const!(REG_KEYS, pyset!["all_power", "inf_power", "art_power", "cav_power", "ligne_fire", "carre_fire", "colonne_charge",
                      "cav_charge", "art_charge", "legere_cover", "entrench", "shell", "art_speed"]);
pub const MAN_COST: f64 = 0.1;   // livres par homme et par manœuvre apprise
pub const MAN_DAYS: i64 = 10;   // jours d'exercice dans la place (armes et manœuvres) : un tiers de tour, comme le dit engine.modernize
// noms des troupes selon l'époque : (année de début, technologie requise ou None, nom, nom court)
py_const!(UNIT_NAMES, dict!{
    "ligne" => list![tup![1700, Val::None, "Mousquetaires et piquiers", "Piquiers"], tup![1700, "baionnette", "Infanterie de ligne", "Ligne"]],
    "legere" => list![tup![1700, Val::None, "Troupes légères (fusiliers, arquebusiers)", "Légère"],
               tup![1700, "voltigeurs", "Infanterie légère (voltigeurs)", "Légère"], tup![1838, Val::None, "Chasseurs à pied", "Chass. à pied"]],
    "cavalerie" => list![tup![1700, Val::None, "Cavalerie (dragons, chevau-légers)", "Cavalerie"], tup![1700, "hussards", "Cavalerie (dragons, hussards)", "Cavalerie"],
                  tup![1800, "cuirassiers", "Cavalerie (cuirassiers, dragons, hussards)", "Cavalerie"],
                  tup![1871, Val::None, "Cavalerie (dragons, chasseurs à cheval)", "Cavalerie"]],
    "chasseurs" => list![tup![1700, Val::None, "Miquelets (fusiliers de montagne)", "Miquelets"], tup![1792, Val::None, "Chasseurs basques (montagnards)", "Chasseurs"]],
    "garde" => list![tup![1700, Val::None, "Milice bourgeoise", "Milice b."], tup![1789, Val::None, "Garde nationale", "Garde nat."],
              tup![1872, Val::None, "Armée territoriale", "Territoriale"]]
});

// ------------------------------------------------------------------ généraux
py_const!(GENERAL_TRAITS, dict!{
    "audacieux" => dict!{"label" => "Audacieux", "desc" => "Frappe plus fort en attaque (+12 %), mais s’expose davantage."},
    "prudent" => dict!{"label" => "Prudent", "desc" => "Pertes réduites en défense (−12 %), retraites deux fois moins coûteuses."},
    "cavalier" => dict!{"label" => "Cavalier", "desc" => "Cavalerie +20 %, l’armée marche 10 % plus vite."},
    "artilleur" => dict!{"label" => "Artilleur", "desc" => "Artillerie +25 %, sièges 40 % plus rapides."},
    "montagnard" => dict!{"label" => "Montagnard", "desc" => "+15 % au combat et marche facilitée en collines et montagne."},
    "eclaireur" => dict!{"label" => "Éclaireur", "desc" => "Embuscades +25 %, voltigeurs +10 %, repère les ennemis cachés de plus loin."},
    "inspirant" => dict!{"label" => "Inspirant", "desc" => "Moral de départ +10, pertes de moral −15 %."},
    "logisticien" => dict!{"label" => "Logisticien", "desc" => "Ravitaillement deux fois plus durable, usure −40 %."}
});
py_const!(GENERAL_RANKS, list!["Colonel", "Général de brigade", "Général de division", "Lieutenant général", "Maréchal"]);
py_const!(GENERAL_XP, list![0, 3, 7, 12, 18]);   // points d'expérience de chaque grade (SPEC-GENERAUX.md)
// risques d'un général à chaque bataille de campagne (blessé, tué, pris) ; Audacieux ×1,5, Prudent ×0,6, assaut d'une place ×1,5
py_const!(GENERAL_RISQUES, dict!{"victoire" => tup![0.04, 0.01, 0.0], "defaite" => tup![0.1, 0.04, 0.06], "aneantie" => tup![0.15, 0.1, 0.5]});
py_const!(GENERAL_RISQUE_TRAIT, dict!{"audacieux" => 1.5, "prudent" => 0.6});
py_const!(BLESSURE_MOIS, tup![1, 3]);   // convalescence d'un général blessé
// talents (SPEC-GENERAUX.md) : un petit arbre par trait (étage 1, puis étage 2 avec l'un des deux premiers), et des talents
// communs ; leurs effets s'ajoutent à ceux des technologies des régiments de l'armée (mêmes clés : puissance, feu, charge)
pub fn _t(label: &str, desc: &str, trait_: impl Into<Val>, etage: i64, fx: Val) -> Val {
    dict!{"label" => label, "desc" => desc, "trait" => trait_.into(), "etage" => etage, "fx" => fx}
}


py_const!(GENERAL_TALENTS, dict!{
    "charge_furieuse" => _t("Charge furieuse", "Charges des colonnes +12 %, de la cavalerie +8 %.", "audacieux", 1, dict!{"colonne_charge" => 0.12, "cav_charge" => 0.08}),
    "elan" => _t("Élan", "Infanterie +6 %.", "audacieux", 1, dict!{"inf_power" => 0.06}),
    "coup_de_main" => _t("Coup de main", "Toutes armes +5 %.", "audacieux", 2, dict!{"all_power" => 0.05}),
    "feu_de_rang" => _t("Feu de rang", "Feu de l’infanterie en ligne +10 %.", "prudent", 1, dict!{"ligne_fire" => 0.1}),
    "carre_solide" => _t("Carré solide", "Feu du carré +12 %.", "prudent", 1, dict!{"carre_fire" => 0.12}),
    "inebranlable" => _t("Inébranlable", "Toutes armes +4 %, troupes légères à couvert +5 %.", "prudent", 2, dict!{"all_power" => 0.04, "legere_cover" => 0.05}),
    "sabreurs" => _t("Sabreurs", "Cavalerie +8 %.", "cavalier", 1, dict!{"cav_power" => 0.08}),
    "cuirasses" => _t("Escadrons cuirassés", "Charge de la cavalerie +12 %.", "cavalier", 1, dict!{"cav_charge" => 0.12}),
    "grande_charge" => _t("Grande charge", "Cavalerie +6 %, sa charge +6 %.", "cavalier", 2, dict!{"cav_power" => 0.06, "cav_charge" => 0.06}),
    "pointeurs" => _t("Pointeurs", "Artillerie +8 %.", "artilleur", 1, dict!{"art_power" => 0.08}),
    "attelages" => _t("Attelages", "Artillerie 15 % plus rapide en marche.", "artilleur", 1, dict!{"art_speed" => 0.15}),
    "grande_batterie" => _t("Grande batterie", "Artillerie +8 %.", "artilleur", 2, dict!{"art_power" => 0.08}),
    "chasseurs_des_cols" => _t("Chasseurs des cols", "+8 % en collines et montagne.", "montagnard", 1, dict!{"mountain" => 0.08}),
    "tirailleurs" => _t("Tirailleurs", "Troupes légères à couvert +10 %.", "montagnard", 1, dict!{"legere_cover" => 0.1}),
    "maitre_des_hauteurs" => _t("Maître des hauteurs", "+8 % en collines et montagne.", "montagnard", 2, dict!{"mountain" => 0.08}),
    "voltigeurs" => _t("Voltigeurs", "Troupes légères à couvert +10 %.", "eclaireur", 1, dict!{"legere_cover" => 0.1}),
    "escarmouche" => _t("Escarmouche", "Infanterie +5 %.", "eclaireur", 1, dict!{"inf_power" => 0.05}),
    "rideau" => _t("Rideau de cavaliers", "Troupes légères à couvert +8 %, cavalerie +4 %.", "eclaireur", 2, dict!{"legere_cover" => 0.08, "cav_power" => 0.04}),
    "harangue" => _t("Harangue", "Toutes armes +4 %.", "inspirant", 1, dict!{"all_power" => 0.04}),
    "drapeau" => _t("Au drapeau !", "Charges des colonnes +10 %.", "inspirant", 1, dict!{"colonne_charge" => 0.1}),
    "idole" => _t("Idole des troupes", "Toutes armes +5 %.", "inspirant", 2, dict!{"all_power" => 0.05}),
    "trains" => _t("Trains d’artillerie", "Artillerie 12 % plus rapide en marche.", "logisticien", 1, dict!{"art_speed" => 0.12}),
    "munitions" => _t("Caissons pleins", "Feu de ligne +6 %, artillerie +4 %.", "logisticien", 1, dict!{"ligne_fire" => 0.06, "art_power" => 0.04}),
    "intendance" => _t("Intendance", "Toutes armes +4 %.", "logisticien", 2, dict!{"all_power" => 0.04}),
    "veteran" => _t("Vétéran", "Toutes armes +3 %.", Val::None, 1, dict!{"all_power" => 0.03}),
    "feu_roulant" => _t("Feu roulant", "Feu de ligne +5 %.", Val::None, 1, dict!{"ligne_fire" => 0.05}),
    "artillerie_volante" => _t("Artillerie volante", "Artillerie 8 % plus rapide en marche.", Val::None, 1, dict!{"art_speed" => 0.08}),
    "eclaireurs" => _t("Cavalerie légère", "Cavalerie +4 %.", Val::None, 1, dict!{"cav_power" => 0.04})
});
py_const!(MEDAILLES, list![tup![1792, "Ordre de Saint-Louis"], tup![1804, "Arme d’honneur"], tup![9999, "Légion d’honneur"]]);   // (jusqu'à l'année, nom)
pub const MEDAILLE_MORAL: i64 = 2;   // moral de départ de son armée par médaille (3 médailles comptent au plus)
pub const RESERVE_MAX: i64 = 8;   // généraux en réserve par camp au plus (les plus anciens partent en retraite)
pub const MARECHAL_VICTOIRES: i64 = 5;   // victoires (vraies batailles) avant le bâton de maréchal ; un seul maréchal par camp
// trait plus fréquent selon le département
py_const!(GENERAL_FAVORITE, dict!{"33" => "logisticien", "24" => "artilleur", "40" => "eclaireur", "47" => "prudent", "64" => "montagnard"});
py_const!(SURNAMES, list!["Labat", "Dufau", "Lacoste", "Darricau", "Etcheverry", "Bordenave", "Lafargue", "Larrieu", "Castaing", "Duprat",
            "Garat", "Lassalle", "Fourcade", "Peyrot", "Ducasse", "Lamothe", "Delbos", "Chastang", "Vergnaud", "Darriet",
            "Lagarde", "Lalanne", "Bernadet", "Cazenave", "Mondiet", "Puyo", "Sallenave", "Hiriart", "Iribarne", "Larrouy",
            "Faget", "Lartigue", "Daguerre", "Barrère", "Courrèges", "Lacaze", "Saint-Martin", "Doumecq", "Laborde", "Pédelaborde",
            "Mauriac", "Lafon", "Delpech", "Marty", "Roumégoux", "Sudre", "Bouyssou", "Vialle", "Escande", "Fabre"]);

// ------------------------------------------------------------------ familles dirigeantes (game/familles.py)
// (la table telle qu'elle est écrite ici ; MAISON_NOMS() la rend complétée plus bas : les pays des théâtres)
fn MAISON_NOMS_base() -> Val { dict!{
    "33" => list!["de Ségur", "de Pontac", "de Lur-Saluces", "Pichon", "Ducos", "Boyer-Fonfrède", "Nairac", "Gradis"],
    "24" => list!["de Bourdeille", "de Salignac", "de Beynac", "de Hautefort", "de Biron", "Maine de Biran", "Lagrange-Chancel", "Fournier"],
    "40" => list!["de Borda", "de Poyanne", "Batbedat", "Lamarque", "Dufau", "de Caupenne", "Basquiat", "Lalanne"],
    "47" => list!["de Lacépède", "de Durfort", "de Fumel", "Lacuée", "de Raymond", "Boudon", "de Nort", "Lafont"],
    "64" => list!["de Gramont", "Etcheverry", "de Gassion", "de Navailles", "Harispe", "Garat", "d’Abbadie", "Larralde"]
} }
py_const!(MAISON_NOMS, {
    let MAISON_NOMS = MAISON_NOMS_base();
    // (les pays des théâtres : leurs maisons, la régnante de 1700 d'abord, écrites à la française : "maisons" de
    // pays_<id>.json ; sans elles, des noms de leur culture)
    for p in PAYS().values() {
        for (c, f) in p.items() {
            let noms = f.get("maisons");
            MAISON_NOMS.set(&c, if noms.is_list() && !noms.is_empty() { noms.copy() } else { surnames(c.s()).slice(None, Some(8)) });
        }
    }
    MAISON_NOMS
});

/// (les théâtres) Les prénoms, prénoms féminins et noms (généraux, épouses) d'une grande famille culturelle, écrits à la
/// française : le champ "culture" d'un pays (pays_<id>.json) est une de ces clés, une clé de cultures_<id>.json (les
/// cultures d'un théâtre, même forme), ou « francaise » : PRENOMS, PRENOMS_F et SURNAMES, comme les départements.
struct Culture {
    prenoms: &'static [&'static str],
    prenoms_f: &'static [&'static str],
    noms: &'static [&'static str],
}
const CULTURES: [(&str, Culture); 10] = [
    ("britannique", Culture {
        prenoms: &["Georges", "Guillaume", "Jacques", "Charles", "Henri", "Édouard", "Thomas", "Jean", "Richard", "Robert"],
        prenoms_f: &["Anne", "Marie", "Élisabeth", "Caroline", "Charlotte", "Sarah"],
        noms: &["Marlborough", "Wellesley", "Moore", "Wolfe", "Clive", "Howe", "Cornwallis", "Abercromby", "Burgoyne", "Raglan", "Napier", "Hill", "Paget", "Graham", "Campbell", "Stanhope"],
    }),
    ("allemande", Culture {
        prenoms: &["Frédéric", "Guillaume", "Charles", "Léopold", "Ferdinand", "Maximilien", "Jean", "Ernest", "Auguste", "Louis"],
        prenoms_f: &["Sophie", "Marie-Thérèse", "Élisabeth", "Louise", "Wilhelmine", "Charlotte"],
        noms: &["Blücher", "Gneisenau", "Scharnhorst", "Seydlitz", "Ziethen", "Schwerin", "Daun", "Laudon", "Lacy", "Mack", "Clausewitz", "Moltke", "Roon", "Yorck", "Bülow", "Kleist"],
    }),
    ("russe", Culture {
        prenoms: &["Pierre", "Alexis", "Ivan", "Alexandre", "Nicolas", "Michel", "Paul", "Dimitri", "Fédor", "Boris"],
        prenoms_f: &["Catherine", "Élisabeth", "Anne", "Marie", "Nathalie", "Sophie"],
        noms: &["Souvorov", "Koutouzov", "Cheremetiev", "Roumiantsev", "Bagration", "Barclay de Tolly", "Miloradovitch", "Platov", "Bennigsen", "Potemkine", "Repnine", "Saltykov", "Apraxine", "Golitsyne", "Skobelev", "Gourko"],
    }),
    ("espagnole", Culture {
        prenoms: &["Philippe", "Charles", "Ferdinand", "Jean", "Joseph", "Antoine", "François", "Pierre", "Diègue", "Louis"],
        prenoms_f: &["Marie", "Isabelle", "Élisabeth", "Barbe", "Thérèse", "Louise"],
        noms: &["Castaños", "Palafox", "Cuesta", "Blake", "Ricardos", "O'Reilly", "Gálvez", "Espartero", "Prim", "Narváez", "Montemar", "Santa Cruz", "Mina", "Ballesteros"],
    }),
    ("portugaise", Culture {
        prenoms: &["Jean", "Pierre", "Joseph", "Antoine", "Emmanuel", "François", "Louis", "Michel"],
        prenoms_f: &["Marie", "Anne", "Isabelle", "Thérèse", "Françoise", "Béatrice"],
        noms: &["Saldanha", "Silveira", "Freire", "Sousa", "Pereira", "Almeida", "Mascarenhas", "Noronha", "Lencastre", "Lippe"],
    }),
    ("italienne", Culture {
        prenoms: &["Victor-Amédée", "Charles-Emmanuel", "Jean", "Joseph", "François", "Pierre", "Antoine", "Ferdinand", "Côme", "Laurent"],
        prenoms_f: &["Marie", "Anne", "Lucrèce", "Victoire", "Clotilde", "Béatrice"],
        noms: &["Montecuccoli", "Caracciolo", "Pignatelli", "Doria", "Spinola", "Colloredo", "Pepe", "Cialdini", "La Marmora", "Cadorna", "Garibaldi", "Bava", "Fanti", "Durando"],
    }),
    ("ottomane", Culture {
        prenoms: &["Moustafa", "Ahmed", "Mahmoud", "Sélim", "Osman", "Méhémet", "Ali", "Hassan", "Ibrahim", "Soliman"],
        prenoms_f: &["Fatma", "Aïcha", "Hatice", "Mihrimah", "Esma", "Zeynep"],
        noms: &["Köprülü", "Baltadji", "Topal Osman", "Hekimoğlou", "Djezzar", "Kara Moustafa", "Hussein Pacha", "Réchid", "Omer Pacha", "Alemdar", "Halil Pacha", "Ali Pacha"],
    }),
    ("scandinave", Culture {
        prenoms: &["Charles", "Frédéric", "Christian", "Gustave", "Adolphe", "Ulric", "Jean", "Éric", "Magnus", "Olaf"],
        prenoms_f: &["Ulrique-Éléonore", "Christine", "Louise", "Sophie", "Ingrid", "Hedvige"],
        noms: &["Stenbock", "Rehnskiöld", "Lewenhaupt", "Horn", "Armfelt", "Klingspor", "Adlercreutz", "Tordenskjold", "Rantzau", "Ahlefeldt", "Schulin", "Löwenörn"],
    }),
    ("polonaise", Culture {
        prenoms: &["Jean", "Auguste", "Stanislas", "Casimir", "Michel", "Joseph", "Adam", "Thadée", "Ladislas", "Jérôme"],
        prenoms_f: &["Marie", "Hedwige", "Anne", "Sophie", "Isabelle", "Constance"],
        noms: &["Poniatowski", "Kosciuszko", "Dombrowski", "Sobieski", "Jablonowski", "Lubomirski", "Potocki", "Sieniawski", "Branicki", "Chlopicki", "Skrzynecki", "Pulaski"],
    }),
    ("neerlandaise", Culture {
        prenoms: &["Guillaume", "Maurice", "Jean", "Henri", "Frédéric", "Antoine", "Adrien", "Corneille", "Jacques", "Pierre"],
        prenoms_f: &["Marie", "Anne", "Wilhelmine", "Louise", "Amélie", "Catherine"],
        noms: &["Ouwerkerk", "Slangenburg", "Tilly", "Coehoorn", "Fagel", "Van der Dussen", "Chassé", "Van Heutsz", "Bentinck", "Van Haren", "De Ruyter", "Van Ghent"],
    }),
];

// (les cultures nouvelles des théâtres : game/data/cultures_<id>.json, tous les théâtres ensemble)
py_const!(CULTURES_THEATRES, {
    let d = Val::dict();
    for t in crate::geo::THEATRES {
        d.update(&py::json::loads(t.cultures).unwrap_or_else(|e| panic!("cultures_{}.json : {e}", t.id)));
    }
    d
});
/// Cette culture est-elle connue (« francaise », CULTURES ou celles des théâtres) ?
pub fn culture_connue(k: &str) -> bool {
    k == "francaise" || CULTURES.iter().any(|c| c.0 == k) || CULTURES_THEATRES().get(k).is_dict()
}
/// (privé) Les noms d'un camp (quoi : prenoms, prenoms_f ou noms) : ceux de sa culture, sinon le défaut (la France, les
/// départements, une culture inconnue).
fn noms_culture(code: &str, quoi: &str, defaut: fn() -> Val) -> Val {
    let f = FACTIONS().get(code);
    let k = if f.is_dict() { f.get("culture") } else { Val::None };
    if !k.is_str() {
        return defaut();
    }
    if let Some((_, c)) = CULTURES.iter().find(|c| c.0 == k.s()) {
        return liste(match quoi { "prenoms" => c.prenoms, "prenoms_f" => c.prenoms_f, _ => c.noms });
    }
    let c = CULTURES_THEATRES().get(&k);
    if c.is_dict() && c.get(quoi).is_list() { c.at(quoi) } else { defaut() }
}
fn liste(l: &[&str]) -> Val {
    l.iter().map(|n| Val::from(*n)).collect()
}
/// Les prénoms d'un camp : ceux de sa culture (un pays), sinon PRENOMS.
pub fn prenoms(code: &str) -> Val {
    noms_culture(code, "prenoms", PRENOMS)
}
/// Les prénoms féminins d'un camp (PRENOMS_F pour la France et les départements).
pub fn prenoms_f(code: &str) -> Val {
    noms_culture(code, "prenoms_f", PRENOMS_F)
}
/// Les noms des généraux et des familles d'un camp (SURNAMES pour la France et les départements).
pub fn surnames(code: &str) -> Val {
    noms_culture(code, "noms", SURNAMES)
}
py_const!(PRENOMS, list!["Jean", "Pierre", "Bernard", "Arnaud", "Guillaume", "Raymond", "Jacques", "Joseph", "Gaston", "Henri", "Louis",
           "Antoine", "Étienne", "Bertrand", "Armand", "François"]);
py_const!(PRENOMS_F, list!["Marie", "Jeanne", "Catherine", "Marguerite", "Anne", "Louise", "Madeleine", "Isabeau", "Françoise", "Thérèse"]);
py_const!(MAISON_TITRES, list![tup![0, "Gouverneur"], tup![1790, "Président du directoire"], tup![1800, "Préfet"]]);   // (dès l'année, titre du chef)
// traits du chef : leurs effets passent par les modificateurs du camp, comme ceux des technologies (Game.recompute_mods)
py_const!(MAISON_TRAITS, dict!{
    "batisseur" => dict!{"label" => "Bâtisseur", "desc" => "Constructions −10 % de coût et de délai.", "fx" => dict!{"build_cost" => -0.1}},
    "econome" => dict!{"label" => "Économe", "desc" => "Soldes et rations −5 %.", "fx" => dict!{"upkeep" => -0.05}},
    "belliqueux" => dict!{"label" => "Belliqueux", "desc" => "Recrues +10 %, propositions moins bien reçues.", "fx" => dict!{"recrues" => 0.1, "diplo" => -10}},
    "diplomate" => dict!{"label" => "Diplomate", "desc" => "Propositions mieux reçues, alliances plus faciles.", "fx" => dict!{"diplo" => 15}},
    "savant" => dict!{"label" => "Savant", "desc" => "Recherche +8 %.", "fx" => dict!{"research_speed" => 0.08}},
    "populaire" => dict!{"label" => "Populaire", "desc" => "Ordre public +5 %.", "fx" => dict!{"order" => 0.05}}
});
pub const MARIAGE_REL: i64 = 15;   // relations gagnées des deux côtés par un mariage (25 au départ : banc de 1700, 1er/11/2026)
pub const MARIAGE_AGE: i64 = 16;   // pas de mariage avant cet âge (un chef enfant attend)
pub const NAISSANCE_P: f64 = 0.25;   // chance par an d'un enfant (chef marié de moins de NAISSANCE_AGE ans)…
pub const NAISSANCE_AGE: i64 = 45;
pub const HERITIERS_MAX: i64 = 4;   // … jusqu'à tant d'héritiers
pub const CRISE_JOURS: i64 = 180;   // désordre d'une crise de succession (ordre public −0,1 dans tout le camp)
pub const PARJURE_JOURS: i64 = 120;   // guerre déclarée à une maison alliée par mariage (ordre public −0,1)

// ------------------------------------------------------------------ politique intérieure (SPEC-POLITIQUE, module 5)
// engine/politique.rs. Le mécontentement d'une classe (0 à 100) tend chaque mois vers sa cible : base du régime, impôt
// de la classe (écart à 0,5 × POL_IMPOT × sensibilité du régime), injustice fiscale, guerres, lassitude, défaites,
// famine, banqueroute, églises et universités, ministres. fx : effets du régime sur les modificateurs du camp (comme les
// traits du chef de la maison) ; mandat : mois entre deux renouvellements du chef du gouvernement (élections en
// république ; 0 : ministres à vie) ; renvoi : mécontentement de la noblesse quand on renvoie un ministre ; repression :
// chance de réprimer une révolution en plus ; but : le régime que la classe veut quand elle se soulève.
py_const!(REGIMES, dict!{
    "absolue" => dict!{"label" => "Monarchie absolue",
        "desc" => "Le roi gouverne seul : la noblesse est choyée et paie peu, le peuple se fâche plus vite ; les ministres le sont à vie. Recrues +5 %.",
        "base" => dict!{"noblesse" => 12, "peuple" => 35}, "sensible" => dict!{"noblesse" => 1.6, "peuple" => 1.3},
        "fx" => dict!{"recrues" => 0.05}, "mandat" => 0, "renvoi" => 3, "repression" => 0.15},
    "constitutionnelle" => dict!{"label" => "Monarchie constitutionnelle",
        "desc" => "Le roi règne, un Premier ministre gouverne, renouvelé tous les quatre ans ou après une défaite. Commerce +10 %, livres +3 %.",
        "base" => dict!{"noblesse" => 25, "peuple" => 25}, "sensible" => dict!{"noblesse" => 1.0, "peuple" => 1.0},
        "fx" => dict!{"trade" => 0.1, "livres" => 0.03}, "mandat" => 48, "renvoi" => 6, "repression" => 0.0},
    "republique" => dict!{"label" => "République",
        "desc" => "Des élections tous les quatre ans renouvellent le gouvernement : le peuple est apaisé, la noblesse mécontente. Recherche +10 %, lassitude de la guerre −10 %.",
        "base" => dict!{"noblesse" => 40, "peuple" => 15}, "sensible" => dict!{"noblesse" => 0.9, "peuple" => 0.8},
        "fx" => dict!{"research_speed" => 0.1, "weariness" => -0.1}, "mandat" => 48, "renvoi" => 8, "repression" => -0.15}
});
py_const!(CLASSES, dict!{"noblesse" => dict!{"label" => "Noblesse", "but" => "absolue"}, "peuple" => dict!{"label" => "Peuple", "but" => "republique"}});
// les postes du cabinet : fx par point de compétence du ministre (1 à 5) ; mec : mécontentement des deux classes par point
py_const!(POSTES, dict!{
    "chef" => dict!{"label" => "Chef du gouvernement", "desc" => "Ordre public et apaisement des deux classes.", "fx" => dict!{"order" => 0.006}, "mec" => -1.0},
    "finances" => dict!{"label" => "Finances", "desc" => "Rentrées d'impôts.", "fx" => dict!{"livres" => 0.012}, "mec" => 0.0},
    "guerre" => dict!{"label" => "Guerre", "desc" => "Recrutement.", "fx" => dict!{"recrues" => 0.015}, "mec" => 0.0},
    "marine" => dict!{"label" => "Marine", "desc" => "Ports et arsenaux.", "fx" => dict!{"port" => 0.03}, "mec" => 0.0},
    "justice" => dict!{"label" => "Justice et police", "desc" => "Ordre public ; aide à réprimer une révolution.", "fx" => dict!{"order" => 0.008}, "mec" => 0.0},
    "commerce" => dict!{"label" => "Commerce et colonies", "desc" => "Gains du commerce.", "fx" => dict!{"trade" => 0.02}, "mec" => 0.0}
});
// traits des ministres : fx sur le camp, mec sur chaque classe
py_const!(MINISTRE_TRAITS, dict!{
    "integre" => dict!{"label" => "Intègre", "desc" => "Ordre public +2 %.", "fx" => dict!{"order" => 0.02}, "mec" => dict!{}},
    "corrompu" => dict!{"label" => "Corrompu", "desc" => "Livres −3 %, le peuple gronde (+3).", "fx" => dict!{"livres" => -0.03}, "mec" => dict!{"peuple" => 3}},
    "reformateur" => dict!{"label" => "Réformateur", "desc" => "Recherche +4 % ; peuple −4, noblesse +4.", "fx" => dict!{"research_speed" => 0.04}, "mec" => dict!{"noblesse" => 4, "peuple" => -4}},
    "aristocrate" => dict!{"label" => "Aristocrate", "desc" => "Noblesse −5, peuple +3.", "fx" => dict!{}, "mec" => dict!{"noblesse" => -5, "peuple" => 3}},
    "populaire" => dict!{"label" => "Populaire", "desc" => "Peuple −5.", "fx" => dict!{}, "mec" => dict!{"peuple" => -5}},
    "econome" => dict!{"label" => "Économe", "desc" => "Soldes et rations −3 %.", "fx" => dict!{"upkeep" => -0.03}, "mec" => dict!{}},
    "energique" => dict!{"label" => "Énergique", "desc" => "Constructions −4 %.", "fx" => dict!{"build_cost" => -0.04}, "mec" => dict!{}}
});
pub const POL_IMPOT: f64 = 70.0;   // mécontentement par point d'impôt au-dessus (ou au-dessous) de 0,5, avant la sensibilité du régime
pub const POL_INJUSTICE: f64 = 15.0;   // le peuple taxé plus que la noblesse : par point d'écart
pub const POL_VITESSE: f64 = 0.2;   // part de l'écart à la cible comblée chaque mois
pub const POL_CHOC_OUBLI: f64 = 0.85;   // un choc (défaite, renvoi, événement) s'efface de 15 % par mois
pub const POL_ORDRE: f64 = 55.0;   // au-delà, le mécontentement d'une classe pèse sur l'ordre public…
pub const POL_ORDRE_K: f64 = 200.0;   // … de (mécontentement − POL_ORDRE) / POL_ORDRE_K
pub const SEUIL_EMEUTE: f64 = 70.0;   // émeutes
pub const SEUIL_REVOLUTION: f64 = 80.0;   // révolution quand une classe y reste REVOLUTION_MOIS mois de suite
pub const REVOLUTION_MOIS: i64 = 4;
pub const REVOLUTION_REPIT: i64 = 24;   // mois sans nouvelle révolution après une décision
pub const GUERRE_CIVILE_PLACES: i64 = 6;   // en dessous, une révolution victorieuse change le régime sans guerre civile
pub const GUERRE_CIVILE_PART: f64 = 0.35;   // part des places (et des armées qui s'y trouvent) qui passe aux rebelles
pub const CANDIDATS: i64 = 3;   // ministres que l'on peut nommer, renouvelés chaque année
/// Le régime d'un pays à une date, selon l'histoire : la France absolue avant 1789, constitutionnelle de 1789 à 1792,
/// républicaine jusqu'à l'Empire… ; un département suit la France, une colonie sa métropole (culture française,
/// britannique, néerlandaise, espagnole, portugaise), les autres pays sont des monarchies absolues.
pub fn regime_historique(code: &str, annee: i64) -> &'static str {
    // (code, [(depuis l'année, régime)]), du plus ancien au plus récent
    const HISTOIRE: &[(&str, &[(i64, &str)])] = &[
        ("FR", &[(0, "absolue"), (1789, "constitutionnelle"), (1792, "republique"), (1804, "absolue"), (1814, "constitutionnelle"),
                 (1848, "republique"), (1852, "absolue"), (1870, "republique")]),
        ("GB", &[(0, "constitutionnelle")]),
        ("NL", &[(0, "republique"), (1806, "constitutionnelle")]),
        ("VE", &[(0, "republique")]), ("GE", &[(0, "republique")]), ("CH", &[(0, "republique")]),
        ("PL", &[(0, "constitutionnelle")]),
        ("SE", &[(0, "absolue"), (1719, "constitutionnelle"), (1772, "absolue"), (1809, "constitutionnelle")]),
        ("ES", &[(0, "absolue"), (1834, "constitutionnelle")]), ("PT", &[(0, "absolue"), (1834, "constitutionnelle")]),
        ("SA", &[(0, "absolue"), (1848, "constitutionnelle")]), ("PR", &[(0, "absolue"), (1848, "constitutionnelle")]),
        ("AU", &[(0, "absolue"), (1867, "constitutionnelle")]), ("DK", &[(0, "absolue"), (1849, "constitutionnelle")]),
        ("BE", &[(0, "absolue"), (1831, "constitutionnelle")]), ("BA", &[(0, "absolue"), (1818, "constitutionnelle")]),
        ("WU", &[(0, "absolue"), (1819, "constitutionnelle")]), ("SX", &[(0, "absolue"), (1831, "constitutionnelle")]),
        ("HA", &[(0, "absolue"), (1833, "constitutionnelle")]),
        ("ATC", &[(0, "constitutionnelle"), (1776, "republique")]),
    ];
    let metropole = COLONIES.iter().find(|c| c.0 == code).map(|c| c.1).or_else(|| {
        let f = FACTIONS().get(code);
        let cult = if f.is_dict() { f.get("culture") } else { Val::None };
        if !cult.is_str() {
            return (!est_pays(&Val::from(code))).then_some("FR"); // un département
        }
        [("francaise", "FR"), ("britannique", "GB"), ("neerlandaise", "NL"), ("espagnole", "ES"), ("portugaise", "PT")]
            .iter().find(|c| c.0 == cult.s()).map(|c| c.1)
    });
    let c = if HISTOIRE.iter().any(|h| h.0 == code) { code } else { metropole.unwrap_or(code) };
    HISTOIRE.iter().find(|h| h.0 == c).map_or("absolue", |h| h.1.iter().rev().find(|p| p.0 <= annee).map_or("absolue", |p| p.1))
}
/// (SPEC-POLITIQUE, module 5) Le code d'un camp rebelle né d'une guerre civile : celui de son pays suivi d'un « r »
/// (« FRr », « 33r ») ; aucun camp de la carte ne finit par une minuscule.
pub fn est_rebelle(code: &str) -> bool {
    code.len() > 1 && code.ends_with('r')
}
/// (SPEC-POLITIQUE, module 5) Le pays d'un camp rebelle (« FRr » → « FR ») ; un autre camp est le sien.
pub fn pays_de(code: &str) -> &str {
    if est_rebelle(code) { code.trim_end_matches('r') } else { code }
}
/// (SPEC-POLITIQUE, module 5) Un camp rebelle prend la fiche de son pays (traits, caractère, culture, maisons, armée
/// type), sous son nom et sa couleur, dans les tables des camps de ce fil (FACTIONS, PROVINCES, MAISON_NOMS) : le moteur
/// le lit comme les autres. Sans « moyens » : son minimum garanti est celui d'un petit camp. Refait à chaque chargement.
pub fn inscrire_rebelle(code: &str, nom: &str, couleur: &str) {
    let f = FACTIONS().at(pays_de(code)).copy();
    f.pop("moyens");
    for (k, v) in [("name", nom), ("short", nom), ("color", couleur)] {
        f.set(k, v);
    }
    FACTIONS().set(code, f);
    PROVINCES().set(code, dict!{"name" => nom, "title" => nom});
    MAISON_NOMS().set(code, MAISON_NOMS().at(pays_de(code)));
}

// ------------------------------------------------------------------ tactique
py_const!(FORMATIONS, dict!{
    "ligne" => dict!{"label" => "Ligne", "desc" => "Infanterie déployée : feu nourri (+20 %), mais vulnérable aux charges de cavalerie."},
    "colonne" => dict!{"label" => "Colonne", "desc" => "Colonnes d’attaque : choc à la charge (+25 %), marche plus rapide, cible facile pour les canons."},
    "carre" => dict!{"label" => "Carré", "desc" => "Repousse la cavalerie (−65 % de dégâts), mais l’artillerie y fait des ravages ; marche lente. Le former prend un moment : surprise pendant la manœuvre, l’infanterie est très exposée aux cavaliers."},
    "tirailleurs" => dict!{"label" => "Tirailleurs", "desc" => "Ordre dispersé : moins exposé aux canons, efficace à couvert, fragile face aux cavaliers."}
});
py_const!(FORMATION_SPEED, dict!{"ligne" => 1.0, "colonne" => 1.1, "carre" => 0.6, "tirailleurs" => 0.95});
// les quatre phases d'une bataille (SPEC-BATAILLE.md) ; une embuscade commence à la fusillade
py_const!(PHASES, dict!{"escarmouche" => "Escarmouche", "canonnade" => "Canonnade", "fusillade" => "Fusillade", "charge" => "Charge"});
// poids de chaque arme (rules.ARMES) selon la phase : chacune pèse surtout dans la sienne
py_const!(PHASE_W, dict!{
    "escarmouche" => dict!{"art" => 0.2, "inf" => 0.15, "cav" => 0.1, "tir" => 1.0, "grenadiers" => 0.1},
    "canonnade" => dict!{"art" => 1.0, "inf" => 0.35, "cav" => 0.1, "tir" => 0.5, "grenadiers" => 0.3},
    "fusillade" => dict!{"art" => 0.8, "inf" => 1.0, "cav" => 0.45, "tir" => 0.8, "grenadiers" => 1.0},
    "charge" => dict!{"art" => 0.5, "inf" => 1.0, "cav" => 1.25, "tir" => 0.5, "grenadiers" => 1.4}
});
py_const!(OPEN_TERRAIN, tup!["Plaine", "Vignoble", "Lande", "Collines"]);
// résolution automatique (engine.update_battles, end_battle), recalée sur les batailles jouées sur le champ de bataille
// (banc apparié : même bataille résolue des deux façons). Comme l'IA des batailles commandées, un camp dominé cède avant
// la déroute. Hors d'une place, passé WD_LOSS de pertes (part de ses hommes) face à un ennemi plus fort (sa puissance
// sous WD_RATIO fois celle de l'ennemi), ou WD_EVEN_LOSS face à un ennemi à peine plus fort, il décroche en bon ordre.
// Le défenseur d'une place ne décroche pas : dominé, passé WD_PLACE_LOSS, il la rend. Dans ce compte, le défenseur tient
// comme s'il était WD_DEF fois plus fort (le défenseur des batailles commandées a l'avantage du terrain).
pub const WD_LOSS: f64 = 0.12; pub const WD_RATIO: f64 = 0.8; pub const WD_EVEN_LOSS: f64 = 0.19; pub const WD_PLACE_LOSS: f64 = 0.2;
pub const WD_DEF: f64 = 1.4;
// poursuite d'un vaincu rompu (part de ses hommes rattrapés, selon que le vainqueur a de la cavalerie ou non) : une armée
// presque anéantie, ou celle qui défendait une place prise ; prisonniers : part des pertes au combat du vaincu (à
// l'assaut d'une place, pris ou repoussé : PRISON_ASSAULT) et des rattrapés
pub const PURSUIT_CAV: f64 = 0.05; pub const PURSUIT_FOOT: f64 = 0.02;
pub const PRISON_LOSS: f64 = 0.07; pub const PRISON_ASSAULT: f64 = 0.2; pub const PRISON_CAUGHT: f64 = 0.15;
// usure : le vaincu, même en bon ordre, perd cette part de ses hommes en traînards pendant la retraite (désertions)
pub const LOSER_STRAGGLE: f64 = 0.05;

// ------------------------------------------------------------------ la bataille par stratégie (SPEC-BATAILLE.md)
// Cinq armes et le général. Chaque sorte de régiment est classée dans une arme (ARME_DE ; tout le reste : infanterie).
// Les grenadiers (ajout du 16/11/2026) sont l'infanterie d'élite de choc : peu nombreux et chers (UNITS), un feu de ligne
// égal à celui de l'infanterie, le choc à la charge (PHASE_W), l'assaut et la tenue d'un ouvrage (GREN_*, STRATS), un
// moral qui plie en dernier ; médiocres en harcèlement. Ce qui touche l'infanterie (fusils, manœuvres) les touche aussi.
py_const!(ARMES, dict!{"inf" => "Infanterie", "cav" => "Cavalerie", "art" => "Artillerie", "tir" => "Tirailleurs", "grenadiers" => "Grenadiers"});
py_const!(ARME_DE, dict!{"legere" => "tir", "chasseurs" => "tir", "cavalerie" => "cav", "royal_allemand" => "cav",
           "artillerie" => "art", "mitrailleuses" => "art", "grenadiers" => "grenadiers"});
// grenadiers : à l'assaut d'une position, d'une ville ou d'un fort (assaillant) ; à la défense d'un ouvrage (défenseur
// d'une position, d'une ville ou d'un fort) ; ce que les pertes du camp ôtent à leur moral, au lieu de 1
pub const GREN_ASSAUT: f64 = 1.3; pub const GREN_OUVRAGE: f64 = 1.25; pub const GREN_MORAL: f64 = 0.6;
/// L'arme d'une sorte de régiment ('milice' et les sortes inconnues : infanterie).
pub fn arme_de(typ: &str) -> &'static str {
    match typ {
        "legere" | "chasseurs" => "tir",
        "cavalerie" | "royal_allemand" => "cav",
        "artillerie" | "mitrailleuses" => "art",
        "grenadiers" => "grenadiers",
        _ => "inf",
    }
}
/// Rang d'une arme dans les tableaux de puissance (engine.update_battles) : artillerie, infanterie, cavalerie,
/// tirailleurs, grenadiers.
pub const N_ARMES: usize = 5;
pub const ARMES_RANG: [&str; N_ARMES] = ["art", "inf", "cav", "tir", "grenadiers"];
pub fn rang_arme(arme: &str) -> usize {
    ARMES_RANG.iter().position(|a| *a == arme).unwrap_or(1)
}
// une stratégie : ce qu'elle change à chaque arme (m), à ses propres pertes (pertes), les stratégies adverses qu'elle
// contre (bat : CONTRE), la découverte qu'elle exige (tech)
fn _s(nom: &str, desc: &str, m: Val, pertes: f64, bat: Val, tech: Val) -> Val {
    dict!{"label" => nom, "desc" => desc, "m" => m, "pertes" => pertes, "bat" => bat, "tech" => tech}
}
py_const!(STRATS, dict!{
    // (l'assaut frontal engage tout le monde : +10 % à chaque arme ; sans cela, hors ses deux contres, rien ne le
    // recommandait jamais : parties de contrôle du 16/11/2026)
    "frontal" => _s("Assaut frontal", "Toutes les armes ensemble, droit devant.", dict!{"inf" => 1.1, "cav" => 1.1, "art" => 1.1, "tir" => 1.1, "grenadiers" => 1.25}, 1.0,
                    list!["repli", "faubourgs"], Val::None),
    "prep" => _s("Préparation d’artillerie", "Les canons pilonnent d’abord, l’infanterie attend.", dict!{"art" => 1.45, "inf" => 0.95, "grenadiers" => 0.95}, 0.85,
                 list!["tenir", "remparts", "bastions", "carres"], Val::None),
    "debord" => _s("Débordement", "La cavalerie tourne l’ennemi, le centre est plus léger. Hors terrain ouvert, elle s’empêtre.",
                   dict!{"cav" => 1.6, "inf" => 0.9, "grenadiers" => 0.9}, 1.0, list!["embus", "feurem", "contre"], Val::None),
    "harcel" => _s("Harcèlement", "Les tirailleurs usent l’ennemi sans s’engager à fond ; on décroche au bout d’un jour.",
                   dict!{"tir" => 1.6, "inf" => 0.8, "cav" => 0.8, "grenadiers" => 0.6}, 0.6, list!["carres", "tenir"], Val::None),
    "colonnes" => _s("Attaque en colonnes", "Choc à la baïonnette en colonnes serrées.", dict!{"inf" => 1.3, "tir" => 1.1, "grenadiers" => 1.5}, 1.15,
                     list!["embus", "faubourgs"], Val::from("ordre_mixte")),
    "tenir" => _s("Tenir la ligne", "Défense ferme sur place, feu nourri, moral plus solide.", dict!{"inf" => 1.15, "grenadiers" => 1.2}, 0.8,
                  list!["frontal", "colonnes"], Val::None),
    "carres" => _s("Former les carrés", "L’infanterie se ferme à la cavalerie, mais souffre du canon.", dict!{"inf" => 1.05, "grenadiers" => 1.05}, 1.1,
                   list!["debord", "coup"], Val::None),
    "contre" => _s("Contre-attaque", "Encaisser, puis charger quand l’ennemi s’essouffle.", dict!{"cav" => 1.3, "inf" => 1.1, "grenadiers" => 1.25}, 1.1,
                   list!["prep", "harcel", "bombarder"], Val::None),
    "embus" => _s("Embuscade de tirailleurs", "Les tirailleurs attendent à couvert et fusillent de flanc.", dict!{"tir" => 1.7}, 0.9,
                  list!["frontal", "tourner"], Val::None),
    "repli" => _s("Repli en bon ordre", "Céder le terrain pour sauver l’armée : on décroche après la canonnade.",
                  dict!{"inf" => 0.6, "cav" => 0.8, "art" => 0.5, "tir" => 0.9, "grenadiers" => 0.6}, 0.45, list![], Val::None),
    "coup" => _s("Coup de main", "Cavalerie et tirailleurs enlèvent la position par surprise.", dict!{"cav" => 1.35, "tir" => 1.35, "art" => 0.6, "grenadiers" => 1.2}, 0.9,
                 list!["tenir", "embus"], Val::None),
    "bombarder" => _s("Bombarder puis monter", "Le canon écrase la position avant l’assaut.", dict!{"art" => 1.5, "grenadiers" => 1.3}, 0.9, list!["tenir", "carres"], Val::None),
    "tourner" => _s("Tourner la position", "Une partie de l’armée contourne par les flancs.", dict!{"cav" => 1.3, "inf" => 1.1, "grenadiers" => 1.1}, 1.0,
                    list!["tenir", "contre"], Val::None),
    "remparts" => _s("Tenir les remparts", "Toute la garnison sur les murs.", dict!{"inf" => 1.2, "art" => 1.1, "grenadiers" => 1.3}, 0.7,
                     list!["frontal", "colonnes", "debord"], Val::None),
    "faubourgs" => _s("Défendre les faubourgs", "Les tirailleurs se battent maison par maison.", dict!{"tir" => 1.7, "inf" => 1.05}, 0.95,
                      list!["harcel", "debord"], Val::None),
    "sortie" => _s("Faire une sortie", "Sortir des murs et bousculer les assiégeants.", dict!{"cav" => 1.5, "inf" => 1.15, "grenadiers" => 1.3}, 1.3,
                   list!["prep", "harcel"], Val::None),
    "feurem" => _s("Feu des remparts", "L’artillerie de la place répond aux batteries ennemies.", dict!{"art" => 1.6}, 0.85, list!["prep", "frontal"], Val::None),
    "bastions" => _s("Tenir les bastions", "Chaque bastion couvre ses voisins de son feu.", dict!{"inf" => 1.2, "art" => 1.25, "grenadiers" => 1.35}, 0.65,
                     list!["frontal", "colonnes", "debord"], Val::None),
    "nuit" => _s("Sortie de nuit", "Enclouer les canons ennemis à la faveur de l’obscurité.", dict!{"tir" => 1.5, "inf" => 1.1, "grenadiers" => 1.1}, 1.1, list!["prep"], Val::None),
    "bout" => _s("Tenir jusqu’au bout", "Aucune reddition : la garnison se bat jusqu’au dernier.", dict!{"inf" => 1.3, "art" => 1.1, "tir" => 1.2, "grenadiers" => 1.4}, 1.5,
                 list!["harcel", "frontal"], Val::None)
});
pub const CONTRE: f64 = 1.2;   // une stratégie qui contre celle d'en face : +20 %
py_const!(STRATS_TENACES, tup!["tenir", "remparts", "bastions", "bout"]);   // le moral y tient mieux sous les pertes
py_const!(STRATS_FLANC, tup!["debord", "tourner"]);   // la cavalerie plus nombreuse en terrain ouvert prend l'ennemi de flanc
// les situations, déduites de l'état (engine.situation), jamais choisies : rase campagne ; position (le défenseur est
// retranché : ouvrage de campagne, barricades d'une place ouverte) ; ville (place à remparts) ; fort. Les stratégies de
// l'assaillant (att) et du défenseur (def). L'avantage du défenseur n'est pas un chiffre de plus : il vient du terrain
// (geo.TERRAIN), du retranchement et des remparts, comme avant.
py_const!(SITUATIONS, {
    let (attaque, defense) = (list!["frontal", "prep", "debord", "harcel", "colonnes"], list!["tenir", "carres", "contre", "embus", "repli"]);
    dict!{
        "campagne" => dict!{"label" => "Rase campagne", "att" => "J’attaque", "def" => "Je défends",
                            "desc" => "Bataille en rase campagne : le défenseur a l’avantage du terrain.", "s_att" => &attaque, "s_def" => &defense},
        "position" => dict!{"label" => "Prise de position", "att" => "Prise de position", "def" => "Défense de position",
                            "desc" => "Le défenseur est retranché : il faut lui prendre sa position.",
                            "s_att" => list!["coup", "bombarder", "tourner", "harcel"], "s_def" => list!["tenir", "carres", "contre", "embus"]},
        "ville" => dict!{"label" => "Ville", "att" => "Attaque de ville", "def" => "Défense de ville",
                         "desc" => "Assaut d’une ville : ses remparts couvrent le défenseur.", "s_att" => &attaque,
                         "s_def" => list!["remparts", "faubourgs", "sortie", "feurem"]},
        "fort" => dict!{"label" => "Fort", "att" => "Attaque de fort", "def" => "Défense de fort",
                        "desc" => "Assaut d’un fort : ses bastions couvrent le défenseur.", "s_att" => &attaque,
                        "s_def" => list!["bastions", "feurem", "nuit", "bout"]}
    }
});
// les découvertes qui pèsent au combat, par arme (leurs effets : TECH et ARMS ; le journal de bataille les cite)
py_const!(TECH_ARME, dict!{
    "inf" => list!["baionnette", "fusil1777", "tir_rang", "feu_peloton", "ordre_mixte", "percussion", "minie", "chassepot", "gras", "lebel"],
    "cav" => list!["hussards", "cuirassiers"],
    "art" => list!["valliere", "gribeauval", "art_cheval", "valee", "lahitte", "debange", "canon75"],
    "tir" => list!["voltigeurs", "minie"],
    "grenadiers" => list!["baionnette", "fusil1777", "tir_rang", "feu_peloton", "ordre_mixte", "percussion", "minie", "chassepot", "gras", "lebel"]
});
// ce que les découvertes militaires changent à une bataille, en plus de l'armement (ARMS) et de leurs effets chiffrés
// (TECH fx). Une ligne : la découverte (tech) ; ses conditions, toutes facultatives : armes (ARMES), types (sortes de
// régiment), phase, role (0 assaillant, 1 défenseur), sit (SITUATIONS), strat (la stratégie du camp) ; ses effets : k
// (puissance), pertes (ses propres pertes), moral (ce que ses pertes ôtent à son moral), ou, pour tout le camp : evente
// (la stratégie ennemie ne le contre plus), reco (chance de la reconnaissance, possible sans cavalerie), renfort (rayon
// des renforts ×) ; t : ce qu'en disent le journal et « ce qui a pesé ». fx : la ligne joue si cet effet (TECH fx) vaut
// pour le régiment, au lieu de la seule découverte du camp : une manœuvre (MANEUVERS, REG_KEYS) ne joue que pour les
// régiments qui l'ont apprise ; la milice a celles de son camp (comme ses armes), les canons du rempart n'en profitent pas.
py_const!(TECH_BATAILLE, {
    let ouvrages = list!["position", "ville", "fort"];
    let pied = list!["inf", "tir", "grenadiers"];
    list![
        dict!{"tech" => "levee", "armes" => list!["inf"], "phase" => "charge", "k" => 1.15, "t" => "Levée en masse : infanterie +15 % à la charge"},
        dict!{"tech" => "service_mil", "moral" => 0.8, "t" => "Service militaire : le moral cède 20 % moins vite"},
        dict!{"tech" => "genie", "role" => 0, "sit" => &ouvrages, "pertes" => 0.8, "t" => "Génie : approches couvertes, pertes de l’assaillant −20 %"},
        dict!{"tech" => "retranchements", "fx" => "entrench", "armes" => &pied, "role" => 1, "sit" => &ouvrages, "k" => 1.2, "pertes" => 0.75,
              "t" => "Retranchements de campagne : défenseur +20 %, pertes −25 %"},
        dict!{"tech" => "retranchements", "fx" => "entrench", "armes" => &pied, "role" => 1, "sit" => list!["campagne"], "strat" => list!["tenir"], "pertes" => 0.8,
              "t" => "Retranchements de campagne : tranchées-abris, pertes −20 %"},
        dict!{"tech" => "melinite", "fx" => "shell", "armes" => list!["art"], "role" => 0, "sit" => &ouvrages, "k" => 1.5, "t" => "Obus à la mélinite : artillerie +50 % contre les ouvrages"},
        dict!{"tech" => "mitrailleuse", "types" => list!["mitrailleuses"], "phase" => "fusillade", "sit" => list!["campagne", "position"], "k" => 1.5,
              "t" => "Mitrailleuses : feu roulant, +50 % à la fusillade"},
        dict!{"tech" => "mitrailleuse", "types" => list!["mitrailleuses"], "role" => 0, "sit" => list!["ville", "fort"], "k" => 0.6,
              "t" => "Mitrailleuses : impuissantes contre les remparts (−40 %)"},
        dict!{"tech" => "aerostiers", "fx" => "balloon", "evente" => 1.0, "reco" => 0.2, "t" => "Aérostiers : la manœuvre ennemie est éventée"},
        dict!{"tech" => "rail_militaire", "renfort" => 2.0, "t" => "Chemins de fer militaires : renforts venus par le rail"}
    ]
});
// temps et sol (en plus du feu : WEATHER) : la charge de cavalerie s'embourbe ou glisse ; le brouillard sert les
// embuscades (attaque en embuscade ou par surprise, stratégie « embus ») et gêne la reconnaissance
pub const BOUE_CHARGE: f64 = 0.8; pub const NEIGE_CHARGE: f64 = 0.85; pub const BROUILLARD_EMBUS: f64 = 1.15;
// renforts : une armée amie libre à moins de RENFORT_KM (deux hexagones) rejoint la bataille quand la charge commence
pub const RENFORT_KM: f64 = 8.0;
// reconnaissance : chance que la stratégie ennemie annoncée soit la vraie ; base, puis la part de cavalerie (jusqu'à
// RECO_CAV pour RECO_CAV_PART de cavaliers), les hussards, un général éclaireur ; un espion dans la place : RECO_ESPION.
// Sans cavalerie ni espion : rien n'est annoncé.
pub const RECO_BASE: f64 = 0.45; pub const RECO_CAV: f64 = 0.25; pub const RECO_CAV_PART: f64 = 0.15; pub const RECO_HUSSARDS: f64 = 0.1;
pub const RECO_ECLAIREUR: f64 = 0.1; pub const RECO_ESPION: f64 = 0.85; pub const RECO_MAX: f64 = 0.9; pub const RECO_BROUILLARD: f64 = 0.2;
// poursuite choisie par le vainqueur qui a de la cavalerie : part des vaincus rattrapés (PURSUIT_CAV s'ils décrochent en
// bon ordre, le double s'ils sont rompus), au prix de la fatigue de ses hommes ; s'il tient le terrain, seuls les
// débris d'une armée rompue sont ramassés (PURSUIT_FOOT)
pub const POURSUITE_FAT: f64 = 35.0; pub const POURSUITE_FAT_MAX: f64 = 60.0;
// prises : canons (PRISE_CANONS pièces par batterie perdue par le vaincu rompu ou chassé de sa place) et drapeaux (un
// par régiment anéanti ou pris), comptés au prestige du vainqueur
pub const PRISE_CANONS: i64 = 8; pub const PRESTIGE_CANON: f64 = 0.1; pub const PRESTIGE_DRAPEAU: f64 = 0.5;
pub const VETERANS_XP: i64 = 8; pub const VETERANS_XP_VAINCU: i64 = 3;   // expérience gagnée par les régiments survivants

// ------------------------------------------------------------------ espions, impôts, fleuves
py_const!(SPY, dict!{
    "espionner" => dict!{"label" => "Espionner", "cost" => 60, "chance" => 0.8,
                      "desc" => "Révèle la garnison et les environs (14 km) pendant deux tours."},
    "saboter" => dict!{"label" => "Saboter les remparts", "cost" => 150, "chance" => 0.5,
                    "desc" => "En guerre seulement : fait perdre un niveau de fortification à la place."}
});
pub const SPY_INTEL_TOURS: i64 = 2;   // un rapport d'espion vaut pour deux tours
pub const WATER_SPEED: i64 = 30;   // km par jour en gabare (avant courant et météo)
pub const SEA_SPEED: i64 = 55;   // cabotage le long de la côte (les tempêtes immobilisent les navires)
pub const EMBARK_DAYS: f64 = 0.35;   // chargement des gabares (hommes, chevaux, canons)
pub const DISEMBARK_DAYS: f64 = 0.15;
pub const RIVER_FIRE_KM: f64 = 3.0;   // portée des canons sur les berges
pub const QUAI_LIVRES: f64 = 0.5;   // commerce fluvial d'un quai (par jour)
pub const BLOCKADE_K: f64 = 0.35;   // revenus portuaires et fluviaux sous blocus
py_const!(TAX_LABELS, list![tup![0.15, "Très légers"], tup![0.4, "Légers"], tup![0.6, "Normaux"], tup![0.85, "Lourds"], tup![1.01, "Écrasants"]]);
// douane (SPEC-MERCENAIRES.md) : tarif aux frontières de chaque camp (nom, taux)
py_const!(TARIFS, list![tup!["Libre", 0.0], tup!["Modéré", 0.1], tup!["Élevé", 0.2], tup!["Prohibitif", 0.35]]);
pub const DOUANE_VOL: f64 = 0.06;   // part du revenu brut d'un voisin que prend le commerce frontalier (comme un accord)
pub const DOUANIERS_L: f64 = 0.15;   // solde des douaniers : livres par jour et par place frontalière
pub const DOUANE_REL: f64 = 0.25;   // relations des voisins : tant par niveau de tarif et par mois

// ------------------------------------------------------------------ la marine (SPEC-EMPIRE, module 2)
// Les navires (les types que web_engine/marine.js dessine) : canons (feu d'une bordée), coque (points de coque d'un
// navire), vitesse (cases par jour, à l'échelle de SEA_SPEED), transport (hommes embarqués), équipage (hommes à
// l'abordage), cout, jours (de chantier, comme un régiment), entretien (livres par jour), port (niveau de la chaîne
// « port » exigé dans la place), tech (découverte exigée, de rules.TECHS)
fn _n(nom: &str, canons: i64, coque: i64, vitesse: i64, transport: i64, equipage: i64, cout: Val, jours: i64, entretien: f64,
      port: i64, tech: Val, desc: &str) -> Val {
    dict!{"nom" => nom, "canons" => canons, "coque" => coque, "vitesse" => vitesse, "transport" => transport, "equipage" => equipage,
          "cout" => cout, "jours" => jours, "entretien" => entretien, "port" => port, "tech" => tech, "desc" => desc}
}
py_const!(NAVIRES, dict!{
    "flute" => _n("Flûte", 8, 40, 40, 600, 60, dict!{"livres" => 300, "bois" => 80}, 20, 1.0, 1, Val::None,
                  "Navire de charge : transporte une armée, commerce aux comptoirs ; presque sans canons."),
    "corvette" => _n("Corvette", 20, 60, 55, 150, 120, dict!{"livres" => 450, "bois" => 100, "fer" => 20}, 25, 1.8, 1, Val::None,
                     "Petit navire de guerre, rapide : éclaire, escorte, fait la course."),
    "fregate" => _n("Frégate", 40, 100, 50, 250, 250, dict!{"livres" => 800, "bois" => 160, "fer" => 40}, 40, 3.5, 2, Val::None,
                    "Le navire à tout faire des escadres : assez de canons pour la ligne, assez vite pour la course."),
    "vaisseau" => _n("Vaisseau de ligne", 74, 180, 40, 400, 600, dict!{"livres" => 1500, "bois" => 300, "fer" => 80}, 60, 7.0, 3, Val::from("fonderie"),
                     "Le soixante-quatorze : deux ponts de canons, le maître des batailles en ligne."),
    "vapeur" => _n("Vapeur à roues", 6, 70, 60, 500, 80, dict!{"livres" => 700, "bois" => 60, "fer" => 80}, 30, 3.0, 2, Val::from("vapeur_fluviale"),
                   "Avance sans le vent : transports et remorquage, peu de canons."),
    "fregate_helice" => _n("Frégate à hélice", 50, 130, 65, 300, 300, dict!{"livres" => 1300, "bois" => 120, "fer" => 140}, 45, 5.0, 2, Val::from("outillage"),
                           "Voiles et machine à hélice : la frégate qui ne craint plus le calme."),
    "vaisseau_helice" => _n("Vaisseau à hélice", 90, 220, 60, 500, 700, dict!{"livres" => 2200, "bois" => 200, "fer" => 250}, 70, 9.0, 3, Val::from("lahitte"),
                            "Le Napoléon et ses frères : un vaisseau de ligne à vapeur, canons rayés."),
    "cuirasse" => _n("Cuirassé", 40, 400, 65, 200, 500, dict!{"livres" => 3000, "fer" => 500}, 80, 12.0, 3, Val::from("acier"),
                     "Coque de fer et d'acier, grosses pièces en tourelle : les boulets ricochent dessus.")
});
py_const!(NAVIRE_ORDRE, list!["flute", "corvette", "fregate", "vaisseau", "vapeur", "fregate_helice", "vaisseau_helice", "cuirasse"]);
// les stratégies d'une bataille navale (comme STRATS) : ce qu'elle change à chaque phase (m : approche, bordees, abordage),
// à ses propres pertes, les stratégies qu'elle contre (bat : CONTRE, +20 %)
fn _sn(nom: &str, desc: &str, m: Val, pertes: f64, bat: Val) -> Val {
    dict!{"label" => nom, "desc" => desc, "m" => m, "pertes" => pertes, "bat" => bat}
}
py_const!(STRATS_NAV, dict!{
    "ligne" => _sn("Ligne de file", "Les navires se suivent et canonnent bord à bord : la bataille des bordées.",
                   dict!{"bordees" => 1.25, "abordage" => 0.8}, 0.9, list!["abordage", "brulot"]),
    "couper" => _sn("Couper la ligne", "Foncer à travers la ligne ennemie pour la prendre en enfilade : risqué, décisif.",
                    dict!{"bordees" => 1.15, "abordage" => 1.2}, 1.25, list!["ligne"]),
    "abordage" => _sn("Abordage", "Grappins et sabres : on prend les navires plutôt que de les couler. Fort contre les petits.",
                      dict!{"bordees" => 0.7, "abordage" => 1.6}, 1.1, list!["demater"]),
    "demater" => _sn("Feu à démâter", "Viser la mâture : l'ennemi ralenti ne peut plus s'enfuir.",
                     dict!{"approche" => 1.3, "bordees" => 0.95}, 0.9, list!["rompre", "couper"]),
    "rompre" => _sn("Rompre le combat", "Échapper à l'ennemi : réussit selon la vitesse et le vent.",
                    dict!{"bordees" => 0.5, "abordage" => 0.4}, 0.5, list!["abordage"]),
    "brulot" => _sn("Brûlot", "Sacrifier un navire en feu lancé sur l'ennemi serré.",
                    dict!{"bordees" => 0.95, "abordage" => 0.9}, 1.0, list!["couper"])
});
py_const!(PHASES_NAV, list!["approche", "bordees", "abordage"]);
pub const PRESTIGE_NAVIRE: f64 = 0.5;   // prestige d'un navire pris (abordage)
pub const PRESTIGE_COULE: f64 = 0.2;   // … et d'un navire ennemi coulé
pub const REPARE_JOUR: f64 = 0.02;   // coque réparée par jour au port ami (+50 % par niveau de la chaîne « port » au-delà du premier)
pub const BLOCUS_CASES: f64 = 3.0;   // une flotte bloque le port dont elle est à moins de tant de cases
pub const CONTACT_MER: f64 = 2.0;   // cases : deux flottes ennemies (ou une flotte et une armée en cabotage) se rencontrent

// ------------------------------------------------------------------ le commerce maritime (SPEC-EMPIRE, module 7)
// Les denrées coloniales : nom, prix de base (livres par jour pour une unité vendue : une plantation de niveau 1 en
// produit une, chaque flûte d'un comptoir une). Le prix du mois : base × (demande / offre)^0,5, borné (DENREE_PRIX).
fn _d(nom: &str, prix: f64) -> Val {
    dict!{"nom" => nom, "prix" => prix}
}
py_const!(DENREES, dict!{
    "sucre" => _d("Sucre", 2.0), "tabac" => _d("Tabac", 1.8), "cafe" => _d("Café", 2.0), "coton" => _d("Coton", 1.6),
    "the" => _d("Thé", 2.2), "epices" => _d("Épices", 2.5), "indigo" => _d("Indigo", 1.8), "ivoire" => _d("Ivoire", 2.2),
    "fourrures" => _d("Fourrures", 1.8)
});
pub const DENREE_DEMANDE: f64 = 6.0;   // unités que le monde achète chaque mois au prix de base, pour chaque denrée
pub const DENREE_PRIX: (f64, f64) = (0.4, 2.0);   // bornes du prix (× le prix de base)
pub const PLANTATION_K: f64 = 0.5;   // une unité de plantation rapporte la moitié d'une unité de comptoir (la place a ses frais)
pub const COMPTOIR_PLACES: i64 = 3;   // flottes marchandes par comptoir
pub const COMPTOIR_FLUTES: i64 = 4;   // flûtes d'une flotte qui comptent au comptoir
pub const ROUTE_BASE: f64 = 1.0;   // livres par jour d'une route commerciale, pour chacun des deux camps…
pub const ROUTE_PART: f64 = 0.02;   // … plus tant du revenu du plus petit des deux
pub const CORSAIRE_PART: f64 = 0.5;   // part du revenu d'une route coupée que prend le corsaire
pub const CORSAIRE_PRISE: f64 = 0.4;   // chance par mois et par route pillée de prendre un marchand (une flûte) : en général dans les 2 ou 3 tours
pub const CORSAIRE_INCIDENT: f64 = 0.35;   // chance par mois d'un incident diplomatique quand le corsaire a pillé
pub const INCIDENT_REL: i64 = 15;   // relation perdue par la victime à chaque incident
pub const CASUS_BELLI_TOURS: i64 = 12;   // durée du casus belli offert par un incident

// ------------------------------------------------------------------ (SPEC-POLITIQUE, module 6) diplomatie profonde
// Le caractère d'un camp (factions[c].caractere, engine/memoire.rs) : guerre (envie de guerre ×), paix / alliance /
// commerce (points ajoutés au score d'acceptation), fidelite (0 à 1 : répondre aux appels aux armes), argent (valeur
// de l'argent et des tributs reçus ×), region (valeur des régions reçues ×), menace (points : céder à un ultimatum),
// rancune (poids des mauvais souvenirs ×).
fn _car(nom: &str, desc: &str, v: [f64; 9]) -> Val {
    dict!{"nom" => nom, "desc" => desc, "guerre" => v[0], "paix" => v[1], "alliance" => v[2], "commerce" => v[3],
          "fidelite" => v[4], "argent" => v[5], "region" => v[6], "menace" => v[7], "rancune" => v[8]}
}
py_const!(CARACTERES, dict!{
    //                                                                          guerre paix  all.  com.  fid.  arg.  rég.  men.  ranc.
    "agressif" => _car("Agressif", "Prompt à la guerre, sourd aux menaces, rancunier.", [1.4, -10.0, 0.0, -5.0, 0.5, 1.0, 1.1, -15.0, 1.3]),
    "expansionniste" => _car("Expansionniste", "Veut des terres : une région vaut cher à ses yeux.", [1.2, -5.0, 0.0, 0.0, 0.5, 0.9, 1.6, -5.0, 1.0]),
    "marchand" => _car("Marchand", "Préfère le commerce à la guerre ; l'argent le convainc.", [0.7, 10.0, 0.0, 20.0, 0.5, 1.3, 1.0, 5.0, 0.8]),
    "prudent" => _car("Prudent", "Évite la guerre, cède devant plus fort, se lie peu.", [0.6, 15.0, -5.0, 5.0, 0.6, 1.0, 1.0, 15.0, 1.0]),
    "loyal" => _car("Loyal", "Honore ses alliances et n'oublie ni l'aide ni la trahison.", [0.9, 0.0, 10.0, 5.0, 0.95, 1.0, 1.0, -10.0, 1.5]),
    "opportuniste" => _car("Opportuniste", "Suit son intérêt du moment ; ses alliances pèsent peu.", [1.1, 5.0, -5.0, 5.0, 0.3, 1.2, 1.2, 10.0, 0.7])
});
// le caractère que l'histoire prête à certains pays (un bonus au tirage, pas une certitude)
pub const CARACTERE_HISTOIRE: &[(&str, &str)] = &[
    ("GB", "marchand"), ("NL", "marchand"), ("VE", "marchand"), ("GE", "marchand"), ("AGB", "marchand"), ("ANL", "marchand"),
    ("ICY", "marchand"), ("PR", "agressif"), ("CR", "agressif"), ("AL", "agressif"), ("IAF", "agressif"), ("IMA", "agressif"),
    ("APL", "agressif"), ("RU", "expansionniste"), ("FR", "expansionniste"), ("OT", "expansionniste"), ("ATC", "expansionniste"),
    ("CH", "prudent"), ("DK", "prudent"), ("PO", "prudent"), ("AU", "prudent"), ("PT", "loyal"), ("ES", "loyal"), ("HA", "loyal"),
    ("AFR", "loyal"), ("SA", "opportuniste"), ("BA", "opportuniste"), ("IMO", "opportuniste"), ("SX", "opportuniste"),
];
pub const CARACTERE_HISTOIRE_BONUS: f64 = 0.3;
// la mémoire (engine/memoire.rs) : {fait: {texte, poids, demi_vie (jours)}} ; le poids s'efface de moitié à chaque demi-vie
fn _fait(texte: &str, poids: f64, demi_vie: f64) -> Val {
    dict!{"texte" => texte, "poids" => poids, "demi_vie" => demi_vie}
}
py_const!(MEMOIRE, dict!{
    "guerre" => _fait("Nous a déclaré la guerre", -30.0, 1095.0),
    "trahison" => _fait("A rompu notre alliance", -45.0, 1825.0),
    "accord_rompu" => _fait("A dénoncé un accord", -15.0, 730.0),
    "aide" => _fait("A combattu à nos côtés", 25.0, 1095.0),
    "appel_refuse" => _fait("A refusé notre appel aux armes", -30.0, 1460.0),
    "cadeau" => _fait("Nous a fait des présents", 10.0, 365.0),
    "commerce" => _fait("Accord commercial signé", 8.0, 730.0),
    "accord" => _fait("Accord conclu", 10.0, 730.0),
    "mariage" => _fait("Mariage entre nos maisons", 15.0, 3650.0),
    "ultimatum" => _fait("Nous a adressé un ultimatum", -25.0, 1460.0),
    "incident" => _fait("Incident (corsaires, espions)", -15.0, 730.0),
    "tribut_impaye" => _fait("N'a pas payé son tribut", -15.0, 730.0),
    "independance_refusee" => _fait("Nous a refusé l'indépendance", -20.0, 1460.0)
});
pub const MEMOIRE_MAX: i64 = 12;   // faits gardés par paire de camps (les plus anciens s'en vont)
pub const MEMOIRE_FUSION: f64 = 30.0;   // jours : un même fait répété dans ce délai s'ajoute au précédent (au plus le double du poids)
pub const ATT_REGIME: f64 = 10.0;   // attitude : même régime (module 5) ; des régimes différents : −ATT_REGIME / 2
pub const ATT_DIPLOMATE: f64 = 10.0;   // attitude : un diplomate de l'autre camp à notre cour (module 4)
pub const DIPLOMATE_BONUS: f64 = 10.0;   // points d'acceptation qu'apporte un diplomate présent (paix, alliance, commerce…)
pub const DIPLOMATE_K: f64 = 0.15;   // … et la part de ce qu'on cède qu'il fait oublier (propositions composées)
// les clauses d'une proposition composée ({cmd: "diplo", sub: "proposer", clauses: {donner: [...], recevoir: [...]}}) :
// champs attendus ; mutuelle : la clause lie les deux camps, de quelque côté qu'elle soit
fn _clause(nom: &str, desc: &str, champs: Val, mutuelle: bool) -> Val {
    dict!{"nom" => nom, "desc" => desc, "champs" => champs, "mutuelle" => mutuelle}
}
py_const!(CLAUSES, dict!{
    "region" => _clause("Région", "Une place (pas la capitale) change de maître.", list!["node"], false),
    "technologie" => _clause("Technologie", "Une technologie connue de l'un, dont l'autre a les prérequis.", list!["tech"], false),
    "argent" => _clause("Argent", "Des livres versées tout de suite.", list!["montant"], false),
    "tribut" => _clause("Tribut", "Des livres versées à chaque tour pendant N tours.", list!["montant", "tours"], false),
    "passage" => _clause("Droit de passage", "Les armées de l'autre traversent nos terres.", list![], false),
    "commerce" => _clause("Accord commercial", "Commerce entre les deux camps.", list![], true),
    "alliance" => _clause("Alliance", "Alliance entre les deux camps.", list![], true),
    "paix" => _clause("Paix", "Fin de la guerre et trêve.", list![], true),
    "protectorat" => _clause("Protectorat", "Celui qui donne passe sous la protection de l'autre : tribut, guerres communes, plus de diplomatie propre.", list![], false),
    "independance" => _clause("Indépendance", "Le protecteur rend sa liberté à son protectorat.", list![], false),
    "cartes" => _clause("Cartes", "Les cartes de nos places : l'autre les voit quelques tours.", list![], false)
});
pub const CLAUSES_MAX: usize = 8;   // clauses de chaque côté
pub const TRIBUT_TOURS_MAX: i64 = 60;
pub const CARTES_TOURS: i64 = 6;   // ce que montrent les cartes données
pub const ULTIMATUM_RAPPORT: f64 = 1.5;   // une IA ne cède à un ultimatum que devant un camp au moins 1,5 fois plus fort
pub const ULTIMATUM_CD: f64 = 365.0;   // jours entre deux ultimatums d'une IA au même camp


pub fn tax_label(v: f64) -> String {
    for (lim, lab) in TAX_LABELS().iter().map(|t| t.pair()) {
        if v < lim.f() {
            return lab.string();
        }
    }
    TAX_LABELS().at(-1).at(1).string()
}


/// Toutes les constantes publiques du module, dans l'ordre du fichier (pour les essais contre le jumeau).
pub fn constantes() -> Vec<(&'static str, Val)> {
    vec![
        ("RESOURCES", RESOURCES()), ("RES_LABEL", RES_LABEL()), ("FACTIONS", FACTIONS()), ("FLOOR", FLOOR()),
        ("WORKSHOP_RESERVE", WORKSHOP_RESERVE()), ("MARKET_BASE", MARKET_BASE()), ("NEUTRAL", Val::from(NEUTRAL)),
        ("NEUTRAL_COLOR", Val::from(NEUTRAL_COLOR)), ("REPL_ARMES", Val::from(REPL_ARMES)), ("REPL_ARMY", Val::from(REPL_ARMY)),
        ("REPL_MONTE", Val::from(REPL_MONTE)), ("UNITS", UNITS()), ("MERC_MAX", Val::from(MERC_MAX)), ("MERCS", MERCS()),
        ("UNIT_ORDER", UNIT_ORDER()), ("UNIT_CLS", UNIT_CLS()), ("LIGHT_UNITS", LIGHT_UNITS()), ("READY", READY()),
        ("POP_NATURAL", Val::from(POP_NATURAL)), ("POP_PER_LEVEL", Val::from(POP_PER_LEVEL)), ("DEV_PROD", Val::from(DEV_PROD)),
        ("POP_RATE", Val::from(POP_RATE)), ("DEV_NAMES", DEV_NAMES()), ("DEPOT_KM", Val::from(DEPOT_KM)), ("DEPOT_FOOD", Val::from(DEPOT_FOOD)),
        ("PRISONER_FOOD", Val::from(PRISONER_FOOD)), ("PRISONER_RANSOM", Val::from(PRISONER_RANSOM)), ("GENERAL_RANCON", GENERAL_RANCON()),
        ("SAPEUR_SIEGE", Val::from(SAPEUR_SIEGE)), ("PROPOSAL_TOURS", Val::from(PROPOSAL_TOURS)), ("PEACE_TRUCE", Val::from(PEACE_TRUCE)),
        ("GARDE_HOME", Val::from(GARDE_HOME)), ("MILICE_POWER", Val::from(MILICE_POWER)), ("NODE_BASE", NODE_BASE()), ("SPEC", SPEC()),
        ("SPECIALTY", SPECIALTY()), ("SPECIALTY_CAPITAL", Val::from(SPECIALTY_CAPITAL)), ("VIN_KINDS", VIN_KINDS()),
        ("FORT_MAX", Val::from(FORT_MAX)), ("FORT_GUNS_AUTO", Val::from(FORT_GUNS_AUTO)), ("BASTION_LEVEL", Val::from(BASTION_LEVEL)),
        ("DEG_PROD", Val::from(DEG_PROD)), ("DEG_SIEGE", Val::from(DEG_SIEGE)), ("DEG_ASSAUT", Val::from(DEG_ASSAUT)),
        ("REPAR_TOURS", Val::from(REPAR_TOURS)), ("REPAR_COST", REPAR_COST()), ("BASTION_TYPES", BASTION_TYPES()), ("FORT_UPKEEP", FORT_UPKEEP()),
        ("FORT_NAMES", FORT_NAMES()), ("BUILD", BUILD()), ("TECHS", TECHS()), ("TECH", TECH()), ("MILITAIRE_INF", MILITAIRE_INF()),
        ("BRANCHES", BRANCHES()), ("REQ_PLUS", REQ_PLUS()), ("BRANCH_YEARS", Val::from(BRANCH_YEARS)), ("TASTE_BRANCHES", TASTE_BRANCHES()),
        ("VISUALS", VISUALS()), ("NOTABLE_TECHS", NOTABLE_TECHS()), ("SEASONS", SEASONS()), ("SEASON_LABEL", SEASON_LABEL()),
        ("SEASON_FOOD", SEASON_FOOD()), ("SEASON_ROAD", SEASON_ROAD()), ("SEASON_OFF", SEASON_OFF()), ("MUD_WET", MUD_WET()),
        ("MUD_DAYS", Val::from(MUD_DAYS)), ("MUD_MOVE", Val::from(MUD_MOVE)), ("WEATHER", WEATHER()), ("WEATHER_W", WEATHER_W()), ("ZONES", ZONES()),
        ("MONTHS", MONTHS()), ("DIFFICULTY", DIFFICULTY()), ("SPEEDS", SPEEDS()), ("FAST_SPEED", Val::from(FAST_SPEED)),
        ("CAMPAIGN_END", CAMPAIGN_END()), ("DEPT_DATE", DEPT_DATE()), ("PROVINCES", PROVINCES()), ("ERAS", ERAS()), ("SCENARIOS", SCENARIOS()),
        ("TREATY_TRUCE", Val::from(TREATY_TRUCE)), ("TREATY_CRUSHED", Val::from(TREATY_CRUSHED)), ("WEARY_PER_UNRULY", Val::from(WEARY_PER_UNRULY)),
        ("REVIVE_YEARS", Val::from(REVIVE_YEARS)), ("WAR_PACE", Val::from(WAR_PACE)), ("WAR_REST", Val::from(WAR_REST)),
        ("TREATY_CONGRESS", Val::from(TREATY_CONGRESS)), ("TREATY_AGAIN", Val::from(TREATY_AGAIN)), ("ASSIM_YEARS", Val::from(ASSIM_YEARS)),
        ("WEARY_PER_WAR", Val::from(WEARY_PER_WAR)), ("WEARY_PER_LOSS", Val::from(WEARY_PER_LOSS)), ("WEARY_PEACE", Val::from(WEARY_PEACE)),
        ("STRIKE_STAB", Val::from(STRIKE_STAB)), ("POP_ERA", POP_ERA()), ("POP_WHY", POP_WHY()), ("POP_CURVES", POP_CURVES()),
        ("POP_PLACE", POP_PLACE()), ("POP_TREND_K", Val::from(POP_TREND_K)), ("POP_EXCESS", Val::from(POP_EXCESS)),
        ("POP_SIEGE", Val::from(POP_SIEGE)), ("POP_FAMINE", Val::from(POP_FAMINE)), ("POP_UNREST", Val::from(POP_UNREST)),
        ("POP_UNREST_RATE", Val::from(POP_UNREST_RATE)), ("POP_SACK", Val::from(POP_SACK)), ("POP_SACK_FORT", Val::from(POP_SACK_FORT)),
        ("POP_REFUGE", Val::from(POP_REFUGE)), ("POP_FLOOR", Val::from(POP_FLOOR)), ("POP_FLOOR_SIEGE", Val::from(POP_FLOOR_SIEGE)),
        ("POP_RETURN", Val::from(POP_RETURN)), ("POP_SAFE_STAB", Val::from(POP_SAFE_STAB)), ("TECH_YEAR", TECH_YEAR()), ("UNIT_YEAR", UNIT_YEAR()),
        ("UNIT_UNTIL", UNIT_UNTIL()), ("UNIT_GAP", UNIT_GAP()), ("RAIL_LINES", RAIL_LINES()), ("RAIL_KM_COST", RAIL_KM_COST()),
        ("RAIL_KM_DAYS", Val::from(RAIL_KM_DAYS)), ("RAIL_SPEED", Val::from(RAIL_SPEED)), ("RAIL_EMBARK", Val::from(RAIL_EMBARK)),
        ("RAIL_TOWN_BONUS", Val::from(RAIL_TOWN_BONUS)), ("RAIL_TOWN_MAX", Val::from(RAIL_TOWN_MAX)),
        ("RAIL_STATION_KM", Val::from(RAIL_STATION_KM)), ("RAIL_STATION_DRAIN", Val::from(RAIL_STATION_DRAIN)),
        ("RAIL_CUT_TOURS", Val::from(RAIL_CUT_TOURS)), ("ARMS", ARMS()), ("REARM", REARM()), ("MANEUVERS", MANEUVERS()), ("REG_KEYS", REG_KEYS()),
        ("MAN_COST", Val::from(MAN_COST)), ("MAN_DAYS", Val::from(MAN_DAYS)), ("UNIT_NAMES", UNIT_NAMES()), ("GENERAL_TRAITS", GENERAL_TRAITS()),
        ("GENERAL_RANKS", GENERAL_RANKS()), ("GENERAL_XP", GENERAL_XP()), ("GENERAL_RISQUES", GENERAL_RISQUES()),
        ("GENERAL_RISQUE_TRAIT", GENERAL_RISQUE_TRAIT()), ("BLESSURE_MOIS", BLESSURE_MOIS()), ("GENERAL_TALENTS", GENERAL_TALENTS()),
        ("MEDAILLES", MEDAILLES()), ("MEDAILLE_MORAL", Val::from(MEDAILLE_MORAL)), ("RESERVE_MAX", Val::from(RESERVE_MAX)),
        ("MARECHAL_VICTOIRES", Val::from(MARECHAL_VICTOIRES)), ("GENERAL_FAVORITE", GENERAL_FAVORITE()), ("SURNAMES", SURNAMES()),
        ("MAISON_NOMS", MAISON_NOMS()), ("PRENOMS", PRENOMS()), ("PRENOMS_F", PRENOMS_F()), ("MAISON_TITRES", MAISON_TITRES()),
        ("MAISON_TRAITS", MAISON_TRAITS()), ("MARIAGE_REL", Val::from(MARIAGE_REL)), ("MARIAGE_AGE", Val::from(MARIAGE_AGE)),
        ("NAISSANCE_P", Val::from(NAISSANCE_P)), ("NAISSANCE_AGE", Val::from(NAISSANCE_AGE)), ("HERITIERS_MAX", Val::from(HERITIERS_MAX)),
        ("CRISE_JOURS", Val::from(CRISE_JOURS)), ("PARJURE_JOURS", Val::from(PARJURE_JOURS)), ("FORMATIONS", FORMATIONS()),
        ("FORMATION_SPEED", FORMATION_SPEED()), ("PHASES", PHASES()), ("PHASE_W", PHASE_W()), ("OPEN_TERRAIN", OPEN_TERRAIN()),
        ("WD_LOSS", Val::from(WD_LOSS)), ("WD_RATIO", Val::from(WD_RATIO)), ("WD_EVEN_LOSS", Val::from(WD_EVEN_LOSS)),
        ("WD_PLACE_LOSS", Val::from(WD_PLACE_LOSS)), ("WD_DEF", Val::from(WD_DEF)), ("PURSUIT_CAV", Val::from(PURSUIT_CAV)),
        ("PURSUIT_FOOT", Val::from(PURSUIT_FOOT)), ("PRISON_LOSS", Val::from(PRISON_LOSS)), ("PRISON_ASSAULT", Val::from(PRISON_ASSAULT)),
        ("PRISON_CAUGHT", Val::from(PRISON_CAUGHT)), ("LOSER_STRAGGLE", Val::from(LOSER_STRAGGLE)), ("ARMES", ARMES()), ("ARME_DE", ARME_DE()), ("GREN_ASSAUT", Val::from(GREN_ASSAUT)), ("GREN_OUVRAGE", Val::from(GREN_OUVRAGE)),
        ("GREN_MORAL", Val::from(GREN_MORAL)), ("STRATS", STRATS()),
        ("CONTRE", Val::from(CONTRE)), ("STRATS_TENACES", STRATS_TENACES()), ("STRATS_FLANC", STRATS_FLANC()), ("SITUATIONS", SITUATIONS()),
        ("TECH_ARME", TECH_ARME()), ("TECH_BATAILLE", TECH_BATAILLE()), ("BOUE_CHARGE", Val::from(BOUE_CHARGE)), ("NEIGE_CHARGE", Val::from(NEIGE_CHARGE)),
        ("BROUILLARD_EMBUS", Val::from(BROUILLARD_EMBUS)), ("RENFORT_KM", Val::from(RENFORT_KM)), ("RECO_BASE", Val::from(RECO_BASE)),
        ("RECO_CAV", Val::from(RECO_CAV)), ("RECO_CAV_PART", Val::from(RECO_CAV_PART)), ("RECO_HUSSARDS", Val::from(RECO_HUSSARDS)),
        ("RECO_ECLAIREUR", Val::from(RECO_ECLAIREUR)), ("RECO_ESPION", Val::from(RECO_ESPION)), ("RECO_MAX", Val::from(RECO_MAX)),
        ("RECO_BROUILLARD", Val::from(RECO_BROUILLARD)), ("POURSUITE_FAT", Val::from(POURSUITE_FAT)),
        ("POURSUITE_FAT_MAX", Val::from(POURSUITE_FAT_MAX)), ("PRISE_CANONS", Val::from(PRISE_CANONS)),
        ("PRESTIGE_CANON", Val::from(PRESTIGE_CANON)), ("PRESTIGE_DRAPEAU", Val::from(PRESTIGE_DRAPEAU)),
        ("VETERANS_XP", Val::from(VETERANS_XP)), ("VETERANS_XP_VAINCU", Val::from(VETERANS_XP_VAINCU)), ("SPY", SPY()),
        ("SPY_INTEL_TOURS", Val::from(SPY_INTEL_TOURS)), ("WATER_SPEED", Val::from(WATER_SPEED)), ("SEA_SPEED", Val::from(SEA_SPEED)),
        ("EMBARK_DAYS", Val::from(EMBARK_DAYS)), ("DISEMBARK_DAYS", Val::from(DISEMBARK_DAYS)), ("RIVER_FIRE_KM", Val::from(RIVER_FIRE_KM)),
        ("QUAI_LIVRES", Val::from(QUAI_LIVRES)), ("BLOCKADE_K", Val::from(BLOCKADE_K)), ("TAX_LABELS", TAX_LABELS()), ("TARIFS", TARIFS()),
        ("DOUANE_VOL", Val::from(DOUANE_VOL)), ("DOUANIERS_L", Val::from(DOUANIERS_L)), ("DOUANE_REL", Val::from(DOUANE_REL)),
    ]
}
