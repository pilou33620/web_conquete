//! Porte game/tactics/ai.py, lignes 1295 à 2005 : réflexion ; réflexes ; réflexion lourde.
//! Conventions : l'en-tête de ai/mod.rs. Petites aides privées en tête (ce que le Python écrit en ligne).

use super::*;

/// `max(a, b)` de Python : a, sauf si b est plus grand (le premier gagne).
fn pmax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// `min(a, b)` de Python : a, sauf si b est plus petit.
fn pmin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
/// `round(v, n)` : un entier reste un entier (Python), un flottant est arrondi à n décimales.
fn rnd(v: &Val, n: i32) -> Val {
    match v {
        Val::Float(f) => Val::Float(py::round_n(*f, n)),
        _ => Val::Int(v.i()),
    }
}
/// `round(v)` : un entier.
fn rnd0(v: &Val) -> Val {
    match v {
        Val::Float(f) => Val::Int(py::round(*f)),
        _ => Val::Int(v.i()),
    }
}
/// `v in ('a', 'b', …)` pour des textes.
fn dans(v: &Val, l: &[&str]) -> bool {
    l.iter().any(|s| v == s)
}
/// `[u.id]`.
fn id1(u: &Val) -> Val {
    list![u.at("id")]
}
/// `(u.order or {}).get('kind')`.
fn okind(u: &Val) -> Val {
    let o = u.at("order");
    if o.truthy() {
        o.get("kind")
    } else {
        Val::None
    }
}
/// `_d2` entre deux unités.
fn d2u(a: &Val, b: &Val) -> f64 {
    _d2(a.atf("x"), a.atf("y"), b.atf("x"), b.atf("y"))
}
/// `math.atan2(b.y - a.y, b.x - a.x)` : l'angle de a vers b.
fn vers(a: &Val, b: &Val) -> f64 {
    (b.atf("y") - a.atf("y")).atan2(b.atf("x") - a.atf("x"))
}
/// `x ** 2` d'un rayon entier ou flottant (exact pour les rayons du Python).
fn sq(r: f64) -> f64 {
    py::pow(r, 2.0)
}
/// Le centre de la case c.
fn centre(c: i64) -> (f64, f64) {
    ((py::mod_i(c, COLS) as f64 + 0.5) * CELL as f64, (py::floordiv_i(c, COLS) as f64 + 0.5) * CELL as f64)
}

// ====================================================================== réflexion

/// Python (ai.py, l. 1296-1321) : `def think(battle, side, dt)`
/// Appelée par battle (_think) toutes les AI_DT : `crate::tactics::ai::think(self, side, AI_DT)`.
/// Tirage : `b.rng.random()` pour la gigue seulement si L['jitter'] est non nul.
pub fn think(b: &mut TacticalBattle, side: i64, dt: f64) {
    let _ = dt;
    if b.phase != "combat" {
        return;
    }
    let us = b.ai_units(side);
    if !us.truthy() {
        return;
    }
    let (L, lname) = _lvl(b, side);
    let mem = _mem(b, side);
    if b.withdrawing.at(side).truthy() {
        // le camp décroche : une arrière-garde couvre la retraite (les autres suivent les ordres du moteur)
        if L.atb("rg") && mem.get("role").truthy() && !dans(&mem.get("plan"), &["place", "assaut"]) {
            _rearguard(b, side, &mem, &L, &us);
        }
        return;
    }
    if !mem.get("role").truthy() {
        _adopt(b, side, &mem, &L, &lname, &us);
    }
    let era = _era(b, side);
    mem.setdefault("era", era); // (mémoire d'une ancienne sauvegarde)
    let foes = _picture(b, side, &mem);
    let now = b.clock;
    if now >= mem.get_or("rnext", 0.0).f() {
        mem.set("rnext", now + L.atf("reflex") - 0.01);
        _reflexes(b, side, &mem, &L, &us, &foes);
    }
    if now < mem.get_or("next", 0.0).f() {
        return;
    }
    let j = if L.at("jitter").truthy() { b.rng.random() * L.atf("jitter") } else { 0.0 };
    mem.set("next", now + L.atf("period") + j);
    _heavy(b, side, &mem, &L, &us, &foes);
}

/// Mémoire absente (bataille d'une ancienne sauvegarde, unités passées sous le contrôle de l'IA) : on reprend
/// la situation telle qu'elle est.
///
/// Python (ai.py, l. 1324-1365) : `def _adopt(b, side, mem, L, lname, us)`
/// `sum(L['halt']) / 2` : L['halt'] est un tuple de deux flottants.
pub fn _adopt(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, lname: &str, us: &Val) {
    mem.clear();
    let g = _groups(us);
    let era = _era(b, side);
    mem.update(&dict! {"v" => 1, "lvl" => lname, "role" => dict!{}, "lat" => dict!{}, "back" => dict!{},
        "wing" => dict!{}, "post" => dict!{}, "vu" => dict!{}, "vu0" => dict!{}, "sq" => dict!{}, "fm" => dict!{},
        "gslot" => dict!{}, "journal" => list![], "next" => 0.0, "rnext" => 0.0, "phase" => "attente",
        "t_phase" => b.clock, "t_bound" => 0.0, "notes" => dict!{}, "era" => era});
    mem.set("ann", py::round(_announced(b, side)));
    mem.set(
        "init",
        py::round(py::sum(us.iter().filter(|u| !dans(&u.at("cls"), &["general", "chariot"])).map(|u| u.atf("men0")))),
    );
    mem.set("halt_k", py::round_n(py::sum(L.at("halt").iter().map(|h| h.f())) / 2.0, 2));
    let pl = b.place_info();
    let plan = _choose_plan(b, side, mem, L, &g, &pl);
    mem.set("plan", plan.as_str());
    mem.set("plan0", plan.as_str());
    let label = PLAN_LABEL().at(plan.as_str());
    if plan == "assaut" {
        // assaut d'une place : le plan du déploiement (colonnes face à la brèche, seconde vague, diversion, canons),
        // chacun gardant sa place du moment pour poste (la bataille est engagée : b.deploy ne déplace plus personne).
        // (En assaut frontal, la ligne s'arrêtait hors de vue des défenseurs abrités et attendait la nuit.)
        _deploy_place_att(b, side, mem, L, &g, &pl);
        // la préparation d'artillerie compte depuis le début de la bataille, comme si l'IA l'avait menée (sinon une
        // reprise en plein combat repartait pour une heure de canonnade avant le premier assaut)
        mem.update(&dict! {"phase" => "prepa", "t_phase" => 0.0});
        _note(b, mem, &format!("l'IA reprend le commandement : {label}."));
        return;
    }
    let fd = b.front_dir(side);
    let mut combat: Vec<Val> = us.iter().filter(|u| dans(&u.at("cls"), &["inf", "cavalerie", "artillerie"])).collect();
    if combat.is_empty() {
        combat = us.vec();
    }
    let ax = py::sum(combat.iter().map(|u| u.atf("x"))) / combat.len() as f64;
    let ay = py::sum(combat.iter().map(|u| u.atf("y"))) / combat.len() as f64;
    mem.update(&dict! {"ax" => py::round_n(ax, 1), "ay" => py::round_n(ay, 1), "fd" => py::round_n(fd, 4),
        "mode" => if plan == "tenir" || plan == "place" { "poste" } else { "ligne" }});
    if pl.truthy() {
        mem.set("heart", b.objective().or(tup![pl.at("x"), pl.at("y")]).to_list());
        mem.set("r_in", pl.at("r"));
        mem.set("ring", _ring(b, &pl).iter().map(|r| if r.is_none() { Val::None } else { rnd0(&r) }).collect::<Val>());
        mem.set("breach", list![]);
    }
    mem.set("lat0", list![]);
    for u in us.iter() {
        _adopt_unit(mem, &u);
    }
    let roles = mem.at("role");
    let lats: Vec<f64> =
        mem.at("lat").items().into_iter().filter(|(k, _)| roles.get(k) == "ligne").map(|(_, v)| v.f().abs()).collect();
    let m = if lats.is_empty() { 100.0 } else { py::max_f(lats).unwrap() };
    mem.set("width", py::round(pmax(200.0, 2.0 * m + 120.0)));
    _note(b, mem, &format!("l'IA reprend le commandement : {label}."));
    if side == 1 && !pl.truthy() {
        _adopt_def(b, side, mem, L, us, &plan);
    }
}

