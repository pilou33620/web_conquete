//! Porte game/tactics/ai.py, lignes 2006 à 2796 : rase campagne (la ligne : phases et bonds, ruses, canons à
//! enlever, réserves, réoccupation).
//! Conventions : l'en-tête de ai/mod.rs.

use super::*;

// ---------------------------------------------------------------------- aides (hors du socle)

/// `max(a, b)` de Python entre flottants : a, sauf si b est plus grand.
fn pmax(a: f64, b: f64) -> f64 {
    if b > a { b } else { a }
}
/// `min(a, b)` de Python entre flottants : a, sauf si b est plus petit.
fn pmin(a: f64, b: f64) -> f64 {
    if b < a { b } else { a }
}
/// `x ** 2`.
fn sq(x: f64) -> f64 {
    py::pow(x, 2.0)
}
/// Un nombre ou None.
fn opt(v: &Val) -> Option<f64> {
    if v.is_none() { None } else { Some(v.f()) }
}
/// `[u.id]`.
fn ids(u: &Val) -> Val {
    list![u.at("id")]
}
/// `v in ('a', 'b', …)`.
fn dans(v: &Val, l: &[&str]) -> bool {
    l.iter().any(|x| *v == **x)
}
/// `_d2(a.x, a.y, b.x, b.y)`.
fn d2u(a: &Val, b: &Val) -> f64 {
    _d2(a.atf("x"), a.atf("y"), b.atf("x"), b.atf("y"))
}
/// `l.remove(u)` sur une liste d'unités (une unité n'est égale qu'à elle-même).
fn ote(l: &mut Vec<Val>, u: &Val) {
    if let Some(i) = l.iter().position(|v| v.is(u)) {
        l.remove(i);
    }
}
/// `min(l, key=lambda r: _d2(r.x, r.y, x, y))` (le premier gagne).
fn plus_proche(l: &[Val], x: f64, y: f64) -> Val {
    py::min_by_key(l.iter().cloned(), |r| _d2(r.atf("x"), r.atf("y"), x, y)).expect("ValueError: min() arg is an empty sequence")
}

// ---------------------------------------------------------------------- rase campagne

/// Profondeur (par rapport à l'ancre) du premier ennemi devant la ligne, dans son couloir ; et son latéral moyen.
///
/// Python (ai.py, l. 2007-2016) : `def _front_dep(body, ax, ay, fd, span)`
/// Rend (profondeur du premier ennemi ou None, latéral moyen).
pub fn _front_dep(body: &[Repere], ax: f64, ay: f64, fd: f64, span: f64) -> (Val, f64) {
    let mut best: Option<f64> = None;
    let mut lats = vec![];
    for (_k, x, y, _cls, _form) in body {
        let (d, l) = _rel(*x, *y, ax, ay, fd);
        if l.abs() < span && d > -150.0 && (best.is_none() || d < best.unwrap()) {
            best = Some(d);
        }
        lats.push(l);
    }
    let n = lats.len();
    (Val::from(best), if n > 0 { py::sum(lats) / n as f64 } else { 0.0 })
}

/// Python (ai.py, l. 2019-2024) : `def _set_phase(b, mem, ph, txt=None)`
/// txt : texte ou None (défaut).
pub fn _set_phase(b: &mut TacticalBattle, mem: &Val, ph: &str, txt: &Val) {
    if mem.get("phase") != ph {
        mem.set("phase", ph);
        mem.set("t_phase", py::round(b.clock));
        if txt.truthy() {
            _note(b, mem, txt.s());
        }
    }
}

/// Retour offensif : l'assaut est venu, il reflue ou s'essouffle, nos troupes tiennent, et il nous reste de quoi
/// frapper ; la ligne quitte ses postes et marche à l'ennemi (Marengo : Desaix et Kellermann ; Fontenoy : la Maison du
/// Roi sur la colonne anglaise). Vrai s'il est lancé.
///
/// Python (ai.py, l. 2027-2068) : `def _retour(b, side, mem, L, us, sit, line)`
/// line : liste d'unités. `mem.get('stats', {}).get('ro', 0)`.
pub fn _retour(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, line: &Val) -> bool {
    let now = b.clock;
    if !mem.getb("pressed") || mem.get_or("stats", Val::dict()).get_or("ro", 0) >= 2i64 {
        return false;
    }
    if now - mem.get_or("ro_end", -1e9).f() < 1200.0 {
        return false;
    }
    if now - mem.get_or("near_t", now).f() < L.atf("ro_ebb") && sit.atf("e_routed") < 2.0 {
        return false; // l'assaut est encore sur nous
    }
    if sit.atf("mor") <= 55.0 || sit.atf("loss") >= L.atf("wd_loss") - 0.05 || b.time_left() <= 1200.0 {
        return false;
    }
    let tr = b.r#trait(side);
    let k = L.atf("ro_k") + (if tr == "audacieux" { -0.15 } else if tr == "prudent" { 0.2 } else { 0.0 });
    if sit.atf("ratio") < k {
        return false;
    }
    let mut why: Vec<String> = vec![];
    let (cas, e_cas) = _cas(b, side, mem);
    if e_cas >= 1.3 * cas && e_cas > 0.03 {
        why.push(format!("il a perdu {} % de son monde", py::round(e_cas * 100.0)));
    }
    let inf: Vec<Val> = sit.at("seen").iter().filter(|e| e.at("cls") == "inf").collect();
    if !inf.is_empty() && py::sum(inf.iter().map(|e| e.atf("morale"))) / (inf.len() as f64) < 60.0 {
        why.push("ses bataillons sont ébranlés".to_string());
    }
    if sit.atf("e_routed") >= 1.0 {
        why.push("il a des fuyards".to_string());
    }
    if line.truthy() && py::max_f(line.iter().map(|u| u.atf("hit_t"))).unwrap() < now - 180.0 {
        why.push("son feu a cessé".to_string());
    }
    if why.len() < 2 {
        return false;
    }
    let roles = mem.at("role");
    let fresh = us.iter().any(|u| {
        U::valid(&u)
            && u.at("cls") == "inf"
            && dans(&roles.get(u.at("id")), &["res", "garde_flanc"])
            && u.atf("morale") > 60.0
            && u.atf("ammo") > 0.5 * u.atf("ammo0")
    }) || us.iter().any(|u| U::valid(&u) && u.at("cls") == "cavalerie" && u.atf("morale") > 60.0 && u.atf("men") > 0.5 * u.atf("men0"));
    if !fresh {
        return false;
    }
    mem.set(
        "ro",
        dict! {"t0" => py::round(now), "loss0" => py::round_n(sit.atf("loss"), 3), "ax0" => mem.at("ax"), "ay0" => mem.at("ay"),
        "er0" => sit.at("e_routed")},
    );
    mem.set("plan", "frontal");
    mem.set("mode", "ligne");
    _recenter(mem, line);
    let txt = format!("l'attaque ennemie s'essouffle : retour offensif ({}).", why.join(", "));
    _set_phase(b, mem, "assaut", &Val::from(txt));
    _stat(mem, "ro", 1);
    true
}

/// Le retour offensif s'arrête quand il coûte trop, s'aventure trop loin sous les canons ennemis sans que
/// l'ennemi plie, ou s'enlise : la ligne réoccupe ses postes.
///
/// Python (ai.py, l. 2071-2095) : `def _retour_stop(b, side, mem, L, sit)`
pub fn _retour_stop(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, sit: &Val) {
    let ro = mem.at("ro");
    let now = b.clock;
    let dep = _rel(mem.atf("ax"), mem.atf("ay"), ro.atf("ax0"), ro.atf("ay0"), mem.atf("fd")).0;
    let why = if sit.atf("loss") - ro.atf("loss0") > L.atf("ro_stop") {
        "il coûte trop cher"
    } else if dep > L.atf("ro_depth") && sit.atf("e_routed") < 2.0 {
        "on ne s'aventure pas sous ses canons"
    } else if sit.atf("mor") < 50.0 {
        "nos troupes sont lasses"
    } else if sit.atf("ratio") < L.atf("ro_k") - 0.25 {
        "l'ennemi est encore trop fort"
    } else if now - ro.atf("t0") > 2400.0 && sit.at("e_routed") <= ro.at("er0") {
        "l'ennemi ne plie pas"
    } else {
        return;
    };
    mem.update(&dict! {"plan" => "tenir", "mode" => "poste", "ax" => ro.at("ax0"), "ay" => ro.at("ay0"), "ro_end" => py::round(now)});
    mem.pop("ro");
    mem.set("pressed", 0);
    for (k, _st) in mem.get("scr").or(Val::dict()).items() {
        mem.at("scr").set(&k, list![1, py::round(now)]);
    }
    _set_phase(b, mem, "combat", &Val::from(format!("fin du retour offensif ({why}) : la ligne reprend ses postes.")));
}

