//! turns.rs, rails.rs, crue.rs, battle_log.rs et views.rs contre game/turns.py, rails.py, crue.py, battle_log.py et
//! views.py : tests/references/tours.json est écrit par le jumeau outils/jumeau/tours_ref.py.
//!
//! - crue : les fonctions de calcul, le relief et la distance au fleuve (_Terre), inonde, spans de la géographie 1 ;
//! - deux sauvegardes d'une vraie partie Python (en plein tour des IA, batailles en cours ; au tour du joueur, bataille
//!   tactique engagée) : posées champ par champ (sans migrate ni IA), to_dict doit les réécrire comme le Python, puis
//!   une suite d'opérations (calendrier, temps en tours, marches estimées, vues, récapitulatif, chemins de fer, journal
//!   des batailles) jouée des deux côtés doit rendre les mêmes résultats et le même état ;
//! - l'aller-retour complet (views::from_dict puis to_dict), la vue du navigateur (player_state) et rules_payload :
//!   ils passent par cities, events, familles et l'IA de campagne, portés à part ; tant qu'un de ces corps est un
//!   `todo!()`, l'essai le dit et s'arrête là (il vérifie tout dès qu'ils sont portés).

use conquete::battle_log as BL;
use conquete::crue as CR;
use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{self, json, Random, Val};
use conquete::rails as RL;
use conquete::engine::raccord as TB;
use conquete::turns as TT;
use conquete::views as V;
use conquete::{dict, list};
use std::rc::Rc;

fn reference() -> Val {
    std::env::set_var("WEB_CONQUETE_NOLOG", "1"); // (le journal des batailles n'écrit rien)
    json::loads(include_str!("references/tours.json")).unwrap()
}

/// La géographie 1, relue du cache des essais (ou générée).
fn geo() -> Rc<GeoMap> {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(1))
}

/// Ce qu'une sauvegarde relue rend : tuples en listes, clés en textes (le `j` du jumeau).
fn j(v: &Val) -> Val {
    json::loads(&json::dumps_compact(v)).unwrap()
}

fn egal(a: &Val, b: &Val) -> bool {
    json::dumps_ref(&j(a)) == json::dumps_ref(b)
}

/// f, sauf si elle tombe sur un corps encore en `todo!()` (cities, events, familles, ai : portés à part).
fn en_attente<T>(quoi: &str, f: impl FnOnce() -> T) -> Option<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => Some(r),
        Err(e) => {
            let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            if msg.contains("not yet implemented") {
                eprintln!("{quoi} : en attente d'un corps encore à porter ({msg})");
                None
            } else {
                std::panic::resume_unwind(e)
            }
        }
    }
}

/// La partie d'une sauvegarde, champ par champ, sans migrate ni IA (`assembler` du jumeau).
fn assembler(geo: &Rc<GeoMap>, s: &Val) -> Game {
    let s = s.deepcopy();
    let mut g = Game::__new__(geo.clone());
    let v = |k: &str| if s.has(k) { s.at(k) } else { V::DEFAULTS(k) };
    g.player = v("player").string();
    g.difficulty = v("difficulty").string();
    g.seed = v("seed").i();
    g.t = v("t").f();
    g.uid = v("uid").i();
    g.seq = v("seq").i();
    g.events = v("events");
    g.proposals = v("proposals");
    g.armies = v("armies");
    g.battles = v("battles");
    g.over = v("over");
    g.flood_until = v("flood_until").f();
    g.market = v("market");
    g.weather = v("weather");
    g.factions = v("factions");
    g.nodes = v("nodes");
    g._ai_clock = v("_ai_clock");
    g.spies = v("spies");
    g.scenario = v("scenario").string();
    g.start_ord = v("start_ord").i();
    g.era_id = v("era_id");
    g.pending_ev = v("pending_ev");
    g.ev_done = v("ev_done");
    g.tour = v("tour");
    g.rails = v("rails");
    g.sites = v("sites");
    g._blockade = s.get_or("blockade", list![]).to_set();
    for e in s.at("diplo").iter() {
        g.diplo.insert((e.ats(0), e.ats(1)), e.ats(2));
    }
    g.rng = Random::new(g.seed + py::int(g.t * 1000.0));
    g._last_day = py::int(g.t);
    g.y_mont = geo.xy(43.2, 0.0).1;
    g.x_cote = geo.xy(44.0, -0.95).0;
    for p in g.proposals.iter() {
        if p.getb("give") {
            p.set("give", p.at("give").to_tuple());
            p.set("get", p.at("get").to_tuple());
        }
    }
    TB::load_from(&mut g, &s);
    g
}

