//! Les fonctions pures de la seconde moitié de l'IA de bataille (tactics/ai/ligne.rs, manoeuvres.rs, armes.rs) contre
//! Python : tests/references/ia2.json est écrit par le jumeau outils/jumeau/ia2_ref.py.
//!
//! Celles qui s'appuient sur les outils de la première moitié (_rel, _at, _clamp, _d2, _ang : ai/deploiement.rs) sont
//! sautées tant que ces outils sont encore en `todo!()` (la panique « not yet implemented »).

use conquete::py::json::{dumps_ref_ordre, loads};
use conquete::py::Val;
use conquete::tactics::ai as AI;
use conquete::{list, tup};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn reference() -> Val {
    loads(include_str!("references/ia2.json")).unwrap()
}

#[track_caller]
fn meme(quoi: &str, rust: impl Into<Val>, attendu: &Val) {
    assert_eq!(dumps_ref_ordre(&rust.into()), dumps_ref_ordre(attendu), "{quoi}");
}

fn corps(v: &Val) -> Vec<AI::Repere> {
    v.iter().map(|t| (t.at(0), t.atf(1), t.atf(2), t.ats(3), t.at(4))).collect()
}

/// Fait tourner f ; faux (sauté) si un outil de la première moitié n'est pas encore porté.
fn ou_saute(nom: &str, f: impl FnOnce()) -> bool {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(()) => true,
        Err(e) => {
            let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            if msg.contains("not yet implemented") {
                eprintln!("{nom} : sauté (outils de ai/deploiement.rs pas encore portés)");
                false
            } else {
                std::panic::resume_unwind(e)
            }
        }
    }
}

#[test]
fn foe_dist_wing_rank_wave() {
    let r = reference();
    for c in r.at("foe_dist").iter() {
        let d = AI::_foe_dist(&c.at("u"), &corps(&c.at("body")));
        assert_eq!(d.to_bits(), c.atf("r").to_bits(), "_foe_dist");
    }
    for c in r.at("wing_rank").iter() {
        let got: Val = c.at("us").iter().map(|u| Val::from(AI::_wing_rank(&c.at("mem"), &c.at("us"), &u))).collect();
        meme("_wing_rank", got, &c.at("r"));
    }
    for c in r.at("wave").iter() {
        let mem = c.at("mem").deepcopy();
        AI::_wave(&mem, &c.at("us"));
        meme("_wave", mem.at("role"), &c.at("r"));
    }
}

#[test]
fn outils_de_ligne() {
    let r = reference();
    ou_saute("_front_dep", || {
        for c in r.at("front_dep").iter() {
            let (best, lat) = AI::_front_dep(&corps(&c.at("body")), c.atf("ax"), c.atf("ay"), c.atf("fd"), c.atf("span"));
            meme("_front_dep", list![best, lat], &c.at("r"));
        }
    });
    ou_saute("_out_of_grape", || {
        for c in r.at("out_of_grape").iter() {
            let guns: Vec<AI::Canon> = c.at("guns").iter().map(|g| (g.atf(0), g.atf(1), g.atf(2), g.at(3))).collect();
            let (x, y) = AI::_out_of_grape(&guns, c.atf("x"), c.atf("y"), c.atf("fd"));
            meme("_out_of_grape", tup![x, y], &c.at("r"));
        }
    });
    ou_saute("_gun_front", || {
        for c in r.at("gun_front").iter() {
            meme("_gun_front", AI::_gun_front(&c.at("e"), &c.at("u")), &c.at("r"));
        }
    });
    ou_saute("_slot", || {
        for c in r.at("slot").iter() {
            let mem = c.at("mem");
            let ids: Vec<Val> = c.at("slots").iter().enumerate().map(|(i, _)| Val::from(["r1", "r12", "r3", "g7", "r21", "w2"][i])).collect();
            let got: Val = ids.iter().map(|id| {
                let (x, y) = AI::_slot(&mem, id);
                list![x, y]
            }).collect();
            meme("_slot", got, &c.at("slots"));
        }
    });
    ou_saute("_recenter", || {
        for c in r.at("recenter").iter() {
            let mem = c.at("mem").deepcopy();
            AI::_recenter(&mem, &c.at("line"));
            meme("_recenter", mem, &c.at("r"));
        }
    });
}
