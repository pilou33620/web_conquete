//! Chaque théâtre de geo::THEATRES se charge : sa carte se fait, ses pays ont leurs moyens, leurs maisons et leur culture,
//! une capitale chacun, et ils sont à l'écran de départ (R::MODES). (Le cache des cartes dans CARGO_TARGET_TMPDIR/geo,
//! comme tests/geo.rs ; l'Europe en détail : tests/europe.rs.)

use conquete::geo::{self, GeoMap};
use conquete::rules as R;
use std::collections::HashSet;

#[test]
fn chaque_theatre_se_charge() {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    let mut codes: HashSet<String> = HashSet::new();
    let mut ids: HashSet<&str> = HashSet::new();
    for t in geo::THEATRES {
        assert!(t.geo >= 5 && ids.insert(t.id), "{} : numéro ou id déjà pris", t.id);
        assert!(R::MODES().iter().any(|m| m.at("geo") == t.geo && m.at("nom") == t.nom), "{} : pas à l'écran de départ", t.id);
        let g = GeoMap::new(t.geo);
        assert_eq!((g.km_case, g.suffixe.clone()), (5.0, format!("_v{}", t.geo)), "{}", t.id);
        assert!(g.theatre.is_some_and(|x| x.id == t.id));
        let pays = R::pays(t.geo);
        assert!(!pays.is_empty(), "{} : aucun pays", t.id);
        assert_eq!(R::camps(t.geo).len(), pays.len(), "{}", t.id);
        for (c, p) in pays.items() {
            let c = c.string();
            // codes : deux lettres en Europe, trois majuscules ailleurs, uniques sur tous les théâtres
            let n = if t.geo == geo::VERSION_EUROPE { 2 } else { 3 };
            assert!(c.len() == n && c.chars().all(|x| x.is_ascii_uppercase()), "{} : code {c}", t.id);
            assert!(codes.insert(c.clone()), "{c} : code pris par deux théâtres");
            assert!(g.playable_codes.has(c.as_str()), "{c} n'est pas jouable sur sa carte");
            // moyens : [[armée de 1700, 1790, 1813, 1870], trésor] ; huit maisons ; une culture connue
            let m = p.at("moyens");
            assert!(m.len() == 2 && m.at(0).len() == 4 && m.at(0).iter().all(|a| a.f() >= 0.0) && m.atf(1) > 0.0, "{c} : moyens {m}");
            assert!(R::moyens_pays(&c, "1790").is_some(), "{c}");
            assert!(p.at("maisons").len() == 8 && R::MAISON_NOMS().at(c.as_str()).len() == 8, "{c} : maisons");
            assert!(R::culture_connue(p.at("culture").s()), "{c} : culture {}", p.at("culture"));
            assert!(!R::prenoms(&c).is_empty() && !R::prenoms_f(&c).is_empty() && !R::surnames(&c).is_empty(), "{c} : noms");
            // une capitale, celle de pays_<id>.json, dans son pays
            let caps: Vec<_> = g.nodes.iter().filter(|n| n.at("dept") == c.as_str() && n.at("type") == "capitale").collect();
            assert_eq!(caps.len(), 1, "{c} : une capitale");
            assert_eq!(caps[0].at("name"), p.at("capital"), "{c}");
        }
    }
}
