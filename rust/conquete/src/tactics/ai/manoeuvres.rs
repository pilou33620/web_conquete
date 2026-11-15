//! Porte game/tactics/ai.py, lignes 2797 à 3774 : rase campagne (légers, débordement) ; attaque en rase campagne :
//! point de rupture, masse, poursuite ; place : défense ; place : assaut.
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
/// `min(l, key=lambda r: _d2(r.x, r.y, x, y))` (le premier gagne).
fn plus_proche(l: &[Val], x: f64, y: f64) -> Val {
    py::min_by_key(l.iter().cloned(), |r| _d2(r.atf("x"), r.atf("y"), x, y)).expect("ValueError: min() arg is an empty sequence")
}
/// `', '.join(u.name for u in l)`.
fn noms(l: &[Val]) -> String {
    l.iter().map(|u| u.ats("name")).collect::<Vec<_>>().join(", ")
}

/// Légers du défenseur : postes avancés, repli sur les ailes de la ligne quand l'ennemi approche (en normal et
/// difficile : l'écran de tirailleurs, _screen).
///
/// Python (ai.py, l. 2797-2834) : `def _lights_def(b, side, mem, L, us, foes, sit, want, busy)`
pub fn _lights_def(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    if L.at("screen").truthy() {
        _screen(b, side, mem, L, us, foes, sit, want, busy);
        return;
    }
    let roles = mem.at("role");
    let w = mem.get_or("width", 600).f() / 2.0;
    let fold = mem.setdefault("fold", Val::dict());
    for u in us.iter() {
        let uid = u.at("id");
        if roles.get(&uid) != "avant" {
            continue;
        }
        let p = mem.at("post").get(&uid);
        if !p.truthy() {
            continue;
        }
        let mut danger = false;
        for e in sit.at("seen").iter() {
            let d2 = d2u(&e, &u);
            if e.at("cls") == "inf" && !e.atb("light") && d2 < sq(170.0) {
                danger = true;
            } else if e.at("cls") == "cavalerie" && d2 < sq(380.0) && !ROUGH.contains(&b.terrain_at(u.atf("x"), u.atf("y"))) {
                danger = true;
            }
        }
        if danger && L.ati("n") >= 1 {
            fold.set(&uid, py::round(b.clock));
        } else if L.atb("flankfire")
            && b.clock - u.atf("fired_t") > 240.0
            && b.clock - mem.get_or("t_contact", b.clock).f() > 240.0
        {
            let spot = _flank_fire_spot(b, side, &u, sit);
            if spot.truthy() {
                fold.pop(&uid);
                want.set(&uid, list![spot.at(0), spot.at(1), spot.at(2), "tirailleurs", false]);
                continue;
            }
            if us.iter().any(|v| mem.at("role").get(v.at("id")) == "ligne" && b.clock - v.atf("fired_t") < 60.0) {
                fold.set(&uid, py::round(b.clock)); // poste inutile : on rejoint l'aile de la ligne, qui se bat
            }
        }
        if fold.has(&uid) && b.clock - fold.at(&uid).f() < 300.0 {
            let s = if mem.at("lat").get_or(&uid, 0.0).f() >= 0.0 { 1.0 } else { -1.0 };
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -20.0, s * (w + 60.0));
            want.set(&uid, list![x, y, mem.at("fd"), "tirailleurs", true]);
        } else {
            want.set(&uid, list![p.at(0), p.at(1), p.at(2), "tirailleurs", false]);
        }
    }
}

/// Écran de tirailleurs du défenseur : postes avancés (palier 0), à mi-chemin (1), aux ailes de la ligne (2). Il
/// recule d'un palier au pas de course devant l'infanterie ennemie en ordre, droit aux ailes devant des cavaliers ou
/// s'il est ébranlé ; il se reporte en avant quand l'assaut reflue ; il harcèle les canonniers ennemis à sa portée.
/// (Waterloo : les tirailleurs et les postes avancés usent l'assaut avant qu'il n'aborde la ligne.)
///
/// Python (ai.py, l. 2837-2914) : `def _screen(b, side, mem, L, us, foes, sit, want, busy)`
/// `pos[st[0]]` : st = mem['scr'][id] = [palier 0..2, heure]. `R` est ici un rayon local.
pub fn _screen(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    let roles = mem.at("role");
    let now = b.clock;
    let (fd, ax, ay) = (mem.atf("fd"), mem.atf("ax"), mem.atf("ay"));
    let w = mem.get_or("width", 600).f() / 2.0;
    let scr = mem.setdefault("scr", Val::dict());
    let s1 = mem.setdefault("scr1", Val::dict());
    let era = mem.get_or("era", 1);
    let seen = sit.at("seen");
    let e_inf: Vec<Val> = seen.iter().filter(|e| e.at("cls") == "inf" && U::valid(e)).collect();
    let formed: Vec<Val> = e_inf.iter().filter(|e| !e.atb("light") && e.at("form") != "tirailleurs").cloned().collect();
    let e_e = formed.iter().map(|e| b.ranges(e).0).max().unwrap_or(0);
    for u in us.iter() {
        let uid = u.at("id");
        if roles.get(&uid) != "avant" || !U::valid(&u) {
            continue;
        }
        let p = mem.at("post").get(&uid);
        if !p.truthy() {
            continue;
        }
        let st = scr.setdefault(&uid, list![0, 0]);
        let e_l = b.ranges(&u).0;
        let lat = mem.at("lat").get_or(&uid, 0.0).f();
        let sgn = if lat >= 0.0 { 1.0 } else { -1.0 };
        if !s1.has(&uid) {
            let d0 = _rel(p.atf(0), p.atf(1), ax, ay, fd).0;
            let (mut x1, mut y1) = _at(ax, ay, fd, pmax(80.0, d0 / 2.0), lat);
            if L.at("terrain").truthy() {
                (x1, y1) = _cover_spot(b, side, x1, y1, fd, 60.0);
            }
            s1.set(&uid, list![py::round_n(x1, 1), py::round_n(y1, 1)]);
        }
        let pos = [(p.atf(0), p.atf(1)), s1.at(&uid).xy(), _at(ax, ay, fd, -20.0, sgn * (w + 60.0))];
        let r = pmax(170.0, 0.75 * e_l.max(e_e) as f64);
        let (cx, cy) = pos[st.ati(0) as usize];
        let cav_close = seen.iter().any(|e| e.at("cls") == "cavalerie" && U::valid(&e) && d2u(&e, &u) < sq(380.0));
        let severe = (cav_close && !ROUGH.contains(&b.terrain_at(u.atf("x"), u.atf("y"))))
            || u.atf("morale") < 50.0
            || u.atf("men") < 0.6 * u.atf("men0");
        let near = formed.iter().any(|e| _d2(e.atf("x"), e.atf("y"), cx, cy) < r * r);
        if st.ati(0) < 2 && (near || severe) {
            st.set(0, if severe { 2 } else { st.ati(0) + 1 });
            st.set(1, py::round(now));
            _stat(mem, "scr_back", 1);
            if st.ati(0) == 2 {
                _note_once(b, mem, "scr2", "les tirailleurs se replient sur les ailes de la ligne.", 900.0);
            } else {
                _note_once(b, mem, "scr1", "les tirailleurs reculent d'un couvert à l'autre en harcelant l'assaut.", 900.0);
            }
        } else if st.ati(0) > 0 {
            let (fx, fy) = pos[st.ati(0) as usize - 1];
            if e_inf.iter().any(|e| _d2(e.atf("x"), e.atf("y"), fx, fy) < sq(1.6 * r))
                || _cav_near(b, mem, u.atf("x"), u.atf("y"), 600.0, 120.0)
                || u.atf("morale") < 60.0
                || mem.get("phase") != "combat"
            {
                st.set(1, py::round(now));
            } else if now - st.atf(1) >= 150.0 {
                st.set(0, st.ati(0) - 1);
                st.set(1, py::round(now));
                _stat(mem, "scr_fwd", 1);
                _note_once(b, mem, "scrf", "l'assaut reflue : les tirailleurs se reportent en avant.", 900.0);
            }
        }
        // harceler les canonniers (d'un couvert à l'autre, hors de portée de leur mitraille de près)
        if st.ati(0) < 2 && (L.ati("n") == 2 || era >= 1i64) {
            let mut tgt = Val::None;
            for e in seen.iter() {
                if e.at("cls") == "artillerie"
                    && U::valid(&e)
                    && d2u(&e, &u) < sq(1.3 * e_l as f64)
                    && !e_inf.iter().any(|f| d2u(f, &e) < sq(200.0))
                    && !_cav_near(b, mem, e.atf("x"), e.atf("y"), 600.0, 120.0)
                {
                    tgt = e;
                    break;
                }
            }
            if tgt.is_some() {
                let o = u.at("order");
                if !(o.truthy() && o.get("kind") == "attack" && u.at("target") == tgt.at("id")) {
                    b.order(side, &ids(&u), "attack", "ia", &dict! {"target" => tgt.at("id")});
                    _stat(mem, "harass", 1);
                    let txt = format!("les tirailleurs ({}) harcèlent les canonniers du {}.", u.at("name"), _foe(&tgt));
                    _note_once(b, mem, &format!("hg{uid}"), &txt, 900.0);
                }
                busy.push(uid.clone());
                continue;
            }
        }
        if L.atb("flankfire")
            && st.ati(0) == 2
            && !near
            && now - u.atf("fired_t") > 240.0
            && now - mem.get_or("t_contact", now).f() > 240.0
        {
            let spot = _flank_fire_spot(b, side, &u, sit);
            if spot.truthy() {
                want.set(&uid, list![spot.at(0), spot.at(1), spot.at(2), "tirailleurs", false]);
                continue;
            }
        }
        let (x, y) = pos[st.ati(0) as usize];
        want.set(&uid, list![x, y, fd, "tirailleurs", st.ati(0) > 0 && now - st.atf(1) < 120.0]);
    }
}

