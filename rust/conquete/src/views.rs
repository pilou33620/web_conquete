//! Vues envoyées au navigateur et sauvegarde/chargement.
//! Porte game/views.py (PORTAGE.md).
//!
//! `g: &Game` : une lecture pure (un `&mut Game` s'y passe tel quel) ; `g: &mut Game` dès que la
//! fonction passe la partie à un autre module ou appelle une méthode `&mut self`. Conventions : engine/mod.rs.
#![allow(non_snake_case)]

use crate::army_actions as AA;
use crate::cities as CT;
use crate::engine::{Date, Game, SITE_DAYS};
use crate::events as EV;
use crate::familles as FM;
use crate::geo::GeoMap;
use crate::py::{self, Random, Val};
use crate::rails as RL;
use crate::rules as R;
use crate::engine::raccord as TB;
use crate::fiche as ST;
use crate::turns as TT;
use crate::{dict, list, py_const, tup};
use crate::ai::AI;
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// `round(v, n)` d'une valeur : un entier reste un entier, comme en Python (aide du portage).
fn _round_v(v: &Val, n: i32) -> Val {
    if v.is_float() { Val::from(py::round_n(v.f(), n)) } else { Val::from(v.i()) }
}

py_const!(SAVE_KEYS, list!["player", "difficulty", "seed", "t", "uid", "seq", "events", "proposals", "armies", "battles", "over",
             "flood_until", "market", "weather", "factions", "nodes", "_ai_clock", "spies", "scenario", "start_ord",
             "era_id", "pending_ev", "ev_done", "tour", "rails", "sites"]);

/// `DEFAULTS[k]()` : la valeur (neuve à chaque appel) d'une clé de SAVE_KEYS absente d'une ancienne sauvegarde.
/// (En Python, un dict de fabriques : `dict(spies=list, scenario=lambda: '1790', …)`. KeyError pour une autre clé.)
pub fn DEFAULTS(k: &str) -> Val {
    match k {
        "spies" => list![],
        "scenario" => Val::from("1790"),
        "start_ord" => Val::from(Date::new(1790, 3, 4).toordinal()),
        "era_id" => Val::None,
        "pending_ev" => list![],
        "ev_done" => Val::None,
        "tour" => Val::None,
        "rails" => dict! {},
        "sites" => list![],
        _ => panic!("KeyError: {}", py::repr_s(k)),
    }
}


/// Python : `to_dict(g)`.
/// Rend le dict de la sauvegarde. Pas de getattr en Rust : chaque clé de SAVE_KEYS se lit dans son champ
/// (`diplo` et `ais` à part, comme en Python).
// views.py, lignes 25 à 37
pub fn to_dict(g: &mut Game) -> Val {
    let d = dict! {
        "player" => &g.player, "difficulty" => &g.difficulty, "seed" => g.seed, "t" => g.t, "uid" => g.uid, "seq" => g.seq,
        "events" => &g.events, "proposals" => &g.proposals, "armies" => &g.armies, "battles" => &g.battles, "over" => &g.over,
        "flood_until" => g.flood_until, "market" => &g.market, "weather" => &g.weather, "factions" => &g.factions,
        "nodes" => &g.nodes, "_ai_clock" => &g._ai_clock, "spies" => &g.spies, "scenario" => &g.scenario,
        "start_ord" => g.start_ord, "era_id" => &g.era_id, "pending_ev" => &g.pending_ev, "ev_done" => &g.ev_done,
        "tour" => &g.tour, "rails" => &g.rails, "sites" => &g.sites
    };
    d.set("diplo", g.diplo.iter().map(|((a, b), s)| list![a, b, s]).collect::<Val>());
    let blockade = g._blockade.to_list();
    blockade.sort();
    d.set("blockade", blockade);
    // horloges des IA : sans elles, un chargement relance aussitôt leur diplomatie et leurs propositions
    let ai_state = dict! {};
    for (c, ai) in g.ais.iter() {
        let Some(ai) = ai else { continue };
        let cool: Val = ai
            .cool
            .items()
            .into_iter()
            .map(|(k, v)| {
                let e = k.to_list();
                e.push(v);
                e
            })
            .collect();
        let refused: Val = ai.refused.items().into_iter().map(|(k, v)| list![k, v]).collect();
        ai_state.set(c, dict! {"diplo_clock" => ai.diplo_clock, "cool" => cool, "spend_clock" => ai.spend_clock,
                               "tax_clock" => ai.tax_clock, "relief" => ai.relief, "refused" => refused});
    }
    d.set("ai_state", ai_state);
    d.set("version", 2);
    d.set("geo", g.geo.version); // la géographie de la partie (geo.VERSION) : une ancienne partie garde la sienne
    TB::save_into(g, &d); // réglage des batailles
    d
}

/// Complète une sauvegarde d'une version antérieure (généraux, formations, impôts…).
/// Python : `migrate(g)`.
// views.py, lignes 40 à 102
pub fn migrate(g: &mut Game) {
    for f in g.factions.values() {
        f.setdefault("tax", 0.5);
        f.setdefault("intel", dict! {});
        f.setdefault("prisoners", dict! {});
        f.setdefault("tarif", 0); // douane (SPEC-MERCENAIRES.md) : libre
        f.setdefault("douaniers", false);
    }
    for f in g.factions.values() {
        for (k, v) in dict! {"weary" => 0.0, "prestige" => 0.0, "treaties" => dict! {}, "last_war" => 0.0, "refu" => 0.0}.items() {
            f.setdefault(k, v);
        }
        // avant SPEC-ARBRE : une seule branche militaire ; sa recherche en cours va dans la branche de sa technologie
        let old = f.at("research").pop("militaire");
        for b in R::BRANCHES().iter() {
            f.at("research").setdefault(b, Val::None);
        }
        if old.truthy() {
            f.at("research").set(R::TECH().at(old.at("tech")).at("branch"), old);
        }
        if !f.atb("alive") {
            f.setdefault("dead_t", g.t);
        }
    }
    if g.ev_done.is_none() {
        // sauvegarde d'avant les événements : ce qui est déjà passé ne se rejoue pas
        let today = g.date(&Val::None).toordinal();
        g.ev_done = EV::HIST().iter().filter(|e| Date::de(&e.at("date")).toordinal() <= today).map(|e| e.at("id")).collect();
    }
    for (code, f) in g.factions.items() {
        if !f.has("maison") {
            f.set("maison", FM::nouvelle(g, code.s())); // avant les familles dirigeantes : une maison tirée au chargement
        }
    }
    for n in g.nodes.iter() {
        n.setdefault("depot", 0);
        n.setdefault("assim", 1.0);
        // anciennes sauvegardes : le développement d'alors devient une population équivalente
        n.setdefault("pop", g.geo.nodes.at(n.at("id")).atf("pop0") * (1.0 + 0.25 * n.get_or("dev", 0).f()));
        n.setdefault("ph", list![py::int_v(&n.at("pop"))]); // population des douze derniers mois : l'historique commence ici
        n.setdefault("rf", 0); // réfugiés accueillis le mois dernier
    }
    for a in g.armies.values() {
        let owner = a.ats("owner");
        if !a.getb("gen") {
            let gen = g.new_general(&owner);
            a.set("gen", gen);
        }
        let gen = a.at("gen");
        for (k, v) in dict! {"vic" => 0, "talents" => list![], "medailles" => list![], "etats" => list![]}.items() {
            gen.setdefault(k, v); // (SPEC-GENERAUX.md)
        }
        let gid = g.gid(&owner); // (l'argument de setdefault est toujours calculé)
        gen.setdefault("id", gid);
        let defauts = dict! {"fm" => "ligne", "fm_t" => -9.0, "landing" => false, "boat" => false, "rail" => false, "emb" => 0.0,
                             "des" => 0.0, "depot" => Val::None};
        for (k, v) in defauts.items() {
            a.setdefault(k, v);
        }
        for k in ["pl", "tac_auto", "rx", "_rx_bt"] {
            a.pop(k); // (réglages du champ de bataille tactique d'une ancienne sauvegarde : supprimé, SPEC-BATAILLE.md)
        }
        for r in a.at("regs").iter() {
            let cls = R::UNITS().at(r.at("type")).ats("cls");
            if R::ARMS().has(&cls) && !r.has("arm") {
                r.set("arm", g.arm_level(&owner, &cls)); // anciennes sauvegardes : armes du moment
            }
            if !r.has("man") {
                r.set("man", g.known_man(&a.at("owner"), &cls)); // avant SPEC-ARBRE : les manœuvres du camp
            }
        }
    }
    for n in g.nodes.iter() {
        for r in n.at("garrison").iter() {
            let cls = R::UNITS().at(r.at("type")).ats("cls");
            if R::ARMS().has(&cls) && !r.has("arm") {
                r.set("arm", g.arm_level(n.at("owner").s(), &cls));
            }
            if !r.has("man") {
                r.set("man", g.known_man(&n.at("owner"), &cls));
            }
        }
    }
    AA::migrate(g); // actions d'armée : droits de passage, quartiers, traversée
    CT::migrate(g); // emplacements : un magasin aux vivres existant en occupe un
    TB::migrate(g); // munitions, fatigue, mode des batailles
    TT::migrate(g); // tour par tour : les anciennes parties y passent aussi (temps réel dans le menu)
    for bt in g.battles.values() {
        bt.setdefault("mor", list![100, 100]);
        bt.setdefault("phase", "fusillade");
        bt.setdefault("landing", false);
        // avant la bataille par stratégie (SPEC-BATAILLE.md) : une bataille qui attendait le joueur, ou qu'il menait
        // sur le champ de bataille, lui demande sa stratégie ; les autres la reçoivent de leurs généraux au premier pas
        if !bt.has("sit") {
            let m = bt.get("mode");
            if m == "attente" || m == "ordres" || m == "manuel" {
                bt.set("mode", "attente");
                bt.pop("tac");
                g.engager_strategies(&bt);
            }
        }
    }
}

