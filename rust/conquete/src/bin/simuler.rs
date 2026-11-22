//! Banc d'équilibre de la campagne : des parties jouées par les IA seules (le camp du joueur aussi), sur des graines
//! fixes, pour comparer l'équilibre avant et après un changement de règles. Portage de outils/simuler.py (mêmes
//! options, même tableau) ; `--proc` : des fils au lieu de processus, chacun avec sa carte.

mod commun;

use commun::{message, par_map, Args};
use conquete::ai::AI;
use conquete::engine::Game;
use conquete::events as E;
use conquete::geo::GeoMap;
use conquete::py::{self, Val};
use conquete::turns as TT;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

const AIDE: &str = "Banc d'équilibre de la campagne : des parties jouées par les IA seules (le camp du joueur aussi), sur des graines
fixes, pour comparer l'équilibre avant et après un changement de règles (SPEC-TECH.md, tasks/equilibre-reference.md).

Usage :  target/release/simuler --parties 3 --epoque 1790 --annees 30 --graine 1 --proc 3

Mesures, par partie puis en moyenne : erreurs (« fin » n'en est pas une : si le camp du joueur est rayé de la carte, le
monde continue, vu d'un autre camp en vie),
guerres déclarées et leur durée (mois), places de chaque camp à la fin
et écart entre le premier et le dernier, camps encore en vie, technologies trouvées, trésor, hommes sous les armes et tronçons de voie ferrée ouverts.
--proc en joue plusieurs à la fois.
--geo 5 joue sur la carte d'Europe, un autre numéro sur son théâtre (2 par défaut : le Sud-Ouest) ; --joueur le camp vu
(33, FR en Europe, le premier pays d'un autre théâtre) ;
--suivi ML,RU écrit chaque année les places, le trésor, les vivres et les hommes de ces camps ; --recit 1 écrit au fil des
mois les guerres déclarées, les traités et les capitulations (sur la sortie d'erreur, avec le temps de chaque année).";

const GRANDES_ARMES: [&str; 4] = ["gribeauval", "percussion", "lahitte", "chassepot"];
const EPOQUES: [&str; 4] = ["1700", "1790", "1813", "1870"];

/// Le camp du joueur rayé de la carte : le monde continue, vu d'un autre camp en vie (tous joués par les IA).
fn carry_on(g: &mut Game) -> bool {
    if !(g.over.is_dict() && g.over.get("result") == "defaite") {
        return false;
    }
    let mut alive: Vec<Val> = g.factions.keys().into_iter().filter(|c| g.factions.at(c).at("alive").truthy()).collect();
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
fn play_month(g: &mut Game) {
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
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
    }
    panic!("AssertionError: le tour des IA ne finit pas");
}

struct Mesures {
    seed: i64,
    date: String,
    err: Option<String>,
    guerres: i64,
    duree: f64,
    places: Vec<(String, i64)>,
    ecart: i64,
    vivants: i64,
    techs: f64,
    tresor: i64,
    hommes: i64,
    lignes: i64,
    bq: i64,
    fam: i64,
    crues: i64,
    armes: Vec<Vec<i64>>, // dans l'ordre de GRANDES_ARMES
    // les batailles (traces : Game.sites), par situation : [nombre, victoires de l'assaillant, décrochages, pertes de
    // l'assaillant, pertes du défenseur] ; et par stratégie : [fois choisie, victoires]
    bat: std::collections::BTreeMap<String, [i64; 5]>,
    strats: std::collections::BTreeMap<String, [i64; 2]>,
}

/// Une partie de `mois` tours jouée par les IA seules ; rend ses mesures.
fn simulate(geo: &Rc<GeoMap>, seed: i64, epoque: &str, mois: i64, joueur: &str, suivi: &[String], recit: bool) -> Mesures {
    let mut g = Game::new(geo.clone(), joueur, &Val::from("normal"), &Val::from(seed), &Val::from(epoque));
    let ai = AI::new(&g, &g.player.clone());
    g.ais.insert(g.player.clone(), Some(ai)); // le camp du joueur joué par une IA, comme les autres
    let mut codes: Vec<String> = g.factions.keys().iter().map(Val::string).collect();
    codes.sort();
    let codes = &codes;
    let pairs: Vec<(&str, &str)> = (0..codes.len()).flat_map(|i| codes[i + 1..].iter().map(move |b| (codes[i].as_str(), b.as_str()))).collect();
    let (mut starts, mut war_months, mut bq, mut fam) = (0, 0, 0, 0);
    let mut before: Vec<bool> = pairs.iter().map(|p| g.at_war(p.0, p.1)).collect();
    let mut err = None;
    let vivant = |g: &Game, c: &str| g.factions.at(c).at("alive").truthy();
    let (mut vu, mut chrono) = (g.seq, std::time::Instant::now());
    let (mut bat, mut strats) = (std::collections::BTreeMap::<String, [i64; 5]>::new(), std::collections::BTreeMap::<String, [i64; 2]>::new());
    let mut traces: std::collections::HashSet<String> = Default::default(); // (les traces déjà comptées : elles restent 120 jours)
    for m in 0..mois {
        // (le suivi et le récit : hors des mesures, pour lire une longue partie de contrôle)
        if m % 12 == 0 && (recit || !suivi.is_empty()) {
            eprintln!("== {} (graine {seed}) : {} camps en vie, {} guerres en cours, {:.1} s pour l'année passée ; cours : {}", g.date_str(&Val::None), codes.iter().filter(|c| vivant(&g, c)).count(), before.iter().filter(|&&w| w).count(), chrono.elapsed().as_secs_f64(), g.market);
            chrono = std::time::Instant::now();
            for c in suivi.iter().filter(|c| g.factions.has(c.as_str())) {
                let f = g.factions.at(c.as_str());
                let hommes = py::sum_v(g.armies.values().iter().filter(|a| a.at("owner") == c.as_str()).map(|a| py::sum_v(a.at("regs").iter().map(|r| r.at("n")))));
                eprintln!("   {c} {} : {} places, {:.0} livres ({:+.1}/j), {:.0} vivres ({:+.1}/j), {:.0} recrues, {} hommes en campagne, {} techniques{}", g.fname(c), g.nodes.iter().filter(|n| n.at("owner") == c.as_str()).count(),
                    f.at("res").atf("livres"), f.at("income").atf("livres"), f.at("res").atf("vivres"), f.at("income").atf("vivres"), f.at("res").atf("recrues"), hommes, f.at("techs").len(), if vivant(&g, c) { "" } else { " (disparu)" });
            }
        }
        if let Err(p) = catch_unwind(AssertUnwindSafe(|| play_month(&mut g))) {
            err = Some(message(&*p)); // une erreur est une mesure : la partie s'arrête là, le banc continue
            break;
        }
        carry_on(&mut g);
        let mut encore = std::collections::HashSet::new();
        for s in g.sites.iter() {
            let cle = format!("{} {} {}", s.at("x"), s.at("y"), s.at("t"));
            if !traces.contains(&cle) {
                let b = bat.entry(s.get_or("s", "campagne").string()).or_default();
                let w = s.get("w") == 0i64;
                b[0] += 1;
                b[1] += w as i64;
                b[2] += s.get("d").truthy() as i64;
                b[3] += s.at("l").ati(0);
                b[4] += s.at("l").ati(1);
                for (si, st) in s.get_or("st", conquete::list![]).iter().enumerate() {
                    if st.is_str() {
                        let e = strats.entry(st.string()).or_default();
                        e[0] += 1;
                        e[1] += (w == (si == 0)) as i64;
                    }
                }
            }
            encore.insert(cle);
        }
        traces = encore;
        if recit {
            for e in g.events.iter().filter(|e| e.ati("seq") > vu && (e.at("kind") == "capitulation" || e.ats("text").contains("déclare la guerre") || e.ats("text").contains("soulève"))) {
                eprintln!("   {} : {}", e.at("date"), e.at("text"));
            }
            vu = g.seq;
        }
        if g.over.truthy() {
            break;
        }
        bq += codes.iter().filter(|c| vivant(&g, c) && g.factions.at(c.as_str()).get("banqueroute").truthy()).count() as i64;
        fam += codes.iter().filter(|c| vivant(&g, c) && g.factions.at(c.as_str()).get("famine").truthy()).count() as i64;
        let now: Vec<bool> = pairs.iter().map(|p| g.at_war(p.0, p.1)).collect();
        starts += (0..pairs.len()).filter(|&k| now[k] && !before[k]).count() as i64;
        war_months += now.iter().filter(|&&w| w).count() as i64;
        before = now;
    }
    let places: Vec<(String, i64)> = codes.iter().map(|c| (c.clone(), g.nodes.iter().filter(|n| n.at("owner") == c.as_str()).count() as i64)).collect();
    if err.is_none() && g.over.truthy() {
        let texte = if g.over.is_dict() { g.over.get_or("text", "").to_string() } else { "partie terminée".to_string() };
        err = Some(format!("fin : {texte}")); // (pas une erreur)
    } else if err.is_none() && g.lost_player {
        err = Some(format!("fin : {} a disparu, vu ensuite depuis {}", if joueur == "33" { "la Gironde" } else { joueur }, g.player)); // (pas une erreur)
    }
    let n = codes.len() as f64;
    let max = places.iter().map(|p| p.1).max().unwrap();
    let min = places.iter().map(|p| p.1).min().unwrap();
    Mesures {
        seed,
        date: g.date_str(&Val::None),
        err,
        guerres: starts,
        duree: if starts != 0 { py::round_n(war_months as f64 / starts as f64, 1) } else { 0.0 },
        ecart: max - min,
        places,
        vivants: codes.iter().filter(|c| vivant(&g, c)).count() as i64,
        techs: py::round_n(codes.iter().map(|c| g.factions.at(c.as_str()).at("techs").len() as i64).sum::<i64>() as f64 / n, 1),
        tresor: py::round(py::sum_v(codes.iter().map(|c| g.factions.at(c.as_str()).at("res").at("livres"))).f() / n),
        // (army_men en valeur : une somme d'entiers reste exacte, comme en Python)
        hommes: py::round(py::sum_v(g.armies.values().iter().map(|a| py::sum_v(a.at("regs").iter().map(|r| r.at("n"))))).f() / n),
        lignes: g.rails.values().iter().filter(|st| st.get("done").truthy()).count() as i64, // tronçons de voie ferrée ouverts
        bat,
        strats,
        bq, // mois de banqueroute et de famine, tous camps
        fam,
        crues: g.city_stats.get_or("quoi", Val::dict()).get_or("crue", 0).i(), // crues de ville, tous camps
        // SPEC-ARBRE.md : année de découverte des grandes armes, par camp qui les a trouvées en cours de partie
        armes: GRANDES_ARMES
            .iter()
            .map(|t| {
                codes
                    .iter()
                    .filter_map(|c| {
                        let td = g.factions.at(c.as_str()).get_or("tech_dates", Val::dict());
                        td.has(*t).then(|| g.date(&td.at(*t).at(1)).year)
                    })
                    .collect()
            })
            .collect(),
    }
}

fn mean(rows: &[Mesures], k: fn(&Mesures) -> f64) -> String {
    py::repr_f(if rows.is_empty() { 0.0 } else { py::round_n(py::sum(rows.iter().map(k)) / rows.len() as f64, 1) })
}

fn main() {
    std::env::set_var("WEB_CONQUETE_NOLOG", "1"); // (tests/fabrique.py : le banc n'écrit pas dans logs/batailles.jsonl)
    let a = Args::parse(AIDE, &["parties", "epoque", "annees", "graine", "proc", "geo", "joueur", "suivi", "recit"]);
    let v_geo = a.i("geo", 2);
    // (le camp vu : FR en Europe, le premier pays d'un autre théâtre, 33 dans le Sud-Ouest)
    let defaut = match conquete::geo::theatre(v_geo) {
        Some(t) if t.geo == conquete::geo::VERSION_EUROPE => "FR".to_string(),
        Some(_) => conquete::rules::camps(v_geo).first().map_or_else(String::new, |c| c.string()),
        None => "33".to_string(),
    };
    let joueur = a.s("joueur", &defaut);
    let suivi: Vec<String> = a.s("suivi", "").split(',').filter(|c| !c.is_empty()).map(str::to_string).collect();
    let recit = a.i("recit", 0) != 0;
    let (parties, annees, graine, proc) = (a.i("parties", 3), a.i("annees", 30), a.i("graine", 1), a.i("proc", 1));
    let epoque = a.s("epoque", "1790");
    if !EPOQUES.contains(&epoque.as_str()) {
        commun::erreur(&format!("argument --epoque: invalid choice: '{epoque}' (choose from '1700', '1790', '1813', '1870')"));
    }
    let jobs: Vec<i64> = (0..parties).map(|i| graine + i).collect();
    let rows = par_map(&jobs, proc.max(1) as usize, || commun::geo(v_geo), |geo, &s| simulate(geo, s, &epoque, annees * 12, &joueur, &suivi, recit));
    println!("{parties} parties depuis {epoque}, {annees} ans, graines {graine} à {}", graine + parties - 1);
    println!("graine  fin                 guerres  durée  écart  vivants  techs  trésor  hommes  rails  places / erreur");
    for r in &rows {
        let tail = r.err.clone().unwrap_or_else(|| r.places.iter().map(|(c, n)| format!("{c}:{n}")).collect::<Vec<_>>().join(" "));
        println!(
            "{:>6}  {:<18} {:>8} {:>6} {:>6} {:>8} {:>6} {:>7} {:>7} {:>6}  {tail}",
            r.seed,
            r.date,
            r.guerres,
            py::repr_f(r.duree),
            r.ecart,
            r.vivants,
            py::repr_f(r.techs),
            r.tresor,
            r.hommes,
            r.lignes
        );
    }
    let erreurs = rows.iter().filter(|r| r.err.as_ref().is_some_and(|e| !e.starts_with("fin"))).count();
    println!(
        "moyenne {:<18} {:>8} {:>6} {:>6} {:>8} {:>6} {:>7} {:>7} {:>6}  erreurs : {erreurs}",
        "",
        mean(&rows, |r| r.guerres as f64),
        mean(&rows, |r| r.duree),
        mean(&rows, |r| r.ecart as f64),
        mean(&rows, |r| r.vivants as f64),
        mean(&rows, |r| r.techs),
        mean(&rows, |r| r.tresor as f64),
        mean(&rows, |r| r.hommes as f64),
        mean(&rows, |r| r.lignes as f64)
    );
    println!(
        "mois de banqueroute / de famine (tous camps) : {} / {}",
        rows.iter().map(|r| r.bq).sum::<i64>(),
        rows.iter().map(|r| r.fam).sum::<i64>()
    );
    // les batailles (SPEC-BATAILLE.md) : leurs issues par situation, et ce que vaut chaque stratégie
    let mut bat = std::collections::BTreeMap::<String, [i64; 5]>::new();
    let mut strats = std::collections::BTreeMap::<String, [i64; 2]>::new();
    for r in &rows {
        for (k, v) in &r.bat {
            let e = bat.entry(k.clone()).or_default();
            (0..5).for_each(|i| e[i] += v[i]);
        }
        for (k, v) in &r.strats {
            let e = strats.entry(k.clone()).or_default();
            (0..2).for_each(|i| e[i] += v[i]);
        }
    }
    let pc = |a: i64, b: i64| if b > 0 { py::round(100.0 * a as f64 / b as f64) } else { 0 };
    println!("batailles : {} ; par situation (nombre, assaillant vainqueur, vaincu qui décroche, pertes moyennes assaillant / défenseur) :", bat.values().map(|v| v[0]).sum::<i64>());
    for (k, v) in &bat {
        println!("  {k:<9} {:>6}  {:>3} %  {:>3} %  {:>6} / {}", v[0], pc(v[1], v[0]), pc(v[2], v[0]), v[3] / v[0].max(1), v[4] / v[0].max(1));
    }
    println!("stratégies (fois choisie, victoires) : {}", strats.iter().map(|(k, v)| format!("{k} {} ({} %)", v[0], pc(v[1], v[0]))).collect::<Vec<_>>().join(", "));
    println!("crues de ville (tous camps) : {} en {} ans de jeu", rows.iter().map(|r| r.crues).sum::<i64>(), parties * annees);
    for (k, t) in GRANDES_ARMES.iter().enumerate() {
        let ys: Vec<i64> = rows.iter().flat_map(|r| r.armes[k].iter().copied()).collect();
        let vers = if ys.is_empty() {
            String::new()
        } else {
            let s: i64 = ys.iter().sum();
            format!(", vers {} ({} à {})", py::round(s as f64 / ys.len() as f64), ys.iter().min().unwrap(), ys.iter().max().unwrap())
        };
        println!("{t:<11} trouvée en cours de partie par {} camps sur {}{vers}", ys.len(), 5 * rows.len());
    }
}
