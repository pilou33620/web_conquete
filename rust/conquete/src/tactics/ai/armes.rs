//! Porte game/tactics/ai.py, lignes 3775 à 4722 : soutiens : général, chariot, ralliés ; cavalerie ; baïonnette ;
//! artillerie ; exécution.
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
/// `sum(1 for c in u.id if c.isdigit()) % 3 - 1` (des ids ASCII).
fn chiffres(u: &Val) -> i64 {
    py::mod_i(u.ats("id").chars().filter(|c| c.is_ascii_digit()).count() as i64, 3) - 1
}
/// `(o.get('kind'), o.get('x'), o.get('y')) != ('bombard', x, y)`.
fn autre_bombard(o: &Val, x: &Val, y: &Val) -> bool {
    !(o.get("kind") == "bombard" && o.get("x") == *x && o.get("y") == *y)
}

// ---------------------------------------------------------------------- soutiens : général, chariot, ralliés

/// Python (ai.py, l. 3776-3882) : `def _support(b, side, mem, L, us, foes, sit, want)`
/// `wagons` : dict local (le chariot ou None). `sum(1 for c in u.id if c.isdigit()) % 3 - 1`. `b.unit(…)` peut rendre
/// None (`mem.get('escort', {}).get(u.id)` : None).
pub fn _support(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val) {
    let roles = mem.at("role");
    let fd = mem.atf("fd");
    let plan = mem.ats("plan");
    let seen = sit.at("seen");
    let line: Vec<Val> = us.iter().filter(|u| dans(&roles.get(u.at("id")), &["ligne", "breche", "assaut"]) && U::valid(u)).collect();
    let (cx, cy) = if !line.is_empty() {
        let n = line.len() as f64;
        (py::sum(line.iter().map(|u| u.atf("x"))) / n, py::sum(line.iter().map(|u| u.atf("y"))) / n)
    } else {
        (mem.atf("ax"), mem.atf("ay"))
    };
    let mut gen_pos: Option<(f64, f64)> = None;
    let wagon_w = us.iter().find(|w| w.at("cls") == "chariot" && U::alive(w) && roles.get(w.at("id")) == "wagon");
    for u in us.iter() {
        let uid = u.at("id");
        if roles.get(&uid) != "gen" {
            continue;
        }
        let (mut gx, mut gy);
        if plan == "place" {
            let p = mem.at("post").get(&uid);
            (gx, gy) = if p.truthy() { (p.atf(0), p.atf(1)) } else { (cx, cy) };
        } else {
            let mut lat = 0.0;
            if L.atb("gen_move") && !line.is_empty() {
                // vers le secteur le plus éprouvé
                let wts: Vec<(f64, f64)> =
                    line.iter().map(|v| (pmax(0.0, 70.0 - v.atf("morale")), _rel(v.atf("x"), v.atf("y"), cx, cy, fd).1)).collect();
                let tw = py::sum(wts.iter().map(|(w, _)| *w));
                if tw > 0.0 {
                    lat = pmax(-300.0, pmin(300.0, py::sum(wts.iter().map(|(w, l)| w * l)) / tw));
                }
            }
            let mut back = if plan != "assaut" { 170.0 } else { 200.0 };
            if mem.at("phase") == "assaut" && plan == "assaut" {
                back = 120.0;
            }
            (gx, gy) = _at(cx, cy, fd, -back, lat);
            if !L.atb("gen_move") {
                let p = mem.at("post").get(&uid);
                if p.truthy() && _d2(p.atf(0), p.atf(1), gx, gy) < sq(450.0) {
                    (gx, gy) = (p.atf(0), p.atf(1));
                } else {
                    mem.at("post").set(&uid, list![py::round_n(gx, 1), py::round_n(gy, 1), fd]);
                }
            }
        }
        let mut run = false;
        if L.atb("gen_move") {
            // des fuyards : le général va les chercher (le moteur ne les rallie qu'auprès de lui)
            let f = _fetch(b, side, mem, L, &u, us, &seen, gx, gy);
            if f.is_some() {
                (gx, gy, run) = (f.atf(0), f.atf(1), f.atb(2));
            }
        }
        // jamais à portée de fusil
        for e in seen.iter() {
            if _d2(e.atf("x"), e.atf("y"), gx, gy) < sq(230.0) && e.at("cls") != "artillerie" {
                let a = (gy - e.atf("y")).atan2(gx - e.atf("x"));
                (gx, gy) = (e.atf("x") + a.cos() * 260.0, e.atf("y") + a.sin() * 260.0);
            }
        }
        if L.ati("n") >= 1 {
            (gx, gy) = _shelter(b, mem, us, &u, gx, gy, fd);
        }
        gen_pos = Some((gx, gy));
        want.set(&uid, list![gx, gy, fd, Val::None, run]);
    }
    for u in us.iter() {
        let uid = u.at("id");
        let r = roles.get(&uid);
        if r == "wagon" {
            if plan == "place" {
                let p = mem.at("post").get(&uid);
                if p.truthy() {
                    want.set(&uid, list![p.at(0), p.at(1), p.at(2), Val::None, false]);
                }
                continue;
            }
            let mut lat = 0.0;
            if L.ati("n") >= 1 && !line.is_empty() {
                let low = py::min_by_key(line.iter().cloned(), |v| v.atf("ammo") / pmax(1.0, v.atf("ammo0"))).unwrap();
                if low.atf("ammo") < 0.5 * low.atf("ammo0") {
                    lat = _rel(low.atf("x"), low.atf("y"), cx, cy, fd).1;
                }
            }
            let mut back = if dans(&mem.at("phase"), &["combat", "attente"]) { 130.0 } else { 230.0 };
            if L.ati("n") == 0 {
                back = 260.0;
            }
            let (mut wx, mut wy) = _at(cx, cy, fd, -back, lat);
            for e in seen.iter() {
                if _d2(e.atf("x"), e.atf("y"), wx, wy) < sq(200.0) {
                    let a = (wy - e.atf("y")).atan2(wx - e.atf("x"));
                    (wx, wy) = (e.atf("x") + a.cos() * 320.0, e.atf("y") + a.sin() * 320.0);
                }
            }
            if L.ati("n") >= 1 {
                (wx, wy) = _shelter(b, mem, us, &u, wx, wy, fd);
            }
            want.set(&uid, list![wx, wy, fd, Val::None, false]);
        } else if r == "rallie" && U::valid(&u) && u.at("state") == "repos" {
            // ralliés : se refaire près du général, à l'abri
            let (gx, gy) = gen_pos.unwrap_or_else(|| _at(cx, cy, fd, -220.0, 0.0));
            if L.ati("n") == 0 {
                continue;
            }
            let k = chiffres(&u);
            let (x, y) = _at(gx, gy, fd, -50.0, (70 * k) as f64);
            let form = if u.at("cls") == "inf" && !u.atb("light") { Val::from("colonne") } else { Val::None };
            want.set(&uid, list![x, y, fd, form, false]);
        } else if r == "res" && plan != "place" && plan != "assaut" {
            let mut s = if mem.get("mode") == "ligne" {
                Some(_slot(mem, &uid))
            } else {
                let p = mem.at("post").get(&uid);
                if p.truthy() && p.at(0).is_some() { Some((p.atf(0), p.atf(1))) } else { None }
            };
            if s.is_none() {
                s = Some(_at(cx, cy, fd, -220.0, mem.at("lat").get_or(&uid, 0.0).f()));
            }
            let (mut sx, mut sy) = s.unwrap();
            if let Some(wagon) = &wagon_w {
                if u.atf("ammo") < 0.6 * u.atf("ammo0") && u.at("cls") == "inf" && L.ati("n") >= 1 {
                    // recompléter ses cartouches au chariot (il recomplète à moins de 150 m)
                    let k = chiffres(&u);
                    (sx, sy) = _at(wagon.atf("x"), wagon.atf("y"), fd, 40.0, (60 * k) as f64);
                }
            }
            want.set(&uid, list![sx, sy, fd, "colonne", false]);
        } else if r == "soutien" {
            let g = b.unit(&mem.get_or("escort", Val::dict()).get(&uid));
            if g.is_none()
                || !U::alive(&g)
                || g.ati("side") != side
                || !seen.iter().any(|e| dans(&e.at("cls"), &["inf", "cavalerie"]) && d2u(&e, &g) < sq(450.0))
            {
                roles.set(&uid, "res"); // la menace est passée (ou la batterie perdue) : retour en réserve
                continue;
            }
            let (x, y) = _at(g.atf("x"), g.atf("y"), fd, 30.0, 70.0);
            want.set(&uid, list![x, y, fd, "ligne", false]);
        } else if r == "garde_flanc" {
            let (sx, sy) = if mem.get("mode") == "ligne" {
                _slot(mem, &uid)
            } else {
                _at(mem.atf("ax"), mem.atf("ay"), fd, -mem.at("back").get_or(&uid, 60.0).f(), mem.at("lat").get_or(&uid, 0.0).f())
            };
            let s = if mem.at("lat").get_or(&uid, 0.0).f() > 0.0 { 1.0 } else { -1.0 };
            want.set(&uid, list![sx, sy, fd + s * 0.9, "ligne", false]);
        }
    }
}

