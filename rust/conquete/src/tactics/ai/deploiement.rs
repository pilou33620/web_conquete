//! Porte game/tactics/ai.py, lignes 298 à 1294 : outils ; lecture du terrain ; plan ; déploiement ; places.
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

// ====================================================================== outils

/// Python (ai.py, l. 299-306) : `def _lvl(b, side)`
/// Rend (L, nom du niveau). Sans réglage d'essai, L est LEVELS()[nom] lui-même (le même objet : ne jamais le
/// modifier) ; avec spec['ai_tweak'][nom], une copie mêlée (`dict(LEVELS[name], **tw[name])`). Puis `OR::tweak(b, side, &L)`.
/// `isinstance(getattr(b, 'spec', None), dict)` → `b.spec.is_dict()`.
pub fn _lvl(b: &TacticalBattle, side: i64) -> (Val, String) {
    let lv = if b.spec.is_dict() { b.spec.get("ai_levels") } else { Val::None };
    let mut name = if (lv.is_list() || lv.is_tuple()) && lv.len() as i64 > side && LEVELS().has(&lv.at(side)) {
        lv.at(side)
    } else {
        Val::from(b.difficulty.as_str())
    };
    if !LEVELS().has(&name) {
        name = Val::from("normal");
    }
    let tw = if b.spec.is_dict() { b.spec.get("ai_tweak") } else { Val::None };
    let lvl = if tw.is_dict() && tw.get(&name).is_dict() {
        let l = LEVELS().at(&name).copy();
        l.update(&tw.at(&name));
        l
    } else {
        LEVELS().at(&name)
    };
    // (réglages d'essai : séries de mise au point ; ordres du joueur : orders.py)
    (OR::tweak(b, side, &lvl), name.string())
}

/// Python (ai.py, l. 309-313) : `def _mem(b, side)`
/// Rend le dict b.ai_mem['s0' | 's1'] (le même objet ; b.ai_mem refait en {} s'il n'est pas un dict).
pub fn _mem(b: &mut TacticalBattle, side: i64) -> Val {
    if !b.ai_mem.is_dict() {
        b.ai_mem = dict! {};
    }
    b.ai_mem.setdefault(format!("s{side}"), dict! {})
}

/// Python (ai.py, l. 316-318) : `def _hour(clock)`
/// `int(…)` → `py::int` ; `m // 60`, `m % 60` → `py::floordiv_i`, `py::mod_i`.
pub fn _hour(clock: f64) -> String {
    let m = py::int(8.0 * 60.0 + clock / 60.0);
    format!("{} h {:02}", py::floordiv_i(m, 60), py::mod_i(m, 60))
}

/// Journal des grands moments (comptes rendus de bataille).
///
/// Python (ai.py, l. 321-326) : `def _note(b, mem, txt)`
/// `round(b.clock)` → `py::round` (un entier) ; `del j[:30]` → `j.replace_all(j.slice(Some(30), None).vec())`.
pub fn _note(b: &mut TacticalBattle, mem: &Val, txt: &str) {
    let j = mem.setdefault("journal", list![]);
    let h_off = b.spec.get_or("h_off", 0.0).f();
    j.push(list![py::round(b.clock), format!("{} : {}", _hour(b.clock + h_off), txt)]);
    if j.len() > 90 {
        j.replace_all(j.slice(Some(30), None).vec());
    }
}

/// Point à dep mètres devant (x, y) selon l'axe a, et lat mètres sur la droite (vers l'ennemi, face à a).
///
/// Python (ai.py, l. 329-332) : `def _at(x, y, a, dep, lat=0.0)`
/// lat : défaut 0.0.
pub fn _at(x: f64, y: f64, a: f64, dep: f64, lat: f64) -> (f64, f64) {
    let (c, s) = (a.cos(), a.sin());
    (x + c * dep - s * lat, y + s * dep + c * lat)
}

/// (profondeur, latéral) de (x, y) par rapport à l'ancre (ax, ay), face à a.
///
/// Python (ai.py, l. 335-339) : `def _rel(x, y, ax, ay, a)`
pub fn _rel(x: f64, y: f64, ax: f64, ay: f64, a: f64) -> (f64, f64) {
    let (c, s) = (a.cos(), a.sin());
    let (dx, dy) = (x - ax, y - ay);
    (dx * c + dy * s, -dx * s + dy * c)
}

/// Python (ai.py, l. 342-343) : `def _clamp(x, y, m=30.0)`
/// m : défaut 30.0 (W, H : `as f64`).
pub fn _clamp(x: f64, y: f64, m: f64) -> (f64, f64) {
    (pmin(pmax(x, m), W as f64 - m), pmin(pmax(y, m), H as f64 - m))
}

/// Python (ai.py, l. 346-347) : `def _d2(ax, ay, bx, by)`
/// `(ax - bx) ** 2` → `py::pow(ax - bx, 2.0)` (des entiers de la mémoire arrivent ici en `f64` : même valeur).
pub fn _d2(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    py::pow(ax - bx, 2.0) + py::pow(ay - by, 2.0)
}

/// Python (ai.py, l. 350-351) : `def _ang(a, b)`
/// `%` → `py::mod_f`.
pub fn _ang(a: f64, b: f64) -> f64 {
    (py::mod_f(a - b + std::f64::consts::PI, 2.0 * std::f64::consts::PI) - std::f64::consts::PI).abs()
}

/// Python (ai.py, l. 354-367) : `def _cat(u)`
/// Rend 'gen', 'wagon', 'art', 'cav', 'light', 'mil' ou 'inf' (les clés de `_groups`).
pub fn _cat(u: &Val) -> &'static str {
    let c = u.at("cls");
    if c == "general" {
        return "gen";
    }
    if c == "chariot" {
        return "wagon";
    }
    if c == "artillerie" {
        return "art";
    }
    if c == "cavalerie" {
        return "cav";
    }
    if u.atb("light") {
        return "light";
    }
    if dans(&u.at("type"), &["milice", "garde"]) {
        return "mil";
    }
    "inf"
}

/// Python (ai.py, l. 370-374) : `def _groups(us)`
/// Rend le dict {inf, light, cav, art, mil, gen, wagon} (dans cet ordre) → listes d'unités.
pub fn _groups(us: &Val) -> Val {
    let g = dict! {"inf" => list![], "light" => list![], "cav" => list![], "art" => list![], "mil" => list![],
    "gen" => list![], "wagon" => list![]};
    for u in us.iter() {
        g.at(_cat(&u)).push(u);
    }
    g
}

/// Front d'une unité déployée (m).
///
/// Python (ai.py, l. 377-385) : `def _width(u)`
pub fn _width(u: &Val) -> f64 {
    let c = u.at("cls");
    if c == "inf" {
        return 120.0 * pmax(0.25, u.atf("men") / pmax(1.0, u.atf("men_nom")));
    }
    if c == "cavalerie" {
        return 100.0 * pmax(0.25, u.atf("men") / pmax(1.0, u.atf("men_nom")));
    }
    if c == "artillerie" {
        return 90.0;
    }
    20.0
}

/// Python (ai.py, l. 388-390) : `def _quality(u)`
pub fn _quality(u: &Val) -> f64 {
    let t = u.at("type");
    let k = if t == "grenadiers" {
        1.35
    } else if t == "sapeurs" {
        0.5
    } else if t == "garde" {
        0.6
    } else if t == "milice" {
        0.55
    } else {
        1.0
    };
    u.atf("men") * (0.5 + u.atf("morale") / 200.0) * (1.0 + u.atf("xp") / 200.0) * k
}

/// Portée efficace moyenne de l'infanterie.
///
/// Python (ai.py, l. 393-396) : `def _einf(b, us)`
/// Les portées sont des entiers (`b.ranges(u).0`) : leur somme est entière, puis `/ len` ; 110.0 sans infanterie.
pub fn _einf(b: &TacticalBattle, us: &Val) -> f64 {
    let r: Vec<i64> = us.iter().filter(|u| u.at("cls") == "inf").map(|u| b.ranges(&u).0).collect();
    if r.is_empty() {
        110.0
    } else {
        r.iter().sum::<i64>() as f64 / r.len() as f64
    }
}

/// Python (ai.py, l. 399-400) : `def _seed_rand(b, side, k)`
/// Un hasard à part (n'entame pas b.rng) : `Random::new((int(spec['seed']) * 31 + side * 7 + k) & 0x7FFFFFFF).random()`.
pub fn _seed_rand(b: &TacticalBattle, side: i64, k: i64) -> f64 {
    let seed = py::int_v(&b.spec.get_or("seed", 0));
    // (seuls les 31 bits bas comptent : le calcul en wrapping garde ceux de l'entier sans borne de Python)
    let g = seed.wrapping_mul(31).wrapping_add(side.wrapping_mul(7)).wrapping_add(k) & 0x7FFF_FFFF;
    Random::new(g).random()
}

/// Change de formation, sauf si la manœuvre est déjà en cours (le moteur la recommencerait à zéro).
///
/// Python (ai.py, l. 403-409) : `def _form(b, side, u, f)`
/// Rend `b.order(side, [u.id], 'form', form=f)[0]`, ou false sans ordre.
pub fn _form(b: &mut TacticalBattle, side: i64, u: &Val, f: &str) -> bool {
    if u.atf("busy") > 0.0 && u.at("next_form") == f {
        return false;
    }
    if u.at("form") == f && u.atf("busy") <= 0.0 {
        return false;
    }
    b.order(side, &id1(u), "form", "ia", &dict! {"form" => f}).0
}

/// Note du journal, une seule fois par clé dans le délai donné (charges répétées…).
///
/// Python (ai.py, l. 412-421) : `def _note_once(b, mem, key, txt, delay=180.0)`
/// delay : défaut 180.0. `sorted(seen, key=seen.get)[:60]` : tri stable (`py::sorted_by_key`).
pub fn _note_once(b: &mut TacticalBattle, mem: &Val, key: &str, txt: &str, delay: f64) {
    let seen = mem.setdefault("noted", dict! {});
    if b.clock - seen.get_or(key, -1e9).f() < delay {
        return;
    }
    seen.set(key, py::round(b.clock));
    if seen.len() > 120 {
        let ks = py::sorted_by_key(seen.keys(), |k| seen.at(k));
        for k in ks.into_iter().take(60) {
            seen.del(&k);
        }
    }
    _note(b, mem, txt);
}