/// « Finir automatiquement » en défense, la bataille engagée : les réglages du déploiement d'après la situation
/// présente, sans redéployer personne (les troupes s'y portent) : écran de tirailleurs, contre-pente, feu de salve,
/// feux croisés ; l'écran et les batteries des ailes seulement si l'ennemi est encore loin.
///
/// Python (ai.py, l. 1368-1403) : `def _adopt_def(b, side, mem, L, us, plan)`
/// `sorted(…, key=lat)` stable.
pub fn _adopt_def(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, plan: &str) {
    let (roles, fd, ax, ay) = (mem.at("role"), mem.atf("fd"), mem.atf("ax"), mem.atf("ay"));
    let era = mem.at("era").i();
    let line: Vec<Val> = us.iter().filter(|u| roles.get(&u.at("id")) == "ligne" && U::valid(u)).collect();
    if line.is_empty() {
        return;
    }
    let dl = py::sum(line.iter().map(|u| _rel(u.atf("x"), u.atf("y"), ax, ay, fd).0)) / line.len() as f64; // (profondeur de la ligne)
    let far = !b.visible_enemies(side).iter().any(|e| {
        U::valid(&e) && dans(&e.at("cls"), &["inf", "cavalerie"]) && line.iter().any(|u| d2u(&e, u) < sq(900.0))
    });
    if L.atb("screen") {
        for u in us.iter() {
            if roles.get(&u.at("id")) != "avant" || !U::valid(&u) {
                continue;
            }
            let (dep, lat) = _rel(u.atf("x"), u.atf("y"), ax, ay, fd);
            // (comme au déploiement)
            let d = if era != 0 { pmin(550.0, pmax(150.0, 1.6 * b.ranges(&u).0 as f64)) } else { 110.0 };
            if far && dep < dl + d - 50.0 {
                let (qx, qy) = _at(ax, ay, fd, dl + d, lat);
                let (mut x0, mut y0) = _clamp(qx, qy, 30.0);
                if L.at("terrain").truthy() {
                    (x0, y0) = _cover_spot(b, side, x0, y0, fd, 90.0 * L.atf("r_k"));
                }
                mem.at("post").set(&u.at("id"), list![py::round_n(x0, 1), py::round_n(y0, 1), py::round_n(fd, 3)]);
            }
            mem.setdefault("scr", dict! {}).set(&u.at("id"), list![0, 0]); // (_screen le replie aussitôt si l'ennemi est trop près)
        }
    }
    let line_v = Val::list(line.clone());
    if plan == "tenir" && L.atb("cp") && era == 1 {
        _reverse_slope(b, side, mem, L, &line_v, fd);
    }
    if plan != "harcelement" && L.atb("volley_def") && era < 2 {
        let ids: Val = line.iter().filter(|u| u.at("cls") == "inf").map(|u| u.at("id")).collect();
        b.order(side, &ids, "fire", "ia", &dict! {"mode" => "volley"});
    }
    let mlat = mem.at("lat");
    let arts = py::sorted_by_key(
        us.iter().filter(|u| roles.get(&u.at("id")) == "art" && U::valid(u)).collect(),
        |u: &Val| mlat.get_or(&u.at("id"), 0.0),
    );
    if plan == "tenir" && L.atb("xfire") && arts.len() >= 2 && far {
        // feux croisés : les batteries des ailes au bout de la ligne, pour prendre l'assaut d'écharpe
        let lats: Vec<Val> = line.iter().map(|u| mlat.get_or(&u.at("id"), 0.0)).collect();
        let lo = py::min_by_key(lats.iter().cloned(), |v| v.clone()).unwrap();
        let hi = py::max_by_key(lats.iter().cloned(), |v| v.clone()).unwrap();
        for (u, lat) in [(arts[0].clone(), lo), (arts[arts.len() - 1].clone(), hi)] {
            let (qx, qy) = _at(ax, ay, fd, dl - 20.0, lat.f());
            let (cx, cy) = _clamp(qx, qy, 30.0);
            mem.at("post").set(&u.at("id"), list![py::round_n(cx, 1), py::round_n(cy, 1), rnd(&mem.at("fd"), 3)]);
            mlat.set(&u.at("id"), rnd(&lat, 1));
        }
        _note(b, mem, "les batteries des ailes se portent au bout de la ligne pour croiser leurs feux.");
    }
}

