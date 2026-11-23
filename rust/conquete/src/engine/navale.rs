//! Les batailles navales par stratégie (SPEC-EMPIRE, module 2), sur le modèle de la bataille terrestre
//! (SPEC-BATAILLE.md) : un seul chemin pour le joueur et les IA, l'attente du choix du joueur (`mode: "attente"`), le
//! choix des IA comme `choose_strategy`.
//!
//! `g.navales` : {bid: bataille}, une bataille étant dict(id, naval: true, x, y (le lieu, en coordonnées du moteur),
//! node: None, t0, mode ("attente" | "auto"), vent (le camp qui a le vent : 0 ou 1), phase, journal, sides: [dict(owner,
//! flottes: [fid], navires0 {type: n}, strat)] : 0 l'assaillant, 1 l'autre). Elle se règle d'un coup, par phases :
//! - **approche** : un premier feu, le démâtage ; un camp qui rompt le combat s'échappe ou non (vitesse, vent, démâtage) ;
//! - **bordées** : trois bordées ; chaque camp tire selon ses canons et la coque qui leur reste, sa stratégie, le contre
//!   (rules.CONTRE), le vent, le grade de l'amiral ; les coups vont aux navires l'un après l'autre (un navire à zéro
//!   coule) ; le brûlot sacrifie un navire pour en incendier un ennemi ;
//! - **abordage** (si l'un des deux le cherche, ou qu'un camp a perdu beaucoup) : les équipages (et l'armée à bord) ; le
//!   vainqueur prend des navires au vaincu.
//! À la fin : le camp qui a perdu la plus grande part de sa coque est vaincu et se replie vers un port ami ; l'armée
//! embarquée perd ses hommes au prorata de la place perdue à bord ; l'amiral gagne de l'expérience ; navires pris et
//! coulés comptent au prestige du vainqueur. Le hasard est propre à la bataille (il ne décale pas celui de la partie).

use super::marine as M;
use super::*;
use crate::turns as TT;

/// La bataille (son dict) vue comme une liste de navires : (flotte, type, rang, coque).
type Navire = (Val, String, usize, f64);

fn navires(g: &Game, side: &Val) -> Vec<Navire> {
    let mut out = vec![];
    for fid in side.at("flottes").iter() {
        let f = g.flottes.get(&fid);
        if f.truthy() {
            for (t, i, hp) in M::liste(&f) {
                out.push((f.clone(), t, i, hp));
            }
        }
    }
    out
}

fn compte(v: &[Navire]) -> Val {
    let d = dict! {};
    for (_, t, _, _) in v {
        d.set(t.as_str(), d.get_or(t.as_str(), 0).i() + 1);
    }
    d
}

fn feu(v: &[Navire]) -> f64 {
    v.iter().map(|(_, t, _, hp)| R::NAVIRES().at(t.as_str()).atf("canons") * hp).sum()
}

fn coque(v: &[Navire]) -> f64 {
    v.iter().map(|(_, t, _, hp)| R::NAVIRES().at(t.as_str()).atf("coque") * hp).sum()
}

/// Les hommes d'abordage : équipages, et l'armée à bord.
fn equipages(v: &[Navire]) -> f64 {
    let mut s: f64 = v.iter().map(|(_, t, _, hp)| R::NAVIRES().at(t.as_str()).atf("equipage") * hp).sum();
    let mut vues: Vec<Val> = vec![];
    for (f, _, _, _) in v {
        if !vues.iter().any(|x| x.is(f)) {
            vues.push(f.clone());
            s += 0.7 * M::effectif(&M::armee_a_bord(f));
        }
    }
    s
}

fn vitesse_min(v: &[Navire]) -> f64 {
    v.iter().map(|(_, t, _, _)| R::NAVIRES().at(t.as_str()).atf("vitesse")).fold(f64::INFINITY, f64::min)
}

/// L'amiral du camp : celui de sa plus grosse flotte.
fn amiral(g: &Game, side: &Val) -> Val {
    let mut best = (Val::None, -1);
    for fid in side.at("flottes").iter() {
        let f = g.flottes.get(&fid);
        if f.truthy() && f.getb("amiral") && M::nb_navires(&f) > best.1 {
            best = (f.at("amiral"), M::nb_navires(&f));
        }
    }
    best.0
}

