//! La troisième partie du moteur de campagne (engine/batailles.rs, prise.rs) contre Python :
//! tests/references/campagne3.json est écrit par le jumeau outils/jumeau/campagne3_ref.py. Seulement ce qui tourne
//! sans le reste de la partie (visibilité, phases et formations, pertes typées, horloge, ordres du joueur, blocus,
//! capitulation…), sur une partie vide posée sur la géographie 1 ; le reste se vérifie de bout en bout.

use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Random, Val};
use conquete::rules as R;
use conquete::{dict, list, tup};
use std::rc::Rc;

fn reference() -> Val {
    json::loads(include_str!("references/campagne3.json")).unwrap()
}

#[track_caller]
fn pareil(quoi: &str, vu: &Val, attendu: &Val) {
    let (a, b) = (json::dumps_ref_ordre(vu), json::dumps_ref_ordre(attendu));
    if a != b {
        let k = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
        let coupe = |s: &str| String::from_utf8_lossy(&s.as_bytes()[k.saturating_sub(160)..(k + 160).min(s.len())]).to_string();
        panic!("{quoi} : écart au caractère {k}\n vu      …{}…\n attendu …{}…", coupe(&a), coupe(&b));
    }
}

/// La géographie 1, relue du cache des essais.
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(1))
}

const CODES: [&str; 5] = ["33", "24", "40", "47", "64"];

fn partie(geo: &Rc<GeoMap>, cas: &Val) -> Game {
    let mut g = Game::__new__(geo.clone());
    g.start_ord = cas.ati("start_ord");
    g.t = cas.atf("t");
    g.player = cas.ats("player");
    g.factions = cas.at("factions").deepcopy();
    g.nodes = cas.at("nodes").deepcopy();
    g.armies = cas.at("armies").deepcopy();
    g.battles = cas.at("battles").deepcopy();
    g.speed_idx = 4;
    for d in cas.at("diplo").iter() {
        g.diplo.insert((d.at(0).ats(0), d.at(0).ats(1)), d.ats(1));
    }
    g._dirty_income = false;
    g.weather = cas.at("weather").deepcopy();
    g.y_mont = geo.xy(43.2, 0.0).1;
    g.x_cote = geo.xy(44.0, -0.95).0;
    g.market = R::MARKET_BASE().copy();
    g.rng = Random::new(cas.ati("seed"));
    g
}

/// Un ordre : [ok, message].
fn ordre((ok, msg): (bool, String)) -> Val {
    list![ok, msg]
}

fn tri(v: &Val) -> Val {
    let mut l = v.vec();
    l.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Val::list(l)
}