/// Python (ai.py, l. 1406-1419) : `def _adopt_unit(mem, u)`
pub fn _adopt_unit(mem: &Val, u: &Val) {
    let mut role = match _cat(u) {
        "gen" => "gen",
        "wagon" => "wagon",
        "art" => "art",
        "cav" => "cav",
        "light" => "avant",
        _ => "ligne",
    };
    if mem.get("plan") == "place" && role == "ligne" {
        role = "mur";
    }
    let id = u.at("id");
    mem.at("role").set(&id, role);
    let (dep, lat) = _rel(u.atf("x"), u.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd"));
    mem.at("lat").set(&id, py::round_n(lat, 1));
    mem.at("back").set(&id, if role != "ligne" { py::round_n(-dep, 1) } else { 0.0 });
    mem.at("post").set(&id, list![rnd(&u.at("x"), 1), rnd(&u.at("y"), 1), rnd(&mem.at("fd"), 3)]);
    if role == "cav" {
        mem.at("wing").set(&id, if lat > 0.0 { 1 } else { -1 });
    }
    if role == "ligne" {
        mem.setdefault("lat0", list![]).push(py::round_n(lat, 1));
    }
}

/// Ce que le camp voit maintenant, et ce dont il se souvient (dernières positions, effectifs, état).
///
/// Python (ai.py, l. 1422-1432) : `def _picture(b, side, mem)`
/// Rend la liste `b.visible_enemies(side)` ; mem['vu'][id] = [x, y, t, hommes, cls, form, state, moral, dir, mitraille]
/// (entiers arrondis, `round(e.dir, 2)` → `py::round_n`) ; `(b.ranges(e)[2] or 0)`.
pub fn _picture(b: &mut TacticalBattle, side: i64, mem: &Val) -> Val {
    let now = py::round(b.clock);
    let (vu, vu0) = (mem.setdefault("vu", dict! {}), mem.setdefault("vu0", dict! {}));
    let foes = b.visible_enemies(side);
    for e in foes.iter() {
        let mit = if e.at("cls") == "artillerie" { b.ranges(&e).2.or(0) } else { Val::Int(0) };
        vu.set(
            &e.at("id"),
            list![rnd0(&e.at("x")), rnd0(&e.at("y")), now, rnd0(&e.at("men")), e.at("cls"), e.at("form"), e.at("state"),
                rnd0(&e.at("morale")), rnd(&e.at("dir"), 2), mit],
        );
        if !dans(&e.at("cls"), &["general", "chariot"]) && !vu0.has(&e.at("id")) {
            vu0.set(&e.at("id"), rnd0(&e.at("men0")));
        }
    }
    foes
}

/// Estimation des forces ennemies : ce qu'on a vu (sauf les troupes vues en déroute), et l'effectif annoncé des
/// unités jamais vues.
///
/// Python (ai.py, l. 1435-1441) : `def _foe_est(mem)`
/// Sommes d'entiers (mem) plus un flottant : `py::sum_v` ou somme entière, puis `+ unseen`.
pub fn _foe_est(mem: &Val) -> f64 {
    let (vu, vu0) = (mem.at("vu"), mem.at("vu0"));
    let known = py::sum_v(
        vu.items().into_iter().filter(|(k, v)| vu0.has(k) && !dans(&v.at(6), &["deroute", "hors"])).map(|(_, v)| v.at(3)),
    );
    let d = &mem.get_or("ann", 0) - &py::sum_v(vu0.values());
    let unseen = if d > Val::Float(0.0) { d } else { Val::Float(0.0) };
    (&known + &unseen).f()
}

/// Le gros de l'ennemi (infanterie et artillerie) d'après les repérages récents : [(id, x, y, cls, form)].
///
/// Python (ai.py, l. 1444-1453) : `def _body(b, mem, maxage=150.0)`
/// maxage : défaut 150.0. Parcourt mem['vu'] dans l'ordre d'insertion.
pub fn _body(b: &TacticalBattle, mem: &Val, maxage: f64) -> Vec<Repere> {
    let now = b.clock;
    let mut out = vec![];
    for (k, v) in mem.at("vu").items() {
        if now - v.at(2).f() > maxage || dans(&v.at(6), &["deroute", "hors"]) {
            continue;
        }
        if dans(&v.at(4), &["inf", "artillerie"]) {
            out.push((k, v.at(0).f(), v.at(1).f(), v.at(4).string(), v.at(5)));
        }
    }
    out
}

// ---------------------------------------------------------------------- réflexes

/// Python (ai.py, l. 1457-1473) : `def _reflexes(b, side, mem, L, us, foes)`
/// Tirage : `L['n'] or b.rng.random() < 0.5` : on ne tire que si L['n'] vaut 0 (facile).
pub fn _reflexes(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val) {
    let cavs: Val = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    for u in us.iter() {
        let st = u.at("state");
        if st == "deroute" {
            if L.at("n").truthy() || b.rng.random() < 0.5 {
                b.order(side, &id1(&u), "rally", "ia", &dict! {}); // le moteur refuse si l'ennemi est trop près
            }
            continue;
        }
        if u.at("cls") != "inf" || dans(&st, &["melee", "charge", "ralliement"]) {
            continue;
        }
        _square(b, side, mem, L, &u, &cavs, foes);
    }
    if L.atb("counter") && cavs.truthy() {
        _counter_charge(b, side, mem, us, &cavs, foes);
    }
    if L.atb("cav_opp") && !dans(&mem.get("plan"), &["place", "assaut"]) {
        _cav_opportunity(b, side, mem, L, us, foes);
    }
    if _dfn(side, mem) {
        _leash(b, side, mem, us, foes);
    }
}

/// Contre-attaque locale : on ne poursuit pas. Le bataillon dont la cible fuit, ou qui s'est porté à plus de 300 m
/// de son poste, revient prendre sa place dans la ligne (le poste reste son but).
///
/// Python (ai.py, l. 1476-1490) : `def _leash(b, side, mem, us, foes)`
pub fn _leash(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, foes: &Val) {
    let seen = dict! {};
    for e in foes.iter() {
        seen.set(&e.at("id"), e.clone());
    }
    let ca_t = mem.get("ca_t").or(dict! {});
    for u in us.iter() {
        // (seulement les contre-attaques locales : la réserve qui reprend un poste ou bouche une percée va au bout)
        if u.at("cls") != "inf" || u.at("state") != "charge" || b.clock - ca_t.get_or(&u.at("id"), -1e9).f() > 600.0 {
            continue;
        }
        let p = mem.at("post").get(&u.at("id"));
        if !p.truthy() {
            continue;
        }
        let e = seen.get(&u.at("target"));
        if (e.is_some() && dans(&e.at("state"), &["deroute", "hors"])) || _d2(u.atf("x"), u.atf("y"), p.at(0).f(), p.at(1).f()) > sq(300.0) {
            b.order(side, &id1(&u), "move", "ia", &dict! {"x" => p.at(0), "y" => p.at(1), "dir" => p.at(2)});
        }
    }
}

/// La cavalerie tombe sur l'infanterie qui charge les nôtres, sur celle qui est aux prises avec eux, et sur les
/// fuyards près de notre ligne : une troupe qui charge ne fait pas de feu de défense, une troupe en mêlée ne peut
/// former le carré (Waterloo : la brigade de l'Union sur le corps de d'Erlon). Pas sur une proie escortée.
///
/// Python (ai.py, l. 1493-1544) : `def _cav_opportunity(b, side, mem, L, us, foes)`
/// `held` : set des melee_with (appartenance seulement) ; `f is not e` → `!f.is(&e)` ; `mine.remove(u)` en cours de
/// parcours de `cand` (une liste à part).
pub fn _cav_opportunity(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val) {
    if !foes.iter().any(|e| e.at("cls") == "inf" && dans(&e.at("state"), &["charge", "melee", "deroute"])) {
        return;
    }
    let now = b.clock;
    let co = mem.setdefault("co_t", dict! {});
    let roles = mem.at("role");
    let mut mine: Vec<Val> = us
        .iter()
        .filter(|u| {
            u.at("cls") == "cavalerie"
                && roles.get(&u.at("id")) == "cav"
                && U::valid(u)
                && u.atf("busy") <= 0.0
                && !dans(&u.at("state"), &["charge", "melee", "ralliement"])
                && u.atf("morale") > 50.0
                && u.atf("fat") < 70.0
                && u.atf("men") > 0.35 * u.atf("men0")
                && now - co.get_or(&u.at("id"), -1e9).f() >= 120.0
        })
        .collect();
    if mine.is_empty() {
        return;
    }
    let ours: Vec<Val> = us.iter().filter(|o| dans(&o.at("cls"), &["inf", "artillerie"]) && U::valid(o)).collect();
    if ours.is_empty() {
        return;
    }
    let held = pyset![];
    for o in &ours {
        if o.at("state") == "melee" {
            held.push(o.at("melee_with"));
        }
    }
    let mut line: Vec<Val> = ours.iter().filter(|o| roles.get(&o.at("id")) == "ligne").cloned().collect();
    if line.is_empty() {
        line = ours.clone();
    }
    let e_inf: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "inf" && U::alive(e) && e.at("state") != "hors").collect();
    let e_cav: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    for e in &e_inf {
        let st = e.at("state");
        let what;
        if st == "charge" {
            // elle court droit sur l'un des nôtres
            if !ours.iter().any(|o| d2u(o, e) < sq(260.0) && _ang(e.atf("dir"), vers(e, o)) < 0.5) {
                continue;
            }
            what = "la colonne ennemie qui charge".to_string();
        } else if st == "melee" && held.has(&e.at("id")) {
            what = format!("le {}, aux prises avec notre infanterie", _foe(e));
        } else if st == "deroute" && line.iter().any(|o| d2u(o, e) < sq(300.0)) {
            what = format!("les fuyards du {}", _foe(e));
        } else {
            continue;
        }
        if e_inf.iter().any(|f| !f.is(e) && U::valid(f) && f.at("state") != "melee" && d2u(f, e) < sq(120.0)) {
            continue; // escortée : la fusillade de ses voisins viderait les selles
        }
        let cand = py::sorted_by_key(mine.iter().filter(|u| d2u(u, e) < sq(500.0)).cloned().collect(), |u: &Val| d2u(u, e));
        for u in &cand {
            if L.atb("cav_safe")
                && py::sum(e_cav.iter().filter(|c| c.atf("morale") > 50.0 && d2u(c, e) < sq(450.0)).map(|c| c.atf("men")))
                    > 0.7 * u.atf("men")
            {
                break;
            }
            if !_charge_ok(b, side, u, e) {
                continue;
            }
            b.order(side, &id1(u), "charge", "ia", &dict! {"target" => e.at("id")});
            co.set(&u.at("id"), py::round(now));
            if let Some(i) = mine.iter().position(|m| m.is(u)) {
                mine.remove(i);
            }
            _stat(mem, "opp", 1);
            let aile = WING().get_or(&mem.at("wing").get_or(&u.at("id"), 0), "la réserve");
            _note_once(
                b,
                mem,
                &format!("opp{}", u.at("id")),
                &format!("la cavalerie de {aile} ({}) charge au galop {what}.", u.at("name")),
                300.0,
            );
            break;
        }
        if mine.is_empty() {
            return;
        }
    }
}