/// Des fuyards à rallier : le moteur ne les rallie qu'auprès d'un général (l'ordre « Rallier », que les réflexes
/// donnent sans cesse, dès que l'ennemi est à plus de 150 m ; d'eux-mêmes, au calme, à plus de 400 m). Le général va
/// au-devant d'eux, sur leur chemin de fuite (vers notre bord), au premier endroit où il est hors de portée de fusil
/// (l'ennemi repéré à plus de FETCH_SAFE), un peu en arrière : ils passent près de lui et se reforment. Pas s'il faut
/// passer sous le feu, si des cavaliers ennemis rôdent par là, ni pour une poignée d'hommes ; le groupe le plus
/// nombreux qu'on rejoint vite d'abord. Ceux qui passeront de toute façon près de son poste ordinaire (gx, gy), derrière
/// la ligne, l'y trouveront : il ne le quitte pas pour eux. Renvoie (x, y, au galop) ou None.
///
/// Python (ai.py, l. 3885-3928) : `def _fetch(b, side, mem, L, g, us, seen, gx, gy)`
/// g : le général (unité) ; seen : sit['seen']. Rend `tup![x, y, au galop (bool)]` ou None. `range(0, min(700, int(far)), 50)`.
/// `FETCH_REACH[L['n']]`.
pub fn _fetch(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, g: &Val, us: &Val, seen: &Val, gx: f64, gy: f64) -> Val {
    let runs: Vec<Val> = us
        .iter()
        .filter(|v| v.at("state") == "deroute" && v.atf("men") >= 50.0 && dans(&v.at("cls"), &["inf", "cavalerie", "artillerie"]))
        .collect();
    if runs.is_empty() {
        return Val::None;
    }
    let foes: Vec<Val> = seen.iter().filter(|e| U::valid(e) && dans(&e.at("cls"), &["inf", "cavalerie"])).collect();
    let ahead = pmin(120.0, 0.3 * b.rally_radius(g));
    let reach = FETCH_REACH[L.ati("n") as usize];
    let (mut best, mut bv): (Option<(f64, f64, bool, Val)>, f64) = (None, 0.0);
    let r2 = sq(b.rally_radius(g) - 60.0);
    for v in &runs {
        let (vx, vy) = (v.atf("x"), v.atf("y"));
        let (ex, ey) = b.edge_point(side, vx, vy);
        let far = py::hypot(ex - vx, ey - vy);
        let a = (ey - vy).atan2(ex - vx);
        let lim = 700.min(py::int(far));
        let mut passe = false;
        let mut s = 0;
        while s < lim {
            if _d2(vx + a.cos() * s as f64, vy + a.sin() * s as f64, gx, gy) < r2 {
                passe = true;
                break;
            }
            s += 50;
        }
        if passe {
            continue;
        }
        for s in (0..1000).step_by(100) {
            let s = s as f64;
            if s > far - 80.0 {
                break;
            }
            let (px, py_) = (vx + a.cos() * s, vy + a.sin() * s);
            if foes.iter().any(|e| _d2(e.atf("x"), e.atf("y"), px, py_) < sq(FETCH_SAFE)) {
                continue; // trop près de l'ennemi : plus loin sur son chemin
            }
            let (tx, ty) = _clamp(px + a.cos() * ahead, py_ + a.sin() * ahead, 40.0);
            let d = py::hypot(tx - g.atf("x"), ty - g.atf("y"));
            let (mx, my) = ((tx + g.atf("x")) / 2.0, (ty + g.atf("y")) / 2.0);
            if d > reach
                || foes.iter().any(|e| {
                    _d2(e.atf("x"), e.atf("y"), mx, my) < sq(260.0) || _d2(e.atf("x"), e.atf("y"), tx, ty) < sq(FETCH_SAFE)
                })
                || _cav_near(b, mem, tx, ty, 550.0, 240.0)
                || _cav_near(b, mem, mx, my, 450.0, 240.0)
            {
                break; // trop loin, ou il faudrait s'exposer
            }
            let val = v.atf("men") / (1.0 + d / 500.0);
            if val > bv {
                (best, bv) = (Some((tx, ty, d > 150.0, v.clone())), val);
            }
            break;
        }
    }
    let Some((tx, ty, run, v)) = best else { return Val::None };
    let txt = format!("le général va au-devant des fuyards du {} pour les rallier.", v.at("name"));
    _note_once(b, mem, &format!("fetch{}", v.at("id")), &txt, 900.0);
    tup![tx, ty, run]
}

/// Des cavaliers ennemis rôdent : l'état-major ou le chariot se met derrière le bataillon le plus proche
/// (un chariot escorté ne se laisse pas enlever).
///
/// Python (ai.py, l. 3931-3941) : `def _shelter(b, mem, us, u, x, y, fd)`
pub fn _shelter(b: &mut TacticalBattle, mem: &Val, us: &Val, u: &Val, x: f64, y: f64, fd: f64) -> (f64, f64) {
    if !_cav_near(b, mem, x, y, 550.0, 120.0) && !_cav_near(b, mem, u.atf("x"), u.atf("y"), 550.0, 120.0) {
        return (x, y);
    }
    let inf: Vec<Val> =
        us.iter().filter(|o| o.at("cls") == "inf" && U::valid(o) && !dans(&o.at("state"), &["charge", "melee"])).collect();
    if inf.is_empty() {
        return (x, y);
    }
    let o = py::min_by_key(inf.into_iter(), |v| _d2(v.atf("x"), v.atf("y"), x, y)).unwrap();
    let txt = format!("des cavaliers ennemis rôdent : {} s'abrite derrière {}.", u.at("name"), o.at("name"));
    _note_once(b, mem, &format!("abri{}", u.at("id")), &txt, 900.0);
    _at(o.atf("x"), o.atf("y"), fd, -45.0, 0.0)
}

// ---------------------------------------------------------------------- cavalerie

/// Python (ai.py, l. 3945-4040) : `def _cavalry(b, side, mem, L, us, foes, sit, want, busy)`
/// `u.id in mem.get('sortie', ())`. `str(wing) in (mem.get('refuse') or {})`. `isinstance(pt_, tuple)` → `is_tuple()`.
pub fn _cavalry(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    let roles = mem.at("role");
    let fd = mem.atf("fd");
    let plan = mem.ats("plan");
    let now = b.clock;
    let cavs: Val = us.iter().filter(|u| u.at("cls") == "cavalerie" && roles.get(u.at("id")) == "cav").collect();
    if !cavs.truthy() {
        return;
    }
    let w2 = mem.get_or("width", 600).f() / 2.0;
    let flg = mem.get_or("flg", Val::dict());
    let e_cav: Val = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    let idle = mem.setdefault("idle", Val::dict());
    let seen_ids = Val::dict();
    for e in foes.iter() {
        seen_ids.set(e.at("id"), e.clone());
    }
    for u in cavs.iter() {
        let uid = u.at("id");
        if dans(&u.at("state"), &["charge", "melee", "deroute", "ralliement"])
            || u.atf("busy") > 0.0
            || mem.get_or("sortie", tup![]).has(&uid)
        {
            continue;
        }
        let mut cd = fd;
        let o = u.at("order");
        if o.truthy() && o.get("kind") == "attack" && u.atb("path") && seen_ids.has(u.at("target")) {
            let t = seen_ids.at(u.at("target"));
            if U::alive(&t) && t.at("state") != "hors" {
                if d2u(&t, &u) < sq(150.0) && t.at("form") != "carre" && _charge_ok(b, side, &u, &t) {
                    b.order(side, &ids(&u), "charge", "ia", &dict! {"target" => t.at("id")}); // l'obstacle est contourné : on charge
                }
                busy.push(uid.clone());
                continue;
            }
        }
        // poste : l'aile, en retrait, hors de portée efficace des canons ennemis repérés
        let wing = mem.at("wing").get_or(&uid, 1);
        let (mut sx, mut sy);
        if plan == "place" || plan == "assaut" {
            let p = mem.at("post").get(&uid);
            (sx, sy) = if p.truthy() { (p.atf(0), p.atf(1)) } else { (u.atf("x"), u.atf("y")) };
        } else if wing == 0i64 && mem.get("ord").or(Val::dict()).get("cav") == "ecran" {
            // (ordres : en écran derrière les canons et la ligne, contre les charges)
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, -120.0, mem.at("lat").get_or(&uid, 0.0).f());
            (sx, sy) = _clamp(x, y, 30.0);
        } else if wing == 0i64 {
            // (la réserve de cavalerie attend derrière le point de rupture, prête à exploiter)
            let pl_ = if mem.get("pt").truthy() && !_dfn(side, mem) { mem.get_or("pt_lat", 0.0) } else { Val::from(0.0) };
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, if pl_.truthy() { -350.0 } else { -260.0 }, pl_.f());
            (sx, sy) = _clamp(x, y, 30.0);
        } else {
            let lat = wing.f() * (w2 + 110.0 + (120 * _wing_rank(mem, us, &u)) as f64);
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, -70.0, lat);
            (sx, sy) = _clamp(x, y, 30.0);
            if mem.get("mode") == "poste" && mem.at("post").has(&uid) && dans(&mem.at("phase"), &["attente", "combat"]) {
                let p = mem.at("post").at(&uid);
                (sx, sy) = (p.atf(0), p.atf(1));
                if mem.get("refuse").or(Val::dict()).has(format!("{wing}").as_str()) {
                    let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, -20.0, wing.f() * (w2 + 160.0));
                    (sx, sy) = _clamp(x, y, 30.0);
                    cd = fd + wing.f() * 0.8;
                }
            }
        }
        if L.ati("n") >= 1 {
            (sx, sy) = _out_of_guns(b, mem, sx, sy, fd);
        }
        let fresh = u.atf("morale") > (if L.at("n").truthy() { 50.0 } else { 40.0 })
            && u.atf("men") > 0.35 * u.atf("men0")
            && u.atf("fat") < 80.0;
        let mut r = L.atf("cav_r");
        if flg.get(&uid) == 2i64 {
            r *= 1.6;
        }
        if now - idle.get_or(&uid, now).f() > 600.0 && L.ati("n") == 2 {
            r *= 1.3;
        }
        if now - mem.get_or("masse_t", -1e9).f() < 900.0 || mem.get("trouee").truthy() {
            r *= L.atf("exploit_k"); // (la masse est lancée ou la brèche ouverte : la cavalerie exploite)
        }
        if fresh && _pursuit(b, side, mem, L, &u, &cavs, foes) {
            busy.push(uid.clone());
            idle.set(&uid, py::round(now));
            continue;
        }
        let tgt = if fresh { _cav_target(b, side, L, &u, foes, &e_cav, r, mem) } else { Val::None };
        if tgt.is_some() {
            b.order(side, &ids(&u), "charge", "ia", &dict! {"target" => tgt.at("id")});
            busy.push(uid.clone());
            idle.set(&uid, py::round(now));
            // (une aile qui n'est pas un entier : hors de WING)
            let wi = if wing.is_int() { wing.i() } else if wing.is_float() && wing.f().fract() == 0.0 { wing.f() as i64 } else { i64::MIN };
            _note_charge(b, mem, &u, &tgt, wi);
            continue;
        }
        if want.has(&uid) {
            continue; // (débordement : le groupe de flanc a déjà sa destination)
        }
        if fresh {
            // une troupe derrière sa barricade : par un bout, ou par la brèche, s'il y a la place (sinon on attend)
            for e in foes.iter() {
                if e.at("cls") == "inf" && U::valid(&e) && d2u(&e, &u) < r * r {
                    let pt_ = _barrage(b, side, &u, &e, 0.0);
                    if pt_.is_tuple() {
                        let dir = (e.atf("y") - pt_.atf(1)).atan2(e.atf("x") - pt_.atf(0));
                        want.set(&uid, list![pt_.at(0), pt_.at(1), dir, Val::None, true]);
                        let txt = format!("{} tourne la barricade du {}.", u.at("name"), _foe(&e));
                        _note_once(b, mem, &format!("contourne{uid}"), &txt, 900.0);
                        break;
                    }
                }
            }
            if want.has(&uid) {
                continue;
            }
        }
        let od = mem.get("ord").or(Val::dict());
        if od.get("cav") == "raid" && fresh && plan != "place" && plan != "assaut" && dans(&mem.at("phase"), &["prepa", "assaut", "combat"]) {
            // ordres, raid sur les arrières : ses chariots s'ils sont vus, sinon loin derrière sa ligne
            let wg = foes.iter().find(|e| e.at("cls") == "chariot" && U::alive(e));
            let (rx, ry) = match &wg {
                Some(w) => (w.atf("x"), w.atf("y")),
                None => {
                    let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, 1300.0, od.atf("w") * (w2 + 350.0));
                    _clamp(x, y, 60.0)
                }
            };
            want.set(&uid, list![rx, ry, fd, Val::None, _d2(u.atf("x"), u.atf("y"), rx, ry) > sq(300.0)]);
            _note_once(b, mem, "raid", "raid : la cavalerie file sur les arrières de l'ennemi.", 7200.0);
            continue;
        }
        if !(u.atf("morale") > 35.0) && plan != "place" {
            (sx, sy) = _at(sx, sy, fd, -150.0, 0.0);
        }
        let mut far = _d2(u.atf("x"), u.atf("y"), sx, sy) > sq(400.0);
        if _dfn(side, mem) && _rel(u.atf("x"), u.atf("y"), mem.atf("ax"), mem.atf("ay"), fd).0 > 300.0 {
            far = true; // emportée trop loin : elle se reforme au galop derrière la ligne
        }
        want.set(&uid, list![sx, sy, cd, Val::None, far]);
        if !idle.has(&uid) {
            idle.set(&uid, py::round(now));
        }
    }
}