/// Un poste de tir pour des légers inoccupés : de flanc, à bonne portée de l'ennemi le plus proche de notre ligne
/// (à moins de 700 m d'eux), à couvert si possible ; None s'il n'y a rien à faire.
///
/// Python (ai.py, l. 2917-2934) : `def _flank_fire_spot(b, side, u, sit)`
/// Rend `tup![x, y, dir]` ou None.
pub fn _flank_fire_spot(b: &mut TacticalBattle, side: i64, u: &Val, sit: &Val) -> Val {
    let (mut best, mut bd) = (Val::None, sq(700.0));
    for e in sit.at("seen").iter() {
        if e.at("cls") != "inf" || !U::valid(&e) {
            continue;
        }
        let d = d2u(&e, u);
        if d < bd {
            (best, bd) = (e, d);
        }
    }
    if best.is_none() {
        return Val::None;
    }
    let e_r = b.ranges(u).0 as f64;
    let a = (u.atf("y") - best.atf("y")).atan2(u.atf("x") - best.atf("x"));
    let (mut x, mut y) = _clamp(best.atf("x") + a.cos() * e_r * 0.9, best.atf("y") + a.sin() * e_r * 0.9, 30.0);
    if !ROUGH.contains(&b.terrain_at(x, y)) {
        (x, y) = _cover_spot(b, side, x, y, a + std::f64::consts::PI, 60.0);
    }
    tup![x, y, a + std::f64::consts::PI]
}

/// Légers de l'assaillant : en avant de la ligne, d'un couvert à l'autre ; aux ailes une fois la ligne engagée ;
/// en rideau devant la colonne d'attaque (la masse), dont ils s'écartent quand elle arrive à 200 m de sa cible.
///
/// Python (ai.py, l. 2937-2972) : `def _lights_att(b, side, mem, L, us, foes, sit, want, body, front, halt)`
/// front : nombre ou None. `'masse' in roles.values()`. La clé du cache : `f"{round(ax / 40)}:…"` (entiers).
pub fn _lights_att(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, body: &[Repere], front: &Val, halt: f64) {
    let roles = mem.at("role");
    let w = mem.get_or("width", 600).f() / 2.0;
    let ph = mem.ats("phase");
    let lights: Vec<Val> = us.iter().filter(|u| roles.get(u.at("id")) == "avant").collect();
    let cache = mem.setdefault("lspot", Val::dict());
    let key = format!("{}:{}:{}", py::round(mem.atf("ax") / 40.0), py::round(mem.atf("ay") / 40.0), ph);
    let mg = if mem.get_or("era", 1) < 2i64 && roles.values().iter().any(|v| *v == "masse") { mem.get("masse_go") } else { Val::None };
    let flg = mem.get_or("flg", Val::dict());
    let fd = mem.atf("fd");
    for (k, u) in lights.iter().enumerate() {
        let uid = u.at("id");
        let lat = mem.at("lat").get_or(&uid, 0.0).f();
        let k2 = (k / 2) as i64;
        if mg.truthy() && !flg.get(&uid).truthy() {
            let (s, close) = (if k % 2 == 0 { 1 } else { -1 }, mg.at(2) < 200i64);
            let dep = -(b.ranges(u).0 as f64) * (if close { 0.5 } else { 0.9 });
            let lt = s * (if close { 120 + 60 * k2 } else { 40 + 60 * k2 });
            let (px, py_) = _at(mg.atf(0), mg.atf(1), fd, dep, lt as f64);
            let (x, y) = _clamp(px, py_, 30.0);
            want.set(&uid, list![x, y, fd, "tirailleurs", false]);
            continue;
        }
        if ph == "combat" || ph == "poursuite" {
            let s = if lat >= 0.0 { 1.0 } else { -1.0 };
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), fd, 0.0, s * (w + 70.0 + (80 * k2) as f64));
            want.set(&uid, list![x, y, fd, "tirailleurs", false]);
            continue;
        }
        let mut ahead = 140.0;
        if let Some(f) = opt(front) {
            ahead = pmin(ahead, pmax(0.0, f - halt * 1.1));
        }
        let (mut x, mut y) = _at(mem.atf("ax"), mem.atf("ay"), fd, ahead, lat);
        let mut c = cache.get(&uid);
        if L.at("terrain").truthy() && (!c.truthy() || c.at(0) != key) {
            let (sx, sy) = _cover_spot(b, side, x, y, fd, 80.0 * pmin(1.5, L.atf("r_k")));
            cache.set(&uid, list![key.as_str(), py::round_n(sx, 1), py::round_n(sy, 1)]);
            c = cache.at(&uid);
        }
        if L.at("terrain").truthy() && c.truthy() {
            (x, y) = (c.atf(1), c.atf(2));
        }
        want.set(&uid, list![x, y, fd, "tirailleurs", false]);
    }
}

/// Débordement : la cavalerie de l'aile et les légers tournent le flanc ennemi, puis le prennent de flanc et de dos.
///
/// Python (ai.py, l. 2975-3045) : `def _flank_group(b, side, mem, L, us, foes, sit, want, busy, body)`
pub fn _flank_group(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val, body: &[Repere]) {
    let flank = mem.get("flank").or(1).i();
    let flf = flank as f64;
    let roles = mem.at("role");
    let n_avant = us.iter().filter(|v| roles.get(v.at("id")) == "avant").count();
    let grp: Vec<Val> = us
        .iter()
        .filter(|u| {
            let uid = u.at("id");
            (roles.get(&uid) == "cav" && mem.at("wing").get(&uid) == flank)
                || (roles.get(&uid) == "avant" && (mem.at("lat").get_or(&uid, 0.0).f() * flf > 0.0 || n_avant == 1))
        })
        .collect();
    if grp.is_empty() {
        mem.set("fl", "attaque");
        return;
    }
    let mut fl = mem.get_or("fl", "attente").string();
    // des cavaliers ennemis plus nombreux barrent le chemin : on revient sur l'aile et on réessaiera plus tard
    if fl == "marche" || fl == "attaque" {
        let n = grp.len() as f64;
        let gx = py::sum(grp.iter().map(|u| u.atf("x"))) / n;
        let gy = py::sum(grp.iter().map(|u| u.atf("y"))) / n;
        let e_men = py::sum(
            foes.iter()
                .filter(|e| e.at("cls") == "cavalerie" && U::valid(e) && _d2(e.atf("x"), e.atf("y"), gx, gy) < sq(650.0))
                .map(|e| e.atf("men")),
        );
        let my_men = py::sum(grp.iter().filter(|u| u.at("cls") == "cavalerie" && U::valid(u)).map(|u| u.atf("men")));
        if e_men > 0.9 * my_men && e_men > 60.0 {
            mem.set("fl", "attente");
            mem.set("t_fl", py::round(b.clock));
            let txt = format!("des cavaliers ennemis plus nombreux barrent le débordement : la colonne de flanc se replie sur {}.", WING().at(flank));
            _note_once(b, mem, "fl_abort", &txt, 900.0);
            return;
        }
    }
    if fl == "attente"
        && (!body.is_empty() || dans(&mem.at("phase"), &["prepa", "assaut", "combat"]))
        && b.clock - mem.get_or("t_fl", -1e9).f() > 600.0
    {
        fl = "marche".to_string();
        mem.set("fl", "marche");
        mem.set("t_fl", py::round(b.clock));
        _note(b, mem, &format!("débordement par {} : la cavalerie et les légers tournent l'ennemi.", WING().at(flank)));
    }
    if fl == "attente" {
        return;
    }
    let fd = mem.atf("fd");
    let (ax, ay) = (mem.atf("ax"), mem.atf("ay"));
    let (end_lat, dep) = if !body.is_empty() {
        let ends: Vec<(f64, f64)> = body.iter().map(|t| _rel(t.1, t.2, ax, ay, fd)).collect();
        (py::max_f(ends.iter().map(|(_d, l)| l * flf)).unwrap() * flf, py::min_f(ends.iter().map(|(d, _l)| *d)).unwrap())
    } else {
        (flf * (mem.get_or("width", 600).f() / 2.0), 600.0)
    };
    let ng = grp.len() as i64;
    if fl == "marche" {
        let (px, py_) = _at(ax, ay, fd, dep - 80.0, end_lat + flf * 380.0);
        let (mut tx, mut ty) = _clamp(px, py_, 80.0);
        let wp = mem.get("ord").or(Val::dict()).get("wood");
        if wp.truthy() && !mem.get("wood_ok").truthy() {
            // ordres, marche par le bois : la colonne passe d'abord sous les arbres
            let dedans = grp.iter().filter(|u| _d2(u.atf("x"), u.atf("y"), wp.atf(0), wp.atf(1)) < sq(160.0)).count() as i64;
            if dedans >= 1.max(ng / 2) || b.clock - mem.get_or("t_fl", 0).f() > 1200.0 {
                mem.set("wood_ok", 1);
                mem.set("t_fl", py::round(b.clock));
                _note(b, mem, "la colonne tournante sort du bois.");
            } else {
                (tx, ty) = wp.xy();
            }
        }
        let arrived = if !wp.truthy() || mem.get("wood_ok").truthy() {
            grp.iter().filter(|u| _d2(u.atf("x"), u.atf("y"), tx, ty) < sq(200.0)).count() as i64
        } else {
            0
        };
        if arrived >= 1.max(ng / 2) || b.clock - mem.get_or("t_fl", 0).f() > (if wp.truthy() { 1500.0 } else { 900.0 }) {
            mem.set("fl", "attaque");
            mem.set("t_fla", py::round(b.clock));
            _note(b, mem, &format!("le débordement est en place sur {} : on prend l'ennemi de flanc.", WING().at(flank)));
        }
        for (k, u) in grp.iter().enumerate() {
            let k = k as i64;
            let (x, y) = _at(tx, ty, fd, (-60 * (k / 2)) as f64, (flank * 70 * (k % 2)) as f64);
            let form = if u.atb("light") { Val::from("tirailleurs") } else { Val::None };
            want.set(u.at("id"), list![x, y, fd - flf * 1.2, form, u.at("cls") == "cavalerie"]);
            mem.setdefault("flg", Val::dict()).set(u.at("id"), 1);
        }
        return;
    }
    // attaque : les légers se postent au flanc de l'ennemi, la cavalerie charge (voir _cavalry, rayon élargi)
    for u in &grp {
        if u.atb("light") {
            let (x, y) = _at(ax, ay, fd, dep + 40.0, end_lat + flf * 130.0);
            want.set(u.at("id"), list![x, y, fd - flf * std::f64::consts::PI / 2.0, "tirailleurs", false]);
        } else {
            let (x, y) = _at(ax, ay, fd, dep + 60.0, end_lat + flf * 360.0);
            want.set(u.at("id"), list![x, y, fd - flf * std::f64::consts::PI / 2.0, Val::None, false]);
        }
        mem.setdefault("flg", Val::dict()).set(u.at("id"), 2);
    }
}

// ---------------------------------------------------------------------- attaque en rase campagne : point de rupture,
// masse, poursuite