/// Python (ai.py, l. 2098-2320) : `def _think_field(b, side, mem, L, us, foes, sit, want, busy)`
/// `getattr(b.unit(t[0]), 'light', False)` : b.unit peut rendre None. `OR::ask(…) == 'go'`.
/// `refused = {v: int(k) …}` : les clés de mem['refuse'] sont '1' ou '-1'. `max([...] or [120])` : des entiers.
/// Les 'want' de la ligne : [x, y, d, forme, False].
pub fn _think_field(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    if mem.get("ro").truthy() {
        _retour_stop(b, side, mem, L, sit);
    }
    let plan = mem.ats("plan");
    let now = b.clock;
    let roles = mem.at("role");
    let fd = mem.atf("fd");
    let body = _body(b, mem, 150.0);
    let width = mem.get_or("width", 600).f();
    let line: Val = us.iter().filter(|u| roles.get(u.at("id")) == "ligne").collect();
    let e_inf = _einf(b, &line);
    let mut halt = mem.get_or("halt_k", 0.85).f() * e_inf;
    let od = mem.get("ord").or(Val::dict());
    if od.get("man") == "fixer" {
        halt *= 1.35; // ordres : la ligne fixe l'ennemi de loin, par son feu
    }
    let attacking = ["frontal", "artillerie", "debordement"].contains(&plan.as_str()) || (plan == "harcelement" && side == 0);
    // (l'assaillant règle sa marche sur la ligne ennemie, pas sur son écran de tirailleurs, qui se replie devant lui :
    // arrêté devant l'écran, il croyait le combat engagé et piétinait loin de la ligne ; banc IA)
    let fbody: Vec<Repere> = if attacking {
        body.iter()
            .filter(|t| {
                let v = b.unit(&t.0);
                !(v.is_some() && v.atb("light"))
            })
            .cloned()
            .collect()
    } else {
        body.clone()
    };
    let (front_v, lat_c) = _front_dep(if fbody.is_empty() { &body } else { &fbody }, mem.atf("ax"), mem.atf("ay"), fd, width / 2.0 + 250.0);
    let front = opt(&front_v);
    _roles_update(b, side, mem, L, us, sit, &front_v);
    let mut ph = mem.ats("phase");
    let seen = sit.at("seen");
    // --------------------------------------------------------------- défenseur
    if !attacking {
        if ph == "attente" && (front.is_some_and(|f| f < 1300.0) || seen.truthy()) {
            _set_phase(b, mem, "combat", &Val::None);
        }
        if mem.at("phase") == "combat" {
            // l'assaut est-il venu ? (pour juger plus tard qu'il reflue)
            if front.is_some_and(|f| f <= 400.0) {
                mem.set("pressed", 1);
            }
            if seen.iter().any(|e| {
                e.at("cls") == "inf" && U::valid(&e) && !e.atb("light") && line.iter().any(|u| d2u(&e, &u) < sq(220.0))
            }) {
                mem.set("near_t", py::round(now));
            }
        }
        if plan == "tenir" && L.atb("counter") && mem.at("phase") == "combat" {
            if sit.atf("ratio") >= L.atf("counter_k")
                && sit.atf("e_routed") >= 2.0
                && sit.atf("mor") > 50.0
                && OR::ask(b, side, "contre", "L'assaillant flanche : lancer la contre-attaque générale ?") == "go"
            {
                mem.set("plan", "frontal");
                mem.set("mode", "ligne");
                _recenter(mem, &line);
                let txt = format!("l'assaillant flanche : contre-attaque générale (rapport {:.1}).", sit.atf("ratio"));
                _set_phase(b, mem, "assaut", &Val::from(txt));
            } else {
                _retour(b, side, mem, L, us, sit, &line);
            }
        }
        let crest = mem.get("crest").or(Val::dict());
        let mut ct = Val::None;
        let mut r_up = 0.0;
        let mut inf_body: Vec<Repere> = vec![];
        if crest.truthy() {
            ct = mem.setdefault("crest_t", Val::dict());
            let e_e = seen.iter().filter(|e| e.at("cls") == "inf").map(|e| b.ranges(&e).0).max().unwrap_or(120);
            r_up = pmax(260.0, 2.2 * e_e as f64);
            inf_body = body.iter().filter(|t| t.3 == "inf").cloned().collect();
        }
        let refused = Val::dict();
        for (k, v) in mem.get("refuse").or(Val::dict()).items() {
            refused.set(&v, k.s().trim().parse::<i64>().expect("ValueError: int()"));
        }
        for u in line.iter() {
            let uid = u.at("id");
            let p = mem.at("post").get(&uid);
            if p.truthy() {
                let (mut x, mut y, mut d) = (p.atf(0), p.atf(1), p.atf(2));
                let c = crest.get(&uid);
                if c.truthy() {
                    // contre-pente : à l'abri tant que l'assaut est loin, sur la crête pour le recevoir par son feu
                    let (cx, cy) = c.xy();
                    let dm = py::min_f(inf_body.iter().map(|t| py::hypot(t.1 - cx, t.2 - cy))).unwrap_or(1e9);
                    let mut up = now - ct.get_or(&uid, -1e9).f() < 120.0;
                    if dm < r_up || (up && dm < 1.3 * r_up) {
                        ct.set(&uid, py::round(now));
                        if !up {
                            _note_once(b, mem, "crete", "à l'abri derrière la crête, la ligne se porte sur la crête et fait feu.", 1800.0);
                        }
                        up = true;
                    }
                    if up {
                        (x, y) = (cx, cy);
                    }
                }
                if refused.has(&uid) {
                    // refus du flanc : le bataillon du bout de l'aile fait face au débordement
                    (x, y) = _at(x, y, mem.atf("fd"), -40.0, 0.0);
                    d = mem.atf("fd") + refused.at(&uid).f() * 0.7;
                }
                let f = _march_form(b, mem, L, &u, x, y, _foe_dist(&u, &body), true).or("ligne");
                let form = if f == "colonne" && front.is_none() {
                    Val::from("colonne")
                } else if f == "colonne" {
                    Val::from("ligne")
                } else {
                    f
                };
                want.set(&uid, list![x, y, d, form, false]);
            }
        }
        _lights_def(b, side, mem, L, us, foes, sit, want, busy);
        if L.atb("retake") {
            _retake(b, side, mem, us, sit, busy);
        }
        return;
    }
    // --------------------------------------------------------------- assaillant (ou contre-attaque)
    let (mut ax, mut ay) = (mem.atf("ax"), mem.atf("ay"));
    // (l'ordre oblique du difficile, qui portait toute la ligne contre l'aile ennemie la plus faible, a été retiré :
    // sur 96 batailles, l'assaillant difficile gagnait 27 fois avec, 36 sans ; la mitraille à bout portant le punissait)
    let mut shift: Option<f64> = None;
    if !body.is_empty() && lat_c.abs() > width / 2.0 && L.ati("n") >= 1 {
        shift = Some(lat_c * 0.5); // l'ennemi n'est pas en face : la ligne glisse vers lui
    }
    if let Some(s) = shift {
        if s != 0.0 && s.abs() > 30.0 {
            let step = pmax(-140.0, pmin(140.0, s));
            (ax, ay) = _at(ax, ay, fd, 0.0, step);
            mem.set("ax", py::round_n(ax, 1));
            mem.set("ay", py::round_n(ay, 1));
        }
    }
    let has_art = us.iter().any(|u| roles.get(u.at("id")) == "art" && U::valid(&u));
    let e_art = us.iter().filter(|u| u.at("cls") == "artillerie").map(|u| b.ranges(&u).0).max().unwrap_or(0);
    let mut standoff = if has_art { pmax(430.0, pmin(560.0, e_art as f64 * 0.75)) } else { 430.0 };
    if plan == "harcelement" {
        standoff = 450.0;
    }
    // la ligne attend la fin de la préparation hors du feu de l'infanterie ennemie (1870 : le Chassepot tue à 650 m ;
    // les cartouches fondaient pendant la canonnade)
    let e_fo = match seen.iter().filter(|e| e.at("cls") == "inf").map(|e| b.ranges(&e).0).max() {
        Some(m) => Val::from(m),
        None => mem.get_or("e_fo", 0),
    };
    if e_fo.truthy() {
        mem.set("e_fo", e_fo.clone());
        standoff = pmax(standoff, 1.3 * e_fo.f() + 60.0);
    }
    if mem.get("era") == 0i64 {
        halt = pmin(halt, 0.8 * e_inf); // (ordre linéaire : le feu de peloton se donne de près)
    }
    if ph == "attente" {
        _set_phase(b, mem, "marche", &Val::None);
        ph = "marche".to_string();
    }
    if ph == "marche" {
        if front.is_some_and(|f| f < standoff + 120.0) {
            if plan == "harcelement" {
                _set_phase(b, mem, "prepa", &Val::from("l'ennemi est en vue : escarmouche à longue portée."));
            } else if has_art && ["frontal", "artillerie", "debordement"].contains(&plan.as_str()) {
                _set_phase(b, mem, "prepa", &Val::from("l'ennemi est en vue : l'artillerie se met en batterie, la ligne attend."));
            } else {
                _set_phase(b, mem, "assaut", &Val::from("l'ennemi est en vue : la ligne marche à l'ennemi."));
            }
        } else {
            let tgt;
            if let Some(f) = front {
                tgt = f - standoff;
            } else {
                let ez = b.ai_zone(1 - side);
                let mut t = _rel((ez.atf(0) + ez.atf(2)) / 2.0, (ez.atf(1) + ez.atf(3)) / 2.0, ax, ay, fd).0 - 450.0;
                let seen_once = _body(b, mem, 7200.0);
                if !seen_once.is_empty() {
                    // l'ennemi a été vu, puis perdu de vue (bois, brouillard) : on marche sur sa dernière position connue
                    t = py::min_f(seen_once.iter().map(|r| _rel(r.1, r.2, ax, ay, fd).0)).unwrap() - standoff;
                } else if mem.get("t_probe").is_some() || t.abs() < 40.0 {
                    // personne en vue au bout de la marche : l'ennemi attend peut-être dans les bois ; après 5 min, la
                    // ligne (ses légers devant) va le chercher par bonds, jusqu'au fond de sa zone
                    let t0 = mem.setdefault("t_probe", py::round(now)).f();
                    t = if now - t0 > 300.0 { t + 750.0 } else { 0.0 };
                    if t != 0.0 {
                        _note_once(b, mem, "probe", "personne en vue : la ligne s'avance à la recherche de l'ennemi.", 7200.0);
                    }
                }
                tgt = t;
            }
            _advance(b, mem, L, &line, tgt, &Val::None);
        }
    }
    ph = mem.ats("phase");
    if ph == "prepa" {
        let t = now - mem.atf("t_phase");
        let prep = L.atf("prep") * (if plan == "artillerie" { 2.0 } else { 1.0 });
        let prep_max = L.atf("prep_max") * (if plan == "artillerie" { 1.5 } else { 1.0 });
        let mut done = t >= prep;
        if L.ati("n") == 2 && t < prep_max && done {
            // en difficile : on attend que l'artillerie ait ébranlé l'ennemi
            let seen_mor: Vec<f64> = seen.iter().filter(|e| e.at("cls") == "inf").map(|e| e.atf("morale")).collect();
            // (le moral remonte vite au repos, jusqu'à 90 et plus près du général : « ébranlé », c'est moins de 82)
            let n = seen_mor.len();
            if n > 0 && py::sum(seen_mor) / n as f64 > 82.0 && sit.atf("ratio") < 1.3 {
                done = false;
            }
        }
        if plan == "debordement" {
            done = mem.get("fl") == "attaque" || t >= prep_max;
        }
        let gun = us.iter().find(|u| u.at("cls") == "artillerie" && U::valid(u));
        if let Some(gun) = gun {
            if t > prep * 0.5 && _grape_dist(b, mem, L, &gun, &b.ranges(&gun).2, foes).truthy() {
                done = true; // plus rien ne menace nos canons : ligne et batteries s'avancent ensemble
            }
        }
        if plan == "harcelement" {
            done = false;
        }
        if let Some(f) = front {
            _advance(b, mem, L, &line, f - standoff, &Val::None);
        }
        if done {
            _set_phase(b, mem, "assaut", &Val::from("fin de la préparation : la ligne avance par bonds."));
        }
    }
    ph = mem.ats("phase");
    let rupture = L.atb("rupture") && ["frontal", "artillerie", "debordement"].contains(&plan.as_str());
    if rupture && ["prepa", "assaut", "combat"].contains(&ph.as_str()) {
        _point(b, side, mem, L, sit);
    }
    // 1870 : la ligne de tirailleurs avance par bonds courts sous le feu (difficile : par moitiés, l'une tire pendant
    // que l'autre bondit)
    let bound = if mem.get("era") == 2i64
        && front.is_some_and(|f| f < 1.6 * e_fo.or(500).f())
        && ["assaut", "combat"].contains(&ph.as_str())
    {
        L.at("bound_feu")
    } else {
        Val::None
    };
    if bound.truthy() && bound < L.at("bound") {
        let moit = if L.atb("halves") { ", une moitié tirant pendant que l'autre bondit" } else { "" };
        _note_once(b, mem, "bonds", &format!("la ligne de tirailleurs avance par bonds courts, d'un couvert à l'autre{moit}."), 7200.0);
    }
    let batteries: Vec<Canon> = if L.ati("n") >= 1 { _gun_zones(b, mem, 600.0, &Val::None) } else { vec![] };
    // (assaut général : on serre l'ennemi et on enlève ses canons, de flanc ; on brave la mitraille, mais pas sa gerbe
    // serrée à moins de 150 m d'une batterie en ordre, qui faucherait les files entières)
    let guns: Vec<Canon> = if mem.get("general_assault").truthy() {
        batteries.iter().map(|(gx, gy, _gr, gid)| (*gx, *gy, BT::GRAPE_CLOSE + 20.0, gid.clone())).collect()
    } else {
        batteries.clone()
    };
    if ph == "combat"
        && line.truthy()
        && now - mem.atf("t_phase") > 240.0
        && now - py::max_f(line.iter().map(|u| u.atf("fired_t"))).unwrap() > 240.0
        && !guns.iter().any(|(gx, gy, gr, _gid)| _d2(*gx, *gy, mem.atf("ax"), mem.atf("ay")) < sq(gr + 250.0))
    {
        halt *= 0.5; // personne ne tire : l'ennemi est hors de vue ou hors de portée, on serre
        if !mem.at("notes").get("serre").truthy() {
            mem.at("notes").set("serre", 1);
            _note(b, mem, "la ligne ne voit plus l'ennemi : elle serre au plus près.");
        }
    }
    if ["assaut", "combat", "poursuite"].contains(&ph.as_str()) {
        if let Some(f) = front {
            let gap = f - halt;
            if ph == "assaut" && gap < 40.0 {
                _set_phase(b, mem, "combat", &Val::from("la ligne est à portée : feu de bataillon."));
            }
            _advance(b, mem, L, &line, gap, &bound);
        } else if sit.get("e_routed").truthy() && !seen.truthy() {
            if ph != "poursuite" {
                _set_phase(b, mem, "poursuite", &Val::from("l'ennemi plie : poursuite."));
            }
            let ez = b.ai_zone(1 - side);
            let t = _rel((ez.atf(0) + ez.atf(2)) / 2.0, (ez.atf(1) + ez.atf(3)) / 2.0, ax, ay, fd).0;
            _advance(b, mem, L, &line, t, &Val::None);
        } else {
            let ez = b.ai_zone(1 - side);
            let mut tgt = pmin(250.0, _rel((ez.atf(0) + ez.atf(2)) / 2.0, (ez.atf(1) + ez.atf(3)) / 2.0, ax, ay, fd).0);
            let seen_once: Vec<Repere> = _body(b, mem, 7200.0)
                .into_iter()
                .filter(|t| {
                    let v = b.unit(&t.0);
                    !(v.is_some() && v.atb("light"))
                })
                .collect();
            if !seen_once.is_empty() && !seen.truthy() {
                // la ligne ennemie s'est dérobée à la vue (bois, crête) : on marche sur sa dernière position connue
                let m = py::min_f(seen_once.iter().map(|r| _rel(r.1, r.2, ax, ay, fd).0)).unwrap();
                tgt = pmax(pmax(tgt, m - halt), 120.0);
            }
            _advance(b, mem, L, &line, tgt, &Val::None);
        }
    }
    // ordres de la ligne
    for u in line.iter() {
        let uid = u.at("id");
        let (mut sx, mut sy) = _slot(mem, &uid);
        if mem.at("phase") == "combat" && L.ati("n") >= 1 {
            (sx, sy) = _fine_halt(b, side, mem, L, sx, sy, &body, halt);
        }
        if bound.truthy()
            && L.atb("halves")
            && mem.at("phase") == "assaut"
            && mem.get_or("half", 1).f() * mem.at("lat").get_or(&uid, 0.0).f() < 0.0
        {
            (sx, sy) = _at(sx, sy, fd, -bound.f() / 2.0, 0.0); // (la moitié qui tire reste un demi-bond en arrière)
        }
        let fdist = _foe_dist(&u, &body);
        if mem.at("phase") == "combat"
            && L.get_or("aveugle", 1).truthy()
            && L.ati("n") >= 1
            && now - mem.atf("t_phase") > 600.0
            && now - u.atf("fired_t") > 600.0
            && fdist < 600.0
            && u.atf("ammo") > 0.3 * u.atf("ammo0")
            && !dans(&u.at("state"), &["melee", "charge"])
        {
            // l'ennemi embusqué (bois, bâti, crête) ne se voit pas d'ici : le bataillon s'avance jusqu'à le voir
            let (px, py_) = _at(sx, sy, fd, pmin(200.0, pmax(0.0, fdist - 110.0)), 0.0);
            (sx, sy) = _clamp(px, py_, 30.0);
            _note_once(b, mem, "aveugle", "la ligne ne voit pas l'ennemi embusqué : ses bataillons s'avancent jusqu'à portée de vue.", 1800.0);
        }
        if !guns.is_empty() {
            (sx, sy) = _out_of_grape(&guns, sx, sy, fd);
        }
        let f = _march_form(b, mem, L, &u, sx, sy, fdist, false);
        want.set(&uid, list![sx, sy, fd, f, false]);
    }
    if !batteries.is_empty() && dans(&mem.at("phase"), &["assaut", "combat"]) && L.atb("storm") {
        _storm_guns(b, side, mem, us, foes, &batteries, busy);
    }
    if plan == "debordement" {
        _flank_group(b, side, mem, L, us, foes, sit, want, busy, &body);
    }
    if rupture && L.atb("masse_n") {
        _masse(b, side, mem, L, us, sit, want, busy, &front_v, halt);
    }
    _lights_att(b, side, mem, L, us, foes, sit, want, &body, &front_v, halt);
    if od.truthy() {
        _ruses(b, side, mem, L, us, sit, want, busy, &body, halt);
    }
}

