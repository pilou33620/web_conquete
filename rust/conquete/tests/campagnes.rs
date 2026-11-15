//! Campagnes entières contre game/ (engine, IA, villes, événements, familles, chemins de fer, crues, et le pont des
//! batailles tactiques) : tests/references/campagnes.json est écrit par le jumeau outils/jumeau/campagnes_ref.py (voir
//! son en-tête). Chaque partie est refaite de sa graine (Game::new), puis jouée mois par mois comme le Python
//! (tests/fabrique.py jouer_mois : turns::go, turns::advance, interruptions acceptées d'office ; mode 'ia' : le camp du
//! joueur gouverné par une IA, qui prend aussi ses décisions ; 'ordres' : le joueur prend ses décisions et livre ses
//! batailles, « le général commande » ou « Donner mes ordres » puis la bataille tactique jusqu'au bout : le pont des
//! batailles en campagne ; 'rien' : il ne fait rien) ; l'empreinte ordonnée de views::to_dict doit tomber
//! juste à la création et à chaque fin de mois. Un écart dit la partie, le mois et le premier champ de to_dict qui
//! diffère. Les escarmouches (skirmish::new, puis la bataille jusqu'au bout) aussi.
//!
//! Ce qui varie en Python d'un lancement à l'autre (parcours de sets de textes ; le jumeau tourne avec
//! PYTHONHASHSEED=0) :
//! - rails.py sabotage écrit une ligne du journal par camp concerné (`for who in {code} | {…}`) : leur ordre change
//!   avec PYTHONHASHSEED (g2_1870_ia, à partir du mois 23) ; le journal est comparé ces lignes rangées par camp
//!   (journal(), le même dans le jumeau), rien d'autre n'est touché ;
//! - engine.py compute_income additionne (`sum`) le commerce frontalier des voisins, un set de codes (`_douane`, puis
//!   le revenu en livres) : la somme de Python est compensée et il y a au plus 8 voisins ; refaite dans tous les ordres
//!   (toutes les permutations jusqu'à 6 voisins, 300 ordres tirés au-delà) à chacun des 67 000 appels de 8 parties
//!   (géographies 1, 2 et 3), elle n'a jamais changé d'un bit. Rien n'est donc masqué pour `_douane`.
//!
//! Pour chercher un écart (dans `<dossier>` = $CONQUETE_DIAG) :
//! - `python3 outils/jumeau/campagnes_ref.py <nom> <mois>` écrit l'empreinte après chaque pas du mois suivant
//!   (`<nom>_<mois>_pas_py.json`) ; `CONQUETE_DIAG_CAMPAGNE=<nom>:<mois>` (essai `diagnostic`, ignoré par défaut) en fait
//!   autant côté Rust et dit le premier pas qui diffère ;
//! - `python3 outils/jumeau/campagnes_ref.py <nom> <mois> <pas>` et `CONQUETE_DIAG_CAMPAGNE=<nom>:<mois>:<pas>` écrivent
//!   la forme complète de to_dict à ce pas (`_py.json`, `_rs.json`) ; avec `CONQUETE_TRACE_HASARD`, la trace des
//!   tirages du mois jusqu'à ce pas.
//! - `CONQUETE_BALAYAGE_CAMPAGNES=<fichier>` : l'essai `balayage` (ignoré par défaut) rejoue les parties tirées au sort
//!   que `python3 outils/jumeau/campagnes_ref.py balayage <fichier>` a écrites.

use conquete::ai::AI;
use conquete::engine::{Game, SUBSTEP};
use conquete::events as E;
use conquete::geo::GeoMap;
use conquete::dict;
use conquete::py::{self, json, Random, Val};
use conquete::tactics::bridge as TB;
use conquete::tactics::orders as OR;
use conquete::tactics::skirmish as S;
use conquete::turns as TT;
use conquete::views as V;
use std::rc::Rc;
use std::sync::Mutex;