/// Les fantassins ennemis valides du secteur du point de rupture, et les pertes du secteur (d'après vu0 et vu).
///
/// Python (ai.py, l. 3050-3056) : `def _sector(b, mem, sit, pt, r=250.0)`
/// pt : [x, y] (mem['pt']) ; r : défaut 250.0. Rend (liste des fantassins du secteur, pertes du secteur).
pub fn _sector(b: &TacticalBattle, mem: &Val, sit: &Val, pt: &Val, r: f64) -> (Val, f64) {
    let (px, py_) = pt.xy();
    let inf: Val = sit
        .at("seen")
        .iter()
        .filter(|e| e.at("cls") == "inf" && U::valid(e) && _d2(e.atf("x"), e.atf("y"), px, py_) < r * r)
        .collect();
    let (vu, vu0) = (mem.at("vu"), mem.at("vu0"));
    let ks: Vec<Val> = vu
        .items()
        .into_iter()
        .filter(|(k, v)| v.at(4) == "inf" && vu0.has(k) && _d2(v.atf(0), v.atf(1), px, py_) < r * r)
        .map(|(k, _v)| k)
        .collect();
    let loss = if !ks.is_empty() {
        let a = py::sum_v(ks.iter().map(|k| vu.at(k).at(3)));
        let s = py::sum_v(ks.iter().map(|k| vu0.at(k)));
        let s = if s > 1i64 { s } else { Val::from(1) };
        1.0 - (a / s).f()
    } else {
        0.0
    };
    (inf, loss)
}

/// Le point de rupture : le secteur ennemi le moins solide (effectif, moral, couvert, voisins, distance, mitraille
/// d'une batterie qui le couvre), choisi une fois (normal) ou revu toutes les 5 min (difficile), avec hystérésis.
/// Un bataillon du secteur qui fuit sans que personne ne le remplace : une brèche s'ouvre.
///
/// Python (ai.py, l. 3059-3107) : `def _point(b, side, mem, L, sit)`
/// `res(e)` : fonction imbriquée ; `min(inf, key=res)` → `py::min_by_key` ; `cur in inf` : appartenance (mêmes objets).
pub fn _point(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, sit: &Val) {
    let now = b.clock;
    let mut inf: Vec<Val> = sit.at("seen").iter().filter(|e| e.at("cls") == "inf" && U::valid(e)).collect();
    let cur = b.unit(&mem.get("pt_id"));
    if cur.is_some()
        && mem.get("pt").truthy()
        && cur.at("state") == "deroute"
        && !inf.iter().any(|e| d2u(e, &cur) < sq(200.0))
        && !mem.get("trouee").truthy()
    {
        mem.set("trouee", py::round(now));
        mem.set("pt", list![py::round_n(cur.atf("x"), 1), py::round_n(cur.atf("y"), 1)]);
        let txt = format!("une brèche s'ouvre dans la ligne ennemie (le {} fuit) : la masse et la cavalerie s'y portent.", _foe(&cur));
        _note(b, mem, &txt);
        return;
    }
    let v = if cur.is_some() { mem.at("vu").get(&mem.get("pt_id")) } else { Val::None };
    let alive = v.is_some()
        && U::valid(&cur)
        && now - v.atf(2) < 300.0
        && !(cur.atb("light") && inf.iter().any(|e| !e.atb("light"))); // (perdu de vue un moment : on garde le point)
    if inf.is_empty() || (alive && (!L.at("pt_every").truthy() || now - mem.get_or("pt_t", 0).f() < L.atf("pt_every"))) {
        if alive {
            mem.set("pt", list![v.at(0), v.at(1)]);
        }
        return;
    }
    let lourds: Vec<Val> = inf.iter().filter(|e| !e.atb("light")).cloned().collect();
    if !lourds.is_empty() {
        inf = lourds; // (le point est sur la ligne ennemie, pas sur son écran)
    }
    let zones = _gun_zones(b, mem, 600.0, &Val::None);
    let (ax, ay) = (mem.atf("ax"), mem.atf("ay"));
    let od = mem.get("ord").or(Val::dict());
    if od.get("man") == "oblique" {
        // ordres : le point sur l'aile forte
        let f: Vec<Val> = inf.iter().filter(|e| _rel(e.atf("x"), e.atf("y"), ax, ay, mem.atf("fd")).1 * od.atf("w") > 0.0).cloned().collect();
        if !f.is_empty() {
            inf = f;
        }
    } else if od.get("man") == "percee" {
        // … au centre
        let f: Vec<Val> = inf
            .iter()
            .filter(|e| _rel(e.atf("x"), e.atf("y"), ax, ay, mem.atf("fd")).1.abs() < 0.3 * mem.get_or("width", 600).f())
            .cloned()
            .collect();
        if !f.is_empty() {
            inf = f;
        }
    }
    let top = if od.get("obj") == "cle" { inf.iter().map(|e| b.height_at(e.atf("x"), e.atf("y"))).max() } else { None };
    let res = |e: &Val| -> f64 {
        let mut v = e.atf("men") * (0.5 + e.atf("morale") / 100.0) * (1.0 + 1.5 * b.cover_at(e.atf("x"), e.atf("y")));
        v += 0.5
            * py::sum(
                inf.iter()
                    .filter(|f| !f.is(e) && d2u(f, e) < sq(250.0))
                    .map(|f| f.atf("men") * (0.5 + f.atf("morale") / 100.0)),
            );
        v += 0.3 * py::hypot(e.atf("x") - ax, e.atf("y") - ay);
        if zones.iter().any(|(gx, gy, gr, _gid)| _d2(*gx, *gy, e.atf("x"), e.atf("y")) < gr * gr) {
            v += 400.0;
        }
        if let Some(t) = top {
            if b.height_at(e.atf("x"), e.atf("y")) >= t - 6 {
                v *= 0.5; // ordres : la position clé, sur la hauteur
            }
        }
        v
    };
    let mut best = py::min_by_key(inf.iter().cloned(), |e| res(e)).unwrap();
    if alive && !best.is(&cur) && inf.iter().any(|e| e.is(&cur)) && res(&cur) < 1.25 * res(&best) {
        best = cur.clone();
    }
    mem.set("pt_t", py::round(now));
    mem.set("pt", list![py::round_n(best.atf("x"), 1), py::round_n(best.atf("y"), 1)]);
    if !best.is(&cur) {
        mem.set("pt_id", best.at("id"));
        mem.set("pt_lat", py::round_n(_rel(best.atf("x"), best.atf("y"), ax, ay, mem.atf("fd")).1, 1));
        mem.pop("trouee");
        let txt = format!("point de rupture : le {} ; les batteries y concentrent leur feu.", _foe(&best));
        _note_once(b, mem, "pt", &txt, 600.0);
    }
}