// ================================================================== crue

#[test]
fn crue_comme_python() {
    let r = reference().at("crue");
    for c in r.at("hash2").iter() {
        assert_eq!(CR::_hash2(c.ati(0), c.ati(1), c.ati(2)).to_bits(), c.atf(3).to_bits(), "_hash2 {c}");
    }
    for c in r.at("sn").iter() {
        assert_eq!(CR::_sn(c.atf(0)).to_bits(), c.atf(1).to_bits(), "_sn {c}");
    }
    for c in r.at("bruit").iter() {
        assert_eq!(CR::_bruit(c.atf(0), c.atf(1), c.atf(2)).to_bits(), c.atf(3).to_bits(), "_bruit {c}");
    }
    for c in r.at("sur").iter() {
        let (x, y) = CR::_sur(&c.at(0), c.atf(1));
        assert!(egal(&list![x, y], &c.at(2)), "_sur {c}");
    }
    for c in r.at("rayon").iter() {
        assert_eq!(CR::_rayon(&c.at(0)).to_bits(), c.atf(1).to_bits(), "_rayon {c}");
    }
    let geo = geo();
    let m = geo.client_payload();
    let t = CR::_Terre::new(&geo, &m.at("rivers"));
    let tr = r.at("terre");
    assert_eq!((t.W, t.H), (tr.ati("W"), tr.ati("H")));
    let alt: Val = t.ALT.iter().map(|&v| Val::from(v as f64)).collect();
    let cru: Val = t.CRUE.iter().map(|&v| Val::from(v as f64)).collect();
    assert!(egal(&alt.slice(None, Some(50)), &tr.at("alt0")), "ALT[:50]");
    assert_eq!(json::empreinte(&alt), tr.ats("alt"), "ALT");
    assert_eq!(json::empreinte(&cru), tr.ats("crue"), "CRUE");
    let mut noyes = 0;
    for p in tr.at("pts").iter() {
        let (x, y) = (p.atf(0), p.atf(1));
        assert_eq!(t._bil(&t.ALT, x, y).to_bits(), p.atf(2).to_bits(), "_bil ALT {p}");
        assert_eq!(t._bil(&t.CRUE, x, y).to_bits(), p.atf(3).to_bits(), "_bil CRUE {p}");
        assert_eq!(t.inonde(x, y), p.atb(4), "inonde {p}");
        noyes += p.atb(4) as i32;
    }
    assert!(noyes > 10, "assez de points noyés pour que l'essai dise quelque chose ({noyes})");
    let sp = CR::spans(&geo);
    let rs = r.at("spans");
    assert_eq!(sp.len() as i64, rs.ati("n"));
    assert_eq!(json::empreinte_ordre(&j(&sp)), rs.ats("empreinte"), "spans");
    assert!(CR::spans(&geo).is(&sp), "spans : le même dict au second appel");
}

// ================================================================== sauvegardes posées champ par champ

#[test]
fn to_dict_comme_python() {
    let r = reference();
    let geo = geo();
    for c in r.at("cas").iter() {
        let mut g = assembler(&geo, &c.at("save"));
        let d = V::to_dict(&mut g);
        assert_eq!(json::empreinte_ordre(&j(&d)), c.ats("to_dict"), "to_dict de la sauvegarde « {} »", c.at("nom"));
    }
}