/// Carré quand des cavaliers menacent ; on reprend sa formation quand ils s'éloignent. Pas de carré sous le fusil
/// de l'infanterie ennemie (à moins de 200 m), ni dans la mitraille d'une batterie ennemie connue, tant que les
/// cavaliers ne chargent pas cette troupe : le carré y serait fusillé sans pouvoir répondre. Des cavaliers qui
/// marchent vers nous ne menacent qu'à moins des trois quarts de sq_r (au pas, ils ne surprennent personne).
///
/// Python (ai.py, l. 1547-1592) : `def _square(b, side, mem, L, u, cavs, foes=())`
/// foes : défaut () → `&list![]`. Tirage : `b.rng.random() < L['sq_miss']` seulement si sq_miss est non nul (et
/// après le test « trop tard »). `_charge_ok(b, best.side, best, u)` : du point de vue des cavaliers.
pub fn _square(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, u: &Val, cavs: &Val, foes: &Val) {
    let now = b.clock;
    let (mut best, mut bd) = (Val::None, 1e9);
    for e in cavs.iter() {
        let d = py::hypot(e.atf("x") - u.atf("x"), e.atf("y") - u.atf("y"));
        if d < bd {
            best = e;
            bd = d;
        }
    }
    let sq_ = mem.at("sq");
    let ln = L.at("n").i();
    let sq_r = L.atf("sq_r");
    let mut want = false;
    if best.is_some() && bd < sq_r && !ROUGH.contains(&b.terrain_at(u.atf("x"), u.atf("y"))) {
        let coming = best.at("state") == "charge"
            || bd < sq_r * 0.5
            || (best.at("state") == "marche" && _ang(best.atf("dir"), vers(&best, u)) < 0.6 && (ln == 0 || bd < sq_r * 0.75));
        // (rochers, forêt, eau : pas de charge)
        want = coming && (ln == 0 || _charge_ok(b, best.ati("side"), &best, u));
        if want
            && ln >= 1
            && dans(&u.at("form"), &["ligne", "colonne"])
            && u.atf("busy") <= 0.0
            && u.atf("morale") >= (BT::FORMED + 10) as f64
            && u.atf("ammo") >= 1.0
            && _ang(u.atf("dir"), vers(u, &best)) < 1.0
        {
            // une ligne ferme qui voit venir la charge de face la reçoit par son feu (le moteur la repousse)
            want = false;
        }
    }
    let shot = ln >= 1
        && best.is_some()
        && !(best.at("state") == "charge" && best.at("target") == u.at("id"))
        && (foes.iter().any(|e| e.at("cls") == "inf" && U::valid(&e) && d2u(&e, u) < sq(200.0))
            || _gun_zones(b, mem, 300.0, &Val::None).iter().any(|(gx, gy, gr, _gid)| _d2(*gx, *gy, u.atf("x"), u.atf("y")) < gr * gr));
    if shot {
        want = false;
    }
    let forming = u.atf("busy") > 0.0 && u.at("next_form") == "carre";
    if want && u.at("form") != "carre" && !forming {
        if !L.atb("sq_late") && best.at("state") == "charge" && bd < 110.0 {
            return; // trop tard : pris en pleine manœuvre, ce serait pire
        }
        if L.atb("sq_miss") && b.rng.random() < L.atf("sq_miss") {
            return;
        }
        _form(b, side, u, "carre");
        sq_.set(&u.at("id"), py::round(now));
        if !mem.at("notes").getb("carre") {
            mem.at("notes").set("carre", 1);
            _note(b, mem, &format!("des cavaliers menacent : {} forme le carré.", u.at("name")));
        }
    } else if !want && (u.at("form") == "carre" || forming) {
        let far = best.is_none() || bd > sq_r * 0.9 || shot;
        if far && now - sq_.get_or(&u.at("id"), -999).f() > 40.0 {
            let role = mem.at("role").get(&u.at("id"));
            let back = if u.atb("light") {
                "tirailleurs"
            } else if dans(&role, &["res", "assaut", "vague2"]) {
                "colonne"
            } else {
                "ligne"
            };
            if _form(b, side, u, back) || (u.atf("busy") > 0.0 && u.at("next_form") == back) {
                sq_.pop(&u.at("id"));
            }
            mem.at("fm").set(&u.at("id"), py::round(now));
        }
    }
}

/// La charge peut-elle aller droit au but ? (le moteur charge en ligne droite ; rochers, eau, forêt l'arrêtent)
///
/// Python (ai.py, l. 1595-1606) : `def _charge_ok(b, side, u, e)`
pub fn _charge_ok(b: &mut TacticalBattle, side: i64, u: &Val, e: &Val) -> bool {
    let mc = if u.at("cls") == "cavalerie" {
        "cav"
    } else if u.atb("light") {
        "light"
    } else {
        "inf"
    };
    if mc == "cav" && (e.at("form") == "maisons" || _barr_devant(b, e, u).is_some()) {
        return false; // (des cavaliers ne chargent pas des maisons, ni une troupe derrière sa barricade : _barrage)
    }
    let (ux, uy) = (u.atf("x"), u.atf("y"));
    let (dx, dy) = (e.atf("x") - ux, e.atf("y") - uy);
    let n = py::int(py::floordiv_f(py::hypot(dx, dy), 25.0)).max(1);
    for k in 1..n {
        let (x, y) = (ux + dx * k as f64 / n as f64, uy + dy * k as f64 / n as f64);
        if !b.passable(x, y, mc, side) || (mc == "cav" && [T_FORET_T, T_MARAIS_T, T_ROCHE].contains(&b.terrain_at(x, y))) {
            return false;
        }
    }
    true
}

/// La cavalerie ennemie qui charge nos troupes, ou qui s'y est engagée, est chargée à son tour : avec assez
/// d'escadrons pour l'emporter, et pas sous le nez de son infanterie.
///
/// Python (ai.py, l. 1609-1640) : `def _counter_charge(b, side, mem, us, cavs, foes)`
pub fn _counter_charge(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, cavs: &Val, foes: &Val) {
    let mut mine: Vec<Val> = us
        .iter()
        .filter(|u| {
            u.at("cls") == "cavalerie"
                && U::valid(u)
                && !dans(&u.at("state"), &["charge", "melee"])
                && u.atf("busy") <= 0.0
                && u.atf("morale") > 45.0
                && u.atf("men") > 0.3 * u.atf("men0")
                && !(u.at("order").truthy() && u.at("order").get("kind") == "attack" && u.at("path").truthy())
        })
        .collect();
    if mine.is_empty() {
        return;
    }
    let ours: Vec<Val> = us.iter().filter(|o| dans(&o.at("cls"), &["inf", "artillerie"]) && U::alive(o)).collect();
    let e_inf: Vec<Val> = foes.iter().filter(|f| f.at("cls") == "inf" && U::valid(f)).collect();
    for e in cavs.iter() {
        if !dans(&e.at("state"), &["melee", "charge"]) || mine.is_empty() {
            continue;
        }
        if !ours.iter().any(|o| d2u(o, &e) < sq(300.0)) {
            continue;
        }
        if e_inf.iter().any(|f| d2u(f, &e) < sq(120.0)) {
            continue; // escortée par son infanterie : nos cavaliers s'y feraient massacrer
        }
        let foe_men = py::sum(cavs.iter().filter(|c| d2u(c, &e) < sq(220.0)).map(|c| c.atf("men")));
        let cand = py::sorted_by_key(mine.iter().filter(|c| d2u(c, &e) < sq(600.0)).cloned().collect(), |c: &Val| d2u(c, &e));
        let (mut got, mut men): (Vec<Val>, f64) = (vec![], 0.0);
        for c in cand {
            if _charge_ok(b, side, &c, &e) {
                men += c.atf("men");
                got.push(c);
                if men >= 0.8 * foe_men {
                    break;
                }
            }
        }
        if got.is_empty() || men < 0.55 * foe_men {
            continue;
        }
        for c in &got {
            b.order(side, &id1(c), "charge", "ia", &dict! {"target" => e.at("id")});
            if let Some(i) = mine.iter().position(|m| m.is(c)) {
                mine.remove(i);
            }
        }
        let noms: Vec<String> = got.iter().map(|c| c.ats("name")).collect();
        _note_once(
            b,
            mem,
            &format!("cc{}", e.at("id")),
            &format!(
                "{} contre-charge{} les cavaliers ennemis ({}).",
                noms.join(" et "),
                if got.len() > 1 { "nt" } else { "" },
                _foe(&e)
            ),
            300.0,
        );
    }
}

// ---------------------------------------------------------------------- réflexion lourde