/// Python (ai.py, l. 4043-4047) : `def _wing_rank(mem, us, u)`
/// `same.sort()` : ids (textes) dans l'ordre des points de code (celui des octets UTF-8 : `String::cmp`).
pub fn _wing_rank(mem: &Val, us: &Val, u: &Val) -> i64 {
    let w = mem.at("wing").get(u.at("id"));
    let mut same: Vec<String> = us
        .iter()
        .filter(|v| v.at("cls") == "cavalerie" && mem.at("wing").get(v.at("id")) == w && mem.at("role").get(v.at("id")) == "cav")
        .map(|v| v.ats("id"))
        .collect();
    same.sort();
    let id = u.ats("id");
    same.iter().position(|s| *s == id).map_or(0, |i| i as i64)
}

/// Recule le poste d'attente de la cavalerie hors de portée efficace des batteries ennemies repérées.
///
/// Python (ai.py, l. 4050-4061) : `def _out_of_guns(b, mem, x, y, fd)`
pub fn _out_of_guns(b: &TacticalBattle, mem: &Val, x: f64, y: f64, fd: f64) -> (f64, f64) {
    let now = b.clock;
    let (mut x, mut y) = (x, y);
    for v in mem.at("vu").values() {
        if v.at(4) != "artillerie" || now - v.atf(2) > 600.0 || dans(&v.at(6), &["deroute", "hors"]) {
            continue;
        }
        let e = 700.0;
        for _ in 0..4 {
            if _d2(v.atf(0), v.atf(1), x, y) >= e * e {
                break;
            }
            let (px, py_) = _at(x, y, fd, -60.0, 0.0);
            (x, y) = _clamp(px, py_, 30.0);
        }
    }
    (x, y)
}

/// Python (ai.py, l. 4064-4078) : `def _note_charge(b, mem, u, tgt, wing)`
/// wing : -1, 0 ou 1 (mem['wing']), parfois autre chose (`wing in WING`).
pub fn _note_charge(b: &mut TacticalBattle, mem: &Val, u: &Val, tgt: &Val, wing: i64) {
    let what = if tgt.at("cls") == "artillerie" {
        format!("la batterie isolée ({})", _foe(tgt))
    } else if tgt.at("cls") == "chariot" {
        "un chariot de munitions ennemi".to_string()
    } else if tgt.at("cls") == "general" {
        "l'état-major ennemi".to_string()
    } else if tgt.at("state") == "deroute" {
        format!("les fuyards du {}", _foe(tgt))
    } else {
        let a = _ang(tgt.atf("dir"), (u.atf("y") - tgt.atf("y")).atan2(u.atf("x") - tgt.atf("x")));
        let how = if a > 2.3 { " de dos" } else if a > 1.2 { " de flanc" } else { "" };
        format!("le {}{how}", _foe(tgt))
    };
    let who = if WING().has(wing) { format!("la cavalerie de {}", WING().get_or(wing, "la réserve")) } else { u.ats("name") };
    let txt = format!("{who} ({}) charge {what}.", u.at("name"));
    _note_once(b, mem, &format!("ch{}{}", u.at("id"), tgt.at("id")), &txt, 300.0);
}