/// La masse : quand le secteur du point de rupture est usé (moral, pertes), la réserve fraîche (grenadiers
/// d'abord ; on garde un bataillon pour les trous si elle en compte trois) s'y jette en colonne, couverte par les
/// tirailleurs, se déploie à bonne distance et charge (voir _bayonets) ; pendant ce temps, le reste de la ligne fixe
/// l'ennemi par son feu. Au temps du fusil rayé (doctrine du feu), elle ne va pas au centre : elle enveloppe l'aile
/// ennemie la moins couverte et la prend de flanc. Repoussée (moitié de son effectif, moral sous 40), elle revient en
/// réserve ; le point emporté, elle prend place dans la ligne.
///
/// Python (ai.py, l. 3110-3214) : `def _masse(b, side, mem, L, us, sit, want, busy, front, halt)`
/// front : nombre ou None. `sorted(…, key=(type != 'grenadiers', -puissance))` stable.
pub fn _masse(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, want: &Val, busy: &Val, front: &Val, halt: f64) {
    let roles = mem.at("role");
    let now = b.clock;
    let fd = mem.atf("fd");
    let pt = mem.get("pt");
    let era = mem.get_or("era", 1);
    let ms: Vec<Val> = us.iter().filter(|u| roles.get(u.at("id")) == "masse").collect();
    if !ms.is_empty() {
        let ok: Vec<Val> = ms.iter().filter(|u| U::valid(u)).cloned().collect();
        let (sector, _loss) = if pt.truthy() { _sector(b, mem, sit, &pt, 250.0) } else { (list![], 0.0) };
        let mor = if !ok.is_empty() { py::sum(ok.iter().map(|u| u.atf("morale"))) / ok.len() as f64 } else { 0.0 };
        if ok.is_empty() || py::sum(ok.iter().map(|u| u.atf("men"))) < 0.5 * mem.get_or("masse0", 1).f() || mor < 40.0 {
            for u in &ms {
                roles.set(u.at("id"), "res");
                mem.at("back").set(u.at("id"), 220.0);
            }
            mem.set("masse_fail", mem.get_or("masse_fail", 0) + 1i64);
            mem.pop("masse_go");
            _note(b, mem, "l'assaut de la masse est repoussé : elle se reforme en réserve.");
            return;
        }
        if !sector.truthy() && now - mem.get_or("masse_t", now).f() > 120.0 {
            for u in &ms {
                roles.set(u.at("id"), "ligne");
                mem.at("lat").set(u.at("id"), py::round_n(_rel(u.atf("x"), u.atf("y"), mem.atf("ax"), mem.atf("ay"), fd).1, 1));
                mem.at("back").set(u.at("id"), 0.0);
            }
            mem.set("pt_id", Val::None); // (le point suivant)
            mem.pop("masse_go");
            _note(b, mem, "le point de rupture est emporté : la masse prend place dans la ligne.");
            return;
        }
        let tgt = py::min_by_key(sector.iter(), |e| e.atf("morale") * e.atf("men"));
        let (mut tx, mut ty) = match &tgt {
            Some(t) => (t.atf("x"), t.atf("y")),
            None => pt.xy(),
        };
        let d_dep = pmax(200.0, 2.5 * mem.get_or("e_fo", 120).f());
        let (mut face, mut form0) = (fd, Val::None);
        if era == 2i64 || mem.get("env_s").is_some() {
            // enveloppement : au bout de l'aile ennemie, de flanc, en ordre dispersé (ordres : double enveloppement)
            let s = mem.get_or("env_s", 1).f();
            (tx, ty) = _at(tx, ty, fd, -halt, s * 150.0);
            (face, form0) = (fd - s * 0.6, Val::from("tirailleurs"));
        }
        let n = ms.len();
        let mut dmin = 1e9;
        for (k, u) in ms.iter().enumerate() {
            if busy.has(u.at("id")) || dans(&u.at("state"), &["melee", "charge", "deroute"]) {
                continue;
            }
            let d = py::hypot(u.atf("x") - tx, u.atf("y") - ty);
            dmin = pmin(dmin, d);
            let (px, py_) = _at(tx, ty, face, if era == 2i64 { 0.0 } else { -70.0 }, (k as f64 - (n - 1) as f64 / 2.0) * 90.0);
            let (x, y) = _clamp(px, py_, 30.0);
            let f = form0.or(if d > d_dep { "colonne" } else { "ligne" });
            want.set(u.at("id"), list![x, y, face, f, false]);
        }
        mem.set("masse_go", list![py::round_n(tx, 1), py::round_n(ty, 1), py::round(dmin)]);
        return;
    }
    if mem.get("phase") != "combat" || !pt.truthy() || now - mem.get_or("t_phase", now).f() < 300.0 {
        return;
    }
    if mem.get_or("masse_n", 0) >= L.at("masse_n")
        || mem.get_or("masse_fail", 0) >= L.at("masse_n")
        || now - mem.get_or("masse_t", -1e9).f() < 900.0
    {
        return;
    }
    let (sector, loss) = _sector(b, mem, sit, &pt, 250.0);
    // (le secteur est usé, ou la brèche ouverte ; au temps du fusil rayé, l'enveloppement suit la préparation ; et
    // quand la fusillade dure depuis 25 min, le moment est venu de jeter la réserve)
    if sector.truthy()
        && py::sum(sector.iter().map(|e| e.atf("morale"))) / sector.len() as f64 > L.atf("masse_mor")
        && loss < 0.15
        && !mem.get("trouee").truthy()
        && era < 2i64
        && now - mem.get_or("t_phase", now).f() < 1500.0
    {
        return;
    }
    let res: Vec<Val> = us
        .iter()
        .filter(|u| {
            roles.get(u.at("id")) == "res"
                && u.at("cls") == "inf"
                && U::valid(u)
                && _quality(u) >= u.atf("men") * 0.5
                && !dans(&u.at("state"), &["melee", "charge"])
        })
        .collect();
    let mut pick = py::sorted_by_key(
        res.iter().filter(|u| u.atf("morale") >= 55.0 && u.atf("ammo") >= 0.4 * u.atf("ammo0") && u.atf("fat") < 70.0).cloned().collect(),
        |u| (u.at("type") != "grenadiers", -_melee_power(b, u)),
    );
    if res.len() >= 3 {
        pick.truncate(res.len() - 1);
    }
    if pick.is_empty() {
        return;
    }
    // ordres, « Me demander » : la bataille s'arrête, le joueur dit quand
    let cible = b.unit(&mem.get("pt_id"));
    let what = if cible.is_some() { format!("Le {}", _foe(&cible)) } else { "La ligne ennemie".to_string() };
    if OR::ask(b, side, "masse", &format!("{what} flanche. Lancer la réserve ({}) maintenant ?", noms(&pick))) != "go" {
        return;
    }
    let env = if mem.get("ord").or(Val::dict()).get("man") == "double" { mem.get("env_s") } else { Val::None };
    if era == 2i64 || env.is_some() {
        // l'aile ennemie la moins couverte (le bout de sa ligne vue, sans bois ni bâti tout près) ; ordres : l'aile
        // opposée à celle du débordement
        let inf: Vec<Val> = sit.at("seen").iter().filter(|e| e.at("cls") == "inf" && U::valid(e)).collect();
        if inf.is_empty() {
            return;
        }
        let ends: Vec<Val> = [1.0, -1.0]
            .iter()
            .map(|s| {
                py::max_by_key(inf.iter().cloned(), |e| s * _rel(e.atf("x"), e.atf("y"), mem.atf("ax"), mem.atf("ay"), fd).1).unwrap()
            })
            .collect();
        let cov: Vec<f64> = ends.iter().map(|e| b.cover_at(e.atf("x"), e.atf("y"))).collect();
        let s = if env.is_some() { env.clone() } else { Val::from(if cov[0] <= cov[1] { 1 } else { -1 }) };
        mem.set("env_s", s.clone());
        let e = &ends[if s == 1i64 { 0 } else { 1 }];
        mem.set("pt", list![py::round_n(e.atf("x"), 1), py::round_n(e.atf("y"), 1)]);
        mem.set("pt_id", e.at("id"));
    }
    for u in &pick {
        roles.set(u.at("id"), "masse");
    }
    mem.set("masse_t", py::round(now));
    mem.set("masse_n", mem.get_or("masse_n", 0) + 1i64);
    mem.set("masse0", py::round(py::sum(pick.iter().map(|u| u.atf("men")))));
    let names = noms(&pick);
    let cible = b.unit(&mem.get("pt_id"));
    let what = if cible.is_some() { format!("le {}", _foe(&cible)) } else { "la brèche".to_string() };
    if era == 2i64 || env.is_some() {
        _note(b, mem, &format!("le feu fixe le centre : la réserve ({names}) enveloppe l'aile ennemie ({what}) en tirailleurs, pour l'assaut de flanc."));
    } else {
        let nt = if pick.len() > 1 { "nt" } else { "" };
        _note(
            b,
            mem,
            &format!("assaut de la masse : {names} se jette{nt} en colonne sur le point de rupture ({what}), couverts par les tirailleurs ; la ligne fixe l'ennemi par son feu."),
        );
    }
}

/// Poursuite : une cavalerie fraîche court sus aux fuyards sans soutien (pas de fantassin ennemi en ordre à moins de
/// 150 m d'eux, pas de cavaliers frais à moins de 450 m), la moitié des escadrons au plus (l'autre reste prête contre
/// une contre-charge) ; un quart d'heure au plus, et pas épuisée. Vrai si l'ordre est donné.
///
/// Python (ai.py, l. 3217-3245) : `def _pursuit(b, side, mem, L, u, cavs, foes)`
/// `b.order(side, [u.id], 'pursue')` (sans paramètre : `&dict!{}`).
pub fn _pursuit(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, u: &Val, cavs: &Val, foes: &Val) -> bool {
    if !L.at("pursue_r").truthy() || _dfn(side, mem) || u.atf("morale") <= 55.0 || u.atf("fat") >= 60.0 {
        return false;
    }
    let now = b.clock;
    let pours = mem.setdefault("pours", Val::dict());
    let p = pours.get(u.at("id"));
    if p.truthy() && now - p.atf(0) > 900.0 {
        return false;
    }
    let active = cavs.iter().filter(|v| pours.has(v.at("id")) && v.at("state") == "charge").count();
    if active >= 1.max(cavs.len() / 2) {
        return false;
    }
    let r2 = sq(L.atf("pursue_r"));
    let inf: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "inf" && U::valid(e)).collect();
    let e_cav: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e) && e.atf("morale") > 50.0).collect();
    let prey = foes.iter().any(|e| {
        U::alive(&e)
            && e.at("state") == "deroute"
            && d2u(&e, u) < r2
            && !inf.iter().any(|f| d2u(f, &e) < sq(150.0))
            && !e_cav.iter().any(|c| d2u(c, &e) < sq(450.0))
    });
    if !prey {
        return false;
    }
    let (ok, _) = b.order(side, &ids(u), "pursue", "ia", &dict! {});
    if !ok {
        return false;
    }
    pours.set(u.at("id"), list![if p.truthy() { p.at(0) } else { Val::from(py::round(now)) }, py::round(now)]);
    let txt = format!("l'ennemi plie : la cavalerie charge les fuyards et le poursuit ({}).", u.at("name"));
    _note_once(b, mem, "pours", &txt, 600.0);
    _stat(mem, "pours", 1);
    true
}

// ---------------------------------------------------------------------- place : défense

/// Contre-attaque dans la brèche (D3) : l'assaillant qui y flotte est rejeté à la baïonnette par la réserve, la
/// coupure et les flancs de la brèche, qui rentrent ensuite à leur poste sans poursuivre. Difficile : tous ensemble.
///
/// Python (ai.py, l. 3249-3286) : `def _breach_counter(b, side, mem, L, us, sit, busy)`
/// `cand.sort(key=d2)` stable.
pub fn _breach_counter(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, busy: &Val) {
    let roles = mem.at("role");
    let pl = b.place_info();
    let (plx, ply) = (pl.atf("x"), pl.atf("y"));
    for q in mem.get("breach").or(list![]).iter() {
        // (et celui qui s'arrête au débouché pour s'y loger : on l'en chasse avant qu'il se retranche)
        let (qx, qy) = (q.atf(0), q.atf(1));
        let r_q = py::hypot(qx - plx, qy - ply);
        let tg: Vec<Val> = sit
            .at("seen")
            .iter()
            .filter(|e| {
                let d2 = _d2(e.atf("x"), e.atf("y"), qx, qy);
                e.at("cls") == "inf"
                    && ((d2 < sq(70.0) && (e.atf("morale") < 60.0 || e.atf("men") < 0.75 * e.atf("men0") || e.at("state") == "melee"))
                        || (d2 < sq(110.0)
                            && dans(&e.at("state"), &["repos", "feu", "recharge"])
                            && py::hypot(e.atf("x") - plx, e.atf("y") - ply) < r_q + 10.0)) // (en deçà du mur)
            })
            .collect();
        if tg.is_empty() {
            continue;
        }
        let e = py::min_by_key(tg.into_iter(), |f| f.atf("morale")).unwrap();
        let mut cand: Vec<(f64, Val)> = vec![];
        for u in us.iter() {
            let r = roles.get(u.at("id"));
            if u.at("cls") != "inf"
                || !U::valid(&u)
                || busy.has(u.at("id"))
                || u.atf("busy") > 0.0
                || dans(&u.at("state"), &["melee", "charge"])
                || u.at("form") == "carre"
                || !dans(&r, &["res", "coupure", "breche"])
            {
                continue;
            }
            let d2 = d2u(&u, &e);
            if (r == "res" && u.atf("morale") > 55.0 && d2 < sq(L.atf("b_counter"))) || (r != "res" && d2 < sq(150.0)) {
                if _charge_ok(b, side, &u, &e) {
                    cand.push((d2, u));
                }
            }
        }
        let cand = py::sorted_by_key(cand, |c| c.0);
        let pe = 0.8 * _melee_power(b, &e);
        let go: Vec<Val> = if L.ati("n") == 2 {
            if py::sum(cand.iter().map(|(_d, u)| _melee_power(b, u))) >= pe { cand.into_iter().map(|c| c.1).collect() } else { vec![] }
        } else {
            cand.into_iter().map(|c| c.1).filter(|u| _melee_power(b, u) >= pe).take(1).collect()
        };
        for u in &go {
            b.order(side, &ids(u), "charge", "ia", &dict! {"target" => e.at("id")});
            busy.push(u.at("id"));
            _stat(mem, "b_ca", 1);
            let txt = format!("{} contre-attaque à la baïonnette dans la brèche.", u.at("name"));
            _note_once(b, mem, &format!("bca{}", u.at("id")), &txt, 600.0);
        }
    }
}

