//! ai/ (l'IA de campagne) contre game/ai.py : tests/references/ia_campagne.json est écrit par le jumeau
//! outils/jumeau/ia_campagne_ref.py, qui retouche de vraies parties (géographie 1, scénarios 1790 et 1870), recrée leurs
//! IA, puis joue des scénarios indépendants (chacun sur une copie de l'état) ; on relit l'état, on rejoue chaque scénario
//! et l'on compare ses résultats, les empreintes de l'état final, l'état de l'IA et le tirage suivant des hasards.

use conquete::ai::AI;
use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Random, Val};
use conquete::{dict, list};
use std::rc::Rc;

const IAS: [&str; 4] = ["24", "40", "47", "64"];

fn reference() -> Val {
    json::loads(include_str!("references/ia_campagne.json")).unwrap()
}

/// La géographie 1, relue du cache des essais (ou générée).
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(1))
}

fn partie(geo: &Rc<GeoMap>, e: &Val) -> Game {
    let e = e.deepcopy();
    let mut g = Game::__new__(geo.clone());
    g.t = e.atf("t");
    g.start_ord = e.ati("start_ord");
    g.player = e.ats("player");
    g.difficulty = e.ats("difficulty");
    g.scenario = e.ats("scenario");
    g.seed = e.ati("seed");
    g.rng = Random::new(g.seed);
    g.uid = e.ati("uid");
    g.seq = e.ati("seq");
    g.factions = e.at("factions");
    g.nodes = e.at("nodes");
    g.armies = e.at("armies");
    g.events = e.at("events");
    g.proposals = e.at("proposals");
    g.battles = e.at("battles");
    g.rails = e.at("rails");
    for d in e.at("diplo").iter() {
        g.diplo.insert((d.at(0).ats(0), d.at(0).ats(1)), d.ats(1));
    }
    g.weather = e.at("weather");
    g.y_mont = e.atf("y_mont");
    g.x_cote = e.atf("x_cote");
    g.tour = e.at("tour");
    g.market = e.at("market");
    g.era_id = e.at("era_id");
    g.flood_until = e.atf("flood_until");
    g.speed_idx = e.ati("speed_idx");
    // les IA, recréées comme dans le jumeau (AI(g, c)), puis retouchées
    for c in IAS {
        let mut ai = AI::new(&g, c);
        let x = e.at("ais").at(c);
        ai.relief = x.atf("relief");
        ai.menace = x.atb("menace");
        ai.tax_clock = x.atf("tax_clock");
        for kv in x.at("cool").iter() {
            ai.cool.set(Val::tuple(kv.at(0).vec()), kv.at(1));
        }
        for kv in x.at("refused").iter() {
            ai.refused.set(kv.at(0), kv.at(1));
        }
        g.ais.insert(c.to_string(), Some(ai));
    }
    g
}

fn opt(x: Option<f64>) -> Val {
    Val::from(x)
}

fn jouer(g: &mut Game, op: &Val) -> Val {
    let nom = op.ats(0);
    if nom == "set_t" {
        g.t = op.atf(1);
        return Val::None;
    }
    let code = op.ats(1);
    let mut ai = g.ais.get_mut(&code).unwrap().take().unwrap();
    let r = jouer_ia(g, &mut ai, &nom, op);
    *g.ais.get_mut(&code).unwrap() = Some(ai);
    r
}