/// Ordres du joueur à l'attaque (orders.py) : la feinte, la fausse retraite, presser l'assaut quand la réserve
/// ennemie se montre.
///
/// Python (ai.py, l. 2323-2360) : `def _ruses(b, side, mem, L, us, sit, want, busy, body, halt)`
/// `WING[-od['w']]` : clé entière. `b.trait(1 - side)` → `b.r#trait(1 - side)`.
pub fn _ruses(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, want: &Val, busy: &Val, body: &[Repere], halt: f64) {
    let od = mem.at("ord");
    let (now, fd, ph) = (b.clock, mem.atf("fd"), mem.ats("phase"));
    let fid = od.get("feint_id");
    let u = if fid.truthy() { b.unit(&fid) } else { Val::None };
    if u.is_some() && U::valid(&u) && !busy.has(u.at("id")) && mem.at("role").get(u.at("id")) == "ligne" {
        let mut t0 = mem.get("feint_t");
        if t0.is_none() && ["prepa", "assaut", "combat"].contains(&ph.as_str()) {
            t0 = Val::from(py::round(now));
            mem.set("feint_t", t0.clone());
            let txt = format!("feinte : {} attaque {} pour y attirer la réserve ennemie.", u.at("name"), WING().at(-od.at("w")));
            _note(b, mem, &txt);
            if b.r#trait(1 - side) == "eclaireur" {
                _note(b, mem, "le général ennemi, un éclaireur, n'est pas dupe de la feinte.");
            } else {
                shift_reserve(b, 1 - side, od.ati("w"), &Val::from("une attaque se dessine sur l'aile : la réserve s'y porte."));
            }
        }
        if t0.is_some() && now - t0.f() < 1800.0 {
            let (sx, sy) = _slot(mem, &u.at("id"));
            let fdist = _foe_dist(&u, body);
            let (px, py_) = _at(sx, sy, fd, pmax(0.0, pmin(500.0, fdist - 1.1 * halt)), 0.0);
            let (x, y) = _clamp(px, py_, 30.0);
            let f = _march_form(b, mem, L, &u, x, y, fdist, false);
            want.set(u.at("id"), list![x, y, fd, f, false]);
        }
    }
    if od.get("ruse") == "retraite" && ["prepa", "assaut"].contains(&ph.as_str()) {
        let t0 = mem.setdefault("fr_t", py::round(now)).f();
        if now - t0 < 1500.0 {
            for v in us.iter() {
                if v.atb("light") && U::valid(&v) && mem.at("role").get(v.at("id")) == "avant" && !busy.has(v.at("id")) {
                    let (sx, sy) = _slot(mem, &v.at("id"));
                    let (px, py_) = _at(sx, sy, fd, -150.0, 0.0);
                    let (x, y) = _clamp(px, py_, 30.0);
                    want.set(v.at("id"), list![x, y, fd, "tirailleurs", false]);
                }
            }
            _note_once(b, mem, "fretraite", "fausse retraite : les tirailleurs reculent pour attirer l'ennemi.", 7200.0);
        }
    }
    if od.get("vsRes") == "presser" && !mem.get("general_assault").truthy() && ["prepa", "assaut", "combat"].contains(&ph.as_str()) {
        let cols = sit.at("seen").iter().any(|e| {
            e.at("cls") == "inf"
                && U::valid(&e)
                && e.at("form") == "colonne"
                && _rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), fd).0 < 1100.0
        });
        if cols {
            mem.set("general_assault", py::round(now));
            mem.set("halt_k", py::round_n(mem.get_or("halt_k", 0.85).f() * 0.5, 2));
            if ph == "prepa" {
                _set_phase(b, mem, "assaut", &Val::None);
            }
            _note(b, mem, "la réserve ennemie se montre : on presse l'assaut avant qu'elle arrive.");
        }
    }
}