/// Python : `from_dict(geo, d)`.
/// d : le dict d'une sauvegarde. Err : la ValueError du Python (géographie d'une autre version), avec son message.
/// Part de `Game::__new__(geo)` ; chaque clé de SAVE_KEYS va dans son champ (DEFAULTS(k) si elle manque).
// views.py, lignes 105 à 138
pub fn from_dict(geo: Rc<GeoMap>, d: &Val) -> Result<Game, String> {
    let gv = d.get_or("geo", 1);
    if Val::from(geo.version) != gv {
        return Err(format!("sauvegarde de la géographie {gv}, carte {}", geo.version));
    }
    let mut g = Game::__new__(geo.clone());
    let v = |k: &str| if d.has(k) { d.at(k) } else { DEFAULTS(k) };
    // chaque clé de SAVE_KEYS dans son champ, dans l'ordre de SAVE_KEYS
    g.player = v("player").string();
    g.difficulty = v("difficulty").string();
    g.seed = v("seed").i();
    g.t = v("t").f();
    g.uid = v("uid").i();
    g.seq = v("seq").i();
    g.events = v("events");
    g.proposals = v("proposals");
    g.armies = v("armies");
    g.battles = v("battles");
    g.over = v("over");
    g.flood_until = v("flood_until").f();
    g.market = v("market");
    g.weather = v("weather");
    g.factions = v("factions");
    g.nodes = v("nodes");
    g._ai_clock = v("_ai_clock");
    g.spies = v("spies");
    g.scenario = v("scenario").string();
    g.start_ord = v("start_ord").i();
    g.era_id = v("era_id");
    g.pending_ev = v("pending_ev");
    g.ev_done = v("ev_done");
    g.tour = v("tour");
    g.rails = v("rails");
    g.sites = v("sites");
    g._blockade = d.get_or("blockade", list![]).to_set();
    g.diplo = d.at("diplo").iter().map(|e| ((e.ats(0), e.ats(1)), e.ats(2))).collect();
    g.rng = Random::new(g.seed + py::int(g.t * 1000.0));
    g.speed_idx = 0;
    g._dirty_income = true;
    g._last_day = py::int(g.t);
    g.y_mont = geo.xy(43.2, 0.0).1;
    g.x_cote = geo.xy(44.0, -0.95).0;
    for p in g.proposals.iter() {
        if p.getb("give") {
            p.set("give", p.at("give").to_tuple());
            p.set("get", p.at("get").to_tuple());
        }
    }
    migrate(&mut g);
    TB::load_from(&mut g, d);
    let codes: Vec<String> = g.factions.keys().iter().map(|c| c.string()).filter(|c| *c != g.player).collect();
    let mut ais = IndexMap::new();
    for c in codes {
        let ai = AI::new(&g, &c);
        ais.insert(c, Some(ai));
    }
    g.ais = ais;
    for (c, st) in d.get("ai_state").or(dict! {}).items() {
        let Some(Some(ai)) = g.ais.get_mut(c.s()) else { continue };
        ai.diplo_clock = st.get_or("diplo_clock", ai.diplo_clock).f();
        // clés de 2 ou 3 éléments
        ai.cool = Val::dict_from(
            st.get_or("cool", list![]).iter().map(|e| (e.slice(None, Some(-1)).to_tuple(), e.at(-1))).collect(),
        );
        ai.spend_clock = st.get_or("spend_clock", ai.spend_clock).f();
        ai.tax_clock = st.get_or("tax_clock", ai.tax_clock).f();
        ai.relief = st.get_or("relief", ai.relief).f();
        ai.refused = Val::dict_from(st.get_or("refused", list![]).iter().map(|e| e.pair()).collect());
    }
    for c in g.factions.keys() {
        g.recompute_mods(c.s());
    }
    g.compute_income();
    Ok(g)
}

/// Python : `rules_payload()`.
/// (b['cost'](l), b['days'](l) : R::BUILD_cost, R::BUILD_days.)
// views.py, lignes 141 à 166
pub fn rules_payload() -> Val {
    rules_payload_carte(false)
}