/// Nom d'une unité ennemie pour le journal : « 1er Ligne ennemi ».
///
/// Python (ai.py, l. 424-426) : `def _foe(e)`
/// `e.name[:1].isdigit()` : le premier caractère (Unicode : `char::is_numeric` couvre plus que `isdigit`, un nom de
/// régiment commence par un chiffre ASCII ou une lettre).
pub fn _foe(e: &Val) -> String {
    let n = e.ats("name");
    if n.chars().next().is_some_and(|c| c.is_numeric()) {
        format!("{n} ennemi")
    } else {
        format!("{n} (ennemi)")
    }
}

/// Époque tactique : 0 guerre en dentelles (avant 1789), 1 Révolution et Empire, 2 armes rayées (fusil rayé ou
/// mieux, ou 1850 et après) : le feu et le couvert dominent.
///
/// Python (ai.py, l. 429-434) : `def _era(b, side)`
/// Rend 0, 1 ou 2. `u.arm or 0` : u['arm'] peut valoir None.
pub fn _era(b: &TacticalBattle, side: i64) -> i64 {
    let y = (if b.spec.is_dict() { b.spec.get("year") } else { Val::None }).or(1790).f();
    let arm = b
        .units_of(side)
        .iter()
        .filter(|u| u.at("cls") == "inf")
        .map(|u| u.at("arm").or(0).f())
        .fold(0.0, |m, a| if a > m { a } else { m });
    if arm >= 4.0 || y >= 1850.0 {
        2
    } else if y < 1789.0 {
        0
    } else {
        1
    }
}

/// Compteurs des grands gestes (banc de mise au point).
///
/// Python (ai.py, l. 437-440) : `def _stat(mem, k, n=1)`
/// n : défaut 1.
pub fn _stat(mem: &Val, k: &str, n: i64) {
    let st = mem.setdefault("stats", dict! {});
    st.set(k, &st.get_or(k, 0) + n);
}

/// Le défenseur tient sa position (postes fixes) : les règles de la défense vivante s'appliquent.
///
/// Python (ai.py, l. 443-445) : `def _dfn(side, mem)`
pub fn _dfn(side: i64, mem: &Val) -> bool {
    side == 1 && dans(&mem.get("plan"), &["tenir", "harcelement"]) && mem.get("mode") == "poste"
}

/// Tués, blessés et prisonniers des deux camps : les nôtres, et ceux de l'ennemi d'après ses effectifs vus.
///
/// Python (ai.py, l. 448-454) : `def _cas(b, side, mem)`
/// Rend (nos pertes, celles de l'ennemi), en parts de 0 à 1. Sommes → `py::sum`.
pub fn _cas(b: &TacticalBattle, side: i64, mem: &Val) -> (f64, f64) {
    let ours: Vec<Val> = b
        .units
        .iter()
        .filter(|u| u.at("side") == side && dans(&u.at("cls"), &["inf", "cavalerie", "artillerie"]))
        .collect();
    let cas = py::sum(ours.iter().map(|u| u.atf("men0") - u.atf("men")))
        / pmax(1.0, py::sum(ours.iter().map(|u| u.atf("men0"))));
    let (vu, vu0) = (mem.at("vu"), mem.at("vu0"));
    let pertes = vu0.items().into_iter().filter(|(k, _)| vu.has(k)).map(|(k, n0)| {
        let d = &n0 - &vu.at(&k).at(3);
        if d > Val::Int(0) {
            d
        } else {
            Val::Int(0)
        }
    });
    let e_cas = py::sum_v(pertes).f() / pmax(1.0, mem.get("ann").or(1).f());
    (cas, e_cas)
}

/// L'assaillant flotte-t-il ? (score, raison) d'après ce qu'on voit de lui : aux prises, en train de reformer ses
/// rangs, ébranlé (sous FORMED, il ne reçoit plus une charge en ordre), sans cartouches (pas de feu de défense),
/// décimé, épuisé, pris de flanc par u.
///
/// Python (ai.py, l. 457-486) : `def _flotte(b, e, u=None)`
/// u : une unité ou None (défaut). Rend (score, raison) ; (0.0, '') s'il ne flotte pas.
/// `max(pts)[1]` compare des tuples (score, texte) : à score égal, le texte le plus grand (ordre des caractères)
/// l'emporte ; `sum(p for p, _ in pts)` → `py::sum`.
pub fn _flotte(b: &TacticalBattle, e: &Val, u: &Val) -> (f64, String) {
    if e.at("cls") != "inf" || !U::valid(e) {
        return (0.0, String::new());
    }
    let mut pts: Vec<(f64, &str)> = vec![];
    let st = e.at("state");
    if st == "melee" {
        pts.push((1.0, "aux prises"));
    } else if st == "ralliement" {
        pts.push((0.8, "il reforme ses rangs"));
    }
    let mor = e.atf("morale");
    if mor < 40.0 {
        pts.push((1.0, "ébranlé"));
    } else if mor < BT::FORMED as f64 {
        pts.push((0.7, "ébranlé"));
    } else if mor < 60.0 {
        pts.push((0.3, "fatigué du feu"));
    }
    if e.atf("ammo") < 1.0 {
        pts.push((0.8, "sans cartouches"));
    } else if e.atf("ammo") < 0.15 * e.atf("ammo0") {
        pts.push((0.3, "à court de cartouches"));
    }
    if e.atf("men") < 0.5 * e.atf("men0") {
        pts.push((0.4, "décimé"));
    }
    if e.atf("fat") > 75.0 {
        pts.push((0.3, "épuisé"));
    }
    if u.is_some() && _ang(e.atf("dir"), (u.atf("y") - e.atf("y")).atan2(u.atf("x") - e.atf("x"))) > 1.2 {
        pts.push((0.6, "pris de flanc"));
    }
    if pts.is_empty() {
        return (0.0, String::new());
    }
    let best = py::max_by_key(pts.iter().copied(), |p| *p).unwrap();
    (py::sum(pts.iter().map(|p| p.0)), best.1.to_string())
}

/// Effectif de départ de l'ennemi, tel que les éclaireurs l'annoncent (le joueur le voit aussi).
///
/// Python (ai.py, l. 489-492) : `def _announced(b, side)`
pub fn _announced(b: &TacticalBattle, side: i64) -> f64 {
    let k = OR::announced_k(b, side); // (ordres : les feux de camp de l'ennemi le font croire plus nombreux)
    k * py::sum(
        b.units
            .iter()
            .filter(|u| u.at("side") != side && !dans(&u.at("cls"), &["general", "chariot"]))
            .map(|u| u.atf("men0")),
    )
}

// ====================================================================== lecture du terrain

/// Valeur d'une ligne de défense : hauteur, couvert (haies, murets, lisières, maisons), champ de tir devant.
///
/// Python (ai.py, l. 496-508) : `def _line_score(b, side, ax, ay, fd, half)`
/// `lat` part de -half et avance de 40 (flottants).
pub fn _line_score(b: &mut TacticalBattle, side: i64, ax: f64, ay: f64, fd: f64, half: f64) -> f64 {
    let (mut tot, mut n) = (0.0, 0i64);
    let mut lat = -half;
    while lat <= half + 1.0 {
        let (x, y) = _at(ax, ay, fd, 0.0, lat);
        lat += 40.0;
        n += 1;
        if !b.passable(x, y, "inf", side) {
            tot -= 2.0;
            continue;
        }
        tot += _spot_score(b, x, y, fd);
    }
    tot / n.max(1) as f64
}

/// Python (ai.py, l. 511-524) : `def _spot_score(b, x, y, fd)`
/// `b.height_at` rend un entier (`as f64` pour les calculs ; `h - 2` reste exact).
pub fn _spot_score(b: &TacticalBattle, x: f64, y: f64, fd: f64) -> f64 {
    let h = b.height_at(x, y);
    let (fx, fy) = _at(x, y, fd, 20.0, 0.0);
    let cov = pmax(b.cover_at(x, y), 0.8 * b.cover_at(fx, fy));
    let mut f = 0.0;
    for d in [60.0, 120.0, 200.0] {
        let (qx, qy) = _at(x, y, fd, d, 0.0);
        if !(0.0 <= qx && qx < W as f64 && 0.0 <= qy && qy < H as f64) {
            continue;
        }
        if !SCREEN.contains(&b.terrain_at(qx, qy)) {
            f += 1.0;
        }
        if b.height_at(qx, qy) < h - 2 {
            f += 0.3;
        }
    }
    h as f64 / 25.0 + cov * 2.2 + f * 0.35
}

/// Le bataillon cherche sa haie, son muret ou sa crête en avançant ou reculant de quelques dizaines de mètres.
///
/// Python (ai.py, l. 527-539) : `def _best_depth(b, side, x, y, fd, span)`
/// span : L['span'] (un entier de LEVELS, `as f64`) ou 40 ; `int(span // 20)`.
pub fn _best_depth(b: &mut TacticalBattle, side: i64, x: f64, y: f64, fd: f64, span: f64) -> (f64, f64) {
    let (mut best, mut bv) = ((x, y), -1e9);
    let n = py::int(py::floordiv_f(span, 20.0));
    for k in -n..n + 1 {
        let (px, py_) = _at(x, y, fd, (k * 20) as f64, 0.0);
        if !(20.0 < px && px < (W - 20) as f64 && 20.0 < py_ && py_ < (H - 20) as f64) || !b.passable(px, py_, "inf", side) {
            continue;
        }
        let mut v = _spot_score(b, px, py_, fd) - k.abs() as f64 * 0.03;
        if WOODS.contains(&b.terrain_at(px, py_)) {
            v -= 0.4; // une ligne dans le bois tire mal
        }
        if v > bv {
            best = (px, py_);
            bv = v;
        }
    }
    best
}