fn reference() -> Val {
    json::loads(include_str!("references/campagnes.json")).unwrap()
}

/// La géographie v, relue du cache que tests/geo.rs écrit (une seule à la fois : deux fils n'écrivent pas le cache
/// ensemble).
fn geo(v: i64) -> Rc<GeoMap> {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    std::env::set_var("CONQUETE_DATA", &d);
    Rc::new(GeoMap::new(v))
}

fn neuve(geo: &Rc<GeoMap>, p: &Val) -> Game {
    let mut g = Game::new(geo.clone(), p.at("joueur").s(), &p.at("difficulte"), &p.at("graine"), &p.at("scenario"));
    if p.at("mode") == "ia" {
        let ai = AI::new(&g, &g.player.clone());
        g.ais.insert(g.player.clone(), Some(ai)); // le camp du joueur joué par une IA, comme les autres
    }
    g
}

/// 'ia', 'ordres' : les décisions qui attendent le joueur, il les prend comme son IA (outils/simuler.py play_month).
fn decider(g: &mut Game, mode: &str) {
    if mode == "rien" {
        return;
    }
    for x in g.pending_ev.iter() {
        let choices = x.at("choices");
        let n = choices.len() as i64;
        let ok = (0..n).find(|&i| E::affordable(g, &g.player.clone(), &choices.at(i).at("fx")));
        E::resolve(g, x.at("id").s(), ok.unwrap_or(n - 1), true);
    }
}

/// 'ordres' : les batailles du joueur, comme le serveur les mène (outils/jumeau/campagnes_ref.py : batailler) ; true si
/// elle a agi (le mois attend).
fn batailler(g: &mut Game, mode: &str) -> bool {
    if mode != "ordres" {
        return false;
    }
    if let Some(tb) = g.tactical.as_mut() {
        if tb.ask.truthy() {
            OR::answer(tb, "go");
        }
        TB::tick(g, 0.1);
        if g.tactical.is_none() {
            TT::go(g); // la bataille finie : « Continuer le mois »
        }
        return true;
    }
    let Some(bt) = g.battles.values().into_iter().find(|b| b.get("mode") == "attente") else { return false };
    let mut rng = Random::new_str(&format!("choix{}", bt.at("id")));
    let choix = if rng.random() < 1.0 / 3.0 { "auto" } else { "ordres" };
    let r = TB::command(g, &dict! {"sub" => "choose", "bid" => bt.at("id"), "mode" => choix});
    if r.atb("ok") && choix == "ordres" {
        let tb = g.tactical.take().unwrap();
        let raw = dict! {};
        for gr in OR::groups(&tb, tb.me.i(), &TB::_livres(g, &tb)).iter() {
            let opts = gr.at("opts");
            raw.set(gr.at("key"), opts.at(rng.choice_i(opts.len())).at("v"));
        }
        g.tactical = Some(tb);
        TB::command(g, &dict! {"sub" => "orders", "orders" => raw, "go" => true, "skip" => true});
    }
    true
}

/// tests/fabrique.py jouer_mois (outils/jumeau/campagnes_ref.py : jouer_mois).
fn jouer_mois(g: &mut Game, mode: &str) {
    TT::go(g);
    for _ in 0..1000000 {
        if g.tour.at("end").is_none() || g.over.truthy() {
            return;
        }
        decider(g, mode);
        if batailler(g, mode) {
            continue;
        }
        TT::advance(g, 1.0);
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
    }
    panic!("le tour des IA ne finit pas");
}

