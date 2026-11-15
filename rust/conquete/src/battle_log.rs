//! Journal des batailles, pour régler l'équilibre : une ligne JSON par bataille dans logs/batailles.jsonl.
//!
//! Toutes les batailles y passent : résolues automatiquement (y compris entre IA), commandées, et celles du mode Bataille.
//! Chaque ligne donne le contexte (date, saison, météo, terrain, place et fortification), les forces des deux camps au
//! début, le déroulement (durée, brèches ouvertes au canon) et le résultat (vainqueur, pertes, prisonniers, prise de la
//! place). outils/bilan.py en tire des tableaux. Le journal ne doit jamais gêner la partie : une erreur d'écriture est
//! ignorée, et le fichier est mis de côté (batailles.1.jsonl) au-delà de MAX_BYTES.
//!
//! Porte game/battle_log.py (PORTAGE.md). Les `try / except Exception` du Python avalent toute erreur (traceback
//! imprimé) : ici `avaler` rattrape la panique (le message est imprimé par le crochet de panique), le journal ne fait
//! jamais tomber la partie.
#![allow(non_snake_case)]

use crate::army_actions as AA;
use crate::engine::Game;
use crate::py::{self, json, Val};
use crate::rules as R;
use crate::tactics::battle::TacticalBattle;
use crate::{dict, list};
use std::io::Write;
use std::path::PathBuf;

/// `ROOT` : la racine du dépôt en Python (deux crans au-dessus de game/battle_log.py) ; ici le répertoire courant
/// (le serveur est lancé de la racine, comme geo::data_dir le suppose).
pub fn ROOT() -> PathBuf {
    PathBuf::from(".")
}
pub fn LOG_DIR() -> PathBuf {
    ROOT().join("logs")
}
pub fn LOG_FILE() -> PathBuf {
    LOG_DIR().join("batailles.jsonl")
}
pub const MAX_BYTES: i64 = 20 * 1024 * 1024;
/// `ENABLED = not os.environ.get('WEB_CONQUETE_NOLOG')` : tests et simulations : WEB_CONQUETE_NOLOG=1 (ne fausse
/// pas outils/bilan.py). Relu à chaque appel (le Python le lit une fois, à l'import).
pub fn ENABLED() -> bool {
    std::env::var_os("WEB_CONQUETE_NOLOG").map_or(true, |v| v.is_empty())
}

/// `try: … except Exception: traceback.print_exc()` : None si f panique (le crochet de panique imprime le message).
fn avaler<T>(f: impl FnOnce() -> T) -> Option<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok()
}

/// `time.strftime('%Y-%m-%d %H:%M:%S')`. Écart : l'heure UTC (la bibliothèque standard n'a pas le fuseau local).
fn horodatage() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string() // time.strftime : l'heure locale du poste
}

/// Python : `write(rec)`.
/// rec : le dict de la ligne ; on lui ajoute `ts` (heure locale, %Y-%m-%d %H:%M:%S) avant de l'écrire
/// (py::json::dumps_compact, une ligne par bataille).
// game/battle_log.py, lignes 24 à 35
pub fn write(rec: &Val) {
    if !ENABLED() {
        return;
    }
    avaler(|| {
        let r = (|| -> std::io::Result<()> {
            std::fs::create_dir_all(LOG_DIR())?;
            if let Ok(m) = std::fs::metadata(LOG_FILE()) {
                if m.len() as i64 > MAX_BYTES {
                    std::fs::rename(LOG_FILE(), LOG_DIR().join("batailles.1.jsonl"))?;
                }
            }
            rec.set("ts", horodatage());
            let mut f = std::fs::OpenOptions::new().append(true).create(true).open(LOG_FILE())?;
            f.write_all((json::dumps_compact(rec) + "\n").as_bytes())
        })();
        if let Err(e) = r {
            eprintln!("journal des batailles : {e}");
        }
    });
}

/// Python : `_regs(regs, out)`.
/// regs : une liste de régiments ; out : le dict à compléter (comp, men, arm, _xp, _mor).
// game/battle_log.py, lignes 38 à 45
pub fn _regs(regs: &Val, out: &Val) {
    for r in regs.iter() {
        let t = r.at("type");
        let comp = out.at("comp");
        comp.set(&t, &comp.get_or(&t, 0) + &Val::from(1));
        out.set("men", &out.at("men") + &r.at("n"));
        let cls = R::UNITS().get(&t).or(dict! {}).get_or("cls", "inf");
        let arm = out.at("arm");
        let (cur, v) = (arm.get_or(&cls, 0), Val::from(py::int_v(&r.get("arm").or(0))));
        arm.set(&cls, if v > cur { v } else { cur });
        out.set("_xp", &out.at("_xp") + &(&r.get_or("xp", 0) * &r.at("n")));
        out.set("_mor", &out.at("_mor") + &(&r.get_or("morale", 70) * &r.at("n")));
    }
}