/// La réserve et la cavalerie du camp side se portent sur son aile s (feinte et faux déserteurs de l'ennemi).
///
/// Python (ai.py, l. 2363-2384) : `def shift_reserve(b, side, s, txt=None)`
/// Appelée aussi par bridge (set_orders) et orders. s : -1 ou 1 (`OR::wing_sign`) ; txt : texte ou None (défaut).
/// `for uid, role in list(mem['role'].items())`.
pub fn shift_reserve(b: &mut TacticalBattle, side: i64, s: i64, txt: &Val) {
    let mem = _mem(b, side);
    if !mem.get("role").truthy() {
        return;
    }
    let w2 = mem.get_or("width", 600).f() / 2.0;
    let mut n = 0i64;
    let sf = s as f64;
    for (uid, role) in mem.at("role").items() {
        if role == "res" {
            let lat = sf * (w2 * 0.7 + (60 * n) as f64);
            n += 1;
            mem.at("lat").set(&uid, py::round_n(lat, 1));
            if mem.get_or("post", Val::dict()).has(&uid) {
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -200.0, lat);
                mem.at("post").set(&uid, list![py::round_n(x, 1), py::round_n(y, 1), mem.at("fd")]);
            }
        } else if role == "cav" && mem.at("wing").get(&uid).is_some() {
            mem.at("wing").set(&uid, s);
            if mem.get_or("post", Val::dict()).has(&uid) {
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -70.0, sf * (w2 + 110.0));
                mem.at("post").set(&uid, list![py::round_n(x, 1), py::round_n(y, 1), mem.at("fd")]);
            }
        }
    }
    if txt.truthy() {
        _note(b, &mem, txt.s());
    }
}

