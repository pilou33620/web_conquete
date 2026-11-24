//! Outil d'équilibre (SPEC-POLITIQUE.md, module 8) : de grandes séries de parties entre IA, à lancer sur un PC puissant,
//! puis un rapport HTML autonome et un résumé JSON compact à donner à l'assistant pour régler `rules.rs`.
//!
//! Chaque partie est jouée par un processus à part (ce même exécutable, `--partie carte:époque:graine:années:camp`) : une
//! partie qui plante, s'arrête net ou ne finit pas est notée avec la commande pour la rejouer, les autres continuent.
//! Les mesures sont dans `equilibre/mesures.rs` (une ligne par mesure) ; la page du rapport dans `equilibre/rapport.html`.

mod commun;
#[path = "equilibre/mesures.rs"]
mod mesures;

use commun::{carry_on, message, play_month, Args};
use conquete::ai::AI;
use conquete::engine::Game;
use conquete::py::Val;
use mesures::{Etat, Famille, CATEGORIES_CAMP, COMPTEURS, SERIES_CAMP, SERIES_MONDE};
use serde_json::{json, Map, Value as J};
use std::collections::BTreeMap;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const AIDE: &str = "Outil d'équilibre : des séries de parties entre IA sur tous les cœurs du PC, puis un rapport HTML et un résumé
JSON (SPEC-POLITIQUE.md, module 8). À lancer depuis la racine du jeu (lancer-equilibre.cmd ou lancer-equilibre.sh le font).

Usage :  bin/equilibre                       (les réglages de outils/equilibre.toml)
         bin/equilibre --rapide              (un essai court : la section [rapide] des réglages)
         bin/equilibre --reglages autre.toml --coeurs 4 --parties 8 --annees 20 --cartes 2,5 --epoques 1700,1790
         bin/equilibre --ouvrir              (ouvre le rapport dans le navigateur à la fin)
         bin/equilibre --partie 5:1700:12:50:FR   (rejoue une seule partie : carte, époque, graine, années, camp suivi)

Écrit <sortie>/rapport-<date>.html (une page lisible hors ligne) et <sortie>/resume-<date>.json (à donner à l'assistant).";

// ================================================================== les réglages
struct Reglages {
    cartes: Vec<i64>,
    epoques: Vec<String>,
    parties: i64,
    annees: i64,
    graine: i64,
    coeurs: usize,
    joueur: String,
    sortie: String,
    limite_minutes: i64,
    domination_places: f64,
    domination_parties: f64,
    tour_ms: f64,
}

/// Un sous-ensemble de TOML suffisant pour outils/equilibre.toml : `clé = valeur` (entier, flottant, "texte", [liste]),
/// commentaires `#`, sections `[nom]` (leurs clés deviennent « nom.clé »).
fn lire_toml(texte: &str) -> Result<BTreeMap<String, J>, String> {
    let mut out = BTreeMap::new();
    let mut section = String::new();
    for (i, ligne) in texte.lines().enumerate() {
        let mut l = String::new();
        let mut guillemets = false;
        for c in ligne.chars() {
            if c == '"' {
                guillemets = !guillemets;
            }
            if c == '#' && !guillemets {
                break;
            }
            l.push(c);
        }
        let l = l.trim();
        if l.is_empty() {
            continue;
        }
        if let Some(s) = l.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            section = format!("{}.", s.trim());
            continue;
        }
        let (k, v) = l.split_once('=').ok_or(format!("ligne {} : « clé = valeur » attendu", i + 1))?;
        let v = v.trim();
        let valeur = |v: &str| -> Result<J, String> {
            let v = v.trim();
            if let Some(s) = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
                return Ok(J::from(s));
            }
            if v == "true" || v == "false" {
                return Ok(J::from(v == "true"));
            }
            v.parse::<i64>().map(J::from).or_else(|_| v.parse::<f64>().map(J::from)).map_err(|_| format!("ligne {} : valeur illisible « {v} »", i + 1))
        };
        let j = match v.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            Some(l) => J::Array(l.split(',').filter(|x| !x.trim().is_empty()).map(valeur).collect::<Result<_, _>>()?),
            None => valeur(v)?,
        };
        out.insert(format!("{section}{}", k.trim()), j);
    }
    Ok(out)
}

/// Une carte par son numéro ou son nom (aquitaine, europe, monde, amerique, inde…).
fn carte(v: &J) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        return (n == 2 || conquete::geo::theatre(n).is_some()).then_some(n);
    }
    let s = v.as_str()?.to_lowercase();
    match s.as_str() {
        "aquitaine" => Some(2),
        "monde" => Some(conquete::geo::VERSION_MONDE),
        _ => conquete::geo::THEATRES.iter().find(|t| t.id == s).map(|t| t.geo),
    }
}

fn nom_carte(v: i64) -> String {
    conquete::geo::theatre(v).map_or("Aquitaine".to_string(), |t| t.nom.to_string())
}