fn jouer(g: &mut Game, op: &Val) -> Val {
    let nom = op.ats(0);
    let arg = |i: i64| op.at(i + 1);
    let s = |i: i64| op.at(i + 1).string();
    let f = |i: i64| op.at(i + 1).f();
    let a = |g: &Game, i: i64| g.armies.at(op.at(i + 1));
    let geo = g.geo.clone();
    let ok = |r: (bool, Option<String>)| list![r.0, r.1];
    match nom.as_str() {
        "set" => {
            let mut o = match arg(0).s() {
                "armies" => g.armies.clone(),
                "nodes" => g.nodes.clone(),
                "factions" => g.factions.clone(),
                _ => g.rails.clone(),
            };
            let k = op.len() as i64;
            for i in 2..k - 2 {
                o = o.at(op.at(i));
            }
            o.set(op.at(k - 2), op.at(k - 1).deepcopy());
            Val::None
        }
        "rng" => Val::from(g.rng.random()),
        "month_end" => Val::from(TT::month_end(g, &arg(0), arg(1).i())),
        "month_days" => Val::from(TT::month_days(g, f(0))),
        "turn_start_after" => Val::from(TT::turn_start_after(g, f(0))),
        "tours_left" => Val::from(TT::tours_left(g, f(0))),
        "work" => Val::from(TT::work(g, f(0))),
        "ready_in" => Val::from(TT::ready_in(g, f(0))),
        "deadline" => {
            let who: Vec<String> = arg(1).iter().map(|c| c.string()).collect();
            let who: Vec<&str> = who.iter().map(String::as_str).collect();
            Val::from(TT::deadline(g, arg(0).i(), &who))
        }
        "part_tour" => Val::from(TT::part_tour(f(0))),
        "planning" => Val::from(TT::planning(g)),
        "phase" => Val::from(TT::phase(g)),
        "march_days" => Val::from(TT::march_days(g)),
        "lock_reason" => Val::from(TT::lock_reason(g)),
        "view" => TT::view(g),
        "_scan" => TT::_scan(g),
        "_new_acc" => TT::_new_acc(g),
        "_settled" => Val::from(TT::_settled(g)),
        "_recap" => TT::_recap(g),
        "migrate" => {
            TT::migrate(g);
            Val::None
        }
        "go" => ok(TT::go(g)),
        "_candidates" => {
            let cur = TT::_scan(g);
            TT::_candidates(g, &arg(0), &cur)
        }
        "march_left" => Val::from(TT::march_left(g, &a(g, 0))),
        "eta" => Val::from(TT::eta(g, &a(g, 0), &arg(1))),
        "preview" => {
            let (t, why) = TT::preview(g, &s(0), &arg(1), &arg(2), &arg(3), &arg(4), &arg(5));
            list![t, why]
        }
        "_where" => Val::from(TT::_where(g, f(0), f(1))),
        "incoming" => TT::incoming(g, &s(0)).iter().map(|a| a.at("id")).collect(),
        "command" => ok(TT::command(g, &s(0), &arg(1))),
        "_accumulate" => {
            TT::_accumulate(g, f(0));
            Val::None
        }
        "watch" => {
            let seq = g.seq;
            TT::watch(g, f(0), seq);
            Val::None
        }
        "finish_sans_ia" => {
            let tr = g.tour.clone();
            g.speed_idx = 0;
            tr.set("recap", TT::_recap(g));
            tr.update(&dict! {"end" => Val::None, "stop" => Val::None, "acc" => Val::None});
            TT::view(g)
        }
        // chemins de fer
        "sections" => Val::from(json::empreinte_ordre(&j(&RL::sections(&geo)))),
        "client_payload" => Val::from(json::empreinte_ordre(&j(&RL::client_payload(&geo)))),
        "exits" => RL::exits(),
        "by_town" => RL::by_town(&geo),
        "network" => {
            let n = RL::network(g, &s(0));
            let l: Val = n.iter().filter(|x| x.is_some()).collect();
            l.sort();
            list![n.has(Val::None), l]
        }
        "rail_edges" => {
            let l = RL::rail_edges(g, &s(0)).to_list();
            l.sort();
            l
        }
        "works" => RL::works(g, &s(0)),
        "industry_k" => Val::from(RL::industry_k(g, &s(0))),
        "player_view" => RL::player_view(g, &s(0)),
        "usable" => Val::from(RL::usable(g, &s(0), &s(1))),
        "openable" => {
            let (o, why) = RL::openable(g, &s(0), &s(1));
            list![o, why]
        }
        "cost" => {
            let (p, d) = RL::cost(g, &s(0), &s(1));
            list![p, d]
        }
        "start" => {
            let (o, why) = RL::start(g, &s(0), &s(1));
            list![o, why]
        }
        "open_" => Val::from(RL::open_(g, &s(0))),
        "town_bonus" => Val::from(RL::town_bonus(g, arg(0).i())),
        "near_station" => Val::from(RL::near_station(g, &s(0), f(1), f(2))),
        "tick" => {
            RL::tick(g, f(0));
            Val::None
        }
        "_on_section" => RL::_on_section(g, &a(g, 0)).iter().map(|s| s.at("id")).collect(),
        "sabotage" => {
            RL::sabotage(g);
            Val::None
        }
        // journal des batailles
        "snapshot" => BL::snapshot(g, &g.battles.at(arg(0))),
        "tactical" => Val::None, // (le journal d'une bataille tactique : il n'y en a plus, SPEC-BATAILLE.md)
        _ => panic!("opération inconnue : {nom}"),
    }
}