/// Une batterie ennemie interdit l'approche (mitraille) et nos canons ne la font pas taire : un ou deux bataillons
/// frais l'enlèvent à la baïonnette (les canonniers tiennent mal au corps à corps). Pas si des cavaliers ennemis
/// rôdent autour.
///
/// Python (ai.py, l. 2387-2419) : `def _storm_guns(b, side, mem, us, foes, guns, busy)`
/// `cand.sort(key=(bool, d2))` : tri stable (false avant true).
pub fn _storm_guns(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, foes: &Val, guns: &[Canon], busy: &Val) {
    let now = b.clock;
    let vis = Val::dict();
    for e in foes.iter() {
        if e.at("cls") == "artillerie" && U::valid(&e) {
            vis.set(e.at("id"), e.clone());
        }
    }
    let storm = mem.setdefault("storm", Val::dict());
    let roles = mem.at("role");
    for (_gx, _gy, _gr, gid) in guns {
        let e = vis.get(gid);
        if e.is_none() || now - storm.get_or(gid, -1e9).f() < 240.0 {
            continue;
        }
        if _cav_near(b, mem, e.atf("x"), e.atf("y"), 500.0, 120.0) {
            continue;
        }
        let cand: Vec<Val> = us
            .iter()
            .filter(|u| {
                u.at("cls") == "inf"
                    && !u.atb("light")
                    && U::valid(u)
                    && !busy.has(u.at("id"))
                    && !dans(&u.at("state"), &["charge", "melee"])
                    && u.atf("busy") <= 0.0
                    && u.at("form") != "carre"
                    && u.atf("morale") > (BT::FORMED + 5) as f64
                    && u.atf("men") > 0.6 * u.atf("men0")
                    && dans(&roles.get(u.at("id")), &["ligne", "res"])
                    && d2u(u, &e) < sq(380.0)
            })
            .collect();
        // de face, une batterie en ordre reçoit la charge par deux décharges de mitraille à bout portant (très cher) :
        // on la prend de flanc ou de dos, de face seulement quand elle est déjà ébranlée ou réduite, ou en nombre
        let intact = e.at("form") == "batterie" && e.atf("morale") >= 50.0 && e.atf("men") > 0.6 * e.atf("men0");
        let cand = py::sorted_by_key(cand, |u| (_gun_front(&e, u) && intact, d2u(u, &e)));
        let ok: Vec<Val> = cand.into_iter().filter(|u| _charge_ok(b, side, u, &e)).collect();
        let got: Vec<Val> = ok.into_iter().take(2).collect();
        let men = py::sum(got.iter().map(|u| u.atf("men")));
        if got.is_empty() || men < 1.5 * e.atf("men") {
            continue;
        }
        if intact && got.iter().all(|u| _gun_front(&e, u)) && men < 4.0 * e.atf("men") {
            continue;
        }
        for u in &got {
            b.order(side, &ids(u), "charge", "ia", &dict! {"target" => e.at("id")});
            busy.push(u.at("id"));
        }
        storm.set(gid, py::round(now));
        let noms: Vec<String> = got.iter().map(|u| u.ats("name")).collect();
        let txt = format!(
            "la batterie ennemie ({}) interdit l'approche : {} l'enlève{} à la baïonnette.",
            _foe(&e),
            noms.join(" et "),
            if got.len() > 1 { "nt" } else { "" }
        );
        _note(b, mem, &txt);
    }
}

/// u aborderait-il cette batterie de face (dans son champ de tir) ?
///
/// Python (ai.py, l. 2422-2424) : `def _gun_front(e, u)`
pub fn _gun_front(e: &Val, u: &Val) -> bool {
    _ang(e.atf("dir"), (u.atf("y") - e.atf("y")).atan2(u.atf("x") - e.atf("x"))) < 1.2
}

/// Batteries ennemies connues (vues depuis moins de 10 min, ni en déroute ni hors de combat) : [(x, y, rayon de
/// mitraille meurtrière (60 % de la portée de mitraille) + 40 m, id)].
///
/// Python (ai.py, l. 2427-2435) : `def _gun_zones(b, mem, maxage=600.0, k=None)`
/// Défauts : maxage = 600.0, k = None (`k or GRAPE_DEADLY`). `v[9] if len(v) > 9 and v[9] else 280`.
pub fn _gun_zones(b: &TacticalBattle, mem: &Val, maxage: f64, k: &Val) -> Vec<Canon> {
    let now = b.clock;
    let mut out = vec![];
    for (key, v) in mem.at("vu").items() {
        if v.at(4) == "artillerie" && now - v.atf(2) <= maxage && !dans(&v.at(6), &["deroute", "hors"]) && v.atf(3) > 25.0 {
            let kk = if k.truthy() { k.f() } else { GRAPE_DEADLY };
            let g = if v.len() > 9 && v.at(9).truthy() { v.atf(9) } else { 280.0 };
            out.push((v.atf(0), v.atf(1), kk * g + 40.0, key));
        }
    }
    out
}

/// Recule un poste hors de portée de mitraille des batteries ennemies connues (au plus de 300 m).
///
/// Python (ai.py, l. 2438-2449) : `def _out_of_grape(guns, x, y, fd)`
pub fn _out_of_grape(guns: &[Canon], x: f64, y: f64, fd: f64) -> (f64, f64) {
    let (mut x, mut y) = (x, y);
    for _ in 0..8 {
        let hit = guns.iter().any(|(gx, gy, gr, _gid)| _d2(*gx, *gy, x, y) < gr * gr);
        if !hit {
            break;
        }
        let (px, py_) = _at(x, y, fd, -40.0, 0.0);
        (x, y) = _clamp(px, py_, 30.0);
    }
    (x, y)
}

/// L'ancre de la ligne repasse au centre des bataillons (passage des postes fixes à la ligne mobile).
///
/// Python (ai.py, l. 2452-2461) : `def _recenter(mem, line)`
pub fn _recenter(mem: &Val, line: &Val) {
    if !line.truthy() {
        return;
    }
    let n = line.len() as f64;
    let ax = py::sum(line.iter().map(|u| u.atf("x"))) / n;
    let ay = py::sum(line.iter().map(|u| u.atf("y"))) / n;
    mem.set("ax", py::round_n(ax, 1));
    mem.set("ay", py::round_n(ay, 1));
    for u in line.iter() {
        mem.at("lat").set(u.at("id"), py::round_n(_rel(u.atf("x"), u.atf("y"), ax, ay, mem.atf("fd")).1, 1));
        mem.at("back").set(u.at("id"), 0.0);
    }
}

/// Python (ai.py, l. 2464-2468) : `def _slot(mem, uid)`
pub fn _slot(mem: &Val, uid: &Val) -> (f64, f64) {
    if mem.get("mode") == "poste" && mem.at("post").has(uid) {
        let p = mem.at("post").at(uid);
        return (p.atf(0), p.atf(1));
    }
    let (x, y) = _at(
        mem.atf("ax"),
        mem.atf("ay"),
        mem.atf("fd"),
        -mem.at("back").get_or(uid, 0.0).f(),
        mem.at("lat").get_or(uid, 0.0).f(),
    );
    _clamp(x, y, 30.0)
}

/// La ligne avance d'un bond vers target (profondeur par rapport à l'ancre), en attendant ses retardataires
/// (bound : bond plus court, en 1870 ; par moitiés en difficile).
///
/// Python (ai.py, l. 2471-2491) : `def _advance(b, mem, L, line, target, bound=None)`
/// target : jamais None chez les appelants (le test `target is None` tombe) ; bound : un nombre ou None (défaut ;
/// `bound or L['bound']`).
pub fn _advance(b: &mut TacticalBattle, mem: &Val, L: &Val, line: &Val, target: f64, bound: &Val) {
    if target.abs() < 25.0 {
        return;
    }
    let now = b.clock;
    if target > 0.0 && L.atb("cohesion") {
        let mut lag = 0.0;
        for u in line.iter() {
            if dans(&u.at("state"), &["melee", "charge", "deroute"]) || u.at("form") == "carre" {
                continue;
            }
            let (sx, sy) = _slot(mem, &u.at("id"));
            lag = pmax(lag, py::hypot(sx - u.atf("x"), sy - u.atf("y")));
        }
        if lag > 55.0 && now - mem.get_or("t_bound", 0).f() < (if L.ati("n") == 2 { 100.0 } else { 75.0 }) {
            return;
        }
    }
    let step = pmax(-150.0, pmin(target, bound.or(L.at("bound")).f()));
    if bound.truthy() && target > 0.0 && L.atb("halves") {
        mem.set("half", -mem.get_or("half", 1));
    }
    let (px, py_) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), step, 0.0);
    let (x, y) = _clamp(px, py_, 60.0);
    mem.set("ax", py::round_n(x, 1));
    mem.set("ay", py::round_n(y, 1));
    mem.set("t_bound", py::round(now));
}

