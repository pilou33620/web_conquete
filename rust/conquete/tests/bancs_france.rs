//! Toute la France (SPEC-FRANCE.md) : la géographie 3, ses camps, une partie qui joue. Portage de tests/test_france.py.

mod fabrique_campagne;

use conquete::ai::AI;
use conquete::engine::Game;
use conquete::geo::{GeoMap, NONE};
use conquete::py::Val;
use conquete::rules as R;
use fabrique_campagne::{geo, play_month};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// `GEO = GeoMap()` : toute la France.
fn france() -> GeoMap {
    std::rc::Rc::try_unwrap(geo(conquete::geo::VERSION)).ok().unwrap()
}

fn jouables(geo: &GeoMap) -> BTreeSet<String> {
    geo.playable_codes.iter().map(|c| c.string()).collect()
}

// ------------------------------------------------------------------ France

#[test]
fn tous_les_departements_jouables() {
    let geo = france();
    assert_eq!(geo.version, 4);
    let codes = jouables(&geo);
    assert_eq!(codes.len(), 89);
    assert!(["33", "75", "69", "13", "20", "67"].iter().all(|c| codes.contains(*c)));
    for c in &codes {
        assert!(R::FACTIONS().has(c.as_str()), "{c} sans camp");
    }
}

#[test]
fn un_chef_lieu_par_departement_dans_son_departement() {
    let geo = france();
    let mut caps: BTreeMap<String, Val> = BTreeMap::new();
    for n in geo.nodes.iter() {
        if n.at("type") == "capitale" {
            let d = n.ats("dept");
            assert!(!caps.contains_key(&d), "deux chefs-lieux dans le {d}");
            assert_eq!(geo.dept_at(n.atf("x"), n.atf("y")), Some(d.as_str()), "{} hors de son département", n.at("name"));
            caps.insert(d, n);
        }
    }
    assert_eq!(caps.keys().cloned().collect::<BTreeSet<_>>(), jouables(&geo));
    assert_eq!(caps["75"].at("name"), "Paris");
}

#[test]
fn plus_de_254_places() {
    // (cellnode sur deux octets : 2 000 places et plus)
    let geo = france();
    assert!(geo.nodes.len() > 2000);
    let vus: HashSet<u16> = geo.cellnode.iter().copied().filter(|&v| v as i64 != NONE).collect();
    assert!(*vus.iter().max().unwrap() > 254);
}

#[test]
fn le_reseau_routier_relie_le_continent() {
    let geo = france();
    let mut nb: HashMap<i64, HashSet<i64>> = HashMap::new();
    for e in geo.edges.iter() {
        nb.entry(e.ati("a")).or_default().insert(e.ati("b"));
        nb.entry(e.ati("b")).or_default().insert(e.ati("a"));
    }
    let paris = geo.by_name.ati("Paris");
    let (mut vus, mut pile) = (HashSet::from([paris]), vec![paris]);
    while let Some(x) = pile.pop() {
        for &v in nb.get(&x).into_iter().flatten() {
            if vus.insert(v) {
                pile.push(v);
            }
        }
    }
    for nom in ["Bordeaux", "Lille", "Strasbourg", "Marseille", "Brest", "Perpignan", "Nice"] {
        assert!(vus.contains(&geo.by_name.ati(nom)), "{nom} coupée de Paris");
    }
}

#[test]
fn une_partie_de_france_joue_un_mois() {
    let geo = geo(conquete::geo::VERSION);
    let mut g = Game::new(geo, "69", &Val::from("normal"), &Val::from(3), &Val::from("1790"));
    assert_eq!(g.factions.len(), 89);
    let ai = AI::new(&g, &g.player.clone());
    g.ais.insert(g.player.clone(), Some(ai));
    play_month(&mut g);
    assert_eq!(g.date(&Val::None).month, 4);
    assert!(g.factions.values().iter().all(|f| f.atb("alive")));
}