/// Sorties de la garnison contre les batteries de siège (D4 ; Gérone 1809, Dantzig 1807) : avant l'assaut, une
/// troupe fraîche sort par une porte, tombe de flanc sur une batterie isolée, puis rentre.
///
/// Python (ai.py, l. 3289-3359) : `def _sorties(b, side, mem, L, us, sit, busy)`
/// mem['sortie'][id] = [étape, id de la batterie, t0, qx, qy]. `b.path_cost(…)` rend un nombre ou None.
/// `min(cand, key=(cls != 'cavalerie', d2))`.
pub fn _sorties(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, busy: &Val) {
    let roles = mem.at("role");
    let now = b.clock;
    let pl = b.place_info();
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    let r_in = mem.get_or("r_in", pl.at("r")).f();
    let so = mem.setdefault("sortie", Val::dict());
    mem.setdefault("blocked", Val::dict()); // (_goto avant le premier _apply)
    let seen_l = sit.at("seen");
    let seen = Val::dict();
    for e in seen_l.iter() {
        seen.set(e.at("id"), e.clone());
    }
    let byid = Val::dict();
    for u in us.iter() {
        byid.set(u.at("id"), u.clone());
    }
    for uid in so.keys() {
        let rec = so.at(&uid);
        let (mut st, tid, t0, qx, qy) = (rec.ats(0), rec.at(1), rec.at(2), rec.at(3), rec.at(4));
        let u = byid.get(&uid);
        let p = mem.at("post").get(&uid);
        if u.is_none() || !U::alive(&u) || !p.truthy() {
            so.del(&uid);
            continue;
        }
        busy.push(uid.clone());
        let tg = seen.get(&tid);
        let threat = seen_l.iter().any(|e| e.at("id") != tid && e.at("cls") == "inf" && d2u(&e, &u) < sq(250.0));
        if st != "rentrer"
            && (tg.is_none()
                || !U::valid(&tg)
                || now - t0.f() > 600.0
                || threat
                || (st == "charger" && !dans(&u.at("state"), &["charge", "melee"])))
        {
            st = "rentrer".to_string();
            _note_once(b, mem, &format!("rentre{uid}"), &format!("{} rentre dans la place.", u.at("name")), 600.0);
        }
        if st == "sortir" {
            if _d2(u.atf("x"), u.atf("y"), qx.f(), qy.f()) < sq(200.0) && !dans(&u.at("state"), &["deroute", "ralliement"]) {
                b.order(side, &list![uid.clone()], "charge", "ia", &dict! {"target" => tid.clone()});
                st = "charger".to_string();
            } else if !dans(&u.at("state"), &["deroute", "melee", "charge", "ralliement"]) {
                _goto(b, side, mem, &u, qx.f(), qy.f(), &Val::None, true, 22.0);
            }
        } else if st == "rentrer" {
            if _d2(u.atf("x"), u.atf("y"), p.atf(0), p.atf(1)) < sq(60.0) {
                so.del(&uid);
                continue;
            }
            if !dans(&u.at("state"), &["deroute", "melee", "charge", "ralliement"]) {
                _goto(b, side, mem, &u, p.atf(0), p.atf(1), &p.at(2), true, 22.0);
            }
        }
        so.set(&uid, list![st, tid, t0, qx, qy]);
    }
    if so.truthy() || mem.get_or("n_sortie", 0) >= L.at("sortie") || now - mem.get_or("t_sortie", -1e9).f() < 1200.0 {
        return;
    }
    if seen_l.iter().any(|e| e.at("cls") == "inf" && _d2(e.atf("x"), e.atf("y"), px, py_) < sq(r_in + 250.0)) {
        return; // l'assaut est engagé : chacun à son poste
    }
    let near: Vec<Val> = seen_l.iter().filter(|e| dans(&e.at("cls"), &["inf", "cavalerie"]) && U::valid(e)).collect();
    for g in seen_l.iter() {
        if g.at("cls") != "artillerie"
            || g.at("form") != "batterie"
            || py::hypot(g.atf("x") - px, g.atf("y") - py_) > r_in + 700.0
            || near.iter().any(|e| d2u(e, &g) < sq(200.0))
        {
            continue;
        }
        // de flanc, jamais de face (la mitraille) : 150 m sur le côté le plus proche de la place
        let gd = g.atf("dir");
        let pts: Vec<(f64, f64)> =
            [1.0, -1.0].iter().map(|k| (g.atf("x") - gd.sin() * k * 150.0, g.atf("y") + gd.cos() * k * 150.0)).collect();
        let (qx, qy) = py::min_by_key(pts, |c| _d2(c.0, c.1, px, py_)).unwrap();
        if near.iter().any(|e| _d2(e.atf("x"), e.atf("y"), qx, qy) < sq(150.0)) {
            continue;
        }
        let cand: Vec<Val> = us
            .iter()
            .filter(|u| {
                let r = roles.get(u.at("id"));
                U::valid(u)
                    && !busy.has(u.at("id"))
                    && u.atf("morale") > 60.0
                    && u.atf("men") > 0.6 * u.atf("men0")
                    && u.atf("fat") < 50.0
                    && (r == "cav" || (L.ati("sortie") >= 2 && u.at("cls") == "inf" && dans(&r, &["mur", "res"]) && !u.atb("light")))
            })
            .collect();
        if cand.is_empty() {
            return;
        }
        let u = py::min_by_key(cand.into_iter(), |v| (v.at("cls") != "cavalerie", _d2(v.atf("x"), v.atf("y"), qx, qy))).unwrap();
        let d = py::hypot(qx - u.atf("x"), qy - u.atf("y"));
        let cls = if u.at("cls") == "cavalerie" { "cavalerie" } else { "inf" };
        let c = b.path_cost(u.atf("x"), u.atf("y"), qx, qy, cls, side);
        if c.is_none() || c.f() > 1.6 * d + 300.0 {
            return; // pas de porte assez près
        }
        so.set(u.at("id"), list!["sortir", g.at("id"), py::round(now), py::round(qx), py::round(qy)]);
        mem.set("n_sortie", mem.get_or("n_sortie", 0) + 1i64);
        mem.set("t_sortie", py::round(now));
        busy.push(u.at("id"));
        _goto(b, side, mem, &u, qx, qy, &Val::None, true, 22.0);
        _stat(mem, "sortie", 1);
        let txt = format!("sortie de la garnison : {} tombe sur la batterie du {}.", u.at("name"), _foe(&g));
        _note(b, mem, &txt);
        return;
    }
}