/// Poste de tirailleurs : bois, vignes, maisons, haies, avec une vue vers l'ennemi.
///
/// Python (ai.py, l. 542-561) : `def _cover_spot(b, side, x, y, fd, r)`
/// `b.los(px, py, qx, qy)` : yeux par défaut (battle::EYE, EYE).
pub fn _cover_spot(b: &mut TacticalBattle, side: i64, x: f64, y: f64, fd: f64, r: f64) -> (f64, f64) {
    let (mut best, mut bv) = ((x, y), -1e9);
    let n = py::int(py::floordiv_f(r, 40.0)).max(1);
    for i in -n..n + 1 {
        for j in -n..n + 1 {
            if i * i + j * j > n * n {
                continue;
            }
            let (px, py_) = (x + (i * 40) as f64, y + (j * 40) as f64);
            if !(20.0 < px && px < (W - 20) as f64 && 20.0 < py_ && py_ < (H - 20) as f64) || !b.passable(px, py_, "light", side) {
                continue;
            }
            let t = b.terrain_at(px, py_);
            let mut v = b.cover_at(px, py_) * 3.0 + (if WOODS.contains(&t) || t == T_BATI { 0.8 } else { 0.0 })
                + b.height_at(px, py_) as f64 / 60.0;
            let (qx, qy) = _at(px, py_, fd, 140.0, 0.0);
            if 0.0 <= qx && qx < W as f64 && 0.0 <= qy && qy < H as f64 && b.los(px, py_, qx, qy, BT::EYE, BT::EYE) {
                v += 0.7;
            }
            v -= py::hypot(i as f64, j as f64) / n as f64 * 0.8;
            if v > bv {
                best = (px, py_);
                bv = v;
            }
        }
    }
    best
}

/// Emplacement de batterie près de (x, y) : hauteur et champ de tir dégagé vers fd ; en difficile, une lisière de
/// bois (les canons y restent cachés jusqu'à leur première salve). rough : vignes et lisières, où la cavalerie
/// ennemie charge mal, sont préférées.
///
/// Python (ai.py, l. 564-597) : `def _gun_spot(b, side, x, y, fd, r, wood=False, ahead=1e9, rough=False)`
/// Défauts : wood = false, ahead = 1e9, rough = false. `b.los(px, py, qx, qy, GUN_EYE)` : eye2 par défaut EYE.
pub fn _gun_spot(b: &mut TacticalBattle, side: i64, x: f64, y: f64, fd: f64, r: f64, wood: bool, ahead: f64, rough: bool) -> (f64, f64) {
    let (mut best, mut bv) = ((x, y), -1e9);
    let n = py::int(py::floordiv_f(r, 40.0)).max(1);
    for i in -n..n + 1 {
        for j in -n..n + 1 {
            if i * i + j * j > n * n {
                continue;
            }
            let (px, py_) = (x + (i * 40) as f64, y + (j * 40) as f64);
            if !(30.0 < px && px < (W - 30) as f64 && 30.0 < py_ && py_ < (H - 30) as f64)
                || !b.passable(px, py_, "artillerie", side)
            {
                continue;
            }
            if _rel(px, py_, x, y, fd).0 > ahead {
                continue;
            }
            let t = b.terrain_at(px, py_);
            if t == T_BATI {
                continue;
            }
            let h = b.height_at(px, py_);
            let mut f = 0i64;
            for d in [250.0, 450.0, 650.0] {
                let (qx, qy) = _at(px, py_, fd, d, 0.0);
                if 0.0 <= qx && qx < W as f64 && 0.0 <= qy && qy < H as f64 && b.los(px, py_, qx, qy, GUN_EYE, BT::EYE) {
                    f += 1;
                }
            }
            if f == 0 {
                continue;
            }
            let mut v = h as f64 / 12.0 + f as f64 * 0.8 - py::hypot(i as f64, j as f64) / n as f64 * 1.2;
            if WOODS.contains(&t) {
                v += if wood {
                    1.5
                } else if rough {
                    0.6
                } else {
                    -1.0
                };
            } else if t == T_VIGNE_T && rough {
                v += 0.6;
            }
            if v > bv {
                best = (px, py_);
                bv = v;
            }
        }
    }
    best
}

/// Le flanc le plus dégagé pour la cavalerie (-1 gauche, 1 droite).
///
/// Python (ai.py, l. 600-611) : `def _open_flank(b, side, ax, ay, fd, width)`
/// Rend -1 ou 1.
pub fn _open_flank(b: &mut TacticalBattle, side: i64, ax: f64, ay: f64, fd: f64, width: f64) -> i64 {
    let mut sc = [0i64; 2]; // [-1, 1]
    for (i, w) in [-1i64, 1].into_iter().enumerate() {
        let mut n = 0;
        for lat in [width / 2.0 + 200.0, width / 2.0 + 400.0, width / 2.0 + 600.0] {
            for dep in [100.0, 350.0, 600.0, 850.0] {
                let (x, y) = _at(ax, ay, fd, dep, w as f64 * lat);
                if 0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64 && b.passable(x, y, "cav", side)
                    && !ROUGH.contains(&b.terrain_at(x, y))
                {
                    n += 1;
                }
            }
        }
        sc[i] = n;
    }
    if sc[1] >= sc[0] {
        1
    } else {
        -1
    }
}

// ====================================================================== plan

/// Python (ai.py, l. 615-652) : `def _choose_plan(b, side, mem, L, g, pl)`
/// g : groupes (`_groups`) ; pl : `b.place_info()` (dict ou None). Rend une clé de PLAN_LABEL. `OR::plan(b, side, pl)`
/// rend un texte ou None (« if want »). `b.trait(side)` → `b.r#trait(side)` (`&mut`).
pub fn _choose_plan(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, g: &Val, pl: &Val) -> String {
    let want = OR::plan(b, side, pl); // ordres : la manœuvre choisie par le joueur
    if want.truthy() {
        return want.string();
    }
    if pl.truthy() {
        return (if side == 0 { "assaut" } else { "place" }).to_string();
    }
    const KS: [&str; 5] = ["inf", "light", "cav", "art", "mil"];
    let mine = py::sum(KS.iter().flat_map(|k| g.at(*k).vec()).map(|u| u.atf("men")));
    let r = mine / pmax(1.0, mem.atf("ann"));
    let tr = b.r#trait(side);
    let plans = b.spec.get("plans").or(list![Val::None, Val::None]);
    let camp = if (plans.is_list() || plans.is_tuple()) && plans.len() as i64 > side { plans.at(side) } else { Val::None };
    let n = KS.iter().map(|k| g.at(*k).len() as i64).sum::<i64>().max(1);
    let (ncav, nart) = (g.at("cav").len() as i64, g.at("art").len() as i64);
    let harass = L.atf("harass") + (if tr == "prudent" { 0.1 } else { 0.0 }) - (if tr == "audacieux" { 0.1 } else { 0.0 });
    let ln = L.at("n").i();
    if side == 0 {
        if r < harass || (camp == "harcelement" && r < 1.2) {
            return "harcelement".to_string();
        }
        let mut want = if dans(&camp, &["frontal", "artillerie", "debordement"]) { Some(camp.string()) } else { None };
        if want.as_deref() == Some("debordement") && (ncav == 0 || ln == 0) {
            want = None;
        }
        if want.as_deref() == Some("artillerie") && nart == 0 {
            want = None;
        }
        return match want {
            Some(w) => w,
            None => {
                if ncav >= 2 && ncav as f64 / n as f64 >= 0.15 && ln >= 1 && tr == "cavalier" {
                    "debordement".to_string()
                } else if nart != 0 && (tr == "artilleur" || nart as f64 / n as f64 >= 0.15) {
                    "artillerie".to_string()
                } else {
                    "frontal".to_string()
                }
            }
        };
    }
    // défenseur en rase campagne : le harcèlement de la campagne est suivi ; son plan « frontal » (le plan ordinaire
    // de la campagne) ne devient une contre-offensive qu'avec une nette supériorité
    if r < harass - 0.1 || (camp == "harcelement" && r < 1.2) {
        return "harcelement".to_string();
    }
    let ck = L.atf("counter_k");
    if r >= ck || (tr == "audacieux" && r >= ck * 0.8) || (camp == "frontal" && r >= pmax(1.25, ck * 0.8)) {
        return "frontal".to_string();
    }
    "tenir".to_string()
}

// ====================================================================== déploiement

/// Déploiement du camp side (unités commandées par l'IA). Sert aussi de placement de départ au camp du joueur
/// (bridge.default_deploy) : il est alors fait au niveau normal, quelle que soit la difficulté, et sans mémoire.
///
/// Python (ai.py, l. 656-692) : `def deploy(battle, side)`
/// Appelée par battle (autofinish : `crate::tactics::ai::deploy(self, me)`) et bridge (default_deploy).
/// `side not in (getattr(b, 'ai_sides', None) or (0, 1))` : b.ai_sides est une liste ; vide → (0, 1).
pub fn deploy(b: &mut TacticalBattle, side: i64) {
    let us = b.ai_units(side);
    if !us.truthy() {
        return;
    }
    let player = !b.ai_sides.or(tup![0, 1]).has(side);
    let (L, lname) = if player { (LEVELS().at("normal"), "normal".to_string()) } else { _lvl(b, side) };
    let mem = _mem(b, side);
    mem.clear();
    let era = _era(b, side);
    mem.update(&dict! {"v" => 1, "lvl" => lname.as_str(), "role" => dict!{}, "lat" => dict!{}, "back" => dict!{},
        "wing" => dict!{}, "post" => dict!{}, "vu" => dict!{}, "vu0" => dict!{}, "sq" => dict!{}, "fm" => dict!{},
        "gslot" => dict!{}, "journal" => list![], "next" => 0.0, "rnext" => 0.0, "phase" => "attente", "t_phase" => 0.0,
        "t_bound" => 0.0, "mode" => "ligne", "notes" => dict!{}, "era" => era});
    let g = _groups(&us);
    mem.set("ann", py::round(_announced(b, side)));
    mem.set(
        "init",
        py::round(py::sum(us.iter().filter(|u| !dans(&u.at("cls"), &["general", "chariot"])).map(|u| u.atf("men")))),
    );
    let (lo, hi) = L.at("halt").pair();
    let (lo, hi) = (lo.f(), hi.f());
    mem.set("halt_k", py::round_n(lo + (hi - lo) * _seed_rand(b, side, 1), 2));
    let pl = b.place_info();
    let plan = _choose_plan(b, side, &mem, &L, &g, &pl);
    mem.set("plan", plan.as_str());
    mem.set("plan0", plan.as_str());
    if pl.truthy() && side == 1 {
        _deploy_place_def(b, side, &mem, &L, &g, &pl);
    } else if pl.truthy() {
        _deploy_place_att(b, side, &mem, &L, &g, &pl);
    } else {
        _deploy_field(b, side, &mem, &L, &g, &plan);
    }
    if player {
        b.ai_mem.pop(format!("s{side}")); // (le joueur commande ce camp : l'IA n'en garde rien)
        return;
    }
    let tr = b.r#trait(side);
    let gen = if tr.truthy() { format!(", général {tr}") } else { String::new() };
    _note(
        b,
        &mem,
        &format!("plan choisi : {} (niveau {lname}{gen}, {} hommes contre {} annoncés).", PLAN_LABEL().at(plan.as_str()), mem.at("init"), mem.at("ann")),
    );
    if dans(&Val::from(plan.as_str()), &["frontal", "artillerie", "debordement"]) {
        let era = mem.at("era");
        let man = if L.atb("rupture") { format!(" ; manœuvre : {}", MANOEUVRE().at(&era)) } else { String::new() };
        _note(b, &mem, &format!("doctrine de l'époque : {}{man}.", DOCTRINE().at(&era)));
    }
}