/// `ev_norm` du jumeau : le journal sans l'ordre des lignes d'une même coupure de voie ferrée (rails.sabotage parcourt un
/// set de textes en Python : ordre libre) ; leurs camps (who, important) à part, triés.
fn ev_norm(evs: &Val) -> Val {
    let (out, coupes) = (list![], list![]);
    for e in j(evs).iter() {
        if e.at("kind") == "rail" && e.ats("text").contains(" coupe la voie ferrée ") {
            coupes.push(list![e.at("text"), e.pop("who"), e.pop("important")]);
        }
        out.push(e);
    }
    coupes.sort();
    list![out, coupes]
}

fn final_(g: &Game) -> Val {
    let e = |v: &Val| Val::from(json::empreinte_ordre(&j(v)));
    let last: Val = g.events.slice(Some(-12), None).iter().map(|e| e.at("text")).collect();
    dict! {"factions" => e(&g.factions), "nodes" => e(&g.nodes), "armies" => e(&g.armies), "events" => e(&ev_norm(&g.events)),
           "battles" => e(&g.battles), "rails" => j(&g.rails), "tour" => j(&g.tour), "n_events" => g.events.len(),
           "last_events" => last, "speed" => g.speed_idx}
}

#[test]
fn operations_comme_python() {
    let r = reference();
    let geo = geo();
    for c in r.at("cas").iter() {
        let nom = c.at("nom");
        let mut g = assembler(&geo, &c.at("save"));
        let (ops, res) = (c.at("ops"), c.at("res"));
        let mut ecarts = vec![];
        for (i, op) in ops.iter().enumerate() {
            let got = jouer(&mut g, &op);
            let want = res.at(i as i64);
            if !egal(&got, &want) {
                ecarts.push(format!("#{i} {op}\n  Rust   : {}\n  Python : {}", json::dumps_ref(&j(&got)), json::dumps_ref(&want)));
            }
        }
        assert!(ecarts.is_empty(), "« {nom} » : {} écarts sur {} opérations :\n{}", ecarts.len(), ops.len(),
                ecarts.iter().take(8).cloned().collect::<Vec<_>>().join("\n"));
        let fin = final_(&g);
        let want = c.at("fin");
        for (k, v) in want.items() {
            assert!(egal(&fin.at(&k), &v), "« {nom} » : état final, {k} :\n  Rust   : {}\n  Python : {}",
                    json::dumps_ref(&j(&fin.at(&k))), json::dumps_ref(&v));
        }
    }
}

// ================================================================== aller-retour complet, vue du navigateur