fn amiral_k(g: &Game, side: &Val) -> f64 {
    let a = amiral(g, side);
    if a.truthy() { 1.0 + 0.05 * (a.ati("lvl") - 1) as f64 } else { 1.0 }
}

fn m(strat: &Val, phase: &str) -> f64 {
    if strat.is_none() { 1.0 } else { R::STRATS_NAV().at(strat).at("m").get_or(phase, 1.0).f() }
}

fn contre(sides: &Val, si: usize) -> f64 {
    let (s, o) = (sides.at(si).get("strat"), sides.at(1 - si).get("strat"));
    if s.is_none() || o.is_none() {
        return 1.0;
    }
    let mut k = 1.0;
    if R::STRATS_NAV().at(&s).at("bat").has(&o) {
        k *= R::CONTRE;
    }
    if R::STRATS_NAV().at(&o).at("bat").has(&s) {
        k /= R::CONTRE;
    }
    k
}

/// La bataille concerne-t-elle le joueur (ses flottes, ou celles de ses alliés) ?
pub fn concerne(g: &Game, bt: &Val) -> bool {
    bt.at("sides").iter().any(|s| g.friendly(&g.player, s.at("owner").s()))
}

/// Le camp du joueur dans la bataille (0, 1), ou None.
pub fn camp_du_joueur(g: &Game, bt: &Val) -> Option<usize> {
    bt.at("sides").iter().position(|s| s.at("owner") == g.player)
}

/// Les batailles navales qui attendent le joueur (TT::_scan, raccord::waiting).
pub fn en_attente(g: &Game) -> bool {
    g.navales.values().iter().any(|b| b.get("mode") == "attente")
}
pub fn en_attente_ids(g: &Game) -> Val {
    g.navales.values().into_iter().filter(|b| b.get("mode") == "attente").map(|b| b.at("id")).collect()
}

/// Les stratégies d'un camp : {id, why} (why vide si permise). Le brûlot veut au moins deux navires.
pub fn strats_dispo(g: &Game, bt: &Val, si: usize) -> Vec<(String, String)> {
    let n = navires(g, &bt.at("sides").at(si)).len();
    R::STRATS_NAV()
        .keys()
        .iter()
        .map(|id| {
            let why = if id == "brulot" && n < 2 { "Il faut au moins deux navires (l'un est sacrifié)." } else { "" };
            (id.string(), why.to_string())
        })
        .collect()
}

/// Ce que vaut une stratégie pour un camp : la part du feu et celle de l'abordage dans sa force × ce que la stratégie
/// leur change, ÷ la racine de ses pertes propres, × le contre de la stratégie que l'ennemi prendrait sans doute.
fn note(id: &str, feu_m: f64, eq_m: f64, foe_petits: bool, devine: Option<&str>) -> f64 {
    let s = R::STRATS_NAV().at(id);
    let mm = |ph: &str| s.at("m").get_or(ph, 1.0).f();
    let tot = (feu_m + eq_m).max(1e-9);
    let mut v = (feu_m * mm("bordees") + eq_m * mm("abordage")) / tot * (0.9 + 0.1 * mm("approche"));
    v /= s.atf("pertes").sqrt();
    if id == "abordage" && foe_petits {
        v *= 1.2;
    }
    if let Some(d) = devine {
        if s.at("bat").has(d) {
            v *= R::CONTRE;
        }
        if R::STRATS_NAV().at(d).at("bat").has(id) {
            v /= R::CONTRE;
        }
    }
    v
}

