//! Les fonctions pures de l'IA de bataille (tactics/ai/deploiement.rs, reflexion.rs) contre game/tactics/ai.py :
//! tests/references/ia.json est écrit par le jumeau outils/jumeau/ia_ref.py. Le reste de l'IA se vérifie de bout en
//! bout (batailles entières à la même graine).
#![allow(non_snake_case)]

use conquete::py::json::{dumps_ref_ordre, loads};
use conquete::py::Val;
use conquete::tactics::ai as AI;

fn reference() -> Val {
    loads(include_str!("references/ia.json")).unwrap()
}

#[track_caller]
fn bits(quoi: &str, rust: f64, py: &Val) {
    assert_eq!(rust.to_bits(), py.f().to_bits(), "{quoi} : {rust} contre {}", py.f());
}

#[test]
fn geometrie() {
    for c in reference().at("geo").iter() {
        let e: Vec<f64> = c.at("e").iter().map(|v| v.f()).collect();
        let [x, y, ax, ay, a, b, dep, lat, m] = e[..] else { panic!() };
        let q = format!("{e:?}");
        let (px, py_) = AI::_at(x, y, a, dep, lat);
        bits(&format!("_at {q}"), px, &c.at("at").at(0));
        bits(&format!("_at {q}"), py_, &c.at("at").at(1));
        let (d, l) = AI::_rel(x, y, ax, ay, a);
        bits(&format!("_rel {q}"), d, &c.at("rel").at(0));
        bits(&format!("_rel {q}"), l, &c.at("rel").at(1));
        let (cx, cy) = AI::_clamp(x, y, m);
        bits(&format!("_clamp {q}"), cx, &c.at("clamp").at(0));
        bits(&format!("_clamp {q}"), cy, &c.at("clamp").at(1));
        bits(&format!("_d2 {q}"), AI::_d2(x, y, ax, ay), &c.at("d2"));
        bits(&format!("_ang {q}"), AI::_ang(a, b), &c.at("ang"));
    }
    for c in reference().at("hour").iter() {
        assert_eq!(AI::_hour(c.at(0).f()), c.at(1).s(), "_hour({})", c.at(0));
    }
}

#[test]
fn unites() {
    let r = reference();
    let par_id = conquete::dict! {};
    for c in r.at("unites").iter() {
        let u = c.at("u");
        par_id.set(&u.at("id"), u.clone());
        assert_eq!(AI::_cat(&u), c.at("cat").s(), "_cat {u}");
        bits(&format!("_width {u}"), AI::_width(&u), &c.at("width"));
        bits(&format!("_quality {u}"), AI::_quality(&u), &c.at("quality"));
        assert_eq!(AI::_foe(&u), c.at("foe").s(), "_foe {u}");
    }
    for c in r.at("layout").iter() {
        let us: Val = c.at("ids").iter().map(|i| par_id.at(&i)).collect();
        let (out, width) = AI::_layout(&us, c.atf("half"), c.atf("gap"));
        let attendu = c.at("out").vec();
        assert_eq!(out.len(), attendu.len(), "_layout {}", c.at("ids"));
        for ((u, lat), a) in out.iter().zip(&attendu) {
            assert_eq!(u.at("id"), a.at(0), "_layout {} : l'ordre", c.at("ids"));
            bits(&format!("_layout {}", c.at("ids")), *lat, &a.at(1));
        }
        bits(&format!("_layout {} : largeur", c.at("ids")), width, &c.at("width"));
    }
}

#[test]
fn memoire() {
    let r = reference();
    for c in r.at("rings").iter() {
        let mem = conquete::dict! {"ring" => c.at("ring")};
        let got = AI::_ring_at(&mem, c.atf("a"), &c.at("default"));
        assert_eq!(dumps_ref_ordre(&got), dumps_ref_ordre(&c.at("ring_at")), "_ring_at {c}");
        assert_eq!(got.repr(), c.at("ring_at").repr(), "_ring_at {c} (repr)");
        let posts = AI::_breach_posts(&mem, &c.at("pl"), c.atf("a"), c.atf("ri"), c.atf("br"));
        for (p, a) in posts.iter().zip(c.at("posts").iter()) {
            bits("_breach_posts x", p.0, &a.at(0));
            bits("_breach_posts y", p.1, &a.at(1));
            bits("_breach_posts dir", p.2, &a.at(2));
            assert_eq!(p.3, a.at(3).s());
        }
    }
    for c in r.at("foe_est").iter() {
        bits(&format!("_foe_est {}", c.at("mem")), AI::_foe_est(&c.at("mem")), &c.at("est"));
    }
    for c in r.at("adopt_unit").iter() {
        let mem = c.at("avant").deepcopy();
        AI::_adopt_unit(&mem, &c.at("u"));
        assert_eq!(dumps_ref_ordre(&mem), c.at("apres").s(), "_adopt_unit {}", c.at("u"));
    }
    for c in r.at("tenue").iter() {
        let u = conquete::dict! {"form" => c.at(0), "order" => c.at(1)};
        assert_eq!(AI::_tenue(&u), c.at(2).truthy(), "_tenue {c}");
    }
    for c in r.at("dfn").iter() {
        assert_eq!(AI::_dfn(c.ati(0), &c.at(1)), c.at(2).truthy(), "_dfn {c}");
    }
}