#[test]
fn aller_retour_et_vue_comme_python() {
    let r = reference();
    let geo = geo();
    for c in r.at("cas").iter() {
        let nom = c.at("nom");
        let Some(mut g) = en_attente(&format!("from_dict « {nom} »"), || V::from_dict(geo.clone(), &c.at("save").deepcopy()).unwrap())
        else {
            return;
        };
        let rt = j(&V::to_dict(&mut g));
        assert!(egal(&rt.at("ai_state"), &c.at("retour_ai")), "« {nom} » : ai_state relu puis réécrit");
        assert_eq!(json::empreinte_ordre(&rt), c.ats("retour"), "« {nom} » : sauvegarde relue puis réécrite");
        let Some(ps) = en_attente(&format!("player_state « {nom} »"), || V::player_state(&mut g, 0)) else { return };
        let ps = j(&ps);
        for (k, v) in c.at("vue_parts").items() {
            assert_eq!(Val::from(json::empreinte_ordre(&ps.at(&k))), v, "« {nom} » : player_state, {k}");
        }
        assert_eq!(json::empreinte_ordre(&ps), c.ats("vue"), "« {nom} » : player_state");
        let since = c.at("save").ati("seq") - 3;
        assert_eq!(json::empreinte_ordre(&j(&V::player_state(&mut g, since))), c.ats("vue_since"), "« {nom} » : player_state(since)");
    }
    // une sauvegarde d'avant : clés absentes (DEFAULTS), réglages d'armée manquants (migrate)
    let v = r.at("vieille");
    let s = r.at("cas").at(0).at("save").deepcopy();
    for k in v.at("cles").iter() {
        s.pop(&k);
    }
    let a = s.at("armies").values()[0].clone();
    for k in ["fm", "pl", "fm_t", "emb", "mp"] {
        a.pop(k);
    }
    let Some(mut g) = en_attente("from_dict d'une vieille sauvegarde", || V::from_dict(geo.clone(), &s).unwrap()) else { return };
    assert_eq!(json::empreinte_ordre(&j(&V::to_dict(&mut g))), v.ats("retour"), "vieille sauvegarde relue puis réécrite");
}

/// `pas` du jumeau : un pas du tour des IA (TT::advance sans son budget de temps) ; vrai à la fin du mois.
fn pas(g: &mut Game) -> bool {
    let tr = g.tour.clone();
    if g.speed_idx == 0 {
        g.pending_ev.clear(); // (décisions : on n'attend pas le joueur)
        for bt in g.battles.values() {
            if bt.get("mode") == "attente" {
                bt.set("mode", "auto");
            }
            if bt.get("mode") == "poursuite" {
                TB::command(g, &dict! {"sub" => "pursue", "bid" => bt.at("id"), "v" => true}); // (le joueur vainqueur poursuit)
            }
        }
        TT::go(g);
    }
    let sub = if g.battles.truthy() { conquete::engine::SUBSTEP } else { conquete::engine::SUBSTEP * 2.0 };
    let rem = tr.atf("end") - g.t;
    let seq0 = g.seq;
    if rem <= sub + 1e-6 {
        g.step((if 0.0 > rem { 0.0 } else { rem }) + 1e-9);
        g.t = tr.atf("end");
        TT::watch(g, rem, seq0);
        TT::finish(g);
        return true;
    }
    g.step(sub);
    TT::watch(g, sub, seq0);
    false
}