/// Les règles pour la page d'une carte : ses seuls camps, et les textes de son mode (géographie 5, europe : les pays,
/// « Europe, 1700 », le mot « pays » ; sinon les départements, et la réponse d'avant les pays, au caractère près).
pub fn rules_payload_carte(europe: bool) -> Val {
    let camps = Val::dict_from(R::camps(europe).into_iter().map(|c| { let f = R::FACTIONS().at(&c); (c, f) }).collect());
    let build = Val::dict_from(
        R::BUILD()
            .items()
            .into_iter()
            .map(|(k, b)| {
                let m = b.ati("max");
                let v = dict! {"name" => b.at("name"), "max" => b.at("max"), "desc" => b.at("desc"),
                               "costs" => (0..m).map(|l| R::BUILD_cost(k.s(), l)).collect::<Val>(),
                               "days" => (0..m).map(|l| R::BUILD_days(k.s(), l)).collect::<Val>()};
                (k, v)
            })
            .collect(),
    );
    let fort = dict! {"max" => R::FORT_MAX, "bastion" => R::BASTION_LEVEL, "bastion_types" => R::BASTION_TYPES(),
                      "upkeep" => R::FORT_UPKEEP(), "names" => R::FORT_NAMES()};
    let dev = dict! {"names" => R::DEV_NAMES(), "per_level" => R::POP_PER_LEVEL, "excess" => R::POP_EXCESS,
                     "unrest" => R::POP_UNREST, "why" => R::POP_WHY()};
    let scen = dict! {};
    for (k, sc) in R::SCENARIOS().items() {
        let d = Date::de(&sc.at("date"));
        let dept = d >= Date::de(&R::DEPT_DATE());
        let sc = if europe { let e = sc.copy(); e.update(&R::SCENARIOS_EUROPE().at(&k)); e } else { sc };
        let names = Val::dict_from(
            camps
                .items()
                .into_iter()
                .map(|(c, f)| {
                    let nm = if dept { f.at("name") } else { R::PROVINCES().at(&c).at("name") };
                    (c, nm)
                })
                .collect(),
        );
        scen.set(k, dict! {"title" => sc.at("title"), "campaign" => sc.at("campaign"), "intro" => sc.at("intro"),
                           "year" => d.year, "techs_before" => sc.get("techs_before"),
                           "word" => if europe { "pays" } else if dept { "département" } else { "province" }, "names" => names});
    }
    let techs: Val = R::TECH()
        .values()
        .into_iter()
        .map(|t| {
            let c = t.copy();
            c.set("year", R::TECH_YEAR().get_or(t.at("id"), 0));
            c
        })
        .collect();
    let arms = Val::dict_from(
        R::ARMS()
            .items()
            .into_iter()
            .map(|(c, l)| {
                let v: Val = l.iter().map(|x| {
                    let (t, nm, k) = x.triple();
                    list![t, nm, k]
                }).collect();
                (c, v)
            })
            .collect(),
    );
    let lbl = |d: Val, k: &str| Val::dict_from(d.items().into_iter().map(|(c, v)| (c, v.at(k))).collect());
    let (spy, cities) = (R::SPY(), CT::rules_payload());
    let (spy, cities) = if europe {
        // (géographie 5 : les distances des règles se comptent en cases, de 5 km ici ; le texte montré suit la carte)
        // (et une capitale n'est pas un chef-lieu : Vauban)
        let km = |v: &Val, k: &str| v.set(k, km_carte(v.at(k).s(), 5.0).replace("le chef-lieu", "la capitale"));
        for t in techs.iter() {
            km(&t, "desc");
        }
        km(&build.at("depot"), "desc");
        let spy = spy.deepcopy();
        km(&spy.at("espionner"), "desc");
        for c in cities.at("chains").values() {
            km(&c, "desc");
            for l in c.at("levels").iter() {
                km(&l, "txt");
                km(&l, "txtj");
            }
        }
        (spy, cities)
    } else {
        (spy, cities)
    };
    dict! {
        "factions" => camps, "units" => R::UNITS(), "unit_order" => R::UNIT_ORDER(), "techs" => techs, "fort" => fort,
        "scenarios" => scen, "scenario_order" => R::SCENARIOS().keys(), "eras" => if europe { R::ERAS_EUROPE() } else { R::ERAS() }, "unit_year" => R::UNIT_YEAR(),
        "fast_speed" => R::FAST_SPEED, "arms" => arms, "specialty" => R::SPECIALTY(),
        "specialty_capital" => R::SPECIALTY_CAPITAL, "dev" => dev, "branches" => R::BRANCHES(), "man_days" => R::MAN_DAYS,
        "deg_prod" => R::DEG_PROD, "visuals" => R::VISUALS(), "build" => build, "node_base" => R::NODE_BASE(),
        "spec" => lbl(R::SPEC(), "label"), "weather" => R::WEATHER(), "zones" => R::ZONES(), "speeds" => R::SPEEDS(),
        "res" => R::RESOURCES(), "res_label" => R::RES_LABEL(), "workshop_reserve" => R::WORKSHOP_RESERVE(),
        "difficulty" => lbl(R::DIFFICULTY(), "label"), "neutral_color" => R::NEUTRAL_COLOR,
        "seasons" => R::SEASON_LABEL(), "traits" => R::GENERAL_TRAITS(), "ranks" => R::GENERAL_RANKS(),
        "talents" => R::GENERAL_TALENTS(), "rancon" => R::GENERAL_RANCON(), "formations" => R::FORMATIONS(),
        "formation_speed" => R::FORMATION_SPEED(), "phases" => R::PHASES(), "spy" => spy,
        "spy_tours" => R::SPY_INTEL_TOURS, "tax_labels" => R::TAX_LABELS(),
        "water" => dict! {"speed" => R::WATER_SPEED, "sea" => R::SEA_SPEED, "embark" => R::EMBARK_DAYS,
                          "quai" => R::QUAI_LIVRES, "blockade" => R::BLOCKADE_K},
        "cities" => cities,
        // la bataille par stratégie (SPEC-BATAILLE.md) ; « formations » ne sert plus qu'à nommer la formation d'une armée,
        // « plans » n'a plus cours
        "armes" => R::ARMES(), "arme_de" => Val::dict_from(R::UNITS().keys().into_iter().map(|u| { let a = R::arme_de(u.s()); (u, Val::from(a)) }).collect()),
        "strats" => R::STRATS(), "situations" => R::SITUATIONS(), "contre" => R::CONTRE, "phase_w" => R::PHASE_W(),
        "tech_arme" => R::TECH_ARME(), "renfort_km" => R::RENFORT_KM,
        "poursuite" => dict! {"cav" => R::PURSUIT_CAV, "fatigue" => R::POURSUITE_FAT}
    }
}

/// Un texte de règles sur une carte dont la case vaut km_case km : les distances de la carte de campagne (« +6 km », « (14 km) »,
/// « à moins de 30 km ») sont des cases, multipliées ici. Une portée de canon (« à 3 km », La Hitte) se compte sur le champ
/// de bataille, en vrais kilomètres : elle ne change pas.
pub fn km_carte(t: &str, km_case: f64) -> String {
    let mut out = String::new();
    let mut reste = t;
    while let Some(i) = reste.find(" km") {
        let avant = &reste[..i];
        let debut = avant.trim_end_matches(|c: char| c.is_ascii_digit()).len();
        let (tete, nombre) = avant.split_at(debut);
        let campagne = !nombre.is_empty() && (tete.ends_with('+') || tete.ends_with('(') || tete.ends_with("de "));
        out.push_str(tete);
        if campagne {
            out.push_str(&py::int(nombre.parse::<f64>().unwrap() * km_case).to_string());
        } else {
            out.push_str(nombre);
        }
        out.push_str(" km");
        reste = &reste[i + 3..];
    }
    out.push_str(reste);
    out
}

/// Python : `_gen(g)`.
/// g : un général (dict) ou None. Rend sa vue (dict), ou None.
// views.py, lignes 169 à 172
pub fn _gen(g: &Val) -> Val {
    if !g.truthy() {
        return Val::None;
    }
    dict! {"id" => g.get("id"), "name" => g.at("name"), "rank" => R::GENERAL_RANKS().at(g.ati("lvl") - 1), "trait" => g.at("trait"),
           "lvl" => g.at("lvl"), "xp" => _round_v(&g.at("xp"), 1), "vic" => g.get_or("vic", 0),
           "talents" => g.get_or("talents", list![]), "medailles" => g.get_or("medailles", list![]),
           "etats" => g.get_or("etats", list![]), "promo" => g.get("promo")}
}

/// Effets des événements encore actifs, en clair.
/// Python : `_effects(g, f)`.
/// f : un camp. Rend une liste de textes.
// views.py, lignes 175 à 189
pub fn _effects(g: &Game, f: &Val) -> Val {
    let out = list![];
    let signe = |v: &Val| format!("{}{}", if *v > 0 { "+" } else { "−" }, v.abs());
    for e in f.get_or("tmods", list![]).iter() {
        if e.atf("until") > g.t {
            let v = EV::tmod_value(&e, &f.at("mods"));
            if v == 0.0 {
                continue; // (entièrement levé par une technologie : le blocus avec la betterave)
            }
            // (tmod_value rend e['v'] lui-même, entier ou non, sauf s'il l'atténue)
            let raw = e.at("v");
            let vv = if raw < 0 && EV::ATTENUE().has(e.get("ev")) { Val::from(v) } else { raw };
            let val = if EV::ABS_MODS().has(e.at("k")) { signe(&vv) } else { EV::_pct(v) };
            out.push(format!("{} {} jusqu'au {}", EV::MOD_LABEL().get_or(e.at("k"), e.at("k")), val, g.date_str(&e.at("until"))));
        }
    }
    for (k, v) in f.get_or("emods", dict! {}).items() {
        if v.truthy() {
            let val = if EV::ABS_MODS().has(&k) { signe(&v) } else { EV::_pct(v.f()) };
            out.push(format!("{} {} (durable)", EV::MOD_LABEL().get_or(&k, &k), val));
        }
    }
    out
}