/// turns::advance réduit à un seul g.step (outils/jumeau/campagnes_ref.py : un_pas).
fn un_pas(g: &mut Game) -> bool {
    let tr = g.tour.clone();
    if g.over.truthy() {
        return false;
    }
    if g.speed_idx == 0 {
        if tr.at("end").is_none() || !TT::_settled(g) {
            return !tr.at("end").is_none();
        }
        TT::go(g);
    }
    if tr.at("end").is_none() {
        TT::go(g);
    }
    let sub = if g.battles.truthy() { SUBSTEP } else { SUBSTEP * 2.0 };
    let rem = tr.atf("end") - g.t;
    let seq0 = g.seq;
    if rem <= sub + 1e-6 {
        g.step((if 0.0 > rem { 0.0 } else { rem }) + 1e-9);
        g.t = tr.atf("end");
        TT::watch(g, rem, seq0);
        TT::finish(g);
        return false;
    }
    g.step(sub);
    TT::watch(g, sub, seq0);
    true
}

fn jouer_mois_pas(g: &mut Game, mode: &str, rappel: &mut dyn FnMut(&mut Game, i64) -> bool) {
    TT::go(g);
    let mut n = 0;
    while !g.tour.at("end").is_none() && !g.over.truthy() {
        decider(g, mode);
        if batailler(g, mode) {
            while g.tactical.is_some() {
                batailler(g, mode); // (la bataille tactique d'un coup : bridge::tick avance selon un budget de temps)
            }
            if rappel(g, n) {
                return;
            }
            n += 1;
            continue;
        }
        let encore = un_pas(g);
        if g.tour.at("stop").truthy() {
            TT::go(g);
        }
        if rappel(g, n) {
            return;
        }
        n += 1;
        if !encore && g.tour.at("end").is_none() {
            return;
        }
    }
}

const SABOTAGE: &str = "coupe la voie ferrée";

/// Le journal, les lignes d'un même sabotage rangées par camp (who), leurs numéros (seq) gardés dans l'ordre
/// (outils/jumeau/campagnes_ref.py : journal). rails.py sabotage écrit une ligne par camp concerné en parcourant un set
/// de textes (`for who in {code} | {…}`) : leur ordre dépend de PYTHONHASHSEED en Python (le Rust suit l'ordre
/// d'insertion). Rien d'autre n'est touché.
fn journal(events: &Val) -> Val {
    let mut out = events.vec();
    let mut i = 0;
    while i < out.len() {
        let e = out[i].clone();
        let mut j = i + 1;
        if e.at("kind") == "rail" && e.ats("text").contains(SABOTAGE) {
            while j < out.len() && out[j].at("kind") == "rail" && out[j].at("text") == e.at("text") && out[j].at("t") == e.at("t") {
                j += 1;
            }
            if j - i > 1 {
                let seqs: Vec<Val> = out[i..j].iter().map(|x| x.at("seq")).collect();
                let tries = py::sorted_by_key(out[i..j].to_vec(), |x| format!("{}", x.at("who")));
                for (k, (s, x)) in seqs.into_iter().zip(tries).enumerate() {
                    let x = x.copy();
                    x.set("seq", s);
                    out[i + k] = x;
                }
            }
        }
        i = j;
    }
    out.into_iter().collect()
}

/// views::to_dict, le journal pris par journal().
fn etat(g: &mut Game) -> Val {
    let d = V::to_dict(g);
    d.set("events", journal(&d.at("events")));
    d
}

/// L'empreinte de la partie comparée à celle du Python ; Err : le premier champ de to_dict qui diffère.
fn comparer(g: &mut Game, attendu: &Val) -> Result<(), String> {
    let d = etat(g);
    if json::empreinte_ordre(&d)[..16] == *attendu.at(0).s() {
        return Ok(());
    }
    let cles = attendu.at(1);
    for (k, h) in cles.items() {
        match d.get(&k) {
            Val::None if !d.has(&k) => return Err(format!("champ {k} absent")),
            v => {
                if json::empreinte_ordre(&v)[..8] != *h.s() {
                    return Err(format!("champ {k}"));
                }
            }
        }
    }
    let ks: Vec<String> = d.keys().iter().map(|k| k.s().to_string()).collect();
    let attendues: Vec<String> = cles.keys().iter().map(|k| k.s().to_string()).collect();
    Err(format!("ordre ou liste des champs : {ks:?} au lieu de {attendues:?}"))
}