/// La stratégie d'un camp, choisie par son amiral (IA, ou joueur qui laisse faire), comme `choose_strategy` : très
/// inférieur (moins de la moitié de la force d'en face), il rompt le combat.
pub fn choisir_strat(g: &Game, bt: &Val, si: usize) -> String {
    let sides = bt.at("sides");
    let (mine, foe) = (navires(g, &sides.at(si)), navires(g, &sides.at(1 - si)));
    let force = |v: &[Navire]| feu(v) + coque(v) * 0.3 + equipages(v) * 0.05;
    if force(&mine) < 0.5 * force(&foe) {
        return "rompre".to_string();
    }
    let (fm, em) = (feu(&mine), equipages(&mine) * 0.1);
    let (ff, ef) = (feu(&foe), equipages(&foe) * 0.1);
    let petits = |v: &[Navire]| !v.is_empty() && v.iter().map(|(_, t, _, _)| R::NAVIRES().at(t.as_str()).atf("canons")).sum::<f64>() / (v.len() as f64) < 30.0;
    let dispo: Vec<String> = strats_dispo(g, bt, si).into_iter().filter(|(id, why)| why.is_empty() && id != "rompre").map(|x| x.0).collect();
    let devine = strats_dispo(g, bt, 1 - si)
        .into_iter()
        .filter(|(id, why)| why.is_empty() && id != "rompre")
        .map(|(id, _)| (note(&id, ff, ef, petits(&mine), None), id))
        .fold(None, |m: Option<(f64, String)>, x| if m.as_ref().is_none_or(|m| x.0 > m.0) { Some(x) } else { m })
        .map(|x| x.1);
    let mut rng = Random::new_str(&format!("{}-navale-strat-{}-{si}", g.seed, bt.at("id")));
    let mut best: Option<(f64, String)> = None;
    for id in dispo {
        let v = note(&id, fm, em, petits(&foe), devine.as_deref()) * (0.92 + 0.16 * rng.random());
        if best.as_ref().is_none_or(|b| v > b.0) {
            best = Some((v, id));
        }
    }
    best.map_or("ligne".to_string(), |b| b.1)
}

/// Après le pas d'une flotte (marine::avancer) : une flotte ennemie à portée (CONTACT_MER), hors de son port, et la
/// bataille s'engage, la flotte qui arrive étant l'assaillant. Les flottes des deux camps à portée y entrent. Rend vrai
/// si une bataille a commencé.
pub fn rencontre(g: &mut Game, f: &Val) -> bool {
    let o = f.ats("owner");
    let (x, y) = (f.atf("x") + 0.5, f.atf("y") + 0.5);
    let pres = |b: &Val| b.get("a_quai").is_none() && !b.getb("bataille") && M::dist(b, x, y) <= R::CONTACT_MER;
    let ennemi = g.flottes.values().into_iter().find(|b| pres(b) && g.at_war(&o, b.at("owner").s()));
    let Some(e) = ennemi else { return false };
    let eo = e.ats("owner");
    let att: Val = g.flottes.values().into_iter().filter(|b| b.at("owner") == o.as_str() && (b.is(f) || pres(b))).map(|b| b.at("id")).collect();
    let def: Val = g.flottes.values().into_iter().filter(|b| b.at("owner") == eo.as_str() && pres(b)).map(|b| b.at("id")).collect();
    engager(g, &att, &def, x, y);
    true
}

/// Une bataille navale entre deux groupes de flottes (identifiants) : le joueur choisit sa stratégie s'il y est (et si
/// son réglage le demande), sinon elle se règle tout de suite.
pub fn engager(g: &mut Game, att: &Val, def: &Val, x: f64, y: f64) -> Val {
    let bid = g.nid("b");
    let side = |g: &Game, ids: &Val| {
        let fl: Vec<Val> = ids.iter().map(|i| g.flottes.at(&i)).collect();
        let v: Vec<Navire> = fl.iter().flat_map(|f| M::liste(f).into_iter().map(move |(t, i, hp)| (f.clone(), t, i, hp))).collect();
        dict! {"owner" => fl[0].at("owner"), "flottes" => ids, "navires0" => compte(&v), "strat" => Val::None,
               "armee0" => fl.iter().map(|f| M::effectif(&M::armee_a_bord(f))).sum::<f64>()}
    };
    let sides = list![side(g, att), side(g, def)];
    let vent = (Random::new_str(&format!("{}-navale-vent-{bid}", g.seed)).random() < 0.5) as i64;
    let meteo = g.weather.at(g.zone_of(x, y)).at("kind");
    let bt = dict! {"id" => &bid, "naval" => true, "x" => py::round_n(x, 2), "y" => py::round_n(y, 2), "node" => Val::None,
                    "t0" => py::round_n(g.t, 2), "mode" => "auto", "vent" => vent, "meteo" => meteo, "phase" => "approche",
                    "journal" => list![], "sides" => sides};
    for ids in [att, def] {
        for fid in ids.iter() {
            g.flottes.at(&fid).set("bataille", &bid);
        }
    }
    g.navales.set(&bid, &bt);
    // le joueur choisit, comme pour une bataille terrestre (raccord::on_battle_start) : petite bataille, deux navires au plus
    crate::engine::raccord::ensure(g);
    let moi = camp_du_joueur(g, &bt);
    let st = g.settings.at("battles");
    let petite = navires(g, &bt.at("sides").at(0)).len() + navires(g, &bt.at("sides").at(1)).len() <= 2;
    if moi.is_some() && !g.ais.contains_key(&g.player) && !g.over.truthy() && (st == "demander" || (st == "auto_petites" && !petite)) {
        bt.set("mode", "attente");
        g.speed_idx = 0;
    }
    for si in 0..2 {
        if Some(si) != moi || bt.get("mode") != "attente" {
            let s = choisir_strat(g, &bt, si);
            bt.at("sides").at(si).set("strat", s);
        }
    }
    if bt.get("mode") != "attente" {
        resoudre(g, &bt);
    }
    bt
}

