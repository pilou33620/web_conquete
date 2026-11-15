//! bridge.rs et skirmish.rs contre game/tactics/bridge.py et skirmish.py, pour ce qui ne demande pas de partie en
//! marche : tests/references/pont.json est écrit par le jumeau outils/jumeau/pont_ref.py. (crc32 et la graine de
//! make_spec : l'essai de bridge.rs.)

use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Random, Val};
use conquete::tactics::bridge as TB;
use conquete::tactics::skirmish as SK;
use conquete::{dict, pyset};
use std::rc::Rc;

fn reference() -> Val {
    json::loads(include_str!("references/pont.json")).unwrap()
}

/// La même valeur sous la forme des références (clés triées, 5 et 5.0 égaux).
#[track_caller]
fn meme(quoi: &str, rust: &Val, attendu: &Val) {
    assert_eq!(json::dumps_ref(rust), json::dumps_ref(attendu), "{quoi}");
}

/// Le même flottant, au bit près.
#[track_caller]
fn bits(quoi: &str, rust: f64, attendu: &Val) {
    assert_eq!(rust.to_bits(), attendu.f().to_bits(), "{quoi} : {rust} au lieu de {attendu}");
}

/// La géographie 3, relue du cache que tests/geo.rs écrit (ou générée).
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(3))
}

#[test]
fn bridge_sans_partie() {
    let r = reference();
    for c in r.at("reg_k").iter() {
        bits(&format!("reg_k {c:?}"), TB::reg_k(&c.at(0), &c.at(1)), &c.at(2));
    }
    for c in r.at("march_k").iter() {
        bits(&format!("march_k {c:?}"), TB::march_k(&c.at(0)), &c.at(1));
    }
    for c in r.at("is_auto").iter() {
        assert_eq!(TB::is_auto(&c.at(0)), c.atb(1), "is_auto {c:?}");
    }
    for c in r.at("num").iter() {
        let v = if c.at(0) == "nan!" { Val::from(f64::NAN) } else { c.at(0) };
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| TB::_num(&v))) {
            Ok(x) => bits(&format!("_num {c:?}"), x, &c.at(1)),
            Err(e) => {
                let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap();
                assert_eq!(m.split(':').next().unwrap(), c.at(1).s(), "_num {c:?} : {m}");
            }
        }
    }
}

#[test]
fn skirmish_sans_carte() {
    let r = reference();
    for c in r.at("fort").iter() {
        assert_eq!(SK::_fort(&c.at(0)), c.ati(1), "_fort {c:?}");
    }
    for (era, t) in r.at("techs").items() {
        let mut v = SK::_techs(era.s()).vec();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        meme(&format!("_techs {era}"), &Val::list(v), &t);
    }
    for (era, u) in r.at("units_for").items() {
        meme(&format!("units_for {era}"), &SK::units_for(era.s(), false), &u.at(0));
        meme(&format!("units_for {era} (garnison)"), &SK::units_for(era.s(), true), &u.at(1));
    }
    for c in r.at("local").iter() {
        assert_eq!(SK::_local(c.at(0).s(), c.at(1).s()), c.atb(2), "_local {c:?}");
    }
    let allowed = pyset!["ligne", "legere", "cavalerie", "artillerie"];
    for c in r.at("count").iter() {
        let u = if c.at(0) == "nan!" { dict! {"ligne" => "+3", "legere" => f64::NAN} } else { c.at(0) };
        let (out, msg) = SK::_count(&u, &allowed);
        meme(&format!("_count {c:?}"), &out, &c.at(1));
        assert_eq!(msg, c.at(2).s(), "_count {c:?}");
    }
    assert_eq!(SK::_count(&dict! {"ligne" => 3, "legere" => f64::NAN}, &allowed).1, r.at("count_nan").s());
    for c in r.at("pick_weather").iter() {
        let mut rng = Random::new(c.ati(0));
        assert_eq!(SK::_pick_weather(&mut rng, c.at(1).s(), &c.at(2)), c.at(3).s(), "_pick_weather {c:?}");
        bits(&format!("_pick_weather {c:?} (hasard)"), rng.random(), &c.at(4));
    }
    for c in r.at("pick_season").iter() {
        let mut rng = Random::new(c.ati(0));
        assert_eq!(SK::_pick_season(&mut rng, &c.at(1), &c.at(2)), c.at(3).s(), "_pick_season {c:?}");
        bits(&format!("_pick_season {c:?} (hasard)"), rng.random(), &c.at(4));
    }
    for c in r.at("foe_units").iter() {
        let mut rng = Random::new(c.ati(0));
        let out = SK::_foe_units(&mut rng, c.at(1).s(), c.at(2).s(), c.ati(3), c.atb(4));
        meme(&format!("_foe_units {c:?}"), &out, &c.at(5));
        bits(&format!("_foe_units {c:?} (hasard)"), rng.random(), &c.at(6));
    }
}

#[test]
fn sur_la_carte() {
    let r = reference();
    let geo = geo();

    let opt = SK::options(&geo);
    let o = r.at("options");
    assert_eq!(opt.at("places").len() as i64, o.ati("places"), "options : nombre de places");
    meme("options : premières places", &opt.at("places").slice(None, Some(5)), &o.at("premiers"));
    meme("options : units", &opt.at("units"), &o.at("units"));
    assert_eq!(json::empreinte_ordre(&opt), o.at("empreinte").s(), "options : empreinte");

    for c in r.at("open_ground").iter() {
        let mut rng = Random::new(c.ati(0));
        let (x, y) = SK::_open_ground(&geo, &mut rng, c.atf(1), c.atf(2), c.atf(3), c.atf(4));
        bits(&format!("_open_ground {c:?} (x)"), x, &c.at(5));
        bits(&format!("_open_ground {c:?} (y)"), y, &c.at(6));
        bits(&format!("_open_ground {c:?} (hasard)"), rng.random(), &c.at(7));
    }

    let mut g = Game::__new__(geo.clone());
    for c in r.at("att_angle").iter() {
        g.armies = c.at("armies").deepcopy();
        bits(&format!("_att_angle {c:?}"), TB::_att_angle(&g, &c.at("bt")), &c.at("angle"));
    }
}