/// Python (ai.py, l. 695-701) : `def _put(b, side, mem, u, x, y, d, form, role, lat=None)`
/// form : une formation ou None (général, chariot) ; lat : un nombre ou None (défaut : le latéral calculé).
/// `b.deploy(side, [u.id], x, y, d, form)` (who 'ia').
pub fn _put(b: &mut TacticalBattle, side: i64, mem: &Val, u: &Val, x: f64, y: f64, d: f64, form: &Val, role: &str, lat: &Val) {
    b.deploy(side, &id1(u), x, y, &Val::from(d), form, "ia");
    let id = u.at("id");
    mem.at("role").set(&id, role);
    mem.at("post").set(&id, list![rnd(&u.at("x"), 1), rnd(&u.at("y"), 1), py::round_n(d, 3)]);
    let (dep, l) = _rel(u.atf("x"), u.atf("y"), mem.atf("ax"), mem.atf("ay"), mem.atf("fd"));
    mem.at("lat").set(&id, if lat.is_none() { Val::Float(py::round_n(l, 1)) } else { rnd(lat, 1) });
    mem.at("back").set(&id, py::round_n(-dep, 1));
}

/// Ligne et réserve d'infanterie (o : ordres du joueur, la taille de la réserve).
///
/// Python (ai.py, l. 704-723) : `def _split_line(g, plan, o=None)`
/// o : ordres du joueur (dict) ou None (défaut). Rend (ligne, réserve) : deux listes d'unités.
/// `sorted(…, reverse=True)` → `py::sorted_by_key_rev` ; `u not in weak` / `u not in res` : identité des dict
/// (`Val::is`) ou égalité, même résultat (ce sont les mêmes objets).
pub fn _split_line(g: &Val, plan: &str, o: &Val) -> (Val, Val) {
    let inf = py::sorted_by_key_rev(g.at("inf").vec(), _quality);
    let weak: Vec<Val> = inf.iter().filter(|u| dans(&u.at("type"), &["sapeurs", "garde"])).cloned().collect();
    let inf: Vec<Val> = inf.into_iter().filter(|u| !weak.iter().any(|w| w.is(u))).collect();
    let n = inf.len() as i64;
    let mut nres = if n <= 2 {
        0
    } else if n <= 5 {
        1
    } else if n <= 9 {
        2
    } else {
        3
    };
    if plan == "tenir" && n >= 4 {
        nres += 1;
    }
    if plan == "harcelement" {
        nres = (nres - 1).max(0);
    }
    let nres = OR::res_count(o, n, nres);
    let gren: Vec<Val> = inf.iter().filter(|u| u.at("type") == "grenadiers").cloned().collect();
    let oth: Vec<Val> = inf.iter().filter(|u| u.at("type") != "grenadiers").cloned().collect();
    let k = oth.len().min(2);
    let mut res: Vec<Val> = gren.into_iter().chain(oth[k..].iter().cloned()).chain(oth[..k].iter().cloned()).collect();
    res.truncate(nres.max(0) as usize);
    let mut line: Vec<Val> = inf.iter().filter(|u| !res.iter().any(|r| r.is(u))).cloned().collect();
    line.extend(g.at("mil").vec());
    res.extend(weak);
    if line.is_empty() && !res.is_empty() {
        line.push(res.remove(0));
    }
    (Val::list(line), Val::list(res))
}

/// Ordre de bataille : les meilleurs au centre, les autres alternés à droite et à gauche. → [(u, lat)], largeur.
///
/// Python (ai.py, l. 726-744) : `def _layout(units, half, gap=22.0)`
/// gap : défaut 22.0. Rend ([(unité, latéral arrondi au dixième)], largeur).
pub fn _layout(units: &Val, half: f64, gap: f64) -> (Vec<(Val, f64)>, f64) {
    let us = py::sorted_by_key_rev(units.vec(), _quality);
    let mut row: Vec<Val> = vec![];
    for (k, u) in us.into_iter().enumerate() {
        if k % 2 == 1 {
            row.push(u);
        } else {
            row.insert(0, u);
        }
    }
    let tot = py::sum(row.iter().map(|u| _width(u) + gap));
    let room = pmax(200.0, 2.0 * half - 260.0);
    let k = if tot <= room { 1.0 } else { pmax(0.55, room / tot) };
    let mut x = -tot * k / 2.0;
    let mut out = vec![];
    for u in row {
        let w = (_width(&u) + gap) * k;
        out.push((u, py::round_n(x + w / 2.0, 1)));
        x += w;
    }
    (out, tot * k)
}

