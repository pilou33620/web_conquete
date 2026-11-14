//! Le socle contre Python : tests/references/py.json est écrit par le jumeau outils/jumeau/py_ref.py.

use super::*;
use crate::{dict, list, tup};

fn reference() -> Val {
    json::loads(include_str!("../../tests/references/py.json")).unwrap()
}
fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a == 0.0 && b == 0.0 && a.is_sign_negative() == b.is_sign_negative())
}

/// La même suite de tirages que `suite(r)` du jumeau.
fn suite(mut r: Random) -> Val {
    let s = Val::list(vec![]);
    for _ in 0..5 {
        s.push(r.random())
    }
    s.push(r.uniform(2.0, 5.0));
    for _ in 0..5 {
        s.push(r.randint(1, 6))
    }
    s.push(r.randrange(10));
    s.push(r.randrange2(3, 1000000));
    s.push(r.randrange(1 << 40));
    s.push(r.randrange(1 << 30));
    s.push(r.choice(&[0i64, 1, 2, 3, 4, 5, 6]));
    let mut l: Vec<i64> = (0..10).collect();
    r.shuffle(&mut l);
    s.push(l.into_iter().map(Val::from).collect::<Val>());
    for _ in 0..3 {
        s.push(r.gauss(0.0, 1.0))
    }
    s.push(r.choices_i(5, 4).into_iter().map(Val::from).collect::<Val>());
    s.push(r.choices_w(&[1.0, 2.0, 3.0, 4.0], 5).into_iter().map(Val::from).collect::<Val>());
    s.push(r.choices_w(&[0.2, 0.5, 0.3], 6).into_iter().map(Val::from).collect::<Val>());
    s.push(r.random());
    s
}
/// Égalité stricte : même type (1 n'est pas 1.0) et mêmes bits.
fn pareil(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Float(x), Val::Float(y)) => bits(*x, *y),
        (Val::Int(x), Val::Int(y)) => x == y,
        (Val::List(_), Val::List(_)) => a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| pareil(&x, &y)),
        _ => false,
    }
}

#[test]
fn hasard_des_entiers_et_des_textes() {
    let r = reference();
    for cas in r.at("hasard_int").iter() {
        let vu = suite(Random::new(cas.at(0).i()));
        assert!(pareil(&vu, &cas.at(1)), "graine {} :\n vu      {}\n attendu {}", cas.at(0), vu, cas.at(1));
    }
    for cas in r.at("hasard_str").iter() {
        let vu = suite(Random::new_str(cas.at(0).s()));
        assert!(pareil(&vu, &cas.at(1)), "graine {:?} :\n vu      {}\n attendu {}", cas.at(0), vu, cas.at(1));
    }
}

#[test]
fn arrondis_et_repr() {
    let r = reference();
    for cas in r.at("round").iter() {
        let x = cas.at(0).f();
        if x.abs() < 1e15 {
            assert_eq!(round(x), cas.at(1).i(), "round({x})");
            assert!(bits(round_n(x, -1), cas.at(5).f()), "round({x}, -1) : {} au lieu de {}", round_n(x, -1), cas.at(5));
        }
        for n in 1..=3 {
            assert!(bits(round_n(x, n), cas.at(n + 1).f()), "round({x}, {n}) : {} au lieu de {}", round_n(x, n), cas.at(n + 1));
        }
    }
    for cas in r.at("repr").iter() {
        assert_eq!(repr_f(cas.at(0).f()), cas.at(1).s());
    }
    assert_eq!(repr_f(-0.0), "-0.0");
    assert_eq!(milliers(-1234567), "-1,234,567");
}

#[test]
fn sommes_et_normes() {
    let r = reference();
    for cas in r.at("sum").iter() {
        let vu = sum(cas.at(0).iter().map(|x| x.f()));
        assert!(bits(vu, cas.at(1).f()), "sum({}) : {vu:?} au lieu de {}", cas.at(0), cas.at(1));
    }
    for cas in r.at("sum_v").iter() {
        let vu = sum_v(cas.at(0).iter());
        assert!(pareil(&vu, &cas.at(1)), "sum({}) : {vu} au lieu de {}", cas.at(0), cas.at(1));
    }
    for cas in r.at("hypot").iter() {
        let (x, y) = cas.xy();
        assert!(bits(hypot(x, y), cas.at(2).f()), "hypot({x:?}, {y:?}) : {:?} au lieu de {}", hypot(x, y), cas.at(2));
    }
    for cas in r.at("dist").iter() {
        let v = dist(cas.at(0).f(), cas.at(1).f(), cas.at(2).f(), cas.at(3).f());
        assert!(bits(v, cas.at(4).f()), "dist{cas} : {v:?}");
    }
    for cas in r.at("hypot3").iter() {
        let v = hypot3(cas.at(0).f(), cas.at(1).f(), cas.at(2).f());
        assert!(bits(v, cas.at(3).f()), "hypot{cas} : {v:?}");
    }
}

#[test]
fn divisions() {
    let r = reference();
    for cas in r.at("divmod_i").iter() {
        let (a, b) = (cas.at(0).i(), cas.at(1).i());
        assert_eq!((floordiv_i(a, b), mod_i(a, b)), (cas.at(2).i(), cas.at(3).i()), "{a} // {b}");
        assert_eq!(cas.at(0).floordiv(b), cas.at(2));
        assert_eq!(&cas.at(0) % &cas.at(1), cas.at(3));
    }
    for cas in r.at("divmod_f").iter() {
        let (a, b) = cas.xy();
        assert!(bits(floordiv_f(a, b), cas.at(2).f()) && bits(mod_f(a, b), cas.at(3).f()), "{a:?} // {b:?} : {:?} {:?} au lieu de {} {}", floordiv_f(a, b), mod_f(a, b), cas.at(2), cas.at(3));
    }
}