// ================================================================== campagne

/// Forces des deux camps au début d'une bataille de campagne (engine.start_battle).
/// Python : `snapshot(g, bt)`.
/// bt : une bataille (dict de g.battles). Rend le dict des forces, ou None si une erreur survient.
// game/battle_log.py, lignes 49 à 91
pub fn snapshot(g: &Game, bt: &Val) -> Val {
    avaler(|| {
        let sides = list![];
        for s in bt.at("sides").iter() {
            let d = dict! {"owner" => s.at("owner"), "comp" => dict! {}, "men" => 0.0, "arm" => dict! {}, "gens" => list![],
                           "armies" => s.at("armies").len(), "_xp" => 0.0, "_mor" => 0.0};
            for aid in s.at("armies").iter() {
                let a = g.armies.get(&aid);
                if !a.truthy() {
                    continue;
                }
                _regs(&a.at("regs"), &d);
                if a.getb("gen") {
                    let gen = a.at("gen");
                    d.at("gens").push(list![gen.get("trait"), gen.get_or("lvl", 1)]);
                }
                d.set("plan", a.get("pl"));
                d.set("fm", a.get("fm"));
            }
            if s.at("node").is_some() {
                let n = g.nodes.at(s.at("node"));
                let gar = dict! {"comp" => dict! {}, "men" => 0.0, "arm" => dict! {}, "_xp" => 0.0, "_mor" => 0.0};
                _regs(&n.at("garrison"), &gar);
                d.update(&dict! {"garrison" => gar.at("comp"), "garrison_men" => py::round(gar.atf("men")),
                                 "milice" => py::round(n.atf("milice")), "fort" => n.at("fort"),
                                 "fort_eff" => py::round_n(AA::fort_eff(g, &n, &Val::None), 2), "guns" => g.fort_guns(&n),
                                 "breach0" => py::round_n(AA::breach(&n), 2)});
                d.set("_xp", &d.at("_xp") + &gar.at("_xp"));
                d.set("_mor", &d.at("_mor") + &gar.at("_mor"));
                d.set("men", &d.at("men") + &gar.at("men"));
            }
            let m = if d.atf("men") > 1.0 { d.atf("men") } else { 1.0 };
            d.set("xp", py::round_n(d.pop("_xp").f() / m, 1));
            d.set("morale", py::round_n(d.pop("_mor").f() / m, 1));
            d.set("men", py::round(d.atf("men")));
            sides.push(d);
        }
        let zone = g.zone_of(bt.atf("x"), bt.atf("y"));
        let mut place = Val::None;
        if bt.at("node").is_some() {
            let gn = g.geo.nodes.at(bt.at("node"));
            place = dict! {"id" => bt.at("node"), "name" => gn.at("name"), "type" => gn.at("type")};
        }
        let player = bt.at("sides").iter().position(|s| s.at("owner") == g.player.as_str());
        dict! {"date" => g.date_str(&Val::None), "year" => g.date(&Val::None).year, "t0" => py::round_n(g.t, 2),
               "season" => g.season(), "weather" => g.weather.at(zone).at("kind"), "zone" => zone,
               "terrain" => bt.get("terrain"), "place" => place, "ambush" => bt.getb("ambush"),
               "landing" => bt.getb("landing"), "sides" => sides, "player" => player, "difficulty" => &g.difficulty,
               "scenario" => &g.scenario}
    })
    .unwrap_or(Val::None)
}