/// La fin d'un mois, de la sauvegarde en plein tour des IA : les pas du tour des IA, finish (bilan, batailles réglées,
/// begin_turn, settle et marches du joueur), puis un ordre de marche et settle (march_now).
#[test]
fn fin_du_mois_comme_python() {
    let r = reference();
    let m = r.at("mois");
    let geo = geo();
    let Some(mut g) = en_attente("from_dict", || V::from_dict(geo.clone(), &r.at("cas").at(0).at("save").deepcopy()).unwrap())
    else {
        return;
    };
    let Some(n) = en_attente("le tour des IA", || {
        TT::go(&mut g);
        let mut n = 1;
        while !pas(&mut g) {
            n += 1;
        }
        n
    }) else {
        return;
    };
    let compare = |quoi: &str, got: &Val, want: &Val| {
        for (k, v) in want.items() {
            assert!(egal(&got.at(&k), &v), "{quoi}, {k} :\n  Rust   : {}\n  Python : {}", json::dumps_ref(&j(&got.at(&k))),
                    json::dumps_ref(&v));
        }
    };
    compare("fin du mois", &final_(&g), &m.at("fin"));
    assert_eq!(n, m.ati("pas"), "pas du tour des IA");
    assert!(egal(&g.tour.at("recap"), &m.at("recap")), "bilan du mois");
    assert_eq!(json::empreinte_ordre(&j(&V::player_state(&mut g, 0))), m.ats("vue"), "player_state au tour du joueur");
    let o = m.at("ordre");
    let (ok, msg) = g.order_move("33", &o.at(0), &dict! {"node" => o.at(1)});
    assert!(egal(&list![ok, msg], &o.at(2)), "ordre de marche");
    assert!(egal(&TT::settle(&mut g), &m.at("settle")), "settle : jours de marche employés");
    compare("après settle", &final_(&g), &m.at("apres"));
    assert!(egal(&g.armies.at(o.at(0)).get("trail"), &m.at("trail")), "trajet de la marche");
}

#[test]
fn from_dict_refuse_une_autre_geographie() {
    let r = reference();
    let s = r.at("cas").at(0).at("save").deepcopy();
    s.set("geo", 3);
    match V::from_dict(geo(), &s) {
        Err(e) => assert_eq!(e, "sauvegarde de la géographie 3, carte 1"),
        Ok(_) => panic!("une sauvegarde d'une autre géographie est refusée"),
    }
}

#[test]
fn rules_payload_comme_python() {
    let r = reference();
    if let Some(p) = en_attente("rules_payload", V::rules_payload) {
        assert_eq!(json::empreinte_ordre(&j(&p)), r.ats("rules_payload"));
    }
}