/// `{cmd: "tac", sub: "choose", bid, strat}` (ou `mode: "auto"`) pour une bataille navale (raccord::command).
pub fn choisir(g: &mut Game, body: &Val) -> Val {
    let bt = g.navales.get(body.get("bid"));
    if !bt.truthy() || bt.get("mode") != "attente" {
        return dict! {"ok" => false, "msg" => "Aucune bataille en attente."};
    }
    let Some(si) = camp_du_joueur(g, &bt) else {
        return dict! {"ok" => false, "msg" => "Vous n'avez pas de navires dans cette bataille."};
    };
    let strat = body.get("strat");
    let mut msg = "L'amiral choisit sa manœuvre et engage le combat.".to_string();
    if strat.is_some() {
        match strats_dispo(g, &bt, si).into_iter().find(|(id, _)| strat == id.as_str()) {
            None => return dict! {"ok" => false, "msg" => "Stratégie inconnue."},
            Some((_, why)) if !why.is_empty() => return dict! {"ok" => false, "msg" => why},
            _ => {}
        }
        msg = format!("{} : le combat s'engage.", R::STRATS_NAV().at(&strat).at("label"));
    } else if body.get("mode") != "auto" {
        return dict! {"ok" => false, "msg" => "Choisissez une stratégie."};
    }
    let s = if strat.is_some() { strat } else { Val::from(choisir_strat(g, &bt, si)) };
    bt.at("sides").at(si).set("strat", s);
    bt.set("mode", "auto");
    resoudre(g, &bt);
    if TT::planning(g) {
        TT::settle(g);
    }
    dict! {"ok" => true, "msg" => msg, "bid" => bt.at("id")}
}

/// Les coups d'une phase : `dmg` points de coque, donnés navire après navire (dans l'ordre tiré), × les pertes propres
/// de la stratégie de la cible. Rend le nombre de navires coulés.
fn frapper(v: &mut [Navire], dmg: f64, ordre: &[usize]) -> i64 {
    let mut reste = dmg;
    let mut coules = 0;
    for &i in ordre {
        if reste <= 0.0 {
            break;
        }
        let (_, t, _, hp) = &mut v[i];
        if *hp <= 0.0 {
            continue;
        }
        let c = R::NAVIRES().at(t.as_str()).atf("coque");
        let pris = reste.min(*hp * c);
        *hp -= pris / c;
        reste -= pris;
        if *hp <= 0.02 {
            *hp = 0.0;
            coules += 1;
        }
    }
    coules
}

