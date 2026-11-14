//! rules.rs contre game/rules.py : tests/references/rules.json est écrit par le jumeau outils/jumeau/rules_ref.py.

use conquete::py::{self, json, Val};
use conquete::rules as R;
use conquete::tup;

fn reference() -> Val {
    json::loads(include_str!("references/rules.json")).unwrap()
}

fn sha(t: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(t.as_bytes()).iter().map(|o| format!("{o:02x}")).collect()
}

/// La même valeur, les sets triés : sa repr ne dépend plus de leur ordre (`repr_type` du jumeau).
fn trie(v: &Val) -> Val {
    match v {
        Val::List(_) => v.iter().map(|x| trie(&x)).collect(),
        Val::Tuple(_) => Val::tuple(v.iter().map(|x| trie(&x)).collect()),
        Val::Dict(_) => Val::dict_from(v.items().into_iter().map(|(k, x)| (k, trie(&x))).collect()),
        Val::Set(_) => Val::set_from(py::sorted_by_key(v.vec(), |x| x.clone())),
        _ => v.clone(),
    }
}

/// Un résultat contre celui du Python : la forme des références, et la repr (1 n'est pas 1.0, un tuple n'est pas une liste).
#[track_caller]
fn meme(quoi: &str, rust: &Val, attendu: &Val, repr: &Val) {
    assert_eq!(json::dumps_ref_ordre(rust), json::dumps_ref_ordre(attendu), "{quoi}");
    assert_eq!(rust.repr(), repr.s(), "{quoi} (repr)");
}

#[test]
fn constantes() {
    let r = reference();
    let cs = R::constantes();
    let noms: Vec<Val> = cs.iter().map(|(n, _)| Val::from(*n)).collect();
    assert_eq!(Val::list(noms), r.at("noms"), "la liste des constantes");
    // en cas d'écart, les formes complètes vont ici ; le jumeau écrit les siennes avec : rules_ref.py DOSSIER
    let dossier = std::env::temp_dir().join("conquete_rules");
    let mut ecarts = vec![];
    for (nom, v) in &cs {
        let a = r.at("constantes").at(*nom);
        let canon = json::dumps_ref_ordre(v);
        let repr = trie(v).repr();
        let forme = if a.has("canon") { a.at("canon") == canon.as_str() } else { a.at("empreinte") == json::empreinte_ordre(v).as_str() };
        if !forme || a.at("repr") != sha(&repr).as_str() {
            std::fs::create_dir_all(&dossier).unwrap();
            std::fs::write(dossier.join(format!("{nom}.rust.json")), &canon).unwrap();
            std::fs::write(dossier.join(format!("{nom}.rust.repr")), &repr).unwrap();
            ecarts.push(format!("{nom}{}", if forme { " (types seulement : repr)" } else { "" }));
        }
    }
    assert!(ecarts.is_empty(), "constantes différentes du Python : {ecarts:?} ; formes complètes dans {}", dossier.display());
}

#[test]
fn textes() {
    let r = reference();
    for c in r.at("de").iter() {
        assert_eq!(R::de(c.at(0).s()), c.at(1).s(), "de({})", c.at(0).repr());
    }
    for c in r.at("num").iter() {
        assert_eq!(R::num(c.at(0).f(), c.at(1).u()), c.at(2).s(), "num({}, {})", c.at(0), c.at(1));
    }
    for c in r.at("num_defaut").iter() {
        assert_eq!(R::num(c.at(0).f(), 1), c.at(1).s(), "num({})", c.at(0));
    }
    for c in r.at("nb").iter() {
        assert_eq!(R::nb(c.at(0).f()), c.at(1).s(), "nb({})", c.at(0));
    }
    for c in r.at("pl").iter() {
        let p = c.at(2);
        let plur = if p.is_none() { None } else { Some(p.s()) };
        assert_eq!(R::pl(c.at(0), c.at(1).s(), plur), c.at(3).s(), "pl({}, {}, {})", c.at(0), c.at(1), p);
    }
    for c in r.at("tax_label").iter() {
        assert_eq!(R::tax_label(c.at(0).f()), c.at(1).s(), "tax_label({})", c.at(0));
    }
}