fn reglages(a: &Args) -> Reglages {
    let chemin = a.s("reglages", "outils/equilibre.toml");
    let toml = match std::fs::read_to_string(&chemin) {
        Ok(t) => lire_toml(&t).unwrap_or_else(|e| commun::erreur(&format!("{chemin}, {e}"))),
        Err(_) => {
            eprintln!("(pas de fichier {chemin} : réglages par défaut)");
            BTreeMap::new()
        }
    };
    let rapide = a.opt("rapide").is_some();
    // la section [rapide] l'emporte avec --rapide ; la ligne de commande sur tout
    let lire = |k: &str| -> Option<J> {
        let cmd = a.opt(k).map(|v| {
            if v.contains(',') || k == "cartes" || k == "epoques" {
                J::Array(v.split(',').map(|x| x.trim().parse::<i64>().map(J::from).unwrap_or_else(|_| J::from(x.trim()))).collect())
            } else {
                v.parse::<i64>().map(J::from).unwrap_or(J::from(v))
            }
        });
        cmd.or_else(|| rapide.then(|| toml.get(&format!("rapide.{k}")).cloned()).flatten()).or_else(|| toml.get(k).cloned())
    };
    let entier = |k: &str, d: i64| lire(k).and_then(|v| v.as_i64()).unwrap_or(d);
    let flottant = |k: &str, d: f64| lire(k).and_then(|v| v.as_f64()).unwrap_or(d);
    let texte = |k: &str, d: &str| lire(k).map(|v| v.as_str().map_or(v.to_string(), str::to_string)).unwrap_or(d.to_string());
    let liste = |k: &str| lire(k).map(|v| if let J::Array(l) = v { l } else { vec![v] });
    let cartes: Vec<i64> = liste("cartes")
        .unwrap_or_else(|| vec![J::from(2), J::from(5), J::from(13)])
        .iter()
        .map(|c| carte(c).unwrap_or_else(|| commun::erreur(&format!("carte inconnue : {c}"))))
        .collect();
    let epoques: Vec<String> = liste("epoques").unwrap_or_else(|| vec![J::from("1700")]).iter().map(|e| e.as_str().map_or(e.to_string(), str::to_string)).collect();
    for e in &epoques {
        if !["1700", "1790", "1813", "1870"].contains(&e.as_str()) {
            commun::erreur(&format!("époque inconnue : {e} (1700, 1790, 1813 ou 1870)"));
        }
    }
    let coeurs = entier("coeurs", 0);
    Reglages {
        cartes,
        epoques,
        parties: entier("parties", 32).max(1),
        annees: entier("annees", 50).max(1),
        graine: entier("graine", 1),
        coeurs: if coeurs > 0 { coeurs as usize } else { std::thread::available_parallelism().map_or(4, |n| n.get()) },
        joueur: texte("joueur", "hasard"),
        sortie: texte("sortie", "equilibre"),
        limite_minutes: entier("limite_minutes", 240),
        domination_places: flottant("domination_places", 40.0),
        domination_parties: flottant("domination_parties", 50.0),
        tour_ms: flottant("tour_ms", 3000.0),
    }
}

// ================================================================== une partie (dans son processus)
/// La sauvegarde de la partie, où les mesures lisent les champs des nouveautés. (views::to_dict pose les réglages des
/// batailles s'ils manquent : on remet ceux d'avant, la partie n'en est pas changée.)
fn sauvegarde(g: &mut Game) -> Val {
    let avant = std::mem::replace(&mut g.settings, Val::None);
    let d = conquete::views::to_dict(g);
    g.settings = avant;
    d
}

/// Le camp suivi : celui demandé, ou au hasard (selon la graine) parmi les camps de la carte.
fn creer(geo: &std::rc::Rc<conquete::geo::GeoMap>, joueur: &str, graine: i64, epoque: &str) -> Game {
    let nouvelle = |j: &str| Game::new(geo.clone(), j, &Val::from("normal"), &Val::from(graine), &Val::from(epoque));
    if joueur != "hasard" {
        return nouvelle(joueur);
    }
    let g = nouvelle(&commun::joueur_defaut(geo.version));
    let mut codes: Vec<String> = g.factions.keys().iter().map(Val::string).collect();
    codes.sort();
    let c = &codes[(graine.unsigned_abs() as usize).wrapping_mul(2654435761) % codes.len()];
    if *c == g.player { g } else { nouvelle(c) }
}

fn arrondi(x: f64) -> J {
    if !x.is_finite() {
        return J::Null;
    }
    let a = x.abs();
    let r = if a >= 100.0 { x.round() } else if a >= 10.0 { (x * 10.0).round() / 10.0 } else { (x * 100.0).round() / 100.0 };
    if r.fract() == 0.0 && a < 1e15 { J::from(r as i64) } else { J::from(r) }
}