/// Rejoue une partie de la référence (ou du balayage) ; Err : la partie, le mois et le premier champ qui diffère.
/// mois : le nombre de mois à jouer au plus (None : tous ceux de la référence).
fn rejouer(geo: &Rc<GeoMap>, p: &Val, mois: Option<usize>) -> Result<(), String> {
    let nom = p.ats("nom");
    let mode = p.ats("mode");
    let emp = p.at("emp");
    let n = emp.len().min(mois.map_or(usize::MAX, |m| m + 1));
    let t = std::time::Instant::now();
    let mut g = neuve(geo, p);
    eprintln!("{nom} : créée en {:.3} s", t.elapsed().as_secs_f64());
    comparer(&mut g, &emp.at(0)).map_err(|e| format!("{nom}, création : {e}"))?;
    let mut tj = 0.0;
    for m in 1..n as i64 {
        let t1 = std::time::Instant::now();
        jouer_mois(&mut g, &mode);
        tj += t1.elapsed().as_secs_f64();
        comparer(&mut g, &emp.at(m)).map_err(|e| format!("{nom}, fin du mois {m} ({}) : {e}", g.date_str(&Val::None)))?;
    }
    if n > 1 {
        eprintln!("{nom} : {} mois en {:.2} s (dont {tj:.2} s de jeu, le reste : empreintes)", n - 1, t.elapsed().as_secs_f64());
    }
    if n == emp.len() {
        // (la partie finie avant `mois` : le Python s'est arrêté là aussi)
        assert_eq!(g.over.truthy(), p.atb("over"), "{nom} : fin de partie");
    }
    Ok(())
}

/// Par défaut, les parties de la géographie 3 (toute la France : un mois y coûte 20 à 60 s) ne sont comparées qu'à
/// leur création, sauf g3_1790_ia et g3_1813_ordres qui jouent leur premier mois ; CONQUETE_CAMPAGNES_LONGUES=1 les
/// joue en entier (une dizaine de minutes).
fn partie(nom: &str) {
    let r = reference();
    let p = r.at("parties").iter().find(|p| p.at("nom") == nom).unwrap();
    let longues = std::env::var_os("CONQUETE_CAMPAGNES_LONGUES").is_some();
    let mois = (p.ati("geo") == 3 && !longues).then(|| ["g3_1790_ia", "g3_1813_ordres"].contains(&nom) as usize);
    if let Err(e) = rejouer(&geo(p.ati("geo")), &p, mois) {
        panic!("{e}");
    }
}

