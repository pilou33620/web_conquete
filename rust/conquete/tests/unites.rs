//! Les unités tactiques et ce qui s'en tire (tactics/units.rs, stats.rs, orders.rs, battle/mod.rs et battle/aides.rs)
//! contre Python : tests/references/unites.json est écrit par le jumeau outils/jumeau/unites_ref.py.
//!
//! 1. Les fonctions qui ne dépendent que de leurs entrées (unités, stats, fonctions pures d'orders et de battle).
//! 2. Des batailles créées sur la vraie carte de campagne (geo.rs) : création, aides, ordres du joueur, refaits dans
//!    l'ordre du jumeau et comparés appel par appel.
#![allow(non_snake_case)]

use conquete::geo::GeoMap;
use conquete::py::json::{dumps_ref_ordre, empreinte_ordre, loads};
use conquete::py::{self, Val};
use conquete::tactics::battle::{self as BT, TacticalBattle};
use conquete::tactics::orders as OR;
use conquete::tactics::stats as ST;
use conquete::tactics::units as U;
use conquete::{list, tup};
use std::collections::HashMap;
use std::rc::Rc;

fn reference() -> Val {
    loads(include_str!("references/unites.json")).unwrap()
}

fn sha(t: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(t.as_bytes()).iter().map(|o| format!("{o:02x}")).collect()
}

/// La même valeur que le Python (forme ordonnée des références : 5 et 5.0 y sont égaux, l'ordre des clés compte).
#[track_caller]
fn meme(quoi: &str, rust: impl Into<Val>, attendu: &Val) {
    let rust = rust.into();
    assert_eq!(dumps_ref_ordre(&rust), dumps_ref_ordre(attendu), "{quoi}");
}

/// Une valeur rangée en entier (dict, liste) ou en empreinte (texte) par le jumeau.
#[track_caller]
fn meme_ou_empreinte(quoi: &str, rust: &Val, attendu: &Val) {
    if attendu.is_str() {
        assert_eq!(empreinte_ordre(rust), attendu.s(), "{quoi} (empreinte)");
    } else {
        meme(quoi, rust, attendu);
    }
}

/// La repr de Python (1 n'est pas 1.0), rangée en entier ou en SHA-256.
#[track_caller]
fn meme_repr(quoi: &str, rust: &Val, attendu: &Val) {
    let r = rust.repr();
    let a = attendu.s();
    if a.len() == 64 && !a.starts_with(['[', '{', '(']) {
        assert_eq!(sha(&r), a, "{quoi} (repr : {r})");
    } else {
        assert_eq!(r, a, "{quoi} (repr)");
    }
}

fn poser(u: &Val, s: &Val) {
    for (k, v) in s.items() {
        let v = if k == "path" { v.iter().map(|p| p.to_tuple()).collect() } else { v };
        u.set(&k, v);
    }
}

/// Une unité d'après sa recette du jumeau : [constructeur, arguments…] et, si poser, ses attributs (« set »).
fn fabrique(c: &Val, avec_set: bool) -> Val {
    let a = c.at("a");
    let u = match c.ats("f").as_str() {
        "from_reg" => U::from_reg(&a.at(0), a.ati(1), &a.at(2), a.at(3).s(), &a.at(4), a.at(5).s(), &a.at(6), a.at(7).s()),
        "milice" => U::milice(&a.at(0), a.ati(1), &a.at(2), a.atf(3), a.atf(4), a.ati(5), a.at(6).s(), &a.at(7), a.at(8).s()),
        "general" => U::general(&a.at(0), a.ati(1), &a.at(2), &a.at(3), &a.at(4), a.at(5).s()),
        "wagon" => U::wagon(&a.at(0), a.ati(1), &a.at(2), &a.at(3), a.at(4).s(), a.at(5).s()),
        _ => {
            let kw = a.at(0).copy();
            if kw.has("path") {
                kw.set("path", kw.at("path").iter().map(|p| p.to_tuple()).collect::<Val>());
            }
            U::Unit(&kw)
        }
    };
    if avec_set {
        poser(&u, &c.at("set"));
    }
    u
}

fn ids(us: &Val) -> Val {
    us.iter().map(|u| u.at("id")).collect()
}