/// Chaque bataillon règle sa distance sur l'ennemi qui lui fait face (sans s'écarter de plus de 70 m) et y cherche
/// un couvert (haie, muret, vigne) à bonne portée ; au-delà de l'aile ennemie, il s'avance à sa hauteur pour la
/// prendre de flanc.
///
/// Python (ai.py, l. 2494-2530) : `def _fine_halt(b, side, mem, L, sx, sy, body, halt)`
pub fn _fine_halt(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, sx: f64, sy: f64, body: &[Repere], halt: f64) -> (f64, f64) {
    let fd = mem.atf("fd");
    let (mut best, mut aside): (Option<f64>, Option<f64>) = (None, None);
    for (_k, x, y, _cls, _form) in body {
        let (d, l) = _rel(*x, *y, sx, sy, fd);
        if d < -60.0 {
            continue;
        }
        if l.abs() < 140.0 {
            if best.is_none() || d < best.unwrap() {
                best = Some(d);
            }
        } else if l.abs() < 330.0 && (aside.is_none() || d < aside.unwrap()) {
            aside = Some(d);
        }
    }
    let Some(best) = best else {
        match aside {
            Some(a) if L.ati("n") != 0 => {
                let (x, y) = _at(sx, sy, fd, pmax(-70.0, pmin(120.0, a - 10.0)), 0.0);
                return _clamp(x, y, 30.0);
            }
            _ => return (sx, sy),
        }
    };
    let adj = pmax(-70.0, pmin(70.0, best - halt));
    let (mut x, mut y) = _at(sx, sy, fd, adj, 0.0);
    if L.at("terrain").truthy() {
        let e = halt / pmax(0.3, mem.get_or("halt_k", 0.85).f());
        let (mut bx, mut by, mut bv) = (x, y, b.cover_at(x, y) + 0.01);
        for dd in [-40.0, -20.0, 20.0] {
            let a2 = adj + dd;
            if !(0.6 * halt <= best - a2 && best - a2 <= 1.1 * e) || a2.abs() > 90.0 {
                continue;
            }
            let (px, py_) = _at(sx, sy, fd, a2, 0.0);
            if !b.passable(px, py_, "inf", side) {
                continue;
            }
            let (qx, qy) = _at(px, py_, fd, 20.0, 0.0);
            let v = pmax(b.cover_at(px, py_), 0.8 * b.cover_at(qx, qy));
            if v > bv + 0.05 {
                (bx, by, bv) = (px, py_, v);
            }
        }
        (x, y) = (bx, by);
    }
    _clamp(x, y, 30.0)
}

/// Python (ai.py, l. 2533-2539) : `def _foe_dist(u, body)`
/// `(x - u.x) ** 2` → `py::pow(…, 2.0)` ; 1e9 → √ : 31 622.78 m sans ennemi.
pub fn _foe_dist(u: &Val, body: &[Repere]) -> f64 {
    let mut best = 1e9;
    for (_k, x, y, _cls, _form) in body {
        let d = sq(x - u.atf("x")) + sq(y - u.atf("y"));
        if d < best {
            best = d;
        }
    }
    best.sqrt()
}

/// Formation de l'infanterie : colonne pour marcher loin du feu ; à portée de l'ennemi ou sous le feu, l'ordre
/// dispersé (tirailleurs : pertes ×0,35 au boulet, ×0,55 à la mitraille, ×0,8 à la fusillade, pour 40 % de feu en
/// moins) tant qu'aucun cavalier ennemi n'a été vu depuis 10 min (normal : à moins de 1 500 m ; difficile :
/// 1 200 m), sinon la ligne. L'assaillant n'y met sa ligne qu'au temps du fusil rayé (avant, colonne puis ligne).
/// Facile : la ligne, et la colonne gardée trop longtemps.
///
/// Python (ai.py, l. 2542-2571) : `def _march_form(b, mem, L, u, sx, sy, fdist, defending=False)`
/// defending : défaut false. Rend 'tirailleurs', 'ligne', 'colonne' ou None. `sum(map(ord, u.id)) % 2` : points de
/// code des caractères.
pub fn _march_form(b: &TacticalBattle, mem: &Val, L: &Val, u: &Val, sx: f64, sy: f64, fdist: f64, defending: bool) -> Val {
    if u.atb("light") {
        return Val::from("tirailleurs");
    }
    // la ligne qui défend : jamais en tirailleurs dans la guerre en dentelles ; sous l'Empire, en ligne quand l'assaut
    // est à 300 m (des salves, et de quoi contre-charger : en tirailleurs, on ne le peut)
    let era = mem.get_or("era", 1);
    let mut closed = defending && (era == 0i64 || (era == 1i64 && fdist < 300.0));
    if !defending && era < 2i64 {
        closed = true; // (l'ordre dispersé de la ligne attend le fusil rayé : avant, colonnes et lignes ; les légers)
    }
    let near = fdist < (if L.atb("col_late") { 380.0 } else { 720.0 });
    let hit = b.clock - u.atf("hit_t") < 40.0 && !L.atb("col_late");
    let oi = mem.get("ord").or(Val::dict()).get("inf"); // ordres : la marche de l'infanterie
    if oi == "dispersé" && (near || hit) && !_cav_near(b, mem, u.atf("x"), u.atf("y"), 900.0, 600.0) {
        return Val::from("tirailleurs");
    }
    if oi == "ligne" && !defending && fdist < 1500.0 {
        return Val::from("ligne");
    }
    if oi == "mixte" && !defending && fdist < 1100.0 {
        let s: u64 = u.ats("id").chars().map(|c| c as u64).sum();
        return Val::from(if s % 2 != 0 { "ligne" } else { "colonne" });
    }
    if near || hit {
        let r = if L.ati("n") == 1 { 1500.0 } else { 1200.0 };
        if L.ati("skirm") >= (if defending { 2 } else { 1 }) && !closed && !_cav_near(b, mem, u.atf("x"), u.atf("y"), r, 600.0) {
            return Val::from("tirailleurs");
        }
        return Val::from("ligne");
    }
    if py::hypot(sx - u.atf("x"), sy - u.atf("y")) > 320.0 {
        return Val::from("colonne");
    }
    Val::None
}