macro_rules! parties {
    ($($nom:ident),* $(,)?) => { $( #[test] fn $nom() { partie(stringify!($nom)); } )* };
}
parties!(
    g2_1790_ia, g2_1700_ia, g2_1813_rien, g2_1870_ia, g3_1790_ia, g2_1813_ordres, g2_1790_ordres, g2_1700_ordres,
    g2_1870_ordres, g3_1813_ordres, g2_1790_rien, g2_1700_rien, g2_1813_ia,
    g2_1870_rien, g3_1700_rien, g3_1813_ia, g3_1870_ia, g3_1790_rien, g1_1790_ia, c2_1700, c2_1790, c2_1813, c2_1870,
    c3_1700, c3_1790, c3_1813, c3_1870, c1_1870, c1_1700,
);

#[test]
fn toutes_les_parties_ont_leur_essai() {
    let noms = [
        "g2_1790_ia", "g2_1700_ia", "g2_1813_rien", "g2_1870_ia", "g3_1790_ia", "g2_1813_ordres", "g2_1790_ordres",
        "g2_1700_ordres", "g2_1870_ordres", "g3_1813_ordres", "g2_1790_rien", "g2_1700_rien",
        "g2_1813_ia", "g2_1870_rien", "g3_1700_rien", "g3_1813_ia", "g3_1870_ia", "g3_1790_rien", "g1_1790_ia", "c2_1700",
        "c2_1790", "c2_1813", "c2_1870", "c3_1700", "c3_1790", "c3_1813", "c3_1870", "c1_1870", "c1_1700",
    ];
    for p in reference().at("parties").iter() {
        assert!(noms.contains(&p.at("nom").s()), "{} : pas d'essai", p.at("nom"));
    }
}

// ------------------------------------------------------------------ escarmouches
fn escarmouche(nom: &str) {
    let r = reference();
    let e = r.at("escarmouches").iter().find(|e| e.at("nom") == nom).unwrap();
    let geo = geo(e.ati("geo"));
    let (g, bid) = S::new(geo, &e.at("body"));
    let mut g = g.unwrap_or_else(|| panic!("{nom} : {bid}"));
    assert_eq!(json::empreinte_ordre(&V::to_dict(&mut g)), e.ats("neuve"), "{nom} : skirmish.new");
    let mut tb = g.tactical.take().unwrap();
    assert_eq!(json::empreinte_ordre(&TB::orders_view(&g, &mut tb)), e.ats("fenetre"), "{nom} : fenêtre des ordres");
    let raw = e.at("ordres"); // (tirés au sort par le jumeau, à part : rangés dans la référence)
    let rep = TB::set_orders(&mut g, &mut tb, &raw, true, true);
    assert_eq!(json::dumps_ref_ordre(&rep), json::dumps_ref_ordre(&e.at("set_orders")), "{nom} : set_orders");
    g.tactical = Some(tb);
    let mut n = 0;
    while let Some(tb) = g.tactical.as_mut() {
        if tb.ask.truthy() {
            OR::answer(tb, "go");
        }
        S::tick(&mut g, 0.1);
        n += 1;
        assert!(n < 1000000);
    }
    let tb = g.tac_done.as_ref().unwrap();
    let (phase, clock, result) = (tb.phase.clone(), tb.clock, tb.result.clone());
    let view = result.truthy().then(|| json::empreinte_ordre(&tb.result_view(&Val::from(0))));
    assert_eq!(phase, e.ats("phase"), "{nom} : phase");
    assert_eq!(clock.to_bits(), e.atf("clock").to_bits(), "{nom} : heure de la fin");
    assert_eq!(json::dumps_ref_ordre(&result), json::dumps_ref_ordre(&e.at("result")), "{nom} : résultat");
    assert_eq!(view.map(Val::from).unwrap_or(Val::None), e.at("view"), "{nom} : result_view");
    assert_eq!(json::empreinte_ordre(&V::to_dict(&mut g)), e.ats("fin"), "{nom} : la partie à la fin");
}

macro_rules! escarmouches {
    ($($nom:ident),* $(,)?) => { $( #[test] fn $nom() { escarmouche(stringify!($nom)); } )* };
}
escarmouches!(e2_1790, e2_1813_place, e2_1870_village_def, e2_1700_hiver, e3_1790, e3_1870_place, e3_1813_def);

// ------------------------------------------------------------------ diagnostic et balayage
#[test]
#[ignore]
fn diagnostic() {
    let Ok(v) = std::env::var("CONQUETE_DIAG_CAMPAGNE") else { return };
    let dossier = std::env::var("CONQUETE_DIAG").unwrap_or_else(|_| "/tmp".into());
    let parts: Vec<&str> = v.split(':').collect();
    let (nom, mois) = (parts[0], parts[1].parse::<i64>().unwrap());
    let pas = parts.get(2).map(|p| p.parse::<i64>().unwrap());
    let r = reference();
    let p = r.at("parties").iter().find(|p| p.at("nom") == nom).unwrap_or_else(|| {
        let f = std::env::var("CONQUETE_BALAYAGE_CAMPAGNES").expect("partie inconnue");
        let b = json::loads(&std::fs::read_to_string(f).unwrap()).unwrap();
        b.iter().find(|p| p.at("nom") == nom).unwrap()
    });
    let mode = p.ats("mode");
    let mut g = neuve(&geo(p.ati("geo")), &p);
    for _ in 0..mois {
        jouer_mois(&mut g, &mode);
    }
    match pas {
        None => {
            let py: Option<Val> = std::fs::read_to_string(format!("{dossier}/{nom}_{mois}_pas_py.json"))
                .ok()
                .map(|t| json::loads(&t).unwrap());
            let mut hs = vec![];
            let mut premier = None;
            jouer_mois_pas(&mut g, &mode, &mut |g, n| {
                let h = json::empreinte_ordre(&etat(g))[..16].to_string();
                if let Some(py) = &py {
                    if premier.is_none() && (n as usize >= py.len() || *py.at(n).s() != h) {
                        premier = Some(n);
                    }
                }
                hs.push(h);
                false
            });
            std::fs::write(format!("{dossier}/{nom}_{mois}_pas_rs.json"), format!("{hs:?}")).unwrap();
            println!("{} pas ; premier pas qui diffère : {premier:?}", hs.len());
        }
        Some(pas) => {
            py::recommencer_trace();
            if pas >= 0 {
                jouer_mois_pas(&mut g, &mode, &mut |_, n| n == pas);
            }
            py::vider_trace();
            let f = format!("{dossier}/{nom}_{mois}_{pas}_rs.json");
            std::fs::write(&f, json::dumps_ref_ordre(&etat(&mut g))).unwrap();
            println!("{f}");
        }
    }
}

#[test]
#[ignore]
fn balayage() {
    let Ok(f) = std::env::var("CONQUETE_BALAYAGE_CAMPAGNES") else { return };
    let b = json::loads(&std::fs::read_to_string(f).unwrap()).unwrap();
    let (mut g2, mut g3) = (None, None);
    let mut ecarts = vec![];
    for p in b.iter() {
        let geo = match p.ati("geo") {
            2 => g2.get_or_insert_with(|| geo(2)).clone(),
            3 => g3.get_or_insert_with(|| geo(3)).clone(),
            v => geo(v),
        };
        if let Err(e) = rejouer(&geo, &p, None) {
            println!("{e}");
            ecarts.push(e);
        }
    }
    assert!(ecarts.is_empty(), "{} parties sur {} diffèrent", ecarts.len(), b.len());
}

/// Le temps d'un mois de campagne (CONQUETE_CHRONO=<partie>[:<mois>], défaut g2_1790_rien:1) : la carte relue du
/// cache, la partie créée, puis les mois joués (sans empreinte), chacun chronométré ; à comparer à
/// `python3 outils/jumeau/campagnes_ref.py chrono <partie> <mois>`.
#[test]
#[ignore]
fn chrono() {
    let v = std::env::var("CONQUETE_CHRONO").unwrap_or("g2_1790_rien:1".into());
    let (nom, mois) = v.split_once(':').map_or((v.as_str(), 1), |(n, m)| (n, m.parse().unwrap()));
    let r = reference();
    let p = r.at("parties").iter().find(|p| p.at("nom") == nom).unwrap();
    let t = std::time::Instant::now();
    let geo = geo(p.ati("geo"));
    println!("carte {} relue du cache : {:.2} s", p.at("geo"), t.elapsed().as_secs_f64());
    let t = std::time::Instant::now();
    let mut g = neuve(&geo, &p);
    println!("partie créée : {:.3} s", t.elapsed().as_secs_f64());
    for m in 1..=mois {
        let t = std::time::Instant::now();
        jouer_mois(&mut g, &p.ats("mode"));
        println!("mois {m} : {:.2} s", t.elapsed().as_secs_f64());
    }
}