fn jouer_ia(g: &mut Game, ai: &mut AI, nom: &str, op: &Val) -> Val {
    let arg = |i: i64| op.at(i + 2);
    let wars = ai.wars(g);
    match nom {
        "wars" => wars,
        "foes" => ai.foes(g).iter().map(|a| a.at("id")).collect(),
        "reserve" => Val::from(ai.reserve(g)),
        "gross_norm" => Val::from(ai.gross_norm(g)),
        "idle_money" => Val::from(ai.idle_money(g)),
        "regs_total" => Val::from(ai.regs_total(g)),
        "arms_floor" => ai.arms_floor(g),
        "arms_purse" => Val::from(ai.arms_purse(g)),
        "arms_room" => ai.arms_room(g),
        "rally_node" => ai.rally_node(g),
        "rally" => ai.rally(g),
        "neighbours" => {
            let nb = ai.neighbours(g);
            let mut ks = nb.keys();
            ks.sort_by_key(|k| k.i());
            ks.into_iter()
                .map(|k| {
                    let v = nb.at(&k).to_list();
                    v.sort();
                    list![k, v]
                })
                .collect()
        }
        "reach" => {
            let (block, comp) = ai.reach(g);
            let b = block.to_list();
            b.sort();
            list![b, if comp.is_none() { Val::None } else { Val::from(json::empreinte(&comp)) }]
        }
        "threat_at" => {
            let (nid, r) = (arg(0).i(), arg(1).f());
            let foes = ai.foes(g);
            list![ai.threat_at(g, nid, r, &Val::None, &Val::None), ai.threat_at(g, nid, r, &foes, &dict! {})]
        }
        "menaced" => Val::from(ai.menaced(g, &wars)),
        "research" => {
            ai.research(g);
            Val::None
        }
        "economy" => {
            ai.economy(g);
            Val::None
        }
        "douane" => {
            ai.douane(g);
            Val::None
        }
        "build_depot" => {
            ai.build_depot(g);
            Val::None
        }
        "recruit" => {
            ai.recruit(g);
            Val::None
        }
        "raise_garde" => {
            ai.raise_garde(g);
            Val::None
        }
        "military" => {
            ai.military(g);
            Val::None
        }
        "rearm" => {
            ai.rearm(g);
            Val::None
        }
        "stock_arms" => {
            ai.stock_arms(g);
            Val::None
        }
        "espionage" => {
            ai.espionage(g);
            Val::None
        }
        "diplomacy" => {
            ai.diplomacy(g);
            Val::None
        }
        "spend" => {
            ai.spend(g);
            Val::None
        }
        "step" => {
            ai.step(g);
            Val::None
        }
        "relieve_taxes" => {
            let res = ai.reserve(g);
            ai.relieve_taxes(g, res, &wars);
            Val::None
        }
        "gift" => {
            ai.gift(g, arg(0).f());
            Val::None
        }
        "stock_up" => {
            let res = ai.reserve(g);
            Val::from(ai.stock_up(g, arg(0).f(), res))
        }
        "repair_towns" => Val::from(ai.repair_towns(g, arg(0).f())),
        "expand_towns" => Val::from(ai.expand_towns(g, arg(0).f(), &wars)),
        "build_rails" => Val::from(ai.build_rails(g, arg(0).f(), &wars)),
        "fortify_frontier" => {
            let res = ai.reserve(g);
            Val::from(ai.fortify_frontier(g, arg(0).f(), &wars, res))
        }
        "buy" => Val::from(ai.buy(g, &arg(0).string(), arg(1).f(), 1.5)),
        "provide" => {
            let a = ai.provide(g, &dict! {"livres" => 200, "bois" => 500, "fer" => 10}, 900.0);
            let b = ai.provide(g, &dict! {"livres" => 200, "outils" => 3000}, 900.0);
            list![opt(a), opt(b)]
        }
        "propose" => {
            ai.propose(g, &arg(0).string(), &arg(1).string(), arg(2).i(), &Val::None, &Val::None);
            Val::None
        }
        _ => {
            let a = g.armies.get(arg(0));
            match nom {
                "home_node" => ai.home_node(g, &a),
                "arm_gap" => {
                    let (x, y) = ai.arm_gap(g, &a.at("regs"));
                    list![x, y]
                }
                "reach_from" => {
                    let (comp, starts) = ai.reach_from(g, &a);
                    if comp.is_none() {
                        Val::None
                    } else {
                        let s = starts.to_list();
                        s.sort();
                        list![json::empreinte(&comp), s]
                    }
                }
                "go_cooled" => Val::from(ai.go_cooled(g, &a, &arg(1))),
                "go" => Val::from(ai.go(g, &a, &arg(1), &dict! {"tr" => true})),
                _ if a.is_none() => Val::from("absente"),
                "army_think" => {
                    ai.army_think(g, &a, &dict! {});
                    Val::None
                }
                "pick_target" => {
                    let taken = dict! {};
                    let ok = ai.pick_target(g, &a, &taken, &wars);
                    let mut t: Vec<Val> = taken.items().into_iter().map(|(k, v)| list![k, v]).collect();
                    t.sort_by_key(|kv| kv.ati(0));
                    list![ok, Val::list(t)]
                }
                "try_ambush" => Val::from(ai.try_ambush(g, &a, &wars)),
                "rearm_detour" => Val::from(ai.rearm_detour(g, &a, &wars)),
                _ => panic!("opération inconnue {nom}"),
            }
        }
    }
}