/// Règle la bataille, phase par phase, et en tire les conséquences.
pub fn resoudre(g: &mut Game, bt: &Val) {
    let sides = bt.at("sides");
    let mut rng = Random::new_str(&format!("{}-navale-{}", g.seed, bt.at("id")));
    let mut v = [navires(g, &sides.at(0)), navires(g, &sides.at(1))];
    let coque0 = [coque(&v[0]), coque(&v[1])];
    let cap0: Vec<Vec<(Val, f64)>> = (0..2).map(|si| v[si].iter().map(|(f, _, _, _)| (f.clone(), M::capacite(f))).collect()).collect();
    let strat = |si: usize| sides.at(si).get("strat");
    let vent = bt.ati("vent") as usize;
    let k = |si: usize, ph: &str| {
        m(&strat(si), ph) * contre(&sides, si) * amiral_k(g, &sides.at(si)) * if si == vent { 1.1 } else { 1.0 }
    };
    let pertes = |si: usize| if strat(si).is_none() { 1.0 } else { R::STRATS_NAV().at(&strat(si)).atf("pertes") };
    let noms = [g.fname(&sides.at(0).ats("owner")), g.fname(&sides.at(1).ats("owner"))];
    let mut ordres: Vec<Vec<usize>> = (0..2).map(|si| (0..v[si].len()).collect()).collect();
    for o in ordres.iter_mut() {
        rng.shuffle(o);
    }
    let mut coules = [0i64; 2];
    let mut pris = [0i64; 2];
    let mut fuite: Option<usize> = None;
    let mut abord: Option<usize> = None; // le camp qui a gagné l'abordage (il garde ses prises)
    let journal = bt.at("journal");
    let phase = |ph: &str, l: [i64; 2], p: [f64; 2], w: Val| {
        journal.push(dict! {"ph" => ph, "l" => list![l[0], l[1]], "p" => list![py::round(p[0]), py::round(p[1])], "w" => w});
    };

    // ---- approche : un premier feu (le démâtage y porte), puis la fuite de celui qui rompt
    let w = list![];
    w.push(dict! {"c" => vent as i64, "t" => format!("{} a le vent", noms[vent])});
    let p = [feu(&v[0]) * 0.25 * k(0, "approche"), feu(&v[1]) * 0.25 * k(1, "approche")];
    let avant = coules;
    for si in 0..2 {
        coules[1 - si] += frapper(&mut v[1 - si], p[si] * pertes(1 - si), &ordres[1 - si]);
    }
    for si in 0..2 {
        if strat(si) == "rompre" {
            let mut ch = 0.35 + 0.4 * (vitesse_min(&v[si]) / vitesse_min(&v[1 - si]).max(1.0) - 1.0) + if si == vent { 0.15 } else { 0.0 };
            if strat(1 - si) == "demater" {
                ch *= 0.5;
            }
            if rng.random() < ch.clamp(0.05, 0.9) {
                fuite = Some(si);
                w.push(dict! {"c" => si as i64, "t" => format!("{} rompt le combat et s'échappe", noms[si])});
            } else {
                w.push(dict! {"c" => (1 - si) as i64, "t" => format!("{} ne parvient pas à rompre le combat", noms[si])});
            }
        }
    }
    phase("approche", [coules[0] - avant[0], coules[1] - avant[1]], p, w);

    // ---- bordées : trois, le brûlot d'abord
    if fuite.is_none() {
        let w = list![];
        let avant = coules;
        for si in 0..2 {
            if strat(si) == "brulot" && v[si].iter().filter(|x| x.3 > 0.0).count() >= 2 {
                // le plus petit navire est sacrifié ; il incendie le plus gros navire ennemi (plus sûrement contre une ligne coupée)
                let sac = (0..v[si].len()).filter(|&i| v[si][i].3 > 0.0).min_by(|&a, &b| {
                    R::NAVIRES().at(v[si][a].1.as_str()).atf("coque").total_cmp(&R::NAVIRES().at(v[si][b].1.as_str()).atf("coque"))
                });
                let cible = (0..v[1 - si].len()).filter(|&i| v[1 - si][i].3 > 0.0).max_by(|&a, &b| {
                    R::NAVIRES().at(v[1 - si][a].1.as_str()).atf("coque").total_cmp(&R::NAVIRES().at(v[1 - si][b].1.as_str()).atf("coque"))
                });
                if let (Some(s), Some(c)) = (sac, cible) {
                    v[si][s].3 = 0.0;
                    coules[si] += 1;
                    if rng.random() < 0.6 * contre(&sides, si) {
                        v[1 - si][c].3 = 0.0;
                        coules[1 - si] += 1;
                        w.push(dict! {"c" => si as i64, "t" => format!("Le brûlot {} incendie un {}", R::de(&noms[si]),
                            R::NAVIRES().at(v[1 - si][c].1.as_str()).ats("nom").to_lowercase())});
                    } else {
                        w.push(dict! {"c" => (1 - si) as i64, "t" => format!("Le brûlot {} est évité", R::de(&noms[si]))});
                    }
                }
            }
        }
        let mut cumul = [0.0; 2];
        for _ in 0..3 {
            let p = [feu(&v[0]) * 0.5 * k(0, "bordees"), feu(&v[1]) * 0.5 * k(1, "bordees")];
            for si in 0..2 {
                cumul[si] += p[si] / 3.0;
                coules[1 - si] += frapper(&mut v[1 - si], p[si] * pertes(1 - si), &ordres[1 - si]);
            }
        }
        let qui = if cumul[0] >= cumul[1] { 0 } else { 1 };
        w.push(dict! {"c" => qui as i64, "t" => format!("Bordées : avantage à {}", noms[qui])});
        if contre(&sides, qui) > 1.0 {
            w.push(dict! {"c" => qui as i64, "t" => format!("{} contre la manœuvre ennemie", R::STRATS_NAV().at(&strat(qui)).ats("label"))});
        }
        phase("bordees", [coules[0] - avant[0], coules[1] - avant[1]], cumul, w);
    }

    // ---- abordage : si l'un le cherche, ou qu'un camp a perdu plus de 40 % de sa coque
    let perdu = |v: &[Navire], si: usize| 1.0 - coque(v) / coque0[si].max(1e-9);
    let cherche = (0..2).any(|si| strat(si) == "abordage" || strat(si) == "couper");
    if fuite.is_none() && (cherche || perdu(&v[0], 0) > 0.4 || perdu(&v[1], 1) > 0.4) && !v[0].iter().all(|x| x.3 <= 0.0) && !v[1].iter().all(|x| x.3 <= 0.0) {
        let p = [equipages(&v[0]) * k(0, "abordage"), equipages(&v[1]) * k(1, "abordage")];
        let gagne = if p[0] >= p[1] { 0 } else { 1 };
        abord = Some(gagne);
        let r = p[gagne] / p[1 - gagne].max(1.0);
        let vivants: Vec<usize> = (0..v[1 - gagne].len()).filter(|&i| v[1 - gagne][i].3 > 0.0).collect();
        let mut n = if r > 1.3 { (vivants.len() as f64 * (0.4 * (r - 1.0)).min(0.5)).floor() as usize } else { 0 };
        if r > 2.0 && n == 0 && !vivants.is_empty() {
            n = 1;
        }
        // les plus abîmés sont pris ; ils passent au vainqueur (coque −1 : marqués pris)
        let mut par_coque = vivants.clone();
        par_coque.sort_by(|&a, &b| v[1 - gagne][a].3.total_cmp(&v[1 - gagne][b].3));
        for &i in par_coque.iter().take(n) {
            v[1 - gagne][i].3 = -1.0;
            pris[1 - gagne] += 1;
        }
        for x in v[1 - gagne].iter_mut().filter(|x| x.3 > 0.0) {
            x.3 = (x.3 - 0.1).max(0.05);
        }
        let w = list![dict! {"c" => gagne as i64, "t" => format!("Abordage : {} l'emporte{}", noms[gagne],
            if n > 0 { format!(" et prend {}", R::pl(Val::from(n as i64), "navire", None)) } else { String::new() })}];
        let mut l = [0i64; 2];
        l[1 - gagne] = n as i64;
        phase("abordage", l, p, w);
    }

    // ---- la fin
    let lf = [perdu(&v[0], 0), perdu(&v[1], 1)];
    let winner = match fuite {
        Some(si) => 1 - si,
        None => if lf[0] < lf[1] { 0 } else { 1 },
    };
    let loser = 1 - winner;
    // les coques reviennent aux flottes ; coulés et pris en sortent
    let mut prises: Vec<String> = vec![];
    for si in 0..2 {
        for (f, t, i, hp) in v[si].iter() {
            if *hp > 0.0 {
                f.at("pv").at(t.as_str()).set(*i, py::round_n(*hp, 3));
            } else if *hp < 0.0 {
                prises.push(t.clone()); // (pris à l'abordage)
            }
        }
        let fl: Vec<Val> = sides.at(si).at("flottes").iter().map(|fid| g.flottes.get(&fid)).filter(|f| f.truthy()).collect();
        for f in fl {
            let partis: Vec<(String, usize)> = v[si].iter().filter(|x| x.0.is(&f) && x.3 <= 0.0).map(|x| (x.1.clone(), x.2)).collect();
            M::retirer(&f, &partis);
            // l'armée embarquée perd ses hommes au prorata de la place perdue à bord
            let a = M::armee_a_bord(&f);
            if a.truthy() {
                let c0 = cap0[si].iter().find(|(x, _)| x.is(&f)).map_or(1.0, |x| x.1).max(1.0);
                let k = (M::capacite(&f) / c0).min(1.0);
                for r in a.at("regs").iter() {
                    r.scale("n", k);
                }
                g.prune(&a);
                if !a.atb("regs") {
                    f.pop("bord");
                    f.set("armee", Val::None);
                }
            }
            f.pop("bataille");
            if M::nb_navires(&f) == 0 {
                M::supprimer(g, &f);
            }
        }
    }
    let gagnants: Vec<Val> = sides.at(abord.unwrap_or(winner)).at("flottes").iter().map(|fid| g.flottes.get(&fid)).filter(|f| f.truthy()).collect();
    if let Some(f) = gagnants.first() {
        for t in &prises {
            M::ajouter(f, t, 0.3);
        }
    }
    let wo = sides.at(winner).ats("owner");
    let lo = sides.at(loser).ats("owner");
    // amiraux, prestige, bilan
    for (si, xp) in [(winner, 1.0), (loser, 0.34)] {
        for fid in sides.at(si).at("flottes").iter() {
            let f = g.flottes.get(&fid);
            if f.truthy() && f.getb("amiral") {
                let a = dict! {"id" => f.at("id"), "owner" => f.at("owner"), "x" => f.at("x"), "y" => f.at("y"), "gen" => f.at("amiral"),
                               "name" => "flotte"};
                g.general_xp(&a, &Val::from(xp), si == winner && fuite.is_none());
                f.set("amiral", a.at("gen"));
            }
        }
    }
    for si in 0..2 {
        let o = sides.at(si).ats("owner");
        if g.factions.has(&o) {
            let fo = g.factions.at(&o);
            fo.set("glory", fo.get_or("glory", 0.0).f() + R::PRESTIGE_NAVIRE * pris[1 - si] as f64 + R::PRESTIGE_COULE * coules[1 - si] as f64);
        }
    }
    for (si, o) in [(winner, &wo), (loser, &lo)] {
        if g.factions.has(o.as_str()) {
            g.factions.at(o.as_str()).at("stats").inc(if si == winner { "won" } else { "lost" }, 1);
        }
    }
    // le vaincu se replie (et le fuyard qui s'échappe)
    for fid in sides.at(loser).at("flottes").iter() {
        let f = g.flottes.get(&fid);
        if f.truthy() {
            M::replier(g, &f);
        }
    }
    if TT::planning(g) {
        for si in 0..2 {
            for fid in sides.at(si).at("flottes").iter() {
                let f = g.flottes.get(&fid);
                if f.truthy() && f.at("owner") == g.player {
                    f.set("mp", 0.0); // combattre termine le tour de la flotte
                }
            }
        }
    }
    bt.set("phase", "fin");
    g.navales.pop(bt.at("id"));
    if concerne(g, bt) {
        let won = g.friendly(&g.player, &wo);
        let lieu = g.place_name(bt.atf("x"), bt.atf("y"));
        let head = match fuite {
            Some(_) => format!("Bataille navale {lieu} : {} rompt le combat devant {}.", g.fname(&lo), g.fname(&wo)),
            None => format!("{} navale {lieu} — {} l'emporte.", if won { "Victoire" } else { "Défaite" }, g.fname(&wo)),
        };
        let txt = format!("{head} Navires perdus : {} {}, {} {}.{}", g.fname(&sides.at(0).ats("owner")), coules[0] + pris[0],
            g.fname(&sides.at(1).ats("owner")), coules[1] + pris[1],
            if pris[0] + pris[1] > 0 { format!(" Navires pris : {}.", pris[0] + pris[1]) } else { String::new() });
        let extra = dict! {"naval" => true, "win" => won, "a" => sides.at(0).at("owner"), "d" => sides.at(1).at("owner"),
            "la" => coules[0] + pris[0], "ld" => coules[1] + pris[1], "bid" => bt.at("id"), "node" => Val::None, "sit" => "mer",
            "w" => winner, "repli" => fuite.is_some(), "strats" => list![strat(0), strat(1)], "journal" => bt.at("journal"),
            "pese" => list![], "poursuite" => false, "prisonniers" => 0, "prises" => dict!{"navires" => pris[0] + pris[1]},
            "coules" => list![coules[0], coules[1]], "pris" => list![pris[0], pris[1]], "vent" => bt.at("vent"), "generaux" => list![]};
        g.log("battle_end", &txt, &dict! {"x" => bt.at("x"), "y" => bt.at("y"), "who" => &wo, "important" => true, "extra" => extra});
    }
}