/// Python (ai.py, l. 1644-1665) : `def _heavy(b, side, mem, L, us, foes)`
/// `want = {}` (dict), `busy = set()` (`pyset![]`), passés aux fonctions de chaque arme.
pub fn _heavy(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val, foes: &Val) {
    for u in us.iter() {
        if !mem.at("role").has(&u.at("id")) {
            _adopt_unit(mem, &u);
        }
    }
    let sit = _situation(b, mem, us, foes);
    if _decide_withdraw(b, side, mem, L, &sit) {
        return;
    }
    let want = dict! {};
    let busy = pyset![];
    let plan = mem.at("plan");
    if plan == "place" {
        _think_place_def(b, side, mem, L, us, foes, &sit, &want, &busy);
    } else if plan == "assaut" {
        _think_place_att(b, side, mem, L, us, foes, &sit, &want, &busy);
    } else {
        _think_field(b, side, mem, L, us, foes, &sit, &want, &busy);
    }
    _support(b, side, mem, L, us, foes, &sit, &want);
    _cavalry(b, side, mem, L, us, foes, &sit, &want, &busy);
    _bayonets(b, side, mem, L, us, foes, &sit, &busy);
    _artillery(b, side, mem, L, us, foes, &sit, &want, &busy);
    _abris(b, side, mem, us, foes, &busy);
    _apply(b, side, mem, us, &want, &busy);
}

/// Dans les maisons, en chemin pour y entrer ou à sa barricade : l'IA ne la déplace plus (elle n'en sort que pour
/// charger, se replier ou fuir).
///
/// Python (ai.py, l. 1668-1671) : `def _tenue(u)`
pub fn _tenue(u: &Val) -> bool {
    u.at("form") == "maisons" || dans(&okind(u), &["maisons", "barricade"])
}

/// La barricade dressée pendant la bataille juste devant e (à trois cases au plus) face à u, ou None.
///
/// Python (ai.py, l. 1674-1682) : `def _barr_devant(b, e, u)`
/// Rend la barricade (dict de b.barr : u, s, pts, c) ou None. `b.cell(…)` → `TacticalBattle::cell(…)` ; `c in b.barr_prev`
/// → `b.barr_prev.has(c)`. `L` est ici une longueur locale (pas les réglages).
pub fn _barr_devant(b: &TacticalBattle, e: &Val, u: &Val) -> Val {
    let (ex, ey) = (e.atf("x"), e.atf("y"));
    let (dx, dy) = (u.atf("x") - ex, u.atf("y") - ey);
    let mut l = py::hypot(dx, dy);
    if l == 0.0 {
        l = 1.0;
    }
    for k in [1.0, 2.0, 3.0] {
        let c = TacticalBattle::cell(ex + dx / l * CELL as f64 * k, ey + dy / l * CELL as f64 * k);
        if b.barr_prev.has(c) {
            return b
                .barr
                .iter()
                .find(|r| r.at("c").iter().any(|cc| cc.at(0) == c))
                .unwrap_or(Val::None);
        }
    }
    Val::None
}

/// De (x, y) à e, aucune case de barricade debout (tous les 10 m).
///
/// Python (ai.py, l. 1685-1688) : `def _barr_libre(b, x, y, e)`
pub fn _barr_libre(b: &TacticalBattle, x: f64, y: f64, e: &Val) -> bool {
    let (ex, ey) = (e.atf("x"), e.atf("y"));
    let n = py::int(py::floordiv_f(py::hypot(ex - x, ey - y), 10.0)).max(1);
    !(0..n + 1).any(|k| {
        b.barr_prev.has(TacticalBattle::cell(x + (ex - x) * k as f64 / n as f64, y + (ey - y) * k as f64 / n as f64))
    })
}

/// u veut aborder e : 'ok' (pas de barricade devant e), un point (x, y) d'où l'aborder sans la franchir (par la
/// brèche que les canons y ont ouverte, sinon par un bout, à hauteur de e, quand elle ne ferme pas le passage), 'front'
/// (l'infanterie, à BARR_SUP contre un au corps à corps, la barricade comptée) ou None (on attend).
///
/// Python (ai.py, l. 1691-1718) : `def _barrage(b, side, u, e, ratio=0.0)`
/// ratio : défaut 0.0. Rend 'ok', `tup![x, y]` (arrondis au dixième), 'front' ou None ; les appelants testent
/// `isinstance(how, tuple)` → `how.is_tuple()`. `c % COLS`, `c // COLS` : entiers positifs. `U::footprint(&e).0`.
pub fn _barrage(b: &mut TacticalBattle, side: i64, u: &Val, e: &Val, ratio: f64) -> Val {
    let r = _barr_devant(b, e, u);
    if r.is_none() {
        return Val::from("ok");
    }
    let mc = if u.at("cls") == "cavalerie" {
        "cav"
    } else if u.atb("light") {
        "light"
    } else {
        "inf"
    };
    let (p1, p2) = r.at("pts").pair();
    let ((x1, y1), (x2, y2)) = (p1.xy(), p2.xy());
    let mut l = py::hypot(x2 - x1, y2 - y1);
    if l == 0.0 {
        l = 1.0;
    }
    let (ux, uy) = ((x2 - x1) / l, (y2 - y1) / l);
    let (ex, ey) = (e.atf("x"), e.atf("y"));
    let mut spots: Vec<(f64, f64)> = vec![];
    for cp in r.at("c").iter() {
        let c = cp.at(0).i();
        if !b.barr_prev.has(c) {
            // (la brèche : on s'y présente dans l'axe, pour y passer)
            let (gx, gy) = centre(c);
            let mut d = py::hypot(gx - ex, gy - ey);
            if d == 0.0 {
                d = 1.0;
            }
            spots.push((gx + (gx - ex) / d * BARR_OFF, gy + (gy - ey) / d * BARR_OFF));
        }
    }
    if spots.is_empty() {
        let w = U::footprint(e).0;
        for s in [-1.0, 1.0] {
            // (au bout, à hauteur de la troupe : on la prend de flanc)
            spots.push((ex + ux * s * (w / 2.0 + BARR_OFF), ey + uy * s * (w / 2.0 + BARR_OFF)));
        }
    }
    let (uxx, uyy) = (u.atf("x"), u.atf("y"));
    for (x, y) in py::sorted_by_key(spots, |p| _d2(p.0, p.1, uxx, uyy)) {
        if 0.0 < x
            && x < W as f64
            && 0.0 < y
            && y < H as f64
            && b.passable(x, y, mc, side)
            && _barr_libre(b, x, y, e)
            && b.path_cost(uxx, uyy, x, y, mc, side).is_some()
        {
            return tup![py::round_n(x, 1), py::round_n(y, 1)];
        }
    }
    if u.at("cls") == "inf" && ratio >= BARR_SUP * 1.5 {
        return Val::from("front");
    }
    Val::None
}

/// La barricade ennemie sans brèche qui arrête notre infanterie (à BARR_GUN devant elle), à portée efficace du
/// canon u : (x, y) de sa case debout la plus proche de son milieu, ou None.
///
/// Python (ai.py, l. 1721-1741) : `def _barr_cible(b, side, u, ours, e_r)`
/// ours : liste d'unités ; e_r : portée efficace de u. Rend `tup![x, y]` (centre de la case) ou None (`best and best[1]`).
/// `min(cells, key=…)` → `py::min_by_key`.
pub fn _barr_cible(b: &TacticalBattle, side: i64, u: &Val, ours: &Val, e_r: f64) -> Val {
    let mut best: Option<(f64, (f64, f64))> = None;
    let (ux, uy) = (u.atf("x"), u.atf("y"));
    for r in b.barr.iter() {
        let owner = b.by_id.get(&r.at("u"));
        let cells: Vec<i64> = r.at("c").iter().map(|cp| cp.at(0).i()).collect();
        if owner.is_none() || owner.at("side") == side || !cells.iter().all(|c| b.barr_prev.has(*c)) {
            continue;
        }
        let (p1, p2) = r.at("pts").pair();
        let ((x1, y1), (x2, y2)) = (p1.xy(), p2.xy());
        let (mx_, my_) = ((x1 + x2) / 2.0, (y1 + y2) / 2.0);
        let (nx, ny) = (y2 - y1, -(x2 - x1)); // (devant elle : là où regardait la troupe qui l'a dressée)
        if _d2(mx_, my_, ux, uy) > e_r * e_r
            || !ours.iter().any(|o| {
                o.at("cls") == "inf"
                    && _d2(o.atf("x"), o.atf("y"), mx_, my_) < sq(BARR_GUN)
                    && (o.atf("x") - mx_) * nx + (o.atf("y") - my_) * ny > 0.0
            })
        {
            continue;
        }
        let d = _d2(mx_, my_, ux, uy);
        if best.is_none() || d < best.unwrap().0 {
            let c = py::min_by_key(cells.iter().copied(), |c| {
                let (cx, cy) = centre(*c);
                _d2(cx, cy, mx_, my_)
            })
            .unwrap();
            best = Some((d, centre(c)));
        }
    }
    match best {
        Some((_, (x, y))) => tup![x, y],
        None => Val::None,
    }
}