// ====================================================================== 1. unités seules
#[test]
fn unites() {
    let r = reference();
    for (n, c) in r.at("unites").iter().enumerate() {
        let u = fabrique(&c.at("recette"), true);
        let q = |k: &str| format!("unité {n} ({}) : {k}", c.at("recette").at("a").at(0).repr());
        let d = U::to_dict(&u);
        meme_ou_empreinte(&q("to_dict"), &d, &c.at("dict"));
        meme_repr(&q("to_dict"), &d, &c.at("dict_repr"));
        let vues = list![U::view(&u, true, true), U::view(&u, true, false), U::view(&u, false, false)];
        meme_ou_empreinte(&q("view"), &vues, &c.at("vues"));
        meme_repr(&q("view"), &vues, &c.at("vues_repr"));
        meme_repr(&q("from_dict"), &U::to_dict(&U::from_dict(&d)), &c.at("rond_repr"));
        meme(&q("alive"), U::alive(&u), &c.at("alive"));
        meme(&q("valid"), U::valid(&u), &c.at("valid"));
        meme(&q("d50"), U::d50(&u), &c.at("d50"));
        let p: Val = [0.0, 30.0, 55.5, 100.0, 250.0, 1000.0].iter().map(|&x| Val::from(U::precision(&u, x))).collect();
        meme(&q("precision"), p, &c.at("precision"));
        meme(&q("bout_portant"), U::bout_portant(&u), &c.at("bout"));
        let st: Val = ["max", "bonne", "bout", "autre"].iter().map(|s| Val::from(U::stop_dist(&u, s))).collect();
        meme(&q("stop_dist"), st, &c.at("stop"));
        meme(&q("reload_time"), U::reload_time(&u), &c.at("reload"));
        meme(&q("pieces"), U::pieces(&u), &c.at("pieces"));
        let (w, dd) = U::footprint(&u);
        meme(&q("footprint"), list![w, dd], &c.at("footprint"));
        assert_eq!(U::size(&u), (w, dd));
        let (e, m, g) = U::ranges(&u);
        assert_eq!(tup![e, m, g].repr(), c.ats("ranges"), "{}", q("ranges"));
        let z = BT::fire_zones(&u);
        meme(&q("fire_zones"), &z, &c.at("zones"));
        meme_repr(&q("fire_zones"), &z, &c.at("zones_repr"));
        meme(&q("move_class"), BT::move_class(&u), &c.at("mc"));
    }
    for c in r.at("cls_of").iter() {
        assert_eq!(U::cls_of(c.at(0).s()), c.ats(1));
    }
    for c in r.at("ranges_dict").iter() {
        let (e, m, g) = U::ranges(&c.at(0));
        assert_eq!(tup![e, m, g].repr(), c.ats(1), "ranges({})", c.at(0).repr());
    }
    for c in r.at("ammo0_of").iter() {
        meme("ammo0_of", U::ammo0_of(c.at(0).s()), &c.at(1));
    }
    for c in r.at("unit_name").iter() {
        assert_eq!(U::unit_name(None, &Val::from("33"), c.at(0).s(), c.ati(1)), c.ats(2));
    }
}

#[test]
fn stats() {
    let r = reference();
    for c in r.at("stats").iter() {
        let a = c.at("a");
        let s = ST::stats(a.at(0).s(), &a.at(1), a.atf(2), &a.at(3), a.atb(4), a.atf(5), &a.at(6));
        meme(&format!("stats{}", a.repr()), &s, &c.at("r"));
        assert_eq!(s.repr(), c.ats("repr"), "stats{} (repr)", a.repr());
    }
    for c in r.at("xp_k").iter() {
        meme("xp_k", ST::xp_k(c.atf(0)), &c.at(1));
    }
    for c in r.at("power_k").iter() {
        meme("power_k", ST::power_k(&c.at(0), c.at(1).s()), &c.at(2));
        meme("charge_k", ST::charge_k(&c.at(0), c.at(1).s()), &c.at(3));
    }
}

