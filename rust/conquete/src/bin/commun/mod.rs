//! Ce que les outils (simuler, bilan) ont en commun : la ligne de commande (comme argparse), la carte, les parties
//! jouées sur plusieurs fils (à la place de multiprocessing.Pool). Inclus par chaque outil (`mod commun;`).
#![allow(dead_code)]

use conquete::engine::Game;
use conquete::events as E;
use conquete::geo::GeoMap;
use conquete::py::Val;
use conquete::turns as TT;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// La ligne de commande, comme argparse : `--nom valeur` ou `--nom=valeur`, et les arguments positionnels ;
/// `-h` / `--help` affiche l'aide (la docstring du Python).
pub struct Args {
    pub pos: Vec<String>,
    opts: HashMap<String, String>,
}

impl Args {
    pub fn parse(aide: &str, connues: &[&str]) -> Args {
        Args::parse_drapeaux(aide, connues, &[])
    }

    /// Comme parse, avec des drapeaux sans valeur (`--rapide`) : `a.opt("rapide")` vaut alors Some("1").
    pub fn parse_drapeaux(aide: &str, connues: &[&str], drapeaux: &[&str]) -> Args {
        let (mut pos, mut opts) = (vec![], HashMap::new());
        let mut it = std::env::args().skip(1);
        while let Some(a) = it.next() {
            if a == "-h" || a == "--help" {
                println!("{aide}");
                std::process::exit(0);
            }
            let Some(nom) = a.strip_prefix("--") else {
                pos.push(a);
                continue;
            };
            let (nom, val) = match nom.split_once('=') {
                Some((n, v)) => (n.to_string(), Some(v.to_string())),
                None => (nom.to_string(), None),
            };
            if drapeaux.contains(&nom.as_str()) && val.is_none() {
                opts.insert(nom, "1".to_string());
                continue;
            }
            if !connues.contains(&nom.as_str()) {
                erreur(&format!("unrecognized arguments: {a}"));
            }
            let val = val.or_else(|| it.next()).unwrap_or_else(|| erreur(&format!("argument --{nom}: expected one argument")));
            opts.insert(nom, val);
        }
        Args { pos, opts }
    }

    pub fn s(&self, nom: &str, defaut: &str) -> String {
        self.opts.get(nom).cloned().unwrap_or_else(|| defaut.to_string())
    }

    pub fn opt(&self, nom: &str) -> Option<String> {
        self.opts.get(nom).cloned()
    }

    pub fn i(&self, nom: &str, defaut: i64) -> i64 {
        match self.opts.get(nom) {
            None => defaut,
            Some(v) => v.trim().parse().unwrap_or_else(|_| erreur(&format!("argument --{nom}: invalid int value: '{v}'"))),
        }
    }
}

/// Une erreur de ligne de commande : le message, et la sortie 2 (argparse).
pub fn erreur(m: &str) -> ! {
    eprintln!("erreur : {m}");
    std::process::exit(2)
}

/// `GeoMap(version)`, une à la fois (le premier qui la calcule écrit le cache de game/data, les autres le relisent).
pub fn geo(version: i64) -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    Rc::new(GeoMap::new(version))
}

/// `Pool(fils).map(f, jobs)` : chaque fil prend le travail suivant ; init() fait les objets du moteur de ce fil (la
/// carte : le moteur n'est pas partagé entre fils), une fois. Les résultats dans l'ordre des travaux.
pub fn par_map<J: Sync, R: Send, C>(jobs: &[J], fils: usize, init: impl Fn() -> C + Sync, f: impl Fn(&mut C, &J) -> R + Sync) -> Vec<R> {
    let suivant = AtomicUsize::new(0);
    let res: Mutex<Vec<Option<R>>> = Mutex::new((0..jobs.len()).map(|_| None).collect());
    std::thread::scope(|s| {
        for _ in 0..fils.max(1).min(jobs.len()) {
            std::thread::Builder::new()
                .stack_size(256 << 20) // (le moteur est récursif par endroits ; un fil n'a que 2 Mo par défaut)
                .spawn_scoped(s, || {
                    let mut c = None;
                    loop {
                        let k = suivant.fetch_add(1, Ordering::Relaxed);
                        if k >= jobs.len() {
                            break;
                        }
                        let r = f(c.get_or_insert_with(&init), &jobs[k]);
                        res.lock().unwrap()[k] = Some(r);
                    }
                })
                .unwrap();
        }
    });
    res.into_inner().unwrap().into_iter().map(Option::unwrap).collect()
}

/// Le message d'une panique rattrapée (`catch_unwind`) : le socle panique avec le message de l'exception Python
/// (« KeyError: 'x' »).
pub fn message(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panique".to_string())
}


// ================================================================== une partie jouée par les IA seules (simuler, equilibre)
/// Le camp vu par défaut : FR en Europe et sur la carte monde, le premier pays d'un autre théâtre, 33 dans le Sud-Ouest.
pub fn joueur_defaut(geo: i64) -> String {
    match conquete::geo::theatre(geo) {
        Some(t) if t.geo == conquete::geo::VERSION_EUROPE || t.geo == conquete::geo::VERSION_MONDE => "FR".to_string(),
        Some(_) => conquete::rules::camps(geo).first().map_or_else(String::new, |c| c.string()),
        None => "33".to_string(),
    }
}

/// Le camp du joueur rayé de la carte : le monde continue, vu d'un autre camp en vie (tous joués par les IA).
pub fn carry_on(g: &mut Game) -> bool {
    if !(g.over.is_dict() && g.over.get("result") == "defaite") {
        return false;
    }
    let mut alive: Vec<Val> = g.factions.keys().into_iter().filter(|c| g.factions.at(c).atb("alive")).collect();
    alive.sort_by(|a, b| a.s().cmp(b.s()));
    if alive.len() < 2 {
        return false;
    }
    g.player = alive[0].string();
    g.over = Val::None;
    g.lost_player = true;
    true
}

/// Un « Tour suivant » ; les décisions qui attendent le joueur (événements), c'est son IA qui les prend : le premier
/// choix qu'il peut payer, comme les IA.
pub fn play_month(g: &mut Game) {
    TT::go(g);
    for _ in 0..3000 {
        if carry_on(g) {
            TT::go(g);
        }
        if g.tour.at("end").is_none() || g.over.truthy() {
            return; // (partie finie : un seul camp, ou 1900)
        }
        for x in g.pending_ev.iter() {
            let choices = x.at("choices");
            let n = choices.len() as i64;
            let ok = (0..n).find(|&i| E::affordable(g, &g.player.clone(), &choices.at(i).at("fx")));
            E::resolve(g, x.at("id").s(), ok.unwrap_or(n - 1), true);
        }
        TT::advance(g, 1.0);
        if g.tour.atb("stop") {
            TT::go(g);
        }
    }
    panic!("AssertionError: le tour des IA ne finit pas");
}