/// Fin d'une bataille de campagne (engine.end_battle) : automatique, ou commandée (tb : la bataille tactique).
/// Python : `campaign_end(g, bt, winner, disengage, prisoners, tb=None)`.
/// winner : 0 ou 1 ; prisoners : écrit `int(prisoners)` ; tb : la bataille tactique (TB.find), ou None.
// game/battle_log.py, lignes 94 à 108
pub fn campaign_end(g: &Game, bt: &Val, winner: i64, disengage: bool, prisoners: f64, tb: Option<&TacticalBattle>) {
    avaler(|| {
        let rec = bt.get("log0").or(dict! {}).copy();
        let sides = bt.at("sides");
        rec.update(&dict! {
            "kind" => "campagne", "mode" => if bt.getb("tac") { "commandee" } else { "auto" }, "id" => bt.at("id"),
            "days" => py::round_n(g.t - bt.get_or("t0", g.t).f(), 3), "winner" => winner,
            "winner_owner" => sides.at(winner).at("owner"), "disengage" => disengage,
            "captured" => !disengage && sides.at(1 - winner).at("node").is_some() && winner == 0,
            "men0" => sides.iter().map(|s| Val::from(py::round(s.atf("men0")))).collect::<Val>(),
            "lost" => sides.iter().map(|s| Val::from(py::round(s.atf("lost")))).collect::<Val>(),
            "prisoners" => py::int(prisoners), "assault" => bt.at("node").is_some()
        });
        if let Some(tb) = tb {
            rec.set("tac", tactical(tb));
        }
        write(&rec);
    });
}

// ================================================================== batailles tactiques

/// Déroulement d'une bataille tactique : durée, brèches, pertes et état des unités à la fin.
/// Python : `tactical(tb)`.
/// Rend un dict. (`getattr(tb, 'breach_t', [])` : champ de TacticalBattle.)
// game/battle_log.py, lignes 112 à 138
pub fn tactical(tb: &TacticalBattle) -> Val {
    let r = tb.result.or(dict! {});
    let sides = list![];
    let units = tb.units.vec();
    let combat = |u: &Val| !(u.at("cls") == "general" || u.at("cls") == "chariot");
    for s in 0..2i64 {
        let us: Vec<&Val> = units.iter().filter(|u| u.at("side") == s).collect();
        let comp = dict! {};
        for u in &us {
            if !combat(u) {
                continue;
            }
            let k = if u.at("src") == "rempart" { Val::from("rempart") } else { u.at("type") };
            comp.set(&k, &comp.get_or(&k, 0) + &Val::from(1));
        }
        let fight: Vec<&Val> = us.iter().copied().filter(|u| combat(u)).collect();
        let men = py::sum_v(fight.iter().map(|u| {
            let m = u.at("men");
            if m > 0.0 { m } else { Val::from(0.0) }
        }));
        sides.push(dict! {
            "comp" => comp, "men0" => py::round(py::sum_v(fight.iter().map(|u| u.at("men0"))).f()), "men" => py::round(men.f()),
            "routed" => fight.iter().filter(|u| u.at("state") == "deroute").count(),
            "out" => fight.iter().filter(|u| u.at("state") == "hors").count(),
            "ctrl" => if us.iter().any(|u| u.at("ctrl") == "joueur") { "joueur" } else { "ia" }
        });
    }
    let pl = tb.place_info();
    dict! {
        "clock" => py::round(tb.clock), "accel" => tb.accel, "accel_t" => if tb.accel { Some(py::round(tb.accel_t)) } else { None },
        "weather" => &tb.weather, "season" => &tb.season, "year" => tb.spec.get("year"), "difficulty" => &tb.difficulty,
        "place" => if pl.truthy() { dict! {"fort" => pl.at("fort"), "r" => pl.at("r")} } else { Val::None },
        "guns" => units.iter().filter(|u| u.at("src") == "rempart").count(),
        "breaches" => tb.breach_t.iter().map(|b| list![py::round(b.atf(0)), b.at(1)]).collect::<Val>(),
        "winner" => r.get("winner"), "disengage" => r.getb("disengage"), "why" => r.get("why"),
        "lost" => r.get_or("lost", list![0, 0]).iter().map(|x| Val::from(py::round(x.f()))).collect::<Val>(),
        "prisoners" => r.get_or("prisoners", list![0, 0]).iter().map(|x| Val::from(py::round(x.f()))).collect::<Val>(),
        "me" => &tb.me, "sides" => sides
    }
}

/// Fin d'une bataille du mode Bataille (game/tactics/skirmish.py).
/// Python : `skirmish_end(tb)`.
// game/battle_log.py, lignes 141 à 149
pub fn skirmish_end(tb: &TacticalBattle) {
    avaler(|| {
        let sp = &tb.spec;
        write(&dict! {"kind" => "bataille", "mode" => "bataille", "id" => &tb.bid, "title" => sp.get("title"),
                      "year" => sp.get("year"), "season" => sp.get("season"), "weather" => sp.get("weather"),
                      "owners" => sp.get("owners"), "difficulty" => sp.get("difficulty"), "sk" => sp.get("sk"),
                      "tac" => tactical(tb)});
    });
}
