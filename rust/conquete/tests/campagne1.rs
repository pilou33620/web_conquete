//! La première partie du moteur de campagne (engine/mod.rs, utilitaires.rs, economie.rs) contre Python :
//! tests/references/campagne1.json est écrit par le jumeau outils/jumeau/campagne1_ref.py. Seulement ce qui tourne
//! sans le reste de la partie (fonctions du module, méthodes qui ne lisent que des champs simples, sur une partie vide
//! dont chaque cas pose les champs) ; le reste se vérifie de bout en bout.

use conquete::engine::{self as E, Game};
use conquete::geo::GeoMap;
use conquete::py::{json, Val};
use conquete::rules as R;
use conquete::{dict, list};
use std::rc::Rc;

fn reference() -> Val {
    json::loads(include_str!("references/campagne1.json")).unwrap()
}

#[track_caller]
fn pareil(quoi: &str, vu: &Val, attendu: &Val) {
    let (a, b) = (json::dumps_ref_ordre(vu), json::dumps_ref_ordre(attendu));
    if a != b {
        let k = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
        let coupe = |s: &str| String::from_utf8_lossy(&s.as_bytes()[k.saturating_sub(120)..(k + 120).min(s.len())]).to_string();
        panic!("{quoi} : écart au caractère {k}\n vu      …{}…\n attendu …{}…", coupe(&a), coupe(&b));
    }
}

/// Une carte quelconque (aucune méthode essayée ici ne la lit) : la géographie 1, relue du cache des essais.
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(1))
}

const CODES: [&str; 5] = ["33", "24", "40", "47", "64"];

#[test]
fn fonctions_du_module() {
    let r = reference();
    for c in r.at("ordinal").iter() {
        assert_eq!(E::ordinal(c.ati(0)), c.ats(1));
    }
    for c in r.at("curve_at").iter() {
        let (v, lab) = E::curve_at(&c.at(0), c.atf(1));
        assert_eq!(v.to_bits(), c.atf(2).to_bits(), "curve_at {:?} {}", c.at(0), c.at(1));
        pareil("étiquette", &lab, &c.at(3));
    }
}

/// La partie vide du cas (les champs que le jumeau pose).
fn partie(geo: &Rc<GeoMap>, cas: &Val) -> Game {
    let mut g = Game::__new__(geo.clone());
    g.start_ord = cas.ati("start_ord");
    g.t = cas.atf("t");
    g.player = cas.ats("player");
    g.difficulty = cas.ats("difficulty");
    g.factions = cas.at("factions").deepcopy();
    g.nodes = cas.at("nodes").deepcopy();
    g.speed_idx = 4;
    g.flood_until = cas.atf("flood_until");
    for d in cas.at("diplo").iter() {
        g.diplo.insert((d.at(0).ats(0), d.at(0).ats(1)), d.ats(1));
    }
    g._dirty_income = false;
    g.weather = cas.at("weather").deepcopy();
    (g.y_mont, g.x_cote) = (300.0, 100.0);
    g
}