/// Joue une partie entre IA et rend ses mesures (JSON). Une erreur du moteur arrête la partie : elle est rendue avec
/// ce qui a été mesuré jusque-là.
fn jouer(carte: i64, epoque: &str, graine: i64, annees: i64, joueur: &str) -> J {
    let geo = commun::geo(carte);
    let mut g = creer(&geo, joueur, graine, epoque);
    let ai = AI::new(&g, &g.player.clone());
    g.ais.insert(g.player.clone(), Some(ai));
    let suivi = g.player.clone();
    let mut memos: Vec<Val> = COMPTEURS.iter().map(|_| Val::None).collect();
    let mut fams: Vec<Famille> = COMPTEURS.iter().map(|_| Famille::new()).collect();
    let mut camps: BTreeMap<String, BTreeMap<&str, Vec<Option<f64>>>> = BTreeMap::new();
    let mut monde: BTreeMap<&str, BTreeMap<String, Vec<Option<f64>>>> = BTreeMap::new();
    let mut x: Vec<i64> = vec![];
    let (mut ms, mut pire, mut pire_date) = (vec![], 0.0f64, String::new());
    let mut erreur = None;

    let relever = |g: &mut Game, x: &mut Vec<i64>, camps: &mut BTreeMap<String, BTreeMap<&str, Vec<Option<f64>>>>, monde: &mut BTreeMap<&str, BTreeMap<String, Vec<Option<f64>>>>| {
        let k = x.len();
        x.push(g.date(&Val::None).year);
        let e = Etat { d: sauvegarde(g), g };
        for c in e.g.factions.keys() {
            let series = camps.entry(c.string()).or_default();
            for (id, _, f) in SERIES_CAMP {
                let v = series.entry(id).or_default();
                v.resize(k, None);
                v.push(f(&e, c.s()));
            }
        }
        for (id, _, f) in SERIES_MONDE {
            let fam = monde.entry(id).or_default();
            for (cle, val) in f(&e) {
                let v = fam.entry(cle).or_default();
                v.resize(k, None);
                v.push(Some(val));
            }
        }
    };
    let compter = |g: &mut Game, memos: &mut Vec<Val>, fams: &mut Vec<Famille>| {
        let e = Etat { d: sauvegarde(g), g };
        for (i, c) in COMPTEURS.iter().enumerate() {
            (c.f)(&e, &mut memos[i], &mut fams[i]);
        }
    };
    relever(&mut g, &mut x, &mut camps, &mut monde);
    compter(&mut g, &mut memos, &mut vec![Famille::new(); COMPTEURS.len()]); // (l'état de départ : rien n'est compté)
    let mut mois = 0;
    while mois < annees * 12 {
        let t0 = Instant::now();
        if let Err(p) = catch_unwind(AssertUnwindSafe(|| play_month(&mut g))) {
            erreur = Some(message(&*p));
            break;
        }
        let duree = t0.elapsed().as_secs_f64() * 1000.0;
        if duree > pire {
            (pire, pire_date) = (duree, g.date_str(&Val::None));
        }
        ms.push(duree);
        mois += 1;
        carry_on(&mut g);
        let ok = catch_unwind(AssertUnwindSafe(|| {
            compter(&mut g, &mut memos, &mut fams);
            if mois % 12 == 0 || g.over.truthy() {
                relever(&mut g, &mut x, &mut camps, &mut monde);
            }
        }));
        if let Err(p) = ok {
            erreur = Some(format!("mesures : {}", message(&*p)));
            break;
        }
        if g.over.truthy() {
            break;
        }
    }
    let fin = if g.over.is_dict() { Some(g.over.get_or("text", "").to_string()) } else { None };
    let noms: Map<String, J> = g.factions.keys().iter().map(|c| (c.string(), J::from(g.fname(c.s())))).collect();
    let serie = |v: &Vec<Option<f64>>| J::Array(v.iter().map(|x| x.map_or(J::Null, arrondi)).collect());
    let camps_j: Map<String, J> = camps
        .iter()
        .map(|(c, s)| (c.clone(), J::Object(s.iter().filter(|(_, v)| v.iter().any(Option::is_some)).map(|(k, v)| (k.to_string(), serie(v))).collect())))
        .collect();
    let monde_j: Map<String, J> = monde.iter().map(|(f, s)| (f.to_string(), J::Object(s.iter().map(|(k, v)| (k.clone(), serie(v))).collect()))).collect();
    let mut categories = Map::new();
    let e = Etat { d: sauvegarde(&mut g), g: &g };
    for (id, _, f) in CATEGORIES_CAMP {
        let m: Map<String, J> = e.g.factions.keys().iter().filter_map(|c| f(&e, c.s()).map(|v| (c.string(), J::from(v)))).collect();
        if !m.is_empty() {
            categories.insert(id.to_string(), J::Object(m));
        }
    }
    let compteurs: Map<String, J> = COMPTEURS
        .iter()
        .zip(&fams)
        .filter(|(_, f)| !f.is_empty())
        .map(|(c, f)| (c.id.to_string(), J::Object(f.iter().map(|(k, v)| (k.clone(), json!([arrondi(v[0]), arrondi(v[1])]))).collect())))
        .collect();
    let moy = if ms.is_empty() { 0.0 } else { ms.iter().sum::<f64>() / ms.len() as f64 };
    json!({
        "carte": carte, "epoque": epoque, "graine": graine, "annees": annees, "joueur": suivi, "erreur": erreur, "fin": fin,
        "date": g.date_str(&Val::None), "mois": mois, "ms": [arrondi(moy), arrondi(pire)], "pire_date": pire_date,
        "places_total": g.nodes.len(), "x": x, "noms": noms, "camps": camps_j, "monde": monde_j, "categories": categories,
        "compteurs": compteurs,
    })
}

// ================================================================== la série (le processus principal)
struct Travail {
    carte: i64,
    epoque: String,
    graine: i64,
}

impl Travail {
    fn arg(&self, r: &Reglages) -> String {
        format!("{}:{}:{}:{}:{}", self.carte, self.epoque, self.graine, r.annees, r.joueur)
    }
}