/// La meilleure proie à portée de charge : artillerie sans soutien, fuyards, flanc ou dos, ennemi ébranlé, en
/// marche, qui charge, sans cartouches, ou pris sous notre fusillade. Le défenseur ne s'aventure pas à plus de 550 m
/// devant sa ligne, ni personne dans la mitraille d'une autre batterie ennemie connue.
///
/// Python (ai.py, l. 4081-4175) : `def _cav_target(b, side, L, u, foes, e_cav, r, mem=None)`
/// mem : la mémoire ou None (défaut). Rend la cible (unité) ou None. Tirage (facile, sans cav_pick) :
/// `e.form == 'carre' and b.rng.random() < 0.7` : on ne tire que devant un carré.
pub fn _cav_target(b: &mut TacticalBattle, side: i64, L: &Val, u: &Val, foes: &Val, e_cav: &Val, r: f64, mem: &Val) -> Val {
    let (mut best, mut bv) = (Val::None, 0.0);
    let era = if mem.truthy() { mem.get_or("era", 1) } else { Val::from(1) };
    let dfn = mem.is_some() && _dfn(side, mem);
    let pick = L.atb("cav_pick");
    let zones = if mem.is_some() && pick { _gun_zones(b, mem, 300.0, &Val::None) } else { vec![] };
    let shots: Vec<Val> = if pick {
        b.units_of(side).iter().filter(|o| o.at("cls") == "inf" && U::valid(o) && b.clock - o.atf("fired_t") < 60.0).collect()
    } else {
        vec![]
    };
    let (ux, uy) = (u.atf("x"), u.atf("y"));
    for e in foes.iter() {
        if !U::alive(&e) || e.at("state") == "hors" {
            continue;
        }
        let (ex, ey) = (e.atf("x"), e.atf("y"));
        let d = py::hypot(ex - ux, ey - uy);
        if d > r {
            continue;
        }
        if dfn
            && _rel(ex, ey, mem.atf("ax"), mem.atf("ay"), mem.atf("fd")).0 > 550.0
            && !(d < 350.0 && (dans(&e.at("cls"), &["chariot", "general"]) || (e.at("cls") == "artillerie" && e.at("form") == "attelee")))
        {
            continue; // (la brigade de l'Union, emportée jusqu'à la grande batterie, y fut sabrée)
        }
        if zones.iter().any(|(gx, gy, gr, gid)| *gid != e.at("id") && _d2(*gx, *gy, ex, ey) < gr * gr) {
            continue;
        }
        let tt = b.terrain_at(ex, ey);
        let rough = ROUGH.contains(&tt);
        if !pick {
            // facile : sans discernement (sauf le carré déjà formé, la plupart du temps)
            if e.at("form") == "carre" && b.rng.random() < 0.7 {
                continue;
            }
            let mut v = 1.0 / (1.0 + d / 200.0);
            if dans(&e.at("cls"), &["general", "chariot"]) {
                v *= 0.5;
            }
            if v > bv {
                (best, bv) = (e, v);
            }
            continue;
        }
        if e.at("form") == "carre" || rough {
            continue;
        }
        let support = foes
            .iter()
            .filter(|f| !f.is(&e) && U::valid(f) && f.at("cls") == "inf" && d2u(f, &e) < sq(130.0) && f.at("state") != "melee")
            .count();
        let a = _ang(e.atf("dir"), (uy - ey).atan2(ux - ex));
        let cls = e.at("cls");
        let mut v;
        if cls == "chariot" {
            v = 3.0;
        } else if e.at("state") == "deroute" {
            v = if support == 0 { 1.8 * pmin(1.5, e.atf("men") / 250.0) } else { 0.6 };
        } else if cls == "artillerie" {
            v = (if e.at("form") == "attelee" { 3.2 } else { 2.6 }) * (if support > 0 { 0.35 } else { 1.0 });
            if e.at("form") == "batterie" && e.atf("morale") >= 50.0 && a <= 1.2 {
                v *= 0.4; // de face, la mitraille à bout portant vide les selles : de flanc ou de dos
            }
        } else if cls == "general" {
            v = if support == 0 { 2.0 } else { 0.5 };
        } else if cls == "cavalerie" {
            v = if e.at("state") == "melee" {
                1.4
            } else if e.atf("morale") < 45.0 || e.atf("men") < 0.5 * u.atf("men") {
                0.9
            } else {
                0.0
            };
        } else {
            v = 0.5;
            if a > 2.3 {
                v *= 2.6;
            } else if a > 1.2 {
                v *= 1.9;
            }
            if e.at("state") == "melee" {
                v *= 2.0;
            }
            if e.atf("morale") < BT::FORMED as f64 {
                v *= 1.8; // (sous FORMED, elle ne reçoit plus la charge en ordre)
            } else if e.atf("morale") < 60.0 {
                v *= 1.2;
            }
            if e.atf("men") < 0.5 * e.atf("men0") {
                v *= 1.3;
            }
            if e.at("form") == "tirailleurs" {
                v *= 1.6;
            } else if e.at("form") == "colonne" {
                v *= 1.15;
            }
            if e.at("state") == "marche" && dans(&e.at("form"), &["ligne", "colonne"]) {
                v *= 1.4; // en mouvement, elle ne tire pas
            }
            let no_fire = e.at("state") == "charge" || e.atf("ammo") < 1.0; // (pas de feu de défense)
            if e.at("state") == "charge" {
                v *= 2.0;
            }
            if e.atf("ammo") < 1.0 {
                v *= 1.5;
            }
            if shots.iter().any(|o| d2u(o, &e) < sq(200.0)) {
                v *= 1.3; // prise entre le feu et le sabre : elle ne peut former le carré sous notre fusillade
            }
            if era == 2i64 && e.atf("morale") >= 50.0 && e.atf("ammo") >= 1.0 && !dans(&e.at("state"), &["melee", "charge"]) {
                v *= 0.4; // le fusil rayé fauche les escadrons
            } else if era == 0i64 {
                v *= 1.15;
            }
            // une ligne fraîche, de face : on s'en garde
            if a <= 1.2 && e.atf("morale") >= 55.0 && e.at("state") != "melee" && e.at("form") != "tirailleurs" && !no_fire {
                v *= 0.25;
            }
        }
        // cavaliers ennemis frais à proximité : gare à la contre-charge (difficile : on n'y va pas sans supériorité)
        let rr = if L.atb("cav_safe") { 450.0 } else { 250.0 };
        let fresh = py::sum(
            e_cav.iter().filter(|c| !c.is(&e) && c.atf("morale") > 50.0 && d2u(c, &e) < sq(rr)).map(|c| c.atf("men")),
        );
        if fresh != 0.0 {
            if L.atb("cav_safe") && fresh > 0.7 * u.atf("men") && cls != "chariot" {
                continue;
            }
            v *= 0.6;
        }
        v *= 1.25 - d / r * 0.5;
        if v > bv && _charge_ok(b, side, u, &e) {
            (best, bv) = (e, v);
        }
    }
    if bv >= (if pick { 0.55 } else { 0.0 }) { best } else { Val::None }
}

// ---------------------------------------------------------------------- baïonnette

/// Force au corps à corps estimée (comme le moteur : type, moral, expérience, fatigue, ordre dispersé, maisons et
/// murs), à partir de ce que l'on voit de l'unité.
///
/// Python (ai.py, l. 4179-4194) : `def _melee_power(b, u)`
/// `U.TYPE.get(u.type, U.TYPE['ligne'])['melee']` → `U::TYPE()`.
pub fn _melee_power(b: &TacticalBattle, u: &Val) -> f64 {
    let types = U::TYPE();
    let mut k = types.get_or(u.at("type"), types.at("ligne")).atf("melee")
        * (0.5 + u.atf("morale") / 200.0)
        * (0.8 + u.atf("xp") / 250.0)
        * (1.0 - u.atf("fat") / 250.0);
    if u.at("form") == "tirailleurs" {
        k *= 0.7;
    }
    let t = b.terrain_at(u.atf("x"), u.atf("y"));
    if u.at("form") == "maisons" {
        k *= BT::MAISON_MELEE;
    } else if [T_MUR, T_PORTE, T_BARRICADE].contains(&t) && u.ati("side") == 0 {
        k *= 0.6;
    } else if t == T_BATI {
        k *= 1.4;
    } else if t != T_BRECHE && b.cover_at(u.atf("x"), u.atf("y")) >= 0.5 {
        k *= 1.5;
    }
    k * u.atf("men")
}