/// Python (ai.py, l. 747-881) : `def _deploy_field(b, side, mem, L, g, plan)`
/// `b.terrain_at(*_at(…))` ; `b.best_spot(x0, y0, 60, 'cover', side, cls='artillerie')` → facing None.
pub fn _deploy_field(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, g: &Val, plan: &str) {
    let z = b.ai_zone(side);
    let fd = b.front_dir(side);
    let (c, s) = (fd.cos(), fd.sin());
    let (cx, cy) = ((&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0);
    let (hw, hh) = ((&z.at(2) - &z.at(0)).f() / 2.0, (&z.at(3) - &z.at(1)).f() / 2.0);
    let reach = c.abs() * hw + s.abs() * hh;
    let half = s.abs() * hw + c.abs() * hh;
    let (fx, fy) = (cx + c * reach, cy + s * reach); // milieu du bord de la zone, côté ennemi
    let depth = 2.0 * reach;
    let o = OR::of(b, side); // ordres du joueur (None : l'IA à sa guise)
    let ot = o.truthy();
    let og = |k: &str| if ot { o.get(k) } else { Val::None };
    let w = if ot { OR::wing_sign(&o) } else { 0 };
    let (line, res) = _split_line(g, plan, &o);
    let (slots, width) = _layout(&line, half, 22.0);
    mem.set("width", py::round(width));
    let lterrain = L.at("terrain").truthy();
    let mut d_line;
    if side == 1 && plan != "harcelement" {
        d_line = depth / 2.0;
        if lterrain {
            let mut best: Option<(f64, i64)> = None;
            let mut d = 40;
            while d < py::int(depth) - 50 {
                let (ax, ay) = _at(fx, fy, fd, -d as f64, 0.0);
                let sc = _line_score(b, side, ax, ay, fd, width / 2.0) - d as f64 / 2500.0;
                if best.is_none() || sc > best.unwrap().0 {
                    best = Some((sc, d));
                }
                d += 20;
            }
            if let Some((_, d)) = best {
                d_line = d as f64;
            }
        }
    } else if side == 1 {
        d_line = pmax(60.0, depth - 160.0);
    } else {
        d_line = pmin(depth - 80.0, 110.0);
    }
    if ot && side == 1 && o.get("man") == "avant" {
        d_line = 60.0; // ordres : défense avancée, au bord de la zone
    }
    let (ax, ay) = _at(fx, fy, fd, -d_line, 0.0);
    mem.update(&dict! {"ax" => py::round_n(ax, 1), "ay" => py::round_n(ay, 1), "fd" => py::round_n(fd, 4),
        "mode" => if side == 1 { "poste" } else { "ligne" }});
    mem.set("lat0", list![]);
    for (u, lat) in &slots {
        let (mut x, mut y) = _at(ax, ay, fd, 0.0, *lat);
        if lterrain {
            (x, y) = _best_depth(b, side, x, y, fd, L.at("span").f());
        }
        _put(b, side, mem, u, x, y, fd, &Val::from("ligne"), "ligne", &Val::from(*lat));
        mem.at("lat0").push(*lat);
    }
    if ot {
        _orders_setup(b, side, mem, &o, w, &slots, width);
    }
    let era = mem.get_or("era", 1).i();
    if side == 1 && plan == "tenir" && L.atb("cp") && era == 1 {
        let l: Val = slots.iter().map(|(u, _)| u.clone()).collect();
        _reverse_slope(b, side, mem, L, &l, fd);
    }
    if side == 1 && plan != "harcelement" && L.atb("volley_def") && era < 2 && !slots.is_empty() {
        // « tirez les premiers » à l'envers : la ligne attend l'assaillant à bonne portée pour lâcher sa salve
        let ids: Val = slots.iter().filter(|(u, _)| u.at("cls") == "inf").map(|(u, _)| u.at("id")).collect();
        b.order(side, &ids, "fire", "ia", &dict! {"mode" => "volley"});
    }
    // infanterie légère : en avant, dans les bois, les vignes ou le bâti
    let lights = g.at("light").vec();
    let nl = lights.len();
    let leg = og("leg");
    let leg_bc = ot && dans(&leg, &["bois", "colonnes"]);
    let lscreen = L.atb("screen");
    for (k, u) in lights.iter().enumerate() {
        let mut lat = if nl == 1 { 0.0 } else { (k as f64 / (nl - 1) as f64 - 0.5) * (width + 120.0) };
        let mut dep: f64 = if side == 1 { 110.0 } else { 90.0 };
        if ot && leg == "bois" {
            lat = w as f64 * (width / 2.0 + 80.0 + (90 * k) as f64); // ordres : dans les couverts de l'aile choisie
            dep = 60.0;
        } else if ot && leg == "colonnes" {
            dep = 35.0;
        }
        if side == 1 && lscreen && !leg_bc {
            // écran de tirailleurs : assez loin devant pour harceler et retarder l'assaut (1,6 fois leur portée)
            dep = pmin(550.0, pmax(150.0, 1.6 * b.ranges(u).0 as f64));
            if era == 0 {
                // (guerre en dentelles : quelques pandours dans les couverts, tout près de la ligne)
                let (tx, ty) = _at(ax, ay, fd, 160.0, lat);
                dep = if ROUGH.contains(&b.terrain_at(tx, ty)) { 160.0 } else { 110.0 };
            }
        }
        let (px, py_) = _at(ax, ay, fd, dep, lat);
        let (mut x0, mut y0) = _clamp(px, py_, 30.0);
        if lterrain || (ot && leg == "bois") {
            let r = (if ot && leg == "bois" { 180.0 } else { 90.0 }) * L.atf("r_k");
            (x0, y0) = _cover_spot(b, side, x0, y0, fd, r);
        }
        _put(b, side, mem, u, x0, y0, fd, &Val::from("tirailleurs"), "avant", &Val::from(lat));
        if side == 1 && lscreen && !leg_bc {
            // (la zone de déploiement s'arrête souvent avant : ils s'y portent dès le début de la bataille)
            mem.at("post").set(&u.at("id"), list![py::round_n(x0, 1), py::round_n(y0, 1), py::round_n(fd, 3)]);
            mem.setdefault("scr", dict! {}).set(&u.at("id"), list![0, 0]);
        }
    }
    // artillerie : un peu en arrière de la ligne, sur une hauteur qui voit loin, ou en lisière (difficile)
    let arts = g.at("art").vec();
    let na = arts.len() as i64;
    let xfire = side == 1 && plan == "tenir" && L.atb("xfire") && na >= 2;
    let grande = ot && (o.get("art") == "grande" || o.get("man") == "percee");
    for (k, u) in arts.iter().enumerate() {
        let k = k as i64;
        let mut lat = (k as f64 - (na - 1) as f64 / 2.0)
            * (if grande {
                60.0
            } else if plan == "artillerie" {
                100.0
            } else {
                160.0
            });
        let (mut dep, mut gd) = (-40.0, fd);
        if xfire && (k == 0 || k == na - 1) {
            // feux croisés : les batteries des ailes prennent d'écharpe l'assaillant qui marche sur le centre
            let s_ = if k == 0 { -1.0 } else { 1.0 };
            lat = s_ * pmax(80.0, width / 2.0 - 30.0);
            dep = -20.0;
            gd = fd - s_ * 0.25;
        } else if xfire {
            lat = (k as f64 - (na - 1) as f64 / 2.0) * 60.0;
        }
        let (mut x0, mut y0) = _at(ax, ay, fd, dep, lat);
        if lterrain {
            (x0, y0) = _gun_spot(b, side, x0, y0, fd, 110.0 * L.atf("r_k"), L.atb("wood"), 15.0, true);
        }
        _put(b, side, mem, u, x0, y0, gd, &Val::from("batterie"), "art", &Val::from(lat));
    }
    // cavalerie aux ailes (l'aile du débordement en a davantage), réserve de cavalerie en difficile
    let mut cav = py::sorted_by_key_rev(g.at("cav").vec(), _quality);
    let mut flank = if plan == "debordement" {
        if ot {
            w
        } else {
            _open_flank(b, side, ax, ay, fd, width)
        }
    } else {
        0
    };
    mem.set("flank", flank);
    let mut keep: Vec<Val> = vec![];
    if L.at("n") == 2 && cav.len() >= 3 && plan != "debordement" {
        keep = vec![cav.remove(0)];
    }
    let oc = og("cav");
    if dans(&oc, &["reserve", "ecran"]) {
        keep.append(&mut cav); // ordres : toute la cavalerie derrière le centre
    } else if ot && oc != "ailes" {
        if flank == 0 {
            flank = w; // ordres : toute la cavalerie sur l'aile choisie (raid : elle partira de là)
        }
    }
    let mut nw = [0i64; 2]; // [-1, 1]
    let ncav = cav.len();
    for (k, u) in cav.iter().enumerate() {
        let cw = if ot && oc != "ailes" {
            flank
        } else if flank != 0 {
            if k % 3 != 2 || ncav < 3 {
                flank
            } else {
                -flank
            }
        } else if k % 2 == 0 {
            1
        } else {
            -1
        };
        let i = if cw == 1 { 1 } else { 0 };
        let lat = cw as f64 * (width / 2.0 + 110.0 + (120 * nw[i]) as f64);
        nw[i] += 1;
        let (x0, y0) = _at(ax, ay, fd, -70.0, lat);
        _put(b, side, mem, u, x0, y0, fd, &Val::from("ligne"), "cav", &Val::from(lat));
        mem.at("wing").set(&u.at("id"), cw);
    }
    let nk = keep.len();
    for (k, u) in keep.iter().enumerate() {
        let lat = if oc.truthy() { (k as f64 - (nk as f64 - 1.0) / 2.0) * 110.0 } else { 0.0 };
        let (x0, y0) = _at(ax, ay, fd, if oc == "ecran" { -110.0 } else { -260.0 }, lat);
        _put(b, side, mem, u, x0, y0, fd, &Val::from("ligne"), "cav", &Val::from(lat));
        mem.at("wing").set(&u.at("id"), 0);
    }
    // réserve, état-major, chariot
    let res = res.vec();
    let nr = res.len();
    for (k, u) in res.iter().enumerate() {
        let mut lat = (k as f64 - (nr as f64 - 1.0) / 2.0) * 90.0;
        if ot && o.get("resPos") == "aile" {
            lat += w as f64 * width / 3.0; // ordres : la réserve derrière l'aile choisie
        }
        let (x0, y0) = _at(ax, ay, fd, -(if side == 0 { 230.0 } else { 200.0 }), lat);
        _put(b, side, mem, u, x0, y0, fd, &Val::from("colonne"), "res", &Val::from(lat));
    }
    for u in g.at("gen").iter() {
        let (x0, y0) = _at(ax, ay, fd, -170.0, 0.0);
        _put(b, side, mem, &u, x0, y0, fd, &Val::None, "gen", &Val::from(0.0));
    }
    for (k, u) in g.at("wagon").iter().enumerate() {
        let k = k as i64;
        let (mut x0, mut y0) = _at(ax, ay, fd, -(if side == 1 { 150.0 } else { 240.0 }), (40 * k) as f64);
        if lterrain {
            (x0, y0) = b.best_spot(x0, y0, 60.0, "cover", side, &Val::None, "artillerie");
        }
        // (lat : l'entier 40 * k, comme le Python : round(40 * k, 1) reste un entier dans la mémoire)
        _put(b, side, mem, &u, x0, y0, fd, &Val::None, "wagon", &Val::from(40 * k));
    }
}

/// Ordres du joueur (orders.py) : ce que le déploiement en garde pour la suite (mem['ord']), l'aile refusée de
/// l'ordre oblique, le bataillon de la feinte, le chemin sous les bois de la marche de flanc.
///
/// Python (ai.py, l. 884-910) : `def _orders_setup(b, side, mem, o, w, slots, width)`
/// o : ordres du joueur (dict) ; w : `OR::wing_sign(o)` ; slots : le premier rendu de `_layout`.
/// `mem['ord'] = dict(o, w=w)` : une copie de o, plus w.
pub fn _orders_setup(b: &mut TacticalBattle, side: i64, mem: &Val, o: &Val, w: i64, slots: &[(Val, f64)], width: f64) {
    let od = o.copy();
    od.set("w", w);
    mem.set("ord", od.clone());
    let m = o.get("man");
    if m == "oblique" {
        // l'aile refusée attend 160 m en arrière ; le point de rupture sera sur l'aile forte
        for (u, lat) in slots {
            if !(lat * (w as f64) < -0.12 * width) {
                continue;
            }
            mem.at("back").set(&u.at("id"), 160.0);
            let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), -160.0, *lat);
            _put(b, side, mem, u, x, y, mem.atf("fd"), &Val::from("ligne"), "ligne", &Val::from(*lat));
        }
    } else if m == "double" {
        mem.set("env_s", -w); // (la masse enveloppera l'autre aile)
    }
    if o.get("ruse") == "feinte" && slots.len() >= 3 {
        let u = &py::min_by_key(slots.iter(), |t| t.1 * w as f64).unwrap().0;
        od.set("feint_id", u.at("id"));
    }
    if o.get("ruse") == "bois" {
        // les bois de l'aile choisie, entre les deux armées : la colonne tournante y passe (cachée à la vue)
        let mut pts: Vec<(f64, f64)> = vec![];
        let hw = py::int(width / 2.0);
        let mut dep = 150;
        while dep < 1300 {
            let mut lat = hw + 150;
            while lat < hw + 1000 {
                let (x, y) = _at(mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), dep as f64, (lat * w) as f64);
                if 0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64 && WOODS.contains(&b.terrain_at(x, y)) {
                    pts.push((x, y));
                }
                lat += 60;
            }
            dep += 60;
        }
        if !pts.is_empty() {
            let n = pts.len() as f64;
            od.set(
                "wood",
                list![py::round_n(py::sum(pts.iter().map(|p| p.0)) / n, 1), py::round_n(py::sum(pts.iter().map(|p| p.1)) / n, 1)],
            );
        }
    }
}