/// « Moderniser » (SPEC-ARBRE.md) : prix, ce qui change (armes : [de, vers, régiments], manœuvres : [nom,
/// régiments]) et jours d'exercice qui restent ; None si rien à faire.
/// Python : `_modern(g, code, regs)`.
/// regs : une liste de régiments. Rend dict(c, n, arms, man, dr), ou None.
// views.py, lignes 192 à 212
pub fn _modern(g: &Game, code: &str, regs: &Val) -> Val {
    let (arms, man) = (dict! {}, dict! {});
    let mut n = 0i64;
    for r in regs.iter() {
        let lag = if r.getb("drill") { list![] } else { g.reg_lag(code, &r) };
        if !lag.truthy() {
            continue;
        }
        n += 1;
        let cls = R::UNITS().at(r.at("type")).ats("cls");
        if lag.iter().any(|t| !R::MANEUVERS().has(&t)) {
            let l = R::ARMS().at(&cls);
            let k = tup![l.at(r.get_or("arm", 0)).at(1), l.at(g.arm_level(code, &cls)).at(1)];
            arms.set(&k, &arms.get_or(&k, 0) + &Val::from(1));
        }
        for t in lag.iter() {
            if R::MANEUVERS().has(&t) {
                man.set(&t, &man.get_or(&t, 0) + &Val::from(1));
            }
        }
    }
    let mut left: Option<f64> = None;
    for r in regs.iter() {
        if r.getb("drill") {
            let x = r.at("drill").atf("t") - g.t;
            if left.map_or(true, |l| x > l) {
                left = Some(x);
            }
        }
    }
    let left = left.unwrap_or(0.0);
    if n == 0 && left <= 0.0 {
        return Val::None;
    }
    dict! {"c" => g.modernize_cost(code, regs), "n" => n,
           "arms" => arms.items().into_iter().map(|(k, c)| list![k.at(0), k.at(1), c]).collect::<Val>(),
           "man" => man.items().into_iter().map(|(t, c)| list![R::TECH().at(&t).at("name"), c]).collect::<Val>(),
           "dr" => (if left > 0.0 { left } else { 0.0 }).ceil() as i64}
}

/// Technologies de combat d'un régiment, comme en bataille : la fiche les compte.
/// Python : `_tech(g, code, r)`.
/// Rend un dict {effet: valeur}.
// views.py, lignes 215 à 218
pub fn _tech(g: &Game, code: &str, r: &Val) -> Val {
    let md = g.reg_mods(code, r, &Val::None);
    Val::dict_from(ST::TECH_MODS().iter().filter(|k| md.getb(k)).map(|k| (k.clone(), md.at(&k))).collect())
}

/// 2 : à l'exercice ; 1 : à moderniser (armes ou manœuvres) ; 0 : à jour.
/// Python : `_lag(g, code, r)`.
// views.py, lignes 221 à 223
pub fn _lag(g: &Game, code: &str, r: &Val) -> i64 {
    if r.getb("drill") {
        2
    } else if g.reg_lag(code, r).truthy() {
        1
    } else {
        0
    }
}

/// … munitions (%), fatigue, portée efficace (m), valeurs chiffrées (fiche.rs)
/// Python : `_reg(r, trait=None, swift=0.0, mods=None, lag=0)`.
/// trait_ (`trait` en Python, mot réservé) : le trait du général, ou None ; mods : un dict, ou None. Rend une liste.
// views.py, lignes 226 à 230
pub fn _reg(r: &Val, trait_: &Val, swift: f64, mods: &Val, lag: i64) -> Val {
    list![r.at("id"), r.at("type"), py::round(r.atf("n")), r.at("max"), py::round(r.atf("xp")), py::round(r.atf("morale")),
          r.get("arm"), py::round(r.get_or("ammo", 100.0).f()), py::round(r.get_or("fat", 0.0).f()), ST::ranges(r).0,
          ST::stats(r.at("type").s(), &r.get("arm").or(0), r.atf("xp"), trait_, false, swift, mods), r.get_or("man", list![]), lag]
}

/// Python : `_legs(a)`.
/// Rend une liste de dict.
// views.py, lignes 233 à 240
pub fn _legs(a: &Val) -> Val {
    let out = list![];
    for leg in a.at("path").iter() {
        if leg.at("kind") == "road" {
            let d = dict! {"e" => leg.at("e"), "frm" => leg.at("frm"), "to" => leg.at("to"), "pos" => _round_v(&leg.at("pos"), 2)};
            if leg.getb("rail") {
                d.set("r", 1);
            }
            out.push(d);
        } else {
            let i = leg.ati("i") - 1;
            let pts: Val = leg
                .at("pts")
                .slice(Some(if i > 0 { i } else { 0 }), None)
                .iter()
                .map(|p| list![_round_v(&p.at(0), 2), _round_v(&p.at(1), 2)])
                .collect();
            out.push(dict! {"pts" => pts});
        }
    }
    out
}

/// seen(x, y) : le point est-il à portée d'une des sources de vision (sx, sy, r) ? Même réponse que le parcours
/// de toutes les sources, mais on ne regarde que celles dont le carré de portée (élargi d'1 km) touche la case du
/// point : la vue interroge ainsi plus de 200 lieux sans tout reparcourir.
/// Python : `_seer(srcs, cell=20.0)`.
/// srcs : la liste des sources de vision, des tuples (x, y, rayon).
// views.py, lignes 243 à 270
pub fn _seer(srcs: &Val, cell: f64) -> Box<dyn Fn(f64, f64) -> bool> {
    let all: Vec<(f64, f64, f64)> = srcs.iter().map(|s| (s.atf(0), s.atf(1), s.atf(2))).collect();
    let mut grid: HashMap<(i64, i64), Vec<(f64, f64, f64)>> = HashMap::new();
    let mut always = vec![];
    for &(sx, sy, r) in &all {
        let ext = r.abs() + 1.0;
        if !(sx.is_finite() && sy.is_finite() && ext.is_finite()) || ext > 400.0 {
            always.push((sx, sy, r));
            continue;
        }
        for i in ((sx - ext) / cell).floor() as i64..=((sx + ext) / cell).floor() as i64 {
            for j in ((sy - ext) / cell).floor() as i64..=((sy + ext) / cell).floor() as i64 {
                grid.entry((i, j)).or_default().push((sx, sy, r));
            }
        }
    }
    let vu = |c: &[(f64, f64, f64)], x: f64, y: f64| c.iter().any(|&(sx, sy, r)| py::pow(sx - x, 2.0) + py::pow(sy - y, 2.0) <= r * r);
    Box::new(move |x: f64, y: f64| {
        if !(x.is_finite() && y.is_finite()) {
            return vu(&all, x, y);
        }
        if vu(&always, x, y) {
            return true;
        }
        grid.get(&((x / cell).floor() as i64, (y / cell).floor() as i64)).is_some_and(|c| vu(c, x, y))
    })
}