/// Une flotte surprend une armée qui fait du cabotage seule (marine::intercepte) : l'armée n'a que ses chaloupes, elle
/// perd beaucoup d'hommes (de 10 à 60 %, selon le feu de la flotte et le nombre des hommes) et rebrousse chemin.
pub fn interception(g: &mut Game, f: &Val, a: &Val) {
    let v: Vec<Navire> = M::liste(f).into_iter().map(|(t, i, hp)| (f.clone(), t, i, hp)).collect();
    let men = M::effectif(a);
    let tir = feu(&v) * 1.25;
    let k = (0.6 * tir / (tir + men * 0.02)).clamp(0.1, 0.6);
    for r in a.at("regs").iter() {
        r.scale("n", 1.0 - k);
    }
    let perdus = py::round(men * k);
    g.prune(a);
    let (fo, ao) = (f.ats("owner"), a.ats("owner"));
    if f.getb("amiral") {
        let x = dict! {"id" => f.at("id"), "owner" => &fo, "x" => f.at("x"), "y" => f.at("y"), "gen" => f.at("amiral"), "name" => "flotte"};
        g.general_xp(&x, &Val::from(0.34), false);
        f.set("amiral", x.at("gen"));
    }
    if !a.atb("regs") {
        g.armies.del(a.at("id"));
    }
    if g.friendly(&g.player, &fo) || g.friendly(&g.player, &ao) {
        let lieu = g.place_name(a.atf("x"), a.atf("y"));
        let txt = format!("Interception {lieu} : la flotte {} surprend la {} en mer ; {perdus} hommes perdus.", R::de(&g.fname(&fo)), a.at("name"));
        let journal = list![dict! {"ph" => "bordees", "l" => list![0, 0], "p" => list![py::round(tir), 0],
            "w" => list![dict!{"c" => 0, "t" => "L'armée n'a que ses chaloupes"}]}];
        let bid = g.nid("b");
        let extra = dict! {"naval" => true, "interception" => true, "win" => g.friendly(&g.player, &fo), "a" => &fo, "d" => &ao,
            "la" => 0, "ld" => perdus, "bid" => bid, "node" => Val::None, "sit" => "mer", "w" => 0, "repli" => true,
            "strats" => list!["ligne", Val::None], "journal" => journal, "pese" => list![], "poursuite" => false, "prisonniers" => 0,
            "prises" => dict!{"navires" => 0}, "coules" => list![0, 0], "pris" => list![0, 0], "generaux" => list![]};
        g.log("battle_end", &txt, &dict! {"x" => a.at("x"), "y" => a.at("y"), "who" => &fo, "important" => true, "extra" => extra});
    }
}