/// Le point (x, y) est-il caché aux vues de l'ennemi ? (cinq regards depuis le bord avant de sa zone, à hauteur
/// des officiers à cheval de ses batteries)
///
/// Python (ai.py, l. 913-926) : `def _hidden(b, side, x, y)`
pub fn _hidden(b: &mut TacticalBattle, side: i64, x: f64, y: f64) -> bool {
    let z = b.ai_zone(1 - side);
    let a = b.front_dir(1 - side);
    let (c, s) = (a.cos(), a.sin());
    let (cx, cy) = ((&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0);
    let (hw, hh) = ((&z.at(2) - &z.at(0)).f() / 2.0, (&z.at(3) - &z.at(1)).f() / 2.0);
    let (reach, half) = (c.abs() * hw + s.abs() * hh, s.abs() * hw + c.abs() * hh);
    let eye = EYES().atf("inf");
    for k in [-0.4, -0.2, 0.0, 0.2, 0.4] {
        let (qx, qy) = _at(cx, cy, a, reach, k * 2.0 * half);
        let (px, py_) = _clamp(qx, qy, 5.0);
        if b.los(px, py_, x, y, GUN_EYE, eye) {
            return false;
        }
    }
    true
}

/// Contre-pente à la Wellington : un bataillon vu de l'ennemi cherche, à quelques dizaines de mètres derrière la
/// crête, un abri plus bas et caché ; il montera sur la crête quand l'assaut viendra (au plus 15 essais par
/// bataillon, une seule fois).
///
/// Python (ai.py, l. 929-960) : `def _reverse_slope(b, side, mem, L, line, fd)`
/// line : liste d'unités.
pub fn _reverse_slope(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, line: &Val, fd: f64) {
    let crest = mem.setdefault("crest", dict! {});
    let backs: &[f64] = if L.at("n") == 2 { &[20.0, 35.0, 50.0, 65.0, 80.0] } else { &[20.0, 35.0, 50.0, 65.0] };
    for u in line.iter() {
        let (x0, y0) = (u.atf("x"), u.atf("y"));
        if _hidden(b, side, x0, y0) {
            continue;
        }
        let h0 = b.height_at(x0, y0);
        let mut spot: Option<(f64, f64)> = None;
        'd: for &d in backs {
            for lat in [0.0, 20.0, -20.0] {
                let (x, y) = _at(x0, y0, fd, -d, lat);
                if !(20.0 < x && x < (W - 20) as f64 && 20.0 < y && y < (H - 20) as f64) || !b.passable(x, y, "inf", side) {
                    continue;
                }
                if b.height_at(x, y) <= h0 - 1 && _hidden(b, side, x, y) {
                    spot = Some((x, y));
                    break 'd;
                }
            }
        }
        let Some(mut spot) = spot else { continue };
        if b.phase == "deploiement" {
            b.deploy(side, &id1(&u), spot.0, spot.1, &Val::from(fd), &Val::from("ligne"), "ia");
            spot = (u.atf("x"), u.atf("y"));
        }
        crest.set(&u.at("id"), list![py::round_n(x0, 1), py::round_n(y0, 1)]);
        // (en plein combat, il s'y porte)
        mem.at("post").set(&u.at("id"), list![py::round_n(spot.0, 1), py::round_n(spot.1, 1), py::round_n(fd, 3)]);
    }
    if crest.truthy() {
        let n = crest.len();
        _note(b, mem, &format!("la ligne attend à l'abri derrière la crête ({n} bataillon{}).", if n > 1 { "s" } else { "" }));
    }
}

// ---------------------------------------------------------------------- places

/// Python (ai.py, l. 964-966) : `def _walls(b)`
/// Rend une nouvelle liste (copie superficielle de b.map.walls ; [] si None).
pub fn _walls(b: &TacticalBattle) -> Val {
    b.map.walls.or(list![]).to_list()
}

/// Rayon intérieur de l'enceinte ou des barricades dans 24 directions (None s'il n'y en a pas).
///
/// Python (ai.py, l. 969-985) : `def _ring(b, pl)`
/// pl : `b.place_info()`. Rend une liste de 24 flottants ou None.
pub fn _ring(b: &TacticalBattle, pl: &Val) -> Val {
    let (px, py_, rr) = (pl.atf("x"), pl.atf("y"), pl.atf("r"));
    let out = list![];
    for k in 0..24 {
        let a = k as f64 * std::f64::consts::PI / 12.0;
        let (mut r, mut hit) = (20.0, Val::None);
        while r < rr + 160.0 {
            let (x, y) = (px + a.cos() * r, py_ + a.sin() * r);
            if !(0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64) {
                break;
            }
            if WALLS.contains(&b.terrain_at(x, y)) {
                hit = Val::from(r);
                break;
            }
            r += 10.0;
        }
        out.push(hit);
    }
    out
}

/// Python (ai.py, l. 988-997) : `def _ring_at(mem, a, default)`
/// default : un nombre, ou None. Rend un rayon de mem['ring'] (un entier, `round` au déploiement), sinon default.
/// `(a % (2 * math.pi))` → `py::mod_f` ; `int(round(…)) % 24` → `py::round`, `py::mod_i` ; `ring[(k + dk) % 24]` idem.
pub fn _ring_at(mem: &Val, a: f64, default: &Val) -> Val {
    let ring = mem.get("ring").or(list![]);
    if !ring.truthy() {
        return default.clone();
    }
    let k = py::mod_i(py::round(py::mod_f(a, 2.0 * std::f64::consts::PI) / (std::f64::consts::PI / 12.0)), 24);
    for dk in [0, 1, -1, 2, -2] {
        let r = ring.at(py::mod_i(k + dk, 24));
        if r.is_some() {
            return r;
        }
    }
    default.clone()
}

/// Python (ai.py, l. 1000-1005) : `def _breaches(b)`
/// Rend [(x, y, rayon)] des brèches de toutes les enceintes (`w.get('breach') or []`).
pub fn _breaches(b: &TacticalBattle) -> Vec<(f64, f64, f64)> {
    let mut out = vec![];
    for w in _walls(b).iter() {
        for br in w.get("breach").or(list![]).iter() {
            out.push((br.at(0).f(), br.at(1).f(), br.at(2).f()));
        }
    }
    out
}

/// Les deux postes de flanc d'une brèche (axe a, enceinte à ri du centre, brèche de rayon br) : à l'intérieur, à
/// l'abri du mur, tournés vers le débouché.
///
/// Python (ai.py, l. 1008-1020) : `def _breach_posts(mem, pl, a, ri, br)`
/// Rend deux postes (x, y, dir, 'breche'). `_ring_at(mem, aa, ri) - 22` (`.f()`).
pub fn _breach_posts(mem: &Val, pl: &Val, a: f64, ri: f64, br: f64) -> Vec<(f64, f64, f64, &'static str)> {
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    let (ox, oy) = (px + a.cos() * (ri + 50.0), py_ + a.sin() * (ri + 50.0));
    let da = (br + 55.0) / pmax(60.0, ri);
    let mut out = vec![];
    for sgn in [1.0, -1.0] {
        let aa = a + sgn * da;
        let rr = _ring_at(mem, aa, &Val::from(ri)).f() - 22.0;
        let (x, y) = (px + aa.cos() * rr, py_ + aa.sin() * rr);
        out.push((x, y, (oy - y).atan2(ox - x), "breche"));
    }
    out
}

/// Retranchement derrière une brèche (la « coupure » de Vauban) : un bataillon en ligne à 110 m en arrière, au
/// meilleur couvert, face au débouché ; pris dans la réserve s'il en reste deux, sinon au rempart le plus éloigné de
/// l'attaque.
///
/// Python (ai.py, l. 1023-1041) : `def _coupure(b, side, mem, us, q)`
/// us : liste d'unités ; q : une brèche de mem['breach'] ([x, y, angle]). Rend l'unité postée, ou None.
/// `b.best_spot(…, 50, 'cover', side)` (facing None, cls 'inf').
pub fn _coupure(b: &mut TacticalBattle, side: i64, mem: &Val, us: &Val, q: &Val) -> Val {
    let roles = mem.at("role");
    let (px, py_) = (mem.atf("ax"), mem.atf("ay"));
    let a = q.at(2).f();
    let ri = _ring_at(mem, a, &Val::from(py::hypot(q.at(0).f() - px, q.at(1).f() - py_) + 30.0)).f();
    let mut res: Vec<Val> =
        us.iter().filter(|u| roles.get(&u.at("id")) == "res" && U::valid(u) && u.at("cls") == "inf").collect();
    if res.len() < 2 {
        let fd = mem.atf("fd");
        res = py::sorted_by_key(
            us.iter().filter(|u| roles.get(&u.at("id")) == "mur" && U::valid(u) && u.at("cls") == "inf").collect(),
            |v| -_ang((v.atf("y") - py_).atan2(v.atf("x") - px), fd),
        );
        res.truncate(1);
    }
    if res.is_empty() {
        return Val::None;
    }
    let u = res[0].clone();
    let (x, y) = b.best_spot(px + a.cos() * (ri - 110.0), py_ + a.sin() * (ri - 110.0), 50.0, "cover", side, &Val::None, "inf");
    roles.set(&u.at("id"), "coupure");
    mem.at("post").set(
        &u.at("id"),
        list![py::round_n(x, 1), py::round_n(y, 1), py::round_n((q.at(1).f() - y).atan2(q.at(0).f() - x), 3)],
    );
    u
}