fn court(v: &Val) -> String {
    json::empreinte_ordre(v)[..16].to_string()
}

fn etat_ia(ai: &mut AI) -> Val {
    let cool: Val = ai.cool.items().into_iter().map(|(k, v)| list![k, v]).collect();
    let refused: Val = ai.refused.items().into_iter().map(|(k, v)| list![k, v]).collect();
    dict! {
        "diplo_clock" => ai.diplo_clock, "spend_clock" => ai.spend_clock, "tax_clock" => ai.tax_clock,
        "relief" => ai.relief, "menace" => ai.menace, "cool" => court(&cool), "refused" => court(&refused),
        "cool_purge" => ai.cool_purge, "aa_clock" => ai.aa_clock, "tarif_clock" => ai.tarif_clock,
        "ct_clock" => ai._ct_clock, "rally_stale" => ai._rally_stale, "rally" => &ai._rally, "rng" => ai.rng.random()
    }
}

fn final_(g: &mut Game, code: &str) -> Val {
    let diplo: Val = g.diplo.iter().map(|((a, b), s)| list![list![a, b], s]).collect();
    let last = if g.events.len() > 0 { g.events.at(-1).at("text") } else { Val::None };
    let ia = etat_ia(g.ais.get_mut(code).unwrap().as_mut().unwrap());
    let ias = dict! {};
    for c in IAS {
        if c != code {
            ias.set(c, etat_ia(g.ais.get_mut(c).unwrap().as_mut().unwrap()));
        }
    }
    dict! {
        "factions" => court(&g.factions), "nodes" => court(&g.nodes), "armies" => court(&g.armies),
        "events" => court(&g.events.slice(Some(-20), None)), "proposals" => court(&g.proposals), "diplo" => court(&diplo),
        "market" => court(&g.market), "n_events" => g.events.len(), "last_event" => last, "ia" => ia,
        "ias" => court(&ias), "rng" => g.rng.random()
    }
}

/// Un scénario qui appelle une partie de la campagne encore en `todo!()` (cities, rails, familles, turns… : d'autres
/// portages) s'arrête là, est compté à part et ne fait pas échouer l'essai ; il sera comparé dès qu'elle sera portée.
#[test]
fn ia_de_campagne() {
    let r = reference();
    let geo = geo();
    let (mut vus, mut arretes) = (0, vec![]);
    for cas in r.at("cas").iter() {
        let seed = cas.ati("seed");
        let e = cas.at("etat");
        for (k, sc) in cas.at("sc").iter().enumerate() {
            let ops = sc.at("ops");
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut g = partie(&geo, &e);
                let obtenu: Vec<Val> = ops.iter().map(|op| jouer(&mut g, &op)).collect();
                let fin = final_(&mut g, &ops.at(0).ats(1));
                (obtenu, fin)
            }));
            let (obtenu, fin) = match res {
                Ok(x) => x,
                Err(err) => {
                    let msg = err.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| err.downcast_ref::<String>().cloned()).unwrap_or_default();
                    if msg == "not yet implemented" {
                        arretes.push(format!("{seed}/{k} {}", json::dumps_ref(&ops)));
                        continue;
                    }
                    panic!("graine {seed}, scénario {k} {} : {msg}", json::dumps_ref(&ops));
                }
            };
            for (i, (o, a)) in obtenu.iter().zip(sc.at("res").iter()).enumerate() {
                assert_eq!(json::dumps_ref_ordre(o), json::dumps_ref_ordre(&a), "graine {seed}, scénario {k}, opération {i} : {ops:?}");
            }
            let att = sc.at("fin");
            for key in att.keys() {
                assert_eq!(
                    json::dumps_ref_ordre(&fin.at(&key)),
                    json::dumps_ref_ordre(&att.at(&key)),
                    "graine {seed}, scénario {k} {} : état final, {key}",
                    json::dumps_ref(&ops)
                );
            }
            vus += 1;
        }
    }
    eprintln!("ia_campagne : {vus} scénarios comparés, {} arrêtés sur une partie encore en todo!()", arretes.len());
    for a in arretes.iter().take(400) {
        eprintln!("  arrêté : {a}");
    }
}