/// Le défenseur se met à l'abri : la garnison dans les maisons, l'infanterie menacée par des cavaliers derrière une
/// barricade (voir ABRI_*).
///
/// Python (ai.py, l. 1744-1770) : `def _abris(b, side, mem, us, foes, busy)`
/// `b.by_id[r['u']]` : KeyError si l'unité manque (comme le Python). `not b.why_barricade(u)` → `.is_empty()`.
pub fn _abris(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, foes: &Val, busy: &Val) {
    if side != 1 {
        return;
    }
    let place = mem.get("plan") == "place";
    let cavs: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    // (pas de barricade partout : au plus une pour ABRI_PART bataillons de ligne)
    let n_ligne = us.iter().filter(|u| u.at("cls") == "inf" && !u.atb("light")).count() as i64;
    let n_barr = b
        .barr
        .iter()
        .filter(|r| b.by_id.at(&r.at("u")).at("side") == side && r.at("c").iter().any(|cp| b.barr_prev.has(&cp.at(0))))
        .count() as i64;
    let n_ordre = us.iter().filter(|u| okind(u) == "barricade").count() as i64;
    let mut room = py::floordiv_i(n_ligne, ABRI_PART).max(1) - n_barr - n_ordre;
    for u in us.iter() {
        if u.at("cls") != "inf"
            || !U::valid(&u)
            || busy.has(&u.at("id"))
            || _tenue(&u)
            || u.atb("path")
            || u.atf("busy") > 0.0
            || !dans(&u.at("state"), &["repos", "feu", "recharge"])
        {
            continue;
        }
        if place && ABRI_ROLES().has(&mem.at("role").get(&u.at("id"))) {
            if foes.iter().any(|e| U::valid(&e) && d2u(&e, &u) < sq(ABRI_FOE))
                && b.order(side, &id1(&u), "maisons", "ia", &dict! {}).0
            {
                busy.push(u.at("id"));
                _note_once(b, mem, "maisons", &format!("l'ennemi approche : {} occupe les maisons.", u.at("name")), 1800.0);
            }
        } else if room > 0
            && !u.atb("light")
            && cavs.iter().any(|e| {
                d2u(e, &u) < sq(ABRI_CAV / 2.0)
                    || (d2u(e, &u) < sq(ABRI_CAV)
                        && dans(&e.at("state"), &["marche", "charge"])
                        && _ang(e.atf("dir"), vers(e, &u)) < 0.6)
            })
            && b.why_barricade(&u).is_empty()
        {
            b.order(side, &id1(&u), "barricade", "ia", &dict! {});
            busy.push(u.at("id"));
            room -= 1;
            _note_once(b, mem, "barricade", &format!("des cavaliers rôdent : {} se barricade.", u.at("name")), 1800.0);
        }
    }
}

/// Python (ai.py, l. 1773-1790) : `def _situation(b, mem, us, foes)`
/// Rend le dict sit : combat, valid (listes), mine, init, foe, ratio, loss, mor (nombres), routed, e_routed (entiers),
/// seen (liste). `mem.get('init') or mine`. `min(seen, key=min(…, default=0))` → `py::min_by_key`.
pub fn _situation(b: &mut TacticalBattle, mem: &Val, us: &Val, foes: &Val) -> Val {
    let combat: Vec<Val> = us.iter().filter(|u| dans(&u.at("cls"), &["inf", "cavalerie", "artillerie"])).collect();
    let valid: Vec<Val> = combat.iter().filter(|u| U::valid(u)).cloned().collect();
    // (une troupe en déroute compte pour moitié : la plupart se rallient quelques minutes plus tard)
    let mine = py::sum(valid.iter().map(|u| u.atf("men")))
        + 0.5 * py::sum(combat.iter().filter(|u| u.at("state") == "deroute").map(|u| u.atf("men")));
    let init = mem.get("init").or(mine);
    let foe = _foe_est(mem);
    let mor = py::sum(valid.iter().map(|u| u.atf("morale") * u.atf("men"))) / pmax(1.0, mine);
    let routed = combat.iter().filter(|u| u.at("state") == "deroute").count() as i64;
    let now = b.clock;
    let e_routed =
        mem.at("vu").values().iter().filter(|v| v.at(6) == "deroute" && now - v.at(2).f() < 300.0).count() as i64;
    let seen: Vec<Val> = foes.iter().filter(|e| U::valid(e)).collect();
    if !seen.is_empty() && mem.get("t_contact").is_none() {
        mem.set("t_contact", py::round(now));
        let e = py::min_by_key(seen.iter(), |e| {
            py::min_f(combat.iter().map(|u| d2u(e, u))).unwrap_or(0.0)
        })
        .unwrap()
        .clone();
        _note(b, mem, &format!("premier contact : {} repéré.", _foe(&e)));
    }
    dict! {"combat" => Val::list(combat), "valid" => Val::list(valid), "mine" => mine, "init" => init.clone(),
        "foe" => foe, "ratio" => mine / pmax(1.0, foe), "loss" => 1.0 - mine / pmax(1.0, init.f()), "mor" => mor,
        "routed" => routed, "e_routed" => e_routed, "seen" => Val::list(seen)}
}

/// Rien ne bouge depuis 45 min : les effectifs des deux camps (vus) n'ont presque pas changé ; ou notre ligne
/// n'a pas tiré un coup de fusil depuis 30 min alors que l'ennemi n'a presque rien perdu (on se fait canonner de loin
/// sans pouvoir répondre).
///
/// Python (ai.py, l. 1793-1810) : `def _stalled(b, mem, sit, line=None)`
/// line : liste d'unités ou None (défaut).
pub fn _stalled(b: &mut TacticalBattle, mem: &Val, sit: &Val, line: &Val) -> bool {
    let now = b.clock;
    let hist = _history(b, mem, sit);
    let old: Vec<Val> = hist.iter().filter(|h| now - h.at(0).f() >= 2700.0).collect();
    if mem.get("t_contact").is_none() {
        return false;
    }
    let foe = sit.atf("foe");
    if line.truthy()
        && mem.get("phase") == "combat"
        && now - mem.get_or("t_phase", now).f() > 1800.0
        && now - py::max_f(line.iter().map(|u| u.atf("fired_t"))).unwrap() > 1800.0
    {
        let h30: Vec<Val> = hist.iter().filter(|h| now - h.at(0).f() >= 1800.0).collect();
        if let Some(h) = h30.last() {
            let h2 = h.at(2).f();
            if h2 - foe < 0.02 * pmax(1.0, h2) {
                return true;
            }
        }
    }
    let Some(h) = old.last() else { return false };
    let (h1, h2) = (h.at(1).f(), h.at(2).f());
    h1 - sit.atf("mine") < 0.01 * pmax(1.0, h1) && h2 - foe < 0.01 * pmax(1.0, h2)
}

/// Effectifs des deux camps (le nôtre, l'ennemi estimé), relevés toutes les 5 min (une heure au plus).
///
/// Python (ai.py, l. 1813-1820) : `def _history(b, mem, sit)`
/// Rend la liste mem['hist'] (le même objet) de [t, nos hommes, ennemis estimés] (entiers).
pub fn _history(b: &mut TacticalBattle, mem: &Val, sit: &Val) -> Val {
    let hist = mem.setdefault("hist", list![]);
    if !hist.truthy() || b.clock - hist.at(-1).at(0).f() >= 300.0 {
        hist.push(list![py::round(b.clock), py::round(sit.atf("mine")), py::round(sit.atf("foe"))]);
        if hist.len() > 12 {
            let n = hist.len() as i64;
            hist.replace_all(hist.slice(Some(n - 12), None).vec());
        }
    }
    hist
}