/// Charge à la baïonnette : contre un ennemi éprouvé, en désordre, pris de flanc, des canons sans soutien ; et,
/// après l'avoir assez fusillé, contre l'ennemi d'en face quand le rapport des forces au corps à corps est bon (les
/// tirailleurs tiennent mal à la baïonnette). Difficile : les bataillons voisins chargent ensemble.
///
/// Python (ai.py, l. 4197-4335) : `def _bayonets(b, side, mem, L, us, foes, sit, busy)`
/// ctx : dict {era, zones, cav, line, held, ca_t} passé à `_local_counter` ; zones : `_gun_zones(…)` mis en liste de
/// `tup![x, y, r, id]` ; ca_t : `mem.setdefault('ca_t', {})` (le même objet) ; held : id → liste d'unités.
/// Tirage (facile) : `b.rng.random() < 0.12` pour chaque ennemi valide à portée, dans l'ordre de foes.
/// `cands.sort(key=-valeur)` stable. `n_ca += roles.get(u.id) == 'ligne'` : un booléen ajouté (0 ou 1).
/// `math.ceil(len / 3)`.
pub fn _bayonets(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, busy: &Val) {
    let roles = mem.at("role");
    let plan = mem.ats("plan");
    let now = b.clock;
    let cav_near: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    // (une fusillade d'une salve par minute use l'ennemi lentement : on ne croise la baïonnette, à forces égales, qu'après
    // un quart d'heure de feu)
    // (selon l'époque : on se fusillait plus longtemps dans l'ordre linéaire ; au point de rupture, la baïonnette vient
    // plus tôt ; au temps du fusil rayé, jamais contre une troupe fraîche)
    let era = if plan != "place" && plan != "assaut" { mem.get_or("era", 1).i() } else { 1 }; // (les places ont leurs règles)
    let ei = era as usize;
    let t_fire = if mem.get("phase") == "combat" { now - mem.get_or("t_phase", now).f() } else { -1.0 };
    let fired_long = t_fire >= FIRE_LONG_D[ei];
    let pt = if L.atb("rupture") && !_dfn(side, mem) { mem.get("pt") } else { Val::None };
    // débordement : la ligne fixe l'ennemi par son feu tant que le groupe de flanc n'a pas pris l'ennemi de flanc
    let fix = plan == "debordement" && (mem.get("fl") != "attaque" || now - mem.get_or("t_fla", now).f() < 600.0);
    let mut cands: Vec<(f64, f64, Val, Val, Val)> = vec![];
    let dfn = _dfn(side, mem) && L.atb("cav_pick") && L.atf("ca_thr") < 99.0;
    let mut ctx = Val::None;
    if dfn {
        let zones: Val = _gun_zones(b, mem, 300.0, &Val::None).into_iter().map(|(x, y, r, id)| tup![x, y, r, id]).collect();
        let line: Val = us.iter().filter(|v| roles.get(v.at("id")) == "ligne" && U::valid(v)).collect();
        let cav: Val = cav_near.iter().cloned().collect();
        ctx = dict! {"era" => mem.get_or("era", 1), "zones" => zones, "cav" => cav, "line" => line, "held" => Val::dict(),
        "ca_t" => mem.setdefault("ca_t", Val::dict())};
        for v in us.iter() {
            if v.at("state") == "melee" && v.get("melee_with").truthy() {
                ctx.at("held").setdefault(v.at("melee_with"), list![]).push(v.clone());
            }
        }
    }
    for u in us.iter() {
        if u.at("cls") != "inf"
            || !U::valid(&u)
            || busy.has(u.at("id"))
            || u.atf("busy") > 0.0
            || dans(&u.at("state"), &["charge", "melee"])
            || u.at("form") == "carre"
        {
            continue;
        }
        let r = roles.get(u.at("id"));
        if dfn {
            // la ligne qui défend ne charge que l'assaillant qui flotte, et revient à son poste
            let c = _local_counter(b, side, mem, L, &u, &r, foes, &ctx);
            if c.truthy() {
                cands.push((c.atf(0), c.atf(1), u.clone(), c.at(2), c.at(3)));
            }
            continue;
        }
        if !dans(
            &r,
            &["ligne", "assaut", "vague2", "garde_flanc", "soutien", "res", "breche", "mur", "rue", "coeur", "diversion", "masse", "coupure", "ilot"],
        ) {
            continue;
        }
        if r == "res" && plan != "place" {
            continue;
        }
        if u.atf("morale") < 50.0 || u.atf("men") < 0.45 * u.atf("men0") {
            continue;
        }
        if cav_near.iter().any(|c| d2u(c, &u) < sq(380.0)) {
            continue; // des cavaliers tout près : une troupe qui charge, en désordre, serait sabrée
        }
        let mut reach = if dans(&r, &["assaut", "vague2", "coeur", "masse"]) { 130.0 } else { 120.0 };
        if plan == "place" && dans(&r, &["breche", "mur", "ilot"]) {
            reach = 80.0;
        } else if r == "coupure" {
            reach = 100.0;
        }
        let mine = _melee_power(b, &u);
        let (mut best, mut bv, mut br) = (Val::None, 0.0, 0.0);
        for e in foes.iter() {
            if !U::valid(&e) || dans(&e.at("cls"), &["general", "chariot", "cavalerie"]) {
                continue;
            }
            let d = py::hypot(e.atf("x") - u.atf("x"), e.atf("y") - u.atf("y"));
            if d > reach {
                continue;
            }
            if !L.atb("cav_pick") {
                // facile : charge au petit bonheur
                if b.rng.random() < 0.12 {
                    (best, bv) = (e, 1.0);
                }
                continue;
            }
            let mut v = 0.0;
            let ratio = mine / pmax(1.0, _melee_power(b, &e));
            let sup = foes.iter().filter(|f| !f.is(&e) && U::valid(f) && f.at("cls") == "inf" && d2u(f, &e) < sq(110.0)).count();
            if e.at("cls") == "artillerie" && sup == 0 {
                // (une batterie en ordre, abordée de face, vous reçoit à mitraille : pas sans l'avoir ébranlée)
                v = if e.at("form") == "batterie" && e.atf("morale") >= 50.0 && _gun_front(&e, &u) { 0.6 } else { 2.0 };
            }
            if e.atf("morale") < 40.0 {
                v = pmax(v, 1.6);
            }
            if e.atf("men") < 0.45 * e.atf("men0") {
                v = pmax(v, 1.2);
            }
            if e.at("state") == "melee" {
                v = pmax(v, 1.4);
            }
            if _ang(e.atf("dir"), (u.atf("y") - e.atf("y")).atan2(u.atf("x") - e.atf("x"))) > 1.3 && e.atf("morale") < 65.0 {
                v = pmax(v, 1.3);
            }
            if (dans(&r, &["assaut", "vague2", "coeur"]) || (r == "masse" && era < 2)) && u.atf("men") > 0.8 * e.atf("men") {
                v = pmax(v, 1.0);
            }
            // après la fusillade : à la baïonnette si l'on est nettement plus fort au corps à corps
            let in_pt = pt.is_some() && era == 1 && _d2(e.atf("x"), e.atf("y"), pt.atf(0), pt.atf(1)) < sq(260.0);
            if e.at("cls") == "inf"
                && !(fix && r == "ligne")
                && ratio >= (if in_pt { 1.15 } else { FIRE_RATIO[ei] })
                && (fired_long || (in_pt && t_fire >= 600.0) || e.atf("men") < 0.85 * e.atf("men0"))
                && (era < 2 || e.atf("morale") < 45.0 || e.atf("men") < 0.6 * e.atf("men0"))
            {
                v = pmax(v, 0.8 + ratio * 0.2);
            }
            if ratio < 0.8 && e.at("cls") == "inf" {
                v *= 0.5;
            }
            if v > bv {
                (best, bv, br) = (e, v, ratio);
            }
        }
        if best.is_some() {
            cands.push((bv, br, u.clone(), best, Val::None));
        }
    }
    if cands.is_empty() {
        return;
    }
    let cands = py::sorted_by_key(cands, |c| -c.0);
    let mut launched: Vec<(Val, Val)> = vec![];
    let (mut n_ca, mut max_ca) = (0i64, 0i64);
    if dfn {
        // cohésion : au plus un bataillon de la ligne sur trois hors du rang à la fois
        let line = ctx.at("line");
        n_ca = line.iter().filter(|v| v.at("state") == "charge").count() as i64;
        max_ca = 1.max((line.len() as f64 / 3.0).ceil() as i64);
    }
    for (bv, br, u, e, why) in cands {
        let mut go = bv >= 1.0;
        // difficile : les voisins d'un bataillon qui charge chargent aussi, s'ils ne sont pas trop faibles
        if !go && L.ati("n") == 2 && br >= (if dfn { 0.9 } else { 1.0 }) && launched.iter().any(|(v, _)| d2u(v, &u) < sq(220.0)) {
            go = true;
        }
        if go && dfn && roles.get(u.at("id")) == "ligne" && n_ca >= max_ca {
            continue;
        }
        let how = if go && !dfn { _barrage(b, side, &u, &e, br) } else { Val::from("ok") };
        if how.is_none() {
            continue; // (une barricade sans brèche ni bout libre, et pas assez de monde : on attend les canons)
        }
        if how.is_tuple() {
            let dir = (e.atf("y") - how.atf(1)).atan2(e.atf("x") - how.atf(0));
            _goto(b, side, mem, &u, how.atf(0), how.atf(1), &Val::from(dir), false, 22.0);
            busy.push(u.at("id"));
            let txt = format!("{} tourne la barricade du {}.", u.at("name"), _foe(&e));
            _note_once(b, mem, &format!("contourne{}", u.at("id")), &txt, 900.0);
            continue;
        }
        if go && _charge_ok(b, side, &u, &e) {
            b.order(side, &ids(&u), "charge", "ia", &dict! {"target" => e.at("id")});
            busy.push(u.at("id"));
            launched.push((u.clone(), e.clone()));
            if !dfn {
                continue;
            }
            n_ca += (roles.get(u.at("id")) == "ligne") as i64;
            ctx.at("ca_t").set(u.at("id"), py::round(now));
            _stat(mem, "ca", 1);
            let txt = if why == "faute" {
                format!("{} : faute de cartouches, à la baïonnette ! (contre-attaque sur le {})", u.at("name"), _foe(&e))
            } else if roles.get(u.at("id")) == "res" {
                format!(
                    "{} sort de la réserve en colonne : contre-attaque sur le {} arrêté devant la ligne ({}).",
                    u.at("name"),
                    _foe(&e),
                    why.or("moment décisif")
                )
            } else {
                format!("{} contre-attaque à la baïonnette le {} ({}).", u.at("name"), _foe(&e), why.or("assaillant ébranlé"))
            };
            _note_once(b, mem, &format!("ca{}", u.at("id")), &txt, 600.0);
        }
    }
    if !launched.is_empty() && !dfn {
        let (u, e) = &launched[0];
        let what = if e.at("cls") == "artillerie" { format!("les canons du {}", _foe(e)) } else { format!("le {}", _foe(e)) };
        let others = if launched.len() > 1 {
            format!(" (avec {})", launched[1..].iter().map(|(v, _)| v.ats("name")).collect::<Vec<_>>().join(", "))
        } else {
            String::new()
        };
        let txt = format!("{} charge à la baïonnette {what}{others}.", u.at("name"));
        _note_once(b, mem, &format!("bay{}", u.at("id")), &txt, 600.0);
    }
}

/// Contre-attaque locale d'un bataillon de la défense sur un assaillant qui flotte, à courte portée de son poste
/// (la colonne de réserve, plus loin, sur l'ennemi arrêté devant la ligne : le « moment décisif »). Renvoie
/// (valeur, rapport des forces, cible, raison) : valeur ≥ 1 pour charger ; ou None.
///
/// Python (ai.py, l. 4338-4398) : `def _local_counter(b, side, mem, L, u, r, foes, ctx)`
/// r : le rôle de u (texte ou None) ; ctx : voir `_bayonets`. Rend `tup![valeur, rapport, cible, raison]` ou None.
pub fn _local_counter(b: &TacticalBattle, side: i64, mem: &Val, L: &Val, u: &Val, r: &Val, foes: &Val, ctx: &Val) -> Val {
    let now = b.clock;
    let era = ctx.at("era");
    if !dans(r, &["ligne", "garde_flanc", "avant"]) && !(*r == "res" && L.atb("res_ca")) {
        return Val::None;
    }
    if *r == "avant" && !u.atb("light") {
        return Val::None;
    }
    if u.atf("morale") < L.atf("ca_mor") || u.atf("men") < 0.5 * u.atf("men0") || u.atf("fat") >= 70.0 {
        return Val::None;
    }
    if now - ctx.at("ca_t").get_or(u.at("id"), -1e9).f() < L.atf("ca_cool") {
        return Val::None; // il revient à son poste et reforme ses rangs
    }
    let cr = if era == 2i64 { 600.0 } else { 380.0 };
    if ctx.at("cav").iter().any(|c| d2u(&c, u) < cr * cr) {
        return Val::None;
    }
    let k2 = if era == 2i64 { 0.7 } else { 1.0 };
    let mut reach = L.atf("ca_reach") * k2;
    if *r == "res" {
        reach = 200.0 * k2;
    }
    let p = if mem.get("mode") == "poste" && *r != "res" { mem.at("post").get(u.at("id")) } else { Val::None };
    let thr = L.atf("ca_thr") + (if era == 0i64 { 0.3 } else { 0.0 });
    let mine = _melee_power(b, u);
    let mut best: Option<(f64, f64, Val, String)> = None;
    for e in foes.iter() {
        if !U::valid(&e) || !dans(&e.at("cls"), &["inf", "artillerie"]) {
            continue;
        }
        let d2 = d2u(&e, u);
        if d2 > reach * reach || (p.truthy() && _d2(e.atf("x"), e.atf("y"), p.atf(0), p.atf(1)) > sq(260.0)) {
            continue;
        }
        let held = ctx.at("held").get_or(e.at("id"), list![]);
        if *r == "res" && !held.truthy() && !ctx.at("line").iter().any(|v| d2u(&v, &e) < sq(150.0)) {
            continue;
        }
        if ctx.at("zones").iter().any(|g| g.at(3) != e.at("id") && _d2(g.atf(0), g.atf(1), e.atf("x"), e.atf("y")) < g.atf(2) * g.atf(2)) {
            continue; // sous la mitraille d'une batterie ennemie : on n'y court pas
        }
        let (sc, why, ratio);
        if e.at("cls") == "artillerie" {
            let sup = foes.iter().any(|f| !f.is(&e) && U::valid(&f) && f.at("cls") == "inf" && d2u(&f, &e) < sq(110.0));
            if sup || (e.at("form") == "batterie" && e.atf("morale") >= 50.0 && _gun_front(&e, u)) {
                continue;
            }
            (sc, why) = (1.5, "canons sans soutien".to_string());
            ratio = mine / pmax(1.0, _melee_power(b, &e));
        } else {
            let (s0, w0) = _flotte(b, &e, u);
            if u.atb("light") && !(e.at("form") == "tirailleurs" || s0 >= 1.5) {
                continue;
            }
            let force = mine + 0.5 * py::sum(held.iter().map(|v| _melee_power(b, &v)));
            ratio = force / pmax(1.0, _melee_power(b, &e));
            let mut w = w0;
            let mut ok = s0 >= thr && ratio >= (if s0 >= 1.5 { 0.8 } else { 1.0 });
            if ok && era == 2i64 && w != "aux prises" && w != "sans cartouches" && e.atf("morale") >= 40.0 && u.atf("ammo") >= 1.0 {
                ok = false; // (le fusil rayé : on ne sort de son couvert que contre un ennemi déjà vaincu)
            }
            if !ok && u.atf("ammo") < 1.0 && d2 < sq(100.0) && s0 >= 0.6 {
                ok = true;
                w = "faute".to_string();
            }
            if !ok {
                let s1 = pmin(0.99, s0 * 0.5); // (seulement pour suivre un voisin, en difficile)
                if best.as_ref().is_none_or(|bb| s1 > bb.0) {
                    best = Some((s1, ratio, e.clone(), w));
                }
                continue;
            }
            (sc, why) = (s0, w);
        }
        let v = 1.0 + sc;
        if best.as_ref().is_none_or(|bb| v > bb.0) {
            best = Some((v, ratio, e.clone(), why));
        }
    }
    match best {
        Some((v, ratio, e, why)) => tup![v, ratio, e, why],
        None => Val::None,
    }
}