/// Siège en cours, en tours : br, la brèche (assaut à 0,85) ; food, ce que tiennent encore les vivres d'un blocus.
/// Python : `_siege(g, n)`.
/// Rend dict(by, dmg, occ[, food][, br]).
// views.py, lignes 273 à 284
pub fn _siege(g: &mut Game, n: &Val) -> Val {
    let s = n.at("siege");
    let d = dict! {"by" => s.at("by"), "dmg" => _round_v(&s.at("dmg"), 2), "occ" => s.getb("occupy")};
    if s.getb("blocus") {
        d.set("food", TT::tours_left(g, (&s.at("since") + &s.at("food")).f()));
    } else if !s.getb("occupy") && (s.at("by") == g.player.as_str() || n.at("owner") == g.player.as_str()) {
        // (la force d'un siège étranger reste cachée)
        let bes = g.besiegers(n);
        let rate = if bes.truthy() { g.siege_rate(n, &bes) } else { 0.0 };
        if rate > 0.0 && s.atf("dmg") < 0.85 {
            d.set("br", TT::tours_left(g, g.t + (0.85 - s.atf("dmg")) / rate));
        }
    }
    d
}

pub const LEV_DAYS: i64 = 90; // un événement local reste visible sur la carte trois mois
pub const LB_DAYS: i64 = 40; // la dernière bataille d'un camp (fêtes, deuil dans ses villes) : un tour, plus le temps que la nouvelle arrive
/// `CHOLERA_T` : l'ordinal de la date de l'événement 'cholera' de EV::HIST() (calculé une fois par fil).
pub fn CHOLERA_T() -> i64 {
    thread_local! { static T: i64 = {
        let e = EV::HIST().iter().find(|e| e.at("id") == "cholera").expect("StopIteration: pas d'événement 'cholera' dans EV::HIST()");
        Date::de(&e.at("date")).toordinal()
    }; }
    T.with(|t| *t)
}