/// Python (ai.py, l. 1044-1148) : `def _deploy_place_def(b, side, mem, L, g, pl)`
/// `used = set()` : appartenance seulement. `zip(posts, strong)` : le plus court des deux.
/// `b.deploy(side, [u.id], *mem['post'][u.id], 'ligne')` : x, y, dir du poste.
pub fn _deploy_place_def(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, g: &Val, pl: &Val) {
    let (px, py_, rr) = (pl.atf("x"), pl.atf("y"), pl.atf("r"));
    let heart = b.objective().or(tup![pl.at("x"), pl.at("y")]);
    let (hx, hy) = (heart.at(0).f(), heart.at(1).f());
    let z0 = b.ai_zone(0);
    let (ex, ey) = ((&z0.at(0) + &z0.at(2)).f() / 2.0, (&z0.at(1) + &z0.at(3)).f() / 2.0);
    let fa = (ey - py_).atan2(ex - px); // d'où vient l'assaillant
    mem.update(&dict! {"ax" => rnd(&pl.at("x"), 1), "ay" => rnd(&pl.at("y"), 1), "fd" => py::round_n(fa, 4),
        "mode" => "poste", "heart" => heart.to_list()});
    let ring = _ring(b, pl);
    mem.set("ring", ring.iter().map(|r| if r.is_none() { Val::None } else { rnd0(&r) }).collect::<Val>());
    let walled = ring.iter().any(|r| r.is_some());
    let r_def = if !walled { Some(rr * 0.8) } else { None };
    // brèches : un bataillon de chaque côté, à l'intérieur, à l'abri du mur (les canons du dehors ne le voient pas à
    // travers la brèche) ; les colonnes qui la franchissent sont prises entre deux feux
    let mut posts: Vec<(f64, f64, f64, &str)> = vec![]; // (x, y, dir, genre)
    let centers = list![];
    for (bx, by, br) in py::sorted_by_key(_breaches(b), |t| _ang((t.1 - py_).atan2(t.0 - px), fa)) {
        let a = (by - py_).atan2(bx - px);
        let ri = _ring_at(mem, a, &Val::from(py::hypot(bx - px, by - py_) - 10.0)).f();
        let (cx_, cy_) = (px + a.cos() * (ri - 30.0), py_ + a.sin() * (ri - 30.0));
        centers.push(list![py::round(cx_), py::round(cy_), py::round_n(a, 3)]);
        posts.extend(_breach_posts(mem, pl, a, ri, br));
    }
    mem.set("breach", centers.clone());
    mem.set("n_brd", centers.len());
    let mut wall_posts: Vec<(f64, f64, f64, &str)> = vec![];
    for k in [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8, 10, -10, 12] {
        let a = fa + k as f64 * 0.38;
        let ri = if walled { _ring_at(mem, a, &Val::None) } else { Val::None };
        if walled && ri.is_none() {
            continue;
        }
        let r = if ri.is_some() { ri.f() - 12.0 } else { r_def.unwrap() };
        let (x, y) = (px + a.cos() * r, py_ + a.sin() * r);
        if posts.iter().chain(wall_posts.iter()).any(|q| _d2(x, y, q.0, q.1) < 8100.0) {
            continue;
        }
        wall_posts.push((x, y, a, "mur"));
    }
    let inf = py::sorted_by_key_rev(g.at("inf").vec(), _quality);
    let mut strong: Vec<Val> = inf.iter().filter(|u| !dans(&u.at("type"), &["sapeurs", "garde"])).cloned().collect();
    let weak: Vec<Val> = inf.iter().filter(|u| !strong.iter().any(|s| s.is(u))).cloned().collect();
    let used = pyset![];
    let nb = posts.len();
    // brèches : les meilleurs bataillons ; la réserve : un bon bataillon au cœur
    let mut res: Vec<Val> = vec![];
    if strong.len() > nb + 1 {
        let i = strong.iter().position(|u| u.at("type") == "grenadiers").unwrap_or(0);
        res.push(strong.remove(i));
    }
    for ((x, y, a, _k), u) in posts.iter().zip(strong.iter()) {
        _put(b, side, mem, u, *x, *y, *a, &Val::from("ligne"), "breche", &Val::None);
        used.push(u.at("id"));
    }
    let rest: Vec<Val> = strong.iter().filter(|u| !used.has(&u.at("id"))).cloned().collect();
    // remparts : légers d'abord, puis l'infanterie, les canons au plus près de l'assaillant
    let mut wp = wall_posts.clone();
    for u in g.at("art").iter() {
        if wp.is_empty() {
            break;
        }
        let (x, y, a, _) = wp.remove(0);
        _put(b, side, mem, &u, x, y, a, &Val::from("batterie"), "art", &Val::None);
    }
    for u in g.at("light").vec().into_iter().chain(rest).chain(weak) {
        if !wp.is_empty() {
            let (x, y, a, _) = wp.remove(0);
            let f = if u.atb("light") { "tirailleurs" } else { "ligne" };
            _put(b, side, mem, &u, x, y, a, &Val::from(f), "mur", &Val::None);
        } else {
            res.push(u);
        }
    }
    // milice : dans les rues entre le mur et le cœur, et au cœur
    for (k, u) in g.at("mil").iter().enumerate() {
        let k = k as i64;
        let (mut x, mut y);
        let role;
        if k == 0 {
            x = hx + fa.cos() * 30.0;
            y = hy + fa.sin() * 30.0;
            role = "coeur";
        } else {
            let a = fa + py::floordiv_i(k + 1, 2) as f64 * 0.7 * (if k % 2 == 1 { 1.0 } else { -1.0 });
            let r = rr * 0.5;
            x = px + a.cos() * r;
            y = py_ + a.sin() * r;
            role = "rue";
            if L.at("n").i() >= 1 {
                (x, y) = b.best_spot(x, y, 50.0, "cover", side, &Val::None, "inf");
            }
        }
        _put(b, side, mem, &u, x, y, fa, &Val::from("ligne"), role, &Val::None);
    }
    let nres = res.len() as f64;
    for (k, u) in res.iter().enumerate() {
        let off = k as f64 - (nres - 1.0) / 2.0;
        let x = hx + fa.cos() * 60.0 - fa.sin() * off * 60.0;
        let y = hy + fa.sin() * 60.0 + fa.cos() * off * 60.0;
        _put(b, side, mem, u, x, y, fa, &Val::from("colonne"), "res", &Val::None);
    }
    for (k, u) in g.at("cav").iter().enumerate() {
        let (x, y) = (hx - fa.cos() * 60.0 + (50 * k) as f64, hy - fa.sin() * 60.0);
        _put(b, side, mem, &u, x, y, fa, &Val::from("ligne"), "cav", &Val::None);
        mem.at("wing").set(&u.at("id"), 0);
    }
    for u in g.at("gen").iter() {
        _put(b, side, mem, &u, hx - fa.cos() * 20.0, hy - fa.sin() * 20.0, fa, &Val::None, "gen", &Val::None);
    }
    for u in g.at("wagon").iter() {
        _put(b, side, mem, &u, hx - fa.cos() * 90.0, hy - fa.sin() * 90.0, fa, &Val::None, "wagon", &Val::None);
    }
    let rmin = py::min_by_key(ring.iter().filter(|r| r.is_some()), |r| r.clone()).unwrap_or(pl.at("r"));
    mem.set("r_in", rnd0(&rmin));
    if L.atb("coupure") {
        for q in centers.iter() {
            let u = _coupure(b, side, mem, &g.at("inf"), &q);
            if u.truthy() {
                let p = mem.at("post").at(&u.at("id"));
                b.deploy(side, &id1(&u), p.at(0).f(), p.at(1).f(), &p.at(2), &Val::from("ligne"), "ia");
            }
        }
    }
    // îlots : les maisons où l'on se battra si l'enceinte est forcée (Saragosse)
    let ilots = list![];
    for k in [Some(0), Some(1), Some(-1), Some(2), Some(-2), None] {
        let (x, y) = match k {
            None => (hx + fa.cos() * 70.0, hy + fa.sin() * 70.0),
            Some(k) => {
                let a = fa + k as f64 * 0.45;
                (px + a.cos() * rr * 0.5, py_ + a.sin() * rr * 0.5)
            }
        };
        let (x, y) = b.best_spot(x, y, 60.0, "cover", side, &Val::None, "inf");
        if b.terrain_at(x, y) == T_BATI {
            ilots.push(list![py::round(x), py::round(y), py::round_n(fa, 3)]);
        }
    }
    mem.set("ilots", ilots);
}

/// Entrées d'un village barricadé : angles des pans de l'anneau de barricades (terrain._barricades, à R + 15)
/// restés ouverts et praticables.
///
/// Python (ai.py, l. 1151-1161) : `def _gaps(b, pl)`
/// Rend les angles (rad) des entrées.
pub fn _gaps(b: &mut TacticalBattle, pl: &Val) -> Vec<f64> {
    let (px, py_, rr) = (pl.atf("x"), pl.atf("y"), pl.atf("r"));
    let mut out = vec![];
    for k in 0..48 {
        let a = (k as f64 + 0.5) * 2.0 * std::f64::consts::PI / 48.0;
        let (x, y) = (px + a.cos() * (rr + 15.0), py_ + a.sin() * (rr + 15.0));
        if 0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64 && b.terrain_at(x, y) != T_BARRICADE && b.passable(x, y, "inf", 0) {
            out.push(a);
        }
    }
    out
}