/// Python (ai.py, l. 3362-3486) : `def _think_place_def(b, side, mem, L, us, foes, sit, want, busy)`
/// `hot.sort(reverse=True)` trie des tuples (hommes, q) : à hommes égaux, q (liste de nombres) départage, et
/// l'ordre décroissant garde stables les égaux complets. `_breach_posts(…)[:L['n']]`. `held` : set de tuples (x, y)
/// (appartenance seulement).
pub fn _think_place_def(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    let pl = b.place_info();
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    let now = b.clock;
    let heart = mem.get("heart").or_else(|| list![pl.at("x"), pl.at("y")]);
    let r_in = mem.get_or("r_in", pl.at("r")).f();
    let roles = mem.at("role");
    let seen = sit.at("seen");
    _roles_update(b, side, mem, L, us, sit, &Val::None);
    let inside: Vec<Val> = seen.iter().filter(|e| _d2(e.atf("x"), e.atf("y"), px, py_) < sq(r_in - 5.0)).collect();
    for u in us.iter() {
        let uid = u.at("id");
        let r = roles.get(&uid);
        let p = mem.at("post").get(&uid);
        if dans(&r, &["breche", "mur", "rue", "coeur", "res", "art", "cav", "gen", "wagon", "avant", "coupure", "ilot"]) && p.truthy() {
            let form = if u.atb("light") {
                Val::from("tirailleurs")
            } else if r == "res" {
                Val::from("colonne")
            } else if u.at("cls") == "inf" {
                Val::from("ligne")
            } else {
                Val::None
            };
            want.set(&uid, list![p.at(0), p.at(1), p.at(2), form, false]);
            if L.atb("breach_volley")
                && dans(&r, &["breche", "coupure"])
                && u.at("fire_mode") == "free"
                && U::valid(&u)
                && seen.iter().any(|e| e.at("cls") == "inf" && d2u(&e, &u) < sq(250.0))
            {
                // derrière la coupure : feu de salve à bout portant sur ce qui débouche de la brèche
                b.order(side, &ids(&u), "fire", "ia", &dict! {"mode" => "volley"});
            }
        }
    }
    // brèche ouverte pendant la bataille : ses postes de flanc et son retranchement (normal, difficile)
    let brs = mem.get("breach").or(list![]);
    let n_brd = mem.get_or("n_brd", 0).i();
    if L.ati("n") >= 1 && brs.len() as i64 > n_brd {
        for q in brs.slice(Some(n_brd), None).iter() {
            let ri = _ring_at(mem, q.atf(2), &Val::from(py::hypot(q.atf(0) - px, q.atf(1) - py_) + 30.0)).f();
            let posts = _breach_posts(mem, &pl, q.atf(2), ri, BT::BREACH_R);
            for (x, y, a, _k) in posts.into_iter().take(L.ati("n").max(0) as usize) {
                let quiet: Vec<Val> = us
                    .iter()
                    .filter(|u| {
                        roles.get(u.at("id")) == "mur"
                            && U::valid(u)
                            && u.at("cls") == "inf"
                            && !seen.iter().any(|e| d2u(&e, u) < sq(400.0))
                    })
                    .collect();
                if !quiet.is_empty() {
                    let u = plus_proche(&quiet, x, y);
                    roles.set(u.at("id"), "breche");
                    mem.at("post").set(u.at("id"), list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(a, 3)]);
                }
            }
            let u = if L.at("coupure").truthy() { _coupure(b, side, mem, us, &q) } else { Val::None };
            let fin = if u.truthy() { format!(", et {} se retranche derrière.", u.at("name")) } else { ".".to_string() };
            _note(b, mem, &format!("une brèche est ouverte : on la flanque{fin}"));
        }
        mem.set("n_brd", brs.len());
    }
    if L.at("b_counter").truthy() {
        _breach_counter(b, side, mem, L, us, sit, busy);
    }
    if L.at("sortie").truthy() {
        _sorties(b, side, mem, L, us, sit, busy);
    }
    // renforts : une brèche attaquée, des postes de rempart inutiles (normal, difficile)
    if L.ati("n") >= 1 {
        let posts = mem.get("breach").or(list![]);
        let mut hot: Vec<Val> = vec![];
        for q in posts.iter() {
            let men = py::sum(
                seen.iter().filter(|e| _d2(e.atf("x"), e.atf("y"), q.atf(0), q.atf(1)) < sq(320.0)).map(|e| e.atf("men")),
            );
            if men > 150.0 {
                hot.push(tup![men, q]);
            }
        }
        if !hot.is_empty() {
            let hot = py::sorted_by_key_rev(hot, |h| h.clone());
            let q = hot[0].at(1);
            let moved = mem.setdefault("moved", Val::dict());
            let quiet: Vec<Val> = us
                .iter()
                .filter(|u| {
                    roles.get(u.at("id")) == "mur"
                        && U::valid(u)
                        && u.at("cls") == "inf"
                        && !moved.has(u.at("id"))
                        && !seen.iter().any(|e| d2u(&e, u) < sq(400.0))
                })
                .collect();
            if !quiet.is_empty() && moved.len() < (if L.ati("n") == 2 { 2 } else { 1 }) {
                let u = plus_proche(&quiet, q.atf(0), q.atf(1));
                let a = q.atf(2);
                let m = (moved.len() % 2 * 2) as f64 - 1.0;
                let x = q.atf(0) - a.cos() * 55.0 + a.sin() * 60.0 * m;
                let y = q.atf(1) - a.sin() * 55.0 - a.cos() * 60.0 * m;
                mem.at("post").set(u.at("id"), list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(a, 3)]);
                roles.set(u.at("id"), "breche");
                moved.set(u.at("id"), 1);
                _note(b, mem, &format!("la brèche est attaquée : {} quitte un rempart tranquille pour la renforcer.", u.at("name")));
            }
        }
    }
    // intrus dans la place : la réserve contre-attaque
    if !inside.is_empty() {
        let res: Vec<Val> = us
            .iter()
            .filter(|u| {
                dans(&roles.get(u.at("id")), &["res", "cav"])
                    && U::valid(u)
                    && !dans(&u.at("state"), &["melee", "charge"])
                    && u.atf("busy") <= 0.0
                    && !busy.has(u.at("id"))
            })
            .collect();
        for u in &res {
            let e = plus_proche(&inside, u.atf("x"), u.atf("y"));
            let d = d2u(&e, u).sqrt();
            if d > 500.0 {
                continue;
            }
            if u.at("cls") == "cavalerie" {
                if !ROUGH.contains(&b.terrain_at(e.atf("x"), e.atf("y"))) && e.at("form") != "carre" {
                    b.order(side, &ids(u), "charge", "ia", &dict! {"target" => e.at("id")});
                    busy.push(u.at("id"));
                }
            } else if d < 110.0 && (e.atf("morale") < 60.0 || e.atf("men") < 0.6 * u.atf("men")) && u.atf("morale") > 50.0 {
                b.order(side, &ids(u), "charge", "ia", &dict! {"target" => e.at("id")});
                busy.push(u.at("id"));
            } else {
                let o = u.at("order");
                if !(o.truthy() && o.get("kind") == "attack" && u.at("target") == e.at("id")) {
                    b.order(side, &ids(u), "attack", "ia", &dict! {"target" => e.at("id")});
                }
                busy.push(u.at("id"));
            }
        }
        if !mem.at("notes").get("intrus").truthy() {
            mem.at("notes").set("intrus", 1);
            _note(b, mem, "l'ennemi a pénétré dans la place : la réserve contre-attaque.");
        }
    }
    // cœur de la place : toujours quelqu'un pour le tenir (celui qui y court déjà suffit)
    let (hx, hy) = heart.xy();
    if L.ati("n") >= 1 {
        let guard = us.iter().any(|u| {
            U::valid(&u)
                && (_d2(u.atf("x"), u.atf("y"), hx, hy) < sq(130.0)
                    || (roles.get(u.at("id")) == "coeur" && !dans(&u.at("state"), &["melee", "charge"])))
        });
        if !guard {
            let cand: Vec<Val> = us
                .iter()
                .filter(|u| {
                    U::valid(u)
                        && u.at("cls") == "inf"
                        && !dans(&roles.get(u.at("id")), &["breche", "coupure"])
                        && !dans(&u.at("state"), &["melee", "charge"])
                })
                .collect();
            if !cand.is_empty() {
                let u = plus_proche(&cand, hx, hy);
                roles.set(u.at("id"), "coeur");
                mem.at("post").set(u.at("id"), list![heart.at(0), heart.at(1), mem.at("fd")]);
                want.set(u.at("id"), list![heart.at(0), heart.at(1), mem.at("fd"), "ligne", true]);
                _note_once(b, mem, &format!("coeur{}", u.at("id")), &format!("{} court tenir le cœur de la place.", u.at("name")), 1800.0);
            }
        }
    }
    // combats de rue : l'enceinte est forcée, on tient les maisons (Saragosse, Bazeilles)
    let men_in = py::sum(inside.iter().map(|e| e.atf("men")));
    if men_in < 300.0 {
        mem.set("t_inside", Val::None);
    } else if mem.get("t_inside").is_none() {
        mem.set("t_inside", py::round(now));
    }
    let ilots = mem.get("ilots").or(list![]);
    let n_il = roles.values().iter().filter(|v| **v == "ilot").count() as i64;
    if L.at("ilots").truthy()
        && ilots.truthy()
        && mem.get("t_inside").is_some()
        && now - mem.atf("t_inside") >= 60.0
        && n_il < L.ati("ilots")
    {
        let cx = py::sum(inside.iter().map(|e| e.atf("x") * e.atf("men"))) / men_in;
        let cy = py::sum(inside.iter().map(|e| e.atf("y") * e.atf("men"))) / men_in;
        let post = mem.at("post");
        let held: Vec<(Val, Val)> = roles
            .items()
            .into_iter()
            .filter(|(k, v)| *v == "ilot" && post.has(k))
            .map(|(k, _v)| (post.at(&k).at(0), post.at(&k).at(1)))
            .collect();
        let mut free: Vec<Val> = ilots.iter().filter(|q| !held.iter().any(|(a, c)| *a == q.at(0) && *c == q.at(1))).collect();
        let lim = pmax(300.0, 0.75 * r_in);
        let cand: Vec<Val> = us
            .iter()
            .filter(|u| {
                let p = post.get(u.at("id"));
                dans(&roles.get(u.at("id")), &["mur", "breche"])
                    && U::valid(u)
                    && u.at("cls") == "inf"
                    && !busy.has(u.at("id"))
                    && p.truthy()
                    && _d2(p.atf(0), p.atf(1), cx, cy) < sq(lim) // (grande place)
                    && !seen.iter().any(|e| d2u(&e, u) < sq(120.0))
            })
            .collect();
        let tri = py::sorted_by_key(cand, |v| _d2(v.atf("x"), v.atf("y"), cx, cy));
        for u in tri.into_iter().take((L.ati("ilots") - n_il).max(0) as usize) {
            if free.is_empty() {
                break;
            }
            let q = py::min_by_key(free.iter().cloned(), |q| _d2(q.atf(0), q.atf(1), u.atf("x"), u.atf("y"))).unwrap();
            if let Some(i) = free.iter().position(|f| *f == q) {
                free.remove(i);
            }
            roles.set(u.at("id"), "ilot");
            let dir = py::round_n((cy - q.atf(1)).atan2(cx - q.atf(0)), 3);
            mem.at("post").set(u.at("id"), list![q.at(0), q.at(1), dir]);
            want.set(u.at("id"), list![q.at(0), q.at(1), dir, "ligne", true]);
            _stat(mem, "ilot", 1);
            _note(b, mem, &format!("l'ennemi est dans les rues : {} tient les maisons et se bat pied à pied.", u.at("name")));
        }
    }
}

// ---------------------------------------------------------------------- place : assaut

/// Une brèche s'est ouverte au canon depuis le déploiement : l'assaut s'y porte (au lieu d'escalader ailleurs).
/// Vrai si l'objectif a changé.
///
/// Python (ai.py, l. 3490-3521) : `def _aim_breach(b, mem, pl)`
/// `mem['t_breach'] = b.clock` : un flottant (pas arrondi). `for uid, aim in (mem.get('batter') or {}).items()`.
pub fn _aim_breach(b: &mut TacticalBattle, mem: &Val, pl: &Val) -> bool {
    let brs = _breaches(b);
    let first = mem.get("n_br").is_none();
    if brs.len() as i64 <= mem.get_or("n_br", 0).i() {
        mem.setdefault("n_br", brs.len());
        return false;
    }
    mem.set("n_br", brs.len());
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    if first {
        return false; // (les brèches d'un siège : le déploiement les a déjà visées)
    }
    let (bx, by, _) = *brs.last().unwrap(); // la dernière ouverte : celle que battent nos canons
    let a = (by - py_).atan2(bx - px);
    let ri = _ring_at(mem, a, &(&pl.at("r") + 15i64)).f();
    mem.set("bout", list![py::round(px + a.cos() * (ri + 60.0)), py::round(py_ + a.sin() * (ri + 60.0))]);
    mem.set("bin", list![py::round(px + a.cos() * (ri - 50.0)), py::round(py_ + a.sin() * (ri - 50.0))]);
    mem.set("a_b", py::round_n(a, 3));
    mem.set("r_in", py::round(ri));
    mem.set("t_breach", b.clock);
    mem.set("t_br", py::round(b.clock));
    // deux brèches côte à côte : la batterie de brèche passe une fois au pan voisin, du côté qui lui fait face
    let da = 2.0 * std::f64::consts::PI / BT::BREACH_SECT as f64;
    for (uid, aim) in mem.get("batter").or(Val::dict()).items() {
        let q = mem.at("post").get(&uid);
        if aim.len() == 2 && q.truthy() && _d2(aim.atf(0), aim.atf(1), bx, by) < sq(120.0) {
            let (r, a0) = (py::hypot(aim.atf(0) - px, aim.atf(1) - py_), (aim.atf(1) - py_).atan2(aim.atf(0) - px));
            let pts: Vec<(f64, f64)> =
                [1.0, -1.0].iter().map(|k| (px + (a0 + k * da).cos() * r, py_ + (a0 + k * da).sin() * r)).collect();
            let (x, y) = py::min_by_key(pts, |c| _d2(c.0, c.1, q.atf(0), q.atf(1))).unwrap();
            mem.at("batter").set(&uid, list![py::round(x), py::round(y), 1]);
        }
    }
    _note(b, mem, "une brèche est ouverte : les colonnes d'assaut s'y portent.");
    true
}