/// Obstination selon la situation : supplément de pertes accepté avant de décrocher (négatif : on décroche plus
/// tôt). On s'accroche quand on a l'avantage — l'ennemi a perdu plus d'hommes que nous (d'après ses effectifs vus),
/// le rapport de forces vu est favorable, des troupes ennemies sont en déroute, il nous reste des réserves fraîches —
/// ou qu'on tient une position clé (la ligne du défenseur sur une crête, derrière des haies, des murets, dans un
/// village) ; sans rien de tout cela, on décroche plus tôt (TEN_NONE). Rase campagne seulement (l'assaut et la défense
/// d'une place ont leurs propres règles). Renvoie (supplément, raisons).
///
/// Python (ai.py, l. 1823-1864) : `def _tenacity(b, side, mem, L, sit)`
/// Rend (supplément, raisons). `L.get('ten_k', 1.0)` : un flottant (0.0 en facile). `f"{round(e_cas * 100)} %"` : entiers.
pub fn _tenacity(b: &TacticalBattle, side: i64, mem: &Val, L: &Val, sit: &Val) -> (f64, Vec<String>) {
    let ten_k = L.get_or("ten_k", 1.0);
    if dans(&mem.at("plan"), &["place", "assaut"]) || mem.get("t_contact").is_none() || !ten_k.truthy() {
        return (0.0, vec![]); // (facile : ne lit pas la situation)
    }
    let (mut k, mut why) = (0.0, Vec::<String>::new());
    // tués, blessés et prisonniers des deux camps (les nôtres ; ceux de l'ennemi d'après ses effectifs vus)
    let (cas, e_cas) = _cas(b, side, mem);
    // (à couvert, le défenseur perd d'ordinaire moins que l'assaillant : chacun juge l'échange à cette aune)
    let d = if side == 0 { e_cas * EXCHANGE - cas } else { e_cas - cas * EXCHANGE };
    if d > 0.02 {
        k += pmin(TEN_TRIED, TEN_TRIED_K * d);
        why.push(format!("l'ennemi a perdu davantage ({} % contre {} %)", py::round(e_cas * 100.0), py::round(cas * 100.0)));
    }
    if sit.atf("ratio") >= 1.15 {
        k += TEN_RATIO;
        why.push("rapport de forces favorable".to_string());
    }
    let inf: Vec<Val> = sit.at("seen").iter().filter(|e| e.at("cls") == "inf").collect();
    let shaken = !inf.is_empty() && py::sum(inf.iter().map(|e| e.atf("morale"))) / (inf.len() as f64) < 50.0;
    let e_routed = sit.ati("e_routed");
    if e_routed >= 2 || shaken {
        k += TEN_ROUT;
        why.push((if e_routed >= 2 { "l'ennemi a des troupes en déroute" } else { "l'ennemi est ébranlé" }).to_string());
    }
    let roles = mem.at("role");
    let fresh = py::sum(
        sit.at("valid")
            .iter()
            .filter(|u| {
                dans(&roles.get(&u.at("id")), &["res", "garde_flanc"])
                    && u.atf("morale") > 60.0
                    && u.atf("ammo") > 0.5 * u.atf("ammo0")
                    && u.at("cls") == "inf"
            })
            .map(|u| u.atf("men")),
    );
    if fresh > 0.12 * pmax(1.0, sit.atf("init")) {
        k += TEN_RES;
        why.push("des réserves fraîches".to_string());
    }
    if side == 1 && mem.get("mode") == "poste" {
        let line: Vec<Val> = sit.at("valid").iter().filter(|u| roles.get(&u.at("id")) == "ligne").collect();
        let body = _body(b, mem, 150.0);
        let eh = if body.is_empty() {
            None
        } else {
            Some(body.iter().map(|r| b.height_at(r.1, r.2)).sum::<i64>() as f64 / body.len() as f64)
        };
        let held = py::sum(
            line.iter()
                .filter(|u| {
                    let (x, y) = (u.atf("x"), u.atf("y"));
                    b.cover_at(x, y) >= 0.2 || b.feature_at(x, y) >= 2 || eh.is_some_and(|eh| b.height_at(x, y) as f64 > eh + 8.0)
                })
                .map(|u| u.atf("men")),
        );
        if !line.is_empty() && held >= 0.4 * py::sum(line.iter().map(|u| u.atf("men"))) {
            k += TEN_POS;
            why.push("la position est bonne".to_string());
        }
    }
    if why.is_empty() {
        return (TEN_NONE, vec![]);
    }
    (pmin(TEN_MAX, k) * ten_k.f(), why)
}

/// Décrocher quand la bataille est perdue (jamais pour le défenseur d'une place).
///
/// Python (ai.py, l. 1867-1926) : `def _decide_withdraw(b, side, mem, L, sit)`
/// `heavy(k)` : fonction imbriquée. `f"{sit['ratio']:.2f}"` → `format!("{:.2}", …)`.
pub fn _decide_withdraw(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, sit: &Val) -> bool {
    let plan = mem.at("plan");
    if plan == "place" || !sit.at("combat").truthy() {
        return false;
    }
    _history(b, mem, sit);
    let mut why: Option<&str> = None;
    let tr = b.r#trait(side);
    let mut k = if tr == "prudent" {
        0.08
    } else if tr == "audacieux" {
        -0.05
    } else {
        0.0
    };
    if side == 0 && dans(&plan, &["frontal", "artillerie", "debordement"]) {
        k -= L.get_or("wd_att", ATT_TENACITY).f(); // l'assaillant accepte des pertes plus lourdes pour emporter la position
    }
    let (ten, ten_why) = _tenacity(b, side, mem, L, sit);
    k -= ten;
    let (loss, ratio) = (sit.atf("loss"), sit.atf("ratio"));
    if plan == "harcelement" && mem.get("t_contact").is_some() {
        if b.clock - mem.atf("t_contact") > mem.get_or("harass_t", 2700).f() || loss > 0.18 {
            why = Some("l'escarmouche a assez duré");
        }
    }
    // (les pertes comptent pour moitié les troupes en déroute : un camp qui en a plusieurs à la fois plie)
    let (wd_loss, wd_ratio) = (L.atf("wd_loss"), L.atf("wd_ratio"));
    let heavy = |k: f64| -> bool {
        (loss > wd_loss - k && ratio < wd_ratio + 0.1)
            || (loss > wd_loss + L.get_or("wd_even_loss", WD_EVEN_LOSS).f() - k
                && ratio < wd_ratio + L.get_or("wd_even", WD_EVEN).f()) // (combat égal qui s'éternise : le plus éprouvé cède)
    };
    if ten > 0.0 && !heavy(k) && heavy(k + ten) {
        _note_once(
            b,
            mem,
            "tenace",
            &format!("l'armée s'accroche malgré {} % de pertes : {}.", py::round(loss * 100.0), ten_why.join(", ")),
            1200.0,
        );
    }
    if heavy(k) {
        why = Some("pertes trop lourdes");
    } else if ratio < 0.45 && loss > 0.2 {
        why = Some("l'ennemi est bien plus fort");
    } else if sit.at("valid").truthy() && sit.atf("mor") < 32.0 && sit.ati("routed") >= sit.at("valid").len() as i64 {
        why = Some("le moral est brisé");
    } else if side == 0 && b.time_left() < 900.0 && ratio < 1.6 && mem.get("t_contact").is_some() {
        why = Some("la nuit tombe");
    } else if side == 0 && plan != "harcelement" && {
        let roles = mem.at("role");
        let line: Val =
            sit.at("valid").iter().filter(|u| roles.get(&u.at("id")) == "ligne" && u.at("cls") == "inf").collect();
        _stalled(b, mem, sit, &line)
    } {
        // (les combats durent : une ligne qui ne gagne plus de terrain n'est pas battue, elle serre au plus près ;
        // on ne décroche qu'après un assaut général manqué, ou nettement plus faible)
        // (assaut d'une place : l'assaut général est une nouvelle vague ; ses vagues lancées, on n'annonce plus rien)
        let quiet = plan == "assaut" && mem.get_or("waves", 0) >= L.get_or("waves", ASSAULT_WAVES);
        if b.clock - mem.get_or("masse_t", -1e9).f() < 900.0 {
            // (la masse est lancée : le reste de la ligne fixe l'ennemi, on attend son issue)
        } else if ratio >= 0.85
            && L.at("n").i() >= 1
            && !mem.get("general_assault").truthy()
            && mem.get("ord").or(dict! {}).get("obj") != "user"
        {
            // (ordres : l'user, sans assaut général)
            mem.set("general_assault", py::round(b.clock));
            mem.set("halt_k", py::round_n(mem.get_or("halt_k", 0.85).f() * 0.5, 2));
            if !quiet {
                _note(b, mem, &format!("l'attaque piétine : assaut général (rapport de forces vu {ratio:.2})."));
            }
        } else if ratio < 0.7 || (b.clock - mem.get_or("general_assault", b.clock).f() > 2700.0 && ratio < 1.2) {
            why = Some("l'attaque piétine");
        } else if b.clock - mem.get_or("general_assault", b.clock).f() > 2700.0 {
            // (nettement plus fort : on ne lâche pas, on relance l'assaut)
            mem.set("general_assault", py::round(b.clock));
            if !quiet {
                _note(b, mem, &format!("nouvel assaut général (rapport de forces vu {ratio:.2})."));
            }
        }
    }
    let Some(why) = why else { return false };
    b.withdraw(side);
    _note(
        b,
        mem,
        &format!("l'armée décroche en bon ordre ({why} ; {} % de pertes, rapport de forces vu {ratio:.2}).", py::round(loss * 100.0)),
    );
    true
}