/// Python : `player_state(g, since=0)`.
/// since : seuls les événements du journal de numéro supérieur sont envoyés. Rend la vue (dict).
// views.py, lignes 292 à 518
pub fn player_state(g: &mut Game, since: i64) -> Val {
    if g._dirty_income {
        g.compute_income();
    }
    let p = g.player.clone();
    let me = g.factions.at(&p);
    let (vis, srcs) = g.visible_armies(&p);
    let mut side: HashSet<String> = g
        .factions
        .keys()
        .into_iter()
        .map(|c| c.string())
        .filter(|c| g.friendly(&p, c) || g.factions.at(c).at("overlord") == p.as_str() || me.at("overlord") == c.as_str())
        .collect();
    side.insert(p.clone());

    let seen = _seer(&srcs, 20.0);

    let nodes = list![];
    let tr = g._pop_curves();
    let cholera = py::round(g.t - (CHOLERA_T() - g.start_ord) as f64);
    let cholera = if 0 <= cholera && cholera < LEV_DAYS && g.ev_done.or(list![]).has("cholera") { Some(cholera) } else { None };
    for n in g.nodes.iter() {
        let nid = n.ati("id");
        let owner = n.ats("owner");
        let gn = g.geo.nodes.at(nid);
        let sg = if n.atb("siege") { _siege(g, &n) } else { Val::None };
        let d = dict! {"id" => nid, "o" => &owner, "f" => n.at("fort"), "d" => n.at("dev"), "s" => _round_v(&n.at("stab"), 2),
                       "pop" => py::int(py::round_n(n.get_or("pop", 0).f(), -1)), "sg" => sg};
        d.set("pt", list![py::round_n(tr.at("rate").atf(nid) * 100.0, 1), tr.at("why").at(nid)]); // tendance : % par an et sa raison
        if g._blockade.has(nid) {
            d.set("bk", 1);
        }
        if n.getb("depot") {
            d.set("dp", 1);
        }
        if owner != R::NEUTRAL && gn.at("dept") != owner.as_str() {
            d.set("as", py::round_n(g.assim(&n), 2)); // place conquise : attachement à son nouveau maître
        }
        if side.contains(&owner) {
            d.set("m", py::round(n.atf("milice")));
            d.set("mm", py::round(n.atf("milice_max") * (1.0 + g.mod_(&owner, "milice", 0.0))));
            let sw = g.mod_(&owner, "fm_swift", 0.0);
            let sw = if sw < 0.5 { sw } else { 0.5 };
            let gar: Val = n.at("garrison").iter().map(|r| _reg(&r, &Val::None, sw, &_tech(g, &owner, &r), _lag(g, &owner, &r))).collect();
            d.set("g", gar); // (pas de général)
            d.set("gmz", _modern(g, &owner, &n.at("garrison")));
            if owner == p {
                d.set("fx", g.fort_max(&p, nid));
                d.set("pc", py::int(py::round_n(g.pop_cap(&n), -1)));
                d.set("pg", py::round_n(g.pop_growth(&n), 3));
                let ph = n.get("ph");
                let ph0 = if ph.truthy() { ph.at(0) } else { n.at("pop") };
                d.set("py", py::int(py::round_n(ph0.f(), -1))); // population il y a un an
                d.set("pm", (if ph.truthy() { ph.len() as i64 } else { 1 }) - 1); // … ou il y a tant de mois
                if n.getb("rf") {
                    d.set("rf", py::int(py::round_n(n.atf("rf"), -1)));
                }
                let (ru, rw) = (list![], dict! {});
                for u in R::UNIT_ORDER().iter() {
                    let (ok, why) = g.can_recruit(&p, nid, &u);
                    if ok {
                        ru.push(&u);
                    } else {
                        rw.set(&u, why.trim_end_matches('.'));
                    }
                }
                d.set("ru", &ru);
                d.set("rw", rw);
                // valeurs des troupes à lever : celles du régiment qui sortira d'ici (engine.new_reg + train_xp)
                let rs = dict! {};
                for u in ru.iter() {
                    let ud = R::UNITS().at(&u);
                    let cls = ud.ats("cls");
                    let arm = if R::ARMS().has(&cls) { g.arm_level(&p, &cls) } else { 0 };
                    let xp = (&ud.get_or("xp0", 0) + &CT::train_xp(g, &n)).f();
                    let sw = g.mod_(&p, "fm_swift", 0.0);
                    let mods = _tech(g, &p, &dict! {"type" => &u, "arm" => 99, "man" => R::MANEUVERS()}); // (levé avec tout)
                    rs.set(&u, ST::stats(u.s(), &Val::from(arm), xp, &Val::None, false, if sw < 0.5 { sw } else { 0.5 }, &mods));
                }
                d.set("rs", rs);
                let (q, mut cum) = (list![], 0.0);
                for qe in n.at("queue").iter() {
                    cum += qe.atf("left"); // la file avance dans l'ordre : chaque élément attend ceux d'avant
                    let tn = if n.atb("siege") { Val::None } else { Val::from(TT::ready_in(g, cum)) };
                    q.push(dict! {"kind" => qe.at("kind"), "what" => qe.at("what"), "left" => _round_v(&qe.at("left"), 1),
                                  "total" => _round_v(&qe.at("total"), 1), "lvl" => qe.get("lvl"), "tn" => tn});
                }
                d.set("q", q);
                d.update(&CT::node_view(g, &n)); // emplacements, politique, événement en attente
            }
        } else if g.intel_active(&p, nid) {
            d.set("m", py::round(n.atf("milice")));
            d.set("gm", py::round(py::sum_v(n.at("garrison").iter().map(|r| r.at("n"))).f()));
            let gar: Val = n
                .at("garrison")
                .iter()
                .map(|r| list![Val::None, r.at("type"), py::round(r.atf("n")), r.at("max"), 0, py::round(r.atf("morale"))])
                .collect();
            d.set("g", gar);
            d.set("intel", g.date_str(&me.at("intel").at(nid.to_string())));
        } else if seen(gn.atf("x"), gn.atf("y")) {
            d.set("m", py::round(n.atf("milice")));
            d.set("gm", py::round(py::sum_v(n.at("garrison").iter().map(|r| r.at("n"))).f()));
        }
        let spy = g.spies.iter().find(|s| s.at("by") == p.as_str() && s.at("node") == nid);
        if let Some(spy) = spy {
            d.set("spy", dict! {"kind" => spy.at("kind"), "tn" => TT::tours_left(g, spy.atf("done"))});
        }
        if n.get_or("deg", 0) >= 0.01 {
            d.set("dg", _round_v(&n.at("deg"), 2)); // dégâts de la ville (ruines visibles sur la carte, production réduite)
            if owner == p {
                if let Some((tn, c)) = g.repair_quote(&p, &n) {
                    d.set("rp", dict! {"tn" => tn, "c" => c}); // réparations : tours et prix
                }
            }
        }
        if n.getb("lev") && g.t - n.get_or("evt", -1e9).f() < LEV_DAYS as f64 {
            d.set("lv", list![n.at("lev"), py::round(g.t - n.atf("evt"))]); // événement local récent et son âge en jours
        } else if cholera.is_some() && (gn.at("type") == "ville" || gn.at("type") == "capitale") {
            d.set("lv", list!["epidemie", cholera]); // le choléra de 1832 frappe toutes les villes : la carte le montre comme une épidémie
        }
        let (gx, gy) = (gn.atf("x"), gn.atf("y"));
        let visible = || g.intel_active(&p, nid) || seen(gx, gy);
        AA::view_node(g, &n, &d, side.contains(&owner), &visible);
        nodes.push(d);
    }

    let armies = list![];
    for a in g.armies.values() {
        if !vis.has(a.at("id")) {
            continue;
        }
        let owner = a.ats("owner");
        let d = dict! {"id" => a.at("id"), "o" => &owner, "name" => a.at("name"), "x" => _round_v(&a.at("x"), 2),
                       "y" => _round_v(&a.at("y"), 2), "st" => a.at("state"), "sk" => a.at("stance"), "h" => a.at("hidden"),
                       "n" => a.at("at_node"), "men" => py::round(g.army_men(&a)), "gen" => _gen(&a.get("gen")),
                       "fm" => a.get_or("fm", "ligne"), "armes" => Game::armes_de(&a.at("regs"))}; // armes : effectifs par arme (rules.ARMES)
        if a.getb("boat") {
            d.set("boat", 1);
        }
        if a.getb("rail") {
            d.set("rail", 1); // dans un train
        }
        if a.atb("edge") {
            let ed = a.at("edge");
            let e = g.geo.edges.at(ed.at("e"));
            d.set("e", list![e.at("id"), ed.at("frm"), py::round_n(ed.atf("pos") / e.atf("len"), 4)]);
        }
        if owner == p {
            let trait_ = a.get("gen").or(dict! {}).get("trait");
            let sw = g.mod_(&owner, "fm_swift", 0.0);
            let sw = if sw < 0.5 { sw } else { 0.5 };
            let regs: Val = a.at("regs").iter().map(|r| _reg(&r, &trait_, sw, &_tech(g, &owner, &r), _lag(g, &owner, &r))).collect();
            d.set("regs", regs);
            d.set("mz", _modern(g, &p, &a.at("regs")));
            d.set("md", a.at("mode"));
            d.set("sup", _round_v(&a.at("supply"), 2));
            d.set("path", _legs(&a));
            d.set("bt", a.at("battle"));
            d.set("sp", py::round_n(g.army_speed(&a), 1));
            if g.tour.atb("on") {
                d.set("mp", py::round_n(TT::march_left(g, &a), 1)); // jours de marche qui restent ce tour
                if a.at("path").truthy() && a.at("state") == "move" {
                    d.set("eta", TT::eta(g, &a, &Val::None)); // arrivée dans tant de tours (estimation)
                }
                if a.getb("trail") {
                    d.set("trl", a.at("trail")); // trajet de la dernière marche, que le navigateur anime
                    d.set("tn", a.get_or("tn", 0));
                }
            }
            if a.get_or("emb", 0) > 0.0 {
                d.set("emb", _round_v(&a.at("emb"), 2));
            }
            if a.getb("_fire") {
                d.set("fire", 1);
            }
            d.set("des", py::int_v(&a.get_or("des", 0)));
            let wn = list![];
            for (w, on) in [("solde", me.get("banqueroute")), ("faim", me.get("famine"))] {
                if on.truthy() {
                    wn.push(w);
                }
            }
            d.set("wn", wn);
            d.set("dp", if a.get("depot").is_some() { g.geo.nodes.at(a.at("depot")).at("name") } else { Val::None });
        } else {
            // (la photographie montre aussi l'expérience, l'arme et les manœuvres de chaque régiment ; le moral reste caché)
            let intel = g.mod_(&p, "intel", 0.0) != 0.0;
            let regs: Val = a
                .at("regs")
                .iter()
                .map(|r| {
                    if intel {
                        list![Val::None, r.at("type"), py::round(r.atf("n")), r.at("max"), py::round(r.atf("xp")), 0, r.get("arm"),
                              r.get_or("man", list![])]
                    } else {
                        list![Val::None, r.at("type"), py::round(r.atf("n")), r.at("max"), 0, 0]
                    }
                })
                .collect();
            d.set("regs", regs);
        }
        AA::view_army(g, &a, &d, owner == p); // quartiers, traversée, actions possibles sur place
        armies.push(d);
    }

    let battles = list![];
    for bt in g.battles.values() {
        let involved = bt.at("sides").iter().any(|s| side.contains(s.at("owner").s()));
        if !involved && !seen(bt.atf("x"), bt.atf("y")) {
            continue;
        }
        // (SPEC-BATAILLE.md) moi : le camp du joueur (0, 1) ou None ; la stratégie ennemie reste cachée jusqu'à la fin
        let moi = g.camp_du_joueur(&bt);
        let mode = bt.get_or("mode", "auto");
        let sides = list![];
        for (i, s) in bt.at("sides").iter().enumerate() {
            let i = i as i64;
            let tac = list![];
            for aid in s.at("armies").iter() {
                let a = g.armies.get(&aid);
                if a.truthy() {
                    let k = 1.0 - g.mod_(a.at("owner").s(), "fm_swift", 0.0);
                    let reorg = g.t - a.get_or("fm_t", -9).f() < 0.1 * (if k > 0.2 { k } else { 0.2 });
                    tac.push(dict! {"id" => &aid, "name" => a.at("name"), "fm" => a.get_or("fm", "ligne"),
                                    "gen" => _gen(&a.get("gen")), "reorg" => reorg});
                }
            }
            let mix = dict! {};
            for u in g.side_units(&bt, i).iter() {
                let r = u.at(1);
                let c = Game::arm_class(r.at("type").s());
                mix.set(&c, &mix.get_or(&c, 0) + &Val::from(py::round(r.atf("n"))));
            }
            if s.at("node").is_some() {
                mix.set("milice", py::round(g.nodes.at(s.at("node")).atf("milice")));
            }
            let men = py::round(g.side_men(&bt, i));
            let lost = py::round(s.atf("lost"));
            let mor = py::round(g.side_morale(&bt, i));
            // armes : effectifs engagés par arme ; strat : sa stratégie, si le joueur la connaît (la sienne, ou celle de
            // l'ennemi une fois la bataille décidée) ; renf : les armées venues en renfort
            let connue = moi == Some(i) || (moi.is_some() && mode == "poursuite");
            sides.push(dict! {"o" => s.at("owner"), "men" => men, "lost" => lost, "mor" => mor, "armies" => s.at("armies"),
                              "tac" => tac, "mix" => mix, "armes" => g.armes_camp(&bt, i),
                              "strat" => if connue { s.get("strat") } else { Val::None }, "renf" => s.get_or("renf", list![])});
        }
        let d = dict! {"id" => bt.at("id"), "x" => _round_v(&bt.at("x"), 2), "y" => _round_v(&bt.at("y"), 2),
                            "node" => bt.at("node"), "amb" => bt.at("ambush"), "age" => py::round_n(g.t - bt.atf("t0"), 2),
                            "terrain" => bt.at("terrain"), "phase" => bt.get_or("phase", "fusillade"),
                            "land" => bt.getb("landing"), "river" => bt.get_or("river", 0), "sides" => sides,
                            "mode" => &mode, "sit" => bt.get_or("sit", "campagne"), "moi" => moi, "ouvrage" => g.ouvrage(&bt),
                            "meteo" => g.weather.at(g.zone_of(bt.atf("x"), bt.atf("y"))).at("kind"),
                            "journal" => bt.get_or("journal", list![]), "pese" => bt.get_or("pese", list![])};
        if let (Some(si), true) = (moi, mode == "attente") {
            // la bataille attend la stratégie du joueur : ses choix ({id, why} : why vide si permise), celle que son
            // général prendrait, et ce que la reconnaissance annonce de l'ennemi ({strat, p}, ou None)
            let choix: Val = g.strats_dispo(&bt, si, &p).into_iter().map(|(id, why)| dict! {"id" => id, "why" => why}).collect();
            d.set("choix", choix);
            d.set("defaut", g.choose_strategy(&bt, si));
            let reco = bt.get("reco");
            d.set("reco", if reco.truthy() { dict! {"strat" => reco.at(0), "p" => reco.at(1)} } else { Val::None });
        }
        if mode == "poursuite" {
            let fin = bt.at("fin");
            d.set("fin", dict! {"w" => fin.at(0), "repli" => fin.at(1)}); // la bataille est gagnée : poursuivre ou tenir ?
        }
        battles.push(d);
    }

    let facs = list![];
    for (code, f) in g.factions.items() {
        let code = code.string();
        let moi = code == p;
        let wars: Val = g.factions.keys().into_iter().filter(|o| *o != code.as_str() && g.at_war(&code, o.s())).collect();
        let fd = dict! {
            "code" => &code, "alive" => f.at("alive"), "nodes" => g.owned_nodes(&code).len(),
            "power" => py::int(py::round_n(g.faction_power(&code), -2)),
            "st" => if !moi { g.status(&p, &code) } else { "self".to_string() },
            "rel" => if !moi { Some(py::round(f.at("rel").get_or(&p, 0).f())) } else { None },
            "trade" => me.at("trade").getb(&code), "over" => f.at("overlord"),
            "truce" => if me.at("truce").has(&code) { Some(g.date_str(&me.at("truce").at(&code))) } else { None },
            "wars" => wars, "cap_owner" => g.nodes.at(g.capital_of(&code)).at("owner"), "techs" => f.at("techs").len(),
            "mk" => R::marks(&f.at("techs")), // marques visibles sur la carte (rules.VISUALS ; SPEC-SUITE H)
            "pr" => if !moi { py::int_v(&f.get_or("prisoners", dict! {}).get_or(&p, 0)) } else { 0 },
            "prestige" => g.prestige(&code), "weary" => py::int_v(&f.get_or("weary", 0)), "maison" => FM::vue(g, &code)
        };
        fd.update(&AA::view_passage(g, &p, &code));
        facs.push(&fd);
        let lb = f.get("lb");
        if lb.truthy() && g.t - lb.atf(1) < LB_DAYS as f64 {
            let l = list![lb.at(0), py::round(g.t - lb.atf(1))]; // dernière bataille : gagnée ?, âge en jours
            if lb.len() > 3 && (side.contains(&code) || seen(lb.atf(2), lb.atf(3))) {
                l.extend(&lb.slice(Some(2), Some(4))); // … et son lieu, d'où partent les estafettes (caché hors de vue)
            }
            fd.set("lb", l);
        }
    }

    let has_port = g.owned_nodes(&p).iter().any(|n| g.geo.nodes.at(n.at("id")).at("spec").has("port"));
    let (tb, cov) = g.tools_bonus(&p);
    let rd = |d: &Val, nd: i32| Val::dict_from(d.items().into_iter().map(|(k, v)| (k, _round_v(&v, nd))).collect());
    let research = dict! {};
    for (b, v) in me.at("research").items() {
        let x = if v.truthy() {
            let k = 1.0 + g.mod_(&p, "research_speed", 0.0) + CT::college_k(g, &p);
            dict! {"tech" => v.at("tech"), "left" => _round_v(&v.at("left"), 1), "total" => v.at("total"),
                   "tn" => TT::ready_in(g, v.atf("left") / k)}
        } else {
            Val::None
        };
        research.set(b, x);
    }
    let douane = dict! {"tarif" => me.at("tarif"), "on" => me.at("douaniers"), "niveaux" => R::TARIFS(), "cout_place" => R::DOUANIERS_L};
    douane.update(&rd(&me.get_or("_douane", dict! {}), 2));
    let pris = list![];
    for (code, f) in g.factions.items() {
        if code != p.as_str() {
            for c in f.get_or("captifs", list![]).iter() {
                if c.at("de") == p.as_str() {
                    let x = _gen(&c.at("gen"));
                    x.set("par", &code);
                    pris.push(x);
                }
            }
        }
    }
    let generaux = dict! {
        "reserve" => me.get_or("generaux", list![]).iter().map(|x| _gen(&x)).collect::<Val>(),
        "blesses" => me.get_or("blesses", list![]).iter().map(|b| {
            let x = _gen(&b.at("gen"));
            x.set("armee", b.at("armee"));
            x.set("retour", g.date_str(&b.at("gen").at("retour")));
            x
        }).collect::<Val>(),
        "captifs" => me.get_or("captifs", list![]).iter().map(|c| {
            let x = _gen(&c.at("gen"));
            x.set("de", c.at("de"));
            x
        }).collect::<Val>(),
        "pris" => pris
    };
    let mine = dict! {
        "code" => &p, "res" => rd(&me.at("res"), 1), "income" => rd(&me.at("income"), 2), "slider" => me.at("slider"),
        "research" => research, "techs" => me.at("techs"), "tech_dates" => me.get_or("tech_dates", dict! {}),
        "cov" => py::round_n(cov, 2), "tools_bonus" => py::round_n(tb, 3), "cap" => _round_v(&me.get_or("_cap", 0), 2),
        "work" => me.get_or("_work", list![1.0, Val::None]), "upkeep" => rd(&me.get_or("_upkeep", dict! {}), 2),
        "trade" => rd(&me.get_or("_trade", dict! {}), 2), "douane" => douane,
        "unit_costs" => Val::dict_from(R::UNITS().keys().into_iter().map(|u| { let c = g.unit_cost(&p, u.s()); (u, c) }).collect()),
        "unit_days" => Val::dict_from(R::UNITS().keys().into_iter().map(|u| { let d = py::round_n(g.unit_days(&p, u.s()), 1); (u, Val::from(d)) }).collect()),
        "floor" => me.get_or("_floor", dict! {}), "tax" => me.get_or("tax", 0.5), "order" => _order(g, &p),
        "spies" => g.spies.iter().filter(|s| s.at("by") == p.as_str())
            .map(|s| dict! {"node" => s.at("node"), "kind" => s.at("kind"), "tn" => TT::tours_left(g, s.atf("done"))}).collect::<Val>(),
        "has_port" => has_port, "famine" => me.getb("famine"), "banqueroute" => me.getb("banqueroute"),
        "stats" => Val::dict_from(me.at("stats").items().into_iter().map(|(k, v)| (k, Val::from(py::int_v(&v)))).collect()),
        "mods" => rd(&me.at("mods"), 3),
        "prisoners" => Val::dict_from(me.get_or("prisoners", dict! {}).items().into_iter().filter(|(_, v)| *v > 0)
            .map(|(k, v)| (k, Val::from(py::int_v(&v)))).collect()),
        // les généraux (SPEC-GENERAUX.md) : réserve, blessés (retour), captifs détenus et nos généraux captifs
        "generaux" => generaux,
        "prisoner_upkeep" => _round_v(&me.get_or("_upkeep", dict! {}).get_or("prisoners", 0), 2),
        "pop" => py::int(py::round_n(py::sum_v(g.owned_nodes(&p).iter().map(|n| n.get_or("pop", 0))).f(), -2)),
        "popy" => _popy(g, &p), "weary" => py::int_v(&me.get_or("weary", 0)), "prestige" => g.prestige(&p),
        "prestige_parts" => Val::dict_from(g.prestige_parts(&p).items().into_iter().map(|(k, v)| (k, Val::from(py::round(v.f())))).collect()),
        "glory" => py::int_v(&me.get_or("prestige", 0)),
        "arm" => Val::dict_from(R::ARMS().keys().into_iter().map(|c| { let l = g.arm_level(&p, c.s()); (c, Val::from(l)) }).collect()),
        "unames" => Val::dict_from(R::UNITS().keys().into_iter().map(|u| { let n = g.unit_name(&p, u.s()); (u, Val::from(n)) }).collect()),
        "effects" => _effects(g, &me)
    };

    let era = g.era();
    let pending: Val = g
        .pending_ev
        .iter()
        .map(|x| {
            let choices: Val = x
                .at("choices")
                .iter()
                .map(|c| dict! {"label" => c.at("label"), "desc" => c.at("desc"), "ok" => EV::affordable(g, &p, &c.at("fx"))})
                .collect();
            dict! {"id" => x.at("id"), "title" => x.at("title"), "text" => x.at("text"), "base" => x.at("base"),
                   "date" => x.at("date"), "tn" => TT::tours_left(g, x.atf("until")), "town" => x.get("town"),
                   "kind" => x.get("kind"), "choices" => choices}
        })
        .collect();
    let out = dict! {
        "t" => py::round_n(g.t, 3), "date" => g.date_str(&Val::None), "season" => g.season(), "speed" => g.speed_idx,
        "over" => &g.over, "year" => g.date(&Val::None).year, "scenario" => &g.scenario,
        "era" => dict! {"id" => era.at("id"), "name" => era.at("name"), "desc" => era.at("desc")},
        "names" => Val::dict_from(g.factions.keys().into_iter().map(|c| { let n = g.faction_name(c.s()); (c, Val::from(n)) }).collect()),
        "word" => g.dept_word(), "heg" => g.hegemon(), "pending" => pending,
        "weather" => Val::dict_from(g.weather.items().into_iter().map(|(z, w)| {
            (z, dict! {"kind" => w.at("kind"), "left" => w.at("left"), "mud" => w.get_or("mud", 0)})
        }).collect()),
        "me" => mine, "factions" => facs, "nodes" => nodes, "armies" => armies, "battles" => battles,
        "events" => g.events.iter().filter(|e| e.ati("seq") > since).collect::<Val>(), "seq" => g.seq,
        "proposals" => g.proposals.iter().map(|x| dict! {"id" => x.at("id"), "frm" => x.at("frm"), "action" => x.at("action"),
            "amount" => x.at("amount"), "give" => x.at("give"), "get" => x.at("get"), "date" => x.at("date")}).collect::<Val>(),
        "market" => dict! {"prices" => &g.market, "spread" => if has_port { list![1.15, 0.85] } else { list![1.4, 0.6] }}
    };
    out.set("settings", g.settings.copy());
    out.set("flood", g.t < g.flood_until);
    out.set("tour", TT::view(g));
    // les routes que la crue coupe (pendant la crue seulement) : [arête, début, fin] des tronçons noyés, en km
    // le long du tracé
    let cut = g.cut_edges();
    if cut.truthy() {
        let l = list![];
        for (k, spans) in cut.items() {
            for s in spans.iter() {
                let e = list![&k];
                e.extend(&s);
                l.push(e);
            }
        }
        out.set("cut", l);
    }
    // traces des batailles récentes vues du joueur : x, y, âge (jours), pertes et camps des deux côtés, vainqueur (0, 1 ;
    // None : ancienne sauvegarde), prisonniers, place (ou None), situation
    let sites = list![];
    for s in g.sites.iter() {
        if g.t - s.atf("t") < SITE_DAYS as f64 && (s.at("o").has(p.as_str()) || seen(s.atf("x"), s.atf("y"))) {
            let e = list![s.at("x"), s.at("y"), py::round(g.t - s.atf("t"))];
            e.extend(&s.at("l"));
            e.extend(&s.at("o"));
            e.push(s.get("w"));
            e.push(s.get_or("p", 0));
            e.push(s.get("n")); // la place (None en rase campagne) et la situation (SPEC-BATAILLE.md)
            e.push(s.get_or("s", "campagne"));
            sites.push(e);
        }
    }
    out.set("sites", sites);
    out.set("rails", RL::player_view(g, &p));
    out.set(
        "vis",
        srcs.iter().map(|s| list![_round_v(&s.at(0), 1), _round_v(&s.at(1), 1), _round_v(&s.at(2), 1)]).collect::<Val>(),
    );
    out
}