#[test]
fn json_et_textes() {
    let r = reference().at("json");
    let obj = dict! {
        "a" => 1, "b" => 1.0, "c" => list![1, 2.5, "é\"\n\t", Val::None, true, false],
        "d" => dict!{"z" => 1e-7, "y" => 1e16, 3 => "trois"}, "e" => "\u{2028}/\\", "f" => tup![1, 2],
        "g" => Val::dict(), "h" => list![],
    };
    assert_eq!(json::dumps(&obj), r.at("defaut").s());
    assert_eq!(json::dumps_compact(&obj), r.at("compact").s());
    assert_eq!(json::dumps_avec(&obj, json::Ecriture { indent: Some(1), ..Default::default() }), r.at("indente").s());
    let canon = dict! {"b" => dict!{10 => "a", 2 => "b", 1 => 1.0}, "a" => list![obj.at("c")], "é" => 1};
    assert_eq!(json::dumps_canon(&canon), r.at("canon").s());
    assert_eq!(obj.repr(), r.at("repr").s());
    assert_eq!(obj.to_string(), r.at("str").s());
    // relu, il s'écrit pareil (les tuples sont devenus des listes, la clé 3 un texte)
    let relu = json::loads(r.at("compact").s()).unwrap();
    assert_eq!(json::dumps_compact(&relu), r.at("compact").s());
}

#[test]
fn puissances_et_forme_des_references() {
    let r = reference();
    assert!(r.at("pow").len() > 50);
    for cas in r.at("pow").iter() {
        let x = cas.at(0).f();
        assert!(bits(pow(x, 2.0), cas.at(1).f()), "{x:?} ** 2");
        assert!(bits(pow(x.abs(), 0.5), cas.at(2).f()), "{x:?} ** 0.5");
        assert!(bits(pow(x.abs(), 1.5), cas.at(3).f()), "{x:?} ** 1.5");
    }
    let etat = dict! {
        "b" => dict!{10 => "a", 2 => 5.0, 1 => 1.5}, "a" => list![1.0, 2.5, -0.0, 1e16, 1e300, tup![1, 2.0]],
        "é" => crate::pyset![3, 1, 2], "o" => list![1, 2],
    };
    assert_eq!(json::dumps_ref(&etat), r.at("canon").at("texte").s());
    assert_eq!(json::empreinte(&etat), r.at("canon").at("empreinte").s());
}

#[test]
fn tas() {
    let r = reference();
    let mut g = Random::new(r.at("heapq").at("graine").i());
    // (le jumeau a tiré ses autres références avant celles du tas : on ne rejoue pas son dé, on relit ses sorties)
    let _ = &mut g;
    let avant: Vec<(i64, i64)> = r.at("heapify").at("avant").iter().map(|p| (p.at(0).i(), p.at(1).i())).collect();
    let mut t = avant.clone();
    heapq::heapify(&mut t);
    let apres: Vec<(i64, i64)> = r.at("heapify").at("apres").iter().map(|p| (p.at(0).i(), p.at(1).i())).collect();
    assert_eq!(t, apres);
    // pousser tout puis tout sortir : trié, et les égaux dans l'ordre de Python (heappop sur le tas « apres »)
    let mut sorti = vec![];
    while let Some(x) = heapq::heappop(&mut t) {
        sorti.push(x)
    }
    let mut trie = avant.clone();
    trie.sort();
    assert_eq!(sorti, trie);
    let mut t2 = vec![];
    for x in &avant {
        heapq::heappush(&mut t2, *x)
    }
    assert!(t2.iter().enumerate().all(|(i, x)| i == 0 || t2[(i - 1) / 2] <= *x));
}

#[test]
fn valeurs() {
    let a = dict! {"n" => 3, "x" => 1.5, "l" => list![1, 2, 3]};
    let b = a.clone(); // le même objet, comme une référence de Python
    b.set("n", 4);
    b.inc("x", 1);
    b.at("l").push(4);
    assert_eq!(a.at("n"), 4);
    assert_eq!(a.at("x"), 2.5);
    assert_eq!(a.at("l").len(), 4);
    assert!(a.get("absent").is_none() && a.get_or("absent", 7) == 7);
    assert_eq!(a.at("l").at(-1), 4);
    assert_eq!((&a.at("n") + &a.at("x")).repr(), "6.5");
    assert_eq!((&a.at("n") + 1).repr(), "5");
    assert_eq!((&a.at("n") / 2).repr(), "2.0");
    assert_eq!(a.at("n").floordiv(3).repr(), "1");
    assert_eq!(Val::from(7.5).floordiv(2).repr(), "3.0");
    assert_eq!(a.at("l").slice(Some(1), Some(-1)), list![2, 3]);
    assert_eq!(a.pop("n"), 4);
    assert!(!a.has("n") && a.has("x"));
    assert!(tup![1, "a"] < tup![1, "b"] && Val::from(2) > Val::from(1.5) && Val::from(1) == Val::from(1.0));
    let d = Val::dict();
    d.set(tup!["33", "40"], "paix");
    d.set(1, "un");
    assert_eq!(d.at(tup!["33", "40"]), "paix");
    assert_eq!(d.at(Val::from(1.0)), "un");
    let l = list![3, 1, 2];
    l.sort_by_key(|x| -x.f());
    assert_eq!(l, list![3, 2, 1]);
    assert_eq!(max_by_key(vec![(1, 'a'), (3, 'b'), (3, 'c')], |p| p.0), Some((3, 'b')));
    assert_eq!(min_by_key(vec![(1, 'a'), (1, 'b')], |p| p.0), Some((1, 'a')));
}