fn mesurer(geo: &Rc<GeoMap>, cas: &Val) -> Val {
    let mut g = partie(geo, cas);
    let n0 = Val::None;
    let out = dict! {};
    g.update_hidden();
    out.set("hidden", Val::dict_from(g.armies.values().iter().map(|a| (a.at("id"), a.at("hidden"))).collect()));
    let vis = list![];
    for c in CODES {
        let (side, srcs) = g.vision_sources(c);
        let (v, _) = g.visible_armies(c);
        vis.push(list![tri(&side), srcs, tri(&v)]);
    }
    out.set("vision", vis);
    let arms = g.armies.values();
    let walls = list![];
    for a in &arms[..9] {
        for b in &arms[..9] {
            walls.push(g.behind_walls(a, b));
        }
    }
    out.set("walls", walls);
    let mut types: Vec<String> = R::UNITS().keys().iter().map(|t| t.string()).collect();
    types.extend(["milice".to_string(), "xyz".to_string()]);
    out.set("arm_class", types.iter().map(|t| Val::from(Game::arm_class(t))).collect::<Val>());
    let gen = list![];
    for a in &arms {
        gen.push(list![g.gen_trait(a), g.gen_level_k(a)]);
    }
    gen.push(list![g.gen_trait(&n0), g.gen_level_k(&n0)]);
    out.set("gen", gen);
    let vul = list![];
    for c in ["artillerie", "cavalerie", "inf"] {
        for t in ["artillerie", "cavalerie", "milice", "ligne"] {
            for fm in ["ligne", "colonne", "carre", "carre_forme", "tirailleurs", "autre"] {
                for p in [false, true] {
                    for ph in ["canonnade", "charge"] {
                        vul.push(g.unit_vul(c, t, fm, p, ph));
                    }
                }
            }
        }
    }
    out.set("vul", vul);
    let bts = list![];
    for bt in g.battles.values() {
        let t0 = g.t;
        let ph = list![];
        for dt in [0.0, 0.3, 0.6, 2.0] {
            g.t = bt.atf("t0") + dt;
            ph.push(g.battle_phase(&bt));
        }
        g.t = t0;
        let r = list![ph];
        for si in 0..2i64 {
            let (foe, cav, art) = g.foe_mix(&bt, si);
            let fms: Val = ["canonnade", "fusillade", "charge"].iter().map(|p| Val::from(g.choose_formation(&n0, &bt, si, p))).collect();
            let morale = if bt.at("sides").at(si).at("node").is_none() { Val::from(g.side_morale(&bt, si)) } else { Val::None };
            r.push(list![foe.len(), cav, art, fms, g.side_men(&bt, si), morale]);
        }
        r.push(cas.at("P").iter().map(|pp| {
            let (w, d) = g.battle_yield(&bt, &pp);
            list![w, d]
        }).collect::<Val>());
        bts.push(r);
    }
    out.set("batailles", bts);
    let pertes = list![];
    for bt in g.battles.values() {
        for si in 0..2i64 {
            let side = bt.at("sides").at(si);
            let tg = list![];
            for u in g.side_units(&bt, si).iter() {
                let (_, r, a) = u.triple();
                tg.push(tup![r.at("n"), r.at("type"), a.get_or("fm", "ligne"), true, &r, &a, 0.9]);
            }
            if side.at("node").is_some() {
                let n = g.nodes.at(side.at("node"));
                tg.push(tup![n.at("milice"), "milice", "ligne", false, &n, Val::None, 1.0]);
                for r in n.at("garrison").iter() {
                    tg.push(tup![r.at("n"), r.at("type"), "ligne", false, &r, Val::None, 1.0]);
                }
            }
            let dmg: Vec<f64> = cas.at("tg").iter().take(tg.len()).map(|x| x.f()).collect();
            let tot = g.apply_typed_losses(&bt, si, &tg, &dmg, 1500.0, if si == 1 { 1.35 } else { 1.0 });
            let regs: Val = side.at("armies").iter().map(|x| g.armies.at(&x).at("regs")).collect();
            let nd = if side.at("node").is_some() { g.nodes.at(side.at("node")) } else { Val::None };
            pertes.push(list![tot, &side, regs, nd]);
        }
    }
    out.set("pertes", pertes);
    let t1 = g.t - 1.5;
    g.restore_clock(t1);
    out.set(
        "clock",
        list![
            g.t,
            g.battles.values().iter().map(|b| b.at("t0")).collect::<Val>(),
            g.armies.values().iter().map(|a| a.at("grace")).collect::<Val>(),
            g.nodes.iter().map(|n| n.at("siege")).filter(|s| s.truthy()).collect::<Val>()
        ],
    );
    g.t = cas.atf("t");
    let b100 = g.battles.at("b100");
    g.dissolve_battle(&b100);
    out.set(
        "dissolve",
        list![
            Val::list(g.battles.keys()),
            arms[..4].iter().map(|a| list![a.at("state"), a.at("battle"), a.at("grace")]).collect::<Val>()
        ],
    );
    out.set("fname", CODES.iter().chain([&R::NEUTRAL]).map(|c| Val::from(g.fname(c))).collect::<Val>());
    let depot = list![];
    for a in &arms {
        depot.push(g.depot_near(a, &n0));
    }
    let impairs: Val = g.nodes.iter().filter(|n| n.ati("id") % 2 == 1).collect();
    depot.push(g.depot_near(&arms[0], &impairs));
    out.set("depot", depot);
    let intel = list![];
    for c in CODES {
        let mut ks: Vec<Val> = g.factions.at(c).at("intel").keys();
        ks.push(Val::from("3"));
        for k in ks {
            intel.push(g.intel_active(c, k.s().parse().unwrap()));
        }
    }
    out.set("intel", intel);
    let p = g.player.clone();
    let ordres = list![];
    let valeurs = [
        Val::from(0.37), Val::from("0.555"), Val::from(" 0.4 "), Val::from("abc"), Val::None, Val::from(f64::INFINITY),
        Val::from(2), Val::from(true), Val::from(-3), Val::from(0.125), list![1],
    ];
    for v in &valeurs {
        ordres.push(list!["tax", ordre(g.set_tax(&p, v)), g.factions.at(&p).at("tax")]);
        ordres.push(list!["slider", ordre(g.set_slider(&p, v)), g.factions.at(&p).at("slider")]);
    }
    for v in [Val::from(0), Val::from(3), Val::from(4), Val::from(-1), Val::from(true), Val::from("1"), Val::from(2.0), Val::from(2)] {
        ordres.push(list!["tarif", ordre(g.set_tarif(&p, &v)), g.factions.at(&p).at("tarif")]);
    }
    for v in [Val::from(true), Val::from(false), Val::from(1), Val::from("x"), Val::from(true)] {
        ordres.push(list!["douaniers", ordre(g.set_douaniers(&p, &v)), g.factions.at(&p).at("douaniers")]);
    }
    out.set("ordres", ordres);
    out.set("stab", g.stab_targets());
    let marche = list![];
    let trades = [
        ("vivres", Val::from(50), "buy"), ("fer", Val::from("20"), "sell"), ("recrues", Val::from(900), "buy"),
        ("bois", Val::from(2000.7), "buy"), ("or", Val::from(5), "buy"), ("fer", Val::from(5), "troc"),
        ("fer", Val::from("x"), "buy"), ("fer", Val::from(0.5), "buy"), ("fer", Val::from(f64::NAN), "sell"),
        ("armes", Val::from(3000), "sell"), ("bois", Val::from(10), "sell"), ("vivres", Val::None, "buy"),
    ];
    for (res, qty, side) in &trades {
        let o = ordre(g.market_trade(&p, &Val::from(*res), qty, &Val::from(*side)));
        marche.push(list![*res, o, g.factions.at(&p).at("res").copy()]);
    }
    out.set("marche", list![marche, &g.market]);
    let enroll = list![];
    for o in CODES.iter().chain([&R::NEUTRAL]) {
        enroll.push(ordre(g.enroll(&p, o)));
    }
    enroll.push(g.factions.at(&p).at("prisoners"));
    out.set("enroll", enroll);
    let st = list![];
    for a in &arms {
        for s in ["embuscade", "retranche", "x", "normal"] {
            st.push(ordre(g.set_stance(&a.ats("owner"), &a.at("id"), &Val::from(s))));
        }
        st.push(ordre(g.set_stance(&p, &a.at("id"), &Val::from("normal"))));
        st.push(list![a.at("stance"), a.at("state"), a.at("path")]);
    }
    out.set("stance", st);
    let gar = list![];
    for a in &arms {
        if g.armies.has(&a.at("id")) {
            gar.push(ordre(g.to_garrison(&a.ats("owner"), &a.at("id"))));
        }
    }
    let garnisons: Val = g.nodes.iter().map(|n| n.at("garrison")).filter(|x| x.truthy()).collect();
    out.set("garnison", list![gar, Val::list(g.armies.keys()), garnisons]);
    // une armée au repos dans une place du joueur reçoit des régiments de la garnison (form_army, into)
    let fa = list![];
    if let Some(n) = g.nodes.iter().find(|n| n.at("owner") == p) {
        let nid = n.ati("id");
        let gn = geo.nodes.at(nid);
        n.set("garrison", cas.at("gar99").deepcopy());
        g.armies.set(
            "a99",
            dict! {"id" => "a99", "owner" => &p, "x" => gn.at("x"), "y" => gn.at("y"), "at_node" => nid, "state" => "idle", "regs" => list![]},
        );
        let ids: Val = n.at("garrison").iter().map(|r| r.at("id")).collect();
        fa.push(ordre(g.form_army(&p, nid, &ids.slice(None, Some(2)), &Val::from("a99"))));
        fa.push(ordre(g.form_army(&p, nid, &Val::from("r"), &Val::from("a99"))));
        fa.push(ordre(g.form_army(&p, nid, &ids, &Val::from("a98"))));
        fa.push(g.armies.at("a99").at("regs"));
        fa.push(n.at("garrison"));
    }
    out.set("form_army", fa);
    g.factions.at("33").set("alive", true);
    g.set_status("33", "24", "guerre");
    g.set_status("40", "33", "guerre");
    g.compute_blockades();
    let b1 = tri(&g._blockade);
    g.set_status("33", "24", "paix");
    g.compute_blockades();
    out.set("blocus", list![b1, tri(&g._blockade)]);
    g.check_end();
    out.set("fin", list![&g.over, g.speed_idx]);
    g.over = Val::None;
    let autres: Vec<&str> = CODES.iter().copied().filter(|c| *c != p).collect();
    let (loser, winner) = (autres[0], autres[1]);
    g.factions.at(loser).set("alive", true);
    g.capitulate(loser, winner);
    g.capitulate(loser, winner);
    out.set(
        "capitule",
        list![
            g.nodes.iter().map(|n| n.at("owner")).collect::<Val>(),
            Val::list(g.armies.keys()),
            &g.factions,
            g.diplo.iter().map(|((a, b), v)| list![a.as_str(), b.as_str(), v.as_str()]).collect::<Val>(),
            g.battles.values().iter().map(|b| b.at("sides")).collect::<Val>()
        ],
    );
    g.check_end();
    out.set("fin2", list![&g.over, g.speed_idx]);
    out.set("journal", &g.events);
    out.set("hasard", g.rng.random());
    out
}

/// Les ordres que le serveur Python refusait par une exception (« exc ») : refusés ici sans arrêt, avec son message.
/// entrees : des listes dont l'élément 1 est le [ok, message] de l'ordre.
fn exc_rattrapees(entrees: &Val, attendues: &Val) {
    for (e, f) in entrees.iter().zip(attendues.iter()) {
        if f.at(1) == "exc" {
            let o = e.at(1);
            assert!(!o.atb(0) && o.at(1).s().starts_with("Commande invalide ("), "{o:?}");
            e.set(1, "exc");
        }
    }
}

#[test]
fn partie_sans_le_reste() {
    let r = reference();
    let geo = geo();
    for (i, j) in r.at("jeux").iter().enumerate() {
        let vu = mesurer(&geo, &j.at("cas"));
        let attendu = j.at("vu");
        exc_rattrapees(&vu.at("ordres"), &attendu.at("ordres"));
        exc_rattrapees(&vu.at("marche").at(0), &attendu.at("marche").at(0));
        for k in attendu.keys() {
            pareil(&format!("cas {i}, {k}"), &vu.at(&k), &attendu.at(&k));
        }
        assert_eq!(vu.len(), attendu.len());
    }
}
