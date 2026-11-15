//! Banc de l'IA de bataille : des batailles isolées jouées IA contre IA jusqu'au bout, sur des graines fixes, résumées
//! en un tableau court (pour comparer avant et après un changement de tactics/ai sans lire les journaux).
//! Portage de outils/banc_ia.py (mêmes options, même tableau) ; `--proc` : des fils au lieu de processus, chacun avec
//! sa carte.

mod commun;

use commun::{cpu, message, par_map, tronque, Args};
use conquete::dict;
use conquete::py::{self, json, Val};
use conquete::tactics::ai;
use conquete::tactics::orders as OR;
use conquete::tactics::skirmish as S;
use std::panic::{catch_unwind, AssertUnwindSafe};

const AIDE: &str = "Banc de l'IA de bataille : des batailles isolées jouées IA contre IA jusqu'au bout, sur des graines fixes, résumées
en un tableau court (pour comparer avant et après un changement de l'IA de bataille sans lire les journaux).

Usage :  target/release/banc_ia [--graines 2] [--proc 4] [--epoques 1700,1790,1813,1870] [--lieux bataille,forteresse]
         (lieux : bataille, forteresse, village : un village sans remparts, barricadé)
         [--tweak '{\"normal\": {\"cav_opp\": false}}']   (réglages d'essai : spec['ai_tweak'], pour les comparaisons A/B)
         [--journal 12]   (les 12 dernières notes du journal de chaque camp sous sa ligne, à filtrer avec grep)
         [--ordres '{\"man\": \"enveloppement\", \"wing\": \"gauche\", \"ruse\": \"feinte\"}']   (le camp du joueur mené selon ces
         ordres, « Donner mes ordres » ; les clés absentes gardent leur valeur par défaut)

Par bataille : époque, lieu, camp du joueur (att : il attaque), vainqueur (A assaillant, D défenseur, - aucun), raison,
durée (min de bataille), pertes de chaque camp (% des hommes), temps de calcul (s), et les grands moments notés par
l'IA (ai_mem[...]['journal']) comptés par famille : contre-attaques, charges, tirailleurs, assauts, décrochages, brèches.
« Figée » : la bataille va au bout du temps sans que personne ne perde 10 %.";

const TROUPES: [(&str, i64); 4] = [("ligne", 4), ("legere", 2), ("cavalerie", 2), ("artillerie", 2)];
const FAMILLES: [(&str, &[&str]); 6] = [
    ("ctr", &["contre-attaque", "retour offensif", "contre-charge"]),
    ("chg", &["charge"]),
    ("tir", &["tirailleur", "harcel"]),
    ("ass", &["assaut", "baïonnette"]),
    ("déc", &["décroche", "retraite"]),
    ("brè", &["brèche", "sortie", "escalade"]),
];

struct Job {
    epoque: String,
    lieu: String,
    role: &'static str,
    graine: i64,
}

struct Res {
    w: char,
    why: String,
    min: f64,
    pa: f64,
    pd: f64,
    cpu: f64,
    cnt: [i64; 6],
    figee: bool,
    jr: Vec<String>,
}

fn une(geo: &std::rc::Rc<conquete::geo::GeoMap>, j: &Job, tweak: &str, nj: i64, ordres: &str) -> Result<Res, String> {
    let mes = Val::dict();
    for (k, n) in TROUPES {
        mes.set(k, n);
    }
    let corps = || dict! {"me" => "33", "foe" => "24", "era" => j.epoque.as_str(), "kind" => j.lieu.as_str(), "role" => j.role, "units" => &mes, "seed" => j.graine};
    let (mut g, mut bid) = S::new(geo.clone(), &corps());
    while g.is_none() && mes.truthy() {
        // (une arme que l'époque ou la garnison n'a pas : on l'enlève)
        mes.pop(&mes.keys()[0]);
        (g, bid) = S::new(geo.clone(), &corps());
    }
    let Some(mut g) = g else { return Err(bid) };
    let mut tb = g.tactical.take().unwrap();
    if !tweak.is_empty() {
        tb.spec.set("ai_tweak", json::loads(tweak).unwrap_or_else(|e| panic!("--tweak : {e}")));
        for s in tb.ai_sides.iter() {
            ai::deploy(&mut tb, s.i()); // (les réglages du déploiement comptent aussi)
        }
    }
    let t0 = cpu();
    catch_unwind(AssertUnwindSafe(|| {
        tb.spec.set("orders", conquete::list![Val::None, Val::None]); // (sans --ordres : l'IA à sa guise des deux côtés)
        let me = tb.me.clone();
        if !ordres.is_empty() {
            let o = OR::clean(&tb, me.i(), &json::loads(ordres).unwrap_or_else(|e| panic!("ValueError: {e}")), &Val::None);
            tb.spec.at("orders").set(&me, o);
        }
        tb.autofinish();
        if !ordres.is_empty() {
            let o = tb.spec.at("orders").at(&me);
            OR::setup(&mut tb, me.i(), &o);
        }
        tb.run_to_end();
    }))
    .map_err(|p| message(&*p))?; // (une erreur de l'IA est un résultat du banc, pas un plantage)
    let cpu = cpu() - t0;
    let r = tb._result();
    let mut notes = vec![];
    for m in tb.ai_mem.values().iter() {
        if m.is_dict() {
            for n in m.get_or("journal", conquete::list![]).iter() {
                notes.push(n.at(1).s().to_lowercase());
            }
        }
    }
    let mut cnt = [0; 6];
    for (k, (_, mots)) in FAMILLES.iter().enumerate() {
        cnt[k] = notes.iter().filter(|n| mots.iter().any(|w| n.contains(w))).count() as i64;
    }
    let pertes: Vec<f64> = (0..2).map(|s| (100.0 * r.at("lost").at(s).f()) / py_max1(r.at("men0").at(s).f())).collect();
    let winner = r.at("winner");
    let gagne = winner == 0 || winner == 1;
    let mut jr = vec![];
    if nj != 0 {
        let mut mem = tb.ai_mem.items();
        mem.sort_by(|a, b| a.0.s().cmp(b.0.s()));
        for (k, m) in mem {
            if m.is_dict() {
                let journal = m.get_or("journal", conquete::list![]);
                let n0 = (journal.len() as i64 - nj).max(0); // `[-nj:]`
                for n in journal.slice(Some(n0), None).iter() {
                    jr.push(format!("  s{} {}", &k.s()[1..], n.at(1)));
                }
            }
        }
    }
    Ok(Res {
        w: if gagne { ['A', 'D'][winner.i() as usize] } else { '-' },
        why: tronque(&r.at("why").or(Val::from("")).to_string(), 28),
        min: tb.clock / 60.0,
        pa: pertes[0],
        pd: pertes[1],
        cpu,
        cnt,
        figee: !gagne && (if pertes[1] > pertes[0] { pertes[1] } else { pertes[0] }) < 10.0,
        jr,
    })
}

/// `max(1, x)`.
fn py_max1(x: f64) -> f64 {
    if x > 1.0 {
        x
    } else {
        1.0
    }
}

fn main() {
    std::env::set_var("WEB_CONQUETE_NOLOG", "1"); // (tests/fabrique.py : le banc n'écrit pas dans logs/batailles.jsonl)
    let a = Args::parse(AIDE, &["graines", "proc", "epoques", "lieux", "tweak", "journal", "ordres"]);
    let (graines, proc) = (a.i("graines", 2), a.i("proc", 4));
    let (tweak, nj, ordres) = (a.s("tweak", ""), a.i("journal", 0), a.s("ordres", ""));
    let mut jobs = vec![];
    for e in a.s("epoques", "1700,1790,1813,1870").split(',') {
        for l in a.s("lieux", "bataille,forteresse").split(',') {
            for role in ["att", "def"] {
                for graine in 1..=graines {
                    jobs.push(Job { epoque: e.to_string(), lieu: l.to_string(), role, graine });
                }
            }
        }
    }
    let res = par_map(&jobs, proc.max(1) as usize, || commun::geo(2), |geo, j| une(geo, j, &tweak, nj, &ordres));
    println!(
        "{:6} {:10} {:4} gr  V raison                        min  pertA pertD   cpu  {}",
        "époque",
        "lieu",
        "rôle",
        FAMILLES.map(|f| f.0).join(" ")
    );
    for (j, r) in jobs.iter().zip(&res) {
        let (e, l, ro, s) = (&j.epoque, &j.lieu, j.role, j.graine);
        match r {
            Err(err) => println!("{e:6} {l:10} {ro:4} {s:2}  ERREUR {}", tronque(err, 90)),
            Ok(r) => {
                println!(
                    "{e:6} {l:10} {ro:4} {s:2}  {} {:28} {:5.0} {:5.0} {:5.0} {:5.1}  {}{}",
                    r.w,
                    r.why,
                    r.min,
                    r.pa,
                    r.pd,
                    r.cpu,
                    r.cnt.map(|c| format!("{c:3}")).join(" "),
                    if r.figee { "  FIGÉE" } else { "" }
                );
                for t in &r.jr {
                    println!("{t}");
                }
            }
        }
    }
    let ok: Vec<&Res> = res.iter().filter_map(|r| r.as_ref().ok()).collect();
    if !ok.is_empty() {
        let n = ok.len();
        let moy = |f: fn(&Res) -> f64| py::sum(ok.iter().map(|r| f(r))) / n as f64;
        let compte = |w: char| ok.iter().filter(|r| r.w == w).count();
        let cpu_max = ok.iter().map(|r| r.cpu).fold(f64::NEG_INFINITY, f64::max);
        println!(
            "\n{n} batailles, {} erreurs ; vainqueur A {}, D {}, aucun {} ; figées {} ; durée moy. {:.0} min ; pertes moy. A {:.0} % D {:.0} % ; cpu moy. {:.1} s, max {:.1} s",
            res.len() - n,
            compte('A'),
            compte('D'),
            compte('-'),
            ok.iter().filter(|r| r.figee).count(),
            moy(|r| r.min),
            moy(|r| r.pa),
            moy(|r| r.pd),
            moy(|r| r.cpu),
            cpu_max
        );
        let totaux: Vec<String> = FAMILLES.iter().enumerate().map(|(k, f)| format!("{} {}", f.0, ok.iter().map(|r| r.cnt[k]).sum::<i64>())).collect();
        println!("grands moments (total) : {}", totaux.join(", "));
    }
}
