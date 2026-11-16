//! La géographie 4 : la 3 (mêmes places, mêmes numéros) et les ajouts de game/data/places_france_v4.json.
//! (Dans son propre fichier : tests/geo.rs refait le cache de la 3 pendant ses essais.)

use conquete::geo::GeoMap;
use conquete::rules as R;

/// Une géographie, relue du cache que les essais partagent (ou générée la première fois).
fn geo(v: i64) -> GeoMap {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    GeoMap::new(v)
}

#[test]
fn geographie_4() {
    assert_eq!(conquete::geo::VERSION, 4);
    let (g3, g4) = (geo(3), geo(4));
    assert_ne!(g3._src_hash(), g4._src_hash());
    assert_eq!((g3.suffixe.as_str(), g4.suffixe.as_str()), ("", "_v4"));
    assert_eq!((g3.W, g3.H), (g4.W, g4.H));
    let n3 = g3.nodes.len();
    assert_eq!(g4.nodes.len(), n3 + 5);
    // les places de la 3 : identiques, sauf les quatre étiquettes port
    let ports = ["Rochefort|17", "Nantes|44", "Saint-Nazaire|44", "Morlaix|29"];
    let mut vus = 0;
    for (a, b) in g3.nodes.iter().zip(g4.nodes.iter()) {
        let cle = format!("{}|{}", a.at("name").s(), a.at("dept").s());
        if ports.contains(&cle.as_str()) {
            vus += 1;
            assert!(b.at("spec").has("port"), "{cle} sans l'étiquette port");
            for k in ["id", "slug", "name", "x", "y", "dept", "type", "fort", "pop0"] {
                assert_eq!(a.at(k), b.at(k), "{cle} : {k}");
            }
        } else {
            assert_eq!(a, b, "{cle}");
        }
    }
    assert_eq!(vus, 4);
    for (nom, v) in g3.by_name.items() {
        assert_eq!(g4.by_name.at(&nom), v, "by_name : {nom}");
    }
    // les ajouts : à la fin, dans l'ordre du fichier, chacun relié au réseau des routes ; leur population de 1900
    let ajouts = [("Roubaix", "59", false, 120000.0), ("Cherbourg", "50", true, 42900.0), ("Dunkerque", "59", true, 37800.0), ("Cannes", "06", true, 30000.0), ("Port-Vendres", "66", true, 950.0)];
    for (i, (nom, dept, port, pop1900)) in ajouts.into_iter().enumerate() {
        let n = g4.nodes.at(n3 + i);
        assert_eq!((n.at("id").u(), n.at("name").s(), n.at("dept").s()), (n3 + i, nom, dept));
        assert_eq!(g4.by_name.at(nom).u(), n3 + i);
        assert_eq!(n.at("spec").has("port"), port, "{nom}");
        let routes = g4.edges.iter().filter(|e| e.get("kind") != "water" && (e.at("a").u() == n3 + i || e.at("b").u() == n3 + i)).count();
        assert!(routes >= 1, "{nom} n'est pas relié au réseau");
        let fin = R::pop_curve(&n).at(-1).at(1).f() * n.at("pop0").f();
        assert!((fin - pop1900).abs() < 1.0, "{nom} : {fin} habitants en 1900");
    }
}