#[test]
fn pures() {
    let r = reference();
    for c in r.at("wing_sign").iter() {
        meme("wing_sign", OR::wing_sign(&c.at(0)), &c.at(1));
    }
    for c in r.at("res_count").iter() {
        meme(&format!("res_count{}", c.repr()), OR::res_count(&c.at(0), c.ati(1), c.ati(2)), &c.at(3));
    }
    let us: Val = r.at("unites").slice(None, Some(40)).iter().map(|c| fabrique(&c.at("recette"), true)).collect();
    for c in r.at("men").iter() {
        meme("_men", OR::_men(&us, &c.at(0)), &c.at(1));
    }
    for c in r.at("grape_k").iter() {
        meme("grape_k", BT::grape_k(c.atf(0), c.atf(1)), &c.at(2));
    }
    for c in r.at("ball_k").iter() {
        meme("ball_k", BT::ball_k(c.atf(0), c.atf(1)), &c.at(2));
    }
    for c in r.at("ang_diff").iter() {
        meme("ang_diff", BT::ang_diff(c.atf(0), c.atf(1)), &c.at(2));
    }
    for c in r.at("fmt_hour").iter() {
        assert_eq!(BT::fmt_hour(c.atf(0)), c.ats(1));
    }
    for c in r.at("valid_piet").iter() {
        let v = match c.at(0) {
            p @ Val::List(_) => Val::from(format!("{}{}", p.at(0), "A".repeat(p.ati(1) as usize))),
            v => v,
        };
        meme("valid_piet", BT::valid_piet(&v), &c.at(1));
    }
}

// ====================================================================== 2. batailles
/// La GeoMap de la géographie v, relue du cache que tests/geo.rs et tests/terrain.rs écrivent dans le même dossier.
fn geo(v: i64, geos: &mut HashMap<i64, Rc<GeoMap>>) -> Rc<GeoMap> {
    geos.entry(v)
        .or_insert_with(|| {
            let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
            std::fs::create_dir_all(&d).unwrap();
            std::env::set_var("CONQUETE_DATA", &d);
            Rc::new(GeoMap::new(v))
        })
        .clone()
}

fn xy(v: &Val) -> (f64, f64) {
    v.xy()
}