// ---------------------------------------------------------------------- artillerie

/// Python (ai.py, l. 4402-4534) : `def _artillery(b, side, mem, L, us, foes, sit, want, busy)`
/// `e, mx, g = b.ranges(u)` : (i64, i64, Val). gslot[id] = [clé, x, y, heure] (clé 'fixe' ou le texte f"…").
/// `known` calculé une fois, à la demande. `arts.index(u)`. `(o.get('kind'), o.get('x'), o.get('y')) != ('bombard', …)`.
pub fn _artillery(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    let roles = mem.at("role");
    let plan = mem.ats("plan");
    let ph = mem.ats("phase");
    let fd = mem.atf("fd");
    let now = b.clock;
    let body = _body(b, mem, 300.0);
    let front = _front_dep(&body, mem.atf("ax"), mem.atf("ay"), fd, mem.get_or("width", 600).f() / 2.0 + 300.0).0;
    let gslot = mem.setdefault("gslot", Val::dict());
    let ours: Val = us.iter().filter(|o| dans(&o.at("cls"), &["inf", "cavalerie"]) && U::valid(o)).collect();
    let wagon = us.iter().find(|w| w.at("cls") == "chariot" && U::alive(w));
    let arts: Vec<Val> = us.iter().filter(|u| u.at("cls") == "artillerie" && roles.get(u.at("id")) == "art").collect();
    let batter = if plan == "assaut" { mem.get("batter").or(Val::dict()) } else { Val::dict() };
    let dfn = _dfn(side, mem);
    let mut known: Option<Vec<Cible>> = None;
    let mut looked = false; // (une seule recherche d'emplacement par réflexion : elle coûte des lignes de vue)
    for u in &arts {
        let uid = u.at("id");
        if dans(&u.at("state"), &["deroute", "ralliement", "melee"]) {
            continue;
        }
        let (e, mut mx, g) = b.ranges(u);
        if u.at("type") == "mitrailleuses" {
            mx = e; // (au-delà de sa portée efficace, la gerbe se perd : la batterie se place et tire à 1 200 m)
        }
        let (ef, mxf) = (e as f64, mx as f64);
        let p = mem.at("post").get(&uid);
        let c = gslot.get(&uid);
        let fixed = plan == "place" || plan == "assaut" || (mem.get("mode") == "poste" && (ph == "attente" || ph == "combat"));
        let mut pos: (f64, f64);
        if wagon.is_some() && u.atf("ammo") < 0.15 * u.atf("ammo0") && L.ati("n") >= 1 {
            let w = wagon.as_ref().unwrap();
            pos = (w.atf("x") + 40.0, w.atf("y"));
        } else if fixed || ph == "marche" || front.is_none() {
            let derriere = || {
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, -60.0, mem.at("lat").get_or(&uid, 0.0).f());
                _clamp(x, y, 30.0)
            };
            pos = if fixed {
                if c.truthy() && c.at(0) == "fixe" {
                    (c.atf(1), c.atf(2))
                } else if p.truthy() {
                    (p.atf(0), p.atf(1))
                } else {
                    (u.atf("x"), u.atf("y"))
                }
            } else if ph == "marche" {
                derriere()
            } else if u.at("form") == "batterie" {
                (u.atf("x"), u.atf("y"))
            } else {
                derriere()
            };
            // batterie aveugle (haies, bois, crête) alors que l'ennemi est à portée : on cherche un emplacement qui voit
            // (le défenseur, quand l'assaut vient à sa portée sans qu'elle tire : plus tôt, plus près, pas en avant)
            let come = dfn
                && foes.iter().any(|f| {
                    f.at("cls") == "inf" && U::valid(&f) && !f.atb("light") && f.at("form") != "tirailleurs" && d2u(&f, u) < mxf * mxf
                });
            let attente = if !come { 180.0 } else if L.ati("n") == 2 { 60.0 } else { 90.0 };
            if fixed
                && L.ati("n") >= 1
                && !looked
                && u.at("form") == "batterie"
                && !u.atb("path")
                && !batter.has(&uid)
                && now - pmax(u.atf("fired_t"), if c.truthy() { c.atf(3) } else { 0.0 }) > attente
                && !_cav_near(b, mem, u.atf("x"), u.atf("y"), 800.0, 300.0)
                && !foes.iter().any(|f| U::valid(&f) && d2u(&f, u) < sq(if come { 300.0 } else { 450.0 }))
            {
                if known.is_none() {
                    known = Some(_known_targets(b, mem, 300.0));
                }
                let near: Vec<Cible> =
                    known.as_ref().unwrap().iter().filter(|t| _d2(t.0, t.1, u.atf("x"), u.atf("y")) < sq(mxf * 1.1)).cloned().collect();
                if !near.is_empty() && (come || _gun_view(b, u.atf("x"), u.atf("y"), &near, mxf) == 0) {
                    looked = true;
                    let (x, y) = _gun_spot_view(
                        b,
                        side,
                        u.atf("x"),
                        u.atf("y"),
                        fd,
                        if come { 160.0 } else { 120.0 },
                        &near,
                        mxf,
                        if come { 20.0 } else { 1e9 },
                    );
                    gslot.set(&uid, list!["fixe", py::round_n(x, 1), py::round_n(y, 1), py::round(now)]);
                    if _d2(x, y, u.atf("x"), u.atf("y")) > sq(40.0) {
                        let txt = format!("{} ne voit rien : elle change d'emplacement.", u.at("name"));
                        _note_once(b, mem, &format!("aveugle{uid}"), &txt, 600.0);
                    }
                    pos = (x, y);
                }
            }
        } else {
            // à bonne portée du front ennemi, sur un emplacement qui voit l'ennemi
            let front = front.f();
            let mut dist = Val::from(ef * (if ph == "prepa" { 0.85 } else { 0.6 }));
            let od = mem.get("ord").or(Val::dict());
            if od.get("art") == "appui" && (ph == "assaut" || ph == "combat") {
                dist = Val::from(ef * 0.42); // ordres : les pièces suivent l'infanterie et tirent pendant l'assaut
            }
            let gd = if ph != "marche" { _grape_dist(b, mem, L, u, &g, foes) } else { Val::None };
            if gd.truthy() {
                dist = gd.clone(); // batterie avancée à mitraille, hors de portée des fusils ennemis
                let txt = format!(
                    "plus de cavaliers ennemis aux alentours : les batteries s'avancent à portée de mitraille ({} m).",
                    py::round(gd.f())
                );
                _note_once(b, mem, "mitraille", &txt, 7200.0);
            }
            let dist = pmax(dist.f(), 200.0);
            let mut lat = mem.at("lat").get_or(&uid, 0.0).f();
            let gb = od.get("art") == "grande";
            if L.atb("rupture") && mem.get("pt").truthy() && (mem.get("era") == 1i64 || gb) && !dfn && plan != "harcelement" {
                // grande batterie : les pièces se serrent face au point de rupture, à 100 m d'intervalle (60 sur ordre)
                let k = arts.iter().position(|a| a.is(u)).unwrap() as f64;
                lat = mem.get_or("pt_lat", 0.0).f() + (k - (arts.len() - 1) as f64 / 2.0) * (if gb { 60.0 } else { 100.0 });
                if arts.len() >= 2 {
                    let txt = format!("grande batterie : {} batteries se serrent face au point de rupture et préparent l'assaut.", arts.len());
                    _note_once(b, mem, "gbat", &txt, 7200.0);
                }
            }
            let key = format!(
                "{}:{}:{}:{}:{}",
                py::round(front / 80.0),
                py::round(mem.atf("ax") / 80.0),
                py::round(mem.atf("ay") / 80.0),
                py::round(dist / 60.0),
                py::round(lat / 80.0)
            );
            let idle = c.is_some()
                && now - pmax(u.atf("fired_t"), c.atf(3)) > 150.0
                && u.at("form") == "batterie"
                && !u.atb("path");
            if c.truthy() && c.at(0) == key && !(idle && L.ati("n") >= 1) {
                pos = (c.atf(1), c.atf(2));
            } else if looked {
                pos = if c.truthy() { (c.atf(1), c.atf(2)) } else { (u.atf("x"), u.atf("y")) };
            } else {
                looked = true;
                let (x0, y0) = _at(mem.atf("ax"), mem.atf("ay"), fd, front - dist, lat);
                let (mut x, mut y) = _clamp(x0, y0, 50.0);
                if L.at("terrain").truthy() {
                    if known.is_none() {
                        known = Some(_known_targets(b, mem, 300.0));
                    }
                    let near: Vec<Cible> =
                        known.as_ref().unwrap().iter().filter(|t| _d2(t.0, t.1, x, y) < sq(mxf * 1.05)).cloned().collect();
                    if !near.is_empty() {
                        let reach = if gd.truthy() { g.f() * 0.98 } else { ef * 1.1 };
                        (x, y) = _gun_spot_view(b, side, x, y, fd, 100.0 * pmin(1.6, L.atf("r_k")), &near, reach, if gd.truthy() { 0.0 } else { 40.0 });
                    } else {
                        (x, y) = _gun_spot(b, side, x, y, fd, 70.0 * L.atf("r_k"), false, 30.0, true);
                    }
                }
                // on ne déplace pas une batterie qui tire pour quelques mètres
                if !idle && _d2(u.atf("x"), u.atf("y"), x, y) < sq(if gd.truthy() { 40.0 } else { 110.0 }) && u.at("form") == "batterie" {
                    (x, y) = (u.atf("x"), u.atf("y"));
                }
                gslot.set(&uid, list![key.as_str(), py::round_n(x, 1), py::round_n(y, 1), py::round(now)]);
                pos = (x, y);
            }
        }
        let dist2 = _d2(u.atf("x"), u.atf("y"), pos.0, pos.1);
        if dist2 > sq(45.0) {
            want.set(&uid, list![pos.0, pos.1, fd, "attelee", false]);
            continue;
        }
        if u.at("form") != "batterie" {
            if u.atf("busy") <= 0.0 && !u.atb("path") {
                _form(b, side, u, "batterie");
            }
            busy.push(uid.clone());
            continue;
        }
        busy.push(uid.clone());
        let aim = batter.get(&uid);
        if aim.truthy() && ["prepa", "regroupe", "investi"].contains(&ph.as_str()) {
            // batterie de brèche : elle bat son point du rempart (le moteur la laisse se défendre à mitraille)
            let o = u.at("order").or(Val::dict());
            if autre_bombard(&o, &aim.at(0), &aim.at(1))
                && b.order(side, &ids(u), "bombard", "ia", &dict! {"x" => aim.at(0), "y" => aim.at(1)}).0
            {
                let txt = format!("la batterie de brèche ({}) ouvre le feu sur le rempart.", u.at("name"));
                _note_once(b, mem, &format!("batter{uid}"), &txt, 7200.0);
                _stat(mem, "batter", 1);
            }
            continue;
        }
        let bar = _barr_cible(b, side, u, &ours, ef);
        if bar.is_some() {
            let o = u.at("order").or(Val::dict());
            if autre_bombard(&o, &bar.at(0), &bar.at(1))
                && b.order(side, &ids(u), "bombard", "ia", &dict! {"x" => bar.at(0), "y" => bar.at(1)}).0
            {
                let txt = format!("{} bat la barricade qui arrête l'infanterie.", u.at("name"));
                _note_once(b, mem, &format!("barr{uid}"), &txt, 1800.0);
            }
            continue;
        }
        if u.at("order").or(Val::dict()).get("kind") == "bombard" {
            b.order(side, &ids(u), "hold", "ia", &dict! {}); // (l'assaut est lancé, la brèche est ouverte : les pièces tirent sur les défenseurs)
        }
        // cible
        if !L.atb("art_pick") {
            continue; // facile : les canons tirent sur ce qui se présente (choix du moteur)
        }
        let pt_k = if mem.at("plan") != "assaut" { L.atf("pt_k") } else { 1.6 };
        let tgt = _art_target(b, u, foes, &ours, mem, mxf, ef, &g, pt_k);
        if tgt.is_some() {
            let o = u.at("order");
            if u.at("target") != tgt.at("id") || !o.truthy() || o.get("kind") != "attack" {
                b.order(side, &ids(u), "attack", "ia", &dict! {"target" => tgt.at("id")});
            }
        }
    }
}