/// La bataille pour la page : comme une bataille terrestre (views::player_state), avec `naval: true`, les navires de
/// chaque camp, la phase, le vent, le journal ; en attente, les choix du joueur et celui de son amiral.
pub fn vue(g: &Game, bt: &Val) -> Val {
    let moi = camp_du_joueur(g, bt);
    let mode = bt.get_or("mode", "auto");
    let sides = list![];
    for (i, s) in bt.at("sides").iter().enumerate() {
        let v = navires(g, &s);
        let am = amiral(g, &s);
        sides.push(dict! {"o" => s.at("owner"), "navires" => compte(&v), "navires0" => s.at("navires0"), "flottes" => s.at("flottes"),
                          "armee" => s.get_or("armee0", 0), "feu" => py::round(feu(&v)),
                          "strat" => if moi == Some(i) { s.get("strat") } else { Val::None },
                          "amiral" => if am.truthy() { crate::views::_gen(&am) } else { Val::None }});
    }
    let d = dict! {"id" => bt.at("id"), "naval" => true, "x" => bt.at("x"), "y" => bt.at("y"), "node" => Val::None, "amb" => false,
                   "age" => py::round_n(g.t - bt.atf("t0"), 2), "terrain" => "Océan", "phase" => bt.get_or("phase", "approche"),
                   "land" => false, "river" => 0, "sides" => sides, "mode" => &mode, "sit" => "mer",
                   "moi" => moi.map(|x| x as i64), "ouvrage" => Val::None, "meteo" => bt.get("meteo"), "vent" => bt.at("vent"),
                   "journal" => bt.get_or("journal", list![]), "pese" => list![]};
    if let (Some(si), true) = (moi, mode == "attente") {
        d.set("choix", strats_dispo(g, bt, si).into_iter().map(|(id, why)| dict! {"id" => id, "why" => why}).collect::<Val>());
        d.set("defaut", choisir_strat(g, bt, si));
        d.set("reco", Val::None);
    }
    d
}