/// Python (ai.py, l. 1164-1292) : `def _deploy_place_att(b, side, mem, L, g, pl)`
/// Tirage : `_seed_rand(b, side, 3)` seulement s'il y a moins de deux brèches. `math.ceil` → `f64::ceil` (en entier).
/// `guns` : `sorted(…, key=(u.arm or 0, u.men), reverse=True)` → `py::sorted_by_key_rev` sur le couple.
/// `max([...] or [300.0])` : des entiers (portées) ou 300.0.
pub fn _deploy_place_att(b: &mut TacticalBattle, side: i64, mem: &Val, L: &Val, g: &Val, pl: &Val) {
    let (px, py_) = (pl.atf("x"), pl.atf("y"));
    let rr = pl.at("r");
    let heart = b.objective().or(tup![pl.at("x"), pl.at("y")]);
    let z = b.ai_zone(side);
    let (z0, z1, z2, z3) = (z.at(0).f(), z.at(1).f(), z.at(2).f(), z.at(3).f());
    let (zx, zy) = ((&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0);
    let fa = (zy - py_).atan2(zx - px); // de la place vers l'assaillant
    let ring = _ring(b, pl);
    mem.set("ring", ring.iter().map(|r| if r.is_none() { Val::None } else { rnd0(&r) }).collect::<Val>());
    let brs = py::sorted_by_key(_breaches(b), |t| _ang((t.1 - py_).atan2(t.0 - px), fa));
    let walled = _walls(b).iter().any(|w| w.get("kind") != "barricade");
    let gaps = if walled { vec![] } else { _gaps(b, pl) };
    let a_b = if !brs.is_empty() {
        (brs[0].1 - py_).atan2(brs[0].0 - px)
    } else {
        // village barricadé : on l'aborde par une entrée, pas par l'angle des barricades
        let near: Vec<f64> = gaps.iter().copied().filter(|a| _ang(*a, fa) < 1.2).collect();
        py::min_by_key(near, |a| _ang(*a, fa)).unwrap_or(fa)
    };
    let r15 = &rr + 15;
    let ri_v = _ring_at(mem, a_b, &r15);
    let ri = ri_v.f();
    let bout = (px + a_b.cos() * (ri + 60.0), py_ + a_b.sin() * (ri + 60.0));
    let bin_ = (px + a_b.cos() * (ri - 50.0), py_ + a_b.sin() * (ri - 50.0));
    // diversion : une autre brèche, ou une autre face de l'enceinte
    let mut a_d;
    if brs.len() > 1 {
        let l = brs[brs.len() - 1];
        a_d = (l.1 - py_).atan2(l.0 - px);
        if _ang(a_d, a_b) < 0.5 {
            a_d = a_b + 1.0;
        }
    } else {
        a_d = a_b + (if _seed_rand(b, side, 3) < 0.5 { 1.0 } else { -1.0 });
        let other: Vec<f64> = gaps.iter().copied().filter(|a| _ang(*a, a_b) >= 0.8).collect();
        if let Some(a) = py::min_by_key(other, |a| _ang(*a, a_b)) {
            a_d = a; // (la seconde attaque entre par une autre entrée)
        }
    }
    let rd_v = _ring_at(mem, a_d, &r15);
    let rd = rd_v.f();
    let dpt = (px + a_d.cos() * (rd + 70.0), py_ + a_d.sin() * (rd + 70.0));
    let din = (px + a_d.cos() * (rd - 50.0), py_ + a_d.sin() * (rd - 50.0));
    // point de rassemblement : à l'avant de la zone, face à la brèche
    let (mut stx, mut sty) = bout;
    let (mut ux, mut uy) = (zx - stx, zy - sty);
    let mut n = py::hypot(ux, uy);
    if n == 0.0 {
        n = 1.0;
    }
    ux /= n;
    uy /= n;
    for _ in 0..300 {
        if z0 + 50.0 <= stx && stx <= z2 - 50.0 && z1 + 50.0 <= sty && sty <= z3 - 50.0 {
            break;
        }
        stx += ux * 20.0;
        sty += uy * 20.0;
    }
    let fd = (bout.1 - sty).atan2(bout.0 - stx);
    mem.update(&dict! {"ax" => py::round_n(stx, 1), "ay" => py::round_n(sty, 1), "fd" => py::round_n(fd, 4),
        "mode" => "poste", "heart" => heart.to_list(),
        "bout" => list![py::round(bout.0), py::round(bout.1)], "bin" => list![py::round(bin_.0), py::round(bin_.1)],
        "div" => list![py::round(dpt.0), py::round(dpt.1)], "a_b" => py::round_n(a_b, 3), "r_in" => rnd0(&ri_v),
        "din" => list![py::round(din.0), py::round(din.1)], "r_d" => rnd0(&rd_v), "walled" => walled, "batter" => dict!{}});
    let mut inf = py::sorted_by_key_rev(g.at("inf").vec().into_iter().chain(g.at("mil").vec()).collect(), _quality);
    let (mut lights, mut cavs) = (g.at("light").vec(), g.at("cav").vec());
    // sans assez d'infanterie de ligne (la campagne envoie souvent un bataillon léger ou des cavaliers prendre un
    // village), les légers forment les colonnes d'assaut ; sans aucun fantassin, les cavaliers donnent l'assaut
    while inf.len() < 2 && !lights.is_empty() {
        inf.push(lights.remove(0));
    }
    if inf.is_empty() && !cavs.is_empty() {
        inf = std::mem::take(&mut cavs);
    }
    let n_inf = inf.len() as i64;
    let n1 = py::floordiv_i(n_inf + 1, 2).min(4).max(1);
    let first: Vec<Val> = inf[..n1.min(n_inf) as usize].to_vec();
    let mut div: Vec<Val> = vec![];
    let mut rest: Vec<Val> = inf[n1.min(n_inf) as usize..].to_vec();
    let ln = L.at("n").i();
    if rest.len() >= 3 && ln >= 1 {
        div.push(rest.pop().unwrap());
    }
    let mut second = rest;
    let mut garde = Val::None;
    if L.atb("garde") && walled && g.at("art").truthy() && n_inf >= 4 {
        garde = if let Some(u) = second.pop() { u } else { div.pop().unwrap_or(Val::None) };
    }
    for (k, u) in first.iter().enumerate() {
        let lat = (k as f64 - (n1 - 1) as f64 / 2.0) * 70.0;
        let (x, y) = _at(stx, sty, fd, 0.0, lat);
        _put(b, side, mem, u, x, y, fd, &Val::from("colonne"), "assaut", &Val::from(lat));
    }
    let ns = second.len() as f64;
    for (k, u) in second.iter().enumerate() {
        let lat = (k as f64 - (ns - 1.0) / 2.0) * 110.0;
        let (x, y) = _at(stx, sty, fd, -170.0, lat);
        _put(b, side, mem, u, x, y, fd, &Val::from("colonne"), "vague2", &Val::from(lat));
    }
    // diversion : un bataillon et les légers, déployés vers l'autre face
    let sgn: i64 = if _rel(dpt.0, dpt.1, stx, sty, fd).1 >= 0.0 { 1 } else { -1 };
    if ln >= 1 && !lights.is_empty() {
        div.push(lights.remove(0));
    }
    for (k, u) in div.iter().enumerate() {
        let lat = sgn * (330 + 90 * k as i64); // (un entier, comme le Python)
        let (x, y) = _at(stx, sty, fd, -40.0, lat as f64);
        let f = if u.atb("light") { "tirailleurs" } else { "colonne" };
        _put(b, side, mem, u, x, y, fd, &Val::from(f), "diversion", &Val::from(lat));
    }
    let nlg = lights.len() as f64;
    for (k, u) in lights.iter().enumerate() {
        let (mut x, mut y) = _at(stx, sty, fd, 60.0, (k as f64 - (nlg - 1.0) / 2.0) * 160.0);
        if L.at("terrain").truthy() {
            (x, y) = _cover_spot(b, side, x, y, fd, 120.0);
        }
        _put(b, side, mem, u, x, y, fd, &Val::from("tirailleurs"), "avant", &Val::None);
    }
    let arts = g.at("art").vec();
    let na = arts.len() as f64;
    for (k, u) in arts.iter().enumerate() {
        let lat = (k as f64 - (na - 1.0) / 2.0) * 120.0 + (-sgn * 150) as f64;
        let (mut x, mut y) = _at(stx, sty, fd, -30.0, lat);
        if L.at("terrain").truthy() {
            (x, y) = _gun_spot(b, side, x, y, fd, 90.0 * L.atf("r_k"), false, 1e9, true);
        }
        _put(b, side, mem, u, x, y, fd, &Val::from("batterie"), "art", &Val::from(lat));
    }
    // batterie de brèche (Vauban) : les meilleures pièces battent un seul point au pied du mur, à bonne portée mais
    // hors de portée des fusils du rempart
    let guns = py::sorted_by_key_rev(arts.iter().filter(|u| u.at("type") != "mitrailleuses").cloned().collect(), |u: &Val| {
        (u.at("arm").or(0).f(), u.atf("men"))
    });
    if walled && !guns.is_empty() {
        let nb = ((guns.len() as f64 * L.atf("batter")).ceil() as i64).max(1);
        let (ax_, ay_) = (px + a_b.cos() * (ri + 10.0), py_ + a_b.sin() * (ri + 10.0));
        let portees: Vec<f64> = b
            .visible_enemies(side)
            .iter()
            .filter(|e| e.at("cls") == "inf")
            .map(|e| b.ranges(&e).1 as f64)
            .collect();
        let p_def = py::max_f(portees).unwrap_or(300.0);
        let back = (sty - ay_).atan2(stx - ax_);
        let gb: Vec<Val> = guns.iter().take(nb as usize).cloned().collect();
        for (k, u) in gb.iter().enumerate() {
            let d_b = pmin(0.8 * b.ranges(u).0 as f64, pmax(300.0, p_def + 80.0));
            let (qx, qy) = _at(ax_, ay_, back, d_b, (k as f64 - (nb - 1) as f64 / 2.0) * 110.0);
            let (mut x, mut y) = _clamp(qx, qy, 30.0);
            if L.at("terrain").truthy() {
                (x, y) = _gun_spot(b, side, x, y, back + std::f64::consts::PI, 60.0, false, 1e9, true);
            }
            mem.at("batter").set(&u.at("id"), list![py::round(ax_), py::round(ay_)]);
            mem.at("post").set(&u.at("id"), list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(back + std::f64::consts::PI, 3)]);
            b.deploy(side, &id1(u), x, y, &Val::from(back + std::f64::consts::PI), &Val::from("batterie"), "ia");
        }
        if garde.is_some() {
            // garde de tranchée : une ligne ferme devant les batteries de brèche, contre les sorties
            let post = mem.at("post");
            let bx_ = py::sum(gb.iter().map(|u| post.at(&u.at("id")).at(0).f())) / nb as f64;
            let by_ = py::sum(gb.iter().map(|u| post.at(&u.at("id")).at(1).f())) / nb as f64;
            let (x, y) = _at(bx_, by_, back + std::f64::consts::PI, 90.0, 0.0);
            _put(b, side, mem, &garde, x, y, back + std::f64::consts::PI, &Val::from("ligne"), "garde", &Val::None);
            post.set(&garde.at("id"), list![py::round_n(x, 1), py::round_n(y, 1), py::round_n(back + std::f64::consts::PI, 3)]);
            garde = Val::None;
        }
    }
    if garde.is_some() {
        second.push(garde.clone()); // (pas de batterie de brèche à garder : il part avec la seconde vague)
        let (x, y) = _at(stx, sty, fd, -170.0, 0.0);
        _put(b, side, mem, &garde, x, y, fd, &Val::from("colonne"), "vague2", &Val::None);
    }
    for (k, u) in cavs.iter().enumerate() {
        let k = k as i64;
        let w: i64 = if k % 2 == 0 { 1 } else { -1 };
        let (x, y) = _at(stx, sty, fd, -260.0, (w * (220 + 100 * py::floordiv_i(k, 2))) as f64);
        _put(b, side, mem, u, x, y, fd, &Val::from("ligne"), "cav", &Val::from(w * 220));
        mem.at("wing").set(&u.at("id"), w);
    }
    for u in g.at("gen").iter() {
        let (x, y) = _at(stx, sty, fd, -240.0, 0.0);
        _put(b, side, mem, &u, x, y, fd, &Val::None, "gen", &Val::from(0.0));
    }
    for u in g.at("wagon").iter() {
        let (x, y) = _at(stx, sty, fd, -330.0, 60.0);
        _put(b, side, mem, &u, x, y, fd, &Val::None, "wagon", &Val::from(60.0));
    }
    mem.set("n_assault", py::round(py::sum(first.iter().chain(second.iter()).map(|u| u.atf("men")))));
}