/// Distance de tir à mitraille quand elle dépasse la portée des fusils ennemis (canons Gribeauval contre fusils à
/// silex, par exemple) et qu'aucun cavalier ennemi ne menace la batterie : aucun vu depuis 5 min à moins de 1 000 m
/// (grape = 1 ; le réglage plus hardi, 700 m, grape = 2, perd ses canons trop souvent) ; sinon None.
///
/// Python (ai.py, l. 4537-4551) : `def _grape_dist(b, mem, L, u, g, foes)`
/// g : portée de mitraille (entier, 0 ou None : `b.ranges(u).2`). Rend une distance (flottant) ou None.
pub fn _grape_dist(b: &TacticalBattle, mem: &Val, L: &Val, u: &Val, g: &Val, foes: &Val) -> Val {
    if !L.at("grape").truthy() || !g.truthy() {
        return Val::None;
    }
    let mut inf_mx = 0i64;
    for e in foes.iter() {
        if e.at("cls") == "inf" && U::valid(&e) {
            inf_mx = inf_mx.max(b.ranges(&e).1);
        }
    }
    if inf_mx == 0 || g.f() < (inf_mx + 25) as f64 {
        return Val::None;
    }
    if _cav_near(b, mem, u.atf("x"), u.atf("y"), if L.ati("grape") == 1 { 1000.0 } else { 700.0 }, 300.0) {
        return Val::None;
    }
    // min(g * 0.95, inf_mx + 35) : le second (un entier) seulement s'il est plus petit
    let a = g.f() * 0.95;
    if ((inf_mx + 35) as f64) < a { Val::from(inf_mx + 35) } else { Val::from(a) }
}

/// Des cavaliers ennemis ont-ils été vus récemment à moins de r mètres ?
///
/// Python (ai.py, l. 4554-4562) : `def _cav_near(b, mem, x, y, r, maxage=300.0)`
/// maxage : défaut 300.0.
pub fn _cav_near(b: &TacticalBattle, mem: &Val, x: f64, y: f64, r: f64, maxage: f64) -> bool {
    let now = b.clock;
    let r2 = r * r;
    mem.at("vu").values().iter().any(|v| {
        v.at(4) == "cavalerie" && now - v.atf(2) <= maxage && !dans(&v.at(6), &["deroute", "hors"]) && _d2(v.atf(0), v.atf(1), x, y) < r2
    })
}

/// Ennemis repérés récemment (positions connues) : [(x, y, cls)], les plus proches de notre ancre d'abord.
///
/// Python (ai.py, l. 4565-4572) : `def _known_targets(b, mem, maxage=300.0)`
/// maxage : défaut 300.0. Tri stable par distance à l'ancre, puis les 7 premiers.
pub fn _known_targets(b: &TacticalBattle, mem: &Val, maxage: f64) -> Vec<Cible> {
    let now = b.clock;
    let out: Vec<Cible> = mem
        .at("vu")
        .values()
        .into_iter()
        .filter(|v| now - v.atf(2) <= maxage && !dans(&v.at(6), &["deroute", "hors"]) && dans(&v.at(4), &["inf", "artillerie", "cavalerie"]))
        .map(|v| (v.atf(0), v.atf(1), v.ats(4)))
        .collect();
    let (ax, ay) = (mem.atf("ax"), mem.atf("ay"));
    let mut out = py::sorted_by_key(out, |t| _d2(t.0, t.1, ax, ay));
    out.truncate(7);
    out
}

/// Python (ai.py, l. 4575-4581) : `def _gun_view(b, x, y, tg, reach)`
/// `EYES.get(cls, 2.5)`.
pub fn _gun_view(b: &mut TacticalBattle, x: f64, y: f64, tg: &[Cible], reach: f64) -> i64 {
    let mut n = 0;
    let r2 = reach * reach;
    for (tx, ty, cls) in tg {
        if _d2(x, y, *tx, *ty) <= r2 && b.los(x, y, *tx, *ty, GUN_EYE, EYES().get_or(cls.as_str(), 2.5).f()) {
            n += 1;
        }
    }
    n
}