/// Python (ai.py, l. 3524-3730) : `def _think_place_att(b, side, mem, L, us, foes, sit, want, busy)`
/// `mem.setdefault('walled', any(…))`. `keep = min([...] or [None], key=lambda v: v and d2)` : None si personne.
/// `rank` : ids des 'assaut' triés par `_quality` décroissante (`py::sorted_by_key_rev`).
pub fn _think_place_att(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val, sit: &Val, want: &Val, busy: &Val) {
    let pl = b.place_info();
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    let roles = mem.at("role");
    let now = b.clock;
    let heart = mem.at("heart");
    let (hx, hy) = heart.xy();
    let (mut bout, mut bin_, div) = (mem.at("bout"), mem.at("bin"), mem.at("div"));
    let mut r_in = mem.get_or("r_in", pl.at("r")).f();
    let fd = mem.atf("fd");
    let walled_d = _walls(b).iter().any(|w| w.get("kind") != "barricade");
    let walled = mem.setdefault("walled", walled_d).truthy();
    let seen = sit.at("seen");
    _roles_update(b, side, mem, L, us, sit, &Val::None);
    if _aim_breach(b, mem, &pl) {
        (bout, bin_) = (mem.at("bout"), mem.at("bin"));
        r_in = mem.atf("r_in");
    }
    let mut ph = mem.ats("phase");
    if ph == "attente" {
        let txt = if walled {
            "l'artillerie ouvre le feu sur la brèche ; les colonnes attendent."
        } else {
            "l'artillerie bat les barricades et les maisons ; les colonnes attendent."
        };
        _set_phase(b, mem, "prepa", &Val::from(txt));
        ph = "prepa".to_string();
    }
    let mut t = now - mem.atf("t_phase");
    let assaut_de = |us: &Val| -> Vec<Val> { us.iter().filter(|u| dans(&roles.get(u.at("id")), &["assaut", "vague2"])).collect() };
    let hommes = |a: &[Val]| -> f64 { py::sum(a.iter().filter(|u| U::valid(u)).map(|u| u.atf("men"))) };
    let mut assault = assaut_de(us);
    let mut a_men = hommes(&assault);
    // (un village ne s'ouvre pas au canon : préparation courte, et pas d'attente de brèche)
    let prep = L.atf("assault_prep") * (if ph == "regroupe" { 0.6 } else { 1.0 }) * (if walled { 1.0 } else { 0.5 });
    if ph == "prepa" || ph == "regroupe" {
        if ph == "regroupe" {
            _wave(mem, us); // (les ralliés rejoignent la vague à mesure qu'ils se reforment)
            assault = assaut_de(us);
            a_men = hommes(&assault);
        }
        let mut ready = t >= prep;
        let few = ph == "regroupe" && a_men < 0.5 * mem.get_or("n0", a_men).f();
        if ready && few && t < prep * 2.0 {
            ready = false; // trop peu de monde pour un nouvel assaut : on attend que les fuyards se rallient
        }
        if L.ati("n") == 2 && ready && t < prep * 2.0 {
            let near: Vec<Val> = seen
                .iter()
                .filter(|e| _d2(e.atf("x"), e.atf("y"), bout.atf(0), bout.atf(1)) < sq(260.0) && e.at("cls") == "inf")
                .collect();
            if !near.is_empty() && py::sum(near.iter().map(|e| e.atf("morale"))) / near.len() as f64 > 82.0 {
                ready = false; // les défenseurs de la brèche tiennent encore : on pilonne
            }
        }
        let guns = us.iter().any(|u| u.at("cls") == "artillerie" && U::valid(&u));
        if ready && guns && walled && L.ati("n") >= 1 && _breaches(b).is_empty() && t < prep * BREACH_WAIT {
            ready = false; // pas encore de brèche : les canons battent le rempart avant qu'on escalade
        }
        let tb_ = mem.get("t_breach");
        if ph == "prepa" && tb_.is_some() && tb_ >= mem.at("t_phase") && now - tb_.f() > 120.0 && t > prep * 0.8 {
            // une brèche vient de s'ouvrir : on s'y porte sans attendre la fin de la préparation (mais pas avant que
            // les canons aient usé ses défenseurs)
            ready = true;
        }
        if !guns && t > 120.0 {
            ready = true;
        }
        if ready && (b.time_left() < 1800.0 || few) {
            let txt = if few {
                "trop peu de troupes pour un nouvel assaut : on investit la place."
            } else {
                "trop tard pour donner l'assaut avant la nuit : on investit la place."
            };
            _set_phase(b, mem, "investi", &Val::from(txt));
            ph = "investi".to_string();
            t = 0.0;
        } else if ready {
            mem.set("t_breach", Val::None);
            mem.set("n_assault", py::round(pmax(1.0, a_men)));
            mem.setdefault("n0", mem.at("n_assault"));
            mem.set("t_wave", py::round(now));
            // les enfants perdus (les légers) partent en tête ; les colonnes les suivent (A3)
            let lead = us.iter().any(|u| roles.get(u.at("id")) == "avant" && U::valid(&u));
            mem.set("t_go", py::round(now + (if lead { L.atf("forlorn") } else { 0.0 })));
            let txt = if walled {
                "la brèche est praticable : les colonnes d'assaut s'élancent, la diversion attaque l'autre face."
            } else {
                "les colonnes d'assaut s'élancent sur les barricades, une seconde attaque par l'autre entrée."
            };
            _set_phase(b, mem, "assaut", &Val::from(txt));
            ph = "assaut".to_string();
            t = 0.0;
        }
    }
    if ph == "assaut" {
        // les fuyards ralliés au pied de la brèche y retournent sans attendre (Badajoz, Saint-Sébastien) ; assaut
        // repoussé, ou assaut général décidé quand tout piétine (_decide_withdraw) : on se regroupe sous les canons, et
        // les troupes ralliées depuis repartent avec la vague suivante (ASSAULT_WAVES au plus) ; plus de vague : on
        // investit la place
        _wave(mem, us);
        assault = assaut_de(us);
        a_men = hommes(&assault);
        let ga = mem.get("general_assault");
        let wave = a_men < 0.35 * mem.get_or("n_assault", if a_men != 0.0 { a_men } else { 1.0 }).f() && sit.atf("ratio") > 0.9;
        let left = L.ati("n") >= 1 && mem.get_or("waves", 0) < L.get_or("waves", ASSAULT_WAVES);
        let stuck = t > 3600.0; // (une heure de combat dans la place sans la prendre : l'assaut a échoué)
        if t > 300.0 && left && (wave || stuck || (ga.truthy() && ga != mem.get("ga_wave"))) {
            mem.set("ga_wave", ga);
            mem.set("waves", mem.get_or("waves", 0) + 1i64);
            _wave(mem, us);
            let txt = if wave {
                "l'assaut est repoussé : on se regroupe sous la protection des canons."
            } else {
                "l'assaut piétine : on regroupe toutes les troupes pour un assaut général."
            };
            _set_phase(b, mem, "regroupe", &Val::from(txt));
            ph = "regroupe".to_string();
        } else if t > 300.0 && !left && (wave || stuck || a_men < 0.2 * mem.get_or("n_assault", 1).f()) {
            _set_phase(b, mem, "investi", &Val::from("l'assaut est repoussé : on investit la place, les batteries battent toujours le rempart."));
            ph = "investi".to_string();
            t = 0.0;
        }
    }
    if ph == "investi" {
        // (A7) une brèche neuve : un dernier assaut ; sinon on se retire dans ses lignes
        // (et la garnison épuisée, la brèche ouverte, on la presse encore : normal une fois, difficile deux)
        let fresh = mem.get_or("t_br", -1) > mem.get_or("t_wave", 0) && mem.get_or("bonus", 0) < L.at("bonus_wave");
        let strong = sit.atf("ratio") >= 1.5 && !_breaches(b).is_empty() && mem.get_or("extra", 0) < L.at("n");
        if (fresh || strong) && b.time_left() >= 1800.0 {
            let k = if fresh { "bonus" } else { "extra" };
            mem.set(k, mem.get_or(k, 0) + 1i64);
            _wave(mem, us);
            let txt = if fresh {
                "une nouvelle brèche est praticable : on prépare un nouvel assaut.".to_string()
            } else {
                format!("la garnison est épuisée (rapport de forces vu {:.2}) : on prépare un nouvel assaut.", sit.atf("ratio"))
            };
            _set_phase(b, mem, "regroupe", &Val::from(txt));
        } else {
            let batter = mem.get("batter").or(Val::dict());
            let bat = us.iter().any(|u| batter.has(u.at("id")) && U::valid(&u) && u.atf("ammo") >= 0.1 * u.atf("ammo0"));
            let spent = !walled || !bat || mem.get_or("bonus", 0) >= L.at("bonus_wave");
            let why = if b.time_left() < 2400.0 {
                Some("la nuit vient : on rentre dans les tranchées.")
            } else if t > (if spent { 1800.0 } else { 3600.0 }) {
                Some("l'assaut a échoué : on se retire dans les lignes.")
            } else {
                None
            };
            if let Some(why) = why {
                b.withdraw(side);
                _note(b, mem, why);
                return;
            }
        }
    }
    let assault_v: Val = assault.iter().cloned().collect();
    let lg = _lodge(b, side, mem, L, us, sit, &assault_v, walled, &ph);
    let t_go = mem.get_or("t_go", 0).f();
    let rank = Val::dict();
    let tri = py::sorted_by_key_rev(us.iter().filter(|u| roles.get(u.at("id")) == "assaut").collect(), |u| _quality(u));
    for (k, u) in tri.iter().enumerate() {
        rank.set(u.at("id"), k);
    }
    // (le plus proche du cœur s'y tient, les autres nettoient les maisons alentour)
    let keep = py::min_by_key(
        assault.iter().filter(|u| U::valid(u) && u.at("id") != lg).cloned(),
        |v| _d2(v.atf("x"), v.atf("y"), hx, hy),
    )
    .unwrap_or(Val::None);
    for u in us.iter() {
        let uid = u.at("id");
        let r = roles.get(&uid);
        let p = mem.at("post").get(&uid);
        if uid == lg {
            // le logement tient la brèche, retranché (ordre « tenir »), quoi qu'il arrive à l'assaut
            let (x, y) = (mem.at("lodge").atf(1), mem.at("lodge").atf(2));
            if _d2(u.atf("x"), u.atf("y"), x, y) < sq(25.0) && !dans(&u.at("state"), &["melee", "charge"]) {
                let o = u.at("order");
                if !(o.truthy() && o.get("kind") == "hold") && !u.atb("path") {
                    b.order(side, &ids(&u), "hold", "ia", &dict! {});
                }
                busy.push(uid.clone()); // (il ne sort pas charger : il garde ce qui est pris)
            } else {
                want.set(&uid, list![x, y, fd, "ligne", false]);
            }
            continue;
        }
        if dans(&r, &["assaut", "vague2"]) {
            // deux colonnes de front par brèche (un passage étroit), les suivantes une minute après
            let lag = if r == "assaut" { (60 * py::floordiv_i(rank.get_or(&uid, 0).i(), 2)) as f64 } else { 150.0 };
            if ph != "assaut" || now < t_go + lag {
                if p.truthy() {
                    want.set(&uid, list![p.at(0), p.at(1), p.at(2), "colonne", false]);
                }
                continue;
            }
            let d_c = py::hypot(u.atf("x") - px, u.atf("y") - py_);
            if d_c < r_in - 20.0 {
                // dans la place : on nettoie les maisons autour du cœur (le réduit tombe quand plus personne ne le tient)
                // (tous ceux qui le gardent, cavaliers compris : un seul défenseur debout près du réduit suffit à le
                // tenir ; et le feu seul ne chasse personne des maisons : de près, on y entre à la baïonnette)
                let hold: Vec<Val> = seen
                    .iter()
                    .filter(|e| {
                        dans(&e.at("cls"), &["inf", "artillerie", "cavalerie"])
                            && U::valid(e)
                            && _d2(e.atf("x"), e.atf("y"), hx, hy) < sq(BT::HEART_FREE)
                    })
                    .collect();
                let e = py::min_by_key(hold.into_iter(), |f| d2u(f, &u)).unwrap_or(Val::None);
                let bold = e.is_some() && (u.atf("morale") >= 60.0 || (u.atf("morale") >= 50.0 && e.atf("morale") < 40.0));
                let close = bold && d2u(&e, &u) < sq(130.0);
                if e.truthy()
                    && U::valid(&u)
                    && !dans(&u.at("state"), &["melee", "charge"])
                    && u.atf("busy") <= 0.0
                    && (!u.is(&keep) || close)
                {
                    if bold && !close {
                        want.set(&uid, list![e.at("x"), e.at("y"), fd, "colonne", false]); // on marche sur eux, pour la baïonnette
                        continue;
                    }
                    let kind = if close { "charge" } else { "attack" };
                    // (une charge arrêtée court laisse son ordre : on la relance)
                    if close || u.at("target") != e.at("id") || u.at("order").or(Val::dict()).get("kind") != kind {
                        b.order(side, &ids(&u), kind, "ia", &dict! {"target" => e.at("id")});
                    }
                    busy.push(uid.clone());
                    let txt = format!("combat de rue : {} attaque les maisons autour du cœur de la place.", u.at("name"));
                    _note_once(b, mem, "rues", &txt, 1800.0);
                    continue;
                }
                want.set(&uid, list![heart.at(0), heart.at(1), fd, "colonne", false]);
            } else if _d2(u.atf("x"), u.atf("y"), bout.atf(0), bout.atf(1)) < sq(70.0) || d_c < r_in + 30.0 {
                want.set(&uid, list![bin_.at(0), bin_.at(1), fd, "colonne", true]);
            } else {
                let run = _d2(u.atf("x"), u.atf("y"), bout.atf(0), bout.atf(1)) < sq(260.0);
                let form = if L.at("n").truthy() || !run { Val::from("colonne") } else { Val::None };
                want.set(&uid, list![bout.at(0), bout.at(1), fd, form, run]);
            }
        } else if r == "diversion" {
            let a = (div.atf(1) - py_).atan2(div.atf(0) - px);
            let pi = std::f64::consts::PI;
            if ph == "assaut" && !walled && t >= 120.0 && mem.get("din").truthy() {
                // village : une vraie seconde attaque par l'autre entrée (Aspern, Plancenoit)
                let (din, rd) = (mem.at("din"), mem.get_or("r_d", r_in).f());
                let d_c = py::hypot(u.atf("x") - px, u.atf("y") - py_);
                let d2div = _d2(u.atf("x"), u.atf("y"), div.atf(0), div.atf(1));
                if d_c < rd - 20.0 {
                    want.set(&uid, list![heart.at(0), heart.at(1), a + pi, "colonne", false]);
                } else if d_c < rd + 30.0 || d2div < sq(70.0) {
                    want.set(&uid, list![din.at(0), din.at(1), a + pi, "colonne", true]);
                } else {
                    want.set(&uid, list![div.at(0), div.at(1), a + pi, "colonne", d2div < sq(260.0)]);
                }
                let txt = format!("seconde colonne d'assaut : {} attaque par l'autre entrée.", u.at("name"));
                _note_once(b, mem, "div2", &txt, 3600.0);
            } else if ph == "assaut" || ((ph == "prepa" || ph == "regroupe") && t > prep - L.atf("div_lead")) {
                let (mut x, mut y) = div.xy();
                if walled {
                    // fausse attaque par le feu, à bonne portée du mur : elle fixe les défenseurs de ce rempart
                    let rr = mem.get_or("r_d", r_in).f() + 0.9 * b.ranges(&u).0 as f64;
                    (x, y) = _clamp(px + a.cos() * rr, py_ + a.sin() * rr, 30.0);
                }
                want.set(&uid, list![x, y, a + pi, if u.atb("light") { "tirailleurs" } else { "ligne" }, false]);
            } else if p.truthy() {
                want.set(&uid, list![p.at(0), p.at(1), p.at(2), Val::None, false]);
            }
        } else if r == "avant" && p.truthy() {
            if ph == "assaut" && L.at("forlorn").truthy() {
                // les enfants perdus : les légers courent les premiers à l'entrée de la brèche
                want.set(&uid, list![bout.at(0), bout.at(1), fd, "tirailleurs", true]);
                let txt = if walled {
                    format!("les enfants perdus ({}) se jettent les premiers sur la brèche.", u.at("name"))
                } else {
                    format!("les enfants perdus ({}) se jettent les premiers sur les barricades.", u.at("name"))
                };
                _note_once(b, mem, "enfants", &txt, 3600.0);
            } else if ph == "assaut" {
                let (x, y) = (bout.atf(0) + fd.cos() * -90.0, bout.atf(1) + fd.sin() * -90.0);
                want.set(&uid, list![x, y, fd, "tirailleurs", false]);
            } else {
                want.set(&uid, list![p.at(0), p.at(1), p.at(2), "tirailleurs", false]);
            }
        } else if dans(&r, &["res", "garde"]) && p.truthy() {
            want.set(&uid, list![p.at(0), p.at(1), p.at(2), if r == "res" { "colonne" } else { "ligne" }, false]);
        }
    }
    // au cœur : les premiers arrivés tiennent la place
    for u in &assault {
        if U::valid(u) && _d2(u.atf("x"), u.atf("y"), hx, hy) < sq(60.0) && !mem.at("notes").get("coeur").truthy() {
            mem.at("notes").set("coeur", 1);
            _note(b, mem, &format!("{} atteint le cœur de la place.", u.at("name")));
        }
    }
}

