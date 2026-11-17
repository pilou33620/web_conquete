//! La fiche chiffrée d'un régiment (src/fiche.rs) et l'effet des munitions et de la fatigue (engine/raccord.rs) contre
//! le Python d'origine : tests/references/fiche.json reprend, à l'identique, ce que les jumeaux unites_ref.py et
//! pont_ref.py avaient écrit pour ces fonctions (stats, xp_k, power_k, charge_k, cls_of, ranges, ammo0_of ; reg_k,
//! march_k, is_auto), avant la suppression du champ de bataille tactique (SPEC-BATAILLE.md).

use conquete::engine::raccord as TB;
use conquete::fiche as ST;
use conquete::py::json::{dumps_ref_ordre, loads};
use conquete::py::Val;
use conquete::tup;

fn reference() -> Val {
    loads(include_str!("references/fiche.json")).unwrap()
}

/// La même valeur que le Python (forme ordonnée des références : 5 et 5.0 y sont égaux, l'ordre des clés compte).
#[track_caller]
fn meme(quoi: &str, rust: impl Into<Val>, attendu: &Val) {
    assert_eq!(dumps_ref_ordre(&rust.into()), dumps_ref_ordre(attendu), "{quoi}");
}

/// Le même flottant, au bit près.
#[track_caller]
fn bits(quoi: &str, rust: f64, attendu: &Val) {
    assert_eq!(rust.to_bits(), attendu.f().to_bits(), "{quoi} : {rust} au lieu de {attendu}");
}

#[test]
fn troupes() {
    let r = reference();
    for c in r.at("cls_of").iter() {
        assert_eq!(ST::cls_of(c.at(0).s()), c.ats(1));
    }
    for c in r.at("ranges_dict").iter() {
        let (e, m, g) = ST::ranges(&c.at(0));
        assert_eq!(tup![e, m, g].repr(), c.ats(1), "ranges({})", c.at(0).repr());
    }
    for c in r.at("ammo0_of").iter() {
        meme("ammo0_of", ST::ammo0_of(c.at(0).s()), &c.at(1));
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
fn munitions_et_fatigue() {
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
}