/// Emplacement de batterie qui voit le plus d'ennemis connus à portée (la hauteur départage ; lisières et vignes,
/// où la cavalerie charge mal, sont préférées). Au plus une trentaine de cases et cinq cibles : quelques ms.
///
/// Python (ai.py, l. 4584-4607) : `def _gun_spot_view(b, side, x, y, fd, r, tg, reach, ahead)`
/// `tg[:5]`.
pub fn _gun_spot_view(b: &mut TacticalBattle, side: i64, x: f64, y: f64, fd: f64, r: f64, tg: &[Cible], reach: f64, ahead: f64) -> (f64, f64) {
    let (mut best, mut bv) = ((x, y), -1e9);
    let n = 1.max(3.min(py::int(py::floordiv_f(r, 40.0))));
    let tg = &tg[..tg.len().min(5)];
    for i in -n..=n {
        for j in -n..=n {
            if i * i + j * j > n * n {
                continue;
            }
            let (px, py_) = (x + (i * 40) as f64, y + (j * 40) as f64);
            if !(30.0 < px && px < (W - 30) as f64 && 30.0 < py_ && py_ < (H - 30) as f64) || !b.passable(px, py_, "artillerie", side) {
                continue;
            }
            if _rel(px, py_, x, y, fd).0 > ahead {
                continue;
            }
            let t = b.terrain_at(px, py_);
            if t == T_BATI {
                continue;
            }
            let seen = _gun_view(b, px, py_, tg, reach);
            let v = seen as f64 * 1.5 + b.height_at(px, py_) as f64 / 12.0 - py::hypot(i as f64, j as f64) / n as f64 * 0.8
                + (if WOODS.contains(&t) || t == T_VIGNE_T { 0.5 } else { 0.0 });
            if v > bv {
                (best, bv) = ((px, py_), v);
            }
        }
    }
    best
}

/// Python (ai.py, l. 4610-4652) : `def _art_target(b, u, foes, ours, mem, mx, e_r, g, pt_k=1.6)`
/// mx, e_r : portées max et efficace ; g : portée de mitraille (entier, 0 ou None) ; pt_k : défaut 1.6. Rend la
/// cible ou None. `BT::grape_k(d, g)`, `BT::ball_k(d, e_r)` ; `min(…, default=1e12)`.
pub fn _art_target(b: &mut TacticalBattle, u: &Val, foes: &Val, ours: &Val, mem: &Val, mx: f64, e_r: f64, g: &Val, pt_k: f64) -> Val {
    let (mut best, mut bv) = (Val::None, 0.0);
    let cur = u.at("target");
    let bout = if mem.at("plan") == "assaut" { mem.get("bout") } else { mem.get("pt") }; // (la brèche, ou le point de rupture)
    let near_ours = |t: &Val| py::min_f(ours.iter().map(|o| d2u(t, &o))).unwrap_or(1e12);
    for t in foes.iter() {
        if !U::alive(&t) || dans(&t.at("state"), &["hors", "deroute"]) {
            continue;
        }
        let d = py::hypot(t.atf("x") - u.atf("x"), t.atf("y") - u.atf("y"));
        if d > mx * 0.98 {
            continue;
        }
        let cov = b.cover_at(t.atf("x"), t.atf("y"));
        let mut v = if g.truthy() && d <= g.f() {
            BT::P_MITRAILLE * BT::grape_k(d, g.f()) * GRAPE().get_or(t.at("form"), 1.0).f() * (1.0 - cov)
        } else {
            BT::P_BOULET * BT::ball_k(d, e_r) * BALL().get_or(t.at("form"), 1.0).f() * (1.0 - 0.6 * cov)
        };
        let od = mem.get("ord").or(Val::dict());
        if t.at("cls") == "artillerie" {
            let g_t = b.ranges(&t).2.or(280).f();
            let threat = near_ours(&t) < sq(g_t + 60.0);
            v *= if d <= e_r { if threat { 2.0 } else { 1.4 } } else { 1.0 };
            if od.get("art") == "contre" {
                v *= 2.5; // ordres : contre-batterie
            }
        } else if od.get("vsRes") == "canons" && t.at("cls") == "inf" && t.at("form") == "colonne" && near_ours(&t) > sq(400.0) {
            v *= 2.0; // ordres : les canons sur la réserve ennemie qui s'approche en colonne
        } else if t.at("form") == "maisons" {
            v *= 1.5; // (repérée dans les maisons : ni charge de cavaliers ni fusillade ne l'en délogent, le canon oui)
        } else if t.at("cls") == "cavalerie" {
            v *= 1.3;
        } else if t.at("cls") == "chariot" {
            v *= 1.5;
        } else if t.at("cls") == "general" {
            v *= 0.3;
        }
        let near = near_ours(&t);
        if near < sq(400.0) {
            v *= 1.0 + 0.6 * (1.0 - near.sqrt() / 400.0);
        }
        if bout.truthy() && _d2(t.atf("x"), t.atf("y"), bout.atf(0), bout.atf(1)) < sq(260.0) {
            v *= pt_k;
        }
        if t.at("id") == cur {
            v *= 1.25; // (changer de cible coûte du temps de pointage)
        }
        if v > bv && b.los_units(u, &t) {
            (best, bv) = (t, v);
        }
    }
    best
}

// ---------------------------------------------------------------------- exécution

/// Transforme les intentions (position, orientation, formation) en ordres, seulement quand ils changent quelque
/// chose : on ne recalcule pas les chemins à chaque réflexion.
///
/// Python (ai.py, l. 4658-4688) : `def _apply(b, side, mem, us, want, busy)`
/// `x, y, d, form, run = w` : d nombre (ou None), form texte ou None, run booléen.
pub fn _apply(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, want: &Val, busy: &Val) {
    let now = b.clock;
    let fm = mem.at("fm");
    let eng = mem.get("eng").or(Val::dict());
    for (k, v) in eng.items() {
        if v < now {
            eng.del(&k);
        }
    }
    let blocked = mem.setdefault("blocked", Val::dict());
    for (k, v) in blocked.items() {
        if now - v.atf(2) > 120.0 {
            blocked.del(&k);
        }
    }
    for u in us.iter() {
        let uid = u.at("id");
        let w = want.get(&uid);
        if w.is_none() || busy.has(&uid) || eng.has(&uid) {
            continue;
        }
        if dans(&u.at("state"), &["deroute", "melee", "charge", "ralliement"]) || u.atf("busy") > 0.0 || u.at("form") == "carre" || _tenue(&u) {
            continue;
        }
        let (d, form, run) = (w.at(2), w.at(3), w.atb(4));
        let (x, y) = _clamp(w.atf(0), w.atf(1), 30.0);
        let dist2 = _d2(u.atf("x"), u.atf("y"), x, y);
        if u.at("cls") == "artillerie" {
            if dist2 > sq(45.0) {
                _goto(b, side, mem, &u, x, y, &d, run, 30.0);
            }
            continue;
        }
        if form.truthy()
            && form != u.at("form")
            && dans(&form, &["ligne", "colonne", "tirailleurs"])
            && now - fm.get_or(&uid, -999).f() > 75.0
            && u.at("cls") == "inf"
            && form != u.at("form")
            && _form(b, side, &u, form.s())
        {
            fm.set(&uid, py::round(now));
            continue;
        }
        let tol = if dans(&mem.at("role").get(&uid), &["ligne", "breche", "mur"]) { 22.0 } else { 35.0 };
        _goto(b, side, mem, &u, x, y, &d, run, tol);
    }
}

/// Python (ai.py, l. 4691-4722) : `def _goto(b, side, mem, u, x, y, d=None, run=False, tol=22.0)`
/// Défauts : d = None, run = false, tol = 22.0. `b.order(side, [u.id], 'move', x=…, y=…, dir=d, run=run)` :
/// `dir` vaut None quand d l'est (le dict p le porte tel quel) ; `u.goal` : [gx, gy, d, run] ou None.
pub fn _goto(b: &mut TacticalBattle, side: i64, mem: &Val, u: &Val, x: f64, y: f64, d: &Val, run: bool, tol: f64) {
    if _tenue(u) {
        return;
    }
    let (dx, dy) = (x - u.atf("x"), y - u.atf("y"));
    let g = u.at("goal");
    if dx * dx + dy * dy <= tol * tol {
        if u.atb("path") && g.truthy() && _d2(g.atf(0), g.atf(1), x, y) > tol * tol {
            b.order(side, &ids(u), "move", "ia", &dict! {"x" => x, "y" => y, "dir" => d.clone(), "run" => run});
        } else if d.is_some()
            && !u.atb("path")
            && !dans(&u.at("cls"), &["artillerie", "general", "chariot"])
            && _ang(u.atf("dir"), d.f()) > 0.7
            && !dans(&u.at("state"), &["feu", "recharge"])
            && b.clock - u.atf("fired_t") > 40.0
        {
            b.order(side, &ids(u), "move", "ia", &dict! {"x" => u.at("x"), "y" => u.at("y"), "dir" => d.clone()});
        }
        return;
    }
    if u.atb("path") && g.truthy() && _d2(g.atf(0), g.atf(1), x, y) <= sq(tol * 1.2) {
        return;
    }
    let bl = mem.at("blocked").get(u.at("id"));
    if bl.truthy() && _d2(bl.atf(0), bl.atf(1), x, y) < sq(80.0) {
        return; // destination introuvable il y a peu : on ne relance pas la recherche de chemin
    }
    let dist = (dx * dx + dy * dy).sqrt();
    let legs = mem.setdefault("leg", Val::dict());
    let (mut x, mut y, mut d) = (x, y, d.clone());
    if dist > LEG + 80.0 {
        // longue marche : par étapes (la recherche de chemin du moteur reste courte, donc bon marché)
        let lg = legs.get(u.at("id"));
        if u.atb("path")
            && g.truthy()
            && lg.truthy()
            && _d2(lg.atf(0), lg.atf(1), x, y) < sq(tol * 2.0)
            && _d2(g.atf(0), g.atf(1), u.atf("x"), u.atf("y")) > sq(120.0)
        {
            return;
        }
        legs.set(u.at("id"), list![py::round(x), py::round(y)]);
        let k = LEG / dist;
        (x, y, d) = (u.atf("x") + dx * k, u.atf("y") + dy * k, Val::None);
    } else {
        legs.pop(u.at("id"));
    }
    b.order(side, &ids(u), "move", "ia", &dict! {"x" => x, "y" => y, "dir" => d, "run" => run});
    if !u.atb("path") {
        mem.at("blocked").set(u.at("id"), list![py::round(x), py::round(y), py::round(b.clock)]);
    }
}