/// Réserves : combler les trous, relever les épuisés, couvrir un flanc, s'engager trop tôt (facile).
///
/// Python (ai.py, l. 2574-2751) : `def _roles_update(b, side, mem, L, us, sit, front)`
/// front : profondeur (nombre) ou None (places). `thr`, `guards`, `gt`, `refuse` : clés '1' / '-1' (str(s)) dans la
/// mémoire, `thr` local à clés entières. `for s in list(guards)` / `refuse` : ordre d'insertion.
pub fn _roles_update(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, front: &Val) {
    let roles = mem.at("role");
    let now = b.clock;
    for u in us.iter() {
        let uid = u.at("id");
        if u.at("state") == "deroute"
            && dans(
                &roles.get(&uid),
                &["ligne", "res", "avant", "garde_flanc", "soutien", "breche", "mur", "rue", "coeur", "assaut", "vague2", "diversion", "masse", "coupure", "ilot"],
            )
        {
            mem.setdefault("was", Val::dict()).set(&uid, roles.at(&uid));
            roles.set(&uid, "rallie");
        } else if roles.get(&uid) == "rallie"
            && u.at("state") == "repos"
            && u.atf("morale") > 55.0
            && u.atf("ammo") >= 0.3 * u.atf("ammo0")
            && u.at("cls") == "inf"
        {
            roles.set(&uid, "res"); // (assaut d'une place : elle repartira avec la prochaine vague)
            mem.at("back").set(&uid, 220.0);
        }
    }
    if dans(&mem.at("plan"), &["place", "assaut"]) {
        return;
    }
    let front = opt(front);
    let seen = sit.at("seen");
    let mut res: Vec<Val> = us
        .iter()
        .filter(|u| roles.get(u.at("id")) == "res" && U::valid(u) && !dans(&u.at("state"), &["melee", "charge"]))
        .collect();
    let line: Vec<Val> = us.iter().filter(|u| roles.get(u.at("id")) == "ligne" && U::valid(u)).collect();
    let _ = line;
    let contact = front.is_some_and(|f| f < 700.0);
    // facile : la réserve s'engage dès le contact
    if L.atb("res_early") && contact && !res.is_empty() {
        let w = mem.get_or("width", 600).f() / 2.0;
        for (k, u) in res.iter().enumerate() {
            let uid = u.at("id");
            roles.set(&uid, "ligne");
            let side_ = if k % 2 == 0 { 1.0 } else { -1.0 };
            mem.at("lat").set(&uid, py::round_n(side_ * (w + 80.0 + (140 * (k / 2)) as f64), 1));
            mem.at("back").set(&uid, 0.0);
            if mem.get("mode") == "poste" {
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), 0.0, mem.at("lat").atf(&uid));
                mem.at("post").set(&uid, list![py::round_n(x, 1), py::round_n(y, 1), mem.at("fd")]);
            }
        }
        _note(b, mem, "la réserve est engagée d'emblée dans la ligne.");
        return;
    }
    // ligne débordée : la réserve prolonge l'aile (on garde un bataillon pour les trous et les relèves)
    if L.atb("extend") && !res.is_empty() && res.len() >= 2 && front.is_some_and(|f| f < 450.0) {
        let mut w = mem.get_or("width", 600).f() / 2.0;
        let mut lats = vec![];
        for (_k, x, y, _cls, _form) in _body(b, mem, 150.0) {
            let (d, l) = _rel(x, y, mem.atf("ax"), mem.atf("ay"), mem.atf("fd"));
            if d < 600.0 {
                lats.push(l);
            }
        }
        for s in [1i64, -1] {
            let sf = s as f64;
            if lats.is_empty() || py::max_f(lats.iter().map(|l| l * sf)).unwrap() < w + 60.0 || res.len() < 2 {
                continue;
            }
            let lat = sf * (w + 75.0);
            let (tx, ty) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), 0.0, lat);
            let u = plus_proche(&res, tx, ty);
            ote(&mut res, &u);
            let uid = u.at("id");
            roles.set(&uid, "ligne");
            mem.at("lat").set(&uid, py::round_n(lat, 1));
            mem.at("back").set(&uid, 0.0);
            mem.setdefault("lat0", list![]).push(py::round_n(lat, 1));
            if mem.get("mode") == "poste" {
                let (px, py_) = if L.at("terrain").truthy() { _best_depth(b, side, tx, ty, mem.atf("fd"), 40.0) } else { (tx, ty) };
                mem.at("post").set(&uid, list![py::round_n(px, 1), py::round_n(py_, 1), mem.at("fd")]);
            }
            mem.set("width", py::round(2.0 * w + 150.0));
            w = mem.atf("width") / 2.0;
            let txt = format!("l'ennemi déborde {} : {} quitte la réserve et prolonge la ligne.", WING().at(s), u.at("name"));
            _note(b, mem, &txt);
        }
    }
    // percée : des ennemis derrière notre ligne ; la réserve les contre-attaque
    if L.get_or("breach_ca", L.at("extend")).truthy()
        && !res.is_empty()
        && seen.truthy()
        && dans(&mem.at("plan"), &["tenir", "harcelement"])
    {
        let inside: Vec<Val> = seen
            .iter()
            .filter(|e| {
                dans(&e.at("cls"), &["inf", "cavalerie"])
                    && _rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd")).0 < -40.0
                    && _rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd")).1.abs()
                        < mem.get_or("width", 600).f() / 2.0 + 150.0
            })
            .collect();
        for e in &inside {
            if res.is_empty() {
                break;
            }
            let u = plus_proche(&res, e.atf("x"), e.atf("y"));
            if d2u(&u, e) > sq(600.0) {
                continue;
            }
            ote(&mut res, &u);
            if e.at("cls") == "inf" && _melee_power(b, &u) > 1.1 * _melee_power(b, e) && _charge_ok(b, side, &u, e) {
                b.order(side, &ids(&u), "charge", "ia", &dict! {"target" => e.at("id")});
            } else {
                b.order(side, &ids(&u), "attack", "ia", &dict! {"target" => e.at("id")});
            }
            let txt = format!("l'ennemi a percé ({}) : {} contre-attaque.", _foe(e), u.at("name"));
            _note_once(b, mem, &format!("perce{}", e.at("id")), &txt, 600.0);
        }
    }
    // canons menacés de près, sans infanterie auprès : un bataillon de réserve vient les couvrir
    if L.ati("n") >= 1 && !res.is_empty() && seen.truthy() {
        for g in us.iter() {
            if g.at("cls") != "artillerie" || !U::valid(&g) || roles.get(g.at("id")) != "art" {
                continue;
            }
            let near_foe = seen.iter().any(|e| dans(&e.at("cls"), &["inf", "cavalerie"]) && d2u(&e, &g) < sq(300.0));
            let cover = us.iter().any(|o| o.at("cls") == "inf" && U::valid(&o) && !o.is(&g) && d2u(&o, &g) < sq(150.0));
            if near_foe && !cover {
                let u = plus_proche(&res, g.atf("x"), g.atf("y"));
                if d2u(&u, &g) > sq(700.0) {
                    continue;
                }
                ote(&mut res, &u);
                roles.set(u.at("id"), "soutien");
                mem.setdefault("escort", Val::dict()).set(u.at("id"), g.at("id"));
                let txt = format!("la batterie {} est menacée : {} vient la couvrir.", g.at("name"), u.at("name"));
                _note(b, mem, &txt);
                if res.is_empty() {
                    break;
                }
            }
        }
    }
    // trous dans la ligne
    let lat0 = mem.get("lat0").or(list![]);
    let line: Vec<Val> = us.iter().filter(|u| roles.get(u.at("id")) == "ligne" && U::valid(u)).collect(); // (avec les bataillons qui viennent d'allonger la ligne)
    let mut held: Vec<f64> = line.iter().map(|u| mem.at("lat").get_or(u.at("id"), 0.0).f()).collect();
    for lat in lat0.iter() {
        let lf = lat.f();
        if held.iter().any(|h| (lf - h).abs() < 60.0) {
            continue;
        }
        if res.is_empty() || !contact || L.ati("n") == 0 {
            break;
        }
        let (tx, ty) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), 0.0, lf);
        let u = plus_proche(&res, tx, ty);
        if u.atf("morale") < 50.0 {
            continue;
        }
        ote(&mut res, &u);
        let uid = u.at("id");
        roles.set(&uid, "ligne");
        mem.at("lat").set(&uid, lat.clone());
        mem.at("back").set(&uid, 0.0);
        if mem.get("mode") == "poste" {
            mem.at("post").set(&uid, list![py::round_n(tx, 1), py::round_n(ty, 1), mem.at("fd")]);
        }
        held.push(lf);
        let txt = format!("un trou s'ouvre dans la ligne : {} monte de la réserve pour le combler.", u.at("name"));
        _note(b, mem, &txt);
    }
    // relèves : munitions, moral, fatigue
    if L.atb("relief") && !res.is_empty() && contact {
        let tri = py::sorted_by_key(line.clone(), |v| v.atf("ammo") / pmax(1.0, v.atf("ammo0")));
        for v in tri {
            let tired = v.atf("ammo") < 0.2 * v.atf("ammo0") || v.atf("morale") < 40.0 || v.atf("fat") > 85.0;
            if !tired || dans(&v.at("state"), &["melee", "charge"]) {
                continue;
            }
            let ok: Vec<Val> = res
                .iter()
                .filter(|r| r.atf("ammo") > 0.6 * r.atf("ammo0") && r.atf("morale") > 60.0 && r.atf("fat") < 60.0)
                .cloned()
                .collect();
            if ok.is_empty() {
                break;
            }
            let r = plus_proche(&ok, v.atf("x"), v.atf("y"));
            ote(&mut res, &r);
            let (rid, vid) = (r.at("id"), v.at("id"));
            roles.set(&rid, "ligne");
            roles.set(&vid, "res");
            let (l, bk) = (mem.at("lat").get_or(&vid, 0.0), mem.at("back").get_or(&vid, 0.0));
            mem.at("lat").set(&rid, l);
            mem.at("back").set(&rid, bk);
            mem.at("back").set(&vid, 230.0);
            if mem.at("post").has(&vid) {
                mem.at("post").set(&rid, mem.at("post").at(&vid).to_list());
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -230.0, mem.at("lat").atf(&rid));
                mem.at("post").set(&vid, list![py::round_n(x, 1), py::round_n(y, 1), mem.at("fd")]);
            }
            let why = if v.atf("ammo") < 0.2 * v.atf("ammo0") {
                "sans cartouches"
            } else if v.atf("fat") > 85.0 {
                "épuisé"
            } else {
                "ébranlé"
            };
            let txt = format!("{} relève {} ({why}), qui passe en réserve près du chariot.", r.at("name"), v.at("name"));
            _note(b, mem, &txt);
            if res.is_empty() {
                break;
            }
        }
    }
    // flancs : un ennemi déborde l'aile ; la réserve (ou un bataillon d'aile) fait face
    if L.atb("flank") && seen.truthy() {
        let w = mem.get_or("width", 600).f() / 2.0;
        let mut thr: Vec<(i64, f64)> = vec![];
        for e in seen.iter() {
            if !dans(&e.at("cls"), &["inf", "cavalerie"]) {
                continue;
            }
            let (d, l) = _rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd"));
            if l.abs() > w + 120.0 && -400.0 < d && d < 200.0 {
                let s = if l > 0.0 { 1 } else { -1 };
                match thr.iter_mut().find(|t| t.0 == s) {
                    Some(t) => t.1 += e.atf("men"),
                    None => thr.push((s, 0.0 + e.atf("men"))),
                }
            }
        }
        let guards = mem.setdefault("guard", Val::dict());
        let gt = mem.setdefault("guard_t", Val::dict());
        for (s, men) in &thr {
            if *men >= 150.0 {
                gt.set(s.to_string(), py::round(now));
            }
        }
        for s in guards.keys() {
            if now - gt.get_or(&s, 0).f() > 300.0 {
                // la menace a disparu : la garde de flanc retourne en réserve
                let uid = guards.pop(&s);
                if roles.get(&uid) == "garde_flanc" {
                    roles.set(&uid, "res");
                    mem.at("back").set(&uid, 220.0);
                    mem.at("lat").set(&uid, 0.0);
                }
            }
        }
        let refuse = mem.setdefault("refuse", Val::dict());
        let vieux: Vec<Val> = refuse.keys().into_iter().filter(|s| now - gt.get_or(s, 0).f() > 300.0).collect();
        for s in vieux {
            refuse.del(&s); // (le bataillon et la cavalerie de l'aile reprennent leur place)
        }
        for (s, men) in &thr {
            let ks = s.to_string();
            if *men < 150.0 || (guards.has(ks.as_str()) && us.iter().any(|g| g.at("id") == guards.at(ks.as_str()) && U::valid(&g))) {
                continue;
            }
            let sf = *s as f64;
            if res.is_empty() {
                // plus de réserve : le bataillon du bout de l'aile refuse le flanc, la cavalerie de l'aile le couvre
                if mem.get("mode") == "poste" && !refuse.has(ks.as_str()) && !line.is_empty() {
                    let u = py::max_by_key(line.iter().cloned(), |v| sf * mem.at("lat").get_or(v.at("id"), 0.0).f()).unwrap();
                    refuse.set(ks.as_str(), u.at("id"));
                    let txt = format!("{} est débordée : {} refuse le flanc, la cavalerie le couvre.", WING().at(*s), u.at("name"));
                    _note(b, mem, &txt);
                }
                continue;
            }
            let (tx, ty) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -60.0, sf * (w + 70.0));
            let u = plus_proche(&res, tx, ty);
            ote(&mut res, &u);
            let uid = u.at("id");
            roles.set(&uid, "garde_flanc");
            mem.at("lat").set(&uid, py::round_n(sf * (w + 70.0), 1));
            mem.at("back").set(&uid, 60.0);
            guards.set(ks.as_str(), uid.clone());
            let txt = format!("{} est menacée : {} se porte sur le flanc.", WING().at(*s), u.at("name"));
            _note(b, mem, &txt);
        }
    }
}