fn mesurer(geo: &Rc<GeoMap>, cas: &Val) -> Val {
    let mut g = partie(geo, cas);
    let n = Val::None;
    let out = dict! {};
    let d3 = |d: E::Date| list![d.year, d.month, d.day];
    out.set("date", list![d3(g.date(&n)), d3(g.date(&Val::from(17))), d3(g.date(&Val::from(400.9)))]);
    out.set("date_str", list![g.date_str(&n), g.date_str(&Val::from(0)), g.date_str(&Val::from(29.99))]);
    out.set("year", g.year());
    out.set("era", g.era().at("id"));
    out.set("pop_era", list![g.pop_era(&n), g.pop_era(&Val::from(1795)), g.pop_era(&Val::from(1850.25))]);
    out.set("season", g.season());
    out.set("departements", list![g.departements(), g.dept_word(), g.pays_de(), g.faction_name("33")]);
    out.set("flooded", g.flooded());
    let zones: Val = [(50.0, 50.0), (150.0, 50.0), (150.0, 400.0), (100.0, 300.0)]
        .iter()
        .map(|&(x, y)| list![x, y, g.zone_of(x, y), g.wx(x, y).at("food"), g.mud_k(x, y, false), g.mud_k(x, y, true)])
        .collect();
    out.set("zones", zones);
    let mut tous: Vec<&str> = CODES.to_vec();
    tous.push(R::NEUTRAL);
    let mut diplo = vec![];
    for a in &tous {
        for b in &tous {
            diplo.push(list![*a, *b, g.status(a, b), g.at_war(a, b), g.friendly(a, b), g.hostile(a, b)]);
        }
    }
    out.set("diplo", Val::list(diplo));
    g.set_status("64", "24", "guerre");
    out.set("set_status", g.diplo.iter().map(|((a, b), v)| list![list![a.as_str(), b.as_str()], v.as_str()]).collect::<Val>());
    let vn = [Val::from(0), Val::from(11), Val::from(12), Val::from(-1), Val::from(true), Val::from(3.0), Val::None, Val::from("2")];
    out.set("valid_node", vn.iter().map(|v| Val::from(g.valid_node(v))).collect::<Val>());
    let arm = list![];
    for code in CODES.iter().copied().chain(["99"]) {
        for cls in R::ARMS().keys() {
            let cls = cls.s();
            arm.push(list![
                code,
                cls,
                g.arm_level(code, cls),
                g.arm_k(code, cls, &n),
                g.arm_k(code, cls, &Val::from(2)),
                g.arm_k(code, cls, &Val::from(99))
            ]);
        }
        for cls in ["inf", "cavalerie", "artillerie"] {
            arm.push(list![code, cls, g.known_man(&Val::from(code), cls)]);
        }
        arm.push(list![code, g.milice_k(code)]);
        let noms: Val = R::UNITS().keys().iter().map(|t| {
            let (a, b) = g.unit_name(code, t.s());
            list![a, b]
        }).collect();
        arm.push(list![code, noms]);
    }
    out.set("armement", arm);
    let regs = cas.at("regs").deepcopy();
    let gen = cas.at("gen");
    let lag = list![];
    for code in ["33", "40", "99"] {
        for r in regs.iter() {
            let m0 = g.reg_mods(code, &r, &n);
            let m1 = g.reg_mods(code, &r, &gen);
            let meme = g.factions.has(code) && m0.is(&g.factions.at(code).at("mods"));
            lag.push(list![code, r.at("id"), g.reg_lag(code, &r), &m0, meme, m1]);
        }
        lag.push(list![code, g.modernize_cost(code, &regs)]);
    }
    out.set("regs", &regs);
    out.set("lag", lag);
    let cost = list![];
    for code in CODES {
        for typ in R::UNITS().keys() {
            let typ = typ.s();
            cost.push(list![code, typ, g.unit_cost(code, typ), g.unit_days(code, typ)]);
        }
        let tb = g.tools_bonus(code);
        cost.push(list![
            code,
            g.build_cost(code, &R::BUILD_cost("fort", 2)),
            g.build_days(code, 33.0),
            g.contrebande(code),
            list![tb.0, tb.1],
            g.recruit_cap(code),
            g.granary_cap(code),
            g.can_pay(code, &dict! {"livres" => 500, "outils" => 40}),
            g.can_pay(code, &dict! {"livres" => 500.5})
        ]);
    }
    out.set("couts", cost);
    g.recompute_mods("33");
    let p = g.player.clone();
    g.recompute_mods(&p);
    out.set(
        "mods",
        list![g.factions.at("33").at("mods"), g.factions.at(&p).at("mods"), g.mod_("33", "livres", 0.0), g.mod_("33", "absent", 0.0)],
    );
    out.set("owned", CODES.iter().map(|c| g.owned_nodes(c).iter().map(|n| n.at("id")).collect::<Val>()).collect::<Val>());
    let forts = list![];
    for k in 0..12i64 {
        let nd = g.nodes.at(k);
        forts.push(list![g.lose_fort_level(k), nd.at("fort"), nd.at("milice_max"), nd.at("milice")]);
        g.damage_town(&nd, cas.at("dmg").atf(k));
        forts.push(nd.at("deg"));
    }
    out.set("forts", forts);
    let rf = list![];
    for (r, add) in regs.iter().zip(cas.at("renf").iter()) {
        let ok = g.reinforce("33", &r, add.f());
        rf.push(list![ok, r.at("n"), r.at("xp"), g.factions.at("33").at("res").copy()]);
    }
    out.set("reinforce", rf);
    let rf = list![];
    for (code, add) in CODES.iter().zip(cas.at("recr").iter()) {
        rf.push(list![g.add_recrues(code, add.f()), g.factions.at(*code).at("res").at("recrues")]);
        g._granary_dirty(code);
        rf.push(g.factions.at(*code).at("_nn"));
    }
    out.set("recrues", rf);
    let regs_a: Val = [3.0, 400.0, 0.0, 6.0, 4.5].iter().enumerate()
        .map(|(i, &n)| dict! {"id" => format!("p{i}"), "type" => "ligne", "n" => n})
        .collect();
    let a = dict! {"regs" => regs_a, "morts" => list![list![0, "ligne", "old", g.t - 50.0], list![1, "legere", "recent", g.t - 1.0]]};
    g.prune(&a);
    g.prune(&a);
    out.set("prune", a);
    for k in 0..405 {
        let kw = if k % 7 == 0 {
            dict! {"x" => 1.5, "y" => 2, "who" => "33", "important" => true, "extra" => dict! {"coins" => true}}
        } else {
            dict! {}
        };
        g.log("info", &format!("message {k}"), &kw);
    }
    out.set("log", list![g.seq, g.events.len(), g.events.at(0), g.events.at(-1)]);
    g.speed_idx = 4;
    g.alert_pause(false);
    let s1 = g.speed_idx;
    g.speed_idx = 5;
    g.alert_pause(false);
    let s2 = g.speed_idx;
    g.speed_idx = 1;
    g.alert_pause(true);
    out.set("pause", list![s1, s2, g.speed_idx]);
    out
}

#[test]
fn partie_sans_le_reste() {
    let r = reference();
    let geo = geo();
    for (i, j) in r.at("jeux").iter().enumerate() {
        let vu = mesurer(&geo, &j.at("cas"));
        let attendu = j.at("vu");
        for k in attendu.keys() {
            pareil(&format!("cas {i}, {k}"), &vu.at(&k), &attendu.at(&k));
        }
        assert_eq!(vu.len(), attendu.len());
    }
}