#[test]
fn marks() {
    for c in reference().at("marks").iter() {
        let m = R::marks(&c.at(0));
        assert!(m.is_list());
        assert_eq!(json::dumps_ref_ordre(&m), json::dumps_ref_ordre(&c.at(1)), "marks({})", c.at(0));
    }
    // un set de technologies, comme le jeu en tient
    assert_eq!(R::marks(&R::NOTABLE_TECHS()).len(), R::VISUALS().len());
}

#[test]
fn pop_curve() {
    for c in reference().at("pop_curve").iter() {
        meme(&format!("pop_curve({})", c.at(0)), &R::pop_curve(&c.at(0)), &c.at(1), &c.at(2));
    }
    // la courbe rendue est celle de la table, pas une copie
    let gn = conquete::dict! {"name" => "Bordeaux", "type" => "capitale", "dept" => "33", "spec" => conquete::list![]};
    assert!(R::pop_curve(&gn).is(&R::POP_CURVES().at("bordeaux")));
}

#[test]
fn hors_service() {
    for c in reference().at("hors_service").iter() {
        assert_eq!(R::hors_service(c.at(0).s(), c.at(1).i()), c.at(2).truthy(), "hors_service({}, {})", c.at(0), c.at(1));
    }
}

#[test]
fn etage_et_courbes() {
    let r = reference();
    let tech = R::TECH();
    assert_eq!(r.at("etage").len(), tech.len());
    for (t, e) in r.at("etage").items() {
        assert_eq!(R::_etage(&tech, t.s(), &tup![]), e.i(), "_etage({t})");
    }
    for c in r.at("town").iter() {
        meme("_town", &R::_town(c.at(0).f(), c.at(1).f(), c.at(2).s()), &c.at(3), &c.at(4));
    }
    assert_eq!(R::_town(1.18, 1.4, "ville").repr(), r.at("town_defaut").s());
    for c in r.at("rural").iter() {
        meme("_rural", &R::_rural(c.at(0).i(), c.at(1).f(), c.at(2).f(), c.at(3).s(), c.at(4).s()), &c.at(5), &c.at(6));
    }
    assert_eq!(R::_rural(1851, 1.15, 0.95, "exode", "plein").repr(), r.at("rural_defaut").s());
    for c in r.at("t").iter() {
        meme("_t", &R::_t(c.at(0).s(), c.at(1).s(), c.at(2), c.at(3).i(), c.at(4)), &c.at(5), &c.at(6));
    }
}

#[test]
#[should_panic(expected = "cycle de prérequis")]
fn etage_cycle() {
    let tech = conquete::dict! {"a" => conquete::dict!{"req" => conquete::list!["b"]}, "b" => conquete::dict!{"req" => conquete::list!["a"]}};
    R::_etage(&tech, "a", &tup![]);
}

#[test]
fn build() {
    let r = reference();
    for c in r.at("build").iter() {
        let (quoi, lvl) = (c.at(0), c.at(1).i());
        meme(&format!("BUILD_cost({quoi}, {lvl})"), &R::BUILD_cost(quoi.s(), lvl), &c.at(2), &c.at(3));
        meme(&format!("BUILD_days({quoi}, {lvl})"), &R::BUILD_days(quoi.s(), lvl), &c.at(4), &c.at(5));
    }
    // chaque appel rend un dict neuf, comme les lambdas du Python (dict(REPAR_COST))
    assert!(!R::BUILD_cost("repar", 0).is(&R::REPAR_COST()));
    // une constante est le même objet à chaque appel
    assert!(R::UNITS().is(&R::UNITS()));
    assert!(R::UNITS().at("suisses").at("terrain").is(&R::UNITS().at("ligne").at("terrain")));
}