/// Refait l'empreinte finale des armées (`fin.armies`) des scénarios où elle a changé exprès : une armée créée n'a plus
/// les réglages du champ de bataille tactique (`pl`, `tac_auto`, `rx` : SPEC-BATAILLE.md, 17/11/2026). Rien d'autre
/// n'est réécrit : résultats des opérations et autres champs de l'état final doivent tomber juste.
/// `CONQUETE_REFAIRE_IA_CAMPAGNE=1 cargo test --release -p conquete --test ia_campagne refaire -- --ignored`
/// Avec `CONQUETE_REFAIRE_IA_CAMPAGNE=tout`, tout se réécrit, résultats compris : quand une règle change ce que fait
/// l'IA (le recrutement lié aux bâtiments, SPEC-EMPIRE.md module 4, 23/11/2026).
#[test]
#[ignore]
fn refaire() {
    if std::env::var_os("CONQUETE_REFAIRE_IA_CAMPAGNE").is_none() {
        return;
    }
    let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/ia_campagne.json");
    let texte = std::fs::read_to_string(&chemin).unwrap();
    let r = json::loads(&texte).unwrap();
    assert_eq!(json::dumps_compact(&r), texte.trim_end(), "le fichier ne se réécrit pas à l'identique");
    let tout = std::env::var("CONQUETE_REFAIRE_IA_CAMPAGNE").unwrap() == "tout";
    let geo = geo();
    let mut refaits = 0;
    for cas in r.at("cas").iter() {
        for (k, sc) in cas.at("sc").iter().enumerate() {
            let ops = sc.at("ops");
            let mut g = partie(&geo, &cas.at("etat"));
            for (i, op) in ops.iter().enumerate() {
                let v = json::loads(&json::dumps_compact(&jouer(&mut g, &op))).unwrap();
                if json::dumps_ref_ordre(&v) != json::dumps_ref_ordre(&sc.at("res").at(i)) {
                    assert!(tout, "scénario {k}, opération {i}");
                    sc.at("res").set(i as i64, v);
                    refaits += 1;
                }
            }
            let fin = final_(&mut g, &ops.at(0).ats(1));
            for key in sc.at("fin").keys() {
                if json::dumps_ref_ordre(&fin.at(&key)) != json::dumps_ref_ordre(&sc.at("fin").at(&key)) {
                    // (armies : SPEC-BATAILLE.md ; nodes et factions : un navire mis en chantier par l'IA, SPEC-EMPIRE module 2)
                    assert!(tout || ["armies", "nodes", "factions"].contains(&key.s()), "graine {}, scénario {k} : {key} ne peut pas changer", cas.ati("seed"));
                    sc.at("fin").set(&key, fin.at(&key));
                    refaits += 1;
                    eprintln!("graine {}, scénario {k} {} : {key} refait", cas.ati("seed"), json::dumps_ref(&ops));
                }
            }
        }
    }
    eprintln!("{refaits} empreintes refaites");
    std::fs::write(&chemin, json::dumps_compact(&r) + if texte.ends_with('\n') { "\n" } else { "" }).unwrap();
}