/// Arrière-garde : quand l'armée décroche, deux escadrons et un bataillon frais tiennent un poste en arrière de
/// l'ancre et retiennent la poursuite (leurs cavaliers chargent ceux qui talonnent nos colonnes) ; puis ils filent à
/// leur tour (Ney pendant la retraite de Russie). Pas dans une déroute générale.
///
/// Python (ai.py, l. 1929-2003) : `def _rearguard(b, side, mem, L, us)`
/// `sorted(…, key=-men * morale)[:2]` stable. `b.withdraw_t[side]` : liste de flottants. `c is not tgt` → `!c.is(&tgt)`.
pub fn _rearguard(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, us: &Val) {
    let now = b.clock;
    let foes = _picture(b, side, mem);
    if now < mem.get_or("next", 0.0).f() {
        return;
    }
    mem.set("next", now + L.atf("period"));
    let fd = mem.atf("fd");
    let rg = mem.get("rg");
    if rg.is_none() {
        let sit = _situation(b, mem, us, &foes);
        let rg = list![];
        mem.set("rg", rg.clone());
        if sit.atf("ratio") < 0.45 {
            return;
        }
        let mut cav = py::sorted_by_key(
            us.iter()
                .filter(|u| u.at("cls") == "cavalerie" && U::valid(u) && u.atf("morale") > 50.0 && u.atf("men") > 0.5 * u.atf("men0"))
                .collect(),
            |u: &Val| -u.atf("men") * u.atf("morale"),
        );
        cav.truncate(2);
        let mut inf = py::sorted_by_key(
            us.iter()
                .filter(|u| {
                    u.at("cls") == "inf"
                        && U::valid(u)
                        && u.atf("morale") > 55.0
                        && u.at("state") != "melee"
                        && u.atf("men") > 0.5 * u.atf("men0")
                })
                .collect(),
            |u: &Val| -u.atf("men") * u.atf("morale"),
        );
        inf.truncate(1);
        let (bx, by) = _at(mem.atf("ax"), mem.atf("ay"), fd, -150.0, 0.0);
        let post = mem.setdefault("rg_post", dict! {});
        for (k, u) in cav.iter().chain(inf.iter()).enumerate() {
            let lat = if u.at("cls") == "inf" {
                0.0
            } else if k == 0 {
                200.0
            } else {
                -200.0
            };
            let (qx, qy) = _at(bx, by, fd, 0.0, lat);
            let (x, y) = _clamp(qx, qy, 30.0);
            b.order(side, &id1(u), "move", "ia", &dict! {"x" => x, "y" => y, "dir" => fd});
            if u.at("cls") == "inf" {
                b.order(side, &id1(u), "form", "ia", &dict! {"form" => "ligne"});
            }
            post.set(&u.at("id"), list![py::round_n(x, 1), py::round_n(y, 1)]);
            rg.push(u.at("id"));
        }
        if rg.truthy() {
            _stat(mem, "rg", 1);
            let noms: Vec<String> = rg.iter().map(|i| b.unit(&i).ats("name")).collect();
            _note(b, mem, &format!("{} forment l'arrière-garde et couvrent la retraite.", noms.join(" et ")));
        }
        return;
    }
    let away: Vec<Val> = us.iter().filter(|u| !rg.has(&u.at("id")) && U::alive(u) && u.at("state") != "hors").collect();
    let e_cav: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "cavalerie" && U::valid(e)).collect();
    for uid in rg.to_list().iter() {
        let u = b.unit(&uid);
        if u.is_none() || !U::valid(&u) {
            rg.remove(&uid);
            continue;
        }
        let e_inf: Vec<Val> = foes.iter().filter(|e| e.at("cls") == "inf" && U::valid(e) && d2u(e, &u) < sq(120.0)).collect();
        let pressed = e_inf.iter().any(|e| _melee_power(b, &u) < 0.8 * _melee_power(b, e));
        if now - b.withdraw_t.at(side).f() > L.atf("rg_t") || u.atf("morale") < 40.0 || u.atf("men") < 0.4 * u.atf("men0") || pressed {
            b.order(side, &id1(&u), "retreat", "ia", &dict! {});
            rg.remove(&uid);
            if !rg.truthy() {
                _note(b, mem, "l'arrière-garde décroche à son tour.");
            }
            continue;
        }
        if dans(&u.at("state"), &["charge", "melee"]) || u.atf("busy") > 0.0 {
            continue;
        }
        if u.at("cls") == "cavalerie" && u.atf("morale") > 50.0 && u.atf("fat") < 75.0 {
            let mut tgt = Val::None;
            for e in py::sorted_by_key(foes.vec(), |e| d2u(e, &u)) {
                if !U::valid(&e) || d2u(&e, &u) > sq(600.0) {
                    continue;
                }
                if e.at("cls") == "cavalerie" && away.iter().any(|o| d2u(o, &e) < sq(400.0)) {
                    tgt = e.clone(); // elle talonne nos colonnes
                } else if e.at("cls") == "inf"
                    && e.at("state") == "marche"
                    && e.at("form") != "carre"
                    && !ROUGH.contains(&b.terrain_at(e.atf("x"), e.atf("y")))
                    && d2u(&e, &u) < sq(350.0)
                {
                    tgt = e.clone(); // elle marche à découvert, sans pouvoir tirer
                }
                if tgt.is_some()
                    && _charge_ok(b, side, &u, &tgt)
                    && !e_cav.iter().any(|c| {
                        !c.is(&tgt) && c.atf("morale") > 50.0 && d2u(c, &tgt) < sq(250.0) && c.atf("men") > u.atf("men")
                    })
                {
                    break;
                }
                tgt = Val::None;
            }
            if tgt.is_some() {
                b.order(side, &id1(&u), "charge", "ia", &dict! {"target" => tgt.at("id")});
                _stat(mem, "rg_ch", 1);
                _note_once(
                    b,
                    mem,
                    &format!("rgc{}", u.at("id")),
                    &format!("l'arrière-garde ({}) charge le {} qui talonne la retraite.", u.at("name"), _foe(&tgt)),
                    600.0,
                );
                continue;
            }
        }
        let p = mem.get("rg_post").or(dict! {}).get(&uid);
        if p.truthy() && _d2(u.atf("x"), u.atf("y"), p.at(0).f(), p.at(1).f()) > sq(40.0) && !u.atb("path") {
            b.order(side, &id1(&u), "move", "ia", &dict! {"x" => p.at(0), "y" => p.at(1), "dir" => fd});
        }
    }
}
