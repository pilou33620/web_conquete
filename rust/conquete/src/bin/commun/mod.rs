//! Ce que les outils (banc_ia, simuler, bilan, carte_hex, bataille_hex) ont en commun : la ligne de commande (comme
//! argparse), la carte, les parties jouées sur plusieurs fils (à la place de multiprocessing.Pool) et le temps de calcul
//! d'un fil (time.process_time d'un processus du Pool). Inclus par chaque outil (`mod commun;`).
#![allow(dead_code)]

use conquete::geo::GeoMap;
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

/// `time.process_time()` d'un processus du Pool : le temps de calcul de ce fil, en secondes.
#[cfg(target_os = "linux")]
pub fn cpu() -> f64 {
    #[repr(C)]
    struct Timespec {
        s: std::ffi::c_long,
        ns: std::ffi::c_long,
    }
    extern "C" {
        fn clock_gettime(horloge: i32, t: *mut Timespec) -> i32;
    }
    const CLOCK_THREAD_CPUTIME_ID: i32 = 3;
    let mut t = Timespec { s: 0, ns: 0 };
    unsafe { clock_gettime(CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.s as f64 + t.ns as f64 * 1e-9
}

/// shortcut: hors de Linux, le temps écoulé (pas le temps de calcul du fil) ; à remplacer si le banc y sert.
#[cfg(not(target_os = "linux"))]
pub fn cpu() -> f64 {
    static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

/// `s[:n]` d'un texte (en caractères).
pub fn tronque(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