/// Logement dans la brèche (normal, difficile ; à la Vauban) : la brèche emportée — des nôtres au débouché, plus un
/// défenseur dessus —, un bataillon d'assaut s'y loge et s'y retranche derrière des gabions et des sacs à terre
/// (battle.LOGEMENT_K, après battle.ENTRENCH_T à l'arrêt) pendant que les autres poussent vers le cœur ; il garde la
/// brèche si l'assaut reflue. Perdu (en déroute), on en loge un autre quand la brèche est de nouveau à nous. → id du
/// logement ou None.
///
/// Python (ai.py, l. 3733-3764) : `def _lodge(b, side, mem, L, us, sit, assault, walled, ph)`
/// assault : liste d'unités ; walled : `bool(mem['walled'])`. Rend l'id du logement ou None. `lodged` est
/// b.spec['logement'] (le même objet : battle le lit).
pub fn _lodge(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, sit: &Val, assault: &Val, walled: bool, ph: &str) -> Val {
    let lg = mem.get("lodge");
    let lodged = b.spec.setdefault("logement", list![]);
    if lg.truthy() {
        let u = b.unit(&lg.at(0));
        if u.is_some() && U::valid(&u) && dans(&mem.at("role").get(u.at("id")), &["assaut", "vague2"]) {
            return u.at("id");
        }
        mem.set("lodge", Val::None);
        if lodged.has(lg.at(0)) {
            lodged.remove(&lg.at(0));
        }
        _note(b, mem, "le logement de la brèche est perdu.");
    }
    if !walled || L.ati("n") < 1 || ph != "assaut" {
        return Val::None;
    }
    let bin_ = mem.at("bin");
    let (bx, by) = bin_.xy();
    let near: Vec<Val> = assault
        .iter()
        .filter(|u| {
            U::valid(u) && !dans(&u.at("state"), &["melee", "charge"]) && u.atf("busy") <= 0.0 && _d2(u.atf("x"), u.atf("y"), bx, by) < sq(80.0)
        })
        .collect();
    if assault.iter().filter(|u| U::valid(u)).count() < 2
        || near.is_empty()
        || sit.at("seen").iter().any(|e| {
            U::valid(&e) && dans(&e.at("cls"), &["inf", "cavalerie"]) && _d2(e.atf("x"), e.atf("y"), bx, by) < sq(80.0)
        })
    {
        return Val::None;
    }
    let u = plus_proche(&near, bx, by);
    mem.set("lodge", list![u.at("id"), bin_.at(0), bin_.at(1)]);
    lodged.push(u.at("id"));
    _stat(mem, "logement", 1);
    let txt = format!("la brèche est emportée : {} s'y loge et se retranche (gabions, sacs à terre), les autres poussent vers le cœur.", u.at("name"));
    _note(b, mem, &txt);
    u.at("id")
}

/// Nouvelle vague : les troupes ralliées depuis la précédente (en réserve ou encore à se reformer) en sont.
///
/// Python (ai.py, l. 3767-3772) : `def _wave(mem, us)`
pub fn _wave(mem: &Val, us: &Val) {
    let (roles, was) = (mem.at("role"), mem.get_or("was", Val::dict()));
    for u in us.iter() {
        let r = roles.get(u.at("id"));
        if (r == "rallie" || (r == "res" && was.has(u.at("id")))) && u.at("state") == "repos" {
            roles.set(u.at("id"), "vague2");
        }
    }
}