/// Refait, avec le moteur Rust, ce que la référence attend des batailles et des vues, quand les règles changent exprès
/// (la bataille par stratégie, SPEC-BATAILLE.md : 16/11/2026) : to_dict, résultats des opérations et état final,
/// aller-retour et vues de chaque cas, vieille sauvegarde, fin du mois, rules_payload. Les sauvegardes des cas, les
/// opérations et la crue ne sont pas touchées ; seul ce qui diffère est réécrit.
/// `CONQUETE_REFAIRE_TOURS=1 cargo test --release -p conquete --test tours refaire -- --ignored`
#[test]
#[ignore]
fn refaire() {
    if std::env::var_os("CONQUETE_REFAIRE_TOURS").is_none() {
        return;
    }
    std::env::set_var("WEB_CONQUETE_NOLOG", "1");
    let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/tours.json");
    let texte = std::fs::read_to_string(&chemin).unwrap();
    let r = json::loads(&texte).unwrap();
    assert_eq!(json::dumps_compact(&r), texte.trim_end(), "le fichier ne se réécrit pas à l'identique");
    let geo = geo();
    let emp = |v: &Val| Val::from(json::empreinte_ordre(&j(v)));
    // (une valeur n'est réécrite que si elle diffère : `quoi` le dit)
    let poser = |d: &Val, k: &dyn Fn() -> Val, cle: Val, quoi: &str| {
        let v = j(&k());
        if json::dumps_ref(&v) != json::dumps_ref(&d.at(&cle)) {
            d.set(&cle, v);
            eprintln!("{quoi} : refait");
        }
    };
    for c in r.at("cas").iter() {
        let nom = c.ats("nom");
        let mut g = assembler(&geo, &c.at("save"));
        let d = emp(&V::to_dict(&mut g));
        poser(&c, &|| d.clone(), Val::from("to_dict"), &format!("« {nom} » to_dict"));
        let mut g = assembler(&geo, &c.at("save"));
        for (i, op) in c.at("ops").iter().enumerate() {
            let got = jouer(&mut g, &op);
            poser(&c.at("res"), &|| got.clone(), Val::from(i as i64), &format!("« {nom} » opération {i} {op}"));
        }
        let fin = final_(&g);
        for k in c.at("fin").keys() {
            poser(&c.at("fin"), &|| fin.at(&k), k.clone(), &format!("« {nom} » état final, {k}"));
        }
        let mut g = V::from_dict(geo.clone(), &c.at("save").deepcopy()).unwrap();
        let rt = j(&V::to_dict(&mut g));
        poser(&c, &|| rt.at("ai_state"), Val::from("retour_ai"), &format!("« {nom} » ai_state"));
        poser(&c, &|| Val::from(json::empreinte_ordre(&rt)), Val::from("retour"), &format!("« {nom} » retour"));
        let ps = j(&V::player_state(&mut g, 0));
        for k in c.at("vue_parts").keys() {
            if !ps.has(&k) {
                c.at("vue_parts").pop(&k); // (un champ que la vue n'envoie plus : « tac », la bataille tactique)
                eprintln!("« {nom} » player_state, {k} : retiré");
                continue;
            }
            poser(&c.at("vue_parts"), &|| Val::from(json::empreinte_ordre(&ps.at(&k))), k.clone(), &format!("« {nom} » player_state, {k}"));
        }
        poser(&c, &|| Val::from(json::empreinte_ordre(&ps)), Val::from("vue"), &format!("« {nom} » player_state"));
        let since = c.at("save").ati("seq") - 3;
        let vs = emp(&V::player_state(&mut g, since));
        poser(&c, &|| vs.clone(), Val::from("vue_since"), &format!("« {nom} » player_state(since)"));
    }
    let v = r.at("vieille");
    let s = r.at("cas").at(0).at("save").deepcopy();
    for k in v.at("cles").iter() {
        s.pop(&k);
    }
    let a = s.at("armies").values()[0].clone();
    for k in ["fm", "pl", "fm_t", "emb", "mp"] {
        a.pop(k);
    }
    let mut g = V::from_dict(geo.clone(), &s).unwrap();
    let vr = emp(&V::to_dict(&mut g));
    poser(&v, &|| vr.clone(), Val::from("retour"), "vieille sauvegarde");
    let m = r.at("mois");
    let mut g = V::from_dict(geo.clone(), &r.at("cas").at(0).at("save").deepcopy()).unwrap();
    TT::go(&mut g);
    let mut n = 1;
    while !pas(&mut g) {
        n += 1;
    }
    let fin = final_(&g);
    for k in m.at("fin").keys() {
        poser(&m.at("fin"), &|| fin.at(&k), k.clone(), &format!("fin du mois, {k}"));
    }
    poser(&m, &|| Val::from(n), Val::from("pas"), "pas du tour des IA");
    poser(&m, &|| g.tour.at("recap"), Val::from("recap"), "bilan du mois");
    let vue = emp(&V::player_state(&mut g, 0));
    poser(&m, &|| vue.clone(), Val::from("vue"), "player_state au tour du joueur");
    let o = m.at("ordre");
    let (ok, msg) = g.order_move("33", &o.at(0), &dict! {"node" => o.at(1)});
    poser(&o, &|| list![ok, msg.clone()], Val::from(2), "ordre de marche");
    let st = TT::settle(&mut g);
    poser(&m, &|| st.clone(), Val::from("settle"), "settle");
    let apres = final_(&g);
    for k in m.at("apres").keys() {
        poser(&m.at("apres"), &|| apres.at(&k), k.clone(), &format!("après settle, {k}"));
    }
    poser(&m, &|| g.armies.at(o.at(0)).get("trail"), Val::from("trail"), "trajet de la marche");
    poser(&r, &|| emp(&V::rules_payload()), Val::from("rules_payload"), "rules_payload");
    std::fs::write(&chemin, json::dumps_compact(&r) + if texte.ends_with('\n') { "\n" } else { "" }).unwrap();
}