/// Réoccupation : l'ennemi tient l'un des postes de notre ligne sur un point d'appui (haie, muret, maisons,
/// couvert), et aucun des nôtres n'y est plus ; la réserve la plus proche va le reprendre, à la baïonnette si elle est
/// assez forte (Aspern-Essling, Lützen : villages pris et repris).
/// Chaque poste attend 5 min entre deux tentatives.
///
/// Python (ai.py, l. 2754-2794) : `def _retake(b, side, mem, us, sit, busy)`
pub fn _retake(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, sit: &Val, busy: &Val) {
    let now = b.clock;
    let rt = mem.setdefault("retake_t", Val::dict());
    let roles = mem.at("role");
    let was = mem.get("was").or(Val::dict());
    let posts: Vec<(Val, Val)> =
        mem.at("post").items().into_iter().filter(|(k, _p)| roles.get(k) == "ligne" || was.get(k) == "ligne").collect();
    let ours: Vec<Val> = us.iter().filter(|o| U::valid(o) && dans(&o.at("cls"), &["inf", "cavalerie"])).collect();
    let mut res: Vec<Val> = us
        .iter()
        .filter(|u| {
            roles.get(u.at("id")) == "res"
                && u.at("cls") == "inf"
                && U::valid(u)
                && !busy.has(u.at("id"))
                && !dans(&u.at("state"), &["melee", "charge"])
        })
        .collect();
    for (k, p) in posts {
        if res.is_empty() || now - rt.get_or(&k, -1e9).f() < 300.0 {
            continue;
        }
        let (x, y) = (p.atf(0), p.atf(1));
        let strong = b.cover_at(x, y) >= 0.3 || b.feature_at(x, y) >= 2 || b.terrain_at(x, y) == T_BATI;
        if !strong || ours.iter().any(|o| _d2(o.atf("x"), o.atf("y"), x, y) < sq(80.0)) {
            continue;
        }
        let es: Vec<Val> = sit
            .at("seen")
            .iter()
            .filter(|e| e.at("cls") == "inf" && U::valid(e) && _d2(e.atf("x"), e.atf("y"), x, y) < sq(60.0))
            .collect();
        if es.is_empty() {
            continue;
        }
        let e = es[0].clone();
        let ok: Vec<Val> = res
            .iter()
            .filter(|u| {
                u.atf("morale") > 60.0
                    && _d2(u.atf("x"), u.atf("y"), x, y) < sq(500.0)
                    && _melee_power(b, u) >= 1.1 * _melee_power(b, &e)
            })
            .cloned()
            .collect();
        if ok.is_empty() {
            continue;
        }
        let u = plus_proche(&ok, x, y);
        ote(&mut res, &u);
        busy.push(u.at("id"));
        rt.set(&k, py::round(now));
        if d2u(&u, &e) < sq(150.0) && _charge_ok(b, side, &u, &e) {
            b.order(side, &ids(&u), "charge", "ia", &dict! {"target" => e.at("id")});
        } else {
            b.order(side, &ids(&u), "attack", "ia", &dict! {"target" => e.at("id")});
            mem.setdefault("eng", Val::dict()).set(u.at("id"), py::round(now + 150.0));
        }
        _stat(mem, "retake", 1);
        let t = b.terrain_at(x, y);
        let what = if t == T_BATI {
            "maisons"
        } else if WOODS.contains(&t) {
            "bois"
        } else if b.feature_at(x, y) == 2 {
            "haie"
        } else if b.feature_at(x, y) == 3 {
            "muret"
        } else {
            "couvert"
        };
        let txt = format!("l'ennemi tient notre poste de {what} : {} contre-attaque pour le reprendre.", u.at("name"));
        _note(b, mem, &txt);
    }
}