/// Une partie dans un processus à part : son résultat, ou l'erreur (avec la fin de ce qu'elle a écrit).
fn lancer(exe: &std::path::Path, arg: &str, limite: Duration) -> Result<J, String> {
    let mut enfant = Command::new(exe).args(["--partie", arg]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    let (mut out, mut err) = (enfant.stdout.take().unwrap(), enfant.stderr.take().unwrap());
    let lit_out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let lit_err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let t0 = Instant::now();
    let statut = loop {
        if let Some(s) = enfant.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if t0.elapsed() > limite {
            let _ = enfant.kill();
            let _ = enfant.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(250));
    };
    let (out, err) = (lit_out.join().unwrap_or_default(), lit_err.join().unwrap_or_default());
    // (sur une ligne : la panique et son message, sinon la dernière ligne écrite)
    let lignes: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
    let fin_err = match lignes.iter().position(|l| l.contains("panicked at")) {
        Some(i) => lignes[i..(i + 2).min(lignes.len())].join(" "),
        None => lignes.last().unwrap_or(&"").to_string(),
    };
    match statut {
        None => Err(format!("partie trop longue : arrêtée au bout de {} min", limite.as_secs() / 60)),
        Some(s) if !s.success() => Err(format!("le processus s'est arrêté ({s}) : {fin_err}")),
        Some(_) => out.lines().last().and_then(|l| serde_json::from_str(l).ok()).ok_or(format!("résultat illisible : {fin_err}")),
    }
}

fn duree(s: f64) -> String {
    let s = s.round() as i64;
    if s >= 3600 {
        format!("{} h {:02}", s / 3600, s % 3600 / 60)
    } else if s >= 60 {
        format!("{} min {:02} s", s / 60, s % 60)
    } else {
        format!("{s} s")
    }
}

fn main() {
    std::env::set_var("WEB_CONQUETE_NOLOG", "1"); // (le journal des batailles du joueur n'est pas touché)
    let a = Args::parse_drapeaux(AIDE, &["reglages", "coeurs", "parties", "annees", "cartes", "epoques", "graine", "joueur", "sortie", "partie"], &["rapide", "ouvrir"]);
    if let Some(p) = a.opt("partie") {
        let v: Vec<&str> = p.split(':').collect();
        if v.len() != 5 {
            commun::erreur("--partie carte:époque:graine:années:camp (camp : un code, ou hasard)");
        }
        let n = |s: &str| s.parse::<i64>().unwrap_or_else(|_| commun::erreur(&format!("nombre attendu : {s}")));
        println!("{}", jouer(n(v[0]), v[1], n(v[2]), n(v[3]), v[4]));
        return;
    }
    let r = reglages(&a);
    let exe = std::env::current_exe().unwrap_or_else(|e| commun::erreur(&format!("exécutable introuvable : {e}")));
    let debut = Instant::now();
    let horodatage = chrono::Local::now().format("%Y-%m-%d-%Hh%M").to_string();
    eprintln!(
        "Équilibre : {} parties par carte et par époque, {} ans, cartes {}, époques {}, {} cœurs",
        r.parties,
        r.annees,
        r.cartes.iter().map(|c| nom_carte(*c)).collect::<Vec<_>>().join(", "),
        r.epoques.join(", "),
        r.coeurs
    );
    // les cartes faites d'abord, une à une : les parties lisent ensuite leur cache sans se gêner
    for &c in &r.cartes {
        eprintln!("  carte {} : préparation…", nom_carte(c));
        drop(commun::geo(c));
    }
    // les grandes cartes d'abord : la fin de la série ne traîne pas sur une seule partie
    let poids = |c: i64| match c {
        13 => 0,
        5 => 1,
        2 => 3,
        _ => 2,
    };
    let mut cartes = r.cartes.clone();
    cartes.sort_by_key(|&c| poids(c));
    let travaux: Vec<Travail> = cartes
        .iter()
        .flat_map(|&c| r.epoques.iter().flat_map(move |e| (0..r.parties).map(move |i| (c, e.clone(), i))))
        .map(|(carte, epoque, i)| Travail { carte, epoque, graine: r.graine + i })
        .collect();
    let total = travaux.len();
    let suivant = AtomicUsize::new(0);
    let faits = AtomicUsize::new(0);
    let resultats: Mutex<Vec<Option<Result<J, String>>>> = Mutex::new((0..total).map(|_| None).collect());
    let limite = Duration::from_secs(r.limite_minutes.max(1) as u64 * 60);
    std::thread::scope(|s| {
        for _ in 0..r.coeurs.max(1).min(total) {
            s.spawn(|| loop {
                let k = suivant.fetch_add(1, Ordering::Relaxed);
                if k >= total {
                    break;
                }
                let t = &travaux[k];
                let t0 = Instant::now();
                let res = lancer(&exe, &t.arg(&r), limite);
                let n = faits.fetch_add(1, Ordering::Relaxed) + 1;
                let ecoule = debut.elapsed().as_secs_f64();
                let etat = match &res {
                    Ok(j) if j["erreur"].is_string() => format!("ERREUR : {}", j["erreur"].as_str().unwrap()),
                    Ok(j) => format!("finie ({})", j["date"].as_str().unwrap_or("")),
                    Err(e) => format!("PLANTÉE : {e}"),
                };
                eprintln!(
                    "[{n:>4}/{total}] {} {} graine {} : {etat}, {} (reste environ {})",
                    nom_carte(t.carte),
                    t.epoque,
                    t.graine,
                    duree(t0.elapsed().as_secs_f64()),
                    duree(ecoule / n as f64 * (total - n) as f64)
                );
                resultats.lock().unwrap()[k] = Some(res);
            });
        }
    });
    let resultats: Vec<Result<J, String>> = resultats.into_inner().unwrap().into_iter().map(Option::unwrap).collect();
    let (page, resume) = rapport(&r, &travaux, &resultats, debut.elapsed().as_secs_f64(), &horodatage);
    std::fs::create_dir_all(&r.sortie).unwrap_or_else(|e| commun::erreur(&format!("dossier {} : {e}", r.sortie)));
    let chemin_page = std::path::Path::new(&r.sortie).join(format!("rapport-{horodatage}.html"));
    let chemin_resume = std::path::Path::new(&r.sortie).join(format!("resume-{horodatage}.json"));
    std::fs::write(&chemin_page, page).unwrap_or_else(|e| commun::erreur(&format!("{} : {e}", chemin_page.display())));
    std::fs::write(&chemin_resume, resume).unwrap_or_else(|e| commun::erreur(&format!("{} : {e}", chemin_resume.display())));
    eprintln!("\nSérie finie en {}.", duree(debut.elapsed().as_secs_f64()));
    println!("Rapport : {}", chemin_page.display());
    println!("Résumé à envoyer : {}", chemin_resume.display());
    if a.opt("ouvrir").is_some() {
        ouvrir(&chemin_page);
    }
}

/// Le rapport dans le navigateur par défaut.
fn ouvrir(p: &std::path::Path) {
    let p = p.to_string_lossy().to_string();
    let r = if cfg!(windows) {
        Command::new("cmd").args(["/c", "start", "", &p]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&p).spawn()
    } else {
        Command::new("xdg-open").arg(&p).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if r.is_err() {
        eprintln!("(ouvrir le rapport à la main : {p})");
    }
}

// ================================================================== le rapport
fn mediane(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

/// Par année, [min, médiane, max] des parties (les séries d'un camp ou de la carte, une par partie).
fn bande(series: &[&J], n: usize) -> J {
    J::Array(
        (0..n)
            .map(|i| {
                let mut v: Vec<f64> = series.iter().filter_map(|s| s.get(i).and_then(J::as_f64)).collect();
                if v.is_empty() {
                    return J::Null;
                }
                let m = mediane(&mut v);
                json!([arrondi(v[0]), arrondi(m), arrondi(v[v.len() - 1])])
            })
            .collect(),
    )
}

fn derniere(s: &J) -> Option<f64> {
    s.as_array()?.iter().rev().find_map(J::as_f64)
}

fn pc(a: f64, b: f64) -> J {
    if b > 0.0 { arrondi(100.0 * a / b) } else { J::Null }
}

/// Les libellés des clés des compteurs et des séries (noms des unités, des bâtiments, des stratégies…).
fn libelles() -> J {
    use conquete::rules as R;
    let de = |d: Val, champ: &str| -> J { J::Object(d.items().into_iter().map(|(k, v)| (k.string(), J::from(v.get(champ).to_string()))).collect()) };
    let mut bat = de(conquete::cities::CHAINS(), "name");
    for (k, v) in R::BUILD().items() {
        bat[k.string()] = J::from(v.at("name").to_string());
    }
    json!({
        "unites": de(R::UNITS(), "name"), "batiments": bat, "navires": de(R::NAVIRES(), "nom"), "strategies": de(R::STRATS(), "label"),
        "strategies_nav": de(R::STRATS_NAV(), "label"), "denrees": de(R::DENREES(), "nom"),
        "agents": de(R::AGENTS(), "nom"), "missions": de(R::MISSIONS(), "nom"), "postes": de(R::MISSIONS(), "nom"),
        "ministres": de(R::POSTES(), "label"), "revolutions": de(R::REGIMES(), "label"), "regime": de(R::REGIMES(), "label"),
        "caractere": de(R::CARACTERES(), "nom"),
    })
}

fn rapport(r: &Reglages, travaux: &[Travail], res: &[Result<J, String>], secondes: f64, horodatage: &str) -> (String, String) {
    let exe = if cfg!(windows) { "bin\\equilibre.exe" } else { "bin/equilibre" };
    let mut plantages = vec![];
    let mut alertes: Vec<J> = vec![];
    let mut groupes: Vec<(i64, String, Vec<&J>)> = vec![];
    for (t, res) in travaux.iter().zip(res) {
        let commande = format!("{exe} --partie {}", t.arg(r));
        let ok = match res {
            Ok(j) if j["erreur"].is_string() => {
                plantages.push(json!({"carte": nom_carte(t.carte), "epoque": t.epoque, "graine": t.graine, "date": j["date"], "message": j["erreur"], "commande": commande}));
                None
            }
            Ok(j) => Some(j),
            Err(e) => {
                plantages.push(json!({"carte": nom_carte(t.carte), "epoque": t.epoque, "graine": t.graine, "date": null, "message": e, "commande": commande}));
                None
            }
        };
        let g = match groupes.iter_mut().find(|g| g.0 == t.carte && g.1 == t.epoque) {
            Some(g) => g,
            None => {
                groupes.push((t.carte, t.epoque.clone(), vec![]));
                groupes.last_mut().unwrap()
            }
        };
        g.2.extend(ok);
    }
    for p in &plantages {
        alertes.push(json!({"niveau": "fort", "carte": format!("{} {}", p["carte"].as_str().unwrap_or(""), p["epoque"].as_str().unwrap_or("")), "texte": format!("Partie plantée (graine {}) : {}", p["graine"], p["message"].as_str().unwrap_or("")), "commande": p["commande"]}));
    }
    let mut cartes_j = vec![];
    let mut cartes_resume = vec![];
    for (carte, epoque, parties) in &groupes {
        let nom = format!("{} {epoque}", nom_carte(*carte));
        let mut alerte = |niveau: &str, texte: String| alertes.push(json!({"niveau": niveau, "carte": nom, "texte": texte}));
        let n = parties.len();
        if n == 0 {
            alerte("fort", "Aucune partie n'a abouti : rien à mesurer.".into());
            continue;
        }
        let nf = n as f64;
        let longue = parties.iter().max_by_key(|p| p["x"].as_array().map_or(0, Vec::len)).unwrap();
        let x = longue["x"].clone();
        let nx = x.as_array().map_or(0, Vec::len);
        let mut noms = Map::new();
        for p in parties.iter() {
            for (c, v) in p["noms"].as_object().unwrap() {
                noms.entry(c.clone()).or_insert(v.clone());
            }
        }
        // ---- les camps
        let mut camps = Map::new();
        let mut lignes_resume = vec![];
        // (mois joués en moyenne : une partie peut finir avant le terme)
        let mois = parties.iter().filter_map(|p| p["mois"].as_f64()).sum::<f64>() / nf;
        let (mut en_banqueroute, mut en_famine) = (vec![], vec![]);
        for c in noms.keys() {
            let de_c: Vec<&J> = parties.iter().filter_map(|p| p["camps"].get(c)).collect();
            let mut series = Map::new();
            for (id, _, _) in SERIES_CAMP {
                let s: Vec<&J> = de_c.iter().filter_map(|x| x.get(*id)).collect();
                if !s.is_empty() {
                    series.insert(id.to_string(), bande(&s, nx));
                }
            }
            let (mut tete, mut domine, mut vivant, mut parts, mut fin) = (0.0, 0.0, 0.0, vec![], vec![]);
            let (mut gg, mut gp, mut bq, mut fam, mut morts) = (0.0, 0.0, 0.0, 0.0, vec![]);
            for p in parties.iter() {
                let Some(s) = p["camps"].get(c) else { continue };
                let places = derniere(&s["places"]).unwrap_or(0.0);
                let max = p["camps"].as_object().unwrap().values().filter_map(|s| derniere(&s["places"])).fold(0.0, f64::max);
                let part = 100.0 * places / p["places_total"].as_f64().unwrap_or(1.0).max(1.0);
                tete += (places > 0.0 && places >= max) as i64 as f64;
                domine += (part > r.domination_places) as i64 as f64;
                vivant += (derniere(&s["vivant"]) == Some(1.0)) as i64 as f64;
                if let Some(i) = s["vivant"].as_array().and_then(|v| v.iter().position(|x| x.as_f64() == Some(0.0))) {
                    morts.push(p["x"][i].as_f64().unwrap_or(0.0));
                }
                parts.push(part);
                fin.push(places);
                let cpt = |f: &str, i: usize| p["compteurs"][f][c][i].as_f64().unwrap_or(0.0);
                (gg, gp, bq, fam) = (gg + cpt("guerres", 0), gp + cpt("guerres", 1), bq + cpt("detresse", 0), fam + cpt("detresse", 1));
            }
            let k = fin.len().max(1) as f64;
            let fin_med = mediane(&mut fin);
            let part_med = mediane(&mut parts);
            let fin_de = |id: &str| series.get(id).and_then(|b| b.as_array()?.iter().rev().find_map(|x| x.get(1).and_then(J::as_f64)));
            let stats = json!({
                "places_fin": arrondi(fin_med), "part": arrondi(part_med), "tete": pc(tete, k), "domine": pc(domine, k), "survie": pc(vivant, k),
                "mort": arrondi(mediane(&mut morts)), "guerres_g": arrondi(gg / k), "guerres_p": arrondi(gp / k), "banqueroute": arrondi(bq / k),
                "famine": arrondi(fam / k), "revenus_fin": fin_de("revenus").map_or(J::Null, arrondi), "armee_fin": fin_de("armee").map_or(J::Null, arrondi),
                "techs_fin": fin_de("techs").map_or(J::Null, arrondi), "parties": k,
            });
            let nom_c = noms[c].as_str().unwrap_or(c).to_string();
            if 100.0 * domine / k > r.domination_parties {
                alerte("fort", format!("{nom_c} finit avec plus de {} % des places dans {} % des parties.", r.domination_places, (100.0 * domine / k).round()));
            }
            if k >= 4.0 && vivant == 0.0 {
                alerte("info", format!("{nom_c} est rayé de la carte dans toutes les parties (vers {}).", mediane(&mut morts.clone()).round()));
            }
            if bq / k > 0.1 * mois {
                en_banqueroute.push(format!("{nom_c} ({})", (bq / k).round()));
            }
            if fam / k > 0.1 * mois {
                en_famine.push(format!("{nom_c} ({})", (fam / k).round()));
            }
            lignes_resume.push(json!([c, stats["places_fin"], stats["part"], stats["tete"], stats["domine"], stats["survie"], stats["guerres_g"], stats["guerres_p"],
                stats["banqueroute"], stats["famine"], stats["revenus_fin"], stats["armee_fin"], stats["techs_fin"]]));
            camps.insert(c.clone(), json!({"nom": noms[c], "series": series, "stats": stats}));
        }
        for (liste, quoi) in [(&en_banqueroute, "banqueroute"), (&en_famine, "famine")] {
            if !liste.is_empty() {
                alerte("moyen", format!("{} camps passent plus de 10 % des mois en {quoi} (mois par partie, en moyenne) : {}.", liste.len(), liste.join(", ")));
            }
        }
        lignes_resume.sort_by(|a, b| b[1].as_f64().partial_cmp(&a[1].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
        // ---- toute la carte
        let mut monde = Map::new();
        let mut monde_fin = Map::new();
        for (id, _, _) in SERIES_MONDE {
            let mut cles: Vec<String> = parties.iter().filter_map(|p| p["monde"][*id].as_object()).flat_map(|m| m.keys().cloned()).collect();
            cles.sort();
            cles.dedup();
            if cles.is_empty() {
                continue;
            }
            let mut fam = Map::new();
            let mut fam_fin = Map::new();
            for k in cles {
                let s: Vec<&J> = parties.iter().filter_map(|p| p["monde"][*id].get(&k)).collect();
                let b = bande(&s, nx);
                fam_fin.insert(k.clone(), b.as_array().and_then(|v| v.iter().rev().find_map(|x| x.get(1).cloned())).unwrap_or(J::Null));
                fam.insert(k, b);
            }
            monde.insert(id.to_string(), J::Object(fam));
            monde_fin.insert(id.to_string(), J::Object(fam_fin));
        }
        let mut categories = Map::new();
        for (id, _, _) in CATEGORIES_CAMP {
            let mut m: BTreeMap<String, (f64, f64)> = BTreeMap::new(); // valeur : (camps, somme des parts)
            for p in parties.iter() {
                for (c, v) in p["categories"][*id].as_object().into_iter().flatten() {
                    let part = 100.0 * derniere(&p["camps"][c]["places"]).unwrap_or(0.0) / p["places_total"].as_f64().unwrap_or(1.0).max(1.0);
                    let e = m.entry(v.as_str().unwrap_or("?").to_string()).or_default();
                    (e.0, e.1) = (e.0 + 1.0, e.1 + part);
                }
            }
            if !m.is_empty() {
                categories.insert(id.to_string(), J::Object(m.into_iter().map(|(k, (n, s))| (k, json!([n, arrondi(s / n)]))).collect()));
            }
        }
        // ---- les compteurs (sommes sur les parties) et leurs alertes
        let geo = commun::geo(*carte);
        let g0 = Game::new(geo, &commun::joueur_defaut(*carte), &Val::from("normal"), &Val::from(1), &Val::from(epoque.as_str()));
        let lib = libelles();
        let mut compteurs = Map::new();
        for c in COMPTEURS.iter().filter(|c| !c.par_camp) {
            let mut somme: BTreeMap<String, [f64; 2]> = BTreeMap::new();
            for p in parties.iter() {
                for (k, v) in p["compteurs"][c.id].as_object().into_iter().flatten() {
                    let e = somme.entry(k.clone()).or_default();
                    e[0] += v[0].as_f64().unwrap_or(0.0);
                    e[1] += v[1].as_f64().unwrap_or(0.0);
                }
            }
            let nom_k = |k: &str| lib[c.id][k].as_str().unwrap_or(k).to_string();
            let connus = (c.connus)(&g0);
            let total: f64 = somme.values().map(|v| v[0]).sum();
            if !connus.is_empty() {
                let jamais: Vec<String> = connus.iter().filter(|k| somme.get(*k).is_none_or(|v| v[0] == 0.0)).map(|k| nom_k(k)).collect();
                if total == 0.0 {
                    alerte("info", format!("{} : rien d'observé dans ces parties.", c.titre));
                } else if !jamais.is_empty() {
                    alerte("moyen", format!("{} : jamais pris : {}.", c.titre, jamais.join(", ")));
                }
            }
            if c.ratio {
                // (se replier, rompre le combat : on y renonce à vaincre, ce n'est pas un défaut d'équilibre)
                for (k, v) in somme.iter().filter(|(k, _)| *k != "repli" && *k != "rompre") {
                    if v[0] >= 20.0 && v[1] / v[0] < 0.2 {
                        alerte("moyen", format!("{} : « {} » presque toujours perdant ({} % de {} sur {}).", c.titre, nom_k(k), (100.0 * v[1] / v[0]).round(), c.b, v[0]));
                    } else if v[0] >= 20.0 && v[1] / v[0] > 0.8 {
                        alerte("moyen", format!("{} : « {} » presque toujours gagnant ({} % de {} sur {}).", c.titre, nom_k(k), (100.0 * v[1] / v[0]).round(), c.b, v[0]));
                    }
                }
            }
            if !somme.is_empty() {
                compteurs.insert(c.id.to_string(), J::Object(somme.into_iter().map(|(k, v)| (k, json!([arrondi(v[0]), arrondi(v[1])]))).collect()));
            }
        }
        // ---- le temps des IA
        let moy = parties.iter().filter_map(|p| p["ms"][0].as_f64()).sum::<f64>() / nf;
        let pire = parties.iter().max_by(|a, b| a["ms"][1].as_f64().partial_cmp(&b["ms"][1].as_f64()).unwrap()).unwrap();
        let pire_ms = pire["ms"][1].as_f64().unwrap_or(0.0);
        if pire_ms > r.tour_ms {
            alerte("moyen", format!("Tour des IA lent : {:.1} s au pire (graine {}, {}), {:.2} s en moyenne.", pire_ms / 1000.0, pire["graine"], pire["pire_date"].as_str().unwrap_or(""), moy / 1000.0));
        }
        let temps = json!({"moyen_ms": arrondi(moy), "pire_ms": arrondi(pire_ms), "pire_graine": pire["graine"], "pire_date": pire["pire_date"]});
        let finies: Vec<J> = parties.iter().filter(|p| p["fin"].is_string()).map(|p| json!({"graine": p["graine"], "date": p["date"], "texte": p["fin"]})).collect();
        cartes_j.push(json!({
            "nom": nom, "geo": carte, "epoque": epoque, "parties": n, "x": x, "camps": camps, "monde": monde, "categories": categories,
            "compteurs": compteurs, "temps": temps, "finies": finies,
        }));
        let compteurs_resume: Map<String, J> = compteurs.iter().filter(|(k, _)| *k != "journal").map(|(k, v)| (k.clone(), v.clone())).collect();
        cartes_resume.push(json!({
            "carte": nom, "geo": carte, "epoque": epoque, "parties": n, "annees": [x[0], x[nx.saturating_sub(1)]], "temps": temps,
            "camps": lignes_resume, "compteurs": compteurs_resume, "categories": categories, "monde_fin": monde_fin, "finies": finies.len(),
        }));
    }
    let commit = Command::new("git").args(["rev-parse", "--short", "HEAD"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .or_else(|| std::fs::read_to_string("bin/commit").ok().map(|s| s.trim().chars().take(9).collect()));
    let reglages = json!({
        "cartes": r.cartes, "epoques": r.epoques, "parties": r.parties, "annees": r.annees, "graine": r.graine, "coeurs": r.coeurs, "joueur": r.joueur,
        "domination_places": r.domination_places, "domination_parties": r.domination_parties, "tour_ms": r.tour_ms,
    });
    let ordre = |a: &J| match a["niveau"].as_str() {
        Some("fort") => 0,
        Some("moyen") => 1,
        _ => 2,
    };
    alertes.sort_by_key(ordre);
    let meta = json!({
        "series_camp": SERIES_CAMP.iter().map(|(id, t, _)| json!([id, t])).collect::<Vec<_>>(),
        "series_monde": SERIES_MONDE.iter().map(|(id, t, _)| json!([id, t])).collect::<Vec<_>>(),
        "categories": CATEGORIES_CAMP.iter().map(|(id, t, _)| json!([id, t])).collect::<Vec<_>>(),
        "compteurs": COMPTEURS.iter().filter(|c| !c.par_camp).map(|c| json!({"id": c.id, "titre": c.titre, "a": c.a, "b": c.b, "ratio": c.ratio})).collect::<Vec<_>>(),
    });
    let donnees = json!({
        "date": horodatage, "commit": commit, "duree_s": secondes.round(), "reglages": reglages, "alertes": alertes, "plantages": plantages,
        "cartes": cartes_j, "meta": meta, "libelles": libelles(),
    });
    let page = include_str!("equilibre/rapport.html").replace("__DONNEES__", &donnees.to_string().replace("</", "<\\/"));
    let resume = json!({
        "outil": "equilibre (web_conquete, SPEC-POLITIQUE module 8)", "date": horodatage, "commit": commit, "duree_s": secondes.round(),
        "reglages": reglages,
        "colonnes_camps": ["camp", "places_fin (médiane)", "part_% des places", "en_tete_% des parties", "domine_% des parties", "survie_%",
                           "guerres_gagnées par partie", "guerres_perdues", "mois_banqueroute", "mois_famine", "revenus_fin", "armee_fin", "techs_fin"],
        "cartes": cartes_resume, "alertes": alertes, "plantages": plantages.iter().take(50).collect::<Vec<_>>(),
    });
    (page, resume.to_string())
}

#[cfg(test)]
mod essais {
    #[test]
    fn reglages_toml() {
        let t = super::lire_toml("# essai\ncartes = [2, \"europe\"] # deux\nparties = 4\n[rapide]\nannees = 3\nsortie = \"a#b\"\n").unwrap();
        assert_eq!(t["cartes"], serde_json::json!([2, "europe"]));
        assert_eq!(t["rapide.annees"], 3);
        assert_eq!(t["rapide.sortie"], "a#b");
        assert_eq!(super::carte(&t["cartes"][1]), Some(5));
    }
}