/// Population de vos terres, villes et campagnes à part : aujourd'hui et il y a un an (mêmes places).
/// Python : `_popy(g, p)`.
// views.py, lignes 521 à 528
pub fn _popy(g: &Game, p: &str) -> Val {
    let mine = g.owned_nodes(p);
    let towns: Val = mine.iter().filter(|n| g.geo.nodes.at(n.at("id")).at("type") != "village").collect();
    let fields: Val = mine.iter().filter(|n| g.geo.nodes.at(n.at("id")).at("type") == "village").collect();
    let rnd = |v: (f64, f64)| list![py::int(py::round_n(v.0, -1)), py::int(py::round_n(v.1, -1))];
    let months = mine.iter().map(|n| {
        let ph = n.get("ph");
        if ph.truthy() { ph.len() as i64 - 1 } else { 0 }
    }).max().unwrap_or(0);
    dict! {"all" => rnd(g.pop_year(&mine)), "towns" => rnd(g.pop_year(&towns)), "fields" => rnd(g.pop_year(&fields)), "months" => months}
}

/// Ordre public : moyenne, places agitées, places menacées de révolte.
/// Python : `_order(g, p)`.
// views.py, lignes 531 à 546
pub fn _order(g: &Game, p: &str) -> Val {
    let mine = g.owned_nodes(p);
    if !mine.truthy() {
        return dict! {"avg" => 0, "unrest" => list![], "risk" => list![], "target" => 1};
    }
    let held: Val = Val::set_from(
        g.armies.values().into_iter().filter(|a| a.at("owner") == p && a.at("at_node").is_some()).map(|a| a.at("at_node")).collect(),
    );
    let (unrest, risk) = (list![], list![]);
    for n in mine.iter() {
        if n.atf("stab") < 0.6 {
            unrest.push(list![n.at("id"), _round_v(&n.at("stab"), 2)]);
        }
        if n.atf("stab") < 0.45 && !n.atb("garrison") && !held.has(n.at("id")) && g.geo.nodes.at(n.at("id")).at("type") != "capitale" {
            risk.push(n.at("id"));
        }
    }
    let tgt = g.stab_targets().get_or(p, 1.0).f();
    let t = if tgt < 1.0 { tgt } else { 1.0 };
    unrest.sort_by_key(|u| u.at(1));
    dict! {"avg" => py::round_n(py::sum_v(mine.iter().map(|n| n.at("stab"))).f() / mine.len() as f64, 3),
           "unrest" => unrest.slice(None, Some(12)), "risk" => risk, "target" => py::round_n(if t > 0.1 { t } else { 0.1 }, 2)}
}