#[test]
fn batailles() {
    let r = reference();
    let mut geos = HashMap::new();
    for bt in r.at("batailles").iter() {
        let spec = bt.at("spec");
        let bid = spec.ats("bid");
        let rs = bt.at("recettes");
        let units: Val = rs.iter().map(|c| fabrique(&c, false)).collect();
        let mut tb = TacticalBattle::new(geo(bt.ati("gv"), &mut geos), &spec, &units, &tup![0, 1]);
        for (u, c) in units.iter().zip(rs.iter()) {
            poser(&u, &c.at("set"));
        }
        let us: Vec<Val> = units.vec();
        let a = bt.at("r");
        let q = |k: &str| format!("bataille {bid} : {k}");

        // ---- création
        let c = a.at("creation");
        meme(&q("edges"), &tb.edges, &c.at("edges"));
        meme(&q("zones"), &tb.zones, &c.at("zones"));
        meme(&q("ai_zones"), &tb.ai_zones, &c.at("ai_zones"));
        assert_eq!(list![&tb.zones, &tb.ai_zones].repr(), c.ats("zones_repr"), "{}", q("zones (repr)"));
        meme(&q("wind"), &tb.wind, &c.at("wind"));
        meme(&q("dusk"), tb.dusk, &c.at("dusk"));
        meme(&q("wx_at"), &tb.wx_at, &c.at("wx_at"));
        meme(&q("wx_next"), &tb.wx_next, &c.at("wx_next"));
        meme(&q("chaume"), py::sorted_by_key(tb.chaume.vec(), |v| v.clone()), &c.at("chaume"));
        meme(&q("bati"), empreinte_ordre(&tb.bati.iter().map(|&b| Val::from(b)).collect()), &c.at("bati"));
        meme(&q("rng"), tb.rng.random(), &c.at("rng"));
        meme(&q("bid"), tb.bid.as_str(), &c.at("bid"));
        meme(&q("weather"), tb.weather.as_str(), &c.at("weather"));
        meme(&q("season"), tb.season.as_str(), &c.at("season"));
        meme(&q("difficulty"), tb.difficulty.as_str(), &c.at("difficulty"));

        // ---- zones, bords, place
        let zone: Val = (0..2).map(|s| list![tb.zone(s), tb.ai_zone(s), tb.edge(s), tb.front_dir(s)]).collect();
        meme(&q("zone"), zone, &a.at("zone"));
        let pts: Vec<(f64, f64)> = a.at("pts").iter().map(|p| xy(&p)).collect();
        let mut v = list![];
        for &(x, y) in &pts {
            for s in 0..2 {
                v.push(list![tb.edge_point(s, x, y), tb.off_map(s, x, y)]);
            }
        }
        meme(&q("edge_point"), &v, &a.at("edge_point"));
        v = list![];
        for s in 0..2 {
            for (x, y) in [(10.0, 1000.0), (2990.0, 1000.0), (1500.0, 10.0), (1500.0, 1990.0)] {
                v.push(tb.off_map(s, x, y));
            }
        }
        meme(&q("off_map"), &v, &a.at("off_map_bords"));
        let pl = a.at("place");
        meme(&q("objective"), tb.objective(), &pl.at("objective"));
        let cv: Val = tb.cases_ville().into_iter().map(Val::from).collect();
        meme(&q("cases_ville"), empreinte_ordre(&cv), &pl.at("cases_ville"));
        meme(&q("n_ville"), cv.len(), &pl.at("n_ville"));
        meme(&q("degats_ville"), tb.degats_ville(), &pl.at("degats"));
        meme(&q("place_info"), tb.place_info(), &pl.at("place_info"));
        assert_eq!(tb.place_info().repr(), pl.ats("place_repr"), "{}", q("place_info (repr)"));
        let v: Val = pts.iter().flat_map(|&(x, y)| [tb.in_place(x, y, 30.0), tb.in_place(x, y, 0.0)]).map(Val::from).collect();
        meme(&q("in_place"), v, &pl.at("in_place"));
        for d in a.at("dry").iter() {
            meme(&q("_dry"), tb._dry(&d.at(0)), &d.at(1));
        }

        // ---- terrain
        let v: Val = pts
            .iter()
            .map(|&(x, y)| {
                list![TacticalBattle::cell(x, y), tb.terrain_at(x, y), tb.is_wood(x, y), tb.height_at(x, y), tb.cover_at(x, y), tb.feature_at(x, y)]
            })
            .collect();
        meme(&q("terrain"), v, &a.at("terrain"));
        let v: Val = pts[..8]
            .iter()
            .zip([0.0, 10.0, 25.0, 60.0, 140.0, 33.3, 400.0, 5.0])
            .map(|(&(x, y), rr)| tb.cells_near(x, y, rr).into_iter().map(Val::from).collect::<Val>())
            .collect();
        meme(&q("cells_near"), v, &a.at("cells_near"));
        for c in a.at("costs").iter() {
            let arr: Val = tb.costs(c.at(0).s(), c.ati(1)).iter().map(|&x| Val::from(x)).collect();
            assert_eq!(empreinte_ordre(&arr), c.ats(2), "{}", q(&format!("costs({}, {})", c.at(0), c.at(1))));
        }
        let mut v = list![];
        for &(x, y) in &pts {
            let l = list![];
            for cls in ["inf", "cavalerie", "general", "artillerie", "chariot", "light"] {
                for s in 0..2 {
                    l.push(tb.passable(x, y, cls, s));
                }
            }
            v.push(l);
        }
        meme(&q("passable"), &v, &a.at("passable"));
        v = list![];
        for &(x, y) in &pts[..10] {
            let l = list![];
            for cls in ["inf", "art"] {
                for s in 0..2 {
                    for (mr, hf) in [(12, false), (3, true)] {
                        l.push(tb.nearest_passable(&Val::from(cls), s, x, y, mr, hf));
                    }
                }
            }
            v.push(l);
        }
        meme(&q("nearest_passable"), &v, &a.at("nearest"));
        let v: Val = us.iter().zip(&pts).map(|(u, &(x, y))| Val::from(tb.nearest_passable(u, u.ati("side"), x, y, 12, false))).collect();
        meme(&q("nearest_passable (unités)"), v, &a.at("nearest_u"));
        let los: String = a
            .at("los_in")
            .iter()
            .map(|l| if tb.los(l.atf(0), l.atf(1), l.atf(2), l.atf(3), l.atf(4), l.atf(5)) { '1' } else { '0' })
            .collect();
        assert_eq!(los, a.ats("los"), "{}", q("los"));
        let mut lu = String::new();
        for x in &us {
            for y in &us {
                lu.push(if tb.los_units(x, y) { '1' } else { '0' });
            }
        }
        assert_eq!(lu, a.ats("los_units"), "{}", q("los_units"));
        let mut k = 0;
        for u in &us {
            for _ in 0..3 {
                let p = a.at("plan_path").at(k);
                k += 1;
                tb._astar_left = p.ati(0);
                let chemin = tb.plan_path(u, p.atf(1), p.atf(2));
                meme(&q(&format!("plan_path({}, {}, {})", u.at("id"), p.at(1), p.at(2))), &chemin, &p.at(3));
                assert_eq!(tb._astar_left, p.ati(4), "{}", q("_astar_left"));
            }
        }
        let mut v = list![];
        for (&(x1, y1), &(x2, y2)) in pts[..10].iter().zip(&pts[10..20]) {
            let l = list![];
            for cls in ["inf", "cav", "artillerie"] {
                for s in 0..2 {
                    l.push(tb.path_cost(x1, y1, x2, y2, cls, s));
                }
            }
            v.push(l);
        }
        meme(&q("path_cost"), &v, &a.at("path_cost"));
        v = list![];
        let cost = tb.costs("inf", 0);
        for (&(x1, y1), &(x2, y2)) in pts[..6].iter().zip(&pts[6..12]) {
            for cap in [9000, 50] {
                let ch = tb._astar(&cost, TacticalBattle::cell(x1, y1), TacticalBattle::cell(x2, y2), cap);
                v.push(ch.map(|c| c.into_iter().map(Val::from).collect::<Val>()));
            }
        }
        meme(&q("_astar"), &v, &a.at("astar"));
        v = list![];
        for &(x, y) in &pts[..6] {
            let l = list![];
            for (kind, fac) in [("cover", Val::None), ("height", Val::None), ("wood_edge", Val::from(0.7)), ("wood_edge", Val::None), ("wood_edge", Val::from(-2.0))] {
                for (rad, s, cls) in [(150.0, 0, "inf"), (300.0, 1, "cav")] {
                    l.push(tb.best_spot(x, y, rad, kind, s, &fac, cls));
                }
            }
            v.push(l);
        }
        meme(&q("best_spot"), &v, &a.at("best_spot"));

        // ---- unités
        tb.seen_by = a.at("seen").iter().map(|l| l.to_set()).collect();
        us[3].set("state", "deroute");
        us[13].set("state", "hors");
        let v = list![];
        for s in 0..2 {
            let th: Val = pts[..10]
                .iter()
                .flat_map(|&(x, y)| [600.0, 1500.0].map(|rad| (x, y, rad)))
                .map(|(x, y, rad)| Val::from(tb.threat(s, x, y, rad)))
                .collect();
            v.push(list![ids(&tb.units_of(s)), ids(&tb.ai_units(s)), ids(&tb.visible_enemies(s)), tb.strength(s), tb.seen_strength(s), th]);
        }
        meme(&q("listes"), &v, &a.at("listes"));
        let v: Val = [Val::from("r0"), Val::from("g1"), Val::from("zz"), Val::None]
            .iter()
            .map(|i| {
                let u = tb.unit(i);
                if u.truthy() { list![u.at("id")] } else { Val::None }
            })
            .collect();
        meme(&q("unit"), v, &a.at("unit"));
        let v: Val = us.iter().zip(&us[5..]).map(|(x, y)| list![TacticalBattle::dist(x, y), TacticalBattle::bearing(x, y)]).collect();
        meme(&q("dist"), v, &a.at("dist"));
        tb.clock = 1234.5;
        meme(&q("time_left"), tb.time_left(), &a.at("time_left"));
        for k in 0..2 {
            if k == 1 {
                us[us.len() - 2].set("state", "hors");
                tb._refresh_gens();
            }
            let v = list![];
            for u in &us {
                let id = |x: Val| if x.truthy() { list![x.at("id")] } else { Val::None };
                let l = list![id(tb.general_near(u, 400.0)), id(tb.general_near(u, 1500.0)), id(tb.rally_general(u))];
                l.push(tb.has_general(u.ati("side")));
                l.push(tb.r#trait(u.ati("side")));
                l.push(tb.rally_radius(&us[if u.ati("side") == 0 { 8 } else { 18 }]));
                for foe in [100.0, 160.0, 500.0, 900.0] {
                    for order in [false, true] {
                        let (rk, who) = tb._rally_k(u, &Val::from(foe), order);
                        l.push(list![rk, who]);
                    }
                }
                v.push(l);
            }
            meme(&q(&format!("états-majors ({k})")), &v, &a.at("gens").at(k));
        }
        let te = list![
            (0..2).map(|s| tb.tech(s)).collect::<Val>(),
            us[..3].iter().map(|u| list![tb.tech_of(u), tb.ufx(u, "entrench"), tb.ufx(u, "shell")]).collect::<Val>()
        ];
        meme(&q("tech"), te, &a.at("tech"));
        tb.clock = 61.7;
        tb.emit("feu", 10.4, 20.5, &Val::None, &Val::None, &Val::None, &Val::None);
        tb.emit("charge", 1.5, 2.5, &Val::from(3.5), &Val::from(4.5), &Val::from(7), &Val::from("r0"));
        tb.emit("mort", 0.0, 0.0, &Val::None, &Val::None, &Val::from(12.345), &Val::None);
        tb.log("Un message", &Val::None, &Val::None);
        tb.log("Un autre", &Val::from(1), &Val::from(0));
        for i in 0..520 {
            tb.emit("x", i as f64, i as f64, &Val::None, &Val::None, &Val::None, &Val::None);
        }
        for i in 0..310 {
            tb.log(&format!("m{i}"), &Val::from(0), &Val::None);
        }
        let j = a.at("journal");
        meme(&q("seq"), tb.seq, &j.at("seq"));
        meme(&q("fx"), empreinte_ordre(&tb.fx), &j.at("fx"));
        meme(&q("fx[:3]"), tb.fx.slice(None, Some(3)), &j.at("fx0"));
        meme(&q("logs"), empreinte_ordre(&tb.logs), &j.at("logs"));
        meme(&q("n"), list![tb.fx.len(), tb.logs.len()], &list![j.at("n_fx"), j.at("n_logs")]);

        // ---- les ordres du joueur
        tb.clock = 0.0;
        let mut o = vec![];
        for side in 0..2 {
            let w = a.at(format!("ordres{side}"));
            let livres = w.at("livres");
            let gs = OR::groups(&tb, side, &livres);
            meme(&q(&format!("groups({side})")), &gs, &w.at("groups"));
            let cl: Val = w.at("raws").iter().map(|raw| OR::clean(&tb, side, &raw, &livres)).collect();
            meme(&q(&format!("clean({side})")), &cl, &w.at("clean"));
            o.push(cl.at(0));
            meme(&q("defaults"), OR::defaults(&tb, side, &gs), &w.at("defaults"));
            meme(&q("defaults(None)"), OR::defaults(&tb, side, &Val::None), &w.at("defaults_none"));
            meme(&q("_units"), ids(&OR::_units(&tb, side)), &w.at("units"));
            meme(&q("_fat"), OR::_fat(&tb, side), &w.at("fat"));
            meme(&q("era"), OR::era(&tb), &w.at("era"));
            meme(&q("general"), OR::general(&tb, side), &w.at("general"));
            meme(&q("wood_on_wing"), list![OR::wood_on_wing(&tb, side, -1), OR::wood_on_wing(&tb, side, 1)], &w.at("wood"));
            meme(&q("scouting"), OR::scouting(&mut tb, side), &w.at("scouting"));
        }
        tb.ai_mem = loads(r#"{"s0": {"ax": 600.0, "ay": 1000, "fd": 0.2, "width": 800, "ord": {"wood": [900, 700]}, "plan": "frontal"},
            "s1": {"ax": 2400.5, "ay": 900.0, "fd": 3.141592653589793, "plan": "tenir"}}"#)
        .unwrap();
        for side in 0..2 {
            meme(&q(&format!("report({side})")), OR::report(&mut tb, side), &a.at(format!("report{side}")));
        }
        for c in a.at("avis").iter() {
            let (side, oo) = (c.ati(0), c.at(1));
            meme(&q(&format!("advise({side}, {})", oo.repr())), OR::advise(&mut tb, side, &oo), &c.at(2));
            meme(&q(&format!("arrows({side}, {})", oo.repr())), OR::arrows(&tb, side, &oo), &c.at(3));
        }
        meme(&q("arrows vides"), list![OR::arrows(&tb, 0, &Val::dict()), OR::arrows(&tb, 0, &Val::None)], &a.at("arrows_vides"));
        let L = r.at("L");
        for c in a.at("tweak").iter() {
            tb.spec.set("orders", c.at(0));
            let pi = tb.place_info();
            meme(&q("of"), (0..2).map(|s| OR::of(&tb, s)).collect::<Val>(), &c.at(1));
            meme(&q("plan"), (0..2).map(|s| OR::plan(&tb, s, &pi)).collect::<Val>(), &c.at(2));
            meme(&q("plan(None)"), (0..2).map(|s| OR::plan(&tb, s, &Val::None)).collect::<Val>(), &c.at(3));
            meme(&q("tweak is L"), (0..2).map(|s| Val::from(OR::tweak(&tb, s, &L).is(&L))).collect::<Val>(), &c.at(4));
            for s in 0..2 {
                assert_eq!(empreinte_ordre(&OR::tweak(&tb, s, &L)), c.at(5).at(s).ats(0), "{} : changements attendus {}", q("tweak"), c.at(5).at(s).at(1).repr());
            }
            meme(&q("announced_k"), (0..2).map(|s| Val::from(OR::announced_k(&tb, s))).collect::<Val>(), &c.at(6));
        }
        // le moment décisif
        tb.spec.set("orders", list![o[0].copy(), o[1].copy()]);
        tb.spec.at("orders").at(0).set("resWhen", "demande");
        tb.spec.at("orders").at(1).set("resWhen", "plie");
        let seq = list![];
        seq.push(OR::ask(&mut tb, 0, "res", "Engager la réserve ?"));
        tb.replay = Val::dict();
        tb.clock = 100.4;
        seq.push(OR::ask(&mut tb, 0, "res", "Engager la réserve ?"));
        seq.push(&tb.ask);
        seq.push(OR::ask(&mut tb, 1, "res", "x"));
        seq.push(OR::ask(&mut tb, 0, "cav", "Et la cavalerie ?"));
        seq.push(&tb.ask);
        seq.push(OR::answer(&mut tb, "wait"));
        seq.push(&tb.ask);
        seq.push(OR::ask(&mut tb, 0, "res", "y"));
        tb.clock = 1100.6;
        seq.push(OR::ask(&mut tb, 0, "res", "y"));
        seq.push(OR::ask(&mut tb, 0, "cav", "z"));
        seq.push(OR::answer(&mut tb, "go"));
        seq.push(OR::answer(&mut tb, "go"));
        seq.push(OR::ask(&mut tb, 0, "cav", "z"));
        tb.replay = conquete::dict! {"skip" => true};
        seq.push(OR::ask(&mut tb, 0, "feu", "w"));
        seq.push(&tb.ai_mem);
        meme(&q("ask"), &seq, &a.at("ask"));
        // l'heure de l'attaque
        let v = list![];
        for (side, h) in [(0, "aube"), (1, "midi"), (0, "matin"), (1, "aube")] {
            tb.clock = 3000.0 * side as f64;
            OR::setup(&mut tb, side, &conquete::dict! {"hour" => h});
            let mf: Val = us.iter().map(|u| list![u.at("morale"), u.at("fat")]).collect();
            v.push(list![tb.dusk, tb.light, tb.spec.at("h_off"), mf]);
        }
        meme(&q("setup"), &v, &a.at("setup"));
    }
}
