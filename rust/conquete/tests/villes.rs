//! Villes, événements et familles (cities.rs, events.rs, familles.rs) contre Python : tests/references/villes.json est
//! écrit par le jumeau outils/jumeau/villes_ref.py. D'abord ce qui ne dépend que de son entrée (textes des effets,
//! cumuls des bâtiments, règles), puis des parties vides posées sur la géographie 1, où chaque opération du jumeau est
//! rejouée et son résultat comparé. Les opérations rangées après 'tt' passent par turns::deadline : tant que turns.rs
//! n'est pas porté, elles sont sautées (le reste de la partie avec elles).

use conquete::ai::AI;
use conquete::cities as CT;
use conquete::engine::Game;
use conquete::events as EV;
use conquete::familles as FM;
use conquete::geo::GeoMap;
use conquete::py::{json, Random, Val};
use conquete::rules as R;
use conquete::{dict, list};
use std::panic::{self, AssertUnwindSafe};
use std::rc::Rc;

fn reference() -> Val {
    json::loads(include_str!("references/villes.json")).unwrap()
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

#[test]
fn textes_et_cumuls() {
    let r = reference().at("pur");
    let e = r.at("entrees");
    let n: Val = e.at("nombres").iter().map(|x| Val::from(CT::_n(x.f()))).collect();
    pareil("_n", &n, &r.at("n"));
    // (SPEC-EMPIRE, module 4 : le jumeau ne connaît ni les chaînes d'Empire ni `bat` ; on compare ce qu'il connaît)
    let connues = r.at("rules").at("chains");
    let mut fxs: Vec<Val> = vec![];
    for (k, c) in CT::CHAINS().items() {
        if connues.has(&k) {
            fxs.extend(c.at("levels").iter().map(|l| l.at("fx")));
        }
    }
    fxs.extend(CT::_PFX().values());
    fxs.extend(e.at("autres_fx").iter());
    let t: Val = fxs.iter().map(|fx| list![CT::fx_text(fx, &Val::None, false), CT::fx_text(fx, &Val::None, true)]).collect();
    pareil("fx_text", &t, &r.at("fx_text"));
    let p: Val = e.at("pcts").iter().map(|v| list![EV::_pct(v.f()), CT::_pct(v.f())]).collect();
    pareil("_pct", &p, &r.at("pct"));
    let y: Val = e.at("jours").iter().map(|d| Val::from(EV::_years(d.f()))).collect();
    pareil("_years", &y, &r.at("years"));
    let y: Val = e.at("jours").iter().map(|d| Val::from(CT::tours_of(d.f()))).collect();
    pareil("tours_of", &y, &r.at("tours_of"));
    let m: Val = e.at("min1").iter().map(|s| Val::from(EV::_min1(s.s()))).collect();
    pareil("_min1", &m, &r.at("min1"));
    let rp = CT::rules_payload();
    for (k, c) in rp.at("chains").items() {
        if !connues.has(&k) {
            rp.at("chains").del(&k);
        } else {
            c.at("levels").iter().for_each(|l| l.del("bat"));
        }
    }
    rp.set("order", rp.at("order").iter().filter(|k| connues.has(k)).collect::<Val>());
    pareil("rules_payload", &rp, &r.at("rules"));
    pareil("_PFX", &CT::_PFX(), &r.at("pfx"));
    for (i, c) in r.at("bfx").iter().enumerate() {
        pareil(&format!("bfx {i}"), &CT::bfx(&dict! {"slots" => c.at(0)}), &c.at(1));
    }
    let add = list![];
    for w in [1.0, 0.25, 0.7] {
        let tot = dict! {"livres" => 1, "ev" => dict! {"foire" => 1}};
        let fx = dict! {"livres" => 0.1, "xp" => 5, "ev" => dict! {"foire" => 0.5, "disette" => -0.3}, "name" => "x", "flag" => true};
        CT::_add(&tot, &fx, w);
        add.push(tot);
    }
    pareil("_add", &add, &r.at("add"));
    let tv = list![];
    for t in e.at("tmods").iter() {
        for m in e.at("mods_t").iter() {
            tv.push(EV::tmod_value(&t, &m));
        }
    }
    pareil("tmod_value", &tv, &r.at("tmod_value"));
    let nodes: Val = r.at("bfx").iter().map(|c| dict! {"slots" => c.at(0)}).collect();
    pareil("prestige", &Val::from(CT::prestige(&nodes)), &r.at("prestige"));
}

fn partie(geo: &Rc<GeoMap>, cas: &Val) -> Game {
    let mut g = Game::__new__(geo.clone());
    g.seed = cas.ati("seed");
    g.start_ord = cas.ati("start_ord");
    g.t = cas.atf("t");
    g.player = cas.ats("player");
    g.factions = cas.at("factions").deepcopy();
    g.nodes = cas.at("nodes").deepcopy();
    g.armies = cas.at("armies").deepcopy();
    g.speed_idx = 4;
    g.flood_until = cas.atf("flood_until");
    for d in cas.at("diplo").iter() {
        g.diplo.insert((d.at(0).ats(0), d.at(0).ats(1)), d.ats(1));
    }
    g._dirty_income = false;
    g.rng = Random::new(cas.ati("seed"));
    g.ev_done = list![];
    g.tour = dict! {"on" => cas.at("tour")};
    g
}

fn ia(code: &str) -> AI {
    AI {
        code: code.to_string(),
        pers: R::FACTIONS().at(code).at("personality"),
        rng: Random::new(0),
        diplo_clock: 0.0,
        spend_clock: 0.0,
        tax_clock: 0.0,
        relief: 0.0,
        menace: false,
        cool: dict! {},
        refused: dict! {},
        cool_purge: 0.0,
        aa_clock: 0.0,
        tarif_clock: 0.0,
        _ct_clock: 0.0,
        _rally_stale: false,
        _rally: Val::None,
        _nb: Val::None,
        _cache_reach: None,
        marine_clock: 0.0, // (SPEC-EMPIRE, module 2)
        commerce_clock: 0.0, // (SPEC-EMPIRE, module 7)
    }
}

fn fx_de(src: &str, eid: &Val, ci: i64) -> Val {
    let ev = match src {
        "hist" => EV::HIST_BY_ID().at(eid),
        "rand" => EV::RANDOM_BY_ID().at(eid),
        _ => CT::LOCAL_BY_ID().at(eid),
    };
    if ci < 0 { ev.at("base") } else { ev.at("choices").at(ci).at("fx") }
}

fn ok_msg((ok, msg): (bool, String)) -> Val {
    list![ok, msg]
}

/// Une opération du jumeau, rejouée ; rend ce que le jumeau a noté.
fn jouer(g: &mut Game, op: &Val) -> Val {
    let k = op.ats(0);
    let a = |i: i64| op.at(i + 1);
    let nd = |g: &Game, i: i64| g.nodes.at(op.at(i + 1));
    match k.as_str() {
        "slot_count" => Val::from(CT::slot_count(g, &nd(g, 0))),
        "bfx" => CT::bfx(&nd(g, 0)),
        "pfx" => CT::pfx(g, &nd(g, 0)),
        "policy_w" => Val::from(CT::policy_w(g, &nd(g, 0))),
        "stab_bonus" => Val::from(CT::stab_bonus(g, &nd(g, 0))),
        "growth_k" => Val::from(CT::growth_k(g, &nd(g, 0))),
        "train_k" => Val::from(CT::train_k(g, &nd(g, 0), a(1).s())),
        "train_xp" => CT::train_xp(g, &nd(g, 0)),
        "river" => CT::_river(g, a(0).i()),
        "hilly" => Val::from(CT::_hilly(g, a(0).i())),
        "trading" => Val::from(CT::_trading(g, a(0).i())),
        "troops" => Val::from(CT::_troops(g, &nd(g, 0), a(1).s())),
        "fill_ct" => Val::from(CT::_fill(g, a(0).i(), a(1).s())),
        "node_extra" => {
            let out = Val::dict_from(CT::PROD().iter().map(|r| (r, Val::from(1.25))).collect());
            let tr = CT::node_extra(g, &nd(g, 0), a(1).s(), &out, a(2).f());
            list![tr, out]
        }
        "node_view" => {
            let v = CT::node_view(g, &nd(g, 0));
            for k in ["slots", "slot_max", "chains"] {
                v.del(k); // (SPEC-EMPIRE, module 4 : inconnus du jumeau ; vérifiés par bancs_campagne)
            }
            v
        }
        "weights" => CT::weights(g, &nd(g, 0)).into_iter().map(|(e, w)| list![e.at("id"), w]).collect(),
        "w" => {
            let gn = g.geo.nodes.at(a(1));
            Val::from(CT::_LOCAL_WEIGHT(a(0).s())(g, &nd(g, 1), &gn, &g.season()))
        }
        "fits" => Val::from(CT::fits(g, a(0).i(), a(1).s())),
        "check" => {
            let (lvl, why) = CT::check(g, a(0).s(), &nd(g, 1), a(2).s());
            list![Val::from(lvl), Val::from(why)]
        }
        "level_name" => Val::from(CT::level_name(g, a(0).i(), a(1).s(), a(2).i())),
        "level_tech" => Val::from(CT::level_tech(g, a(0).i(), a(1).s(), a(2).i())),
        "ai_value" => Val::from(CT::_ai_value(g, &ia(a(0).s()), &nd(g, 1), a(2).s(), a(3).i(), a(4).f())),
        "upkeep" => Val::from(CT::upkeep(g, a(0).s())),
        "college_k" => Val::from(CT::college_k(g, a(0).s())),
        "prestige" => Val::from(CT::prestige(&g.nodes)),
        "research" => {
            CT::research(g);
            g.factions.values().iter().map(|f| f.at("research")).collect()
        }
        "factions" => Val::from(json::empreinte_ordre(&g.factions)),
        "state" => {
            let diplo: Val = g.diplo.iter().map(|((x, y), v)| list![x, y, v]).collect();
            list![json::empreinte_ordre(&g.nodes), diplo, g.uid, g.over.clone(), g.speed_idx, g._dirty_income]
        }
        "journal" => {
            let j = g.events.iter().map(|e| list![e.at("kind"), e.at("text"), e.at("who"), e.at("important"), e.at("x")]).collect();
            g.events = list![];
            j
        }
        "slot_build" => ok_msg(CT::slot_build(g, a(0).s(), a(1).i(), a(2).s())),
        "demolish" => ok_msg(CT::demolish(g, a(0).s(), a(1).i(), a(2).s())),
        "finish" => {
            let n = nd(g, 0);
            let Some(q) = n.at("queue").iter().find(|q| q.at("kind") == "slot") else {
                return Val::None;
            };
            n.at("queue").remove(&q);
            CT::finish(g, &n, &q);
            q
        }
        "sync" => {
            CT::sync(g, &nd(g, 0));
            Val::None
        }
        "node" => {
            let n = nd(g, 0);
            list![
                n.get("slots"), n.at("queue"), n.at("milice"), n.at("milice_max"), n.at("depot"), n.get("pol"), n.get("tm"),
                n.get("bo"), n.at("stab"), n.at("pop")
            ]
        }
        "set_t" => {
            g.t = a(0).f();
            Val::None
        }
        "set_flood" => {
            g.flood_until = a(0).f();
            Val::None
        }
        "describe" => EV::describe(g, a(0).s(), &a(1), &a(2)),
        "affordable" => Val::from(EV::affordable(g, a(0).s(), &a(1))),
        "soften" => EV::soften(g, a(0).s(), a(1).s(), &a(2)),
        "describe_ev" => EV::describe(g, a(0).s(), &fx_de(a(1).s(), &a(2), a(3).i()), &a(4)),
        "affordable_ev" => Val::from(EV::affordable(g, a(0).s(), &fx_de(a(1).s(), &a(2), a(3).i()))),
        "soften_ev" => EV::soften(g, a(0).s(), a(2).s(), &fx_de(a(1).s(), &a(2), a(3).i())),
        "apply_ev" => {
            EV::apply(g, a(0).s(), &fx_de(a(1).s(), &a(2), a(3).i()), &a(4));
            let f = g.factions.at(a(0));
            list![f.at("res"), json::empreinte_ordre(&f)]
        }
        "apply" => {
            EV::apply(g, a(0).s(), &a(1), &a(2));
            g.factions.at(a(0))
        }
        "ev_fire" => {
            let ev = if a(1) == "hist" { EV::HIST_BY_ID().at(a(2)) } else { EV::RANDOM_BY_ID().at(a(2)) };
            EV::fire(g, a(0).s(), &ev, a(1).s());
            Val::None
        }
        "add_pending" => {
            g.pending_ev.push(a(0).deepcopy());
            Val::None
        }
        "resolve" => ok_msg(EV::resolve(g, a(0).s(), a(1).i(), a(2).truthy())),
        "expire" => {
            EV::expire(g);
            g.pending_ev.clone()
        }
        "nouvelle" => FM::nouvelle(g, a(0).s()),
        "titre" => Val::from(FM::titre(g)),
        "epoux" => FM::epoux(g, a(0).s()),
        "vue" => FM::vue(g, a(0).s()),
        "lie" => Val::from(FM::lie(g, a(0).s(), a(1).s())),
        "refus" => Val::from(FM::refus_mariage(g, a(0).s(), a(1).s())),
        "marier_si" => {
            let why = FM::refus_mariage(g, a(0).s(), a(1).s());
            if why.is_none() {
                FM::marier(g, a(0).s(), a(1).s());
            }
            Val::from(why)
        }
        "guerre" => {
            FM::guerre(g, a(0).s(), a(1).s());
            g.factions.at(a(0)).get("tmods")
        }
        "annuel" => {
            FM::annuel(g);
            Val::None
        }
        "mort_si" => {
            let m = g.factions.at(a(0)).at("maison");
            if !m.atb("chef") || (a(0) == g.player && !m.atb("heritiers")) {
                return Val::from(false);
            }
            let mut rnd = FM::_rng(g, a(0).s(), a(1).s());
            FM::mort(g, a(0).s(), &mut rnd);
            Val::from(true)
        }
        "appliquer" => {
            FM::appliquer(g, a(0).s(), &a(1));
            g.factions.at(a(0)).at("maison")
        }
        "ev_tick" => {
            for _ in 0..a(0).i() {
                g.t += 1.0;
                let d = g.date(&Val::None);
                EV::tick(g, d);
                if d.month == 1 && d.day == 1 {
                    FM::annuel(g);
                }
            }
            g.ev_done.clone()
        }
        "hasard" => Val::from(g.rng.random()),
        "tt" => Val::None,
        "set_policy" => ok_msg(CT::set_policy(g, a(0).s(), a(1).i(), a(2).s(), a(3).truthy())),
        "ct_fire" => {
            let ev = if a(2).is_none() { Val::None } else { CT::LOCAL_BY_ID().at(a(2)) };
            Val::from(CT::fire(g, a(0).s(), &nd(g, 1), &ev))
        }
        "stats" => CT::stats(g),
        "ct_daily" => {
            let d = g.date(&Val::None);
            CT::daily(g, d);
            Val::None
        }
        "grande_crue" => {
            CT::grande_crue(g);
            Val::None
        }
        _ => panic!("opération inconnue {k}"),
    }
}

/// Le message d'une panique (`todo!()` : « not yet implemented »).
fn message(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default()
}

#[test]
fn parties() {
    let geo = geo();
    let r = reference();
    let mut sautees = 0;
    for (i, jeu) in r.at("jeux").iter().enumerate() {
        let cas = jeu.at("cas");
        let mut g = partie(&geo, &cas);
        let (ops, vu) = (jeu.at("ops").vec(), jeu.at("vu").vec());
        let tt = ops.iter().position(|o| o.at(0) == "tt").unwrap();
        for (j, (op, attendu)) in ops.iter().zip(&vu).enumerate() {
            let res = if j < tt {
                jouer(&mut g, op)
            } else {
                // après 'tt' : turns::deadline peut manquer encore (le reste de la partie est alors sauté)
                match panic::catch_unwind(AssertUnwindSafe(|| jouer(&mut g, op))) {
                    Ok(v) => v,
                    Err(p) if message(&p).contains("not yet implemented") => {
                        eprintln!("partie {i} : opérations {j} et suivantes sautées ({op:?} attend un module encore à porter)");
                        sautees += 1;
                        break;
                    }
                    Err(p) => panic::resume_unwind(p),
                }
            };
            pareil(&format!("partie {i}, opération {j} {op:?}"), &res, attendu);
        }
    }
    eprintln!("{sautees} fin(s) de partie sautée(s)");
}

/// Refait les résultats attendus des parties (`jeux[*].vu`) qui diffèrent, avec le moteur Rust, quand une règle change
/// exprès ce qu'elles donnent (la mémoire des camps, SPEC-POLITIQUE module 6 : une succession qui mène à la guerre laisse
/// un souvenir). Les cas et les opérations restent ; chaque différence est dite sur la sortie d'erreur, à relire.
/// `CONQUETE_REFAIRE_VILLES=1 cargo test --release -p conquete --test villes refaire -- --ignored --nocapture`
#[test]
#[ignore]
fn refaire() {
    if std::env::var_os("CONQUETE_REFAIRE_VILLES").is_none() {
        return;
    }
    let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/villes.json");
    let texte = std::fs::read_to_string(&chemin).unwrap();
    let r = json::loads(&texte).unwrap();
    assert_eq!(json::dumps_compact(&r), texte.trim_end(), "le fichier ne se réécrit pas à l'identique");
    let geo = geo();
    for (i, jeu) in r.at("jeux").iter().enumerate() {
        let mut g = partie(&geo, &jeu.at("cas"));
        let (ops, vu) = (jeu.at("ops").vec(), jeu.at("vu"));
        for (j, op) in ops.iter().enumerate().take(vu.len()) {
            let res = json::loads(&json::dumps_compact(&jouer(&mut g, op))).unwrap();
            if json::dumps_ref_ordre(&res) != json::dumps_ref_ordre(&vu.at(j as i64)) {
                eprintln!("partie {i}, opération {j} {op:?} réécrite");
                vu.set(j as i64, res);
            }
        }
    }
    std::fs::write(&chemin, json::dumps_compact(&r) + if texte.ends_with('\n') { "\n" } else { "" }).unwrap();
}
